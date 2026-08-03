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

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { onVessel } from "@/lib/vessel";
import { stirTurbulence } from "@/lib/turbulence";
import LetGo from "@/components/LetGo";
import {
  ARM_M,
  AZ_FACTOR,
  BAR_AMP,
  BAR_REACH,
  GALAXY_LFO_HZ,
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

const VERT_QUAD = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

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
        float att = clamp(abs(rd.y) * 2.6, 0.25, 1.0) / (1.0 + t * t * 0.35);

        vec3 warm = vec3(0.784, 0.451, 0.165);  // --candle
        vec3 pale = vec3(0.949, 0.933, 0.902);  // --paper
        vec3 cold = vec3(0.34, 0.52, 0.94);     // the young light
        vec3 gold = vec3(0.93, 0.72, 0.33);     // the old light

        // the smooth disc: old starlight, dimmed by night
        float base = sigma * 0.42 * (0.85 + 0.3 * u_breath) * (1.0 - 0.8 * u_night);
        // the wave: gas lit along the crest — this term survives the night
        float wave = sigma * env * u_amp * crest * (0.7 + 0.3 * u_breath)
                   * (1.0 + 0.6 * u_glimmer) * (1.0 - 0.25 * u_night) * 1.5;
        vec3 acc = mix(warm, pale, 0.35) * base
                 + mix(cold, pale, 0.3) * wave * (1.0 + 1.6 * u_reveal);
        // the dust lane bites the inner edge of the arm
        acc *= 1.0 - 0.55 * dust * env * (1.0 - 0.6 * u_reveal);
        // bulge, and the bar locked to the pattern
        float xb = R * cos(th - u_patPhase);
        float yb = R * sin(th - u_patPhase);
        float bulge = exp(-R * R / 0.017);
        float barg = u_bar * exp(-pow(xb / 0.32, 2.0) - pow(yb / 0.09, 2.0));
        acc += mix(gold, warm, 0.4) * (bulge * (0.9 + 0.7 * u_barFlash) + barg * 0.7)
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

  float extent = (0.0034 + 0.0062 * szr + 0.0036 * young + 0.0042 * inb + 0.005 * a_kept);
  // capped well under clip: a star sweeping near the eye stays a star,
  // never a blob the size of the frame
  float r = min(extent / zc, 0.038);
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
           * clamp(u_fit, 0.9, 1.12);

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
    const save = () => writeStore();

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
    const BASE_RANGE = 1.32;
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
      let bestD = 40 * 40;
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
      writeStore();
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
      writeStore();
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
      writeStore();
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

    // ——— geometry ———
    const dpr = () => Math.min(1.5, window.devicePixelRatio || 1);
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
    let discProg: WebGLProgram | null = null;
    let starProg: WebGLProgram | null = null;
    let quadBuf: WebGLBuffer | null = null;
    let cornerBuf: WebGLBuffer | null = null;
    let orbitBuf: WebGLBuffer | null = null;
    let seedBuf: WebGLBuffer | null = null;
    let keptBuf: WebGLBuffer | null = null;
    type Uni = Record<string, WebGLUniformLocation | null>;
    let discU: Uni = {};
    let starU: Uni = {};
    let starA: Record<string, number> = {};

    const divisor = (loc: number, d: number) => {
      if (gl2) gl2.vertexAttribDivisor(loc, d);
      else angle?.vertexAttribDivisorANGLE(loc, d);
    };
    const drawInstanced = (verts: number, instances: number) => {
      if (gl2) gl2.drawArraysInstanced(gl2.TRIANGLE_STRIP, 0, verts, instances);
      else angle?.drawArraysInstancedANGLE(gl!.TRIANGLE_STRIP, 0, verts, instances);
    };

    if (gl && (gl2 || angle)) {
      const compile = (type: number, src: string) => {
        const sh = gl.createShader(type);
        if (!sh) return null;
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
          if (process.env.NODE_ENV !== "production") {
            // eslint-disable-next-line no-console
            console.error("[galaxy] shader", gl.getShaderInfoLog(sh));
          }
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
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
          if (process.env.NODE_ENV !== "production") {
            // eslint-disable-next-line no-console
            console.error("[galaxy] link", gl.getProgramInfoLog(p));
          }
          return null;
        }
        return p;
      };
      discProg = link(VERT_QUAD, FRAG_DISC);
      starProg = link(VERT_STAR, FRAG_STAR);
      if (discProg && starProg) {
        glOk = true;
        const mk = (data: Float32Array, usage: number) => {
          const b = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, b);
          gl.bufferData(gl.ARRAY_BUFFER, data, usage);
          return b;
        };
        quadBuf = mk(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        cornerBuf = mk(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        orbitBuf = mk(orbitArr, gl.STATIC_DRAW);
        seedBuf = mk(seedArr, gl.STATIC_DRAW);
        keptBuf = mk(keptArr, gl.DYNAMIC_DRAW);

        const uni = (p: WebGLProgram, names: string[]) => {
          const out: Uni = {};
          for (const n of names) out[n] = gl.getUniformLocation(p, n);
          return out;
        };
        discU = uni(discProg, [
          "u_res", "u_cam", "u_right", "u_up", "u_fwd", "u_focal", "u_aspect",
          "u_patPhase", "u_k", "u_amp", "u_bar", "u_corot",
          "u_reveal", "u_night", "u_breath", "u_lens", "u_glimmer", "u_barFlash",
          "u_tw", "u_regions",
        ]);
        starU = uni(starProg, [
          "u_cam", "u_right", "u_up", "u_fwd", "u_focal", "u_aspect", "u_fit",
          "u_tau", "u_patPhase", "u_k", "u_amp", "u_bar", "u_heat",
          "u_reveal", "u_night", "u_breath", "u_flares", "u_follow", "u_regions",
        ]);
        starA = {
          corner: gl.getAttribLocation(starProg, "a_corner"),
          orbit: gl.getAttribLocation(starProg, "a_orbit"),
          seed: gl.getAttribLocation(starProg, "a_seed"),
          kept: gl.getAttribLocation(starProg, "a_kept"),
        };
      }
    }

    // ——— the grammar ———
    const detachGestures = attachGestures(
      glCanvas,
      {
        tap: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 2) return; // step back — ScaleTravel's verb
          if (e.fingers === 3) {
            tutti();
            return;
          }
          if (e.fingers !== 1) return;
          const { x, y } = toLocal(e.x, e.y);
          // a second tap on a knot blows it out — the room's removal verb,
          // and the only thing a double tap means here
          if (e.count >= 2) {
            const ri = regionIndexAt(x, y);
            if (ri >= 0) {
              disperseRegion(ri);
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
          // open dark: the disc answers once, low, from underneath
          stirTurbulence(0.04);
          try {
            audio.playNote(Math.round(patternMidiFor(omegaP, pitch)) - 12, 900);
            haptics.tap();
          } catch {
            /* noop */
          }
        },
        hold: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 3) {
            // the law, held still: the veil lifts, the clock stretches, and
            // holding into the ceremony grows the bar at the centre
            if (e.phase === "enter") {
              revealTarget = 0.6;
              timeScaleTarget = 0.3;
              try {
                audio.playNote(Math.round(patternMidiFor(omegaP, pitch)) - 12, 2400);
                haptics.roll();
              } catch {
                /* noop */
              }
            }
            if (e.phase === "tick") {
              revealTarget = clamp01(0.6 + e.elapsed / 6000);
              if (e.elapsed > 2500) {
                barTarget = clamp01(barTarget + 0.008);
                if (barTarget > 0.02 && barTarget < 0.06) {
                  try {
                    haptics.detent();
                  } catch {
                    /* noop */
                  }
                }
              }
            }
            if (e.phase === "release") {
              revealTarget = 0;
              timeScaleTarget = 1;
            }
            return;
          }
          if (e.fingers !== 1) return;
          if (e.phase === "enter") {
            const { x, y } = toLocal(e.x, e.y);
            const s = starAt(x, y);
            if (s >= 0) {
              startFollow(s);
              return;
            }
            // no star under the finger: the hold gathers gas instead, and
            // the disc gets something that was not there before
            const dp = discPointAt(x, y);
            if (dp) {
              seeding = seedRegion(dp.x, dp.z);
              seedTier = 0;
            }
            return;
          }
          if (e.phase === "release") {
            if (seeding >= 0) {
              // held into the ceremony, the knot goes off on release —
              // and its shell will light whatever gas it reaches
              if (e.tier >= 3) igniteRegion(seeding);
              else writeStore();
              seeding = -1;
              seedTier = 0;
              return;
            }
            endFollow();
            return;
          }
          if (seeding >= 0) {
            // duration is an axis: the longer the hold, the more gas
            const reg = regionsRef.current[seeding];
            if (!reg) {
              seeding = -1;
              return;
            }
            regionsRef.current[seeding] = {
              ...reg,
              strength: clamp01(0.18 + e.elapsed / 3400),
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
            return;
          }
          if (followIdx < 0) return;
          // duration is an axis: the longer the ride, the closer the eye
          followTarget = clamp01(0.15 + e.elapsed / 3200);
        },
        // two fingers hold the frame: the eye swings round the disc and
        // tips it from face-on to edge-on. Pinch stays ScaleTravel's.
        pan2: (e) => {
          lastInteractionAt = performance.now();
          if (e.phase !== "move") return;
          panX = clamp(panX - (e.dx / Math.max(1, width)) * 1.7, -1.2, 1.2);
          panY = clamp(panY + (e.dy / Math.max(1, height)) * 1.5, -1, 1);
        },
        drag: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 3) {
            // the law, dragged: sideways winds the pattern speed, up and
            // down opens or closes the arms — and the register follows
            omegaPTarget = clamp(omegaPTarget * (1 + e.dx * 0.0018), OMEGA_P_MIN, OMEGA_P_MAX);
            pitchTarget = clamp(pitchTarget - e.dy * 0.0012, PITCH_MIN, PITCH_MAX);
            soundLaw(performance.now());
            return;
          }
          if (e.fingers !== 1) return;
          if (e.phase === "end") {
            panVX += e.vx * 0.0004;
            panVY += e.vy * 0.0004;
            return;
          }
          panX = clamp(panX - (e.dx / Math.max(1, width)) * 1.5, -1.2, 1.2);
          panY = clamp(panY + (e.dy / Math.max(1, height)) * 1.2, -1, 1);
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
            // three fingers turn the pattern itself — the season, by hand
            patPhase += e.angle * 0.8;
            soundLaw(performance.now(), 500);
            return;
          }
          if (e.phase === "move") lensTarget = clamp01(lensTarget + e.angle / 1.7);
          else if (e.phase === "end") setLens(lensTarget > 0.5 ? 1 : 0);
        },
        scrub: (e) => {
          lastInteractionAt = performance.now();
          rollVel += e.angularVelocity * 0.02;
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
        // velocity dispersion: the disc heats, then cools back into order
        heat = clamp01(heat + 0.4 + intensity * 0.5);
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
        // the bar answers — the heaviest thing in the room rings lowest
        barFlash = 1;
        addFlare(0, 0, 0.8);
        try {
          audio.thud();
          audio.playNote(Math.round(patternMidiFor(omegaP, pitch)) - 12, 1600);
          haptics.detent();
        } catch {
          /* noop */
        }
      },
      flip: ({ faceDown }) => {
        // night: the stars go out, and the wave glows on without them
        nightTarget = faceDown ? 1 : 0;
        if (faceDown) revealTarget = Math.max(revealTarget, 0.45);
        else if (revealTarget <= 0.45) revealTarget = 0;
      },
    });

    // ——— keyboard ———
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        if (lensSnapped === 1) setLens(0);
        revealTarget = 0;
        endFollow();
        return;
      }
      if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        panX = clamp(panX + (ev.key === "ArrowRight" ? 0.08 : -0.08), -1.2, 1.2);
        return;
      }
      if (ev.key === "ArrowUp" || ev.key === "ArrowDown") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        // the selection ring walks the rotation curve; each step is heard
        selR = clamp(selR + (ev.key === "ArrowUp" ? -0.06 : 0.06), 0.14, R_MAX);
        soundOrbit(selR, 420);
        return;
      }
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        if (!ev.repeat) {
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
          kbHold = 0.1;
          return;
        }
        kbHold = clamp01(kbHold + 0.03);
        followTarget = clamp01(0.15 + kbHold);
        return;
      }
      if (ev.key === "v" || ev.key === "V") {
        lastInteractionAt = performance.now();
        if (!ev.repeat) {
          vHeldSince = performance.now();
          revealTarget = revealTarget > 0.05 ? 0 : 0.8;
          if (revealTarget > 0) {
            try {
              audio.playNote(Math.round(patternMidiFor(omegaP, pitch)) - 12, 2000);
              haptics.roll();
            } catch {
              /* noop */
            }
          }
        } else if (performance.now() - vHeldSince > 2500) {
          // the keyboard's ceremony: a held veil grows the bar too
          barTarget = clamp01(barTarget + 0.01);
        }
      }
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " ") endFollow();
      if (ev.key === "v" || ev.key === "V") vHeldSince = 0;
    };
    wrap.addEventListener("keydown", onKeyDown);
    wrap.addEventListener("keyup", onKeyUp);

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
          writeStore();
        }
        const alive = regionsRef.current.filter((r) => regionLife(r, tau) > 0.01);
        if (alive.length !== regionsRef.current.length) {
          regionsRef.current = alive;
          if (seeding >= alive.length) seeding = -1;
          writeStore();
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

      // ——— the followed star: ride the orbit, feel every arm go by ———
      if (followIdx >= 0 && followLevel > 0.05) {
        const sp = starPos(followIdx);
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
      const fit = Math.max(BASE_RANGE, (0.98 * FOCAL) / Math.max(0.4, aspect));
      fitScale = fit / BASE_RANGE;
      const range = fit * (1 - 0.24 * followLevel) + (reduced ? 0 : 0.05 * Math.sin(T * 0.019));
      // the eye leans toward a ridden star, but never leaves the room
      let cx = 0;
      let cz = 0;
      if (followIdx >= 0 && followLevel > 0.02) {
        const sp = starPos(followIdx);
        cx = sp.x * 0.5 * followLevel;
        cz = sp.z * 0.5 * followLevel;
      }
      cam.x = cx - basis.fx * range;
      cam.y = 0.03 - basis.fy * range;
      cam.z = cz - basis.fz * range;

      // ——— glimmer: after ~20s the wave brightens once, unasked ———
      if (now - lastInteractionAt > 20000 && now - glimmerAt > 11000 && !reduced) {
        glimmerAt = now;
        glimmer = 1;
      }

      // ——— render ———
      if (glOk && gl && discProg && starProg) {
        const ratio = dpr();
        gl.viewport(0, 0, glCanvas.width, glCanvas.height);
        gl.disable(gl.BLEND);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(discProg);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        const aq = gl.getAttribLocation(discProg, "a_pos");
        gl.enableVertexAttribArray(aq);
        gl.vertexAttribPointer(aq, 2, gl.FLOAT, false, 0, 0);
        divisor(aq, 0);
        gl.uniform2f(discU.u_res ?? null, width * ratio, height * ratio);
        gl.uniform3f(discU.u_cam ?? null, cam.x, cam.y, cam.z);
        gl.uniform3f(discU.u_right ?? null, basis.rx, basis.ry, basis.rz);
        gl.uniform3f(discU.u_up ?? null, basis.ux, basis.uy, basis.uz);
        gl.uniform3f(discU.u_fwd ?? null, basis.fx, basis.fy, basis.fz);
        gl.uniform1f(discU.u_focal ?? null, FOCAL);
        gl.uniform1f(discU.u_aspect ?? null, aspect);
        gl.uniform1f(discU.u_patPhase ?? null, patPhase % TAU);
        gl.uniform1f(discU.u_k ?? null, k);
        gl.uniform1f(discU.u_amp ?? null, 1);
        gl.uniform1f(discU.u_bar ?? null, bar);
        gl.uniform1f(discU.u_corot ?? null, corot);
        gl.uniform1f(discU.u_reveal ?? null, reveal);
        gl.uniform1f(discU.u_night ?? null, night);
        gl.uniform1f(discU.u_breath ?? null, 0.4 * breath + 0.6 * slow);
        gl.uniform1f(discU.u_lens ?? null, lens);
        gl.uniform1f(discU.u_glimmer ?? null, glimmer);
        gl.uniform1f(discU.u_barFlash ?? null, barFlash);
        gl.uniform1f(discU.u_tw ?? null, reduced ? 0 : t);
        gl.uniform4fv(discU.u_regions ?? null, regionVec);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.disableVertexAttribArray(aq);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(starProg);
        if (keptDirty) {
          keptDirty = false;
          gl.bindBuffer(gl.ARRAY_BUFFER, keptBuf);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, keptArr);
        }
        const bind = (buf: WebGLBuffer | null, loc: number, size: number, div: number) => {
          if (loc < 0) return;
          gl.bindBuffer(gl.ARRAY_BUFFER, buf);
          gl.enableVertexAttribArray(loc);
          gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
          divisor(loc, div);
        };
        bind(cornerBuf, starA.corner, 2, 0);
        bind(orbitBuf, starA.orbit, 4, 1);
        bind(seedBuf, starA.seed, 4, 1);
        bind(keptBuf, starA.kept, 1, 1);
        gl.uniform3f(starU.u_cam ?? null, cam.x, cam.y, cam.z);
        gl.uniform3f(starU.u_right ?? null, basis.rx, basis.ry, basis.rz);
        gl.uniform3f(starU.u_up ?? null, basis.ux, basis.uy, basis.uz);
        gl.uniform3f(starU.u_fwd ?? null, basis.fx, basis.fy, basis.fz);
        gl.uniform1f(starU.u_focal ?? null, FOCAL);
        gl.uniform1f(starU.u_aspect ?? null, aspect);
        gl.uniform1f(starU.u_fit ?? null, fitScale);
        gl.uniform1f(starU.u_tau ?? null, tau);
        gl.uniform1f(starU.u_patPhase ?? null, patPhase);
        gl.uniform1f(starU.u_k ?? null, k);
        gl.uniform1f(starU.u_amp ?? null, 1);
        gl.uniform1f(starU.u_bar ?? null, bar);
        gl.uniform1f(starU.u_heat ?? null, heat);
        gl.uniform1f(starU.u_reveal ?? null, reveal);
        gl.uniform1f(starU.u_night ?? null, night);
        gl.uniform1f(starU.u_breath ?? null, breath);
        for (let i = 0; i < MAX_FLARES; i++) {
          const f = flares[i];
          flareVec[i * 4] = f ? f.x : 0;
          flareVec[i * 4 + 1] = f ? f.y : 0;
          flareVec[i * 4 + 2] = f ? f.s * Math.max(0, 1 - f.age / 1.6) : 0;
          flareVec[i * 4 + 3] = 0;
        }
        gl.uniform4fv(starU.u_flares ?? null, flareVec);
        gl.uniform4fv(starU.u_regions ?? null, regionVec);
        if (followIdx >= 0 && followLevel > 0.02) {
          const sp = starPos(followIdx);
          gl.uniform3f(starU.u_follow ?? null, sp.x, sp.z, followLevel);
        } else {
          gl.uniform3f(starU.u_follow ?? null, 0, 0, 0);
        }
        drawInstanced(4, count);
        for (const loc of Object.values(starA)) {
          if (loc >= 0) {
            divisor(loc, 0);
            gl.disableVertexAttribArray(loc);
          }
        }
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
      if (followIdx >= 0 && followLevel > 0.02) {
        const sp = starPos(followIdx);
        const p = project(sp.x, sp.y, sp.z);
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
      detachGestures();
      detachVessel();
      wrap.removeEventListener("keydown", onKeyDown);
      wrap.removeEventListener("keyup", onKeyUp);
      mq.removeEventListener?.("change", onMq);
      cancelAnimationFrame(raf);
      if (gl) {
        for (const b of [quadBuf, cornerBuf, orbitBuf, seedBuf, keptBuf]) {
          if (b) gl.deleteBuffer(b);
        }
        if (discProg) gl.deleteProgram(discProg);
        if (starProg) gl.deleteProgram(starProg);
      }
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
    <div
      ref={wrapRef}
      tabIndex={0}
      role="application"
      aria-label="a spiral galaxy turning from inside its arms"
      data-lens-raised={lensUp ? "1" : undefined}
      style={{
        position: "fixed",
        inset: 0,
        background: "#04070f",
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
      <LetGo label="let the disc forget" onLetGo={letGo} visible={hasKept} />
    </div>
  );
}
