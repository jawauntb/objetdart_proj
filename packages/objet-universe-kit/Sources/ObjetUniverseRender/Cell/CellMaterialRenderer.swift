#if canImport(Metal) && canImport(QuartzCore)
import Dispatch
import Metal
#if SWIFT_PACKAGE
import ObjetUniverseCore
#endif
import QuartzCore

/// Swift's side of the `Uniforms` layout in `CellShaderSource`. The offscreen
/// shader test imports this internal layout so an ABI drift cannot pass the
/// test while breaking the renderer that ships to the device.
struct CellShaderUniforms {
  var viewport = SIMD2<Float>(1, 1)
  var fieldSize = SIMD2<Float>(1, 1)
  var elapsed: Float = 0
  var exposure: Float = 1
  var representation: UInt32 = 0
  var reducedMotion: UInt32 = 0
  var frozenElapsed: Float = 0
}

/// Keeps Cell's decorative breath continuous when the accessibility setting
/// changes. The reaction field stays on its authoritative clock; this only
/// carries the presentation phase that the shader reads.
struct CellBreathTiming {
  private(set) var reducedMotion = false
  private(set) var frozenElapsed: Float = 0
  private var phaseOffset: Float = 0
  private var latestSourceElapsed: Float = 0
  private var lastPresentationElapsed: Float = 0
  private var hasPresentedFrame = false

  mutating func recordSubmitted(elapsed: Float) {
    latestSourceElapsed = elapsed
  }

  mutating func presentationElapsed(for sourceElapsed: Float) -> Float {
    latestSourceElapsed = sourceElapsed
    guard !reducedMotion else { return sourceElapsed }
    let presentationElapsed = sourceElapsed + phaseOffset
    lastPresentationElapsed = presentationElapsed
    hasPresentedFrame = true
    return presentationElapsed
  }

  mutating func setReducedMotion(_ enabled: Bool) {
    guard reducedMotion != enabled else { return }
    if enabled {
      frozenElapsed = hasPresentedFrame
        ? lastPresentationElapsed
        : latestSourceElapsed + phaseOffset
    } else {
      // Resume from the held phase, then progress at the normal rate. This
      // changes no solver state and avoids a one-frame luminance jump.
      phaseOffset = frozenElapsed - latestSourceElapsed
    }
    reducedMotion = enabled
  }
}

/// Builds the immutable Cell pipeline away from the display-link owner.
///
/// `MTLDevice` pipeline creation and `MetalPipelineCache` are safe to share
/// with the preparation queue. This deliberately owns neither a layer nor
/// frame resources, so the renderer itself never crosses that queue.
private final class CellPipelineCompiler: @unchecked Sendable {
  private let device: MTLDevice

  init(device: MTLDevice) {
    self.device = device
  }

  func makePipeline(pixelFormat: MTLPixelFormat) throws -> MTLRenderPipelineState {
    let library = try MetalPipelineCache.shared.library(
      namespace: "cell-v1",
      device: device,
      source: CellShaderSource.metal
    )
    return try MetalPipelineCache.shared.pipeline(
      namespace: "cell-v1",
      device: device,
      pixelFormat: pixelFormat
    ) {
      let descriptor = MTLRenderPipelineDescriptor()
      descriptor.vertexFunction = library.makeFunction(name: "objet_cell_vertex")
      descriptor.fragmentFunction = library.makeFunction(name: "objet_cell_fragment")
      descriptor.colorAttachments[0].pixelFormat = pixelFormat
      return try device.makeRenderPipelineState(descriptor: descriptor)
    }
  }
}

/// The cellular-colony material, on the GPU.
///
/// Each frame borrows `CellKernel`'s authoritative reaction--diffusion field,
/// uploads it into an available texture slot, and derives membranes in the
/// fragment shader. It owns no cells or replayable state of its own.
public final class CellMaterialRenderer: FieldSurfaceRenderer, ReducedMotionRenderer {
  public let kind: RendererKind = .metal

  private static let framesInFlight = 3
  /// CellKernel owns the bounded lattice. Reading its public dimensions here
  /// keeps all three upload surfaces aligned when that scientific contract is
  /// deliberately revised.
  private static let fieldWidth = CellKernel.latticeWidth
  private static let fieldHeight = CellKernel.latticeHeight
  private static let pipelinePreparationQueue = DispatchQueue(
    label: "art.objet.cell-pipeline-preparation",
    qos: .userInitiated
  )

  private final class FrameResources {
    let surface: MTLTexture
    var uniforms = CellShaderUniforms()
    var secondsPerStep: Double = 0

    init(surface: MTLTexture) {
      self.surface = surface
    }
  }

  private let layer: CAMetalLayer
  private let device: MTLDevice
  private let queue: MTLCommandQueue
  private let pipelineCompiler: CellPipelineCompiler
  private let frames: [FrameResources]
  private let frameSlots = MetalFrameSlotPool(capacity: CellMaterialRenderer.framesInFlight)
  private let pass = MTLRenderPassDescriptor()
  private let pipelinePublication = MetalPipelinePublication<MTLRenderPipelineState>()
  private let pipelineRetry = MetalPipelineRetryPolicy()
  private var sampler: MTLSamplerState?
  private var reservedFrameIndex: Int?
  private var running = false
  private var breathTiming = CellBreathTiming()

  /// Returns nil only where Metal itself is unavailable. The caller keeps the
  /// ground colour instead of installing a renderer that can never draw.
  public init?(layer: CAMetalLayer) {
    guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else { return nil }
    let surfaceDescriptor = MTLTextureDescriptor.texture2DDescriptor(
      pixelFormat: .r32Float,
      width: Self.fieldWidth,
      height: Self.fieldHeight,
      mipmapped: false
    )
    surfaceDescriptor.usage = .shaderRead
    surfaceDescriptor.storageMode = .shared
    var frames: [FrameResources] = []
    frames.reserveCapacity(Self.framesInFlight)
    for _ in 0 ..< Self.framesInFlight {
      guard let surface = device.makeTexture(descriptor: surfaceDescriptor) else { return nil }
      frames.append(FrameResources(surface: surface))
    }
    self.layer = layer
    self.device = device
    self.queue = queue
    pipelineCompiler = CellPipelineCompiler(device: device)
    self.frames = frames
    layer.device = device
    layer.pixelFormat = .bgra8Unorm
    layer.framebufferOnly = true
    layer.isOpaque = true
    pass.colorAttachments[0].loadAction = .clear
    pass.colorAttachments[0].storeAction = .store
    pass.colorAttachments[0].clearColor = MTLClearColor(red: 0.012, green: 0.025, blue: 0.043, alpha: 1)
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
        DispatchQueue.main.async {
          publication.publish(pipeline)
        }
      } catch {
        // A failed compile never publishes a partial pipeline. The display
        // link gives it a bounded retry before it replaces the old drawable
        // with this material's own night ground.
        DispatchQueue.main.async {
          publication.failPreparation()
        }
      }
    }
  }

  public func resume() {
    prepare()
    running = true
  }

  public func submitField(_ submission: FieldSubmission) {
    guard Self.acceptsFieldDimensions(width: submission.width, height: submission.height) else { return }
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
    frame.uniforms.elapsed = Float(submission.elapsedSeconds)
    frame.uniforms.exposure = Float(submission.exposure)
    frame.uniforms.representation = UInt32(clamping: submission.representation)
    frame.secondsPerStep = submission.secondsPerStep
    breathTiming.recordSubmitted(elapsed: Float(submission.elapsedSeconds))
  }

  public func render(interpolation: Double) {
    guard running, let reservedFrameIndex else { return }
    // Do not acquire or clear a drawable until the complete material exists.
    // During the short asynchronous compile, CAMetalLayer retains the last
    // coherent frame instead of flashing a ground-only transition.
    guard let pipeline = pipelinePublication.snapshot(), let sampler else {
      let readiness = pipelineRetry.nextAction(isPreparing: pipelinePublication.isPreparing())
      releaseReservedFrame()
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
    // The encoder retains its attachment. Releasing it from the reusable
    // descriptor avoids retaining a presented drawable until the next frame.
    pass.colorAttachments[0].texture = nil
    encoder.setRenderPipelineState(pipeline)
    encoder.setFragmentTexture(frame.surface, index: 0)
    encoder.setFragmentSamplerState(sampler, index: 0)
    var uniforms = frame.uniforms
    let sourceElapsed = uniforms.elapsed + Float(min(max(interpolation, 0), 1) * frame.secondsPerStep)
    uniforms.elapsed = breathTiming.presentationElapsed(for: sourceElapsed)
    uniforms.reducedMotion = breathTiming.reducedMotion ? 1 : 0
    uniforms.frozenElapsed = breathTiming.frozenElapsed
    encoder.setFragmentBytes(&uniforms, length: MemoryLayout<CellShaderUniforms>.stride, index: 0)
    encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
    encoder.endEncoding()
    buffer.present(drawable)
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
    breathTiming.setReducedMotion(enabled)
  }

  public func retire() {
    running = false
    releaseReservedFrame()
    sampler = nil
    pipelinePublication.retire()
  }

  private func releaseReservedFrame() {
    guard let reservedFrameIndex else { return }
    self.reservedFrameIndex = nil
    frameSlots.release(reservedFrameIndex)
  }

  /// The renderer and its kernel deliberately share this one lattice shape.
  /// Keeping the predicate internal lets the Metal gate pin that contract
  /// without exposing presentation storage as public API.
  static func acceptsFieldDimensions(width: Int, height: Int) -> Bool {
    width == Self.fieldWidth && height == Self.fieldHeight
  }

  /// The fallback visual state for an unavailable Cell pipeline. It comes
  /// after bounded retries only: we never clear a healthy outgoing scene for
  /// a normal asynchronous compile, but we also never leave the wrong room on
  /// screen indefinitely when Metal has declined this material. The retry
  /// policy retains this completed night frame between its sparse re-arms.
  private func presentGround() {
    let drawableSize = layer.drawableSize
    guard drawableSize.width >= 1, drawableSize.height >= 1, let drawable = layer.nextDrawable() else { return }
    pass.colorAttachments[0].texture = drawable.texture
    guard
      let buffer = queue.makeCommandBuffer(),
      let encoder = buffer.makeRenderCommandEncoder(descriptor: pass)
    else {
      pass.colorAttachments[0].texture = nil
      return
    }
    pass.colorAttachments[0].texture = nil
    encoder.endEncoding()
    buffer.present(drawable)
    buffer.commit()
  }
}
#endif
