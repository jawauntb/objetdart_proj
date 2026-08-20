import ExpoModulesCore
import ObjetUniverseKit
import QuartzCore
import UIKit

/// A kernel for a scene whose lane has not landed yet. It advances a tick
/// counter and owns no material, so a view showing it has nothing to draw —
/// which is why the wave scene, the one Release 1 screen a visitor actually
/// arrives on, runs `WaveKernel` instead.
private final class NativeProbeKernel: SimulationKernel {
  let scene: SceneID
  private var tick = 0

  init(scene: SceneID) { self.scene = scene }
  func prepare() {}
  func activate() {}
  func freeze() {}
  func retire() {}
  func apply(_ command: SemanticCommand) -> KernelOutput { output() }
  func advance(ticks: Int) -> KernelOutput {
    tick += ticks
    return output()
  }

  private func output() -> KernelOutput {
    .init(
      stable: true,
      checkpoint: .init(scene: scene, tick: tick, digest: "native-probe-\(scene.rawValue)-\(tick)")
    )
  }
}

/// Holds whichever wave kernel the host currently owns. The scene factory has
/// to be built before `super.init`, where `self` does not exist yet, so the
/// factory writes here instead of capturing the view.
private final class WaveKernelBox {
  var kernel: WaveKernel?
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
  private nonisolated(unsafe) let waveKernels: WaveKernelBox
  private nonisolated(unsafe) let displayLinkTarget = DisplayLinkTarget()
  private nonisolated(unsafe) var displayLink: CADisplayLink?
  private nonisolated(unsafe) var lifecycleObservers: [NSObjectProtocol] = []
  private nonisolated(unsafe) var lastAccessibilityTick = -60

  private var metalLayer: CAMetalLayer? { layer as? CAMetalLayer }

  public required init(appContext: AppContext? = nil) {
    let box = WaveKernelBox()
    let initial = WaveKernel(seed: ObjetUniverseView.launchSeed)
    box.kernel = initial
    waveKernels = box
    host = UniverseHost(
      initial: initial,
      factory: { scene in
        guard scene == .wave else {
          // Nothing may keep reading a kernel the host has retired; the
          // renderer simply holds its last frame until a scene lane for the
          // destination lands.
          box.kernel = nil
          return NativeProbeKernel(scene: scene)
        }
        let kernel = WaveKernel(seed: ObjetUniverseView.launchSeed)
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
    guard let kernel = waveKernels.kernel else { return }
    kernel.withSurface { values, width, height in
      renderHost.submitField(
        FieldSubmission(
          values: values,
          width: width,
          height: height,
          elapsedSeconds: kernel.elapsedSeconds,
          secondsPerStep: kernel.secondsPerTick,
          exposure: kernel.exposure
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
