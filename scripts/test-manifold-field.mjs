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

const { SOFTENING, accelAt, wellDepth, timeDilation, geodesicStep } =
  loadTsModule("src/lib/manifold-field.ts");

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

console.log("manifold field ok: straight when flat, bent by mass, bounded, one speed of light");
