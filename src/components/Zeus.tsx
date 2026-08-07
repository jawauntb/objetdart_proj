"use client";

/**
 * Zeus — the peak ring's fourth seat: the charged sky as the mountain's king.
 *
 * /storm owns the meteorology of a storm — pressure, charge, discharge as
 * weather. This room is the same sky held as governance: thunderheads gather
 * under a dwell, court each other by induction (lib/zeussky attraction),
 * merge into greater houses when their anvils touch, and spend themselves in
 * one bolt to the ridge. The thunder is the ledger — thunderHz inverts, so a
 * listener reads the size of every strike off its pitch alone.
 *
 * The material is a fragment shader (sky, ridge, flash, ridge-scorch) plus
 * a 2D overlay for the bolt itself — every strike is a set of segments
 * returned by src/lib/lightning.ts's buildBolt, drawn on the overlay with
 * the same glow + branch + main-channel grammar /storm uses, so a visitor
 * moving between the two rooms sees the same lightning anatomy. The
 * population is one instanced draw; every law the room claims lives in
 * src/lib/zeussky.ts and is pinned by scripts/test-zeussky.mjs.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import RoomShell from "@/components/RoomShell";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { tapTrainTier, tapTrainDepth } from "@/lib/gesture/core";
import {
  createFrameGovernor,
  createIdleWriter,
  detailForTier,
  isEmbeddedFrame,
  onGalleryPause,
  onVisibility,
} from "@/lib/room-runtime";
import { createGLStage, FULLSCREEN_VERT_CLIP } from "@/lib/webgl/stage";
import { clocksFrom } from "@/lib/webgl/sizing";
import { createInstanceBuffer } from "@/lib/scene/instances";
import { createPopulationLayer } from "@/lib/scene/population-layer";
import { populationVoice } from "@/lib/scene/voice";
import {
  createPopulation,
  createVerbEvent,
  mulberry32,
  type SceneObjectSpec,
  type SceneObjectState,
  type StepContext,
} from "@/lib/scene/object";
import {
  CELL_CAP,
  PEAL_STAGGER_MS,
  attraction,
  boltEnergy,
  calve,
  inContact,
  mergeCells,
  pealOrder,
  thunderHz,
} from "@/lib/zeussky";
import {
  DEFAULT_BOLT_CFG,
  buildBolt,
  hashSeed as boltHashSeed,
  type BoltSeg,
} from "@/lib/lightning";

const STORAGE_KEY = "objetdart:zeus:v1";

// The sky the court convenes in: clouds hold to the upper reaches, above the
// ridge the bolts answer to.
const SKY_TOP = 0.08;
const SKY_FLOOR = 0.52;

// ——— the field: night over the peak, charge shimmer, sheet flash, the bolt.
// Naming: the shared breath (`uBreath`) reaches every room whose shader
// declares it, per `src/lib/webgl/sizing.ts` — same convention as /reef and
// /root — and the room-quality bar reads the manifest's `life.breath.reads`
// against that literal. The other room-local uniforms keep the `u_*` dialect
// this file established.
const FIELD = `precision mediump float;
varying vec2 vUv;
uniform vec2 u_resolution;
uniform float u_time;
uniform float uBreath;
uniform float u_turbulence;
uniform float u_brightness;
uniform float u_reduced;
uniform float u_wind;
uniform float u_charge;
uniform float u_flash;
uniform float u_night;
uniform float u_season;
uniform float u_lens;
// the ridge's answer to the bolt — 1 at the moment of the strike, decaying
// to 0 over ~1.5s. u_strikeX is where along the ridge the bolt landed, so
// the scorch is local, not a curtain over the whole crest.
uniform float u_ridgeStrike;
uniform float u_strikeX;
// the vessel's own lean — gamma / 45 clamped to ±1. Pushes the cloud band and
// the star field a few percent of the frame laterally, so a tilt actually
// leans the whole court.
uniform float u_tiltX;
// pre-ceremony dimming — 0 at rest, climbs while a one-finger hold approaches
// the ceremony tier so the sky feels inevitable before the crack lands.
uniform float u_darken;

float hash(float n) { return fract(sin(n) * 43758.5453123); }
float noise(float x) {
  float i = floor(x);
  float f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);
  return mix(hash(i), hash(i + 1.0), u);
}

// layer: ridge — the peak itself, a closed-form skyline the bolts strike.
float ridge(float x) {
  float y = 0.66;
  y -= 0.16 * exp(-pow((x - 0.52) * 4.2, 2.0));       // the summit
  y -= 0.07 * exp(-pow((x - 0.22) * 5.5, 2.0));       // the western shoulder
  y -= 0.05 * exp(-pow((x - 0.80) * 6.0, 2.0));       // the eastern shoulder
  y += 0.012 * sin(x * 41.0) + 0.008 * sin(x * 97.0); // scree
  return y;
}

// The bolt itself is no longer drawn in the shader — /storm and /zeus now
// share the fractal in src/lib/lightning.ts and render the segments on a
// 2D overlay on top of this pass. The shader still owns the ridge scorch
// (u_ridgeStrike / u_strikeX) so the mountain visibly RECEIVES the strike,
// and the sky-wide u_flash still lights the cloud band from within.

void main() {
  vec2 uv = vUv * 0.5 + 0.5;
  uv.y = 1.0 - uv.y;
  float aspect = u_resolution.x / max(1.0, u_resolution.y);

  // layer: sky — a bruised violet night that carries the court's charge.
  float horizon = smoothstep(0.0, 0.9, uv.y);
  vec3 zenith = vec3(0.030, 0.036, 0.082);
  vec3 low = vec3(0.115, 0.088, 0.170);
  // the season leans the low sky from winter iron to summer wine
  low = mix(low, vec3(0.150, 0.078, 0.120), 0.5 + 0.5 * sin(u_season * 6.2831853));
  vec3 sky = mix(zenith, low, horizon);

  // layer: stars — a seeded scatter above the weather, each one a point
  // with its own falloff inside its cell, breathing faintly. The tilt lean
  // shifts the field a few percent laterally so the phone's own body is felt
  // in the star scatter, not only in the wind.
  vec2 starUv = uv + vec2(u_tiltX * 0.02, 0.0);
  vec2 grid = vec2(60.0 * aspect, 60.0);
  vec2 cell = floor(starUv * grid);
  float starSeed = hash(cell.x * 127.1 + cell.y * 311.7);
  vec2 starPos = vec2(hash(starSeed * 53.7), hash(starSeed * 97.3));
  float starD = length(fract(starUv * grid) - starPos);
  float star = step(0.93, starSeed) * smoothstep(0.16, 0.0, starD) * smoothstep(0.5, 0.05, uv.y);
  sky += vec3(0.85, 0.88, 1.0) * star * (0.5 + 0.35 * uBreath) * (0.4 + 0.6 * fract(starSeed * 91.7));

  // layer: cloud drift — slow fbm banks riding the wind, denser with charge.
  // The cloud band leans farther than the stars — the low sky is closer, so
  // a tilt reads there first (max ~4% of frame width).
  float drift = u_time * (0.012 + 0.02 * abs(u_wind)) * (1.0 - u_reduced);
  vec2 cloudUv = uv + vec2(u_tiltX * 0.04, 0.0);
  float bank = noise(cloudUv.x * 5.0 * aspect + drift * 3.0 + cloudUv.y * 4.0)
             * noise(cloudUv.x * 2.3 * aspect - drift * 2.0 + 7.0);
  float cloudBand = smoothstep(0.55, 0.12, uv.y) * smoothstep(0.02, 0.2, uv.y);
  sky += vec3(0.11, 0.095, 0.16) * bank * cloudBand * (0.9 + 0.8 * u_charge);

  // layer: charge shimmer — the whole sky holds its breath, deeper as the
  // court's charge builds; never fully still even over an empty sky.
  sky += vec3(0.045, 0.038, 0.09) * (0.12 + u_charge) * (0.55 + 0.45 * uBreath) * cloudBand;

  // layer: lens — two fingers turn the sky into its charge chart: isolines
  // of height brighten so the court reads as a field, not a picture.
  float iso = smoothstep(0.94, 1.0, sin(uv.y * 90.0)) * u_lens;
  sky += vec3(0.10, 0.09, 0.16) * iso * cloudBand;

  // layer: sheet flash — the inside of the nearest cloud, lit for a frame.
  sky += vec3(0.85, 0.82, 0.95) * u_flash * cloudBand;

  // layer: the ridge the bolts land on. The bolt itself is drawn on a 2D
  // overlay above this pass (src/lib/lightning.ts + linesRef canvas below),
  // so the shader carries the SKY-WIDE flash (u_flash) plus the ridge's own
  // scorch answer (u_ridgeStrike / u_strikeX further down) — the ridge sees
  // the strike even though the strike itself is a set of overlaid lines.
  float g = ridge(uv.x);
  vec3 c = sky;
  if (uv.y > g) {
    // the mountain: dark stone under a moonlit crest, caught by every strike
    float depth = smoothstep(g, 1.0, uv.y);
    vec3 stone = mix(vec3(0.052, 0.052, 0.070), vec3(0.016, 0.016, 0.024), depth);
    float crest = exp(-(uv.y - g) * 34.0);
    // the standing moonlight: the ridge is always readable, breathing
    stone += vec3(0.22, 0.23, 0.30) * crest * (0.6 + 0.3 * uBreath);
    float snow = smoothstep(0.58, 0.50, g) * crest;
    stone += vec3(0.12, 0.13, 0.17) * snow;
    stone += vec3(0.55, 0.53, 0.6) * crest * u_flash;
    stone += vec3(0.05, 0.05, 0.07) * crest * u_charge * uBreath;
    // layer: ridge scorch — the ridge answers the bolt. u_ridgeStrike
    // spikes to 1 at the moment of a strike and decays over ~1.5s. A small
    // region above the bolt's landing X brightens with a hot afterimage that
    // cools through orange → deep-red → gone, so the ridge visibly RECEIVES
    // the strike instead of standing indifferent to it.
    float strikeD = abs(uv.x - u_strikeX);
    float strikeBand = exp(-strikeD * 46.0) * exp(-(uv.y - g) * 22.0);
    // hot afterglow cools with the decay: 1 → orange → deep red → dark
    vec3 hot = mix(vec3(0.32, 0.06, 0.02), vec3(1.0, 0.62, 0.22), u_ridgeStrike);
    stone += hot * strikeBand * u_ridgeStrike * 1.6;
    c = stone;
  }

  // pre-ceremony dimming: a one-finger hold approaching the ceremony tier
  // dims the whole sky by up to 30%, so the crack lands into a darker frame
  // and the moment before feels inevitable.
  c *= 1.0 - 0.30 * u_darken;
  c *= 1.0 - 0.72 * u_night;
  c *= u_brightness;
  float vig = smoothstep(1.35, 0.45, length(uv - vec2(0.5, 0.48)));
  gl_FragColor = vec4(c * (0.72 + 0.28 * vig), 1.0);
}`;

// ——— the object: a thunderhead — one house of the court.
type Thunderhead = SceneObjectState & {
  /** the store a bolt spends; hue and core brightness read it directly. */
  charge: number;
  /** the column that conducts; the anvil's reach and the strike's heat. */
  water: number;
  /** sheet lightning inside the cloud, decaying between taps. */
  flicker: number;
  vx: number;
  vy: number;
  drift: number;
};

const thunderhead: SceneObjectSpec<Thunderhead> = {
  kind: "a thunderhead",
  cap: CELL_CAP,

  born(seed, nx, ny, tMs) {
    const rng = mulberry32(seed);
    return {
      id: 0,
      seed,
      nx,
      ny: Math.max(SKY_TOP, Math.min(SKY_FLOOR, ny)),
      bornMs: tMs,
      growth: 0.15,
      sealedMs: null,
      presence: 1,
      charge: 0.18 + rng() * 0.1,
      water: 0.12 + rng() * 0.08,
      flicker: 0,
      vx: 0,
      vy: 0,
      drift: rng() * Math.PI * 2,
    };
  },

  step(s, ctx) {
    s.growth += (1 - s.growth) * Math.min(1, ctx.dt * 0.5);
    s.flicker *= 1 - Math.min(1, ctx.dt * 2.2);
    // the court drifts: its own slow orbit, the wind, and the induction the
    // room integrates into vx/vy each frame (see the pair pass in the loop)
    if (!ctx.reducedMotion) {
      s.drift += ctx.dt * (0.16 + 0.1 * Math.sin(s.seed));
      s.vx += ctx.wind * ctx.dt * 0.05;
    }
    s.vx *= 1 - Math.min(1, ctx.dt * 0.8);
    s.vy *= 1 - Math.min(1, ctx.dt * 0.8);
    s.nx = Math.min(0.96, Math.max(0.04, s.nx + s.vx * ctx.dt + (ctx.reducedMotion ? 0 : Math.sin(s.drift) * 0.004 * ctx.dt)));
    s.ny = Math.min(SKY_FLOOR, Math.max(SKY_TOP, s.ny + s.vy * ctx.dt + ctx.gravity * ctx.dt * 0.02));
  },

  emit(s, ctx, out) {
    const x = s.nx * ctx.width;
    const y = s.ny * ctx.height;
    const q = Math.min(1, s.charge);
    const anvil = (18 + s.water * 46) * (0.6 + 0.4 * s.growth);
    // the body: a wide slate anvil, breathing with the site's 7s swell
    out.push(
      x,
      y,
      anvil * (1 + ctx.breath * 0.06),
      s.drift * 0.1,
      0.12 + q * 0.25,
      0.18 + s.flicker * 0.5,
      0.4,
      s.presence * (0.5 + s.growth * 0.35),
    );
    // the core: the charge itself, read straight off the palette ramp
    out.push(
      x,
      y,
      anvil * (0.34 + q * 0.2),
      -s.drift * 0.2,
      0.45 + q * 0.55,
      0.5 + q * 0.7 + s.flicker,
      0.6 + 0.4 * ctx.breath,
      s.presence * (0.55 + q * 0.4),
    );
    // sheet lightning: a third, wide pass only while the flicker lives
    if (s.flicker > 0.02) {
      out.push(
        x,
        y,
        anvil * 1.9,
        0,
        0.95,
        s.flicker * 1.4,
        1,
        s.presence * s.flicker * 0.5,
      );
    }
  },

  verbs: [
    "touch",
    "stroke",
    "dwell",
    "ceremony",
    "tutti",
    "lens",
    "season",
    "wind",
    "dilate",
    "gravity",
    "agitate",
    "knock",
    "night",
  ],
  respond: {
    touch: (s, e) => {
      // sheet lightning inside the tapped house, scaled by how hard it landed
      s.flicker = Math.min(1.4, s.flicker + 0.35 + 0.5 * e.intensity);
      s.charge = Math.min(2, s.charge + 0.02 * e.intensity);
    },
    stroke: (s, e) => {
      s.nx = Math.min(0.96, Math.max(0.04, s.nx + e.dx));
      s.ny = Math.min(SKY_FLOOR, Math.max(SKY_TOP, s.ny + e.dy));
    },
    dwell: (s, e) => {
      // the hold keeps feeding both stores — 2400ms is visibly past 900ms,
      // and the growth saturates instead of stepping
      const feed = Math.min(0.9, e.elapsedMs / 4000);
      s.water = Math.min(1.5, s.water + feed * 0.012);
      s.charge = Math.min(2, s.charge + feed * 0.016);
      s.growth = Math.min(1, s.growth + e.elapsedMs / 80000);
    },
    // the ceremony is answered at the room level (the bolt needs the field's
    // uniforms and the thunder bus); the handler marks the house chosen so
    // the room's pass can spend it
    ceremony: (s, e) => {
      if (s.sealedMs === null) s.sealedMs = e.tMs;
    },
    tutti: (s, e) => {
      s.flicker = Math.min(1.4, s.flicker + 0.5 + 0.4 * e.intensity);
    },
    lens: (s, e) => {
      s.flicker = Math.min(1.4, s.flicker + Math.abs(e.angle) * 0.05);
    },
    season: () => {
      /* the year turns in the field; the houses keep their stores */
    },
    wind: (s, e) => {
      s.vx += e.dx * 1.6;
      s.vy += e.dy * 0.5;
    },
    dilate: (s) => {
      s.flicker = Math.min(1.4, s.flicker + 0.006);
    },
    gravity: (s, e) => {
      s.vx += e.dx * 0.01;
    },
    agitate: (s, e) => {
      // shaking the vessel is friction across the whole sky: charge builds
      s.charge = Math.min(2, s.charge + 0.06 * e.intensity);
      s.flicker = Math.min(1.4, s.flicker + 0.3 * e.intensity);
    },
    knock: (s, e) => {
      s.flicker = Math.min(1.4, s.flicker + 0.4 * e.intensity);
    },
    night: (s, e) => {
      if (e.intensity > 0.5) s.flicker = 0;
    },
  },
};

export default function Zeus() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // A second canvas on top of the shader — the bolt itself is drawn here as
  // stroked segments returned by buildBolt (src/lib/lightning.ts). Same
  // shape /storm uses; keeps the bolt anatomically branched.
  const linesRef = useRef<HTMLCanvasElement | null>(null);
  const [standing, setStanding] = useState(0);
  const letGoRef = useRef<() => void>(() => {});
  const plantRef = useRef<(nx: number, ny: number) => void>(() => {});
  const tapRef = useRef<(x: number, y: number, intensity: number, count: number) => void>(() => {});
  const voiceRef = useRef<ReturnType<typeof populationVoice> | null>(null);
  const glimmerRef = useRef<() => void>(() => {});

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const lines = linesRef.current;
    if (!wrap || !canvas || !lines) return;
    const lctx = lines.getContext("2d");
    if (!lctx) return;

    const audio = getFieldAudio();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const population = createPopulation(thunderhead);

    const writer = createIdleWriter(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(population.serialize()));
      } catch {
        /* quota / private mode — the sky still convenes */
      }
    });
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        // a kept sky — including a deliberately emptied one, which stays empty
        population.load(JSON.parse(raw), performance.now());
        for (const s of population.items) {
          if (typeof s.charge !== "number") s.charge = 0.2;
          if (typeof s.water !== "number") s.water = 0.15;
          s.flicker = 0;
          s.vx = 0;
          s.vy = 0;
          s.sealedMs = null;
          if (typeof s.drift !== "number") s.drift = (s.seed % 628) / 100;
        }
      } else {
        // first visit: the court convenes — three seeded houses, already
        // courting, so the sky is alive before any hand arrives
        const t0 = performance.now();
        const seats: Array<[number, number, number, number]> = [
          [0.3, 0.24, 0.42, 0.3],
          [0.62, 0.18, 0.3, 0.5],
          [0.74, 0.34, 0.55, 0.22],
        ];
        for (const [nx, ny, charge, water] of seats) {
          const s = population.spawn(nx, ny, t0) as Thunderhead;
          s.charge = charge;
          s.water = water;
        }
      }
    } catch {
      /* a clear sky */
    }
    setStanding(population.standing());

    const embedded = isEmbeddedFrame();
    const stage = createGLStage(canvas, { wrap, label: "zeus", reducedMotion: reduced, embedded });
    const prog = stage?.program(FULLSCREEN_VERT_CLIP, FIELD) ?? null;
    const quad = stage && prog ? stage.fullscreenQuad(prog) : null;
    const layer = stage
      ? createPopulationLayer(stage, { palette: ["#3a4058", "#8f7bff", "#f5ecc9"] })
      : null;
    const buffer = createInstanceBuffer(96);

    let wind = 0;
    let agitation = 0;
    let gravity = 0;
    let season = 0;
    let timeScale = 1;
    let lensAmount = 0;
    let night = 0;
    // the vessel's own lean — read straight off gamma, pushed to u_tiltX so
    // the whole court leans and the star field shifts with the hand's grip.
    let tiltX = 0;
    // the ceremony hold's build-up — climbs while a one-finger hold is past
    // ~1500ms and still short of the ceremony act, so the sky visibly dims
    // toward the strike. Read as u_darken.
    let ceremonyDarken = 0;
    let dwellHoldMs = 0;

    // the field's strike state — one bolt at a time, decaying in the loop.
    // The bolt is a set of overlaid line segments returned by buildBolt
    // (src/lib/lightning.ts); `lightning` holds the current strike's
    // segments + a lifetime + intensity. When null, the sky is between
    // strikes and the overlay renders nothing.
    let flash = 0;
    let lightning: {
      t0: number;
      life: number;
      segments: BoltSeg[];
      intensity: number;
      main: boolean; // true for a ceremony bolt, false for a knock's small strike
    } | null = null;
    let strikeSeedCounter = 0;
    // the ridge's answer — spikes to 1 on any strike, decays over ~1.5s. The
    // strike x-coordinate stays with it so the scorch stays where the bolt
    // actually landed even after subsequent frames.
    let ridgeStrike = 0;
    let strikeX = 0.5;

    // The idle sky's own speech — after a stretch of no hand, the horizon
    // flashes softly and a low rumble arrives from beyond the frame. The
    // manifest declares this cadence (life.glimmer.after_idle_ms = 15000);
    // the literal 15000 below IS the honoured contract.
    const IDLE_FLASH_AFTER_MS = 15000;
    let lastInteractionMs = performance.now();
    let nextDistantFlashMs = performance.now() + IDLE_FLASH_AFTER_MS;
    // seed the distant-flash RNG off a small state vector so replays are
    // deterministic — nothing rolls Math.random() in the room (AGENTS.md §5).
    const distantRng = mulberry32(0x2eef);
    // the knock counter — advanced each time the vessel is rapped so the
    // seeded pick of a struck house is a pure function of the visit's state.
    let knockCount = 0;

    // On any hand act the sky's own patience resets so the ambient speech
    // does not clip a real gesture.
    const noteInteraction = (tMs: number) => {
      lastInteractionMs = tMs;
      // wait a fresh full idle window before the sky speaks unprompted
      nextDistantFlashMs = tMs + IDLE_FLASH_AFTER_MS;
    };

    // the peal — the top rung: houses answer in nearest-first order, one
    // voice per PEAL_STAGGER_MS, driven by the frame clock (never a timer)
    const pealQueue: number[] = [];
    let pealDueMs = 0;

    // Distance from center → audio delay. A bolt at the edge of the sky
    // arrives at the ear ~200-800ms after the eye caught it, and that
    // perceptual latency IS the sky's depth. Center strikes ring immediately.
    const strikeDelaySec = (nx: number): number => {
      const off = Math.abs(nx - 0.5) * 2; // 0..1
      return 0.2 * off + 0.6 * off * off; // 0 at center, ~0.8s at rim
    };

    // Pick the thunder's layer count from the current tier — the low tier
    // gets the sub-bass alone, medium drops the noise tail, high runs full.
    const thunderLayers = (): number => {
      const t = gov.tier();
      if (t === "low" || t === "sleep") return 1;
      if (t === "medium") return 2;
      return 3;
    };

    const discharge = (s: Thunderhead, tMs: number, solo: boolean) => {
      const energy = boltEnergy(s.charge, s.water);
      flash = Math.min(1, 0.5 + energy * 0.3);
      // the ridge answers: the scorch lands where the bolt actually did, and
      // decays over ~1.5s. Solo bolts (the ceremony) burn the hottest.
      ridgeStrike = Math.min(1, solo ? 1 : 0.7 + energy * 0.2);
      strikeX = s.nx;
      fireBolt(s, energy, tMs, solo);
      const delaySec = strikeDelaySec(s.nx);
      // the thunder is the ledger: pitch reads the strike, length rides it —
      // and the whole clap layers a sub-bass thump, a mid-band discharge,
      // and a filtered rumble tail scaled by the bolt's own energy.
      audio.playThunder(energy, delaySec, thunderLayers());
      audio.playTone(thunderHz(energy), Math.min(1.6, 0.5 + energy * 0.5), delaySec);
      audio.thud();
      if (solo) haptics.storm();
      else haptics.chop();
      s.charge = 0;
      s.presence = 0.999; // spent — the house leaves the sky it lit
      writer.schedule();
    };

    // A small strike — the knock on the vessel's back. Half the flash, half
    // the ridge scorch, no ceremony, and it does NOT spend the house — the
    // sky answers the knock as with any storm-god propitiation.
    const smallStrike = (s: Thunderhead, tMs: number) => {
      const energy = boltEnergy(s.charge * 0.55, s.water * 0.7);
      flash = Math.min(1, Math.max(flash, 0.35 + energy * 0.2));
      ridgeStrike = Math.min(1, Math.max(ridgeStrike, 0.55));
      strikeX = s.nx;
      fireBolt(s, energy, tMs, false);
      const delaySec = strikeDelaySec(s.nx);
      audio.playThunder(energy * 0.6, delaySec, Math.max(1, thunderLayers() - 1));
      s.flicker = Math.min(1.4, s.flicker + 0.7);
      s.charge = Math.max(0, s.charge - 0.15);
      writer.schedule();
    };

    // Populate the lightning overlay for one strike. Called by discharge()
    // and smallStrike() so every visible bolt goes through the shared
    // fractal — no shader-drawn jag alongside a 2D-drawn tree, always one
    // consistent geometry. Solo (ceremony) bolts are bigger and drawn from
    // a slightly higher origin so the fall to the ridge reads as longer.
    const fireBolt = (s: Thunderhead, energy: number, tMs: number, solo: boolean) => {
      const rect = lines.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      if (!w || !h) return;
      strikeSeedCounter = (strikeSeedCounter + 1) | 0;
      const seed = boltHashSeed(
        Math.floor(s.seed) | 0,
        strikeSeedCounter,
        Math.floor(s.nx * 10000),
      );
      // origin: high in the cloud band, close to the house's x. A ceremony
      // bolt drops from the sky top so the fall reads as tall; a small
      // strike drops from just above the house so it reads as local.
      const x0 = s.nx * w;
      const y0 = h * (solo ? SKY_TOP : Math.max(SKY_TOP + 0.02, s.ny - 0.04));
      // terminus: the ridge line. The shader's `ridge(x)` is a closed-form
      // skyline; SKY_FLOOR is the flat mean the ridge modulates around, so
      // this lands the bolt at the ridge's meeting-line with a small jitter
      // that varies by house so nearby bolts don't stack their impacts.
      const hitX = x0;
      const hitY = h * SKY_FLOOR;
      const segments = buildBolt(x0, y0, hitX, hitY, {
        ...DEFAULT_BOLT_CFG,
        // one more generation than storm — zeus's bolts are the room's
        // solemn act, so give them more visible fractal detail
        generations: solo ? 7 : 5,
        displacement: w * DEFAULT_BOLT_CFG.displacement,
      }, seed);
      lightning = {
        t0: tMs,
        life: solo ? 0.42 : 0.28, // ceremony bolts linger a beat longer
        segments,
        intensity: 0.55 + energy * 0.5,
        main: solo,
      };
    };

    const nearestStanding = (nx: number, ny: number): Thunderhead | null => {
      let best: Thunderhead | null = null;
      let bestD2 = Infinity;
      for (const s of population.items) {
        if (s.presence < 1) continue;
        const dx = s.nx - nx;
        const dy = s.ny - ny;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = s;
        }
      }
      return best;
    };

    const spawnWith = (nx: number, ny: number, charge: number, water: number, tMs: number) => {
      const born = population.spawn(nx, ny, tMs) as Thunderhead;
      born.charge = charge;
      born.water = water;
      born.flicker = 0.8;
      born.vx = 0;
      born.vy = 0;
      born.drift = (born.seed % 628) / 100;
      writer.schedule();
      return born;
    };

    // ——— the tap ladder: 1 / 3 / 5 / n, real fidelity at the top.
    tapRef.current = (x, y, intensity, count) => {
      const width = Math.max(1, wrap.clientWidth);
      const height = Math.max(1, wrap.clientHeight);
      const nx = x / width;
      const ny = y / height;
      const tMs = performance.now();
      noteInteraction(tMs);
      const tier = tapTrainTier(count);
      const depth = tapTrainDepth(count);

      if (tier === "n") {
        // the peal — the verdict: every house answers, nearest-first from
        // the hand, each strike its own pitch on the ledger
        const standingCells = population.items.filter((s) => s.presence >= 1);
        if (standingCells.length === 0) return;
        const near = nearestStanding(nx, ny);
        const startIdx = near ? standingCells.indexOf(near) : 0;
        const order = pealOrder(standingCells, Math.max(0, startIdx));
        pealQueue.length = 0;
        for (const i of order) pealQueue.push(standingCells[i].id);
        pealDueMs = tMs;
        haptics.roll();
        return;
      }
      if (tier === 5) {
        // the summons: the two nearest houses are called into one, now
        let a: Thunderhead | null = null;
        let b: Thunderhead | null = null;
        let bestD2 = Infinity;
        const alive = population.items.filter((s) => s.presence >= 1);
        for (let i = 0; i < alive.length; i++) {
          for (let j = i + 1; j < alive.length; j++) {
            const dx = alive[i].nx - alive[j].nx;
            const dy = alive[i].ny - alive[j].ny;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) {
              bestD2 = d2;
              a = alive[i];
              b = alive[j];
            }
          }
        }
        if (!a || !b) return;
        const m = mergeCells(a, b);
        a.presence = 0.999;
        b.presence = 0.999;
        spawnWith(m.nx, m.ny, m.charge, m.water, tMs);
        flash = Math.min(1, 0.35 + 0.3 * intensity);
        const summonsEnergy = boltEnergy(m.charge, m.water);
        audio.playTone(thunderHz(summonsEnergy) * 2, 0.5, strikeDelaySec(m.nx));
        audio.bell();
        haptics.roll();
        return;
      }
      if (tier === 3) {
        // the calving: the tapped house pays real stores to stand a satellite
        const s = nearestStanding(nx, ny);
        if (!s) return;
        const u = ((s.seed >>> 3) % 1000) / 1000;
        const { parent, child } = calve(
          { nx: s.nx, ny: s.ny, charge: s.charge, water: s.water },
          u,
        );
        s.charge = parent.charge;
        s.water = parent.water;
        s.flicker = Math.min(1.4, s.flicker + 0.6);
        spawnWith(
          Math.min(0.96, Math.max(0.04, child.nx)),
          Math.min(SKY_FLOOR, Math.max(SKY_TOP, child.ny)),
          child.charge,
          child.water,
          tMs,
        );
        audio.spark();
        haptics.tap();
        return;
      }
      // tier 1: sheet lightning in the nearest house, scaled by the hand
      const e = createVerbEvent();
      e.verb = "touch";
      e.nx = nx;
      e.ny = ny;
      e.intensity = intensity * (0.7 + 0.3 * depth);
      e.tMs = tMs;
      if (population.route(e) > 0) {
        audio.playTone(180 + 120 * intensity, 0.25);
        haptics.ripple(0.25 + 0.3 * intensity);
      }
    };

    // The ceremony's 120ms silence before the crack: the ceremony verb queues
    // the discharge and clears the sealed mark; the loop reads this timer and
    // fires when it passes. Anticipation as a felt beat, not just a shape.
    let pendingCeremony: { sealed: Thunderhead; readyMs: number } | null = null;

    voiceRef.current = populationVoice(population, {
      size: () => ({ width: wrap.clientWidth, height: wrap.clientHeight }),
      now: () => performance.now(),
      onSpawn: (s) => {
        (s as Thunderhead).ny = Math.min(SKY_FLOOR, Math.max(SKY_TOP, s.ny));
        audio.chime();
        haptics.ripple(0.5);
        writer.schedule();
      },
      onAnswered: (e, answered) => {
        if (answered > 0) writer.schedule();
        // dwell — the hand feels the store deepening under it: a light tap
        // per acknowledgement, so the third sense lands with each answered
        // pass rather than only at the ceremony's cliff.
        if (e.verb === "dwell" && answered > 0) haptics.tap();
        if (e.verb === "ceremony") {
          // the sealed house is the chosen one — queue the strike so the
          // 120ms silence lands as anticipation, then discharge at the room
          // level where the bolt and the thunder live.
          for (const s of population.items) {
            if (s.sealedMs !== null && s.presence >= 1) {
              s.sealedMs = null;
              pendingCeremony = { sealed: s as Thunderhead, readyMs: e.tMs + 120 };
              // brief silence: nothing crackles for 120ms — the pause IS the beat
              break;
            }
          }
        }
      },
      world: {
        wind: (dx) => {
          wind = Math.max(-1, Math.min(1, wind + dx * 2.2));
        },
        season: (angle) => {
          season = (season + angle / (Math.PI * 2) + 1) % 1;
        },
        agitate: (intensity) => {
          agitation = Math.min(1, agitation + intensity);
        },
        gravity: (_beta, gamma) => {
          gravity = Math.max(-1, Math.min(1, gamma / 45));
          // tilt lean: the vessel's gamma pushes the whole cloud band and
          // the star field laterally so a tilt visibly leans the court, not
          // just the drift. Clamped to ±1 → ~4% of frame width max.
          tiltX = Math.max(-1, Math.min(1, gamma / 45));
        },
        timeScale: (k) => {
          timeScale = k;
        },
      },
    });
    // the ladder replaces the default single-rung tap; the lens dims the
    // court into its chart while the twist lives; knock and shake land in
    // the sky as the vessel's own speech.
    const baseVoice = voiceRef.current;
    voiceRef.current = {
      ...baseVoice,
      tap: (t) => {
        if (t.fingers !== 1) return;
        tapRef.current(t.x, t.y, t.intensity, t.count);
      },
      tutti: (t) => {
        // tap3 — sheet lightning in every house at once, felt as a long roll
        haptics.roll();
        baseVoice.tutti?.(t);
      },
      deepen: (d) => {
        // one-finger hold: track how long the hand has been resting so the
        // sky can dim toward the ceremony. The engine's `deepen` fires only
        // for the finger-material hold — three-finger holds route through
        // `timeScale`, so there is nothing to gate here.
        dwellHoldMs = d.elapsed;
        noteInteraction(performance.now());
        baseVoice.deepen?.(d);
      },
      lens: (l) => {
        // twist raises the chart lens; the two soft clicks are the hand's
        // receipt that the sky turned.
        lensAmount = Math.max(0, Math.min(1, lensAmount + l.angle * 0.25));
        haptics.lens();
        noteInteraction(performance.now());
        baseVoice.lens?.(l);
      },
      knock: (k) => {
        // vessel knock: the sky answers propitiation with a small strike
        // from one standing house — not a full ceremony bolt, just a bright
        // flicker and a short thunder. The pick is a pure function of the
        // knock count and the population's own seeds, so a replay of the
        // same knocks lands the same houses. Study Fire.tsx's vessel binding
        // for how the phone's own body becomes the other hand.
        const alive = population.items.filter((s) => s.presence >= 1);
        if (alive.length > 0) {
          knockCount = (knockCount + 1) | 0;
          const rng = mulberry32((knockCount * 2654435761) ^ (alive[0].seed | 0));
          const idx = Math.floor(rng() * alive.length) % alive.length;
          const pick = alive[idx] as Thunderhead;
          smallStrike(pick, performance.now());
        }
        haptics.detent();
        noteInteraction(performance.now());
        baseVoice.knock?.(k);
      },
      scatter: (s) => {
        // shake — friction across the sky, felt as a stutter
        haptics.chop();
        noteInteraction(performance.now());
        baseVoice.scatter?.(s);
      },
      night: (n) => {
        night = n.faceDown ? 1 : 0;
        baseVoice.night?.(n);
      },
    };

    plantRef.current = (nx, ny) => {
      const tMs = performance.now();
      spawnWith(nx, Math.min(SKY_FLOOR, Math.max(SKY_TOP, ny)), 0.2, 0.15, tMs);
      audio.chime();
      haptics.ripple(0.5);
      noteInteraction(tMs);
      setStanding(population.standing());
    };
    glimmerRef.current = () => {
      // physical, wordless: the eldest house murmurs once
      let eldest: Thunderhead | null = null;
      for (const s of population.items) {
        if (s.presence < 1) continue;
        if (!eldest || s.bornMs < eldest.bornMs) eldest = s;
      }
      if (eldest) eldest.flicker = Math.min(1.4, eldest.flicker + 0.5);
    };
    letGoRef.current = () => {
      population.letGo();
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ kind: population.spec.kind, items: [] }),
        );
      } catch {
        /* noop */
      }
      writer.cancel();
      setStanding(0);
      audio.thud();
      haptics.roll();
    };

    // Embedded (gallery iframe) starts one tier down: DPR ceiling and detail
    // are lower before the frame governor's ema has a chance to react.
    const gov = createFrameGovernor(embedded ? "medium" : "high");
    let hidden = false;
    let galleryPaused = false;
    const offVisibility = onVisibility((h) => {
      hidden = h;
      if (h) gov.force("sleep");
    });
    // Wave-1 gallery pause: when ScrollingGallery scrolls the iframe out of
    // view the parent posts `{ pause: true }`. Zeus honours that alongside
    // document.hidden so the RAF sleeps and the sky pays nothing while off
    // screen — same shape as /aphros and /sea.
    const offGalleryPause = onGalleryPause((p) => {
      galleryPaused = p;
      if (p) gov.force("sleep");
    });

    const step: StepContext = {
      dt: 0,
      tMs: 0,
      breath: 0.5,
      detail: 1,
      wind: 0,
      gravity: 0,
      agitation: 0,
      season: 0,
      timeScale: 1,
      reducedMotion: reduced,
    };

    let raf = 0;
    let last = performance.now();
    let lastStanding = population.standing();
    const draw = (t: number) => {
      const tier = gov.beginFrame(t);
      // Hidden OR gallery-paused → the RAF still ticks so the mount can
      // restart cleanly, but no simulation, no shader draw, no audio; the
      // frame budget for the off-screen room is essentially zero.
      if (hidden || galleryPaused) {
        last = t;
        raf = requestAnimationFrame(draw);
        return;
      }
      const detail = detailForTier(tier);
      const dt = Math.min(0.05, (t - last) / 1000) * timeScale;
      last = t;
      const tSec = audio.getAudioTime() ?? t / 1000;

      wind *= 0.99;
      agitation *= 0.96;
      lensAmount *= 0.985;
      flash *= 1 - Math.min(1, dt * 5);
      // Bolt lifetime is stored on the `lightning` state itself now (t0 +
      // life), not a decayed amplitude — the overlay pass reads age vs life
      // and fades naturally.
      // ridge scorch cools over ~1.5s regardless of frame rate
      ridgeStrike *= 1 - Math.min(1, dt / 1.5);
      if (ridgeStrike < 0.001) ridgeStrike = 0;
      // pre-ceremony darken climbs while a one-finger hold is past ~1500ms
      // and there IS a standing house to spend; it decays fast on release
      // so a hand that lifts short of ceremony leaves the sky bright again.
      const inHold = dwellHoldMs > 1500;
      const darkenTarget = inHold ? Math.min(0.9, (dwellHoldMs - 1500) / 900) : 0;
      const darkenRate = inHold ? 3 : 6;
      ceremonyDarken += (darkenTarget - ceremonyDarken) * Math.min(1, dt * darkenRate);
      // Reset dwellHoldMs when no active hold — the shell's deepen stops
      // firing, so if the last event is stale by ~250ms we count the hand
      // as lifted. dwellHoldMs is stamped from d.elapsed on each deepen.
      if (t - lastInteractionMs > 250) dwellHoldMs = 0;

      // ——— the ceremony's pause becomes the crack. Fire the queued
      // discharge once the 120ms silence has passed. Anticipation lands as
      // a felt beat, not a shape drawn in the shader.
      if (pendingCeremony && t >= pendingCeremony.readyMs) {
        const chosen = pendingCeremony.sealed;
        pendingCeremony = null;
        if (chosen.presence >= 1) discharge(chosen, t, true);
        setStanding(population.standing());
        ceremonyDarken = 0;
        dwellHoldMs = 0;
      }

      // ——— the sky's own speech at rest. After ~15s of no hand, a distant
      // sheet flash appears on the horizon and a low delayed rumble arrives
      // from beyond the frame; the interval reseeds to 6-14s so the sky
      // reminds the visitor it is there without a clock. Skip on low tier
      // so the frame budget for the primary material is protected.
      if (
        tier !== "low" && tier !== "sleep" &&
        !reduced &&
        t >= nextDistantFlashMs &&
        t - lastInteractionMs > IDLE_FLASH_AFTER_MS
      ) {
        const bias = distantRng();
        // one of two horizons — pick a side; edge, not center
        const side = distantRng() > 0.5 ? 1 : -1;
        const fx = 0.5 + side * (0.25 + bias * 0.22);
        // very soft — 60% of the sitting flash + a small nudge
        flash = Math.min(1, flash * 0.6 + 0.10 + 0.06 * bias);
        // and a distant low rumble, delayed so it feels far
        const distEnergy = 0.05 + 0.12 * bias;
        audio.playThunder(distEnergy, 0.5 + 0.3 * bias, Math.max(1, thunderLayers() - 1));
        // reschedule 6-14s ahead
        nextDistantFlashMs = t + 6000 + Math.floor(distantRng() * 8000);
        // decorate the horizon x used by the ridge-scorch subtly, but do NOT
        // set ridgeStrike — the flash is above the horizon, the ridge stays cool
        strikeX = fx;
      }

      // ——— the court's own politics: induction between every standing pair,
      // and the union of any two whose anvils touch. CELL_CAP is 12, so the
      // pass is at most 66 pairs — O(population²) at a size where that is
      // cheaper than any structure that would avoid it. At most one union
      // resolves per frame: the merged cell lands near its retiring parents,
      // and letting it re-merge inside the same pass would grow `items`
      // faster than the loop walks it. A frame later is soon enough for the
      // next contact — 16ms is invisible, an unbounded pass is a hang.
      const items = population.items;
      const pairCount = items.length;
      let totalCharge = 0;
      let merged = false;
      for (let i = 0; i < pairCount; i++) {
        const a = items[i];
        if (a.presence < 1) continue;
        totalCharge += Math.min(1, a.charge) * 0.34;
        for (let j = i + 1; j < pairCount; j++) {
          const b = items[j];
          if (b.presence < 1) continue;
          const pull = attraction(a, b);
          a.vx += pull.ax * dt * 6;
          a.vy += pull.ay * dt * 6;
          b.vx -= pull.ax * dt * 6;
          b.vy -= pull.ay * dt * 6;
          if (!merged && inContact(a, b)) {
            merged = true;
            const m = mergeCells(a, b);
            a.presence = 0.999;
            b.presence = 0.999;
            const born = spawnWith(m.nx, Math.min(SKY_FLOOR, Math.max(SKY_TOP, m.ny)), m.charge, m.water, t);
            born.flicker = 1.2;
            const energy = boltEnergy(m.charge, m.water);
            flash = Math.min(1, 0.4 + energy * 0.2);
            // a merge is a lesser peal — layered thunder, no ridge strike;
            // the union RINGS but does not spend itself on the ridge.
            audio.playThunder(energy * 0.5, strikeDelaySec(m.nx), Math.max(1, thunderLayers() - 1));
            audio.playTone(thunderHz(energy) * 1.5, 0.7, strikeDelaySec(m.nx));
            haptics.roll();
            break; // a is spent — its remaining pairs are moot
          }
        }
      }
      totalCharge = Math.min(1, totalCharge + agitation * 0.4);

      // ——— the peal walks its queue on the frame clock
      if (pealQueue.length > 0 && t >= pealDueMs) {
        const id = pealQueue.shift();
        const s = items.find((c) => c.id === id && c.presence >= 1);
        if (s) discharge(s, t, false);
        pealDueMs = t + PEAL_STAGGER_MS / Math.max(0.05, timeScale);
      }

      step.dt = dt;
      step.tMs = t;
      step.breath = reduced ? 0.5 : Math.sin(tSec * Math.PI * 2 * 0.14) * 0.5 + 0.5;
      step.detail = detail.particles;
      step.wind = wind;
      step.gravity = gravity;
      step.agitation = agitation;
      step.season = season;
      step.timeScale = timeScale;
      population.step(step);

      if (stage) {
        const size = stage.beginFrame(
          clocksFrom({ time: tSec, turbulence: agitation, reducedMotion: reduced }),
          prog,
        );
        prog?.setFloat("u_wind", wind);
        prog?.setFloat("u_charge", totalCharge);
        prog?.setFloat("u_flash", flash);
        prog?.setFloat("u_night", night);
        prog?.setFloat("u_season", season);
        prog?.setFloat("u_lens", lensAmount);
        prog?.setFloat("u_ridgeStrike", ridgeStrike);
        prog?.setFloat("u_strikeX", strikeX);
        prog?.setFloat("u_tiltX", tiltX);
        prog?.setFloat("u_darken", ceremonyDarken);
        quad?.draw();
        buffer.reset();
        population.emit(
          {
            width: size.width,
            height: size.height,
            tMs: t,
            breath: step.breath,
            detail: detail.particles,
            reducedMotion: reduced,
          },
          buffer,
        );
        layer?.draw(buffer);
      }

      // ——— the bolt overlay: the shared fractal on top of the shader pass.
      // The shader owns the sky, the ridge, the flash and the ridge scorch
      // (u_ridgeStrike / u_strikeX are already pushed above); the bolt
      // itself is a set of stroked segments layered on top of everything,
      // additive-blended so it reads as light on top of the world. Same
      // stroke grammar /storm uses — glow underlay, branches, main channel
      // — so a visitor moving between the two rooms sees the same anatomy.
      {
        const w = lines.clientWidth;
        const h = lines.clientHeight;
        if (w > 0 && h > 0) {
          const dpr = Math.min(2, window.devicePixelRatio || 1);
          const pxW = Math.round(w * dpr);
          const pxH = Math.round(h * dpr);
          if (lines.width !== pxW || lines.height !== pxH) {
            lines.width = pxW;
            lines.height = pxH;
            lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          }
          lctx.clearRect(0, 0, w, h);
          if (lightning) {
            const age = (t - lightning.t0) / 1000;
            if (age >= lightning.life) {
              lightning = null;
            } else {
              const k = Math.max(0, 1 - age / lightning.life);
              // deterministic flicker via a sine on t — no Math.random in
              // the render loop (AGENTS.md §5). Two out-of-phase sines
              // combine so the flicker doesn't repeat cleanly.
              const flick = 0.55 + 0.25 * Math.sin(t * 0.041) + 0.20 * Math.sin(t * 0.089 + 1.2);
              const a = Math.pow(k, 1.3) * flick * lightning.intensity;
              lctx.save();
              lctx.globalCompositeOperation = "screen";
              lctx.lineCap = "round";
              lctx.lineJoin = "round";
              // soft glow underlay — the whole bolt lit from within
              lctx.strokeStyle = `rgba(159, 132, 255, ${a * 0.34})`;
              lctx.lineWidth = 9;
              lctx.beginPath();
              for (const sg of lightning.segments) {
                lctx.moveTo(sg.x0, sg.y0);
                lctx.lineTo(sg.x1, sg.y1);
              }
              lctx.stroke();
              // branches — thinner and slightly amber for the storm-god palette
              lctx.strokeStyle = `rgba(227, 198, 107, ${Math.min(1, a * 0.9)})`;
              lctx.lineWidth = 1.1;
              lctx.beginPath();
              for (const sg of lightning.segments) {
                if (sg.main) continue;
                lctx.moveTo(sg.x0, sg.y0);
                lctx.lineTo(sg.x1, sg.y1);
              }
              lctx.stroke();
              // bright main channel — the bolt itself, hottest at the core
              lctx.strokeStyle = `rgba(245, 236, 201, ${Math.min(1, a * 1.3)})`;
              lctx.lineWidth = lightning.main ? 2.6 : 1.9;
              lctx.beginPath();
              for (const sg of lightning.segments) {
                if (!sg.main) continue;
                lctx.moveTo(sg.x0, sg.y0);
                lctx.lineTo(sg.x1, sg.y1);
              }
              lctx.stroke();
              lctx.restore();
            }
          }
        }
      }

      const n = population.standing();
      if (n !== lastStanding) {
        lastStanding = n;
        setStanding(n);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      offVisibility();
      offGalleryPause();
      writer.flush();
      layer?.dispose();
      quad?.dispose();
      stage?.dispose();
      voiceRef.current = null;
    };
  }, []);

  const letGo = useCallback(() => letGoRef.current(), []);

  return (
    <RoomShell
      route="/zeus"
      surfaceRef={wrapRef}
      voice={voiceRef.current ?? undefined}
      letGo={{ label: "let the sky go", onLetGo: letGo, visible: standing > 0 }}
      onGlimmer={() => glimmerRef.current()}
      keyboard={{
        enter: () => plantRef.current(0.5, 0.3),
        enterHeld: (elapsed) => plantRef.current(0.28 + ((elapsed / 4000) % 0.44), 0.3),
      }}
      style={{ position: "fixed", inset: 0, background: "#05070f" }}
    >
      <div ref={wrapRef} style={{ position: "absolute", inset: 0 }}>
        <canvas
          ref={canvasRef}
          role="application"
          tabIndex={0}
          aria-label="a charged sky above the peak — rest a finger and a thunderhead gathers, hold to the ceremony and it spends itself in one bolt to the ridge"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }}
        />
        {/* the bolt overlay — every strike's fractal segments live here on
            top of the shader. Pointer-events off so the shader canvas keeps
            catching the hand; aria-hidden because the bolt speaks through
            sound + the ridge scorch below it, not through this layer. */}
        <canvas
          ref={linesRef}
          aria-hidden
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
        />
      </div>
    </RoomShell>
  );
}
