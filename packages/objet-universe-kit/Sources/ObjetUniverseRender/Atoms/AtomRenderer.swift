#if canImport(Metal) && canImport(QuartzCore)
import Dispatch
import Foundation
import Metal
#if SWIFT_PACKAGE
import ObjetUniverseCore
#endif
import QuartzCore
import simd

/// Swift's side of the atom shader ABI. The render test imports this layout so
/// a packing drift cannot pass locally while breaking the device material.
struct AtomShaderUniforms {
  var viewport = SIMD2<Float>(1, 1)
  var elapsed: Float = 0
  var frozenElapsed: Float = 0
  var fusionEnergy: Float = 0
  var representation: UInt32 = 0
  var bodyCount: UInt32 = 0
  var reducedMotion: UInt32 = 0
  var breathSeconds: Float = Float(WaveField.breathSeconds)
}

/// Fixed GPU records copied from the borrowed atomic snapshot. The renderer
/// owns these buffers; the kernel never exposes its live arrays beyond the
/// duration of submission.
struct AtomGPUBody {
  /// material x, material y, excitation, atomic number
  var positionExcitation = SIMD4<Float>(repeating: 0)
  /// shell count, valence, x velocity, y velocity
  var shellValenceVelocity = SIMD4<Float>(repeating: 0)
}

struct AtomGPUBond {
  /// first x, first y, second x, second y
  var endpoints = SIMD4<Float>(repeating: 0)
  /// bond order, first Z, second Z, shared excitation
  var relation = SIMD4<Float>(repeating: 0)
}

/// The exact frame payload submitted to Metal. Keeping this conversion on
/// AtomRenderer lets the shipping renderer and the visual fixture share one
/// bounded interpretation of the borrowed kernel snapshot.
struct AtomGPUUpload {
  let bodyCount: Int
  let bondCount: Int
}

private struct AtomPipelineBundle {
  let background: MTLRenderPipelineState
  let bond: MTLRenderPipelineState
  let body: MTLRenderPipelineState
}

private final class AtomPipelineCompiler: @unchecked Sendable {
  private let device: MTLDevice

  init(device: MTLDevice) {
    self.device = device
  }

  func makePipelines(pixelFormat: MTLPixelFormat) throws -> AtomPipelineBundle {
    let library = try MetalPipelineCache.shared.library(
      namespace: "atoms-v1",
      device: device,
      source: AtomShaderSource.metal
    )
    return try AtomPipelineBundle(
      background: makePipeline(
        library: library,
        vertex: "objet_atoms_fullscreen_vertex",
        fragment: "objet_atoms_background_fragment",
        blending: false,
        cacheName: "atoms-background-v1",
        pixelFormat: pixelFormat
      ),
      bond: makePipeline(
        library: library,
        vertex: "objet_atoms_bond_vertex",
        fragment: "objet_atoms_bond_fragment",
        blending: true,
        cacheName: "atoms-bond-v1",
        pixelFormat: pixelFormat
      ),
      body: makePipeline(
        library: library,
        vertex: "objet_atoms_body_vertex",
        fragment: "objet_atoms_body_fragment",
        blending: true,
        cacheName: "atoms-body-v1",
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

/// The atomic material draws actual nuclei, shells, and covalent relations.
/// It is intentionally a different presentation seam from scalar chemistry:
/// neither atomic number nor bond order can be reconstructed from heat alone.
public final class AtomRenderer: AtomSystemRenderer, ReducedMotionRenderer {
  public let kind: RendererKind = .metal

  private static let maximumBodies = AtomKernel.maximumAtoms
  private static let maximumBonds = maximumBodies * (maximumBodies - 1) / 2
  private static let framesInFlight = 3
  private static let pipelinePreparationQueue = DispatchQueue(
    label: "art.objet.atoms-pipeline-preparation",
    qos: .userInitiated
  )

  private final class FrameResources {
    let uniforms: MTLBuffer
    let bodies: MTLBuffer
    let bonds: MTLBuffer
    var bodyCount = 0
    var bondCount = 0
    var secondsPerStep: Double = 0

    init?(device: MTLDevice) {
      guard
        let uniforms = device.makeBuffer(
          length: MemoryLayout<AtomShaderUniforms>.stride,
          options: .storageModeShared
        ),
        let bodies = device.makeBuffer(
          length: MemoryLayout<AtomGPUBody>.stride * AtomRenderer.maximumBodies,
          options: .storageModeShared
        ),
        let bonds = device.makeBuffer(
          length: MemoryLayout<AtomGPUBond>.stride * AtomRenderer.maximumBonds,
          options: .storageModeShared
        )
      else { return nil }
      self.uniforms = uniforms
      self.bodies = bodies
      self.bonds = bonds
    }
  }

  private let layer: CAMetalLayer
  private let device: MTLDevice
  private let queue: MTLCommandQueue
  private let pipelineCompiler: AtomPipelineCompiler
  private let frames: [FrameResources]
  private let frameSlots = MetalFrameSlotPool(capacity: AtomRenderer.framesInFlight)
  private let pass = MTLRenderPassDescriptor()
  private let pipelinePublication = MetalPipelinePublication<AtomPipelineBundle>()
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
    self.device = device
    self.queue = queue
    pipelineCompiler = AtomPipelineCompiler(device: device)
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

  public func submitAtoms(_ snapshot: AtomRenderSnapshot) {
    if reservedFrameIndex == nil {
      guard let acquired = frameSlots.tryAcquire() else { return }
      reservedFrameIndex = acquired
    }
    guard let reservedFrameIndex else { return }

    let frame = frames[reservedFrameIndex]
    let bodyDestination = UnsafeMutableBufferPointer(
      start: frame.bodies.contents().bindMemory(to: AtomGPUBody.self, capacity: Self.maximumBodies),
      count: Self.maximumBodies
    )
    let bondDestination = UnsafeMutableBufferPointer(
      start: frame.bonds.contents().bindMemory(to: AtomGPUBond.self, capacity: Self.maximumBonds),
      count: Self.maximumBonds
    )
    guard let upload = Self.pack(snapshot, bodies: bodyDestination, bonds: bondDestination) else {
      releaseReservedFrame()
      return
    }

    var uniforms = Self.makeUniforms(for: snapshot)
    uniforms.bodyCount = UInt32(upload.bodyCount)
    memcpy(frame.uniforms.contents(), &uniforms, MemoryLayout<AtomShaderUniforms>.stride)
    frame.bodyCount = upload.bodyCount
    frame.bondCount = upload.bondCount
    frame.secondsPerStep = snapshot.secondsPerTick
    presentationTiming.recordSubmitted(elapsed: Float(snapshot.elapsedSeconds))
  }

  public func render(interpolation: Double) {
    guard running, let reservedFrameIndex else { return }
    guard let pipelines = pipelinePublication.snapshot() else {
      let readiness = pipelineRetry.nextAction(isPreparing: pipelinePublication.isPreparing())
      releaseReservedFrame()
      // A cold atomic transition must not show the outgoing scene's material.
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
    let uniforms = frame.uniforms.contents().bindMemory(to: AtomShaderUniforms.self, capacity: 1)
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

    // The periodic reading rearranges identities into their register. A
    // covalent line follows the material positions, not that presentation
    // grid, so it belongs in the orbit/bond/fusion readings only.
    if frame.bondCount > 0 && uniforms.pointee.representation != 1 {
      encoder.setRenderPipelineState(pipelines.bond)
      encoder.setVertexBuffer(frame.bonds, offset: 0, index: 0)
      encoder.setVertexBuffer(frame.uniforms, offset: 0, index: 1)
      encoder.setFragmentBuffer(frame.uniforms, offset: 0, index: 0)
      encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6, instanceCount: frame.bondCount)
    }

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

  /// Bounded admission is part of the renderer's contract: malformed
  /// snapshots are ignored rather than allowing a bad record to index a GPU
  /// buffer beyond the atom kernel's declared population cap.
  static func acceptsSnapshot(bodyCount: Int, bondCount: Int) -> Bool {
    bodyCount >= 0 && bodyCount <= Self.maximumBodies
      && bondCount >= 0 && bondCount <= Self.maximumBonds
  }

  /// Copy and validate one borrowed kernel snapshot into renderer-owned GPU
  /// storage. The caller provides fixed-capacity buffers so no frame allocates.
  static func pack(
    _ snapshot: AtomRenderSnapshot,
    bodies destinationBodies: UnsafeMutableBufferPointer<AtomGPUBody>,
    bonds destinationBonds: UnsafeMutableBufferPointer<AtomGPUBond>
  ) -> AtomGPUUpload? {
    guard
      Self.acceptsSnapshot(bodyCount: snapshot.bodies.count, bondCount: snapshot.bonds.count),
      destinationBodies.count >= Self.maximumBodies,
      destinationBonds.count >= Self.maximumBonds
    else { return nil }

    for index in snapshot.bodies.indices {
      let body = snapshot.bodies[index]
      destinationBodies[index] = AtomGPUBody(
        positionExcitation: SIMD4<Float>(
          body.position.x,
          body.position.y,
          min(max(body.excitation, 0), 1),
          Float(body.atomicNumber)
        ),
        shellValenceVelocity: SIMD4<Float>(
          Float(body.shellCount),
          Float(body.valence),
          body.velocity.x,
          body.velocity.y
        )
      )
    }

    var acceptedBondCount = 0
    for bond in snapshot.bonds {
      let firstIndex = Int(bond.firstIndex)
      let secondIndex = Int(bond.secondIndex)
      guard firstIndex < snapshot.bodies.count, secondIndex < snapshot.bodies.count, firstIndex != secondIndex else { continue }
      let first = snapshot.bodies[firstIndex]
      let second = snapshot.bodies[secondIndex]
      destinationBonds[acceptedBondCount] = AtomGPUBond(
        endpoints: SIMD4<Float>(first.position.x, first.position.y, second.position.x, second.position.y),
        relation: SIMD4<Float>(
          Float(bond.order),
          Float(first.atomicNumber),
          Float(second.atomicNumber),
          min(max((first.excitation + second.excitation) * 0.5, 0), 1)
        )
      )
      acceptedBondCount += 1
    }
    return AtomGPUUpload(bodyCount: snapshot.bodies.count, bondCount: acceptedBondCount)
  }

  static func makeUniforms(for snapshot: AtomRenderSnapshot) -> AtomShaderUniforms {
    var uniforms = AtomShaderUniforms()
    uniforms.elapsed = Float(snapshot.elapsedSeconds)
    uniforms.fusionEnergy = Float(min(max(snapshot.fusionEnergy, -8), 8))
    uniforms.representation = UInt32(clamping: snapshot.representation)
    uniforms.bodyCount = UInt32(snapshot.bodies.count)
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
