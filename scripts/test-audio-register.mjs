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

const { registerGlideTargets, NEUTRAL_LFO_HZ } = loadTsModule(
  "src/lib/audio-register.ts",
);
const { spectralRegisterFor, SCALE_MIN, SCALE_MAX } = loadTsModule(
  "src/lib/scale.ts",
);

// — Zooming out must darken and slow the bed, monotonically —
// A sign flip anywhere in the register→targets mapping (or in
// spectralRegisterFor's u) would make the manifold brighten toward the
// cosmos; walk the whole axis and require the glissando points one way.
{
  let prev = null;
  for (let s = SCALE_MIN; s <= SCALE_MAX + 1e-9; s += 0.5) {
    const t = registerGlideTargets(spectralRegisterFor(s));
    if (prev) {
      assert.ok(t.cutoffHz <= prev.cutoffHz + 1e-9, `cutoff rose at s=${s}`);
      assert.ok(t.breathHz <= prev.breathHz + 1e-9, `breath sped up at s=${s}`);
      assert.ok(t.shelfDb <= prev.shelfDb + 1e-9, `shelf opened at s=${s}`);
      assert.ok(t.rateScale <= prev.rateScale + 1e-9, `swells sped up at s=${s}`);
    }
    prev = t;
  }
  // and the span must be a real glissando, not a plateau
  const atomic = registerGlideTargets(spectralRegisterFor(SCALE_MIN));
  const cosmic = registerGlideTargets(spectralRegisterFor(SCALE_MAX));
  assert.ok(atomic.cutoffHz / cosmic.cutoffHz > 8, "register span too flat");
}

// — The coast is neutral: swells run near their authored rates there —
// Catches NEUTRAL_LFO_HZ drifting out of sync with spectralRegisterFor
// (e.g. someone retunes scale.ts and forgets the audio side).
{
  const coast = registerGlideTargets(spectralRegisterFor(2.5));
  assert.ok(
    coast.rateScale > 0.85 && coast.rateScale < 1.15,
    `coast rateScale ${coast.rateScale} — human scale should breathe at ~1x`,
  );
  assert.ok(NEUTRAL_LFO_HZ > 0, "neutral rate must be positive");
}

// — Clamps hold under absurd registers (loudness/harshness discipline) —
// If the clamps vanish, a bad s could ask the bed for a supersonic cutoff,
// a frozen breath, or 100x swell rates.
{
  const wild = [
    { baseHz: 1e9, lfoHz: 1e6, brightness: 42 },
    { baseHz: 0, lfoHz: 0, brightness: -3 },
    { baseHz: -50, lfoHz: -1, brightness: 0.5 },
  ];
  for (const reg of wild) {
    const t = registerGlideTargets(reg);
    assert.ok(t.cutoffHz >= 150 && t.cutoffHz <= 12000, "cutoff escaped clamp");
    assert.ok(t.breathHz >= 0.005 && t.breathHz <= 1.6, "breath escaped clamp");
    assert.ok(t.rateScale >= 0.25 && t.rateScale <= 4, "rateScale escaped clamp");
    assert.ok(t.shelfDb <= 0 && t.shelfDb >= -16, "shelf must only ever cut");
    assert.ok(Number.isFinite(t.breathDepthHz), "breath depth must be finite");
  }
}

console.log("audio-register: register glide targets OK");
