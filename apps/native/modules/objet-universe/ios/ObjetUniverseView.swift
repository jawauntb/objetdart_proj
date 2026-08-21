import ExpoModulesCore
import ObjetUniverseKit
import QuartzCore
import UIKit

/// Holds whichever surface kernel the host currently owns. The scene factory has
/// to be built before `super.init`, where `self` does not exist yet, so the
/// factory writes here instead of capturing the view.
private final class SurfaceKernelBox {
  var kernel: (any SurfaceSimulationKernel)?
}

private final class DisplayLinkTarget: NSObject, @unchecked Sendable {
  weak var view: ObjetUniverseView?

  @objc func tick(_ link: CADisplayLink) {
    view?.advanceFrame(at: link.timestamp)
  }
}

public final class ObjetUniverseView: ExpoView {
  /// Drawable ceiling. Native mirror of the web `resolveDpr` tier: past 2× the
  /// water gains no legibility and the thermal budget notices.
  private static let maximumDrawableScale: CGFloat = 2

  /// The seed the first universe is built from until U4's persisted identity
  /// reaches this view. A constant, never entropy: the same launch must return
  /// the same sea.
  private static let launchSeed: UInt64 = 0x6F62_6A65_7420_6461

  /// The material draws straight into the view's own layer. Without this the
  /// view is a black rectangle no renderer can reach.
  public override class var layerClass: AnyClass { CAMetalLayer.self }

  // UIView deinit is nonisolated under Swift 6.2. These hosts live and die on
  // the main thread with the view; nonisolated(unsafe) is the UIKit-legal way
  // to retire them from deinit without sending CADisplayLink / UIKit types.
  private nonisolated(unsafe) let host: UniverseHost
  private nonisolated(unsafe) let renderHost = RenderHost()
  private nonisolated(unsafe) let surfaceKernels: SurfaceKernelBox
  private nonisolated(unsafe) let displayLinkTarget = DisplayLinkTarget()
  private nonisolated(unsafe) var displayLink: CADisplayLink?
  private nonisolated(unsafe) var lifecycleObservers: [NSObjectProtocol] = []
  private nonisolated(unsafe) var lastAccessibilityTick = -60

  private var metalLayer: CAMetalLayer? { layer as? CAMetalLayer }

  public required init(appContext: AppContext? = nil) {
    let box = SurfaceKernelBox()
    let initial = WaveKernel(seed: ObjetUniverseView.launchSeed)
    box.kernel = initial
    surfaceKernels = box
    host = UniverseHost(
      initial: initial,
      factory: { scene in
        let kernel: any SurfaceSimulationKernel
        switch scene {
        case .wave:
          kernel = WaveKernel(seed: ObjetUniverseView.launchSeed)
        case .cell:
          kernel = CellKernel(seed: ObjetUniverseView.launchSeed)
        case .solar:
          kernel = SolarKernel(seed: ObjetUniverseView.launchSeed)
        }
        box.kernel = kernel
        return kernel
      }
    )
    super.init(appContext: appContext)
    displayLinkTarget.view = self
    backgroundColor = .black
    isOpaque = true
    isAccessibilityElement = true
    accessibilityLabel = "A living wave field"
    installMaterialRenderer()
    observeApplicationLifecycle()
    // The one seam a route may reach the kernel through. The registry holds
    // this view weakly, so a remount replaces it and a teardown clears it
    // without a nonisolated deinit having to call back in.
    UniverseRuntime.shared.attach(self)
  }

  deinit {
    displayLink?.invalidate()
    displayLinkTarget.view = nil
    lifecycleObservers.forEach(NotificationCenter.default.removeObserver)
    renderHost.retireAll()
    host.shutdown()
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    guard window != nil else { return suspendUniverse() }
    resumeUniverseIfAttached()
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    guard let metalLayer else { return }
    let displayScale = traitCollection.displayScale > 0 ? traitCollection.displayScale : 2
    let scale = min(displayScale, ObjetUniverseView.maximumDrawableScale)
    let size = CGSize(width: bounds.width * scale, height: bounds.height * scale)
    guard size.width >= 1, size.height >= 1 else { return }
    metalLayer.contentsScale = scale
    if metalLayer.drawableSize != size { metalLayer.drawableSize = size }
  }

  private func suspendUniverse() {
    host.suspend()
    renderHost.suspend()
    displayLink?.isPaused = true
  }

  private func resumeUniverseIfAttached() {
    guard window != nil else { return }
    host.resume(at: CACurrentMediaTime())
    renderHost.resume()
    startDisplayLinkIfNeeded()
    displayLink?.isPaused = false
  }

  /// Whether the medium currently mounted says this verb in its own
  /// material. The input layer asks before it commits, and answers in the
  /// hand and the ear when the answer is no.
  func expresses(_ verb: SemanticVerb) -> Bool {
    host.expresses(verb)
  }

  /// Commit one semantic act. The host schedules it onto a fixed tick — never
  /// onto a presentation frame — so the same gestures replay to the same sea.
  func commit(_ command: SemanticCommand) {
    host.apply(command)
  }

  /// Update only the visual lens. The field remains authoritative and keeps
  /// advancing; this is the native equivalent of the web wave lens rotation.
  func setRepresentation(_ rawValue: Int) {
    surfaceKernels.kernel?.setRepresentation(rawValue)
  }

  /// Kept as a source-compatible alias for older route glue; every surface
  /// now understands the same projection control.
  func setWaveRepresentation(_ rawValue: Int) {
    setRepresentation(rawValue)
  }

  /// The authoritative tick, for the sensory buses: sight, sound, and touch
  /// all read one clock or they are three separate events.
  var logicalTick: Int { host.telemetry.logicalTick }

  public func setScene(_ rawScene: String) {
    guard let destination = SceneID(rawValue: rawScene) else { return }
    do {
      if try host.handoff(to: destination) {
        accessibilityLabel = accessibilityDescription(for: destination)
      }
    } catch {
      // The last stable scene remains visible. U4 persists this boundary; U3
      // intentionally keeps the failure local and non-destructive.
    }
  }

  nonisolated fileprivate func advanceFrame(at timestamp: CFTimeInterval) {
    let frame = host.advance(to: timestamp)
    submitActiveSurface()
    renderHost.render(interpolation: frame.interpolation)
    publishAccessibilitySnapshotIfNeeded()
  }

  /// Hand the frame's authoritative field to the material. The pointer never
  /// escapes the closure and nothing is copied on the way, so the frame path
  /// allocates nothing.
  nonisolated private func submitActiveSurface() {
    guard let kernel = surfaceKernels.kernel else { return }
    kernel.withSurface { values, width, height in
      renderHost.submitField(
        FieldSubmission(
          values: values,
          width: width,
          height: height,
          elapsedSeconds: kernel.elapsedSeconds,
          secondsPerStep: kernel.secondsPerTick,
          exposure: kernel.exposure,
          representation: kernel.representationIndex,
          materialKind: kernel.materialKind
        )
      )
    }
  }

  /// The one renderer this view installs. If Metal is unavailable the view
  /// stays on its ground colour rather than installing a stand-in that counts
  /// frames and draws nothing.
  private func installMaterialRenderer() {
    guard let metalLayer else { return }
    guard let renderer = WaveMaterialRenderer(layer: metalLayer, breathSeconds: WaveField.breathSeconds) else { return }
    renderHost.install(renderer)
  }

  private func startDisplayLinkIfNeeded() {
    guard displayLink == nil else { return }
    let link = CADisplayLink(target: displayLinkTarget, selector: #selector(DisplayLinkTarget.tick(_:)))
    link.add(to: .main, forMode: .common)
    displayLink = link
  }

  private func observeApplicationLifecycle() {
    let center = NotificationCenter.default
    lifecycleObservers = [
      center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
        self?.suspendUniverse()
      },
      center.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
        self?.resumeUniverseIfAttached()
      },
    ]
  }

  nonisolated private func publishAccessibilitySnapshotIfNeeded() {
    let tick = host.telemetry.logicalTick
    guard tick - lastAccessibilityTick >= 60 else { return }
    lastAccessibilityTick = tick
    MainActor.assumeIsolated {
      self.accessibilityValue = "tick \(tick)"
    }
  }

  private func accessibilityDescription(for scene: SceneID) -> String {
    switch scene {
    case .wave: "A living wave field"
    case .cell: "A living cellular colony"
    case .solar: "A forming solar system"
    }
  }
}
