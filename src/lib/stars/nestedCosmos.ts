/**
 * Nested cosmos helpers for /stars — camera, zoom layers, automata, persistence.
 * Visual DNA stays in Stars.tsx; this owns the spatial / memory contracts.
 */

export type LayerId = "galactic" | "cluster" | "system" | "local";

export type Camera = {
  panX: number; // normalized world offset (0.5 = centered)
  panY: number;
  zoom: number;
};

export type LayerMemory = {
  bornStars: unknown[];
  blackHoles: unknown[];
  consumedSeedIds: number[];
};

export type CosmicMemoryV2 = {
  version: 2;
  layers: Partial<Record<LayerId, LayerMemory>>;
  camera?: Camera;
};

export const LAYER_ORDER: LayerId[] = ["galactic", "cluster", "system", "local"];

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 14;
export const ZOOM_STEP = 0.55;

/** Zoom bands: galactic 1–2, cluster 2–4, system 4–8, local 8–14 */
export function layerFromZoom(zoom: number): LayerId {
  if (zoom < 2) return "galactic";
  if (zoom < 4) return "cluster";
  if (zoom < 8) return "system";
  return "local";
}

export function layerLabel(id: LayerId): string {
  return id;
}

/** Soft crossfade weight toward the next denser layer near band edges. */
export function layerBlend(zoom: number): { primary: LayerId; secondary: LayerId; t: number } {
  const primary = layerFromZoom(zoom);
  const edges: Array<{ at: number; a: LayerId; b: LayerId }> = [
    { at: 2, a: "galactic", b: "cluster" },
    { at: 4, a: "cluster", b: "system" },
    { at: 8, a: "system", b: "local" },
  ];
  for (const e of edges) {
    const d = zoom - e.at;
    if (Math.abs(d) < 0.35) {
      const t = d < 0 ? 0.5 + d / 0.7 : 0.5 + d / 0.7;
      return {
        primary: d < 0 ? e.a : e.b,
        secondary: d < 0 ? e.b : e.a,
        t: Math.max(0, Math.min(1, d < 0 ? 1 - (0.35 + d) / 0.7 : (0.35 - d) / 0.7)),
      };
    }
  }
  return { primary, secondary: primary, t: 0 };
}

export type LayerProfile = {
  id: LayerId;
  seed: number;
  starCount: number;
  bandFrac: number;
  nebulaCount: number;
  bhCount: number;
  galaxyCount: number;
  planetCount: number;
  quasarCount: number;
  sizeScale: number;
  weatherBias: number; // multiplies ambient event rate
};

export const LAYER_PROFILES: Record<LayerId, LayerProfile> = {
  galactic: {
    id: "galactic",
    seed: 0xc0ffee,
    starCount: 520,
    bandFrac: 0.28,
    nebulaCount: 5,
    bhCount: 2,
    galaxyCount: 2,
    planetCount: 5,
    quasarCount: 0,
    sizeScale: 1,
    weatherBias: 1,
  },
  cluster: {
    id: "cluster",
    seed: 0xa11ce5,
    starCount: 420,
    bandFrac: 0.18,
    nebulaCount: 7,
    bhCount: 3,
    galaxyCount: 1,
    planetCount: 4,
    quasarCount: 3,
    sizeScale: 1.15,
    weatherBias: 1.25,
  },
  system: {
    id: "system",
    seed: 0x5157e4,
    starCount: 280,
    bandFrac: 0.08,
    nebulaCount: 4,
    bhCount: 1,
    galaxyCount: 0,
    planetCount: 8,
    quasarCount: 1,
    sizeScale: 1.55,
    weatherBias: 1.1,
  },
  local: {
    id: "local",
    seed: 0x10ca1,
    starCount: 180,
    bandFrac: 0.04,
    nebulaCount: 3,
    bhCount: 1,
    galaxyCount: 0,
    planetCount: 3,
    quasarCount: 0,
    sizeScale: 2.2,
    weatherBias: 1.4,
  },
};

export const COSMIC_STORAGE_V2 = "objetdart:stars:cosmic:v2";
export const COSMIC_STORAGE_V1 = "objetdart:stars:cosmic:v1";
export const MAX_BORN_STARS_PER_LAYER = 96;
export const MAX_USER_BLACK_HOLES = 12;

export const AUTO_W = 24;
export const AUTO_H = 16;

export function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createAutomata(seed: number): Float32Array {
  const rng = makeRng(seed ^ 0xA07);
  const g = new Float32Array(AUTO_W * AUTO_H);
  for (let i = 0; i < g.length; i++) g[i] = rng() * 0.35;
  return g;
}

/** Conway-ish density step: birth from neighbors, decay when sparse. */
export function tickAutomata(grid: Float32Array): Float32Array {
  const next = new Float32Array(grid.length);
  for (let y = 0; y < AUTO_H; y++) {
    for (let x = 0; x < AUTO_W; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const xx = (x + dx + AUTO_W) % AUTO_W;
          const yy = (y + dy + AUTO_H) % AUTO_H;
          sum += grid[yy * AUTO_W + xx];
          n++;
        }
      }
      const avg = sum / n;
      const cur = grid[y * AUTO_W + x];
      // hot neighborhoods ignite; lonely cells cool; mid stays simmering
      let v = cur * 0.82 + avg * 0.28;
      if (avg > 0.55 && cur > 0.2) v += 0.12;
      if (avg < 0.18) v *= 0.72;
      next[y * AUTO_W + x] = Math.max(0, Math.min(1, v));
    }
  }
  return next;
}

export function heatAutomata(grid: Float32Array, nx: number, ny: number, amount: number): void {
  const cx = Math.max(0, Math.min(AUTO_W - 1, Math.floor(nx * AUTO_W)));
  const cy = Math.max(0, Math.min(AUTO_H - 1, Math.floor(ny * AUTO_H)));
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const xx = (cx + dx + AUTO_W) % AUTO_W;
      const yy = (cy + dy + AUTO_H) % AUTO_H;
      const w = dx === 0 && dy === 0 ? 1 : 0.45;
      const i = yy * AUTO_W + xx;
      grid[i] = Math.max(0, Math.min(1, grid[i] + amount * w));
    }
  }
}

export function sampleAutomata(grid: Float32Array, nx: number, ny: number): number {
  const cx = Math.max(0, Math.min(AUTO_W - 1, Math.floor(nx * AUTO_W)));
  const cy = Math.max(0, Math.min(AUTO_H - 1, Math.floor(ny * AUTO_H)));
  return grid[cy * AUTO_W + cx] ?? 0;
}

export function clampZoom(z: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
}

/** Soft world clamp for matter placement (stars / holes). */
export function clampPan(v: number): number {
  return Math.max(0.02, Math.min(0.98, v));
}

/**
 * Keep the camera from looking past the seeded field.
 * At zoom≈1 the view is locked to center (no black margins);
 * panning unlocks as you zoom deeper.
 */
export function clampPanForZoom(v: number, zoom: number): number {
  const z = Math.max(ZOOM_MIN, zoom);
  const half = 0.5 / z;
  const pad = 0.015;
  const min = half + pad;
  const max = 1 - half - pad;
  if (min >= max) return 0.5;
  return Math.max(min, Math.min(max, v));
}

/** Zoom toward a screen point — keeps that sky point under the cursor/pinch. */
export function zoomAtScreen(
  cam: Camera,
  screenX: number,
  screenY: number,
  nextZoom: number,
  w: number,
  h: number,
): Camera {
  const z0 = Math.max(0.001, cam.zoom);
  const z1 = clampZoom(nextZoom);
  const worldX = cam.panX + (screenX - w * 0.5) / (w * z0);
  const worldY = cam.panY + (screenY - h * 0.5) / (h * z0);
  return {
    zoom: z1,
    panX: clampPanForZoom(worldX - (screenX - w * 0.5) / (w * z1), z1),
    panY: clampPanForZoom(worldY - (screenY - h * 0.5) / (h * z1), z1),
  };
}

export function panByScreen(cam: Camera, dx: number, dy: number, w: number, h: number): Camera {
  const z = Math.max(0.001, cam.zoom);
  return {
    zoom: cam.zoom,
    panX: clampPanForZoom(cam.panX - dx / (w * z), z),
    panY: clampPanForZoom(cam.panY - dy / (h * z), z),
  };
}

export function screenToSky(cam: Camera, x: number, y: number, w: number, h: number): { nx: number; ny: number } {
  const z = Math.max(0.001, cam.zoom);
  return {
    nx: clampPan(cam.panX + (x - w * 0.5) / (w * z)),
    ny: clampPan(cam.panY + (y - h * 0.5) / (h * z)),
  };
}

export function skyToScreen(
  cam: Camera,
  nx: number,
  ny: number,
  w: number,
  h: number,
  rotAng = 0,
): { x: number; y: number } {
  const z = cam.zoom;
  let bx = (nx - cam.panX) * w;
  let by = (ny - cam.panY) * h;
  if (rotAng !== 0) {
    const cs = Math.cos(rotAng);
    const sn = Math.sin(rotAng);
    const rx = bx * cs - by * sn;
    const ry = bx * sn + by * cs;
    bx = rx;
    by = ry;
  }
  return {
    x: w * 0.5 + bx * z,
    y: h * 0.5 + by * z,
  };
}

export function emptyLayerMemory(): LayerMemory {
  return { bornStars: [], blackHoles: [], consumedSeedIds: [] };
}

export function loadCosmicMemoryV2(): CosmicMemoryV2 {
  const empty: CosmicMemoryV2 = { version: 2, layers: {} };
  if (typeof window === "undefined") return empty;
  try {
    const v2 = localStorage.getItem(COSMIC_STORAGE_V2);
    if (v2) {
      const parsed = JSON.parse(v2) as CosmicMemoryV2;
      if (parsed?.version === 2 && parsed.layers) return parsed;
    }
    // migrate v1 → galactic layer
    const v1 = localStorage.getItem(COSMIC_STORAGE_V1);
    if (v1) {
      const old = JSON.parse(v1) as { bornStars?: unknown[]; blackHoles?: unknown[] };
      return {
        version: 2,
        layers: {
          galactic: {
            bornStars: Array.isArray(old.bornStars) ? old.bornStars : [],
            blackHoles: Array.isArray(old.blackHoles) ? old.blackHoles : [],
            consumedSeedIds: [],
          },
        },
      };
    }
  } catch {
    /* noop */
  }
  return empty;
}

export function saveCosmicMemoryV2(mem: CosmicMemoryV2): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(COSMIC_STORAGE_V2, JSON.stringify(mem));
  } catch {
    /* noop */
  }
}

/** Soft pairwise gravity between holes — nudges positions for multi-body dance. */
export function applyHoleNBody(
  holes: Array<{ id: string; nx: number; ny: number; mass: number }>,
  dt: number,
  well?: { nx: number; ny: number; mass: number } | null,
): Array<{ id: string; dnx: number; dny: number }> {
  const G = 0.00055;
  const out = holes.map((h) => ({ id: h.id, dnx: 0, dny: 0 }));
  for (let i = 0; i < holes.length; i++) {
    for (let j = i + 1; j < holes.length; j++) {
      const a = holes[i];
      const b = holes[j];
      const dx = b.nx - a.nx;
      const dy = b.ny - a.ny;
      const d2 = dx * dx + dy * dy + 0.0004;
      const d = Math.sqrt(d2);
      const f = (G * a.mass * b.mass) / d2;
      const fx = (dx / d) * f * dt;
      const fy = (dy / d) * f * dt;
      out[i].dnx += fx / Math.max(0.4, a.mass);
      out[i].dny += fy / Math.max(0.4, a.mass);
      out[j].dnx -= fx / Math.max(0.4, b.mass);
      out[j].dny -= fy / Math.max(0.4, b.mass);
    }
  }
  if (well && well.mass > 0.05) {
    for (let i = 0; i < holes.length; i++) {
      const a = holes[i];
      const dx = well.nx - a.nx;
      const dy = well.ny - a.ny;
      const d2 = dx * dx + dy * dy + 0.0004;
      const d = Math.sqrt(d2);
      const f = (G * 1.8 * well.mass * a.mass) / d2;
      out[i].dnx += (dx / d) * f * dt / Math.max(0.4, a.mass);
      out[i].dny += (dy / d) * f * dt / Math.max(0.4, a.mass);
    }
  }
  return out;
}

/** Find all mergeable pairs under threshold, closest first — for chained merges. */
export function rankMergePairs(
  holes: Array<{ id: string; nx: number; ny: number; mass: number }>,
  threshold = 0.075,
): Array<{ aId: string; bId: string; d: number }> {
  const pairs: Array<{ aId: string; bId: string; d: number }> = [];
  for (let i = 0; i < holes.length; i++) {
    for (let j = i + 1; j < holes.length; j++) {
      const d = Math.hypot(holes[i].nx - holes[j].nx, holes[i].ny - holes[j].ny);
      if (d < threshold) pairs.push({ aId: holes[i].id, bId: holes[j].id, d });
    }
  }
  pairs.sort((a, b) => a.d - b.d);
  return pairs;
}
