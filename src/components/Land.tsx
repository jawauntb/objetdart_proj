"use client";

/**
 * /land — a parcel of living ground you can raise, and rain takes back.
 *
 * The material is a heightfield lit by a low warm sun: elevation, surface
 * water, soil moisture and vegetation cover on a square grid, drawn as one
 * instanced pass of shaded cells over a sky-and-sun fragment shader. Grass
 * greens where the ground is wet and flat and thins where it is steep or dry;
 * a slope IS its angle of repose; water flows downhill, cuts channels, and
 * greens the lowlands. Every law lives in src/lib/land.ts, pure and node-
 * tested; this file only renders what those laws decide and says what each
 * verb of the grammar means in this ground.
 *
 * The tap train climbs: one tap pats a splash into the soil, three open a
 * spring, five draw a downpour across the whole parcel, and the peal breaks a
 * cloudburst over it and sends a flock across the field.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RoomShell from "@/components/RoomShell";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import {
  createFrameGovernor,
  createIdleWriter,
  detailForTier,
  onVisibility,
} from "@/lib/room-runtime";
import { createGLStage, FULLSCREEN_VERT_CLIP } from "@/lib/webgl/stage";
import { clocksFrom } from "@/lib/webgl/sizing";
import { tapTrainDepth, tapTrainTier } from "@/lib/gesture";
import {
  flatten,
  flowAccumulation,
  hashSeed,
  inciseRiver,
  loadLand,
  makeTerrain,
  meanGreen,
  mulberry32,
  rain,
  raiseHummock,
  sculpt,
  serializeLand,
  setWatershed,
  slump,
  soak,
  stepHydrology,
  stepVegetation,
  windErosion,
  GRID_N,
  type Terrain,
} from "@/lib/land";

const STORAGE_KEY = "objetdart:land:v1";
const ROOM_SEED = 0x1a4d;

// ——— the sky: one fragment shader, a low warm sun over loam ————————————————
const FIELD = `precision mediump float;
varying vec2 vUv;
uniform vec2 u_resolution;
uniform float u_time;
uniform float uBreath;
uniform float u_season;
uniform float u_night;
uniform float u_light;
uniform vec3 u_cloud;
void main() {
  vec2 uv = vUv * 0.5 + 0.5;
  float aspect = u_resolution.x / max(1.0, u_resolution.y);

  // the sky, warm at the horizon and cool overhead; the season cools it
  vec3 top = mix(vec3(0.05, 0.045, 0.062), vec3(0.06, 0.07, 0.10), u_season);
  vec3 horizon = mix(vec3(0.34, 0.19, 0.09), vec3(0.20, 0.24, 0.30), u_season * 0.5);
  float sky = smoothstep(0.02, 0.8, uv.y);
  vec3 col = mix(horizon, top, sky);

  // the low sun, and the raking light that crosses the field
  vec2 sun = vec2(0.30 + 0.42 * u_light, 0.74);
  vec2 ap = vec2(uv.x * aspect, uv.y);
  float sd = distance(ap, vec2(sun.x * aspect, sun.y));
  col += vec3(0.55, 0.34, 0.15) * exp(-sd * sd * 7.0) * (0.7 + 0.3 * uBreath);
  col += vec3(0.5, 0.3, 0.12) * exp(-sd * sd * 1.2) * 0.12;

  // the ground haze rising in the lower half, breathing on the shared clock
  float g = smoothstep(0.62, 0.12, uv.y);
  vec3 loam = vec3(0.075, 0.06, 0.045) * (0.82 + 0.26 * uBreath);
  col = mix(col, loam, g * 0.72);

  // the ≥20s glimmer: a cloud shadow (or a distant flock) crosses the field
  float cd = distance(uv, u_cloud.xy);
  col *= 1.0 - u_cloud.z * exp(-cd * cd * 5.0) * 0.55;

  col *= 1.0 - 0.78 * u_night;
  gl_FragColor = vec4(col, 1.0);
}`;

// ——— the terrain: one instanced pass of lit, greening cells ————————————————
const TERRAIN_VERT = `attribute vec2 a_corner;
attribute vec2 a_pos;
attribute float a_size;
attribute float a_green;
attribute float a_sun;
attribute float a_wet;
uniform vec2 u_resolution;
uniform float u_time;
uniform float uBreath;
uniform float u_wind;
varying vec2 vLocal;
varying float vGreen;
varying float vSun;
varying float vWet;
void main() {
  vec2 local = a_corner;
  // grass sways on the breath — the top edge (corner.y < 0) leans with the wind
  float sway = sin(u_time * 0.9 + a_pos.x * 0.05 + a_pos.y * 0.07);
  sway *= (0.20 + 0.30 * uBreath) * a_green * (0.4 + u_wind);
  local.x += sway * max(0.0, -a_corner.y);
  vec2 px = a_pos + local * a_size;
  vec2 clip = (px / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vLocal = a_corner;
  vGreen = a_green;
  vSun = a_sun;
  vWet = a_wet;
}`;

const TERRAIN_FRAG = `precision mediump float;
varying vec2 vLocal;
varying float vGreen;
varying float vSun;
varying float vWet;
uniform float u_season;
uniform vec3 u_loam;
uniform vec3 u_grass;
uniform vec3 u_gold;
uniform vec3 u_frost;
uniform vec3 u_water;
void main() {
  // a soft-cornered cell
  vec2 q = abs(vLocal);
  float m = max(q.x, q.y);
  float cell = 1.0 - smoothstep(0.80, 1.02, m);
  if (cell <= 0.01) discard;

  // grass, turned green → gold → frost by the season
  vec3 veg = mix(u_grass, u_gold, clamp(u_season * 2.0, 0.0, 1.0));
  veg = mix(veg, u_frost, clamp((u_season - 0.5) * 2.0, 0.0, 1.0));
  vec3 ground = mix(u_loam, veg, smoothstep(0.04, 0.58, vGreen));

  // standing water pools over the ground and catches the sky
  ground = mix(ground, u_water, clamp(vWet * 3.2, 0.0, 0.78));

  vec3 col = ground * vSun;
  // frost sparkle late in the season
  col += u_frost * 0.16 * clamp((u_season - 0.62) * 2.6, 0.0, 1.0) * vGreen;
  float a = cell;
  gl_FragColor = vec4(col * a, a);
}`;

type Splash = { x: number; y: number; t0: number; r: number; kind: number };

type Api = {
  tap(e: { count: number; intensity: number; x: number; y: number }): void;
  stepBack(): void;
  tutti(intensity: number): void;
  plant(x: number, y: number): void;
  deepen(elapsed: number, x: number, y: number): void;
  settle(elapsed: number): void;
  ceremony(x: number, y: number): void;
  timeScale(k: number): void;
  drag(phase: string, x: number, y: number, dx: number, dy: number): void;
  wind(dx: number, dy: number): void;
  flick(angle: number, speed: number, x: number, y: number): void;
  stir(winding: number, cx: number, cy: number): void;
  sustain(phase: string, spread: number, elapsed: number): void;
  lens(velocity: number): void;
  season(velocity: number): void;
  rhythm(bpm: number, stability: number): void;
  scatter(intensity: number): void;
  gravity(beta: number, gamma: number): void;
  knock(intensity: number): void;
  night(faceDown: boolean): void;
  glimmer(): void;
  raiseAt(nx: number, ny: number): void;
  letGo(): void;
};

export default function Land() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const apiRef = useRef<Api | null>(null);
  const [raised, setRaised] = useState(0);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const overlayCanvas = overlayRef.current;
    if (!wrap || !canvas || !overlayCanvas) return;

    const audio = getFieldAudio();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const N = GRID_N;

    // ——— the parcel, from the laws in lib/land ———
    let terrain: Terrain;
    try {
      const rawStore = window.localStorage.getItem(STORAGE_KEY);
      const loaded = rawStore ? loadLand(JSON.parse(rawStore)) : null;
      terrain = loaded ?? makeTerrain(N, ROOM_SEED);
    } catch {
      terrain = makeTerrain(N, ROOM_SEED);
    }

    const writer = createIdleWriter(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeLand(terrain)));
      } catch {
        /* quota / private mode — the room still plays */
      }
    });

    // ——— the world's own fields ———
    const world = {
      season: 0, // 0 green .. 0.5 gold .. 1 frost, then round
      lens: 0, // 0 terrain .. 1 hydrology .. 2 soil-horizon
      night: 0,
      nightTarget: 0,
      windX: 0,
      windY: 0,
      windMag: 0,
      timeK: 1,
      light: 0.5, // the raking sun's crossing, 0..1
      gravBias: 0,
      cloud: { x: -0.3, y: 0.4, strength: 0, vx: 0.12 },
      rhythmK: 1,
      rhythmUntil: 0,
    };
    let heldGx = -1;
    let heldGy = -1;
    let dwellFresh = false;
    const splashesInit: Splash[] = [];
    let splashes = splashesInit;
    let lastAmbientSlot = -1;
    let lastGrainAt = 0;
    let waterBudget = 0; // rough live water, to gate the hydrology step

    const W = () => Math.max(1, wrap.clientWidth);
    const H = () => Math.max(1, wrap.clientHeight);
    const soft = (fn: () => void) => {
      try {
        fn();
      } catch {
        /* haptics or audio unavailable — the room still plays */
      }
    };

    // ——— projection: the grid, seen from a low angle ———
    const TOP = 0.1;
    const FIELD_H = 0.82;
    const cellOf = (nx: number, ny: number): { gx: number; gy: number } => {
      const gy01 = (ny - TOP) / FIELD_H;
      return {
        gx: Math.max(0, Math.min(N - 1, Math.floor(nx * N))),
        gy: Math.max(0, Math.min(N - 1, Math.floor(gy01 * N))),
      };
    };

    const markLens = () => {
      if (world.lens > 0.12) wrap.setAttribute("data-lens-raised", "1");
      else wrap.removeAttribute("data-lens-raised");
    };

    const addSplash = (nx: number, ny: number, kind: number, seed: number) => {
      const rng = mulberry32(seed);
      splashes.push({ x: nx, y: ny, t0: performance.now(), r: 0.02 + rng() * 0.02, kind });
      if (splashes.length > 48) splashes.shift();
    };

    const recount = () => setRaised(Math.round(meanGreen(terrain) * 100));
    recount();

    apiRef.current = {
      tap(e) {
        const nx = e.x / W();
        const ny = e.y / H();
        const { gx, gy } = cellOf(nx, ny);
        const tier = tapTrainTier(e.count);
        const depth = tapTrainDepth(e.count);
        if (tier === "n") {
          // the peal: a cloudburst over the whole parcel, and a flock crosses
          rain(terrain, N * 0.5, N * 0.5, N * 0.9, 0.25 + depth * 0.2);
          waterBudget += 8;
          world.cloud.x = -0.25;
          world.cloud.strength = 0.9;
          world.cloud.vx = 0.28;
          soft(() => audio.playTone(70, 2.2));
          soft(() => audio.bell());
          soft(() => haptics.storm());
          writer.schedule();
          return;
        }
        if (tier === 5) {
          // a downpour band across the field
          for (let k = 0; k < 5; k++) rain(terrain, N * (0.15 + k * 0.18), gy, N * 0.14, 0.35);
          waterBudget += 5;
          soft(() => audio.chime());
          soft(() => haptics.roll());
          writer.schedule();
          return;
        }
        if (tier === 3) {
          // a spring opens: a lasting source of water at the point
          rain(terrain, gx, gy, 2.4, 0.7);
          terrain.m[gy * N + gx] = 1;
          waterBudget += 3;
          addSplash(nx, ny, 1, hashSeed(ROOM_SEED, e.count, gx, gy));
          soft(() => audio.spark());
          soft(() => haptics.ripple(0.6));
          writer.schedule();
          return;
        }
        // one tap: pat the ground — a splash soaks in and greens the spot
        rain(terrain, gx, gy, 1.6, 0.18 + e.intensity * 0.2);
        waterBudget += 1;
        addSplash(nx, ny, 0, hashSeed(ROOM_SEED, gx, gy));
        soft(() => audio.playNote(72 + Math.round(e.intensity * 6), 130));
        soft(() => haptics.tap());
      },
      stepBack() {
        if (world.lens > 0.12) {
          world.lens = 0;
          markLens();
          soft(() => haptics.lens());
          soft(() => audio.chime());
        } else {
          // a soft settle of the whole surface toward its own repose
          world.gravBias = Math.min(1, world.gravBias + 0.2);
        }
      },
      tutti(intensity) {
        // the whole field ripples: a wave of rain rings out from the centre
        rain(terrain, N * 0.5, N * 0.5, N * (0.4 + intensity * 0.4), 0.14);
        waterBudget += 4;
        world.cloud.strength = Math.min(1, world.cloud.strength + 0.4 * intensity);
        soft(() => audio.chime());
        soft(() => haptics.roll());
      },
      plant(x, y) {
        const { gx, gy } = cellOf(x / W(), y / H());
        heldGx = gx;
        heldGy = gy;
        dwellFresh = true;
        soft(() => audio.spark());
        soft(() => haptics.ripple(0.4));
      },
      deepen(elapsed, x, y) {
        // the hold piles a hummock higher, rung by rung, and it greens as it
        // settles — duration is the axis, not a switch
        if (heldGx < 0) {
          const c = cellOf(x / W(), y / H());
          heldGx = c.gx;
          heldGy = c.gy;
        }
        const rung = Math.max(0.4, (elapsed - 500) / 900);
        raiseHummock(terrain, heldGx, heldGy, 1.8 + rung * 0.6, 0.02 + rung * 0.02);
        if (Math.floor(elapsed / 650) !== Math.floor((elapsed - 80) / 650)) {
          soft(() => audio.playNote(56 + Math.min(24, Math.floor(rung * 6)), 200));
          soft(() => haptics.detent());
        }
      },
      settle(elapsed) {
        if (heldGx >= 0) {
          // the raised ground finds its angle of repose
          slump(terrain, heldGx, heldGy, 3);
          if (dwellFresh && elapsed > 500) {
            soft(() => audio.playNote(60, 380));
            soft(() => haptics.ripple(0.5));
          }
          recount();
          writer.schedule();
        }
        heldGx = -1;
        heldGy = -1;
        dwellFresh = false;
      },
      ceremony(x, y) {
        // the solemn act: a watershed is set — a river finds and keeps its
        // course, incised into the ground and kept between visits
        void x;
        void y;
        const river = setWatershed(terrain);
        inciseRiver(terrain, 0.05);
        if (river.length > 1) {
          world.lens = Math.max(world.lens, 1);
          markLens();
        }
        soft(() => audio.bell());
        soft(() => haptics.bloom());
        writer.flush();
        recount();
      },
      timeScale(k) {
        world.timeK = k;
        if (k < 0.99) soft(() => haptics.tap());
      },
      drag(phase, x, y, dx, dy) {
        const nx = x / W();
        const ny = y / H();
        const { gx, gy } = cellOf(nx, ny);
        if (phase === "start" || phase === "end") return;
        // sculpt: push up a ridge, or carve a valley when dragging downward
        const carve = dy > 0 ? -1 : 1;
        sculpt(terrain, gx, gy, 1.6, carve * 0.03 * (0.5 + Math.min(2, Math.hypot(dx, dy) / 8)));
        const now = performance.now();
        if (now - lastGrainAt > 90) {
          lastGrainAt = now;
          soft(() => audio.playTone(240 + 500 * (1 - ny), 0.05));
          soft(() => haptics.chop());
        }
      },
      wind(dx, dy) {
        // three-finger drag is the wind: it wears the peaks down and lays the
        // dust in their lee
        world.windX = Math.max(-1, Math.min(1, world.windX + dx * 2.2));
        world.windY = Math.max(-1, Math.min(1, world.windY + dy * 2.2));
        world.windMag = Math.min(1.4, world.windMag + Math.hypot(dx, dy) * 3);
        windErosion(terrain, world.windX, world.windY, 0.06);
        soft(() => haptics.chop());
        writer.schedule();
      },
      flick(angle, speed, x, y) {
        // a flick triggers a slump / landslide at the point
        const { gx, gy } = cellOf(x / W(), y / H());
        void angle;
        slump(terrain, gx, gy, 3 + Math.min(3, speed));
        recount();
        soft(() => audio.thud());
        soft(() => haptics.storm());
        writer.schedule();
      },
      stir(winding, cx, cy) {
        // scrub is rain that follows the circling hand — water to flow downhill
        const nx = cx / W();
        const ny = cy / H();
        const { gx, gy } = cellOf(nx, ny);
        rain(terrain, gx, gy, 3, 0.12 * Math.min(3, Math.abs(winding) + 0.4));
        waterBudget += 2;
        addSplash(nx, ny, 2, hashSeed(ROOM_SEED, Math.floor(nx * 512), Math.floor(ny * 512)));
        soft(() => audio.playTone(520 + 300 * ny, 0.06));
        soft(() => haptics.ripple(0.3));
      },
      sustain(phase, spread, elapsed) {
        // two still fingers hold the light: the raking sun leans toward them
        if (phase === "release") {
          soft(() => audio.chime());
          return;
        }
        world.light = Math.max(0, Math.min(1, spread / (W() || 1)));
        if (phase === "enter") soft(() => haptics.tap());
        void elapsed;
      },
      lens(velocity) {
        world.lens = Math.max(0, Math.min(2, world.lens + velocity * 0.02));
        markLens();
      },
      season(velocity) {
        const before = world.season;
        world.season = ((world.season + velocity * 0.014) % 1 + 1) % 1;
        if (Math.floor(before * 3) !== Math.floor(world.season * 3)) {
          soft(() => haptics.detent());
          soft(() => audio.chime());
        }
      },
      rhythm(bpm, stability) {
        if (stability < 0.7) return;
        world.rhythmK = Math.max(0.5, Math.min(2, bpm / 72));
        world.rhythmUntil = performance.now() + 8000;
        soft(() => audio.chime());
      },
      scatter(intensity) {
        // a shake shivers the loose soil down its slopes
        world.gravBias = Math.min(1, world.gravBias + intensity * 0.6);
        slump(terrain, N * 0.5, N * 0.5, N);
        soft(() => audio.buzz());
        soft(() => haptics.chop());
        recount();
      },
      gravity(beta, gamma) {
        // tilt leans the light and biases which way the loose ground settles
        world.light = Math.max(0, Math.min(1, 0.5 + gamma / 90));
        world.gravBias = Math.min(1, world.gravBias + Math.abs(beta) / 400);
      },
      knock(intensity) {
        // a rap on the case jolts the whole parcel — the loose soil jumps
        world.gravBias = Math.min(1, world.gravBias + 0.3 * intensity);
        slump(terrain, N * 0.5, N * 0.5, N);
        soft(() => audio.thud());
        soft(() => haptics.detent());
        recount();
      },
      night(faceDown) {
        world.nightTarget = faceDown ? 1 : 0;
        soft(() => haptics.detent());
      },
      glimmer() {
        // the idle hint is physical: a cloud shadow (a distant flock) crosses
        const rng = mulberry32(hashSeed(ROOM_SEED, Math.floor(performance.now() / 1000)));
        world.cloud.x = -0.25;
        world.cloud.y = 0.25 + rng() * 0.4;
        world.cloud.strength = 0.7;
        world.cloud.vx = 0.14 + rng() * 0.08;
        soft(() => audio.playNote(60, 240));
      },
      raiseAt(nx, ny) {
        const { gx, gy } = cellOf(nx, ny);
        raiseHummock(terrain, gx, gy, 2.2, 0.12);
        slump(terrain, gx, gy, 3);
        recount();
        soft(() => audio.spark());
        soft(() => haptics.ripple(0.5));
        writer.schedule();
      },
      letGo() {
        // an exhale: the parcel goes flat, the river is forgotten, and an
        // emptied field stays empty
        flatten(terrain);
        splashes = [];
        waterBudget = 0;
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeLand(terrain)));
        } catch {
          /* noop */
        }
        writer.cancel();
        setRaised(0);
        soft(() => audio.thud());
        soft(() => haptics.roll());
      },
    };

    // ——— the stage: one GL context, sky + terrain, one overlay ———
    const stage = createGLStage(canvas, { wrap, label: "land", reducedMotion: reduced, overlay: overlayCanvas });
    const sky = stage?.program(FULLSCREEN_VERT_CLIP, FIELD) ?? null;
    const quad = stage && sky ? stage.fullscreenQuad(sky) : null;
    const terrainProg = stage?.program(TERRAIN_VERT, TERRAIN_FRAG) ?? null;
    const inst = stage && terrainProg ? stage.instanced(terrainProg) : null;

    // per-vertex corners (two triangles) and per-instance scratch, once.
    const CORNERS = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    const N2 = N * N;
    const aPos = new Float32Array(N2 * 2);
    const aSize = new Float32Array(N2);
    const aGreen = new Float32Array(N2);
    const aSun = new Float32Array(N2);
    const aWet = new Float32Array(N2);

    const gov = createFrameGovernor();
    let hidden = false;
    const offVisibility = onVisibility((h) => {
      hidden = h;
      if (h) gov.force("sleep");
    });

    let raf = 0;
    let last = performance.now();
    let simAcc = 0;

    const draw = (t: number) => {
      const tier = gov.beginFrame(t);
      if (hidden) {
        last = t;
        raf = requestAnimationFrame(draw);
        return;
      }
      const detail = detailForTier(tier);
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const tSec = audio.getAudioTime() ?? t / 1000;
      const breath = reduced ? 0.5 : Math.sin(tSec * Math.PI * 2 * 0.14) * 0.5 + 0.5;

      // fields relax toward rest
      world.windX *= 0.96;
      world.windY *= 0.96;
      world.windMag *= 0.94;
      world.night += (world.nightTarget - world.night) * Math.min(1, dt * 3);
      world.cloud.strength *= Math.exp(-dt / 5.5);
      world.gravBias *= Math.exp(-dt / 1.4);
      const rhythmK = t < world.rhythmUntil ? world.rhythmK : 1;
      // the sun rakes slowly across on its own, unless a span holds it
      world.light += Math.sin(tSec * 0.05) * dt * 0.02;
      world.light = Math.max(0, Math.min(1, world.light));
      // a cloud drifts across on a seeded ambient clock and on glimmer
      const slot = Math.floor(t / 21000);
      if (slot !== lastAmbientSlot && !reduced) {
        lastAmbientSlot = slot;
        const rng = mulberry32(hashSeed(ROOM_SEED, slot));
        if (world.cloud.strength < 0.1) {
          world.cloud.x = -0.25;
          world.cloud.y = 0.2 + rng() * 0.45;
          world.cloud.strength = 0.4 + rng() * 0.2;
          world.cloud.vx = 0.1 + rng() * 0.08;
        }
      }
      if (world.cloud.strength > 0.02) {
        world.cloud.x += world.cloud.vx * dt;
        if (world.cloud.x > 1.3) world.cloud.strength = 0;
      }

      // ——— the simulation: hydrology, greening, wind — at a governed cadence ———
      const simDt = Math.min(0.05, dt) * world.timeK * rhythmK;
      simAcc += simDt;
      const simStep = 1 / Math.max(12, detail.simHz);
      let guard = 0;
      while (simAcc >= simStep && guard < 4) {
        simAcc -= simStep;
        guard++;
        if (waterBudget > 0.01 || world.cloud.strength > 0.3) {
          stepHydrology(terrain, simStep);
          soak(terrain, simStep, 0.35, 0.06);
          waterBudget = Math.max(0, waterBudget - simStep * 0.6);
        }
        stepVegetation(terrain, simStep);
        if (world.gravBias > 0.01) slump(terrain, N * 0.5, N * 0.5, N);
      }

      // ——— render the sky ———
      if (stage && sky) {
        const size = stage.beginFrame(
          clocksFrom({ time: tSec, turbulence: world.windMag * 0.4, reducedMotion: reduced }),
          sky,
        );
        sky.setFloat("u_season", world.season);
        sky.setFloat("u_night", world.night);
        sky.setFloat("u_light", world.light);
        sky.setVec3("u_cloud", world.cloud.x, world.cloud.y, world.cloud.strength);
        quad?.draw();

        // ——— render the terrain, one instanced pass, back to front ———
        if (terrainProg && inst) {
          const wPx = size.width;
          const hPx = size.height;
          const cell = (wPx / N) * 0.92;
          const liftPx = hPx * 0.24;
          let count = 0;
          // sun direction in grid space; rakes with world.light
          const sunGX = -0.5 + world.light * 1.0;
          const sunGY = -0.7;
          for (let gy = 0; gy < N; gy++) {
            for (let gx = 0; gx < N; gx++) {
              const i = gy * N + gx;
              const h = terrain.h[i];
              const sx = ((gx + 0.5) / N) * wPx;
              const sy = (TOP + ((gy + 0.5) / N) * FIELD_H) * hPx - h * liftPx;
              // lighting from the local slope dotted with the sun
              const gradX = terrain.h[gy * N + Math.min(N - 1, gx + 1)] - terrain.h[gy * N + Math.max(0, gx - 1)];
              const gradY = terrain.h[Math.min(N - 1, gy + 1) * N + gx] - terrain.h[Math.max(0, gy - 1) * N + gx];
              let lit = 0.62 - (gradX * sunGX + gradY * sunGY) * 3.4 + h * 0.12;
              if (lit < 0.28) lit = 0.28;
              if (lit > 1.25) lit = 1.25;
              const o = count * 2;
              aPos[o] = sx;
              aPos[o + 1] = sy;
              aSize[count] = cell;
              aGreen[count] = terrain.g[i];
              aSun[count] = lit * (1 - world.night * 0.6);
              aWet[count] = Math.min(0.5, terrain.w[i]);
              count++;
            }
          }
          terrainProg.use();
          terrainProg.setVec2("u_resolution", wPx, hPx);
          terrainProg.setFloat("u_time", tSec);
          terrainProg.setFloat("uBreath", breath);
          terrainProg.setFloat("u_wind", world.windMag);
          terrainProg.setFloat("u_season", world.season);
          terrainProg.setVec3("u_loam", 0.32, 0.22, 0.14);
          terrainProg.setVec3("u_grass", 0.28, 0.44, 0.18);
          terrainProg.setVec3("u_gold", 0.7, 0.55, 0.2);
          terrainProg.setVec3("u_frost", 0.78, 0.85, 0.92);
          terrainProg.setVec3("u_water", 0.16, 0.34, 0.42);
          inst.attribute("a_corner", CORNERS, 2, 0);
          inst.attribute("a_pos", aPos.subarray(0, count * 2), 2, 1);
          inst.attribute("a_size", aSize.subarray(0, count), 1, 1);
          inst.attribute("a_green", aGreen.subarray(0, count), 1, 1);
          inst.attribute("a_sun", aSun.subarray(0, count), 1, 1);
          inst.attribute("a_wet", aWet.subarray(0, count), 1, 1);
          const gl = stage.gl;
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          inst.draw(gl.TRIANGLES, 6, count);
          inst.reset();
          gl.disable(gl.BLEND);
        }

        // ——— the overlay: the river's glint, splashes, and the lens ———
        const ctx = stage.overlay2d;
        if (ctx) {
          const wPx = size.width;
          const hPx = size.height;
          const liftPx = hPx * 0.24;
          ctx.clearRect(0, 0, wPx, hPx);
          const project = (i: number): [number, number] => {
            const gx = i % N;
            const gy = (i / N) | 0;
            return [
              ((gx + 0.5) / N) * wPx,
              (TOP + ((gy + 0.5) / N) * FIELD_H) * hPx - terrain.h[i] * liftPx,
            ];
          };

          // the kept river, threading and glinting
          if (terrain.river.length > 1) {
            ctx.lineWidth = 2.2;
            ctx.strokeStyle = "#7fc7d6";
            ctx.globalAlpha = 0.55 * (1 - world.night * 0.7);
            ctx.beginPath();
            for (let k = 0; k < terrain.river.length; k++) {
              const [px, py] = project(terrain.river[k]);
              if (k === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.stroke();
            // a bright bead running down the course
            const bead = (tSec * 0.15) % 1;
            const bi = Math.min(terrain.river.length - 1, Math.floor(bead * terrain.river.length));
            const [bx, by] = project(terrain.river[bi]);
            ctx.globalAlpha = 0.9 * (1 - world.night * 0.7);
            ctx.fillStyle = "#d7f2f7";
            ctx.beginPath();
            ctx.arc(bx, by, 2.6, 0, Math.PI * 2);
            ctx.fill();
          }

          // the hydrology lens: flow accumulation drawn as brightening threads
          if (world.lens > 0.5 && world.lens < 1.5) {
            const acc = flowAccumulation(terrain);
            let amax = 1;
            for (let i = 0; i < acc.length; i++) if (acc[i] > amax) amax = acc[i];
            ctx.globalAlpha = 0.5 * Math.min(1, world.lens);
            ctx.fillStyle = "#8fd0da";
            for (let i = 0; i < acc.length; i++) {
              const a = acc[i] / amax;
              if (a < 0.25) continue;
              const [px, py] = project(i);
              ctx.globalAlpha = 0.15 + a * 0.5;
              ctx.fillRect(px - 1.2, py - 1.2, 2.4, 2.4);
            }
          }

          // the soil-horizon lens: a cross-section strip along the mid row
          if (world.lens >= 1.5) {
            const row = (N / 2) | 0;
            ctx.globalAlpha = 0.85;
            for (let gx = 0; gx < N; gx++) {
              const i = row * N + gx;
              const x0 = (gx / N) * wPx;
              const wSeg = wPx / N + 1;
              const top = hPx * 0.62 - terrain.h[i] * liftPx * 0.6;
              // topsoil (green), subsoil (loam), moisture wedge below
              ctx.fillStyle = "#3a5a24";
              ctx.fillRect(x0, top, wSeg, 6 + terrain.g[i] * 10);
              ctx.fillStyle = "#4a3720";
              ctx.fillRect(x0, top + 6 + terrain.g[i] * 10, wSeg, 26);
              ctx.fillStyle = `rgba(80,130,150,${0.2 + Math.min(0.6, terrain.m[i] * 0.6)})`;
              ctx.fillRect(x0, top + 32 + terrain.g[i] * 10, wSeg, 14);
            }
          }

          // rain splashes soaking in
          for (const sp of splashes) {
            const age = (t - sp.t0) / 900;
            if (age < 0 || age >= 1) continue;
            ctx.globalAlpha = (1 - age) * 0.4;
            ctx.strokeStyle = sp.kind === 1 ? "#bfe6ef" : "#9fd0d8";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(sp.x * wPx, sp.y * hPx, (sp.r + age * 0.05) * wPx, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      offVisibility();
      writer.flush();
      inst?.dispose();
      quad?.dispose();
      stage?.dispose();
      apiRef.current = null;
    };
  }, []);

  // ——— the voice: what each verb of the grammar means in this ground ———
  const voice = useMemo(
    () => ({
      tap: (e: { fingers: number; count: number; intensity: number; x: number; y: number }) =>
        apiRef.current?.tap({ count: e.count, intensity: e.intensity, x: e.x, y: e.y }),
      stepBack: () => apiRef.current?.stepBack(),
      tutti: (e: { intensity: number }) => apiRef.current?.tutti(e.intensity),
      plant: (e: { x: number; y: number }) => apiRef.current?.plant(e.x, e.y),
      deepen: (e: { elapsed: number; x: number; y: number }) => apiRef.current?.deepen(e.elapsed, e.x, e.y),
      settle: (e: { elapsed: number }) => apiRef.current?.settle(e.elapsed),
      ceremony: (e: { x: number; y: number }) => apiRef.current?.ceremony(e.x, e.y),
      timeScale: (k: number) => apiRef.current?.timeScale(k),
      drag: (e: { phase: "start" | "move" | "end"; x: number; y: number; dx: number; dy: number }) =>
        apiRef.current?.drag(e.phase, e.x, e.y, e.dx, e.dy),
      wind: (e: { dx: number; dy: number }) => apiRef.current?.wind(e.dx, e.dy),
      flick: (e: { angle: number; speed: number; x: number; y: number }) =>
        apiRef.current?.flick(e.angle, e.speed, e.x, e.y),
      stir: (e: { winding: number; cx: number; cy: number }) => apiRef.current?.stir(e.winding, e.cx, e.cy),
      sustain: (e: { phase: "enter" | "tick" | "release"; spread: number; elapsed: number }) =>
        apiRef.current?.sustain(e.phase, e.spread, e.elapsed),
      lens: (e: { velocity: number }) => apiRef.current?.lens(e.velocity),
      season: (e: { velocity: number }) => apiRef.current?.season(e.velocity),
      rhythm: (e: { bpm: number; stability: number }) => apiRef.current?.rhythm(e.bpm, e.stability),
      scatter: (e: { intensity: number }) => apiRef.current?.scatter(e.intensity),
      gravity: (e: { beta: number; gamma: number }) => apiRef.current?.gravity(e.beta, e.gamma),
      knock: (e: { intensity: number }) => apiRef.current?.knock(e.intensity),
      night: (e: { faceDown: boolean }) => apiRef.current?.night(e.faceDown),
    }),
    [],
  );

  const cursorRef = useRef({ nx: 0.5, ny: 0.5 });
  const letGo = useCallback(() => apiRef.current?.letGo(), []);
  const onGlimmer = useCallback(() => apiRef.current?.glimmer(), []);

  return (
    <RoomShell
      route="/land"
      surfaceRef={wrapRef}
      voice={voice}
      // the page mounts ScaleTravel + MetaNavigator itself (like /rocks), so the
      // shell yields the axis chrome to avoid a second nav ring — it keeps the
      // full gesture table, the vessel, the glimmer clock and the quiet clear.
      chrome={false}
      letGo={{ label: "let the land go", onLetGo: letGo, visible: raised > 0 }}
      onGlimmer={onGlimmer}
      keyboard={{
        enter: () => apiRef.current?.raiseAt(cursorRef.current.nx, cursorRef.current.ny),
        enterHeld: (elapsed) => {
          if (elapsed > 700) apiRef.current?.raiseAt(cursorRef.current.nx, cursorRef.current.ny);
        },
        arrow: (dx, dy) => {
          cursorRef.current.nx = Math.min(0.95, Math.max(0.05, cursorRef.current.nx + dx * 0.04));
          cursorRef.current.ny = Math.min(0.95, Math.max(0.05, cursorRef.current.ny + dy * 0.04));
        },
        escape: () => apiRef.current?.stepBack(),
      }}
      style={{ position: "fixed", inset: 0, background: "#0c0a08" }}
    >
      <div ref={wrapRef} style={{ position: "absolute", inset: 0 }}>
        <canvas
          ref={canvasRef}
          role="application"
          tabIndex={0}
          aria-label="a parcel of living ground — a lit heightfield of loam and grass; rest a finger and a hummock rises and greens, scrub to rain and watch the water carve downhill, and a long hold sets a river that keeps its course"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }}
        />
        <canvas
          ref={overlayRef}
          aria-hidden
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
        />
      </div>
    </RoomShell>
  );
}
