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
