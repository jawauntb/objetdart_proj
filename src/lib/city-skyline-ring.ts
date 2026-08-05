/**
 * city-skyline-ring — the landmark punctuation of the horizon.
 *
 * The `city-infill` ring (see `city-infill.ts`) already fills the r=90..500 m
 * annulus with 600 flat-topped hex-jittered silhouettes so the horizon
 * reads as more city, not empty sky. That baseline solves *density* — the
 * eye no longer sees a hard settlement edge. But density alone reads as a
 * *wall of boxes*: every reference the brief pins (SF, London, Zootopia)
 * carries a horizon that is not a picket of rectangles. It is punctuated —
 * a spire here, a water tank there, a pitched gable, a stepped mansard —
 * silhouettes the eye can pick out even at 400 m through fog.
 *
 * That punctuation is what this module adds. A sparser layer of ~80
 * landmark silhouettes, taller than the median infill building, riding
 * the same annulus, sharing the same PBR / IBL / fog / dusk-emissive
 * pipeline, but drawn as *distinct* silhouettes with real roof caps so
 * the horizon reads as a city that was built by many hands over many
 * decades — not printed once with a rectangular stamp.
 *
 * Approach — one enumerator, four shared InstancedMeshes:
 *
 *   The enumerator walks the same hex grid as the infill (`city-infill`)
 *   but at a much coarser cell size (SKYLINE_CELL_M = 46 m — roughly
 *   2.5 × the infill's 18 m) so the landmarks sit sparsely, one every
 *   ~half a block, and never crowd. Each surviving cell picks a cap
 *   type from a bimodal per-seed weighted draw:
 *
 *     - FLAT       35 %  a tall flat-topped tower, no cap
 *     - PITCHED    25 %  a pitched-gable triangular prism cap
 *     - WATER_TANK 20 %  a squat cylindrical water tank cap
 *     - SPIRE      20 %  a tapered cone cap (church steeple / obelisk)
 *
 *   The renderer then packs four InstancedMeshes:
 *
 *     - base_box: one instance for every landmark (all 80)
 *     - cap_pitched: one instance per PITCHED landmark
 *     - cap_water:   one instance per WATER_TANK landmark
 *     - cap_spire:   one instance per SPIRE landmark
 *
 *   Each cap's per-instance matrix sits above the base box's top face,
 *   in the base's local frame (base yaw carries the cap yaw). The
 *   InstancedMesh count per shape is a scalar assignment on tier change;
 *   the pool is packed once at construction.
 *
 * Distance from the infill:
 *
 *   The infill ring is *density*: many small buildings, low silhouette,
 *   short. The skyline ring is *character*: fewer buildings, taller
 *   silhouette, real caps.
 *
 *     |             infill            skyline-ring         |
 *     | count       600               80                   |
 *     | cell        18 m              46 m                 |
 *     | height      6..44 m           28..70 m             |
 *     | footprint   6..14 m           8..16 m              |
 *     | cap         flat box          flat / pitched /     |
 *     |                               water tank / spire   |
 *     | palette     brick/concrete/   Portland/steel/      |
 *     |             pale glass        Copper-verdigris     |
 *
 *   The palette is deliberately different from the infill — the London
 *   skyline reads Portland stone and steel-blue against the ochre brick
 *   below, and a few landmark buildings carry copper-verdigris cladding
 *   (the classic church steeple / clocktower green-oxidised copper).
 *   Every colour lands warm enough that the dusk sun catches it clean
 *   through the fog.
 *
 * Tier-gating:
 *
 *   HIGH   = 80 landmarks (the full punctuation ring)
 *   MEDIUM = 40           (halve it — most caps still visible)
 *   LOW    = 0            (skip the module — the low-tier visitor keeps
 *                          the infill baseline, which already reads as
 *                          a full horizon)
 *
 *   The four cap meshes' counts fall in proportion to how many of the
 *   near-first landmarks carry each cap type — a tier drop pulls from
 *   the tail, so the nearest landmarks are always the last to disappear.
 *
 * Materials:
 *
 *   Two MeshStandardMaterial instances (not physical — the fog at 100+ m
 *   swallows the specular signal that MeshPhysicalMaterial exists to
 *   render):
 *
 *     - `bodyMat` for the base box: instance colour drives the wall
 *       palette; emissive rides the dusk curve × per-instance aEmit.
 *     - `capMat`  for the three cap meshes: instance colour biased toward
 *       the copper / lead / stone accent palette; slightly higher
 *       metalness so caps catch the last dusk sun as a bright edge.
 *
 *   Both materials share the shader hook shape the infill uses — a
 *   per-instance `aEmit` attribute the fragment stage multiplies into
 *   `totalEmissiveRadiance`. The material's whole-scene emissiveIntensity
 *   comes from `emissiveIntensityForDay`, the same curve the plot facades
 *   and the infill ring already ride, so at any given dusk moment every
 *   surface in the frame lights on the same clock.
 *
 * Fog dissolve:
 *
 *   Same story as the infill: the world scene owns FogExp2 at density
 *   0.0035, and both materials set `fog: true`. The outer radius is the
 *   same 500 m so the ring dissolves into the sky the same way the
 *   infill does; no landmark stands past the horizon and pokes into a
 *   fog-free sky.
 *
 * Determinism:
 *
 *   The seed the caller passes drives every cell decision — grid position,
 *   jitter, cap type, height, footprint, yaw, colour, emit phase. No
 *   `Math.random`, no clock. A remount of the same visit gives the same
 *   80 landmarks in the same positions with the same caps.
 *
 * Zero gameplay coupling:
 *
 *   The skyline-ring is a pure visual field. It reads the same annulus
 *   the infill does (via constants imported from `city-infill`), calls
 *   the same dusk emissive curve, and hands City.tsx one group with four
 *   InstancedMeshes inside. It observes no plots, people, roads, or
 *   gestures. City.tsx calls `update(dayFraction, tier)` once per tick.
 */

import * as THREE from "three";
import {
  DEFAULT_HARBOUR,
  INFILL_INNER_R,
  INFILL_OUTER_R,
  annulusContains,
  unitHash,
  type HarbourCutout,
} from "@/lib/city-infill";
import { emissiveIntensityForDay } from "@/lib/city-windows";

// ── constants the tests pin ─────────────────────────────────────────────

/** Landmark ring shares the infill's annulus so the two layers dissolve
 *  through fog on the same schedule. */
export const SKYLINE_INNER_R = INFILL_INNER_R;
export const SKYLINE_OUTER_R = INFILL_OUTER_R;

/** Coarser hex cell than the infill (18 m). A landmark every ~46 m
 *  is dense enough that every 100 m of horizon carries at least one,
 *  sparse enough that the caps read as punctuation rather than fill. */
export const SKYLINE_CELL_M = 46;

/** Per-cell jitter as a fraction of the cell radius — a shade tighter
 *  than the infill so landmarks stay reasonably centered in their cells
 *  (a spire that reads off-axis inside its cell footprint reads as a
 *  buildings-leaning-into-each-other bug). */
export const SKYLINE_CELL_JITTER = 0.40;

/** Tier → landmark count. */
export const SKYLINE_COUNT_HIGH = 80;
export const SKYLINE_COUNT_MEDIUM = 50;
/** Low keeps landmarks so the postcard survives thermal throttle. */
export const SKYLINE_COUNT_LOW = 28;

/** Landmark height envelope (metres). Ceiling is 70 m — comfortably above
 *  the plot event tower's ~50 m so a distant church steeple pokes above
 *  the settlement's own peak, but the crowd of infill boxes (max 44 m)
 *  never touches these silhouettes. Floor is 28 m — no landmark reads
 *  as a bungalow; every one is tall enough to punctuate the horizon. */
export const SKYLINE_HEIGHT_MIN = 28;
export const SKYLINE_HEIGHT_MAX = 70;

/** Landmark base footprint (metres). Slightly thicker than the infill —
 *  a landmark is a bigger building. */
export const SKYLINE_WIDTH_MIN = 8;
export const SKYLINE_WIDTH_MAX = 16;

/** Cap type — a small closed enum the enumerator picks per seed. */
export type SkylineCap = "flat" | "pitched" | "water_tank" | "spire";

/** Weighted probabilities. Must sum to 1. The FLAT majority keeps the
 *  ring from reading as "every building is a landmark" (which would
 *  itself be a stylised toy); the spire + water tank + pitched trio
 *  supplies the punctuation the eye actually latches onto. */
export const SKYLINE_CAP_WEIGHTS: Record<SkylineCap, number> = {
  flat: 0.35,
  pitched: 0.25,
  water_tank: 0.20,
  spire: 0.20,
};

/** Cap height as a fraction of the base building height. Caps ride
 *  visibly above the base — a spire at 0.35 × height is a proper
 *  steeple, a water tank at 0.12 × is a squat cylinder above the
 *  parapet. Pitched roofs are 0.18 × — half a storey of gable. */
export const SKYLINE_CAP_HEIGHT_FRAC: Record<SkylineCap, number> = {
  flat: 0,
  pitched: 0.18,
  water_tank: 0.12,
  spire: 0.35,
};

/** Cap footprint scale relative to the base footprint. Spires are
 *  narrow (0.35 × wider dimension) so they taper cleanly; water tanks
 *  are squat (0.55 ×) so they sit centred on the roof deck; pitched
 *  roofs match the base footprint (1.0 ×) so the gable edges land on
 *  the building corners. */
export const SKYLINE_CAP_FOOTPRINT_FRAC: Record<SkylineCap, number> = {
  flat: 0,
  pitched: 1.0,
  water_tank: 0.55,
  spire: 0.38,
};

/** Governor tier tag — same shape the infill uses. */
export type SkylineTier = "low" | "medium" | "high" | "sleep";

// ── pure helpers (tested) ────────────────────────────────────────────────

/**
 * Landmark instance count for a governor tier. Sleep matches low.
 */
export function skylineCountForTier(tier: SkylineTier): number {
  if (tier === "high") return SKYLINE_COUNT_HIGH;
  if (tier === "medium") return SKYLINE_COUNT_MEDIUM;
  return SKYLINE_COUNT_LOW;
}

/**
 * Pick a cap type for a given seed. Deterministic and weighted by
 * SKYLINE_CAP_WEIGHTS. The weights are inlined into a cumulative
 * ladder so a regression in the weight table lands here in a test.
 */
export function pickCapForSeed(seed: number): SkylineCap {
  const u = unitHash(seed, 0xcafe11);
  // Cumulative ladder in enum order — flat, pitched, water_tank, spire.
  const wFlat = SKYLINE_CAP_WEIGHTS.flat;
  const wPitched = wFlat + SKYLINE_CAP_WEIGHTS.pitched;
  const wWater = wPitched + SKYLINE_CAP_WEIGHTS.water_tank;
  // wSpire = 1 by construction.
  if (u < wFlat) return "flat";
  if (u < wPitched) return "pitched";
  if (u < wWater) return "water_tank";
  return "spire";
}

/**
 * Landmark height. Similar shape to the infill's heightForSeed but with
 * a *higher* biased ceiling — the landmark ring is where the horizon's
 * peaks live. The distance mask still applies: closer landmarks are
 * capped lower so the plot event tower (~50 m) stays the visible peak
 * of the near frame.
 *
 * radialFrac is (r - INNER) / (OUTER - INNER), clamped to [0, 1].
 * At radialFrac=0 the ceiling drops to ~65 % of MAX (max ~45 m —
 * still comfortably above the plot's own event tower); at radialFrac=1
 * the ceiling reaches full MAX (70 m).
 */
export function landmarkHeightForSeed(seed: number, radialFrac: number): number {
  const r = Math.max(0, Math.min(1, radialFrac));
  const u = unitHash(seed, 0x7c1a13);
  // Bias toward the mid — landmarks are TALL by definition, not tiny;
  // u^0.7 pushes the distribution toward the top of its normalised
  // range, opposite of the infill's u^1.6 low bias.
  const biased = Math.pow(u, 0.7);
  const ceiling = SKYLINE_HEIGHT_MAX * (0.65 + 0.35 * r);
  return SKYLINE_HEIGHT_MIN + biased * (ceiling - SKYLINE_HEIGHT_MIN);
}

/**
 * Landmark base footprint. Both dimensions drawn from a compact envelope;
 * spires and water tanks read best when the base is close to square.
 */
export function landmarkFootprintForSeed(
  seed: number,
): { width: number; depth: number } {
  const u = unitHash(seed, 0x2a71b);
  const v = unitHash(seed, 0x3d19f);
  const width =
    SKYLINE_WIDTH_MIN + u * (SKYLINE_WIDTH_MAX - SKYLINE_WIDTH_MIN);
  const depth =
    SKYLINE_WIDTH_MIN + v * (SKYLINE_WIDTH_MAX - SKYLINE_WIDTH_MIN);
  return { width, depth };
}

/**
 * Landmark yaw. Landmarks tend to sit more square to the compass than
 * infill fill — town halls, churches, and clocktowers are placed with
 * axis-aligned care — so the jitter here is ±11.25° instead of the
 * infill's ±22.5°.
 */
export function landmarkYawForSeed(seed: number): number {
  const u = unitHash(seed, 0x4b917);
  return (u - 0.5) * (Math.PI / 8);
}

/**
 * Landmark base palette — Portland stone, steel blue, verdigris copper.
 * Deliberately different from the infill's brick/concrete/glass so a
 * landmark reads as *unusual* against the fill it stands in.
 */
export function landmarkColorForSeed(seed: number): [number, number, number] {
  const u = unitHash(seed, 0x5c11d);
  const palette: Array<[number, number, number]> = [
    // Portland stone — warm pale cream, the London landmark tone.
    [0.82, 0.78, 0.70],
    [0.86, 0.82, 0.74],
    // Steel blue — cool, mid-Victorian, catches dusk sky.
    [0.42, 0.50, 0.60],
    [0.36, 0.44, 0.56],
    // Verdigris copper — church steeples, clocktowers, dome oxide.
    [0.36, 0.62, 0.54],
    [0.32, 0.56, 0.50],
    // Lead grey — heavy, quiet, sits under a slate cap.
    [0.45, 0.46, 0.47],
  ];
  const idx = Math.floor(u * palette.length);
  const base = palette[Math.max(0, Math.min(palette.length - 1, idx))];
  const j = unitHash(seed, 0x6e11f) - 0.5;
  const push = 0.05 * j;
  return [
    Math.max(0, Math.min(1, base[0] + push)),
    Math.max(0, Math.min(1, base[1] + push * 0.5)),
    Math.max(0, Math.min(1, base[2] + push * 0.3)),
  ];
}

/**
 * Cap palette. Slightly cooler / more metallic than the base body — a
 * spire is usually copper or slate, a water tank is dark iron, a
 * pitched roof is dark clay tile. The cap catches the dusk sun as a
 * bright edge, which is why the cap material has slightly higher
 * metalness than the body — see the factory.
 */
export function capColorForSeed(seed: number): [number, number, number] {
  const u = unitHash(seed, 0x7f019);
  const palette: Array<[number, number, number]> = [
    // Slate blue-grey (pitched roof, mansard).
    [0.34, 0.36, 0.40],
    [0.30, 0.32, 0.36],
    // Iron black (water tank).
    [0.16, 0.16, 0.17],
    [0.20, 0.20, 0.21],
    // Verdigris (spire) — matches a subset of the body palette so a
    // building can be all-verdigris top to bottom, or contrast body /
    // cap; the seed decides.
    [0.34, 0.60, 0.52],
    // Weathered copper (spire).
    [0.58, 0.42, 0.28],
    // Terracotta (pitched roof) — for the London pitched-brick corner.
    [0.56, 0.30, 0.24],
  ];
  const idx = Math.floor(u * palette.length);
  const base = palette[Math.max(0, Math.min(palette.length - 1, idx))];
  const j = unitHash(seed, 0x8f11d) - 0.5;
  const push = 0.04 * j;
  return [
    Math.max(0, Math.min(1, base[0] + push)),
    Math.max(0, Math.min(1, base[1] + push * 0.5)),
    Math.max(0, Math.min(1, base[2] + push * 0.3)),
  ];
}

/**
 * Per-instance emissive phase in [0.15, 1.8], same envelope as the infill
 * ring. Landmarks tend to light warm — a clocktower's face, an office
 * building's top floors, a church's stained glass — so this curve leans
 * a shade higher than the infill's; the median lands around 0.85 instead
 * of 0.70. Still bimodal so some landmarks hold dark.
 */
export function landmarkEmitPhaseForSeed(seed: number): number {
  const u = unitHash(seed, 0xa11c17);
  const s = u * u * (3 - 2 * u);
  return 0.15 + s * 1.65;
}

// ── the descriptor + enumerator ─────────────────────────────────────────

export type SkylineLandmark = {
  x: number;
  z: number;
  yaw: number;
  width: number;
  depth: number;
  height: number;
  cap: SkylineCap;
  color: readonly [number, number, number];
  capColor: readonly [number, number, number];
  emitPhase: number;
  seed: number;
};

/**
 * Enumerate the deterministic list of landmark descriptors. Returned in
 * near-first order so dropping the tail on a tier change preserves the
 * near ring first — same policy as the infill.
 */
export function enumerateSkylineRing(
  seed: number,
  capacity: number,
  harbour: HarbourCutout = DEFAULT_HARBOUR,
  innerR: number = SKYLINE_INNER_R,
  outerR: number = SKYLINE_OUTER_R,
  cellM: number = SKYLINE_CELL_M,
): SkylineLandmark[] {
  const out: SkylineLandmark[] = [];

  const dx = cellM * Math.sqrt(3);
  const dz = cellM * 1.5;
  const cols = Math.ceil((outerR * 2) / dx) + 2;
  const rows = Math.ceil((outerR * 2) / dz) + 2;

  const halfCols = Math.floor(cols / 2);
  const halfRows = Math.floor(rows / 2);

  for (let rowIx = -halfRows; rowIx <= halfRows; rowIx += 1) {
    const zBase = rowIx * dz;
    const rowShift = (rowIx & 1) === 0 ? 0 : dx * 0.5;
    for (let colIx = -halfCols; colIx <= halfCols; colIx += 1) {
      const xBase = colIx * dx + rowShift;

      const r2Base = xBase * xBase + zBase * zBase;
      const margin = cellM * 2;
      const innerLim = innerR - margin;
      const outerLim = outerR + margin;
      if (r2Base < innerLim * innerLim) continue;
      if (r2Base > outerLim * outerLim) continue;

      // Cell seed uses different multiplicative primes than the infill
      // so a landmark and an infill building never fight for the same
      // cell (their grids are already at different sizes; the primes
      // just harden the independence).
      const cellSeed = (
        (seed ^ ((rowIx * 41402887) | 0) ^ ((colIx * 88437887) | 0)) >>> 0
      );
      const jx =
        (unitHash(cellSeed, 0x1a) - 0.5) * 2 * cellM * SKYLINE_CELL_JITTER;
      const jz =
        (unitHash(cellSeed, 0x1b) - 0.5) * 2 * cellM * SKYLINE_CELL_JITTER;
      const x = xBase + jx;
      const z = zBase + jz;

      if (!annulusContains(x, z, harbour, innerR, outerR)) continue;

      const rActual = Math.sqrt(x * x + z * z);
      const radialFrac = Math.max(
        0,
        Math.min(1, (rActual - innerR) / (outerR - innerR)),
      );
      const height = landmarkHeightForSeed(cellSeed, radialFrac);
      const footprint = landmarkFootprintForSeed(cellSeed);
      const yaw = landmarkYawForSeed(cellSeed);
      const color = landmarkColorForSeed(cellSeed);
      const capColor = capColorForSeed(cellSeed);
      const emitPhase = landmarkEmitPhaseForSeed(cellSeed);
      const cap = pickCapForSeed(cellSeed);

      out.push({
        x,
        z,
        yaw,
        width: footprint.width,
        depth: footprint.depth,
        height,
        cap,
        color,
        capColor,
        emitPhase,
        seed: cellSeed,
      });
    }
  }

  out.sort(
    (a, b) => a.x * a.x + a.z * a.z - (b.x * b.x + b.z * b.z),
  );

  if (out.length > capacity) out.length = capacity;
  return out;
}

// ── the factory ─────────────────────────────────────────────────────────

export type CitySkylineRingOptions = {
  seed: number;
  capacity?: number;
  harbour?: HarbourCutout;
  shadows?: boolean;
};

export type CitySkylineRing = {
  group: THREE.Group;
  base: THREE.InstancedMesh;
  capPitched: THREE.InstancedMesh;
  capWaterTank: THREE.InstancedMesh;
  capSpire: THREE.InstancedMesh;
  landmarks: readonly SkylineLandmark[];
  setTier(tier: SkylineTier): void;
  setEnvironment(env: THREE.Texture | null): void;
  setShadows(on: boolean): void;
  setDayFrac(day: number): void;
  dispose(): void;
};

/**
 * The InstancedMesh shader hook that the infill uses — per-instance
 * `aEmit` attribute multiplies `totalEmissiveRadiance`. Shared here so
 * the body + cap materials both light on the same clock.
 *
 * Kept as a closure the caller applies to any MeshStandardMaterial —
 * the four meshes below all share the same hook shape but keep their
 * own material identities so instanceColor lands right.
 */
function wireEmitHook(material: THREE.MeshStandardMaterial, key: string): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float aEmit;
varying float vEmit;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vEmit = aEmit;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying float vEmit;`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
totalEmissiveRadiance *= vEmit;`,
      );
  };
  material.customProgramCacheKey = () => key;
}

export function createCitySkylineRing(
  opts: CitySkylineRingOptions,
): CitySkylineRing {
  const seed = opts.seed >>> 0;
  const capacity = Math.max(
    0,
    Math.floor(opts.capacity ?? SKYLINE_COUNT_HIGH),
  );
  const harbour = opts.harbour ?? DEFAULT_HARBOUR;
  const shadows = opts.shadows !== false;

  const group = new THREE.Group();
  group.name = "citySkylineRing";

  const landmarks = enumerateSkylineRing(seed, capacity, harbour);
  const total = landmarks.length;

  // Count landmarks by cap type so each cap InstancedMesh only allocates
  // what it actually needs. Iterated in the same near-first order so the
  // per-cap InstancedMesh's own index ordering also runs near-first —
  // dropping a cap mesh's tail drops the far caps first, mirroring the
  // whole-ring drop policy.
  const pitchedIdx: number[] = [];
  const waterIdx: number[] = [];
  const spireIdx: number[] = [];
  for (let i = 0; i < total; i += 1) {
    const lm = landmarks[i];
    if (lm.cap === "pitched") pitchedIdx.push(i);
    else if (lm.cap === "water_tank") waterIdx.push(i);
    else if (lm.cap === "spire") spireIdx.push(i);
  }

  // ── geometries ──────────────────────────────────────────────────────
  // The base body — same unit box the infill uses; the per-instance
  // matrix owns the placement.
  const baseGeo = new THREE.BoxGeometry(1, 1, 1);

  // Pitched-gable cap — a triangular prism. The default BufferGeometry
  // for a prism is not in three-core, so we build it explicitly from
  // six vertices (a triangular cross-section extruded along local Z).
  // Local unit: cap sits with its base at y=0, apex at y=1, footprint
  // ±0.5 in X, ±0.5 in Z. The compose matrix below scales it to real
  // metres.
  const pitchedGeo = new THREE.BufferGeometry();
  {
    const v = new Float32Array([
      // front triangle (z = +0.5) — base-left, base-right, apex
      -0.5, 0, 0.5,
      0.5, 0, 0.5,
      0, 1, 0.5,
      // back triangle (z = -0.5)
      -0.5, 0, -0.5,
      0.5, 0, -0.5,
      0, 1, -0.5,
    ]);
    // Triangles: front, back, left slope, right slope, bottom.
    const idx = new Uint16Array([
      0, 1, 2,
      5, 4, 3,
      // left slope: (-0.5,0,+0.5) → (0,1,+0.5) → (0,1,-0.5) → (-0.5,0,-0.5)
      0, 2, 5,
      0, 5, 3,
      // right slope: (0.5,0,+0.5) → (0.5,0,-0.5) → (0,1,-0.5) → (0,1,+0.5)
      1, 4, 5,
      1, 5, 2,
      // base (facing down) — usually invisible but included for
      // shadow correctness.
      0, 3, 4,
      0, 4, 1,
    ]);
    pitchedGeo.setAttribute("position", new THREE.BufferAttribute(v, 3));
    pitchedGeo.setIndex(new THREE.BufferAttribute(idx, 1));
    pitchedGeo.computeVertexNormals();
  }

  // Water-tank cap — a short cylinder standing on the roof deck.
  const waterGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
  // Translate so base sits at y=0 (Three's cylinder is centred at y=0
  // with height 1, so it spans [-0.5, +0.5]; move it to [0, 1]).
  waterGeo.translate(0, 0.5, 0);

  // Spire cap — a tapered cone.
  const spireGeo = new THREE.ConeGeometry(0.5, 1, 8);
  spireGeo.translate(0, 0.5, 0);

  // ── materials ───────────────────────────────────────────────────────
  const bodyMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xffffff),
    metalness: 0.08,
    roughness: 0.76,
    emissive: new THREE.Color(0xffbf7a),
    emissiveIntensity: 0,
    fog: true,
  });
  wireEmitHook(bodyMat, "city-skyline-ring/body-aEmit-v1");

  // Caps run slightly more metallic so the dusk sun catches copper /
  // slate as a bright edge — the exact silhouette read the brief calls
  // out (SF Salesforce crown, London Gherkin dome).
  const capMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xffffff),
    metalness: 0.35,
    roughness: 0.48,
    emissive: new THREE.Color(0xffcc9a),
    emissiveIntensity: 0,
    fog: true,
  });
  wireEmitHook(capMat, "city-skyline-ring/cap-aEmit-v1");

  // ── the instanced meshes ────────────────────────────────────────────
  const base = new THREE.InstancedMesh(baseGeo, bodyMat, Math.max(1, total));
  const capPitched = new THREE.InstancedMesh(
    pitchedGeo,
    capMat,
    Math.max(1, pitchedIdx.length),
  );
  const capWaterTank = new THREE.InstancedMesh(
    waterGeo,
    capMat,
    Math.max(1, waterIdx.length),
  );
  const capSpire = new THREE.InstancedMesh(
    spireGeo,
    capMat,
    Math.max(1, spireIdx.length),
  );

  for (const m of [base, capPitched, capWaterTank, capSpire]) {
    m.castShadow = shadows;
    m.receiveShadow = false;
    m.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    m.frustumCulled = false;
  }
  base.name = "citySkylineRing-base";
  capPitched.name = "citySkylineRing-cap-pitched";
  capWaterTank.name = "citySkylineRing-cap-water-tank";
  capSpire.name = "citySkylineRing-cap-spire";

  // ── per-instance emit-phase buffers ─────────────────────────────────
  const baseEmit = new Float32Array(Math.max(1, total));
  const pitchedEmit = new Float32Array(Math.max(1, pitchedIdx.length));
  const waterEmit = new Float32Array(Math.max(1, waterIdx.length));
  const spireEmit = new Float32Array(Math.max(1, spireIdx.length));

  // Scratches — kept out of the loop.
  const scratchMat = new THREE.Matrix4();
  const scratchPos = new THREE.Vector3();
  const scratchQuat = new THREE.Quaternion();
  const scratchScale = new THREE.Vector3();
  const scratchAxis = new THREE.Vector3(0, 1, 0);
  const scratchColor = new THREE.Color();

  // ── write base instances ────────────────────────────────────────────
  for (let i = 0; i < total; i += 1) {
    const lm = landmarks[i];
    scratchPos.set(lm.x, lm.height * 0.5, lm.z);
    scratchScale.set(lm.width, lm.height, lm.depth);
    scratchQuat.setFromAxisAngle(scratchAxis, lm.yaw);
    scratchMat.compose(scratchPos, scratchQuat, scratchScale);
    base.setMatrixAt(i, scratchMat);

    scratchColor.setRGB(lm.color[0], lm.color[1], lm.color[2]);
    base.setColorAt(i, scratchColor);

    baseEmit[i] = lm.emitPhase;
  }

  // ── write cap instances (per-shape mesh, own indexing) ──────────────
  function writeCaps(
    ixs: number[],
    mesh: THREE.InstancedMesh,
    emitBuf: Float32Array,
    cap: SkylineCap,
  ): void {
    const heightFrac = SKYLINE_CAP_HEIGHT_FRAC[cap];
    const footFrac = SKYLINE_CAP_FOOTPRINT_FRAC[cap];
    for (let j = 0; j < ixs.length; j += 1) {
      const lm = landmarks[ixs[j]];
      const capH = lm.height * heightFrac;
      const capW = Math.min(lm.width, lm.depth) * footFrac;
      // Cap sits ON TOP of the base — its geometry has base at y=0 and
      // extends to y=1, so we position its origin at (x, baseHeight, z)
      // and scale into world metres.
      scratchPos.set(lm.x, lm.height, lm.z);
      // The cap footprint is symmetric (same x and z extent) for spire
      // and water tank; for pitched, we scale x by capW and z by the
      // base depth (a gable extends across the whole building along one
      // axis, not both).
      if (cap === "pitched") {
        scratchScale.set(lm.width, capH, lm.depth);
      } else {
        scratchScale.set(capW, capH, capW);
      }
      scratchQuat.setFromAxisAngle(scratchAxis, lm.yaw);
      scratchMat.compose(scratchPos, scratchQuat, scratchScale);
      mesh.setMatrixAt(j, scratchMat);

      scratchColor.setRGB(lm.capColor[0], lm.capColor[1], lm.capColor[2]);
      mesh.setColorAt(j, scratchColor);

      emitBuf[j] = lm.emitPhase;
    }
  }
  writeCaps(pitchedIdx, capPitched, pitchedEmit, "pitched");
  writeCaps(waterIdx, capWaterTank, waterEmit, "water_tank");
  writeCaps(spireIdx, capSpire, spireEmit, "spire");

  // Wire aEmit onto each geometry so the shader hook has an attribute
  // to read. Each geometry owns its own attribute buffer.
  baseGeo.setAttribute(
    "aEmit",
    (() => {
      const a = new THREE.InstancedBufferAttribute(baseEmit, 1);
      a.setUsage(THREE.StaticDrawUsage);
      return a;
    })(),
  );
  pitchedGeo.setAttribute(
    "aEmit",
    (() => {
      const a = new THREE.InstancedBufferAttribute(pitchedEmit, 1);
      a.setUsage(THREE.StaticDrawUsage);
      return a;
    })(),
  );
  waterGeo.setAttribute(
    "aEmit",
    (() => {
      const a = new THREE.InstancedBufferAttribute(waterEmit, 1);
      a.setUsage(THREE.StaticDrawUsage);
      return a;
    })(),
  );
  spireGeo.setAttribute(
    "aEmit",
    (() => {
      const a = new THREE.InstancedBufferAttribute(spireEmit, 1);
      a.setUsage(THREE.StaticDrawUsage);
      return a;
    })(),
  );

  // Mark buffers dirty.
  for (const m of [base, capPitched, capWaterTank, capSpire]) {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) {
      m.instanceColor.setUsage(THREE.StaticDrawUsage);
      m.instanceColor.needsUpdate = true;
    }
  }

  group.add(base);
  group.add(capPitched);
  group.add(capWaterTank);
  group.add(capSpire);

  // ── tier plumbing ───────────────────────────────────────────────────
  // The ring's draw count for a given tier is a scalar. Each cap mesh's
  // count is derived from how many of the near-first N landmarks carry
  // that cap type, so dropping a tier drops the FAR landmarks first —
  // the near punctuation sticks around at every tier that draws any.
  function countsForTier(tier: SkylineTier): {
    base: number;
    pitched: number;
    water: number;
    spire: number;
  } {
    const drawTotal = Math.min(total, skylineCountForTier(tier));
    let pitched = 0;
    let water = 0;
    let spire = 0;
    for (let i = 0; i < drawTotal; i += 1) {
      const c = landmarks[i].cap;
      if (c === "pitched") pitched += 1;
      else if (c === "water_tank") water += 1;
      else if (c === "spire") spire += 1;
    }
    return { base: drawTotal, pitched, water, spire };
  }

  let currentTier: SkylineTier = "high";
  {
    const c = countsForTier(currentTier);
    base.count = c.base;
    capPitched.count = c.pitched;
    capWaterTank.count = c.water;
    capSpire.count = c.spire;
    group.visible = c.base > 0;
  }

  function setTier(tier: SkylineTier): void {
    if (tier === currentTier) return;
    currentTier = tier;
    const c = countsForTier(tier);
    base.count = c.base;
    capPitched.count = c.pitched;
    capWaterTank.count = c.water;
    capSpire.count = c.spire;
    group.visible = c.base > 0;
  }

  function setEnvironment(env: THREE.Texture | null): void {
    bodyMat.envMap = env;
    bodyMat.envMapIntensity = env ? 1.0 : 0.0;
    bodyMat.needsUpdate = true;
    capMat.envMap = env;
    // Caps run a touch hotter on env intensity so the copper / slate
    // catches the dusk sky reflection cleanly.
    capMat.envMapIntensity = env ? 1.2 : 0.0;
    capMat.needsUpdate = true;
  }

  function setShadows(on: boolean): void {
    for (const m of [base, capPitched, capWaterTank, capSpire]) {
      m.castShadow = on;
    }
  }

  function setDayFrac(day: number): void {
    const e = emissiveIntensityForDay(day);
    bodyMat.emissiveIntensity = e;
    // Cap emissive rides a shade lower — a spire or a water tank
    // rarely carries lit windows; the emissive is really the copper
    // catching a warm dusk sky reflection off the cap material.
    capMat.emissiveIntensity = e * 0.55;
  }

  function dispose(): void {
    for (const m of [base, capPitched, capWaterTank, capSpire]) {
      if (m.instanceColor) m.instanceColor = null;
      group.remove(m);
    }
    baseGeo.deleteAttribute("aEmit");
    pitchedGeo.deleteAttribute("aEmit");
    waterGeo.deleteAttribute("aEmit");
    spireGeo.deleteAttribute("aEmit");
    baseGeo.dispose();
    pitchedGeo.dispose();
    waterGeo.dispose();
    spireGeo.dispose();
    bodyMat.dispose();
    capMat.dispose();
  }

  return {
    group,
    base,
    capPitched,
    capWaterTank,
    capSpire,
    landmarks,
    setTier,
    setEnvironment,
    setShadows,
    setDayFrac,
    dispose,
  };
}
