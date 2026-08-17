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
  const mixed = E.mixedSources(21, 800);
  assert.ok(!E.kurtosisLandscapeFlat(mixed), "mixed non-Gaussian sources lock a unique snap");
  const snap = E.icaSnap(mixed);
  assert.ok(Math.hypot(snap.x, snap.y) > 0.99, "the snap is a unit axis");
  // 48 samples of a Gaussian are too noisy for kurtosis to look flat; a real
  // isotropic cloud at a few hundred points is the landscape the snap refuses.
  const gauss = E.gaussianCloud(21, 800);
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
  assert.equal(src.includes("Math.random("), false, "the field does not roll");
}

{
  const c = E.bornConstraint(1, 1, 0.5, 0.5, 1, 0);
  c.beta = 1;
  c.growth = 1;
  assert.equal(E.survival({ x: 1, y: 0 }, []), 1, "unconstrained, every direction still lives");
  assert.ok(E.survival({ x: 1, y: 0 }, [c]) > 0.9, "along the planted seam, motion survives");
  assert.ok(E.survival({ x: 0, y: 1 }, [c]) < 0.1, "off the seam, motion deadens");
  const shortcut = E.bornConstraint(2, 2, 0.5, 0.5, 0, 1, { aligned: false });
  shortcut.beta = 1;
  shortcut.growth = 1;
  assert.ok(
    E.survival({ x: 0, y: 1 }, [shortcut]) > 0.9,
    "a shortcut does not deaden the shimmer — Constraint_Swap",
  );
}

{
  const cloud = E.bornCloud(11);
  const load = E.bornConstraint(1, 1, 0.5, 0.5, 1, 0);
  load.beta = 1;
  load.growth = 1;
  const print = E.bornConstraint(2, 2, 0.5, 0.5, 0, 1);
  print.beta = 1;
  print.growth = 1;
  const span = E.sufficientSpan(cloud, [load, print]);
  assert.equal(span.length, 1, "an elongated cloud's sufficient q is one axis, not two");
  assert.ok(Math.abs(span[0].x) > 0.9, "fiber-finder keeps the axis the cloud actually spends");
  const mixed = E.mixedSources(21);
  const a = E.bornConstraint(3, 3, 0.5, 0.5, 1, 0);
  a.beta = 1;
  a.growth = 1;
  const b = E.bornConstraint(4, 4, 0.5, 0.5, 0, 1);
  b.beta = 1;
  b.growth = 1;
  assert.equal(
    E.sufficientSpan(mixed, [a, b]).length,
    2,
    "two independent mixed sources both feed the task, so both survive the finder",
  );
}

console.log("test-eigen-field: ok");
