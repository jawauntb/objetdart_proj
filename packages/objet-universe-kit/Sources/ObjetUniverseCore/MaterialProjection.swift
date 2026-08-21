import Foundation

/// The one geometry law shared by the hand and the shader.
///
/// The tank is square and the screen is not. `WaveShaderSource` resolves that
/// by aspect-*fill*: it crops the short axis rather than letterboxing, so
/// wavelength stays isotropic and the sea reaches both edges. A touch has to
/// be cropped by exactly the same amount or the ring lands where the finger
/// is not — at 390 × 844 the left edge of the screen is `x ≈ 0.27` of the
/// field, not `x = 0`, and a quarter of the tank's width is off-screen on
/// each side.
///
/// So the projection is stated once, here, and both halves read it: the input
/// layer projects contact into the material's frame before a
/// `SemanticCommand` is built, and the fragment shader performs the identical
/// transform on its varying. A kernel therefore never sees a screen
/// coordinate, and no renderer detail crosses the semantic boundary.
public enum MaterialProjection {
  /// Project a point given in the view's own normalized frame — `(0, 0)` at
  /// the top-left of the surface the visitor touched — onto the square
  /// material behind it.
  ///
  /// A viewport with a non-finite or non-positive axis has no legible
  /// mapping; the centre is the honest answer rather than an invented one.
  public static func materialPoint(
    viewX: Double,
    viewY: Double,
    viewportWidth: Double,
    viewportHeight: Double
  ) -> SemanticOrigin {
    guard
      viewX.isFinite, viewY.isFinite,
      viewportWidth.isFinite, viewportHeight.isFinite,
      viewportWidth > 0, viewportHeight > 0
    else { return .centre }
    let longest = max(viewportWidth, viewportHeight)
    let coverX = viewportWidth / longest
    let coverY = viewportHeight / longest
    return SemanticOrigin(
      x: (viewX - 0.5) * coverX + 0.5,
      y: (viewY - 0.5) * coverY + 0.5
    )
  }
}
