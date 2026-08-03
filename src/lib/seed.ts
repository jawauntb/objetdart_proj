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
