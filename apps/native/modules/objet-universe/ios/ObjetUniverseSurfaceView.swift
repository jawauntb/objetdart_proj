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
