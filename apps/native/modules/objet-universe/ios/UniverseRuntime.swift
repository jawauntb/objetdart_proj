import ObjetUniverseKit
import QuartzCore
import UIKit

/// Where a routed gesture becomes an act of the universe.
///
/// There is exactly one live universe in the process — `ObjetUniverseView`
/// mounts once, below every route, and owns the host, the clock, and the
/// active kernel. The surface the visitor actually touches is a different
/// view, mounted *inside* the route, because a native view cannot be hit-
/// tested through the React screens stacked on top of it. This registry is
/// the seam between the two, and it is deliberately the only one: a route
/// cannot reach the kernel except by committing a semantic command through
/// here.
///
/// Two things happen to every command, in this order:
///
///  1. If the active medium says the verb — `SimulationKernel.expresses` —
///     the command is committed to the host, and the material answers on the
///     next authoritative tick.
///  2. Either way the hand and the ear answer, through the shared sensory
///     buses. That is the native form of the web's rule in
///     `src/lib/gesture/defaults.ts`: a verb this medium does not mean still
///     lands, softly, scaled by the magnitude the hand offered. Never
///     nothing, never loud.
@MainActor
final class UniverseRuntime {
  static let shared = UniverseRuntime()

  private weak var universe: ObjetUniverseView?
  private var committed = 0
  private var representation = 0
  private var maximumRepresentation = 3
  private var reducedMotion = false
  private var hoverPreviewSequence = 0

  /// The vessel is the device itself — tilt, shake, knock, flip — and it
  /// belongs here rather than to either view: it outlives the route, it has
  /// nothing to do with where a finger landed, and it must stay a single
  /// subscription no matter how many surfaces mount above it.
  private let vessel = VesselSensors()
  private var vesselDetach: (() -> Void)?
  private lazy var vesselRouter = GestureRouter(
    onCommand: { [weak self] routed in
      MainActor.assumeIsolated {
        _ = self?.commit(routed, origin: nil)
      }
    },
    onDiscovery: { _ in }
  )

  private init() {}

  /// The mounted universe. Attaching a second one replaces the first: the
  /// tree is only ever supposed to hold one, and the newest is the one the
  /// visitor is looking at. The reference is weak on purpose — a view that
  /// goes away takes the registration with it, and a `UIView` deinit is
  /// nonisolated and could not call back in here to say so.
  func attach(_ view: ObjetUniverseView) {
    universe = view
    view.setRepresentation(representation)
    // Build the graph and one-shot buffers before the first touch so the
    // interaction path only schedules an already-resident buffer.
    AudioBus.shared.prewarm()
    subscribeVesselIfNeeded()
  }

  /// Shell controls (fold, accessibility) change the lens through the same
  /// registry as touch. Keeping this seam native avoids a React render loop in
  /// the frame path and keeps the persistent host authoritative.
  func setRepresentation(_ rawValue: Int) {
    representation = min(max(rawValue, 0), maximumRepresentation)
    universe?.setRepresentation(representation)
  }

  func setMaximumRepresentation(_ rawValue: Int) {
    maximumRepresentation = min(max(rawValue, 0), 3)
    if representation > maximumRepresentation {
      representation = maximumRepresentation
      universe?.setRepresentation(representation)
    }
  }

  func setReducedMotion(_ value: Bool) {
    guard reducedMotion != value else { return }
    reducedMotion = value
    if value {
      // Enter captures the current pose and clears any presentation velocity
      // without snapping the camera back or mutating the solar kernel.
      universe?.orientSolarCamera(by: .zero, velocity: .zero, phase: .enter)
    }
  }

  /// Pencil hover borrows the typed open-sky contact preview. It deliberately
  /// bypasses sensory answers and React receipts, and it can only enter/tick/
  /// cancel, so hovering can never create a body or advance progression.
  func previewPencilHover(_ contact: SemanticContactPayload) {
    guard isSolarScene, contact.targetBodyID == nil, contact.phase != .release else { return }
    hoverPreviewSequence += 1
    universe?.commit(SemanticCommand(
      id: "pencil-hover-\(hoverPreviewSequence)",
      verb: .grow,
      at: CACurrentMediaTime(),
      intensity: min(0.3, 0.08 + contact.durationSeconds / 3),
      origin: contact.point,
      payload: SemanticCommandPayload(contact: contact)
    ))
  }

  /// Hit testing remains a kernel query. UIKit supplies a material-space
  /// point; the renderer never decides which body the hand selected.
  func targetBodyID(at materialPoint: SemanticOrigin) -> UInt64? {
    universe?.solarTargetBody(at: materialPoint)
  }

  var isSolarScene: Bool { universe?.activeScene == .solar }

  /// Outcome feedback enters only as a complete event authored by the
  /// authoritative kernel/host. This seam deliberately accepts no position,
  /// render pulse, or guessed collision kind from which the runtime could
  /// fabricate scientific meaning.
  func publishAuthoritativeOutcome(_ event: SensoryEvent) {
    _ = HapticBus.shared.schedule(event)
    _ = AudioBus.shared.schedule(event)
  }

  /// Translate only typed results drained from the kernel. The bounded
  /// intensity is the one cross-modal energy; raw orbital energy remains
  /// available for scientific display but never becomes speaker gain.
  func publishAuthoritativeOutcomes(_ outcomes: UnsafeBufferPointer<SimulationOutcome>) {
    for outcome in outcomes {
      publishAuthoritativeOutcome(SensoryEvent(
        id: "kernel-\(outcome.id)",
        signature: Self.signature(for: outcome.kind),
        clock: SensoryClock(logicalTick: outcome.tick),
        energy: outcome.intensity,
        frequencyHz: outcome.frequencyHz
      ))
    }
  }

  /// Assistive actions enter at the same semantic boundary as touch. They
  /// have no UIKit gesture shape, so the route supplies a deterministic
  /// synthetic origin and this method supplies the same sensory answer.
  @discardableResult
  func commitAssistive(
    id: String,
    verb: SemanticVerb,
    intensity: Double,
    origin: SemanticOrigin
  ) -> Bool {
    let boundedIntensity = min(max(intensity, 0), 1)
    let expressed = canApplyRepresentation(verb) && (universe?.expresses(verb) ?? false)
    committed += 1
    if expressed {
      advanceRepresentation(for: verb)
      universe?.commit(
        SemanticCommand(id: id, verb: verb, at: CACurrentMediaTime(), intensity: boundedIntensity, origin: origin)
      )
    }
    answer(
      id: id,
      grammarVerb: Self.grammarVerb(for: verb),
      intensity: boundedIntensity,
      expressed: expressed
    )
    return expressed
  }

  /// Commit one routed gesture. Returns whether the medium expressed it, so
  /// the surface can tell React which phenomena the visitor has actually
  /// caused — the guide gates its entries on that, and an entry whose
  /// phenomenon has not landed stays hidden.
  @discardableResult
  func commit(
    _ routed: RoutedCommand,
    origin: SemanticOrigin?,
    payload: SemanticCommandPayload = .empty
  ) -> Bool {
    let verb = GestureRouter.semanticVerb(for: routed.verb)
    let intensity = min(max(routed.intensity, 0), 1)
    let semanticPayload: SemanticCommandPayload
    if case let .tilt(beta, gamma) = routed.shape {
      semanticPayload = SemanticCommandPayload(
        vessel: SemanticVesselPayload(betaDegrees: beta, gammaDegrees: gamma)
      )
    } else {
      semanticPayload = payload
    }
    let cameraAnswered: Bool
    if verb == .pan, let drag = semanticPayload.drag {
      universe?.orientSolarCamera(
        by: drag.translation,
        velocity: reducedMotion ? .zero : drag.velocity,
        phase: drag.phase
      )
      cameraAnswered = true
    } else {
      cameraAnswered = false
    }
    let expressed = cameraAnswered || (canApplyRepresentation(verb) && (universe?.expresses(verb) ?? false))
    committed += 1
    let id = "\(routed.source.rawValue)-\(routed.verb.rawValue)-\(committed)"

    if expressed && !cameraAnswered {
      advanceRepresentation(for: verb)
      universe?.commit(
        SemanticCommand(
          id: id,
          verb: verb,
          at: CACurrentMediaTime(),
          intensity: intensity,
          origin: origin,
          payload: semanticPayload
        )
      )
    }
    if UniverseRuntime.answerable(routed.shape) {
      answer(id: id, grammarVerb: routed.verb, intensity: intensity, expressed: expressed)
    }
    // The vessel is invited by a hand, never demanded on launch: iOS only
    // presents its dialog from inside a real gesture, and a universe that
    // asked before it was touched would be asking for nothing.
    if routed.source == .touch { vessel.request { _ in } }
    return expressed
  }

  private func canApplyRepresentation(_ verb: SemanticVerb) -> Bool {
    switch verb {
    case .lens: return maximumRepresentation == 3 || representation < maximumRepresentation
    case .stepBack: return representation > 0
    default: return true
    }
  }

  private func advanceRepresentation(for verb: SemanticVerb) {
    switch verb {
    case .lens: representation = representation == maximumRepresentation ? 0 : representation + 1
    case .stepBack: representation -= 1
    default: break
    }
  }

  private func subscribeVesselIfNeeded() {
    guard vesselDetach == nil else { return }
    vesselDetach = vessel.subscribe(
      VesselSensors.Listener(
        onShake: { [weak self] intensity in
          _ = Task { @MainActor in
            self?.routeVessel(NativeGestureShape.shake(intensity: intensity))
          }
        },
        onKnock: { [weak self] intensity in
          _ = Task { @MainActor in
            self?.routeVessel(NativeGestureShape.knock(intensity: intensity))
          }
        },
        onTilt: { [weak self] event in
          _ = Task { @MainActor in
            self?.routeVessel(NativeGestureShape.tilt(beta: event.beta, gamma: event.gamma))
          }
        },
        onFlip: { [weak self] faceDown in
          _ = Task { @MainActor in
            self?.routeVessel(NativeGestureShape.flip(faceDown: faceDown))
          }
        }
      )
    )
  }

  /// The vessel delivers on its own queue; the hop above is why this is
  /// ordinary main-thread code by the time it runs.
  private func routeVessel(_ shape: NativeGestureShape) {
    vesselRouter.route(shape: shape, source: NativeActionSource.vessel,
      logicalTimeMs: CACurrentMediaTime() * 1_000
    )
  }

  /// Which shapes reach the hand and the ear at all.
  ///
  /// A gesture that lasts arrives twenty times a second, and twenty haptics a
  /// second is a rattle rather than a confirmation — the web says the same
  /// thing in `roomGestureBindings`, which acknowledges a span opening and
  /// closing and never its ticks. So a continuous stream answers in the
  /// material, where it belongs, and only the boundaries and the discrete
  /// acts answer in the other two senses.
  private static func answerable(_ shape: NativeGestureShape) -> Bool {
    switch shape {
    case .tap, .flick, .shake, .knock, .flip: true
    case let .hold(_, _, _, _, _, phase, _, _, _, _): phase == .enter || phase == .release
    case let .span(phase, _, _, _, _): phase == .enter || phase == .release
    case .drag, .twist, .pinch, .scrub, .tilt, .breath: false
    }
  }

  /// The two other senses, on the same clock as the frame. Sight is the
  /// renderer's; this is sound and touch, and both read the one energy the
  /// event carries so no channel can invent an amplitude of its own.
  private func answer(id: String, grammarVerb: NativeGrammarVerb, intensity: Double, expressed: Bool) {
    // A verb the medium expresses is confirmed at the strength the hand
    // brought. A verb it cannot express is acknowledged rather than acted on,
    // so it stays quieter than the real thing and never masquerades as it.
    let energy = expressed ? 0.25 + 0.75 * intensity : 0.15 + 0.45 * intensity
    let event = SensoryEvent(
      id: id,
      signature: UniverseRuntime.signature(for: grammarVerb),
      clock: SensoryClock(logicalTick: universe?.logicalTick ?? 0),
      energy: energy
    )
    _ = HapticBus.shared.schedule(event)
    _ = AudioBus.shared.schedule(event)
  }

  /// Signature is a shape, not a loudness: which gesture this was, in the
  /// vocabulary `SensorySignature` publishes. Intensity is carried by the
  /// event's energy and never by the choice of signature.
  private static func signature(for verb: NativeGrammarVerb) -> SensorySignature {
    switch verb {
    case .tap, .rhythm, .drum, .arpeggio: .tap
    case .drag, .scrub, .span: .ripple
    case .flick, .knock: .chop
    case .holdDwell, .tilt, .breath: .roll
    case .tap3, .holdCeremony: .bloom
    case .drag3, .shake: .storm
    case .tap2, .hold3, .twist3, .pinch, .pan2: .detent
    case .twist: .lens
    case .flip: .crossing
    }
  }

  private static func signature(for outcome: SimulationOutcomeKind) -> SensorySignature {
    switch outcome {
    case .created: .bloom
    case .selected: .detent
    case .orbitLocked: .lens
    case .collision: .crossing
    case .consumed: .chop
    case .escaped: .storm
    }
  }

  static func grammarVerb(for semanticVerb: SemanticVerb) -> NativeGrammarVerb {
    switch semanticVerb {
    case .material: return .tap
    case .stepBack: return .tap2
    case .tutti: return .tap3
    case .grow: return .holdDwell
    case .ceremony: return .holdCeremony
    case .timeDilation: return .hold3
    case .weather: return .drag3
    case .lens: return .twist
    case .agitate: return .shake
    case .gravity: return .tilt
    case .wake: return .knock
    case .night: return .flip
    case .breath: return .breath
    case .train: return .rhythm
    case .scale: return .pinch
    case .pan: return .pan2
    case .season: return .twist3
    }
  }
}
