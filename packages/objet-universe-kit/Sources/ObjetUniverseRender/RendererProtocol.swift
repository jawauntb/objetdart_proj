public enum RendererKind: String, CaseIterable, Sendable {
  case metal
  case realityKit
  case skiaOverlay
}

public protocol UniverseRenderer: AnyObject {
  var kind: RendererKind { get }
  func prepare()
  func resume()
  func render(interpolation: Double)
  func suspend()
  func retire()
}

/// One authoritative surface, handed to the renderers without a copy.
///
/// `values` points at the kernel's live field and is valid only for the
/// duration of the `submitField` call — a renderer uploads from it and keeps
/// numbers, never the pointer. That is what keeps the frame path free of
/// per-frame allocation.
public struct FieldSubmission {
  public let values: UnsafePointer<Float>
  public let width: Int
  public let height: Int
  /// Authoritative seconds the field has lived, from the kernel's own clock.
  public let elapsedSeconds: Double
  /// Length of one authoritative step, so a renderer can carry the frame's
  /// interpolation forward instead of drawing the same instant twice.
  public let secondsPerStep: Double
  /// Reciprocal of the field's recent peak amplitude. Perceptual gain only.
  public let exposure: Double

  public init(
    values: UnsafePointer<Float>,
    width: Int,
    height: Int,
    elapsedSeconds: Double,
    secondsPerStep: Double,
    exposure: Double
  ) {
    self.values = values
    self.width = width
    self.height = height
    self.elapsedSeconds = elapsedSeconds
    self.secondsPerStep = secondsPerStep
    self.exposure = exposure
  }
}

/// A renderer whose material *is* a field the active kernel owns. Renderers
/// that draw entities or overlays simply do not conform, and `RenderHost`
/// passes them by.
public protocol FieldSurfaceRenderer: UniverseRenderer {
  func submitField(_ submission: FieldSubmission)
}
