/**
 * group-action — the laws of /group.
 *
 * Weyl: symmetry is the invariance of a configuration under a group of
 * automorphic transformations. Paper 2 (Learning the Group): the group is
 * inferred from an incomplete orbit, not supplied by an oracle.
 *
 * A mark is one pose of a class on a cyclic lattice of ORBIT_N seats. A
 * candidate generator is kept iff it maps the *seen* fragment to itself
 * (same class). Completing the orbit adds only the missing poses. Two
 * fragments that close under the same generator fuse into a third class
 * that is neither parent. A rotation meeting a flip is dihedral, not a
 * louder cyclic.
 *
 * Pure math. No DOM, no Math.random — node-testable
 * (scripts/test-group-action.mjs).
 */

export const ORBIT_N = 8;
export const MARK_CAP = 24;
export const GEN_CAP = 8;
export const MATCH_TAU = 0.72;

export type Kind = "rotate" | "flip";

export type Mark = {
  id: number;
  seed: number;
  classId: number;
  pose: number;
  nx: number;
  ny: number;
  growth: number;
  presence: number;
};

export type Generator = {
  id: number;
  k: number;
  kind: Kind;
};

export function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    let x = Math.floor(p * 8192) | 0;
    x = Math.imul(x ^ (x >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ x, 0x01000193);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  return (h ^ (h >>> 15)) >>> 0;
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

export function wrapPose(pose: number): number {
  return ((pose % ORBIT_N) + ORBIT_N) % ORBIT_N;
}

/** Apply an automorphism to a pose index. */
export function applyPose(pose: number, g: Generator): number {
  const p = wrapPose(pose);
  if (g.kind === "rotate") return wrapPose(p + g.k);
  return wrapPose(ORBIT_N - p + g.k);
}

export function identity(): Generator {
  return { id: 0, k: 0, kind: "rotate" };
}

export function isIdentity(g: Generator): boolean {
  return g.kind === "rotate" && wrapPose(g.k) === 0;
}

/** Angle of a pose on the ring, radians. */
export function poseAngle(pose: number): number {
  return (wrapPose(pose) / ORBIT_N) * Math.PI * 2;
}

/** Nearest pose to a point relative to a class centre. */
export function poseFromPoint(nx: number, ny: number, cx: number, cy: number): number {
  const a = Math.atan2(ny - cy, nx - cx);
  const u = (a / (Math.PI * 2) + 1) % 1;
  return wrapPose(Math.round(u * ORBIT_N));
}

export function ringPoint(pose: number, cx: number, cy: number, radius = 0.16): { nx: number; ny: number } {
  const a = poseAngle(pose);
  return { nx: cx + Math.cos(a) * radius, ny: cy + Math.sin(a) * radius };
}

export function bornMark(
  id: number,
  seed: number,
  nx: number,
  ny: number,
  classId: number,
  pose: number,
): Mark {
  return {
    id,
    seed: seed >>> 0,
    classId,
    pose: wrapPose(pose),
    nx,
    ny,
    growth: 0.12,
    presence: 1,
  };
}

function alive(marks: readonly Mark[]): Mark[] {
  return marks.filter((m) => m.presence >= 1 && m.growth > 0.08);
}

/**
 * Fraction of living marks whose image under `g` is already present in the
 * same class. Identity is 1 on any non-empty fragment (a mark maps to itself).
 */
export function consistency(marks: readonly Mark[], g: Generator): number {
  const xs = alive(marks);
  if (xs.length === 0) return 0;
  let hits = 0;
  for (const m of xs) {
    const target = applyPose(m.pose, g);
    if (xs.some((o) => o.classId === m.classId && o.pose === target)) hits++;
  }
  return hits / xs.length;
}

/** Keep a candidate iff it is an automorphism of the seen fragment, or identity. */
export function propose(
  marks: readonly Mark[],
  k: number,
  kind: Kind,
  tau: number = MATCH_TAU,
): Generator | null {
  const g: Generator = { id: 0, k: wrapPose(k), kind };
  if (isIdentity(g)) return g;
  if (alive(marks).length === 0) return null;
  if (consistency(marks, g) + 1e-9 >= tau) return g;
  return null;
}

export function seenPoses(marks: readonly Mark[], classId: number): number[] {
  const s = new Set<number>();
  for (const m of alive(marks)) if (m.classId === classId) s.add(m.pose);
  return [...s].sort((a, b) => a - b);
}

export function missingPoses(marks: readonly Mark[], classId: number): number[] {
  const seen = new Set(seenPoses(marks, classId));
  const out: number[] = [];
  for (let p = 0; p < ORBIT_N; p++) if (!seen.has(p)) out.push(p);
  return out;
}

/**
 * The rare event: add only the missing poses of a class, seated on the ring
 * around the class centroid. Never invents a new class. Deterministic.
 */
export function completeOrbit(
  marks: readonly Mark[],
  classId: number,
  nextId: number,
): Mark[] {
  const members = alive(marks).filter((m) => m.classId === classId);
  if (members.length === 0) return [];
  let cx = 0;
  let cy = 0;
  for (const m of members) {
    cx += m.nx;
    cy += m.ny;
  }
  cx /= members.length;
  cy /= members.length;
  const miss = missingPoses(marks, classId);
  const born: Mark[] = [];
  let id = nextId;
  for (const pose of miss) {
    const pt = ringPoint(pose, cx, cy);
    born.push(
      bornMark(id, hashSeed(classId, pose, members[0].seed), pt.nx, pt.ny, classId, pose),
    );
    id += 1;
  }
  return born;
}

export function fragmentCloses(marks: readonly Mark[], classId: number, g: Generator): boolean {
  const members = alive(marks).filter((m) => m.classId === classId);
  if (members.length === 0) return false;
  return consistency(members, g) + 1e-9 >= MATCH_TAU;
}

/**
 * Two fragments that close under the same generator fuse into one orbit.
 * The new class id is neither parent.
 */
export function fuseOrbits(
  marks: Mark[],
  classA: number,
  classB: number,
  g: Generator,
): number | null {
  if (classA === classB) return null;
  if (isIdentity(g)) return null;
  if (!fragmentCloses(marks, classA, g) || !fragmentCloses(marks, classB, g)) return null;
  const next = (hashSeed(classA + 1, classB + 1, g.k, g.kind === "flip" ? 1 : 0) % 0x3fffffff) + 1;
  if (next === classA || next === classB) return null;
  for (const m of marks) {
    if (m.classId === classA || m.classId === classB) m.classId = next;
  }
  return next;
}

/** Rotation meeting a flip is dihedral (a flip), not a louder cyclic. */
export function compose(a: Generator, b: Generator): Generator {
  if (a.kind === "rotate" && b.kind === "rotate") {
    return { id: 0, k: wrapPose(a.k + b.k), kind: "rotate" };
  }
  if (a.kind === "flip" && b.kind === "flip") {
    return { id: 0, k: wrapPose(a.k - b.k), kind: "rotate" };
  }
  if (a.kind === "rotate" && b.kind === "flip") {
    return { id: 0, k: wrapPose(b.k - a.k), kind: "flip" };
  }
  return { id: 0, k: wrapPose(a.k + b.k), kind: "flip" };
}

export function isDihedral(g: Generator): boolean {
  return g.kind === "flip";
}

/**
 * Next unused cyclic shift, walking 1..N-1. Used by the tap-3 rung.
 * Returns null when nothing left closes.
 */
export function nextUnusedShift(
  marks: readonly Mark[],
  kept: readonly Generator[],
  tau: number = MATCH_TAU,
): Generator | null {
  const used = new Set(kept.filter((g) => g.kind === "rotate").map((g) => wrapPose(g.k)));
  for (let k = 1; k < ORBIT_N; k++) {
    if (used.has(k)) continue;
    const g = propose(marks, k, "rotate", tau);
    if (g) return g;
  }
  for (let k = 0; k < ORBIT_N; k++) {
    if (kept.some((g) => g.kind === "flip" && wrapPose(g.k) === k)) continue;
    const g = propose(marks, k, "flip", tau);
    if (g) return g;
  }
  return null;
}

/**
 * A permutation of pose indices that is not a rotation or a flip.
 * Used as the pixel-permute analogue: it must not score as an automorphism
 * of a genuine cyclic fragment.
 */
export function scramblePerm(): number[] {
  // swap 1 and 2 only — not a cyclic shift and not a reflection through a diameter
  const p = [...Array(ORBIT_N).keys()];
  const t = p[1];
  p[1] = p[2];
  p[2] = t;
  return p;
}

export function applyPerm(pose: number, perm: number[]): number {
  return perm[wrapPose(pose)] ?? wrapPose(pose);
}

export function consistencyPerm(marks: readonly Mark[], perm: number[]): number {
  const xs = alive(marks);
  if (xs.length === 0) return 0;
  let hits = 0;
  for (const m of xs) {
    const target = applyPerm(m.pose, perm);
    if (xs.some((o) => o.classId === m.classId && o.pose === target)) hits++;
  }
  return hits / xs.length;
}

export function applyGeneratorToMark(m: Mark, g: Generator, cx: number, cy: number): void {
  m.pose = applyPose(m.pose, g);
  const pt = ringPoint(m.pose, cx, cy);
  m.nx = pt.nx;
  m.ny = pt.ny;
}

/** Kinship hue in 0..1. A fused class hashes far from either parent — never their mix. */
export function classHue(classId: number): number {
  return (hashSeed(classId + 1, 0xc8732a) % 10007) / 10007;
}

/** Inverse of a kept move: a rotation runs backward; a flip is its own inverse. */
export function invertGenerator(g: Generator): Generator {
  if (g.kind === "rotate") return { id: g.id, k: wrapPose(-g.k), kind: "rotate" };
  return { id: g.id, k: wrapPose(g.k), kind: "flip" };
}

/**
 * Store a kept automorphism. Identity is always true and never occupies a slot.
 * Duplicates are ignored. Past GEN_CAP the oldest leaves.
 */
export function keepGenerator(kept: readonly Generator[], g: Generator): Generator[] {
  if (isIdentity(g)) return [...kept];
  const k = wrapPose(g.k);
  if (kept.some((x) => x.kind === g.kind && wrapPose(x.k) === k)) return [...kept];
  const nextId = kept.reduce((m, x) => Math.max(m, x.id), 0) + 1;
  const row: Generator = { id: nextId, k, kind: g.kind };
  if (kept.length < GEN_CAP) return [...kept, row];
  return [...kept.slice(1), row];
}

/** Angle of cyclic shift `k`, radians. */
export function thetaOfShift(k: number): number {
  return (wrapPose(k) / ORBIT_N) * Math.PI * 2;
}

/**
 * Nearest lattice shift to a raw winding, and the angular gap to it.
 * `delta` is in radians, in [0, π].
 */
export function shiftFromTheta(theta: number): { k: number; delta: number } {
  const tau = Math.PI * 2;
  let t = theta;
  t = ((t % tau) + tau) % tau;
  const raw = t / tau * ORBIT_N;
  const k = wrapPose(Math.round(raw));
  const nearest = thetaOfShift(k);
  let d = t - nearest;
  if (d > Math.PI) d -= tau;
  if (d < -Math.PI) d += tau;
  return { k, delta: Math.abs(d) };
}

/** Consistency shrunk by how far the hand sits from the nearest lattice seat. */
export function consonanceAt(marks: readonly Mark[], g: Generator, delta: number): number {
  const c = consistency(marks, g);
  const seat = Math.PI * 2 / ORBIT_N;
  const shrink = 1 - Math.min(1, delta / (seat * 0.5 + 1e-9));
  return c * shrink;
}

export function classCentroid(marks: readonly Mark[], classId: number): { cx: number; cy: number } | null {
  const members = alive(marks).filter((m) => m.classId === classId);
  if (members.length === 0) return null;
  let cx = 0;
  let cy = 0;
  for (const m of members) {
    cx += m.nx;
    cy += m.ny;
  }
  return { cx: cx / members.length, cy: cy / members.length };
}

/**
 * Poses a kept generator predicts that are not yet seen — dim seats, never
 * free at mount. Distinct from completeOrbit, which fills every missing seat.
 */
export function predictedPoses(
  marks: readonly Mark[],
  classId: number,
  kept: readonly Generator[],
): number[] {
  const seen = new Set(seenPoses(marks, classId));
  const out = new Set<number>();
  const members = alive(marks).filter((m) => m.classId === classId);
  for (const m of members) {
    for (const g of kept) {
      const p = applyPose(m.pose, g);
      if (!seen.has(p)) out.add(p);
    }
  }
  return [...out].sort((a, b) => a - b);
}
