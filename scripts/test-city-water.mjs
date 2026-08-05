import assert from "node:assert/strict";
import { loadTsModule } from "./lib/load-ts.mjs";

// city-water.ts imports THREE and Reflector at the module top; those
// classes only exist meaningfully inside a WebGL context, so we shim them
// to opaque placeholders. The pure helpers this test pins never touch
// three's runtime — they are string/number/array math — and everything
// else in the module lives behind createCityWater(), which we do not
// call here.
const threeShim = new Proxy(
  {},
  {
    get() {
      return function stub() {
        return {};
      };
    },
  },
);
const reflectorShim = { Reflector: function () { return {}; } };

const mod = loadTsModule("src/lib/city-water.ts", {
  requireMap: {
    three: threeShim,
    "three/examples/jsm/objects/Reflector.js": reflectorShim,
  },
});

const {
  WATER_PROXY_COUNT,
  WAVE_SCROLL_RATE,
  waveScrollFor,
  skyTintForDay,
  proxyHeightFor,
} = mod;

// ——— constants are what the brief pins ————————————————————————————————————

assert.equal(WAVE_SCROLL_RATE, 0.02, "brief pins the wave scroll at ~0.02 uv/s");
// WATER_PROXY_COUNT is retained after R6-C as a legacy constant — the
// reflector no longer instantiates proxy boxes when a real skylineScene is
// provided, but the pure helper `proxyHeightFor` and its ladder are still
// exported and testable, and the constant keeps sizing math stable for
// any future caller that runs on the fallback path.
assert.equal(WATER_PROXY_COUNT, 16, "16 reflectable proxies for 48 plots is honest coverage");

// ——— waveScrollFor: monotone, wraps at 1, tolerates junk ——————————————————

assert.equal(waveScrollFor(0, 0), 0, "zero dt from zero is zero");
const one = waveScrollFor(1000, 0);
assert.ok(one > 0 && one < 1, "one second at 0.02 uv/s advances but stays under 1");
assert.ok(
  Math.abs(one - 0.02) < 1e-9,
  "one second at WAVE_SCROLL_RATE advances by exactly the rate",
);
assert.ok(
  waveScrollFor(16, 0) < waveScrollFor(16, waveScrollFor(16, 0)),
  "the scroll is monotone: two frames advance further than one",
);
// Wrap around 1 so float precision holds indefinitely
assert.ok(
  waveScrollFor(1_000_000, 0.99) < 1,
  "a huge dt still wraps below 1 — precision holds",
);
// Nonsense inputs: don't crash, don't corrupt state
assert.equal(waveScrollFor(NaN, 0.3), 0.3, "NaN dt is ignored, previous state preserved");
assert.equal(waveScrollFor(Infinity, 0.3), 0.3, "Infinity dt is ignored");
assert.equal(waveScrollFor(-100, 0.3), 0.3, "negative dt is clamped to zero (no rewind)");

// ——— skyTintForDay: the four cardinal points ——————————————————————————————

const dawn = skyTintForDay(0);
const noon = skyTintForDay(0.25);
const dusk = skyTintForDay(0.5);
const night = skyTintForDay(0.75);

for (const [name, rgb] of [
  ["dawn", dawn],
  ["noon", noon],
  ["dusk", dusk],
  ["night", night],
]) {
  assert.equal(rgb.length, 3, `${name} has three channels`);
  for (const c of rgb) {
    assert.ok(Number.isFinite(c) && c >= 0 && c <= 1, `${name} channel in 0..1`);
  }
}

// Emotional peaks the brief calls out
assert.ok(dusk[0] > noon[0] && dusk[0] > dawn[0], "dusk is the reddest hour");
assert.ok(night[2] > night[0], "night sky leans blue, not warm");
assert.ok(noon[2] > noon[0], "noon sky is bluer than it is red");
assert.ok(dawn[0] > dawn[2] * 0.9, "dawn is warmish, not blue");

// Cycle wraps: 1.0 is the same as 0.0
const wrap = skyTintForDay(1);
for (let i = 0; i < 3; i += 1) {
  assert.ok(Math.abs(wrap[i] - dawn[i]) < 1e-9, `channel ${i} wraps continuously at 1.0`);
}
// Negative fractions also normalize
const negWrap = skyTintForDay(-0.5);
for (let i = 0; i < 3; i += 1) {
  assert.ok(Math.abs(negWrap[i] - dusk[i]) < 1e-9, `channel ${i} handles negative input`);
}

// Between anchors, linear-ish continuity (no jumps)
let prev = skyTintForDay(0);
for (let t = 0.01; t <= 1.0001; t += 0.01) {
  const cur = skyTintForDay(t);
  for (let i = 0; i < 3; i += 1) {
    assert.ok(
      Math.abs(cur[i] - prev[i]) < 0.05,
      `sky tint is continuous around t=${t.toFixed(2)}, channel ${i}`,
    );
  }
  prev = cur;
}

// ——— proxyHeightFor: role ladder, sealed boost, per-seed variation ————————

const homeUnsealed = proxyHeightFor("home", false, 1);
const homeSealed   = proxyHeightFor("home", true, 1);
const eventSealed  = proxyHeightFor("event", true, 1);
const storeSealed  = proxyHeightFor("store", true, 1);
const treeSealed   = proxyHeightFor("tree", true, 1);
const emptyAny     = proxyHeightFor("empty", true, 1);

assert.equal(emptyAny, 0.9 * 0.5 + 0 * (0.75 + 0), "empty picks up sealBoost only, no role");
// (empty is technically not called by the module — it filters empties out —
// but the function is still callable, and its answer is defined.)

// The ladder we care about
assert.ok(eventSealed > storeSealed, "a sealed event towers over a sealed store");
assert.ok(storeSealed > homeSealed, "a sealed store rises above a sealed home");
assert.ok(homeSealed > homeUnsealed, "sealing a home lifts it");
assert.ok(eventSealed > 2.0, "the tallest sealed event carries real height");

// Per-seed variation is not zero
const heights = new Set();
for (let seed = 0; seed < 32; seed += 1) {
  heights.add(proxyHeightFor("home", false, seed).toFixed(4));
}
assert.ok(heights.size > 4, `seeds jitter home heights (${heights.size} distinct in 32)`);

// Determinism — same inputs → same output
assert.equal(
  proxyHeightFor("event", true, 42),
  proxyHeightFor("event", true, 42),
  "proxyHeightFor is a pure function of (role, sealed, seed)",
);

// ——— R6-C: the module still exports its pure helpers even after the mirror
// switched from proxy boxes to rendering the real skylineScene ————————————

assert.equal(typeof mod.createCityWater, "function", "createCityWater is still exported");
assert.equal(typeof mod.waveScrollFor, "function", "waveScrollFor pure helper still exported");
assert.equal(typeof mod.skyTintForDay, "function", "skyTintForDay pure helper still exported");
assert.equal(typeof mod.proxyHeightFor, "function", "proxyHeightFor pure helper still exported (legacy)");

// The R6-C option shape: createCityWater now accepts an optional
// `skylineScene`. We can't instantiate it here (the three shim would
// throw on Reflector construction), but the signature accepting the
// option keyword is guaranteed by the TypeScript type-check in tsc.
// This assertion just documents the contract in JS-readable form.
assert.equal(
  mod.createCityWater.length,
  1,
  "createCityWater takes a single options object (including optional skylineScene)",
);

// ——— R10-5: SSR — replaces Reflector with a depth-buffer raymarch ————————
//
// The module no longer imports THREE.Reflector; check the source directly
// to lock the rewrite in place. If a future refactor accidentally brings
// Reflector back the test flags it — the whole point of R10-5 is the
// planar mirror is gone.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const waterSrc = readFileSync(
  resolve(__dirname, "..", "src", "lib", "city-water.ts"),
  "utf8",
);

assert.ok(
  !/from\s+["']three\/examples\/jsm\/objects\/Reflector\.js["']/.test(waterSrc),
  "R10-5: city-water no longer imports THREE.Reflector",
);
assert.ok(
  !/new Reflector\(/.test(waterSrc),
  "R10-5: city-water no longer instantiates Reflector",
);
assert.ok(
  /raymarchReflection/.test(waterSrc),
  "R10-5: shader contains a raymarchReflection function",
);
assert.ok(
  /tReflectionDepth/.test(waterSrc),
  "R10-5: shader samples a depth texture for the SSR march",
);
assert.ok(
  /DepthTexture\(/.test(waterSrc),
  "R10-5: mirror RT is backed by a real DepthTexture",
);
assert.ok(
  /textureCube\(uEnvMap/.test(waterSrc),
  "R10-5: fragment shader samples the cubemap fallback",
);
assert.ok(
  /Schlick|1\.0 - cosTheta.*5\.0|F0/.test(waterSrc),
  "R10-5: shader mixes reflection over body colour by a Fresnel",
);
assert.ok(
  /reflectMatrix/.test(waterSrc),
  "R10-5: module builds a plane-reflection matrix for the mirror camera",
);
assert.ok(
  /worldClipPlane|clippingPlanes/.test(waterSrc),
  "R10-5: mirror render clips below the water plane",
);
assert.ok(
  /setEnvMap/.test(waterSrc),
  "R10-5: cubemap can be swapped at runtime via setEnvMap",
);
assert.ok(
  /MARCH_STEPS_HIGH.*=\s*24|uMarchSteps/.test(waterSrc),
  "R10-5: SSR runs 24 march steps on high tier",
);
assert.ok(
  /MARCH_STEPS_MEDIUM.*=\s*16/.test(waterSrc),
  "R10-5: SSR runs a reduced 16 march steps on medium tier",
);

console.log("test-city-water: ok");
