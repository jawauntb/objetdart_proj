import ExpoModulesCore
import ObjetUniverseKit
import QuartzCore
import UIKit

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

private final class DisplayLinkTarget: NSObject, @unchecked Sendable {
  weak var view: ObjetUniverseView?

  @objc func tick(_ link: CADisplayLink) {
    view?.advanceFrame(at: link.timestamp)
  }
}

public final class ObjetUniverseView: ExpoView {
  // UIView deinit is nonisolated under Swift 6.2. These hosts live and die on
  // the main thread with the view; nonisolated(unsafe) is the UIKit-legal way
  // to retire them from deinit without sending CADisplayLink / UIKit types.
  private nonisolated(unsafe) let host: UniverseHost
  private nonisolated(unsafe) let renderHost = RenderHost()
  private nonisolated(unsafe) let displayLinkTarget = DisplayLinkTarget()
  private nonisolated(unsafe) var displayLink: CADisplayLink?
  private nonisolated(unsafe) var lifecycleObservers: [NSObjectProtocol] = []
  private nonisolated(unsafe) var lastAccessibilityTick = -60

  public required init(appContext: AppContext? = nil) {
    let initial = NativeProbeKernel(scene: .wave)
    host = UniverseHost(initial: initial, factory: { NativeProbeKernel(scene: $0) })
    super.init(appContext: appContext)
    displayLinkTarget.view = self
    backgroundColor = .black
    isAccessibilityElement = true
    accessibilityLabel = "A living wave field"
    renderHost.install(RendererProbe(kind: .metal))
    renderHost.install(RendererProbe(kind: .realityKit))
    renderHost.install(RendererProbe(kind: .skiaOverlay))
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
    renderHost.render(interpolation: frame.interpolation)
    publishAccessibilitySnapshotIfNeeded()
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
