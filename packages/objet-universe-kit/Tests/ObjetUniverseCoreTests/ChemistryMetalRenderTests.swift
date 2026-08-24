#if canImport(Metal)
import Foundation
import Metal
import XCTest
@testable import ObjetUniverseCore
@testable import ObjetUniverseRender

/// Atom and Molecule share a shipping GPU material. Compile and execute both
/// inputs so route selection cannot leave a black chemistry room.
final class ChemistryMetalRenderTests: XCTestCase {
  private final class Fixture {
    private let pipeline: MTLRenderPipelineState
    private let sampler: MTLSamplerState
    private let field: MTLTexture
    private let output: MTLTexture
    private let pass = MTLRenderPassDescriptor()
    private let queue: MTLCommandQueue

    init(width: Int, height: Int, device: MTLDevice) throws {
      let library = try MetalPipelineCache.shared.library(
        namespace: "chemistry-v1",
        device: device,
        source: ChemistryShaderSource.metal
      )
      pipeline = try MetalPipelineCache.shared.pipeline(
        namespace: "chemistry-v1",
        device: device,
        pixelFormat: .bgra8Unorm
      ) {
        let descriptor = MTLRenderPipelineDescriptor()
        descriptor.vertexFunction = library.makeFunction(name: "objet_chemistry_vertex")
        descriptor.fragmentFunction = library.makeFunction(name: "objet_chemistry_fragment")
        descriptor.colorAttachments[0].pixelFormat = .bgra8Unorm
        return try device.makeRenderPipelineState(descriptor: descriptor)
      }

      let samplerDescriptor = MTLSamplerDescriptor()
      samplerDescriptor.minFilter = .linear
      samplerDescriptor.magFilter = .linear
      samplerDescriptor.sAddressMode = .clampToEdge
      samplerDescriptor.tAddressMode = .clampToEdge
      sampler = try XCTUnwrap(device.makeSamplerState(descriptor: samplerDescriptor))

      let fieldDescriptor = MTLTextureDescriptor.texture2DDescriptor(
        pixelFormat: .r32Float,
        width: width,
        height: height,
        mipmapped: false
      )
      fieldDescriptor.storageMode = .shared
      fieldDescriptor.usage = .shaderRead
      field = try XCTUnwrap(device.makeTexture(descriptor: fieldDescriptor))

      let outputDescriptor = MTLTextureDescriptor.texture2DDescriptor(
        pixelFormat: .bgra8Unorm,
        width: 96,
        height: 96,
        mipmapped: false
      )
      outputDescriptor.storageMode = .shared
      outputDescriptor.usage = .renderTarget
      output = try XCTUnwrap(device.makeTexture(descriptor: outputDescriptor))

      pass.colorAttachments[0].texture = output
      pass.colorAttachments[0].loadAction = .clear
      pass.colorAttachments[0].storeAction = .store
      pass.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)
      queue = try XCTUnwrap(device.makeCommandQueue())
    }

    func render(
      values: UnsafePointer<Float>,
      width: Int,
      height: Int,
      elapsed: Double,
      exposure: Double,
      representation: Int,
      materialKind: Int
    ) throws -> [UInt8] {
      field.replace(
        region: MTLRegionMake2D(0, 0, width, height),
        mipmapLevel: 0,
        withBytes: values,
        bytesPerRow: width * MemoryLayout<Float>.stride
      )
      let command = try XCTUnwrap(queue.makeCommandBuffer())
      let encoder = try XCTUnwrap(command.makeRenderCommandEncoder(descriptor: pass))
      var uniforms = ChemistryShaderUniforms()
      uniforms.viewport = SIMD2<Float>(96, 96)
      uniforms.fieldSize = SIMD2<Float>(Float(width), Float(height))
      uniforms.state = SIMD4<Float>(
        Float(elapsed),
        Float(exposure),
        Float(representation),
        Float(materialKind)
      )
      encoder.setRenderPipelineState(pipeline)
      encoder.setFragmentTexture(field, index: 0)
      encoder.setFragmentSamplerState(sampler, index: 0)
      encoder.setFragmentBytes(&uniforms, length: MemoryLayout<ChemistryShaderUniforms>.stride, index: 0)
      encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
      encoder.endEncoding()
      command.commit()
      command.waitUntilCompleted()
      XCTAssertEqual(command.status, .completed)
      XCTAssertNil(command.error)

      var bytes = [UInt8](repeating: 0, count: 96 * 96 * 4)
      output.getBytes(
        &bytes,
        bytesPerRow: 96 * 4,
        from: MTLRegionMake2D(0, 0, 96, 96),
        mipmapLevel: 0
      )
      return bytes
    }
  }

  func testEveryChemistryRepresentationRendersVisibleMaterials() throws {
    let atom = activeAtom()
    let molecule = activeMolecule()
    let fixture = try Fixture(width: atom.width, height: atom.height, device: metalDevice())

    for representation in 0 ... 3 {
      atom.setRepresentation(representation)
      molecule.setRepresentation(representation)

      let atomicPixels = try render(source: sourceField(for: atom), kernel: atom, fixture: fixture)
      let molecularPixels = try render(source: sourceField(for: molecule), kernel: molecule, fixture: fixture)

      assertVisible(atomicPixels, name: "atoms representation \(representation)")
      assertVisible(molecularPixels, name: "molecules representation \(representation)")
      XCTAssertFalse(
        atomicPixels.elementsEqual(molecularPixels),
        "chemistry materials must remain distinct at representation \(representation)"
      )
    }
  }

  func testMaterialKindSelectsChemistryShaderBranchForSameSourceField() throws {
    let atom = activeAtom()
    let fixture = try Fixture(width: atom.width, height: atom.height, device: metalDevice())
    let source = sourceField(for: atom)

    let atomBranch = try render(source: source, kernel: atom, fixture: fixture, materialKind: 3)
    let moleculeBranch = try render(source: source, kernel: atom, fixture: fixture, materialKind: 4)

    assertVisible(atomBranch, name: "atom material branch")
    assertVisible(moleculeBranch, name: "molecule material branch")
    XCTAssertFalse(
      atomBranch.elementsEqual(moleculeBranch),
      "material kind must reach the shader branch when the source field is unchanged"
    )
  }

  private struct SourceField {
    let values: [Float]
    let width: Int
    let height: Int
  }

  private func sourceField(for kernel: some SurfaceSimulationKernel) -> SourceField {
    kernel.withSurface { values, width, height in
      SourceField(
        values: Array(UnsafeBufferPointer(start: values, count: width * height)),
        width: width,
        height: height
      )
    }
  }

  private func render(
    source: SourceField,
    kernel: some SurfaceSimulationKernel,
    fixture: Fixture,
    materialKind: Int? = nil
  ) throws -> [UInt8] {
    try source.values.withUnsafeBufferPointer { values in
      try fixture.render(
        values: try XCTUnwrap(values.baseAddress),
        width: source.width,
        height: source.height,
        elapsed: kernel.elapsedSeconds,
        exposure: kernel.exposure,
        representation: kernel.representationIndex,
        materialKind: materialKind ?? kernel.materialKind
      )
    }
  }

  private func activeAtom() -> AtomKernel {
    let atom = AtomKernel(seed: 0xA70A_2026)
    for index in 0 ..< 4 {
      _ = atom.apply(.init(id: "atom-grow-\(index)", verb: .grow, at: Double(index), origin: .centre))
    }
    for index in 0 ..< 4 {
      _ = atom.apply(.init(id: "atom-tutti-\(index)", verb: .tutti, at: Double(index)))
    }
    _ = atom.advance(ticks: 12)
    return atom
  }

  private func activeMolecule() -> MoleculeKernel {
    let molecule = MoleculeKernel(seed: 0xC8E0_2026)
    for index in 0 ..< 4 {
      _ = molecule.apply(.init(id: "molecule-tutti-\(index)", verb: .tutti, at: Double(index)))
    }
    _ = molecule.advance(ticks: 12)
    return molecule
  }

  private func metalDevice() throws -> MTLDevice {
    guard let device = MTLCreateSystemDefaultDevice() else {
      if ProcessInfo.processInfo.environment["CI"] == "true" {
        XCTFail("Native CI must expose Metal for chemistry bridge coverage")
        throw NSError(domain: "ObjetUniverse", code: 1)
      }
      throw XCTSkip("this local host exposes no Metal device; Native CI remains the mandatory shader gate")
    }
    return device
  }

  private func assertVisible(_ pixels: [UInt8], name: String) {
    let luminance = stride(from: 0, to: pixels.count, by: 4).map { index -> Double in
      let blue = Double(pixels[index]) / 255
      let green = Double(pixels[index + 1]) / 255
      let red = Double(pixels[index + 2]) / 255
      return 0.0722 * blue + 0.7152 * green + 0.2126 * red
    }
    let mean = luminance.reduce(0, +) / Double(luminance.count)
    let variance = luminance.reduce(0) { total, value in
      let delta = value - mean
      return total + delta * delta
    } / Double(luminance.count)
    XCTAssertGreaterThan(mean, 0.015, "\(name) bridge material must stay above a black fallback")
    XCTAssertGreaterThan(variance, 0.00005, "\(name) bridge material must retain visible structure")
  }
}
#endif
