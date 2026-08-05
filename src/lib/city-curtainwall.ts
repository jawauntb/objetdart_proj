/**
 * city-curtainwall — real-world-scale mullion grid + per-pane roughness
 * and albedo variance for the event tower glass.
 *
 * The close-zoom CG tell the brief calls out is that the Gherkin /
 * Salesforce / Transamerica silhouettes read as flat plastic against a
 * uniform emissive glow — the eye clocks "one big painted decal" rather
 * than "curtain wall of many panes". This module fixes that at the
 * material layer, without disturbing the emissive canvas that owns the
 * dusk moment or the physical transmission/iridescence/clearcoat that
 * owns the sky look.
 *
 * Two things live here:
 *
 *   1. Pure ladder + hash math. `paneCoordFromWorld`, `mullionMask01`,
 *      `paneHash01`, `paneRoughness`, `paneTintDrift01` — no THREE, no
 *      DOM. Pinned by scripts/test-city-curtainwall.mjs so a refactor
 *      that widens a mullion or lifts pane roughness above architectural
 *      glass values fires before it lands.
 *
 *   2. A `MeshPhysicalMaterial.onBeforeCompile` injection that reads the
 *      pure ladder inside GLSL. World-space Y drives the horizontal
 *      story band (3.0m). Object-space (x,z) angle drives the vertical
 *      mullion column (1.5m pitch on the equator). Every pane hashes
 *      to a fresh roughness in [0.05..0.18] and a fresh tint drift on
 *      the axis from cool blue-grey to warm champagne. The mullions
 *      darken both diffuse and emissive so the lit panes read as
 *      separate windows, not a single glow behind a printed grid.
 *
 * Governor tiers:
 *
 *   high   — vertex world-position pass + full pane hash: mullions,
 *            per-pane roughness, per-pane tint drift, per-pane
 *            emissive gate.
 *   medium — mullions and emissive gate; skip the per-pane roughness
 *            and tint jitter (one extra hash per fragment is cheap but
 *            the paint-quality difference is small on mid-range GPUs).
 *   low    — do not install onBeforeCompile at all. The material keeps
 *            its current baked atlas look; nothing regresses.
 *
 * The material this module patches is exactly the one facadeMaterialFor
 * already builds for role="event" — same transmission (0.20), same
 * iridescence (0.15), same clearcoat (0.60), same base color drift by
 * seed. We do not replace the material, we teach its fragment shader
 * a curtain wall.
 *
 * Nothing here touches gestures, city.ts laws, or the emissive canvas
 * drawer. `applyCurtainWallShader` is idempotent — a second call on the
 * same material re-installs onBeforeCompile with fresh uniforms and
 * flags `needsUpdate = true`. Safe to invoke per tower rebuild.
 */

import * as THREE from "three";

// ── constants (the pure ladder) ─────────────────────────────────────────
//
// Real-world scale numbers. These are what a curtain-wall architect would
// draw on a plan: 3m per story (a standard office bay), 1.5m per pane
// (two panes per bay, mullions between), 6cm mullion aluminum profile
// (real WICONA / Schuco extrusions are 60mm..120mm wide face — 60mm is
// on the thin end, which reads correctly at expected screen sizes
// without an obvious pixelation ladder). The values are exported so the
// test file can pin them: a refactor that widens the mullion to 20cm
// would read as a warehouse door frame at close zoom.

/** Story height (m). One horizontal band of the curtain wall. */
export const STORY_HEIGHT_M = 3.0;

/** Mullion pitch on the equator (m). One vertical pane width. Tower
 *  radius varies with variant and seed; the pitch is fixed and the
 *  column count is derived per-tower so panes stay at real-world
 *  width regardless of a tower's footprint. */
export const MULLION_PITCH_M = 1.5;

/** Mullion aluminum profile face width (m). Applied on both axes. */
export const MULLION_THICKNESS_M = 0.06;

/** The per-pane roughness range. Real polished architectural glass sits
 *  in [0.05..0.18] — the lower end for the polished panes, the upper
 *  end for a pane the cleaning crew skipped this fortnight. Above 0.2
 *  the glass starts to read as satin plastic, which is exactly the CG
 *  tell we are fixing. */
export const PANE_ROUGH_MIN = 0.05;
export const PANE_ROUGH_MAX = 0.18;

/** The pane tint axis. Cool blue-grey is the sky reflection color of
 *  most SF/London curtain walls in overcast; warm champagne is the
 *  tint the sunset lifts through the west-facing panes. Every pane
 *  reads somewhere on the mix by its own hash so the tower shows a
 *  scattered, non-uniform surface. Base facade color multiplies through
 *  so this is a subtle drift, not a repaint. */
export const PANE_TINT_COOL = 0xB8CCD8;
export const PANE_TINT_WARM = 0xF0DEB6;

/** The three governor tiers. `low` skips shader injection entirely. */
export type CurtainWallTier = "high" | "medium" | "low";

/** Pane coordinate (integer row, integer column) plus per-axis fractions
 *  in [0,1). The fraction is what the mullion mask compares against. */
export type PaneCoord = {
  row: number;
  col: number;
  rowFrac: number;
  colFrac: number;
};

// ── pure math ───────────────────────────────────────────────────────────

/**
 * Convert (worldY, angleRad, colCount) → integer pane (row, col) plus
 * the per-axis fractions in [0,1). This is the JavaScript twin of the
 * GLSL block inside `curtainWallFragmentInject`; a change here must be
 * matched there. The test file pins that (row, col) is monotonic in
 * (worldY, angle) and that fractions round-trip.
 *
 * `angleRad` is the surface angle in the tower's local frame — the
 * result of `atan2(position.z, position.x)` in object space. It ranges
 * in (-π, π]; we shift to [0, 2π) internally and divide by 2π to get
 * u ∈ [0,1), which multiplies by `colCount` to reach the column index.
 *
 * `colCount` is `round(2π * equatorRadius / MULLION_PITCH_M)` at
 * material-build time. Small towers with fewer than 16 columns look
 * cartoon-blocky; large towers with more than 96 begin to read as
 * pinstripes at screen resolution. The clamp lives in
 * `columnCountForRadius`.
 */
export function paneCoordFromWorld(
  worldY: number,
  angleRad: number,
  colCount: number,
  storyM: number = STORY_HEIGHT_M,
): PaneCoord {
  const TWO_PI = Math.PI * 2;
  // Shift atan2 range from (-π, π] to [0, 2π) then normalize.
  let u = (angleRad + Math.PI) / TWO_PI;
  // A pure fmod that also handles small negatives (angleRad = -π + ε
  // gives u ≈ 0; angleRad = π gives u ≈ 1 → wrap to 0).
  u = ((u % 1) + 1) % 1;
  const rowSafeStory = Math.max(1e-4, storyM);
  const yUnits = worldY / rowSafeStory;
  const row = Math.floor(yUnits);
  const rowFrac = yUnits - row;
  const colUnits = u * Math.max(1, colCount);
  const col = Math.floor(colUnits);
  const colFrac = colUnits - col;
  return { row, col, rowFrac, colFrac };
}

/**
 * The mullion mask: 1.0 when the fragment sits inside a mullion band,
 * 0.0 when it sits inside a pane. Both axes share the profile — a
 * mullion is a mullion, whether horizontal (a spandrel) or vertical.
 *
 * The band width on each axis is `MULLION_THICKNESS_M / (pane extent
 * on that axis)`. On the vertical axis the pane extent is `pitchM` at
 * the equator (this is the same value every tower shares). On the
 * horizontal axis the pane extent is `storyM`. A thinner tower has
 * columns of the same world pitch, so the fraction stays constant.
 *
 * Pure — the GLSL block computes the same value. The test file compares
 * a random ladder of (rowFrac, colFrac) samples against a small
 * ε-tolerance to catch a sign or an inequality flip.
 */
export function mullionMask01(
  rowFrac: number,
  colFrac: number,
  storyM: number = STORY_HEIGHT_M,
  pitchM: number = MULLION_PITCH_M,
  thicknessM: number = MULLION_THICKNESS_M,
): number {
  const rowBand = thicknessM / Math.max(1e-4, storyM);
  const colBand = thicknessM / Math.max(1e-4, pitchM);
  const inRow = rowFrac < rowBand || rowFrac > 1 - rowBand;
  const inCol = colFrac < colBand || colFrac > 1 - colBand;
  return inRow || inCol ? 1 : 0;
}

/**
 * Hash a pane to a stable value in [0,1). The salt bakes in the tower's
 * per-plot seed so two towers with the same (row, col) still hash to
 * different values.
 *
 * Same idiom the emissive-canvas draw uses so the CPU-side test file
 * can pin a pane's identity without pulling the shader up.
 */
export function paneHash01(seed: number, row: number, col: number, salt: number = 3.7): number {
  const a = (seed % 4096) * 0.001 + salt;
  const b = row * 127.1 + col * 311.7;
  const v = Math.sin(a + b) * 43758.5453;
  return ((v % 1) + 1) % 1;
}

/**
 * Per-pane roughness. Hash → linear mix between PANE_ROUGH_MIN and
 * PANE_ROUGH_MAX. The tier gate lives in the caller: `high` uses this,
 * `medium` writes a constant mid-value, `low` skips the block entirely.
 */
export function paneRoughness(hash01: number, tier: CurtainWallTier): number {
  if (tier === "high") {
    return PANE_ROUGH_MIN + (PANE_ROUGH_MAX - PANE_ROUGH_MIN) * hash01;
  }
  // medium and low both fall back to the mid value so downstream ideals
  // (transmission, iridescence) still have a plausible surface.
  return (PANE_ROUGH_MIN + PANE_ROUGH_MAX) * 0.5;
}

/**
 * Per-pane tint drift on the cool↔warm axis, 0 = cool blue-grey, 1 = warm
 * champagne. Applied as a subtle multiplier through the base facade
 * color so the eye reads a scattered surface, not a repaint.
 */
export function paneTintDrift01(hash01: number, tier: CurtainWallTier): number {
  if (tier === "high") return hash01;
  return 0.5;
}

/**
 * Blend two hex colors by t ∈ [0,1] and return the hex. Pure helper the
 * pane-tint tests use to sanity-check the drift.
 */
export function mixHex(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xFF, ag = (a >> 8) & 0xFF, ab = a & 0xFF;
  const br = (b >> 16) & 0xFF, bg = (b >> 8) & 0xFF, bb = b & 0xFF;
  const rr = Math.round(ar + (br - ar) * t);
  const gg = Math.round(ag + (bg - ag) * t);
  const bbb = Math.round(ab + (bb - ab) * t);
  return (rr << 16) | (gg << 8) | bbb;
}

/**
 * The column count for a tower with a given equator radius. Rounds to
 * the nearest whole number of `MULLION_PITCH_M`-wide panes, clamped to
 * [16..96] so a tower with a tiny footprint never collapses to a
 * cartoon two-column grid and a tower with a huge footprint never
 * pinstripes at screen resolution.
 *
 * The equator radius is derived per-variant in the caller: Gherkin's
 * lathe profile peaks at r≈0.92 of local units (times sx), Salesforce
 * mean r ≈ 0.55, Transamerica cone r ≈ 0.55. For a tower whose sx is
 * 6m and Gherkin r-peak 0.92, equator radius = 5.52m, circumference
 * 34.7m, columns = round(34.7 / 1.5) = 23.
 */
export function columnCountForRadius(radiusM: number, pitchM: number = MULLION_PITCH_M): number {
  const rSafe = Math.max(0.5, radiusM);
  const circ = 2 * Math.PI * rSafe;
  const raw = Math.round(circ / Math.max(0.1, pitchM));
  if (raw < 16) return 16;
  if (raw > 96) return 96;
  return raw;
}

/**
 * The tier the shader should run at, given the scene's shadow flag and
 * an optional explicit tier. shadowsOn=true default to "high" because
 * a scene willing to pay for PCF soft shadows is willing to pay for a
 * per-pane hash; shadowsOn=false defaults to "medium" so the mullions
 * still read, but the extra hash per fragment is skipped.
 */
export function curtainWallTierFor(
  shadowsOn: boolean,
  explicit?: CurtainWallTier,
): CurtainWallTier {
  if (explicit) return explicit;
  return shadowsOn ? "high" : "medium";
}

// ── the material patch ──────────────────────────────────────────────────

/**
 * Uniforms owned by an installed curtain-wall patch. Exposed so the
 * caller can rewrite `uCwRowMax` and `uCwColCount` if a tower's per-
 * plot geometry changes (a seed regen), and so the emissive litFraction
 * follows the dayFraction curve without a re-patch.
 */
export type CurtainWallUniforms = {
  uCwStoryM: { value: number };
  uCwPitchM: { value: number };
  uCwMullionM: { value: number };
  uCwPaneRoughness: { value: THREE.Vector2 };
  uCwTintCool: { value: THREE.Color };
  uCwTintWarm: { value: THREE.Color };
  uCwSeed: { value: number };
  uCwColCount: { value: number };
  uCwMullionDarken: { value: number };
  uCwTintStrength: { value: number };
};

/** Handle returned by `applyCurtainWallShader` so the caller can update
 *  uniforms and inspect the compiled tier without re-patching. */
export type CurtainWallHandle = {
  material: THREE.MeshPhysicalMaterial;
  uniforms: CurtainWallUniforms;
  tier: CurtainWallTier;
  /** Update the per-tower column count and re-mark needsUpdate. */
  setColumnCount(n: number): void;
  /** Update the per-pane tint strength (0..1). */
  setTintStrength(v: number): void;
};

/**
 * Install the curtain-wall shader injection onto an event-tower
 * MeshPhysicalMaterial. Idempotent — calling twice re-installs with the
 * newer uniforms.
 *
 * At tier="low" this returns a handle whose uniforms exist but whose
 * onBeforeCompile is a no-op — the material is left alone. This keeps
 * the caller's code path uniform: it always gets back a handle it can
 * later flip up to "medium" or "high" without a rebuild.
 *
 * `equatorRadiusM` is the tower's equator radius in world meters. The
 * caller computes it per-tower from the variant profile × the plot's
 * footprint (sx). See `columnCountForRadius`.
 */
export function applyCurtainWallShader(
  material: THREE.MeshPhysicalMaterial,
  params: {
    seed: number;
    tier: CurtainWallTier;
    equatorRadiusM: number;
  },
): CurtainWallHandle {
  const { seed, tier, equatorRadiusM } = params;

  const colCount = columnCountForRadius(equatorRadiusM);
  const uniforms: CurtainWallUniforms = {
    uCwStoryM: { value: STORY_HEIGHT_M },
    uCwPitchM: { value: MULLION_PITCH_M },
    uCwMullionM: { value: MULLION_THICKNESS_M },
    uCwPaneRoughness: { value: new THREE.Vector2(PANE_ROUGH_MIN, PANE_ROUGH_MAX) },
    uCwTintCool: { value: new THREE.Color(PANE_TINT_COOL) },
    uCwTintWarm: { value: new THREE.Color(PANE_TINT_WARM) },
    uCwSeed: { value: seed },
    uCwColCount: { value: colCount },
    // Mullion lines darken diffuse and emissive by this factor. 0.32
    // keeps the aluminum reading as a mid-grey rather than jet black
    // — a real anodized mullion under the sky IS quite bright at
    // grazing angles.
    uCwMullionDarken: { value: 0.32 },
    // Pane tint strength: 0 = base color untouched, 1 = full pane tint.
    // 0.22 lets the drift show without repainting the tower.
    uCwTintStrength: { value: 0.22 },
  };

  const handle: CurtainWallHandle = {
    material,
    uniforms,
    tier,
    setColumnCount(n: number) {
      uniforms.uCwColCount.value = Math.max(4, Math.round(n));
      material.needsUpdate = true;
    },
    setTintStrength(v: number) {
      uniforms.uCwTintStrength.value = Math.max(0, Math.min(1, v));
    },
  };

  if (tier === "low") {
    // Explicit no-op path: no onBeforeCompile install, no shader edit.
    // The caller still gets a handle; a later tier bump can re-invoke
    // applyCurtainWallShader with tier="high" and the material will
    // recompile then.
    return handle;
  }

  const vertexBlock = curtainWallVertexInject();
  const fragCommon = curtainWallFragmentCommonInject();
  const fragMap = curtainWallFragmentMapInject(tier);
  const fragRough = tier === "high" ? curtainWallFragmentRoughnessInject() : "";
  const fragEmiss = curtainWallFragmentEmissiveInject();

  material.onBeforeCompile = (shader) => {
    // Attach uniforms.
    Object.assign(shader.uniforms, uniforms);

    // Vertex shader: capture world position and object-space position
    // as varyings the fragment shader can read.
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\n${vertexBlock.commonHeader}`,
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>\n${vertexBlock.afterProject}`,
      );

    // Fragment shader: declare uniforms + varyings; patch the pane
    // sample into the color and roughness chunks; darken the emissive
    // along mullion lines so lit panes read as separate windows.
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\n${fragCommon}`,
      )
      // The map fragment carries the diffuse color sample. Injecting
      // AFTER it means our tint drift multiplies the already-lit
      // color, not the raw color texture. Same slot the ground uses.
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>\n${fragMap}`,
      )
      // Roughness override — high tier only. Sits after the
      // roughnessmap_fragment so it overwrites the sample, not the
      // material's base roughness value (which is what the medium
      // path relies on).
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>\n${fragRough}`,
      )
      // Emissive gate — darken along mullion lines so panes look like
      // separate windows even at close zoom. The canvas provides
      // per-pane on/off; the mullion mask provides between-pane dark.
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>\n${fragEmiss}`,
      );
  };

  material.needsUpdate = true;
  return handle;
}

/**
 * The vertex-shader injection: capture world position and object-space
 * position as two varyings the fragment reads. Object-space (x,z) gives
 * the tower-local surface angle without needing to know the group's
 * yaw or position; world Y gives the story index directly.
 */
export function curtainWallVertexInject(): { commonHeader: string; afterProject: string } {
  return {
    commonHeader: `
    varying vec3 vCwWorldPos;
    varying vec3 vCwLocalPos;
    `,
    afterProject: `
    // Recompute world position explicitly — modelMatrix is available
    // in the vertex stage even when the worldpos_vertex chunk hasn't
    // been included. Object-space position is the raw attribute
    // before any morph/skin transforms; sufficient here because
    // event towers don't skin.
    vec4 __cwWp = modelMatrix * vec4( transformed, 1.0 );
    vCwWorldPos = __cwWp.xyz;
    vCwLocalPos = position;
    `,
  };
}

/**
 * Fragment-shader common-block injection: declare uniforms, varyings,
 * and the hash function shared by all three inject points below.
 */
export function curtainWallFragmentCommonInject(): string {
  return `
  uniform float uCwStoryM;
  uniform float uCwPitchM;
  uniform float uCwMullionM;
  uniform vec2  uCwPaneRoughness;
  uniform vec3  uCwTintCool;
  uniform vec3  uCwTintWarm;
  uniform float uCwSeed;
  uniform float uCwColCount;
  uniform float uCwMullionDarken;
  uniform float uCwTintStrength;
  varying vec3  vCwWorldPos;
  varying vec3  vCwLocalPos;

  float cwHash( float row, float col, float salt ) {
    float a = mod( uCwSeed, 4096.0 ) * 0.001 + salt;
    float b = row * 127.1 + col * 311.7;
    return fract( sin( a + b ) * 43758.5453 );
  }

  // Compute (row, col, rowFrac, colFrac) from vCwWorldPos.y and the
  // object-space (x,z) angle. Called from every fragment inject below.
  void cwPane( out float row, out float col, out float rowFrac, out float colFrac ) {
    float angle = atan( vCwLocalPos.z, vCwLocalPos.x );
    float u = ( angle + 3.14159265358979 ) / 6.28318530717959;
    u = fract( u + 1.0 );
    float storySafe = max( 1e-4, uCwStoryM );
    float yUnits = vCwWorldPos.y / storySafe;
    row = floor( yUnits );
    rowFrac = yUnits - row;
    float colUnits = u * max( 1.0, uCwColCount );
    col = floor( colUnits );
    colFrac = colUnits - col;
  }

  float cwMullionMask( float rowFrac, float colFrac ) {
    float storySafe = max( 1e-4, uCwStoryM );
    float pitchSafe = max( 1e-4, uCwPitchM );
    float rowBand = uCwMullionM / storySafe;
    float colBand = uCwMullionM / pitchSafe;
    float inRow = step( rowFrac, rowBand ) + step( 1.0 - rowBand, rowFrac );
    float inCol = step( colFrac, colBand ) + step( 1.0 - colBand, colFrac );
    return clamp( inRow + inCol, 0.0, 1.0 );
  }
  `;
}

/**
 * Fragment-shader diffuse injection: pane tint drift + mullion darkening
 * on the diffuse color. Runs at all non-low tiers. `medium` skips the
 * tint drift so panes stay one uniform base color (mullions only).
 */
export function curtainWallFragmentMapInject(tier: CurtainWallTier): string {
  if (tier === "low") return "";
  const tintBlock = tier === "high" ? `
    float paneH = cwHash( row, col, 3.7 );
    vec3 paneTint = mix( uCwTintCool, uCwTintWarm, paneH );
    // Normalize the tint so mixing does not shift overall luminance
    // heavily. Divide by the axis midpoint (0.75 approximates the
    // luminance of both endpoints) then mix in by uCwTintStrength.
    vec3 tintMul = mix( vec3( 1.0 ), paneTint / vec3( 0.75 ), uCwTintStrength );
    diffuseColor.rgb *= tintMul;
  ` : "";
  return `
  {
    float row, col, rowFrac, colFrac;
    cwPane( row, col, rowFrac, colFrac );
    ${tintBlock}
    float mullion = cwMullionMask( rowFrac, colFrac );
    diffuseColor.rgb *= mix( 1.0, uCwMullionDarken, mullion );
  }
  `;
}

/**
 * Fragment-shader roughness injection: per-pane roughness drift in
 * [PANE_ROUGH_MIN..PANE_ROUGH_MAX]. High tier only.
 */
export function curtainWallFragmentRoughnessInject(): string {
  return `
  {
    float rrow, rcol, rrowFrac, rcolFrac;
    cwPane( rrow, rcol, rrowFrac, rcolFrac );
    float paneR = cwHash( rrow, rcol, 11.3 );
    float paneRough = mix( uCwPaneRoughness.x, uCwPaneRoughness.y, paneR );
    roughnessFactor = paneRough;
  }
  `;
}

/**
 * Fragment-shader emissive injection: darken along mullion lines. The
 * per-pane on/off gate is already carried by the emissive canvas the
 * material's emissiveMap points at; this block prevents the lit-pane
 * glow from bleeding across the mullion between two adjacent panes.
 */
export function curtainWallFragmentEmissiveInject(): string {
  return `
  {
    float erow, ecol, erowFrac, ecolFrac;
    cwPane( erow, ecol, erowFrac, ecolFrac );
    float emullion = cwMullionMask( erowFrac, ecolFrac );
    totalEmissiveRadiance *= mix( 1.0, uCwMullionDarken, emullion );
  }
  `;
}

// ── convenience: full material builder ──────────────────────────────────

/**
 * Convenience for callers that want to build a curtain-wall material
 * from scratch, without threading through facadeMaterialFor first. Not
 * used by the /city runtime (which reuses the existing event material
 * from facadeMaterialFor for consistency); provided for standalone
 * demos and future compositions.
 */
export function makeCurtainWallMaterial(params: {
  seed: number;
  tier: CurtainWallTier;
  equatorRadiusM: number;
  baseColor?: number;
}): { material: THREE.MeshPhysicalMaterial; handle: CurtainWallHandle } {
  const material = new THREE.MeshPhysicalMaterial({
    color: params.baseColor ?? PANE_TINT_COOL,
    roughness: 0.10,
    metalness: 0.00,
    transmission: 0.20,
    thickness: 0.35,
    ior: 1.45,
    iridescence: 0.15,
    iridescenceIOR: 1.30,
    clearcoat: 0.60,
    clearcoatRoughness: 0.10,
  });
  material.name = "cityCurtainWall.event";
  const handle = applyCurtainWallShader(material, {
    seed: params.seed,
    tier: params.tier,
    equatorRadiusM: params.equatorRadiusM,
  });
  return { material, handle };
}

// ── per-variant equator radius ──────────────────────────────────────────
//
// Each event variant has a different peak radius in its unit-height
// local frame. `city-towers.ts` defines the profiles; the numbers here
// are the peaks in the SAME local units. Multiply by the plot's
// footprint `sx` to reach world meters.
//
//   Gherkin       — LatheGeometry, the profile peaks at r ≈ 0.92 near
//                    y ≈ 0.5.
//   Salesforce    — CylinderGeometry stack, rBottom of the widest step
//                    is 0.62.
//   Transamerica  — ConeGeometry base radius is 0.55.
//
// These are exported so the caller can compute a real column count
// without importing every profile constant from city-towers.

export const VARIANT_EQUATOR_RADIUS_LOCAL = {
  gherkin: 0.92,
  salesforce: 0.62,
  transamerica: 0.55,
} as const;

/**
 * Look up the equator radius for a variant enum. Variants are 0=Gherkin,
 * 1=Salesforce, 2=Transamerica (see city-geometry-pure.ts).
 */
export function equatorRadiusForVariant(variant: 0 | 1 | 2): number {
  if (variant === 0) return VARIANT_EQUATOR_RADIUS_LOCAL.gherkin;
  if (variant === 1) return VARIANT_EQUATOR_RADIUS_LOCAL.salesforce;
  return VARIANT_EQUATOR_RADIUS_LOCAL.transamerica;
}
