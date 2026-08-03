/**
 * mountain — pure peak helpers for /mountain (olympus band).
 * Import-free ridge, scree, and cairn math.
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

/** Sample a deterministic ridge height 0..1 at normalized x. */
export function ridgeHeight(nx: number, seed: number): number {
  const rng = mulberry32(mix32(seed, Math.round(nx * 64)));
  const x = Math.max(0, Math.min(1, nx));
  const peak = Math.pow(1 - Math.abs(x - 0.5) * 2, 1.35);
  const noise =
    Math.sin(x * 17.2 + seed) * 0.04 +
    Math.sin(x * 41.7 + seed * 0.3) * 0.02 +
    (rng() - 0.5) * 0.015;
  return Math.max(0, Math.min(1, peak * 0.92 + 0.08 + noise));
}

export type Scree = { x: number; y: number; vx: number; vy: number; seed: number; life: number };

export function kickScree(seed: number, x: number, y: number, intensity: number): Scree[] {
  const rng = mulberry32(seed >>> 0 || 1);
  const n = 4 + Math.floor(intensity * 10);
  const out: Scree[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      x,
      y,
      vx: (rng() - 0.5) * 0.35 * intensity,
      vy: 0.05 + rng() * 0.25 * intensity,
      seed: mix32(seed, i),
      life: 0.7 + rng() * 0.5,
    });
  }
  return out;
}

export function stepScree(list: Scree[], dt: number, gravity = 0.55): Scree[] {
  const out: Scree[] = [];
  for (const s of list) {
    const life = s.life - dt * 0.35;
    if (life <= 0 || s.y > 1.2) continue;
    out.push({
      ...s,
      x: s.x + s.vx * dt,
      y: s.y + s.vy * dt,
      vy: s.vy + gravity * dt,
      life,
    });
  }
  return out;
}

export type Cairn = { x: number; y: number; stones: number; seed: number };

export function placeCairn(seed: number, x: number, y: number, stones: number): Cairn {
  return {
    x,
    y,
    stones: Math.max(1, Math.min(7, Math.round(stones))),
    seed: seed >>> 0 || 1,
  };
}

export function snowLine(tSec: number, weather: number): number {
  return 0.22 + Math.sin(tSec * 0.05) * 0.02 - weather * 0.06;
}
