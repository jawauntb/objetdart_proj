"use client";

/**
 * PlanetForge — /planets. A star, a budget of dust, and the worlds a hand
 * condenses out of it.
 *
 * The invariant is the latent (src/lib/worldforge.ts): a compact 12-dim
 * vector IS a world, decoded affinely into terrain, ocean, atmosphere, tilt,
 * spin, ring, moons, ice — and read back off the world exactly. The twist
 * lens raises the vector itself as notation: twelve spokes, read back live.
 *
 * Sculpting is movement of the point, and the room's law moves it *for* you:
 * an orbit sets a world's temperature (inverse square), temperature and mass
 * set what water and air it can keep (Jeans escape), and the surface settles
 * toward that climate at a bounded rate. Throw a world inward and its seas
 * boil; throw it out and the ice takes it. Spin flattens it; the tide brakes
 * it. Mass is conserved throughout — worlds condense out of one budget of
 * dust, collisions merge and eject, the star eats what falls in, and all of
 * it returns to the shimmer of the reserve.
 *
 * Rendering is WebGL through `lib/webgl/stage`: one instanced draw for every
 * body (analytic ellipsoid, 3D-noise terrain, cloud deck, terminator, limb
 * haze, ring shadow cast through the equatorial plane), two passes for the
 * ring arcs, one point-sprite pass for the disc of dust, one quad for the
 * star. The 2D canvas above it is the thin overlay only — the accretion
 * swirl, the scattering of a world returning to dust, and the lens notation.
 * No per-frame gradients, no blur filters, no CPU texture loops.
 *
 * Gestures arrive through `<RoomShell>`'s voice, so every global verb of
 * `docs/gesture-grammar.md` lands; pinch and pan2 stay ScaleTravel's.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RoomShell from "@/components/RoomShell";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import type { RoomVoice } from "@/lib/gesture/defaults";
import { tapTrainDepth, tapTrainTier } from "@/lib/gesture/core";
import { createGLStage, type GLProgram, type GLStage } from "@/lib/webgl/stage";
import { clocksFrom } from "@/lib/webgl/sizing";
import {
  DUST_TOTAL,
  MASS_MIN,
  MAX_WORLDS,
  RING_MIN,
  LATENT_DIM,
  STAR_MU,
  STAR_RADIUS,
  type World,
  accretionRadius,
  addWorld,
  atmosphereRetention,
  circularSpeed,
  climateTarget,
  floodOcean,
  forgeWorld,
  growWorld,
  hashSeed,
  latentFromWorld,
  massOf,
  mergeWorlds,
  mulberry32,
  oblateness,
  raiseLand,
  settleClimate,
  stepBodies,
  temperature01,
  tiltAxis,
  tidalSpin,
  windRing,
  worldChord,
  worldColors,
  worldFromLatent,
  type Body,
} from "@/lib/worldforge";

const STORE_KEY = "objetdart:planets:v2";

const TAU = Math.PI * 2;

/** Field radius of a world of radius01 = 1, in field units. */
const WORLD_R_UNIT = 0.09;
/** How much of the short screen edge the unit field spans. */
const FIELD_FRAC = 0.86;
/** Past this distance from the star a world is lost to the dark. */
const ESCAPE_R = 1.7;
/** A retired or lost world takes this long to scatter. */
const RETIRE_MS = 1600;
/** Seconds of room time per hour of a world's day. */
const DAY_SECONDS_PER_HOUR = 0.6;
/** Dust motes in the disc. */
const DUST_N = 260;
/** Physics substeps per frame — small, fixed, enough for the softening. */
const SUBSTEPS = 2;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ————————————————————————— the shaders —————————————————————————

/** Site tokens as GLSL constants — the only colors a world may wear. */
const GLSL_PALETTE = `
const vec3 C_MERLOT_D = vec3(0.310, 0.078, 0.078);
const vec3 C_MERLOT   = vec3(0.478, 0.122, 0.122);
const vec3 C_GOLD_D   = vec3(0.612, 0.345, 0.125);
const vec3 C_GOLD     = vec3(0.784, 0.451, 0.165);
const vec3 C_KEPT     = vec3(0.431, 0.353, 0.180);
const vec3 C_SEA_D    = vec3(0.118, 0.204, 0.251);
const vec3 C_SEA      = vec3(0.173, 0.290, 0.361);
const vec3 C_PARCH    = vec3(0.867, 0.827, 0.745);
const vec3 C_PAPER    = vec3(0.949, 0.933, 0.902);
const vec3 C_INK      = vec3(0.082, 0.090, 0.102);
const vec3 C_NIGHT    = vec3(0.035, 0.043, 0.055);

vec3 ramp4(vec3 a, vec3 b, vec3 c, vec3 d, float u) {
  float x = clamp(u, 0.0, 1.0) * 3.0;
  if (x < 1.0) return mix(a, b, x);
  if (x < 2.0) return mix(b, c, x - 1.0);
  return mix(c, d, x - 2.0);
}
vec3 ramp3(vec3 a, vec3 b, vec3 c, float u) {
  float x = clamp(u, 0.0, 1.0) * 2.0;
  return x < 1.0 ? mix(a, b, x) : mix(b, c, x - 1.0);
}
`;

/** Value noise on the sphere's own direction — no equirect seam, no texture. */
const GLSL_NOISE = `
float hash31(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash31(i);
  float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash31(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
             mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
// Four octaves, fixed — the loop is bounded by law, not by data.
float fbm3(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  float n = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    n += a;
    a *= 0.5;
    p = p * 2.03 + vec3(11.7, 5.3, 7.9);
  }
  return s / n;
}
`;

const VERT_BODY = `
precision highp float;
attribute vec2 a_corner;
attribute vec4 a_geom;  // cx, cy (device px), R (px), alpha
attribute vec4 a_p0;    // ocean, terrainHue, relief, atmoHue
attribute vec4 a_p1;    // atmoDepth, cloud, ice, ring
attribute vec4 a_p2;    // tilt, spin phase, oblateness, temperature
attribute vec4 a_p3;    // seed offset, focus, light angle, moonness
uniform vec2 u_res;
uniform float u_pad;
varying vec2 v_uv;
varying vec4 v_p0;
varying vec4 v_p1;
varying vec4 v_p2;
varying vec4 v_p3;
varying float v_alpha;
void main() {
  v_uv = a_corner * u_pad;
  v_p0 = a_p0; v_p1 = a_p1; v_p2 = a_p2; v_p3 = a_p3;
  v_alpha = a_geom.w;
  vec2 px = a_geom.xy + a_corner * a_geom.z * u_pad;
  vec2 ndc = (px / u_res) * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
}
`;

const FRAG_BODY = `
precision highp float;
varying vec2 v_uv;
varying vec4 v_p0;
varying vec4 v_p1;
varying vec4 v_p2;
varying vec4 v_p3;
varying float v_alpha;
uniform float u_time;
uniform float u_night;
// The shared 7s breath, bound by the stage from lib/webgl/sizing — the same
// clock the sea on / breathes on, so the air here rises with the whole album.
uniform float u_breath;
${GLSL_PALETTE}
${GLSL_NOISE}

void main() {
  float tilt = v_p2.x;
  float ob = v_p2.z;
  float ct = cos(-tilt), st = sin(-tilt);
  vec2 q = vec2(v_uv.x * ct - v_uv.y * st, v_uv.x * st + v_uv.y * ct);
  // Spin flattens the body: the poles come in while the equator holds.
  vec2 e = vec2(q.x, q.y / (1.0 - ob));
  float r2 = dot(e, e);
  float airy = v_p1.x;
  vec3 atmoCol = ramp3(C_SEA, C_PAPER, C_GOLD, v_p0.w);
  float lightA = v_p3.z;
  vec3 L = normalize(vec3(cos(lightA), sin(lightA), 0.55));

  if (r2 > 1.0) {
    // The atmosphere seen past the limb — a thin shell, lit on the day side.
    float d = sqrt(r2) - 1.0;
    float halo = exp(-d * (10.0 - u_breath * 1.6)) * airy * (0.48 + u_breath * 0.14);
    vec3 nv = vec3(normalize(q), 0.0);
    float lit = 0.35 + 0.65 * smoothstep(-0.2, 0.5, dot(nv, L));
    float a = halo * lit * v_alpha * (1.0 - u_night * 0.8);
    gl_FragColor = vec4(atmoCol * a, a);
    return;
  }

  float z = sqrt(max(1e-4, 1.0 - r2));
  vec3 n = normalize(vec3(e, z));
  float sp = v_p2.y;
  float cs = cos(sp), ss = sin(sp);
  vec3 dir = vec3(n.x * cs + n.z * ss, n.y, -n.x * ss + n.z * cs);
  dir += vec3(v_p3.x);
  float lat = asin(clamp(n.y, -1.0, 1.0));

  float moon = v_p3.w;
  float h = fbm3(dir * 2.6);
  float sea = 0.34 + v_p0.x * 0.33;
  float landness = h - sea;
  vec3 landLo = ramp4(C_MERLOT_D, C_GOLD_D, C_KEPT, C_SEA_D, v_p0.y);
  vec3 landHi = ramp4(C_MERLOT, C_GOLD, C_PARCH, C_PAPER, v_p0.y);
  vec3 seaShallow = mix(C_SEA, C_PAPER, 0.16);
  vec3 seaDeep = mix(C_SEA_D, C_INK, 0.35);
  vec3 col = landness > 0.0
    ? mix(landLo, landHi, clamp(landness * (1.6 + v_p0.z * 3.2), 0.0, 1.0))
    : mix(seaShallow, seaDeep, 0.25 + clamp(-landness * 5.0, 0.0, 1.0) * 0.75);

  // Ice: the caps reach down as the world cools.
  float iceEdge = 1.5 - v_p1.z * 0.85 + v_p2.w * 0.55;
  float ice = smoothstep(iceEdge, iceEdge + 0.22, abs(lat));
  col = mix(col, mix(C_PAPER, C_SEA, 0.12), ice * 0.92 * (1.0 - moon));

  // The cloud deck belongs to the air: no atmosphere, no weather.
  float cf = fbm3(dir * 2.0 + vec3(u_time * 0.015, 0.0, u_time * 0.008));
  float cth = 0.62 - v_p1.y * 0.22;
  float cl = smoothstep(cth, cth + 0.16, cf) * airy * (1.0 - moon);
  col = mix(col, C_PAPER, cl * 0.6);

  // Lighting: the star is the only lamp in the room.
  float cb = cos(tilt), sb = sin(tilt);
  vec3 nv = vec3(n.x * cb - n.y * sb, n.x * sb + n.y * cb, n.z);
  float day = smoothstep(-0.08, 0.32, dot(nv, L));

  // The ring's shadow, cast through the equatorial plane onto the sphere.
  float ringD = v_p1.w;
  if (ringD > ${RING_MIN.toFixed(3)} && moon < 0.5) {
    vec3 Lt = vec3(L.x * ct - L.y * st, L.x * st + L.y * ct, L.z);
    if (abs(Lt.y) > 0.02) {
      float t = -n.y / Lt.y;
      if (t > 0.0) {
        vec3 hit = n + t * Lt;
        float rr = length(hit.xz);
        float inR = 1.35;
        float outR = inR + 0.55 + (ringD - ${RING_MIN.toFixed(3)}) * 1.5;
        if (rr > inR && rr < outR) {
          float band = 0.45 + 0.55 * vnoise(vec3(rr * 22.0, 3.1, 7.7));
          day *= 1.0 - 0.62 * band * ringD;
        }
      }
    }
  }

  vec3 lit = col;
  col = mix(mix(col, C_NIGHT, 0.86), lit, day);

  // Embers on the night side: fires on the high ground, the candle again.
  if (moon < 0.5 && landness > 0.08) {
    float sparkle = vnoise(dir * 42.0);
    col = mix(col, C_GOLD, step(0.88, sparkle) * (1.0 - day) * 0.75);
  }

  // Limb haze, then the terminator's own shading.
  float limb = smoothstep(0.55, 1.0, sqrt(r2));
  col = mix(col, atmoCol, limb * airy * 0.42 * (0.3 + 0.7 * day));
  col *= 0.42 + 0.58 * z;
  col *= 1.0 + v_p3.y * 0.1;
  col = mix(col, C_NIGHT, u_night * 0.85);
  float edge = smoothstep(1.0, 0.97, r2);
  gl_FragColor = vec4(col * v_alpha * edge, v_alpha * edge);
}
`;

const VERT_RING = `
precision highp float;
attribute vec2 a_corner;
attribute vec4 a_geom;
attribute vec4 a_p1;
attribute vec4 a_p2;
attribute vec4 a_p3;
uniform vec2 u_res;
uniform float u_pad;
varying vec2 v_uv;
varying vec4 v_p1;
varying vec4 v_p2;
varying vec4 v_p3;
varying float v_alpha;
void main() {
  v_uv = a_corner * u_pad;
  v_p1 = a_p1; v_p2 = a_p2; v_p3 = a_p3;
  v_alpha = a_geom.w;
  vec2 px = a_geom.xy + a_corner * a_geom.z * u_pad;
  vec2 ndc = (px / u_res) * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
}
`;

const FRAG_RING = `
precision highp float;
varying vec2 v_uv;
varying vec4 v_p1;
varying vec4 v_p2;
varying vec4 v_p3;
varying float v_alpha;
uniform float u_half;   // +1 the near arc, -1 the far arc
uniform float u_night;
${GLSL_PALETTE}
${GLSL_NOISE}
void main() {
  float tilt = v_p2.x;
  float ob = v_p2.z;
  float ct = cos(-tilt), st = sin(-tilt);
  vec2 q = vec2(v_uv.x * ct - v_uv.y * st, v_uv.x * st + v_uv.y * ct);
  // The ring lies in the equatorial plane, seen at a fixed inclination.
  // (Not named "flat" — that is a reserved word in GLSL ES.)
  float incl = 0.30 + tilt * 0.55;
  vec3 P = vec3(q.x, 0.0, q.y / max(0.08, incl));
  float rr = length(P.xz);
  float ringD = v_p1.w;
  float inR = 1.35;
  float outR = inR + 0.55 + (ringD - ${RING_MIN.toFixed(3)}) * 1.5;
  if (rr < inR || rr > outR) discard;
  // Near arc in front of the world, far arc behind it.
  if (sign(P.z) != u_half) discard;
  vec2 e = vec2(q.x, q.y / (1.0 - ob));
  if (u_half < 0.0 && dot(e, e) < 1.0) discard;
  float band = vnoise(vec3(rr * 26.0 + v_p3.x, 2.3, 5.1));
  float gap = smoothstep(0.24, 0.34, band);
  float edgeIn = smoothstep(inR, inR + 0.1, rr);
  float edgeOut = 1.0 - smoothstep(outR - 0.14, outR, rr);
  // The world's own shadow falls across the ring.
  float lightA = v_p3.z;
  vec3 L = normalize(vec3(cos(lightA), sin(lightA), 0.55));
  vec3 Lt = vec3(L.x * ct - L.y * st, L.x * st + L.y * ct, L.z);
  float t = -dot(P, Lt);
  float shade = 1.0;
  if (t > 0.0 && length(P + t * Lt) < 1.0) shade = 0.34;
  vec3 col = mix(C_PARCH, C_KEPT, 0.4 + 0.4 * ringD) * shade;
  float a = gap * edgeIn * edgeOut * v_alpha * (0.32 + 0.5 * ringD) * (1.0 - u_night * 0.75);
  gl_FragColor = vec4(col * a, a);
}
`;

const VERT_DUST = `
precision highp float;
attribute vec4 a_dust;  // angle0, radius, phase, size bias
uniform vec2 u_res;
uniform vec2 u_centre;
uniform float u_scale;
uniform float u_time;
uniform vec2 u_lean;
uniform float u_dpr;
varying float v_bias;
varying float v_tw;
void main() {
  // The disc shears: inner dust laps the outer, as a real one does.
  float ang = a_dust.x + u_time * 0.06 / pow(max(0.06, a_dust.y), 1.5);
  vec2 p = u_centre + vec2(cos(ang), sin(ang) * 0.86) * a_dust.y * u_scale + u_lean * a_dust.w;
  vec2 ndc = (p / u_res) * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
  gl_PointSize = (1.0 + a_dust.w * 1.6) * u_dpr;
  v_bias = a_dust.w;
  v_tw = 0.55 + 0.45 * sin(u_time * (0.5 + a_dust.w) + a_dust.z);
}
`;

const FRAG_DUST = `
precision highp float;
varying float v_bias;
varying float v_tw;
uniform float u_alpha;
${GLSL_PALETTE}
void main() {
  vec3 col = mix(C_PAPER, C_GOLD, v_bias * 0.5);
  float a = u_alpha * v_tw * (0.25 + v_bias * 0.55);
  gl_FragColor = vec4(col * a, a);
}
`;

const VERT_STAR = `
precision highp float;
attribute vec2 a_corner;
uniform vec2 u_res;
uniform vec2 u_centre;
uniform float u_R;
varying vec2 v_uv;
void main() {
  v_uv = a_corner;
  vec2 px = u_centre + a_corner * u_R;
  vec2 ndc = (px / u_res) * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
}
`;

const FRAG_STAR = `
precision highp float;
varying vec2 v_uv;
uniform float u_time;
uniform float u_lum;
uniform float u_night;
uniform float u_breath;
${GLSL_PALETTE}
${GLSL_NOISE}
void main() {
  float r = length(v_uv);
  if (r > 1.0) discard;
  // The star swells on the album's 7s breath, not a clock of its own.
  float breath = 0.92 + 0.13 * u_breath;
  float gran = 0.85 + 0.3 * vnoise(vec3(v_uv * 6.0, u_time * 0.25));
  float core = smoothstep(0.20, 0.10, r) * gran;
  float corona = exp(-r * 6.0) * 0.9 + exp(-r * 2.2) * 0.28;
  float a = (core + corona) * breath * u_lum * (1.0 - u_night * 0.9);
  vec3 col = mix(C_GOLD, C_PAPER, clamp(core * 1.4, 0.0, 1.0));
  gl_FragColor = vec4(col * a, a);
}
`;

// ————————————————————————— the room —————————————————————————

type Entry = {
  id: number;
  born: number;
  world: World;
  /** Field-space orbital state, star at (0.5, 0.5). */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Rotation rate, rad/s, and accumulated phase. */
  spin: number;
  phase: number;
  /** Impact / birth flash, decays. */
  flash: number;
  /** 0 alive; otherwise the timestamp its scattering began. */
  dyingAt: number;
  dx: number;
  dy: number;
};

type StoredWorld = {
  seed: number;
  latent: number[];
  born: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
};
type Stored = { worlds?: StoredWorld[]; cleared?: boolean; nextBorn?: number; lum?: number };

/** Three starters on circular orbits — alive before the room is touched. */
const STARTERS: Array<{ seed: number; held: number; r: number; th: number }> = [
  { seed: hashSeed(9, 11, 1), held: 1500, r: 0.17, th: 0.6 },
  { seed: hashSeed(9, 11, 2), held: 2600, r: 0.29, th: 3.1 },
  { seed: hashSeed(9, 11, 3), held: 900, r: 0.42, th: 4.9 },
];

let entryUid = 1;

/** What the shell's voice reaches, once the field is running. */
type ForgeApi = {
  tap: (e: { intensity: number; x: number; y: number; count?: number }) => void;
  stepBack: () => void;
  tutti: () => void;
  plant: (e: { x: number; y: number }) => void;
  deepen: (e: { elapsed: number; x: number; y: number }) => void;
  ceremony: () => void;
  timeScale: (k: number) => void;
  drag: (e: { fingers: number; phase: "start" | "move" | "end"; x: number; y: number; dx: number; dy: number }) => void;
  wind: (e: { dx: number; dy: number }) => void;
  flick: (e: { fingers: number; angle: number; speed: number; x: number; y: number }) => void;
  stir: (e: { winding: number; cx: number; cy: number }) => void;
  lens: (e: { velocity: number }) => void;
  season: (e: { velocity: number }) => void;
  rhythm: (e: { stability: number }) => void;
  drum: (e: { hits: number; alternation: number; x: number; y: number }) => void;
  scatter: (e: { intensity: number }) => void;
  gravity: (e: { beta: number; gamma: number }) => void;
  knock: () => void;
  night: (e: { faceDown: boolean }) => void;
  glimmer: () => void;
  reducedMotion: (r: boolean) => void;
  keyEnter: () => void;
  keyEnterHeld: (elapsed: number) => void;
  keyEscape: () => void;
  keyArrow: (dx: number, dy: number) => void;
  letGo: () => void;
};

export default function PlanetForge() {
  const glRef = useRef<HTMLCanvasElement | null>(null);
  const overRef = useRef<HTMLCanvasElement | null>(null);
  const apiRef = useRef<ForgeApi | null>(null);
  const [hasKept, setHasKept] = useState(false);

  useEffect(() => {
    const glCanvas = glRef.current;
    const over = overRef.current;
    if (!glCanvas || !over) return;

    const audio = getFieldAudio();
    let reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const stage: GLStage | null = createGLStage(glCanvas, {
      label: "planets",
      overlay: over,
      contextAttributes: { alpha: false, antialias: true, depth: false, premultipliedAlpha: true },
    });
    const gl = stage?.gl ?? null;
    const ctx = stage?.overlay2d ?? over.getContext("2d");
    if (!ctx) return;

    let bodyP: GLProgram | null = null;
    let ringP: GLProgram | null = null;
    let dustP: GLProgram | null = null;
    let starP: GLProgram | null = null;
    let bodyDraw: ReturnType<GLStage["instanced"]> | null = null;
    let ringDraw: ReturnType<GLStage["instanced"]> | null = null;
    let dustDraw: ReturnType<GLStage["instanced"]> | null = null;
    let starDraw: ReturnType<GLStage["instanced"]> | null = null;

    /** Instance capacity: worlds and their moons, in one set of buffers. */
    const CAP = MAX_WORLDS * (1 + 3) + 8;
    const cornerArr = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const geomArr = new Float32Array(CAP * 4);
    const p0Arr = new Float32Array(CAP * 4);
    const p1Arr = new Float32Array(CAP * 4);
    const p2Arr = new Float32Array(CAP * 4);
    const p3Arr = new Float32Array(CAP * 4);
    const dustArr = new Float32Array(DUST_N * 4);
    {
      const drng = mulberry32(hashSeed(0xd05, 0x7));
      for (let i = 0; i < DUST_N; i++) {
        dustArr[i * 4] = drng() * TAU;
        dustArr[i * 4 + 1] = 0.06 + Math.pow(drng(), 0.7) * 0.62;
        dustArr[i * 4 + 2] = drng() * TAU;
        dustArr[i * 4 + 3] = drng();
      }
    }

    if (stage && gl) {
      bodyP = stage.program(VERT_BODY, FRAG_BODY);
      ringP = stage.program(VERT_RING, FRAG_RING);
      dustP = stage.program(VERT_DUST, FRAG_DUST);
      starP = stage.program(VERT_STAR, FRAG_STAR);
      if (bodyP && ringP && dustP && starP) {
        bodyDraw = stage.instanced(bodyP);
        ringDraw = stage.instanced(ringP);
        dustDraw = stage.instanced(dustP);
        starDraw = stage.instanced(starP);
        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
      }
    }
    const glOk = !!(gl && stage && bodyP && ringP && dustP && starP);

    // ——— field ↔ screen (CSS pixels) ———
    const cssW = () => stage?.size.width ?? over.clientWidth ?? 1;
    const cssH = () => stage?.size.height ?? over.clientHeight ?? 1;
    const scale = () => Math.min(cssW(), cssH()) * FIELD_FRAC;
    const toPxX = (fx: number) => cssW() * 0.5 + (fx - 0.5) * scale();
    const toPxY = (fy: number) => cssH() * 0.5 + (fy - 0.5) * scale();
    const toFieldX = (px: number) => (px - cssW() * 0.5) / scale() + 0.5;
    const toFieldY = (py: number) => (py - cssH() * 0.5) / scale() + 0.5;
    const STAR = { x: 0.5, y: 0.5 };
    const fieldR = (w: World) => w.radius01 * WORLD_R_UNIT;

    // ——— state ———
    let entries: Entry[] = [];
    const dying: Entry[] = [];
    let nextBorn = 1;
    let cleared = false;
    let focusId = 0;
    let lensUp = false;
    let lensTurn = 0;
    let lum = 1;
    let seasonSpin = 0;
    let seasonRest = 0;
    let timeRate = 1;
    let nightVeil = 0;
    let nightNow = 0;
    let tiltX = 0;
    let tiltY = 0;
    let agitation = 0;
    let starFlash = 0;
    let worldTime = 0;
    let glimmerAt = 0;
    let climateAccum = 0;

    const reserve = () =>
      Math.max(0, DUST_TOTAL - entries.reduce((s, e) => s + massOf(e.world), 0));

    const save = () => {
      try {
        const payload: Stored = {
          worlds: entries.map((e) => ({
            seed: e.world.seed,
            latent: latentFromWorld(e.world),
            born: e.born,
            x: e.x,
            y: e.y,
            vx: e.vx,
            vy: e.vy,
            spin: e.spin,
          })),
          cleared,
          nextBorn,
          lum,
        };
        window.localStorage.setItem(STORE_KEY, JSON.stringify(payload));
      } catch {
        /* noop */
      }
      setHasKept(entries.length > 0);
    };

    const spinFor = (w: World) => TAU / (w.dayHours * DAY_SECONDS_PER_HOUR);

    const makeEntry = (
      world: World,
      born: number,
      x: number,
      y: number,
      vx: number,
      vy: number,
      spin?: number,
    ): Entry => ({
      id: entryUid++,
      born,
      world,
      x,
      y,
      vx,
      vy,
      spin: spin ?? spinFor(world),
      phase: 0,
      flash: 0,
      dyingAt: 0,
      dx: x,
      dy: y,
    });

    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Stored;
        cleared = parsed.cleared === true;
        nextBorn = typeof parsed.nextBorn === "number" ? parsed.nextBorn : 1;
        lum = typeof parsed.lum === "number" ? clamp(parsed.lum, 0.35, 2.6) : 1;
        if (Array.isArray(parsed.worlds)) {
          for (const s of parsed.worlds) {
            if (!Array.isArray(s.latent) || s.latent.length !== LATENT_DIM) continue;
            entries.push(
              makeEntry(worldFromLatent(s.latent, s.seed), s.born, s.x, s.y, s.vx, s.vy, s.spin),
            );
          }
          entries.sort((a, b) => a.born - b.born);
        }
      }
    } catch {
      /* a fresh sky */
    }
    if (entries.length === 0 && !cleared) {
      let dust = DUST_TOTAL;
      for (const st of STARTERS) {
        const f = forgeWorld(dust, st.seed, st.held);
        if (!f) break;
        dust = f.reserve;
        const v = circularSpeed(STAR_MU, st.r);
        entries.push(
          makeEntry(
            f.world,
            nextBorn++,
            STAR.x + Math.cos(st.th) * st.r,
            STAR.y + Math.sin(st.th) * st.r,
            -Math.sin(st.th) * v,
            Math.cos(st.th) * v,
          ),
        );
      }
      save();
    }
    setHasKept(entries.length > 0);

    // ——— placement and hit testing ———
    type Placed = { e: Entry; x: number; y: number; R: number; focus: number };
    const placeAll = (): Placed[] =>
      entries.map((e) => {
        const focus = e.id === focusId ? 1 : 0;
        return {
          e,
          x: toPxX(e.x) + tiltX * 6,
          y: toPxY(e.y) + tiltY * 6,
          R: fieldR(e.world) * scale() * (1 + focus * 0.4 + e.flash * 0.1),
          focus,
        };
      });

    const hitWorld = (x: number, y: number, reach = 1.6): Placed | null => {
      let best: Placed | null = null;
      let bestD = Infinity;
      for (const p of placeAll()) {
        const d = Math.hypot(x - p.x, y - p.y);
        if (d < Math.max(p.R * reach, 34) && d < bestD) {
          best = p;
          bestD = d;
        }
      }
      return best;
    };

    const focused = (): Entry | null => entries.find((e) => e.id === focusId) ?? null;
    const sayWorld = (e: Entry, octave = 24, hold = 260) => {
      worldChord(e.world).forEach((m, i) => audio.playNote(m + octave, hold + i * 60));
    };

    const retire = (e: Entry) => {
      e.dyingAt = performance.now();
      e.dx = e.x;
      e.dy = e.y;
      if (e.id === focusId) focusId = 0;
      dying.push(e);
      entries = entries.filter((o) => o.id !== e.id);
    };

    /**
     * Condense a world at a point and give it the circular orbit of the place
     * it was made — the dust it came from was already going that way.
     */
    const birthWorld = (fx: number, fy: number, heldMs: number): Entry | null => {
      const seed = hashSeed(Math.round(fx * 7919), Math.round(fy * 6007), nextBorn);
      const f = forgeWorld(reserve(), seed, heldMs);
      if (!f) {
        audio.refuse();
        haptics.chop();
        return null;
      }
      const dx = fx - STAR.x;
      const dy = fy - STAR.y;
      const d = Math.max(1e-6, Math.hypot(dx, dy));
      const r = Math.max(STAR_RADIUS * 1.6, d);
      const v = circularSpeed(STAR_MU, r);
      const e = makeEntry(
        f.world,
        nextBorn++,
        STAR.x + (dx / d) * r,
        STAR.y + (dy / d) * r,
        (-dy / d) * v,
        (dx / d) * v,
      );
      e.flash = 1;
      const kept = addWorld(entries, e);
      entries = kept.worlds;
      for (const old of kept.retired) retire(old);
      focusId = e.id;
      audio.bell();
      haptics.bloom();
      agitation = Math.min(1, agitation + 0.3);
      save();
      return e;
    };

    // ——— the hand ———
    let grabbed: { e: Entry; lastT: number } | null = null;
    /** The world condensing under a held finger; it grows while held. */
    let forging: {
      e: Entry | null;
      x: number;
      y: number;
      startAt: number;
      lastElapsed: number;
      lastToneAt: number;
    } | null = null;
    let stir: { x: number; y: number; life: number } | null = null;

    const api: ForgeApi = {
      tap: (ev) => {
        const tier = tapTrainTier(ev.count ?? 1);
        const depth = tapTrainDepth(ev.count ?? 1);
        const hit = hitWorld(ev.x, ev.y);
        if (tier === "n") {
          entries.forEach((e, i) => {
            worldChord(e.world).forEach((m) => audio.playNote(m + 12, 280 + i * 36));
            e.flash = Math.min(1, e.flash + 0.55 + depth * 0.2);
          });
          starFlash = Math.min(1, starFlash + 0.55 + depth * 0.2);
          agitation = Math.min(1, agitation + 0.35 + depth * 0.2);
          haptics.ripple(0.45 + depth * 0.2);
          return;
        }
        if (tier === 5) {
          if (hit) {
            focusId = hit.e.id;
            hit.e.flash = 1;
            sayWorld(hit.e);
            agitation = Math.min(1, agitation + 0.2 + depth * 0.15);
            haptics.bloom();
            return;
          }
          const born = birthWorld(toFieldX(ev.x), toFieldY(ev.y), 400 + depth * 900);
          if (born) {
            starFlash = Math.min(1, starFlash + 0.4);
            return;
          }
          stir = { x: ev.x, y: ev.y, life: 1 + depth };
          agitation = Math.min(1, agitation + 0.2);
          audio.playTone(90 + ev.intensity * 80, 0.18);
          haptics.tap();
          return;
        }
        if (tier === 3) {
          if (hit) {
            focusId = hit.e.id;
            hit.e.flash = Math.min(1, hit.e.flash + 0.85 + depth * 0.15);
            sayWorld(hit.e);
            starFlash = Math.min(1, starFlash + 0.25);
            haptics.ripple(0.35 + depth * 0.2);
            return;
          }
          focusId = 0;
          stir = { x: ev.x, y: ev.y, life: 1.2 + depth * 0.4 };
          agitation = Math.min(1, agitation + 0.15 + depth * 0.15);
          audio.playTone(80 + ev.intensity * 90, 0.16);
          haptics.ripple(0.3);
          return;
        }
        if (hit) {
          focusId = hit.e.id === focusId ? 0 : hit.e.id;
          hit.e.flash = Math.min(1, hit.e.flash + 0.6 + depth * 0.2);
          sayWorld(hit.e);
          haptics.tap();
          return;
        }
        // Never a dead touch: the dust answers where the finger landed.
        focusId = 0;
        stir = { x: ev.x, y: ev.y, life: 1 };
        audio.playTone(70 + ev.intensity * 70 * (1 + depth * 0.25), 0.14);
        haptics.tap();
      },
      stepBack: () => {
        if (!lensUp) return;
        lensUp = false;
        lensTurn = 0;
        over.setAttribute("data-lens-raised", "0");
        haptics.lens();
        audio.playNote(57, 260);
      },
      tutti: () => {
        entries.forEach((e, i) => {
          worldChord(e.world).forEach((m) => audio.playNote(m + 12, 300 + i * 40));
          e.flash = Math.min(1, e.flash + 0.5);
        });
        starFlash = Math.min(1, starFlash + 0.5);
        haptics.ripple(0.4);
        agitation = Math.min(1, agitation + 0.2);
      },
      plant: (ev) => {
        if (grabbed) return;
        const hit = hitWorld(ev.x, ev.y);
        forging = {
          e: hit ? hit.e : birthWorld(toFieldX(ev.x), toFieldY(ev.y), 0),
          x: ev.x,
          y: ev.y,
          startAt: performance.now(),
          lastElapsed: 0,
          lastToneAt: 0,
        };
        if (forging.e) focusId = forging.e.id;
      },
      deepen: (ev) => {
        if (!forging) return;
        // The hold IS the accretion: the bead grows along one continuous
        // curve of the held time and the tone climbs with it. Nothing here
        // fires the same at 900ms as at 2400ms.
        const now = performance.now();
        const u = 1 - Math.exp(-ev.elapsed / 1400);
        if (now - forging.lastToneAt > 340 - u * 200) {
          forging.lastToneAt = now;
          audio.playTone(64 + u * 150, 0.16);
          haptics.ripple(0.15 + u * 0.35);
        }
        const dMs = Math.max(0, ev.elapsed - forging.lastElapsed);
        forging.lastElapsed = ev.elapsed;
        forging.x = ev.x;
        forging.y = ev.y;
        const target = forging.e;
        if (!target || target.dyingAt) return;
        if (reserve() < MASS_MIN) {
          audio.refuse();
          return;
        }
        target.world = growWorld(target.world, reserve(), dMs).world;
      },
      ceremony: () => {
        // The forge's one solemn act: the world under the hand is finished —
        // it settles onto the exact circular orbit of where it stands.
        const e = forging?.e ?? focused();
        if (!e) return;
        const dx = e.x - STAR.x;
        const dy = e.y - STAR.y;
        const r = Math.max(1e-4, Math.hypot(dx, dy));
        const v = circularSpeed(STAR_MU, r);
        e.vx = (-dy / r) * v;
        e.vy = (dx / r) * v;
        e.flash = 1;
        audio.bell();
        haptics.bloom();
        save();
      },
      timeScale: (k) => {
        timeRate = clamp(k, 0.05, 4);
      },
      drag: (ev) => {
        if (ev.fingers !== 1) return;
        if (ev.phase === "start") {
          forging = null;
          const hit = hitWorld(ev.x, ev.y);
          if (hit) {
            grabbed = { e: hit.e, lastT: performance.now() };
            focusId = hit.e.id;
            haptics.tap();
            return;
          }
          stir = { x: ev.x, y: ev.y, life: 1 };
          return;
        }
        if (grabbed) {
          // One finger holds the body itself: it goes where the hand goes,
          // and the orbit it lands in decides what it becomes.
          const now = performance.now();
          const dt = Math.max(8, now - grabbed.lastT) / 1000;
          const nx = toFieldX(ev.x);
          const ny = toFieldY(ev.y);
          grabbed.e.vx = clamp((nx - grabbed.e.x) / dt, -0.22, 0.22);
          grabbed.e.vy = clamp((ny - grabbed.e.y) / dt, -0.22, 0.22);
          grabbed.e.x = nx;
          grabbed.e.y = ny;
          grabbed.lastT = now;
          const r = Math.hypot(nx - STAR.x, ny - STAR.y);
          audio.playTone(120 + temperature01(r, lum) * 220, 0.05);
          if (ev.phase === "end") {
            haptics.ripple(0.4);
            grabbed = null;
            save();
          }
          return;
        }
        // Empty space is never dead: the finger stirs the disc, and the
        // nearest worlds feel the wake of it.
        stir = { x: ev.x, y: ev.y, life: 1 };
        const fx = toFieldX(ev.x);
        const fy = toFieldY(ev.y);
        for (const e of entries) {
          const d = Math.hypot(e.x - fx, e.y - fy);
          if (d < 0.18) {
            const k = (1 - d / 0.18) * 0.00006;
            e.vx += ev.dx * k;
            e.vy += ev.dy * k;
          }
        }
        if (ev.phase === "end") save();
      },
      wind: (ev) => {
        // The world-law: sideways turns the star up and down and every
        // climate answers; up and down leans the axis of the focused world.
        if (Math.abs(ev.dx) > 0.01) {
          lum = clamp(lum + ev.dx * 0.004, 0.35, 2.6);
          audio.playTone(90 + lum * 70, 0.05);
        }
        if (Math.abs(ev.dy) > 0.01) {
          const f = focused();
          for (const e of f ? [f] : entries) e.world = tiltAxis(e.world, ev.dy * 0.0016);
        }
      },
      flick: (ev) => {
        if (ev.fingers !== 1) return;
        const hit = grabbed ? { e: grabbed.e } : hitWorld(ev.x, ev.y);
        grabbed = null;
        if (!hit) {
          agitation = Math.min(1, agitation + 0.25);
          audio.playTone(90, 0.16);
          return;
        }
        // A throw is a real throw; where it ends up is the hand's business.
        const sp = Math.min(0.42, ev.speed * 0.06);
        hit.e.vx += Math.cos(ev.angle) * sp;
        hit.e.vy += Math.sin(ev.angle) * sp;
        hit.e.spin += Math.cos(ev.angle) * ev.speed * 0.1;
        audio.playTone(120 + Math.min(1, ev.speed) * 180, 0.22);
        haptics.chop();
        save();
      },
      stir: (ev) => {
        // The finger circles AROUND a world, so reach generously.
        let hit: Placed | null = null;
        let bestD = Infinity;
        for (const p of placeAll()) {
          const d = Math.hypot(ev.cx - p.x, ev.cy - p.y);
          if (d < Math.max(p.R * 3, 120) && d < bestD) {
            hit = p;
            bestD = d;
          }
        }
        if (!hit) {
          agitation = Math.min(1, agitation + 0.1);
          return;
        }
        const before = hit.e.world.ring;
        hit.e.world = windRing(hit.e.world, -Math.sign(ev.winding) * 0.12);
        const after = hit.e.world.ring;
        if (before < RING_MIN !== after < RING_MIN) {
          haptics.detent();
          audio.chime();
        } else if (Math.abs(after - before) > 0.01) {
          audio.playTone(320 + after * 260, 0.06);
        }
        save();
      },
      lens: (ev) => {
        // The same dial in both registers: the focused world turns under the
        // hand, and enough accumulated turn raises the notation.
        const f = focused();
        if (f) f.spin += ev.velocity * 0.5;
        lensTurn += ev.velocity * 0.016;
        const wasUp = lensUp;
        lensUp = lensTurn > 0.5;
        if (lensUp !== wasUp) {
          haptics.lens();
          audio.playNote(lensUp ? 69 : 57, 260);
          over.setAttribute("data-lens-raised", lensUp ? "1" : "0");
        }
      },
      season: (ev) => {
        seasonSpin = clamp(ev.velocity * 8, -14, 14);
        window.clearTimeout(seasonRest);
        seasonRest = window.setTimeout(() => {
          seasonSpin = 0;
          audio.playNote(45, 400);
          haptics.detent();
          save();
        }, 220);
      },
      rhythm: (ev) => {
        if (ev.stability <= 0.7) return;
        agitation = Math.min(1, agitation + 0.08);
        starFlash = Math.min(1, starFlash + 0.2);
      },
      drum: (ev) => {
        agitation = Math.min(1, agitation + 0.12 * ev.alternation);
        stir = { x: ev.x, y: ev.y, life: 1 };
        audio.playTone(140 + ev.hits * 20, 0.08);
      },
      scatter: (ev) => {
        agitation = Math.min(1, agitation + ev.intensity);
        for (const e of entries) {
          const r = mulberry32(hashSeed(e.world.seed, Math.round(ev.intensity * 1000)));
          e.vx += (r() - 0.5) * ev.intensity * 0.05;
          e.vy += (r() - 0.5) * ev.intensity * 0.05;
          e.spin += (r() - 0.5) * ev.intensity * 1.2;
        }
        haptics.chop();
        audio.thud();
        save();
      },
      gravity: ({ beta, gamma }) => {
        tiltX = clamp(gamma / 45, -1, 1);
        tiltY = clamp((beta - 40) / 60, -1, 1);
      },
      knock: () => {
        const f = focused() ?? entries[entries.length - 1];
        if (!f) {
          starFlash = 1;
          audio.playNote(33, 600);
          return;
        }
        sayWorld(f, 12, 400);
        f.flash = 1;
        haptics.tap();
        agitation = Math.min(1, agitation + 0.25);
      },
      night: ({ faceDown }) => {
        nightVeil = faceDown ? 1 : 0;
      },
      glimmer: () => {
        glimmerAt = performance.now();
      },
      reducedMotion: (r) => {
        reduced = r;
      },
      keyEnter: () => {
        forging = {
          e: null,
          x: toPxX(0.5),
          y: toPxY(0.8),
          startAt: performance.now(),
          lastElapsed: 0,
          lastToneAt: 0,
        };
      },
      keyEnterHeld: (elapsed) => {
        if (!forging) return;
        if (!forging.e) forging.e = birthWorld(0.5, 0.8, 0);
        api.deepen({ elapsed, x: forging.x, y: forging.y });
      },
      keyEscape: () => {
        if (lensUp) api.stepBack();
        else focusId = 0;
      },
      keyArrow: (dx, dy) => {
        if (dx !== 0) {
          if (entries.length === 0) return;
          const idx = entries.findIndex((e) => e.id === focusId);
          const next = (idx + (dx > 0 ? 1 : -1) + entries.length * 2) % entries.length;
          focusId = entries[next].id;
          entries[next].flash = 1;
          sayWorld(entries[next], 24, 240);
          return;
        }
        const f = focused();
        if (!f) return;
        f.world = dy < 0 ? raiseLand(f.world, 0.04) : floodOcean(f.world, 0.04);
        audio.playTone(180 - f.world.ocean * 90, 0.1);
        haptics.tap();
        save();
      },
      letGo: () => {
        cleared = true;
        for (const e of [...entries]) retire(e);
        entries = [];
        focusId = 0;
        save();
      },
    };
    apiRef.current = api;

    // The two keys the shell's dialect does not carry: the star's brightness,
    // and letting one world — not the whole field — go.
    const onKeyDown = (ke: KeyboardEvent) => {
      const target = ke.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (ke.key === "[" || ke.key === "]") {
        lum = clamp(lum + (ke.key === "]" ? 0.12 : -0.12), 0.35, 2.6);
        audio.playTone(90 + lum * 70, 0.12);
        haptics.tap();
        save();
        ke.preventDefault();
      }
      if (ke.key === "Backspace" || ke.key === "Delete") {
        const f = focused();
        if (!f) return;
        retire(f);
        audio.thud();
        haptics.roll();
        save();
        ke.preventDefault();
      }
    };
    const onKeyUp = (ke: KeyboardEvent) => {
      if (ke.key === "Enter") forging = null;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    // ——— physics ———
    const bodies: Body[] = [];
    const stepPhysics = (dt: number) => {
      bodies.length = 0;
      for (const e of entries) {
        bodies.push({
          x: e.x,
          y: e.y,
          vx: e.vx,
          vy: e.vy,
          mass: massOf(e.world),
          radius: fieldR(e.world),
        });
      }
      // Device tilt is real gravity here: the whole field leans with it.
      const ax = tiltX * 0.0016;
      const ay = tiltY * 0.0016;
      const sub = dt / SUBSTEPS;
      for (let s = 0; s < SUBSTEPS; s++) stepBodies(bodies, sub, STAR_MU, STAR, ax, ay);
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (grabbed && grabbed.e === e) continue; // the hand overrides the law
        const b = bodies[i];
        e.x = b.x;
        e.y = b.y;
        e.vx = b.vx;
        e.vy = b.vy;
      }

      // The star eats what falls into it; the dark keeps what leaves. Either
      // way the mass comes back — the reserve is what the living do not hold.
      for (const e of [...entries]) {
        const r = Math.hypot(e.x - STAR.x, e.y - STAR.y);
        if (r < STAR_RADIUS + fieldR(e.world) * 0.4) {
          retire(e);
          audio.thud();
          audio.chime();
          haptics.storm();
          starFlash = 1;
          lum = clamp(lum + massOf(e.world) * 0.6, 0.35, 2.6);
          save();
        } else if (r > ESCAPE_R) {
          retire(e);
          audio.refuse();
          haptics.roll();
          save();
        }
      }

      // Collisions: two worlds become one, and what will not fit is ejected.
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          const a = entries[i];
          const b2 = entries[j];
          if (Math.hypot(a.x - b2.x, a.y - b2.y) > fieldR(a.world) + fieldR(b2.world)) continue;
          const ma = massOf(a.world);
          const mb = massOf(b2.world);
          const tot = ma + mb;
          const { world } = mergeWorlds(a.world, b2.world);
          const child = makeEntry(
            world,
            Math.min(a.born, b2.born),
            (a.x * ma + b2.x * mb) / tot,
            (a.y * ma + b2.y * mb) / tot,
            (a.vx * ma + b2.vx * mb) / tot,
            (a.vy * ma + b2.vy * mb) / tot,
            (a.spin * ma + b2.spin * mb) / tot,
          );
          child.flash = 1;
          const keepFocus = focusId === a.id || focusId === b2.id;
          retire(a);
          retire(b2);
          entries.push(child);
          entries.sort((x, y) => x.born - y.born);
          if (keepFocus) focusId = child.id;
          if (grabbed && (grabbed.e === a || grabbed.e === b2)) {
            grabbed = { e: child, lastT: performance.now() };
          }
          if (forging && (forging.e === a || forging.e === b2)) forging.e = child;
          audio.bell();
          audio.playTone(70, 0.4);
          haptics.storm();
          agitation = Math.min(1, agitation + 0.5);
          save();
          return; // one merger per frame; the next lands next frame
        }
      }
    };

    /** The orbit writes the surface: temperature, air, sea, ice, spin. */
    const settleField = (dt: number) => {
      for (const e of entries) {
        const r = Math.hypot(e.x - STAR.x, e.y - STAR.y);
        const temp = temperature01(r, lum);
        const keep = atmosphereRetention(massOf(e.world), temp);
        e.world = settleClimate(e.world, climateTarget(temp, keep), dt);
        const orbitW = Math.hypot(e.vx, e.vy) / Math.max(1e-4, r);
        e.spin = tidalSpin(e.spin, orbitW, r, dt);
      }
    };

    // ——— the frame ———
    let raf = 0;
    let lastNow = performance.now();

    /**
     * The no-GPU fallback. Not the room's real light — flat fills, one shadow
     * disc per world, no per-frame gradients — but alive, lit from the star,
     * and answering every gesture the shader path answers.
     */
    const drawFlatField = (placed: Placed[], t: number, W: number, H: number, S: number): void => {
      const cx = W * 0.5;
      const cy = H * 0.5;
      ctx.fillStyle = "#090b0e";
      ctx.fillRect(0, 0, W, H);
      const dust = mulberry32(hashSeed(0xd05, 0x7));
      const res01 = reserve() / DUST_TOTAL;
      for (let i = 0; i < 140; i++) {
        const a0 = dust() * TAU;
        const rr = 0.06 + Math.pow(dust(), 0.7) * 0.62;
        const ph = dust() * TAU;
        const bias = dust();
        const a = a0 + (reduced ? 0 : worldTime * 0.06) / Math.pow(rr, 1.5);
        const tw = 0.55 + 0.45 * Math.sin(t * (0.5 + bias) + ph);
        ctx.fillStyle = `rgba(242, 238, 230, ${((0.1 + res01 * 0.4) * tw * (0.25 + bias * 0.5)).toFixed(3)})`;
        ctx.fillRect(cx + Math.cos(a) * rr * S, cy + Math.sin(a) * rr * S * 0.86, 1.3, 1.3);
      }
      const starR = STAR_RADIUS * S * 0.9 * lum;
      for (let k = 4; k >= 0; k--) {
        ctx.beginPath();
        ctx.fillStyle = `rgba(200, 115, 42, ${0.1 + k * 0.04})`;
        ctx.arc(cx, cy, starR * (1 + k * 0.6), 0, TAU);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.fillStyle = "rgba(242, 238, 230, 0.95)";
      ctx.arc(cx, cy, starR * 0.5, 0, TAU);
      ctx.fill();
      for (const p of placed) {
        const col = worldColors(p.e.world);
        const base = col.landHi.map((c, i) => c + (col.seaShallow[i] - c) * p.e.world.ocean * 0.8);
        if (p.e.world.ring > RING_MIN) {
          ctx.beginPath();
          ctx.strokeStyle = `rgba(${col.ringCol.map((c) => c | 0).join(", ")}, 0.55)`;
          ctx.lineWidth = Math.max(1, p.R * 0.16);
          ctx.ellipse(p.x, p.y, p.R * 1.7, p.R * 0.55, -p.e.world.tiltRad * 0.8, 0, TAU);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.fillStyle = `rgb(${base.map((c) => c | 0).join(", ")})`;
        ctx.arc(p.x, p.y, p.R, 0, TAU);
        ctx.fill();
        const la = Math.atan2(p.y - cy, p.x - cx);
        ctx.save();
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.R, 0, TAU);
        ctx.clip();
        ctx.beginPath();
        ctx.fillStyle = "rgba(9, 11, 14, 0.72)";
        ctx.arc(p.x + Math.cos(la) * p.R * 0.85, p.y + Math.sin(la) * p.R * 0.85, p.R, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    };

    /** The latent, read back off the world — the inverse made visible. */
    const drawLens = (p: Placed): void => {
      const l = latentFromWorld(p.e.world);
      const base = p.R * 1.6;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.beginPath();
      ctx.strokeStyle = `rgba(242, 238, 230, ${p.focus ? 0.3 : 0.16})`;
      ctx.lineWidth = 1;
      ctx.arc(0, 0, base, 0, TAU);
      ctx.stroke();
      for (let i = 0; i < LATENT_DIM; i++) {
        const a = (i / LATENT_DIM) * TAU - Math.PI / 2;
        const len = base * (0.15 + l[i] * 0.55);
        const col = i === 1 ? "110, 160, 176" : i === 9 ? "221, 211, 190" : "242, 238, 230";
        ctx.beginPath();
        ctx.strokeStyle = `rgba(${col}, ${p.focus ? 0.65 : 0.28})`;
        ctx.lineWidth = p.focus ? 1.6 : 1;
        ctx.moveTo(Math.cos(a) * base, Math.sin(a) * base);
        ctx.lineTo(Math.cos(a) * (base + len), Math.sin(a) * (base + len));
        ctx.stroke();
        ctx.beginPath();
        ctx.fillStyle = `rgba(200, 115, 42, ${p.focus ? 0.8 : 0.4})`;
        ctx.arc(Math.cos(a) * (base + len), Math.sin(a) * (base + len), p.focus ? 2 : 1.2, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    };

    const draw = () => {
      const now = performance.now();
      const dtReal = Math.min(0.05, (now - lastNow) / 1000);
      lastNow = now;
      const t = audio.getAudioTime() ?? now / 1000;
      const clocks = clocksFrom({ time: t, turbulence: agitation, reducedMotion: reduced });
      const rate =
        timeRate * (1 - nightNow * 0.9) * (reduced ? 0.15 : 1) * (1 + Math.abs(seasonSpin));
      const dt = dtReal * rate;
      worldTime += dt;
      agitation *= 0.985;
      starFlash *= 0.94;
      nightNow += (nightVeil - nightNow) * 0.05;
      for (const e of entries) e.flash *= 0.93;
      if (stir) {
        stir.life -= dtReal * 1.6;
        if (stir.life <= 0) stir = null;
      }

      if (dt > 0) {
        stepPhysics(dt);
        climateAccum += dt;
        if (climateAccum > 0.2) {
          settleField(climateAccum);
          climateAccum = 0;
        }
        for (const e of entries) e.phase += e.spin * dt;
      }

      const size = stage ? stage.beginFrame(clocks, bodyP) : null;
      const W = cssW();
      const H = cssH();
      const S = scale();
      const cx = W * 0.5;
      const cy = H * 0.5;
      const ratio = size?.ratio ?? 1;
      const placed = placeAll();

      if (glOk && gl && size && bodyP && ringP && dustP && starP && bodyDraw && ringDraw && dustDraw && starDraw) {
        gl.clearColor(0.035, 0.043, 0.055, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        const pw = size.pixelWidth;
        const ph = size.pixelHeight;

        // Dust: the reserve made visible, shearing like a real disc.
        dustP.use();
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        dustDraw.attribute("a_dust", dustArr, 4, 0);
        dustP.setVec2("u_res", pw, ph);
        dustP.setVec2("u_centre", cx * ratio, cy * ratio);
        dustP.setFloat("u_scale", S * ratio);
        dustP.setFloat("u_time", reduced ? 0 : worldTime);
        dustP.setVec2("u_lean", tiltX * 8 * ratio, tiltY * 8 * ratio);
        dustP.setFloat("u_dpr", ratio);
        dustP.setFloat(
          "u_alpha",
          (0.12 + (reserve() / DUST_TOTAL) * 0.5 + agitation * 0.1) * (1 - nightNow * 0.75),
        );
        gl.drawArrays(gl.POINTS, 0, DUST_N);
        dustDraw.reset();

        // The star.
        starP.use();
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        starDraw.attribute("a_corner", cornerArr, 2, 0);
        starP.setVec2("u_res", pw, ph);
        starP.setVec2("u_centre", cx * ratio, cy * ratio);
        starP.setFloat("u_R", STAR_RADIUS * S * 5.5 * ratio);
        starP.setFloat("u_time", reduced ? 0 : t);
        starP.setFloat("u_lum", lum * (1 + starFlash * 0.8));
        starP.setFloat("u_night", nightNow);
        starP.setFloat("u_breath", clocks.breath);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        starDraw.reset();

        // Pack the instances: every world, then every moon it carries.
        let n = 0;
        const push = (
          px: number,
          py: number,
          R: number,
          w: World,
          spinPhase: number,
          ob: number,
          temp: number,
          focus: number,
          lightA: number,
          moonness: number,
          seedOff: number,
        ) => {
          if (n >= CAP) return;
          const o = n * 4;
          geomArr[o] = px * ratio;
          geomArr[o + 1] = py * ratio;
          geomArr[o + 2] = R * ratio;
          geomArr[o + 3] = 1;
          p0Arr[o] = w.ocean;
          p0Arr[o + 1] = w.terrainHue;
          p0Arr[o + 2] = w.relief;
          p0Arr[o + 3] = w.atmoHue;
          p1Arr[o] = w.atmoDepth;
          p1Arr[o + 1] = w.cloud;
          p1Arr[o + 2] = w.ice;
          p1Arr[o + 3] = w.ring;
          p2Arr[o] = w.tiltRad;
          p2Arr[o + 1] = spinPhase;
          p2Arr[o + 2] = ob;
          p2Arr[o + 3] = temp;
          p3Arr[o] = seedOff;
          p3Arr[o + 1] = focus;
          p3Arr[o + 2] = lightA;
          p3Arr[o + 3] = moonness;
          n++;
        };

        let worldCount = 0;
        for (const p of placed) {
          const e = p.e;
          const w = e.world;
          const r = Math.hypot(e.x - STAR.x, e.y - STAR.y);
          const temp = temperature01(r, lum);
          // The star lights from where it actually is.
          const lightA = Math.atan2(-(cy - p.y), cx - p.x);
          const ob = oblateness(e.spin, massOf(w));
          const seedOff = ((w.seed % 997) / 997) * 40;
          push(p.x, p.y, p.R, w, e.phase, ob, temp, p.focus, lightA, 0, seedOff);
          worldCount++;
          for (let mi = 0; mi < w.moons.length; mi++) {
            const m = w.moons[mi];
            const ma = m.phase + worldTime * m.speed * 0.5;
            push(
              p.x + Math.cos(ma) * p.R * m.dist,
              p.y + Math.sin(ma) * p.R * m.dist * 0.34 - p.R * 0.08,
              Math.max(1.6, p.R * m.size * 1.6),
              w,
              ma * 0.5,
              0,
              temp,
              0,
              lightA,
              1,
              seedOff + 7.3 + mi,
            );
          }
        }

        if (n > 0) {
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          const ringPass = (half: number) => {
            ringP.use();
            ringDraw.attribute("a_corner", cornerArr, 2, 0);
            ringDraw.attribute("a_geom", geomArr.subarray(0, worldCount * 4), 4, 1);
            ringDraw.attribute("a_p1", p1Arr.subarray(0, worldCount * 4), 4, 1);
            ringDraw.attribute("a_p2", p2Arr.subarray(0, worldCount * 4), 4, 1);
            ringDraw.attribute("a_p3", p3Arr.subarray(0, worldCount * 4), 4, 1);
            ringP.setVec2("u_res", pw, ph);
            ringP.setFloat("u_pad", 3);
            ringP.setFloat("u_half", half);
            ringP.setFloat("u_night", nightNow);
            ringDraw.draw(gl.TRIANGLE_STRIP, 4, worldCount);
            ringDraw.reset();
          };
          ringPass(-1);

          bodyP.use();
          bodyDraw.attribute("a_corner", cornerArr, 2, 0);
          bodyDraw.attribute("a_geom", geomArr.subarray(0, n * 4), 4, 1);
          bodyDraw.attribute("a_p0", p0Arr.subarray(0, n * 4), 4, 1);
          bodyDraw.attribute("a_p1", p1Arr.subarray(0, n * 4), 4, 1);
          bodyDraw.attribute("a_p2", p2Arr.subarray(0, n * 4), 4, 1);
          bodyDraw.attribute("a_p3", p3Arr.subarray(0, n * 4), 4, 1);
          bodyP.setVec2("u_res", pw, ph);
          bodyP.setFloat("u_pad", 1.42);
          bodyP.setFloat("u_time", reduced ? 0 : worldTime);
          bodyP.setFloat("u_night", nightNow);
          bodyP.setFloat("u_breath", clocks.breath);
          bodyDraw.draw(gl.TRIANGLE_STRIP, 4, n);
          bodyDraw.reset();

          ringPass(1);
        }
      }

      // ——— the overlay: only what the hand is doing right now ———
      ctx.clearRect(0, 0, W, H);
      if (!glOk) drawFlatField(placed, t, W, H, S);
      if (lensUp) for (const p of placed) drawLens(p);

      // Scattering: a retired world goes back to dust in front of you.
      for (let i = dying.length - 1; i >= 0; i--) {
        const e = dying[i];
        const u = (now - e.dyingAt) / (reduced ? 500 : RETIRE_MS);
        if (u >= 1) {
          dying.splice(i, 1);
          continue;
        }
        const px = toPxX(e.dx);
        const py = toPxY(e.dy);
        const R = fieldR(e.world) * S;
        const rng = mulberry32(e.world.seed);
        ctx.fillStyle = `rgba(242, 238, 230, ${((1 - u) * 0.6).toFixed(3)})`;
        for (let k = 0; k < 26; k++) {
          const a = rng() * TAU;
          const rr = R * (0.4 + rng() * 0.8) + u * (40 + rng() * 90);
          ctx.fillRect(px + Math.cos(a) * rr, py + Math.sin(a) * rr, 1.4, 1.4);
        }
      }

      // The accretion swirl: held time gathering dust into a bead.
      if (forging) {
        const held = now - forging.startAt;
        const u = 1 - Math.exp(-held / 1400);
        const target = forging.e ? placed.find((pp) => pp.e === forging?.e) : null;
        const ax = target ? target.x : forging.x;
        const ay = target ? target.y : forging.y;
        const swirlR = lerp(64, 18, u) + (target ? target.R : 0);
        const rng = mulberry32(hashSeed(Math.round(forging.x), Math.round(forging.y)));
        for (let k = 0; k < 30; k++) {
          const a0 = rng() * TAU;
          const sp = 0.6 + rng() * 0.9;
          const a = a0 + (reduced ? held / 900 : worldTime * 3) * sp + u * 4;
          const rr = swirlR * (0.35 + rng() * 0.95) * (1 - u * 0.45);
          ctx.fillStyle = `rgba(${(228 - rng() * 30) | 0}, ${(200 - rng() * 60) | 0}, ${(170 - rng() * 90) | 0}, ${(0.25 + u * 0.5).toFixed(3)})`;
          ctx.fillRect(ax + Math.cos(a) * rr, ay + Math.sin(a) * rr * 0.72, 1.5, 1.5);
        }
        if (!target && reserve() >= MASS_MIN) {
          ctx.beginPath();
          ctx.strokeStyle = `rgba(242, 238, 230, ${(0.2 + u * 0.45).toFixed(3)})`;
          ctx.lineWidth = 1;
          ctx.arc(ax, ay, Math.max(2, WORLD_R_UNIT * S * accretionRadius(held) * u), 0, TAU);
          ctx.stroke();
        }
      }

      // A stirred place in the dust — the answer to a touch that hit nothing.
      if (stir) {
        const u = 1 - stir.life;
        const rng = mulberry32(hashSeed(Math.round(stir.x), Math.round(stir.y), 3));
        ctx.fillStyle = `rgba(242, 238, 230, ${(stir.life * 0.45).toFixed(3)})`;
        for (let k = 0; k < 12; k++) {
          const a = rng() * TAU + u * 3;
          const rr = 10 + u * 46 * (0.4 + rng());
          ctx.fillRect(stir.x + Math.cos(a) * rr, stir.y + Math.sin(a) * rr * 0.7, 1.3, 1.3);
        }
      }

      // The glimmer the shell's idle clock asks for: dust whispers a spiral
      // where a hold would land. Physical, never text.
      if (glimmerAt && now - glimmerAt < 2000) {
        const u = (now - glimmerAt) / 2000;
        const gx = cx;
        const gy = cy + S * 0.3;
        ctx.fillStyle = `rgba(242, 238, 230, ${(0.3 * (1 - u)).toFixed(3)})`;
        for (let k = 0; k < 12; k++) {
          const a = k * 0.63 + u * 5;
          const rr = 38 * (1 - u) * (0.3 + k / 12);
          ctx.fillRect(gx + Math.cos(a) * rr, gy + Math.sin(a) * rr * 0.7, 1.3, 1.3);
        }
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.clearTimeout(seasonRest);
      apiRef.current = null;
      save();
      stage?.dispose();
    };
  }, []);

  const voice = useMemo<RoomVoice>(
    () => ({
      tap: (e) => apiRef.current?.tap(e),
      stepBack: () => apiRef.current?.stepBack(),
      tutti: () => apiRef.current?.tutti(),
      plant: (e) => apiRef.current?.plant(e),
      deepen: (e) => apiRef.current?.deepen(e),
      ceremony: () => apiRef.current?.ceremony(),
      timeScale: (k) => apiRef.current?.timeScale(k),
      drag: (e) => apiRef.current?.drag(e),
      wind: (e) => apiRef.current?.wind(e),
      flick: (e) => apiRef.current?.flick(e),
      stir: (e) => apiRef.current?.stir(e),
      lens: (e) => apiRef.current?.lens(e),
      season: (e) => apiRef.current?.season(e),
      rhythm: (e) => apiRef.current?.rhythm(e),
      drum: (e) => apiRef.current?.drum(e),
      scatter: (e) => apiRef.current?.scatter(e),
      gravity: (e) => apiRef.current?.gravity(e),
      knock: () => apiRef.current?.knock(),
      night: (e) => apiRef.current?.night(e),
    }),
    [],
  );

  const letGo = useCallback(() => {
    setHasKept(false);
    getFieldAudio().thud();
    haptics.roll();
    apiRef.current?.letGo();
  }, []);

  return (
    <RoomShell
      route="/planets"
      voice={voice}
      surfaceRef={overRef as React.RefObject<HTMLElement | null>}
      keyboard={{
        enter: () => apiRef.current?.keyEnter(),
        enterHeld: (ms) => apiRef.current?.keyEnterHeld(ms),
        escape: () => apiRef.current?.keyEscape(),
        arrow: (dx, dy) => apiRef.current?.keyArrow(dx, dy),
      }}
      onGlimmer={() => apiRef.current?.glimmer()}
      onReducedMotion={(r) => apiRef.current?.reducedMotion(r)}
      letGo={{ label: "return the worlds to dust", onLetGo: letGo, visible: hasKept }}
      style={{ position: "fixed", inset: 0, background: "#090b0e", overflow: "hidden" }}
    >
      <canvas
        ref={glRef}
        aria-hidden
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
      <canvas
        ref={overRef}
        role="application"
        tabIndex={0}
        aria-label="a star, a budget of dust, and the worlds condensed out of it"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
          outline: "none",
        }}
      />
    </RoomShell>
  );
}
