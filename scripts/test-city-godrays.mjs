import assert from "node:assert/strict";
import { loadTsModule } from "./lib/load-ts.mjs";

/**
 * test-city-godrays — the pure-math half of the volumetric shafts pass.
 *
 * The ShaderPass itself only comes alive against a real WebGL context;
 * this test doesn't try to render. It pins the strength curve the
 * composer consults per frame:
 *
 *   godraysStrengthForDay(df) → 0..1 shaft strength
 *   distanceToNearestHorizonCrossing(df) → wrapped distance to {0, 0.5}
 *   godraysGateOpen(df)      → false wherever the strength is zero
 *
 * A regression that widened the gate to 0.15 would let god-rays fire
 * at noon; a regression that narrowed it to 0.02 would drain them
 * across the whole reference; a regression that flattened the ramp
 * would kill the horizon-crossing peak the London-dusk reference is
 * about. The test names the four cardinal times and the two horizon
 * crossings so any drift shows up here before it hits the frame.
 */

// Stubs for the Three.js imports the god-rays module carries at load
// time. None of the tested pure functions instantiate any of these.
const V2 = class {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  set(x, y) { this.x = x; this.y = y; }
};
const V3 = class {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; }
  clone() { return new V3(this.x, this.y, this.z); }
  // Fake project — the identity so the visibility rules can be tested.
  project(_cam) { return this; }
};
const threeStub = {
  Vector2: V2,
  Vector3: V3,
};
const shaderPassStub = {
  ShaderPass: class {
    constructor(shader) {
      this.enabled = true;
      const src = shader && shader.uniforms ? shader.uniforms : {};
      this.uniforms = {};
      for (const k of Object.keys(src)) {
        this.uniforms[k] = { value: src[k] ? src[k].value : null };
      }
    }
    setSize() {}
    dispose() {}
  },
};

const mod = loadTsModule("src/lib/city-godrays.ts", {
  requireMap: {
    three: threeStub,
    "three/examples/jsm/postprocessing/ShaderPass.js": shaderPassStub,
  },
});
const {
  GODRAYS_GATE_HALF_WIDTH,
  GODRAYS_SAMPLES,
  godraysStrengthForDay,
  godraysGateOpen,
  distanceToNearestHorizonCrossing,
  projectSunToScreen,
  createCityGodraysPass,
  cityGodraysShader,
} = mod;

// ── the gate constant ────────────────────────────────────────────────────
// The brief pins the gate at 0.08. A future refactor that widened it
// would let god-rays fire well into daylight; narrowing it would
// collapse the shafts into a one-frame flash. The literal is the spec.

assert.equal(GODRAYS_GATE_HALF_WIDTH, 0.08, "gate half-width is 0.08 per the brief");

// ── sample count ─────────────────────────────────────────────────────────
// The brief calls for ~24 radial taps. Kept as a constant so the GLSL
// loop bound and the JS side agree — a drift would either produce a
// banded shaft (too few taps) or blow the fragment budget (too many).

assert.equal(GODRAYS_SAMPLES, 24, "the radial tap count is 24 per the brief");

// ── the four cardinal times (the brief's spec) ────────────────────────────
// The strength curve MUST pin at:
//   dayFraction=0    (dawn horizon)     → 1
//   dayFraction=0.25 (noon)             → 0
//   dayFraction=0.5  (dusk horizon)     → 1
//   dayFraction=0.75 (midnight)         → 0
// A refactor that flattened or shifted the curve would drift the
// horizon-crossing peak the reference is about.

{
  const s = godraysStrengthForDay(0);
  assert.equal(s, 1, `dawn horizon should peak at strength 1; got ${s}`);
}
{
  const s = godraysStrengthForDay(0.25);
  assert.equal(s, 0, `noon should be outside the gate (strength 0); got ${s}`);
}
{
  const s = godraysStrengthForDay(0.5);
  assert.equal(s, 1, `dusk horizon should peak at strength 1; got ${s}`);
}
{
  const s = godraysStrengthForDay(0.75);
  assert.equal(s, 0, `midnight should be outside the gate (strength 0); got ${s}`);
}

// ── horizon crossings + gate edges ────────────────────────────────────────
// At the exact edge of the gate the strength is 0 (open interval); at
// half the gate width the strength is 0.5 (linear ramp).

{
  const s = godraysStrengthForDay(GODRAYS_GATE_HALF_WIDTH);
  // Ramp: s = 1 - d/0.08 = 1 - 0.08/0.08 = 0. Open at the edge.
  assert.ok(Math.abs(s) < 1e-9, `at df=0.08 the ramp hits 0 at the gate edge; got ${s}`);
}
{
  const s = godraysStrengthForDay(0.04);
  assert.ok(
    Math.abs(s - 0.5) < 1e-9,
    `at df=0.04 (half-way through the ramp) strength is 0.5; got ${s}`,
  );
}
{
  const s = godraysStrengthForDay(0.5 - GODRAYS_GATE_HALF_WIDTH);
  assert.ok(Math.abs(s) < 1e-9, `at df=0.42 the ramp hits 0 at the gate edge; got ${s}`);
}
{
  const s = godraysStrengthForDay(0.46);
  assert.ok(
    Math.abs(s - 0.5) < 1e-9,
    `at df=0.46 (half-way through the dusk ramp) strength is 0.5; got ${s}`,
  );
}

// ── wrap-around: df=0.97 is 0.03 away from dawn, not 0.97 ─────────────────
// The day cycle wraps at 0..1. A visitor twisting from midnight into
// dawn crosses the horizon window from either side of zero.

{
  const d = distanceToNearestHorizonCrossing(0.97);
  assert.ok(Math.abs(d - 0.03) < 1e-9, `df=0.97 is 0.03 from dawn; got d=${d}`);
  const s = godraysStrengthForDay(0.97);
  // 1 - 0.03/0.08 = 0.625
  assert.ok(Math.abs(s - 0.625) < 1e-9, `df=0.97 → strength 0.625; got ${s}`);
}
{
  const d = distanceToNearestHorizonCrossing(1.03);
  assert.ok(Math.abs(d - 0.03) < 1e-9, `df=1.03 (wraps to 0.03) is 0.03 from dawn; got d=${d}`);
}
{
  const d = distanceToNearestHorizonCrossing(-0.02);
  assert.ok(Math.abs(d - 0.02) < 1e-9, `df=-0.02 wraps to 0.98, 0.02 from dawn; got d=${d}`);
}

// ── gate open predicate mirrors the strength curve ────────────────────────
// A pure boolean sibling; false wherever strength is 0, true wherever
// strength is positive. Same interval endpoints.

assert.equal(godraysGateOpen(0), true, "gate open at the dawn crossing");
assert.equal(godraysGateOpen(0.5), true, "gate open at the dusk crossing");
assert.equal(godraysGateOpen(0.25), false, "gate closed at noon");
assert.equal(godraysGateOpen(0.75), false, "gate closed at midnight");
// At the exact edge the gate is closed (strength is 0 there).
assert.equal(godraysGateOpen(GODRAYS_GATE_HALF_WIDTH), false, "gate closed at edge d=0.08");

// ── ramp is monotone in either direction from the crossings ──────────────
// Walk noon → dawn: strength must not decrease as we approach df=0
// (the crossing). Sampled across the ramp so a dip in the middle
// would show up.

{
  // Walk from just outside the gate (0.09) toward dawn (0.0). Distance
  // from dawn shrinks, strength grows.
  let prev = -Infinity;
  for (let i = 0; i <= 10; i += 1) {
    const df = 0.09 - (0.09 * i) / 10;
    const s = godraysStrengthForDay(df);
    assert.ok(
      s >= prev - 1e-9,
      `strength must not decrease as we approach the dawn crossing; df=${df} s=${s} prev=${prev}`,
    );
    prev = s;
  }
}
{
  // Walk from just outside the dusk gate (0.41) toward dusk (0.5).
  let prev = -Infinity;
  for (let i = 0; i <= 10; i += 1) {
    const df = 0.41 + (0.09 * i) / 10;
    const s = godraysStrengthForDay(df);
    assert.ok(
      s >= prev - 1e-9,
      `strength must not decrease as we approach the dusk crossing; df=${df} s=${s} prev=${prev}`,
    );
    prev = s;
  }
}

// ── strength is bounded to [0, 1] across the entire day ──────────────────
// A composer that trusted this to be a probability wouldn't want a NaN
// or a value above 1 to feed the shader's additive term. Sample the
// full cycle at 200 slots and demand [0, 1].

for (let i = 0; i < 200; i += 1) {
  const df = i / 200;
  const s = godraysStrengthForDay(df);
  assert.ok(
    Number.isFinite(s) && s >= 0 && s <= 1,
    `strength must live in [0,1] and be finite; df=${df} s=${s}`,
  );
}

// ── projection: visibility flag responds to NDC position ─────────────────
// projectSunToScreen calls Vector3.clone().project(camera). Under our
// stub, project() is the identity — the stub Vector3 doubles as the
// projected NDC vector, so we can pin the visibility rules directly.

{
  // Sun straight in front (NDC (0,0,0)) → visible.
  const v = new V3(0, 0, 0);
  const r = projectSunToScreen(v, /* camera */ {});
  assert.equal(r.visible, true, "sun at NDC (0,0,0) is visible");
  assert.equal(r.x, 0);
  assert.equal(r.y, 0);
}
{
  // Sun behind the camera (z > 1) → invisible.
  const v = new V3(0, 0, 1.5);
  const r = projectSunToScreen(v, {});
  assert.equal(r.visible, false, "sun behind camera (z>1) is not visible");
}
{
  // Sun just off-frame but inside the 1.5× margin → still visible.
  const v = new V3(1.2, 0.4, 0.9);
  const r = projectSunToScreen(v, {});
  assert.equal(r.visible, true, "sun inside the 1.5× soft margin is visible");
}
{
  // Sun far off-screen → invisible.
  const v = new V3(2.0, 0.0, 0.9);
  const r = projectSunToScreen(v, {});
  assert.equal(r.visible, false, "sun far off-screen is not visible");
}

// ── pass construction ────────────────────────────────────────────────────
// A smoke check that the pass returned by the factory carries the
// uniforms the composer writes to per frame. If a future refactor
// renamed `uSunUv` to `uSunPos` the composer would still compile but
// every frame would silently write into a phantom uniform.

const pass = createCityGodraysPass();
assert.ok(pass, "createCityGodraysPass returns a pass");
assert.ok(pass.uniforms, "the pass exposes uniforms");
for (const name of ["tDiffuse", "uSunUv", "uStrength", "uWarmTint", "uDecay", "uExposure"]) {
  assert.ok(
    pass.uniforms[name],
    `pass.uniforms.${name} exists (composer writes to this per frame)`,
  );
}
assert.equal(pass.uniforms.uStrength.value, 0, "initial uStrength is 0 (identity register)");
assert.equal(pass.uniforms.uDecay.value, 0.94, "initial uDecay is 0.94 (geometric falloff)");

// The exported shader spec is what the pass builds from — verify the
// fragment shader carries the god-rays operations and the sample
// count is stamped into it as a literal so a WebGL-1 loop bound is
// legal.
assert.ok(cityGodraysShader, "cityGodraysShader spec is exported");
const frag = cityGodraysShader.fragmentShader || "";
assert.ok(frag.includes(`const int SAMPLES = ${GODRAYS_SAMPLES}`), "fragment shader stamps the tap count");
assert.ok(frag.includes("uSunUv"), "fragment shader samples toward the sun UV");
assert.ok(frag.includes("uStrength"), "fragment shader gates on uStrength");
assert.ok(frag.includes("smoothstep(0.55, 1.0"), "fragment shader carries the luminance soft-clamp");
assert.ok(frag.includes("LUM_709"), "fragment shader uses Rec.709 luminance");
// Sanity: the short-circuit for uStrength<=0 lets the pass be a
// passthrough on 99% of frames.
assert.ok(
  frag.includes("if (uStrength <= 0.0)"),
  "fragment shader short-circuits when strength is zero",
);

console.log(
  "city-godrays ok: strength ramps 0→1→0 across the two horizon-crossing gates, " +
  "pinned at dawn/noon/dusk/midnight + the gate edges, wrap-aware, 24 radial taps, " +
  "luminance-clamped, sun-visibility flag rides the projection.",
);
