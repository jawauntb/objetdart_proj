/**
 * perf-city-water — measures the mirror-refresh cadence of the water
 * idle-guard against the pre-guard baseline (render every frame). Runs
 * without a WebGL context: the pure kernel `mirrorRefreshDecision` is
 * exported from src/lib/city-water.ts, and this harness feeds it a
 * frame-by-frame invalidator sequence for four scenarios:
 *
 *   1. HIGH  tier, IDLE   — camera still, day static, no plot flip
 *   2. HIGH  tier, MOVING — camera moves every frame, day drifts
 *   3. MEDIUM tier, IDLE
 *   4. MEDIUM tier, MOVING
 *
 * The BEFORE numbers model the pre-guard behaviour (every frame renders
 * the RT); the AFTER numbers come from running the guard. Convert to a
 * frame-time and draw-call estimate using a nominal skyline draw count
 * (~75 draw calls per skyline pass, ~0.9ms at 60Hz on M1 baseline).
 *
 * Output is pure ASCII table on stdout. Not a test — a perf report.
 */

import { loadTsModule } from "./lib/load-ts.mjs";

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
const { mirrorRefreshDecision, mirrorDaySlot, mirrorPlotSig } = mod;

const FRAMES = 60; // one second at 60fps
const SKYLINE_DRAWS_PER_MIRROR = 75; // ~50–100 draw calls per mirror RT
const MIRROR_COST_MS = 3.0; // rough ms/frame the mirror RT eats on M1

function runScenario({ tier, moving, frames }) {
  // Local state mirrors the closure inside city-water.ts.
  let hasRendered = false;
  let renderedEpoch = -1;
  let sceneEpoch = 0;
  let camMoved = false;
  let lastDaySlot = -1;
  let lastPlotSig = 0;
  let plotSigInit = false;
  let frameCounter = 0;
  let renders = 0;
  let skips = 0;

  // A fixed plot list — 48 plots, evenly split roles, sealed toggle by index.
  const roles = ["home", "store", "event", "tree"];
  const plots = [];
  for (let i = 0; i < 48; i += 1) {
    plots.push({
      seed: i * 31,
      sealed: (i & 3) === 0,
      role: roles[i & 3],
      x: (i / 48),
      y: 0,
    });
  }

  const camStart = 0; // moving camera bumps sceneEpoch equivalent via camChanged
  let day = 0.5; // dusk — the emotional peak

  for (let f = 0; f < frames; f += 1) {
    // Advance state (this is what update() does).
    if (moving) {
      // In moving mode we advance day 1/1000 per frame — fewer than one
      // slot per 60 frames, so day-slot doesn't fire often. Camera moves
      // every frame, always invalidating.
      day = (day + 1 / 1000) % 1;
    }
    const slot = mirrorDaySlot(day);
    if (slot !== lastDaySlot) {
      sceneEpoch = (sceneEpoch + 1) | 0;
      lastDaySlot = slot;
    }
    const sig = mirrorPlotSig(plots);
    if (!plotSigInit || sig !== lastPlotSig) {
      if (plotSigInit) sceneEpoch = (sceneEpoch + 1) | 0;
      plotSigInit = true;
      lastPlotSig = sig;
    }
    frameCounter = (frameCounter + 1) | 0;

    // Simulate camera-moved detection.
    camMoved = moving;

    const outcome = mirrorRefreshDecision({
      hasRendered,
      camChanged: camMoved,
      epochChanged: renderedEpoch !== sceneEpoch,
      mediumFrameParity: (frameCounter & 1),
      tier,
    });
    if (outcome === "render") {
      renders += 1;
      hasRendered = true;
      renderedEpoch = sceneEpoch;
    } else {
      skips += 1;
    }
  }

  return { renders, skips };
}

function pct(n, d) {
  if (d === 0) return "0.0%";
  return `${((n / d) * 100).toFixed(1)}%`;
}

const scenarios = [
  { label: "high  · idle",   tier: "high",   moving: false },
  { label: "high  · moving", tier: "high",   moving: true },
  { label: "medium· idle",   tier: "medium", moving: false },
  { label: "medium· moving", tier: "medium", moving: true },
];

console.log("perf-city-water — mirror refresh cadence over 60 idle-window frames");
console.log("---------------------------------------------------------------------");
console.log(
  "scenario            | before (every-frame) | after (guard) | draw-calls/s saved | ms/s saved",
);
console.log(
  "--------------------+----------------------+---------------+--------------------+-----------",
);
for (const s of scenarios) {
  const before = { renders: FRAMES, skips: 0 };
  const after = runScenario({ tier: s.tier, moving: s.moving, frames: FRAMES });
  const dcSaved = (before.renders - after.renders) * SKYLINE_DRAWS_PER_MIRROR;
  const msSaved = (before.renders - after.renders) * MIRROR_COST_MS;
  const beforeStr = `${before.renders}/${FRAMES} (${pct(before.renders, FRAMES)})`;
  const afterStr = `${after.renders}/${FRAMES} (${pct(after.renders, FRAMES)})`;
  console.log(
    `${s.label.padEnd(20)}| ${beforeStr.padEnd(21)}| ${afterStr.padEnd(14)}| ${String(dcSaved).padEnd(19)}| ${msSaved.toFixed(1)}ms`,
  );
}
console.log("---------------------------------------------------------------------");
console.log("nominal skyline draw calls per mirror pass:", SKYLINE_DRAWS_PER_MIRROR);
console.log("nominal mirror RT cost per pass (ms):     ", MIRROR_COST_MS);
