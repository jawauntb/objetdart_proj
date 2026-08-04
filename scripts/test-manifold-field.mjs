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
  // Same realm as the test: vm.runInNewContext builds arrays, objects and
  // strings on a foreign prototype chain, so deepStrictEqual rejects them
  // against host literals of identical content.
  new Function("module", "exports", code)(module, module.exports);
  return module.exports;
}

const {
  SOFTENING,
  accelAt,
  wellDepth,
  timeDilation,
  geodesicStep,
  seededRandom,
  buildCosmicWeb,
  distanceToWeb,
  placeMotes,
  scaleFactor,
  HUBBLE_H0,
  HUBBLE_TIDE_DEPTH,
  boundFraction,
  expandPoint,
  foldRadius,
  foldPoint,
  FOLD_U_MAX,
  RIM_STEER_START,
  rimSteerRay,
} = loadTsModule("src/lib/manifold-field.ts");

const C = 600; // px/s, arbitrary but fixed
const G = 50 * C * C; // ~1 rad of deflection at 100px impact parameter

function runRay(masses, ray, steps, dt = 1 / 240) {
  const path = [ray];
  let r = ray;
  for (let i = 0; i < steps; i++) {
    r = geodesicStep(masses, r, dt, C, G, SOFTENING);
    path.push(r);
  }
  return path;
}

// — Flat metric: with no masses a geodesic is a straight line at speed c —
{
  const path = runRay([], { x: -300, y: 42.5, vx: C, vy: 0 }, 400);
  for (const p of path) {
    assert.ok(Math.abs(p.y - 42.5) < 1e-9, `flat geodesic stays straight (y drifted to ${p.y})`);
    assert.ok(
      Math.abs(Math.hypot(p.vx, p.vy) - C) < 1e-9 * C,
      "flat geodesic keeps speed c",
    );
  }
  const end = path[path.length - 1];
  assert.ok(end.x > -300, "the ray actually travels");
}

// — A mass bends a passing ray toward it (sign test) —
{
  const masses = [{ x: 0, y: 0, m: 1 }];
  // Ray passes ABOVE the mass (y = +240), heading +x: it must be pulled
  // DOWN (vy < 0 after the pass) and end below its entry height.
  const path = runRay(masses, { x: -500, y: 240, vx: C, vy: 0 }, 600);
  const end = path[path.length - 1];
  assert.ok(end.x > 300, "ray cleared the mass");
  assert.ok(end.vy < 0, `ray bent toward the mass (vy = ${end.vy})`);
  assert.ok(end.y < 240, `ray displaced toward the mass (y = ${end.y})`);
}

// — Deflection falls monotonically with impact parameter (weak-field range) —
{
  const masses = [{ x: 0, y: 0, m: 1 }];
  const angles = [240, 360, 480, 720].map((b) => {
    const path = runRay(masses, { x: -900, y: b, vx: C, vy: 0 }, 1400);
    const end = path[path.length - 1];
    return Math.abs(Math.atan2(end.vy, end.vx));
  });
  for (let i = 1; i < angles.length; i++) {
    assert.ok(
      angles[i] < angles[i - 1],
      `deflection monotone in impact parameter (${angles.map((a) => a.toFixed(4)).join(" > ")})`,
    );
  }
  assert.ok(angles[0] > 0.2, "a near pass bends visibly");
}

// — A close pass whips: strong-field slingshot turns the ray around —
{
  const masses = [{ x: 0, y: 0, m: 1 }];
  const path = runRay(masses, { x: -900, y: 110, vx: C, vy: 0 }, 1400);
  const end = path[path.length - 1];
  assert.ok(end.vx < 0, `a close pass slings the ray back the way it came (vx = ${end.vx})`);
}

// — Field bounded: extreme mass stacking mints no NaN/Inf, depth stays < 1 —
{
  const pile = Array.from({ length: 12 }, () => ({ x: 50, y: 50, m: 1e12 }));
  for (const [x, y] of [[50, 50], [50.1, 50], [51, 49], [-4000, 9000]]) {
    const a = accelAt(pile, x, y, G, SOFTENING);
    assert.ok(Number.isFinite(a.ax) && Number.isFinite(a.ay), "acceleration finite under stacking");
    const w = wellDepth(pile, x, y, SOFTENING);
    assert.ok(Number.isFinite(w) && w >= 0 && w < 1, `well depth saturates below 1 (got ${w})`);
    const f = timeDilation(pile, x, y, 3, SOFTENING);
    assert.ok(Number.isFinite(f) && f > 0 && f <= 1, `dilation stays in (0,1] (got ${f})`);
  }
  // A ray dropped through the pile keeps a finite state on every step.
  let r = { x: -200, y: 45, vx: C, vy: 0 };
  for (let i = 0; i < 500; i++) {
    r = geodesicStep(pile, r, 1 / 240, C, G, SOFTENING);
    assert.ok(
      [r.x, r.y, r.vx, r.vy].every(Number.isFinite),
      `ray state finite through extreme field at step ${i}`,
    );
  }
}

// — The speed limit: through a deep well, |v| = c after EVERY step. This is
//   the law the room teaches by racing a tapped pulse against the light;
//   both consume the same c, and this pins the ray half of that equality —
{
  const masses = [{ x: 0, y: 0, m: 2.4 }];
  let r = { x: -400, y: 34, vx: C, vy: 0 };
  for (let i = 0; i < 900; i++) {
    r = geodesicStep(masses, r, 1 / 240, C, G, SOFTENING);
    const sp = Math.hypot(r.vx, r.vy);
    assert.ok(
      Math.abs(sp - C) < 1e-9 * C,
      `light neither hurries nor slows in a well (step ${i}: |v| = ${sp})`,
    );
  }
}

// — Time dilation: deeper is slower, monotone in distance, 1 at infinity —
{
  const masses = [{ x: 0, y: 0, m: 1 }];
  const near = timeDilation(masses, 20, 0, 3, SOFTENING);
  const mid = timeDilation(masses, 90, 0, 3, SOFTENING);
  const far = timeDilation(masses, 400, 0, 3, SOFTENING);
  assert.ok(near < mid && mid < far, `clock slows toward the mass (${near} < ${mid} < ${far})`);
  assert.ok(far < 1 && far > 0.97, "far clock approaches proper rate");
  assert.equal(timeDilation([], 0, 0, 3, SOFTENING), 1, "flat spacetime keeps honest time");
}

// — Determinism: identical inputs give bitwise-identical trajectories —
{
  const masses = [
    { x: -40, y: 10, m: 0.8 },
    { x: 120, y: -60, m: 1.3 },
  ];
  const a = runRay(masses, { x: -600, y: 25, vx: C, vy: 12 }, 700);
  const b = runRay(masses, { x: -600, y: 25, vx: C, vy: 12 }, 700);
  for (let i = 0; i < a.length; i++) {
    assert.equal(a[i].x, b[i].x, `deterministic x at step ${i}`);
    assert.equal(a[i].y, b[i].y, `deterministic y at step ${i}`);
    assert.equal(a[i].vx, b[i].vx, `deterministic vx at step ${i}`);
    assert.equal(a[i].vy, b[i].vy, `deterministic vy at step ${i}`);
  }
}

// — Cosmic web determinism: same seed → identical nodes and filament
//   structure, bit for bit; a different seed actually changes the sky —
{
  const a = buildCosmicWeb(77, 900, 600, 40);
  const b = buildCosmicWeb(77, 900, 600, 40);
  assert.deepEqual(a.nodes, b.nodes, "same seed, same generator points");
  assert.deepEqual(a.links, b.links, "same seed, same filament links");
  const c = buildCosmicWeb(78, 900, 600, 40);
  assert.ok(
    c.nodes.some((n, i) => n.x !== a.nodes[i].x || n.y !== a.nodes[i].y),
    "a different seed grows a different web",
  );
  // structure sanity: links are real neighbor ridges, not a hairball
  const cell = Math.sqrt((900 * 600) / a.nodes.length);
  const seen = new Set();
  for (const [i, j] of a.links) {
    assert.ok(i < j && i >= 0 && j < a.nodes.length, "link indices ordered and in range");
    const key = i * a.nodes.length + j;
    assert.ok(!seen.has(key), "no duplicate filaments");
    seen.add(key);
    const len = Math.hypot(a.nodes[i].x - a.nodes[j].x, a.nodes[i].y - a.nodes[j].y);
    assert.ok(len > 0 && len < 3 * cell, `filaments join neighbors, not far strangers (${len})`);
  }
  const touched = new Set(a.links.flat());
  assert.equal(touched.size, a.nodes.length, "every node meets at least one filament");
}

// — Mote density contrast: motes cluster along filaments — their mean
//   filament distance beats a uniform baseline drawn from the same PRNG —
{
  const web = buildCosmicWeb(77, 900, 600, 40);
  const motes = placeMotes(web, 901, 220, 900, 600, 30);
  assert.ok(motes.length > 120, `mote placement actually lands motes (${motes.length})`);
  const meanD = (pts) =>
    pts.reduce((s, p) => s + distanceToWeb(web, p.x, p.y), 0) / pts.length;
  const rng = seededRandom(901);
  const uniform = Array.from({ length: motes.length }, () => ({
    x: rng() * 900,
    y: rng() * 600,
  }));
  const dm = meanD(motes);
  const du = meanD(uniform);
  assert.ok(
    dm < 0.7 * du,
    `motes hug the filaments: mean distance ${dm.toFixed(1)} vs uniform ${du.toFixed(1)}`,
  );
  // determinism here too
  assert.deepEqual(placeMotes(web, 901, 220, 900, 600, 30), motes, "same seed, same galaxies");
}

// — The Hubble breath: a(t) strictly increasing, a(0) = 1, and its growth
//   over any window bounded between the quiet and full-breath exponentials —
{
  assert.ok(Math.abs(scaleFactor(0) - 1) < 1e-12, "a(0) = 1");
  let prev = scaleFactor(0);
  for (let t = 0.5; t <= 400; t += 0.5) {
    const a = scaleFactor(t);
    assert.ok(Number.isFinite(a) && a > prev, `a(t) strictly increases (t = ${t})`);
    prev = a;
  }
  const win = 30;
  const hi = Math.exp(HUBBLE_H0 * (1 + HUBBLE_TIDE_DEPTH) * win) * (1 + 1e-9);
  const lo = Math.exp(HUBBLE_H0 * (1 - HUBBLE_TIDE_DEPTH) * win) * (1 - 1e-9);
  for (const t0 of [0, 7, 33, 111, 260]) {
    const g = scaleFactor(t0 + win) / scaleFactor(t0);
    assert.ok(g > 1 && g >= lo && g <= hi, `windowed growth bounded (t0 = ${t0}, g = ${g})`);
  }
}

// — Bound structures do not expand: a point inside a mass's binding
//   radius moves less under expansion than a matched point in a void —
{
  const masses = [{ x: 300, y: 0, m: 1 }];
  const stretch = 1.5;
  const held = { x: 320, y: 0 }; // 20px from the mass, radius 320 from center
  const free = { x: 0, y: 320 }; // same radius from center, empty sky
  const bh = boundFraction(masses, held.x, held.y);
  const bf = boundFraction(masses, free.x, free.y);
  assert.ok(bh > 0.75, `deep in the neighborhood the hold is near-total (${bh})`);
  assert.ok(bf < 0.2, `the void is free to stretch (${bf})`);
  const ph = expandPoint(held.x, held.y, 0, 0, stretch, bh);
  const pf = expandPoint(free.x, free.y, 0, 0, stretch, bf);
  const dh = Math.hypot(ph.x - held.x, ph.y - held.y);
  const df = Math.hypot(pf.x - free.x, pf.y - free.y);
  assert.ok(dh < df, `bound point drifts less than its void twin (${dh} < ${df})`);
  assert.ok(dh < 0.35 * df, "and not by a whisker — the neighborhood visibly keeps its shape");
  // no masses → nothing is bound, everything comoves
  assert.equal(boundFraction([], 100, 100), 0, "empty sky binds nothing");
}

// — The fold: identity near the center, monotone, compressive, closed —
{
  assert.ok(foldRadius(0.3) / 0.3 > 0.98, "the interior lies almost flat");
  let prevF = 0;
  for (let u = 0.05; u <= 6; u += 0.05) {
    const f = foldRadius(u);
    assert.ok(f > prevF, `fold is monotone (u = ${u})`);
    assert.ok(f <= u + 1e-12, `fold never pushes outward (u = ${u})`);
    assert.ok(f < FOLD_U_MAX, `everything stays inside the rim (f(${u}) = ${f})`);
    prevF = f;
  }
  const p = foldPoint(900, 0, 0, 0, 500, 400); // u = 1.8, far past the rim
  assert.ok(Math.abs(p.x) < 500 * FOLD_U_MAX && p.depth > 0.3, "a far point sinks into the rim");
  const q = foldPoint(50, 40, 0, 0, 500, 400);
  assert.ok(Math.hypot(q.x - 50, q.y - 40) < 1, "a near point barely feels it");
}

// — Rim rays: light that reaches the fold follows the curl back inward,
//   contained, at exactly c through every step —
{
  const rx = 500;
  const ry = 400;
  const dt = 1 / 240;
  let r = { x: rx * 0.95, y: 0, vx: C, vy: 0 }; // at the rim, aimed straight out
  let uMax = 0;
  let returned = false;
  for (let i = 0; i < 3600; i++) {
    r = geodesicStep([], r, dt, C, G, SOFTENING);
    r = rimSteerRay(r, 0, 0, rx, ry, dt, C);
    const sp = Math.hypot(r.vx, r.vy);
    assert.ok(Math.abs(sp - C) < 1e-9 * C, `|v| = c through the fold (step ${i}: ${sp})`);
    assert.ok([r.x, r.y].every(Number.isFinite), "rim ray stays finite");
    const u = Math.hypot(r.x / rx, r.y / ry);
    if (u > uMax) uMax = u;
    if (u < RIM_STEER_START - 0.05) returned = true;
  }
  assert.ok(uMax < FOLD_U_MAX + 0.35, `the rim contains the light (u peaked at ${uMax})`);
  assert.ok(returned, "the curl carries the ray back inward, not just around");
}

// ————— seasons of the law: four regimes, one speed limit —————
{
  const { seasonAccelAt, seasonGeodesicStep, LAW_SEASONS, EXPAND_BIND } = loadTsModule(
    "src/lib/manifold-field.ts",
  );
  const masses = [{ x: 200, y: 200, m: 2 }];
  const probe = { x: 320, y: 200 }; // due east of the well

  // repel is the exact negation of attract, everywhere sampled
  for (const [px, py] of [[320, 200], [140, 260], [500, 90]]) {
    const a = seasonAccelAt("attract", masses, px, py, 900);
    const r = seasonAccelAt("repel", masses, px, py, 900);
    assert.ok(
      Math.abs(a.ax + r.ax) < 1e-12 && Math.abs(a.ay + r.ay) < 1e-12,
      "repel mirrors attract exactly",
    );
  }

  // drag adds a purely tangential hand: the radial projection of the
  // season's extra acceleration is zero, the tangential part is not
  {
    const a = seasonAccelAt("attract", masses, probe.x, probe.y, 900);
    const d = seasonAccelAt("drag", masses, probe.x, probe.y, 900);
    const ex = d.ax - a.ax;
    const ey = d.ay - a.ay;
    const radial = (ex * (masses[0].x - probe.x) + ey * (masses[0].y - probe.y));
    assert.ok(Math.abs(radial) < 1e-9, "the swirl does not pull, only turns");
    assert.ok(Math.hypot(ex, ey) > 1e-6, "the swirl exists");
  }

  // and the swirl dies faster with distance than the pull does
  {
    const swirlAt = (dist) => {
      const a = seasonAccelAt("attract", masses, 200 + dist, 200, 900);
      const d = seasonAccelAt("drag", masses, 200 + dist, 200, 900);
      return Math.hypot(d.ax - a.ax, d.ay - a.ay);
    };
    const pullAt = (dist) => {
      const a = seasonAccelAt("attract", masses, 200 + dist, 200, 900);
      return Math.hypot(a.ax, a.ay);
    };
    const swirlRatio = swirlAt(240) / swirlAt(120);
    const pullRatio = pullAt(240) / pullAt(120);
    assert.ok(swirlRatio < pullRatio, "frame-dragging is a near-field hand");
  }

  // expand pushes outward from the anchor, harder farther away, and
  // thins the pull by exactly EXPAND_BIND when no hubble term is given
  {
    const near = seasonAccelAt("expand", [], 300, 250, 900, 26, 250, 250, 0.02);
    const far = seasonAccelAt("expand", [], 450, 250, 900, 26, 250, 250, 0.02);
    assert.ok(near.ax > 0 && far.ax > near.ax, "the recession grows with distance");
    const a = seasonAccelAt("attract", masses, probe.x, probe.y, 900);
    const e = seasonAccelAt("expand", masses, probe.x, probe.y, 900, 26, probe.x, probe.y, 0);
    assert.ok(
      Math.abs(e.ax - a.ax * EXPAND_BIND) < 1e-12,
      "expansion thins the pull to its bound fraction",
    );
  }

  // the speed limit is season-proof: after many steps under any law,
  // every ray still moves at exactly c, and a rest ray stays at rest
  for (const season of LAW_SEASONS) {
    let ray = { x: 60, y: 190, vx: 300, vy: 0 };
    for (let s = 0; s < 200; s++) {
      ray = seasonGeodesicStep(season, masses, ray, 1 / 120, 300, 900, 26, 250, 250, 0.02);
    }
    const sp = Math.hypot(ray.vx, ray.vy);
    assert.ok(Math.abs(sp - 300) < 1e-9, `light never hurries in the ${season} season`);
    const still = seasonGeodesicStep(season, [], { x: 90, y: 90, vx: 0, vy: 0 }, 1 / 120, 300, 900);
    assert.equal(Math.hypot(still.vx, still.vy), 0, "a rest ray on flat fabric stays at rest in every season");
  }
}

console.log(
  "manifold field ok: straight when flat, bent by mass, bounded, one speed of light — and now a seeded web, a breathing a(t), held neighborhoods, a closed fold, four seasons of the law under one speed limit",
);
