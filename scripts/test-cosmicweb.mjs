// The /space laws. Every assertion below names the bug it would catch.
//
// The room's whole claim is that the visible sky is a READOUT of an
// invisible field — so the load-bearing tests are the ones that check that
// rather than assert it: galaxies recomputed from scratch against the
// field, the candidates that were *rejected* recomputed too (the harder
// half), the fog's grid proved identical cell-by-cell to the field the
// galaxies were placed from, and the density→sub-bass map checked against
// the register src/lib/scale.ts independently assigns s = 20.

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

const C = loadTsModule("src/lib/cosmicweb.ts");
// The scale axis, loaded independently: this room must not invent a
// register, and nothing but a real cross-check can prove it did not.
const S = loadTsModule("src/lib/scale.ts");

const seeds = [0x5eed, 1, 42, 0xbeef, 0xc0ffee, 777, 2024, 0x1a2b3c];
const webs = seeds.map((s) => C.buildWeb(s));

// —— one seed is one universe ——————————————————————————————————
// The bug: any dice rolled at build time (Math.random, a Date, an
// unstable sort) — the room would be a different sky every visit and the
// law it lives by would be gone.
{
  const a = C.buildWeb(0x5eed);
  const b = C.buildWeb(0x5eed);
  assert.deepEqual(a, b, "the same seed builds the same skeleton, bit for bit");
  assert.deepEqual(
    C.placeGalaxies(a, 0x5eed),
    C.placeGalaxies(b, 0x5eed),
    "...and therefore the same galaxies, in the same order",
  );
  assert.deepEqual(
    Array.from(C.buildDensityGrid(a, 16)),
    Array.from(C.buildDensityGrid(b, 16)),
    "...and the same dark matter under them",
  );
  // and different seeds are genuinely different universes, not the same
  // one re-lit: a seed that changes nothing would be a dead parameter.
  const other = C.buildWeb(0x5eee);
  assert.notDeepEqual(a.knots, other.knots, "a different seed is a different universe");
  const ga = C.placeGalaxies(a, 0x5eed);
  const gb = C.placeGalaxies(other, 0x5eee);
  assert.notEqual(ga.length, 0);
  assert.notDeepEqual(
    ga.map((g) => [g.x, g.y]),
    gb.map((g) => [g.x, g.y]),
    "two universes do not hang their galaxies in the same places",
  );
}

// —— the kernel has compact support ————————————————————————————
// The bug: a kernel with a tail. Voids would fill with a faint everything,
// the AABB rejections below would silently drop real contributions, and
// the field would stop being a field of *structures*.
{
  const r = 0.045;
  assert.equal(C.kernel(0, r), 1, "a kernel is 1 at its centre");
  assert.equal(C.kernel(r, r), 0, "and exactly 0 at its radius");
  assert.equal(C.kernel(r * 4, r), 0, "and stays exactly 0 beyond it — a void is empty");
  assert.equal(C.kernel(-1, r), 1, "a negative distance cannot exceed the centre");
  // the one value computable by hand: at half the radius t = 1/2 and
  // smoothstep gives 0.25·(3 − 1) = 0.5, exactly.
  assert.ok(Math.abs(C.kernel(r / 2, r) - 0.5) < 1e-15, "smoothstep at half radius is exactly 1/2");
  let prev = 1.0000001;
  for (let i = 0; i <= 400; i++) {
    const v = C.kernel((i / 400) * r * 1.3, r);
    assert.ok(v <= prev + 1e-12, "the kernel never rises as you walk away");
    assert.ok(v >= 0 && v <= 1, "and never leaves 0..1");
    prev = v;
  }
}

// —— distance to a SEGMENT, not to its line ————————————————————
// The calibration case, verifiable by hand. The bug this catches is the
// classic one: forgetting to clamp the projection parameter, after which
// every filament reads as infinitely long and the voids past the web's
// ends quietly fill with galaxies.
{
  const seg = [0, 0, 0, 1, 0, 0];
  assert.ok(
    Math.abs(C.segmentDistance(0.5, 0.3, 0.4, ...seg) - 0.5) < 1e-15,
    "a perpendicular foot inside the segment gives hypot(0.3, 0.4) = 0.5",
  );
  assert.equal(C.segmentDistance(2, 0, 0, ...seg), 1, "a point past the end is 1 away from the END, not 0 from the line");
  assert.equal(C.segmentDistance(-1, 0, 0, ...seg), 1, "and the same before the start");
  assert.ok(
    Math.abs(C.segmentDistance(2, 3, 0, ...seg) - Math.sqrt(1 + 9)) < 1e-12,
    "past the end, the distance is to the endpoint, in full 3D",
  );
  assert.equal(C.segmentDistance(0, 0, 0, ...seg), 0, "a point on the segment is on it");
  // a degenerate filament is a point, not a division by zero
  assert.equal(C.segmentDistance(0, 3, 4, 1, 1, 1, 1, 1, 1), Math.sqrt(1 + 4 + 9));
  // and the distance cannot depend on which end you named first
  for (const p of [[0.2, 0.4, 0.1], [1.6, -0.3, 0.9], [0.5, 0, 0]]) {
    assert.equal(
      C.segmentDistance(...p, ...seg),
      C.segmentDistance(...p, 1, 0, 0, 0, 0, 0),
      "a filament has no direction",
    );
  }
}

// —— the field is bounded, and empty where it should be ————————
{
  const web = webs[0];
  let min = 1;
  let max = 0;
  for (let i = 0; i < 4000; i++) {
    const rng = C.mulberry32(C.hashSeed(i, 0x11));
    const d = C.densityAt(web, rng(), rng(), rng());
    assert.ok(Number.isFinite(d), "the field is finite everywhere");
    if (d < min) min = d;
    if (d > max) max = d;
  }
  assert.ok(min >= 0, "density never goes negative");
  assert.ok(max < 1, "and saturation keeps it strictly under 1, however the knots pile up");
  assert.ok(max > 0.6, "and a cluster core is genuinely dense, not a rounding error");

  // The one case computable by hand: a single knot of unit mass, alone.
  const lone = { knots: [{ x: 0, y: 0, z: 0, m: 1 }], filaments: [] };
  const kw = C.KNOT_WEIGHT;
  assert.ok(
    Math.abs(C.densityAt(lone, 0, 0, 0) - kw / (1 + kw)) < 1e-14,
    "at a lone knot's centre the field is exactly w/(1+w)",
  );
  const half = kw * 0.5;
  assert.ok(
    Math.abs(C.densityAt(lone, C.KNOT_RADIUS / 2, 0, 0) - half / (1 + half)) < 1e-14,
    "at half its radius, exactly (w/2)/(1+w/2)",
  );
  assert.equal(C.densityAt(lone, C.KNOT_RADIUS, 0, 0), 0, "at its radius, exactly nothing");
  assert.equal(C.densityAt(lone, 0.9, 0.1, 0.2), 0, "a void is exactly empty, not nearly");
}

// —— the invisible strictly contains the visible ————————————————
// The room's argument, as a theorem rather than a mood. The halo is the
// same skeleton smoothed HALO_SCALE times wider, so it must be pointwise
// at least the luminous field and must be non-zero in places the luminous
// field is exactly nothing — otherwise the three-finger reveal shows the
// same shape twice and the room says nothing at all.
{
  const web = webs[0];
  assert.ok(C.HALO_SCALE > 1, "a halo larger than its light");
  let outside = 0;
  let inside = 0;
  const rng = C.mulberry32(0x4a10);
  for (let i = 0; i < 5000; i++) {
    const x = rng();
    const y = rng();
    const z = rng();
    const lit = C.densityAt(web, x, y, z);
    const halo = C.densityAt(web, x, y, z, C.HALO_SCALE);
    assert.ok(halo >= lit - 1e-12, "the dark matter is everywhere the light is, and at least as much");
    if (lit === 0 && halo > 0) outside += 1;
    if (lit > 0) inside += 1;
  }
  assert.ok(inside > 50, "the sample found the luminous web at all");
  assert.ok(
    outside > inside,
    `the halo reaches into far more of the box than the light does (${outside} vs ${inside})`,
  );
  // and it is genuinely a wider version of the same thing, not a new one:
  // at a filament's edge the light is exactly out and the halo is not
  {
    const [i, j] = web.filaments[0];
    const a = web.knots[i];
    const b = web.knots[j];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const mz = (a.z + b.z) / 2;
    const justOutside = C.FILAMENT_RADIUS * 1.4;
    assert.ok(
      C.densityAt(web, mx, my, mz + justOutside, C.HALO_SCALE) > 0,
      "a step past the filament's luminous edge is still deep inside its halo",
    );
  }
  // the two fields are the SAME function with one number changed
  assert.equal(
    C.densityAt(web, 0.31, 0.62, 0.44, 1),
    C.densityAt(web, 0.31, 0.62, 0.44),
    "scale 1 is the luminous field itself, not a special case",
  );
}

// —— the mean is stable, and sits below the threshold ——————————
// Two bugs: a retuned kernel drifting the field's mean (which would move
// the fixed point of the growth law below and quietly break it), and a
// mean that crosses DENSITY_THRESHOLD — after which winding the season
// FORWARD would start putting galaxies out, which is nonsense.
{
  for (const seed of seeds.slice(0, 6)) {
    const mean = C.meanDensity(C.buildDensityGrid(C.buildWeb(seed), 32));
    assert.ok(
      Math.abs(mean - C.WEB_MEAN_DENSITY) < 0.006,
      `the field's mean is a property of the law, not of the seed (${seed}: ${mean})`,
    );
  }
  assert.ok(
    C.WEB_MEAN_DENSITY < C.DENSITY_THRESHOLD,
    "the mean must sit below the threshold or growth could unlight a galaxy",
  );
}

// —— the fog and the galaxies read ONE field ————————————————————
// buildDensityGrid skips cells outside each kernel's bounding box. If a box
// were a hair too tight — the classic off-by-one, forgetting to grow it by
// the radius — filament edges would be shaved out of the volume and the
// dark matter you reveal would not be the dark matter the galaxies sit in.
// So: every cell of a real grid, against the field, exhaustively.
{
  const web = C.buildWeb(0xbeef);
  const n = 32;
  const grid = C.buildDensityGrid(web, n);
  assert.equal(grid.length, n * n * n, "a grid³ of cells");
  let worst = 0;
  let touched = 0;
  for (let iz = 0; iz < n; iz++) {
    for (let iy = 0; iy < n; iy++) {
      for (let ix = 0; ix < n; ix++) {
        const want = C.densityAt(
          web,
          C.gridCellCenter(ix, n),
          C.gridCellCenter(iy, n),
          C.gridCellCenter(iz, n),
        );
        const got = grid[(iz * n + iy) * n + ix];
        worst = Math.max(worst, Math.abs(got - want));
        if (want > 0) touched += 1;
      }
    }
  }
  // Float32Array storage is the only difference permitted.
  assert.ok(worst < 1e-6, `the grid IS the field, cell for cell (worst ${worst})`);
  // ...and so does the halo grid, at its own much larger radius, where a
  // bounding box that forgot to scale with the kernel would clip hardest
  {
    const hg = C.buildDensityGrid(web, 16, C.HALO_SCALE);
    let hw = 0;
    for (let iz = 0; iz < 16; iz++) {
      for (let iy = 0; iy < 16; iy++) {
        for (let ix = 0; ix < 16; ix++) {
          const want = C.densityAt(
            web,
            C.gridCellCenter(ix, 16),
            C.gridCellCenter(iy, 16),
            C.gridCellCenter(iz, 16),
            C.HALO_SCALE,
          );
          hw = Math.max(hw, Math.abs(hg[(iz * 16 + iy) * 16 + ix] - want));
        }
      }
    }
    assert.ok(hw < 1e-6, `the halo grid is the halo field too (worst ${hw})`);
  }
  assert.ok(touched > 1500, "and a real amount of the box is inside the web, not a stray cell or two");
  assert.ok(touched < n * n * n * 0.6, "...while most of the box is still void");
}

// —— the sky is a level set of the field ————————————————————————
{
  const seed = 0x5eed;
  const web = C.buildWeb(seed);
  const threshold = 0.34;
  const candidates = 420;
  const galaxies = C.placeGalaxies(web, seed, threshold, candidates, 100000);
  assert.ok(galaxies.length > 40, "a threshold this side of the mean lights a real population");

  // Every galaxy, recomputed from the field rather than trusted.
  for (const g of galaxies) {
    const d = C.densityAt(web, g.x, g.y, g.z);
    assert.equal(g.density, d, "a galaxy carries the density it was measured at");
    assert.ok(d > threshold, "and stands where the invisible field stands above the threshold");
  }

  // The harder half, and the one a decorative room would fail: replay the
  // candidate stream and check that everything REJECTED really was below.
  // The bug: a probabilistic accept (a Gaussian around the filaments, a
  // 1.5% floor in the voids) that scatters a few galaxies into the dark —
  // after which the sky is a story about the field, not a measurement.
  {
    const rng = C.mulberry32(C.hashSeed(seed, 0x6a1a));
    const kept = new Set(galaxies.map((g) => g.id));
    let rejected = 0;
    for (let i = 0; i < candidates; i++) {
      const p = C.candidateAt(web, rng);
      const d = C.densityAt(web, p.x, p.y, p.z);
      if (kept.has(i)) {
        assert.equal(d, galaxies.find((g) => g.id === i).density, "the kept candidate is this point");
      } else {
        assert.ok(d <= threshold, `candidate ${i} was left dark, so the void there is genuinely void`);
        rejected += 1;
      }
    }
    assert.ok(rejected > 0, "the threshold really does turn candidates away");
  }

  // ...and the field itself, sampled without any bias toward the web: most
  // of the box is genuinely void. The bug: kernels wide enough (or a
  // threshold low enough) that the sky is a haze with clumps rather than a
  // web with voids you can fall into.
  {
    const rng = C.mulberry32(0xbaff1e);
    let over = 0;
    const N = 6000;
    for (let i = 0; i < N; i++) {
      if (C.densityAt(web, rng(), rng(), rng()) > threshold) over += 1;
    }
    assert.ok(over / N < 0.12, `the lit part of the box is a small part of it (${over / N})`);
    assert.ok(over > 0, "and not an empty one");
  }

  // Count falls with the threshold and never rises, and — because the
  // candidate order does not depend on the threshold — it falls exactly
  // one galaxy at a time, so the threshold→count map has no gaps. The bug
  // this catches: a placement whose candidate stream is reseeded per
  // threshold, which would make the sky jump discontinuously as the season
  // turns instead of dimming.
  {
    let prev = Infinity;
    for (let k = 0; k <= 40; k++) {
      const th = 0.2 + (k / 40) * 0.7;
      const n = C.placeGalaxies(web, seed, th, candidates, 100000).length;
      assert.ok(n <= prev, "a higher threshold never lights more galaxies");
      prev = n;
    }
    const densities = galaxies.map((g) => g.density).sort((a, b) => a - b);
    const reachable = new Set();
    for (let i = 0; i < densities.length; i++) {
      // just above the i-th smallest density: exactly the ones above it survive
      const th = densities[i];
      reachable.add(C.placeGalaxies(web, seed, th, candidates, 100000).length);
    }
    for (let want = 0; want < densities.length; want++) {
      assert.ok(reachable.has(want), `count ${want} is reachable — the map has no gaps`);
    }
  }

  // The population cap holds, and holds by keeping the FIRST candidates,
  // so it is a cap and not a resample.
  {
    const capped = C.placeGalaxies(web, seed, threshold, candidates, 25);
    assert.equal(capped.length, 25, "the population never grows past its cap");
    assert.deepEqual(capped, galaxies.slice(0, 25), "and the cap retires the newest, not the oldest");
    assert.ok(
      C.placeGalaxies(web, seed).length <= C.MAX_GALAXIES,
      "the room's own population stays inside its budget",
    );
  }
}

// —— morphology is a readout too ————————————————————————————————
{
  // pure, and pure in both arguments
  for (const d of [0.25, 0.4, 0.55, 0.9]) {
    for (const u of [0, 0.13, 0.5, 0.87, 0.999]) {
      assert.equal(C.morphologyOf(d, u), C.morphologyOf(d, u), "a latent names one shape");
    }
  }
  // all three classes are actually reachable — a classifier that can only
  // ever say "spiral" would be decoration with a switch statement in it
  const seen = new Set();
  for (let i = 0; i <= 60; i++) {
    for (let j = 0; j <= 60; j++) {
      seen.add(C.morphologyOf(0.2 + (i / 60) * 0.75, j / 60));
    }
  }
  assert.deepEqual([...seen].sort(), ["elliptical", "irregular", "spiral"], "all three shapes happen");

  // The relation itself, which is what makes the shape a readout of the
  // invisible field rather than a second die roll. The bug: a classifier
  // that ignores density — after which ellipticals appear out in the void
  // edges, where nothing ever had time to merge.
  for (let j = 0; j < 200; j++) {
    // the roll is a half-open 0..1, exactly as mulberry32 delivers it
    const u = j / 200;
    assert.notEqual(
      C.morphologyOf(C.ELLIPTICAL_FLOOR - 1e-9, u),
      "elliptical",
      "no elliptical is ever born below the cluster floor",
    );
    assert.notEqual(
      C.morphologyOf(C.IRREGULAR_CEIL, u),
      "irregular",
      "and no irregular survives at the density where settling begins",
    );
    assert.equal(C.morphologyOf(C.ELLIPTICAL_FULL, u), "elliptical", "a cluster core is all ellipticals");
    assert.equal(C.morphologyOf(C.IRREGULAR_FULL, u), "irregular", "and the far void edge is all irregulars");
  }
  // at any density the latent walks through the classes in one fixed order,
  // so the three weights partition the roll instead of overlapping
  for (const d of [0.3, 0.42, 0.5, 0.6, 0.7]) {
    let transitions = 0;
    let last = null;
    for (let j = 0; j <= 500; j++) {
      const m = C.morphologyOf(d, j / 500);
      if (last !== null && m !== last) transitions += 1;
      last = m;
    }
    assert.ok(transitions <= 2, `the latent partitions cleanly at density ${d} (${transitions} changes)`);
  }
  // and a galaxy's latent is a property of its place in its universe
  assert.deepEqual(C.galaxyLatent(9, 41), C.galaxyLatent(9, 41), "one galaxy, one latent");
  assert.notDeepEqual(C.galaxyLatent(9, 41), C.galaxyLatent(9, 42), "neighbours are not twins");
  for (let i = 0; i < 200; i++) {
    const l = C.galaxyLatent(0x5eed, i);
    assert.ok(l.arms >= 2 && l.arms <= 4, "arms stay in the range the shader can draw");
    assert.ok(l.tilt >= 0 && l.tilt <= 1 && l.size >= 0 && l.size <= 1);
    assert.ok(l.spin >= 0 && l.spin < Math.PI * 2 + 1e-9);
  }
}

// —— the season: linear growth about the field's own mean ————————
{
  assert.equal(C.grownDensity(0.7, 1), 0.7, "now is now — growth 1 is the identity");
  for (const g of [0, 0.3, 1, 1.75, 9]) {
    assert.ok(
      Math.abs(C.grownDensity(C.WEB_MEAN_DENSITY, g) - C.WEB_MEAN_DENSITY) < 1e-12,
      "the mean is the fixed point of the growth law, in every season",
    );
  }
  for (const g of [0.2, 0.6, 1, 1.5]) {
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const v = C.grownDensity(i / 100, g);
      assert.ok(v >= prev, "a denser place is never made thinner than a thinner one");
      assert.ok(v >= 0 && v <= 1, "and the season never leaves 0..1");
      prev = v;
    }
  }
  const web = C.buildWeb(0x5eed);
  const galaxies = C.placeGalaxies(web, 0x5eed);
  // The law that makes the season legible: winding time forward can only
  // ever light more of the sky. It holds *because* the mean sits below the
  // threshold — the bug it catches is a growth law centred anywhere else,
  // which would put galaxies out as the universe ages.
  let prev = -1;
  for (let k = 0; k <= 32; k++) {
    const g = C.GROWTH_MIN + (k / 32) * (C.GROWTH_MAX - C.GROWTH_MIN);
    const lit = C.litCount(galaxies, g);
    assert.ok(lit >= prev, `the sky only ever fills as the season runs forward (${g})`);
    prev = lit;
  }
  assert.equal(C.litCount(galaxies, C.GROWTH_MIN), 0, "the early universe is dark matter and no galaxies");
  assert.ok(C.litCount(galaxies, 1) > 200, "and today it is a full sky");
  assert.ok(
    C.litCount(galaxies, C.GROWTH_MAX) <= galaxies.length,
    "a season cannot light a galaxy the field never placed",
  );
}

// —— the field, heard: this room does not invent a register ————————
{
  const reg = S.spectralRegisterFor(C.WEB_SCALE_S);
  assert.ok(
    Math.abs(C.subBassHzFor(0.5) - reg.baseHz) < 1e-9,
    `the median of the field sounds the note the axis assigns s=${C.WEB_SCALE_S} (${reg.baseHz} Hz)`,
  );
  assert.ok(
    Math.abs(C.WEB_LFO_HZ - reg.lfoHz) < 1e-12,
    "and breathes at the rate the axis assigns it — a re-cut axis must break this, loudly",
  );
  assert.ok(1 / C.WEB_LFO_HZ > 40, "one breath here is most of a minute, as the plan says");
  const band = S.SCALE_BANDS.find((b) => b.id === "space");
  assert.ok(band, "the space band exists");
  assert.ok(
    C.WEB_SCALE_S >= band.sMin && C.WEB_SCALE_S < band.sMax,
    "and the room listens from inside its own band",
  );
  assert.equal(band.route, "/space", "the band's route is this room");

  // strictly decreasing — a heavier well rings lower, everywhere, always
  let prev = Infinity;
  for (let i = 0; i <= 1000; i++) {
    const hz = C.subBassHzFor(i / 1000);
    assert.ok(hz < prev, "a denser place always sounds lower than a thinner one");
    assert.ok(hz >= C.SUB_BASS_MIN_HZ - 1e-9 && hz <= C.SUB_BASS_MAX_HZ + 1e-9, "and inside the band's range");
    prev = hz;
  }
  assert.ok(C.SUB_BASS_MIN_HZ > C.AUDIBLE_FLOOR_HZ, "nothing here falls below the ear's floor");
  assert.ok(C.SUB_BASS_MAX_HZ < 120, "and nothing here climbs out of the sub-bass");
  // clamped outside 0..1 rather than running away
  assert.equal(C.subBassHzFor(-5), C.subBassHzFor(0));
  assert.equal(C.subBassHzFor(5), C.subBassHzFor(1));
  assert.ok(Math.abs(C.subBassMidiFor(0.5) - 33) < 1e-9, "the median is midi 33 — A1, exactly");
}

// —— novae: deterministic, and genuinely rare ————————————————————
{
  const seed = 0x5eed;
  const pop = 400;
  assert.deepEqual(C.novaAt(seed, 1234, pop), C.novaAt(seed, 1234, pop), "one second, one nova");
  // The bug: a nova rolled from the wall clock or Math.random, which would
  // make the room's rarest event un-reproducible and un-shareable.
  let fires = 0;
  const TICKS = 120000;
  for (let k = 0; k < TICKS; k++) {
    const n = C.novaAt(seed, k, pop);
    if (!n) continue;
    fires += 1;
    assert.ok(n.galaxy >= 0 && n.galaxy < pop, "a nova always lands on a real galaxy");
    assert.ok(n.strength > 0.5 && n.strength <= 1, "and burns with a real strength");
  }
  const rate = fires / TICKS;
  assert.ok(
    Math.abs(rate - C.NOVA_RATE) < C.NOVA_RATE * 0.06,
    `the nova rate is the rate it declares (${rate} vs ${C.NOVA_RATE})`,
  );
  // ...and that rate is rare in the units a visitor actually feels
  const perMinute = rate * (60 / C.NOVA_TICK_SEC);
  assert.ok(perMinute > 0.5 && perMinute < 2.5, `about one nova a minute, not a firework show (${perMinute})`);
  assert.equal(C.novaAt(seed, 5, 0), null, "an empty sky cannot nova");

  // the burning window is bounded and honest about its own age
  for (const t of [0, 3.4, 61.7, 400.25, 3600]) {
    const live = C.activeNovae(seed, t, pop);
    assert.ok(live.length <= C.NOVA_SCAN_TICKS, "only so many can be alight at once");
    for (const n of live) {
      assert.ok(n.age >= 0 && n.age <= C.NOVA_LIFE_SEC, "a live nova is inside its life");
      const tick = C.novaTickAt(t - n.age);
      assert.deepEqual(
        C.novaAt(seed, tick, pop).galaxy,
        n.galaxy,
        "every live nova traces back to the tick that struck it",
      );
    }
  }
  // over ten minutes the count is small — countable by a visitor, which is
  // what "rare but real" has to mean
  let seenIds = 0;
  for (let k = 0; k < 600 / C.NOVA_TICK_SEC; k++) if (C.novaAt(seed, k, pop)) seenIds += 1;
  assert.ok(seenIds > 4 && seenIds < 30, `ten minutes holds a handful of novae (${seenIds})`);

  // brightness rises then falls and ends at exactly nothing
  assert.equal(C.novaBrightness(-0.1, 1), 0, "a nova is dark before it happens");
  assert.equal(C.novaBrightness(C.NOVA_LIFE_SEC + 0.01, 1), 0, "and dark after it is done");
  assert.ok(Math.abs(C.novaBrightness(C.NOVA_LIFE_SEC, 1)) < 1e-12, "fading exactly to zero, never cut off");
  let peak = 0;
  let peakAt = 0;
  for (let i = 0; i <= 400; i++) {
    const age = (i / 400) * C.NOVA_LIFE_SEC;
    const b = C.novaBrightness(age, 1);
    assert.ok(b >= 0 && b <= 1, "brightness stays in range");
    if (b > peak) {
      peak = b;
      peakAt = age;
    }
  }
  assert.ok(peak > 0.7, "a nova is actually bright");
  assert.ok(peakAt < C.NOVA_LIFE_SEC * 0.2, "it flares fast and fades slow, the way one does");
  assert.ok(
    C.novaBrightness(1, 0.6) < C.novaBrightness(1, 1),
    "and a stronger nova is a brighter one at the same age",
  );
}

console.log(
  "cosmicweb ok: one seed one universe; the volume grid proved identical to the field cell by cell; " +
    "every galaxy above the threshold and every rejected candidate below it; the threshold→count map " +
    "monotone and gapless; morphology a real readout of density with all three classes reachable; " +
    "growth monotone about the field's own mean; density→sub-bass strictly falling and landing on the " +
    "55 Hz register src/lib/scale.ts assigns s=20; novae deterministic at about one a minute",
);
