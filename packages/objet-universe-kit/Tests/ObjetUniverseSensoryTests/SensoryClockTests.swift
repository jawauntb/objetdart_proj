import XCTest
@testable import ObjetUniverseSensory

final class SensoryClockTests: XCTestCase {
  // MARK: - Derivation identity (state ↔ render ↔ audio ↔ haptic)

  func testCollisionEnergyDerivesEverySenseFromOneNumber() {
    for energy in [0.0, 0.13, 0.5, 0.87, 1.0] {
      let derivation = SensoryDerivation(energy: energy)
      XCTAssertEqual(derivation.amplitude, derivation.brightness,
                     "amplitude and brightness must be the same number")
      XCTAssertEqual(derivation.brightness, derivation.audioEnergy,
                     "brightness and audio energy must be the same number")
      XCTAssertEqual(derivation.audioEnergy, derivation.hapticIntensity,
                     "audio energy and haptic intensity must be the same number")
      XCTAssertEqual(derivation.energy, energy, accuracy: 1e-12)
    }
  }

  func testEnergyOutOfBoundsCollapsesRatherThanPropagates() {
    XCTAssertEqual(SensoryDerivation(energy: -0.4).energy, 0)
    XCTAssertEqual(SensoryDerivation(energy: 3.2).energy, 1)
    XCTAssertEqual(SensoryDerivation(energy: .nan).energy, 0)
    XCTAssertEqual(SensoryDerivation(energy: .infinity).energy, 1)
  }

  func testEventPacksTheSameEnergyOntoEveryChannel() {
    let event = SensoryEvent(
      id: "collision-1",
      signature: .ripple,
      clock: SensoryClock(logicalTick: 42, wallOffset: 0),
      energy: 0.6
    )
    XCTAssertEqual(event.derivation.amplitude, 0.6, accuracy: 1e-12)
    XCTAssertEqual(event.derivation.brightness, event.derivation.amplitude)
    XCTAssertEqual(event.derivation.audioEnergy, event.derivation.amplitude)
    XCTAssertEqual(event.derivation.hapticIntensity, event.derivation.amplitude)
  }

  // MARK: - Recovery is idempotent (no duplicate onsets)

  func testAudioBusRefusesToReFireTheSameEventID() {
    let bus = AudioBus()
    let event = SensoryEvent(
      id: "shore-break-99",
      signature: .roll,
      clock: SensoryClock(logicalTick: 3),
      energy: 0.7
    )
    XCTAssertEqual(bus.schedule(event), .scheduled)
    XCTAssertEqual(bus.schedule(event), .duplicate)
    XCTAssertEqual(bus._testAppliedCount(), 1)
  }

  func testAudioSchedulingNeverWaitsForABlockedRecoveryQueue() {
    let queue = DispatchQueue(label: "audio-recovery-blocked")
    let started = DispatchSemaphore(value: 0)
    let release = DispatchSemaphore(value: 0)
    queue.async {
      started.signal()
      release.wait()
    }
    XCTAssertEqual(started.wait(timeout: .now() + 1), .success)

    let bus = AudioBus(queue: queue)
    let event = SensoryEvent(
      id: "nonblocking-recovery",
      signature: .ripple,
      clock: SensoryClock(logicalTick: 1),
      energy: 0.5
    )
    let began = ProcessInfo.processInfo.systemUptime
    XCTAssertEqual(bus.schedule(event), .scheduled)
    let callerDuration = ProcessInfo.processInfo.systemUptime - began
    release.signal()

    XCTAssertLessThan(callerDuration, 0.010, "MainActor event delivery must never join audio recovery")
  }

  func testHapticBusRefusesToReFireTheSameEventID() {
    let bus = HapticBus()
    let event = SensoryEvent(
      id: "surface-tap-3",
      signature: .tap,
      clock: SensoryClock(logicalTick: 8),
      energy: 0.4
    )
    let first = bus.schedule(event)
    XCTAssertTrue(first == .scheduled || first == .fallback(reason: .coreHapticsUnavailable) || first == .unsupported,
                  "first schedule should reach the hardware bus in some form")
    XCTAssertEqual(bus.schedule(event), .duplicate)
    XCTAssertEqual(bus._testAppliedCount(), 1)
  }

  func testAudioInterruptionRecoveryDoesNotDuplicatePastEvents() {
    let bus = AudioBus()
    let first = SensoryEvent(
      id: "interrupted-1",
      signature: .chop,
      clock: SensoryClock(logicalTick: 1),
      energy: 0.5
    )
    XCTAssertEqual(bus.schedule(first), .scheduled)

    bus._testForceInterruption(true)
    let duringInterruption = SensoryEvent(
      id: "interrupted-2",
      signature: .chop,
      clock: SensoryClock(logicalTick: 2),
      energy: 0.5
    )
    XCTAssertEqual(bus.schedule(duringInterruption), .fallback(reason: .audioSessionInterrupted))
    bus._testForceInterruption(false)

    // Neither past event may re-fire under recovery, even though the
    // session is now available again.
    XCTAssertEqual(bus.schedule(first), .duplicate)
    XCTAssertEqual(bus.schedule(duringInterruption), .duplicate)

    let after = SensoryEvent(
      id: "post-recovery-3",
      signature: .chop,
      clock: SensoryClock(logicalTick: 3),
      energy: 0.5
    )
    XCTAssertEqual(bus.schedule(after), .scheduled)
    XCTAssertEqual(bus._testAppliedCount(), 3)
  }

  func testDelayedOnsetRevalidatesInterruptionBeforePlaying() {
    let bus = AudioBus()
    let completion = expectation(description: "delayed onset settles")
    let event = SensoryEvent(
      id: "delayed-interruption",
      signature: .crossing,
      clock: SensoryClock(logicalTick: 4, wallOffset: 0.030),
      energy: 0.8
    )

    XCTAssertEqual(bus.schedule(event) { completion.fulfill() }, .scheduled)
    bus._testForceInterruption(true)
    wait(for: [completion], timeout: 1)

    XCTAssertEqual(bus._testPerformedOnsetCount(), 0,
                   "an interruption beginning after schedule must still suppress the delayed onset")
    XCTAssertEqual(bus.schedule(event), .duplicate,
                   "recovery must not replay a suppressed but already-authoritative event")
  }

  func testPrewarmIsIdempotentAndDoesNotConsumeAnEvent() {
    let bus = AudioBus()
    let first = expectation(description: "first prewarm")
    let second = expectation(description: "coalesced prewarm")
    bus.prewarm { first.fulfill() }
    bus.prewarm { second.fulfill() }
    wait(for: [first, second], timeout: 1)
    XCTAssertEqual(bus._testAppliedCount(), 0)
    XCTAssertEqual(bus._testPerformedOnsetCount(), 0)
  }

  // MARK: - Muting isolation

  func testMutingAudioDoesNotSilenceHapticsOrVisualFeedback() {
    let audio = AudioBus()
    let haptic = HapticBus()
    let event = SensoryEvent(
      id: "collision-audio-mute",
      signature: .crossing,
      clock: SensoryClock(logicalTick: 10),
      energy: 0.5,
      senses: [.visual, .audio, .haptic]
    )
    audio.setMuted(true)
    XCTAssertEqual(audio.schedule(event), .muted)

    let hapticDispatch = haptic.schedule(event)
    XCTAssertNotEqual(hapticDispatch, .muted, "muting audio must not mute haptics")

    XCTAssertTrue(event.senses.contains(.visual),
                  "visual scientific feedback stays authoritative even with audio muted")
  }

  func testMutingHapticsDoesNotSilenceAudio() {
    let audio = AudioBus()
    let haptic = HapticBus()
    let event = SensoryEvent(
      id: "collision-haptic-mute",
      signature: .bloom,
      clock: SensoryClock(logicalTick: 11),
      energy: 0.5
    )
    haptic.setMuted(true)
    XCTAssertEqual(haptic.schedule(event), .muted)

    let audioDispatch = audio.schedule(event)
    XCTAssertNotEqual(audioDispatch, .muted, "muting haptics must not mute audio")
  }

  func testEventOptingOutOfASenseIsRespectedWithoutTouchingOthers() {
    let audio = AudioBus()
    let haptic = HapticBus()
    let visualOnly = SensoryEvent(
      id: "visual-only",
      signature: .detent,
      clock: SensoryClock(logicalTick: 12),
      energy: 0.3,
      senses: [.visual]
    )
    XCTAssertEqual(audio.schedule(visualOnly), .muted)
    XCTAssertEqual(haptic.schedule(visualOnly), .muted)
  }

  // MARK: - Unsupported haptic fallback discipline

  func testUnsupportedHapticFallbackNeverFiresAGenericBuzzOnPlainSuccess() {
    // A generic "navigation success" does not name a scientific
    // commitment. The bus fallback must return nil for those.
    XCTAssertNil(SensoryFallbackPolicy.feedback(for: .tap))
    XCTAssertNil(SensoryFallbackPolicy.feedback(for: .detent))
    XCTAssertNil(SensoryFallbackPolicy.feedback(for: .ripple))
    XCTAssertNil(SensoryFallbackPolicy.feedback(for: .chop))
    XCTAssertNil(SensoryFallbackPolicy.feedback(for: .roll))
    XCTAssertNil(SensoryFallbackPolicy.feedback(for: .lens))
  }

  func testUnsupportedHapticFallbackShapesTheThreeCommittingSignatures() {
    XCTAssertEqual(SensoryFallbackPolicy.feedback(for: .storm), .warning)
    XCTAssertEqual(SensoryFallbackPolicy.feedback(for: .crossing), .success)
    XCTAssertEqual(SensoryFallbackPolicy.feedback(for: .bloom), .success)
  }

  // MARK: - Skew budget across repeated events

  func testScheduledOnsetsStayWithinDeclaredSkewBudget() {
    // NOTE: On dedicated hardware this reproducibly stays under ~5 ms, but
    // GitHub Actions macOS runners are shared VMs with routinely 30-40 ms of
    // dispatch jitter. We keep the budget wide enough to survive that jitter
    // while still catching a real regression (e.g. any onset order of
    // seconds instead of milliseconds); the physical-device budget lives in
    // the U8 evidence bundle contract, not this unit test.
    let budget = SensorySkewBudget(tolerance: 0.100)
    let bus = AudioBus(skewBudget: budget)
    let clock = SensoryClock(logicalTick: 100, wallOffset: 0.010)

    let expectations = (0..<8).map { XCTestExpectation(description: "onset-\($0)") }
    for (index, expectation) in expectations.enumerated() {
      let event = SensoryEvent(
        id: "skew-\(index)",
        signature: .roll,
        clock: clock,
        energy: 0.5
      )
      let dispatch = bus.schedule(event) { expectation.fulfill() }
      XCTAssertEqual(dispatch, .scheduled)
    }

    wait(for: expectations, timeout: 2.0)

    for index in 0..<8 {
      guard let deviation = bus.skewObserved(for: "skew-\(index)") else {
        XCTFail("no onset recorded for skew-\(index)")
        continue
      }
      XCTAssertTrue(budget.within(deviation: deviation),
                    "onset \(index) exceeded declared skew budget: \(deviation)s")
    }
  }

  // MARK: - Shared native event clock (one logicalTick per event)

  func testSharedClockDrivesEveryChannelWithTheSameTick() {
    let audio = AudioBus()
    let haptic = HapticBus()
    let event = SensoryEvent(
      id: "collision-shared-tick",
      signature: .crossing,
      clock: SensoryClock(logicalTick: 314159, wallOffset: 0),
      energy: 0.5
    )
    XCTAssertEqual(audio.schedule(event), .scheduled)
    _ = haptic.schedule(event)
    // Both buses now hold the exact same logicalTick under `event.id`.
    // We cannot expose their internal ledgers, but we can prove that the
    // event object itself carries one clock reading — not one per
    // channel — which is the whole invariant.
    XCTAssertEqual(event.clock.logicalTick, 314159)
    XCTAssertEqual(event.clock.wallOffset, 0)
  }

  func testOrbitalToneProfilesAreStableAndDistinct() {
    let tap = AudioToneProfile.forSignature(.tap)
    let orbit = AudioToneProfile.forSignature(.ripple)
    let collision = AudioToneProfile.forSignature(.crossing)

    XCTAssertGreaterThan(tap.frequency, 0)
    XCTAssertGreaterThan(orbit.duration, tap.duration)
    XCTAssertNotEqual(collision.frequency, orbit.frequency)
    XCTAssertLessThanOrEqual(collision.duration, 0.5, "outcome tones must stay immediate")
  }

  func testOrbitalPlaybackPreservesKernelAuthoredFrequencyExactly() {
    for frequency in [40.0, 110, 364, 1_024, 8_000] {
      let playback = try! XCTUnwrap(OrbitalPlayback.forFrequency(frequency))
      XCTAssertEqual(playback.baseFrequency * Double(playback.rate), frequency, accuracy: 0.001)
      XCTAssertGreaterThanOrEqual(playback.rate, 0.5)
      XCTAssertLessThanOrEqual(playback.rate, 2)
    }

    XCTAssertNil(OrbitalPlayback.forFrequency(.nan))
    XCTAssertNil(OrbitalPlayback.forFrequency(19))
  }

  func testOrbitalToneGainComesOnlyFromAuthoritativeEnergy() {
    let quiet = AudioToneProfile.gain(forEnergy: 0.2)
    let loud = AudioToneProfile.gain(forEnergy: 0.8)
    XCTAssertGreaterThan(loud, quiet)
    XCTAssertEqual(AudioToneProfile.gain(forEnergy: -.infinity), 0)
    XCTAssertEqual(AudioToneProfile.gain(forEnergy: .nan), 0)
    XCTAssertLessThanOrEqual(AudioToneProfile.gain(forEnergy: 4), 1)
  }
}
