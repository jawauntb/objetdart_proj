#if canImport(Metal) && canImport(QuartzCore)
import Foundation
import Metal
import QuartzCore

/// The wave scene's material, on the GPU.
///
/// Two passes' worth of work in one: the field arrives as a single-channel
/// texture and the fragment shader turns it into the dark water the scene
/// brief describes — brightness from amplitude, light from the surface's own
/// slope, ember where interference is decisive. There is one draw call per
/// frame and no allocation inside it.
///
/// The renderer is authoritative about nothing. It never writes to the field,
/// never advances time, and holds no state a replay would need.
public final class WaveMaterialRenderer: FieldSurfaceRenderer {
  public let kind: RendererKind = .metal

  private struct Uniforms {
    var viewportWidth: Float = 1
    var viewportHeight: Float = 1
    var fieldWidth: Float = 1
    var fieldHeight: Float = 1
    var elapsed: Float = 0
    var exposure: Float = 1
    var breathSeconds: Float = 7
    var pad: Float = 0
  }

  private let layer: CAMetalLayer
  private let device: MTLDevice
  private let queue: MTLCommandQueue
  private var pipeline: MTLRenderPipelineState?
  private var sampler: MTLSamplerState?
  private var surface: MTLTexture?
  private var uniforms = Uniforms()
  private var secondsPerStep: Double = 0
  private var running = false

  /// Fails only where Metal itself is unavailable. A caller that gets `nil`
  /// has no GPU to draw on and must say so rather than install a silent stand-in.
  public init?(layer: CAMetalLayer, breathSeconds: Double) {
    guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else { return nil }
    self.layer = layer
    self.device = device
    self.queue = queue
    uniforms.breathSeconds = Float(breathSeconds)
    layer.device = device
    layer.pixelFormat = .bgra8Unorm
    layer.framebufferOnly = true
    layer.isOpaque = true
  }

  public func prepare() {
    if pipeline == nil {
      do {
        let library = try device.makeLibrary(source: WaveShaderSource.metal, options: nil)
        let descriptor = MTLRenderPipelineDescriptor()
        descriptor.vertexFunction = library.makeFunction(name: "objet_wave_vertex")
        descriptor.fragmentFunction = library.makeFunction(name: "objet_wave_fragment")
        descriptor.colorAttachments[0].pixelFormat = layer.pixelFormat
        pipeline = try device.makeRenderPipelineState(descriptor: descriptor)
      } catch {
        // A failed compile leaves the ground colour on screen and the host
        // running; it must not take the universe down with it.
        pipeline = nil
      }
    }
    if sampler == nil {
      let descriptor = MTLSamplerDescriptor()
      descriptor.minFilter = .linear
      descriptor.magFilter = .linear
      descriptor.sAddressMode = .clampToEdge
      descriptor.tAddressMode = .clampToEdge
      sampler = device.makeSamplerState(descriptor: descriptor)
    }
  }

  public func resume() {
    prepare()
    running = true
  }

  public func submitField(_ submission: FieldSubmission) {
    guard submission.width > 0, submission.height > 0 else { return }
    ensureSurface(width: submission.width, height: submission.height)
    guard let surface else { return }
    surface.replace(
      region: MTLRegionMake2D(0, 0, submission.width, submission.height),
      mipmapLevel: 0,
      withBytes: submission.values,
      bytesPerRow: submission.width * MemoryLayout<Float>.stride
    )
    uniforms.fieldWidth = Float(submission.width)
    uniforms.fieldHeight = Float(submission.height)
    uniforms.elapsed = Float(submission.elapsedSeconds)
    uniforms.exposure = Float(submission.exposure)
    secondsPerStep = submission.secondsPerStep
  }

  public func render(interpolation: Double) {
    guard running, let pipeline, let sampler, let surface else { return }
    let drawableSize = layer.drawableSize
    guard drawableSize.width >= 1, drawableSize.height >= 1 else { return }
    guard let drawable = layer.nextDrawable() else { return }

    uniforms.viewportWidth = Float(drawableSize.width)
    uniforms.viewportHeight = Float(drawableSize.height)
    // Carry the authoritative instant forward by the frame's own fraction of a
    // step, so the breath and the glimmer move continuously between ticks
    // instead of stepping at the integrator's cadence.
    let interpolated = uniforms.elapsed + Float(min(max(interpolation, 0), 1) * secondsPerStep)

    let pass = MTLRenderPassDescriptor()
    pass.colorAttachments[0].texture = drawable.texture
    pass.colorAttachments[0].loadAction = .clear
    pass.colorAttachments[0].storeAction = .store
    pass.colorAttachments[0].clearColor = MTLClearColor(red: 0.0196, green: 0.0353, blue: 0.0784, alpha: 1)
    guard
      let buffer = queue.makeCommandBuffer(),
      let encoder = buffer.makeRenderCommandEncoder(descriptor: pass)
    else { return }

    var frameUniforms = uniforms
    frameUniforms.elapsed = interpolated
    encoder.setRenderPipelineState(pipeline)
    encoder.setFragmentTexture(surface, index: 0)
    encoder.setFragmentSamplerState(sampler, index: 0)
    encoder.setFragmentBytes(&frameUniforms, length: MemoryLayout<Uniforms>.stride, index: 0)
    encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
    encoder.endEncoding()
    buffer.present(drawable)
    buffer.commit()
  }

  public func suspend() {
    running = false
  }

  public func retire() {
    running = false
    surface = nil
    pipeline = nil
    sampler = nil
  }

  private func ensureSurface(width: Int, height: Int) {
    if let surface, surface.width == width, surface.height == height { return }
    let descriptor = MTLTextureDescriptor.texture2DDescriptor(
      pixelFormat: .r32Float,
      width: width,
      height: height,
      mipmapped: false
    )
    descriptor.usage = .shaderRead
    descriptor.storageMode = .shared
    surface = device.makeTexture(descriptor: descriptor)
  }
}
#endif
