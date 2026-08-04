"use client";

/**
 * TravelPassage — the crossing as a place, without becoming a room.
 *
 * Most band crossings fade to ink and go (ScaleTravel.executeTravel). The
 * atlas ↔ stars edge is the album's trunk — the map recedes into the sky —
 * and that transition deserves to be traversed, not skipped: the parchment
 * chart curls onto a turning planet, the camera pulls back through near
 * orbit, and the sky thickens into stars. Travelling back down plays the
 * same film reversed. ~3.5s, and a tap anywhere skips to the end.
 *
 * Architecture: a registry (PASSAGES in lib/travel-passage.ts) keyed by travel
 * edge, consumed by the shared travel execution. Unregistered edges take the
 * shared default film — no hard cuts. The overlay must survive the route change (router.push fires
 * mid-passage so the destination loads behind the film), so it is rendered
 * by TravelPassageHost, mounted once in the ROOT LAYOUT — the App Router
 * never remounts the root layout on navigation, so the host, its canvas,
 * and its rAF loop persist while the page beneath swaps. A module-level
 * bus (playTravelPassage) hands the host its cue; if the host is somehow
 * absent the caller falls back to the ink fade and nothing is lost.
 *
 * Everything on screen is procedural and deterministic (seeded value
 * noise; no Math.random): token-palette continents, drifting cloud bands,
 * a terminator with candle-warm city specks on the night side, a thin
 * atmosphere rim, an aurora whisper at the pole, one satellite glint.
 * One canvas, one rAF. Sound rides setScaleRegister (the register glides
 * from the atlas's decades to the stars') plus a single low bell at
 * planetfall; haptics are the shared crossing/detent words. Reduced
 * motion becomes three gentle cross-dissolved stills (map → globe →
 * stars) over ~1.2s.
 */

import { useEffect, useRef, useState } from "react";
import { SCALE_BANDS, type ScaleBand, type ScaleBandId } from "@/lib/scale";
import { seededRandom } from "@/lib/manifold-field";
import { getFieldAudio, setScaleRegister } from "@/lib/audio";
import { detent as hapticDetent } from "@/lib/haptics";
import { skyColor, tonemap } from "@/lib/aircolumn";
import { PITCH_DEFAULT, buildStars, starState, waveNumber } from "@/lib/spiral";
import {
  worldFromLatent,
  worldFromSeed,
  worldColors,
  hashSeed as forgeHash,
  RING_MIN,
  type World,
} from "@/lib/worldforge";

import {
  DEFAULT_PASSAGE,
  PASSAGES,
  resolvePassageSpec,
  type PassageEdgeKey,
  type PassageSpec,
} from "@/lib/travel-passage";

export type { PassageEdgeKey, PassageSpec };
export { DEFAULT_PASSAGE, PASSAGES, resolvePassageSpec };

// ——— The bus between executeTravel and the host in the root layout ———

type ActivePassage = {
  spec: PassageSpec;
  /** Register glide start — the wall of the band being left. */
  sFrom: number;
  /** Register glide end — the landing position in the destination band. */
  sTo: number;
  navigate: () => void;
  nonce: number;
};

let hostCue: ((p: ActivePassage) => void) | null = null;
let passageNonce = 0;

/**
 * Play the passage for this travel edge. Every edge gets a film — registered
 * trunk films when present, otherwise the shared default. Returns true when
 * the passage owns the transition (caller must NOT run its own fade/nav);
 * false only when the host is unmounted (SSR / tests without a layout).
 */
export function playTravelPassage(
  from: ScaleBandId,
  dest: ScaleBand,
  sLand: number,
  navigate: () => void,
): boolean {
  if (typeof window === "undefined" || !hostCue) return false;
  const spec = resolvePassageSpec(from, dest);
  // A missing origin band only costs the register glide, never the film —
  // edges may be registered ahead of a band's declaration landing.
  const fromBand = SCALE_BANDS.find((b) => b.id === from);
  hostCue({
    spec,
    sFrom: fromBand ? (spec.out ? fromBand.sMax : fromBand.sMin) : sLand,
    sTo: sLand,
    navigate,
    nonce: ++passageNonce,
  });
  return true;
}

// ——— Palette (the site tokens, as numbers the canvas can mix) ————————

type RGB = [number, number, number];
const PAPER: RGB = [242, 238, 230]; // --paper
const PAPER2: RGB = [232, 226, 213]; // --paper-2
const INK: RGB = [21, 23, 26]; // --ink
const NIGHT: RGB = [9, 11, 14]; // the ink-fade black every crossing knows
const SEA: RGB = [44, 74, 92]; // --sea
const KEPT: RGB = [110, 90, 46]; // --kept
const CANDLE: RGB = [200, 115, 42]; // --candle
// The aurora whisper: the sea lifted toward paper, leaning green.
const AURORA: RGB = [124, 172, 150];

const TAU = Math.PI * 2;
const PASSAGE_SEED = 0x0b57a12d; // one planet, always yours

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const rgba = (c: RGB, a: number) =>
  `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${a.toFixed(3)})`;

// ——— Seeded value noise ————————————————————————————————————————————

type Noise2 = (x: number, y: number) => number;

function makeNoise2(seed: number): Noise2 {
  const hash = (xi: number, yi: number): number => {
    let h = (Math.imul(xi, 374761393) + Math.imul(yi, 668265263)) ^ seed;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  return (x: number, y: number): number => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    let fx = x - xi;
    let fy = y - yi;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const a = hash(xi, yi);
    const b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1);
    const d = hash(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

function fbm(n: Noise2, x: number, y: number, octaves: number): number {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * n(x, y);
    norm += amp;
    amp *= 0.5;
    x = x * 2.03 + 11.7;
    y = y * 1.97 + 5.3;
  }
  return sum / norm;
}

// ——— The film ————————————————————————————————————————————————————————
//
// One scene function of a single film coordinate u ∈ [0, 1]:
//   u = 0    the parchment chart, flat, filling the frame
//   u ≈ 0.35 the sheet has curled onto the sphere — planetfall
//   u ≈ 0.7  near orbit, the planet small and turning
//   u = 1    deep star field, the planet a speck
// Outbound plays u forward; the return plays the same film backward, so
// both directions are one drawing and the reversal is exact.

const LON = 384;
const LAT = 160;
const TEX = 168;
const LAND_TH = 0.53;

type Film = {
  renderFrame: (ctx: CanvasRenderingContext2D, w: number, h: number, u: number) => void;
};

function makeFilm(seed: number): Film | null {
  const vignette = makeVignette();
  // The breath of pale sea around the sphere: a ring, so the ramp rises off
  // the limb and falls again — built once, blitted every frame.
  const atmosphereSprite = makeRadialSprite([
    [0, AURORA, 0],
    [0.738, AURORA, 0],
    [0.848, [120, 160, 168], 0.22],
    [0.984, AURORA, 0],
    [1, AURORA, 0],
  ]);
  const nA = makeNoise2(seed ^ 0x9e3779b9);
  const nB = makeNoise2(seed ^ 0x85ebca6b);
  const nC = makeNoise2(seed ^ 0xc2b2ae35);
  const nD = makeNoise2(seed ^ 0x27d4eb2f);

  // Spherical fields, precomputed once on an equirect grid so the per-frame
  // texture loop is lookups, not noise. Longitude wraps because the fields
  // are built from cos/sin of lon — no seam.
  const landF = new Float32Array(LON * LAT);
  const cloudF = new Float32Array(LON * LAT);
  const cityF = new Float32Array(LON * LAT);
  for (let j = 0; j < LAT; j++) {
    const lat = (j / (LAT - 1) - 0.5) * Math.PI;
    for (let i = 0; i < LON; i++) {
      const lon = (i / LON) * TAU;
      const cx = Math.cos(lon);
      const sx = Math.sin(lon);
      const k = j * LON + i;
      landF[k] =
        0.55 * fbm(nA, cx * 1.6 + 9.2, lat * 1.9 + 7.7, 3) +
        0.45 * fbm(nB, sx * 1.6 + 3.1, lat * 1.9 + 21.4, 3);
      // Banded clouds: latitude belts modulating a broad drift field.
      const belt = 0.5 + 0.5 * Math.sin(lat * 5.2 + 2.4 * fbm(nC, cx * 1.1, lat * 1.3, 2) - 1.2);
      cloudF[k] =
        fbm(nC, cx * 2.3 + lat * 0.6 + 4.2, sx * 2.3 - lat * 0.9 + 8.8, 2) * (0.35 + 0.65 * belt);
      cityF[k] = nD(i * 0.61 + 2.3, j * 0.61 + 7.9);
    }
  }

  const sample = (F: Float32Array, lon: number, lat: number): number => {
    let li = lon / TAU;
    li -= Math.floor(li);
    const i = Math.min(LON - 1, (li * LON) | 0);
    const lj = clamp01(lat / Math.PI + 0.5);
    const j = Math.min(LAT - 1, (lj * LAT) | 0);
    return F[j * LON + i];
  };

  // The star field, seeded: position, size, phase, and a warm-tint few.
  const rng = seededRandom(seed ^ 0x51ed270b);
  const stars: Array<{ x: number; y: number; r: number; ph: number; warm: boolean }> = [];
  for (let i = 0; i < 460; i++) {
    stars.push({ x: rng(), y: rng(), r: 0.5 + rng() * 1.4, ph: rng() * TAU, warm: rng() > 0.92 });
  }

  // The globe texture — redrawn per frame into a small offscreen canvas,
  // then scaled up (painterly softness for free).
  let tex: HTMLCanvasElement;
  let tctx: CanvasRenderingContext2D | null;
  let img: ImageData;
  try {
    tex = document.createElement("canvas");
    tex.width = TEX;
    tex.height = TEX;
    tctx = tex.getContext("2d");
    if (!tctx) return null;
    img = tctx.createImageData(TEX, TEX);
  } catch {
    return null;
  }

  // Fixed sun, in view space: day on the upper left, terminator standing
  // still while the continents turn through it.
  const SUNX = -0.5;
  const SUNY = -0.22;
  const SUNZ = 0.84;

  const gridProx = (v: number): number => {
    const f = v - Math.floor(v);
    const d = Math.min(f, 1 - f);
    return Math.max(0, 1 - d / 0.045);
  };

  function renderGlobe(u: number): void {
    // c: how far the sheet has curled onto the sphere.
    const c = smoothstep(0, 0.35, u);
    const rot = 0.9 + u * 1.6; // the planet turns as the camera pulls away
    const drift = 0.35 + u * 1.3; // clouds slide along their belts
    const d = img.data;
    for (let j = 0; j < TEX; j++) {
      const y = ((j + 0.5) / TEX) * 2 - 1;
      for (let i = 0; i < TEX; i++) {
        const x = ((i + 0.5) / TEX) * 2 - 1;
        const o = (j * TEX + i) * 4;
        // Sheet → sphere silhouette: a superellipse relaxing into a circle.
        const p = 2 + (1 - c) * 9;
        const e = Math.pow(Math.abs(x), p) + Math.pow(Math.abs(y), p);
        if (e > 1.12) {
          d[o + 3] = 0;
          continue;
        }
        const edgeA = clamp01((1.06 - e) / 0.09);
        // The curl itself: planar coordinates bending into arcs of the globe.
        const xa = x < -0.9995 ? -0.9995 : x > 0.9995 ? 0.9995 : x;
        const ya = y < -0.9995 ? -0.9995 : y > 0.9995 ? 0.9995 : y;
        const lon = rot + lerp(x * 1.05, Math.asin(xa), c);
        const lat = lerp(y * 0.8, Math.asin(ya) * 0.97, c);

        const land = sample(landF, lon, lat);
        const landness = land - LAND_TH;
        const coast = 1 - Math.min(1, Math.abs(landness) / 0.012);

        let col: RGB;
        if (landness > 0) {
          // Continents in the token palette: vellum rising into kept-gold.
          const k = 0.16 + Math.min(0.62, landness * 3.4);
          col = mix(PAPER2, KEPT, k);
        } else {
          // Chart water is paper; as the sheet curls, the sea floods in.
          const depth = Math.min(1, -landness * 5);
          const seaCol = mix(SEA, [31, 52, 66], depth * 0.6);
          col = mix(PAPER, seaCol, 0.06 + 0.94 * c);
        }
        // Polar ice keeps the vellum.
        const ice = smoothstep(1.15, 1.38, Math.abs(lat));
        if (ice > 0) col = mix(col, PAPER, ice * 0.9);
        // The chart's ink: coastlines strong on paper, faint on the planet;
        // a graticule that bends with the curl and fades as it becomes sky.
        const grid = Math.max(gridProx(lon / 0.35), gridProx(lat / 0.35));
        const chartInk = Math.max(coast * (0.8 - 0.5 * c), grid * 0.22 * (1 - c));
        if (chartInk > 0) col = mix(col, INK, chartInk);

        // Shading: limb + terminator, only as far as it has become a sphere.
        const r2 = x * x + y * y;
        const z = Math.sqrt(Math.max(0.0001, 1 - Math.min(1, r2)));
        const dayS = SUNX * x + SUNY * y + SUNZ * z;
        const day = lerp(1, smoothstep(0.02, 0.38, dayS), c);

        // Cloud bands, drifting — brightest on the day side.
        if (c > 0.3) {
          const cl = smoothstep(0.55, 0.78, sample(cloudF, lon + drift, lat));
          const clA = cl * 0.6 * smoothstep(0.3, 0.7, c) * (0.35 + 0.65 * day);
          if (clA > 0) col = mix(col, PAPER, clA);
        }

        // Night falls; warm city specks answer from the dark land.
        const nightCol = mix(col, [14, 17, 24], 0.86);
        col = mix(nightCol, col, day);
        const night = 1 - day;
        if (c > 0.5 && landness > 0 && night > 0.35) {
          const cv = sample(cityF, lon, lat);
          const spark = cv > 0.962 ? 1 : cv > 0.9 ? 0.22 : 0;
          if (spark > 0) {
            col = mix(col, CANDLE, Math.min(1, spark * night * (c - 0.5) * 2.4));
          }
        }

        const limb = lerp(1, 0.5 + 0.5 * z, c * 0.9);
        d[o] = col[0] * limb;
        d[o + 1] = col[1] * limb;
        d[o + 2] = col[2] * limb;
        d[o + 3] = edgeA * 255;
      }
    }
    tctx!.putImageData(img, 0, 0);
  }

  // Camera: the sheet covers the frame, becomes a planet, pulls back
  // through near orbit, and recedes to a speck. Piecewise, smooth, and a
  // pure function of u — the return journey is exactly the reverse.
  const radiusFor = (u: number, m: number, diag: number): number => {
    if (u <= 0.35) return lerp(0.62 * diag, 0.335 * m, smoothstep(0, 0.35, u));
    if (u <= 0.72) return lerp(0.335 * m, 0.105 * m, smoothstep(0.35, 0.72, u));
    return lerp(0.105 * m, 2.2, smoothstep(0.72, 0.985, u));
  };

  function renderFrame(ctx: CanvasRenderingContext2D, w: number, h: number, u: number): void {
    const m = Math.min(w, h);
    const diag = Math.hypot(w, h);
    const c = smoothstep(0, 0.35, u);
    const R = radiusFor(u, m, diag);
    const cx = w / 2;
    const cy = h / 2 + smoothstep(0.72, 1, u) * 0.16 * h;

    // Sky.
    ctx.fillStyle = rgba(NIGHT, 1);
    ctx.fillRect(0, 0, w, h);

    // Stars thicken as the sheet lets go of the frame.
    const sCount = Math.floor(stars.length * smoothstep(0.12, 0.9, u));
    const sAlpha = smoothstep(0.18, 0.75, u);
    for (let i = 0; i < sCount; i++) {
      const st = stars[i];
      const tw = 0.7 + 0.3 * Math.sin(st.ph + u * 7);
      ctx.fillStyle = rgba(st.warm ? CANDLE : PAPER, sAlpha * tw * 0.85);
      ctx.fillRect(st.x * w, st.y * h, st.r, st.r);
    }

    // A faint milky band, late.
    const band = smoothstep(0.55, 0.95, u);
    if (band > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.translate(cx, h / 2);
      ctx.rotate(-0.5);
      const g = ctx.createLinearGradient(0, -h * 0.28, 0, h * 0.28);
      g.addColorStop(0, rgba(PAPER, 0));
      g.addColorStop(0.5, rgba(PAPER, 0.06 * band));
      g.addColorStop(1, rgba(PAPER, 0));
      ctx.fillStyle = g;
      ctx.fillRect(-diag, -h * 0.28, diag * 2, h * 0.56);
      ctx.restore();
    }

    // Atmosphere: a breath of pale sea around the sphere.
    const atm = c * clamp01((R - 6) / 30);
    if (atm > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      blitGlow(ctx, atmosphereSprite, cx, cy, R * 1.22, atm);
      ctx.restore();
    }

    // The planet (or the still-curling sheet).
    renderGlobe(u);
    ctx.drawImage(tex, cx - R, cy - R, R * 2, R * 2);

    // Thin atmosphere rim line.
    if (c > 0.6 && R > 8) {
      ctx.strokeStyle = rgba([150, 180, 184], 0.3 * atm);
      ctx.lineWidth = Math.max(1, R * 0.02);
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.995, 0, TAU);
      ctx.stroke();
    }

    // Aurora whisper over the pole, flickering deterministically with u.
    const aur = smoothstep(0.32, 0.45, u) * (1 - smoothstep(0.68, 0.8, u));
    if (aur > 0 && R > 12) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let k = 0; k < 3; k++) {
        const flick = 0.6 + 0.4 * Math.sin(u * 23 + k * 2.1);
        ctx.strokeStyle = rgba(AURORA, 0.09 * aur * flick);
        ctx.lineWidth = R * 0.05 * (1 + k * 0.4);
        ctx.beginPath();
        ctx.arc(cx, cy + R * 0.4, R * (1.03 + k * 0.06), -Math.PI * 0.72, -Math.PI * 0.28);
        ctx.stroke();
      }
      ctx.restore();
    }

    // One satellite glint arcing past in near orbit.
    if (u > 0.4 && u < 0.6 && R > 10) {
      const pr = (u - 0.4) / 0.2;
      const fade = Math.sin(pr * Math.PI);
      for (let q = 3; q >= 0; q--) {
        const ang = -0.8 + Math.max(0, pr - q * 0.02) * 2.6;
        const sx2 = cx + Math.cos(ang) * R * 1.45;
        const sy2 = cy + Math.sin(ang) * R * 0.52 - R * 0.1;
        const a = fade * (q === 0 ? 0.9 : 0.22 / q);
        ctx.fillStyle = rgba(q === 0 ? PAPER : CANDLE, a);
        ctx.beginPath();
        ctx.arc(sx2, sy2, q === 0 ? 1.5 : 1, 0, TAU);
        ctx.fill();
      }
    }

    // A quiet vignette holds the frame together.
    vignette(ctx, w, h, cx);
  }

  return { renderFrame };
}


// ——— Sprites: gradients built once, never per frame ————————————————
// A radial gradient is expensive to construct and the films run at 60fps
// through the whole passage. Every soft glow here is painted ONCE into a
// small offscreen canvas and then blitted, so a frame costs draws, not
// gradient objects. (The /stars room's per-frame gradients are the named
// bottleneck this avoids.)

type SpriteStop = readonly [offset: number, color: RGB, alpha: number];

/**
 * A radial ramp rasterised ONCE into an offscreen canvas. Every soft circle
 * in every film comes through here — glows, the atmosphere ring, the frame's
 * vignette — so the whole passage host constructs exactly one gradient per
 * distinct look, at build time, and a frame costs blits instead.
 */
function makeRadialSprite(stops: readonly SpriteStop[], px = 128): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = px;
  c.height = px;
  const g = c.getContext("2d");
  if (!g) return null;
  const grad = g.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
  for (const [offset, color, alpha] of stops) {
    grad.addColorStop(Math.max(0, Math.min(1, offset)), rgba(color, alpha));
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, px, px);
  return c;
}

function makeGlowSprite(inner: RGB, outer: RGB, mid: number): HTMLCanvasElement | null {
  return makeRadialSprite([
    [0, inner, 1],
    [0.5, mix(inner, outer, 0.5), mid],
    [1, outer, 0],
  ]);
}

function blitGlow(
  ctx: CanvasRenderingContext2D,
  sprite: HTMLCanvasElement | null,
  cx: number,
  cy: number,
  r: number,
  alpha: number,
): void {
  if (!sprite || r <= 0 || alpha <= 0.004) return;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(sprite, cx - r, cy - r, r * 2, r * 2);
  ctx.globalAlpha = prev;
}

/**
 * The frame's vignette. Radially symmetric, so one sprite blitted over the
 * frame is the same picture the per-frame gradient drew — and it survives a
 * resize without rebuilding anything.
 */
function makeVignette(): (ctx: CanvasRenderingContext2D, w: number, h: number, cx?: number) => void {
  const sprite = makeRadialSprite([
    [0, NIGHT, 0],
    [0.72, NIGHT, 0],
    [1, NIGHT, 0.35],
  ], 256);
  return (ctx, w, h, cx) => {
    if (!sprite) return;
    const r = Math.hypot(w, h) * 0.62;
    blitGlow(ctx, sprite, cx ?? w / 2, h / 2, r, 1);
  };
}

// ——— The arm film (stars ↔ galaxy) ———————————————————————————————————
//
// One scene function of u ∈ [0, 1]:
//   u = 0    the stellar vault — scattered stars filling the frame
//   u ≈ 0.55 the stars have streamed into an arm seen edge-on: a milky
//            band with a dust lane, planetfall's cousin — armfall
//   u = 1    the disc has tilted open and the same stars are a spiral
// The disc points are the SAME galaxy the room builds — one seed
// (GalaxyArms' 0xa2135), the same buildStars, the same wave — subsampled
// so the passage stays a film, not a simulation.

const GALAXY_PASSAGE_SEED = 0xa2135; // keep in lockstep with GalaxyArms

let bulgeSpriteCache: HTMLCanvasElement | null | undefined;
/** Old gold at the heart of the disc — one sprite, both films, built once. */
const bulgeSprite = {
  get canvas(): HTMLCanvasElement | null {
    if (bulgeSpriteCache === undefined) {
      bulgeSpriteCache = makeGlowSprite(mix(PAPER, [231, 172, 82] as RGB, 0.5), CANDLE, 0.42);
    }
    return bulgeSpriteCache;
  },
};
const ARM_FILM_STARS = 2200;

type DiscPoint = { x: number; y: number; z: number; crowd: number; warm: number; size: number };

function buildDiscPoints(): DiscPoint[] {
  const field = buildStars(GALAXY_PASSAGE_SEED, 15000);
  const k = waveNumber(PITCH_DEFAULT);
  const shift = Math.atan2(k, 1);
  const params = { patternPhase: 0.8, pitch: PITCH_DEFAULT, amp: 1, bar: 0.25 };
  const step = Math.max(1, Math.floor(field.count / ARM_FILM_STARS));
  const out: DiscPoint[] = [];
  for (let i = 0; i < field.count && out.length < ARM_FILM_STARS; i += step) {
    const st = starState(field.r[i], field.theta[i], 0, params);
    const crowd = 0.5 + 0.5 * Math.cos(st.chi - shift);
    out.push({
      x: st.x,
      y: st.y,
      z: field.z[i],
      crowd,
      warm: field.hue[i],
      size: 0.5 + field.size[i],
    });
  }
  return out;
}

function drawSpiral(
  ctx: CanvasRenderingContext2D,
  pts: DiscPoint[],
  cx: number,
  cy: number,
  scale: number,
  incl: number,
  spin: number,
  alpha: number,
  young: number,
): void {
  const ci = Math.cos(incl);
  const cs = Math.cos(spin);
  const sn = Math.sin(spin);
  for (const p of pts) {
    const x = p.x * cs - p.y * sn;
    const y = p.x * sn + p.y * cs;
    const sx = cx + x * scale;
    const sy = cy + (y * ci + p.z * Math.sin(incl)) * scale;
    const bright = alpha * (0.3 + 0.55 * p.size) * (0.55 + 0.9 * p.crowd * young);
    const cold = p.crowd > 0.72 && p.warm < 0.6;
    ctx.fillStyle = rgba(cold ? [150, 180, 250] : mix(PAPER, CANDLE, p.warm * 0.5), clamp01(bright));
    const r = Math.max(0.6, (0.6 + p.size * 0.9) * Math.min(1.6, scale / 260));
    ctx.fillRect(sx - r / 2, sy - r / 2, r, r);
  }
  // the bulge: old gold at the centre of any inclination
  blitGlow(ctx, bulgeSprite.canvas, cx, cy, Math.max(6, scale * 0.16), 0.5 * alpha);
}

function makeArmFilm(): Film {
  const pts = buildDiscPoints();
  const vignette = makeVignette();
  // Every disc point gets a scatter position — where it stands in the
  // vault before the stream begins. Deterministic, one for one.
  const rng = seededRandom(GALAXY_PASSAGE_SEED ^ 0x517a);
  const scatter = pts.map(() => ({
    x: rng(),
    y: rng(),
    tw: rng() * TAU,
    lag: rng() * 0.22,
  }));
  const halo: Array<{ x: number; y: number; r: number; ph: number }> = [];
  for (let i = 0; i < 240; i++) {
    halo.push({ x: rng(), y: rng(), r: 0.4 + rng() * 1.2, ph: rng() * TAU });
  }

  function renderFrame(ctx: CanvasRenderingContext2D, w: number, h: number, u: number): void {
    const m = Math.min(w, h);
    ctx.fillStyle = rgba(NIGHT, 1);
    ctx.fillRect(0, 0, w, h);

    // the vault behind everything — it thins as the stream leaves it
    const vaultA = 1 - smoothstep(0.35, 0.8, u);
    for (const s of halo) {
      const tw = 0.6 + 0.4 * Math.sin(s.ph + u * 9);
      ctx.fillStyle = rgba(PAPER, 0.5 * vaultA * tw);
      ctx.fillRect(s.x * w, s.y * h, s.r, s.r);
    }

    const cx = w / 2;
    const cy = h / 2;
    // the disc's frame: edge-on through the middle of the film, open by the end
    const incl = lerp(1.53, 0.6, smoothstep(0.45, 0.95, u));
    const spin = 0.35 + u * 0.3;
    const scale = m * lerp(0.75, 0.42, smoothstep(0.5, 0.95, u));
    const stream = smoothstep(0.06, 0.55, u);
    const young = smoothstep(0.5, 0.9, u);

    // the milky band the stream is becoming — drawn under the stars
    const bandA = smoothstep(0.25, 0.55, u) * (1 - smoothstep(0.75, 0.98, u) * 0.6);
    if (bandA > 0.01) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(spin * 0.4 - 0.18);
      const g = ctx.createLinearGradient(0, -m * 0.16, 0, m * 0.16);
      g.addColorStop(0, rgba(PAPER, 0));
      g.addColorStop(0.42, rgba(mix(PAPER, CANDLE, 0.25), 0.16 * bandA));
      g.addColorStop(0.5, rgba(INK, 0.5 * bandA * (1 - young)));
      g.addColorStop(0.58, rgba(mix(PAPER, CANDLE, 0.35), 0.16 * bandA));
      g.addColorStop(1, rgba(PAPER, 0));
      ctx.fillStyle = g;
      ctx.fillRect(-w, -m * 0.16, w * 2, m * 0.32);
      ctx.restore();
    }

    // the stars themselves: vault position → their seat in the disc
    const ci = Math.cos(incl);
    const cs = Math.cos(spin);
    const sn = Math.sin(spin);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const sc = scatter[i];
      const x = p.x * cs - p.y * sn;
      const y = p.x * sn + p.y * cs;
      const dx = cx + x * scale;
      const dy = cy + (y * ci + p.z * Math.sin(incl)) * scale;
      const tt = clamp01((stream - sc.lag) / (1 - sc.lag));
      const e = easeInOut(tt);
      const sx = lerp(sc.x * w, dx, e);
      const sy = lerp(sc.y * h, dy, e);
      const tw = 0.7 + 0.3 * Math.sin(sc.tw + u * 7);
      const bright = (0.35 + 0.5 * p.size) * tw * (0.5 + 0.5 * e) * (0.6 + 0.9 * p.crowd * young);
      const cold = p.crowd > 0.72 && p.warm < 0.6 && young > 0.2;
      ctx.fillStyle = rgba(
        cold ? [150, 180, 250] : mix(PAPER, CANDLE, p.warm * 0.45),
        clamp01(bright),
      );
      const r = Math.max(0.7, 1.5 * p.size * (0.6 + 0.4 * e));
      ctx.fillRect(sx - r / 2, sy - r / 2, r, r);
    }

    // once the disc opens, the bulge stands where all roads led
    const bulgeA = smoothstep(0.55, 0.9, u);
    blitGlow(ctx, bulgeSprite.canvas, cx, cy, scale * 0.16, 0.5 * bulgeA);

    // a quiet vignette holds the frame together
    vignette(ctx, w, h);
  }

  return { renderFrame };
}

// ——— The node film (galaxy ↔ space) ——————————————————————————————————
//
//   u = 0    the spiral fills the frame, inclined, turning
//   u ≈ 0.6  it has shrunk to a bright grain drifting toward its seat
//   u = 1    it is one luminous node of the web between galaxies
// The web is seeded and still: knots, filaments to near neighbours, and
// faint other-galaxies that were always there once the frame is wide
// enough to hold them.

function makeNodeFilm(): Film {
  const pts = buildDiscPoints();
  const vignette = makeVignette();
  const warmKnotSprite = makeGlowSprite(CANDLE, CANDLE, 0.32);
  const coolKnotSprite = makeGlowSprite(PAPER, PAPER, 0.28);
  const nodeSprite = makeGlowSprite(PAPER, CANDLE, 0.5);
  const rng = seededRandom(GALAXY_PASSAGE_SEED ^ 0x0de);
  // the web, in screen fractions; our galaxy's seat is the knot nearest centre
  const knots: Array<{ x: number; y: number; m: number }> = [];
  for (let i = 0; i < 26; i++) {
    knots.push({ x: 0.08 + rng() * 0.84, y: 0.08 + rng() * 0.84, m: 0.4 + rng() * 1 });
  }
  let seat = 0;
  let seatD = 1e9;
  for (let i = 0; i < knots.length; i++) {
    const d = (knots[i].x - 0.5) ** 2 + (knots[i].y - 0.52) ** 2;
    if (d < seatD) {
      seatD = d;
      seat = i;
    }
  }
  const links: Array<[number, number]> = [];
  for (let i = 0; i < knots.length; i++) {
    const near: Array<{ j: number; d: number }> = [];
    for (let j = 0; j < knots.length; j++) {
      if (j === i) continue;
      near.push({ j, d: (knots[j].x - knots[i].x) ** 2 + (knots[j].y - knots[i].y) ** 2 });
    }
    near.sort((a, b) => a.d - b.d);
    for (let n = 0; n < 2; n++) {
      const a = Math.min(i, near[n].j);
      const b = Math.max(i, near[n].j);
      if (!links.some(([p, q]) => p === a && q === b)) links.push([a, b]);
    }
  }

  function renderFrame(ctx: CanvasRenderingContext2D, w: number, h: number, u: number): void {
    const m = Math.min(w, h);
    ctx.fillStyle = rgba(NIGHT, 1);
    ctx.fillRect(0, 0, w, h);

    const e = easeInOut(u);
    const seatX = knots[seat].x * w;
    const seatY = knots[seat].y * h;
    const cx = lerp(w / 2, seatX, smoothstep(0.25, 0.85, u));
    const cy = lerp(h / 2, seatY, smoothstep(0.25, 0.85, u));
    // the whole journey is one retreat: the disc's scale falls two orders
    const scale = m * 0.62 * Math.pow(0.055, e);

    // the web arrives only once the frame is wide enough to mean it
    const webA = smoothstep(0.42, 0.85, u);
    if (webA > 0.01) {
      ctx.lineWidth = 1;
      for (const [a, b] of links) {
        ctx.strokeStyle = rgba([140, 176, 206], 0.3 * webA);
        ctx.beginPath();
        ctx.moveTo(knots[a].x * w, knots[a].y * h);
        ctx.lineTo(knots[b].x * w, knots[b].y * h);
        ctx.stroke();
      }
      for (let i = 0; i < knots.length; i++) {
        const kn = knots[i];
        const warm = i % 5 === 0;
        blitGlow(
          ctx,
          warm ? warmKnotSprite : coolKnotSprite,
          kn.x * w,
          kn.y * h,
          5 + kn.m * 9,
          (warm ? 0.4 : 0.3) * webA,
        );
      }
    }

    // the spiral, at whatever size the retreat has left it
    if (scale > 2.2) {
      drawSpiral(ctx, pts, cx, cy, scale, 0.62, 0.35 + u * 1.1, 1 - 0.25 * webA, 1);
    } else {
      // small enough to be a node: one luminous grain among the others
      blitGlow(ctx, nodeSprite, cx, cy, 10, 0.95);
    }

    vignette(ctx, w, h);
  }

  return { renderFrame };
}

// ——— The forged-world films (earth ↔ planets, planets ↔ solar) ————————
//
// Both films borrow the /planets decoder itself: every body on screen is a
// point in the same 12-dim latent the forge room sculpts — the earth of the
// beads film is simply a hand-chosen latent (sea-heavy, iced, clouded), so
// the container of one band and the material of the next are literally the
// same object under the same map.

/** The earth as a point in the forge's latent space. */
const EARTH_LATENT = [0.62, 0.66, 0.86, 0.42, 0.08, 0.55, 0.38, 0.32, 0.6, 0.2, 0.28, 0.62];

/** The supporting cast — the neighbourhood the globe joins. */
function castWorlds(seed: number, n: number): World[] {
  const out: World[] = [];
  for (let i = 0; i < n; i++) out.push(worldFromSeed(forgeHash(seed, i + 1)));
  return out;
}

/**
 * A soft radial falloff built from stacked translucent discs. Twelve fills
 * beat one `createRadialGradient` per frame — the gradient object is
 * allocated and rasterized every call, which is exactly the debt
 * `scripts/test-room-paint.mjs` ratchets down.
 */
function haloRings(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rInner: number,
  rOuter: number,
  col: RGB,
  peak: number,
): void {
  if (peak <= 0.002 || rOuter <= rInner) return;
  const steps = 12;
  ctx.fillStyle = rgba(col, peak / steps);
  for (let i = steps; i >= 1; i--) {
    const r = rInner + ((rOuter - rInner) * i) / steps;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
}

/** The frame's quiet darkening, from the shared hoisted sprite. */
const forgeVignette = makeVignette();

/**
 * A small painted world: lit disc, sea/land tint, terminator, optional
 * ring — cheap enough to draw a dozen per frame at bead size.
 */
function drawBead(
  ctx: CanvasRenderingContext2D,
  w: World,
  x: number,
  y: number,
  r: number,
  alpha: number,
): void {
  if (alpha <= 0 || r <= 0.5) return;
  const col = worldColors(w);
  const base = mix(col.landHi, col.seaShallow, w.ocean * 0.8);
  ctx.save();
  ctx.globalAlpha = alpha;
  if (w.ring > RING_MIN) {
    ctx.strokeStyle = rgba(col.ringCol, 0.55);
    ctx.lineWidth = Math.max(0.7, r * 0.16);
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.7, r * 0.55, -w.tiltRad * 0.8, Math.PI, TAU);
    ctx.stroke();
  }
  // Lit disc, then the night side as one offset disc clipped to it — the
  // /planets shader's own construction, and no per-frame gradient (the paint
  // ledger: scripts/test-room-paint.mjs).
  ctx.fillStyle = rgba(mix(base, PAPER, 0.18), 1);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.clip();
  ctx.fillStyle = rgba(mix(base, NIGHT, 0.8), 0.85);
  ctx.beginPath();
  ctx.arc(x + r * 0.62, y + r * 0.5, r, 0, TAU);
  ctx.fill();
  ctx.restore();
  if (w.atmoDepth > 0.1) {
    ctx.strokeStyle = rgba(col.atmo, 0.3 * w.atmoDepth);
    ctx.lineWidth = Math.max(0.6, r * 0.08);
    ctx.beginPath();
    ctx.arc(x, y, r * 1.06, 0, TAU);
    ctx.stroke();
  }
  if (w.ring > RING_MIN) {
    ctx.strokeStyle = rgba(col.ringCol, 0.8);
    ctx.lineWidth = Math.max(0.7, r * 0.16);
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.7, r * 0.55, -w.tiltRad * 0.8, 0, Math.PI);
    ctx.stroke();
  }
  ctx.restore();
}

/** Dust — the forge room's visible reserve, thickening as it nears. */
function drawForgeDust(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: number,
  alpha: number,
  drift: number,
): void {
  if (alpha <= 0) return;
  const rng = seededRandom(seed);
  for (let i = 0; i < 130; i++) {
    const x = (rng() + drift * 0.02 * rng()) % 1;
    const y = rng();
    const dr = rng();
    const tw = 0.55 + 0.45 * Math.sin(drift * (0.5 + dr) * 6 + dr * 9);
    ctx.fillStyle = rgba(mix(PAPER, CANDLE, dr * 0.4), alpha * tw * (0.2 + dr * 0.5));
    ctx.fillRect(x * w, y * h, dr > 0.85 ? 1.6 : 1, dr > 0.85 ? 1.6 : 1);
  }
}

/**
 * The full-texture globe used at film scale: the same equirect trick as
 * the chart film, but painted from a forge-latent World.
 */
function makeGlobePainter(w: World, seed: number): ((
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  R: number,
  u: number,
) => void) | null {
  const nA = makeNoise2(seed ^ 0x9e3779b9);
  const nB = makeNoise2(seed ^ 0x85ebca6b);
  const nC = makeNoise2(seed ^ 0xc2b2ae35);
  const G = 144;
  const landF = new Float32Array(G * G);
  const cloudF = new Float32Array(G * G);
  for (let j = 0; j < G; j++) {
    const lat = (j / (G - 1) - 0.5) * Math.PI;
    for (let i = 0; i < G; i++) {
      const lon = (i / G) * TAU;
      const cx = Math.cos(lon);
      const sx = Math.sin(lon);
      landF[j * G + i] =
        0.55 * fbm(nA, cx * 1.7 + 9.2, lat * 1.9 + 7.7, 3) +
        0.45 * fbm(nB, sx * 1.7 + 3.1, lat * 1.9 + 21.4, 3);
      cloudF[j * G + i] = fbm(nC, cx * 2.2 + lat * 0.6 + 4.2, sx * 2.2 - lat * 0.9 + 8.8, 2);
    }
  }
  const sampleG = (F: Float32Array, lon: number, lat: number): number => {
    let li = lon / TAU;
    li -= Math.floor(li);
    const i = Math.min(G - 1, (li * G) | 0);
    const j = Math.min(G - 1, (clamp01(lat / Math.PI + 0.5) * G) | 0);
    return F[j * G + i];
  };
  let tex: HTMLCanvasElement;
  let tctx: CanvasRenderingContext2D | null;
  let img: ImageData;
  const TEXG = 160;
  try {
    tex = document.createElement("canvas");
    tex.width = TEXG;
    tex.height = TEXG;
    tctx = tex.getContext("2d");
    if (!tctx) return null;
    img = tctx.createImageData(TEXG, TEXG);
  } catch {
    return null;
  }
  const col = worldColors(w);
  const seaTh = 0.34 + w.ocean * 0.33;
  const iceEdge = 1.5 - w.ice * 0.85;
  return (ctx, x, y, R, u) => {
    const spin = 0.7 + u * 1.9;
    const d = img.data;
    for (let j = 0; j < TEXG; j++) {
      const y0 = ((j + 0.5) / TEXG) * 2 - 1;
      for (let i = 0; i < TEXG; i++) {
        const x0 = ((i + 0.5) / TEXG) * 2 - 1;
        const o = (j * TEXG + i) * 4;
        const r2 = x0 * x0 + y0 * y0;
        if (r2 > 1.04) {
          d[o + 3] = 0;
          continue;
        }
        const edgeA = clamp01((1.02 - r2) / 0.06);
        const z0 = Math.sqrt(Math.max(0.0001, 1 - Math.min(1, r2)));
        const lon = spin + Math.asin(Math.max(-0.9995, Math.min(0.9995, x0)));
        const lat = Math.asin(Math.max(-0.9995, Math.min(0.9995, y0))) * 0.97;
        const landness = sampleG(landF, lon, lat) - seaTh;
        let c: RGB;
        if (landness > 0) c = mix(col.landLo, col.landHi, clamp01(landness * 3.4));
        else c = mix(col.seaShallow, col.seaDeep, 0.25 + clamp01(-landness * 5) * 0.75);
        const ice = smoothstep(iceEdge, iceEdge + 0.22, Math.abs(lat));
        if (ice > 0) c = mix(c, col.ice, ice * 0.92);
        const cl = smoothstep(0.62, 0.8, sampleG(cloudF, lon + u * 1.2, lat));
        if (cl > 0) c = mix(c, PAPER, cl * 0.5 * w.cloud * 1.4);
        const dayS = -0.5 * x0 - 0.22 * y0 + 0.84 * z0;
        const day = smoothstep(-0.06, 0.32, dayS);
        c = mix(mix(c, NIGHT, 0.84), c, day);
        const shade = 0.42 + 0.58 * z0;
        d[o] = c[0] * shade;
        d[o + 1] = c[1] * shade;
        d[o + 2] = c[2] * shade;
        d[o + 3] = edgeA * 255;
      }
    }
    tctx!.putImageData(img, 0, 0);
    ctx.drawImage(tex, x - R, y - R, R * 2, R * 2);
  };
}

/**
 * earth ↔ planets — "beads": u = 0 the globe fills the frame (the earth,
 * decoded from a fixed forge latent); as u rises it shrinks to one bead
 * among the forged worlds, the dust reserve shimmering in around it.
 */
function makeBeadsFilm(seed: number): Film | null {
  const earth = worldFromLatent(EARTH_LATENT, seed ^ 0xea);
  const paintGlobe = makeGlobePainter(earth, seed ^ 0xea);
  if (!paintGlobe) return null;
  const cast = castWorlds(seed, 8);
  const rng = seededRandom(seed ^ 0xbead);
  const anchors = cast.map(() => ({
    x: 0.14 + rng() * 0.72,
    y: 0.16 + rng() * 0.66,
  }));
  const renderFrame = (ctx: CanvasRenderingContext2D, w: number, h: number, u: number): void => {
    const m = Math.min(w, h);
    ctx.fillStyle = rgba(NIGHT, 1);
    ctx.fillRect(0, 0, w, h);
    // The neighbourhood's dust arrives as the globe lets go of the frame.
    drawForgeDust(ctx, w, h, seed ^ 0xd057, smoothstep(0.25, 0.75, u) * 0.55, u * 3);
    // The other worlds condense in, one by one.
    const beadIn = smoothstep(0.35, 0.85, u);
    cast.forEach((cw, i) => {
      const a = clamp01(beadIn * cast.length - i * 0.55);
      drawBead(ctx, cw, anchors[i].x * w, anchors[i].y * h, m * 0.05 * cw.radius01 * 1.6, a * 0.95);
    });
    // The globe: from filling the frame to one bead among them.
    const R = lerp(0.62 * m, 0.055 * m, easeInOut(smoothstep(0.05, 0.9, u)));
    const gx = lerp(0.5, 0.36, smoothstep(0.4, 0.95, u)) * w;
    const gy = lerp(0.46, 0.4, smoothstep(0.4, 0.95, u)) * h;
    // Atmosphere breath around it, fading as it becomes a bead.
    const atmA = 0.25 * (1 - u * 0.6);
    haloRings(ctx, gx, gy, R * 0.98, R * 1.3, [120, 160, 168], atmA);
    paintGlobe(ctx, gx, gy, R, u);
    // A quiet vignette holds the frame together — stacked rings, not a
    // per-frame gradient (the paint ledger: scripts/test-room-paint.mjs).
    forgeVignette(ctx, w, h);
  };
  return { renderFrame };
}

/**
 * planets ↔ solar — "orbitfall": u = 0 the focused world hangs free among
 * its neighbours; as u rises it falls onto its orbit line, the others
 * settle onto theirs, and the sun ignites at centre.
 */
function makeOrbitfallFilm(seed: number): Film {
  const focusW = worldFromSeed(forgeHash(seed, 99));
  const cast = castWorlds(seed ^ 0x501a, 5);
  const rng = seededRandom(seed ^ 0x0f11);
  const free = cast.map(() => ({
    x: 0.16 + rng() * 0.68,
    y: 0.14 + rng() * 0.6,
    th: rng() * TAU,
  }));
  const focusTh = 0.6; // where on its orbit the focused world lands
  const renderFrame = (ctx: CanvasRenderingContext2D, w: number, h: number, u: number): void => {
    const m = Math.min(w, h);
    const cx = w / 2;
    const cy = h / 2;
    ctx.fillStyle = rgba(NIGHT, 1);
    ctx.fillRect(0, 0, w, h);
    // The dust thins as the system orders itself.
    drawForgeDust(ctx, w, h, seed ^ 0xd057, (1 - smoothstep(0.2, 0.7, u)) * 0.5, u * 2);
    const settle = easeInOut(smoothstep(0.12, 0.78, u));
    const ignite = smoothstep(0.45, 0.85, u);
    // Orbit lines draw themselves in as the worlds find them.
    const orbitA = smoothstep(0.25, 0.7, u);
    const orbits = [0.14, 0.2, 0.27, 0.34, 0.41, 0.48];
    if (orbitA > 0) {
      ctx.strokeStyle = rgba(PAPER, 0.16 * orbitA);
      ctx.lineWidth = 1;
      for (const or of orbits) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, or * m * 1.35, or * m * 0.62, 0, 0, TAU);
        ctx.stroke();
      }
    }
    // The supporting worlds settle onto their rails.
    cast.forEach((cw, i) => {
      const or = orbits[i + 1];
      const th = free[i].th + u * 0.6;
      const ox = cx + Math.cos(th) * or * m * 1.35;
      const oy = cy + Math.sin(th) * or * m * 0.62;
      const x = lerp(free[i].x * w, ox, settle);
      const y = lerp(free[i].y * h, oy, settle);
      drawBead(ctx, cw, x, y, m * 0.045 * cw.radius01 * (1.5 - u * 0.5), 0.95);
    });
    // The sun ignites at centre — candle-gold, then white-hot core.
    if (ignite > 0) {
      const sunR = m * (0.02 + ignite * 0.05);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      haloRings(ctx, cx, cy, sunR * 0.6, sunR * 8, CANDLE, 0.2 * ignite);
      ctx.fillStyle = rgba(PAPER, 0.95 * ignite);
      ctx.beginPath();
      ctx.arc(cx, cy, sunR, 0, TAU);
      ctx.fill();
      ctx.restore();
    } else {
      // Before ignition, only a rumor of gathering light.
      haloRings(ctx, cx, cy, 0, m * 0.1, CANDLE, 0.04 * smoothstep(0.1, 0.45, u));
    }
    // The focused world falls onto its own orbit.
    const or = orbits[0] + 0.13;
    const th = focusTh + u * 0.4;
    const fx = lerp(0.5 * w, cx + Math.cos(th) * or * m * 1.35, settle);
    const fy = lerp(0.44 * h, cy + Math.sin(th) * or * m * 0.62, settle);
    const fR = lerp(m * 0.16, m * 0.05, easeInOut(smoothstep(0.08, 0.85, u)));
    drawBead(ctx, focusW, fx, fy, fR, 1);
    forgeVignette(ctx, w, h);
  };
  return { renderFrame };
}

/**
 * A radial falloff as a sprite, built once from arithmetic rather than from a
 * gradient object per frame — the paint bar in scripts/test-room-paint.mjs is
 * exactly this rule, and a glow that is drawImage'd scales for free.
 */
function makeSoftDisc(size = 96, power = 2.2): HTMLCanvasElement | null {
  try {
    const el = document.createElement("canvas");
    el.width = size;
    el.height = size;
    const c = el.getContext("2d");
    if (!c) return null;
    const img = c.createImageData(size, size);
    const d = img.data;
    const r0 = size / 2;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const dx = (i + 0.5 - r0) / r0;
        const dy = (j + 0.5 - r0) / r0;
        const r = Math.sqrt(dx * dx + dy * dy);
        const a = r >= 1 ? 0 : Math.pow(1 - r, power);
        const o = (j * size + i) * 4;
        d[o] = 255;
        d[o + 1] = 255;
        d[o + 2] = 255;
        d[o + 3] = Math.round(a * 255);
      }
    }
    c.putImageData(img, 0, 0);
    return el;
  } catch {
    return null;
  }
}

// ——— The peak → air film ————————————————————————————————————————————
//
// One scene function of u ∈ [0, 1]:
//   u = 0    standing at the summit — folded dark ridges, the fog sea
//   u ≈ 0.5  the ranges sink and shrink out of the frame
//   u = 1    inside the column: haze strata sliding at their own speeds
//            (the shear arriving before the room does), the blue thinning
//            toward the first stars
// The sky is not painted at any point: each gradient stop is the
// closed-form single scatter from src/lib/aircolumn.ts at the altitude
// the camera has reached.

const PEAKAIR_SUN_ELEV = 0.5;

function makePeakAirFilm(seed: number): Film {
  const n = makeNoise2(seed ^ 0x1a2b3c4d);
  const RIDGE_STOPS = 72;
  const ridges: Float32Array[] = [0, 1, 2].map((r) => {
    const arr = new Float32Array(RIDGE_STOPS);
    for (let i = 0; i < RIDGE_STOPS; i++) {
      const x = i / (RIDGE_STOPS - 1);
      const v = fbm(n, x * (3 + r * 2.2) + r * 17.3, r * 9.1, 4);
      arr[i] = 1 - Math.abs(2 * v - 1); // folded — an arête, not a hill
    }
    return arr;
  });
  const rng = seededRandom(seed ^ 0x2f9d);
  const strata: Array<{ y: number; speed: number; len: number; ph: number }> = [];
  for (let i = 0; i < 7; i++) {
    strata.push({
      y: 0.16 + (i / 7) * 0.66 + rng() * 0.04,
      speed: 0.22 + rng() * 0.9, // every layer its own wind — the shear
      len: 0.2 + rng() * 0.22,
      ph: rng(),
    });
  }
  const stars: Array<{ x: number; y: number; r: number }> = [];
  for (let i = 0; i < 120; i++) {
    stars.push({ x: rng(), y: rng() * 0.55, r: 0.5 + rng() * 1.1 });
  }

  function renderFrame(ctx: CanvasRenderingContext2D, w: number, h: number, u: number): void {
    const climb = smoothstep(0.02, 0.9, u);
    const zEye = 2.5 + climb * 26; // km — the summit let go of
    // the sky, read off the column at this altitude
    const g = ctx.createLinearGradient(0, 0, 0, h);
    for (let j = 0; j <= 6; j++) {
      const dirY = lerp(0.55, -0.12, j / 6);
      const s = skyColor(zEye, dirY, 0.35, PEAKAIR_SUN_ELEV).rgb;
      g.addColorStop(j / 6, rgba([
        tonemap(s[0], 1.35) ** (1 / 2.2) * 255,
        tonemap(s[1], 1.35) ** (1 / 2.2) * 255,
        tonemap(s[2], 1.35) ** (1 / 2.2) * 255,
      ] as RGB, 1));
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // stars, as the blue thins
    const starA = smoothstep(0.68, 0.98, u);
    if (starA > 0) {
      for (const st of stars) {
        ctx.fillStyle = rgba(PAPER, starA * 0.8 * (1 - st.y * 1.4));
        ctx.fillRect(st.x * w, st.y * h, st.r, st.r);
      }
    }

    // haze strata slide in laterally, each at its own speed
    for (let i = 0; i < strata.length; i++) {
      const sBand = strata[i];
      const a = smoothstep(0.3 + i * 0.04, 0.62 + i * 0.04, u) * 0.34;
      if (a <= 0) continue;
      const y = sBand.y * h;
      for (let k = 0; k < 3; k++) {
        const cx = ((sBand.ph + k / 3 + u * sBand.speed) % 1.3) - 0.15;
        const len = sBand.len * w * (1 + sBand.speed);
        ctx.fillStyle = rgba([228, 234, 244], a * (0.6 + 0.4 * Math.sin(sBand.ph * 7 + k)));
        ctx.beginPath();
        ctx.ellipse(cx * w, y, len / 2, Math.max(2.5, h * 0.011), 0, 0, TAU);
        ctx.fill();
      }
    }

    // the fog sea, left below
    const sink = smoothstep(0.06, 0.72, u);
    const fogY = h * 0.62 + sink * h * 0.85;
    if (fogY < h + 40) {
      const fg = ctx.createLinearGradient(0, fogY - h * 0.08, 0, fogY + h * 0.1);
      fg.addColorStop(0, rgba([214, 220, 230], 0));
      fg.addColorStop(0.6, rgba([214, 220, 230], 0.55 * (1 - sink)));
      fg.addColorStop(1, rgba([214, 220, 230], 0.75 * (1 - sink)));
      ctx.fillStyle = fg;
      ctx.fillRect(0, fogY - h * 0.08, w, h * 0.2);
    }

    // the ranges sink and shrink out of the frame — the summit drops away
    for (let r = 2; r >= 0; r--) {
      const rSink = smoothstep(0.04 + r * 0.07, 0.7 + r * 0.05, u);
      const scale = (1 - rSink) * (1 - rSink * 0.4);
      const baseY = h * (0.56 + r * 0.15) + rSink * h * 0.95;
      if (baseY > h + h * 0.3) continue;
      const amp = h * (0.14 + r * 0.09) * Math.max(0.05, scale);
      ctx.beginPath();
      ctx.moveTo(-2, h + 2);
      for (let i = 0; i < RIDGE_STOPS; i++) {
        const x = (i / (RIDGE_STOPS - 1)) * (w + 4) - 2;
        ctx.lineTo(x, baseY - ridges[r][i] * amp);
      }
      ctx.lineTo(w + 2, h + 2);
      ctx.closePath();
      const dark: RGB = r === 2 ? [16, 18, 24] : r === 1 ? [30, 34, 44] : [52, 58, 72];
      ctx.fillStyle = rgba(mix(dark, [150, 168, 192], (2 - r) * 0.14 + rSink * 0.2), 1);
      ctx.fill();
    }

  }

  return { renderFrame };
}

// ——— The air → atlas film ————————————————————————————————————————————
//
// One scene function of u ∈ [0, 1]:
//   u = 0    inside the column — pale veiled blue, strata about the camera
//   u ≈ 0.5  the haze banks fly past, each one nearer than the last
//   u ≈ 0.8  through the last bank — the bell — and the ground shows
//   u = 1    the hand-drawn map fills the frame: parchment, ink coasts,
//            the graticule sharpening as the air gets out of the way
// The veil's departure is the transmittance rising as the slant column
// shrinks; the map is the same token-palette chart the atlas keeps.

function makeAirMapFilm(seed: number): Film | null {
  const n = makeNoise2(seed ^ 0x77aa1109);
  const rng = seededRandom(seed ^ 0x4c8d);

  // The chart, drawn once: parchment, kept-gold land, sea-ink water.
  const TEXM = 256;
  let map: HTMLCanvasElement;
  try {
    map = document.createElement("canvas");
    map.width = TEXM;
    map.height = TEXM;
    const mctx = map.getContext("2d");
    if (!mctx) return null;
    const img = mctx.createImageData(TEXM, TEXM);
    const d = img.data;
    const gridProx = (v: number): number => {
      const f = v - Math.floor(v);
      const dd = Math.min(f, 1 - f);
      return Math.max(0, 1 - dd / 0.06);
    };
    for (let j = 0; j < TEXM; j++) {
      for (let i = 0; i < TEXM; i++) {
        const x = i / TEXM;
        const y = j / TEXM;
        const o = (j * TEXM + i) * 4;
        const land = fbm(n, x * 3.1 + 7.7, y * 3.1 + 2.9, 4) - 0.52;
        let col: RGB;
        if (land > 0) {
          col = mix(PAPER2, KEPT, 0.14 + Math.min(0.6, land * 3.2));
        } else {
          col = mix(PAPER, SEA, 0.12 + Math.min(0.5, -land * 2.2));
        }
        const coast = 1 - Math.min(1, Math.abs(land) / 0.014);
        const grid = Math.max(gridProx(x * 9), gridProx(y * 9)) * 0.2;
        const inkA = Math.max(coast * 0.75, grid);
        if (inkA > 0) col = mix(col, INK, inkA);
        d[o] = col[0];
        d[o + 1] = col[1];
        d[o + 2] = col[2];
        d[o + 3] = 255;
      }
    }
    mctx.putImageData(img, 0, 0);
  } catch {
    return null;
  }

  const disc = makeSoftDisc(128, 2.6);
  // The u = 0 end of this film IS the air column, so it has to look like it:
  // strata at their own altitudes, each sliding at its own speed. Without
  // them the reverse crossing reads as map → white → cut.
  const strata: Array<{ y: number; speed: number; len: number; ph: number }> = [];
  for (let i = 0; i < 6; i++) {
    strata.push({
      y: 0.2 + (i / 6) * 0.62 + rng() * 0.04,
      speed: 0.2 + rng() * 0.85,
      len: 0.22 + rng() * 0.24,
      ph: rng(),
    });
  }
  const banks: Array<{ at: number; y: number; ph: number }> = [];
  for (let i = 0; i < 4; i++) {
    banks.push({ at: 0.18 + i * 0.17, y: 0.25 + rng() * 0.5, ph: rng() });
  }

  function renderFrame(ctx: CanvasRenderingContext2D, w: number, h: number, u: number): void {
    // the air around the camera, read off the column at ~16 km looking down
    const g = ctx.createLinearGradient(0, 0, 0, h);
    for (let j = 0; j <= 4; j++) {
      const dirY = lerp(0.25, -0.7, j / 4);
      const s = skyColor(16 - u * 9, dirY, 0.3, 0.62).rgb;
      g.addColorStop(j / 4, rgba([
        tonemap(s[0], 1.35) ** (1 / 2.2) * 255,
        tonemap(s[1], 1.35) ** (1 / 2.2) * 255,
        tonemap(s[2], 1.35) ** (1 / 2.2) * 255,
      ] as RGB, 1));
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // the ground resolving: the chart rises through the thinning air
    const mapA = smoothstep(0.3, 0.8, u);
    if (mapA > 0) {
      const scale = lerp(1.5, 1.02, smoothstep(0.2, 1, u));
      const mw = Math.max(w, h) * scale;
      ctx.globalAlpha = mapA;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(map, (w - mw) / 2, (h - mw) / 2, mw, mw);
      ctx.globalAlpha = 1;
      // the graticule sharpens last — ink after air
      const inkA = smoothstep(0.78, 0.98, u);
      if (inkA > 0) {
        ctx.strokeStyle = rgba(INK, inkA * 0.35);
        ctx.lineWidth = 1;
        for (let k = 1; k < 9; k++) {
          const p = (k / 9) * Math.max(w, h) - (Math.max(w, h) - Math.min(w, h)) / 2;
          ctx.beginPath();
          ctx.moveTo(0, (k / 9) * h);
          ctx.lineTo(w, (k / 9) * h);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(p, 0);
          ctx.lineTo(p, h);
          ctx.stroke();
        }
      }
    }

    // the strata of the column the camera is still inside, thinning as the
    // ground resolves — the same shear the room shows, seen edge on
    const strataA = (1 - smoothstep(0.06, 0.52, u)) * 0.4;
    if (strataA > 0.002) {
      for (let i = 0; i < strata.length; i++) {
        const sBand = strata[i];
        const y = sBand.y * h;
        for (let k = 0; k < 3; k++) {
          const cx = ((sBand.ph + k / 3 + (1 - u) * sBand.speed) % 1.3) - 0.15;
          const len = sBand.len * w * (1 + sBand.speed);
          ctx.fillStyle = rgba([230, 236, 245], strataA * (0.6 + 0.4 * Math.sin(sBand.ph * 7 + k)));
          ctx.beginPath();
          ctx.ellipse(cx * w, y, len / 2, Math.max(2.5, h * 0.012), 0, 0, TAU);
          ctx.fill();
        }
      }
    }

    // the veil: what the slant column still holds back
    const veilA = 0.62 * (1 - smoothstep(0.22, 0.82, u));
    if (veilA > 0) {
      ctx.fillStyle = rgba([225, 232, 242], veilA);
      ctx.fillRect(0, 0, w, h);
    }

    // the banks fly past, each nearer than the last — through the last haze
    if (disc) {
      for (const b of banks) {
        const p = (u - b.at) / 0.26;
        if (p <= 0 || p >= 1) continue;
        const a = Math.sin(p * Math.PI) * 0.55;
        const grow = lerp(0.5, 3.4, p * p);
        const y = b.y * h + (p - 0.5) * h * 0.7;
        const r = w * 0.42 * grow;
        const cx = (0.2 + b.ph * 0.6) * w;
        ctx.globalAlpha = a;
        ctx.drawImage(disc, cx - r, y - r, r * 2, r * 2);
        ctx.globalAlpha = 1;
      }
    }

  }

  return { renderFrame };
}

/** One place that knows which film an edge traverses. */

// ——— The sunfall (solar ↔ stars) ————————————————————————————————————
//
// One scene function of u ∈ [0, 1]:
//   u = 0    the solar system fills the frame — sun, orbits, moving worlds
//   u ≈ 0.5  the orbits have shrunk to a bright knot; the vault thickens
//   u = 1    deep night; the sun is one warm point among the stars, drifted
//            a little off centre to take its seat in the sky
// Outbound (solar → stars) plays u forward; the return is the same drawing
// reversed, so the descent re-condenses the system exactly. It is the
// orbitfall's next rung: that film ignites the sun, this one hands it to
// the vault.

const SUNFALL_SEED = 0x50a1f2d; // one sun, always yours

function makeSunfallFilm(): Film {
  const rng = seededRandom(SUNFALL_SEED ^ 0x2fd11e3);
  const vignette = makeVignette();
  const glow = makeGlowSprite(mix(PAPER, CANDLE, 0.35), CANDLE, 0.4);
  const stars: Array<{ x: number; y: number; r: number; ph: number; warm: boolean }> = [];
  for (let i = 0; i < 420; i++) {
    stars.push({ x: rng(), y: rng(), r: 0.5 + rng() * 1.3, ph: rng() * TAU, warm: rng() > 0.93 });
  }
  // A small fixed system for the film — five worlds, Kepler-timed so the
  // inner ones visibly run during the crossing.
  const cols: RGB[] = [
    mix(SEA, PAPER, 0.4),
    mix(KEPT, PAPER, 0.45),
    mix(CANDLE, PAPER, 0.3),
    mix(PAPER, SEA, 0.2),
    mix(AURORA, PAPER, 0.3),
  ];
  const worlds: Array<{ rad: number; ph: number; size: number; col: RGB; ecc: number }> = [];
  for (let i = 0; i < 5; i++) {
    worlds.push({
      rad: 0.2 + i * 0.19 + rng() * 0.04,
      ph: rng() * TAU,
      size: 2.2 + rng() * 2.4,
      col: cols[i],
      ecc: 0.94 - rng() * 0.12,
    });
  }

  const renderFrame = (ctx: CanvasRenderingContext2D, w: number, h: number, u: number): void => {
    const m = Math.min(w, h);
    const diag = Math.hypot(w, h);

    ctx.fillStyle = rgba(NIGHT, 1);
    ctx.fillRect(0, 0, w, h);

    // The vault thickens as the system lets go of the frame.
    const sCount = Math.floor(stars.length * smoothstep(0.18, 0.85, u));
    const sAlpha = smoothstep(0.22, 0.8, u);
    for (let i = 0; i < sCount; i++) {
      const st = stars[i];
      const tw = 0.7 + 0.3 * Math.sin(st.ph + u * 6);
      ctx.fillStyle = rgba(st.warm ? CANDLE : PAPER, sAlpha * tw * 0.85);
      ctx.fillRect(st.x * w, st.y * h, st.r, st.r);
    }
    // A faint milky band, late.
    const band = smoothstep(0.55, 0.95, u);
    if (band > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.translate(w / 2, h / 2);
      ctx.rotate(-0.5);
      ctx.fillStyle = rgba(PAPER, 0.05 * band);
      ctx.fillRect(-diag, -h * 0.1, diag * 2, h * 0.2);
      ctx.restore();
    }

    // The camera's retreat: an exponential shrink from full frame to a
    // point, and a slow drift as the sun takes its seat among the stars.
    const S = 0.62 * m * Math.exp(-5.1 * smoothstep(0.02, 0.95, u));
    const seat = smoothstep(0.55, 0.98, u);
    const cx = w / 2 + seat * 0.17 * w;
    const cy = h / 2 - seat * 0.13 * h;
    const squash = 0.66;
    const fade = 1 - smoothstep(0.32, 0.72, u); // orbits and worlds let go first

    if (fade > 0.01) {
      ctx.lineWidth = 1;
      for (const wd of worlds) {
        ctx.strokeStyle = rgba(PAPER, 0.11 * fade);
        ctx.beginPath();
        ctx.ellipse(cx, cy, S * wd.rad, S * wd.rad * squash * wd.ecc, 0.2, 0, TAU);
        ctx.stroke();
      }
      // The worlds keep moving as they go — Kepler runs during the crossing.
      for (const wd of worlds) {
        const ang = wd.ph + (u * 7.2) / Math.pow(wd.rad, 1.5);
        const px = cx + Math.cos(ang + 0.2) * S * wd.rad;
        const py = cy + Math.sin(ang + 0.2) * S * wd.rad * squash * wd.ecc;
        ctx.fillStyle = rgba(wd.col, 0.9 * fade);
        ctx.beginPath();
        ctx.arc(px, py, Math.max(0.4, ((wd.size * S) / (0.62 * m)) * 4 + 0.6), 0, TAU);
        ctx.fill();
      }
    }

    // The sun: a candle that never quite goes out — it becomes a star.
    const tw = 0.8 + 0.2 * Math.sin(u * 31 + 1.3);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    blitGlow(ctx, glow, cx, cy, Math.max(4, S * 0.24 + 6) * 2.2, 0.9 * tw);
    ctx.restore();
    ctx.fillStyle = rgba(mix(PAPER, CANDLE, 0.25), 0.95);
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1.3, S * 0.06 + 1.2), 0, TAU);
    ctx.fill();

    vignette(ctx, w, h);
  };

  return { renderFrame };
}

function makeFilmFor(spec: PassageSpec): Film | null {
  if (spec.film === "arm") return makeArmFilm();
  if (spec.film === "node") return makeNodeFilm();
  if (spec.film === "beads") return makeBeadsFilm(PASSAGE_SEED ^ 0x1a2b3c);
  if (spec.film === "orbitfall") return makeOrbitfallFilm(PASSAGE_SEED ^ 0x077e11);
  if (spec.film === "sunfall") return makeSunfallFilm();
  if (spec.film === "peakair") return makePeakAirFilm(PASSAGE_SEED ^ 0x0a7a11);
  if (spec.film === "airmap") return makeAirMapFilm(PASSAGE_SEED ^ 0x0a7a22);
  return makeFilm(PASSAGE_SEED);
}

// ——— The host and player ————————————————————————————————————————————

export default function TravelPassageHost() {
  const [active, setActive] = useState<ActivePassage | null>(null);
  useEffect(() => {
    hostCue = setActive;
    return () => {
      hostCue = null;
    };
  }, []);
  if (!active) return null;
  return (
    <PassagePlayer key={active.nonce} passage={active} onDone={() => setActive(null)} />
  );
}

const FADE_IN_MS = 180;
const FADE_OUT_MS = 340;

function PassagePlayer({
  passage,
  onDone,
}: {
  passage: ActivePassage;
  onDone: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const film = ctx ? makeFilmFor(passage.spec) : null;
    if (!canvas || !ctx || !film) {
      // No canvas — travel still happens, just without the film.
      try {
        passage.navigate();
      } catch {
        /* noop */
      }
      doneRef.current();
      return;
    }

    const { spec, sFrom, sTo, navigate } = passage;
    let reduce = false;
    try {
      reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      /* noop */
    }
    const dur = reduce ? spec.reducedMs : spec.durationMs;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = window.innerWidth;
    let h = window.innerHeight;

    const sizeCanvas = (el: HTMLCanvasElement, c2: CanvasRenderingContext2D) => {
      el.width = Math.max(1, Math.round(w * dpr));
      el.height = Math.max(1, Math.round(h * dpr));
      c2.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    canvas.style.width = "100vw";
    canvas.style.height = "100vh";
    sizeCanvas(canvas, ctx);

    // Reduced motion: three stills — map, globe, stars — cross-dissolved.
    // Order follows the direction of travel.
    const stillUs = spec.out ? [0.03, 0.52, 0.97] : [0.97, 0.52, 0.03];
    let stills: HTMLCanvasElement[] = [];
    const renderStills = () => {
      stills = stillUs.map((u) => {
        const el = document.createElement("canvas");
        const c2 = el.getContext("2d");
        if (c2) {
          el.width = Math.max(1, Math.round(w * dpr));
          el.height = Math.max(1, Math.round(h * dpr));
          c2.setTransform(dpr, 0, 0, dpr, 0, 0);
          film.renderFrame(c2, w, h, u);
        }
        return el;
      });
    };
    if (reduce) renderStills();

    let raf = 0;
    let t0 = performance.now();
    let outStart = 0; // when the tail fade began; 0 = film still playing
    let navFired = false;
    let bellRung = false;
    let detentFelt = false;
    let finished = false;

    const teardown = () => {
      if (finished) return;
      finished = true;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("pointerdown", skip, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onResize);
      try {
        setScaleRegister(sTo);
      } catch {
        /* noop */
      }
    };

    const finish = () => {
      if (finished) return;
      teardown();
      doneRef.current();
    };

    const fireNavigate = () => {
      if (navFired) return;
      navFired = true;
      try {
        navigate();
      } catch {
        /* noop */
      }
    };

    // A tap anywhere — or a key — skips to the end. Never trap the hand.
    const skip = (ev: Event) => {
      ev.preventDefault();
      ev.stopPropagation();
      fireNavigate();
      const now = performance.now();
      t0 = Math.min(t0, now - dur); // jump the film to its final frame
      if (!outStart) outStart = now; // and begin the tail fade at once
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" || ev.key === "Enter" || ev.key === " ") skip(ev);
    };
    const onResize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      sizeCanvas(canvas, ctx);
      if (reduce) renderStills();
    };
    window.addEventListener("pointerdown", skip, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onResize);

    const tick = (now: number) => {
      if (finished) return;
      const elapsed = now - t0;
      const t = clamp01(elapsed / dur);
      const eased = easeInOut(t);

      // Cues, in the order the body meets them.
      if (!navFired && t >= spec.navigateAt) fireNavigate();
      if (!bellRung && t >= spec.bellAt) {
        bellRung = true;
        try {
          getFieldAudio().bell();
        } catch {
          /* noop */
        }
      }
      if (!detentFelt && t >= spec.detentAt) {
        detentFelt = true;
        hapticDetent();
      }
      // The one instrument glides its register across the decades between.
      try {
        setScaleRegister(sFrom + (sTo - sFrom) * eased);
      } catch {
        /* noop */
      }

      // Draw.
      if (reduce) {
        const aB = smoothstep(0.2, 0.45, t);
        const aC = smoothstep(0.55, 0.8, t);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        if (stills[0]) ctx.drawImage(stills[0], 0, 0);
        if (aB > 0 && stills[1]) {
          ctx.globalAlpha = aB;
          ctx.drawImage(stills[1], 0, 0);
        }
        if (aC > 0 && stills[2]) {
          ctx.globalAlpha = aC;
          ctx.drawImage(stills[2], 0, 0);
        }
        ctx.globalAlpha = 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      } else {
        const u = spec.out ? eased : 1 - eased;
        film.renderFrame(ctx, w, h, u);
      }

      // Opacity envelope: a short breath in, the film, a short breath out.
      if (t >= 1 && !outStart) outStart = now;
      let opacity = Math.min(1, elapsed / FADE_IN_MS);
      if (outStart) opacity = Math.min(opacity, 1 - (now - outStart) / FADE_OUT_MS);
      canvas.style.opacity = String(clamp01(opacity));
      if (outStart && opacity <= 0) {
        fireNavigate(); // belt and braces — never strand the traveler
        finish();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // Unmount/replacement cleanup only tears down — it must never call
    // onDone, or replacing a passage mid-flight would clear the new one.
    return teardown;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passage.nonce]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 72,
        opacity: 0,
        touchAction: "none",
        cursor: "default",
      }}
    />
  );
}
