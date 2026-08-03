/**
 * coast — pure beach helpers for /coast.
 * Import-free: foam lace, wetness, tide line from small vectors.
 */

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

/** Tide line as a fraction of height (0 top, 1 bottom). */
export function tideLine(tSec: number, moon: number): number {
  const swell = Math.sin(tSec * 0.11) * 0.04 + Math.sin(tSec * 0.03 + 1.7) * 0.03;
  return 0.58 + moon * 0.1 + swell;
}

/** Wetness 0..1 below the tide line with a soft capillary fringe. */
export function sandWetness(ny: number, tide: number): number {
  if (ny < tide - 0.08) return 0;
  if (ny > tide + 0.02) return 1;
  return Math.max(0, Math.min(1, (ny - (tide - 0.08)) / 0.1));
}

export type FoamSpeck = { x: number; y: number; life: number; seed: number };

export function spawnFoam(seed: number, x: number, y: number, n: number): FoamSpeck[] {
  const rng = mulberry32(seed >>> 0 || 1);
  const out: FoamSpeck[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      x: x + (rng() - 0.5) * 0.08,
      y: y + (rng() - 0.5) * 0.02,
      life: 0.5 + rng() * 0.5,
      seed: mix32(seed, i, Math.round(x * 1000)),
    });
  }
  return out;
}

export function stepFoam(specks: FoamSpeck[], dt: number, wind: number): FoamSpeck[] {
  const out: FoamSpeck[] = [];
  for (const s of specks) {
    const life = s.life - dt * (0.35 + Math.abs(wind) * 0.2);
    if (life <= 0) continue;
    out.push({
      ...s,
      x: s.x + wind * dt * 0.04,
      y: s.y - dt * 0.01,
      life,
    });
  }
  return out;
}

/** Cap foam population — oldest (lowest life) retired first when over cap. */
export function capFoam(specks: FoamSpeck[], max: number): FoamSpeck[] {
  if (specks.length <= max) return specks;
  return specks.slice().sort((a, b) => b.life - a.life).slice(0, max);
}
