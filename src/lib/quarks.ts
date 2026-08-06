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
 * How deep a condensing hold must go before the vacuum can afford three
 * quarks instead of two. Under it the field pays for the cheap thing — a
 * quark and its own antiquark, one string; past it the hand has poured in
 * enough for a closed loop of three. The choice of meson or baryon is made
 * of duration alone, so it needs no control and no word.
 */
export const BARYON_DEPTH = 0.6;

/** What a condensing hold of this depth (0..1) can bind. Monotone in depth. */
export function kindForDepth(depth: number): HadronKind {
  return depth >= BARYON_DEPTH ? "triplet" : "pair";
}

/**
 * Rewrite a seed so it decodes to the wanted kind — the kind IS the low bit
 * (hadronFromSeed and snapChildren both rest on that), and this is the one
 * sanctioned way to say so. Idempotent, and everything else about the hadron
 * survives the rewrite.
 */
export function seedForKind(seed: number, kind: HadronKind): number {
  return (kind === "triplet" ? (seed >>> 0) | 1 : (seed >>> 0) & ~1) >>> 0;
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

// ——— what two hadrons do to each other: colour reconnection ———

/**
 * How near two hadrons must come, as a fraction of the smaller dimension,
 * before their flux tubes notice each other at all. Inside this the colour
 * fields overlap and a gluon can be traded; outside it each hadron is white
 * and the other one cannot see it — which is why nuclear forces are short
 * ranged even though the colour force never falls off.
 */
export const RECONNECT_REACH = 0.16;

/**
 * COLOUR RECONNECTION. Two hadrons brought close swap a constituent through
 * the gluon field, and the strings re-form across the pair: the tubes that
 * ran inside each hadron now run BETWEEN them, and when they part, each
 * leaves with a partner it did not arrive with.
 *
 * The rule the children obey — the only rule there is down here — is that
 * nothing may leave un-white. So the kinds are preserved as a multiset
 * (pair + pair → pair + pair, triplet + pair → triplet + pair): a triplet
 * cannot hand a quark to a pair without leaving two quarks behind, which is
 * not a colour singlet and therefore is not a thing.
 *
 * Deterministic and order-independent: recombine(a, b) and recombine(b, a)
 * describe the same event seen from either side, so they return the same
 * pair of children (as a set). Neither child is either parent — the whole
 * point is that a third thing walks away.
 */
export function recombineSeeds(seedA: number, seedB: number): [number, number] {
  const lo = Math.min(seedA >>> 0, seedB >>> 0);
  const hi = Math.max(seedA >>> 0, seedB >>> 0);
  const kindLo = hadronFromSeed(lo).kind;
  const kindHi = hadronFromSeed(hi).kind;
  let round = 0;
  for (;;) {
    const c1 = seedForKind(hashSeed(lo, hi, 0x9e3d, round), kindLo);
    const c2 = seedForKind(hashSeed(lo, hi, 0x51ed, round), kindHi);
    // a child that decodes to a parent is not a new thing; walk on
    if (c1 !== lo && c1 !== hi && c2 !== lo && c2 !== hi && c1 !== c2) return [c1, c2];
    round += 1;
    if (round > 64) return [seedForKind((lo ^ 0x5bf03635) >>> 0, kindLo), seedForKind((hi ^ 0x27d4eb2f) >>> 0, kindHi)];
  }
}

/**
 * DECONFINEMENT, and the reconfinement that always follows it. Heat the
 * vacuum past the point where the strings can hold and the quarks stop
 * belonging to any particular hadron — a plasma, briefly, the state the
 * whole universe was in for its first microsecond. It does not last: as it
 * cools every quark must find partners again, and what condenses out is a
 * fresh set of white hadrons carrying the same constituent census.
 *
 * Returns the seeds of the hadrons that freeze out of a plasma made from
 * `seeds`. Total constituent count is conserved exactly — the plasma cannot
 * create or destroy quarks, only re-sort them — and the freeze-out is
 * deterministic in (seeds, seed).
 */
export function reconfineSeeds(seeds: number[], seed: number): number[] {
  if (seeds.length === 0) return [];
  let quarks = 0;
  for (const s of seeds) quarks += constituentCount(hadronFromSeed(s));
  const rng = mulberry32(mix32(hashSeed(quarks, seeds.length, seed) || 1));
  const out: number[] = [];
  let left = quarks;
  let i = 0;
  while (left >= 2) {
    // a triplet only freezes out where three quarks are still available —
    // and never where taking three would strand a single quark with nothing
    // to bind to, because a lone quark is the one thing this room forbids
    const wantTriplet = left >= 3 && left !== 4 && (left === 3 || rng() < 0.42);
    const kind: HadronKind = wantTriplet ? "triplet" : "pair";
    out.push(seedForKind(hashSeed(seed, i, quarks, left), kind));
    left -= wantTriplet ? 3 : 2;
    i += 1;
  }
  return out;
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

// vacuumPairsAt(slot, fieldSeed) is a pure function of its inputs — same
// slot, same sparks, forever — and the room re-reads a ~64-slot lookback
// window every rAF tick (the dilation-safe render, not the reduced-motion
// one) so the same slot is recomputed hundreds of times over its life on
// screen. Memoize per fieldSeed, bounded so a long-running tab can't grow
// it without limit; callers only ever read the returned pairs (never
// mutate or retain them past the call), so handing back the cached array
// is safe.
const VACUUM_PAIRS_CACHE_CAP = 512;
const vacuumPairsCache = new Map<number, Map<number, VirtualPair[]>>();

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
  let bySlot = vacuumPairsCache.get(fieldSeed);
  if (!bySlot) {
    bySlot = new Map();
    vacuumPairsCache.set(fieldSeed, bySlot);
  } else {
    const cached = bySlot.get(slot);
    if (cached) return cached;
  }

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

  bySlot.set(slot, pairs);
  if (bySlot.size > VACUUM_PAIRS_CACHE_CAP) {
    // Map preserves insertion order — the first key is the oldest slot.
    const oldest = bySlot.keys().next().value;
    if (oldest !== undefined) bySlot.delete(oldest);
  }
  return pairs;
}
