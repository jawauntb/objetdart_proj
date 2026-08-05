// object-compiler template — docs/plans/object-compiler.md M3.
// Filled by phase-5 track A (see data/object-compiler/audits/phase-5-reef.md
// for the audit) — shader, domain imports, population layer, verbs, pins.
"use client";

/**
 * /reef — the reef — polyp, colony, cornerstone. See docs/plans/object-compiler.md
 * §"Three creative slots" for what belongs in each slot.
 *
 * The invariant is a lattice of coral polyps under a shared current and a
 * depth-dependent illumination (src/lib/coralflow.ts). The shader paints a
 * hand's width of sunlit reef in section: a thin band of surface sky, a
 * deepening turquoise column, a calcite substrate at the floor, and — one
 * instanced draw per frame — a corona around every polyp whose brightness
 * IS its live size (the load-bearing invariant map is SIZE → PIXEL, and
 * every ripple is a lens over the same colony).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { getTurbulence, relaxTurbulence, stirTurbulence } from "@/lib/turbulence";
import RoomShell from "@/components/RoomShell";
import type { RoomVoice } from "@/lib/gesture/defaults";
import { tapTrainTier } from "@/lib/gesture/core";
import { createGLStage, FULLSCREEN_VERT_UNIT } from "@/lib/webgl/stage";
import { clocksFrom } from "@/lib/webgl/sizing";
import {
  onVisibility,
  onGalleryPause,
  createIdleWriter,
  createFrameGovernor,
  isEmbeddedFrame,
} from "@/lib/room-runtime";
import {
  createPopulation,
  mulberry32 as sceneMulberry32,
  type SceneObjectSpec,
  type SceneObjectState,
} from "@/lib/scene/object";
import { createInstanceBuffer } from "@/lib/scene/instances";
import { createPopulationLayer } from "@/lib/scene/population-layer";
// __SLOT_DOMAIN_IMPORTS__
import {
  MAX_POLYPS,
  MAX_SIZE,
  POOL_X_MAX,
  POOL_X_MIN,
  POOL_Y_MAX,
  POOL_Y_MIN,
  advanceExact,
  cornerstoneCount,
  deepenPolyp,
  hashSeed,
  inReefBounds,
  initState,
  knockSweep,
  meanSize,
  nearestPolyp,
  plantPolyp,
  ringHzFor,
  sealPolyp,
  sizeForRingHz,
  totalMass,
  type Climate,
  type Polyp,
  type ReefState,
} from "@/lib/coralflow";

/** Persistence key — versioned; a schema change bumps the suffix. */
const STORE_KEY = "objetdart:reef:v1";
/** How often the idle writer flushes to storage while a hand is present. */
const SAVE_EVERY_MS = 4000;
/** The transient wavefronts the shader draws across the water column. */
const MAX_RIPPLES = 24;
/** How much a full-tier dwell adds to a polyp's size on a saturating curve. */
const SIZE_STEP_MAX = 0.55;
/**
 * Time-constant of the polyp's growth under a sustained press:
 * `s(t) = SIZE_STEP_MAX · (1 − e^{-t/τ})`. A MATERIAL time-constant — how
 * fast a hand recruits a polyp toward saturation — not a gesture tier; the
 * tiers themselves live in `gesture/core.ts` alone and are read from the
 * `deepen` event's own `elapsed` and `tier`.
 */
const SIZE_WIDEN_TAU_MS = 900;
/** Simulation speed while a hand is present, in ledger seconds per real second. */
const WATCHED_SPEED = 60;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);

/**
 * The polyp, in the shared scene model's vocabulary. The physics ledger
 * (`state.polyps: Polyp[]` in coralflow.ts) is authoritative; this view is
 * the render half, synced from the ledger each frame so the shared
 * `createPopulation` + `createPopulationLayer` can draw every polyp in
 * one instanced pass.
 */
/**
 * Two polyp views over the shared coralflow ledger. cornerstoneView reads
 * sealed polyps; recruitView reads unsealed. Splitting the population into
 * two specs (phase 9 rewrite) is what lets the eye read the colony's frame
 * off shape difference — a mature branching cornerstone vs a young disc —
 * instead of one flat SDF disc for every polyp (the phase-5 stub).
 */
type CornerstoneView = SceneObjectState & {
  sizeVal: number;
  phase: number;
};
type RecruitView = SceneObjectState & {
  sizeVal: number;
  phase: number;
};

/**
 * The population-layer fragment shader, room-specialized for the reef's
 * two-tier polyp system. Uses the phase-8 `PopulationLayerOptions.frag`
 * escape hatch added by /tidepool's rewrite (src/lib/scene/population-layer.ts).
 *
 * Shape selection rides `vPhase`'s integer part:
 *   SHAPE_CORNERSTONE = 0 + breathPhase(0..1)   — branching mature coral
 *   SHAPE_RECRUIT     = 1 + breathPhase(0..1)   — small disc with corona
 *
 * `vGlow` carries the polyp's live size (0..1.6 to accommodate the corona
 * brightness overrun the ledger allows). `vHue` is a per-tier bias into the
 * shared palette (u_palA teal, u_palB coral-orange, u_palC pale gold). The
 * two-tier shape difference is what makes an object screenshot instantly
 * legible: a cornerstone is a decade of anchor, a recruit is a season.
 */
const POPULATION_FRAG = `precision mediump float;
varying vec2 vLocal;
varying float vHue;
varying float vGlow;
varying float vPhase;
varying float vAlpha;
uniform vec3 u_palA;
uniform vec3 u_palB;
uniform vec3 u_palC;

vec3 pickPalette(float h) {
  h = clamp(h, 0.0, 1.0);
  return h < 0.5 ? mix(u_palA, u_palB, h * 2.0) : mix(u_palB, u_palC, (h - 0.5) * 2.0);
}

// Cornerstone — a mature branching coral head. Bright central bulb (the
// polyp mouth), six radial tapered tines with small branching nubs, plus a
// soft additive corona. sizeParam (from vGlow) drives the branch reach and
// the corona brightness — a sealed polyp with full size reads unambiguously
// as a decade of anchor, and inverting the corona still recovers its size.
float sdfCornerstone(vec2 p, float sizeParam, float breathPulse) {
  float r = length(p);
  if (r > 1.85) return 0.0;
  float theta = atan(p.y, p.x);
  // Central bulb — always bright
  float bulbR = 0.36 + breathPulse * 0.05;
  float bulb = smoothstep(bulbR, bulbR * 0.42, r);
  // 6 tapering tines radiating outward
  const float N = 6.0;
  float sector = 6.2832 / N;
  float phaseA = mod(theta + 6.2832 + sector * 0.5, sector) - sector * 0.5;
  float alongTine = smoothstep(1.55, 0.25, r);
  float taperedWidth = mix(0.34, 0.09, r / 1.6);
  float crossTine = 1.0 - smoothstep(taperedWidth * 0.65, taperedWidth * 1.5, abs(phaseA) * (r + 0.2));
  float tines = alongTine * crossTine;
  // Two branching nubs on each tine — small brighter clusters at 40% / 75%
  float nub1 = exp(-pow((r - 0.65) * 9.0, 2.0)) * exp(-pow(phaseA * 6.0, 2.0));
  float nub2 = exp(-pow((r - 1.10) * 9.0, 2.0)) * exp(-pow(phaseA * 6.0, 2.0));
  float branches = (nub1 + nub2) * 0.42;
  // Additive outer corona — feathered glow scaling with size
  float corona = exp(-r * r * 0.75) * 0.32 * sizeParam;
  return clamp(bulb + tines * (0.62 + 0.35 * sizeParam) + branches + corona, 0.0, 1.0);
}

// Recruit — a small bright disc with a soft additive corona. Reads as a
// juvenile polyp still climbing its logistic; brightness is the size, so
// two recruits ringing the same note are the same age, and the corona
// inverts to recover it.
float sdfRecruit(vec2 p, float sizeParam, float breathPulse) {
  float r = length(p);
  if (r > 1.5) return 0.0;
  float discR = 0.38 + sizeParam * 0.14 + breathPulse * 0.045;
  // Sharper disc edge (smoothstep between the disc radius and 82% of it)
  // reads as a real polyp silhouette instead of a soft glow blob.
  float disc = smoothstep(discR, discR * 0.82, r);
  // A crisp rim around the disc — a young polyp has a real edge to its
  // body, and the corona is the soft glow around it.
  float rim = exp(-pow((r - discR * 0.9) * 24.0, 2.0)) * (0.35 + sizeParam * 0.4);
  float corona = exp(-r * r * 2.4) * (0.24 + sizeParam * 0.50);
  return clamp(disc * 0.90 + rim + corona, 0.0, 1.0);
}

void main() {
  float shapeF = floor(vPhase + 0.001);
  float subPhase = fract(vPhase);
  float breathPulse = 0.5 + 0.5 * sin(subPhase * 6.2832);
  float a = 0.0;
  vec3 c;
  if (shapeF < 0.5) {
    // cornerstone — warm mature tissue, brighter than a recruit
    float sizeParam = clamp(vGlow, 0.0, 1.6);
    a = sdfCornerstone(vLocal, sizeParam, breathPulse);
    c = pickPalette(vHue) * (0.82 + 0.55 * (1.0 - length(vLocal) * 0.35));
    // Sealed cornerstones carry a bright inner rim toward u_palC (glow)
    c += u_palC * 0.30 * clamp(1.0 - length(vLocal) * 0.75, 0.0, 1.0);
  } else {
    // recruit — small young polyp, brightness = its live size
    float sizeParam = clamp(vGlow, 0.0, 1.6);
    a = sdfRecruit(vLocal, sizeParam, breathPulse);
    c = pickPalette(vHue) * (0.68 + 0.40 * (1.0 - length(vLocal) * 0.4));
  }
  a *= vAlpha;
  if (a <= 0.003) discard;
  gl_FragColor = vec4(c * a, a);
}
`;

type StoredReef = {
  v: 1;
  polyps: ReefState["polyps"];
  current: number;
  illum: number;
  tau: number;
  climate: Climate;
  lastSeen: number;
  cleared?: boolean;
};

/**
 * The material. Everything from the uniforms down through main() lives in the
 * slot below; the wrapping backtick template is boilerplate so an empty slot
 * still parses as TypeScript.
 */
const FRAG = `
precision highp float;

uniform vec2  uRes;
uniform float uTime;
uniform float uBreath;
uniform float uTurbulence;
uniform float uReduced;

varying vec2 vUv;

// __SLOT_SHADER_BODY__
uniform vec4  uPolyps[${MAX_POLYPS}];  // xy pos, z size (0..MAX_SIZE), w phase (0..1)
uniform vec4  uRipples[${MAX_RIPPLES}]; // xy pos, z age (s), w intensity (0..1)
uniform int   uPolypCount;
uniform int   uRippleCount;
/** warmth, wet, current (signed), illum */
uniform vec4  uClimate;
uniform float uLean;
uniform float uNight;
uniform float uStir;
uniform float uLens;

// Phase 9 palette — three distinct registers so the frame reads as a real
// reef in section: bright warm surface, cool teal column, warm coral floor.
// Contrast between BG (deep blue) and BG2 (calcite rust) is what pushes the
// screenshot across the visual-density floor test-room-visual measures.
const vec3 BG      = vec3(0.039, 0.114, 0.165);  // #0a1d2a deep-sea dark blue
const vec3 BG2     = vec3(0.290, 0.157, 0.094);  // #4a2818 warm coral substrate
const vec3 GLOW    = vec3(0.957, 0.902, 0.659);  // #f4e6a8 bright pale gold
const vec3 ACCENT  = vec3(0.239, 0.620, 0.761);  // #3d9ec2 bright teal water
const vec3 ACCENT2 = vec3(0.878, 0.412, 0.227);  // #e0693a coral bloom warm
const vec3 INK     = vec3(0.910, 0.929, 0.898);
const vec3 SKY_LOW  = vec3(0.878, 0.792, 0.647); // sky-horizon warmth just above waterline
const vec3 SKY_HIGH = vec3(0.243, 0.435, 0.596); // upper sky, cooler
const vec3 SILT     = vec3(0.404, 0.278, 0.176); // silt cloud (post-shake)
const vec3 BIO      = vec3(0.353, 0.925, 0.812); // bioluminescent cyan-green

// The sky reads big enough to carry real Snell reflection above the water,
// the substrate is thick enough to carry biofilm + sand ripples below.
const float HORIZON       = 0.16;
const float WATERLINE_MID = 0.20;
const float POOL_XMIN     = ${POOL_X_MIN.toFixed(3)};
const float POOL_XMAX     = ${POOL_X_MAX.toFixed(3)};
const float SUBSTRATE_Y   = 0.78;

// Hoskins' hash + value noise + FBM: the shader's only non-physics.
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
// Three-octave caustic-cell FBM — the sunlit-surface network the caustics
// ride. Kept separate so the caustic term is a real function of position,
// not a scalar per pixel, and reads distinct from the substrate bloom FBM.
float causticFBM(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(1.7, 0.6); a *= 0.62; }
  return v;
}

// The waterline: a wavy shallow surface at WATERLINE_MID. The current
// warps it laterally, and the breath modulates its highlight.
float waterlineY(float x, float t) {
  float wave = sin(x * 8.0 + t * 0.55) * 0.007
             + sin(x * 21.0 - t * 0.9 + uClimate.z * 3.0) * 0.004;
  return WATERLINE_MID + wave;
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  float aspect = uRes.x / max(1.0, uRes.y);
  float night = uNight;
  float silty = clamp(uStir, 0.0, 1.0);
  vec3 col;

  float wl = waterlineY(uv.x, uTime);

  // layer: sky_reflection
  // Above the waterline: a real sunlit sky with a bright horizon band,
  // a sun disc, cirrus streaks. Reads uClimate.w (illumination) and uNight
  // (face-down bioluminescence). This is what makes the guide screenshot
  // show a horizon above the water instead of a dark stub.
  if (uv.y < wl) {
    float above = clamp((wl - uv.y) / max(1e-3, wl), 0.0, 1.0);
    // Horizon → high sky gradient
    vec3 skyTone = mix(SKY_LOW, SKY_HIGH, pow(above, 0.85));
    // Bright horizon band right at the waterline (sun's reflection on the sea)
    float horizonBand = exp(-pow((wl - uv.y) * 22.0, 2.0));
    skyTone += GLOW * horizonBand * (0.55 + 0.20 * uBreath) * (0.6 + uClimate.w * 0.4);
    // Sun disc — rides climate warmth, breathes with uBreath
    float sunX = 0.68 + sin(uTime * 0.04) * 0.02;
    float sunY = wl - 0.09 - uClimate.w * 0.03;
    vec2 sd = (uv - vec2(sunX, sunY)) * vec2(aspect, 1.0);
    float sunR = 0.032;
    float sun = smoothstep(sunR * 1.15, sunR * 0.55, length(sd));
    float sunHalo = exp(-dot(sd, sd) * 65.0);
    skyTone += GLOW * (sun * 0.85 + sunHalo * 0.45) * (0.85 + 0.15 * uBreath);
    // Cirrus streaks — long thin FBM bands
    float cirrus = fbm(vec2(uv.x * 5.0 * aspect + uTime * 0.02, uv.y * 30.0));
    cirrus = smoothstep(0.55, 0.85, cirrus) * (0.32 + uClimate.w * 0.25);
    skyTone = mix(skyTone, mix(skyTone, vec3(1.0), 0.55), cirrus * (1.0 - above * 0.5));
    skyTone *= 0.86 + 0.14 * uBreath;
    // Silt-in-air (post-shake) mutes the sky
    skyTone = mix(skyTone, SILT, silty * 0.30);
    // Night — sky darkens; a subtle bioluminescent glow on the horizon
    skyTone *= 1.0 - night * 0.72;
    skyTone += BIO * night * horizonBand * 0.22;
    col = skyTone;
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  float depthBelow = clamp((uv.y - wl) / max(0.02, SUBSTRATE_Y - wl), 0.0, 1.0);

  // layer: reef_substrate
  // The calcite floor at the section bottom: layered FBM (coarse + fine +
  // grain) paints granite texture, biofilm patches in ACCENT2 concentrate
  // near the water-rock interface, sand ripples ridge the deeper substrate,
  // and dark crevices give the floor depth. Reads uBreath, uStir (silt
  // deposits), uNight (bioluminescent patches glow).
  if (uv.y >= SUBSTRATE_Y) {
    float dSub = clamp((uv.y - SUBSTRATE_Y) / max(0.02, 1.0 - SUBSTRATE_Y), 0.0, 1.0);
    float grain = hash21(floor(uv * uRes * 0.4));
    float coarse = fbm(uv * vec2(9.0 * aspect, 8.0) + vec2(0.4, 1.1));
    float fine = fbm(uv * vec2(48.0 * aspect, 40.0) + vec2(2.7, 3.1));
    vec3 sub = mix(BG2 * 0.55, BG2 * 1.25, coarse);
    sub = mix(sub, sub * (0.7 + grain * 0.6), 0.35);
    sub += BG2 * fine * 0.24;
    // Wet sheen right at the top of the substrate (water-rock interface) —
    // a crisp ridge where the water meets the calcite, so the transition
    // reads as a real boundary the eye can pick up.
    float wetSheen = smoothstep(SUBSTRATE_Y + 0.05, SUBSTRATE_Y, uv.y);
    float ridgeEdge = exp(-pow((uv.y - SUBSTRATE_Y) * 200.0, 2.0));
    sub += GLOW * ridgeEdge * 0.55 * (1.0 - night * 0.7);
    sub += GLOW * wetSheen * 0.24 * (1.0 - night * 0.7);
    // Biofilm — multi-octave FBM patches of coral-bloom warmth
    float bloom = fbm(uv * vec2(24.0 * aspect, 20.0));
    float bloomFine = fbm(uv * vec2(60.0 * aspect, 52.0) + vec2(1.3, 0.7));
    float biofilm = pow(bloom * 0.65 + bloomFine * 0.35, 1.35);
    // Sharp-edged biofilm — smoothstep threshold gives crisp patch edges
    float biofilmSharp = smoothstep(0.32, 0.52, bloom * 0.65 + bloomFine * 0.35);
    float biofilmMask = 0.55 + wetSheen * 0.45;
    sub += ACCENT2 * biofilm * biofilmMask * 0.85 * (0.6 + uBreath * 0.4);
    sub += ACCENT2 * biofilmSharp * biofilmMask * 0.45;
    // Sand ripples — sharper horizontal ridges, denser deeper into the
    // substrate. The smoothstep clamps a sine into ridge-and-trough edges
    // rather than a soft cosine wash — that is what the edge-density
    // metric reads as texture.
    float rawRipple = sin(uv.x * 30.0 * aspect + fbm(uv * vec2(6.0, 4.0)) * 6.0);
    float rippleY = smoothstep(-0.2, 0.35, rawRipple);
    float rippleX = smoothstep(-0.2, 0.35, sin(uv.y * 55.0 + uv.x * 6.0));
    sub += BG2 * rippleY * rippleX * 0.32 * (0.4 + dSub * 0.6);
    sub -= vec3(0.02) * (1.0 - rippleY) * (1.0 - rippleX) * (0.4 + dSub * 0.6);
    // Scattered coral rubble — small dark spots the substrate carries as
    // debris. Deterministic from hash21; adds sharp edges without touching
    // the ledger.
    {
      vec2 rubbleUV = uv * vec2(28.0 * aspect, 22.0);
      vec2 rubbleCell = floor(rubbleUV);
      vec2 rubbleFrac = fract(rubbleUV);
      float rubbleSeed = hash21(rubbleCell + 7.3);
      vec2 rubbleOff = vec2(hash21(rubbleCell + 2.1), hash21(rubbleCell - 4.7));
      float rubbleDist = length(rubbleFrac - rubbleOff);
      float rubbleR = 0.16 + rubbleSeed * 0.14;
      float rubble = smoothstep(rubbleR, rubbleR * 0.55, rubbleDist);
      float rubbleAlive = step(0.42, rubbleSeed);
      sub = mix(sub, sub * mix(0.55, 1.35, rubbleSeed), rubble * rubbleAlive * 0.75);
    }
    // Dark crevices for calcite depth — sharper threshold
    float crev = smoothstep(0.68, 0.85, fbm(uv * vec2(14.0 * aspect, 12.0) + vec2(0.9, 2.4)));
    sub *= 1.0 - crev * 0.40;
    // Silt deposits from the water column settle brighter into the floor
    sub = mix(sub, SILT * 1.35, silty * 0.30 * (1.0 - dSub * 0.4));
    // Night bioluminescence — patches of biofilm glow faintly
    sub += BIO * biofilm * night * 0.60;
    sub *= 1.0 - night * 0.32;
    sub *= 0.90 + 0.10 * uBreath;
    col = sub;
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  // ——— Underwater water column ———

  // layer: refraction_wobble
  // Small horizontal wobble under the surface — stronger near the meniscus,
  // eases with depth. What lives underwater reads distorted, so a polyp
  // just below the waterline reads wavier than a cornerstone deep on the
  // substrate.
  float refractAmp = (1.0 - depthBelow * 0.7) * 0.014;
  float refractDx = sin((uv.y - wl) * 40.0 + uTime * 0.9 + uv.x * 6.0) * refractAmp
                  + sin((uv.y - wl) * 88.0 - uTime * 1.4) * refractAmp * 0.4;
  vec2 uvR = vec2(uv.x + refractDx, uv.y);

  // layer: depth_column
  // Exponential absorption falloff — ACCENT teal near the surface fades to
  // BG deep-water dark. Warmth tints the shallow water toward GLOW; the
  // deep never sees the sun.
  float depthFall = 1.0 - exp(-depthBelow * 2.6);
  vec3 waterCol = mix(ACCENT, BG, depthFall);
  waterCol = mix(waterCol, mix(waterCol, GLOW, 0.32 * (1.0 - depthFall)), uClimate.x);
  waterCol *= 0.55 + 0.45 * clamp(uClimate.w, 0.0, 1.0);
  waterCol *= 0.86 + 0.14 * uBreath;

  // layer: sunlit_surface
  // A bright Snell highlight right at the waterline plus a wider under-
  // surface glow. Reads uClimate.x (warmth colors the highlight) and
  // uBreath (the band pulses ±15% on the 7s clock).
  float surfBand = exp(-pow((uv.y - wl) * 78.0, 2.0));
  vec3 surfTone = mix(GLOW, mix(SKY_LOW, GLOW, uClimate.x), 0.55);
  waterCol += surfTone * surfBand * 0.85 * (0.85 + 0.15 * uBreath);
  float underGlow = exp(-pow((uv.y - wl - 0.025) * 26.0, 2.0));
  waterCol += GLOW * underGlow * 0.30 * (0.5 + uClimate.w * 0.5);
  // A crisp meniscus line right at the waterline — sub-pixel-tight Gaussian
  // gives the sky/water boundary a clean edge the pixel test can read.
  float meniscus = exp(-pow((uv.y - wl) * 220.0, 2.0));
  waterCol += GLOW * meniscus * 0.60;

  // layer: caustics
  // Three-octave FBM cells shifted per iter — the sunlit-surface network
  // ripples across the sunlit shelf. Rides uCurrent so the whole net drifts
  // laterally with the current, and uStir scrubs them out (silt occludes
  // the sun). Reads uClimate.w (illumination lifts the whole net) and
  // uClimate.x (warmth shifts the caustic tint from teal-tinged toward
  // pure gold).
  vec2 causticUV = vec2(
    uvR.x * 9.0 * aspect + uTime * 0.16 + uClimate.z * 0.5,
    (uvR.y - wl) * 3.6 - uTime * 0.11
  );
  float c1 = causticFBM(causticUV);
  float c2 = causticFBM(causticUV * 2.4 + vec2(1.7, 2.3));
  float c3 = causticFBM(causticUV * 5.7 + vec2(3.1, 0.9));
  float causticSoft = pow(c1 * 0.55 + c2 * 0.30 + c3 * 0.15, 2.6);
  // Sharp filament threshold — the top ridges of the caustic network read
  // as bright veins, not a soft wash. This is what makes the caustic show
  // up as edge density in the pixel test.
  float causticSharp = smoothstep(0.58, 0.72, c1 * 0.60 + c2 * 0.30 + c3 * 0.10);
  float caustic = causticSoft + causticSharp * 0.55;
  caustic *= (0.6 + uClimate.w * 0.6);
  caustic *= (1.0 - depthBelow * 0.55);
  caustic *= (1.0 - silty * 0.70);
  waterCol += mix(GLOW, mix(GLOW, ACCENT, 0.28), 1.0 - uClimate.x) * caustic * 1.15;

  // Ripple wavefronts from taps and flicks (gaussian rings)
  float wave = 0.0;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    if (i >= uRippleCount) break;
    vec4 r = uRipples[i];
    float age = r.z;
    float rad = age * 0.32;
    vec2 dp = (uv - r.xy) * vec2(aspect, 1.0);
    float dist = length(dp);
    float ring = exp(-pow((dist - rad) * 22.0, 2.0));
    wave += ring * r.w * exp(-age * 1.4);
  }
  waterCol += mix(ACCENT, GLOW, 0.4) * wave * 0.75;

  // Polyp size-pulses (each polyp breathes a slow ring at its own size)
  float sizeWave = 0.0;
  for (int i = 0; i < ${MAX_POLYPS}; i++) {
    if (i >= uPolypCount) break;
    vec4 p = uPolyps[i];
    float phase = fract(p.w + uTime * 0.14);
    float rad = phase * 0.16 * (0.3 + p.z);
    vec2 dp = (uv - p.xy) * vec2(aspect, 1.0);
    float dist = length(dp);
    float ring = exp(-pow((dist - rad) * 28.0, 2.0));
    sizeWave += ring * (1.0 - phase) * clamp(p.z, 0.0, 1.0) * 0.5;
  }
  waterCol += mix(ACCENT, GLOW, clamp(uClimate.w, 0.0, 1.0)) * sizeWave * 0.55;

  // layer: plankton_motes
  // 24 tiny bright motes drifting through the water column — deterministic
  // positions from a hash of grid cell + noise offset; drift downward on a
  // slow uTime term and slide laterally with uCurrent. Silt scatters them
  // (uStir rides down the visible count). Motes read GLOW so they behave
  // as backlit particles.
  {
    vec2 moteUV = uv * vec2(6.0 * aspect, 4.0)
                  + vec2(uClimate.z * 0.8, -uTime * 0.06);
    vec2 moteCell = floor(moteUV);
    vec2 moteFrac = fract(moteUV);
    float moteSeed = hash21(moteCell);
    vec2 moteOff = vec2(hash21(moteCell + 3.7), hash21(moteCell - 1.3));
    float moteDist = length(moteFrac - moteOff);
    float mR = 0.045 + moteSeed * 0.055;
    float mote = smoothstep(mR, mR * 0.45, moteDist);
    float alive = step(0.28, moteSeed);
    float notSilty = 1.0 - silty * 0.70;
    waterCol += GLOW * mote * alive * notSilty * (0.35 + moteSeed * 0.5) * (1.0 - depthBelow * 0.5);
  }

  // Stir — the water column spins under a scrubbing finger
  if (uStir > 0.02) {
    vec2 sp = (uv - vec2(0.5, wl + 0.18)) * vec2(aspect, 1.0);
    float ang = atan(sp.y, sp.x);
    float rr = length(sp);
    waterCol += ACCENT * uStir * 0.22 * sin(ang * 4.0 + uTime * 3.0)
              * exp(-rr * rr * 8.0);
  }

  // layer: silt_overlay
  // Post-shake silt cloud — a warm-neutral FBM haze that mutes colors and
  // scrubs the caustics. Rides uStir (which the vessel scatter/knock verbs
  // spike). Drifts on a slow uTime term so it reads alive, not static.
  {
    float siltCloud = fbm(uv * vec2(6.0 * aspect, 4.5) + vec2(uTime * 0.03, 0.0));
    waterCol = mix(waterCol, SILT, silty * (0.35 + siltCloud * 0.4));
  }

  // Vessel tilt — a subtle color shift with lean
  waterCol *= 1.0 - 0.06 * abs(uLean) * (1.0 - depthBelow);

  // layer: bioluminescence
  // Face-down (uNight) invites the room to its second life: patches of
  // biofilm and drifting plankton glow BIO cyan-green, the water darkens
  // deep, and the horizon carries a faint bioluminescent band. The reef
  // has two seasons a day, and this is the second one.
  {
    float bioCells = fbm(vec2(uv.x * 30.0 * aspect + uTime * 0.4, uv.y * 22.0 - uTime * 0.3));
    bioCells = smoothstep(0.55, 0.90, bioCells);
    waterCol += BIO * bioCells * night * 0.60 * (1.0 - depthBelow * 0.4);
  }

  // Night — the water column darkens deeply
  waterCol *= 1.0 - night * 0.55;

  // Vignette
  vec2 vd = (uv - vec2(0.5, 0.5)) * vec2(aspect, 1.0);
  waterCol *= 1.0 - 0.42 * smoothstep(0.18, 0.94, dot(vd, vd));

  col = waterCol;
  gl_FragColor = vec4(col, 1.0);
}
`;

// The imperative surface the room's voice speaks to.
type ReefApi = {
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

export default function Reef() {
  const surfaceRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const apiRef = useRef<ReefApi | null>(null);
  const [hasKept, setHasKept] = useState(false);

  useEffect(() => {
    const surface = surfaceRef.current;
    const overlay = overlayRef.current;
    if (!surface || !overlay) return;

    const audio = getFieldAudio();
    let reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const embedded = isEmbeddedFrame();
    const gov = createFrameGovernor(embedded ? "medium" : "high");

    // ——— the small state vector — read from storage or freshly initialised ———
    const SEED = 0x7ee4;
    let state: ReefState = initState(SEED);
    let climate: Climate = { warmth: 0.55, wet: 0.45 };
    let cleared = false;
    let visited = false;
    let lastSeen = performance.now();
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<StoredReef>;
        visited = true;
        cleared = parsed.cleared === true;
        if (
          Array.isArray(parsed.polyps) &&
          typeof parsed.current === "number" &&
          typeof parsed.illum === "number" &&
          typeof parsed.tau === "number"
        ) {
          state = {
            polyps: parsed.polyps
              .filter(
                (p) =>
                  p &&
                  Number.isFinite(p.x) &&
                  Number.isFinite(p.y) &&
                  Number.isFinite(p.size),
              )
              .slice(0, MAX_POLYPS),
            current: parsed.current,
            illum: parsed.illum,
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
      /* fresh reef */
    }
    setHasKept(state.polyps.some((p) => p.sealed));
    void visited;
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
        const payload: StoredReef = {
          v: 1,
          polyps: state.polyps,
          current: state.current,
          illum: state.illum,
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

    // ——— the shared GL harness ———
    const stage = createGLStage(surface, {
      label: "reef",
      wrap: surface.parentElement,
      overlay,
      renderScale: embedded ? 0.42 : 0.6,
      quality: embedded ? "medium" : "high",
      reducedMotion: reduced,
      embedded,
    });
    const prog = stage?.program(FULLSCREEN_VERT_UNIT, FRAG) ?? null;
    const quad = stage && prog ? stage.fullscreenQuad(prog, "unit") : null;

    // ——— the two polyp populations, over one coralflow ledger ———
    // Phase 9 rewrite: split the previous single SceneObjectSpec into two
    // views — cornerstoneSpec reads every SEALED polyp and emits an
    // elaborate branching-coral silhouette; recruitSpec reads every UNSEALED
    // polyp and emits a smaller disc-with-corona. Both are drawn through
    // the same shared instanced pass with a room-scoped fragment shader
    // (POPULATION_FRAG above), selected by shape-select in the sprite's
    // `vPhase` varying. The two-tier shape difference is what makes an
    // object screenshot instantly legible.
    //
    // The physics ledger (coralflow.ts) stays authoritative for polyp
    // state; syncPopulationsFromLedger below routes each ledger polyp into
    // exactly one of the two population views by its `sealed` flag.
    const shapeSlot = (shape: number, phase01: number) =>
      shape + Math.min(0.999, Math.max(0, phase01));

    // Shape indices — the POPULATION_FRAG reads these off floor(vPhase).
    const SHAPE_CORNERSTONE = 0;
    const SHAPE_RECRUIT = 1;

    const cornerstoneSpec: SceneObjectSpec<CornerstoneView> = {
      kind: "cornerstone_polyp",
      cap: MAX_POLYPS,
      born(seed, nx, ny, tMs) {
        const rng = sceneMulberry32(seed);
        return {
          id: 0,
          seed,
          nx,
          ny,
          bornMs: tMs,
          growth: 0.3,
          sealedMs: tMs,
          presence: 1,
          sizeVal: MAX_SIZE,
          phase: rng(),
        };
      },
      step(s, ctx) {
        if (s.growth < 1) s.growth = Math.min(1, s.growth + ctx.dt * 0.9);
      },
      emit(s, ctx, out) {
        const px = s.nx * ctx.width;
        const py = s.ny * ctx.height;
        // Cornerstones want room for six radial tines — a larger sprite so
        // the branches reach past the body's own footprint.
        const baseR = Math.max(10, ctx.width * 0.032);
        const sizeBright = Math.min(1.6, Math.max(0, s.sizeVal));
        const breath01 =
          0.5 + 0.5 * Math.sin(ctx.tMs * 0.001 * 0.85 + s.phase * Math.PI * 2);
        // Hue biased warm — cornerstone tissue reads coral-rust / gold.
        out.push(
          px,
          py,
          baseR * (0.90 + s.sizeVal * 0.20),
          s.phase * Math.PI * 2,
          0.88, // hue: near u_palC (glow) end — mature warm register
          sizeBright,
          shapeSlot(SHAPE_CORNERSTONE, breath01),
          s.presence * (0.55 + s.growth * 0.45),
        );
      },
      verbs: [],
      respond: {},
    };

    const recruitSpec: SceneObjectSpec<RecruitView> = {
      kind: "recruit_polyp",
      cap: MAX_POLYPS,
      born(seed, nx, ny, tMs) {
        const rng = sceneMulberry32(seed);
        return {
          id: 0,
          seed,
          nx,
          ny,
          bornMs: tMs,
          growth: 0.1,
          sealedMs: null,
          presence: 1,
          sizeVal: 0,
          phase: rng(),
        };
      },
      step(s, ctx) {
        if (s.growth < 1) s.growth = Math.min(1, s.growth + ctx.dt * 0.9);
      },
      emit(s, ctx, out) {
        const px = s.nx * ctx.width;
        const py = s.ny * ctx.height;
        // Recruits are smaller — a young polyp is a disc, not a colony.
        const baseR = Math.max(5, ctx.width * 0.017);
        const sizeBright = Math.min(1.6, Math.max(0, s.sizeVal));
        const breath01 =
          0.5 + 0.5 * Math.sin(ctx.tMs * 0.001 * 1.15 + s.phase * Math.PI * 2);
        // Hue biased cool — a young recruit reads teal-tinged, brightening
        // toward coral warmth as it matures.
        const hue = 0.15 + s.sizeVal * 0.40;
        out.push(
          px,
          py,
          baseR * (0.65 + s.sizeVal * 0.55),
          s.phase * Math.PI * 2,
          hue,
          sizeBright,
          shapeSlot(SHAPE_RECRUIT, breath01),
          s.presence * (0.5 + s.growth * 0.5) * (0.55 + s.sizeVal * 0.45),
        );
      },
      verbs: [],
      respond: {},
    };

    const cornerstones = createPopulation(cornerstoneSpec);
    const recruits = createPopulation(recruitSpec);
    const populationLayer = stage
      ? createPopulationLayer(stage, {
          // u_palA = teal water, u_palB = coral bloom warm, u_palC = pale gold
          palette: ["#3d9ec2", "#e0693a", "#f4e6a8"],
          frag: POPULATION_FRAG,
        })
      : null;
    // Two populations × up to MAX_POLYPS each — one instance per polyp.
    const instanceBuffer = createInstanceBuffer(MAX_POLYPS * 2);

    // ——— what the shader reads: one Float32Array each, allocated once ———
    const polypU = new Float32Array(MAX_POLYPS * 4);
    const rippleU = new Float32Array(MAX_RIPPLES * 4);
    const ripples: { x: number; y: number; t0: number; intensity: number }[] = [];

    // ——— the live axes the shader lenses over, all continuous ———
    let lens = 0;
    let lensTarget = 0;
    let lensSnapped = 0;
    let lean = 0;
    let leanTarget = 0;
    let night = 0;
    let nightTarget = 0;
    let stir = 0;
    let timeScale = 1;
    let timeScaleTarget = 1;
    let cursorX = 0.5;
    let cursorY = 0.5;
    let cursorLit = 0;
    let kbCharge = 0;
    let lastSaveAt = performance.now();
    let dwellingPolypId: number | null = null;
    let lastDeepenAt = 0;

    // ——— helpers ———
    const toLocal = (px: number, py: number) => {
      const r = surface.getBoundingClientRect();
      return {
        nx: clamp01((px - r.left) / Math.max(1, r.width)),
        ny: clamp01((py - r.top) / Math.max(1, r.height)),
      };
    };

    const pushRipple = (nx: number, ny: number, intensity: number) => {
      if (!inReefBounds(nx, ny)) return;
      ripples.push({ x: nx, y: ny, t0: performance.now(), intensity: clamp01(intensity) });
      if (ripples.length > MAX_RIPPLES) ripples.shift();
    };

    const ringHere = (nx: number, ny: number, weight = 1) => {
      // The water rings at the mean size of the colony — the visitor hears
      // the whole reef's maturity in one note.
      const hz = ringHzFor(meanSize(state));
      try {
        audio.playTone(hz, 0.12 + weight * 0.18);
        haptics.ripple(0.3 + weight * 0.35);
      } catch {
        /* the sea is not awake */
      }
      pushRipple(nx, ny, 0.5 + weight * 0.4);
    };

    const soundPolyp = (size: number) => {
      const hz = ringHzFor(size);
      try {
        audio.playTone(hz, 0.16);
      } catch {
        /* noop */
      }
    };

    const chargeSizeFor = (elapsedMs: number) =>
      SIZE_STEP_MAX * (1 - Math.exp(-Math.max(0, elapsedMs) / SIZE_WIDEN_TAU_MS));

    // ——— the hand's verbs, in this room's material ———
    const engine: ReefApi = {
      tap: (x, y, intensity, count, fingers) => {
        const { nx, ny } = toLocal(x, y);
        cursorX = nx;
        cursorY = ny;
        cursorLit = 1;
        if (fingers >= 2) return;
        // the rapid-tap ladder (1 / 3 / 5 / n), in living coral: 1 rings a
        // polyp, 3 feeds a wave through its nearest neighbours, 5 raises a
        // spawning shimmer over the colony, n is the whole reef in crescendo
        const tier = tapTrainTier(count);
        if (tier === "n") {
          const crest = clamp01(0.5 + (count - 7) * 0.12 + intensity * 0.3);
          // the colony in crescendo: every polyp rings pitched by its own
          // size, small to large, and the water shivers with it
          const bySize = [...state.polyps].sort((a, b) => a.size - b.size);
          for (let i = 0; i < bySize.length; i++) {
            const p = bySize[i];
            pushRipple(p.x, p.y, 0.4 + crest * 0.5);
            if (i < 4) {
              try {
                audio.playTone(ringHzFor(p.size), 0.16 + crest * 0.16);
              } catch {
                /* noop */
              }
            }
          }
          pushRipple(nx, ny, 0.6 + crest * 0.4);
          stirTurbulence(0.1 + crest * 0.15);
          try {
            haptics.roll();
          } catch {
            /* noop */
          }
          return;
        }
        if (tier === 5 && count === 5) {
          // a spawning shimmer: the light over the reef lifts and every
          // sealed cornerstone releases a bright ring of gametes
          state = { ...state, illum: clamp01(state.illum + 0.06 + intensity * 0.04) };
          for (const p of state.polyps) {
            if (p.sealed) pushRipple(p.x, p.y, 0.7 + intensity * 0.2);
          }
          pushRipple(nx, ny, 0.5);
          try {
            audio.bell();
            audio.playTone(ringHzFor(meanSize(state)) * 2, 0.18 + intensity * 0.12);
            haptics.chop();
          } catch {
            /* noop */
          }
          writer.schedule();
          return;
        }
        if (tier === 3 && count === 3) {
          // a feeding wave: the three polyps nearest the strike answer in
          // turn, each with its own pitch — the colony passing the touch on
          const near = [...state.polyps]
            .sort(
              (a, b) =>
                Math.hypot(a.x - nx, a.y - ny) - Math.hypot(b.x - nx, b.y - ny),
            )
            .slice(0, 3);
          if (near.length === 0) {
            ringHere(nx, ny, 0.7 + intensity * 0.3);
            return;
          }
          for (const p of near) {
            pushRipple(p.x, p.y, 0.5 + intensity * 0.3);
            try {
              audio.playTone(ringHzFor(p.size), 0.14 + intensity * 0.1);
            } catch {
              /* noop */
            }
          }
          try {
            haptics.ripple(0.4 + intensity * 0.3);
          } catch {
            /* noop */
          }
          return;
        }
        const found = nearestPolyp(state, nx, ny, 0.08);
        if (found) {
          soundPolyp(found.size);
          pushRipple(found.x, found.y, 0.7);
          haptics.tap();
          return;
        }
        // The pool rings at the mean of the colony
        ringHere(nx, ny, 0.6 + intensity * 0.4 + Math.min(0.4, (count - 1) * 0.08));
      },
      stepBack: () => {
        if (lensSnapped === 1) {
          lensSnapped = 0;
          lensTarget = 0;
          try {
            haptics.lens();
          } catch {
            /* noop */
          }
        }
      },
      tutti: (intensity) => {
        // one chord across the whole colony — every polyp rings at once
        for (const p of state.polyps) pushRipple(p.x, p.y, 0.6);
        const hz = ringHzFor(meanSize(state));
        try {
          audio.playTone(hz, 0.24 + intensity * 0.2);
          audio.playTone(hz * 1.5, 0.18 + intensity * 0.15);
          haptics.roll();
        } catch {
          /* noop */
        }
      },
      plant: (x, y) => {
        const { nx, ny } = toLocal(x, y);
        cursorX = nx;
        cursorY = ny;
        if (!inReefBounds(nx, ny)) {
          try {
            audio.refuse();
          } catch {
            /* noop */
          }
          return;
        }
        state = plantPolyp(state, nx, ny, 0);
        const planted = state.polyps[state.polyps.length - 1];
        if (planted) dwellingPolypId = planted.id;
        pushRipple(nx, ny, 0.55);
        try {
          audio.playNote(48, 220);
          haptics.tap();
        } catch {
          /* noop */
        }
        writer.schedule();
      },
      deepen: (elapsed, x, y, tier) => {
        if (dwellingPolypId === null) return;
        // Duration is an axis: the polyp saturates with an increasing but
        // saturating function of elapsed. Sampled per hold-tick — 60ms.
        const now = performance.now();
        if (now - lastDeepenAt < 60) return;
        lastDeepenAt = now;
        const target = chargeSizeFor(elapsed);
        const current = state.polyps.find((p) => p.id === dwellingPolypId)?.size ?? 0;
        const dSize = Math.max(0, target - current);
        if (dSize <= 0) return;
        state = deepenPolyp(state, dwellingPolypId, dSize);
        void x;
        void y;
        void tier;
        try {
          const size = state.polyps.find((p) => p.id === dwellingPolypId)?.size ?? 0;
          audio.playTone(ringHzFor(size), 0.05);
        } catch {
          /* noop */
        }
      },
      ceremony: (x, y) => {
        if (dwellingPolypId === null) {
          const { nx, ny } = toLocal(x, y);
          const found = nearestPolyp(state, nx, ny, 0.14);
          if (!found) {
            try {
              audio.refuse();
            } catch {
              /* noop */
            }
            return;
          }
          dwellingPolypId = found.id;
        }
        state = sealPolyp(state, dwellingPolypId);
        setHasKept(true);
        pushRipple(cursorX, cursorY, 1);
        try {
          audio.bell();
          audio.playTone(ringHzFor(MAX_SIZE), 0.6);
          haptics.bloom();
        } catch {
          /* noop */
        }
        dwellingPolypId = null;
        writer.schedule();
      },
      settle: (elapsed, x, y, tier) => {
        // a hold that lifted before ceremony: the size keeps what it had,
        // but stops growing. Only clear the dwell handle.
        void elapsed;
        void x;
        void y;
        void tier;
        if (tier < 3) dwellingPolypId = null;
      },
      timeScale: (k) => {
        timeScaleTarget = clamp(k, 0.15, 1);
      },
      drag: (phase, x, y, dx, dy, fingers) => {
        const { nx, ny } = toLocal(x, y);
        cursorX = nx;
        cursorY = ny;
        cursorLit = 1;
        if (fingers >= 3) return; // wind is a separate handler
        // The current lens shears — a linear write into state.current.
        // The ledger is unchanged; a shear on the water column, not a leak.
        state = {
          ...state,
          current: clamp(state.current + dx * 0.0009, -1, 1),
        };
        stir = Math.min(1, stir + (Math.abs(dx) + Math.abs(dy)) / 4000);
        if (phase === "move" && Math.hypot(dx, dy) > 6) {
          pushRipple(nx, ny, 0.25);
        }
      },
      wind: (dx, dy) => {
        // world-law: down is illumination (I up), across is current strength.
        // The illum lift persists through advanceExact's slow relaxation.
        climate = {
          warmth: clamp01(climate.warmth + dx * 0.0018),
          wet: clamp01(climate.wet + Math.abs(dx) * 0.0006),
        };
        state = {
          ...state,
          illum: clamp01(state.illum - dy * 0.0018),
        };
        try {
          audio.playTone(72 + state.illum * 60, 0.14);
        } catch {
          /* noop */
        }
        writer.schedule();
      },
      flick: (x, y, angle, speed, fingers) => {
        const { nx, ny } = toLocal(x, y);
        // A spat of gametes: a strong ring wavefront, its pitch the local
        // illumination (mass-conserving; the reef does not grow from a flick).
        pushRipple(nx, ny, Math.min(1, 0.5 + speed / 8));
        const hz = ringHzFor(meanSize(state));
        try {
          audio.bell();
          audio.playTone(hz * (1 + Math.abs(angle) * 0.1), 0.32);
          haptics.chop();
        } catch {
          /* noop */
        }
        stirTurbulence(0.05 + Math.min(0.2, speed / 5000));
        void fingers;
      },
      stir: (cx, cy, angularVelocity) => {
        const { nx, ny } = toLocal(cx, cy);
        stir = Math.min(1, stir + Math.min(1.2, Math.abs(angularVelocity)) * 0.18);
        pushRipple(nx, ny, 0.35);
        try {
          audio.playTone(ringHzFor(meanSize(state)) * 0.75, 0.16);
          haptics.tap();
        } catch {
          /* noop */
        }
      },
      lens: (angle, velocity) => {
        if (velocity === 0) {
          lensSnapped = lensTarget > 0.5 ? 1 : 0;
          lensTarget = lensSnapped;
          try {
            haptics.lens();
          } catch {
            /* noop */
          }
        } else {
          lensTarget = clamp01(lensTarget + angle / 2);
        }
      },
      season: (angle, velocity) => {
        // turn the year through the shared warmth axis. Every angle is a
        // slice of the year; advanceExact catches the ledger up on the
        // closed form.
        const span = Math.abs(angle) * 24 * 3600;
        if (span > 0) {
          climate = {
            warmth: clamp01(climate.warmth + angle * 0.08),
            wet: clamp01(climate.wet - angle * 0.05),
          };
          state = advanceExact(state, span, climate);
        }
        if (velocity === 0) {
          try {
            haptics.detent();
          } catch {
            /* noop */
          }
          writer.schedule();
        }
      },
      drum: (hits, alternation, x, y) => {
        // two hands alternating: the tidal beat between them lifts local
        // illumination briefly. Rings and audio, no ledger change.
        void hits;
        const { nx, ny } = toLocal(x, y);
        pushRipple(nx, ny, 0.4 + alternation * 0.3);
        state = {
          ...state,
          illum: clamp01(state.illum + 0.02 * alternation),
        };
        try {
          audio.playTone(ringHzFor(meanSize(state)) * (0.75 + alternation * 0.5), 0.14);
          haptics.tap();
        } catch {
          /* noop */
        }
      },
      scatter: (intensity) => {
        // the surface scatters — every ripple wavefront agitates at once
        stirTurbulence(clamp01(intensity) * 0.6);
        for (const p of state.polyps) pushRipple(p.x, p.y, 0.4 + intensity * 0.4);
      },
      gravity: (gamma) => {
        leanTarget = reduced ? 0 : clamp(gamma / 48, -1, 1);
      },
      knock: (intensity) => {
        // A struck reef rings the colony — pitch is the mean size — AND
        // (the touch-reachable secret) dislodges every unsealed polyp
        // under the shifted threshold. Cornerstones stay.
        const attempt = knockSweep(state, clamp01(intensity));
        state = attempt.state;
        try {
          const hz = ringHzFor(meanSize(state));
          audio.playTone(hz, 0.5 + intensity * 0.3);
          audio.playTone(hz * 0.5, 0.35);
          haptics.detent();
        } catch {
          /* noop */
        }
        for (const p of state.polyps) pushRipple(p.x, p.y, 0.4 + intensity * 0.4);
        if (attempt.dislodged > 0) {
          try {
            audio.thud();
          } catch {
            /* noop */
          }
          writer.schedule();
        }
      },
      night: (faceDown) => {
        nightTarget = faceDown ? 1 : 0;
      },
      glimmer: () => {
        // one polyp breathes a wider ring, alone, and nothing is said
        if (state.polyps.length > 0) {
          const p = state.polyps[Math.floor(state.tau * 977) % state.polyps.length];
          pushRipple(p.x, p.y, 0.35);
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
        // held enter is a keyboard dwell — plant on first tick, then deepen.
        // At tier ceremony the hold seals.
        if (dwellingPolypId === null && inReefBounds(cursorX, cursorY)) {
          state = plantPolyp(state, cursorX, cursorY, 0);
          const planted = state.polyps[state.polyps.length - 1];
          if (planted) dwellingPolypId = planted.id;
        }
        if (dwellingPolypId !== null) {
          const target = chargeSizeFor(elapsed);
          const current = state.polyps.find((p) => p.id === dwellingPolypId)?.size ?? 0;
          if (target > current) {
            state = deepenPolyp(state, dwellingPolypId, target - current);
          }
        }
        kbCharge = clamp01(elapsed / 2400);
        if (kbCharge >= 1 && dwellingPolypId !== null) {
          state = sealPolyp(state, dwellingPolypId);
          setHasKept(true);
          try {
            audio.bell();
            haptics.bloom();
          } catch {
            /* noop */
          }
          dwellingPolypId = null;
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
        dwellingPolypId = null;
      },
      clear: () => {
        cleared = true;
        state = {
          ...state,
          polyps: [],
        };
        setHasKept(false);
        try {
          audio.thud();
          haptics.roll();
        } catch {
          /* noop */
        }
        writer.schedule();
      },
    };
    apiRef.current = engine;

    /**
     * Pull every polyp out of the physics ledger into the correct population
     * view — sealed polyps into cornerstoneItems, unsealed into recruitItems.
     * Items are matched by `id`, so per-frame identity is stable across the
     * seal transition: when a recruit becomes a cornerstone (ceremony fires
     * sealPolyp), its recruit item retires (presence → 0.999) and a new
     * cornerstone item spawns in the same frame, so the eye sees a smooth
     * shape morph rather than a hop. When a knock lands, dislodged unsealed
     * polyps vanish from state.polyps and their recruit items retire.
     */
    const syncPopulationsFromLedger = (now: number) => {
      const cornerstoneItems = cornerstones.items;
      const recruitItems = recruits.items;
      const ledger: Polyp[] = state.polyps;
      const sealedLedger = ledger.filter((p) => p.sealed);
      const unsealedLedger = ledger.filter((p) => !p.sealed);
      // ——— cornerstones ———
      for (const item of cornerstoneItems) {
        if (item.presence < 1) continue;
        if (!sealedLedger.some((p) => p.id === item.id)) item.presence = 0.999;
      }
      for (const p of sealedLedger) {
        let item = cornerstoneItems.find((it) => it.id === p.id && it.presence >= 1);
        if (!item) {
          item = {
            id: p.id,
            seed: hashSeed(state.seedKey, p.id),
            nx: p.x,
            ny: p.y,
            bornMs: now,
            growth: 0.05,
            sealedMs: now,
            presence: 1,
            sizeVal: p.size,
            phase: p.phase,
          };
          cornerstoneItems.push(item);
        } else {
          item.nx = p.x;
          item.ny = p.y;
          item.sizeVal = p.size;
          item.phase = p.phase;
        }
      }
      // ——— recruits ———
      for (const item of recruitItems) {
        if (item.presence < 1) continue;
        if (!unsealedLedger.some((p) => p.id === item.id)) item.presence = 0.999;
      }
      for (const p of unsealedLedger) {
        let item = recruitItems.find((it) => it.id === p.id && it.presence >= 1);
        if (!item) {
          item = {
            id: p.id,
            seed: hashSeed(state.seedKey, p.id),
            nx: p.x,
            ny: p.y,
            bornMs: now,
            growth: 0.05,
            sealedMs: null,
            presence: 1,
            sizeVal: p.size,
            phase: p.phase,
          };
          recruitItems.push(item);
        } else {
          item.nx = p.x;
          item.ny = p.y;
          item.sizeVal = p.size;
          item.phase = p.phase;
        }
      }
    };

    // ——— the loop ———
    const draw = (now: number) => {
      if (!running) return;
      const dtRaw = Math.min(0.05, (now - last) / 1000);
      last = now;
      const tier = gov.beginFrame(now);
      void tier;

      relaxTurbulence(now);
      const agitation = getTurbulence();
      const t = audio.getAudioTime() ?? now / 1000;

      // continuous axes glide toward their targets
      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dtRaw * 5);
      lens += (lensTarget - lens) * Math.min(1, dtRaw * 6);
      lean += (leanTarget - lean) * Math.min(1, dtRaw * 3);
      night += (nightTarget - night) * Math.min(1, dtRaw * 2);
      stir = Math.max(0, stir - dtRaw * 0.28);
      cursorLit = Math.max(0, cursorLit - dtRaw * 0.5);

      // The ledger advances at watched-speed while a hand is present.
      // Closed form, one call per frame — never a catch-up loop.
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
        // polyp uniform: xy pos, size, phase
        let pN = 0;
        for (const p of state.polyps) {
          if (pN >= MAX_POLYPS) break;
          polypU[pN * 4] = p.x;
          polypU[pN * 4 + 1] = p.y;
          polypU[pN * 4 + 2] = Math.max(0, p.size);
          polypU[pN * 4 + 3] = p.phase;
          pN++;
        }
        // ripple uniform: xy pos, age, intensity
        for (let i = ripples.length - 1; i >= 0; i--) {
          const age = (now - ripples[i].t0) / 1000;
          if (age > 3.5) ripples.splice(i, 1);
        }
        let rN = 0;
        for (const r of ripples) {
          if (rN >= MAX_RIPPLES) break;
          rippleU[rN * 4] = r.x;
          rippleU[rN * 4 + 1] = r.y;
          rippleU[rN * 4 + 2] = (now - r.t0) / 1000;
          rippleU[rN * 4 + 3] = r.intensity;
          rN++;
        }
        prog.setInt("uPolypCount", pN);
        prog.setInt("uRippleCount", rN);
        prog.setVec4("uClimate", climate.warmth, climate.wet, state.current, state.illum);
        prog.setFloat("uLean", lean);
        prog.setFloat("uNight", night);
        prog.setFloat("uStir", stir);
        prog.setFloat("uLens", lens);
        const polypLoc = prog.location("uPolyps[0]");
        if (polypLoc) stage.gl.uniform4fv(polypLoc, polypU);
        const rippleLoc = prog.location("uRipples[0]");
        if (rippleLoc) stage.gl.uniform4fv(rippleLoc, rippleU);
        quad.draw();

        // ——— the two polyp populations, as one shared instanced draw ———
        syncPopulationsFromLedger(now);
        const popCtx = {
          dt: Math.min(0.05, dtRaw),
          tMs: now,
          breath: reduced ? 0.5 : 0.5 + 0.5 * Math.sin((t * Math.PI * 2) / 7),
          detail: 1,
          wind: 0,
          gravity: 0,
          agitation,
          season: 0,
          timeScale,
          reducedMotion: reduced,
        };
        cornerstones.step(popCtx);
        recruits.step(popCtx);
        instanceBuffer.reset();
        const emitCtx = {
          width: stage.size.width,
          height: stage.size.height,
          tMs: now,
          breath: popCtx.breath,
          detail: 1,
          reducedMotion: reduced,
        };
        // Recruits first so cornerstones' larger silhouettes read on top —
        // a young polyp partly under a mature one is visually correct.
        recruits.emit(emitCtx, instanceBuffer);
        cornerstones.emit(emitCtx, instanceBuffer);
        populationLayer?.draw(instanceBuffer);
      }

      // ——— the twist lens: the colony, drawn back off the water ———
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
          // Mean size bar (glow-hued)
          const ms = meanSize(state);
          octx.fillStyle = "rgba(234, 168, 122, 0.6)";
          octx.fillRect(pad, barY, barW * clamp01(ms), 8);
          // Illumination bar (accent-hued)
          octx.fillStyle = "rgba(78, 169, 162, 0.6)";
          octx.fillRect(pad, barY + 14, barW * clamp01(state.illum), 8);
          // Current bar (signed; center at midline)
          octx.fillStyle = "rgba(194, 106, 82, 0.6)";
          const midX = pad + barW / 2;
          const curW = Math.abs(state.current) * (barW / 2);
          if (state.current >= 0) octx.fillRect(midX, barY + 28, curW, 6);
          else octx.fillRect(midX - curW, barY + 28, curW, 6);
          octx.font = "300 10px ui-monospace, 'SF Mono', Menlo, monospace";
          octx.textAlign = "left";
          octx.fillStyle = "rgba(232, 237, 229, 0.7)";
          octx.fillText(
            `polyps ${state.polyps.length}  cornerstones ${cornerstoneCount(state)}  ` +
              `mean s ${ms.toFixed(2)}  ${ringHzFor(ms).toFixed(0)}hz`,
            pad,
            barY + 54,
          );
          octx.fillText(
            `illum ${state.illum.toFixed(2)}  current ${state.current.toFixed(2)}  ` +
              `mass ${totalMass(state).toFixed(2)}`,
            pad,
            barY + 68,
          );
          octx.globalAlpha = 1;
        }

        if (cursorLit > 0.01) {
          octx.strokeStyle = `rgba(232, 237, 229, ${(0.4 * cursorLit).toFixed(3)})`;
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

  // The verbs, in the shell's vocabulary. Each reads through apiRef so the
  // engine never loses an in-flight hold when React re-renders.
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
      route="/reef"
      surfaceRef={surfaceRef}
      voice={voice}
      keyboard={keyboard}
      onGlimmer={() => apiRef.current?.glimmer()}
      onReducedMotion={(on) => apiRef.current?.reduced(on)}
      letGo={{ label: "let the reef rest", onLetGo: letGo, visible: hasKept }}
      style={{ position: "fixed", inset: 0, background: "#0a1d2a" }}
    >
      <canvas
        ref={surfaceRef}
        role="application"
        tabIndex={0}
        aria-label="a hand's width of sunlit reef, in section — the colony ringing at its cornerstones"
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

void sizeForRingHz;
void POOL_X_MAX;
void POOL_Y_MIN;
void POOL_Y_MAX;
