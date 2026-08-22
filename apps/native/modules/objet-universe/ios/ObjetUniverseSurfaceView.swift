import ExpoModulesCore
import ObjetUniverseKit
import QuartzCore
import UIKit

/// The surface the visitor's hand actually meets.
///
/// The universe itself is mounted once, below every route, and it stays there
/// — a route may not own or reset the active kernel. But a native view below
/// a React screen cannot be touched: UIKit hit-tests the topmost view at a
/// point, and every navigator screen above the universe answers first, even
/// when it is fully transparent. That is why the first build had a sea that
/// moved and could not be moved.
///
/// So the touchable half is this: a transparent native view the route mounts
/// *inside* itself, holding the recognisers and nothing else. It draws
/// nothing, keeps no state a route could reset, and reaches the kernel only
/// through `UniverseRuntime`. The chrome sits above it and keeps its own
/// taps; the water sits below it and answers everything else.
public final class ObjetUniverseSurfaceView: ExpoView {
  /// Every committed gesture, as the durable act it became. React uses it to
  /// know which phenomena the visitor has *caused* — the guide shows an entry
  /// only once its phenomenon has landed — and for nothing else: the material
  /// never round-trips through JavaScript.
  let onSemanticCommand = EventDispatcher()

  private var input: SurfaceInput?
  private var enabled = true
  private var assistiveVerb: String?
  private var assistiveIntensity = 0.5
  private var assistiveOriginX = 0.5
  private var assistiveOriginY = 0.5
  private var lastAssistiveCommandId: String?
  private var pencilHoverActive = false
  private var pencilHoverStartedAt: CFTimeInterval = 0
  private var lastPencilHoverPoint = SemanticOrigin.centre

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .clear
    isOpaque = false
    // VoiceOver reads the universe below, which carries the scene's label and
    // its live value. An unlabelled element on top would silence it.
    isAccessibilityElement = false
    let router = GestureRouter(
      onCommand: { [weak self] routed in
        MainActor.assumeIsolated { self?.receive(routed) }
      },
      onDiscovery: { _ in }
    )
    input = SurfaceInput(
      surface: self,
      router: router,
      targetResolver: { [weak self] viewX, viewY in
        guard let self else { return .openSky }
        return self.contactTarget(at: self.materialPoint(viewX: viewX, viewY: viewY))
      },
      onPencilSample: { [weak self] sample in
        self?.receivePencil(sample)
      }
    )
  }

  /// The route closes the surface while a reading surface is open: the
  /// documented state contract pauses authoritative intervention while the
  /// guide sheet has focus.
  public func setEnabled(_ value: Bool) {
    enabled = value
    input?.setEnabled(value && window != nil)
    if !value { cancelPencilHover() }
  }

  public func setRepresentation(_ value: Int) {
    UniverseRuntime.shared.setRepresentation(value)
  }

  public func setMaxRepresentation(_ value: Int) {
    UniverseRuntime.shared.setMaximumRepresentation(value)
  }

  public func setReducedMotion(_ value: Bool) {
    UniverseRuntime.shared.setReducedMotion(value)
  }

  public func setAssistiveVerb(_ value: String?) {
    assistiveVerb = value
  }

  public func setAssistiveIntensity(_ value: Double) {
    assistiveIntensity = min(max(value, 0), 1)
  }

  public func setAssistiveOriginX(_ value: Double) {
    assistiveOriginX = min(max(value, 0), 1)
  }

  public func setAssistiveOriginY(_ value: Double) {
    assistiveOriginY = min(max(value, 0), 1)
  }

  /// The command id is deliberately the last prop in the JS surface. Expo
  /// applies the verb, intensity, and origin first; changing the id is the
  /// single commit edge and prevents a prop update from firing twice.
  public func setAssistiveCommandId(_ value: String?) {
    guard let value, !value.isEmpty, value != lastAssistiveCommandId else { return }
    lastAssistiveCommandId = value
    guard let rawVerb = assistiveVerb, let verb = SemanticVerb(rawValue: rawVerb) else { return }
    let origin = SemanticOrigin(x: assistiveOriginX, y: assistiveOriginY)
    let expressed = UniverseRuntime.shared.commitAssistive(
      id: value,
      verb: verb,
      intensity: assistiveIntensity,
      origin: origin
    )
    let grammarVerb = UniverseRuntime.grammarVerb(for: verb)
    onSemanticCommand([
      "verb": grammarVerb.rawValue,
      "semanticVerb": rawVerb,
      "layer": "accessibility",
      "source": "assistive",
      "intensity": assistiveIntensity,
      "answered": expressed,
    ])
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    input?.setEnabled(enabled && window != nil)
    if window == nil { cancelPencilHover() }
  }

  private func materialPoint(viewX: Double, viewY: Double) -> SemanticOrigin {
    MaterialProjection.materialPoint(
      viewX: viewX,
      viewY: viewY,
      viewportWidth: Double(bounds.width),
      viewportHeight: Double(bounds.height)
    )
  }

  private func contactTarget(at point: SemanticOrigin) -> NativeContactTarget {
    guard UniverseRuntime.shared.isSolarScene else { return .material }
    if let id = UniverseRuntime.shared.targetBodyID(at: point) { return .body(id: id) }
    return .openSky
  }

  /// Hover is an invitation, never an act. Open sky receives the same typed
  /// accretion preview as a press, but exiting or crossing a body always sends
  /// cancel, so neither authority nor the React trail can advance.
  private func receivePencil(_ sample: NativePencilSample) {
    guard sample.hovering else { return }
    guard UniverseRuntime.shared.isSolarScene else {
      cancelPencilHover()
      return
    }
    let point = materialPoint(viewX: sample.x, viewY: sample.y)
    let endsHover = sample.phase == .release || sample.phase == .cancel
      || contactTarget(at: point).bodyID != nil
    if endsHover {
      cancelPencilHover()
      return
    }

    let now = CACurrentMediaTime()
    let phase: SemanticGesturePhase
    if pencilHoverActive {
      phase = .tick
    } else {
      pencilHoverActive = true
      pencilHoverStartedAt = now
      phase = .enter
    }
    lastPencilHoverPoint = point
    UniverseRuntime.shared.previewPencilHover(SemanticContactPayload(
      phase: phase,
      point: point,
      durationSeconds: min(now - pencilHoverStartedAt, 0.75),
      normalizedPressure: sample.pressure,
      azimuth: sample.azimuth,
      altitude: sample.altitude,
      targetBodyID: nil
    ))
  }

  private func cancelPencilHover() {
    guard pencilHoverActive else { return }
    pencilHoverActive = false
    UniverseRuntime.shared.previewPencilHover(SemanticContactPayload(
      phase: .cancel,
      point: lastPencilHoverPoint,
      durationSeconds: max(0, CACurrentMediaTime() - pencilHoverStartedAt),
      targetBodyID: nil
    ))
  }

  private func receive(_ routed: RoutedCommand) {
    let origin = GestureRouter.contact(from: routed.shape).map { contact in
      MaterialProjection.materialPoint(
        viewX: contact.x,
        viewY: contact.y,
        viewportWidth: Double(bounds.width),
        viewportHeight: Double(bounds.height)
      )
    }
    let payload = semanticPayload(for: routed, origin: origin)
    let expressed = UniverseRuntime.shared.commit(routed, origin: origin, payload: payload)
    guard routed.isCommitBoundary else { return }
    onSemanticCommand([
      "verb": routed.verb.rawValue,
      "semanticVerb": GestureRouter.semanticVerb(for: routed.verb).rawValue,
      "layer": routed.layer.rawValue,
      "source": routed.source.rawValue,
      "intensity": routed.intensity,
      // Whether the medium said it in its own material, rather than only in
      // the hand and the ear. The guide gates on this.
      "answered": expressed,
    ])
  }

  private func semanticPayload(
    for routed: RoutedCommand,
    origin: SemanticOrigin?
  ) -> SemanticCommandPayload {
    guard let origin else { return .empty }

    if case let .hold(_, elapsedMs, _, _, _, phase, pressure, altitude, azimuth, target) = routed.shape {
      return SemanticCommandPayload(contact: SemanticContactPayload(
        phase: Self.semanticPhase(phase),
        point: origin,
        durationSeconds: elapsedMs / 1_000,
        normalizedPressure: pressure,
        azimuth: azimuth,
        altitude: altitude,
        targetBodyID: target.bodyID
      ))
    }

    if case let .tap(_, _, _, _, _, target) = routed.shape {
      return SemanticCommandPayload(contact: SemanticContactPayload(
        phase: .release,
        point: origin,
        durationSeconds: 0,
        targetBodyID: target.bodyID
      ))
    }

    guard case let .drag(_, phase, totalDx, totalDy, vx, vy, _, _, target) = routed.shape else {
      return .empty
    }

    let viewportWidth = Double(bounds.width)
    let viewportHeight = Double(bounds.height)
    let translation = MaterialProjection.materialVector(
      viewX: totalDx,
      viewY: totalDy,
      viewportWidth: viewportWidth,
      viewportHeight: viewportHeight
    )
    let velocity = MaterialProjection.materialVector(
      viewX: vx,
      viewY: vy,
      viewportWidth: viewportWidth,
      viewportHeight: viewportHeight
    )
    return SemanticCommandPayload(drag: SemanticDragPayload(
      phase: Self.semanticPhase(phase),
      point: origin,
      translation: translation,
      velocity: velocity,
      targetBodyID: target.bodyID
    ))
  }

  private static func semanticPhase(_ phase: GesturePhase) -> SemanticGesturePhase {
    switch phase {
    case .enter: .enter
    case .tick: .tick
    case .release: .release
    case .cancel: .cancel
    }
  }
}
