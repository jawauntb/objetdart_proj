#if canImport(Metal)
import Foundation
import Metal

/// One cache miss owns the expensive build while peers for that same key wait
/// for its result. The process-wide cache lock remains free for unrelated
/// scenes, so a background Cell compile can never stall a ready Wave lookup.
private final class MetalPendingArtifact<Value>: @unchecked Sendable {
  private let group = DispatchGroup()
  private let lock = NSLock()
  private var result: Result<Value, Error>?

  init() {
    group.enter()
  }

  func succeed(_ value: Value) {
    complete(.success(value))
  }

  func fail(_ error: Error) {
    complete(.failure(error))
  }

  func wait() throws -> Value {
    group.wait()
    lock.lock()
    let result = self.result
    lock.unlock()
    guard let result else {
      preconditionFailure("a completed Metal artifact build must publish a result")
    }
    return try result.get()
  }

  private func complete(_ result: Result<Value, Error>) {
    lock.lock()
    self.result = result
    lock.unlock()
    group.leave()
  }
}

/// Process-wide immutable Metal artifacts. Scene handoffs may replace a
/// renderer, but they must not compile the same shader source again.
final class MetalPipelineCache: @unchecked Sendable {
  static let shared = MetalPipelineCache()

  private let lock = NSLock()
  private var libraries: [String: MTLLibrary] = [:]
  private var pipelines: [String: MTLRenderPipelineState] = [:]
  private var pendingLibraries: [String: MetalPendingArtifact<MTLLibrary>] = [:]
  private var pendingPipelines: [String: MetalPendingArtifact<MTLRenderPipelineState>] = [:]

  private init() {}

  func library(
    namespace: String,
    device: MTLDevice,
    source: String
  ) throws -> MTLLibrary {
    let key = "\(device.registryID):\(namespace)"
    lock.lock()
    if let library = libraries[key] {
      lock.unlock()
      return library
    }
    if let pending = pendingLibraries[key] {
      lock.unlock()
      return try pending.wait()
    }
    let pending = MetalPendingArtifact<MTLLibrary>()
    pendingLibraries[key] = pending
    lock.unlock()

    do {
      let library = try device.makeLibrary(source: source, options: nil)
      lock.lock()
      libraries[key] = library
      pendingLibraries[key] = nil
      lock.unlock()
      pending.succeed(library)
      return library
    } catch {
      lock.lock()
      pendingLibraries[key] = nil
      lock.unlock()
      pending.fail(error)
      throw error
    }
  }

  func pipeline(
    namespace: String,
    device: MTLDevice,
    pixelFormat: MTLPixelFormat,
    make: () throws -> MTLRenderPipelineState
  ) throws -> MTLRenderPipelineState {
    let key = "\(device.registryID):\(pixelFormat.rawValue):\(namespace)"
    lock.lock()
    if let pipeline = pipelines[key] {
      lock.unlock()
      return pipeline
    }
    if let pending = pendingPipelines[key] {
      lock.unlock()
      return try pending.wait()
    }
    let pending = MetalPendingArtifact<MTLRenderPipelineState>()
    pendingPipelines[key] = pending
    lock.unlock()

    do {
      let pipeline = try make()
      lock.lock()
      pipelines[key] = pipeline
      pendingPipelines[key] = nil
      lock.unlock()
      pending.succeed(pipeline)
      return pipeline
    } catch {
      lock.lock()
      pendingPipelines[key] = nil
      lock.unlock()
      pending.fail(error)
      throw error
    }
  }
}
#endif
