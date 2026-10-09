/**
 * lattice-forms — a lattice animal wearing any form this repo wrote.
 *
 * A lattice animal (jawauntb/lattice-animal, consciousmachine.me) is a
 * polyomino: whole-number cells in one 4-connected piece. Its cells are its
 * identity; they are never redrawn into another shape. What it can change is
 * what each cell *is*: in /stars a star with diffraction spikes, in /galaxy a
 * curl of arm dust, in /cells a membrane with a nucleus, in /quanta a ripple
 * of excitation — one form per component in this repo, read from each
 * component's syntax tree by `scripts/build-form-atlas.mjs` into
 * `src/data/form-atlas.generated.ts`.
 *
 * Everything here is pure and seeded: the same animal, form, seed and time
 * write the same instances. `src/lib/lattice-forms-layer.ts` draws them in one
 * instanced call; `src/components/LatticeVisitors.tsx` is the only consumer
 * that touches the page. `scripts/test-lattice-forms.mjs` pins the laws.
 */

import { FORM_ATLAS, FORM_KINDS } from "@/data/form-atlas.generated";

export type FormKind =
  | "orb" | "star" | "spiral" | "cell" | "quantum" | "orbit"
  | "flame" | "drop" | "petal" | "crystal" | "glyph" | "cloud";

export type FormParams = {
  glow: number;
  spin: number;
  pulse: number;
  jitter: number;
  drift: number;
  bonds: number;
  depth: number;
  detail: number;
  facets: number;
};

export type FormSpec = {
  id: string;
  component: string;
  rooms: string[];
  noun: string | null;
  tech: string;
  kind: string;
  palette: string[];
  params: FormParams;
};

/** The shader's index for each kind; `BOND_KIND` is the bridge between two cells. */
export const KIND_INDEX: Record<string, number> = Object.fromEntries(FORM_KINDS.map((k, i) => [k, i]));
export const BOND_KIND = FORM_KINDS.length;

export const FORMS: readonly FormSpec[] = FORM_ATLAS;
const BY_ID = new Map(FORMS.map((f) => [f.id, f]));
const BY_ROOM = new Map<string, FormSpec>();
for (const f of FORMS) for (const r of f.rooms) if (!BY_ROOM.has(r)) BY_ROOM.set(r, f);

export function formById(id: string | null | undefined): FormSpec | null {
  return id ? BY_ID.get(id) ?? null : null;
}

/** The form a room's own material wears; null for a key no component owns. */
export function formForRoom(room: string | null | undefined): FormSpec | null {
  return room ? BY_ROOM.get(room) ?? null : null;
}

// ——— seeded numbers (the seed is the whole state) ———

export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 — the same small generator the rooms seed with. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ——— the body ———

export type Cell = [number, number];

export type AnimalBody = {
  /** cells relative to the centroid, in cell units */
  cells: Float32Array;
  count: number;
  /** pairs of indices into `cells` that share an edge */
  bonds: Uint16Array;
  bondCount: number;
  /** half the larger extent, in cell units — what a caller scales by */
  radius: number;
};

/** Is this a lattice animal: whole cells, no repeats, one 4-connected piece? */
export function isLatticeAnimal(cells: readonly Cell[]): boolean {
  if (!cells.length) return false;
  const key = (x: number, y: number) => `${x},${y}`;
  const set = new Set<string>();
  for (const [x, y] of cells) {
    if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
    const k = key(x, y);
    if (set.has(k)) return false;
    set.add(k);
  }
  const seen = new Set<string>([key(cells[0][0], cells[0][1])]);
  const stack: Cell[] = [cells[0]];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = key(x + dx, y + dy);
      if (set.has(k) && !seen.has(k)) {
        seen.add(k);
        stack.push([x + dx, y + dy]);
      }
    }
  }
  return seen.size === set.size;
}

/** Centre the polyomino on its centroid and list the edges its cells share. */
export function bodyOf(cells: readonly Cell[]): AnimalBody {
  const n = cells.length;
  let cx = 0, cy = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of cells) {
    cx += x; cy += y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  cx /= Math.max(1, n);
  cy /= Math.max(1, n);
  const out = new Float32Array(n * 2);
  const index = new Map<string, number>();
  cells.forEach(([x, y], i) => {
    out[i * 2] = x - cx;
    out[i * 2 + 1] = y - cy;
    index.set(`${x},${y}`, i);
  });
  const pairs: number[] = [];
  cells.forEach(([x, y], i) => {
    const r = index.get(`${x + 1},${y}`);
    const d = index.get(`${x},${y + 1}`);
    if (r !== undefined) pairs.push(i, r);
    if (d !== undefined) pairs.push(i, d);
  });
  return {
    cells: out,
    count: n,
    bonds: Uint16Array.from(pairs),
    bondCount: pairs.length / 2,
    radius: n ? Math.max(maxX - minX + 1, maxY - minY + 1) / 2 : 0.5,
  };
}

/**
 * A wild lattice animal: grown cell by cell from the origin (Eden growth), so
 * it is a polyomino by construction. Used when the commons has no animal to
 * send — the visitor is still a true lattice animal, just not one of a field's.
 */
export function wildAnimal(seed: number, size: number): Cell[] {
  const r = rng(seed);
  const n = Math.max(1, Math.min(400, Math.floor(size)));
  const cells: Cell[] = [[0, 0]];
  const have = new Set(["0,0"]);
  while (cells.length < n) {
    const frontier: Cell[] = [];
    const fs = new Set<string>();
    for (const [x, y] of cells) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${x + dx},${y + dy}`;
      if (!have.has(k) && !fs.has(k)) { fs.add(k); frontier.push([x + dx, y + dy]); }
    }
    frontier.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const c = frontier[Math.floor(r() * frontier.length)];
    cells.push(c);
    have.add(`${c[0]},${c[1]}`);
  }
  return cells;
}

// ——— instances ———

/**
 * Floats per instance, read by `lattice-forms-layer.ts` in this order:
 * x, y, radius, rotation, kind, phase, alpha, glow, colorA rgb, colorB rgb,
 * facets, jitter.
 */
export const FORM_STRIDE = 16;

const rgbCache = new Map<string, [number, number, number]>();
export function rgbOf(hex: string): [number, number, number] {
  const hit = rgbCache.get(hex);
  if (hit) return hit;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  const c: [number, number, number] = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  rgbCache.set(hex, c);
  return c;
}

export type Placement = {
  /** centre, in CSS px */
  x: number;
  y: number;
  /** one cell's side, CSS px */
  cell: number;
  /** body rotation, radians */
  heading: number;
  /** 0..1, fades a visitor in and out */
  alpha: number;
  /** seconds on the shared clock */
  time: number;
  /** a stable per-animal number, so two animals in one form never move as one */
  seed: number;
  /** 1 when prefers-reduced-motion: cells hold still, nothing spins */
  reduced?: boolean;
};

const BREATH_HZ = 0.14;
const ALIGNED: Record<number, boolean> = { [KIND_INDEX.glyph]: true, [KIND_INDEX.crystal]: true, [KIND_INDEX.star]: true };
const UPRIGHT: Record<number, boolean> = { [KIND_INDEX.flame]: true, [KIND_INDEX.drop]: true };

/**
 * Write one animal into `out` at instance offset `at`, in `form`. Returns the
 * number of instances written (cells + bonds), never more than `room` allows.
 * No allocation: the caller owns the buffer.
 */
export function writeAnimal(out: Float32Array, at: number, room: number, body: AnimalBody, form: FormSpec, p: Placement): number {
  const kind = KIND_INDEX[form.kind] ?? 0;
  const pr = form.params;
  const [a0, a1, a2] = [rgbOf(form.palette[0]), rgbOf(form.palette[1]), rgbOf(form.palette[2])];
  const still = p.reduced ? 0 : 1;
  const c = Math.cos(p.heading), s = Math.sin(p.heading);
  const breath = Math.sin(p.time * Math.PI * 2 * BREATH_HZ) * 0.5 + 0.5;
  let w = 0;
  // Bonds first, so the cells sit over the bridges between them.
  const bondAlpha = 0.25 + 0.55 * pr.bonds;
  for (let b = 0; b < body.bondCount && w < room; b++) {
    const i = body.bonds[b * 2], j = body.bonds[b * 2 + 1];
    const lx = (body.cells[i * 2] + body.cells[j * 2]) / 2, ly = (body.cells[i * 2 + 1] + body.cells[j * 2 + 1]) / 2;
    const horiz = body.cells[i * 2 + 1] === body.cells[j * 2 + 1];
    const o = (at + w) * FORM_STRIDE;
    out[o] = p.x + (lx * c - ly * s) * p.cell;
    out[o + 1] = p.y + (lx * s + ly * c) * p.cell;
    out[o + 2] = p.cell * 0.5;
    out[o + 3] = p.heading + (horiz ? 0 : Math.PI / 2);
    out[o + 4] = BOND_KIND;
    out[o + 5] = breath;
    out[o + 6] = p.alpha * bondAlpha;
    out[o + 7] = pr.glow * 0.5;
    out[o + 8] = a1[0]; out[o + 9] = a1[1]; out[o + 10] = a1[2];
    out[o + 11] = a2[0]; out[o + 12] = a2[1]; out[o + 13] = a2[2];
    out[o + 14] = pr.facets;
    out[o + 15] = pr.jitter;
    w++;
  }
  for (let i = 0; i < body.count && w < room; i++) {
    const h = ((p.seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0) / 4294967296;
    const lx = body.cells[i * 2], ly = body.cells[i * 2 + 1];
    // A cell breathes on the shared 7s breath, offset by where it sits, and
    // trembles by the form's own jitter — the body never leaves its lattice.
    const wob = still * pr.jitter * 0.08;
    const jx = lx + wob * Math.sin(p.time * (1.3 + h) + h * 40);
    const jy = ly + wob * Math.cos(p.time * (1.1 + h) + h * 70);
    const swell = 1 + still * (0.06 + 0.12 * pr.pulse) * Math.sin(p.time * Math.PI * 2 * BREATH_HZ + h * 6.283);
    const o = (at + w) * FORM_STRIDE;
    out[o] = p.x + (jx * c - jy * s) * p.cell;
    out[o + 1] = p.y + (jx * s + jy * c) * p.cell;
    out[o + 2] = p.cell * 0.5 * swell;
    // Tiles and crystals sit square on the lattice; flames and drops keep their
    // point up and only sway; everything else turns freely by the form's spin.
    out[o + 3] = ALIGNED[kind]
      ? p.heading + (kind === KIND_INDEX.crystal ? Math.floor(h * 2) * (Math.PI / 6) : 0)
      : UPRIGHT[kind]
        ? p.heading + still * 0.12 * Math.sin(p.time * (0.9 + h) + h * 30)
        : p.heading + still * pr.spin * p.time * 0.6 + h * 6.283;
    out[o + 4] = kind;
    out[o + 5] = (h + p.time * 0.05 * still) % 1;
    out[o + 6] = p.alpha;
    out[o + 7] = pr.glow;
    // Rim from the darker anchors, core from the brighter: each cell draws one
    // of two pairings so a body reads as a population, not a stamp.
    const pickA = h < 0.5 ? a0 : a1;
    out[o + 8] = pickA[0]; out[o + 9] = pickA[1]; out[o + 10] = pickA[2];
    out[o + 11] = a2[0]; out[o + 12] = a2[1]; out[o + 13] = a2[2];
    out[o + 14] = pr.facets;
    out[o + 15] = pr.jitter;
    w++;
  }
  return w;
}

// ——— when they come ———

export type Visit = {
  /** seconds since the page's clock started */
  start: number;
  duration: number;
  /** which animal of the pool, as a fraction 0..1 (the caller indexes) */
  pick: number;
  /** entry and exit points on the unit square's edge */
  from: [number, number];
  to: [number, number];
  /** the curve's sag toward the centre, -1..1 */
  bend: number;
};

const edgePoint = (u: number): [number, number] => {
  const t = (u * 4) % 4;
  if (t < 1) return [t, -0.08];
  if (t < 2) return [1.08, t - 1];
  if (t < 3) return [3 - t, 1.08];
  return [-0.08, 4 - t];
};

/**
 * The visits a page receives: a first one after a short, seeded wait, then
 * one at a time with a seeded rest between. Pure in (seed, index), so the
 * schedule never depends on frame rate or on how long the tab slept.
 */
export function visitAt(seed: number, index: number): Visit {
  let start = 0;
  let last: Visit | null = null;
  for (let k = 0; k <= index; k++) {
    const r = rng(hash32(`${seed}|visit|${k}`));
    const wait = k === 0 ? 5 + r() * 9 : 18 + r() * 42;
    const duration = 38 + r() * 30;
    start = (last ? last.start + last.duration : 0) + wait;
    const u = r();
    const from = edgePoint(u);
    const to = edgePoint(u + 1.5 + (r() - 0.5) * 1.2);
    last = { start, duration, pick: r(), from, to, bend: r() * 2 - 1 };
  }
  return last!;
}

/** The visit live at time t, or null in a rest. Walks forward from a hint index. */
export function liveVisit(seed: number, t: number, hint = 0): { visit: Visit; index: number } | null {
  let i = Math.max(0, hint);
  let v = visitAt(seed, i);
  while (t > v.start + v.duration) v = visitAt(seed, ++i);
  return t >= v.start ? { visit: v, index: i } : null;
}

/** Where a visitor is along its crossing, u in 0..1: a gentle quadratic arc. */
export function pathPoint(v: Visit, u: number): { x: number; y: number; heading: number } {
  const mx = (v.from[0] + v.to[0]) / 2, my = (v.from[1] + v.to[1]) / 2;
  const nx = -(v.to[1] - v.from[1]), ny = v.to[0] - v.from[0];
  const cx = mx + (0.5 - mx) * 0.6 + nx * v.bend * 0.25, cy = my + (0.5 - my) * 0.6 + ny * v.bend * 0.25;
  const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; // ease in-out: it arrives, lingers, goes
  const a = 1 - e;
  const x = a * a * v.from[0] + 2 * a * e * cx + e * e * v.to[0];
  const y = a * a * v.from[1] + 2 * a * e * cy + e * e * v.to[1];
  const dx = 2 * a * (cx - v.from[0]) + 2 * e * (v.to[0] - cx);
  const dy = 2 * a * (cy - v.from[1]) + 2 * e * (v.to[1] - cy);
  return { x, y, heading: Math.atan2(dy, dx) * 0.15 };
}

/** One cell's side for an animal of `radius` cells on a w×h page. */
export function cellSize(radius: number, w: number, h: number): number {
  const m = Math.min(w, h);
  const base = Math.max(10, Math.min(26, m / 34));
  return Math.max(2.5, Math.min(base, (m * 0.16) / Math.max(0.5, radius)));
}

/**
 * Where an animal that lives in this room wanders: a slow Lissajous around a
 * seeded home, so a resident is always somewhere and never everywhere.
 */
export function residentPoint(seed: number, t: number, reduced = false): { x: number; y: number; heading: number } {
  const r = rng(seed);
  const hx = 0.16 + r() * 0.68, hy = 0.2 + r() * 0.6;
  const fx = 0.011 + r() * 0.01, fy = 0.008 + r() * 0.01, ph = r() * 6.283;
  const tt = reduced ? 0 : t;
  return {
    x: hx + 0.07 * Math.sin(tt * fx * 6.283 + ph),
    y: hy + 0.05 * Math.sin(tt * fy * 6.283 + ph * 1.7),
    heading: 0.12 * Math.sin(tt * 0.05 + ph),
  };
}
