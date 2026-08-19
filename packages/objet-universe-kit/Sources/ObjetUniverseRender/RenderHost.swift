public final class RenderHost {
  public private(set) var clockStarts = 0
  public private(set) var renderedFrameCount = 0
  public var activeRendererCount: Int { running ? renderers.count : 0 }

  private var renderers: [RendererKind: UniverseRenderer] = [:]
  private var running = false

  public init() {}

  public func install(_ renderer: UniverseRenderer) {
    renderers[renderer.kind]?.retire()
    renderers[renderer.kind] = renderer
    renderer.prepare()
    if running { renderer.resume() }
  }

  public func resume() {
    guard !running else { return }
    running = true
    clockStarts += 1
    renderers.values.forEach { $0.resume() }
  }

  public func render(interpolation: Double) {
    guard running else { return }
    let clamped = min(1, max(0, interpolation))
    renderers.values.forEach { $0.render(interpolation: clamped) }
    renderedFrameCount += 1
  }

  public func suspend() {
    guard running else { return }
    running = false
    renderers.values.forEach { $0.suspend() }
  }

  public func retireAll() {
    suspend()
    renderers.values.forEach { $0.retire() }
    renderers.removeAll()
  }
}
