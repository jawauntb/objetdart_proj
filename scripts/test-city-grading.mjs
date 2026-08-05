import assert from "node:assert/strict";
import { loadTsModule } from "./lib/load-ts.mjs";

/**
 * test-city-grading — the tone-mapping exposure ramp on dayFraction.
 *
 * `renderer.toneMappingExposure` used to be pinned at 1.05 for the whole
 * day. That single scalar was doing two opposite jobs: hold back the noon
 * sun disk before it clips the highlight roll-off AND lift the midnight
 * emissive windows above the ACES knee so bloom has warm mids to eat.
 * Neither job got done. The sky lost detail at noon; the dusk moment
 * had to be beat out of the bloom pass alone.
 *
 * `exposureForDay(dayFraction)` is the fix. This file pins the shape:
 *   noon     (0.25) → ~1.40   (hold the sky, protect highlights)
 *   horizon  (0.0)  → ~0.90   (dawn roll-over)
 *   dusk     (0.5)  → ~0.90   (the same roll-over the other way)
 *   midnight (0.75) → ~0.70   (lift the mids for bloom)
 *
 * A regression that flattened this curve back to a constant would kill
 * the emotional peak the brief calls the core of the room — the lit-
 * windows-glowing-from-inside moment — and fires here before it lands.
 */

const mod = loadTsModule("src/lib/city-grading.ts");
const { exposureForDay, EXPOSURE_NOON, EXPOSURE_HORIZON, EXPOSURE_MIDNIGHT } = mod;

// ── the four cardinal exposures ──────────────────────────────────────────
// A ±0.05 window at each point. Tight enough that a wrong-shape curve (a
// sinusoid, a linear ramp between two values, an inverted sign) fires;
// loose enough that a small palette tuning does not.

{
  const noon = exposureForDay(0.25);
  assert.ok(
    Math.abs(noon - 1.4) < 0.05,
    `noon exposure ~1.4 (protect the sky at highlight roll-off); got ${noon}`,
  );
  assert.equal(noon, EXPOSURE_NOON, "noon lands exactly on EXPOSURE_NOON constant");
}
{
  const dawn = exposureForDay(0.0);
  assert.ok(
    Math.abs(dawn - 0.9) < 0.05,
    `dawn exposure ~0.9 (horizon roll-over); got ${dawn}`,
  );
  assert.equal(dawn, EXPOSURE_HORIZON, "dawn lands exactly on EXPOSURE_HORIZON constant");
}
{
  const dusk = exposureForDay(0.5);
  assert.ok(
    Math.abs(dusk - 0.9) < 0.05,
    `dusk exposure ~0.9 (horizon roll-over, other side); got ${dusk}`,
  );
  assert.equal(dusk, EXPOSURE_HORIZON, "dusk lands exactly on EXPOSURE_HORIZON constant");
}
{
  const midnight = exposureForDay(0.75);
  assert.ok(
    Math.abs(midnight - 0.7) < 0.05,
    `midnight exposure ~0.7 (lift the mids for bloom); got ${midnight}`,
  );
  assert.equal(midnight, EXPOSURE_MIDNIGHT, "midnight lands exactly on EXPOSURE_MIDNIGHT constant");
}

// ── the shape ────────────────────────────────────────────────────────────
// Noon must be the highest point in the whole day. Midnight must be the
// lowest. The horizon crossings must sit strictly between them. If any of
// these inversions ever fires, the exposure knob is doing the wrong job
// for both the sky and the lit-window moment at once.

assert.ok(EXPOSURE_NOON > EXPOSURE_HORIZON, "noon > horizon");
assert.ok(EXPOSURE_HORIZON > EXPOSURE_MIDNIGHT, "horizon > midnight");
assert.ok(EXPOSURE_NOON > EXPOSURE_MIDNIGHT, "noon > midnight (the widest gap in the day)");

// The horizon crossings are symmetric — dawn and dusk both cross zero on
// the sun's altitude, and the tone-mapper must not care which side of noon
// it is on. A regression that broke that symmetry (a phase-shifted curve,
// a cos where a smoothstep should be) fires here.
assert.ok(
  Math.abs(exposureForDay(0.0) - exposureForDay(0.5)) < 1e-9,
  "dawn and dusk exposure are the same",
);
assert.ok(
  Math.abs(exposureForDay(0.1) - exposureForDay(0.4)) < 1e-9,
  "same distance from noon on either side matches",
);
assert.ok(
  Math.abs(exposureForDay(0.6) - exposureForDay(0.9)) < 1e-9,
  "same distance from midnight on either side matches",
);

// ── monotonicity walks ───────────────────────────────────────────────────
// Between noon and midnight the curve must never dip. A curve that
// oscillated (a sinusoid, a sawtooth) would still pass the four spot-
// checks in isolation. Sample twenty points on each half-day.

{
  // Noon → midnight: exposure must never rise.
  let prev = +Infinity;
  for (let i = 0; i <= 20; i += 1) {
    const df = 0.25 + (0.5 * i) / 20; // 0.25 → 0.75
    const e = exposureForDay(df);
    assert.ok(
      e <= prev + 1e-6,
      `exposure must be non-increasing from noon to midnight; df=${df} e=${e} prev=${prev}`,
    );
    prev = e;
  }
}
{
  // Midnight → next-day noon (through dawn): exposure must never fall.
  let prev = -Infinity;
  for (let i = 0; i <= 20; i += 1) {
    const df = 0.75 + (0.5 * i) / 20; // 0.75 → 1.25 (wraps to 0.25)
    const e = exposureForDay(df);
    assert.ok(
      e >= prev - 1e-6,
      `exposure must be non-decreasing from midnight to next-day noon; df=${df} e=${e} prev=${prev}`,
    );
    prev = e;
  }
}

// ── wrapping and defensive inputs ────────────────────────────────────────
// The day clock is a wrapping 0..1 quantity, and it must survive the
// noon-of-tomorrow, the pre-dawn-of-yesterday, and a paused clock that
// lands on NaN. A tone-mapping exposure that goes negative or non-finite
// darkens the frame to black — no rendered pixel survives it.

assert.ok(
  Math.abs(exposureForDay(1.25) - exposureForDay(0.25)) < 1e-9,
  "wraps 1.25 → 0.25 (next-day noon)",
);
assert.ok(
  Math.abs(exposureForDay(-0.25) - exposureForDay(0.75)) < 1e-9,
  "wraps -0.25 → 0.75 (yesterday midnight)",
);
assert.ok(
  Math.abs(exposureForDay(2.5) - exposureForDay(0.5)) < 1e-9,
  "wraps 2.5 → 0.5 (day-after-tomorrow dusk)",
);
assert.equal(exposureForDay(NaN), EXPOSURE_NOON, "paused clock at NaN falls back to noon exposure");
assert.equal(
  exposureForDay(Infinity),
  EXPOSURE_NOON,
  "non-finite clock falls back to noon (never black-frame)",
);

// The whole day must always return a finite, positive exposure. Any zero
// or negative would blacken the frame; any NaN would poison the renderer.
{
  for (let i = 0; i <= 200; i += 1) {
    const df = i / 200;
    const e = exposureForDay(df);
    assert.ok(Number.isFinite(e), `exposure must be finite at df=${df}; got ${e}`);
    assert.ok(e > 0, `exposure must be positive at df=${df}; got ${e}`);
    assert.ok(e <= EXPOSURE_NOON + 1e-9, `exposure must not exceed noon; df=${df} e=${e}`);
    assert.ok(e >= EXPOSURE_MIDNIGHT - 1e-9, `exposure must not undercut midnight; df=${df} e=${e}`);
  }
}

console.log(
  "city-grading ok: exposure ramp holds ~1.4 at noon, ~0.9 at each horizon, " +
  "~0.7 at midnight — the same emissive intensity reads as glowing from inside.",
);
