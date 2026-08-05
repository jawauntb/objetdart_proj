"use client";

/**
 * /soil — compost, minerals, roots. A peer of /drop and /seed at the drop
 * band's scale (~10⁻³·⁵–10⁻¹·⁵ m): a hand's width of ground, seen in section,
 * and the lower door of the earth's wall (up to /earth or /flowers, down to
 * /cells).
 *
 * The invariant is a nutrient ledger (src/lib/humus.ts): litter rots to humus,
 * humus mineralizes, roots take the mineral up, fungi eat the litter, and
 * everything that dies falls back to the surface to start again. Two of the
 * five pools are not stuff but lives — the root pool IS the roots standing in
 * the section — so planting, competing, trading and dying are all just the
 * ledger moving. Nothing here is created except what falls in from the shared
 * coast (lib/world.ts), and nothing is destroyed at all.
 *
 * What the hand does with that:
 *   press and hold → a life is planted where the finger is. Shallow, in the
 *   litter, it is a fungus; deep, in the mineral, a root. Its first body is
 *   taken out of the litter lying there, so a spent surface refuses.
 *   flick → that life is pulled out and thrown, and lands back as litter.
 * Lives interact: two roots inside a hand's width take each other's supper and
 * one of them starves; a fungus beside a root feeds it and is paid in turn,
 * and the hypha between them is drawn only where the graph actually has one.
 *
 * The material is a WebGL fragment shader on `lib/webgl/stage` — horizons,
 * grain, aggregate, mineral glint, moisture and the wet halo around every
 * root, all decoded from the ledger — plus ONE dynamic line buffer for
 * everything alive (roots, hyphae, fungal bodies), rebuilt on a slow cadence
 * rather than per frame. The lockstep 2D overlay carries only the lens readout
 * and the hand's own marks. Growth is closed form: a fortnight away is one
 * exp() per life, never a replayed timeline, and drawing a deeper root costs
 * no more than a shallow one because growth is a cutoff along a fixed
 * skeleton.
 *
 * The grammar comes from `RoomShell` + `lib/gesture/defaults`, so every global
 * verb is answered; this file only says what each one MEANS in soil. State
 * lives in `objetdart:soil:v2` with the quiet clear at the bottom; a
 * deliberate letting-go is remembered, and starters never grow back over it.
 */

import { useEffect, useRef, useState } from "react";
import RoomShell from "@/components/RoomShell";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { stirTurbulence, getTurbulence } from "@/lib/turbulence";
import { getAllNaturals } from "@/lib/world";
import { spectralRegisterFor, entryScaleFor } from "@/lib/scale";
import { clocksFrom } from "@/lib/webgl/sizing";
import { createGLStage, FULLSCREEN_VERT_UNIT, type GLProgram, type GLStage } from "@/lib/webgl/stage";
import { createIdleWriter } from "@/lib/room-runtime";
import type { RoomVoice } from "@/lib/gesture/defaults";
import {
  MAX_ORGANISMS,
  POOLS,
  addLitter,
  clamp01,
  componentCount,
  decompositionOf,
  hashSeed,
  hzForMidi,
  largestComponentShare,
  mixAtDepth,
  mixOf,
  mulberry32,
  nearestOrganism,
  normalizePools,
  plant,
  reachAt,
  reconcile,
  rootReach,
  settle,
  settleElapsed,
  starterOrganisms,
  starterState,
  threadsBetween,
  timbreOf,
  timbreOfState,
  totalOf,
  transfer,
  uproot,
  voiceOf,
  type Climate,
  type Edge,
  type Mix,
  type Organism,
  type SoilState,
} from "@/lib/humus";

const STORE_KEY = "objetdart:soil:v2";
/** How many times real time the ground turns while someone is watching. */
const WATCHED_SPEED = 60;
/** What one natural that washed up on the shared coast is worth, fallen here. */
const LITTER_PER_FALL = 0.028;
const MAX_FALLS_PER_VISIT = 8;
/** The living geometry is rebuilt on this cadence, never per frame. */
const REBUILD_MS = 420;
/** Ceiling on the line buffer: the population cap decides it, not the frame. */
const MAX_LINE_VERTS = 6000;
/** Where the air stops and the section begins, in the unit frame. */
const HORIZON = 0.17;
/** Bytes per line vertex: vec2 position + vec4 colour. */
const LINE_STRIDE = 24;

type Stored = {
  pools: Partial<Record<string, number>>;
  tau: number;
  organisms: Organism[];
  season: number;
  lastSeen: number;
  cleared?: boolean;
};

/** The year as a ring of four climates. Three-finger twist walks it. */
const SEASONS: Climate[] = [
  { warmth: 0.34, wet: 0.72 }, // thaw
  { warmth: 0.9, wet: 0.34 },  // high summer
  { warmth: 0.46, wet: 0.66 }, // fall
  { warmth: 0.08, wet: 0.3 },  // frost
];
const SEASON_NAMES = ["thaw", "high summer", "fall", "frost"];

function seasonClimate(phase: number): Climate {
  const n = SEASONS.length;
  const p = ((phase % n) + n) % n;
  const i = Math.floor(p);
  const f = p - i;
  const a = SEASONS[i];
  const b = SEASONS[(i + 1) % n];
  return { warmth: a.warmth + (b.warmth - a.warmth) * f, wet: a.wet + (b.wet - a.wet) * f };
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

// ——— the ground, as one shader ——————————————————————————————————

const FRAG_GROUND = `
precision highp float;
varying vec2 vUv;
uniform vec2 uResolution;
uniform float uTime;
uniform float uBreath;
/** litter, humus, mineral, mycelium — the ledger as fractions */
uniform vec4 uPools;
/** warmth, wet */
uniform vec2 uClimate;
uniform float uStir;
uniform float uLean;
uniform float uNight;
uniform float uPress;
uniform vec2 uPressAt;
uniform int uOrgCount;
/** xy = where it stands, z = biomass, w = 1 for a root, 0 for a fungus */
uniform vec4 uOrgs[${MAX_ORGANISMS}];

// Hoskins' hash: stays uncorrelated at the large integer coordinates a
// pixel-scale grain field needs. The naive fract(p*p) hash lattices into
// visible stripes out there — the artefact this replaces.
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
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p *= 2.11;
    a *= 0.53;
  }
  return v;
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  float aspect = uResolution.x / max(1.0, uResolution.y);
  // the section leans with the vessel — the whole body of soil, not a filter
  vec2 suv = uv + vec2(uLean * 0.014 * (1.0 - uv.y), 0.0);

  float horizon = ${HORIZON.toFixed(3)};
  float dark = 1.0 - uNight * 0.62;
  float warmth = uClimate.x;
  float wet = uClimate.y;

  vec3 col;

  if (suv.y < horizon) {
    // the air above the section: warm at the ground, going to nothing
    float k = suv.y / horizon;
    col = mix(vec3(0.024, 0.019, 0.019), vec3(0.078 + warmth * 0.05, 0.055, 0.043), k * k);
    // dust hanging in the light, thicker when the ground is dry
    float dust = pow(vnoise(suv * vec2(60.0 * aspect, 60.0) + vec2(uTime * 0.06, -uTime * 0.02)), 22.0);
    col += vec3(0.7, 0.6, 0.44) * dust * (0.5 - wet * 0.35) * (0.5 + uBreath * 0.5);
  } else {
    float d = (suv.y - horizon) / (1.0 - horizon);

    // Horizons: their thickness IS the ledger. Press litter down and the top
    // band thins into the dark one, in the same frame as the sound changes.
    float warp = fbm(vec2(suv.x * 2.6, uTime * 0.008)) - 0.5;
    float warp2 = fbm(vec2(suv.x * 4.3 + 11.0, uTime * 0.006)) - 0.5;
    float oT = 0.02 + uPools.x * 0.62 * (1.0 - uStir * 0.45) + warp * 0.05;
    float aT = oT + 0.06 + uPools.y * 0.66 + warp2 * 0.09;
    float bT = aT + 0.1 + uPools.z * 0.8 + warp * 0.12;

    vec3 cO = vec3(0.2, 0.144, 0.082);                     // loose leaf litter
    vec3 cA = vec3(0.098 - uPools.y * 0.03, 0.066, 0.044); // the dark humic middle
    vec3 cB = vec3(0.132, 0.11, 0.09);                     // grit and mineral
    vec3 cC = vec3(0.072, 0.056, 0.046);                   // parent material

    // soft seams rather than steps — soil horizons interfinger
    float e1 = smoothstep(oT - 0.03, oT + 0.03, d);
    float e2 = smoothstep(aT - 0.045, aT + 0.045, d);
    float e3 = smoothstep(bT - 0.06, bT + 0.06, d);
    col = mix(cO, cA, e1);
    col = mix(col, cB, e2);
    col = mix(col, cC, e3);
    // a shadow just under each boundary, a lit lip just above it
    col *= 1.0 - 0.35 * (exp(-pow((d - oT) / 0.016, 2.0)) + exp(-pow((d - aT) / 0.02, 2.0)));
    col += 0.06 * vec3(1.0, 0.86, 0.62) * exp(-pow((d - oT + 0.012) / 0.008, 2.0));

    // grain — the thing that makes soil soil, at pixel scale so it never
    // reads as a texture stretched over a shape
    vec2 gp = floor(suv * uResolution * 0.4 + vec2(uStir * 7.0, 0.0));
    col *= 0.82 + 0.36 * hash21(gp);
    // aggregate: crumbs, clods, the peds a fork turns over
    float ped = fbm(suv * vec2(19.0 * aspect, 19.0));
    col *= 0.84 + 0.32 * ped;
    col += vec3(0.05, 0.038, 0.026) * smoothstep(0.6, 0.82, ped);

    // mineral grains catch what light there is — sparse, hard, and only down
    // in the horizon where the grit actually is
    float inB = smoothstep(aT, aT + 0.06, d) * (1.0 - smoothstep(bT - 0.04, bT + 0.02, d));
    float gl = hash21(floor(suv * uResolution * 0.5) + 71.0);
    float glint = smoothstep(0.9988, 1.0, gl) * (0.35 + 0.65 * uBreath);
    col += vec3(0.5, 0.51, 0.54) * glint * inB * (0.3 + uPools.z * 3.4);

    // water: darker, and a sheen gathering at the bottom of the section
    col *= 1.0 - wet * 0.16;
    col += vec3(0.05, 0.08, 0.1) * wet * smoothstep(0.45, 1.0, d) * 0.5;
    // heat in the top of the section on a high-summer day
    col += vec3(0.16, 0.07, 0.03) * max(0.0, warmth - 0.4) * (1.0 - smoothstep(0.0, 0.4, d)) * 0.5;

    // the lives, felt in the ground around them: a root wets and darkens the
    // soil it drinks from, a fungus pales and dries what it is eating
    for (int i = 0; i < ${MAX_ORGANISMS}; i++) {
      if (i >= uOrgCount) break;
      vec4 o = uOrgs[i];
      vec2 dp = (suv - vec2(o.x, horizon + o.y * (1.0 - horizon))) * vec2(aspect, 1.0);
      float rr = 0.05 + o.z * 1.1;
      float f = exp(-dot(dp, dp) / (rr * rr));
      if (o.w > 0.5) col *= 1.0 - 0.3 * f;
      else col += vec3(0.11, 0.1, 0.085) * f * (0.6 + uBreath * 0.4);
    }

    // the ground compacts under a held finger
    float pd = length((suv - uPressAt) * vec2(aspect, 1.0));
    col *= 1.0 - uPress * 0.4 * exp(-pd * pd / 0.006);
  }

  // held to the light, a section is dark at its edges
  vec2 vd = (uv - vec2(0.5, 0.46)) * vec2(aspect, 1.0);
  col *= 1.0 - 0.62 * smoothstep(0.18, 0.95, dot(vd, vd));
  col *= dark;
  gl_FragColor = vec4(col, 1.0);
}`;

const VERT_LINES = `
attribute vec2 a_pos;
attribute vec4 a_col;
uniform float uLean;
varying vec4 vCol;
void main() {
  vec2 p = a_pos + vec2(uLean * 0.012 * (1.0 - a_pos.y), 0.0);
  vCol = a_col;
  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);
}`;

const FRAG_LINES = `
precision mediump float;
varying vec4 vCol;
void main() { gl_FragColor = vec4(vCol.rgb * vCol.a, vCol.a); }`;

/**
 * A root's body: a fixed skeleton in the section's frame, decoded once from
 * the organism's seed. `t` is arc-length from the seed, and growth is a cutoff
 * against it, so a big root costs no more to draw than a small one and the
 * shape never jitters as it fills out.
 */
type Seg = { x0: number; y0: number; x1: number; y1: number; t: number; w: number };

function rootSkeleton(o: Organism): Seg[] {
  const rng = mulberry32(hashSeed(o.seed, o.id));
  const segs: Seg[] = [];
  const axis = (
    x: number, y: number, ang: number, len: number, w: number, order: number, t0: number,
  ) => {
    if (order > 3 || w < 0.18 || segs.length > 220) return;
    const steps = order === 0 ? 9 : 5;
    let px = x;
    let py = y;
    let a = ang;
    for (let i = 0; i < steps; i++) {
      // gravitropism: every step is pulled back toward straight down, harder
      // on the main axis than on a fine lateral
      a += (rng() - 0.5) * 0.7 + (Math.PI / 2 - a) * (0.3 - order * 0.07);
      const nx = px + Math.cos(a) * (len / steps);
      const ny = py + Math.sin(a) * (len / steps);
      const t = t0 + ((i + 1) / steps) * len;
      segs.push({ x0: px, y0: py, x1: nx, y1: ny, t, w: w * (1 - (i / steps) * 0.45) });
      px = nx;
      py = ny;
      // laterals leave the axis along it, alternating side, not all at once
      if (i >= 1 && i < steps - 1 && rng() < (order === 0 ? 0.8 : 0.5)) {
        const side = i % 2 === 0 ? 1 : -1;
        axis(px, py, a + side * (0.7 + rng() * 0.6), len * (0.42 + rng() * 0.26), w * 0.52, order + 1, t);
      }
    }
  };
  axis(o.nx, o.ny, Math.PI / 2, 0.34, 1, 0, 0);
  return segs;
}

/** The imperative surface the room's voice speaks to. */
type SoilApi = {
  tap: (x: number, y: number, intensity: number) => void;
  beginPress: (x: number, y: number) => void;
  grabAt: (x: number, y: number) => void;
  tutti: (intensity: number) => void;
  deepen: (x: number, y: number, elapsed: number, tier: number) => void;
  ceremony: (x: number, y: number) => void;
  timeScale: (k: number) => void;
  rake: (x: number, y: number, dx: number, dy: number) => void;
  weather: (dx: number, dy: number) => void;
  throwOut: (x: number, y: number, speed: number) => void;
  turnCompost: (angularVelocity: number) => void;
  lens: (angle: number, end: boolean) => void;
  season: (angle: number, end: boolean) => void;
  meter: (stability: number) => void;
  sift: () => void;
  turnOver: (intensity: number) => void;
  lean: (gamma: number) => void;
  settleGrains: (intensity: number) => void;
  night: (faceDown: boolean) => void;
  wind: (strength: number) => void;
  glimmer: () => void;
  moveCursor: (dx: number, dy: number) => void;
  keyTap: () => void;
  keyHold: (elapsed: number) => void;
  keyEscape: () => void;
  pullAtCursor: () => void;
  clear: () => void;
};

export default function SoilGround() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const glRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const apiRef = useRef<SoilApi | null>(null);
  const reducedRef = useRef<((v: boolean) => void) | null>(null);
  const [hasKept, setHasKept] = useState(false);

  // A stable voice: RoomShell reads it through a ref, and every verb delegates
  // to whatever the effect has published, so the engine never loses a hold.
  const voiceRef = useRef<RoomVoice>({
    tap: (e) => apiRef.current?.tap(e.x, e.y, e.intensity),
    plant: (e) => apiRef.current?.beginPress(e.x, e.y),
    tutti: (e) => apiRef.current?.tutti(e.intensity),
    deepen: (e) => apiRef.current?.deepen(e.x, e.y, e.elapsed, e.tier),
    ceremony: (e) => apiRef.current?.ceremony(e.x, e.y),
    timeScale: (k) => apiRef.current?.timeScale(k),
    drag: (e) => {
      if (e.phase === "start") apiRef.current?.grabAt(e.x, e.y);
      if (e.phase !== "end") apiRef.current?.rake(e.x, e.y, e.dx, e.dy);
    },
    wind: (e) => apiRef.current?.weather(e.dx, e.dy),
    flick: (e) => apiRef.current?.throwOut(e.x, e.y, e.speed),
    stir: (e) => apiRef.current?.turnCompost(e.angularVelocity),
    lens: (e) => apiRef.current?.lens(e.angle, e.velocity === 0),
    season: (e) => apiRef.current?.season(e.angle, e.velocity === 0),
    rhythm: (e) => apiRef.current?.meter(e.stability),
    drum: () => apiRef.current?.sift(),
    scatter: (e) => apiRef.current?.turnOver(e.intensity),
    gravity: (e) => apiRef.current?.lean(e.gamma),
    knock: (e) => apiRef.current?.settleGrains(e.intensity),
    night: (e) => apiRef.current?.night(e.faceDown),
    breath: (e) => apiRef.current?.wind(e.strength),
  });

  const keyboardRef = useRef({
    enter: () => apiRef.current?.keyTap(),
    enterHeld: (elapsed: number) => apiRef.current?.keyHold(elapsed),
    escape: () => apiRef.current?.keyEscape(),
    arrow: (dx: number, dy: number) => apiRef.current?.moveCursor(dx, dy),
  });

  useEffect(() => {
    const wrap = wrapRef.current;
    const glCanvas = glRef.current;
    const overlay = overlayRef.current;
    if (!wrap || !glCanvas || !overlay) return;

    const audio = getFieldAudio();
    let reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ——— the ledger, the lives, and the clock they lived through ———
    let soil: SoilState = starterState(0x501);
    let orgs: Organism[] = [];
    let cleared = false;
    let visited = false;
    let season = 2.1;
    let lastSeen = Date.now();
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (raw) {
        visited = true;
        const parsed = JSON.parse(raw) as Stored;
        cleared = parsed.cleared === true;
        if (typeof parsed.season === "number" && Number.isFinite(parsed.season)) season = parsed.season;
        if (typeof parsed.lastSeen === "number" && Number.isFinite(parsed.lastSeen)) lastSeen = parsed.lastSeen;
        soil = {
          pools: normalizePools(parsed.pools ?? {}),
          tau: typeof parsed.tau === "number" && parsed.tau > 0 ? parsed.tau : 0,
        };
        if (Array.isArray(parsed.organisms)) {
          orgs = parsed.organisms
            .filter(
              (o) =>
                o &&
                (o.kind === "root" || o.kind === "fungus") &&
                Number.isFinite(o.nx) &&
                Number.isFinite(o.ny) &&
                Number.isFinite(o.m) &&
                o.m > 0,
            )
            .slice(0, MAX_ORGANISMS)
            .map((o, i) => ({
              id: Number.isFinite(o.id) ? o.id : i + 1,
              kind: o.kind,
              nx: clamp01(o.nx),
              ny: clamp01(o.ny),
              m: o.m,
              bornTau: Number.isFinite(o.bornTau) ? o.bornTau : 0,
              seed: (Number(o.seed) || 1) >>> 0,
            }));
        }
        // the lives are the truth; the pools are re-read off them
        soil = reconcile(soil, orgs);
      }
    } catch {
      /* fresh ground */
    }
    if (!visited && !cleared) {
      // Alive before it is touched: the ground is already old and already
      // inhabited when you arrive, and its lives were made out of it.
      const started = starterOrganisms(starterState(0x501), 0x501);
      soil = started.state;
      orgs = started.organisms;
    }

    const climateAt = (s: number, dw: number, dq: number): Climate => {
      const base = seasonClimate(s);
      return { warmth: clamp01(base.warmth + dw), wet: clamp01(base.wet + dq) };
    };

    // ——— what happened while nobody was watching ———
    // The clock is read ONCE, here. Both halves of the model are closed form,
    // so a month away costs one call, not a replayed timeline.
    let awayGrowth = 0;
    if (visited) {
      const away = Math.max(0, (Date.now() - lastSeen) / 1000);
      if (away > 0) {
        const before = soil.pools.root + soil.pools.mycelium;
        const res = settleElapsed(soil, orgs, away, seasonClimate(season));
        soil = res.state;
        orgs = res.organisms;
        awayGrowth = soil.pools.root + soil.pools.mycelium - before;
      }
      // What washed up on the shared coast since the last visit falls here and
      // rots. Read-only: the soil joins the one world, it does not rewrite it.
      try {
        const fallen = getAllNaturals().filter(
          (n) =>
            n.createdAt > lastSeen &&
            (n.kind === "leaf" || n.kind === "kelp" || n.kind === "driftwood" || n.kind === "lily"),
        );
        const n = Math.min(MAX_FALLS_PER_VISIT, fallen.length);
        for (let i = 0; i < n; i++) soil = addLitter(soil, LITTER_PER_FALL).state;
      } catch {
        /* the coast is not readable here; the ground keeps its own */
      }
    }
    setHasKept(orgs.length > 0);

    // Shared idle writer. The private SAVE_EVERY_MS throttle this room used
    // to roll had exactly the SoilGround-pattern hazard test:room-quality
    // exists to catch — the manual `dirty` flag could hold a pending save
    // that a fast pagehide missed. The writer coalesces through
    // requestIdleCallback and flushes on unmount / hide, so the payload
    // shape at objetdart:soil:v2 is unchanged but nothing is lost between
    // visits.
    const writeStore = () => {
      try {
        const payload: Stored = {
          pools: soil.pools,
          tau: soil.tau,
          organisms: orgs,
          season,
          lastSeen: Date.now(),
          cleared,
        };
        window.localStorage.setItem(STORE_KEY, JSON.stringify(payload));
      } catch {
        /* quota; the ground keeps going */
      }
    };
    const writer = createIdleWriter(writeStore);
    const save = (force = false) => {
      if (force) {
        writer.schedule();
        writer.flush();
      } else {
        writer.schedule();
      }
    };
    save(true);

    // ——— the room's live axes ———
    let raf = 0;
    let last = performance.now();
    let localT = 0;
    let timeScale = 1;
    let timeScaleTarget = 1;
    let dWarm = 0;
    let dWet = 0;
    let lens = 0;
    let lensTarget = 0;
    let lensSnapped = 0;
    let lean = 0;
    let leanTarget = 0;
    let night = 0;
    let nightTarget = 0;
    let stir = 0;
    let press = 0;
    let pressX = 0.5;
    let pressY = 0.5;
    let cursorX = 0.5;
    let cursorY = 0.6;
    let cursorLit = 0;
    let kbCharge = 0;
    let lastChatterAt = 0;
    let lastPressElapsed = 0;
    /** where the hand landed before it threw — a flick reports where it LET GO */
    let grabX = 0.5;
    let grabY = 0.5;
    /** the life the hand closed on, if any: what a throw or a lift takes out */
    let grabbedId: number | null = null;
    let seasonSaid = 0;
    let edges: Edge[] = [];
    let islands = 0;
    let knit = 0;
    /** rings left where a handful was lifted, where a life answered */
    const marks: { x: number; y: number; t: number; bright: number; kind: 0 | 1 | 2 }[] = [];
    const skeletons = new Map<number, Seg[]>();
    const skeletonFor = (o: Organism): Seg[] => {
      let s = skeletons.get(o.id);
      if (!s) {
        s = rootSkeleton(o);
        skeletons.set(o.id, s);
      }
      return s;
    };

    // ——— the stage ———
    let stage: GLStage | null = null;
    let ground: GLProgram | null = null;
    let quad: { draw: () => void; dispose: () => void } | null = null;
    let lineProg: GLProgram | null = null;
    let lineBuf: WebGLBuffer | null = null;
    let aLinePos = -1;
    let aLineCol = -1;
    let needsUpload = true;
    const orgUniform = new Float32Array(MAX_ORGANISMS * 4);
    const lineData = new Float32Array(MAX_LINE_VERTS * 6);
    let lineVerts = 0;
    let lastRebuildAt = -1e9;

    const buildPrograms = () => {
      if (!stage) return;
      ground = stage.program(FULLSCREEN_VERT_UNIT, FRAG_GROUND);
      quad = ground ? stage.fullscreenQuad(ground, "unit") : null;
      lineProg = stage.program(VERT_LINES, FRAG_LINES);
      if (lineProg) {
        aLinePos = lineProg.attrib("a_pos");
        aLineCol = lineProg.attrib("a_col");
      }
      lineBuf = stage.gl.createBuffer();
      needsUpload = true;
      stage.gl.disable(stage.gl.DEPTH_TEST);
      stage.gl.enable(stage.gl.BLEND);
      stage.gl.blendFunc(stage.gl.ONE, stage.gl.ONE_MINUS_SRC_ALPHA);
    };

    stage = createGLStage(glCanvas, {
      wrap,
      label: "soil",
      overlay,
      contextAttributes: { alpha: false, antialias: true },
      onContextRestored: () => {
        buildPrograms();
        lastRebuildAt = -1e9;
      },
    });
    if (stage) buildPrograms();
    const ctx = stage?.overlay2d ?? overlay.getContext("2d");

    const pushLine = (
      x0: number, y0: number, x1: number, y1: number,
      r: number, g: number, b: number, a: number,
    ) => {
      if (lineVerts + 2 > MAX_LINE_VERTS) return;
      const i = lineVerts * 6;
      lineData[i] = x0; lineData[i + 1] = y0;
      lineData[i + 2] = r; lineData[i + 3] = g; lineData[i + 4] = b; lineData[i + 5] = a;
      lineData[i + 6] = x1; lineData[i + 7] = y1;
      lineData[i + 8] = r; lineData[i + 9] = g; lineData[i + 10] = b; lineData[i + 11] = a;
      lineVerts += 2;
    };

    let glimmerEdge = -1;

    /**
     * Everything alive, into one buffer: roots to the depth they have grown,
     * the hyphae the graph actually holds, and the fungal bodies. O(lives), on
     * a slow cadence — the frame loop only draws it.
     */
    const rebuildLiving = (now: number, force = false) => {
      if (!force && now - lastRebuildAt < REBUILD_MS) return;
      lastRebuildAt = now;
      const mix = mixOf(soil);
      edges = threadsBetween(orgs, reachAt(soil.tau, mix.mycelium));
      islands = componentCount(orgs.length, edges);
      knit = largestComponentShare(orgs.length, edges);
      lineVerts = 0;

      const toY = (ny: number) => HORIZON + ny * (1 - HORIZON);

      // hyphae first, so the roots and bodies sit over them
      for (let k = 0; k < edges.length; k++) {
        const a = orgs[edges[k].a];
        const b = orgs[edges[k].b];
        const glow = k === glimmerEdge ? 0.55 : 0.16 + mix.mycelium * 0.9;
        const ax = a.nx;
        const ay = toY(a.ny);
        const bx = b.nx;
        const by = toY(b.ny);
        // a hypha wanders; it does not rule a line between two points
        const px = -(by - ay);
        const py = bx - ax;
        const amp = 0.1 + ((k * 37) % 11) / 90;
        let lx = ax;
        let ly = ay;
        for (let q = 1; q <= 7; q++) {
          const u = q / 7;
          const bow = Math.sin(u * Math.PI) * amp * Math.sin(k * 1.7 + u * 3.1);
          const nx = ax + (bx - ax) * u + px * bow;
          const ny = ay + (by - ay) * u + py * bow;
          pushLine(lx, ly, nx, ny, 0.9, 0.86, 0.76, glow);
          lx = nx;
          ly = ny;
        }
      }

      for (const o of orgs) {
        if (o.kind === "root") {
          const reach = rootReach(o);
          const thick = clamp01(o.m * 6);
          for (const s of skeletonFor(o)) {
            if (s.t > reach) continue;
            // the tip fades in as it arrives, so growth is visibly growth
            const near = clamp01((reach - s.t) * 14);
            const a = clamp01((0.5 + near * 0.45) * (0.5 + thick * 0.5) * (0.4 + s.w * 0.6));
            // gl.lineWidth is one pixel almost everywhere, so a root gets its
            // body from parallel strokes: more of them as it thickens
            const dx = s.x1 - s.x0;
            const dy = toY(s.y1) - toY(s.y0);
            const len = Math.hypot(dx, dy) || 1;
            const px = -dy / len;
            const py = dx / len;
            const strokes = 1 + Math.round(s.w * (1.6 + thick * 3.4));
            for (let k = 0; k < strokes; k++) {
              const off = ((k - (strokes - 1) / 2) * 0.0016) / Math.max(0.35, s.w);
              const fade = 1 - Math.abs(k - (strokes - 1) / 2) / (strokes * 0.9);
              pushLine(
                s.x0 + px * off, toY(s.y0) + py * off,
                s.x1 + px * off, toY(s.y1) + py * off,
                0.91, 0.79, 0.57, a * (0.55 + fade * 0.45),
              );
            }
          }
        } else {
          // a fungal body: a tuft of wandering hyphae, not a star
          const r = 0.02 + Math.sqrt(Math.max(0, o.m)) * 0.38;
          const rng = mulberry32(hashSeed(o.seed, 7));
          const y = toY(o.ny);
          for (let i = 0; i < 11; i++) {
            let ang = (i / 11) * Math.PI * 2 + rng() * 0.5;
            let x = o.nx;
            let yy = y;
            const step = (r * (0.45 + rng() * 0.7)) / 3;
            for (let q = 0; q < 3; q++) {
              ang += (rng() - 0.5) * 0.9;
              const nx2 = x + Math.cos(ang) * step * 0.62;
              const ny2 = yy + Math.sin(ang) * step;
              pushLine(x, yy, nx2, ny2, 0.93, 0.91, 0.83, 0.4 - q * 0.09);
              x = nx2;
              yy = ny2;
            }
          }
        }
      }
      needsUpload = true;
    };

    // ——— sound: the ledger, heard ———
    const sound = (mix: Mix, total: number, strength = 1) => {
      const partials = voiceOf(timbreOf(mix, total));
      partials.forEach((p, i) => {
        window.setTimeout(() => {
          try {
            audio.playTone(p.hz, Math.max(0.05, p.sec * p.gain * strength));
          } catch {
            /* the sea is not awake */
          }
        }, i * 9);
      });
    };

    const mark = (x: number, y: number, bright: number, kind: 0 | 1 | 2) => {
      marks.push({ x, y, t: performance.now(), bright, kind });
      if (marks.length > 10) marks.shift();
    };

    const toLocal = (cx: number, cy: number) => {
      const r = wrap.getBoundingClientRect();
      return {
        nx: clamp01((cx - r.left) / Math.max(1, r.width)),
        ny: clamp01((cy - r.top) / Math.max(1, r.height)),
      };
    };
    const depthOf = (ny: number) => clamp01((ny - HORIZON) / (1 - HORIZON));

    /** A handful lifted where the hand is: the layering makes it its own soil. */
    const liftHandful = (nx: number, ny: number, strength: number) => {
      const layered = mixAtDepth(mixOf(soil), stir > 0.5 ? 0.5 : depthOf(ny));
      sound(layered, totalOf(soil), 0.7 + strength * 0.6);
      mark(nx, ny, 0.4 + strength * 0.6, 0);
      try {
        haptics.ripple(0.3 + strength * 0.4);
      } catch {
        /* noop */
      }
    };

    /** A life sounded on its own — its mass is its pitch, its kind its colour. */
    const soundLife = (o: Organism) => {
      const t = timbreOfState(soil);
      const midi = (o.kind === "root" ? 33 : 45) - Math.round(clamp01(o.m * 6) * 7);
      try {
        audio.playNote(midi, 260 + o.m * 900);
        audio.playTone(hzForMidi(midi) * (o.kind === "root" ? 2 : 3) + t.beatHz, 0.16);
        haptics.tap();
      } catch {
        /* noop */
      }
      mark(o.nx, HORIZON + o.ny * (1 - HORIZON), 0.9, o.kind === "root" ? 1 : 2);
    };

    /** Litter pressed down into humus — decomposition, done by hand. */
    const pressDown = (amount: number) => {
      const res = transfer(soil, "litter", "humus", amount);
      soil = res.state;
      if (res.moved > 0) save();
      return res.moved;
    };

    /**
     * The ceremony: a life planted. Where the finger is decides what it is —
     * up in the litter a fungus, down in the mineral a root — and its body is
     * taken out of the litter lying there, so a spent surface refuses.
     */
    const plantHere = (nx: number, ny: number) => {
      const depth = depthOf(ny);
      const kind = depth < 0.42 ? "fungus" : "root";
      const res = plant(soil, orgs, kind, nx, depth, hashSeed(nx * 1e4, ny * 1e4, orgs.length, soil.tau));
      if (!res.planted) {
        try {
          audio.refuse();
          haptics.tap();
        } catch {
          /* noop */
        }
        return;
      }
      soil = res.state;
      orgs = res.organisms;
      rebuildLiving(performance.now(), true);
      soundLife(res.planted);
      try {
        audio.bell();
        haptics.bloom();
      } catch {
        /* noop */
      }
      setHasKept(true);
      save(true);
    };

    /** Pulled out and thrown. Its body lands back on the surface as litter. */
    const uprootNear = (nx: number, ny: number) => {
      const found = nearestOrganism(orgs, nx, depthOf(ny), 0.2);
      if (!found) return false;
      const res = uproot(soil, orgs, found.id);
      soil = res.state;
      orgs = res.organisms;
      skeletons.delete(found.id);
      rebuildLiving(performance.now(), true);
      mark(found.nx, HORIZON + found.ny * (1 - HORIZON), 1, 0);
      setHasKept(orgs.length > 0);
      try {
        audio.thud();
        haptics.chop();
      } catch {
        /* noop */
      }
      save(true);
      return true;
    };

    const setLens = (snapped: number) => {
      if (snapped === lensSnapped) return;
      lensSnapped = snapped;
      lensTarget = snapped;
      try {
        haptics.lens();
        audio.playNote(snapped === 1 ? 41 : 29, 200);
      } catch {
        /* noop */
      }
    };

    // ——— what each verb MEANS here ———
    apiRef.current = {
      tap: (x, y, intensity) => {
        const { nx, ny } = toLocal(x, y);
        cursorX = nx;
        cursorY = ny;
        grabX = nx;
        grabY = ny;
        cursorLit = 1;
        const found = nearestOrganism(orgs, nx, depthOf(ny), 0.09);
        if (found) soundLife(found);
        else liftHandful(nx, ny, intensity);
      },
      tutti: (intensity) => {
        sound(mixOf(soil), totalOf(soil), 0.9 + intensity * 0.3);
        for (let i = 0; i < 3; i++) mark(0.2 + i * 0.3, 0.4 + i * 0.12, 0.7, 0);
        try {
          haptics.ripple(0.55);
        } catch {
          /* noop */
        }
      },
      deepen: (x, y, elapsed, tier) => {
        const { nx, ny } = toLocal(x, y);
        pressX = nx;
        pressY = ny;
        press = clamp01(elapsed / 2400);
        // A hold ticks every frame, so what it moves has to be a RATE, not a
        // per-tick amount — otherwise a two-second press mineralizes the whole
        // surface and the ceremony that follows has nothing to make a seed
        // from. Duration is still the axis: the rate rises with the hold.
        const step = Math.min(0.12, Math.max(0, (elapsed - lastPressElapsed) / 1000));
        lastPressElapsed = elapsed;
        if (tier < 1) return;
        const moved = pressDown(0.004 * step * (1 + elapsed / 2400));
        if (performance.now() - lastChatterAt > 210) {
          lastChatterAt = performance.now();
          const t = timbreOfState(soil);
          try {
            audio.playTone(hzForMidi(t.midi) * (1 + elapsed / 26000), 0.09);
            haptics.tap();
          } catch {
            /* noop */
          }
        }
        if (moved <= 0 && tier >= 2 && performance.now() - lastChatterAt > 400) {
          lastChatterAt = performance.now();
          try {
            audio.buzz();
          } catch {
            /* noop */
          }
        }
      },
      beginPress: (x, y) => {
        const { nx, ny } = toLocal(x, y);
        pressX = nx;
        pressY = ny;
        grabX = nx;
        grabY = ny;
        grabbedId = null;
        lastPressElapsed = 0;
      },
      grabAt: (x, y) => {
        const { nx, ny } = toLocal(x, y);
        grabX = nx;
        grabY = ny;
        grabbedId = nearestOrganism(orgs, nx, depthOf(ny), 0.12)?.id ?? null;
      },
      ceremony: (x, y) => {
        const { nx, ny } = toLocal(x, y);
        press = 0;
        lastPressElapsed = 0;
        plantHere(nx, ny);
      },
      timeScale: (k) => {
        timeScaleTarget = clamp(k, 0.15, 1);
      },
      rake: (x, y, dx) => {
        const { nx, ny } = toLocal(x, y);
        cursorX = nx;
        cursorY = ny;
        cursorLit = 1;
        // A life dragged up past the surface comes out of the ground with the
        // hand, and lands back on the litter it was made from. Pulling is the
        // planting gesture run backwards, and it conserves the same ledger.
        if (grabbedId !== null && ny < HORIZON) {
          const pulled = orgs.find((o) => o.id === grabbedId);
          grabbedId = null;
          if (pulled) uprootNear(pulled.nx, HORIZON + pulled.ny * (1 - HORIZON));
          return;
        }
        const w = wrap.getBoundingClientRect().width || 1;
        stir = Math.min(1, stir + (Math.abs(dx) / w) * 2.4);
        if (performance.now() - lastChatterAt > 60) {
          lastChatterAt = performance.now();
          const t = timbreOfState(soil);
          try {
            audio.playTone(t.centroidHz * (0.7 + (nx % 0.3)), 0.035);
            haptics.tap();
          } catch {
            /* noop */
          }
        }
      },
      weather: (dx, dy) => {
        dWarm = clamp(dWarm + dx * 0.0022, -0.6, 0.6);
        dWet = clamp(dWet + dy * 0.0022, -0.6, 0.6);
        if (performance.now() - lastChatterAt > 260) {
          lastChatterAt = performance.now();
          try {
            audio.playTone(70 + dWarm * 40, 0.16);
            haptics.tap();
          } catch {
            /* noop */
          }
        }
      },
      throwOut: (x, y, speed) => {
        const { nx, ny } = toLocal(x, y);
        // What a flick throws is what the hand had hold of when it started,
        // not what happens to be under it when it lets go — the engine
        // reports the release point, so the grab point is kept here.
        grabbedId = null;
        if (!uprootNear(grabX, grabY) && !uprootNear(nx, ny)) {
          stir = 1;
          mark(nx, ny, 0.7, 0);
          stirTurbulence(0.06 + Math.min(0.14, speed / 9000));
          try {
            audio.thud();
            haptics.chop();
          } catch {
            /* noop */
          }
        }
      },
      turnCompost: (angularVelocity) => {
        const moved = pressDown(0.0016 * Math.min(3, Math.abs(angularVelocity)));
        stir = Math.min(1, stir + 0.25);
        if (moved > 0) {
          const t = timbreOfState(soil);
          try {
            audio.playTone(hzForMidi(t.midi) * 0.5, 0.24);
            haptics.chop();
          } catch {
            /* noop */
          }
        }
      },
      lens: (angle, end) => {
        if (end) setLens(lensTarget > 0.5 ? 1 : 0);
        else lensTarget = clamp01(lensTarget + angle / 1.7);
      },
      season: (angle, end) => {
        if (end) {
          save(true);
          return;
        }
        // Time only ever moves forward: turning the year advances the soil's
        // own maturity by the span the turn names.
        season += angle / 2.4;
        const span = Math.abs(angle / 2.4) * 24 * 3600;
        const res = settle(soil, orgs, span, climateAt(season, dWarm, dWet));
        soil = res.state;
        orgs = res.organisms;
        if (res.died.length > 0) {
          for (const id of res.died) skeletons.delete(id);
          rebuildLiving(performance.now(), true);
          setHasKept(orgs.length > 0);
        }
        if (performance.now() - lastChatterAt > 220) {
          lastChatterAt = performance.now();
          try {
            audio.playNote(30 + Math.round(seasonClimate(season).warmth * 10), 240);
            haptics.detent();
          } catch {
            /* noop */
          }
        }
        seasonSaid = 1;
      },
      meter: (stability) => {
        if (stability > 0.68) sound(mixOf(soil), totalOf(soil), 0.8);
      },
      sift: () => {
        // two-handed sifting: the grit rings and the fines fall through
        const t = timbreOfState(soil);
        stir = Math.min(1, stir + 0.3);
        try {
          audio.playTone(t.centroidHz * 1.5, t.ringSec * 0.5);
          haptics.roll();
        } catch {
          /* noop */
        }
      },
      turnOver: (intensity) => {
        if (reduced) return;
        // the ground is turned over: litter and humus trade in both directions
        const a = 0.02 * intensity;
        soil = transfer(soil, "litter", "humus", a).state;
        soil = transfer(soil, "humus", "litter", a * 0.6).state;
        stir = 1;
        stirTurbulence(0.2 + intensity * 0.3);
        const t = timbreOfState(soil);
        try {
          audio.playTone(hzForMidi(t.midi) * 0.5, 0.5);
          haptics.chop();
        } catch {
          /* noop */
        }
        save();
      },
      lean: (gamma) => {
        leanTarget = reduced ? 0 : clamp(gamma / 42, -1, 1);
      },
      settleGrains: (intensity) => {
        // a knock settles the section: the grains find their packing
        stir = Math.max(0, stir - 0.3);
        const t = timbreOfState(soil);
        try {
          audio.thud();
          audio.playTone(hzForMidi(t.midi) * 0.25, 0.3 + intensity * 0.2);
          haptics.detent();
        } catch {
          /* noop */
        }
      },
      night: (faceDown) => {
        nightTarget = faceDown ? 1 : 0;
      },
      wind: (strength) => {
        // breath on the surface lifts the dry litter — only ever the top
        if (reduced) return;
        stir = Math.min(1, stir + strength * 0.5);
        try {
          audio.playTone(180 + strength * 220, 0.3);
        } catch {
          /* noop */
        }
      },
      glimmer: () => {
        // one hypha creeps visibly further, alone, and nothing is said
        glimmerEdge = edges.length > 0 ? Math.floor(mulberry32(hashSeed(Date.now() / 1000))() * edges.length) : -1;
        lastRebuildAt = -1e9;
        window.setTimeout(() => {
          glimmerEdge = -1;
          lastRebuildAt = -1e9;
        }, 2200);
      },
      moveCursor: (dx, dy) => {
        cursorX = clamp01(cursorX + dx * 0.06);
        cursorY = clamp(cursorY + dy * 0.06, HORIZON + 0.01, 0.98);
        cursorLit = 1;
        const found = nearestOrganism(orgs, cursorX, depthOf(cursorY), 0.07);
        if (found) soundLife(found);
        else liftHandful(cursorX, cursorY, 0.45);
      },
      keyTap: () => {
        liftHandful(cursorX, cursorY, 0.55);
        kbCharge = 0.04;
      },
      keyHold: (elapsed) => {
        // held enter is the keyboard's press, and its ceremony — the same
        // rate the finger presses at, sampled on the shell's 250ms tick
        kbCharge = clamp01(elapsed / 2400);
        press = kbCharge;
        pressX = cursorX;
        pressY = cursorY;
        pressDown(0.004 * 0.25 * (1 + elapsed / 2400));
        if (kbCharge >= 1) {
          kbCharge = 0;
          press = 0;
          plantHere(cursorX, cursorY);
        }
      },
      keyEscape: () => {
        if (lensSnapped === 1) setLens(0);
        kbCharge = 0;
        press = 0;
        cursorLit = 0;
      },
      pullAtCursor: () => {
        if (!uprootNear(cursorX, cursorY)) {
          try {
            audio.refuse();
          } catch {
            /* noop */
          }
        }
      },
      clear: () => {
        orgs = [];
        skeletons.clear();
        soil = { pools: { litter: 0.04, humus: 0.1, mineral: 0.03, mycelium: 0, root: 0 }, tau: 0 };
        cleared = true;
        edges = [];
        rebuildLiving(performance.now(), true);
        setHasKept(false);
        save(true);
        try {
          audio.thud();
          haptics.roll();
        } catch {
          /* noop */
        }
      },
    };

    // Pulling a life out is the one verb the shared keyboard dialect has no
    // seat for, so the room adds it rather than leaving deletion touch-only.
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key !== "Backspace" && e.key !== "Delete") return;
      e.preventDefault();
      apiRef.current?.pullAtCursor();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        kbCharge = 0;
        press = 0;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    const onHide = () => {
      if (document.visibilityState === "hidden") save(true);
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);

    const register = spectralRegisterFor(entryScaleFor("/soil") ?? -2.5);

    // ——— the loop: O(visible), one rAF, never O(history) ———
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const delta = Math.min(64, now - last);
      last = now;
      const dt = delta / 1000;

      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dt * 5);
      if (!reduced) localT += dt * timeScale;
      lens += (lensTarget - lens) * Math.min(1, dt * 6);
      lean += (leanTarget - lean) * Math.min(1, dt * 3);
      night += (nightTarget - night) * Math.min(1, dt * 2);
      stir = Math.max(0, stir - dt * 0.22);
      press = Math.max(0, press - dt * 0.9);
      cursorLit = Math.max(0, cursorLit - dt * 0.5);
      seasonSaid = Math.max(0, seasonSaid - dt * 0.35);
      dWarm *= Math.exp(-dt * 0.025);
      dWet *= Math.exp(-dt * 0.025);

      // The ground keeps turning while you watch, on the same closed form:
      // one step per frame, and a step per frame lands where one long step
      // would, so watching and being away are the same law.
      const climate = climateAt(season, dWarm, dWet);
      const res = settle(soil, orgs, dt * timeScale * WATCHED_SPEED, climate);
      soil = res.state;
      orgs = res.organisms;
      if (res.died.length > 0) {
        for (const id of res.died) skeletons.delete(id);
        setHasKept(orgs.length > 0);
        rebuildLiving(now, true);
        try {
          audio.playTone(64, 0.5);
        } catch {
          /* noop */
        }
      }
      // idle persistence is coalesced by the shared writer; every discrete
      // event that changes the ground already schedules through save().
      rebuildLiving(now);

      const mix = mixOf(soil);
      const t = audio.getAudioTime() ?? now / 1000;
      const clocks = clocksFrom({
        time: t,
        turbulence: getTurbulence(),
        register,
        reducedMotion: reduced,
      });

      // ——— the ground ———
      let width = 0;
      let height = 0;
      if (stage && ground && quad) {
        const size = stage.beginFrame(clocks, ground);
        width = size.width;
        height = size.height;
        ground.setVec4("uPools", mix.litter, mix.humus, mix.mineral, mix.mycelium);
        ground.setVec2("uClimate", climate.warmth, climate.wet);
        ground.setFloat("uStir", stir);
        ground.setFloat("uLean", lean);
        ground.setFloat("uNight", night);
        ground.setFloat("uPress", press);
        ground.setVec2("uPressAt", pressX, pressY);
        const n = Math.min(MAX_ORGANISMS, orgs.length);
        for (let i = 0; i < n; i++) {
          orgUniform[i * 4] = orgs[i].nx;
          orgUniform[i * 4 + 1] = orgs[i].ny;
          orgUniform[i * 4 + 2] = orgs[i].m;
          orgUniform[i * 4 + 3] = orgs[i].kind === "root" ? 1 : 0;
        }
        ground.setInt("uOrgCount", n);
        ground.setFloatArray("uOrgs", orgUniform);
        quad.draw();

        // ——— everything alive: one buffer, one draw ———
        const gl = stage.gl;
        if (lineProg && lineBuf && lineVerts > 0) {
          lineProg.use();
          gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
          if (needsUpload) {
            gl.bufferData(gl.ARRAY_BUFFER, lineData.subarray(0, lineVerts * 6), gl.DYNAMIC_DRAW);
            needsUpload = false;
          }
          gl.enableVertexAttribArray(aLinePos);
          gl.vertexAttribPointer(aLinePos, 2, gl.FLOAT, false, LINE_STRIDE, 0);
          gl.enableVertexAttribArray(aLineCol);
          gl.vertexAttribPointer(aLineCol, 4, gl.FLOAT, false, LINE_STRIDE, 8);
          lineProg.setFloat("uLean", lean);
          gl.drawArrays(gl.LINES, 0, lineVerts);
        }
      } else {
        const r = wrap.getBoundingClientRect();
        width = r.width;
        height = r.height;
      }

      if (!ctx) return;
      // ——— the overlay: only the hand's own marks and the lens ———
      ctx.clearRect(0, 0, width, height);
      if (!stage) {
        // no shader on this device: the section still reads as ground, and
        // every gesture still lands in sound and in haptics
        ctx.fillStyle = "#0a0806";
        ctx.fillRect(0, 0, width, height);
        const h = HORIZON * height;
        let y = h;
        const bands: [number, string][] = [
          [mix.litter * 0.62 + 0.02, "#3a2716"],
          [mix.humus * 0.66 + 0.06, "#231810"],
          [mix.mineral * 0.8 + 0.1, "#2b241d"],
          [1, "#161210"],
        ];
        for (const [thick, color] of bands) {
          const hh = thick * (height - h);
          ctx.fillStyle = color;
          ctx.fillRect(0, y, width, hh);
          y += hh;
        }
      }

      for (let i = marks.length - 1; i >= 0; i--) {
        const m = marks[i];
        const u = (now - m.t) / 1100;
        if (u >= 1) {
          marks.splice(i, 1);
          continue;
        }
        ctx.strokeStyle =
          m.kind === 1
            ? `rgba(226, 196, 138, ${0.5 * m.bright * (1 - u)})`
            : m.kind === 2
              ? `rgba(240, 236, 216, ${0.5 * m.bright * (1 - u)})`
              : `rgba(232, 206, 156, ${0.34 * m.bright * (1 - u)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(m.x * width, m.y * height, 6 + u * 46, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (cursorLit > 0.01) {
        ctx.strokeStyle = `rgba(238, 226, 200, ${0.4 * cursorLit})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cursorX * width, cursorY * height, 9 + kbCharge * 20, 0, Math.PI * 2);
        ctx.stroke();
      }

      // ——— the lens: the ledger itself, at fixed scale ———
      if (lens > 0.02) {
        ctx.globalAlpha = clamp01((lens - 0.02) / 0.98);
        const pad = 16;
        const barW = Math.min(width - pad * 2, 300);
        const barY = height - 96;
        const tint: Record<string, string> = {
          litter: "206, 176, 116",
          humus: "112, 76, 46",
          mineral: "186, 190, 196",
          mycelium: "228, 216, 186",
          root: "216, 186, 130",
        };
        let x = pad;
        for (const p of POOLS) {
          const w = barW * mix[p];
          ctx.fillStyle = `rgba(${tint[p]}, 0.72)`;
          ctx.fillRect(x, barY, Math.max(0, w - 1), 9);
          x += w;
        }
        ctx.font = "300 10px ui-monospace, 'SF Mono', Menlo, monospace";
        ctx.textAlign = "left";
        ctx.fillStyle = "rgba(230, 216, 190, 0.66)";
        const tim = timbreOfState(soil);
        let roots = 0;
        for (const o of orgs) if (o.kind === "root") roots++;
        ctx.fillText(POOLS.map((p) => `${p} ${(soil.pools[p] * 100).toFixed(0)}`).join("  "), pad, barY + 24);
        ctx.fillText(
          `rotted ${(decompositionOf(mix) * 100).toFixed(0)}%  ${tim.centroidHz.toFixed(0)}hz  ring ${tim.ringSec.toFixed(2)}s`,
          pad,
          barY + 38,
        );
        ctx.fillText(
          `${roots} roots  ${orgs.length - roots} fungi  ${islands} islands  knit ${(knit * 100).toFixed(0)}%`,
          pad,
          barY + 52,
        );
        ctx.fillText(
          `${SEASON_NAMES[((Math.round(season) % 4) + 4) % 4]}  ${(climate.warmth * 32 - 2).toFixed(0)}°  ` +
            (awayGrowth > 0.0005 ? `grew ${(awayGrowth * 100).toFixed(1)} while away` : "watched"),
          pad,
          barY + 66,
        );
        ctx.globalAlpha = 1;
      }

      // the season, named for a moment while the year is being turned
      if (seasonSaid > 0.01) {
        ctx.globalAlpha = clamp01(seasonSaid);
        ctx.font = "300 12px ui-monospace, 'SF Mono', Menlo, monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(228, 212, 178, 0.6)";
        ctx.fillText(SEASON_NAMES[((Math.round(season) % 4) + 4) % 4], width / 2, HORIZON * height * 0.62);
        ctx.globalAlpha = 1;
      }
    };
    raf = requestAnimationFrame(draw);

    const setReduced = (v: boolean) => {
      reduced = v;
    };
    reducedRef.current = setReduced;

    return () => {
      writer.flush();
      cancelAnimationFrame(raf);
      apiRef.current = null;
      reducedRef.current = null;
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      if (stage) {
        quad?.dispose();
        if (lineBuf) stage.gl.deleteBuffer(lineBuf);
        stage.dispose();
      }
    };
  }, []);

  return (
    <RoomShell
      route="/soil"
      voice={voiceRef.current}
      keyboard={keyboardRef.current}
      onGlimmer={() => apiRef.current?.glimmer()}
      onReducedMotion={(r) => reducedRef.current?.(r)}
      surfaceRef={wrapRef}
      letGo={{ label: "let the ground rest", onLetGo: () => apiRef.current?.clear(), visible: hasKept }}
    >
      <div
        ref={wrapRef}
        role="application"
        aria-label="a hand's width of ground, in section"
        style={{ position: "fixed", inset: 0, background: "#0a0806", touchAction: "none" }}
      >
        <canvas
          ref={glRef}
          aria-hidden
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
        />
        <canvas
          ref={overlayRef}
          aria-hidden
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
        />
      </div>
    </RoomShell>
  );
}
