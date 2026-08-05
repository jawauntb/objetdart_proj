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
type PolypView = SceneObjectState & {
  sizeVal: number;
  sealed: boolean;
  phase: number;
};

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

// The palette — six registers, set once from the manifest.
const vec3 BG      = vec3(0.008, 0.031, 0.078); // deep water dark
const vec3 BG2     = vec3(0.039, 0.141, 0.196); // mid-water column
const vec3 GLOW    = vec3(0.918, 0.659, 0.478); // sunlit coral tissue
const vec3 ACCENT  = vec3(0.306, 0.663, 0.635); // cool turquoise current
const vec3 ACCENT2 = vec3(0.761, 0.416, 0.322); // mature coral / mineral rust
const vec3 INK     = vec3(0.910, 0.929, 0.898);
const vec3 SKY     = vec3(0.482, 0.729, 0.769); // shallow-water sky through the surface

const float HORIZON       = 0.06;   // the water surface sits high — the room is underwater
const float WATERLINE_MID = 0.10;
const float POOL_XMIN     = ${POOL_X_MIN.toFixed(3)};
const float POOL_XMAX     = ${POOL_X_MAX.toFixed(3)};
const float SUBSTRATE_Y   = 0.94;

// Hoskins' hash + value noise + short FBM: the room's only non-physics.
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

// The waterline: a wavy shallow surface at HORIZON. The current warps it
// laterally, and the breath modulates its highlight.
float waterlineY(float x, float t) {
  float wave = sin(x * 9.0 + t * 0.55) * 0.006
             + sin(x * 21.0 - t * 0.9 + uClimate.z * 3.0) * 0.003;
  return WATERLINE_MID + wave;
}

// The current warp: a low-frequency drift the water column carries.
vec2 currentWarp(vec2 uv, float t) {
  float depth = clamp((uv.y - HORIZON) / max(0.02, SUBSTRATE_Y - HORIZON), 0.0, 1.0);
  float phase = fbm(vec2(uv.x * 2.2, uv.y * 1.6 + t * 0.04));
  float drift = uClimate.z * 0.045 * (0.4 + depth * 0.6);
  return vec2(drift * phase, 0.0);
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  float aspect = uRes.x / max(1.0, uRes.y);
  float night = uNight;
  vec3 col;

  // ——— the sky above the water surface ———
  if (uv.y < HORIZON) {
    float k = uv.y / HORIZON;
    vec3 airCol = mix(SKY, GLOW * 0.75, (1.0 - k) * (1.0 - uTurbulence * 0.35));
    airCol *= 0.86 + 0.14 * uBreath;
    col = airCol * (1.0 - night * 0.72);
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  float wl = waterlineY(uv.x, uTime);
  vec2 warp = currentWarp(uv, uTime);

  // ——— underwater column ———
  if (uv.y < SUBSTRATE_Y) {
    float d = clamp((uv.y - HORIZON) / max(0.02, SUBSTRATE_Y - HORIZON), 0.0, 1.0);
    vec3 waterCol = mix(BG2, BG, d * d);
    float illum = clamp(uClimate.w, 0.0, 1.0);
    waterCol *= 0.55 + 0.45 * illum;
    waterCol *= 0.86 + 0.14 * uBreath;
    col = waterCol;

    // Snell surface highlight
    float surf = exp(-pow((uv.y - wl) * 90.0, 2.0));
    float breath = 0.85 + 0.15 * uBreath;
    col += SKY * surf * 0.5 * breath * illum * (1.0 - night * 0.85);

    // Slow lateral shimmer — caustics from the surface wave
    float caustic = fbm(vec2((uv.x + warp.x) * 20.0, (uv.y + warp.y) * 8.0 - uTime * 0.3));
    col += SKY * caustic * caustic * 0.12 * (1.0 - d) * illum;

    // ——— ripple wavefronts from taps and flicks (gaussian rings) ———
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
    col += ACCENT * wave * 0.55;

    // ——— polyp size-pulses (each polyp breathes a slow ring at its size) ———
    float sizeWave = 0.0;
    for (int i = 0; i < ${MAX_POLYPS}; i++) {
      if (i >= uPolypCount) break;
      vec4 p = uPolyps[i];
      float phase = fract(p.w + uTime * 0.14);
      float rad = phase * 0.18 * (0.3 + p.z);
      vec2 dp = (uv - p.xy) * vec2(aspect, 1.0);
      float dist = length(dp);
      float ring = exp(-pow((dist - rad) * 28.0, 2.0));
      sizeWave += ring * (1.0 - phase) * clamp(p.z, 0.0, 1.0) * 0.5;
    }
    col += mix(ACCENT, GLOW, illum) * sizeWave * 0.55;

    // ——— stir: the water column spins under a scrubbing finger ———
    if (uStir > 0.02) {
      vec2 sp = (uv - vec2(0.5, wl + 0.20)) * vec2(aspect, 1.0);
      float ang = atan(sp.y, sp.x);
      float rr = length(sp);
      col += ACCENT * uStir * 0.20 * sin(ang * 4.0 + uTime * 3.0)
              * exp(-rr * rr * 8.0);
    }

    col *= 1.0 - night * 0.55;
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  // ——— the calcite substrate at the section floor ———
  vec3 sub = vec3(0.098, 0.086, 0.078);
  vec3 wet = vec3(0.156, 0.118, 0.098);
  float dSub = clamp((uv.y - SUBSTRATE_Y) / max(0.02, 1.0 - SUBSTRATE_Y), 0.0, 1.0);
  col = mix(wet, sub, dSub * dSub);

  vec2 gp = floor(uv * uRes * 0.45);
  col *= 0.86 + 0.24 * hash21(gp);

  float bloom = fbm(uv * vec2(30.0 * aspect, 30.0) + vec2(uv.y * 4.0, 0.0));
  col += ACCENT2 * bloom * 0.7 * (0.6 + uBreath * 0.4);

  // The polyp SDF disc + additive corona lives in the shared population-
  // layer (src/lib/scene/population-layer.ts) — one instanced draw for all
  // polyps. The load-bearing SIZE → CORONA-BRIGHTNESS map is preserved
  // there, on the polypSpec's emit: glow = clamp(p.sizeVal, 0, 1.6).

  vec2 vd = (uv - vec2(0.5, 0.5)) * vec2(aspect, 1.0);
  col *= 1.0 - 0.52 * smoothstep(0.18, 0.94, dot(vd, vd));
  col *= 1.0 - night * 0.68;

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

    // ——— the polyp, as the shared scene model reads it ———
    // The physics ledger owns the polyps (coralflow.ts). This SceneObjectSpec
    // is the polyp's declaration in the site's shared vocabulary; the
    // population + layer below are the render half — one instanced draw
    // for every polyp on the reef.
    const polypSpec: SceneObjectSpec<PolypView> = {
      kind: "polyp",
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
          sealedMs: null,
          presence: 1,
          sizeVal: 0,
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
        const baseR = Math.max(3, ctx.width * 0.012);
        // Size drives everything the eye reads: bigger polyps have bigger
        // discs and brighter coronas. The load-bearing SIZE → CORONA map.
        const sizeBright = Math.min(1.6, Math.max(0, s.sizeVal));
        // The polyp body — glow-hued disc for young, accent2 rust for
        // sealed cornerstones. Discriminating the two is what the eye
        // does to name the colony's frame.
        out.push(
          px, py,
          baseR * (0.55 + s.sizeVal * 0.45) * (s.sealed ? 1.12 : 1),
          s.phase * Math.PI * 2,
          s.sealed ? 0.85 : 0.35, // hue: sealed toward accent2, young toward glow
          0.24 + s.sizeVal * 0.4 + ctx.breath * 0.12,
          Math.sin(ctx.tMs * 0.001 * 1.1 + s.phase * Math.PI * 2) * 0.5 + 0.5,
          s.presence * (0.5 + s.growth * 0.5),
        );
        // The corona — brightness IS the size. Invert to recover the polyp.
        if (sizeBright > 0.01) {
          out.push(
            px, py,
            baseR * 3.6,
            -s.phase * Math.PI * 2,
            s.sealed ? 0.9 : 0.55,
            sizeBright,
            ctx.breath,
            s.presence * Math.min(1, sizeBright * 0.75),
          );
        }
      },
      // Verb routing lives on the imperative ReefApi below; the physics
      // library is authoritative for polyp state, and re-declaring the
      // handlers here would fork two truths.
      verbs: [],
      respond: {},
    };
    const population = createPopulation(polypSpec);
    const populationLayer = stage
      ? createPopulationLayer(stage, {
          palette: ["#4ea9a2", "#c26a52", "#eaa87a"], // accent, accent2, glow
        })
      : null;
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
     * Pull every polyp out of the physics ledger into the shared population's
     * items array. Items are matched by `id`, so their per-frame identity is
     * stable — new polyps spawn, polyps that vanished from the ledger start
     * retiring (population.step decrements presence).
     */
    const syncPopulationFromLedger = (now: number) => {
      const items = population.items;
      const ledger: Polyp[] = state.polyps;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.presence < 1) continue;
        if (!ledger.some((p) => p.id === item.id)) item.presence = 0.999;
      }
      for (const p of ledger) {
        let item = items.find((it) => it.id === p.id && it.presence >= 1);
        if (!item) {
          item = {
            id: p.id,
            seed: hashSeed(state.seedKey, p.id),
            nx: p.x,
            ny: p.y,
            bornMs: now,
            growth: 0.05,
            sealedMs: p.sealed ? now : null,
            presence: 1,
            sizeVal: p.size,
            sealed: p.sealed,
            phase: p.phase,
          };
          items.push(item);
        } else {
          item.nx = p.x;
          item.ny = p.y;
          item.sizeVal = p.size;
          item.sealed = p.sealed;
          item.phase = p.phase;
          if (p.sealed && item.sealedMs === null) item.sealedMs = now;
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

        // ——— the polyps, as one instanced draw ———
        syncPopulationFromLedger(now);
        population.step({
          dt: Math.min(0.05, dtRaw),
          tMs: now,
          breath: 0.5,
          detail: 1,
          wind: 0,
          gravity: 0,
          agitation,
          season: 0,
          timeScale,
          reducedMotion: reduced,
        });
        instanceBuffer.reset();
        population.emit(
          {
            width: stage.size.width,
            height: stage.size.height,
            tMs: now,
            breath: reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t * Math.PI * 2 / 7),
            detail: 1,
            reducedMotion: reduced,
          },
          instanceBuffer,
        );
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
      style={{ position: "fixed", inset: 0, background: "#020814" }}
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
