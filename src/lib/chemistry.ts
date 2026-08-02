/**
 * Chemistry — the molecular latent for /molecules (plan W6).
 *
 * A molecule IS its seed: one 32-bit number decodes deterministically into a
 * whole structure — topology (ring / chain / branched) from a small grammar,
 * bond angles, bond orders, heteroatom letters, a token-family tint, thermal
 * jitter modes, a conformational flex, a voice. Reactions are deterministic
 * too, and PINNED ORDER-INDEPENDENT: reactionProductSeed(a, b) ===
 * reactionProductSeed(b, a) — two reactants meet the same product no matter
 * which was touched first, so a reaction is a fact about the pair, not the
 * hand.
 *
 * Pure and import-free by law: same seed = same molecule, forever. No DOM,
 * no audio, no side effects — node-testable standalone
 * (scripts/test-chemistry.mjs). The room that renders these
 * (MoleculesField) owns canvas, sound, and haptics.
 */

/** Hard population cap for the field; condensations beyond it retire the oldest. */
export const MAX_MOLECULES = 18;

/**
 * The only colors a molecule may wear — ramps around the site tokens
 * (--candle #C8732A, --closed #7A1F1F, --sea #2C4A5C, --paper #F2EEE6),
 * each family ordered dark → light. Index = the low two seed bits.
 */
export const MOLECULE_FAMILIES = [
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

export type MoleculeTopology = "ring" | "chain" | "branched";

/** The vertex letters the structural-formula lens may write. */
export type AtomLetter = "C" | "N" | "O" | "S";

export type MolAtom = {
  /** Skeleton position, normalized so the whole frame fits a unit disc. */
  x: number;
  y: number;
  /** Orb size as a fraction of the molecule radius. */
  size: number;
  /** Element-ish identity; the lens letters heteroatoms only, as notation. */
  letter: AtomLetter;
  /** Ramp index inside the family. */
  tone: number;
};

export type MolBond = {
  /** Atom indices, a < b always (canonical, so duplicates are impossible). */
  a: number;
  b: number;
  order: 1 | 2;
};

export type MoleculeMorph = {
  topology: MoleculeTopology;
  atoms: MolAtom[];
  /**
   * The assembly order: condensation builds these front to back, one bond
   * at a time, and the last one closing is the bloom.
   */
  bonds: MolBond[];
  /** Body radius as a fraction of the field's smaller dimension. */
  radius: number;
  /** Tint family (index into MOLECULE_FAMILIES) — the low two seed bits. */
  family: 0 | 1 | 2 | 3;
  /** Slow whole-body rotation, radians/second (signed). */
  tumble: number;
  /** Thermal vibration: amplitude (fraction of radius) and rate. */
  jitter: { amp: number; rateHz: number };
  /** Conformational flexing: a slow breathing of the skeleton itself. */
  flex: { amp: number; rateHz: number; phase: number };
  /** Per-atom vibration phase offsets (one per atom). */
  modes: number[];
  drift: { ax: number; ay: number; rate: number };
  breathOffset: number;
  /** Chromatic voice offset, 0..11 semitones. */
  voice: number;
};

/** Zigzag backbone: unit steps, heading alternating ±bend about +x. */
function zigzag(n: number, bend: number): Array<{ x: number; y: number }> {
  const pts = [{ x: 0, y: 0 }];
  for (let i = 1; i < n; i++) {
    const ang = i % 2 === 1 ? bend : -bend;
    pts.push({ x: pts[i - 1].x + Math.cos(ang), y: pts[i - 1].y + Math.sin(ang) });
  }
  return pts;
}

function normalize(pts: Array<{ x: number; y: number }>): void {
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= pts.length;
  cy /= pts.length;
  let maxD = 0;
  for (const p of pts) {
    p.x -= cx;
    p.y -= cy;
    maxD = Math.max(maxD, Math.hypot(p.x, p.y));
  }
  const k = maxD > 1e-9 ? 1 / maxD : 1;
  for (const p of pts) {
    p.x *= k;
    p.y *= k;
  }
}

function bond(a: number, b: number, order: 1 | 2): MolBond {
  return a < b ? { a, b, order } : { a: b, b: a, order };
}

/** Decode a seed into a full molecule. Pure: same seed, same structure. */
export function moleculeFromSeed(seed: number): MoleculeMorph {
  const s = seed >>> 0;
  const family = (s & 3) as 0 | 1 | 2 | 3;
  const rng = mulberry32(mix32(s || 1));

  const roll = rng();
  const topology: MoleculeTopology = roll < 0.34 ? "ring" : roll < 0.7 ? "chain" : "branched";

  const pts: Array<{ x: number; y: number }> = [];
  const bonds: MolBond[] = [];

  if (topology === "ring") {
    const n = 3 + Math.floor(rng() * 6); // 3..8
    const phase = rng() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const th = phase + (i / n) * Math.PI * 2;
      pts.push({ x: Math.cos(th), y: Math.sin(th) });
    }
    // aromatic-ish alternation only when the parity allows it to close
    const alternate = n % 2 === 0 && rng() < 0.5;
    for (let i = 0; i < n; i++) {
      bonds.push(bond(i, (i + 1) % n, alternate && i % 2 === 0 ? 2 : 1));
    }
  } else if (topology === "chain") {
    const n = 2 + Math.floor(rng() * 7); // 2..8
    const bendAng = 0.5 + rng() * 0.25;
    pts.push(...zigzag(n, bendAng));
    for (let i = 0; i < n - 1; i++) {
      bonds.push(bond(i, i + 1, rng() < 0.18 ? 2 : 1));
    }
  } else {
    const m = 4 + Math.floor(rng() * 3); // backbone 4..6
    const bendAng = 0.5 + rng() * 0.25;
    pts.push(...zigzag(m, bendAng));
    for (let i = 0; i < m - 1; i++) {
      bonds.push(bond(i, i + 1, rng() < 0.14 ? 2 : 1));
    }
    // branches hang off distinct interior vertices, away from the backbone
    const interiors: number[] = [];
    for (let i = 1; i <= m - 2; i++) interiors.push(i);
    const k = 1 + Math.floor(rng() * Math.min(3, interiors.length)); // 1..min(3, m-2)
    const start = Math.floor(rng() * interiors.length);
    for (let j = 0; j < k; j++) {
      const at = interiors[(start + j) % interiors.length];
      // odd zigzag indices are peaks: the clear side is up; valleys point down
      const dir = at % 2 === 1 ? Math.PI / 2 : -Math.PI / 2;
      const sway = (rng() - 0.5) * 0.3;
      pts.push({
        x: pts[at].x + Math.cos(dir + sway) * 0.9,
        y: pts[at].y + Math.sin(dir + sway) * 0.9,
      });
      bonds.push(bond(at, pts.length - 1, 1));
    }
  }

  normalize(pts);

  const atoms: MolAtom[] = pts.map((p) => {
    const r = rng();
    const letter: AtomLetter = r < 0.68 ? "C" : r < 0.82 ? "N" : r < 0.94 ? "O" : "S";
    return {
      x: p.x,
      y: p.y,
      size: 0.12 + rng() * 0.07,
      letter,
      tone: 2 + Math.floor(rng() * 3),
    };
  });

  const modes = atoms.map(() => rng() * Math.PI * 2);

  return {
    topology,
    atoms,
    bonds,
    radius: 0.045 + rng() * 0.045 + atoms.length * 0.003,
    family,
    tumble: (0.05 + rng() * 0.22) * (rng() < 0.5 ? -1 : 1),
    jitter: { amp: 0.012 + rng() * 0.02, rateHz: 1.2 + rng() * 2.2 },
    flex: { amp: 0.03 + rng() * 0.05, rateHz: 0.12 + rng() * 0.28, phase: rng() * Math.PI * 2 },
    modes,
    drift: { ax: rng() * Math.PI * 2, ay: rng() * Math.PI * 2, rate: 0.1 + rng() * 0.26 },
    breathOffset: rng() * 7,
    voice: Math.floor(rng() * 12),
  };
}

/**
 * Reaction law, PINNED: order-independent. Two reactant seeds are sorted
 * before hashing, so the product is a property of the pair — whichever
 * molecule the ceremony began on, the same product condenses. The product
 * must be a new individual: collisions with either reactant re-roll
 * deterministically.
 */
export function reactionProductSeed(a: number, b: number): number {
  const lo = Math.min(a >>> 0, b >>> 0);
  const hi = Math.max(a >>> 0, b >>> 0);
  let round = 0;
  let p = hashSeed(lo, hi, round);
  while (p === lo || p === hi) {
    round += 1;
    p = hashSeed(lo, hi, round);
  }
  return p;
}

/**
 * Enforce the population cap: the oldest residents (front of the list, which
 * the room keeps in arrival order) retire first, gracefully, never the new.
 */
export function settlePopulation<T>(
  items: T[],
  cap: number = MAX_MOLECULES,
): { kept: T[]; retired: T[] } {
  const over = Math.max(0, items.length - Math.max(1, cap));
  return { kept: items.slice(over), retired: items.slice(0, over) };
}
