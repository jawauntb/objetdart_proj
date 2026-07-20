"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { useField } from "@/store/field";
import MobileInstrumentPanel from "@/components/MobileInstrumentPanel";

/**
 * /earth - a tactile geologic instrument.
 *
 * The page is a mineral cross-section: optical strata, quartz veins, fault
 * planes, pressure blooms, and a seismograph. Pointer gestures are interpreted
 * as pressure rather than cursor input: taps seed mineral evidence, drags shear
 * strata into fault lines, and long presses compress the section into a brief
 * metamorphic glow.
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

type DragState = {
  active: boolean;
  pointerId: number | null;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: number;
  downT: number;
  long: boolean;
  zone: "strata" | "surface" | "seismo";
  pressTimer: number | null;
  lastFault: number;
  lastHaptic: number;
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
  },
];

const SKY_FRAC = 0.14;
const SURFACE_FRAC = 0.07;
const STRATA_FRAC = 0.58;
const SEISMO_FRAC = 0.21;
const SEISMO_SAMPLES = 1440;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const hash = (value: number) => {
  const x = Math.sin(value * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
};

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

function stratumBounds(stratum: Stratum, zones: Zones) {
  const h = zones.strataBot - zones.strataTop;
  return {
    y0: zones.strataTop + stratum.top * h,
    y1: zones.strataTop + stratum.bottom * h,
  };
}

function warpedLineY(base: number, x: number, amp: number, phase: number) {
  return base
    + Math.sin(x * 0.006 + phase) * amp
    + Math.sin(x * 0.017 + phase * 1.71) * amp * 0.34;
}

function drawWarpedLine(
  ctx: CanvasRenderingContext2D,
  width: number,
  y: number,
  amp: number,
  phase: number,
) {
  ctx.beginPath();
  for (let x = -8; x <= width + 8; x += 18) {
    const yy = warpedLineY(y, x, amp, phase);
    if (x <= -8) ctx.moveTo(x, yy);
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
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 3.1);
  glow.addColorStop(0, colorAlpha(hue, alpha * 0.52));
  glow.addColorStop(1, colorAlpha(hue, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 3.1, 0, Math.PI * 2);
  ctx.fill();

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
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.strokeStyle = colorAlpha(hue, alpha);
  ctx.lineWidth = Math.max(0.8, radius * 0.08);
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let i = 0; i < 42; i++) {
    const t = i / 41;
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
  ctx.strokeStyle = colorAlpha(hue, alpha * 0.86);
  ctx.lineWidth = Math.max(1, radius * 0.11);
  ctx.lineCap = "round";
  ctx.shadowColor = colorAlpha(hue, alpha * 0.55);
  ctx.shadowBlur = radius * 0.5;
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
  ctx.shadowBlur = 0;
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
    ctx.ellipse(x, y + i * 4, r * 1.8, r * 0.32, 0, Math.PI * 0.08, Math.PI * 0.92);
    ctx.stroke();
  }
  ctx.restore();
}

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
  const [readouts, setReadouts] = useState({ magnitude: "0.0", pressure: "0.00", slip: "0" });

  const markEarth = useCallback((label: string, tone = "#d8c8a8") => {
    setEarthMarks((prev) => [{ label, tone, t: performance.now() }, ...prev].slice(0, 5));
  }, []);

  const activateLayer = useCallback((id: string) => {
    actionRef.current?.activateStratum(id);
  }, []);

  const seismoBufRef = useRef<Float32Array>(new Float32Array(SEISMO_SAMPLES));
  const seismoHeadRef = useRef(0);
  const clickSpikesRef = useRef<Array<{ t0: number; strength: number }>>([]);
  const mineralMarksRef = useRef<MineralMark[]>([]);
  const faultsRef = useRef<FaultTrace[]>([]);
  const bloomsRef = useRef<PressureBloom[]>([]);
  const fracturesRef = useRef<Fracture[]>([]);
  const quakeSpikeRef = useRef<{ t0: number; strength: number } | null>(null);
  const activeStratumRef = useRef<{ id: string; t0: number } | null>(null);
  const cursorRef = useRef({ x: 0, y: 0, lastT: 0, vel: 0, over: false });
  const shearRef = useRef({ current: 0, target: 0 });
  const pressureRef = useRef({ current: 0, target: 0, lastT: 0 });
  const dragRef = useRef<DragState>({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    x: 0,
    y: 0,
    moved: 0,
    downT: 0,
    long: false,
    zone: "surface",
    pressTimer: null,
    lastFault: 0,
    lastHaptic: 0,
  });

  const quietCore = useCallback(() => {
    clickSpikesRef.current = [];
    mineralMarksRef.current = [];
    faultsRef.current = [];
    bloomsRef.current = [];
    fracturesRef.current = [];
    quakeSpikeRef.current = null;
    activeStratumRef.current = null;
    shearRef.current = { current: 0, target: 0 };
    pressureRef.current = { current: 0, target: 0, lastT: performance.now() };
    seismoBufRef.current.fill(0);
    seismoHeadRef.current = 0;
    setActiveStratumId(null);
    setHoverStratum(null);
    setReadouts({ magnitude: "0.0", pressure: "0.00", slip: "0" });
    setEarthMarks([{ label: "quiet core", tone: "#b8ee78", t: performance.now() }]);
    try { getFieldAudio().bell(); } catch { /* noop */ }
    try { haptics.roll(); } catch { /* noop */ }
    useField.getState().recordTape("ripple", 0.24, "earth/quiet-core");
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    const bg = bgRef.current;
    const fg = fgRef.current;
    if (!wrap || !bg || !fg) return;
    const bgCtx = bg.getContext("2d");
    const fgCtx = fg.getContext("2d");
    if (!bgCtx || !fgCtx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let viewW = 0;
    let viewH = 0;
    let raf = 0;
    let lastReadoutMs = 0;
    const clearTimers = new Set<number>();

    const zones = (): Zones => {
      const skyTop = 0;
      const skyBot = viewH * SKY_FRAC;
      const surfaceTop = skyBot;
      const surfaceBot = surfaceTop + viewH * SURFACE_FRAC;
      const strataTop = surfaceBot;
      const strataBot = strataTop + viewH * STRATA_FRAC;
      const seismoTop = strataBot;
      return {
        skyTop,
        skyBot,
        surfaceTop,
        surfaceBot,
        strataTop,
        strataBot,
        seismoTop,
        seismoBot: viewH,
      };
    };

    const stratumAt = (y: number): Stratum | null => {
      const z = zones();
      if (y < z.strataTop || y > z.strataBot) return null;
      const t = (y - z.strataTop) / (z.strataBot - z.strataTop);
      return STRATA.find((stratum) => t >= stratum.top && t <= stratum.bottom) ?? null;
    };

    const drawStaticFossil = (x: number, y: number, r: number, alpha: number) => {
      drawFossil(bgCtx, x, y, r, "#fff0c8", alpha, -0.2);
    };

    const renderBackground = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      bg.width = Math.floor(viewW * dpr);
      bg.height = Math.floor(viewH * dpr);
      bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const z = zones();

      bgCtx.fillStyle = "#050606";
      bgCtx.fillRect(0, 0, viewW, viewH);

      const skyG = bgCtx.createLinearGradient(0, z.skyTop, 0, z.skyBot);
      skyG.addColorStop(0, "#050606");
      skyG.addColorStop(0.42, "#101411");
      skyG.addColorStop(1, "#3d2d1c");
      bgCtx.fillStyle = skyG;
      bgCtx.fillRect(0, z.skyTop, viewW, z.skyBot - z.skyTop);

      const skyGlow = bgCtx.createRadialGradient(viewW * 0.72, z.skyBot * 0.76, 0, viewW * 0.72, z.skyBot * 0.76, viewW * 0.56);
      skyGlow.addColorStop(0, "rgba(215, 172, 96, 0.30)");
      skyGlow.addColorStop(1, "rgba(215, 172, 96, 0)");
      bgCtx.fillStyle = skyGlow;
      bgCtx.fillRect(0, z.skyTop, viewW, z.skyBot - z.skyTop);

      const capG = bgCtx.createLinearGradient(0, z.surfaceTop, 0, z.surfaceBot);
      capG.addColorStop(0, "#6c5739");
      capG.addColorStop(0.38, "#33261c");
      capG.addColorStop(1, "#11100e");
      bgCtx.fillStyle = capG;
      bgCtx.fillRect(0, z.surfaceTop, viewW, z.surfaceBot - z.surfaceTop);

      bgCtx.strokeStyle = "rgba(248, 214, 137, 0.36)";
      bgCtx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const y = mix(z.surfaceTop + 4, z.surfaceBot - 5, i / 4);
        drawWarpedLine(bgCtx, viewW, y, 1.2 + i * 0.4, i * 1.17);
        bgCtx.stroke();
      }

      for (let i = 0; i < STRATA.length; i++) {
        const stratum = STRATA[i];
        const { y0, y1 } = stratumBounds(stratum, z);
        const layerG = bgCtx.createLinearGradient(0, y0, viewW, y1);
        layerG.addColorStop(0, stratum.colorTop);
        layerG.addColorStop(0.58, stratum.colorBottom);
        layerG.addColorStop(1, stratum.colorTop);
        bgCtx.fillStyle = layerG;
        bgCtx.fillRect(0, y0 - 1, viewW, y1 - y0 + 2);

        const bandH = y1 - y0;
        const laminae = Math.max(4, Math.round(bandH / 17));
        for (let k = 0; k < laminae; k++) {
          const t = (k + 0.5) / laminae;
          const yy = mix(y0, y1, t);
          const warm = (k + i) % 3 === 0;
          bgCtx.strokeStyle = warm ? colorAlpha(stratum.accent, 0.13) : "rgba(255, 246, 220, 0.055)";
          bgCtx.lineWidth = warm ? 1.1 : 0.75;
          drawWarpedLine(bgCtx, viewW, yy, 1.6 + i * 0.35, i * 2.21 + k * 0.7);
          bgCtx.stroke();
        }

        const flecks = Math.max(18, Math.round((viewW * bandH) / 7800));
        for (let k = 0; k < flecks; k++) {
          const a = hash(i * 101 + k * 13.7);
          const b = hash(i * 233 + k * 19.3);
          const x = a * viewW;
          const y = mix(y0 + 4, y1 - 4, b);
          const r = 0.55 + hash(k * 4.1 + i) * 1.3;
          bgCtx.fillStyle = colorAlpha(k % 4 === 0 ? stratum.accent : "#fff3d5", 0.10 + hash(k + i) * 0.16);
          bgCtx.beginPath();
          bgCtx.ellipse(x, y, r * 1.8, r * 0.56, hash(k) * Math.PI, 0, Math.PI * 2);
          bgCtx.fill();
        }

        if (stratum.id === "limestone") {
          for (let k = 0; k < 5; k++) {
            drawStaticFossil(viewW * (0.15 + k * 0.17), mix(y0, y1, 0.35 + hash(k) * 0.35), 8 + hash(k + 7) * 7, 0.14);
          }
        }

        if (i > 0) {
          bgCtx.strokeStyle = "rgba(4, 5, 5, 0.58)";
          bgCtx.lineWidth = 1;
          drawWarpedLine(bgCtx, viewW, y0, 1.8, i * 1.93);
          bgCtx.stroke();
          bgCtx.strokeStyle = colorAlpha(stratum.accent, 0.12);
          bgCtx.lineWidth = 0.7;
          drawWarpedLine(bgCtx, viewW, y0 + 1.4, 1.2, i * 1.93 + 0.7);
          bgCtx.stroke();
        }
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
        bgCtx.moveTo(viewW * p.x, z.strataTop);
        bgCtx.lineTo(viewW * (p.x + p.lean), z.strataBot);
        bgCtx.stroke();
      }

      const mineralLens = bgCtx.createRadialGradient(viewW * 0.28, z.strataTop + (z.strataBot - z.strataTop) * 0.54, 0, viewW * 0.28, z.strataTop + (z.strataBot - z.strataTop) * 0.54, viewW * 0.52);
      mineralLens.addColorStop(0, "rgba(255, 238, 195, 0.12)");
      mineralLens.addColorStop(0.5, "rgba(127, 248, 213, 0.045)");
      mineralLens.addColorStop(1, "rgba(0, 0, 0, 0)");
      bgCtx.fillStyle = mineralLens;
      bgCtx.fillRect(0, z.strataTop, viewW, z.strataBot - z.strataTop);

      const seismoG = bgCtx.createLinearGradient(0, z.seismoTop, 0, z.seismoBot);
      seismoG.addColorStop(0, "#121514");
      seismoG.addColorStop(1, "#050606");
      bgCtx.fillStyle = seismoG;
      bgCtx.fillRect(0, z.seismoTop, viewW, z.seismoBot - z.seismoTop);

      bgCtx.strokeStyle = "rgba(232, 226, 213, 0.16)";
      bgCtx.lineWidth = 1;
      bgCtx.beginPath();
      bgCtx.moveTo(0, z.seismoTop + 0.5);
      bgCtx.lineTo(viewW, z.seismoTop + 0.5);
      bgCtx.stroke();

      const seismoH = z.seismoBot - z.seismoTop;
      bgCtx.strokeStyle = "rgba(232, 226, 213, 0.07)";
      bgCtx.lineWidth = 1;
      for (let i = 1; i < 5; i++) {
        const y = z.seismoTop + seismoH * (i / 5);
        bgCtx.beginPath();
        bgCtx.moveTo(0, y);
        bgCtx.lineTo(viewW, y);
        bgCtx.stroke();
      }
      for (let i = 1; i < 13; i++) {
        const x = viewW * (i / 13);
        bgCtx.beginPath();
        bgCtx.moveTo(x, z.seismoTop);
        bgCtx.lineTo(x, z.seismoBot);
        bgCtx.stroke();
      }
      bgCtx.strokeStyle = "rgba(248, 214, 137, 0.18)";
      bgCtx.beginPath();
      bgCtx.moveTo(0, z.seismoTop + seismoH * 0.5);
      bgCtx.lineTo(viewW, z.seismoTop + seismoH * 0.5);
      bgCtx.stroke();
    };

    const resize = () => {
      viewW = wrap.clientWidth || 1;
      viewH = wrap.clientHeight || 1;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      fg.width = Math.floor(viewW * dpr);
      fg.height = Math.floor(viewH * dpr);
      fgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderBackground();
    };

    const localXY = (event: PointerEvent) => {
      const rect = fg.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const scheduleClearActive = (id: string) => {
      const timer = window.setTimeout(() => {
        clearTimers.delete(timer);
        if (activeStratumRef.current?.id === id) {
          activeStratumRef.current = null;
          setActiveStratumId(null);
        }
      }, 3200);
      clearTimers.add(timer);
    };

    const addMineralMark = (mark: Omit<MineralMark, "born">) => {
      mineralMarksRef.current.push({ ...mark, born: performance.now() });
      if (mineralMarksRef.current.length > 90) {
        mineralMarksRef.current.splice(0, mineralMarksRef.current.length - 90);
      }
    };

    const seedMineral = (x: number, y: number, stratum: Stratum, scale = 1) => {
      const now = performance.now();
      activeStratumRef.current = { id: stratum.id, t0: now };
      setActiveStratumId(stratum.id);
      scheduleClearActive(stratum.id);
      const count = stratum.mineral === "fossil" ? 2 : stratum.mineral === "vein" ? 3 : 5;
      for (let i = 0; i < count; i++) {
        const r = 8 + hash(now * 0.01 + i * 17) * 16;
        addMineralMark({
          x: x + (hash(i * 13 + now) - 0.5) * 52 * scale,
          y: y + (hash(i * 29 + now) - 0.5) * 38 * scale,
          life: 3.5 + hash(i * 41 + now) * 3.8,
          size: r * scale,
          hue: stratum.accent,
          kind: i === 0 ? stratum.mineral : (hash(i + now) > 0.72 ? "glint" : stratum.mineral),
          angle: (hash(i * 7.1 + now) - 0.5) * Math.PI,
          phase: hash(i * 31.1 + now) * Math.PI * 2,
        });
      }
      clickSpikesRef.current.push({ t0: now, strength: 0.55 + scale * 0.18 });
      pressureRef.current.target = Math.min(1, pressureRef.current.target + 0.14 * scale);
      try {
        getFieldAudio().chime();
        getFieldAudio().playNote(48 + STRATA.findIndex((s) => s.id === stratum.id) * 3, 130);
      } catch { /* noop */ }
      haptics.ripple(0.42 + scale * 0.16);
      markEarth(stratum.name, stratum.accent);
      useField.getState().recordTape("region", 0.46 + scale * 0.14, `earth/${stratum.id}`);
    };

    const addFault = (x0: number, y0: number, x1: number, y1: number, strength = 1, hue = "#fff0c8") => {
      faultsRef.current.push({ x0, y0, x1, y1, born: performance.now(), strength, hue });
      if (faultsRef.current.length > 42) {
        faultsRef.current.splice(0, faultsRef.current.length - 42);
      }
    };

    const addFracture = (x: number, y: number, strength = 1, hue = "#f0b66d") => {
      const now = performance.now();
      for (let i = 0; i < 3; i++) {
        fracturesRef.current.push({
          x: x + (hash(now + i) - 0.5) * 28,
          y: y + (hash(now + i * 2) - 0.5) * 22,
          born: now,
          angle: -Math.PI * 0.5 + (hash(now * 0.2 + i) - 0.5) * 1.4,
          length: (34 + hash(i * 9 + now) * 86) * strength,
          branches: 2 + Math.floor(hash(i * 11 + now) * 4),
          hue,
        });
      }
      if (fracturesRef.current.length > 28) {
        fracturesRef.current.splice(0, fracturesRef.current.length - 28);
      }
    };

    const quakeAt = (x: number, y: number, strength = 1) => {
      const now = performance.now();
      quakeSpikeRef.current = { t0: now, strength };
      clickSpikesRef.current.push({ t0: now, strength: 1.3 * strength });
      addFracture(x || viewW * 0.5, y || zones().seismoTop, strength, "#f06f3f");
      for (let i = 0; i < 5; i++) {
        addFault(
          mix(0, viewW, hash(now + i * 3)),
          mix(zones().strataTop, zones().strataBot, hash(now + i * 5)),
          mix(0, viewW, hash(now + i * 7)),
          mix(zones().strataTop, zones().strataBot, hash(now + i * 11)),
          strength * 0.65,
          "#f06f3f",
        );
      }
      pressureRef.current.target = 1;
      try {
        getFieldAudio().thud();
        window.setTimeout(() => getFieldAudio().bell(), 120);
      } catch { /* noop */ }
      haptics.storm();
      markEarth("quake", "#f06f3f");
      useField.getState().recordTape("ripple", 1, "earth/quake");
    };

    const compressAt = (x: number, y: number, strength = 1) => {
      const stratum = stratumAt(y) ?? STRATA[Math.floor(STRATA.length * 0.64)];
      const hue = stratum.accent;
      bloomsRef.current.push({
        x,
        y,
        born: performance.now(),
        strength,
        hue,
        radius: 74 + strength * 84,
      });
      if (bloomsRef.current.length > 18) bloomsRef.current.shift();
      seedMineral(x, y, stratum, 1.15);
      addFault(x - 80, y - 24, x + 84, y + 34, 0.78 * strength, hue);
      addFracture(x, y, 0.52 * strength, hue);
      pressureRef.current.target = 1;
      clickSpikesRef.current.push({ t0: performance.now(), strength: 0.86 * strength });
      try {
        getFieldAudio().thud();
        window.setTimeout(() => getFieldAudio().spark(), 90);
      } catch { /* noop */ }
      haptics.chop();
      markEarth("metamorphic glow", hue);
      useField.getState().recordTape("sigil", 0.82, "earth/metamorphic-pressure");
    };

    const erodeAt = (x: number, y: number, scale = 1) => {
      const z = zones();
      const yy = clamp(y, z.skyBot, z.strataTop + 12);
      for (let i = 0; i < 7; i++) {
        addMineralMark({
          x: x + (hash(performance.now() + i * 17) - 0.5) * 90,
          y: yy + i * 5 + hash(i * 3) * 18,
          life: 2.8 + hash(i * 13) * 2.2,
          size: (9 + hash(i * 19) * 16) * scale,
          hue: "#d49b55",
          kind: "sediment",
          angle: 0,
          phase: hash(i * 23) * Math.PI * 2,
        });
      }
      clickSpikesRef.current.push({ t0: performance.now(), strength: 0.34 * scale });
      try { getFieldAudio().spark(); } catch { /* noop */ }
      haptics.ripple(0.34);
      markEarth("erosion", "#d49b55");
      useField.getState().recordTape("object", 0.34, "earth/erosion");
    };

    const tapAt = (x: number, y: number) => {
      const z = zones();
      if (y >= z.seismoTop) {
        quakeAt(x, y, 0.92);
        return;
      }
      const stratum = stratumAt(y);
      if (stratum) {
        seedMineral(x, y, stratum);
        return;
      }
      erodeAt(x, y);
    };

    const hoverStratumRef = { current: null as string | null };

    const updateCursor = (x: number, y: number) => {
      const now = performance.now();
      const c = cursorRef.current;
      if (c.lastT > 0) {
        const dt = Math.max(1, now - c.lastT);
        c.vel = c.vel * 0.78 + (Math.hypot(x - c.x, y - c.y) / dt) * 0.22;
      }
      c.x = x;
      c.y = y;
      c.lastT = now;
      c.over = true;

      const next = stratumAt(y)?.id ?? null;
      if (next !== hoverStratumRef.current) {
        hoverStratumRef.current = next;
        setHoverStratum(next);
      }
    };

    const clearPressTimer = () => {
      const drag = dragRef.current;
      if (drag.pressTimer !== null) {
        window.clearTimeout(drag.pressTimer);
        drag.pressTimer = null;
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      const { x, y } = localXY(event);
      const z = zones();
      const zone: DragState["zone"] = y >= z.seismoTop ? "seismo" : stratumAt(y) ? "strata" : "surface";
      updateCursor(x, y);
      clearPressTimer();
      const now = performance.now();
      const timer = window.setTimeout(() => {
        const drag = dragRef.current;
        if (!drag.active || drag.pointerId !== event.pointerId || drag.moved > 12) return;
        drag.long = true;
        if (drag.zone === "seismo") quakeAt(drag.x, drag.y, 1.1);
        else compressAt(drag.x, drag.y, 1.05);
      }, 540);
      dragRef.current = {
        active: true,
        pointerId: event.pointerId,
        startX: x,
        startY: y,
        x,
        y,
        moved: 0,
        downT: now,
        long: false,
        zone,
        pressTimer: timer,
        lastFault: 0,
        lastHaptic: 0,
      };
      pressureRef.current.target = Math.max(pressureRef.current.target, 0.18);
      try { fg.setPointerCapture(event.pointerId); } catch { /* noop */ }
    };

    const onPointerMove = (event: PointerEvent) => {
      const { x, y } = localXY(event);
      updateCursor(x, y);
      const drag = dragRef.current;
      if (!drag.active || drag.pointerId !== event.pointerId) return;

      const now = performance.now();
      const dx = x - drag.x;
      const dy = y - drag.y;
      drag.x = x;
      drag.y = y;
      drag.moved += Math.hypot(dx, dy);
      if (drag.moved > 14) clearPressTimer();

      if (drag.zone === "strata") {
        const totalDx = x - drag.startX;
        const totalDy = y - drag.startY;
        const movement = Math.hypot(totalDx, totalDy);
        shearRef.current.target = clamp((totalDx * 0.75 + totalDy * 0.38) / 180, -1, 1);
        pressureRef.current.target = clamp(0.2 + movement / 240, 0, 1);
        if (movement > 18 && now - drag.lastFault > 78) {
          const stratum = stratumAt(y) ?? stratumAt(drag.startY) ?? STRATA[2];
          const side = totalDx >= 0 ? 1 : -1;
          addFault(
            drag.startX - side * 20 + (hash(now) - 0.5) * 22,
            drag.startY + (hash(now + 5) - 0.5) * 18,
            x + side * 32,
            y + (hash(now + 9) - 0.5) * 22,
            clamp(movement / 130, 0.25, 1),
            stratum.accent,
          );
          if (now - drag.lastHaptic > 170) {
            try { getFieldAudio().playNote(38 + Math.round(Math.abs(shearRef.current.target) * 18), 45); } catch { /* noop */ }
            haptics.tap();
            drag.lastHaptic = now;
          }
          drag.lastFault = now;
        }
      } else if (drag.zone === "surface" && drag.moved > 24 && now - drag.lastFault > 120) {
        erodeAt(x, y, 0.62);
        drag.lastFault = now;
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag.active || drag.pointerId !== event.pointerId) return;
      clearPressTimer();
      try { fg.releasePointerCapture(event.pointerId); } catch { /* noop */ }
      if (!drag.long && drag.moved < 11) {
        tapAt(drag.x, drag.y);
      } else if (!drag.long && drag.zone === "strata" && drag.moved >= 18) {
        const s = stratumAt(drag.y) ?? stratumAt(drag.startY);
        const strength = clamp(drag.moved / 180, 0.2, 0.92);
        addFault(drag.startX, drag.startY, drag.x, drag.y, strength, s?.accent ?? "#fff0c8");
        clickSpikesRef.current.push({ t0: performance.now(), strength: 0.44 + strength * 0.42 });
        haptics.chop();
        markEarth("fault slip", s?.accent ?? "#fff0c8");
        useField.getState().recordTape("region", strength, "earth/fault-slip");
      }
      dragRef.current = {
        active: false,
        pointerId: null,
        startX: 0,
        startY: 0,
        x: 0,
        y: 0,
        moved: 0,
        downT: 0,
        long: false,
        zone: "surface",
        pressTimer: null,
        lastFault: 0,
        lastHaptic: 0,
      };
      shearRef.current.target = 0;
      pressureRef.current.target = 0;
    };

    const onPointerLeave = () => {
      cursorRef.current.over = false;
      if (hoverStratumRef.current !== null) {
        hoverStratumRef.current = null;
        setHoverStratum(null);
      }
    };

    const drawPressureBloom = (bloom: PressureBloom, now: number) => {
      const age = (now - bloom.born) / 1000;
      const life = 2.6;
      if (age > life) return false;
      const t = age / life;
      const alpha = (1 - t) * bloom.strength;
      const radius = bloom.radius * (0.55 + t * 0.78);
      const glow = fgCtx.createRadialGradient(bloom.x, bloom.y, 0, bloom.x, bloom.y, radius);
      glow.addColorStop(0, colorAlpha(bloom.hue, alpha * 0.36));
      glow.addColorStop(0.33, colorAlpha("#fff0c8", alpha * 0.16));
      glow.addColorStop(1, colorAlpha(bloom.hue, 0));
      fgCtx.fillStyle = glow;
      fgCtx.beginPath();
      fgCtx.arc(bloom.x, bloom.y, radius, 0, Math.PI * 2);
      fgCtx.fill();

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

    const drawFaultTrace = (fault: FaultTrace, now: number) => {
      const age = (now - fault.born) / 1000;
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
      fgCtx.shadowColor = colorAlpha(fault.hue, alpha * 0.44);
      fgCtx.shadowBlur = 14 * alpha;
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

    const drawFracture = (fracture: Fracture, now: number) => {
      const age = (now - fracture.born) / 1000;
      const life = 3.8;
      if (age > life) return false;
      const alpha = Math.max(0, 1 - age / life);
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
      fgCtx.save();
      fgCtx.strokeStyle = colorAlpha(fracture.hue, alpha * 0.72);
      fgCtx.lineWidth = 1.1;
      fgCtx.lineCap = "round";
      fgCtx.shadowColor = colorAlpha(fracture.hue, alpha * 0.5);
      fgCtx.shadowBlur = 8 * alpha;
      drawBranch(fracture.x, fracture.y, fracture.angle, fracture.length * (0.4 + (1 - alpha) * 0.6), fracture.branches);
      fgCtx.restore();
      return true;
    };

    const drawMineral = (mark: MineralMark, now: number) => {
      const age = (now - mark.born) / 1000;
      if (age > mark.life) return false;
      const t = age / mark.life;
      const alpha = Math.sin(Math.PI * clamp(t, 0, 1)) * 0.82;
      const shimmer = 0.78 + Math.sin(now * 0.004 + mark.phase) * 0.22;
      const radius = mark.size * (0.72 + t * 0.18);
      if (mark.kind === "glint") drawGlint(fgCtx, mark.x, mark.y, radius, mark.hue, alpha * shimmer, mark.angle + age * 0.4);
      else if (mark.kind === "fossil") drawFossil(fgCtx, mark.x, mark.y, radius, mark.hue, alpha * 0.78, mark.angle);
      else if (mark.kind === "crystal") drawCrystal(fgCtx, mark.x, mark.y, radius, mark.hue, alpha * shimmer, mark.angle);
      else if (mark.kind === "vein") drawVein(fgCtx, mark.x, mark.y, radius, mark.hue, alpha * shimmer, mark.angle, mark.phase + age);
      else drawSediment(fgCtx, mark.x, mark.y, radius, mark.hue, alpha);
      return true;
    };

    const draw = (now: number) => {
      const z = zones();
      fgCtx.clearRect(0, 0, viewW, viewH);

      shearRef.current.current += (shearRef.current.target - shearRef.current.current) * 0.09;
      pressureRef.current.current += (pressureRef.current.target - pressureRef.current.current) * 0.08;
      pressureRef.current.target *= 0.965;

      const shear = shearRef.current.current;
      if (Math.abs(shear) > 0.006) {
        const alpha = Math.min(0.22, Math.abs(shear) * 0.18);
        fgCtx.save();
        fgCtx.globalAlpha = alpha;
        fgCtx.fillStyle = shear > 0 ? "#bff8e1" : "#f0b66d";
        const offset = shear * 34;
        for (let i = 0; i < STRATA.length; i++) {
          const { y0, y1 } = stratumBounds(STRATA[i], z);
          fgCtx.beginPath();
          fgCtx.moveTo(offset * (i % 2 ? -1 : 1), y0);
          fgCtx.lineTo(viewW + offset * (i % 2 ? -1 : 1), y0 + 4);
          fgCtx.lineTo(viewW, y1);
          fgCtx.lineTo(0, y1 - 4);
          fgCtx.closePath();
          fgCtx.fill();
        }
        fgCtx.restore();
      }

      if (activeStratumRef.current) {
        const age = (now - activeStratumRef.current.t0) / 1000;
        if (age > 3.2) {
          activeStratumRef.current = null;
        } else {
          const stratum = STRATA.find((item) => item.id === activeStratumRef.current?.id);
          if (stratum) {
            const { y0, y1 } = stratumBounds(stratum, z);
            const alpha = (1 - age / 3.2) * (0.28 + pressureRef.current.current * 0.18);
            const glow = fgCtx.createLinearGradient(0, y0, viewW, y1);
            glow.addColorStop(0, colorAlpha(stratum.accent, alpha * 0.58));
            glow.addColorStop(0.5, "rgba(255, 244, 214, 0.10)");
            glow.addColorStop(1, colorAlpha(stratum.accent, alpha * 0.28));
            fgCtx.fillStyle = glow;
            fgCtx.fillRect(0, y0, viewW, y1 - y0);
            fgCtx.strokeStyle = colorAlpha(stratum.accent, alpha + 0.14);
            fgCtx.lineWidth = 1.2;
            drawWarpedLine(fgCtx, viewW, y0 + 1, 1.8, age);
            fgCtx.stroke();
            drawWarpedLine(fgCtx, viewW, y1 - 1, 1.8, age + 1.2);
            fgCtx.stroke();
          }
        }
      }

      for (let i = bloomsRef.current.length - 1; i >= 0; i--) {
        if (!drawPressureBloom(bloomsRef.current[i], now)) bloomsRef.current.splice(i, 1);
      }
      for (let i = faultsRef.current.length - 1; i >= 0; i--) {
        if (!drawFaultTrace(faultsRef.current[i], now)) faultsRef.current.splice(i, 1);
      }
      for (let i = fracturesRef.current.length - 1; i >= 0; i--) {
        if (!drawFracture(fracturesRef.current[i], now)) fracturesRef.current.splice(i, 1);
      }
      for (let i = mineralMarksRef.current.length - 1; i >= 0; i--) {
        if (!drawMineral(mineralMarksRef.current[i], now)) mineralMarksRef.current.splice(i, 1);
      }

      if (!reduce) {
        for (let i = 0; i < 3; i++) {
          const t = (now * 0.00003 + i * 0.31) % 1;
          const y = mix(z.strataTop, z.strataBot, t);
          const x = (hash(i * 127 + Math.floor(now / 6000)) * 0.8 + 0.1) * viewW;
          drawGlint(fgCtx, x, y, 3.5 + i, STRATA[(i + 2) % STRATA.length].accent, 0.09, now * 0.0004 + i);
        }
      }

      const cur = cursorRef.current;
      cur.vel *= 0.92;
      let spike = 0;
      for (let i = clickSpikesRef.current.length - 1; i >= 0; i--) {
        const s = clickSpikesRef.current[i];
        const age = (now - s.t0) / 1000;
        if (age > 1.7) {
          clickSpikesRef.current.splice(i, 1);
          continue;
        }
        spike += s.strength * Math.exp(-age * 2.8);
      }
      let quakeMag = 0;
      if (quakeSpikeRef.current) {
        const age = (now - quakeSpikeRef.current.t0) / 1000;
        if (age > 2.8) {
          quakeSpikeRef.current = null;
        } else {
          quakeMag = quakeSpikeRef.current.strength * Math.exp(-age * 1.35) * Math.cos(age * 30);
        }
      }
      const noise = (Math.random() - 0.5) * 0.045;
      const magnitude = clamp(cur.vel * 0.9, 0, 1.7) + spike + quakeMag + pressureRef.current.current * 0.32 + Math.abs(shear) * 0.28 + noise;

      const buf = seismoBufRef.current;
      const head = seismoHeadRef.current;
      buf[head] = magnitude;
      if (!reduce) seismoHeadRef.current = (head + 1) % SEISMO_SAMPLES;

      const seismoH = z.seismoBot - z.seismoTop;
      const baseY = z.seismoTop + seismoH * 0.5;
      const ampPx = seismoH * 0.37;
      const oldest = seismoHeadRef.current;
      fgCtx.save();
      fgCtx.lineCap = "round";
      fgCtx.shadowColor = "rgba(248, 214, 137, 0.34)";
      fgCtx.shadowBlur = 10;
      fgCtx.strokeStyle = "#f2dfb5";
      fgCtx.lineWidth = 1.35;
      fgCtx.beginPath();
      for (let i = 0; i < SEISMO_SAMPLES; i++) {
        const idx = (oldest + i) % SEISMO_SAMPLES;
        const v = clamp(buf[idx], -2.4, 2.4);
        const x = (i / (SEISMO_SAMPLES - 1)) * viewW;
        const y = baseY - v * (ampPx / 2.4);
        if (i === 0) fgCtx.moveTo(x, y);
        else fgCtx.lineTo(x, y);
      }
      fgCtx.stroke();
      fgCtx.restore();

      if (now - lastReadoutMs > 110) {
        lastReadoutMs = now;
        setReadouts({
          magnitude: Math.min(9, Math.abs(magnitude) * 4.4).toFixed(1),
          pressure: pressureRef.current.current.toFixed(2),
          slip: Math.round(shear * 100).toString(),
        });
      }

      raf = requestAnimationFrame(draw);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    fg.addEventListener("pointerdown", onPointerDown);
    fg.addEventListener("pointermove", onPointerMove);
    fg.addEventListener("pointerup", onPointerUp);
    fg.addEventListener("pointercancel", onPointerUp);
    fg.addEventListener("pointerleave", onPointerLeave);

    actionRef.current = {
      activateStratum: (id: string) => {
        const stratum = STRATA.find((item) => item.id === id);
        if (!stratum) return;
        const z = zones();
        const { y0, y1 } = stratumBounds(stratum, z);
        const x = viewW * (0.34 + hash(id.length * 27) * 0.34);
        seedMineral(x, mix(y0, y1, 0.52), stratum, 1.05);
      },
      quake: () => quakeAt(viewW * 0.5, zones().seismoTop + (zones().seismoBot - zones().seismoTop) * 0.5, 1),
      compress: () => compressAt(viewW * 0.5, zones().strataTop + (zones().strataBot - zones().strataTop) * 0.56, 1),
    };
    (window as unknown as Record<string, unknown>).__earth = { ready: true, ...actionRef.current };

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      clearPressTimer();
      for (const timer of clearTimers) window.clearTimeout(timer);
      fg.removeEventListener("pointerdown", onPointerDown);
      fg.removeEventListener("pointermove", onPointerMove);
      fg.removeEventListener("pointerup", onPointerUp);
      fg.removeEventListener("pointercancel", onPointerUp);
      fg.removeEventListener("pointerleave", onPointerLeave);
      actionRef.current = null;
      delete (window as unknown as { __earth?: unknown }).__earth;
    };
  }, [markEarth]);

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

      <div className="earth-gesture" aria-hidden="true">tap a layer · drag a fault · hold to compress</div>

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
            <button type="button" onClick={quietCore}>quiet core</button>
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
              inset: 0;
              width: 100%;
              height: 100%;
              display: block;
            }

            .earth-canvas--touch {
              touch-action: none;
              cursor: crosshair;
              z-index: 1;
            }

            .earth-controls {
              display: contents;
            }

            .earth-gesture,
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

            @media (max-width: 720px) {
              .earth-gesture {
                position: fixed;
                z-index: 4;
                right: 16px;
                bottom: calc(122px + env(safe-area-inset-bottom, 0px));
                left: 16px;
                display: block;
                color: rgba(246, 240, 224, 0.58);
                font-family: var(--font-mono, ui-monospace, monospace);
                font-size: 9px;
                letter-spacing: 0.06em;
                text-align: center;
                text-shadow: 0 2px 14px rgba(0, 0, 0, 0.92);
                text-transform: lowercase;
                pointer-events: none;
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
                grid-template-columns: repeat(3, minmax(0, 1fr));
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
          `,
        }}
      />
    </div>
  );
}
