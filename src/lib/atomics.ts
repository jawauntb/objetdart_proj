/**
 * Atomics — the atomic latent for /atoms (plan W6).
 *
 * An atom IS its seed: one 32-bit number decodes deterministically into an
 * element-ish identity — an electron count, shells filled in order (1–4 of
 * them), an orbital lobe symmetry, a token-family tint, a precession, a
 * voice. Excitation is a pure map too: intensity decides how many levels an
 * electron jumps, always above the ground shells, never past the sixth ring.
 * Covalence is PINNED ORDER-INDEPENDENT: bondSeed(a, b) === bondSeed(b, a) —
 * a shared bond is a fact about the pair of atoms, not about which one the
 * ceremony began on.
 *
 * Pure and import-free by law: same seed = same atom, forever. No DOM, no
 * audio, no side effects — node-testable standalone (scripts/test-atomics.mjs).
 * The room that renders these (AtomsField) owns canvas, sound, and haptics.
 */

/** Hard population cap for the field; condensations beyond it retire the oldest. */
export const MAX_ATOMS = 8;

/** Electrons each shell may hold, small-world periodic table. */
export const SHELL_CAPACITY = [2, 8, 8, 4] as const;

/** The largest electron count the capacities admit (element 22 of this world). */
export const MAX_Z = 22;

/** Excited electrons never climb past this ring, ground shells included. */
export const MAX_RING = 6;

/**
 * The only colors an atom may wear — ramps around the site tokens
 * (--candle #C8732A, --closed #7A1F1F, --sea #2C4A5C, --paper #F2EEE6),
 * each family ordered dark → light. Index = the low two seed bits.
 */
export const ATOM_FAMILIES = [
  ["#9C5820", "#B36524", "#C8732A", "#DA8F3B", "#E7AC52", "#F2C56B"], // gold
  ["#4F1414", "#5E1717", "#7A1F1F", "#8E2B2B", "#9C3D33", "#B25048"], // merlot
  ["#1E3440", "#243D4A", "#2C4A5C", "#3A6172", "#4E7D8C", "#6997A4"], // sea
  ["#B8A87F", "#CFC2A6", "#DDD3BE", "#E8E2D5", "#F2EEE6", "#F7F3EA"], // parchment
] as const;

function mix32(n: number): number {
  let h = n >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Fold any integer parts into one 32-bit seed (order-sensitive). */
export function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h = mix32(h ^ Math.imul(Math.floor(p) | 0, 0x9e3779b1));
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type AtomMorph = {
  /** Electron count, 1..MAX_Z — the element-ish identity. */
  z: number;
  /** Number of occupied shells, 1..4 (minimal for z). */
  shells: number;
  /** Electrons per shell, filled in order, outer shell never empty. */
  electrons: number[];
  /** Orbital lobe symmetry, 2..6 — a function of the outer electrons. */
  lobes: number;
  /** Resting orientation of the lobes, radians. */
  lobeTilt: number;
  /** Cloud radius as a fraction of the field's smaller dimension. */
  radius: number;
  /** Tint family (index into ATOM_FAMILIES) — the low two seed bits. */
  family: 0 | 1 | 2 | 3;
  /** Lobe precession, radians/second (signed). */
  precess: number;
  /** Cloud shimmer: amplitude (fraction of radius) and rate. */
  hum: { amp: number; rateHz: number };
  /** Nucleus radius as a fraction of the cloud radius. */
  nucleus: number;
  drift: { ax: number; ay: number; rate: number };
  breathOffset: number;
  /** Chromatic voice offset, 0..11 semitones. */
  voice: number;
};

/** Decode a seed into a full atom. Pure: same seed, same atom. */
export function atomFromSeed(seed: number): AtomMorph {
  const s = seed >>> 0;
  const family = (s & 3) as 0 | 1 | 2 | 3;
  const rng = mulberry32(mix32(s || 1));

  const z = 1 + Math.floor(rng() * MAX_Z);
  const electrons: number[] = [];
  let rest = z;
  for (let i = 0; i < SHELL_CAPACITY.length && rest > 0; i++) {
    const take = Math.min(rest, SHELL_CAPACITY[i]);
    electrons.push(take);
    rest -= take;
  }
  const shells = electrons.length;
  const outer = electrons[shells - 1];
  const lobes = 2 + (outer % 5); // 2..6, a function of the valence

  return {
    z,
    shells,
    electrons,
    lobes,
    lobeTilt: rng() * Math.PI * 2,
    radius: 0.11 + rng() * 0.08,
    family,
    precess: (0.04 + rng() * 0.18) * (rng() < 0.5 ? -1 : 1),
    hum: { amp: 0.02 + rng() * 0.03, rateHz: 0.5 + rng() * 1.1 },
    nucleus: 0.055 + rng() * 0.04,
    drift: { ax: rng() * Math.PI * 2, ay: rng() * Math.PI * 2, rate: 0.05 + rng() * 0.14 },
    breathOffset: rng() * 7,
    voice: Math.floor(rng() * 12),
  };
}

/**
 * Excitation: how far an electron jumps when the atom is struck with the
 * given intensity (0..1). The target ring is always strictly above the
 * ground shells (something must visibly move) and never past MAX_RING.
 * Harder touch, bigger jump — monotone in intensity.
 */
export function excitedRing(morph: AtomMorph, intensity: number): number {
  const u = Math.max(0, Math.min(1, intensity));
  const jump = 1 + Math.min(2, Math.floor(u * 3)); // 1..3
  return Math.min(morph.shells + jump, MAX_RING);
}

/**
 * Covalence law, PINNED: order-independent. The two atom seeds are sorted
 * before hashing, so a shared bond is the same bond whichever atom the
 * ceremony began on.
 */
export function bondSeed(a: number, b: number): number {
  const lo = Math.min(a >>> 0, b >>> 0);
  const hi = Math.max(a >>> 0, b >>> 0);
  return hashSeed(lo, hi, 0x0b0d);
}

export type CovalentBond = {
  seed: number;
  /** Rest separation as a multiple of the two cloud radii summed. */
  rest: number;
  /** Chromatic tone of the bond's hum, 0..11 semitones. */
  tone: number;
  /** 0..1 — how brightly the merged lobes gleam. */
  gleam: number;
};

/** Decode the pair's bond. Pure and symmetric: covalentBond(a,b) === covalentBond(b,a). */
export function covalentBond(a: number, b: number): CovalentBond {
  const seed = bondSeed(a, b);
  const rng = mulberry32(mix32(seed || 1));
  return {
    seed,
    rest: 0.72 + rng() * 0.26,
    tone: Math.floor(rng() * 12),
    gleam: 0.4 + rng() * 0.5,
  };
}

/**
 * Enforce the population cap: the oldest residents (front of the list, which
 * the room keeps in arrival order) retire first, gracefully, never the new.
 */
export function settlePopulation<T>(
  items: T[],
  cap: number = MAX_ATOMS,
): { kept: T[]; retired: T[] } {
  const over = Math.max(0, items.length - Math.max(1, cap));
  return { kept: items.slice(over), retired: items.slice(0, over) };
}
