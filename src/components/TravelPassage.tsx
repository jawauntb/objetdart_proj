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
 * Architecture: a registry (PASSAGES) keyed by travel edge, consumed by the
 * shared travel execution. Edges without an entry keep the ink fade exactly
 * as before. The overlay must survive the route change (router.push fires
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

// ——— The registry ———————————————————————————————————————————————

export type PassageEdgeKey = "atlas->stars" | "stars->atlas";

export type PassageSpec = {
  /** Full film length, ms. */
  durationMs: number;
  /** Reduced-motion length (three cross-dissolved stills), ms. */
  reducedMs: number;
  /** Fraction of the duration at which router.push fires behind the film. */
  navigateAt: number;
  /** Fraction at which the low bell sounds — planetfall. */
  bellAt: number;
  /** Fraction at which the orbit detent lands in the hand. */
  detentAt: number;
  /** True = the film plays forward (map → planet → stars); false = reversed. */
  out: boolean;
};

export const PASSAGES: Partial<Record<PassageEdgeKey, PassageSpec>> = {
  "atlas->stars": {
    durationMs: 3500,
    reducedMs: 1200,
    navigateAt: 0.55,
    bellAt: 0.4,
    detentAt: 0.62,
    out: true,
  },
  "stars->atlas": {
    durationMs: 3500,
    reducedMs: 1200,
    navigateAt: 0.45,
    bellAt: 0.5,
    detentAt: 0.28,
    out: false,
  },
};

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
 * Play the registered passage for this travel edge, if one exists and the
 * host is mounted. Returns true when the passage owns the transition (the
 * caller must NOT run its own fade/navigation); false = keep the ink fade.
 */
export function playTravelPassage(
  from: ScaleBandId,
  dest: ScaleBand,
  sLand: number,
  navigate: () => void,
): boolean {
  if (typeof window === "undefined" || !hostCue) return false;
  const spec = PASSAGES[`${from}->${dest.id}` as PassageEdgeKey];
  if (!spec) return false;
  const fromBand = SCALE_BANDS.find((b) => b.id === from);
  if (!fromBand) return false;
  hostCue({
    spec,
    sFrom: spec.out ? fromBand.sMax : fromBand.sMin,
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
      const g = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.2);
      g.addColorStop(0, rgba(AURORA, 0));
      g.addColorStop(0.45, rgba([120, 160, 168], 0.22 * atm));
      g.addColorStop(1, rgba(AURORA, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.22, 0, TAU);
      ctx.fill();
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
    const vg = ctx.createRadialGradient(cx, h / 2, m * 0.45, cx, h / 2, diag * 0.62);
    vg.addColorStop(0, rgba(NIGHT, 0));
    vg.addColorStop(1, rgba(NIGHT, 0.35));
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
  }

  return { renderFrame };
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
    const film = ctx ? makeFilm(PASSAGE_SEED) : null;
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
