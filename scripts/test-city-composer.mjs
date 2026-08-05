import assert from "node:assert/strict";
import { loadTsModule } from "./lib/load-ts.mjs";

/**
 * test-city-composer — the pure-math half of the render pipeline.
 *
 * The composer itself is a Three.js EffectComposer that only comes alive
 * against a real WebGL context; this test doesn't try to render. It pins
 * the pure functions the composer consults per-frame:
 *
 *   bloomParamsForDay(df) → threshold, strength, radius (the ember curve)
 *   dofStrengthForPitch(p01) → the Bokeh DOF ramp at wide zoom
 *   passesForTier(tier)   → which passes are alive at low/medium/high/sleep
 *
 * A regression in any of these three is a regression in the dusk moment
 * (bloom), the Currier & Ives model-scale moment (DOF), or the governor's
 * device-tier promise (tier gating). The test names each cliff so a future
 * refactor can't quietly move it.
 *
 * We do NOT construct the composer here — the tests must run in plain node
 * without a GL context. The stub below just satisfies the imports the
 * module carries at load time. `passesForTier`, `bloomParamsForDay`, and
 * `dofStrengthForPitch` are pure JS.
 */

// Minimal stubs for the Three.js imports the composer module carries. None
// of the tested functions instantiate any of these — the tests inspect
// only the pure JS exports.
const noop = () => {};
const stubClass = class {
  constructor() {}
  dispose() {}
  setSize() {}
  render() {}
  addPass() {}
  setPixelRatio() {}
};
const threeStub = {
  HalfFloatType: 0,
  Vector2: class {
    constructor(x = 0, y = 0) { this.x = x; this.y = y; }
    set(x, y) { this.x = x; this.y = y; }
  },
  Vector3: class {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; }
    clone() { return new threeStub.Vector3(this.x, this.y, this.z); }
    project() { return this; }
  },
  // Stub Matrix4 — city-godrays constructs identity mat4s for its
  // uInverseProjection / uInverseView uniform defaults. The stub only
  // needs a constructor and a `copy` method; no math is performed on
  // these in the pure test path.
  Matrix4: class {
    constructor() { this.elements = new Array(16).fill(0); }
    copy(o) {
      for (let i = 0; i < 16; i += 1) this.elements[i] = o.elements[i];
      return this;
    }
  },
  WebGLRenderTarget: class {
    constructor() {}
    dispose() {}
  },
};
const composerStubModule = { EffectComposer: stubClass };
const renderPassStub = { RenderPass: stubClass };
const bloomStub = { UnrealBloomPass: class { constructor() { this.enabled = true; } setSize() {} dispose() {} } };
const ssaoStub = { SSAOPass: class { constructor() { this.enabled = true; } setSize() {} dispose() {} } };
const bokehStub = {
  BokehPass: class {
    constructor() {
      this.enabled = true;
      this.uniforms = { maxblur: { value: 0 }, aperture: { value: 0 } };
    }
    setSize() {}
    dispose() {}
  },
};
const outputStub = { OutputPass: stubClass };
// ShaderPass — the painterly module imports this at load-time. The
// composer imports the painterly module at load-time, so this stub is
// reachable through the alias chain the loader traverses.
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
const runtimeStub = {}; // types only, no runtime members used by pure fns

const mod = loadTsModule("src/lib/city-composer.ts", {
  requireMap: {
    three: threeStub,
    "three/examples/jsm/postprocessing/EffectComposer.js": composerStubModule,
    "three/examples/jsm/postprocessing/RenderPass.js": renderPassStub,
    "three/examples/jsm/postprocessing/UnrealBloomPass.js": bloomStub,
    "three/examples/jsm/postprocessing/SSAOPass.js": ssaoStub,
    "three/examples/jsm/postprocessing/BokehPass.js": bokehStub,
    "three/examples/jsm/postprocessing/OutputPass.js": outputStub,
    "three/examples/jsm/postprocessing/ShaderPass.js": shaderPassStub,
    "@/lib/room-runtime": runtimeStub,
  },
});
const { bloomParamsForDay, dofStrengthForPitch, passesForTier, PITCH_DOF_START, PITCH_DOF_END } = mod;

// ── bloom ember curve ──────────────────────────────────────────────────────
// The ember at dusk is the emotional peak the brief calls the core of the
// room; the tests below pin its four cardinal times, then demand smoothness
// across the arc. A regression that flattened the strength curve would drain
// the entire lit-window moment; a regression that raised the noon threshold
// past 1.0 would kill even the sun disk's bloom.

{
  const noon = bloomParamsForDay(0.25);
  assert.ok(noon.threshold > 0.7, `noon threshold should stay high; got ${noon.threshold}`);
  assert.ok(noon.strength < 0.35, `noon strength should be a whisper; got ${noon.strength}`);
}
{
  const dusk = bloomParamsForDay(0.5);
  assert.ok(dusk.threshold < noon().threshold, `dusk threshold drops below noon; got ${dusk.threshold}`);
  assert.ok(dusk.strength > noon().strength, `dusk strength rises past noon; got ${dusk.strength}`);
  assert.ok(dusk.radius > noon().radius, `dusk radius widens past noon; got ${dusk.radius}`);
}
{
  // The ember maxes out at midnight because dNoon-to-noon is largest there.
  // That is the honest curve — lit windows are the emotional peak of the
  // ember, and they only glow after dusk.
  const midnight = bloomParamsForDay(0.75);
  assert.ok(midnight.strength > 0.85, `midnight strength peaks on lit windows; got ${midnight.strength}`);
  assert.ok(midnight.threshold < 0.6, `midnight threshold drops so warm mids bloom; got ${midnight.threshold}`);
}
function noon() { return bloomParamsForDay(0.25); }
{
  // The ember must be at least as strong at dusk as at noon — a regression
  // that inverted the curve would still pass the four spot-checks in
  // isolation. Sampled twelve slots to hold the shape.
  let prev = -Infinity;
  for (let i = 0; i <= 3; i += 1) {
    const df = 0.25 + (0.25 * i) / 3; // walk noon → dusk
    const s = bloomParamsForDay(df).strength;
    assert.ok(s >= prev - 1e-6, `strength must be non-decreasing from noon toward dusk; df=${df} s=${s} prev=${prev}`);
    prev = s;
  }
}

// ── DOF ramp on pitch ──────────────────────────────────────────────────────
// The Currier & Ives model-scale moment lives above pitch01 = PITCH_DOF_START.
// Below that threshold the frame is photoreal and razor-sharp; above
// PITCH_DOF_END the frame is fully in the diorama blur. The ramp is a
// smoothstep so a slow pinch never snaps and a fast pinch never chatters.

assert.ok(PITCH_DOF_START < PITCH_DOF_END, "the DOF ramp span is non-degenerate");
assert.equal(dofStrengthForPitch(0), 0, "eye-level frame is razor-sharp (DOF strength 0)");
assert.equal(dofStrengthForPitch(PITCH_DOF_START), 0, "at the start of the ramp the DOF strength is exactly 0");
assert.equal(dofStrengthForPitch(1), 1, "bird's-eye frame is fully in the diorama blur (DOF strength 1)");
assert.equal(dofStrengthForPitch(PITCH_DOF_END), 1, "at the end of the ramp the DOF strength is exactly 1");

// Monotone across the axis — no dip in the middle of the ramp.
{
  let prev = -Infinity;
  for (let i = 0; i <= 40; i += 1) {
    const p = i / 40;
    const s = dofStrengthForPitch(p);
    assert.ok(s >= prev - 1e-9, `dofStrengthForPitch must be monotone; p=${p} s=${s} prev=${prev}`);
    prev = s;
  }
}
// Under/over clamp
assert.equal(dofStrengthForPitch(-1), 0, "under-clamped pitch stays at DOF strength 0");
assert.equal(dofStrengthForPitch(2), 1, "over-clamped pitch stays at DOF strength 1");

// Middle of the ramp is around 0.5 (a smoothstep at the midpoint).
{
  const mid = 0.5 * (PITCH_DOF_START + PITCH_DOF_END);
  const s = dofStrengthForPitch(mid);
  assert.ok(s > 0.4 && s < 0.6, `smoothstep midpoint should be near 0.5; got ${s}`);
}

// ── tier gating ──────────────────────────────────────────────────────────
// The device-tier promise: slow devices trade beauty for framerate. A
// regression here would either kill the aesthetic on a high-tier device
// or blow the budget on a low-tier device — either way the room fails
// half its audience. The ladder is:
//   sleep/low → nothing
//   medium    → bloom + ssao + god-rays (same gate SSAO uses; the brief's spec)
//   high      → bloom + ssao + god-rays + dof

{
  const high = passesForTier("high");
  assert.deepEqual(
    high,
    { bloom: true, ssao: true, dof: true, godrays: true },
    "high tier has all four post-passes on",
  );
}
{
  const medium = passesForTier("medium");
  assert.deepEqual(
    medium,
    { bloom: true, ssao: true, dof: false, godrays: true },
    "medium tier has bloom + ssao + god-rays, no DOF (god-rays ride the SSAO gate per the brief)",
  );
}
{
  const low = passesForTier("low");
  assert.deepEqual(
    low,
    { bloom: false, ssao: false, dof: false, godrays: false },
    "low tier has no post-passes",
  );
}
{
  const sleep = passesForTier("sleep");
  assert.deepEqual(
    sleep,
    { bloom: false, ssao: false, dof: false, godrays: false },
    "sleep tier has no post-passes",
  );
}

// ── bokeh depth pre-pass gating on pitch ──────────────────────────────────
// The BokehPass internally renders the skyline scene with a MeshDepthMaterial
// override into its own depth target before applying the blur. At the default
// wide-view pitch01=0 the strength curve is exactly 0, so the blur is a no-op
// copy — but the depth pre-pass would still run every frame unless we gate
// `enabled` on the strength. Painterly already uses this pattern (see the
// composer body). The invariant this test pins: after a render() at high
// tier with pitch01 < PITCH_DOF_START, bokehPass.enabled MUST be false;
// after a render() at high tier with pitch01 >= PITCH_DOF_END, it MUST be
// true.
//
// We construct the composer against the module-load stubs plus a small set
// of runtime stubs for scene/camera/renderer — the pure JS branches inside
// render() decide bokehPass.enabled without touching any GL.
// Construct the composer against a BokehPass stub that captures the
// instance on a shared ref, then drive render() at a handful of
// (tier, pitch01) points and assert on the pass's `enabled` bit.
{
  let capturedBokeh = null;
  const bokehStubCapture = {
    BokehPass: class {
      constructor() {
        this.enabled = true;
        this.uniforms = { maxblur: { value: 0 }, aperture: { value: 0 } };
        capturedBokeh = this;
      }
      setSize() {}
      dispose() {}
    },
  };
  // loadTsModule caches by requireMap KEY-names — same keys returns the
  // cached module and uses the original stubs. Add a unique sentinel key
  // so this load gets its own cache entry and picks up bokehStubCapture.
  const captureMod = loadTsModule("src/lib/city-composer.ts", {
    requireMap: {
      three: threeStub,
      "three/examples/jsm/postprocessing/EffectComposer.js": composerStubModule,
      "three/examples/jsm/postprocessing/RenderPass.js": renderPassStub,
      "three/examples/jsm/postprocessing/UnrealBloomPass.js": bloomStub,
      "three/examples/jsm/postprocessing/SSAOPass.js": ssaoStub,
      "three/examples/jsm/postprocessing/BokehPass.js": bokehStubCapture,
      "three/examples/jsm/postprocessing/OutputPass.js": outputStub,
      "three/examples/jsm/postprocessing/ShaderPass.js": shaderPassStub,
      "@/lib/room-runtime": runtimeStub,
      "__cache_bust_bokeh_capture__": {},
    },
  });
  const scene = {};
  const cam = {};
  const renderer = {
    getPixelRatio() { return 1; },
    setSize() {},
    render() {},
    clear() {},
    dispose() {},
  };
  const composer = captureMod.createCityComposer({
    renderer,
    groundScene: scene,
    groundCam: cam,
    plotScene: scene,
    plotCam: cam,
    skylineScene: scene,
    skylineCam: cam,
    width: 800,
    height: 600,
    pixelRatio: 1,
  });

  assert.ok(capturedBokeh, "BokehPass should be constructed when a skyline scene is present");

  // High tier, eye-level (pitch01 = 0): the depth pre-pass MUST be off,
  // because dofStrengthForPitch(0) === 0 and the blur is a no-op copy.
  composer.render(0.25, "high", 0);
  assert.equal(
    capturedBokeh.enabled,
    false,
    "at wide-view (pitch01=0) high tier, bokehPass.enabled must be false — no depth pre-pass for a zero-blur frame",
  );

  // High tier, bird's-eye (pitch01 = 1): the depth pre-pass MUST run.
  composer.render(0.25, "high", 1);
  assert.equal(
    capturedBokeh.enabled,
    true,
    "at bird's-eye (pitch01=1) high tier, bokehPass.enabled must be true — the diorama blur is on",
  );

  // High tier, at exactly PITCH_DOF_START (strength 0): still off.
  composer.render(0.25, "high", PITCH_DOF_START);
  assert.equal(
    capturedBokeh.enabled,
    false,
    "at pitch01=PITCH_DOF_START high tier, bokehPass.enabled must be false — the ramp is exactly 0 at the start",
  );

  // High tier, past PITCH_DOF_START by a hair (strength > 0): on.
  composer.render(0.25, "high", PITCH_DOF_START + 0.05);
  assert.equal(
    capturedBokeh.enabled,
    true,
    "at pitch01 just above PITCH_DOF_START, bokehPass.enabled must be true — any positive blur runs the pass",
  );

  // Medium tier at bird's-eye: DOF is not alive at medium, so the pass
  // MUST stay off regardless of the pitch.
  composer.render(0.25, "medium", 1);
  assert.equal(
    capturedBokeh.enabled,
    false,
    "at bird's-eye medium tier, bokehPass.enabled must be false — tier ladder gates DOF off",
  );

  // Low tier at bird's-eye: same story, pass off.
  composer.render(0.25, "low", 1);
  assert.equal(
    capturedBokeh.enabled,
    false,
    "at bird's-eye low tier, bokehPass.enabled must be false — tier ladder gates DOF off",
  );

  // Gate.dof off at high tier bird's-eye: pass must stay off.
  composer.setPassGates({ dof: false });
  composer.render(0.25, "high", 1);
  assert.equal(
    capturedBokeh.enabled,
    false,
    "with the dof gate closed, bokehPass.enabled must be false even at bird's-eye — gate ANDs with the tier ladder",
  );

  // Re-open the gate — bird's-eye high tier: pass on again.
  composer.setPassGates({ dof: true });
  composer.render(0.25, "high", 1);
  assert.equal(
    capturedBokeh.enabled,
    true,
    "with the dof gate re-opened at bird's-eye high tier, bokehPass.enabled must be true again",
  );
}

console.log(
  "city-composer ok: ember curve peaks at dusk, DOF ramps 0→1 on pitch [0.55..0.85], " +
  "tier ladder is sleep/low → medium(bloom+ssao+godrays) → high(bloom+ssao+godrays+dof), " +
  "bokeh depth pre-pass skips when dofStrengthForPitch(pitch01) === 0.",
);
