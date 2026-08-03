// The /rocks laws. The bugs these catch: a "symmetry group" that is not a
// group, a cleavage plane that is not a lattice direction (which would make
// every fracture arbitrary), a fracture that creates or destroys stone, a
// habit that is not the intersection of its own faces, growth that depends
// on the frame rate or invents mass, and a timbre you could not read the
// crystal back out of — which is the room's whole claim.

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

const C = loadTsModule("src/lib/crystal.ts");
const key = (m) => m.join(",");
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg} (${a} vs ${b})`);

// —— the point groups are groups ————————————————————————————
// A "symmetry set" that is not closed would let a fracture leave the
// cleavage family, and then a split would follow no lattice plane at all.
for (const pg of Object.keys(C.EXPECTED_GROUP_ORDER)) {
  const ops = C.symmetryOps(pg);
  assert.equal(ops.length, C.EXPECTED_GROUP_ORDER[pg], `${pg} has its true order`);
  const set = new Set(ops.map(key));
  assert.ok(set.has(key([1, 0, 0, 0, 1, 0, 0, 0, 1])), `${pg} contains the identity`);
  for (const a of ops) {
    // every element is unimodular — a rotation, never a stretch
    assert.equal(Math.abs(C.det3(a)), 1, `${pg}: every operation preserves volume`);
    // inverses
    assert.ok(set.has(key(C.invUnimodular(a))), `${pg} is closed under inverses`);
    // closure
    for (const b of ops) {
      assert.ok(set.has(key(C.matMul(a, b))), `${pg} is closed under composition`);
    }
    // the crystallographic restriction: no 5-fold, no 7-fold, ever
    let order = 1;
    let p = a;
    while (key(p) !== key([1, 0, 0, 0, 1, 0, 0, 0, 1]) && order < 12) {
      p = C.matMul(p, a);
      order += 1;
    }
    assert.ok([1, 2, 3, 4, 6].includes(order), `${pg}: rotation orders are 1,2,3,4,6 only (got ${order})`);
  }
}

// —— and they are symmetries of THEIR OWN lattice ————————————
// The falsifiable half: a four-fold is a symmetry of a tetragonal lattice
// and is NOT one of an orthorhombic lattice with a ≠ b. If preservesMetric
// passed everything, the point groups would be decoration.
for (const id of C.SPECIES_IDS) {
  const s = C.SPECIES[id];
  for (const op of C.symmetryOps(s.pointGroup)) {
    assert.ok(C.preservesMetric(op, s.lattice), `${id}: ${key(op)} preserves its metric`);
  }
}
{
  const ortho = C.latticeOf("orthorhombic", "P", { ba: 1.9, ca: 1.4 });
  const fourFold = [0, -1, 0, 1, 0, 0, 0, 0, 1];
  assert.equal(
    C.preservesMetric(fourFold, ortho),
    false,
    "a four-fold is not a symmetry of a lattice whose a and b differ",
  );
  assert.equal(
    C.preservesMetric(fourFold, C.latticeOf("tetragonal", "P", { ca: 0.9 })),
    true,
    "...and is one of a tetragonal lattice",
  );
  const sixFold = [1, -1, 0, 1, 0, 0, 0, 0, 1];
  assert.equal(C.preservesMetric(sixFold, C.latticeOf("hexagonal", "P", { ca: 1.1 })), true);
  assert.equal(
    C.preservesMetric(sixFold, C.latticeOf("tetragonal", "P", { ca: 1.1 })),
    false,
    "a six-fold needs the 120° axes it was built for",
  );
}

// —— cleavage planes are lattice directions, and a family ————————
// The bug: a "cleavage" that is a screen-space line. If the orbit were not
// closed under the group, turning the stone would find planes the crystal
// does not have, and the same strike would not reproduce.
for (const id of C.SPECIES_IDS) {
  const s = C.SPECIES[id];
  const family = C.cleavagePlanes(id);
  const set = new Set(family.map(key));
  assert.ok(family.length >= 2, `${id}: a cleavage family has both sides at least`);
  for (const hkl of family) {
    for (const op of C.symmetryOps(s.pointGroup)) {
      assert.ok(set.has(key(C.transformPlane(op, hkl))), `${id}: the cleavage family is closed under its group`);
    }
    // every member is the same plane spacing — that is what "family" means
    near(
      C.dSpacing(s.lattice, hkl),
      C.dSpacing(s.lattice, s.cleavage),
      1e-9,
      `${id}: every plane in the form shares one spacing`,
    );
  }
  assert.deepEqual(C.cleavagePlanes(id), family, `${id}: the family is a deterministic list`);
}
// Hand-computable calibrations of the plane geometry itself.
{
  const cube = C.latticeOf("cubic", "P");
  assert.deepEqual(
    C.planeNormal(cube, [1, 0, 0]).map((x) => Math.round(x * 1e9) / 1e9 + 0),
    [1, 0, 0],
    "in a cubic lattice (100) points along a",
  );
  near(C.dSpacing(cube, [1, 1, 1]), 1 / Math.sqrt(3), 1e-12, "d(111) = a/√3 in a cube");
  near(C.dSpacing(cube, [2, 0, 0]), 0.5, 1e-12, "d(200) is half d(100)");
  // In hexagonal axes the a-planes stand 60° apart — the check that catches
  // a metric quietly built with 90° axes.
  const hex = C.latticeOf("hexagonal", "P", { ca: 1.1 });
  const n1 = C.planeNormal(hex, [1, 0, 0]);
  const n2 = C.planeNormal(hex, [0, 1, 0]);
  const cos = n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2];
  near((Math.acos(cos) * 180) / Math.PI, 60, 1e-9, "hexagonal a-planes meet at 60°");
  near(C.dSpacing(hex, [0, 0, 1]), 1.1, 1e-12, "d(001) is the c axis itself");
}

// —— the extinction rules are the real ones ——————————————————
// A centering that allowed everything would make halite and pyrite sound
// identical, and speciesFromRing would be a coin toss.
assert.equal(C.allowedReflection("P", [1, 0, 0]), true);
assert.equal(C.allowedReflection("F", [1, 0, 0]), false, "fcc kills (100)");
assert.equal(C.allowedReflection("F", [1, 1, 1]), true, "and keeps (111)");
assert.equal(C.allowedReflection("F", [2, 0, 0]), true);
assert.equal(C.allowedReflection("I", [1, 0, 0]), false, "bcc kills (100)");
assert.equal(C.allowedReflection("I", [1, 1, 0]), true);
assert.equal(C.allowedReflection("R", [1, 0, 4]), true, "the calcite rhomb is an allowed reflection");
assert.equal(C.allowedReflection("R", [1, 0, 0]), false);
assert.equal(C.allowedReflection("P", [0, 0, 0]), false, "the origin is not a reflection");

// —— the ring is the reciprocal lattice ————————————————————
// The calibration that is computable by hand: for a primitive cube the
// squared ratios are the integers expressible as h²+k²+l², so 7 is missing
// (no three squares sum to 7). Any enumeration bug — a wrong metric, a
// half-swept index range, a sloppy de-duplication — moves that gap.
{
  const cube = C.latticeOf("cubic", "P");
  const squares = C.ringRatios(cube, 8).map((r) => Math.round(r * r * 1e6) / 1e6);
  assert.deepEqual(squares, [1, 2, 3, 4, 5, 6, 8, 9], "a primitive cube's ring skips √7");
  const fcc = C.ringRatios(C.latticeOf("cubic", "F"), 4).map((r) => Math.round(r * r * 3 * 1e6) / 1e6);
  assert.deepEqual(fcc, [3, 4, 8, 11], "and a face-centred one starts at (111)");
}
for (const id of C.SPECIES_IDS) {
  const r = C.ringRatios(C.SPECIES[id].lattice, 8);
  assert.equal(r.length, 8, `${id}: eight partials`);
  assert.equal(r[0], 1, `${id}: the ring is normalised on its own fundamental`);
  for (let i = 1; i < r.length; i++) {
    assert.ok(r[i] > r[i - 1], `${id}: the ring climbs and never repeats`);
  }
  assert.ok(r[r.length - 1] < 6, `${id}: the ring stays inside a hearable span`);
}

// —— ...and it reads back ————————————————————————————————
// This is the room's central claim: the timbre carries the crystal. If the
// round trip fails, the sound is decoration and the band has no reason to
// exist.
for (const id of C.SPECIES_IDS) {
  const ratios = C.ringRatios(C.SPECIES[id].lattice, 8);
  assert.equal(C.speciesFromRing(ratios), id, `${id} is named by its own ring`);
  const read = C.readLattice(ratios);
  assert.ok(read, `${id}: some lattice is recovered from the ring alone`);
  assert.equal(read.system, C.SPECIES[id].lattice.system, `${id}: the crystal system is recovered`);
  assert.equal(read.centering, C.SPECIES[id].lattice.centering, `${id}: the centering is recovered`);
  if (C.SPECIES[id].lattice.system !== "orthorhombic") {
    // orthorhombic axes are interchangeable, so only its ratio SET is fixed
    near(read.ca, C.SPECIES[id].lattice.ca, 0.02, `${id}: the axial ratio is recovered`);
  } else {
    const want = [C.SPECIES[id].lattice.ba, C.SPECIES[id].lattice.ca].sort();
    const got = [read.ba, read.ca].sort();
    near(got[0], want[0], 0.02, `${id}: the axial ratios are recovered up to a relabelling`);
    near(got[1], want[1], 0.02, `${id}: the axial ratios are recovered up to a relabelling`);
  }
}
// The six rings are pairwise distinct — otherwise "name it from its ring"
// would be quietly choosing between minerals.
for (const a of C.SPECIES_IDS) {
  for (const b of C.SPECIES_IDS) {
    if (a === b) continue;
    const ra = C.ringRatios(C.SPECIES[a].lattice, 8);
    const rb = C.ringRatios(C.SPECIES[b].lattice, 8);
    let worst = 0;
    for (let i = 0; i < 8; i++) worst = Math.max(worst, Math.abs(ra[i] - rb[i]));
    assert.ok(worst > 0.02, `${a} and ${b} do not sound alike`);
  }
}
// Nothing is guessed: a ratio list no lattice produces names nothing.
assert.equal(C.speciesFromRing([1, 1.111, 1.222, 1.333]), null, "an invented ring names no mineral");
assert.equal(C.readLattice([1, 1.05, 1.09, 1.14, 1.19]), null, "...and recovers no lattice");
assert.equal(C.readLattice([1, 2]), null, "two lines are not a fingerprint");

// —— habit: the shape IS the lattice ————————————————————————
for (const id of C.SPECIES_IDS) {
  const mesh = C.habitMesh(id);
  near(C.meshVolume(mesh), 1, 1e-9, `${id}: the habit is normalised to unit volume`);
  assert.ok(mesh.faces.length >= 4, `${id}: a solid has at least four faces`);
  // Every face of the habit is a lattice plane of one of its forms: the
  // bug this catches is a hand-drawn shape wearing a crystal's name.
  const normals = [];
  for (const form of C.SPECIES[id].forms) {
    for (const hkl of C.planeOrbit(C.SPECIES[id].pointGroup, form.hkl)) {
      normals.push(C.planeNormal(C.SPECIES[id].lattice, hkl));
    }
  }
  for (const face of mesh.faces) {
    const n = C.faceNormal(mesh, face);
    let best = -Infinity;
    for (const m of normals) best = Math.max(best, n[0] * m[0] + n[1] * m[1] + n[2] * m[2]);
    assert.ok(best > 1 - 1e-6, `${id}: every face of the habit is a face of one of its forms`);
  }
  // ...and the whole solid closes: a leaky mesh reads as negative volume
  // somewhere and shades inside-out.
  assert.ok(C.meshVolume(mesh) > 0, `${id}: the habit is wound outward`);
}
assert.equal(C.habitMesh("halite").faces.length, 6, "salt grows a cube, because {100} is six planes");
assert.equal(C.habitMesh("calcite").faces.length, 6, "calcite grows the rhombohedron it cleaves into");
assert.ok(C.habitMesh("quartz").faces.length >= 18, "quartz grows a prism with both terminations");
assert.ok(C.elongationOf(C.habitMesh("quartz")) > 2, "and that prism is long");
near(C.elongationOf(C.habitMesh("halite")), 1, 1e-9, "while a cube is as tall as it is wide");

// —— a fracture conserves the stone —————————————————————————
// Hand-computable: a cube of side 2 has volume 8, and a cut through its
// centre leaves 4 on each side. Everything else about the split — caps,
// winding, the degenerate cuts through existing corners — is checked
// against that one number.
{
  const cube = {
    verts: [-1, -1, -1, 1, -1, -1, -1, 1, -1, 1, 1, -1, -1, -1, 1, 1, -1, 1, -1, 1, 1, 1, 1, 1],
    faces: [
      [1, 3, 7, 5],
      [0, 4, 6, 2],
      [2, 6, 7, 3],
      [0, 1, 5, 4],
      [4, 5, 7, 6],
      [0, 2, 3, 1],
    ],
  };
  assert.equal(C.meshVolume(cube), 8, "a cube of side two holds eight");
  const front = C.clipHalfspace(cube, [1, 0, 0], 0);
  const back = C.clipHalfspace(cube, [-1, 0, 0], 0);
  assert.equal(C.meshVolume(front), 4, "half a cube is half a cube");
  assert.equal(C.meshVolume(back), 4);
  assert.equal(front.faces.length, 6, "and it is still a box");
  // the cap is the last face, and it lies exactly in the cut plane —
  // the room draws the fresh cleavage surface from that promise
  const cap = front.faces[front.faces.length - 1];
  for (const i of cap) near(front.verts[i * 3], 0, 1e-9, "the fresh face lies in the cut");
  // an off-centre and an oblique cut conserve just as exactly
  for (const [n, d] of [
    [[1, 0, 0], 0.37],
    [[1, 1, 1], 0.3],
    [[0.3, -0.8, 0.5], -0.21],
  ]) {
    const a = C.clipHalfspace(cube, n, d);
    const b = C.clipHalfspace(cube, [-n[0], -n[1], -n[2]], -d);
    near(C.meshVolume(a) + C.meshVolume(b), 8, 1e-9, "a cut neither makes nor destroys stone");
  }
  // a cut that misses keeps the whole solid
  near(C.meshVolume(C.clipHalfspace(cube, [1, 0, 0], 9)), 8, 1e-9, "a cut outside the stone changes nothing");
  assert.equal(C.clipHalfspace(cube, [1, 0, 0], -9), null, "and a cut past the far side leaves nothing");
}
// Every cleavage plane of every mineral splits its habit without loss, and
// splits it the same way twice.
for (const id of C.SPECIES_IDS) {
  const mesh = C.habitMesh(id);
  for (const hkl of C.cleavagePlanes(id)) {
    const n = C.planeNormal(C.SPECIES[id].lattice, hkl);
    for (const off of [-0.18, 0, 0.21]) {
      const a = C.clipHalfspace(mesh, n, off);
      const b = C.clipHalfspace(mesh, [-n[0], -n[1], -n[2]], -off);
      const sum = (a ? C.meshVolume(a) : 0) + (b ? C.meshVolume(b) : 0);
      near(sum, 1, 1e-9, `${id}: cleaving on ${hkl.join("")} conserves the stone`);
      if (a) assert.deepEqual(C.clipHalfspace(mesh, n, off), a, `${id}: the same strike makes the same fragment`);
    }
  }
}
// A fragment is drawn at the size it actually is: the scale that holds a
// given mass is the one whose cubed volume is that mass.
for (const id of C.SPECIES_IDS) {
  const mesh = C.habitMesh(id);
  const half = C.clipHalfspace(mesh, C.planeNormal(C.SPECIES[id].lattice, C.cleavagePlanes(id)[0]), 0);
  for (const mass of [0.004, 0.05, 0.4]) {
    const k = C.scaleForMass(half, mass);
    near(C.meshVolume(C.scaleMesh(half, k)), mass, 1e-9, `${id}: a fragment holds exactly its mass`);
  }
  assert.ok(
    C.scaleForMass(half, 0.1) > C.scaleForMass(mesh, 0.1),
    `${id}: the same mass in a smaller habit stands taller`,
  );
}

// —— growth: mass moves, it is never made ————————————————————
{
  const start = { dissolved: 1, solid: 0 };
  let p = start;
  for (let i = 0; i < 600; i++) {
    const next = C.growStep(p, 0.4, 1 / 60);
    assert.ok(next.solid >= p.solid, "the solid never dissolves back on its own");
    assert.ok(next.dissolved <= p.dissolved, "and the solution never refills itself");
    assert.ok(next.dissolved >= 0, "nothing goes negative");
    near(next.dissolved + next.solid, 1, 1e-12, "every gram that leaves solution arrives in the stone");
    p = next;
  }
  assert.ok(p.solid > 0.98, "ten seconds at that rate is nearly all of it");

  // The frame-rate law: one second of growth is one second of growth. A
  // rate·dt integrator fails this by ~1% at 60 Hz — which is exactly how a
  // room ends up growing faster on a fast phone.
  const at = (hz) => {
    let q = { dissolved: 1, solid: 0 };
    for (let i = 0; i < hz; i++) q = C.growStep(q, 0.7, 1 / hz);
    return q.solid;
  };
  near(at(60), at(120), 1e-12, "60 Hz and 120 Hz reach the same crystal");
  near(at(60), at(37), 1e-12, "...and so does a stuttering frame");
  near(at(60), 1 - Math.exp(-0.7), 1e-12, "and the second is the one the rate promises");

  assert.deepEqual(C.growStep({ dissolved: 1, solid: 0 }, 0.4, 0), { dissolved: 1, solid: 0 }, "no time, no growth");
  assert.deepEqual(C.growStep({ dissolved: 1, solid: 0 }, 0, 1), { dissolved: 1, solid: 0 }, "no rate, no growth");
  near(C.halfLife(Math.LN2), 1, 1e-12, "a rate of ln2 halves in one second");
}
// —— dissolution is growth run backwards ————————————————————————
// The delete path. The bug: a "dissolve" that just deletes the stone,
// leaking its mass out of the room so the tray can never grow it back.
{
  let p = { dissolved: 0.1, solid: 0.9 };
  for (let i = 0; i < 600; i++) {
    const next = C.dissolveStep(p, 0.5, 1 / 60);
    assert.ok(next.solid <= p.solid, "the stone only ever gives mass back");
    assert.ok(next.dissolved >= p.dissolved, "and the solution only ever receives it");
    assert.ok(next.solid >= 0, "nothing goes negative");
    near(next.dissolved + next.solid, 1, 1e-12, "every gram that leaves the stone arrives in the brine");
    p = next;
  }
  assert.ok(p.solid < 0.02, "a stone left in undersaturated brine goes back into solution");

  // Frame-rate law, same as growth: a room that dissolves faster on a fast
  // phone would eat a shelf while you watched it.
  const at = (hz) => {
    let q = { dissolved: 0, solid: 1 };
    for (let i = 0; i < hz; i++) q = C.dissolveStep(q, 0.7, 1 / hz);
    return q.solid;
  };
  near(at(60), at(120), 1e-12, "60 Hz and 120 Hz dissolve the same amount");
  near(at(60), at(37), 1e-12, "...and so does a stuttering frame");
  near(at(60), Math.exp(-0.7), 1e-12, "and the second is the one the rate promises");

  // The structural inverse: what dissolving moved out, growing moves back.
  const start = { dissolved: 0.3, solid: 0.7 };
  const gone = C.dissolveStep(start, 0.9, 1);
  const back = C.growStep(gone, -Math.log(start.dissolved / gone.dissolved), 1);
  near(back.solid, start.solid, 1e-12, "growth undoes dissolution exactly");
  near(back.dissolved, start.dissolved, 1e-12, "and the pocket returns to where it began");

  assert.deepEqual(C.dissolveStep(start, 0.4, 0), start, "no time, no dissolution");
  assert.deepEqual(C.dissolveStep(start, 0, 1), start, "no rate, no dissolution");
}

// —— ripening: the big stone eats the small one ————————————————
// The bug this catches: a "ripening" that runs both ways (so nothing ever
// resolves), or one that mints mass on transfer (so leaving the shelf alone
// overnight grows a boulder out of nothing).
{
  let s = 0.2;
  let l = 0.5;
  for (let i = 0; i < 600; i++) {
    const next = C.ripen(s, l, 0.6, 1 / 60);
    assert.ok(next.small <= s, "the small stone only ever loses");
    assert.ok(next.large >= l, "the large stone only ever gains");
    near(next.small + next.large, 0.7, 1e-12, "and the shelf's total mass never moves");
    s = next.small;
    l = next.large;
  }
  assert.ok(s < 0.002 && l > 0.69, "left alone, the shelf resolves toward the big stone");

  // Strictly one-directional: hand it the pair the wrong way round and it
  // must refuse, or a shelf would oscillate forever.
  assert.deepEqual(C.ripen(0.5, 0.2, 0.3, 1), { small: 0.5, large: 0.2 }, "the larger never pays the smaller");
  assert.deepEqual(C.ripen(0.3, 0.3, 0.3, 1), { small: 0.3, large: 0.3 }, "and equals leave each other alone");
  assert.deepEqual(C.ripen(0.1, 0.4, 0.3, 0), { small: 0.1, large: 0.4 }, "no time, no transfer");

  const at = (hz) => {
    let a = 0.2;
    let b = 0.5;
    for (let i = 0; i < hz; i++) ({ small: a, large: b } = C.ripen(a, b, 0.6, 1 / hz));
    return a;
  };
  near(at(60), at(120), 1e-12, "ripening does not depend on the frame rate either");

  // The interaction has to land in the ear, not just in the arithmetic: a
  // stone that ate its neighbour must actually speak lower than it did.
  const before = C.pitchForSize(0.02 * C.sizeFromMass(0.2));
  const after = C.pitchForSize(0.02 * C.sizeFromMass(0.7));
  assert.ok(after < before, "the stone that ate its neighbour speaks lower than it did");
}

// —— hardness: the softer stone takes the mark ————————————————
// The bug: a scratch that is symmetric (so salt would groove topaz), or one
// that fires between two stones of the same kind.
{
  for (const id of C.SPECIES_IDS) {
    assert.ok(typeof C.MOHS[id] === "number", `${id} has a hardness`);
    assert.ok(C.MOHS[id] >= 1 && C.MOHS[id] <= 10, `${id}'s hardness is on the scale`);
    assert.equal(C.scratchOutcome(id, id), null, `${id} does not scratch its own kind`);
  }
  // The scale's own order, checked against the minerals it was built from.
  assert.ok(C.MOHS.halite < C.MOHS.calcite, "salt is softer than calcite");
  assert.ok(C.MOHS.calcite < C.MOHS.quartz, "calcite is softer than quartz");
  assert.ok(C.MOHS.quartz < C.MOHS.topaz, "quartz is softer than topaz");
  for (const a of C.SPECIES_IDS) {
    for (const b of C.SPECIES_IDS) {
      const r = C.scratchOutcome(a, b);
      if (a === b) continue;
      assert.ok(r, `${a} and ${b} differ in hardness, so one marks the other`);
      // antisymmetry: the answer cannot depend on which hand you asked with
      assert.deepEqual(C.scratchOutcome(b, a), r, "a scratch does not care about argument order");
      assert.ok(C.MOHS[r.victim] < C.MOHS[r.agent], `${a}/${b}: the softer stone is the one marked`);
      assert.ok(r.depth > 0 && r.depth <= 1, "and the mark has a bounded depth");
    }
  }
  // Monotone in the gap: a bigger difference in hardness cuts deeper.
  assert.ok(
    C.scratchOutcome("halite", "topaz").depth > C.scratchOutcome("quartz", "topaz").depth,
    "salt under topaz is marked more deeply than quartz under topaz",
  );
}

{
  // Drawing from the tray cannot overdraw it.
  const pool = { dissolved: 0.25, solid: 0 };
  const a = C.drawFrom(pool, 0.1);
  near(a.taken, 0.1, 1e-12);
  near(a.pool.dissolved + a.taken, 0.25, 1e-12, "what leaves the tray is what arrives");
  const b = C.drawFrom(pool, 99);
  near(b.taken, 0.25, 1e-12, "you cannot take more than is dissolved");
  near(b.pool.dissolved, 0, 1e-12);
  assert.equal(C.drawFrom(pool, -5).taken, 0, "and a negative draw takes nothing");
}

// —— the voice: monotone, bounded, and readable back ————————————
{
  let prev = Infinity;
  for (const size of [0.0004, 0.001, 0.004, 0.01, 0.02, 0.05, 0.1]) {
    const hz = C.pitchForSize(size);
    assert.ok(hz <= prev, "a bigger stone never rings higher");
    assert.ok(hz >= C.PITCH_MIN_HZ && hz <= C.PITCH_MAX_HZ, "and never leaves the hearable band");
    prev = hz;
  }
  assert.ok(C.pitchForSize(0.02) > C.pitchForSize(0.04), "twice the stone, half the pitch");
  near(C.pitchForSize(0.02), C.PITCH_REF_HZ, 1e-9, "the reference stone rings at the reference pitch");
  for (const size of [0.004, 0.01, 0.02, 0.05]) {
    near(C.sizeFromPitch(C.pitchForSize(size)), size, 1e-9, "size and pitch are one map both ways");
  }
  assert.equal(C.pitchForSize(1e-9), C.PITCH_MAX_HZ, "a grain of dust is capped, not shrill");

  let last = -1;
  for (const e of [0.4, 0.8, 1, 1.6, 2.4, 3]) {
    const d = C.decayForElongation(e);
    assert.ok(d > last, "a longer crystal holds its ring longer");
    assert.ok(d >= C.DECAY_MIN_S && d <= C.DECAY_MAX_S, "within bounds, always");
    near(C.elongationFromDecay(d), e, 1e-9, "and the decay names the shape back");
    last = d;
  }
  assert.equal(C.decayForElongation(99), C.DECAY_MAX_S, "the ceiling is a ceiling");
}
for (const id of C.SPECIES_IDS) {
  const parts = C.partialsOf(id, 0.02, C.elongationOf(C.habitMesh(id)), 6);
  assert.ok(parts.length >= 4 && parts.length <= 6, `${id}: a bounded number of partials`);
  near(parts[0].hz, C.pitchForSize(0.02), 1e-9, `${id}: the fundamental is the stone's size`);
  for (let i = 1; i < parts.length; i++) {
    assert.ok(parts[i].hz > parts[i - 1].hz, `${id}: the partials climb`);
    assert.ok(parts[i].gain <= parts[i - 1].gain, `${id}: and quieten as they climb`);
    assert.ok(parts[i].seconds <= parts[i - 1].seconds, `${id}: the high ones die first`);
    assert.ok(parts[i].hz < 8000, `${id}: nothing shrieks`);
  }
  // the partial ratios ARE the ring — this is the map, not an echo of it
  const ratios = C.ringRatios(C.SPECIES[id].lattice, parts.length);
  for (let i = 0; i < parts.length; i++) {
    near(parts[i].hz / parts[0].hz, ratios[i], 1e-9, `${id}: partial ${i} is reflection ${i}`);
  }
  assert.equal(
    C.speciesFromRing(parts.map((p) => p.hz / parts[0].hz)),
    id,
    `${id}: the mineral is recoverable from the sounded partials themselves`,
  );
}
// A wide-spaced plane speaks lower than a narrow one, and the map inverts.
for (const id of C.SPECIES_IDS) {
  const lat = C.SPECIES[id].lattice;
  const wide = C.cleavagePlanes(id)[0];
  const narrow = [wide[0] * 2, wide[1] * 2, wide[2] * 2];
  assert.ok(
    C.cleavagePitch(id, narrow, 0.02) > C.cleavagePitch(id, wide, 0.02),
    `${id}: halving the spacing raises the voice`,
  );
  near(
    C.spacingFromCleavagePitch(id, C.cleavagePitch(id, wide, 0.02), 0.02),
    C.dSpacing(lat, wide),
    1e-6,
    `${id}: the cleave's pitch names the spacing back`,
  );
}

// —— the shelf: determinism and caps ————————————————————————
assert.deepEqual(C.nucleate(0xbead, 3), C.nucleate(0xbead, 3), "a seed is a stone");
assert.notDeepEqual(C.nucleate(0xbead, 3), C.nucleate(0xbead, 4), "and a different one each time it is called on");
for (let i = 0; i < 40; i++) {
  const n = C.nucleate(i * 7919, i);
  assert.ok(C.SPECIES_IDS.includes(n.species), "a nucleus is always a real mineral");
  assert.ok(n.nx > 0.05 && n.nx < 0.95 && n.ny > 0.2 && n.ny < 0.9, "and lands on the tray, not off it");
}
{
  const many = Array.from({ length: 40 }, (_, i) => i);
  assert.equal(C.settleStones(many).length, C.MAX_STONES, "the shelf holds its cap");
  assert.equal(C.settleStones(many).at(-1), 39, "and keeps the newest stones");
  assert.deepEqual(C.settleStones([1, 2, 3]), [1, 2, 3], "a small shelf is left alone");
}
// The strike finds a plane of the family, and the same pull finds the same
// one — the reproducibility the room's fracture rests on.
for (const id of C.SPECIES_IDS) {
  const family = C.cleavagePlanes(id).map(key);
  for (const dir of [
    [1, 0, 0],
    [0.3, -0.8, 0.5],
    [0, 0, 1],
    [-0.6, 0.2, -0.77],
  ]) {
    const hit = C.nearestCleavage(id, dir);
    assert.ok(family.includes(key(hit.hkl)), `${id}: a strike only ever finds a plane of the form`);
    assert.deepEqual(C.nearestCleavage(id, dir).hkl, hit.hkl, `${id}: the same pull finds the same plane`);
    for (const hkl of C.cleavagePlanes(id)) {
      const n = C.planeNormal(C.SPECIES[id].lattice, hkl);
      const l = Math.hypot(dir[0], dir[1], dir[2]);
      const a = (n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2]) / l;
      assert.ok(a <= hit.alignment + 1e-12, `${id}: it finds the NEAREST plane, not merely one`);
    }
  }
}

console.log(
  "crystal ok: five point groups closed with the crystallographic orders and metrics they belong to, cleavage families closed under their groups, the primitive cube's ring skipping √7, every mineral named back out of its own sounded partials, habits built only from their own lattice planes, fractures conserving the stone to 1e-9, and growth identical at 60, 120 and 37 Hz",
);
