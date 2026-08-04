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
 * shader paints a hand's width of superheated ground in section: air on top,
 * a shallow pool at a wavy waterline, a narrow throat down through the pool
 * into a mantle-warmed dark, and — when the trigger fires — a fluid-like
 * plume rising out of the throat. The load-bearing shader map is PHASE →
 * REGISTER: a cool teal register during build/cool crossfades to a hot
 * orange register through eruption. Every heat-mark and ripple is a lens
 * over the same two numbers and the phase the column is in.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { getTurbulence, relaxTurbulence, stirTurbulence } from "@/lib/turbulence";
import RoomShell from "@/components/RoomShell";
import type { RoomVoice } from "@/lib/gesture/defaults";
import { createGLStage, FULLSCREEN_VERT_UNIT } from "@/lib/webgl/stage";
import { clocksFrom } from "@/lib/webgl/sizing";
import {
  onVisibility,
  onGalleryPause,
  createIdleWriter,
  createFrameGovernor,
  isEmbeddedFrame,
} from "@/lib/room-runtime";
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

// The palette — six registers, set once from the manifest.
const vec3 BG      = vec3(0.020, 0.039, 0.031); // deep basalt / mantle dark
const vec3 BG2     = vec3(0.075, 0.141, 0.125); // steaming stone / warmed rock
const vec3 GLOW    = vec3(0.941, 0.776, 0.565); // sulfur light on the plume
const vec3 ACCENT  = vec3(0.353, 0.659, 0.612); // cool pool teal
const vec3 ACCENT2 = vec3(0.910, 0.549, 0.290); // hot heat register
const vec3 INK     = vec3(0.941, 0.937, 0.902);
const vec3 SKY     = vec3(0.024, 0.055, 0.075);

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
// discharge (invert PLUME_TOP_Y → Q_erupt).
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

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  float aspect = uRes.x / max(1.0, uRes.y);
  float night = uNight;
  float hot = uCycle.y;
  vec3 col;

  // ——— the air ———
  if (uv.y < HORIZON) {
    float k = uv.y / HORIZON;
    // Base sky: cool → warm as hot rises through the cycle
    vec3 coolAir = mix(SKY, GLOW * 0.55, k * k * (1.0 - uTurbulence * 0.4));
    vec3 hotAir  = mix(SKY * 1.2, ACCENT2 * 0.7, k * k);
    vec3 airCol = mix(coolAir, hotAir, hot * 0.7);
    airCol *= 0.86 + 0.14 * uBreath;
    col = airCol * (1.0 - night * 0.72);
    // The plume: rises above the pool into the air
    float plume = plumeAmp(uv, aspect, uTime);
    if (plume > 0.0) {
      col += GLOW * plume * (0.5 + hot * 0.5);
      col += ACCENT2 * plume * hot * 0.6;
    }
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  float wl = waterlineY(uv.x, uTime);
  bool inPool = uv.x > POOL_XMIN && uv.x < POOL_XMAX && uv.y > wl && uv.y < POOL_FLOOR;

  if (inPool) {
    // ——— underwater depth: cool by default, warmed as hot rises ———
    float d = (uv.y - wl) / max(0.02, POOL_FLOOR - wl);
    vec3 coolCol = mix(BG, BG2, d * d);
    vec3 hotCol  = mix(BG, ACCENT2 * 0.35, d * d);
    col = mix(coolCol, hotCol, hot * 0.6);

    // Snell surface highlight
    float surf = exp(-pow((uv.y - wl) * 90.0, 2.0));
    float breath = 0.85 + 0.15 * uBreath;
    vec3 highlight = mix(GLOW, ACCENT2, hot);
    col += highlight * surf * 0.55 * breath * (1.0 - night * 0.85);

    // ——— ripple wavefronts from taps and flicks ———
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

    // The throat: a dark vertical channel down through the pool, brighter
    // as T rises (throat-mouth brightness IS T — invertible).
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

    // Stir: the pool spins under a scrubbing finger, decays to still
    if (uStir > 0.02) {
      vec2 sp = (uv - vec2(0.5, wl + 0.14)) * vec2(aspect, 1.0);
      float ang = atan(sp.y, sp.x);
      float rr = length(sp);
      col += ACCENT * uStir * 0.22 * sin(ang * 4.0 + uTime * 3.0)
              * exp(-rr * rr * 8.0);
    }

    // The plume rides upward from the throat's mouth
    float plume = plumeAmp(uv, aspect, uTime);
    if (plume > 0.0) {
      col += mix(GLOW, ACCENT2, hot) * plume * 0.8;
    }

    col *= 1.0 - night * 0.55;
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  // ——— the ground beside the pool: warmed rock in section ———
  float distToWL = uv.y - wl;
  // Warmth glow map: mantle-warmth radiates outward from the throat's line
  float xoff = (uv.x - THROAT_X) * aspect;
  float ground_glow = exp(-abs(xoff) * 6.0) * exp(-max(0.0, uv.y - 0.5) * 3.0);
  // Base ground color, then a mantle-warmed overlay in the hot register
  vec3 dry = vec3(0.078, 0.055, 0.045);
  vec3 warm = vec3(0.115, 0.075, 0.055);
  col = mix(dry, warm, ground_glow * (0.5 + hot * 0.5));

  // Grain
  vec2 gp = floor(uv * uRes * 0.45);
  col *= 0.86 + 0.28 * hash21(gp);

  // Horizontal moisture bands — a shallow moisture at the waterline
  float band = fbm(vec2(uv.x * 3.4, uv.y * 22.0 + uTime * 0.02));
  col *= 0.86 + 0.20 * band;

  // The ground under night: glow red where the mantle is loudest
  if (night > 0.01) {
    col += ACCENT2 * ground_glow * night * (0.4 + hot * 0.6);
  }

  // Mineral bloom at the wet edge — a value-noise fbm modulated by ground_glow
  float bloom = fbm(uv * vec2(30.0 * aspect, 30.0) + vec2(uv.y * 4.0, 0.0));
  float bloomBand = smoothstep(0.05, 0.35, ground_glow) *
                    (1.0 - smoothstep(0.55, 0.9, ground_glow));
  col += mix(ACCENT2, GLOW, hot) * bloom * bloomBand * 0.6 * (0.6 + uBreath * 0.4);

  // ——— every heat marker, as an SDF disc plus an additive corona ———
  // Load-bearing map: corona brightness = heat, monotone. Invert the halo
  // and you recover what the palm left behind.
  for (int i = 0; i < ${MAX_HEAT_MARKS}; i++) {
    if (i >= uHeatCount) break;
    vec4 m = uHeatMarks[i];
    vec2 dp = (uv - m.xy) * vec2(aspect, 1.0);
    float dist = length(dp);
    float r = 0.014;
    float disc = smoothstep(r + 0.006, r - 0.002, dist);
    col = mix(col, ACCENT2 * 0.85, disc * 0.5);
    float heatBright = clamp(m.z / max(1e-3, ${DWELL_T_MAX.toFixed(4)}), 0.0, 1.6);
    float corona = exp(-dist * dist * 60.0) * heatBright;
    col += ACCENT2 * corona * 0.7 + GLOW * corona * 0.18;
  }

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

    // ——— uniform buffers allocated once ———
    const heatU = new Float32Array(MAX_HEAT_MARKS * 4);
    const rippleU = new Float32Array(MAX_RIPPLES * 4);
    const ripples: { x: number; y: number; t0: number; intensity: number }[] = [];

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
        stage.beginFrame(
          clocksFrom({ time: reduced ? 12 : t, turbulence: agitation, reducedMotion: reduced }),
          prog,
        );

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
        prog.setFloat("uLean", lean);
        prog.setFloat("uNight", night);
        prog.setFloat("uStir", stir);
        prog.setFloat("uLens", lens);
        const heatLoc = prog.location("uHeatMarks[0]");
        if (heatLoc) stage.gl.uniform4fv(heatLoc, heatU);
        const rippleLoc = prog.location("uRipples[0]");
        if (rippleLoc) stage.gl.uniform4fv(rippleLoc, rippleU);
        quad.draw();
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
            `phase ${phaseName(state)}  eruptions ${state.eruptions}  ${forecastStr}`,
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
