// The room scaffolding must actually scaffold. These assertions catch the
// bugs that would silently reintroduce the seven-hand-edited-registries
// problem: a manifest room missing from a registry, a registry row that
// disagrees with the manifest it was derived from, a peer seat that lands in
// a different ring position depending on import order, a placement that
// claims two homes at once — and, on the interaction side, a global verb that
// reaches nothing at all.

import assert from "node:assert/strict";
import { loadTsModule } from "./lib/load-ts.mjs";

const registry = loadTsModule("src/rooms/registry.ts");
const routes = loadTsModule("src/lib/routes.ts");
const peers = loadTsModule("src/lib/peers.ts");
const icons = loadTsModule("src/lib/site-icon-config.ts");
const guide = loadTsModule("src/data/guide.ts");
const scale = loadTsModule("src/lib/scale.ts");
const defaults = loadTsModule("src/lib/gesture/defaults.ts");
const sizing = loadTsModule("src/lib/webgl/sizing.ts");

const {
  ROOM_MANIFEST_LIST,
  mergePeerRing,
  roomChromeForRoute,
  roomManifestForRoute,
} = registry;
const { SITE_ROUTES, NAVIGATION_ROUTES, SITE_ROUTE_BY_KEY } = routes;
const { PEER_CIRCLES, SCALE_EXEMPT_KEY_SET, peerCircleForRoute } = peers;
const { SITE_ICON_VISUALS } = icons;
const { GUIDE_ROOMS } = guide;
const { SCALE_BANDS, entryScaleFor } = scale;
const { GLOBAL_VERBS, ROOM_VERBS, roomGestureBindings, voiceCoverage } = defaults;
const { resolveStageSize, clocksFrom, formatShaderError, CLOCK_UNIFORMS } = sizing;

assert.ok(ROOM_MANIFEST_LIST.length > 0, "at least one room must prove the manifest path");

// ---------------------------------------------------------------------------
// 1. round-trip: a manifest room appears in EVERY registry, saying the same thing
// ---------------------------------------------------------------------------

const guideByKey = new Map(GUIDE_ROOMS.map((room) => [room.key, room]));
const navKeys = NAVIGATION_ROUTES.map((r) => r.key);

for (const room of ROOM_MANIFEST_LIST) {
  const { key } = room;

  // SITE_ROUTES — exactly once, with the manifest's own fields.
  const rows = SITE_ROUTES.filter((r) => r.key === key);
  assert.equal(rows.length, 1, `${key}: exactly one SITE_ROUTES row (double registration?)`);
  const row = rows[0];
  assert.equal(row.href, room.href, `${key}: href must come from the manifest`);
  assert.equal(row.desc, room.desc, `${key}: desc must come from the manifest`);
  assert.equal(row.icon, room.sigil, `${key}: sigil must come from the manifest`);
  assert.equal(row.cluster, room.cluster, `${key}: cluster must come from the manifest`);
  assert.equal(row.dark ?? false, room.dark ?? false, `${key}: dark must come from the manifest`);
  assert.equal(
    row.homePriority ?? null,
    room.homePriority ?? null,
    `${key}: homePriority must come from the manifest`,
  );
  assert.equal(SITE_ROUTE_BY_KEY[key], row, `${key}: must resolve through SITE_ROUTE_BY_KEY`);

  // Navigation — the dropdown and gallery are derived, so presence here proves
  // the manifest reached nav-order through peers/exempt, not by luck.
  assert.equal(
    navKeys.filter((k) => k === key).length,
    1,
    `${key}: must appear exactly once in NAVIGATION_ROUTES`,
  );

  // The field guide.
  const entry = guideByKey.get(key);
  assert.ok(entry, `${key}: must have a guide entry derived from the manifest`);
  assert.equal(entry.href, room.href, `${key}: guide href must match the manifest`);
  assert.equal(entry.title, room.guide.title, `${key}: guide title must match the manifest`);
  assert.equal(entry.essence, room.guide.essence, `${key}: guide essence must match the manifest`);
  assert.deepEqual(
    entry.moves,
    [...room.guide.moves],
    `${key}: guide moves must match the manifest`,
  );

  // The icon / opengraph palette.
  const visual = SITE_ICON_VISUALS[key];
  assert.ok(visual, `${key}: must have an icon palette`);
  assert.deepEqual(
    { ...visual },
    { ...room.icon },
    `${key}: icon palette must be the manifest's, byte for byte`,
  );
  assert.equal(visual.path, room.href, `${key}: icon path and route href must agree`);
}

// ---------------------------------------------------------------------------
// 2. placement round-trips, and a room never claims two homes
// ---------------------------------------------------------------------------

for (const room of ROOM_MANIFEST_LIST) {
  const { key, place } = room;
  const exempt = SCALE_EXEMPT_KEY_SET.has(key);

  if (place.kind === "exempt") {
    assert.ok(exempt, `${key}: an exempt manifest must reach SCALE_EXEMPT_KEYS`);
    assert.equal(peerCircleForRoute(room.href), null, `${key}: exempt rooms take no peer seat`);
    assert.ok(place.why.length > 20, `${key}: an exemption owes a stated reason`);
    continue;
  }

  assert.ok(!exempt, `${key}: a placed room must not also be exempt`);

  if (place.kind === "peer") {
    const circle = PEER_CIRCLES.find((c) => c.id === place.circle);
    assert.ok(circle, `${key}: peer circle "${place.circle}" must exist`);
    const seats = circle.rooms.filter((r) => r.key === key);
    assert.equal(seats.length, 1, `${key}: exactly one seat in ${place.circle}`);
    assert.equal(seats[0].label, place.label, `${key}: ring label must come from the manifest`);
    assert.equal(seats[0].band, place.band, `${key}: ring band must come from the manifest`);
    assert.equal(seats[0].href, room.href, `${key}: ring href must come from the manifest`);
    if (place.ringAfter) {
      const idx = circle.rooms.findIndex((r) => r.key === key);
      const anchor = circle.rooms.findIndex((r) => r.key === place.ringAfter);
      assert.ok(anchor >= 0, `${key}: ringAfter "${place.ringAfter}" must be in the ring`);
      assert.equal(idx, anchor + 1, `${key}: must sit immediately after ${place.ringAfter}`);
    }
    // ScaleTravel needs an entry scale or the room mounts chrome that cannot
    // move — the exact bug LATERAL_ROUTE_BANDS drift produces.
    assert.notEqual(
      entryScaleFor(room.href),
      null,
      `${key}: entryScaleFor must resolve (keep LATERAL_ROUTE_BANDS ↔ PEER_CIRCLES)`,
    );
  }

  if (place.kind === "band") {
    const band = SCALE_BANDS.find((b) => b.id === place.band);
    assert.ok(band, `${key}: band "${place.band}" must exist in SCALE_BANDS`);
    assert.equal(
      band.route,
      room.href,
      `${key}: SCALE_BANDS["${place.band}"].route must be this room — the manifest and the axis may not drift`,
    );
  }
}

// The chrome a shell would mount comes from the manifest, and unknown routes
// get the safe default (both on) rather than a silently chrome-less room.
for (const room of ROOM_MANIFEST_LIST) {
  const chrome = roomChromeForRoute(room.href);
  assert.equal(chrome.travel, room.chrome?.travel ?? true, `${room.key}: travel override honored`);
  assert.equal(chrome.peers, room.chrome?.peers ?? true, `${room.key}: peers override honored`);
  assert.equal(roomManifestForRoute(`${room.href}/deep`)?.key, room.key, `${room.key}: nested paths resolve`);
}
assert.deepEqual(
  roomChromeForRoute("/not-a-room"),
  { travel: true, peers: true },
  "an unmanifested route still gets the full chrome by default",
);

// ---------------------------------------------------------------------------
// 3. mergePeerRing is pure, order-stable, and idempotent
// ---------------------------------------------------------------------------

const base = [{ key: "a" }, { key: "b" }, { key: "c" }];
const make = (seat) => ({ key: seat.key });
const seat = (key, ringAfter) => ({ key, href: `/${key}`, label: key, band: "drop", circle: "x", ringAfter });

assert.deepEqual(
  mergePeerRing(base, [seat("z", "a")], make).map((r) => r.key),
  ["a", "z", "b", "c"],
  "ringAfter inserts immediately behind its anchor",
);
assert.deepEqual(
  mergePeerRing(base, [seat("z")], make).map((r) => r.key),
  ["a", "b", "c", "z"],
  "a seat with no anchor appends",
);
assert.deepEqual(
  mergePeerRing(base, [seat("z", "nope")], make).map((r) => r.key),
  ["a", "b", "c", "z"],
  "an unknown anchor appends rather than throwing the ring away",
);
// Import order must not decide ring order — two seats behind the same anchor
// land in declaration order, and reversing the *base* never reorders seats.
assert.deepEqual(
  mergePeerRing(base, [seat("y", "a"), seat("z", "a")], make).map((r) => r.key),
  ["a", "y", "z", "b", "c"],
  "two seats behind one anchor keep declaration order",
);
const once = mergePeerRing(base, [seat("z", "a")], make);
assert.deepEqual(
  mergePeerRing(once, [seat("z", "a")], make).map((r) => r.key),
  once.map((r) => r.key),
  "merging twice is merging once — the derivation is idempotent",
);
assert.deepEqual(base.map((r) => r.key), ["a", "b", "c"], "mergePeerRing must not mutate its input");

// ---------------------------------------------------------------------------
// 4. the gesture default table answers every global verb
// ---------------------------------------------------------------------------

const roomVerbSet = new Set(ROOM_VERBS);
assert.equal(
  GLOBAL_VERBS.filter((v) => v.owner === "shell").map((v) => v.verb).sort().join(","),
  "pan2,pinch",
  "only the frame verbs belong to the chrome; everything else is the room's to answer",
);

/** Drive the table with a synthetic event per verb and record what landed. */
function exercise(voice, { travelOwnsFrame = true } = {}) {
  const heard = [];
  const felt = [];
  const spoken = [];
  const wrap = (name, fn) => (e) => {
    spoken.push(name);
    return fn?.(e);
  };
  const wrapped = {};
  for (const [name, fn] of Object.entries(voice)) wrapped[name] = wrap(name, fn);

  const bindings = roomGestureBindings({
    senses: {
      sound: (strength, weight) => heard.push({ strength, weight }),
      touch: (strength) => felt.push(strength),
    },
    voice: wrapped,
    travelOwnsFrame,
  });

  const fired = {};
  const run = (verb, invoke) => {
    const before = { heard: heard.length, felt: felt.length, spoken: spoken.length };
    invoke(bindings);
    fired[verb] =
      heard.length > before.heard || felt.length > before.felt || spoken.length > before.spoken;
  };

  run("tap", (b) => b.tap?.({ fingers: 1, count: 1, intensity: 0.6, x: 10, y: 20 }));
  run("tap2", (b) => b.tap?.({ fingers: 2, count: 1, intensity: 0.5, x: 10, y: 20 }));
  run("tap3", (b) => b.tap?.({ fingers: 3, count: 1, intensity: 0.5, x: 10, y: 20 }));
  run("holdDwell", (b) =>
    b.hold?.({ fingers: 1, phase: "enter", elapsed: 900, tier: 2, intensity: 0.5, x: 1, y: 2 }),
  );
  run("holdCeremony", (b) =>
    b.hold?.({ fingers: 1, phase: "release", elapsed: 2600, tier: 3, intensity: 0.5, x: 1, y: 2 }),
  );
  run("hold3", (b) =>
    b.hold?.({ fingers: 3, phase: "enter", elapsed: 300, tier: 1, intensity: 0.5, x: 1, y: 2 }),
  );
  run("drag", (b) =>
    b.drag?.({ fingers: 1, phase: "start", x: 1, y: 2, dx: 3, dy: 4, vx: 0.1, vy: 0.2 }),
  );
  run("drag3", (b) =>
    b.drag?.({ fingers: 3, phase: "start", x: 1, y: 2, dx: 3, dy: 4, vx: 0.1, vy: 0.2 }),
  );
  run("flick", (b) => b.flick?.({ fingers: 1, angle: 0.4, speed: 1.5, x: 1, y: 2 }));
  run("scrub", (b) => b.scrub?.({ winding: 0.9, angularVelocity: 0.3, cx: 1, cy: 2 }));
  run("twist", (b) =>
    b.twist?.({ phase: "start", fingers: 2, angle: 0.3, velocity: 0.1, cx: 1, cy: 2 }),
  );
  run("twist3", (b) =>
    b.twist?.({ phase: "start", fingers: 3, angle: 0.3, velocity: 0.1, cx: 1, cy: 2 }),
  );
  run("rhythm", (b) => b.rhythm?.({ bpm: 96, stability: 0.9 }));
  run("drum", (b) => b.drum?.({ hits: 3, alternation: 0.8, x: 1, y: 2, ax: 0, ay: 0, bx: 5, by: 5 }));
  run("arpeggio", (b) => b.arpeggio?.({ fingers: 3, spreadMs: 180, x: 1, y: 2 }));
  run("shake", (b) => b.shake?.({ intensity: 0.7 }));
  run("tilt", (b) => b.tilt?.({ beta: 12, gamma: -8 }));
  run("knock", (b) => b.knock?.({ intensity: 0.6 }));
  run("flip", (b) => b.flip?.({ faceDown: true }));
  run("breath", (b) => b.breath?.({ strength: 0.5 }));

  return { bindings, fired, heard, felt, spoken };
}

// A room with NO voice at all: every verb still lands. This is the assertion
// that makes "taps and presses often do nothing" a test failure.
const bare = exercise({});
for (const verb of ROOM_VERBS) {
  if (verb === "tilt") continue; // ambient and continuous — see defaults.ts
  assert.equal(bare.fired[verb], true, `a room with no voice still answers "${verb}"`);
}
assert.equal(
  bare.heard.length,
  bare.felt.length,
  "every acknowledgement lands in both senses in the same frame — never one alone",
);
assert.ok(bare.heard.every((h) => h.strength > 0 && h.strength <= 1), "acknowledgements stay 0..1");

// The magnitude the hand offered must survive: a hard tap is not a soft tap.
const soft = roomGestureBindings({
  senses: { sound: (s) => softHeard.push(s), touch: () => {} },
  voice: {},
});
const softHeard = [];
soft.tap?.({ fingers: 1, count: 1, intensity: 0.05, x: 0, y: 0 });
soft.tap?.({ fingers: 1, count: 1, intensity: 0.95, x: 0, y: 0 });
assert.equal(softHeard.length, 2, "both taps answered");
assert.ok(
  softHeard[1] > softHeard[0] + 0.2,
  "intensity is a continuous axis — a hard tap must answer louder than a soft one",
);

// Rapid-tap ladder: count 1 / 3 / 5 / n deepens the soft acknowledgement.
// Catches the bug where tapTrain capped at 3 and trains past that were silent
// or flat — the low-friction reward loop needs a rising payoff.
const trainHeard = [];
const train = roomGestureBindings({
  senses: { sound: (s) => trainHeard.push(s), touch: () => {} },
  voice: {},
});
for (const count of [1, 3, 5, 7]) {
  train.tap?.({ fingers: 1, count, intensity: 0.5, x: 0, y: 0 });
}
assert.equal(trainHeard.length, 4, "every train tier answers");
assert.ok(trainHeard[1] > trainHeard[0], "tier 3 answers louder than 1");
assert.ok(trainHeard[2] > trainHeard[1], "tier 5 answers louder than 3");
assert.ok(trainHeard[3] > trainHeard[2], "tier n answers louder than 5");

// A room that speaks a verb gets it instead of the acknowledgement.
const spokenRun = exercise({
  tap: () => {},
  plant: () => {},
  wind: () => {},
  night: () => {},
});
assert.ok(spokenRun.spoken.includes("tap"), "a room's own tap is called");
assert.ok(spokenRun.spoken.includes("plant"), "a room's own plant is called at the dwell tier");
assert.ok(spokenRun.spoken.includes("wind"), "three-finger drag reaches the room's wind");
assert.ok(spokenRun.spoken.includes("night"), "flip reaches the room's night");
assert.ok(
  !spokenRun.spoken.includes("stepBack"),
  "an unimplemented verb is acknowledged, not invented",
);

// Three-finger hold is time dilation, and it is *continuous* — a binding that
// fires identically at 900ms and 2400ms is the violation the grammar names.
const dilations = [];
const dilating = roomGestureBindings({
  senses: { sound: () => {}, touch: () => {} },
  voice: { timeScale: (k) => dilations.push(k) },
});
dilating.hold?.({ fingers: 3, phase: "tick", elapsed: 900, tier: 2, intensity: 0.5, x: 0, y: 0 });
dilating.hold?.({ fingers: 3, phase: "tick", elapsed: 2400, tier: 3, intensity: 0.5, x: 0, y: 0 });
dilating.hold?.({ fingers: 3, phase: "release", elapsed: 2600, tier: 3, intensity: 0.5, x: 0, y: 0 });
assert.ok(dilations[0] > dilations[1], "time keeps slowing the longer the hold is held");
assert.equal(dilations[2], 1, "release restores the room's clock");

// The frame verbs stay with ScaleTravel unless the room says it owns them.
assert.equal(exercise({}).bindings.pinch, undefined, "axis rooms must not bind pinch themselves");
assert.ok(
  typeof exercise({}, { travelOwnsFrame: false }).bindings.pinch === "function",
  "a room that owns its frame gets pinch back",
);

// voiceCoverage tells the truth about what a room speaks.
const coverage = voiceCoverage({ tap: () => {}, wind: () => {} });
assert.deepEqual(coverage.spoken.sort(), ["drag3", "tap"], "coverage names exactly what is spoken");
assert.equal(
  coverage.spoken.length + coverage.acknowledged.length,
  ROOM_VERBS.length,
  "every room verb is either spoken or acknowledged — there is no third state",
);
assert.ok(roomVerbSet.has("breath"), "breath is a room verb, not chrome");

// ---------------------------------------------------------------------------
// 5. the webgl harness's pure arithmetic
// ---------------------------------------------------------------------------

// A collapsed parent must never produce a 0×0 framebuffer (an INVALID_VALUE
// that shows up as a blank room, not an error).
const collapsed = resolveStageSize({ width: 0, height: 0, devicePixelRatio: 3, maxRatio: 2 });
assert.ok(collapsed.pixelWidth >= 1 && collapsed.pixelHeight >= 1, "size never collapses to zero");

// The DPR ceiling holds, and renderScale multiplies into it.
const capped = resolveStageSize({ width: 400, height: 300, devicePixelRatio: 4, maxRatio: 2 });
assert.equal(capped.pixelWidth, 800, "device ratio is clamped by the tier ceiling");
const scaled = resolveStageSize({
  width: 400,
  height: 300,
  devicePixelRatio: 4,
  maxRatio: 2,
  renderScale: 0.5,
});
assert.equal(scaled.pixelWidth, 400, "renderScale downsamples the GL pass");
assert.equal(scaled.width, 400, "…while CSS size, and therefore pointer maths, is unchanged");

// A 5K display must not cost sixteen times a laptop: the budget scales the
// ratio, and it scales it *down*, never up.
const huge = resolveStageSize({
  width: 5120,
  height: 2880,
  devicePixelRatio: 2,
  maxRatio: 2,
  maxPixels: 4_200_000,
});
assert.ok(
  huge.pixelWidth * huge.pixelHeight <= 4_200_000 * 1.01,
  "the pixel budget is respected on a huge display",
);
assert.ok(huge.ratio < 2, "…by lowering the ratio, not by cropping the frame");
const small = resolveStageSize({
  width: 320,
  height: 240,
  devicePixelRatio: 2,
  maxRatio: 2,
  maxPixels: 4_200_000,
});
assert.equal(small.ratio, 2, "a small canvas is never upscaled to spend the budget");

// The breath is one clock: same phase everywhere, and reduced motion holds it
// at the midpoint rather than deleting the dimension.
const a = clocksFrom({ time: 0 });
const b = clocksFrom({ time: 1 / 0.14 });
assert.ok(Math.abs(a.breath - b.breath) < 1e-6, "the breath closes its 7s period exactly");
assert.ok(clocksFrom({ time: 1.79 }).breath > 0.99, "the breath reaches its crest");
assert.equal(clocksFrom({ time: 3.3, reducedMotion: true }).breath, 0.5, "stillness holds mid-breath");
assert.equal(clocksFrom({ time: 0, turbulence: 5 }).turbulence, 1, "turbulence is clamped to 0..1");

// Both uniform dialects are written, so no room has to be renamed to adopt it.
for (const names of Object.values(CLOCK_UNIFORMS)) {
  assert.ok(names.length >= 2, "each clock offers both the u_snake and uCamel spelling");
  assert.ok(
    names.some((n) => n.startsWith("u_")) && names.some((n) => /^u[A-Z]/.test(n)),
    "…one of each camp",
  );
}

// A shader error must point at the line, or it is no better than silence.
const err = formatShaderError(
  "cells",
  "fragment",
  "ERROR: 0:3: 'foo' : undeclared identifier",
  "void main() {\n  float a = 1.0;\n  foo();\n}",
);
assert.ok(err.includes("[webgl:cells]"), "the error names the room");
assert.ok(err.includes("> 3|"), "the error points at the offending line");
assert.ok(
  formatShaderError("x", "link", null).includes("no info log"),
  "a driver with nothing to say still produces a usable message",
);

console.log(
  `rooms ok: ${ROOM_MANIFEST_LIST.length} manifests round-trip through ${SITE_ROUTES.length} routes, ` +
    `${PEER_CIRCLES.length} peer circles, the guide and the icon config; ` +
    `${ROOM_VERBS.length} global verbs all answered by a voiceless room; the stage's sizing holds`,
);
