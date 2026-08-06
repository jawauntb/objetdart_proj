"use client";

/**
 * TravelPassage — the crossing as a place, without becoming a room.
 *
 * Most band crossings fade to ink and go (ScaleTravel.executeTravel). A
 * crossing that is worth traversing instead gets a film: a scene function of
 * one coordinate u ∈ [0, 1] that draws what actually happens between those
 * two scales. Travelling back down plays the same film reversed. ~2.2–3.6s,
 * and a tap anywhere skips to the end.
 *
 * `makeFilm` below — the parchment chart curling onto a turning planet — was
 * written for atlas ↔ stars and became the DEFAULT for every unregistered
 * edge, which is how a visitor came to report that "many are just a spinning
 * earth": the planet was playing between the quarks and the nucleons. It is
 * now only the fallback of last resort. Every edge the scale graph actually
 * walks resolves to its own film (`PASSAGES` in lib/travel-passage.ts,
 * dispatched in `makeFilmFor`), and atlas ↔ stars has "starchart" — the
 * chart re-projected into the sky it was always a piece of.
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
    for (let i = 0; i < cast.length; i++) {
      const cw = cast[i];
      const a = clamp01(beadIn * cast.length - i * 0.55);
      drawBead(ctx, cw, anchors[i].x * w, anchors[i].y * h, m * 0.05 * cw.radius01 * 1.6, a * 0.95);
    }
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
    for (let i = 0; i < cast.length; i++) {
      const cw = cast[i];
      const or = orbits[i + 1];
      const th = free[i].th + u * 0.6;
      const ox = cx + Math.cos(th) * or * m * 1.35;
      const oy = cy + Math.sin(th) * or * m * 0.62;
      const x = lerp(free[i].x * w, ox, settle);
      const y = lerp(free[i].y * h, oy, settle);
      drawBead(ctx, cw, x, y, m * 0.045 * cw.radius01 * (1.5 - u * 0.5), 0.95);
    }
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


// ——— High-traffic ground / vista / ceiling films ——————————————————————
//
// Authored with u = 0 at the lower-s end of the edge and u = 1 at the
// higher-s end. PassagePlayer reverses u when `spec.out` is false.

/** coast ↔ olympus — the fog sea rises until the peak stands above it. */
function makeFogClimbFilm(seed: number): Film {
  const n = makeNoise2(seed ^ 0x0c0a57);
  const RIDGE = 64;
  const ridges: Float32Array[] = [0, 1, 2].map((r) => {
    const arr = new Float32Array(RIDGE);
    for (let i = 0; i < RIDGE; i++) {
      const x = i / (RIDGE - 1);
      const v = fbm(n, x * (2.8 + r * 1.8) + r * 11.1, r * 7.3, 4);
      arr[i] = 1 - Math.abs(2 * v - 1);
    }
    return arr;
  });
  const rng = seededRandom(seed ^ 0x50a);
  const swell = Array.from({ length: 5 }, () => ({
    y: 0.55 + rng() * 0.28,
    speed: 0.15 + rng() * 0.5,
    len: 0.25 + rng() * 0.3,
    ph: rng(),
  }));

  const renderFrame = (ctx: CanvasRenderingContext2D, w: number, h: number, u: number): void => {
    const climb = easeInOut(smoothstep(0.04, 0.92, u));
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgba(mix([168, 196, 214], [92, 128, 168], climb), 1));
    g.addColorStop(0.55, rgba(mix([210, 222, 230], [140, 168, 196], climb), 1));
    g.addColorStop(1, rgba(mix(SEA, [48, 62, 78], climb * 0.5), 1));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    for (let r = 2; r >= 0; r--) {
      const rise = smoothstep(0.12 + r * 0.1, 0.78 + r * 0.06, u);
      const baseY = h * (0.78 - r * 0.07) - rise * h * (0.22 + r * 0.04);
      const amp = h * (0.1 + r * 0.07) * (0.35 + rise * 0.65);
      ctx.beginPath();
      ctx.moveTo(-2, h + 2);
      for (let i = 0; i < RIDGE; i++) {
        const x = (i / (RIDGE - 1)) * (w + 4) - 2;
        ctx.lineTo(x, baseY - ridges[r][i] * amp);
      }
      ctx.lineTo(w + 2, h + 2);
      ctx.closePath();
      const dark: RGB = r === 2 ? [22, 26, 34] : r === 1 ? [38, 44, 56] : [58, 66, 82];
      ctx.fillStyle = rgba(mix(dark, [120, 140, 160], (1 - rise) * 0.25), 1);
      ctx.fill();
    }

    const fogA = (1 - smoothstep(0.35, 0.9, u)) * 0.72;
    if (fogA > 0.01) {
      const fogY = h * (0.58 + climb * 0.18);
      for (const s of swell) {
        for (let k = 0; k < 3; k++) {
          const cx = ((s.ph + k / 3 + (1 - u) * s.speed) % 1.3) - 0.15;
          ctx.fillStyle = rgba([220, 228, 236], fogA * (0.45 + 0.35 * Math.sin(s.ph * 9 + k)));
          ctx.beginPath();
          ctx.ellipse(cx * w, fogY + (s.y - 0.7) * h * 0.2, (s.len * w) / 2, Math.max(3, h * 0.018), 0, 0, TAU);
          ctx.fill();
        }
      }
    }
  };

  return { renderFrame };
}

/** earth ↔ flowers — the ground opens into a meadow of candle-warm blooms. */
function makeGardenFilm(seed: number): Film {
  const rng = seededRandom(seed ^ 0x6a7de4);
  const blooms: Array<{ x: number; y: number; r: number; hue: number; ph: number }> = [];
  for (let i = 0; i < 48; i++) {
    blooms.push({
      x: 0.08 + rng() * 0.84,
      y: 0.42 + rng() * 0.5,
      r: 0.012 + rng() * 0.028,
      hue: rng(),
      ph: rng() * TAU,
    });
  }
  const cols: RGB[] = [
    mix(CANDLE, PAPER, 0.25),
    mix(KEPT, PAPER, 0.35),
    mix([180, 90, 110], PAPER, 0.3),
    mix(AURORA, PAPER, 0.4),
  ];

  const renderFrame = (ctx: CanvasRenderingContext2D, w: number, h: number, u: number): void => {
    const meadow = easeInOut(smoothstep(0.05, 0.88, u));
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgba(mix([120, 148, 168], [168, 196, 180], meadow), 1));
    g.addColorStop(0.45, rgba(mix([90, 110, 70], [70, 104, 62], meadow), 1));
    g.addColorStop(1, rgba(mix([48, 42, 28], [36, 48, 30], meadow), 1));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const landA = 1 - smoothstep(0.2, 0.75, u);
    if (landA > 0.02) {
      ctx.fillStyle = rgba([62, 58, 44], 0.55 * landA);
      ctx.beginPath();
      ctx.moveTo(0, h * 0.52);
      ctx.quadraticCurveTo(w * 0.35, h * 0.42, w * 0.55, h * 0.5);
      ctx.quadraticCurveTo(w * 0.8, h * 0.58, w, h * 0.48);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fill();
    }

    const bloomIn = smoothstep(0.18, 0.85, 1 - u);
    for (let i = 0; i < blooms.length; i++) {
      const b = blooms[i];
      const a = clamp01(bloomIn * blooms.length * 0.55 - i * 0.35) * (0.55 + 0.45 * Math.sin(b.ph + u * 4));
      if (a <= 0.02) continue;
      const col = cols[i % cols.length];
      const r = b.r * Math.min(w, h) * (0.7 + a * 0.5);
      ctx.fillStyle = rgba(col, a * 0.9);
      ctx.beginPath();
      ctx.arc(b.x * w, b.y * h, r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = rgba(mix(col, PAPER, 0.35), a * 0.7);
      for (let p = 0; p < 4; p++) {
        const ang = b.ph + (p * TAU) / 4 + u;
        ctx.beginPath();
        ctx.ellipse(
          b.x * w + Math.cos(ang) * r * 0.9,
          b.y * h + Math.sin(ang) * r * 0.9,
          r * 0.55,
          r * 0.28,
          ang,
          0,
          TAU,
        );
        ctx.fill();
      }
    }
  };

  return { renderFrame };
}

/** atlas ↔ earth — parchment chart curls onto the turning globe. */
function makeChartLandFilm(seed: number): Film | null {
  const earth = worldFromLatent(EARTH_LATENT, seed ^ 0xc4a7);
  const paintGlobe = makeGlobePainter(earth, seed ^ 0xc4a7);
  if (!paintGlobe) return null;
  const n = makeNoise2(seed ^ 0x11a7);
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
    for (let j = 0; j < TEXM; j++) {
      for (let i = 0; i < TEXM; i++) {
        const x = i / TEXM;
        const y = j / TEXM;
        const o = (j * TEXM + i) * 4;
        const land = fbm(n, x * 3.1 + 4.2, y * 3.1 + 1.7, 4) - 0.5;
        let col: RGB = land > 0
          ? mix(PAPER2, KEPT, 0.12 + Math.min(0.55, land * 2.8))
          : mix(PAPER, SEA, 0.1 + Math.min(0.45, -land * 2));
        const coast = 1 - Math.min(1, Math.abs(land) / 0.016);
        if (coast > 0) col = mix(col, INK, coast * 0.7);
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

  const renderFrame = (ctx: CanvasRenderingContext2D, w: number, h: number, u: number): void => {
    const m = Math.min(w, h);
    ctx.fillStyle = rgba(mix(PAPER, NIGHT, smoothstep(0.35, 0.85, u) * 0.85), 1);
    ctx.fillRect(0, 0, w, h);

    const mapA = 1 - smoothstep(0.25, 0.78, u);
    if (mapA > 0.01) {
      const scale = lerp(1.08, 1.45, smoothstep(0.2, 0.9, u));
      const mw = Math.max(w, h) * scale;
      ctx.globalAlpha = mapA;
      ctx.drawImage(map, (w - mw) / 2, (h - mw) / 2 + u * h * 0.08, mw, mw);
      ctx.globalAlpha = 1;
    }

    const globeIn = smoothstep(0.2, 0.85, u);
    if (globeIn > 0.02) {
      const R = lerp(0.22 * m, 0.48 * m, easeInOut(globeIn));
      const gx = w / 2;
      const gy = h * 0.48;
      haloRings(ctx, gx, gy, R * 0.95, R * 1.28, [120, 160, 168], 0.22 * globeIn);
      paintGlobe(ctx, gx, gy, R, u * 0.7);
    }
  };

  return { renderFrame };
}

/** earth ↔ coast — the land meets the sea; the strand walks across the frame. */
function makeStrandFilm(seed: number): Film {
  const n = makeNoise2(seed ^ 0x57a4d);
  const rng = seededRandom(seed ^ 0xc0a5);
  const foam: Array<{ x: number; y: number; r: number; ph: number }> = [];
  for (let i = 0; i < 36; i++) {
    foam.push({ x: rng(), y: rng() * 0.35, r: 0.8 + rng() * 2.2, ph: rng() * TAU });
  }

  const renderFrame = (ctx: CanvasRenderingContext2D, w: number, h: number, u: number): void => {
    const landFrac = easeInOut(smoothstep(0.05, 0.9, u));
    const shoreX = w * (0.28 + landFrac * 0.44);

    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgba(mix([150, 186, 210], [120, 148, 168], landFrac), 1));
    g.addColorStop(1, rgba(mix(SEA, [70, 90, 60], landFrac * 0.35), 1));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = rgba(SEA, 0.85);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let i = 0; i <= 48; i++) {
      const t = i / 48;
      const y = t * h;
      const wobble = (fbm(n, t * 3.2 + u, 2.1, 3) - 0.5) * w * 0.06;
      ctx.lineTo(shoreX + wobble, y);
    }
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = rgba(mix(KEPT, [70, 90, 52], 0.35), 0.92);
    ctx.beginPath();
    ctx.moveTo(w, 0);
    for (let i = 0; i <= 48; i++) {
      const t = i / 48;
      const y = t * h;
      const wobble = (fbm(n, t * 3.2 + u, 2.1, 3) - 0.5) * w * 0.06;
      ctx.lineTo(shoreX + wobble, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    const foamA = (1 - Math.abs(landFrac - 0.5) * 1.4) * 0.7;
    if (foamA > 0.05) {
      for (const f of foam) {
        const y = (0.15 + f.y * 0.7) * h;
        const wobble = (fbm(n, f.y * 3.2 + u, 2.1, 3) - 0.5) * w * 0.06;
        const tw = 0.6 + 0.4 * Math.sin(f.ph + u * 8);
        ctx.fillStyle = rgba(PAPER, foamA * tw * 0.75);
        ctx.beginPath();
        ctx.arc(shoreX + wobble + (f.x - 0.5) * 10, y, f.r, 0, TAU);
        ctx.fill();
      }
    }
  };

  return { renderFrame };
}

/** space ↔ manifold — the web stretches until the fold's mesh takes the frame. */
function makeFoldFilm(seed: number): Film {
  const rng = seededRandom(seed ^ 0xf01d);
  const vignette = makeVignette();
  const knotSprite = makeGlowSprite(PAPER, CANDLE, 0.45);
  const knots: Array<{ x: number; y: number; m: number }> = [];
  for (let i = 0; i < 22; i++) {
    knots.push({ x: 0.1 + rng() * 0.8, y: 0.1 + rng() * 0.8, m: 0.4 + rng() * 1 });
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

  const renderFrame = (ctx: CanvasRenderingContext2D, w: number, h: number, u: number): void => {
    ctx.fillStyle = rgba(NIGHT, 1);
    ctx.fillRect(0, 0, w, h);

    const fold = easeInOut(smoothstep(0.08, 0.92, u));
    const webA = (1 - smoothstep(0.35, 0.88, u)) * 0.95;
    if (webA > 0.02) {
      ctx.lineWidth = 1;
      for (const [a, b] of links) {
        const ax = lerp(knots[a].x, 0.5 + (knots[a].x - 0.5) * 1.15, fold);
        const ay = lerp(knots[a].y, 0.5 + (knots[a].y - 0.5) * 1.15, fold);
        const bx = lerp(knots[b].x, 0.5 + (knots[b].x - 0.5) * 1.15, fold);
        const by = lerp(knots[b].y, 0.5 + (knots[b].y - 0.5) * 1.15, fold);
        ctx.strokeStyle = rgba([140, 176, 206], 0.35 * webA);
        ctx.beginPath();
        ctx.moveTo(ax * w, ay * h);
        ctx.lineTo(bx * w, by * h);
        ctx.stroke();
      }
      for (const kn of knots) {
        const x = lerp(kn.x, 0.5 + (kn.x - 0.5) * 1.15, fold) * w;
        const y = lerp(kn.y, 0.5 + (kn.y - 0.5) * 1.15, fold) * h;
        blitGlow(ctx, knotSprite, x, y, 6 + kn.m * 8, 0.45 * webA);
      }
    }

    const meshA = smoothstep(0.25, 0.85, u);
    if (meshA > 0.02) {
      const gap = Math.max(22, Math.min(w, h) / 18);
      ctx.strokeStyle = rgba(mix(PAPER, CANDLE, 0.2), 0.22 * meshA);
      ctx.lineWidth = 1;
      const well = 0.12 * fold;
      for (let x = 0; x <= w + gap; x += gap) {
        ctx.beginPath();
        for (let y = 0; y <= h; y += 8) {
          const nx = (x / w - 0.5) * 2;
          const ny = (y / h - 0.5) * 2;
          const r2 = nx * nx + ny * ny;
          const pull = well / (0.15 + r2);
          const px = x - nx * pull * w * 0.35;
          const py = y - ny * pull * h * 0.35;
          if (y === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      for (let y = 0; y <= h + gap; y += gap) {
        ctx.beginPath();
        for (let x = 0; x <= w; x += 8) {
          const nx = (x / w - 0.5) * 2;
          const ny = (y / h - 0.5) * 2;
          const r2 = nx * nx + ny * ny;
          const pull = well / (0.15 + r2);
          const px = x - nx * pull * w * 0.35;
          const py = y - ny * pull * h * 0.35;
          if (x === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }

    vignette(ctx, w, h);
  };

  return { renderFrame };
}

// ——— The small-scale spine, quanta ↔ drop ————————————————————————————
//
// Ten films for the ten trunk edges the astronomical trunk left dark (the
// whole quanta→quarks→nucleons→atoms→molecules→organics→dna→organelles→
// cells→tissue→drop run used to fall back to a plain 2400ms breath — the
// only films a visitor ever saw were the planetary ones). Each depicts the
// actual physical relationship between its two scales, not a zoom:
// excitations condensing into a bound triplet, confinement tubes drawing
// closed, a nucleus receding as its cloud blooms, two clouds overlapping
// into a bond, a backbone lengthening, a strand twisting shut into a helix,
// the helix coiling into a membrane-bound body, a membrane closing around a
// working interior, cells adhering into a sheet, and the sheet dissolving
// into the water it lives in. All ten are quicker than the astronomical
// films — nothing here needs 3.5s to read. Every one is a pure function of
// u and a seed: randomness is drawn once at film-build time into fixed
// arrays, never inside renderFrame, so the return leg's backward replay
// lands on exactly the frames the outbound leg drew.

// Color-charge triplet — the three primaries a bound state cancels to white.
const CHARGE_RED: RGB = [214, 74, 66];
const CHARGE_GREEN: RGB = [92, 186, 108];
const CHARGE_BLUE: RGB = [88, 128, 224];
const CHARGE_COLORS: RGB[] = [CHARGE_RED, CHARGE_GREEN, CHARGE_BLUE];

/**
 * quanta ↔ quarks — "quantum": the vacuum's seethe resolving into a bound
 * triplet.
 *   u = 0   virtual pairs flicker in and out everywhere, colorless, none
 *           of them lasting
 *   u ≈ 0.6 three of them stop flickering and take a color charge
 *   u = 1   three color-charged points, tied by confinement tubes, standing
 *           in a tight triangle — a quark triplet
 * The rest of the seethe never stops; only the chosen three condense.
 */
function makeQuantumFilm(seed: number): Film {
  const rng = seededRandom(seed);
  const FLICKER = 140;
  const flicker: Array<{ x: number; y: number; ph: number; freq: number }> = [];
  for (let i = 0; i < FLICKER; i++) {
    flicker.push({ x: rng(), y: rng(), ph: rng() * TAU, freq: 3 + rng() * 5 });
  }
  const chargeSprites = CHARGE_COLORS.map((c) => makeGlowSprite(mix(c, PAPER, 0.3), c, 0.5));
  // The three that condense: seeded scatter start → a fixed tight triangle.
  const quarks = CHARGE_COLORS.map((_, i) => ({
    sx: 0.32 + rng() * 0.36,
    sy: 0.28 + rng() * 0.4,
    ang: (i / 3) * TAU - Math.PI / 2,
  }));
  // Reused every frame — the triplet's current screen position, written in
  // place instead of a fresh array/objects per tick.
  const pos = quarks.map(() => ({ x: 0, y: 0 }));

  const renderFrame = (ctx: CanvasRenderingContext2D, w: number, h: number, u: number): void => {
    const m = Math.min(w, h);
    ctx.fillStyle = rgba(NIGHT, 1);
    ctx.fillRect(0, 0, w, h);

    // The seethe: always flickering, thinning as the triplet takes over.
    const seetheA = 1 - smoothstep(0.4, 0.95, u) * 0.55;
    for (const f of flicker) {
      const v = 0.5 + 0.5 * Math.sin(f.ph + u * f.freq * TAU);
      const a = Math.max(0, v - 0.35) * 1.4 * seetheA;
      if (a <= 0.01) continue;
      ctx.fillStyle = rgba(PAPER, a * 0.55);
      ctx.fillRect(f.x * w, f.y * h, 1.1, 1.1);
    }

    const condense = easeInOut(smoothstep(0.15, 0.88, u));
    const cx = w / 2;
    const cy = h / 2;
    const R = m * 0.1;
    for (let i = 0; i < quarks.length; i++) {
      const q = quarks[i];
      const tx = cx + Math.cos(q.ang) * R;
      const ty = cy + Math.sin(q.ang) * R;
      pos[i].x = lerp(q.sx * w, tx, condense);
      pos[i].y = lerp(q.sy * h, ty, condense);
    }

    // Confinement tubes: they draw closed as the triplet condenses.
    const tubeA = smoothstep(0.3, 0.85, u);
    if (tubeA > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineWidth = Math.max(1, m * 0.006 * condense);
      for (let i = 0; i < 3; i++) {
        const a = pos[i];
        const b = pos[(i + 1) % 3];
        const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        g.addColorStop(0, rgba(CHARGE_COLORS[i], 0.5 * tubeA));
        g.addColorStop(1, rgba(CHARGE_COLORS[(i + 1) % 3], 0.5 * tubeA));
        ctx.strokeStyle = g;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // The quarks themselves, gaining color as they condense.
    const chargeIn = smoothstep(0.1, 0.7, u);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 3; i++) {
      blitGlow(ctx, chargeSprites[i], pos[i].x, pos[i].y, m * (0.02 + condense * 0.035), 0.55 + 0.4 * chargeIn);
    }
    ctx.restore();
  };

  return { renderFrame };
}

/**
 * quarks ↔ nucleons — "confine": the three confinement tubes drawing closed
 * into one nucleon's skin.
 *   u = 0   the quark triplet, spread in its confinement triangle, three
 *           colors held apart by the tubes between them
 *   u ≈ 0.6 the tubes draw closed, the colors blur toward white as they
 *           cancel
 *   u = 1   one nucleon: a single bound skin, no color visible from outside
 * Confinement made visible: the triplet never separates, it only closes.
 */
function makeConfineFilm(seed: number): Film {
  const rng = seededRandom(seed);
  const chargeSprites = CHARGE_COLORS.map((c) => makeGlowSprite(mix(c, PAPER, 0.3), c, 0.5));
  const skinSprite = makeGlowSprite(mix(PAPER, CANDLE, 0.25), CANDLE, 0.4);
  const quarks = CHARGE_COLORS.map((_, i) => ({ ang: (i / 3) * TAU - Math.PI / 2 }));
  // Reused every frame — written in place instead of a fresh array/objects
  // per tick.
  const pos = quarks.map(() => ({ x: 0, y: 0 }));
  // A quiet scatter behind everything — the vacuum this nucleon sits in.
  const dust: Array<{ x: number; y: number; ph: number }> = [];
  for (let i = 0; i < 60; i++) dust.push({ x: rng(), y: rng(), ph: rng() * TAU });

  const renderFrame = (ctx: CanvasRenderingContext2D, w: number, h: number, u: number): void => {
    const m = Math.min(w, h);
    ctx.fillStyle = rgba(NIGHT, 1);
    ctx.fillRect(0, 0, w, h);

    for (const d of dust) {
      const a = 0.14 * (0.5 + 0.5 * Math.sin(d.ph + u * 4));
      ctx.fillStyle = rgba(PAPER, a);
      ctx.fillRect(d.x * w, d.y * h, 1, 1);
    }

    const close = easeInOut(smoothstep(0.08, 0.82, u));
    const cx = w / 2;
    const cy = h / 2;
    const R = m * 0.16 * (1 - close * 0.94);
    for (let i = 0; i < quarks.length; i++) {
      const q = quarks[i];
      pos[i].x = cx + Math.cos(q.ang) * R;
      pos[i].y = cy + Math.sin(q.ang) * R;
    }

    const tubeA = 1 - smoothstep(0.55, 0.92, u) * 0.85;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = Math.max(1, m * 0.008);
    for (let i = 0; i < 3; i++) {
      const a = pos[i];
      const b = pos[(i + 1) % 3];
      const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      g.addColorStop(0, rgba(CHARGE_COLORS[i], 0.55 * tubeA));
      g.addColorStop(1, rgba(CHARGE_COLORS[(i + 1) % 3], 0.55 * tubeA));
      ctx.strokeStyle = g;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    const colorA = 1 - smoothstep(0.5, 0.95, u);
    if (colorA > 0.01) {
      for (let i = 0; i < 3; i++) {
        blitGlow(ctx, chargeSprites[i], pos[i].x, pos[i].y, m * 0.028, 0.7 * colorA);
      }
    }
    ctx.restore();

    // The skin: color-neutral, bound — it grows in as the colors cancel.
    const skinA = smoothstep(0.35, 0.9, u);
    if (skinA > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      blitGlow(ctx, skinSprite, cx, cy, m * (0.05 + skinA * 0.09), 0.85 * skinA);
      ctx.restore();
      ctx.fillStyle = rgba(mix(PAPER, CANDLE, 0.15), 0.9 * skinA);
      ctx.beginPath();
      ctx.arc(cx, cy, m * 0.05 * skinA, 0, TAU);
      ctx.fill();
    }
  };

  return { renderFrame };
}

/**
 * nucleons ↔ atoms — "shell": the nucleus receding to a point as the
 * electron cloud's probability shells bloom around it. The real story of
 * the atom — not a planet with moons, a point and the mostly-empty cloud
 * around it.
 *   u = 0   the nucleon fills the frame, a single bound skin
 *   u ≈ 0.5 it recedes to a bright point at centre
 *   u = 1   probability shells have bloomed around that point
 */
function makeShellFilm(seed: number): Film {
  const rng = seededRandom(seed);
  const skinSprite = makeGlowSprite(mix(PAPER, CANDLE, 0.25), CANDLE, 0.4);
  const SHELLS = 4;
  // Electron specks: seeded angle + shell index + phase, radius fixed per shell.
  const specks: Array<{ shell: number; ang: number; ph: number; drift: number }> = [];
  for (let s = 0; s < SHELLS; s++) {
    const n = 10 + s * 8;
    for (let i = 0; i < n; i++) {
      specks.push({ shell: s, ang: rng() * TAU, ph: rng() * TAU, drift: 0.4 + rng() * 0.8 });
    }
  }

  const renderFrame = (ctx: CanvasRenderingContext2D, w: number, h: number, u: number): void => {
    const m = Math.min(w, h);
    ctx.fillStyle = rgba(NIGHT, 1);
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;

    const recede = easeInOut(smoothstep(0.05, 0.55, u));
    const nucR = lerp(m * 0.42, m * 0.012, recede);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    blitGlow(ctx, skinSprite, cx, cy, Math.max(2, nucR * 1.6), 0.9);
    ctx.restore();
    ctx.fillStyle = rgba(mix(PAPER, CANDLE, 0.12), 0.95);
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1, nucR * 0.5), 0, TAU);
    ctx.fill();

    // Shells bloom outward, outer ones later — mostly empty space between them.
    const bloom = smoothstep(0.3, 0.98, u);
    for (const sp of specks) {
      const shellR = m * (0.06 + sp.shell * 0.09);
      const reach = clamp01(bloom * (SHELLS + 1) - sp.shell);
      if (reach <= 0) continue;
      const r = shellR * (0.4 + 0.6 * reach);
      const wobble = 1 + 0.06 * Math.sin(sp.ph + u * sp.drift * 6);
      const x = cx + Math.cos(sp.ang + u * sp.drift) * r * wobble;
      const y = cy + Math.sin(sp.ang + u * sp.drift) * r * wobble;
      const tw = 0.5 + 0.5 * Math.sin(sp.ph + u * 5);
      ctx.fillStyle = rgba(mix(AURORA, PAPER, 0.3), reach * tw * 0.55);
      ctx.fillRect(x, y, 1.3, 1.3);
    }
    // A faint shell ring per level — the probability, not a boundary.
    for (let s = 0; s < SHELLS; s++) {
      const reach = clamp01(bloom * (SHELLS + 1) - s);
      if (reach <= 0.02) continue;
      ctx.strokeStyle = rgba(AURORA, 0.05 * reach);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, m * (0.06 + s * 0.09), 0, TAU);
      ctx.stroke();
    }
  };

  return { renderFrame };
}

/**
 * atoms ↔ molecules — "bond": two clouds overlapping and a bond forming in
 * the shared lobe.
 *   u = 0   two clouds, each a nucleus point and its shell, apart
 *   u ≈ 0.7 they overlap; a bond lobe brightens in the shared lens
 *   u = 1   one molecule — two nuclei held by the shared electron pair
 */
function makeBondFilm(seed: number): Film {
  const rng = seededRandom(seed);
  const cloudSprite = makeGlowSprite(mix(AURORA, PAPER, 0.3), AURORA, 0.35);
  const nucSprite = makeGlowSprite(mix(PAPER, CANDLE, 0.25), CANDLE, 0.4);
  const bondSprite = makeGlowSprite(PAPER, mix(PAPER, CANDLE, 0.4), 0.5);
  const jitter = { a: rng() * TAU, b: rng() * TAU };

  const renderFrame = (ctx: CanvasRenderingContext2D, w: number, h: number, u: number): void => {
    const m = Math.min(w, h);
    ctx.fillStyle = rgba(NIGHT, 1);
    ctx.fillRect(0, 0, w, h);
    const cy = h / 2;
    const close = easeInOut(smoothstep(0.05, 0.85, u));
    const sep = lerp(m * 0.42, m * 0.1, close);
    const ax = w / 2 - sep;
    const bx = w / 2 + sep;
    const cloudR = m * 0.2;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    blitGlow(ctx, cloudSprite, ax, cy, cloudR, 0.4);
    blitGlow(ctx, cloudSprite, bx, cy, cloudR, 0.4);
    ctx.restore();

    // The bond: brightest where the clouds overlap.
    const overlap = clamp01((cloudR * 2 - sep * 2) / (cloudR * 2));
    if (overlap > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const midx = (ax + bx) / 2;
      blitGlow(ctx, bondSprite, midx, cy, cloudR * 0.55 * overlap, 0.85 * overlap);
      ctx.restore();
    }

    const tw = (ph: number) => 0.8 + 0.2 * Math.sin(ph + u * 5);
    ctx.fillStyle = rgba(mix(PAPER, CANDLE, 0.15), 0.95);
    ctx.beginPath();
    ctx.arc(ax, cy, m * 0.014 * tw(jitter.a), 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(bx, cy, m * 0.014 * tw(jitter.b), 0, TAU);
    ctx.fill();
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    blitGlow(ctx, nucSprite, ax, cy, m * 0.03, 0.6);
    blitGlow(ctx, nucSprite, bx, cy, m * 0.03, 0.6);
    ctx.restore();
  };

  return { renderFrame };
}

const CHAIN_LINKS = 14;

/**
 * molecules ↔ organics — "chain": a chain lengthening, carbon backbone
 * articulating.
 *   u = 0   the bonded pair from the last edge, small, at centre
 *   u = 1   a carbon backbone has articulated across the frame, zigzagging,
 *           side groups snapping onto it as it lengthens
 */
function makeChainFilm(seed: number): Film {
  const rng = seededRandom(seed);
  const nucSprite = makeGlowSprite(mix(PAPER, CANDLE, 0.25), CANDLE, 0.4);
  const sideColors: RGB[] = [mix(AURORA, PAPER, 0.3), mix(SEA, PAPER, 0.35), mix(KEPT, PAPER, 0.3)];
  const sides = Array.from({ length: CHAIN_LINKS }, () => ({
    has: rng() > 0.5,
    ang: rng() > 0.5 ? -1 : 1,
    col: sideColors[Math.floor(rng() * sideColors.length)],
  }));
  // Reused every frame — the backbone's current node positions, written in
  // place instead of a fresh array/objects per tick.
  const nodes: Array<{ x: number; y: number; a: number }> = Array.from({ length: CHAIN_LINKS }, () => ({
    x: 0,
    y: 0,
    a: 0,
  }));

  const renderFrame = (ctx: CanvasRenderingContext2D, w: number, h: number, u: number): void => {
    const m = Math.min(w, h);
    ctx.fillStyle = rgba(NIGHT, 1);
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;

    const grow = smoothstep(0.05, 0.95, u);
    const span = lerp(m * 0.06, w * 0.78, easeInOut(grow));
    const step = span / (CHAIN_LINKS - 1);
    const amp = lerp(0, m * 0.05, smoothstep(0.1, 0.55, u));
    const x0 = cx - span / 2;

    for (let i = 0; i < CHAIN_LINKS; i++) {
      const reach = clamp01(grow * CHAIN_LINKS - i * 0.75);
      const n = nodes[i];
      n.x = x0 + step * i;
      n.y = cy + (i % 2 === 0 ? -amp : amp);
      n.a = reach;
    }

    ctx.strokeStyle = rgba(mix(PAPER, CANDLE, 0.1), 0.6);
    ctx.lineWidth = Math.max(1, m * 0.006);
    ctx.beginPath();
    let started = false;
    for (const n of nodes) {
      if (n.a < 0.05) continue;
      if (!started) {
        ctx.moveTo(n.x, n.y);
        started = true;
      } else {
        ctx.lineTo(n.x, n.y);
      }
    }
    ctx.stroke();

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.a < 0.05) continue;
      ctx.save();
      ctx.globalAlpha = n.a;
      ctx.globalCompositeOperation = "lighter";
      blitGlow(ctx, nucSprite, n.x, n.y, m * 0.016, 0.7);
      ctx.restore();
      ctx.fillStyle = rgba(mix(PAPER, CANDLE, 0.1), 0.9 * n.a);
      ctx.beginPath();
      ctx.arc(n.x, n.y, m * 0.007, 0, TAU);
      ctx.fill();

      const s = sides[i];
      if (s.has) {
        const sideReach = clamp01((n.a - 0.4) / 0.6);
        if (sideReach > 0.01) {
          const sy = n.y + s.ang * amp * 1.3;
          ctx.strokeStyle = rgba(s.col, 0.4 * sideReach);
          ctx.lineWidth = Math.max(1, m * 0.004);
          ctx.beginPath();
          ctx.moveTo(n.x, n.y);
          ctx.lineTo(n.x, sy);
          ctx.stroke();
          ctx.fillStyle = rgba(s.col, 0.85 * sideReach);
          ctx.beginPath();
          ctx.arc(n.x, sy, m * 0.009, 0, TAU);
          ctx.fill();
        }
      }
    }
  };

  return { renderFrame };
}

const HELIX_N = 22;
const HELIX_TURNS = 2.6;
const BASE_TINTS: RGB[] = [
  mix(AURORA, PAPER, 0.2),
  mix([200, 120, 150] as RGB, PAPER, 0.2),
  mix(KEPT, PAPER, 0.15),
  mix(SEA, PAPER, 0.25),
];

/**
 * organics ↔ dna — "helix": the strand twisting closed into the double
 * helix, base-pair rungs snapping in.
 *   u = 0   the backbone, flat, from the last edge
 *   u = 1   it has twisted closed into the double helix, rungs snapped in
 *           as the strands wind
 */
function drawHelixStrand(
  ctx: CanvasRenderingContext2D,
  pts: Array<{ x: number; y: number; z: number }>,
): void {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

function drawHelixNode(ctx: CanvasRenderingContext2D, p: { x: number; y: number; z: number }, m: number, nodeA: number): void {
  const depth = 0.5 + 0.5 * p.z;
  ctx.fillStyle = rgba(mix(PAPER, CANDLE, 0.1), (0.5 + 0.5 * depth) * (0.3 + 0.7 * nodeA));
  ctx.beginPath();
  ctx.arc(p.x, p.y, m * 0.006 * (0.6 + 0.4 * depth), 0, TAU);
  ctx.fill();
}

function makeHelixFilm(seed: number): Film {
  const rng = seededRandom(seed);
  const bases = Array.from({ length: HELIX_N }, () => Math.floor(rng() * BASE_TINTS.length));
  // Reused every frame — the two backbones' current screen positions,
  // written in place instead of two fresh arrays of objects per tick.
  const strandA: Array<{ x: number; y: number; z: number }> = Array.from({ length: HELIX_N }, () => ({
    x: 0,
    y: 0,
    z: 0,
  }));
  const strandB: Array<{ x: number; y: number; z: number }> = Array.from({ length: HELIX_N }, () => ({
    x: 0,
    y: 0,
    z: 0,
  }));

  const renderFrame = (ctx: CanvasRenderingContext2D, w: number, h: number, u: number): void => {
    const m = Math.min(w, h);
    ctx.fillStyle = rgba(NIGHT, 1);
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const span = h * 0.72;
    const y0 = cy - span / 2;
    const twist = easeInOut(smoothstep(0.05, 0.85, u));
    const radius = m * 0.09 * twist;

    for (let i = 0; i < HELIX_N; i++) {
      const t = i / (HELIX_N - 1);
      const ang = t * TAU * HELIX_TURNS;
      const y = y0 + t * span;
      const a = strandA[i];
      a.x = cx + Math.cos(ang) * radius;
      a.y = y;
      a.z = Math.sin(ang);
      const b = strandB[i];
      b.x = cx + Math.cos(ang + Math.PI) * radius;
      b.y = y;
      b.z = Math.sin(ang + Math.PI);
    }

    ctx.strokeStyle = rgba(mix(PAPER, CANDLE, 0.15), 0.75);
    ctx.lineWidth = Math.max(1.2, m * 0.007);
    drawHelixStrand(ctx, strandA);
    drawHelixStrand(ctx, strandB);

    // Rungs snap in progressively, back strand behind, front in front.
    const rungIn = smoothstep(0.25, 0.98, u);
    for (let i = 0; i < HELIX_N; i++) {
      const reach = clamp01(rungIn * HELIX_N - i * 0.9);
      if (reach <= 0.02) continue;
      const a = strandA[i];
      const b = strandB[i];
      const depth = 0.5 + 0.5 * a.z;
      ctx.strokeStyle = rgba(BASE_TINTS[bases[i]], 0.65 * reach * (0.4 + 0.6 * depth));
      ctx.lineWidth = Math.max(1, m * 0.005) * (0.6 + 0.4 * depth);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    // Backbone nodes, brighter once the twist has begun to open them out.
    const nodeA = clamp01(twist * 4);
    for (let i = 0; i < HELIX_N; i++) {
      drawHelixNode(ctx, strandA[i], m, nodeA);
      drawHelixNode(ctx, strandB[i], m, nodeA);
    }
  };

  return { renderFrame };
}

/**
 * dna ↔ organelles — "chromatin": the helix coiling into chromatin and
 * receding into a membrane-bound body.
 *   u = 0   the double helix, small, at centre
 *   u ≈ 0.5 it coils around a widening loop — supercoiling into chromatin
 *   u = 1   condensed into a membrane-bound body, faint neighbour
 *           organelles already keeping it company
 */
function makeChromatinFilm(seed: number): Film {
  const rng = seededRandom(seed);
  const bases = Array.from({ length: HELIX_N }, () => Math.floor(rng() * BASE_TINTS.length));
  const membraneSprite = makeGlowSprite(mix(AURORA, PAPER, 0.35), AURORA, 0.3);
  const neighborTints: RGB[] = [mix(KEPT, PAPER, 0.3), mix(SEA, PAPER, 0.3), mix(CANDLE, PAPER, 0.35)];
  const neighbors = neighborTints.map((col, i) => ({
    ang: (i / neighborTints.length) * TAU + rng() * 0.6,
    dist: 0.22 + rng() * 0.1,
    r: 0.5 + rng() * 0.4,
    col,
  }));

  const renderFrame = (ctx: CanvasRenderingContext2D, w: number, h: number, u: number): void => {
    const m = Math.min(w, h);
    ctx.fillStyle = rgba(NIGHT, 1);
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;

    const coil = easeInOut(smoothstep(0.02, 0.6, u));
    const condense = easeInOut(smoothstep(0.45, 0.98, u));
    // The helix's own centreline sweeps a widening loop as it supercoils,
    // then the whole assembly shrinks toward the organelle's seat.
    const loopR = m * 0.1 * coil;
    const scale = lerp(1, 0.16, condense);
    const span = h * 0.5 * scale;

    for (let i = 0; i < HELIX_N; i++) {
      const t = i / (HELIX_N - 1);
      const loopAng = t * TAU * 2.2;
      const lx = cx + Math.cos(loopAng) * loopR * (1 - condense);
      const ly = cy + Math.sin(loopAng) * loopR * (1 - condense) * 0.6 - span / 2 + t * span;
      const ang = t * TAU * HELIX_TURNS;
      const radius = m * 0.05 * scale;
      const ax = lx + Math.cos(ang) * radius;
      const bx = lx + Math.cos(ang + Math.PI) * radius;
      const z = Math.sin(ang);
      const depth = 0.5 + 0.5 * z;
      ctx.fillStyle = rgba(BASE_TINTS[bases[i]], (0.35 + 0.35 * depth) * (1 - condense * 0.7));
      ctx.beginPath();
      ctx.arc(ax, ly, Math.max(0.6, m * 0.006 * (1 - condense * 0.6)), 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(bx, ly, Math.max(0.6, m * 0.006 * (1 - condense * 0.6)), 0, TAU);
      ctx.fill();
    }

    // Faint neighbour organelles, keeping company as this one seals shut.
    const neighborA = smoothstep(0.55, 0.98, u);
    if (neighborA > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const n of neighbors) {
        const nx = cx + Math.cos(n.ang) * m * n.dist;
        const ny = cy + Math.sin(n.ang) * m * n.dist * 0.8;
        blitGlow(ctx, membraneSprite, nx, ny, m * 0.05 * n.r, 0.3 * neighborA);
      }
      ctx.restore();
    }

    // The membrane closes around the condensed body.
    const membraneA = smoothstep(0.55, 1, u);
    if (membraneA > 0.01) {
      ctx.strokeStyle = rgba(AURORA, 0.5 * membraneA);
      ctx.lineWidth = Math.max(1, m * 0.006);
      ctx.beginPath();
      ctx.arc(cx, cy, m * 0.1 * scale + m * 0.02, 0, TAU);
      ctx.stroke();
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      blitGlow(ctx, membraneSprite, cx, cy, m * 0.16 * scale + m * 0.03, 0.35 * membraneA);
      ctx.restore();
    }
  };

  return { renderFrame };
}

const MEMBRANE_LOBES = 9;

/**
 * organelles ↔ cells — "membrane": the membrane closing around a working
 * interior.
 *   u = 0   loose organelles, no boundary
 *   u = 1   a membrane has closed around them; cytoplasm grain fills what
 *           used to be empty frame
 */
function makeMembraneFilm(seed: number): Film {
  const rng = seededRandom(seed);
  const wobble = new Float32Array(MEMBRANE_LOBES);
  for (let i = 0; i < MEMBRANE_LOBES; i++) wobble[i] = rng();
  const organelleTints: RGB[] = [
    mix(AURORA, PAPER, 0.25),
    mix(KEPT, PAPER, 0.3),
    mix(SEA, PAPER, 0.3),
    mix(CANDLE, PAPER, 0.3),
  ];
  // Sprites built once, outside the frame loop — never per organelle per frame.
  const organelleSprites = organelleTints.map((c) => makeGlowSprite(mix(c, PAPER, 0.3), c, 0.35));
  const organelles = organelleTints.map((col, i) => ({
    freeAng: rng() * TAU,
    freeDist: 0.3 + rng() * 0.35,
    ang: (i / organelleTints.length) * TAU + rng() * 0.4,
    dist: 0.14 + rng() * 0.16,
    r: 0.5 + rng() * 0.4,
    col,
  }));
  const grain: Array<{ x: number; y: number; a: number }> = [];
  for (let i = 0; i < 90; i++) grain.push({ x: rng(), y: rng(), a: 0.3 + rng() * 0.5 });

  const renderFrame = (ctx: CanvasRenderingContext2D, w: number, h: number, u: number): void => {
    const m = Math.min(w, h);
    ctx.fillStyle = rgba(NIGHT, 1);
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const close = easeInOut(smoothstep(0.1, 0.92, u));

    // Organelles drift from loose scatter to their settled interior anchors.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < organelles.length; i++) {
      const o = organelles[i];
      const fx = cx + Math.cos(o.freeAng) * m * o.freeDist;
      const fy = cy + Math.sin(o.freeAng) * m * o.freeDist * 0.8;
      const sx = cx + Math.cos(o.ang) * m * o.dist;
      const sy = cy + Math.sin(o.ang) * m * o.dist * 0.8;
      const x = lerp(fx, sx, close);
      const y = lerp(fy, sy, close);
      blitGlow(ctx, organelleSprites[i], x, y, m * 0.045 * o.r, 0.55);
    }
    ctx.restore();

    // Cytoplasm grain fills in behind, once there is an inside to fill.
    const grainA = smoothstep(0.3, 0.9, u);
    if (grainA > 0.01) {
      for (const g of grain) {
        const dx = g.x - 0.5;
        const dy = g.y - 0.5;
        if (dx * dx + dy * dy > 0.22) continue;
        ctx.fillStyle = rgba(mix(AURORA, PAPER, 0.4), grainA * g.a * 0.3);
        ctx.fillRect(g.x * w, g.y * h, 1, 1);
      }
    }

    // The membrane: a blobby closed curve, growing from a ring to the cell wall.
    const membraneA = smoothstep(0.15, 0.7, u);
    if (membraneA > 0.01) {
      const baseR = lerp(m * 0.05, m * 0.4, close);
      ctx.beginPath();
      for (let i = 0; i <= MEMBRANE_LOBES; i++) {
        const t = (i % MEMBRANE_LOBES) / MEMBRANE_LOBES;
        const ang = t * TAU;
        const wob = 1 + (wobble[i % MEMBRANE_LOBES] - 0.5) * 0.16;
        const x = cx + Math.cos(ang) * baseR * wob;
        const y = cy + Math.sin(ang) * baseR * wob;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = rgba(mix(PAPER, AURORA, 0.3), 0.7 * membraneA);
      ctx.lineWidth = Math.max(1.2, m * 0.008);
      ctx.stroke();
    }
  };

  return { renderFrame };
}

const SHEET_ROWS = 5;
const SHEET_COLS = 5;

/** A hex-tiled anchor grid, shared by the sheet and dissolve films so the
 * tissue they both look at is the same mosaic. */
function buildHexAnchors(): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let r = 0; r < SHEET_ROWS; r++) {
    for (let c = 0; c < SHEET_COLS; c++) {
      const x = 0.5 + (c - (SHEET_COLS - 1) / 2) * 0.19 + (r % 2 === 0 ? 0.095 : -0.095);
      const y = 0.5 + (r - (SHEET_ROWS - 1) / 2) * 0.165;
      out.push({ x, y });
    }
  }
  return out;
}

/**
 * cells ↔ tissue — "sheet": cells adhering into a sheet, junctions forming.
 *   u = 0   one cell, membrane and all, centred and large
 *   u = 1   a tessellated sheet of adhered cells, junctions glowing at
 *           every shared edge
 */
function makeSheetFilm(seed: number): Film {
  const rng = seededRandom(seed);
  const anchors = buildHexAnchors();
  const centerI = Math.floor(anchors.length / 2);
  const scatter = anchors.map((a, i) => (i === centerI ? a : { x: rng(), y: rng() }));
  const membraneCol = mix(PAPER, AURORA, 0.3);
  const cellR = 0.1;
  // Reused every frame — the settled screen position of each cell, written
  // in place instead of a fresh array/objects per tick.
  const pos = anchors.map(() => ({ x: 0, y: 0 }));

  const renderFrame = (ctx: CanvasRenderingContext2D, w: number, h: number, u: number): void => {
    const m = Math.min(w, h);
    ctx.fillStyle = rgba(NIGHT, 1);
    ctx.fillRect(0, 0, w, h);

    const settle = easeInOut(smoothstep(0.08, 0.85, u));
    const zoomOut = lerp(2.6, 1, smoothstep(0.15, 0.95, u));
    const cx = w / 2;
    const cy = h / 2;

    const cellIn = smoothstep(0.05, 0.7, u);
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const s = scatter[i];
      const nx = lerp(s.x, a.x, settle);
      const ny = lerp(s.y, a.y, settle);
      pos[i].x = cx + (nx - 0.5) * m * zoomOut;
      pos[i].y = cy + (ny - 0.5) * m * zoomOut;
    }

    for (let i = 0; i < pos.length; i++) {
      const reach = i === centerI ? 1 : clamp01(cellIn * pos.length - i * 0.3);
      if (reach <= 0.02) continue;
      const p = pos[i];
      const r = m * cellR * zoomOut * (0.85 + 0.15 * reach);
      ctx.fillStyle = rgba(mix(AURORA, NIGHT, 0.82), 0.5 * reach);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = rgba(membraneCol, 0.6 * reach);
      ctx.lineWidth = Math.max(1, m * 0.004);
      ctx.stroke();
    }

    // Adhesion junctions: bright points where neighbours have closed distance.
    const junctionA = smoothstep(0.4, 0.98, u);
    if (junctionA > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < pos.length; i++) {
        for (let j = i + 1; j < pos.length; j++) {
          const dx = pos[i].x - pos[j].x;
          const dy = pos[i].y - pos[j].y;
          const d = Math.hypot(dx, dy);
          const rr = m * cellR * zoomOut * 2.05;
          if (d > rr) continue;
          const mx = (pos[i].x + pos[j].x) / 2;
          const my = (pos[i].y + pos[j].y) / 2;
          ctx.fillStyle = rgba(PAPER, junctionA * 0.6);
          ctx.beginPath();
          ctx.arc(mx, my, Math.max(1, m * 0.005), 0, TAU);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  };

  return { renderFrame };
}

/**
 * tissue ↔ drop — "dissolve": the sheet dissolving into the water it lives
 * in.
 *   u = 0   the tessellated sheet, junctions and all
 *   u = 1   the sheet has let go into the water — one drop, ripples
 *           answering a surface no longer solid
 */
function makeDissolveFilm(seed: number): Film {
  const rng = seededRandom(seed);
  const anchors = buildHexAnchors();
  const jitter = anchors.map(() => ({ ph: rng() * TAU }));
  const membraneCol = mix(PAPER, AURORA, 0.3);
  const dropSprite = makeGlowSprite([150, 235, 250], [70, 150, 190], 0.4);
  const cellR = 0.1;

  const renderFrame = (ctx: CanvasRenderingContext2D, w: number, h: number, u: number): void => {
    const m = Math.min(w, h);
    ctx.fillStyle = rgba(NIGHT, 1);
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;

    const erode = easeInOut(smoothstep(0.1, 0.85, u));
    const gather = smoothstep(0.35, 0.98, u);

    // The sheet's cells drift apart and lose their edges as they go.
    const sheetA = 1 - smoothstep(0.3, 0.85, u);
    if (sheetA > 0.02) {
      for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i];
        const j = jitter[i];
        const spread = erode * 0.5;
        const x = cx + (a.x - 0.5 + Math.cos(j.ph) * spread) * m;
        const y = cy + (a.y - 0.5 + Math.sin(j.ph) * spread) * m;
        const r = m * cellR * (1 - erode * 0.35);
        ctx.fillStyle = rgba(mix(AURORA, NIGHT, 0.82), 0.4 * sheetA);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = rgba(membraneCol, (0.55 - erode * 0.4) * sheetA);
        ctx.lineWidth = Math.max(1, m * 0.004);
        ctx.stroke();
      }
    }

    // The drop: everything the sheet was made of, held now by surface tension.
    if (gather > 0.01) {
      const R = m * 0.32 * gather;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      blitGlow(ctx, dropSprite, cx, cy, R * 1.3, 0.6 * gather);
      ctx.restore();
      ctx.fillStyle = rgba([150, 220, 235], 0.35 * gather);
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, TAU);
      ctx.fill();
      // Ripples, answering a surface no longer solid.
      for (let k = 0; k < 3; k++) {
        const rp = (u * 2.2 + k / 3) % 1;
        ctx.strokeStyle = rgba([200, 240, 250], (1 - rp) * 0.3 * gather);
        ctx.lineWidth = Math.max(1, m * 0.004);
        ctx.beginPath();
        ctx.arc(cx, cy, R * (0.3 + rp * 1.1), 0, TAU);
        ctx.stroke();
      }
      // One highlight glint.
      ctx.fillStyle = rgba(PAPER, 0.6 * gather);
      ctx.beginPath();
      ctx.ellipse(cx - R * 0.32, cy - R * 0.32, R * 0.14, R * 0.08, -0.6, 0, TAU);
      ctx.fill();
    }
  };

  return { renderFrame };
}

// ——— The doors both trunks left dark ————————————————————————————————
//
// Nine films for the eighteen edges that still resolved to the default
// planet: the album's busiest hop (atlas ↔ stars — the literal spinning
// earth a visitor reported, playing on a crossing it has nothing to do
// with), the six human-scale doors of the living middle, and the two at the
// top of the axis. Same law as the spine: every random element is drawn
// ONCE at construction into fixed arrays, and renderFrame reads only `u`
// and those arrays — so the return leg's backward replay lands on exactly
// the frames the outbound leg drew, and a frame at u=0.42 is the same frame
// whether it is the third drawn or the thirtieth.

const SAND: RGB = [174, 156, 128];
const WET_SAND: RGB = [120, 116, 108];
const LEAF: RGB = [86, 120, 64];
const LEAF_DEEP: RGB = [38, 60, 36];
const GROUND: RGB = [104, 94, 70];
const SKY_LOW: RGB = [190, 212, 226];
const SKY_HIGH: RGB = [92, 134, 178];
/** The drop's own water — the dissolve film's bead, so a drop is the same
 * drop through every door it opens. */
const DROP_CORE: RGB = [150, 220, 235];
const DROP_RIM: RGB = [70, 150, 190];

/**
 * The wobble every coast film gives its shoreline — the strand film's own
 * formula, shared so /coast reads as one shore whichever door the hand came
 * through. Returns a signed offset in [-0.5, 0.5].
 */
function makeSwash(seed: number): (t: number, u: number) => number {
  const n = makeNoise2(seed ^ 0x5a5b0e);
  return (t, u) => fbm(n, t * 3.2 + u, 2.1, 3) - 0.5;
}

/** A folded ridge line — an arête, not a hill. Built once, read per frame. */
function foldedRidge(n: Noise2, stops: number, freq: number, phase: number): Float32Array {
  const arr = new Float32Array(stops);
  for (let i = 0; i < stops; i++) {
    const v = fbm(n, (i / (stops - 1)) * freq + phase, phase * 0.7, 4);
    arr[i] = 1 - Math.abs(2 * v - 1);
  }
  return arr;
}

/**
 * A bird as two strokes and a beat — shared by the two flock films, so the
 * same flyer crosses the garden door and the shore door. `flap` ∈ [-1, 1]
 * is the wing position, which the caller derives from u alone.
 */
function drawBird(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  span: number,
  flap: number,
  col: RGB,
  alpha: number,
): void {
  if (alpha <= 0.01 || span <= 0.3) return;
  const dy = -span * 0.5 * flap;
  ctx.strokeStyle = rgba(col, alpha);
  ctx.lineWidth = Math.max(0.7, span * 0.16);
  ctx.beginPath();
  ctx.moveTo(x - span, y + dy);
  ctx.quadraticCurveTo(x - span * 0.45, y + dy * 0.2, x, y);
  ctx.quadraticCurveTo(x + span * 0.45, y + dy * 0.2, x + span, y + dy);
  ctx.stroke();
}

/** A bloom: a disc and a whorl of petals, the garden film's construction. */
function drawBloom(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  col: RGB,
  alpha: number,
  spin: number,
): void {
  if (alpha <= 0.02 || r <= 0.4) return;
  ctx.fillStyle = rgba(mix(col, PAPER, 0.35), alpha * 0.75);
  for (let p = 0; p < 5; p++) {
    const ang = spin + (p * TAU) / 5;
    ctx.beginPath();
    ctx.ellipse(x + Math.cos(ang) * r * 0.95, y + Math.sin(ang) * r * 0.95, r * 0.6, r * 0.3, ang, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = rgba(col, alpha * 0.95);
  ctx.beginPath();
  ctx.arc(x, y, r * 0.55, 0, TAU);
  ctx.fill();
}

const STARCHART_STARS = 240;
const STARCHART_MERIDIANS = 9;
const STARCHART_PARALLELS = 5;
const LAND_STOPS = 30;

/**
 * atlas ↔ stars — "starchart": one world's chart re-projected into a sky of
 * many suns. The busiest hop in the album, and until now the one playing the
 * default planet.
 *   u = 0   the chart: parchment, a sea tint, ink coasts, the ruled
 *           graticule, and the settlements marked as ink dots
 *   u ≈ 0.5 the graticule bends — meridians converging on a pole, parallels
 *           closing into circles. The same instrument, re-aimed
 *   u = 1   a polar star chart. The paper has gone to night, the ruled ink
 *           is ruled light, every mark that stood for a place on one world
 *           is a sun with its own distance, and the cartographer's hand
 *           rules lines between them
 * The coastlines, the graticule and the place-marks all travel through one
 * projection function, so nothing is cross-faded over anything: the single
 * drawing is bent from a sheet into a dome.
 */
function makeStarChartFilm(seed: number): Film {
  const rng = seededRandom(seed);
  const n = makeNoise2(seed ^ 0x57a4c4);
  // Landmasses as closed contours in sheet space — the chart's ink.
  const lands: Float32Array[] = [];
  for (let l = 0; l < 4; l++) {
    const lx = -0.55 + rng() * 1.1;
    const ly = -0.5 + rng() * 1;
    const rad = 0.13 + rng() * 0.18;
    const wob = 0.35 + rng() * 0.5;
    const ph = rng() * TAU;
    const pts = new Float32Array(LAND_STOPS * 2);
    for (let i = 0; i < LAND_STOPS; i++) {
      const t = (i / LAND_STOPS) * TAU;
      const rr =
        rad *
        (1 +
          wob *
            (fbm(n, Math.cos(t + ph) * 1.5 + l * 6.3, Math.sin(t + ph) * 1.5 + l * 2.1, 3) - 0.5));
      pts[i * 2] = lx + Math.cos(t) * rr * 1.3;
      pts[i * 2 + 1] = ly + Math.sin(t) * rr;
    }
    lands.push(pts);
  }
  // Each star keeps a seat on the sheet. The bright ones are the settlements
  // the cartographer marked, and those are the ones that become suns.
  const stars: Array<{ a: number; b: number; mag: number; warm: boolean; ph: number }> = [];
  for (let i = 0; i < STARCHART_STARS; i++) {
    stars.push({
      a: -1 + rng() * 2,
      b: -1 + rng() * 2,
      mag: rng(),
      warm: rng() > 0.87,
      ph: rng() * TAU,
    });
  }
  const glowSprite = makeGlowSprite(PAPER, CANDLE, 0.45);
  // Constellation lines: each bright star to its nearest bright neighbour,
  // measured in the sky the film lands on — computed once, at build time.
  const bright: number[] = [];
  for (let i = 0; i < stars.length; i++) if (stars[i].mag > 0.88) bright.push(i);
  const skyX = (s: { a: number; b: number }) => Math.sin(s.a * Math.PI) * (0.05 + (s.b + 1) * 0.23);
  const skyY = (s: { a: number; b: number }) => -Math.cos(s.a * Math.PI) * (0.05 + (s.b + 1) * 0.23);
  const links: Array<[number, number]> = [];
  for (const i of bright) {
    let best = -1;
    let bestD = Infinity;
    for (const j of bright) {
      if (j === i) continue;
      const d = (skyX(stars[i]) - skyX(stars[j])) ** 2 + (skyY(stars[i]) - skyY(stars[j])) ** 2;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    if (best < 0) continue;
    const p = Math.min(i, best);
    const q = Math.max(i, best);
    if (!links.some(([x, y]) => x === p && y === q)) links.push([p, q]);
  }

  // One scratch point — the projection runs some hundreds of times a frame
  // and must not allocate.
  const P = { x: 0, y: 0 };

  const renderFrame = (ctx: CanvasRenderingContext2D, w: number, h: number, u: number): void => {
    const m = Math.min(w, h);
    const morph = easeInOut(smoothstep(0.05, 0.9, u));
    const dark = smoothstep(0.15, 0.6, u);
    const spin = morph * 0.42;

    /** Sheet coordinates → screen, bent from the flat chart to the dome.
     * The sheet's two vertical edges meet at the antimeridian, so the sky
     * closes: a full turn, not a fan with a seam left open in it. */
    const project = (a: number, b: number): void => {
      const az = a * Math.PI + spin;
      const rho = (0.05 + (b + 1) * 0.23) * m;
      P.x = lerp(w / 2 + a * w * 0.52, w / 2 + Math.sin(az) * rho, morph);
      P.y = lerp(h / 2 + b * h * 0.52, h / 2 - Math.cos(az) * rho, morph);
    };

    ctx.fillStyle = rgba(mix(PAPER, NIGHT, dark), 1);
    ctx.fillRect(0, 0, w, h);
    const paper = 1 - dark;
    if (paper > 0.02) {
      ctx.fillStyle = rgba(SEA, 0.1 * paper);
      ctx.fillRect(0, 0, w, h);
    }

    // Land: filled while there is paper to fill, then only its ink coast,
    // then nothing but the sky it was bent into.
    // The ink has to be gone before the sheet's two edges meet, or a coast
    // that straddles the antimeridian draws a chord across the whole sky.
    const landA = (1 - smoothstep(0.1, 0.42, u)) * 0.9;
    const coastA = (1 - smoothstep(0.2, 0.54, u)) * 0.85;
    if (landA > 0.01 || coastA > 0.01) {
      for (const pts of lands) {
        ctx.beginPath();
        for (let i = 0; i < LAND_STOPS; i++) {
          project(pts[i * 2], pts[i * 2 + 1]);
          if (i === 0) ctx.moveTo(P.x, P.y);
          else ctx.lineTo(P.x, P.y);
        }
        ctx.closePath();
        if (landA > 0.01) {
          ctx.fillStyle = rgba(mix(PAPER2, KEPT, 0.34), landA);
          ctx.fill();
        }
        if (coastA > 0.01) {
          ctx.strokeStyle = rgba(mix(INK, PAPER, morph * 0.7), coastA);
          ctx.lineWidth = Math.max(1, m * 0.003);
          ctx.stroke();
        }
      }
    }

    // The graticule is the one thing that survives the crossing intact:
    // ruled in ink on the paper, ruled in light on the sky, bent between.
    ctx.strokeStyle = rgba(mix(INK, mix(PAPER, CANDLE, 0.35), morph), lerp(0.3, 0.17, morph));
    ctx.lineWidth = 1;
    for (let i = 0; i < STARCHART_MERIDIANS; i++) {
      const a = -1 + (2 * i) / (STARCHART_MERIDIANS - 1);
      ctx.beginPath();
      for (let k = 0; k <= 20; k++) {
        project(a, -1 + (2 * k) / 20);
        if (k === 0) ctx.moveTo(P.x, P.y);
        else ctx.lineTo(P.x, P.y);
      }
      ctx.stroke();
    }
    for (let j = 0; j < STARCHART_PARALLELS; j++) {
      const b = -1 + (2 * j) / (STARCHART_PARALLELS - 1);
      ctx.beginPath();
      for (let k = 0; k <= 40; k++) {
        project(-1 + (2 * k) / 40, b);
        if (k === 0) ctx.moveTo(P.x, P.y);
        else ctx.lineTo(P.x, P.y);
      }
      ctx.stroke();
    }

    // The marks. Ink first, light after — and the faint ones were never on
    // the chart at all, they only need the paper out of the way.
    for (const s of stars) {
      const isMark = s.mag > 0.72;
      const inkA = isMark ? (1 - smoothstep(0.2, 0.55, u)) * 0.7 : 0;
      const lightA =
        smoothstep(isMark ? 0.25 : 0.42, isMark ? 0.62 : 0.9, u) * (0.35 + 0.65 * s.mag);
      if (inkA <= 0.01 && lightA <= 0.01) continue;
      project(s.a, s.b);
      if (inkA > 0.01) {
        ctx.fillStyle = rgba(INK, inkA);
        ctx.fillRect(P.x - 1, P.y - 1, 2, 2);
      }
      if (lightA > 0.01) {
        const r = 0.6 + s.mag * 1.5;
        const tw = 0.72 + 0.28 * Math.sin(s.ph + u * 8);
        ctx.fillStyle = rgba(s.warm ? CANDLE : PAPER, lightA * tw);
        ctx.fillRect(P.x - r / 2, P.y - r / 2, r, r);
      }
    }

    const glowA = smoothstep(0.6, 0.95, u);
    if (glowA > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const i of bright) {
        project(stars[i].a, stars[i].b);
        blitGlow(ctx, glowSprite, P.x, P.y, m * 0.022 * (0.6 + stars[i].mag), 0.35 * glowA);
      }
      ctx.restore();
    }

    // And the same hand rules lines between them — a coastline of suns.
    const linkA = smoothstep(0.72, 0.98, u);
    if (linkA > 0.01) {
      ctx.strokeStyle = rgba(mix(PAPER, CANDLE, 0.35), 0.22 * linkA);
      ctx.lineWidth = 1;
      for (const [a, b] of links) {
        project(stars[a].a, stars[a].b);
        const x0 = P.x;
        const y0 = P.y;
        project(stars[b].a, stars[b].b);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(P.x, P.y);
        ctx.stroke();
      }
    }
  };

  return { renderFrame };
}

const LAMINA_VEINS = 9;

/**
 * tissue ↔ flowers — "lamina": a sheet of cells resolving into the leaf it
 * is a slice of.
 *   u = 0   the mosaic fills the frame — adhered cells with their membranes,
 *           the tissue room's own material
 *   u ≈ 0.5 veins arrive through the mosaic: the sheet turns out to be
 *           plumbed, and the plumbing has a direction
 *   u = 1   one blade in the garden's light, its cells still there as grain
 * Nothing cross-fades: the same cells are on screen the whole way, they
 * simply stop being the subject.
 */
function makeLaminaFilm(seed: number): Film {
  const rng = seededRandom(seed);
  /** Half the blade's width at t ∈ [0, 1] from tip to base — lanceolate. */
  const halfW = (t: number) => 0.58 * Math.pow(Math.sin(Math.PI * clamp01(t)), 0.72);
  const cells: Array<{ x: number; y: number; r: number; tint: number }> = [];
  for (let row = 0; row < 21; row++) {
    const ly = -1 + (row / 20) * 2;
    const half = halfW((ly + 1) / 2);
    for (let col = -6; col <= 6; col++) {
      const lx = col * 0.1 + (row % 2 === 0 ? 0.05 : -0.05);
      if (Math.abs(lx) > half - 0.035) continue;
      // Jittered, and each its own size: a mosaic, not graph paper.
      cells.push({
        x: lx + (rng() - 0.5) * 0.03,
        y: ly + (rng() - 0.5) * 0.03,
        r: 0.036 + rng() * 0.016,
        tint: rng(),
      });
    }
  }
  const veins = Array.from({ length: LAMINA_VEINS }, (_, i) => ({
    t: 0.2 + (i / (LAMINA_VEINS - 1)) * 0.62,
    side: i % 2 === 0 ? 1 : -1,
    reach: 0.74 + rng() * 0.2,
  }));
  const neighbours = Array.from({ length: 3 }, () => ({
    x: rng(),
    y: 0.1 + rng() * 0.8,
    r: 0.2 + rng() * 0.2,
    ang: (rng() - 0.5) * 1.4,
  }));
  const bloomHint = { x: 0.18 + rng() * 0.16, y: 0.16 + rng() * 0.14, ph: rng() * TAU };

  const renderFrame = (ctx: CanvasRenderingContext2D, w: number, h: number, u: number): void => {
    const m = Math.min(w, h);
    const open = smoothstep(0.15, 0.8, u);
    const zoom = lerp(6.2, 1, easeInOut(smoothstep(0.05, 0.95, u)));
    const S = m * 0.46 * zoom;
    const cx = w / 2;
    const cy = h / 2;

    ctx.fillStyle = rgba(mix(NIGHT, LEAF_DEEP, smoothstep(0.3, 0.95, u)), 1);
    ctx.fillRect(0, 0, w, h);

    // Out-of-focus neighbours: the garden this blade is one leaf of.
    const nbA = smoothstep(0.68, 0.98, u);
    if (nbA > 0.01) {
      for (const nb of neighbours) {
        ctx.save();
        ctx.translate(nb.x * w, nb.y * h);
        ctx.rotate(nb.ang);
        ctx.fillStyle = rgba(mix(LEAF_DEEP, NIGHT, 0.35), 0.5 * nbA);
        ctx.beginPath();
        ctx.ellipse(0, 0, nb.r * m * 0.5, nb.r * m, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
      drawBloom(
        ctx,
        bloomHint.x * w,
        bloomHint.y * h,
        m * 0.11,
        mix(CANDLE, PAPER, 0.3),
        0.4 * nbA,
        bloomHint.ph + u,
      );
    }

    // The blade: the substrate the cells were always sitting in, becoming
    // chlorophyll as the frame widens enough to show what it is.
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const x = cx + halfW(t) * S;
      const y = cy + (-1 + t * 2) * S;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = 40; i >= 0; i--) {
      const t = i / 40;
      ctx.lineTo(cx - halfW(t) * S, cy + (-1 + t * 2) * S);
    }
    ctx.closePath();
    ctx.fillStyle = rgba(mix(mix(AURORA, NIGHT, 0.86), mix(LEAF, LEAF_DEEP, 0.4), open), 1);
    ctx.fill();
    if (open > 0.2) {
      ctx.strokeStyle = rgba(mix(LEAF, PAPER, 0.35), 0.45 * open);
      ctx.lineWidth = Math.max(1, m * 0.003);
      ctx.stroke();
    }

    // The cells — cull what the zoom has pushed off the frame.
    const cellStroke = mix(PAPER, AURORA, 0.3);
    for (const c of cells) {
      const x = cx + c.x * S;
      const y = cy + c.y * S;
      const r = c.r * S;
      if (x + r < 0 || x - r > w || y + r < 0 || y - r > h) continue;
      ctx.fillStyle = rgba(
        mix(mix(AURORA, NIGHT, 0.78), mix(LEAF, PAPER, 0.1 + c.tint * 0.2), open),
        lerp(0.5, 0.32, open),
      );
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      if (r > 1.4) {
        ctx.strokeStyle = rgba(cellStroke, (0.55 - open * 0.32) * clamp01(r / 3));
        ctx.lineWidth = Math.max(0.8, m * 0.004 * zoom * 0.2);
        ctx.stroke();
      }
    }

    // The plumbing: midrib first, then the secondaries out to the margin.
    const veinA = smoothstep(0.28, 0.72, u);
    if (veinA > 0.01) {
      const veinCol = mix(PAPER, LEAF, 0.45);
      ctx.strokeStyle = rgba(veinCol, 0.55 * veinA);
      ctx.lineWidth = Math.max(1.2, m * 0.006 * Math.min(2.2, zoom));
      ctx.beginPath();
      ctx.moveTo(cx, cy - S * 0.97);
      ctx.lineTo(cx, cy + S * 0.97);
      ctx.stroke();
      ctx.lineWidth = Math.max(0.9, m * 0.003 * Math.min(2.2, zoom));
      for (let i = 0; i < veins.length; i++) {
        const v = veins[i];
        const reach = clamp01(veinA * (veins.length + 1) - i);
        if (reach <= 0.02) continue;
        const t2 = Math.max(0.04, v.t - 0.16);
        const y0 = cy + (-1 + v.t * 2) * S;
        const x1 = cx + v.side * halfW(t2) * v.reach * S * reach;
        const y1 = cy + (-1 + t2 * 2) * S;
        ctx.strokeStyle = rgba(veinCol, 0.4 * reach * veinA);
        ctx.beginPath();
        ctx.moveTo(cx, y0);
        ctx.quadraticCurveTo(cx + (x1 - cx) * 0.5, y0 - S * 0.04, x1, y1);
        ctx.stroke();
      }
    }
  };

  return { renderFrame };
}

/**
 * drop ↔ coast — "tension": one bead among a shoreline of them. The bead's
 * own rim IS the shoreline; it only has to grow until the curvature is the
 * sea's instead of a drop's.
 *   u = 0   one drop, held together by its surface, filling the frame
 *   u ≈ 0.5 it is one bead among others left on wet sand
 *   u = 1   the same curve at the sea's radius — the swash line, foamed,
 *           with the same water inside it
 */
function makeTensionFilm(seed: number): Film {
  const rng = seededRandom(seed);
  const swash = makeSwash(seed);
  const dropSprite = makeGlowSprite(DROP_CORE, DROP_RIM, 0.4);
  const beads = Array.from({ length: 15 }, () => ({
    x: 0.06 + rng() * 0.88,
    y: 0.5 + rng() * 0.46,
    r: 0.007 + rng() * 0.02,
    at: rng(),
  }));
  const foam = Array.from({ length: 44 }, () => ({ t: rng(), off: rng(), ph: rng() * TAU }));
  const glint = Array.from({ length: 30 }, () => ({ t: rng(), d: rng(), ph: rng() * TAU }));
  const grain = Array.from({ length: 120 }, () => ({ x: rng(), y: rng(), s: rng() }));

  const renderFrame = (ctx: CanvasRenderingContext2D, w: number, h: number, u: number): void => {
    const m = Math.min(w, h);
    const grow = easeInOut(smoothstep(0.06, 0.94, u));
    const R = lerp(m * 0.33, m * 7.2, grow);
    const cx = w / 2;
    const cy = lerp(h * 0.5 + m * 0.33, h * 0.42, grow) - R;
    const sea = smoothstep(0.28, 0.9, u);
    /** The water's edge at this x — the bead's limb, wherever it has got to. */
    const limbY = (x: number): number => {
      const dx = x - cx;
      return dx * dx >= R * R ? Infinity : cy + Math.sqrt(R * R - dx * dx);
    };

    ctx.fillStyle = rgba(mix(NIGHT, SAND, sea), 1);
    ctx.fillRect(0, 0, w, h);
    // Sand is grained, and the band nearest the water stays wet — but only
    // the sand: an overlay across the whole frame would tint the sea too.
    if (sea > 0.05) {
      for (const gr of grain) {
        const gy = gr.y * h;
        const gx = gr.x * w;
        if (gy < limbY(gx)) continue;
        ctx.fillStyle = rgba(gr.s > 0.6 ? WET_SAND : mix(SAND, PAPER, 0.3), 0.3 * sea * gr.s);
        ctx.fillRect(gx, gy, 1 + gr.s, 1 + gr.s);
      }
      ctx.fillStyle = rgba(WET_SAND, 0.4 * sea);
      ctx.beginPath();
      for (let i = 0; i <= 48; i++) {
        const x = (i / 48) * w;
        const y = limbY(x);
        ctx.lineTo(x, isFinite(y) ? y : h);
      }
      for (let i = 48; i >= 0; i--) {
        const x = (i / 48) * w;
        const y = limbY(x);
        ctx.lineTo(x, (isFinite(y) ? y : h) + h * 0.12);
      }
      ctx.closePath();
      ctx.fill();
    }

    // The bead. Its rim takes the shore's wobble only once it is wide enough
    // for a wobble to mean anything.
    const wob = m * 0.028 * smoothstep(0.3, 1, u);
    ctx.beginPath();
    for (let i = 0; i <= 84; i++) {
      const th = (i / 84) * TAU;
      const rr = R + wob * swash(i / 84, u) * 2;
      const x = cx + Math.sin(th) * rr;
      const y = cy + Math.cos(th) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = rgba(mix(DROP_CORE, mix(SEA, SKY_LOW, 0.22), sea), lerp(0.45, 0.94, sea));
    ctx.fill();
    ctx.strokeStyle = rgba(mix(PAPER, DROP_CORE, 0.4), 0.45 + 0.3 * sea);
    ctx.lineWidth = Math.max(1.2, m * 0.005);
    ctx.stroke();

    // While it is still a bead: its own light, and the one highlight that
    // says a curved surface is holding it.
    if (R < m * 1.4) {
      const beadA = 1 - smoothstep(0.2, 0.62, u);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      blitGlow(ctx, dropSprite, cx, cy, R * 1.25, 0.5 * beadA);
      ctx.restore();
      if (beadA > 0.01) {
        ctx.fillStyle = rgba(PAPER, 0.55 * beadA);
        ctx.beginPath();
        ctx.ellipse(cx - R * 0.3, cy - R * 0.32, R * 0.15, R * 0.08, -0.6, 0, TAU);
        ctx.fill();
      }
    }

    // The shoreline of beads it turns out to be one of.
    const beadIn = smoothstep(0.26, 0.72, u);
    if (beadIn > 0.01) {
      for (const b of beads) {
        const a = clamp01(beadIn * 2 - b.at * 0.9) * (1 - smoothstep(0.92, 1, u) * 0.3);
        if (a <= 0.02) continue;
        const bx = b.x * w;
        const by = b.y * h;
        if (by < limbY(bx) + m * 0.01) continue; // beads live on the sand
        const br = b.r * m;
        ctx.fillStyle = rgba(mix(DROP_CORE, SAND, 0.3), 0.5 * a);
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, TAU);
        ctx.fill();
        ctx.fillStyle = rgba(PAPER, 0.5 * a);
        ctx.beginPath();
        ctx.arc(bx - br * 0.3, by - br * 0.32, Math.max(0.5, br * 0.22), 0, TAU);
        ctx.fill();
      }
    }

    // Foam where the water's edge lands, and glitter on what it opens onto.
    const foamA = smoothstep(0.45, 0.85, u);
    if (foamA > 0.01) {
      for (const f of foam) {
        const x = f.t * w;
        const y = limbY(x);
        if (!isFinite(y)) continue;
        const tw = 0.45 + 0.45 * Math.sin(f.ph + u * 7);
        ctx.fillStyle = rgba(PAPER, foamA * tw * 0.7);
        ctx.beginPath();
        ctx.arc(x, y + (f.off - 0.5) * m * 0.024, 0.8 + f.off * 2, 0, TAU);
        ctx.fill();
      }
    }
    const glitA = smoothstep(0.55, 0.95, u);
    if (glitA > 0.01) {
      for (const g of glint) {
        const x = g.t * w;
        const y0 = limbY(x);
        if (!isFinite(y0)) continue;
        const tw = 0.5 + 0.5 * Math.sin(g.ph + u * 9);
        ctx.fillStyle = rgba(PAPER, glitA * tw * 0.45 * (1 - g.d));
        ctx.fillRect(x, y0 - h * 0.02 - g.d * h * 0.3, 1.6, 1.6);
      }
    }
  };

  return { renderFrame };
}

const DEW_PETALS = 7;

/**
 * drop ↔ flowers — "dew": the bead settles onto a petal. The scale graph's
 * own reason for this door, drawn: "a petal is tissue before it is one cell;
 * dew gathers on them too" (TRAVEL_OVERRIDES, src/lib/scale.ts).
 *   u = 0   the drop, filling the frame
 *   u ≈ 0.6 it has shrunk to a bead resting on a petal, flattened a little
 *           where it wets it, with the petal's edge running backwards
 *           through it — a lens does that
 *   u = 1   the bloom is open and beaded all along its margins
 */
function makeDewFilm(seed: number): Film {
  const rng = seededRandom(seed);
  const dropSprite = makeGlowSprite(DROP_CORE, DROP_RIM, 0.4);
  const petalCols: RGB[] = [
    mix(CANDLE, PAPER, 0.3),
    mix(KEPT, PAPER, 0.38),
    mix([180, 90, 110] as RGB, PAPER, 0.32),
  ];
  const petals = Array.from({ length: DEW_PETALS }, (_, i) => ({
    ang: -0.95 + (i / (DEW_PETALS - 1)) * 1.9 + (rng() - 0.5) * 0.12,
    len: 0.72 + rng() * 0.22,
    wid: 0.12 + rng() * 0.05,
    col: petalCols[i % petalCols.length],
  }));
  const behind = Array.from({ length: 4 }, () => ({
    x: rng(),
    y: 0.12 + rng() * 0.5,
    r: 0.07 + rng() * 0.07,
    col: petalCols[Math.floor(rng() * petalCols.length)],
    ph: rng() * TAU,
  }));
  const restIdx = Math.floor(DEW_PETALS / 2);
  const dew = Array.from({ length: 9 }, () => ({
    p: Math.floor(rng() * DEW_PETALS),
    t: 0.4 + rng() * 0.5,
    side: rng() > 0.5 ? 1 : -1,
    r: 0.008 + rng() * 0.013,
    at: rng(),
  }));

  const renderFrame = (ctx: CanvasRenderingContext2D, w: number, h: number, u: number): void => {
    const m = Math.min(w, h);
    const settle = easeInOut(smoothstep(0.08, 0.86, u));
    const open = smoothstep(0.2, 0.8, u);
    const fx = w / 2;
    const fy = h * 1.02;

    /** A point on a petal, in screen space: t along the axis, s across it. */
    const petalPoint = (i: number, t: number, s: number, out: { x: number; y: number }): void => {
      const p = petals[i];
      const L = p.len * m * Math.max(0.02, open);
      const half = p.wid * m * Math.max(0.02, open) * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));
      const lx = s * half;
      const ly = -L * t;
      out.x = fx + lx * Math.cos(p.ang) - ly * Math.sin(p.ang);
      out.y = fy + lx * Math.sin(p.ang) + ly * Math.cos(p.ang);
    };
    const A = { x: 0, y: 0 };

    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgba(mix(NIGHT, mix(LEAF_DEEP, LEAF, 0.3), open * 0.9), 1));
    g.addColorStop(1, rgba(mix(NIGHT, LEAF_DEEP, open * 0.8), 1));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // The rest of the bed, out of focus behind it.
    if (open > 0.05) {
      for (const b of behind) {
        drawBloom(ctx, b.x * w, b.y * h, b.r * m * open, b.col, 0.3 * open, b.ph + u * 0.6);
      }
    }

    // The bloom opens under the bead.
    if (open > 0.03) {
      for (const p of petals) {
        const L = p.len * m * open;
        ctx.save();
        ctx.translate(fx, fy);
        ctx.rotate(p.ang);
        ctx.fillStyle = rgba(p.col, 0.9 * open);
        ctx.beginPath();
        ctx.ellipse(0, -L * 0.5, p.wid * m * open, L * 0.5, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = rgba(mix(p.col, PAPER, 0.45), 0.5 * open);
        ctx.lineWidth = Math.max(0.8, m * 0.002);
        ctx.stroke();
        ctx.restore();
      }
      ctx.fillStyle = rgba(mix(KEPT, CANDLE, 0.4), 0.9 * open);
      ctx.beginPath();
      ctx.arc(fx, fy, m * 0.05 * open, 0, TAU);
      ctx.fill();
    }

    // The bead, from the whole frame down to a rest on the petal's edge.
    petalPoint(restIdx, 0.62, 0.9, A);
    const R = lerp(m * 0.33, m * 0.055, settle);
    const bx = lerp(w / 2, A.x, settle);
    const by = lerp(h / 2, A.y, settle);
    const squash = 1 - 0.2 * settle; // surface tension, resting on wax

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    blitGlow(ctx, dropSprite, bx, by, R * 1.3, 0.5);
    ctx.restore();
    ctx.fillStyle = rgba(DROP_CORE, 0.32);
    ctx.beginPath();
    ctx.ellipse(bx, by, R, R * squash, 0, 0, TAU);
    ctx.fill();

    // What a bead does to what is behind it: the petal, inverted through it.
    const lens = smoothstep(0.4, 0.8, u);
    if (lens > 0.02) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(bx, by, R * 0.94, R * squash * 0.94, 0, 0, TAU);
      ctx.clip();
      const p = petals[restIdx];
      const L = p.len * m * Math.max(0.02, open);
      ctx.translate(bx, by);
      ctx.rotate(Math.PI);
      ctx.translate(-bx, -by);
      ctx.save();
      ctx.translate(fx, fy);
      ctx.rotate(p.ang);
      ctx.fillStyle = rgba(mix(p.col, PAPER, 0.3), 0.75 * lens);
      ctx.beginPath();
      ctx.ellipse(0, -L * 0.5, p.wid * m * Math.max(0.02, open), L * 0.5, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
      ctx.restore();
    }

    ctx.strokeStyle = rgba(mix(PAPER, DROP_CORE, 0.5), 0.55);
    ctx.lineWidth = Math.max(1, m * 0.004);
    ctx.beginPath();
    ctx.ellipse(bx, by, R, R * squash, 0, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = rgba(PAPER, 0.6);
    ctx.beginPath();
    ctx.ellipse(bx - R * 0.32, by - R * 0.34, R * 0.16, R * 0.09, -0.6, 0, TAU);
    ctx.fill();

    // The rest of the night's dew, gathered along the margins.
    const dewIn = smoothstep(0.5, 0.95, u);
    if (dewIn > 0.01) {
      for (const d of dew) {
        const a = clamp01(dewIn * 2 - d.at);
        if (a <= 0.02) continue;
        petalPoint(d.p, d.t, d.side * 0.92, A);
        const r = d.r * m;
        ctx.fillStyle = rgba(DROP_CORE, 0.35 * a);
        ctx.beginPath();
        ctx.arc(A.x, A.y, r, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = rgba(mix(PAPER, DROP_CORE, 0.5), 0.5 * a);
        ctx.lineWidth = Math.max(0.7, m * 0.002);
        ctx.stroke();
        ctx.fillStyle = rgba(PAPER, 0.55 * a);
        ctx.beginPath();
        ctx.arc(A.x - r * 0.3, A.y - r * 0.32, Math.max(0.5, r * 0.24), 0, TAU);
        ctx.fill();
      }
    }
  };

  return { renderFrame };
}

const FLOCK_N = 34;

/**
 * flowers ↔ birds — "lift": pollinator to flyer. The garden's own visitor is
 * the first bird, and the frame follows it up.
 *   u = 0   the bed, close: blooms filling the frame and one pollinator
 *           holding station over them, wings a blur
 *   u ≈ 0.5 the ground falls away; the beat slows into a wingbeat
 *   u = 1   sky, and the flyer is one of a flock that has taken the frame
 */
function makeLiftFilm(seed: number): Film {
  const rng = seededRandom(seed);
  const bloomCols: RGB[] = [
    mix(CANDLE, PAPER, 0.25),
    mix(KEPT, PAPER, 0.35),
    mix([180, 90, 110] as RGB, PAPER, 0.3),
    mix(AURORA, PAPER, 0.4),
  ];
  const blooms = Array.from({ length: 12 }, (_, i) => ({
    x: rng(),
    y: rng(),
    r: 0.035 + rng() * 0.055,
    col: bloomCols[i % bloomCols.length],
    ph: rng() * TAU,
  }));
  const flock = Array.from({ length: FLOCK_N }, (_, i) => ({
    // The pollinator holds station over the bed; the rest are still in it.
    x0: i === 0 ? 0.5 : 0.24 + rng() * 0.52,
    y0: i === 0 ? 0.28 : 0.42 + rng() * 0.4,
    seatA: rng() * TAU,
    seatR: 0.06 + rng() * 0.3,
    lag: i === 0 ? 0 : 0.06 + rng() * 0.55,
    ph: rng() * TAU,
    freq: i === 0 ? 96 : 22 + rng() * 14,
    size: i === 0 ? 1.5 : 0.6 + rng() * 0.7,
  }));

  const renderFrame = (ctx: CanvasRenderingContext2D, w: number, h: number, u: number): void => {
    const m = Math.min(w, h);
    const rise = easeInOut(smoothstep(0.05, 0.92, u));

    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgba(mix([132, 156, 150], SKY_HIGH, rise), 1));
    g.addColorStop(0.6, rgba(mix([120, 142, 104], SKY_LOW, rise), 1));
    g.addColorStop(1, rgba(mix(LEAF_DEEP, mix(SKY_LOW, LEAF_DEEP, 0.4), rise), 1));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // The ground lets go — late, and all at once, the way it does when the
    // thing you were watching decides to leave.
    const groundY = lerp(h * 0.34, h * 1.2, easeInOut(smoothstep(0.24, 0.98, u)));
    if (groundY < h) {
      ctx.fillStyle = rgba(mix(LEAF, LEAF_DEEP, 0.45), 1);
      ctx.beginPath();
      ctx.moveTo(0, groundY + h * 0.03);
      ctx.quadraticCurveTo(w * 0.3, groundY - h * 0.04, w * 0.58, groundY + h * 0.01);
      ctx.quadraticCurveTo(w * 0.82, groundY + h * 0.05, w, groundY - h * 0.02);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fill();
    }
    for (const b of blooms) {
      const by = groundY + b.y * h * 0.34;
      if (by > h + m * 0.1) continue;
      drawBloom(
        ctx,
        b.x * w,
        by,
        b.r * m * (1 - rise * 0.72),
        b.col,
        0.95 * (1 - smoothstep(0.6, 0.95, u) * 0.7),
        b.ph + u * 0.8,
      );
    }

    // The flock: seats found late, and the first flyer's buzz slowing into
    // a wingbeat as it stops hovering and starts travelling.
    const spin = u * 0.5;
    const flockX = w / 2;
    const flockY = lerp(h * 0.44, h * 0.38, rise);
    const birdCol = mix(INK, SKY_HIGH, 0.3);
    for (let i = 0; i < flock.length; i++) {
      const b = flock[i];
      const first = i === 0;
      const tt = clamp01((rise - b.lag * 0.6) / (1 - b.lag * 0.6));
      const e = easeInOut(tt);
      const sx = flockX + Math.cos(b.seatA + spin) * b.seatR * w * 0.9;
      const sy = flockY + Math.sin(b.seatA + spin) * b.seatR * h * 0.42;
      const x = lerp(b.x0 * w, sx, e);
      const y = lerp(b.y0 * h, sy, e);
      // Frequency falls with u; the phase is its integral, so the beat is
      // continuous and still a pure function of u.
      const flap = Math.sin(b.ph + u * b.freq * (1 - 0.45 * u));
      const span = m * 0.024 * b.size * lerp(first ? 2.4 : 1.5, 1, rise);
      // Only the pollinator is there at the start; the rest are found on
      // the way up, and a bird that has not left yet is not yet a bird.
      const alpha = first ? 1 : smoothstep(0.12, 0.5, tt) * 0.95;
      drawBird(ctx, x, y, span, flap, birdCol, alpha);
      if (first) {
        // Its body, while it is still close enough to have one.
        ctx.fillStyle = rgba(birdCol, 0.85);
        ctx.beginPath();
        ctx.ellipse(x, y + span * 0.1, span * 0.3, span * 0.16, 0, 0, TAU);
        ctx.fill();
      }
    }
  };

  return { renderFrame };
}

/**
 * birds ↔ coast — "shorewing": the flock over the shoreline, resolving into
 * the coast's own scale.
 *   u = 0   the flock, close enough that a wing is a gesture of the frame
 *   u = 1   the shore has arrived beneath them: the swash line, the wet
 *           sheen, the same birds now a thread of specks strung along it
 *           with their reflections under them
 * The swash comes through the shared makeSwash, so this shoreline and the
 * one the drop's rim becomes are the same shoreline.
 */
function makeShorewingFilm(seed: number): Film {
  const rng = seededRandom(seed);
  const swash = makeSwash(seed);
  const flock = Array.from({ length: 24 }, () => ({
    x0: 0.1 + rng() * 0.8,
    y0: 0.12 + rng() * 0.72,
    x1: 0.08 + rng() * 0.84,
    y1: 0.1 + rng() * 0.34,
    ph: rng() * TAU,
    freq: 20 + rng() * 12,
    size: 0.6 + rng() * 0.8,
  }));
  const foam = Array.from({ length: 46 }, () => ({ t: rng(), off: rng(), ph: rng() * TAU }));
  const shells = Array.from({ length: 18 }, () => ({ x: rng(), y: rng(), r: 0.5 + rng() * 1.6 }));
  const swells = Array.from({ length: 3 }, () => ({ at: 0.58 + rng() * 0.34, ph: rng() * TAU }));
  const sandGrain = Array.from({ length: 90 }, () => ({ x: rng(), y: rng(), s: rng() }));

  const renderFrame = (ctx: CanvasRenderingContext2D, w: number, h: number, u: number): void => {
    const m = Math.min(w, h);
    const back = easeInOut(smoothstep(0.05, 0.92, u));
    // At u = 0 the hand is up among them and there is nothing below but air:
    // the ground arrives through haze, it does not switch on.
    const ground = smoothstep(0.16, 0.62, u);
    const horizonY = lerp(h * 0.9, h * 0.24, back);
    const shoreBase = lerp(h * 2.1, h * 0.66, back);
    const shoreY = (x: number): number => shoreBase + swash(x / Math.max(1, w), u) * h * 0.06;

    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgba(mix([120, 160, 196], SKY_HIGH, back * 0.6), 1));
    g.addColorStop(1, rgba(SKY_LOW, 1));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    if (ground > 0.01) {
      ctx.save();
      ctx.globalAlpha = ground;
      // The sea, between the horizon and the shore.
      if (horizonY < h) {
        ctx.fillStyle = rgba(mix(SEA, [64, 100, 122], 0.3), 1);
        ctx.beginPath();
        ctx.moveTo(0, Math.max(0, horizonY));
        ctx.lineTo(w, Math.max(0, horizonY));
        for (let i = 48; i >= 0; i--) {
          const x = (i / 48) * w;
          ctx.lineTo(x, shoreY(x));
        }
        ctx.closePath();
        ctx.fill();
        // The haze that sits on any real horizon, softening the seam.
        ctx.fillStyle = rgba(mix(SKY_LOW, PAPER, 0.35), 0.3);
        ctx.fillRect(0, Math.max(0, horizonY) - h * 0.008, w, h * 0.016);
        // Swells running in, parallel to the shore they will land on.
        for (const s of swells) {
          const y = lerp(horizonY, shoreBase, s.at + 0.04 * Math.sin(s.ph + u * 2));
          if (y <= horizonY || y >= shoreBase) continue;
          ctx.strokeStyle = rgba(mix(SEA, PAPER, 0.6), 0.4);
          ctx.lineWidth = Math.max(1.4, h * 0.007);
          ctx.beginPath();
          for (let i = 0; i <= 24; i++) {
            const x = (i / 24) * w;
            const yy = y + swash(x / Math.max(1, w) + s.at, u) * h * 0.012;
            if (i === 0) ctx.moveTo(x, yy);
            else ctx.lineTo(x, yy);
          }
          ctx.stroke();
        }
      }

      // The sand, and the wet band that still remembers the last swash.
      ctx.fillStyle = rgba(mix(SAND, WET_SAND, 0.25), 1);
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let i = 0; i <= 48; i++) {
        const x = (i / 48) * w;
        ctx.lineTo(x, shoreY(x));
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = rgba(WET_SAND, 0.4);
      ctx.beginPath();
      for (let i = 0; i <= 48; i++) {
        const x = (i / 48) * w;
        ctx.lineTo(x, shoreY(x));
      }
      for (let i = 48; i >= 0; i--) {
        const x = (i / 48) * w;
        ctx.lineTo(x, shoreY(x) + h * 0.1);
      }
      ctx.closePath();
      ctx.fill();
      for (const gr of sandGrain) {
        const gy = shoreY(gr.x * w) + h * 0.03 + gr.y * h * 0.4;
        if (gy > h) continue;
        ctx.fillStyle = rgba(gr.s > 0.6 ? WET_SAND : mix(SAND, PAPER, 0.35), 0.3 * gr.s);
        ctx.fillRect(gr.x * w, gy, 1 + gr.s, 1 + gr.s);
      }
      ctx.restore();
    }

    const foamA = smoothstep(0.2, 0.7, u) * ground;
    if (foamA > 0.01) {
      for (const f of foam) {
        const x = f.t * w;
        const tw = 0.45 + 0.45 * Math.sin(f.ph + u * 7);
        ctx.fillStyle = rgba(PAPER, foamA * tw * 0.7);
        ctx.beginPath();
        ctx.arc(x, shoreY(x) + (f.off - 0.5) * h * 0.018, 0.8 + f.off * 2.2, 0, TAU);
        ctx.fill();
      }
    }
    const shellA = smoothstep(0.62, 0.98, u) * ground;
    if (shellA > 0.01) {
      for (const s of shells) {
        const x = s.x * w;
        const y = shoreY(x) + h * 0.06 + s.y * h * 0.28;
        if (y > h) continue;
        ctx.fillStyle = rgba(mix(PAPER, SAND, 0.4), 0.5 * shellA);
        ctx.beginPath();
        ctx.arc(x, y, s.r, 0, TAU);
        ctx.fill();
      }
    }

    // The birds, losing the frame to the coast they are flying over.
    const birdCol = mix(INK, SEA, 0.35);
    for (const b of flock) {
      const x = lerp(b.x0 * w, b.x1 * w, back);
      const y = lerp(b.y0 * h, b.y1 * h, back);
      const span = m * lerp(0.07, 0.012, back) * b.size;
      const flap = Math.sin(b.ph + u * b.freq);
      drawBird(ctx, x, y, span, flap, birdCol, 0.9);
      // On the wet sheen, each one is answered from below.
      const sy = shoreY(x);
      const refY = sy + (sy - y) * 0.18;
      if (back > 0.45 && refY < h) {
        drawBird(ctx, x, refY, span * 0.8, -flap, birdCol, 0.16 * smoothstep(0.45, 0.9, u));
      }
    }
  };

  return { renderFrame };
}

const MASSIF_STOPS = 76;

/**
 * olympus ↔ earth — "massif": the peak resolving into the ground it stands
 * on. Explicitly NOT a globe: nothing rotates and no sphere is ever drawn —
 * the HORIZON BENDS, which is the thing a climb actually shows you, and the
 * range that filled the frame becomes one crease along the limb of a world.
 *   u = 0   folded ranges filling the frame under mountain blue
 *   u ≈ 0.5 the horizon has begun to bow; the ranges shrink toward the
 *           middle of it and the blue thins
 *   u = 1   a curved ground with the whole massif as one wrinkle on it,
 *           further ranges beyond, an ice field, the air a rim of light
 */
function makeMassifFilm(seed: number): Film {
  const n = makeNoise2(seed ^ 0x0a5517);
  const ridges = [0, 1, 2].map((r) => foldedRidge(n, MASSIF_STOPS, 2.6 + r * 1.9, r * 13.7 + 3.1));
  const rng = seededRandom(seed ^ 0x9a11);
  const stars = Array.from({ length: 90 }, () => ({ x: rng(), y: rng() * 0.5, r: 0.5 + rng() * 1.1 }));
  const creases = Array.from({ length: 3 }, () => ({
    off: 0.06 + rng() * 0.22,
    span: 0.3 + rng() * 0.5,
    at: 0.1 + rng() * 0.7,
    amp: 0.1 + rng() * 0.5,
  }));
  const clouds = Array.from({ length: 7 }, () => ({
    x: rng(),
    y: rng(),
    len: 0.1 + rng() * 0.2,
    speed: 0.06 + rng() * 0.18,
  }));

  const renderFrame = (ctx: CanvasRenderingContext2D, w: number, h: number, u: number): void => {
    const m = Math.min(w, h);
    const climb = easeInOut(smoothstep(0.05, 0.92, u));
    const bulge = climb * h * 0.19;
    const baseY = lerp(h * 0.66, h * 0.6, climb);
    /** The ground's edge: flat from the summit, bowed from far enough up. */
    const limbY = (x: number): number => {
      const t = (x - w / 2) / (w / 2);
      return baseY - bulge * (1 - t * t);
    };

    // Sky: mountain blue emptying toward the dark it was always in front of.
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgba(mix([96, 138, 180], NIGHT, climb * 0.94), 1));
    g.addColorStop(1, rgba(mix([182, 206, 222], [78, 110, 142], climb), 1));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const starA = smoothstep(0.55, 0.95, u);
    if (starA > 0.01) {
      for (const s of stars) {
        ctx.fillStyle = rgba(PAPER, starA * 0.75 * (1 - s.y));
        ctx.fillRect(s.x * w, s.y * h, s.r, s.r);
      }
    }

    // The ground, and the light its air scatters along the edge of it. Dark
    // rock underfoot at the summit; a lit surface with distance.
    const gg = ctx.createLinearGradient(0, baseY - bulge, 0, h);
    gg.addColorStop(0, rgba(mix([26, 30, 38], mix(GROUND, PAPER, 0.22), climb), 1));
    gg.addColorStop(1, rgba(mix([18, 21, 27], mix(GROUND, NIGHT, 0.25), climb), 1));
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.moveTo(0, h + 2);
    for (let i = 0; i <= 60; i++) {
      const x = (i / 60) * w;
      ctx.lineTo(x, limbY(x));
    }
    ctx.lineTo(w, h + 2);
    ctx.closePath();
    ctx.fill();
    const rimA = smoothstep(0.35, 0.9, u);
    if (rimA > 0.01) {
      ctx.strokeStyle = rgba(mix([150, 190, 210], PAPER, 0.3), 0.45 * rimA);
      ctx.lineWidth = Math.max(1.2, m * 0.006);
      ctx.beginPath();
      for (let i = 0; i <= 60; i++) {
        const x = (i / 60) * w;
        if (i === 0) ctx.moveTo(x, limbY(x));
        else ctx.lineTo(x, limbY(x));
      }
      ctx.stroke();
    }

    // Other ranges, an ice field, weather: the features a whole ground has
    // once one range is no longer the whole of it.
    const farA = smoothstep(0.45, 0.9, u);
    if (farA > 0.01) {
      for (const c of creases) {
        ctx.strokeStyle = rgba(mix(GROUND, NIGHT, 0.45), 0.5 * farA);
        ctx.lineWidth = Math.max(1, m * 0.004);
        ctx.beginPath();
        for (let i = 0; i <= 24; i++) {
          const t = i / 24;
          const x = (c.at + t * c.span) * w;
          const y = limbY(x) + c.off * h + Math.sin(t * 9 + c.amp * 6) * h * 0.012 * c.amp;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.fillStyle = rgba(PAPER, 0.22 * farA);
      ctx.beginPath();
      ctx.ellipse(w * 0.12, limbY(w * 0.12) + h * 0.05, w * 0.16, h * 0.03, 0.32, 0, TAU);
      ctx.fill();
      for (const cl of clouds) {
        const x = ((cl.x + u * cl.speed) % 1.2 - 0.1) * w;
        const y = limbY(x) + cl.y * h * 0.3;
        ctx.fillStyle = rgba(PAPER, 0.22 * farA);
        ctx.beginPath();
        ctx.ellipse(x, y, cl.len * w * 0.5, h * 0.012, 0, 0, TAU);
        ctx.fill();
      }
    }

    // The massif itself: it never leaves the frame, it stops being the whole
    // of it. Each range is a BAND along the ground's edge — a crease with a
    // finite length once there is enough ground for it to be shorter than —
    // so nothing ever stands up as a wall the way a squeezed silhouette does.
    for (let r = 2; r >= 0; r--) {
      const halfSpan = lerp(1.35, 0.34 - r * 0.05, climb); // in sheet widths
      const amp = h * (0.2 + r * 0.06) * lerp(1, 0.13, climb);
      // The layers close on the limb as the distance grows: from three
      // ranges deep at the summit to one crease with a lit and a shaded side.
      const drop = h * (0.02 + r * 0.05) * (1 - climb * 0.86);
      ctx.beginPath();
      for (let i = 0; i < MASSIF_STOPS; i++) {
        const t = i / (MASSIF_STOPS - 1);
        const x = w / 2 + (t * 2 - 1) * (w / 2 + 4);
        // A range tapers to nothing at its own ends, and its ends walk in.
        const s = ((t - 0.5) * 2) / halfSpan;
        const win = Math.max(0, 1 - s * s);
        ctx.lineTo(x, limbY(x) + drop - ridges[r][i] * amp * win * win);
      }
      for (let i = MASSIF_STOPS - 1; i >= 0; i--) {
        const t = i / (MASSIF_STOPS - 1);
        const x = w / 2 + (t * 2 - 1) * (w / 2 + 4);
        const s = ((t - 0.5) * 2) / halfSpan;
        const win = Math.max(0, 1 - s * s);
        // The underside tapers with the crest, so a range that has ended
        // leaves no band of itself lying along the ground.
        ctx.lineTo(x, limbY(x) + drop + h * 0.02 * win);
      }
      ctx.closePath();
      const dark: RGB = r === 2 ? [20, 24, 32] : r === 1 ? [36, 42, 54] : [56, 64, 78];
      ctx.fillStyle = rgba(mix(dark, mix(GROUND, NIGHT, 0.3), climb * 0.55 + (2 - r) * 0.05), 1);
      ctx.fill();
    }
  };

  return { renderFrame };
}

// ——— The top of the axis: a wave field, and what it hardens into ————————
//
// /beyond is an interference field. Both of its doors are drawn from the
// same construction — the crest of two coherent sources is a hyperbola with
// the sources as foci — so the room reads as itself from either side.

const CREST_HALF_LAMBDA = 0.11;
const CREST_KMAX = 18;

/**
 * One point on a hyperbolic crest: the locus where the two sources' paths
 * differ by a fixed number of wavelengths. `a` is half that difference, `c`
 * half the source separation. As c grows the branch straightens toward the
 * line x = a — which is how a wave field becomes a lattice, and the whole
 * argument of the curvature film.
 */
function crestPoint(a: number, b: number, t: number, out: { x: number; y: number }): void {
  out.x = a * Math.cosh(t);
  out.y = b * Math.sinh(t);
}

/**
 * space ↔ beyond — "interfere": the cosmic web read as a standing wave.
 *   u = 0   the web: knots and the filaments between them, as /space keeps
 *           them
 *   u ≈ 0.6 crest lines rise through the frame — and every knot is already
 *           standing on one
 *   u = 1   the field alone, its two sources faintly lit: the spacing
 *           between galaxies was never a scatter, it was a frozen sound
 * The knots are BUILT on the crests at construction, so the reveal is not a
 * coincidence arranged per frame — the web was drawn from the field it
 * turns out to be.
 */
function makeInterfereFilm(seed: number): Film {
  const rng = seededRandom(seed);
  const vignette = makeVignette();
  const knotSprite = makeGlowSprite(PAPER, CANDLE, 0.45);
  const sourceSprite = makeGlowSprite(mix(PAPER, AURORA, 0.4), AURORA, 0.35);
  const C = 1.05;
  const rot = 0.42;
  const levels: number[] = [];
  for (let k = -11; k <= 11; k++) {
    const a = k * CREST_HALF_LAMBDA * 1.35;
    if (Math.abs(a) < C * 0.94) levels.push(a);
  }
  const S = { x: 0, y: 0 };
  const knots = Array.from({ length: 24 }, () => {
    const a = levels[Math.min(levels.length - 1, Math.floor(rng() * levels.length))];
    const t = (rng() - 0.5) * 2.6;
    const b = Math.sqrt(Math.max(0.02, C * C - a * a));
    crestPoint(a, b, t, S);
    return { fx: S.x, fy: S.y, m: 0.4 + rng() * 0.9, ph: rng() * TAU };
  });
  const links: Array<[number, number]> = [];
  for (let i = 0; i < knots.length; i++) {
    const near: Array<{ j: number; d: number }> = [];
    for (let j = 0; j < knots.length; j++) {
      if (j === i) continue;
      near.push({ j, d: (knots[j].fx - knots[i].fx) ** 2 + (knots[j].fy - knots[i].fy) ** 2 });
    }
    near.sort((a, b) => a.d - b.d);
    for (let k = 0; k < 2; k++) {
      const p = Math.min(i, near[k].j);
      const q = Math.max(i, near[k].j);
      if (!links.some(([x, y]) => x === p && y === q)) links.push([p, q]);
    }
  }
  const P = { x: 0, y: 0 };

  const renderFrame = (ctx: CanvasRenderingContext2D, w: number, h: number, u: number): void => {
    const m = Math.min(w, h);
    const cx = w / 2;
    const cy = h / 2;
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    const toScreen = (fx: number, fy: number): void => {
      P.x = cx + (fx * cs - fy * sn) * m * 0.5;
      P.y = cy + (fx * sn + fy * cs) * m * 0.5;
    };

    ctx.fillStyle = rgba(NIGHT, 1);
    ctx.fillRect(0, 0, w, h);

    // The crests arrive through the web, not over it.
    const crestA = smoothstep(0.22, 0.85, u);
    if (crestA > 0.01) {
      const yExtent = (Math.hypot(w, h) / m) * 1.1;
      ctx.lineWidth = 1;
      for (const a of levels) {
        const b = Math.sqrt(Math.max(0.02, C * C - a * a));
        const tMax = Math.min(2.2, Math.asinh(yExtent / b));
        const near = 1 - Math.min(1, Math.abs(a) / C);
        ctx.strokeStyle = rgba(mix(PAPER, AURORA, 0.35), crestA * (0.16 + 0.34 * near));
        ctx.beginPath();
        for (let i = 0; i <= 30; i++) {
          const t = -tMax + (2 * tMax * i) / 30;
          crestPoint(a, b, t, S);
          toScreen(S.x, S.y);
          if (i === 0) ctx.moveTo(P.x, P.y);
          else ctx.lineTo(P.x, P.y);
        }
        ctx.stroke();
      }
    }

    // The filaments let go once what strung them is visible.
    const webA = (1 - smoothstep(0.4, 0.85, u)) * 0.9;
    if (webA > 0.02) {
      ctx.strokeStyle = rgba([140, 176, 206], 0.32 * webA);
      ctx.lineWidth = 1;
      for (const [a, b] of links) {
        toScreen(knots[a].fx, knots[a].fy);
        const x0 = P.x;
        const y0 = P.y;
        toScreen(knots[b].fx, knots[b].fy);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(P.x, P.y);
        ctx.stroke();
      }
    }

    // The knots stay put the whole way: they were antinodes all along.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const pulse = smoothstep(0.45, 0.95, u);
    for (const kn of knots) {
      toScreen(kn.fx, kn.fy);
      const beat = 0.6 + 0.4 * Math.sin(kn.ph + u * 5);
      blitGlow(ctx, knotSprite, P.x, P.y, 5 + kn.m * 10 * (1 + pulse * 0.4), 0.4 + 0.3 * pulse * beat);
    }
    // And the two sources whose difference the whole field is.
    const srcA = smoothstep(0.7, 1, u);
    if (srcA > 0.01) {
      for (const sx of [-C, C]) {
        toScreen(sx, 0);
        blitGlow(ctx, sourceSprite, P.x, P.y, m * 0.1, 0.22 * srcA);
      }
    }
    ctx.restore();

    vignette(ctx, w, h);
  };

  return { renderFrame };
}

/**
 * beyond ↔ manifold — "curvature": amplitude becoming geometry.
 *   u = 0   the wave field of /beyond — the same hyperbolic crests the
 *           interfere film ends on
 *   u ≈ 0.5 the sources walk apart, and every crest straightens as they do
 *           (a hyperbola with distant foci is a line — no cheating, the
 *           same equation with c growing)
 *   u = 1   a mesh, square and ruled, with one mass in it: the exact well
 *           the fold film draws on the space ↔ manifold hop, so /manifold
 *           is entered through the same door from both sides
 */
function makeCurvatureFilm(seed: number): Film {
  const rng = seededRandom(seed);
  const vignette = makeVignette();
  const knotSprite = makeGlowSprite(PAPER, CANDLE, 0.45);
  const massSprite = makeGlowSprite(mix(PAPER, CANDLE, 0.3), CANDLE, 0.4);
  const relics = Array.from({ length: 10 }, () => ({
    fx: (rng() - 0.5) * 2.4,
    fy: (rng() - 0.5) * 2.4,
    m: 0.4 + rng() * 0.8,
  }));
  const S = { x: 0, y: 0 };
  const P = { x: 0, y: 0 };

  const renderFrame = (ctx: CanvasRenderingContext2D, w: number, h: number, u: number): void => {
    const m = Math.min(w, h);
    const cx = w / 2;
    const cy = h / 2;
    const straighten = easeInOut(smoothstep(0.06, 0.9, u));
    const C = lerp(1.05, 30, straighten);
    const rot = 0.42 * (1 - straighten);
    const cross = smoothstep(0.3, 0.88, u);
    const well = 0.12 * smoothstep(0.35, 1, u);
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    const yExtent = (Math.hypot(w, h) / m) * 1.15;

    /** Field → screen, then bent by whatever mass the mesh has taken on —
     * the fold film's displacement, identically. */
    const toScreen = (fx: number, fy: number, swap: boolean): void => {
      const rx = swap ? fy : fx;
      const ry = swap ? fx : fy;
      const x = cx + (rx * cs - ry * sn) * m * 0.5;
      const y = cy + (rx * sn + ry * cs) * m * 0.5;
      if (well <= 0) {
        P.x = x;
        P.y = y;
        return;
      }
      const nx = (x / w - 0.5) * 2;
      const ny = (y / h - 0.5) * 2;
      const pull = well / (0.15 + nx * nx + ny * ny);
      P.x = x - nx * pull * w * 0.35;
      P.y = y - ny * pull * h * 0.35;
    };

    ctx.fillStyle = rgba(NIGHT, 1);
    ctx.fillRect(0, 0, w, h);

    const lineCol = mix(mix(PAPER, AURORA, 0.35), mix(PAPER, CANDLE, 0.2), straighten);
    ctx.lineWidth = 1;
    for (let pass = 0; pass < 2; pass++) {
      const passA = pass === 0 ? 1 : cross;
      if (passA <= 0.01) continue;
      for (let k = -CREST_KMAX; k <= CREST_KMAX; k++) {
        const a = k * CREST_HALF_LAMBDA * lerp(2.6, 1, straighten);
        if (Math.abs(a) >= C * 0.94) continue;
        const b = Math.sqrt(Math.max(0.02, C * C - a * a));
        const tMax = Math.min(2.4, Math.asinh(yExtent / b));
        const near = 1 - Math.min(1, Math.abs(a) / (CREST_KMAX * CREST_HALF_LAMBDA * 2));
        ctx.strokeStyle = rgba(lineCol, passA * (0.09 + 0.16 * near));
        ctx.beginPath();
        for (let i = 0; i <= 26; i++) {
          const t = -tMax + (2 * tMax * i) / 26;
          crestPoint(a, b, t, S);
          toScreen(S.x, S.y, pass === 1);
          if (i === 0) ctx.moveTo(P.x, P.y);
          else ctx.lineTo(P.x, P.y);
        }
        ctx.stroke();
      }
    }

    // The last knots of the web, letting go of their light.
    const relicA = 1 - smoothstep(0.15, 0.6, u);
    if (relicA > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const r of relics) {
        toScreen(r.fx, r.fy, false);
        blitGlow(ctx, knotSprite, P.x, P.y, 5 + r.m * 9, 0.4 * relicA);
      }
      ctx.restore();
    }

    // And the mass the mesh has agreed to carry.
    const massA = smoothstep(0.5, 1, u);
    if (massA > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      blitGlow(ctx, massSprite, cx, cy, m * 0.12, 0.3 * massA);
      ctx.restore();
    }

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
  if (spec.film === "fogclimb") return makeFogClimbFilm(PASSAGE_SEED ^ 0x0f0671);
  if (spec.film === "garden") return makeGardenFilm(PASSAGE_SEED ^ 0x0a7de4);
  if (spec.film === "chartland") return makeChartLandFilm(PASSAGE_SEED ^ 0x0c4a71);
  if (spec.film === "strand") return makeStrandFilm(PASSAGE_SEED ^ 0x057a4d);
  if (spec.film === "fold") return makeFoldFilm(PASSAGE_SEED ^ 0x0f01d0);
  if (spec.film === "quantum") return makeQuantumFilm(PASSAGE_SEED ^ 0x0900a1);
  if (spec.film === "confine") return makeConfineFilm(PASSAGE_SEED ^ 0x0c0f19);
  if (spec.film === "shell") return makeShellFilm(PASSAGE_SEED ^ 0x05e11c);
  if (spec.film === "bond") return makeBondFilm(PASSAGE_SEED ^ 0x0b04d0);
  if (spec.film === "chain") return makeChainFilm(PASSAGE_SEED ^ 0x0c4a1e);
  if (spec.film === "helix") return makeHelixFilm(PASSAGE_SEED ^ 0x0e11c5);
  if (spec.film === "chromatin") return makeChromatinFilm(PASSAGE_SEED ^ 0x0c4084);
  if (spec.film === "membrane") return makeMembraneFilm(PASSAGE_SEED ^ 0x0eeb4a);
  if (spec.film === "sheet") return makeSheetFilm(PASSAGE_SEED ^ 0x05ee70);
  if (spec.film === "dissolve") return makeDissolveFilm(PASSAGE_SEED ^ 0x0d1550);
  if (spec.film === "starchart") return makeStarChartFilm(PASSAGE_SEED ^ 0x057a12);
  if (spec.film === "lamina") return makeLaminaFilm(PASSAGE_SEED ^ 0x01a311);
  if (spec.film === "tension") return makeTensionFilm(PASSAGE_SEED ^ 0x07e1f0);
  if (spec.film === "dew") return makeDewFilm(PASSAGE_SEED ^ 0x0de147);
  if (spec.film === "lift") return makeLiftFilm(PASSAGE_SEED ^ 0x011f70);
  if (spec.film === "shorewing") return makeShorewingFilm(PASSAGE_SEED ^ 0x0540e9);
  if (spec.film === "massif") return makeMassifFilm(PASSAGE_SEED ^ 0x0a5511);
  if (spec.film === "interfere") return makeInterfereFilm(PASSAGE_SEED ^ 0x01e7fe);
  if (spec.film === "curvature") return makeCurvatureFilm(PASSAGE_SEED ^ 0x0c4a7e);
  return makeFilm(PASSAGE_SEED);
}

/**
 * Test-only surface: the node test scripts (scripts/lib/load-ts.mjs) load
 * this module directly and need the pure film factories to assert
 * determinism — they are otherwise internal to makeFilmFor. Never consumed
 * by the app itself. A factory that draws through an offscreen canvas
 * (`makeFilm`, `beads`, `chartland`, `airmap`) cannot be built in node and
 * so cannot be listed here; everything below is pure drawing plus the
 * shared sprite cache, which degrades to no-ops without a document.
 */
export const __pureFilmFactories: Record<string, (seed: number) => Film> = {
  // the astronomical trunk and the ground/vista films
  arm: makeArmFilm,
  node: makeNodeFilm,
  orbitfall: makeOrbitfallFilm,
  sunfall: makeSunfallFilm,
  peakair: makePeakAirFilm,
  fogclimb: makeFogClimbFilm,
  garden: makeGardenFilm,
  strand: makeStrandFilm,
  fold: makeFoldFilm,
  // the small-scale spine, quanta → drop
  quantum: makeQuantumFilm,
  confine: makeConfineFilm,
  shell: makeShellFilm,
  bond: makeBondFilm,
  chain: makeChainFilm,
  helix: makeHelixFilm,
  chromatin: makeChromatinFilm,
  membrane: makeMembraneFilm,
  sheet: makeSheetFilm,
  dissolve: makeDissolveFilm,
  // the chart-to-sky hop, the living middle, and the top of the axis
  starchart: makeStarChartFilm,
  lamina: makeLaminaFilm,
  tension: makeTensionFilm,
  dew: makeDewFilm,
  lift: makeLiftFilm,
  shorewing: makeShorewingFilm,
  massif: makeMassifFilm,
  interfere: makeInterfereFilm,
  curvature: makeCurvatureFilm,
};

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
