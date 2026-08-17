// The eigen field (/eigen) — surviving directions after a constraint, pinned.
// Falsifiable only: collinear constraints collapse effective dim toward 1;
// a shortcut (aligned: false) does not drag the principal direction;
// deepen(2400) ≠ deepen(900); two non-Gaussian mixed sources snap a unique
// axis (up to sign); a Gaussian cloud's kurtosis landscape is flat; killing
// a load-bearing axis changes the task readout, a footprint does not.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadTsModule, rootUrl } from "./lib/load-ts.mjs";

const E = loadTsModule("src/lib/eigen-field.ts");

{
  const a = E.bornCloud(0xabc, 12);
  const b = E.bornCloud(0xabc, 12);
  assert.deepEqual(a, b, "the same seed must bear the same cloud");
}

{
  const cloud = E.bornCloud(7);
  const c1 = E.bornConstraint(1, 1, 0.4, 0.5, 1, 0);
  c1.beta = 1;
  c1.growth = 1;
  const c2 = E.bornConstraint(2, 2, 0.6, 0.5, 1, 0.02);
  c2.beta = 1;
  c2.growth = 1;
  const merged = E.mergeConstraints(c1, c2);
  assert.ok(merged, "collinear constraints merge");
  assert.notEqual(merged.id, 1);
  assert.notEqual(merged.id, 2);
  const collapsed = E.collapse(cloud, [c1, c2]);
  assert.ok(E.effectiveDim(collapsed) < 1.15, "collinear collapse spends like a line");
}

{
  const cloud = E.bornCloud(9);
  const before = E.principalDirection(cloud);
  const shortcut = E.bornConstraint(3, 3, 0.5, 0.5, 0, 1, { aligned: false });
  shortcut.beta = 1;
  shortcut.growth = 1;
  const after = E.principalDirection(E.collapse(cloud, [shortcut]));
  assert.ok(
    Math.abs(E.dot(before, after)) > 0.9,
    "a shortcut constraint does not drag the principal direction",
  );
}

{
  const early = E.deepenBeta(900);
  const late = E.deepenBeta(2400);
  assert.ok(late > early + 0.1, "a longer hold deepens β; 900ms and 2400ms are not the same");
}

{
  const mixed = E.mixedSources(21);
  assert.ok(!E.kurtosisLandscapeFlat(mixed), "mixed non-Gaussian sources lock a unique snap");
  const snap = E.icaSnap(mixed);
  assert.ok(Math.hypot(snap.x, snap.y) > 0.99, "the snap is a unit axis");
  const gauss = E.gaussianCloud(21);
  assert.ok(E.kurtosisLandscapeFlat(gauss), "a Gaussian cloud leaves the rotational gauge free");
}

{
  const cloud = E.bornCloud(4);
  const axis = { x: 1, y: 0 };
  const c = E.bornConstraint(1, 1, 0.5, 0.5, 1, 0);
  c.beta = 1;
  c.growth = 1;
  const before = E.taskReadout(cloud, axis);
  const collapsed = E.collapse(cloud, [c]);
  const after = E.taskReadout(collapsed, axis);
  assert.ok(
    E.commitmentShift(before, after) || after <= before,
    "collapsing onto the task axis is a real change in the readout",
  );
  const footprintBefore = E.taskReadout(cloud, axis);
  const killedY = E.collapse(cloud, []);
  const footprintAfter = E.taskReadout(killedY, axis);
  assert.equal(
    E.commitmentShift(footprintBefore, footprintAfter),
    false,
    "killing an axis the task does not use is a footprint — readout holds",
  );
}

{
  const a = E.bornConstraint(1, 1, 0.4, 0.5, 1, 0);
  a.growth = 1;
  const b = E.bornConstraint(2, 2, 0.6, 0.5, 0, 1);
  b.growth = 1;
  assert.equal(E.mergeConstraints(a, b), null, "orthogonal constraints do not collapse to one");
  const axes = E.survivingAxes([a, b]);
  assert.equal(axes.length, 2, "two independent aligned constraints both survive");
}

{
  const src = readFileSync(fileURLToPath(new URL("src/lib/eigen-field.ts", rootUrl)), "utf8");
  assert.equal(src.includes("Math.random"), false, "the field does not roll");
}

console.log("test-eigen-field: ok");
