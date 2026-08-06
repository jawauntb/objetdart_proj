/**
 * seed — deterministic embryo morph for /seed.
 * Pure and import-free: same seed bits = same life, forever.
 */

export type SeedMorph = {
  seed: number;
  /** 0..1 husk integrity (1 intact, 0 fully split). */
  husk: number;
  /** 0..1 radicle length. */
  radicle: number;
  /** 0..1 cotyledon openness. */
  open: number;
  /** Hue lean 0..1. */
  hue: number;
  /** Mass / size scale. */
  mass: number;
  /** 0..1 water taken up. A dry seed does not germinate, whatever it is told. */
  water?: number;
};

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

export function mix32(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h ^= Math.round(p) & 0xffffffff;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function morphFromSeed(seed: number): SeedMorph {
  const rng = mulberry32(seed >>> 0 || 1);
  return {
    seed: seed >>> 0 || 1,
    husk: 1,
    radicle: 0,
    open: 0,
    hue: rng(),
    mass: 0.75 + rng() * 0.45,
    water: 0,
  };
}

/** Hold intensity grows the embryo; ceremony splits the husk. */
export function growMorph(m: SeedMorph, dtSec: number, pressure: number): SeedMorph {
  const p = Math.max(0, Math.min(1, pressure));
  const rate = 0.15 + p * 0.85;
  let husk = m.husk;
  let radicle = m.radicle;
  let open = m.open;
  radicle = Math.min(1, radicle + dtSec * rate * 0.35);
  if (radicle > 0.35) open = Math.min(1, open + dtSec * rate * 0.28);
  if (p > 0.85 && radicle > 0.55) husk = Math.max(0, husk - dtSec * 0.55);
  return { ...m, husk, radicle, open };
}

/** Shake rattles — can nick the husk without growing. */
export function rattleMorph(m: SeedMorph, intensity: number): SeedMorph {
  const i = Math.max(0, Math.min(1, intensity));
  if (i < 0.35) return m;
  return { ...m, husk: Math.max(0.15, m.husk - i * 0.08) };
}

export function restingEnergy(m: SeedMorph): number {
  return m.radicle * 0.45 + m.open * 0.35 + (1 - m.husk) * 0.2;
}

// ——— germination, stage by stage ————————————————————————————————
//
// A seed does not simply "grow". It takes up water until the husk gives, the
// radicle comes out first and always, the cotyledons follow, and the shoot is
// last. The order is the law: nothing here can happen out of turn.

export type GerminationStage = "dormant" | "imbibed" | "split" | "radicle" | "cotyledons" | "shoot";

export const GERMINATION_STAGES: readonly GerminationStage[] = [
  "dormant",
  "imbibed",
  "split",
  "radicle",
  "cotyledons",
  "shoot",
];

/** How much water a seed can hold before the husk gives. */
export const IMBIBE_FULL = 1;

/** The morph each stage stands for — read off the seed, never stored twice. */
export function stageOf(m: SeedMorph): GerminationStage {
  if (m.open >= 0.72 && m.radicle >= 0.72) return "shoot";
  if (m.open >= 0.3) return "cotyledons";
  if (m.radicle >= 0.28) return "radicle";
  if (m.husk <= 0.62) return "split";
  if ((m.water ?? 0) >= 0.45) return "imbibed";
  return "dormant";
}

export function stageIndex(m: SeedMorph): number {
  return GERMINATION_STAGES.indexOf(stageOf(m));
}

/**
 * One stage further along, and never further than one. Germination is
 * monotone: a seed that has split does not un-split, and the shoot is the
 * end of the road — asking again from there changes nothing.
 */
export function advanceStage(m: SeedMorph): SeedMorph {
  switch (stageOf(m)) {
    case "dormant":
      return { ...m, water: IMBIBE_FULL * 0.55, mass: m.mass * 1.04 };
    case "imbibed":
      return { ...m, husk: Math.min(m.husk, 0.55), mass: m.mass * 1.02 };
    case "split":
      return { ...m, radicle: Math.max(m.radicle, 0.36), husk: Math.min(m.husk, 0.4) };
    case "radicle":
      return { ...m, open: Math.max(m.open, 0.42), radicle: Math.max(m.radicle, 0.5) };
    case "cotyledons":
      return { ...m, open: Math.max(m.open, 0.8), radicle: Math.max(m.radicle, 0.8), husk: Math.min(m.husk, 0.12) };
    default:
      return m;
  }
}

/**
 * Water taken up. It saturates — a seed cannot drink more than it holds —
 * and a soaked seed softens its husk, which is the only reason the split
 * ever comes. Nothing here shrinks a seed.
 */
export function imbibe(m: SeedMorph, amount: number): SeedMorph {
  const a = Math.max(0, amount);
  if (a === 0) return m;
  const water = Math.min(IMBIBE_FULL, (m.water ?? 0) + a);
  const soften = water >= 0.45 ? a * 0.28 : 0;
  return {
    ...m,
    water,
    mass: Math.min(1.6, m.mass * (1 + a * 0.05)),
    husk: Math.max(0, m.husk - soften),
  };
}

/**
 * A daughter seed of a plant that made it all the way to shoot: its own
 * seed bits, deterministic in the parent's and in which one it is.
 */
export function offspringSeed(parent: number, index: number): number {
  let s = mix32(parent, index, 0x0f5e);
  if (s === (parent >>> 0)) s = mix32(s, 1);
  return s >>> 0;
}
