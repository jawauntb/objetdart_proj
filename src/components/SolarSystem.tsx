"use client";

/**
 * SolarSystem — the system assembled.
 *
 * The invariant is a set of orbital elements (lib/orbits.ts); this room
 * renders it three ways at once and keeps every map invertible: the drawn
 * ellipses (a monotone power compression a press can run backward), the
 * chord (each body voiced at its orbital frequency lifted whole into the
 * audible, so the intervals ARE Kepler's third law), and the notation lens
 * (twist: pitch as height, phase as position, eccentricity as the stretched
 * note-head, inclination as the stem's lean).
 *
 * The heart: the planets genuinely orbit while nobody watches. The wall
 * clock is read ONCE at mount through the shared world bus
 * (readWorldClock), the whole absence is folded into sim-time in closed
 * form — one multiply, one add, then Kepler's linear mean anomaly — and the
 * render loop never touches Date.now. A week away lands every body where a
 * week puts it, in O(1).
 *
 * And they are not decorations on separate rails. While someone is watching,
 * the bodies pull on each other: the propagation is the Wisdom–Holman move —
 * exact Kepler DRIFT (the closed form the absence needs) alternating with a
 * KICK by the mutual accelerations. Orbits precess, pairs lock into small
 * whole-number resonances and answer each other, close passes capture,
 * touching bodies merge, and a body whose angular momentum is spent falls
 * into the sun. Gravity is allowed to make things and to take them away.
 *
 * Rendering is WebGL on the shared stage (lib/webgl/stage): one shader draws
 * the sky — procedural vault, milky band, zodiacal disc — and the sun as a
 * real star, limb-darkened, granulated, inside a striated corona; two
 * instanced programs draw every orbit, trail, tail and world in one call
 * each, out of typed arrays. The stage's lockstep 2D overlay carries only the
 * notation lens. One rAF, bounded loops, no per-frame gradients.
 *
 * The hand arrives through `RoomShell`, so every global verb is answered:
 * one finger works the material (voice a body, nudge its orbit, trace it
 * round, condense a world under a held fingertip, flick one out of the
 * system), three fingers hold the law (wind: the sun's mass and the epoch
 * rate; season: the year; hold: time dilates), two-finger twist raises the
 * notation lens, and the vessel leans the ecliptic.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import RoomShell from "@/components/RoomShell";
import { createGLStage, FULLSCREEN_VERT_CLIP } from "@/lib/webgl/stage";
import { clocksFrom } from "@/lib/webgl/sizing";
import { readWorldClock, stampWorldClock } from "@/lib/world";
import {
  A_MAX,
  A_MIN,
  E_MAX,
  MASS_MAX,
  MASS_MIN,
  MU_FACTOR_MAX,
  MU_FACTOR_MIN,
  MU_UNIT,
  RATE_EXP_MAX,
  RATE_EXP_MIN,
  TAU,
  circularSpeed,
  clamp,
  conjunctionPhases,
  crossedPeriapsis,
  displayRadiusFor,
  elapsedSim,
  firstCollision,
  freqForElements,
  hashSeed,
  kicked,
  massForHold,
  meanAnomalyAt,
  mergedBody,
  mulberry32,
  nudged,
  perturbed,
  phaseForContinuity,
  plantBody,
  positionAt,
  radiusOf,
  rateForExp,
  resonances,
  systemFromSeed,
  trueAnomalyOf,
  withComet,
  worldRadiusForDisplay,
  wrapAngle,
  type OrbitalElements,
  type Resonance,
} from "@/lib/orbits";

const SOLAR_SEED = 0x501a12;
const STORAGE_KEY = "objetdart:solar:v1";
const CLOCK_KEY = "solar";
const ORBIT_SAMPLES = 72;
const TRAIL_SEGMENTS = 20;
const TAIL_SEGMENTS = 8;
/** The kick cadence of the mixed-variable map, in real ms. */
const PERTURB_MS = 55;
/** Instance ceilings — the buffers are allocated once and never grow. */
const MAX_BODIES = 14;
const MAX_SEGMENTS = MAX_BODIES * (ORBIT_SAMPLES + TRAIL_SEGMENTS + TAIL_SEGMENTS + 24) + 240;

type SolarKeep = {
  v: 1;
  simS: number;
  muFactor: number;
  rateExp: number;
  bodies: OrbitalElements[];
  cleared?: boolean;
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** Shortest-arc angle interpolation, for phase glides. */
const lerpAngle = (a: number, b: number, t: number) => {
  let d = wrapAngle(b) - wrapAngle(a);
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return wrapAngle(a + d * t);
};

// ——— palette (the site tokens, as the shaders mix them) ———
type RGB = [number, number, number];
const PAPER: RGB = [242, 238, 230];
const SEA: RGB = [44, 74, 92];
const KEPT: RGB = [110, 90, 46];
const CANDLE: RGB = [200, 115, 42];
const AURORA: RGB = [124, 172, 150];
const mix3 = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const rgba = (c: RGB, a: number) =>
  `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;

/** A body's face: seeded blend of the tokens — never a random hue. */
function bodyColor(el: OrbitalElements): RGB {
  const rng = mulberry32(el.seed);
  if (el.kind === "comet") return mix3(PAPER, AURORA, 0.25 + rng() * 0.3);
  const pick = rng();
  if (pick < 0.3) return mix3(SEA, PAPER, 0.25 + rng() * 0.35);
  if (pick < 0.55) return mix3(KEPT, PAPER, 0.3 + rng() * 0.3);
  if (pick < 0.8) return mix3(CANDLE, PAPER, 0.15 + rng() * 0.35);
  return mix3(PAPER, SEA, 0.15 + rng() * 0.2);
}

function validBodies(raw: unknown): OrbitalElements[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: OrbitalElements[] = [];
  for (const b of raw) {
    if (!b || typeof b !== "object") return null;
    const e = b as Record<string, unknown>;
    if (
      typeof e.a !== "number" ||
      typeof e.e !== "number" ||
      typeof e.phase !== "number" ||
      typeof e.omega !== "number" ||
      typeof e.incl !== "number" ||
      typeof e.seed !== "number" ||
      (e.kind !== "planet" && e.kind !== "comet")
    ) {
      return null;
    }
    out.push({
      a: clamp(e.a, A_MIN, A_MAX),
      e: clamp(e.e, 0, E_MAX),
      incl: clamp(e.incl, -0.9, 0.9),
      omega: wrapAngle(e.omega),
      phase: wrapAngle(e.phase),
      seed: e.seed >>> 0,
      kind: e.kind,
      size: typeof e.size === "number" ? clamp(e.size, 0.1, 1) : 0.5,
      // Skies kept before the worlds had weight get the lightest weight.
      mass: typeof e.mass === "number" ? clamp(e.mass, MASS_MIN, MASS_MAX) : MASS_MIN,
    });
  }
  const capped = out.slice(0, MAX_BODIES);
  return capped.some((b) => b.kind === "planet") ? capped : null;
}

// ——— the shaders ————————————————————————————————————————————————

/** A hash-and-value-noise kit; deterministic, no textures, no assets. */
const GLSL_NOISE = `
float h21(vec2 p){
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
vec2 h22(vec2 p){ float n = h21(p); return vec2(n, h21(p + n + 19.19)); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = h21(i), b = h21(i + vec2(1.0, 0.0));
  float c = h21(i + vec2(0.0, 1.0)), d = h21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 7.1; a *= 0.5; }
  return s;
}
`;

/**
 * The sky and the star at the middle of it. The vault is three hashed
 * layers (few bright, many faint), the milky band one rotated fbm, the
 * zodiacal light the ecliptic disc unsquashed back to a circle, and the
 * sun a limb-darkened granulated disc inside a striated corona — a star,
 * not a soft blob pasted over the middle of the frame.
 */
const FRAG_SKY = `
precision highp float;
${GLSL_NOISE}
uniform vec2 uRes;
uniform float uRatio;
uniform float uTime;
uniform float uNight;
uniform float uLens;
uniform float uAgit;
uniform vec2 uSun;
uniform float uSunR;
uniform float uSunFlare;
uniform float uRot;
uniform float uSquash;
uniform float uViewR;
uniform float uStill;

const vec3 PAPER  = vec3(0.949, 0.933, 0.902);
const vec3 CANDLE = vec3(0.784, 0.451, 0.165);
const vec3 NIGHTC = vec3(0.024, 0.031, 0.047);

float starLayer(vec2 uv, float density, float sizeMul, out float warm){
  vec2 g = uv * density;
  vec2 id = floor(g);
  vec2 f = fract(g);
  vec2 r = h22(id);
  float d = length(f - r);
  float bright = h21(id + 7.77);
  warm = step(0.94, h21(id + 13.3));
  float mag = pow(bright, 5.0);
  float tw = uStill > 0.5 ? 1.0 : 0.72 + 0.28 * sin(uTime * (0.5 + bright * 2.3) + bright * 41.0);
  float core = smoothstep(0.06 * sizeMul * (0.35 + mag), 0.0, d);
  return core * mag * tw;
}

void main(){
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uRatio;
  vec2 res = uRes / uRatio;
  float m = min(res.x, res.y);
  float dim = 1.0 - uNight * 0.82;
  float veil = 1.0 - uLens * 0.7;

  vec3 col = NIGHTC;

  // the vault
  vec2 uv = px / m;
  float warm;
  float s1 = starLayer(uv, 26.0, 1.0, warm);
  col += mix(PAPER, CANDLE, warm * 0.8) * s1 * 0.85 * dim * (1.0 - uLens * 0.6);
  float w2;
  float s2 = starLayer(uv + 3.7, 52.0, 0.7, w2);
  col += mix(PAPER, CANDLE, w2 * 0.7) * s2 * 0.5 * dim * (1.0 - uLens * 0.6);
  float w3;
  float s3 = starLayer(uv + 11.3, 96.0, 0.5, w3);
  col += PAPER * s3 * 0.28 * dim * (1.0 - uLens * 0.6);

  // the milky band, leaning across the frame
  vec2 b = px - res * 0.5;
  float ca = cos(-0.5), sa = sin(-0.5);
  vec2 br = vec2(b.x * ca - b.y * sa, b.x * sa + b.y * ca);
  float band = exp(-pow(abs(br.y) / (m * 0.24), 2.0));
  float bmod = 0.45 + 0.75 * fbm(br * 0.012 + 4.0);
  col += PAPER * band * bmod * 0.045 * dim * (1.0 - uLens * 0.7);

  // the zodiacal disc: the plane the system remembers, seen edge-on
  vec2 q = px - uSun;
  float cr = cos(-uRot), sr = sin(-uRot);
  vec2 ecl = vec2(q.x * cr - q.y * sr, (q.x * sr + q.y * cr) / max(0.2, uSquash));
  float rr = length(ecl) / max(1.0, uViewR);
  float dust = (1.0 - smoothstep(0.0, 1.06, rr)) * (0.5 + 0.9 * fbm(ecl * 0.01 + 21.0));
  col += mix(CANDLE, PAPER, smoothstep(0.05, 0.8, rr)) *
         dust * (0.075 + uAgit * 0.06) * dim * (1.0 - uLens);

  // the star at the centre
  float d = length(q);
  float u = min(d / max(1.0, uSunR), 1.0);
  float lmb = sqrt(max(0.0, 1.0 - u * u));
  float gran = 0.82 + 0.3 * fbm(q * 0.5 + uTime * (uStill > 0.5 ? 0.0 : 0.05));
  float disc = 1.0 - smoothstep(uSunR * 0.94, uSunR * 1.04, d);
  vec3 face = mix(CANDLE, PAPER, 0.35 + 0.5 * lmb) * (0.62 + 0.5 * lmb) * gran;
  float outer = max(0.0, d - uSunR);
  float ang = atan(q.y, q.x);
  float stri = 0.7 + 0.5 * fbm(vec2(ang * 3.4, d * 0.03 - uTime * (uStill > 0.5 ? 0.0 : 0.04)));
  float corona = (exp(-outer / (uSunR * 1.5)) * 0.55 + exp(-outer / (uSunR * 6.5)) * 0.28) * stri;
  corona *= 1.0 + uSunFlare * 1.6;
  col += CANDLE * corona * (0.9 - uNight * 0.55) * veil;
  col = mix(col, face, disc * (0.95 - uNight * 0.5) * veil);

  // a quiet vignette holds the frame together
  float vig = smoothstep(m * 0.44, length(res) * 0.62, length(px - res * 0.5));
  col = mix(col, NIGHTC, vig * 0.4);

  gl_FragColor = vec4(col, 1.0);
}
`;

/** Instanced segments: every orbit ring, trail, tail and tie in one call. */
const VERT_SEG = `
attribute vec2 aCorner;
attribute vec4 aSeg;
attribute vec4 aCol;
attribute float aWidth;
uniform vec2 uRes;
uniform float uRatio;
varying vec4 vCol;
varying float vEdge;
void main(){
  vec2 p0 = aSeg.xy;
  vec2 p1 = aSeg.zw;
  vec2 dir = p1 - p0;
  float len = max(0.0001, length(dir));
  vec2 t = dir / len;
  vec2 n = vec2(-t.y, t.x);
  float w = max(aWidth, 1.7);
  vec2 pos = mix(p0, p1, aCorner.x * 0.5 + 0.5) + n * aCorner.y * w * 0.5;
  vec2 dev = pos * uRatio;
  gl_Position = vec4((dev / uRes) * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
  vCol = aCol;
  vEdge = aCorner.y;
}
`;

const FRAG_SEG = `
precision highp float;
varying vec4 vCol;
varying float vEdge;
void main(){
  float soft = 1.0 - smoothstep(0.3, 1.0, abs(vEdge));
  gl_FragColor = vec4(vCol.rgb * vCol.a * soft, 1.0);
}
`;

/** Instanced worlds: a lit sphere and its halo, shaded from the sun. */
const VERT_BODY = `
attribute vec2 aCorner;
attribute vec2 aPos;
attribute float aR;
attribute vec3 aCol;
attribute vec4 aMeta;
uniform vec2 uRes;
uniform float uRatio;
varying vec2 vLocal;
varying vec3 vCol;
varying vec4 vMeta;
void main(){
  vLocal = aCorner * 2.6;
  vCol = aCol;
  vMeta = aMeta;
  vec2 dev = (aPos + aCorner * aR * 2.6) * uRatio;
  gl_Position = vec4((dev / uRes) * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
}
`;

const FRAG_BODY = `
precision highp float;
varying vec2 vLocal;
varying vec3 vCol;
varying vec4 vMeta;   // x flare, y alpha, z lit.x, w lit.y
const vec3 PAPER = vec3(0.949, 0.933, 0.902);
void main(){
  float d = length(vLocal);
  vec3 c = mix(vCol, PAPER, 0.35) * exp(-d * 2.1) * vMeta.x * 0.9;
  if (d < 1.03) {
    float z = sqrt(max(0.0, 1.0 - min(d, 1.0) * min(d, 1.0)));
    vec3 n = normalize(vec3(vLocal, max(0.02, z)));
    vec3 L = normalize(vec3(vMeta.zw, 0.42));
    float lam = max(0.0, dot(n, L));
    vec3 day = mix(vCol * 0.5, mix(vCol, PAPER, 0.45), pow(lam, 0.8));
    vec3 surf = mix(vCol * 0.08, day, smoothstep(0.0, 0.24, lam));
    surf += PAPER * pow(1.0 - z, 3.0) * lam * 0.28;
    float edge = 1.0 - smoothstep(0.97, 1.03, d);
    c += surf * edge * vMeta.y;
  }
  gl_FragColor = vec4(c, 1.0);
}
`;


/** The imperative half of the room: the shell speaks to it through this. */
type Engine = {
  tap: (e: { intensity: number; x: number; y: number }) => void;
  stepBack: () => void;
  tutti: () => void;
  plant: (e: { x: number; y: number }) => void;
  deepen: (e: { elapsed: number; tier: number; x: number; y: number }) => void;
  settle: (e: { elapsed: number; tier: number; x: number; y: number }) => void;
  ceremony: () => void;
  timeScale: (k: number) => void;
  drag: (e: { phase: "start" | "move" | "end"; x: number; y: number; dx: number; dy: number }) => void;
  wind: (e: { dx: number; dy: number }) => void;
  flick: (e: { angle: number; speed: number; x: number; y: number }) => void;
  stir: (e: { angularVelocity: number; cx: number; cy: number }) => void;
  lens: (e: { angle: number }) => void;
  season: (e: { angle: number }) => void;
  drum: (e: { hits: number; alternation: number }) => void;
  rhythm: (e: { stability: number }) => void;
  scatter: (e: { intensity: number }) => void;
  gravity: (e: { beta: number; gamma: number }) => void;
  knock: () => void;
  night: (e: { faceDown: boolean }) => void;
  glimmer: () => void;
  reduced: (r: boolean) => void;
  step: (d: number) => void;
  wind_time: (d: number) => void;
  sound: () => void;
  escape: () => void;
  letGo: () => void;
};

export default function SolarSystem() {
  const glRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const [hasKept, setHasKept] = useState(false);
  const [lensUp, setLensUp] = useState(false);

  useEffect(() => {
    const glCanvas = glRef.current;
    const overlay = overlayRef.current;
    if (!glCanvas || !overlay) return;

    const audio = getFieldAudio();
    let reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ——— state: the small vector everything is a function of ———
    const seedSystem = systemFromSeed(SOLAR_SEED);
    let bodies: OrbitalElements[] = seedSystem.map((b) => ({ ...b }));
    let muFactor = 1;
    let rateExp = 0;
    let simS = 0;
    let cleared = false;

    // One read of the wall clock, through the shared world bus; the whole
    // absence becomes sim-time in closed form. Nothing replays.
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const clock = readWorldClock(CLOCK_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SolarKeep>;
        const kept = validBodies(parsed.bodies);
        if (kept) bodies = kept;
        if (typeof parsed.muFactor === "number") {
          muFactor = clamp(parsed.muFactor, MU_FACTOR_MIN, MU_FACTOR_MAX);
        }
        if (typeof parsed.rateExp === "number") {
          rateExp = clamp(parsed.rateExp, RATE_EXP_MIN, RATE_EXP_MAX);
        }
        cleared = parsed.cleared === true;
        const storedSim = typeof parsed.simS === "number" ? parsed.simS : 0;
        simS = elapsedSim(storedSim, clock.elapsedMs, rateForExp(rateExp));
      }
    } catch {
      /* a fresh sky */
    }

    let mu = MU_UNIT * muFactor;
    const freqOf = (el: OrbitalElements) => freqForElements(el.a, mu);

    const touched = () => {
      if (bodies.length !== seedSystem.length) return true;
      if (muFactor !== 1 || rateExp !== 0) return true;
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        const t = seedSystem[i];
        if (b.kind !== "planet") return true;
        if (
          Math.abs(b.a - t.a) > 1e-4 ||
          Math.abs(b.omega - t.omega) > 1e-4 ||
          Math.abs(b.e - t.e) > 1e-4 ||
          Math.abs(b.mass - t.mass) > 1e-9
        ) {
          return true;
        }
      }
      return false;
    };
    const save = () => {
      try {
        const keep: SolarKeep = { v: 1, simS, muFactor, rateExp, bodies, cleared };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keep));
        stampWorldClock(CLOCK_KEY);
      } catch {
        /* noop */
      }
      setHasKept(touched());
    };
    setHasKept(touched());

    // ——— the stage: one context, DPR sizing, and the lockstep overlay ———
    const stage = createGLStage(glCanvas, {
      label: "solar",
      overlay,
      reducedMotion: reduced,
      contextAttributes: { alpha: false, antialias: true, depth: false },
    });
    const ctx = stage?.overlay2d ?? overlay.getContext("2d");

    let width = stage?.size.width ?? 320;
    let height = stage?.size.height ?? 480;
    let viewR = Math.min(width, height) * 0.46;

    let viewRot = 0.35;
    let viewRotVel = 0;
    let squash = 0.72;
    let squashTarget = 0.72;
    let tiltRot = 0;
    let agitation = 0;
    let night = 0;
    let nightTarget = 0;
    let sunFlare = 0;
    let lens = 0;
    let lensTarget = 0;
    let lastLensAt = 0;
    let lastSeasonAt = 0;
    let seasonDirty = false;
    const setLens = (v: number) => {
      lensTarget = clamp01(v);
      setLensUp(lensTarget > 0.5);
    };
    let dilation = 1;
    let glimmerAt = 0;
    let glimmerOrbit = 0;

    const cx = () => width / 2;
    const cy = () => height * 0.5;

    /** World (x, y-with-incl, z) → screen, through rot + squash. */
    const toScreen = (x: number, y: number, z: number, sf: number) => {
      const rot = viewRot + tiltRot;
      const rx = x * Math.cos(rot) - y * Math.sin(rot);
      const ry = x * Math.sin(rot) + y * Math.cos(rot);
      return { sx: cx() + rx * sf, sy: cy() + (ry * squash - z * 0.38) * sf };
    };
    /** Screen → world polar (r, θ) at a given per-body scale factor. */
    const toWorldPolar = (sx: number, sy: number, sf: number) => {
      const ux = (sx - cx()) / sf;
      const uy = (sy - cy()) / sf / Math.max(0.2, squash);
      const rot = viewRot + tiltRot;
      const wx = ux * Math.cos(-rot) - uy * Math.sin(-rot);
      const wy = ux * Math.sin(-rot) + uy * Math.cos(-rot);
      return { r: Math.hypot(wx, wy), theta: wrapAngle(Math.atan2(wy, wx)) };
    };
    /** A screen direction, carried back into the ecliptic plane. */
    const toWorldVec = (dx: number, dy: number) => {
      const uy = dy / Math.max(0.2, squash);
      const rot = viewRot + tiltRot;
      return {
        x: dx * Math.cos(-rot) - uy * Math.sin(-rot),
        y: dx * Math.sin(-rot) + uy * Math.cos(-rot),
      };
    };
    const scaleFor = (el: OrbitalElements) => (viewR * displayRadiusFor(el.a)) / el.a;

    // ——— orbit path cache (typed arrays; rebuilt only when elements move) ———
    const orbitCache = new Map<number, Float32Array>();
    const orbitKey = new Map<number, string>();
    const orbitPath = (el: OrbitalElements): Float32Array => {
      const key = `${el.a.toFixed(4)}|${el.e.toFixed(4)}|${el.omega.toFixed(4)}|${el.incl.toFixed(4)}`;
      if (orbitKey.get(el.seed) === key) {
        const hit = orbitCache.get(el.seed);
        if (hit) return hit;
      }
      const arr = new Float32Array(ORBIT_SAMPLES * 3);
      for (let k = 0; k < ORBIT_SAMPLES; k++) {
        const E = (k / ORBIT_SAMPLES) * TAU;
        const r = el.a * (1 - el.e * Math.cos(E));
        const th = wrapAngle(trueAnomalyOf(E, el.e) + el.omega);
        arr[k * 3] = r * Math.cos(th);
        arr[k * 3 + 1] = r * Math.sin(th) * Math.cos(el.incl);
        arr[k * 3 + 2] = r * Math.sin(th) * Math.sin(el.incl);
      }
      orbitCache.set(el.seed, arr);
      orbitKey.set(el.seed, key);
      return arr;
    };

    // ——— the instance buffers: allocated once, never grown ———
    const CORNERS = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const segPos = new Float32Array(MAX_SEGMENTS * 4);
    const segCol = new Float32Array(MAX_SEGMENTS * 4);
    const segWidth = new Float32Array(MAX_SEGMENTS);
    let segCount = 0;
    const bodyPos = new Float32Array((MAX_BODIES + 2) * 2);
    const bodyRad = new Float32Array(MAX_BODIES + 2);
    const bodyCol = new Float32Array((MAX_BODIES + 2) * 3);
    const bodyMeta = new Float32Array((MAX_BODIES + 2) * 4);
    let bodyCount = 0;

    const pushSeg = (
      x0: number, y0: number, x1: number, y1: number, c: RGB, a: number, w: number,
    ) => {
      if (segCount >= MAX_SEGMENTS || a <= 0.002) return;
      const o = segCount * 4;
      segPos[o] = x0;
      segPos[o + 1] = y0;
      segPos[o + 2] = x1;
      segPos[o + 3] = y1;
      segCol[o] = c[0] / 255;
      segCol[o + 1] = c[1] / 255;
      segCol[o + 2] = c[2] / 255;
      segCol[o + 3] = a;
      segWidth[segCount] = w;
      segCount++;
    };
    const pushBody = (
      x: number, y: number, r: number, c: RGB, fl: number, alpha: number, lx: number, ly: number,
    ) => {
      if (bodyCount > MAX_BODIES) return;
      bodyPos[bodyCount * 2] = x;
      bodyPos[bodyCount * 2 + 1] = y;
      bodyRad[bodyCount] = r;
      bodyCol[bodyCount * 3] = c[0] / 255;
      bodyCol[bodyCount * 3 + 1] = c[1] / 255;
      bodyCol[bodyCount * 3 + 2] = c[2] / 255;
      bodyMeta[bodyCount * 4] = fl;
      bodyMeta[bodyCount * 4 + 1] = alpha;
      bodyMeta[bodyCount * 4 + 2] = lx;
      bodyMeta[bodyCount * 4 + 3] = ly;
      bodyCount++;
    };

    // ——— programs ———
    const skyProg = stage?.program(FULLSCREEN_VERT_CLIP, FRAG_SKY) ?? null;
    const segProg = stage?.program(VERT_SEG, FRAG_SEG) ?? null;
    const bodyProg = stage?.program(VERT_BODY, FRAG_BODY) ?? null;
    const skyQuad = stage && skyProg ? stage.fullscreenQuad(skyProg) : null;
    const segDraw = stage && segProg ? stage.instanced(segProg) : null;
    const bodyDraw = stage && bodyProg ? stage.instanced(bodyProg) : null;

    // ——— voices ———
    let lastRetuneAt = 0;
    const voice = (el: OrbitalElements | undefined, durSec = 1.8) => {
      if (!el) return;
      try {
        audio.playTone(freqOf(el), durSec);
      } catch {
        /* noop */
      }
    };

    // ——— per-body transient state ———
    let flare: number[] = bodies.map(() => 0);
    let prevM: number[] = bodies.map((b) => meanAnomalyAt(b, mu, simS));
    let selIdx = 0;
    // The chosen world's ring shows only while the choice is warm — a room
    // at rest wears no chrome.
    let selGlow = 0;
    const resync = () => {
      flare = bodies.map((_, i) => flare[i] ?? 0);
      prevM = bodies.map((b) => meanAnomalyAt(b, mu, simS));
      if (selIdx >= bodies.length) selIdx = Math.max(0, bodies.length - 1);
    };
    const select = (i: number) => {
      selIdx = clamp(i, 0, Math.max(0, bodies.length - 1));
      selGlow = 1;
    };
    const tutti = () => {
      for (let i = 0; i < bodies.length; i++) {
        voice(bodies[i], 2.4);
        flare[i] = Math.max(flare[i] ?? 0, 0.55);
      }
      sunFlare = Math.max(sunFlare, 0.5);
      try {
        haptics.ripple(0.4);
      } catch {
        /* noop */
      }
    };
    /** A body leaves the system, one way or the other. */
    const lose = (el: OrbitalElements | undefined, fate: "escaped" | "consumed") => {
      try {
        if (fate === "consumed") {
          sunFlare = Math.max(sunFlare, 1);
          audio.thud();
          haptics.roll();
        } else if (el) {
          audio.playTone(freqOf(el) * 0.5, 2.5);
          haptics.chop();
        }
      } catch {
        /* noop */
      }
    };

    // ——— acts in flight ———
    let conj: { t0: number; from: number[]; to: number[] } | null = null;
    let letGoAnim: { t0: number; from: OrbitalElements[]; fromMu: number; fromRate: number } | null =
      null;
    let holdInfo: {
      x: number; y: number; lastX: number; lastY: number;
      driftX: number; driftY: number; onBody: number; startAt: number;
      lastTickAt: number; ceremonyFired: boolean;
    } | null = null;
    let dragIdx = -1;
    let lastScrubAt = 0;
    let lastScrubTickAt = 0;
    let twistWound = 0;
    let lastLawToneAt = 0;
    let locks: Resonance[] = [];
    let lastLockScanAt = 0;
    let lastLockToneAt = 0;

    const bodyAtScreen = (sx: number, sy: number): number => {
      let best = -1;
      let bestD = 30;
      for (let i = 0; i < bodies.length; i++) {
        const p = positionAt(bodies[i], mu, simS);
        const s = toScreen(p.x, p.y, p.z, scaleFor(bodies[i]));
        const d = Math.hypot(s.sx - sx, s.sy - sy);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    };
    const orbitAtScreen = (sx: number, sy: number): number => {
      let best = -1;
      let bestD = 34;
      for (let i = 0; i < bodies.length; i++) {
        const sf = scaleFor(bodies[i]);
        const path = orbitPath(bodies[i]);
        for (let k = 0; k < ORBIT_SAMPLES; k += 3) {
          const s = toScreen(path[k * 3], path[k * 3 + 1], path[k * 3 + 2], sf);
          const d = Math.hypot(s.sx - sx, s.sy - sy);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
      return best;
    };

    const beginConjunction = (targetTheta: number) => {
      const r = rateForExp(rateExp) * dilation;
      conj = {
        t0: performance.now(),
        from: bodies.map((b) => b.phase),
        to: conjunctionPhases(bodies, mu, simS + 2 * Math.max(0.05, r), targetTheta),
      };
      try {
        haptics.bloom();
      } catch {
        /* noop */
      }
      // the chord arpeggiates open, inner voice first
      bodies.forEach((el, i) => {
        window.setTimeout(() => voice(el, 2.2), 160 * i);
        flare[i] = Math.max(flare[i] ?? 0, 0.5);
      });
      window.setTimeout(() => {
        try {
          audio.bell();
        } catch {
          /* noop */
        }
      }, 2000);
    };

    const setMu = (factor: number) => {
      const next = clamp(factor, MU_FACTOR_MIN, MU_FACTOR_MAX);
      if (next === muFactor) return;
      const muNew = MU_UNIT * next;
      bodies = bodies.map((el) => ({ ...el, phase: phaseForContinuity(el, mu, muNew, simS) }));
      muFactor = next;
      mu = muNew;
      resync();
    };

    /** Throw a body: a real kick, kept or let go by the energy it gains. */
    const throwBody = (i: number, dvx: number, dvy: number) => {
      const el = bodies[i];
      if (!el) return;
      const out = kicked(el, mu, simS, dvx, dvy);
      if (out.kind === "bound") {
        bodies = bodies.map((b, k) => (k === i ? out.el : b));
        flare[i] = Math.max(flare[i] ?? 0, 0.7);
        voice(out.el, 1.2);
        try {
          haptics.ripple(0.5);
        } catch {
          /* noop */
        }
      } else {
        bodies = bodies.filter((_, k) => k !== i);
        resync();
        lose(el, out.kind);
      }
      save();
    };

    // ——— the engine the shell speaks to ———
    engineRef.current = {
      tap: (e) => {
        const i = bodyAtScreen(e.x, e.y);
        if (i >= 0) {
          select(i);
          flare[i] = Math.max(flare[i] ?? 0, 0.35 + e.intensity * 0.45);
          voice(bodies[i], 1.4 + e.intensity);
          try {
            haptics.tap();
          } catch {
            /* noop */
          }
          return;
        }
        if (Math.hypot(e.x - cx(), e.y - cy()) < viewR * 0.14) {
          // the sun answers for itself
          sunFlare = Math.max(sunFlare, 0.7 + e.intensity * 0.4);
          try {
            audio.bell();
            haptics.ripple(0.4);
          } catch {
            /* noop */
          }
          return;
        }
        // open sky absorbs the touch: the dust stirs, one low grain
        agitation = Math.min(1, agitation + 0.08 * e.intensity);
        try {
          audio.playNote(26, 500);
          haptics.tap();
        } catch {
          /* noop */
        }
      },
      stepBack: () => {
        // ScaleTravel's verb; this room only lowers its lens
        if (lensTarget > 0.5) {
          setLens(0);
          try {
            haptics.lens();
            audio.playNote(40, 260);
          } catch {
            /* noop */
          }
        }
      },
      tutti,
      plant: (e) => {
        const onBody = bodyAtScreen(e.x, e.y);
        holdInfo = {
          x: e.x, y: e.y, lastX: e.x, lastY: e.y,
          driftX: 0, driftY: 0, onBody,
          startAt: performance.now(), lastTickAt: 0, ceremonyFired: false,
        };
        if (onBody >= 0) {
          select(onBody);
          voice(bodies[onBody], 0.8);
        } else {
          try {
            audio.spark();
            haptics.ripple(0.35);
          } catch {
            /* noop */
          }
        }
      },
      deepen: (e) => {
        if (!holdInfo) return;
        // the drift while held is the kick it will be let go with
        holdInfo.driftX = holdInfo.driftX * 0.86 + (e.x - holdInfo.lastX) * 0.14;
        holdInfo.driftY = holdInfo.driftY * 0.86 + (e.y - holdInfo.lastY) * 0.14;
        holdInfo.lastX = e.x;
        holdInfo.lastY = e.y;
        holdInfo.x = e.x;
        holdInfo.y = e.y;
        const now = performance.now();
        if (holdInfo.onBody >= 0) {
          // a held world keeps sounding, swelling toward the ceremony
          if (now - holdInfo.lastTickAt > 640) {
            holdInfo.lastTickAt = now;
            voice(bodies[holdInfo.onBody], 0.5 + e.elapsed / 2500);
            flare[holdInfo.onBody] = Math.max(flare[holdInfo.onBody] ?? 0, 0.3);
          }
        } else if (now - holdInfo.lastTickAt > 480) {
          // condensation ticking as the proto-world takes on weight
          holdInfo.lastTickAt = now;
          const m = massForHold(e.elapsed);
          try {
            audio.playNote(30 + 16 * (Math.log(m / MASS_MIN) / Math.log(MASS_MAX / MASS_MIN)), 120);
            haptics.tap();
          } catch {
            /* noop */
          }
        }
      },
      ceremony: () => {
        // the ceremony: the sky gathers behind the held world
        const el = bodies[holdInfo && holdInfo.onBody >= 0 ? holdInfo.onBody : selIdx];
        if (holdInfo) holdInfo.ceremonyFired = true;
        if (!el) return;
        beginConjunction(positionAt(el, mu, simS).angle);
        save();
      },
      settle: (e) => {
        const info = holdInfo;
        holdInfo = null;
        if (!info || info.onBody >= 0 || info.ceremonyFired || e.tier < 1) return;
        // a world condenses exactly under the lifted finger, moving the way
        // the finger was moving
        const w = toWorldPolar(info.x, info.y, 1);
        const rWorld = worldRadiusForDisplay(clamp01(w.r / viewR));
        const dv = toWorldVec(info.driftX, info.driftY);
        const ct = Math.cos(w.theta);
        const st = Math.sin(w.theta);
        const k = 0.06;
        const out = plantBody(
          hashSeed(Math.round(info.x), Math.round(info.y), bodies.length, SOLAR_SEED),
          rWorld,
          w.theta,
          e.elapsed,
          { vr: (dv.x * ct + dv.y * st) * k, vt: (-dv.x * st + dv.y * ct) * k },
          mu,
          simS,
        );
        if (out.kind === "bound") {
          bodies = withComet(bodies, out.el).slice(0, MAX_BODIES);
          resync();
          const at = bodies.indexOf(out.el);
          if (at >= 0) {
            select(at);
            flare[at] = 1;
          }
          voice(out.el, 2);
          try {
            audio.spark();
            haptics.bloom();
          } catch {
            /* noop */
          }
        } else {
          // the hand asked for an orbit the sun will not hold
          lose(undefined, out.kind);
        }
        save();
      },
      timeScale: (k) => {
        dilation = Math.max(0.03, k);
      },
      drag: (e) => {
        if (e.phase === "start") {
          dragIdx = bodyAtScreen(e.x, e.y);
          if (dragIdx >= 0) select(dragIdx);
          return;
        }
        if (e.phase === "end") {
          if (dragIdx >= 0) {
            try {
              audio.chime();
            } catch {
              /* noop */
            }
            save();
          }
          dragIdx = -1;
          return;
        }
        if (dragIdx >= 0 && dragIdx < bodies.length) {
          // the nudge: the orbit follows the hand, the voice follows Kepler
          const p = positionAt(bodies[dragIdx], mu, simS);
          const w = toWorldPolar(e.x, e.y, scaleFor(bodies[dragIdx]));
          bodies = bodies.map((b, i) => (i === dragIdx ? nudged(b, mu, simS, p.r, w.r, w.theta) : b));
          const now = performance.now();
          if (now - lastRetuneAt > 140) {
            lastRetuneAt = now;
            voice(bodies[dragIdx], 0.22);
            try {
              haptics.tap();
            } catch {
              /* noop */
            }
          }
          flare[dragIdx] = Math.max(flare[dragIdx] ?? 0, 0.3);
          return;
        }
        // open sky: the frame's pitch and yaw belong to the finger too
        if (!reduced) {
          viewRotVel += e.dx * 0.00004;
          squashTarget = clamp(squashTarget - e.dy * 0.0012, 0.5, 0.94);
        }
      },
      wind: (e) => {
        // the law dragged: across weighs the sun, down slows the epoch
        setMu(muFactor * Math.exp(e.dx * 0.0015));
        rateExp = clamp(rateExp - e.dy * 0.004, RATE_EXP_MIN, RATE_EXP_MAX);
        const now = performance.now();
        if (now - lastLawToneAt > 240) {
          lastLawToneAt = now;
          try {
            const outer = bodies[bodies.length - 1];
            if (outer) audio.playTone(freqOf(outer), 0.3);
            haptics.tap();
          } catch {
            /* noop */
          }
        }
        seasonDirty = true;
        lastSeasonAt = now;
      },
      flick: (e) => {
        const i = bodyAtScreen(e.x, e.y);
        if (i >= 0) {
          // a world thrown; hard enough and it leaves for good
          const vc = circularSpeed(bodies[i].a, mu);
          const mag = clamp(e.speed / 2.4, 0, 1.5) * vc;
          const dv = toWorldVec(Math.cos(e.angle) * mag, Math.sin(e.angle) * mag);
          throwBody(i, dv.x, dv.y);
          return;
        }
        if (reduced) return;
        viewRotVel += Math.cos(e.angle) * (e.speed / 30000);
        try {
          haptics.ripple(0.25);
        } catch {
          /* noop */
        }
      },
      stir: (e) => {
        const now = performance.now();
        if (now - lastScrubAt > 600) {
          // a fresh circling: choose the orbit under the hand
          const i = orbitAtScreen(e.cx, e.cy);
          if (i >= 0) select(i);
        }
        lastScrubAt = now;
        const i = selIdx;
        if (i < 0 || i >= bodies.length) return;
        // tracing the orbit carries its body along it
        const dPhase = clamp(e.angularVelocity, -9, 9) * 0.045;
        bodies = bodies.map((b, k) => (k === i ? { ...b, phase: wrapAngle(b.phase + dPhase) } : b));
        flare[i] = Math.max(flare[i] ?? 0, 0.35);
        if (now - lastScrubTickAt > 200) {
          lastScrubTickAt = now;
          try {
            audio.playTone(freqOf(bodies[i]), 0.14);
            haptics.tap();
          } catch {
            /* noop */
          }
        }
      },
      lens: (e) => {
        // two fingers raise the lens: the elements written as notation
        setLens(lensTarget + e.angle / 1.6);
        lastLensAt = performance.now();
      },
      season: (e) => {
        // three fingers wind the season: the sky sweeps through its year
        simS += e.angle * 260;
        resync();
        twistWound += Math.abs(e.angle);
        if (twistWound > 0.5) {
          twistWound = 0;
          try {
            audio.playNote(36, 90);
            haptics.detent();
          } catch {
            /* noop */
          }
        }
        seasonDirty = true;
        lastSeasonAt = performance.now();
      },
      drum: (e) => {
        // patter on the plane: the dust answers between the two hands
        agitation = Math.min(1, agitation + 0.12 + e.alternation * 0.2);
        try {
          audio.playNote(28 + (e.hits % 5) * 2, 110);
          haptics.tap();
        } catch {
          /* noop */
        }
      },
      rhythm: (e) => {
        if (e.stability > 0.72) tutti();
      },
      scatter: (e) => {
        agitation = Math.min(1, agitation + 0.4 + e.intensity * 0.5);
        // shaking the vessel stirs the dust AND jostles the wanderers
        const jolt = 0.006 * (0.5 + e.intensity);
        bodies = bodies.map((el) => {
          if (el.kind !== "comet") return el;
          const v = circularSpeed(el.a, mu) * jolt;
          const r = kicked(el, mu, simS, v * Math.cos(el.omega), v * Math.sin(el.omega));
          return r.kind === "bound" ? r.el : el;
        });
        try {
          haptics.chop();
        } catch {
          /* noop */
        }
      },
      gravity: ({ beta, gamma }) => {
        // the plane hangs from the world's real gravity — a pose, not an
        // animation, so stillness keeps it
        squashTarget = clamp(0.72 - ((beta - 45) / 90) * 0.3, 0.5, 0.94);
        tiltRot = clamp(gamma / 140, -0.35, 0.35);
      },
      knock: () => {
        // a knock on the case is a knock on the sun's door
        sunFlare = Math.max(sunFlare, 0.9);
        for (let i = 0; i < flare.length; i++) flare[i] = Math.max(flare[i], 0.25);
        try {
          audio.thud();
          haptics.roll();
        } catch {
          /* noop */
        }
      },
      night: ({ faceDown }) => {
        nightTarget = faceDown ? 1 : 0;
      },
      glimmer: () => {
        if (lens > 0.5 || !bodies.length) return;
        glimmerAt = performance.now();
        glimmerOrbit = Math.floor((glimmerAt / 9000) % bodies.length);
      },
      reduced: (r) => {
        reduced = r;
      },
      step: (d) => {
        if (!bodies.length) return;
        select((selIdx + d + bodies.length) % bodies.length);
        flare[selIdx] = Math.max(flare[selIdx] ?? 0, 0.4);
        voice(bodies[selIdx], 1);
      },
      wind_time: (d) => {
        simS += d * 30;
        resync();
      },
      sound: () => {
        flare[selIdx] = Math.max(flare[selIdx] ?? 0, 0.5);
        voice(bodies[selIdx], 1.6);
      },
      escape: () => {
        if (lensTarget > 0) {
          setLens(0);
          try {
            haptics.lens();
          } catch {
            /* noop */
          }
        }
        nightTarget = 0;
      },
      letGo: () => {
        if (letGoAnim) return;
        letGoAnim = {
          t0: performance.now(),
          from: bodies.map((b) => ({ ...b })),
          fromMu: muFactor,
          fromRate: rateExp,
        };
        try {
          audio.thud();
          haptics.roll();
        } catch {
          /* noop */
        }
      },
    };

    // The keyboard's throw — the one act the shell's dialect has no key for.
    const onThrowKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Backspace" && ev.key !== "Delete") return;
      const target = ev.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      ev.preventDefault();
      const el = bodies[selIdx];
      if (!el || bodies.length <= 1) return;
      const vc = circularSpeed(el.a, mu);
      const p = positionAt(el, mu, simS);
      throwBody(selIdx, -vc * 0.55 * Math.sin(p.angle), vc * 0.55 * Math.cos(p.angle));
    };
    window.addEventListener("keydown", onThrowKey);

    // ——— persistence cadence: leaving stamps the clock ———
    const onHide = () => save();
    window.addEventListener("pagehide", onHide);
    const onVis = () => {
      if (document.visibilityState === "hidden") save();
    };
    document.addEventListener("visibilitychange", onVis);
    const saveTimer = window.setInterval(save, 12000);

    // ——— the frame ———
    let raf = 0;
    let lastT = performance.now();
    let perturbAcc = 0;
    let lastPerturbAt = performance.now();
    const draw = () => {
      const now = performance.now();
      const dt = clamp(now - lastT, 0, 100);
      lastT = now;

      // DRIFT: sim-time advances at the epoch rate, dilated while held
      const rate = rateForExp(rateExp) * dilation;
      simS += (dt / 1000) * rate;
      perturbAcc += (dt / 1000) * rate;

      // KICK: the mutual pull, on its own cadence. Never during an act that
      // is already rewriting phases by hand.
      if (now - lastPerturbAt >= PERTURB_MS && !conj && !letGoAnim && bodies.length > 1) {
        lastPerturbAt = now;
        const stepS = perturbAcc;
        perturbAcc = 0;
        if (stepS > 0) {
          const before = bodies;
          const res = perturbed(bodies, mu, simS, stepS);
          bodies = res.bodies;
          for (const ev of res.lost) lose(before[ev.index], ev.fate);
          if (res.lost.length) {
            resync();
            save();
          }
          // and what touches, merges
          const hit = firstCollision(bodies, mu, simS);
          if (hit) {
            const merged = mergedBody(bodies[hit[0]], bodies[hit[1]], mu, simS);
            const keep = bodies.filter((_, i) => i !== hit[0] && i !== hit[1]);
            bodies = merged.kind === "bound" ? [...keep, merged.el] : keep;
            resync();
            if (bodies.length) {
              select(bodies.length - 1);
              flare[bodies.length - 1] = 1;
            }
            sunFlare = Math.max(sunFlare, 0.45);
            try {
              audio.bell();
              haptics.bloom();
            } catch {
              /* noop */
            }
            if (merged.kind === "bound") voice(merged.el, 2.2);
            save();
          }
        }
        // the locks the system has found, re-read a few times a second
        if (now - lastLockScanAt > 900) {
          lastLockScanAt = now;
          locks = resonances(bodies, mu);
        }
      }

      const audioT = audio.getAudioTime() ?? now / 1000;
      const breath = reduced ? 0.5 : Math.sin(audioT * TAU * 0.14) * 0.5 + 0.5;
      // The stage resizes, sets the viewport and hands back this frame's size
      // BEFORE anything is laid out, so instances are never a frame stale.
      const size = stage?.beginFrame(
        clocksFrom({ time: audioT, turbulence: agitation, reducedMotion: reduced }),
      );
      if (size) {
        width = size.width;
        height = size.height;
        viewR = Math.min(width, height) * 0.46;
      }
      agitation *= 0.975;
      sunFlare *= 0.96;
      selGlow *= 0.994;
      squash += (squashTarget - squash) * 0.06;
      viewRot += viewRotVel;
      viewRotVel *= 0.94;
      night += (nightTarget - night) * 0.05;
      lens += (lensTarget - lens) * (reduced ? 0.3 : 0.12);

      // a twist that has stopped snaps the lens open or shut, and a wound
      // season commits itself — the hand let go, so the room settles
      if (lastLensAt && now - lastLensAt > 220) {
        lastLensAt = 0;
        const up = lensTarget > 0.5;
        if (lensTarget !== (up ? 1 : 0)) {
          setLens(up ? 1 : 0);
          try {
            haptics.lens();
            if (up) audio.chime();
          } catch {
            /* noop */
          }
        }
      }
      if (seasonDirty && now - lastSeasonAt > 400) {
        seasonDirty = false;
        save();
      }

      // acts in flight
      if (conj) {
        const t = clamp01((now - conj.t0) / 2000);
        const k = easeInOut(t);
        bodies = bodies.map((b, i) =>
          conj && i < conj.from.length
            ? { ...b, phase: lerpAngle(conj.from[i], conj.to[i], k) }
            : b,
        );
        if (t >= 1) {
          conj = null;
          resync();
          save();
        }
      }
      if (letGoAnim) {
        const t = clamp01((now - letGoAnim.t0) / 1900);
        const k = easeInOut(t);
        muFactor = lerp(letGoAnim.fromMu, 1, k);
        mu = MU_UNIT * muFactor;
        rateExp = lerp(letGoAnim.fromRate, 0, k);
        bodies = letGoAnim.from
          .map((b, i) => {
            if (b.kind === "comet") return { ...b, size: b.size * (1 - k) };
            const t2 = seedSystem[Math.min(i, seedSystem.length - 1)];
            return {
              ...b,
              a: lerp(b.a, t2.a, k),
              e: lerp(b.e, t2.e, k),
              incl: lerp(b.incl, t2.incl, k),
              mass: lerp(b.mass, t2.mass, k),
              omega: lerpAngle(b.omega, t2.omega, k),
              phase: lerpAngle(b.phase, t2.phase, k),
            };
          })
          .filter((b) => b.kind === "planet" || b.size > 0.02);
        if (t >= 1) {
          bodies = seedSystem.map((b) => ({ ...b }));
          muFactor = 1;
          rateExp = 0;
          cleared = true;
          letGoAnim = null;
          selIdx = 0;
          locks = [];
          resync();
          save();
        }
      }

      // ——— build this frame's instances ———
      segCount = 0;
      bodyCount = 0;
      const dim = 1 - night * 0.82;
      const orbitAlpha = (1 - lens * 0.85) * dim;
      const sunR = viewR * 0.052 * (0.75 + 0.5 * muFactor) + breath * 1.6 + sunFlare * 6;

      // the proto-world under a held finger: the orbit it would take
      if (holdInfo && holdInfo.onBody < 0) {
        const heldMs = now - holdInfo.startAt;
        const wpol = toWorldPolar(holdInfo.x, holdInfo.y, 1);
        const rWorld = worldRadiusForDisplay(clamp01(wpol.r / viewR));
        const dv = toWorldVec(holdInfo.driftX, holdInfo.driftY);
        const ct = Math.cos(wpol.theta);
        const st = Math.sin(wpol.theta);
        const proto = plantBody(
          1, rWorld, wpol.theta, heldMs,
          { vr: (dv.x * ct + dv.y * st) * 0.06, vt: (-dv.x * st + dv.y * ct) * 0.06 },
          mu, simS,
        );
        if (proto.kind === "bound") {
          const sf = scaleFor(proto.el);
          const path = orbitPath({ ...proto.el, seed: 0x9e0 });
          for (let k = 0; k < ORBIT_SAMPLES; k += 2) {
            const i3 = k * 3;
            const j3 = ((k + 2) % ORBIT_SAMPLES) * 3;
            const s0 = toScreen(path[i3], path[i3 + 1], path[i3 + 2], sf);
            const s1 = toScreen(path[j3], path[j3 + 1], path[j3 + 2], sf);
            pushSeg(s0.sx, s0.sy, s1.sx, s1.sy, AURORA, 0.26 * orbitAlpha, 1.1);
          }
        }
        pushBody(
          holdInfo.x, holdInfo.y,
          Math.min(11, 3 + radiusOf(massForHold(heldMs)) * 90),
          AURORA, 0.7, 0.85 * dim, 0, 0,
        );
      }

      // resonance ties: the locked pairs are drawn as one thin chord
      for (const lk of locks) {
        if (lk.i >= bodies.length || lk.j >= bodies.length) continue;
        const pa = positionAt(bodies[lk.i], mu, simS);
        const pb = positionAt(bodies[lk.j], mu, simS);
        const sa = toScreen(pa.x, pa.y, pa.z, scaleFor(bodies[lk.i]));
        const sb = toScreen(pb.x, pb.y, pb.z, scaleFor(bodies[lk.j]));
        pushSeg(sa.sx, sa.sy, sb.sx, sb.sy, AURORA, 0.1 * (1 - lk.detune / 0.015) * orbitAlpha, 0.8);
      }

      // orbits, trails, bodies
      for (let i = 0; i < bodies.length; i++) {
        const el = bodies[i];
        const sf = scaleFor(el);
        const path = orbitPath(el);
        const col = bodyColor(el);
        const p = positionAt(el, mu, simS);

        // periapsis rings: the orbit states itself once a period (silent
        // while a glide or a grip is rewriting phases by hand)
        const m = p.M;
        if (crossedPeriapsis(prevM[i] ?? m, m) && !letGoAnim && !conj && i !== dragIdx) {
          flare[i] = Math.max(flare[i] ?? 0, 0.8);
          voice(el, 1.4);
          const lk = locks.find((l) => l.i === i || l.j === i);
          if (lk && now - lastLockToneAt > 700) {
            // a locked pair answers its partner in the same breath
            lastLockToneAt = now;
            voice(bodies[lk.i === i ? lk.j : lk.i], 1.1);
          }
        }
        prevM[i] = m;

        if (orbitAlpha > 0.01) {
          const glim =
            glimmerAt && glimmerOrbit === i && now - glimmerAt < 1800
              ? 0.16 * (1 - (now - glimmerAt) / 1800)
              : 0;
          const ringA =
            (0.075 + (i === selIdx ? 0.09 * selGlow : 0) + (flare[i] ?? 0) * 0.12 + glim) * orbitAlpha;
          for (let k = 0; k < ORBIT_SAMPLES; k++) {
            const i3 = k * 3;
            const j3 = ((k + 1) % ORBIT_SAMPLES) * 3;
            const s0 = toScreen(path[i3], path[i3 + 1], path[i3 + 2], sf);
            const s1 = toScreen(path[j3], path[j3 + 1], path[j3 + 2], sf);
            pushSeg(s0.sx, s0.sy, s1.sx, s1.sy, PAPER, ringA, 1);
          }

          // the trail: where the body just was, fading — motion made legible
          if (!reduced) {
            const kNow = Math.floor((p.E / TAU) * ORBIT_SAMPLES);
            for (let back = 1; back <= TRAIL_SEGMENTS; back++) {
              const kA = (((kNow - back) % ORBIT_SAMPLES) + ORBIT_SAMPLES) % ORBIT_SAMPLES;
              const kB = (((kNow - back + 1) % ORBIT_SAMPLES) + ORBIT_SAMPLES) % ORBIT_SAMPLES;
              const sA = toScreen(path[kA * 3], path[kA * 3 + 1], path[kA * 3 + 2], sf);
              const sB = toScreen(path[kB * 3], path[kB * 3 + 1], path[kB * 3 + 2], sf);
              const u = 1 - back / TRAIL_SEGMENTS;
              pushSeg(sA.sx, sA.sy, sB.sx, sB.sy, col, u * u * 0.4 * orbitAlpha, 0.8 + u * 1.8);
            }
          }
        }

        // the body itself
        const s = toScreen(p.x, p.y, p.z, sf);
        const baseR =
          (el.kind === "comet" ? 1.6 : 2.4) + el.size * 3.4 + radiusOf(el.mass) * 34 +
          breath * 0.7 + (flare[i] ?? 0) * 2.5;

        if (el.kind === "comet" && orbitAlpha > 0.01) {
          // the tail leans away from the sun, longer the closer it swings
          const ux = s.sx - cx();
          const uy = s.sy - cy();
          const un = Math.max(1, Math.hypot(ux, uy));
          const tail = (viewR * 0.1) / Math.max(0.45, p.r) + agitation * 10;
          for (let k = 0; k < TAIL_SEGMENTS; k++) {
            const t0 = k / TAIL_SEGMENTS;
            const t1 = (k + 1) / TAIL_SEGMENTS;
            pushSeg(
              s.sx + (ux / un) * tail * t0, s.sy + (uy / un) * tail * t0,
              s.sx + (ux / un) * tail * t1, s.sy + (uy / un) * tail * t1,
              AURORA, (1 - t0) * 0.4 * orbitAlpha, (2 + el.size * 2) * (1 - t0 * 0.5),
            );
          }
        }

        if (orbitAlpha > 0.01) {
          const dxs = cx() - s.sx;
          const dys = cy() - s.sy;
          const dn = Math.max(1, Math.hypot(dxs, dys));
          pushBody(
            s.sx, s.sy, baseR, col, flare[i] ?? 0,
            (0.95 - night * 0.5) * (1 - lens * 0.7), dxs / dn, dys / dn,
          );
          if (i === selIdx && selGlow > 0.02) {
            // the chosen one wears a thin ring while the choice is warm
            const rr = baseR + 4;
            for (let k = 0; k < 24; k++) {
              const a0 = (k / 24) * TAU;
              const a1 = ((k + 1) / 24) * TAU;
              pushSeg(
                s.sx + Math.cos(a0) * rr, s.sy + Math.sin(a0) * rr,
                s.sx + Math.cos(a1) * rr, s.sy + Math.sin(a1) * rr,
                PAPER, 0.35 * selGlow * orbitAlpha, 1,
              );
            }
          }
        }
        flare[i] = (flare[i] ?? 0) * 0.955;
      }

      // ——— paint ———
      if (stage && size && skyProg && segProg && bodyProg && skyQuad && segDraw && bodyDraw) {
        const gl = stage.gl;

        gl.disable(gl.BLEND);
        skyProg.use();
        skyProg.setVec2("uRes", size.pixelWidth, size.pixelHeight);
        skyProg.setFloat("uRatio", size.pixelWidth / Math.max(1, size.width));
        skyProg.setFloat("uTime", audioT);
        skyProg.setFloat("uNight", night);
        skyProg.setFloat("uLens", lens);
        skyProg.setFloat("uAgit", agitation);
        skyProg.setVec2("uSun", cx(), cy());
        skyProg.setFloat("uSunR", sunR);
        skyProg.setFloat("uSunFlare", sunFlare);
        skyProg.setFloat("uRot", viewRot + tiltRot);
        skyProg.setFloat("uSquash", squash);
        skyProg.setFloat("uViewR", viewR);
        skyProg.setFloat("uStill", reduced ? 1 : 0);
        skyQuad.draw();

        // everything above the sky is emissive: additive, order-free
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);

        const ratio = size.pixelWidth / Math.max(1, size.width);
        segProg.use();
        segProg.setVec2("uRes", size.pixelWidth, size.pixelHeight);
        segProg.setFloat("uRatio", ratio);
        segDraw.attribute("aCorner", CORNERS, 2, 0);
        segDraw.attribute("aSeg", segPos.subarray(0, segCount * 4), 4, 1);
        segDraw.attribute("aCol", segCol.subarray(0, segCount * 4), 4, 1);
        segDraw.attribute("aWidth", segWidth.subarray(0, segCount), 1, 1);
        segDraw.draw(gl.TRIANGLE_STRIP, 4, segCount);
        segDraw.reset();

        bodyProg.use();
        bodyProg.setVec2("uRes", size.pixelWidth, size.pixelHeight);
        bodyProg.setFloat("uRatio", ratio);
        bodyDraw.attribute("aCorner", CORNERS, 2, 0);
        bodyDraw.attribute("aPos", bodyPos.subarray(0, bodyCount * 2), 2, 1);
        bodyDraw.attribute("aR", bodyRad.subarray(0, bodyCount), 1, 1);
        bodyDraw.attribute("aCol", bodyCol.subarray(0, bodyCount * 3), 3, 1);
        bodyDraw.attribute("aMeta", bodyMeta.subarray(0, bodyCount * 4), 4, 1);
        bodyDraw.draw(gl.TRIANGLE_STRIP, 4, bodyCount);
        bodyDraw.reset();
      }

      // ——— the overlay: the notation lens, and nothing else ———
      if (ctx) {
        ctx.clearRect(0, 0, width, height);
        if (lens > 0.01) {
          const la = lens * dim;
          const left = width * 0.12;
          const right = width * 0.88;
          const top = height * 0.2;
          const bottom = height * 0.82;
          // octave rules: the staff is log-frequency, honest to the map
          const fMin = freqForElements(A_MAX, MU_UNIT * MU_FACTOR_MIN);
          const fMax = freqForElements(A_MIN, MU_UNIT * MU_FACTOR_MAX);
          const yFor = (f: number) =>
            bottom - (Math.log(f / fMin) / Math.log(fMax / fMin)) * (bottom - top);
          ctx.lineWidth = 1;
          for (let f = 55; f <= fMax; f *= 2) {
            const y = yFor(f);
            ctx.strokeStyle = rgba(PAPER, 0.08 * la);
            ctx.beginPath();
            ctx.moveTo(left, y);
            ctx.lineTo(right, y);
            ctx.stroke();
          }
          for (let i = 0; i < bodies.length; i++) {
            const el = bodies[i];
            const col = bodyColor(el);
            const y = yFor(freqOf(el));
            ctx.strokeStyle = rgba(col, (i === selIdx ? 0.4 : 0.22) * la);
            ctx.beginPath();
            ctx.moveTo(left, y);
            ctx.lineTo(right, y);
            ctx.stroke();
            // the note-head: x is phase, stretch is eccentricity, lean is incl
            const M = meanAnomalyAt(el, mu, simS);
            const x = left + (M / TAU) * (right - left);
            const rr = 3 + el.size * 3 + radiusOf(el.mass) * 26 + (flare[i] ?? 0) * 2;
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(el.incl);
            ctx.scale(1 + el.e * 1.8, 1);
            ctx.fillStyle = rgba(col, (el.kind === "comet" ? 0.5 : 0.85) * la);
            ctx.beginPath();
            ctx.arc(0, 0, rr, 0, TAU);
            if (el.kind === "comet") {
              ctx.strokeStyle = rgba(col, 0.8 * la);
              ctx.stroke();
            } else {
              ctx.fill();
            }
            ctx.restore();
            // the stem, leaning with the plane
            ctx.strokeStyle = rgba(col, 0.3 * la);
            ctx.beginPath();
            ctx.moveTo(x, y - rr);
            ctx.lineTo(x + Math.sin(el.incl * 2.5) * 12, y - rr - 12);
            ctx.stroke();
          }
          // the ties: a locked pair is written as a slur between its lines
          for (const lk of locks) {
            if (lk.i >= bodies.length || lk.j >= bodies.length) continue;
            const ya = yFor(freqOf(bodies[lk.i]));
            const yb = yFor(freqOf(bodies[lk.j]));
            ctx.strokeStyle = rgba(AURORA, 0.3 * la);
            ctx.beginPath();
            ctx.moveTo(right - 26, ya);
            ctx.quadraticCurveTo(right - 8, (ya + yb) / 2, right - 26, yb);
            ctx.stroke();
          }
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onThrowKey);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(saveTimer);
      save();
      engineRef.current = null;
      skyQuad?.dispose();
      segDraw?.dispose();
      bodyDraw?.dispose();
      stage?.dispose();
    };
  }, []);

  const on = useCallback(<K extends keyof Engine>(k: K) => {
    return ((arg: never) => {
      const fn = engineRef.current?.[k] as ((a: never) => void) | undefined;
      fn?.(arg);
    }) as Engine[K];
  }, []);

  return (
    <RoomShell
      route="/solar"
      surfaceRef={overlayRef as React.RefObject<HTMLElement | null>}
      style={{ position: "fixed", inset: 0, background: "#06080c", overflow: "hidden" }}
      voice={{
        tap: on("tap"),
        stepBack: on("stepBack"),
        tutti: on("tutti"),
        plant: on("plant"),
        deepen: on("deepen"),
        settle: on("settle"),
        ceremony: on("ceremony"),
        timeScale: on("timeScale"),
        drag: on("drag"),
        wind: on("wind"),
        flick: on("flick"),
        stir: on("stir"),
        lens: on("lens"),
        season: on("season"),
        drum: on("drum"),
        rhythm: on("rhythm"),
        scatter: on("scatter"),
        gravity: on("gravity"),
        knock: on("knock"),
        night: on("night"),
      }}
      keyboard={{
        enter: () => engineRef.current?.sound(),
        enterHeld: (elapsed) => {
          if (elapsed >= 900) engineRef.current?.ceremony();
        },
        escape: () => engineRef.current?.escape(),
        arrow: (dx, dy) => {
          if (dy) engineRef.current?.step(dy > 0 ? -1 : 1);
          if (dx) engineRef.current?.wind_time(dx);
        },
      }}
      onGlimmer={() => engineRef.current?.glimmer()}
      onReducedMotion={(r) => engineRef.current?.reduced(r)}
      letGo={{
        label: "let the first courses return",
        onLetGo: () => engineRef.current?.letGo(),
        visible: hasKept,
      }}
    >
      <div data-lens-raised={lensUp ? "1" : undefined} style={{ position: "absolute", inset: 0 }}>
        <canvas
          ref={glRef}
          aria-hidden
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        />
        <canvas
          ref={overlayRef}
          role="application"
          aria-label="a small solar system, kept in real time"
          tabIndex={0}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        />
      </div>
    </RoomShell>
  );
}
