import Foundation
import XCTest
@testable import ObjetUniverseCore

/// What a hand does to the medium.
///
/// The first build could not be touched at all, and the fix is only real if
/// three things hold: contact lands *where the finger is*, a hold that lasts
/// longer arrives *harder*, and a verb the tank cannot say changes nothing
/// rather than inventing physics. Each test below fails if one of those
/// regresses.
final class WaveInterventionTests: XCTestCase {
  /// A quiet tank: with the ambient drive at zero the only thing that can
  /// move the medium is the command under test, so a reading is a measurement
  /// rather than a sample of the resting sea.
  private func quietKernel() -> WaveKernel {
    WaveKernel(field: WaveField(ambientDrive: 0, seed: 7))
  }

  private func amplitude(_ kernel: WaveKernel, atX nx: Double, y ny: Double) -> Double {
    kernel.withSurface { values, width, height in
      let x = Int((nx * Double(width - 1)).rounded())
      let y = Int((ny * Double(height - 1)).rounded())
      return Double(values[y * width + x])
    }
  }

  /// Total displacement held in the medium. `energy` only updates when the
  /// field steps, and these tests deliberately never step: what is under test
  /// is the intervention itself, not the integrator that `WaveFieldTests`
  /// already pins.
  private func displacement(_ kernel: WaveKernel) -> Double {
    kernel.withSurface { values, width, height in
      var total = 0.0
      for index in 0 ..< (width * height) { total += abs(Double(values[index])) }
      return total
    }
  }

  private func command(_ verb: SemanticVerb, intensity: Double, at origin: SemanticOrigin?) -> SemanticCommand {
    SemanticCommand(id: "test-\(verb.rawValue)", verb: verb, at: 0, intensity: intensity, origin: origin)
  }

  func testAMaterialTouchRingsWhereTheFingerLandedAndNotTheMiddle() {
    let kernel = quietKernel()
    let corner = SemanticOrigin(x: 0.25, y: 0.75)

    _ = kernel.apply(command(.material, intensity: 1, at: corner))

    XCTAssertGreaterThan(
      amplitude(kernel, atX: corner.x, y: corner.y),
      0.5,
      "a decisive strike must raise the medium under the finger"
    )
    XCTAssertEqual(
      amplitude(kernel, atX: 0.5, y: 0.5),
      0,
      accuracy: 1e-6,
      "the middle of the tank is not where the visitor touched"
    )
  }

  func testAPlacelessCommandRingsTheMiddleBecauseNoHandPlacedIt() {
    let kernel = quietKernel()

    // A knock is on the vessel: it happened to the whole device, and the
    // medium answers in the middle of itself.
    _ = kernel.apply(command(.wake, intensity: 1, at: nil))

    XCTAssertGreaterThan(amplitude(kernel, atX: 0.5, y: 0.5), 0.1)
  }

  func testAHoldKeepsDeepeningRatherThanFiringOnceAtItsTier() {
    // The same point, at the intensity a 900 ms dwell carries and the one a
    // 2400 ms dwell carries. A binding that answers both identically is the
    // bug this asserts against.
    let shallow = quietKernel()
    let deep = quietKernel()
    let point = SemanticOrigin(x: 0.4, y: 0.6)

    _ = shallow.apply(command(.grow, intensity: 900.0 / 2500.0, at: point))
    _ = deep.apply(command(.grow, intensity: 2400.0 / 2500.0, at: point))

    let shallowAmplitude = amplitude(shallow, atX: point.x, y: point.y)
    let deepAmplitude = amplitude(deep, atX: point.x, y: point.y)
    XCTAssertGreaterThan(shallowAmplitude, 0, "a dwell has to reach the medium at all")
    XCTAssertGreaterThan(
      deepAmplitude,
      shallowAmplitude * 1.2,
      "duration is an axis: a longer hold must arrive harder, not the same"
    )
  }

  func testRepeatedDwellsAccumulateIntoACharge() {
    let kernel = quietKernel()
    let point = SemanticOrigin(x: 0.5, y: 0.3)

    _ = kernel.apply(command(.grow, intensity: 0.5, at: point))
    let afterOne = amplitude(kernel, atX: point.x, y: point.y)
    for _ in 0 ..< 5 {
      _ = kernel.apply(command(.grow, intensity: 0.5, at: point))
    }

    XCTAssertGreaterThan(
      amplitude(kernel, atX: point.x, y: point.y),
      afterOne * 3,
      "a press that keeps arriving must keep charging the source under it"
    )
  }

  func testAVerbTheTankCannotSayChangesNothing() {
    let kernel = quietKernel()

    for verb in [SemanticVerb.season, .weather, .lens, .gravity, .night, .scale, .pan, .stepBack] {
      XCTAssertFalse(kernel.expresses(verb), "a wave tank has no \(verb.rawValue)")
      _ = kernel.apply(command(verb, intensity: 1, at: SemanticOrigin(x: 0.2, y: 0.2)))
    }

    XCTAssertEqual(
      displacement(kernel),
      0,
      accuracy: 1e-9,
      "an unexpressed verb is answered in the hand and the ear, never as invented physics"
    )
  }

  func testTheDeclaredVocabularyIsWhatTheKernelActuallyAnswers() {
    // A driven tank, because the seeded sources are what `tutti` rings: the
    // vocabulary has to be checked against the medium as it actually ships.
    for verb in SemanticVerb.allCases {
      let probe = WaveKernel(seed: 11)
      let before = displacement(probe)
      _ = probe.apply(command(verb, intensity: 1, at: SemanticOrigin(x: 0.6, y: 0.6)))
      let moved = abs(displacement(probe) - before) > 1e-6
      XCTAssertEqual(
        moved,
        probe.expresses(verb),
        "\(verb.rawValue): `expresses` must agree with what `apply` does, or the input layer answers the wrong way"
      )
    }
  }

  func testTheHostRefusesToPromiseAVerbAfterShutdown() {
    let host = UniverseHost(initial: WaveKernel(), factory: { _ in WaveKernel() })
    XCTAssertTrue(host.expresses(.material))
    host.shutdown()
    XCTAssertFalse(host.expresses(.material), "a retired host expresses nothing")
  }
}

/// The projection the hand and the shader share.
final class MaterialProjectionTests: XCTestCase {
  func testTheMiddleOfTheScreenIsTheMiddleOfTheMaterial() {
    let point = MaterialProjection.materialPoint(
      viewX: 0.5, viewY: 0.5, viewportWidth: 390, viewportHeight: 844
    )
    XCTAssertEqual(point.x, 0.5, accuracy: 1e-12)
    XCTAssertEqual(point.y, 0.5, accuracy: 1e-12)
  }

  func testAPortraitScreenCropsTheShortAxisExactlyAsTheShaderDoes() {
    // `WaveShaderSource` computes `fieldUV = (uv - 0.5) * viewport / longest + 0.5`.
    // The left edge of a 390 × 844 screen is therefore a quarter of the way
    // into the tank, not its left wall — and a touch has to agree, or the
    // ring lands where the finger is not.
    let width = 390.0
    let height = 844.0
    let left = MaterialProjection.materialPoint(viewX: 0, viewY: 0.5, viewportWidth: width, viewportHeight: height)
    let expected = (0 - 0.5) * (width / height) + 0.5
    XCTAssertEqual(left.x, expected, accuracy: 1e-12)
    XCTAssertGreaterThan(left.x, 0.2, "the short axis is cropped, never letterboxed")

    let top = MaterialProjection.materialPoint(viewX: 0.5, viewY: 0, viewportWidth: width, viewportHeight: height)
    XCTAssertEqual(top.y, 0, accuracy: 1e-12, "the long axis shows the whole tank")
  }

  func testALandscapeScreenCropsTheOtherAxis() {
    let point = MaterialProjection.materialPoint(
      viewX: 0.5, viewY: 0, viewportWidth: 844, viewportHeight: 390
    )
    XCTAssertEqual(point.x, 0.5, accuracy: 1e-12)
    XCTAssertEqual(point.y, (0 - 0.5) * (390.0 / 844.0) + 0.5, accuracy: 1e-12)
  }

  func testAnUnmeasurableViewportAnswersWithTheMiddleRatherThanNaN() {
    let zero = MaterialProjection.materialPoint(viewX: 0.3, viewY: 0.3, viewportWidth: 0, viewportHeight: 100)
    XCTAssertEqual(zero.x, 0.5)
    XCTAssertEqual(zero.y, 0.5)

    let nan = MaterialProjection.materialPoint(
      viewX: Double.nan, viewY: 0.3, viewportWidth: 390, viewportHeight: 844
    )
    XCTAssertEqual(nan.x, 0.5)
  }

  func testAnOriginIsAlwaysInsideTheMaterial() {
    let outside = SemanticOrigin(x: -3, y: 12)
    XCTAssertEqual(outside.x, 0)
    XCTAssertEqual(outside.y, 1)
  }
}
