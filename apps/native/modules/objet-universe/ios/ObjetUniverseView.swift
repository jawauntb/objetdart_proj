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
  private var reducedMotionEnabled = false
  /// A transient Metal allocation failure must not make the React route and
  /// native authority diverge. A foreground return or explicit route request
  /// gets a fresh, bounded chance before committing this scene handoff.
  private var pendingScene: SceneID?
  private let pendingSceneRetries = SceneConstructionRetryPolicy()
  /// RenderHost owns the renderer instances, while this view owns the route
  /// intent. Keeping the installed scene here lets a Metal allocation failure
  /// on the initial route retry without pretending the current renderer exists.
  private var rendererScene: SceneID?

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
        case .molecules:
          kernel = MoleculeKernel(seed: ObjetUniverseView.launchSeed)
        case .atoms:
          kernel = AtomKernel(seed: ObjetUniverseView.launchSeed)
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
    installMaterialRenderer(for: .wave)
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
    retryPendingSceneIfDue()
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
    pendingSceneRetries.reset(at: CACurrentMediaTime())
    retryPendingSceneIfNeeded()
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
    host.apply(projectSolarCommandIfNeeded(command))
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

  /// The active kernel remains authoritative and keeps advancing. Only a
  /// material's decorative presentation may hold at an accessible detent.
  func setReducedMotion(_ value: Bool) {
    reducedMotionEnabled = value
    (surfaceKernels.kernel as? any ReducedMotionSimulationKernel)?.setReducedMotion(value)
    renderHost.setReducedMotion(value)
  }

  /// Resolve a touch to one authoritative solar identity. The input layer can
  /// use the returned ID in a semantic command, but never reads render
  /// instances or screen-space sprites to decide what was touched.
  func solarTargetBody(at materialPoint: SemanticOrigin) -> UInt64? {
    let projected = renderHost.projectSolarMaterialPoint(materialPoint)
    return (surfaceKernels.kernel as? any SolarSnapshotProviding)?.solarTargetBody(at: projected)
  }

  /// Open-sky drags turn the presentation camera. They bypass the kernel, so
  /// looking around can never move the selected body or alter replay state.
  func orientSolarCamera(
    by translation: SemanticVector,
    velocity: SemanticVector,
    phase: SemanticGesturePhase
  ) {
    renderHost.orientSolarCamera(by: translation, velocity: velocity, phase: phase)
  }

  /// Drain only outcomes authored by the active kernel. Runtime sensory buses
  /// consume this borrowed batch immediately after commit, keeping event
  /// meaning out of gesture recognizers and renderer heuristics.
  func drainSimulationOutcomes<T>(_ body: (UnsafeBufferPointer<SimulationOutcome>) -> T) -> T {
    guard let source = surfaceKernels.kernel as? any SimulationOutcomeProducing else {
      return body(UnsafeBufferPointer(start: nil, count: 0))
    }
    return source.drainSimulationOutcomes(body)
  }

  /// The authoritative tick, for the sensory buses: sight, sound, and touch
  /// all read one clock or they are three separate events.
  var logicalTick: Int { host.telemetry.logicalTick }
  var activeScene: SceneID { host.activeScene }

  public func setScene(_ rawScene: String) {
    guard let destination = SceneID(rawValue: rawScene) else { return }
    // Expo may send the current scene again on mount. Do not let a discarded
    // renderer reconfigure the shared CAMetalLayer under the live material.
    if destination == host.activeScene, rendererScene == destination {
      clearPendingScene()
      return
    }
    queuePendingScene(destination)
    retryPendingSceneIfNeeded()
  }

  private func retryPendingSceneIfNeeded() {
    guard let destination = pendingScene else { return }
    if destination == host.activeScene {
      guard rendererScene != destination else {
        clearPendingScene()
        return
      }
      guard pendingSceneRetries.beginAttempt(at: CACurrentMediaTime()) else { return }
      guard let renderer = makeMaterialRenderer(for: destination) else { return }
      renderHost.install(renderer)
      rendererScene = destination
      clearPendingScene()
      return
    }
    // Material setup is allowed to decline when Metal cannot provide its
    // bounded resources. Build before committing the scientific handoff so a
    // Cell state can never be rendered through the scene just left behind.
    guard pendingSceneRetries.beginAttempt(at: CACurrentMediaTime()) else { return }
    guard let renderer = makeMaterialRenderer(for: destination) else { return }
    do {
      if try host.handoff(to: destination) {
        // The host factory has just made a fresh kernel. Replaying the
        // preference here keeps a newly entered Cell lens at the same visual
        // detent as the scene the visitor just left.
        (surfaceKernels.kernel as? any ReducedMotionSimulationKernel)?.setReducedMotion(reducedMotionEnabled)
        accessibilityLabel = accessibilityDescription(for: destination)
        renderHost.install(renderer)
        rendererScene = destination
        clearPendingScene()
      } else {
        renderer.retire()
        if host.activeScene == destination { clearPendingScene() }
      }
    } catch {
      renderer.retire()
      // The last stable scene remains visible. U4 persists this boundary; U3
      // intentionally keeps the failure local and non-destructive.
    }
  }

  private func retryPendingSceneIfDue() {
    guard pendingScene != nil else { return }
    retryPendingSceneIfNeeded()
  }

  private func queuePendingScene(_ destination: SceneID) {
    pendingScene = destination
    pendingSceneRetries.reset(at: CACurrentMediaTime())
  }

  private func clearPendingScene() {
    pendingScene = nil
  }

  nonisolated fileprivate func advanceFrame(at timestamp: CFTimeInterval) {
    MainActor.assumeIsolated {
      self.retryPendingSceneIfDue()
    }
    let frame = host.advance(to: timestamp)
    publishFrameOutcomes()
    submitActiveSurface()
    renderHost.render(interpolation: frame.interpolation)
    publishAccessibilitySnapshotIfNeeded()
  }

  /// Collisions and escapes originate during fixed-step advancement rather
  /// than a gesture callback. Drain them before this frame is drawn so sight,
  /// sound, and touch all receive the same authoritative event.
  nonisolated private func publishFrameOutcomes() {
    MainActor.assumeIsolated {
      self.publishFrameOutcomesOnMain()
    }
  }

  private func publishFrameOutcomesOnMain() {
    guard let source = surfaceKernels.kernel as? any SimulationOutcomeProducing else { return }
    source.drainSimulationOutcomes { outcomes in
      guard !outcomes.isEmpty else { return }
      UniverseRuntime.shared.publishAuthoritativeOutcomes(outcomes)
    }
  }

  /// Hand the frame's authoritative field to the material. The pointer never
  /// escapes the closure and nothing is copied on the way, so the frame path
  /// allocates nothing.
  nonisolated private func submitActiveSurface() {
    guard let kernel = surfaceKernels.kernel else { return }
    if let atoms = kernel as? any AtomSnapshotProviding {
      atoms.withAtomRenderSnapshot { snapshot in
        renderHost.submitAtoms(snapshot)
      }
      return
    }
    if let solar = kernel as? any SolarSnapshotProviding {
      solar.withSolarRenderSnapshot { snapshot in
        renderHost.submitSolar(snapshot)
      }
      return
    }
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
  private func installMaterialRenderer(for scene: SceneID) {
    guard let renderer = makeMaterialRenderer(for: scene) else {
      queuePendingScene(scene)
      return
    }
    renderHost.install(renderer)
    rendererScene = scene
  }

  private func makeMaterialRenderer(for scene: SceneID) -> (any UniverseRenderer)? {
    guard let metalLayer else { return nil }
    return SceneRendererFactory.make(
      for: scene,
      layer: metalLayer,
      waveBreathSeconds: WaveField.breathSeconds
    )
  }

  /// The input surface has already inverted the viewport's aspect cover.
  /// Solar has one additional presentation-only yaw/pitch transform, so apply
  /// its inverse here before the command enters replayable authority.
  private func projectSolarCommandIfNeeded(_ command: SemanticCommand) -> SemanticCommand {
    guard host.activeScene == .solar else { return command }
    let origin = command.origin.map(renderHost.projectSolarMaterialPoint)
    let contact = command.payload.contact.map { contact in
      SemanticContactPayload(
        phase: contact.phase,
        point: renderHost.projectSolarMaterialPoint(contact.point),
        durationSeconds: contact.durationSeconds,
        normalizedPressure: contact.normalizedPressure,
        azimuth: contact.azimuth,
        altitude: contact.altitude,
        targetBodyID: contact.targetBodyID
      )
    }
    let drag = command.payload.drag.map { drag in
      SemanticDragPayload(
        phase: drag.phase,
        point: renderHost.projectSolarMaterialPoint(drag.point),
        translation: renderHost.projectSolarMaterialVector(drag.translation),
        velocity: renderHost.projectSolarMaterialVector(drag.velocity),
        targetBodyID: drag.targetBodyID
      )
    }
    return SemanticCommand(
      id: command.id,
      verb: command.verb,
      at: command.at,
      intensity: command.intensity,
      origin: origin,
      payload: SemanticCommandPayload(contact: contact, drag: drag, vessel: command.payload.vessel)
    )
  }

  private func startDisplayLinkIfNeeded() {
    guard displayLink == nil else { return }
    let link = CADisplayLink(target: displayLinkTarget, selector: #selector(DisplayLinkTarget.tick(_:)))
    // The solver advances at 120 fixed ticks per second, two per presentation.
    // A ProMotion display must not silently double the main-thread callback
    // rate: touch delivery and Metal submission share that thread.
    link.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 60, preferred: 60)
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
    case .molecules: "A living molecular field"
    case .atoms: "A periodic atomic field"
    }
  }
}
