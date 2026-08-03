/**
 * Quarks — the confinement kernel for /quarks (plan W6, the confinement
 * band at 10⁻¹⁸ m, with the quanta below it). At this depth there are no
 * things left, only relations, and the kernel is the relations made exact.
 *
 * A hadron IS its seed: the low bit decides pair (quark–antiquark) or
 * triplet (three quarks); the color assignment always sums to white — a
 * pair carries one color and its own anti-color, a triplet carries each of
 * the three exactly once. The one great law is CONFINEMENT: the force in a
 * flux tube does not fall off with distance, it GROWS — monotone increasing
 * with stretch, the anti-spring, unlike every other force on the site. Pull
 * past SNAP_RATIO and the tube snaps, and the snap energy becomes a new
 * bound pair at the break: snapChildren is deterministic in the parent seed
 * and break index, and it never, under any input, yields a free quark.
 *
 * Pure and import-free by law: same seed = same hadron, forever. No DOM,
 * no audio, no side effects — node-testable (scripts/test-quarks.mjs).
 * The room that renders these (QuarksVacuum) owns canvas, sound, haptics.
 */

/** Hard population cap for the vacuum; births beyond it retire the oldest. */
export const MAX_HADRONS = 9;

/**
 * The three color charges, worn as the site's token families — candle
 * gold, sea teal, merlot. Index IS the charge.
 */
export const COLOR_TINTS = ["#E7AC52", "#4E7D8C", "#B25048"] as const;

/** Anti-colors: the same families dimmed toward the vacuum. */
export const ANTI_TINTS = ["#7A5527", "#243D4A", "#5E1717"] as const;

/** Linear string tension per unit of relative stretch. */
export const TUBE_TENSION = 1;

/** Superlinear reinforcement: the pull grows faster than the stretch. */
export const TUBE_RIGIDITY = 0.65;

/** Stretch ratio (length / rest) at which a flux tube snaps. */
export const SNAP_RATIO = 2.6;

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

export type HadronKind = "pair" | "triplet";

export type HadronMorph = {
  /** Pair = quark + antiquark, one tube; triplet = three quarks, a closed loop of three tubes. */
  kind: HadronKind;
  /** Color charge per constituent, 0..2 — indexes COLOR_TINTS. */
  colors: number[];
  /** true = the constituent carries the ANTI of its color. */
  antis: boolean[];
  /** Rest length per tube, as a fraction of the field's smaller dimension. */
  rest: number[];
  /** Core radius per constituent, as a fraction of the smaller dimension. */
  core: number;
  /** Whole-hadron rotation, radians/second (signed). */
  spin: number;
  /** Resting orientation, radians. */
  phase: number;
  drift: { ax: number; ay: number; rate: number };
  breathOffset: number;
  /** Chromatic voice offset, 0..11 semitones. */
  voice: number;
};

/**
 * The tube list for a kind: which constituents each flux tube joins.
 * A pair holds one string; a triplet closes a loop of three.
 */
export function tubesOf(kind: HadronKind): Array<[number, number]> {
  return kind === "pair" ? [[0, 1]] : [[0, 1], [1, 2], [2, 0]];
}

/**
 * Decode a seed into a full hadron. Pure: same seed, same hadron. The low
 * bit of the seed IS the kind — snapChildren relies on this to write the
 * kind of each child into its seed.
 */
export function hadronFromSeed(seed: number): HadronMorph {
  const s = seed >>> 0;
  const kind: HadronKind = (s & 1) === 1 ? "triplet" : "pair";
  const rng = mulberry32(mix32(s || 1));

  let colors: number[];
  let antis: boolean[];
  if (kind === "pair") {
    // one color and its own anti-color: white by cancellation
    const c = Math.floor(rng() * 3);
    colors = [c, c];
    antis = [false, true];
  } else {
    // each of the three colors exactly once: white by completion
    colors = [0, 1, 2];
    for (let i = colors.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = colors[i];
      colors[i] = colors[j];
      colors[j] = t;
    }
    antis = [false, false, false];
  }

  const tubeCount = kind === "pair" ? 1 : 3;
  const rest: number[] = [];
  for (let i = 0; i < tubeCount; i++) rest.push(0.1 + rng() * 0.05);

  return {
    kind,
    colors,
    antis,
    rest,
    core: 0.011 + rng() * 0.007,
    spin: (0.05 + rng() * 0.22) * (rng() < 0.5 ? -1 : 1),
    phase: rng() * Math.PI * 2,
    drift: { ax: rng() * Math.PI * 2, ay: rng() * Math.PI * 2, rate: 0.04 + rng() * 0.1 },
    breathOffset: rng() * 7,
    voice: Math.floor(rng() * 12),
  };
}

/** How many constituents a hadron binds. Never 1: nothing here can be alone. */
export function constituentCount(morph: HadronMorph): number {
  return morph.colors.length;
}

/**
 * Net color charge, one channel per color: a plain color counts +1 in its
 * channel, an anti-color −1. White means every channel carries the same
 * load — the pair cancels to (0,0,0), the triplet completes to (1,1,1).
 */
export function colorCharge(morph: HadronMorph): [number, number, number] {
  const q: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < morph.colors.length; i++) {
    q[morph.colors[i]] += morph.antis[i] ? -1 : 1;
  }
  return q;
}

/** True when the hadron is color-neutral (all channels equal). */
export function isWhite(morph: HadronMorph): boolean {
  const q = colorCharge(morph);
  return q[0] === q[1] && q[1] === q[2];
}

/**
 * The confinement force law — the room's one great law, and the sign that
 * distinguishes it from every other force on the site: it does NOT fall
 * off with distance. Below rest the tube is slack (zero force — quarks
 * close together barely feel each other: asymptotic freedom). Beyond rest
 * the pull is strictly INCREASING in the stretch, linear plus superlinear,
 * the anti-spring. Compare an inverse-square force, which only ever lets
 * go; this one never does.
 */
export function confinementForce(length: number, rest: number): number {
  if (!(rest > 0)) return 0;
  const x = Math.max(0, length / rest - 1);
  return TUBE_TENSION * x + TUBE_RIGIDITY * x * x;
}

/** Whether a tube stretched to `length` over rest `rest` snaps. */
export function shouldSnap(length: number, rest: number): boolean {
  return rest > 0 && length / rest >= SNAP_RATIO;
}

/**
 * The pair-creation law. Snapping a tube does not free a quark — the snap
 * energy condenses a fresh quark–antiquark pair at the break, and every
 * loose end is re-bound on the spot:
 *
 *   pair    —snap→  pair + pair       (each old end takes a new partner)
 *   triplet —snap→  triplet + pair    (the loop reforms; the torn quark
 *                                      leaves with the new antiquark)
 *
 * Deterministic in (parentSeed, breakIndex); the kind of each child is
 * written into the low bit of its seed, so decode agrees by construction.
 * There is no input for which a child binds fewer than two constituents.
 */
export function snapChildren(parentSeed: number, breakIndex: number): number[] {
  const parent = hadronFromSeed(parentSeed);
  const tubeCount = parent.kind === "pair" ? 1 : 3;
  const k = ((breakIndex % tubeCount) + tubeCount) % tubeCount;
  const h1 = hashSeed(parentSeed, k, 0x51a9);
  const h2 = hashSeed(parentSeed, k, 0xb407);
  if (parent.kind === "pair") {
    return [(h1 & ~1) >>> 0, (h2 & ~1) >>> 0];
  }
  return [(h1 | 1) >>> 0, (h2 & ~1) >>> 0];
}

/**
 * Enforce the population cap: the oldest residents (front of the list,
 * which the room keeps in arrival order) annihilate first, gracefully,
 * never the new.
 */
export function settlePopulation<T>(
  items: T[],
  cap: number = MAX_HADRONS,
): { kept: T[]; retired: T[] } {
  const over = Math.max(0, items.length - Math.max(1, cap));
  return { kept: items.slice(over), retired: items.slice(0, over) };
}

// ——— The vacuum that is never empty ———

/** Width of one vacuum scheduling slot on the shared clock, ms. */
export const VACUUM_SLOT_MS = 150;

/**
 * Longest a virtual pair can live, ms. The renderer sizes its lookback
 * window from this, so a pair may never outlive it or it would pop out of
 * existence mid-life instead of annihilating.
 */
export const VACUUM_MAX_LIFE_MS = 1100;

export type VirtualPair = {
  /** Birth position, 0..1 of the field. */
  nx: number;
  ny: number;
  /** Color charge of the pair, 0..2 (the partner carries the anti). */
  color: number;
  /** How long the pair exists before annihilating, ms. */
  lifeMs: number;
  /** Axis along which the two virtual partners briefly separate. */
  angle: number;
  /** Peak separation, as a fraction of the smaller dimension. */
  sep: number;
};

/**
 * Deterministic seeded scheduling of the vacuum's seethe: which virtual
 * pairs, if any, spark into being in time slot `slot`. Same slot, same
 * sparks, forever — the vacuum is alive but it is not random.
 *
 * A slot sparks a handful or rests entirely, so the seethe is uneven the
 * way a real fluctuation is: bursts and lulls, never a metronome and never
 * a grid. The counts are deliberately unequal — the vacuum is never empty,
 * but it is never busy either.
 */
export function vacuumPairsAt(slot: number, fieldSeed: number): VirtualPair[] {
  const rng = mulberry32(mix32(hashSeed(slot, fieldSeed, 0xacc) || 1));
  const r = rng();
  const count = r < 0.12 ? 0 : r < 0.3 ? 1 : r < 0.54 ? 2 : r < 0.76 ? 3 : r < 0.92 ? 4 : 5;
  const pairs: VirtualPair[] = [];
  for (let i = 0; i < count; i++) {
    pairs.push({
      nx: 0.05 + rng() * 0.9,
      ny: 0.08 + rng() * 0.84,
      color: Math.floor(rng() * 3),
      lifeMs: 420 + rng() * (VACUUM_MAX_LIFE_MS - 420),
      angle: rng() * Math.PI * 2,
      sep: 0.008 + rng() * 0.018,
    });
  }
  return pairs;
}
