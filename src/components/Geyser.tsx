// object-compiler template — docs/plans/object-compiler.md M3.
// Consumes: spec.key, spec.route, spec.storage_key, spec.palette.bg,
//           ComponentName (PascalCase of key), spec.aria_label.
// Three LLM slots below carry the creative work; the boilerplate is verbatim.
"use client";

/**
 * /geyser — the geyser — build, erupt, cool. See docs/plans/object-compiler.md
 * §"Three creative slots" for what belongs in each slot.
 *
 * The invariant is a two-state thermal ledger (src/lib/geyserflow.ts). The
 * shader paints a hand's width of superheated ground in section: a lit sky
 * on top, a shallow pool at a wavy waterline ringed by a proper mineral vent
 * (a ring SDF, not a filled disc), a narrow throat down through the pool
 * into a mantle-warmed dark, and — when the trigger fires — a fluid-like
 * plume rising unbroken from the throat through the ground strip into the
 * sky, with ballistic droplets (a second, decorative scene population,
 * seeded off the population's own id — never Math.random) scattering off
 * it. The load-bearing shader map is PHASE → REGISTER: a cool teal register
 * during build/cool crossfades to a hot orange register through eruption,
 * carried by one continuous `uState` axis (floor = ledger phase, fract =
 * progress through it) rather than a discrete switch — the same axis reads
 * as "dormant" near the bottom of building and "building" near its top,
 * drives a subtle heat-shimmer as it climbs, and drives condensation on the
 * rocks as cooling's own fraction falls. Every heat-mark and ripple is a
 * lens over the same two numbers and the phase the column is in.
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
  MAX_HEAT_MARKS,
  POOL_X_MAX,
  POOL_X_MIN,
  POOL_Y_MAX,
  POOL_Y_MIN,
  DWELL_T_MAX,
  E_TRIGGER_HIGH,
  ERUPT_DURATION_S,
  Q_erupt,
  advanceExact,
  deepenHeatMark,
  hashSeed,
  headForRingHz,
  inSectionBounds,
  initState,
  knockErupt,
  manualErupt,
  nearestHeatMark,
  phaseName,
  plantHeatMark,
  plumeHeightFor,
  ringHzFor,
  stirCool,
  timeUntilEruption,
  totalWater,
  type Climate,
  type GeyserState,
  type HeatMark,
} from "@/lib/geyserflow";

/** Persistence key — versioned; a schema change bumps the suffix. */
const STORE_KEY = "objetdart:geyser:v1";
/** How often the idle writer flushes to storage while a hand is present. */
const SAVE_EVERY_MS = 4000;
/** The transient wavefronts the shader draws over the pool. */
const MAX_RIPPLES = 24;
/**
 * Time-constant of the heat-mark's charge under a sustained press:
 * `θ(t) = θ_max · (1 − e^{-t/τ})`. A MATERIAL time-constant — how fast a
 * palm warms the ground — not a gesture tier; the tiers live in
 * `gesture/core.ts` alone.
 */
const HEAT_WIDEN_TAU_MS = 900;
/** Simulation speed while a hand is present, in ledger seconds per real second. */
const WATCHED_SPEED = 60;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);

/**
 * The heat-mark, in the shared scene model's vocabulary. The physics ledger
 * (`state.heatMarks: HeatMark[]` in geyserflow.ts) is authoritative; this
 * view is the render half, synced from the ledger each frame so
 * `createPopulation` + `createPopulationLayer` can draw every heat-mark in
 * one instanced pass.
 */
type HeatMarkView = SceneObjectState & {
  heatVal: number;
  phaseSeed: number;
};

/**
 * The eruption's own ballistic droplets — decorative only (geyserflow.ts
 * owns the ledger; this population never feeds back into it). Cap and
 * lifetime are material constants of the render, not physics.
 */
const MAX_PLUME_DROPLETS = 40;
const PLUME_DROPLET_LIFE_S = 1.05;
/** Deceleration/gravity on the droplet's closed-form ballistic arc. */
const PLUME_GRAVITY = 1.35;
/** Where a droplet is born — the vent's mouth, in the room's own frame. */
const VENT_NX = 0.5;
const VENT_NY = 0.44;

type PlumeDropletView = SceneObjectState & {
  vx: number;
  vy: number;
  hueMix: number;
};

/**
 * The four informally-named visual states, read off the SAME continuous
 * ledger the mechanical phase machine owns — "dormant" and "building" are
 * not two ledger phases, they are one phase (`"building"`) split by how far
 * E has climbed toward the trigger. Used by the twist-lens readout; the
 * literal names double as the room's `state_machine.states` witnesses.
 */
function visualPhaseLabel(s: GeyserState): "dormant" | "building" | "erupting" | "cooling" {
  if (s.phase === "erupting") return "erupting";
  if (s.phase === "cooling") return "cooling";
  const eNorm = clamp01((s.H * s.T) / (E_TRIGGER_HIGH * 1.2));
  return eNorm < 0.35 ? "dormant" : "building";
}

type StoredGeyser = {
  v: 1;
  H: number;
  T: number;
  phase: GeyserState["phase"];
  tSincePhase: number;
  eruptions: number;
  H0Erupt: number;
  T0Erupt: number;
  heatMarks: HeatMark[];
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
uniform vec4  uHeatMarks[${MAX_HEAT_MARKS}]; // xy pos, z heat (0..DWELL_T_MAX), w phase (0..1)
uniform vec4  uRipples[${MAX_RIPPLES}];      // xy pos, z age (s), w intensity (0..1)
uniform int   uHeatCount;
uniform int   uRippleCount;
/** warmth, wet, H, T — the room's two rates and its two levels */
uniform vec4  uClimate;
/** phase (0=building,1=erupting,2=cooling), hot-weight, plumeH, plumeQ */
uniform vec4  uCycle;
uniform float uLean;
uniform float uNight;
uniform float uStir;
uniform float uLens;
/**
 * The visual-state axis: floor(uState) is the ledger phase (0 building,
 * 1 erupting, 2 cooling); fract(uState) is continuous progress through it.
 * The room's four INFORMAL states — dormant, building, erupting, cooling —
 * all ride this one number, never a switch: dormant is just fract() near 0
 * inside building, building is fract() climbing toward 1, and cooling's own
 * fract() falling drives the condensation fading back toward the next
 * build.
 */
uniform float uState;

// The palette — six registers, set once from the manifest.
const vec3 BG      = vec3(0.020, 0.039, 0.031); // deep mantle dark — subterranean, near-black
const vec3 BG2     = vec3(0.141, 0.102, 0.071); // basalt / warmed rock — the ground's own register
const vec3 GLOW    = vec3(0.941, 0.776, 0.565); // sulfur light — the vent rim, the plume's core
const vec3 ACCENT  = vec3(0.353, 0.659, 0.612); // cool pool teal
const vec3 ACCENT2 = vec3(0.910, 0.549, 0.290); // hot orange — the eruption register
const vec3 INK     = vec3(0.941, 0.937, 0.902);
const vec3 SKY     = vec3(0.620, 0.700, 0.740); // a cool, LIT sky — the bright register

const float HORIZON       = 0.30;
const float WATERLINE_MID = 0.44;
const float POOL_FLOOR    = 0.92;
const float POOL_XMIN     = ${POOL_X_MIN.toFixed(3)};
const float POOL_XMAX     = ${POOL_X_MAX.toFixed(3)};
const float THROAT_X      = 0.5;    // throat is centered
const float THROAT_HALF   = 0.045;  // narrow, per the invariant

// Hoskins hash + value noise + short FBM.
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
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.09; a *= 0.53; }
  return v;
}

// A wavy waterline that rides the local pool level (constant here, plus a
// slight lean-driven wobble).
float waterlineY(float x, float t) {
  float wave = sin(x * 8.0 + t * 0.32) * 0.008
             + sin(x * 18.0 - t * 0.55 + uLean * 3.0) * 0.004;
  return WATERLINE_MID + wave;
}

// The plume: a fluid-like column above the throat while erupting. Returns
// a brightness contribution modulated by fbm; top-y is the visible
// discharge (invert PLUME_TOP_Y → Q_erupt). Spans from below the waterline
// up through the sky — every branch of main() calls the SAME evaluation, so
// the column never breaks crossing the ground strip between the horizon and
// the waterline (the gap a filled-disc-only vent used to leave dark).
float plumeAmp(vec2 uv, float aspect, float t) {
  float plumeH = uCycle.z; // 0..1 — normalized plume height
  float plumeQ = uCycle.w; // 0..1 — normalized discharge
  if (plumeH < 0.001) return 0.0;
  float xoff = (uv.x - THROAT_X) * aspect;
  // The plume tapers upward — a wider mouth, a narrower head.
  float y_top = WATERLINE_MID - plumeH * 0.42;
  float col_y = clamp((uv.y - y_top) / max(0.02, WATERLINE_MID - y_top), 0.0, 1.0);
  // Below the waterline is not the plume, above the top isn't either.
  if (uv.y > WATERLINE_MID + 0.005 || uv.y < y_top) return 0.0;
  float halfWidth = THROAT_HALF * (0.5 + plumeQ * 0.8) * (1.0 - col_y * 0.6);
  float xIn = 1.0 - smoothstep(halfWidth * 0.6, halfWidth, abs(xoff));
  // Turbulent modulation
  float turb = fbm(vec2(uv.x * 24.0, uv.y * 30.0 - t * 4.0));
  return xIn * (0.6 + 0.4 * turb) * (0.4 + plumeQ * 0.8);
}

// The vent — a proper RING SDF at the throat's mouth, not a filled disc: a
// mineral collar standing at the waterline, brighter as T rises. Drawn from
// both the pool and the ground branches so the annulus reads whole across
// the boundary it straddles.
float ventRing(vec2 uv, float aspect, float wl) {
  vec2 p = (uv - vec2(THROAT_X, wl)) * vec2(aspect, 1.0);
  float d = length(p);
  float r = THROAT_HALF * 2.3;
  float thick = THROAT_HALF * 0.5;
  return 1.0 - smoothstep(thick * 0.5, thick, abs(d - r));
}

// Steam — FBM noise advecting upward off the vent, merging into the sky as
// the room heats. Shared between the sky's own wisps and the haze right off
// the pool surface so the column reads continuous top to bottom.
float steamWisp(vec2 uv, float aspect, float t, float hotW) {
  float mask = exp(-abs((uv.x - THROAT_X) * aspect) * 2.2);
  vec2 p = vec2((uv.x - THROAT_X) * aspect * 3.0, uv.y * 9.0 - t * 1.1);
  float n = fbm(p + vec2(0.0, hotW * 2.0));
  return smoothstep(0.32, 0.85, n) * mask * (0.12 + hotW * 0.88);
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  float aspect = uRes.x / max(1.0, uRes.y);
  float night = uNight;
  float hot = uCycle.y;
  float wl = waterlineY(uv.x, uTime);
  float plume = plumeAmp(uv, aspect, uTime);

  // The visual-state axis, decomposed. See the uState uniform doc above.
  float statePhase = floor(uState);
  float stateSub = clamp(fract(uState), 0.0, 1.0);
  float buildW = statePhase < 0.5 ? stateSub : 0.0;             // dormant→building
  float coolW  = (statePhase > 1.5 && statePhase < 2.5) ? (1.0 - stateSub) : 0.0; // fresh→settled cooling

  vec3 col;

  // layer: sky ——— the air, a cool lit register, steam merging in at eruption
  if (uv.y < HORIZON) {
    float k = uv.y / HORIZON;
    // Base sky: cool → warm as hot rises through the cycle
    vec3 coolAir = mix(SKY, GLOW * 0.55, k * k * (1.0 - uTurbulence * 0.4));
    vec3 hotAir  = mix(SKY * 1.08, ACCENT2 * 0.7, k * k);
    vec3 airCol = mix(coolAir, hotAir, hot * 0.7);
    airCol *= 0.86 + 0.14 * uBreath;
    col = airCol * (1.0 - night * 0.72);
    // The plume: rises above the pool into the air
    if (plume > 0.0) {
      col += GLOW * plume * (0.5 + hot * 0.5);
      col += ACCENT2 * plume * hot * 0.6;
    }
    // layer: steam-wisps — rises off the vent, merges into the sky when hot
    float steam = steamWisp(uv, aspect, uTime, hot);
    col = mix(col, mix(GLOW, vec3(1.0), 0.45), clamp(steam, 0.0, 1.0) * 0.55);
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  bool inPool = uv.x > POOL_XMIN && uv.x < POOL_XMAX && uv.y > wl && uv.y < POOL_FLOOR;

  if (inPool) {
    // layer: pool-depth — exponential, not the flatter quadratic
    float d = (uv.y - wl) / max(0.02, POOL_FLOOR - wl);
    float dExp = 1.0 - exp(-d * 3.2);
    vec3 coolCol = mix(BG, ACCENT * 0.4, dExp);
    vec3 hotCol  = mix(BG, ACCENT2 * 0.4, dExp);
    col = mix(coolCol, hotCol, hot * 0.6);

    // layer: snell-highlight
    float surf = exp(-pow((uv.y - wl) * 90.0, 2.0));
    float breath = 0.85 + 0.15 * uBreath;
    vec3 highlight = mix(GLOW, ACCENT2, hot);
    col += highlight * surf * 0.55 * breath * (1.0 - night * 0.85);

    // layer: pool-steam — a thin haze right off the surface, hot-gated
    float poolSteam = steamWisp(uv, aspect, uTime, hot) * exp(-d * 6.0);
    col += mix(GLOW, vec3(1.0), 0.3) * poolSteam * 0.5;

    // layer: ripples — wavefronts from taps and flicks
    float wave = 0.0;
    for (int i = 0; i < ${MAX_RIPPLES}; i++) {
      if (i >= uRippleCount) break;
      vec4 r = uRipples[i];
      float age = r.z;
      float rad = age * 0.36;
      vec2 dp = (uv - r.xy) * vec2(aspect, 1.0);
      float dist = length(dp);
      float ring = exp(-pow((dist - rad) * 22.0, 2.0));
      wave += ring * r.w * exp(-age * 1.4);
    }
    col += mix(ACCENT, ACCENT2, hot) * wave * 0.6;

    // layer: throat — a dark vertical channel down through the pool,
    // brighter as T rises (throat-mouth brightness IS T — invertible).
    float xoff = (uv.x - THROAT_X) * aspect;
    float throatIn = 1.0 - smoothstep(THROAT_HALF * 0.7, THROAT_HALF, abs(xoff));
    if (throatIn > 0.0) {
      float T01 = clamp(uClimate.w, 0.0, 1.0);
      col = mix(col, BG * 0.4, throatIn * 0.7);
      // Slow gaussian ring migrating up from the mouth — brightness in T
      float mouthY = 0.86; // deep in the pool
      float ringPhase = fract(uTime * 0.32);
      float ringY = mix(mouthY, wl + 0.02, ringPhase);
      float ringD = abs(uv.y - ringY);
      float ringBright = exp(-ringD * ringD * 200.0) * (1.0 - ringPhase);
      col += mix(ACCENT, ACCENT2, hot) * ringBright * throatIn * (0.3 + T01 * 0.9);
    }

    // layer: vent-rim — the ring SDF's lower half, straddling the waterline
    float rim = ventRing(uv, aspect, wl);
    col += mix(BG2, GLOW, hot) * rim * (0.5 + 0.5 * uBreath);

    // Stir: the pool spins under a scrubbing finger, decays to still
    if (uStir > 0.02) {
      vec2 sp = (uv - vec2(0.5, wl + 0.14)) * vec2(aspect, 1.0);
      float ang = atan(sp.y, sp.x);
      float rr = length(sp);
      col += ACCENT * uStir * 0.22 * sin(ang * 4.0 + uTime * 3.0)
              * exp(-rr * rr * 8.0);
    }

    // The plume rides upward from the throat's mouth
    if (plume > 0.0) {
      col += mix(GLOW, ACCENT2, hot) * plume * 0.8;
    }

    col *= 1.0 - night * 0.55;
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  // layer: ground-depth ——— the ground beside the pool: warmed rock in
  // section, an EXPONENTIAL depth gradient sinking from bg2 (warm rock, near
  // the horizon) toward bg (deep mantle dark) with distance below it.
  float depthK = clamp((uv.y - HORIZON) / max(0.001, POOL_FLOOR - HORIZON), 0.0, 1.0);
  float deepGrad = 1.0 - exp(-depthK * 2.4);
  vec3 rockBase = mix(BG2, BG, deepGrad);

  // Warmth glow map: mantle-warmth radiates outward from the throat's line
  float xoff = (uv.x - THROAT_X) * aspect;
  float ground_glow = exp(-abs(xoff) * 6.0) * exp(-max(0.0, uv.y - 0.5) * 3.0);
  vec3 warmRock = mix(rockBase, ACCENT2, 0.35);
  col = mix(rockBase, warmRock, ground_glow * (0.5 + hot * 0.5));

  // Grain
  vec2 gp = floor(uv * uRes * 0.45);
  col *= 0.86 + 0.28 * hash21(gp);

  // Horizontal moisture bands — a shallow moisture at the waterline
  float band = fbm(vec2(uv.x * 3.4, uv.y * 22.0 + uTime * 0.02));
  col *= 0.86 + 0.20 * band;

  // The plume passes through this strip too — between the horizon and the
  // waterline the column would otherwise vanish for one section's height.
  if (plume > 0.0) {
    col += mix(GLOW, ACCENT2, hot) * plume * 0.8;
  }

  // layer: vent-rim — the ring SDF's upper half, above the waterline
  float rimAbove = ventRing(uv, aspect, wl);
  col += mix(BG2, GLOW, hot) * rimAbove * (0.5 + 0.5 * uBreath);

  // The ground under night: glow red where the mantle is loudest
  if (night > 0.01) {
    col += ACCENT2 * ground_glow * night * (0.4 + hot * 0.6);
  }

  // layer: sulfur-bloom — value-noise fbm patches at the wet edge, warm register
  float bloom = fbm(uv * vec2(30.0 * aspect, 30.0) + vec2(uv.y * 4.0, 0.0));
  float bloomBand = smoothstep(0.05, 0.35, ground_glow) *
                    (1.0 - smoothstep(0.55, 0.9, ground_glow));
  col += mix(ACCENT2, GLOW, hot) * bloom * bloomBand * 0.6 * (0.6 + uBreath * 0.4);

  // layer: heat-shimmer — a subtle rippling distortion while building climbs
  if (buildW > 0.01) {
    float shimmer = sin(uv.y * 90.0 + uTime * 5.0 + xoff * 12.0) * 0.5 + 0.5;
    col += mix(ACCENT, ACCENT2, 0.5) * shimmer * ground_glow * buildW * 0.18;
  }

  // layer: condensation — droplets beading on the rocks right after a fire,
  // fading as cooling settles back toward the next build
  if (coolW > 0.01) {
    vec2 dp = floor(uv * uRes * 0.12);
    float speck = step(0.965, hash21(dp + 11.0));
    col += mix(ACCENT, vec3(1.0), 0.6) * speck * coolW * 0.7;
  }

  // The heat-mark disc + additive corona, and the eruption's ballistic
  // droplets, live in the shared population-layer
  // (src/lib/scene/population-layer.ts) — one instanced draw per
  // population. The load-bearing HEAT to CORONA-BRIGHTNESS map is
  // preserved there, on the heatSpec's emit: glow = clamp(m.heat /
  // DWELL_T_MAX, 0, 1.6). Invert the halo, recover the ground temperature
  // the palm left behind.

  // Vignette + night
  vec2 vd = (uv - vec2(0.5, 0.5)) * vec2(aspect, 1.0);
  col *= 1.0 - 0.50 * smoothstep(0.18, 0.94, dot(vd, vd));
  col *= 1.0 - night * 0.60;

  gl_FragColor = vec4(col, 1.0);
}
`;

// The imperative surface the room's voice speaks to.
type GeyserApi = {
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

export default function Geyser() {
  const surfaceRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const apiRef = useRef<GeyserApi | null>(null);
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
    const SEED = 0x6e17;
    let state: GeyserState = initState(SEED);
    let climate: Climate = { warmth: 0.55, wet: 0.5 };
    let cleared = false;
    let visited = false;
    let lastSeen = performance.now();
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<StoredGeyser>;
        visited = true;
        cleared = parsed.cleared === true;
        if (
          typeof parsed.H === "number" &&
          typeof parsed.T === "number" &&
          typeof parsed.tau === "number" &&
          typeof parsed.eruptions === "number" &&
          typeof parsed.phase === "string" &&
          Array.isArray(parsed.heatMarks)
        ) {
          state = {
            H: parsed.H,
            T: parsed.T,
            phase:
              parsed.phase === "erupting" || parsed.phase === "cooling"
                ? parsed.phase
                : "building",
            tSincePhase: typeof parsed.tSincePhase === "number" ? parsed.tSincePhase : 0,
            eruptions: parsed.eruptions,
            H0Erupt: typeof parsed.H0Erupt === "number" ? parsed.H0Erupt : 0,
            T0Erupt: typeof parsed.T0Erupt === "number" ? parsed.T0Erupt : 0,
            tau: parsed.tau,
            seedKey: SEED,
            heatMarks: parsed.heatMarks
              .filter(
                (m) =>
                  m &&
                  Number.isFinite(m.x) &&
                  Number.isFinite(m.y) &&
                  Number.isFinite(m.heat),
              )
              .slice(0, MAX_HEAT_MARKS),
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
      /* fresh section */
    }
    if (visited || cleared) {
      setHasKept(state.eruptions > 0);
    }
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
        const payload: StoredGeyser = {
          v: 1,
          H: state.H,
          T: state.T,
          phase: state.phase,
          tSincePhase: state.tSincePhase,
          eruptions: state.eruptions,
          H0Erupt: state.H0Erupt,
          T0Erupt: state.T0Erupt,
          heatMarks: state.heatMarks,
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
      label: "geyser",
      wrap: surface.parentElement,
      overlay,
      renderScale: embedded ? 0.42 : 0.6,
      quality: embedded ? "medium" : "high",
      reducedMotion: reduced,
      embedded,
    });
    const prog = stage?.program(FULLSCREEN_VERT_UNIT, FRAG) ?? null;
    const quad = stage && prog ? stage.fullscreenQuad(prog, "unit") : null;

    // ——— the heat-mark, as the shared scene model reads it ———
    // The ledger (state.heatMarks in geyserflow.ts) is authoritative; this
    // spec declares the mark in shared vocabulary, and the population/layer
    // below is the render half — every heat mark on the ground drawn in
    // one instanced pass.
    const heatSpec: SceneObjectSpec<HeatMarkView> = {
      kind: "heat-mark",
      cap: MAX_HEAT_MARKS,
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
          heatVal: 0,
          phaseSeed: rng(),
        };
      },
      step(s, ctx) {
        if (s.growth < 1) s.growth = Math.min(1, s.growth + ctx.dt * 0.9);
      },
      emit(s, ctx, out) {
        const px = s.nx * ctx.width;
        const py = s.ny * ctx.height;
        const baseR = Math.max(2, ctx.width * 0.009);
        const heatBright = Math.min(1.6, s.heatVal / Math.max(1e-3, DWELL_T_MAX));
        // A warm-register disc where the palm rested.
        out.push(
          px, py,
          baseR,
          s.phaseSeed * Math.PI * 2,
          0.55, // accent2-ish hue in the layer palette
          0.24 + heatBright * 0.3,
          Math.sin(ctx.tMs * 0.001 * 0.9 + s.phaseSeed * Math.PI * 2) * 0.5 + 0.5,
          s.presence * (0.4 + s.growth * 0.6),
        );
        // The corona: brightness monotone in heat — the load-bearing map.
        if (heatBright > 0.01) {
          out.push(
            px, py,
            baseR * 3.6,
            -s.phaseSeed * Math.PI * 2,
            0.7, // toward glow in the palette
            heatBright,
            ctx.breath,
            s.presence * Math.min(1, heatBright * 0.7),
          );
        }
      },
      // Verb routing lives on the imperative GeyserApi below — the physics
      // library owns state; the population is the render mirror.
      verbs: [],
      respond: {},
    };
    const population = createPopulation(heatSpec);
    const populationLayer = stage
      ? createPopulationLayer(stage, {
          palette: ["#5aa89c", "#e88c4a", "#f0c690"], // accent, accent2, glow
        })
      : null;
    const instanceBuffer = createInstanceBuffer(MAX_HEAT_MARKS * 2);

    // ——— the plume's own droplets — decorative only, not the ledger ———
    // A second population, riding the same shared scene model, so the
    // plume's ballistic scatter is a countable population and not a hand-
    // rolled Float32Array on the side. Spawned deterministically off the
    // shared population's own monotone id (scene/object.ts's `spawn`) while
    // `state.phase === "erupting"` — never Math.random, never Date.now.
    const plumeSpec: SceneObjectSpec<PlumeDropletView> = {
      kind: "plume-droplet",
      cap: MAX_PLUME_DROPLETS,
      born(seed, nx, ny, tMs) {
        const rng = sceneMulberry32(seed);
        const angle = (rng() - 0.5) * 0.85;
        const speed = 0.32 + rng() * 0.5;
        return {
          id: 0,
          seed,
          nx,
          ny,
          bornMs: tMs,
          growth: 1,
          sealedMs: null,
          presence: 1,
          vx: Math.sin(angle) * speed * 0.55,
          vy: Math.cos(angle) * speed,
          hueMix: rng(),
        };
      },
      step(s, ctx) {
        const age = (ctx.tMs - s.bornMs) / 1000;
        if (age > PLUME_DROPLET_LIFE_S) {
          s.presence = Math.max(0, s.presence - ctx.dt * 6);
        }
      },
      emit(s, ctx, out) {
        const age = Math.max(0, (ctx.tMs - s.bornMs) / 1000);
        const t = Math.min(age, PLUME_DROPLET_LIFE_S);
        const lifeFrac = clamp01(t / PLUME_DROPLET_LIFE_S);
        const alpha = (1 - lifeFrac) * s.presence;
        if (alpha <= 0.01) return;
        // Ballistic — ballistic droplets scattering off the plume, tapering
        // (shrinking) upward as they age, a closed-form arc from birth.
        const nx = s.nx + s.vx * t;
        const ny = s.ny - s.vy * t + 0.5 * PLUME_GRAVITY * t * t;
        const px = clamp01(nx) * ctx.width;
        const py = clamp01(ny) * ctx.height;
        const r = Math.max(1.1, ctx.width * 0.0055 * (1 - lifeFrac * 0.55));
        out.push(
          px, py,
          r,
          s.hueMix * Math.PI * 2,
          0.82, // toward accent2/glow in the layer palette
          0.4 + 0.5 * (1 - lifeFrac),
          ctx.breath,
          alpha * 0.85,
        );
      },
      verbs: [],
      respond: {},
    };
    const plumePopulation = createPopulation(plumeSpec);
    const plumeInstanceBuffer = createInstanceBuffer(MAX_PLUME_DROPLETS);

    // ——— uniform buffers allocated once ———
    const heatU = new Float32Array(MAX_HEAT_MARKS * 4);
    const rippleU = new Float32Array(MAX_RIPPLES * 4);
    const ripples: { x: number; y: number; t0: number; intensity: number }[] = [];

    // ——— per-frame context objects, allocated once and mutated in place ———
    // clocksFrom/step/emit all read these synchronously and never retain the
    // reference, so reusing one object per frame (instead of a fresh literal)
    // avoids per-frame garbage without changing anything either call sees.
    const clockInput: { time: number; turbulence: number; reducedMotion: boolean } = {
      time: 0,
      turbulence: 0,
      reducedMotion: false,
    };
    const stepCtx = {
      dt: 0,
      tMs: 0,
      breath: 0.5,
      detail: 1,
      wind: 0,
      gravity: 0,
      agitation: 0,
      season: 0,
      timeScale: 1,
      reducedMotion: false,
    };
    const emitCtx = {
      width: 0,
      height: 0,
      tMs: 0,
      breath: 0.5,
      detail: 1,
      reducedMotion: false,
    };

    // ——— live axes glided per frame ———
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
    let cursorY = 0.55;
    let cursorLit = 0;
    let kbCharge = 0;
    let lastSaveAt = performance.now();
    let dwellingMarkId: number | null = null;
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
      if (!inSectionBounds(nx, ny)) return;
      ripples.push({ x: nx, y: ny, t0: performance.now(), intensity: clamp01(intensity) });
      if (ripples.length > MAX_RIPPLES) ripples.shift();
    };

    const ringHere = (nx: number, ny: number, weight = 1) => {
      const hz = ringHzFor(state.H);
      try {
        audio.playTone(hz, 0.12 + weight * 0.18);
        haptics.ripple(0.3 + weight * 0.35);
      } catch {
        /* the mantle is not awake */
      }
      pushRipple(nx, ny, 0.5 + weight * 0.4);
    };

    const soundHeatMark = (heat: number) => {
      const hz = ringHzFor(state.H);
      try {
        audio.playTone(hz + heat * 60, 0.16);
      } catch {
        /* noop */
      }
    };

    const chargeHeatFor = (elapsedMs: number) =>
      DWELL_T_MAX * (1 - Math.exp(-Math.max(0, elapsedMs) / HEAT_WIDEN_TAU_MS));

    // ——— the hand's verbs, in this room's material ———
    // __SLOT_VERB_HANDLERS__
    const engine: GeyserApi = {
      tap: (x, y, intensity, count, fingers) => {
        const { nx, ny } = toLocal(x, y);
        cursorX = nx;
        cursorY = ny;
        cursorLit = 1;
        if (fingers >= 2) return;
        // the rapid-tap ladder (1 / 3 / 5 / n), in superheated ground:
        // 1 rings the throat, 3 walks a run of steam toward the vent,
        // 5 hisses a spit of droplets out of the throat, and from 7 on the
        // hammering hand shifts the trigger itself — a near-ready geyser
        // can be drummed over the top, harder with every extra tap
        const tier = tapTrainTier(count);
        if (tier === "n") {
          const drive = clamp01(0.5 + (count - 7) * 0.12 + intensity * 0.3);
          const attempt = knockErupt(state, drive);
          state = attempt.state;
          pushRipple(nx, ny, 0.6 + drive * 0.4);
          const hz = ringHzFor(state.H);
          try {
            audio.playTone(hz * (1 + drive * 0.5), 0.3 + drive * 0.3);
            haptics.ripple(0.4 + drive * 0.4);
            if (attempt.fired) {
              audio.bell();
              haptics.bloom();
            }
          } catch {
            /* noop */
          }
          if (attempt.fired) {
            setHasKept(true);
            pushRipple(VENT_NX, VENT_NY, 1);
            writer.schedule();
          }
          return;
        }
        if (tier === 5 && count === 5) {
          // a spit of steam: the throat coughs real droplets without firing
          for (let i = 0; i < 3; i++) plumePopulation.spawn(VENT_NX, VENT_NY, performance.now());
          stirTurbulence(0.12 + intensity * 0.1);
          pushRipple(VENT_NX, VENT_NY, 0.7);
          const hz = ringHzFor(state.H);
          try {
            audio.playTone(hz * 1.5, 0.24 + intensity * 0.2);
            audio.playTone(hz * 2, 0.16);
            haptics.chop();
          } catch {
            /* noop */
          }
          return;
        }
        if (tier === 3 && count === 3) {
          // a run of steam: three ripples march from the tap toward the vent,
          // each a step up the throat's own pitch
          const hz = ringHzFor(state.H);
          for (let i = 0; i < 3; i++) {
            const f = (i + 1) / 3;
            pushRipple(nx + (VENT_NX - nx) * f, ny + (VENT_NY - ny) * f, 0.35 + intensity * 0.25);
            try {
              audio.playTone(hz * (1 + f * 0.5), 0.12 + intensity * 0.1);
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
        const found = nearestHeatMark(state, nx, ny, 0.09);
        if (found) {
          soundHeatMark(found.heat);
          pushRipple(found.x, found.y, 0.6);
          haptics.tap();
          return;
        }
        // the throat rings at the local head — pitch alone tells the head
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
        // one chord across the phase register — the room's own beat
        for (const m of state.heatMarks) {
          pushRipple(m.x, m.y, 0.6);
        }
        const hz = ringHzFor(state.H);
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
        if (!inSectionBounds(nx, ny)) {
          try {
            audio.refuse();
          } catch {
            /* noop */
          }
          return;
        }
        state = plantHeatMark(state, nx, ny, 0);
        const planted = state.heatMarks[state.heatMarks.length - 1];
        if (planted) {
          dwellingMarkId = planted.id;
        }
        pushRipple(nx, ny, 0.5);
        try {
          audio.playNote(48, 220);
          haptics.tap();
        } catch {
          /* noop */
        }
        writer.schedule();
      },
      deepen: (elapsed, x, y, tier) => {
        if (dwellingMarkId === null) return;
        const now = performance.now();
        if (now - lastDeepenAt < 60) return;
        lastDeepenAt = now;
        const target = chargeHeatFor(elapsed);
        const current =
          state.heatMarks.find((m) => m.id === dwellingMarkId)?.heat ?? 0;
        const dHeat = Math.max(0, target - current);
        if (dHeat <= 0) return;
        state = deepenHeatMark(state, dwellingMarkId, dHeat);
        void x;
        void y;
        void tier;
        // the pitch rises as the ground warms — a low audio cue
        try {
          audio.playTone(ringHzFor(state.H) * (1 + elapsed / 30000), 0.05);
        } catch {
          /* noop */
        }
      },
      ceremony: (x, y) => {
        // the ceremony fires the throat manually — kept as a marker of intent
        void x;
        void y;
        state = manualErupt(state);
        setHasKept(true);
        pushRipple(0.5, 0.48, 1);
        try {
          audio.bell();
          audio.playTone(ringHzFor(state.H), 0.6);
          audio.playTone(ringHzFor(state.H) * 2, 0.4);
          haptics.bloom();
        } catch {
          /* noop */
        }
        dwellingMarkId = null;
        writer.schedule();
      },
      settle: (elapsed, x, y, tier) => {
        void elapsed;
        void x;
        void y;
        void tier;
        // a hold lifted early: keep whatever heat was contributed, stop tracking
        if (tier < 3) dwellingMarkId = null;
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
        // surface film slides — a shear, no ledger change
        stir = Math.min(1, stir + (Math.abs(dx) + Math.abs(dy)) / 4000);
        if (phase === "move" && Math.hypot(dx, dy) > 6) {
          pushRipple(nx, ny, 0.25);
        }
      },
      wind: (dx, dy) => {
        // world-law: down is rain (recharge), across is warmth (mantle)
        climate = {
          warmth: clamp01(climate.warmth + dx * 0.0018),
          wet: clamp01(climate.wet - dy * 0.0018),
        };
        try {
          audio.playTone(72 + climate.wet * 60, 0.14);
        } catch {
          /* noop */
        }
        writer.schedule();
      },
      flick: (x, y, angle, speed, fingers) => {
        const { nx, ny } = toLocal(x, y);
        // a small plume-of-a-plume — a bubble at that point
        pushRipple(nx, ny, Math.min(1, 0.5 + speed / 8));
        const hz = ringHzFor(state.H);
        try {
          audio.bell();
          audio.playTone(hz * (1 + Math.abs(angle) * 0.1), 0.28);
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
        // scrubbing the pool cools it — surface exchange with the air
        state = stirCool(state, Math.abs(angularVelocity) * 4);
        pushRipple(nx, ny, 0.35);
        try {
          audio.playTone(ringHzFor(state.H) * 0.75, 0.16);
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
        // turn the year through the thermal register; a whole summer can
        // pass through and every fire that would have happened has been
        // counted on the closed form
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
        // two hands alternating: a landing hit *does not* automatically
        // fire — but the arrival is registered on the cycle-lens
        void hits;
        const { nx, ny } = toLocal(x, y);
        pushRipple(nx, ny, 0.4 + alternation * 0.3);
        try {
          audio.playTone(ringHzFor(state.H) * (0.75 + alternation * 0.5), 0.14);
          haptics.tap();
        } catch {
          /* noop */
        }
      },
      scatter: (intensity) => {
        // the surface scatters — the plume shivers
        stirTurbulence(clamp01(intensity) * 0.6);
        for (const m of state.heatMarks) pushRipple(m.x, m.y, 0.4 + intensity * 0.4);
      },
      gravity: (gamma) => {
        leanTarget = reduced ? 0 : clamp(gamma / 48, -1, 1);
      },
      knock: (intensity) => {
        // a struck ground can push a near-triggered state over — the
        // room's touch-reachable secret
        const attempt = knockErupt(state, clamp01(intensity));
        state = attempt.state;
        try {
          const hz = ringHzFor(state.H);
          audio.playTone(hz, 0.5 + intensity * 0.3);
          audio.playTone(hz * 0.5, 0.35);
          haptics.detent();
          if (attempt.fired) {
            audio.bell();
            haptics.bloom();
          }
        } catch {
          /* noop */
        }
        if (attempt.fired) {
          setHasKept(true);
          pushRipple(0.5, 0.48, 1);
          writer.schedule();
        }
      },
      night: (faceDown) => {
        nightTarget = faceDown ? 1 : 0;
      },
      glimmer: () => {
        // one heat marker breathes a wider ring, alone, and nothing is said
        if (state.heatMarks.length > 0) {
          const m = state.heatMarks[Math.floor(state.tau * 977) % state.heatMarks.length];
          pushRipple(m.x, m.y, 0.35);
        } else if (state.phase === "building") {
          // no markers: the throat itself ripples
          pushRipple(0.5, 0.5, 0.3);
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
        if (dwellingMarkId === null && inSectionBounds(cursorX, cursorY)) {
          state = plantHeatMark(state, cursorX, cursorY, 0);
          const planted = state.heatMarks[state.heatMarks.length - 1];
          if (planted) dwellingMarkId = planted.id;
        }
        if (dwellingMarkId !== null) {
          const target = chargeHeatFor(elapsed);
          const current =
            state.heatMarks.find((m) => m.id === dwellingMarkId)?.heat ?? 0;
          if (target > current) {
            state = deepenHeatMark(state, dwellingMarkId, target - current);
          }
        }
        kbCharge = clamp01(elapsed / 2400);
        if (kbCharge >= 1) {
          state = manualErupt(state);
          setHasKept(true);
          try {
            audio.bell();
            haptics.bloom();
          } catch {
            /* noop */
          }
          dwellingMarkId = null;
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
        dwellingMarkId = null;
      },
      clear: () => {
        cleared = true;
        state = initState(SEED);
        plumePopulation.items.length = 0;
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
     * Pull every heat-mark out of the physics ledger into the shared
     * population's items array. Items are matched by `id`, so their
     * per-frame identity is stable — new marks spawn, marks that vanished
     * from the ledger start retiring.
     */
    const syncPopulationFromLedger = (now: number) => {
      const items = population.items;
      const ledger: HeatMark[] = state.heatMarks;
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
            seed: hashSeed(state.seedKey, m.id),
            nx: m.x,
            ny: m.y,
            bornMs: now,
            growth: 0.05,
            sealedMs: null,
            presence: 1,
            heatVal: m.heat,
            phaseSeed: m.phase,
          };
          items.push(item);
        } else {
          item.nx = m.x;
          item.ny = m.y;
          item.heatVal = m.heat;
          item.phaseSeed = m.phase;
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

      // the ledger advances at watched-speed while a hand is present.
      // Closed form per phase — never a catch-up loop.
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
        clockInput.time = reduced ? 12 : t;
        clockInput.turbulence = agitation;
        clockInput.reducedMotion = reduced;
        stage.beginFrame(clocksFrom(clockInput), prog);

        // heat-mark uniform: xy pos, heat, phase
        let hN = 0;
        for (const m of state.heatMarks) {
          if (hN >= MAX_HEAT_MARKS) break;
          heatU[hN * 4] = m.x;
          heatU[hN * 4 + 1] = m.y;
          heatU[hN * 4 + 2] = Math.max(0, m.heat);
          heatU[hN * 4 + 3] = m.phase;
          hN++;
        }
        // ripple uniform: xy pos, age, intensity
        for (let i = ripples.length - 1; i >= 0; i--) {
          const age = (now - ripples[i].t0) / 1000;
          if (age > 3.5) {
            ripples.splice(i, 1);
          }
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
        prog.setInt("uHeatCount", hN);
        prog.setInt("uRippleCount", rN);
        prog.setVec4("uClimate", climate.warmth, climate.wet, state.H, state.T);
        // cycle uniform: phase index, hot-weight, plumeH, plumeQ
        const phaseIdx =
          state.phase === "building" ? 0 : state.phase === "erupting" ? 1 : 2;
        const plumeH = plumeHeightFor(state);
        const plumeQ = clamp01(Q_erupt(state) * 0.7);
        // hot-weight rises as E approaches HIGH; peaks during erupting;
        // fades through cooling. A composite that reads the phase.
        const eNorm = clamp01((state.H * state.T) / (E_TRIGGER_HIGH * 1.2));
        const hot =
          state.phase === "erupting"
            ? 1
            : state.phase === "cooling"
              ? Math.max(0, 1 - state.tSincePhase / (ERUPT_DURATION_S * 4))
              : eNorm * 0.85;
        prog.setVec4("uCycle", phaseIdx, hot, plumeH, plumeQ);
        // uState: floor = ledger phase, fract = continuous progress through
        // it — dormant/building/erupting/cooling all read off this one axis.
        const subProgress =
          phaseIdx === 0
            ? eNorm
            : phaseIdx === 1
              ? clamp01(state.tSincePhase / ERUPT_DURATION_S)
              : clamp01(state.tSincePhase / (ERUPT_DURATION_S * 4));
        prog.setFloat("uState", phaseIdx + Math.min(0.999, subProgress));
        prog.setFloat("uLean", lean);
        prog.setFloat("uNight", night);
        prog.setFloat("uStir", stir);
        prog.setFloat("uLens", lens);
        const heatLoc = prog.location("uHeatMarks[0]");
        if (heatLoc) stage.gl.uniform4fv(heatLoc, heatU);
        const rippleLoc = prog.location("uRipples[0]");
        if (rippleLoc) stage.gl.uniform4fv(rippleLoc, rippleU);
        quad.draw();

        // ——— the heat-marks, as one instanced draw ———
        // Sync the population from the ledger, step it, emit every mark
        // into the shared instance buffer, and hand it off to the layer.
        syncPopulationFromLedger(now);
        stepCtx.dt = Math.min(0.05, dtRaw);
        stepCtx.tMs = now;
        stepCtx.agitation = agitation;
        stepCtx.timeScale = timeScale;
        stepCtx.reducedMotion = reduced;
        population.step(stepCtx);
        instanceBuffer.reset();
        emitCtx.width = stage.size.width;
        emitCtx.height = stage.size.height;
        emitCtx.tMs = now;
        emitCtx.breath = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t * Math.PI * 2 / 7);
        emitCtx.reducedMotion = reduced;
        population.emit(emitCtx, instanceBuffer);
        populationLayer?.draw(instanceBuffer);

        // ——— the plume's own droplets ———
        // Spawn deterministically while erupting, scaled by the ledger's
        // own Q_erupt — a bigger discharge throws more of them. They then
        // free-run their own closed-form ballistic arc in real time,
        // independent of the ledger's much-faster watched-speed clock, so
        // the scatter is still visibly settling as the phase moves on to
        // "cooling" — the plume's own follow-through.
        if (state.phase === "erupting") {
          const q = Q_erupt(state);
          const spawnCount = Math.min(4, 1 + Math.round(q * 3));
          for (let i = 0; i < spawnCount; i++) {
            plumePopulation.spawn(VENT_NX, VENT_NY, now);
          }
        }
        // stepCtx/emitCtx already carry this frame's values (set above for
        // `population`) — identical fields, so the plume population reuses
        // them rather than rebuilding the same object again.
        plumePopulation.step(stepCtx);
        plumeInstanceBuffer.reset();
        plumePopulation.emit(emitCtx, plumeInstanceBuffer);
        populationLayer?.draw(plumeInstanceBuffer);
      }

      // ——— the twist lens: the cycle, drawn back off the water ———
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
          // H bar
          octx.fillStyle = "rgba(90, 168, 156, 0.6)";
          octx.fillRect(pad, barY, barW * clamp01(state.H), 8);
          // T bar
          octx.fillStyle = "rgba(232, 140, 74, 0.6)";
          octx.fillRect(pad, barY + 14, barW * clamp01(state.T), 8);
          // Trigger line (E_TRIGGER_HIGH scaled onto the H*T product axis)
          const eNow = state.H * state.T;
          const eScale = barW / (E_TRIGGER_HIGH * 1.5);
          octx.fillStyle = "rgba(240, 198, 144, 0.6)";
          octx.fillRect(pad, barY + 28, eNow * eScale, 6);
          const trigX = pad + E_TRIGGER_HIGH * eScale;
          octx.strokeStyle = "rgba(240, 198, 144, 0.9)";
          octx.beginPath();
          octx.moveTo(trigX, barY + 26);
          octx.lineTo(trigX, barY + 40);
          octx.stroke();
          octx.font = "300 10px ui-monospace, 'SF Mono', Menlo, monospace";
          octx.textAlign = "left";
          octx.fillStyle = "rgba(240, 239, 230, 0.7)";
          octx.fillText(
            `H ${state.H.toFixed(2)}  T ${state.T.toFixed(2)}  E ${eNow.toFixed(3)}  ` +
              `${ringHzFor(state.H).toFixed(0)}hz`,
            pad,
            barY + 54,
          );
          const forecast = timeUntilEruption(state, climate);
          const forecastStr = Number.isFinite(forecast)
            ? `${forecast.toFixed(0)}s to fire`
            : phaseName(state);
          octx.fillText(
            `phase ${visualPhaseLabel(state)} (${phaseName(state)})  eruptions ${state.eruptions}  ${forecastStr}`,
            pad,
            barY + 68,
          );
          octx.globalAlpha = 1;
        }

        if (cursorLit > 0.01) {
          octx.strokeStyle = `rgba(240, 239, 230, ${(0.4 * cursorLit).toFixed(3)})`;
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
  // engine never loses an in-flight hold when React re-renders. Every verb
  // in spec.verbs_answered forwards; the ones the material genuinely cannot
  // express (rhythm, arpeggio, breath) fall through to the shell defaults.
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
      // rhythm, arpeggio, breath: the geyser is not on a beat, does not stagger
      // its chords, and the candle owns breath — the shell's defaults handle
      // them with two-senses acknowledgement, as designed.
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
      route="/geyser"
      surfaceRef={surfaceRef}
      voice={voice}
      keyboard={keyboard}
      onGlimmer={() => apiRef.current?.glimmer()}
      onReducedMotion={(on) => apiRef.current?.reduced(on)}
      letGo={{ label: "let the geyser rest", onLetGo: letGo, visible: hasKept }}
      style={{ position: "fixed", inset: 0, background: "#050a08" }}
    >
      <canvas
        ref={surfaceRef}
        role="application"
        tabIndex={0}
        aria-label="a hand's width of superheated ground, in section — the aquifer timed against its trigger"
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

void hashSeed;
void headForRingHz;
void totalWater;
void POOL_Y_MIN;
void POOL_Y_MAX;
void POOL_X_MAX;
