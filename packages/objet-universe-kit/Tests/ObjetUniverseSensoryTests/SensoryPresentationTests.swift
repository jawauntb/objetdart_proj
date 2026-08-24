import XCTest
@testable import ObjetUniverseSensory

final class SensoryPresentationTests: XCTestCase {
  func testReducedMotionAttenuatesPhysicalEnergyWithoutChangingEventMeaning() {
    let event = SensoryEvent(
      id: "cell-division-8",
      signature: .bloom,
      clock: SensoryClock(logicalTick: 8, wallOffset: 0.012),
      energy: 0.8,
      frequencyHz: 440,
      senses: [.visual, .audio, .haptic]
    )

    let reduced = SensoryPresentation.event(event, reducedMotion: true)

    XCTAssertEqual(reduced.id, event.id)
    XCTAssertEqual(reduced.signature, event.signature)
    XCTAssertEqual(reduced.clock, event.clock)
    XCTAssertEqual(reduced.frequencyHz, event.frequencyHz)
    XCTAssertEqual(reduced.senses, event.senses)
    XCTAssertLessThan(reduced.derivation.energy, event.derivation.energy)
    XCTAssertEqual(
      reduced.derivation.energy,
      event.derivation.energy * SensoryPresentation.reducedMotionAmplitude,
      accuracy: 1e-12
    )
    XCTAssertGreaterThanOrEqual(
      reduced.derivation.energy,
      SensoryPresentation.minimumAudibleEnergy
    )
    XCTAssertEqual(SensoryPresentation.event(event, reducedMotion: false), event)
  }

  func testReducedMotionKeepsAudibleActsAboveTheFloorWithoutMakingSoftActsLouder() {
    let audible = SensoryEvent(
      id: "soft-but-audible",
      signature: .tap,
      clock: SensoryClock(logicalTick: 10),
      energy: 0.15
    )
    let quiet = SensoryEvent(
      id: "quiet-collision",
      signature: .crossing,
      clock: SensoryClock(logicalTick: 11),
      energy: 0.05
    )

    XCTAssertEqual(
      SensoryPresentation.event(audible, reducedMotion: true).derivation.energy,
      SensoryPresentation.minimumAudibleEnergy,
      accuracy: 1e-12
    )
    XCTAssertEqual(
      SensoryPresentation.event(quiet, reducedMotion: true).derivation.energy,
      quiet.derivation.energy,
      accuracy: 1e-12
    )
  }

  func testReducedMotionDoesNotInventFeedbackForAZeroEnergyEvent() {
    let silent = SensoryEvent(
      id: "empty-field",
      signature: .ripple,
      clock: SensoryClock(logicalTick: 9),
      energy: 0
    )

    XCTAssertEqual(SensoryPresentation.event(silent, reducedMotion: true), silent)
  }

  func testReducedMotionEnergyIsMonotonicAndNeverAmplifiesAnEvent() {
    var previousEnergy = 0.0
    for step in 0 ... 100 {
      let energy = Double(step) / 100
      let event = SensoryEvent(
        id: "energy-\(step)",
        signature: .tap,
        clock: SensoryClock(logicalTick: step),
        energy: energy
      )
      let reducedEnergy = SensoryPresentation.event(event, reducedMotion: true).derivation.energy

      XCTAssertGreaterThanOrEqual(reducedEnergy, previousEnergy)
      XCTAssertLessThanOrEqual(reducedEnergy, energy)
      previousEnergy = reducedEnergy
    }
  }
}
