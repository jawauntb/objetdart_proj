// object-compiler template — docs/plans/object-compiler.md M3.
// Filled by phase-6 track A (see data/object-compiler/audits/phase-6-marsh.md
// for the audit) — shader, domain imports, population layer, verbs, pins.
"use client";

/**
 * /marsh — the marsh — reed, biofilm, oxygen. See docs/plans/object-compiler.md
 * §"Three creative slots" for what belongs in each slot.
 *
 * The invariant is a continuous oxygen field on a coarse grid, with reeds
 * producing and biofilm mats consuming (src/lib/marshfield.ts). Two shaders
 * paint it: the background field (FRAG) is a fixed shallow waterline — a
 * hazy sky above it, a muddy FBM floor below with the oxygen field cross-
 * faded straight over it (warm/bright where oxygenated, cool/dark where
 * stagnant) and a Snell-like surface highlight — and the population layer
 * (MARSH_POPULATION_FRAG, same custom-frag pattern as /tidepool and /reef)
 * draws reeds as vertical ribbon SDFs, rooted and swaying from their base
 * under turbulence + wind, and biofilm mats as horizontal value-noise-FBM
 * patches, in one shared instanced pass. Every ripple is a lens over the
 * same field.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { getTurbulence, relaxTurbulence, stirTurbulence } from "@/lib/turbulence";
import RoomShell from "@/components/RoomShell";
import type { RoomVoice } from "@/lib/gesture/defaults";
import { tapTrainTier, tapTrainDepth } from "@/lib/gesture/core";
import { createGLStage, FULLSCREEN_VERT_UNIT } from "@/lib/webgl/stage";
import { clocksFrom } from "@/lib/webgl/sizing";
import {
  onVisibility,
  onGalleryPause,
  createIdleWriter,
  createFrameGovernor,
  isEmbeddedFrame,
} from "@/lib/room-runtime";
import { createInstanceBuffer } from "@/lib/scene/instances";
import { createPopulationLayer } from "@/lib/scene/population-layer";
import {
  createPopulation,
  mulberry32 as sceneMulberry32,
  type SceneObjectSpec,
  type SceneObjectState,
} from "@/lib/scene/object";
import {
  MAX_REEDS,
  MAX_MATS,
  MAX_HEIGHT,
  GRID_W,
  GRID_H,
  GRID_SIZE,
  POOL_X_MAX,
  POOL_X_MIN,
  POOL_Y_MAX,
  POOL_Y_MIN,
  advanceExact,
  deepenReed,
  flushMarsh,
  hashSeed,
  inMarshBounds,
  initState,
  meanOxygen,
  matTotalMass,
  nearestReed,
  oxygenAt,
  oxygenForRingHz,
  plantMat,
  plantReed,
  pulseOxygen,
  ringHzFor,
  sealReed,
  sealedCount,
  stirOxygen,
  totalReedHeight,
  type Climate,
  type Reed,
  type BiofilmMat,
  type MarshState,
} from "@/lib/marshfield";

/** Persistence key — versioned. */
const STORE_KEY = "objetdart:marsh:v1";
/** How often the idle writer flushes to storage while a hand is present. */
const SAVE_EVERY_MS = 4000;
/** How wide the shader's ripple wavefront pool is. */
const MAX_RIPPLES = 24;
/** How much a full-tier dwell adds to a reed's height on a saturating curve. */
const HEIGHT_STEP_MAX = 0.55;
/**
 * Time-constant of the reed's height under a sustained press:
 * `h(t) = HEIGHT_STEP_MAX · (1 − e^{-t/τ})`. MATERIAL time-constant —
 * how fast the reed responds to the palm's presence — not a gesture tier.
 */
const REED_GROW_TAU_MS = 900;
/** Simulation speed while a hand is present, in ledger seconds per real second. */
const WATCHED_SPEED = 60;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);

/**
 * Shape-select encoding for the population fragment shader — `vPhase`'s
 * integer part picks the silhouette (0 = reed ribbon, 1 = biofilm mat), the
 * fractional part carries the sprite's own breath phase. Mirrors the
 * convention set in /tidepool and /reef.
 */
const shapeSlot = (shape: number, phase01: number) => shape + Math.min(0.999, Math.max(0, phase01));

type ReedView = SceneObjectState & {
  heightVal: number;
  sealed: boolean;
  phase: number;
  /** sway, 0..1 (0.5 = upright) — updated every step from turbulence + wind, read-only in emit. */
  tiltNorm: number;
};

type MatView = SceneObjectState & {
  massVal: number;
  phase: number;
};

type StoredMarsh = {
  v: 1;
  reeds: MarshState["reeds"];
  mats: MarshState["mats"];
  oxygen: number[];
  sunlight: number;
  tau: number;
  climate: Climate;
  lastSeen: number;
  cleared?: boolean;
};

/**
 * The population-layer fragment shader, room-specialized for the marsh's
 * two populations. The shared SPRITE_VERT (in `@/lib/scene/population-layer`)
 * declares five varyings — `vLocal` (the sprite-local -1.9..1.9 quad
 * coordinate, unrotated), `vHue`, `vGlow`, `vPhase`, `vAlpha` — plus the
 * three palette uniforms `u_palA` (ACCENT — cool reed green), `u_palB`
 * (ACCENT2 — warm biofilm), `u_palC` (GLOW — bright water/sunlit reed
 * tip). We hijack `vPhase`'s integer part as a shape selector (0 = reed
 * ribbon, 1 = biofilm mat); the fractional part carries the sprite's own
 * breath phase. `vGlow` carries a creature-specific parameter: the reed's
 * tilt (0.5 = upright, written every step from turbulence + wind so a
 * rooted stalk sways from its base) or the mat's mass-linked brightness.
 * This lets each population draw its real silhouette in one shared
 * instanced pass instead of a generic SDF disc — the defect this room's
 * audit named directly.
 */
const MARSH_POPULATION_FRAG = `precision mediump float;
varying vec2 vLocal;
varying float vHue;
varying float vGlow;
varying float vPhase;
varying float vAlpha;
uniform vec3 u_palA;
uniform vec3 u_palB;
uniform vec3 u_palC;

vec3 marshPalette(float h) {
  h = clamp(h, 0.0, 1.0);
  return h < 0.5 ? mix(u_palA, u_palB, h * 2.0) : mix(u_palB, u_palC, (h - 0.5) * 2.0);
}

float hash21p(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoisep(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash21p(i);
  float b = hash21p(i + vec2(1.0, 0.0));
  float c = hash21p(i + vec2(0.0, 1.0));
  float d = hash21p(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
float fbmp(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * vnoisep(p); p *= 2.13; a *= 0.55; }
  return v;
}

// Reed — a vertical ribbon rooted at the sprite's bottom (vLocal.y = +K),
// tip at the top (vLocal.y = -K). bendNorm (0..1, 0.5 upright) displaces
// the ribbon sideways more near the tip than the base, so a rooted stalk
// sways FROM its base instead of rotating rigidly around the sprite.
float sdfReed(vec2 p, float bendNorm, float breathPulse) {
  float bend = (bendNorm - 0.5) * 2.0;
  float alongReed = clamp((1.65 - p.y) / 3.1, 0.0, 1.0);
  float tipStrength = alongReed * alongReed;
  float sway = sin(breathPulse * 6.2832 * 1.3) * 0.05;
  float dispX = p.x - (bend * 0.9 + sway) * tipStrength;
  float widthAtY = mix(0.30, 0.075, tipStrength);
  float ribbon = 1.0 - smoothstep(widthAtY * 0.55, widthAtY * 1.15, abs(dispX));
  float verticalMask = smoothstep(1.72, 1.42, abs(p.y));
  float midrib = 1.0 - smoothstep(widthAtY * 0.18, widthAtY * 0.03, abs(dispX)) * 0.30;
  return clamp(ribbon * verticalMask * midrib, 0.0, 1.0);
}

// Biofilm mat — a horizontal, irregular patch flattened onto the floor.
// Both the edge and the interior grain are value-noise FBM seeded by the
// mat's own phase, so every mat reads as a distinct organism, not a
// stamped decal, and its footprint is the biofilm density field itself.
float sdfMat(vec2 p, float phase, float breathPulse) {
  vec2 pp = vec2(p.x, p.y * 2.35);
  float r = length(pp);
  float edgeWobble = fbmp(p * 1.4 + phase * 9.0 + breathPulse * 0.3);
  float edge = 1.0 + (edgeWobble - 0.5) * 0.55;
  float body = smoothstep(1.05 * edge, 0.30 * edge, r);
  float grain = fbmp(p * 3.4 + phase * 13.0);
  return clamp(body * (0.5 + grain * 0.65), 0.0, 1.0);
}

void main() {
  float shapeF = floor(vPhase + 0.001);
  float subPhase = fract(vPhase);
  float breathPulse = 0.5 + 0.5 * sin(subPhase * 6.2832);
  vec3 c;
  float a = 0.0;
  if (shapeF < 0.5) {
    // reed — green body (u_palA), bright sunlit tip (u_palC).
    float bendNorm = clamp(vGlow, 0.0, 1.0);
    a = sdfReed(vLocal, bendNorm, breathPulse);
    float tipMix = clamp(1.0 - length(vLocal - vec2(0.0, -1.55)) / 2.35, 0.0, 1.0);
    tipMix = pow(tipMix, 1.6);
    vec3 body = marshPalette(vHue);
    c = mix(body, u_palC, tipMix * 0.62);
    c += u_palC * pow(tipMix, 3.0) * 0.45 * (0.6 + breathPulse * 0.4);
    c *= 0.82 + 0.22 * breathPulse;
  } else {
    // biofilm mat — warm patch (u_palB), breathing +/-20% per the manifest.
    a = sdfMat(vLocal, subPhase, breathPulse);
    c = u_palB * (0.65 + 0.55 * breathPulse) * (0.75 + 0.35 * clamp(vGlow, 0.0, 1.0));
  }
  a *= vAlpha;
  if (a <= 0.003) discard;
  gl_FragColor = vec4(c * a, a);
}
`;

const FRAG = `
precision highp float;

uniform vec2  uRes;
uniform float uTime;
uniform float uBreath;
uniform float uTurbulence;
uniform float uReduced;

varying vec2 vUv;

// __SLOT_SHADER_BODY__
uniform vec4  uReeds[${MAX_REEDS}];    // xy pos, z height (0..1), w phase
uniform vec4  uReedsB[${MAX_REEDS}];   // sealed(0/1), local oxygen (0..1), reserved, reserved
uniform vec4  uMats[${MAX_MATS}];      // xy pos, z mass (0..1), w phase
uniform vec4  uRipples[${MAX_RIPPLES}]; // xy pos, z age (s), w intensity (0..1)
uniform int   uReedCount;
uniform int   uMatCount;
uniform int   uRippleCount;
uniform vec4  uClimate;   // warmth, wet, mean-oxygen, sunlight
uniform float uLean;
uniform float uNight;
uniform float uStir;
uniform float uLens;

// The palette — six registers set once from the manifest. bg = dark
// wetland base; bg2 = warm mud/silt, distinct from bg; glow = bright
// water surface + sunlit reed tips (load-bearing: high oxygen reads this);
// accent = cool water / oxygen-poor register (also the reed body — a
// stagnant tile and a green stalk share the same cool family); accent2 =
// warm biofilm bloom, exclusive to the mats; ink = readable text.
const vec3 BG      = vec3(0.039, 0.102, 0.082); // #0a1a15 dark wetland base
const vec3 BG2     = vec3(0.227, 0.157, 0.094); // #3a2818 warm mud/silt
const vec3 GLOW    = vec3(0.910, 0.863, 0.604); // #e8dc9a bright water / sunlit reed tips
const vec3 ACCENT  = vec3(0.290, 0.478, 0.541); // #4a7a8a cool water / oxygen-poor
const vec3 ACCENT2 = vec3(0.784, 0.580, 0.353); // #c8945a warm biofilm bloom
const vec3 INK     = vec3(0.910, 0.933, 0.878); // #e8eee0
const vec3 SKY      = vec3(0.62, 0.70, 0.55);   // hazy marsh sky, warm-green cast
const vec3 SKY_HIGH = vec3(0.10, 0.16, 0.14);   // deep humid upper sky, cooler

const float POOL_YMIN = ${POOL_Y_MIN.toFixed(3)};
const float POOL_YMAX = ${POOL_Y_MAX.toFixed(3)};
const float POOL_XMIN = ${POOL_X_MIN.toFixed(3)};
const float POOL_XMAX = ${POOL_X_MAX.toFixed(3)};

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.11; a *= 0.53; }
  return v;
}

// Approximate oxygen field at (x, y) from reed and mat contributions.
// The exact JS ledger owns the O grid; the shader paints a proxy so the eye
// reads the field even without dynamic-indexed uniform arrays (which GLSL
// ES 1.0 does not portably support). Higher-fidelity visualisation would
// use a texture upload; the proxy is truthful enough for the room's look.
float approxOxygen(vec2 uv, float aspect) {
  // Base level is the mean oxygen (from uClimate.z).
  float O = uClimate.z;
  // Reeds ADD oxygen locally scaled by height and sunlight.
  for (int i = 0; i < ${MAX_REEDS}; i++) {
    if (i >= uReedCount) break;
    vec4 r = uReeds[i];
    vec2 dp = (uv - r.xy) * vec2(aspect, 1.0);
    float d2 = dot(dp, dp);
    O += 0.35 * r.z * exp(-d2 * 60.0) * uClimate.w;
  }
  // Mats SUBTRACT oxygen locally scaled by mass.
  for (int i = 0; i < ${MAX_MATS}; i++) {
    if (i >= uMatCount) break;
    vec4 m = uMats[i];
    vec2 dp = (uv - m.xy) * vec2(aspect, 1.0);
    float d2 = dot(dp, dp);
    O -= 0.30 * m.z * exp(-d2 * 40.0);
  }
  return clamp(O, 0.0, 1.0);
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  float aspect = uRes.x / max(1.0, uRes.y);
  float night = uNight;
  vec3 col;

  // layer: waterline_and_chop — a fixed shallow-marsh surface line near
  // the top of the frame. Turbulence and the scrub gesture add real chop
  // on top of a slow breathing wavelet, so the surface — not the sky — is
  // what visibly moves from second to second. Reads uTurbulence, uStir,
  // uBreath.
  float chop = uTurbulence * (sin(uv.x * 46.0 + uTime * 3.2) * 0.012
                              + sin(uv.x * 83.0 - uTime * 2.1) * 0.007)
             + uStir * sin(uv.x * 30.0 + uTime * 5.0) * 0.010;
  float wavelet = sin(uv.x * 14.0 + uTime * 0.6) * 0.004;
  float waterlineY = POOL_YMIN + wavelet + chop;

  if (uv.y < waterlineY) {
    // layer: sky — bright, hazy glow above the waterline. The whole
    // reason a hand looking across the marsh sees anything but water.
    // Reads uBreath, uClimate.x (warmth tints the haze), uNight, uLean.
    float above = clamp((waterlineY - uv.y) / max(1e-3, waterlineY), 0.0, 1.0);
    vec3 horizonTone = mix(GLOW, mix(SKY, GLOW, 0.4), 0.6);
    vec3 airTone = mix(horizonTone, SKY_HIGH, pow(above, 1.1));
    float horizonBand = exp(-pow((waterlineY - uv.y) * 16.0, 2.0));
    airTone += GLOW * horizonBand * (0.5 + 0.18 * uBreath) * (0.6 + uClimate.x * 0.4);
    float haze = fbm(vec2(uv.x * 4.0 * aspect + uTime * 0.015, uv.y * 20.0));
    haze = smoothstep(0.5, 0.85, haze);
    airTone = mix(airTone, mix(airTone, SKY, 0.5), haze * (1.0 - above * 0.4));
    airTone *= 0.88 + 0.12 * uBreath;
    airTone *= 1.0 - night * 0.75;
    airTone *= 1.0 - 0.10 * abs(uLean);
    col = airTone;
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  // Underwater — a shallow body standing over a muddy floor. The floor
  // shows through everywhere (this is a marsh, not a deep pool); the
  // oxygen field tints it, and the surface catches a Snell-like highlight.
  float depthBelow = clamp((uv.y - waterlineY) / max(0.05, 1.0 - waterlineY), 0.0, 1.0);

  // layer: water_surface — a Snell-like grazing highlight right at the
  // waterline, and a refracted horizontal wobble so the mud beneath
  // shimmers instead of sitting still under glass.
  float refractAmp = (1.0 - depthBelow * 0.7) * 0.012;
  float refractDx = sin((uv.y - waterlineY) * 40.0 + uTime * 0.85) * refractAmp
                   + sin((uv.y - waterlineY) * 97.0 - uTime * 1.3) * refractAmp * 0.4;
  vec2 uvR = vec2(uv.x + refractDx, uv.y);

  // layer: muddy_floor — warm brown mud (BG2), layered FBM grain (coarse
  // silt structure + fine speckle) so the floor reads as ground, sampled
  // through the refracted coordinate so the shimmer actually distorts it.
  float coarse = fbm(uvR * vec2(9.0 * aspect, 8.0));
  float fine = fbm(uvR * vec2(46.0 * aspect, 40.0) + vec2(1.7, 2.9));
  float grain = hash21(floor(uv * uRes * 0.35));
  vec3 mud = mix(BG2 * 0.55, BG2 * 1.20, coarse);
  mud = mix(mud, mud * (0.7 + grain * 0.6), 0.30);
  mud += BG2 * fine * 0.18;
  mud = mix(mud, BG, depthBelow * 0.45);
  col = mud;

  // layer: oxygen_visualisation — the load-bearing invariant map, painted
  // straight over the floor: a high-O tile reads warmer/brighter (GLOW),
  // a stagnant one cooler/darker (ACCENT). approxOxygen reads the reed
  // and mat positions the JS ledger owns, so the shader's painted field
  // and the ledger's real one never disagree in sign.
  float O = approxOxygen(uvR, aspect);
  vec3 oxTint = mix(ACCENT, GLOW, O);
  col = mix(col, oxTint, 0.44 * (0.82 + 0.18 * uBreath));
  col *= mix(0.70, 1.0, O);

  // Surface highlight, layered after the floor/oxygen tint so it reads as
  // light sitting on TOP of the water rather than mixed into the mud.
  float surfBand = exp(-pow((uv.y - waterlineY) * 60.0, 2.0));
  col += mix(GLOW, ACCENT, 0.12) * surfBand * 0.55 * (0.82 + 0.18 * uBreath);
  float underGlow = exp(-pow((uv.y - waterlineY - 0.02) * 26.0, 2.0));
  col += GLOW * underGlow * 0.16;

  // ——— ripple wavefronts (taps and flicks) ———
  float rippleWave = 0.0;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    if (i >= uRippleCount) break;
    vec4 r = uRipples[i];
    float age = r.z;
    float rad = age * 0.30;
    vec2 dp = (uv - r.xy) * vec2(aspect, 1.0);
    float dist = length(dp);
    float ring = exp(-pow((dist - rad) * 24.0, 2.0));
    rippleWave += ring * r.w * exp(-age * 1.4);
  }
  col += GLOW * rippleWave * 0.55;

  // ——— stir: the water surface agitates under a scrubbing finger ———
  if (uStir > 0.02) {
    vec2 sp = (uv - vec2(0.5, waterlineY + 0.1)) * vec2(aspect, 1.0);
    float ang = atan(sp.y, sp.x);
    float rr = length(sp);
    col += ACCENT * uStir * 0.22 * sin(ang * 4.0 + uTime * 3.0) * exp(-rr * rr * 8.0);
  }

  // ——— vignette + night ———
  vec2 vd = (uv - vec2(0.5, 0.5)) * vec2(aspect, 1.0);
  col *= 1.0 - 0.42 * smoothstep(0.18, 0.94, dot(vd, vd));
  col *= 1.0 - night * 0.62;
  col *= 1.0 - 0.06 * abs(uLean) * (1.0 - depthBelow);

  gl_FragColor = vec4(col, 1.0);
}
`;

// The imperative surface the room's voice speaks to.
type MarshApi = {
  tap: (x: number, y: number, intensity: number, count: number, fingers: number) => void;
  stepBack: () => void;
  tutti: (intensity: number) => void;
  plant: (x: number, y: number) => void;
  deepen: (elapsed: number, x: number, y: number, tier: number) => void;
  ceremony: (x: number, y: number) => void;
  settle: (elapsed: number, x: number, y: number, tier: number) => void;
  timeScale: (k: number) => void;
  drag: (
    phase: "start" | "move" | "end",
    x: number, y: number, dx: number, dy: number, fingers: number,
  ) => void;
  wind: (dx: number, dy: number) => void;
  flick: (x: number, y: number, angle: number, speed: number, fingers: number) => void;
  stir: (cx: number, cy: number, angularVelocity: number) => void;
  lens: (angle: number, velocity: number) => void;
  season: (angle: number, velocity: number) => void;
  drum: (hits: number, alternation: number, x: number, y: number) => void;
  scatter: (intensity: number) => void;
  gravity: (gamma: number) => void;
  knock: (intensity: number) => void;
  night: (faceDown: boolean) => void;
  glimmer: () => void;
  reduced: (on: boolean) => void;
  moveCursor: (dx: number, dy: number) => void;
  keyTap: () => void;
  keyHold: (elapsed: number) => void;
  keyEscape: () => void;
  clear: () => void;
};

export default function Marsh() {
  const surfaceRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const apiRef = useRef<MarshApi | null>(null);
  const [hasKept, setHasKept] = useState(false);

  useEffect(() => {
    const surface = surfaceRef.current;
    const overlay = overlayRef.current;
    if (!surface || !overlay) return;

    const audio = getFieldAudio();
    let reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const embedded = isEmbeddedFrame();
    const gov = createFrameGovernor(embedded ? "medium" : "high");

    const SEED = 0x9a11;
    let state: MarshState = initState(SEED);
    let climate: Climate = { warmth: 0.55, wet: 0.5 };
    let cleared = false;
    let lastSeen = performance.now();
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<StoredMarsh>;
        cleared = parsed.cleared === true;
        if (
          Array.isArray(parsed.reeds) &&
          Array.isArray(parsed.oxygen) &&
          parsed.oxygen.length === GRID_SIZE &&
          typeof parsed.sunlight === "number" &&
          typeof parsed.tau === "number"
        ) {
          state = {
            reeds: parsed.reeds
              .filter(
                (r) =>
                  r &&
                  Number.isFinite(r.x) &&
                  Number.isFinite(r.y) &&
                  Number.isFinite(r.height),
              )
              .slice(0, MAX_REEDS),
            mats: (parsed.mats ?? [])
              .filter((m) => m && Number.isFinite(m.x) && Number.isFinite(m.y))
              .slice(0, MAX_MATS),
            oxygen: new Float32Array(parsed.oxygen),
            sunlight: clamp01(parsed.sunlight),
            tau: parsed.tau,
            seedKey: SEED,
          };
        }
        if (parsed.climate) {
          climate = {
            warmth: clamp01(parsed.climate.warmth),
            wet: clamp01(parsed.climate.wet),
          };
        }
        if (typeof parsed.lastSeen === "number" && Number.isFinite(parsed.lastSeen)) {
          const awaySec = Math.max(0, (Date.now() - parsed.lastSeen) / 1000);
          if (awaySec > 0) state = advanceExact(state, awaySec, climate);
        }
      }
    } catch {
      /* fresh marsh */
    }
    setHasKept(state.reeds.some((r) => r.sealed));
    lastSeen = performance.now();

    let hidden = document.hidden;
    let galleryPaused = false;
    let asleep = false;
    let last = performance.now();
    let raf = 0;
    let running = true;

    const syncSleep = () => {
      asleep = hidden || galleryPaused;
      if (asleep) gov.force("sleep");
    };
    const unvis = onVisibility((h) => {
      hidden = h;
      syncSleep();
    });
    const ungal = onGalleryPause((p) => {
      galleryPaused = p;
      syncSleep();
    });

    const writer = createIdleWriter(() => {
      try {
        const payload: StoredMarsh = {
          v: 1,
          reeds: state.reeds,
          mats: state.mats,
          oxygen: Array.from(state.oxygen),
          sunlight: state.sunlight,
          tau: state.tau,
          climate,
          lastSeen: Date.now(),
          cleared,
        };
        window.localStorage.setItem(STORE_KEY, JSON.stringify(payload));
      } catch {
        /* storage full or unavailable */
      }
    });
    writer.schedule();

    const stage = createGLStage(surface, {
      label: "marsh",
      wrap: surface.parentElement,
      overlay,
      renderScale: embedded ? 0.42 : 0.6,
      quality: embedded ? "medium" : "high",
      reducedMotion: reduced,
      embedded,
    });
    const prog = stage?.program(FULLSCREEN_VERT_UNIT, FRAG) ?? null;
    const quad = stage && prog ? stage.fullscreenQuad(prog, "unit") : null;

    /** How tall a fully-grown, fully-charged reed reaches, as a fraction of frame height. */
    const REED_MAX_HEIGHT_NY = 0.34;

    const reedSpec: SceneObjectSpec<ReedView> = {
      kind: "reed",
      cap: MAX_REEDS,
      born(seed, nx, ny, tMs) {
        const rng = sceneMulberry32(seed);
        return {
          id: 0,
          seed,
          nx,
          ny,
          bornMs: tMs,
          growth: 0.05,
          sealedMs: null,
          presence: 1,
          heightVal: 0,
          sealed: false,
          phase: rng(),
          tiltNorm: 0.5,
        };
      },
      step(s, ctx) {
        if (s.growth < 1) s.growth = Math.min(1, s.growth + ctx.dt * 0.9);
        // Sway is deterministic — a function of the shared clock, the
        // reed's own phase, turbulence, and the wind gust the world-law
        // drag leaves decaying behind it. No Math.random, no Date.now.
        const target = clamp01(
          0.5 +
            0.5 *
              (Math.sin(ctx.tMs * 0.00075 + s.phase * Math.PI * 2) * (0.35 + ctx.agitation * 0.9) +
                ctx.wind * 0.55),
        );
        s.tiltNorm += (target - s.tiltNorm) * Math.min(1, ctx.dt * 3);
      },
      emit(s, ctx, out) {
        // A vertical ribbon rooted at the reed's true position: the sprite
        // centre sits half the frond's height above the anchor, so the
        // SDF's bottom edge lands exactly on the water floor. Height is
        // the ledger's live growth curve; width (biomass) rides the same
        // value — a mature stand is both taller and thicker.
        const px = s.nx * ctx.width;
        const anchorY = s.ny * ctx.height;
        const heightNy = REED_MAX_HEIGHT_NY * (0.16 + s.heightVal * 0.84);
        const heightPx = Math.max(
          ctx.height * 0.045,
          heightNy * ctx.height * (0.4 + s.growth * 0.6),
        );
        const spriteR = Math.max(heightPx / 3.3, ctx.width * 0.006);
        const centerY = anchorY - heightPx * 0.5;
        const O = oxygenAt(state, s.nx, s.ny);
        const hue = clamp(0.04 + O * 0.16 + (s.sealed ? 0.06 : 0), 0, 0.46);
        const subPhase = (s.phase + ((ctx.tMs * 0.00026) % 1)) % 1;
        out.push(
          px, centerY,
          spriteR,
          0,
          hue,
          s.tiltNorm,
          shapeSlot(0, subPhase),
          s.presence * (0.55 + s.heightVal * 0.45),
        );
      },
      verbs: [],
      respond: {},
    };

    const matSpec: SceneObjectSpec<MatView> = {
      kind: "biofilm",
      cap: MAX_MATS,
      born(seed, nx, ny, tMs) {
        const rng = sceneMulberry32(seed);
        return {
          id: 0,
          seed,
          nx,
          ny,
          bornMs: tMs,
          growth: 0.2,
          sealedMs: null,
          presence: 1,
          massVal: 0.2,
          phase: rng(),
        };
      },
      step(s, ctx) {
        if (s.growth < 1) s.growth = Math.min(1, s.growth + ctx.dt * 0.6);
      },
      emit(s, ctx, out) {
        // A horizontal patch on the floor — the biofilm density field's
        // footprint. Position and mass come straight from the ledger.
        const px = s.nx * ctx.width;
        const py = s.ny * ctx.height;
        const r =
          Math.max(ctx.width * 0.05, ctx.width * 0.13 * (0.35 + s.massVal * 0.75)) *
          (0.3 + s.growth * 0.7);
        const subPhase = (s.phase + ((ctx.tMs * 0.00017) % 1)) % 1;
        out.push(
          px, py,
          r,
          0,
          0.5,
          0.35 + s.massVal * 0.5,
          shapeSlot(1, subPhase),
          s.presence * (0.45 + s.massVal * 0.55),
        );
      },
      verbs: [],
      respond: {},
    };

    const reeds = createPopulation(reedSpec);
    const mats = createPopulation(matSpec);
    const populationLayer = stage
      ? createPopulationLayer(stage, {
          // u_palA = ACCENT (cool reed green), u_palB = ACCENT2 (warm
          // biofilm), u_palC = GLOW (bright water / sunlit reed tip).
          palette: ["#4a7a8a", "#c8945a", "#e8dc9a"],
          frag: MARSH_POPULATION_FRAG,
        })
      : null;
    const instanceBuffer = createInstanceBuffer(MAX_REEDS + MAX_MATS);

    const reedU = new Float32Array(MAX_REEDS * 4);
    const reedUB = new Float32Array(MAX_REEDS * 4);
    const matU = new Float32Array(MAX_MATS * 4);
    const rippleU = new Float32Array(MAX_RIPPLES * 4);
    const ripples: { x: number; y: number; t0: number; intensity: number }[] = [];

    let lens = 0;
    let lensTarget = 0;
    let lensSnapped = 0;
    let lean = 0;
    let leanTarget = 0;
    let night = 0;
    let nightTarget = 0;
    let stir = 0;
    // Decaying lateral gust — the reeds' cosmetic sway, nudged by the
    // world-law drag (wind) and by turbulence, never a stored physics
    // field. Decays back toward 0 each frame; see draw().
    let windX = 0;
    let timeScale = 1;
    let timeScaleTarget = 1;
    let cursorX = 0.5;
    let cursorY = 0.5;
    let cursorLit = 0;
    let kbCharge = 0;
    let lastSaveAt = performance.now();
    let dwellingReedId: number | null = null;
    let lastDeepenAt = 0;
    // Deterministic index into the tier-3-on-open-water cycle (spring /
    // germinate / bloom) — advances once per tap, never Math.random.
    let emptyTapCycle = 0;

    const toLocal = (px: number, py: number) => {
      const r = surface.getBoundingClientRect();
      return {
        nx: clamp01((px - r.left) / Math.max(1, r.width)),
        ny: clamp01((py - r.top) / Math.max(1, r.height)),
      };
    };

    const pushRipple = (nx: number, ny: number, intensity: number) => {
      ripples.push({ x: nx, y: ny, t0: performance.now(), intensity: clamp01(intensity) });
      if (ripples.length > MAX_RIPPLES) ripples.shift();
    };

    const ringHere = (nx: number, ny: number, weight = 1) => {
      const O = oxygenAt(state, nx, ny);
      const hz = ringHzFor(O);
      try {
        audio.playTone(hz, 0.12 + weight * 0.18);
        haptics.ripple(0.3 + weight * 0.35);
      } catch {
        /* the sea is not awake */
      }
      pushRipple(nx, ny, 0.5 + weight * 0.4);
    };

    const soundReed = (reed: Reed) => {
      const O = oxygenAt(state, reed.x, reed.y);
      try {
        audio.playTone(ringHzFor(O), 0.16);
      } catch {
        /* noop */
      }
    };

    const chargeHeightFor = (elapsedMs: number) =>
      HEIGHT_STEP_MAX * (1 - Math.exp(-Math.max(0, elapsedMs) / REED_GROW_TAU_MS));

    const syncReedsFromLedger = (now: number) => {
      const items = reeds.items;
      const ledger: Reed[] = state.reeds;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.presence < 1) continue;
        if (!ledger.some((r) => r.id === item.id)) item.presence = 0.999;
      }
      for (const r of ledger) {
        let item = items.find((it) => it.id === r.id && it.presence >= 1);
        if (!item) {
          item = {
            id: r.id,
            seed: hashSeed(state.seedKey, r.id),
            nx: r.x,
            ny: r.y,
            bornMs: now,
            growth: 0.05,
            sealedMs: r.sealed ? now : null,
            presence: 1,
            heightVal: r.height,
            sealed: r.sealed,
            phase: r.phase,
            tiltNorm: 0.5,
          };
          items.push(item);
        } else {
          item.nx = r.x;
          item.ny = r.y;
          item.heightVal = r.height;
          item.sealed = r.sealed;
          item.phase = r.phase;
          if (r.sealed && item.sealedMs === null) item.sealedMs = now;
        }
      }
    };

    const syncMatsFromLedger = (now: number) => {
      const items = mats.items;
      const ledger: BiofilmMat[] = state.mats;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.presence < 1) continue;
        if (!ledger.some((m) => m.id === item.id)) item.presence = 0.999;
      }
      for (const m of ledger) {
        let item = items.find((it) => it.id === m.id && it.presence >= 1);
        if (!item) {
          item = {
            id: m.id,
            seed: hashSeed(state.seedKey, m.id + 1000),
            nx: m.x,
            ny: m.y,
            bornMs: now,
            growth: 0.2,
            sealedMs: null,
            presence: 1,
            massVal: m.mass,
            phase: m.phase,
          };
          items.push(item);
        } else {
          item.nx = m.x;
          item.ny = m.y;
          item.massVal = m.mass;
          item.phase = m.phase;
        }
      }
    };

    /**
     * The tap ladder's top rung, on a reed or on open water alike: a
     * whole-marsh oxygen flush (flushMarsh). The room's largest, rarest
     * event — every reed pings brighter as the field aerates, every
     * biofilm mat visibly recedes as the same aeration starves it. `depth`
     * is 0..1; tier 5 lands mid-scale, a sustained tier-n train deepens it
     * continuously via tapTrainDepth.
     */
    const flushEvent = (depth: number, intensity: number) => {
      state = flushMarsh(state, (0.5 + depth * 0.5) * (0.7 + intensity * 0.3));
      for (const r of state.reeds) pushRipple(r.x, r.y, 0.6 + depth * 0.4);
      for (const m of state.mats) pushRipple(m.x, m.y, 0.5 + depth * 0.3);
      try {
        const meanO = meanOxygen(state);
        audio.playTone(ringHzFor(meanO), 0.4 + depth * 0.3);
        audio.playTone(ringHzFor(meanO) * 1.5, 0.28 + depth * 0.2);
        audio.bell();
        haptics.roll();
      } catch {
        /* noop */
      }
      writer.schedule();
    };

    const engine: MarshApi = {
      tap: (x, y, intensity, count, fingers) => {
        const { nx, ny } = toLocal(x, y);
        cursorX = nx;
        cursorY = ny;
        cursorLit = 1;
        if (fingers >= 2) return;
        const tier = tapTrainTier(count);
        const found = nearestReed(state, nx, ny, 0.08);
        if (found) {
          if (tier === 1) {
            // the room's ordinary answer: ring the reed at its own pitch.
            soundReed(found);
            pushRipple(found.x, found.y, 0.7);
            haptics.tap();
            return;
          }
          if (tier === 3) {
            // the reed forks: a satellite sprouts beside it, inheriting a
            // share of its height — a real second reed, not a bigger ring.
            // The offset is seeded from the reed's own id and the ledger's
            // own clock (tau), never Math.random.
            const rng = sceneMulberry32(hashSeed(found.id, Math.floor(state.tau * 997)));
            const ang = rng() * Math.PI * 2;
            const rad = 0.03 + rng() * 0.035;
            const ox = clamp01(found.x + Math.cos(ang) * rad);
            const oy = clamp01(found.y + Math.sin(ang) * rad);
            const before = state.reeds.length;
            state = plantReed(state, ox, oy);
            if (state.reeds.length > before) {
              const child = state.reeds[state.reeds.length - 1];
              if (child) {
                state = deepenReed(state, child.id, found.height * 0.4 * (0.6 + intensity * 0.4));
              }
              pushRipple(ox, oy, 0.7);
              pushRipple(found.x, found.y, 0.5);
              try {
                audio.playNote(52, 260);
                audio.bell();
                haptics.bloom();
              } catch {
                /* noop */
              }
              writer.schedule();
            } else {
              try { audio.refuse(); } catch { /* noop */ }
            }
            return;
          }
          // tier 5 / n — the whole-marsh flush, scaled by the train's depth
          // past 5 so a sustained roll keeps deepening rather than stopping.
          flushEvent(tier === "n" ? tapTrainDepth(count) : 0.62, intensity);
          return;
        }
        if (tier === 1) {
          ringHere(nx, ny, 0.6 + intensity * 0.4);
          return;
        }
        if (tier === 3) {
          // a cycling set of rarer events over open water, true to the
          // marsh's own materials — a spring wells up, a reed germinates,
          // an algae bloom takes hold — so a hand that keeps tapping empty
          // water keeps finding something new, deterministically.
          const which = emptyTapCycle % 3;
          emptyTapCycle++;
          if (which === 0) {
            state = pulseOxygen(state, nx, ny, 0.28 + intensity * 0.14);
            pushRipple(nx, ny, 0.75);
            try {
              audio.bell();
              audio.playTone(ringHzFor(oxygenAt(state, nx, ny)), 0.3);
              haptics.chop();
            } catch {
              /* noop */
            }
            writer.schedule();
          } else if (which === 1) {
            const before = state.reeds.length;
            state = plantReed(state, nx, ny);
            if (state.reeds.length > before) {
              pushRipple(nx, ny, 0.6);
              try {
                audio.playNote(50, 240);
                haptics.tap();
              } catch {
                /* noop */
              }
              writer.schedule();
            } else {
              try { audio.refuse(); } catch { /* noop */ }
            }
          } else {
            const before = state.mats.length;
            state = plantMat(state, nx, ny, 0.18 + intensity * 0.14);
            if (state.mats.length > before) {
              pushRipple(nx, ny, 0.55);
              try {
                audio.playTone(140, 0.28);
                haptics.tap();
              } catch {
                /* noop */
              }
              writer.schedule();
            } else {
              try { audio.refuse(); } catch { /* noop */ }
            }
          }
          return;
        }
        // tier 5 / n on open water — the same whole-marsh flush.
        flushEvent(tier === "n" ? tapTrainDepth(count) : 0.62, intensity);
      },
      stepBack: () => {
        if (lensSnapped === 1) {
          lensSnapped = 0;
          lensTarget = 0;
          try { haptics.lens(); } catch { /* noop */ }
        }
      },
      tutti: (intensity) => {
        for (const r of state.reeds) pushRipple(r.x, r.y, 0.6);
        const meanO = meanOxygen(state);
        const hz = ringHzFor(meanO);
        try {
          audio.playTone(hz, 0.24 + intensity * 0.2);
          audio.playTone(hz * 1.5, 0.18 + intensity * 0.15);
          haptics.roll();
        } catch { /* noop */ }
      },
      plant: (x, y) => {
        const { nx, ny } = toLocal(x, y);
        cursorX = nx;
        cursorY = ny;
        if (!inMarshBounds(nx, ny)) {
          try { audio.refuse(); } catch { /* noop */ }
          return;
        }
        const before = state.reeds.length;
        state = plantReed(state, nx, ny);
        if (state.reeds.length > before) {
          const planted = state.reeds[state.reeds.length - 1];
          if (planted) dwellingReedId = planted.id;
          pushRipple(nx, ny, 0.55);
          try {
            audio.playNote(48, 220);
            haptics.tap();
          } catch { /* noop */ }
        } else {
          try { audio.refuse(); } catch { /* noop */ }
        }
        writer.schedule();
      },
      deepen: (elapsed, x, y, tier) => {
        if (dwellingReedId === null) return;
        const now = performance.now();
        if (now - lastDeepenAt < 60) return;
        lastDeepenAt = now;
        const target = chargeHeightFor(elapsed);
        const current = state.reeds.find((r) => r.id === dwellingReedId)?.height ?? 0;
        const dHeight = Math.max(0, target - current);
        if (dHeight <= 0) return;
        state = deepenReed(state, dwellingReedId, dHeight);
        void x; void y; void tier;
        try {
          const g = state.reeds.find((r) => r.id === dwellingReedId);
          if (g) {
            const O = oxygenAt(state, g.x, g.y);
            audio.playTone(ringHzFor(O), 0.05);
          }
        } catch { /* noop */ }
      },
      ceremony: (x, y) => {
        if (dwellingReedId === null) {
          const { nx, ny } = toLocal(x, y);
          const found = nearestReed(state, nx, ny, 0.14);
          if (!found) {
            try { audio.refuse(); } catch { /* noop */ }
            return;
          }
          dwellingReedId = found.id;
        }
        state = sealReed(state, dwellingReedId);
        setHasKept(true);
        pushRipple(cursorX, cursorY, 1);
        try {
          audio.bell();
          const g = state.reeds.find((r) => r.id === dwellingReedId);
          if (g) {
            const O = oxygenAt(state, g.x, g.y);
            audio.playTone(ringHzFor(O), 0.6);
          }
          haptics.bloom();
        } catch { /* noop */ }
        dwellingReedId = null;
        writer.schedule();
      },
      settle: (elapsed, x, y, tier) => {
        void elapsed; void x; void y;
        if (tier < 3) dwellingReedId = null;
      },
      timeScale: (k) => {
        timeScaleTarget = clamp(k, 0.15, 1);
      },
      drag: (phase, x, y, dx, dy, fingers) => {
        const { nx, ny } = toLocal(x, y);
        cursorX = nx;
        cursorY = ny;
        cursorLit = 1;
        if (fingers >= 3) return;
        stir = Math.min(1, stir + (Math.abs(dx) + Math.abs(dy)) / 4000);
        if (phase === "move" && Math.hypot(dx, dy) > 6) {
          pushRipple(nx, ny, 0.25);
        }
      },
      wind: (dx, dy) => {
        climate = {
          warmth: clamp01(climate.warmth + dx * 0.0018),
          wet: clamp01(climate.wet + dy * 0.0018),
        };
        state = {
          ...state,
          sunlight: clamp01(state.sunlight + dx * 0.0018),
        };
        // The same drag also leaves a decaying gust behind it — a purely
        // cosmetic lean on the reeds' sway, not a ledger field.
        windX = clamp(windX + dx * 0.0025, -1, 1);
        try {
          audio.playTone(72 + state.sunlight * 60, 0.14);
        } catch { /* noop */ }
        writer.schedule();
      },
      flick: (x, y, angle, speed, fingers) => {
        const { nx, ny } = toLocal(x, y);
        pushRipple(nx, ny, Math.min(1, 0.5 + speed / 8));
        // Add an oxygen pulse at the flick point.
        state = pulseOxygen(state, nx, ny, Math.min(0.3, 0.1 + speed / 5000));
        const O = oxygenAt(state, nx, ny);
        try {
          audio.bell();
          audio.playTone(ringHzFor(O) * (1 + Math.abs(angle) * 0.1), 0.32);
          haptics.chop();
        } catch { /* noop */ }
        stirTurbulence(0.05 + Math.min(0.2, speed / 5000));
        void fingers;
      },
      stir: (cx, cy, angularVelocity) => {
        const { nx, ny } = toLocal(cx, cy);
        stir = Math.min(1, stir + Math.min(1.2, Math.abs(angularVelocity)) * 0.18);
        pushRipple(nx, ny, 0.35);
        try {
          const O = oxygenAt(state, nx, ny);
          audio.playTone(ringHzFor(O) * 0.75, 0.16);
          haptics.tap();
        } catch { /* noop */ }
      },
      lens: (angle, velocity) => {
        if (velocity === 0) {
          lensSnapped = lensTarget > 0.5 ? 1 : 0;
          lensTarget = lensSnapped;
          try { haptics.lens(); } catch { /* noop */ }
        } else {
          lensTarget = clamp01(lensTarget + angle / 2);
        }
      },
      season: (angle, velocity) => {
        const span = Math.abs(angle) * 24 * 3600;
        if (span > 0) {
          climate = {
            warmth: clamp01(climate.warmth + angle * 0.08),
            wet: clamp01(climate.wet - angle * 0.05),
          };
          state = advanceExact(state, span, climate);
        }
        if (velocity === 0) {
          try { haptics.detent(); } catch { /* noop */ }
          writer.schedule();
        }
      },
      drum: (hits, alternation, x, y) => {
        void hits;
        const { nx, ny } = toLocal(x, y);
        pushRipple(nx, ny, 0.4 + alternation * 0.3);
        // Oxygen pulse from the drum beat.
        state = pulseOxygen(state, nx, ny, 0.08 * alternation);
        try {
          const O = oxygenAt(state, nx, ny);
          audio.playTone(ringHzFor(O) * (0.75 + alternation * 0.5), 0.14);
          haptics.tap();
        } catch { /* noop */ }
      },
      scatter: (intensity) => {
        stirTurbulence(clamp01(intensity) * 0.6);
        for (const r of state.reeds) pushRipple(r.x, r.y, 0.4 + intensity * 0.4);
      },
      gravity: (gamma) => {
        leanTarget = reduced ? 0 : clamp(gamma / 48, -1, 1);
      },
      knock: (intensity) => {
        // The touch-reachable secret: stir the oxygen field toward its mean.
        state = stirOxygen(state, clamp01(intensity));
        try {
          const meanO = meanOxygen(state);
          const hz = ringHzFor(meanO);
          audio.playTone(hz, 0.5 + intensity * 0.3);
          audio.playTone(hz * 0.5, 0.35);
          haptics.detent();
        } catch { /* noop */ }
        for (const r of state.reeds) pushRipple(r.x, r.y, 0.4 + intensity * 0.4);
        writer.schedule();
      },
      night: (faceDown) => {
        nightTarget = faceDown ? 1 : 0;
      },
      glimmer: () => {
        if (state.reeds.length > 0) {
          const idx = Math.floor(state.tau * 977) % state.reeds.length;
          const r = state.reeds[idx];
          if (r) pushRipple(r.x, r.y, 0.35);
        }
      },
      reduced: (on) => {
        reduced = on;
      },
      moveCursor: (dx, dy) => {
        cursorX = clamp01(cursorX + dx * 0.06);
        cursorY = clamp01(cursorY + dy * 0.06);
        cursorLit = 1;
      },
      keyTap: () => {
        ringHere(cursorX, cursorY, 0.6);
      },
      keyHold: (elapsed) => {
        if (dwellingReedId === null && inMarshBounds(cursorX, cursorY)) {
          const before = state.reeds.length;
          state = plantReed(state, cursorX, cursorY);
          if (state.reeds.length > before) {
            const planted = state.reeds[state.reeds.length - 1];
            if (planted) dwellingReedId = planted.id;
          }
        }
        if (dwellingReedId !== null) {
          const target = chargeHeightFor(elapsed);
          const current = state.reeds.find((r) => r.id === dwellingReedId)?.height ?? 0;
          if (target > current) {
            state = deepenReed(state, dwellingReedId, target - current);
          }
        }
        kbCharge = clamp01(elapsed / 2400);
        if (kbCharge >= 1 && dwellingReedId !== null) {
          state = sealReed(state, dwellingReedId);
          setHasKept(true);
          try {
            audio.bell();
            haptics.bloom();
          } catch { /* noop */ }
          dwellingReedId = null;
          kbCharge = 0;
          writer.schedule();
        }
      },
      keyEscape: () => {
        if (lensSnapped === 1) {
          lensSnapped = 0;
          lensTarget = 0;
        }
        kbCharge = 0;
        dwellingReedId = null;
      },
      clear: () => {
        cleared = true;
        state = {
          ...state,
          reeds: [],
          mats: [],
        };
        setHasKept(false);
        try {
          audio.thud();
          haptics.roll();
        } catch { /* noop */ }
        writer.schedule();
      },
    };
    apiRef.current = engine;

    const draw = (now: number) => {
      if (!running) return;
      const dtRaw = Math.min(0.05, (now - last) / 1000);
      last = now;
      const tier = gov.beginFrame(now);
      void tier;

      relaxTurbulence(now);
      const agitation = getTurbulence();
      const t = audio.getAudioTime() ?? now / 1000;

      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dtRaw * 5);
      lens += (lensTarget - lens) * Math.min(1, dtRaw * 6);
      lean += (leanTarget - lean) * Math.min(1, dtRaw * 3);
      night += (nightTarget - night) * Math.min(1, dtRaw * 2);
      stir = Math.max(0, stir - dtRaw * 0.28);
      windX *= Math.exp(-dtRaw * 0.5);
      cursorLit = Math.max(0, cursorLit - dtRaw * 0.5);

      if (!asleep) {
        state = advanceExact(state, dtRaw * timeScale * WATCHED_SPEED, climate);
      }
      lastSeen = now;

      if (now - lastSaveAt > SAVE_EVERY_MS) {
        lastSaveAt = now;
        writer.schedule();
      }

      if (stage && prog && quad && !stage.contextLost() && !asleep) {
        prog.use();
        stage.beginFrame(
          clocksFrom({ time: reduced ? 12 : t, turbulence: agitation, reducedMotion: reduced }),
          prog,
        );
        // Reed uniforms
        let rN = 0;
        for (const r of state.reeds) {
          if (rN >= MAX_REEDS) break;
          reedU[rN * 4] = r.x;
          reedU[rN * 4 + 1] = r.y;
          reedU[rN * 4 + 2] = clamp01(r.height);
          reedU[rN * 4 + 3] = r.phase;
          reedUB[rN * 4] = r.sealed ? 1 : 0;
          reedUB[rN * 4 + 1] = oxygenAt(state, r.x, r.y);
          reedUB[rN * 4 + 2] = 0;
          reedUB[rN * 4 + 3] = 0;
          rN++;
        }
        // Mat uniforms
        let mN = 0;
        for (const m of state.mats) {
          if (mN >= MAX_MATS) break;
          matU[mN * 4] = m.x;
          matU[mN * 4 + 1] = m.y;
          matU[mN * 4 + 2] = clamp01(m.mass);
          matU[mN * 4 + 3] = m.phase;
          mN++;
        }
        // Ripple uniforms
        for (let i = ripples.length - 1; i >= 0; i--) {
          const age = (now - ripples[i].t0) / 1000;
          if (age > 3.5) ripples.splice(i, 1);
        }
        let rippleN = 0;
        for (const r of ripples) {
          if (rippleN >= MAX_RIPPLES) break;
          rippleU[rippleN * 4] = r.x;
          rippleU[rippleN * 4 + 1] = r.y;
          rippleU[rippleN * 4 + 2] = (now - r.t0) / 1000;
          rippleU[rippleN * 4 + 3] = r.intensity;
          rippleN++;
        }
        prog.setInt("uReedCount", rN);
        prog.setInt("uMatCount", mN);
        prog.setInt("uRippleCount", rippleN);
        prog.setVec4("uClimate", climate.warmth, climate.wet, meanOxygen(state), state.sunlight);
        prog.setFloat("uLean", lean);
        prog.setFloat("uNight", night);
        prog.setFloat("uStir", stir);
        prog.setFloat("uLens", lens);
        const reedLoc = prog.location("uReeds[0]");
        if (reedLoc) stage.gl.uniform4fv(reedLoc, reedU);
        const reedBLoc = prog.location("uReedsB[0]");
        if (reedBLoc) stage.gl.uniform4fv(reedBLoc, reedUB);
        const matLoc = prog.location("uMats[0]");
        if (matLoc) stage.gl.uniform4fv(matLoc, matU);
        const rippleLoc = prog.location("uRipples[0]");
        if (rippleLoc) stage.gl.uniform4fv(rippleLoc, rippleU);
        quad.draw();

        syncReedsFromLedger(now);
        syncMatsFromLedger(now);
        const breathNow = reduced ? 0.5 : 0.5 + 0.5 * Math.sin((t * Math.PI * 2) / 7);
        reeds.step({
          dt: Math.min(0.05, dtRaw),
          tMs: now,
          breath: breathNow,
          detail: 1,
          wind: windX,
          gravity: 0,
          agitation,
          season: 0,
          timeScale,
          reducedMotion: reduced,
        });
        mats.step({
          dt: Math.min(0.05, dtRaw),
          tMs: now,
          breath: breathNow,
          detail: 1,
          wind: 0,
          gravity: 0,
          agitation,
          season: 0,
          timeScale,
          reducedMotion: reduced,
        });
        instanceBuffer.reset();
        const emitCtx = {
          width: stage.size.width,
          height: stage.size.height,
          tMs: now,
          breath: breathNow,
          detail: 1,
          reducedMotion: reduced,
        };
        reeds.emit(emitCtx, instanceBuffer);
        mats.emit(emitCtx, instanceBuffer);
        populationLayer?.draw(instanceBuffer);
      }

      // Twist lens overlay
      const octx = stage?.overlay2d ?? null;
      if (octx) {
        const r = surface.getBoundingClientRect();
        const w = r.width;
        const h = r.height;
        octx.clearRect(0, 0, w, h);

        if (lens > 0.02) {
          octx.globalAlpha = lens;
          const pad = 16;
          const barY = h - 100;
          const barW = Math.min(200, w - pad * 2);
          const meanO = meanOxygen(state);
          const totalH = totalReedHeight(state);
          const totalM = matTotalMass(state);
          octx.fillStyle = "rgba(232, 220, 154, 0.6)";
          octx.fillRect(pad, barY, barW * meanO, 8);
          octx.fillStyle = "rgba(74, 122, 138, 0.6)";
          octx.fillRect(pad, barY + 14, barW * clamp01(totalH / MAX_HEIGHT / MAX_REEDS * 5), 8);
          octx.fillStyle = "rgba(200, 148, 90, 0.6)";
          octx.fillRect(pad, barY + 28, barW * clamp01(totalM / MAX_MATS), 6);
          octx.font = "300 10px ui-monospace, 'SF Mono', Menlo, monospace";
          octx.textAlign = "left";
          octx.fillStyle = "rgba(232, 238, 224, 0.7)";
          octx.fillText(
            `reeds ${state.reeds.length}  sealed ${sealedCount(state)}  ` +
              `mean O ${meanO.toFixed(2)}  ${ringHzFor(meanO).toFixed(0)}hz`,
            pad,
            barY + 54,
          );
          octx.fillText(
            `sun ${state.sunlight.toFixed(2)}  mat mass ${totalM.toFixed(2)}  ` +
              `reed height ${totalH.toFixed(2)}`,
            pad,
            barY + 68,
          );
          octx.globalAlpha = 1;
        }

        if (cursorLit > 0.01) {
          octx.strokeStyle = `rgba(232, 238, 224, ${(0.4 * cursorLit).toFixed(3)})`;
          octx.lineWidth = 1;
          octx.beginPath();
          octx.arc(cursorX * w, cursorY * h, 9 + kbCharge * 20, 0, Math.PI * 2);
          octx.stroke();
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      running = false;
      apiRef.current = null;
      unvis();
      ungal();
      writer.flush();
      populationLayer?.dispose();
      quad?.dispose();
      stage?.dispose();
      cancelAnimationFrame(raf);
      void lastSeen;
    };
  }, []);

  const voice = useMemo<RoomVoice>(
    () => ({
      tap: (e) => apiRef.current?.tap(e.x, e.y, e.intensity, e.count, e.fingers),
      stepBack: () => apiRef.current?.stepBack(),
      tutti: (e) => apiRef.current?.tutti(e.intensity),
      plant: (e) => apiRef.current?.plant(e.x, e.y),
      deepen: (e) => apiRef.current?.deepen(e.elapsed, e.x, e.y, e.tier),
      ceremony: (e) => apiRef.current?.ceremony(e.x, e.y),
      settle: (e) => apiRef.current?.settle(e.elapsed, e.x, e.y, e.tier),
      timeScale: (k) => apiRef.current?.timeScale(k),
      drag: (e) => apiRef.current?.drag(e.phase, e.x, e.y, e.dx, e.dy, e.fingers),
      wind: (e) => apiRef.current?.wind(e.dx, e.dy),
      flick: (e) => apiRef.current?.flick(e.x, e.y, e.angle, e.speed, e.fingers),
      stir: (e) => apiRef.current?.stir(e.cx, e.cy, e.angularVelocity),
      lens: (e) => apiRef.current?.lens(e.angle, e.velocity),
      season: (e) => apiRef.current?.season(e.angle, e.velocity),
      drum: (e) => apiRef.current?.drum(e.hits, e.alternation, e.x, e.y),
      scatter: (e) => apiRef.current?.scatter(e.intensity),
      gravity: (e) => apiRef.current?.gravity(e.gamma),
      knock: (e) => apiRef.current?.knock(e.intensity),
      night: (e) => apiRef.current?.night(e.faceDown),
    }),
    [],
  );

  const keyboard = useMemo(
    () => ({
      enter: () => apiRef.current?.keyTap(),
      enterHeld: (elapsed: number) => apiRef.current?.keyHold(elapsed),
      escape: () => apiRef.current?.keyEscape(),
      arrow: (dx: number, dy: number) => apiRef.current?.moveCursor(dx, dy),
    }),
    [],
  );

  const letGo = useCallback(() => {
    apiRef.current?.clear();
    getFieldAudio().thud();
    haptics.roll();
    setHasKept(false);
  }, []);

  return (
    <RoomShell
      route="/marsh"
      surfaceRef={surfaceRef}
      voice={voice}
      keyboard={keyboard}
      onGlimmer={() => apiRef.current?.glimmer()}
      onReducedMotion={(on) => apiRef.current?.reduced(on)}
      letGo={{ label: "let the marsh rest", onLetGo: letGo, visible: hasKept }}
      style={{ position: "fixed", inset: 0, background: "#0a1a15" }}
    >
      <canvas
        ref={surfaceRef}
        role="application"
        tabIndex={0}
        aria-label="a hand's width of wetland — reeds standing in an oxygenated water field"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          touchAction: "none",
          outline: "none",
        }}
      />
      <canvas
        ref={overlayRef}
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      />
    </RoomShell>
  );
}

// Kept imports to silence unused-import diagnostics.
void POOL_X_MAX;
void POOL_X_MIN;
void POOL_Y_MAX;
void POOL_Y_MIN;
void GRID_W;
void GRID_H;
void oxygenForRingHz;
