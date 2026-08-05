/**
 * city-pedestrians — the InstancedMesh capsule pack that finally puts
 * bodies on the streets.
 *
 * The pinch camera goes to eye-level and cars already prowl the roads,
 * but the sidewalks were still empty — every dot the visitor sees walking
 * home from the market was a 2D pixel painted on the overlay canvas, and
 * at any pitch below ~50° the missing bodies were the largest remaining
 * maquette tell. This module closes that gap without touching a single
 * pure law in `src/lib/city.ts`:
 *
 *   - a body InstancedMesh in POSE A (right leg forward, left leg back)
 *   - a body InstancedMesh in POSE B (left leg forward, right leg back)
 *   - a head-dot InstancedMesh (tiny emissive sphere, blooms at dusk)
 *
 * Every pedestrian is one instance-index shared across the three meshes.
 * Each frame the pedestrian's arc-length (accumulated normalized distance
 * since spawn) selects pose A or pose B via `walkPhaseForArcLength`; the
 * unchosen pose scales to zero on that instance while the other renders,
 * giving a legible two-pose leg swing at ~1 stride per 0.9 world-metre
 * walked. A pedestrian whose `standing` flag is true holds pose A with
 * both feet together — a body parked at a store points nowhere, a walking
 * body reads as walking, and the two are told apart by geometry, not by
 * a heading arrow floating above their head.
 *
 * At night the head dot lifts a warm tungsten emissive that the composer
 * bloom pass picks up — from bird's-eye a colony of regulars around a
 * plot reads as a small cluster of pinpoint sparks, matching the lit
 * windows they walked home to. `headDotEmissiveFor(night)` gates that
 * lift the same shape `city-traffic`'s bulbs use so the whole city turns
 * on together as the sun goes down.
 *
 * The pure exports at the top — MAX_PEDESTRIANS, WALK_STRIDE_NORM,
 * PEDESTRIAN_HEIGHT_M, HEAD_DOT_NIGHT_GATE, walkPhaseForArcLength,
 * pedestrianYawForHeading, pedestrianColorFor, headDotEmissiveFor — are
 * what `test-city-pedestrians.mjs` pins without a WebGL context.
 *
 * The module reads people as plain data (x, y in normalized 0..1 city
 * space, heading in the same canvas-2D convention the overlay used, plus
 * id/standing/leaving/regular flags) and remaps to world with CITY_HALF
 * from `city-camera.ts`. It has NO import edge back into city.ts's laws;
 * the laws stay pure, the renderer stays a downstream consumer.
 */

import * as THREE from "three";

import { CITY_HALF } from "@/lib/city-camera";
import type { QualityTier } from "@/lib/room-runtime";

// ─── pure constants + pinned functions ──────────────────────────────────

/**
 * InstancedMesh capacity for pedestrians. 256 is the brief's cap and
 * enough for a densely populated small settlement (48 plots × up to 3
 * dwellers each = 144 residents worst-case; the extra headroom covers
 * arriving/leaving overlap and a few visitors from nearby homes). If a
 * caller ever wants fewer, `createCityPedestrians` accepts a smaller
 * maxCount that is clamped up to MIN_CAPACITY_PEDESTRIANS.
 */
export const MAX_PEDESTRIANS = 256;

/**
 * The floor on the InstancedMesh capacity. The brief pins the range at
 * 128–256; even a low-tier device gets 128 pedestrian slots, because a
 * scene with fewer walkers reads as depopulated, not lightweight. Pinned
 * by the test so a later tune-up doesn't silently drop below.
 */
export const MIN_CAPACITY_PEDESTRIANS = 128;

/**
 * How far a pedestrian walks (in normalized 0..1 city coordinates) for
 * one full walk-cycle. 0.011 is roughly 0.88 world-metres at CITY_HALF=40
 * — a plausible half-stride, so a full cycle (two half-strides, A → B →
 * A) is ~1.76 m, matching the average human stride length referenced by
 * animation rigs. Pinning it here means the leg-swing cadence stays the
 * same across visits, and a later tune-up shows in the test.
 */
export const WALK_STRIDE_NORM = 0.011;

/**
 * Approximate pedestrian height in world metres. Not an editable knob;
 * it's the height the body geometry is authored at (torso + head + legs
 * add to ~1.75 m). Exported so callers who want to align a badge or a
 * name label to the head can read the same constant the geometry uses.
 */
export const PEDESTRIAN_HEIGHT_M = 1.75;

/**
 * Night amount at which the head dot's tungsten emissive begins to lift
 * off zero. Below this the bloom pass has nothing warm to catch. The
 * gate matches `city-traffic`'s lamp-bulb gate at 0.35 so the whole city
 * turns on together as the sun goes down; the shader smoothsteps to
 * full at 0.6 so the pinprick doesn't snap on at the exact threshold.
 */
export const HEAD_DOT_NIGHT_GATE = 0.35;
const HEAD_DOT_NIGHT_TOP = 0.6;

/**
 * Deterministic 32-bit hash → unit float. Same shape the rest of the
 * /city library uses; not exported because there's no need to
 * cross-check hash equivalence between modules — the tests pin the
 * function outputs, not the internals.
 */
function unitHash(seed: number, salt: number): number {
  let x = ((seed | 0) ^ ((salt * 0x9e3779b1) | 0)) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) >>> 0;
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  return x / 0xffffffff;
}

/**
 * The two-pose walk cycle selector. A pedestrian who has walked
 * `arcNorm` normalized city-units since spawn is either in pose A (0)
 * or pose B (1) — the two feet-apart geometries the InstancedMeshes
 * carry. Pose A holds for the first half of a stride, pose B for the
 * second; the pose swap IS the illusion of walking.
 *
 * Pure function of arc-length so tests can pin the schedule without
 * running the module against a WebGL context. Nonsense inputs (NaN,
 * negative) fall through to pose A.
 */
export function walkPhaseForArcLength(arcNorm: number): 0 | 1 {
  if (!Number.isFinite(arcNorm) || arcNorm < 0) return 0;
  const stride = WALK_STRIDE_NORM;
  const half = stride * 0.5;
  const modArc = arcNorm - Math.floor(arcNorm / stride) * stride;
  return modArc < half ? 0 : 1;
}

/**
 * Convert the canvas-2D heading (radians, +x on the plot plane where
 * `dx = cos(h)`, `dy = sin(h)` — the same convention the 2D overlay's
 * heading-aligned sliver used) into a world-space Y-axis yaw suitable
 * for a Three.js Euler rotation.
 *
 * `normToWorld` maps (nx, ny) → (worldX, worldZ) directly, so a plot-
 * space velocity (cos h, sin h) becomes a world-space velocity of the
 * same numeric shape on the (X, Z) axes. To align the body's default
 * +Z-forward axis with that velocity, `yaw = atan2(dx_world, dz_world)`
 * = `atan2(cos h, sin h)` = `π/2 − h`. Pure; the test pins the mapping.
 */
export function pedestrianYawForHeading(heading: number): number {
  if (!Number.isFinite(heading)) return 0;
  return Math.PI / 2 - heading;
}

/**
 * A muted per-instance clothing colour. Three palettes:
 *   - ordinary passer-by → warm neutrals (charcoal, taupe, navy, olive)
 *   - regular            → teal (matches the belonging-teal the 2D
 *                          overlay used for regulars, so the visual
 *                          language survives the 2D→3D lift)
 *   - leaving            → a desaturated grey — belonging drops away as
 *                          the resident walks to the edge
 * Deterministic in the seed so a settlement remounted from persistence
 * sees the same person wearing the same coat.
 */
export function pedestrianColorFor(
  seed: number,
  isRegular: boolean,
  isLeaving: boolean,
): [number, number, number] {
  if (isLeaving) {
    // Neutral desaturated grey with a hair of per-seed drift so a crowd
    // of leavers doesn't stripe-match perfectly. Value 0.32±0.04.
    const drift = (unitHash(seed, 0x7a11) - 0.5) * 0.08;
    const v = 0.32 + drift;
    return [v, v, v * 1.02];
  }
  if (isRegular) {
    // Belonging-teal. Small per-seed drift so a colony of regulars
    // reads as many teal coats, not one uniform.
    const drift = (unitHash(seed, 0x4a9e) - 0.5) * 0.08;
    return [0.24 + drift, 0.56 + drift * 0.7, 0.56 + drift];
  }
  // Ordinary: pick one of six muted neutrals a London-street reference
  // actually shows. Palette hand-picked; per-seed index chooses which.
  const paletteIdx = Math.floor(unitHash(seed, 0x1c0a) * 6);
  const palette: Array<[number, number, number]> = [
    [0.14, 0.14, 0.16], // charcoal coat
    [0.42, 0.30, 0.20], // taupe jacket
    [0.16, 0.20, 0.30], // navy overcoat
    [0.28, 0.30, 0.22], // olive parka
    [0.58, 0.44, 0.30], // camel coat
    [0.34, 0.14, 0.16], // burgundy jumper
  ];
  return palette[Math.max(0, Math.min(palette.length - 1, paletteIdx))];
}

/**
 * The night-gated emissive multiplier for the head-dot. Zero below the
 * gate, ramps to 1 by nightAmt ≥ HEAD_DOT_NIGHT_TOP via smoothstep.
 * Bloom is what makes the dots read as pinpricks; this scalar drives
 * their emissive intensity.
 */
export function headDotEmissiveFor(nightAmt: number): number {
  const n = Math.max(0, Math.min(1, nightAmt || 0));
  if (n <= HEAD_DOT_NIGHT_GATE) return 0;
  if (n >= HEAD_DOT_NIGHT_TOP) return 1;
  const t = (n - HEAD_DOT_NIGHT_GATE) / (HEAD_DOT_NIGHT_TOP - HEAD_DOT_NIGHT_GATE);
  return t * t * (3 - 2 * t);
}

/**
 * Squared normalized-distance step per frame. If a delta between two
 * frames' positions exceeds this, the pedestrian has teleported (spawn,
 * despawn, respawn from persistence) and their arc-length must reset
 * instead of accumulating an enormous jump into the walk cycle. 0.08 in
 * normalized units is ~6.4 world-metres — larger than any legitimate
 * per-frame step, small enough to catch a genuine teleport.
 */
export const ARC_RESET_JUMP_SQ = 0.08 * 0.08;

/**
 * Accumulate arc-length across one frame's motion. Wraps modulo one
 * stride so the counter never overflows a Float32. On a teleport-scale
 * jump the arc resets to zero — a pedestrian who just spawned should
 * begin in pose A, not mid-stride.
 *
 * Pure so the test can pin the schedule without carrying frame state.
 */
export function accumulateArcLength(
  prevArc: number,
  dxNorm: number,
  dyNorm: number,
): number {
  const d2 = dxNorm * dxNorm + dyNorm * dyNorm;
  if (!Number.isFinite(d2)) return 0;
  if (d2 > ARC_RESET_JUMP_SQ) return 0;
  const d = Math.sqrt(d2);
  const next = prevArc + d;
  // Keep the counter bounded — one stride is plenty for the mod to hit.
  const wrap = WALK_STRIDE_NORM * 4;
  return next >= wrap ? next - wrap : next;
}

// ─── the pedestrian scene ───────────────────────────────────────────────

/**
 * The shape City.tsx already carries on each Person. The module doesn't
 * need the full Person struct — only the fields that decide where a
 * body stands and how it reads.
 */
export type PedestrianInput = {
  /** Stable per-visit id — same id across frames means same body, so
   * per-instance arc-length accumulates smoothly. */
  id: number;
  /** Normalized 0..1 plot-space x. */
  x: number;
  /** Normalized 0..1 plot-space y (canvas convention: +y is south). */
  y: number;
  /** Heading in radians in the canvas-2D convention: dx = cos(h), dy =
   * sin(h). Ignored when `standing` is true. */
  heading: number;
  /** True when the body has stopped moving (delivered by isStanding on
   * `stillMs` in City.tsx). A standing pedestrian holds pose A with
   * feet together — they aren't walking, so the swap is disabled. */
  standing: boolean;
  /** True while the pedestrian is walking to the edge to leave. The
   * body colour desaturates to grey and the fade parameter (a caller
   * pins it at 1 to keep them full-strength until the LEAVING_FADE_MS
   * timer expires and they're removed from the list). */
  leaving: boolean;
  /** True when the pedestrian is a regular of some plot (regularStoreId
   * or regularEventId set). Their coat wears the belonging-teal. */
  regular: boolean;
  /** Opacity 0..1. City.tsx's `fadeForLeaving` supplies this for
   * pedestrians in the leaving phase; ordinary walkers pass 1. Zero
   * scales the instance to nothing (below one pixel), so a fully-faded
   * leaver draws no visible pixels. */
  opacity: number;
};

export type CityPedestrians = {
  group: THREE.Group;
  /** Sync the visible pedestrian list. Called each frame from the tick
   * loop with the same array City.tsx has always kept. Idempotent. */
  setPedestrians(list: ReadonlyArray<PedestrianInput>): void;
  /** Advance the emissive gate, per-frame tier gating, and any future
   * ambient animation. Returns the head-dot emissive scalar for the
   * caller's diagnostics; nothing else needs it. */
  update(u: PedestrianUpdate): number;
  /** Drop GL resources. Call before renderer.dispose(). */
  dispose(): void;
};

export type PedestrianUpdate = {
  /** ms since last update. Currently unused by the update loop (arc
   * advance happens inside setPedestrians as it consumes the position
   * delta), but reserved for a future amble/idle-sway. */
  dtMs: number;
  /** Night amount 0..1, same value the ground shader takes. Gates the
   * head-dot emissive. */
  night: number;
  /** Current governor tier. Sleep hides the pedestrian group entirely. */
  tier: QualityTier;
};

export type CityPedestriansOptions = {
  /** Cap on the InstancedMesh count. Clamped up to MIN_CAPACITY and
   * capped at MAX_PEDESTRIANS. Defaults to MAX. */
  maxCount?: number;
  /** Optional per-mount seed for the body-colour palette. Defaults to
   * a fixed constant so a remount produces the same distribution — a
   * settlement remounted from persistence sees the same coats. */
  seed?: number;
};

// ─── module-internal state carriers ─────────────────────────────────────

type PedestrianState = {
  /** Accumulated arc-length since spawn, in normalized 0..1 city units.
   * Wraps modulo one stride so it never overflows a Float32. */
  arc: number;
  /** Last frame's normalized x — used to compute the delta that feeds
   * `accumulateArcLength`. */
  prevX: number;
  /** Last frame's normalized y. */
  prevY: number;
  /** The InstancedMesh instance slot this pedestrian claimed. Slots are
   * assigned on first sight and stay stable across frames so per-
   * instance colour is written once. -1 means unassigned. */
  slot: number;
};

// ─── body geometry builders ─────────────────────────────────────────────
// Two poses: A (right leg forward, left leg back) and B (mirror). Both
// share the same torso + head; only the leg positions differ. The
// InstancedMesh switches which pose renders per pedestrian per frame via
// a zero-scale hide on the unchosen slot.

/** Build one body geometry with the given leg longitudinal offset. A
 * positive `frontLegOffset` puts the right leg forward on +Z and the
 * left leg back on -Z; a negative value mirrors. The value is applied
 * to the leg-cylinder centre-Z positions before merging into the body
 * geometry. */
function buildBodyGeometry(frontLegOffset: number): THREE.BufferGeometry {
  // Torso: a slight-taper cylinder, 0.68 m tall, 0.24 m diameter at
  // shoulders narrowing to 0.20 m at hips. Centered vertically at 1.10 m
  // (hips at 0.76 m, shoulders at 1.44 m).
  const torso = new THREE.CylinderGeometry(0.12, 0.10, 0.68, 8, 1, false);
  torso.translate(0, 1.10, 0);

  // Head: a 0.13 m radius sphere sitting at 1.60 m — the top of the
  // capsule is at PEDESTRIAN_HEIGHT_M (1.75 m).
  const head = new THREE.SphereGeometry(0.13, 10, 6);
  head.translate(0, 1.62, 0);

  // Legs: two 0.72 m tall thin cylinders, 0.09 m diameter. Centred at
  // 0.36 m (foot at 0.00 m, hip at 0.72 m). Left leg X = -0.09 m, right
  // leg X = +0.09 m. Longitudinal (Z) offset carries the walk pose:
  // pose A → right leg +frontLegOffset, left leg -frontLegOffset.
  const leftLeg = new THREE.CylinderGeometry(0.045, 0.045, 0.72, 6, 1, false);
  leftLeg.translate(-0.09, 0.36, -frontLegOffset);
  const rightLeg = new THREE.CylinderGeometry(0.045, 0.045, 0.72, 6, 1, false);
  rightLeg.translate(0.09, 0.36, frontLegOffset);

  // Arms: two thin cylinders alongside the torso. Same swing convention
  // as legs but opposite phase (arms counter-swing to legs) — pose A
  // has the LEFT arm forward while the right leg is forward. This is
  // the small anatomical detail that reads as "walking" rather than
  // "capsule twitching". Arms hang 0.15 m off-centre in X, centred at
  // Y = 1.10 m, tilted slightly forward at pose A.
  const leftArm = new THREE.CylinderGeometry(0.045, 0.045, 0.60, 6, 1, false);
  leftArm.translate(-0.19, 1.10, frontLegOffset * 0.7);
  const rightArm = new THREE.CylinderGeometry(0.045, 0.045, 0.60, 6, 1, false);
  rightArm.translate(0.19, 1.10, -frontLegOffset * 0.7);

  // Merge into one buffer geometry. We hand-merge (concatenate position
  // + index buffers) rather than pull in BufferGeometryUtils, keeping
  // the module free of the examples-dependency tree. Six sub-geometries
  // is small enough that a per-attribute concat is cheap.
  const merged = mergeGeometries([torso, head, leftLeg, rightLeg, leftArm, rightArm]);
  merged.computeVertexNormals();
  return merged;
}

/** Build the "standing" body: legs together, arms at side. Used for
 * pedestrians whose `isStanding` predicate is true so a body parked at
 * a store reads as a person WAITING, not a person mid-stride. */
function buildStandingBodyGeometry(): THREE.BufferGeometry {
  return buildBodyGeometry(0);
}

/** Minimal geometry merge — concatenates non-indexed geometries after
 * ensuring each has the same attribute set. Every geometry we hand in
 * above shares `position` + `normal`, so we merge those two and drop
 * the rest. Cheaper and simpler than pulling in BufferGeometryUtils. */
function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Ensure every geometry is non-indexed and has computed normals
  // BEFORE we merge — a merged index buffer that references vertex
  // offsets in the wrong sub-buffer would blow up on the GPU.
  const nonIndexed: THREE.BufferGeometry[] = geos.map((g) => {
    const gi = g.index ? g.toNonIndexed() : g;
    if (!gi.attributes.normal) gi.computeVertexNormals();
    return gi;
  });
  let totalVerts = 0;
  for (const g of nonIndexed) {
    totalVerts += g.attributes.position.count;
  }
  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  let offset = 0;
  for (const g of nonIndexed) {
    const p = g.attributes.position;
    const n = g.attributes.normal;
    for (let i = 0; i < p.count; i += 1) {
      positions[(offset + i) * 3 + 0] = p.getX(i);
      positions[(offset + i) * 3 + 1] = p.getY(i);
      positions[(offset + i) * 3 + 2] = p.getZ(i);
      normals[(offset + i) * 3 + 0] = n.getX(i);
      normals[(offset + i) * 3 + 1] = n.getY(i);
      normals[(offset + i) * 3 + 2] = n.getZ(i);
    }
    offset += p.count;
  }
  // Dispose the sub-geometries — nothing outside this file needs them.
  for (const g of geos) {
    try { g.dispose(); } catch { /* noop */ }
  }
  for (const g of nonIndexed) {
    if (!geos.includes(g)) {
      try { g.dispose(); } catch { /* noop */ }
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  return out;
}

/** The head-dot geometry: a small 0.06 m sphere the composer bloom pass
 * turns into a pinprick at night. Cheap — 8×4 segments — because a dot
 * that big never shows its poly seams. */
function buildHeadDotGeometry(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(0.06, 8, 4);
  geo.translate(0, PEDESTRIAN_HEIGHT_M - 0.05, 0);
  return geo;
}

// ─── the factory ────────────────────────────────────────────────────────

export function createCityPedestrians(opts: CityPedestriansOptions = {}): CityPedestrians {
  const seed = opts.seed ?? 0xbe11a5;
  const capacity = Math.max(
    MIN_CAPACITY_PEDESTRIANS,
    Math.min(MAX_PEDESTRIANS, opts.maxCount ?? MAX_PEDESTRIANS),
  );

  const group = new THREE.Group();
  group.name = "cityPedestrians";

  // ── shared PBR material ─────────────────────────────────────────────
  // A single MeshStandardMaterial with per-instance colour. Roughness is
  // middling — a raincoat isn't chrome, but the dusk light should catch
  // a small highlight on shoulders and head at low sun. Metalness low.
  const bodyMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xffffff), // multiplied by instanceColor
    metalness: 0.10,
    roughness: 0.72,
  });

  // Head dot: warm tungsten emissive that lifts under the night gate.
  // Bloom pass sells the halo. Colour matches the lamp-bulb tungsten
  // used in `city-traffic` so a crowd at a store reads as tiny sparks
  // matching the lit windows they walked home to.
  const headDotMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xffc078),
    emissive: new THREE.Color(0xffc078),
    emissiveIntensity: 0,
    metalness: 0.0,
    roughness: 0.4,
  });

  // ── pose geometries ────────────────────────────────────────────────
  // Two walking poses (A / B) and one standing pose. All three share
  // the same material and per-instance colour attribute — a pedestrian
  // occupies the same slot in all three meshes and only ONE mesh
  // renders that slot at non-zero scale per frame. Zero-scale is the
  // cheapest hide (no branch on GPU, no allocation, no per-frame count
  // recompute).
  const poseAGeo = buildBodyGeometry(0.14);   // right leg forward
  const poseBGeo = buildBodyGeometry(-0.14);  // left leg forward
  const standGeo = buildStandingBodyGeometry();
  const headGeo = buildHeadDotGeometry();

  const bodyA = new THREE.InstancedMesh(poseAGeo, bodyMat, capacity);
  const bodyB = new THREE.InstancedMesh(poseBGeo, bodyMat, capacity);
  const bodyStand = new THREE.InstancedMesh(standGeo, bodyMat, capacity);
  const head = new THREE.InstancedMesh(headGeo, headDotMat, capacity);

  for (const m of [bodyA, bodyB, bodyStand, head]) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = false;
    m.receiveShadow = false;
    m.frustumCulled = false; // per-instance transforms move; culling per
    // instance would need a bounding box per slot. Cheaper to draw the
    // whole batch and let the depth test win.
    group.add(m);
  }
  bodyA.name = "pedestrians-poseA";
  bodyB.name = "pedestrians-poseB";
  bodyStand.name = "pedestrians-standing";
  head.name = "pedestrians-head";

  // Per-instance colour. Written once per pedestrian on first sight
  // (colour is a function of seed + regular + leaving), then rewritten
  // only when the regular/leaving flags change. Same colour buffer is
  // shared across the three body meshes so a pedestrian doesn't
  // colour-flicker as they switch poses.
  const colourArr = new Float32Array(capacity * 3);
  const colourAttr = new THREE.InstancedBufferAttribute(colourArr, 3);
  colourAttr.setUsage(THREE.DynamicDrawUsage);
  bodyA.instanceColor = colourAttr;
  bodyB.instanceColor = colourAttr;
  bodyStand.instanceColor = colourAttr;
  // Head dot: uniform colour (warm tungsten), no per-instance drift.

  // ── mutable state carried across frames ─────────────────────────────
  const states = new Map<number, PedestrianState>();
  const freeSlots: number[] = [];
  for (let i = capacity - 1; i >= 0; i -= 1) freeSlots.push(i);
  // Track the "colour identity" of each slot so we only re-write the
  // instanceColor buffer when the flags actually change. A pedestrian
  // whose regular flag flips from false to true (just crossed the
  // regular threshold) sees their coat turn teal in the same frame.
  // When a slot returns to the free pool the entry resets to "" so a
  // later spawn writes fresh colour on first sight.
  const slotColourIdentity: string[] = new Array(capacity).fill("");

  // Scratch matrices — allocated once, reused every frame.
  const scratchMatrix = new THREE.Matrix4();
  const scratchZero = new THREE.Matrix4().makeScale(0, 0, 0);
  const scratchPos = new THREE.Vector3();
  const scratchQuat = new THREE.Quaternion();
  const scratchScale = new THREE.Vector3(1, 1, 1);
  const scratchEuler = new THREE.Euler();

  // Zero every slot up-front so the first frame doesn't briefly show
  // 256 identity-matrix bodies at the origin.
  for (let i = 0; i < capacity; i += 1) {
    bodyA.setMatrixAt(i, scratchZero);
    bodyB.setMatrixAt(i, scratchZero);
    bodyStand.setMatrixAt(i, scratchZero);
    head.setMatrixAt(i, scratchZero);
  }
  bodyA.instanceMatrix.needsUpdate = true;
  bodyB.instanceMatrix.needsUpdate = true;
  bodyStand.instanceMatrix.needsUpdate = true;
  head.instanceMatrix.needsUpdate = true;

  // The set of ids seen this frame — used to reclaim slots whose
  // pedestrian left the list (fed all their leavers into the edge, or
  // arrived and turned into a settled resident whose colour changed).
  const seenIds = new Set<number>();

  function setPedestrians(list: ReadonlyArray<PedestrianInput>): void {
    seenIds.clear();

    // First pass: assign slots to any pedestrian we haven't seen before,
    // and refresh per-instance colour when their regular/leaving flags
    // have changed.
    for (const ped of list) {
      let state = states.get(ped.id);
      if (!state) {
        // Try to claim a free slot; if none are left, this pedestrian
        // is culled for this frame (freeSlots empties only when > 256
        // pedestrians are alive at once, which the settlement doesn't
        // reach in normal play).
        const slot = freeSlots.pop();
        if (slot === undefined) continue;
        state = { arc: 0, prevX: ped.x, prevY: ped.y, slot };
        states.set(ped.id, state);
      }
      seenIds.add(ped.id);

      // Colour identity — recompute the tuple key and only touch the
      // instanceColor buffer when it changed. A regular's teal is
      // (seed, regular=true, leaving=false); a settled ordinary is
      // (seed, regular=false, leaving=false); a leaver is
      // (seed, *, leaving=true). Three flags, small string.
      const identity = `${ped.regular ? 1 : 0}|${ped.leaving ? 1 : 0}`;
      if (slotColourIdentity[state.slot] !== identity) {
        const [r, g, b] = pedestrianColorFor(ped.id, ped.regular, ped.leaving);
        colourArr[state.slot * 3 + 0] = r;
        colourArr[state.slot * 3 + 1] = g;
        colourArr[state.slot * 3 + 2] = b;
        slotColourIdentity[state.slot] = identity;
        colourAttr.needsUpdate = true;
      }
    }

    // Second pass: any state whose id wasn't seen this frame has left
    // the population. Hide its slot and return it to the free pool.
    // (Iterating a Map is safe; we collect the removals first.)
    const removed: number[] = [];
    for (const [id, state] of states) {
      if (!seenIds.has(id)) removed.push(id);
    }
    for (const id of removed) {
      const state = states.get(id);
      if (!state) continue;
      bodyA.setMatrixAt(state.slot, scratchZero);
      bodyB.setMatrixAt(state.slot, scratchZero);
      bodyStand.setMatrixAt(state.slot, scratchZero);
      head.setMatrixAt(state.slot, scratchZero);
      slotColourIdentity[state.slot] = "";
      freeSlots.push(state.slot);
      states.delete(id);
    }

    // Third pass: write per-frame transforms. Arc-length advances from
    // the delta between prev and current position, walk-phase selects
    // pose A / pose B, and standing pedestrians route to the standing
    // mesh with feet together. Head dot always renders at head height.
    for (const ped of list) {
      const state = states.get(ped.id);
      if (!state) continue; // slot-starved this frame

      // Advance arc-length using the pure accumulator. A teleport-scale
      // jump resets the arc so the pedestrian begins in pose A.
      const dx = ped.x - state.prevX;
      const dy = ped.y - state.prevY;
      state.arc = accumulateArcLength(state.arc, dx, dy);
      state.prevX = ped.x;
      state.prevY = ped.y;

      // Opacity 0 → hide entirely (a leaver whose fade timer expired
      // before City.tsx removed them from the list). Below one pixel:
      // scale to zero.
      if (!(ped.opacity > 0.02)) {
        bodyA.setMatrixAt(state.slot, scratchZero);
        bodyB.setMatrixAt(state.slot, scratchZero);
        bodyStand.setMatrixAt(state.slot, scratchZero);
        head.setMatrixAt(state.slot, scratchZero);
        continue;
      }

      // World-space position at the ground plane (y=0). normToWorld
      // maps (nx, ny) → (worldX, worldZ) — the same remap the tower
      // instances use, so a resident stops at the FRONT DOOR of the
      // extruded prism, not floating over its rooftop.
      const wx = (ped.x - 0.5) * 2 * CITY_HALF;
      const wz = (ped.y - 0.5) * 2 * CITY_HALF;
      // Uniform per-instance scale carries opacity — a leaving body
      // fades geometrically at the same rate their overlay dot did.
      // Cap at 1 so a caller who passes 1 gets the authored height,
      // and clamp low so a mid-fade body doesn't shrink to a pixel
      // before it disappears.
      const scaleFade = Math.max(0.35, Math.min(1, ped.opacity));

      // Yaw: standing pedestrians face along their last heading (or 0
      // if heading is degenerate). Walking pedestrians face along
      // motion direction. Both share pedestrianYawForHeading.
      const yaw = pedestrianYawForHeading(ped.heading);
      scratchEuler.set(0, yaw, 0);
      scratchQuat.setFromEuler(scratchEuler);

      // ── body pose selection ──────────────────────────────────────
      // Standing: draw the standing mesh at real scale, hide poses A/B.
      // Walking: draw one of A/B at real scale (chosen by arc-length),
      // hide the other + the standing mesh.
      if (ped.standing) {
        scratchPos.set(wx, 0, wz);
        scratchScale.set(scaleFade, scaleFade, scaleFade);
        scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
        bodyStand.setMatrixAt(state.slot, scratchMatrix);
        bodyA.setMatrixAt(state.slot, scratchZero);
        bodyB.setMatrixAt(state.slot, scratchZero);
      } else {
        const phase = walkPhaseForArcLength(state.arc);
        // Sub-stride bob: the body dips 3 cm at the mid-stride so the
        // eye reads a heel-strike rhythm even at eye-level. Uses a
        // triangle wave over the stride so pose transitions land on
        // the peaks.
        const stridePos = (state.arc / WALK_STRIDE_NORM) % 1;
        const bob = -0.03 * Math.sin(stridePos * Math.PI * 2);
        scratchPos.set(wx, bob, wz);
        scratchScale.set(scaleFade, scaleFade, scaleFade);
        scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
        if (phase === 0) {
          bodyA.setMatrixAt(state.slot, scratchMatrix);
          bodyB.setMatrixAt(state.slot, scratchZero);
        } else {
          bodyB.setMatrixAt(state.slot, scratchMatrix);
          bodyA.setMatrixAt(state.slot, scratchZero);
        }
        bodyStand.setMatrixAt(state.slot, scratchZero);
      }

      // Head-dot: always at head height, no bob (the emissive is what
      // reads from above, and a bobbing dot at bird's-eye looks like
      // random noise). Slightly larger scale on regulars so a colony
      // reads as a small cluster of pinpricks.
      const headScale = scaleFade * (ped.regular ? 1.35 : 1.0);
      scratchPos.set(wx, 0, wz);
      scratchScale.set(headScale, headScale, headScale);
      scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
      head.setMatrixAt(state.slot, scratchMatrix);
    }

    bodyA.instanceMatrix.needsUpdate = true;
    bodyB.instanceMatrix.needsUpdate = true;
    bodyStand.instanceMatrix.needsUpdate = true;
    head.instanceMatrix.needsUpdate = true;
  }

  function update(u: PedestrianUpdate): number {
    if (u.tier === "sleep") {
      group.visible = false;
      // Head dot stays off — but keep emissiveIntensity at zero anyway
      // so a wake-up frame doesn't flash a hot spot before the gate
      // recomputes.
      headDotMat.emissiveIntensity = 0;
      return 0;
    }
    group.visible = true;

    const emissive = headDotEmissiveFor(u.night);
    // Head-dot emissive: bloom pass sells the halo, this scalar drives
    // how much light the material actually contributes. Multiplier of
    // 2.8 is calibrated against city-traffic's 4.5 for lamps — a
    // pedestrian head-dot should read as smaller than a lamp bulb, so
    // the emissive is tuned lower and the bloom pass compresses them
    // together.
    headDotMat.emissiveIntensity = emissive * 2.8;
    return emissive;
  }

  function dispose(): void {
    try { poseAGeo.dispose(); } catch { /* noop */ }
    try { poseBGeo.dispose(); } catch { /* noop */ }
    try { standGeo.dispose(); } catch { /* noop */ }
    try { headGeo.dispose(); } catch { /* noop */ }
    try { bodyMat.dispose(); } catch { /* noop */ }
    try { headDotMat.dispose(); } catch { /* noop */ }
    states.clear();
  }

  return { group, setPedestrians, update, dispose };
}

// A future PR may add a light per-instance idle sway (an ambient
// weight-shift while standing at a plot, and a subtle arm swing on
// walkers) driven by dtMs — the update loop already accepts it, and
// the head-dot slot's opacity is a natural signal to reuse. Today the
// body geometry alone carries the pose, and the visible payoff is the
// leg-swap; a follow-up can layer sway onto that.
