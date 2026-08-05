/**
 * helix — the ladder that copies.
 *
 * The invariant is a base sequence. Everything the /dna room shows or
 * sounds is a representation of that one string: the helix geometry, the
 * hydrogen-bond ledger, the melting point, the transcript, the melody.
 *
 * The load-bearing map is sequence ↔ melody, and it is INVERTIBLE. Four
 * bases, four scale degrees; the octave carries position along the strand.
 * Read the melody back through `sequenceFromMelody` and you have the
 * strand — which is the site's canonical move (the /light colour↔music
 * inverse) applied to the molecule that is literally a code.
 *
 * Pure math, no imports, no DOM — node-testable (scripts/test-helix.mjs).
 * See docs/plans/life-and-vista-bands.md §2 and INSPIRATION.md §2.
 */

export type Base = "A" | "T" | "G" | "C";
export const BASES: readonly Base[] = ["A", "T", "G", "C"];

export const MAX_BASES = 96;
export const MIN_BASES = 8;

/** Watson–Crick pairing. A pairs with T, G with C, and nothing else. */
export const COMPLEMENT: Record<Base, Base> = { A: "T", T: "A", G: "C", C: "G" };

/**
 * Hydrogen bonds per pair — the real ledger. A·T is held by two, G·C by
 * three, which is why a GC-rich strand is harder to open and melts higher.
 */
export const H_BONDS: Record<Base, 2 | 3> = { A: 2, T: 2, G: 3, C: 3 };

/** Base → scale degree, in semitones. Four bases, four distinct degrees. */
export const DEGREE: Record<Base, number> = { A: 0, C: 3, G: 7, T: 10 };

/** The inverse of DEGREE — the map only earns its place because this exists. */
export const BASE_OF_DEGREE: Record<number, Base> = { 0: "A", 3: "C", 7: "G", 10: "T" };

/** Where the melody sits. A minor pentatonic on A, low enough to be calm. */
export const MELODY_ROOT_MIDI = 45;
/** How many bases share an octave before the line steps up. */
export const OCTAVE_RUN = 8;

export function isBase(b: string): b is Base {
  return b === "A" || b === "T" || b === "G" || b === "C";
}

export function parseSequence(text: string): Base[] {
  const out: Base[] = [];
  for (const ch of text.toUpperCase()) {
    if (isBase(ch)) out.push(ch);
    if (out.length >= MAX_BASES) break;
  }
  return out;
}

// ——— the two strands ————————————————————————————————————————————

/** The other strand, read off base by base. */
export function complement(seq: Base[]): Base[] {
  return seq.map((b) => COMPLEMENT[b]);
}

/** The complement of the complement is the strand you started with. */
export function isComplementary(a: Base[], b: Base[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (COMPLEMENT[a[i]] !== b[i]) return false;
  return true;
}

/** RNA: the same code with uracil where thymine stood. */
export function transcribe(seq: Base[]): string {
  return complement(seq)
    .map((b) => (b === "T" ? "U" : b))
    .join("");
}

/** ...and back, so the transcript is a representation and not a loss. */
export function reverseTranscribe(rna: string): Base[] {
  const out: Base[] = [];
  for (const ch of rna.toUpperCase()) {
    const dna = ch === "U" ? "A" : ch === "A" ? "T" : ch === "G" ? "C" : ch === "C" ? "G" : null;
    if (dna) out.push(dna as Base);
  }
  return out;
}

// ——— the ledger: what holds the ladder shut ——————————————————————

/** Every hydrogen bond in the duplex. */
export function hydrogenBonds(seq: Base[]): number {
  let n = 0;
  for (const b of seq) n += H_BONDS[b];
  return n;
}

/** Bonds already broken after unzipping the first `k` pairs, in order. */
export function unzipEnergy(seq: Base[], k: number): number {
  const upto = Math.max(0, Math.min(seq.length, Math.floor(k)));
  let n = 0;
  for (let i = 0; i < upto; i++) n += H_BONDS[seq[i]];
  return n;
}

export function gcContent(seq: Base[]): number {
  if (seq.length === 0) return 0;
  let gc = 0;
  for (const b of seq) if (b === "G" || b === "C") gc += 1;
  return gc / seq.length;
}

/**
 * The Wallace rule: 2 °C per A·T pair, 4 °C per G·C pair. Crude for long
 * strands and exactly right for the short ones this room holds — and, more
 * to the point, a real number rather than a decorative one.
 */
export function meltingTemp(seq: Base[]): number {
  let t = 0;
  for (const b of seq) t += b === "G" || b === "C" ? 4 : 2;
  return t;
}

/**
 * How far a strand is open at a given temperature: the pairs melt in order
 * from the end, the weak A·T rungs giving first. 0 = shut, 1 = fully open.
 */
export function openFraction(seq: Base[], temperature: number): number {
  if (seq.length === 0) return 0;
  const tm = meltingTemp(seq);
  if (tm <= 0) return 1;
  const budget = Math.max(0, temperature) * seq.length * 0.04;
  let spent = 0;
  let opened = 0;
  for (const b of seq) {
    const cost = H_BONDS[b];
    if (spent + cost > budget) break;
    spent += cost;
    opened += 1;
  }
  return opened / seq.length;
}

// ——— annealing: what one strand does to another ————————————————————

/** A probe shorter than this cannot find its place — it is noise, not a site. */
export const MIN_PROBE = 4;

export type AnnealSite = {
  /** Where on the template the probe's first base sits. */
  index: number;
  /** 0..1 — the fraction of the probe that is truly complementary there. */
  score: number;
  /** Hydrogen bonds actually formed — the real ledger, 2 per A·T, 3 per G·C. */
  bonds: number;
};

/**
 * Where a loose fragment finds its home on a template: the offset whose
 * complementarity is highest, ties going to the earliest site so the search
 * is deterministic. This is sequence recognition, not proximity — a probe
 * that matches nowhere returns its best bad site with a low score, and the
 * room is free to let it drift on.
 */
export function bestAnnealSite(template: Base[], probe: Base[]): AnnealSite | null {
  if (probe.length < MIN_PROBE || template.length < probe.length) return null;
  let best: AnnealSite | null = null;
  for (let off = 0; off + probe.length <= template.length; off++) {
    let matched = 0;
    let bonds = 0;
    for (let k = 0; k < probe.length; k++) {
      if (COMPLEMENT[template[off + k]] === probe[k]) {
        matched += 1;
        bonds += H_BONDS[probe[k]];
      }
    }
    const score = matched / probe.length;
    if (!best || score > best.score) best = { index: off, score, bonds };
  }
  return best;
}

/**
 * Whether a duplex of `bonds` hydrogen bonds over `pairs` rungs survives a
 * given temperature (0..1 of the room's own heat axis). The threshold is the
 * bond density, so a G·C-rich fragment genuinely outlasts an A·T-rich one of
 * the same length — the ledger doing the work, not a constant.
 */
export const DENATURE_HEAT = 0.92;
export function annealHolds(bonds: number, pairs: number, temperature: number): boolean {
  if (pairs <= 0) return false;
  const density = bonds / (pairs * 3); // 1 for an all-G·C duplex, ⅔ for all-A·T
  return temperature < density * DENATURE_HEAT;
}

/**
 * Repair: an annealed fragment is read into the template, so the template
 * becomes the complement of the probe across the site. A perfectly matched
 * probe changes nothing (a repair enzyme that rewrites a correct strand is
 * a bug); a mismatched one changes exactly the mismatched positions, and
 * never the strand's length.
 */
export function spliceInto(template: Base[], probe: Base[], index: number): Base[] {
  if (index < 0 || probe.length === 0 || index + probe.length > template.length) return template;
  const out = [...template];
  for (let k = 0; k < probe.length; k++) out[index + k] = COMPLEMENT[probe[k]];
  return out;
}

/**
 * A fragment cut from a template, already complementary to it — what a
 * primer or a repair patch actually is. `drift` mismatches that many bases
 * deterministically, so a patch can arrive imperfect and still find its site.
 */
export function fragmentFrom(template: Base[], index: number, length: number, drift: number, seed: number): Base[] {
  const n = Math.max(MIN_PROBE, Math.min(template.length, Math.floor(length)));
  const start = Math.max(0, Math.min(template.length - n, Math.floor(index)));
  const out = complement(template.slice(start, start + n));
  const d = Math.max(0, Math.min(n, Math.floor(drift)));
  // DISTINCT sites, drawn from a seeded shuffle. Two mismatches rolled
  // independently can land on the same base and undo each other, which
  // would silently hand back a perfect probe when an imperfect one was
  // asked for — the shuffle makes `drift` mean what it says.
  const order: number[] = [];
  for (let k = 0; k < n; k++) order.push(k);
  const rng = mulberry32(hashSeed(seed, n, start));
  for (let k = n - 1; k > 0; k--) {
    const j = Math.floor(rng() * (k + 1));
    const tmp = order[k];
    order[k] = order[j];
    order[j] = tmp;
  }
  let seq = out;
  for (let k = 0; k < d; k++) seq = mutate(seq, order[k], hashSeed(seed, order[k], 3));
  return seq;
}

// ——— the melody: the same object, heard ————————————————————————

/**
 * Sequence → melody. The degree names the base; the octave names how far
 * along the strand you are, so the line climbs as the polymerase runs.
 */
export function melodyOf(seq: Base[]): number[] {
  return seq.map((b, i) => MELODY_ROOT_MIDI + 12 * Math.floor(i / OCTAVE_RUN) + DEGREE[b]);
}

/**
 * ...and melody → sequence. The octave is stripped and the degree read
 * back, so the strand and its tune are one object seen twice. A melody
 * carrying a degree no base names yields null — nothing is guessed.
 */
export function sequenceFromMelody(midis: number[]): Base[] | null {
  const out: Base[] = [];
  for (const m of midis) {
    const rel = Math.round(m) - MELODY_ROOT_MIDI;
    const degree = ((rel % 12) + 12) % 12;
    const base = BASE_OF_DEGREE[degree];
    if (!base) return null;
    out.push(base);
  }
  return out;
}

/** The complement's melody — the same tune, in the mirror. */
export function complementMelody(seq: Base[]): number[] {
  return melodyOf(complement(seq));
}

// ——— determinism ————————————————————————————————————————————

export function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h ^= Math.round(p) | 0;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sequenceFromSeed(seed: number, length: number): Base[] {
  const n = Math.max(MIN_BASES, Math.min(MAX_BASES, Math.floor(length)));
  const rng = mulberry32(seed >>> 0);
  const out: Base[] = [];
  for (let i = 0; i < n; i++) out.push(BASES[Math.floor(rng() * 4)]);
  return out;
}

/**
 * A substitution at one site. It is a substitution, not a coin flip: the
 * base that arrives is never the base that left, so a mutation always
 * changes the strand and therefore always changes the tune.
 */
export function mutate(seq: Base[], index: number, seed: number): Base[] {
  if (index < 0 || index >= seq.length) return seq;
  const rng = mulberry32(hashSeed(seed, index, seq.length));
  const others = BASES.filter((b) => b !== seq[index]);
  const next = others[Math.floor(rng() * others.length)];
  const out = [...seq];
  out[index] = next;
  return out;
}

/**
 * A touch rewrite: the hand steps the base along A→T→G→C→A. Deterministic,
 * no seed — the same rung pressed twice always lands on the same next letter,
 * so the nucleotide itself is what you feel changing.
 */
export function cycleBase(seq: Base[], index: number): Base[] {
  if (index < 0 || index >= seq.length) return seq;
  const at = BASES.indexOf(seq[index]);
  if (at < 0) return seq;
  const out = [...seq];
  out[index] = BASES[(at + 1) % BASES.length];
  return out;
}

/**
 * The mutation temperature as a rate: how many sites per second the world
 * rewrites. Zero at rest — nothing drifts unless the law is turned up.
 */
export const MUTATION_MAX_PER_S = 2.4;
export function mutationRate(temperature: number): number {
  const t = Math.min(1, Math.max(0, temperature));
  return MUTATION_MAX_PER_S * t * t;
}

// ——— geometry: the helix the eye reads ——————————————————————————

/** B-DNA: ten and a half bases per turn, 3.4 nm of rise per turn. */
export const BASES_PER_TURN = 10.5;

/**
 * The two backbones and the rung between them at base `i`, in unit space:
 * x is across the helix, y is along it. `unzip` (0..1) pulls the strands
 * apart from the start; `supercoil` winds extra turns into the length.
 */
export function rungAt(
  i: number,
  count: number,
  unzip: number,
  supercoil = 1,
): { y: number; x1: number; x2: number; depth: number; open: number } {
  const n = Math.max(1, count);
  const u = i / n;
  const phase = (i / BASES_PER_TURN) * Math.PI * 2 * supercoil;
  // How far this particular rung has been pulled apart: the ones nearest
  // the opened end give first, so the zipper runs in order.
  const open = Math.min(1, Math.max(0, (unzip * n - i) / Math.max(1, n * 0.18)));
  const spread = 1 + open * 2.4;
  return {
    y: u * 2 - 1,
    x1: Math.sin(phase) * spread,
    x2: -Math.sin(phase) * spread,
    depth: Math.cos(phase) * 0.5 + 0.5,
    open,
  };
}

/** How many pairs are actually apart at this unzip — a whole number. */
export function openPairs(count: number, unzip: number): number {
  return Math.max(0, Math.min(count, Math.round(unzip * count)));
}

/** Oldest retired first; the strand never grows past the cap. */
export function settleLength(seq: Base[]): Base[] {
  return seq.length <= MAX_BASES ? seq : seq.slice(seq.length - MAX_BASES);
}
