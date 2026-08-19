public final class RendererProbe: UniverseRenderer {
  public let kind: RendererKind
  public private(set) var prepareCount = 0
  public private(set) var resumeCount = 0
  public private(set) var renderCount = 0
  public private(set) var lastInterpolation: Double?
  public private(set) var suspendCount = 0
  public private(set) var retireCount = 0

  public init(kind: RendererKind) { self.kind = kind }
  public func prepare() { prepareCount += 1 }
  public func resume() { resumeCount += 1 }
  public func render(interpolation: Double) {
    renderCount += 1
    lastInterpolation = interpolation
  }
  public func suspend() { suspendCount += 1 }
  public func retire() { retireCount += 1 }
}
