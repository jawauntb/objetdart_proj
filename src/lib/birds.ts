/**
 * birds — pure flocking math for /birds.
 * Import-free boids: same seed = same initial flock.
 */

export type Bird = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  seed: number;
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

export function flockFromSeed(seed: number, count: number): Bird[] {
  const rng = mulberry32(seed >>> 0 || 1);
  const n = Math.max(1, Math.min(200, Math.floor(count)));
  const birds: Bird[] = [];
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2;
    const sp = 0.08 + rng() * 0.12;
    birds.push({
      id: i,
      x: 0.25 + rng() * 0.5,
      y: 0.2 + rng() * 0.35,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      seed: mix32(seed, i),
    });
  }
  return birds;
}

export type FlockForces = {
  separation: number;
  alignment: number;
  cohesion: number;
  windX: number;
  windY: number;
  /** Scare point in 0..1 space, or null. */
  scare: { x: number; y: number; strength: number } | null;
  maxSpeed: number;
};

function limit(vx: number, vy: number, max: number): { vx: number; vy: number } {
  const m = Math.hypot(vx, vy);
  if (m <= max || m < 1e-9) return { vx, vy };
  const s = max / m;
  return { vx: vx * s, vy: vy * s };
}

export function stepFlock(birds: Bird[], dt: number, f: FlockForces): Bird[] {
  const n = birds.length;
  if (n === 0) return birds;
  const out: Bird[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const b = birds[i];
    let sx = 0, sy = 0, sc = 0;
    let ax = 0, ay = 0, ac = 0;
    let cx = 0, cy = 0, cc = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const o = birds[j];
      const dx = b.x - o.x;
      const dy = b.y - o.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 0.012 * 0.012) {
        sx += dx;
        sy += dy;
        sc++;
      }
      if (d2 < 0.08 * 0.08) {
        ax += o.vx;
        ay += o.vy;
        ac++;
        cx += o.x;
        cy += o.y;
        cc++;
      }
    }
    let vx = b.vx + f.windX * dt;
    let vy = b.vy + f.windY * dt;
    if (sc > 0) {
      vx += (sx / sc) * f.separation * dt;
      vy += (sy / sc) * f.separation * dt;
    }
    if (ac > 0) {
      vx += (ax / ac - b.vx) * f.alignment * dt;
      vy += (ay / ac - b.vy) * f.alignment * dt;
    }
    if (cc > 0) {
      vx += (cx / cc - b.x) * f.cohesion * dt;
      vy += (cy / cc - b.y) * f.cohesion * dt;
    }
    if (f.scare) {
      const dx = b.x - f.scare.x;
      const dy = b.y - f.scare.y;
      const d = Math.hypot(dx, dy) + 1e-4;
      if (d < 0.35) {
        const push = ((0.35 - d) / 0.35) * f.scare.strength;
        vx += (dx / d) * push * dt;
        vy += (dy / d) * push * dt;
      }
    }
    // Soft world wrap bounds.
    let x = b.x + vx * dt;
    let y = b.y + vy * dt;
    if (x < -0.05) x += 1.1;
    if (x > 1.05) x -= 1.1;
    if (y < 0.05) {
      y = 0.05;
      vy = Math.abs(vy) * 0.4;
    }
    if (y > 0.72) {
      y = 0.72;
      vy = -Math.abs(vy) * 0.4;
    }
    const lim = limit(vx, vy, f.maxSpeed);
    out[i] = { ...b, x, y, vx: lim.vx, vy: lim.vy };
  }
  return out;
}

export function roostBird(birds: Bird[], idx: number): Bird[] {
  if (idx < 0 || idx >= birds.length) return birds;
  const next = birds.slice();
  const b = next[idx];
  next[idx] = { ...b, vx: b.vx * 0.1, vy: b.vy * 0.1, y: Math.min(0.7, b.y + 0.02) };
  return next;
}
