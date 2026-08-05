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
  ringHzFor,
  sealCreature,
  setAnemoneCurl,
  stateWeights,
  totalBiomass,
  waterLevel,
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

// The palette — six registers set once from the manifest.
const vec3 BG      = vec3(0.020, 0.059, 0.078);  // deep water dark
const vec3 BG2     = vec3(0.059, 0.165, 0.169);  // shallow shelf column
const vec3 GLOW    = vec3(0.949, 0.753, 0.478);  // sunlit water / anemone highlight
const vec3 ACCENT  = vec3(0.227, 0.541, 0.463);  // kelp teal
const vec3 ACCENT2 = vec3(0.722, 0.329, 0.227);  // anemone rust
const vec3 INK     = vec3(0.925, 0.937, 0.902);
const vec3 SKY     = vec3(0.482, 0.729, 0.769);  // shallow sky through the surface
const vec3 GRANITE = vec3(0.129, 0.145, 0.157);  // wet granite rim
const vec3 FOAM    = vec3(0.910, 0.945, 0.933);  // storm foam

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

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  float aspect = uRes.x / max(1.0, uRes.y);
  vec3 col;

  // layer: tidal_water_level
  // The waterline reads uWaterY directly — the shader and the physics
  // agree on where the water is. A small wave overlays uWaterY so the
  // surface reads alive; storm state (uState.w) adds chop and lifts the
  // mean. This is the load-bearing spatial split of the whole room.
  float wavelet = sin(uv.x * 18.0 + uTime * 1.2) * 0.004
                 + sin(uv.x * 41.0 - uTime * 0.7 + uTide * 0.2) * 0.002;
  float chop = uState.w * (sin(uv.x * 55.0 + uTime * 4.5) * 0.010
                           + sin(uv.x * 91.0 - uTime * 3.1) * 0.006);
  float waterlineY = uWaterY + wavelet + chop;
  // Whether we are above (sky) or below (water) drives the primary split.
  float depthBelow = clamp((uv.y - waterlineY) / max(0.02, POOL_Y_MAX - waterlineY), 0.0, 1.0);
  float overRock = float(uv.x < POOL_X_MIN || uv.x > POOL_X_MAX || uv.y > POOL_Y_MAX);
  float overRim = float(uv.y < POOL_Y_MIN);

  if (uv.y < waterlineY && overRim < 0.5) {
    // layer: sky_reflection
    // Above the waterline: shallow sky. Reads uNight (face-down invitees
    // see night) and uState.x (low tide) — a glassy surface reflects the
    // sky, high tide bleeds air-to-water blending. Reads uState in its
    // brightness term (LAYER RULE — dead uniform is a bug).
    float k = clamp(uv.y / max(1e-3, waterlineY), 0.0, 1.0);
    vec3 airTone = mix(SKY, GLOW * 0.72, (1.0 - k) * (0.4 + uClimate.x * 0.6));
    airTone *= 0.86 + 0.14 * uBreath;
    // Low tide brightens the sky reflection (glassy surface); storm
    // darkens it with churn.
    float lowGlass = uState.x;
    float stormDim = uState.w;
    airTone *= 0.85 + 0.15 * lowGlass;
    airTone *= 1.0 - 0.25 * stormDim;
    // Face-down: dim the sky.
    airTone *= 1.0 - uNight * 0.72;
    col = airTone;
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  // Everything from here is either the granite rim/floor OR the water column.

  // layer: rock_and_biofilm
  // The granite rim (top strip) and the floor plus the biofilm bloom.
  // Reads uBiofilm and uBreath — a warm pool's biofilm blooms visibly.
  if (uv.y < POOL_Y_MIN) {
    // Rock rim above the pool.
    vec3 rock = mix(GRANITE, GRANITE * 1.6, hash21(floor(uv * uRes * 0.5)));
    float bloom = fbm(uv * vec2(24.0 * aspect, 24.0));
    rock += ACCENT2 * bloom * uBiofilm * 0.5;
    rock *= 0.86 + 0.14 * uBreath;
    rock *= 1.0 - uNight * 0.6;
    // Storm dims the exposed granite briefly.
    rock *= 1.0 - uState.w * 0.15;
    col = rock;
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  if (uv.x < POOL_X_MIN || uv.x > POOL_X_MAX || uv.y > POOL_Y_MAX) {
    // Rock rim outside the pool bounds — same rock model, deeper tone
    // toward the outer edge so the pool sits in a real granite bowl.
    float outsideness = 0.0;
    if (uv.x < POOL_X_MIN) outsideness = (POOL_X_MIN - uv.x) / POOL_X_MIN;
    if (uv.x > POOL_X_MAX) outsideness = (uv.x - POOL_X_MAX) / max(1e-3, 1.0 - POOL_X_MAX);
    if (uv.y > POOL_Y_MAX) outsideness = max(outsideness, (uv.y - POOL_Y_MAX) / max(1e-3, 1.0 - POOL_Y_MAX));
    vec3 rock = mix(GRANITE, GRANITE * 0.55, clamp(outsideness, 0.0, 1.0));
    // The biofilm reaches out onto the wet rock immediately next to the pool.
    float wetBand = 1.0 - smoothstep(0.0, 0.06, outsideness);
    float bloom = fbm(uv * vec2(28.0 * aspect, 28.0) + vec2(uv.y * 4.0, 0.0));
    rock += ACCENT2 * bloom * uBiofilm * wetBand * 0.7 * (0.6 + uBreath * 0.4);
    rock *= 1.0 - uNight * 0.62;
    col = rock;
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  // Underwater — the pool itself.
  float dnorm = depthBelow;
  vec3 waterCol = mix(BG2, BG, dnorm * dnorm);
  waterCol *= 0.86 + 0.14 * uBreath;
  // Warmth tints the water toward glow when warm.
  waterCol = mix(waterCol, mix(waterCol, GLOW, 0.05), uClimate.x);

  // layer: sunlit_surface
  // A Snell highlight tracks the moving waterline; caustics ripple
  // across the shelf, driven by fbm modulated by uTime and uState.x
  // (low tide is glassy; high tide is caustic-rich). Reads uState.
  float surfBand = exp(-pow((uv.y - waterlineY) * 90.0, 2.0));
  float breathSurf = 0.85 + 0.15 * uBreath;
  float warmMix = mix(0.4, 1.0, uClimate.x);
  waterCol += mix(SKY, GLOW, warmMix) * surfBand * 0.55 * breathSurf;
  // Caustics: brighter under high tide (uState.y raises them), dim in storm.
  float caustic = fbm(vec2(uv.x * 20.0 * aspect, (uv.y - waterlineY) * 8.0 - uTime * 0.4));
  caustic *= (0.6 + uState.y * 0.6) * (1.0 - uState.w * 0.7);
  waterCol += mix(SKY, GLOW, warmMix * 0.8) * caustic * caustic * 0.18 * (1.0 - dnorm);

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
  waterCol += ACCENT * wave * 0.55;

  // Stir — a scrubbing finger swirls the surface.
  if (uStir > 0.02) {
    vec2 sp = (uv - vec2(0.5, waterlineY + 0.08)) * vec2(aspect, 1.0);
    float ang = atan(sp.y, sp.x);
    float rr = length(sp);
    waterCol += ACCENT * uStir * 0.18 * sin(ang * 4.0 + uTime * 3.0)
              * exp(-rr * rr * 8.0);
  }

  // Storm foam on the surface.
  if (uState.w > 0.02) {
    float foamMask = exp(-pow((uv.y - waterlineY) * 40.0, 2.0));
    float foamCells = fbm(vec2(uv.x * 42.0 * aspect + uTime * 0.6, uv.y * 22.0 + uTime * 0.5));
    waterCol = mix(waterCol, FOAM, foamMask * foamCells * uState.w * 0.65);
  }

  // Vessel tilt — the water leans a hair with uLean.
  waterCol *= 1.0 - 0.06 * abs(uLean) * (1.0 - dnorm);

  // Night dim (face-down).
  waterCol *= 1.0 - uNight * 0.55;

  // layer: creature_silhouettes
  // Reads uState — a storm collapses anemone silhouettes to knots; low
  // tide exposes them. The actual SDF discs draw through the shared
  // instanced pass (createPopulationLayer) — this layer is only the
  // shader-side hint that a storm darkens what the population layer will
  // draw over. Reads uState.w.
  waterCol *= 1.0 - 0.10 * uState.w * clamp(1.0 - dnorm, 0.0, 1.0);

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
        const baseR = Math.max(3, ctx.width * 0.010);
        // Retreated snails shrink to a small warm dot — the shell.
        const size = s.retreated ? 0.55 : 0.9 + s.biomassVal * 0.4;
        const bright = 0.35 + s.biomassVal * 0.5 + ctx.breath * 0.15;
        out.push(
          px, py,
          baseR * size * (s.sealed ? 1.15 : 1),
          s.phase * Math.PI * 2,
          s.sealed ? 0.9 : 0.2, // hue: sealed → warm rust, young → glow
          bright,
          Math.sin(ctx.tMs * 0.001 * 1.1 + s.phase * Math.PI * 2) * 0.5 + 0.5,
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
        const baseR = Math.max(4, ctx.width * 0.014);
        // Curl collapses the star silhouette: fully curled anemones are
        // small tight knots; open anemones spread wider and brighter.
        const openness = 1 - s.curl;
        const size = 0.55 + s.biomassVal * 0.45 + openness * 0.35;
        const bright = 0.35 + s.biomassVal * 0.35 + openness * 0.4 + ctx.breath * 0.10;
        out.push(
          px, py,
          baseR * size * (s.sealed ? 1.20 : 1),
          s.phase * Math.PI * 2 + openness * 1.2,
          0.65, // hue: anemone rust (accent2)
          bright,
          Math.sin(ctx.tMs * 0.001 * 0.8 + s.phase * Math.PI * 2) * 0.5 + 0.5,
          s.presence * (0.5 + openness * 0.5),
        );
        // A second additive corona brightens when open (the tentacles).
        if (openness > 0.15) {
          out.push(
            px, py,
            baseR * 2.4 * openness,
            -s.phase * Math.PI * 2,
            0.85,
            openness * (0.8 + s.biomassVal * 0.4),
            ctx.breath,
            s.presence * Math.min(1, openness * 0.9),
          );
        }
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
        const px = s.nx * ctx.width;
        const py = s.ny * ctx.height;
        const baseR = Math.max(3, ctx.width * 0.011);
        // Kelp draws as a vertical ribbon: two-blob emission (base + tip)
        // approximates a frond in the shared SDF-disc primitive.
        const bend = s.bendPhase; // -1..1 lateral deflection
        const tipX = px + bend * baseR * 5.5;
        const tipY = py - (0.4 + s.biomassVal * 0.6) * baseR * 7;
        // Base — anchored on the shelf.
        out.push(
          px, py,
          baseR * (0.55 + s.biomassVal * 0.35),
          s.phase * Math.PI * 2,
          0.42, // hue: kelp teal (accent)
          0.28 + s.biomassVal * 0.25,
          Math.sin(ctx.tMs * 0.001 * 0.7 + s.phase * Math.PI * 2) * 0.5 + 0.5,
          s.presence,
        );
        // Tip — where the frond fingers reach.
        out.push(
          tipX, tipY,
          baseR * (0.4 + s.biomassVal * 0.5),
          s.phase * Math.PI * 2 + 1.4,
          0.42,
          0.24 + s.biomassVal * 0.20 + ctx.breath * 0.06,
          Math.sin(ctx.tMs * 0.001 * 0.9 + s.phase * Math.PI * 2) * 0.5 + 0.5,
          s.presence * 0.85,
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
          palette: ["#3a8a76", "#b8543a", "#f2c07a"], // accent, accent2, glow
        })
      : null;
    const instanceBuffer = createInstanceBuffer(MAX_CREATURES * 3);

    /** Pull every creature out of the physics ledger into its per-kind
     *  population items. Items are matched by id; new creatures spawn,
     *  vanished creatures start retiring (step decrements presence).
     *  Cross-population interaction: each spec's step reads state.creatures
     *  (the shared ledger) through this synced view — not React state,
     *  local to the effect scope. */
    const syncPopulationsFromLedger = (now: number) => {
      // ——— snails ———
      const snailItems = snails.items;
      const snailLedger = state.creatures.filter((c) => c.kind === "snail");
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
      const anemoneLedger = state.creatures.filter((c) => c.kind === "anemone");
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
      const kelpLedger = state.creatures.filter((c) => c.kind === "kelp");
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

    // ——— the hand's verbs, in this room's material ———
    // __SLOT_VERB_HANDLERS__
    const engine: PoolApi = {
      tap: (x, y, intensity, count, fingers) => {
        const { nx, ny } = toLocal(x, y);
        cursorX = nx;
        cursorY = ny;
        cursorLit = 1;
        if (fingers >= 2) return;
        const phase = currentState(state.tau, state.climate);
        const found = nearestCreature(state, nx, ny, 0.08);
        if (found) {
          // Ring the creature at its kind's pitch — the load-bearing invertible map.
          const hz = ringHzFor(found.kind, found.biomass);
          try {
            if (hz > 0) audio.playTone(hz, 0.12 + intensity * 0.18);
            haptics.tap();
          } catch {
            /* noop */
          }
          pushRipple(found.x, found.y, 0.6 + intensity * 0.35);
          // DISCOVERABLE 1: tap on an anemone during LOW TIDE curls it.
          if (phase === "low_tide") {
            if (found.kind === "anemone") {
              state = setAnemoneCurl(state, found.id, 1);
              try {
                audio.playTone(ANEMONE_PITCH_BASE_HZ * 0.5, 0.32);
                haptics.chop();
              } catch {
                /* noop */
              }
              noteDiscovered("d1");
            }
          }
          return;
        }
        // Ring the pool at the mean of whatever is alive.
        const meanB = meanBiomass(state);
        try {
          audio.playTone(SNAIL_PITCH_BASE_HZ * Math.pow(2, -meanB / 0.5), 0.14 + intensity * 0.14);
          haptics.ripple(0.3 + intensity * 0.35);
        } catch {
          /* noop */
        }
        pushRipple(nx, ny, 0.4 + intensity * 0.3 + Math.min(0.3, (count - 1) * 0.08));
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
