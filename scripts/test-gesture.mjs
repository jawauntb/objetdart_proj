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
  THRESHOLDS,
  holdTier,
  intensityFrom,
  decomposeTwoPointer,
  pathWinding,
  classifyRelease,
  tapTrain,
  rhythmFrom,
  shakeIntensity,
  drumAlternation,
} = loadTsModule("src/lib/gesture/core.ts");

// — Hold tiers: touch → dwell → ceremony —
assert.equal(holdTier(100), 0);
assert.equal(holdTier(THRESHOLDS.tapMaxMs + 1), 1);
assert.equal(holdTier(THRESHOLDS.dwellMs), 2);
assert.equal(holdTier(THRESHOLDS.ceremonyMs), 3);

// — Intensity: force > area > velocity > neutral 0.5 —
assert.equal(intensityFrom({ pressure: 0.9 }), 0.9, "real force wins");
const padded = intensityFrom({ pressure: 0.5, width: 36, height: 36 });
assert.ok(padded > 0.6, "0.5 pressure is the untrusted default; area used instead");
const tip = intensityFrom({ width: 10, height: 10 });
assert.ok(tip < padded, "fingertip lighter than flat pad");
assert.equal(intensityFrom({}), 0.5, "no signal reads neutral");

// — Two-finger decomposition: the orthogonal channels stay orthogonal —
const purePinch = decomposeTwoPointer(
  { x: -10, y: 0 }, { x: 10, y: 0 },
  { x: -20, y: 0 }, { x: 20, y: 0 },
);
assert.ok(Math.abs(purePinch.scale - 2) < 1e-9, "spread doubles distance");
assert.ok(Math.abs(purePinch.rotate) < 1e-9, "pure pinch does not rotate");
assert.ok(Math.abs(purePinch.dx) < 1e-9 && Math.abs(purePinch.dy) < 1e-9, "pure pinch does not pan");

const pureTwist = decomposeTwoPointer(
  { x: -10, y: 0 }, { x: 10, y: 0 },
  { x: 0, y: -10 }, { x: 0, y: 10 },
);
assert.ok(Math.abs(Math.abs(pureTwist.rotate) - Math.PI / 2) < 1e-9, "quarter turn detected");
assert.ok(Math.abs(pureTwist.scale - 1) < 1e-9, "pure twist does not scale");

const purePan = decomposeTwoPointer(
  { x: 0, y: 0 }, { x: 20, y: 0 },
  { x: 5, y: 7 }, { x: 25, y: 7 },
);
assert.equal(purePan.dx, 5);
assert.equal(purePan.dy, 7);
assert.ok(Math.abs(purePan.scale - 1) < 1e-9 && Math.abs(purePan.rotate) < 1e-9);

// — Winding: a drawn circle is one turn; a line is none —
const circle = [];
for (let i = 0; i <= 32; i++) {
  const a = (i / 32) * 2 * Math.PI;
  circle.push({ x: 100 + 40 * Math.cos(a), y: 100 + 40 * Math.sin(a) });
}
const w = pathWinding(circle);
assert.ok(Math.abs(Math.abs(w) - 1) < 0.08, `full circle ≈ one turn (got ${w})`);
const line = Array.from({ length: 20 }, (_, i) => ({ x: i * 10, y: 5 }));
assert.ok(Math.abs(pathWinding(line)) < 0.3, "a stroke is not a scrub");

// — Release classification —
assert.equal(classifyRelease(120, 3, 0.1), "tap");
assert.equal(classifyRelease(1200, 3, 0.0), "hold-release");
assert.equal(classifyRelease(300, 80, 1.2), "flick");
assert.equal(classifyRelease(600, 80, 0.1), "drag-end");

// — Tap trains cap at 3 and reset outside the window —
assert.equal(tapTrain(1, 1000, 1000 + THRESHOLDS.tapTrainMs), 2);
assert.equal(tapTrain(2, 1000, 1200), 3);
assert.equal(tapTrain(3, 1000, 1200), 3, "caps at triple");
assert.equal(tapTrain(2, 1000, 1000 + THRESHOLDS.tapTrainMs + 1), 1, "window resets");

// — Rhythm: a steady 120bpm train is heard as one —
const steady = [0, 500, 1000, 1500, 2000];
const r = rhythmFrom(steady);
assert.ok(Math.abs(r.bpm - 120) < 1, `120bpm (got ${r.bpm})`);
assert.ok(r.stability > 0.95, "metronomic taps are stable");
const ragged = rhythmFrom([0, 210, 700, 820, 1900]);
assert.ok(!ragged || ragged.stability < 0.6, "ragged taps are unstable");
assert.equal(rhythmFrom([0, 500]), null, "too few taps is not a rhythm");

// — Shake: sustained agitation registers, a single bump does not —
const now = 10000;
const quiet = Array.from({ length: 20 }, (_, i) => ({ x: 0.3, y: 0.2, z: 0.1, t: now - i * 30 }));
assert.equal(shakeIntensity(quiet, now), 0, "stillness is silent");
const violent = Array.from({ length: 20 }, (_, i) => ({
  x: 18 * (i % 2 ? 1 : -1), y: 14, z: 6, t: now - i * 30,
}));
assert.ok(shakeIntensity(violent, now) > 0.3, "a real shake registers");
const oneBump = [...quiet.slice(0, 18), { x: 30, y: 0, z: 0, t: now - 10 }];
assert.equal(shakeIntensity(oneBump, now), 0, "one pothole is not a shake");

// — Drumming —
assert.equal(drumAlternation([{ zone: 0 }, { zone: 1 }, { zone: 0 }, { zone: 1 }]), 1, "strict patter");
assert.equal(drumAlternation([{ zone: 0 }, { zone: 0 }, { zone: 0 }]), 0, "one finger is not a drum");

console.log("gesture grammar tests passed");
