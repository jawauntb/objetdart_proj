// The group (/group) — inferred automorphisms of an incomplete orbit, pinned.
// Falsifiable only: identity always kept; a shift that does not preserve the
// seen fragment is rejected; completeOrbit adds only missing poses; fuse
// under a non-identity generator produces a third class that is neither
// parent; rotation∘flip is dihedral; a pose-scramble that is not a group
// element does not reach tau on a cyclic fragment.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadTsModule, rootUrl } from "./lib/load-ts.mjs";

const G = loadTsModule("src/lib/group-action.ts");

function fragment(classId, poses, seed = 11) {
  return poses.map((pose, i) => {
    const pt = G.ringPoint(pose, 0.5, 0.5);
    const m = G.bornMark(i + 1, G.hashSeed(seed, pose), pt.nx, pt.ny, classId, pose);
    m.growth = 1;
    return m;
  });
}

{
  const a = G.bornMark(1, 0xbeef, 0.4, 0.6, 7, 3);
  const b = G.bornMark(1, 0xbeef, 0.4, 0.6, 7, 3);
  assert.deepEqual(a, b, "the same seed must bear the same mark");
  assert.equal(G.hashSeed(1, 2, 3), G.hashSeed(1, 2, 3));
  assert.notEqual(G.hashSeed(1, 2, 3), G.hashSeed(3, 2, 1));
}

{
  const id = G.identity();
  const marks = fragment(1, [0, 2, 5]);
  assert.equal(G.propose(marks, 0, "rotate")?.k, 0, "identity is always kept");
  assert.ok(G.consistency(marks, id) > 0.99, "identity maps every mark to itself");
}

{
  const even = fragment(1, [0, 2, 4, 6]);
  const rot2 = G.propose(even, 2, "rotate");
  assert.ok(rot2, "a half-turn of an even fragment is an automorphism");
  assert.equal(rot2.k, 2);
  const rot1 = G.propose(even, 1, "rotate");
  assert.equal(rot1, null, "a shift that lands off the seen fragment is refused");
}

{
  const marks = fragment(1, [0, 2, 5]);
  assert.deepEqual(G.missingPoses(marks, 1), [1, 3, 4, 6, 7]);
  const filled = G.completeOrbit(marks, 1, 100);
  assert.equal(filled.length, 5, "completeOrbit adds only the missing seats");
  const poses = [...marks, ...filled].map((m) => m.pose).sort((a, b) => a - b);
  assert.deepEqual(poses, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.ok(filled.every((m) => m.classId === 1), "it never invents a class");
  const again = G.completeOrbit([...marks, ...filled], 1, 200);
  assert.equal(again.length, 0, "a complete orbit grows nothing");
}

{
  const a = fragment(10, [0, 2, 4, 6]);
  const b = fragment(20, [0, 2, 4, 6]).map((m) => ({ ...m, id: m.id + 10 }));
  const all = [...a, ...b];
  const g = G.propose(all, 2, "rotate");
  assert.ok(g);
  const fused = G.fuseOrbits(all, 10, 20, g);
  assert.ok(fused, "two even fragments that close under the same shift fuse");
  assert.notEqual(fused, 10);
  assert.notEqual(fused, 20);
  assert.ok(all.every((m) => m.classId === fused), "every mark joins the third class");
  assert.equal(G.fuseOrbits(all, fused, fused, g), null, "a class does not fuse with itself");
  assert.equal(G.fuseOrbits(a, 10, 20, G.identity()), null, "identity is not a fusion");
}

{
  const rot = { id: 1, k: 2, kind: "rotate" };
  const flip = { id: 2, k: 0, kind: "flip" };
  const p = G.compose(rot, flip);
  assert.equal(p.kind, "flip", "rotation meeting a flip is dihedral, not a louder cyclic");
  assert.ok(G.isDihedral(p));
  const twoRots = G.compose(rot, rot);
  assert.equal(twoRots.kind, "rotate");
  assert.equal(twoRots.k, 4);
}

{
  const cyclic = fragment(1, [0, 2, 4, 6]);
  const perm = G.scramblePerm();
  assert.ok(
    G.consistencyPerm(cyclic, perm) < G.MATCH_TAU,
    "a pose-scramble that is not a group element does not unlock the fragment",
  );
  assert.ok(G.consistency(cyclic, { id: 0, k: 2, kind: "rotate" }) >= G.MATCH_TAU);
}

{
  const even = fragment(1, [0, 2, 4, 6]);
  const kept = [{ id: 1, k: 2, kind: "rotate" }];
  const nxt = G.nextUnusedShift(even, kept);
  assert.ok(nxt, "another closing shift remains");
  assert.notEqual(nxt.k, 2);
}

{
  const src = readFileSync(fileURLToPath(new URL("src/lib/group-action.ts", rootUrl)), "utf8");
  assert.equal(src.includes("Math.random"), false, "the orbit law does not roll");
}

console.log("test-group-action: ok");
