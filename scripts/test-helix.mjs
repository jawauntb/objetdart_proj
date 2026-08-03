// The /dna laws. The bugs these catch: a melody you could not read back
// into the strand it came from (which would make the room's central claim
// false), a pairing that is not Watson–Crick, a bond ledger that disagrees
// with the bases, a zipper that opens out of order, and a "mutation" that
// leaves the base it landed on unchanged.

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

const H = loadTsModule("src/lib/helix.ts");

const seeds = [1, 7, 42, 0xbeef, 0xc0ffee, 0x5eed, 991, 2024, 0x1234567, 88];
const strands = seeds.map((s) => H.sequenceFromSeed(s, 8 + (s % 40)));

// —— the melody IS the strand ————————————————————————————————————
// If this round trip fails, the room is merely noisy about the sequence
// instead of playing it, and the whole reason the band exists is gone.
for (const seq of strands) {
  const midis = H.melodyOf(seq);
  assert.equal(midis.length, seq.length, "one note per base");
  assert.deepEqual(
    H.sequenceFromMelody(midis),
    seq,
    `the melody carries the strand back intact (${seq.join("")})`,
  );
}
// The four bases must land on four DISTINCT degrees, or the inverse above
// would be quietly choosing between them.
{
  const degrees = new Set(H.BASES.map((b) => H.DEGREE[b]));
  assert.equal(degrees.size, 4, "four bases, four degrees — nothing collides");
  for (const b of H.BASES) {
    assert.equal(H.BASE_OF_DEGREE[H.DEGREE[b]], b, `${b}'s degree names ${b} and nothing else`);
  }
}
// A tune that is not in the code names nothing — the map never guesses.
assert.equal(
  H.sequenceFromMelody([H.MELODY_ROOT_MIDI + 1]),
  null,
  "a degree no base occupies yields no strand",
);
// The line climbs with position, so the ear can hear where in the strand
// the polymerase has got to.
{
  const long = H.sequenceFromSeed(3, 40);
  const m = H.melodyOf(long);
  const first = m.slice(0, H.OCTAVE_RUN);
  const later = m.slice(H.OCTAVE_RUN * 3, H.OCTAVE_RUN * 4);
  assert.ok(
    Math.min(...later) > Math.min(...first),
    "the melody rises as the strand runs on",
  );
  // ...and rising by octaves cannot break the inverse.
  assert.deepEqual(H.sequenceFromMelody(m), long, "octaves are position, not information");
}

// —— pairing is Watson–Crick, and complementing twice is identity ————
for (const seq of strands) {
  const c = H.complement(seq);
  assert.deepEqual(H.complement(c), seq, "complement is an involution");
  assert.ok(H.isComplementary(seq, c), "the two strands are complementary");
  for (let i = 0; i < seq.length; i++) {
    assert.notEqual(c[i], seq[i], "no base pairs with itself");
  }
}
assert.equal(H.isComplementary(["A", "T"], ["T", "A"]), true);
assert.equal(H.isComplementary(["A", "T"], ["T", "G"]), false, "one wrong rung breaks the duplex");
assert.equal(H.isComplementary(["A"], ["T", "A"]), false, "strands of different length never pair");

// —— the transcript is a representation, not a loss ————————————————
for (const seq of strands) {
  const rna = H.transcribe(seq);
  assert.equal(rna.length, seq.length, "one letter per base");
  assert.ok(!rna.includes("T"), "rna carries uracil, never thymine");
  assert.deepEqual(H.reverseTranscribe(rna), seq, "the transcript reads back to its template");
}

// —— the bond ledger agrees with the bases ————————————————————————
// The bug: a bond count drifting from the sequence, which would make the
// felt resistance of the unzip a lie about what is actually holding.
for (const seq of strands) {
  let expected = 0;
  for (const b of seq) expected += b === "G" || b === "C" ? 3 : 2;
  assert.equal(H.hydrogenBonds(seq), expected, "every rung counted, and counted right");
  assert.equal(H.unzipEnergy(seq, seq.length), H.hydrogenBonds(seq), "a full unzip breaks them all");
  assert.equal(H.unzipEnergy(seq, 0), 0, "an untouched duplex has broken nothing");
  // ...and the zipper runs in order: never fewer bonds broken further on.
  let prev = 0;
  for (let k = 0; k <= seq.length; k++) {
    const e = H.unzipEnergy(seq, k);
    assert.ok(e >= prev, "the zipper never re-anneals as it runs");
    if (k > 0) assert.ok(e > prev, "each pair that opens costs something real");
    prev = e;
  }
}
// GC is genuinely harder to open than AT — 3 bonds against 2, everywhere.
{
  const at = H.parseSequence("ATATATATAT");
  const gc = H.parseSequence("GCGCGCGCGC");
  assert.equal(H.hydrogenBonds(at), 20);
  assert.equal(H.hydrogenBonds(gc), 30);
  assert.ok(H.meltingTemp(gc) > H.meltingTemp(at), "a gc strand melts higher");
  assert.equal(H.meltingTemp(at), 20, "the Wallace rule, exactly: 2 per a·t");
  assert.equal(H.meltingTemp(gc), 40, "and 4 per g·c");
  assert.equal(H.gcContent(gc), 1);
  assert.equal(H.gcContent(at), 0);
}
// Melting is monotone in temperature and in GC content — a hotter world
// opens more, and a stronger strand resists more, always.
{
  const weak = H.parseSequence("ATATATATATATATAT");
  const strong = H.parseSequence("GCGCGCGCGCGCGCGC");
  let prev = -1;
  for (const temp of [0, 0.5, 1, 2, 4, 8, 20]) {
    const f = H.openFraction(weak, temp);
    assert.ok(f >= prev, "more heat never closes a strand");
    assert.ok(f >= H.openFraction(strong, temp), "the weak strand always opens first");
    prev = f;
  }
  assert.equal(H.openFraction(weak, 0), 0, "a cold strand is shut");
  assert.equal(H.openFraction(weak, 100), 1, "a hot enough one is fully open");
}

// —— a mutation actually mutates ————————————————————————————————
for (const seq of strands.slice(0, 6)) {
  for (const i of [0, 1, seq.length - 1]) {
    const next = H.mutate(seq, i, 0x77);
    assert.equal(next.length, seq.length, "a substitution changes no length");
    assert.notEqual(next[i], seq[i], "the base that arrives is never the base that left");
    for (let k = 0; k < seq.length; k++) {
      if (k !== i) assert.equal(next[k], seq[k], "and nothing else moves");
    }
    // ...and because the strand changed, so did its tune. This is the
    // consequence that makes the map worth having.
    assert.notDeepEqual(H.melodyOf(next), H.melodyOf(seq), "a changed strand is a changed melody");
    assert.deepEqual(H.mutate(seq, i, 0x77), next, "the same seed is the same mutation");
  }
}
assert.deepEqual(H.mutate(strands[0], -1, 1), strands[0], "an index off the strand does nothing");
assert.deepEqual(H.mutate(strands[0], 9999, 1), strands[0], "and neither does one past its end");

// —— a touch rewrite steps the alphabet, never skips or freezes ————
{
  let seq = /** @type {import('../src/lib/helix.ts').Base[]} */ (["A", "T", "G", "C"]);
  assert.deepEqual(H.cycleBase(seq, 0), ["T", "T", "G", "C"], "A steps to T");
  assert.deepEqual(H.cycleBase(["T", "T", "G", "C"], 0), ["G", "T", "G", "C"], "T steps to G");
  assert.deepEqual(H.cycleBase(["G", "T", "G", "C"], 0), ["C", "T", "G", "C"], "G steps to C");
  assert.deepEqual(H.cycleBase(["C", "T", "G", "C"], 0), ["A", "T", "G", "C"], "C wraps to A");
  for (let k = 0; k < 4; k++) seq = H.cycleBase(seq, 2);
  assert.deepEqual(seq, ["A", "T", "G", "C"], "four presses on one rung restore it");
  assert.notDeepEqual(
    H.melodyOf(H.cycleBase(["A", "A", "A", "A", "A", "A", "A", "A"], 3)),
    H.melodyOf(["A", "A", "A", "A", "A", "A", "A", "A"]),
    "a cycled base is a changed melody",
  );
  assert.deepEqual(H.cycleBase(seq, -1), seq, "an off-strand cycle is a no-op");
}
// The world does not drift on its own: at rest the rate is exactly zero.
assert.equal(H.mutationRate(0), 0, "a cold world rewrites nothing");
let lastRate = -1;
for (const t of [0, 0.2, 0.5, 0.8, 1]) {
  const r = H.mutationRate(t);
  assert.ok(r > lastRate || t === 0, "a warmer world rewrites faster");
  assert.ok(r <= H.MUTATION_MAX_PER_S, "and never past its ceiling");
  lastRate = r;
}
assert.equal(H.mutationRate(9), H.mutationRate(1), "the ceiling is a ceiling");

// —— determinism and caps ——————————————————————————————————————
assert.deepEqual(H.sequenceFromSeed(0xabc, 24), H.sequenceFromSeed(0xabc, 24), "a seed is a strand");
assert.equal(H.sequenceFromSeed(1, 4).length, H.MIN_BASES, "a strand is never shorter than the floor");
assert.equal(H.sequenceFromSeed(1, 5000).length, H.MAX_BASES, "nor longer than the cap");
assert.equal(H.parseSequence("aXtZgQc!!").join(""), "ATGC", "only real bases are read");
assert.equal(H.parseSequence("A".repeat(500)).length, H.MAX_BASES, "pasted junk is still capped");
{
  const over = H.sequenceFromSeed(9, 96).concat(H.parseSequence("ATGC"));
  assert.equal(H.settleLength(over).length, H.MAX_BASES, "the strand holds its cap");
  assert.equal(H.settleLength(over).at(-1), "C", "and keeps the newest end");
}

// —— geometry: the zipper opens from one end, in order ————————————
{
  const n = 30;
  const opens = (unzip) => Array.from({ length: n }, (_, i) => H.rungAt(i, n, unzip, 1).open);
  const half = opens(0.5);
  for (let i = 1; i < n; i++) {
    assert.ok(half[i] <= half[i - 1] + 1e-9, "a rung further in is never more open than one nearer");
  }
  assert.equal(opens(0)[0], 0, "a shut duplex is shut at the first rung");
  assert.equal(opens(1).at(-1) > 0, true, "a full pull reaches the far end");
  assert.deepEqual(opens(0.5), half, "the same pull draws the same helix");
  // the backbones are mirror images across the axis, always
  for (let i = 0; i < n; i++) {
    const r = H.rungAt(i, n, 0.3, 1);
    assert.ok(Math.abs(r.x1 + r.x2) < 1e-12, "the two backbones stay opposite");
  }
  assert.equal(H.openPairs(n, 0), 0);
  assert.equal(H.openPairs(n, 1), n);
  assert.equal(H.openPairs(n, 0.5), 15);
}

console.log(
  "helix ok: sequence↔melody a true round trip over 10 strands, complement an involution, the transcript reversible, the bond ledger matching the bases with the zipper strictly ordered, melting monotone in heat and in gc, and every mutation a real substitution",
);
