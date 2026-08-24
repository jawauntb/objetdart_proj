#if canImport(Metal) && canImport(QuartzCore)
import Dispatch
import Foundation
import Metal
#if SWIFT_PACKAGE
import ObjetUniverseCore
#endif
import QuartzCore
import simd

/// Swift's half of the molecule shader ABI. The phone-scale Metal fixture
/// imports this layout, so visual proof and shipping presentation cannot drift.
struct MoleculeShaderUniforms {
  var viewport = SIMD2<Float>(1, 1)
  var elapsed: Float = 0
  var frozenElapsed: Float = 0
  var reactionEnergy: Float = 0
  var representation: UInt32 = 0
  var reducedMotion: UInt32 = 0
  var breathSeconds: Float = Float(WaveField.breathSeconds)
}

/// Fixed GPU record copied from one borrowed compound record.
struct MoleculeGPUBody {
  /// material x, material y, vibration, compound register index
  var positionVibration = SIMD4<Float>(repeating: 0)
  /// geometry family, atom count, x velocity, y velocity
  var geometryVelocity = SIMD4<Float>(repeating: 0)
}

struct MoleculePipelineBundle {
  let background: MTLRenderPipelineState
  let body: MTLRenderPipelineState
}

final class MoleculePipelineCompiler: @unchecked Sendable {
  private let device: MTLDevice

  init(device: MTLDevice) {
    self.device = device
  }

  func makePipelines(pixelFormat: MTLPixelFormat) throws -> MoleculePipelineBundle {
    let library = try MetalPipelineCache.shared.library(
      namespace: "molecules-v1",
      device: device,
      source: MoleculeShaderSource.metal
    )
    return try MoleculePipelineBundle(
      background: makePipeline(
        library: library,
        vertex: "objet_molecules_fullscreen_vertex",
        fragment: "objet_molecules_background_fragment",
        blending: false,
        cacheName: "molecules-background-v1",
        pixelFormat: pixelFormat
      ),
      body: makePipeline(
        library: library,
        vertex: "objet_molecules_body_vertex",
        fragment: "objet_molecules_body_fragment",
        blending: true,
        cacheName: "molecules-body-v1",
        pixelFormat: pixelFormat
      )
    )
  }

  private func makePipeline(
    library: MTLLibrary,
    vertex: String,
    fragment: String,
    blending: Bool,
    cacheName: String,
    pixelFormat: MTLPixelFormat
  ) throws -> MTLRenderPipelineState {
    try MetalPipelineCache.shared.pipeline(
      namespace: cacheName,
      device: device,
      pixelFormat: pixelFormat
    ) {
      let descriptor = MTLRenderPipelineDescriptor()
      descriptor.vertexFunction = library.makeFunction(name: vertex)
      descriptor.fragmentFunction = library.makeFunction(name: fragment)
      descriptor.colorAttachments[0].pixelFormat = pixelFormat
      if blending {
        let attachment = descriptor.colorAttachments[0]!
        attachment.isBlendingEnabled = true
        attachment.sourceRGBBlendFactor = .sourceAlpha
        attachment.destinationRGBBlendFactor = .oneMinusSourceAlpha
        attachment.sourceAlphaBlendFactor = .one
        attachment.destinationAlphaBlendFactor = .oneMinusSourceAlpha
      }
      return try device.makeRenderPipelineState(descriptor: descriptor)
    }
  }
}

/// A compound renderer, not a scalar chemistry tint. Every point is an
/// authoritative molecule whose visual grammar comes from its shape, formula
/// atom count, vibration, and reaction ledger.
public final class MoleculeRenderer: MoleculeSystemRenderer, ReducedMotionRenderer {
  public let kind: RendererKind = .metal

  private static let maximumBodies = MoleculeKernel.maximumMolecules
  private static let framesInFlight = 3
  private static let pipelinePreparationQueue = DispatchQueue(
    label: "art.objet.molecules-pipeline-preparation",
    qos: .userInitiated
  )

  private final class FrameResources {
    let uniforms: MTLBuffer
    let bodies: MTLBuffer
    var bodyCount = 0
    var secondsPerStep: Double = 0

    init?(device: MTLDevice) {
      guard
        let uniforms = device.makeBuffer(
          length: MemoryLayout<MoleculeShaderUniforms>.stride,
          options: .storageModeShared
        ),
        let bodies = device.makeBuffer(
          length: MemoryLayout<MoleculeGPUBody>.stride * MoleculeRenderer.maximumBodies,
          options: .storageModeShared
        )
      else { return nil }
      self.uniforms = uniforms
      self.bodies = bodies
    }
  }

  private let layer: CAMetalLayer
  private let queue: MTLCommandQueue
  private let pipelineCompiler: MoleculePipelineCompiler
  private let frames: [FrameResources]
  private let frameSlots = MetalFrameSlotPool(capacity: MoleculeRenderer.framesInFlight)
  private let pass = MTLRenderPassDescriptor()
  private let pipelinePublication = MetalPipelinePublication<MoleculePipelineBundle>()
  private let pipelineRetry = MetalPipelineRetryPolicy()
  private var reservedFrameIndex: Int?
  private var running = false
  private var hasPresentedOwnFrame = false
  private var presentationTiming = MetalPresentationTiming()

  public init?(layer: CAMetalLayer) {
    guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else { return nil }
    var frames: [FrameResources] = []
    frames.reserveCapacity(Self.framesInFlight)
    for _ in 0 ..< Self.framesInFlight {
      guard let frame = FrameResources(device: device) else { return nil }
      frames.append(frame)
    }
    self.layer = layer
    self.queue = queue
    pipelineCompiler = MoleculePipelineCompiler(device: device)
    self.frames = frames
    layer.device = device
    layer.pixelFormat = .bgra8Unorm
    layer.framebufferOnly = true
    layer.isOpaque = true
    pass.colorAttachments[0].loadAction = .clear
    pass.colorAttachments[0].storeAction = .store
    pass.colorAttachments[0].clearColor = MTLClearColor(red: 0.0118, green: 0.0157, blue: 0.0392, alpha: 1)
  }

  public func prepare() {
    guard pipelinePublication.beginPreparation() else { return }
    pipelineRetry.recordPreparationAttempt()
    let pixelFormat = layer.pixelFormat
    let compiler = pipelineCompiler
    let publication = pipelinePublication
    Self.pipelinePreparationQueue.async {
      do {
        let pipelines = try compiler.makePipelines(pixelFormat: pixelFormat)
        DispatchQueue.main.async { publication.publish(pipelines) }
      } catch {
        DispatchQueue.main.async { publication.failPreparation() }
      }
    }
  }

  public func resume() {
    prepare()
    running = true
  }

  public func submitMolecules(_ snapshot: MoleculeRenderSnapshot) {
    if reservedFrameIndex == nil {
      guard let acquired = frameSlots.tryAcquire() else { return }
      reservedFrameIndex = acquired
    }
    guard let reservedFrameIndex else { return }
    let frame = frames[reservedFrameIndex]
    let destination = UnsafeMutableBufferPointer(
      start: frame.bodies.contents().bindMemory(to: MoleculeGPUBody.self, capacity: Self.maximumBodies),
      count: Self.maximumBodies
    )
    guard let bodyCount = Self.pack(snapshot, bodies: destination) else {
      releaseReservedFrame()
      return
    }
    var uniforms = Self.makeUniforms(for: snapshot)
    memcpy(frame.uniforms.contents(), &uniforms, MemoryLayout<MoleculeShaderUniforms>.stride)
    frame.bodyCount = bodyCount
    frame.secondsPerStep = snapshot.secondsPerTick
    presentationTiming.recordSubmitted(elapsed: Float(snapshot.elapsedSeconds))
  }

  public func render(interpolation: Double) {
    guard running, let reservedFrameIndex else { return }
    guard let pipelines = pipelinePublication.snapshot() else {
      let readiness = pipelineRetry.nextAction(isPreparing: pipelinePublication.isPreparing())
      releaseReservedFrame()
      if !hasPresentedOwnFrame, presentGround() {
        hasPresentedOwnFrame = true
        return
      }
      switch readiness {
      case .retainCurrentDrawable: break
      case .retryPreparation: prepare()
      case .presentFallback: presentGround()
      }
      return
    }
    pipelineRetry.recordPipelineReady()
    let drawableSize = layer.drawableSize
    guard drawableSize.width >= 1, drawableSize.height >= 1, let drawable = layer.nextDrawable() else {
      releaseReservedFrame()
      return
    }
    let frame = frames[reservedFrameIndex]
    self.reservedFrameIndex = nil
    let uniforms = frame.uniforms.contents().bindMemory(to: MoleculeShaderUniforms.self, capacity: 1)
    uniforms.pointee.viewport = SIMD2<Float>(Float(drawableSize.width), Float(drawableSize.height))
    let sourceElapsed = uniforms.pointee.elapsed + Float(min(max(interpolation, 0), 1) * frame.secondsPerStep)
    uniforms.pointee.elapsed = presentationTiming.presentationElapsed(for: sourceElapsed)
    uniforms.pointee.frozenElapsed = presentationTiming.frozenElapsed
    uniforms.pointee.reducedMotion = presentationTiming.reducedMotion ? 1 : 0
    pass.colorAttachments[0].texture = drawable.texture
    guard
      let command = queue.makeCommandBuffer(),
      let encoder = command.makeRenderCommandEncoder(descriptor: pass)
    else {
      pass.colorAttachments[0].texture = nil
      frameSlots.release(reservedFrameIndex)
      return
    }
    pass.colorAttachments[0].texture = nil
    encoder.setRenderPipelineState(pipelines.background)
    encoder.setFragmentBuffer(frame.uniforms, offset: 0, index: 0)
    encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
    if frame.bodyCount > 0 {
      encoder.setRenderPipelineState(pipelines.body)
      encoder.setVertexBuffer(frame.bodies, offset: 0, index: 0)
      encoder.setVertexBuffer(frame.uniforms, offset: 0, index: 1)
      encoder.setFragmentBuffer(frame.uniforms, offset: 0, index: 0)
      encoder.drawPrimitives(type: .point, vertexStart: 0, vertexCount: frame.bodyCount)
    }
    encoder.endEncoding()
    command.present(drawable)
    hasPresentedOwnFrame = true
    let frameSlots = self.frameSlots
    command.addCompletedHandler { _ in frameSlots.release(reservedFrameIndex) }
    command.commit()
  }

  public func suspend() {
    running = false
    releaseReservedFrame()
    pipelineRetry.resetAfterSuspend()
  }

  public func setReducedMotion(_ enabled: Bool) {
    presentationTiming.setReducedMotion(enabled)
  }

  public func retire() {
    running = false
    releaseReservedFrame()
    pipelinePublication.retire()
  }

  static func acceptsSnapshot(bodyCount: Int) -> Bool {
    bodyCount >= 0 && bodyCount <= Self.maximumBodies
  }

  static func pack(
    _ snapshot: MoleculeRenderSnapshot,
    bodies destination: UnsafeMutableBufferPointer<MoleculeGPUBody>
  ) -> Int? {
    guard Self.acceptsSnapshot(bodyCount: snapshot.bodies.count), destination.count >= Self.maximumBodies else { return nil }
    for index in snapshot.bodies.indices {
      let body = snapshot.bodies[index]
      guard
        body.position.x.isFinite, body.position.y.isFinite,
        body.velocity.x.isFinite, body.velocity.y.isFinite,
        body.vibration.isFinite
      else { return nil }
      destination[index] = MoleculeGPUBody(
        positionVibration: SIMD4<Float>(
          body.position.x,
          body.position.y,
          min(max(body.vibration, 0), 1),
          Float(min(body.compoundIndex, 7))
        ),
        geometryVelocity: SIMD4<Float>(
          Float(body.shape.rawValue),
          Float(min(max(body.atomCount, 2), 5)),
          body.velocity.x,
          body.velocity.y
        )
      )
    }
    return snapshot.bodies.count
  }

  static func makeUniforms(for snapshot: MoleculeRenderSnapshot) -> MoleculeShaderUniforms {
    var uniforms = MoleculeShaderUniforms()
    uniforms.elapsed = Float(snapshot.elapsedSeconds)
    uniforms.reactionEnergy = min(max(snapshot.reactionEnergy, -1_200), 1_200)
    uniforms.representation = UInt32(clamping: snapshot.representation)
    uniforms.breathSeconds = Float(WaveField.breathSeconds)
    return uniforms
  }

  private func releaseReservedFrame() {
    guard let reservedFrameIndex else { return }
    self.reservedFrameIndex = nil
    frameSlots.release(reservedFrameIndex)
  }

  @discardableResult
  private func presentGround() -> Bool {
    let drawableSize = layer.drawableSize
    guard drawableSize.width >= 1, drawableSize.height >= 1, let drawable = layer.nextDrawable() else { return false }
    pass.colorAttachments[0].texture = drawable.texture
    guard
      let command = queue.makeCommandBuffer(),
      let encoder = command.makeRenderCommandEncoder(descriptor: pass)
    else {
      pass.colorAttachments[0].texture = nil
      return false
    }
    pass.colorAttachments[0].texture = nil
    encoder.endEncoding()
    command.present(drawable)
    command.commit()
    return true
  }
}
#endif
