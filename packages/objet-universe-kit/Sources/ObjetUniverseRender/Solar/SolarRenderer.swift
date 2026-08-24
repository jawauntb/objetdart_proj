#if canImport(Metal) && canImport(QuartzCore)
import Foundation
import Metal
#if SWIFT_PACKAGE
import ObjetUniverseCore
#endif
import QuartzCore
import simd

/// A bounded 2.5D solar renderer. Bodies remain authoritative in
/// `SolarKernel`; this object only interpolates and uploads its borrowed render
/// snapshot. All frame storage is allocated during initialization and reused
/// as a three-slot ring.
public final class SolarRenderer: SolarSystemRenderer, SolarCameraRenderer, @unchecked Sendable {
  public let kind: RendererKind = .metal

  private static let maximumBodies = 14
  private static let maximumTrailPoints = 14 * 32
  private static let maximumPredictionPoints = 64
  private static let framesInFlight = 3
  private static let pipelinePreparationQueue = DispatchQueue(
    label: "art.objet.solar-pipeline-preparation",
    qos: .userInitiated
  )

  private struct Uniforms {
    var viewport = SIMD2<Float>(1, 1)
    var cameraScale: Float = Float(SolarPhysics.maximumSemiMajorAxis)
    var cameraRotation: Float = 0
    var cameraPitch: Float = 0.12
    var interpolation: Float = 0
    var elapsed: Float = 0
    var centralMass: Float = 1
    var collisionPulse: Float = 0
    var collisionPosition = SIMD2<Float>(repeating: 0)
    var touchPosition = SIMD2<Float>(repeating: 0)
    var touchPulse: Float = 0
    var touchKind: UInt32 = 0
    var representation: UInt32 = 0
    var bodyCount: UInt32 = 0
    var trailCount: UInt32 = 0
    var predictionCount: UInt32 = 0
  }

  private struct GPUBody {
    var previousPosition = SIMD4<Float>(repeating: 0)
    var positionRadius = SIMD4<Float>(repeating: 0)
    var colourMass = SIMD4<Float>(repeating: 0)
    var velocityKindSelected = SIMD4<Float>(repeating: 0)
  }

  private struct GPUMark {
    var positionAge = SIMD4<Float>(repeating: 0)
    var colourSize = SIMD4<Float>(repeating: 0)
  }

  private final class FrameResources {
    let uniforms: MTLBuffer
    let bodies: MTLBuffer
    let preview: MTLBuffer
    let trails: MTLBuffer
    let prediction: MTLBuffer
    var bodyCount = 0
    var previewCount = 0
    var trailCount = 0
    var predictionCount = 0
    var pathOffsets = [Int](repeating: 0, count: SolarRenderer.maximumBodies)
    var pathCounts = [Int](repeating: 0, count: SolarRenderer.maximumBodies)

    init?(device: MTLDevice) {
      guard
        let uniforms = device.makeBuffer(length: MemoryLayout<Uniforms>.stride, options: .storageModeShared),
        let bodies = device.makeBuffer(
          length: MemoryLayout<GPUBody>.stride * SolarRenderer.maximumBodies,
          options: .storageModeShared
        ),
        let preview = device.makeBuffer(length: MemoryLayout<GPUBody>.stride, options: .storageModeShared),
        let trails = device.makeBuffer(
          length: MemoryLayout<GPUMark>.stride * SolarRenderer.maximumTrailPoints,
          options: .storageModeShared
        ),
        let prediction = device.makeBuffer(
          length: MemoryLayout<GPUMark>.stride * SolarRenderer.maximumPredictionPoints,
          options: .storageModeShared
        )
      else { return nil }
      self.uniforms = uniforms
      self.bodies = bodies
      self.preview = preview
      self.trails = trails
      self.prediction = prediction
    }
  }

  private let layer: CAMetalLayer
  private let device: MTLDevice
  private let queue: MTLCommandQueue
  private let frames: [FrameResources]
  private let frameSlots = MetalFrameSlotPool(capacity: SolarRenderer.framesInFlight)
  private let pass = MTLRenderPassDescriptor()
  private struct PipelineBundle {
    let background: MTLRenderPipelineState
    let orbit: MTLRenderPipelineState
    let mark: MTLRenderPipelineState
    let body: MTLRenderPipelineState
  }
  private let pipelinePublication = MetalPipelinePublication<PipelineBundle>()
  private var reservedFrameIndex: Int?
  private var camera = SolarCameraState()
  private var lastPresentationTimestamp: CFTimeInterval?
  private var running = false
  public private(set) var droppedSubmissionCount = 0

  public init?(layer: CAMetalLayer) {
    guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else { return nil }
    var frames: [FrameResources] = []
    frames.reserveCapacity(Self.framesInFlight)
    for _ in 0 ..< Self.framesInFlight {
      guard let frame = FrameResources(device: device) else { return nil }
      frames.append(frame)
    }
    self.layer = layer
    self.device = device
    self.queue = queue
    self.frames = frames
    layer.device = device
    layer.pixelFormat = .bgra8Unorm
    layer.framebufferOnly = true
    layer.isOpaque = true
    pass.colorAttachments[0].loadAction = .clear
    pass.colorAttachments[0].storeAction = .store
    pass.colorAttachments[0].clearColor = MTLClearColor(red: 0.006, green: 0.009, blue: 0.022, alpha: 1)
  }

  public func prepare() {
    guard pipelinePublication.beginPreparation() else { return }
    let pixelFormat = layer.pixelFormat

    Self.pipelinePreparationQueue.async { [weak self] in
      guard let self else { return }
      do {
        let bundle = try self.makePipelineBundle(pixelFormat: pixelFormat)
        self.pipelinePublication.publish(bundle)
      } catch {
        self.pipelinePublication.failPreparation()
      }
    }
  }

  public func resume() {
    prepare()
    lastPresentationTimestamp = nil
    running = true
  }

  public func submitSolar(_ snapshot: SolarRenderSnapshot) {
    if reservedFrameIndex == nil {
      guard let acquired = frameSlots.tryAcquire() else {
        droppedSubmissionCount += 1
        return
      }
      reservedFrameIndex = acquired
    }
    guard let reservedFrameIndex else { return }
    let frame = frames[reservedFrameIndex]
    let bodyCount = min(snapshot.bodies.count, Self.maximumBodies)
    let trailCount = min(snapshot.trailPoints.count, Self.maximumTrailPoints)
    let predictionCount = min(snapshot.predictionPoints.count, Self.maximumPredictionPoints)

    let bodyDestination = frame.bodies.contents().bindMemory(to: GPUBody.self, capacity: Self.maximumBodies)
    for index in 0 ..< bodyCount {
      let body = snapshot.bodies[index]
      bodyDestination[index] = GPUBody(
        previousPosition: SIMD4<Float>(body.previousPosition, 0),
        positionRadius: SIMD4<Float>(body.position, body.radius),
        colourMass: SIMD4<Float>(body.color, body.mass),
        velocityKindSelected: SIMD4<Float>(
          body.velocity.x,
          body.velocity.y,
          Float(body.kind.rawValue),
          body.isSelected ? 1 : 0
        )
      )
      frame.pathOffsets[index] = min(max(body.trailOffset, 0), trailCount)
      frame.pathCounts[index] = min(max(body.trailCount, 0), trailCount - frame.pathOffsets[index])
    }

    if let preview = snapshot.accretionPreview {
      let progress = min(max(preview.progress, 0), 1)
      let growingRadius = max(preview.radius, 0.035) * (0.35 + progress * 0.65)
      frame.preview.contents().bindMemory(to: GPUBody.self, capacity: 1).pointee = GPUBody(
        previousPosition: SIMD4<Float>(preview.position, 0),
        positionRadius: SIMD4<Float>(preview.position, growingRadius),
        colourMass: SIMD4<Float>(preview.color, 0),
        velocityKindSelected: SIMD4<Float>(0, 0, 3, progress)
      )
      frame.previewCount = 1
    } else {
      frame.previewCount = 0
    }

    let trailDestination = frame.trails.contents().bindMemory(to: GPUMark.self, capacity: Self.maximumTrailPoints)
    for index in 0 ..< trailCount {
      let point = snapshot.trailPoints[index]
      let colour = bodyColour(for: point.bodyID, in: snapshot.bodies, count: bodyCount)
      trailDestination[index] = GPUMark(
        positionAge: SIMD4<Float>(point.position, min(max(point.age, 0), 1)),
        colourSize: SIMD4<Float>(colour, 3.2)
      )
    }

    let predictionDestination = frame.prediction.contents().bindMemory(
      to: GPUMark.self,
      capacity: Self.maximumPredictionPoints
    )
    for index in 0 ..< predictionCount {
      let point = snapshot.predictionPoints[index]
      let progress = Float(index) / Float(max(predictionCount - 1, 1))
      predictionDestination[index] = GPUMark(
        positionAge: SIMD4<Float>(point.position, 0.08 + progress * 0.62),
        colourSize: SIMD4<Float>(0.36, 0.90, 0.82, 4.2)
      )
    }

    var uniforms = Uniforms(
      elapsed: Float(snapshot.elapsedSeconds),
      centralMass: snapshot.centralMass,
      collisionPulse: min(max(snapshot.collisionPulse, 0), 1),
      collisionPosition: SIMD2<Float>(snapshot.collisionPosition.x, snapshot.collisionPosition.y),
      touchPosition: SIMD2<Float>(snapshot.touchPosition.x, snapshot.touchPosition.y),
      touchPulse: min(max(snapshot.touchPulse, 0), 1),
      touchKind: UInt32(snapshot.touchKind.rawValue),
      representation: UInt32(min(max(snapshot.representation, 0), 3)),
      bodyCount: UInt32(bodyCount),
      trailCount: UInt32(trailCount),
      predictionCount: UInt32(predictionCount)
    )
    memcpy(frame.uniforms.contents(), &uniforms, MemoryLayout<Uniforms>.stride)
    frame.bodyCount = bodyCount
    frame.trailCount = trailCount
    frame.predictionCount = predictionCount
  }

  public func orientSolarCamera(
    by translation: SemanticVector,
    velocity: SemanticVector,
    phase: SemanticGesturePhase
  ) {
    camera.apply(translation: translation, velocity: velocity, phase: phase)
  }

  public func projectSolarMaterialPoint(_ point: SemanticOrigin) -> SemanticOrigin {
    camera.projectMaterialPoint(point)
  }

  public func projectSolarMaterialVector(_ vector: SemanticVector) -> SemanticVector {
    camera.projectMaterialVector(vector)
  }

  public func render(interpolation: Double) {
    guard running, let reservedFrameIndex else { return }
    guard let pipelines = preparedPipelines() else {
      releaseReservedFrame()
      return
    }
    let drawableSize = layer.drawableSize
    guard drawableSize.width >= 1, drawableSize.height >= 1, let drawable = layer.nextDrawable() else {
      releaseReservedFrame()
      return
    }

    let frame = frames[reservedFrameIndex]
    self.reservedFrameIndex = nil
    let uniforms = frame.uniforms.contents().bindMemory(to: Uniforms.self, capacity: 1)
    let now = CACurrentMediaTime()
    let delta = lastPresentationTimestamp.map { now - $0 } ?? (1.0 / 60.0)
    lastPresentationTimestamp = now
    camera.advancePresentationFrame(deltaSeconds: delta)
    uniforms.pointee.viewport = SIMD2<Float>(Float(drawableSize.width), Float(drawableSize.height))
    uniforms.pointee.cameraRotation = Float(camera.yaw)
    uniforms.pointee.cameraPitch = Float(camera.pitch)
    uniforms.pointee.interpolation = Float(min(max(interpolation, 0), 1))
    pass.colorAttachments[0].texture = drawable.texture

    guard let commandBuffer = queue.makeCommandBuffer(), let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: pass) else {
      pass.colorAttachments[0].texture = nil
      frameSlots.release(reservedFrameIndex)
      return
    }
    // The encoder retains its attachments. Clearing the reusable descriptor
    // here prevents it from holding a presented CAMetalDrawable until the next
    // call to `nextDrawable()`.
    pass.colorAttachments[0].texture = nil
    encoder.setRenderPipelineState(pipelines.background)
    encoder.setFragmentBuffer(frame.uniforms, offset: 0, index: 0)
    encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)

    let representation = uniforms.pointee.representation
    if representation <= 1 {
      encoder.setRenderPipelineState(pipelines.orbit)
      encoder.setVertexBuffer(frame.trails, offset: 0, index: 0)
      encoder.setVertexBuffer(frame.uniforms, offset: 0, index: 1)
      for bodyIndex in 0 ..< frame.bodyCount where frame.pathCounts[bodyIndex] > 1 {
        encoder.drawPrimitives(type: .lineStrip, vertexStart: frame.pathOffsets[bodyIndex], vertexCount: frame.pathCounts[bodyIndex])
      }
    }

    if representation == 1 {
      encoder.setRenderPipelineState(pipelines.mark)
      encoder.setVertexBuffer(frame.trails, offset: 0, index: 0)
      encoder.setVertexBuffer(frame.uniforms, offset: 0, index: 1)
      if frame.trailCount > 0 {
        encoder.drawPrimitives(type: .point, vertexStart: 0, vertexCount: frame.trailCount)
      }
      encoder.setVertexBuffer(frame.prediction, offset: 0, index: 0)
      if frame.predictionCount > 0 {
        encoder.drawPrimitives(type: .point, vertexStart: 0, vertexCount: frame.predictionCount)
      }
    }

    encoder.setRenderPipelineState(pipelines.body)
    encoder.setVertexBuffer(frame.preview, offset: 0, index: 0)
    encoder.setVertexBuffer(frame.uniforms, offset: 0, index: 1)
    if frame.previewCount > 0 {
      encoder.drawPrimitives(type: .point, vertexStart: 0, vertexCount: frame.previewCount)
    }
    encoder.setVertexBuffer(frame.bodies, offset: 0, index: 0)
    encoder.setVertexBuffer(frame.uniforms, offset: 0, index: 1)
    if frame.bodyCount > 0 {
      encoder.drawPrimitives(type: .point, vertexStart: 0, vertexCount: frame.bodyCount)
    }
    encoder.endEncoding()
    commandBuffer.present(drawable)
    let frameSlots = self.frameSlots
    commandBuffer.addCompletedHandler { _ in frameSlots.release(reservedFrameIndex) }
    commandBuffer.commit()
  }

  public func suspend() {
    running = false
    lastPresentationTimestamp = nil
    releaseReservedFrame()
  }

  public func retire() {
    running = false
    releaseReservedFrame()
    pipelinePublication.retire()
  }

  private func releaseReservedFrame() {
    guard let reservedFrameIndex else { return }
    self.reservedFrameIndex = nil
    frameSlots.release(reservedFrameIndex)
  }

  private func preparedPipelines() -> PipelineBundle? {
    pipelinePublication.snapshot()
  }

  private func makePipelineBundle(pixelFormat: MTLPixelFormat) throws -> PipelineBundle {
    let library = try MetalPipelineCache.shared.library(
      namespace: "solar-v2",
      device: device,
      source: SolarShaderSource.metal
    )
    return try PipelineBundle(
      background: makePipeline(
        library: library,
        vertex: "objet_solar_fullscreen_vertex",
        fragment: "objet_solar_background_fragment",
        blending: false,
        cacheName: "solar-background-v2",
        pixelFormat: pixelFormat
      ),
      orbit: makePipeline(
        library: library,
        vertex: "objet_solar_orbit_vertex",
        fragment: "objet_solar_orbit_fragment",
        blending: true,
        cacheName: "solar-orbit-v1",
        pixelFormat: pixelFormat
      ),
      mark: makePipeline(
        library: library,
        vertex: "objet_solar_mark_vertex",
        fragment: "objet_solar_mark_fragment",
        blending: true,
        cacheName: "solar-mark-v2",
        pixelFormat: pixelFormat
      ),
      body: makePipeline(
        library: library,
        vertex: "objet_solar_body_vertex",
        fragment: "objet_solar_body_fragment",
        blending: true,
        cacheName: "solar-body-v2",
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

  private func bodyColour(
    for id: UInt64,
    in bodies: UnsafeBufferPointer<SolarRenderBody>,
    count: Int
  ) -> SIMD3<Float> {
    for index in 0 ..< count where bodies[index].id == id { return bodies[index].color }
    return SIMD3<Float>(0.48, 0.57, 0.72)
  }
}

#endif
