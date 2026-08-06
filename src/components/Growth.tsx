"use client";

/**
 * /growth — the living curve field, its vines now carrying real species (W4b).
 *
 * The vines keep their mathematics (sigmoid / exponential / decay / lifecycle)
 * but everything that blossoms on them is a point in the botany latent
 * (src/lib/botany.ts): each vine folds its planting into a seed, each blossom
 * node hashes that seed with its node index, and the same species opens there
 * forever — /flowers and /growth share one genetics. A node's bud ripens as
 * its branch matures (src/lib/growth-phenology.ts) and the hand's dwell
 * carries it the last step, bud → bloom → close, the bell and haptics.bloom()
 * landing exactly at peak. The hand speaks the shared grammar through
 * lib/gesture: tap seeds, drag bends the field, dwell forces or blooms, three
 * fingers are wind and time, a twist leans the room from felt vines toward
 * the bare equations. Nothing is stored: a blossom is a pure function of
 * vine seed + node.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { tapTrainDepth, tapTrainTier } from "@/lib/gesture/core";
import { onVessel } from "@/lib/vessel";
import { useField } from "@/store/field";
import MobileInstrumentPanel from "@/components/MobileInstrumentPanel";
import LetGo from "@/components/LetGo";
import {
  BLOOM_PEAK,
  flowerGeometry,
  hashSeed,
  petalOutline,
  speciesFromSeed,
  type FlowerGeometry,
  type Species,
} from "@/lib/botany";
import { nodePhenophase } from "@/lib/growth-phenology";
import {
  createFrameGovernor,
  detailForTier,
  onVisibility,
  onGalleryPause,
  resolveDpr,
  isEmbeddedFrame,
} from "@/lib/room-runtime";

type GrowthMode = "sigmoid" | "exponential" | "decay" | "cycle";

type ModeConfig = {
  id: GrowthMode;
  label: string;
  short: string;
  tone: string;
  low: string;
  note: number;
  force: string;
};

/** A real species grafted at a fixed node of a vine. Never stored — decoded
 * from hashSeed(vine seed, node index) whenever the vine exists. */
type Blossom = {
  /** Node index along the vine, 1..4 — the hash input. */
  node: number;
  /** The node's fraction of the vine's full extent. */
  u: number;
  seed: number;
  species: Species;
  /** The hand's phenophase contribution (dwell hold). */
  held: number;
  /** 0..1 overbloom — a hold kept past full bloom keeps deepening. */
  over: number;
  bloomed: boolean;
  geo: FlowerGeometry | null;
  geoPhase: number;
  /** Last computed phenophase, 0..1. */
  phase: number;
  // screen-space center + hit radius, refreshed every draw
  sx: number;
  sy: number;
  sr: number;
  wobble: number;
  wobbleV: number;
};

type GrowthSystem = {
  id: number;
  x: number;
  y: number;
  born: number;
  mode: GrowthMode;
  energy: number;
  scale: number;
  hue: string;
  bend: number;
  phase: number;
  force: number;
  immortal?: boolean;
  /** Deterministic vine seed — same hash discipline as botany.ts. */
  seed: number;
  blossoms: Blossom[];
  /** Ceremony hold or LetGo: performance.now() the vine began its retirement, or null while it stands. */
  retiringAt: number | null;
};

/** Cached per-mode gradients (radial glow/ring, linear vine stroke) — built
 * once from the fixed four-mode palette and reused every frame via
 * transform + globalAlpha, never recreated inside the render loop. */
type GradCache = {
  glow: Map<GrowthMode, CanvasGradient>;
  stroke: Map<GrowthMode, CanvasGradient>;
};

type DragTrace = {
  x: number;
  y: number;
  px: number;
  py: number;
  born: number;
  force: number;
  mode: GrowthMode;
};

type Speck = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  r: number;
  color: string;
  swirl: number;
};

type GestureMark = {
  id: number;
  label: string;
  tone: string;
  level: number;
};

type Readout = {
  model: string;
  phase: string;
  value: string;
  gravity: string;
  force: string;
};

type FieldParams = {
  gravityX: number;
  gravityY: number;
  time: number;
  bend: number;
  bloom: number;
  saturation: number;
  collapse: number;
  rest: number;
  rate: number;
  ceiling: number;
  steepness: number;
  /** Three-finger weather, -1..1. */
  wind: number;
  /** Entrained growth pulse, 0..1 (rhythm gesture). */
  pulse: number;
  /** Twist lens, 0 felt vines .. 1 bare equations. */
  lens: number;
};

type GardenState = {
  params: FieldParams;
  time: number;
  /** Dilatable clock (ms) — vine ages read this, not the wall clock. */
  clock: number;
  systems: GrowthSystem[];
  traces: DragTrace[];
  nextId: number;
};

const MODES: ModeConfig[] = [
  {
    id: "sigmoid",
    label: "sigmoid",
    short: "S",
    tone: "#b8f07a",
    low: "#315b31",
    note: 50,
    force: "saturation",
  },
  {
    id: "exponential",
    label: "exponential",
    short: "e",
    tone: "#f2c35b",
    low: "#745126",
    note: 57,
    force: "bloom",
  },
  {
    id: "decay",
    label: "decay",
    short: "d",
    tone: "#e57955",
    low: "#683129",
    note: 43,
    force: "collapse",
  },
  {
    id: "cycle",
    label: "lifecycle",
    short: "L",
    tone: "#8ed8c4",
    low: "#245b55",
    note: 62,
    force: "rest",
  },
];

const INITIAL_READOUT: Readout = {
  model: "sigmoid",
  phase: "seed",
  value: "L 0.82",
  gravity: "g 0.00",
  force: "saturation",
};

/** Blossom nodes as fractions of a vine's full extent. Index+1 is the node's
 * hash input, so a node's species never depends on how many nodes opened. */
const NODE_US = [0.42, 0.6, 0.78, 0.94] as const;
const GEO_EPS = 0.004;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const clamp01 = (v: number) => clamp(v, 0, 1);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const smooth = (edge0: number, edge1: number, value: number) => {
  const t = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

function configFor(mode: GrowthMode) {
  return MODES.find((entry) => entry.id === mode) ?? MODES[0];
}

/** Blend two hex colors by `t` (0 = all `a`, 1 = all `b`) — the graft's third hue. */
function mixHue(a: string, b: string, t: number): string {
  const toRgb = (hex: string) => {
    const clean = hex.replace("#", "");
    const full = clean.length === 3 ? clean.split("").map((ch) => ch + ch).join("") : clean;
    const n = parseInt(full, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [ar, ag, ab] = toRgb(a);
  const [br, bg, bb] = toRgb(b);
  const mixByte = (x: number, y: number) => Math.round(x + (y - x) * t);
  const toHex = (v: number) => v.toString(16).padStart(2, "0");
  return `#${toHex(mixByte(ar, br))}${toHex(mixByte(ag, bg))}${toHex(mixByte(ab, bb))}`;
}

function colorAlpha(hex: string, alpha: number) {
  const clean = hex.replace("#", "");
  const full = clean.length === 3
    ? clean.split("").map((char) => char + char).join("")
    : clean;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function hash(value: number) {
  const x = Math.sin(value * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

/** midi voice of a species — petals set the degree, the latent detunes it
 * (the same voice a species carries on /flowers). */
function midiOf(sp: Species): number {
  return 52 + (sp.petals % 13) + Math.round(sp.latent[25] * 7);
}

function valueForMode(mode: GrowthMode, uRaw: number, params: FieldParams) {
  const u = clamp(uRaw, 0, 1);

  if (mode === "sigmoid") {
    const ceiling = clamp(params.ceiling + params.saturation * 0.18, 0.48, 1);
    const steepness = 7.2 + params.steepness * 5.6 + params.bloom * 2.2;
    const x0 = 0.48 - params.bend * 0.10;
    return ceiling / (1 + Math.exp(-steepness * (u - x0)));
  }

  if (mode === "exponential") {
    const rate = 1.85 + params.rate * 2.5 + params.bloom * 1.45;
    const top = Math.exp(rate) - 1;
    return clamp(((Math.exp(rate * u) - 1) / Math.max(0.0001, top)) * (0.72 + params.bloom * 0.34), 0, 1.08);
  }

  if (mode === "decay") {
    const rate = 1.4 + params.rate * 2.2 + params.collapse * 3.4;
    const after = Math.exp(-rate * u);
    const tremor = Math.sin(u * Math.PI * 5.5) * 0.025 * (1 - u) * (0.5 + params.collapse);
    return clamp(0.08 + after * 0.88 + tremor, 0.04, 1);
  }

  if (u <= 0.26) {
    const s = 1 / (1 + Math.exp(-8.5 * (u / 0.26 - 0.5)));
    return s * 0.72;
  }
  if (u <= 0.56) {
    const v = (u - 0.26) / 0.30;
    return 0.70 + (1 - 0.70) * (1 - Math.exp(-3.2 * v));
  }
  if (u <= 0.78) {
    const v = (u - 0.56) / 0.22;
    return 0.96 + Math.sin(v * Math.PI) * 0.04;
  }
  const v = (u - 0.78) / 0.22;
  return mix(0.92, 0.18 + params.rest * 0.04, easeOut(v));
}

function phaseForMode(mode: GrowthMode, u: number, y: number) {
  if (mode === "sigmoid") {
    if (y < 0.22) return "seed";
    if (y < 0.62) return "climb";
    if (u < 0.82) return "bloom";
    return "saturation";
  }

  if (mode === "exponential") {
    if (y < 0.18) return "spark";
    if (y < 0.62) return "surge";
    return "bloom";
  }

  if (mode === "decay") {
    if (u < 0.22) return "full";
    if (y > 0.42) return "fall";
    if (y > 0.18) return "remnant";
    return "rest";
  }

  if (u < 0.24) return "seed";
  if (u < 0.56) return "climb";
  if (u < 0.78) return "bloom";
  return "rest";
}

function makeSystem(
  id: number,
  x: number,
  y: number,
  mode: GrowthMode,
  born: number,
  force = 1,
  immortal = false,
): GrowthSystem {
  const cx = clamp(x, 0.04, 0.96);
  const cy = clamp(y, 0.18, 0.94);
  const seed = id * 17.13 + cx * 23 + cy * 41;
  const cfg = configFor(mode);
  // the vine's own seed — where and when it rooted, botany's hash discipline
  const vineSeed = hashSeed(Math.round(cx * 997), Math.round(cy * 991), id);
  const count = 2 + (vineSeed % 2);
  const blossoms: Blossom[] = [];
  for (let k = NODE_US.length - count; k < NODE_US.length; k += 1) {
    const node = k + 1;
    const bSeed = hashSeed(vineSeed, node);
    blossoms.push({
      node,
      u: NODE_US[k],
      seed: bSeed,
      species: speciesFromSeed(bSeed),
      held: 0,
      over: 0,
      bloomed: false,
      geo: null,
      geoPhase: -1,
      phase: 0,
      sx: -1,
      sy: -1,
      sr: 0,
      wobble: 0,
      wobbleV: 0,
    });
  }
  return {
    id,
    x: cx,
    y: cy,
    born,
    mode,
    energy: clamp(0.64 + hash(seed) * 0.58 + force * 0.18, 0.45, 1.35),
    scale: 0.70 + hash(seed + 4.1) * 0.85,
    hue: cfg.tone,
    bend: (hash(seed + 9.4) - 0.5) * 2,
    phase: hash(seed + 15.7) * Math.PI * 2,
    force,
    immortal,
    seed: vineSeed,
    blossoms,
    retiringAt: null,
  };
}

function buildGradCache(ctx: CanvasRenderingContext2D): GradCache {
  const glow = new Map<GrowthMode, CanvasGradient>();
  const stroke = new Map<GrowthMode, CanvasGradient>();
  for (const m of MODES) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, colorAlpha(m.tone, 1));
    g.addColorStop(1, colorAlpha(m.tone, 0));
    glow.set(m.id, g);
    // ratios baked in so a single globalAlpha at draw time reproduces the
    // original per-stop alphas (0.86 / 0.92 / 0.78) exactly: globalAlpha =
    // alpha * 0.92, stops = [0.86/0.92, 1, 0.78/0.92].
    const s = ctx.createLinearGradient(0, 0, 1, 0);
    s.addColorStop(0, colorAlpha(m.low, 0.86 / 0.92));
    s.addColorStop(0.58, colorAlpha(m.tone, 1));
    s.addColorStop(1, colorAlpha("#fff5cf", 0.78 / 0.92));
    stroke.set(m.id, s);
  }
  return { glow, stroke };
}

function drawPetalPath(
  ctx: CanvasRenderingContext2D,
  o: ReturnType<typeof petalOutline>,
  len: number,
  w: number,
) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(o.c1.x * w, o.c1.y * len, o.c2.x * w, o.c2.y * len, o.tip.x * w, o.tip.y * len);
  ctx.bezierCurveTo(-o.c2.x * w, o.c2.y * len, -o.c1.x * w, o.c1.y * len, 0, 0);
  ctx.closePath();
}

/** One decoded species head, rendered small — a blossom on a vine, not a
 * garden flower. Geometry comes straight from flowerGeometry; only the
 * head (bud casing, petal fan, heart, florets) is drawn — the vine itself
 * is the plant. */
function drawBlossomHead(
  ctx: CanvasRenderingContext2D,
  sp: Species,
  geo: FlowerGeometry,
  x: number,
  y: number,
  lean: number,
  scale: number,
  alpha: number,
  detail: boolean,
) {
  const o = petalOutline(sp.petal);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(lean);
  ctx.scale(scale, scale);
  const budA = clamp01(1 - geo.openness * 1.7);
  if (budA > 0.01) {
    ctx.fillStyle = colorAlpha(sp.palette.stem, budA * 0.9 * alpha);
    ctx.beginPath();
    ctx.ellipse(0, 0, geo.headRadius * 0.42, geo.headRadius * 0.58, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = geo.petals.length - 1; i >= 0; i -= 1) {
    const pe = geo.petals[i];
    if (pe.length <= 0.001) continue;
    if (!detail && pe.layer > 0) continue;
    ctx.save();
    ctx.rotate(pe.angle);
    ctx.translate(0, -geo.heartRadius * 0.55 * pe.splay);
    ctx.fillStyle = colorAlpha(
      pe.layer % 2 === 0 ? sp.palette.petal : sp.palette.petalDeep,
      (0.6 + 0.34 * pe.splay) * alpha,
    );
    drawPetalPath(ctx, o, pe.length, pe.width);
    ctx.fill();
    ctx.restore();
  }
  if (geo.openness > 0.3) {
    const heartA = clamp01((geo.openness - 0.3) / 0.4) * alpha;
    ctx.fillStyle = colorAlpha(sp.palette.petalDeep, heartA * 0.85);
    ctx.beginPath();
    ctx.arc(0, 0, geo.heartRadius, 0, Math.PI * 2);
    ctx.fill();
    if (detail) {
      ctx.fillStyle = colorAlpha(sp.palette.heart, heartA);
      for (const f of geo.florets) {
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.fillStyle = colorAlpha(sp.palette.heart, heartA * 0.9);
      ctx.beginPath();
      ctx.arc(0, 0, geo.heartRadius * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  now: number,
  mode: GrowthMode,
  params: FieldParams,
  reduce: boolean,
  bgGrad: { sky: CanvasGradient } | null,
  panX = 0,
  panY = 0,
) {
  const cfg = configFor(mode);
  ctx.fillStyle = bgGrad?.sky ?? "#03120f";
  ctx.fillRect(0, 0, width, height);

  const glowX = width * (0.50 + params.gravityX * 0.10) + panX * 0.35;
  const glowY = height * (0.33 + params.gravityY * 0.05) + panY * 0.35;
  const light = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, Math.max(width, height) * 0.72);
  light.addColorStop(0, colorAlpha(cfg.tone, 0.12 + params.bloom * 0.05));
  light.addColorStop(0.42, colorAlpha("#4d8f58", 0.055 + params.saturation * 0.04));
  light.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, width, height);

  const soilY = height * 0.74;
  const soil = ctx.createLinearGradient(0, soilY, 0, height);
  soil.addColorStop(0, "rgba(51, 43, 25, 0.12)");
  soil.addColorStop(0.45, "rgba(18, 19, 10, 0.74)");
  soil.addColorStop(1, "rgba(4, 6, 4, 0.96)");
  ctx.fillStyle = soil;
  ctx.fillRect(0, soilY, width, height - soilY);

  ctx.lineCap = "round";
  for (let i = 0; i < 54; i += 1) {
    const n = hash(i + 0.31);
    const x = n * width;
    const y = height * (0.08 + hash(i + 7.8) * 0.62);
    const drift = reduce ? 0 : Math.sin(now * (0.15 + hash(i) * 0.22) + i) * 10 + params.wind * 26;
    const a = 0.06 + hash(i + 2.2) * 0.11;
    ctx.strokeStyle = `rgba(214, 244, 178, ${a})`;
    ctx.lineWidth = 0.7 + hash(i + 5.9) * 0.7;
    ctx.beginPath();
    ctx.moveTo(x + drift, y);
    ctx.lineTo(x + drift + 0.1, y + 0.1);
    ctx.stroke();
  }
}

function drawVectorField(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  now: number,
  mode: GrowthMode,
  params: FieldParams,
  detail: number,
  panX = 0,
  panY = 0,
) {
  const cfg = configFor(mode);
  const step = (width < 700 ? 42 : 54) / Math.max(0.35, detail);
  const top = height * 0.12;
  const bottom = height * 0.78;
  const emphasis = 0.85 + params.lens * 1.1;
  ctx.lineCap = "round";

  for (let y = top + panY * 0.2; y <= bottom; y += step) {
    for (let x = step * 0.45 + panX * 0.2; x <= width; x += step) {
      const nx = x / width - 0.5;
      const ny = y / height - 0.5;
      const pulse = Math.sin(nx * 8.5 + ny * 4.2 + now * 0.34) * 0.42
        + Math.sin(Math.hypot(nx, ny) * 12 - now * 0.25) * 0.22;
      const angle = -Math.PI / 2
        + params.gravityX * 0.78
        + params.wind * 0.5
        + params.bend * pulse * 0.42
        + (mode === "decay" ? 0.32 : 0);
      const length = step * (0.24 + Math.abs(pulse) * 0.20 + params.saturation * 0.09);
      const alpha = (0.07 + Math.abs(pulse) * 0.08 + params.bloom * 0.035) * emphasis;
      ctx.strokeStyle = colorAlpha(cfg.tone, alpha);
      ctx.lineWidth = 0.65 + Math.abs(pulse) * 0.55;
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(angle) * length * 0.45, y - Math.sin(angle) * length * 0.45);
      ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
      ctx.stroke();
    }
  }
}

function drawGlobalCurve(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  now: number,
  mode: GrowthMode,
  params: FieldParams,
  panX = 0,
  panY = 0,
) {
  const left = width * 0.07 + panX * 0.15;
  const right = width * 0.93 + panX * 0.15;
  const span = right - left;
  const base = height * (width < 700 ? 0.70 : 0.68) + panY * 0.1;
  const amp = height * (width < 700 ? 0.42 : 0.48);
  const samples = 220;
  const emphasis = 1 + params.lens * 0.6;

  for (const entry of MODES) {
    const active = entry.id === mode;
    ctx.beginPath();
    for (let i = 0; i <= samples; i += 1) {
      const u = i / samples;
      const v = valueForMode(entry.id, u, params);
      const sway = Math.sin(u * Math.PI * 4 + now * 0.24) * params.bend * 9 * (active ? 1 : 0.35);
      const x = left + u * span + sway + params.gravityX * 34 * u * u;
      const y = base - v * amp + params.gravityY * 22 * u;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = active
      ? colorAlpha(entry.tone, Math.min(0.95, 0.72 * emphasis))
      : colorAlpha(entry.tone, Math.min(0.5, 0.14 * emphasis));
    ctx.lineWidth = active ? 2.4 : 1;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();

    if (active) {
      ctx.lineTo(right, base);
      ctx.lineTo(left, base);
      ctx.closePath();
      const fill = ctx.createLinearGradient(0, base - amp, 0, base);
      fill.addColorStop(0, colorAlpha(entry.tone, 0.10 + params.bloom * 0.05));
      fill.addColorStop(1, colorAlpha(entry.tone, 0));
      ctx.fillStyle = fill;
      ctx.fill();
    }
  }

  if (mode === "sigmoid") {
    const y = base - clamp(params.ceiling + params.saturation * 0.18, 0.48, 1) * amp;
    ctx.setLineDash([2, 8]);
    ctx.strokeStyle = "rgba(222, 255, 190, 0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawTrace(
  ctx: CanvasRenderingContext2D,
  trace: DragTrace,
  width: number,
  height: number,
  now: number,
  grad: GradCache,
) {
  const age = (now - trace.born) / 1000;
  const alpha = Math.max(0, 1 - age / 1.25) * trace.force;
  if (alpha <= 0) return;
  const cfg = configFor(trace.mode);
  ctx.strokeStyle = colorAlpha(cfg.tone, alpha * 0.36);
  ctx.lineWidth = 1 + trace.force * 4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(trace.px * width, trace.py * height);
  ctx.lineTo(trace.x * width, trace.y * height);
  ctx.stroke();

  const radius = 42 + age * 80;
  ctx.save();
  ctx.translate(trace.x * width, trace.y * height);
  ctx.scale(radius, radius);
  ctx.globalAlpha = alpha * 0.12;
  ctx.fillStyle = grad.glow.get(trace.mode) ?? "transparent";
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Reusable per-frame scratch for a vine's sampled curve (SoA typed arrays,
 * grown only when a tier bump needs more samples than currently held) — the
 * points a vine walks are read back three times a frame (stroke, leaves,
 * decay tip) without allocating an {x,y,v,u} object per sample per system. */
type VineScratch = {
  x: Float64Array;
  y: Float64Array;
  v: Float64Array;
};

type SystemFx = {
  dt: number;
  reduce: boolean;
  /** Shared 0.14 Hz breath phase (audio clock when audible). */
  breath: number;
  /** Fired the frame a blossom crosses BLOOM_PEAK — sound/haptic/specks. */
  onBloom: (b: Blossom) => void;
  /** Governed detail (room-runtime): scales the vine's sample count by tier. */
  detail: number;
  grad: GradCache;
  scratch: VineScratch;
};

const RETIRE_MS = 1500;

function drawSystem(
  ctx: CanvasRenderingContext2D,
  system: GrowthSystem,
  width: number,
  height: number,
  clockMs: number,
  params: FieldParams,
  activeMode: GrowthMode,
  fx: SystemFx,
) {
  const age = (clockMs - system.born) / 1000;
  let life = system.immortal ? 1 : clamp(1 - Math.max(0, age - 15) / 8, 0, 1);
  // ceremony hold / LetGo: the vine's solemn retirement — a graceful fade,
  // never a blink-delete (SPEC create/delete law)
  if (system.retiringAt != null) {
    const u = clamp01((clockMs - system.retiringAt) / RETIRE_MS);
    life *= 1 - u;
  }
  if (life <= 0) return;

  const cfg = configFor(system.mode);
  const rootX = system.x * width;
  const rootY = system.y * height;
  const isMobile = width < 700;
  const heightScale = (isMobile ? 0.70 : 1) * (0.78 + system.energy * 0.35);
  const stemHeight = clamp(height * 0.16, 92, 168) * system.scale * heightScale
    * (1 + params.pulse * 0.05);
  const span = clamp(width * 0.12, 70, 178) * (0.76 + system.scale * 0.28);
  const cycleSpeed = system.immortal ? 0.055 : 1 / (5.8 + system.scale * 3.4);
  const progress = system.immortal
    ? (0.08 + ((age * cycleSpeed + system.phase / (Math.PI * 2)) % 0.92))
    : clamp(age * cycleSpeed + system.force * 0.08 + params.bloom * 0.06, 0, 1);
  const activeLift = activeMode === system.mode ? 1 : 0.72;
  const collapse = params.collapse * (system.mode === "decay" || activeMode === "decay" ? 1 : 0.28);
  const rest = params.rest * (system.mode === "cycle" || activeMode === "cycle" ? 1 : 0.2);
  const tone = system.hue || cfg.tone;
  const felt = 1 - params.lens * 0.55;
  const alpha = (system.immortal ? 0.46 : 0.76) * life * activeLift * felt;
  const samples = Math.max(10, Math.round(34 * fx.detail));

  // one formula for every point of the vine — the loop and the blossom
  // nodes read the same curve, so a node sits exactly on its branch
  const pointAt = (u: number) => {
    const v = valueForMode(system.mode, u, params);
    const curl = Math.sin(u * Math.PI * 3.2 + system.phase + params.time * 0.36) * (8 + params.bend * 12);
    const gravityX = params.gravityX * stemHeight * 0.34 * u * u;
    const gravityY = params.gravityY * stemHeight * 0.12 * u;
    const windX = params.wind * stemHeight * 0.30 * u * u;
    const decayDrop = collapse * u * u * stemHeight * 0.34;
    const restDrop = rest * smooth(0.62, 1, u) * stemHeight * 0.30;
    const x = rootX + (u - 0.06) * span + gravityX + windX + curl * system.bend;
    const y = rootY - v * stemHeight + gravityY + decayDrop + restDrop;
    return { x, y, v, u };
  };

  // sampled once into the shared scratch (SoA typed arrays, grown not
  // reallocated) instead of pushing an {x,y,v,u} literal per sample — the
  // hazard the performance contract names for per-frame object churn
  const scratch = fx.scratch;
  const pointCount = samples + 1;
  for (let i = 0; i <= samples; i += 1) {
    const p = pointAt((i / samples) * progress);
    scratch.x[i] = p.x;
    scratch.y[i] = p.y;
    scratch.v[i] = p.v;
  }

  ctx.save();
  ctx.translate(rootX, rootY);
  ctx.scale(54, 54);
  ctx.globalAlpha = alpha * 0.20;
  ctx.fillStyle = fx.grad.glow.get(system.mode) ?? colorAlpha(tone, alpha * 0.2);
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = colorAlpha(cfg.low, alpha * 0.56);
  ctx.lineWidth = 0.9;
  ctx.lineCap = "round";
  for (let r = 0; r < 4; r += 1) {
    const side = r % 2 === 0 ? -1 : 1;
    const len = 16 + hash(system.id + r) * 36;
    ctx.beginPath();
    ctx.moveTo(rootX, rootY);
    ctx.quadraticCurveTo(
      rootX + side * len * 0.42,
      rootY + 16 + r * 4,
      rootX + side * len,
      rootY + 26 + hash(system.id + r * 4) * 26,
    );
    ctx.stroke();
  }

  // stroke the vine with the cached per-mode gradient (0,0)→(1,0), mapped
  // onto the actual root→tip direction via transform instead of building a
  // fresh CanvasGradient every frame (the performance contract's hazard).
  const tipX = pointCount > 0 ? scratch.x[pointCount - 1] : rootX;
  const tipY = pointCount > 0 ? scratch.y[pointCount - 1] : rootY;
  {
    const tipAngle = Math.atan2(tipY - rootY, tipX - rootX);
    const tipDist = Math.max(1, Math.hypot(tipX - rootX, tipY - rootY));
    const ca = Math.cos(-tipAngle);
    const sa = Math.sin(-tipAngle);
    ctx.save();
    ctx.translate(rootX, rootY);
    ctx.rotate(tipAngle);
    ctx.scale(tipDist, tipDist);
    ctx.globalAlpha = alpha * 0.92;
    ctx.strokeStyle = fx.grad.stroke.get(system.mode) ?? colorAlpha(tone, 1);
    ctx.lineWidth = (system.immortal ? 1.15 : 1.85 + system.energy * 0.8) / tipDist;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let index = 0; index < pointCount; index += 1) {
      const dx = scratch.x[index] - rootX;
      const dy = scratch.y[index] - rootY;
      const lx = (dx * ca - dy * sa) / tipDist;
      const ly = (dx * sa + dy * ca) / tipDist;
      if (index === 0) ctx.moveTo(lx, ly);
      else ctx.lineTo(lx, ly);
    }
    ctx.stroke();
    ctx.restore();
  }

  for (let i = 5; i < pointCount; i += 6) {
    const px = scratch.x[i];
    const py = scratch.y[i];
    const nextI = Math.min(pointCount - 1, i + 1);
    const nx = scratch.x[nextI];
    const ny = scratch.y[nextI];
    const pv = scratch.v[i];
    const angle = Math.atan2(ny - py, nx - px);
    const side = i % 2 === 0 ? -1 : 1;
    const leaf = (5 + pv * 9) * (1 - collapse * 0.45) * life;
    if (leaf < 2) continue;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle + side * 1.15);
    ctx.fillStyle = colorAlpha(tone, alpha * (0.22 + pv * 0.26));
    ctx.beginPath();
    ctx.ellipse(leaf * 0.62, 0, leaf, leaf * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ————— blossoms: real species at the vine's nodes —————
  for (const b of system.blossoms) {
    if (progress < b.u) {
      // the vine has not reached this node (or a lifecycle wrapped past it)
      if (progress < b.u - 0.05) {
        b.held = 0;
        b.bloomed = false;
      }
      b.sx = -1;
      b.phase = 0;
      continue;
    }
    const phase = nodePhenophase(progress, b.u, b.held);
    b.phase = phase;
    if (b.bloomed && phase < 0.12) b.bloomed = false; // a new season may bloom again
    if (!b.geo || Math.abs(phase - b.geoPhase) > GEO_EPS) {
      b.geo = flowerGeometry(b.species, phase);
      b.geoPhase = phase;
    }
    const geo = b.geo;

    b.over *= Math.exp(-fx.dt * 0.25); // the overbloom settles back, slowly
    if (fx.reduce) {
      b.wobble = 0;
      b.wobbleV = 0;
    } else {
      const omega = 3 + b.species.swayStiffness * 3;
      b.wobbleV += (-omega * omega * b.wobble - 2 * 0.6 * omega * b.wobbleV) * fx.dt;
      b.wobble += b.wobbleV * fx.dt;
    }

    const pt = pointAt(b.u);
    const pxScale = stemHeight * (b.u >= 0.9 ? 1.15 : 0.9);
    const rPx = geo.headRadius * pxScale;
    b.sx = pt.x;
    b.sy = pt.y;
    b.sr = Math.max(18, rPx * 1.8);

    if (!b.bloomed && phase >= BLOOM_PEAK) {
      b.bloomed = true;
      fx.onBloom(b);
    }

    const lean = fx.reduce ? 0 : b.wobble * 0.2 + params.wind * 0.16;
    // the overbloom breathes the head wider, slow and deliberate
    const overSwell = b.over * (0.14 + (fx.reduce ? 0 : 0.05 * Math.sin(fx.breath * 2)));
    const breathScale = (fx.reduce
      ? 1
      : 1 + Math.sin(fx.breath + b.species.latent[28] * 7) * 0.04 * b.species.breathDepth * (1 + params.pulse * 0.8)) + overSwell;
    drawBlossomHead(ctx, b.species, geo, pt.x, pt.y, lean, pxScale * breathScale, alpha, rPx > 11);
  }

  if (collapse > 0.08 || system.mode === "decay") {
    const fallAlpha = alpha * (collapse * 0.62 + (system.mode === "decay" ? 0.16 : 0));
    for (let i = 0; i < 5; i += 1) {
      const n = hash(system.id * 13 + i * 8);
      const fallT = (clockMs * (0.09 + n * 0.04) + n) % 1;
      const px = tipX + (n - 0.5) * 54 + params.gravityX * 22 + params.wind * 30;
      const py = tipY + fallT * (80 + i * 12);
      ctx.fillStyle = colorAlpha(tone, fallAlpha * (1 - fallT));
      ctx.beginPath();
      ctx.ellipse(px, py, 2.2 + n * 3, 0.8 + n * 1.8, system.phase + i, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export default function Growth() {
  useEffect(() => {
    try { getFieldAudio().setAmbientProfile("garden"); } catch { /* noop */ }
  }, []);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modeRef = useRef<GrowthMode>("sigmoid");
  const reduceMotionRef = useRef(false);
  const readoutTickRef = useRef(0);
  const markIdRef = useRef(0);
  const fieldRef = useRef<GardenState>({
    params: {
      gravityX: 0,
      gravityY: 0,
      time: 0,
      bend: 0.34,
      bloom: 0.16,
      saturation: 0.44,
      collapse: 0,
      rest: 0,
      rate: 0.44,
      ceiling: 0.76,
      steepness: 0.42,
      wind: 0,
      pulse: 0,
      lens: 0,
    },
    time: 0,
    clock: 0,
    systems: [],
    traces: [],
    nextId: 1,
  });

  const [mode, setMode] = useState<GrowthMode>("sigmoid");
  const [readout, setReadout] = useState<Readout>(INITIAL_READOUT);
  const [marks, setMarks] = useState<GestureMark[]>([
    { id: 0, label: "living", tone: MODES[0].tone, level: 0.48 },
  ]);
  const [hasGrowth, setHasGrowth] = useState(false);
  const letGoRef = useRef<() => void>(() => {});

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const markGrowth = useCallback((label: string, tone: string, level = 0.65) => {
    const id = ++markIdRef.current;
    setMarks((current) => [
      { id, label, tone, level: clamp(level, 0, 1) },
      ...current,
    ].slice(0, 6));
  }, []);

  const chooseMode = useCallback((nextMode: GrowthMode) => {
    modeRef.current = nextMode;
    setMode(nextMode);
    const cfg = configFor(nextMode);
    const params = fieldRef.current.params;
    params.bloom = Math.max(params.bloom, nextMode === "exponential" ? 0.38 : 0.20);
    params.collapse = nextMode === "decay" ? Math.max(params.collapse, 0.28) : params.collapse * 0.45;
    params.rest = nextMode === "cycle" ? Math.max(params.rest, 0.28) : params.rest * 0.55;
    params.saturation = nextMode === "sigmoid" ? Math.max(params.saturation, 0.58) : params.saturation;

    try {
      const audio = getFieldAudio();
      void audio.start();
      audio.playNote(cfg.note, 120);
    } catch { /* noop */ }
    haptics.tap();
    useField.getState().recordTape("sigil", 0.44, `growth/${nextMode}`);
    markGrowth(cfg.label, cfg.tone, 0.58);
  }, [markGrowth]);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduceMotionRef.current = mq.matches;
    const onMotionChange = () => {
      reduceMotionRef.current = mq.matches;
    };
    mq.addEventListener?.("change", onMotionChange);

    const offVisibility = onVisibility((hidden) => {
      docHidden = hidden;
      sleeping = docHidden || galleryPaused;
      if (sleeping) governor.force("sleep");
    });
    const offGalleryPause = onGalleryPause((paused) => {
      galleryPaused = paused;
      sleeping = docHidden || galleryPaused;
      if (sleeping) governor.force("sleep");
    });

    const field = fieldRef.current;
    let raf = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let last = performance.now();

    // ————— performance contract (room-runtime) —————
    const embedded = isEmbeddedFrame();
    const governor = createFrameGovernor(embedded ? "medium" : "high");
    let currentTier = governor.tier();
    let detail = detailForTier(currentTier);
    let docHidden = false;
    let galleryPaused = embedded;
    let sleeping = docHidden || galleryPaused;
    const gradCache = buildGradCache(ctx);
    let bgGrad: { sky: CanvasGradient } | null = null;
    // a vine's sampled curve, shared across every system/frame — grown only
    // when a tier bump asks for more samples than currently held, never
    // reallocated per system per frame (see drawSystem's scratch usage)
    let vineScratch: VineScratch = {
      x: new Float64Array(40),
      y: new Float64Array(40),
      v: new Float64Array(40),
    };
    const ensureVineScratch = (need: number) => {
      if (vineScratch.x.length >= need) return;
      const size = need + 8;
      vineScratch = { x: new Float64Array(size), y: new Float64Array(size), v: new Float64Array(size) };
    };
    // reused every frame (fields mutated in draw, never recreated) — the
    // per-system draw fx no longer allocates a fresh object each rAF tick
    const fx: SystemFx = {
      dt: 0,
      reduce: false,
      breath: 0,
      onBloom,
      detail: 1,
      grad: gradCache,
      scratch: vineScratch,
    };
    // two-finger pan (grammar §5): a decorative depth offset on the field's
    // backdrop/vector-field/global curve layers, eased and self-centering
    let panX = 0;
    let panY = 0;
    let panTargetX = 0;
    let panTargetY = 0;
    // three-finger twist = season: growth mood — quickens in spring, slows toward winter
    let season = 0;
    let seasonTarget = 0;
    let seasonSnapped = 0;
    let lastSeasonSoundAt = 0;
    // flip face-down = night
    let night = false;
    let nightAmt = 0;

    // ————— gesture-side state (all closure locals) —————
    const specks: Speck[] = [];
    let windTarget = 0;
    let tiltWind = 0; // the vessel's lean: wind toward the downhill side
    let lastTiltSoundAt = 0;
    let lastTuttiAt = 0;
    let timeScale = 1;
    let timeScaleTarget = 1;
    let lensTarget = 0;
    let lensSnapped = 0;
    let pulseBpm = 0;
    let pulseUntil = 0;
    let lastBeatIdx = -1;
    let beatsPlayed = 0;
    let lastInteractionAt = performance.now();
    let lastGrowNoteAt = 0;
    let lastGrowHapticAt = 0;
    let lastWindSoundAt = 0;
    let lastScrubAt = 0;
    let lastBrushSoundAt = 0;
    let lastShedAt = 0;
    let lastCompeteAt = 0;
    let focused = false;
    let cursorVisible = false;
    let cursorNx = 0.5;
    let cursorNy = 0.55;
    const holdUI = {
      active: false,
      fired: false,
      ceremonied: false,
      x: 0,
      y: 0,
      elapsed: 0,
      blossom: null as Blossom | null,
    };
    // ceremony hold (tier≥3) on a blossom: the vine's solemn act — it seals
    // its bloom and retires gracefully, and doubles as the touch-reachable
    // delete for this room's material (SPEC create/delete law)
    const retireSystem = (b: Blossom) => {
      const system = field.systems.find((s) => s.blossoms.includes(b));
      if (!system || system.retiringAt != null) return;
      system.retiringAt = field.clock;
      try { getFieldAudio().bell(); } catch { /* noop */ }
      try { haptics.bloom(); } catch { /* noop */ }
      useField.getState().recordTape("object", 0.5, "growth/retire");
      markGrowth("seal", b.species.palette.heart, 0.8);
    };
    const dragUI = {
      startX: 0.5,
      startY: 0.5,
      lastX: 0.5,
      lastY: 0.5,
      moved: 0,
      lastTape: 0,
      lastHaptic: 0,
      lastNote: 0,
    };

    const resize = () => {
      const rect = root.getBoundingClientRect();
      dpr = resolveDpr(currentTier, { embedded, reducedMotion: reduceMotionRef.current, maxDpr: 2 });
      width = Math.max(320, Math.floor(rect.width));
      height = Math.max(520, Math.floor(rect.height));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const sky = ctx.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, "#03120f");
      sky.addColorStop(0.38, "#061911");
      sky.addColorStop(0.72, "#0b1710");
      sky.addColorStop(1, "#050805");
      bgGrad = { sky };
    };

    const toLocal = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: clamp(clientX - rect.left, 0, Math.max(1, rect.width)),
        y: clamp(clientY - rect.top, 0, Math.max(1, rect.height)),
      };
    };

    const note = (midi: number, ms = 120) => {
      try { getFieldAudio().playNote(midi, ms); } catch { /* noop */ }
    };

    const burst = (x: number, y: number, colors: string[], n: number, speed: number) => {
      for (let i = 0; i < n; i += 1) {
        const a = (i / n) * Math.PI * 2 + hash(i + n) * 0.8;
        const s = speed * (0.4 + hash(i * 3 + 1) * 0.9);
        specks.push({
          x,
          y,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s - speed * 0.3,
          born: performance.now(),
          life: 900 + hash(i * 7 + 2) * 1400,
          r: 0.8 + hash(i * 11 + 3) * 1.8,
          color: colors[i % colors.length],
          swirl: (hash(i * 13 + 4) - 0.5) * 2,
        });
      }
      if (specks.length > 200) specks.splice(0, specks.length - 200);
    };

    const blossomAt = (x: number, y: number): Blossom | null => {
      let best: Blossom | null = null;
      let bestD = Infinity;
      for (const system of field.systems) {
        for (const b of system.blossoms) {
          if (b.sx < 0) continue;
          const d = Math.hypot(x - b.sx, y - b.sy);
          if (d < Math.max(24, b.sr) && d < bestD) {
            bestD = d;
            best = b;
          }
        }
      }
      return best;
    };

    const addSystem = (x: number, y: number, systemMode = modeRef.current, force = 1, immortal = false) => {
      const system = makeSystem(field.nextId++, x, y, systemMode, field.clock, force, immortal);
      field.systems.push(system);
      if (field.systems.length > 42) {
        // the cap answers physically: the oldest temporary vine gives way,
        // never a silent refusal (SPEC create/delete law)
        const firstTemporary = field.systems.findIndex((entry) => !entry.immortal && entry.retiringAt == null);
        const idx = firstTemporary >= 0 ? firstTemporary : 0;
        field.systems[idx].retiringAt = field.systems[idx].retiringAt ?? field.clock;
      }
      setHasGrowth(true);
      return system;
    };

    // whole-field parting — the shared <LetGo/> control, never hand-rolled
    const letGoAll = () => {
      const now = field.clock;
      let any = false;
      field.systems.forEach((system, i) => {
        if (system.retiringAt != null) return;
        any = true;
        system.retiringAt = now + (i % 5) * 90;
      });
      if (!any) return;
      try { getFieldAudio().thud(); } catch { /* noop */ }
      try { haptics.ripple(0.5); } catch { /* noop */ }
      note(40, 520);
      useField.getState().recordTape("object", 0.3, "growth/letgo");
      setHasGrowth(false);
    };
    letGoRef.current = letGoAll;

    const forceAt = (x: number, y: number, forcedMode = modeRef.current) => {
      const cfg = configFor(forcedMode);

      if (forcedMode === "sigmoid") {
        field.params.saturation = 1;
        field.params.ceiling = 0.90;
        field.params.bloom = Math.max(field.params.bloom, 0.58);
        try { getFieldAudio().bell(); } catch { /* noop */ }
        haptics.roll();
      } else if (forcedMode === "exponential") {
        field.params.bloom = 1;
        field.params.rate = Math.min(1, field.params.rate + 0.24);
        for (let i = 0; i < 6; i += 1) {
          const a = (i / 6) * Math.PI * 2;
          addSystem(x + Math.cos(a) * 0.045, y + Math.sin(a) * 0.035, forcedMode, 1.2);
        }
        try {
          getFieldAudio().chime();
          window.setTimeout(() => getFieldAudio().playNote(cfg.note + 12, 120), 90);
        } catch { /* noop */ }
        haptics.roll();
      } else if (forcedMode === "decay") {
        field.params.collapse = 1;
        field.params.bloom = Math.max(0.08, field.params.bloom * 0.32);
        try { getFieldAudio().thud(); } catch { /* noop */ }
        haptics.storm();
      } else {
        field.params.rest = 1;
        field.params.gravityY = Math.max(field.params.gravityY, 0.36);
        try {
          getFieldAudio().thud();
          window.setTimeout(() => getFieldAudio().chime(), 130);
        } catch { /* noop */ }
        haptics.roll();
      }

      field.systems.forEach((system) => {
        const dx = system.x - x;
        const dy = system.y - y;
        const near = Math.exp(-(dx * dx + dy * dy) / 0.030);
        system.force = clamp(system.force + near * 0.72, 0, 1.8);
      });
      addSystem(x, y, forcedMode, 1.55);
      useField.getState().recordTape("sigil", 0.82, `growth/${cfg.force}`);
      markGrowth(cfg.force, cfg.tone, 0.86);
    };

    const seedAt = (x: number, y: number) => {
      const cfg = configFor(modeRef.current);
      addSystem(x, y, modeRef.current, 1.05);
      field.params.bloom = Math.max(field.params.bloom, 0.26);
      field.params.saturation = Math.max(field.params.saturation, 0.42 + (1 - y) * 0.35);
      try {
        const audio = getFieldAudio();
        void audio.start();
        audio.playNote(cfg.note + Math.round((1 - y) * 14), 110);
      } catch { /* noop */ }
      haptics.tap();
      useField.getState().recordTape("object", 0.40 + (1 - y) * 0.32, `growth/${modeRef.current}/seed`);
      markGrowth("seed", cfg.tone, 0.54 + (1 - y) * 0.22);
    };

    /** The dwell verb on a blossom: hand-carried phenophase, matching the
     * rate and voice of /flowers. Bloom crossing is caught in the draw. */
    const advanceBlossom = (b: Blossom, intensity: number) => {
      if (b.phase >= 1) {
        // duration is an axis: a hold kept past full bloom keeps deepening —
        // a slow breathing overbloom, sighing wider the longer the hand stays
        b.over = Math.min(1, b.over + 0.009 * (1 + intensity * 0.6));
        const nowOver = performance.now();
        if (nowOver - lastGrowNoteAt > 800) {
          lastGrowNoteAt = nowOver;
          note(midiOf(b.species) - 5 + Math.round(b.over * 4), 160);
          haptics.tap();
        }
        return;
      }
      b.held = Math.min(1, b.held + 0.0168 * (0.7 + intensity * 0.6));
      const now = performance.now();
      if (now - lastGrowNoteAt > 300) {
        lastGrowNoteAt = now;
        note(midiOf(b.species) + Math.round((b.geo ? b.geo.openness : 0) * 10), 100);
      }
      if (now - lastGrowHapticAt > 620) {
        lastGrowHapticAt = now;
        haptics.tap();
      }
    };

    const onBloom = (b: Blossom) => {
      // full bloom: sight (burst), sound (bell), touch (bloom word) — one frame
      try { getFieldAudio().bell(); } catch { /* noop */ }
      try { haptics.bloom(); } catch { /* noop */ }
      burst(b.sx, b.sy, [b.species.palette.heart, b.species.palette.petal, b.species.palette.glow], 18, 60);
      useField.getState().recordTape("sigil", 0.85, "growth/bloom");
      markGrowth("bloom", b.species.palette.petal, 0.9);
    };

    // tier 3 on an existing vine: it gives birth to a satellite of itself —
    // a branch rooted a short, deterministic distance from the parent,
    // sharing its mode and hue family, the parent surging as it forks.
    const branchVine = (b: Blossom, intensity: number) => {
      const parent = field.systems.find((s) => s.blossoms.includes(b));
      if (!parent) return;
      const ang = (hash(parent.seed % 6113 + b.node * 71) - 0.5) * 0.7;
      const bx = clamp01(parent.x + Math.sin(ang) * 0.09);
      const by = clamp01(parent.y - 0.07 - intensity * 0.04);
      const child = addSystem(bx, by, parent.mode, 0.85 + intensity * 0.5);
      child.hue = parent.hue;
      parent.force = clamp(parent.force + 0.3, 0, 1.8);
      try { getFieldAudio().chime(); } catch { /* noop */ }
      haptics.bloom();
      useField.getState().recordTape("object", 0.6, `growth/${parent.mode}/branch`);
      markGrowth("branch", parent.hue, 0.7 + intensity * 0.2);
    };

    // tier 3 on open field: a cycling set of seasons/weather, deterministic
    // by tap order (a counter on the season index, never Math.random).
    const seasonFlavor = (idx: number, intensity: number) => {
      if (idx === 0) {
        field.params.bloom = Math.max(field.params.bloom, 0.55 + intensity * 0.2);
        field.params.rate = clamp(field.params.rate + 0.15, 0.08, 1);
        burst(width * 0.5, height * 0.32, ["#b8f07a", "#fff5cf"], 12, 34);
        note(64, 160);
      } else if (idx === 1) {
        field.params.saturation = Math.max(field.params.saturation, 0.8);
        field.params.ceiling = Math.max(field.params.ceiling, 0.85);
        burst(width * 0.5, height * 0.28, ["#f2c35b", "#fff5cf"], 10, 30);
        note(67, 180);
      } else if (idx === 2) {
        windTarget = clamp(windTarget + (idx % 2 === 0 ? 1 : -1), -1, 1);
        field.params.collapse = Math.min(0.5, field.params.collapse + 0.22);
        burst(width * 0.5, height * 0.4, ["#f2c35b", "#745126"], 10, 40);
        note(52, 200);
      } else {
        field.params.rest = Math.max(field.params.rest, 0.65);
        burst(width * 0.5, height * 0.36, ["#7fb0c9", "#cfe8f2"], 8, 20);
        note(38, 240);
      }
      try { haptics.ripple(0.3 + intensity * 0.3); } catch { /* noop */ }
    };
    const cycleSeason = (intensity: number) => {
      seasonTarget += 1;
      const idx = Math.floor(((seasonTarget % 4) + 4) % 4);
      seasonSnapped = idx;
      seasonFlavor(idx, intensity);
      try { getFieldAudio().chime(); } catch { /* noop */ }
      markGrowth("season", MODES[idx % MODES.length].tone, 0.6 + intensity * 0.2);
    };

    // tier 5: the room's largest, rarest event — a full year races through,
    // each season's flavor landing on its own beat rather than snapping once
    let raceTimers: number[] = [];
    const raceSeason = (intensity: number) => {
      for (const t of raceTimers) window.clearTimeout(t);
      raceTimers = [];
      for (let i = 1; i <= 4; i += 1) {
        const id = window.setTimeout(() => {
          seasonTarget += 1;
          const idx = Math.floor(((seasonTarget % 4) + 4) % 4);
          seasonSnapped = idx;
          seasonFlavor(idx, intensity);
        }, i * 480);
        raceTimers.push(id);
      }
      try { getFieldAudio().bell(); } catch { /* noop */ }
      haptics.storm();
      markGrowth("year", "#fff5cf", 0.9);
    };

    // ── physics between vines: competition for light and space, and graft ──
    // Throttled (not every frame — O(n²) over a capped population, and the
    // outcome only needs to read at human speed). Two roots close enough
    // starve each other's force a little every pass; closer still, they
    // graft into one vine that is neither parent — the survivor's hue
    // blends toward the one it took, and its force jumps, a third thing.
    const COMPETE_D = 0.07;
    const GRAFT_D = 0.022;
    const applyVineCompetitionAndGraft = () => {
      const standing = field.systems.filter((s) => s.retiringAt == null);
      for (let i = 0; i < standing.length; i += 1) {
        const a = standing[i];
        for (let j = i + 1; j < standing.length; j += 1) {
          const c = standing[j];
          const d = Math.hypot(a.x - c.x, a.y - c.y);
          if (d >= COMPETE_D) continue;
          if (d < GRAFT_D && field.clock - a.born > 1200 && field.clock - c.born > 1200) {
            // graft: the younger/lighter vine feeds the older — a third hue
            const survivor = a.blossoms.length >= c.blossoms.length ? a : c;
            const taken = survivor === a ? c : a;
            survivor.force = clamp(survivor.force + 0.5, 0, 1.8);
            survivor.energy = clamp(survivor.energy + 0.2, 0.45, 1.35);
            survivor.hue = mixHue(survivor.hue, taken.hue, 0.35);
            taken.retiringAt = field.clock;
            const gx = (survivor.x + taken.x) / 2;
            const gy = (survivor.y + taken.y) / 2;
            burst(gx * width, gy * height, [survivor.hue, taken.hue, "#fff5cf"], 12, 34);
            try { getFieldAudio().bell(); } catch { /* noop */ }
            haptics.bloom();
            markGrowth("graft", survivor.hue, 0.8);
            return; // one graft per pass — the field settles before the next
          }
          // competing for the same light and space: both give a little ground
          a.force = clamp(a.force - 0.006, 0.1, 1.8);
          c.force = clamp(c.force - 0.006, 0.1, 1.8);
        }
      }
    };

    // three-finger tap = tutti (grammar §5): one synchronized soft pulse —
    // every blossom on every vine sways once, its note a whisper
    const tutti = (strength = 0.5) => {
      const now = performance.now();
      if (now - lastTuttiAt < 1400) return;
      lastTuttiAt = now;
      let voiceI = 0;
      for (const system of field.systems) {
        for (const b of system.blossoms) {
          if (b.sx < 0) continue;
          b.wobbleV += (hash(b.seed % 977) - 0.5) * (0.7 + strength * 0.9);
          if (voiceI < 10) {
            window.setTimeout(() => note(midiOf(b.species), 70), voiceI * 45);
            voiceI += 1;
          }
        }
      }
      field.params.pulse = Math.max(field.params.pulse, 0.4 + strength * 0.5);
      haptics.ripple(0.2 + strength * 0.4);
    };

    // ————— gestures (the grammar, nothing private) —————
    const detach = attachGestures(canvas, {
      tap: (e) => {
        lastInteractionAt = performance.now();
        if (e.fingers === 2) {
          // step back: a raised lens lowers first; otherwise the field's
          // forces ease one step toward rest — the frame retreating in the
          // room's own noun, which here is the equation's pull
          if (lensSnapped === 1) {
            lensSnapped = 0;
            lensTarget = 0;
            try { haptics.lens(); } catch { /* noop */ }
            note(48, 160);
          } else {
            panTargetX = 0;
            panTargetY = 0;
            field.params.gravityX *= 0.4;
            field.params.gravityY *= 0.4;
            windTarget *= 0.4;
            note(43, 140);
            try { haptics.detent(); } catch { /* noop */ }
          }
          return;
        }
        if (e.fingers === 3) { tutti(e.intensity); return; }
        if (e.fingers !== 1) return; // anything else is gently absorbed
        const p = toLocal(e.x, e.y);
        const b = blossomAt(p.x, p.y);
        // the rapid-tap ladder: a wobble → the vine arpeggiates → a
        // bloom-wave runs the stem → the whole trellis pulses
        const trainTier = tapTrainTier(e.count);
        const depth = tapTrainDepth(e.count);
        if (trainTier === "n") {
          let voiceI = 0;
          for (const system of field.systems) {
            for (const bb of system.blossoms) {
              if (bb.sx < 0) continue;
              bb.wobbleV += (hash(bb.seed % 977) - 0.5) * (1.2 + depth * 1.2);
              if (voiceI < 12) {
                window.setTimeout(() => note(midiOf(bb.species) + 12, 60), voiceI * 40);
                voiceI += 1;
              }
            }
          }
          field.params.pulse = Math.max(field.params.pulse, 0.7 + depth * 0.3);
          windTarget = clamp(windTarget + 0.5 + depth * 0.4, -1, 1);
          haptics.ripple(0.5 + depth * 0.4);
          return;
        }
        if (trainTier === 5) {
          // tier 5: the room's biggest, rarest event — a full year races
          // through, every season landing its own flavor in turn
          raceSeason(e.intensity);
          return;
        }
        if (trainTier === 3) {
          if (b) {
            // tier 3 on a vine: it gives birth to a satellite of itself
            branchVine(b, e.intensity);
          } else {
            // tier 3 on open field: the next of a cycling set of seasons
            cycleSeason(e.intensity);
          }
          haptics.tap();
          return;
        }
        if (b) {
          b.wobbleV += (p.x < b.sx ? -1 : 1) * (0.6 + e.intensity * 1.2);
          note(midiOf(b.species), 130);
          haptics.tap();
          if (b.geo && b.geo.openness > 0.4) {
            burst(b.sx, b.sy, [b.species.palette.petal, b.species.palette.heart], 4, 22);
          }
        } else {
          seedAt(clamp01(p.x / width), clamp01(p.y / height));
        }
      },
      hold: (e) => {
        lastInteractionAt = performance.now();
        if (e.fingers === 3) {
          // three fingers touch the law: time dilates while held, and the
          // dilation keeps deepening for as long as the hand stays
          if (e.phase === "enter") {
            haptics.tap();
            note(36, 260);
          }
          if (e.phase === "release") timeScaleTarget = 1;
          else timeScaleTarget = clamp(1 - e.elapsed / 3400, 0.08, 1);
          return;
        }
        if (e.fingers !== 1) return;
        const p = toLocal(e.x, e.y);
        if (e.phase === "enter") {
          holdUI.active = true;
          holdUI.fired = false;
          holdUI.ceremonied = false;
          holdUI.x = p.x;
          holdUI.y = p.y;
          holdUI.elapsed = e.elapsed;
          holdUI.blossom = blossomAt(p.x, p.y);
          return;
        }
        if (e.phase === "release") {
          holdUI.active = false;
          holdUI.blossom = null;
          return;
        }
        holdUI.x = p.x;
        holdUI.y = p.y;
        holdUI.elapsed = e.elapsed;
        if (holdUI.blossom) {
          if (e.tier >= 3 && !holdUI.ceremonied) {
            holdUI.ceremonied = true;
            retireSystem(holdUI.blossom);
          } else if (!holdUI.ceremonied) {
            advanceBlossom(holdUI.blossom, e.intensity);
          }
        } else if (e.tier >= 2 && !holdUI.fired) {
          // dwell on open field: the room's forcing verb
          holdUI.fired = true;
          forceAt(clamp01(p.x / width), clamp01(p.y / height));
        }
      },
      drag: (e) => {
        lastInteractionAt = performance.now();
        if (e.fingers === 3) {
          // three fingers are the weather: wind through the vines
          windTarget = clamp(e.vx * 1.6, -1, 1);
          const now = performance.now();
          if (Math.abs(windTarget) > 0.5 && now - lastWindSoundAt > 520) {
            lastWindSoundAt = now;
            note(38 + Math.round(Math.abs(windTarget) * 5), 240);
            haptics.chop();
          }
          return;
        }
        if (e.fingers !== 1) return;
        const local = toLocal(e.x, e.y);
        const p = { x: clamp01(local.x / width), y: clamp01(local.y / height) };
        if (e.phase === "start") {
          dragUI.startX = p.x;
          dragUI.startY = p.y;
          dragUI.lastX = p.x;
          dragUI.lastY = p.y;
          dragUI.moved = 0;
          return;
        }
        if (e.phase === "end") {
          if (dragUI.moved > 42) markGrowth("bend", configFor(modeRef.current).tone, 0.62);
          return;
        }
        const dx = p.x - dragUI.lastX;
        const dy = p.y - dragUI.lastY;
        const totalDx = p.x - dragUI.startX;
        const totalDy = p.y - dragUI.startY;
        const speed = Math.hypot(dx * width, dy * height);
        dragUI.moved += speed;

        const params = field.params;
        params.gravityX = clamp(mix(params.gravityX, totalDx * 2.2, 0.18), -1.1, 1.1);
        params.gravityY = clamp(mix(params.gravityY, totalDy * 1.8, 0.16), -0.8, 1.1);
        params.bend = clamp(mix(params.bend, 0.30 + Math.min(1, dragUI.moved / 280) * 0.70, 0.10), 0.1, 1);
        params.rate = clamp(mix(params.rate, 0.22 + Math.abs(totalDx) * 1.4 + (1 - p.y) * 0.42, 0.06), 0.08, 1);
        params.ceiling = clamp(mix(params.ceiling, 0.56 + (1 - p.y) * 0.42, 0.08), 0.48, 0.98);
        params.steepness = clamp(mix(params.steepness, 0.26 + Math.abs(totalDy) * 1.8, 0.08), 0.1, 1);

        if (modeRef.current === "decay") params.collapse = Math.max(params.collapse, Math.min(0.72, dragUI.moved / 480));
        if (modeRef.current === "cycle") params.rest = Math.max(params.rest, Math.min(0.62, p.y));
        if (modeRef.current === "exponential") params.bloom = Math.max(params.bloom, Math.min(0.92, speed / 50));

        field.traces.push({
          x: p.x,
          y: p.y,
          px: dragUI.lastX,
          py: dragUI.lastY,
          born: performance.now(),
          force: clamp(speed / 34, 0.14, 1),
          mode: modeRef.current,
        });
        if (field.traces.length > 56) field.traces.splice(0, field.traces.length - 56);

        // a hand passing through the blossoms brushes them
        const now = performance.now();
        for (const system of field.systems) {
          for (const b of system.blossoms) {
            if (b.sx < 0) continue;
            if (Math.hypot(local.x - b.sx, local.y - b.sy) > Math.max(40, b.sr * 1.6)) continue;
            b.wobbleV += clamp(e.vx * 0.9, -1.6, 1.6);
            if (now - lastBrushSoundAt > 260) {
              lastBrushSoundAt = now;
              note(midiOf(b.species) + 5, 70);
              haptics.ripple(0.2);
            }
          }
        }

        if (now - dragUI.lastTape > 140) {
          dragUI.lastTape = now;
          useField.getState().recordTape("ripple", clamp(speed / 52, 0.22, 0.78), `growth/${modeRef.current}/bend`);
        }
        if (now - dragUI.lastHaptic > 190 && speed > 9) {
          dragUI.lastHaptic = now;
          haptics.ripple(clamp(speed / 42, 0.18, 0.72));
        }
        if (now - dragUI.lastNote > 120 && speed > 7) {
          dragUI.lastNote = now;
          note(configFor(modeRef.current).note + Math.round((1 - p.y) * 18), 58);
        }

        dragUI.lastX = p.x;
        dragUI.lastY = p.y;
      },
      pan2: (e) => {
        lastInteractionAt = performance.now();
        // two-finger drag pans the frame's backdrop (vector field + global
        // curve), a decorative depth window onto the same field
        panTargetX = clamp(panTargetX + e.dx * 0.6, -width * 0.14, width * 0.14);
        panTargetY = clamp(panTargetY + e.dy * 0.6, -height * 0.10, height * 0.10);
      },
      twist: (e) => {
        if (e.fingers === 3) {
          // three fingers turn the season — the law layer's slow cycle,
          // quickening or slowing every vine's clock. Continuous: keeps
          // advancing while the wrist turns, clicks at each quarter crossed.
          lastInteractionAt = performance.now();
          if (e.phase === "move") {
            seasonTarget += e.angle / (Math.PI / 2);
            const now = performance.now();
            const cur = Math.floor(((seasonTarget % 4) + 4) % 4);
            if (cur !== seasonSnapped) {
              seasonSnapped = cur;
              if (now - lastSeasonSoundAt > 180) {
                lastSeasonSoundAt = now;
                note(45 + cur * 2, 220);
                try { haptics.detent(); } catch { /* noop */ }
              }
            }
          }
          return;
        }
        lastInteractionAt = performance.now();
        // two fingers rotate the lens: felt vines ↔ the bare equations
        if (e.phase === "move") {
          lensTarget = clamp01(lensTarget + e.angle / 1.7);
        } else if (e.phase === "end") {
          const snapped = lensTarget > 0.5 ? 1 : 0;
          if (snapped !== lensSnapped) {
            lensSnapped = snapped;
            try { haptics.lens(); } catch { /* noop */ }
            if (snapped === 1) {
              try { getFieldAudio().chime(); } catch { /* noop */ }
            } else {
              note(48, 160);
            }
          }
          lensTarget = snapped;
        }
      },
      scrub: (e) => {
        lastInteractionAt = performance.now();
        const now = performance.now();
        if (now - lastScrubAt < 700) return;
        lastScrubAt = now;
        const p = toLocal(e.cx, e.cy);
        // circling stirs a falling-petal eddy from the nearest open blossom —
        // deeper, faster circles lift more of it and spin it harder
        const b = blossomAt(p.x, p.y);
        const colors = b
          ? [b.species.palette.petal, b.species.palette.glow, b.species.palette.heart]
          : ["#b8f07a", "#fff5cf", "#8ed8c4"];
        const turn = Math.min(3, Math.abs(e.winding));
        const spin = Math.min(1, e.angularVelocity / 1.4);
        burst(p.x, p.y, colors, 8 + Math.round(turn * 5), 26 + Math.round(spin * 22));
        for (const s of specks) s.swirl += Math.sign(e.winding) * (1 + turn * 0.5);
        note(62 + Math.round(turn * 3), 90);
        haptics.ripple(0.2 + turn * 0.12);
        useField.getState().recordTape("ripple", 0.5, "growth/eddy");
      },
      rhythm: (e) => {
        lastInteractionAt = performance.now();
        // a steady tap train entrains the field's growth pulse
        pulseBpm = clamp(e.bpm, 40, 180);
        pulseUntil = performance.now() + 12000;
        lastBeatIdx = -1;
        beatsPlayed = 0;
        try { getFieldAudio().chime(); } catch { /* noop */ }
        haptics.tap();
        markGrowth("pulse", configFor(modeRef.current).tone, 0.7);
        useField.getState().recordTape("ripple", 0.5, "growth/entrain");
      },
    });

    // ————— keyboard dialect (same verbs, quieter) —————
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.target !== root) return; // panel buttons keep their own keys
      const step = 0.05;
      if (ev.key.startsWith("Arrow")) {
        ev.preventDefault();
        cursorVisible = true;
        lastInteractionAt = performance.now();
        if (ev.key === "ArrowLeft") cursorNx = clamp(cursorNx - step, 0.05, 0.95);
        if (ev.key === "ArrowRight") cursorNx = clamp(cursorNx + step, 0.05, 0.95);
        if (ev.key === "ArrowUp") cursorNy = clamp(cursorNy - step, 0.1, 0.95);
        if (ev.key === "ArrowDown") cursorNy = clamp(cursorNy + step, 0.1, 0.95);
        return;
      }
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        if (!cursorVisible) {
          cursorVisible = true;
          return;
        }
        const b = blossomAt(cursorNx * width, cursorNy * height);
        if (b) {
          advanceBlossom(b, 0.5); // held Enter repeats — the keyboard's dwell
        } else if (!ev.repeat) {
          seedAt(cursorNx, cursorNy);
        }
      }
    };
    const onFocus = () => { focused = true; };
    const onBlur = () => { focused = false; cursorVisible = false; };
    root.addEventListener("keydown", onKeyDown);
    root.addEventListener("focus", onFocus);
    root.addEventListener("blur", onBlur);

    // ————— the vessel: the device is the field's body (grammar §5) —————
    // Subscribed passively — nothing flows until the candle has invited the
    // senses. Tilt = the wind leans toward the downhill side (the field's
    // one wind pathway, reused — vines bow, petals ride it); shake = the
    // open blossoms shed briefly.
    const detachVessel = onVessel({
      tilt: ({ gamma }) => {
        if (reduceMotionRef.current) { tiltWind = 0; return; }
        tiltWind = clamp(gamma / 28, -1, 1) * 0.6;
        const now = performance.now();
        if (Math.abs(tiltWind) > 0.33 && now - lastTiltSoundAt > 1400) {
          lastTiltSoundAt = now;
          note(38 + Math.round(Math.abs(tiltWind) * 5), 240); // the wind's word
        }
      },
      shake: ({ intensity }) => {
        if (reduceMotionRef.current) return;
        lastInteractionAt = performance.now();
        let shed = 0;
        for (const system of field.systems) {
          for (const b of system.blossoms) {
            if (b.sx < 0 || !b.geo || b.geo.openness < 0.5) continue;
            b.wobbleV += (hash(b.seed % 1013) - 0.5) * (1.2 + intensity);
            if (shed < 6) {
              shed += 1;
              burst(b.sx, b.sy, [b.species.palette.petal, b.species.palette.petalDeep], 3, 18);
            }
          }
        }
        note(40, 200);
        try { (intensity > 0.7 ? haptics.storm : haptics.chop)(); } catch { /* noop */ }
      },
      // knock = wake / ring the room (rhymes with /coin's pop-to-flip and
      // /flowers' tutti-on-knock): a rap on the case sounds every blossom
      // once, as loud as the knuckle asked
      knock: ({ intensity }) => {
        lastInteractionAt = performance.now();
        tutti(0.4 + intensity * 0.6);
      },
      // flip face-down = night: the field dims and hushes until turned back
      flip: ({ faceDown }) => {
        night = faceDown;
        if (!faceDown) lastInteractionAt = performance.now();
        note(faceDown ? 28 : 76, faceDown ? 480 : 160);
      },
    });

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(root);
    window.addEventListener("resize", resize);

    if (field.systems.length === 0) {
      addSystem(0.18, 0.78, "sigmoid", 0.82, true).born = field.clock - 3600;
      addSystem(0.42, 0.74, "exponential", 0.76, true).born = field.clock - 1400;
      addSystem(0.66, 0.72, "cycle", 0.80, true).born = field.clock - 2500;
      addSystem(0.82, 0.76, "decay", 0.62, true).born = field.clock - 4200;
    }
    setHasGrowth(field.systems.some((s) => s.retiringAt == null));

    const draw = (nowMs: number) => {
      const tier = governor.beginFrame(nowMs);
      if (sleeping) { raf = requestAnimationFrame(draw); return; } // hard pause
      if (tier !== currentTier) {
        currentTier = tier;
        detail = detailForTier(tier);
        resize();
      }
      const delta = Math.min(50, nowMs - last);
      const dt = delta / 1000;
      last = nowMs;
      const reduce = reduceMotionRef.current;

      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dt * 5);
      // three-finger twist's season (grammar §5): spring quickens the
      // vines' clock, winter slows it near dormant — a real law change
      const si = Math.floor(((season % 4) + 4) % 4);
      const seasonMul = [1.3, 1.0, 0.75, 0.45][si];
      field.clock += delta * timeScale * seasonMul;
      field.time += dt * timeScale * (reduce ? 0.08 : 1);
      field.params.time = field.time;

      const params = field.params;
      const active = modeRef.current;

      // the hand's weather decays; the vessel's lean stands as long as held
      params.wind += (windTarget + tiltWind - params.wind) * Math.min(1, dt * 2.2);
      windTarget *= Math.exp(-dt * 0.5);
      params.lens += (lensTarget - params.lens) * Math.min(1, dt * 6);
      panTargetX *= Math.exp(-dt * 0.4);
      panTargetY *= Math.exp(-dt * 0.4);
      panX += (panTargetX - panX) * Math.min(1, dt * 4);
      panY += (panTargetY - panY) * Math.min(1, dt * 4);
      season += (seasonTarget - season) * Math.min(1, dt * 3);
      nightAmt += ((night ? 1 : 0) - nightAmt) * Math.min(1, dt * 1.4);

      // entrained growth pulse (rhythm gesture)
      if (pulseBpm > 0 && nowMs < pulseUntil) {
        const beat = field.time * (pulseBpm / 60);
        const fade = clamp((pulseUntil - nowMs) / 12000, 0, 1);
        params.pulse = (reduce ? 0.25 : 0.5 + 0.5 * Math.sin(beat * Math.PI * 2)) * fade;
        const bi = Math.floor(beat);
        if (bi !== lastBeatIdx) {
          lastBeatIdx = bi;
          if (beatsPlayed < 8) {
            beatsPlayed += 1;
            note(configFor(active).note + 12, 70);
          }
        }
      } else {
        params.pulse = mix(params.pulse, 0, Math.min(1, dt * 3));
        if (pulseBpm > 0 && nowMs >= pulseUntil) pulseBpm = 0;
      }

      params.gravityX = mix(params.gravityX, 0, reduce ? 0.025 : 0.009);
      params.gravityY = mix(params.gravityY, 0, reduce ? 0.025 : 0.009);
      params.bend = mix(params.bend, active === "sigmoid" ? 0.40 : 0.30, reduce ? 0.018 : 0.006);
      params.bloom = mix(params.bloom, active === "exponential" ? 0.32 : 0.16, reduce ? 0.030 : 0.012);
      params.saturation = mix(params.saturation, active === "sigmoid" ? 0.58 : 0.42, reduce ? 0.030 : 0.010);
      params.collapse = mix(params.collapse, active === "decay" ? 0.24 : 0.02, reduce ? 0.028 : 0.012);
      params.rest = mix(params.rest, active === "cycle" ? 0.22 : 0.02, reduce ? 0.026 : 0.010);

      // shared breath: the audio swell clock when audible, RAF when not
      const audioT = (() => {
        try { return getFieldAudio().getAudioTime(); } catch { return null; }
      })();
      const bt = audioT != null ? audioT : nowMs / 1000;
      const breath = bt * Math.PI * 2 * 0.14;

      ctx.clearRect(0, 0, width, height);
      drawBackground(ctx, width, height, field.time, active, params, reduce, bgGrad, panX, panY);
      drawVectorField(ctx, width, height, field.time, active, params, detail.samples, panX, panY);
      drawGlobalCurve(ctx, width, height, field.time, active, params, panX, panY);

      field.traces = field.traces.filter((trace) => (nowMs - trace.born) < 1500);
      field.traces.forEach((trace) => drawTrace(ctx, trace, width, height, nowMs, gradCache));
      // vines compete for light and space, and two rooted close enough graft
      // into a third thing — throttled, an O(n²) pass over a capped population
      if (nowMs - lastCompeteAt > 260) {
        lastCompeteAt = nowMs;
        applyVineCompetitionAndGraft();
      }
      const beforeCount = field.systems.length;
      field.systems = field.systems.filter((system) => {
        if (system.retiringAt != null) return field.clock - system.retiringAt < RETIRE_MS;
        return system.immortal || (field.clock - system.born) < 25000;
      });
      if (field.systems.length !== beforeCount) {
        const standing = field.systems.some((s) => s.retiringAt == null);
        setHasGrowth(standing);
      }
      const fx: SystemFx = { dt: dt * timeScale, reduce, breath, onBloom, detail: detail.samples, grad: gradCache };
      field.systems.forEach((system) => drawSystem(ctx, system, width, height, field.clock, params, active, fx));

      // night (vessel: flip face-down) — the field hushes under a veil
      if (nightAmt > 0.01) {
        ctx.fillStyle = `rgba(1, 3, 2, ${nightAmt * 0.72})`;
        ctx.fillRect(0, 0, width, height);
      }

      // strong wind sheds petals from whatever stands open
      if (!reduce && Math.abs(params.wind) > 0.45 && nowMs - lastShedAt > 200) {
        lastShedAt = nowMs;
        const open: Blossom[] = [];
        for (const system of field.systems) {
          for (const b of system.blossoms) {
            if (b.sx >= 0 && b.geo && b.geo.openness > 0.5) open.push(b);
          }
        }
        if (open.length > 0) {
          const b = open[Math.floor(hash(nowMs * 0.37) * open.length)];
          specks.push({
            x: b.sx,
            y: b.sy,
            vx: params.wind * 50,
            vy: -8,
            born: nowMs,
            life: 1400 + hash(nowMs) * 900,
            r: 1 + hash(nowMs * 1.7) * 1.6,
            color: b.species.palette.petal,
            swirl: (hash(nowMs * 2.3) - 0.5) * 2,
          });
        }
      }

      // specks — petals, pollen, eddies
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = specks.length - 1; i >= 0; i -= 1) {
        const s = specks[i];
        const age = (nowMs - s.born) / s.life;
        if (age >= 1) {
          specks.splice(i, 1);
          continue;
        }
        if (!reduce) {
          const drift = s.swirl * dt * timeScale;
          const nvx = s.vx * Math.cos(drift) - s.vy * Math.sin(drift);
          const nvy = s.vx * Math.sin(drift) + s.vy * Math.cos(drift);
          s.vx = nvx * (1 - dt * 0.6);
          s.vy = nvy * (1 - dt * 0.6) + 14 * dt;
          s.x += (s.vx + params.wind * 26) * dt * timeScale;
          s.y += s.vy * dt * timeScale;
        }
        ctx.fillStyle = colorAlpha(s.color, (1 - age) * 0.7);
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * (1 + age * 0.8), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // the hand's charge / grow feedback
      if (holdUI.active) {
        if (holdUI.blossom && holdUI.blossom.sx >= 0) {
          const b = holdUI.blossom;
          const pulse = reduce ? 0.5 : 0.5 + Math.sin(nowMs / 260) * 0.5;
          ctx.strokeStyle = colorAlpha(b.species.palette.glow, 0.24 + b.phase * 0.3 + pulse * 0.1);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(b.sx, b.sy, b.sr * 0.9 + pulse * 5, 0, Math.PI * 2);
          ctx.stroke();
        } else if (!holdUI.fired) {
          const cfg = configFor(active);
          const holdCharge = smooth(0.25, 0.92, holdUI.elapsed / 1000);
          const radius = 22 + holdCharge * 82;
          ctx.strokeStyle = colorAlpha(cfg.tone, 0.18 + holdCharge * 0.34);
          ctx.lineWidth = 1.2 + holdCharge * 2.4;
          ctx.beginPath();
          ctx.arc(holdUI.x, holdUI.y, radius, 0, Math.PI * 2);
          ctx.stroke();
          const core = ctx.createRadialGradient(holdUI.x, holdUI.y, 0, holdUI.x, holdUI.y, radius * 1.3);
          core.addColorStop(0, colorAlpha(cfg.tone, 0.20 + holdCharge * 0.20));
          core.addColorStop(1, colorAlpha(cfg.tone, 0));
          ctx.fillStyle = core;
          ctx.beginPath();
          ctx.arc(holdUI.x, holdUI.y, radius * 1.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // glimmer — after quiet, a ring where a dwell would land (never text)
      const idleMs = nowMs - lastInteractionAt;
      if (idleMs > 20000) {
        const vis: Blossom[] = [];
        for (const system of field.systems) {
          for (const b of system.blossoms) if (b.sx >= 0) vis.push(b);
        }
        if (vis.length > 0) {
          const slot = Math.floor(nowMs / 9000);
          const b = vis[slot % vis.length];
          const pulse = reduce ? 0.5 : 0.5 + Math.sin(nowMs / 480) * 0.5;
          ctx.strokeStyle = colorAlpha(b.species.palette.glow, 0.1 + pulse * 0.12);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(b.sx, b.sy, Math.max(14, b.sr * 0.7) + pulse * 8, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // keyboard cursor
      if (focused && cursorVisible) {
        const cx = cursorNx * width;
        const cy = cursorNy * height;
        ctx.strokeStyle = "rgba(242, 255, 219, 0.7)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(cx, cy, 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, 2, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(184, 240, 122, 0.85)";
        ctx.fill();
      }

      if (nowMs - readoutTickRef.current > 120) {
        readoutTickRef.current = nowMs;
        const u = (field.time * 0.055 + 0.18) % 1;
        const value = valueForMode(active, u, params);
        const cfg = configFor(active);
        const valueLabel = active === "sigmoid"
          ? `L ${clamp(params.ceiling + params.saturation * 0.18, 0.48, 1).toFixed(2)}`
          : active === "exponential"
          ? `lambda ${params.rate.toFixed(2)}`
          : active === "decay"
          ? `half ${Math.max(0.18, 1.1 - params.collapse * 0.72).toFixed(2)}`
          : `t ${Math.round(u * 100)}`;
        setReadout({
          model: cfg.label,
          phase: phaseForMode(active, u, value),
          value: valueLabel,
          gravity: `g ${Math.hypot(params.gravityX, params.gravityY).toFixed(2)}`,
          force: cfg.force,
        });
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      for (const t of raceTimers) window.clearTimeout(t);
      ro.disconnect();
      window.removeEventListener("resize", resize);
      mq.removeEventListener?.("change", onMotionChange);
      detach();
      detachVessel();
      offVisibility();
      offGalleryPause();
      root.removeEventListener("keydown", onKeyDown);
      root.removeEventListener("focus", onFocus);
      root.removeEventListener("blur", onBlur);
    };
  }, [markGrowth]);

  return (
    <div
      ref={rootRef}
      className="growth-instrument"
      data-touch-surface="true"
      data-pretext-ignore="true"
      role="application"
      tabIndex={0}
      aria-label="growth — a living curve field whose vines carry real species; arrows walk the soil, enter seeds and, held on a blossom, blooms"
    >
      <canvas
        ref={canvasRef}
        className="growth-canvas"
        aria-hidden="true"
      />

      <div className="growth-title" aria-hidden="true">
        <div>growth / living curve field</div>
        <h1>Growth</h1>
      </div>

      <MobileInstrumentPanel
        title="growth model & memory"
        triggerLabel="tune"
        summary={`${readout.model} · ${readout.phase}`}
      >
        <div className="growth-modes" role="group" aria-label="growth model">
          {MODES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={mode === entry.id}
              aria-label={entry.label}
              onClick={() => chooseMode(entry.id)}
              style={{ ["--growth-tone" as string]: entry.tone }}
            >
              <i aria-hidden="true">{entry.short}</i>
              <span>{entry.label}</span>
            </button>
          ))}
        </div>

        <div className="growth-readouts" aria-label="growth state">
          <output>
            <span>model</span>
            <strong>{readout.model}</strong>
          </output>
          <output>
            <span>phase</span>
            <strong>{readout.phase}</strong>
          </output>
          <output>
            <span>curve</span>
            <strong>{readout.value}</strong>
          </output>
          <output>
            <span>field</span>
            <strong>{readout.gravity}</strong>
          </output>
          <output>
            <span>force</span>
            <strong>{readout.force}</strong>
          </output>
        </div>

        <div className="growth-memory" aria-live="polite">
          {marks.map((mark, index) => (
            <span key={mark.id} style={{ ["--growth-mark-tone" as string]: mark.tone, opacity: index === 0 ? 1 : 0.42 + mark.level * 0.24 }}>
              <i aria-hidden="true" />
              <b>{mark.label}</b>
            </span>
          ))}
        </div>
      </MobileInstrumentPanel>

      <LetGo label="let the field go" onLetGo={() => letGoRef.current()} visible={hasGrowth} />

      <style
        dangerouslySetInnerHTML={{
          __html: `
            .growth-instrument {
              position: fixed;
              inset: 0;
              overflow: hidden;
              isolation: isolate;
              background: #03110d;
              color: rgba(239, 248, 221, 0.94);
              -webkit-user-select: none;
              user-select: none;
              -webkit-touch-callout: none;
              outline: none;
            }

            .growth-instrument:focus-visible {
              outline: 2px solid rgba(184, 240, 122, 0.7);
              outline-offset: -2px;
            }

            .growth-canvas {
              position: absolute;
              inset: 0;
              z-index: 0;
              width: 100%;
              height: 100%;
              display: block;
              touch-action: none;
              cursor: crosshair;
            }

            .growth-title {
              position: absolute;
              z-index: 3;
              top: calc(74px + env(safe-area-inset-top, 0px));
              left: var(--pad-x);
              width: min(500px, calc(100vw - var(--pad-x) * 2));
              pointer-events: none;
              text-shadow: 0 20px 62px rgba(0, 0, 0, 0.72);
            }

            .growth-title div {
              margin-bottom: 10px;
              color: rgba(224, 246, 190, 0.52);
              font-family: var(--font-mono, ui-monospace, monospace);
              font-size: 11px;
              letter-spacing: 0;
              text-transform: lowercase;
            }

            .growth-title h1 {
              margin: 0;
              font-family: var(--font-fraunces, var(--font-serif, Georgia), serif);
              font-size: clamp(50px, 8vw, 112px);
              line-height: 0.9;
              font-weight: 520;
              letter-spacing: 0;
              color: rgba(242, 255, 219, 0.98);
            }

            .growth-modes {
              position: absolute;
              z-index: 5;
              right: calc(18px + env(safe-area-inset-right, 0px));
              top: calc(92px + env(safe-area-inset-top, 0px));
              display: grid;
              gap: 7px;
              width: 168px;
            }

            .growth-modes button {
              appearance: none;
              min-height: 42px;
              display: grid;
              grid-template-columns: 26px minmax(0, 1fr);
              align-items: center;
              gap: 9px;
              padding: 7px 9px;
              border: 1px solid rgba(232, 255, 204, 0.14);
              border-radius: 7px;
              background: rgba(4, 17, 12, 0.48);
              color: rgba(238, 250, 218, 0.66);
              backdrop-filter: blur(12px);
              -webkit-backdrop-filter: blur(12px);
              cursor: pointer;
              font-family: var(--font-mono, ui-monospace, monospace);
              font-size: 10px;
              letter-spacing: 0;
              text-transform: lowercase;
              text-align: left;
              transition: background 160ms ease, color 160ms ease, border-color 160ms ease;
            }

            .growth-modes button:hover,
            .growth-modes button[aria-pressed="true"] {
              color: rgba(248, 255, 232, 0.96);
              border-color: color-mix(in srgb, var(--growth-tone) 42%, transparent);
              background: color-mix(in srgb, var(--growth-tone) 11%, rgba(4, 17, 12, 0.62));
            }

            .growth-modes i {
              display: grid;
              place-items: center;
              width: 26px;
              height: 26px;
              border-radius: 50%;
              border: 1px solid color-mix(in srgb, var(--growth-tone) 46%, transparent);
              color: var(--growth-tone);
              font-style: normal;
              font-family: var(--font-fraunces, Georgia, serif);
              font-size: 13px;
              line-height: 1;
              box-shadow: 0 0 18px color-mix(in srgb, var(--growth-tone) 24%, transparent);
            }

            .growth-modes span {
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            }

            .growth-readouts {
              position: absolute;
              z-index: 5;
              left: var(--pad-x);
              bottom: calc(86px + env(safe-area-inset-bottom, 0px));
              display: grid;
              grid-template-columns: repeat(5, minmax(72px, auto));
              gap: 8px;
              pointer-events: none;
            }

            .growth-readouts output {
              display: grid;
              gap: 3px;
              min-width: 72px;
              padding: 8px 9px 7px;
              border: 1px solid rgba(232, 255, 204, 0.13);
              border-radius: 7px;
              background: rgba(4, 17, 12, 0.52);
              backdrop-filter: blur(12px);
              -webkit-backdrop-filter: blur(12px);
            }

            .growth-readouts span {
              color: rgba(232, 255, 204, 0.46);
              font-family: var(--font-mono, ui-monospace, monospace);
              font-size: 9px;
              letter-spacing: 0;
              text-transform: lowercase;
            }

            .growth-readouts strong {
              color: rgba(248, 255, 232, 0.96);
              font-family: var(--font-fraunces, var(--font-serif, Georgia), serif);
              font-size: 20px;
              line-height: 1;
              font-weight: 520;
              font-variant-numeric: tabular-nums;
              white-space: nowrap;
            }

            .growth-memory {
              position: absolute;
              z-index: 5;
              right: calc(18px + env(safe-area-inset-right, 0px));
              bottom: calc(88px + env(safe-area-inset-bottom, 0px));
              display: flex;
              align-items: center;
              justify-content: flex-end;
              gap: 8px;
              max-width: min(520px, calc(100vw - 640px));
              padding: 8px 10px;
              border: 1px solid rgba(232, 255, 204, 0.13);
              border-radius: 7px;
              background: rgba(4, 17, 12, 0.46);
              backdrop-filter: blur(12px);
              -webkit-backdrop-filter: blur(12px);
              color: rgba(238, 250, 218, 0.68);
              font-family: var(--font-mono, ui-monospace, monospace);
              font-size: 10px;
              letter-spacing: 0;
              text-transform: lowercase;
              pointer-events: none;
              overflow: hidden;
            }

            .growth-memory span {
              display: inline-flex;
              align-items: center;
              min-width: 0;
              gap: 6px;
              white-space: nowrap;
            }

            .growth-memory i {
              display: block;
              flex: 0 0 auto;
              width: 10px;
              height: 2px;
              background: var(--growth-mark-tone);
              box-shadow: 0 0 14px var(--growth-mark-tone);
            }

            .growth-memory span:first-child i {
              width: 28px;
            }

            .growth-memory b {
              min-width: 0;
              overflow: hidden;
              text-overflow: ellipsis;
              font-weight: 400;
            }

            body:has(.growth-instrument) header:not(.oda-site-header) {
              background: transparent !important;
              border-bottom: 0 !important;
              backdrop-filter: none !important;
              -webkit-backdrop-filter: none !important;
            }

            body:has(.growth-instrument) .oda-field-watch,
            body:has(.growth-instrument) .oda-candle-mark,
            body:has(.growth-instrument) .oda-tape-shell,
            body:has(.growth-instrument) .oda-sound-toggle {
              display: none !important;
            }

            @media (max-width: 920px) {
              .growth-title {
                top: calc(70px + env(safe-area-inset-top, 0px));
                left: 16px;
                right: 16px;
                width: auto;
              }

              .growth-title h1 {
                font-size: clamp(44px, 16vw, 72px);
              }

              .growth-modes {
                left: 12px;
                right: 12px;
                top: auto;
                bottom: calc(18px + env(safe-area-inset-bottom, 0px));
                width: auto;
                grid-template-columns: repeat(4, minmax(0, 1fr));
                gap: 7px;
              }

              .growth-modes button {
                grid-template-columns: 1fr;
                justify-items: center;
                min-height: 56px;
                padding: 7px 5px;
                text-align: center;
              }

              .growth-modes span {
                font-size: 9px;
                max-width: 100%;
              }

              .growth-readouts {
                left: 12px;
                right: 12px;
                bottom: calc(86px + env(safe-area-inset-bottom, 0px));
                grid-template-columns: repeat(5, minmax(0, 1fr));
                gap: 6px;
              }

              .growth-readouts output {
                min-width: 0;
                padding: 7px 7px 6px;
              }

              .growth-readouts strong {
                font-size: clamp(13px, 3.6vw, 18px);
                overflow: hidden;
                text-overflow: ellipsis;
              }

              .growth-memory {
                left: 12px;
                right: 12px;
                bottom: calc(146px + env(safe-area-inset-bottom, 0px));
                max-width: none;
                justify-content: flex-start;
              }

              .growth-memory span:nth-child(n+5) {
                display: none;
              }
            }

            @media (max-width: 560px) {
              .growth-title div {
                font-size: 10px;
              }

              .growth-readouts {
                grid-template-columns: repeat(3, minmax(0, 1fr));
              }

              .growth-readouts output:nth-child(4),
              .growth-readouts output:nth-child(5) {
                display: none;
              }

              .growth-memory {
                bottom: calc(154px + env(safe-area-inset-bottom, 0px));
                font-size: 9px;
              }

              .growth-memory span:nth-child(n+4) {
                display: none;
              }
            }

            @media (max-width: 720px) {
              .mobile-instrument-panel__content .growth-modes {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 8px;
              }

              .mobile-instrument-panel__content .growth-modes button {
                grid-template-columns: 28px minmax(0, 1fr);
                justify-items: stretch;
                min-height: 48px;
                padding: 8px 10px;
                text-align: left;
              }

              .mobile-instrument-panel__content .growth-readouts {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 8px;
                margin-top: 10px !important;
              }

              .mobile-instrument-panel__content .growth-readouts output,
              .mobile-instrument-panel__content .growth-readouts output:nth-child(4),
              .mobile-instrument-panel__content .growth-readouts output:nth-child(5) {
                display: grid;
                min-width: 0;
                padding: 9px;
              }

              .mobile-instrument-panel__content .growth-readouts output:last-child {
                grid-column: 1 / -1;
              }

              .mobile-instrument-panel__content .growth-readouts strong {
                font-size: 17px;
              }

              .mobile-instrument-panel__content .growth-memory {
                display: flex;
                flex-wrap: wrap;
                justify-content: flex-start;
                gap: 8px 12px;
                margin-top: 10px !important;
              }

              .mobile-instrument-panel__content .growth-memory span,
              .mobile-instrument-panel__content .growth-memory span:nth-child(n+4),
              .mobile-instrument-panel__content .growth-memory span:nth-child(n+5) {
                display: inline-flex;
              }
            }

            @media (prefers-reduced-motion: reduce) {
              .growth-canvas {
                cursor: default;
              }

              .growth-modes button {
                transition: none;
              }
            }
          `,
        }}
      />
    </div>
  );
}
