"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { useField } from "@/store/field";
import MobileInstrumentPanel from "@/components/MobileInstrumentPanel";

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
};

type GardenState = {
  params: FieldParams;
  time: number;
  systems: GrowthSystem[];
  traces: DragTrace[];
  nextId: number;
};

type PointerState = {
  active: boolean;
  id: number | null;
  x: number;
  y: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  downAt: number;
  moved: number;
  holdFired: boolean;
  timer: number | null;
  lastTape: number;
  lastHaptic: number;
  lastNote: number;
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

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const smooth = (edge0: number, edge1: number, value: number) => {
  const t = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

function configFor(mode: GrowthMode) {
  return MODES.find((entry) => entry.id === mode) ?? MODES[0];
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
  const seed = id * 17.13 + x * 23 + y * 41;
  const cfg = configFor(mode);
  return {
    id,
    x: clamp(x, 0.04, 0.96),
    y: clamp(y, 0.18, 0.94),
    born,
    mode,
    energy: clamp(0.64 + hash(seed) * 0.58 + force * 0.18, 0.45, 1.35),
    scale: 0.70 + hash(seed + 4.1) * 0.85,
    hue: cfg.tone,
    bend: (hash(seed + 9.4) - 0.5) * 2,
    phase: hash(seed + 15.7) * Math.PI * 2,
    force,
    immortal,
  };
}

function drawBloom(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  tone: string,
  alpha: number,
  spin: number,
  collapse: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(spin);
  const petals = 7;
  for (let i = 0; i < petals; i += 1) {
    const a = (i / petals) * Math.PI * 2;
    const stretch = radius * (1.25 + Math.sin(spin * 2 + i) * 0.10);
    ctx.save();
    ctx.rotate(a);
    ctx.fillStyle = colorAlpha(tone, alpha * (0.30 + collapse * 0.10));
    ctx.beginPath();
    ctx.ellipse(stretch * 0.62, 0, radius * 0.22, stretch * 0.52, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 2.8);
  glow.addColorStop(0, colorAlpha(tone, alpha * 0.42));
  glow.addColorStop(1, colorAlpha(tone, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 2.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `rgba(255, 245, 206, ${alpha * 0.86})`;
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(2.2, radius * 0.18), 0, Math.PI * 2);
  ctx.fill();
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
) {
  const cfg = configFor(mode);
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#03120f");
  sky.addColorStop(0.38, "#061911");
  sky.addColorStop(0.72, "#0b1710");
  sky.addColorStop(1, "#050805");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  const glowX = width * (0.50 + params.gravityX * 0.10);
  const glowY = height * (0.33 + params.gravityY * 0.05);
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
    const drift = reduce ? 0 : Math.sin(now * (0.15 + hash(i) * 0.22) + i) * 10;
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
) {
  const cfg = configFor(mode);
  const step = width < 700 ? 42 : 54;
  const top = height * 0.12;
  const bottom = height * 0.78;
  ctx.lineCap = "round";

  for (let y = top; y <= bottom; y += step) {
    for (let x = step * 0.45; x <= width; x += step) {
      const nx = x / width - 0.5;
      const ny = y / height - 0.5;
      const pulse = Math.sin(nx * 8.5 + ny * 4.2 + now * 0.34) * 0.42
        + Math.sin(Math.hypot(nx, ny) * 12 - now * 0.25) * 0.22;
      const angle = -Math.PI / 2
        + params.gravityX * 0.78
        + params.bend * pulse * 0.42
        + (mode === "decay" ? 0.32 : 0);
      const length = step * (0.24 + Math.abs(pulse) * 0.20 + params.saturation * 0.09);
      const alpha = 0.07 + Math.abs(pulse) * 0.08 + params.bloom * 0.035;
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
) {
  const left = width * 0.07;
  const right = width * 0.93;
  const span = right - left;
  const base = height * (width < 700 ? 0.70 : 0.68);
  const amp = height * (width < 700 ? 0.42 : 0.48);
  const samples = 220;

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
    ctx.strokeStyle = active ? colorAlpha(entry.tone, 0.72) : colorAlpha(entry.tone, 0.14);
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

  const ring = ctx.createRadialGradient(trace.x * width, trace.y * height, 0, trace.x * width, trace.y * height, 42 + age * 80);
  ring.addColorStop(0, colorAlpha(cfg.tone, alpha * 0.12));
  ring.addColorStop(1, colorAlpha(cfg.tone, 0));
  ctx.fillStyle = ring;
  ctx.beginPath();
  ctx.arc(trace.x * width, trace.y * height, 42 + age * 80, 0, Math.PI * 2);
  ctx.fill();
}

function drawSystem(
  ctx: CanvasRenderingContext2D,
  system: GrowthSystem,
  width: number,
  height: number,
  now: number,
  params: FieldParams,
  activeMode: GrowthMode,
) {
  const age = (now - system.born) / 1000;
  const life = system.immortal ? 1 : clamp(1 - Math.max(0, age - 15) / 8, 0, 1);
  if (life <= 0) return;

  const cfg = configFor(system.mode);
  const rootX = system.x * width;
  const rootY = system.y * height;
  const isMobile = width < 700;
  const heightScale = (isMobile ? 0.70 : 1) * (0.78 + system.energy * 0.35);
  const stemHeight = clamp(height * 0.16, 92, 168) * system.scale * heightScale;
  const span = clamp(width * 0.12, 70, 178) * (0.76 + system.scale * 0.28);
  const cycleSpeed = system.immortal ? 0.055 : 1 / (5.8 + system.scale * 3.4);
  const progress = system.immortal
    ? (0.08 + ((age * cycleSpeed + system.phase / (Math.PI * 2)) % 0.92))
    : clamp(age * cycleSpeed + system.force * 0.08 + params.bloom * 0.06, 0, 1);
  const activeLift = activeMode === system.mode ? 1 : 0.72;
  const collapse = params.collapse * (system.mode === "decay" || activeMode === "decay" ? 1 : 0.28);
  const rest = params.rest * (system.mode === "cycle" || activeMode === "cycle" ? 1 : 0.2);
  const tone = system.hue || cfg.tone;
  const alpha = (system.immortal ? 0.46 : 0.76) * life * activeLift;
  const samples = 34;
  const points: Array<{ x: number; y: number; v: number; u: number }> = [];

  for (let i = 0; i <= samples; i += 1) {
    const u = (i / samples) * progress;
    const v = valueForMode(system.mode, u, params);
    const curl = Math.sin(u * Math.PI * 3.2 + system.phase + params.time * 0.36) * (8 + params.bend * 12);
    const gravityX = params.gravityX * stemHeight * 0.34 * u * u;
    const gravityY = params.gravityY * stemHeight * 0.12 * u;
    const decayDrop = collapse * u * u * stemHeight * 0.34;
    const restDrop = rest * smooth(0.62, 1, u) * stemHeight * 0.30;
    const x = rootX + (u - 0.06) * span + gravityX + curl * system.bend;
    const y = rootY - v * stemHeight + gravityY + decayDrop + restDrop;
    points.push({ x, y, v, u });
  }

  const rootGlow = ctx.createRadialGradient(rootX, rootY, 0, rootX, rootY, 54);
  rootGlow.addColorStop(0, colorAlpha(tone, alpha * 0.20));
  rootGlow.addColorStop(1, colorAlpha(tone, 0));
  ctx.fillStyle = rootGlow;
  ctx.beginPath();
  ctx.arc(rootX, rootY, 54, 0, Math.PI * 2);
  ctx.fill();

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

  const stroke = ctx.createLinearGradient(rootX, rootY, points[points.length - 1]?.x ?? rootX, points[points.length - 1]?.y ?? rootY);
  stroke.addColorStop(0, colorAlpha(cfg.low, alpha * 0.86));
  stroke.addColorStop(0.58, colorAlpha(tone, alpha * 0.92));
  stroke.addColorStop(1, colorAlpha("#fff5cf", alpha * 0.78));
  ctx.strokeStyle = stroke;
  ctx.lineWidth = system.immortal ? 1.15 : 1.85 + system.energy * 0.8;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();

  for (let i = 5; i < points.length; i += 6) {
    const point = points[i];
    const next = points[Math.min(points.length - 1, i + 1)] ?? point;
    const angle = Math.atan2(next.y - point.y, next.x - point.x);
    const side = i % 2 === 0 ? -1 : 1;
    const leaf = (5 + point.v * 9) * (1 - collapse * 0.45) * life;
    if (leaf < 2) continue;
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(angle + side * 1.15);
    ctx.fillStyle = colorAlpha(tone, alpha * (0.22 + point.v * 0.26));
    ctx.beginPath();
    ctx.ellipse(leaf * 0.62, 0, leaf, leaf * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const tip = points[points.length - 1];
  const bloomReadiness = clamp((tip.v - 0.48) / 0.46 + params.bloom * 0.40 + system.force * 0.16, 0, 1);
  if (bloomReadiness > 0.08) {
    drawBloom(
      ctx,
      tip.x,
      tip.y,
      (7 + system.scale * 9) * bloomReadiness * (1 - rest * 0.34),
      tone,
      alpha * bloomReadiness,
      system.phase + now * 0.25,
      collapse,
    );
  }

  if (collapse > 0.08 || system.mode === "decay") {
    const fallAlpha = alpha * (collapse * 0.62 + (system.mode === "decay" ? 0.16 : 0));
    for (let i = 0; i < 5; i += 1) {
      const n = hash(system.id * 13 + i * 8);
      const fallT = (now * (0.09 + n * 0.04) + n) % 1;
      const px = tip.x + (n - 0.5) * 54 + params.gravityX * 22;
      const py = tip.y + fallT * (80 + i * 12);
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
    },
    time: 0,
    systems: [],
    traces: [],
    nextId: 1,
  });
  const pointerRef = useRef<PointerState>({
    active: false,
    id: null,
    x: 0.5,
    y: 0.5,
    startX: 0.5,
    startY: 0.5,
    lastX: 0.5,
    lastY: 0.5,
    downAt: 0,
    moved: 0,
    holdFired: false,
    timer: null,
    lastTape: 0,
    lastHaptic: 0,
    lastNote: 0,
  });

  const [mode, setMode] = useState<GrowthMode>("sigmoid");
  const [readout, setReadout] = useState<Readout>(INITIAL_READOUT);
  const [marks, setMarks] = useState<GestureMark[]>([
    { id: 0, label: "living", tone: MODES[0].tone, level: 0.48 },
  ]);

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

    const field = fieldRef.current;
    const pointer = pointerRef.current;
    let raf = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let last = performance.now();

    const resize = () => {
      const rect = root.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(320, Math.floor(rect.width));
      height = Math.max(520, Math.floor(rect.height));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const pointFromEvent = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1),
        y: clamp((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1),
      };
    };

    const addSystem = (x: number, y: number, systemMode = modeRef.current, force = 1, immortal = false) => {
      const system = makeSystem(field.nextId++, x, y, systemMode, performance.now(), force, immortal);
      field.systems.push(system);
      if (field.systems.length > 42) {
        const firstTemporary = field.systems.findIndex((entry) => !entry.immortal);
        field.systems.splice(firstTemporary >= 0 ? firstTemporary : 0, 1);
      }
      return system;
    };

    const forceAt = (x: number, y: number, forcedMode = modeRef.current) => {
      const cfg = configFor(forcedMode);
      pointer.holdFired = true;

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

    const clearHoldTimer = () => {
      if (pointer.timer !== null) {
        window.clearTimeout(pointer.timer);
        pointer.timer = null;
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      const p = pointFromEvent(event);
      pointer.active = true;
      pointer.id = event.pointerId;
      pointer.x = p.x;
      pointer.y = p.y;
      pointer.startX = p.x;
      pointer.startY = p.y;
      pointer.lastX = p.x;
      pointer.lastY = p.y;
      pointer.downAt = performance.now();
      pointer.moved = 0;
      pointer.holdFired = false;
      pointer.lastTape = 0;
      pointer.lastHaptic = 0;
      pointer.lastNote = 0;
      try { canvas.setPointerCapture(event.pointerId); } catch { /* noop */ }
      seedAt(p.x, p.y);
      clearHoldTimer();
      pointer.timer = window.setTimeout(() => {
        if (!pointer.active || pointer.id !== event.pointerId || pointer.moved > 34) return;
        forceAt(pointer.x, pointer.y);
      }, 620);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!pointer.active || pointer.id !== event.pointerId) return;
      const p = pointFromEvent(event);
      const dx = p.x - pointer.lastX;
      const dy = p.y - pointer.lastY;
      const totalDx = p.x - pointer.startX;
      const totalDy = p.y - pointer.startY;
      const speed = Math.hypot(dx * width, dy * height);
      pointer.moved += speed;
      pointer.x = p.x;
      pointer.y = p.y;

      const params = field.params;
      params.gravityX = clamp(mix(params.gravityX, totalDx * 2.2, 0.18), -1.1, 1.1);
      params.gravityY = clamp(mix(params.gravityY, totalDy * 1.8, 0.16), -0.8, 1.1);
      params.bend = clamp(mix(params.bend, 0.30 + Math.min(1, pointer.moved / 280) * 0.70, 0.10), 0.1, 1);
      params.rate = clamp(mix(params.rate, 0.22 + Math.abs(totalDx) * 1.4 + (1 - p.y) * 0.42, 0.06), 0.08, 1);
      params.ceiling = clamp(mix(params.ceiling, 0.56 + (1 - p.y) * 0.42, 0.08), 0.48, 0.98);
      params.steepness = clamp(mix(params.steepness, 0.26 + Math.abs(totalDy) * 1.8, 0.08), 0.1, 1);

      if (modeRef.current === "decay") params.collapse = Math.max(params.collapse, Math.min(0.72, pointer.moved / 480));
      if (modeRef.current === "cycle") params.rest = Math.max(params.rest, Math.min(0.62, p.y));
      if (modeRef.current === "exponential") params.bloom = Math.max(params.bloom, Math.min(0.92, speed / 50));

      field.traces.push({
        x: p.x,
        y: p.y,
        px: pointer.lastX,
        py: pointer.lastY,
        born: performance.now(),
        force: clamp(speed / 34, 0.14, 1),
        mode: modeRef.current,
      });
      if (field.traces.length > 56) field.traces.splice(0, field.traces.length - 56);

      const now = performance.now();
      if (now - pointer.lastTape > 140) {
        pointer.lastTape = now;
        useField.getState().recordTape("ripple", clamp(speed / 52, 0.22, 0.78), `growth/${modeRef.current}/bend`);
      }
      if (now - pointer.lastHaptic > 190 && speed > 9) {
        pointer.lastHaptic = now;
        haptics.ripple(clamp(speed / 42, 0.18, 0.72));
      }
      if (now - pointer.lastNote > 120 && speed > 7) {
        pointer.lastNote = now;
        try { getFieldAudio().playNote(configFor(modeRef.current).note + Math.round((1 - p.y) * 18), 58); } catch { /* noop */ }
      }

      pointer.lastX = p.x;
      pointer.lastY = p.y;
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!pointer.active || pointer.id !== event.pointerId) return;
      clearHoldTimer();
      try { canvas.releasePointerCapture(event.pointerId); } catch { /* noop */ }
      const cfg = configFor(modeRef.current);
      if (!pointer.holdFired && pointer.moved > 42) {
        markGrowth("bend", cfg.tone, 0.62);
      }
      pointer.active = false;
      pointer.id = null;
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (pointer.id === event.pointerId) {
        clearHoldTimer();
        pointer.active = false;
        pointer.id = null;
      }
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(root);
    window.addEventListener("resize", resize);

    const born = performance.now();
    if (field.systems.length === 0) {
      addSystem(0.18, 0.78, "sigmoid", 0.82, true).born = born - 3600;
      addSystem(0.42, 0.74, "exponential", 0.76, true).born = born - 1400;
      addSystem(0.66, 0.72, "cycle", 0.80, true).born = born - 2500;
      addSystem(0.82, 0.76, "decay", 0.62, true).born = born - 4200;
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);

    const draw = (nowMs: number) => {
      const dt = Math.min(0.05, (nowMs - last) / 1000);
      last = nowMs;
      const reduce = reduceMotionRef.current;
      field.time += reduce ? dt * 0.08 : dt;
      field.params.time = field.time;

      const params = field.params;
      const active = modeRef.current;
      const holdAge = pointer.active ? clamp((nowMs - pointer.downAt) / 1000, 0, 1.6) : 0;
      const holdCharge = pointer.active && !pointer.holdFired ? smooth(0.18, 1.12, holdAge) : 0;

      params.gravityX = mix(params.gravityX, 0, reduce ? 0.025 : 0.009);
      params.gravityY = mix(params.gravityY, 0, reduce ? 0.025 : 0.009);
      params.bend = mix(params.bend, active === "sigmoid" ? 0.40 : 0.30, reduce ? 0.018 : 0.006);
      params.bloom = mix(params.bloom, active === "exponential" ? 0.32 : 0.16, reduce ? 0.030 : 0.012);
      params.saturation = mix(params.saturation, active === "sigmoid" ? 0.58 : 0.42, reduce ? 0.030 : 0.010);
      params.collapse = mix(params.collapse, active === "decay" ? 0.24 : 0.02, reduce ? 0.028 : 0.012);
      params.rest = mix(params.rest, active === "cycle" ? 0.22 : 0.02, reduce ? 0.026 : 0.010);

      ctx.clearRect(0, 0, width, height);
      drawBackground(ctx, width, height, field.time, active, params, reduce);
      drawVectorField(ctx, width, height, field.time, active, params);
      drawGlobalCurve(ctx, width, height, field.time, active, params);

      field.traces = field.traces.filter((trace) => (nowMs - trace.born) < 1500);
      field.traces.forEach((trace) => drawTrace(ctx, trace, width, height, nowMs));
      field.systems = field.systems.filter((system) => system.immortal || (nowMs - system.born) < 25000);
      field.systems.forEach((system) => drawSystem(ctx, system, width, height, nowMs, params, active));

      if (pointer.active) {
        const cfg = configFor(active);
        const px = pointer.x * width;
        const py = pointer.y * height;
        const radius = 22 + holdCharge * 82;
        ctx.strokeStyle = colorAlpha(cfg.tone, 0.18 + holdCharge * 0.34);
        ctx.lineWidth = 1.2 + holdCharge * 2.4;
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.stroke();
        const core = ctx.createRadialGradient(px, py, 0, px, py, radius * 1.3);
        core.addColorStop(0, colorAlpha(cfg.tone, 0.20 + holdCharge * 0.20));
        core.addColorStop(1, colorAlpha(cfg.tone, 0));
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(px, py, radius * 1.3, 0, Math.PI * 2);
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
      clearHoldTimer();
      ro.disconnect();
      window.removeEventListener("resize", resize);
      mq.removeEventListener?.("change", onMotionChange);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [markGrowth]);

  return (
    <div
      ref={rootRef}
      className="growth-instrument"
      data-touch-surface="true"
      data-pretext-ignore="true"
      aria-label="growth - living mathematical garden"
    >
      <canvas
        ref={canvasRef}
        className="growth-canvas"
        aria-label="living growth curve field"
      />

      <div className="growth-title" aria-hidden="true">
        <div>growth / living curve field</div>
        <h1>Growth</h1>
      </div>

      <div className="growth-gesture" aria-hidden="true">
        tap to seed · drag to bend · hold to force
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

            .growth-gesture {
              display: none;
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
              .growth-gesture {
                position: fixed;
                z-index: 4;
                right: 16px;
                bottom: calc(122px + env(safe-area-inset-bottom, 0px));
                left: 16px;
                display: block;
                color: rgba(232, 255, 204, 0.48);
                font-family: var(--font-mono, ui-monospace, monospace);
                font-size: 9px;
                letter-spacing: 0.06em;
                text-align: center;
                text-transform: lowercase;
                pointer-events: none;
                text-shadow: 0 2px 14px rgba(0, 0, 0, 0.9);
              }

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
