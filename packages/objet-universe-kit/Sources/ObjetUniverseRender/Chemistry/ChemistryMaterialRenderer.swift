#if canImport(Metal) && canImport(QuartzCore)
import Dispatch
import Metal
import QuartzCore

/// ABI for the chemistry scalar material. Atom and Molecule fields keep their
/// own texture lifetime and visual branch; Wave owns neither.
struct ChemistryShaderUniforms {
  var viewport = SIMD2<Float>(1, 1)
  var fieldSize = SIMD2<Float>(1, 1)
  /// elapsed, exposure, representation, material kind.
  var state = SIMD4<Float>(0, 1, 0, 3)
  /// frozen elapsed, reduced-motion flag, reserved, reserved.
  var presentation = SIMD4<Float>(repeating: 0)
}

private final class ChemistryPipelineCompiler: @unchecked Sendable {
  private let device: MTLDevice

  init(device: MTLDevice) {
    self.device = device
  }

  func makePipeline(pixelFormat: MTLPixelFormat) throws -> MTLRenderPipelineState {
    let library = try MetalPipelineCache.shared.library(
      namespace: "chemistry-v1",
      device: device,
      source: ChemistryShaderSource.metal
    )
    return try MetalPipelineCache.shared.pipeline(
      namespace: "chemistry-v1",
      device: device,
      pixelFormat: pixelFormat
    ) {
      let descriptor = MTLRenderPipelineDescriptor()
      descriptor.vertexFunction = library.makeFunction(name: "objet_chemistry_vertex")
      descriptor.fragmentFunction = library.makeFunction(name: "objet_chemistry_fragment")
      descriptor.colorAttachments[0].pixelFormat = pixelFormat
      return try device.makeRenderPipelineState(descriptor: descriptor)
    }
  }
}

/// A bounded scalar material for the two chemistry scenes.
///
/// It owns fixed uploads and one chemistry-only shader, so an atom or a
/// molecule cannot accidentally render through the water material.
public final class ChemistryMaterialRenderer: FieldSurfaceRenderer, ReducedMotionRenderer {
  public let kind: RendererKind = .metal

  private static let framesInFlight = 3
  private static let fieldWidth = 144
  private static let fieldHeight = 144
  private static let pipelinePreparationQueue = DispatchQueue(
    label: "art.objet.chemistry-pipeline-preparation",
    qos: .userInitiated
  )

  private final class FrameResources {
    let surface: MTLTexture
    var uniforms = ChemistryShaderUniforms()
    var secondsPerStep: Double = 0

    init(surface: MTLTexture) {
      self.surface = surface
    }
  }

  private let layer: CAMetalLayer
  private let device: MTLDevice
  private let queue: MTLCommandQueue
  private let pipelineCompiler: ChemistryPipelineCompiler
  private let frames: [FrameResources]
  private let frameSlots = MetalFrameSlotPool(capacity: ChemistryMaterialRenderer.framesInFlight)
  private let pass = MTLRenderPassDescriptor()
  private let pipelinePublication = MetalPipelinePublication<MTLRenderPipelineState>()
  private let pipelineRetry = MetalPipelineRetryPolicy()
  private var sampler: MTLSamplerState?
  private var reservedFrameIndex: Int?
  private var running = false
  private var hasPresentedOwnFrame = false
  private var presentationTiming = MetalPresentationTiming()

  public init?(layer: CAMetalLayer) {
    guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else { return nil }
    let descriptor = MTLTextureDescriptor.texture2DDescriptor(
      pixelFormat: .r32Float,
      width: Self.fieldWidth,
      height: Self.fieldHeight,
      mipmapped: false
    )
    descriptor.usage = .shaderRead
    descriptor.storageMode = .shared
    var frames: [FrameResources] = []
    frames.reserveCapacity(Self.framesInFlight)
    for _ in 0 ..< Self.framesInFlight {
      guard let surface = device.makeTexture(descriptor: descriptor) else { return nil }
      frames.append(FrameResources(surface: surface))
    }
    self.layer = layer
    self.device = device
    self.queue = queue
    pipelineCompiler = ChemistryPipelineCompiler(device: device)
    self.frames = frames
    layer.device = device
    layer.pixelFormat = .bgra8Unorm
    layer.framebufferOnly = true
    layer.isOpaque = true
    pass.colorAttachments[0].loadAction = .clear
    pass.colorAttachments[0].storeAction = .store
    pass.colorAttachments[0].clearColor = MTLClearColor(red: 0.0392, green: 0.0157, blue: 0.0784, alpha: 1)
  }

  public func prepare() {
    if sampler == nil {
      let descriptor = MTLSamplerDescriptor()
      descriptor.minFilter = .linear
      descriptor.magFilter = .linear
      descriptor.sAddressMode = .clampToEdge
      descriptor.tAddressMode = .clampToEdge
      sampler = device.makeSamplerState(descriptor: descriptor)
    }
    guard sampler != nil else {
      pipelineRetry.recordPreparationAttempt()
      return
    }
    guard pipelinePublication.beginPreparation() else { return }
    pipelineRetry.recordPreparationAttempt()
    let pixelFormat = layer.pixelFormat
    let compiler = pipelineCompiler
    let publication = pipelinePublication
    Self.pipelinePreparationQueue.async {
      do {
        let pipeline = try compiler.makePipeline(pixelFormat: pixelFormat)
        DispatchQueue.main.async { publication.publish(pipeline) }
      } catch {
        DispatchQueue.main.async { publication.failPreparation() }
      }
    }
  }

  public func resume() {
    prepare()
    running = true
  }

  public func submitField(_ submission: FieldSubmission) {
    guard Self.acceptsSubmission(
      materialKind: submission.materialKind,
      width: submission.width,
      height: submission.height
    ) else { return }
    if reservedFrameIndex == nil {
      guard let acquired = frameSlots.tryAcquire() else { return }
      reservedFrameIndex = acquired
    }
    guard let reservedFrameIndex else { return }
    let frame = frames[reservedFrameIndex]
    frame.surface.replace(
      region: MTLRegionMake2D(0, 0, submission.width, submission.height),
      mipmapLevel: 0,
      withBytes: submission.values,
      bytesPerRow: submission.width * MemoryLayout<Float>.stride
    )
    frame.uniforms.fieldSize = SIMD2<Float>(Float(submission.width), Float(submission.height))
    frame.uniforms.state.x = Float(submission.elapsedSeconds)
    frame.uniforms.state.y = Float(submission.exposure)
    frame.uniforms.state.z = Float(min(max(submission.representation, 0), 3))
    frame.uniforms.state.w = Float(submission.materialKind)
    frame.secondsPerStep = submission.secondsPerStep
    presentationTiming.recordSubmitted(elapsed: Float(submission.elapsedSeconds))
  }

  public func render(interpolation: Double) {
    guard running, let reservedFrameIndex else { return }
    guard let pipeline = pipelinePublication.snapshot(), let sampler else {
      let readiness = pipelineRetry.nextAction(isPreparing: pipelinePublication.isPreparing())
      releaseReservedFrame()
      // The first chemistry frame must belong to this material. Retaining the
      // outgoing drawable here would show Wave water while this pipeline is
      // cold, which makes a scene change read as a rendering defect.
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
    frame.uniforms.viewport = SIMD2<Float>(Float(drawableSize.width), Float(drawableSize.height))
    pass.colorAttachments[0].texture = drawable.texture
    guard
      let buffer = queue.makeCommandBuffer(),
      let encoder = buffer.makeRenderCommandEncoder(descriptor: pass)
    else {
      pass.colorAttachments[0].texture = nil
      frameSlots.release(reservedFrameIndex)
      return
    }
    pass.colorAttachments[0].texture = nil
    var uniforms = frame.uniforms
    let sourceElapsed = uniforms.state.x + Float(min(max(interpolation, 0), 1) * frame.secondsPerStep)
    uniforms.state.x = presentationTiming.presentationElapsed(for: sourceElapsed)
    uniforms.presentation.x = presentationTiming.frozenElapsed
    uniforms.presentation.y = presentationTiming.reducedMotion ? 1 : 0
    encoder.setRenderPipelineState(pipeline)
    encoder.setFragmentTexture(frame.surface, index: 0)
    encoder.setFragmentSamplerState(sampler, index: 0)
    encoder.setFragmentBytes(&uniforms, length: MemoryLayout<ChemistryShaderUniforms>.stride, index: 0)
    encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
    encoder.endEncoding()
    buffer.present(drawable)
    hasPresentedOwnFrame = true
    let frameSlots = self.frameSlots
    buffer.addCompletedHandler { _ in frameSlots.release(reservedFrameIndex) }
    buffer.commit()
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
    sampler = nil
    pipelinePublication.retire()
  }

  /// The complete upload admission contract. It stays internal so the renderer
  /// guard can be pinned without creating a display-layer test double.
  static func acceptsSubmission(materialKind: Int, width: Int, height: Int) -> Bool {
    (materialKind == 3 || materialKind == 4)
      && Self.acceptsFieldDimensions(width: width, height: height)
  }

  /// Atom and Molecule currently share one bounded scalar lattice. The
  /// contract test compares this check with both authoritative kernels.
  static func acceptsFieldDimensions(width: Int, height: Int) -> Bool {
    width == Self.fieldWidth && height == Self.fieldHeight
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
      let buffer = queue.makeCommandBuffer(),
      let encoder = buffer.makeRenderCommandEncoder(descriptor: pass)
    else {
      pass.colorAttachments[0].texture = nil
      return false
    }
    pass.colorAttachments[0].texture = nil
    encoder.endEncoding()
    buffer.present(drawable)
    buffer.commit()
    return true
  }
}
#endif
