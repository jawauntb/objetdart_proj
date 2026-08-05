import assert from "node:assert/strict";
import { loadTsModule } from "./lib/load-ts.mjs";

/**
 * test-city-perf-allocs — the tick loop's zero-allocation promise, made
 * testable by extracting the plot-view build into src/lib/city-plot-view.ts.
 *
 * Non-negotiable (F) says: zero re-uploads to GPU per frame — no
 * MeshStandardMaterial construction, no BufferGeometry alloc, no
 * CanvasTexture repaint in the tick loop. This test's job is the same
 * discipline one level down: the JS hot path that BUILDS the plot view
 * (fed to skyline.syncPlots each frame) must allocate ZERO objects and
 * ZERO arrays once its scratch is warm, and its per-plot yaw must be
 * cached against a road-revision counter so nearestRoadYaw doesn't
 * re-scan every road segment every frame.
 *
 * If a future edit reintroduces `plots.map(plot => ({...}))` or drops
 * the yaw cache, one of these asserts trips and CI stays honest.
 */

const mod = loadTsModule("src/lib/city-plot-view.ts");
const {
  createPlotViewBuilder,
  nearestRoadYaw,
  ROAD_SNAP_RADIUS_SQ,
} = mod;

// ——— nearestRoadYaw parity with the inline copy ————————————————————————
// The inline version this module replaces returned NaN for an empty road
// list, atan2(dx, dy) for the closest segment within SNAP_RADIUS, and NaN
// past that radius. Pin all three.

assert.ok(Number.isNaN(nearestRoadYaw(0.5, 0.5, [])), "empty roads → NaN");

const oneRoad = [{ x1: 0.4, y1: 0.5, x2: 0.6, y2: 0.5 }];
// A road along +x. atan2(dx, dy) = atan2(0.2, 0) = π/2. A plot on the
// road's axis picks that angle up.
const yaw = nearestRoadYaw(0.5, 0.5, oneRoad);
assert.ok(Math.abs(yaw - Math.PI / 2) < 1e-9,
  `plot on horizontal road picks up +π/2 yaw; got ${yaw}`);

// A plot well outside SNAP_RADIUS returns NaN even with a road present.
const far = nearestRoadYaw(0.5, 0.99, oneRoad);
assert.ok(Number.isNaN(far), `plot outside snap radius → NaN; got ${far}`);
assert.ok(ROAD_SNAP_RADIUS_SQ > 0, "snap radius sq is positive");

// ——— builder: correct shape ————————————————————————————————————————————
// One plot in, one entry out; the entry mirrors the plot's role/seed/x/y/
// sealed, computes bornT ∈ [0.02, 1] from age/growMs, and pulls streetYaw
// from the nearest road (or NaN when none).

const builder = createPlotViewBuilder();
const scratch = [];
const plots = [
  { id: 1, seed: 42, x: 0.5, y: 0.5, role: "home",  sealed: false, bornMs: 0 },
  { id: 2, seed: 99, x: 0.5, y: 0.4, role: "store", sealed: true,  bornMs: 100 },
];
const roads = [{ x1: 0.4, y1: 0.5, x2: 0.6, y2: 0.5 }];

const out1 = builder.build(scratch, plots, roads, 200, 380, 1);
assert.equal(out1, scratch, "build returns the same scratch reference");
assert.equal(out1.length, 2, "one entry per plot");
assert.equal(out1[0].role, "home");
assert.equal(out1[0].seed, 42);
assert.equal(out1[0].sealed, false);
assert.equal(out1[1].sealed, true);
// plot 1: age = 200 - 0 = 200, growMs = 380 → bornT = 200/380 ≈ 0.526
assert.ok(Math.abs(out1[0].bornT - 200 / 380) < 1e-9,
  `bornT rides age/growMs; got ${out1[0].bornT}`);
// plot 2: age = 100, bornT = 100/380 ≈ 0.263
assert.ok(Math.abs(out1[1].bornT - 100 / 380) < 1e-9);
// bornT lower-clamp: a plot on frame one (age = 0) must still write ≥ 0.02
const freshOut = builder.build(scratch, [{ id: 3, seed: 0, x: 0.5, y: 0.5, role: "home", sealed: false, bornMs: 200 }], roads, 200, 380, 1);
assert.ok(freshOut[0].bornT >= 0.02, `bornT lower-clamp: age=0 → ≥ 0.02; got ${freshOut[0].bornT}`);

// ——— zero-allocation steady state ——————————————————————————————————————
// The core promise: once the scratch and yaw cache are warm, a further
// call with the SAME plots + roads returns the SAME scratch reference,
// the SAME per-plot entry references, and does not grow the cache. This
// is the property that translates directly into GC-pressure relief in
// the real tick loop.

const plotsSteady = [
  { id: 10, seed: 1, x: 0.5, y: 0.5, role: "home",  sealed: false, bornMs: 0 },
  { id: 11, seed: 2, x: 0.5, y: 0.4, role: "store", sealed: false, bornMs: 0 },
  { id: 12, seed: 3, x: 0.5, y: 0.6, role: "tree",  sealed: false, bornMs: 0 },
];
const scratchB = [];
const first = builder.build(scratchB, plotsSteady, roads, 500, 380, 5);
const firstArrRef = first;
const firstEntryRefs = first.map((e) => e);
const cacheAfterFirst = builder.cacheSize();

for (let f = 0; f < 30; f += 1) {
  const again = builder.build(scratchB, plotsSteady, roads, 500 + f, 380, 5);
  assert.equal(again, firstArrRef, "scratch array reference is stable across frames");
  for (let i = 0; i < again.length; i += 1) {
    assert.equal(again[i], firstEntryRefs[i], `entry ${i} reference is stable across frames`);
  }
  assert.equal(builder.cacheSize(), cacheAfterFirst,
    "yaw cache does not grow across identical frames");
}

// ——— road-revision invalidation ————————————————————————————————————————
// Bump roadsRev while the plots stand still: the cache must recompute
// yaw. Same rev + same plots + same roads → no recompute (we cannot
// spy on nearestRoadYaw directly, but we can spy on the yaw VALUE
// changing when the road list actually changed under a new rev).

const plotOnRoad = [{ id: 20, seed: 0, x: 0.5, y: 0.5, role: "home", sealed: false, bornMs: 0 }];
const scratchC = [];
builder.build(scratchC, plotOnRoad, roads, 500, 380, 1);
const yawBefore = scratchC[0].streetYaw;
assert.ok(Number.isFinite(yawBefore), "plot on the horizontal road caches a finite yaw");

// Rotate the road 90°: same plot, same rev — the cache is stale so yaw
// stays the OLD value. This is the point of the rev counter.
const rotatedRoads = [{ x1: 0.5, y1: 0.4, x2: 0.5, y2: 0.6 }];
builder.build(scratchC, plotOnRoad, rotatedRoads, 500, 380, 1);
assert.equal(scratchC[0].streetYaw, yawBefore,
  "same rev + same plot → cache is honored, yaw unchanged even though roads mutated");

// Bump rev: now the yaw recomputes against the rotated road.
builder.build(scratchC, plotOnRoad, rotatedRoads, 500, 380, 2);
const yawAfter = scratchC[0].streetYaw;
assert.ok(Number.isFinite(yawAfter), "post-bump yaw is finite (still within snap radius)");
assert.notEqual(yawAfter, yawBefore, "rev bump forces recompute against the new road list");

// ——— grow / shrink without leaking scratch entries ———————————————————
// A plot appears, the scratch grows; a plot disappears, the scratch
// shrinks; and neither transition leaks stale entries into the tail.

const scratchD = [];
const growPlots = [
  { id: 30, seed: 0, x: 0.5, y: 0.5, role: "home",  sealed: false, bornMs: 0 },
];
builder.build(scratchD, growPlots, roads, 500, 380, 1);
assert.equal(scratchD.length, 1, "grow: length matches plots.length");

const growPlots2 = growPlots.concat({ id: 31, seed: 0, x: 0.5, y: 0.4, role: "tree", sealed: false, bornMs: 0 });
builder.build(scratchD, growPlots2, roads, 500, 380, 1);
assert.equal(scratchD.length, 2, "grow: length grew with the plot list");

builder.build(scratchD, growPlots, roads, 500, 380, 1);
assert.equal(scratchD.length, 1, "shrink: length dropped with the plot list");
assert.equal(scratchD[0].role, "home", "shrink: surviving entry still carries its role");

// ——— clear() drops the cache ———————————————————————————————————————
builder.clear();
assert.equal(builder.cacheSize(), 0, "clear() empties the yaw cache");

// ——— tick body: no per-frame object literals ————————————————————————
// The tick loop's contract is "zero allocations at steady state". This
// grep-then-assert scans the source between the `const tick = (now: …)`
// arrow and the `raf = requestAnimationFrame(tick);` at its tail — the
// exact block that runs 60 times a second — and refuses to let the
// signatures we hoisted a scratch for come back as inline literals.
//
// Adding a new subsystem?  Two options:
//   (a) Its update() takes a plain object → hoist a scratch above the
//       tick loop like `_waterFrame`, `_cloudsFrame`, …, and pass THAT.
//   (b) It genuinely wants a fresh literal each frame → extend the
//       `ALLOWED_LITERAL_SNIPPETS` list with a comment explaining why.
//
// This test would have caught the previous round's regression the
// moment it landed instead of after a p99 spike showed up in the
// harness.
import { readFileSync } from "node:fs";
const cityTsx = readFileSync("src/components/City.tsx", "utf8");
const tickStart = cityTsx.indexOf("const tick = (now: number) =>");
assert.ok(tickStart > 0, "tick arrow must exist in City.tsx");
// End marker: the raf reschedule at the bottom of the tick body. There
// are TWO occurrences in City.tsx (`raf = requestAnimationFrame(tick)`)
// — the FIRST one (inside the tick arrow) is what we want; the second
// is the initial mount kick right after the arrow closes. Slicing to
// that first occurrence bounds the tick body precisely.
const tickBodyEnd = cityTsx.indexOf("raf = requestAnimationFrame(tick)", tickStart);
assert.ok(tickBodyEnd > tickStart, "tick body must end with a raf reschedule");
const tickBody = cityTsx.slice(tickStart, tickBodyEnd);

// The forbidden signatures — each one was allocated per frame in a
// prior round and every one has a hoisted scratch equivalent now.
// The tick body must not contain any of these shapes.
const BANNED_LITERAL_PATTERNS = [
  {
    // water.update({ dayFraction: … }) — old signature
    // traffic.update({ dtMs: … })      — old signature
    // pedestrians.update({ dtMs: … })  — old signature
    re: /\{\s*(dayFraction|dtMs)\s*:/,
    where:
      "the tick body must not construct a fresh literal starting with `{ dayFraction:` or `{ dtMs:` — those are the water/traffic/pedestrians/clouds/sundisk frame shapes, and they belong in a hoisted scratch (_waterFrame / _trafficFrame / _pedestriansFrame / _cloudsFrame / _sunDiskFrame)",
  },
  {
    // pedestrianInputs.push({ id: … }) — per-pedestrian per-frame alloc
    re: /\{\s*id\s*:\s*person\./,
    where:
      "the tick body must not push a fresh `{ id: person.… }` per pedestrian — use the _pedInputPool slot-reuse pattern",
  },
  {
    // volFog: VolumetricFogFrame = { … } — hoisted as _volFogFrame
    re: /:\s*VolumetricFogFrame\s*=\s*\{/,
    where:
      "the tick body must not build a `VolumetricFogFrame` literal — hoist as _volFogFrame at scratch init and mutate fogColor in place",
  },
  {
    // projectSunToScreen(…) — its internal .clone() + fresh return object
    // If a maintainer imports the non-`Into` variant, hold the line.
    re: /projectSunToScreen\(/,
    where:
      "the tick body must call projectSunToScreenInto(_sunScreenOut, …) — the non-`Into` variant .clone()s a Vector3 and returns a fresh {x,y,visible} per frame",
  },
];

for (const { re, where } of BANNED_LITERAL_PATTERNS) {
  const hit = tickBody.match(re);
  assert.ok(
    !hit,
    `${where}\n    matched: ${hit ? JSON.stringify(hit[0]) : "(unknown)"} in the tick body`,
  );
}

console.log("test-city-perf-allocs OK");
