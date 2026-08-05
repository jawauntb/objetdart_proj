import assert from "node:assert/strict";
import { loadTsModule } from "./lib/load-ts.mjs";

/**
 * test-city-painterly — the pure-math half of the Currier & Ives register.
 *
 * The painterly ShaderPass itself only comes alive against a real WebGL
 * context; this test doesn't try to render. It pins the strength curve
 * the composer consults per frame:
 *
 *   painterlyStrengthForPitch(pitch01) → 0 at eye-level, 1 at bird's-eye
 *
 * A regression that flattened this curve would drain the wide-zoom
 * painterly register — the room would read as one photorealistic
 * register at every pitch. The test names the three sample points
 * (pitch01 = 0.5 / 0.75 / 1.0) the brief calls out, plus the two
 * endpoints and the monotone requirement so any drift shows up here
 * before it hits the frame.
 */

// Stubs for the Three.js imports the painterly module carries at load
// time. None of the tested functions instantiate any of these.
const noop = () => {};
const threeStub = {
  Vector2: class {
    constructor(x = 0, y = 0) { this.x = x; this.y = y; }
    set(x, y) { this.x = x; this.y = y; }
  },
};
const shaderPassStub = {
  ShaderPass: class {
    constructor(shader) {
      this.enabled = true;
      // ShaderPass in three clones the uniforms; we mirror that so the
      // module's `pass.uniforms` writes don't touch the shared spec.
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

const mod = loadTsModule("src/lib/city-painterly.ts", {
  requireMap: {
    three: threeStub,
    "three/examples/jsm/postprocessing/ShaderPass.js": shaderPassStub,
  },
});
const {
  painterlyStrengthForPitch,
  PAINTERLY_PITCH_START,
  PAINTERLY_PITCH_END,
  createCityPainterlyPass,
  cityPainterlyShader,
} = mod;

// ── constants ─────────────────────────────────────────────────────────────
// The brief pins the ramp at pitch01 > 0.6. A future refactor that moved
// the start above 0.7 or below 0.5 would drift the register — the wide
// zoom would either arrive painterly too late (dulling the aesthetic
// step-change) or too early (bleeding into eye-level).

assert.equal(PAINTERLY_PITCH_START, 0.6, "painterly ramp starts at pitch01 = 0.6 (from the brief)");
assert.ok(PAINTERLY_PITCH_START < PAINTERLY_PITCH_END, "the painterly ramp span is non-degenerate");
assert.ok(PAINTERLY_PITCH_END <= 1.0, "the painterly ramp ends inside the pitch01 domain");

// ── three sample-point pins (the brief's spec) ────────────────────────────
// The brief says "pin the strength curve at pitch01 = 0.5 / 0.75 / 1.0"
// so a paint refactor doesn't quietly drift the wide-zoom register.

{
  const s = painterlyStrengthForPitch(0.5);
  assert.equal(
    s,
    0,
    `below the ramp, painterly strength is 0 (photoreal register); got ${s} at pitch01=0.5`,
  );
}
{
  const s = painterlyStrengthForPitch(0.75);
  // pitch01=0.75 is exactly the midpoint of [0.6..0.9]. A smoothstep at
  // the midpoint returns 0.5.
  assert.ok(
    s > 0.4 && s < 0.6,
    `at pitch01=0.75 the smoothstep midpoint should be ~0.5; got ${s}`,
  );
}
{
  const s = painterlyStrengthForPitch(1.0);
  assert.equal(
    s,
    1,
    `above the ramp, painterly strength is 1 (fully painterly); got ${s} at pitch01=1.0`,
  );
}

// ── endpoints and clamps ──────────────────────────────────────────────────

assert.equal(painterlyStrengthForPitch(0), 0, "eye-level frame is photoreal (strength 0)");
assert.equal(
  painterlyStrengthForPitch(PAINTERLY_PITCH_START),
  0,
  "at the ramp start the strength is exactly 0",
);
assert.equal(
  painterlyStrengthForPitch(PAINTERLY_PITCH_END),
  1,
  "at the ramp end the strength is exactly 1",
);
assert.equal(painterlyStrengthForPitch(-0.5), 0, "under-clamped pitch stays at strength 0");
assert.equal(painterlyStrengthForPitch(2.0), 1, "over-clamped pitch stays at strength 1");

// ── monotone across the axis (no dip in the middle of the ramp) ──────────

{
  let prev = -Infinity;
  for (let i = 0; i <= 40; i += 1) {
    const p = i / 40;
    const s = painterlyStrengthForPitch(p);
    assert.ok(
      s >= prev - 1e-9,
      `painterlyStrengthForPitch must be monotone; p=${p} s=${s} prev=${prev}`,
    );
    prev = s;
  }
}

// ── pass construction ────────────────────────────────────────────────────
// A test-only smoke check that the pass returned by the factory has
// the uniforms the composer expects to write per frame. If a future
// refactor renamed `uStrength` to `uAmount` the composer would still
// compile (property access is untyped through JS) but every frame
// would silently write into a phantom uniform. This test catches
// that at unit-test time, not at first pinch.

const pass = createCityPainterlyPass();
assert.ok(pass, "createCityPainterlyPass returns a pass");
assert.ok(pass.uniforms, "the pass exposes uniforms");
for (const name of ["tDiffuse", "uStrength", "uTime", "uVignette", "uResolution"]) {
  assert.ok(
    pass.uniforms[name],
    `pass.uniforms.${name} exists (composer writes to this per frame)`,
  );
}
assert.equal(pass.uniforms.uStrength.value, 0, "initial uStrength is 0 (identity register)");
assert.equal(pass.uniforms.uTime.value, 0, "initial uTime is 0 (grain starts fresh)");
assert.equal(pass.uniforms.uVignette.value, 1.0, "initial uVignette is 1.0 (baseline halo)");

// The exported shader spec is what the pass builds from — verify its
// fragment shader carries the four operations the brief calls for.
assert.ok(cityPainterlyShader, "cityPainterlyShader spec is exported");
const frag = cityPainterlyShader.fragmentShader || "";
assert.ok(frag.includes("hueRotate"), "fragment shader includes the warm hue rotate op");
assert.ok(frag.includes("CONTRAST_PULL"), "fragment shader includes the contrast pull op");
assert.ok(frag.includes("smoothstep(0.25, 0.75"), "fragment shader includes the radial vignette op");
assert.ok(frag.includes("hash21"), "fragment shader includes the paper-grain noise op");
assert.ok(frag.includes("uStrength"), "fragment shader gates every op on uStrength");

console.log(
  "city-painterly ok: strength ramps 0→1 across pitch [0.6..0.9], pinned at 0.5/0.75/1.0, " +
  "smoothstep monotone, pass carries the four painterly operations.",
);
