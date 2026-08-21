import ExpoModulesCore
import ObjetUniverseKit
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
    input = SurfaceInput(surface: self, router: router)
  }

  /// The route closes the surface while a reading surface is open: the
  /// documented state contract pauses authoritative intervention while the
  /// guide sheet has focus.
  public func setEnabled(_ value: Bool) {
    enabled = value
    input?.setEnabled(value && window != nil)
  }

  public func setRepresentation(_ value: Int) {
    UniverseRuntime.shared.setRepresentation(value)
  }

  public func setMaxRepresentation(_ value: Int) {
    UniverseRuntime.shared.setMaximumRepresentation(value)
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
    let expressed = UniverseRuntime.shared.commit(routed, origin: origin)
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
}
