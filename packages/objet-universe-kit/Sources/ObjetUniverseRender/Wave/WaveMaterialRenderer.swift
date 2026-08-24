#if canImport(Metal) && canImport(QuartzCore)
import Dispatch
import Foundation
import Metal
#if SWIFT_PACKAGE
import ObjetUniverseCore
#endif
import QuartzCore

/// Swift's side of the water material's ABI. Keeping the spectrum in this
/// fixed layout lets the CPU reduce the field once per submitted simulation
/// state instead of asking every screen fragment to run its own Fourier sum.
struct WaveShaderUniforms {
  var viewport = SIMD2<Float>(1, 1)
  var fieldSize = SIMD2<Float>(1, 1)
  /// elapsed, exposure, representation, reduced-motion flag.
  var state = SIMD4<Float>(0, 1, 0, 0)
  /// frozen elapsed, breath seconds, reserved, reserved.
  var presentation = SIMD4<Float>(0, 7, 0, 0)
  var spectrum0 = SIMD4<Float>(repeating: 0)
  var spectrum1 = SIMD4<Float>(repeating: 0)
  var spectrum2 = SIMD4<Float>(repeating: 0)
}

/// Twelve spectral magnitudes reduced from an authoritative field row.
///
/// This value has a fixed stack layout and no backing collection, so it can
/// move from the submission seam to Metal uniforms without a frame allocation.
struct WaveSpectrumBins: Equatable {
  private static let sampleCount = 48
  private static let binCount = 12

  var first = SIMD4<Float>(repeating: 0)
  var second = SIMD4<Float>(repeating: 0)
  var third = SIMD4<Float>(repeating: 0)

  static func make(
    values: UnsafePointer<Float>,
    width: Int,
    height: Int,
    exposure: Float
  ) -> Self {
    let sampleCount = min(Self.sampleCount, width)
    guard sampleCount > 1, height > 0 else { return Self() }
    let row = min(max(height / 2, 0), height - 1) * width
    var mean: Float = 0
    var meanAbsolute: Float = 0
    for sample in 0 ..< sampleCount {
      let x = sample * (width - 1) / (sampleCount - 1)
      let value = values[row + x] * exposure
      mean += value
      meanAbsolute += abs(value)
    }
    mean /= Float(sampleCount)
    meanAbsolute /= Float(sampleCount)

    var bins = Self()
    bins.set(min(max(meanAbsolute * 4.2, 0), 1), at: 0)
    for bin in 1 ..< Self.binCount {
      var real: Float = 0
      var imaginary: Float = 0
      for sample in 0 ..< sampleCount {
        let x = sample * (width - 1) / (sampleCount - 1)
        let value = values[row + x] * exposure - mean
        let angle = 2 * Float.pi * Float(bin * sample) / Float(sampleCount)
        real += value * Float(cos(Double(angle)))
        imaginary -= value * Float(sin(Double(angle)))
      }
      let harmonic = sqrt(real * real + imaginary * imaginary) / Float(sampleCount)
      bins.set(min(max(harmonic * 4.2, 0), 1), at: bin)
    }
    return bins
  }

  func write(to uniforms: inout WaveShaderUniforms) {
    uniforms.spectrum0 = first
    uniforms.spectrum1 = second
    uniforms.spectrum2 = third
  }

  private mutating func set(_ value: Float, at bin: Int) {
    switch bin {
    case 0: first.x = value
    case 1: first.y = value
    case 2: first.z = value
    case 3: first.w = value
    case 4: second.x = value
    case 5: second.y = value
    case 6: second.z = value
    case 7: second.w = value
    case 8: third.x = value
    case 9: third.y = value
    case 10: third.z = value
    default: third.w = value
    }
  }
}

/// Builds the immutable Wave pipeline away from the display-link owner.
private final class WavePipelineCompiler: @unchecked Sendable {
  private let device: MTLDevice

  init(device: MTLDevice) {
    self.device = device
  }

  func makePipeline(pixelFormat: MTLPixelFormat) throws -> MTLRenderPipelineState {
    let library = try MetalPipelineCache.shared.library(
      namespace: "wave-v2",
      device: device,
      source: WaveShaderSource.metal
    )
    return try MetalPipelineCache.shared.pipeline(
      namespace: "wave-v2",
      device: device,
      pixelFormat: pixelFormat
    ) {
      let descriptor = MTLRenderPipelineDescriptor()
      descriptor.vertexFunction = library.makeFunction(name: "objet_wave_vertex")
      descriptor.fragmentFunction = library.makeFunction(name: "objet_wave_fragment")
      descriptor.colorAttachments[0].pixelFormat = pixelFormat
      return try device.makeRenderPipelineState(descriptor: descriptor)
    }
  }
}

/// The wave scene's dedicated water material, on the GPU.
///
/// The authoritative field is uploaded to a bounded three-slot ring. The
/// renderer never mutates that field, owns no replayable state, and never
/// lets a later simulation upload overwrite a texture Metal is still reading.
public final class WaveMaterialRenderer: FieldSurfaceRenderer, ReducedMotionRenderer {
  public let kind: RendererKind = .metal

  private static let framesInFlight = 3
  private static let fieldWidth = WaveField.releaseWidth
  private static let fieldHeight = WaveField.releaseHeight
  private static let pipelinePreparationQueue = DispatchQueue(
    label: "art.objet.wave-pipeline-preparation",
    qos: .userInitiated
  )

  private final class FrameResources {
    let surface: MTLTexture
    var uniforms = WaveShaderUniforms()
    var secondsPerStep: Double = 0

    init(surface: MTLTexture) {
      self.surface = surface
    }
  }

  private let layer: CAMetalLayer
  private let device: MTLDevice
  private let queue: MTLCommandQueue
  private let pipelineCompiler: WavePipelineCompiler
  private let frames: [FrameResources]
  private let frameSlots = MetalFrameSlotPool(capacity: WaveMaterialRenderer.framesInFlight)
  private let pass = MTLRenderPassDescriptor()
  private let pipelinePublication = MetalPipelinePublication<MTLRenderPipelineState>()
  private let pipelineRetry = MetalPipelineRetryPolicy()
  private let breathSeconds: Float
  private var sampler: MTLSamplerState?
  private var reservedFrameIndex: Int?
  private var running = false
  private var presentationTiming = MetalPresentationTiming()

  /// Returns nil only where Metal itself is unavailable. The caller keeps its
  /// own ground rather than installing a renderer that cannot ever draw.
  public init?(layer: CAMetalLayer, breathSeconds: Double) {
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
    pipelineCompiler = WavePipelineCompiler(device: device)
    self.frames = frames
    self.breathSeconds = Float(max(breathSeconds, 0.001))
    layer.device = device
    layer.pixelFormat = .bgra8Unorm
    layer.framebufferOnly = true
    layer.isOpaque = true
    pass.colorAttachments[0].loadAction = .clear
    pass.colorAttachments[0].storeAction = .store
    pass.colorAttachments[0].clearColor = MTLClearColor(red: 0.0196, green: 0.0353, blue: 0.0784, alpha: 1)
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
        // The current drawable remains coherent during bounded retries. A
        // failed compiler service never publishes a partial pipeline.
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
    frame.uniforms.presentation.y = breathSeconds
    if submission.representation == 2 {
      WaveSpectrumBins.make(
        values: submission.values,
        width: submission.width,
        height: submission.height,
        exposure: Float(submission.exposure)
      ).write(to: &frame.uniforms)
    }
    frame.secondsPerStep = submission.secondsPerStep
    presentationTiming.recordSubmitted(elapsed: Float(submission.elapsedSeconds))
  }

  public func render(interpolation: Double) {
    guard running, let reservedFrameIndex else { return }
    // While compilation is in flight, retain the previous coherent drawable;
    // only a bounded terminal failure gets this material's own night ground.
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
    pass.colorAttachments[0].texture = nil
    var uniforms = frame.uniforms
    let sourceElapsed = uniforms.state.x + Float(min(max(interpolation, 0), 1) * frame.secondsPerStep)
    uniforms.state.x = presentationTiming.presentationElapsed(for: sourceElapsed)
    uniforms.state.w = presentationTiming.reducedMotion ? 1 : 0
    uniforms.presentation.x = presentationTiming.frozenElapsed
    encoder.setRenderPipelineState(pipeline)
    encoder.setFragmentTexture(frame.surface, index: 0)
    encoder.setFragmentSamplerState(sampler, index: 0)
    encoder.setFragmentBytes(&uniforms, length: MemoryLayout<WaveShaderUniforms>.stride, index: 0)
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
    materialKind == 0 && Self.acceptsFieldDimensions(width: width, height: height)
  }

  /// The renderer and kernel share the release lattice. Keeping the check
  /// near upload guarantees a chemistry field can never become water merely
  /// because both happen to use a scalar texture.
  static func acceptsFieldDimensions(width: Int, height: Int) -> Bool {
    width == Self.fieldWidth && height == Self.fieldHeight
  }

  private func releaseReservedFrame() {
    guard let reservedFrameIndex else { return }
    self.reservedFrameIndex = nil
    frameSlots.release(reservedFrameIndex)
  }

  /// A terminal compiler failure needs a truthful material ground rather than
  /// a stale previous room. Retry policy ensures this is never the normal
  /// asynchronous-compile transition.
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
