import assert from "node:assert/strict";
import { loadTsModule } from "./lib/load-ts.mjs";

/**
 * test-city-curtainwall — the pure ladder + hash math that runs on the
 * event tower's curtain wall.
 *
 * These are the properties the shader chunk depends on. A refactor that
 * silently widens a mullion, moves a pane column count outside the
 * [16..96] band, or lets the per-pane roughness climb above the range
 * of architectural glass (0.05..0.18) would collapse the close-zoom
 * silhouette back to the "flat plastic" look the brief calls out as the
 * loudest CG tell — so this file fires before that lands.
 *
 * The module has both pure functions and THREE-touching factories. We
 * only import the pure surface here; the THREE material builder is
 * exercised at runtime by /city itself.
 */

// A very thin THREE stub — enough for the imports to satisfy the module
// but no real classes are exercised by the tests below.
const threeStub = {
  Color: class { constructor(v){ this._v = v; } },
  Vector2: class { constructor(x,y){ this.x=x; this.y=y; } },
  MeshPhysicalMaterial: class {
    constructor(o={}){ Object.assign(this, o); this.name = ""; }
    dispose(){}
  },
};

const mod = loadTsModule("src/lib/city-curtainwall.ts", {
  requireMap: { three: threeStub },
});
const {
  STORY_HEIGHT_M,
  MULLION_PITCH_M,
  MULLION_THICKNESS_M,
  PANE_ROUGH_MIN,
  PANE_ROUGH_MAX,
  PANE_TINT_COOL,
  PANE_TINT_WARM,
  paneCoordFromWorld,
  mullionMask01,
  paneHash01,
  paneRoughness,
  paneTintDrift01,
  mixHex,
  columnCountForRadius,
  curtainWallTierFor,
  equatorRadiusForVariant,
  VARIANT_EQUATOR_RADIUS_LOCAL,
  curtainWallVertexInject,
  curtainWallFragmentCommonInject,
  curtainWallFragmentMapInject,
  curtainWallFragmentRoughnessInject,
  curtainWallFragmentEmissiveInject,
} = mod;

// ── constants: the real-world ladder ────────────────────────────────────

assert.equal(STORY_HEIGHT_M, 3.0, "story height must be 3.0m (one standard office bay)");
assert.equal(MULLION_PITCH_M, 1.5, "mullion pitch must be 1.5m (two panes per bay)");
assert.ok(
  MULLION_THICKNESS_M >= 0.03 && MULLION_THICKNESS_M <= 0.15,
  `mullion thickness (${MULLION_THICKNESS_M}m) must sit in real profile range 30..150mm`,
);
assert.ok(
  PANE_ROUGH_MIN >= 0.02 && PANE_ROUGH_MIN <= 0.10,
  `pane roughness min (${PANE_ROUGH_MIN}) must sit in polished-glass range`,
);
assert.ok(
  PANE_ROUGH_MAX <= 0.22 && PANE_ROUGH_MAX > PANE_ROUGH_MIN,
  `pane roughness max (${PANE_ROUGH_MAX}) must stay below satin-plastic and above min`,
);
assert.notEqual(PANE_TINT_COOL, PANE_TINT_WARM, "tint axis must have two distinct endpoints");

// ── paneCoordFromWorld: monotonic, wrapping, well-fractioned ─────────────

// The row is worldY divided by STORY. So worldY = 6.0 with STORY = 3 → row 2.
{
  const p = paneCoordFromWorld(6.0, 0, 32);
  assert.equal(p.row, 2, `worldY=6 must land on row 2, got ${p.row}`);
  assert.ok(Math.abs(p.rowFrac) < 1e-6, "row fraction at story boundary must be ≈ 0");
}

// A story-and-a-half up: row = 1, rowFrac = 0.5
{
  const p = paneCoordFromWorld(4.5, 0, 32);
  assert.equal(p.row, 1);
  assert.ok(Math.abs(p.rowFrac - 0.5) < 1e-6, `rowFrac at 4.5m must be 0.5, got ${p.rowFrac}`);
}

// angle wraps: -π and π must map to the same column
{
  const a = paneCoordFromWorld(0, -Math.PI, 24);
  const b = paneCoordFromWorld(0, Math.PI, 24);
  // Both should live on the u=0/1 boundary; row is 0 for both.
  assert.equal(a.row, 0);
  assert.equal(b.row, 0);
  // Their column indices should be equivalent mod colCount.
  assert.equal(((a.col % 24) + 24) % 24, ((b.col % 24) + 24) % 24);
}

// Monotonic column as angle sweeps from -π to +π at fixed row.
{
  const N = 24;
  let last = -Infinity;
  let hitTopOnce = false;
  for (let i = 0; i <= 200; i += 1) {
    const angle = -Math.PI + (i / 200) * (Math.PI * 2 - 1e-6);
    const p = paneCoordFromWorld(0, angle, N);
    // colInt in [0..N-1]; monotonic non-decreasing across the sweep.
    assert.ok(p.col >= 0 && p.col < N, `col ${p.col} in bounds`);
    if (p.col === N - 1) hitTopOnce = true;
    assert.ok(p.col >= last, `col must not go backwards: ${last} → ${p.col}`);
    last = p.col;
  }
  assert.ok(hitTopOnce, "the sweep must have touched the topmost column at least once");
}

// ── mullionMask01: sits at the grid lines only ──────────────────────────

// At (rowFrac, colFrac) = (0.5, 0.5) the mask must be 0 — deep inside a
// pane, no mullion.
assert.equal(mullionMask01(0.5, 0.5), 0, "pane interior must be free of mullion");

// At (rowFrac, colFrac) = (0.001, 0.5) the mask must be 1 — sitting on
// a horizontal mullion.
assert.equal(mullionMask01(0.001, 0.5), 1, "horizontal mullion must fire at row boundary");

// At (rowFrac, colFrac) = (0.5, 0.999) — vertical mullion.
assert.equal(mullionMask01(0.5, 0.999), 1, "vertical mullion must fire at column boundary");

// Verify the mullion band width matches the constants: MULLION_THICKNESS
// / STORY on rows, MULLION_THICKNESS / PITCH on cols. So a fragment at
// rowFrac = 0.024 (0.072/3.0) sits ON the mullion; one at 0.03 sits OFF.
{
  const rowBand = MULLION_THICKNESS_M / STORY_HEIGHT_M; // 0.06/3 = 0.020
  const colBand = MULLION_THICKNESS_M / MULLION_PITCH_M; // 0.06/1.5 = 0.040
  assert.equal(mullionMask01(rowBand * 0.5, 0.5), 1);
  assert.equal(mullionMask01(rowBand * 1.2, 0.5), 0);
  assert.equal(mullionMask01(0.5, colBand * 0.5), 1);
  assert.equal(mullionMask01(0.5, colBand * 1.2), 0);
}

// ── paneHash01: deterministic, spreads across [0,1) ─────────────────────

// Deterministic in seed + (row, col).
{
  const a = paneHash01(42, 3, 5);
  const b = paneHash01(42, 3, 5);
  assert.equal(a, b, "hash is deterministic");
}

// Two different (row, col) at the same seed hash to different values.
{
  const a = paneHash01(42, 3, 5);
  const b = paneHash01(42, 4, 5);
  const c = paneHash01(42, 3, 6);
  assert.notEqual(a, b, "row change must change hash");
  assert.notEqual(a, c, "col change must change hash");
}

// Two different seeds at the same (row, col) hash to different values.
{
  const a = paneHash01(42, 3, 5);
  const b = paneHash01(43, 3, 5);
  assert.notEqual(a, b, "seed change must change hash");
}

// Spread: sample 10k panes, mean should be ≈ 0.5, variance non-zero.
{
  let sum = 0, sumSq = 0, n = 0;
  for (let r = 0; r < 100; r += 1) {
    for (let c = 0; c < 100; c += 1) {
      const h = paneHash01(1234, r, c);
      assert.ok(h >= 0 && h < 1, `hash out of range: ${h}`);
      sum += h; sumSq += h * h; n += 1;
    }
  }
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  assert.ok(mean > 0.42 && mean < 0.58, `hash mean ~0.5, got ${mean.toFixed(3)}`);
  assert.ok(variance > 0.05, `hash variance must be non-degenerate, got ${variance.toFixed(3)}`);
}

// ── paneRoughness: gated by tier, stays in [MIN..MAX] ────────────────────

for (const t of ["high", "medium", "low"]) {
  for (let i = 0; i <= 10; i += 1) {
    const r = paneRoughness(i / 10, t);
    assert.ok(
      r >= PANE_ROUGH_MIN - 1e-6 && r <= PANE_ROUGH_MAX + 1e-6,
      `pane roughness at tier ${t} must stay in [${PANE_ROUGH_MIN}..${PANE_ROUGH_MAX}], got ${r}`,
    );
  }
}

// High tier: h=0 → MIN, h=1 → MAX.
assert.ok(Math.abs(paneRoughness(0, "high") - PANE_ROUGH_MIN) < 1e-6);
assert.ok(Math.abs(paneRoughness(1, "high") - PANE_ROUGH_MAX) < 1e-6);

// Medium/low: constant midpoint.
{
  const mid = (PANE_ROUGH_MIN + PANE_ROUGH_MAX) * 0.5;
  assert.equal(paneRoughness(0, "medium"), mid);
  assert.equal(paneRoughness(1, "medium"), mid);
  assert.equal(paneRoughness(0.5, "low"), mid);
}

// ── paneTintDrift01: gated by tier ──────────────────────────────────────

assert.equal(paneTintDrift01(0.3, "high"), 0.3);
assert.equal(paneTintDrift01(0.7, "high"), 0.7);
assert.equal(paneTintDrift01(0.3, "medium"), 0.5);
assert.equal(paneTintDrift01(0.3, "low"), 0.5);

// ── mixHex: endpoints and midpoint ──────────────────────────────────────

assert.equal(mixHex(0x000000, 0xFFFFFF, 0), 0x000000);
assert.equal(mixHex(0x000000, 0xFFFFFF, 1), 0xFFFFFF);
// midpoint of cool → warm sits between the two.
{
  const mid = mixHex(PANE_TINT_COOL, PANE_TINT_WARM, 0.5);
  const midR = (mid >> 16) & 0xFF;
  const coolR = (PANE_TINT_COOL >> 16) & 0xFF;
  const warmR = (PANE_TINT_WARM >> 16) & 0xFF;
  assert.ok(midR > Math.min(coolR, warmR) && midR < Math.max(coolR, warmR));
}

// ── columnCountForRadius: clamped to [16..96], round to whole panes ─────

// Tiny radius clamps to 16 (a 0.5m tower doesn't exist, but the clamp
// guards a runtime seed regression).
assert.equal(columnCountForRadius(0.1), 16);

// Realistic Salesforce equator ≈ 3.3m (from a 6m footprint × 0.55 local
// radius): circumference ≈ 20.7m, / 1.5 = 13.8 rounds to 14, clamped
// UP to 16.
assert.equal(columnCountForRadius(3.3), 16);

// Realistic Gherkin equator ≈ 6.44m (7m footprint × 0.92 local radius):
// circ ≈ 40.5m, / 1.5 = 27.
assert.equal(columnCountForRadius(6.44), 27);

// Huge radius clamps to 96.
assert.equal(columnCountForRadius(100), 96);

// ── curtainWallTierFor: default rules ───────────────────────────────────

assert.equal(curtainWallTierFor(true), "high");
assert.equal(curtainWallTierFor(false), "medium");
assert.equal(curtainWallTierFor(true, "low"), "low");
assert.equal(curtainWallTierFor(false, "high"), "high");

// ── equatorRadiusForVariant: three distinct variants ────────────────────

const rGherkin = equatorRadiusForVariant(0);
const rSalesforce = equatorRadiusForVariant(1);
const rTransam = equatorRadiusForVariant(2);
assert.notEqual(rGherkin, rSalesforce);
assert.notEqual(rSalesforce, rTransam);
// Gherkin has the widest equator of the three (the barrel swell).
assert.ok(rGherkin > rSalesforce, `Gherkin equator ${rGherkin} must exceed Salesforce ${rSalesforce}`);
assert.ok(rGherkin > rTransam, `Gherkin equator ${rGherkin} must exceed Transamerica ${rTransam}`);

// The local-radius table is a friend of anyone reading city-towers to
// verify their profile numbers. Pin the shape.
assert.ok(VARIANT_EQUATOR_RADIUS_LOCAL.gherkin > 0);
assert.ok(VARIANT_EQUATOR_RADIUS_LOCAL.salesforce > 0);
assert.ok(VARIANT_EQUATOR_RADIUS_LOCAL.transamerica > 0);

// ── shader inject strings: shape + tier gating ──────────────────────────

// Vertex block always defines the two varyings and captures modelMatrix.
{
  const v = curtainWallVertexInject();
  assert.ok(typeof v.commonHeader === "string");
  assert.ok(typeof v.afterProject === "string");
  assert.ok(v.commonHeader.includes("varying vec3 vCwWorldPos"));
  assert.ok(v.commonHeader.includes("varying vec3 vCwLocalPos"));
  assert.ok(v.afterProject.includes("modelMatrix"));
  assert.ok(v.afterProject.includes("vCwWorldPos"));
}

// Fragment common block declares all uniforms.
{
  const f = curtainWallFragmentCommonInject();
  for (const u of [
    "uCwStoryM", "uCwPitchM", "uCwMullionM", "uCwPaneRoughness",
    "uCwTintCool", "uCwTintWarm", "uCwSeed", "uCwColCount",
    "uCwMullionDarken", "uCwTintStrength",
  ]) {
    assert.ok(f.includes(u), `fragment common must declare ${u}`);
  }
  assert.ok(f.includes("cwHash"), "fragment common must define cwHash");
  assert.ok(f.includes("cwPane"), "fragment common must define cwPane");
  assert.ok(f.includes("cwMullionMask"), "fragment common must define cwMullionMask");
}

// Map inject: high tier includes tint mix; medium doesn't; low is empty.
{
  const high = curtainWallFragmentMapInject("high");
  const medium = curtainWallFragmentMapInject("medium");
  const low = curtainWallFragmentMapInject("low");
  assert.ok(high.includes("mix( uCwTintCool"), "high tier must apply tint mix");
  assert.ok(!medium.includes("mix( uCwTintCool"), "medium tier must skip tint mix");
  assert.ok(medium.includes("cwMullionMask"), "medium tier still darkens at mullions");
  assert.equal(low.length, 0, "low tier map inject must be empty");
}

// Roughness inject writes to roughnessFactor.
{
  const r = curtainWallFragmentRoughnessInject();
  assert.ok(r.includes("roughnessFactor"));
  assert.ok(r.includes("uCwPaneRoughness"));
}

// Emissive inject darkens totalEmissiveRadiance at mullion.
{
  const e = curtainWallFragmentEmissiveInject();
  assert.ok(e.includes("totalEmissiveRadiance"));
  assert.ok(e.includes("cwMullionMask"));
}

console.log("test-city-curtainwall: OK");
