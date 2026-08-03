// The fork-region laws. The bugs these catch: a pinch in the sky routed
// through the sea door (inverted y), a door invented that the travel graph
// never offered, a hand rerouted through a door it did not point at, a seam
// on the boundary line where both doors (or neither) claim the point, a
// fork wall that answers differently on the second identical pinch, and a
// per-frame ridge buffer moving a wall that is already being pressed.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const rootUrl = new URL("../", import.meta.url);

function loadTsModule(path) {
  const filename = fileURLToPath(new URL(path, rootUrl));
  const source = readFileSync(filename, "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", code)(module, module.exports, (id) => {
    throw new Error(`Unexpected require(${id}) while loading ${path}`);
  });
  return module.exports;
}

const F = loadTsModule("src/lib/fork-regions.ts");

// Deterministic PRNG for the fuzz sweeps — the suite must never flake.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// —— a point in a declared region takes that door and no other ————————
// The bug: the y convention flipped (ny = 0 is the TOP of the frame), so a
// pinch in the sky above the fog would travel through the sea door below it.
{
  const doors = ["atlas", "coast"];
  const regions = F.horizonSplit(0.42, "atlas", "coast");
  assert.equal(F.resolveForkByPoint(regions, 0.5, 0.1, doors), "atlas", "high on the frame is the sky door");
  assert.equal(F.resolveForkByPoint(regions, 0.5, 0.9, doors), "coast", "low on the frame is the sea door");
  // ...and the same at the frame's corners, where an off-by-scale bug hides.
  assert.equal(F.resolveForkByPoint(regions, 0, 0, doors), "atlas");
  assert.equal(F.resolveForkByPoint(regions, 1, 1, doors), "coast");
}
// The vertical twin: left/right swapped would send every lateral door the
// wrong way while looking plausible in isolation.
{
  const doors = ["coast", "olympus"];
  const regions = F.verticalSplit(0.5, "coast", "olympus");
  assert.equal(F.resolveForkByPoint(regions, 0.1, 0.5, doors), "coast", "west of the line is the left door");
  assert.equal(F.resolveForkByPoint(regions, 0.9, 0.5, doors), "olympus", "east of the line is the right door");
}

// —— no claim means null, so the caller cycles exactly as before ————————
// The bug: the resolver guessing a door for an unclaimed point, which would
// silently overwrite the press-release-press fallback everywhere at once.
{
  const regions = [F.region("atlas", (nx, ny) => ny < 0.2 && nx > 0.5)];
  assert.equal(F.resolveForkByPoint(regions, 0.2, 0.8, ["atlas"]), null, "an unclaimed point names nothing");
  assert.equal(F.resolveForkByPoint([], 0.5, 0.5, ["atlas"]), null, "no regions, no door");
}

// —— never invent a door ————————————————————————————————————————
// The bug: a room's declaration outrunning the travel graph — a region
// naming a door the wall does not offer, and the resolver returning it
// anyway, navigating to a band the fork never held.
{
  const regions = F.horizonSplit(0.5, "space", "coast");
  assert.equal(
    F.resolveForkByPoint(regions, 0.5, 0.1, ["coast", "earth"]),
    null,
    "a claimed door not on offer refuses — the caller falls back to the cycle",
  );
  assert.equal(F.resolveForkByPoint(regions, 0.5, 0.1, []), null, "no doors on offer, no answer");
  // The subtler half: another region ALSO claims the point and its door IS
  // offered — but the first claimer spoke. Rerouting here would send the
  // hand somewhere it did not point.
  const overlapping = [
    F.region("space", () => true),
    F.region("coast", () => true),
  ];
  assert.equal(
    F.resolveForkByPoint(overlapping, 0.5, 0.5, ["coast"]),
    null,
    "an unavailable first claim is a refusal, never a reroute",
  );
}
// Fuzz the law: whatever the regions and the point, the answer is one of
// the offered doors or null. A single invented door here is a navigation
// to a room the travel graph never opened.
{
  const rand = mulberry32(0xf0f);
  const doors = ["a", "b", "c"];
  for (let i = 0; i < 500; i++) {
    const regions = [
      ...F.horizonSplit(rand(), doors[Math.floor(rand() * 3)], "ghost"),
      F.region("phantom", (nx, ny) => nx + ny > rand()),
    ];
    const out = F.resolveForkByPoint(regions, rand(), rand(), doors);
    assert.ok(out === null || doors.includes(out), `never a door outside the offer (got ${out})`);
  }
}

// —— region order is the tie-break, deterministically ————————————————
// The bug: overlapping claims resolved by anything other than list order
// (object key order, a set, iteration instability) — the same pinch on the
// same wall taking different doors on different days.
{
  const first = F.region("atlas", (nx, ny) => ny < 0.6);
  const second = F.region("earth", (nx, ny) => ny < 0.8);
  assert.equal(F.resolveForkByPoint([first, second], 0.5, 0.5, ["atlas", "earth"]), "atlas", "the first claimer speaks");
  assert.equal(F.resolveForkByPoint([second, first], 0.5, 0.5, ["atlas", "earth"]), "earth", "reversed order, reversed voice");
  // A point only the second region claims still reaches it.
  assert.equal(F.resolveForkByPoint([first, second], 0.5, 0.7, ["atlas", "earth"]), "earth", "order filters, it does not truncate");
}

// —— the boundary lands on exactly one side, along the whole line ————————
// The bug: a </<= mismatch between the two halves of a split, opening a
// seam where the horizon itself belongs to both doors or to neither — a
// pinch on the shoreline flickering or dead.
{
  for (const split of [0, 0.25, 0.42, 0.5, 0.77, 1]) {
    const regions = F.horizonSplit(split, "up", "down");
    for (const ny of [split - 1e-9, split, split + 1e-9, 0, 1]) {
      if (ny < 0 || ny > 1) continue;
      const claims = regions.filter((r) => r.test(0.5, ny)).length;
      assert.equal(claims, 1, `exactly one region claims ny=${ny} against split=${split}`);
    }
    // The line itself is the lower door — grounded, documented, and pinned
    // so a future edit cannot silently flip which side owns the horizon.
    if (split >= 0 && split <= 1) {
      assert.equal(F.resolveForkByPoint(regions, 0.3, split, ["up", "down"]), "down", "the horizon line is ground, not sky");
    }
  }
  // Same seam law swept along a ridge, where the boundary moves with nx.
  const ridge = [0.3, 0.5, 0.2, 0.6, 0.4];
  const regions = F.silhouetteSplit(ridge, "sky", "stone");
  for (let i = 0; i <= 200; i++) {
    const nx = i / 200;
    const edge = F.silhouetteAt(ridge, nx);
    for (const ny of [edge - 1e-9, edge, edge + 1e-9]) {
      if (ny < 0 || ny > 1) continue;
      const claims = regions.filter((r) => r.test(nx, ny)).length;
      assert.equal(claims, 1, `exactly one claim on the ridge at nx=${nx}`);
    }
  }
}

// —— the silhouette truly interpolates ————————————————————————————
// The bug: nearest-sample rounding instead of interpolation — a staircase
// ridge that misroutes every pinch near a steep slope.
{
  assert.equal(F.silhouetteAt([0.2, 0.8], 0.5), 0.5, "halfway between samples is halfway between heights");
  assert.ok(Math.abs(F.silhouetteAt([0.2, 0.8], 0.25) - 0.35) < 1e-12, "a quarter along is a quarter up");
  // Samples are the ny of the silhouette line: [0.2, 0.8] is a ridge high
  // in the west sinking east. Nearest-sample rounding would read the ridge
  // at nx=0.4 as 0.2 (sample 0) and call ny=0.35 stone; interpolation puts
  // the line at 0.44 and calls it sky.
  const regions = F.silhouetteSplit([0.2, 0.8], "sky", "stone");
  const doors = ["sky", "stone"];
  assert.equal(F.resolveForkByPoint(regions, 0.4, 0.35, doors), "sky", "the interpolated line, not the nearest sample, is the wall");
  assert.equal(F.resolveForkByPoint(regions, 0.1, 0.35, doors), "stone", "the same ny is inside the high west ground");
  // Reversed sample indexing would pass every symmetric case — catch it
  // with an asymmetric ridge.
  const tilted = F.silhouetteSplit([0.9, 0.1], "sky", "stone");
  assert.equal(F.resolveForkByPoint(tilted, 0.05, 0.5, doors), "sky", "the west end is low ground: ny=0.5 is open air");
  assert.equal(F.resolveForkByPoint(tilted, 0.95, 0.5, doors), "stone", "the east end is high ground: the same point is inside it");
  // One sample is a flat horizon, not a crash or a guess.
  assert.equal(F.silhouetteAt([0.4], 0.7), 0.4, "a single sample holds the whole width");
}

// —— the wall does not move once declared ————————————————————————
// The bug: silhouetteSplit capturing the room's live per-frame buffer by
// reference, so refilling it mid-press silently redraws a wall the hand is
// already leaning on.
{
  const live = [0.5, 0.5, 0.5];
  const regions = F.silhouetteSplit(live, "sky", "stone");
  const before = F.resolveForkByPoint(regions, 0.5, 0.3, ["sky", "stone"]);
  live[0] = 0.1;
  live[1] = 0.1;
  live[2] = 0.1;
  assert.equal(
    F.resolveForkByPoint(regions, 0.5, 0.3, ["sky", "stone"]),
    before,
    "a refilled frame buffer never moves a declared wall",
  );
}

// —— same inputs, same door, every time ————————————————————————————
// The bug: hidden state, input mutation, or iteration nondeterminism — the
// hard requirement is that a fork wall is a function, not a mood.
{
  const rand = mulberry32(0xdead);
  const ridge = Array.from({ length: 9 }, () => rand());
  const regions = F.silhouetteSplit(ridge, "sky", "stone");
  const doors = ["stone", "sky"];
  for (let i = 0; i < 200; i++) {
    const nx = rand();
    const ny = rand();
    const first = F.resolveForkByPoint(regions, nx, ny, doors);
    for (let k = 0; k < 5; k++) {
      assert.equal(F.resolveForkByPoint(regions, nx, ny, doors), first, "the same pinch takes the same door");
    }
  }
  // ...and resolving must not have eaten its inputs.
  assert.deepEqual(doors, ["stone", "sky"], "the offer list is read, never rewritten");
  assert.equal(regions.length, 2, "the region list is read, never rewritten");
}

// —— degenerate inputs refuse rather than guess ————————————————————
// The bug: NaN flowing through comparisons (NaN < x is false) and silently
// electing the `below` door — a broken centroid becoming a real navigation.
{
  const regions = F.horizonSplit(0.5, "up", "down");
  const doors = ["up", "down"];
  for (const [nx, ny] of [
    [NaN, 0.5],
    [0.5, NaN],
    [Infinity, 0.5],
    [0.5, -Infinity],
    [-0.01, 0.5],
    [1.01, 0.5],
    [0.5, -0.01],
    [0.5, 1.01],
  ]) {
    assert.equal(F.resolveForkByPoint(regions, nx, ny, doors), null, `a degenerate point (${nx}, ${ny}) names nothing`);
  }
  // The frame's own edges are honest points, not degenerate ones — a hand
  // can pinch at the very top of the screen.
  assert.equal(F.resolveForkByPoint(regions, 0.5, 0, doors), "up", "the top edge is inside the frame");
  assert.equal(F.resolveForkByPoint(regions, 0.5, 1, doors), "down", "so is the bottom edge");
  // Degenerate declarations declare nothing at all.
  assert.deepEqual(F.horizonSplit(NaN, "a", "b"), [], "a NaN horizon is no horizon");
  assert.deepEqual(F.verticalSplit(Infinity, "a", "b"), [], "an infinite meridian is no meridian");
  assert.deepEqual(F.silhouetteSplit([], "a", "b"), [], "an empty ridge is no ridge");
  assert.deepEqual(F.silhouetteSplit([0.3, NaN, 0.4], "a", "b"), [], "one NaN sample poisons the whole ridge — refuse it");
}

console.log(
  "fork-regions ok: the pinch point picks the door with y honest to the frame, unclaimed points and unoffered doors refuse to the cycle, no door is ever invented over 500 fuzzed walls, order breaks ties both ways, every boundary lands on exactly one side along swept lines, declared walls hold still, and 200 pinches repeated five times each never changed their answer",
);
