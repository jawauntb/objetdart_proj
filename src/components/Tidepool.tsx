// object-compiler template — docs/plans/object-compiler.md M3.
// Consumes: spec.key, spec.route, spec.storage_key, spec.palette.bg,
//           ComponentName (PascalCase of key), spec.aria_label, plus the
//           three synthesized spec.life.* wires (breath_uniform_wire,
//           idle_writer_setup, idle_writer_cleanup) produced by
//           render-template.py's preprocess_spec from spec.life.
// Three LLM slots carry the creative work here (shader, verbs, population);
// two more (domain, pins) land in sibling files. The boilerplate is verbatim.
"use client";

/**
 * /tidepool — the tide pool — pocket, kept between the swells. See docs/plans/object-compiler.md
 * §"Three creative slots" for what belongs in each slot.
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
// __SLOT_DOMAIN_IMPORTS__
import {
  ANEMONE_CAP,
  ANEMONE_PITCH_BASE_HZ,
  H_AMP,
  H_MEAN,
  HOLLOW_Y_MIN,
  KELP_CAP,
  MAX_BIOMASS,
  MAX_CREATURES,
  POOL_X_MAX,
  POOL_X_MIN,
  POOL_Y_MAX,
  POOL_Y_MIN,
  RIM_Y_MAX,
  SHELF_Y_MIN,
  SNAIL_CAP,
  SNAIL_PITCH_BASE_HZ,
  STORM_THRESHOLD,
  TIDE_PERIOD_S,
  advanceExact,
  breathWarm,
  ceremonyPlantAnemone,
  countOfKind,
  currentState,
  deepenCreature,
  hashSeed,
  inPoolBounds,
  initState,
  keeperCount,
  kindForDwell,
  knockStartle,
  meanBiomass,
  nearestCreature,
  plantCreature,
  relaxTransients,
  reproduceCreature,
  ringHzFor,
  sealCreature,
  setAnemoneCurl,
  stateWeights,
  totalBiomass,
  waterLevel,
  overtoppingIntensity,
  zoneAt,
  type Climate,
  type Creature,
  type CreatureKind,
  type PoolState,
} from "@/lib/tidewater";

/** Persistence key — versioned; a schema change bumps the suffix. */
const STORE_KEY = "objetdart:tidepool:v1";
/** How often the idle writer flushes to storage while a hand is present. */
const SAVE_EVERY_MS = 4000;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);

/** The transient wavefronts the shader draws across the pool surface. */
const MAX_RIPPLES = 24;

/**
 * The population-layer fragment shader, room-specialized for the tide pool's
 * three species. The shared SPRITE_VERT (in `@/lib/scene/population-layer`)
 * declares five varyings — `vLocal` (the sprite-local -1.9..1.9 quad
 * coordinate, unrotated), `vHue`, `vGlow`, `vPhase`, `vAlpha` — plus the
 * three palette uniforms `u_palA` (ACCENT teal), `u_palB` (ACCENT2 coral),
 * `u_palC` (GLOW gold). We hijack `vPhase`'s integer part as a shape
 * selector (0 = snail spiral, 1 = anemone body, 2 = anemone tentacle
 * corona, 3 = kelp ribbon); the fractional part carries the sprite's
 * breath phase. `vGlow` carries a creature-specific parameter (curl for
 * anemones, bend for kelp, sealed weight for snails). Together this lets
 * every creature render its real silhouette in the shared instanced draw
 * instead of a generic SDF disc.
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

// Snail — an archimedean spiral shell + soft warm body. The spiral is
// evaluated in polar coords: log-r * turns - theta drops to zero exactly
// on the spiral curve, so smoothstep against |that| paints the shell's
// bands. sealed snails carry a brighter rim (via vGlow).
float sdfSnail(vec2 p, float sealedWeight, float breathPulse) {
  float r = length(p);
  if (r > 1.55) return 0.0;
  float theta = atan(p.y, p.x);
  // Body — a warm disc, slightly larger when sealed.
  float bodyR = 0.85 + sealedWeight * 0.12 + breathPulse * 0.04;
  float body = smoothstep(bodyR, bodyR * 0.55, r);
  // Spiral bands — 2.3 turns of a log-spiral.
  float turns = 2.3;
  float spiralArg = log(max(r, 0.02)) * turns - theta / 6.2832 * turns;
  float bandDist = abs(fract(spiralArg + 0.5) - 0.5);
  float band = smoothstep(0.16, 0.05, bandDist) * body * 0.85;
  // Central dark eye of the spiral.
  float eye = smoothstep(0.06, 0.10, r);
  return clamp(body * (0.62 + band * 0.55) * eye, 0.0, 1.0);
}

// Anemone body — a soft disc that shrinks to a small knot when curled.
// vGlow carries the curl scalar (0 = open, 1 = fully closed).
float sdfAnemoneBody(vec2 p, float curl, float breathPulse) {
  float r = length(p);
  float bodyR = mix(0.55, 0.22, curl) + breathPulse * 0.03;
  return smoothstep(bodyR, bodyR * 0.5, r);
}

// Anemone tentacles — N=8 radial rays. Ray length collapses toward zero
// as curl → 1 (storm state, tap-during-low-tide), and their width
// thickens into a tight knot so the collapse reads clearly.
float sdfAnemoneTentacles(vec2 p, float curl, float breathPulse) {
  float r = length(p);
  if (r < 0.30) return 0.0;
  float theta = atan(p.y, p.x);
  const float N = 8.0;
  float sector = 6.2832 / N;
  float phaseA = theta - floor(theta / sector + 0.5) * sector;
  float tentacleLen = mix(1.6, 0.55, curl) + breathPulse * 0.05;
  float tentacleWidth = mix(0.045, 0.11, curl);
  float alongRay = smoothstep(tentacleLen, 0.25, r);
  float crossRay = 1.0 - smoothstep(tentacleWidth * 0.5, tentacleWidth * 1.4, abs(phaseA) * (r + 0.2));
  return clamp(alongRay * crossRay, 0.0, 1.0);
}

// Kelp — vertical ribbon anchored at the sprite's bottom. vGlow carries
// the bend scalar (remapped from -1..1 to 0..1); the ribbon displaces
// horizontally more toward the tip than the base, and tapers upward so
// the frond has a felt weight.
float sdfKelp(vec2 p, float bendNorm, float breathPulse, float phase) {
  float bend = (bendNorm - 0.5) * 2.0;
  // Vertical position along the frond — the sprite's local y goes from
  // -1.9 (top) to +1.9 (bottom). Anchor at the bottom; tip at the top.
  float alongFrond = clamp((1.9 - p.y) / 3.4, 0.0, 1.0);
  float tipStrength = alongFrond * alongFrond;
  // Displaced x: more bend near the tip; sway rides the sprite phase.
  float sway = sin(phase * 6.2832 * 2.0 + breathPulse * 3.0) * 0.10;
  float dispX = p.x - (bend + sway) * (0.85 * tipStrength);
  // Ribbon width tapers from base to tip.
  float widthAtY = mix(0.28, 0.10, tipStrength);
  float ribbon = 1.0 - smoothstep(widthAtY * 0.55, widthAtY * 1.05, abs(dispX));
  // Vertical bounds — softly clip beyond the frond.
  float verticalMask = smoothstep(1.85, 1.55, abs(p.y));
  // A darker centerline down the frond suggests the midrib.
  float midrib = 1.0 - smoothstep(widthAtY * 0.15, widthAtY * 0.02, abs(dispX)) * 0.35;
  return clamp(ribbon * verticalMask * midrib, 0.0, 1.0);
}

void main() {
  float shapeF = floor(vPhase + 0.001);
  float subPhase = fract(vPhase);
  float breathPulse = 0.5 + 0.5 * sin(subPhase * 6.2832);
  vec3 c;
  float a = 0.0;
  if (shapeF < 0.5) {
    // snail spiral — a warm shell whose sealed rim reads brighter.
    float sealedWeight = clamp(vGlow, 0.0, 1.0);
    a = sdfSnail(vLocal, sealedWeight, breathPulse);
    c = pickPalette(vHue) * (0.7 + 0.55 * (1.0 - length(vLocal) * 0.4)) + u_palC * sealedWeight * 0.32;
  } else if (shapeF < 1.5) {
    // anemone body
    float curl = clamp(vGlow, 0.0, 1.0);
    a = sdfAnemoneBody(vLocal, curl, breathPulse);
    c = pickPalette(vHue) * (0.65 + 0.55 * (1.0 - length(vLocal) * 0.5));
  } else if (shapeF < 2.5) {
    // anemone tentacles
    float curl = clamp(vGlow, 0.0, 1.0);
    a = sdfAnemoneTentacles(vLocal, curl, breathPulse);
    c = pickPalette(vHue) * (0.55 + 0.5 * (1.0 - curl));
  } else {
    // kelp ribbon — teal-green, biased toward u_palA (accent teal) with a
    // slight u_palC (glow) tip highlight.
    float bendNorm = clamp(vGlow, 0.0, 1.0);
    a = sdfKelp(vLocal, bendNorm, breathPulse, subPhase);
    float tipMix = 1.0 - clamp(length(vLocal.xy - vec2(0.0, 1.5)) / 3.0, 0.0, 1.0);
    c = mix(u_palA, mix(u_palA, u_palC, 0.35), tipMix);
    c *= 0.55 + 0.35 * breathPulse;
  }
  a *= vAlpha;
  if (a <= 0.003) discard;
  gl_FragColor = vec4(c * a, a);
}
`;

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
uniform vec4  uRipples[${MAX_RIPPLES}]; // xy pos, z age (s), w intensity (0..1)
uniform int   uRippleCount;
/** state weights — x = low, y = high, z = mid, w = storm; sum to 1 */
uniform vec4  uState;
/** current climate — x = warmth, y = wet */
uniform vec2  uClimate;
uniform float uTide;      // seconds along the tide clock
uniform float uWaterY;    // current H(t) — the waterline y (normalized)
uniform float uBiofilm;   // 0..1 scalar the granite blooms with
uniform float uCurrent;   // signed lateral current [-1, 1] — kelp bends with it
uniform float uLean;      // vessel tilt
uniform float uNight;     // face-down: 0..1
uniform float uStir;      // scrub agitation
uniform float uLens;      // twist lens raise
uniform float uOvertop;   // 0..1 — ocean overtops rim, waves crash in

// The palette — six registers set once from the manifest.
// bg = deep water dark; bg2 = warm brown wet rock; glow = bright sunlit gold;
// accent = teal water (the shallow water column); accent2 = coral orange
// biofilm; ink = legible pale over the darkest tile.
const vec3 BG      = vec3(0.016, 0.071, 0.125);  // #041220 deep water dark
const vec3 BG2     = vec3(0.302, 0.180, 0.102);  // #4d2e1a warm brown rock
const vec3 GLOW    = vec3(1.000, 0.851, 0.478);  // #ffd97a bright sunlit gold
const vec3 ACCENT  = vec3(0.239, 0.620, 0.761);  // #3d9ec2 teal shallow water
const vec3 ACCENT2 = vec3(0.878, 0.478, 0.231);  // #e07a3b coral biofilm
const vec3 INK     = vec3(0.925, 0.937, 0.902);
const vec3 SKY     = vec3(0.612, 0.816, 0.910);  // day sky, glow-tinted at horizon
const vec3 SKY_HIGH = vec3(0.196, 0.376, 0.596); // upper sky, cooler
const vec3 FOAM    = vec3(0.965, 0.980, 0.960);  // storm foam

const float POOL_X_MIN = ${POOL_X_MIN.toFixed(3)};
const float POOL_X_MAX = ${POOL_X_MAX.toFixed(3)};
const float POOL_Y_MIN = ${POOL_Y_MIN.toFixed(3)};
const float POOL_Y_MAX = ${POOL_Y_MAX.toFixed(3)};
const float RIM_Y_MAX = ${RIM_Y_MAX.toFixed(3)};

// Hoskins hash + value noise + short FBM: the room's only non-physics.
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
// Three-octave caustic cell FBM — the sunlit-surface network the caustics ride.
// Kept separate so the caustic term is a real function of position, not a scalar
// per pixel, and reads distinct from the granite bloom FBM.
float causticFBM(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(1.7, 0.6); a *= 0.62; }
  return v;
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  float aspect = uRes.x / max(1.0, uRes.y);
  vec3 col;

  // layer: tidal_water_level
  // The waterline reads uWaterY directly — the shader and the physics
  // agree on where the water is. A small wave overlays uWaterY so the
  // surface reads alive; storm state (uState.w) adds chop and lifts the
  // mean. Reads uState.w and uTide. This is the load-bearing spatial
  // split of the whole room — every branch below tests uv.y against it.
  float wavelet = sin(uv.x * 18.0 + uTime * 1.2) * 0.005
                 + sin(uv.x * 41.0 - uTime * 0.7 + uTide * 0.2) * 0.003;
  float chop = uState.w * (sin(uv.x * 55.0 + uTime * 4.5) * 0.014
                           + sin(uv.x * 91.0 - uTime * 3.1) * 0.008);
  // layer: overtopping_crash
  // When the ocean climbs above the rim (uOvertop > 0), waves crash into
  // the pool — fast, higher-frequency chop, and a plume of foam right at
  // the waterline. Zero during the isolated regime, so the pool sits still
  // most of the cycle.
  float crash = uOvertop * (sin(uv.x * 82.0 + uTime * 9.0) * 0.010
                          + sin(uv.x * 141.0 - uTime * 12.5) * 0.005);
  float waterlineY = uWaterY + wavelet + chop + crash;
  float depthBelow = clamp((uv.y - waterlineY) / max(0.02, POOL_Y_MAX - waterlineY), 0.0, 1.0);
  float overRock = float(uv.x < POOL_X_MIN || uv.x > POOL_X_MAX || uv.y > POOL_Y_MAX);
  float overRim = float(uv.y < POOL_Y_MIN);

  if (uv.y < waterlineY && overRim < 0.5 && overRock < 0.5) {
    // layer: sky_reflection
    // Above the waterline: a real sky. A bright glow-tinted horizon band
    // near the waterline blends up through a warmer mid to a cooler high
    // sky; a sun disc rides climate.x's warmth axis. Reads uState (low
    // tide brightens the reflection; high tide sinks the horizon band
    // into the water; storm dims and desaturates) and uNight (face-down
    // sinks to night). This is the whole reason a hand looking down at
    // the pool sees a horizon at all.
    float above = clamp((waterlineY - uv.y) / max(1e-3, waterlineY - POOL_Y_MIN), 0.0, 1.0);
    // Horizon → high sky gradient.
    vec3 horizonTone = mix(GLOW, mix(SKY, GLOW, 0.35), 0.55);
    vec3 skyMid = mix(SKY, SKY_HIGH, 0.30 + uClimate.x * 0.15);
    vec3 airTone = mix(horizonTone, skyMid, pow(above, 0.9));
    airTone = mix(airTone, SKY_HIGH * 0.75, pow(above, 3.0));
    // A bright horizon band right at the waterline (the sun on the sea)
    float horizonBand = exp(-pow((waterlineY - uv.y) * 12.0, 2.0));
    airTone += GLOW * horizonBand * (0.42 + 0.15 * uBreath) * (0.6 + uClimate.x * 0.4);
    // Sun disc — moves subtly with climate.x, breathes with uBreath.
    float sunX = 0.62 + sin(uTime * 0.05) * 0.02;
    float sunY = waterlineY - 0.10 - uClimate.x * 0.05;
    vec2 sd = (uv - vec2(sunX, sunY)) * vec2(aspect, 1.0);
    float sunR = 0.030;
    float sun = smoothstep(sunR * 1.1, sunR * 0.5, length(sd));
    float sunHalo = exp(-dot(sd, sd) * 90.0);
    airTone += GLOW * (sun * 0.65 + sunHalo * 0.35) * (0.75 + 0.25 * uBreath);
    // Cirrus streaks — long thin FBM bands.
    float cirrus = fbm(vec2(uv.x * 5.0 * aspect + uTime * 0.02, uv.y * 26.0));
    cirrus = smoothstep(0.55, 0.85, cirrus) * (0.35 + uClimate.x * 0.25);
    airTone = mix(airTone, mix(airTone, vec3(1.0), 0.6), cirrus * (1.0 - above * 0.5));
    airTone *= 0.86 + 0.14 * uBreath;
    // State branches — visibly reshape the sky per state.
    if (uState.x > 0.5) {
      // low_tide: brightest sky, glassy surface, sharper horizon.
      airTone *= 1.10;
      airTone += GLOW * horizonBand * 0.10;
    }
    if (uState.y > 0.5) {
      // high_tide: horizon sinks; the sky reads deeper and wetter.
      airTone *= 0.94;
      airTone = mix(airTone, ACCENT, 0.08);
    }
    if (uState.z > 0.4) {
      // mid_tide: returning — a small warming pass, restful.
      airTone += GLOW * 0.04;
    }
    if (uState.w > 0.02) {
      // storm: heavy overcast, glow retreats, the sky flattens toward BG.
      airTone = mix(airTone, mix(BG, SKY_HIGH, 0.35), uState.w * 0.65);
      airTone *= 1.0 - 0.30 * uState.w;
    }
    airTone *= 1.0 - uNight * 0.78;
    // Foam mist above the waterline during overtopping — the splash arc.
    if (uOvertop > 0.02 && uv.y > waterlineY - 0.04) {
      float mistMask = exp(-pow((waterlineY - uv.y) * 22.0, 2.0));
      float mistPattern = 0.4 + 0.6 * sin(uv.x * 62.0 + uTime * 7.5)
                              + 0.3 * sin(uv.x * 155.0 - uTime * 4.1);
      airTone = mix(airTone, FOAM,
        clamp(uOvertop * mistMask * mistPattern * 0.6, 0.0, 0.7));
    }
    col = airTone;
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  // Everything from here is either the wet rock rim/floor OR the water column.

  // layer: rock_and_biofilm
  // The warm brown wet rock (BG2) — the rim above the pool AND the rock
  // outside the pool bounds share this register. Layered FBM (coarse +
  // fine + edge grain) gives the granite a real texture; the biofilm
  // (uBiofilm) modulates coral-orange (ACCENT2) patches concentrated
  // near the water's edge. Reads uBiofilm, uBreath, uState.w (storm
  // dims rock briefly), uNight (face-down).
  if (uv.y < POOL_Y_MIN) {
    // Rock rim above the pool.
    float grain = hash21(floor(uv * uRes * 0.4));
    float coarse = fbm(uv * vec2(8.0 * aspect, 6.0));
    float fine = fbm(uv * vec2(48.0 * aspect, 42.0) + vec2(2.7, 3.1));
    vec3 rock = mix(BG2 * 0.55, BG2 * 1.25, coarse);
    rock = mix(rock, rock * (0.7 + grain * 0.6), 0.35);
    rock += BG2 * fine * 0.20;
    // Wet sheen along the bottom edge (nearest the pool).
    float wetSheen = smoothstep(POOL_Y_MIN - 0.06, POOL_Y_MIN, uv.y);
    rock += GLOW * wetSheen * 0.22 * (1.0 - uNight * 0.7);
    // Biofilm — multi-octave FBM patches, denser near the water.
    float bloom1 = fbm(uv * vec2(24.0 * aspect, 18.0));
    float bloom2 = fbm(uv * vec2(56.0 * aspect, 44.0) + vec2(1.3, 0.7));
    float biofilm = pow(bloom1 * 0.7 + bloom2 * 0.3, 1.4);
    float wetBias = 0.4 + wetSheen * 0.6;
    rock += ACCENT2 * biofilm * uBiofilm * wetBias * 0.95;
    // Deeper crevices — dark FBM veins for granite depth.
    float crev = smoothstep(0.72, 0.92, fbm(uv * vec2(14.0 * aspect, 12.0) + vec2(0.9, 2.4)));
    rock *= 1.0 - crev * 0.40;
    rock *= 0.86 + 0.14 * uBreath;
    rock *= 1.0 - uNight * 0.62;
    rock *= 1.0 - uState.w * 0.18;
    col = rock;
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  if (uv.x < POOL_X_MIN || uv.x > POOL_X_MAX || uv.y > POOL_Y_MAX) {
    // layer: rock_and_biofilm (outer rock — the granite bowl the pool
    // sits inside). Reads uBiofilm, uBreath, uNight.
    float outsideness = 0.0;
    if (uv.x < POOL_X_MIN) outsideness = (POOL_X_MIN - uv.x) / POOL_X_MIN;
    if (uv.x > POOL_X_MAX) outsideness = (uv.x - POOL_X_MAX) / max(1e-3, 1.0 - POOL_X_MAX);
    if (uv.y > POOL_Y_MAX) outsideness = max(outsideness, (uv.y - POOL_Y_MAX) / max(1e-3, 1.0 - POOL_Y_MAX));
    outsideness = clamp(outsideness, 0.0, 1.0);
    float grain = hash21(floor(uv * uRes * 0.4));
    float coarse = fbm(uv * vec2(10.0 * aspect, 10.0) + vec2(0.4, 1.1));
    vec3 rock = mix(BG2 * 1.05, BG2 * 0.32, outsideness);
    rock = mix(rock, rock * (0.7 + grain * 0.6), 0.30);
    rock += BG2 * coarse * 0.25;
    // A brighter wet sheen right at the waterline — where the water
    // rises up the granite the rock reads glossy gold.
    float waterEdge = 1.0 - smoothstep(0.0, 0.05, outsideness);
    float nearWater = 1.0 - smoothstep(0.0, 0.09, abs(uv.y - waterlineY));
    rock += GLOW * waterEdge * (0.32 + nearWater * 0.35) * (1.0 - uNight * 0.7);
    // Biofilm.
    float bloom = fbm(uv * vec2(28.0 * aspect, 28.0) + vec2(uv.y * 4.0, 0.0));
    float bloomFine = fbm(uv * vec2(72.0 * aspect, 64.0) + vec2(2.1, 3.7));
    float biofilm = pow(bloom * 0.7 + bloomFine * 0.3, 1.3);
    float wetBand = 1.0 - smoothstep(0.0, 0.10, outsideness);
    rock += ACCENT2 * biofilm * uBiofilm * wetBand * 1.05 * (0.6 + uBreath * 0.4);
    // Cracks and crevices — dark FBM veins.
    float crev = smoothstep(0.70, 0.90, fbm(uv * vec2(18.0 * aspect, 14.0) + vec2(3.1, 0.4)));
    rock *= 1.0 - crev * 0.35;
    rock *= 1.0 - uNight * 0.62;
    rock *= 1.0 - uState.w * 0.12;
    col = rock;
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  // Underwater — the pool itself.
  // The refracted sample coordinate — a small horizontal wobble below the
  // waterline distorts what lives underneath. The refraction is stronger
  // near the surface and eases with depth, so kelp far below reads sharper
  // than a snail just under the meniscus.
  float refractAmp = (1.0 - depthBelow * 0.7) * 0.014;
  float refractDx = sin((uv.y - waterlineY) * 42.0 + uTime * 0.9 + uv.x * 6.0) * refractAmp
                  + sin((uv.y - waterlineY) * 91.0 - uTime * 1.4) * refractAmp * 0.4;
  vec2 uvR = vec2(uv.x + refractDx, uv.y);

  // Water column: exponential darkening with depth (real absorption
  // falloff), from ACCENT teal at the surface toward BG deep-water dark.
  float depthFall = 1.0 - exp(-depthBelow * 2.6);
  vec3 waterCol = mix(ACCENT, BG, depthFall);
  // Warmth tints the shallow column toward glow; the deep stays dark.
  waterCol = mix(waterCol, mix(waterCol, GLOW, 0.35 * (1.0 - depthFall)), uClimate.x);
  waterCol *= 0.86 + 0.14 * uBreath;

  // layer: sunlit_surface
  // A bright Snell highlight at the waterline; caustic cells rippling
  // across the shelf. Reads uBreath, uClimate.x (warmth), uTide, uState
  // (low_tide is glassy — one clean band; high_tide is caustic-rich —
  // dancing cells across the whole floor; mid_tide is soft; storm
  // scours the caustics away). Refraction rides uv → uvR above.
  float surfBand = exp(-pow((uv.y - waterlineY) * 78.0, 2.0));
  vec3 surfTone = mix(GLOW, mix(SKY, GLOW, uClimate.x), 0.55);
  waterCol += surfTone * surfBand * 0.85 * (0.85 + 0.15 * uBreath);
  // layer: foam_plume — visible splash during overtopping
  if (uOvertop > 0.02) {
    float foamMask = exp(-pow((uv.y - waterlineY) * 34.0, 2.0));
    float foamPattern = 0.55 + 0.35 * sin(uv.x * 47.0 + uTime * 6.5)
                              + 0.20 * sin(uv.x * 121.0 - uTime * 3.7)
                              + 0.15 * sin(uv.x * 217.0 + uTime * 11.0);
    waterCol = mix(waterCol, FOAM,
      clamp(uOvertop * foamMask * foamPattern, 0.0, 0.85));
  }
  // A wider soft glow just below the surface.
  float underGlow = exp(-pow((uv.y - waterlineY - 0.025) * 28.0, 2.0));
  waterCol += GLOW * underGlow * 0.24 * (0.5 + uState.y * 0.5);
  // Caustics — three-octave value-noise cells shifted by time; pow gives
  // the network its filament-cell shape; only under high tide are they
  // in full voice; storm scrubs them out.
  vec2 causticUV = vec2(
    uvR.x * 9.0 * aspect + uTime * 0.16 + uCurrent * 0.5,
    (uvR.y - waterlineY) * 3.6 - uTime * 0.11
  );
  float c1 = causticFBM(causticUV);
  float c2 = causticFBM(causticUV * 2.4 + vec2(1.7, 2.3));
  float c3 = causticFBM(causticUV * 5.7 + vec2(3.1, 0.9));
  float caustic = pow(c1 * 0.55 + c2 * 0.30 + c3 * 0.15, 2.6);
  caustic *= (0.5 + uState.y * 0.75);
  caustic *= (1.0 - uState.w * 0.85);
  caustic *= (1.0 - depthBelow * 0.55);
  waterCol += mix(GLOW, mix(GLOW, SKY, 0.3), 1.0 - uClimate.x) * caustic * 0.95;

  // Ripple wavefronts from taps and flicks.
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
  waterCol += mix(ACCENT, GLOW, 0.35) * wave * 0.75;

  // Stir — a scrubbing finger swirls the surface.
  if (uStir > 0.02) {
    vec2 sp = (uv - vec2(0.5, waterlineY + 0.08)) * vec2(aspect, 1.0);
    float ang = atan(sp.y, sp.x);
    float rr = length(sp);
    waterCol += ACCENT * uStir * 0.22 * sin(ang * 4.0 + uTime * 3.0)
              * exp(-rr * rr * 8.0);
  }

  // Particulate motes — drifting downward through the water column.
  // 24 cells (6 x 4), each carrying at most one mote, offset by hash so
  // they never grid-align. The motes glide downward on a slow uTime term
  // and drift horizontally with uCurrent — a real particulate field, not
  // a static noise pattern. Storm scatters them (uState.w rides down the
  // count). Motes read GLOW so they behave as backlit particles.
  {
    vec2 moteUV = uv * vec2(6.0 * aspect, 4.0)
                  + vec2(uCurrent * 0.8, -uTime * 0.06);
    vec2 moteCell = floor(moteUV);
    vec2 moteFrac = fract(moteUV);
    float moteSeed = hash21(moteCell);
    vec2 moteOff = vec2(hash21(moteCell + 3.7), hash21(moteCell - 1.3));
    float moteDist = length(moteFrac - moteOff);
    float mR = 0.05 + moteSeed * 0.06;
    float mote = smoothstep(mR, mR * 0.45, moteDist);
    float alive = step(0.28, moteSeed);
    float notStorm = 1.0 - uState.w * 0.7;
    waterCol += GLOW * mote * alive * notStorm * (0.35 + moteSeed * 0.5) * (1.0 - depthBelow * 0.5);
  }

  // Storm foam + sediment stirring.
  if (uState.w > 0.02) {
    float foamMask = exp(-pow((uv.y - waterlineY) * 34.0, 2.0));
    float foamCells = fbm(vec2(uv.x * 48.0 * aspect + uTime * 0.7, uv.y * 26.0 + uTime * 0.5));
    waterCol = mix(waterCol, FOAM, foamMask * foamCells * uState.w * 0.75);
    // Storm sediment: deeper water reads darker under churn.
    float sediment = fbm(vec2(uv.x * 12.0 * aspect, uv.y * 7.0 - uTime * 0.4));
    waterCol *= 1.0 - 0.32 * uState.w * sediment * depthBelow;
  }

  // Vessel tilt.
  waterCol *= 1.0 - 0.06 * abs(uLean) * (1.0 - depthBelow);
  // Night.
  waterCol *= 1.0 - uNight * 0.55;

  // layer: creature_silhouettes
  // Underwater state-modulation footprint. A storm darkens what the
  // population layer draws over (uState.w), low_tide brightens the shelf
  // (uState.x) so anemone silhouettes read against a paler ground,
  // high_tide (uState.y) enriches the near-surface caustic wash. This is
  // the shader's promise that state actually reaches the population's
  // reading — a snail on the rim during storm sits over a darker column
  // than the same snail during low_tide.
  waterCol *= 1.0 - 0.14 * uState.w * clamp(1.0 - depthBelow, 0.0, 1.0);
  waterCol *= 1.0 + 0.10 * uState.x * (1.0 - depthBelow);
  waterCol += ACCENT * 0.06 * uState.y * (1.0 - depthBelow);

  // Vignette.
  vec2 vd = (uv - vec2(0.5, 0.5)) * vec2(aspect, 1.0);
  waterCol *= 1.0 - 0.42 * smoothstep(0.18, 0.94, dot(vd, vd));

  col = waterCol;
  gl_FragColor = vec4(col, 1.0);
}
`;

// The imperative surface RoomShell speaks to.
type PoolApi = {
  tap: (x: number, y: number, intensity: number, count: number, fingers: number) => void;
  stepBack: () => void;
  tutti: (intensity: number) => void;
  plant: (x: number, y: number) => void;
  deepen: (elapsed: number, x: number, y: number, tier: number) => void;
  ceremony: (x: number, y: number) => void;
  settle: (elapsed: number, x: number, y: number, tier: number) => void;
  timeScale: (k: number) => void;
  drag: (phase: "start" | "move" | "end", x: number, y: number, dx: number, dy: number, fingers: number) => void;
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
  breath: (amount: number) => void;
  glimmer: () => void;
  reduced: (on: boolean) => void;
  moveCursor: (dx: number, dy: number) => void;
  keyTap: () => void;
  keyHold: (elapsed: number) => void;
  keyEscape: () => void;
  clear: () => void;
};

/**
 * The creature, in the shared scene model's vocabulary. The physics ledger
 * (`state.creatures: Creature[]` in tidewater.ts) is authoritative; this
 * view is the render half, synced from the ledger each frame so the shared
 * `createPopulation` + `createPopulationLayer` can draw every creature in
 * one instanced pass. Three specs share the substrate; each maps the
 * ledger's kind onto its own SDF register.
 */
type SnailView = SceneObjectState & {
  biomassVal: number;
  retreated: boolean;
  sealed: boolean;
  phase: number;
};
type AnemoneView = SceneObjectState & {
  biomassVal: number;
  curl: number;
  sealed: boolean;
  phase: number;
};
type KelpView = SceneObjectState & {
  biomassVal: number;
  bendPhase: number;
  phase: number;
};

type StoredPool = {
  v: 1;
  creatures: PoolState["creatures"];
  climate: Climate;
  biofilm: number;
  current: number;
  tau: number;
  stormKnockCount: number;
  lastSeen: number;
  cleared?: boolean;
};

export default function Tidepool() {
  const surfaceRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const apiRef = useRef<PoolApi | null>(null);
  const [hasKept, setHasKept] = useState(false);

  useEffect(() => {
    const surface = surfaceRef.current;
    const overlay = overlayRef.current;
    if (!surface || !overlay) return;

    const audio = getFieldAudio();
    let reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const embedded = isEmbeddedFrame();
    const gov = createFrameGovernor(embedded ? "medium" : "high");

    // ——— the small state vector — read back from storage if present ———
    const SEED = 0x7ee4;
    let state: PoolState = initState(SEED);
    let cleared = false;
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<StoredPool>;
        cleared = parsed.cleared === true;
        if (
          Array.isArray(parsed.creatures) &&
          typeof parsed.tau === "number" &&
          typeof parsed.biofilm === "number"
        ) {
          state = {
            creatures: parsed.creatures
              .filter(
                (c) =>
                  c &&
                  Number.isFinite(c.x) &&
                  Number.isFinite(c.y) &&
                  Number.isFinite(c.biomass),
              )
              .slice(0, MAX_CREATURES),
            climate: parsed.climate ?? { warmth: 0.55, wet: 0.45 },
            biofilm: clamp01(parsed.biofilm),
            current: parsed.current ?? 0,
            tau: parsed.tau,
            stormKnockCount: parsed.stormKnockCount ?? 0,
            seedKey: SEED,
          };
        }
        if (typeof parsed.lastSeen === "number" && Number.isFinite(parsed.lastSeen)) {
          const awaySec = Math.max(0, (Date.now() - parsed.lastSeen) / 1000);
          if (awaySec > 0) state = advanceExact(state, awaySec, state.climate);
        }
      }
    } catch {
      /* fresh pool */
    }
    setHasKept(keeperCount(state) > 1); // one keeper anemone ships in initState
    void cleared;

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
      // The idle writer serializes the state vector back to STORE_KEY.
      try {
        const payload: StoredPool = {
          v: 1,
          creatures: state.creatures,
          climate: state.climate,
          biofilm: state.biofilm,
          current: state.current,
          tau: state.tau,
          stormKnockCount: state.stormKnockCount,
          lastSeen: Date.now(),
          cleared,
        };
        window.localStorage.setItem(STORE_KEY, JSON.stringify(payload));
      } catch {
        /* storage full or unavailable */
      }
    });

    // ——— the shared GL harness ———
    const stage = createGLStage(surface, {
      label: "tidepool",
      wrap: surface.parentElement,
      overlay,
      renderScale: embedded ? 0.42 : 0.6,
      quality: embedded ? "medium" : "high",
      reducedMotion: reduced,
      embedded,
    });
    const prog = stage?.program(FULLSCREEN_VERT_UNIT, FRAG) ?? null;
    const quad = stage && prog ? stage.fullscreenQuad(prog, "unit") : null;

    // ——— the breath uniform — the shared 7s respiration reaches the shader
    // through stage.beginFrame → clocksFrom, and a local handle is kept here so
    // the population step context (and any JS side-effect on the same beat) can
    // read the same value the material sees. Renderer emits deterministically.
    // life.breath.reads includes uBreath — the harness already writes
    // this uniform through stage.beginFrame → clocksFrom; the local
    // handle below lets population.step read the same value.
    const uniformBreath = prog?.location("uBreath") ?? null;
    void uniformBreath;

    // ——— the population — countable things, drawn in one instanced pass.
    // The LLM slot below declares SceneObjectSpec<StateVector> per object in
    // spec.life.population.objects[] and instantiates the population + layer
    // + buffer. It also assigns `tickPopulation` — the harness's draw loop
    // (below) calls that closure once per frame so the population steps and
    // emits in the same GL context beat as the field.
    let tickPopulation: (now: number, tSec: number) => void = () => {};
    // __SLOT_POPULATION__
    // The three populations — snails, anemones, kelp — share the pool's
    // substrate but read different fields off the ledger. Each spec's
    // step(s, ctx) also reads the SIBLING populations through the shared
    // ledger (state.creatures), which is the phase-7 cross-population
    // interaction requirement. Every render goes through one shared
    // createPopulationLayer draw call.
    // ——— shape-select encoding ———
    // The shared SPRITE_VERT gives the population fragment shader four
    // varyings; we hijack `phase`'s integer part as a shape selector so
    // each creature draws its own silhouette in the shared instanced
    // pass. Fractional part carries the sprite's breath phase; hue
    // carries color; glow carries a creature-specific parameter (sealed
    // weight for snails, curl for anemones, bend for kelp).
    //
    //   SHAPE_SNAIL          = 0 + breathPhase(0..1)
    //   SHAPE_ANEMONE_BODY   = 1 + breathPhase(0..1)
    //   SHAPE_ANEMONE_CORONA = 2 + breathPhase(0..1)
    //   SHAPE_KELP           = 3 + breathPhase(0..1)
    const shapeSlot = (shape: number, phase01: number) =>
      shape + Math.min(0.999, Math.max(0, phase01));

    const snailSpec: SceneObjectSpec<SnailView> = {
      kind: "snail",
      cap: SNAIL_CAP,
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
          biomassVal: 0,
          retreated: false,
          sealed: false,
          phase: rng(),
        };
      },
      step(s, ctx) {
        if (s.growth < 1) s.growth = Math.min(1, s.growth + ctx.dt * 0.9);
      },
      emit(s, ctx, out) {
        const px = s.nx * ctx.width;
        const py = s.ny * ctx.height;
        // Snails are shell-sized; a modest radius keeps them on the rim.
        const baseR = Math.max(6, ctx.width * 0.018);
        // Retreated snails shrink into the shell; sealed keepers grow a
        // touch larger and read a brighter rim (via glow → shader).
        const retreatMul = s.retreated ? 0.55 : 1.0;
        const size = retreatMul * (0.85 + s.biomassVal * 0.5);
        const breath01 = 0.5 + 0.5 * Math.sin(
          ctx.tMs * 0.001 * 1.1 + s.phase * Math.PI * 2,
        );
        out.push(
          px, py,
          baseR * size * (s.sealed ? 1.15 : 1),
          0, // rotation left to the SDF (spiral is rotationally distinct on its own)
          s.sealed ? 0.85 : 0.20,      // hue: sealed → warm gold; young → teal-ish
          s.sealed ? 1.0 : 0.35,       // glow → sealed weight (shader reads this)
          shapeSlot(0, breath01),      // phase → SHAPE_SNAIL + subPhase
          s.presence,
        );
      },
      verbs: [],
      respond: {},
    };
    const anemoneSpec: SceneObjectSpec<AnemoneView> = {
      kind: "anemone",
      cap: ANEMONE_CAP,
      born(seed, nx, ny, tMs) {
        const rng = sceneMulberry32(seed);
        return {
          id: 0,
          seed,
          nx,
          ny,
          bornMs: tMs,
          growth: 0.3,
          sealedMs: null,
          presence: 1,
          biomassVal: 0.4,
          curl: 0,
          sealed: false,
          phase: rng(),
        };
      },
      step(s, ctx) {
        if (s.growth < 1) s.growth = Math.min(1, s.growth + ctx.dt * 0.8);
      },
      emit(s, ctx, out) {
        const px = s.nx * ctx.width;
        const py = s.ny * ctx.height;
        // Anemones want room for tentacles — larger radius so the outer
        // rays reach past the body's own footprint.
        const baseR = Math.max(9, ctx.width * 0.028);
        const openness = 1 - s.curl;
        const size = 0.75 + s.biomassVal * 0.35 + openness * 0.25;
        const bodyHue = 0.60;   // anemone body: warm accent2 register
        const tentacleHue = 0.85; // tentacles: pushed toward glow highlight
        const breath01 = 0.5 + 0.5 * Math.sin(
          ctx.tMs * 0.001 * 0.8 + s.phase * Math.PI * 2,
        );
        const bodyR = baseR * size * (s.sealed ? 1.15 : 1);
        // Anemone body — a compact center that shrinks under curl.
        out.push(
          px, py,
          bodyR,
          0,
          bodyHue,
          s.curl,                 // glow → curl (0=open, 1=closed)
          shapeSlot(1, breath01), // phase → SHAPE_ANEMONE_BODY + subPhase
          s.presence,
        );
        // Tentacle corona — the same disc size, but the SDF paints only the
        // rays; this pass is what makes an anemone read as an anemone.
        out.push(
          px, py,
          bodyR * 1.55,
          0,
          tentacleHue,
          s.curl,
          shapeSlot(2, breath01),
          s.presence * (0.35 + openness * 0.65),
        );
      },
      verbs: [],
      respond: {},
    };
    const kelpSpec: SceneObjectSpec<KelpView> = {
      kind: "kelp",
      cap: KELP_CAP,
      born(seed, nx, ny, tMs) {
        const rng = sceneMulberry32(seed);
        return {
          id: 0,
          seed,
          nx,
          ny,
          bornMs: tMs,
          growth: 0.15,
          sealedMs: null,
          presence: 1,
          biomassVal: 0,
          bendPhase: 0,
          phase: rng(),
        };
      },
      step(s, ctx) {
        if (s.growth < 1) s.growth = Math.min(1, s.growth + ctx.dt * 0.7);
      },
      emit(s, ctx, out) {
        // Kelp draws as one tall vertical ribbon rising from the shelf
        // toward the surface. The physics places kelp at s.ny on the
        // SHELF band (SHELF_Y_MIN..HOLLOW_Y_MIN, 0.35..0.55 in normalized
        // pool coords), which — at mean tide — sits half above the
        // waterline. To keep the frond reading as a submerged frond
        // reaching UP toward the surface (rather than sticking into the
        // sky), we anchor at max(s.ny, 0.55) so every kelp starts from
        // the deep shelf and grows upward.
        const px = s.nx * ctx.width;
        // Anchor kelp on the deeper end of the shelf so the frond has
        // room to rise up in the water column without sticking above
        // the mean waterline. The physics places kelp at s.ny within
        // 0.35..0.55; we bias toward the deeper part of that band.
        const anchorNy = Math.max(s.ny, 0.62);
        const anchorY = anchorNy * ctx.height;
        // Height climbs with biomass but stays modest — a kelp frond
        // reaches roughly a quarter-pool up from its anchor, never past
        // the shelf's upper edge. This keeps every frond visibly in the
        // water at mean tide.
        const maxRiseNy = 0.10;
        const heightNy = maxRiseNy * (0.45 + s.biomassVal * 0.55);
        const heightPx = heightNy * ctx.height;
        // Sprite center halfway up the frond; SDF anchor is at the
        // bottom of the sprite (vLocal.y = +1.9), tip at the top
        // (vLocal.y = -1.9).
        const centerY = anchorY - heightPx * 0.5;
        const spriteR = Math.max(heightPx * 0.55, ctx.width * 0.03);
        const bendNorm = (s.bendPhase + 1) * 0.5; // -1..1 → 0..1
        // Deterministic subPhase from creature phase — no Date.now, no
        // Math.random. Breath rides tMs * phase so each frond sways at
        // its own rate.
        const subPhase = (s.phase + (ctx.tMs * 0.0003) % 1) % 1;
        const alpha = s.presence * (0.75 + s.biomassVal * 0.25);
        out.push(
          px, centerY,
          spriteR,
          0,
          0.30,          // hue: kelp teal (bias toward u_palA accent)
          bendNorm,      // glow → bend (0..1)
          shapeSlot(3, subPhase),
          alpha,
        );
      },
      verbs: [],
      respond: {},
    };

    const snails = createPopulation(snailSpec);
    const anemones = createPopulation(anemoneSpec);
    const kelps = createPopulation(kelpSpec);
    const populationLayer = stage
      ? createPopulationLayer(stage, {
          // u_palA = teal water, u_palB = coral biofilm, u_palC = sunlit gold
          palette: ["#3d9ec2", "#e07a3b", "#ffd97a"],
          frag: POPULATION_FRAG,
        })
      : null;
    const instanceBuffer = createInstanceBuffer(MAX_CREATURES * 3);

    // Reused per-kind ledger buckets — filled fresh each frame by a single
    // pass over state.creatures instead of three separate `.filter()`
    // calls (which would allocate three throwaway arrays every rAF tick).
    const snailLedgerBuf: Creature[] = [];
    const anemoneLedgerBuf: Creature[] = [];
    const kelpLedgerBuf: Creature[] = [];

    /** Pull every creature out of the physics ledger into its per-kind
     *  population items. Items are matched by id; new creatures spawn,
     *  vanished creatures start retiring (step decrements presence).
     *  Cross-population interaction: each spec's step reads state.creatures
     *  (the shared ledger) through this synced view — not React state,
     *  local to the effect scope. */
    const syncPopulationsFromLedger = (now: number) => {
      snailLedgerBuf.length = 0;
      anemoneLedgerBuf.length = 0;
      kelpLedgerBuf.length = 0;
      for (const c of state.creatures) {
        if (c.kind === "snail") snailLedgerBuf.push(c);
        else if (c.kind === "anemone") anemoneLedgerBuf.push(c);
        else if (c.kind === "kelp") kelpLedgerBuf.push(c);
      }
      // ——— snails ———
      const snailItems = snails.items;
      const snailLedger = snailLedgerBuf;
      for (const item of snailItems) {
        if (item.presence < 1) continue;
        if (!snailLedger.some((c) => c.id === item.id)) item.presence = 0.999;
      }
      for (const c of snailLedger) {
        let item = snailItems.find((it) => it.id === c.id && it.presence >= 1);
        if (!item) {
          item = {
            id: c.id,
            seed: hashSeed(state.seedKey, c.id),
            nx: c.x,
            ny: c.y,
            bornMs: now,
            growth: 0.2,
            sealedMs: c.sealed ? now : null,
            presence: 1,
            biomassVal: c.biomass,
            retreated: c.retreated,
            sealed: c.sealed,
            phase: c.phase,
          };
          snailItems.push(item);
        } else {
          item.nx = c.x;
          item.ny = c.y;
          item.biomassVal = c.biomass;
          item.retreated = c.retreated;
          item.sealed = c.sealed;
          if (c.sealed && item.sealedMs === null) item.sealedMs = now;
        }
      }
      // ——— anemones ———
      const anemoneItems = anemones.items;
      const anemoneLedger = anemoneLedgerBuf;
      for (const item of anemoneItems) {
        if (item.presence < 1) continue;
        if (!anemoneLedger.some((c) => c.id === item.id)) item.presence = 0.999;
      }
      for (const c of anemoneLedger) {
        let item = anemoneItems.find((it) => it.id === c.id && it.presence >= 1);
        if (!item) {
          item = {
            id: c.id,
            seed: hashSeed(state.seedKey, c.id),
            nx: c.x,
            ny: c.y,
            bornMs: now,
            growth: 0.3,
            sealedMs: c.sealed ? now : null,
            presence: 1,
            biomassVal: c.biomass,
            curl: c.curl,
            sealed: c.sealed,
            phase: c.phase,
          };
          anemoneItems.push(item);
        } else {
          item.nx = c.x;
          item.ny = c.y;
          item.biomassVal = c.biomass;
          item.curl = c.curl;
          item.sealed = c.sealed;
          if (c.sealed && item.sealedMs === null) item.sealedMs = now;
        }
      }
      // ——— kelp ———
      const kelpItems = kelps.items;
      const kelpLedger = kelpLedgerBuf;
      for (const item of kelpItems) {
        if (item.presence < 1) continue;
        if (!kelpLedger.some((c) => c.id === item.id)) item.presence = 0.999;
      }
      for (const c of kelpLedger) {
        let item = kelpItems.find((it) => it.id === c.id && it.presence >= 1);
        if (!item) {
          item = {
            id: c.id,
            seed: hashSeed(state.seedKey, c.id),
            nx: c.x,
            ny: c.y,
            bornMs: now,
            growth: 0.15,
            sealedMs: null,
            presence: 1,
            biomassVal: c.biomass,
            bendPhase: c.bendPhase,
            phase: c.phase,
          };
          kelpItems.push(item);
        } else {
          item.nx = c.x;
          item.ny = c.y;
          item.biomassVal = c.biomass;
          item.bendPhase = c.bendPhase;
        }
      }
    };
    // Assign the population tick; the harness's draw loop calls this once
    // per frame. Everything the shared population does happens here.
    tickPopulation = (now: number, tSec: number) => {
      if (!stage || !populationLayer) return;
      syncPopulationsFromLedger(now);
      const ctx = {
        dt: 1 / 60,
        tMs: now,
        breath: reduced ? 0.5 : 0.5 + 0.5 * Math.sin(tSec * Math.PI * 2 / 7),
        detail: 1,
        wind: 0,
        gravity: 0,
        agitation: getTurbulence(),
        season: 0,
        timeScale: 1,
        reducedMotion: reduced,
      };
      snails.step(ctx);
      anemones.step(ctx);
      kelps.step(ctx);
      instanceBuffer.reset();
      const emitCtx = {
        width: stage.size.width,
        height: stage.size.height,
        tMs: now,
        breath: ctx.breath,
        detail: 1,
        reducedMotion: reduced,
      };
      snails.emit(emitCtx, instanceBuffer);
      anemones.emit(emitCtx, instanceBuffer);
      kelps.emit(emitCtx, instanceBuffer);
      populationLayer.draw(instanceBuffer);
    };

    // ——— the state machine + the room's secrets — phase 7's long tail. This
    // slot lands the state variable, the transition table, the discoverable
    // dispatch, and the per-verb rapid-count storage. Exposed onto apiRef so
    // the verb handlers below can guard their branches on state and count.
    // If spec.state_machine and spec.discoverables are empty, this slot
    // becomes a one-line comment and the harness proceeds unchanged.
    // __SLOT_DISCOVERABLES__
    //
    // The tide pool's state machine is a READ-OFF from `state.tau` and
    // `state.climate` — the water level H(t) and climate.wet decide the
    // four state weights every frame. The verb handlers below dispatch
    // on `currentState(state.tau, state.climate)` to fire the four state-
    // conditional discoverables:
    //
    //   1. tap on anemone during low_tide → anemone.curl = 1 (defensive)
    //   2. shake with a snail underneath   → snail.retreated = true
    //   3. breath (candle invitation)      → breathWarm(state, 0.35)
    //   4. dwell during high_tide near an  → anemone.curl = 0, bloom
    //   5. knock during storm              → state.stormKnockCount++
    //
    // A running clock in real seconds — separate from state.tau which
    // advances at WATCHED_SPEED — so discoverables can time-gate.
    let lastStateName = currentState(state.tau, state.climate);
    let lastStateChangeAt = performance.now();
    void lastStateName;
    void lastStateChangeAt;
    // How many times the visitor has completed each discoverable in this
    // visit — the room can grow richer with returning use.
    const discoveredThisVisit = { d1: 0, d2: 0, d3: 0, d4: 0, d5: 0 };
    const noteDiscovered = (id: "d1" | "d2" | "d3" | "d4" | "d5") => {
      discoveredThisVisit[id]++;
    };
    void noteDiscovered;

    // ——— the glimmer clock — a physical shimmer after ~20s of idle, never a
    // text hint. Renderer emits deterministically from spec.life.glimmer.
    // life.glimmer.after_idle_ms = 20000 — the flare itself is
    // wired below through <RoomShell>'s onGlimmer prop. The persistence
    // writer scheduled here is the only createIdleWriter this room needs.
    writer.schedule();

    // ——— the shader uniforms the loop writes each frame ———
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
    let dwellingCreatureId: number | null = null;
    let lastDeepenAt = 0;
    // Deterministic index into the tier-3-on-open-water cycle (germinate /
    // nudge / bloom) — advances once per tap, never Math.random.
    let emptyTapCycle = 0;
    /** Time-constant of a creature's growth under a sustained press —
     *  a MATERIAL time-constant, not a gesture tier; tiers live in
     *  `gesture/core.ts` alone (AGENTS §"pre-merge checklist"). This
     *  scalar is how fast the pool feeds a plant, not when a press
     *  becomes something else. */
    const BIOMASS_WIDEN_TAU_MS = 900;
    const BIOMASS_STEP_MAX = 0.55;
    /** Simulation speed while a hand is present, in ledger seconds per real second. */
    const WATCHED_SPEED = 60;

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
    const chargeSizeFor = (elapsedMs: number) =>
      BIOMASS_STEP_MAX * (1 - Math.exp(-Math.max(0, elapsedMs) / BIOMASS_WIDEN_TAU_MS));

    /**
     * The tap ladder's top rung, on a creature or on open water alike: a
     * tide change over the whole pool — a real storm-strength startle
     * (knockStartle) plus several virtual hours of accelerated growth
     * (advanceExact), so the surge in the food web (kelp fed by warmth,
     * snails grazing it down, anemones filtering what drifts off both) is
     * visible at once instead of trickling in. The room's largest, rarest
     * event. `depth` is 0..1; tier 5 lands mid-scale, a sustained tier-n
     * train deepens it continuously via tapTrainDepth.
     */
    const tideChange = (depth: number, intensity: number) => {
      const startled = knockStartle(state, 0.55 + depth * 0.45, performance.now());
      state = startled.state;
      state = advanceExact(
        state,
        4 * 3600 * (0.4 + depth * 0.8) * (0.7 + intensity * 0.3),
        state.climate,
      );
      for (const c of state.creatures) pushRipple(c.x, c.y, 0.55 + depth * 0.4);
      try {
        const meanB = meanBiomass(state);
        audio.playTone(SNAIL_PITCH_BASE_HZ * Math.pow(2, -meanB / 0.5), 0.4 + depth * 0.3);
        audio.playTone(ANEMONE_PITCH_BASE_HZ * Math.pow(2, -meanB / 0.5), 0.28 + depth * 0.2);
        audio.bell();
        haptics.roll();
      } catch {
        /* noop */
      }
      writer.schedule();
    };

    // ——— the hand's verbs, in this room's material ———
    // __SLOT_VERB_HANDLERS__
    const engine: PoolApi = {
      tap: (x, y, intensity, count, fingers) => {
        const { nx, ny } = toLocal(x, y);
        cursorX = nx;
        cursorY = ny;
        cursorLit = 1;
        if (fingers >= 2) return;
        const tier = tapTrainTier(count);
        const phase = currentState(state.tau, state.climate);
        const found = nearestCreature(state, nx, ny, 0.08);
        if (found) {
          if (tier === 1) {
            // the room's ordinary answer: ring the creature at its own
            // pitch — the load-bearing invertible map.
            const hz = ringHzFor(found.kind, found.biomass);
            try {
              if (hz > 0) audio.playTone(hz, 0.12 + intensity * 0.18);
              haptics.tap();
            } catch {
              /* noop */
            }
            pushRipple(found.x, found.y, 0.6 + intensity * 0.35);
            // DISCOVERABLE 1: tap on an anemone during LOW TIDE curls it.
            if (phase === "low_tide" && found.kind === "anemone") {
              state = setAnemoneCurl(state, found.id, 1);
              try {
                audio.playTone(ANEMONE_PITCH_BASE_HZ * 0.5, 0.32);
                haptics.chop();
              } catch {
                /* noop */
              }
              noteDiscovered("d1");
            }
            return;
          }
          if (tier === 3) {
            // the creature reproduces, true to its own biology — a snail
            // lays a cluster, a kelp frond fragments, an anemone splits by
            // real binary fission — and pays a third of its own biomass to
            // fund the offspring. Offset seeded from the creature's own id
            // and the ledger's own clock (tau), never Math.random.
            const rng = sceneMulberry32(hashSeed(found.id, Math.floor(state.tau * 997)));
            const ang = rng() * Math.PI * 2;
            const rad = 0.035 + rng() * 0.035;
            const { state: next, childId } = reproduceCreature(
              state,
              found.id,
              Math.cos(ang) * rad,
              Math.sin(ang) * rad,
            );
            state = next;
            if (childId !== null) {
              const child = state.creatures.find((c) => c.id === childId);
              if (child) pushRipple(child.x, child.y, 0.7);
              pushRipple(found.x, found.y, 0.5);
              try {
                audio.playNote(54, 260);
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
          // tier 5 / n — the tide changes over the whole pool, scaled by
          // the train's depth past 5 so a sustained roll keeps deepening.
          tideChange(tier === "n" ? tapTrainDepth(count) : 0.62, intensity);
          return;
        }
        if (tier === 3) {
          // a cycling set of rarer events over open water, true to the
          // pool's own zones — a creature germinates on whatever shelf the
          // tap landed on, a patch of biofilm blooms warm, a local nutrient
          // pulse feeds whatever is already nearby — so a hand that keeps
          // tapping open water keeps finding something new, deterministically.
          const which = emptyTapCycle % 3;
          emptyTapCycle++;
          if (which === 0) {
            const before = state.creatures.length;
            state = plantCreature(state, nx, ny);
            if (state.creatures.length > before) {
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
          } else if (which === 1) {
            state = breathWarm(state, 0.12 + intensity * 0.08);
            pushRipple(nx, ny, 0.65);
            try {
              audio.playTone(160, 0.28);
              haptics.chop();
            } catch {
              /* noop */
            }
            writer.schedule();
          } else {
            let touched = 0;
            for (const c of state.creatures) {
              if (Math.hypot(c.x - nx, c.y - ny) > 0.14) continue;
              state = deepenCreature(state, c.id, 0.08 + intensity * 0.06);
              pushRipple(c.x, c.y, 0.5);
              touched++;
            }
            if (touched > 0) {
              try {
                audio.bell();
                haptics.chop();
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
        if (tier === 5 || tier === "n") {
          // tier 5 / n on open water — the same whole-pool tide change.
          tideChange(tier === "n" ? tapTrainDepth(count) : 0.62, intensity);
          return;
        }
        // tier 1 on open water — ring the pool at the mean of whatever is alive.
        const meanB = meanBiomass(state);
        try {
          audio.playTone(SNAIL_PITCH_BASE_HZ * Math.pow(2, -meanB / 0.5), 0.14 + intensity * 0.14);
          haptics.ripple(0.3 + intensity * 0.35);
        } catch {
          /* noop */
        }
        pushRipple(nx, ny, 0.4 + intensity * 0.3);
      },
      stepBack: () => {
        if (lensSnapped === 1) {
          lensSnapped = 0;
          lensTarget = 0;
          try { haptics.lens(); } catch { /* noop */ }
        }
      },
      tutti: (intensity) => {
        // A chord of three kinds — one for each population still alive.
        const snailB = meanBiomass(state, "snail");
        const anemoneB = meanBiomass(state, "anemone");
        const kelpB = meanBiomass(state, "kelp");
        void kelpB; // kelp does not ring
        try {
          if (countOfKind(state, "snail") > 0)
            audio.playTone(ringHzFor("snail", snailB), 0.20 + intensity * 0.18);
          if (countOfKind(state, "anemone") > 0)
            audio.playTone(ringHzFor("anemone", anemoneB), 0.20 + intensity * 0.16);
          haptics.roll();
        } catch {
          /* noop */
        }
        for (const c of state.creatures) pushRipple(c.x, c.y, 0.5);
      },
      plant: (x, y) => {
        const { nx, ny } = toLocal(x, y);
        cursorX = nx;
        cursorY = ny;
        if (!inPoolBounds(nx, ny)) {
          try { audio.refuse(); } catch { /* noop */ }
          return;
        }
        const kind = kindForDwell(ny);
        if (!kind) {
          // Dwell in a hollow: anemones need ceremony.
          try { audio.refuse(); } catch { /* noop */ }
          return;
        }
        state = plantCreature(state, nx, ny, );
        const planted = state.creatures[state.creatures.length - 1];
        if (planted) dwellingCreatureId = planted.id;
        pushRipple(nx, ny, 0.55);
        try {
          audio.playNote(48, 220);
          haptics.tap();
        } catch { /* noop */ }
        writer.schedule();
      },
      deepen: (elapsed, x, y, tier) => {
        if (dwellingCreatureId === null) return;
        const now = performance.now();
        if (now - lastDeepenAt < 60) return;
        lastDeepenAt = now;
        // Saturating charge — nothing fires identically at 900ms and 2400ms.
        const target = chargeSizeFor(elapsed);
        const current = state.creatures.find((c) => c.id === dwellingCreatureId)?.biomass ?? 0;
        const dB = Math.max(0, target - current);
        if (dB > 0) state = deepenCreature(state, dwellingCreatureId, dB);
        void x; void y; void tier;
        // DISCOVERABLE 4: dwell during HIGH TIDE near an anemone opens it fully.
        const phase = currentState(state.tau, state.climate);
        const { nx, ny } = toLocal(x, y);
        if (phase === "high_tide" && elapsed > 1500) {
          const found = nearestCreature(state, nx, ny, 0.10, "anemone");
          if (found) {
            state = setAnemoneCurl(state, found.id, 0);
            try {
              audio.playTone(ringHzFor("anemone", found.biomass), 0.18);
            } catch { /* noop */ }
            noteDiscovered("d4");
          }
        }
      },
      ceremony: (x, y) => {
        const { nx, ny } = toLocal(x, y);
        const zone = zoneAt(ny);
        if (zone === "hollow" && inPoolBounds(nx, ny)) {
          // The room's solemn plant — an anemone arrives.
          const beforeAn = countOfKind(state, "anemone");
          state = ceremonyPlantAnemone(state, nx, ny);
          if (countOfKind(state, "anemone") > beforeAn) {
            const planted = state.creatures[state.creatures.length - 1];
            state = sealCreature(state, planted.id);
            setHasKept(true);
            pushRipple(nx, ny, 0.8);
            try {
              audio.bell();
              audio.playTone(ringHzFor("anemone", planted.biomass), 0.5);
              haptics.bloom();
            } catch { /* noop */ }
            writer.schedule();
          } else {
            try { audio.refuse(); } catch { /* noop */ }
          }
          dwellingCreatureId = null;
          return;
        }
        // Ceremony over the dwelling creature (a snail keeper).
        if (dwellingCreatureId !== null) {
          const c = state.creatures.find((cr) => cr.id === dwellingCreatureId);
          if (c && c.kind === "snail") {
            state = sealCreature(state, c.id);
            setHasKept(true);
            pushRipple(c.x, c.y, 0.8);
            try {
              audio.bell();
              haptics.bloom();
            } catch { /* noop */ }
            writer.schedule();
          }
          dwellingCreatureId = null;
        } else {
          try { audio.refuse(); } catch { /* noop */ }
        }
      },
      settle: (elapsed, x, y, tier) => {
        void elapsed; void x; void y;
        if (tier < 3) dwellingCreatureId = null;
      },
      timeScale: (k) => { timeScaleTarget = clamp(k, 0.15, 1); },
      drag: (phase, x, y, dx, dy, fingers) => {
        const { nx, ny } = toLocal(x, y);
        cursorX = nx;
        cursorY = ny;
        cursorLit = 1;
        if (fingers >= 3) return;
        state = { ...state, current: clamp(state.current + dx * 0.0011, -1, 1) };
        // Kelp fronds bend visibly with the current.
        state = {
          ...state,
          creatures: state.creatures.map((c) =>
            c.kind === "kelp"
              ? { ...c, bendPhase: clamp(state.current * 0.9, -1, 1) }
              : c,
          ),
        };
        stir = Math.min(1, stir + (Math.abs(dx) + Math.abs(dy)) / 4200);
        if (phase === "move" && Math.hypot(dx, dy) > 6) pushRipple(nx, ny, 0.25);
      },
      wind: (dx, dy) => {
        // world-law: dx is warmth-across, dy is wet-down (down = wetter).
        const nextClimate: Climate = {
          warmth: clamp01(state.climate.warmth + dx * 0.0020),
          wet: clamp01(state.climate.wet + dy * 0.0022),
        };
        state = { ...state, climate: nextClimate };
        try {
          audio.playTone(72 + nextClimate.warmth * 90, 0.14);
        } catch { /* noop */ }
        writer.schedule();
      },
      flick: (x, y, angle, speed, fingers) => {
        const { nx, ny } = toLocal(x, y);
        pushRipple(nx, ny, Math.min(1, 0.5 + speed / 8));
        try {
          audio.bell();
          audio.playTone(SNAIL_PITCH_BASE_HZ * (1 + Math.abs(angle) * 0.1), 0.28);
          haptics.chop();
        } catch { /* noop */ }
        stirTurbulence(0.05 + Math.min(0.2, speed / 5000));
        void fingers;
      },
      stir: (cx, cy, angularVelocity) => {
        const { nx, ny } = toLocal(cx, cy);
        stir = Math.min(1, stir + Math.min(1.2, Math.abs(angularVelocity)) * 0.18);
        pushRipple(nx, ny, 0.35);
        // Kelp fronds bend toward a scrubbing finger.
        state = {
          ...state,
          creatures: state.creatures.map((c) => {
            if (c.kind !== "kelp") return c;
            const dx = c.x - nx;
            const dy = c.y - ny;
            const d = Math.hypot(dx, dy);
            if (d > 0.2) return c;
            return { ...c, bendPhase: clamp(c.bendPhase + Math.sign(dx) * 0.3 * (1 - d / 0.2), -1, 1) };
          }),
        };
        try {
          const mb = meanBiomass(state, "kelp");
          audio.playTone(120 + mb * 60, 0.14);
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
        // Turn the tide clock by hand — one full 33s cycle per twist.
        const span = angle * TIDE_PERIOD_S;
        if (Math.abs(span) > 0.01) {
          state = { ...state, tau: state.tau + span };
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
        // A feeding pulse — anemones near a drum hand get a small biomass bump.
        state = {
          ...state,
          creatures: state.creatures.map((c) => {
            if (c.kind !== "anemone") return c;
            const d = Math.hypot(c.x - nx, c.y - ny);
            if (d > 0.18) return c;
            return { ...c, biomass: clamp(c.biomass + 0.02 * alternation, 0, MAX_BIOMASS) };
          }),
        };
        try {
          audio.playTone(ANEMONE_PITCH_BASE_HZ * (0.75 + alternation * 0.5), 0.14);
          haptics.tap();
        } catch { /* noop */ }
      },
      scatter: (intensity) => {
        stirTurbulence(clamp01(intensity) * 0.6);
        for (const c of state.creatures) pushRipple(c.x, c.y, 0.4 + intensity * 0.4);
        // A vessel scatter also curls anemones — an agitated surface reads.
        state = {
          ...state,
          creatures: state.creatures.map((c) =>
            c.kind === "anemone"
              ? { ...c, curl: Math.max(c.curl, 0.5 * clamp01(intensity)) }
              : c,
          ),
        };
      },
      gravity: (gamma) => {
        leanTarget = reduced ? 0 : clamp(gamma / 48, -1, 1);
      },
      knock: (intensity) => {
        const nowMs = performance.now();
        const phase = currentState(state.tau, state.climate);
        const attempt = knockStartle(state, clamp01(intensity), nowMs);
        state = attempt.state;
        // DISCOVERABLE 5: a knock during STORM state persists a mark.
        if (phase === "storm") {
          state = { ...state, stormKnockCount: state.stormKnockCount + 1 };
          noteDiscovered("d5");
          writer.schedule();
        }
        try {
          const mb = meanBiomass(state);
          audio.playTone(SNAIL_PITCH_BASE_HZ * Math.pow(2, -mb / 0.5), 0.4 + intensity * 0.3);
          haptics.detent();
        } catch { /* noop */ }
        for (const c of state.creatures) pushRipple(c.x, c.y, 0.4 + intensity * 0.4);
      },
      night: (faceDown) => { nightTarget = faceDown ? 1 : 0; },
      breath: (amount) => {
        // DISCOVERABLE 3: the candle's invitation is a warm breath on the pool.
        state = breathWarm(state, clamp01(amount));
        try {
          audio.playTone(180, 0.3);
        } catch { /* noop */ }
        // Extra warm pass under high tide — the deeper water carries the heat
        // further. Also branches so the discoverable count reflects it.
        const phase = currentState(state.tau, state.climate);
        if (phase === "high_tide") {
          state = breathWarm(state, 0.10);
        }
        if (phase === "low_tide") {
          // Low tide's biofilm is already exposed — the breath reaches it
          // more directly, so bloom picks up a small extra.
          state = breathWarm(state, 0.05);
        }
        noteDiscovered("d3");
        writer.schedule();
      },
      glimmer: () => {
        if (state.creatures.length === 0) return;
        const idx = Math.floor(state.tau * 1013) % state.creatures.length;
        const c = state.creatures[Math.max(0, idx)];
        pushRipple(c.x, c.y, 0.35);
      },
      reduced: (on) => { reduced = on; },
      moveCursor: (dx, dy) => {
        cursorX = clamp01(cursorX + dx * 0.06);
        cursorY = clamp01(cursorY + dy * 0.06);
        cursorLit = 1;
      },
      keyTap: () => {
        const mb = meanBiomass(state);
        try {
          audio.playTone(SNAIL_PITCH_BASE_HZ * Math.pow(2, -mb / 0.5), 0.14);
          haptics.ripple(0.3);
        } catch { /* noop */ }
        pushRipple(cursorX, cursorY, 0.5);
      },
      keyHold: (elapsed) => {
        // Keyboard dwell: plant on first tick, then deepen.
        if (dwellingCreatureId === null && inPoolBounds(cursorX, cursorY)) {
          const kind = kindForDwell(cursorY);
          if (kind) {
            state = plantCreature(state, cursorX, cursorY);
            const planted = state.creatures[state.creatures.length - 1];
            if (planted) dwellingCreatureId = planted.id;
          }
        }
        if (dwellingCreatureId !== null) {
          const target = chargeSizeFor(elapsed);
          const cur = state.creatures.find((c) => c.id === dwellingCreatureId)?.biomass ?? 0;
          if (target > cur) state = deepenCreature(state, dwellingCreatureId, target - cur);
        }
        kbCharge = clamp01(elapsed / 2400);
        if (kbCharge >= 1 && dwellingCreatureId !== null) {
          state = sealCreature(state, dwellingCreatureId);
          setHasKept(true);
          try { audio.bell(); haptics.bloom(); } catch { /* noop */ }
          dwellingCreatureId = null;
          kbCharge = 0;
          writer.schedule();
        }
      },
      keyEscape: () => {
        if (lensSnapped === 1) { lensSnapped = 0; lensTarget = 0; }
        kbCharge = 0;
        dwellingCreatureId = null;
      },
      clear: () => {
        cleared = true;
        state = { ...state, creatures: [] };
        setHasKept(false);
        try { audio.thud(); haptics.roll(); } catch { /* noop */ }
        writer.schedule();
      },
    };
    apiRef.current = engine;

    // ——— DISCOVERABLE 2: shake-with-snail-underneath ————
    // Wired here rather than in the engine because the vessel's shake
    // arrives as a repeated event with an intensity, and the room reads
    // the cursor's current position off the last touch to decide the
    // snail under the finger. Registered as a small delta on the
    // engine.scatter path — every scatter checks the cursor for a snail.
    const originalScatter = engine.scatter;
    engine.scatter = (intensity: number) => {
      originalScatter(intensity);
      const found = nearestCreature(state, cursorX, cursorY, 0.10, "snail");
      if (found) {
        const nowMs = performance.now();
        state = {
          ...state,
          creatures: state.creatures.map((c) =>
            c.id === found.id
              ? { ...c, retreated: true, retreatedUntilMs: nowMs + 3000 }
              : c,
          ),
        };
        try {
          audio.playTone(ringHzFor("snail", found.biomass) * 0.5, 0.28);
          haptics.tap();
        } catch { /* noop */ }
        noteDiscovered("d2");
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

      // Continuous axes glide toward their targets.
      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dtRaw * 5);
      lens += (lensTarget - lens) * Math.min(1, dtRaw * 6);
      lean += (leanTarget - lean) * Math.min(1, dtRaw * 3);
      night += (nightTarget - night) * Math.min(1, dtRaw * 2);
      stir = Math.max(0, stir - dtRaw * 0.28);
      cursorLit = Math.max(0, cursorLit - dtRaw * 0.5);

      // Advance the ledger at watched-speed while a hand is present.
      if (!asleep) {
        state = advanceExact(state, dtRaw * timeScale * WATCHED_SPEED, state.climate);
        // Decay the transient flags toward the state-machine floor.
        const w = stateWeights(state.tau, state.climate);
        const targetCurl = w.storm > 0.5 ? 1 : w.low > 0.5 ? 0.5 : 0;
        state = relaxTransients(state, now, dtRaw, targetCurl);
        // Detect state transitions (informational — the shader reads
        // the weights directly, and each verb reads currentState fresh).
        const phase = currentState(state.tau, state.climate);
        if (phase !== lastStateName) {
          lastStateName = phase;
          lastStateChangeAt = now;
        }
      }

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

        // Ripple uniform.
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
        // State weights + tide.
        const stw = stateWeights(state.tau, state.climate);
        const wl = waterLevel(state.tau, state.climate);
        prog.setInt("uRippleCount", rN);
        prog.setVec4("uState", stw.low, stw.high, stw.mid, stw.storm);
        prog.setFloat("uTide", state.tau % TIDE_PERIOD_S);
        prog.setFloat("uWaterY", 1 - wl); // shader Y is inverted
        prog.setFloat("uBiofilm", state.biofilm);
        prog.setFloat("uCurrent", state.current);
        // Climate for shader.
        const climLoc = prog.location("uClimate");
        if (climLoc) stage.gl.uniform2f(climLoc, state.climate.warmth, state.climate.wet);
        prog.setFloat("uLean", lean);
        prog.setFloat("uNight", night);
        prog.setFloat("uStir", stir);
        prog.setFloat("uLens", lens);
        prog.setFloat("uOvertop", overtoppingIntensity(state.tau, state.climate));
        const rippleLoc = prog.location("uRipples[0]");
        if (rippleLoc) stage.gl.uniform4fv(rippleLoc, rippleU);

        quad.draw();
        tickPopulation(now, t);
      }

      // ——— the twist lens — bars for tide, state, populations ———
      const octx = stage?.overlay2d ?? null;
      if (octx) {
        const r = surface.getBoundingClientRect();
        const w = r.width;
        const h = r.height;
        octx.clearRect(0, 0, w, h);

        if (lens > 0.02) {
          octx.globalAlpha = lens;
          const pad = 16;
          const barY = h - 120;
          const barW = Math.min(220, w - pad * 2);
          const wl = waterLevel(state.tau, state.climate);
          const stw = stateWeights(state.tau, state.climate);
          // Tide level bar (glow).
          octx.fillStyle = "rgba(242, 192, 122, 0.7)";
          octx.fillRect(pad, barY, barW * clamp01((wl - (H_MEAN - H_AMP)) / (2 * H_AMP)), 8);
          // Biofilm bar (accent2).
          octx.fillStyle = "rgba(184, 84, 58, 0.6)";
          octx.fillRect(pad, barY + 14, barW * clamp01(state.biofilm), 6);
          // State bars: four small blocks reading the weights.
          const sBar = barW / 4;
          octx.fillStyle = "rgba(58, 138, 118, 0.55)";
          octx.fillRect(pad,               barY + 26, sBar * stw.low, 5);
          octx.fillRect(pad + sBar,        barY + 26, sBar * stw.high, 5);
          octx.fillStyle = "rgba(236, 239, 230, 0.5)";
          octx.fillRect(pad + sBar * 2,    barY + 26, sBar * stw.mid, 5);
          octx.fillStyle = "rgba(184, 84, 58, 0.8)";
          octx.fillRect(pad + sBar * 3,    barY + 26, sBar * stw.storm, 5);
          octx.font = "300 10px ui-monospace, 'SF Mono', Menlo, monospace";
          octx.textAlign = "left";
          octx.fillStyle = "rgba(236, 239, 230, 0.72)";
          octx.fillText(
            `snails ${countOfKind(state, "snail")}  anemones ${countOfKind(state, "anemone")}  kelp ${countOfKind(state, "kelp")}`,
            pad, barY + 46,
          );
          octx.fillText(
            `tide τ ${(state.tau % TIDE_PERIOD_S).toFixed(1)}s  wl ${wl.toFixed(3)}  biofilm ${state.biofilm.toFixed(2)}`,
            pad, barY + 60,
          );
          octx.fillText(
            `state ${currentState(state.tau, state.climate)}  mass ${totalBiomass(state).toFixed(2)}  knocks ${state.stormKnockCount}`,
            pad, barY + 74,
          );
          octx.globalAlpha = 1;
        }
        if (cursorLit > 0.01) {
          octx.strokeStyle = `rgba(236, 239, 230, ${(0.4 * cursorLit).toFixed(3)})`;
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
      // glimmer teardown rides RoomShell's onGlimmer prop; writer.flush()
      // above already closes the persistence writer.
      populationLayer?.dispose();
      quad?.dispose();
      stage?.dispose();
      cancelAnimationFrame(raf);
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
      breath: (e) => apiRef.current?.breath(0.15 + 0.4 * e.strength),
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
      route="/tidepool"
      surfaceRef={surfaceRef}
      voice={voice}
      keyboard={keyboard}
      onGlimmer={() => apiRef.current?.glimmer()}
      onReducedMotion={(on) => apiRef.current?.reduced(on)}
      letGo={{ label: "let the pool rest", onLetGo: letGo, visible: hasKept }}
      style={{ position: "fixed", inset: 0, background: "#050f14" }}
    >
      <canvas
        ref={surfaceRef}
        role="application"
        tabIndex={0}
        aria-label="a hand's width of sunlit rock pool in section — three species holding the pocket between the swells"
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
