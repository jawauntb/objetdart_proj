#if canImport(Metal) && canImport(QuartzCore)
import Dispatch
import Foundation
import Metal
#if SWIFT_PACKAGE
import ObjetUniverseCore
#endif
import QuartzCore
import simd

/// Swift's side of the solar shader ABI. The phone-scale fixture imports this
/// layout and the shipping packer, so a richer material cannot silently drift
/// from the facts the kernel gives it.
struct SolarShaderUniforms {
  var viewport = SIMD2<Float>(1, 1)
  var cameraScale: Float = Float(SolarPhysics.maximumSemiMajorAxis)
  var cameraRotation: Float = 0
  var cameraPitch: Float = 0.12
  var interpolation: Float = 0
  var elapsed: Float = 0
  var frozenElapsed: Float = 0
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
  var reducedMotion: UInt32 = 0
  var breathSeconds: Float = Float(WaveField.breathSeconds)
}

/// One bounded body record, copied from the kernel while its borrowed
/// snapshot is live. The material seed is intentionally independent of the
/// palette: worlds need different surfaces, not merely different tints.
struct SolarGPUBody {
  var previousPosition = SIMD4<Float>(repeating: 0)
  var positionRadius = SIMD4<Float>(repeating: 0)
  var colourMass = SIMD4<Float>(repeating: 0)
  var velocityKindSelected = SIMD4<Float>(repeating: 0)
  var materialSeed = SIMD4<Float>(repeating: 0)
}

struct SolarGPUMark {
  var positionAge = SIMD4<Float>(repeating: 0)
  var colourSize = SIMD4<Float>(repeating: 0)
}

struct SolarGPUUpload {
  let bodyCount: Int
  let previewCount: Int
  let trailCount: Int
  let predictionCount: Int
}

struct SolarPipelineBundle {
  let background: MTLRenderPipelineState
  let orbit: MTLRenderPipelineState
  let mark: MTLRenderPipelineState
  let body: MTLRenderPipelineState
}

/// The shipping pipeline compiler is shared by the offscreen visual fixture.
/// That keeps the proof attached to the exact shader entry points and blend
/// state the device uses.
final class SolarPipelineCompiler: @unchecked Sendable {
  private let device: MTLDevice

  init(device: MTLDevice) {
    self.device = device
  }

  func makePipelines(pixelFormat: MTLPixelFormat) throws -> SolarPipelineBundle {
    let library = try MetalPipelineCache.shared.library(
      namespace: "solar-v3",
      device: device,
      source: SolarShaderSource.metal
    )
    return try SolarPipelineBundle(
      background: makePipeline(
        library: library,
        vertex: "objet_solar_fullscreen_vertex",
        fragment: "objet_solar_background_fragment",
        blending: false,
        cacheName: "solar-background-v3",
        pixelFormat: pixelFormat
      ),
      orbit: makePipeline(
        library: library,
        vertex: "objet_solar_orbit_vertex",
        fragment: "objet_solar_orbit_fragment",
        blending: true,
        cacheName: "solar-orbit-v2",
        pixelFormat: pixelFormat
      ),
      mark: makePipeline(
        library: library,
        vertex: "objet_solar_mark_vertex",
        fragment: "objet_solar_mark_fragment",
        blending: true,
        cacheName: "solar-mark-v3",
        pixelFormat: pixelFormat
      ),
      body: makePipeline(
        library: library,
        vertex: "objet_solar_body_vertex",
        fragment: "objet_solar_body_fragment",
        blending: true,
        cacheName: "solar-body-v3",
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

/// A bounded 2.5D solar instrument. Bodies remain authoritative in
/// `SolarKernel`; this renderer borrows one snapshot, uploads it into a
/// triple-buffered ring, and gives each body a seeded physical surface.
public final class SolarRenderer: SolarSystemRenderer, SolarCameraRenderer, ReducedMotionRenderer, @unchecked Sendable {
  public let kind: RendererKind = .metal

  private static let maximumBodies = SolarPhysics.maxBodies
  private static let maximumTrailPoints = SolarPhysics.maxBodies * SolarPhysics.trailCapacityPerBody
  private static let maximumPredictionPoints = SolarPhysics.predictionSampleCount
  private static let framesInFlight = 3
  private static let pipelinePreparationQueue = DispatchQueue(
    label: "art.objet.solar-pipeline-preparation",
    qos: .userInitiated
  )

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
    var secondsPerStep: Double = 0
    var pathOffsets = [Int](repeating: 0, count: SolarRenderer.maximumBodies)
    var pathCounts = [Int](repeating: 0, count: SolarRenderer.maximumBodies)

    init?(device: MTLDevice) {
      guard
        let uniforms = device.makeBuffer(
          length: MemoryLayout<SolarShaderUniforms>.stride,
          options: .storageModeShared
        ),
        let bodies = device.makeBuffer(
          length: MemoryLayout<SolarGPUBody>.stride * SolarRenderer.maximumBodies,
          options: .storageModeShared
        ),
        let preview = device.makeBuffer(
          length: MemoryLayout<SolarGPUBody>.stride,
          options: .storageModeShared
        ),
        let trails = device.makeBuffer(
          length: MemoryLayout<SolarGPUMark>.stride * SolarRenderer.maximumTrailPoints,
          options: .storageModeShared
        ),
        let prediction = device.makeBuffer(
          length: MemoryLayout<SolarGPUMark>.stride * SolarRenderer.maximumPredictionPoints,
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
  private let queue: MTLCommandQueue
  private let pipelineCompiler: SolarPipelineCompiler
  private let frames: [FrameResources]
  private let frameSlots = MetalFrameSlotPool(capacity: SolarRenderer.framesInFlight)
  private let pass = MTLRenderPassDescriptor()
  private let pipelinePublication = MetalPipelinePublication<SolarPipelineBundle>()
  private let pipelineRetry = MetalPipelineRetryPolicy()
  private var reservedFrameIndex: Int?
  private var camera = SolarCameraState()
  private var lastCameraPresentationTimestamp: CFTimeInterval?
  private var running = false
  private var hasPresentedOwnFrame = false
  private var presentationTiming = MetalPresentationTiming()
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
    self.queue = queue
    pipelineCompiler = SolarPipelineCompiler(device: device)
    self.frames = frames
    layer.device = device
    layer.pixelFormat = .bgra8Unorm
    layer.framebufferOnly = true
    layer.isOpaque = true
    pass.colorAttachments[0].loadAction = .clear
    pass.colorAttachments[0].storeAction = .store
    pass.colorAttachments[0].clearColor = MTLClearColor(red: 0.005, green: 0.008, blue: 0.020, alpha: 1)
  }

  public func prepare() {
    guard pipelinePublication.beginPreparation() else { return }
    pipelineRetry.recordPreparationAttempt()
    let pixelFormat = layer.pixelFormat
    let compiler = pipelineCompiler
    let publication = pipelinePublication
    Self.pipelinePreparationQueue.async {
      do {
        let bundle = try compiler.makePipelines(pixelFormat: pixelFormat)
        DispatchQueue.main.async { publication.publish(bundle) }
      } catch {
        DispatchQueue.main.async { publication.failPreparation() }
      }
    }
  }

  public func resume() {
    prepare()
    lastCameraPresentationTimestamp = nil
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
    let bodies = UnsafeMutableBufferPointer(
      start: frame.bodies.contents().bindMemory(to: SolarGPUBody.self, capacity: Self.maximumBodies),
      count: Self.maximumBodies
    )
    let preview = UnsafeMutableBufferPointer(
      start: frame.preview.contents().bindMemory(to: SolarGPUBody.self, capacity: 1),
      count: 1
    )
    let trails = UnsafeMutableBufferPointer(
      start: frame.trails.contents().bindMemory(to: SolarGPUMark.self, capacity: Self.maximumTrailPoints),
      count: Self.maximumTrailPoints
    )
    let prediction = UnsafeMutableBufferPointer(
      start: frame.prediction.contents().bindMemory(to: SolarGPUMark.self, capacity: Self.maximumPredictionPoints),
      count: Self.maximumPredictionPoints
    )
    guard let upload = Self.pack(
      snapshot,
      bodies: bodies,
      preview: preview,
      trails: trails,
      prediction: prediction,
      pathOffsets: &frame.pathOffsets,
      pathCounts: &frame.pathCounts
    ) else {
      releaseReservedFrame()
      return
    }

    var uniforms = Self.makeUniforms(for: snapshot, upload: upload)
    memcpy(frame.uniforms.contents(), &uniforms, MemoryLayout<SolarShaderUniforms>.stride)
    frame.bodyCount = upload.bodyCount
    frame.previewCount = upload.previewCount
    frame.trailCount = upload.trailCount
    frame.predictionCount = upload.predictionCount
    frame.secondsPerStep = snapshot.secondsPerTick
    presentationTiming.recordSubmitted(elapsed: Float(snapshot.elapsedSeconds))
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
    guard let pipelines = pipelinePublication.snapshot() else {
      let readiness = pipelineRetry.nextAction(isPreparing: pipelinePublication.isPreparing())
      releaseReservedFrame()
      if !hasPresentedOwnFrame, presentGround() {
        hasPresentedOwnFrame = true
        return
      }
      switch readiness {
      case .retainCurrentDrawable:
        break
      case .retryPreparation:
        prepare()
      case .presentFallback:
        presentGround()
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
    advanceCameraPresentation()
    let uniforms = frame.uniforms.contents().bindMemory(to: SolarShaderUniforms.self, capacity: 1)
    uniforms.pointee.viewport = SIMD2<Float>(Float(drawableSize.width), Float(drawableSize.height))
    uniforms.pointee.cameraRotation = Float(camera.yaw)
    uniforms.pointee.cameraPitch = Float(camera.pitch)
    uniforms.pointee.interpolation = Float(min(max(interpolation, 0), 1))
    let sourceElapsed = uniforms.pointee.elapsed + Float(uniforms.pointee.interpolation * Float(frame.secondsPerStep))
    uniforms.pointee.elapsed = presentationTiming.presentationElapsed(for: sourceElapsed)
    uniforms.pointee.frozenElapsed = presentationTiming.frozenElapsed
    uniforms.pointee.reducedMotion = presentationTiming.reducedMotion ? 1 : 0
    pass.colorAttachments[0].texture = drawable.texture

    guard let command = queue.makeCommandBuffer(), let encoder = command.makeRenderCommandEncoder(descriptor: pass) else {
      pass.colorAttachments[0].texture = nil
      frameSlots.release(reservedFrameIndex)
      return
    }
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
        encoder.drawPrimitives(
          type: .lineStrip,
          vertexStart: frame.pathOffsets[bodyIndex],
          vertexCount: frame.pathCounts[bodyIndex]
        )
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
    encoder.setFragmentBuffer(frame.uniforms, offset: 0, index: 0)
    if frame.previewCount > 0 {
      encoder.drawPrimitives(type: .point, vertexStart: 0, vertexCount: frame.previewCount)
    }
    encoder.setVertexBuffer(frame.bodies, offset: 0, index: 0)
    if frame.bodyCount > 0 {
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
    lastCameraPresentationTimestamp = nil
    releaseReservedFrame()
    pipelineRetry.resetAfterSuspend()
  }

  public func setReducedMotion(_ enabled: Bool) {
    presentationTiming.setReducedMotion(enabled)
  }

  public func retire() {
    running = false
    lastCameraPresentationTimestamp = nil
    releaseReservedFrame()
    pipelinePublication.retire()
  }

  /// Admission is deliberately bounded and total: malformed snapshots cannot
  /// turn the visual lane into an out-of-bounds GPU upload.
  static func acceptsSnapshot(bodyCount: Int, trailCount: Int, predictionCount: Int) -> Bool {
    bodyCount >= 0 && bodyCount <= Self.maximumBodies
      && trailCount >= 0 && trailCount <= Self.maximumTrailPoints
      && predictionCount >= 0 && predictionCount <= Self.maximumPredictionPoints
  }

  static func pack(
    _ snapshot: SolarRenderSnapshot,
    bodies destinationBodies: UnsafeMutableBufferPointer<SolarGPUBody>,
    preview destinationPreview: UnsafeMutableBufferPointer<SolarGPUBody>,
    trails destinationTrails: UnsafeMutableBufferPointer<SolarGPUMark>,
    prediction destinationPrediction: UnsafeMutableBufferPointer<SolarGPUMark>,
    pathOffsets: inout [Int],
    pathCounts: inout [Int]
  ) -> SolarGPUUpload? {
    guard
      Self.acceptsSnapshot(
        bodyCount: snapshot.bodies.count,
        trailCount: snapshot.trailPoints.count,
        predictionCount: snapshot.predictionPoints.count
      ),
      destinationBodies.count >= Self.maximumBodies,
      destinationPreview.count >= 1,
      destinationTrails.count >= Self.maximumTrailPoints,
      destinationPrediction.count >= Self.maximumPredictionPoints,
      pathOffsets.count >= Self.maximumBodies,
      pathCounts.count >= Self.maximumBodies,
      snapshot.elapsedSeconds.isFinite,
      snapshot.secondsPerTick.isFinite,
      snapshot.secondsPerTick >= 0,
      snapshot.centralMass.isFinite,
      snapshot.collisionPulse.isFinite,
      snapshot.collisionPosition.x.isFinite,
      snapshot.collisionPosition.y.isFinite,
      snapshot.touchPulse.isFinite,
      snapshot.touchPosition.x.isFinite,
      snapshot.touchPosition.y.isFinite
    else { return nil }

    let trailCount = snapshot.trailPoints.count
    for index in snapshot.bodies.indices {
      let body = snapshot.bodies[index]
      guard
        body.previousPosition.x.isFinite,
        body.previousPosition.y.isFinite,
        body.previousPosition.z.isFinite,
        body.position.x.isFinite,
        body.position.y.isFinite,
        body.position.z.isFinite,
        body.velocity.x.isFinite,
        body.velocity.y.isFinite,
        body.mass.isFinite,
        body.radius.isFinite,
        body.radius >= 0,
        body.color.x.isFinite,
        body.color.y.isFinite,
        body.color.z.isFinite,
        body.trailOffset >= 0,
        body.trailCount >= 0,
        body.trailOffset <= trailCount,
        body.trailCount <= trailCount - body.trailOffset
      else { return nil }
      destinationBodies[index] = SolarGPUBody(
        previousPosition: SIMD4<Float>(body.previousPosition, 0),
        positionRadius: SIMD4<Float>(body.position, body.radius),
        colourMass: SIMD4<Float>(body.color, body.mass),
        velocityKindSelected: SIMD4<Float>(
          body.velocity.x,
          body.velocity.y,
          Float(body.kind.rawValue),
          body.isSelected ? 1 : 0
        ),
        materialSeed: SIMD4<Float>(Float(body.materialSeed) / Float(UInt32.max), 0, 0, 0)
      )
      pathOffsets[index] = body.trailOffset
      pathCounts[index] = body.trailCount
    }

    let previewCount: Int
    if let preview = snapshot.accretionPreview {
      guard
        preview.position.x.isFinite,
        preview.position.y.isFinite,
        preview.position.z.isFinite,
        preview.radius.isFinite,
        preview.radius >= 0,
        preview.color.x.isFinite,
        preview.color.y.isFinite,
        preview.color.z.isFinite,
        preview.progress.isFinite
      else { return nil }
      let progress = min(max(preview.progress, 0), 1)
      let growingRadius = max(preview.radius, 0.035) * (0.35 + progress * 0.65)
      destinationPreview[0] = SolarGPUBody(
        previousPosition: SIMD4<Float>(preview.position, 0),
        positionRadius: SIMD4<Float>(preview.position, growingRadius),
        colourMass: SIMD4<Float>(preview.color, 0),
        velocityKindSelected: SIMD4<Float>(0, 0, 3, progress),
        materialSeed: SIMD4<Float>(0.618, 0, 0, 0)
      )
      previewCount = 1
    } else {
      previewCount = 0
    }

    for index in snapshot.trailPoints.indices {
      let point = snapshot.trailPoints[index]
      guard point.position.x.isFinite, point.position.y.isFinite, point.position.z.isFinite, point.age.isFinite else { return nil }
      let colour = bodyColour(for: point.bodyID, in: snapshot.bodies)
      destinationTrails[index] = SolarGPUMark(
        positionAge: SIMD4<Float>(point.position, min(max(point.age, 0), 1)),
        colourSize: SIMD4<Float>(colour, 3.2)
      )
    }

    for index in snapshot.predictionPoints.indices {
      let point = snapshot.predictionPoints[index]
      guard point.position.x.isFinite, point.position.y.isFinite, point.position.z.isFinite else { return nil }
      let progress = Float(index) / Float(max(snapshot.predictionPoints.count - 1, 1))
      destinationPrediction[index] = SolarGPUMark(
        positionAge: SIMD4<Float>(point.position, 0.08 + progress * 0.62),
        colourSize: SIMD4<Float>(0.36, 0.90, 0.82, 4.2)
      )
    }

    return SolarGPUUpload(
      bodyCount: snapshot.bodies.count,
      previewCount: previewCount,
      trailCount: trailCount,
      predictionCount: snapshot.predictionPoints.count
    )
  }

  static func makeUniforms(for snapshot: SolarRenderSnapshot, upload: SolarGPUUpload) -> SolarShaderUniforms {
    SolarShaderUniforms(
      elapsed: Float(snapshot.elapsedSeconds),
      centralMass: max(snapshot.centralMass, 0.01),
      collisionPulse: min(max(snapshot.collisionPulse, 0), 1),
      collisionPosition: SIMD2<Float>(snapshot.collisionPosition.x, snapshot.collisionPosition.y),
      touchPosition: SIMD2<Float>(snapshot.touchPosition.x, snapshot.touchPosition.y),
      touchPulse: min(max(snapshot.touchPulse, 0), 1),
      touchKind: UInt32(snapshot.touchKind.rawValue),
      representation: UInt32(min(max(snapshot.representation, 0), 3)),
      bodyCount: UInt32(upload.bodyCount),
      trailCount: UInt32(upload.trailCount),
      predictionCount: UInt32(upload.predictionCount),
      breathSeconds: Float(WaveField.breathSeconds)
    )
  }

  private func advanceCameraPresentation() {
    let now = CACurrentMediaTime()
    let delta = lastCameraPresentationTimestamp.map { now - $0 } ?? (1.0 / 60.0)
    lastCameraPresentationTimestamp = now
    camera.advancePresentationFrame(deltaSeconds: delta)
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
    guard let command = queue.makeCommandBuffer(), let encoder = command.makeRenderCommandEncoder(descriptor: pass) else {
      pass.colorAttachments[0].texture = nil
      return false
    }
    pass.colorAttachments[0].texture = nil
    encoder.endEncoding()
    command.present(drawable)
    command.commit()
    return true
  }

  private static func bodyColour(
    for id: UInt64,
    in bodies: UnsafeBufferPointer<SolarRenderBody>
  ) -> SIMD3<Float> {
    for body in bodies where body.id == id { return body.color }
    return SIMD3<Float>(0.48, 0.57, 0.72)
  }
}

#endif
