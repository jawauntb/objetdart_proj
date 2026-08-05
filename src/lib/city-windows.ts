/**
 * city-windows — the emotional peak of /city.
 *
 * The brief's whole aesthetic ladder points here: **warm tungsten windows
 * glowing one by one against a cool blue evening**. Dusk is the room's
 * emotional core, and the mechanism that makes that read is a lit-window
 * curve that is honest about the hour: at noon a lit window is invisible
 * against a bright sky, at dusk it is the whole picture, at midnight most
 * are dark but the few that stay lit are the memory of a settlement still
 * awake.
 *
 * `litFractionForDay(dayFraction, seed)` is the pure law that pins that
 * curve. It is exported so the plot shader (or a future 3D facade material)
 * reads the same number the test does. Every future refactor that touches
 * the dusk moment must survive test-city-windows.mjs — the settlement is
 * only allowed to change its light in ways that keep this ladder intact.
 *
 * The seed is a per-plot hash. Two homes at the same hour don't light in
 * lockstep — one leans warm and eager, one is a slow riser, one keeps the
 * kitchen lit through midnight while the rest of the block sleeps. The seed
 * shifts the curve within a small envelope so the ensemble reads as
 * forty-eight individuals inhabiting the same day, not one atlas stamped
 * forty-eight times.
 *
 * The curve is a pure function of dayFraction (the city.ts 0..1 unit-circle
 * day axis) and a numeric seed. It never touches wall clock, DOM, or three;
 * that is the whole point — it is a law, and the renderer reads it.
 */

// ── shape of the day ────────────────────────────────────────────────────
//
// A city's lit-window curve is not a sinusoid. Watching the SF financial
// district (reference 2) or London City (references 3 + 4) through a real
// evening, the shape is:
//
//   dawn (0)      → 0     no windows lit; the sky is enough
//   morning (0.1) → 0     the day is doing its work; kitchens have gone dark
//   noon (0.25)   → 0     bright day; even lit windows read as unlit
//   afternoon(0.4)→ ~0.15 first lamps come on in the shadowed corners
//   dusk (0.5)    → ~0.7  the emotional peak; most of the block is lit
//   evening (0.6) → ~0.75 the residents are home, the block is warm
//   late (0.75)   → ~0.4  most turn in; a scattering stay lit
//   deep (0.9)    → ~0.15 only the truly restless
//   pre-dawn (1)  → 0     back to sleep — matches dawn, closing the loop
//
// The curve below matches this shape by construction. It is a soft rise
// from mid-afternoon, a broad peak centered slightly past dusk, and a
// long decline through the night. Two Gaussian humps produce the shape
// cleanly with only four constants; a sinusoid was tried and rejected —
// it made noon glow gently and dawn look busy, which are the wrong story.

/**
 * The city-wide baseline lit fraction at a given hour. No seed: this is
 * the block's mean, the number you'd read if you averaged forty-eight
 * plots at a glance.
 *
 * dayFraction is expected in [0, 1); values outside that range are
 * wrapped, so a caller that passes `dayFraction(cityTimeMs)` directly
 * (which is already mod-1) is fine, and so is a bare hour count if
 * someone forgets.
 */
export function baselineLitFractionForDay(dayFraction: number): number {
  // Wrap to [0,1). Two guards because a naive `% 1` on a negative number
  // returns a negative in JS.
  const f = ((dayFraction % 1) + 1) % 1;

  // The evening peak: centered a shade past dusk (residents come home
  // just after the sky turns), broad enough to hold the emotional beat.
  const evening = gaussian(f, 0.56, 0.10) * 0.75;
  // The late-night tail: a warm hump around 0.75 for the scattering of
  // windows that stay on past everyone else's bedtime. Broad so midnight
  // itself still reads at ~0.4, the brief's ladder.
  const late = gaussian(f, 0.75, 0.09) * 0.35;
  // The mid-afternoon rise: a shallow ramp that lifts the first lamps
  // out of noon before dusk arrives — kitchen lights in the deep interior
  // rooms where the sun never reaches.
  const afternoon = gaussian(f, 0.42, 0.06) * 0.15;

  // Sum. The three humps overlap through the evening; the max is at dusk.
  return clamp01(evening + late + afternoon);
}

/**
 * Per-plot lit fraction. The seed nudges the curve within a small envelope
 * so a row of homes reads as a row of separate homes with their own
 * schedules. The city-wide baseline is preserved on average — the seed
 * only shifts *when* a given plot's lit-hour peaks, and *how bright* it
 * peaks, both by a modest fraction.
 *
 * The output is guaranteed to be in [0, 1]. Two plots with the same seed
 * always return the same number for the same hour (this function is pure).
 */
export function litFractionForDay(dayFraction: number, seed: number): number {
  const f = ((dayFraction % 1) + 1) % 1;

  // Two roughly-independent per-plot dials, derived from the one seed:
  //   - phaseShift: nudges the evening peak forward or backward by up to
  //     ±0.03 of a day. Some homes light up early, some late. Small on
  //     purpose — the ensemble must still peak at dusk.
  //   - amp: scales the whole curve by 0.75..1.25. Some homes are dim,
  //     some are bright; the mean over a lot of seeds is 1.
  const s = seedHash01(seed);
  const t = seedHash01(seed * 1.71 + 0.31);
  const phaseShift = (s - 0.5) * 0.06;
  const amp = 0.75 + t * 0.5;

  // Apply the phase shift, then read the baseline. Wrapping is handled by
  // the baseline function itself.
  const shifted = f - phaseShift;
  const base = baselineLitFractionForDay(shifted);

  return clamp01(base * amp);
}

/**
 * Per-window binary lit gate. Given the plot's lit fraction and a per-cell
 * hash (row, col within the facade window grid, plus the plot seed), decide
 * whether *this* window is on. Windows do NOT flicker every frame — the
 * gate is stable per hour, per window, because the hash is stable.
 *
 * This is what makes the "one by one" read: as the lit fraction rises
 * through dusk, each cell whose hash sits below the fraction flips on, in
 * roughly the order the seed picked. A cell whose hash is high stays dark
 * until deep dusk; a low-hash cell lights early. The visual is windows
 * blooming across the facade at their own pace, not a whole block flipping
 * on at once.
 */
export function windowIsLit(
  litFraction: number,
  plotSeed: number,
  row: number,
  col: number,
): boolean {
  // Combine plot seed with the (row, col) cell so every window has its
  // own deterministic hash. This uses the same tiny mixer city.ts uses
  // for its mulberry seeds — a couple of primes and a fract().
  const cellHash = seedHash01(plotSeed * 12.9898 + row * 78.233 + col * 37.719);
  // Compare against the lit fraction: a window lights the moment the
  // hour's brightness passes its own threshold. Since litFraction rises
  // and falls through the day, a window naturally turns off when the
  // curve retreats — the block darkens the same way it lit.
  return cellHash < litFraction;
}

// ── emissive intensity curve ─────────────────────────────────────────────
//
// The city-facades materials expose an `emissiveIntensity` scalar; the
// shader for the current 2D plot renderer exposes an equivalent
// `uWindowIntensity` uniform. Both are driven by this one function so the
// dusk-and-glow moment reads the same regardless of which renderer draws
// it. The curve mutes the emissive at noon (the sun does the work then),
// rises hard through dusk (where bloom in city-composer.ts picks it up
// with a lowered threshold), and holds at a warm memory value through
// midnight (a scattering of lit windows on a sleeping block).
//
// Peak value is 1.6 so it comfortably crosses the composer's dusk bloom
// threshold (~0.55) and produces the ember halo. Kept as a pure function
// of dayFraction — no wall clock, no DOM, no THREE.

export function emissiveIntensityForDay(dayFraction: number): number {
  const f = ((dayFraction % 1) + 1) % 1;
  // Distance from noon on the wrapped 0..1 axis.
  const dNoon = Math.min(
    Math.abs(f - 0.25),
    Math.abs(f - 0.25 - 1),
    Math.abs(f - 0.25 + 1),
  );
  // 0 at noon (the sun is enough), 1 at midnight (the block is on lights).
  const t = Math.min(1, dNoon * 2);
  // Smoothstep so the shift is soft — noon hour reads as fully off, not
  // a linear ramp down to it.
  const s = t * t * (3 - 2 * t);
  return s * 1.6;
}

// ── the shape ────────────────────────────────────────────────────────────
//
// Everything else is one-line helpers. Kept private so a caller can't
// reach in and rewrite the ladder without going through the tested API.

function gaussian(x: number, mu: number, sigma: number): number {
  // Wrap-aware distance on a unit circle — the day is a loop, so a peak at
  // dusk (0.5) must not read as far from a value at 0.99. Take the shorter
  // of the two ways around.
  const d0 = Math.abs(x - mu);
  const d = Math.min(d0, 1 - d0);
  const z = d / sigma;
  return Math.exp(-0.5 * z * z);
}

function seedHash01(seed: number): number {
  // A tiny deterministic hash into [0, 1). Same idiom the ground/plot
  // shaders use for their hash(); consistent so the CPU and GPU never
  // read different windows for the same plot.
  const s = Math.abs(seed) * 0.101_010_1 + 0.1234;
  return ((Math.sin(s * 12.9898) * 43758.5453) % 1 + 1) % 1;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
