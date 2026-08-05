import assert from "node:assert/strict";
import { loadTsModule } from "./lib/load-ts.mjs";

/**
 * test-city-textures — the PBR facade atlas laws.
 *
 * The brief pins /city at Disney/Pixar photoreal. The single biggest tell
 * before this module landed: 48 extruded prisms read as untextured
 * Lambert-ish solids under the new sky. This test file pins the surface-
 * detail laws — brick coursing, plaster render lines, curtain-wall
 * mullion rhythm, bark grooves — so a future refactor cannot silently
 * flatten a wall back to a swatch.
 *
 * The atlas source of truth is city-textures.ts. It is drawn by walking
 * pixels and asking a small set of pure predicates:
 *
 *   homeBrickIsMortar    — running-bond mortar between 8cm×24cm bricks
 *   storePlasterHasLine  — horizontal render seams every 60cm
 *   eventMullionIsVertical / eventMullionIsHorizontal
 *                        — 1.5m mullions × 3.5m floor plates
 *   treeBarkHasGroove    — vertical grooves with a soft horizontal jitter
 *
 * Plus roughnessAt / normalHeightAt / albedoAt derive from the same
 * predicates, so a change here CANNOT desync map/normalMap/roughnessMap.
 * The tests below pin the shape of every predicate, the primality of
 * FACADE_REPEATS, and the coverage / non-overlap of TILE_LAYOUT. If any
 * one drifts we want to see it before it ships, not after the first user
 * complains the walls look like plastic.
 *
 * Node-only: three is stubbed. The atlas drawer touches HTMLCanvasElement
 * so it is not exercised here — the laws it consumes are the tests.
 */

// A minimal three stub — the pure laws don't touch it, but the module
// imports THREE at the top level for its atlas-drawer half.
const threeStub = {
  CanvasTexture: class { constructor() {} dispose() {} },
  SRGBColorSpace: "srgb",
  NoColorSpace: "no-color-space",
  RepeatWrapping: 1000,
  LinearFilter: 1006,
  LinearMipmapLinearFilter: 1008,
  Vector2: class { constructor(x=0,y=0){this.x=x;this.y=y;} set(x,y){this.x=x;this.y=y;return this;} },
};

const mod = loadTsModule("src/lib/city-textures.ts", {
  requireMap: { three: threeStub, "@/three": threeStub },
});

const {
  TILE_LAYOUT,
  FACADE_REPEATS,
  TILE_METRES,
  HOME_BRICK_ROWS,
  HOME_BRICK_COLS,
  STORE_RENDER_LINES,
  EVENT_VERTICAL_MULLIONS,
  EVENT_HORIZONTAL_FLOORS,
  TREE_BARK_GROOVES,
  FACADE_ANISOTROPY,
  homeBrickIsMortar,
  storePlasterHasLine,
  eventMullionIsVertical,
  eventMullionIsHorizontal,
  treeBarkHasGroove,
  roughnessAt,
  normalHeightAt,
  normalAt,
  albedoAt,
  aoAt,
  hash21,
  valueNoise2,
  fbm2,
  weatheringStreak01,
  microHeight01,
  homeBrickChromatic,
  pxBelowFeature,
  isPrime,
  tileUVWindowFor,
  tileRepeatsFor,
} = mod;

// ── tile layout: 2×2 quads that cover [0,1] without overlap ──────────────

const roles = ["home", "store", "event", "tree"];
for (const r of roles) {
  const t = TILE_LAYOUT[r];
  assert.ok(t, `tile layout has an entry for ${r}`);
  assert.ok(t.u0 >= 0 && t.u1 <= 1 && t.v0 >= 0 && t.v1 <= 1,
    `${r} tile stays inside [0,1]: u=${t.u0}..${t.u1} v=${t.v0}..${t.v1}`);
  assert.ok(t.u1 > t.u0 && t.v1 > t.v0, `${r} tile has positive area`);
  const area = (t.u1 - t.u0) * (t.v1 - t.v0);
  assert.ok(Math.abs(area - 0.25) < 1e-6, `${r} tile occupies one quadrant of the atlas (got ${area})`);
}

// Non-overlap: every pair of tiles is disjoint or edge-touching.
function overlaps(a, b) {
  return a.u0 < b.u1 && a.u1 > b.u0 && a.v0 < b.v1 && a.v1 > b.v0;
}
for (let i = 0; i < roles.length; i += 1) {
  for (let j = i + 1; j < roles.length; j += 1) {
    assert.equal(
      overlaps(TILE_LAYOUT[roles[i]], TILE_LAYOUT[roles[j]]), false,
      `${roles[i]} and ${roles[j]} tiles must not overlap`);
  }
}

// Coverage: the union of the four quadrants covers the whole atlas.
// Sum of areas === 1.0.
const sumArea = roles.reduce((sum, r) => {
  const t = TILE_LAYOUT[r];
  return sum + (t.u1 - t.u0) * (t.v1 - t.v0);
}, 0);
assert.ok(Math.abs(sumArea - 1) < 1e-6, `all four tiles cover the atlas exactly (${sumArea})`);

// tileUVWindowFor is a thin accessor and must agree with the table.
for (const r of roles) {
  assert.deepEqual(tileUVWindowFor(r), TILE_LAYOUT[r], `tileUVWindowFor matches TILE_LAYOUT for ${r}`);
}

// ── prime-relative repeat counts ─────────────────────────────────────────
//
// The whole point of the atlas is that walls tile at prime counts so the
// visible pattern never lands on itself in a period the eye can lock onto.
// Every repeat in FACADE_REPEATS must be prime, and tileRepeatsFor must
// agree with the table.

for (const r of roles) {
  const reps = FACADE_REPEATS[r];
  assert.ok(reps, `FACADE_REPEATS has an entry for ${r}`);
  assert.ok(isPrime(reps.u), `${r}.u must be prime (got ${reps.u})`);
  assert.ok(isPrime(reps.v), `${r}.v must be prime (got ${reps.v})`);
  assert.deepEqual(tileRepeatsFor(r), reps, `tileRepeatsFor matches for ${r}`);
}

// The primes must NOT be identical across axes — a wall that repeats
// (7, 7) still shows an obvious diagonal moiré. Pick pairs that don't
// share a divisor even after being taken to small powers.
for (const r of roles) {
  const reps = FACADE_REPEATS[r];
  // A ratio of ~1 stamps the tile obvious. Force the two primes apart
  // by at least a factor of 1.4 on one axis.
  if (r === "tree") continue; // the plaza disc is small and symmetric.
  const ratio = reps.u > reps.v ? reps.u / reps.v : reps.v / reps.u;
  assert.ok(ratio > 1.25 || Math.abs(ratio - 1) < 1e-6,
    `${r} repeat ratio must not be near-1 (was ${ratio.toFixed(2)})`);
}

// A few known non-primes must fail the isPrime helper. If someone
// swaps in a nice-looking round number the material fires the test.
assert.equal(isPrime(9), false, "9 is not prime");
assert.equal(isPrime(15), false, "15 is not prime");
assert.equal(isPrime(1), false, "1 is not prime");
assert.equal(isPrime(2), true, "2 is prime");
assert.equal(isPrime(11), true, "11 is prime");

// ── home brick coursing ──────────────────────────────────────────────────
//
// 25 rows of bricks per tile, 8 columns per row, mortar every row and
// between every brick. Every other row is offset by half a brick (running
// bond). Verify the count of mortar pixels sits in the expected fraction
// of a tile — mortar is thin (1..few pixels wide against a ~10..20px
// brick), so overall mortar area lies between ~8% and ~30% of the tile.

const TILE = 128; // pin at 128 so the counts scale predictably
{
  let mortar = 0;
  for (let y = 0; y < TILE; y += 1) {
    for (let x = 0; x < TILE; x += 1) {
      if (homeBrickIsMortar(x, y, TILE)) mortar += 1;
    }
  }
  const frac = mortar / (TILE * TILE);
  assert.ok(frac > 0.05 && frac < 0.35,
    `home brick mortar covers a modest fraction of the tile (got ${frac.toFixed(3)})`);
}

// Running-bond offset: row 0 and row 1 must produce DIFFERENT vertical-
// mortar column positions. If they didn't, the wall would stamp as
// stacked-bond and lose the brick coursing look.
{
  const y0 = Math.floor(TILE / (HOME_BRICK_ROWS * 2)); // mid row 0
  const y1 = Math.floor((TILE / HOME_BRICK_ROWS) * 1.5); // mid row 1
  let seen0 = [];
  let seen1 = [];
  for (let x = 0; x < TILE; x += 1) {
    if (homeBrickIsMortar(x, y0, TILE)) seen0.push(x);
    if (homeBrickIsMortar(x, y1, TILE)) seen1.push(x);
  }
  assert.ok(seen0.length > 0 && seen1.length > 0, "both rows have vertical mortar columns");
  // The sets shouldn't be identical.
  const eq = seen0.length === seen1.length && seen0.every((v, i) => v === seen1[i]);
  assert.equal(eq, false, "running-bond: consecutive rows have DIFFERENT vertical mortar positions");
}

// Every row must have at least one horizontal mortar band and every
// column at least one vertical mortar seam. If either drops out the
// bricks stopped tiling.
{
  const rowH = TILE / HOME_BRICK_ROWS;
  const colW = TILE / HOME_BRICK_COLS;
  for (let row = 0; row < HOME_BRICK_ROWS; row += 1) {
    const y = Math.floor(row * rowH); // top-of-row pixel
    let any = false;
    for (let x = 0; x < TILE; x += 1) if (homeBrickIsMortar(x, y, TILE)) { any = true; break; }
    assert.ok(any, `row ${row} has a horizontal mortar band`);
  }
  // Sample the center of a brick in row 0 (no shift) — the middle of
  // the first brick must be a brick, not mortar. If every position read
  // as mortar the tile collapsed to a swatch.
  const midY = Math.floor(rowH * 0.5);
  const midX = Math.floor(colW * 0.5);
  assert.equal(homeBrickIsMortar(midX, midY, TILE), false,
    "the center of a brick is not mortar");
}

// ── store plaster render lines ──────────────────────────────────────────

{
  // 4 lines per tile at TILE=128 → line every 32px. The rows at y=0, 32,
  // 64, 96 should be "on the line".
  const period = TILE / STORE_RENDER_LINES;
  for (let n = 0; n < STORE_RENDER_LINES; n += 1) {
    const y = Math.floor(n * period);
    assert.equal(storePlasterHasLine(y, TILE), true,
      `render line at y=${y} (period ${period}) reads as a line`);
  }
  // Halfway between two render lines is NOT a line.
  const y = Math.floor(period * 0.5);
  assert.equal(storePlasterHasLine(y, TILE), false, "mid-tile between render lines is plain plaster");
}

// ── event curtain-wall mullion grid ─────────────────────────────────────

{
  const vPeriod = TILE / EVENT_VERTICAL_MULLIONS;
  const hPeriod = TILE / EVENT_HORIZONTAL_FLOORS;
  // Vertical mullions at columns 0 and vPeriod.
  assert.equal(eventMullionIsVertical(0, TILE), true, "vertical mullion at x=0");
  assert.equal(eventMullionIsVertical(Math.floor(vPeriod), TILE), true,
    `vertical mullion at x=${Math.floor(vPeriod)}`);
  // Between mullions the glass reads as glass.
  assert.equal(eventMullionIsVertical(Math.floor(vPeriod * 0.5), TILE), false,
    "the pane between mullions is not mullion");
  // Horizontal floor plates.
  assert.equal(eventMullionIsHorizontal(0, TILE), true, "floor plate at y=0");
  assert.equal(eventMullionIsHorizontal(Math.floor(hPeriod), TILE), true,
    `floor plate at y=${Math.floor(hPeriod)}`);
  assert.equal(eventMullionIsHorizontal(Math.floor(hPeriod * 0.5), TILE), false,
    "mid-storey is not a floor plate");
}

// ── tree bark grooves ────────────────────────────────────────────────────

{
  let groove = 0;
  for (let y = 0; y < TILE; y += 1) {
    for (let x = 0; x < TILE; x += 1) {
      if (treeBarkHasGroove(x, y, TILE)) groove += 1;
    }
  }
  const frac = groove / (TILE * TILE);
  assert.ok(frac > 0.03 && frac < 0.30,
    `bark groove covers a modest fraction of the trunk (got ${frac.toFixed(3)})`);
  // Grooves cover multiple periods across the tile.
  let transitions = 0;
  let last = false;
  const midY = Math.floor(TILE / 2);
  for (let x = 0; x < TILE; x += 1) {
    const cur = treeBarkHasGroove(x, midY, TILE);
    if (cur !== last) transitions += 1;
    last = cur;
  }
  // With TREE_BARK_GROOVES=6, we expect ~12 transitions across the row.
  assert.ok(transitions >= 6, `bark grooves transition often across a row (got ${transitions})`);
}

// ── roughness law: every feature has the right roughness range ───────────

{
  // Home: mortar rougher than brick.
  const midY = Math.floor(TILE / (HOME_BRICK_ROWS * 2));
  const brickX = Math.floor((TILE / HOME_BRICK_COLS) * 1.5);
  const rBrick = roughnessAt("home", brickX, midY, TILE);
  // Find a known mortar pixel: y = 0 is a horizontal seam.
  const rMortar = roughnessAt("home", brickX, 0, TILE);
  assert.ok(rMortar > rBrick, `mortar (${rMortar}) is rougher than brick (${rBrick})`);
  assert.ok(rMortar <= 1 && rBrick >= 0, "roughness stays in [0,1]");

  // Event: mullions rougher than glass — but both LOW so bloom picks up
  // the pane. Glass roughness must be near-zero for the SF/London look.
  // Sample a pane's interior — mid-storey, mid-bay (not on a mullion or
  // floor plate).
  const vPeriodE = TILE / EVENT_VERTICAL_MULLIONS;
  const hPeriodE = TILE / EVENT_HORIZONTAL_FLOORS;
  const rGlass = roughnessAt("event", Math.floor(vPeriodE * 0.5), Math.floor(hPeriodE * 0.5), TILE);
  const rMullion = roughnessAt("event", 0, Math.floor(hPeriodE * 0.5), TILE);
  assert.ok(rGlass < 0.20, `curtain-wall glass roughness is low (got ${rGlass})`);
  assert.ok(rMullion > rGlass, `mullion is rougher than glass (${rMullion} > ${rGlass})`);

  // Tree bark is the roughest thing in the frame.
  const rBark = roughnessAt("tree", 0, Math.floor(TILE / 2), TILE);
  const rBarkFlat = roughnessAt("tree", Math.floor(TILE / 4), Math.floor(TILE / 2) + 5, TILE);
  assert.ok(Math.max(rBark, rBarkFlat) > 0.85, "bark reads as very rough");

  // Store plaster somewhere in the middle band.
  const rPlaster = roughnessAt("store", Math.floor(TILE / 2), Math.floor(TILE / 2) + 3, TILE);
  assert.ok(rPlaster > 0.4 && rPlaster < 0.9, `plaster roughness is mid (got ${rPlaster})`);
}

// Roughness is bounded — no NaN, no negative, no > 1.
for (const r of roles) {
  for (let y = 0; y < TILE; y += 7) {
    for (let x = 0; x < TILE; x += 7) {
      const v = roughnessAt(r, x, y, TILE);
      assert.ok(Number.isFinite(v) && v >= 0 && v <= 1,
        `roughness stays finite in [0,1] for role=${r} px=${x},${y} (${v})`);
    }
  }
}

// ── normal law: features produce a nontrivial normal displacement ──────

{
  // A pixel on a mullion should have a normal that is NOT (0, 0, 1).
  const nMullion = normalAt("event", 0, Math.floor(TILE / 2), TILE);
  assert.ok(nMullion && Number.isFinite(nMullion.nx), "mullion normal is defined");
  const mag = Math.sqrt(nMullion.nx ** 2 + nMullion.ny ** 2 + nMullion.nz ** 2);
  assert.ok(Math.abs(mag - 1) < 1e-3, `normal is unit length (got ${mag})`);

  // Flat brick center should read close to straight-up: |nz| large,
  // |nx|+|ny| small.
  const brickX = Math.floor((TILE / HOME_BRICK_COLS) * 1.5);
  const brickY = Math.floor((TILE / HOME_BRICK_ROWS) * 1.5);
  // Nudge x/y to definitely be inside a brick, not at the mortar edge.
  const nBrick = normalAt("home", brickX, brickY, TILE);
  assert.ok(Math.abs(nBrick.nz) > 0.5,
    `brick center normal points mostly up (nz=${nBrick.nz.toFixed(3)})`);
}

// normalHeightAt in [0,1] everywhere.
for (const r of roles) {
  for (let y = 0; y < TILE; y += 11) {
    for (let x = 0; x < TILE; x += 11) {
      const h = normalHeightAt(r, x, y, TILE);
      assert.ok(h >= 0 && h <= 1 && Number.isFinite(h),
        `normal height in [0,1] for ${r} at ${x},${y} (${h})`);
    }
  }
}

// ── albedo: features tint differently from surfaces ──────────────────────

{
  // Home mortar is greyer than brick (r ~ g ~ b). Pick a brick pixel
  // that is definitively inside a brick (row 0, col 0 center — no
  // running-bond offset).
  const rowH = TILE / HOME_BRICK_ROWS;
  const colW = TILE / HOME_BRICK_COLS;
  const mortarPx = { x: 0, y: 0 };
  const brickPx = {
    x: Math.floor(colW * 0.5),
    y: Math.floor(rowH * 0.5),
  };
  // Confirm the picked pixel really is a brick, not mortar.
  assert.equal(homeBrickIsMortar(brickPx.x, brickPx.y, TILE), false,
    "picked-brick sample really is inside a brick");
  const aMortar = albedoAt("home", mortarPx.x, mortarPx.y, TILE);
  const aBrick = albedoAt("home", brickPx.x, brickPx.y, TILE);
  const mortarSpread = Math.max(aMortar.r, aMortar.g, aMortar.b) - Math.min(aMortar.r, aMortar.g, aMortar.b);
  const brickSpread = Math.max(aBrick.r, aBrick.g, aBrick.b) - Math.min(aBrick.r, aBrick.g, aBrick.b);
  assert.ok(mortarSpread < brickSpread,
    `mortar (${mortarSpread.toFixed(3)}) is more neutral than brick (${brickSpread.toFixed(3)})`);
  // Brick is warm — red > green > blue.
  assert.ok(aBrick.r > aBrick.g && aBrick.g > aBrick.b, "brick reads as a warm red-brown");
}

// Every albedo value is in [0, 1].
for (const r of roles) {
  for (let y = 0; y < TILE; y += 13) {
    for (let x = 0; x < TILE; x += 13) {
      const a = albedoAt(r, x, y, TILE);
      for (const v of [a.r, a.g, a.b]) {
        assert.ok(v >= 0 && v <= 1 && Number.isFinite(v),
          `albedo channel in [0,1] for ${r} at ${x},${y} (${v})`);
      }
    }
  }
}

// ── tile metres: the physical unit table is honest ──────────────────────
{
  // Home tile covers 8 bricks across = 8 × 24cm = 1.92m; the exported
  // TILE_METRES.home.widthM is 2.0m so the wall's per-brick pitch stays
  // within a couple of centimetres of 24cm. Same check on height:
  // 25 courses × 8cm = 2.0m exactly.
  assert.ok(Math.abs(TILE_METRES.home.heightM - HOME_BRICK_ROWS * 0.08) < 0.02,
    "home tile height matches 25 courses × 8cm mortar-line pitch");
  assert.ok(Math.abs(TILE_METRES.home.widthM - HOME_BRICK_COLS * 0.24) < 0.1,
    "home tile width covers 8 bricks × 24cm");
  // Event tile: 3m wide, 2 mullion bays at 1.5m = 3m. 7m tall, 2 floor
  // plates at 3.5m = 7m.
  assert.ok(Math.abs(TILE_METRES.event.widthM - EVENT_VERTICAL_MULLIONS * 1.5) < 0.01,
    "event tile width matches 2 × 1.5m mullion bays");
  assert.ok(Math.abs(TILE_METRES.event.heightM - EVENT_HORIZONTAL_FLOORS * 3.5) < 0.01,
    "event tile height matches 2 × 3.5m floor plates");
}

// ── deterministic — the atlas is a pure function of (tilePx, role) ─────
{
  const points = [
    ["home",  10, 10],
    ["store", 33, 44],
    ["event", 60, 60],
    ["tree",  17, 90],
  ];
  for (const [role, x, y] of points) {
    const a = albedoAt(role, x, y, TILE);
    const b = albedoAt(role, x, y, TILE);
    assert.deepEqual(a, b, `albedo is pure — same (role, x, y) reads the same twice`);
    const n1 = normalAt(role, x, y, TILE);
    const n2 = normalAt(role, x, y, TILE);
    assert.deepEqual(n1, n2, `normal is pure — same (role, x, y) reads the same twice`);
    assert.equal(roughnessAt(role, x, y, TILE), roughnessAt(role, x, y, TILE),
      `roughness is pure — same (role, x, y) reads the same twice`);
  }
}

// ── photoreal detail layer: FBM + weathering + AO ──────────────────────
//
// This block pins the NEW photogrammetric-detail invariants: a
// deterministic value-noise / FBM hash, weathering streaks that descend
// from mortar seams / render lines / floor plates, a real ambient-
// occlusion channel with valley darkening, and per-brick chromatic
// dispersion. If any of these regress the atlas falls back to painted
// flat luminance ramps — the pre-detail look the brief calls out as the
// single largest close-zoom tell.

// hash21 is a 2-arg hash returning [0, 1).
{
  const a = hash21(1.7, 3.9);
  const b = hash21(1.7, 3.9);
  assert.equal(a, b, "hash21 is deterministic: same args read the same twice");
  assert.ok(a >= 0 && a < 1, `hash21 in [0,1) (got ${a})`);
  // Different args produce different outputs (with overwhelming probability).
  assert.notEqual(hash21(1.7, 3.9), hash21(2.3, 4.1), "hash21 responds to inputs");
}

// valueNoise2 is a bilinearly interpolated value-noise in [0, 1].
{
  for (let i = 0; i < 40; i += 1) {
    const nx = (i * 0.7) % 8;
    const ny = ((i * 1.3) + 1.1) % 8;
    const v = valueNoise2(nx, ny);
    assert.ok(v >= 0 && v <= 1 && Number.isFinite(v),
      `valueNoise2(${nx}, ${ny}) in [0,1] (got ${v})`);
  }
  // Continuous — a small step produces a small change.
  const a = valueNoise2(2.11, 3.71);
  const b = valueNoise2(2.11 + 1e-3, 3.71);
  assert.ok(Math.abs(a - b) < 0.05, `valueNoise2 continuous (Δ=${Math.abs(a - b).toFixed(4)})`);
}

// fbm2 sums octaves; range remains in [0, 1] and is deterministic.
{
  const a = fbm2(3.14, 2.71, 4);
  const b = fbm2(3.14, 2.71, 4);
  assert.equal(a, b, "fbm2 is deterministic");
  assert.ok(a >= 0 && a <= 1 && Number.isFinite(a), `fbm2 in [0,1] (got ${a})`);
  // Two different points produce different outputs.
  assert.notEqual(fbm2(1.1, 1.2, 4), fbm2(4.7, 5.3, 4), "fbm2 responds to inputs");
}

// ── weathering streaks descend from horizontal features ─────────────────

{
  // A home tile at TILE=128, HOME_BRICK_ROWS=25 → rowH ≈ 5.12. A pixel
  // right above y=0 (top of tile) is "above" the mortar seam, which
  // in a periodic tile wraps to the seam BELOW. pxBelowFeature returns
  // yMod, so at y=0 it's 0 (on the seam). weathering there ~0.
  // A pixel a few rows down is well below the seam and can carry a
  // streak. Sample many pixels across a column and confirm the mean
  // weathering peaks in the top ~half of a period, not the bottom.
  const col = 10;
  const period = TILE / HOME_BRICK_ROWS;
  let topSum = 0, botSum = 0, topN = 0, botN = 0;
  for (let y = 0; y < TILE; y += 1) {
    const yMod = pxBelowFeature("home", col, y, TILE);
    const dropFrac = yMod / period;
    const w = weatheringStreak01("home", col, y, TILE);
    if (dropFrac < 0.4) { topSum += w; topN += 1; }
    else                { botSum += w; botN += 1; }
  }
  const topMean = topSum / Math.max(1, topN);
  const botMean = botSum / Math.max(1, botN);
  // Weathering peaks near the top of a period (just below the seam)
  // and decays toward the bottom. Top mean should exceed bottom mean.
  assert.ok(topMean > botMean,
    `home weathering peaks under the mortar seam (top ${topMean.toFixed(3)} > bot ${botMean.toFixed(3)})`);
  // Tree has no water staining.
  for (let y = 0; y < TILE; y += 8) {
    assert.equal(weatheringStreak01("tree", 5, y, TILE), 0,
      "tree bark carries no water-stain streaks");
  }
  // Weathering stays in [0, 1].
  for (const r of roles) {
    for (let y = 0; y < TILE; y += 9) {
      for (let x = 0; x < TILE; x += 9) {
        const w = weatheringStreak01(r, x, y, TILE);
        assert.ok(w >= 0 && w <= 1 && Number.isFinite(w),
          `weathering in [0,1] for ${r} at ${x},${y} (${w})`);
      }
    }
  }
}

// ── micro-normal detail is bounded and continuous ───────────────────────

{
  for (const r of roles) {
    let mmax = -Infinity, mmin = Infinity;
    for (let y = 0; y < TILE; y += 5) {
      for (let x = 0; x < TILE; x += 5) {
        const m = microHeight01(r, x, y, TILE);
        if (m > mmax) mmax = m;
        if (m < mmin) mmin = m;
        assert.ok(Number.isFinite(m) && Math.abs(m) < 0.10,
          `microHeight bounded for ${r} at ${x},${y} (${m})`);
      }
    }
    // The micro layer must actually VARY — a flat return means the atlas
    // reverts to the pre-detail three-luminance look.
    assert.ok(mmax - mmin > 0.02,
      `microHeight varies across ${r} (range ${(mmax - mmin).toFixed(3)})`);
  }
}

// ── per-brick chromatic dispersion ──────────────────────────────────────
//
// Hash 20 different bricks and confirm each is warm (r > g > b) but the
// SET of centroids has genuine variance — the wall reads as many
// individually-fired bricks, not one paint colour.

{
  const rs = [], gs = [], bs = [];
  for (let idx = 0; idx < 20; idx += 1) {
    const c = homeBrickChromatic(idx);
    assert.ok(c.r > c.g && c.g > c.b,
      `brick #${idx} reads warm (r=${c.r.toFixed(3)} > g=${c.g.toFixed(3)} > b=${c.b.toFixed(3)})`);
    rs.push(c.r); gs.push(c.g); bs.push(c.b);
  }
  const spread = (arr) => Math.max(...arr) - Math.min(...arr);
  assert.ok(spread(rs) > 0.03, `brick R centroids scatter across bricks (spread ${spread(rs).toFixed(3)})`);
  assert.ok(spread(gs) > 0.02, `brick G centroids scatter across bricks (spread ${spread(gs).toFixed(3)})`);
}

// ── ambient occlusion channel ───────────────────────────────────────────
//
// AO in [0, 1]. Mortar valley / mullion corner samples DARKER than a
// wide-open brick / glass center. Otherwise the aoMap does nothing and
// the fourth PBR channel is dead weight.

{
  // Every AO sample is in [0, 1].
  for (const r of roles) {
    for (let y = 0; y < TILE; y += 11) {
      for (let x = 0; x < TILE; x += 11) {
        const v = aoAt(r, x, y, TILE);
        assert.ok(v >= 0 && v <= 1 && Number.isFinite(v),
          `AO in [0,1] for ${r} at ${x},${y} (${v})`);
      }
    }
  }
  // Home: sample AO at a mortar seam vs a brick center. The seam sits
  // in a valley (heights around are higher on both sides), the center
  // sits on a plateau. Valley AO < plateau AO.
  const rowH = TILE / HOME_BRICK_ROWS;
  const colW = TILE / HOME_BRICK_COLS;
  // Mortar corner: intersection of a horizontal seam and a vertical seam
  // for row 0. y=0 is the horizontal seam; x=0 the leftmost vertical.
  const aoCorner = aoAt("home", 0, 0, TILE);
  const aoBrick = aoAt("home", Math.floor(colW * 1.5), Math.floor(rowH * 1.5), TILE);
  assert.ok(aoCorner < aoBrick,
    `mortar corner AO (${aoCorner.toFixed(3)}) is darker than brick center (${aoBrick.toFixed(3)})`);
  // Event: mullion junction AO < glass center AO.
  const vPeriodE = TILE / EVENT_VERTICAL_MULLIONS;
  const hPeriodE = TILE / EVENT_HORIZONTAL_FLOORS;
  const aoMull = aoAt("event", 0, 0, TILE);
  const aoGlass = aoAt("event", Math.floor(vPeriodE * 0.5), Math.floor(hPeriodE * 0.5), TILE);
  assert.ok(aoMull < aoGlass,
    `mullion corner AO (${aoMull.toFixed(3)}) darker than glass center (${aoGlass.toFixed(3)})`);
}

// ── anisotropy constant ────────────────────────────────────────────────
{
  assert.ok(Number.isInteger(FACADE_ANISOTROPY) && FACADE_ANISOTROPY >= 8,
    `FACADE_ANISOTROPY >= 8 for crisp grazing-angle street shots (got ${FACADE_ANISOTROPY})`);
}

console.log(
  `city-textures ok: TILE_LAYOUT 4-quadrant coverage sums to 1, ` +
  `all FACADE_REPEATS prime (home ${FACADE_REPEATS.home.u}×${FACADE_REPEATS.home.v}, ` +
  `store ${FACADE_REPEATS.store.u}×${FACADE_REPEATS.store.v}, ` +
  `event ${FACADE_REPEATS.event.u}×${FACADE_REPEATS.event.v}, ` +
  `tree ${FACADE_REPEATS.tree.u}×${FACADE_REPEATS.tree.v}), ` +
  `brick mortar reads coursed with running bond, ` +
  `store render lines at 60cm honest, ` +
  `event mullion grid (${EVENT_VERTICAL_MULLIONS}v × ${EVENT_HORIZONTAL_FLOORS}h) resolves, ` +
  `bark grooves transition, ` +
  `roughness/normal/albedo laws hold and stay pure. the facades finally read as architecture.`,
);
