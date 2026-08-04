"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { onVessel } from "@/lib/vessel";
import LetGo from "@/components/LetGo";
import { useField } from "@/store/field";
import MobileInstrumentPanel from "@/components/MobileInstrumentPanel";
import {
  createFrameGovernor,
  createIdleWriter,
  detailForTier,
  isEmbeddedFrame,
  onGalleryPause,
  onVisibility,
  resolveDpr,
  type QualityTier,
} from "@/lib/room-runtime";

/**
 * /earth — a tactile geologic instrument.
 *
 * The page is a mineral cross-section: optical strata, quartz veins, fault
 * planes, pressure blooms, and a live seismograph. A hand is read as pressure
 * rather than cursor: taps seed mineral evidence, drags shear the strata into
 * faults, a dwell grows a specimen in the rock and keeps deepening it, and a
 * ceremony hold either seals what grew or takes a planted one back.
 *
 * The invariant is small and everything else is a function of it: the strata
 * table, the specimen list (nx, ny, depth, seed — the stratum decides the
 * kind, so the ground is a real map of itself), and eight continuous scalars
 * — lens, season, rain, load, lean, pressure, time dilation, night.
 *
 * The rock itself is normal-mapped: a procedural bedded heightfield is built
 * once per resize into a half-resolution buffer, and the lambert/specular
 * shade of that buffer is re-cooked only when the sun moves (season, tilt,
 * night). Nothing about the lighting costs a frame.
 *
 * Grammar (docs/gesture-grammar.md §5) via `attachGestures` — never raw
 * pointers, never a private threshold. The one raw listener left is
 * `mousemove`, which is not a gesture channel at all: it is the desktop
 * hover reading the grammar names ("hover ≈ light touch"), feeding the
 * seismograph the way a real one reads footfalls.
 */

type Stratum = {
  id: string;
  name: string;
  inscription: string;
  top: number;
  bottom: number;
  colorTop: string;
  colorBottom: string;
  accent: string;
  mineral: MineralKind;
  /** relief character: bedding pitch, grain, and how glossy the face reads */
  bedding: number;
  grain: number;
  gloss: number;
};

type MineralKind = "glint" | "vein" | "fossil" | "crystal" | "sediment";

type MineralMark = {
  x: number;
  y: number;
  born: number;
  life: number;
  size: number;
  hue: string;
  kind: MineralKind;
  angle: number;
  phase: number;
};

type FaultTrace = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  born: number;
  strength: number;
  hue: string;
};

type PressureBloom = {
  x: number;
  y: number;
  born: number;
  strength: number;
  hue: string;
  radius: number;
};

type Fracture = {
  x: number;
  y: number;
  born: number;
  angle: number;
  length: number;
  branches: number;
  hue: string;
};

/** The one thing this room keeps: a specimen grown into the column. */
type Specimen = {
  /** normalized to the viewport, so the ground survives any resize */
  nx: number;
  ny: number;
  /** continuous 0..1 — how long the hand stayed, not which tier it crossed */
  depth: number;
  seed: number;
  kind: MineralKind;
  stratum: string;
  sealed: boolean;
};

type Zones = {
  skyTop: number;
  skyBot: number;
  surfaceTop: number;
  surfaceBot: number;
  strataTop: number;
  strataBot: number;
  seismoTop: number;
  seismoBot: number;
};

const STRATA: Stratum[] = [
  {
    id: "regolith",
    name: "regolith",
    inscription: "regolith / weathered skin",
    top: 0.00,
    bottom: 0.11,
    colorTop: "#4c3824",
    colorBottom: "#241914",
    accent: "#d49b55",
    mineral: "sediment",
    bedding: 0.9,
    grain: 2.6,
    gloss: 0.05,
  },
  {
    id: "sandstone",
    name: "sandstone",
    inscription: "sandstone / pressed dune",
    top: 0.11,
    bottom: 0.27,
    colorTop: "#9a6534",
    colorBottom: "#5a321f",
    accent: "#f0b66d",
    mineral: "glint",
    bedding: 1.6,
    grain: 3.4,
    gloss: 0.22,
  },
  {
    id: "shale",
    name: "shale",
    inscription: "shale / paper-thin silt",
    top: 0.27,
    bottom: 0.43,
    colorTop: "#30383a",
    colorBottom: "#15191b",
    accent: "#9bc6c1",
    mineral: "vein",
    bedding: 4.6,
    grain: 1.1,
    gloss: 0.10,
  },
  {
    id: "limestone",
    name: "limestone",
    inscription: "limestone / ancient sea",
    top: 0.43,
    bottom: 0.60,
    colorTop: "#d6c6a1",
    colorBottom: "#8d826c",
    accent: "#fff0c8",
    mineral: "fossil",
    bedding: 2.1,
    grain: 1.8,
    gloss: 0.18,
  },
  {
    id: "marble",
    name: "marble",
    inscription: "marble / recrystallized pressure",
    top: 0.60,
    bottom: 0.75,
    colorTop: "#d8ded5",
    colorBottom: "#7e8b83",
    accent: "#bff8e1",
    mineral: "crystal",
    bedding: 0.7,
    grain: 0.9,
    gloss: 0.62,
  },
  {
    id: "basalt",
    name: "basalt",
    inscription: "basalt / the body of fire",
    top: 0.75,
    bottom: 0.89,
    colorTop: "#242326",
    colorBottom: "#08090a",
    accent: "#f06f3f",
    mineral: "vein",
    bedding: 0.5,
    grain: 4.2,
    gloss: 0.34,
  },
  {
    id: "mantle",
    name: "olivine",
    inscription: "olivine / slow green pressure",
    top: 0.89,
    bottom: 1.00,
    colorTop: "#26381f",
    colorBottom: "#0a100b",
    accent: "#b8ee78",
    mineral: "crystal",
    bedding: 0.4,
    grain: 1.5,
    gloss: 0.44,
  },
];

const SKY_FRAC = 0.14;
const SURFACE_FRAC = 0.07;
const STRATA_FRAC = 0.58;
const SEISMO_SAMPLES = 1440;
/** How far past the viewport both canvases are drawn, so a pan never gaps. */
const OVERSCAN = 64;
const STORAGE_KEY = "objetdart:earth:v1";
const MAX_SPECIMENS = 24;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const hash = (value: number) => {
  const x = Math.sin(value * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
};

/** Integer hash — the relief pass calls this millions of times; no Math.sin. */
function ihash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = ihash2(xi, yi);
  const b = ihash2(xi + 1, yi);
  const c = ihash2(xi, yi + 1);
  const d = ihash2(xi + 1, yi + 1);
  const ab = a + (b - a) * u;
  const cd = c + (d - c) * u;
  return ab + (cd - ab) * v;
}

function colorAlpha(hex: string, alpha: number) {
  const clean = hex.replace("#", "");
  const n = parseInt(clean.length === 3
    ? clean.split("").map((ch) => ch + ch).join("")
    : clean, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Pre-blurred glow sprites. `ctx.shadowBlur` and `ctx.filter` are both
 * catastrophic on mobile and this room used to set shadowBlur three times a
 * frame; every glow here is one cached radial sprite drawn with drawImage.
 */
const glowCache = new Map<string, HTMLCanvasElement>();

function glowSprite(hue: string): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const hit = glowCache.get(hue);
  if (hit) return hit;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d");
  if (!g) return null;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, colorAlpha(hue, 0.95));
  grad.addColorStop(0.26, colorAlpha(hue, 0.42));
  grad.addColorStop(0.62, colorAlpha(hue, 0.11));
  grad.addColorStop(1, colorAlpha(hue, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  glowCache.set(hue, canvas);
  return canvas;
}

function drawGlow(
  ctx: CanvasRenderingContext2D,
  hue: string,
  x: number,
  y: number,
  radius: number,
  alpha: number,
) {
  if (alpha <= 0.003 || radius <= 0.4) return;
  const sprite = glowSprite(hue);
  if (!sprite) return;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = clamp01(alpha);
  ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalAlpha = prev;
}

function stratumY0(stratum: Stratum, zones: Zones) {
  return zones.strataTop + stratum.top * (zones.strataBot - zones.strataTop);
}

function stratumY1(stratum: Stratum, zones: Zones) {
  return zones.strataTop + stratum.bottom * (zones.strataBot - zones.strataTop);
}

function warpedLineY(base: number, x: number, amp: number, phase: number) {
  return base
    + Math.sin(x * 0.006 + phase) * amp
    + Math.sin(x * 0.017 + phase * 1.71) * amp * 0.34;
}

function drawWarpedLine(
  ctx: CanvasRenderingContext2D,
  x0: number,
  x1: number,
  y: number,
  amp: number,
  phase: number,
) {
  ctx.beginPath();
  for (let x = x0; x <= x1 + 18; x += 18) {
    const yy = warpedLineY(y, x, amp, phase);
    if (x <= x0) ctx.moveTo(x, yy);
    else ctx.lineTo(x, yy);
  }
}

function drawGlint(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  hue: string,
  alpha: number,
  angle: number,
) {
  drawGlow(ctx, hue, x, y, radius * 3.1, alpha * 0.52);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.strokeStyle = colorAlpha(hue, alpha);
  ctx.lineWidth = Math.max(0.7, radius * 0.13);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-radius * 2.2, 0);
  ctx.lineTo(radius * 2.2, 0);
  ctx.moveTo(0, -radius * 2.2);
  ctx.lineTo(0, radius * 2.2);
  ctx.stroke();
  ctx.rotate(Math.PI / 4);
  ctx.globalAlpha = alpha * 0.54;
  ctx.beginPath();
  ctx.moveTo(-radius * 1.25, 0);
  ctx.lineTo(radius * 1.25, 0);
  ctx.moveTo(0, -radius * 1.25);
  ctx.lineTo(0, radius * 1.25);
  ctx.stroke();
  ctx.restore();
}

function drawFossil(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  hue: string,
  alpha: number,
  angle: number,
  steps = 42,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.strokeStyle = colorAlpha(hue, alpha);
  ctx.lineWidth = Math.max(0.8, radius * 0.08);
  ctx.lineCap = "round";
  ctx.beginPath();
  const n = Math.max(10, steps | 0);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const a = t * Math.PI * 4.7;
    const r = radius * t;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r * 0.72;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.globalAlpha = alpha * 0.45;
  for (let i = 3; i < 8; i++) {
    const a = i * 0.56;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * radius * 0.25, Math.sin(a) * radius * 0.18);
    ctx.lineTo(Math.cos(a) * radius * 0.92, Math.sin(a) * radius * 0.64);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCrystal(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  hue: string,
  alpha: number,
  angle: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const h = radius * 2.5;
  const w = radius * 0.92;
  ctx.fillStyle = colorAlpha(hue, alpha * 0.24);
  ctx.strokeStyle = colorAlpha(hue, alpha);
  ctx.lineWidth = Math.max(0.8, radius * 0.08);
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.55);
  ctx.lineTo(w, -h * 0.18);
  ctx.lineTo(w * 0.68, h * 0.54);
  ctx.lineTo(-w * 0.68, h * 0.54);
  ctx.lineTo(-w, -h * 0.18);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.globalAlpha = alpha * 0.55;
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.55);
  ctx.lineTo(0, h * 0.54);
  ctx.moveTo(-w, -h * 0.18);
  ctx.lineTo(w * 0.68, h * 0.54);
  ctx.moveTo(w, -h * 0.18);
  ctx.lineTo(-w * 0.68, h * 0.54);
  ctx.stroke();
  ctx.restore();
}

function drawVein(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  hue: string,
  alpha: number,
  angle: number,
  phase: number,
) {
  const len = radius * 5;
  const nx = Math.cos(angle);
  const ny = Math.sin(angle);
  const px = -ny;
  const py = nx;
  ctx.save();
  ctx.lineCap = "round";
  // The old halo was ctx.shadowBlur; this is the same light for free — one
  // wide translucent under-stroke, then the crisp vein on top.
  ctx.strokeStyle = colorAlpha(hue, alpha * 0.16);
  ctx.lineWidth = Math.max(2.5, radius * 0.55);
  for (let pass = 0; pass < 2; pass++) {
    if (pass === 1) {
      ctx.strokeStyle = colorAlpha(hue, alpha * 0.86);
      ctx.lineWidth = Math.max(1, radius * 0.11);
    }
    ctx.beginPath();
    for (let i = 0; i <= 18; i++) {
      const t = i / 18;
      const along = (t - 0.5) * len;
      const wiggle = Math.sin(t * Math.PI * 3 + phase) * radius * 0.32;
      const xx = x + nx * along + px * wiggle;
      const yy = y + ny * along + py * wiggle;
      if (i === 0) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = alpha * 0.48;
  ctx.lineWidth = Math.max(0.5, radius * 0.045);
  ctx.beginPath();
  ctx.moveTo(x - nx * len * 0.31 + px * radius * 0.55, y - ny * len * 0.31 + py * radius * 0.55);
  ctx.lineTo(x + nx * len * 0.33 + px * radius * 0.18, y + ny * len * 0.33 + py * radius * 0.18);
  ctx.stroke();
  ctx.restore();
}

function drawSediment(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  hue: string,
  alpha: number,
) {
  ctx.save();
  ctx.strokeStyle = colorAlpha(hue, alpha * 0.72);
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const r = radius * (0.7 + i * 0.38);
    ctx.globalAlpha = alpha * (1 - i * 0.13);
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.8, r * 0.32, 0, Math.PI * 0.08, Math.PI * 0.92);
    ctx.stroke();
  }
  ctx.restore();
}

function drawKind(
  ctx: CanvasRenderingContext2D,
  kind: MineralKind,
  x: number,
  y: number,
  radius: number,
  hue: string,
  alpha: number,
  angle: number,
  phase: number,
  fossilSteps: number,
) {
  if (kind === "glint") drawGlint(ctx, x, y, radius, hue, alpha, angle);
  else if (kind === "fossil") drawFossil(ctx, x, y, radius, hue, alpha, angle, fossilSteps);
  else if (kind === "crystal") drawCrystal(ctx, x, y, radius, hue, alpha, angle);
  else if (kind === "vein") drawVein(ctx, x, y, radius, hue, alpha, angle, phase);
  else drawSediment(ctx, x, y, radius, hue, alpha);
}

type WrapEl = HTMLDivElement & {
  __letGo?: () => void;
};

export default function Earth() {
  useEffect(() => { getFieldAudio().setAmbientProfile("earth"); }, []);

  const wrapRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLCanvasElement>(null);
  const fgRef = useRef<HTMLCanvasElement>(null);
  const actionRef = useRef<{ activateStratum: (id: string) => void; quake: () => void; compress: () => void } | null>(null);

  const [earthMarks, setEarthMarks] = useState<Array<{ label: string; tone: string; t: number }>>([
    { label: "quiet core", tone: "#b8ee78", t: 0 },
  ]);
  const [activeStratumId, setActiveStratumId] = useState<string | null>(null);
  const [hoverStratum, setHoverStratum] = useState<string | null>(null);
  const [hasKept, setHasKept] = useState(false);
  const [readouts, setReadouts] = useState({ magnitude: "0.0", pressure: "0.00", slip: "0" });

  const markEarth = useCallback((label: string, tone = "#d8c8a8") => {
    setEarthMarks((prev) => [{ label, tone, t: performance.now() }, ...prev].slice(0, 5));
  }, []);

  const activateLayer = useCallback((id: string) => {
    actionRef.current?.activateStratum(id);
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current as WrapEl | null;
    const bg = bgRef.current;
    const fg = fgRef.current;
    if (!wrap || !bg || !fg) return;
    const bgCtx = bg.getContext("2d");
    const fgCtx = fg.getContext("2d");
    if (!bgCtx || !fgCtx) return;

    const audio = getFieldAudio();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const embedded = isEmbeddedFrame();
    const gov = createFrameGovernor(embedded ? "medium" : "high");
    let tier: QualityTier = gov.tier();
    let detail = detailForTier(tier);

    let viewW = 0;
    let viewH = 0;
    let raf = 0;
    let running = true;
    let lastReadoutMs = 0;
    let lastFrameMs = performance.now();
    let lastFramed = "";
    const clearTimers = new Set<number>();

    // ——— the invariant ———
    /** dilated room time, ms. Every `born` is stamped from this, so a
     *  three-finger hold genuinely slows the room's memory, not its motion. */
    let clock = 0;
    let timeScale = 1;
    let timeTarget = 1;
    /** the lens ladder: 0 ground as seen · 1 the column · 2 the seismic field */
    let lens = 0;
    let lensTarget = 0;
    /** deep time: deposition, erosion, the column building */
    let season = 0.38;
    let seasonTarget = 0.38;
    /** weather */
    let rain = 0;
    let windX = 0;
    let load = 0;
    /** the frame — a bounded pan of the section under the eye */
    let frameX = 0;
    let frameY = 0;
    let night = 0;
    let nightTarget = 0;
    let lean = 0;

    let specimens: Specimen[] = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { specimens?: Specimen[] };
        if (Array.isArray(parsed.specimens)) {
          specimens = parsed.specimens
            .filter((s) => s && Number.isFinite(s.nx) && Number.isFinite(s.ny))
            .slice(-MAX_SPECIMENS);
        }
      }
    } catch {
      /* fresh ground */
    }
    setHasKept(specimens.length > 0);

    const writer = createIdleWriter(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ specimens }));
      } catch {
        /* quota / private mode */
      }
      setHasKept(specimens.length > 0);
    });

    // ——— transient material ———
    const seismoBuf = new Float32Array(SEISMO_SAMPLES);
    let seismoHead = 0;
    const clickSpikes: Array<{ t0: number; strength: number }> = [];
    let mineralMarks: MineralMark[] = [];
    let faults: FaultTrace[] = [];
    let blooms: PressureBloom[] = [];
    let fractures: Fracture[] = [];
    let quakeSpike: { t0: number; strength: number } | null = null;
    let activeStratum: { id: string; t0: number } | null = null;
    let coreRing: { t0: number; strength: number } | null = null;
    let tuttiAt = -1e9;
    let epicenterX = 0.5;
    let epicenterY = 0.5;
    const cursor = { x: 0, y: 0, lastT: 0, vel: 0, over: false };
    const shear = { current: 0, target: 0 };
    const pressure = { current: 0, target: 0 };
    let lastTouchAt = performance.now();
    let glimmerAt = 0;
    let hidden = document.hidden;
    let galleryPaused = false;
    let asleep = false;

    const Z: Zones = {
      skyTop: 0,
      skyBot: 0,
      surfaceTop: 0,
      surfaceBot: 0,
      strataTop: 0,
      strataBot: 0,
      seismoTop: 0,
      seismoBot: 0,
    };

    const updateZones = () => {
      Z.skyTop = 0;
      Z.skyBot = viewH * SKY_FRAC;
      Z.surfaceTop = Z.skyBot;
      Z.surfaceBot = Z.surfaceTop + viewH * SURFACE_FRAC;
      Z.strataTop = Z.surfaceBot;
      Z.strataBot = Z.strataTop + viewH * STRATA_FRAC;
      Z.seismoTop = Z.strataBot;
      Z.seismoBot = viewH;
    };

    const spanX0 = () => -OVERSCAN;
    const spanX1 = () => viewW + OVERSCAN;

    const stratumAt = (y: number): Stratum | null => {
      if (y < Z.strataTop || y > Z.strataBot) return null;
      const t = (y - Z.strataTop) / Math.max(1, Z.strataBot - Z.strataTop);
      return STRATA.find((stratum) => t >= stratum.top && t <= stratum.bottom) ?? null;
    };

    const stratumIndex = (id: string) => {
      for (let i = 0; i < STRATA.length; i++) if (STRATA[i].id === id) return i;
      return 0;
    };

    const syncSleep = () => {
      asleep = hidden || galleryPaused;
      if (asleep) gov.force("sleep");
    };
    const unvis = onVisibility((h) => {
      hidden = h;
      syncSleep();
    });
    const ungal = onGalleryPause((p) => {
      galleryPaused = p;
      syncSleep();
    });

    // ——————————————————————————————————————————————————————
    // the rock: a bedded heightfield, normal-mapped, lit by the sun
    // ——————————————————————————————————————————————————————

    let relief: {
      canvas: HTMLCanvasElement;
      ctx: CanvasRenderingContext2D;
      img: ImageData;
      heights: Float32Array;
      w: number;
      h: number;
      spanW: number;
      spanH: number;
    } | null = null;
    let reliefSunAz = 1e9;
    let reliefShadedAt = 0;
    let reliefTimer: number | null = null;

    /** Where the light stands: the sky glow swings with the season, and
     *  face-down carries it away to a low, cold candle. */
    const sunAzimuth = () => -0.82 + season * 1.7 + lean * 0.22 + night * 2.1;

    const buildRelief = () => {
      if (typeof document === "undefined" || viewW < 2 || viewH < 2) return;
      const div = tier === "high" ? 2 : tier === "medium" ? 3 : 4;
      const spanW = viewW + OVERSCAN * 2;
      const spanH = viewH + OVERSCAN * 2;
      const w = Math.max(2, Math.round(spanW / div));
      const h = Math.max(2, Math.round(spanH / div));
      let canvas = relief?.canvas;
      if (!canvas) canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const rctx = canvas.getContext("2d");
      if (!rctx) return;
      const heights = new Float32Array(w * h);

      // One height pass. The bedding term (a warped sine in y whose pitch is
      // the stratum's own) is what makes rock read as rock; the octaves are
      // the grain sitting on the beds.
      for (let j = 0; j < h; j++) {
        const sceneY = -OVERSCAN + (j / h) * spanH;
        const ny = sceneY / Math.max(1, viewH);
        let bedding = 1.2;
        let grain = 2.0;
        if (sceneY >= Z.strataTop && sceneY <= Z.strataBot) {
          const t = (sceneY - Z.strataTop) / Math.max(1, Z.strataBot - Z.strataTop);
          for (let i = 0; i < STRATA.length; i++) {
            if (t >= STRATA[i].top && t <= STRATA[i].bottom) {
              bedding = STRATA[i].bedding;
              grain = STRATA[i].grain;
              break;
            }
          }
        }
        const bedPitch = 0.055 + bedding * 0.085;
        for (let i = 0; i < w; i++) {
          const sceneX = -OVERSCAN + (i / w) * spanW;
          // beds are not level: they warp exactly as the drawn laminae do
          const warp = Math.sin(sceneX * 0.006) * 2.4 + Math.sin(sceneX * 0.017) * 0.9;
          let hgt = Math.sin((sceneY + warp) * bedPitch) * (0.34 + bedding * 0.06);
          let amp = 0.5;
          let freq = 0.028 * (0.6 + grain * 0.5);
          for (let o = 0; o < 3; o++) {
            hgt += (vnoise(sceneX * freq, sceneY * freq * 1.45) - 0.5) * amp;
            amp *= 0.48;
            freq *= 2.13;
          }
          heights[j * w + i] = hgt * (0.55 + 0.45 * clamp01(1.25 - Math.abs(ny - 0.5)));
        }
      }

      relief = {
        canvas,
        ctx: rctx,
        img: rctx.createImageData(w, h),
        heights,
        w,
        h,
        spanW,
        spanH,
      };
      reliefSunAz = 1e9;
      shadeRelief();
    };

    /** Re-cook the shade only — the normals are already in the buffer. */
    const shadeRelief = () => {
      const r = relief;
      if (!r) return;
      const az = sunAzimuth();
      reliefSunAz = az;
      reliefShadedAt = performance.now();
      const lz = 0.62 + night * 0.2;
      const lx = Math.sin(az);
      const ly = -Math.abs(Math.cos(az)) * 0.72 - 0.08;
      const linv = 1 / Math.max(1e-4, Math.hypot(lx, ly, lz));
      const nlx = lx * linv;
      const nly = ly * linv;
      const nlz = lz * linv;
      const data = r.img.data;
      const { w, h, heights, spanH } = r;
      const slope = 3.4;
      const contrast = 230 * (1 - night * 0.55);

      for (let j = 0; j < h; j++) {
        const sceneY = -OVERSCAN + (j / h) * spanH;
        // the shade belongs to the ground: none in the sky, none in the trace
        let cover = 0;
        if (sceneY > Z.surfaceTop - 6 && sceneY < Z.seismoTop + 4) {
          cover = 1;
          if (sceneY < Z.surfaceTop + 10) cover = (sceneY - Z.surfaceTop + 6) / 16;
          if (sceneY > Z.seismoTop - 18) cover = Math.min(cover, (Z.seismoTop + 4 - sceneY) / 22);
        }
        cover = clamp01(cover);
        let gloss = 0.2;
        if (sceneY >= Z.strataTop && sceneY <= Z.strataBot) {
          const t = (sceneY - Z.strataTop) / Math.max(1, Z.strataBot - Z.strataTop);
          for (let i = 0; i < STRATA.length; i++) {
            if (t >= STRATA[i].top && t <= STRATA[i].bottom) {
              gloss = STRATA[i].gloss;
              break;
            }
          }
        }
        const jm = j > 0 ? j - 1 : j;
        const jp = j < h - 1 ? j + 1 : j;
        for (let i = 0; i < w; i++) {
          const o = (j * w + i) * 4;
          if (cover <= 0.002) {
            data[o] = 128;
            data[o + 1] = 128;
            data[o + 2] = 128;
            data[o + 3] = 0;
            continue;
          }
          const im = i > 0 ? i - 1 : i;
          const ip = i < w - 1 ? i + 1 : i;
          const nx = (heights[j * w + im] - heights[j * w + ip]) * slope;
          const ny = (heights[jm * w + i] - heights[jp * w + i]) * slope;
          const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
          const diff = (nx * nlx + ny * nly + nlz) * inv;
          const s = diff > 0 ? Math.pow(diff, 22) * gloss * 120 : 0;
          let v = 128 + (diff - 0.66) * contrast + s;
          v = v < 0 ? 0 : v > 255 ? 255 : v;
          data[o] = Math.min(255, v * 1.035);
          data[o + 1] = v;
          data[o + 2] = v * 0.965;
          data[o + 3] = Math.round(cover * 255);
        }
      }
      r.ctx.putImageData(r.img, 0, 0);
    };

    const scheduleRelief = () => {
      if (reliefTimer !== null) window.clearTimeout(reliefTimer);
      reliefTimer = window.setTimeout(() => {
        reliefTimer = null;
        buildRelief();
        renderBackground();
      }, 180);
    };

    // ——————————————————————————————————————————————————————
    // the static half: everything that only changes on resize
    // ——————————————————————————————————————————————————————

    const renderBackground = () => {
      const dpr = resolveDpr(tier, { embedded, reducedMotion: reduce });
      const spanW = viewW + OVERSCAN * 2;
      const spanH = viewH + OVERSCAN * 2;
      bg.width = Math.floor(spanW * dpr);
      bg.height = Math.floor(spanH * dpr);
      bgCtx.setTransform(dpr, 0, 0, dpr, OVERSCAN * dpr, OVERSCAN * dpr);
      const x0 = spanX0();
      const x1 = spanX1();
      const w = x1 - x0;

      bgCtx.fillStyle = "#050606";
      bgCtx.fillRect(x0, -OVERSCAN, w, spanH);

      const skyG = bgCtx.createLinearGradient(0, -OVERSCAN, 0, Z.skyBot);
      skyG.addColorStop(0, "#050606");
      skyG.addColorStop(0.42, "#101411");
      skyG.addColorStop(1, "#3d2d1c");
      bgCtx.fillStyle = skyG;
      bgCtx.fillRect(x0, -OVERSCAN, w, Z.skyBot + OVERSCAN);

      const sunX = viewW * (0.5 + Math.sin(sunAzimuth()) * 0.42);
      const skyGlow = bgCtx.createRadialGradient(sunX, Z.skyBot * 0.76, 0, sunX, Z.skyBot * 0.76, Math.max(80, viewW * 0.56));
      skyGlow.addColorStop(0, "rgba(215, 172, 96, 0.30)");
      skyGlow.addColorStop(1, "rgba(215, 172, 96, 0)");
      bgCtx.fillStyle = skyGlow;
      bgCtx.fillRect(x0, -OVERSCAN, w, Z.skyBot + OVERSCAN);

      const capG = bgCtx.createLinearGradient(0, Z.surfaceTop, 0, Z.surfaceBot);
      capG.addColorStop(0, "#6c5739");
      capG.addColorStop(0.38, "#33261c");
      capG.addColorStop(1, "#11100e");
      bgCtx.fillStyle = capG;
      bgCtx.fillRect(x0, Z.surfaceTop, w, Z.surfaceBot - Z.surfaceTop);

      bgCtx.strokeStyle = "rgba(248, 214, 137, 0.36)";
      bgCtx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const y = mix(Z.surfaceTop + 4, Z.surfaceBot - 5, i / 4);
        drawWarpedLine(bgCtx, x0, x1, y, 1.2 + i * 0.4, i * 1.17);
        bgCtx.stroke();
      }

      for (let i = 0; i < STRATA.length; i++) {
        const stratum = STRATA[i];
        const y0 = stratumY0(stratum, Z);
        const y1 = stratumY1(stratum, Z);
        const layerG = bgCtx.createLinearGradient(x0, y0, x1, y1);
        layerG.addColorStop(0, stratum.colorTop);
        layerG.addColorStop(0.58, stratum.colorBottom);
        layerG.addColorStop(1, stratum.colorTop);
        bgCtx.fillStyle = layerG;
        bgCtx.fillRect(x0, y0 - 1, w, y1 - y0 + 2);

        const bandH = y1 - y0;
        const laminae = Math.max(3, Math.round((bandH / 17) * detail.samples));
        for (let k = 0; k < laminae; k++) {
          const t = (k + 0.5) / laminae;
          const yy = mix(y0, y1, t);
          const warm = (k + i) % 3 === 0;
          bgCtx.strokeStyle = warm ? colorAlpha(stratum.accent, 0.13) : "rgba(255, 246, 220, 0.055)";
          bgCtx.lineWidth = warm ? 1.1 : 0.75;
          drawWarpedLine(bgCtx, x0, x1, yy, 1.6 + i * 0.35, i * 2.21 + k * 0.7);
          bgCtx.stroke();
        }

        const flecks = Math.max(10, Math.round(((w * bandH) / 7800) * detail.particles));
        for (let k = 0; k < flecks; k++) {
          const a = hash(i * 101 + k * 13.7);
          const b = hash(i * 233 + k * 19.3);
          const x = x0 + a * w;
          const y = mix(y0 + 4, y1 - 4, b);
          const r = 0.55 + hash(k * 4.1 + i) * 1.3;
          bgCtx.fillStyle = colorAlpha(k % 4 === 0 ? stratum.accent : "#fff3d5", 0.10 + hash(k + i) * 0.16);
          bgCtx.beginPath();
          bgCtx.ellipse(x, y, r * 1.8, r * 0.56, hash(k) * Math.PI, 0, Math.PI * 2);
          bgCtx.fill();
        }

        if (stratum.id === "limestone") {
          for (let k = 0; k < 5; k++) {
            drawFossil(bgCtx, viewW * (0.15 + k * 0.17), mix(y0, y1, 0.35 + hash(k) * 0.35), 8 + hash(k + 7) * 7, "#fff0c8", 0.14, -0.2, Math.max(14, Math.round(42 * detail.samples)));
          }
        }

        if (i > 0) {
          bgCtx.strokeStyle = "rgba(4, 5, 5, 0.58)";
          bgCtx.lineWidth = 1;
          drawWarpedLine(bgCtx, x0, x1, y0, 1.8, i * 1.93);
          bgCtx.stroke();
          bgCtx.strokeStyle = colorAlpha(stratum.accent, 0.12);
          bgCtx.lineWidth = 0.7;
          drawWarpedLine(bgCtx, x0, x1, y0 + 1.4, 1.2, i * 1.93 + 0.7);
          bgCtx.stroke();
        }
      }

      // the lit rock — normal-mapped relief, soft-light over the flat bands
      if (relief) {
        bgCtx.save();
        bgCtx.globalCompositeOperation = "soft-light";
        bgCtx.globalAlpha = 0.92;
        bgCtx.drawImage(relief.canvas, x0, -OVERSCAN, spanW, spanH);
        bgCtx.globalCompositeOperation = "overlay";
        bgCtx.globalAlpha = 0.28;
        bgCtx.drawImage(relief.canvas, x0, -OVERSCAN, spanW, spanH);
        bgCtx.restore();
      }

      const plateLines = [
        { x: 0.18, lean: 0.24, hue: "#bff8e1", alpha: 0.19 },
        { x: 0.66, lean: -0.18, hue: "#f0b66d", alpha: 0.16 },
        { x: 0.84, lean: 0.10, hue: "#b8ee78", alpha: 0.12 },
      ];
      for (const p of plateLines) {
        bgCtx.strokeStyle = colorAlpha(p.hue, p.alpha);
        bgCtx.lineWidth = 1.2;
        bgCtx.beginPath();
        bgCtx.moveTo(viewW * p.x, Z.strataTop);
        bgCtx.lineTo(viewW * (p.x + p.lean), Z.strataBot);
        bgCtx.stroke();
      }

      const lensY = Z.strataTop + (Z.strataBot - Z.strataTop) * 0.54;
      const mineralLens = bgCtx.createRadialGradient(viewW * 0.28, lensY, 0, viewW * 0.28, lensY, Math.max(80, viewW * 0.52));
      mineralLens.addColorStop(0, "rgba(255, 238, 195, 0.12)");
      mineralLens.addColorStop(0.5, "rgba(127, 248, 213, 0.045)");
      mineralLens.addColorStop(1, "rgba(0, 0, 0, 0)");
      bgCtx.fillStyle = mineralLens;
      bgCtx.fillRect(x0, Z.strataTop, w, Z.strataBot - Z.strataTop);

      const seismoG = bgCtx.createLinearGradient(0, Z.seismoTop, 0, Z.seismoBot);
      seismoG.addColorStop(0, "#121514");
      seismoG.addColorStop(1, "#050606");
      bgCtx.fillStyle = seismoG;
      bgCtx.fillRect(x0, Z.seismoTop, w, Z.seismoBot - Z.seismoTop + OVERSCAN);

      bgCtx.strokeStyle = "rgba(232, 226, 213, 0.16)";
      bgCtx.lineWidth = 1;
      bgCtx.beginPath();
      bgCtx.moveTo(x0, Z.seismoTop + 0.5);
      bgCtx.lineTo(x1, Z.seismoTop + 0.5);
      bgCtx.stroke();

      const seismoH = Z.seismoBot - Z.seismoTop;
      bgCtx.strokeStyle = "rgba(232, 226, 213, 0.07)";
      bgCtx.lineWidth = 1;
      for (let i = 1; i < 5; i++) {
        const y = Z.seismoTop + seismoH * (i / 5);
        bgCtx.beginPath();
        bgCtx.moveTo(x0, y);
        bgCtx.lineTo(x1, y);
        bgCtx.stroke();
      }
      for (let i = 1; i < 13; i++) {
        const x = viewW * (i / 13);
        bgCtx.beginPath();
        bgCtx.moveTo(x, Z.seismoTop);
        bgCtx.lineTo(x, Z.seismoBot + OVERSCAN);
        bgCtx.stroke();
      }
      bgCtx.strokeStyle = "rgba(248, 214, 137, 0.18)";
      bgCtx.beginPath();
      bgCtx.moveTo(x0, Z.seismoTop + seismoH * 0.5);
      bgCtx.lineTo(x1, Z.seismoTop + seismoH * 0.5);
      bgCtx.stroke();
    };

    const resize = () => {
      viewW = wrap.clientWidth || 1;
      viewH = wrap.clientHeight || 1;
      updateZones();
      const dpr = resolveDpr(tier, { embedded, reducedMotion: reduce });
      const spanW = viewW + OVERSCAN * 2;
      const spanH = viewH + OVERSCAN * 2;
      fg.width = Math.floor(spanW * dpr);
      fg.height = Math.floor(spanH * dpr);
      fgCtx.setTransform(dpr, 0, 0, dpr, OVERSCAN * dpr, OVERSCAN * dpr);
      renderBackground();
      scheduleRelief();
    };

    // ——————————————————————————————————————————————————————
    // the material verbs
    // ——————————————————————————————————————————————————————

    const scheduleClearActive = (id: string) => {
      const timer = window.setTimeout(() => {
        clearTimers.delete(timer);
        if (activeStratum?.id === id) {
          activeStratum = null;
          setActiveStratumId(null);
        }
      }, 3200);
      clearTimers.add(timer);
    };

    const addMineralMark = (mark: Omit<MineralMark, "born">) => {
      mineralMarks.push({ ...mark, born: clock });
      const cap = Math.max(24, Math.round(90 * detail.particles));
      if (mineralMarks.length > cap) mineralMarks.splice(0, mineralMarks.length - cap);
    };

    const seedMineral = (x: number, y: number, stratum: Stratum, scale = 1) => {
      activeStratum = { id: stratum.id, t0: clock };
      setActiveStratumId(stratum.id);
      scheduleClearActive(stratum.id);
      const base = stratum.mineral === "fossil" ? 2 : stratum.mineral === "vein" ? 3 : 5;
      const count = Math.max(1, Math.round(base * detail.particles));
      for (let i = 0; i < count; i++) {
        const r = 8 + hash(clock * 0.01 + i * 17) * 16;
        addMineralMark({
          x: x + (hash(i * 13 + clock) - 0.5) * 52 * scale,
          y: y + (hash(i * 29 + clock) - 0.5) * 38 * scale,
          life: 3.5 + hash(i * 41 + clock) * 3.8,
          size: r * scale,
          hue: stratum.accent,
          kind: i === 0 ? stratum.mineral : (hash(i + clock) > 0.72 ? "glint" : stratum.mineral),
          angle: (hash(i * 7.1 + clock) - 0.5) * Math.PI,
          phase: hash(i * 31.1 + clock) * Math.PI * 2,
        });
      }
      clickSpikes.push({ t0: clock, strength: 0.55 + scale * 0.18 });
      pressure.target = Math.min(1, pressure.target + 0.14 * scale);
      try {
        audio.chime();
        audio.playNote(48 + stratumIndex(stratum.id) * 3, 130);
      } catch { /* noop */ }
      haptics.ripple(0.42 + scale * 0.16);
      markEarth(stratum.name, stratum.accent);
      useField.getState().recordTape("region", 0.46 + scale * 0.14, `earth/${stratum.id}`);
    };

    const addFault = (x0: number, y0: number, x1: number, y1: number, strength = 1, hue = "#fff0c8") => {
      faults.push({ x0, y0, x1, y1, born: clock, strength, hue });
      const cap = Math.max(12, Math.round(42 * detail.particles));
      if (faults.length > cap) faults.splice(0, faults.length - cap);
    };

    const addFracture = (x: number, y: number, strength = 1, hue = "#f0b66d") => {
      const n = Math.max(1, Math.round(3 * detail.particles));
      for (let i = 0; i < n; i++) {
        fractures.push({
          x: x + (hash(clock + i) - 0.5) * 28,
          y: y + (hash(clock + i * 2) - 0.5) * 22,
          born: clock,
          angle: -Math.PI * 0.5 + (hash(clock * 0.2 + i) - 0.5) * 1.4,
          length: (34 + hash(i * 9 + clock) * 86) * strength,
          branches: 2 + Math.floor(hash(i * 11 + clock) * 4),
          hue,
        });
      }
      const cap = Math.max(8, Math.round(28 * detail.particles));
      if (fractures.length > cap) fractures.splice(0, fractures.length - cap);
    };

    const quakeAt = (x: number, y: number, strength = 1) => {
      quakeSpike = { t0: clock, strength };
      clickSpikes.push({ t0: clock, strength: 1.3 * strength });
      epicenterX = clamp01((x || viewW * 0.5) / Math.max(1, viewW));
      epicenterY = clamp01((y || Z.seismoTop) / Math.max(1, viewH));
      addFracture(x || viewW * 0.5, y || Z.seismoTop, strength, "#f06f3f");
      const n = Math.max(2, Math.round(5 * detail.particles));
      for (let i = 0; i < n; i++) {
        addFault(
          mix(0, viewW, hash(clock + i * 3)),
          mix(Z.strataTop, Z.strataBot, hash(clock + i * 5)),
          mix(0, viewW, hash(clock + i * 7)),
          mix(Z.strataTop, Z.strataBot, hash(clock + i * 11)),
          strength * 0.65,
          "#f06f3f",
        );
      }
      pressure.target = 1;
      try {
        audio.thud();
        window.setTimeout(() => audio.bell(), 120);
      } catch { /* noop */ }
      haptics.storm();
      markEarth("quake", "#f06f3f");
      useField.getState().recordTape("ripple", clamp(strength, 0.2, 1), "earth/quake");
    };

    const compressAt = (x: number, y: number, strength = 1) => {
      const stratum = stratumAt(y) ?? STRATA[Math.floor(STRATA.length * 0.64)];
      const hue = stratum.accent;
      blooms.push({ x, y, born: clock, strength, hue, radius: 74 + strength * 84 });
      if (blooms.length > 18) blooms.shift();
      seedMineral(x, y, stratum, 0.85 + strength * 0.4);
      addFault(x - 80 * strength, y - 24, x + 84 * strength, y + 34, 0.78 * strength, hue);
      addFracture(x, y, 0.52 * strength, hue);
      pressure.target = Math.min(1, 0.5 + strength * 0.5);
      clickSpikes.push({ t0: clock, strength: 0.86 * strength });
      try {
        audio.thud();
        window.setTimeout(() => audio.spark(), 90);
      } catch { /* noop */ }
      haptics.chop();
      markEarth("metamorphic glow", hue);
      useField.getState().recordTape("sigil", clamp(0.5 + strength * 0.4, 0.2, 1), "earth/metamorphic-pressure");
    };

    const erodeAt = (x: number, y: number, scale = 1) => {
      const yy = clamp(y, Z.skyBot, Z.strataTop + 12);
      const n = Math.max(2, Math.round(7 * detail.particles));
      for (let i = 0; i < n; i++) {
        addMineralMark({
          x: x + (hash(clock + i * 17) - 0.5) * 90,
          y: yy + i * 5 + hash(i * 3) * 18,
          life: 2.8 + hash(i * 13) * 2.2,
          size: (9 + hash(i * 19) * 16) * scale,
          hue: "#d49b55",
          kind: "sediment",
          angle: 0,
          phase: hash(i * 23) * Math.PI * 2,
        });
      }
      clickSpikes.push({ t0: clock, strength: 0.34 * scale });
      try { audio.spark(); } catch { /* noop */ }
      haptics.ripple(0.3 + scale * 0.2);
      markEarth("erosion", "#d49b55");
      useField.getState().recordTape("object", clamp(0.24 + scale * 0.2, 0.1, 1), "earth/erosion");
    };

    /** one finger touches the material — and how hard it landed is the act */
    const tapAt = (x: number, y: number, intensity: number) => {
      const force = 0.55 + intensity * 0.95;
      if (y >= Z.seismoTop) {
        quakeAt(x, y, 0.5 + intensity * 0.95);
        return;
      }
      const stratum = stratumAt(y);
      if (stratum) {
        seedMineral(x, y, stratum, force);
        return;
      }
      erodeAt(x, y, force);
    };

    // ——— the room's kept things ———

    const specimenRadius = (sp: Specimen) => 7 + sp.depth * 21;

    const specimenAt = (x: number, y: number): number => {
      for (let i = specimens.length - 1; i >= 0; i--) {
        const sp = specimens[i];
        const sx = sp.nx * viewW;
        const sy = sp.ny * viewH;
        const r = specimenRadius(sp) + 16;
        if ((x - sx) * (x - sx) + (y - sy) * (y - sy) <= r * r) return i;
      }
      return -1;
    };

    /** The stratum decides the kind — the ground stays a map of itself. */
    const plantSpecimen = (x: number, y: number, depth: number): number => {
      const stratum = stratumAt(y);
      if (!stratum) return -1;
      const nx = clamp01(x / Math.max(1, viewW));
      const ny = clamp01(y / Math.max(1, viewH));
      const seed = Math.floor(nx * 9973) * 131 + Math.floor(ny * 9967);
      specimens.push({
        nx,
        ny,
        depth: clamp01(depth),
        seed,
        kind: stratum.mineral,
        stratum: stratum.id,
        sealed: false,
      });
      if (specimens.length > MAX_SPECIMENS) specimens.shift();
      writer.schedule();
      activeStratum = { id: stratum.id, t0: clock };
      setActiveStratumId(stratum.id);
      scheduleClearActive(stratum.id);
      clickSpikes.push({ t0: clock, strength: 0.5 });
      try {
        audio.spark();
        audio.playNote(36 + stratumIndex(stratum.id) * 3, 220);
      } catch { /* noop */ }
      haptics.ripple(0.45);
      markEarth(stratum.mineral, stratum.accent);
      useField.getState().recordTape("object", 0.5, `earth/plant/${stratum.id}`);
      return specimens.length - 1;
    };

    const sealSpecimen = (index: number) => {
      const sp = specimens[index];
      if (!sp || sp.sealed) return;
      sp.sealed = true;
      sp.depth = 1;
      writer.schedule();
      blooms.push({
        x: sp.nx * viewW,
        y: sp.ny * viewH,
        born: clock,
        strength: 1,
        hue: STRATA[stratumIndex(sp.stratum)].accent,
        radius: 120,
      });
      if (blooms.length > 18) blooms.shift();
      clickSpikes.push({ t0: clock, strength: 1 });
      try {
        audio.bell();
        audio.playNote(30 + stratumIndex(sp.stratum) * 2, 900);
      } catch { /* noop */ }
      haptics.bloom();
      markEarth("sealed", STRATA[stratumIndex(sp.stratum)].accent);
      useField.getState().recordTape("sigil", 0.9, `earth/seal/${sp.stratum}`);
    };

    /** the touch-reachable delete: a ceremony hold takes a specimen back */
    const takeBack = (index: number) => {
      const sp = specimens[index];
      if (!sp) return;
      const hue = STRATA[stratumIndex(sp.stratum)].accent;
      const x = sp.nx * viewW;
      const y = sp.ny * viewH;
      specimens.splice(index, 1);
      writer.schedule();
      for (let i = 0; i < Math.max(2, Math.round(6 * detail.particles)); i++) {
        addMineralMark({
          x: x + (hash(clock + i * 5) - 0.5) * 44,
          y: y + (hash(clock + i * 9) - 0.5) * 36,
          life: 1.6 + hash(i) * 1.2,
          size: 6 + hash(i * 3) * 10,
          hue,
          kind: "glint",
          angle: hash(i * 7) * Math.PI,
          phase: hash(i * 11) * Math.PI * 2,
        });
      }
      clickSpikes.push({ t0: clock, strength: 0.7 });
      try {
        audio.thud();
        window.setTimeout(() => audio.chime(), 140);
      } catch { /* noop */ }
      haptics.roll();
      markEarth("taken back", hue);
      useField.getState().recordTape("ripple", 0.5, `earth/take-back/${sp.stratum}`);
    };

    /** the room's one solemn act: the whole column answers, top to bottom */
    const coreAnswers = (strength = 1) => {
      coreRing = { t0: clock, strength };
      quakeSpike = { t0: clock, strength: strength * 0.55 };
      clickSpikes.push({ t0: clock, strength: 1.4 * strength });
      pressure.target = 1;
      for (let i = 0; i < STRATA.length; i++) {
        const at = i * 260;
        const timer = window.setTimeout(() => {
          clearTimers.delete(timer);
          try { audio.playNote(26 + (STRATA.length - i) * 4, 620); } catch { /* noop */ }
        }, at);
        clearTimers.add(timer);
      }
      try { audio.bell(); } catch { /* noop */ }
      haptics.bloom();
      markEarth("the core answers", "#b8ee78");
      useField.getState().recordTape("sigil", 1, "earth/core");
    };

    /** three-finger tap: every live thing in the room answers at once */
    const tutti = () => {
      tuttiAt = clock;
      clickSpikes.push({ t0: clock, strength: 0.9 });
      pressure.target = Math.min(1, pressure.target + 0.4);
      for (let i = 0; i < specimens.length; i++) {
        const sp = specimens[i];
        addMineralMark({
          x: sp.nx * viewW,
          y: sp.ny * viewH,
          life: 1.5,
          size: 10 + sp.depth * 14,
          hue: STRATA[stratumIndex(sp.stratum)].accent,
          kind: "glint",
          angle: hash(sp.seed) * Math.PI,
          phase: hash(sp.seed * 3) * Math.PI * 2,
        });
      }
      for (let i = 0; i < STRATA.length; i++) {
        try { audio.playNote(40 + i * 4, 320); } catch { /* noop */ }
      }
      haptics.roll();
      markEarth("tutti", "#fff0c8");
      useField.getState().recordTape("region", 0.7, "earth/tutti");
    };

    // ——————————————————————————————————————————————————————
    // the grammar (docs/gesture-grammar.md §5)
    // ——————————————————————————————————————————————————————

    const markLens = () => {
      // ScaleTravel's two-finger step-back defers to a room whose lens is up.
      if (lensTarget > 0.15) wrap.dataset.lensRaised = "1";
      else delete wrap.dataset.lensRaised;
    };

    /** viewport → scene: the frame's pan is the only thing between them */
    const sceneX = (x: number) => x - frameX;
    const sceneY = (y: number) => y - frameY;

    /** one hold session's memory — a hold is a story, not an event */
    const holdState = {
      index: -1,
      created: false,
      ceremonyDone: false,
      /** a session that has spoken its solemn act is spent — taking a
       *  specimen back must never let the same hold plant a new one on top */
      done: false,
      zone: "strata" as "strata" | "surface" | "seismo",
      lastVoice: 0,
      lastHaptic: 0,
      x: 0,
      y: 0,
      gatherFrom: -1e9,
      intensity: 0.5,
    };
    let gathering: { x: number; y: number; t0: number; kind: MineralKind; hue: string } | null = null;

    const dragState = { lastFault: 0, lastHaptic: 0, startX: 0, startY: 0, zone: "surface" as "strata" | "surface" | "seismo" };

    const detachGestures = attachGestures(
      fg,
      {
        tap: (e) => {
          lastTouchAt = performance.now();
          if (e.fingers === 2) {
            // step back: the room lowers its own lens first; with the lens
            // already down the axis owns the step (ScaleTravel).
            if (lensTarget > 0.15) {
              lensTarget = Math.max(0, Math.round(lensTarget) - 1);
              markLens();
              haptics.lens();
              try { audio.playNote(44, 180); } catch { /* noop */ }
            }
            return;
          }
          if (e.fingers === 3) {
            tutti();
            return;
          }
          const sx = sceneX(e.x);
          const sy = sceneY(e.y);
          const hit = specimenAt(sx, sy);
          if (hit >= 0) {
            const sp = specimens[hit];
            const hue = STRATA[stratumIndex(sp.stratum)].accent;
            addMineralMark({
              x: sp.nx * viewW,
              y: sp.ny * viewH,
              life: 1.4,
              size: 8 + sp.depth * 12,
              hue,
              kind: "glint",
              angle: hash(sp.seed) * Math.PI,
              phase: hash(sp.seed * 5) * Math.PI * 2,
            });
            clickSpikes.push({ t0: clock, strength: 0.3 + e.intensity * 0.4 });
            try { audio.playNote(52 + Math.round(sp.depth * 12), 160); } catch { /* noop */ }
            haptics.tap();
            return;
          }
          tapAt(sx, sy, e.intensity);
        },

        hold: (e) => {
          lastTouchAt = performance.now();

          // three fingers hold the world-law: time dilates while held, and
          // keeps dilating — a hold that stopped deepening would be a switch.
          if (e.fingers === 3) {
            if (e.phase === "release") {
              timeTarget = 1;
              haptics.tap();
              return;
            }
            timeTarget = mix(0.85, 0.09, clamp01(e.elapsed / 2600));
            if (e.phase === "enter") {
              try { audio.playNote(28, 700); } catch { /* noop */ }
              haptics.detent();
            }
            return;
          }
          if (e.fingers !== 1) return;

          const sx = sceneX(e.x);
          const sy = sceneY(e.y);

          if (e.phase === "enter") {
            holdState.index = specimenAt(sx, sy);
            holdState.created = false;
            holdState.ceremonyDone = false;
            holdState.done = false;
            holdState.lastVoice = 0;
            holdState.lastHaptic = 0;
            holdState.gatherFrom = clock;
            holdState.intensity = e.intensity;
            holdState.zone = sy >= Z.seismoTop ? "seismo" : stratumAt(sy) ? "strata" : "surface";
            holdState.x = sx;
            holdState.y = sy;
            if (holdState.index < 0 && holdState.zone === "strata") {
              const stratum = stratumAt(sy);
              // legible from the first tier: something gathers under the finger
              gathering = { x: sx, y: sy, t0: clock, kind: stratum?.mineral ?? "glint", hue: stratum?.accent ?? "#fff0c8" };
            }
            pressure.target = Math.max(pressure.target, 0.18);
            return;
          }

          holdState.x = sx;
          holdState.y = sy;
          if (gathering) {
            gathering.x = sx;
            gathering.y = sy;
          }

          if (e.phase === "tick") {
            if (holdState.done) return;
            const deep = clamp01((e.elapsed - 900) / 2600);

            // A hand that came down on a specimen already in the ground, and
            // one still growing the specimen it made, are different stories:
            // the first ceremony takes back, the second seals. `created` is
            // what tells them apart, so it must be tested before the index.
            if (holdState.index >= 0 && !holdState.created) {
              // a hand on an existing specimen: the rock loosens around it
              const sp = specimens[holdState.index];
              if (sp) {
                pressure.target = Math.min(1, 0.2 + clamp01(e.elapsed / 2500) * 0.6);
                if (e.tier >= 3 && !holdState.ceremonyDone) {
                  holdState.ceremonyDone = true;
                  holdState.done = true;
                  takeBack(holdState.index);
                  holdState.index = -1;
                } else if (clock - holdState.lastVoice > 220) {
                  holdState.lastVoice = clock;
                  try { audio.playNote(30 + Math.round(clamp01(e.elapsed / 2500) * 16), 120); } catch { /* noop */ }
                  haptics.tap();
                }
              }
              return;
            }

            if (holdState.zone === "strata") {
              if (!holdState.created && e.tier >= 2) {
                const made = plantSpecimen(sx, sy, 0.08 + holdState.intensity * 0.1);
                if (made >= 0) {
                  holdState.created = true;
                  holdState.index = made;
                  gathering = null;
                }
              } else if (holdState.created && holdState.index >= 0) {
                const sp = specimens[holdState.index];
                if (sp && !sp.sealed) {
                  // holding longer keeps deepening it — continuous, always
                  sp.depth = clamp01(0.08 + deep * 0.92);
                  writer.schedule();
                  if (clock - holdState.lastVoice > 190) {
                    holdState.lastVoice = clock;
                    try { audio.playNote(34 + Math.round(sp.depth * 22), 110); } catch { /* noop */ }
                    haptics.ripple(0.2 + sp.depth * 0.5);
                  }
                }
                if (e.tier >= 3 && !holdState.ceremonyDone) {
                  holdState.ceremonyDone = true;
                  sealSpecimen(holdState.index);
                }
              }
              pressure.target = Math.min(1, 0.2 + clamp01(e.elapsed / 2500) * 0.7);
              return;
            }

            // sky, surface, and the trace: the ground compresses, then rings
            pressure.target = Math.min(1, 0.2 + clamp01(e.elapsed / 2500) * 0.8);
            if (!holdState.created && e.tier >= 2) {
              holdState.created = true;
              if (holdState.zone === "seismo") quakeAt(sx, sy, 0.7 + holdState.intensity * 0.6);
              else compressAt(sx, sy, 0.7 + holdState.intensity * 0.5);
            } else if (holdState.created && clock - holdState.lastHaptic > 240) {
              holdState.lastHaptic = clock;
              // the compression keeps going down the longer it is held
              const s = 0.2 + deep * 0.9;
              addFracture(sx, sy, s * 0.5, holdState.zone === "seismo" ? "#f06f3f" : "#fff0c8");
              clickSpikes.push({ t0: clock, strength: 0.2 + deep * 0.7 });
              try { audio.playNote(26 + Math.round(deep * 14), 180); } catch { /* noop */ }
              haptics.ripple(0.2 + deep * 0.6);
            }
            if (e.tier >= 3 && !holdState.ceremonyDone) {
              holdState.ceremonyDone = true;
              coreAnswers(0.7 + holdState.intensity * 0.5);
            }
            return;
          }

          if (e.phase === "release") {
            gathering = null;
            holdState.index = -1;
            holdState.created = false;
            holdState.done = false;
            pressure.target = Math.min(pressure.target, 0.5);
          }
        },

        drag: (e) => {
          lastTouchAt = performance.now();

          // three fingers touch the law: weather over the section
          if (e.fingers === 3) {
            if (e.phase === "start") return;
            rain = clamp01(rain + e.dy * 0.0022);
            windX = clamp(windX + e.dx * 0.0016, -1, 1);
            load = clamp01(load - e.dy * 0.0011);
            if (e.phase === "move" && rain > 0.2 && clock - dragState.lastHaptic > 320) {
              dragState.lastHaptic = clock;
              try { audio.playNote(30 + Math.round(rain * 18), 90); } catch { /* noop */ }
              haptics.ripple(0.15 + rain * 0.35);
            }
            return;
          }
          if (e.fingers !== 1) return;

          const sx = sceneX(e.x);
          const sy = sceneY(e.y);
          if (e.phase === "start") {
            dragState.startX = sx;
            dragState.startY = sy;
            dragState.zone = sy >= Z.seismoTop ? "seismo" : stratumAt(sy) ? "strata" : "surface";
            gathering = null;
            return;
          }
          if (e.phase === "end") {
            shear.target = 0;
            pressure.target = Math.min(pressure.target, 0.4);
            return;
          }

          cursor.x = sx;
          cursor.y = sy;
          const totalDx = sx - dragState.startX;
          const totalDy = sy - dragState.startY;
          const movement = Math.hypot(totalDx, totalDy);

          if (dragState.zone === "strata") {
            shear.target = clamp((totalDx * 0.75 + totalDy * 0.38) / 180, -1, 1);
            pressure.target = clamp(0.2 + movement / 240, 0, 1);
            if (movement > 18 && clock - dragState.lastFault > 78) {
              const stratum = stratumAt(sy) ?? stratumAt(dragState.startY) ?? STRATA[2];
              const side = totalDx >= 0 ? 1 : -1;
              addFault(
                dragState.startX - side * 20 + (hash(clock) - 0.5) * 22,
                dragState.startY + (hash(clock + 5) - 0.5) * 18,
                sx + side * 32,
                sy + (hash(clock + 9) - 0.5) * 22,
                clamp(movement / 130, 0.25, 1),
                stratum.accent,
              );
              if (clock - dragState.lastHaptic > 170) {
                try { audio.playNote(38 + Math.round(Math.abs(shear.target) * 18), 45); } catch { /* noop */ }
                haptics.tap();
                dragState.lastHaptic = clock;
              }
              dragState.lastFault = clock;
            }
          } else if (dragState.zone !== "seismo" && movement > 24 && clock - dragState.lastFault > 120) {
            erodeAt(sx, sy, 0.62);
            dragState.lastFault = clock;
          }
        },

        // two fingers turn the lens; three turn the season. One channel, two
        // registers of the stack — the guard is the whole difference.
        twist: (e) => {
          lastTouchAt = performance.now();
          if (e.fingers === 3) {
            if (e.phase === "end") return;
            seasonTarget = clamp01(seasonTarget + e.angle * 0.22);
            if (Math.abs(e.angle) > 0.04) {
              try { audio.playNote(32 + Math.round(seasonTarget * 20), 120); } catch { /* noop */ }
              haptics.tap();
            }
            return;
          }
          if (e.phase === "end") {
            lensTarget = clamp(Math.round(lensTarget), 0, 2);
            markLens();
            haptics.lens();
            return;
          }
          lensTarget = clamp(lensTarget + e.angle * 0.62, 0, 2);
          markLens();
        },

        // two fingers touch the representation: the section slides under the eye
        pan2: (e) => {
          lastTouchAt = performance.now();
          if (e.phase === "end") return;
          frameX = clamp(frameX + e.dx, -(OVERSCAN - 6), OVERSCAN - 6);
          frameY = clamp(frameY + e.dy, -(OVERSCAN - 6), OVERSCAN - 6);
        },

        // a circular scrub is the auger: it turns and the column answers
        scrub: (e) => {
          lastTouchAt = performance.now();
          const sx = sceneX(e.cx);
          const sy = sceneY(e.cy);
          const stratum = stratumAt(sy);
          pressure.target = Math.min(1, pressure.target + 0.3);
          if (stratum) seedMineral(sx, sy, stratum, 1.2);
          else erodeAt(sx, sy, 1.1);
          clickSpikes.push({ t0: clock, strength: 0.6 });
          try { audio.playNote(44, 200); } catch { /* noop */ }
          haptics.roll();
        },

        // a fast release along the strata throws a slip
        flick: (e) => {
          lastTouchAt = performance.now();
          if (e.fingers !== 1) return;
          const sx = sceneX(e.x);
          const sy = sceneY(e.y);
          if (sy < Z.strataTop || sy > Z.strataBot) return;
          const stratum = stratumAt(sy);
          const strength = clamp(e.speed / 2.4, 0.25, 1);
          addFault(
            sx - Math.cos(e.angle) * 120 * strength,
            sy - Math.sin(e.angle) * 60 * strength,
            sx + Math.cos(e.angle) * 120 * strength,
            sy + Math.sin(e.angle) * 60 * strength,
            strength,
            stratum?.accent ?? "#fff0c8",
          );
          clickSpikes.push({ t0: clock, strength: 0.4 + strength * 0.5 });
          try { audio.playNote(36 + Math.round(strength * 16), 90); } catch { /* noop */ }
          haptics.chop();
          markEarth("fault slip", stratum?.accent ?? "#fff0c8");
          useField.getState().recordTape("region", strength, "earth/fault-slip");
        },
      },
      // pinch belongs to the axis here: /earth mounts AxisChrome with travel
      // on, so ScaleTravel owns the frame's radial channel end to end.
      // Exempt for want of material: `voice` (this is rock, not an
      // instrument surface), `span`, `drum`, `arpeggio`, `rhythm`, and
      // `breath` (the candle owns the breath site-wide).
      { wheelZoom: false },
    );

    // ——— the vessel: the device is the room's body ———
    const detachVessel = onVessel({
      tilt: ({ beta, gamma }) => {
        if (asleep) return;
        // gravity: the column leans, and the light leans with it
        lean = clamp(gamma / 45, -1, 1);
        if (!reduce) {
          // exponential approach: the coefficients are the resting lean, not
          // a per-sample kick, so a held tilt settles instead of pinning.
          shear.target = clamp(shear.target * 0.7 + lean * 0.18, -1, 1);
          frameX = clamp(frameX * 0.86 + lean * 4.2, -(OVERSCAN - 6), OVERSCAN - 6);
          frameY = clamp(frameY * 0.92 + clamp((beta - 45) / 90, -1, 1) * 1.6, -(OVERSCAN - 6), OVERSCAN - 6);
        }
      },
      shake: ({ intensity }) => {
        if (asleep) return;
        // this room is about quakes — a shaken vessel shakes the crust
        lastTouchAt = performance.now();
        quakeAt(viewW * (0.35 + hash(clock) * 0.3), Z.strataTop + (Z.strataBot - Z.strataTop) * 0.5, clamp(0.5 + intensity, 0.4, 1.6));
        pressure.target = 1;
      },
      knock: ({ intensity }) => {
        if (asleep) return;
        // a knock on the case is a knock on the ground: the trace rings
        lastTouchAt = performance.now();
        clickSpikes.push({ t0: clock, strength: 0.8 + intensity * 0.9 });
        quakeSpike = { t0: clock, strength: 0.35 + intensity * 0.35 };
        addFracture(viewW * 0.5, Z.surfaceBot, 0.4 + intensity * 0.4, "#f0b66d");
        try { audio.thud(); } catch { /* noop */ }
        haptics.chop();
        markEarth("knock", "#f0b66d");
      },
      flip: ({ faceDown }) => {
        nightTarget = faceDown ? 1 : 0;
        if (faceDown) {
          rain *= 0.4;
          timeTarget = 1;
          haptics.roll();
        }
      },
    });

    // ——— the desktop hover channel (grammar §1: hover ≈ light touch).
    // Not a gesture: a real analog sensor feeding the seismograph, the way
    // a working one reads footfalls in the room. Fine pointers only.
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    let hoverStratumId: string | null = null;
    const onHover = (event: MouseEvent) => {
      if (!fine.matches) return;
      const rect = fg.getBoundingClientRect();
      const x = event.clientX - rect.left - OVERSCAN - frameX;
      const y = event.clientY - rect.top - OVERSCAN - frameY;
      const now = performance.now();
      if (cursor.lastT > 0) {
        const dt = Math.max(1, now - cursor.lastT);
        cursor.vel = cursor.vel * 0.78 + (Math.hypot(x - cursor.x, y - cursor.y) / dt) * 0.22;
      }
      cursor.x = x;
      cursor.y = y;
      cursor.lastT = now;
      cursor.over = true;
      const next = stratumAt(y)?.id ?? null;
      if (next !== hoverStratumId) {
        hoverStratumId = next;
        setHoverStratum(next);
      }
    };
    const onHoverOut = () => {
      cursor.over = false;
      if (hoverStratumId !== null) {
        hoverStratumId = null;
        setHoverStratum(null);
      }
    };
    fg.addEventListener("mousemove", onHover);
    fg.addEventListener("mouseleave", onHoverOut);

    // ——————————————————————————————————————————————————————
    // the animated half
    // ——————————————————————————————————————————————————————

    const drawPressureBloom = (bloom: PressureBloom) => {
      const age = (clock - bloom.born) / 1000;
      const life = 2.6;
      if (age > life) return false;
      const t = age / life;
      const alpha = (1 - t) * bloom.strength;
      const radius = bloom.radius * (0.55 + t * 0.78);
      drawGlow(fgCtx, bloom.hue, bloom.x, bloom.y, radius, alpha * 0.62);
      drawGlow(fgCtx, "#fff0c8", bloom.x, bloom.y, radius * 0.42, alpha * 0.34);
      fgCtx.strokeStyle = colorAlpha(bloom.hue, alpha * 0.42);
      fgCtx.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        const rr = radius * (0.28 + i * 0.16);
        fgCtx.beginPath();
        fgCtx.ellipse(bloom.x, bloom.y, rr * (1.7 - i * 0.12), rr * 0.32, -0.16, 0, Math.PI * 2);
        fgCtx.stroke();
      }
      return true;
    };

    const drawFaultTrace = (fault: FaultTrace) => {
      const age = (clock - fault.born) / 1000;
      const life = 6.8;
      if (age > life) return false;
      const alpha = Math.max(0, 1 - age / life) * fault.strength;
      const dx = fault.x1 - fault.x0;
      const dy = fault.y1 - fault.y0;
      const len = Math.hypot(dx, dy) || 1;
      const px = -dy / len;
      const py = dx / len;
      fgCtx.save();
      fgCtx.lineCap = "round";
      // the halo, without shadowBlur: one wide additive stroke underneath
      fgCtx.globalCompositeOperation = "lighter";
      fgCtx.strokeStyle = colorAlpha(fault.hue, alpha * 0.13);
      fgCtx.lineWidth = 9;
      fgCtx.beginPath();
      fgCtx.moveTo(fault.x0, fault.y0);
      fgCtx.lineTo(fault.x1, fault.y1);
      fgCtx.stroke();
      fgCtx.globalCompositeOperation = "source-over";
      for (let i = -1; i <= 1; i++) {
        fgCtx.strokeStyle = i === 0 ? colorAlpha(fault.hue, alpha * 0.72) : colorAlpha("#030404", alpha * 0.5);
        fgCtx.lineWidth = i === 0 ? 1.4 + alpha : 2.3;
        fgCtx.beginPath();
        fgCtx.moveTo(fault.x0 + px * i * 4, fault.y0 + py * i * 4);
        fgCtx.lineTo(fault.x1 + px * i * 4, fault.y1 + py * i * 4);
        fgCtx.stroke();
      }
      fgCtx.restore();
      return true;
    };

    const drawBranch = (x: number, y: number, angle: number, length: number, depth: number) => {
      const endX = x + Math.cos(angle) * length;
      const endY = y + Math.sin(angle) * length;
      fgCtx.beginPath();
      fgCtx.moveTo(x, y);
      const midX = mix(x, endX, 0.55) + Math.cos(angle + Math.PI / 2) * Math.sin(length) * 6;
      const midY = mix(y, endY, 0.55) + Math.sin(angle + Math.PI / 2) * Math.sin(length) * 6;
      fgCtx.quadraticCurveTo(midX, midY, endX, endY);
      fgCtx.stroke();
      if (depth <= 0) return;
      drawBranch(endX, endY, angle + 0.38 + hash(length) * 0.34, length * 0.38, depth - 1);
      if (hash(length + depth) > 0.42) {
        drawBranch(endX, endY, angle - 0.48 - hash(length + 8) * 0.28, length * 0.32, depth - 1);
      }
    };

    const drawFracture = (fracture: Fracture) => {
      const age = (clock - fracture.born) / 1000;
      const life = 3.8;
      if (age > life) return false;
      const alpha = Math.max(0, 1 - age / life);
      drawGlow(fgCtx, fracture.hue, fracture.x, fracture.y, fracture.length * 0.5, alpha * 0.16);
      fgCtx.save();
      fgCtx.strokeStyle = colorAlpha(fracture.hue, alpha * 0.72);
      fgCtx.lineWidth = 1.1;
      fgCtx.lineCap = "round";
      const branches = Math.max(1, Math.round(fracture.branches * detail.samples));
      drawBranch(fracture.x, fracture.y, fracture.angle, fracture.length * (0.4 + (1 - alpha) * 0.6), branches);
      fgCtx.restore();
      return true;
    };

    const drawMineral = (mark: MineralMark, fossilSteps: number) => {
      const age = (clock - mark.born) / 1000;
      if (age > mark.life) return false;
      const t = age / mark.life;
      const alpha = Math.sin(Math.PI * clamp01(t)) * 0.82;
      const shimmer = 0.78 + Math.sin(clock * 0.004 + mark.phase) * 0.22;
      const radius = mark.size * (0.72 + t * 0.18);
      drawKind(fgCtx, mark.kind, mark.x, mark.y, radius, mark.hue, alpha * shimmer, mark.angle + age * 0.4, mark.phase + age, fossilSteps);
      return true;
    };

    const drawSpecimen = (sp: Specimen, fossilSteps: number, pulse: number) => {
      const stratum = STRATA[stratumIndex(sp.stratum)];
      const x = sp.nx * viewW;
      const y = sp.ny * viewH;
      const r = specimenRadius(sp);
      const breath = 0.82 + Math.sin(clock * 0.0016 + sp.seed * 0.37) * 0.18;
      const alpha = clamp01((0.5 + sp.depth * 0.45) * breath * (1 - night * 0.55) + pulse * 0.5);
      drawGlow(fgCtx, stratum.accent, x, y, r * (2.4 + pulse * 1.6), (0.16 + sp.depth * 0.2 + pulse * 0.4));
      drawKind(fgCtx, sp.kind, x, y, r, stratum.accent, alpha, hash(sp.seed) * Math.PI - Math.PI * 0.5, hash(sp.seed * 3) * Math.PI * 2, fossilSteps);
      if (sp.sealed) {
        // sealed into the rock: the ring the ceremony left
        fgCtx.strokeStyle = colorAlpha("#fff0c8", 0.24 + pulse * 0.3);
        fgCtx.lineWidth = 1;
        fgCtx.beginPath();
        fgCtx.ellipse(x, y, r * 2.1, r * 1.5, 0, 0, Math.PI * 2);
        fgCtx.stroke();
      }
    };

    const draw = (now: number) => {
      if (!running) {
        return;
      }
      tier = gov.beginFrame(now);
      detail = detailForTier(tier);
      const realDt = Math.min(64, now - lastFrameMs);
      lastFrameMs = now;

      if (asleep) {
        raf = requestAnimationFrame(draw);
        return;
      }

      // ——— the continuous scalars ———
      timeScale += (timeTarget - timeScale) * 0.12;
      const dt = realDt * (reduce ? 1 : timeScale);
      clock += dt;
      lens += (lensTarget - lens) * Math.min(1, realDt * 0.006);
      season += (seasonTarget - season) * Math.min(1, realDt * 0.004);
      night += (nightTarget - night) * Math.min(1, realDt * 0.003);
      rain *= Math.exp(-realDt * 0.00018);
      load *= Math.exp(-realDt * 0.00012);
      windX *= Math.exp(-realDt * 0.00022);
      frameX *= Math.exp(-realDt * 0.00006);
      frameY *= Math.exp(-realDt * 0.00006);
      shear.current += (shear.target - shear.current) * 0.09;
      pressure.target = Math.min(1, pressure.target + load * 0.004);
      pressure.current += (pressure.target - pressure.current) * 0.08;
      pressure.target *= 0.965;

      // the sun only moves when the room's law moves; the shade follows it
      // out of the frame loop, never in it.
      if (relief && Math.abs(sunAzimuth() - reliefSunAz) > 0.045 && now - reliefShadedAt > 170) {
        shadeRelief();
      }

      fgCtx.setTransform(
        fg.width / (viewW + OVERSCAN * 2),
        0,
        0,
        fg.height / (viewH + OVERSCAN * 2),
        (fg.width / (viewW + OVERSCAN * 2)) * (OVERSCAN + frameX),
        (fg.height / (viewH + OVERSCAN * 2)) * (OVERSCAN + frameY),
      );
      // one style write per real change, never per frame
      const framed = `translate3d(${frameX.toFixed(1)}px, ${frameY.toFixed(1)}px, 0)`;
      if (framed !== lastFramed) {
        lastFramed = framed;
        bg.style.transform = framed;
      }

      const x0 = spanX0();
      const x1 = spanX1();
      const spanW = x1 - x0;
      fgCtx.clearRect(x0 - frameX, -OVERSCAN - frameY, spanW + Math.abs(frameX) * 2 + 4, viewH + OVERSCAN * 2 + Math.abs(frameY) * 2 + 4);

      const fossilSteps = Math.max(12, Math.round(42 * detail.samples));
      const lensGround = clamp01(1 - lens);
      const lensColumn = clamp01(1 - Math.abs(lens - 1));
      const lensField = clamp01(lens - 1);

      // ——— the shear: the strata lean ———
      const sh = shear.current;
      if (Math.abs(sh) > 0.006) {
        const alpha = Math.min(0.22, Math.abs(sh) * 0.18);
        fgCtx.save();
        fgCtx.globalAlpha = alpha;
        fgCtx.fillStyle = sh > 0 ? "#bff8e1" : "#f0b66d";
        const offset = sh * 34;
        for (let i = 0; i < STRATA.length; i++) {
          const y0 = stratumY0(STRATA[i], Z);
          const y1 = stratumY1(STRATA[i], Z);
          const o = offset * (i % 2 ? -1 : 1);
          fgCtx.beginPath();
          fgCtx.moveTo(x0 + o, y0);
          fgCtx.lineTo(x1 + o, y0 + 4);
          fgCtx.lineTo(x1, y1);
          fgCtx.lineTo(x0, y1 - 4);
          fgCtx.closePath();
          fgCtx.fill();
        }
        fgCtx.restore();
      }

      // ——— deep time: the column depositing and eroding ———
      if (season > 0.001 && !reduce) {
        const sweep = Z.strataTop + (Z.strataBot - Z.strataTop) * clamp01(season);
        fgCtx.save();
        fgCtx.globalCompositeOperation = "lighter";
        fgCtx.strokeStyle = colorAlpha("#f2dfb5", 0.08 + season * 0.1);
        fgCtx.lineWidth = 1;
        drawWarpedLine(fgCtx, x0, x1, sweep, 2.6, clock * 0.0004);
        fgCtx.stroke();
        drawGlow(fgCtx, "#f2dfb5", viewW * 0.5, sweep, viewW * 0.6, 0.05 + season * 0.06);
        fgCtx.restore();
        // deposition rains down onto the sweep line, erosion strips above it
        const grains = Math.round(14 * detail.particles * season);
        fgCtx.fillStyle = colorAlpha("#d49b55", 0.2 + season * 0.2);
        for (let i = 0; i < grains; i++) {
          const t = ((clock * 0.00013 + hash(i * 7.7)) % 1);
          const gx = x0 + hash(i * 3.1) * spanW;
          const gy = mix(Z.surfaceTop, sweep, t);
          fgCtx.fillRect(gx, gy, 1.4, 2.6);
        }
      }

      // ——— weather: rain, and the crust taking the load ———
      if (rain > 0.01 && !reduce) {
        const drops = Math.round(90 * rain * detail.particles);
        fgCtx.save();
        fgCtx.strokeStyle = colorAlpha("#9bc6c1", 0.1 + rain * 0.3);
        fgCtx.lineWidth = 1;
        fgCtx.beginPath();
        for (let i = 0; i < drops; i++) {
          const phase = (clock * 0.0011 * (0.7 + hash(i * 5.3) * 0.6) + hash(i * 2.1)) % 1;
          const rx = x0 + ((hash(i * 9.7) + windX * phase * 0.3) % 1 + 1) % 1 * spanW;
          const ry = mix(-OVERSCAN, Z.surfaceBot, phase);
          fgCtx.moveTo(rx, ry);
          fgCtx.lineTo(rx + windX * 9, ry + 11 + rain * 8);
        }
        fgCtx.stroke();
        fgCtx.restore();
        if (hash(Math.floor(clock / 260)) < rain * 0.5) {
          addMineralMark({
            x: x0 + hash(clock * 0.31) * spanW,
            y: Z.surfaceBot - 4,
            life: 2.2,
            size: 8 + hash(clock) * 10,
            hue: "#d49b55",
            kind: "sediment",
            angle: 0,
            phase: hash(clock * 0.7) * Math.PI * 2,
          });
        }
      }
      if (load > 0.02) {
        fgCtx.save();
        fgCtx.globalAlpha = load * 0.16;
        fgCtx.fillStyle = "#f06f3f";
        fgCtx.fillRect(x0, Z.strataBot - (Z.strataBot - Z.strataTop) * 0.22 * load, spanW, (Z.strataBot - Z.strataTop) * 0.22 * load);
        fgCtx.restore();
      }

      // ——— the stratum that answered last ———
      if (activeStratum) {
        const age = (clock - activeStratum.t0) / 1000;
        if (age > 3.2) {
          activeStratum = null;
        } else {
          const stratum = STRATA.find((item) => item.id === activeStratum?.id);
          if (stratum) {
            const y0 = stratumY0(stratum, Z);
            const y1 = stratumY1(stratum, Z);
            const alpha = (1 - age / 3.2) * (0.28 + pressure.current * 0.18);
            fgCtx.save();
            fgCtx.globalCompositeOperation = "lighter";
            fgCtx.globalAlpha = alpha * 0.55;
            fgCtx.fillStyle = colorAlpha(stratum.accent, 0.5);
            fgCtx.fillRect(x0, y0, spanW, y1 - y0);
            fgCtx.restore();
            fgCtx.strokeStyle = colorAlpha(stratum.accent, alpha + 0.14);
            fgCtx.lineWidth = 1.2;
            drawWarpedLine(fgCtx, x0, x1, y0 + 1, 1.8, age);
            fgCtx.stroke();
            drawWarpedLine(fgCtx, x0, x1, y1 - 1, 1.8, age + 1.2);
            fgCtx.stroke();
          }
        }
      }

      // ——— the room's solemn act, running down the column ———
      if (coreRing) {
        const age = (clock - coreRing.t0) / 1000;
        const span = 2.9;
        if (age > span) coreRing = null;
        else {
          const t = age / span;
          const front = mix(Z.surfaceTop, Z.seismoBot, t);
          for (let i = 0; i < STRATA.length; i++) {
            const y0 = stratumY0(STRATA[i], Z);
            const y1 = stratumY1(STRATA[i], Z);
            const d = Math.abs((y0 + y1) * 0.5 - front) / Math.max(1, viewH * 0.14);
            const a = Math.exp(-d * d) * (1 - t * 0.4) * coreRing.strength;
            if (a < 0.01) continue;
            fgCtx.save();
            fgCtx.globalCompositeOperation = "lighter";
            fgCtx.globalAlpha = a * 0.42;
            fgCtx.fillStyle = colorAlpha(STRATA[i].accent, 0.6);
            fgCtx.fillRect(x0, y0, spanW, y1 - y0);
            fgCtx.restore();
          }
          drawGlow(fgCtx, "#fff0c8", viewW * 0.5, front, viewW * 0.7, 0.16 * (1 - t) * coreRing.strength);
        }
      }

      // ——— the transient material ———
      for (let i = blooms.length - 1; i >= 0; i--) {
        if (!drawPressureBloom(blooms[i])) blooms.splice(i, 1);
      }
      for (let i = faults.length - 1; i >= 0; i--) {
        if (!drawFaultTrace(faults[i])) faults.splice(i, 1);
      }
      for (let i = fractures.length - 1; i >= 0; i--) {
        if (!drawFracture(fractures[i])) fractures.splice(i, 1);
      }
      for (let i = mineralMarks.length - 1; i >= 0; i--) {
        if (!drawMineral(mineralMarks[i], fossilSteps)) mineralMarks.splice(i, 1);
      }

      // ——— what the ground keeps ———
      const tuttiAge = (clock - tuttiAt) / 1000;
      const tuttiPulse = tuttiAge >= 0 && tuttiAge < 1.4 ? Math.sin(Math.PI * (1 - tuttiAge / 1.4)) * 0.8 : 0;
      for (let i = 0; i < specimens.length; i++) drawSpecimen(specimens[i], fossilSteps, tuttiPulse);

      // ——— the creation, legible while it happens ———
      if (gathering) {
        // the gather ramps from the touch tier to the dwell tier, so it is
        // fully formed exactly when the specimen commits — the hand sees the
        // verb happen rather than being told about it
        const age = clock - gathering.t0;
        const t = clamp01(age / 650);
        const r = 3 + t * 13;
        drawGlow(fgCtx, gathering.hue, gathering.x, gathering.y, r * 3.4, 0.12 + t * 0.36);
        fgCtx.save();
        fgCtx.globalAlpha = 0.2 + t * 0.5;
        drawKind(fgCtx, gathering.kind, gathering.x, gathering.y, r, gathering.hue, 0.3 + t * 0.55, -Math.PI * 0.5, t * 3, fossilSteps);
        fgCtx.restore();
      }

      // ——— the lenses ———
      if (lensColumn > 0.01) {
        fgCtx.save();
        fgCtx.globalAlpha = lensColumn;
        fgCtx.fillStyle = "rgba(5, 6, 6, 0.4)";
        fgCtx.fillRect(x0, Z.surfaceTop, spanW, Z.strataBot - Z.surfaceTop);
        for (let i = 0; i < STRATA.length; i++) {
          const y0 = stratumY0(STRATA[i], Z);
          const y1 = stratumY1(STRATA[i], Z);
          fgCtx.fillStyle = colorAlpha(STRATA[i].accent, 0.8);
          fgCtx.fillRect(x0 + OVERSCAN + 10, y0 + 1, 16, Math.max(1, y1 - y0 - 2));
          fgCtx.strokeStyle = colorAlpha(STRATA[i].accent, 0.3);
          fgCtx.lineWidth = 0.8;
          fgCtx.beginPath();
          fgCtx.moveTo(x0 + OVERSCAN + 32, y0);
          fgCtx.lineTo(x1, y0);
          fgCtx.stroke();
          // depth ticks — the column measured, never labelled
          const ticks = Math.max(2, Math.round((y1 - y0) / 22));
          fgCtx.strokeStyle = colorAlpha("#f2dfb5", 0.22);
          for (let k = 1; k < ticks; k++) {
            const ty = mix(y0, y1, k / ticks);
            fgCtx.beginPath();
            fgCtx.moveTo(x0 + OVERSCAN + 32, ty);
            fgCtx.lineTo(x0 + OVERSCAN + 32 + (k % 2 ? 7 : 13), ty);
            fgCtx.stroke();
          }
        }
        fgCtx.restore();
      }
      if (lensField > 0.01) {
        const ex = epicenterX * viewW;
        const ey = epicenterY * viewH;
        fgCtx.save();
        fgCtx.globalAlpha = lensField;
        fgCtx.fillStyle = "rgba(4, 5, 6, 0.55)";
        fgCtx.fillRect(x0, -OVERSCAN, spanW, viewH + OVERSCAN * 2);
        fgCtx.globalCompositeOperation = "lighter";
        fgCtx.strokeStyle = "rgba(240, 111, 63, 0.34)";
        fgCtx.lineWidth = 1;
        const rings = Math.max(4, Math.round(11 * detail.samples));
        for (let i = 0; i < rings; i++) {
          const phase = ((clock * 0.00016 + i / rings) % 1);
          const rr = phase * Math.hypot(viewW, viewH) * 0.8;
          fgCtx.globalAlpha = lensField * (1 - phase) * 0.5;
          fgCtx.beginPath();
          fgCtx.ellipse(ex, ey, rr, rr * 0.62, 0, 0, Math.PI * 2);
          fgCtx.stroke();
        }
        fgCtx.restore();
      }

      // ——— the ground is never still ———
      if (!reduce && lensGround > 0.02) {
        const drifters = Math.max(1, Math.round(3 * detail.particles));
        for (let i = 0; i < drifters; i++) {
          const t = (clock * 0.00003 + i * 0.31) % 1;
          const y = mix(Z.strataTop, Z.strataBot, t);
          const x = (hash(i * 127 + Math.floor(clock / 6000)) * 0.8 + 0.1) * viewW;
          drawGlint(fgCtx, x, y, 3.5 + i, STRATA[(i + 2) % STRATA.length].accent, 0.09 * lensGround, clock * 0.0004 + i);
        }
      }

      // ——— the seismograph ———
      cursor.vel *= 0.92;
      let spike = 0;
      for (let i = clickSpikes.length - 1; i >= 0; i--) {
        const s = clickSpikes[i];
        const age = (clock - s.t0) / 1000;
        if (age > 1.7) {
          clickSpikes.splice(i, 1);
          continue;
        }
        spike += s.strength * Math.exp(-age * 2.8);
      }
      let quakeMag = 0;
      if (quakeSpike) {
        const age = (clock - quakeSpike.t0) / 1000;
        if (age > 2.8) quakeSpike = null;
        else quakeMag = quakeSpike.strength * Math.exp(-age * 1.35) * Math.cos(age * 30);
      }
      // micro-seismicity: the ground has its own pulse, and it is seeded —
      // determinism law, no Math.random in the render loop.
      const tick = Math.floor(clock / 16.7);
      const micro = (hash(tick * 0.618) - 0.5) * 0.045
        + Math.sin(clock * 0.0007) * 0.012
        + (hash(Math.floor(clock / 3100)) > 0.86 ? Math.sin(clock * 0.02) * 0.06 : 0);
      const magnitude = clamp(cursor.vel * 0.9, 0, 1.7)
        + spike
        + quakeMag
        + pressure.current * 0.32
        + Math.abs(sh) * 0.28
        + rain * 0.08
        + micro;

      seismoBuf[seismoHead] = magnitude;
      if (!reduce) seismoHead = (seismoHead + 1) % SEISMO_SAMPLES;

      const seismoH = Z.seismoBot - Z.seismoTop;
      const baseY = Z.seismoTop + seismoH * 0.5;
      const ampPx = seismoH * 0.37 * (1 + lensField * 0.5);
      const oldest = seismoHead;
      const step = Math.max(1, Math.round(1 / Math.max(0.25, detail.samples)));
      fgCtx.save();
      fgCtx.lineCap = "round";
      // the trace's own light, twice-stroked instead of shadow-blurred
      fgCtx.globalCompositeOperation = "lighter";
      for (let pass = 0; pass < 2; pass++) {
        fgCtx.strokeStyle = pass === 0 ? "rgba(248, 214, 137, 0.09)" : "#f2dfb5";
        fgCtx.lineWidth = pass === 0 ? 5.5 : 1.35;
        fgCtx.beginPath();
        for (let i = 0; i < SEISMO_SAMPLES; i += step) {
          const idx = (oldest + i) % SEISMO_SAMPLES;
          const v = clamp(seismoBuf[idx], -2.4, 2.4);
          const x = x0 + (i / (SEISMO_SAMPLES - 1)) * spanW;
          const y = baseY - v * (ampPx / 2.4);
          if (i === 0) fgCtx.moveTo(x, y);
          else fgCtx.lineTo(x, y);
        }
        fgCtx.stroke();
      }
      fgCtx.restore();

      // ——— the glimmer: no labels, ever — only a physical hint ———
      if (!reduce && now - lastTouchAt > 20000 && now - glimmerAt > 7000) glimmerAt = now;
      if (glimmerAt && now - glimmerAt < 1800) {
        const u = (now - glimmerAt) / 1800;
        const gy = Z.strataTop + (Z.strataBot - Z.strataTop) * 0.42;
        fgCtx.save();
        fgCtx.globalAlpha = (1 - u) * 0.3;
        fgCtx.strokeStyle = "rgba(255, 240, 200, 0.7)";
        fgCtx.lineWidth = 1;
        fgCtx.beginPath();
        fgCtx.ellipse(viewW * 0.5, gy, 16 + u * 70, (16 + u * 70) * 0.4, 0, 0, Math.PI * 2);
        fgCtx.stroke();
        fgCtx.restore();
      }

      // ——— face-down is night ———
      if (night > 0.01) {
        fgCtx.save();
        fgCtx.globalAlpha = night * 0.72;
        fgCtx.fillStyle = "#03060a";
        fgCtx.fillRect(x0 - Math.abs(frameX), -OVERSCAN - Math.abs(frameY), spanW + Math.abs(frameX) * 2, viewH + OVERSCAN * 2 + Math.abs(frameY) * 2);
        fgCtx.restore();
      }

      if (now - lastReadoutMs > 110) {
        lastReadoutMs = now;
        setReadouts({
          magnitude: Math.min(9, Math.abs(magnitude) * 4.4).toFixed(1),
          pressure: pressure.current.toFixed(2),
          slip: Math.round(sh * 100).toString(),
        });
      }

      raf = requestAnimationFrame(draw);
    };

    // ——— keyboard: every verb needs a path that is not a finger ———
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (target && target.tagName === "BUTTON" && (event.key === "Enter" || event.key === " ")) return;
      const cx = cursor.over ? cursor.x : viewW * 0.5;
      const cy = cursor.over ? cursor.y : Z.strataTop + (Z.strataBot - Z.strataTop) * 0.5;
      if (event.key === "Enter") {
        const made = plantSpecimen(cx, cy, 0.42);
        if (made < 0) tapAt(cx, cy, 0.6);
        lastTouchAt = performance.now();
      } else if (event.key === "Backspace" || event.key === "Delete") {
        if (specimens.length) {
          event.preventDefault();
          takeBack(specimens.length - 1);
        }
        lastTouchAt = performance.now();
      } else if (event.key === "ArrowLeft") {
        seasonTarget = clamp01(seasonTarget - 0.08);
        lastTouchAt = performance.now();
      } else if (event.key === "ArrowRight") {
        seasonTarget = clamp01(seasonTarget + 0.08);
        lastTouchAt = performance.now();
      } else if (event.key === "ArrowUp") {
        lensTarget = clamp(lensTarget + 1, 0, 2);
        markLens();
        haptics.lens();
        lastTouchAt = performance.now();
      } else if (event.key === "ArrowDown") {
        lensTarget = clamp(lensTarget - 1, 0, 2);
        markLens();
        haptics.lens();
        lastTouchAt = performance.now();
      } else if (event.key === "0") {
        frameX = 0;
        frameY = 0;
        lensTarget = 0;
        markLens();
      }
    };
    window.addEventListener("keydown", onKey);

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    actionRef.current = {
      activateStratum: (id: string) => {
        const stratum = STRATA.find((item) => item.id === id);
        if (!stratum) return;
        const y0 = stratumY0(stratum, Z);
        const y1 = stratumY1(stratum, Z);
        const x = viewW * (0.34 + hash(id.length * 27) * 0.34);
        seedMineral(x, mix(y0, y1, 0.52), stratum, 1.05);
        lastTouchAt = performance.now();
      },
      quake: () => {
        quakeAt(viewW * 0.5, Z.seismoTop + (Z.seismoBot - Z.seismoTop) * 0.5, 1);
        lastTouchAt = performance.now();
      },
      compress: () => {
        compressAt(viewW * 0.5, Z.strataTop + (Z.strataBot - Z.strataTop) * 0.56, 1);
        lastTouchAt = performance.now();
      },
    };
    (window as unknown as Record<string, unknown>).__earth = { ready: true, ...actionRef.current };

    // The exhale. An empty store is a remembered state: writing it out is
    // what stops the ground respawning what a hand deliberately let go.
    wrap.__letGo = () => {
      specimens = [];
      mineralMarks = [];
      faults = [];
      blooms = [];
      fractures = [];
      clickSpikes.length = 0;
      quakeSpike = null;
      coreRing = null;
      activeStratum = null;
      gathering = null;
      shear.target = 0;
      shear.current = 0;
      pressure.target = 0;
      pressure.current = 0;
      rain = 0;
      load = 0;
      seismoBuf.fill(0);
      seismoHead = 0;
      writer.cancel();
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ specimens: [] }));
      } catch {
        /* noop */
      }
      setHasKept(false);
      setActiveStratumId(null);
      setHoverStratum(null);
      setReadouts({ magnitude: "0.0", pressure: "0.00", slip: "0" });
      setEarthMarks([{ label: "quiet core", tone: "#b8ee78", t: performance.now() }]);
      useField.getState().recordTape("ripple", 0.24, "earth/quiet-core");
    };

    raf = requestAnimationFrame(draw);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      detachGestures();
      detachVessel();
      unvis();
      ungal();
      writer.flush();
      if (reliefTimer !== null) window.clearTimeout(reliefTimer);
      for (const timer of clearTimers) window.clearTimeout(timer);
      clearTimers.clear();
      fg.removeEventListener("mousemove", onHover);
      fg.removeEventListener("mouseleave", onHoverOut);
      window.removeEventListener("keydown", onKey);
      delete wrap.dataset.lensRaised;
      actionRef.current = null;
      delete (window as unknown as { __earth?: unknown }).__earth;
    };
  }, [markEarth]);

  const letGo = useCallback(() => {
    const wrap = wrapRef.current as WrapEl | null;
    wrap?.__letGo?.();
    try { getFieldAudio().bell(); } catch { /* noop */ }
    try { haptics.roll(); } catch { /* noop */ }
    setHasKept(false);
  }, []);

  const activeStratum = activeStratumId
    ? STRATA.find((stratum) => stratum.id === activeStratumId)
    : null;
  const inscription = activeStratum?.inscription ?? null;
  const hoverLabel = hoverStratum
    ? STRATA.find((stratum) => stratum.id === hoverStratum)?.name ?? null
    : null;
  const activeLayerName = activeStratum?.name ?? (activeStratumId ? "strata" : "quiet core");

  return (
    <div
      ref={wrapRef}
      className="earth-instrument"
      data-touch-surface="true"
      data-pretext-ignore="true"
      aria-label="earth - geologic pressure instrument"
    >
      <canvas ref={bgRef} aria-hidden="true" className="earth-canvas" />
      <canvas ref={fgRef} aria-hidden="true" className="earth-canvas earth-canvas--touch" />

      <div className="earth-title">
        <div className="earth-kicker">earth / mineral pressure instrument</div>
        <h1>TERRA</h1>
        <div className="earth-subtitle">strata, vein, fault, deep time</div>
      </div>

      {inscription && (
        <div className="earth-inscription">
          {inscription}
        </div>
      )}

      {hoverLabel && (
        <div className="earth-hover">
          {hoverLabel}
        </div>
      )}

      <MobileInstrumentPanel
        className="earth-mobile-panel"
        title="strata & history"
        triggerLabel="tune"
        summary={`${activeLayerName} · M ${readouts.magnitude}`}
      >
        <div className="earth-controls">
          <div className="earth-rail" role="group" aria-label="strata">
            {STRATA.map((stratum) => (
              <button
                key={stratum.id}
                type="button"
                onClick={() => activateLayer(stratum.id)}
                aria-pressed={activeStratumId === stratum.id}
                aria-label={stratum.inscription}
              >
                <i style={{ background: stratum.accent, boxShadow: activeStratumId === stratum.id ? `0 0 16px ${stratum.accent}` : undefined }} />
                <span>{stratum.name}</span>
              </button>
            ))}
          </div>

          <div className="earth-actions" aria-label="geologic actions">
            <button type="button" onClick={() => actionRef.current?.compress()}>compress</button>
            <button type="button" onClick={() => actionRef.current?.quake()}>quake</button>
          </div>

          <div className="earth-memory" data-earth-memory="true" aria-live="polite">
            {earthMarks.map((mark, index) => (
              <span key={`${mark.label}-${mark.t}-${index}`}>
                <i style={{ background: mark.tone, boxShadow: index === 0 ? `0 0 14px ${mark.tone}` : undefined }} />
                <b>{mark.label}</b>
              </span>
            ))}
          </div>

          <div className="earth-readouts" aria-label="geologic readouts">
            <output>
              <span>magnitude</span>
              <strong>{readouts.magnitude}</strong>
            </output>
            <output>
              <span>pressure</span>
              <strong>{readouts.pressure}</strong>
            </output>
            <output>
              <span>slip</span>
              <strong>{readouts.slip}</strong>
            </output>
          </div>
        </div>
      </MobileInstrumentPanel>

      <LetGo label="let the ground rest" onLetGo={letGo} visible={hasKept} />

      <style
        dangerouslySetInnerHTML={{
          __html: `
            .earth-instrument {
              position: fixed;
              inset: 0;
              overflow: hidden;
              background: #050606;
              color: rgba(246, 240, 224, 0.94);
              isolation: isolate;
            }

            .earth-canvas {
              position: absolute;
              left: -${OVERSCAN}px;
              top: -${OVERSCAN}px;
              width: calc(100% + ${OVERSCAN * 2}px);
              height: calc(100% + ${OVERSCAN * 2}px);
              display: block;
              will-change: transform;
            }

            .earth-canvas--touch {
              touch-action: none;
              cursor: crosshair;
              z-index: 1;
            }

            .earth-controls {
              display: contents;
            }

            .earth-actions {
              display: none;
            }

            .earth-title {
              position: absolute;
              z-index: 3;
              top: calc(74px + env(safe-area-inset-top, 0px));
              left: var(--pad-x);
              width: min(600px, calc(100vw - var(--pad-x) * 2));
              pointer-events: none;
              text-shadow: 0 18px 60px rgba(0, 0, 0, 0.74);
            }

            .earth-kicker {
              margin-bottom: 12px;
              color: rgba(246, 240, 224, 0.58);
              font-family: var(--font-mono, ui-monospace, monospace);
              font-size: 11px;
              letter-spacing: 0;
              text-transform: lowercase;
            }

            .earth-title h1 {
              margin: 0;
              font-family: var(--font-fraunces, var(--font-serif, Georgia), serif);
              font-weight: 500;
              font-size: clamp(54px, 8vw, 112px);
              line-height: 0.88;
              letter-spacing: 0;
              background: linear-gradient(180deg, #fff5d8 0%, #d5bc84 38%, #8ff1ca 70%, #d16b3d 100%);
              -webkit-background-clip: text;
              background-clip: text;
              -webkit-text-fill-color: transparent;
              color: #f4dfad;
            }

            .earth-subtitle {
              margin-top: 12px;
              color: rgba(246, 240, 224, 0.66);
              font-family: var(--font-serif, Georgia, serif);
              font-size: clamp(17px, 2.2vw, 25px);
              font-style: italic;
              letter-spacing: 0;
            }

            .earth-inscription,
            .earth-hover {
              position: absolute;
              z-index: 4;
              pointer-events: none;
              font-family: var(--font-mono, ui-monospace, monospace);
              letter-spacing: 0;
              text-transform: lowercase;
            }

            .earth-inscription {
              left: 50%;
              top: 47%;
              transform: translate(-50%, -50%);
              max-width: calc(100vw - 32px);
              padding: 8px 12px;
              border: 1px solid rgba(255, 240, 200, 0.24);
              border-radius: 6px;
              background: rgba(5, 6, 6, 0.58);
              backdrop-filter: blur(10px);
              -webkit-backdrop-filter: blur(10px);
              color: rgba(255, 240, 200, 0.96);
              font-size: 12px;
              white-space: nowrap;
              box-shadow: 0 18px 48px rgba(0, 0, 0, 0.36);
            }

            .earth-hover {
              top: calc(68px + env(safe-area-inset-top, 0px));
              right: 18px;
              color: rgba(246, 240, 224, 0.66);
              font-size: 11px;
            }

            .earth-rail {
              position: absolute;
              z-index: 5;
              right: calc(18px + env(safe-area-inset-right, 0px));
              top: 24%;
              display: grid;
              gap: 6px;
              width: 148px;
            }

            .earth-rail button {
              appearance: none;
              display: grid;
              grid-template-columns: 18px minmax(0, 1fr);
              align-items: center;
              gap: 8px;
              min-height: 33px;
              padding: 6px 8px;
              border: 1px solid rgba(246, 240, 224, 0.14);
              border-radius: 7px;
              background: rgba(5, 6, 6, 0.46);
              color: rgba(246, 240, 224, 0.64);
              backdrop-filter: blur(10px);
              -webkit-backdrop-filter: blur(10px);
              cursor: pointer;
              font-family: var(--font-mono, ui-monospace, monospace);
              font-size: 10px;
              letter-spacing: 0;
              text-transform: lowercase;
              text-align: left;
              transition: color 160ms ease, border-color 160ms ease, background 160ms ease;
            }

            .earth-rail button:hover,
            .earth-rail button[aria-pressed="true"] {
              color: rgba(255, 246, 220, 0.96);
              border-color: rgba(255, 240, 200, 0.36);
              background: rgba(255, 240, 200, 0.08);
            }

            .earth-rail i,
            .earth-memory i {
              display: block;
              flex: 0 0 auto;
            }

            .earth-rail i {
              width: 18px;
              height: 2px;
            }

            .earth-rail span {
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            }

            .earth-memory {
              position: absolute;
              z-index: 5;
              left: 18px;
              bottom: calc(92px + env(safe-area-inset-bottom, 0px));
              display: flex;
              align-items: center;
              gap: 9px;
              max-width: min(520px, calc(100vw - 310px));
              padding: 8px 10px;
              border: 1px solid rgba(246, 240, 224, 0.14);
              border-radius: 7px;
              background: rgba(5, 6, 6, 0.52);
              backdrop-filter: blur(10px);
              -webkit-backdrop-filter: blur(10px);
              color: rgba(246, 240, 224, 0.68);
              font-family: var(--font-mono, ui-monospace, monospace);
              font-size: 10px;
              letter-spacing: 0;
              text-transform: lowercase;
              pointer-events: none;
            }

            .earth-memory span {
              display: inline-flex;
              align-items: center;
              min-width: 0;
              gap: 6px;
              opacity: 0.48;
              white-space: nowrap;
            }

            .earth-memory span:first-child {
              opacity: 1;
            }

            .earth-memory i {
              width: 10px;
              height: 2px;
            }

            .earth-memory span:first-child i {
              width: 26px;
            }

            .earth-memory b {
              min-width: 0;
              overflow: hidden;
              text-overflow: ellipsis;
              font-weight: 400;
            }

            .earth-readouts {
              position: absolute;
              z-index: 5;
              right: calc(184px + env(safe-area-inset-right, 0px));
              bottom: calc(82px + env(safe-area-inset-bottom, 0px));
              display: grid;
              grid-template-columns: repeat(3, minmax(66px, auto));
              gap: 8px;
              pointer-events: none;
            }

            .earth-readouts output {
              display: grid;
              gap: 2px;
              min-width: 66px;
              padding: 8px 9px 7px;
              border: 1px solid rgba(246, 240, 224, 0.13);
              border-radius: 7px;
              background: rgba(5, 6, 6, 0.46);
              backdrop-filter: blur(10px);
              -webkit-backdrop-filter: blur(10px);
              text-align: right;
            }

            .earth-readouts span {
              color: rgba(246, 240, 224, 0.48);
              font-family: var(--font-mono, ui-monospace, monospace);
              font-size: 9px;
              letter-spacing: 0;
              text-transform: lowercase;
            }

            .earth-readouts strong {
              color: rgba(255, 240, 200, 0.96);
              font-family: var(--font-fraunces, var(--font-serif, Georgia), serif);
              font-size: 25px;
              line-height: 1;
              font-weight: 520;
              font-variant-numeric: tabular-nums;
            }

            body:has(.earth-instrument) header:not(.oda-site-header) {
              background: transparent !important;
              border-bottom: 0 !important;
              backdrop-filter: none !important;
              -webkit-backdrop-filter: none !important;
            }

            body:has(.earth-instrument) .oda-field-watch,
            body:has(.earth-instrument) .oda-candle-mark,
            body:has(.earth-instrument) .oda-tape-shell,
            body:has(.earth-instrument) .oda-sound-toggle {
              display: none !important;
            }

            @media (hover: none), (pointer: coarse) {
              .earth-hover {
                display: none !important;
              }
            }

            @media (max-width: 820px) {
              .earth-title {
                top: calc(70px + env(safe-area-inset-top, 0px));
                left: 16px;
                right: 16px;
                width: auto;
              }

              .earth-title h1 {
                font-size: clamp(44px, 16vw, 70px);
              }

              .earth-subtitle {
                font-size: 17px;
              }

              .earth-rail {
                left: 12px;
                right: 12px;
                top: auto;
                bottom: calc(126px + env(safe-area-inset-bottom, 0px));
                width: auto;
                display: flex;
                gap: 6px;
                overflow-x: auto;
                overscroll-behavior-x: contain;
                scroll-snap-type: x proximity;
                padding-bottom: 2px;
                -webkit-overflow-scrolling: touch;
              }

              .earth-rail button {
                flex: 0 0 116px;
                scroll-snap-align: start;
                min-height: 38px;
                padding: 7px 8px;
              }

              .earth-memory {
                left: 12px;
                right: 12px;
                bottom: calc(72px + env(safe-area-inset-bottom, 0px));
                max-width: none;
                gap: 7px;
              }

              .earth-memory span:nth-child(n+4) {
                display: none;
              }

              .earth-readouts {
                left: 12px;
                right: 12px;
                bottom: calc(14px + env(safe-area-inset-bottom, 0px));
                grid-template-columns: repeat(3, minmax(0, 1fr));
                gap: 7px;
              }

              .earth-readouts output {
                min-width: 0;
                padding: 7px 8px;
              }

              .earth-readouts strong {
                font-size: 21px;
              }

              .earth-inscription {
                top: 43%;
                font-size: 11px;
              }
            }

            @media (max-width: 430px) {
              .earth-kicker {
                font-size: 10px;
              }

              .earth-subtitle {
                max-width: 270px;
              }

              .earth-memory span:nth-child(n+3) {
                display: none;
              }
            }

            /* the shore's furniture and this room's readouts share the
               bottom edge; the parting word steps above them */
            body:has(.earth-instrument) .oda-letgo {
              bottom: calc(58px + env(safe-area-inset-bottom, 0px));
            }

            @media (max-width: 720px) {
              body:has(.earth-instrument) .oda-letgo {
                bottom: calc(96px + env(safe-area-inset-bottom, 0px));
              }

              .earth-mobile-panel .mobile-instrument-panel__trigger {
                border-color: rgba(216, 200, 168, 0.42);
                background: rgba(10, 9, 8, 0.86);
              }

              .mobile-instrument-panel__content .earth-controls {
                display: grid;
                gap: 10px;
              }

              .mobile-instrument-panel__content .earth-rail {
                position: relative !important;
                inset: auto !important;
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 7px;
                width: 100%;
                padding: 0;
                overflow: visible;
              }

              .mobile-instrument-panel__content .earth-rail button {
                min-width: 0;
                min-height: 44px;
                padding: 8px 10px;
              }

              .mobile-instrument-panel__content .earth-actions {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 7px;
              }

              .earth-actions button {
                min-width: 0;
                min-height: 44px;
                border: 1px solid rgba(246, 240, 224, 0.2);
                border-radius: 7px;
                padding: 8px;
                background: rgba(246, 240, 224, 0.06);
                color: rgba(246, 240, 224, 0.82);
                font: 9px/1.15 var(--font-mono, ui-monospace, monospace);
                letter-spacing: 0.05em;
                text-transform: lowercase;
              }

              .mobile-instrument-panel__content .earth-memory {
                position: relative !important;
                inset: auto !important;
                display: flex;
                flex-wrap: wrap;
                gap: 7px 10px;
                max-width: none;
                padding: 9px 10px;
              }

              .mobile-instrument-panel__content .earth-memory span,
              .mobile-instrument-panel__content .earth-memory span:nth-child(n+3),
              .mobile-instrument-panel__content .earth-memory span:nth-child(n+4) {
                display: inline-flex;
              }

              .mobile-instrument-panel__content .earth-readouts {
                position: relative !important;
                inset: auto !important;
                display: grid;
                grid-template-columns: repeat(3, minmax(0, 1fr));
                gap: 7px;
              }
            }

            @media (prefers-reduced-motion: reduce) {
              .earth-canvas {
                will-change: auto;
              }
            }
          `,
        }}
      />
    </div>
  );
}
