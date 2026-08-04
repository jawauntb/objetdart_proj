"use client";

/**
 * /space — the web that holds the light. The space band at ~10¹⁷–10²² m,
 * between the stars below and the fold above
 * (docs/plans/life-and-vista-bands.md §2).
 *
 * The invariant is a dark-matter density field (src/lib/cosmicweb.ts). The
 * galaxies are not placed and then explained: they exist exactly where the
 * invisible field stands above a threshold, so the sky you can see is a
 * measurement of the one you cannot. Their shapes are the same reading
 * taken again — ellipticals in the cluster knots, spirals along the
 * filaments, ragged irregulars out at the void's edge — and their voices
 * are the reading taken a third time, spread across the 55 Hz register the
 * scale axis assigns s = 20, a heavier well ringing lower.
 *
 * Alive at rest: the web drifts on minute-long clocks, the light breathes,
 * and a nova burns somewhere about once a minute whether or not anyone is
 * watching — the same nova, in the same second, in every visit to this
 * seed. One finger parallaxes the volume; hold on a galaxy and it comes
 * into resolution — arms, then star systems — and holding past that is the
 * way down to /stars. A circling finger rolls the sky. Twist raises the
 * lens onto the skeleton itself: knots and filaments, the geometry under
 * the light.
 *
 * Three fingers are the room's argument. They lift the veil, and the dark
 * matter every galaxy has been sitting in all along becomes visible: the
 * thing doing the work was never the thing you could see. Three-finger
 * drag slices deeper into it, three-finger twist runs structure formation
 * backwards until the sky empties and only the dark matter is left, three
 * fingers held dilate the clock. Tilt leans the volume, a shake stirs
 * peculiar velocities, a knock rings the nearest knot, face-down is night
 * — and at night the galaxies go out and the web stays.
 *
 * Raw WebGL: one context, one rAF, two draws — a fullscreen ray march
 * through the density field as a 64³ volume (a hard step budget, declared
 * at compile time), and one instanced pass for the whole galaxy
 * population out of typed arrays. No textures on disk, no assets, no
 * dependencies; the Hubble palette is the site's own tokens.
 *
 * Resolved galaxies persist in `objetdart:space:v1` with the quiet clear at
 * the bottom. Pinch is unbound — ScaleTravel owns it.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { tapTrainDepth, tapTrainTier } from "@/lib/gesture/core";
import { onVessel } from "@/lib/vessel";
import { stirTurbulence } from "@/lib/turbulence";
import { SCALE_BANDS, entryScaleInto } from "@/lib/scale";
import LetGo from "@/components/LetGo";
import {
  resolveDpr,
  onGalleryPause,
  onVisibility,
  isEmbeddedFrame,
  createFrameGovernor,
} from "@/lib/room-runtime";
import {
  DENSITY_GRID,
  DENSITY_THRESHOLD,
  GROWTH_MAX,
  GROWTH_MIN,
  HALO_SCALE,
  NOVA_LIFE_SEC,
  NOVA_TICK_SEC,
  WEB_LFO_HZ,
  WEB_MEAN_DENSITY,
  activeNovae,
  buildDensityGrid,
  buildWeb,
  grownDensity,
  hashSeed,
  isLit,
  mulberry32,
  novaBrightness,
  placeGalaxies,
  subBassMidiFor,
  type Galaxy,
} from "@/lib/cosmicweb";

/** One seed, one universe — the same one every visit, for everybody. */
const UNIVERSE_SEED = 0x5eed;
const STORE_KEY = "objetdart:space:v1";
const SCALE_S_KEY = "objetdart:scale:s";
/** How many resolved galaxies the room carries; oldest retired first. */
const MAX_RESOLVED = 24;
/** Atlas geometry: 64 slices of 64×64 laid out 8×8 in one 512×512 texture. */
const ATLAS_TILES = 8;

/** The ray marcher's budget, decided before it was written. */
const STEPS_WIDE = 22;
const STEPS_NARROW = 14;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);

type Stored = { resolved?: number[]; cleared?: boolean };

const VERT_QUAD = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

/** The volume pass: the invisible field, marched. */
const FRAG_VOLUME = (steps: number) => `
precision highp float;
uniform vec2 u_res;
uniform vec3 u_cam, u_right, u_up, u_fwd;
uniform float u_focal, u_aspect, u_veil, u_growth, u_night, u_breath, u_lens, u_time;
uniform sampler2D u_vol;

const float G = ${DENSITY_GRID}.0;
const float T = ${ATLAS_TILES}.0;

// One texture, two fields: the luminous density in .r, the dark-matter
// halo — the same skeleton smoothed far wider — in .a.
vec2 sliceAt(vec2 xy, float s) {
  float tx = mod(s, T);
  float ty = floor(s / T);
  vec2 c = clamp(xy, 0.5 / G, 1.0 - 0.5 / G);
  return texture2D(u_vol, (vec2(tx, ty) + c) / T).ra;
}

vec2 vol(vec3 p) {
  if (p.x < 0.0 || p.y < 0.0 || p.z < 0.0) return vec2(0.0);
  if (p.x > 1.0 || p.y > 1.0 || p.z > 1.0) return vec2(0.0);
  float f = clamp(p.z * G - 0.5, 0.0, G - 1.0);
  float z0 = floor(f);
  float z1 = min(z0 + 1.0, G - 1.0);
  return mix(sliceAt(p.xy, z0), sliceAt(p.xy, z1), f - z0);
}

float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

void main() {
  vec2 ndc = (gl_FragCoord.xy / u_res) * 2.0 - 1.0;
  vec3 rd = normalize(u_fwd * u_focal + u_right * (ndc.x * u_aspect) + u_up * ndc.y);
  vec3 ro = u_cam;

  // the void's own colour: not black, the way deep sky is not black
  float vig = 1.0 - 0.42 * dot(ndc, ndc);
  vec3 col = vec3(0.014, 0.017, 0.026) * vig
           + vec3(0.010, 0.016, 0.030) * (0.5 + 0.5 * u_breath) * max(0.0, vig);

  vec3 inv = 1.0 / rd;
  vec3 ta = (vec3(0.0) - ro) * inv;
  vec3 tb = (vec3(1.0) - ro) * inv;
  vec3 tmin = min(ta, tb);
  vec3 tmax = max(ta, tb);
  float tn = max(max(tmin.x, tmin.y), max(tmin.z, 0.0));
  float tf = min(min(tmax.x, tmax.y), tmax.z);

  if (tf > tn) {
    float dt = (tf - tn) / ${steps}.0;
    float jit = hash12(gl_FragCoord.xy + u_time) * dt;
    vec3 warm = vec3(0.784, 0.451, 0.165);   // --candle
    vec3 pale = vec3(0.949, 0.933, 0.902);   // --paper
    vec3 dark = vec3(0.30, 0.48, 0.92);      // the cold light of what is not light
    vec3 acc = vec3(0.0);
    for (int i = 0; i < ${steps}; i++) {
      float t = tn + jit + float(i) * dt;
      if (t > tf) break;
      vec3 p = ro + rd * t;
      vec2 v = vol(p);
      float d = v.x;
      float halo = v.y;
      float g = clamp(${WEB_MEAN_DENSITY} + (d - ${WEB_MEAN_DENSITY}) * u_growth, 0.0, 1.0);
      // The invisible, made visible only while three fingers are down.
      // It is read from the HALO field, not the luminous one: the same
      // skeleton smoothed far wider, so what appears is unmistakably
      // larger than anything that was ever glowing in it.
      if (halo > 0.0 && u_veil > 0.0) {
        float h = clamp(${WEB_MEAN_DENSITY} + (halo - ${WEB_MEAN_DENSITY}) * u_growth, 0.0, 1.0);
        acc += dark * (0.05 + h * h * 3.6) * u_veil * dt * (1.05 + 0.4 * u_breath);
      }
      if (d <= 0.0) continue;
      // The nebulae: warm emission from the gas that traces the densest
      // filament cores, brightest near the eye — the near end of the band,
      // where a cloud is still a cloud rather than a strand.
      float near = 0.35 + 0.65 * exp(-t * 1.6);
      float gas = smoothstep(0.54, 0.86, g) * near;
      acc += mix(warm, pale, g * 0.42) * gas * dt * (2.3 + 0.8 * u_breath) * (1.0 - 0.75 * u_veil);
    }
    col += acc * (1.0 - 0.45 * u_night) * (1.0 - 0.3 * u_lens);
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

/** The galaxy pass: one instanced draw over the whole population. */
const VERT_GALAXY = `
attribute vec2 a_corner;
attribute vec3 a_gpos;
attribute vec4 a_meta;   // density, size, tilt, spin
attribute vec4 a_meta2;  // morph, arms, wind, hue
attribute vec2 a_dyn;    // nova brightness, resolution level
uniform vec3 u_cam, u_right, u_up, u_fwd;
uniform float u_focal, u_aspect, u_growth, u_thresh, u_breath, u_night, u_veil, u_fit;
varying vec2 v_uv;
varying vec4 v_meta;
varying vec4 v_meta2;
varying vec2 v_dyn;
varying float v_bright;

void main() {
  float grown = clamp(${WEB_MEAN_DENSITY} + (a_meta.x - ${WEB_MEAN_DENSITY}) * u_growth, 0.0, 1.0);
  vec3 rel = a_gpos - u_cam;
  float zc = dot(rel, u_fwd);
  if (grown <= u_thresh || zc < 0.035) {
    // unlit in this season, or behind the eye: park it off screen
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    v_uv = vec2(0.0);
    v_meta = a_meta;
    v_meta2 = a_meta2;
    v_dyn = a_dyn;
    v_bright = 0.0;
    return;
  }
  vec2 sp = vec2(dot(rel, u_right), dot(rel, u_up)) * u_focal / zc;
  float extent = (0.010 + 0.022 * a_meta.y + 0.032 * grown)
               * (1.0 + 3.4 * a_dyn.y + 1.7 * a_dyn.x);
  // NOT scaled by u_fit, and capped well inside clip space. A tall frame
  // stands the camera further back; a galaxy that keeps its angular size
  // while the camera retreats means more of the web crowded into the same
  // pixels, and at 390px the filaments merged into grey continents. Letting
  // zc alone set the size is both the honest perspective and what keeps a
  // void looking like a void on a phone.
  float r = min(extent / zc, 0.42);
  vec2 off = a_corner * r;
  gl_Position = vec4((sp.x + off.x) / u_aspect, sp.y + off.y, 0.0, 1.0);
  v_uv = a_corner;
  v_meta = vec4(grown, a_meta.y, a_meta.z, a_meta.w);
  v_meta2 = a_meta2;
  v_dyn = a_dyn;
  // near things are brighter, but never blinding; the breath rides on top
  v_bright = (1.0 + 4.4 * grown) / (0.75 + zc * 0.9)
           * (0.82 + 0.18 * u_breath) * (1.0 - 0.88 * u_night) * (1.0 - 0.85 * u_veil)
           // compensate for the further stand-off on a tall frame, but BOUND
           // it: scaling exposure by the raw fit washed 390px out to a sheet
           * clamp(u_fit, 0.9, 1.12)
           * (1.0 + 2.4 * a_dyn.x);
}
`;

const FRAG_GALAXY = `
precision highp float;
varying vec2 v_uv;
varying vec4 v_meta;
varying vec4 v_meta2;
varying vec2 v_dyn;
varying float v_bright;

float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

void main() {
  if (v_bright <= 0.0) discard;
  float spin = v_meta.w;
  float s = sin(spin);
  float c = cos(spin);
  vec2 q = vec2(v_uv.x * c - v_uv.y * s, v_uv.x * s + v_uv.y * c);
  // an inclined disc is a thin one
  q.y *= mix(1.0, 4.6, v_meta.z);
  float rad = length(q);
  if (rad > 1.0) discard;

  float morph = v_meta2.x;
  float arms = v_meta2.y;
  float wind = v_meta2.z;
  float detail = v_dyn.y;
  float i = 0.0;

  if (morph < 0.5) {
    // spiral: a bulge, a disc, and arms that tighten as you resolve them
    float a = atan(q.y, q.x);
    float w = cos(arms * (a + wind * log(rad + 0.07)));
    float sharp = mix(0.5, 0.92, detail);
    float arm = (1.0 - sharp) + sharp * smoothstep(-0.2, 0.95, w);
    i = exp(-24.0 * rad * rad) * 1.5 + exp(-4.2 * rad) * arm * 0.85;
  } else if (morph < 1.5) {
    // elliptical: no structure to resolve, only more of the same light
    i = exp(-5.2 * rad) * 0.7 + exp(-30.0 * rad * rad) * 1.5;
  } else {
    // irregular: knots of star formation, no disc at all
    vec2 n = q * 3.1 + v_meta2.w * 31.0;
    float lump = hash12(floor(n)) * 0.6 + hash12(floor(n * 1.9) + 5.0) * 0.4;
    i = exp(-3.6 * rad) * (0.28 + 1.15 * lump);
  }
  i *= smoothstep(1.0, 0.18, rad);

  // resolution's far end: the disc breaks into its own star systems
  if (detail > 0.5) {
    vec2 sp = q * 11.0 + v_meta2.w * 17.0;
    vec2 cell = floor(sp);
    float h = hash12(cell);
    vec2 o = fract(sp) - 0.5 - 0.34 * (vec2(hash12(cell + 3.1), hash12(cell + 7.7)) - 0.5);
    float star = smoothstep(0.16, 0.0, length(o)) * step(0.62, h);
    i += star * (detail - 0.5) * 2.4 * smoothstep(1.0, 0.15, rad);
  }

  vec3 warm = vec3(0.96, 0.44, 0.13);   // --candle, opened up
  vec3 pale = vec3(0.949, 0.933, 0.902); // --paper
  vec3 gold = vec3(0.93, 0.72, 0.33);    // --kept, opened up
  vec3 cold = vec3(0.32, 0.56, 0.98);
  vec3 tint;
  // a spiral's disc is young and blue, an elliptical is old and gold, an
  // irregular is all star formation — the palette IS the population
  if (morph < 0.5) tint = mix(cold, warm, 0.10 + 0.28 * v_meta2.w);
  else if (morph < 1.5) tint = mix(gold, warm, 0.08 + 0.22 * v_meta2.w);
  else tint = mix(warm, cold, 0.18 + 0.42 * v_meta2.w);
  // the core is always whiter than the halo, but only the very core
  tint = mix(tint, pale, smoothstep(0.14, 0.0, rad) * 0.85);

  gl_FragColor = vec4(tint * i * v_bright, 1.0);
}
`;

export default function DeepSpaceWeb() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const [hasKept, setHasKept] = useState(false);
  const [lensUp, setLensUp] = useState(false);
  const resolvedRef = useRef<number[]>([]);
  const router = useRouter();

  useEffect(() => {
    const wrap = wrapRef.current;
    const glCanvas = glCanvasRef.current;
    const overlay = overlayRef.current;
    if (!wrap || !glCanvas || !overlay) return;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;

    const audio = getFieldAudio();
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = mq.matches;
    const onMq = () => {
      reduced = mq.matches;
    };
    mq.addEventListener?.("change", onMq);

    // ——— the universe, built once ———
    const web = buildWeb(UNIVERSE_SEED);
    const grid = buildDensityGrid(web, DENSITY_GRID);
    // ...and the halo it sits in: the same skeleton, smoothed far wider.
    const halo = buildDensityGrid(web, DENSITY_GRID, HALO_SCALE);
    const galaxies: Galaxy[] = placeGalaxies(web, UNIVERSE_SEED);
    const count = galaxies.length;

    // ——— persistence ———
    // The universe itself is never stored: it is a pure function of one
    // seed, so it comes back identical without being remembered. What the
    // room keeps is the trail — which galaxies a hand has pulled into
    // resolution.
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Stored;
        if (Array.isArray(parsed.resolved)) {
          resolvedRef.current = parsed.resolved
            .filter((n) => Number.isFinite(n))
            .slice(-MAX_RESOLVED);
        }
      }
    } catch {
      /* a first sky */
    }
    setHasKept(resolvedRef.current.length > 0);
    const resolvedSet = new Set(resolvedRef.current);
    const save = () => {
      try {
        window.localStorage.setItem(
          STORE_KEY,
          JSON.stringify({ resolved: resolvedRef.current, cleared: resolvedRef.current.length === 0 }),
        );
      } catch {
        /* noop */
      }
      setHasKept(resolvedRef.current.length > 0);
    };

    // ——— state ———
    let width = 0;
    let height = 0;
    let rectLeft = 0;
    let rectTop = 0;
    let raf = 0;
    let last = performance.now();
    let localT = 0;
    let timeScale = 1;
    let timeScaleTarget = 1;
    /** the world-law: how much of the invisible is showing */
    let veil = 0;
    let veilTarget = 0;
    /** the season: linear structure growth, 1 = now */
    let growth = 1;
    let growthTarget = 1;
    let lens = 0;
    let lensTarget = 0;
    let lensSnapped = 0;
    /** the hand's parallax, in box units, plus its momentum */
    let panX = 0;
    let panY = 0;
    let panVX = 0;
    let panVY = 0;
    let roll = 0;
    let rollVel = 0;
    let tiltX = 0;
    let tiltY = 0;
    let night = 0;
    let nightTarget = 0;
    let stir = 0;
    let leaving = 0;
    let entering = 1;
    let selIdx = -1;
    let holdIdx = -1;
    let resolveLevel = 0;
    let resolveTarget = 0;
    let kbCharge = 0;
    let travelling = false;
    let lastInteractionAt = performance.now();
    let glimmer = 0;
    let glimmerAt = 0;
    let lastVeilVoiceAt = 0;
    let lastNovaTick = -1;

    // ——— typed arrays: the whole population, uploaded once ———
    const posArr = new Float32Array(count * 3);
    const metaArr = new Float32Array(count * 4);
    const meta2Arr = new Float32Array(count * 4);
    const dynArr = new Float32Array(count * 2);
    const flare = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const g = galaxies[i];
      posArr[i * 3] = g.x;
      posArr[i * 3 + 1] = g.y;
      posArr[i * 3 + 2] = g.z;
      metaArr[i * 4] = g.density;
      metaArr[i * 4 + 1] = g.latent.size;
      metaArr[i * 4 + 2] = g.latent.tilt;
      metaArr[i * 4 + 3] = g.latent.spin;
      meta2Arr[i * 4] = g.morph === "spiral" ? 0 : g.morph === "elliptical" ? 1 : 2;
      meta2Arr[i * 4 + 1] = g.latent.arms;
      meta2Arr[i * 4 + 2] = g.latent.wind;
      meta2Arr[i * 4 + 3] = g.latent.hue;
      // a galaxy you once resolved keeps a little of its resolution
      dynArr[i * 2 + 1] = resolvedSet.has(g.id) ? 0.22 : 0;
    }

    // Foreground stars: our own galaxy standing between the eye and the
    // web, the way it does in every real exposure of deep field. Fixed to
    // the frame, deterministic, and they twinkle on the shared breath.
    const FOREGROUND = 150;
    const near = new Float32Array(FOREGROUND * 4);
    {
      const rng = mulberry32(hashSeed(UNIVERSE_SEED, 0xf03e));
      for (let i = 0; i < FOREGROUND; i++) {
        near[i * 4] = rng();
        near[i * 4 + 1] = rng();
        near[i * 4 + 2] = 0.25 + rng() * rng() * 1.5;
        near[i * 4 + 3] = rng() * Math.PI * 2;
      }
    }

    // ——— the camera ———
    const cam = { x: 0.5, y: 0.5, z: 0.08 };
    const basis = {
      rx: 1,
      ry: 0,
      rz: 0,
      ux: 0,
      uy: 1,
      uz: 0,
      fx: 0,
      fy: 0,
      fz: 1,
    };
    const FOCAL = 1.2;
    /** Standing distance on a landscape frame; narrow frames step back. */
    const BASE_RANGE = 0.96;
    /** How much the frame made us step back — galaxies grow back by it, so
     *  a phone shows the same web at the same apparent size. */
    let fitScale = 1;
    let aspect = 1;

    const setBasis = (yaw: number, pitch: number, rollA: number) => {
      const cp = Math.cos(pitch);
      const fx = Math.sin(yaw) * cp;
      const fy = Math.sin(pitch);
      const fz = Math.cos(yaw) * cp;
      // right = normalize(fwd × worldUp) — with worldUp = +y this is stable
      let rx = fz;
      let ry = 0;
      let rz = -fx;
      const rn = Math.hypot(rx, ry, rz) || 1;
      rx /= rn;
      ry /= rn;
      rz /= rn;
      // up = right × fwd
      let ux = ry * fz - rz * fy;
      let uy = rz * fx - rx * fz;
      let uz = rx * fy - ry * fx;
      const un = Math.hypot(ux, uy, uz) || 1;
      ux /= un;
      uy /= un;
      uz /= un;
      const cr = Math.cos(rollA);
      const sr = Math.sin(rollA);
      basis.rx = rx * cr + ux * sr;
      basis.ry = ry * cr + uy * sr;
      basis.rz = rz * cr + uz * sr;
      basis.ux = ux * cr - rx * sr;
      basis.uy = uy * cr - ry * sr;
      basis.uz = uz * cr - rz * sr;
      basis.fx = fx;
      basis.fy = fy;
      basis.fz = fz;
    };
    setBasis(0, 0, 0);

    /** Screen position of a point in the box, or null if it is behind us. */
    const project = (x: number, y: number, z: number) => {
      const dx = x - cam.x;
      const dy = y - cam.y;
      const dz = z - cam.z;
      const zc = dx * basis.fx + dy * basis.fy + dz * basis.fz;
      if (zc < 0.035) return null;
      const sx = (dx * basis.rx + dy * basis.ry + dz * basis.rz) * FOCAL / zc;
      const sy = (dx * basis.ux + dy * basis.uy + dz * basis.uz) * FOCAL / zc;
      return {
        x: (sx / aspect * 0.5 + 0.5) * width,
        y: (0.5 - sy * 0.5) * height,
        z: zc,
      };
    };

    /** Which galaxy is under this point, or -1. Lit ones only. */
    const galaxyAt = (px: number, py: number): number => {
      let best = -1;
      let bestD = 44 * 44;
      for (let i = 0; i < count; i++) {
        if (!isLit(galaxies[i].density, growth, DENSITY_THRESHOLD)) continue;
        const p = project(posArr[i * 3], posArr[i * 3 + 1], posArr[i * 3 + 2]);
        if (!p) continue;
        const dx = p.x - px;
        const dy = p.y - py;
        const d2 = dx * dx + dy * dy;
        // nearer galaxies win ties — the one you meant is the one in front
        if (d2 < bestD) {
          bestD = d2;
          best = i;
        }
      }
      return best;
    };

    // ——— sound: the field, heard ———
    const soundGalaxy = (i: number, ms = 900, gain = 1) => {
      if (i < 0 || i >= count) return;
      const g = grownDensity(galaxies[i].density, growth);
      try {
        audio.playNote(Math.round(subBassMidiFor(g)), Math.round(ms * gain));
      } catch {
        /* the sea is not awake */
      }
      flare[i] = Math.max(flare[i], 0.35 * gain);
    };

    /** The tutti: the sky states itself, low to high, in one sweep. */
    const tutti = () => {
      const lit: number[] = [];
      for (let i = 0; i < count; i++) {
        if (isLit(galaxies[i].density, growth, DENSITY_THRESHOLD)) lit.push(i);
      }
      lit.sort((a, b) => galaxies[b].density - galaxies[a].density);
      const take = Math.min(9, lit.length);
      for (let k = 0; k < take; k++) {
        const i = lit[Math.floor((k / Math.max(1, take)) * lit.length)];
        window.setTimeout(() => soundGalaxy(i, 700), k * 110);
      }
      try {
        haptics.ripple(0.45);
      } catch {
        /* noop */
      }
    };

    const setLens = (snapped: number) => {
      if (snapped === lensSnapped) return;
      lensSnapped = snapped;
      lensTarget = snapped;
      setLensUp(snapped === 1);
      try {
        haptics.lens();
        if (snapped === 1) audio.chime();
        else audio.playNote(29, 420);
      } catch {
        /* noop */
      }
    };

    /** The veil answers in three senses at once, or it has not landed. */
    const voiceVeil = (now: number) => {
      if (now - lastVeilVoiceAt < 2100) return;
      lastVeilVoiceAt = now;
      try {
        audio.playNote(Math.round(subBassMidiFor(0.92)), 2400);
        haptics.roll();
      } catch {
        /* noop */
      }
    };

    /** The way down: a galaxy resolved all the way IS its star systems. */
    const descendToStars = () => {
      if (travelling) return;
      travelling = true;
      leaving = 1;
      const band = SCALE_BANDS.find((b) => b.id === "stars");
      try {
        haptics.crossing();
      } catch {
        /* noop */
      }
      try {
        if (band) window.sessionStorage.setItem(SCALE_S_KEY, String(entryScaleInto(band, -1)));
      } catch {
        /* noop */
      }
      try {
        audio.bell();
      } catch {
        /* noop */
      }
      window.setTimeout(() => router.push("/stars"), 420);
    };

    const markResolved = (i: number) => {
      if (i < 0 || i >= count) return;
      const id = galaxies[i].id;
      if (resolvedSet.has(id)) return;
      resolvedSet.add(id);
      resolvedRef.current.push(id);
      if (resolvedRef.current.length > MAX_RESOLVED) {
        const gone = resolvedRef.current.shift();
        if (gone !== undefined) resolvedSet.delete(gone);
      }
      save();
    };

    // ——— performance contract (room-runtime) ———
    const gov = createFrameGovernor();
    let sleeping = false;
    let galleryPaused = false;

    // ——— geometry ———
    const dpr = () => resolveDpr(gov.tier(), { embedded: isEmbeddedFrame(), reducedMotion: reduced, maxDpr: 1.5 });
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const ratio = dpr();
      width = Math.max(240, r.width);
      height = Math.max(320, r.height);
      rectLeft = r.left;
      rectTop = r.top;
      aspect = width / height;
      glCanvas.width = Math.round(width * ratio);
      glCanvas.height = Math.round(height * ratio);
      overlay.width = Math.round(width * ratio);
      overlay.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    const toLocal = (cx: number, cy: number) => ({
      x: clamp(cx - rectLeft, 0, width),
      y: clamp(cy - rectTop, 0, height),
    });

    // ——— WebGL ———
    const glOpts: WebGLContextAttributes = { antialias: false, alpha: false, depth: false };
    const gl2 = glCanvas.getContext("webgl2", glOpts) as WebGL2RenderingContext | null;
    const gl = (gl2 ??
      glCanvas.getContext("webgl", glOpts) ??
      glCanvas.getContext("experimental-webgl" as "webgl", glOpts)) as WebGLRenderingContext | null;
    const angle = !gl2 && gl ? gl.getExtension("ANGLE_instanced_arrays") : null;
    let glOk = false;
    let volProg: WebGLProgram | null = null;
    let galProg: WebGLProgram | null = null;
    let quadBuf: WebGLBuffer | null = null;
    let cornerBuf: WebGLBuffer | null = null;
    let posBuf: WebGLBuffer | null = null;
    let metaBuf: WebGLBuffer | null = null;
    let meta2Buf: WebGLBuffer | null = null;
    let dynBuf: WebGLBuffer | null = null;
    let volTex: WebGLTexture | null = null;
    type Uni = Record<string, WebGLUniformLocation | null>;
    let volU: Uni = {};
    let galU: Uni = {};
    let galA: Record<string, number> = {};

    const divisor = (loc: number, d: number) => {
      if (gl2) gl2.vertexAttribDivisor(loc, d);
      else angle?.vertexAttribDivisorANGLE(loc, d);
    };
    const drawInstanced = (verts: number, instances: number) => {
      if (gl2) gl2.drawArraysInstanced(gl2.TRIANGLE_STRIP, 0, verts, instances);
      else angle?.drawArraysInstancedANGLE(gl!.TRIANGLE_STRIP, 0, verts, instances);
    };

    // The GL setup below (programs, buffers, texture) is wrapped in a
    // function so `webglcontextrestored` can rebuild it in place — mobile
    // GPUs reclaim contexts on backgrounding, and this room previously had
    // no recovery path at all.
    const teardownGL = () => {
      if (!gl) return;
      for (const b of [quadBuf, cornerBuf, posBuf, metaBuf, meta2Buf, dynBuf]) {
        if (b) gl.deleteBuffer(b);
      }
      if (volTex) gl.deleteTexture(volTex);
      if (volProg) gl.deleteProgram(volProg);
      if (galProg) gl.deleteProgram(galProg);
      quadBuf = cornerBuf = posBuf = metaBuf = meta2Buf = dynBuf = null;
      volTex = null;
      volProg = null;
      galProg = null;
      glOk = false;
    };

    const initGL = () => {
      if (gl && (gl2 || angle)) {
      const compile = (type: number, src: string) => {
        const sh = gl.createShader(type);
        if (!sh) return null;
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
          gl.deleteShader(sh);
          return null;
        }
        return sh;
      };
      const link = (vs: string, fs: string) => {
        const v = compile(gl.VERTEX_SHADER, vs);
        const f = compile(gl.FRAGMENT_SHADER, fs);
        if (!v || !f) return null;
        const p = gl.createProgram();
        if (!p) return null;
        gl.attachShader(p, v);
        gl.attachShader(p, f);
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
        return p;
      };
      const steps = Math.min(window.innerWidth, window.innerHeight) < 520 ? STEPS_NARROW : STEPS_WIDE;
      volProg = link(VERT_QUAD, FRAG_VOLUME(steps));
      galProg = link(VERT_GALAXY, FRAG_GALAXY);
      if (volProg && galProg) {
        glOk = true;
        quadBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

        cornerBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

        const mk = (data: Float32Array, usage: number) => {
          const b = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, b);
          gl.bufferData(gl.ARRAY_BUFFER, data, usage);
          return b;
        };
        posBuf = mk(posArr, gl.STATIC_DRAW);
        metaBuf = mk(metaArr, gl.STATIC_DRAW);
        meta2Buf = mk(meta2Arr, gl.STATIC_DRAW);
        dynBuf = mk(dynArr, gl.DYNAMIC_DRAW);

        // Both fields as one 64³ volume, packed 8×8 into a single texture:
        // luminance carries the luminous density, alpha the halo.
        const side = DENSITY_GRID * ATLAS_TILES;
        const bytes = new Uint8Array(side * side * 2);
        for (let z = 0; z < DENSITY_GRID; z++) {
          const tx = (z % ATLAS_TILES) * DENSITY_GRID;
          const ty = Math.floor(z / ATLAS_TILES) * DENSITY_GRID;
          for (let y = 0; y < DENSITY_GRID; y++) {
            for (let x = 0; x < DENSITY_GRID; x++) {
              const k = (z * DENSITY_GRID + y) * DENSITY_GRID + x;
              const o = ((ty + y) * side + (tx + x)) * 2;
              bytes[o] = Math.round(clamp01(grid[k]) * 255);
              bytes[o + 1] = Math.round(clamp01(halo[k]) * 255);
            }
          }
        }
        volTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, volTex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.LUMINANCE_ALPHA,
          side,
          side,
          0,
          gl.LUMINANCE_ALPHA,
          gl.UNSIGNED_BYTE,
          bytes,
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        const uni = (p: WebGLProgram, names: string[]) => {
          const out: Uni = {};
          for (const n of names) out[n] = gl.getUniformLocation(p, n);
          return out;
        };
        volU = uni(volProg, [
          "u_res", "u_cam", "u_right", "u_up", "u_fwd", "u_focal", "u_aspect",
          "u_veil", "u_growth", "u_night", "u_breath", "u_lens", "u_time", "u_vol",
        ]);
        galU = uni(galProg, [
          "u_cam", "u_right", "u_up", "u_fwd", "u_focal", "u_aspect",
          "u_growth", "u_thresh", "u_breath", "u_night", "u_veil", "u_fit",
        ]);
        galA = {
          corner: gl.getAttribLocation(galProg, "a_corner"),
          gpos: gl.getAttribLocation(galProg, "a_gpos"),
          meta: gl.getAttribLocation(galProg, "a_meta"),
          meta2: gl.getAttribLocation(galProg, "a_meta2"),
          dyn: gl.getAttribLocation(galProg, "a_dyn"),
        };
      }
      }
    };
    initGL();

    const onGlLost = (ev: Event) => {
      ev.preventDefault();
      glOk = false;
    };
    const onGlRestored = () => {
      teardownGL();
      initGL();
    };
    glCanvas.addEventListener("webglcontextlost", onGlLost, false);
    glCanvas.addEventListener("webglcontextrestored", onGlRestored, false);

    // ——— the grammar ———
    const detachGestures = attachGestures(
      wrap,
      {
        tap: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 2) return; // ScaleTravel's step back
          if (e.fingers === 3) {
            tutti();
            return;
          }
          if (e.fingers !== 1) return;
          const { x, y } = toLocal(e.x, e.y);
          // rapid-tap ladder: ring → neighbor flare → veil peek → web tutti
          const tier = tapTrainTier(e.count);
          const depth = tapTrainDepth(e.count);
          const i = galaxyAt(x, y);
          if (tier === "n") {
            tutti();
            stirTurbulence(0.1 + depth * 0.08);
            return;
          }
          if (tier === 5) {
            veilTarget = Math.min(0.42, 0.22 + depth * 0.2);
            voiceVeil(performance.now());
            if (i >= 0) {
              selIdx = i;
              soundGalaxy(i, 900 + Math.round(e.intensity * 600), 1.1 + depth * 0.3);
              flare[i] = Math.max(flare[i], 0.45 + e.intensity * 0.4);
              if (depth > 0.55) markResolved(i);
            } else {
              stirTurbulence(0.08 + depth * 0.06);
              try {
                audio.playNote(22, 1100);
                haptics.roll();
              } catch {
                /* noop */
              }
            }
            return;
          }
          if (tier === 3) {
            if (i >= 0) {
              selIdx = i;
              soundGalaxy(i, 800 + Math.round(e.intensity * 700), 1 + depth * 0.25);
              flare[i] = Math.max(flare[i], 0.35 + e.intensity * 0.45);
              // neighbors along the filament answer with it
              for (let k = 0; k < count; k++) {
                if (k === i) continue;
                if (!isLit(galaxies[k].density, growth, DENSITY_THRESHOLD)) continue;
                const dx = galaxies[k].x - galaxies[i].x;
                const dy = galaxies[k].y - galaxies[i].y;
                const dz = galaxies[k].z - galaxies[i].z;
                if (dx * dx + dy * dy + dz * dz < 0.085) {
                  flare[k] = Math.max(flare[k], 0.2 + depth * 0.25);
                  window.setTimeout(() => soundGalaxy(k, 520), 80 + Math.round(depth * 60));
                }
              }
              try {
                haptics.ripple(0.35 + depth * 0.2);
              } catch {
                /* noop */
              }
              return;
            }
            stirTurbulence(0.06 + depth * 0.05);
            try {
              audio.playNote(26, 800);
              haptics.tap();
            } catch {
              /* noop */
            }
            return;
          }
          if (i >= 0) {
            selIdx = i;
            soundGalaxy(i, 700 + Math.round(e.intensity * 700 * (1 + depth * 0.3)));
            flare[i] = Math.max(flare[i], 0.25 + e.intensity * 0.4 + depth * 0.2);
            try {
              haptics.tap();
            } catch {
              /* noop */
            }
            return;
          }
          // open void: the whole web answers once, very low and very soft
          stirTurbulence(0.04 + depth * 0.03);
          try {
            audio.playNote(24, 900);
            haptics.tap();
          } catch {
            /* noop */
          }
        },
        hold: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 3) {
            // the law: the invisible shows itself, and the clock stretches
            if (e.phase === "enter") {
              veilTarget = 0.55;
              timeScaleTarget = 0.28;
              voiceVeil(performance.now());
              try {
                haptics.detent();
              } catch {
                /* noop */
              }
            }
            if (e.phase === "tick") {
              // duration is an axis: the longer three fingers stay down the
              // deeper into the halo you see
              veilTarget = clamp(0.55 + e.elapsed / 5200, 0, 1);
              voiceVeil(performance.now());
            }
            if (e.phase === "release") {
              timeScaleTarget = 1;
              // it lingers: you are meant to have seen it
              veilTarget = 0;
            }
            return;
          }
          if (e.fingers !== 1) return;
          if (e.phase === "enter") {
            const { x, y } = toLocal(e.x, e.y);
            holdIdx = galaxyAt(x, y);
            if (holdIdx >= 0) {
              selIdx = holdIdx;
              resolveTarget = 0.1;
              soundGalaxy(holdIdx, 500, 0.7);
            }
            return;
          }
          if (e.phase === "release") {
            if (resolveLevel > 0.45 && holdIdx >= 0) markResolved(holdIdx);
            holdIdx = -1;
            resolveTarget = 0;
            return;
          }
          if (holdIdx < 0) return;
          // A hold keeps deepening: arms by the dwell tier, star systems by
          // the ceremony, and past that the systems ARE the sky below.
          resolveTarget = clamp01(e.elapsed / 2600);
          if (e.tier >= 2 && resolveLevel > 0.3 && resolveLevel < 0.36) {
            soundGalaxy(holdIdx, 900, 1.1);
            try {
              haptics.ripple(0.4);
            } catch {
              /* noop */
            }
          }
          if (e.elapsed > 3300) descendToStars();
        },
        drag: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 3) {
            // the law layer, dragged: how deep into the halo the veil cuts
            veilTarget = clamp01(veilTarget + e.dx * 0.0022);
            growthTarget = clamp(growthTarget - e.dy * 0.0018, GROWTH_MIN, GROWTH_MAX);
            return;
          }
          if (e.fingers !== 1) return;
          if (e.phase === "end") {
            panVX += e.vx * 0.0004;
            panVY += e.vy * 0.0004;
            return;
          }
          // one finger parallaxes the volume: the near web slides over the far
          panX = clamp(panX - (e.dx / Math.max(1, width)) * 1.4, -0.8, 0.8);
          panY = clamp(panY + (e.dy / Math.max(1, height)) * 1.0, -0.55, 0.55);
        },
        flick: (e) => {
          lastInteractionAt = performance.now();
          panVX += -Math.cos(e.angle) * (e.speed / 9000);
          panVY += Math.sin(e.angle) * (e.speed / 9000);
          try {
            haptics.ripple(0.3);
          } catch {
            /* noop */
          }
        },
        twist: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 3) {
            // three fingers turn the season: structure formation, by hand
            growthTarget = clamp(growthTarget + e.angle * 0.55, GROWTH_MIN, GROWTH_MAX);
            return;
          }
          if (e.phase === "move") lensTarget = clamp01(lensTarget + e.angle / 1.7);
          else if (e.phase === "end") setLens(lensTarget > 0.5 ? 1 : 0);
        },
        scrub: (e) => {
          lastInteractionAt = performance.now();
          // a circling hand rolls the sky about the line of sight
          rollVel += e.angularVelocity * 0.02;
        },
        pan2: (e) => {
          lastInteractionAt = performance.now();
          // two fingers pan the frame — the same parallax one finger already
          // gives the volume, addressed at the map layer instead of the material
          panX = clamp(panX - (e.dx / Math.max(1, width)) * 1.4, -0.8, 0.8);
          panY = clamp(panY + (e.dy / Math.max(1, height)) * 1.0, -0.55, 0.55);
        },
        rhythm: (e) => {
          if (e.stability > 0.68) tutti();
        },
      },
      { wheelZoom: false },
    );

    // ——— the vessel ———
    const detachVessel = onVessel({
      tilt: ({ beta, gamma }) => {
        if (reduced) return;
        tiltX = clamp(gamma / 45, -1, 1);
        tiltY = clamp((beta - 45) / 60, -1, 1);
      },
      shake: ({ intensity }) => {
        if (reduced) return;
        lastInteractionAt = performance.now();
        // peculiar velocities: the web jitters against its own gravity
        stir = clamp01(stir + 0.4 + intensity * 0.5);
        stirTurbulence(0.2 + intensity * 0.3);
        try {
          audio.playNote(26, 700);
          haptics.chop();
        } catch {
          /* noop */
        }
      },
      knock: () => {
        if (reduced) return;
        lastInteractionAt = performance.now();
        // the nearest knot answers — the densest thing in front of you
        let best = -1;
        let bestD = -1;
        for (let i = 0; i < count; i++) {
          if (!isLit(galaxies[i].density, growth, DENSITY_THRESHOLD)) continue;
          const p = project(posArr[i * 3], posArr[i * 3 + 1], posArr[i * 3 + 2]);
          if (!p) continue;
          const score = galaxies[i].density / (0.4 + p.z);
          if (score > bestD) {
            bestD = score;
            best = i;
          }
        }
        if (best >= 0) {
          soundGalaxy(best, 1400, 1.2);
          flare[best] = Math.max(flare[best], 0.7);
        }
        try {
          audio.thud();
          haptics.detent();
        } catch {
          /* noop */
        }
      },
      flip: ({ faceDown }) => {
        // night: the galaxies go out, and the web is still there
        nightTarget = faceDown ? 1 : 0;
        if (faceDown) veilTarget = Math.max(veilTarget, 0.5);
      },
    });

    // ——— keyboard ———
    const litIndices = () => {
      const out: number[] = [];
      for (let i = 0; i < count; i++) {
        if (isLit(galaxies[i].density, growth, DENSITY_THRESHOLD)) out.push(i);
      }
      return out;
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        if (lensSnapped === 1) setLens(0);
        veilTarget = 0;
        selIdx = -1;
        holdIdx = -1;
        resolveTarget = 0;
        kbCharge = 0;
        return;
      }
      if (ev.key === "ArrowRight" || ev.key === "ArrowLeft" || ev.key === "ArrowUp" || ev.key === "ArrowDown") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        const lit = litIndices();
        if (lit.length === 0) return;
        const dir = ev.key === "ArrowRight" || ev.key === "ArrowDown" ? 1 : -1;
        const at = lit.indexOf(selIdx);
        selIdx = lit[(((at < 0 ? 0 : at + dir) % lit.length) + lit.length) % lit.length];
        soundGalaxy(selIdx, 520);
        return;
      }
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        if (!ev.repeat) {
          if (selIdx < 0) {
            const lit = litIndices();
            if (lit.length === 0) return;
            selIdx = lit[0];
          }
          holdIdx = selIdx;
          soundGalaxy(selIdx, 800);
          kbCharge = 0.06;
          resolveTarget = 0.1;
          return;
        }
        // held Enter is the keyboard's long press — the same slow road down
        kbCharge = clamp(kbCharge + 0.035, 0, 1.25);
        resolveTarget = clamp01(kbCharge);
        if (kbCharge >= 1.2) descendToStars();
      }
      if (ev.key === "v" || ev.key === "V") {
        // the keyboard's three fingers: nothing is only reachable by touch
        lastInteractionAt = performance.now();
        veilTarget = veilTarget > 0.05 ? 0 : 0.85;
        if (veilTarget > 0) voiceVeil(performance.now());
      }
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " ") {
        if (resolveLevel > 0.45 && holdIdx >= 0) markResolved(holdIdx);
        kbCharge = 0;
        resolveTarget = 0;
        holdIdx = -1;
      }
    };
    wrap.addEventListener("keydown", onKeyDown);
    wrap.addEventListener("keyup", onKeyUp);

    // ——— the loop ———
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      gov.beginFrame(now);
      if (sleeping || galleryPaused) return; // no draw while hidden or embedded-paused
      const delta = Math.min(64, now - last);
      last = now;
      const dt = delta / 1000;

      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dt * 5);
      if (!reduced) localT += dt * timeScale;
      veil += (veilTarget - veil) * Math.min(1, dt * (veilTarget > veil ? 3.4 : 0.9));
      growth += (growthTarget - growth) * Math.min(1, dt * 2.4);
      lens += (lensTarget - lens) * Math.min(1, dt * 6);
      night += (nightTarget - night) * Math.min(1, dt * 1.6);
      resolveLevel += (resolveTarget - resolveLevel) * Math.min(1, dt * 4);
      stir = Math.max(0, stir - dt * 0.5);
      roll += rollVel * dt;
      rollVel *= Math.exp(-dt * 1.6);
      panX = clamp(panX + panVX * dt * 60 * 0.02, -0.8, 0.8);
      panY = clamp(panY + panVY * dt * 60 * 0.02, -0.55, 0.55);
      panVX *= Math.exp(-dt * 1.1);
      panVY *= Math.exp(-dt * 1.1);
      if (entering > 0) entering = Math.max(0, entering - dt * 0.7);
      if (leaving > 0) leaving = Math.min(1, leaving + dt * 2);
      if (glimmer > 0) glimmer = Math.max(0, glimmer - dt * 0.55);
      for (let i = 0; i < count; i++) {
        if (flare[i] > 0) flare[i] = Math.max(0, flare[i] - dt * 0.9);
      }

      const t = audio.getAudioTime() ?? now / 1000;
      const breath = reduced ? 0.5 : Math.sin(t * Math.PI * 2 * 0.14) * 0.5 + 0.5;
      // the band's own breath: one swell every ~48 seconds, per the register
      const slow = reduced ? 0.5 : Math.sin(t * Math.PI * 2 * WEB_LFO_HZ) * 0.5 + 0.5;

      // ——— the web drifts, always ———
      // The eye stands off the volume and turns slowly around it, so the
      // filaments and the voids between them read as the structure they
      // are; the near web sweeps across the far one, which is what makes
      // it three-dimensional to a hand that only moved sideways. Every
      // clock here is minute-long, per the register this band sounds in.
      const T = reduced ? 0 : localT;
      const yaw = (reduced ? 0 : 0.42 * Math.sin(T * 0.013)) + panX * 1.4 + tiltX * 0.22;
      const pitch = clamp(
        (reduced ? 0 : 0.2 * Math.sin(T * 0.019)) - panY * 1.1 + tiltY * 0.16,
        -1.1,
        1.1,
      );
      setBasis(yaw, pitch, roll + (reduced ? 0 : 0.05 * Math.sin(T * 0.011)));
      // Stand far enough off that the whole web is inside the frame — on a
      // tall phone that means further back, or the voids fall off the sides
      // and a web reads as a haze.
      const fit = Math.max(BASE_RANGE, (0.62 * FOCAL) / Math.max(0.4, aspect));
      fitScale = fit / BASE_RANGE;
      const range = fit + (reduced ? 0 : 0.18 * fit * Math.sin(T * 0.017));
      const tx = 0.5 + (reduced ? 0 : 0.05 * Math.sin(T * 0.031));
      const ty = 0.5 + (reduced ? 0 : 0.04 * Math.cos(T * 0.023));
      cam.x = tx - basis.fx * range;
      cam.y = ty - basis.fy * range;
      cam.z = 0.5 - basis.fz * range;

      // ——— novae: rare, deterministic, and heard when they happen ———
      const live = activeNovae(UNIVERSE_SEED, t, count);
      for (let i = 0; i < count; i++) dynArr[i * 2] = 0;
      for (const n of live) {
        const b = novaBrightness(n.age, n.strength);
        const i = n.galaxy;
        if (i < count) dynArr[i * 2] = Math.max(dynArr[i * 2], b);
        const tick = Math.round((t - n.age) / NOVA_TICK_SEC);
        if (n.age < 0.4 && tick !== lastNovaTick) {
          lastNovaTick = tick;
          try {
            audio.playNote(Math.round(subBassMidiFor(0.15)), 1600);
            audio.bell();
            haptics.bloom();
          } catch {
            /* noop */
          }
        }
      }
      for (let i = 0; i < count; i++) {
        dynArr[i * 2] = Math.max(dynArr[i * 2], flare[i]);
        const base = resolvedSet.has(galaxies[i].id) ? 0.22 : 0;
        const focus = i === holdIdx || (i === selIdx && resolveLevel > 0.02) ? resolveLevel : 0;
        // a shaken web jitters, then settles back into its own gravity
        const jitter = stir > 0 ? stir * 0.25 * Math.sin(localT * 9 + i) : 0;
        dynArr[i * 2 + 1] = clamp01(Math.max(base, focus) + jitter * 0.3);
      }

      // ——— glimmer: after ~20s the invisible shows for a moment ———
      if (now - lastInteractionAt > 20000 && now - glimmerAt > 11000 && !reduced) {
        glimmerAt = now;
        glimmer = 1;
      }
      const shownVeil = clamp01(veil + glimmer * 0.1);

      // ——— render: the volume, then the light ———
      if (glOk && gl && volProg && galProg) {
        const ratio = dpr();
        gl.viewport(0, 0, glCanvas.width, glCanvas.height);
        gl.disable(gl.BLEND);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(volProg);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        const aq = gl.getAttribLocation(volProg, "a_pos");
        gl.enableVertexAttribArray(aq);
        gl.vertexAttribPointer(aq, 2, gl.FLOAT, false, 0, 0);
        divisor(aq, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, volTex);
        gl.uniform1i(volU.u_vol ?? null, 0);
        gl.uniform2f(volU.u_res ?? null, width * ratio, height * ratio);
        gl.uniform3f(volU.u_cam ?? null, cam.x, cam.y, cam.z);
        gl.uniform3f(volU.u_right ?? null, basis.rx, basis.ry, basis.rz);
        gl.uniform3f(volU.u_up ?? null, basis.ux, basis.uy, basis.uz);
        gl.uniform3f(volU.u_fwd ?? null, basis.fx, basis.fy, basis.fz);
        gl.uniform1f(volU.u_focal ?? null, FOCAL);
        gl.uniform1f(volU.u_aspect ?? null, aspect);
        gl.uniform1f(volU.u_veil ?? null, shownVeil);
        gl.uniform1f(volU.u_growth ?? null, growth);
        gl.uniform1f(volU.u_night ?? null, night);
        gl.uniform1f(volU.u_breath ?? null, 0.35 * breath + 0.65 * slow);
        gl.uniform1f(volU.u_lens ?? null, lens);
        gl.uniform1f(volU.u_time ?? null, (t % 600) * 0.37);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.disableVertexAttribArray(aq);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(galProg);
        gl.bindBuffer(gl.ARRAY_BUFFER, dynBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, dynArr);
        const bind = (buf: WebGLBuffer | null, loc: number, size: number, div: number) => {
          if (loc < 0) return;
          gl.bindBuffer(gl.ARRAY_BUFFER, buf);
          gl.enableVertexAttribArray(loc);
          gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
          divisor(loc, div);
        };
        bind(cornerBuf, galA.corner, 2, 0);
        bind(posBuf, galA.gpos, 3, 1);
        bind(metaBuf, galA.meta, 4, 1);
        bind(meta2Buf, galA.meta2, 4, 1);
        bind(dynBuf, galA.dyn, 2, 1);
        gl.uniform3f(galU.u_cam ?? null, cam.x, cam.y, cam.z);
        gl.uniform3f(galU.u_right ?? null, basis.rx, basis.ry, basis.rz);
        gl.uniform3f(galU.u_up ?? null, basis.ux, basis.uy, basis.uz);
        gl.uniform3f(galU.u_fwd ?? null, basis.fx, basis.fy, basis.fz);
        gl.uniform1f(galU.u_focal ?? null, FOCAL);
        gl.uniform1f(galU.u_aspect ?? null, aspect);
        gl.uniform1f(galU.u_growth ?? null, growth);
        gl.uniform1f(galU.u_thresh ?? null, DENSITY_THRESHOLD);
        gl.uniform1f(galU.u_breath ?? null, breath);
        gl.uniform1f(galU.u_night ?? null, night);
        gl.uniform1f(galU.u_veil ?? null, shownVeil);
        gl.uniform1f(galU.u_fit ?? null, fitScale);
        drawInstanced(4, count);
        for (const loc of Object.values(galA)) {
          if (loc >= 0) {
            divisor(loc, 0);
            gl.disableVertexAttribArray(loc);
          }
        }
      }

      // ——— the overlay: the skeleton, the marks, the fade ———
      ctx.clearRect(0, 0, width, height);
      if (!glOk) {
        // no context: the sky still stands, drawn flat
        ctx.fillStyle = "#05060a";
        ctx.fillRect(0, 0, width, height);
        for (let i = 0; i < count; i++) {
          if (!isLit(galaxies[i].density, growth, DENSITY_THRESHOLD)) continue;
          const p = project(posArr[i * 3], posArr[i * 3 + 1], posArr[i * 3 + 2]);
          if (!p) continue;
          const g = grownDensity(galaxies[i].density, growth);
          const r = clamp((0.4 + g) / (0.4 + p.z) * 3.4, 0.7, 26);
          ctx.fillStyle = `rgba(226, 226, 214, ${clamp01(0.16 + g * 0.5) / (0.5 + p.z)})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // the foreground: our own sky, in front of everything
      for (let i = 0; i < FOREGROUND; i++) {
        const tw = reduced ? 1 : 0.62 + 0.38 * Math.sin(t * 0.9 + near[i * 4 + 3]);
        const a = clamp01(near[i * 4 + 2] * 0.3 * tw * (1 - night * 0.5) - lens * 0.06);
        if (a <= 0.01) continue;
        ctx.fillStyle = `rgba(232, 236, 246, ${a})`;
        ctx.beginPath();
        ctx.arc(near[i * 4] * width, near[i * 4 + 1] * height, near[i * 4 + 2] * 0.72, 0, Math.PI * 2);
        ctx.fill();
      }

      // the lens: the geometry under the light — knots and filaments
      if (lens > 0.02) {
        ctx.lineWidth = 1;
        for (const [i, j] of web.filaments) {
          const a = project(web.knots[i].x, web.knots[i].y, web.knots[i].z);
          const b = project(web.knots[j].x, web.knots[j].y, web.knots[j].z);
          if (!a || !b) continue;
          const near = 1 / (0.5 + Math.min(a.z, b.z) * 1.6);
          ctx.strokeStyle = `rgba(140, 176, 206, ${clamp01(lens * 0.34 * near)})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        for (const k of web.knots) {
          const p = project(k.x, k.y, k.z);
          if (!p) continue;
          const near = 1 / (0.5 + p.z * 1.6);
          ctx.strokeStyle = `rgba(231, 172, 82, ${clamp01(lens * 0.42 * near)})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, clamp(k.m * 7 * near, 1.5, 22), 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // the keyboard's mark, and the ring a resolving galaxy wears
      if (selIdx >= 0 && selIdx < count) {
        const p = project(posArr[selIdx * 3], posArr[selIdx * 3 + 1], posArr[selIdx * 3 + 2]);
        if (p) {
          ctx.strokeStyle = `rgba(242, 238, 230, ${0.22 + resolveLevel * 0.45})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 16 + resolveLevel * 40 + breath * 3, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // novae throw a ring the eye catches before the ear does
      for (const n of live) {
        if (n.galaxy >= count) continue;
        const p = project(posArr[n.galaxy * 3], posArr[n.galaxy * 3 + 1], posArr[n.galaxy * 3 + 2]);
        if (!p) continue;
        const u = clamp01(n.age / NOVA_LIFE_SEC);
        ctx.strokeStyle = `rgba(242, 232, 214, ${(1 - u) * 0.32 * n.strength})`;
        ctx.lineWidth = 1.2 * (1 - u);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6 + u * 90, 0, Math.PI * 2);
        ctx.stroke();
      }

      // the season, felt at the edges: an early universe is a colder frame
      if (growth < 0.9) {
        const g = (0.9 - growth) / (0.9 - GROWTH_MIN);
        const grd = ctx.createRadialGradient(
          width / 2,
          height / 2,
          Math.min(width, height) * 0.2,
          width / 2,
          height / 2,
          Math.max(width, height) * 0.75,
        );
        grd.addColorStop(0, "rgba(0,0,0,0)");
        grd.addColorStop(1, `rgba(44, 74, 92, ${g * 0.3})`);
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, width, height);
      }

      // arrival and departure, both as an exhale
      const fade = Math.max(entering, leaving);
      if (fade > 0.002) {
        ctx.fillStyle = `rgba(5, 6, 10, ${fade})`;
        ctx.fillRect(0, 0, width, height);
      }
    };
    raf = requestAnimationFrame(draw);
    // no draw while hidden or paused inside a gallery iframe
    const offVis = onVisibility((hiddenNow) => {
      sleeping = hiddenNow;
      if (!hiddenNow && !galleryPaused && !raf) raf = requestAnimationFrame(draw);
    });
    const offGallery = onGalleryPause((pausedNow) => {
      galleryPaused = pausedNow;
      if (!pausedNow && !sleeping && !raf) raf = requestAnimationFrame(draw);
    });

    return () => {
      observer.disconnect();
      detachGestures();
      detachVessel();
      wrap.removeEventListener("keydown", onKeyDown);
      wrap.removeEventListener("keyup", onKeyUp);
      mq.removeEventListener?.("change", onMq);
      offVis();
      offGallery();
      glCanvas.removeEventListener("webglcontextlost", onGlLost);
      glCanvas.removeEventListener("webglcontextrestored", onGlRestored);
      cancelAnimationFrame(raf);
      teardownGL();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const letGo = () => {
    resolvedRef.current = [];
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify({ resolved: [], cleared: true }));
    } catch {
      /* noop */
    }
    setHasKept(false);
    try {
      getFieldAudio().thud();
      haptics.roll();
    } catch {
      /* noop */
    }
  };

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      role="application"
      aria-label="a web of dark matter with galaxies strung along it"
      data-lens-raised={lensUp ? "1" : undefined}
      style={{
        position: "fixed",
        inset: 0,
        background: "#05060a",
        outline: "none",
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
        overflow: "hidden",
      }}
    >
      <canvas
        ref={glCanvasRef}
        aria-hidden
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
      <canvas
        ref={overlayRef}
        aria-hidden
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
      <LetGo label="let the web go" onLetGo={letGo} visible={hasKept} />
    </div>
  );
}
