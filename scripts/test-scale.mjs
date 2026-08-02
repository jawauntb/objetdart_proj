import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
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
  const sandbox = { module, exports: module.exports };
  vm.runInNewContext(code, sandbox, { filename });
  return module.exports;
}

const {
  SCALE_BANDS,
  SCALE_MIN,
  SCALE_MAX,
  TRAVEL_INTENT_MS,
  bandAt,
  bandBlend,
  initialScaleState,
  stepScale,
  spectralRegisterFor,
  entryScaleFor,
} = loadTsModule("src/lib/scale.ts");

// — Band registry is contiguous, ordered, and covers the whole axis —
for (let i = 1; i < SCALE_BANDS.length; i++) {
  assert.equal(
    SCALE_BANDS[i].sMin,
    SCALE_BANDS[i - 1].sMax,
    `bands contiguous at ${SCALE_BANDS[i].id}`,
  );
}
assert.equal(SCALE_BANDS[0].sMin, SCALE_MIN);
assert.equal(SCALE_BANDS[SCALE_BANDS.length - 1].sMax, SCALE_MAX);

// — bandAt respects half-open spans and clamps —
assert.equal(bandAt(-19).id, "quarks");
assert.equal(bandAt(-14).id, "atoms", "boundary belongs to the upper band");
assert.equal(bandAt(2).id, "coast");
assert.equal(bandAt(999).id, "manifold");
assert.equal(bandAt(-999).id, "quarks");

// — bandBlend: pure in the interior, symmetric crossfade near a wall —
const mid = bandBlend(2.5);
assert.equal(mid.t, 0, "band center has no secondary");
const nearWall = bandBlend(4.5 - 0.05);
assert.equal(nearWall.primary, "coast");
assert.equal(nearWall.secondary, "atlas");
assert.ok(nearWall.t > 0.35 && nearWall.t <= 0.5, `blend ramps toward 0.5 at wall (got ${nearWall.t})`);

// — Local zoom: a brief pinch cannot cross a band wall —
let st = initialScaleState(2.5);
let crossed = false;
for (let i = 0; i < 20; i++) {
  const r = stepScale(st, { zoomVel: 2.5, active: true }, 16);
  st = r.state;
  crossed ||= r.events.some((e) => e.type === "crossing");
}
// 20 frames ≈ 320ms of travel-speed pinch from band center: reaches the wall
// but must not break through without sustained intent *at* the wall.
assert.equal(crossed, false, "no accidental crossing on a short pinch");
assert.ok(st.s < 4.5, "s held inside the band");

// — A detent fires on first wall contact —
let detent = false;
let st2 = initialScaleState(4.4);
for (let i = 0; i < 15; i++) {
  const r = stepScale(st2, { zoomVel: 2.0, active: true }, 16);
  st2 = r.state;
  detent ||= r.events.some((e) => e.type === "detent");
}
assert.equal(detent, true, "wall contact emits detent");

// — Sustained push crosses, once, into the neighbor —
let st3 = initialScaleState(4.45);
const crossings = [];
for (let i = 0; i < 80; i++) {
  const r = stepScale(st3, { zoomVel: 2.0, active: true }, 16);
  st3 = r.state;
  for (const e of r.events) if (e.type === "crossing") crossings.push(e);
  if (crossings.length) break;
}
assert.equal(crossings.length, 1, "sustained push crosses");
assert.equal(crossings[0].from, "coast");
assert.equal(crossings[0].to, "atlas");
assert.ok(st3.s > 4.5, "landed inside the neighbor");

// — Releasing at the wall lets intent decay: no delayed crossing —
let st4 = initialScaleState(4.45);
for (let i = 0; i < 12; i++) st4 = stepScale(st4, { zoomVel: 2.0, active: true }, 16).state;
let lateCross = false;
for (let i = 0; i < 60; i++) {
  const r = stepScale(st4, { zoomVel: 0, active: false }, 16);
  st4 = r.state;
  lateCross ||= r.events.some((e) => e.type === "crossing");
}
assert.equal(lateCross, false, "letting go never crosses");
assert.equal(st4.intentMs, 0, "intent fully decays");

// — Spectral register: small is high and quick, large is low and slow —
const micro = spectralRegisterFor(SCALE_MIN);
const cosmic = spectralRegisterFor(SCALE_MAX);
assert.ok(micro.baseHz > cosmic.baseHz * 20, "pitch falls with scale");
assert.ok(micro.lfoHz > cosmic.lfoHz * 20, "breath slows with scale");
assert.ok(micro.brightness > cosmic.brightness, "shimmer fades with scale");
assert.ok(cosmic.baseHz >= 20 && micro.baseHz <= 8000, "registers stay audible");

// — Route entry points —
assert.equal(bandAt(entryScaleFor("/stars")).id, "stars");
assert.equal(bandAt(entryScaleFor("/tide")).id, "coast");
assert.equal(entryScaleFor("/colophon"), null);

console.log("scale manifold tests passed");
