#if canImport(Metal)
import Metal
import XCTest
@testable import ObjetUniverseCore
@testable import ObjetUniverseRender

/// Phone-scale visibility tests for the atom instrument. They execute the
/// shipping shader rather than asserting source strings, so ABI drift, an
/// inert lens, or a near-black fallback cannot pass as an aesthetic revamp.
final class AtomMetalRenderTests: XCTestCase {
  /// The native layer caps at a 2x drawable on a 390 x 844 point phone.
  /// This test keeps pixel-sized atom glyphs honest at the shipping scale.
  private static let outputWidth = 780
  private static let outputHeight = 1_688

  private struct Input {
    let elapsed: Double
    let secondsPerTick: Double
    let representation: Int
    let fusionEnergy: Float
    let bodies: [AtomRenderBody]
    let bonds: [AtomRenderBond]

    func withSnapshot<T>(_ body: (AtomRenderSnapshot) throws -> T) rethrows -> T {
      try bodies.withUnsafeBufferPointer { bodies in
        try bonds.withUnsafeBufferPointer { bonds in
          try body(AtomRenderSnapshot(
            tick: 0,
            elapsedSeconds: elapsed,
            secondsPerTick: secondsPerTick,
            representation: representation,
            fusionEnergy: fusionEnergy,
            bodies: bodies,
            bonds: bonds
          ))
        }
      }
    }
  }

  private final class Fixture {
    private let background: MTLRenderPipelineState
    private let bond: MTLRenderPipelineState
    private let body: MTLRenderPipelineState
    private let uniforms: MTLBuffer
    private let bodies: MTLBuffer
    private let bonds: MTLBuffer
    private let output: MTLTexture
    private let pass = MTLRenderPassDescriptor()
    private let queue: MTLCommandQueue

    init(device: MTLDevice) throws {
      let library = try MetalPipelineCache.shared.library(
        namespace: "atoms-v1",
        device: device,
        source: AtomShaderSource.metal
      )
      background = try Self.pipeline(
        device: device,
        library: library,
        vertex: "objet_atoms_fullscreen_vertex",
        fragment: "objet_atoms_background_fragment",
        blending: false,
        cacheName: "atoms-background-v1"
      )
      bond = try Self.pipeline(
        device: device,
        library: library,
        vertex: "objet_atoms_bond_vertex",
        fragment: "objet_atoms_bond_fragment",
        blending: true,
        cacheName: "atoms-bond-v1"
      )
      body = try Self.pipeline(
        device: device,
        library: library,
        vertex: "objet_atoms_body_vertex",
        fragment: "objet_atoms_body_fragment",
        blending: true,
        cacheName: "atoms-body-v1"
      )
      uniforms = try XCTUnwrap(device.makeBuffer(
        length: MemoryLayout<AtomShaderUniforms>.stride,
        options: .storageModeShared
      ))
      bodies = try XCTUnwrap(device.makeBuffer(
        length: MemoryLayout<AtomGPUBody>.stride * AtomKernel.maximumAtoms,
        options: .storageModeShared
      ))
      bonds = try XCTUnwrap(device.makeBuffer(
        length: MemoryLayout<AtomGPUBond>.stride * AtomKernel.maximumAtoms * (AtomKernel.maximumAtoms - 1) / 2,
        options: .storageModeShared
      ))
      let descriptor = MTLTextureDescriptor.texture2DDescriptor(
        pixelFormat: .bgra8Unorm,
        width: AtomMetalRenderTests.outputWidth,
        height: AtomMetalRenderTests.outputHeight,
        mipmapped: false
      )
      descriptor.storageMode = .shared
      descriptor.usage = .renderTarget
      output = try XCTUnwrap(device.makeTexture(descriptor: descriptor))
      pass.colorAttachments[0].texture = output
      pass.colorAttachments[0].loadAction = .clear
      pass.colorAttachments[0].storeAction = .store
      pass.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)
      queue = try XCTUnwrap(device.makeCommandQueue())
    }

    func render(
      input: Input,
      elapsed: Float? = nil,
      reducedMotion: Bool = false,
      frozenElapsed: Float? = nil
    ) throws -> [UInt8] {
      let maximumBonds = AtomKernel.maximumAtoms * (AtomKernel.maximumAtoms - 1) / 2
      let bodyDestination = UnsafeMutableBufferPointer(
        start: bodies.contents().bindMemory(to: AtomGPUBody.self, capacity: AtomKernel.maximumAtoms),
        count: AtomKernel.maximumAtoms
      )
      let bondDestination = UnsafeMutableBufferPointer(
        start: bonds.contents().bindMemory(to: AtomGPUBond.self, capacity: maximumBonds),
        count: maximumBonds
      )
      let packed = try input.withSnapshot { snapshot in
        try XCTUnwrap(AtomRenderer.pack(snapshot, bodies: bodyDestination, bonds: bondDestination))
      }

      var state = input.withSnapshot(AtomRenderer.makeUniforms)
      state.viewport = SIMD2<Float>(
        Float(AtomMetalRenderTests.outputWidth),
        Float(AtomMetalRenderTests.outputHeight)
      )
      state.elapsed = elapsed ?? Float(input.elapsed)
      state.frozenElapsed = frozenElapsed ?? state.elapsed
      state.fusionEnergy = input.fusionEnergy
      state.representation = UInt32(clamping: input.representation)
      state.bodyCount = UInt32(packed.bodyCount)
      state.reducedMotion = reducedMotion ? 1 : 0
      memcpy(uniforms.contents(), &state, MemoryLayout<AtomShaderUniforms>.stride)

      let command = try XCTUnwrap(queue.makeCommandBuffer())
      let encoder = try XCTUnwrap(command.makeRenderCommandEncoder(descriptor: pass))
      encoder.setRenderPipelineState(background)
      encoder.setFragmentBuffer(uniforms, offset: 0, index: 0)
      encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
      if packed.bondCount > 0 && input.representation != 1 {
        encoder.setRenderPipelineState(bond)
        encoder.setVertexBuffer(bonds, offset: 0, index: 0)
        encoder.setVertexBuffer(uniforms, offset: 0, index: 1)
        encoder.setFragmentBuffer(uniforms, offset: 0, index: 0)
        encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6, instanceCount: packed.bondCount)
      }
      encoder.setRenderPipelineState(body)
      encoder.setVertexBuffer(bodies, offset: 0, index: 0)
      encoder.setVertexBuffer(uniforms, offset: 0, index: 1)
      encoder.setFragmentBuffer(uniforms, offset: 0, index: 0)
      encoder.drawPrimitives(type: .point, vertexStart: 0, vertexCount: packed.bodyCount)
      encoder.endEncoding()
      command.commit()
      command.waitUntilCompleted()
      XCTAssertEqual(command.status, .completed)
      XCTAssertNil(command.error)

      var pixels = [UInt8](
        repeating: 0,
        count: AtomMetalRenderTests.outputWidth * AtomMetalRenderTests.outputHeight * 4
      )
      output.getBytes(
        &pixels,
        bytesPerRow: AtomMetalRenderTests.outputWidth * 4,
        from: MTLRegionMake2D(0, 0, AtomMetalRenderTests.outputWidth, AtomMetalRenderTests.outputHeight),
        mipmapLevel: 0
      )
      return pixels
    }

    private static func pipeline(
      device: MTLDevice,
      library: MTLLibrary,
      vertex: String,
      fragment: String,
      blending: Bool,
      cacheName: String
    ) throws -> MTLRenderPipelineState {
      try MetalPipelineCache.shared.pipeline(
        namespace: cacheName,
        device: device,
        pixelFormat: .bgra8Unorm
      ) {
        let descriptor = MTLRenderPipelineDescriptor()
        descriptor.vertexFunction = library.makeFunction(name: vertex)
        descriptor.fragmentFunction = library.makeFunction(name: fragment)
        descriptor.colorAttachments[0].pixelFormat = .bgra8Unorm
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

  func testAtomBackgroundNeverLoopsOverBodiesPerFragment() {
    let background = AtomShaderSource.metal
      .components(separatedBy: "fragment float4 objet_atoms_background_fragment")[1]
      .components(separatedBy: "vertex BondOut objet_atoms_bond_vertex")[0]
    XCTAssertFalse(background.contains("u.bodyCount"))
  }

  func testAtomicRegistersRenderAsDistinctReadablePhoneScaleMaterials() throws {
    let atom = activeAtom()
    let fixture = try Fixture(device: metalDevice())
    var images: [[UInt8]] = []
    for representation in 0 ... 3 {
      atom.setRepresentation(representation)
      let image = try fixture.render(input: input(for: atom))
      assertReadable(image, register: representation)
      images.append(image)
    }
    for first in 0 ..< images.count {
      for second in (first + 1) ..< images.count {
        assertMaterialDifference(images[first], images[second], firstRegister: first, secondRegister: second)
      }
    }
  }

  func testAtomicMaterialIsDeterministicAndUsesARealBondRelation() throws {
    let atom = activeAtom()
    atom.setRepresentation(2)
    let input = input(for: atom)
    XCTAssertFalse(input.bonds.isEmpty, "the atomic visual test must exercise a kernel-authored covalent relation")
    let fixture = try Fixture(device: metalDevice())
    let first = try fixture.render(input: input)
    let second = try fixture.render(input: input)
    XCTAssertEqual(first, second, "the same atomic snapshot must render byte-for-byte deterministically")
    assertReadable(first, register: 2)
  }

  func testPeriodThreeAtomsRemainInsideTheirPeriodicRegisterColumns() throws {
    let fixture = try Fixture(device: metalDevice())
    for (atomicNumber, column) in [(13, 12), (17, 16), (18, 17)] {
      let body = AtomRenderBody(
        position: .zero,
        velocity: .zero,
        atomicNumber: UInt32(atomicNumber),
        shellCount: 3,
        valence: UInt32(max(0, 18 - atomicNumber)),
        excitation: 0.8
      )
      let image = try fixture.render(input: Input(
        elapsed: 0,
        secondsPerTick: UniverseClock.defaultStepSeconds,
        representation: 1,
        fusionEnergy: 0,
        bodies: [body],
        bonds: []
      ))
      assertBrightPeriodicCell(image, column: column, atomicNumber: atomicNumber)
    }
  }

  func testReducedMotionHoldsDecorativeAtomicPhaseWithoutFreezingAuthority() throws {
    let atom = activeAtom()
    atom.setRepresentation(0)
    let input = input(for: atom)
    let fixture = try Fixture(device: metalDevice())
    let held = try fixture.render(input: input, elapsed: 2, reducedMotion: true, frozenElapsed: 2)
    let sourceAdvanced = try fixture.render(input: input, elapsed: 29, reducedMotion: true, frozenElapsed: 2)
    let animated = try fixture.render(input: input, elapsed: 29, reducedMotion: false, frozenElapsed: 2)
    XCTAssertEqual(held, sourceAdvanced, "reduced motion must keep atomic orbital phase at its readable detent")
    XCTAssertNotEqual(held, animated, "leaving the detent must restore the living orbital material")
  }

  private func activeAtom() -> AtomKernel {
    let atom = AtomKernel(seed: 0xA70A_2026)
    for index in 0 ..< 4 {
      _ = atom.apply(.init(id: "atom-grow-\(index)", verb: .grow, at: Double(index), origin: .centre))
    }
    for index in 0 ..< 4 {
      _ = atom.apply(.init(id: "atom-tutti-\(index)", verb: .tutti, at: Double(index)))
    }
    _ = atom.advance(ticks: 48)
    return atom
  }

  private func input(for atom: AtomKernel) -> Input {
    atom.withAtomRenderSnapshot { snapshot in
      Input(
        elapsed: snapshot.elapsedSeconds,
        secondsPerTick: snapshot.secondsPerTick,
        representation: snapshot.representation,
        fusionEnergy: snapshot.fusionEnergy,
        bodies: Array(snapshot.bodies),
        bonds: Array(snapshot.bonds)
      )
    }
  }

  private func metalDevice() throws -> MTLDevice {
    guard let device = MTLCreateSystemDefaultDevice() else {
      if ProcessInfo.processInfo.environment["CI"] == "true" {
        XCTFail("Native CI must expose Metal; skipping would remove the atomic visibility gate")
        throw NSError(domain: "ObjetUniverse", code: 1)
      }
      throw XCTSkip("this local host exposes no Metal device; Native CI remains the mandatory shader gate")
    }
    return device
  }

  private func assertReadable(_ pixels: [UInt8], register: Int) {
    var sum = 0.0
    var sumOfSquares = 0.0
    var brightCount = 0
    var darkCount = 0
    let pixelCount = pixels.count / 4
    for index in stride(from: 0, to: pixels.count, by: 4) {
      let luminance = 0.0722 * Double(pixels[index]) / 255
        + 0.7152 * Double(pixels[index + 1]) / 255
        + 0.2126 * Double(pixels[index + 2]) / 255
      sum += luminance
      sumOfSquares += luminance * luminance
      if luminance > 0.14 { brightCount += 1 }
      if luminance < 0.12 { darkCount += 1 }
    }
    let mean = sum / Double(pixelCount)
    let variance = sumOfSquares / Double(pixelCount) - mean * mean
    let brightFraction = Double(brightCount) / Double(pixelCount)
    let darkFraction = Double(darkCount) / Double(pixelCount)
    let description = "mean \(mean), variance \(variance), bright \(brightFraction), dark \(darkFraction)"
    XCTAssertGreaterThan(mean, 0.016, "atomic register \(register) must stay visible above night; \(description)")
    XCTAssertGreaterThan(variance, 0.00006, "atomic register \(register) must contain material structure; \(description)")
    XCTAssertGreaterThan(brightFraction, 0.0015, "atomic register \(register) must occupy visible phone pixels; \(description)")
    XCTAssertGreaterThan(darkFraction, 0.30, "atomic register \(register) must retain dark breathing space; \(description)")
  }

  private func assertMaterialDifference(
    _ first: [UInt8],
    _ second: [UInt8],
    firstRegister: Int,
    secondRegister: Int
  ) {
    XCTAssertEqual(first.count, second.count)
    var changedPixels = 0
    var totalDelta = 0
    for index in stride(from: 0, to: first.count, by: 4) {
      let delta = abs(Int(first[index]) - Int(second[index]))
        + abs(Int(first[index + 1]) - Int(second[index + 1]))
        + abs(Int(first[index + 2]) - Int(second[index + 2]))
      totalDelta += delta
      if delta > 8 { changedPixels += 1 }
    }
    let pixelCount = Double(first.count / 4)
    let changedFraction = Double(changedPixels) / pixelCount
    let meanDelta = Double(totalDelta) / (Double(first.count) * 255)
    let description = "changed \(changedFraction), mean delta \(meanDelta)"
    XCTAssertGreaterThan(changedFraction, 0.008, "atomic registers \(firstRegister) and \(secondRegister) must visibly differ; \(description)")
    XCTAssertGreaterThan(meanDelta, 0.0015, "atomic registers \(firstRegister) and \(secondRegister) must materially differ; \(description)")
  }

  private func assertBrightPeriodicCell(_ pixels: [UInt8], column: Int, atomicNumber: Int) {
    let materialX = (Float(column) - 8.5) / 9.5
    let expectedX = Int((materialX + 1) * 0.5 * Float(Self.outputWidth))
    let lowerX = max(0, expectedX - 42)
    let upperX = min(Self.outputWidth - 1, expectedX + 42)
    var brightPixels = 0
    for y in 0 ..< Self.outputHeight {
      for x in lowerX ... upperX {
        let index = (y * Self.outputWidth + x) * 4
        let luminance = 0.0722 * Double(pixels[index]) / 255
          + 0.7152 * Double(pixels[index + 1]) / 255
          + 0.2126 * Double(pixels[index + 2]) / 255
        if luminance > 0.18 { brightPixels += 1 }
      }
    }
    XCTAssertGreaterThan(
      brightPixels,
      50,
      "Z=\(atomicNumber) must occupy periodic column \(column), not an off-register or clipped cell"
    )
  }

}
#else
import XCTest

final class AtomMetalAvailabilityTests: XCTestCase {
  func testNativeCIMustExposeMetal() throws {
    if ProcessInfo.processInfo.environment["CI"] == "true" {
      XCTFail("Native CI must compile and execute the atomic Metal visibility gate")
      return
    }
    throw XCTSkip("this non-native local host does not expose Metal")
  }
}
#endif
