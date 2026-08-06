// object-compiler template — docs/plans/object-compiler.md M3.
// Consumes: spec.key, spec.route, spec.storage_key, spec.palette.bg,
//           ComponentName (PascalCase of key), spec.aria_label.
// Three LLM slots below carry the creative work; the boilerplate is verbatim.
"use client";

/**
 * /spring — the spring — head, seep, ring. See docs/plans/object-compiler.md
 * §"Three creative slots" for what belongs in each slot.
 *
 * The invariant is a two-cell hydraulic ledger (src/lib/springflow.ts). The
 * shader paints one hand-width of wet ground in section: air on top, a wavy
 * waterline where the pool meets the ground, an underwater depth column that
 * inverts the head to a colour, and a wet halo around every seep whose
 * brightness IS the seep's live flux (the load-bearing invariant map is
 * FLUX → PIXEL, and every ripple is a lens over the same two numbers).
 * Everything the room does is a call into `springflow`; the frame governor,
 * the visibility pause, the idle writer and the axis chrome all come from
 * `<RoomShell>` and `room-runtime`.
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
  MAX_SEEPS,
  MAX_THROAT,
  POOL_X_MAX,
  POOL_X_MIN,
  POOL_Y_MAX,
  POOL_Y_MIN,
  advanceExact,
  deepenSeep,
  hashSeed,
  headForRingHz,
  inPoolBounds,
  initState,
  nearestSeep,
  plantSeep,
  ringHzFor,
  sealSeep,
  totalWater,
  type Climate,
  type Seep,
  type SpringState,
} from "@/lib/springflow";

/** Persistence key — versioned; a schema change bumps the suffix. */
const STORE_KEY = "objetdart:spring:v1";
/** How often the idle writer flushes to storage while a hand is present. */
const SAVE_EVERY_MS = 4000;
/** The transient wavefronts the shader draws over the pool. */
const MAX_RIPPLES = 24;
/** How wide a seep opens under a full-tier dwell (saturating). */
const DWELL_THROAT_MAX = 0.55;
/**
 * Time-constant of the seep's throat-widening under a sustained press:
 * `θ(t) = θ_max · (1 − e^{-t/τ})`. This is a MATERIAL time-constant — how
 * fast the aquifer's cross section opens under a hand — not a gesture tier;
 * the hold tiers themselves live in `gesture/core.ts` alone and are read
 * from the `deepen` event's own `elapsed` and `tier`.
 */
const THROAT_WIDEN_TAU_MS = 900;
/** Simulation speed while a hand is present, in ledger seconds per real second. */
const WATCHED_SPEED = 60;
/** How many bubbles may stand at once — a second, ephemeral population. */
const MAX_BUBBLES = 28;
/**
 * Bubbles per real second at a fully-open seep (fluxBright saturates at
 * 1.6, same scale the corona reads). The spawn budget accumulates from the
 * ledger's own flux — no RNG in the timing, only in the bubble's own seed.
 */
const BUBBLE_SPAWN_RATE = 0.55;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);

/**
 * The seep, in the shared scene model's vocabulary. The physics ledger
 * (`state.seeps: Seep[]` in springflow.ts) is authoritative; this view is
 * the render half, synced from the ledger each frame so the shared
 * `createPopulation` + `createPopulationLayer` can draw every seep in
 * one instanced pass.
 */
type SeepView = SceneObjectState & {
  throat: number;
  flux: number;
  sealed: boolean;
  phase: number;
};

/**
 * The bubble — the room's second population. It answers no gesture verb;
 * it is born from an open seep's live flux alone (spawn budget accumulates
 * as `fluxBright * BUBBLE_SPAWN_RATE * dt`, deterministic from the ledger,
 * no RNG in the timing), rises on its own seeded wobble, and pops the
 * instant it crosses the waterline. Never persisted — a bubble is weather,
 * not a kept thing.
 */
type BubbleView = SceneObjectState & {
  vy: number;
  wobbleAmp: number;
  wobbleFreq: number;
  wobblePhase: number;
  r0: number;
  popping: boolean;
};

type StoredSpring = {
  v: 1;
  H: number;
  L: number;
  tau: number;
  seeps: SpringState["seeps"];
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
uniform vec4 uSeeps[${MAX_SEEPS}];   // xy pos, z flux (H/s), w phase (0..1)
uniform vec4 uRipples[${MAX_RIPPLES}]; // xy pos, z age (s), w intensity (0..1)
uniform int  uSeepCount;
uniform int  uRippleCount;
/** warmth, wet, H, L — the room's two rates and its two levels */
uniform vec4 uClimate;
uniform float uLean;
uniform float uNight;
uniform float uStir;
uniform float uLens;

// The palette — six registers set once, from the manifest. phase-8: bg2 is a
// real wet-ground brown (not a second teal), glow and accent2 both brighten
// so the water surface and the mineral bloom read as their own pixels.
const vec3 BG      = vec3(0.024, 0.039, 0.063); // deep aquifer dark
const vec3 BG2     = vec3(0.180, 0.125, 0.075); // wet ground, dark and rich
const vec3 GLOW    = vec3(0.843, 0.949, 0.984); // sunlit water-surface highlight
const vec3 ACCENT  = vec3(0.247, 0.616, 0.761); // cool water in motion
const vec3 ACCENT2 = vec3(0.890, 0.675, 0.341); // warm mineral bloom at the wet edge
const vec3 INK     = vec3(0.902, 0.937, 0.910);
const vec3 SKY     = vec3(0.026, 0.059, 0.086);
const vec3 DRY     = vec3(0.320, 0.270, 0.205); // dusty ground, far from any water — not a manifest register, just what BG2 fades toward

const float HORIZON       = 0.30;
const float WATERLINE_MID = 0.40;
// phase-8: the pool is a shallow band, not the whole lower frame — the
// ground it sits in, above and below, is the room's other half.
const float POOL_FLOOR    = 0.60;
const float POOL_XMIN     = ${POOL_X_MIN.toFixed(3)};
const float POOL_XMAX     = ${POOL_X_MAX.toFixed(3)};

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

// The waterline: a wavy line whose mean height rides the pool level. As the
// pool drops the section shows more wet ground above it — the same H → L → L̂
// map read as a picture.
float waterlineY(float x, float t) {
  float wave = sin(x * 9.0 + t * 0.35) * 0.008
             + sin(x * 21.0 - t * 0.62 + uLean * 3.0) * 0.004;
  float lFrac = clamp(uClimate.w, 0.0, 1.5);
  return WATERLINE_MID + (0.55 - lFrac) * 0.06 + wave;
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  float aspect = uRes.x / max(1.0, uRes.y);
  float night = uNight;
  vec3 col;

  // layer: sky_and_clouds
  if (uv.y < HORIZON) {
    float k = uv.y / HORIZON;
    // a faint streak of cloud, dragging slowly across the horizon band
    float cloud = fbm(vec2(uv.x * 3.1 + uTime * 0.015, uv.y * 5.0 + 4.0));
    vec3 airCol = mix(SKY, GLOW * 0.62, k * k * (1.0 - uTurbulence * 0.4));
    airCol = mix(airCol, GLOW * 0.85, smoothstep(0.56, 0.86, cloud) * 0.16 * k);
    // a slow breath in the dawn column
    airCol *= 0.86 + 0.14 * uBreath;
    col = airCol * (1.0 - night * 0.72);
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  float wl = waterlineY(uv.x, uTime);
  bool inPool = uv.x > POOL_XMIN && uv.x < POOL_XMAX && uv.y > wl && uv.y < POOL_FLOOR;

  // layer: seep_wet_halo
  // the wet halo around every seep — read below whether the pixel is inside
  // the open pool or in the wet ground past the floor, so a deep seep still
  // tells its flux even where the water above it has gone underground.
  // brightness is monotone in flux: invert the halo, recover the ledger.
  float seepGlow = 0.0;
  for (int i = 0; i < ${MAX_SEEPS}; i++) {
    if (i >= uSeepCount) break;
    vec4 s = uSeeps[i];
    vec2 dp = (uv - s.xy) * vec2(aspect, 1.0);
    float dist = length(dp);
    float fluxAmt = clamp(s.z * 3.0e4, 0.0, 1.0);
    float halo = exp(-dist * dist * 90.0) * fluxAmt;
    float phase = fract(s.w + uTime * 0.28);
    float rad = phase * 0.30;
    float ring = exp(-pow((dist - rad) * 30.0, 2.0)) * (1.0 - phase) * fluxAmt;
    seepGlow += halo * 0.5 + ring;
  }

  if (inPool) {
    // layer: refraction_wobble
    // a small horizontal sine displacement, growing with depth from zero at
    // the surface — what light does crossing into the water at an angle.
    float depthT = (uv.y - wl) / max(0.02, POOL_FLOOR - wl);
    float wobble = sin(uv.y * 46.0 + uTime * 1.05) * 0.006 * smoothstep(0.0, 0.3, depthT);
    vec2 uvW = vec2(uv.x + wobble, uv.y);

    // layer: underwater_column
    // shallow water reads bright (accent lifted toward glow); the column
    // darkens toward the true aquifer dark as depth in the pool increases
    vec3 shallow = mix(ACCENT, GLOW, 0.32);
    col = mix(shallow, BG, depthT * depthT);

    // Snell surface highlight — a low-angle reflection of the sky palette
    float surf = exp(-pow((uv.y - wl) * 78.0, 2.0));
    float breath = 0.85 + 0.15 * uBreath;
    col += GLOW * surf * 0.85 * breath * (1.0 - night * 0.85);

    // caustic cells: an fbm shimmer tinted glow, wobbled by the refraction
    // above and fading out with depth — the light a shallow pool still lets
    // through, never claiming to reach the true floor
    float caustic = fbm(vec2(uvW.x * 20.0 * aspect, uvW.y * 11.0 - uTime * 0.42));
    float causticMask = smoothstep(0.52, 0.86, caustic) * exp(-depthT * 2.6);
    col += GLOW * causticMask * 0.4 * (0.6 + 0.4 * uBreath);

    // ripple wavefronts from taps and flicks (gaussian rings), refracted
    float wave = 0.0;
    for (int i = 0; i < ${MAX_RIPPLES}; i++) {
      if (i >= uRippleCount) break;
      vec4 r = uRipples[i];
      float age = r.z;
      float rad = age * 0.36;
      vec2 dp = (vec2(uvW.x, uv.y) - r.xy) * vec2(aspect, 1.0);
      float dist = length(dp);
      float ring = exp(-pow((dist - rad) * 22.0, 2.0));
      wave += ring * r.w * exp(-age * 1.4);
    }
    col += ACCENT * wave * 0.6;
    col += ACCENT * seepGlow * 0.6;

    // ——— stir: the pool spins under a scrubbing finger, decays to still ———
    if (uStir > 0.02) {
      vec2 sp = (uv - vec2(0.5, wl + 0.10)) * vec2(aspect, 1.0);
      float ang = atan(sp.y, sp.x);
      float rr = length(sp);
      col += ACCENT * uStir * 0.22 * sin(ang * 4.0 + uTime * 3.0)
              * exp(-rr * rr * 8.0);
    }

    col *= 1.0 - night * 0.55;
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  // layer: wet_ground_moisture
  // wettest at the waterline / pool floor, drying with distance from it in
  // EITHER direction — up toward the sky, or down away from the pool. The
  // moisture band reads directly off the pool level: a fuller pool wets
  // more ground.
  float aboveWater = wl - uv.y;
  float belowFloor = uv.y - POOL_FLOOR;
  float distFromWater = max(aboveWater, max(belowFloor, 0.0));
  // a tighter fall-off than the old pass — the wet register hugs the pool
  // and visibly gives way to dry ground within the frame, not a wash
  float lambda = 0.10 + uClimate.y * 0.05;
  float moisture = exp(-distFromWater / lambda);
  moisture *= 1.0 - smoothstep(0.90, 1.0, uv.y) * 0.4; // fade at the very bottom edge

  // wet ground reads dark and rich (bg2); dry ground is a pale dusty tone —
  // the reverse of the old near-monochrome pass, and true to real soil
  col = mix(DRY, BG2, moisture);

  // grain — kept subtle so it textures the ground without drowning the
  // wet→dry gradient in noise
  vec2 gp = floor(uv * uRes * 0.42);
  col *= 0.92 + 0.14 * hash21(gp);

  // horizontal moisture bands — layering, wet more so near the pool
  float band = fbm(vec2(uv.x * 3.2, uv.y * 18.0 + uTime * 0.02));
  col *= 0.92 + 0.12 * band;

  // layer: mineral_bloom
  // wetness → brightness is monotone here, same shape as the seep's flux →
  // corona map: the fbm only gates WHERE a patch draws, never rescales its
  // amplitude, so a lit patch's brightness alone recovers the local
  // moisture — invert it and read the ground back off it. squaring the
  // moisture term (still monotone) sharpens the concentration at the pool
  // edge, so the bloom reads as an EDGE feature, not a wash over the ground.
  float bloomPatches = fbm(uv * vec2(28.0 * aspect, 28.0) + vec2(uv.y * 3.4, uTime * 0.01));
  float bloomGate = smoothstep(0.58, 0.80, bloomPatches);
  float bloomAmt = moisture * moisture * bloomGate;
  col += ACCENT2 * bloomAmt * (0.85 + uBreath * 0.4);

  // the wet halo again, dimmer here — a deep seep still tells its flux
  col += mix(ACCENT2, ACCENT, 0.4) * seepGlow * 0.45;

  // layer: vignette_and_night
  vec2 vd = (uv - vec2(0.5, 0.5)) * vec2(aspect, 1.0);
  col *= 1.0 - 0.48 * smoothstep(0.18, 0.94, dot(vd, vd));
  col *= 1.0 - night * 0.68;

  gl_FragColor = vec4(col, 1.0);
}
`;

// The imperative surface the room's voice speaks to.
type SpringApi = {
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

export default function Spring() {
  const surfaceRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const apiRef = useRef<SpringApi | null>(null);
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
    const SEED = 0x5197;
    let state: SpringState = initState(SEED);
    let climate: Climate = { warmth: 0.4, wet: 0.55 };
    let cleared = false;
    let visited = false;
    let lastSeen = performance.now();
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<StoredSpring>;
        visited = true;
        cleared = parsed.cleared === true;
        if (
          typeof parsed.H === "number" &&
          typeof parsed.L === "number" &&
          typeof parsed.tau === "number" &&
          Array.isArray(parsed.seeps)
        ) {
          state = {
            H: parsed.H,
            L: parsed.L,
            tau: parsed.tau,
            seedKey: SEED,
            seeps: parsed.seeps
              .filter(
                (s) =>
                  s &&
                  Number.isFinite(s.x) &&
                  Number.isFinite(s.y) &&
                  Number.isFinite(s.throat),
              )
              .slice(0, MAX_SEEPS),
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
      /* fresh ground */
    }
    if (!visited && !cleared) {
      // a spring already breathing when you arrive — the aliveness claim
      setHasKept(state.seeps.some((s) => s.sealed));
    } else {
      setHasKept(state.seeps.some((s) => s.sealed));
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
        const payload: StoredSpring = {
          v: 1,
          H: state.H,
          L: state.L,
          tau: state.tau,
          seeps: state.seeps,
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
      label: "spring",
      wrap: surface.parentElement,
      overlay,
      renderScale: embedded ? 0.42 : 0.6,
      quality: embedded ? "medium" : "high",
      reducedMotion: reduced,
      embedded,
    });
    const prog = stage?.program(FULLSCREEN_VERT_UNIT, FRAG) ?? null;
    const quad = stage && prog ? stage.fullscreenQuad(prog, "unit") : null;

    // ——— the seep, as the shared scene model reads it ———
    // The ledger owns the seeps (springflow.ts) — physics stays where physics
    // lives. This SceneObjectSpec is the seep's declaration in the site's
    // shared vocabulary, and the population/layer below is the render half:
    // one instanced draw for every seep the pool holds.
    // waterline is captured by closure so a seep sitting below the pool
    // surface fades (the "the water reveals seeps as it drops" invariant).
    let waterlineU = 0.40;
    const seepSpec: SceneObjectSpec<SeepView> = {
      kind: "seep",
      cap: MAX_SEEPS,
      born(seed, nx, ny, tMs) {
        const rng = sceneMulberry32(seed);
        return {
          id: 0,
          seed,
          nx,
          ny,
          bornMs: tMs,
          growth: 0.4,
          sealedMs: null,
          presence: 1,
          throat: 0,
          flux: 0,
          sealed: false,
          phase: rng(),
        };
      },
      step(s, ctx) {
        // Growth eases toward 1 while the disc reads as growing under the
        // finger; the physics library is what actually moves the throat.
        if (s.growth < 1) s.growth = Math.min(1, s.growth + ctx.dt * 0.9);
      },
      emit(s, ctx, out) {
        const px = s.nx * ctx.width;
        const py = s.ny * ctx.height;
        const baseR = Math.max(2.5, ctx.width * 0.011);
        // Underwater seeps read dimmer — the pool's own reflection covers
        // them until the water drops. Above the waterline they read as full.
        const underwater = s.ny > waterlineU + 0.008 ? 1 : 0;
        const visibility = underwater
          ? 0.28 + s.throat * 0.35
          : 0.85 + s.throat * 0.15;
        const discAlpha = s.presence * visibility * (0.5 + s.growth * 0.5);
        // The seep's body: an ACCENT2-hued disc that reads warmer when sealed.
        out.push(
          px, py,
          baseR * (s.sealed ? 1.15 : 1),
          s.phase * Math.PI * 2,
          s.sealed ? 0.92 : 0.75,
          0.28 + s.throat * 0.28 + ctx.breath * 0.12,
          Math.sin(ctx.tMs * 0.001 * 1.4 + s.phase * Math.PI * 2) * 0.5 + 0.5,
          discAlpha,
        );
        // The corona: brightness monotone in flux — the load-bearing map.
        // (invert corona brightness and you recover this seep's live flux)
        const fluxBright = Math.min(1.6, Math.max(0, s.flux) * 4e4);
        if (fluxBright > 0.01) {
          out.push(
            px, py,
            baseR * 3.4,
            -s.phase * Math.PI * 2,
            0.4 + s.throat * 0.2,
            fluxBright,
            ctx.breath,
            s.presence * Math.min(1, fluxBright * 0.55) * (0.4 + visibility * 0.6),
          );
        }
      },
      // Verb routing lives on the imperative SpringApi below — the physics
      // library is the authority for a seep's state, and re-declaring the
      // handlers here would fork two truths. The room still gets one
      // instanced draw per frame via the population layer.
      verbs: [],
      respond: {},
    };
    const population = createPopulation(seepSpec);

    /**
     * The bubble — the room's second population (test-room-depth's density
     * floor: a room is a population, not one object in space). It answers
     * no verb; it is entirely a consequence of the seep population's own
     * flux, read every frame in `spawnBubblesFromSeeps` below. Rides the
     * same instanced draw as the seeps — one population per kind, one
     * `drawArraysInstanced` for both.
     */
    const bubbleSpec: SceneObjectSpec<BubbleView> = {
      kind: "bubble",
      cap: MAX_BUBBLES,
      born(seed, nx, ny, tMs) {
        const rng = sceneMulberry32(seed);
        return {
          id: 0,
          seed,
          nx,
          ny,
          bornMs: tMs,
          growth: 0.25,
          sealedMs: null,
          presence: 1,
          vy: 0.03 + rng() * 0.035,
          wobbleAmp: 0.006 + rng() * 0.01,
          wobbleFreq: 1.8 + rng() * 2.6,
          wobblePhase: rng() * Math.PI * 2,
          r0: 0.5 + rng() * 0.75,
          popping: false,
        };
      },
      step(s, ctx) {
        if (s.growth < 1) s.growth = Math.min(1, s.growth + ctx.dt * 2.4);
        if (s.popping) return;
        // rises buoyantly, wobbling on its own seeded sine — no ledger
        // input past the moment it was born
        s.ny -= s.vy * ctx.dt;
        s.nx += Math.sin(ctx.tMs * 0.001 * s.wobbleFreq + s.wobblePhase) * s.wobbleAmp * ctx.dt * 2;
        if (s.ny <= waterlineU - 0.006) {
          // pops the instant it breaks the surface — presence begins the
          // population's own graceful fade, never a blink-delete
          s.popping = true;
          s.presence = 0.999;
        }
      },
      emit(s, ctx, out) {
        const px = s.nx * ctx.width;
        const py = s.ny * ctx.height;
        const baseR = Math.max(1.4, ctx.width * 0.0048) * s.r0 * (s.popping ? 1.6 : 1);
        const bodyAlpha = s.presence * s.growth * (s.popping ? Math.max(0, s.presence) : 0.8);
        // the body: a small bright disc, almost pure glow — what a rising
        // bubble looks like against the dark
        out.push(px, py, baseR, s.wobblePhase, 0.94, 0.35 + ctx.breath * 0.15, ctx.breath, bodyAlpha * 0.75);
        // the halo: wider, fainter, flaring bright the instant it pops
        out.push(px, py, baseR * 3.2, -s.wobblePhase, 0.88, s.popping ? 1.0 : 0.2, ctx.breath, bodyAlpha * 0.3);
      },
      verbs: [],
      respond: {},
    };
    const bubblePopulation = createPopulation(bubbleSpec);
    // per-seep spawn budget: accumulates from the ledger's own flux, so the
    // timing is deterministic from state — no Math.random, no Date.now.
    const bubbleSpawnAcc = new Map<number, number>();
    const bubbleSpawnN = new Map<number, number>();
    const spawnBubblesFromSeeps = (dt: number, tMs: number) => {
      for (const s of state.seeps) {
        const fluxBright = Math.min(1.6, Math.max(0, s.flux) * 4e4);
        if (fluxBright <= 0.02) continue;
        const acc = (bubbleSpawnAcc.get(s.id) ?? 0) + fluxBright * BUBBLE_SPAWN_RATE * dt;
        if (acc >= 1) {
          const n = (bubbleSpawnN.get(s.id) ?? 0) + 1;
          bubbleSpawnN.set(s.id, n);
          const jitter = sceneMulberry32(hashSeed(s.id, n))();
          bubblePopulation.spawn(clamp01(s.x + (jitter - 0.5) * 0.03), s.y, tMs);
          bubbleSpawnAcc.set(s.id, acc - 1);
        } else {
          bubbleSpawnAcc.set(s.id, acc);
        }
      }
    };

    const populationLayer = stage
      ? createPopulationLayer(stage, {
          palette: ["#3f9dc2", "#e3ac57", "#d7f2fb"], // accent, accent2, glow
        })
      : null;
    const instanceBuffer = createInstanceBuffer(MAX_SEEPS * 2 + MAX_BUBBLES * 2);

    // ——— what the shader reads: one Float32Array each, allocated once ———
    const seepU = new Float32Array(MAX_SEEPS * 4);
    const rippleU = new Float32Array(MAX_RIPPLES * 4);
    const ripples: { x: number; y: number; t0: number; intensity: number }[] = [];

    // ——— per-frame context records for clocksFrom / population step+emit —
    // allocated once here, fields overwritten in place every frame in draw()
    // below, so the hot loop allocates no object literals per frame.
    const clocksInput = { time: 0, turbulence: 0, reducedMotion: false };
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

    // ——— the live axes the shader lens over, all continuous ———
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
    let dwellingSeepId: number | null = null;
    let dwellStartElapsed = 0;
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
      if (!inPoolBounds(nx, ny)) return;
      ripples.push({ x: nx, y: ny, t0: performance.now(), intensity: clamp01(intensity) });
      if (ripples.length > MAX_RIPPLES) ripples.shift();
    };

    const ringHere = (nx: number, ny: number, weight = 1) => {
      // the water rings at the local head — a smaller intensity, a smaller
      // ripple, and the pitch alone tells the head at this pool
      const hz = ringHzFor(state.H);
      try {
        audio.playTone(hz, 0.12 + weight * 0.18);
        haptics.ripple(0.3 + weight * 0.35);
      } catch {
        /* the sea is not awake */
      }
      pushRipple(nx, ny, 0.5 + weight * 0.4);
    };

    const soundSeep = (fluxScaled: number) => {
      const hz = ringHzFor(state.H);
      try {
        audio.playTone(hz + fluxScaled * 40, 0.16);
      } catch {
        /* noop */
      }
    };

    const chargeThroatFor = (elapsedMs: number) =>
      DWELL_THROAT_MAX * (1 - Math.exp(-Math.max(0, elapsedMs) / THROAT_WIDEN_TAU_MS));

    // ——— the hand's verbs, in this room's material ———
    // __SLOT_VERB_HANDLERS__
    const engine: SpringApi = {
      tap: (x, y, intensity, count, fingers) => {
        const { nx, ny } = toLocal(x, y);
        cursorX = nx;
        cursorY = ny;
        cursorLit = 1;
        // a two-finger tap steps the lens back; the shell also forwards it
        // through stepBack, but a room may hear the raw tap first
        if (fingers >= 2) return;
        // the rapid-tap ladder (1 / 3 / 5 / n), in pooled water: 1 rings the
        // head, 3 strikes the pool's chord, 5 shakes loose a breath of
        // bubbles, n sets the whole ledger ringing — wider with every tap
        const tier = tapTrainTier(count);
        if (tier === "n") {
          const crest = clamp01(0.5 + (count - 7) * 0.12 + intensity * 0.3);
          for (const s of state.seeps) pushRipple(s.x, s.y, 0.5 + crest * 0.4);
          pushRipple(nx, ny, 0.6 + crest * 0.4);
          stirTurbulence(0.1 + crest * 0.15);
          const hz = ringHzFor(state.H);
          try {
            audio.playTone(hz, 0.3 + crest * 0.3);
            audio.playTone(hz * (1.5 + crest * 0.5), 0.2 + crest * 0.2);
            haptics.roll();
          } catch {
            /* noop */
          }
          return;
        }
        if (tier === 5 && count === 5) {
          // trapped air shaken loose: a breath of bubbles rises from the tap
          // (only where there is water to rise through)
          const tMs = performance.now();
          for (let i = 0; i < 3; i++) {
            const bx = clamp01(nx + (i - 1) * 0.02);
            const by = clamp01(ny + 0.02);
            if (inPoolBounds(bx, by)) bubblePopulation.spawn(bx, by, tMs);
          }
          pushRipple(nx, ny, 0.6 + intensity * 0.3);
          const hz = ringHzFor(state.H);
          try {
            audio.playTone(hz * 2, 0.18 + intensity * 0.15);
            audio.playTone(hz * 3, 0.1);
            haptics.chop();
          } catch {
            /* noop */
          }
          return;
        }
        if (tier === 3 && count === 3) {
          // the pool's chord: fundamental, fifth and octave of the live head,
          // three rings widening from the strike
          const hz = ringHzFor(state.H);
          for (let i = 0; i < 3; i++) {
            pushRipple(nx, ny, 0.3 + i * 0.15 + intensity * 0.2);
            try {
              audio.playTone(hz * [1, 1.5, 2][i], 0.14 + intensity * 0.1);
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
        const found = nearestSeep(state, nx, ny, 0.08);
        if (found) {
          soundSeep(found.flux);
          pushRipple(found.x, found.y, 0.7);
          haptics.tap();
          return;
        }
        // deep water rings low; the pitch is the local head, always
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
        // one chord across the whole ledger — every seep rings at once
        for (const s of state.seeps) {
          pushRipple(s.x, s.y, 0.6);
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
        if (!inPoolBounds(nx, ny)) {
          try {
            audio.refuse();
          } catch {
            /* noop */
          }
          return;
        }
        state = plantSeep(state, nx, ny, 0);
        const planted = state.seeps[state.seeps.length - 1];
        if (planted) {
          dwellingSeepId = planted.id;
          dwellStartElapsed = 0;
        }
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
        if (dwellingSeepId === null) return;
        // duration is an axis: the throat widens with an increasing but
        // saturating function of elapsed. Sampled per hold-tick — 250ms.
        const now = performance.now();
        if (now - lastDeepenAt < 60) return;
        lastDeepenAt = now;
        const target = chargeThroatFor(elapsed);
        const current = state.seeps.find((s) => s.id === dwellingSeepId)?.throat ?? 0;
        const dtheta = Math.max(0, target - current);
        if (dtheta <= 0) return;
        state = deepenSeep(state, dwellingSeepId, dtheta);
        void x;
        void y;
        void tier;
        // the pitch stays the same until the exchange begins to move H — the
        // hand hears the *seep* filling, not the aquifer answering
        try {
          audio.playTone(ringHzFor(state.H) * (1 + elapsed / 26000), 0.05);
        } catch {
          /* noop */
        }
      },
      ceremony: (x, y) => {
        if (dwellingSeepId === null) {
          const { nx, ny } = toLocal(x, y);
          const found = nearestSeep(state, nx, ny, 0.14);
          if (!found) {
            try {
              audio.refuse();
            } catch {
              /* noop */
            }
            return;
          }
          dwellingSeepId = found.id;
        }
        state = sealSeep(state, dwellingSeepId);
        setHasKept(true);
        pushRipple(cursorX, cursorY, 1);
        try {
          audio.bell();
          audio.playTone(ringHzFor(state.H), 0.6);
          haptics.bloom();
        } catch {
          /* noop */
        }
        dwellingSeepId = null;
        dwellStartElapsed = 0;
        writer.schedule();
      },
      settle: (elapsed, x, y, tier) => {
        // a hold that lifted before the ceremony tier: the throat keeps
        // whatever it had, but stops growing. Only clear the dwell handle.
        void elapsed;
        void x;
        void y;
        void tier;
        if (tier < 3) dwellingSeepId = null;
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
        // the surface film slides: a linear pool-tilt proportional to dx/dy.
        // The ledger is unchanged — a shear on the surface, not a leak.
        stir = Math.min(1, stir + (Math.abs(dx) + Math.abs(dy)) / 4000);
        if (phase === "move" && Math.hypot(dx, dy) > 6) {
          pushRipple(nx, ny, 0.25);
        }
      },
      wind: (dx, dy) => {
        // world-law: down is rain, across is evaporation. Both bounded so a
        // maximal drag cannot take W below zero or E above the sun's limit.
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
        // the standing bubble at that point: a cast bell over the water, the
        // ring the head that shaped it. Mass-conserving — the bubble carries
        // the pitch it had, and its ring writes as a strong wavefront.
        pushRipple(nx, ny, Math.min(1, 0.5 + speed / 8));
        const hz = ringHzFor(state.H);
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
        // turn the year through the shared warmth axis. Every angle is a slice
        // of the year; advanceExact catches the ledger up on the closed form.
        const span = Math.abs(angle) * 24 * 3600; // an angle turn ≈ a day
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
        // two hands alternating: the wave field between them sings its beat.
        // Ring at both zones and let the pool's own hydraulics do the mixing.
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
        // the surface scatters — every ripple wavefront agitates at once,
        // and the shared turbulence axis rises for the whole site
        stirTurbulence(clamp01(intensity) * 0.6);
        for (const s of state.seeps) pushRipple(s.x, s.y, 0.4 + intensity * 0.4);
      },
      gravity: (gamma) => {
        leanTarget = reduced ? 0 : clamp(gamma / 48, -1, 1);
      },
      knock: (intensity) => {
        // a struck stone rings the pool at ringHzFor(H) — the aquifer's own
        // pitch, not a decoration
        try {
          const hz = ringHzFor(state.H);
          audio.playTone(hz, 0.6 + intensity * 0.3);
          audio.playTone(hz * 0.5, 0.4);
          haptics.detent();
        } catch {
          /* noop */
        }
        for (const s of state.seeps) pushRipple(s.x, s.y, 0.6 + intensity * 0.3);
      },
      night: (faceDown) => {
        nightTarget = faceDown ? 1 : 0;
      },
      glimmer: () => {
        // one seep breathes a wider ring, alone, and nothing is said
        const s = state.seeps.length > 0
          ? state.seeps[Math.floor(state.tau * 977) % state.seeps.length]
          : null;
        if (s) pushRipple(s.x, s.y, 0.35);
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
        // enter is a tap at the cursor
        ringHere(cursorX, cursorY, 0.6);
      },
      keyHold: (elapsed) => {
        // held enter is a keyboard dwell — plant on first tick, then deepen.
        // At tier ceremony the hold seals.
        if (dwellingSeepId === null && inPoolBounds(cursorX, cursorY)) {
          state = plantSeep(state, cursorX, cursorY, 0);
          const planted = state.seeps[state.seeps.length - 1];
          if (planted) dwellingSeepId = planted.id;
        }
        if (dwellingSeepId !== null) {
          const target = chargeThroatFor(elapsed);
          const current = state.seeps.find((s) => s.id === dwellingSeepId)?.throat ?? 0;
          if (target > current) {
            state = deepenSeep(state, dwellingSeepId, target - current);
          }
        }
        kbCharge = clamp01(elapsed / 2400);
        if (kbCharge >= 1 && dwellingSeepId !== null) {
          state = sealSeep(state, dwellingSeepId);
          setHasKept(true);
          try {
            audio.bell();
            haptics.bloom();
          } catch {
            /* noop */
          }
          dwellingSeepId = null;
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
        dwellingSeepId = null;
      },
      clear: () => {
        cleared = true;
        state = {
          ...state,
          seeps: [],
        };
        bubblePopulation.letGo();
        bubbleSpawnAcc.clear();
        bubbleSpawnN.clear();
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
    void dwellStartElapsed;

    /**
     * Pull every seep out of the physics ledger into the shared population's
     * items array. The item-per-seep is preserved across frames by matching
     * `id` — new seeps spawn, seeps that vanished from the ledger start
     * retiring (population.step decrements presence). Items are stable
     * objects; only their fields update per frame.
     */
    const syncPopulationFromLedger = (now: number) => {
      const items = population.items;
      const ledger: Seep[] = state.seeps;
      // Mark items whose seep is gone as retiring — the population's own
      // step will fade them out gracefully.
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.presence < 1) continue;
        if (!ledger.some((s) => s.id === item.id)) item.presence = 0.999;
      }
      // Upsert every live seep.
      for (const seep of ledger) {
        let item = items.find((it) => it.id === seep.id && it.presence >= 1);
        if (!item) {
          item = {
            id: seep.id,
            seed: hashSeed(state.seedKey, seep.id),
            nx: seep.x,
            ny: seep.y,
            bornMs: now,
            growth: 0.05,
            sealedMs: seep.sealed ? now : null,
            presence: 1,
            throat: seep.throat,
            flux: seep.flux,
            sealed: seep.sealed,
            phase: seep.phase,
          };
          items.push(item);
        } else {
          item.nx = seep.x;
          item.ny = seep.y;
          item.throat = seep.throat;
          item.flux = seep.flux;
          item.sealed = seep.sealed;
          item.phase = seep.phase;
          if (seep.sealed && item.sealedMs === null) item.sealedMs = now;
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
      // Closed form, one call per frame — never a catch-up loop.
      if (!asleep) {
        state = advanceExact(state, dtRaw * timeScale * WATCHED_SPEED, climate);
        // the bubble population's only input: real elapsed time (not the
        // ledger's fast-forwarded seconds), so an open seep bubbles at a
        // rate a hand can actually watch, not sixty times a second.
        spawnBubblesFromSeeps(dtRaw, now);
      }
      lastSeen = now;

      // idle write: only if the writer's cadence allows
      if (now - lastSaveAt > SAVE_EVERY_MS) {
        lastSaveAt = now;
        writer.schedule();
      }

      if (stage && prog && quad && !stage.contextLost() && !asleep) {
        prog.use();
        clocksInput.time = reduced ? 12 : t;
        clocksInput.turbulence = agitation;
        clocksInput.reducedMotion = reduced;
        stage.beginFrame(clocksFrom(clocksInput), prog);
        // seep uniform: xy pos, flux, phase
        let sN = 0;
        for (const s of state.seeps) {
          if (sN >= MAX_SEEPS) break;
          seepU[sN * 4] = s.x;
          seepU[sN * 4 + 1] = s.y;
          seepU[sN * 4 + 2] = Math.max(0, s.flux);
          seepU[sN * 4 + 3] = s.phase;
          sN++;
        }
        // ripple uniform: xy pos, age, intensity
        let rN = 0;
        for (let i = ripples.length - 1; i >= 0; i--) {
          const age = (now - ripples[i].t0) / 1000;
          if (age > 3.5) {
            ripples.splice(i, 1);
          }
        }
        for (const r of ripples) {
          if (rN >= MAX_RIPPLES) break;
          rippleU[rN * 4] = r.x;
          rippleU[rN * 4 + 1] = r.y;
          rippleU[rN * 4 + 2] = (now - r.t0) / 1000;
          rippleU[rN * 4 + 3] = r.intensity;
          rN++;
        }
        prog.setInt("uSeepCount", sN);
        prog.setInt("uRippleCount", rN);
        prog.setVec4("uClimate", climate.warmth, climate.wet, state.H, state.L);
        prog.setFloat("uLean", lean);
        prog.setFloat("uNight", night);
        prog.setFloat("uStir", stir);
        prog.setFloat("uLens", lens);
        const seepLoc = prog.location("uSeeps[0]");
        if (seepLoc) stage.gl.uniform4fv(seepLoc, seepU);
        const rippleLoc = prog.location("uRipples[0]");
        if (rippleLoc) stage.gl.uniform4fv(rippleLoc, rippleU);
        quad.draw();

        // ——— the seeps, as one instanced draw ———
        // Sync the shared population from the ledger — the physics is the
        // authority, the population is the render view. Then step it once
        // (so retiring items ride out their fade) and emit every seep into
        // the shared instance buffer.
        waterlineU = clamp01(0.40 + (0.55 - clamp01(state.L)) * 0.06);
        syncPopulationFromLedger(now);
        stepCtx.dt = Math.min(0.05, dtRaw);
        stepCtx.tMs = now;
        stepCtx.agitation = agitation;
        stepCtx.timeScale = timeScale;
        stepCtx.reducedMotion = reduced;
        population.step(stepCtx);
        bubblePopulation.step(stepCtx);
        emitCtx.width = stage.size.width;
        emitCtx.height = stage.size.height;
        emitCtx.tMs = now;
        emitCtx.breath = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t * Math.PI * 2 / 7);
        emitCtx.reducedMotion = reduced;
        // both populations write into the SAME buffer — one instanced draw
        // for the whole room's countable material, seeps and bubbles alike.
        instanceBuffer.reset();
        population.emit(emitCtx, instanceBuffer);
        bubblePopulation.emit(emitCtx, instanceBuffer);
        populationLayer?.draw(instanceBuffer);
      }

      // ——— the twist lens: the ledger, drawn back off the water ———
      const octx = stage?.overlay2d ?? null;
      if (octx) {
        const r = surface.getBoundingClientRect();
        const w = r.width;
        const h = r.height;
        octx.clearRect(0, 0, w, h);

        if (lens > 0.02) {
          octx.globalAlpha = lens;
          const pad = 16;
          const barY = h - 90;
          // H bar
          octx.fillStyle = "rgba(105, 175, 200, 0.55)";
          octx.fillRect(pad, barY, Math.min(180, w - pad * 2) * clamp01(state.H), 8);
          // L bar
          octx.fillStyle = "rgba(200, 190, 130, 0.55)";
          octx.fillRect(pad, barY + 14, Math.min(180, w - pad * 2) * clamp01(state.L), 8);
          // weir line
          const barW = Math.min(180, w - pad * 2);
          const lipX = pad + barW * 0.85;
          octx.strokeStyle = "rgba(230, 220, 190, 0.7)";
          octx.beginPath();
          octx.moveTo(lipX, barY + 12);
          octx.lineTo(lipX, barY + 24);
          octx.stroke();
          octx.font = "300 10px ui-monospace, 'SF Mono', Menlo, monospace";
          octx.textAlign = "left";
          octx.fillStyle = "rgba(230, 239, 232, 0.7)";
          octx.fillText(
            `H ${state.H.toFixed(2)}  L ${state.L.toFixed(2)}  ` +
              `${ringHzFor(state.H).toFixed(0)}hz`,
            pad,
            barY + 44,
          );
          octx.fillText(
            `warmth ${climate.warmth.toFixed(2)}  wet ${climate.wet.toFixed(2)}  ` +
              `${state.seeps.length} seeps`,
            pad,
            barY + 58,
          );
          octx.globalAlpha = 1;
        }

        // cursor for keyboard readers
        if (cursorLit > 0.01) {
          octx.strokeStyle = `rgba(233, 238, 232, ${(0.4 * cursorLit).toFixed(3)})`;
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
  // express (arpeggio, breath, rhythm) fall through to the shell defaults.
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
      // rhythm, arpeggio, breath: the pool's material has no beat entrainment,
      // no staggered chord, and no candle-owned inhalation — the shell's
      // defaults answer them with two-senses acknowledgement, as designed.
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
      route="/spring"
      surfaceRef={surfaceRef}
      voice={voice}
      keyboard={keyboard}
      onGlimmer={() => apiRef.current?.glimmer()}
      onReducedMotion={(on) => apiRef.current?.reduced(on)}
      letGo={{ label: "let the spring rest", onLetGo: letGo, visible: hasKept }}
      style={{ position: "fixed", inset: 0, background: "#060a10" }}
    >
      <canvas
        ref={surfaceRef}
        role="application"
        tabIndex={0}
        aria-label="a hand's width of wet ground, in section — the aquifer ringing at its head"
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

void headForRingHz;
void totalWater;
void MAX_THROAT;
void POOL_Y_MIN;
void POOL_Y_MAX;
