/**
 * crystal — the lattice, and everything the lattice decides.
 *
 * The invariant of /rocks is a **lattice**: a metric (axial lengths and
 * angles), a centering, a point group, and the cleavage family the group
 * carries. Every face of the room is that one object seen again —
 *
 *   · the habit is the intersection of halfspaces on lattice plane families
 *     (a Wulff construction), so the shape a stone grows into is derived
 *     from the lattice rather than drawn by hand;
 *   · a fracture is a cut on a member of the cleavage orbit, so a split
 *     follows the lattice and never an arbitrary line;
 *   · and the load-bearing map, lattice → timbre, is the **reciprocal
 *     lattice heard**: the partial ratios of a stone's ring are the sorted
 *     lengths of its allowed reciprocal-lattice vectors, normalised. That
 *     is a powder-diffraction fingerprint, so it runs BACKWARDS —
 *     `readLattice` recovers the system, the centering and the axial ratio
 *     from the ratios alone, and `speciesFromRing` names the mineral. A
 *     cubic salt and a hexagonal quartz do not merely sound different; you
 *     can hear which one it was.
 *
 * Growth is analytic, never a history: `growStep` moves mass out of a
 * pocket of solution by exponential decay, so 60 Hz and 120 Hz reach the
 * same crystal, and the habit stays self-similar as it grows.
 *
 * Pure math, no imports, no DOM — node-testable (scripts/test-crystal.mjs).
 * See INSPIRATION.md §2 (maps between representations).
 */

export type SystemId = "cubic" | "tetragonal" | "hexagonal" | "orthorhombic";
/** Lattice centering — which reflections the lattice allows at all. */
export type Centering = "P" | "I" | "F" | "R";
export type PointGroupId = "432" | "422" | "622" | "32" | "222";
export type Vec3 = [number, number, number];
export type Miller = [number, number, number];
export type Mat3 = number[]; // row-major, 9 entries

export type Lattice = {
  system: SystemId;
  centering: Centering;
  /** axial ratios with a ≡ 1 */
  ba: number;
  ca: number;
  /** axial angles, degrees */
  alpha: number;
  beta: number;
  gamma: number;
};

const DEG = Math.PI / 180;
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number) => clamp(v, 0, 1);

// ——— determinism ————————————————————————————————————————————

export function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h ^= Math.round(p) | 0;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

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

// ——— the metric ————————————————————————————————————————————

/** Standard angles for each crystal system. */
export function anglesFor(system: SystemId): { alpha: number; beta: number; gamma: number } {
  if (system === "hexagonal") return { alpha: 90, beta: 90, gamma: 120 };
  return { alpha: 90, beta: 90, gamma: 90 };
}

export function latticeOf(
  system: SystemId,
  centering: Centering,
  ratios: { ba?: number; ca?: number } = {},
): Lattice {
  const ang = anglesFor(system);
  const ca = ratios.ca ?? 1;
  const ba = system === "orthorhombic" ? ratios.ba ?? 1 : 1;
  return { system, centering, ba, ca, ...ang };
}

/**
 * The direct metric tensor G: G_ij = a_i · a_j. Everything measurable about
 * a lattice — lengths, angles, spacings — is a bilinear form on G, which is
 * why the room can carry one small state vector and still be crystallography.
 */
export function metricTensor(l: Lattice): Mat3 {
  const a = 1;
  const b = l.ba;
  const c = l.ca;
  const ca = Math.cos(l.alpha * DEG);
  const cb = Math.cos(l.beta * DEG);
  const cg = Math.cos(l.gamma * DEG);
  return [a * a, a * b * cg, a * c * cb, a * b * cg, b * b, b * c * ca, a * c * cb, b * c * ca, c * c];
}

export function det3(m: Mat3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

export function inv3(m: Mat3): Mat3 {
  const d = det3(m);
  if (Math.abs(d) < 1e-14) throw new Error("singular matrix");
  const i = 1 / d;
  return [
    (m[4] * m[8] - m[5] * m[7]) * i,
    (m[2] * m[7] - m[1] * m[8]) * i,
    (m[1] * m[5] - m[2] * m[4]) * i,
    (m[5] * m[6] - m[3] * m[8]) * i,
    (m[0] * m[8] - m[2] * m[6]) * i,
    (m[2] * m[3] - m[0] * m[5]) * i,
    (m[3] * m[7] - m[4] * m[6]) * i,
    (m[1] * m[6] - m[0] * m[7]) * i,
    (m[0] * m[4] - m[1] * m[3]) * i,
  ];
}

export function matMul(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9).fill(0) as Mat3;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[r * 3 + k] * b[k * 3 + c];
      out[r * 3 + c] = s;
    }
  }
  return out;
}

export function transpose3(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

/** The reciprocal metric G* = G⁻¹ — the tensor the diffraction ring reads. */
export function reciprocalMetric(l: Lattice): Mat3 {
  return inv3(metricTensor(l));
}

/** 1/d² from an already-inverted metric — the hot path, kept allocation-free. */
export function dStarSquaredWith(g: Mat3, hkl: Miller): number {
  const [h, k, m] = hkl;
  return (
    h * h * g[0] +
    k * k * g[4] +
    m * m * g[8] +
    2 * h * k * g[1] +
    2 * h * m * g[2] +
    2 * k * m * g[5]
  );
}

/** 1/d² for a plane (hkl): the squared reciprocal-lattice vector length. */
export function dStarSquared(l: Lattice, hkl: Miller): number {
  return dStarSquaredWith(reciprocalMetric(l), hkl);
}

/** Interplanar spacing, in units of a. A wider-spaced plane rings lower. */
export function dSpacing(l: Lattice, hkl: Miller): number {
  const s = dStarSquared(l, hkl);
  return s <= 0 ? Infinity : 1 / Math.sqrt(s);
}

/** The lattice vectors in a Cartesian frame (a along x, b in the xy plane). */
export function cartesianBasis(l: Lattice): [Vec3, Vec3, Vec3] {
  const b = l.ba;
  const c = l.ca;
  const ca = Math.cos(l.alpha * DEG);
  const cb = Math.cos(l.beta * DEG);
  const cg = Math.cos(l.gamma * DEG);
  const sg = Math.sin(l.gamma * DEG);
  const cz = Math.sqrt(Math.max(0, 1 - ca * ca - cb * cb - cg * cg + 2 * ca * cb * cg)) / sg;
  return [
    [1, 0, 0],
    [b * cg, b * sg, 0],
    [c * cb, (c * (ca - cb * cg)) / sg, c * cz],
  ];
}

const cross = (u: Vec3, v: Vec3): Vec3 => [
  u[1] * v[2] - u[2] * v[1],
  u[2] * v[0] - u[0] * v[2],
  u[0] * v[1] - u[1] * v[0],
];
const dot3 = (u: Vec3, v: Vec3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const norm3 = (u: Vec3) => Math.sqrt(dot3(u, u));

/**
 * The outward unit normal of the plane (hkl), in the Cartesian frame. This
 * is h·a* + k·b* + l·c* — the reciprocal-lattice vector — which is exactly
 * why a cleavage direction is a lattice direction and not a taste.
 */
export function planeNormal(l: Lattice, hkl: Miller): Vec3 {
  const [A, B, C] = cartesianBasis(l);
  const v = dot3(A, cross(B, C));
  const as: Vec3 = cross(B, C).map((x) => x / v) as Vec3;
  const bs: Vec3 = cross(C, A).map((x) => x / v) as Vec3;
  const cs: Vec3 = cross(A, B).map((x) => x / v) as Vec3;
  const n: Vec3 = [
    hkl[0] * as[0] + hkl[1] * bs[0] + hkl[2] * cs[0],
    hkl[0] * as[1] + hkl[1] * bs[1] + hkl[2] * cs[1],
    hkl[0] * as[2] + hkl[1] * bs[2] + hkl[2] * cs[2],
  ];
  const m = norm3(n) || 1;
  return [n[0] / m, n[1] / m, n[2] / m];
}

// ——— the group ————————————————————————————————————————————

const GENERATORS: Record<PointGroupId, Mat3[]> = {
  // 4-fold about c, 3-fold about the body diagonal — the 24 cubic rotations.
  "432": [
    [0, -1, 0, 1, 0, 0, 0, 0, 1],
    [0, 0, 1, 1, 0, 0, 0, 1, 0],
  ],
  // 4-fold about c, 2-fold about a.
  "422": [
    [0, -1, 0, 1, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, -1, 0, 0, 0, -1],
  ],
  // 6-fold about c in hexagonal axes, 2-fold about a₁.
  "622": [
    [1, -1, 0, 1, 0, 0, 0, 0, 1],
    [1, -1, 0, 0, -1, 0, 0, 0, -1],
  ],
  // 3-fold about c, 2-fold about a₁ — calcite's rhombohedral group.
  "32": [
    [0, -1, 0, 1, -1, 0, 0, 0, 1],
    [1, -1, 0, 0, -1, 0, 0, 0, -1],
  ],
  // three orthogonal 2-folds.
  "222": [
    [1, 0, 0, 0, -1, 0, 0, 0, -1],
    [-1, 0, 0, 0, 1, 0, 0, 0, -1],
  ],
};

export const EXPECTED_GROUP_ORDER: Record<PointGroupId, number> = {
  "432": 24,
  "422": 8,
  "622": 12,
  "32": 6,
  "222": 4,
};

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const matKey = (m: Mat3) => m.join(",");

/**
 * Close the generators into the full rotation group. A group, not a list:
 * the closure is what makes "the fracture obeys the symmetry" true rather
 * than decorative, and the tests check closure, identity and inverses.
 */
export function symmetryOps(pg: PointGroupId): Mat3[] {
  const seen = new Map<string, Mat3>();
  seen.set(matKey(IDENTITY), IDENTITY);
  const gens = GENERATORS[pg];
  let frontier: Mat3[] = [IDENTITY];
  // Bounded: the crystallographic point groups top out at 24 rotations, so
  // a runaway closure is a bug, not a big group — hence the hard cap.
  for (let depth = 0; depth < 12 && frontier.length; depth++) {
    const next: Mat3[] = [];
    for (const f of frontier) {
      for (const g of gens) {
        const p = matMul(g, f);
        const key = matKey(p);
        if (!seen.has(key)) {
          seen.set(key, p);
          next.push(p);
        }
      }
    }
    if (seen.size > 48) break;
    frontier = next;
  }
  return [...seen.values()];
}

/** Integer inverse of a unimodular rotation (det = ±1) via the adjugate. */
export function invUnimodular(m: Mat3): Mat3 {
  const d = det3(m);
  const adj: Mat3 = [
    m[4] * m[8] - m[5] * m[7],
    m[2] * m[7] - m[1] * m[8],
    m[1] * m[5] - m[2] * m[4],
    m[5] * m[6] - m[3] * m[8],
    m[0] * m[8] - m[2] * m[6],
    m[2] * m[3] - m[0] * m[5],
    m[3] * m[7] - m[4] * m[6],
    m[1] * m[6] - m[0] * m[7],
    m[0] * m[4] - m[1] * m[3],
  ];
  return adj.map((v) => Math.round(v / d)) as Mat3;
}

/**
 * Plane indices are covariant: a rotation that sends x → M x sends the
 * indices (hkl) → (hkl)·M⁻¹, so a plane family maps into itself.
 */
export function transformPlane(op: Mat3, hkl: Miller): Miller {
  const inv = invUnimodular(op);
  return [
    hkl[0] * inv[0] + hkl[1] * inv[3] + hkl[2] * inv[6],
    hkl[0] * inv[1] + hkl[1] * inv[4] + hkl[2] * inv[7],
    hkl[0] * inv[2] + hkl[1] * inv[5] + hkl[2] * inv[8],
  ];
}

/** A rotation is a symmetry of the lattice iff it preserves the metric. */
export function preservesMetric(op: Mat3, l: Lattice, tol = 1e-9): boolean {
  const g = metricTensor(l);
  const mgm = matMul(transpose3(op), matMul(g, op));
  for (let i = 0; i < 9; i++) if (Math.abs(mgm[i] - g[i]) > tol) return false;
  return true;
}

/**
 * The orbit of a plane under the group, with ± included — the *form*, the
 * set of faces that are the same face by symmetry. Sorted so the family is
 * a deterministic list and a fracture is reproducible.
 */
export function planeOrbit(pg: PointGroupId, hkl: Miller): Miller[] {
  const out: Miller[] = [];
  const seen = new Set<string>();
  for (const op of symmetryOps(pg)) {
    const p = transformPlane(op, hkl);
    for (const s of [1, -1] as const) {
      const q: Miller = [p[0] * s, p[1] * s, p[2] * s];
      const key = q.join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(q);
    }
  }
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  return out;
}

// ——— which reflections the lattice allows ————————————————————

/**
 * Centering extinctions — the real rules. They are the reason a face-centred
 * salt and a primitive pyrite, identical in shape, ring on different
 * partials: half of the salt's reflections are simply absent.
 */
export function allowedReflection(centering: Centering, hkl: Miller): boolean {
  const [h, k, l] = hkl;
  if (h === 0 && k === 0 && l === 0) return false;
  switch (centering) {
    case "P":
      return true;
    case "I":
      return (h + k + l) % 2 === 0;
    case "F": {
      const e = (n: number) => Math.abs(n % 2);
      return e(h) === e(k) && e(k) === e(l);
    }
    case "R":
      return (((-h + k + l) % 3) + 3) % 3 === 0;
  }
}

// ——— the ring: the reciprocal lattice, heard ————————————————

export const RING_COUNT = 8;
const RING_MAX_INDEX = 4;

/**
 * The partial ratios of a stone's ring: the sorted distinct lengths of the
 * allowed reciprocal-lattice vectors, normalised by the shortest. This is a
 * powder pattern — and it is the whole map, because it inverts.
 */
export function ringRatios(l: Lattice, count = RING_COUNT): number[] {
  const vals: number[] = [];
  const g = reciprocalMetric(l);
  // Only the h ≥ 0 half — Friedel's law: (hkl) and (-h-k-l) are one length.
  for (let h = 0; h <= RING_MAX_INDEX; h++) {
    for (let k = -RING_MAX_INDEX; k <= RING_MAX_INDEX; k++) {
      for (let m = -RING_MAX_INDEX; m <= RING_MAX_INDEX; m++) {
        const hkl: Miller = [h, k, m];
        if (!allowedReflection(l.centering, hkl)) continue;
        const s = dStarSquaredWith(g, hkl);
        if (s <= 1e-12) continue;
        vals.push(s);
      }
    }
  }
  vals.sort((a, b) => a - b);
  const distinct: number[] = [];
  for (const v of vals) {
    const last = distinct[distinct.length - 1];
    if (last === undefined || v - last > last * 1e-6) distinct.push(v);
  }
  const base = distinct[0];
  const out: number[] = [];
  for (let i = 0; i < Math.min(count, distinct.length); i++) {
    out.push(Math.sqrt(distinct[i] / base));
  }
  return out;
}

/** Candidate lattice classes the inverse map searches, highest symmetry first. */
const READ_CANDIDATES: { system: SystemId; centering: Centering; params: 0 | 1 | 2 }[] = [
  { system: "cubic", centering: "F", params: 0 },
  { system: "cubic", centering: "I", params: 0 },
  { system: "cubic", centering: "P", params: 0 },
  { system: "hexagonal", centering: "R", params: 1 },
  { system: "hexagonal", centering: "P", params: 1 },
  { system: "tetragonal", centering: "I", params: 1 },
  { system: "tetragonal", centering: "P", params: 1 },
  { system: "orthorhombic", centering: "P", params: 2 },
];

function ringError(ratios: number[], l: Lattice): number {
  const got = ringRatios(l, ratios.length);
  if (got.length < ratios.length) return Infinity;
  let worst = 0;
  for (let i = 0; i < ratios.length; i++) {
    worst = Math.max(worst, Math.abs(got[i] - ratios[i]) / Math.max(1e-9, ratios[i]));
  }
  return worst;
}

export type ReadLattice = { system: SystemId; centering: Centering; ba: number; ca: number; error: number };

/**
 * ...and the map runs backwards. Given only the ratios of a ring, recover
 * the crystal system, the centering and the axial ratios that produced it.
 * Nothing is guessed: a ratio list that is no lattice's fingerprint returns
 * null, exactly as a melody outside the code names no strand on /dna.
 */
export function readLattice(ratios: number[], tol = 0.01): ReadLattice | null {
  if (ratios.length < 3) return null;
  let best: ReadLattice | null = null;
  for (const cand of READ_CANDIDATES) {
    let bestHere: ReadLattice | null = null;
    const test = (ba: number, ca: number) => {
      const l = latticeOf(cand.system, cand.centering, { ba, ca });
      const err = ringError(ratios, l);
      if (!bestHere || err < bestHere.error) {
        bestHere = { system: cand.system, centering: cand.centering, ba, ca, error: err };
      }
    };
    if (cand.params === 0) {
      test(1, 1);
    } else if (cand.params === 1) {
      for (let ca = 0.3; ca <= 4.001; ca += 0.02) test(1, ca);
      const around = (bestHere as ReadLattice | null)?.ca ?? 1;
      for (let ca = around - 0.02; ca <= around + 0.0201; ca += 0.001) test(1, Math.max(0.05, ca));
    } else {
      for (let ba = 0.4; ba <= 2.801; ba += 0.06) {
        for (let ca = 0.4; ca <= 2.801; ca += 0.06) test(ba, ca);
      }
      const b0 = (bestHere as ReadLattice | null)?.ba ?? 1;
      const c0 = (bestHere as ReadLattice | null)?.ca ?? 1;
      for (let ba = b0 - 0.06; ba <= b0 + 0.0601; ba += 0.004) {
        for (let ca = c0 - 0.06; ca <= c0 + 0.0601; ca += 0.004) test(Math.max(0.1, ba), Math.max(0.1, ca));
      }
    }
    const found = bestHere as ReadLattice | null;
    if (found && found.error <= tol) return found;
    if (found && (!best || found.error < best.error)) best = found;
  }
  return null;
}

// ——— the six minerals ————————————————————————————————————————

export type SpeciesId = "halite" | "pyrite" | "quartz" | "calcite" | "zircon" | "topaz";

export type Species = {
  id: SpeciesId;
  /** lowercase, on-voice; used by the lens, never as an instruction */
  label: string;
  lattice: Lattice;
  pointGroup: PointGroupId;
  /** the cleavage family's representative indices */
  cleavage: Miller;
  /** 0..1 — how willingly the stone parts on that family */
  cleavageQuality: number;
  /** habit: the plane families that bound the crystal, with their distances */
  forms: { hkl: Miller; distance: number }[];
  /** how eagerly it comes out of solution, relative */
  growthRate: number;
  /** rgb 0..255 of the stone's body */
  tint: [number, number, number];
  /** 0..1 — how much light passes through it */
  clarity: number;
};

export const SPECIES: Record<SpeciesId, Species> = {
  // rock salt: face-centred cubic, cleaving into smaller and smaller cubes.
  halite: {
    id: "halite",
    label: "halite",
    lattice: latticeOf("cubic", "F"),
    pointGroup: "432",
    cleavage: [1, 0, 0],
    cleavageQuality: 0.95,
    forms: [{ hkl: [1, 0, 0], distance: 1 }],
    growthRate: 1.35,
    tint: [226, 232, 240],
    clarity: 0.72,
  },
  // fool's gold: primitive cubic, so its ring keeps the reflections salt loses.
  pyrite: {
    id: "pyrite",
    label: "pyrite",
    lattice: latticeOf("cubic", "P"),
    pointGroup: "432",
    cleavage: [1, 0, 0],
    cleavageQuality: 0.35,
    forms: [
      { hkl: [1, 0, 0], distance: 1 },
      { hkl: [1, 1, 1], distance: 1.42 },
    ],
    growthRate: 0.55,
    tint: [226, 190, 96],
    clarity: 0.05,
  },
  // quartz: a hexagonal prism closed by rhombohedral terminations.
  quartz: {
    id: "quartz",
    label: "quartz",
    lattice: latticeOf("hexagonal", "P", { ca: 1.1 }),
    pointGroup: "622",
    cleavage: [1, 0, 1],
    cleavageQuality: 0.25,
    forms: [
      { hkl: [1, 0, 0], distance: 0.72 },
      { hkl: [1, 0, 1], distance: 1.28 },
    ],
    growthRate: 0.8,
    tint: [214, 226, 238],
    clarity: 0.86,
  },
  // calcite: the rhombohedron that is nothing but its own cleavage.
  calcite: {
    id: "calcite",
    label: "calcite",
    lattice: latticeOf("hexagonal", "R", { ca: 3.42 }),
    pointGroup: "32",
    // {104} in the structural hexagonal cell is the famous cleavage rhomb —
    // and the strongest line in calcite's powder pattern besides.
    cleavage: [1, 0, 4],
    cleavageQuality: 1,
    forms: [{ hkl: [1, 0, 4], distance: 1 }],
    growthRate: 1.05,
    tint: [242, 220, 168],
    clarity: 0.8,
  },
  // zircon: body-centred tetragonal, a stubby prism with a pyramid on each end.
  zircon: {
    id: "zircon",
    label: "zircon",
    lattice: latticeOf("tetragonal", "I", { ca: 0.905 }),
    pointGroup: "422",
    cleavage: [1, 1, 0],
    cleavageQuality: 0.4,
    forms: [
      { hkl: [1, 0, 0], distance: 0.78 },
      { hkl: [1, 0, 1], distance: 1.05 },
    ],
    growthRate: 0.6,
    tint: [226, 152, 108],
    clarity: 0.65,
  },
  // topaz: orthorhombic, and it lets go along the base without argument.
  topaz: {
    id: "topaz",
    label: "topaz",
    lattice: latticeOf("orthorhombic", "P", { ba: 1.892, ca: 1.806 }),
    pointGroup: "222",
    cleavage: [0, 0, 1],
    cleavageQuality: 0.9,
    forms: [
      { hkl: [1, 0, 0], distance: 0.86 },
      { hkl: [0, 1, 0], distance: 1.05 },
      { hkl: [0, 0, 1], distance: 1.15 },
      { hkl: [1, 1, 1], distance: 1.5 },
    ],
    growthRate: 0.7,
    tint: [236, 206, 142],
    clarity: 0.78,
  },
};

export const SPECIES_IDS = Object.keys(SPECIES) as SpeciesId[];

/** The cleavage form: every plane the stone is willing to part on. */
export function cleavagePlanes(id: SpeciesId): Miller[] {
  const s = SPECIES[id];
  return planeOrbit(s.pointGroup, s.cleavage);
}

/**
 * Name the mineral from its ring alone. The six lattices were chosen so
 * their fingerprints are pairwise distinct — the test pins that, because
 * without it this function would be quietly choosing.
 */
export function speciesFromRing(ratios: number[], tol = 0.01): SpeciesId | null {
  let found: SpeciesId | null = null;
  for (const id of SPECIES_IDS) {
    if (ringError(ratios, SPECIES[id].lattice) <= tol) {
      if (found) return null; // ambiguous — nothing is guessed
      found = id;
    }
  }
  return found;
}

// ——— habit: the shape the lattice grows into ————————————————

export type Mesh = {
  /** flat xyz triples */
  verts: number[];
  /** each face a list of vertex indices, wound counter-clockwise seen from outside */
  faces: number[][];
};

const CLIP_EPS = 1e-9;
/** Wider than CLIP_EPS: a vertex this close to the cut counts as on it. */
const CAP_EPS = 1e-6;

function vAt(m: Mesh, i: number): Vec3 {
  return [m.verts[i * 3], m.verts[i * 3 + 1], m.verts[i * 3 + 2]];
}

/** A big cube to start a Wulff construction from. */
function seedCube(r: number): Mesh {
  const verts: number[] = [];
  for (const z of [-r, r]) for (const y of [-r, r]) for (const x of [-r, r]) verts.push(x, y, z);
  // indices: bit0 = x, bit1 = y, bit2 = z
  const faces = [
    [1, 3, 7, 5], // +x
    [0, 4, 6, 2], // -x
    [2, 6, 7, 3], // +y
    [0, 1, 5, 4], // -y
    [4, 5, 7, 6], // +z
    [0, 2, 3, 1], // -z
  ];
  return { verts, faces };
}

/**
 * Cut a convex mesh with the halfspace n·x ≤ d, capping the opening with a
 * fresh flat face. This is the one geometric primitive the room needs: the
 * habit is halfspaces from lattice planes, and a fracture is one more of
 * them. Volume is conserved across the cut — the test checks it against a
 * cube split by hand.
 */
export function clipHalfspace(mesh: Mesh, n: Vec3, d: number): Mesh | null {
  const nl = norm3(n) || 1;
  const nx = n[0] / nl;
  const ny = n[1] / nl;
  const nz = n[2] / nl;
  const dd = d / nl;

  const verts: number[] = [];
  const keyed = new Map<string, number>();
  const push = (p: Vec3): number => {
    const key = `${p[0].toFixed(6)},${p[1].toFixed(6)},${p[2].toFixed(6)}`;
    const hit = keyed.get(key);
    if (hit !== undefined) return hit;
    const idx = verts.length / 3;
    verts.push(p[0], p[1], p[2]);
    keyed.set(key, idx);
    return idx;
  };

  const side = (p: Vec3) => p[0] * nx + p[1] * ny + p[2] * nz - dd;
  const faces: number[][] = [];

  for (const face of mesh.faces) {
    const poly: number[] = [];
    for (let i = 0; i < face.length; i++) {
      const a = vAt(mesh, face[i]);
      const b = vAt(mesh, face[(i + 1) % face.length]);
      const sa = side(a);
      const sb = side(b);
      if (sa <= CLIP_EPS) poly.push(push(a));
      if ((sa > CLIP_EPS && sb < -CLIP_EPS) || (sa < -CLIP_EPS && sb > CLIP_EPS)) {
        const t = sa / (sa - sb);
        const p: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        poly.push(push(p));
      }
    }
    // de-duplicate consecutive repeats introduced by grazing contacts
    const cleaned: number[] = [];
    for (const idx of poly) if (cleaned[cleaned.length - 1] !== idx) cleaned.push(idx);
    if (cleaned.length > 1 && cleaned[0] === cleaned[cleaned.length - 1]) cleaned.pop();
    if (cleaned.length >= 3) faces.push(cleaned);
  }

  if (verts.length === 0) return null;

  // The cap is built from every kept vertex that ends up ON the plane, not
  // only from edges that strictly crossed it. Crystal forms are degenerate
  // on purpose — six pyramid faces meet at one apex, and consecutive cuts
  // pass exactly through vertices the previous cut made — and a cap built
  // from strict crossings alone silently leaves those solids open.
  const onPlane: number[] = [];
  for (let i = 0; i * 3 < verts.length; i++) {
    if (Math.abs(side([verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]])) <= CAP_EPS) onPlane.push(i);
  }
  // ...unless a face already lies in this plane, in which case the cut only
  // grazed the solid and there is nothing new to close.
  let coplanar = false;
  for (const face of faces) {
    if (face.length < 3) continue;
    const fn = faceNormal({ verts, faces }, face);
    if (fn[0] * nx + fn[1] * ny + fn[2] * nz > 1 - 1e-6) {
      coplanar = true;
      break;
    }
  }
  if (!coplanar && onPlane.length >= 3) {
    const idxs = onPlane;
    {
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (const i of idxs) {
        cx += verts[i * 3];
        cy += verts[i * 3 + 1];
        cz += verts[i * 3 + 2];
      }
      cx /= idxs.length;
      cy /= idxs.length;
      cz /= idxs.length;
      // an orthonormal basis in the plane
      const seed: Vec3 = Math.abs(nx) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      let u = cross([nx, ny, nz], seed);
      const un = norm3(u) || 1;
      u = [u[0] / un, u[1] / un, u[2] / un];
      const v = cross([nx, ny, nz], u);
      idxs.sort((ia, ib) => {
        const ax = verts[ia * 3] - cx;
        const ay = verts[ia * 3 + 1] - cy;
        const az = verts[ia * 3 + 2] - cz;
        const bx = verts[ib * 3] - cx;
        const by = verts[ib * 3 + 1] - cy;
        const bz = verts[ib * 3 + 2] - cz;
        const aa = Math.atan2(ax * v[0] + ay * v[1] + az * v[2], ax * u[0] + ay * u[1] + az * u[2]);
        const bb = Math.atan2(bx * v[0] + by * v[1] + bz * v[2], bx * u[0] + by * u[1] + bz * u[2]);
        return aa - bb;
      });
      // wind it so the face's own normal points out of the kept half
      // (Newell over the whole ring, not one corner, so a sliver cannot
      // flip the cap inward and make the solid's volume come out negative)
      let wx = 0;
      let wy = 0;
      let wz = 0;
      for (let i = 0; i < idxs.length; i++) {
        const a = idxs[i];
        const b = idxs[(i + 1) % idxs.length];
        wx += (verts[a * 3 + 1] - verts[b * 3 + 1]) * (verts[a * 3 + 2] + verts[b * 3 + 2]);
        wy += (verts[a * 3 + 2] - verts[b * 3 + 2]) * (verts[a * 3] + verts[b * 3]);
        wz += (verts[a * 3] - verts[b * 3]) * (verts[a * 3 + 1] + verts[b * 3 + 1]);
      }
      if (wx * nx + wy * ny + wz * nz < 0) idxs.reverse();
      faces.push(idxs);
    }
  }

  if (faces.length < 4) return null;
  return { verts, faces };
}

/** Signed volume by the divergence theorem — positive for outward winding. */
export function meshVolume(mesh: Mesh): number {
  let vol = 0;
  for (const face of mesh.faces) {
    const a = vAt(mesh, face[0]);
    for (let i = 1; i + 1 < face.length; i++) {
      const b = vAt(mesh, face[i]);
      const c = vAt(mesh, face[i + 1]);
      vol += dot3(a, cross(b, c)) / 6;
    }
  }
  return vol;
}

/**
 * The outward unit normal of a face, by Newell over the whole ring — three
 * corners of a clipped face are sometimes collinear, and a normal taken
 * from them alone comes out as zero and shades the face black.
 */
export function faceNormal(mesh: Mesh, face: number[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < face.length; i++) {
    const a = vAt(mesh, face[i]);
    const b = vAt(mesh, face[(i + 1) % face.length]);
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const m = Math.sqrt(x * x + y * y + z * z) || 1;
  return [x / m, y / m, z / m];
}

/**
 * The habit: the intersection of every halfspace in the species' forms,
 * normalised to unit volume so growth is a pure scale. A cube for salt, a
 * rhombohedron for calcite, a terminated prism for quartz — none of it
 * drawn by hand, all of it the lattice.
 */
export function habitMesh(id: SpeciesId): Mesh {
  const s = SPECIES[id];
  let mesh: Mesh | null = seedCube(6);
  for (const form of s.forms) {
    for (const hkl of planeOrbit(s.pointGroup, form.hkl)) {
      if (!mesh) break;
      mesh = clipHalfspace(mesh, planeNormal(s.lattice, hkl), form.distance);
    }
  }
  if (!mesh) throw new Error(`unbounded habit for ${id}`);
  const v = meshVolume(mesh);
  const k = 1 / Math.cbrt(Math.max(1e-9, v));
  return { verts: mesh.verts.map((x) => x * k), faces: mesh.faces };
}

/** Scale a mesh about its own centre — growth is self-similar. */
export function scaleMesh(mesh: Mesh, k: number): Mesh {
  return { verts: mesh.verts.map((x) => x * k), faces: mesh.faces };
}

/**
 * How long the stone is along the axis it prefers. A prism is not a cube,
 * and the ear should know: elongation sets how long the ring holds.
 */
export function meshExtents(mesh: Mesh): Vec3 {
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (let i = 0; i < mesh.verts.length; i += 3) {
    mx = Math.max(mx, Math.abs(mesh.verts[i]));
    my = Math.max(my, Math.abs(mesh.verts[i + 1]));
    mz = Math.max(mz, Math.abs(mesh.verts[i + 2]));
  }
  return [mx, my, mz];
}

export function elongationOf(mesh: Mesh): number {
  const [x, y, z] = meshExtents(mesh);
  const across = Math.max(1e-6, (x + y) / 2);
  return z / across;
}

// ——— growth: mass out of solution, never a history ————————————

export type Pocket = {
  /** what is still dissolved, in the room's own mass units */
  dissolved: number;
  /** what has come out of solution and stands */
  solid: number;
};

/**
 * One step of growth. The dissolved mass decays exponentially and every
 * gram of it lands in the solid — so the pair is conserved exactly, and
 * because exp(-k·t) is additive in t the same second of growth produces
 * the same crystal at 60 Hz and at 120 Hz. (A rate·dt implementation
 * would not: that is the bug this shape exists to prevent.)
 */
export function growStep(p: Pocket, k: number, dt: number): Pocket {
  if (!(dt > 0) || !(k > 0)) return p;
  const remaining = p.dissolved * Math.exp(-k * dt);
  const grown = p.dissolved - remaining;
  return { dissolved: remaining, solid: p.solid + grown };
}

/**
 * Growth run backwards. An undersaturated brine takes the stone back: the
 * solid decays and every gram of it returns to solution, so a pocket is
 * conserved on this step exactly as it is on `growStep`, and the two are
 * structural inverses — dissolving for a second at k and growing for a
 * second at the rate that undoes it returns the pocket it started from.
 * This is the room's delete path, and it is the same physics as its create
 * path rather than a special case bolted on.
 */
export function dissolveStep(p: Pocket, k: number, dt: number): Pocket {
  if (!(dt > 0) || !(k > 0)) return p;
  const remaining = p.solid * Math.exp(-k * dt);
  const lost = p.solid - remaining;
  return { dissolved: p.dissolved + lost, solid: remaining };
}

/** Draw from a shared solution, never more than there is. */
export function drawFrom(pool: Pocket, amount: number): { pool: Pocket; taken: number } {
  const taken = Math.max(0, Math.min(pool.dissolved, amount));
  return { pool: { dissolved: pool.dissolved - taken, solid: pool.solid }, taken };
}

// ——— stones meeting stones ————————————————————————————————————

/**
 * Ostwald ripening: side by side in one solution, the big crystal eats the
 * small one. A small grain has more curvature, so it is more soluble, so
 * it dissolves and re-deposits on its larger neighbour — which is why a
 * shelf left alone overnight is a few large stones and not many small ones.
 *
 * Mass moves, it is never made: what leaves the small arrives in the large,
 * exactly. Exponential in dt for the same reason growth is — the shelf
 * ripens identically on a fast phone and a slow one — and it is strictly
 * one-directional: the smaller stone always pays.
 */
export function ripen(
  small: number,
  large: number,
  k: number,
  dt: number,
): { small: number; large: number } {
  if (!(dt > 0) || !(k > 0) || !(large > small)) return { small, large };
  const remaining = small * Math.exp(-k * dt);
  const moved = small - remaining;
  return { small: remaining, large: large + moved };
}

/**
 * Mohs hardness — the real ordinal scale. It is the whole of the scratch
 * law: quartz marks calcite, calcite never marks quartz, and nothing marks
 * its own kind.
 */
export const MOHS: Record<SpeciesId, number> = {
  halite: 2.5,
  calcite: 3,
  pyrite: 6.5,
  quartz: 7,
  zircon: 7.5,
  topaz: 8,
};

export type Scratch = {
  /** the stone that takes the mark */
  victim: SpeciesId;
  /** the stone that makes it */
  agent: SpeciesId;
  /** how deep, 0..1, from the gap on the scale */
  depth: number;
};

/**
 * Drag one stone across another and the softer one takes the mark. Returns
 * null when neither can mark the other — equal hardness leaves both clean,
 * which is exactly what the scale means.
 */
export function scratchOutcome(a: SpeciesId, b: SpeciesId): Scratch | null {
  const ha = MOHS[a];
  const hb = MOHS[b];
  if (ha === hb) return null;
  const victim = ha < hb ? a : b;
  const agent = ha < hb ? b : a;
  // the scale runs 1..10; the widest gap this cabinet can show is halite
  // under topaz, and that is the deepest mark it draws
  return { victim, agent, depth: clamp01(Math.abs(ha - hb) / 5.5) };
}

/** The half-life of a pocket at a given rate — how long growth *feels*. */
export function halfLife(k: number): number {
  return Math.LN2 / Math.max(1e-9, k);
}

/** Solid mass → the linear scale of the habit (unit-volume meshes). */
export function sizeFromMass(mass: number): number {
  return Math.cbrt(Math.max(0, mass));
}

/**
 * The scale at which a mesh holds exactly this much mass. Fragments are not
 * unit-volume — a cleaved half holds half — so the drawn size has to come
 * from the mesh it actually is, or the room would quietly create matter
 * every time a stone was split.
 */
export function scaleForMass(mesh: Mesh, mass: number): number {
  const v = Math.abs(meshVolume(mesh));
  if (v <= 1e-12) return 0;
  return Math.cbrt(Math.max(0, mass) / v);
}

// ——— the ring, sounded ————————————————————————————————————————

/** A 2cm stone rings here; everything else is scaled from it. */
export const PITCH_REF_HZ = 320;
export const SIZE_REF_M = 0.02;
export const PITCH_MIN_HZ = 90;
export const PITCH_MAX_HZ = 2100;

/**
 * Size → pitch, as a bar rings: frequency goes as 1/length. Strictly
 * decreasing and bounded, so a boulder is never inaudible and a grain of
 * salt never shrieks.
 */
export function pitchForSize(sizeM: number): number {
  const raw = (PITCH_REF_HZ * SIZE_REF_M) / Math.max(1e-6, sizeM);
  return clamp(raw, PITCH_MIN_HZ, PITCH_MAX_HZ);
}

/** ...and back, inside the unclamped range. */
export function sizeFromPitch(hz: number): number {
  return (PITCH_REF_HZ * SIZE_REF_M) / clamp(hz, PITCH_MIN_HZ, PITCH_MAX_HZ);
}

export const DECAY_MIN_S = 0.35;
export const DECAY_MAX_S = 2;

/** Elongation → how long the ring holds. Monotone, bounded, invertible. */
export function decayForElongation(e: number): number {
  const t = clamp01((e - 0.4) / 2.6);
  return DECAY_MIN_S + (DECAY_MAX_S - DECAY_MIN_S) * t;
}

export function elongationFromDecay(sec: number): number {
  const t = (clamp(sec, DECAY_MIN_S, DECAY_MAX_S) - DECAY_MIN_S) / (DECAY_MAX_S - DECAY_MIN_S);
  return 0.4 + t * 2.6;
}

export type Partial = { hz: number; gain: number; seconds: number };

/**
 * The whole voice of one stone: its ring, as partials. The ratios are the
 * reciprocal lattice (so the timbre *is* the crystal system), the
 * fundamental is its size, the decay its elongation. Bounded to six
 * partials and to a quiet ceiling — nothing here is ever loud.
 */
export function partialsOf(id: SpeciesId, sizeM: number, elongation = 1, count = 6): Partial[] {
  const ratios = ringRatios(SPECIES[id].lattice, count);
  const f0 = pitchForSize(sizeM);
  const hold = decayForElongation(elongation);
  const out: Partial[] = [];
  for (let i = 0; i < ratios.length; i++) {
    const hz = f0 * ratios[i];
    if (hz > 7000) break;
    out.push({
      hz,
      gain: clamp01(1 / Math.pow(ratios[i], 1.35)),
      seconds: clamp(hold / Math.pow(ratios[i], 0.7), 0.08, DECAY_MAX_S),
    });
  }
  return out;
}

/**
 * A cleaved face rings its own plane: pitch goes as 1/d, so a wide-spaced
 * plane speaks low. Invertible, because otherwise it would be decoration.
 */
export function cleavagePitch(id: SpeciesId, hkl: Miller, sizeM: number): number {
  const d = dSpacing(SPECIES[id].lattice, hkl);
  return clamp(pitchForSize(sizeM) / Math.max(0.05, d), PITCH_MIN_HZ, PITCH_MAX_HZ * 2);
}

export function spacingFromCleavagePitch(id: SpeciesId, hz: number, sizeM: number): number {
  return pitchForSize(sizeM) / Math.max(1e-6, hz);
}

// ——— the shelf: population, and what it holds ————————————————

export const MAX_STONES = 14;

export type StoneSeed = {
  species: SpeciesId;
  seed: number;
  nx: number;
  ny: number;
};

/** Oldest retired first; the shelf never grows past its cap. */
export function settleStones<T>(list: T[], cap = MAX_STONES): T[] {
  return list.length <= cap ? list : list.slice(list.length - cap);
}

/**
 * Where a nucleus lands, and what it is: a pure function of the seed, so a
 * shelf is the same shelf every time it is grown from the same number.
 */
export function nucleate(seed: number, index: number): StoneSeed {
  const rng = mulberry32(hashSeed(seed, index, 0x2c));
  const species = SPECIES_IDS[Math.floor(rng() * SPECIES_IDS.length)];
  return {
    species,
    seed: hashSeed(seed, index, 0x51),
    nx: 0.16 + rng() * 0.68,
    ny: 0.3 + rng() * 0.5,
  };
}

/**
 * Which cleavage plane a hand's direction actually finds. The stone chooses:
 * the family member whose normal is nearest the pull wins, so a fracture is
 * always a lattice plane and the same pull always finds the same one.
 */
export function nearestCleavage(
  id: SpeciesId,
  dir: Vec3,
): { hkl: Miller; normal: Vec3; alignment: number } {
  const s = SPECIES[id];
  const dl = norm3(dir) || 1;
  const u: Vec3 = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
  let best: { hkl: Miller; normal: Vec3; alignment: number } | null = null;
  for (const hkl of cleavagePlanes(id)) {
    const n = planeNormal(s.lattice, hkl);
    const a = dot3(n, u);
    if (!best || a > best.alignment) best = { hkl, normal: n, alignment: a };
  }
  return best as { hkl: Miller; normal: Vec3; alignment: number };
}
