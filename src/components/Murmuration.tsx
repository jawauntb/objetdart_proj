"use client";

/**
 * /birds — the flock as one animal. The birds band at ~10¹·³ m, between the
 * garden below and the shore above (docs/plans/life-and-vista-bands.md §2).
 *
 * The invariant is a boid parameter triple — separation, alignment, cohesion —
 * plus the wind (src/lib/flock.ts). The sky's shape is a deterministic
 * function of it, integrated on a FIXED timestep so the same second is the
 * same flock at 60 Hz and at 120 Hz.
 *
 * The load-bearing map is the flock's order parameter → the harmonic series.
 * A scattered sky rings a flat, stretched stack of partials — chatter; a
 * murmuration collapses onto one ringing partial, exactly k× the fundamental.
 * The ear knows the order before the eye resolves it, and the map runs
 * backwards: the interval between the first two partials IS the order
 * (`orderFromPartials`, pinned in scripts/test-flock.mjs).
 *
 * The vessel steers the wind. Tilt and the whole flock banks into it; shake
 * and it bursts and re-gathers; knock and one wave of wingbeats crosses the
 * sky. One finger reaches into the air — a stroke scatters, a held finger
 * gathers, and held long enough the flock settles onto the hand as one animal.
 * A circling hand turns the murmuration about its own axis. Two fingers turn
 * the observer, and the sun swings with the head. Three fingers are the
 * world-law: drag is the wind for a device that cannot be tilted, a twist
 * turns the season and with it where the flock is going, a hold slows the
 * clock, a tap is the tutti.
 *
 * Several thousand birds as GPU point sprites — one context, one POINTS draw,
 * per-bird wing phase in the vertex shader, typed arrays uploaded once per
 * frame. No p5, no animation library, one rAF (plan §3).
 *
 * The flock's character persists in `objetdart:birds:v1` with the quiet clear
 * at the bottom. Pinch is unbound — ScaleTravel owns it.
 */

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { onVessel } from "@/lib/vessel";
import { stirTurbulence } from "@/lib/turbulence";
import { spectralRegisterFor } from "@/lib/scale";
import {
  createFrameGovernor,
  detailForTier,
  isEmbeddedFrame,
  onGalleryPause,
  onVisibility,
  resolveDpr,
  type QualityTier,
} from "@/lib/room-runtime";
import LetGo from "@/components/LetGo";
import {
  MIN_SPEED,
  PARTIALS,
  SEASONS,
  WORLD_X,
  WORLD_Y,
  WORLD_Z,
  advanceFlock,
  callInterval,
  centroid,
  flockSize,
  flushNear,
  launchNearest,
  orderParameter,
  partialFreq,
  partialsForOrder,
  roostNearest,
  seasonGoal,
  seasonIndex,
  seedFlock,
  windFromTilt,
  type FlockParams,
} from "@/lib/flock";

const STORE_KEY = "objetdart:birds:v1";
/** Centre of the birds band, in log10 metres — where the room sounds from. */
const BAND_S = 1.35;
/** The wild flock, before any hand has taught it anything. */
const WILD = { sep: 1, ali: 1.3, coh: 1.6 };
const SEASON_PULL = 1.6;
const WIND_MAX = 5;
const CAM_DIST = 78;
const SKY_SEED = 0xb1d5;
/** However tight the frame, there is still a flock up there. */
const MIN_DRAWN = 500;

type Character = { sep: number; ali: number; coh: number };
type Stored = Character & { season: number; yaw: number; cleared?: boolean };

/** Four dusk skies — a murmuration is an evening thing. */
const SEASON_SKY: { low: number[]; high: number[]; sun: number[] }[] = [
  { low: [0.42, 0.45, 0.39], high: [0.07, 0.11, 0.19], sun: [0.95, 0.80, 0.56] },
  { low: [0.62, 0.46, 0.29], high: [0.09, 0.13, 0.23], sun: [1.0, 0.82, 0.50] },
  { low: [0.58, 0.29, 0.21], high: [0.07, 0.06, 0.13], sun: [1.0, 0.57, 0.31] },
  { low: [0.34, 0.38, 0.46], high: [0.05, 0.07, 0.14], sun: [0.82, 0.88, 0.98] },
];

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

const SKY_VERT = `
attribute vec2 a_pos;
varying vec2 vUv;
void main() { vUv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const SKY_FRAG = `
precision mediump float;
varying vec2 vUv;
uniform vec3 u_low;
uniform vec3 u_high;
uniform vec3 u_ground;
uniform vec3 u_sunTint;
uniform vec3 u_sun;     // x, y in uv; z = visibility
uniform float u_aspect;
uniform float u_roll;
uniform float u_horizon;
uniform float u_breath;
uniform float u_time;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

void main() {
  vec2 c = vUv - 0.5;
  float cs = cos(u_roll), sn = sin(u_roll);
  float y = (c.x * sn + c.y * cs) + 0.5;
  float x = (c.x * cs - c.y * sn) + 0.5;
  // the real horizon, where the camera's own level lands on the screen
  float a = y - u_horizon;
  vec3 col = a >= 0.0
    ? mix(u_low, u_high, smoothstep(0.0, 0.48, a))
    : mix(u_low, u_ground, smoothstep(0.0, 0.34, -a));
  col += u_sunTint * 0.08 * exp(-abs(a) * 14.0);
  vec2 d2 = (vUv - u_sun.xy) * vec2(u_aspect, 1.0);
  float d = length(d2);
  col += u_sunTint * exp(-d * d * 26.0) * (0.34 + u_breath * 0.09) * u_sun.z;
  col += u_sunTint * smoothstep(0.026, 0.012, d) * 0.5 * u_sun.z;

  // —— clouds above the horizon ——
  if (a > 0.02) {
    float clouds = noise(vec2(x * u_aspect * 2.2 + u_time * 0.02, y * 3.0));
    float cm = smoothstep(0.55, 0.78, clouds) * smoothstep(0.02, 0.22, a) * (1.0 - smoothstep(0.4, 0.55, a));
    col = mix(col, mix(vec3(0.92, 0.90, 0.86), u_sunTint, 0.15), cm * 0.55);
  }

  // —— meadow under the horizon: grass, pond, tree, hay, fruit ——
  if (a < 0.0) {
    float g = -a;
    // grass texture
    float blades = step(0.72, noise(vec2(x * 40.0 * u_aspect, g * 28.0)));
    col += vec3(0.04, 0.06, 0.02) * blades * smoothstep(0.0, 0.2, g);

    // pond (right meadow)
    vec2 pondC = vec2(0.72, u_horizon - 0.10);
    vec2 pq = (vec2(x, y) - pondC) * vec2(u_aspect * 1.2, 1.9);
    float pd = length(pq);
    float pond = 1.0 - smoothstep(0.085, 0.105, pd);
    float shore = smoothstep(0.085, 0.105, pd) * (1.0 - smoothstep(0.105, 0.125, pd));
    float ripple = noise(vec2(x * 14.0 + u_time * 0.15, y * 22.0));
    vec3 water = mix(vec3(0.12, 0.28, 0.34), vec3(0.30, 0.48, 0.46), 0.3 + ripple * 0.4);
    col = mix(col, vec3(0.42, 0.36, 0.24), shore);
    col = mix(col, water, pond);

    // hay pile (far right)
    vec2 hayC = vec2(0.88, u_horizon - 0.16);
    float hay = 1.0 - smoothstep(0.055, 0.075, length((vec2(x, y) - hayC) * vec2(u_aspect * 1.5, 2.4)));
    col = mix(col, mix(vec3(0.62, 0.48, 0.22), vec3(0.80, 0.64, 0.30), noise(vec2(x * 50.0, y * 40.0))), hay);

    // tree (left) — trunk + canopy + fruit
    float trunkX = 0.22;
    float trunk = (1.0 - smoothstep(0.008, 0.016, abs((x - trunkX) * u_aspect)))
      * smoothstep(u_horizon - 0.22, u_horizon - 0.18, y)
      * (1.0 - smoothstep(u_horizon - 0.02, u_horizon + 0.01, y));
    col = mix(col, vec3(0.22, 0.14, 0.08), trunk);
    float canopy = 0.0;
    canopy = max(canopy, 1.0 - smoothstep(0.09, 0.11, length((vec2(x, y) - vec2(0.22, u_horizon + 0.02)) * vec2(u_aspect, 1.0))));
    canopy = max(canopy, 1.0 - smoothstep(0.07, 0.09, length((vec2(x, y) - vec2(0.17, u_horizon + 0.05)) * vec2(u_aspect, 1.0))));
    canopy = max(canopy, 1.0 - smoothstep(0.07, 0.09, length((vec2(x, y) - vec2(0.27, u_horizon + 0.04)) * vec2(u_aspect, 1.0))));
    vec3 leaf = mix(vec3(0.10, 0.26, 0.12), vec3(0.22, 0.40, 0.16), noise(vec2(x * 18.0, y * 16.0)));
    col = mix(col, leaf, canopy * 0.92);
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      vec2 fc = vec2(0.16 + fi * 0.022, u_horizon - 0.01 + hash21(vec2(fi, 3.0)) * 0.06);
      float fruit = (1.0 - smoothstep(0.008, 0.014, length((vec2(x, y) - fc) * vec2(u_aspect, 1.0)))) * canopy;
      col = mix(col, mix(vec3(0.72, 0.18, 0.12), vec3(0.86, 0.52, 0.16), hash21(vec2(fi, 8.0))), fruit);
    }
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

const BIRD_VERT = `
attribute vec3 a_pos;
attribute vec3 a_vel;
attribute vec2 a_bird;
attribute vec3 a_tint;
uniform mat3 u_view;
uniform float u_camDist;
uniform float u_focalX;
uniform float u_focalY;
uniform float u_time;
uniform float u_wingHz;
uniform float u_reduced;
uniform float u_pointScale;
uniform float u_pulseT;
varying float vWing;
varying float vFade;
varying float vDepth;
varying vec2 vDir;
varying vec3 vTint;
void main() {
  vec3 p = u_view * a_pos;
  float z = max(p.z + u_camDist, 1.0);
  vec2 s1 = vec2(p.x * u_focalX / z, p.y * u_focalY / z);
  gl_Position = vec4(s1, 0.0, 1.0);

  // the heading, projected: a bird's wings lie across the way it is going
  vec3 q = u_view * (a_pos + a_vel * 0.03);
  float z2 = max(q.z + u_camDist, 1.0);
  vec2 dir = vec2(q.x * u_focalX / z2, q.y * u_focalY / z2) - s1;
  float L = length(dir);
  vDir = L > 1e-6 ? dir / L : vec2(0.0, 1.0);

  float sp = length(a_vel);
  float ph = u_time * u_wingHz * (0.75 + sp * 0.035) + a_bird.x * 6.2831853;
  // a pulse crossing the sky: every wing answers as the wave reaches it
  float pw = u_pulseT - (a_pos.x + ${WORLD_X.toFixed(1)}) / ${(WORLD_X * 2).toFixed(1)} * 0.42;
  float pulse = (pw > 0.0 && pw < 0.6) ? sin(pw * 11.0) * exp(-pw * 5.0) : 0.0;
  vWing = clamp(mix(0.5 + 0.5 * sin(ph), 0.6, u_reduced) + pulse * 0.55, 0.0, 1.2);
  gl_PointSize = clamp(u_pointScale * a_bird.y / z, 2.0, 52.0);
  vDepth = z;
  vFade = clamp(1.0 - (z - u_camDist) / 110.0, 0.22, 1.0);
  vTint = a_tint;
}
`;

const BIRD_FRAG = `
precision mediump float;
varying float vWing;
varying float vFade;
varying float vDepth;
varying vec2 vDir;
varying vec3 vTint;
uniform vec3 u_ink;
uniform vec3 u_low;
uniform vec3 u_high;
uniform vec3 u_ground;
uniform vec2 u_res;
uniform float u_horizon;
uniform float u_haze;
// its own name, not the vertex stage's u_camDist: a uniform shared across
// stages must agree on precision, and highp is not promised to fragments.
uniform float u_hazeFrom;
void main() {
  vec2 g = gl_PointCoord * 2.0 - 1.0;
  g.y = -g.y;
  // turn the silhouette so the head leads and the wings sweep back
  vec2 q = vec2(g.x * vDir.y - g.y * vDir.x, g.x * vDir.x + g.y * vDir.y);
  float w = mix(0.35, 1.25, clamp(vWing, 0.0, 1.0));
  float d = abs(q.y + w * (abs(q.x) - 0.18)) - 0.06;
  float wings = smoothstep(0.24, 0.02, d) * smoothstep(1.0, 0.84, abs(q.x));
  float body = smoothstep(0.34, 0.02, length(q * vec2(1.7, 2.4)));
  float a = max(wings, body);
  if (a < 0.02) discard;
  // species tint on the near birds; far birds haze into the dusk ink
  vec3 ink = mix(u_ink, vTint, 0.72);
  float hb = clamp(gl_FragCoord.y / u_res.y, 0.0, 1.0) - u_horizon;
  vec3 back = hb >= 0.0
    ? mix(u_low, u_high, smoothstep(0.0, 0.48, hb))
    : mix(u_low, u_ground, smoothstep(0.0, 0.34, -hb));
  float haze = clamp((vDepth - u_hazeFrom) / 130.0, 0.0, 1.0) * u_haze;
  gl_FragColor = vec4(mix(ink, back, haze), a * vFade);
}
`;

export default function Murmuration() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasKept, setHasKept] = useState(false);
  const [noGl, setNoGl] = useState(false);
  const letGoRef = useRef<() => void>(() => {});

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const gl = (canvas.getContext("webgl", {
      antialias: false,
      alpha: false,
      premultipliedAlpha: false,
      powerPreference: "low-power",
    }) ||
      canvas.getContext("experimental-webgl" as "webgl")) as WebGLRenderingContext | null;
    if (!gl) {
      setNoGl(true);
      return;
    }

    const audio = getFieldAudio();
    const register = spectralRegisterFor(BAND_S);
    // The shared room runtime: one governor for the frame, one tier for the
    // resolution and the population, and no flock flying in a hidden tab.
    const embedded = isEmbeddedFrame();
    const gov = createFrameGovernor(embedded ? "medium" : "high");
    let paused = false;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = mq.matches;
    const onMq = () => {
      reduced = mq.matches;
    };
    mq.addEventListener?.("change", onMq);

    // ——— the kept character ———
    let cleared = false;
    let char: Character = { ...WILD };
    let season = 0;
    let yaw = 0;
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Stored;
        cleared = p.cleared === true;
        if (!cleared) {
          char = {
            sep: clamp(Number(p.sep) || WILD.sep, 0.15, 2),
            ali: clamp(Number(p.ali) || WILD.ali, 0.15, 2),
            coh: clamp(Number(p.coh) || WILD.coh, 0.15, 2),
          };
          season = seasonIndex(Number(p.season) || 0);
          yaw = Number(p.yaw) || 0;
          setHasKept(true);
        }
      }
    } catch {
      /* a wild flock */
    }

    let saveAt = 0;
    const save = (now: number, force = false) => {
      if (!force && now - saveAt < 700) return;
      saveAt = now;
      cleared = false;
      try {
        const payload: Stored = { ...char, season, yaw, cleared: false };
        window.localStorage.setItem(STORE_KEY, JSON.stringify(payload));
      } catch {
        /* noop */
      }
      setHasKept(true);
    };

    // ——— the sky ———
    let width = 0;
    let height = 0;
    let rectLeft = 0;
    let rectTop = 0;
    let aspect = 1;
    let focalX = 1.9;
    const focalY = 1.9;
    let pointScale = 1;

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type);
      if (!s) return null;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        gl.deleteShader(s);
        return null;
      }
      return s;
    };
    const link = (vsrc: string, fsrc: string) => {
      const vs = compile(gl.VERTEX_SHADER, vsrc);
      const fs = compile(gl.FRAGMENT_SHADER, fsrc);
      if (!vs || !fs) return null;
      const prog = gl.createProgram();
      if (!prog) return null;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
      return prog;
    };

    const skyProg = link(SKY_VERT, SKY_FRAG);
    const birdProg = link(BIRD_VERT, BIRD_FRAG);
    if (!skyProg || !birdProg) {
      setNoGl(true);
      return;
    }

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const uSky = {
      pos: gl.getAttribLocation(skyProg, "a_pos"),
      low: gl.getUniformLocation(skyProg, "u_low"),
      high: gl.getUniformLocation(skyProg, "u_high"),
      ground: gl.getUniformLocation(skyProg, "u_ground"),
      sunTint: gl.getUniformLocation(skyProg, "u_sunTint"),
      sun: gl.getUniformLocation(skyProg, "u_sun"),
      aspect: gl.getUniformLocation(skyProg, "u_aspect"),
      roll: gl.getUniformLocation(skyProg, "u_roll"),
      horizon: gl.getUniformLocation(skyProg, "u_horizon"),
      breath: gl.getUniformLocation(skyProg, "u_breath"),
      time: gl.getUniformLocation(skyProg, "u_time"),
    };
    const uBird = {
      pos: gl.getAttribLocation(birdProg, "a_pos"),
      vel: gl.getAttribLocation(birdProg, "a_vel"),
      bird: gl.getAttribLocation(birdProg, "a_bird"),
      tint: gl.getAttribLocation(birdProg, "a_tint"),
      view: gl.getUniformLocation(birdProg, "u_view"),
      camDist: gl.getUniformLocation(birdProg, "u_camDist"),
      focalX: gl.getUniformLocation(birdProg, "u_focalX"),
      focalY: gl.getUniformLocation(birdProg, "u_focalY"),
      time: gl.getUniformLocation(birdProg, "u_time"),
      wingHz: gl.getUniformLocation(birdProg, "u_wingHz"),
      reduced: gl.getUniformLocation(birdProg, "u_reduced"),
      pointScale: gl.getUniformLocation(birdProg, "u_pointScale"),
      pulseT: gl.getUniformLocation(birdProg, "u_pulseT"),
      ink: gl.getUniformLocation(birdProg, "u_ink"),
      low: gl.getUniformLocation(birdProg, "u_low"),
      high: gl.getUniformLocation(birdProg, "u_high"),
      ground: gl.getUniformLocation(birdProg, "u_ground"),
      horizon: gl.getUniformLocation(birdProg, "u_horizon"),
      res: gl.getUniformLocation(birdProg, "u_res"),
      haze: gl.getUniformLocation(birdProg, "u_haze"),
      hazeFrom: gl.getUniformLocation(birdProg, "u_hazeFrom"),
    };

    // ——— the flock ———
    // The population the screen can carry — measured, capped, and thinned
    // further below if the frame will not hold it.
    const startRect = wrap.getBoundingClientRect();
    const wanted = Math.round(
      ((startRect.width * startRect.height) / 300) * detailForTier(gov.tier()).particles,
    );
    const state = seedFlock(SKY_SEED, flockSize(Math.min(2600, wanted)));
    let drawn = state.n;

    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, state.pos, gl.DYNAMIC_DRAW);
    const velBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, velBuf);
    gl.bufferData(gl.ARRAY_BUFFER, state.vel, gl.DYNAMIC_DRAW);
    const birdBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, birdBuf);
    gl.bufferData(gl.ARRAY_BUFFER, state.bird, gl.STATIC_DRAW);
    const tintBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, tintBuf);
    gl.bufferData(gl.ARRAY_BUFFER, state.tint, gl.STATIC_DRAW);

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const ratio = resolveDpr(gov.tier(), { embedded, reducedMotion: reduced });
      width = Math.max(240, r.width);
      height = Math.max(320, r.height);
      rectLeft = r.left;
      rectTop = r.top;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      gl.viewport(0, 0, canvas.width, canvas.height);
      aspect = width / height;
      // portrait narrows the view rather than squeezing the sky flat
      focalX = focalY / Math.max(aspect, 0.62);
      // a wingspan, in pixels, at the depth the flock sits
      pointScale = 0.85 * focalY * (canvas.height / 2);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    // ——— the room's live state ———
    let raf = 0;
    let last = performance.now();
    let visualT = 0;
    let timeScale = 1;
    let timeScaleTarget = 1;
    let pitch = -0.06;
    let pitchTarget = -0.06;
    let yawVel = 0;
    let lastCardinal = Math.round(yaw / (Math.PI / 2));
    let roll = 0;
    let rollTarget = 0;
    const wind = { x: 0, y: 0, z: 0 };
    const tiltWind = { x: 0, y: 0, z: 0 };
    const handWind = { x: 0, y: 0, z: 0 };
    const lure = { x: 0, y: 0, z: 0 };
    let lurePull = 0;
    let lurePullTarget = 0;
    let swirl = 0;
    let scatter = 0;
    let gather = 0;
    let wingHz = 7.2;
    let wingHzTarget = 7.2;
    let order = 0;
    let seasonBlend = season;
    let pulseT = -1;
    let lastCallAt = 0;
    let lastInteractionAt = performance.now();
    let glimmerAt = 0;
    let kbCharge = 0;
    let energy = 0; // reduced-motion budget: the sky moves when a hand asks
    let leaving = 0;
    let thinnedAt = 0;
    const startedAt = performance.now();
    let uploaded = false;
    const low = [...SEASON_SKY[seasonIndex(season)].low];
    const high = [...SEASON_SKY[seasonIndex(season)].high];
    const sunTint = [...SEASON_SKY[seasonIndex(season)].sun];

    const viewM = new Float32Array(9);
    const setView = () => {
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      // column-major Rx(pitch)·Ry(yaw)
      viewM[0] = cy;
      viewM[1] = sp * sy;
      viewM[2] = -cp * sy;
      viewM[3] = 0;
      viewM[4] = cp;
      viewM[5] = sp;
      viewM[6] = sy;
      viewM[7] = -sp * cy;
      viewM[8] = cp * cy;
    };

    /** A point on the screen, read back onto the plane the flock sits in. */
    const screenToWorld = (cx: number, cy: number) => {
      const nx = ((cx - rectLeft) / Math.max(1, width)) * 2 - 1;
      const ny = 1 - ((cy - rectTop) / Math.max(1, height)) * 2;
      const vx = (nx * CAM_DIST) / focalX;
      const vy = (ny * CAM_DIST) / focalY;
      const cyw = Math.cos(yaw);
      const syw = Math.sin(yaw);
      const cpw = Math.cos(pitch);
      const spw = Math.sin(pitch);
      return {
        x: clamp(cyw * vx + spw * syw * vy, -WORLD_X, WORLD_X),
        y: clamp(cpw * vy, -WORLD_Y, WORLD_Y),
        z: clamp(syw * vx - spw * cyw * vy, -WORLD_Z, WORLD_Z),
      };
    };

    /**
     * Where the sun stands, projected through the same camera as the birds —
     * so turning the observer swings it across the sky and off the edge, and
     * the season carries it round the year.
     */
    const sunScreen = () => {
      const az = (seasonBlend / SEASONS) * Math.PI * 2 + 0.7;
      const alt = -0.05 - 0.02 * Math.cos((seasonBlend / SEASONS) * Math.PI * 2);
      const r = 900;
      const d = {
        x: Math.sin(az) * Math.cos(alt) * r,
        y: Math.sin(alt) * r,
        z: Math.cos(az) * Math.cos(alt) * r,
      };
      const px = viewM[0] * d.x + viewM[3] * d.y + viewM[6] * d.z;
      const py = viewM[1] * d.x + viewM[4] * d.y + viewM[7] * d.z;
      const pz = viewM[2] * d.x + viewM[5] * d.y + viewM[8] * d.z + CAM_DIST;
      if (pz < 40) return { x: 0.5, y: -2, v: 0 };
      return {
        x: ((px * focalX) / pz) * 0.5 + 0.5,
        y: ((py * focalY) / pz) * 0.5 + 0.5,
        v: clamp01((pz - 40) / 260),
      };
    };

    /** Where the camera's own level falls on the screen. */
    const horizonUv = () => clamp(0.5 - Math.sin(pitch) * focalY * 0.5, -0.4, 1.4);

    // ——— sound: the order, heard ———
    /**
     * The flock's call. The partial stack IS the order parameter: one long
     * ringing fundamental when the sky is one animal, a spray of stretched,
     * staggered partials when it is not. Nothing here is decorative — the
     * interval between the first two partials reads the order straight back.
     */
    const call = (gain = 1) => {
      const amps = partialsForOrder(order);
      let sounded = 0;
      for (let k = 0; k < PARTIALS && sounded < 4; k++) {
        const a = amps[k];
        if (a < 0.22) continue;
        sounded += 1;
        const hz = partialFreq(register.baseHz, k + 1, order);
        const dur = (0.1 + a * 0.62) * gain;
        const stagger = k * 46 * (1 - order);
        if (stagger < 1) audio.playTone(hz, dur);
        else window.setTimeout(() => audio.playTone(hz, dur), stagger);
      }
    };

    /** One wave of wingbeats crossing the sky, west to east. */
    const pulse = () => {
      pulseT = 0;
    };

    const startle = (p: { x: number; y: number; z: number }, strength: number) => {
      lure.x = p.x;
      lure.y = p.y;
      lure.z = p.z;
      lurePull = -strength;
      lurePullTarget = 0;
    };

    // ——— the grammar ———
    // On the canvas, not the wrapper (RoomTemplate §3): the engine takes
    // pointer capture on whatever it is mounted to, and a wrapper that owns
    // the capture eats the quiet clear's own click.
    const detach = attachGestures(
      canvas,
      {
        tap: (e) => {
          lastInteractionAt = performance.now();
          energy = 1.4;
          if (e.fingers === 2) return; // ScaleTravel's step back
          if (e.fingers === 3) {
            // tutti: the whole sky answers at once
            pulse();
            call(1.5);
            stirTurbulence(0.08);
            try {
              haptics.ripple(0.45);
            } catch {
              /* noop */
            }
            return;
          }
          if (e.fingers !== 1) return;
          // one finger in the air: the birds nearest it break away —
          // residents flush into flight, the murmuration startles.
          const at = screenToWorld(e.x, e.y);
          flushNear(state, at, 10 + e.intensity * 8);
          startle(at, 26 + e.intensity * 60);
          call(0.7 + e.intensity * 0.5);
          try {
            haptics.tap();
          } catch {
            /* noop */
          }
        },
        hold: (e) => {
          lastInteractionAt = performance.now();
          energy = 1.4;
          if (e.fingers === 3) {
            if (e.phase === "enter") {
              timeScaleTarget = 0.25;
              try {
                audio.playTone(register.baseHz / 4, 0.7);
                haptics.tap();
              } catch {
                /* noop */
              }
            }
            if (e.phase === "release") timeScaleTarget = 1;
            return;
          }
          if (e.fingers !== 1) return;
          if (e.phase === "release") {
            lurePullTarget = 0;
            gather = 0;
            return;
          }
          const p = screenToWorld(e.x, e.y);
          lure.x = p.x;
          lure.y = p.y;
          lure.z = p.z;
          // A dwell on the meadow roosts the nearest bird; the longer hold
          // still gathers the murmuration onto the hand.
          if (e.phase === "enter" && e.tier >= 1) {
            roostNearest(state, p);
            try {
              haptics.ripple(0.4);
            } catch {
              /* noop */
            }
          }
          // Duration is an axis: the longer the hand waits, the harder the
          // flock comes in, and past the ceremony it settles onto the hand.
          gather = clamp01(e.elapsed / 2500);
          lurePullTarget = 4 + gather * 26;
          if (e.tier >= 3 && gather >= 1 && e.phase === "tick") {
            char.ali = clamp(char.ali + 0.006, 0.15, 2);
            char.coh = clamp(char.coh + 0.006, 0.15, 2);
            save(performance.now());
            if (order > 0.86 && performance.now() - lastCallAt > 500) {
              lastCallAt = performance.now();
              call(1.6);
              try {
                haptics.bloom();
              } catch {
                /* noop */
              }
            }
          }
        },
        drag: (e) => {
          lastInteractionAt = performance.now();
          energy = 1.4;
          if (e.fingers === 3) {
            // the world-law, for a hand with no gyroscope: the wind itself
            handWind.x = clamp(handWind.x + e.dx * 0.02, -WIND_MAX, WIND_MAX);
            handWind.z = clamp(handWind.z + e.dy * 0.02, -WIND_MAX, WIND_MAX);
            return;
          }
          if (e.fingers !== 1) return;
          if (e.phase === "end") {
            lurePullTarget = 0;
            return;
          }
          // a hand drawn through the flock pushes it aside
          const p = screenToWorld(e.x, e.y);
          lure.x = p.x;
          lure.y = p.y;
          lure.z = p.z;
          const speed = Math.min(1, Math.hypot(e.vx, e.vy) / 1.4);
          lurePull = -(6 + speed * 26);
          lurePullTarget = 0;
        },
        flick: (e) => {
          lastInteractionAt = performance.now();
          energy = 1.4;
          const g = Math.min(1, e.speed / 3.5) * WIND_MAX;
          handWind.x = clamp(handWind.x + Math.cos(e.angle) * g, -WIND_MAX, WIND_MAX);
          handWind.z = clamp(handWind.z + Math.sin(e.angle) * g, -WIND_MAX, WIND_MAX);
          // A flick also launches the nearest bird into a swoop / flight.
          if (e.fingers === 1) {
            const at = screenToWorld(e.x, e.y);
            launchNearest(
              state,
              at,
              { x: Math.cos(e.angle) * 2, y: 0.6, z: Math.sin(e.angle) * 2 },
              MIN_SPEED + e.speed * 3,
            );
          }
          try {
            haptics.ripple(0.3);
          } catch {
            /* noop */
          }
        },
        twist: (e) => {
          lastInteractionAt = performance.now();
          energy = 1.4;
          if (e.fingers === 3) {
            // the world-law: the season, and with it where the flock is going
            if (e.phase === "move") {
              seasonBlend += e.angle / 1.4;
              const s = seasonIndex(Math.round(seasonBlend));
              if (s !== season) {
                season = s;
                try {
                  audio.chime();
                  haptics.detent();
                } catch {
                  /* noop */
                }
                save(performance.now(), true);
              }
            }
            if (e.phase === "end") seasonBlend = season;
            return;
          }
          // two fingers turn the observer — the sun swings with the head
          if (e.phase === "move") {
            yaw -= e.angle;
            yawVel = -e.velocity;
            const card = Math.round(yaw / (Math.PI / 2));
            if (card !== lastCardinal) {
              lastCardinal = card;
              try {
                haptics.lens();
                audio.playTone(register.baseHz / 2, 0.22);
              } catch {
                /* noop */
              }
            }
          }
          if (e.phase === "end") save(performance.now());
        },
        scrub: (e) => {
          lastInteractionAt = performance.now();
          energy = 1.4;
          // a circling hand turns the whole animal about its own axis
          lure.x = 0;
          lure.y = 0;
          lure.z = 0;
          swirl = clamp(swirl + e.angularVelocity * 2.2, -34, 34);
          char.coh = clamp(char.coh + Math.abs(e.angularVelocity) * 0.02, 0.15, 2);
          save(performance.now());
        },
        rhythm: (e) => {
          // the wingbeat takes the hand's tempo
          if (e.stability > 0.6) {
            wingHzTarget = clamp(e.bpm / 60, 2.4, 13);
            try {
              haptics.tap();
            } catch {
              /* noop */
            }
          }
        },
      },
      { wheelZoom: false },
    );

    // ——— the vessel: this is the room where tilt IS the control ———
    const detachVessel = onVessel({
      tilt: ({ beta, gamma }) => {
        const w = windFromTilt(beta, gamma, WIND_MAX);
        tiltWind.x = w.x;
        tiltWind.y = w.y;
        tiltWind.z = w.z;
        rollTarget = clamp(-gamma / 90, -0.4, 0.4);
        pitchTarget = clamp(-0.06 + (beta - 45) / 320, -0.32, 0.24);
        if (Math.abs(gamma) > 6) energy = Math.max(energy, 0.6);
      },
      shake: ({ intensity }) => {
        lastInteractionAt = performance.now();
        energy = 2.2;
        // the sky bursts, and gathers itself again —
        // residents leave the tree and pond for the air
        scatter = Math.min(1, scatter + 0.55 + intensity * 0.45);
        const c = centroid(state.pos, state.n);
        flushNear(state, c, 40);
        startle(c, 40 + intensity * 60);
        stirTurbulence(0.25 + intensity * 0.35);
        pulse();
        try {
          audio.playTone(register.baseHz * 0.5, 0.5);
          haptics.chop();
        } catch {
          /* noop */
        }
        window.setTimeout(() => call(1.2), 220);
      },
      knock: () => {
        lastInteractionAt = performance.now();
        energy = 1.6;
        pulse();
        try {
          audio.thud();
          haptics.detent();
        } catch {
          /* noop */
        }
        window.setTimeout(() => call(1.1), 120);
      },
      flip: ({ faceDown }) => {
        // face-down is night: the flock goes quiet and low
        timeScaleTarget = faceDown ? 0.35 : 1;
      },
    });

    // ——— keyboard ———
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        lurePullTarget = 0;
        lurePull = 0;
        kbCharge = 0;
        handWind.x = 0;
        handWind.z = 0;
        return;
      }
      if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        energy = 1.4;
        yaw += ev.key === "ArrowLeft" ? -0.11 : 0.11;
        const card = Math.round(yaw / (Math.PI / 2));
        if (card !== lastCardinal) {
          lastCardinal = card;
          try {
            haptics.lens();
            audio.playTone(register.baseHz / 2, 0.22);
          } catch {
            /* noop */
          }
        }
        save(performance.now());
        return;
      }
      if (ev.key === "ArrowUp" || ev.key === "ArrowDown") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        energy = 1.4;
        handWind.z = clamp(handWind.z + (ev.key === "ArrowUp" ? -1.1 : 1.1), -WIND_MAX, WIND_MAX);
        return;
      }
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        energy = 1.6;
        if (!ev.repeat) {
          startle({ x: 0, y: 0, z: 0 }, 34);
          call(0.9);
          try {
            haptics.tap();
          } catch {
            /* noop */
          }
          kbCharge = 0.05;
          return;
        }
        // held Enter is the keyboard's gathering — the same slow road
        kbCharge = clamp01(kbCharge + 0.05);
        lure.x = 0;
        lure.y = 0;
        lure.z = 0;
        lurePullTarget = 4 + kbCharge * 26;
        gather = kbCharge;
        if (kbCharge >= 1) {
          kbCharge = 0;
          char.ali = clamp(char.ali + 0.1, 0.15, 2);
          char.coh = clamp(char.coh + 0.1, 0.15, 2);
          save(performance.now(), true);
          call(1.6);
          try {
            haptics.bloom();
          } catch {
            /* noop */
          }
        }
      }
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " ") {
        kbCharge = 0;
        lurePullTarget = 0;
        gather = 0;
      }
    };
    wrap.addEventListener("keydown", onKeyDown);
    wrap.addEventListener("keyup", onKeyUp);

    // ——— letting the flock go ———
    letGoRef.current = () => {
      try {
        window.localStorage.setItem(
          STORE_KEY,
          JSON.stringify({ ...WILD, season: 0, yaw: 0, cleared: true } satisfies Stored),
        );
      } catch {
        /* noop */
      }
      cleared = true;
      setHasKept(false);
      // it leaves the way a flock leaves: outward, over a breath or two
      leaving = 1;
      const c = centroid(state.pos, state.n);
      startle(c, 30);
      try {
        audio.thud();
        haptics.roll();
      } catch {
        /* noop */
      }
    };

    // ——— the one loop ———
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const tier = gov.beginFrame(now);
      if (paused) {
        last = now;
        return;
      }
      const deltaMs = Math.min(64, now - last);
      last = now;
      const dt = deltaMs / 1000;

      // A machine that cannot hold the frame loses birds rather than time —
      // the flock thins toward the tier's share, the room stays alive. Never
      // in the first seconds, where the cost is the page still arriving.
      if (now - startedAt > 5000 && now - thinnedAt > 4000) {
        const want = Math.max(MIN_DRAWN, Math.round(state.pos.length / 3 * detailForTier(tier).particles));
        if (want < drawn) {
          thinnedAt = now;
          drawn = Math.max(MIN_DRAWN, Math.round(drawn * 0.8));
          state.n = drawn;
        } else if (want > drawn) {
          thinnedAt = now;
          drawn = Math.min(want, Math.round(drawn * 1.2) + 40);
          state.n = drawn;
        }
      }

      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dt * 5);
      pitch += (pitchTarget - pitch) * Math.min(1, dt * 2.5);
      roll += (rollTarget - roll) * Math.min(1, dt * 2.5);
      wingHz += (wingHzTarget - wingHz) * Math.min(1, dt * 2);
      lurePull += (lurePullTarget - lurePull) * Math.min(1, dt * 4);
      swirl *= Math.exp(-dt * 0.9);
      scatter *= Math.exp(-dt * 0.5);
      handWind.x *= Math.exp(-dt * 0.22);
      handWind.z *= Math.exp(-dt * 0.22);
      if (Math.abs(yawVel) > 1e-4) {
        yaw += yawVel * dt;
        yawVel *= Math.exp(-dt * 4);
      }
      if (energy > 0) energy = Math.max(0, energy - dt);
      if (leaving > 0) leaving = Math.max(0, leaving - dt * 0.5);
      if (leaving > 0 && leaving < 0.02) {
        // the sky comes back wild, the way it was found
        char = { ...WILD };
        season = 0;
        seasonBlend = 0;
      }

      for (const k of ["x", "y", "z"] as const) {
        const target = tiltWind[k] + (k === "y" ? 0 : handWind[k]);
        wind[k] += (target - wind[k]) * Math.min(1, dt * 1.6);
      }

      const t = audio.getAudioTime() ?? now / 1000;
      const breath = reduced ? 0.5 : Math.sin(t * Math.PI * 2 * 0.14) * 0.5 + 0.5;

      // the law the flock is living under this frame
      const p: FlockParams = {
        separation: char.sep * (1 + scatter * 0.9),
        alignment: char.ali * (1 - scatter * 0.95) + gather * 0.5,
        cohesion: char.coh * (1 - scatter * 0.85) + gather * 0.4,
        wind,
        goal: seasonGoal(season),
        goalPull: SEASON_PULL * (1 - scatter * 0.5),
        lure,
        lurePull: lurePull + (leaving > 0 ? -14 * leaving : 0),
        swirl,
      };

      // Fixed timestep, accumulator inside: the same second of real time is
      // the same flock whatever the display is doing. Under reduced motion the
      // sky is still, but every verb still moves it.
      const advance = reduced ? (energy > 0 ? dt * timeScale : 0) : dt * timeScale;
      const steps = advance > 0 ? advanceFlock(state, p, advance) : 0;
      if (!reduced || energy > 0) visualT += dt * timeScale;
      if (pulseT >= 0) {
        pulseT += dt;
        if (pulseT > 1.2) pulseT = -1;
      }

      order = orderParameter(state.vel, state.n);

      // The call: the sound says the order before the eye resolves it. Only
      // once the sea has been woken — no room on this site ever starts sound
      // on its own.
      if (
        audio.getAudioTime() !== null &&
        !document.hidden &&
        now - lastCallAt > callInterval(order)
      ) {
        lastCallAt = now;
        call(0.55 + (1 - order) * 0.2);
      }

      // glimmer: after ~20s of stillness, one wave of wings crosses the sky
      if (now - lastInteractionAt > 20000 && now - glimmerAt > 9000 && !reduced) {
        glimmerAt = now;
        pulse();
      }

      // ——— render ———
      setView();
      // the sky turns toward the season rather than cutting to it
      const sk = SEASON_SKY[seasonIndex(season)];
      const k = Math.min(1, dt * 1.1);
      for (let i = 0; i < 3; i++) {
        low[i] += (sk.low[i] - low[i]) * k;
        high[i] += (sk.high[i] - high[i]) * k;
        sunTint[i] += (sk.sun[i] - sunTint[i]) * k;
      }
      const sun = sunScreen();
      const horizon = horizonUv();
      const ground = [low[0] * 0.16 + 0.012, low[1] * 0.16 + 0.014, low[2] * 0.17 + 0.02];

      gl.disable(gl.BLEND);
      gl.useProgram(skyProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(uSky.pos);
      gl.vertexAttribPointer(uSky.pos, 2, gl.FLOAT, false, 0, 0);
      gl.uniform3f(uSky.low, low[0], low[1], low[2]);
      gl.uniform3f(uSky.high, high[0], high[1], high[2]);
      gl.uniform3f(uSky.sunTint, sunTint[0], sunTint[1], sunTint[2]);
      gl.uniform3f(uSky.sun, sun.x, sun.y, sun.v);
      gl.uniform3f(uSky.ground, ground[0], ground[1], ground[2]);
      gl.uniform1f(uSky.aspect, aspect);
      gl.uniform1f(uSky.roll, roll);
      gl.uniform1f(uSky.horizon, horizon);
      gl.uniform1f(uSky.breath, breath);
      gl.uniform1f(uSky.time, visualT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disableVertexAttribArray(uSky.pos);

      if (steps > 0 || !uploaded) {
        uploaded = true;
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, state.pos);
        gl.bindBuffer(gl.ARRAY_BUFFER, velBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, state.vel);
      }

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(birdProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.enableVertexAttribArray(uBird.pos);
      gl.vertexAttribPointer(uBird.pos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, velBuf);
      gl.enableVertexAttribArray(uBird.vel);
      gl.vertexAttribPointer(uBird.vel, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, birdBuf);
      gl.enableVertexAttribArray(uBird.bird);
      gl.vertexAttribPointer(uBird.bird, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, tintBuf);
      if (uBird.tint >= 0) {
        gl.enableVertexAttribArray(uBird.tint);
        gl.vertexAttribPointer(uBird.tint, 3, gl.FLOAT, false, 0, 0);
      }
      gl.uniformMatrix3fv(uBird.view, false, viewM);
      gl.uniform1f(uBird.camDist, CAM_DIST);
      gl.uniform1f(uBird.focalX, focalX);
      gl.uniform1f(uBird.focalY, focalY);
      gl.uniform1f(uBird.time, visualT);
      gl.uniform1f(uBird.wingHz, wingHz);
      gl.uniform1f(uBird.reduced, reduced ? 1 : 0);
      gl.uniform1f(uBird.pointScale, pointScale);
      gl.uniform1f(uBird.pulseT, pulseT);
      gl.uniform3f(uBird.ink, 0.035, 0.032, 0.045);
      gl.uniform3f(uBird.low, low[0], low[1], low[2]);
      gl.uniform3f(uBird.high, high[0], high[1], high[2]);
      gl.uniform3f(uBird.ground, ground[0], ground[1], ground[2]);
      gl.uniform1f(uBird.horizon, horizon);
      gl.uniform2f(uBird.res, canvas.width, canvas.height);
      gl.uniform1f(uBird.haze, 0.72 - order * 0.22);
      gl.uniform1f(uBird.hazeFrom, CAM_DIST * 0.6);
      gl.drawArrays(gl.POINTS, 0, drawn);
      gl.disableVertexAttribArray(uBird.pos);
      gl.disableVertexAttribArray(uBird.vel);
      gl.disableVertexAttribArray(uBird.bird);
      if (uBird.tint >= 0) gl.disableVertexAttribArray(uBird.tint);
    };
    raf = requestAnimationFrame(draw);

    // A flock in a hidden tab, or in a gallery card nobody is looking at,
    // costs nothing: the clock stops rather than the sky racing.
    let hiddenNow = false;
    let galleryPaused = false;
    const settlePause = () => {
      const next = hiddenNow || galleryPaused;
      if (next === paused) return;
      paused = next;
      if (!paused) last = performance.now();
    };
    const detachVisibility = onVisibility((hidden) => {
      hiddenNow = hidden;
      settlePause();
    });
    const detachGallery = onGalleryPause((p) => {
      galleryPaused = p;
      settlePause();
    });

    return () => {
      observer.disconnect();
      detach();
      detachVessel();
      detachVisibility();
      detachGallery();
      wrap.removeEventListener("keydown", onKeyDown);
      wrap.removeEventListener("keyup", onKeyUp);
      mq.removeEventListener?.("change", onMq);
      cancelAnimationFrame(raf);
      gl.deleteBuffer(posBuf);
      gl.deleteBuffer(velBuf);
      gl.deleteBuffer(birdBuf);
      gl.deleteBuffer(tintBuf);
      gl.deleteBuffer(quad);
      gl.deleteProgram(skyProg);
      gl.deleteProgram(birdProg);
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      role="application"
      aria-label="a flock over an evening field"
      style={{
        position: "fixed",
        inset: 0,
        background: noGl ? "linear-gradient(#1a2030, #6a5b46)" : "#10131c",
        outline: "none",
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        overflow: "hidden",
      }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          // a machine with no shader keeps the dusk behind it rather than an
          // opaque black buffer
          display: noGl ? "none" : "block",
        }}
      />
      <LetGo label="let the flock go" onLetGo={() => letGoRef.current()} visible={hasKept} />
    </div>
  );
}
