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

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);

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

// The palette — six registers set once, from the manifest.
const vec3 BG      = vec3(0.020, 0.039, 0.047); // wet dark under water
const vec3 BG2     = vec3(0.055, 0.145, 0.188); // pool's deep column
const vec3 GLOW    = vec3(0.663, 0.847, 0.902); // sunlit water surface
const vec3 ACCENT  = vec3(0.290, 0.569, 0.659); // water in motion
const vec3 ACCENT2 = vec3(0.788, 0.725, 0.533); // mineral bloom at the wet edge
const vec3 INK     = vec3(0.902, 0.937, 0.910);
const vec3 SKY     = vec3(0.024, 0.055, 0.078);

const float HORIZON       = 0.32;
const float WATERLINE_MID = 0.42;
const float POOL_FLOOR    = 0.94;
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
  return WATERLINE_MID + (0.55 - lFrac) * 0.10 + wave;
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  float aspect = uRes.x / max(1.0, uRes.y);
  float night = uNight;
  vec3 col;

  // ——— the air ———
  if (uv.y < HORIZON) {
    float k = uv.y / HORIZON;
    // Snell approximation: the pool's ceiling is the sky's colour, dimmed
    vec3 airCol = mix(SKY, GLOW * 0.6, k * k * (1.0 - uTurbulence * 0.4));
    // a slow breath in the dawn column
    airCol *= 0.86 + 0.14 * uBreath;
    col = airCol * (1.0 - night * 0.72);
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  float wl = waterlineY(uv.x, uTime);
  bool inPool = uv.x > POOL_XMIN && uv.x < POOL_XMAX && uv.y > wl && uv.y < POOL_FLOOR;

  if (inPool) {
    // ——— underwater depth: BG at the surface, BG2 at the floor ———
    float d = (uv.y - wl) / max(0.02, POOL_FLOOR - wl);
    col = mix(BG, BG2, d * d);

    // Snell surface highlight — a low-angle reflection of the sky palette
    float surf = exp(-pow((uv.y - wl) * 90.0, 2.0));
    float breath = 0.85 + 0.15 * uBreath;
    col += GLOW * surf * 0.55 * breath * (1.0 - night * 0.85);

    // ——— ripple wavefronts from taps and flicks (gaussian rings) ———
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
    col += ACCENT * wave * 0.6;

    // ——— continuous seep pulses: one ring per phase, per seep ———
    float seepWave = 0.0;
    for (int i = 0; i < ${MAX_SEEPS}; i++) {
      if (i >= uSeepCount) break;
      vec4 s = uSeeps[i];
      float phase = fract(s.w + uTime * 0.28);
      float rad = phase * 0.42;
      vec2 dp = (uv - s.xy) * vec2(aspect, 1.0);
      float dist = length(dp);
      float ring = exp(-pow((dist - rad) * 26.0, 2.0));
      // fade the ring out as it ages, so the wave dies at the pool wall
      seepWave += ring * (1.0 - phase) * clamp(s.z * 3.0e4, 0.0, 1.0);
    }
    col += ACCENT * seepWave * 0.55;

    // ——— stir: the pool spins under a scrubbing finger, decays to still ———
    if (uStir > 0.02) {
      vec2 sp = (uv - vec2(0.5, wl + 0.14)) * vec2(aspect, 1.0);
      float ang = atan(sp.y, sp.x);
      float rr = length(sp);
      col += ACCENT * uStir * 0.22 * sin(ang * 4.0 + uTime * 3.0)
              * exp(-rr * rr * 8.0);
    }

    col *= 1.0 - night * 0.55;
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  // ——— the wet ground: moisture bands drying upward ———
  float distToWL = uv.y - wl;
  // wettest along the waterline, drying with exp(-y/λ). The moisture band
  // reads directly off the pool level: a fuller pool wets more ground.
  float lambda = 0.14 + uClimate.y * 0.06;
  float moisture = exp(-max(0.0, distToWL) / lambda);
  moisture *= 1.0 - smoothstep(0.85, 1.0, uv.y) * 0.6; // fade at the floor

  vec3 dry = vec3(0.075, 0.058, 0.048);
  vec3 wet = vec3(0.038, 0.058, 0.072);
  col = mix(dry, wet, moisture);

  // grain
  vec2 gp = floor(uv * uRes * 0.45);
  col *= 0.86 + 0.28 * hash21(gp);

  // horizontal moisture bands — layering, wet more so under the waterline
  float band = fbm(vec2(uv.x * 3.4, uv.y * 22.0 + uTime * 0.02));
  col *= 0.86 + 0.22 * band;

  // mineral bloom at the wet edge — value-noise FBM modulated by moisture
  float bloom = fbm(uv * vec2(30.0 * aspect, 30.0) + vec2(uv.y * 4.0, 0.0));
  float bloomBand = smoothstep(0.18, 0.45, moisture) * (1.0 - smoothstep(0.55, 0.9, moisture));
  col += ACCENT2 * bloom * bloomBand * 0.9 * (0.6 + uBreath * 0.4);

  // ——— every seep, as an SDF disc plus an additive corona ———
  // Load-bearing map: corona brightness = flux, monotone. Invert the halo
  // and you recover what the ledger is doing at that seep.
  for (int i = 0; i < ${MAX_SEEPS}; i++) {
    if (i >= uSeepCount) break;
    vec4 s = uSeeps[i];
    vec2 dp = (uv - s.xy) * vec2(aspect, 1.0);
    float dist = length(dp);
    float r = 0.018;
    float disc = smoothstep(r + 0.006, r - 0.002, dist);
    col = mix(col, ACCENT2 * 0.9, disc * 0.72);
    // corona: brightness monotone in flux (uSeeps[i].z is H-units/s)
    float fluxBright = clamp(s.z * 4.0e4, 0.0, 1.6);
    float corona = exp(-dist * dist * 60.0) * fluxBright;
    col += ACCENT * corona * 0.6 + GLOW * corona * 0.18;
  }

  // vignette + night
  vec2 vd = (uv - vec2(0.5, 0.5)) * vec2(aspect, 1.0);
  col *= 1.0 - 0.52 * smoothstep(0.18, 0.94, dot(vd, vd));
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

    // ——— what the shader reads: one Float32Array each, allocated once ———
    const seepU = new Float32Array(MAX_SEEPS * 4);
    const rippleU = new Float32Array(MAX_RIPPLES * 4);
    const ripples: { x: number; y: number; t0: number; intensity: number }[] = [];

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
      }
      lastSeen = now;

      // idle write: only if the writer's cadence allows
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
      style={{ position: "fixed", inset: 0, background: "#050a0c" }}
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

void hashSeed;
void headForRingHz;
void totalWater;
void MAX_THROAT;
void POOL_Y_MIN;
void POOL_Y_MAX;
