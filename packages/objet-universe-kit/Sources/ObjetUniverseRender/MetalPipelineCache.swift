#if canImport(Metal)
import Foundation
import Metal

/// Process-wide immutable Metal artifacts. Scene handoffs may replace a
/// renderer, but they must not compile the same shader source again.
final class MetalPipelineCache: @unchecked Sendable {
  static let shared = MetalPipelineCache()

  private let lock = NSLock()
  private var libraries: [String: MTLLibrary] = [:]
  private var pipelines: [String: MTLRenderPipelineState] = [:]

  private init() {}

  func library(
    namespace: String,
    device: MTLDevice,
    source: String
  ) throws -> MTLLibrary {
    let key = "\(device.registryID):\(namespace)"
    lock.lock()
    defer { lock.unlock() }
    if let library = libraries[key] { return library }
    let library = try device.makeLibrary(source: source, options: nil)
    libraries[key] = library
    return library
  }

  func pipeline(
    namespace: String,
    device: MTLDevice,
    pixelFormat: MTLPixelFormat,
    make: () throws -> MTLRenderPipelineState
  ) rethrows -> MTLRenderPipelineState {
    let key = "\(device.registryID):\(pixelFormat.rawValue):\(namespace)"
    lock.lock()
    defer { lock.unlock() }
    if let pipeline = pipelines[key] { return pipeline }
    let pipeline = try make()
    pipelines[key] = pipeline
    return pipeline
  }
}
#endif
