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
 * The living aviary uses instanced billboard quads with per-kind SDF
 * silhouettes: large readable birds, still one WebGL pass and one rAF. No p5,
 * no animation library, no image assets (plan §3).
 *
 * The flock's character persists in `objetdart:birds:v1` with the quiet clear
 * at the bottom. Pinch is unbound — ScaleTravel owns it.
 */

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures, enableBreath } from "@/lib/gesture";
import { onVessel, requestVessel } from "@/lib/vessel";
import { stirTurbulence } from "@/lib/turbulence";
import { spectralRegisterFor } from "@/lib/scale";
import {
  createFrameGovernor,
  isEmbeddedFrame,
  onGalleryPause,
  onVisibility,
  resolveDpr,
} from "@/lib/room-runtime";
import LetGo from "@/components/LetGo";
import {
  ACTIVITIES,
  AVIARY_MAX,
  BIRD_KINDS,
  BIRD_SPECIES,
  MIN_SPEED,
  PARTIALS,
  SEASONS,
  WORLD_X,
  WORLD_Y,
  WORLD_Z,
  advanceFlock,
  callInterval,
  clearBirds,
  centroid,
  cullBird,
  flushNear,
  launchNearest,
  orderParameter,
  partialFreq,
  partialsForOrder,
  roostNearest,
  seedAviary,
  seasonGoal,
  seasonIndex,
  spawnBird,
  windFromTilt,
  type BirdKind,
  type FlockParams,
  type FlockState,
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
const SIZE_MIN = 0.35;
const SIZE_MAX = 1.8;

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
uniform vec2 u_viewOffset;
uniform float u_night;

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
  x += u_viewOffset.x * 0.22;
  y += u_viewOffset.y * 0.14;
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

  col = mix(col, vec3(0.012, 0.017, 0.030) + col.bgr * 0.09, u_night);
  gl_FragColor = vec4(col, 1.0);
}
`;

const BIRD_VERT = `
attribute vec2 a_corner;
attribute vec3 a_pos;
attribute vec3 a_vel;
attribute vec3 a_tint;
attribute vec4 a_meta; // phase, sizeNorm, kind, activity
uniform mat3 u_view;
uniform float u_camDist;
uniform float u_focalX;
uniform float u_focalY;
uniform float u_time;
uniform float u_wingHz;
uniform float u_reduced;
uniform float u_pulseT;
uniform vec2 u_resolution;
uniform vec2 u_viewOffset;
varying float vWing;
varying float vFade;
varying float vDepth;
varying vec2 vDir;
varying vec3 vTint;
varying vec2 vUv;
varying float vKind;
varying float vActivity;
void main() {
  vec3 p = u_view * a_pos;
  float z = max(p.z + u_camDist, 1.0);
  vec2 center = vec2(p.x * u_focalX / z, p.y * u_focalY / z) - u_viewOffset;

  vec3 q = u_view * (a_pos + a_vel * 0.03);
  float z2 = max(q.z + u_camDist, 1.0);
  vec2 dir = vec2(q.x * u_focalX / z2, q.y * u_focalY / z2) - center;
  float L = length(dir);
  vDir = L > 1e-6 ? dir / L : vec2(0.0, 1.0);

  float sp = length(a_vel);
  float ph = u_time * u_wingHz * (0.75 + sp * 0.035) + a_meta.x * 6.2831853;
  float pw = u_pulseT - (a_pos.x + ${WORLD_X.toFixed(1)}) / ${(WORLD_X * 2).toFixed(1)} * 0.42;
  float pulse = (pw > 0.0 && pw < 0.6) ? sin(pw * 11.0) * exp(-pw * 5.0) : 0.0;
  vWing = clamp(mix(0.5 + 0.5 * sin(ph), 0.6, u_reduced) + pulse * 0.55, 0.0, 1.2);
  vDepth = z;
  vFade = clamp(1.0 - (z - u_camDist) / 110.0, 0.22, 1.0);
  vTint = a_tint;
  vUv = a_corner;
  vKind = a_meta.z;
  vActivity = a_meta.w;
  float birdPx = u_resolution.y * (0.05 + 0.28 * clamp(a_meta.y, 0.0, 1.0));
  vec2 clipPx = vec2(2.0 / u_resolution.x, 2.0 / u_resolution.y);
  gl_Position = vec4(center + a_corner * birdPx * clipPx, 0.0, 1.0);
}
`;

const BIRD_FRAG = `
precision mediump float;
varying float vWing;
varying float vFade;
varying float vDepth;
varying vec2 vDir;
varying vec3 vTint;
varying vec2 vUv;
varying float vKind;
varying float vActivity;
uniform vec3 u_ink;
uniform vec3 u_low;
uniform vec3 u_high;
uniform vec3 u_ground;
uniform vec2 u_res;
uniform float u_horizon;
uniform float u_haze;
uniform float u_night;
uniform float u_hazeFrom;

float ellipse(vec2 p, vec2 r) {
  return 1.0 - smoothstep(0.96, 1.06, length(p / r));
}
float capsule(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return 1.0 - smoothstep(r, r + 0.035, length(pa - ba * h));
}
float tri(vec2 p, vec2 a, vec2 b, vec2 c) {
  vec2 e0 = b - a, e1 = c - b, e2 = a - c;
  vec2 v0 = p - a, v1 = p - b, v2 = p - c;
  float s0 = e0.x * v0.y - e0.y * v0.x;
  float s1 = e1.x * v1.y - e1.y * v1.x;
  float s2 = e2.x * v2.y - e2.y * v2.x;
  float inside = max(step(0.0, s0) * step(0.0, s1) * step(0.0, s2), step(s0, 0.0) * step(s1, 0.0) * step(s2, 0.0));
  float d = min(min(abs(s0) / length(e0), abs(s1) / length(e1)), abs(s2) / length(e2));
  return max(inside, 1.0 - smoothstep(0.0, 0.04, d));
}

float birdShape(vec2 p, float kind, float activity, float wing) {
  float swim = step(6.5, activity) * (1.0 - step(7.5, activity));
  float display = step(11.5, activity) * (1.0 - step(12.5, activity));
  float hover = step(12.5, activity) * (1.0 - step(13.5, activity));
  float dive = step(10.5, activity) * (1.0 - step(11.5, activity));
  float flap = mix(0.38, 1.05, wing);
  float a = 0.0;
  if (kind > 6.5 && kind < 8.5) {
    a = max(ellipse(p, vec2(0.30, 0.20)), tri(p, vec2(0.22, -0.05), vec2(0.95, -0.48 * flap), vec2(0.28, 0.08)));
    a = max(a, tri(p, vec2(-0.22, -0.05), vec2(-0.95, -0.48 * flap), vec2(-0.28, 0.08)));
    a = max(a, tri(p, vec2(0.28, 0.0), vec2(0.48, 0.06), vec2(0.28, 0.12)));
  } else if (kind > 8.5 && kind < 9.5) {
    a = max(ellipse(p, vec2(0.24, 0.13)), capsule(p, vec2(0.26, 0.02), vec2(0.72, 0.04), 0.025));
    a = max(a, tri(p, vec2(0.02, 0.0), vec2(0.72, 0.68 * flap), vec2(0.12, 0.07)));
    a = max(a, tri(p, vec2(-0.02, 0.0), vec2(-0.72, -0.68 * flap), vec2(-0.12, -0.07)));
    a = max(a, hover * ellipse(p + vec2(0.0, 0.02), vec2(0.86, 0.28)) * 0.38);
  } else if (kind > 4.5 && kind < 5.5) {
    a = max(ellipse(p + vec2(0.05, 0.02), vec2(0.34, 0.28)), ellipse(p - vec2(0.27, 0.18), vec2(0.15, 0.13)));
    a = max(a, tri(p, vec2(0.34, 0.16), vec2(0.55, 0.18), vec2(0.36, 0.24)));
    a = max(a, capsule(p, vec2(-0.02, -0.24), vec2(-0.05, -0.58), 0.025));
    a = max(a, capsule(p, vec2(0.15, -0.23), vec2(0.18, -0.56), 0.025));
  } else if (kind > 3.5 && kind < 4.5) {
    vec2 pp = p + vec2(0.0, swim * 0.12);
    a = max(ellipse(pp, vec2(0.44, 0.22)), ellipse(pp - vec2(0.34, 0.13), vec2(0.16, 0.13)));
    a = max(a, capsule(pp, vec2(0.43, 0.14), vec2(0.70, 0.13), 0.045));
    a *= mix(1.0, smoothstep(-0.42, -0.06, p.y), swim);
  } else if (kind > 1.5 && kind < 3.5) {
    float k = mix(0.62, 1.12, max(wing, dive));
    a = max(ellipse(p, vec2(0.28, 0.15)), tri(p, vec2(0.0, 0.02), vec2(1.0, -0.22 * k), vec2(0.18, -0.02)));
    a = max(a, tri(p, vec2(0.0, 0.02), vec2(-1.0, -0.22 * k), vec2(-0.18, -0.02)));
    a = max(a, tri(p, vec2(0.30, 0.0), vec2(0.58, 0.04), vec2(0.30, 0.10)));
  } else if (kind > 5.5 && kind < 6.5) {
    a = max(ellipse(p + vec2(0.02, 0.12), vec2(0.28, 0.33)), capsule(p, vec2(0.14, 0.22), vec2(0.28, 0.70), 0.055));
    a = max(a, ellipse(p - vec2(0.31, 0.70), vec2(0.13, 0.10)));
    a = max(a, capsule(p, vec2(-0.06, -0.18), vec2(-0.17, -0.78), 0.028));
    a = max(a, capsule(p, vec2(0.13, -0.19), vec2(0.20, -0.78), 0.028));
  } else if (kind > 9.5 && kind < 10.5) {
    a = max(ellipse(p, vec2(0.31, 0.20)), capsule(p, vec2(0.20, 0.12), vec2(0.38, 0.34), 0.055));
    a = max(a, capsule(p, vec2(0.37, 0.34), vec2(0.72, 0.16), 0.035));
    a = max(a, capsule(p, vec2(-0.08, -0.18), vec2(-0.14, -0.68), 0.026));
  } else if (kind > 10.5 && kind < 11.5) {
    float fan = max(display, 0.35);
    a = max(ellipse((p + vec2(0.28, 0.02)) * vec2(0.75, 1.0), vec2(0.55, 0.62)) * fan, ellipse(p, vec2(0.26, 0.17)));
    a = max(a, capsule(p, vec2(0.18, 0.10), vec2(0.34, 0.42), 0.045));
    a = max(a, tri(p, vec2(0.30, 0.42), vec2(0.42, 0.54), vec2(0.27, 0.48)));
  } else if (kind > 11.5) {
    a = max(ellipse(p, vec2(0.28, 0.16)), capsule(p, vec2(-0.15, -0.05), vec2(-0.82, -0.62), 0.05));
    a = max(a, capsule(p, vec2(-0.05, -0.02), vec2(-0.55, 0.68), 0.038));
    a = max(a, tri(p, vec2(0.24, 0.02), vec2(0.52, 0.08), vec2(0.25, 0.14)));
  } else {
    float crest = step(0.5, kind) * (1.0 - step(1.5, kind));
    a = max(ellipse(p, vec2(0.32, 0.22)), ellipse(p - vec2(0.27, 0.15), vec2(0.16, 0.14)));
    a = max(a, tri(p, vec2(0.36, 0.12), vec2(0.58, 0.05), vec2(0.38, 0.00)));
    a = max(a, tri(p, vec2(0.24, 0.27), vec2(0.32, 0.62), vec2(0.38, 0.25)) * crest);
    a = max(a, tri(p, vec2(-0.12, -0.02), vec2(-0.78, -0.34 * flap), vec2(-0.22, 0.05)));
  }
  return clamp(a, 0.0, 1.0);
}

void main() {
  vec2 q = vec2(vUv.x * vDir.y - vUv.y * vDir.x, vUv.x * vDir.x + vUv.y * vDir.y);
  float a = birdShape(q, vKind, vActivity, vWing);
  if (a < 0.02) discard;
  vec3 ink = mix(u_ink, vTint, 0.72);
  ink = mix(ink, ink.bgr * 0.35 + vec3(0.02, 0.025, 0.04), u_night);
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

    const glOpts: WebGLContextAttributes = {
      antialias: false,
      alpha: false,
      premultipliedAlpha: false,
      powerPreference: "low-power",
    };
    const gl2 = canvas.getContext("webgl2", glOpts) as WebGL2RenderingContext | null;
    const gl = (gl2 ||
      canvas.getContext("webgl", glOpts) ||
      canvas.getContext("experimental-webgl" as "webgl", glOpts)) as WebGLRenderingContext | null;
    const angle = !gl2 && gl ? gl.getExtension("ANGLE_instanced_arrays") : null;
    if (!gl || (!gl2 && !angle)) {
      setNoGl(true);
      return;
    }
    const divisor = (loc: number, d: number) => {
      if (loc < 0) return;
      if (gl2) gl2.vertexAttribDivisor(loc, d);
      else angle?.vertexAttribDivisorANGLE(loc, d);
    };
    const drawInstanced = (instances: number) => {
      if (gl2) gl2.drawArraysInstanced(gl2.TRIANGLE_STRIP, 0, 4, instances);
      else angle?.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, 4, instances);
    };

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
      viewOffset: gl.getUniformLocation(skyProg, "u_viewOffset"),
      night: gl.getUniformLocation(skyProg, "u_night"),
    };
    const uBird = {
      corner: gl.getAttribLocation(birdProg, "a_corner"),
      pos: gl.getAttribLocation(birdProg, "a_pos"),
      vel: gl.getAttribLocation(birdProg, "a_vel"),
      tint: gl.getAttribLocation(birdProg, "a_tint"),
      meta: gl.getAttribLocation(birdProg, "a_meta"),
      view: gl.getUniformLocation(birdProg, "u_view"),
      camDist: gl.getUniformLocation(birdProg, "u_camDist"),
      focalX: gl.getUniformLocation(birdProg, "u_focalX"),
      focalY: gl.getUniformLocation(birdProg, "u_focalY"),
      time: gl.getUniformLocation(birdProg, "u_time"),
      wingHz: gl.getUniformLocation(birdProg, "u_wingHz"),
      reduced: gl.getUniformLocation(birdProg, "u_reduced"),
      pulseT: gl.getUniformLocation(birdProg, "u_pulseT"),
      resolution: gl.getUniformLocation(birdProg, "u_resolution"),
      viewOffset: gl.getUniformLocation(birdProg, "u_viewOffset"),
      ink: gl.getUniformLocation(birdProg, "u_ink"),
      low: gl.getUniformLocation(birdProg, "u_low"),
      high: gl.getUniformLocation(birdProg, "u_high"),
      ground: gl.getUniformLocation(birdProg, "u_ground"),
      horizon: gl.getUniformLocation(birdProg, "u_horizon"),
      res: gl.getUniformLocation(birdProg, "u_res"),
      haze: gl.getUniformLocation(birdProg, "u_haze"),
      night: gl.getUniformLocation(birdProg, "u_night"),
      hazeFrom: gl.getUniformLocation(birdProg, "u_hazeFrom"),
    };

    // ——— the flock ———
    // The room is an aviary now: readable individuals at human scale. The
    // murmuration laws still live in flock.ts for high-count tests, but the
    // component never asks the screen for thousands of dots.
    const state = seedAviary(SKY_SEED, 0.25, season) as FlockState;
    let drawn = state.n;
    const meta = new Float32Array(AVIARY_MAX * 4);
    const writeMeta = () => {
      for (let i = 0; i < state.n; i++) {
        meta[i * 4] = state.bird[i * 2];
        meta[i * 4 + 1] = clamp01((state.bird[i * 2 + 1] - SIZE_MIN) / (SIZE_MAX - SIZE_MIN));
        meta[i * 4 + 2] = state.kindOf[i];
        meta[i * 4 + 3] = state.activityOf[i];
      }
    };
    writeMeta();

    const cornerBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, state.pos, gl.DYNAMIC_DRAW);
    const velBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, velBuf);
    gl.bufferData(gl.ARRAY_BUFFER, state.vel, gl.DYNAMIC_DRAW);
    const tintBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, tintBuf);
    gl.bufferData(gl.ARRAY_BUFFER, state.tint, gl.DYNAMIC_DRAW);
    const metaBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, metaBuf);
    gl.bufferData(gl.ARRAY_BUFFER, meta, gl.DYNAMIC_DRAW);

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
    let viewOffsetX = 0;
    let viewOffsetY = 0;
    let viewOffsetTX = 0;
    let viewOffsetTY = 0;
    let night = 0;
    let nightTarget = 0;
    let soften = 0;
    let softenTarget = 0;
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
    let lastDeathAt = 0;
    let uploaded = false;
    let metaDirty = true;
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
      const nx = ((cx - rectLeft) / Math.max(1, width)) * 2 - 1 + viewOffsetX;
      const ny = 1 - ((cy - rectTop) / Math.max(1, height)) * 2 + viewOffsetY;
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

    const activityOf = (name: (typeof ACTIVITIES)[number]) => ACTIVITIES.indexOf(name);
    const kindOf = (i: number): BirdKind => BIRD_KINDS[state.kindOf[i]] as BirdKind;
    const setBirdActivity = (i: number, activity: (typeof ACTIVITIES)[number]) => {
      if (i < 0 || i >= state.n) return;
      state.activityOf[i] = activityOf(activity);
      state.eatProgress[i] = activity === "eat" ? Math.max(state.eatProgress[i], 0.5) : state.eatProgress[i] * 0.6;
      metaDirty = true;
    };

    const birdScreen = (i: number) => {
      const x = state.pos[i * 3];
      const y = state.pos[i * 3 + 1];
      const z = state.pos[i * 3 + 2];
      const px = viewM[0] * x + viewM[3] * y + viewM[6] * z;
      const py = viewM[1] * x + viewM[4] * y + viewM[7] * z;
      const pz = viewM[2] * x + viewM[5] * y + viewM[8] * z + CAM_DIST;
      if (pz < 1) return null;
      const cx = ((px * focalX) / pz - viewOffsetX) * 0.5 + 0.5;
      const cy = 0.5 - (((py * focalY) / pz - viewOffsetY) * 0.5);
      const sizeNorm = clamp01((state.bird[i * 2 + 1] - SIZE_MIN) / (SIZE_MAX - SIZE_MIN));
      return {
        x: cx * width,
        y: cy * height,
        z: pz,
        r: height * (0.05 + 0.28 * sizeNorm) * 0.42,
      };
    };

    const birdAtScreen = (clientX: number, clientY: number) => {
      const sx = clientX - rectLeft;
      const sy = clientY - rectTop;
      let best = -1;
      let bestScore = Infinity;
      setView();
      for (let i = 0; i < state.n; i++) {
        const p = birdScreen(i);
        if (!p) continue;
        const dx = p.x - sx;
        const dy = p.y - sy;
        const d2 = dx * dx + dy * dy;
        const r = Math.max(28, p.r);
        if (d2 <= r * r && d2 + p.z * 0.02 < bestScore) {
          bestScore = d2 + p.z * 0.02;
          best = i;
        }
      }
      return best;
    };

    const chirp = (i: number, gain = 1) => {
      const kind = i >= 0 ? kindOf(i) : "finch";
      const sp = BIRD_SPECIES[kind];
      const scale = clamp(state.bird[Math.max(0, i) * 2 + 1] || sp.size, SIZE_MIN, SIZE_MAX);
      try {
        audio.playTone(register.baseHz * (1.2 + (1.8 - scale) * 0.45), 0.12 * gain);
      } catch {
        /* noop */
      }
    };

    const reactBird = (i: number, at: { x: number; y: number; z: number }, intensity: number) => {
      if (i < 0 || i >= state.n) return false;
      const kind = kindOf(i);
      if (kind === "hummingbird") setBirdActivity(i, "hover");
      else if (kind === "peacock" || kind === "bird-of-paradise") setBirdActivity(i, "display");
      else if (kind === "duck") setBirdActivity(i, "swim");
      else if (kind === "hawk" || kind === "falcon") setBirdActivity(i, intensity > 0.55 ? "dive" : "soar");
      else if (kind === "chicken" || kind === "sparrow" || kind === "finch") setBirdActivity(i, "hop");
      else if (kind === "emu" || kind === "red-ibis") setBirdActivity(i, "stalk");
      else if (kind === "parrot" || kind === "cockatiel") setBirdActivity(i, "perch");
      state.vel[i * 3] += (state.pos[i * 3] - at.x) * 0.22;
      state.vel[i * 3 + 1] += 2.2 + intensity * 2.4;
      state.vel[i * 3 + 2] += (state.pos[i * 3 + 2] - at.z) * 0.22;
      chirp(i, 0.9 + intensity * 0.5);
      try {
        haptics.ripple(0.35 + intensity * 0.35);
      } catch {
        /* noop */
      }
      return true;
    };

    const spawnAt = (at: { x: number; y: number; z: number }, kind?: BirdKind) => {
      const i = spawnBird(state, kind, at);
      if (i < 0) return -1;
      metaDirty = true;
      uploaded = false;
      drawn = state.n;
      chirp(i, 1.3);
      try {
        haptics.bloom();
      } catch {
        /* noop */
      }
      return i;
    };

    const cullAt = (i: number) => {
      const gone = cullBird(state, i);
      if (gone >= 0) {
        metaDirty = true;
        uploaded = false;
        drawn = state.n;
        try {
          audio.thud();
          haptics.roll();
        } catch {
          /* noop */
        }
      }
      return gone;
    };

    let breathStop: (() => void) | null = null;
    const armVessel = () => {
      void requestVessel().catch(() => {
        /* unavailable */
      });
    };
    const armBreath = async () => {
      if (breathStop) return;
      const stop = await enableBreath({
        breath: ({ strength }) => {
          softenTarget = Math.max(softenTarget, strength);
          wingHzTarget = clamp(wingHzTarget - strength * 2.5, 2.4, 13);
          try {
            audio.playTone(register.baseHz * (0.5 + strength * 0.2), 0.2);
          } catch {
            /* noop */
          }
        },
      });
      if (stop) breathStop = stop;
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
          armVessel();
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
          const at = screenToWorld(e.x, e.y);
          if (e.count >= 3) {
            const hit = birdAtScreen(e.x, e.y);
            if (hit >= 0) cullAt(hit);
            else {
              clearBirds(state);
              metaDirty = true;
              uploaded = false;
              drawn = state.n;
              leaving = Math.max(leaving, 0.75);
              try {
                audio.thud();
                haptics.roll();
              } catch {
                /* noop */
              }
            }
            return;
          }
          if (e.count === 2) {
            spawnAt(at);
            stirTurbulence(0.05);
            return;
          }
          const hit = birdAtScreen(e.x, e.y);
          if (hit >= 0 && reactBird(hit, at, e.intensity)) return;
          // one finger in the air: the birds nearest it break away —
          // residents flush into flight, the murmuration startles.
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
          if (e.phase === "enter") armVessel();
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
          if (e.tier >= 3) void armBreath();
          const p = screenToWorld(e.x, e.y);
          lure.x = p.x;
          lure.y = p.y;
          lure.z = p.z;
          if (state.n <= 0) {
            spawnAt(p);
            return;
          }
          const held = birdAtScreen(e.x, e.y);
          if (held >= 0) {
            setBirdActivity(held, "eat");
            state.bird[held * 2 + 1] = clamp(state.bird[held * 2 + 1] + (e.elapsed / 2500) * 0.004, SIZE_MIN, SIZE_MAX);
            state.eatProgress[held] = clamp01(state.eatProgress[held] + 0.08);
            metaDirty = true;
            if (e.phase === "enter") chirp(held, 0.8);
          }
          // A dwell on the meadow roosts the nearest bird; the longer hold
          // still gathers the murmuration onto the hand.
          if (held < 0 && e.phase === "enter" && e.tier >= 1) {
            roostNearest(state, p);
            metaDirty = true;
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
          // a hand drawn through the aviary steers the wind and pushes aside
          // whatever it crosses.
          handWind.x = clamp(handWind.x + e.dx * 0.012, -WIND_MAX, WIND_MAX);
          handWind.z = clamp(handWind.z + e.dy * 0.012, -WIND_MAX, WIND_MAX);
          const p = screenToWorld(e.x, e.y);
          lure.x = p.x;
          lure.y = p.y;
          lure.z = p.z;
          const speed = Math.min(1, Math.hypot(e.vx, e.vy) / 1.4);
          lurePull = -(6 + speed * 26);
          lurePullTarget = 0;
        },
        pan2: (e) => {
          lastInteractionAt = performance.now();
          energy = 1.0;
          if (e.phase === "end") return;
          viewOffsetTX = clamp(viewOffsetTX - (e.dx / Math.max(1, width)) * 1.6, -0.42, 0.42);
          viewOffsetTY = clamp(viewOffsetTY + (e.dy / Math.max(1, height)) * 1.2, -0.34, 0.34);
          try {
            if (Math.abs(e.dx) + Math.abs(e.dy) > 8) haptics.tap();
          } catch {
            /* noop */
          }
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
    let lastTiltTickAt = 0;
    let lastTiltBand = 0;
    const detachVessel = onVessel({
      tilt: ({ beta, gamma }) => {
        const w = windFromTilt(beta, gamma, WIND_MAX);
        tiltWind.x = w.x;
        tiltWind.y = w.y;
        tiltWind.z = w.z;
        rollTarget = clamp(-gamma / 90, -0.4, 0.4);
        pitchTarget = clamp(-0.06 + (beta - 45) / 320, -0.32, 0.24);
        wingHzTarget = clamp(7.2 + Math.abs(gamma) * 0.035 + Math.abs(beta - 45) * 0.018, 2.4, 13);
        viewOffsetTX = clamp(viewOffsetTX + gamma * 0.00018, -0.42, 0.42);
        viewOffsetTY = clamp(viewOffsetTY + (beta - 45) * 0.00012, -0.34, 0.34);
        if (Math.abs(gamma) > 6) energy = Math.max(energy, 0.6);
        const mag = Math.hypot(gamma / 35, (beta - 45) / 45);
        const band = Math.floor(clamp(mag, 0, 2.4) * 4);
        const now = performance.now();
        if (band > 1 && (band !== lastTiltBand || now - lastTiltTickAt > 420)) {
          lastTiltBand = band;
          lastTiltTickAt = now;
          try {
            haptics.tap();
            audio.playTone(register.baseHz * (0.62 + band * 0.06), 0.08);
          } catch {
            /* noop */
          }
        }
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
        nightTarget = faceDown ? 1 : 0;
        if (faceDown) {
          try {
            audio.playTone(register.baseHz / 3, 0.8);
            haptics.roll();
          } catch {
            /* noop */
          }
        }
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

    const onScaleTravel = () => {
      leaving = 1;
      lastDeathAt = 0;
      const c = centroid(state.pos, state.n);
      startle(c, 44);
      try {
        audio.thud();
        haptics.crossing();
      } catch {
        /* noop */
      }
    };
    window.addEventListener("objetdart:scale-travel:start", onScaleTravel);

    // ——— the one loop ———
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      gov.beginFrame(now);
      if (paused) {
        last = now;
        return;
      }
      const deltaMs = Math.min(64, now - last);
      last = now;
      const dt = deltaMs / 1000;

      drawn = state.n;

      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dt * 5);
      pitch += (pitchTarget - pitch) * Math.min(1, dt * 2.5);
      roll += (rollTarget - roll) * Math.min(1, dt * 2.5);
      viewOffsetX += (viewOffsetTX - viewOffsetX) * (reduced ? 1 : Math.min(1, dt * 3.2));
      viewOffsetY += (viewOffsetTY - viewOffsetY) * (reduced ? 1 : Math.min(1, dt * 3.2));
      night += (nightTarget - night) * Math.min(1, dt * 4);
      soften += (softenTarget - soften) * Math.min(1, dt * 3);
      softenTarget *= Math.exp(-dt * 1.2);
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
      if (leaving > 0 && state.n > 1 && now - lastDeathAt > 120) {
        lastDeathAt = now;
        cullBird(state, state.n - 1);
        metaDirty = true;
        uploaded = false;
      }
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
        alignment: char.ali * (1 - scatter * 0.95) + gather * 0.5 - soften * 0.22,
        cohesion: char.coh * (1 - scatter * 0.85) + gather * 0.4 - soften * 0.18,
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
      gl.uniform2f(uSky.viewOffset, viewOffsetX, viewOffsetY);
      gl.uniform1f(uSky.night, night);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disableVertexAttribArray(uSky.pos);

      if (steps > 0 || !uploaded) {
        uploaded = true;
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, state.pos.subarray(0, state.capacity * 3));
        gl.bindBuffer(gl.ARRAY_BUFFER, velBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, state.vel.subarray(0, state.capacity * 3));
        metaDirty = true;
      }
      if (metaDirty || !uploaded) {
        metaDirty = false;
        writeMeta();
        gl.bindBuffer(gl.ARRAY_BUFFER, metaBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, meta);
        gl.bindBuffer(gl.ARRAY_BUFFER, tintBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, state.tint.subarray(0, state.capacity * 3));
      }

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(birdProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
      gl.enableVertexAttribArray(uBird.corner);
      gl.vertexAttribPointer(uBird.corner, 2, gl.FLOAT, false, 0, 0);
      divisor(uBird.corner, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.enableVertexAttribArray(uBird.pos);
      gl.vertexAttribPointer(uBird.pos, 3, gl.FLOAT, false, 0, 0);
      divisor(uBird.pos, 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, velBuf);
      gl.enableVertexAttribArray(uBird.vel);
      gl.vertexAttribPointer(uBird.vel, 3, gl.FLOAT, false, 0, 0);
      divisor(uBird.vel, 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, tintBuf);
      if (uBird.tint >= 0) {
        gl.enableVertexAttribArray(uBird.tint);
        gl.vertexAttribPointer(uBird.tint, 3, gl.FLOAT, false, 0, 0);
        divisor(uBird.tint, 1);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, metaBuf);
      gl.enableVertexAttribArray(uBird.meta);
      gl.vertexAttribPointer(uBird.meta, 4, gl.FLOAT, false, 0, 0);
      divisor(uBird.meta, 1);
      gl.uniformMatrix3fv(uBird.view, false, viewM);
      gl.uniform1f(uBird.camDist, CAM_DIST);
      gl.uniform1f(uBird.focalX, focalX);
      gl.uniform1f(uBird.focalY, focalY);
      gl.uniform1f(uBird.time, visualT);
      gl.uniform1f(uBird.wingHz, wingHz);
      gl.uniform1f(uBird.reduced, reduced ? 1 : 0);
      gl.uniform1f(uBird.pulseT, pulseT);
      gl.uniform2f(uBird.resolution, canvas.width, canvas.height);
      gl.uniform2f(uBird.viewOffset, viewOffsetX, viewOffsetY);
      gl.uniform3f(uBird.ink, 0.035, 0.032, 0.045);
      gl.uniform3f(uBird.low, low[0], low[1], low[2]);
      gl.uniform3f(uBird.high, high[0], high[1], high[2]);
      gl.uniform3f(uBird.ground, ground[0], ground[1], ground[2]);
      gl.uniform1f(uBird.horizon, horizon);
      gl.uniform2f(uBird.res, canvas.width, canvas.height);
      gl.uniform1f(uBird.haze, 0.72 - order * 0.22);
      gl.uniform1f(uBird.night, night);
      gl.uniform1f(uBird.hazeFrom, CAM_DIST * 0.6);
      drawInstanced(drawn);
      divisor(uBird.pos, 0);
      divisor(uBird.vel, 0);
      divisor(uBird.tint, 0);
      divisor(uBird.meta, 0);
      gl.disableVertexAttribArray(uBird.corner);
      gl.disableVertexAttribArray(uBird.pos);
      gl.disableVertexAttribArray(uBird.vel);
      gl.disableVertexAttribArray(uBird.meta);
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
      window.removeEventListener("objetdart:scale-travel:start", onScaleTravel);
      breathStop?.();
      wrap.removeEventListener("keydown", onKeyDown);
      wrap.removeEventListener("keyup", onKeyUp);
      mq.removeEventListener?.("change", onMq);
      cancelAnimationFrame(raf);
      gl.deleteBuffer(cornerBuf);
      gl.deleteBuffer(posBuf);
      gl.deleteBuffer(velBuf);
      gl.deleteBuffer(tintBuf);
      gl.deleteBuffer(metaBuf);
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
