"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { tapTrainDepth, tapTrainTier } from "@/lib/gesture/core";
import { onVessel } from "@/lib/vessel";
import { useField } from "@/store/field";
import GreekKeyFrame from "@/components/GreekKeyFrame";
import WaterText from "@/components/WaterText";
import LetGo from "@/components/LetGo";
import {
  onVisibility,
  onGalleryPause,
  resolveDpr,
  createFrameGovernor,
  isEmbeddedFrame,
  detailForTier,
} from "@/lib/room-runtime";

type WeatherCell = {
  id: number;
  kind: "vapor" | "storm";
  x: number;
  y: number;
  t0: number;
  strength: number;
  spread: number;
  drift: number;
  lift: number;
  phase: number;
  rain: number;
};

type WindStroke = {
  id: number;
  points: Array<{ x: number; y: number; t: number }>;
  t0: number;
  releasedAt: number | null;
  strength: number;
  vx: number;
  vy: number;
  hue: number;
};

type RainVeil = {
  id: number;
  x: number;
  y: number;
  t0: number;
  strength: number;
  width: number;
  slant: number;
  seed: number;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** A seeded 0..1 draw for the sky's own creations (the glyph flock born at
 *  mount, a tapped cell's traits) — never Math random, so the same run of
 *  taps grows the same weather. */
function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

/** Seeded draw for the idle glimmer spiral. Hoisted out of the render loop
 *  so the loop never allocates a fresh closure per frame while idle. */
function glimmerSeed(slot: number, n: number): number {
  const v = Math.sin((slot + n) * 127.1) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * /clouds — Olympus. The cloud floor.
 *
 * Air element of a four-element cosmology, rendered in a Minoan-Greek key.
 * Layer model:
 *   1. WebGL fragment shader: sky gradient + four cloud bands (cirrus,
 *      altostratus, cumulus, nimbus) painted from a 5-octave FBM. A 120s
 *      day-cycle interpolates between morning lilac → midday paper →
 *      afternoon rose → storm grey → deep purple. The cursor uv is passed
 *      to the shader so hovered sky thickens locally; pressing thickens
 *      further toward nimbus dark grey-lilac.
 *   2. 2D overlay: living vapor cells, drag-born wind shear, rain veils,
 *      lightning flash + lightning path, drifting Minoan air spirals at
 *      four altitudes, and the cloud-type labels along the right edge.
 *   3. DOM banners: <GreekKeyFrame /> on all four sides, plus the OLYMPUS title.
 *
 * The sky is an instrument: tap to condense vapor, drag to shear the cloud
 * field, and press for 0.8s+ to build a storm cell that takes lightning.
 * Thud + delayed bell makes the thunder. recordTape on each strike.
 *
 * prefers-reduced-motion freezes the day cycle and spiral drift; lightning
 * is still triggerable, but it never fires on its own.
 */
export default function Clouds() {
  // page-specific ambient bed: airy wind + bird-like tones
  useEffect(() => { getFieldAudio().setAmbientProfile("wind"); }, []);

  const wrapRef = useRef<HTMLDivElement>(null);
  const skyRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  const pointer = useRef<{
    x: number;
    y: number;
    uvx: number;
    uvy: number;
    over: boolean;
    pressed: boolean;
    pressStart: number;
  }>({ x: -1, y: -1, uvx: 0.5, uvy: 0.5, over: false, pressed: false, pressStart: 0 });

  // active lightning strikes (briefly painted by the overlay)
  const lightnings = useRef<
    Array<{ t0: number; segs: Array<{ x: number; y: number }>; flash: number }>
  >([]);

  // expressed sky phase 0..1, mirrored to DOM for banner color flip
  const [phaseLight, setPhaseLight] = useState(true);

  // Visible description popup for cloud-type label taps. Re-rendered in DOM.
  const [labelTip, setLabelTip] = useState<{
    name: string;
    text: string;
    top: string;
  } | null>(null);

  // Manual offset to the day-cycle phase (advanced by sun/moon glyph clicks).
  // Stored on the ref so the loop reads the live value without re-rendering.
  const phaseOffsetRef = useRef<number>(0);

  // current phase mirrored out of the render loop so the sun/moon glyph
  // shows the right icon (sun in day phases, moon in night phases).
  const [iconIsSun, setIconIsSun] = useState(true);
  const [pressCharge, setPressCharge] = useState(0);
  const [hasBuilt, setHasBuilt] = useState(false);
  const clearWeatherRef = useRef<() => void>(() => {});
  const weatherMarkIdRef = useRef(0);
  const [weatherMarks, setWeatherMarks] = useState<
    Array<{ id: number; label: string; level: number }>
  >([
    { id: 0, label: "thin air", level: 0.35 },
    { id: -1, label: "upper wind", level: 0.52 },
  ]);

  const addWeatherMark = (label: string, level: number) => {
    const id = ++weatherMarkIdRef.current;
    setWeatherMarks((marks) => [
      { id, label, level: clamp(level, 0, 1) },
      ...marks,
    ].slice(0, 4));
  };

  useEffect(() => {
    const wrap = wrapRef.current;
    const sky = skyRef.current;
    const overlay = overlayRef.current;
    if (!wrap || !sky || !overlay) return;
    const octx = overlay.getContext("2d");
    if (!octx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ── WebGL setup ─────────────────────────────────────────────────
    const gl =
      (sky.getContext("webgl", { antialias: false, premultipliedAlpha: false }) ||
        sky.getContext(
          "experimental-webgl" as "webgl",
          { antialias: false, premultipliedAlpha: false } as WebGLContextAttributes,
        )) as WebGLRenderingContext | null;

    let glProg: WebGLProgram | null = null;
    let uTimeLoc: WebGLUniformLocation | null = null;
    let uResLoc: WebGLUniformLocation | null = null;
    let uPhaseLoc: WebGLUniformLocation | null = null;
    let uCursorLoc: WebGLUniformLocation | null = null;
    let uPressLoc: WebGLUniformLocation | null = null;
    let uFlashLoc: WebGLUniformLocation | null = null;
    let uWindLoc: WebGLUniformLocation | null = null;
    let uDriftLoc: WebGLUniformLocation | null = null;
    let uPuffsLoc: WebGLUniformLocation | null = null;
    let uLensLoc: WebGLUniformLocation | null = null;
    let uSeasonLoc: WebGLUniformLocation | null = null;
    let uPanLoc: WebGLUniformLocation | null = null;
    let uMaxStepsLoc: WebGLUniformLocation | null = null;
    let vbo: WebGLBuffer | null = null;
    let lastChargeSync = 0;
    // 4 slots of vec4(uv.x, uv.y, strength, spare) handed to the shader each
    // frame — the hand's condensation, injected into the volume itself.
    const puffData = new Float32Array(16);

    const setupProgram = () => {
      if (!gl) return;
      const vert = `
        attribute vec2 a_pos;
        varying vec2 vUv;
        void main() {
          vUv = a_pos * 0.5 + 0.5;
          gl_Position = vec4(a_pos, 0.0, 1.0);
        }
      `;
      const frag = `
        precision highp float;
        uniform float uTime;
        uniform vec2 uRes;
        uniform float uPhase;   // 0..1 day cycle position
        uniform vec2 uCursor;   // uv 0..1, y up
        uniform float uPress;   // 0 = not pressed, 0..1 = held intensity
        uniform float uFlash;   // 0..1 short flash envelope
        uniform vec2 uWind;     // drag-driven shear vector
        uniform vec2 uDrift;    // accumulated wind travel, in cloud-field units
        uniform vec4 uPuffs[4]; // xy = screen uv, z = strength (<0 = storm cell), w = height bias
        // uLens: the sky as seen (0) → the moisture/temperature field, a
        // false-colour diagram (1) — two-finger twist, a level of
        // description. uSeason: the slow annual cycle, clear toward
        // overcast (three-finger twist). uPan: two fingers lean the view.
        uniform float uLens;
        uniform float uSeason;
        uniform vec2 uPan;
        // ray-march step budget — scaled down at lower performance tiers.
        uniform float uMaxSteps;
        varying vec2 vUv;

        // The cloud deck lives between these two altitudes. The camera sits
        // just under it, so the deck reads as a floor of heaps with towers
        // punching up through the shear line.
        const float DECK_BASE = 26.00;
        const float DECK_CEIL = 50.00;

        // ── noise ───────────────────────────────────────────────────
        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float hash13(vec3 p) {
          p = fract(p * 0.1031);
          p += dot(p, p.yzx + 33.33);
          return fract((p.x + p.y) * p.z);
        }
        float vnoise2(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          float a = hash21(i);
          float b = hash21(i + vec2(1.0, 0.0));
          float c = hash21(i + vec2(0.0, 1.0));
          float d = hash21(i + vec2(1.0, 1.0));
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }
        float vnoise3(vec3 p) {
          vec3 i = floor(p);
          vec3 f = fract(p);
          vec3 u = f * f * (3.0 - 2.0 * f);
          float n000 = hash13(i + vec3(0.0, 0.0, 0.0));
          float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
          float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
          float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
          float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
          float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
          float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
          float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
          return mix(
            mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
            mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
            u.z
          );
        }
        // where the deck is thick, seen from above — slow, broad weather.
        // Normalised to 0..1 so the coverage maths below stays legible.
        float fbm2(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 3; i++) {
            v += a * vnoise2(p);
            p = p * 2.13 + vec2(7.31, 1.77);
            a *= 0.5;
          }
          return v * 1.143;
        }
        // billow (abs-folded) turbulence — the cauliflower grain of a heap
        // cloud. Ridges instead of blobs is the whole difference between
        // smoke and a cumulus crown.
        float billow(vec3 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 3; i++) {
            v += a * abs(vnoise3(p) * 2.0 - 1.0);
            p = p * 2.41 + vec3(3.17, 7.73, 1.29);
            a *= 0.5;
          }
          return v * 1.143;
        }

        // ── hand-driven field bias (set once per pixel in main) ─────
        float gCov;   // extra coverage under the cursor / at fresh puffs
        float gDark;  // storm darkening under a held finger / storm cell

        // Column coverage: 0 = clear air, 1 = a tower's worth of vapor.
        // Broken field, not overcast — the blue between the heaps is the
        // point, and it is what makes a heap read as a heap.
        float coverage(vec2 xz) {
          vec2 q = xz * 0.026 + uDrift * 0.055 + vec2(uTime * 0.0075, uTime * 0.0028);
          float c = fbm2(q);
          // a second, slower band decides which heaps get to tower
          float tall = fbm2(q * 0.37 + vec2(19.3, 4.7));
          c = (c - 0.44) * 2.45 + (tall - 0.5) * 0.72;
          return clamp(c + gCov * 1.4, 0.0, 1.35);
        }

        // Density at a point in the deck. lod is the near-field detail
        // weight (0 at the horizon, 1 up close) — far heaps drop their
        // finest octaves rather than boiling into aliased salt, and the
        // light march skips detail entirely.
        float density(vec3 p, float lod) {
          float cov = coverage(p.xz);
          if (cov <= 0.02) return 0.0;
          // taller columns where the deck is thick — flat bottoms, heaped tops
          float base = DECK_BASE + (fbm2(p.xz * 0.019 + vec2(41.7, 8.3)) - 0.5) * 5.0;
          float top = base + (DECK_CEIL - DECK_BASE) * clamp(0.20 + cov * 0.85, 0.20, 1.0);
          float h = (p.y - base) / max(1.0, top - base);
          if (h < 0.0 || h > 1.0) return 0.0;
          // hard shear-line bottom, rounded crown
          float profile = smoothstep(0.0, 0.07, h) * smoothstep(1.0, 0.74, h);
          float d = cov * profile * 1.55 - 0.12;
          if (d <= 0.0) return 0.0;
          vec3 q = p * 0.175 + vec3(uDrift.x * 0.42, 0.0, uDrift.y * 0.42)
                     + vec3(uTime * 0.020, -uTime * 0.012, uTime * 0.009);
          // erosion grows with altitude: smooth base, boiling crown
          d -= (billow(q * 1.05) - 0.34) * (0.34 + 0.58 * h);
          if (d <= 0.0) return 0.0;
          if (lod > 0.02) {
            d -= lod * ((billow(q * 2.30) - 0.36) * 0.26 * (0.30 + h)
                      + (billow(q * 5.90) - 0.42) * 0.15 * (0.25 + h));
            if (lod > 0.55) d -= (lod - 0.55) * 2.2 * (billow(q * 14.0) - 0.46) * 0.07;
          }
          return clamp(d, 0.0, 1.0) * smoothstep(0.0, 0.26, d);
        }

        // shadow along the sun ray — the reason a cumulus has a bright
        // shoulder and a bruised underside
        float lightMarch(vec3 p, vec3 sunDir) {
          float sum = 0.0;
          float step = 1.10;
          for (int i = 0; i < 4; i++) {
            p += sunDir * step;
            sum += density(p, 0.0) * step;
            step *= 1.62;
          }
          return sum;
        }

        // 5-stop day cycle, sampled twice: overhead and at the horizon.
        vec3 zenithColor(float p) {
          vec3 c0 = vec3(0.141, 0.251, 0.431); // dawn indigo
          vec3 c1 = vec3(0.145, 0.412, 0.776); // midday cobalt
          vec3 c2 = vec3(0.294, 0.435, 0.682); // afternoon blue
          vec3 c3 = vec3(0.227, 0.275, 0.325); // mineral storm
          vec3 c4 = vec3(0.082, 0.090, 0.165); // ion violet
          vec3 col = c0;
          col = mix(col, c1, smoothstep(0.00, 0.25, p));
          col = mix(col, c2, smoothstep(0.25, 0.50, p));
          col = mix(col, c3, smoothstep(0.50, 0.75, p));
          col = mix(col, c4, smoothstep(0.75, 0.90, p));
          col = mix(col, c0, smoothstep(0.90, 1.00, p));
          return col;
        }
        vec3 horizonColor(float p) {
          vec3 c0 = vec3(0.498, 0.561, 0.706);
          vec3 c1 = vec3(0.812, 0.886, 0.949);
          vec3 c2 = vec3(0.941, 0.780, 0.608);
          vec3 c3 = vec3(0.420, 0.451, 0.478);
          vec3 c4 = vec3(0.137, 0.145, 0.220);
          vec3 col = c0;
          col = mix(col, c1, smoothstep(0.00, 0.25, p));
          col = mix(col, c2, smoothstep(0.25, 0.50, p));
          col = mix(col, c3, smoothstep(0.50, 0.75, p));
          col = mix(col, c4, smoothstep(0.75, 0.90, p));
          col = mix(col, c0, smoothstep(0.90, 1.00, p));
          return col;
        }

        void main() {
          vec2 uv = vUv;                        // y up
          float aspect = uRes.x / uRes.y;

          // ── the hand's bias on the field ─────────────────────────
          vec2 cursorDelta = uv - uCursor;
          cursorDelta.x *= aspect;
          float localPull = exp(-dot(cursorDelta, cursorDelta) / 0.055);
          gCov = localPull * (0.07 + uPress * 0.30);
          gDark = localPull * uPress;
          for (int i = 0; i < 4; i++) {
            vec4 pf = uPuffs[i];
            if (pf.z == 0.0) continue;
            vec2 pd = uv - pf.xy;
            pd.x *= aspect;
            float g = exp(-dot(pd, pd) / 0.022);
            gCov += abs(pf.z) * g * 0.55;
            gDark += max(0.0, -pf.z) * g;
          }
          gDark = clamp(gDark, 0.0, 1.0);

          // stormy stretch of the day — heavier extinction, less sun.
          // season is the same knob turned slowly, clear toward overcast.
          float stormy = clamp(smoothstep(0.55, 0.85, uPhase) + uSeason * 0.35, 0.0, 1.0);

          // ── camera: standing under the deck, looking out and up ──
          vec2 sp = uv - 0.5;
          sp.x *= aspect;
          // the drag shear tips the whole view, so pushed wind is felt as
          // the deck leaning, not just sliding
          vec3 rd = normalize(vec3(
            sp.x + uWind.x * 0.045 + uPan.x,
            sp.y + 0.320 + uWind.y * 0.030 + uPan.y,
            0.82
          ));
          vec3 ro = vec3(0.0, 0.0, 0.0);

          // ── sun ──────────────────────────────────────────────────
          float elev = 0.10 + 0.62 * (0.5 + 0.5 * cos((uPhase - 0.25) * 6.28318));
          float az = (uPhase - 0.25) * 6.28318;
          vec3 sunDir = normalize(vec3(sin(az) * 0.85, elev, cos(az) * 0.42 + 0.40));
          vec3 sunCol = mix(vec3(1.00, 0.60, 0.33), vec3(1.00, 0.97, 0.91),
                            smoothstep(0.10, 0.52, elev));
          sunCol *= mix(1.12, 0.42, stormy);

          // ── sky dome behind the clouds ───────────────────────────
          vec3 zen = zenithColor(uPhase);
          vec3 hor = horizonColor(uPhase);
          float up = clamp(rd.y, 0.0, 1.0);
          vec3 sky = mix(hor, zen, pow(up, 0.52));
          float sd = max(dot(rd, sunDir), 0.0);
          sky += sunCol * pow(sd, 90.0) * 0.85;         // the disc itself
          sky += sunCol * pow(sd, 9.0) * 0.07;          // forward haze
          // ── the two high banks, above the heaps and behind them ──
          // Flat layers intersected by the ray, so they take true
          // perspective for the price of one fbm each: altostratus as a
          // broad veil, cirrus as stretched ice streaks near the zenith.
          if (rd.y > 0.02) {
            vec2 ad = rd.xz * (52.0 / rd.y) * 0.010 + uDrift * 0.02 + vec2(uTime * 0.004, 0.0);
            float alto = fbm2(ad);
            float altoD = smoothstep(0.60, 0.94, alto) * smoothstep(0.02, 0.14, rd.y);
            vec3 altoCol = mix(vec3(0.86, 0.90, 0.93), vec3(0.34, 0.38, 0.43), stormy);
            sky = mix(sky, altoCol, altoD * 0.20);

            vec2 cd = rd.xz * (96.0 / rd.y) * vec2(0.0032, 0.019) + uDrift * 0.01
                    + vec2(uTime * 0.0025, 0.0);
            float ci = fbm2(cd);
            float ciD = smoothstep(0.54, 0.84, ci) * smoothstep(0.05, 0.45, rd.y);
            sky = mix(sky, mix(vec3(0.90, 0.95, 1.0), sunCol, 0.25), ciD * 0.22);
          }

          // ── the lower floor: a sea of cloud tops, seen from above ──
          // This is Olympus: the room stands over a second deck. It is a
          // sampled plane rather than a second march — from above, a cloud
          // sea is all tops and shadow, and tops are what a plane gives.
          float underAir = smoothstep(0.06, -0.16, rd.y);
          vec3 lowAir = mix(hor * 0.92, vec3(0.30, 0.30, 0.34), stormy * 0.6);
          sky = mix(sky, lowAir, underAir * 0.85);
          if (rd.y < -0.012) {
            float tf = -7.0 / rd.y;
            vec2 fp = rd.xz * tf * 0.030 + uDrift * 0.03 + vec2(uTime * 0.006, uTime * 0.002);
            float f = fbm2(fp);
            float ridge = fbm2(fp * 2.7 + vec2(5.1, 9.4));
            float tops = smoothstep(0.36, 0.70, f * 0.75 + ridge * 0.25);
            // slope from a finite difference along the sun's bearing: the
            // sea reads as heaps, not as a painted texture
            vec2 sb = normalize(sunDir.xz + vec2(0.001, 0.0)) * 0.09;
            float slope = fbm2(fp + sb) - fbm2(fp - sb);
            float lit = clamp(0.62 + slope * 6.0, 0.10, 1.35);
            vec3 seaCol = mix(hor * 0.72, sunCol * 1.02, lit * 0.72);
            float haze = 1.0 - exp(-tf * 0.0055);
            seaCol = mix(seaCol, lowAir, haze * 0.80);
            sky = mix(sky, seaCol, tops * (0.55 + 0.40 * (1.0 - haze)) * smoothstep(-0.012, -0.06, rd.y));
          }

          // ── volumetric march through the deck ────────────────────
          vec3 scatter = vec3(0.0);
          float trans = 1.0;
          float ambT = 0.42 + 0.34 * (1.0 - stormy);
          vec3 ambTop = zen * (1.15 + 0.6 * (1.0 - stormy));
          vec3 ambBase = mix(hor * 0.62, vec3(0.10, 0.11, 0.15), stormy);
          float cosT = dot(rd, sunDir);
          // Henyey-Greenstein: the forward lobe is the silver lining
          float g = 0.62;
          float hg = (1.0 - g * g) / (12.566 * pow(1.0 + g * g - 2.0 * g * cosT, 1.5));

          float firstHit = 0.0;
          if (rd.y > 0.006) {
            float t0 = min(DECK_BASE / rd.y, 150.0);
            float t1 = min(min(DECK_CEIL / rd.y, t0 + 86.0), 220.0);
            // Two-rate march: stride through empty air, then step fine once
            // inside a heap. Sampling a dense cloud in one gulp is exactly
            // what turns a march into salt-and-pepper.
            float dtBig = max(0.80, t0 * 0.080);
            float dtFine = max(0.26, t0 * 0.020);
            float dt = dtBig;
            bool inside = false;
            float emptyRun = 0.0;
            // dithered start so the step grid never bands
            float jitter = hash21(gl_FragCoord.xy + fract(uTime) * 37.0);
            float t = t0 + dtBig * jitter;
            float sigma = 2.5 + stormy * 1.7 + gDark * 2.6;
            for (int i = 0; i < 64; i++) {
              if (float(i) >= uMaxSteps || trans < 0.04 || t > t1) break;
              vec3 p = ro + rd * t;
              float d = density(p, clamp(1.35 - t * 0.011, 0.0, 1.0));
              if (d > 0.002) {
                if (!inside) {
                  // step back to the edge and refine from there
                  inside = true;
                  dt = dtFine;
                  t = max(t0, t - dtBig) + dtFine * jitter * 0.5;
                  continue;
                }
                emptyRun = 0.0;
                if (firstHit == 0.0) firstHit = t;
                float hNorm = clamp((p.y - DECK_BASE) / (DECK_CEIL - DECK_BASE), 0.0, 1.0);
                float ls = lightMarch(p, sunDir);
                float sunT = exp(-ls * 0.90);
                float multi = exp(-ls * 0.22) * 0.62;   // cheap second bounce
                float powder = 1.0 - exp(-d * 4.0);     // dark, dense cores
                vec3 lum =
                  sunCol * (sunT * (0.55 + 2.10 * hg) + multi) * (0.30 + 0.80 * powder)
                  + ambTop * ambT * (0.24 + 0.55 * hNorm)
                  + ambBase * 0.30;
                lum *= 1.0 - gDark * 0.62;              // a held finger bruises it
                lum += uFlash * vec3(0.72, 0.82, 1.0) * 1.05 * (0.35 + powder);
                float sampleT = exp(-d * sigma * dt);
                scatter += trans * (1.0 - sampleT) * lum;
                trans *= sampleT;
              } else if (inside) {
                // stay fine for a few empty samples — leaving refinement the
                // instant one sample reads clear is how a ray skips straight
                // through a heap and leaves a hole of sky in it
                emptyRun += 1.0;
                if (emptyRun > 3.0) {
                  inside = false;
                  emptyRun = 0.0;
                  dt = dtBig;
                }
              }
              t += dt;
            }
          }

          // distance haze: far heaps dissolve into the horizon air rather
          // than crusting into a hard, aliased rim along the shear line
          vec3 col = sky * trans + scatter;
          float aerial = firstHit > 0.0 ? 1.0 - exp(-firstHit * 0.0058) : 0.0;
          col = mix(col, mix(hor, zen, 0.35), aerial * 0.52);
          float deckFade = smoothstep(0.006, 0.035, rd.y);
          col = mix(sky, col, deckFade);

          // the flash lights the whole vault, not only the bolt
          col += uFlash * vec3(0.60, 0.72, 1.0) * 0.20;
          // sunlit moisture under a passing hand — never a drawn ring
          col += localPull * 0.030 * vec3(0.82, 0.92, 1.0) * (1.0 - uPress);

          float grain = hash21(gl_FragCoord.xy + floor(uTime * 12.0));
          col += (grain - 0.5) * 0.016;
          float vignette = smoothstep(1.10, 0.12, distance(uv, vec2(0.5, 0.54)));
          col *= 0.84 + vignette * 0.20;

          col = clamp(col, 0.0, 1.0);

          // the lens: the same field read as moisture/temperature, not sky
          if (uLens > 0.001) {
            vec3 dryC = vec3(0.85, 0.55, 0.10);
            vec3 wetC = vec3(0.10, 0.35, 0.85);
            vec3 diagram = mix(dryC, wetC, clamp(gDark + trans * 0.3, 0.0, 1.0));
            diagram += smoothstep(0.985, 1.0, fract(uv.y * 11.0 + uPhase)) * 0.3;
            col = mix(col, diagram, clamp(uLens, 0.0, 1.0));
          }

          gl_FragColor = vec4(col, 1.0);
        }
      `;

      const compile = (type: number, src: string): WebGLShader | null => {
        const s = gl.createShader(type);
        if (!s) return null;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          console.warn("cloud shader compile failed", gl.getShaderInfoLog(s));
          gl.deleteShader(s);
          return null;
        }
        return s;
      };
      const vs = compile(gl.VERTEX_SHADER, vert);
      const fs = compile(gl.FRAGMENT_SHADER, frag);
      if (vs && fs) {
        const p = gl.createProgram();
        if (p) {
          gl.attachShader(p, vs);
          gl.attachShader(p, fs);
          gl.linkProgram(p);
          if (gl.getProgramParameter(p, gl.LINK_STATUS)) {
            glProg = p;
            uTimeLoc = gl.getUniformLocation(p, "uTime");
            uResLoc = gl.getUniformLocation(p, "uRes");
            uPhaseLoc = gl.getUniformLocation(p, "uPhase");
            uCursorLoc = gl.getUniformLocation(p, "uCursor");
            uPressLoc = gl.getUniformLocation(p, "uPress");
            uFlashLoc = gl.getUniformLocation(p, "uFlash");
            uWindLoc = gl.getUniformLocation(p, "uWind");
            uDriftLoc = gl.getUniformLocation(p, "uDrift");
            uPuffsLoc = gl.getUniformLocation(p, "uPuffs[0]");
            uLensLoc = gl.getUniformLocation(p, "uLens");
            uSeasonLoc = gl.getUniformLocation(p, "uSeason");
            uPanLoc = gl.getUniformLocation(p, "uPan");
            uMaxStepsLoc = gl.getUniformLocation(p, "uMaxSteps");

            const buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(
              gl.ARRAY_BUFFER,
              new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
              gl.STATIC_DRAW,
            );
            const loc = gl.getAttribLocation(p, "a_pos");
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
            gl.useProgram(p);
            vbo = buf;
          }
        }
      }
    };
    setupProgram();

    // WebGL context can be lost (mobile GPU pressure, background tabs) and
    // restored later — reinit the program rather than staying dark forever.
    const onContextLost = (ev: Event) => {
      ev.preventDefault();
      glProg = null;
    };
    const onContextRestored = () => {
      setupProgram();
    };
    sky.addEventListener("webglcontextlost", onContextLost, false);
    sky.addEventListener("webglcontextrestored", onContextRestored, false);

    const embedded = isEmbeddedFrame();
    const gov = createFrameGovernor(embedded ? "medium" : "high");
    let hiddenDoc = document.hidden;
    let galleryPaused = false;
    let asleep = false;
    const syncSleep = () => {
      asleep = hiddenDoc || galleryPaused;
      if (asleep) gov.force("sleep");
    };
    const unvis = onVisibility((h) => {
      hiddenDoc = h;
      syncSleep();
    });
    const ungal = onGalleryPause((p) => {
      galleryPaused = p;
      syncSleep();
    });

    // ── resize ─────────────────────────────────────────────────────
    // The volume march is the expensive pass, so the sky canvas renders
    // below CSS resolution and is stretched back up — clouds are soft
    // enough that nothing is lost but the cost. skyScale is walked down
    // (and back up) by the frame-time watcher in the loop, so a phone and
    // a workstation both land near 60fps.
    let skyScale = 0.55;
    const resize = () => {
      const dpr = resolveDpr(gov.tier(), { embedded, reducedMotion: reduce });
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      sky.width = Math.max(2, Math.floor(w * dpr * skyScale));
      sky.height = Math.max(2, Math.floor(h * dpr * skyScale));
      overlay.width = Math.floor(w * dpr);
      overlay.height = Math.floor(h * dpr);
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (gl) gl.viewport(0, 0, sky.width, sky.height);
    };
    resize();
    const ro = new ResizeObserver(() => {
      resize();
      reflowGlyphs();
    });
    ro.observe(wrap);

    // ── interaction ────────────────────────────────────────────────
    let nextWeatherId = 0;
    let activeWindStroke: WindStroke | null = null;
    let lastWindMark = 0;
    let windTargetX = 0;
    let windTargetY = 0;
    let windX = 0;
    let windY = 0;

    // ── the room's clock + law-layer state (gesture grammar) ──────
    // Three fingers held dilate time; three fingers dragged race the
    // cloud floor; a circling finger spins a vapor spiral; a steady
    // tapped pulse entrains the sky. Thresholds live in gesture/core.
    let timeScale = 1;
    let timeScaleTarget = 1;
    let simElapsed = 0;              // warped seconds — day cycle, drift
    let simNowMs = performance.now(); // warped ms — cell/veil/bolt ages
    let lastRaceFxAt = 0;
    let entrainBpm = 0;
    let entrainUntil = 0;
    let lastEntrainBeat = -1;
    let lastScrubAt = 0;
    let lastGestureAt = performance.now();
    const holdState = { ceremony: false };

    // ── the map layer (two fingers) and the vessel ─────────────────
    let lens = 0; // 0 the sky as seen, 1 the moisture/temperature field
    let season = 0; // 0 clear, 1 overcast — the slow annual cycle
    let panX = 0;
    let panY = 0;
    let panXTarget = 0;
    let panYTarget = 0;

    const cellNear = (x: number, y: number): WeatherCell | null => {
      let best: WeatherCell | null = null;
      let bestD = 80;
      for (const cell of weatherCells) {
        const d = Math.hypot(cell.x - x, cell.y - y);
        if (d < bestD) { bestD = d; best = cell; }
      }
      return best;
    };
    // deterministic tier-3-on-empty-sky cycle: moisture → thermal → shear
    let skyTapCycle = 0;

    const dissolveWeatherCellNear = (x: number, y: number): boolean => {
      let bestIdx = -1;
      let bestD = 80;
      for (let i = 0; i < weatherCells.length; i++) {
        const d = Math.hypot(weatherCells[i].x - x, weatherCells[i].y - y);
        if (d < bestD) { bestD = d; bestIdx = i; }
      }
      if (bestIdx < 0) return false;
      weatherCells.splice(bestIdx, 1);
      setHasBuilt(weatherCells.length > 0);
      return true;
    };
    clearWeatherRef.current = () => {
      weatherCells.length = 0;
      rainVeils.length = 0;
      windStrokes.length = 0;
      cloudPuffs.length = 0;
      lightnings.current = [];
      setHasBuilt(false);
    };

    // build a jagged path from (x0, y0) to (x1, y1) with mid-jitter forks
    const makeBolt = (x0: number, y0: number, x1: number, y1: number) => {
      const pts: Array<{ x: number; y: number }> = [{ x: x0, y: y0 }];
      const segs = 14;
      for (let i = 1; i < segs; i++) {
        const tt = i / segs;
        const cx = x0 + (x1 - x0) * tt;
        const cy = y0 + (y1 - y0) * tt;
        // perpendicular jitter — broader in the middle, tighter at ends
        const env = Math.sin(tt * Math.PI) * 0.5 + 0.18;
        const dx = (Math.random() - 0.5) * 80 * env;
        const dy = (Math.random() - 0.5) * 24 * env;
        pts.push({ x: cx + dx, y: cy + dy });
      }
      pts.push({ x: x1, y: y1 });
      return pts;
    };

    const clampToSky = (x: number, y: number) => {
      const w = overlay.clientWidth || 1280;
      const h = overlay.clientHeight || 720;
      return {
        x: clamp(x, 24, w - 24),
        y: clamp(y, 84, h - 48),
      };
    };

    const seedWeatherCell = (
      x: number,
      y: number,
      kind: WeatherCell["kind"],
      strength: number,
    ): WeatherCell => {
      const p = clampToSky(x, y);
      const id = ++nextWeatherId;
      // a tapped cell's traits are seeded from its own id/position, not
      // Math random — the same run of taps grows the same weather
      const s0 = hash01(id * 7 + p.x * 0.013);
      const s1 = hash01(id * 11 + p.y * 0.017);
      const s2 = hash01(id * 13 + p.x * 0.021 + p.y * 0.009);
      const s3 = hash01(id * 17);
      const s4 = hash01(id * 19 + strength * 97);
      const cell: WeatherCell = {
        id,
        kind,
        x: p.x,
        y: p.y,
        t0: simNowMs,
        strength: clamp(strength, 0.2, 1),
        spread: kind === "storm" ? 0.72 + s0 * 0.28 : 0.70 + s0 * 0.55,
        drift: (s1 - 0.5) * (kind === "storm" ? 7 : 16),
        lift: kind === "storm" ? 0.35 + s2 * 0.35 : 1.2 + s2 * 1.8,
        phase: s3 * Math.PI * 2,
        rain: kind === "storm" ? 0.45 + s4 * 0.35 + strength * 0.22 : s4 * 0.10,
      };
      weatherCells.push(cell);
      if (weatherCells.length > 20) weatherCells.shift();
      setHasBuilt(true);
      return cell;
    };

    const seedRainVeil = (x: number, y: number, strength: number, width = 180) => {
      const p = clampToSky(x, y);
      const id = ++nextWeatherId;
      rainVeils.push({
        id,
        x: p.x,
        y: p.y,
        t0: simNowMs,
        strength: clamp(strength, 0.18, 1),
        width,
        slant: -10 + hash01(id * 23 + p.x * 0.03) * 22 + windTargetX * 18,
        seed: hash01(id * 29 + p.y * 0.04) * 1000,
      });
      if (rainVeils.length > 14) rainVeils.shift();
    };

    const beginWindStroke = (x: number, y: number) => {
      const id = ++nextWeatherId;
      activeWindStroke = {
        id,
        points: [{ x, y, t: performance.now() }],
        t0: simNowMs,
        releasedAt: null,
        strength: 0.12,
        vx: 0,
        vy: 0,
        hue: hash01(id * 31 + x * 0.05 + y * 0.05),
      };
      windStrokes.push(activeWindStroke);
      if (windStrokes.length > 14) windStrokes.shift();
    };

    const extendWindStroke = (x: number, y: number) => {
      if (!activeWindStroke) return;
      const nowMs = performance.now();
      const pts = activeWindStroke.points;
      const last = pts[pts.length - 1];
      const dx = x - last.x;
      const dy = y - last.y;
      const d = Math.hypot(dx, dy);
      if (d < 3) return;
      const dtSec = Math.max(0.016, (nowMs - last.t) / 1000);
      activeWindStroke.vx = dx / dtSec;
      activeWindStroke.vy = dy / dtSec;
      activeWindStroke.strength = clamp(activeWindStroke.strength + d / 120, 0, 1);
      pts.push({ x, y, t: nowMs });
      if (pts.length > 48) pts.shift();

      windTargetX = clamp(activeWindStroke.vx / 780, -1, 1);
      windTargetY = clamp(activeWindStroke.vy / 980, -1, 1);
      if (nowMs - lastWindMark > 420) {
        lastWindMark = nowMs;
        addWeatherMark("wind shear", Math.min(0.86, 0.32 + activeWindStroke.strength * 0.62));
      }
    };

    const releaseWindStroke = (record = true) => {
      if (!activeWindStroke) return;
      activeWindStroke.releasedAt = simNowMs;
      if (record && activeWindStroke.points.length > 5) {
        useField.getState().recordTape("ripple", 0.42 + activeWindStroke.strength * 0.35, "clouds/wind-shear");
        if (activeWindStroke.strength > 0.55) {
          try { getFieldAudio().spark(); } catch { /* noop */ }
          haptics.ripple(0.22 + activeWindStroke.strength * 0.18);
        }
      }
      activeWindStroke = null;
    };

    const triggerLightning = (uvx: number, target?: { x: number; y: number }) => {
      const w = overlay.clientWidth;
      const h = overlay.clientHeight;
      // strike origin: near top, x near cursor
      const x0 = clamp(uvx * w + (Math.random() - 0.5) * 60, 40, w - 40);
      const y0 = h * 0.05;
      const x1 = target
        ? clamp(target.x + (Math.random() - 0.5) * 46, 20, w - 20)
        : clamp(x0 + (Math.random() - 0.5) * 220, 20, w - 20);
      const y1 = target
        ? clamp(target.y + (Math.random() - 0.5) * 30, h * 0.24, h - 30)
        : h * (0.55 + Math.random() * 0.25);
      lightnings.current.push({
        t0: simNowMs,
        segs: makeBolt(x0, y0, x1, y1),
        flash: 1,
      });
      if (lightnings.current.length > 4) lightnings.current.shift();

      const a = getFieldAudio();
      a.thud();
      // delayed bell = thunder reverb tail
      window.setTimeout(() => a.bell(), 380);
      haptics.storm();

      useField.getState().recordTape("region", 0.9, "olympus/lightning");
      addWeatherMark("lightning", 0.95);
    };

    // Look up the topmost glyph the pointer is currently touching.
    // We have to compute the live y including the bob, so this references
    // the current animation time via elapsedRef.
    const elapsedRef = { v: 0 }; // updated each frame
    const glyphAt = (px: number, py: number): Glyph | null => {
      // iterate front-to-back: bigger glyphs win
      let pick: Glyph | null = null;
      let pickArea = Infinity;
      for (const g of glyphs) {
        if (g.opacity < 0.24) continue;
        const y = reduce
          ? g.baseY
          : g.baseY + Math.sin(elapsedRef.v * g.bobFreq * Math.PI * 2 + g.phase) * g.bobAmp;
        // hit radius derived from drawing size — most glyphs paint within
        // about r * 0.5..1.6 of their center. Use a slightly larger radius
        // for touch (≥ 20px target).
        const hitR = Math.max(20, g.size * 0.85);
        const d2 = (g.x - px) * (g.x - px) + (y - py) * (y - py);
        if (d2 <= hitR * hitR && hitR < pickArea) {
          pick = g;
          pickArea = hitR;
        }
      }
      return pick;
    };

    const trackPointer = (clientX: number, clientY: number) => {
      const r = overlay.getBoundingClientRect();
      const x = clientX - r.left;
      const y = clientY - r.top;
      pointer.current.x = x;
      pointer.current.y = y;
      // y=0 top in DOM, shader expects y=0 bottom
      pointer.current.uvx = clamp(x / r.width, 0, 1);
      pointer.current.uvy = clamp(1 - y / r.height, 0, 1);
      pointer.current.over = true;

      // update per-glyph hover state
      const touched = glyphAt(x, y);
      for (const g of glyphs) g.hovered = g === touched;
      return { x, y };
    };

    // ── gestures (the shared grammar — src/lib/gesture) ───────────
    // One finger touches the air: tap condenses vapor, drag shears the
    // wind, dwell builds a storm cell that takes lightning, ceremony
    // keeps the storm. Three fingers touch the law: drag races the
    // cloud floor, hold slows the whole sky. Pinch and pan2 stay
    // unbound — the frame belongs to the scale manifold.
    const detachGestures = attachGestures(overlay, {
      tap: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers === 2) {
          // step back: lower a raised lens, else the sky eases its lean.
          // ScaleTravel (document.body) reads data-lens-raised so this tap
          // and the shared scale step-back never both answer at once.
          if (lens > 0.02) {
            lens = 0;
            wrap.dataset.lensRaised = "";
          } else {
            panXTarget = 0;
            panYTarget = 0;
          }
          haptics.tap();
          return;
        }
        if (e.fingers === 3) {
          // tutti — everything alive answers softly at once, to the weight asked
          for (const cell of weatherCells) cell.strength = Math.min(1, cell.strength + 0.08 + e.intensity * 0.1);
          try { getFieldAudio().chime(); } catch { /* noop */ }
          haptics.ripple(0.3 + e.intensity * 0.3);
          return;
        }
        const { x: px, y: py } = trackPointer(e.x, e.y);
        // rapid-tap ladder (tiers from gesture/core): condensation quickens
        // into rain, rain calls lightning, and past seven the front arrives
        const tier = tapTrainTier(e.count);
        const depth = tapTrainDepth(e.count);
        if (tier === "n") {
          const w = overlay.clientWidth;
          for (let k = 0; k < 3; k++) {
            const fx = clamp(px + (k - 1) * (w * 0.18), 40, w - 40);
            seedWeatherCell(fx, py, "storm", 0.6 + depth * 0.4);
            seedRainVeil(fx, py + 44, 0.6 + depth * 0.4, 160 + depth * 90);
          }
          windTargetX = clamp(windTargetX + (px > w * 0.5 ? -0.3 : 0.3) * (0.6 + depth), -1, 1);
          triggerLightning(pointer.current.uvx, { x: px, y: py });
          addWeatherMark("the front", 0.85 + depth * 0.15);
          useField.getState().recordTape("region", 0.85 + depth * 0.15, "clouds/front");
          return;
        }
        if (tier >= 5) {
          // tier 5 — the sky's biggest reachable event: a storm cell that
          // actually rains, lightning called down into it in the same frame
          seedWeatherCell(px, py, "storm", 0.7 + depth * 0.3);
          seedRainVeil(px, py + 40, 0.6 + depth * 0.4, 170 + depth * 100);
          triggerLightning(pointer.current.uvx, { x: px, y: py });
          addWeatherMark("storm cell", 0.8 + depth * 0.2);
          useField.getState().recordTape("region", 0.8 + depth * 0.2, "clouds/storm-cell");
          return;
        }
        if (tier >= 3) {
          const hitCell = cellNear(px, py);
          if (hitCell) {
            // tier 3 on an existing cloud: it grows toward cumulonimbus —
            // real growth of the thing that's there, not a new decal
            hitCell.strength = Math.min(1, hitCell.strength + 0.28 + depth * 0.2);
            hitCell.spread = Math.min(2.2, hitCell.spread + 0.18 + depth * 0.12);
            if (hitCell.strength > 0.72) {
              hitCell.kind = "storm";
              hitCell.rain = Math.max(hitCell.rain, 0.45 + depth * 0.2);
              seedRainVeil(hitCell.x, hitCell.y + 40, hitCell.rain, 150 + depth * 80);
              try { getFieldAudio().thud(); } catch { /* noop */ }
            } else {
              try { getFieldAudio().playNote(52 - Math.round(depth * 6), 180); } catch { /* noop */ }
            }
            haptics.ripple(0.35 + depth * 0.3);
            addWeatherMark("cloud grows", 0.55 + depth * 0.2);
            useField.getState().recordTape("object", 0.6 + depth * 0.2, "clouds/grow");
            return;
          }
          // tier 3 on open sky: one of a cycling, deterministic set —
          // moisture condenses, a thermal lifts, or a shear layer combs in
          const kind = skyTapCycle % 3;
          skyTapCycle += 1;
          if (kind === 0) {
            seedWeatherCell(px, py, "vapor", 0.4 + depth * 0.3);
            seedRainVeil(px, py + 36, 0.4 + depth * 0.4, 140 + depth * 80);
            try { getFieldAudio().playNote(52 - Math.round(depth * 6), 180); } catch { /* noop */ }
            addWeatherMark("moisture", 0.5 + depth * 0.2);
          } else if (kind === 1) {
            const cell = seedWeatherCell(px, py, "vapor", 0.32 + depth * 0.2);
            if (cell) cell.lift = Math.min(48, cell.lift + 14 + depth * 8);
            try { getFieldAudio().playTone(190 + depth * 40, 0.3); } catch { /* noop */ }
            addWeatherMark("a thermal", 0.5 + depth * 0.2);
          } else {
            windTargetX = clamp(windTargetX + (px > overlay.clientWidth / 2 ? -0.4 : 0.4) * (0.6 + depth), -1, 1);
            seedWeatherCell(px, py, "vapor", 0.28 + depth * 0.18);
            try { getFieldAudio().playTone(120, 0.4); } catch { /* noop */ }
            addWeatherMark("a shear layer", 0.5 + depth * 0.2);
          }
          haptics.ripple(0.3 + depth * 0.25);
          useField.getState().recordTape("ripple", 0.5 + depth * 0.2, `clouds/sky-${kind}`);
          return;
        }
        const g = glyphAt(px, py);
        if (g) {
          // soft whoosh + breadcrumb trail
          const a = getFieldAudio();
          a.spark();
          haptics.ripple(0.2 + e.intensity * 0.24);
          useField.getState().recordTape("sigil", 0.5, `clouds/${g.kind}`);
          addWeatherMark(g.kind.replace("-", " "), 0.5);
          // seed the trail at the glyph's current rendered position
          const y = reduce
            ? g.baseY
            : g.baseY + Math.sin(elapsedRef.v * g.bobFreq * Math.PI * 2 + g.phase) * g.bobAmp;
          for (let k = 0; k < 6; k++) {
            g.trail.push({
              x: g.x - g.vx * (k * 0.04), // backward steps along its drift
              y: y + (Math.random() - 0.5) * 2,
              t0: performance.now() + k * 30,
            });
          }
          // cap trail length
          while (g.trail.length > 18) g.trail.shift();
          return;
        }
        // a tap on empty sky — local cloud puff. Tap intensity is the
        // condensation: vapor density, ring and haptic ride the same 0..1.
        cloudPuffs.push({ x: px, y: py, t0: simNowMs });
        if (cloudPuffs.length > 8) cloudPuffs.shift();
        seedWeatherCell(px, py, "vapor", 0.30 + e.intensity * 0.32);
        const a = getFieldAudio();
        a.chime();
        haptics.ripple(0.24 + e.intensity * 0.3);
        useField.getState().recordTape("ripple", 0.3 + e.intensity * 0.2, "clouds/puff");
        addWeatherMark("vapor", 0.3 + e.intensity * 0.24);
      },
      drag: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers === 3) {
          if (e.phase === "end") return;
          // three fingers drag the weather: the whole cloud floor races
          // with the pushed wind — bands, cells and glyphs together
          windTargetX = clamp(windTargetX + e.vx * 0.045, -1, 1);
          windTargetY = clamp(windTargetY + e.vy * 0.035, -1, 1);
          const nowMs = performance.now();
          if (Math.hypot(e.vx, e.vy) > 0.35 && nowMs - lastRaceFxAt > 2400) {
            lastRaceFxAt = nowMs;
            try { getFieldAudio().playTone(160 + Math.abs(windTargetX) * 120, 0.35); } catch { /* noop */ }
            try { haptics.chop(); } catch { /* noop */ }
            addWeatherMark("racing sky", 0.5 + Math.min(0.4, Math.abs(windTargetX) * 0.5));
            useField.getState().recordTape("region", 0.5, "clouds/race");
          }
          return;
        }
        if (e.fingers !== 1) return;
        const { x, y } = trackPointer(e.x, e.y);
        if (e.phase === "start") {
          pointer.current.pressed = true;
          pointer.current.pressStart = performance.now();
          beginWindStroke(x, y);
          haptics.tap();
          addWeatherMark("pressure", 0.45);
          return;
        }
        if (e.phase === "end") {
          pointer.current.pressed = false;
          setPressCharge(0);
          releaseWindStroke(true);
          return;
        }
        extendWindStroke(x, y);
      },
      flick: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers !== 1) return;
        // a flick throws a gust — three beads of vapor strung on the wind
        const { x, y } = trackPointer(e.x, e.y);
        windTargetX = clamp(windTargetX + Math.cos(e.angle) * Math.min(1, e.speed * 0.7), -1, 1);
        windTargetY = clamp(windTargetY + Math.sin(e.angle) * Math.min(0.7, e.speed * 0.5), -1, 1);
        for (let k = 1; k <= 3; k++) {
          seedWeatherCell(x + Math.cos(e.angle) * k * 60, y + Math.sin(e.angle) * k * 42, "vapor", 0.42 - k * 0.07);
        }
        pointer.current.pressed = false;
        setPressCharge(0);
        releaseWindStroke(true);
        try { getFieldAudio().spark(); } catch { /* noop */ }
        try { haptics.chop(); } catch { /* noop */ }
        addWeatherMark("gust", 0.6);
        useField.getState().recordTape("ripple", 0.55, "clouds/gust");
      },
      hold: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers === 3) {
          // three fingers hold the law: the sky keeps slowing the longer
          // they stay — a lull at 900ms, near-stillness by 2400ms
          if (e.phase === "release") { timeScaleTarget = 1; return; }
          timeScaleTarget = 1 - 0.75 * clamp(e.elapsed / 2000, 0, 1);
          if (e.phase === "enter") {
            try { getFieldAudio().playNote(36, 260); } catch { /* noop */ }
            try { haptics.tap(); } catch { /* noop */ }
          }
          return;
        }
        if (e.fingers !== 1) return;
        trackPointer(e.x, e.y);
        if (e.phase === "enter") {
          holdState.ceremony = false;
          pointer.current.pressed = true;
          pointer.current.pressStart = performance.now() - e.elapsed;
          haptics.tap();
          addWeatherMark("pressure", 0.45);
          return;
        }
        if (e.phase === "tick" && e.tier >= 2 && !holdState.ceremony && e.elapsed % 700 < 60) {
          // the gathering is audible while it happens: the held air groans
          // lower and the hand feels the cell thicken, deeper every beat
          const charge = clamp(e.elapsed / 1800, 0, 1);
          cloudPuffs.push({ x: pointer.current.x, y: pointer.current.y, t0: simNowMs });
          if (cloudPuffs.length > 8) cloudPuffs.shift();
          try { getFieldAudio().playTone(120 - charge * 50, 0.06); } catch { /* noop */ }
          try { haptics.ripple(0.15 + charge * 0.25); } catch { /* noop */ }
        }
        if (e.phase === "release") {
          pointer.current.pressed = false;
          setPressCharge(0);
          // dwell tier — the held region breaks into a storm cell that
          // takes lightning (was a private 800ms constant; the threshold
          // now lives in core)
          if (e.tier >= 2 && !holdState.ceremony) {
            const charge = clamp(e.elapsed / 1800, 0, 1);
            seedWeatherCell(pointer.current.x, pointer.current.y, "storm", 0.64 + charge * 0.36);
            seedRainVeil(pointer.current.x, pointer.current.y + 44, 0.58 + charge * 0.42, 170 + charge * 110);
            triggerLightning(pointer.current.uvx, { x: pointer.current.x, y: pointer.current.y });
            addWeatherMark("storm cell", 0.88 + charge * 0.12);
          }
          return;
        }
        // ceremony tier — the room's one solemn act: over an existing cell
        // it dissolves (the touch-reachable delete); over open sky the
        // storm is kept — the cell seeds at full strength, rain closes
        // around it, and the sky answers with one great bolt.
        if (e.tier >= 3 && !holdState.ceremony) {
          holdState.ceremony = true;
          if (dissolveWeatherCellNear(pointer.current.x, pointer.current.y)) {
            try { getFieldAudio().thud(); } catch { /* noop */ }
            try { haptics.chop(); } catch { /* noop */ }
            addWeatherMark("dissolved", 0.3);
            useField.getState().recordTape("sigil", 0.3, "clouds/dissolve");
            return;
          }
          seedWeatherCell(pointer.current.x, pointer.current.y, "storm", 1);
          seedRainVeil(pointer.current.x - 90, pointer.current.y + 44, 0.9, 200);
          seedRainVeil(pointer.current.x + 90, pointer.current.y + 52, 0.9, 200);
          triggerLightning(pointer.current.uvx, { x: pointer.current.x, y: pointer.current.y });
          try { haptics.bloom(); } catch { /* noop */ }
          addWeatherMark("kept storm", 1);
          useField.getState().recordTape("sigil", 1, "clouds/ceremony");
        }
      },
      twist: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers === 3) {
          // three-finger twist: advance/rewind the sky's slow season
          season = clamp(season + e.angle * 0.12, 0, 1);
          return;
        }
        // two-finger twist rotates the lens — sky as seen ↔ moisture map
        lens = clamp(lens + e.angle * 0.4, 0, 1);
        wrap.dataset.lensRaised = lens > 0.02 ? "1" : "";
      },
      pan2: (e) => {
        lastGestureAt = performance.now();
        panXTarget = clamp(panXTarget + e.dx * 0.0006, -0.16, 0.16);
        panYTarget = clamp(panYTarget + e.dy * 0.0006, -0.12, 0.12);
      },
      scrub: (e) => {
        lastGestureAt = performance.now();
        const nowMs = performance.now();
        if (nowMs - lastScrubAt < 700) return;
        lastScrubAt = nowMs;
        // circling spins a vapor spiral — cells strung on the turning air
        const { x, y } = trackPointer(e.cx, e.cy);
        const sgn = Math.sign(e.winding) || 1;
        for (let k = 0; k < 5; k++) {
          const a = sgn * (k / 5) * Math.PI * 2;
          const r = 26 + k * 22;
          seedWeatherCell(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.6, "vapor", 0.44 - k * 0.05);
        }
        windTargetX = clamp(windTargetX + sgn * 0.18, -1, 1);
        cloudPuffs.push({ x, y, t0: simNowMs });
        if (cloudPuffs.length > 8) cloudPuffs.shift();
        try { getFieldAudio().playNote(62, 160); } catch { /* noop */ }
        try { haptics.ripple(0.35); } catch { /* noop */ }
        addWeatherMark("spiral", 0.6);
        useField.getState().recordTape("ripple", 0.55, "clouds/spiral");
      },
      rhythm: (e) => {
        // a steady tapped pulse: the sky breathes in time with the hand
        if (e.stability <= 0.7) return;
        entrainBpm = Math.max(40, Math.min(120, e.bpm));
        entrainUntil = performance.now() + 9000;
      },
      drum: (e) => {
        lastGestureAt = performance.now();
        // drumming builds weather in the space between the hands: each
        // landing condenses its own spot, and a held patter strings a
        // squall line from one zone to the other, wind running along it
        const { x, y } = trackPointer(e.x, e.y);
        const roll = clamp(e.hits / 9, 0, 1);
        seedWeatherCell(x, y, "vapor", 0.3 + roll * 0.3);
        try { getFieldAudio().playTone(90 + (x > (e.ax + e.bx) * 0.5 ? 34 : 0) + roll * 40, 0.05); } catch { /* noop */ }
        try { haptics.tap(); } catch { /* noop */ }
        if (e.hits >= 5 && e.alternation > 0.85) {
          const r = overlay.getBoundingClientRect();
          const ax = e.ax - r.left;
          const ay = e.ay - r.top;
          const bx = e.bx - r.left;
          const by = e.by - r.top;
          for (let k = 1; k < 4; k++) {
            const tt = k / 4;
            seedWeatherCell(ax + (bx - ax) * tt, ay + (by - ay) * tt, "storm", 0.5 + roll * 0.3);
          }
          seedRainVeil((ax + bx) * 0.5, (ay + by) * 0.5 + 40, 0.55 + roll * 0.35, 200);
          windTargetX = clamp(windTargetX + Math.sign(bx - ax) * 0.22, -1, 1);
          addWeatherMark("squall line", 0.7 + roll * 0.2);
          useField.getState().recordTape("region", 0.7 + roll * 0.2, "clouds/squall");
        }
      },
    }, { wheelZoom: false });

    // ── the vessel: the phone's own body is weather too ──────────────
    const detachVessel = onVessel({
      tilt: ({ gamma }) => {
        if (reduce || asleep) return;
        windTargetX = clamp(windTargetX + gamma * 0.0008, -1, 1);
      },
      shake: ({ intensity }) => {
        if (reduce || asleep) return;
        for (const cell of weatherCells) cell.strength = Math.min(1, cell.strength + intensity * 0.3);
        try { getFieldAudio().thud(); } catch { /* noop */ }
        try { haptics.storm(); } catch { /* noop */ }
        addWeatherMark("scattered", 0.6);
      },
      knock: ({ intensity }) => {
        if (reduce || asleep) return;
        seedWeatherCell(overlay.clientWidth * 0.5, overlay.clientHeight * 0.3, "vapor", 0.3 + intensity * 0.3);
        try { getFieldAudio().spark(); } catch { /* noop */ }
        try { haptics.tap(); } catch { /* noop */ }
      },
      flip: ({ faceDown }) => {
        // night: face-down settles the sky's phase toward dusk/night early
        if (faceDown) phaseOffsetRef.current += 0.02;
      },
    });

    // Desktop hover is the grammar's quiet dialect (hover ≈ light touch):
    // the hovered sky thickens locally and glyphs notice a passing hand.
    // All contact gestures live in the engine above.
    const onHover = (e: PointerEvent) => {
      trackPointer(e.clientX, e.clientY);
    };
    const onHoverLeave = () => {
      pointer.current.over = false;
    };
    overlay.addEventListener("pointermove", onHover);
    overlay.addEventListener("pointerleave", onHoverLeave);

    // ── air glyphs (Minoan wind chorus across altitudes) ───────────
    // A small library of shapes; each instance is randomly assigned one
    // and drifts at its own altitude / speed / bob / rotation.
    type GlyphKind =
      | "simple-spiral"
      | "double-spiral"
      | "wave-key"
      | "comma-trio"
      | "ring-spiral"
      | "wind-streak";

    type Glyph = {
      kind: GlyphKind;
      size: number;       // 12..48 px
      x: number;          // current x (px in CSS units)
      baseY: number;      // px
      vx: number;         // px/sec — drift speed (positive → right)
      bobAmp: number;     // px (2..6)
      bobFreq: number;    // rad/sec
      phase: number;      // radians — for bob + drawing variants
      opacity: number;    // 0.35..0.7
      strokeWidth: number; // 1.0..1.6
      rotation: number;   // current rotation in radians
      rotSpeed: number;   // rad/frame (signed)
      hovered: boolean;   // pointer-over state — drives scale + spin boost
      trail: Array<{ x: number; y: number; t0: number }>; // brief breadcrumb trail after click
    };

    // Spawn 12 glyphs across altitudes 8%..70%. Positions are seeded at
    // mount; the loop maintains them.
    const GLYPH_KINDS: GlyphKind[] = [
      "simple-spiral",
      "double-spiral",
      "wave-key",
      "comma-trio",
      "ring-spiral",
      "wind-streak",
    ];
    const GLYPH_COUNT = 8;
    const initialW = wrap.clientWidth || 1280;
    const initialH = wrap.clientHeight || 720;
    const glyphs: Glyph[] = [];
    for (let i = 0; i < GLYPH_COUNT; i++) {
      // seeded from the glyph's own index, not Math random — the comment
      // above already promised "seeded at mount"; now it is
      const g0 = hash01(i * 41 + 3);
      const g1 = hash01(i * 43 + 7);
      const g2 = hash01(i * 47 + 11);
      const g3 = hash01(i * 53 + 13);
      const g4 = hash01(i * 59 + 17);
      const g5 = hash01(i * 61 + 19);
      const g6 = hash01(i * 67 + 23);
      const g7 = hash01(i * 71 + 29);
      const g8 = hash01(i * 73 + 31);
      const g9 = hash01(i * 79 + 37);
      const g10 = hash01(i * 83 + 41);
      const yFrac = 0.08 + (i / GLYPH_COUNT) * 0.62 + (g0 - 0.5) * 0.04;
      const size = 10 + g1 * 28; // 10..38
      // Back glyphs (smaller, higher up) drift slowly; front glyphs faster.
      // Mix sizes with altitude so it doesn't look stratified.
      const altWeight = yFrac; // higher y → larger weight
      const baseSpeed = 4 + altWeight * 14 + g2 * 6; // 4..24 px/s
      glyphs.push({
        kind: GLYPH_KINDS[i % GLYPH_KINDS.length],
        size,
        x: g3 * initialW,
        baseY: yFrac * initialH,
        vx: baseSpeed * (g4 < 0.08 ? -1 : 1), // most drift right
        bobAmp: 2 + g5 * 4,
        bobFreq: 0.08 + g6 * 0.18,
        phase: g7 * Math.PI * 2,
        opacity: 0.08 + g8 * 0.12,
        strokeWidth: 0.75 + g9 * 0.45,
        rotation: g10 * Math.PI * 2,
        // 0.02..0.06 deg/frame, half clockwise / half counter
        rotSpeed: ((hash01(i * 89 + 43) * 0.04 + 0.02) * Math.PI) / 180 *
          (hash01(i * 97 + 47) < 0.5 ? -1 : 1),
        hovered: false,
        trail: [],
      });
    }

    // local clouds — soft visual puffs at recent cloud taps
    const cloudPuffs: Array<{ x: number; y: number; t0: number }> = [];
    const weatherCells: WeatherCell[] = [];
    const windStrokes: WindStroke[] = [];
    const rainVeils: RainVeil[] = [];
    const iceCrystals = Array.from({ length: 34 }).map((_, i) => ({
      xFrac: (i * 0.381966 + hash01(i * 101 + 5) * 0.08) % 1,
      yFrac: 0.10 + hash01(i * 103 + 7) * 0.23,
      size: 1.4 + hash01(i * 107 + 11) * 3.8,
      spin: (hash01(i * 109 + 13) < 0.5 ? -1 : 1) * (0.15 + hash01(i * 113 + 17) * 0.35),
      phase: hash01(i * 127 + 19) * Math.PI * 2,
    }));

    // Keep baseY proportional on resize.
    const reflowGlyphs = () => {
      const h = wrap.clientHeight || 720;
      for (let i = 0; i < glyphs.length; i++) {
        const yFrac = 0.08 + (i / glyphs.length) * 0.62;
        glyphs[i].baseY = yFrac * h;
      }
    };

    const drawGlyph = (
      ctx: CanvasRenderingContext2D,
      g: Glyph,
      y: number,
      color: string,
    ) => {
      ctx.save();
      ctx.translate(g.x, y);
      ctx.rotate(g.rotation);
      ctx.globalAlpha = g.opacity;
      ctx.strokeStyle = color;
      ctx.lineWidth = g.strokeWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      const r = g.size;

      switch (g.kind) {
        case "simple-spiral": {
          // Archimedean curl, ~3π
          ctx.beginPath();
          const steps = 56;
          const maxTheta = Math.PI * 3;
          const a = r * 0.08;
          const b = r * 0.085;
          for (let i = 0; i <= steps; i++) {
            const theta = (i / steps) * maxTheta;
            const rr = a + b * theta;
            const px = Math.cos(theta) * rr;
            const py = Math.sin(theta) * rr;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
          break;
        }
        case "double-spiral": {
          // Two mirrored curls from a central node — yin-yang wind.
          // Tiny central dot via short arc
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.06, 0, Math.PI * 2);
          ctx.stroke();
          const steps = 44;
          const maxTheta = Math.PI * 2.4;
          const a = r * 0.06;
          const b = r * 0.07;
          // right curl
          ctx.beginPath();
          for (let i = 0; i <= steps; i++) {
            const theta = (i / steps) * maxTheta;
            const rr = a + b * theta;
            const px = Math.cos(theta) * rr;
            const py = Math.sin(theta) * rr;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
          // left curl (mirror through origin, rotated π)
          ctx.beginPath();
          for (let i = 0; i <= steps; i++) {
            const theta = (i / steps) * maxTheta;
            const rr = a + b * theta;
            const px = -Math.cos(theta) * rr;
            const py = -Math.sin(theta) * rr;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
          break;
        }
        case "wave-key": {
          // Short horizontal sine with curls at each end (Minoan wave).
          const halfLen = r * 0.95;
          const amp = r * 0.22;
          // central bezier sine — two humps
          ctx.beginPath();
          ctx.moveTo(-halfLen, 0);
          ctx.bezierCurveTo(
            -halfLen * 0.55, -amp * 2.0,
            -halfLen * 0.10,  amp * 2.0,
             halfLen * 0.40, -amp * 1.4,
          );
          ctx.bezierCurveTo(
             halfLen * 0.65, -amp * 1.0,
             halfLen * 0.90,  amp * 1.2,
             halfLen,         amp * 0.2,
          );
          ctx.stroke();
          // end curls
          ctx.beginPath();
          ctx.arc(-halfLen, 0, r * 0.14, Math.PI * 0.2, Math.PI * 1.8, true);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(halfLen, amp * 0.2, r * 0.14, Math.PI * 1.2, Math.PI * 2.8);
          ctx.stroke();
          break;
        }
        case "comma-trio": {
          // 3 small comma puffs in a row (cirrus-like)
          const spacing = r * 0.42;
          const puffR = r * 0.16;
          for (let k = -1; k <= 1; k++) {
            const cx = k * spacing;
            ctx.beginPath();
            ctx.arc(cx, 0, puffR, Math.PI * 0.2, Math.PI * 1.6);
            // little tail trailing off to the right
            ctx.quadraticCurveTo(
              cx + puffR * 1.6, puffR * 0.4,
              cx + puffR * 2.4, puffR * 0.1,
            );
            ctx.stroke();
          }
          break;
        }
        case "ring-spiral": {
          // closed ring with a curl breaking off
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.32, 0, Math.PI * 2);
          ctx.stroke();
          // curl breaking off the right side
          ctx.beginPath();
          ctx.moveTo(r * 0.32, 0);
          ctx.quadraticCurveTo(r * 0.70, -r * 0.10, r * 0.62, -r * 0.45);
          ctx.quadraticCurveTo(r * 0.55, -r * 0.70, r * 0.20, -r * 0.62);
          ctx.quadraticCurveTo(-r * 0.05, -r * 0.55, r * 0.05, -r * 0.30);
          ctx.stroke();
          break;
        }
        case "wind-streak": {
          // elongated horizontal swoosh with a curl on the right end
          const len = r * 1.6;
          const amp = r * 0.10;
          ctx.beginPath();
          ctx.moveTo(-len * 0.5, 0);
          ctx.bezierCurveTo(
            -len * 0.22, -amp,
             len * 0.05,  amp * 0.6,
             len * 0.32, -amp * 0.2,
          );
          ctx.stroke();
          // terminal curl
          ctx.beginPath();
          ctx.moveTo(len * 0.32, -amp * 0.2);
          ctx.quadraticCurveTo(
             len * 0.52, -amp * 0.4,
             len * 0.50, -amp * 1.8,
          );
          ctx.quadraticCurveTo(
             len * 0.46, -amp * 3.0,
             len * 0.30, -amp * 2.4,
          );
          ctx.quadraticCurveTo(
             len * 0.20, -amp * 1.8,
             len * 0.34, -amp * 1.2,
          );
          ctx.stroke();
          break;
        }
      }
      ctx.restore();
    };

    const drawSunShafts = (
      ctx: CanvasRenderingContext2D,
      w: number,
      h: number,
      phase: number,
      elapsed: number,
      isLight: boolean,
    ) => {
      const stormDip = phase > 0.56 && phase < 0.90 ? 0.34 : 1;
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const origin = (0.18 + Math.sin(phase * Math.PI * 2) * 0.18) * w;
      // The gradient's geometry (0, 58, 0, h) is identical for every shaft
      // this frame — build it once and modulate per-shaft brightness with
      // globalAlpha instead of allocating a new CanvasGradient per shaft.
      const shaftGrad = ctx.createLinearGradient(0, 58, 0, h);
      shaftGrad.addColorStop(0, "rgba(255, 239, 190, 1)");
      shaftGrad.addColorStop(0.52, "rgba(166, 203, 224, 0.26)");
      shaftGrad.addColorStop(1, "rgba(255, 239, 190, 0)");
      ctx.fillStyle = shaftGrad;
      for (let i = 0; i < 5; i++) {
        const spread = 130 + i * 58;
        const x = origin + (i - 2.4) * spread + Math.sin(elapsed * 0.13 + i) * 18;
        const topWidth = 42 + i * 11;
        const lowerWidth = 210 + i * 46;
        const alpha = (isLight ? 0.070 : 0.040) * stormDip * (0.78 + Math.sin(elapsed * 0.20 + i) * 0.22);
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.moveTo(x - topWidth, 58);
        ctx.lineTo(x + topWidth, 58);
        ctx.lineTo(x + lowerWidth, h);
        ctx.lineTo(x - lowerWidth * 0.62, h);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    };

    const drawWindStroke = (
      ctx: CanvasRenderingContext2D,
      stroke: WindStroke,
      now: number,
      isLight: boolean,
    ) => {
      if (stroke.points.length < 2) return;
      const fadeAge = stroke.releasedAt ? (now - stroke.releasedAt) / 1000 : 0;
      const fade = stroke.releasedAt ? Math.max(0, 1 - fadeAge / 2.4) : 1;
      if (fade <= 0) return;
      const alpha = fade * (0.12 + stroke.strength * 0.26);
      const outer = isLight
        ? `rgba(95, 125, 150, ${(alpha * 0.38).toFixed(3)})`
        : `rgba(190, 218, 250, ${(alpha * 0.46).toFixed(3)})`;
      const inner = stroke.hue > 0.55
        ? `rgba(233, 184, 112, ${(alpha * 0.45).toFixed(3)})`
        : `rgba(162, 214, 246, ${(alpha * 0.48).toFixed(3)})`;

      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalCompositeOperation = isLight ? "source-over" : "screen";
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass === 0 ? outer : inner;
        ctx.lineWidth = pass === 0 ? 11 + stroke.strength * 16 : 0.8 + stroke.strength * 1.9;
        ctx.beginPath();
        const pts = stroke.points;
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length - 1; i++) {
          const midX = (pts[i].x + pts[i + 1].x) * 0.5;
          const midY = (pts[i].y + pts[i + 1].y) * 0.5;
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
        }
        const last = pts[pts.length - 1];
        ctx.lineTo(last.x, last.y);
        ctx.stroke();
      }

      ctx.fillStyle = inner;
      for (let i = 2; i < stroke.points.length; i += 7) {
        const p = stroke.points[i];
        const r = 0.7 + Math.sin((now - stroke.t0) * 0.004 + i) * 0.25 + stroke.strength * 0.9;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };

    // Takes the veil's fields as discrete params (rather than a RainVeil
    // object) so drawWeatherCell's storm-rain call below doesn't have to
    // allocate a throwaway object literal every frame per storm cell.
    const drawRainVeil = (
      ctx: CanvasRenderingContext2D,
      veilX: number,
      veilY: number,
      veilT0: number,
      veilStrength: number,
      veilWidth: number,
      veilSlant: number,
      veilSeed: number,
      now: number,
      elapsed: number,
      isLight: boolean,
    ) => {
      const age = (now - veilT0) / 1000;
      const fade = Math.max(0, 1 - age / 3.2);
      if (fade <= 0) return;
      ctx.save();
      ctx.globalAlpha = fade * (0.18 + veilStrength * 0.24);
      ctx.strokeStyle = isLight ? "rgba(77, 93, 112, 0.24)" : "rgba(176, 213, 255, 0.34)";
      ctx.lineWidth = 0.55 + veilStrength * 0.36;
      ctx.lineCap = "round";
      const drops = 44 + Math.round(veilStrength * 42);
      for (let i = 0; i < drops; i++) {
        const seeded = (Math.sin((i + 1) * 98.233 + veilSeed) * 43758.5453) % 1;
        const u = seeded < 0 ? seeded + 1 : seeded;
        const x = veilX - veilWidth * 0.5 + u * veilWidth + Math.sin(elapsed * 1.8 + i) * 6;
        const y = veilY + ((elapsed * (78 + veilStrength * 44) + i * 17 + veilSeed) % 170) - 52;
        const len = 14 + veilStrength * 26 + (i % 4) * 3;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + veilSlant, y + len);
        ctx.stroke();
      }
      ctx.restore();
    };

    const drawWeatherCell = (
      ctx: CanvasRenderingContext2D,
      cell: WeatherCell,
      now: number,
      elapsed: number,
      dt: number,
      w: number,
      h: number,
      isLight: boolean,
    ) => {
      const age = (now - cell.t0) / 1000;
      const life = cell.kind === "storm" ? 72 : 58;
      const fadeIn = Math.min(1, age / 1.2);
      const fadeOut = Math.max(0, 1 - Math.max(0, age - life * 0.72) / (life * 0.28));
      const alpha = fadeIn * fadeOut;
      if (alpha <= 0) return;

      if (!reduce) {
        cell.x += (cell.drift + windX * (cell.kind === "storm" ? 9 : 18)) * dt;
        cell.y -= cell.lift * dt;
        const margin = 180 * cell.spread;
        if (cell.x > w + margin) cell.x = -margin;
        if (cell.x < -margin) cell.x = w + margin;
        if (cell.y < 76) cell.y = h * (0.66 + Math.random() * 0.12);
      }

      // The cell's body is no longer painted here — it is injected into the
      // volume shader as a puff, so a tap thickens real cloud rather than
      // laying a decal over it. What stays on the overlay is what the volume
      // can't say: the rain shadow under a storm cell, and its fall.
      const pulse = 1 + Math.sin(elapsed * (cell.kind === "storm" ? 0.7 : 1.05) + cell.phase) * 0.05;
      const s = cell.spread * (0.82 + cell.strength * 0.82) * pulse;

      if (cell.kind === "storm") {
        ctx.save();
        ctx.globalAlpha = alpha * (0.18 + cell.strength * 0.14);
        ctx.fillStyle = isLight ? "rgba(4, 11, 22, 0.42)" : "rgba(3, 7, 18, 0.52)";
        ctx.beginPath();
        ctx.ellipse(cell.x + 6 * s, cell.y + 22 * s, 42 * s, 13 * s, -0.03, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        if (cell.rain > 0.28) {
          drawRainVeil(
            ctx,
            cell.x,
            cell.y + 36 * s,
            now - 700,
            cell.rain * alpha,
            150 * s,
            -7 + windX * 20,
            cell.phase * 100,
            now,
            elapsed,
            isLight,
          );
        }
      }
    };

    // ── render loop ────────────────────────────────────────────────
    let raf = 0;
    let lastFrameMs = performance.now();
    // smoothed press strength so the cumulus dark-push doesn't snap
    let pressSmoothed = 0;
    // the deck's own travel through the noise field — pushed wind moves the
    // clouds themselves, and the offset persists after the hand lets go
    let driftX = 0;
    let driftY = 0;
    let frameAvg = 16;
    let lastQualityCheck = performance.now();

    const draw = (now: number) => {
      const tier = gov.beginFrame(now);
      if (asleep) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const detail = detailForTier(tier);
      const w = overlay.clientWidth;
      const h = overlay.clientHeight;
      const frameDt = Math.min(0.05, (now - lastFrameMs) / 1000);
      lastFrameMs = now;
      // three-finger time dilation: the sky's clock eases to ~1/4 speed
      timeScale += (timeScaleTarget - timeScale) * Math.min(1, frameDt * 5);
      simElapsed += frameDt * timeScale;
      simNowMs += frameDt * 1000 * timeScale;
      panX += (panXTarget - panX) * Math.min(1, frameDt * 3);
      panY += (panYTarget - panY) * Math.min(1, frameDt * 3);
      const elapsed = simElapsed;
      const motionElapsed = reduce ? 0 : elapsed;
      elapsedRef.v = elapsed;
      const dt = frameDt * timeScale;
      // the law-wind carries the whole cloud deck with it
      driftX -= windX * dt * 3.4;
      driftY -= windY * dt * 2.1;
      // 120s day cycle — frozen at 0.2 (midday-warm) when motion is reduced.
      // phaseOffsetRef is advanced by the sun/moon glyph click (0..1).
      const rawPhase = reduce ? 0.2 : (elapsed / 120) % 1;
      const phase = ((rawPhase + phaseOffsetRef.current) % 1 + 1) % 1;

      // mirror phase-bright -> DOM so banners can flip color
      // light phases: 0.00..0.55  /  dark phases: 0.55..0.95
      const isLight = phase < 0.55 || phase > 0.93;
      // setState is cheap — only call when it flips
      if (isLight !== phaseLight) setPhaseLight(isLight);
      if (isLight !== iconIsSun) setIconIsSun(isLight);

      // press intensity: 0..1 derived from how long the user has held
      const heldSec = pointer.current.pressed
        ? (now - pointer.current.pressStart) / 1000
        : 0;
      const pressTarget = pointer.current.pressed ? Math.min(1, heldSec / 1.4) : 0;
      pressSmoothed += (pressTarget - pressSmoothed) * 0.10;
      if (now - lastChargeSync > 120) {
        lastChargeSync = now;
        setPressCharge(pressSmoothed);
      }
      if (!pointer.current.pressed) {
        windTargetX *= 0.965;
        windTargetY *= 0.955;
      }
      windX += (windTargetX - windX) * 0.055;
      windY += (windTargetY - windY) * 0.050;

      // rhythm entrainment: while a steady tapped pulse holds, a soft
      // vapor ring blooms on every beat with its own note — sight and
      // sound land in the same frame.
      if (performance.now() < entrainUntil && entrainBpm > 0) {
        const beatLen = 60 / entrainBpm;
        const beatIdx = Math.floor(elapsed / beatLen);
        if (beatIdx !== lastEntrainBeat) {
          lastEntrainBeat = beatIdx;
          const gx = w * (0.28 + 0.44 * ((beatIdx * 0.381966) % 1));
          const gy = h * (0.36 + 0.1 * ((beatIdx * 0.618034) % 1));
          cloudPuffs.push({ x: gx, y: gy, t0: simNowMs });
          if (cloudPuffs.length > 8) cloudPuffs.shift();
          try { getFieldAudio().playNote(60 + (beatIdx % 2) * 5, 140); } catch { /* noop */ }
        }
      }

      // ── WebGL pass ──
      if (gl && glProg) {
        // frame-time watcher: the volume march scales itself to the
        // machine it landed on rather than stuttering on a phone.
        frameAvg += (frameDt * 1000 - frameAvg) * 0.06;
        if (now - lastQualityCheck > 1200) {
          lastQualityCheck = now;
          const want =
            frameAvg > 26 ? skyScale - 0.09 :
            frameAvg < 13 ? skyScale + 0.05 :
            skyScale;
          const next = clamp(Math.round(want * 100) / 100, 0.40, 0.78);
          if (Math.abs(next - skyScale) > 0.02) {
            skyScale = next;
            resize();
          }
        }

        // the four freshest weather cells ride into the volume itself —
        // a tap really does thicken the air where the finger landed
        for (let i = 0; i < 4; i++) {
          const cell = weatherCells[weatherCells.length - 1 - i];
          const o = i * 4;
          if (!cell) {
            puffData[o] = 0; puffData[o + 1] = 0; puffData[o + 2] = 0; puffData[o + 3] = 0;
            continue;
          }
          const age = (simNowMs - cell.t0) / 1000;
          const life = cell.kind === "storm" ? 72 : 58;
          const env = Math.min(1, age / 1.1) * Math.max(0, 1 - Math.max(0, age - life * 0.6) / (life * 0.4));
          const s = cell.strength * env * (cell.kind === "storm" ? -1 : 1);
          puffData[o] = clamp(cell.x / Math.max(1, w), 0, 1);
          puffData[o + 1] = clamp(1 - cell.y / Math.max(1, h), 0, 1);
          puffData[o + 2] = s;
          puffData[o + 3] = 0;
        }

        gl.useProgram(glProg);
        if (uTimeLoc) gl.uniform1f(uTimeLoc, reduce ? 21.5 : elapsed);
        if (uResLoc) gl.uniform2f(uResLoc, sky.width, sky.height);
        if (uDriftLoc) gl.uniform2f(uDriftLoc, driftX, driftY);
        if (uPuffsLoc) gl.uniform4fv(uPuffsLoc, puffData);
        if (uPhaseLoc) gl.uniform1f(uPhaseLoc, phase);
        if (uCursorLoc) {
          gl.uniform2f(
            uCursorLoc,
            pointer.current.over ? pointer.current.uvx : -1,
            pointer.current.over ? pointer.current.uvy : -1,
          );
        }
        if (uPressLoc) gl.uniform1f(uPressLoc, pressSmoothed);
        if (uWindLoc) gl.uniform2f(uWindLoc, windX, windY);
        if (uLensLoc) gl.uniform1f(uLensLoc, lens);
        if (uSeasonLoc) gl.uniform1f(uSeasonLoc, season);
        if (uPanLoc) gl.uniform2f(uPanLoc, panX, panY);
        if (uMaxStepsLoc) gl.uniform1f(uMaxStepsLoc, Math.max(12, Math.round(64 * detail.samples)));
        // pick the most recent active lightning for flash
        let flash = 0;
        for (const l of lightnings.current) {
          const age = (simNowMs - l.t0) / 1000;
          if (age < 0.36) {
            // sharp attack, exponential decay
            const envelope = age < 0.04 ? age / 0.04 : Math.exp(-(age - 0.04) * 9);
            flash = Math.max(flash, envelope);
          }
        }
        if (uFlashLoc) gl.uniform1f(uFlashLoc, flash);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } else {
        // Fallback: paint a flat sky color so the page isn't blank.
        const sctx = sky.getContext("2d");
        if (sctx) {
          const dpr = resolveDpr(tier, { embedded, reducedMotion: reduce });
          sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          sctx.fillStyle = "#7ba3cf";
          sctx.fillRect(0, 0, w, h);
        }
      }

      // ── 2D overlay pass ──
      octx.clearRect(0, 0, w, h);

      const stormFade = phase > 0.55 && phase < 0.93 ? 0.55 : 1;
      drawSunShafts(octx, w, h, phase, motionElapsed, isLight);

      // ── cells act on each other ──
      // Two that touch merge into one that is neither parent: combined
      // strength and spread, and enough combined strength condenses it all
      // the way to a storm cell — real growth toward cumulonimbus, not a
      // scripted tap response. A storm heavy with rain sheds a downdraft
      // that feeds any vapor cell nearby, pushing it toward its own storm —
      // a chain reaction, not an isolated decal.
      if (!reduce) {
        for (let i = 0; i < weatherCells.length; i++) {
          const a = weatherCells[i];
          for (let j = weatherCells.length - 1; j > i; j--) {
            const b = weatherCells[j];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            const reach = (a.spread + b.spread) * 46;
            if (d > reach) continue;
            const sum = a.strength + b.strength;
            a.strength = Math.min(1, sum * 0.62);
            a.spread = Math.min(2.2, a.spread + b.spread * 0.5);
            a.rain = Math.max(a.rain, b.rain);
            if (a.kind === "storm" || b.kind === "storm" || sum > 1.15) {
              a.kind = "storm";
              a.rain = Math.max(a.rain, 0.45);
            }
            a.x = (a.x + b.x) / 2;
            a.y = Math.min(a.y, b.y);
            weatherCells.splice(j, 1);
            try { getFieldAudio().thud(); } catch { /* noop */ }
            try { haptics.bloom(); } catch { /* noop */ }
            addWeatherMark("cells merge", 0.6 + Math.min(0.3, sum * 0.2));
            useField.getState().recordTape("region", 0.65, "clouds/cell-merge");
          }
        }
        for (const a of weatherCells) {
          if (a.kind !== "storm" || a.rain < 0.5) continue;
          for (const b of weatherCells) {
            if (b === a || b.kind === "storm") continue;
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d > 220) continue;
            b.strength = Math.min(1, b.strength + dt * 0.12);
            if (b.strength > 0.78) {
              b.kind = "storm";
              b.rain = Math.max(b.rain, 0.4);
              try { haptics.chop(); } catch { /* noop */ }
              addWeatherMark("downdraft feeds a neighbour", 0.6);
            }
          }
        }
      }

      for (let i = weatherCells.length - 1; i >= 0; i--) {
        const cell = weatherCells[i];
        const age = (simNowMs - cell.t0) / 1000;
        const life = cell.kind === "storm" ? 72 : 58;
        if (age > life) {
          weatherCells.splice(i, 1);
          continue;
        }
        drawWeatherCell(octx, cell, simNowMs, motionElapsed, dt, w, h, isLight);
      }

      for (let i = rainVeils.length - 1; i >= 0; i--) {
        const veil = rainVeils[i];
        const age = (simNowMs - veil.t0) / 1000;
        if (age > 3.2) {
          rainVeils.splice(i, 1);
          continue;
        }
        drawRainVeil(
          octx,
          veil.x,
          veil.y,
          veil.t0,
          veil.strength,
          veil.width,
          veil.slant,
          veil.seed,
          simNowMs,
          motionElapsed,
          isLight,
        );
      }

      for (let i = windStrokes.length - 1; i >= 0; i--) {
        const stroke = windStrokes[i];
        if (stroke.releasedAt && (simNowMs - stroke.releasedAt) / 1000 > 2.4) {
          windStrokes.splice(i, 1);
          continue;
        }
        drawWindStroke(octx, stroke, simNowMs, isLight);
      }

      const crystalColor = isLight ? "rgba(237, 249, 255, 0.42)" : "rgba(184, 219, 255, 0.34)";
      octx.save();
      octx.globalCompositeOperation = "screen";
      octx.strokeStyle = crystalColor;
      octx.lineWidth = 0.8;
      octx.lineCap = "round";
      for (const c of iceCrystals) {
        const x = c.xFrac * w + Math.sin(elapsed * 0.05 + c.phase) * 18;
        const y = c.yFrac * h + Math.cos(elapsed * 0.07 + c.phase) * 5;
        const r = c.size * (1 + Math.sin(elapsed * 0.8 + c.phase) * 0.12);
        const rot = elapsed * c.spin + c.phase;
        octx.save();
        octx.translate(x, y);
        octx.rotate(rot);
        octx.globalAlpha = 0.12 + Math.max(0, Math.sin(elapsed * 0.9 + c.phase)) * 0.22;
        octx.beginPath();
        octx.moveTo(-r, 0); octx.lineTo(r, 0);
        octx.moveTo(0, -r); octx.lineTo(0, r);
        octx.stroke();
        octx.fillStyle = crystalColor;
        octx.beginPath();
        octx.arc(0, 0, Math.max(0.45, r * 0.18), 0, Math.PI * 2);
        octx.fill();
        octx.restore();
      }
      octx.restore();

      // drifting Minoan wind glyphs — a chorus across altitudes
      const glyphColor = isLight ? "rgba(17, 29, 42, 0.32)" : "rgba(202, 225, 255, 0.38)";
      // same RGB as glyphColor, precomputed once per frame so the trail dot
      // loop below can build its rgba string without a per-dot regex replace
      const glyphTrailRgb = isLight ? "17, 29, 42" : "202, 225, 255";
      // fainter during storm phase
      for (const g of glyphs) {
        if (!reduce) {
          // drift — racing with the law-wind when three fingers push it
          g.x += (g.vx + windX * 60) * dt;
          // wrap with margin so wide glyphs don't pop in/out
          const margin = g.size * 2 + 8;
          if (g.x > w + margin) g.x = -margin;
          else if (g.x < -margin) g.x = w + margin;
          // rotate (per-frame, dt-normalized to feel right at any framerate)
          // hovered glyphs spin 2× faster (subtle but noticeable)
          const spinMul = g.hovered ? 2 : 1;
          g.rotation += g.rotSpeed * (dt * 60) * spinMul;
        }
        const y = reduce
          ? g.baseY
          : g.baseY + Math.sin(elapsed * g.bobFreq * Math.PI * 2 + g.phase) * g.bobAmp;

        // draw breadcrumb trail BEFORE the glyph so trail sits under it
        if (g.trail.length > 0) {
          for (let ti = g.trail.length - 1; ti >= 0; ti--) {
            const dot = g.trail[ti];
            const age = (now - dot.t0) / 1000;
            if (age > 0.9) { g.trail.splice(ti, 1); continue; }
            const a = Math.max(0, 1 - age / 0.9) * 0.55 * stormFade;
            octx.fillStyle = `rgba(${glyphTrailRgb}, ${a.toFixed(3)})`;
            octx.beginPath();
            octx.arc(dot.x, dot.y, 1.6, 0, Math.PI * 2);
            octx.fill();
          }
        }

        // temporarily stash the instance opacity so drawGlyph can fade by storm
        const baseOp = g.opacity;
        const titleClear = Math.abs(g.x - w * 0.5) < 250 && y < 170 ? 0.22 : 1;
        g.opacity = baseOp * stormFade * titleClear;
        if (!reduce && g.hovered) {
          // scale 1.15× around (x, y) for the duration of this call
          octx.save();
          octx.translate(g.x, y);
          octx.scale(1.15, 1.15);
          octx.translate(-g.x, -y);
          drawGlyph(octx, g, y, glyphColor);
          octx.restore();
        } else {
          drawGlyph(octx, g, y, glyphColor);
        }
        g.opacity = baseOp;
      }

      // cloud puffs (cloud-body taps) — soft expanding rings
      if (cloudPuffs.length > 0) {
        for (let i = cloudPuffs.length - 1; i >= 0; i--) {
          const p = cloudPuffs[i];
          const age = (simNowMs - p.t0) / 1000;
          if (age > 1.2) { cloudPuffs.splice(i, 1); continue; }
          const t01 = age / 1.2;
          const r = 24 + Math.sin(t01 * Math.PI) * 90;
          const a = Math.max(0, 1 - t01) * (isLight ? 0.22 : 0.16);
          octx.save();
          octx.globalCompositeOperation = "screen";
          const bloom = octx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          bloom.addColorStop(0, `rgba(220, 244, 255, ${(a * 0.65).toFixed(3)})`);
          bloom.addColorStop(0.45, `rgba(255, 223, 176, ${(a * 0.24).toFixed(3)})`);
          bloom.addColorStop(1, "rgba(220, 244, 255, 0)");
          octx.fillStyle = bloom;
          octx.beginPath();
          octx.ellipse(p.x, p.y, r, r * 0.32, Math.sin(age * 2) * 0.08, 0, Math.PI * 2);
          octx.fill();
          octx.restore();
        }
      }

      // lightning bolts
      for (let i = lightnings.current.length - 1; i >= 0; i--) {
        const l = lightnings.current[i];
        const age = (simNowMs - l.t0) / 1000;
        if (age > 0.6) {
          lightnings.current.splice(i, 1);
          continue;
        }
        // alpha envelope: hot for ~120ms, fades by 600ms
        const alpha = Math.max(0, 1 - age / 0.6) * (age < 0.12 ? 1 : 0.7);
        // outer glow
        octx.save();
        octx.globalAlpha = alpha * 0.34;
        octx.strokeStyle = "rgba(160, 209, 255, 1)";
        octx.lineWidth = 10;
        octx.lineCap = "round";
        octx.lineJoin = "round";
        octx.beginPath();
        for (let j = 0; j < l.segs.length; j++) {
          const p = l.segs[j];
          if (j === 0) octx.moveTo(p.x, p.y);
          else octx.lineTo(p.x, p.y);
        }
        octx.stroke();
        // core
        octx.globalAlpha = alpha;
        octx.strokeStyle = "rgba(226, 243, 255, 1)";
        octx.lineWidth = 1.45;
        octx.beginPath();
        for (let j = 0; j < l.segs.length; j++) {
          const p = l.segs[j];
          if (j === 0) octx.moveTo(p.x, p.y);
          else octx.lineTo(p.x, p.y);
        }
        octx.stroke();
        octx.restore();
      }

      // glimmer (grammar §6): after ~20s of quiet, a faint spiral of air
      // turns where a circling finger would spin it — a physical hint,
      // never text.
      if (performance.now() - lastGestureAt > 20000) {
        const slot = Math.floor(now / 9000);
        const gx = (0.24 + glimmerSeed(slot, 0) * 0.52) * w;
        const gy = h * (0.3 + glimmerSeed(slot, 7) * 0.3);
        const pulse = reduce ? 0.5 : 0.5 + Math.sin(now / 480) * 0.5;
        octx.save();
        octx.strokeStyle = isLight
          ? `rgba(17, 29, 42, ${(0.04 + pulse * 0.06).toFixed(3)})`
          : `rgba(202, 225, 255, ${(0.05 + pulse * 0.08).toFixed(3)})`;
        octx.lineWidth = 1;
        octx.beginPath();
        const turns = Math.PI * 2.6;
        for (let i = 0; i <= 40; i++) {
          const th = (i / 40) * turns + (reduce ? 0 : now / 2400);
          const rr = 3 + (i / 40) * (16 + pulse * 8);
          const px = gx + Math.cos(th) * rr;
          const py = gy + Math.sin(th) * rr * 0.7;
          if (i === 0) octx.moveTo(px, py);
          else octx.lineTo(px, py);
        }
        octx.stroke();
        octx.restore();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      detachGestures();
      detachVessel();
      unvis();
      ungal();
      overlay.removeEventListener("pointermove", onHover);
      overlay.removeEventListener("pointerleave", onHoverLeave);
      sky.removeEventListener("webglcontextlost", onContextLost);
      sky.removeEventListener("webglcontextrestored", onContextRestored);
      delete wrap.dataset.lensRaised;
      if (gl) {
        if (glProg) gl.deleteProgram(glProg);
        if (vbo) gl.deleteBuffer(vbo);
      }
      clearWeatherRef.current = () => {};
    };
    // We intentionally keep this effect dependency-free — the loop reads live
    // refs and only the banner color depends on phaseLight, which is set from
    // inside the loop via the React closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const letGo = useCallback(() => {
    clearWeatherRef.current();
    getFieldAudio().thud();
    haptics.roll();
  }, []);

  // Frame color flips between dark-on-light and cream-on-dark depending on
  // whether the sky is in a bright or stormy phase, so the meander always
  // has enough contrast against the day cycle's underlying gradient.
  const frameColor = phaseLight ? "rgba(21, 23, 26, 0.30)" : "rgba(244, 238, 222, 0.58)";
  const titleColor = phaseLight ? "rgba(21, 23, 26, 0.70)" : "rgba(244, 238, 222, 0.84)";
  const labelColor = phaseLight ? "rgba(21, 23, 26, 0.40)" : "rgba(244, 238, 222, 0.50)";

  return (
    <div
      ref={wrapRef}
      className="clouds-root"
      aria-label="olympus — living weather instrument"
      data-touch-surface="true"
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        background: "var(--paper)",
      }}
    >
      <canvas
        ref={skyRef}
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
      />
      <canvas
        ref={overlayRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          display: "block",
          touchAction: "none",
          cursor: "crosshair",
        }}
      />

      <LetGo label="let the sky clear" onLetGo={letGo} visible={hasBuilt} />

      {/* Classical Hellenic window border — a Greek key meander on all four
          sides framing the sky. The shared header stays available, but is
          made transparent by the route styles below so it does not read as a
          slab over the atmosphere. */}
      <GreekKeyFrame
        top={56}
        bottom={0}
        thickness={18}
        mobileThickness={12}
        strokeThickness={1.4}
        color={frameColor}
        opacity={1}
        zIndex={20}
      />

      {/* OLYMPUS title + subtitle */}
      <div
        className="cloud-title"
        style={{
          position: "absolute",
          top: 84,
          left: 0,
          right: 0,
          textAlign: "center",
          pointerEvents: "none",
          zIndex: 3,
        }}
      >
        <WaterText
          as="h1"
          bobAmp={0}
          style={{
            display: "block",
            margin: 0,
            fontFamily: "var(--font-numerals)",
            fontWeight: 500,
            fontSize: 28,
            letterSpacing: "0.32em",
            color: titleColor,
            textTransform: "uppercase",
          }}
        >
          Olympus
        </WaterText>
        <WaterText
          as="div"
          bobAmp={2}
          style={{
            display: "block",
            marginTop: 6,
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 15,
            color: titleColor,
            opacity: 0.78,
            letterSpacing: "0.02em",
          }}
        >
          living weather
        </WaterText>
      </div>

      {/* Cloud-type labels — right edge, faint mono lowercase. Tappable for
          brief descriptions. */}
      <div
        className="cloud-labels"
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          right: 24,
          width: 80,
          pointerEvents: "none",
          zIndex: 3,
          fontFamily: "var(--font-text)",
          fontSize: 11,
          letterSpacing: "0.10em",
          textTransform: "lowercase",
          color: labelColor,
        }}
      >
        {CLOUD_TYPES.map((ct) => (
          <button
            key={ct.name}
            type="button"
            onClick={() => {
              setLabelTip({ name: ct.name, text: ct.text, top: ct.top });
              try { getFieldAudio().chime(); } catch { /* noop */ }
              haptics.tap();
              useField.getState().recordTape("object", 0.25, `clouds/${ct.name}`);
              addWeatherMark(ct.name, 0.32);
              // auto-clear in 4s; the rAF loop is independent so a window
              // timeout is fine here.
              window.setTimeout(() => {
                setLabelTip((cur) => (cur && cur.name === ct.name ? null : cur));
              }, 4000);
            }}
            style={{
              position: "absolute",
              top: ct.top,
              right: 0,
              pointerEvents: "auto",
              background: "transparent",
              border: "none",
              color: "inherit",
              font: "inherit",
              letterSpacing: "inherit",
              textTransform: "inherit",
              cursor: "pointer",
              padding: "6px 4px", // ≥ touch target
              minHeight: 20,
            }}
            aria-label={`${ct.name} — show description`}
            className="cloud-label-button"
          >
            {ct.name}
          </button>
        ))}
      </div>

      {/* label tip — fades in for ~4s near the tapped label */}
      {labelTip && (
        <div
          className="cloud-label-tip"
          style={{
            position: "absolute",
            top: `calc(${labelTip.top} + 22px)`,
            right: 24,
            maxWidth: 260,
            padding: "8px 10px",
            background: phaseLight
              ? "rgba(244, 238, 222, 0.88)"
              : "rgba(20, 22, 30, 0.85)",
            color: phaseLight ? "rgba(21, 23, 26, 0.92)" : "rgba(244, 238, 222, 0.95)",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 13,
            lineHeight: 1.4,
            letterSpacing: "0.01em",
            pointerEvents: "none",
            zIndex: 4,
            animation: "clouds-fadeIn 240ms ease-out",
          }}
        >
          {labelTip.text}
        </div>
      )}

      {/* Sun / moon glyph — top right corner, clickable to advance day-cycle.
          A hidden affordance — small but reachable. */}
      <button
        className="cloud-day-toggle"
        type="button"
        onClick={() => {
          phaseOffsetRef.current = (phaseOffsetRef.current + 0.25) % 1;
          try { getFieldAudio().bell(); } catch { /* noop */ }
          haptics.roll();
          useField.getState().recordTape("region", 0.45, "clouds/day-cycle");
          addWeatherMark(iconIsSun ? "moonward" : "sunward", 0.58);
        }}
        aria-label="advance day cycle"
        style={{
          position: "absolute",
          top: 88,
          right: 24,
          width: 28,
          height: 28,
          padding: 0,
          background: "transparent",
          border: "none",
          color: phaseLight ? "rgba(21, 23, 26, 0.55)" : "rgba(244, 238, 222, 0.75)",
          cursor: "pointer",
          pointerEvents: "auto",
          zIndex: 4,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {iconIsSun ? (
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="10" cy="10" r="3.6" fill="currentColor" />
            {Array.from({ length: 8 }).map((_, i) => {
              const a = (i / 8) * Math.PI * 2;
              const x1 = 10 + Math.cos(a) * 5.4;
              const y1 = 10 + Math.sin(a) * 5.4;
              const x2 = 10 + Math.cos(a) * 8.2;
              const y2 = 10 + Math.sin(a) * 8.2;
              return (
                <line
                  key={i}
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke="currentColor" strokeWidth={1.2} strokeLinecap="round"
                />
              );
            })}
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <path
              d="M14.4 12.4 A6.2 6.2 0 1 1 10 4 a4.4 4.4 0 0 0 4.4 8.4z"
              fill="currentColor"
            />
          </svg>
        )}
      </button>

      <div
        className="cloud-weather-ribbon"
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 132,
          left: 24,
          display: "flex",
          alignItems: "center",
          gap: 8,
          zIndex: 4,
          pointerEvents: "none",
          color: titleColor,
          fontFamily: "var(--font-text)",
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "lowercase",
        }}
      >
        <span
          style={{
            width: 54,
            height: 6,
            borderRadius: 999,
            border: `1px solid ${phaseLight ? "rgba(21,23,26,0.34)" : "rgba(244,238,222,0.38)"}`,
            overflow: "hidden",
            background: phaseLight ? "rgba(21,23,26,0.08)" : "rgba(244,238,222,0.10)",
            display: "inline-flex",
          }}
        >
          <span
            style={{
              width: `${Math.max(8, Math.round(pressCharge * 100))}%`,
              background: phaseLight ? "rgba(90,77,106,0.66)" : "rgba(216,196,216,0.80)",
              transition: "width 120ms ease-out",
            }}
          />
        </span>
        {weatherMarks.map((mark) => (
          <span
            key={mark.id}
            style={{
              opacity: 0.46 + mark.level * 0.44,
              borderBottom: `1px solid ${phaseLight ? "rgba(21,23,26,0.26)" : "rgba(244,238,222,0.28)"}`,
            }}
          >
            {mark.label}
          </span>
        ))}
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html:
            `
            @keyframes clouds-fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
            body:has(.clouds-root) header:not(.oda-site-header) {
              background: transparent !important;
              border-bottom: 0 !important;
              backdrop-filter: none !important;
              -webkit-backdrop-filter: none !important;
            }
            body:has(.clouds-root) .oda-field-watch,
            body:has(.clouds-root) .oda-candle-mark,
            body:has(.clouds-root) .oda-tape-shell,
            body:has(.clouds-root) .oda-sound-toggle {
              display: none !important;
            }
            @media (max-width: 700px) {
              .cloud-title {
                top: 78px !important;
              }
              .cloud-title h1 {
                font-size: 25px !important;
                letter-spacing: 0.24em !important;
              }
              .cloud-day-toggle {
                top: 84px !important;
                right: 16px !important;
                width: 44px !important;
                height: 44px !important;
              }
              .cloud-labels {
                top: auto !important;
                left: 12px !important;
                right: 12px !important;
                bottom: calc(58px + env(safe-area-inset-bottom, 0px)) !important;
                width: auto !important;
                height: 42px !important;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 3px;
                font-size: 10px !important;
                pointer-events: auto !important;
              }
              .cloud-label-button {
                position: static !important;
                min-height: 36px !important;
                padding: 4px 6px !important;
                flex: 0 1 auto;
              }
              .cloud-label-tip {
                top: auto !important;
                left: 16px !important;
                right: 16px !important;
                bottom: calc(108px + env(safe-area-inset-bottom, 0px)) !important;
                max-width: none !important;
                text-align: center;
              }
              .cloud-weather-ribbon {
                top: 154px !important;
                left: 16px !important;
                right: 16px !important;
                max-width: calc(100vw - 32px);
                flex-wrap: wrap;
                gap: 6px 8px !important;
                font-size: 10px !important;
              }
            }
            `,
        }}
      />
    </div>
  );
}

// Cloud-type label data — top-position keyed to the same fractions used by
// the original span layout, plus a brief description shown on tap.
const CLOUD_TYPES = [
  { name: "cirrus", top: "16%",
    text: "cirrus — ice crystals at altitude, drawn into wisps by the wind." },
  { name: "altostratus", top: "34%",
    text: "altostratus — a uniform mid-level sheet that veils the sun." },
  { name: "cumulus", top: "52%",
    text: "cumulus — heaped, cauliflower clouds of fair-weather convection." },
  { name: "nimbus", top: "70%",
    text: "nimbus — dense and dark, the bearer of rain." },
];
