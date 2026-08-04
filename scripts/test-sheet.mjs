// The /tissue laws. The bugs these catch: an integrator whose sheet is a
// different sheet at 120 Hz than at 60 Hz (the classic variable-dt bug, and
// the one that would make the room non-deterministic from its seed); a
// relaxation that overshoots instead of converging; a lattice whose bond
// radius picks up the second ring, so no cell is ever fully knit; a chord
// you could not read the adhesion topology back out of; a break that fails
// to sound more dissonant than the sheet it broke; a mitosis that invents
// or loses area or drops a neighbour's bond; a differentiation that
// flickers; a constriction that pulls a bond to zero length; and caps that
// do not cap.

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

const S = loadTsModule("src/lib/sheet.ts");

const FORCES = { gx: 0, gy: -0.6, agitation: 0.5, adhesion: 0.55, homeK: 5.5 };

/** Degree with no clamp — so the clamp in degreesOf can never hide a 7. */
function rawDegrees(sheet) {
  const d = new Array(sheet.n).fill(0);
  for (let e = 0; e < sheet.ecount; e++) {
    if (!sheet.live[e]) continue;
    d[sheet.ea[e]] += 1;
    d[sheet.eb[e]] += 1;
  }
  return d;
}

function snapshot(sheet) {
  return {
    px: Array.from(sheet.px.slice(0, sheet.n)),
    py: Array.from(sheet.py.slice(0, sheet.n)),
    ox: Array.from(sheet.ox.slice(0, sheet.n)),
    oy: Array.from(sheet.oy.slice(0, sheet.n)),
    live: Array.from(sheet.live.slice(0, sheet.ecount)),
    t: sheet.t,
    steps: sheet.steps,
  };
}

// —— the lattice really is a lattice ————————————————————————————
// The bug: a neighbour radius that reaches the second ring (√3 ≈ 1.73) or
// falls short of the first (1.0). Either way no interior cell is ever knit
// by exactly six bonds, and the room's root note never sounds.
{
  const cols = 9;
  const rows = 9;
  for (const jitter of [0, 0.07]) {
    const sheet = S.buildSheet(0x7155, cols, rows, jitter);
    assert.equal(sheet.n, cols * rows, "every lattice site becomes a cell");
    const deg = rawDegrees(sheet);
    let interior = 0;
    for (let row = 1; row < rows - 1; row++) {
      for (let col = 1; col < cols - 1; col++) {
        const i = row * cols + col;
        assert.equal(deg[i], 6, `an interior cell has exactly six neighbours (jitter ${jitter})`);
        interior += 1;
      }
    }
    assert.ok(interior > 40, "and there are enough of them to be a sheet");
    // A rim cell has fewer — if every cell read 6 the graph would be a torus,
    // not a sheet with an edge you can tear from.
    assert.ok(deg[0] < 6, "a corner cell is held by fewer bonds than an interior one");
  }
}

// —— the seed is the sheet ————————————————————————————————————
{
  const a = S.buildSheet(0xbeef, 8, 7, 0.07);
  const b = S.buildSheet(0xbeef, 8, 7, 0.07);
  assert.deepEqual(snapshot(a), snapshot(b), "the same seed builds the same sheet");
  const c = S.buildSheet(0xbeee, 8, 7, 0.07);
  assert.notDeepEqual(snapshot(c).px, snapshot(a).px, "a different seed builds a different one");
}

// —— 60 Hz and 120 Hz are the same second ————————————————————
// This is the real determinism bug worth catching: a variable-dt integrator
// gives a visibly different sheet on a 120 Hz phone than on a 60 Hz laptop,
// and no seed can put it back. With a fixed step and an accumulator the two
// run the identical substep sequence, so the states must be bit-identical.
{
  const slow = S.buildSheet(0x5eed, 8, 8, 0.07);
  const fast = S.buildSheet(0x5eed, 8, 8, 0.07);
  for (let f = 0; f < 60; f++) assert.equal(S.advance(slow, 1 / 60, FORCES), 2, "60 Hz takes two substeps a frame");
  for (let f = 0; f < 120; f++) assert.equal(S.advance(fast, 1 / 120, FORCES), 1, "120 Hz takes one");
  assert.equal(slow.steps, 120, "one second is one hundred and twenty substeps");
  assert.equal(fast.steps, slow.steps, "however the frames were cut");
  assert.equal(slow.acc, 0, "and nothing is left over");
  assert.deepEqual(snapshot(fast), snapshot(slow), "the sheet is the same sheet at either rate");
  // ...and it actually moved, or the comparison above proves nothing.
  const fresh = S.buildSheet(0x5eed, 8, 8, 0.07);
  assert.notDeepEqual(snapshot(slow).px, snapshot(fresh).px, "gravity and seethe really displaced it");
}
// A tab that was backgrounded for a minute must not simulate a minute.
{
  const sheet = S.buildSheet(1, 6, 6, 0);
  const steps = S.advance(sheet, 60, FORCES);
  assert.equal(steps, S.MAX_SUBSTEPS, "a long stall is clamped, never spiralled");
  assert.equal(sheet.acc, 0, "and the debt is dropped rather than repaid forever");
}

// —— relaxation converges, and by exactly the factor it claims ————
// The one case computable by hand: a single bond stretched by E has its
// error multiplied by exactly (1 − STIFFNESS) per pass, because each end
// moves half the error times the stiffness. If the arithmetic ever picks up
// a stray factor of two the sheet either creeps or rings, and this catches
// both — including STIFFNESS > 1, which would overshoot into oscillation.
{
  for (const E of [0.3, -0.2, 0.05]) {
    const sheet = S.buildSheet(3, 2, 2, 0);
    // one bond, alone, so the arithmetic is the arithmetic of one bond
    for (let e = 1; e < sheet.ecount; e++) sheet.live[e] = 0;
    const a = sheet.ea[0];
    const b = sheet.eb[0];
    const rest = S.restLength(sheet, 0);
    sheet.px[b] = sheet.px[a] + rest * (1 + E);
    sheet.py[b] = sheet.py[a];
    const before = S.constraintError(sheet);
    assert.ok(Math.abs(before - Math.abs(rest * E)) < 1e-12, "the error is the stretch");
    S.relaxOnce(sheet);
    const after = S.constraintError(sheet);
    const expected = Math.abs(rest * E) * (1 - S.STIFFNESS);
    assert.ok(
      Math.abs(after - expected) < 1e-12,
      `one pass removes exactly the stiffness fraction (got ${after}, expected ${expected})`,
    );
    assert.ok(after <= before, "and never overshoots past the rest length");
  }
}
// A whole perturbed lattice contracts too — relaxation must not merely
// shuffle error from bond to bond.
{
  const sheet = S.buildSheet(0xc0ffee, 7, 7, 0);
  const rng = S.mulberry32(0x1234);
  for (let i = 0; i < sheet.n; i++) {
    sheet.px[i] += (rng() * 2 - 1) * 0.18;
    sheet.py[i] += (rng() * 2 - 1) * 0.18;
  }
  const start = S.constraintError(sheet);
  let prev = start;
  assert.ok(start > 5, "the lattice starts genuinely strained");
  for (let block = 0; block < 8; block++) {
    for (let p = 0; p < S.RELAX_PASSES; p++) S.relaxOnce(sheet);
    const now = S.constraintError(sheet);
    assert.ok(now < prev, `relaxation block ${block} reduced the total error`);
    prev = now;
  }
  // Eight cycles of three passes must take an over-constrained hex lattice
  // down by more than an order of magnitude — a relaxation that merely
  // inched would leave the sheet permanently, visibly strained.
  assert.ok(prev < start * 0.04, `relaxation converges (${start} → ${prev})`);
}

// —— the chord IS the topology ————————————————————————————————
// The degree→interval table has to be injective, or the map back is a
// guess; and its complexity has to rise strictly as coordination falls, or
// a break could sound sweeter than the sheet it broke.
{
  const seen = new Set();
  let lastComplexity = Infinity;
  for (let d = S.MAX_DEGREE; d >= 0; d--) {
    const key = `${S.DEGREE_NUM[d]}/${S.DEGREE_DEN[d]}`;
    assert.ok(!seen.has(key), `degree ${d} names an interval no other degree names`);
    seen.add(key);
    const complexity = S.DEGREE_NUM[d] * S.DEGREE_DEN[d];
    assert.ok(complexity > lastComplexity || d === S.MAX_DEGREE, `losing a bond is never sweeter (degree ${d})`);
    lastComplexity = complexity;
  }
  assert.equal(S.DEGREE_NUM[6] / S.DEGREE_DEN[6], 1, "a fully knit cell sings the root itself");
  assert.equal(S.dissonance(S.chordOf([6, 6, 6], 3)), 0, "a sheet of unisons is exactly consonant");
}
// The round trip: the chord carries the degree histogram back out intact.
for (const seed of [1, 42, 0x5eed, 0xbeef, 991]) {
  const sheet = S.buildSheet(seed, 8, 7, 0.07);
  // tear it about a bit so the histogram is not trivial
  S.tearAcross(sheet, -9, 0.4, 9, -0.6);
  const deg = S.degreesOf(sheet);
  const chord = S.chordOf(deg, sheet.n);
  const expected = new Array(S.MAX_DEGREE + 1).fill(0);
  for (let i = 0; i < sheet.n; i++) expected[deg[i]] += 1;
  assert.deepEqual(
    S.chordDegreeCounts(chord, sheet.n),
    expected,
    "the chord reads back into the adhesion graph's degree spectrum",
  );
  const wsum = chord.weight.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(wsum - 1) < 1e-12, "every cell has exactly one voice in the chord");
  assert.ok(chord.degree.length >= 2, "a torn sheet sings more than one interval");
}
// Frequencies are the ratios over the root, and nothing else.
{
  const chord = S.chordOf([6, 5, 5, 3], 4);
  const hz = S.chordFrequencies(chord, 110);
  assert.deepEqual(hz, [110, 110 * 1.5, 110 * 1.25], "root, fifth, third — the ratios over the root");
  assert.equal(S.voiceOf(6, 220), 220, "a knit cell is the root");
  assert.equal(S.voiceOf(0, 220), (220 * 45) / 32, "an adrift one is the tritone");
}

// —— a break is audible before it is visible ————————————————————
// The bug this catches: a "consonance" that does not actually track the
// topology, so tearing the sheet leaves the chord alone and the room's
// central claim is decoration.
{
  const intact = S.buildSheet(0x7155, 9, 9, 0);
  const intactChord = S.chordOf(S.degreesOf(intact), intact.n);
  const intactD = S.dissonance(intactChord);

  const torn = S.buildSheet(0x7155, 9, 9, 0);
  const cut = S.tearAcross(torn, -99, 0.2, 99, 0.2);
  assert.ok(cut > 5, "a line across the sheet opens a real tear");
  const tornD = S.dissonance(S.chordOf(S.degreesOf(torn), torn.n));
  assert.ok(tornD > intactD, `a torn sheet is more dissonant (${tornD} vs ${intactD})`);

  // An intact sheet holds only simple ratios — no cell is loose enough to
  // reach the whole tone or the tritone — and the root carries most of it.
  // A lattice wired with the wrong neighbour radius would fail both.
  for (const d of intactChord.degree) {
    assert.ok(d >= 2, "no cell of an intact sheet sings the rough end of the table");
  }
  assert.ok(
    intactChord.weight[intactChord.degree.indexOf(6)] > 0.55,
    "most of an intact sheet sings the root",
  );
  const shredded = S.buildSheet(0x7155, 9, 9, 0);
  for (let e = 0; e < shredded.ecount; e++) if (e % 2 === 0) shredded.live[e] = 0;
  const shreddedChord = S.chordOf(S.degreesOf(shredded), shredded.n);
  assert.ok(
    S.dissonance(shreddedChord) > tornD,
    "and a sheet coming apart everywhere is rougher still",
  );
  assert.ok(
    shreddedChord.num.some((n, k) => n * shreddedChord.den[k] >= 30),
    "cells losing most of their neighbours reach the rough intervals",
  );
}
// Monotone in the strongest form: cutting ANY single living bond raises the
// dissonance, never lowers it and never leaves it alone.
{
  const sheet = S.buildSheet(0x2244, 7, 7, 0);
  const base = S.dissonance(S.chordOf(S.degreesOf(sheet), sheet.n));
  let checked = 0;
  for (let e = 0; e < sheet.ecount; e++) {
    if (!sheet.live[e]) continue;
    sheet.live[e] = 0;
    const after = S.dissonance(S.chordOf(S.degreesOf(sheet), sheet.n));
    assert.ok(after > base, `cutting bond ${e} made the sheet rougher`);
    sheet.live[e] = 1;
    checked += 1;
  }
  assert.ok(checked > 80, "and that was checked over every bond in the sheet");
}
// A tear cuts what it crosses and nothing else.
{
  const sheet = S.buildSheet(9, 7, 7, 0);
  const before = Array.from(sheet.live.slice(0, sheet.ecount));
  const cut = S.tearAcross(sheet, 40, 40, 60, 60);
  assert.equal(cut, 0, "a stroke off the sheet cuts nothing");
  assert.deepEqual(Array.from(sheet.live.slice(0, sheet.ecount)), before, "and disturbs nothing");
  S.tearAcross(sheet, -0.2, -99, -0.2, 99);
  for (let e = 0; e < sheet.ecount; e++) {
    if (sheet.live[e]) continue;
    const ax = sheet.px[sheet.ea[e]];
    const bx = sheet.px[sheet.eb[e]];
    assert.ok(
      (ax < -0.2 && bx > -0.2) || (bx < -0.2 && ax > -0.2),
      "every opened bond genuinely straddles the cut",
    );
  }
}

// —— mitosis conserves the sheet ————————————————————————————————
// Two bugs here, both easy to write and impossible to see: halving the
// radius instead of the area (which would quietly delete three quarters of
// the tissue at every division), and rewiring the mother's bonds so a
// neighbour ends up bound to both daughters or to neither.
{
  for (const seed of [7, 88, 0x1234]) {
    const sheet = S.buildSheet(seed, 7, 7, 0.07);
    const i = 24; // an interior cell
    const areaBefore = S.totalArea(sheet);
    const neighbours = [];
    for (let e = 0; e < sheet.ecount; e++) {
      if (sheet.ea[e] === i) neighbours.push(sheet.eb[e]);
      else if (sheet.eb[e] === i) neighbours.push(sheet.ea[e]);
    }
    assert.equal(neighbours.length, 6, "the mother is interior");

    const j = S.divideCell(sheet, i, 0x99);
    assert.equal(j, sheet.n - 1, "the daughter is the newest cell");
    const areaAfter = S.totalArea(sheet);
    assert.ok(
      Math.abs(areaAfter - areaBefore) / areaBefore < 1e-12,
      `division conserves the sheet's area (${areaBefore} → ${areaAfter})`,
    );
    assert.ok(Math.abs(sheet.r[i] - sheet.r[j]) < 1e-15, "the daughters are equals");

    for (const k of neighbours) {
      let toI = 0;
      let toJ = 0;
      for (let e = 0; e < sheet.ecount; e++) {
        const a = sheet.ea[e];
        const b = sheet.eb[e];
        if ((a === k && b === i) || (b === k && a === i)) toI += 1;
        if ((a === k && b === j) || (b === k && a === j)) toJ += 1;
      }
      assert.equal(toI + toJ, 1, `neighbour ${k} is bound to exactly one daughter`);
    }
    let sisters = 0;
    for (let e = 0; e < sheet.ecount; e++) {
      const a = sheet.ea[e];
      const b = sheet.eb[e];
      if ((a === i && b === j) || (a === j && b === i)) sisters += 1;
    }
    assert.equal(sisters, 1, "and the two daughters hold each other, once");
    // The spindle lies in the plane, across polarity — the daughters part
    // perpendicular to the sheet's apical-basal axis, as an epithelium's do.
    const dx = sheet.px[j] - sheet.px[i];
    const dy = sheet.py[j] - sheet.py[i];
    const along = dx * Math.cos(sheet.pol[i]) + dy * Math.sin(sheet.pol[i]);
    assert.ok(Math.abs(along) < 1e-12, "the daughters part across polarity, not along it");
  }
}
// The population is capped, and a cell that has nothing left to halve says so.
{
  const sheet = S.buildSheet(5, 6, 6, 0.07, 40);
  let refusals = 0;
  for (let k = 0; k < 200; k++) {
    if (S.divideCell(sheet, k % sheet.n, k) < 0) refusals += 1;
  }
  assert.ok(sheet.n <= 40, "the sheet never grows past its cap");
  assert.ok(refusals > 0, "and it says no rather than silently dropping cells");
  const small = S.buildSheet(5, 3, 3, 0);
  small.r[0] = S.MIN_DIVIDE_R * 0.9;
  assert.equal(S.divideCell(small, 0, 1), -1, "a cell too small to halve does not divide");
  assert.equal(S.divideCell(small, -1, 1), -1, "and an index off the sheet does nothing");
}

// —— apoptosis: a cell resorbed, the ring around it left intact ——————
// The bugs this catches: a removed cell's bonds left dangling so they
// could heal back into a phantom edge once the slot is reused (the killed
// edges must be compacted out of the live range, not merely marked dead);
// the index-swap that keeps 0..n-1 packed mis-wiring an edge that pointed
// at the swapped-in cell, producing a self-loop or a dangling reference;
// and neighbours that were already bonded to each other losing that bond
// as a side effect of removing the cell between them.
{
  const sheet = S.buildSheet(11, 7, 7, 0.07);
  const i = 24; // interior, six neighbours
  const neighbours = [];
  for (let e = 0; e < sheet.ecount; e++) {
    if (sheet.ea[e] === i) neighbours.push(sheet.eb[e]);
    else if (sheet.eb[e] === i) neighbours.push(sheet.ea[e]);
  }
  assert.equal(neighbours.length, 6, "the mother is interior");
  // Adjacent neighbours around a hex ring are one SPACING apart from each
  // other too, so at least some of them are already mutually bonded —
  // that's the bond the gap is supposed to close on.
  const ringBondsBefore = [];
  for (let a = 0; a < neighbours.length; a++) {
    for (let b = a + 1; b < neighbours.length; b++) {
      const p = neighbours[a];
      const q = neighbours[b];
      for (let e = 0; e < sheet.ecount; e++) {
        if (!sheet.live[e]) continue;
        if ((sheet.ea[e] === p && sheet.eb[e] === q) || (sheet.eb[e] === p && sheet.ea[e] === q)) {
          ringBondsBefore.push([p, q]);
        }
      }
    }
  }
  assert.ok(ringBondsBefore.length > 0, "some ring neighbours are already bonded to each other");

  const nBefore = sheet.n;
  const ecountBefore = sheet.ecount;
  const ok = S.apoptose(sheet, i);
  assert.ok(ok, "apoptosis on a real cell succeeds");
  assert.equal(sheet.n, nBefore - 1, "exactly one cell is gone");
  assert.equal(sheet.ecount, ecountBefore - 6, "exactly the six bonds it held are gone with it");

  for (let e = 0; e < sheet.ecount; e++) {
    assert.notEqual(sheet.ea[e], sheet.eb[e], "the index swap never produces a self-loop edge");
  }
  // The only index the removal ever renames is the old last cell, swapped
  // into the gap's slot — everything else keeps its meaning.
  const after = (x) => (x === nBefore - 1 ? i : x);
  for (const [p0, q0] of ringBondsBefore) {
    const p = after(p0);
    const q = after(q0);
    const stillLive = sheet.live.slice(0, sheet.ecount).some((lv, e) => {
      if (!lv) return false;
      const a = sheet.ea[e];
      const b = sheet.eb[e];
      return (a === p && b === q) || (b === p && a === q);
    });
    assert.ok(stillLive, `ring neighbours ${p0}-${q0} stay bonded — the gap closes on an edge that was already there`);
  }

  assert.equal(S.apoptose(sheet, -1), false, "an index off the sheet does nothing");
  assert.equal(S.apoptose(sheet, sheet.n), false, "and neither does one at n");
  assert.equal(sheet.n, nBefore - 1, "refused calls change nothing");
}

// —— differentiation is a function of place and clock ————————————
{
  const field = S.morphogenField(0x30);
  // Pure: the same point at the same time is always the same fate.
  for (const [nx, ny] of [[0, 0], [0.3, -0.7], [-0.9, 0.2], [1, 1]]) {
    for (const t of [0, 5, 20, 44, 90]) {
      assert.equal(
        S.fateAt(field, nx, ny, 0, t),
        S.fateAt(field, nx, ny, 0, t),
        "fate is a pure function of position and time",
      );
      const f = S.fateAt(field, nx, ny, 0, t);
      assert.ok(f >= 0 && f <= S.FATE_COUNT - 1, "and always a fate the room can render");
    }
  }
  // Monotone in time: the front sweeps, it never retreats. A fate that
  // flickered would make the sheet strobe and the room a liar about history.
  const rng = S.mulberry32(0x777);
  for (let k = 0; k < 200; k++) {
    const nx = rng() * 2 - 1;
    const ny = rng() * 2 - 1;
    let prev = -1;
    for (let t = 0; t <= S.FATE_FRONT_SEC * 1.4; t += 1.5) {
      const f = S.fateAt(field, nx, ny, 0, t);
      assert.ok(f >= prev, "a fate once reached is never taken back");
      prev = f;
    }
  }
  // The front really does sweep: at t = 0 nothing is committed, and by the
  // time it has crossed, the sheet carries more than one fate.
  let atZero = 0;
  let atEnd = new Set();
  for (let k = 0; k < 400; k++) {
    const nx = rng() * 2 - 1;
    const ny = rng() * 2 - 1;
    atZero += S.fateAt(field, nx, ny, 0, 0);
    atEnd.add(S.fateAt(field, nx, ny, 0, S.FATE_FRONT_SEC));
  }
  assert.equal(atZero, 0, "an untouched sheet has not differentiated at all");
  assert.ok(atEnd.size >= 3, "and a swept one carries several fates by position");
  // Turning the body axis moves the pattern — the season is a real verb.
  const straight = [];
  const turned = [];
  for (let k = 0; k < 60; k++) {
    const nx = -1 + (2 * k) / 60;
    straight.push(S.fateAt(field, nx, 0.3, 0, 999));
    turned.push(S.fateAt(field, nx, 0.3, Math.PI / 2, 999));
  }
  assert.notDeepEqual(turned, straight, "the body axis actually turns the pattern");
}
// Commitment is monotone and the sealed layer is terminal.
{
  assert.equal(S.commitFate(2, 1), 2, "a landed fate is never undone by a lower one");
  assert.equal(S.commitFate(1, 3), 3, "but it does advance");
  assert.equal(S.commitFate(S.INNER_FATE, 0), S.INNER_FATE, "the inner layer is terminal");
  assert.equal(S.commitFate(S.INNER_FATE, 3), S.INNER_FATE, "whatever the front says later");

  const sheet = S.buildSheet(0x18, 7, 7, 0.07);
  const field = S.morphogenField(0x18);
  const before = Array.from(sheet.fate.slice(0, sheet.n));
  sheet.t = S.FATE_FRONT_SEC;
  S.commitFates(sheet, field, 0);
  const after = Array.from(sheet.fate.slice(0, sheet.n));
  for (let i = 0; i < sheet.n; i++) assert.ok(after[i] >= before[i], "no cell de-differentiates");
  assert.ok(after.some((f, i) => f > before[i]), "and the sweep actually landed fates");
}

// —— the pit: constriction pulls in, and never to nothing ————————
// The bug: a rest length driven to (or through) zero, which sends the
// integrator to infinity the first time a hand holds too long.
{
  const sheet = S.buildSheet(0x99, 9, 9, 0);
  const restsAt = (amount) => {
    const s2 = S.buildSheet(0x99, 9, 9, 0);
    S.constrict(s2, 0, 0, 2.2, amount);
    let total = 0;
    for (let e = 0; e < s2.ecount; e++) total += S.restLength(s2, e);
    return { total, sheet: s2 };
  };
  let prevTotal = Infinity;
  for (const amount of [0, 0.25, 0.5, 0.75, 1]) {
    const { total, sheet: s2 } = restsAt(amount);
    assert.ok(total <= prevTotal, `a deeper hold draws the sheet further in (${amount})`);
    if (amount > 0) assert.ok(total < prevTotal, "and strictly further, not merely not-more");
    prevTotal = total;
    for (let e = 0; e < s2.ecount; e++) {
      assert.ok(S.restLength(s2, e) > 0, "no bond is ever pulled to zero length");
      assert.ok(s2.restF[e] >= S.MIN_REST_FACTOR - 1e-12, "constriction respects its floor");
      assert.ok(s2.restF[e] <= 1 + 1e-12, "and never pushes a bond longer than natural");
    }
    for (let i = 0; i < s2.n; i++) {
      assert.ok(s2.depth[i] >= 0 && s2.depth[i] <= 1, "depth stays inside the sheet");
    }
  }
  // The pit only deepens while the finger is down.
  const held = S.buildSheet(0x99, 9, 9, 0);
  S.constrict(held, 0, 0, 2.2, 0.8);
  const deep = Array.from(held.depth.slice(0, held.n));
  S.constrict(held, 0, 0, 2.2, 0.2);
  for (let i = 0; i < held.n; i++) {
    assert.ok(held.depth[i] >= deep[i] - 1e-12, "a lighter touch does not undo a deeper one");
  }
  // ...and opens back out when it lifts.
  S.relaxConstriction(held, 0.5, 4);
  let anyShallower = false;
  for (let i = 0; i < held.n; i++) if (held.depth[i] < deep[i] - 1e-9) anyShallower = true;
  assert.ok(anyShallower, "the pit relaxes once the hand is gone");
}
// Sealing destroys nothing and reaches only the floor of the pit.
{
  const sheet = S.buildSheet(0x99, 9, 9, 0);
  S.constrict(sheet, 0, 0, 2.2, 1);
  const n0 = sheet.n;
  const outside = [];
  for (let i = 0; i < sheet.n; i++) {
    if (sheet.px[i] ** 2 + sheet.py[i] ** 2 > 2.2 * 2.2) outside.push(i);
  }
  const sealed = S.sealPit(sheet, 0, 0, 2.2);
  assert.ok(sealed > 0, "a pit held to the ceremony really closes over");
  assert.equal(sheet.n, n0, "and nothing is destroyed doing it — the cells go inside");
  for (const i of outside) {
    assert.notEqual(sheet.fate[i], S.INNER_FATE, "cells outside the pit stay on the surface");
  }
  for (let i = 0; i < sheet.n; i++) {
    if (sheet.fate[i] === S.INNER_FATE) assert.equal(sheet.depth[i], 1, "the inner layer is all the way in");
  }
  assert.equal(S.sealPit(sheet, 0, 0, 2.2), 0, "and sealing twice seals nothing twice");
}

// —— what the room keeps survives the trip through storage ————————
// The bug: a persisted sheet that comes back with a different topology, so
// the chord you left is not the chord you return to.
{
  const sheet = S.buildSheet(0x4242, 8, 7, 0.07);
  S.tearAcross(sheet, -99, 0.35, 99, -0.25);
  S.divideCell(sheet, 20, 3);
  S.constrict(sheet, 0.4, 0.2, 1.6, 0.7);
  const packed = JSON.parse(JSON.stringify(S.packSheet(sheet)));
  const back = S.unpackSheet(packed);
  assert.ok(back, "a packed sheet unpacks");
  assert.equal(back.n, sheet.n, "with every cell");
  assert.deepEqual(
    Array.from(S.degreesOf(back)),
    Array.from(S.degreesOf(sheet)),
    "and the identical adhesion topology",
  );
  assert.deepEqual(
    S.chordOf(S.degreesOf(back), back.n).ratio,
    S.chordOf(S.degreesOf(sheet), sheet.n).ratio,
    "so the sheet returns singing the chord it left on",
  );
  for (let i = 0; i < back.n; i++) {
    assert.ok(Math.abs(back.px[i] - sheet.px[i]) < 1e-3, "positions survive to the rendered precision");
    assert.equal(back.fate[i], sheet.fate[i], "and every fate is remembered");
  }
  assert.equal(S.unpackSheet(null), null, "nothing kept unpacks to nothing");
  assert.equal(S.unpackSheet({ v: 2, x: [] }), null, "and an old shape is refused rather than misread");
}

console.log(
  "sheet ok: the verlet sheet identical at 60 and 120 Hz over a full second, relaxation removing exactly its stiffness fraction per pass and converging on a strained lattice, an interior cell knit by exactly six bonds, the chord reading back into the degree spectrum it came from, every single cut bond strictly raising the dissonance, mitosis conserving area to 1e-12 with every neighbour rewired to exactly one daughter, apoptosis dropping exactly the bonds it held with no self-loop left behind and the ring around it still closed, differentiation pure and monotone, constriction bounded away from zero, and storage returning the sheet still singing its chord",
);
