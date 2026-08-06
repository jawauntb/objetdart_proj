"use client";

/**
 * /galaxy — the arms. The galaxy band at ~10¹⁷–10²⁰·⁵ m, directly above
 * the stellar vault and below the web between galaxies.
 *
 * The invariant is a density wave (src/lib/spiral.ts): a differentially
 * rotating disc — every star on its own orbit under one flat rotation
 * curve — through which a two-armed pattern turns rigidly at a single
 * pattern speed. The arms are not made of stars. They are the standing
 * crowd the stars pour through, and the room never draws a spiral: each
 * of fifteen thousand instanced stars carries only its orbit, the wave
 * gives it a small locked excursion in the vertex shader, and the arms
 * EMERGE where those excursions converge. Watch any patch long enough
 * and its stars leave; the arm stays.
 *
 * The same wave is heard: pattern speed and arm pitch tune the register
 * the scale axis assigns this band (spectralRegisterFor at s = 18.75 —
 * ~62 Hz, near sub-bass, one breath every ~42 s), so winding the law
 * with three fingers audibly winds the law. A tapped radius rings at its
 * own angular speed — the rotation curve as melody, inner always higher.
 * Hold a star and you ride its orbit; every arm it crosses lands as one
 * felt tick at exactly m·|Ω − Ωp| — the frequency mismatch as rhythm.
 *
 * Three fingers hold the world-law: drag retunes pattern speed and arm
 * pitch, twist turns the pattern by hand, a held ceremony grows the bar.
 * Held still, the veil lifts — the stars dim and the standing wave shows
 * alone with its corotation circle, the pattern without its particles.
 * Twist raises the lens: the rotation curve and the crest's own log
 * spiral, the geometry under the light. Tilt leans the disc, shake heats
 * it, a knock rings the bar, face-down is night — and at night the stars
 * go out and the wave glows on.
 *
 * Raw WebGL: one context, one rAF, two draws — a fullscreen disc-plane
 * pass for gas, dust lane, bulge and bar, and one instanced pass for the
 * whole population out of typed arrays uploaded once. No textures, no
 * assets, no dependencies; the palette is the site's tokens.
 *
 * Stars you have ridden through an arm persist in `objetdart:galaxy:v1`
 * with the quiet clear at the bottom. Pinch is unbound — AxisChrome owns
 * travel; two-finger tap is its step back.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import RoomShell, { type RoomShellProps } from "@/components/RoomShell";
import type { RoomVoice } from "@/lib/gesture/defaults";
import { tapTrainDepth, tapTrainTier } from "@/lib/gesture/core";
import {
  FULLSCREEN_VERT_CLIP,
  createGLStage,
  type FullscreenQuad,
  type GLProgram,
  type GLStage,
  type InstancedDraw,
} from "@/lib/webgl/stage";
import { clocksFrom } from "@/lib/webgl/sizing";
import { spectralRegisterFor } from "@/lib/scale";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { getTurbulence, stirTurbulence } from "@/lib/turbulence";
import { createIdleWriter } from "@/lib/room-runtime";
import {
  ARM_M,
  AZ_FACTOR,
  BAR_AMP,
  BAR_REACH,
  GALAXY_LFO_HZ,
  GALAXY_SCALE_S,
  OMEGA_P_DEFAULT,
  OMEGA_P_MAX,
  OMEGA_P_MIN,
  PITCH_DEFAULT,
  PITCH_MAX,
  PITCH_MIN,
  REGION_HALF_WIDTH,
  REGION_MAX,
  R_CORE,
  R_DISC,
  R_MAX,
  R_REF,
  SHELL_MAX,
  STAR_COUNT,
  V_FLAT,
  WAVE_AMP_FRAC,
  angularSpeed,
  buildStars,
  corotationRadius,
  hashSeed,
  mulberry32,
  orbitMidiFor,
  orbitalSpeed,
  patternMidiFor,
  propagate,
  regionAt,
  regionLife,
  shearedSpan,
  shellRadius,
  starState,
  waveNumber,
  type Region,
  type WaveParams,
} from "@/lib/spiral";

/** One seed, one galaxy — the same one every visit, for everybody. */
const GALAXY_SEED = 0xa2135;
const STORE_KEY = "objetdart:galaxy:v1";
/** How many ridden stars the room carries; oldest retired first. */
const MAX_KEPT = 24;
const MAX_FLARES = 4;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);
const TAU = Math.PI * 2;

/**
 * A kept region, serialised relative to NOW rather than to the disc's clock:
 * `th` is its azimuth at the moment of writing and `age`/`ig` are elapsed
 * seconds, so on the next visit — where the clock restarts at zero — a
 * remnant is exactly as old and exactly as far around as it was left.
 */
type StoredRegion = { R0: number; th: number; age: number; str: number; ig: number };
type Stored = { kept?: number[]; regions?: StoredRegion[]; cleared?: boolean };

// GLSL constant injection — the shader mirrors lib/spiral.ts expression for
// expression; the lib copy is the one the tests pin.
const G = {
  vflat: V_FLAT.toFixed(6),
  rc2: (R_CORE * R_CORE).toFixed(6),
  m: ARM_M.toFixed(1),
  rref: R_REF.toFixed(4),
  ampf: WAVE_AMP_FRAC.toFixed(4),
  azf: AZ_FACTOR.toFixed(4),
  barAmp: BAR_AMP.toFixed(4),
  barIn: (BAR_REACH * 0.45).toFixed(4),
  barOut: BAR_REACH.toFixed(4),
  rd: R_DISC.toFixed(4),
};

/** The disc pass: gas along the wave, dust on its inner edge, bulge, bar. */
const FRAG_DISC = `
precision highp float;
uniform vec2 u_res;
uniform vec3 u_cam, u_right, u_up, u_fwd;
uniform float u_focal, u_aspect;
uniform float u_patPhase, u_k, u_amp, u_bar, u_corot;
uniform float u_reveal, u_night, u_breath, u_lens, u_glimmer, u_barFlash;
uniform float u_tw;
// x, z, strength, shell radius (<= 0 while the region is still gas)
uniform vec4 u_regions[${REGION_MAX}];

float hash21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

/**
 * The halo we watch through: our own foreground stars, fixed in the WORLD
 * (hashed off the ray direction), so they parallax as the eye turns instead
 * of riding the glass the way a screen-space overlay would.
 */
float haloStars(vec3 rd, float tw) {
  float acc = 0.0;
  vec2 sph = vec2(atan(rd.z, rd.x), asin(clamp(rd.y, -1.0, 1.0)));
  for (int L = 0; L < 2; L++) {
    float f = 27.0 + float(L) * 43.0;
    vec2 g = sph * f;
    vec2 cell = floor(g);
    float h = hash21(cell + float(L) * 17.0);
    vec2 jit = vec2(h, fract(h * 91.7));
    float d = length(fract(g) - jit);
    float mag = fract(h * 313.7);
    acc += smoothstep(0.16, 0.0, d) * (0.12 + 0.6 * mag * mag)
         * (0.7 + 0.3 * sin(tw * 1.7 + h * 40.0));
  }
  return acc;
}

void main() {
  vec2 ndc = (gl_FragCoord.xy / u_res) * 2.0 - 1.0;
  vec3 rd = normalize(u_fwd * u_focal + u_right * (ndc.x * u_aspect) + u_up * ndc.y);

  // the void between arms is not black, the way deep sky is not black
  float vig = 1.0 - 0.4 * dot(ndc, ndc);
  vec3 col = vec3(0.012, 0.014, 0.024) * vig
           + vec3(0.008, 0.012, 0.024) * (0.4 + 0.6 * u_breath) * max(0.0, vig);

  // the halo, behind everything and in front of nothing
  col += vec3(0.82, 0.85, 0.93) * haloStars(rd, u_tw) * (1.0 - 0.5 * u_night) * (1.0 - 0.3 * u_lens);

  // one intersection with the disc plane — bounded, no marching
  if (abs(rd.y) > 1e-4) {
    float t = -u_cam.y / rd.y;
    if (t > 0.02) {
      vec3 p = u_cam + rd * t;
      float R = length(p.xz);
      if (R < 1.35) {
        float th = atan(p.z, p.x);
        float chi = ${G.m} * (th - u_patPhase) - u_k * log(max(R, 1e-4) / ${G.rref});
        float env = smoothstep(0.14, 0.26, R) * (1.0 - smoothstep(0.92, 1.12, R));
        // where the stellar crowd actually peaks: the Jacobian's own phase
        float shift = atan(u_k, 1.0);
        float crest = pow(0.5 + 0.5 * cos(chi - shift), 3.0);
        float dust = pow(0.5 + 0.5 * cos(chi - shift - 0.75), 6.0);
        float sigma = exp(-R / ${G.rd});
        float att = clamp(abs(rd.y) * 2.6, 0.3, 1.0) / (1.0 + t * t * 0.2);

        vec3 warm = vec3(0.784, 0.451, 0.165);  // --candle
        vec3 pale = vec3(0.949, 0.933, 0.902);  // --paper
        vec3 cold = vec3(0.34, 0.52, 0.94);     // the young light
        vec3 gold = vec3(0.93, 0.72, 0.33);     // the old light

        // the smooth disc: old starlight, dimmed by night
        float base = sigma * 0.85 * (0.85 + 0.3 * u_breath) * (1.0 - 0.8 * u_night);
        // the wave: gas lit along the crest — this term survives the night
        float wave = sigma * env * u_amp * crest * (0.7 + 0.3 * u_breath)
                   * (1.0 + 0.6 * u_glimmer) * (1.0 - 0.25 * u_night) * 3.4;
        vec3 acc = mix(warm, pale, 0.35) * base
                 + mix(cold, pale, 0.3) * wave * (1.0 + 1.6 * u_reveal);
        // the dust lane bites the inner edge of the arm
        acc *= 1.0 - 0.62 * dust * env * (1.0 - 0.6 * u_reveal);
        // bulge, and the bar locked to the pattern
        float xb = R * cos(th - u_patPhase);
        float yb = R * sin(th - u_patPhase);
        float bulge = exp(-R * R / 0.017);
        float barg = u_bar * exp(-pow(xb / 0.32, 2.0) - pow(yb / 0.09, 2.0));
        acc += mix(gold, warm, 0.4) * (bulge * (1.5 + 0.9 * u_barFlash) + barg * 1.1)
             * (1.0 - 0.75 * u_night) * (1.0 - 0.55 * u_reveal);
        // the veil: the pattern alone, and the one radius that keeps station
        acc += cold * u_reveal * env * crest * sigma * 1.6;
        float ring = exp(-pow((R - u_corot) / 0.014, 2.0));
        acc += vec3(0.93, 0.72, 0.33) * ring * u_reveal * 0.8;

        // what the hand planted: gas lit from inside, and the shells of
        // whatever has gone off — both drawn in the disc, both bounded
        for (int i = 0; i < ${REGION_MAX}; i++) {
          vec4 g = u_regions[i];
          if (g.z <= 0.0) continue;
          float d = length(p.xz - g.xy);
          // the nursery: cold hydrogen glow, brightest at its heart
          acc += mix(cold, pale, 0.25) * g.z * 0.85 * exp(-d * d * 210.0);
          if (g.w > 0.0) {
            // the shell: a thin bright rim that thins as it runs out
            float dr = (d - g.w) / 0.02;
            float fade = 1.0 - g.w / ${SHELL_MAX.toFixed(3)};
            acc += mix(pale, cold, 0.4) * g.z * fade * 1.1 * exp(-dr * dr);
            // and the cavity it swept clear behind it
            acc *= 1.0 - 0.4 * g.z * fade * smoothstep(g.w, g.w * 0.45, d);
          }
        }

        col += acc * att * (1.0 - 0.25 * u_lens);
      }
    }
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

/** The star pass: the whole population, one instanced draw, no spiral drawn. */
const VERT_STAR = `
attribute vec2 a_corner;
attribute vec4 a_orbit;  // R0, theta0, height, size roll
attribute vec4 a_seed;   // pop roll, hue roll, phase roll, spare
attribute float a_kept;  // 0..1 — a star once ridden keeps a little light
uniform vec3 u_cam, u_right, u_up, u_fwd;
uniform float u_focal, u_aspect, u_fit;
uniform float u_tau, u_patPhase, u_k, u_amp, u_bar, u_heat;
uniform float u_reveal, u_night, u_breath;
// Total light is conserved as the population changes: one star's share is
// inversely the count, so a disc of 180k reads like a disc, not a smear.
uniform float u_lum;
uniform vec4 u_flares[${MAX_FLARES}];
uniform vec4 u_regions[${REGION_MAX}]; // x, z, strength, shell radius
uniform vec3 u_follow;   // disc x, disc z, level
varying vec2 v_uv;
varying vec3 v_tint;
varying float v_bright;

void main() {
  float R0 = a_orbit.x;
  float th0 = a_orbit.y;
  float hgt = a_orbit.z;
  float szr = a_orbit.w;

  // lib/spiral.ts starState, expression for expression
  float Om = ${G.vflat} / sqrt(R0 * R0 + ${G.rc2});
  float th = th0 + Om * u_tau;
  float chi = ${G.m} * (th - u_patPhase) - u_k * log(max(R0, 1e-5) / ${G.rref});
  float env = smoothstep(0.14, 0.26, R0) * (1.0 - smoothstep(0.92, 1.12, R0));
  float a = ${G.ampf} * env * u_amp;
  float rr = R0 * (1.0 - a * cos(chi));
  float th2 = th + a * ${G.azf} * sin(chi);
  float be = 1.0 - smoothstep(${G.barIn}, ${G.barOut}, R0);
  rr *= 1.0 - ${G.barAmp} * u_bar * be * cos(2.0 * (th - u_patPhase));
  float jig = u_heat * 0.022 * sin(u_tau * 7.0 + a_seed.z * 37.0);

  // ——— what the hand planted acts back on the disc ———
  // A cluster is mass: the disc bends toward it, so a seeded knot visibly
  // drags the arm it sits in. A supernova shell shoves what it passes and
  // lights it. Bounded loop, no branching per star beyond the early out.
  vec2 disc = vec2(rr * cos(th2), rr * sin(th2));
  float nursery = 0.0;
  float swept = 0.0;
  for (int i = 0; i < ${REGION_MAX}; i++) {
    vec4 g = u_regions[i];
    if (g.z <= 0.0) continue;
    vec2 dv = disc - g.xy;
    float d = length(dv) + 1e-5;
    vec2 dir = dv / d;
    // the knot's own pull — clusters perturb the arms they sit in
    disc -= dir * (g.z * 0.02 * exp(-d * d * 22.0));
    nursery += g.z * exp(-d * d * 190.0);
    if (g.w > 0.0) {
      float dr = (d - g.w) / 0.024;
      float rim = exp(-dr * dr);
      float fade = 1.0 - g.w / ${SHELL_MAX.toFixed(3)};
      disc += dir * (g.z * fade * 0.016 * rim);
      swept += g.z * fade * rim;
    }
  }
  vec3 pos = vec3(disc.x, hgt + jig, disc.y);

  vec3 rel = pos - u_cam;
  float zc = dot(rel, u_fwd);
  if (zc < 0.03) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    v_uv = vec2(0.0);
    v_tint = vec3(0.0);
    v_bright = 0.0;
    return;
  }
  vec2 sp = vec2(dot(rel, u_right), dot(rel, u_up)) * u_focal / zc;

  // the emergent crowd: the Jacobian's radial compression at this phase
  float j = 1.0 - a * cos(chi) - a * u_k * sin(chi);
  float crowd = clamp(1.0 / max(j, 0.35) - 1.0, 0.0, 2.0);
  // young stars are born exactly where the crowd is — the crest lights blue
  float young = step(0.72, a_seed.x) * clamp(crowd * 1.5, 0.0, 1.5);
  float inb = 1.0 - smoothstep(0.1, 0.2, R0);

  // At this population a star is a point, not a disc — a couple of pixels
  // at most, so the structure comes from where stars ARE, never from how
  // fat they are drawn.
  float extent = (0.0011 + 0.0019 * szr + 0.0013 * young + 0.0014 * inb + 0.0018 * a_kept);
  // capped well under clip: a star sweeping near the eye stays a star,
  // never a blob the size of the frame
  float r = min(extent / zc, 0.011);
  gl_Position = vec4((sp.x + a_corner.x * r) / u_aspect, sp.y + a_corner.y * r, 0.0, 1.0);
  v_uv = a_corner;

  vec3 cold = vec3(0.62, 0.75, 1.0);
  vec3 pale = vec3(0.949, 0.933, 0.902);
  vec3 warm = vec3(0.96, 0.55, 0.22);
  vec3 gold = vec3(0.93, 0.72, 0.33);
  vec3 tint = mix(pale, warm, 0.2 + 0.4 * a_seed.y);
  tint = mix(tint, gold, inb * 0.8);
  tint = mix(tint, cold, clamp(young, 0.0, 1.0) * 0.75);
  tint = mix(tint, gold, a_kept * 0.35);
  // stars in a nursery are the newest light in the room, and the shell
  // front burns hotter still
  tint = mix(tint, cold, clamp(nursery * 1.4, 0.0, 0.85));
  tint = mix(tint, vec3(0.98, 0.96, 0.94), clamp(swept, 0.0, 0.7));
  v_tint = tint;

  float tw = 0.86 + 0.14 * sin(u_tau * (0.5 + a_seed.z) + a_seed.z * 41.0);
  v_bright = (0.7 + 1.3 * szr) * tw
           * (1.0 + 2.2 * young + 0.8 * crowd + 1.2 * inb + 1.5 * a_kept
              + 3.0 * nursery + 5.0 * swept)
           * (0.85 + 0.15 * u_breath)
           / (0.5 + zc * 1.1)
           * (1.0 - 0.92 * u_night) * (1.0 - 0.82 * u_reveal)
           * clamp(u_fit, 0.9, 1.12) * u_lum;

  // the followed star's neighbourhood answers the hand
  float fd = distance(pos.xz, u_follow.xy);
  v_bright *= 1.0 + u_follow.z * 2.0 * exp(-fd * fd * 90.0);
  for (int i = 0; i < ${MAX_FLARES}; i++) {
    vec4 f = u_flares[i];
    float dd = distance(pos.xz, f.xy);
    v_bright *= 1.0 + f.z * exp(-dd * dd * 70.0);
  }
}
`;

const FRAG_STAR = `
precision highp float;
varying vec2 v_uv;
varying vec3 v_tint;
varying float v_bright;

void main() {
  if (v_bright <= 0.0) discard;
  float d = length(v_uv);
  if (d > 1.0) discard;
  float i = exp(-d * d * 3.4) * smoothstep(1.0, 0.45, d);
  vec3 c = mix(v_tint, vec3(0.97, 0.95, 0.92), exp(-d * d * 9.0) * 0.6);
  gl_FragColor = vec4(c * i * v_bright, 1.0);
}
`;

export default function GalaxyArms() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const [hasKept, setHasKept] = useState(false);
  const [lensUp, setLensUp] = useState(false);
  const keptRef = useRef<number[]>([]);
  const regionsRef = useRef<Region[]>([]);
  const clearRef = useRef<() => void>(() => {});
  const stageRef = useRef<GLStage | null>(null);
  const stageRebuild = useRef<() => void>(() => {});
  // The room's own meanings, handed to <RoomShell>. Held in refs so the
  // shell never re-attaches the engine and drops an in-flight hold.
  const voiceRef = useRef<RoomVoice>({});
  const keyboardRef = useRef<NonNullable<RoomShellProps["keyboard"]>>({});
  const glimmerRef = useRef<() => void>(() => {});
  // Every verb the disc speaks, delegated through the ref so the shell never
  // re-attaches the engine mid-hold. Listed rather than proxied: the list IS
  // the room's coverage of the grammar, and it should be readable as one.
  const voice = useMemo<RoomVoice>(
    () => ({
      tap: (e) => voiceRef.current.tap?.(e),
      stepBack: (e) => voiceRef.current.stepBack?.(e),
      tutti: (e) => voiceRef.current.tutti?.(e),
      plant: (e) => voiceRef.current.plant?.(e),
      deepen: (e) => voiceRef.current.deepen?.(e),
      ceremony: (e) => voiceRef.current.ceremony?.(e),
      timeScale: (k) => voiceRef.current.timeScale?.(k),
      drag: (e) => voiceRef.current.drag?.(e),
      wind: (e) => voiceRef.current.wind?.(e),
      flick: (e) => voiceRef.current.flick?.(e),
      stir: (e) => voiceRef.current.stir?.(e),
      lens: (e) => voiceRef.current.lens?.(e),
      season: (e) => voiceRef.current.season?.(e),
      rhythm: (e) => voiceRef.current.rhythm?.(e),
      drum: (e) => voiceRef.current.drum?.(e),
      arpeggio: (e) => voiceRef.current.arpeggio?.(e),
      scatter: (e) => voiceRef.current.scatter?.(e),
      gravity: (e) => voiceRef.current.gravity?.(e),
      knock: (e) => voiceRef.current.knock?.(e),
      night: (e) => voiceRef.current.night?.(e),
      breath: (e) => voiceRef.current.breath?.(e),
    }),
    [],
  );
  const keyboard = useMemo<RoomShellProps["keyboard"]>(
    () => ({
      enter: () => keyboardRef.current.enter?.(),
      enterHeld: (ms: number) => keyboardRef.current.enterHeld?.(ms),
      escape: () => keyboardRef.current.escape?.(),
      arrow: (dx: number, dy: number) => keyboardRef.current.arrow?.(dx, dy),
    }),
    [],
  );

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

    // ——— the galaxy, built once ———
    const field = buildStars(GALAXY_SEED, STAR_COUNT);
    const count = field.count;
    /** One star's share of the disc's light — the total stays put. */
    const LUM = 55000 / count;

    // ——— persistence ———
    // The galaxy itself is never stored — one seed brings it back whole.
    // What the room keeps is the trail: stars a hand has ridden through an
    // arm, each holding a little of the ride's light.
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Stored;
        if (Array.isArray(parsed.kept)) {
          keptRef.current = parsed.kept
            .filter((n) => Number.isFinite(n) && n >= 0 && n < count)
            .slice(-MAX_KEPT);
        }
        if (Array.isArray(parsed.regions)) {
          regionsRef.current = parsed.regions
            .filter(
              (r) =>
                r &&
                Number.isFinite(r.R0) &&
                Number.isFinite(r.th) &&
                r.R0 >= 0.1 &&
                r.R0 <= R_MAX,
            )
            .slice(-REGION_MAX)
            .map((r) => {
              const age = Math.max(0, Number(r.age) || 0);
              const ig = Number(r.ig);
              return {
                R0: r.R0,
                theta0: r.th,
                born: -age,
                strength: clamp01(Number(r.str) || 0.4),
                ignited: Number.isFinite(ig) && ig >= 0 ? -ig : -1,
              };
            })
            // whatever has already burned out stays burned out
            .filter((r) => regionLife(r, 0) > 0.02);
        }
      }
    } catch {
      /* a first turn */
    }
    setHasKept(keptRef.current.length > 0 || regionsRef.current.length > 0);
    const keptSet = new Set(keptRef.current);
    const writeStore = () => {
      try {
        window.localStorage.setItem(
          STORE_KEY,
          JSON.stringify({
            kept: keptRef.current,
            regions: regionsRef.current.map((r) => ({
              R0: r.R0,
              th: regionAt(r, tau).theta,
              age: tau - r.born,
              str: r.strength,
              ig: r.ignited >= 0 ? tau - r.ignited : -1,
            })),
            cleared: keptRef.current.length === 0 && regionsRef.current.length === 0,
          }),
        );
      } catch {
        /* noop */
      }
      setHasKept(keptRef.current.length > 0 || regionsRef.current.length > 0);
    };
    // Shared idle writer: coalesces the many small kept/region writes so a
    // rapid drag through an arm does not touch localStorage on every
    // sample. The write itself remains writeStore(), so the on-disk
    // payload shape at objetdart:galaxy:v1 is identical.
    const writer = createIdleWriter(writeStore);
    const save = () => writer.schedule();

    // ——— state ———
    let width = 0;
    let height = 0;
    let rectLeft = 0;
    let rectTop = 0;
    let raf = 0;
    let last = performance.now();
    /** the disc's own clock — every orbit reads it */
    let tau = 0;
    /** the pattern's azimuth — the integral of Ωp over the same clock */
    let patPhase = 0;
    let timeScale = 1;
    let timeScaleTarget = 1;
    /** the world-law */
    let omegaP = OMEGA_P_DEFAULT;
    let omegaPTarget = OMEGA_P_DEFAULT;
    let pitch = PITCH_DEFAULT;
    let pitchTarget = PITCH_DEFAULT;
    let bar = 0;
    let barTarget = 0;
    /** the veil: the pattern shown without its particles */
    let reveal = 0;
    let revealTarget = 0;
    let lens = 0;
    let lensTarget = 0;
    let lensSnapped = 0;
    let night = 0;
    let nightTarget = 0;
    let heat = 0;
    let barFlash = 0;
    let glimmer = 0;
    let glimmerAt = 0;
    let panX = 0;
    let panY = 0;
    let panVX = 0;
    let panVY = 0;
    let roll = 0;
    let rollVel = 0;
    let tiltX = 0;
    let tiltY = 0;
    let entering = 1;
    let leaving = 0;
    let lastInteractionAt = performance.now();
    let lastLawNoteAt = 0;
    /** the followed star: ride an orbit, feel the arms go by */
    let followIdx = -1;
    let followLevel = 0;
    let followTarget = 0;
    let lastFollowChi = 0;
    let followCrossings = 0;
    /** keyboard selection ring radius */
    let selR = 0.5;
    let kbHold = 0;
    let vHeldSince = 0;
    const flares: Array<{ x: number; y: number; s: number; age: number }> = [];

    // ——— what the hand plants ———
    // Regions ride the same rotation curve the stars do, so a seeded knot is
    // caught in the shear the instant it exists — plant a round patch, come
    // back, find it drawn into an arc. That is the winding problem, felt.
    /** the one being gathered under a finger right now, or -1 */
    let seeding = -1;
    let seedTier = 0;

    const waveParams = (): WaveParams => ({ patternPhase: patPhase, pitch, amp: 1, bar });

    // ——— typed arrays: the whole population, uploaded once ———
    const orbitArr = new Float32Array(count * 4);
    const seedArr = new Float32Array(count * 4);
    const keptArr = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      orbitArr[i * 4] = field.r[i];
      orbitArr[i * 4 + 1] = field.theta[i];
      orbitArr[i * 4 + 2] = field.z[i];
      orbitArr[i * 4 + 3] = field.size[i];
      seedArr[i * 4] = field.pop[i];
      seedArr[i * 4 + 1] = field.hue[i];
      seedArr[i * 4 + 2] = mulberry32(hashSeed(GALAXY_SEED, i))();
      seedArr[i * 4 + 3] = 0;
      keptArr[i] = keptSet.has(i) ? 1 : 0;
    }

    // ——— the camera ———
    const cam = { x: 0, y: 0.4, z: -1.2 };
    const basis = { rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0, fx: 0, fy: 0, fz: 1 };
    const FOCAL = 1.18;
    const BASE_RANGE = 0.98;
    let fitScale = 1;
    let aspect = 1;

    const setBasis = (yaw: number, pitchA: number, rollA: number) => {
      const cp = Math.cos(pitchA);
      const fx = Math.sin(yaw) * cp;
      const fy = Math.sin(pitchA);
      const fz = Math.cos(yaw) * cp;
      let rx = fz;
      const ry = 0;
      let rz = -fx;
      const rn = Math.hypot(rx, ry, rz) || 1;
      rx /= rn;
      rz /= rn;
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
    setBasis(0, -0.3, 0);

    /** Screen position of a world point, or null if behind the eye. */
    const project = (x: number, y: number, z: number) => {
      const dx = x - cam.x;
      const dy = y - cam.y;
      const dz = z - cam.z;
      const zc = dx * basis.fx + dy * basis.fy + dz * basis.fz;
      if (zc < 0.03) return null;
      const sx = ((dx * basis.rx + dy * basis.ry + dz * basis.rz) * FOCAL) / zc;
      const sy = ((dx * basis.ux + dy * basis.uy + dz * basis.uz) * FOCAL) / zc;
      return { x: ((sx / aspect) * 0.5 + 0.5) * width, y: (0.5 - sy * 0.5) * height, z: zc };
    };

    /** Disc-plane position of star i under the current law. */
    const starPos = (i: number) => {
      const st = starState(field.r[i], field.theta[i], tau, waveParams());
      return { x: st.x, y: field.z[i], z: st.y, chi: st.chi };
    };

    /** Which star is under this point, or -1. */
    /** Coarse stride for picking: a hand aims at a star, not at all of them. */
    const PICK_STRIDE = Math.max(1, Math.floor(count / 24000));
    const starAt = (px: number, py: number): number => {
      let best = -1;
      let bestD = 26 * 26;
      for (let i = 0; i < count; i += PICK_STRIDE) {
        if (field.r[i] < 0.12) continue; // the bulge is a glow, not a handle
        const sp = starPos(i);
        const p = project(sp.x, sp.y, sp.z);
        if (!p) continue;
        const dx = p.x - px;
        const dy = p.y - py;
        const d2 = (dx * dx + dy * dy) * (0.5 + p.z * 0.6);
        if (d2 < bestD) {
          bestD = d2;
          best = i;
        }
      }
      return best;
    };

    const addFlare = (x: number, z: number, s: number) => {
      flares.push({ x, y: z, s, age: 0 });
      if (flares.length > MAX_FLARES) flares.shift();
    };

    /** Where a screen point lands on the disc plane, or null past the rim. */
    const discPointAt = (px: number, py: number): { x: number; z: number } | null => {
      const ndcX = ((px / Math.max(1, width)) * 2 - 1) * aspect;
      const ndcY = 1 - (py / Math.max(1, height)) * 2;
      const dx = basis.fx * FOCAL + basis.rx * ndcX + basis.ux * ndcY;
      const dy = basis.fy * FOCAL + basis.ry * ndcX + basis.uy * ndcY;
      const dz = basis.fz * FOCAL + basis.rz * ndcX + basis.uz * ndcY;
      const n = Math.hypot(dx, dy, dz) || 1;
      const ry = dy / n;
      if (Math.abs(ry) < 1e-4) return null;
      const t = -cam.y / ry;
      if (t <= 0.02) return null;
      const x = cam.x + (dx / n) * t;
      const z = cam.z + (dz / n) * t;
      if (Math.hypot(x, z) > R_MAX * 1.05) return null;
      return { x, z };
    };

    /** Which planted region is under this point, or -1. */
    const regionIndexAt = (px: number, py: number): number => {
      let best = -1;
      let bestD = 46 * 46;
      for (let i = 0; i < regionsRef.current.length; i++) {
        const rp = regionAt(regionsRef.current[i], tau);
        const p = project(rp.x, 0, rp.y);
        if (!p) continue;
        const d2 = (p.x - px) ** 2 + (p.y - py) ** 2;
        if (d2 < bestD) {
          bestD = d2;
          best = i;
        }
      }
      return best;
    };

    const seedRegion = (x: number, z: number): number => {
      const R0 = Math.hypot(x, z);
      if (R0 < 0.1 || R0 > R_MAX) return -1;
      const reg: Region = {
        R0,
        theta0: Math.atan2(z, x) - angularSpeed(R0) * tau,
        born: tau,
        strength: 0.18,
        ignited: -1,
      };
      regionsRef.current.push(reg);
      // oldest retired gracefully — the disc carries only so much gas
      if (regionsRef.current.length > REGION_MAX) regionsRef.current.shift();
      save();
      soundOrbit(R0, 700, 0.7);
      try {
        audio.spark();
        haptics.ripple(0.45);
      } catch {
        /* noop */
      }
      return regionsRef.current.length - 1;
    };

    /** The ceremony: the gas goes off, and the shell starts from here. */
    const igniteRegion = (i: number) => {
      const rs = regionsRef.current;
      if (i < 0 || i >= rs.length || rs[i].ignited >= 0) return;
      rs[i] = { ...rs[i], ignited: tau };
      const rp = regionAt(rs[i], tau);
      addFlare(rp.x, rp.y, 1);
      stirTurbulence(0.25);
      save();
      try {
        audio.bell();
        audio.playNote(Math.round(patternMidiFor(omegaP, pitch)) - 12, 2200);
        haptics.bloom();
      } catch {
        /* noop */
      }
    };

    /** Removal: the knot blows out and the disc closes over it. */
    const disperseRegion = (i: number) => {
      const rs = regionsRef.current;
      if (i < 0 || i >= rs.length) return;
      const rp = regionAt(rs[i], tau);
      rs.splice(i, 1);
      if (seeding === i) seeding = -1;
      else if (seeding > i) seeding -= 1;
      addFlare(rp.x, rp.y, 0.3);
      save();
      try {
        audio.thud();
        haptics.roll();
      } catch {
        /* noop */
      }
    };

    // ——— sound: the disc, heard ———
    const soundOrbit = (R: number, ms = 800, gain = 1) => {
      try {
        audio.playNote(Math.round(orbitMidiFor(R, omegaP, pitch)), Math.round(ms * gain));
      } catch {
        /* the sea is not awake */
      }
    };
    const soundLaw = (now: number, ms = 700) => {
      if (now - lastLawNoteAt < 380) return;
      lastLawNoteAt = now;
      try {
        audio.playNote(Math.round(patternMidiFor(omegaPTarget, pitchTarget)), ms);
      } catch {
        /* noop */
      }
    };

    /** The tutti: the rotation curve as one arpeggio, centre to rim. */
    const tutti = () => {
      for (let k = 0; k < 8; k++) {
        const R = 0.14 + (k / 7) * 0.84;
        window.setTimeout(() => {
          soundOrbit(R, 620);
          const a = (k / 8) * TAU + patPhase;
          addFlare(R * Math.cos(a), R * Math.sin(a), 0.5);
        }, k * 110);
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
        else audio.playNote(31, 420);
      } catch {
        /* noop */
      }
    };

    const startFollow = (i: number) => {
      if (i < 0) return;
      followIdx = i;
      followTarget = 0.15;
      followCrossings = 0;
      lastFollowChi = starPos(i).chi;
      soundOrbit(field.r[i], 600, 0.8);
    };
    const endFollow = () => {
      if (followIdx >= 0 && followCrossings > 0) markKept(followIdx);
      followIdx = -1;
      followTarget = 0;
      kbHold = 0;
    };
    const markKept = (i: number) => {
      if (i < 0 || i >= count || keptSet.has(i)) return;
      keptSet.add(i);
      keptRef.current.push(i);
      keptArr[i] = 1;
      if (keptRef.current.length > MAX_KEPT) {
        const gone = keptRef.current.shift();
        if (gone !== undefined) {
          keptSet.delete(gone);
          keptArr[gone] = 0;
        }
      }
      keptDirty = true;
      save();
      try {
        audio.thud();
      } catch {
        /* noop */
      }
    };
    let keptDirty = false;
    clearRef.current = () => {
      keptSet.clear();
      keptArr.fill(0);
      keptDirty = true;
    };

    // ——— geometry and the GPU, both from the shared stage ———
    // `createGLStage` owns the context cascade, DPR through the quality
    // tiers, shader errors with source context, the lockstep 2D overlay,
    // context-loss recovery and complete teardown — the ceremony every
    // shader room used to write slightly differently.
    const stage = createGLStage(glCanvas, {
      wrap,
      label: "galaxy",
      overlay,
      reducedMotion: reduced,
      contextAttributes: { alpha: false, antialias: false, depth: false },
    });

    const syncSize = () => {
      const sz = stage ? stage.measure() : { width: wrap.clientWidth, height: wrap.clientHeight };
      const r = wrap.getBoundingClientRect();
      width = Math.max(240, sz.width || r.width);
      height = Math.max(320, sz.height || r.height);
      rectLeft = r.left;
      rectTop = r.top;
      aspect = width / height;
      if (!stage) {
        const ratio = Math.min(1.5, window.devicePixelRatio || 1);
        overlay.width = Math.round(width * ratio);
        overlay.height = Math.round(height * ratio);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      }
    };
    syncSize();
    const observer = new ResizeObserver(syncSize);
    observer.observe(wrap);

    const toLocal = (cx: number, cy: number) => ({
      x: clamp(cx - rectLeft, 0, width),
      y: clamp(cy - rectTop, 0, height),
    });

    const gl = stage?.gl ?? null;
    let discProg: GLProgram | null = null;
    let starProg: GLProgram | null = null;
    let discQuad: FullscreenQuad | null = null;
    let starDraw: InstancedDraw | null = null;
    let glOk = false;

    const buildPrograms = () => {
      if (!stage) return;
      discProg = stage.program(FULLSCREEN_VERT_CLIP, FRAG_DISC);
      starProg = stage.program(VERT_STAR, FRAG_STAR);
      if (!discProg || !starProg) {
        glOk = false;
        return;
      }
      discQuad = stage.fullscreenQuad(discProg);
      starDraw = stage.instanced(starProg);
      // The whole population, uploaded once. Nothing here is touched again
      // by the CPU — every orbit is propagated in the vertex shader.
      starDraw.attribute("a_corner", new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), 2, 0);
      starDraw.attribute("a_orbit", orbitArr, 4, 1);
      starDraw.attribute("a_seed", seedArr, 4, 1);
      starDraw.attribute("a_kept", keptArr, 1, 1);
      glOk = true;
    };
    buildPrograms();
    // A lost context takes every program and buffer with it; the stage tells
    // us, and the disc is rebuilt from the one seed exactly as it was.
    stageRef.current = stage;
    if (stage) stageRebuild.current = buildPrograms;

    // ——— the room's voice ———
    // <RoomShell> binds the whole grammar through lib/gesture/defaults and
    // answers in two senses anything the room leaves unspoken; these are the
    // verbs the disc has a real answer for. No pointer wiring lives here.
    let lastDeepenAt = 0;
    let dilateSince = 0;

    voiceRef.current = {
      tap: (e) => {
        const { x, y } = toLocal(e.x, e.y);
        // a second tap on a knot blows it out — the room's removal verb
        if (e.count >= 2) {
          const ri = regionIndexAt(x, y);
          if (ri >= 0) {
            disperseRegion(ri);
            return;
          }
        }
        // The rapid-tap ladder: 1 rings the orbit, 3 lights the arm through
        // the struck radius, 5 sets the gas off on the spot, n heats the
        // whole disc into the tutti.
        const trainTier = tapTrainTier(e.count);
        const depth = tapTrainDepth(e.count);
        if (trainTier === "n") {
          tutti();
          heat = clamp01(heat + 0.2 + depth * 0.3);
          stirTurbulence(0.08 + depth * 0.08);
          return;
        }
        if (trainTier === 5) {
          const dp = discPointAt(x, y);
          if (dp && e.count === 5) {
            // five strikes are the burst without the wait: gas gathers and
            // goes off in the same breath, and the shear takes it from there
            const idx = seedRegion(dp.x, dp.z);
            if (idx >= 0) {
              const reg = regionsRef.current[idx];
              regionsRef.current[idx] = {
                ...reg,
                strength: clamp01(0.3 + depth * 0.35),
              };
              igniteRegion(idx);
              return;
            }
          } else if (regionsRef.current.length) {
            // the taps past the rung fan the newest burn hotter
            const idx = regionsRef.current.length - 1;
            const reg = regionsRef.current[idx];
            regionsRef.current[idx] = { ...reg, strength: clamp01(reg.strength + 0.1) };
            const rp = regionAt(reg, tau);
            addFlare(rp.x, rp.y, 0.4 + depth * 0.2);
            save();
            return;
          }
          stirTurbulence(0.08);
          return;
        }
        if (trainTier === 3) {
          const dp = discPointAt(x, y);
          if (dp) {
            // three taps light the arm through the struck ring: the crest
            // flares where it crosses that radius, on both arms, and the
            // orbit rings under it
            const R = clamp(Math.hypot(dp.x, dp.z), 0.14, R_MAX);
            const kw = waveNumber(pitch);
            const crest = Math.atan2(kw, 1);
            for (let arm = 0; arm < ARM_M; arm++) {
              const th =
                patPhase + (crest + TAU * arm) / ARM_M + (kw / ARM_M) * Math.log(R / R_REF);
              addFlare(R * Math.cos(th), R * Math.sin(th), 0.45 + depth * 0.3);
            }
            soundOrbit(R, 700, 1 + depth * 0.4);
            try {
              haptics.ripple(0.3 + depth * 0.2);
            } catch {
              /* noop */
            }
            return;
          }
        }
        const rr = regionIndexAt(x, y);
        if (rr >= 0) {
          // touching gas stirs it: the knot answers at its own orbit
          const reg = regionsRef.current[rr];
          regionsRef.current[rr] = {
            ...reg,
            strength: clamp01(reg.strength + 0.08 * e.intensity),
          };
          const rp = regionAt(reg, tau);
          addFlare(rp.x, rp.y, 0.4);
          soundOrbit(reg.R0, 620);
          try {
            haptics.tap();
          } catch {
            /* noop */
          }
          return;
        }
        const i = starAt(x, y);
        if (i >= 0) {
          const sp = starPos(i);
          addFlare(sp.x, sp.z, 0.35 + e.intensity * 0.5);
          soundOrbit(field.r[i], 600 + e.intensity * 700);
          try {
            haptics.tap();
          } catch {
            /* noop */
          }
          return;
        }
        // open dark beyond the rim: the disc answers once, low, from under
        stirTurbulence(0.04);
        try {
          audio.playNote(Math.round(patternMidiFor(omegaP, pitch)) - 12, 900);
          haptics.tap();
        } catch {
          /* noop */
        }
      },

      // step back: the raised lens lowers first, then the veil, then the eye
      stepBack: () => {
        if (lensSnapped === 1) {
          setLens(0);
          return;
        }
        if (revealTarget > 0.05) {
          revealTarget = 0;
          return;
        }
        panY = clamp(panY * 0.6, -1, 1);
        panX = clamp(panX * 0.6, -1.2, 1.2);
        try {
          audio.playNote(Math.round(patternMidiFor(omegaP, pitch)) - 12, 520);
          haptics.tap();
        } catch {
          /* noop */
        }
      },

      tutti: () => tutti(),

      // the touch tier picks up the nearest star and rides its orbit
      plant: (e) => {
        lastDeepenAt = performance.now();
        const { x, y } = toLocal(e.x, e.y);
        startFollow(starAt(x, y));
      },

      // one continuous deepening: ride, then gather gas, then (on the
      // ceremony) set it off. Nothing fires the same at 900ms and 2400ms.
      deepen: (e) => {
        lastDeepenAt = performance.now();
        if (followIdx >= 0) followTarget = clamp01(0.15 + e.elapsed / 3200);
        if (seeding < 0) {
          if (e.tier < 2) return; // still only riding
          const { x, y } = toLocal(e.x, e.y);
          const dp = discPointAt(x, y);
          if (!dp) return;
          seeding = seedRegion(dp.x, dp.z);
          seedTier = e.tier;
          return;
        }
        const reg = regionsRef.current[seeding];
        if (!reg) {
          seeding = -1;
          return;
        }
        // duration is an axis: the longer the hold, the more gas gathers
        regionsRef.current[seeding] = {
          ...reg,
          strength: clamp01(0.18 + (e.elapsed - 900) / 2600),
        };
        if (e.tier > seedTier) {
          seedTier = e.tier;
          soundOrbit(reg.R0, 500, 0.8);
          try {
            haptics.detent();
          } catch {
            /* noop */
          }
        }
      },

      // the room's one solemn act: the gathered gas goes off
      ceremony: () => {
        if (seeding >= 0) igniteRegion(seeding);
        else save();
        seeding = -1;
        seedTier = 0;
        endFollow();
      },

      // three fingers on the law stretch the clock — and while the clock is
      // stretched the veil lifts, showing the pattern without its particles.
      // Held past the ceremony, a bar grows at the centre and stays.
      timeScale: (k) => {
        timeScaleTarget = k;
        if (k >= 0.995) {
          dilateSince = 0;
          revealTarget = 0;
          return;
        }
        const now = performance.now();
        if (!dilateSince) {
          dilateSince = now;
          try {
            audio.playNote(Math.round(patternMidiFor(omegaP, pitch)) - 12, 2400);
            haptics.roll();
          } catch {
            /* noop */
          }
        }
        const held = now - dilateSince;
        revealTarget = clamp01(0.6 + held / 6000);
        if (held > 2500) {
          barTarget = clamp01(barTarget + 0.004);
          if (barTarget > 0.02 && barTarget < 0.04) {
            try {
              haptics.detent();
            } catch {
              /* noop */
            }
          }
        }
      },

      drag: (e) => {
        if (e.phase === "end") {
          panVX += e.vx * 0.0004;
          panVY += e.vy * 0.0004;
          return;
        }
        panX = clamp(panX - (e.dx / Math.max(1, width)) * 1.5, -1.2, 1.2);
        panY = clamp(panY + (e.dy / Math.max(1, height)) * 1.2, -1, 1);
      },

      // the law, dragged: sideways winds the pattern speed, up and down
      // opens or closes the arms — and the register follows in the same breath
      wind: (e) => {
        omegaPTarget = clamp(omegaPTarget * (1 + e.dx * 0.0018), OMEGA_P_MIN, OMEGA_P_MAX);
        pitchTarget = clamp(pitchTarget - e.dy * 0.0012, PITCH_MIN, PITCH_MAX);
        soundLaw(performance.now());
      },

      flick: (e) => {
        panVX += -Math.cos(e.angle) * (e.speed / 9000);
        panVY += Math.sin(e.angle) * (e.speed / 9000);
        try {
          haptics.ripple(0.3);
        } catch {
          /* noop */
        }
      },

      stir: (e) => {
        // stirring the disc is stirring the spiral itself: circling with the
        // arms winds them tighter, circling against lets them out — the
        // winding problem, run by hand at the speed the hand circles
        pitchTarget = clamp(pitchTarget + e.angularVelocity * 0.01, PITCH_MIN, PITCH_MAX);
        rollVel += e.angularVelocity * 0.006;
        stirTurbulence(Math.min(0.06, Math.abs(e.angularVelocity) * 0.01));
        soundLaw(performance.now(), 420);
      },

      lens: (e) => {
        lensTarget = clamp01(lensTarget + e.angle / 1.7);
        setLens(lensTarget > 0.5 ? 1 : 0);
      },

      // three fingers turn the pattern itself — the season, by hand
      season: (e) => {
        patPhase += e.angle * 0.8;
        soundLaw(performance.now(), 500);
      },

      rhythm: (e) => {
        if (e.stability < 0.6) return;
        // a steady pulse entrains the pattern speed — the law's own clock
        // set to the hand's tempo, and the register re-tunes with it
        omegaPTarget = clamp((OMEGA_P_DEFAULT * e.bpm) / 72, OMEGA_P_MIN, OMEGA_P_MAX);
        soundLaw(performance.now(), 520);
        addFlare(corotationRadius(omegaPTarget), 0, 0.4 + e.stability * 0.3);
        try {
          haptics.detent();
        } catch {
          /* noop */
        }
        // a truly metronomic hand still earns the rotation curve whole
        if (e.stability > 0.9) tutti();
      },

      // drumming between two points of the disc rings both radii at once —
      // the hands play the interval the rotation curve puts between them
      drum: (e) => {
        const local = toLocal(e.x, e.y);
        const hit = discPointAt(local.x, local.y);
        if (hit) {
          addFlare(hit.x, hit.z, 0.35);
          // the patter rings the radius it lands on, and the alternation
          // widens the interval — two hands, two radii, one rotation curve
          const R = Math.hypot(hit.x, hit.z);
          soundOrbit(R, 420, 0.8);
          soundOrbit(clamp(R * (1 - 0.35 * e.alternation), 0.12, R_MAX), 380, 0.7);
        } else {
          stirTurbulence(0.05);
        }
        try {
          haptics.ripple(0.3 + 0.3 * e.alternation);
        } catch {
          /* noop */
        }
      },

      // a rolled chord rolls outward through the disc, rim last
      arpeggio: (e) => {
        const n = Math.max(2, Math.min(3, e.fingers));
        for (let kk = 0; kk < n; kk++) {
          const R = 0.2 + (kk / Math.max(1, n - 1)) * 0.7;
          window.setTimeout(() => soundOrbit(R, 520), kk * Math.max(40, e.spreadMs / n));
        }
        try {
          haptics.ripple(0.3);
        } catch {
          /* noop */
        }
      },

      // velocity dispersion: the disc heats, then cools back into order
      scatter: ({ intensity }) => {
        if (reduced) return;
        heat = clamp01(heat + 0.4 + intensity * 0.5);
        stirTurbulence(0.2 + intensity * 0.3);
        try {
          audio.playNote(26, 700);
          haptics.chop();
        } catch {
          /* noop */
        }
      },

      gravity: ({ beta, gamma }) => {
        if (reduced) return;
        tiltX = clamp(gamma / 45, -1, 1);
        tiltY = clamp((beta - 45) / 60, -1, 1);
      },

      // the bar answers — the heaviest thing in the room rings lowest,
      // and a firmer rap rings it longer and brighter
      knock: ({ intensity }) => {
        if (reduced) return;
        const k = clamp01(intensity);
        barFlash = 0.6 + k * 0.4;
        addFlare(0, 0, 0.5 + k * 0.5);
        try {
          audio.thud();
          audio.playNote(
            Math.round(patternMidiFor(omegaP, pitch)) - 12,
            Math.round(1100 + k * 1400),
          );
          haptics.detent();
        } catch {
          /* noop */
        }
      },

      // night: the stars go out, and the wave glows on without them
      night: ({ faceDown }) => {
        nightTarget = faceDown ? 1 : 0;
        if (faceDown) revealTarget = Math.max(revealTarget, 0.45);
        else if (revealTarget <= 0.45) revealTarget = 0;
      },

      // breath on the disc fans whatever gas is standing in it
      breath: ({ strength }) => {
        let touched = false;
        regionsRef.current = regionsRef.current.map((r) => {
          if (regionLife(r, tau) <= 0.02) return r;
          touched = true;
          return { ...r, strength: clamp01(r.strength + 0.25 * strength) };
        });
        if (touched) {
          save();
          try {
            haptics.ripple(0.3);
          } catch {
            /* noop */
          }
        } else {
          stirTurbulence(0.06 * strength);
        }
      },
    };

    // The hand leaving is not a gesture, so the engine cannot report it: the
    // hold's ticks simply stop. A ride that has heard nothing for a quarter
    // second is a finger that has gone, and the disc lets it go.
    const HAND_GONE_MS = 260;

    // The keyboard says the same things. Held Enter walks the same three
    // tiers the finger does, so nothing here is touch-only.
    keyboardRef.current = {
      enter: () => {
        // pick the nearest star to the ring, ahead of the eye
        let best = -1;
        let bestD = 1e9;
        for (let i = 0; i < count; i += PICK_STRIDE * 7) {
          const d = Math.abs(field.r[i] - selR);
          if (d > 0.05) continue;
          const sp = starPos(i);
          const p = project(sp.x, sp.y, sp.z);
          if (!p) continue;
          const dd = Math.abs(p.x - width / 2) + Math.abs(p.y - height / 2);
          if (dd < bestD) {
            bestD = dd;
            best = i;
          }
        }
        startFollow(best);
        kbHold = 0;
        lastDeepenAt = performance.now();
      },
      enterHeld: (elapsed) => {
        lastDeepenAt = performance.now();
        kbHold = clamp01(elapsed / 3200);
        followTarget = clamp01(0.15 + kbHold);
        if (elapsed > 900 && seeding < 0) {
          const th = selR > 0 ? patPhase * 0.5 : 0;
          seeding = seedRegion(selR * Math.cos(th), selR * Math.sin(th));
          seedTier = 2;
        } else if (seeding >= 0) {
          const reg = regionsRef.current[seeding];
          if (reg) {
            regionsRef.current[seeding] = {
              ...reg,
              strength: clamp01(0.18 + (elapsed - 900) / 2600),
            };
          }
          if (elapsed > 2500 && seedTier < 3) {
            seedTier = 3;
            try {
              haptics.detent();
            } catch {
              /* noop */
            }
          }
        }
      },
      escape: () => {
        if (lensSnapped === 1) setLens(0);
        revealTarget = 0;
        if (seeding >= 0) {
          // the keyboard's ceremony: a hold released past the tier ignites
          if (seedTier >= 3) igniteRegion(seeding);
          seeding = -1;
          seedTier = 0;
        }
        endFollow();
      },
      arrow: (dx, dy) => {
        if (dx !== 0) {
          panX = clamp(panX + dx * 0.08, -1.2, 1.2);
          return;
        }
        // the selection ring walks the rotation curve; each step is heard
        selR = clamp(selR + dy * 0.06, 0.14, R_MAX);
        soundOrbit(selR, 420);
      },
    };

    glimmerRef.current = () => {
      glimmer = 1;
    };

    // ——— the loop ———
    const flareVec = new Float32Array(MAX_FLARES * 4);
    const regionVec = new Float32Array(REGION_MAX * 4);
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const delta = Math.min(64, now - last);
      last = now;
      const dt = delta / 1000;

      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dt * 5);
      if (!reduced) {
        tau += dt * timeScale;
        patPhase += omegaP * dt * timeScale;
      }
      omegaP += (omegaPTarget - omegaP) * Math.min(1, dt * 3);
      pitch += (pitchTarget - pitch) * Math.min(1, dt * 3);
      bar += (barTarget - bar) * Math.min(1, dt * 1.6);
      reveal += (revealTarget - reveal) * Math.min(1, dt * (revealTarget > reveal ? 3.4 : 0.9));
      lens += (lensTarget - lens) * Math.min(1, dt * 6);
      night += (nightTarget - night) * Math.min(1, dt * 1.6);
      followLevel += (followTarget - followLevel) * Math.min(1, dt * 4);
      heat = Math.max(0, heat - dt * 0.4);
      barFlash = Math.max(0, barFlash - dt * 1.2);
      roll += rollVel * dt;
      rollVel *= Math.exp(-dt * 1.6);
      panX = clamp(panX + panVX * dt * 60 * 0.02, -1.2, 1.2);
      panY = clamp(panY + panVY * dt * 60 * 0.02, -1, 1);
      panVX *= Math.exp(-dt * 1.1);
      panVY *= Math.exp(-dt * 1.1);
      if (entering > 0) entering = Math.max(0, entering - dt * 0.7);
      if (leaving > 0) leaving = Math.min(1, leaving + dt * 2);
      if (glimmer > 0) glimmer = Math.max(0, glimmer - dt * 0.5);
      if ((followIdx >= 0 || seeding >= 0) && now - lastDeepenAt > HAND_GONE_MS) {
        seeding = -1;
        seedTier = 0;
        endFollow();
      }
      for (const f of flares) f.age += dt;
      while (flares.length && flares[0].age > 1.6) flares.shift();

      const t = audio.getAudioTime() ?? now / 1000;
      const breath = reduced ? 0.5 : Math.sin(t * Math.PI * 2 * 0.14) * 0.5 + 0.5;
      // the band's own breath: one swell every ~42 s, per the register
      const slow = reduced ? 0.5 : Math.sin(t * Math.PI * 2 * GALAXY_LFO_HZ) * 0.5 + 0.5;

      const k = waveNumber(pitch);
      const corot = corotationRadius(omegaP);

      // ——— the disc acts on what the hand planted ———
      // Shells run, sweep, and light the next patch of gas they reach —
      // propagating star formation, the rule that lives in lib/spiral.ts and
      // is pinned there. Spent regions are retired; the room does not hoard.
      if (regionsRef.current.length) {
        const step = propagate(regionsRef.current, tau);
        if (step.lit.length) {
          regionsRef.current = step.regions;
          for (const idx of step.lit) {
            const rp = regionAt(regionsRef.current[idx], tau);
            addFlare(rp.x, rp.y, 0.75);
            soundOrbit(regionsRef.current[idx].R0, 620, 0.9);
          }
          stirTurbulence(0.12);
          try {
            audio.chime();
            haptics.detent();
          } catch {
            /* noop */
          }
          save();
        }
        // Scan before allocating: on almost every frame nothing has died, and
        // the array should not be rebuilt (and garbage produced) just to
        // confirm that.
        let anyDead = false;
        for (let i = 0; i < regionsRef.current.length; i++) {
          if (regionLife(regionsRef.current[i], tau) <= 0.01) {
            anyDead = true;
            break;
          }
        }
        if (anyDead) {
          const alive = regionsRef.current.filter((r) => regionLife(r, tau) > 0.01);
          regionsRef.current = alive;
          if (seeding >= alive.length) seeding = -1;
          save();
        }
      }
      // upload the regions the shaders read: x, z, strength, shell radius
      for (let i = 0; i < REGION_MAX; i++) {
        const reg = regionsRef.current[i];
        if (!reg) {
          regionVec[i * 4] = 0;
          regionVec[i * 4 + 1] = 0;
          regionVec[i * 4 + 2] = 0;
          regionVec[i * 4 + 3] = 0;
          continue;
        }
        const rp = regionAt(reg, tau);
        regionVec[i * 4] = rp.x;
        regionVec[i * 4 + 1] = rp.y;
        regionVec[i * 4 + 2] = reg.strength * regionLife(reg, tau);
        regionVec[i * 4 + 3] = reg.ignited >= 0 ? shellRadius(tau - reg.ignited) : 0;
      }

      // The followed star's disc position, resolved once per frame — the
      // same starState result the crest-crossing check, the camera lean, the
      // shader uniform and the overlay mark all read below, instead of each
      // re-deriving it (and each allocating its own result) separately.
      const followPos = followIdx >= 0 && followLevel > 0.02 ? starPos(followIdx) : null;

      // ——— the followed star: ride the orbit, feel every arm go by ———
      if (followPos && followLevel > 0.05) {
        const sp = followPos;
        // one felt tick per crest crossed — the crest sits at the Jacobian's
        // own phase atan(k), and the tick rate is m·|Ω − Ωp| and no other
        // (armCrossingHz in lib/spiral.ts, where the tests pin it)
        const crest = Math.atan2(k, 1);
        const before = lastFollowChi;
        lastFollowChi = sp.chi;
        let dBefore = before - crest;
        let dNow = sp.chi - crest;
        while (dBefore > Math.PI) dBefore -= TAU;
        while (dBefore < -Math.PI) dBefore += TAU;
        while (dNow > Math.PI) dNow -= TAU;
        while (dNow < -Math.PI) dNow += TAU;
        if (dBefore * dNow < 0 && Math.abs(dBefore) + Math.abs(dNow) < 1.2) {
          followCrossings += 1;
          addFlare(sp.x, sp.z, 0.6);
          soundOrbit(field.r[followIdx], 500, 0.9);
          try {
            haptics.detent();
          } catch {
            /* noop */
          }
        }
      }

      // ——— the camera: standing off a turning disc, leaning with the hand ———
      const T = reduced ? 0 : tau;
      const yaw = (reduced ? 0 : 0.05 * Math.sin(T * 0.021)) + panX * 1.6 + tiltX * 0.25 + T * 0.011;
      // the frame runs the whole way: straight down on the disc (−π/2) to
      // flat along its rim, where the room becomes the band it hands to
      const pitchCam = clamp(
        -0.52 + (reduced ? 0 : 0.06 * Math.sin(T * 0.017)) - panY * 1.05 + tiltY * 0.22,
        -1.55,
        -0.02,
      );
      setBasis(yaw, pitchCam, roll + (reduced ? 0 : 0.03 * Math.sin(T * 0.013)));
      // Frame the disc by the narrow axis, but never retreat so far that a
      // tall phone frame turns the galaxy into a coin: past the cap the rim
      // is allowed to run off the sides, which is what standing closer means.
      const fit = Math.min(2.05, Math.max(BASE_RANGE, (0.98 * FOCAL) / Math.max(0.4, aspect)));
      fitScale = fit / BASE_RANGE;
      const range = fit * (1 - 0.24 * followLevel) + (reduced ? 0 : 0.05 * Math.sin(T * 0.019));
      // the eye leans toward a ridden star, but never leaves the room
      let cx = 0;
      let cz = 0;
      if (followPos) {
        cx = followPos.x * 0.5 * followLevel;
        cz = followPos.z * 0.5 * followLevel;
      }
      cam.x = cx - basis.fx * range;
      cam.y = 0.03 - basis.fy * range;
      cam.z = cz - basis.fz * range;

      // ——— glimmer: after ~20s the wave brightens once, unasked ———
      if (now - lastInteractionAt > 20000 && now - glimmerAt > 11000 && !reduced) {
        glimmerAt = now;
        glimmer = 1;
      }

      // ——— render: two draws, and the CPU touches no star ———
      if (glOk && stage && gl && discProg && starProg && discQuad && starDraw) {
        // The stage sizes, viewports, and binds the shared clocks; the room
        // adds only what is its own.
        stage.beginFrame(
          clocksFrom({
            time: t,
            turbulence: getTurbulence(),
            register: spectralRegisterFor(GALAXY_SCALE_S),
            reducedMotion: reduced,
          }),
          discProg,
        );
        gl.disable(gl.BLEND);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        discProg.use();
        discProg.setVec2("u_res", stage.size.pixelWidth, stage.size.pixelHeight);
        discProg.setVec3("u_cam", cam.x, cam.y, cam.z);
        discProg.setVec3("u_right", basis.rx, basis.ry, basis.rz);
        discProg.setVec3("u_up", basis.ux, basis.uy, basis.uz);
        discProg.setVec3("u_fwd", basis.fx, basis.fy, basis.fz);
        discProg.setFloat("u_focal", FOCAL);
        discProg.setFloat("u_aspect", aspect);
        discProg.setFloat("u_patPhase", patPhase % TAU);
        discProg.setFloat("u_k", k);
        discProg.setFloat("u_amp", 1);
        discProg.setFloat("u_bar", bar);
        discProg.setFloat("u_corot", corot);
        discProg.setFloat("u_reveal", reveal);
        discProg.setFloat("u_night", night);
        discProg.setFloat("u_breath", 0.4 * breath + 0.6 * slow);
        discProg.setFloat("u_lens", lens);
        discProg.setFloat("u_glimmer", glimmer);
        discProg.setFloat("u_barFlash", barFlash);
        discProg.setFloat("u_tw", reduced ? 0 : t);
        discProg.setFloatArray("u_regions", regionVec);
        discQuad.draw();

        // the population: one instanced draw over the typed arrays
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        starProg.use();
        if (keptDirty) {
          keptDirty = false;
          starDraw.attribute("a_kept", keptArr, 1, 1);
        }
        starProg.setVec3("u_cam", cam.x, cam.y, cam.z);
        starProg.setVec3("u_right", basis.rx, basis.ry, basis.rz);
        starProg.setVec3("u_up", basis.ux, basis.uy, basis.uz);
        starProg.setVec3("u_fwd", basis.fx, basis.fy, basis.fz);
        starProg.setFloat("u_focal", FOCAL);
        starProg.setFloat("u_aspect", aspect);
        starProg.setFloat("u_fit", fitScale);
        starProg.setFloat("u_tau", tau);
        starProg.setFloat("u_patPhase", patPhase);
        starProg.setFloat("u_k", k);
        starProg.setFloat("u_amp", 1);
        starProg.setFloat("u_bar", bar);
        starProg.setFloat("u_heat", heat);
        starProg.setFloat("u_lum", LUM);
        starProg.setFloat("u_reveal", reveal);
        starProg.setFloat("u_night", night);
        starProg.setFloat("u_breath", breath);
        for (let i = 0; i < MAX_FLARES; i++) {
          const f = flares[i];
          flareVec[i * 4] = f ? f.x : 0;
          flareVec[i * 4 + 1] = f ? f.y : 0;
          flareVec[i * 4 + 2] = f ? f.s * Math.max(0, 1 - f.age / 1.6) : 0;
          flareVec[i * 4 + 3] = 0;
        }
        starProg.setFloatArray("u_flares", flareVec);
        starProg.setFloatArray("u_regions", regionVec);
        if (followPos) {
          starProg.setVec3("u_follow", followPos.x, followPos.z, followLevel);
        } else {
          starProg.setVec3("u_follow", 0, 0, 0);
        }
        starDraw.draw(gl.TRIANGLE_STRIP, 4, count);
        starDraw.reset();
      }

      // ——— the overlay ———
      ctx.clearRect(0, 0, width, height);
      if (!glOk) {
        // no context: the disc still stands, drawn flat
        ctx.fillStyle = "#04070f";
        ctx.fillRect(0, 0, width, height);
        const p = waveParams();
        const step = Math.max(1, Math.floor(count / 5000));
        for (let i = 0; i < count; i += step) {
          const st = starState(field.r[i], field.theta[i], tau, p);
          const pr = project(st.x, field.z[i], st.y);
          if (!pr) continue;
          const b = clamp01(0.25 + 0.4 * field.size[i]) / (0.5 + pr.z);
          ctx.fillStyle = `rgba(230, 228, 218, ${b})`;
          ctx.fillRect(pr.x, pr.y, 1.4, 1.4);
        }
      }

      // the lens: the geometry under the light — the crest's own log
      // spiral, the corotation circle, and the rotation curve itself
      if (lens > 0.02) {
        ctx.lineWidth = 1;
        const shift = Math.atan2(k, 1);
        for (let arm = 0; arm < ARM_M; arm++) {
          ctx.strokeStyle = `rgba(140, 176, 206, ${clamp01(lens * 0.5)})`;
          ctx.beginPath();
          let started = false;
          for (let s = 0; s <= 60; s++) {
            const R = 0.16 + (s / 60) * 0.92;
            const th = patPhase + (shift + TAU * arm) / ARM_M + (k / ARM_M) * Math.log(R / R_REF);
            const p = project(R * Math.cos(th), 0, R * Math.sin(th));
            if (!p) {
              started = false;
              continue;
            }
            if (!started) {
              ctx.moveTo(p.x, p.y);
              started = true;
            } else ctx.lineTo(p.x, p.y);
          }
          ctx.stroke();
        }
        // corotation: the one circle where star and pattern agree
        ctx.strokeStyle = `rgba(231, 172, 82, ${clamp01(lens * 0.55)})`;
        ctx.beginPath();
        let started = false;
        for (let s = 0; s <= 72; s++) {
          const th = (s / 72) * TAU;
          const p = project(corot * Math.cos(th), 0, corot * Math.sin(th));
          if (!p) {
            started = false;
            continue;
          }
          if (!started) {
            ctx.moveTo(p.x, p.y);
            started = true;
          } else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        // the rotation curve, drawn in the corner: flat where the halo holds
        const gw = Math.min(200, width * 0.4);
        const gh = 64;
        const gx = 18;
        const gy = height - gh - 76;
        ctx.strokeStyle = `rgba(242, 238, 230, ${lens * 0.28})`;
        ctx.strokeRect(gx, gy, gw, gh);
        ctx.beginPath();
        ctx.strokeStyle = `rgba(140, 176, 206, ${lens * 0.8})`;
        for (let s = 0; s <= 48; s++) {
          const R = (s / 48) * R_MAX;
          const vx = gx + (R / R_MAX) * gw;
          const vy = gy + gh - (orbitalSpeed(R) / V_FLAT) * (gh - 8);
          if (s === 0) ctx.moveTo(vx, vy);
          else ctx.lineTo(vx, vy);
        }
        ctx.stroke();
        // corotation's mark on the same axis
        ctx.strokeStyle = `rgba(231, 172, 82, ${lens * 0.7})`;
        ctx.beginPath();
        ctx.moveTo(gx + (corot / R_MAX) * gw, gy);
        ctx.lineTo(gx + (corot / R_MAX) * gw, gy + gh);
        ctx.stroke();
      }

      // the keyboard's ring on the disc — the rotation curve, walkable
      if (document.activeElement === wrap && followIdx < 0) {
        ctx.strokeStyle = "rgba(242, 238, 230, 0.16)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        let started = false;
        for (let s = 0; s <= 72; s++) {
          const th = (s / 72) * TAU;
          const p = project(selR * Math.cos(th), 0, selR * Math.sin(th));
          if (!p) {
            started = false;
            continue;
          }
          if (!started) {
            ctx.moveTo(p.x, p.y);
            started = true;
          } else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }
      // the followed star's mark
      if (followPos) {
        const p = project(followPos.x, followPos.y, followPos.z);
        if (p) {
          ctx.strokeStyle = `rgba(242, 238, 230, ${0.25 + followLevel * 0.5})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 12 + followLevel * 26 + breath * 3, 0, TAU);
          ctx.stroke();
        }
      }

      // what the hand planted, marked by the arc the shear has drawn it
      // into: a knot seeded round is a stroke by the time you come back
      for (const reg of regionsRef.current) {
        const life = regionLife(reg, tau);
        if (life <= 0.02) continue;
        const span = Math.min(Math.PI * 1.6, shearedSpan(reg.R0, REGION_HALF_WIDTH, tau - reg.born));
        const here = regionAt(reg, tau).theta;
        ctx.strokeStyle = `rgba(150, 184, 232, ${clamp01(0.1 + 0.3 * life * reg.strength)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        let on = false;
        for (let sIdx = 0; sIdx <= 24; sIdx++) {
          const th = here + (sIdx / 24 - 0.5) * span;
          const pp = project(reg.R0 * Math.cos(th), 0, reg.R0 * Math.sin(th));
          if (!pp) {
            on = false;
            continue;
          }
          if (!on) {
            ctx.moveTo(pp.x, pp.y);
            on = true;
          } else ctx.lineTo(pp.x, pp.y);
        }
        ctx.stroke();
      }

      // arrival and departure, both as an exhale
      const fade = Math.max(entering, leaving);
      if (fade > 0.002) {
        ctx.fillStyle = `rgba(4, 7, 15, ${fade})`;
        ctx.fillRect(0, 0, width, height);
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      observer.disconnect();
      mq.removeEventListener?.("change", onMq);
      cancelAnimationFrame(raf);
      writer.flush();
      discQuad?.dispose();
      starDraw?.dispose();
      stage?.dispose();
      stageRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const letGo = () => {
    keptRef.current = [];
    regionsRef.current = [];
    clearRef.current();
    try {
      window.localStorage.setItem(
        STORE_KEY,
        JSON.stringify({ kept: [], regions: [], cleared: true }),
      );
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
    <RoomShell
      route="/galaxy"
      voice={voice}
      keyboard={keyboard}
      onGlimmer={() => glimmerRef.current()}
      letGo={{ label: "let the disc forget", onLetGo: letGo, visible: hasKept }}
      surfaceRef={wrapRef}
      style={{ position: "fixed", inset: 0, background: "#04070f" }}
    >
      <div
        ref={wrapRef}
        tabIndex={0}
        role="application"
        aria-label="a spiral galaxy turning from inside its arms"
        data-lens-raised={lensUp ? "1" : undefined}
        style={{
          position: "absolute",
          inset: 0,
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
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        />
      </div>
    </RoomShell>
  );
}
