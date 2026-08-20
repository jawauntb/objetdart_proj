import ObjetUniverseKit
import QuartzCore
import UIKit

/// The display link retains its target, so the target cannot be the input
/// layer itself: a press interrupted by a teardown would keep the run loop
/// awake, deepening a hold nobody is making. Same shape as
/// `ObjetUniverseView.DisplayLinkTarget`, and the same reason.
private final class HoldLinkTarget: NSObject {
  weak var input: SurfaceInput?

  @objc func tick(_ link: CADisplayLink) {
    MainActor.assumeIsolated { input?.deepenHold(at: link.timestamp) }
  }
}

/// U5's other half: the contact that reaches `GestureRouter`.
///
/// The router has always been able to say what a shape *means*. Nothing was
/// ever making shapes — no recogniser was attached to any view — so the first
/// screen was a sea that could not be touched. This file is the wiring, and
/// only the wiring: it normalises UIKit recognisers into `NativeGestureShape`
/// and hands each one to the router. It decides no verb, holds no threshold
/// of its own, and reads every number from `NativeGestureThresholds`.
///
/// Three rules it keeps, because the grammar is site-wide:
///
///  - **Finger count addresses the stack.** One finger is the material, two
///    the representation, three the world-law. Each count gets its own
///    recogniser so the router never has to guess.
///  - **Duration and intensity are axes.** A press emits a `hold` tick at the
///    wire contract's sample rate for as long as it is held, so the answer
///    keeps deepening, and the ceremony is committed on release rather than
///    fired on the way past the threshold.
///  - **The train is climbed, not counted.** Every tap asks the router for
///    its rung, so a fifth tap inside `tapTrainMs` reaches the material as a
///    fifth tap and not as a first one.
@MainActor
final class SurfaceInput: NSObject, UIGestureRecognizerDelegate {
  /// What a plain contact carries when the hardware reports no force. Modern
  /// iPhones have no force digitiser, so a tap would otherwise always land at
  /// zero and read as a dead surface; the train is what deepens it from here.
  private static let plainContactIntensity: Double = 0.45

  private weak var surface: UIView?
  private let router: GestureRouter
  private let sampleSeconds: Double = 1 / NativeGestureThresholds.continuousSampleHz

  private var recognisers: [UIGestureRecognizer] = []

  // One press at a time: the display link is what makes duration an axis.
  private let holdLinkTarget = HoldLinkTarget()
  private var holdLink: CADisplayLink?
  private var holdStartedAt: CFTimeInterval = 0
  private var holdSampledAt: CFTimeInterval = 0
  /// Contact point in the surface's own coordinates, normalised only at the
  /// moment a shape is built.
  private var holdPoint: CGPoint = .zero
  private var holdFingers = 1

  // Continuous sampling clocks.
  private var dragSampledAt: CFTimeInterval = 0
  private var dragLastPoint: CGPoint = .zero
  private var twistSampledAt: CFTimeInterval = 0
  private var pinchSampledAt: CFTimeInterval = 0

  init(surface: UIView, router: GestureRouter) {
    self.surface = surface
    self.router = router
    super.init()
    holdLinkTarget.input = self
    install(on: surface)
  }

  /// Stop answering contact.
  ///
  /// The route closes the surface while a sheet is open — the design contract
  /// pauses authoritative intervention while the visitor is reading, and a
  /// press that survived the sheet opening would keep charging the water
  /// behind it — and the view closes it when it leaves the window. Closing
  /// retires the hold's display link, which is the one thing here that could
  /// outlive its surface: a `UIView` deinit is nonisolated and could not do
  /// it later.
  func setEnabled(_ enabled: Bool) {
    for recogniser in recognisers { recogniser.isEnabled = enabled }
    if !enabled { stopHold(committing: false) }
  }

  private func install(on view: UIView) {
    for fingers in 1 ... 3 {
      let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
      tap.numberOfTouchesRequired = fingers
      tap.numberOfTapsRequired = 1
      // The train is time-based, not recogniser-based: a second tap has to
      // land as its own contact so the material answers every one of them.
      tap.delaysTouchesEnded = false
      add(tap, on: view)
    }

    for fingers in [1, 3] {
      let press = UILongPressGestureRecognizer(target: self, action: #selector(handlePress(_:)))
      press.minimumPressDuration = NativeGestureThresholds.dwellMs / 1_000
      press.allowableMovement = NativeGestureThresholds.moveTolPx
      press.numberOfTouchesRequired = fingers
      add(press, on: view)
    }

    for fingers in [1, 3] {
      let drag = UIPanGestureRecognizer(target: self, action: #selector(handleDrag(_:)))
      drag.minimumNumberOfTouches = fingers
      drag.maximumNumberOfTouches = fingers
      add(drag, on: view)
    }

    add(UIRotationGestureRecognizer(target: self, action: #selector(handleTwist(_:))), on: view)
    add(UIPinchGestureRecognizer(target: self, action: #selector(handlePinch(_:))), on: view)
  }

  private func add(_ recogniser: UIGestureRecognizer, on view: UIView) {
    // The chrome above this surface is React's, and it keeps its own touches:
    // cancelling them here would take the `?` away from the visitor in order
    // to give the water a gesture it never received.
    recogniser.cancelsTouchesInView = false
    recogniser.delaysTouchesBegan = false
    recogniser.delegate = self
    view.addGestureRecognizer(recogniser)
    recognisers.append(recogniser)
  }

  // MARK: - Recognisers

  @objc private func handleTap(_ recogniser: UITapGestureRecognizer) {
    guard recogniser.state == .ended, let view = surface else { return }
    guard let point = normalised(recogniser.location(in: view)) else { return }
    let rung = router.advanceTapTrain()
    // The rung is the ladder: a train reaches the material as one deeper
    // strike, never as thirty identical ones.
    let intensity = min(
      1,
      SurfaceInput.plainContactIntensity + 0.5 * GestureRouter.tapTrainDepth(rung)
    )
    emit(
      .tap(
        fingers: recogniser.numberOfTouchesRequired,
        count: rung,
        x: point.x,
        y: point.y,
        intensity: intensity
      )
    )
  }

  @objc private func handlePress(_ recogniser: UILongPressGestureRecognizer) {
    guard let view = surface else { return }
    switch recogniser.state {
    case .began:
      holdFingers = recogniser.numberOfTouchesRequired
      holdPoint = recogniser.location(in: view)
      // The recogniser only speaks once the dwell threshold has passed, so
      // the contact began `dwellMs` ago; elapsed time is measured from there
      // rather than from now.
      let now = CACurrentMediaTime()
      holdStartedAt = now - NativeGestureThresholds.dwellMs / 1_000
      holdSampledAt = now
      emitHold(phase: .enter, elapsedMs: NativeGestureThresholds.dwellMs)
      startLink()
    case .changed:
      holdPoint = recogniser.location(in: view)
    case .ended, .cancelled, .failed:
      stopHold(committing: recogniser.state == .ended)
    default:
      break
    }
  }

  @objc private func handleDrag(_ recogniser: UIPanGestureRecognizer) {
    guard let view = surface else { return }
    let raw = recogniser.location(in: view)
    guard let point = normalised(raw) else { return }
    let fingers = recogniser.minimumNumberOfTouches
    let now = CACurrentMediaTime()
    let velocity = recogniser.velocity(in: view)
    // px/ms — the unit `flickVel` is stated in.
    let vx = Double(velocity.x) / 1_000
    let vy = Double(velocity.y) / 1_000

    switch recogniser.state {
    case .began:
      dragSampledAt = now
      dragLastPoint = raw
    case .changed:
      guard now - dragSampledAt >= sampleSeconds else { return }
      dragSampledAt = now
      let dx = Double(raw.x - dragLastPoint.x)
      let dy = Double(raw.y - dragLastPoint.y)
      dragLastPoint = raw
      emit(.drag(fingers: fingers, dx: dx, dy: dy, vx: vx, vy: vy, x: point.x, y: point.y))
    case .ended:
      let speed = (vx * vx + vy * vy).squareRoot()
      guard speed >= NativeGestureThresholds.flickVel else { return }
      emit(.flick(fingers: fingers, speed: speed, angle: atan2(vy, vx), x: point.x, y: point.y))
    default:
      break
    }
  }

  @objc private func handleTwist(_ recogniser: UIRotationGestureRecognizer) {
    guard recogniser.state == .changed || recogniser.state == .ended else { return }
    let angle = Double(recogniser.rotation)
    guard abs(angle) >= NativeGestureThresholds.twistDeadzoneRad else { return }
    let now = CACurrentMediaTime()
    guard now - twistSampledAt >= sampleSeconds else { return }
    twistSampledAt = now
    // UIKit's rotation recogniser is a two-finger instrument, and it reports
    // no touches at all once the gesture has ended. Three-finger twist — the
    // season — therefore stays unbound until a custom recogniser lands, and
    // the guide says so rather than the code pretending otherwise.
    emit(
      .twist(
        fingers: max(2, recogniser.numberOfTouches),
        angleRad: angle,
        velocity: Double(recogniser.velocity)
      )
    )
  }

  @objc private func handlePinch(_ recogniser: UIPinchGestureRecognizer) {
    guard recogniser.state == .changed || recogniser.state == .ended else { return }
    let scale = Double(recogniser.scale)
    guard abs(scale - 1) >= NativeGestureThresholds.pinchDeadzone else { return }
    let now = CACurrentMediaTime()
    guard now - pinchSampledAt >= sampleSeconds else { return }
    pinchSampledAt = now
    emit(.pinch(scale: scale, velocity: Double(recogniser.velocity)))
  }

  // MARK: - The hold, deepening

  private func startLink() {
    stopLink()
    let link = CADisplayLink(target: holdLinkTarget, selector: #selector(HoldLinkTarget.tick(_:)))
    link.add(to: .main, forMode: .common)
    holdLink = link
  }

  fileprivate func deepenHold(at now: CFTimeInterval) {
    guard holdLink != nil, now - holdSampledAt >= sampleSeconds else { return }
    holdSampledAt = now
    emitHold(phase: .tick, elapsedMs: (now - holdStartedAt) * 1_000)
  }

  private func stopHold(committing: Bool) {
    guard holdLink != nil else { return }
    stopLink()
    let elapsedMs = (CACurrentMediaTime() - holdStartedAt) * 1_000
    // A cancelled press — the sheet opened, a call arrived — still settles,
    // but it never commits the ceremony: the solemn act belongs to a hand
    // that let go on purpose.
    emitHold(
      phase: .release,
      elapsedMs: committing ? elapsedMs : min(elapsedMs, NativeGestureThresholds.ceremonyMs - 1)
    )
  }

  private func stopLink() {
    holdLink?.invalidate()
    holdLink = nil
  }

  private func emitHold(phase: GesturePhase, elapsedMs: Double) {
    guard let point = normalised(holdPoint) else { return }
    // Duration is the axis: a press keeps arriving harder for as long as it
    // is held, reaching full weight at the ceremony threshold.
    let intensity = min(1, max(0, elapsedMs / NativeGestureThresholds.ceremonyMs))
    emit(
      .hold(
        fingers: holdFingers,
        elapsedMs: elapsedMs,
        x: point.x,
        y: point.y,
        intensity: intensity,
        phase: phase
      )
    )
  }

  // MARK: - Plumbing

  private func emit(_ shape: NativeGestureShape) {
    router.route(shape: shape, source: .touch, logicalTimeMs: CACurrentMediaTime() * 1_000)
  }

  /// Contact in the surface's own normalised frame. The projection onto the
  /// material happens once, later, through `MaterialProjection` — the same
  /// law the shader reads — so this stays a plain reading of where the finger
  /// landed.
  private func normalised(_ point: CGPoint) -> (x: Double, y: Double)? {
    guard let view = surface else { return nil }
    let bounds = view.bounds
    guard bounds.width > 0, bounds.height > 0 else { return nil }
    return (Double(point.x / bounds.width), Double(point.y / bounds.height))
  }

  // MARK: - UIGestureRecognizerDelegate

  /// A twist and a pinch are one two-finger act read two ways, and the
  /// grammar gives them different layers; they have to be allowed to run
  /// together or the second one never fires. A press and a stroke overlap the
  /// same way — the press charges, the stroke moves what it charged.
  /// Everything else is separated by finger count already.
  func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer,
    shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
  ) -> Bool {
    true
  }
}
