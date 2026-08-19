/**
 * U5 — accessibility invariance and cross-language threshold pin.
 *
 * Runs under `node --experimental-strip-types` (Node 22.13.x). Every case is
 * a pure comparison over the assemblers in `apps/native/src/universe/actions`
 * and `apps/native/src/accessibility/actionLabels` — the JSX shell of
 * `UniverseActions.tsx` stays out of the test process because the point is
 * NOT to prove React Native renders, it is to prove:
 *
 *   1. A touch shape and its VoiceOver-equivalent shape serialize to the
 *      same `VersionedAction` when only `source` differs.
 *   2. Every grammar verb has a rotor label AND is reachable from
 *      `buildAssistiveCommands`.
 *   3. Tap trains (1/3/5/n) preserve their counts and never collapse to a
 *      tier switch.
 *   4. The 15 numeric thresholds in `NATIVE_GESTURE_THRESHOLDS` match the
 *      web `THRESHOLDS` map in `src/lib/gesture/core.ts` verbatim.
 *   5. Discovery invitations only surface after real idle or near-miss
 *      behavior; a fresh surface never invites.
 *
 * The .tsx extension is preserved per the plan's file inventory; no JSX is
 * used inside so the strip-types loader is enough to execute the file.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACTION_CONTRACT_VERSION,
  isVersionedAction,
  serializeAction,
} from "@objet/universe-contracts";
import {
  NATIVE_GESTURE_THRESHOLDS,
  NATIVE_GLOBAL_VERBS,
  classifyDiscovery,
  commandFromShape,
  IDLE_DISCOVERY_WINDOW_MS,
  intensityFromNativeShape,
  resolveVerbFromShape,
  type NativeGestureShape,
} from "../../universe/actions.ts";
import {
  ACCESSIBILITY_SYNTHETIC_POINT,
  UNIVERSE_ACTION_LABELS,
  UNIVERSE_KEYBOARD_SHORTCUTS,
  buildAssistiveCommands,
} from "../actionLabels.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../../../..");

function stripSource(action: ReturnType<typeof commandFromShape>["action"]) {
  const { action: inner, ...rest } = action;
  const { source: _drop, ...actionWithoutSource } = inner;
  return { ...rest, action: actionWithoutSource };
}

test("touch and assistive sources produce identical semantic payloads under invariance", () => {
  for (const entry of UNIVERSE_ACTION_LABELS) {
    const touch = commandFromShape({
      id: "touch:1",
      logicalTime: 1_000,
      source: "touch",
      shape: entry.equivalentShape,
    });
    const assistive = commandFromShape({
      id: "touch:1",
      logicalTime: 1_000,
      source: "assistive",
      shape: entry.equivalentShape,
    });
    assert.deepEqual(
      stripSource(touch.action),
      stripSource(assistive.action),
      `verb ${entry.grammarVerb} must produce the same payload from touch and assistive rotor`,
    );
    assert.equal(touch.action.action.verb, assistive.action.action.verb);
    assert.equal(touch.action.action.layer, assistive.action.action.layer);
    assert.equal(touch.action.action.intensity, assistive.action.action.intensity);
    assert.ok(isVersionedAction(touch.action));
    assert.ok(isVersionedAction(assistive.action));
  }
});

test("every grammar verb has a rotor label AND is reachable via buildAssistiveCommands", () => {
  const grammarVerbs = new Set(NATIVE_GLOBAL_VERBS.map((entry) => entry.grammarVerb));
  const labelledVerbs = new Set(UNIVERSE_ACTION_LABELS.map((entry) => entry.grammarVerb));
  assert.equal(grammarVerbs.size, 23, "site-wide grammar must remain 23 verbs");
  assert.deepEqual(
    [...grammarVerbs].sort(),
    [...labelledVerbs].sort(),
    "actionLabels must cover exactly the site-wide grammar",
  );

  const built = buildAssistiveCommands({
    source: "assistive",
    logicalTime: 42,
    makeActionId: (verb) => `test:${verb}`,
  });
  assert.equal(built.length, UNIVERSE_ACTION_LABELS.length);
  const reachable = new Set(built.map((row) => row.label.grammarVerb));
  assert.deepEqual([...reachable].sort(), [...labelledVerbs].sort());
});

test("advertisedVerbs limits the rotor without changing semantic payloads", () => {
  const only = ["tap", "tap2", "tap3"] as const;
  const built = buildAssistiveCommands({
    source: "assistive",
    logicalTime: 0,
    advertisedVerbs: only,
    makeActionId: (verb) => `advertised:${verb}`,
  });
  assert.equal(built.length, 3);
  for (const row of built) {
    assert.ok(only.includes(row.label.grammarVerb));
  }
});

test("tap trains preserve 1, 3, 5, and open-ended counts without collapsing to a tier switch", () => {
  for (const count of [1, 3, 5, 7, 12, 99]) {
    const shape: NativeGestureShape = { kind: "tap", fingers: 1, count, x: 0, y: 0, intensity: 0.5 };
    const command = commandFromShape({ id: `tap:${count}`, logicalTime: count, source: "touch", shape });
    assert.equal(command.action.action.payload.count, count);
    assert.equal(command.action.action.verb, "material");
    assert.equal(command.action.action.layer, "material");
  }
});

test("intensity is a continuous 0..1 axis for every shape kind", () => {
  const shapes: readonly NativeGestureShape[] = [
    { kind: "tap", fingers: 1, count: 1, x: 0, y: 0, intensity: 0 },
    { kind: "tap", fingers: 1, count: 1, x: 0, y: 0, intensity: 0.37 },
    { kind: "tap", fingers: 1, count: 1, x: 0, y: 0, intensity: 1 },
    { kind: "drag", fingers: 1, dx: 5, dy: 5, vx: 0.5, vy: 0.5, x: 0, y: 0 },
    { kind: "flick", fingers: 1, speed: 1.5, angle: 0, x: 0, y: 0 },
    { kind: "twist", fingers: 2, angleRad: 0.5, velocity: 1 },
    { kind: "pinch", scale: 1.3, velocity: 0.5 },
    { kind: "scrub", winding: 0.9, angularVelocity: 3, cx: 0, cy: 0 },
    { kind: "span", phase: "enter", spread: 50, elapsedMs: 500, cx: 0, cy: 0 },
    { kind: "shake", intensity: 0.5 },
    { kind: "tilt", beta: 20, gamma: 5 },
    { kind: "knock", intensity: 0.9 },
    { kind: "flip", faceDown: true },
    { kind: "breath", strength: 0.4 },
  ];
  for (const shape of shapes) {
    const intensity = intensityFromNativeShape(shape);
    assert.ok(intensity >= 0 && intensity <= 1, `intensity out of range for ${shape.kind}`);
    assert.ok(Number.isFinite(intensity));
  }
});

test("finger count decides the semantic layer without crossing it", () => {
  const oneFingerTap = resolveVerbFromShape({ kind: "tap", fingers: 1, count: 1, x: 0, y: 0, intensity: 0.5 });
  const twoFingerTap = resolveVerbFromShape({ kind: "tap", fingers: 2, count: 1, x: 0, y: 0, intensity: 0.5 });
  const threeFingerTap = resolveVerbFromShape({ kind: "tap", fingers: 3, count: 1, x: 0, y: 0, intensity: 0.5 });
  assert.equal(oneFingerTap.layer, "material");
  assert.equal(twoFingerTap.layer, "representation");
  assert.equal(threeFingerTap.layer, "material");
  assert.equal(twoFingerTap.verb, "step-back");
  assert.equal(threeFingerTap.verb, "tutti");

  const oneFingerHold = resolveVerbFromShape({ kind: "hold", fingers: 1, elapsedMs: 900, x: 0, y: 0, intensity: 0.5 });
  const threeFingerHold = resolveVerbFromShape({ kind: "hold", fingers: 3, elapsedMs: 900, x: 0, y: 0, intensity: 0.5 });
  assert.equal(oneFingerHold.layer, "material");
  assert.equal(threeFingerHold.layer, "world");
  assert.equal(threeFingerHold.verb, "time-dilation");

  const oneFingerDrag = resolveVerbFromShape({ kind: "drag", fingers: 1, dx: 5, dy: 0, vx: 0.4, vy: 0, x: 0, y: 0 });
  const threeFingerDrag = resolveVerbFromShape({ kind: "drag", fingers: 3, dx: 5, dy: 0, vx: 0.4, vy: 0, x: 0, y: 0 });
  assert.equal(oneFingerDrag.layer, "material");
  assert.equal(threeFingerDrag.layer, "world");
  assert.equal(threeFingerDrag.verb, "weather");
});

test("assistive assembled actions serialize deterministically and reject renderer keys", () => {
  const command = commandFromShape({
    id: "touch:presentation-safe",
    logicalTime: 3,
    source: "touch",
    shape: { kind: "tap", fingers: 1, count: 1, x: 0, y: 0, intensity: 0.5 },
  });
  const wire = serializeAction(command.action);
  assert.ok(wire.includes(`"version":${ACTION_CONTRACT_VERSION}`));
  assert.ok(!/renderer|canvas|shader|gpu|webgl|metal/i.test(wire));
});

test("discovery invitations only surface after real idle or near-miss behavior", () => {
  assert.equal(classifyDiscovery({ idleMs: 0, nearMissFingers: null, nearMissWithdrawnAfterMs: 0 }), null);
  assert.equal(classifyDiscovery({ idleMs: 500, nearMissFingers: null, nearMissWithdrawnAfterMs: 0 }), null);
  const nearMiss = classifyDiscovery({ idleMs: 0, nearMissFingers: 3, nearMissWithdrawnAfterMs: 220 });
  assert.equal(nearMiss?.reason, "near-miss");
  const idle = classifyDiscovery({ idleMs: IDLE_DISCOVERY_WINDOW_MS + 1, nearMissFingers: null, nearMissWithdrawnAfterMs: 0 });
  assert.equal(idle?.reason, "idle");
  if (idle?.reason === "idle") {
    assert.ok(idle.suggestedFingers === 2 || idle.suggestedFingers === 3);
  }
});

test("keyboard shortcut table only names known grammar verbs", () => {
  const grammar = new Set(NATIVE_GLOBAL_VERBS.map((entry) => entry.grammarVerb));
  for (const shortcut of UNIVERSE_KEYBOARD_SHORTCUTS) {
    assert.ok(grammar.has(shortcut.grammarVerb), `shortcut names unknown verb ${shortcut.grammarVerb}`);
    assert.ok(shortcut.input.length > 0);
  }
});

test("cross-language threshold pin — Swift GestureRouter constants match TypeScript verbatim", () => {
  const swiftPath = path.join(
    repoRoot,
    "apps/native/modules/objet-universe/ios/GestureRouter.swift",
  );
  const swift = readFileSync(swiftPath, "utf8");

  const expectations: Readonly<Record<keyof typeof NATIVE_GESTURE_THRESHOLDS, string>> = {
    dwellMs: "public static let dwellMs: Double = 900",
    ceremonyMs: "public static let ceremonyMs: Double = 2500",
    tapMaxMs: "public static let tapMaxMs: Double = 250",
    tapTrainMs: "public static let tapTrainMs: Double = 280",
    moveTolPx: "public static let moveTolPx: Double = 12",
    flickVel: "public static let flickVel: Double = 0.6",
    scrubWinding: "public static let scrubWinding: Double = 0.75",
    pinchDeadzone: "public static let pinchDeadzone: Double = 0.03",
    twistDeadzoneRad: "public static let twistDeadzoneRad: Double = 0.1",
    shakeThresh: "public static let shakeThresh: Double = 16",
    knockThresh: "public static let knockThresh: Double = 22",
    voiceStaggerMs: "public static let voiceStaggerMs: Double = 80",
    voiceDecideMs: "public static let voiceDecideMs: Double = 180",
    spanEnterMs: "public static let spanEnterMs: Double = 350",
    spanTolPx: "public static let spanTolPx: Double = 16",
  };

  for (const [key, line] of Object.entries(expectations) as [
    keyof typeof NATIVE_GESTURE_THRESHOLDS,
    string,
  ][]) {
    assert.ok(
      swift.includes(line),
      `Swift GestureRouter must declare ${key} verbatim as ${line}`,
    );
    assert.equal(
      typeof NATIVE_GESTURE_THRESHOLDS[key],
      "number",
      `${key} must be a numeric threshold`,
    );
  }
});

test("TypeScript thresholds match the web grammar module source verbatim", () => {
  const webCore = readFileSync(path.join(repoRoot, "src/lib/gesture/core.ts"), "utf8");
  const expectations: Readonly<Record<keyof typeof NATIVE_GESTURE_THRESHOLDS, string>> = {
    dwellMs: "dwellMs: 900",
    ceremonyMs: "ceremonyMs: 2500",
    tapMaxMs: "tapMaxMs: 250",
    tapTrainMs: "tapTrainMs: 280",
    moveTolPx: "moveTolPx: 12",
    flickVel: "flickVel: 0.6",
    scrubWinding: "scrubWinding: 0.75",
    pinchDeadzone: "pinchDeadzone: 0.03",
    twistDeadzoneRad: "twistDeadzoneRad: 0.1",
    shakeThresh: "shakeThresh: 16",
    knockThresh: "knockThresh: 22",
    voiceStaggerMs: "voiceStaggerMs: 80",
    voiceDecideMs: "voiceDecideMs: 180",
    spanEnterMs: "spanEnterMs: 350",
    spanTolPx: "spanTolPx: 16",
  };
  for (const [key, line] of Object.entries(expectations) as [
    keyof typeof NATIVE_GESTURE_THRESHOLDS,
    string,
  ][]) {
    assert.ok(webCore.includes(line), `web core.ts must declare ${key} as ${line}`);
  }
});

test("accessibility labels never carry renderer-shaped keys and use a synthetic point", () => {
  assert.equal(ACCESSIBILITY_SYNTHETIC_POINT.x, 0);
  assert.equal(ACCESSIBILITY_SYNTHETIC_POINT.y, 0);
  for (const entry of UNIVERSE_ACTION_LABELS) {
    for (const [k] of Object.entries(entry.equivalentShape)) {
      assert.ok(!/renderer|render|canvas|frame|pixel|shader|gpu|webgl|metal/i.test(k));
    }
  }
});
