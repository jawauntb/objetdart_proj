/**
 * Center-field: the centroid of kicked particles must stay interior.
 * Catches the bug where a soft edge clamp becomes a resting well.
 */
import assert from "node:assert/strict";
import { loadTsModule } from "./lib/load-ts.mjs";

const { centerFieldForce, centerFieldStep } = loadTsModule("src/lib/scene/center-field.ts");

// At rest on the mid-point, force is zero — no jitter from the well alone.
{
  const f = centerFieldForce(0.5, 0.5);
  assert.ok(Math.abs(f.ax) < 1e-9 && Math.abs(f.ay) < 1e-9, "rest point is still");
}

// Near a rim, the cushion pushes inward — never outward.
{
  const left = centerFieldForce(0.02, 0.5);
  assert.ok(left.ax > 0, "left rim pushes right");
  const right = centerFieldForce(0.98, 0.5);
  assert.ok(right.ax < 0, "right rim pushes left");
  const top = centerFieldForce(0.5, 0.02);
  assert.ok(top.ay > 0, "top rim pushes down");
}

// Mid-band (inside the cushion margin) feels only the soft well.
{
  const f = centerFieldForce(0.35, 0.6, { well: 0.4, margin: 0.14 });
  assert.ok(f.ax > 0, "left of center is pulled right");
  assert.ok(f.ay < 0, "below center is pulled up");
}

// Under random kicks, the population centroid stays interior — the bug a
// 0.06/0.94 clamp causes is resting on the wall; this law forbids that.
{
  const N = 48;
  const particles = Array.from({ length: N }, (_, i) => ({
    nx: 0.15 + (i % 8) * 0.1,
    ny: 0.12 + Math.floor(i / 8) * 0.14,
  }));
  const dt = 1 / 60;
  for (let step = 0; step < 600; step++) {
    for (const p of particles) {
      // Impulsive kicks every ~20 frames, biased toward edges — the stress case.
      if (step % 20 === 0) {
        p.nx += ((step * 17 + particles.indexOf(p) * 13) % 11) / 11 > 0.5 ? 0.08 : -0.08;
        p.ny += ((step * 29 + particles.indexOf(p) * 7) % 11) / 11 > 0.5 ? 0.08 : -0.08;
      }
      const next = centerFieldStep(p.nx, p.ny, dt);
      p.nx = next.nx;
      p.ny = next.ny;
    }
  }
  const cx = particles.reduce((s, p) => s + p.nx, 0) / N;
  const cy = particles.reduce((s, p) => s + p.ny, 0) / N;
  assert.ok(cx > 0.28 && cx < 0.72, `centroid x stayed interior (got ${cx})`);
  assert.ok(cy > 0.28 && cy < 0.72, `centroid y stayed interior (got ${cy})`);
  const onRim = particles.filter((p) => p.nx < 0.08 || p.nx > 0.92 || p.ny < 0.08 || p.ny > 0.92);
  assert.ok(
    onRim.length < N * 0.15,
    `few particles rest on the rim (got ${onRim.length}/${N})`,
  );
}

console.log("center-field ok: rest is still, rims push in, centroid stays mid-frame under kicks");
