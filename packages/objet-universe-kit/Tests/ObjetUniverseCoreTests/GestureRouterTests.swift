import Foundation
import XCTest
@testable import ObjetUniverseCore

/// U5 — cross-language pin for the native gesture grammar.
///
/// `GestureRouter.swift` lives in the Expo module tree (autolinked into the
/// generated iOS app), so this Swift Package test cannot import it directly.
/// Instead, the test parses the router source file as text and asserts every
/// threshold literal and every grammar verb the site's law depends on is
/// declared verbatim. The mirror TypeScript test in
/// `apps/native/src/accessibility/__tests__/UniverseActions.test.tsx` pins
/// the exact same lines from the other side — either divergence trips both.
final class GestureRouterTests: XCTestCase {
  private func repoRoot(fromFile file: StaticString = #file) -> URL {
    // Walk up from this test's source path until we find the packages/
    // sibling that identifies the repo root — SPM sometimes surfaces `#file`
    // as a shorter build-graph path that has fewer components than the
    // literal source location, so a hard-coded parent count is fragile.
    let start = URL(fileURLWithPath: "\(file)").resolvingSymlinksInPath()
    var current = start.deletingLastPathComponent()
    let manager = FileManager.default
    for _ in 0..<12 {
      let router = current.appendingPathComponent("apps/native/modules/objet-universe/ios/GestureRouter.swift").path
      if manager.fileExists(atPath: router) {
        return current
      }
      let parent = current.deletingLastPathComponent()
      if parent.path == current.path { break }
      current = parent
    }
    // Last resort: assume this file lives 4 levels below the repo root.
    return start.deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
  }

  private func loadRouterSource() throws -> String {
    let router = repoRoot().appendingPathComponent("apps/native/modules/objet-universe/ios/GestureRouter.swift")
    return try String(contentsOf: router, encoding: .utf8)
  }

  private func loadVesselSource() throws -> String {
    let vessel = repoRoot().appendingPathComponent("apps/native/modules/objet-universe/ios/VesselSensors.swift")
    return try String(contentsOf: vessel, encoding: .utf8)
  }

  private func loadWebCoreSource() throws -> String {
    let core = repoRoot().appendingPathComponent("src/lib/gesture/core.ts")
    return try String(contentsOf: core, encoding: .utf8)
  }

  private func loadTypeScriptThresholds() throws -> String {
    let ts = repoRoot().appendingPathComponent("apps/native/src/universe/actions.ts")
    return try String(contentsOf: ts, encoding: .utf8)
  }

  func testEveryThresholdIsDeclaredVerbatimInSwiftAndTypeScript() throws {
    let router = try loadRouterSource()
    let ts = try loadTypeScriptThresholds()
    let web = try loadWebCoreSource()
    let expectations: [(swift: String, tsNative: String, tsWeb: String, name: String)] = [
      ("public static let dwellMs: Double = 900", "dwellMs: 900", "dwellMs: 900", "dwellMs"),
      ("public static let ceremonyMs: Double = 2500", "ceremonyMs: 2500", "ceremonyMs: 2500", "ceremonyMs"),
      ("public static let tapMaxMs: Double = 250", "tapMaxMs: 250", "tapMaxMs: 250", "tapMaxMs"),
      ("public static let tapTrainMs: Double = 280", "tapTrainMs: 280", "tapTrainMs: 280", "tapTrainMs"),
      ("public static let moveTolPx: Double = 12", "moveTolPx: 12", "moveTolPx: 12", "moveTolPx"),
      ("public static let flickVel: Double = 0.6", "flickVel: 0.6", "flickVel: 0.6", "flickVel"),
      ("public static let scrubWinding: Double = 0.75", "scrubWinding: 0.75", "scrubWinding: 0.75", "scrubWinding"),
      ("public static let pinchDeadzone: Double = 0.03", "pinchDeadzone: 0.03", "pinchDeadzone: 0.03", "pinchDeadzone"),
      ("public static let twistDeadzoneRad: Double = 0.1", "twistDeadzoneRad: 0.1", "twistDeadzoneRad: 0.1", "twistDeadzoneRad"),
      ("public static let shakeThresh: Double = 16", "shakeThresh: 16", "shakeThresh: 16", "shakeThresh"),
      ("public static let knockThresh: Double = 22", "knockThresh: 22", "knockThresh: 22", "knockThresh"),
      ("public static let voiceStaggerMs: Double = 80", "voiceStaggerMs: 80", "voiceStaggerMs: 80", "voiceStaggerMs"),
      ("public static let voiceDecideMs: Double = 180", "voiceDecideMs: 180", "voiceDecideMs: 180", "voiceDecideMs"),
      ("public static let spanEnterMs: Double = 350", "spanEnterMs: 350", "spanEnterMs: 350", "spanEnterMs"),
      ("public static let spanTolPx: Double = 16", "spanTolPx: 16", "spanTolPx: 16", "spanTolPx"),
    ]
    for expectation in expectations {
      XCTAssertTrue(
        router.contains(expectation.swift),
        "Swift GestureRouter must declare \(expectation.name) verbatim as `\(expectation.swift)`"
      )
      XCTAssertTrue(
        ts.contains(expectation.tsNative),
        "TypeScript actions.ts must declare \(expectation.name) verbatim as `\(expectation.tsNative)`"
      )
      XCTAssertTrue(
        web.contains(expectation.tsWeb),
        "Web core.ts must declare \(expectation.name) verbatim as `\(expectation.tsWeb)`"
      )
    }
  }

  func testGrammarVerbEnumCoversTheTwentyThreeSiteWideVerbs() throws {
    let router = try loadRouterSource()
    let expectedCases = [
      "case tap", "case tap2", "case tap3", "case holdDwell", "case holdCeremony",
      "case hold3", "case drag", "case drag3", "case flick", "case scrub", "case span",
      "case twist", "case twist3", "case rhythm", "case drum", "case arpeggio",
      "case shake", "case tilt", "case knock", "case flip", "case breath",
      "case pinch", "case pan2",
    ]
    XCTAssertEqual(expectedCases.count, 23, "site-wide grammar must remain 23 verbs")
    for verbCase in expectedCases {
      XCTAssertTrue(router.contains(verbCase), "GestureRouter must declare enum \(verbCase)")
    }
  }

  func testGestureRouterExposesTheExpectedPublicSinks() throws {
    let router = try loadRouterSource()
    XCTAssertTrue(router.contains("public final class GestureRouter"), "the router must be publicly visible")
    XCTAssertTrue(router.contains("public func route(shape: NativeGestureShape"), "the router must expose the semantic sink")
    XCTAssertTrue(router.contains("public func recordNearMiss"), "the router must accept near-miss reports")
    XCTAssertTrue(router.contains("public func pumpDiscovery"), "the router must own the idle-discovery clock")
    XCTAssertTrue(router.contains("public static func resolve(shape: NativeGestureShape)"), "verb/layer resolution must remain a pure classifier")
    XCTAssertTrue(router.contains("public static func intensity(from shape: NativeGestureShape)"), "intensity must remain a pure classifier")
  }

  func testGestureRouterKeepsFingerCountAddressingIntact() throws {
    let router = try loadRouterSource()
    // The one place the site-wide grammar decides finger count meaning. If a
    // future edit breaks any of these lines, the layer-crossing invariant
    // (test scenario 1) has been violated.
    XCTAssertTrue(router.contains("if fingers >= 3 { return (.tap3, .material) }"), "three-finger tap must remain tutti (material)")
    XCTAssertTrue(router.contains("if fingers == 2 { return (.tap2, .representation) }"), "two-finger tap must remain step-back (representation)")
    XCTAssertTrue(router.contains("if fingers >= 3 { return (.hold3, .world) }"), "three-finger hold must remain time-dilation (world)")
    XCTAssertTrue(router.contains("if fingers >= 3 { return (.drag3, .world) }"), "three-finger drag must remain weather (world)")
    XCTAssertTrue(router.contains("if fingers >= 3 { return (.twist3, .world) }"), "three-finger twist must remain season (world)")
  }

  func testVesselSensorsHoldsExactlyOneSubscriptionPolicy() throws {
    let vessel = try loadVesselSource()
    XCTAssertTrue(vessel.contains("public final class VesselSensors"), "vessel bus must be publicly visible")
    XCTAssertTrue(vessel.contains("private let manager: CMMotionManager"), "vessel must own exactly one CMMotionManager")
    XCTAssertTrue(vessel.contains("private var askedThisSession"), "vessel must honour the ask-at-most-once invariant")
    XCTAssertTrue(vessel.contains("public func request"), "vessel must expose the invited-permission entry point")
    XCTAssertTrue(vessel.contains("public func suspend"), "vessel must suspend on backgrounding")
    XCTAssertTrue(vessel.contains("public func resume"), "vessel must resume without prompting on foreground")
    XCTAssertTrue(vessel.contains("flipEnterDeg"), "vessel must hysteresis-guard face-down detection")
    XCTAssertTrue(vessel.contains("flipExitDeg"), "vessel must hysteresis-guard face-down detection")
  }

  func testSemanticVerbEnumMirrorsTheContractTypeScriptSide() {
    // Reuses the already-published `SemanticVerb` in ObjetUniverseCore to
    // make sure the durable enum still enumerates the site-wide meanings the
    // router will emit. If a future edit drops one, the router's routed
    // command shape and the TypeScript contract diverge.
    let expected: [SemanticVerb] = [
      .material, .stepBack, .tutti, .train, .scale, .lens, .season, .pan,
      .weather, .timeDilation, .grow, .ceremony, .agitate, .gravity, .wake,
      .night, .breath,
    ]
    XCTAssertEqual(SemanticVerb.allCases.count, expected.count, "SemanticVerb count must match TypeScript SemanticVerb")
    for verb in expected {
      XCTAssertTrue(SemanticVerb.allCases.contains(verb), "SemanticVerb must contain \(verb)")
    }
  }
}
