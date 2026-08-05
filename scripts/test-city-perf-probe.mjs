#!/usr/bin/env node
/**
 * test-city-perf-probe — the shape contract for the __cityPerf ring
 * buffers the composer + water perf probes populate.
 *
 * Target D — "composer.render() budget under 8ms at high tier on an M1
 * baseline" — was previously unmeasurable: `composer.render()` did not
 * time itself, `water.onBeforeRender` did not report its mirror render,
 * and City.tsx exposed only firstPaintMs. Every subsequent perf PR that
 * claimed a composer-side win had to argue from `frame_ms` alone —
 * which is the aggregate, so any mirror or scene change could hide a
 * composer regression.
 *
 * This PR installed:
 *   1. `createPerfRing(capacity)` in src/lib/city-composer.ts — a pure
 *      rolling-window ring with avg / p50 / p95 / max snapshot semantics.
 *   2. `CityComposerOptions.perfProbe` — the composer wraps its
 *      internal `composer.render()` call and forwards a wall-clock
 *      composerMs delta.
 *   3. `CityWaterOptions.perfProbe` — the water wraps its mirror-into-RT
 *      render inside onBeforeRender and forwards a wall-clock mirrorMs
 *      delta.
 *   4. `window.__cityPerf.snapshot()` in src/components/City.tsx —
 *      returns { frame_ms, composer_ms, scene_ms, mirror_ms, draw_calls,
 *      triangles }, each a rolling-window aggregate. Gated on ?__perf=1,
 *      exactly like the pre-existing firstPaintMs probe.
 *
 * This test pins the ring aggregation semantics (pure JS, in Node) and
 * the shape of the two probe types + the __cityPerf snapshot surface.
 * A regression that changed how p95 is indexed, or dropped a metric key
 * from the snapshot, or moved the probe wiring off the ?__perf=1 gate,
 * fails one of the asserts below.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTsModule } from "./lib/load-ts.mjs";

const errors = [];
function ok(cond, msg) { if (!cond) errors.push(msg); }

// ── 1. createPerfRing — pure JS aggregation ──────────────────────────────
// Load city-composer.ts with the same stub matrix test-city-composer.mjs
// uses. The perf-ring factory is a pure JS export — no THREE, no DOM —
// so the stubs never need to model any render behaviour for this test.
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
  Vector2: class { constructor(x = 0, y = 0) { this.x = x; this.y = y; } set(x, y) { this.x = x; this.y = y; } },
  Vector3: class {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; }
    clone() { return new threeStub.Vector3(this.x, this.y, this.z); }
    project() { return this; }
  },
  Matrix4: class {
    constructor() { this.elements = new Array(16).fill(0); }
    copy(o) { for (let i = 0; i < 16; i += 1) this.elements[i] = o.elements[i]; return this; }
  },
  WebGLRenderTarget: class { constructor() {} dispose() {} },
};
const composerStubModule = { EffectComposer: stubClass };
const renderPassStub = { RenderPass: stubClass };
const bloomStub = { UnrealBloomPass: class { constructor() { this.enabled = true; } setSize() {} dispose() {} } };
const ssaoStub = { SSAOPass: class { constructor() { this.enabled = true; } setSize() {} dispose() {} } };
const bokehStub = {
  BokehPass: class {
    constructor() { this.enabled = true; this.uniforms = { maxblur: { value: 0 }, aperture: { value: 0 } }; }
    setSize() {} dispose() {}
  },
};
const outputStub = { OutputPass: stubClass };
const shaderPassStub = {
  ShaderPass: class {
    constructor(shader) {
      this.enabled = true;
      const src = shader && shader.uniforms ? shader.uniforms : {};
      this.uniforms = {};
      for (const k of Object.keys(src)) this.uniforms[k] = { value: src[k] ? src[k].value : null };
    }
    setSize() {} dispose() {}
  },
};
const runtimeStub = {};

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
const { createPerfRing } = mod;
ok(typeof createPerfRing === "function",
  "createPerfRing must be exported from src/lib/city-composer.ts");

// Empty ring snapshot returns zeros — never NaN, never undefined. A
// harness polling before the first frame must see a stable shape.
{
  const r = createPerfRing(4);
  const s = r.snapshot();
  assert.equal(s.count, 0, "empty ring count is 0");
  assert.equal(s.avg, 0, "empty ring avg is 0");
  assert.equal(s.p50, 0, "empty ring p50 is 0");
  assert.equal(s.p95, 0, "empty ring p95 is 0");
  assert.equal(s.max, 0, "empty ring max is 0");
  assert.equal(r.size(), 0, "size() reports 0 on an empty ring");
  assert.equal(r.capacity(), 4, "capacity() reports the requested size");
}

// A single sample lands in every aggregate — p50, p95, max, avg all
// equal it. If a future refactor breaks the nearest-rank quantile at
// n=1 the ring would return 0 for p95 while count=1, and every
// subsequent PR's p95 number would silently be wrong.
{
  const r = createPerfRing(120);
  r.push(7.5);
  const s = r.snapshot();
  assert.equal(s.count, 1, "single push moves count to 1");
  assert.equal(s.avg, 7.5, "single-sample avg is the sample");
  assert.equal(s.p50, 7.5, "single-sample p50 is the sample");
  assert.equal(s.p95, 7.5, "single-sample p95 is the sample");
  assert.equal(s.max, 7.5, "single-sample max is the sample");
}

// NaN/Infinity are dropped silently so one bad sample cannot poison
// the window. This is important because a probe error branch could
// hand the ring a negative-delta or NaN clock read.
{
  const r = createPerfRing(4);
  r.push(1);
  r.push(NaN);
  r.push(Infinity);
  r.push(-Infinity);
  r.push(2);
  assert.equal(r.size(), 2, "NaN/Infinity pushes are dropped; only 1 and 2 survived");
  const s = r.snapshot();
  assert.equal(s.avg, 1.5, "avg over {1, 2} is 1.5");
  assert.equal(s.max, 2, "max over {1, 2} is 2");
}

// Rolling window: pushing past capacity evicts the oldest. A 120-frame
// window is the whole point — a regression that let the ring keep
// growing would report averages over the wrong horizon and every "avg
// composer_ms" number in a PR body would drift.
{
  const cap = 4;
  const r = createPerfRing(cap);
  r.push(1);
  r.push(2);
  r.push(3);
  r.push(4);
  assert.equal(r.size(), 4, "ring holds its capacity of 4");
  r.push(5);
  assert.equal(r.size(), 4, "push past capacity keeps size at 4 (rolling window)");
  const s = r.snapshot();
  // The window now holds {2,3,4,5}. Avg = 3.5, max = 5.
  assert.equal(s.avg, 3.5, "rolling avg over {2,3,4,5} is 3.5");
  assert.equal(s.max, 5, "rolling max over {2,3,4,5} is 5");
}

// p95 on a 120-sample window: values 1..120, sorted, index floor(0.95*120)=114
// → value 115 (values are 1-indexed but the array is 0-indexed).
{
  const r = createPerfRing(120);
  for (let i = 1; i <= 120; i += 1) r.push(i);
  const s = r.snapshot();
  assert.equal(s.count, 120, "120 samples fit the capacity-120 ring");
  assert.equal(s.max, 120, "max over 1..120 is 120");
  assert.equal(s.p50, 61, "p50 over 1..120 is 61 (index 60 = the 61st value)");
  assert.equal(s.p95, 115, "p95 over 1..120 is 115 (index 114 = the 115th value)");
  // Avg of 1..120 = 60.5
  assert.equal(s.avg, 60.5, "avg over 1..120 is 60.5");
}

// Capacity clamps: negative/zero clamps to 1; huge clamps to 4096. The
// clamp exists so a devtools poke with `createPerfRing(0)` doesn't
// divide by zero on the first snapshot.
{
  const r0 = createPerfRing(0);
  assert.equal(r0.capacity(), 1, "capacity clamps up from 0 to 1");
  const rHuge = createPerfRing(1e9);
  assert.equal(rHuge.capacity(), 4096, "capacity clamps down to 4096 for huge requests");
}

// ── 2. CityComposerOptions.perfProbe — type + option surface ─────────────
// Grep the source: the composer's options type must include a perfProbe
// field, and the render() body must reference it AND wrap the internal
// composer.render() call with a performance.now() delta.
{
  const src = readFileSync("src/lib/city-composer.ts", "utf8");
  ok(/perfProbe\??:\s*CityComposerPerfProbe/.test(src),
    "CityComposerOptions must declare perfProbe?: CityComposerPerfProbe");
  ok(/onComposerFrame\s*\(/.test(src),
    "CityComposerPerfProbe must declare onComposerFrame(composerMs)");
  ok(/performance\.now\(\)/.test(src) && /composerLike\.render\(\)/.test(src),
    "composer render() must measure performance.now() around composerLike.render()");
  ok(/opts\.perfProbe/.test(src),
    "composer render() must read opts.perfProbe on the hot path");
}

// ── 3. CityWaterOptions.perfProbe — type + option surface ───────────────
// Same shape check for the water module. The mirror render inside
// onBeforeRender must be wrapped with a performance.now() delta and
// forwarded to probe.onMirrorFrame.
{
  const src = readFileSync("src/lib/city-water.ts", "utf8");
  ok(/perfProbe\??:\s*CityWaterPerfProbe/.test(src),
    "CityWaterOptions must declare perfProbe?: CityWaterPerfProbe");
  ok(/onMirrorFrame\s*\(/.test(src),
    "CityWaterPerfProbe must declare onMirrorFrame(mirrorMs)");
  ok(/renderer\.render\s*\(\s*skylineSceneForMirror/.test(src),
    "water must render skylineSceneForMirror into reflectionRT (the timed call)");
  ok(/opts\.perfProbe/.test(src),
    "water onBeforeRender must read opts.perfProbe on the hot path");
}

// ── 4. City.tsx wiring — probe on ?__perf=1, snapshot() surface ─────────
// The room must build the rings BEFORE water/composer (so the probes
// hand into them), wire both probes, expose __cityPerf.snapshot()
// returning the six metrics, and tear the whole thing down on unmount.
{
  const src = readFileSync("src/components/City.tsx", "utf8");

  ok(src.includes("createPerfRing"),
    "City.tsx must import createPerfRing to build the ring buffers");

  // The perf-probe closures reference each ring by name — a metric key
  // going missing from this list is the same as removing the metric.
  for (const key of ["composer_ms", "scene_ms", "frame_ms", "mirror_ms", "draw_calls", "triangles"]) {
    ok(src.includes(key),
      `City.tsx must push into the ${key} ring — otherwise the metric never lands`);
  }

  // Both probe factories are wired into their modules. A regression
  // that dropped the perfProbe option on either factory would silently
  // stop that side of the measurement.
  ok(/createCityComposer\s*\(\s*\{[\s\S]*?perfProbe:\s*composerProbe/.test(src),
    "City.tsx must hand perfProbe: composerProbe to createCityComposer");
  ok(/createCityWater\s*\(\s*\{[\s\S]*?perfProbe:\s*waterProbe/.test(src),
    "City.tsx must hand perfProbe: waterProbe to createCityWater");

  // The snapshot() surface reports every ring. The harness reads this
  // in a single evaluate() — a missing key would be an undefined in a
  // PR body's measured_delta.
  const snapIdx = src.indexOf("snapshot: () => ({");
  ok(snapIdx !== -1, "City.tsx must define __cityPerf.snapshot() returning the six rings");
  if (snapIdx !== -1) {
    const snapBlock = src.slice(snapIdx, snapIdx + 400);
    for (const key of ["frame_ms", "composer_ms", "scene_ms", "mirror_ms", "draw_calls", "triangles"]) {
      ok(snapBlock.includes(key),
        `__cityPerf.snapshot() must return the ${key} key`);
    }
  }

  // renderer.info.autoReset — the probe flips this off inside the tick
  // so info.render.calls accumulates across the composer's internal
  // renderer.render() chain, then resets it on unmount. Without both
  // ends of that dance the draw_calls number would report only the
  // LAST pass's count.
  ok(/renderer\.info\.autoReset\s*=\s*false/.test(src),
    "City.tsx must flip renderer.info.autoReset off when the probe is on");
  ok(/renderer\.info\.autoReset\s*=\s*true/.test(src),
    "City.tsx must restore renderer.info.autoReset to true on unmount");
  ok(/renderer\.info\.reset\(\)/.test(src),
    "City.tsx must call renderer.info.reset() to clear counters at frame start");

  // The probe gate stays on ?__perf=1 — a production visitor cannot
  // see the ring buffers, and the pre-existing firstPaintMs gate is
  // unaffected. Both perfRings and perfEnabled read the same query
  // flag; the room mounts them together.
  ok(/__perf/.test(src) && /URLSearchParams/.test(src),
    "City.tsx must gate the perf probe on ?__perf=1 via URLSearchParams");
}

// ── 5. package.json — npm scripts and aggregate `test` ──────────────────
{
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  ok(typeof pkg.scripts["test:city-perf-probe"] === "string" &&
     pkg.scripts["test:city-perf-probe"].includes("scripts/test-city-perf-probe.mjs"),
    "package.json must expose test:city-perf-probe pointing at this file");
  ok(pkg.scripts.test.includes("test:city-perf-probe"),
    "aggregate npm test must include test:city-perf-probe");
}

if (errors.length) {
  for (const e of errors) process.stderr.write(`[test-city-perf-probe] FAIL: ${e}\n`);
  process.exit(1);
}
console.log("test-city-perf-probe ok: ring aggregates hold, probes wired, snapshot exposes six metrics.");
