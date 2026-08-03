// The /olympus laws. Every assertion below names the bug it would catch.
//
// The one that matters most: the analytic normal. The room takes the
// surface normal from a closed-form gradient rather than four extra taps,
// which is the only reason a 64-step raymarcher is affordable on a phone —
// and a wrong gradient is completely invisible until every light in the
// room is subtly wrong. So the gradient is checked against central finite
// differences of the height function itself, which is the one thing here
// that can be computed independently of the code under test.
//
// (Calibration precedent: on /organelles, summing chords to measure an
// arclength under-counted every curve, and the test that caught it checked
// the integral against 2πr — the single case computable by hand. The
// equivalents here are the vertical ray, whose hit distance is exactly the
// camera's height above the ground under it, and the horizontal ray
// through the fog's own altitude, whose optical depth is exactly its
// length.)

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
  new Function("module", "exports", "require", code)(module, module.exports, (id) => {
    throw new Error(`Unexpected require(${id}) while loading ${path}`);
  });
  return module.exports;
}

const F = loadTsModule("src/lib/heightfield.ts");

const rng = F.mulberry32(0x0417_2b9e);
const spread = (n, r) => Array.from({ length: n }, () => (rng() - 0.5) * r);

// —— determinism: the same seed is the same mountain, always ————————
{
  const a = F.groundAt(3.14, -2.71, 0xbeef);
  const b = F.groundAt(3.14, -2.71, 0xbeef);
  assert.deepEqual(a, b, "the same point on the same seed is the same ground");
  // ...and a different seed is a different mountain, or the seed is inert.
  const c = F.groundAt(3.14, -2.71, 0xbeee);
  assert.notEqual(c.h, a.h, "the seed actually moves the field");
  // The offset memo must not leak the previous seed's field into this one:
  // the bug is a one-entry cache keyed on nothing, which would make every
  // room after the first render the first room's mountain.
  assert.equal(F.groundAt(3.14, -2.71, 0xbeef).h, a.h, "a seed revisited is unchanged");
  assert.deepEqual(F.seedOffset(7), F.seedOffset(7), "a seed's offset is a fact about the seed");
}

// —— horns are a fact about the seed ———————————————————————————————
// The bug: horns re-drawn every tap, or a cache that freezes the first
// seed's horns into every later mountain.
{
  const hornsA = F.hornsForSeed(0xbeef);
  const hornsB = F.hornsForSeed(0xbeef);
  assert.deepEqual(hornsA, hornsB, "the same seed always yields the same horns");
  const hornsC = F.hornsForSeed(0xbeee);
  const same =
    hornsA.length === hornsC.length &&
    hornsA.every((h, i) => {
      const c = hornsC[i];
      return (
        Math.abs(h.cx - c.cx) < 1e-12 &&
        Math.abs(h.cz - c.cz) < 1e-12 &&
        Math.abs(h.amp - c.amp) < 1e-12 &&
        Math.abs(h.radius - c.radius) < 1e-12
      );
    });
  assert.ok(!same, "a different seed is a different horn set — centres, amps, or radii move");
  assert.deepEqual(F.hornsForSeed(0xbeef), hornsA, "a seed revisited keeps its own horns");

  for (const seed of [1, 0xbeef, 42, 0x5eed]) {
    const horns = F.hornsForSeed(seed);
    assert.equal(horns.length, F.HORN_COUNT, "the seed places exactly the designed horn count");
    for (const h of horns) {
      const r = Math.hypot(h.cx, h.cz);
      assert.ok(
        r >= F.HORN_RING_INNER_KM && r <= F.HORN_RING_OUTER_KM,
        `seed ${seed}: each horn sits on the ring (${r} km from origin)`,
      );
      assert.ok(h.amp > 0 && h.amp <= F.HORN_AMP_KM, `seed ${seed}: horn amplitude is bounded`);
      assert.ok(h.radius > 0 && h.aniso > 0, `seed ${seed}: horn shape stays physical`);
    }
    for (let i = 0; i < horns.length; i++) {
      for (let j = i + 1; j < horns.length; j++) {
        const sep = Math.hypot(horns[i].cx - horns[j].cx, horns[i].cz - horns[j].cz);
        assert.ok(
          sep >= F.HORN_MIN_SEP_KM - 1e-9,
          `seed ${seed}: horns do not stack on each other (${sep} km apart)`,
        );
      }
    }
  }
  assert.ok(F.HORN_AMP_KM <= F.SUMMIT_KM, "horn amplitude stays inside the summit cone's scale");
}

// —— the noise basis, and its derivative ————————————————————————
// This is the foundation the terrain normal is built on. The quintic fade
// is exactly differentiable everywhere, so here the tolerance is tight and
// there are no excuses: any mismatch is a real error in the chain rule.
{
  const H = 1e-5;
  let worst = 0;
  for (let i = 0; i < 3000; i++) {
    const x = (rng() - 0.5) * 200;
    const y = (rng() - 0.5) * 200;
    const [v, dx, dy] = F.noised(x, y);
    assert.ok(v >= 0 && v <= 1, "value noise stays inside its unit range");
    const fdx = (F.noised(x + H, y)[0] - F.noised(x - H, y)[0]) / (2 * H);
    const fdy = (F.noised(x, y + H)[0] - F.noised(x, y - H)[0]) / (2 * H);
    worst = Math.max(worst, Math.abs(fdx - dx), Math.abs(fdy - dy));
  }
  assert.ok(worst < 2e-4, `noise gradient matches finite differences (worst ${worst})`);
  // The fade must flatten at the cell walls, or the derivative steps across
  // every lattice line and the shading shows a square grid over the range.
  for (const w of [0, 1]) {
    const [, dx] = F.noised(3 + w, 4.5);
    const [, dxNext] = F.noised(3 + w - 1e-9, 4.5);
    assert.ok(Math.abs(dx) < 1e-6, "the gradient vanishes on a cell wall");
    assert.ok(Math.abs(dxNext) < 1e-6, "and on the approach to it");
  }
}

// —— the fold is a fold ————————————————————————————————————————
// Without the crease a "mountain" is a hill with more octaves. The
// transform must peak exactly at the fold, be continuous through it, and
// be NON-differentiable there: the two one-sided slopes differ by 4.
{
  assert.equal(F.ridgeFold(0.5), 1, "the fold is the maximum");
  assert.equal(F.ridgeFold(0), 0);
  assert.equal(F.ridgeFold(1), 0);
  for (let i = 0; i <= 200; i++) {
    const v = i / 200;
    const r = F.ridgeFold(v);
    assert.ok(r >= 0 && r <= 1, "the ridged value stays bounded");
    assert.ok(r <= 1 + 1e-12, "and never exceeds its maximum at the fold");
  }
  const e = 1e-7;
  assert.ok(
    Math.abs(F.ridgeFold(0.5 - e) - F.ridgeFold(0.5 + e)) < 1e-6,
    "continuous through the fold (C⁰)",
  );
  const left = (F.ridgeFold(0.5) - F.ridgeFold(0.5 - 1e-4)) / 1e-4;
  const right = (F.ridgeFold(0.5 + 1e-4) - F.ridgeFold(0.5)) / 1e-4;
  assert.ok(Math.abs(left - 2) < 1e-6, "climbing to the fold at +2");
  assert.ok(Math.abs(right + 2) < 1e-6, "and falling from it at −2");
  assert.ok(Math.abs(left - right) > 3.9, "so the fold is a crease, not a curve (not C¹)");
  assert.equal(F.ridgeFoldSlope(0.25), 2, "the slope agrees with the transform below the fold");
  assert.equal(F.ridgeFoldSlope(0.75), -2, "and above it");
}

// —— the smooth fbm's gradient, where nothing is allowed to be fuzzy ————
{
  const H = 1e-5;
  let worst = 0;
  for (let i = 0; i < 1500; i++) {
    const x = (rng() - 0.5) * 60;
    const y = (rng() - 0.5) * 60;
    const f = F.smoothFbm(x, y, 4);
    assert.ok(f.v >= 0 && f.v <= 1, "the normalised fbm stays in its unit range");
    const fdx = (F.smoothFbm(x + H, y, 4).v - F.smoothFbm(x - H, y, 4).v) / (2 * H);
    const fdy = (F.smoothFbm(x, y + H, 4).v - F.smoothFbm(x, y - H, 4).v) / (2 * H);
    worst = Math.max(worst, Math.abs(fdx - f.dx), Math.abs(fdy - f.dy));
  }
  // This is where a transposed octave rotation shows up first: the value
  // stays a perfectly good noise field and the gradient points sideways.
  assert.ok(worst < 5e-3, `fbm gradient survives the octave chain (worst ${worst})`);
}

// —— the horn field is smooth: its gradient matches finite differences ————
// The bug: a horn term copied without the chain rule, or an aggregate field
// whose value and gradient are accidentally computed from different horns.
{
  const H = 1e-4;
  for (const seed of [1, 0xbeef, 0x5eed]) {
    let checked = 0;
    let worst = 0;
    for (let i = 0; i < 800; i++) {
      const x = (rng() - 0.5) * 40;
      const z = (rng() - 0.5) * 40;
      const g = F.hornsAt(x, z, seed);
      checked++;
      const fdx = (F.hornsAt(x + H, z, seed).v - F.hornsAt(x - H, z, seed).v) / (2 * H);
      const fdz = (F.hornsAt(x, z + H, seed).v - F.hornsAt(x, z - H, seed).v) / (2 * H);
      worst = Math.max(worst, Math.abs(fdx - g.dx), Math.abs(fdz - g.dy));
    }
    assert.ok(
      worst < 5e-3,
      `seed ${seed}: horn ∂h agrees with finite differences (worst ${worst})`,
    );
    assert.ok(checked > 750, "the horn field was actually sampled");
  }

  // Path integral of the analytic horn gradient — horns are smooth, so no
  // crease skip can excuse disagreement with endpoint height.
  for (const seed of [1, 0xbeef]) {
    let worstRel = 0;
    for (let k = 0; k < 20; k++) {
      const x0 = (rng() - 0.5) * 30;
      const z0 = (rng() - 0.5) * 30;
      const a = rng() * Math.PI * 2;
      const L = 0.5 + rng() * 1.2;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const N = 3000;
      const ds = L / N;
      let integral = 0;
      for (let i = 0; i < N; i++) {
        const s = (i + 0.5) * ds;
        const g = F.hornsAt(x0 + dx * s, z0 + dz * s, seed);
        integral += (g.dx * dx + g.dy * dz) * ds;
      }
      const delta = F.hornsAt(x0 + dx * L, z0 + dz * L, seed).v - F.hornsAt(x0, z0, seed).v;
      const travel = Math.max(0.02, Math.abs(delta));
      worstRel = Math.max(worstRel, Math.abs(integral - delta) / travel);
    }
    assert.ok(
      worstRel < 0.02,
      `seed ${seed}: ∫∇h_horn·dl equals the horn height climbed (worst relative ${worstRel})`,
    );
  }
}

// —— THE ONE THAT MATTERS: the analytic terrain gradient ————————————
// The bug: a missing frequency factor, a dropped product-rule term, or a
// rotation transposed the wrong way in the octave chain, including the horn
// sum now folded into groundAt. Any of those leaves the height field perfect
// and the lighting wrong everywhere, in a way no screenshot reads as an
// error — it just looks slightly plastic.
//
// The ridged terrain is genuinely non-differentiable on an arête, so a
// pointwise finite difference straddling one is entitled to disagree. The
// check that has no such excuse is the integral: ∫∇h·dl along any path
// must equal h(end) − h(start) exactly, creases and all, because a kink is
// a set of measure zero. So the headline assertion compares an integral of
// the analytic gradient against a difference of the height function —
// two independent computations of the same number.
//
// The integrator's own resolution is part of the assertion. A ridged field
// has a kink at every octave's fold, and the midpoint rule loses O(ds) at
// each one — so with too few samples the number this compares against is
// the quadrature's error, not the gradient's, and the threshold becomes a
// race between them. Fewer paths, each integrated far more finely, keeps
// the same budget and moves the measurement floor an order of magnitude
// below the tolerance: at N = 12000 the residual converges like 1/N, which
// is how one can tell it is the rule and not the gradient.
for (const seed of [1, 0xbeef, 0x5eed, 991]) {
  let worstRel = 0;
  for (let k = 0; k < 14; k++) {
    const x0 = (rng() - 0.5) * 30;
    const z0 = (rng() - 0.5) * 30;
    const a = rng() * Math.PI * 2;
    const L = 0.4 + rng() * 0.8;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const N = 12000;
    const ds = L / N;
    let integral = 0;
    for (let i = 0; i < N; i++) {
      const s = (i + 0.5) * ds; // midpoint rule
      const g = F.groundAt(x0 + dx * s, z0 + dz * s, seed);
      integral += (g.dhdx * dx + g.dhdz * dz) * ds;
    }
    const endpoints = F.heightAt(x0 + dx * L, z0 + dz * L, seed) - F.heightAt(x0, z0, seed);
    // Scale the error by how much the ground actually moved along the
    // path, so a flat segment cannot flatter the result.
    const travel = Math.max(0.02, Math.abs(endpoints));
    worstRel = Math.max(worstRel, Math.abs(integral - endpoints) / travel);
  }
  assert.ok(
    worstRel < 0.01,
    `seed ${seed}: ∫∇h·dl equals the height it climbed (worst relative error ${worstRel})`,
  );
}

// ...and pointwise too, everywhere the surface actually has a normal.
// `foldMargin` names those places; they are excluded by that name rather
// than by loosening the tolerance until the suite goes green.
for (const seed of [1, 0xbeef, 0x5eed, 991]) {
  const H = 1e-4;
  let checked = 0;
  let skipped = 0;
  let worst = 0;
  for (let i = 0; i < 1200; i++) {
    const x = (rng() - 0.5) * 30;
    const z = (rng() - 0.5) * 30;
    const g = F.groundAt(x, z, seed);
    if (g.foldMargin < 5e-4) {
      skipped++;
      continue;
    }
    checked++;
    const fdx = (F.heightAt(x + H, z, seed) - F.heightAt(x - H, z, seed)) / (2 * H);
    const fdz = (F.heightAt(x, z + H, seed) - F.heightAt(x, z - H, seed)) / (2 * H);
    worst = Math.max(worst, Math.abs(fdx - g.dhdx), Math.abs(fdz - g.dhdz));
  }
  assert.ok(
    checked > 1050,
    `the folds are a thin set, not most of the range (${checked} checked, ${skipped} skipped)`,
  );
  assert.ok(
    worst < 5e-3,
    `seed ${seed}: analytic ∂h agrees with finite differences (worst ${worst})`,
  );
  // ...and therefore the normal is a real unit normal pointing up out of
  // the ground, never into it — a sign slip here inverts every face.
  for (let i = 0; i < 200; i++) {
    const x = (rng() - 0.5) * 30;
    const z = (rng() - 0.5) * 30;
    const n = F.normalAt(x, z, seed);
    assert.ok(Math.abs(Math.hypot(n[0], n[1], n[2]) - 1) < 1e-12, "the normal is a unit vector");
    assert.ok(n[1] > 0, "and points out of the ground, not into it");
    const g = F.groundAt(x, z, seed);
    // it must be perpendicular to the surface's own tangent along x
    const dot = n[0] * 1 + n[1] * g.dhdx + n[2] * 0;
    assert.ok(Math.abs(dot) < 1e-9, "the normal is perpendicular to the surface tangent");
  }
}

// —— boundedness, which the marcher's early exit depends on ————————
// The bug: an fbm normalised by the wrong sum, so real peaks stand above
// HEIGHT_MAX_KM and the marcher abandons rays that would have hit them —
// far summits silently clipped out of the sky, and nothing to see wrong
// except that the horizon is emptier than it should be.
for (const seed of [1, 0xbeef, 42]) {
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = 0; i < 4000; i++) {
    const h = F.heightAt((rng() - 0.5) * 90, (rng() - 0.5) * 90, seed);
    hi = Math.max(hi, h);
    lo = Math.min(lo, h);
  }
  assert.ok(lo >= 0, `seed ${seed}: no ground below the datum (${lo})`);
  assert.ok(hi <= F.HEIGHT_MAX_KM, `seed ${seed}: no ground above the ceiling (${hi})`);
  // ...and the ceiling is not absurdly slack, or the marcher's early exit
  // never fires and the budget is spent climbing through empty sky.
  assert.ok(hi > F.HEIGHT_MAX_KM * 0.4, `seed ${seed}: the range actually reaches up (${hi})`);
  assert.ok(
    // taller ceiling from ridge amp + horns; the outcrop is unchanged, so the summit's fraction of HEIGHT_MAX dips
    F.eyeAltitude(seed) > F.HEIGHT_MAX_KM * 0.5,
    `seed ${seed}: the summit is a summit (eye at ${F.eyeAltitude(seed)})`,
  );
}
{
  // The outcrop is really under the wanderer's feet: the origin stands
  // above its own surroundings, or the room opens looking up at a wall.
  for (const s of [1, 7, 0xbeef]) {
    const here = F.heightAt(0, 0, s);
    let around = 0;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      around += F.heightAt(Math.cos(a) * 3.2, Math.sin(a) * 3.2, s);
    }
    assert.ok(here > around / 24, `seed ${s}: the origin is a summit, not a hollow`);
  }
}

// —— the eye stands above the terrain the MARCHER sees ————————————
// This one is written from the bug, not toward it. The marcher walks a
// cheaper terrain than the shader draws; setting the eye from the shading
// height put it a few metres UNDER the marching height on some seeds, and
// every ray then hit ground on its first step. The room opened on a wall
// of grey rock, deterministically, with nothing anywhere to explain it.
for (let s = 0; s < 60; s++) {
  const seed = F.hashSeed(s, 0x9e37);
  const eye = F.eyeAltitude(seed);
  assert.ok(
    eye > F.heightAt(0, 0, seed, F.OCTAVES_MARCH),
    `seed ${seed}: the eye stands above the terrain the marcher walks`,
  );
  assert.ok(
    eye > F.heightAt(0, 0, seed, F.OCTAVES_SHADE),
    `seed ${seed}: and above the terrain the shader draws`,
  );
  // ...and the very first ray of a level look must not hit the ground it
  // is standing on, or the room is a wall however the head is turned.
  for (const az of [0, 1.1, 2.7, 4.4]) {
    const m = F.marchTerrain(F.eyePosition(seed), [Math.sin(az), -0.02, Math.cos(az)], seed);
    assert.ok(!m.hit || m.t > 0.2, `seed ${seed}: a level look sees past its own feet (${m.t})`);
  }
}

// —— the fog finds its own level, on every seed ————————————————
// The bug: a constant fog altitude. Each seed's massif sits at its own
// height, so one constant drowns one range completely and leaves the next
// one bare — and the room's whole picture, an archipelago of peaks, only
// exists for the handful of seeds the constant happened to suit.
{
  let worstOut = 1;
  let bestOut = 0;
  for (let s = 0; s < 40; s++) {
    const seed = F.hashSeed(s, 0x0f06);
    const alt = F.restingFogAltitude(seed);
    assert.deepEqual(F.restingFogAltitude(seed), alt, "the resting level is a fact about the seed");
    assert.ok(alt > 0 && alt < F.HEIGHT_MAX_KM, "and lies inside the range's own span");
    assert.ok(alt < F.eyeAltitude(seed), "and always below the eye — you stand above the fog");
    // Measured independently of how the level was chosen: a fresh random
    // sample of the same ground.
    const r2 = F.mulberry32(F.hashSeed(s, 7));
    let out = 0;
    const N = 1500;
    for (let i = 0; i < N; i++) {
      const a = r2() * Math.PI * 2;
      const r = F.FOG_SAMPLE_INNER_KM + Math.sqrt(r2()) * (F.FOG_SAMPLE_OUTER_KM - F.FOG_SAMPLE_INNER_KM);
      if (F.heightAt(Math.cos(a) * r, Math.sin(a) * r, seed) > alt) out++;
    }
    worstOut = Math.min(worstOut, out / N);
    bestOut = Math.max(bestOut, out / N);
  }
  assert.ok(worstOut > 0.2, `no seed is drowned flat (least land showing: ${worstOut})`);
  assert.ok(bestOut < 0.6, `and none is left bare (most land showing: ${bestOut})`);
  // One long breath must actually change the picture — it has to draw the
  // fog down past a real amount of ground, not shave a metre off it.
  const seed = F.hashSeed(3, 0x0f06);
  const rest = F.restingFogAltitude(seed);
  assert.ok(F.FOG_BREATH_KM > 0.2, "a drawn breath is worth drawing");
  assert.ok(rest - F.FOG_BREATH_KM < rest, "and it draws the fog down, not up");
}

// —— the fog: monotone falloff, bounded transmittance ————————————
{
  const a = 1.1;
  let prev = Infinity;
  for (let y = -0.5; y <= 3; y += 0.05) {
    const d = F.fogDensity(y, a);
    assert.ok(d > 0, "density is never zero — the fog has no hard ceiling");
    assert.ok(d < prev, "and thins strictly with height");
    prev = d;
  }
  assert.ok(Math.abs(F.fogDensity(a, a) - 1) < 1e-12, "density is 1 at the fog's own altitude");

  // The case computable by hand: a horizontal ray at exactly the fog
  // altitude travels through density 1 the whole way, so its optical depth
  // is its own length. If the closed form disagrees with that, the whole
  // integral is wrong and every distance in the room is mis-hazed.
  for (const L of [0.1, 1, 5, 20]) {
    assert.ok(
      Math.abs(F.fogOpticalDepth(a, 0, L, a) - L) < 1e-9,
      `a level ray through the fog top weighs exactly its length (${L})`,
    );
    // ...and the same holds in the limit of a very nearly level ray.
    assert.ok(
      Math.abs(F.fogOpticalDepth(a, 1e-9, L, a) - L) < 1e-6,
      "the nearly-level case agrees with the level one (no divide-by-zero cliff)",
    );
  }
  // The second hand-computable case: straight up from the fog top, the
  // whole column above weighs exactly one scale height.
  assert.ok(
    Math.abs(F.fogOpticalDepth(a, 1, 1e6, a) - F.FOG_SCALE_HEIGHT_KM) < 1e-9,
    "the column above the fog top integrates to exactly H",
  );

  for (const dirY of [-0.8, -0.2, 0, 0.15, 0.9]) {
    let prevTau = -1;
    for (let L = 0; L <= 30; L += 0.25) {
      const tau = F.fogOpticalDepth(1.6, dirY, L, a);
      assert.ok(tau >= 0, "optical depth is never negative");
      assert.ok(Number.isFinite(tau), "and never runs away to infinity — one inf is a NaN pixel");
      assert.ok(tau <= F.FOG_TAU_MAX, "the integral honours its own ceiling");
      assert.ok(tau >= prevTau - 1e-12, "and never falls as the path lengthens");
      const T = F.fogTransmittance(1.6, dirY, L, a);
      assert.ok(T >= 0 && T <= 1 + 1e-12, "transmittance stays in [0,1]");
      prevTau = tau;
    }
    // An upward ray's total load is bounded however far it runs — this is
    // why the sky above the peak stays clear no matter how drowned the
    // valley is. A downward ray has no such bound and must not claim one.
    if (dirY > 0) {
      const cap = (F.FOG_SCALE_HEIGHT_KM * F.fogDensity(1.6, a)) / dirY;
      assert.ok(
        F.fogOpticalDepth(1.6, dirY, 1e7, a) <= cap + 1e-9,
        "the column above any point is bounded by H·ρ/dirY",
      );
    }
  }
  assert.equal(F.fogTransmittance(1.6, -0.4, 0, a), 1, "nothing travelled, nothing lost");
  // Deeper fog costs more light at the same distance, always.
  assert.ok(
    F.fogTransmittance(1.6, -0.4, 4, 1.5) < F.fogTransmittance(1.6, -0.4, 4, 0.9),
    "raising the fog dims the same view",
  );
}

// —— raising the fog only ever drowns more land ——————————————————
// The bug this is here for: a rolling fog top whose swell amplitude is
// derived from the altitude. That reads fine at rest and is catastrophic
// in the hand — as the breath lifts the fog, patches of ground would come
// back OUT of the sea, and the archipelago would flicker.
{
  const seed = 0xc0ffee;
  const pts = Array.from({ length: 300 }, () => [(rng() - 0.5) * 24, (rng() - 0.5) * 24]);
  for (const phase of [0, 3.7, 19.2]) {
    for (const [x, z] of pts) {
      let wasDrowned = false;
      let prevDepth = -Infinity;
      for (let alt = 0; alt <= F.HEIGHT_MAX_KM; alt += 0.02) {
        const depth = F.submergedDepth(x, z, alt, seed, phase);
        assert.ok(depth > prevDepth, "the water rises strictly with the fog altitude");
        const now = F.submerged(x, z, alt, seed, phase);
        if (wasDrowned) assert.ok(now, "land already under the fog never surfaces again");
        wasDrowned = wasDrowned || now;
        prevDepth = depth;
      }
      // Everything is dry at the datum and drowned at the ceiling — the
      // invariant genuinely spans from a bare range to an empty sea.
      assert.equal(F.submerged(x, z, -0.001, seed, phase), false, "nothing drowns below the datum");
      assert.equal(
        F.submerged(x, z, F.HEIGHT_MAX_KM + 0.1, seed, phase),
        true,
        "and nothing survives above the ceiling",
      );
    }
  }
  // The altitude enters the fog surface with slope exactly one — the fog
  // is a level, not a scaling.
  const d0 = F.submergedDepth(2.2, -1.4, 0.8, seed, 5);
  const d1 = F.submergedDepth(2.2, -1.4, 0.9, seed, 5);
  assert.ok(Math.abs(d1 - d0 - 0.1) < 1e-12, "a metre of fog is a metre of water");
  // The swell is real, or the shoreline is a razor.
  const tops = pts.slice(0, 40).map(([x, z]) => F.fogSurfaceAt(x, z, 1.0, 0));
  assert.ok(Math.max(...tops) - Math.min(...tops) > 1e-3, "the fog top actually rolls");
  assert.ok(
    Math.max(...tops) - Math.min(...tops) <= 2 * F.FOG_WAVE_KM + 1e-12,
    "and rolls no further than its stated swell",
  );
}

// —— the march: budgeted, bounded, and right about where it lands ————
{
  const seed = 0x1a2b;
  const ro = F.eyePosition(seed);

  // The case computable without marching at all: straight down from a
  // known altitude over a known column, the hit is at exactly the height
  // difference. Anything else means the marcher is stepping past surfaces
  // or the refinement is not converging on the crossing it bracketed.
  for (const [x, z] of [[4.1, -2.3], [-7.7, 5.05], [0.4, 0.9], [12.2, -14.6]]) {
    const y0 = F.HEIGHT_MAX_KM + 0.9;
    const truth = y0 - F.heightAt(x, z, seed, F.OCTAVES_MARCH);
    const m = F.marchTerrain([x, y0, z], [0, -1, 0], seed);
    assert.ok(m.hit, `a ray straight down from the ceiling always finds ground (${x},${z})`);
    assert.ok(
      Math.abs(m.t - truth) < 0.03,
      `and lands where the height says it should (${m.t} vs ${truth})`,
    );
  }
  // Straight up from the summit meets nothing, and gives up quickly.
  {
    const m = F.marchTerrain(ro, [0, 1, 0], seed);
    assert.equal(m.hit, false, "there is no ground in the sky");
    assert.ok(m.steps < 20, `and the ceiling exit fires early (${m.steps} steps)`);
  }

  // The budget is a budget. If a plausible refactor made the step size
  // able to reach zero (a clamp dropped, a relaxation set to 0) this loop
  // would hang in the shader; here it just fails.
  let worstSteps = 0;
  let hits = 0;
  let reach = 0;
  for (let i = 0; i < 900; i++) {
    const az = rng() * Math.PI * 2;
    const el = (rng() - 0.62) * 0.9;
    const rd = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
    const m = F.marchTerrain(ro, rd, seed);
    assert.ok(m.steps <= F.MARCH_STEPS, `the march never exceeds its budget (${m.steps})`);
    assert.ok(m.t <= F.MARCH_MAX_KM + 1e-9, "and never runs past its horizon");
    assert.ok(Number.isFinite(m.t), "and always returns a real distance");
    reach = Math.max(reach, m.t);
    if (m.hit) {
      hits++;
      // The reported hit is genuinely at the surface: the ground under it
      // is within a step's refinement of the ray's own altitude.
      const p = [ro[0] + rd[0] * m.t, ro[1] + rd[1] * m.t, ro[2] + rd[2] * m.t];
      const h = F.heightAt(p[0], p[2], seed, F.OCTAVES_MARCH);
      assert.ok(
        Math.abs(p[1] - h) < 0.06 + m.t * 0.004,
        `the hit sits on the surface (gap ${(p[1] - h).toFixed(4)} at ${m.t.toFixed(2)} km)`,
      );
    }
    worstSteps = Math.max(worstSteps, m.steps);
  }
  assert.ok(hits > 300, `most downward rays find the range (${hits}/900)`);
  assert.ok(worstSteps <= F.MARCH_STEPS, `worst case stayed inside the budget (${worstSteps})`);
  // A budget is only half the law — the other half is that 64 steps are
  // ENOUGH. Drop the growth floor and every step shrinks to the minimum:
  // the march still terminates, still keeps its budget, and quietly stops
  // seeing anything more than a kilometre away. The horizon simply empties.
  assert.ok(
    reach > 20,
    `64 steps still carry the eye to the far horizon (reached ${reach.toFixed(1)} km)`,
  );
  // Deterministic: the same ray on the same seed is the same mountain.
  assert.deepEqual(
    F.marchTerrain(ro, [0.3, -0.2, 0.93], seed),
    F.marchTerrain(ro, [0.3, -0.2, 0.93], seed),
    "the same call marches the same distance",
  );
}

// —— the sun's palette: continuous, and never dimming as it rises ————
// The bug: a palette assembled from branches on the sign of the elevation,
// which pops the moment the sun touches the horizon — the exact instant
// the room is most worth looking at.
{
  const step = 0.002;
  let prevLum = -1;
  let prev = null;
  let worstJump = 0;
  for (let e = F.SUN_NIGHT_ELEVATION - 0.4; e <= F.SUN_TOP_ELEVATION + 0.4; e += step) {
    const p = F.paletteForSun(e);
    for (const key of ["sun", "zenith", "horizon", "fog"]) {
      for (const c of p[key]) assert.ok(c >= 0 && c <= 1.001, `${key} stays a colour`);
    }
    if (prev) {
      for (const key of ["sun", "zenith", "horizon", "fog"]) {
        for (let i = 0; i < 3; i++) {
          worstJump = Math.max(worstJump, Math.abs(p[key][i] - prev[key][i]));
        }
      }
      worstJump = Math.max(worstJump, Math.abs(p.ambient - prev.ambient));
      worstJump = Math.max(worstJump, Math.abs(p.sunI - prev.sunI));
    }
    const lum = F.luminance(p.fog);
    assert.ok(lum >= prevLum - 1e-12, `the day never darkens as the sun climbs (at ${e})`);
    prevLum = lum;
    prev = p;
  }
  // The fastest anchor (the horizon reddening into dawn) moves ~3.6 units
  // per radian, so 2 milli-radians can honestly move it 0.007. A branch on
  // the sign of the elevation would step a whole anchor gap — 0.3 or more,
  // forty times this ceiling — so the bound separates the two cleanly.
  assert.ok(worstJump < 0.015, `no palette pop anywhere on the sweep (worst ${worstJump})`);
  // The ends are the ends, and they are the right way round.
  const night = F.paletteForSun(-2);
  const noon = F.paletteForSun(2);
  assert.ok(night.sunI < 0.1, "the night has no sun in it");
  assert.ok(noon.sunI > 1, "and the high day does");
  assert.ok(F.luminance(noon.fog) > F.luminance(night.fog) * 5, "and the fog knows the difference");
  // Dawn is warm and noon is not — the alpenglow is a real feature of the
  // map, not a name for it.
  const dawn = F.paletteForSun(0.02);
  assert.ok(dawn.sun[0] - dawn.sun[2] > noon.sun[0] - noon.sun[2], "dawn light runs warmer than noon");
  // ...and the sun direction is a unit vector standing at the stated angle.
  for (const [az, el] of [[0, 0], [1.1, 0.4], [-2.6, -0.2]]) {
    const d = F.sunDirection(az, el);
    assert.ok(Math.abs(Math.hypot(d[0], d[1], d[2]) - 1) < 1e-12, "sun direction is a unit vector");
    assert.ok(Math.abs(Math.asin(d[1]) - el) < 1e-12, "and stands at the elevation it was given");
  }
}

// —— the season closes ————————————————————————————————————————
// The bug: a snowline built on a sawtooth, which cracks the range open
// once per revolution of the three-finger twist.
{
  for (const s of [0, 0.13, 0.5, 0.77, 3.4, -1.2]) {
    assert.ok(
      Math.abs(F.snowlineKm(s) - F.snowlineKm(s + 1)) < 1e-12,
      "a full turn of the season returns the same snowline",
    );
  }
  let worst = 0;
  for (let s = 0; s <= 2; s += 0.001) {
    const a = F.snowlineKm(s);
    worst = Math.max(worst, Math.abs(F.snowlineKm(s + 0.001) - a));
    assert.ok(
      a >= F.SNOWLINE_MID_KM - F.SNOWLINE_SWING_KM - 1e-12 &&
        a <= F.SNOWLINE_MID_KM + F.SNOWLINE_SWING_KM + 1e-12,
      "the snowline stays inside its swing",
    );
  }
  assert.ok(worst < 0.01, `the snowline moves continuously (worst ${worst})`);
  assert.ok(
    F.SNOWLINE_MID_KM + F.SNOWLINE_SWING_KM < F.HEIGHT_MAX_KM,
    "there is always ground above the snowline for snow to sit on",
  );
}

// —— cornices and materials: wind-shaped snow over rock and ice ——————
// The bugs: cornices on both sides of a ridge, material weights that do
// not partition the surface, or a glacier rule that ignores valley shape.
{
  const wind = F.windVector(0xbeef);
  assert.ok(Math.abs(Math.hypot(wind[0], wind[1]) - 1) < 1e-12, "wind is a unit vector in the horizontal plane");
  assert.deepEqual(F.windVector(0xbeef), wind, "wind is a fact about the seed");

  const windward = F.corniceStrength(0, 1, 0, [1, 0]);
  const lee = F.corniceStrength(0, 1, 0, [-1, 0]);
  assert.ok(windward < 0.05, `windward face is bare (${windward})`);
  assert.ok(lee > 0.95, `lee face holds snow (${lee})`);
  assert.equal(F.corniceStrength(F.CORNICE_CREASE_HI + 1e-4, 1, 0, [-1, 0]), 0, "a rounded ridge has no cornice");
  assert.ok(Math.abs(F.corniceStrength(0, 0, 0, [-1, 0])) < 1e-12, "a flat summit has no cornice");
  assert.ok(F.corniceStrength(0, F.CORNICE_SLOPE_LO * 0.5, 0, [-1, 0]) < 0.05, "gentle slopes do not cornice");

  const season = 0.42;
  const snowline = F.snowlineKm(season);
  const windW = [-1, 0];
  const snowDom = F.materialFromGround(
    { h: snowline + 0.25, dhdx: 0.05, dhdz: 0.05, crease: 0.35, foldMargin: 0.2, ridge: 0.8 },
    season,
    windW,
  );
  assert.equal(snowDom.kind, "snow", "high flat ridge classifies as snow");
  assert.ok(snowDom.snow > snowDom.rock && snowDom.snow > snowDom.glacier, "high flat ridge is snow-dominant");

  const rockDom = F.materialFromGround(
    { h: snowline + 0.3, dhdx: 1.2, dhdz: 0.4, crease: 0.5, foldMargin: 0.15, ridge: 0.85 },
    season,
    windW,
  );
  assert.equal(rockDom.kind, "rock", "steep high face classifies as rock");
  assert.ok(rockDom.rock > rockDom.snow && rockDom.rock > rockDom.glacier, "steep high face is rock-dominant");

  const glacierDom = F.materialFromGround(
    { h: snowline - F.GLACIER_BELOW_SNOWLINE_KM * 0.5, dhdx: 0.04, dhdz: 0.03, crease: 0.3, foldMargin: 0.25, ridge: 0.08 },
    season,
    windW,
  );
  assert.equal(glacierDom.kind, "glacier", "low gentle valley classifies as glacier");
  assert.ok(
    glacierDom.glacier > glacierDom.rock && glacierDom.glacier > glacierDom.snow,
    "low gentle valley is glacier-dominant",
  );

  for (const m of [snowDom, rockDom, glacierDom]) {
    const sum = m.rock + m.snow + m.glacier;
    assert.ok(Math.abs(sum - 1) < 1e-12, `synthetic material weights partition the face (${sum})`);
  }

  for (let s = 0; s <= 2; s += 0.13) {
    const m0 = F.materialAt(3.1, -2.4, 0xbeef, s);
    const m1 = F.materialAt(3.1, -2.4, 0xbeef, s + 1);
    assert.equal(m0.kind, m1.kind, "materialAt is periodic in season kind (period 1)");
    for (const key of ["rock", "snow", "glacier", "cornice"]) {
      assert.ok(
        Math.abs(m0[key] - m1[key]) < 1e-10,
        `materialAt ${key} is periodic in season (period 1)`,
      );
    }
  }

  let roundedChecked = 0;
  for (let i = 0; i < 300; i++) {
    const x = (rng() - 0.5) * 20;
    const z = (rng() - 0.5) * 20;
    const m = F.materialAt(x, z, 0xbeef, season);
    assert.ok(m.cornice >= 0 && m.cornice <= 1, "cornice stays in [0,1]");
    const sum = m.rock + m.snow + m.glacier;
    assert.ok(Math.abs(sum - 1) < 1e-6, `rock+snow+glacier partition the face (${sum})`);
    const g = F.groundAt(x, z, 0xbeef);
    if (g.crease > F.CORNICE_CREASE_HI) {
      roundedChecked++;
      assert.ok(m.cornice < 1e-12, "rounded ridges shed cornice");
    }
  }
  assert.ok(roundedChecked > 40, `rounded ridges were actually sampled (${roundedChecked})`);
}

// —— the call, and what answers ————————————————————————————————
{
  // Computable by hand: 343 m out and 343 m back is exactly two seconds.
  assert.ok(Math.abs(F.echoDelayMs(0.343) - 2000) < 1e-9, "343 m of range answers in two seconds");
  assert.equal(F.echoDelayMs(0), 0);
  let prev = -1;
  let prevMidi = 1e9;
  for (let d = 0; d <= F.ECHO_MAX_KM; d += 0.01) {
    const ms = F.echoDelayMs(d);
    assert.ok(ms > prev, "a further wall answers later");
    const m = F.echoMidi(d);
    assert.ok(m <= prevMidi, "and deeper");
    assert.ok(m >= F.ECHO_FAR_MIDI && m <= F.ECHO_NEAR_MIDI, "within the room's register");
    prev = ms;
    prevMidi = m;
  }
  // Nothing is ever scheduled for a time that will not come: the bug is an
  // echo from a 40 km ridge, whose timeout fires four minutes after the
  // hand that called has left the room.
  const seed = 0x1a2b;
  const ro = F.eyePosition(seed);
  let answered = 0;
  for (let i = 0; i < 400; i++) {
    const az = rng() * Math.PI * 2;
    const el = (rng() - 0.7) * 0.8;
    const rd = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
    const e = F.callAnswer(ro, rd, seed);
    if (!e) continue;
    answered++;
    assert.ok(e.distKm <= F.ECHO_MAX_KM, "only near ground answers");
    assert.ok(
      e.delayMs <= F.echoDelayMs(F.ECHO_MAX_KM) + 1e-9,
      "and never later than the range's own horizon",
    );
    assert.ok(Math.abs(e.delayMs - F.echoDelayMs(e.distKm)) < 1e-9, "the delay is the distance");
  }
  assert.ok(answered > 10, `some calls do come back (${answered}/400) — a room that never answers is worse than none`);
  assert.equal(F.callAnswer(ro, [0, 1, 0], seed), null, "a call into the sky is simply kept");
}

// —— the wind, and the fog's hush ————————————————————————————————
// The bug: a wind that grows louder forever with altitude, which is both
// wrong and, at the top of the room, unbearable.
{
  const inFog = F.windVoice(-0.3);
  const justOut = F.windVoice(0.25);
  const high = F.windVoice(1.7);
  assert.equal(inFog.gain, 0, "inside the fog the wind is hushed to nothing");
  assert.ok(justOut.gain > 0.3, "just above the fog line it finds you");
  assert.ok(high.gain < justOut.gain, "and thins again with height, never the reverse");
  let prevHz = -1;
  let prevGain = null;
  let worstJump = 0;
  for (let e = -0.5; e <= 3; e += 0.002) {
    const w = F.windVoice(e);
    assert.ok(w.gain >= 0 && w.gain <= 1, "the wind stays inside the mix");
    assert.ok(w.hz >= prevHz - 1e-12, "thinner air sounds higher, monotonically");
    if (prevGain !== null) worstJump = Math.max(worstJump, Math.abs(w.gain - prevGain));
    prevHz = w.hz;
    prevGain = w.gain;
  }
  assert.ok(worstJump < 0.01, `the wind changes continuously (worst ${worstJump})`);
  // The register fraction spans the invariant's whole range and only rises.
  assert.equal(F.fogRegisterFraction(0), 0, "fog on the valley floor is the peak's own register");
  assert.equal(F.fogRegisterFraction(F.HEIGHT_MAX_KM), 1, "fog over the summit is the sea's");
  assert.ok(
    F.fogRegisterFraction(1.2) > F.fogRegisterFraction(0.6),
    "and rises with the fog, so drowning the range sounds like descending",
  );
}

// —— the same function, written twice ————————————————————————————
// The room marches this field per pixel in GLSL, so the field exists in two
// languages, and a second differently-behaving copy is the determinism
// law's worst failure: the room would draw a mountain nothing here has ever
// checked. Node cannot run GLSL, so what is pinned is the two mechanisms
// that make a divergence impossible rather than merely unlikely — the
// constants are injected from these very exports, and nothing seed-derived
// is recomputed on the GPU.
{
  // 1. The injection round-trips. The bug: a formatter that prints a float
  // "nicely" — BASE_FREQ is 1/6.1 = 0.16393442622950818, and shipping 0.164
  // to the shader moves every ridge in the range by a kilometre while both
  // copies still look correct.
  for (const [name, value] of Object.entries(F.HEIGHTFIELD_GLSL_FLOATS)) {
    const lit = F.glslFloat(value);
    assert.equal(Number.parseFloat(lit), value, `${name} survives the trip into GLSL (${lit})`);
    assert.ok(/[.]/.test(lit), `${name} is a GLSL float literal, not an int (${lit})`);
  }
  // an int written as a float, or a float written as an int, is a compile
  // error on the GPU and silence in node
  assert.equal(F.glslFloat(3), "3.0");
  assert.equal(F.glslFloat(-0.34), "-0.34");
  assert.equal(Number.parseFloat(F.glslFloat(1e-7)), 1e-7);
  assert.ok(/[.]/.test(F.glslFloat(1e-7)), "even in exponent form");

  const preamble = F.heightfieldGlslConstants();
  const body = F.HEIGHTFIELD_GLSL_BODY;
  const defined = new Map();
  for (const line of preamble.split("\n")) {
    const m = /^const (int|float) ([A-Z0-9_]+) = (-?[0-9.eE+-]+);$/.exec(line.trim());
    assert.ok(m, `every preamble line declares one constant (${line})`);
    defined.set(m[2], Number.parseFloat(m[3]));
  }
  for (const [name, value] of Object.entries({
    ...F.HEIGHTFIELD_GLSL_INTS,
    ...F.HEIGHTFIELD_GLSL_FLOATS,
  })) {
    assert.ok(defined.has(name), `${name} reaches the shader`);
    assert.equal(defined.get(name), value, `${name} reaches it unchanged`);
  }

  // 2. Names, both ways. The bug: a constant renamed in TS while the GLSL
  // keeps saying the old name (a shader that fails to compile at runtime,
  // in the browser, where this suite is not looking), or a constant left in
  // the preamble that the body has quietly stopped using — which is what an
  // inlined literal looks like from here.
  const used = new Set(body.match(/\b[A-Z][A-Z0-9_]{2,}\b/g) ?? []);
  for (const name of used) {
    assert.ok(defined.has(name), `the shader body names only constants it is given (${name})`);
  }
  for (const name of defined.keys()) {
    assert.ok(used.has(name), `${name} is actually used by the shader, not stale in the preamble`);
  }

  // 3. And no bare copies — the failure the SPEC names: a second, silently
  // different height field, typed into the GLSL by hand. The four excluded
  // constants share their exact decimal form with an honest literal of the
  // same value in the same source (GAIN's 0.5 with the bisection midpoint,
  // SUMMIT_RADIUS_KM's 0.62 with the glacier's valley threshold,
  // SUMMIT_EPS_KM's 0.02 with the march's first step, MARCH_MAX_KM's 30.0
  // with the quintic fade's, CONTOUR_INTERVAL_KM's 0.1 with the glacier
  // slope band's half-width) — everything else must be named.
  const shared = new Set([
    "GAIN",
    "SUMMIT_RADIUS_KM",
    "SUMMIT_EPS_KM",
    "MARCH_MAX_KM",
    "CONTOUR_INTERVAL_KM",
  ]);
  const names = Object.keys(F.HEIGHTFIELD_GLSL_FLOATS);
  let checkedInline = 0;
  for (const name of names) {
    if (shared.has(name)) continue;
    checkedInline++;
    const lit = F.glslFloat(F.HEIGHTFIELD_GLSL_FLOATS[name]);
    // a whole literal, not a digit of a longer one: 0.2 is not 0.21
    const bare = new RegExp(`(?<![0-9.])${lit.replace(/[.+]/g, "\\$&")}(?![0-9])`);
    assert.ok(
      !bare.test(body),
      `${name} is named in the shader, never retyped as ${lit}`,
    );
  }
  assert.ok(
    checkedInline > (names.length * 2) / 3,
    `most constants are checked for inlining (${checkedInline}/${names.length})`,
  );

  // 3b. ASCII, comments included. GLSL ES 1.00 declares an ASCII source
  // character set, and drivers that enforce it reject the whole shader over
  // an em dash in a comment — which fails silently into the 2D fallback,
  // i.e. into exactly the flat room this shader exists to replace.
  const nonAscii = [...`${preamble}\n${body}`].filter((c) => c.charCodeAt(0) > 127);
  assert.equal(nonAscii.length, 0, `the shader source is ASCII (found ${nonAscii.join("")})`);

  // 4. The budget is the same budget. The marcher's loops are written with
  // these bounds as literals because GLSL ES 1.00 demands constants; if the
  // shader's ceiling drifted above the one the march is tested against, the
  // room would be spending a budget nothing here has ever measured.
  assert.ok(
    new RegExp(`for \\(int i = 0; i < MARCH_STEPS; i\\+\\+\\)`).test(body),
    "the shader's march runs to MARCH_STEPS, by name",
  );
  assert.ok(
    new RegExp(`for \\(int k = 0; k < MARCH_REFINE; k\\+\\+\\)`).test(body),
    "and refines to MARCH_REFINE, by name",
  );
  assert.ok(/if \(i >= steps\) break;/.test(body), "and the frame's own budget can only lower it");
  assert.ok(/if \(k >= refine\) break;/.test(body), "including the refinement");

  // 5. Nothing seed-derived is computed twice. The horn table is placed once
  // by hornsForSeed and handed over; the bug it forecloses is a shader that
  // re-hashes the seed and grows its own horns somewhere else.
  for (const seed of [0x0a1a, 0xbeef, 7]) {
    const packed = F.packHorns(seed);
    const horns = F.hornsForSeed(seed);
    assert.equal(packed.a.length, F.HORN_COUNT * 4, "one vec4 per horn");
    assert.equal(packed.b.length, F.HORN_COUNT * 4);
    for (let i = 0; i < F.HORN_COUNT; i++) {
      const h = horns[i];
      assert.ok(Math.abs(packed.a[i * 4 + 0] - h.cx) < 1e-6, "the packed horn stands where it was placed");
      assert.ok(Math.abs(packed.a[i * 4 + 1] - h.cz) < 1e-6);
      assert.ok(Math.abs(packed.a[i * 4 + 2] - h.amp) < 1e-6, "with the amplitude it was given");
      assert.ok(Math.abs(packed.a[i * 4 + 3] - h.radius) < 1e-6);
      // the angle travels as its own cosine and sine, so the shader never
      // calls a trig function on a number it did not receive
      assert.ok(Math.abs(packed.b[i * 4 + 0] - Math.cos(h.angle)) < 1e-6, "turned the way it was turned");
      assert.ok(Math.abs(packed.b[i * 4 + 1] - Math.sin(h.angle)) < 1e-6);
      assert.ok(Math.abs(packed.b[i * 4 + 2] - h.aniso) < 1e-6);
      assert.ok(
        Math.abs(Math.hypot(packed.b[i * 4 + 0], packed.b[i * 4 + 1]) - 1) < 1e-6,
        "and the pair really is a rotation",
      );
    }
  }
  // The offset is the whole of what a seed means to the field, and it is a
  // uniform for the same reason.
  assert.deepEqual(F.seedOffset(0x0a1a), F.seedOffset(0x0a1a), "the seed's offset is a fact about the seed");
}

console.log(
  "heightfield ok: analytic ∂h agreeing with finite differences off the creases over 4 seeds, horn ∂h smooth and path-integrable, horns deterministic on the ring with separation, the ridge fold C⁰ but not C¹, the range bounded including horns so the marcher's ceiling exit is sound, cornice lee/windward asymmetry and glacier material classification, fog optical depth matching both hand-computable cases and monotone in path length, raising the fog only ever drowning more land, 64 steps never exceeded with a vertical hit landing where the height says, the sun palette continuous and never darkening as it climbs, every echo bounded in time, and the GLSL mirror fed only by injected constants and a pre-placed horn table",
);
