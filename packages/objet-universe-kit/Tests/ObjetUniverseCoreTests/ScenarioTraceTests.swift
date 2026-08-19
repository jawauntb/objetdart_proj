import XCTest
@testable import ObjetUniverseCore

final class ScenarioTraceTests: XCTestCase {
  func testTraceRoundTripsThroughJSON() throws {
    var trace = ScenarioTrace(seed: "seed-a", modelVersion: "v1", scene: .wave, presentationHz: 60)
    let command = SemanticCommand(id: "cmd-1", verb: .material, at: 0.125, intensity: 0.8)
    trace.record(command: command, at: 2, atMs: 12.34567)
    trace.record(checkpoint: KernelCheckpoint(scene: .wave, tick: 8, digest: "sha256:abc"))
    trace.finalize(atLogicalTick: 12, digest: "sha256:def")

    let envelope = ScenarioEnvelope(trace: trace, signposts: [
      HostSignpost(kind: .actionPreviewed, logicalTick: 2, wallOffsetMicros: 100, actionId: "cmd-1"),
      HostSignpost(kind: .authoritativelyApplied, logicalTick: 3, wallOffsetMicros: 200, actionId: "cmd-1"),
      HostSignpost(kind: .checkpointPromoted, logicalTick: 8, wallOffsetMicros: 900, payload: [
        "checkpointDigestPrefix": .string("sha256:abc")
      ]),
    ])

    let data = try envelope.encoded()
    let decoded = try JSONDecoder().decode(ScenarioEnvelope.self, from: data)
    XCTAssertEqual(decoded, envelope)
    XCTAssertEqual(decoded.trace.actions.first?.atMs, 12.346)
    XCTAssertEqual(decoded.trace.canonicalStateDigest, "sha256:def")
    XCTAssertEqual(decoded.bundleVersion, ScenarioTrace.traceVersion)
  }

  func testTraceRejectsNonFinitePayload() throws {
    let signpost = HostSignpost(kind: .memorySnapshot, logicalTick: 0, wallOffsetMicros: 0, payload: [
      "residentMB": .double(.infinity)
    ])
    let envelope = ScenarioEnvelope(trace: ScenarioTrace(seed: "seed", modelVersion: "v1", scene: .wave, presentationHz: 60), signposts: [signpost])
    XCTAssertThrowsError(try envelope.encoded())
  }

  func testSignpostRingIsBoundedAndReportsOverflow() {
    var ring = SignpostRing(capacity: 4)
    for tick in 0..<10 {
      ring.append(HostSignpost(kind: .authoritativelyApplied, logicalTick: tick, wallOffsetMicros: Int64(tick)))
    }
    XCTAssertTrue(ring.overflowed)
    XCTAssertEqual(ring.items.count, 4)
    XCTAssertEqual(ring.items.map(\.logicalTick), [6, 7, 8, 9])
  }

  func testQuantizationEliminatesTrailingNoise() {
    XCTAssertEqual(ScenarioTrace.quantizeMs(1.2345678), 1.235)
    XCTAssertEqual(ScenarioTrace.quantizeMs(0), 0)
    XCTAssertEqual(ScenarioTrace.quantizeMs(.nan), 0)
    XCTAssertEqual(ScenarioTrace.quantizeMs(.infinity), 0)
  }

  func testActionOrdinalsAreStableAcrossPresentationHz() {
    for hz in [30, 60, 120] {
      var trace = ScenarioTrace(seed: "seed", modelVersion: "v1", scene: .cell, presentationHz: hz)
      for i in 0..<5 {
        let command = SemanticCommand(id: "cmd-\(i)", verb: .material, at: Double(i) * 0.1, intensity: Double(i) / 10)
        trace.record(command: command, at: i * 12, atMs: Double(i) * 100)
      }
      XCTAssertEqual(trace.actions.map(\.ordinal), [0, 1, 2, 3, 4])
      XCTAssertEqual(trace.actions.map(\.logicalTick), [0, 12, 24, 36, 48])
    }
  }
}
