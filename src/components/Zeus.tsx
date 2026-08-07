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
 * The material is a fragment shader (sky, ridge, bolt); the population is
 * one instanced draw; every law the room claims lives in src/lib/zeussky.ts
 * and is pinned by scripts/test-zeussky.mjs.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import RoomShell from "@/components/RoomShell";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { tapTrainTier, tapTrainDepth } from "@/lib/gesture/core";
import { createIdleWriter, detailForTier, onVisibility, createFrameGovernor } from "@/lib/room-runtime";
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

const STORAGE_KEY = "objetdart:zeus:v1";

// The sky the court convenes in: clouds hold to the upper reaches, above the
// ridge the bolts answer to.
const SKY_TOP = 0.08;
const SKY_FLOOR = 0.52;

// ——— the field: night over the peak, charge shimmer, sheet flash, the bolt.
const FIELD = `precision mediump float;
varying vec2 vUv;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_breath;
uniform float u_turbulence;
uniform float u_brightness;
uniform float u_reduced;
uniform float u_wind;
uniform float u_charge;
uniform float u_flash;
uniform float u_boltX;
uniform float u_boltAmp;
uniform float u_boltSeed;
uniform float u_night;
uniform float u_season;
uniform float u_lens;

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

// layer: bolt — one jagged column from the cloud base to the ridge,
// displaced by seeded noise so every strike draws its own path.
float bolt(vec2 uv) {
  if (u_boltAmp <= 0.001) return 0.0;
  float top = 0.26;
  float ground = ridge(u_boltX);
  if (uv.y < top || uv.y > ground) return 0.0;
  float t = (uv.y - top) / max(0.001, ground - top);
  float jag = (noise(uv.y * 26.0 + u_boltSeed * 61.0) - 0.5) * 0.09
            + (noise(uv.y * 90.0 + u_boltSeed * 13.0) - 0.5) * 0.03;
  jag *= smoothstep(0.0, 0.15, t) * smoothstep(1.0, 0.75, t);
  float d = abs(uv.x - (u_boltX + jag));
  float core = exp(-d * 620.0) * 1.4;
  float halo = exp(-d * 60.0) * 0.35;
  // a fork that leaves the trunk two-thirds of the way down
  float fjag = jag + (t - 0.6) * (noise(u_boltSeed * 7.0) - 0.5) * 0.5;
  float fd = abs(uv.x - (u_boltX + fjag));
  float forkOn = step(0.6, t) * step(0.4, noise(u_boltSeed * 3.7));
  float fork = exp(-fd * 480.0) * 0.7 * forkOn;
  return (core + halo + fork) * u_boltAmp;
}

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
  // with its own falloff inside its cell, breathing faintly.
  vec2 grid = vec2(60.0 * aspect, 60.0);
  vec2 cell = floor(uv * grid);
  float starSeed = hash(cell.x * 127.1 + cell.y * 311.7);
  vec2 starPos = vec2(hash(starSeed * 53.7), hash(starSeed * 97.3));
  float starD = length(fract(uv * grid) - starPos);
  float star = step(0.93, starSeed) * smoothstep(0.16, 0.0, starD) * smoothstep(0.5, 0.05, uv.y);
  sky += vec3(0.85, 0.88, 1.0) * star * (0.5 + 0.35 * u_breath) * (0.4 + 0.6 * fract(starSeed * 91.7));

  // layer: cloud drift — slow fbm banks riding the wind, denser with charge.
  float drift = u_time * (0.012 + 0.02 * abs(u_wind)) * (1.0 - u_reduced);
  float bank = noise(uv.x * 5.0 * aspect + drift * 3.0 + uv.y * 4.0)
             * noise(uv.x * 2.3 * aspect - drift * 2.0 + 7.0);
  float cloudBand = smoothstep(0.55, 0.12, uv.y) * smoothstep(0.02, 0.2, uv.y);
  sky += vec3(0.11, 0.095, 0.16) * bank * cloudBand * (0.9 + 0.8 * u_charge);

  // layer: charge shimmer — the whole sky holds its breath, deeper as the
  // court's charge builds; never fully still even over an empty sky.
  sky += vec3(0.045, 0.038, 0.09) * (0.12 + u_charge) * (0.55 + 0.45 * u_breath) * cloudBand;

  // layer: lens — two fingers turn the sky into its charge chart: isolines
  // of height brighten so the court reads as a field, not a picture.
  float iso = smoothstep(0.94, 1.0, sin(uv.y * 90.0)) * u_lens;
  sky += vec3(0.10, 0.09, 0.16) * iso * cloudBand;

  // layer: sheet flash — the inside of the nearest cloud, lit for a frame.
  sky += vec3(0.85, 0.82, 0.95) * u_flash * cloudBand;

  // layer: the bolt and the stone it strikes.
  float g = ridge(uv.x);
  float b = bolt(uv);
  vec3 c = sky + vec3(1.0, 0.97, 0.88) * b;
  if (uv.y > g) {
    // the mountain: dark stone under a moonlit crest, caught by every strike
    float depth = smoothstep(g, 1.0, uv.y);
    vec3 stone = mix(vec3(0.052, 0.052, 0.070), vec3(0.016, 0.016, 0.024), depth);
    float crest = exp(-(uv.y - g) * 34.0);
    // the standing moonlight: the ridge is always readable, breathing
    stone += vec3(0.22, 0.23, 0.30) * crest * (0.6 + 0.3 * u_breath);
    float snow = smoothstep(0.58, 0.50, g) * crest;
    stone += vec3(0.12, 0.13, 0.17) * snow;
    stone += vec3(0.55, 0.53, 0.6) * crest * (u_flash + b * 0.8);
    stone += vec3(0.05, 0.05, 0.07) * crest * u_charge * u_breath;
    c = stone;
  }

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
  const [standing, setStanding] = useState(0);
  const letGoRef = useRef<() => void>(() => {});
  const plantRef = useRef<(nx: number, ny: number) => void>(() => {});
  const tapRef = useRef<(x: number, y: number, intensity: number, count: number) => void>(() => {});
  const voiceRef = useRef<ReturnType<typeof populationVoice> | null>(null);
  const glimmerRef = useRef<() => void>(() => {});

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

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

    const stage = createGLStage(canvas, { wrap, label: "zeus", reducedMotion: reduced });
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

    // the field's strike state — one bolt at a time, decaying in the loop
    let flash = 0;
    let boltAmp = 0;
    let boltX = 0.5;
    let boltSeed = 0;

    // the peal — the top rung: houses answer in nearest-first order, one
    // voice per PEAL_STAGGER_MS, driven by the frame clock (never a timer)
    const pealQueue: number[] = [];
    let pealDueMs = 0;

    const discharge = (s: Thunderhead, tMs: number, solo: boolean) => {
      const energy = boltEnergy(s.charge, s.water);
      flash = Math.min(1, 0.5 + energy * 0.3);
      boltAmp = Math.min(1, 0.6 + energy * 0.25);
      boltX = s.nx;
      boltSeed = (s.seed % 1000) / 1000 + s.nx;
      // the thunder is the ledger: pitch reads the strike, length rides it
      audio.playTone(thunderHz(energy), Math.min(1.6, 0.5 + energy * 0.5));
      audio.thud();
      if (solo) haptics.storm();
      else haptics.chop();
      s.charge = 0;
      s.presence = 0.999; // spent — the house leaves the sky it lit
      writer.schedule();
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
        audio.playTone(thunderHz(boltEnergy(m.charge, m.water)) * 2, 0.5);
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
        if (e.verb === "ceremony") {
          // the sealed house is the chosen one — spend it now, at the room
          // level, where the bolt and the thunder live
          for (const s of population.items) {
            if (s.sealedMs !== null && s.presence >= 1) {
              s.sealedMs = null;
              discharge(s, e.tMs, true);
            }
          }
          setStanding(population.standing());
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
        },
        timeScale: (k) => {
          timeScale = k;
        },
      },
    });
    // the ladder replaces the default single-rung tap; the lens dims the
    // court into its chart while the twist lives
    const baseVoice = voiceRef.current;
    voiceRef.current = {
      ...baseVoice,
      tap: (t) => {
        if (t.fingers !== 1) return;
        tapRef.current(t.x, t.y, t.intensity, t.count);
      },
      lens: (l) => {
        lensAmount = Math.max(0, Math.min(1, lensAmount + l.angle * 0.25));
        baseVoice.lens?.(l);
      },
      night: (n) => {
        night = n.faceDown ? 1 : 0;
        baseVoice.night?.(n);
      },
    };

    plantRef.current = (nx, ny) => {
      spawnWith(nx, Math.min(SKY_FLOOR, Math.max(SKY_TOP, ny)), 0.2, 0.15, performance.now());
      audio.chime();
      haptics.ripple(0.5);
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

    const gov = createFrameGovernor();
    let hidden = false;
    const offVisibility = onVisibility((h) => {
      hidden = h;
      if (h) gov.force("sleep");
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
      if (hidden) {
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
      boltAmp *= 1 - Math.min(1, dt * 3.2);

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
            flash = Math.min(1, 0.4 + boltEnergy(m.charge, m.water) * 0.2);
            audio.playTone(thunderHz(boltEnergy(m.charge, m.water)) * 1.5, 0.7);
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
        prog?.setFloat("u_boltX", boltX);
        prog?.setFloat("u_boltAmp", boltAmp);
        prog?.setFloat("u_boltSeed", boltSeed);
        prog?.setFloat("u_night", night);
        prog?.setFloat("u_season", season);
        prog?.setFloat("u_lens", lensAmount);
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
      </div>
    </RoomShell>
  );
}
