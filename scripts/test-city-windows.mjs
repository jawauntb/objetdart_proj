import assert from "node:assert/strict";
import { loadTsModule } from "./lib/load-ts.mjs";

// Pin the dusk-and-lit-windows moment. This is the settlement's emotional
// peak — the brief calls the warm tungsten glow one-by-one against the
// cool blue evening the whole point — and every future refactor of
// city-windows.ts must survive this ladder. If a change lowers the dusk
// peak, or lets a lit window bleed into noon, or drops the midnight
// afterglow to zero, this file fires before it lands.
//
// The ladder the brief pins:
//   dawn     (0)    → ~0
//   noon     (0.25) → ~0
//   dusk     (0.5)  → ~0.7   (emotional peak)
//   midnight (0.75) → ~0.4   (a scattering of restless lamps)
//   pre-dawn (~1)   → ~0     (closes the loop)

const mod = loadTsModule("src/lib/city-windows.ts");
const {
  baselineLitFractionForDay,
  litFractionForDay,
  windowIsLit,
} = mod;

// ── the pinned four hours ────────────────────────────────────────────────
//
// The tolerance is intentional. The curve doesn't need to land on the exact
// numbers — it needs to walk the ladder. A ±0.15 window at each cardinal
// point is loose enough that a small palette tuning does not fire the test,
// tight enough that a wrong-shape curve (a sinusoid, a linear ramp) does.

const dawn = baselineLitFractionForDay(0);
const noon = baselineLitFractionForDay(0.25);
const dusk = baselineLitFractionForDay(0.5);
const midnight = baselineLitFractionForDay(0.75);

assert.ok(
  dawn < 0.05,
  `dawn (${dawn.toFixed(3)}) must be effectively unlit — the sky is enough at first light`,
);
assert.ok(
  noon < 0.05,
  `noon (${noon.toFixed(3)}) must be effectively unlit — a lit window vanishes against a bright sky`,
);
assert.ok(
  dusk > 0.55 && dusk < 0.85,
  `dusk (${dusk.toFixed(3)}) must land near 0.7 — this is the emotional peak, the whole block warm`,
);
assert.ok(
  midnight > 0.25 && midnight < 0.55,
  `midnight (${midnight.toFixed(3)}) must land near 0.4 — a scattering stays lit, the block is asleep but alive`,
);

// The loop closes: pre-dawn approaches dawn as f → 1.
const preDawn = baselineLitFractionForDay(0.99);
assert.ok(
  preDawn < 0.1,
  `pre-dawn (${preDawn.toFixed(3)}) must return to the dark end — the day's loop is a loop, not a spiral`,
);

// ── shape: dusk is the maximum ───────────────────────────────────────────
//
// The peak of the curve must sit in the evening window, not at noon or
// midnight. Scan the whole day at fine resolution and check that the
// argmax sits between 0.45 and 0.65 (the "dusk" band as the brief means
// it, wide enough for artistic taste).

let peakHour = 0;
let peakValue = -1;
for (let i = 0; i < 200; i += 1) {
  const f = i / 200;
  const v = baselineLitFractionForDay(f);
  if (v > peakValue) {
    peakValue = v;
    peakHour = f;
  }
}
assert.ok(
  peakHour > 0.45 && peakHour < 0.65,
  `the curve's peak must sit at dusk, not noon or midnight — peak was ${peakHour.toFixed(3)} (${peakValue.toFixed(3)})`,
);

// The rise into dusk is monotone — no dips through the evening lift.
for (let i = 30; i < Math.round(peakHour * 200); i += 1) {
  const a = baselineLitFractionForDay(i / 200);
  const b = baselineLitFractionForDay((i + 1) / 200);
  assert.ok(
    b + 1e-6 >= a,
    `the evening lift is monotone — window ${(i / 200).toFixed(3)} → ${((i + 1) / 200).toFixed(3)} dropped`,
  );
}

// ── seed variance: 48 plots, 48 individual schedules ─────────────────────
//
// The whole reason the seed exists is so a row of homes reads as forty-
// eight separate homes, not one atlas stamped forty-eight times. The test
// samples a big set of seeds at dusk and checks:
//   - they don't collapse to one value (there IS variance)
//   - they don't blow past the [0, 1] envelope (the amplitude dial is safe)
//   - the mean sits near the baseline (the ensemble is honest to the hour)

const duskSamples = [];
for (let s = 1; s <= 200; s += 1) {
  const v = litFractionForDay(0.5, s);
  assert.ok(v >= 0 && v <= 1, `lit fraction must stay in [0,1] — got ${v} at seed ${s}`);
  duskSamples.push(v);
}
const min = Math.min(...duskSamples);
const max = Math.max(...duskSamples);
assert.ok(
  max - min > 0.15,
  `seeds at dusk must vary — a row of homes reads as many, not one (spread ${(max - min).toFixed(3)})`,
);
const mean = duskSamples.reduce((a, b) => a + b, 0) / duskSamples.length;
assert.ok(
  Math.abs(mean - dusk) < 0.12,
  `the ensemble mean at dusk (${mean.toFixed(3)}) must be honest to the block's dusk baseline (${dusk.toFixed(3)})`,
);

// A single seed is stable — same input, same output, no wall-clock creep.
assert.equal(
  litFractionForDay(0.5, 42), litFractionForDay(0.5, 42),
  "the curve is a pure function — one seed at one hour always reads the same",
);

// Two different seeds are (with high probability) different plots.
assert.notEqual(
  litFractionForDay(0.5, 7), litFractionForDay(0.5, 8),
  "different seeds produce different schedules — the settlement is not one atlas",
);

// ── windowIsLit: the per-cell gate ───────────────────────────────────────
//
// The mechanism that makes windows read as "one by one" instead of "all
// at once" is a stable per-cell hash compared against the plot's lit
// fraction. As the fraction rises, more cells flip on; as it falls, more
// flip off. The test pins:
//   - a bright fraction (1) lights every window
//   - a dark fraction (0) lights none
//   - the same (plot, row, col) at the same fraction is stable
//   - the count grows monotonically with the fraction (no flicker)

for (let r = 0; r < 4; r += 1) {
  for (let c = 0; c < 6; c += 1) {
    assert.equal(
      windowIsLit(1, 12345, r, c), true,
      `at full lit fraction every window must be on — the block is fully awake`,
    );
    assert.equal(
      windowIsLit(0, 12345, r, c), false,
      `at zero lit fraction no window is on — the block is asleep`,
    );
  }
}

// Stability: the same input reads the same twice.
assert.equal(
  windowIsLit(0.5, 999, 2, 3), windowIsLit(0.5, 999, 2, 3),
  "the per-cell gate is a pure function — a window does not flicker frame-to-frame",
);

// Monotonicity: for one plot, the count of lit windows in a 6×8 grid is
// non-decreasing as the lit fraction rises from 0 to 1.
function countLit(seed, f) {
  let n = 0;
  for (let r = 0; r < 6; r += 1) for (let c = 0; c < 8; c += 1) {
    if (windowIsLit(f, seed, r, c)) n += 1;
  }
  return n;
}
let prev = -1;
for (let i = 0; i <= 20; i += 1) {
  const f = i / 20;
  const n = countLit(0xC17A, f);
  assert.ok(n >= prev, `window count must not flicker down as the hour brightens — f=${f} n=${n} prev=${prev}`);
  prev = n;
}

// And the ends: 0 lights nothing, 1 lights everything (48 cells).
assert.equal(countLit(0xC17A, 0), 0, "no lit windows at zero fraction");
assert.equal(countLit(0xC17A, 1), 48, "every window lit at full fraction");

console.log(
  `city-windows ok: dawn ${dawn.toFixed(3)} → noon ${noon.toFixed(3)} → dusk ${dusk.toFixed(3)} → midnight ${midnight.toFixed(3)}, ` +
  `peak at hour ${peakHour.toFixed(3)}, ` +
  `seeds spread ${(max - min).toFixed(3)} at dusk with mean ${mean.toFixed(3)}, ` +
  `per-cell gate is monotone through the evening lift — the dusk moment is pinned.`,
);
