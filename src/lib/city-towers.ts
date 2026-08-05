/**
 * city-towers — the real event silhouettes.
 *
 * The event role is the iconic vertical the /city brief keeps naming by
 * name: London's Gherkin, San Francisco's Salesforce, the Transamerica
 * pyramid. Before R5-2 the event tower resolved to a smooth Lathe —
 * three faintly different bulges of a single revolved profile. Against a
 * Preetham sky the silhouette read as a plain onion. This module
 * replaces that single Lathe with three distinct constructions:
 *
 *   0. Gherkin        — one LatheGeometry body with a diamond curtain-
 *                       wall crosshatch overlaid on the emissive canvas
 *                       (the mullions read as combined emissive+dark
 *                       lines painted through the window pattern). Also
 *                       carries a small diamond-normal detail so the
 *                       grazing-angle reflection off the physical glass
 *                       breaks along the diamond rather than smoothing.
 *                       parts = 1 (+1 if spire).
 *
 *   1. Salesforce     — a stack of four tapered cylinder segments capped
 *                       by a low ellipsoid crown. Each setback is a
 *                       separate mesh so the taper reads as a real four-
 *                       step reduction, not a single lathe swell.
 *                       parts = 5 (+1 if spire).
 *
 *   2. Transamerica   — a four-sided pyramid with two thin wing prisms
 *                       flanking the north and south faces. The wings
 *                       carry the mechanical service shafts that make
 *                       the real building read as a machine, not a
 *                       plain cone.
 *                       parts = 3 (+1 if spire).
 *
 * The tallest 20% of event towers (by seeded height) get a slender
 * spire + antenna box bolted to their crown. `spireForSeed` returns the
 * boolean predicate; it uses the same salt as `heightForRole`'s hash so
 * the "tallest 20%" reads as literal, not statistical.
 *
 * The pure descriptor functions — `spireForSeed`,
 * `partCountForEventVariant`, `distinctSilhouettes` — never touch
 * Three.js and are safe to import from test scripts. The rest of the
 * module is the actual THREE builder invoked from city-geometry.ts.
 */

import * as THREE from "three";
import type { PlotRole } from "@/lib/city";
import { hashUnit } from "@/lib/city-geometry-pure";
import type { EventVariant } from "@/lib/city-geometry-pure";
import {
  drawEmissiveWindowCanvas,
  facadeMaterialFor,
} from "@/lib/city-facades";

// ── pure predicates (safe under the test's THREE stub) ─────────────────

/**
 * Whether a plot at this seed carries a spire.
 *
 * The brief calls out "per-variant spire on the tallest 20%". The
 * height ladder in city-geometry.ts derives an event's full height from
 * `hashUnit(seed, 3)`; the top 20% is exactly the seeds whose hash
 * exceeds 0.80. Sharing the salt makes the predicate mean what it says:
 * a tower with a spire IS one of the tallest twenty percent, not merely
 * a statistical fifth. Deterministic in the seed.
 */
export function spireForSeed(seed: number): boolean {
  return hashUnit(seed, 3) > 0.8;
}

/**
 * Number of Mesh children the tower Group will contain for this
 * (variant, seed). Pinned by test-city-geometry.mjs so a regression to
 * "one lathe again" collapses the counts back to 1 and fails loudly.
 *
 *   variant 0 (Gherkin)     → 1 body           (+1 spire)
 *   variant 1 (Salesforce)  → 4 steps + 1 cap  (+1 spire)
 *   variant 2 (Transamerica)→ 1 pyramid + 2 wings (+1 spire)
 *
 * The base counts are deliberately distinct — a silhouette regression
 * that reused one variant's builder for another would show up as a
 * mismatch even without a smooth-lathe rollback.
 */
export function partCountForEventVariant(variant: EventVariant, seed: number): number {
  const spire = spireForSeed(seed) ? 1 : 0;
  if (variant === 0) return 1 + spire;
  if (variant === 1) return 5 + spire;
  return 3 + spire;
}

/**
 * The three base part counts as a tuple. `test-city-geometry.mjs`
 * asserts these are all distinct — the silhouettes must not be
 * indistinguishable by Mesh count alone.
 */
export const BASE_PART_COUNTS: readonly [number, number, number] = [1, 5, 3];

/** True iff the three variant base part counts are all pairwise distinct.
 *  A convenience the test uses so a subtle change here fails loudly. */
export function distinctSilhouettes(): boolean {
  const [a, b, c] = BASE_PART_COUNTS;
  return a !== b && b !== c && a !== c;
}

// ── lathe profile for the Gherkin body ─────────────────────────────────
//
// Kept in this module so the diamond overlay pass and the profile stay
// in one place. The profile is a barrel swell narrowed at base and
// crown — the same silhouette the original city-geometry.ts exported,
// re-homed here so the tower builder is self-contained.

export const GHERKIN_LATHE_POINTS = 21;
export const GHERKIN_LATHE_RADIAL = 24;

function gherkinProfile(): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  const N = GHERKIN_LATHE_POINTS - 1;
  for (let i = 0; i <= N; i += 1) {
    const y = i / N;
    const swell = Math.sin(y * Math.PI) * 0.32;
    const taper = 1 - Math.max(0, (y - 0.85) / 0.15) ** 1.4 * 0.85;
    const r = (0.60 + swell) * taper;
    pts.push(new THREE.Vector2(Math.max(0.02, r), y));
  }
  return pts;
}

// ── Salesforce step heights + radii ────────────────────────────────────
//
// Four segments whose heights sum to 0.86 (leaving 0.14 of local Y for
// the ellipsoid crown). Radii taper monotonically from the widest base
// segment to the narrowest below the crown so the setback reads as a
// real four-step reduction, not a smooth cone.

export const SALESFORCE_SEGMENTS = 4;
const SALESFORCE_STEPS: readonly { yStart: number; yEnd: number; rBottom: number; rTop: number }[] = [
  { yStart: 0.00, yEnd: 0.30, rBottom: 0.62, rTop: 0.58 },
  { yStart: 0.30, yEnd: 0.55, rBottom: 0.57, rTop: 0.52 },
  { yStart: 0.55, yEnd: 0.74, rBottom: 0.51, rTop: 0.46 },
  { yStart: 0.74, yEnd: 0.86, rBottom: 0.45, rTop: 0.40 },
];
const SALESFORCE_CROWN: { yStart: number; yEnd: number; rEquator: number } =
  { yStart: 0.86, yEnd: 1.00, rEquator: 0.40 };

// ── Transamerica pyramid + wings ───────────────────────────────────────

const TRANSAM = {
  baseRadius: 0.55,
  wing: { widthFrac: 0.16, depthFrac: 0.06, heightFrac: 0.62, offsetFrac: 0.55 },
};

// ── spire ──────────────────────────────────────────────────────────────

const SPIRE = {
  baseRadius: 0.05,
  tipRadius: 0.008,
  height: 0.22, // in local-height units (extends above the tower crown)
};

// ── the builder ────────────────────────────────────────────────────────

export type BuiltEventTower = {
  /** Group whose children are exactly `partCountForEventVariant(...)` meshes. */
  group: THREE.Group;
  /** Ordered list of meshes owned by the group. First entries are the
   *  variant's body parts; the last is the spire when present. */
  meshes: THREE.Mesh[];
  /** The primary curtain-wall material — every glass mesh of the tower
   *  shares this material so a single emissiveIntensity write lights
   *  the whole tower in lockstep. */
  material: THREE.MeshPhysicalMaterial;
  /** The emissive canvas + texture the material's emissiveMap points at.
   *  Owned by this tower — caller must dispose them via `disposeBuiltEventTower`. */
  emissiveCanvas: HTMLCanvasElement;
  emissiveTexture: THREE.CanvasTexture;
  /** The seed and variant this tower was built for. Used by the caller
   *  to skip a rebuild when the same plot re-syncs. */
  seed: number;
  variant: EventVariant;
  /** True iff the tower carries a spire mesh (last entry in `meshes`). */
  hasSpire: boolean;
  /** The metallic spire material, if any — kept separate so the caller
   *  can dispose it independently of the shared glass material. */
  spireMaterial: THREE.MeshStandardMaterial | null;
};

/**
 * Build one event tower's geometry, materials, and emissive canvas for
 * the given (variant, seed).
 *
 * The returned Group has its origin at the tower's base center and its
 * local Y axis running from y=0 (base) to y=1 (crown, excluding any
 * spire that rises above 1). The caller is responsible for scaling the
 * group to (footprintX, height, footprintZ) and for positioning it in
 * world space.
 */
export function buildEventTower(params: {
  variant: EventVariant;
  seed: number;
  dayFraction: number;
  shadowsOn: boolean;
  emissiveSize: { w: number; h: number };
}): BuiltEventTower {
  const { variant, seed, dayFraction, shadowsOn, emissiveSize } = params;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(4, Math.floor(emissiveSize.w));
  canvas.height = Math.max(4, Math.floor(emissiveSize.h));
  drawEmissiveWindowCanvas("event", seed, dayFraction, canvas);
  if (variant === 0) overlayGherkinDiamondMask(canvas, seed);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;

  const material = facadeMaterialFor("event", seed) as THREE.MeshPhysicalMaterial;
  material.emissive = new THREE.Color(0xffffff);
  material.emissiveMap = texture;
  material.emissiveIntensity = 0;
  if (variant === 0) {
    // A shallow diamond-normal detail: the same crosshatch, expressed
    // as small normal deviations so the grazing-angle reflection off
    // the physical glass breaks along the diamond mullions rather than
    // smoothing across them. Cheap — one shared DataTexture for every
    // Gherkin, since the pattern is scale-invariant.
    material.normalMap = getSharedGherkinNormalMap();
    material.normalScale = new THREE.Vector2(0.35, 0.35);
  }
  material.needsUpdate = true;

  const group = new THREE.Group();
  group.name = `citySkylineEvent.${variant}.${seed}`;

  const meshes: THREE.Mesh[] = [];

  if (variant === 0) {
    const body = buildGherkinBody(material, shadowsOn);
    group.add(body);
    meshes.push(body);
  } else if (variant === 1) {
    const parts = buildSalesforceStack(material, shadowsOn);
    for (const m of parts) { group.add(m); meshes.push(m); }
  } else {
    const parts = buildTransamericaAndWings(material, shadowsOn);
    for (const m of parts) { group.add(m); meshes.push(m); }
  }

  const hasSpire = spireForSeed(seed);
  let spireMaterial: THREE.MeshStandardMaterial | null = null;
  if (hasSpire) {
    const { mesh, material: sm } = buildSpire(seed, shadowsOn);
    // Position the spire at the tower crown. The tower's local Y
    // reaches y=1 at the crown; the spire has its base at y=0 in its
    // own frame and rises to y=SPIRE.height. Place it slightly inside
    // the crown for the Salesforce ellipsoid and Gherkin's rounded top
    // so its base doesn't poke through the glass at grazing angles.
    const inset = variant === 2 ? 0.02 : 0.04;
    mesh.position.y = 1.0 - inset;
    group.add(mesh);
    meshes.push(mesh);
    spireMaterial = sm;
  }

  const expected = partCountForEventVariant(variant, seed);
  if (meshes.length !== expected) {
    // Belt-and-suspenders. The pure test pins this too, but if a code
    // path ever added or dropped a part the mismatch would surface at
    // runtime before anyone squinted at the silhouette.
    // eslint-disable-next-line no-console
    console.warn(
      `[city-towers] built ${meshes.length} parts for variant ${variant} seed ${seed}; ` +
      `expected ${expected}. The silhouette will read incorrectly.`,
    );
  }

  return {
    group,
    meshes,
    material,
    emissiveCanvas: canvas,
    emissiveTexture: texture,
    seed,
    variant,
    hasSpire,
    spireMaterial,
  };
}

/** Free the GL resources owned by a built tower. Safe to call more than
 *  once — subsequent calls are no-ops. */
export function disposeBuiltEventTower(tower: BuiltEventTower): void {
  for (const m of tower.meshes) {
    try { m.geometry.dispose(); } catch { /* noop */ }
  }
  try { tower.material.dispose(); } catch { /* noop */ }
  try { tower.emissiveTexture.dispose(); } catch { /* noop */ }
  if (tower.spireMaterial) {
    try { tower.spireMaterial.dispose(); } catch { /* noop */ }
  }
  // Empty the group so a subsequent re-add of a new tower to the same
  // parent doesn't observe stale children.
  while (tower.group.children.length) {
    tower.group.remove(tower.group.children[0]);
  }
}

// ── variant builders ───────────────────────────────────────────────────

function buildGherkinBody(
  material: THREE.MeshPhysicalMaterial,
  shadowsOn: boolean,
): THREE.Mesh {
  const geo = new THREE.LatheGeometry(gherkinProfile(), GHERKIN_LATHE_RADIAL);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = shadowsOn;
  mesh.receiveShadow = shadowsOn;
  return mesh;
}

function buildSalesforceStack(
  material: THREE.MeshPhysicalMaterial,
  shadowsOn: boolean,
): THREE.Mesh[] {
  const parts: THREE.Mesh[] = [];
  // Radial segments. 20 reads as a curved shaft without a heavy vertex
  // cost — Salesforce IRL is a 61-sided prism so this is generous
  // compared to real life, still light on the GPU.
  const RS = 20;
  for (const step of SALESFORCE_STEPS) {
    const h = step.yEnd - step.yStart;
    // CylinderGeometry(radiusTop, radiusBottom, height, radialSegments)
    // is centered at the origin — translate up so its base sits at
    // local y = step.yStart and its top at y = step.yEnd.
    const geo = new THREE.CylinderGeometry(step.rTop, step.rBottom, h, RS, 1, false);
    geo.translate(0, step.yStart + h * 0.5, 0);
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = shadowsOn;
    mesh.receiveShadow = shadowsOn;
    parts.push(mesh);
  }
  // Ellipsoid crown — a low half-sphere squashed vertically.
  const crownH = SALESFORCE_CROWN.yEnd - SALESFORCE_CROWN.yStart;
  const crownGeo = new THREE.SphereGeometry(SALESFORCE_CROWN.rEquator, RS, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  crownGeo.scale(1, crownH / SALESFORCE_CROWN.rEquator, 1);
  crownGeo.translate(0, SALESFORCE_CROWN.yStart, 0);
  const crown = new THREE.Mesh(crownGeo, material);
  crown.castShadow = shadowsOn;
  crown.receiveShadow = shadowsOn;
  parts.push(crown);
  return parts;
}

function buildTransamericaAndWings(
  material: THREE.MeshPhysicalMaterial,
  shadowsOn: boolean,
): THREE.Mesh[] {
  const parts: THREE.Mesh[] = [];

  // Pyramid — ConeGeometry(radius, height, radialSegments=4). Its base
  // sits at local y=0, tip at y=1.
  const pyrGeo = new THREE.ConeGeometry(TRANSAM.baseRadius, 1.0, 4);
  pyrGeo.rotateY(Math.PI / 4); // orient faces N/S/E/W rather than corners
  pyrGeo.translate(0, 0.5, 0);
  const pyr = new THREE.Mesh(pyrGeo, material);
  pyr.castShadow = shadowsOn;
  pyr.receiveShadow = shadowsOn;
  parts.push(pyr);

  // Two wing prisms flanking the N and S faces. Each is a thin box
  // whose bottom sits at y≈0 and whose top rises to
  // TRANSAM.wing.heightFrac. Positioned outboard of the pyramid so the
  // wing's inside face grazes the pyramid's outer surface.
  const w = TRANSAM.wing.widthFrac;
  const d = TRANSAM.wing.depthFrac;
  const h = TRANSAM.wing.heightFrac;
  const off = TRANSAM.wing.offsetFrac;
  const northGeo = new THREE.BoxGeometry(w, h, d);
  northGeo.translate(0, h * 0.5, off);
  const north = new THREE.Mesh(northGeo, material);
  north.castShadow = shadowsOn;
  north.receiveShadow = shadowsOn;
  parts.push(north);

  const southGeo = new THREE.BoxGeometry(w, h, d);
  southGeo.translate(0, h * 0.5, -off);
  const south = new THREE.Mesh(southGeo, material);
  south.castShadow = shadowsOn;
  south.receiveShadow = shadowsOn;
  parts.push(south);

  return parts;
}

function buildSpire(
  seed: number,
  shadowsOn: boolean,
): { mesh: THREE.Mesh; material: THREE.MeshStandardMaterial } {
  // Slender tapered cone. Deterministic slight height jitter so a row
  // of spired towers doesn't stamp.
  const jitter = 1 + (hashUnit(seed, 53) - 0.5) * 0.24;
  const h = SPIRE.height * jitter;
  const geo = new THREE.CylinderGeometry(SPIRE.tipRadius, SPIRE.baseRadius, h, 8, 1, false);
  geo.translate(0, h * 0.5, 0);
  const material = new THREE.MeshStandardMaterial({
    color: 0x9AA0A6,
    roughness: 0.42,
    metalness: 0.85,
  });
  material.name = "cityTower.spire";
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = shadowsOn;
  mesh.receiveShadow = shadowsOn;
  return { mesh, material };
}

// ── the diamond mullion overlay for the Gherkin ────────────────────────
//
// Paints the curtain-wall crosshatch on top of the drawn window canvas.
// The lines are dark (mullions read as an occlusion) with faint warm
// highlights inside each diamond cell — the glass panel edges catch a
// little tungsten spill at dusk in the reference photos.

/**
 * Overlay the Gherkin's diamond curtain-wall mullion mask on an
 * already-drawn emissive canvas. Modifies the canvas in place; safe to
 * re-run after `drawEmissiveWindowCanvas` on the same canvas so the
 * hourly rebake keeps the diamond mask.
 */
export function overlayGherkinDiamondMask(
  canvas: HTMLCanvasElement,
  seed: number,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;

  // The mullion grid — 8 diamonds around the tower's circumference at
  // the equator, tuned so the diamond height reads roughly one story
  // per pane. The real Gherkin has 24 mullions per band; 8 in the
  // 128px-wide texture reads correctly at expected screen sizes.
  const COLS = 8;
  const ROW_SPACING = 12; // pixels per diamond row

  const mullionColor = "rgba(24, 26, 30, 0.62)";
  const highlightColor = "rgba(255, 197, 138, 0.14)";

  ctx.lineWidth = 1.0;

  // Diagonal lines running upper-left to lower-right.
  ctx.strokeStyle = mullionColor;
  const cellW = W / COLS;
  const slope = ROW_SPACING; // rise per cellW of run
  // Draw enough diagonals to cover the canvas at both diagonals.
  for (let i = -Math.ceil(H / slope); i < COLS + Math.ceil(H / slope); i += 1) {
    ctx.beginPath();
    ctx.moveTo(i * cellW, 0);
    ctx.lineTo(i * cellW + (H / slope) * cellW, H);
    ctx.stroke();
  }
  // Diagonal lines running upper-right to lower-left.
  for (let i = -Math.ceil(H / slope); i < COLS + Math.ceil(H / slope); i += 1) {
    ctx.beginPath();
    ctx.moveTo(i * cellW, 0);
    ctx.lineTo(i * cellW - (H / slope) * cellW, H);
    ctx.stroke();
  }

  // A per-seed subtle highlight on every third diamond band so no two
  // Gherkins read as identical from the same angle.
  ctx.fillStyle = highlightColor;
  const bandOffset = Math.floor(hashUnit(seed, 59) * 3);
  const bandH = ROW_SPACING * 2;
  for (let y = -bandH + (bandOffset * ROW_SPACING); y < H; y += bandH * 3) {
    ctx.fillRect(0, y, W, ROW_SPACING);
  }
}

// ── shared normal map for the Gherkin diamond curtain wall ─────────────

let _gherkinNormalMap: THREE.DataTexture | null = null;

/**
 * Return the shared diamond normal-map DataTexture, building it on
 * first access. The texture is a small (64x64) tileable pattern whose
 * normals bump outward along the diamond ridges and dip along the
 * mullion valleys — the same crosshatch the emissive overlay draws,
 * expressed as a normal deviation so grazing-angle reflection off the
 * physical glass breaks along the diamond rather than smoothing.
 */
export function getSharedGherkinNormalMap(): THREE.DataTexture {
  if (_gherkinNormalMap) return _gherkinNormalMap;

  const SIZE = 64;
  const data = new Uint8Array(SIZE * SIZE * 4);
  const period = SIZE / 4; // 4 diamonds per side
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      // Diamond distance field: |sin(u+v)| + |sin(u-v)| where u,v are
      // texel coords scaled to the diamond period. The ridge is at
      // integer values of u±v; the valley is at half-integer values.
      const u = (x / period) * Math.PI;
      const v = (y / period) * Math.PI;
      const dU = Math.cos(u + v) - Math.cos(u - v); // ∂h/∂x proxy
      const dV = Math.cos(u + v) + Math.cos(u - v); // ∂h/∂y proxy
      // Normal encoded in [0,255]. z stays near 1 (pointing out); x,y
      // are the small deviations we want at the grazing angle.
      const nx = 0.5 * dU * 0.35; // amplitude → keep it subtle
      const ny = 0.5 * dV * 0.35;
      const nz = Math.max(0.7, 1 - Math.hypot(nx, ny));
      const inv = 1 / Math.hypot(nx, ny, nz);
      const i = (y * SIZE + x) * 4;
      data[i    ] = Math.round((nx * inv * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((nz * inv * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  tex.name = "cityTower.gherkinDiamondNormal";
  _gherkinNormalMap = tex;
  return tex;
}

/** Test hook — resets the shared normal-map cache so a subsequent
 *  `getSharedGherkinNormalMap` call rebuilds it. Not used at runtime. */
export function _resetSharedGherkinNormalMap(): void {
  _gherkinNormalMap = null;
}

// ── re-exports for the test module ─────────────────────────────────────
// Keeps the test's import surface stable (`from "@/lib/city-towers"`)
// even though the pure-math side lives in city-geometry-pure.ts.
export type { EventVariant };
export { hashUnit };

// The role type is re-exported so unit tests can name the type without
// dragging in the whole city.ts surface.
export type EventTowerRole = Extract<PlotRole, "event">;
