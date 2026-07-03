"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { useField } from "@/store/field";

type Palette = {
  id: string;
  dark: string;
  ground: string;
  shade: string;
  glow: string;
  pollen: string;
  leaf: string;
  vein: string;
  petalHues: number[];
};

type FieldSeed = {
  id: number;
  x: number;
  y: number;
  size: number;
  spin: number;
  phase: number;
  petals: number;
  hueShift: number;
};

type BloomMemory = {
  id: number;
  x: number;
  y: number;
  born: number;
  life: number;
  strength: number;
  radius: number;
  spin: number;
  petals: number;
  hueShift: number;
};

type Pollen = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  radius: number;
  hue: number;
  orbit: number;
};

type GestureState = {
  active: boolean;
  pointerId: number | null;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  moved: number;
  lastBloom: number;
};

const PALETTES: Palette[] = [
  {
    id: "orchard",
    dark: "#06100d",
    ground: "#123020",
    shade: "#183b2f",
    glow: "#f2c45d",
    pollen: "#ffd768",
    leaf: "#8fd36f",
    vein: "#6fd4c2",
    petalHues: [326, 31, 51, 165],
  },
  {
    id: "iris",
    dark: "#070b18",
    ground: "#151f3a",
    shade: "#31204b",
    glow: "#85d8ff",
    pollen: "#ffdf76",
    leaf: "#70d2a9",
    vein: "#a08dff",
    petalHues: [258, 292, 202, 44],
  },
  {
    id: "poppy",
    dark: "#15090a",
    ground: "#341816",
    shade: "#4a2320",
    glow: "#ff8b47",
    pollen: "#ffe16c",
    leaf: "#8fbd62",
    vein: "#ffb065",
    petalHues: [354, 18, 43, 144],
  },
  {
    id: "moon",
    dark: "#071015",
    ground: "#142733",
    shade: "#183b3d",
    glow: "#d3f2ff",
    pollen: "#f4d98b",
    leaf: "#9bd7b7",
    vein: "#7ccedb",
    petalHues: [196, 166, 48, 286],
  },
];

const SYMMETRY_STEPS = [5, 6, 8, 10, 12];
const WIND_STEPS = [0.12, 0.36, 0.62, 0.9];
const FIELD_SEED_COUNT = 30;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const MAX_MEMORIES = 44;
const MAX_POLLEN = 260;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

function hash(value: number) {
  const x = Math.sin(value * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

function colorAlpha(hex: string, alpha: number) {
  const clean = hex.replace("#", "");
  const value = parseInt(clean.length === 3
    ? clean.split("").map((ch) => ch + ch).join("")
    : clean, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const FIELD_SEEDS: FieldSeed[] = Array.from({ length: FIELD_SEED_COUNT }, (_, index) => {
  const ring = Math.floor(index / 9);
  const radius = 0.07 + Math.pow(hash(index + 19), 0.72) * 0.48;
  const angle = index * GOLDEN_ANGLE + hash(index + 3) * 0.42;
  return {
    id: index,
    x: 0.5 + Math.cos(angle) * radius * 0.96,
    y: 0.52 + Math.sin(angle) * radius * 0.72,
    size: 10 + hash(index + 41) * 28 + ring * 1.6,
    spin: angle + hash(index + 7) * Math.PI,
    phase: hash(index + 11) * Math.PI * 2,
    petals: 5 + Math.floor(hash(index + 29) * 6),
    hueShift: hash(index + 37) * 54,
  };
});

function drawPetal(ctx: CanvasRenderingContext2D, length: number, width: number) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(width, -length * 0.25, width * 0.58, -length * 0.86, 0, -length);
  ctx.bezierCurveTo(-width * 0.58, -length * 0.86, -width, -length * 0.25, 0, 0);
  ctx.closePath();
  ctx.fill();
}

function drawLeaf(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, angle: number, palette: Palette, alpha: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = colorAlpha(palette.leaf, alpha);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(radius * 0.7, -radius * 0.3, radius * 0.78, -radius * 1.15, 0, -radius * 1.48);
  ctx.bezierCurveTo(-radius * 0.72, -radius * 1.15, -radius * 0.68, -radius * 0.3, 0, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = colorAlpha(palette.vein, alpha * 0.55);
  ctx.lineWidth = Math.max(0.5, radius * 0.04);
  ctx.beginPath();
  ctx.moveTo(0, -radius * 0.08);
  ctx.lineTo(0, -radius * 1.22);
  ctx.stroke();
  ctx.restore();
}

function drawRosette(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  petals: number,
  palette: Palette,
  hueShift: number,
  rotation: number,
  alpha: number,
  time: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.globalCompositeOperation = "lighter";
  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(0.6, radius * 0.018);

  for (let i = 0; i < petals; i += 1) {
    const angle = (i / petals) * Math.PI * 2;
    const hue = (palette.petalHues[i % palette.petalHues.length] + hueShift + Math.sin(time + i) * 5 + 360) % 360;
    const light = 58 + Math.sin(i * 0.9 + hueShift) * 5;
    ctx.save();
    ctx.rotate(angle);
    ctx.fillStyle = `hsla(${hue}, 82%, ${light}%, ${alpha})`;
    drawPetal(ctx, radius * 1.22, radius * 0.28);
    ctx.strokeStyle = `hsla(${(hue + 24) % 360}, 92%, 78%, ${alpha * 0.22})`;
    ctx.beginPath();
    ctx.moveTo(0, -radius * 0.1);
    ctx.quadraticCurveTo(radius * 0.08, -radius * 0.58, 0, -radius * 1.03);
    ctx.stroke();
    ctx.restore();
  }

  ctx.globalCompositeOperation = "source-over";
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 0.38);
  core.addColorStop(0, colorAlpha(palette.pollen, alpha));
  core.addColorStop(0.56, colorAlpha(palette.glow, alpha * 0.78));
  core.addColorStop(1, "rgba(25, 16, 9, 0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.38, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = `rgba(24, 18, 12, ${alpha * 0.68})`;
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(1.6, radius * 0.11), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBackground(ctx: CanvasRenderingContext2D, width: number, height: number, palette: Palette, time: number) {
  const ground = ctx.createLinearGradient(0, 0, width, height);
  ground.addColorStop(0, palette.dark);
  ground.addColorStop(0.44, palette.ground);
  ground.addColorStop(1, palette.shade);
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(width * 0.5, height * 0.44, 12, width * 0.5, height * 0.52, Math.max(width, height) * 0.62);
  glow.addColorStop(0, colorAlpha(palette.glow, 0.19));
  glow.addColorStop(0.42, colorAlpha(palette.vein, 0.08));
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 96; i += 1) {
    const px = hash(i + 401) * width;
    const py = hash(i + 809) * height;
    const twinkle = 0.14 + Math.sin(time * 0.6 + i) * 0.05;
    ctx.fillStyle = colorAlpha(i % 3 === 0 ? palette.pollen : palette.vein, twinkle);
    ctx.beginPath();
    ctx.arc(px, py, 0.45 + hash(i + 601) * 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawTendrils(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  palette: Palette,
  symmetry: number,
  wind: number,
  time: number,
) {
  const cx = width * 0.5;
  const cy = height * 0.52;
  const maxR = Math.hypot(width, height) * 0.58;
  ctx.save();
  ctx.lineCap = "round";
  for (let i = 0; i < symmetry; i += 1) {
    const base = (i / symmetry) * Math.PI * 2;
    const pulse = Math.sin(time * 0.42 + i * 0.73) * wind * 0.18;
    ctx.beginPath();
    for (let step = 0; step <= 52; step += 1) {
      const t = step / 52;
      const curve = Math.sin(t * Math.PI * 3 + time * 0.56 + i) * 0.1 * wind;
      const angle = base + pulse + curve;
      const r = maxR * t;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r * 0.78;
      if (step === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = colorAlpha(i % 2 ? palette.leaf : palette.vein, 0.06 + wind * 0.06);
    ctx.lineWidth = 0.7 + (i % 4) * 0.18;
    ctx.stroke();
  }
  ctx.restore();
}

function drawWind(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  palette: Palette,
  wind: number,
  time: number,
) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.lineCap = "round";
  for (let ribbon = 0; ribbon < 5; ribbon += 1) {
    const yBase = height * (0.16 + ribbon * 0.1);
    ctx.beginPath();
    for (let i = 0; i <= 84; i += 1) {
      const t = i / 84;
      const x = t * width;
      const drift = Math.sin(t * Math.PI * 3.4 + time * (0.35 + ribbon * 0.04) + ribbon) * height * 0.035 * wind;
      const y = yBase + drift + Math.sin(t * Math.PI * 8 + ribbon) * 5;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = colorAlpha(ribbon % 2 ? palette.vein : palette.glow, 0.055 + wind * 0.07);
    ctx.lineWidth = 0.8 + ribbon * 0.12;
    ctx.stroke();
  }
  ctx.restore();
}

function drawMandala(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  palette: Palette,
  symmetry: number,
  wind: number,
  time: number,
) {
  const cx = width * 0.5;
  const cy = height * 0.52;
  const base = Math.min(width, height);
  const outer = base * 0.39;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.globalCompositeOperation = "lighter";
  for (let ring = 0; ring < 3; ring += 1) {
    const count = symmetry * (ring + 1);
    const ringR = outer * (0.18 + ring * 0.19);
    const petalLength = base * (0.024 + ring * 0.006);
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2 + time * (0.04 + ring * 0.015) * wind;
      const wobble = Math.sin(time * 0.8 + i * 0.62 + ring) * base * 0.008 * wind;
      const x = Math.cos(angle) * (ringR + wobble);
      const y = Math.sin(angle) * (ringR + wobble) * 0.82;
      const hue = (palette.petalHues[(i + ring) % palette.petalHues.length] + ring * 18 + Math.sin(time + i) * 4) % 360;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle + Math.PI / 2);
      ctx.fillStyle = `hsla(${hue}, 84%, ${62 + ring * 3}%, ${0.18 - ring * 0.02})`;
      drawPetal(ctx, petalLength * (1.8 + ring * 0.22), petalLength * 0.48);
      ctx.restore();
    }
  }
  ctx.restore();

  drawRosette(
    ctx,
    cx,
    cy,
    clamp(base * 0.12, 58, 132),
    symmetry,
    palette,
    0,
    time * 0.1 * wind,
    0.54,
    time,
  );
}

function drawSymmetricBloom(
  ctx: CanvasRenderingContext2D,
  bloom: BloomMemory,
  width: number,
  height: number,
  palette: Palette,
  symmetry: number,
  time: number,
  alphaScale = 1,
) {
  const age = (performance.now() - bloom.born) / bloom.life;
  const t = clamp(age, 0, 1);
  const alpha = (1 - t) * bloom.strength * alphaScale;
  if (alpha <= 0) return;

  const cx = width * 0.5;
  const cy = height * 0.52;
  const vx = bloom.x - cx;
  const vy = bloom.y - cy;
  const open = easeOut(t);
  const radius = bloom.radius * (0.48 + open * 0.72);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < symmetry; i += 1) {
    const a = (i / symmetry) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const x = cx + vx * ca - vy * sa;
    const y = cy + vx * sa + vy * ca;
    const spin = bloom.spin + a + time * 0.12;
    drawRosette(ctx, x, y, radius, bloom.petals, palette, bloom.hueShift + i * 8, spin, alpha * 0.62, time);

    ctx.strokeStyle = colorAlpha(palette.glow, alpha * 0.12);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, radius * (1.4 + open), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function SymmetryIcon() {
  const petals = Array.from({ length: 6 }, (_, index) => {
    const angle = (index / 6) * Math.PI * 2;
    const x = Number((12 + Math.cos(angle) * 5.7).toFixed(2));
    const y = Number((12 + Math.sin(angle) * 5.7).toFixed(2));

    return { angle, x, y };
  });

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="2.8" />
      {petals.map(({ angle, x, y }, index) => (
        <ellipse
          key={index}
          cx={x}
          cy={y}
          rx="2.1"
          ry="4.1"
          transform={`rotate(${Number(((angle * 180) / Math.PI + 90).toFixed(2))} ${x} ${y})`}
        />
      ))}
    </svg>
  );
}

function WindIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 8c4-3 8 3 12 0 2-1.5 4-1.5 6-.3" />
      <path d="M3 13c5-2.5 8 2.5 12 0 2-1.3 4-1.2 6 .2" />
      <path d="M3 18c3.5-2 6 1.5 9 .2 1.4-.6 2.7-.7 4-.2" />
    </svg>
  );
}

function BouquetIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10" cy="8" r="3" />
      <circle cx="15" cy="9" r="2.6" />
      <circle cx="12.8" cy="13" r="3" />
      <path d="M12 15v6" />
      <path d="M12 18c-2.4-2.6-4.8-3.3-7-2.4" />
      <path d="M12 18c2.6-2.7 5-3.4 7.2-2.4" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

export default function FlowersPlayground() {
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef(0);
  const reduceMotionRef = useRef(false);
  const paletteIndexRef = useRef(0);
  const symmetryRef = useRef(8);
  const windRef = useRef(0.36);
  const memoryIdRef = useRef(1);
  const lastAudioAt = useRef(0);
  const lastTapeAt = useRef(0);
  const memoriesRef = useRef<BloomMemory[]>([]);
  const pollenRef = useRef<Pollen[]>([]);
  const gestureRef = useRef<GestureState>({
    active: false,
    pointerId: null,
    x: 0,
    y: 0,
    lastX: 0,
    lastY: 0,
    moved: 0,
    lastBloom: 0,
  });

  const [paletteIndex, setPaletteIndex] = useState(0);
  const [symmetry, setSymmetry] = useState(8);
  const [wind, setWind] = useState(0.36);
  const [bloomCount, setBloomCount] = useState(0);

  useEffect(() => {
    paletteIndexRef.current = paletteIndex;
  }, [paletteIndex]);

  useEffect(() => {
    symmetryRef.current = symmetry;
  }, [symmetry]);

  useEffect(() => {
    windRef.current = wind;
  }, [wind]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduceMotionRef.current = mq.matches;
    const update = () => {
      reduceMotionRef.current = mq.matches;
    };
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    const field = fieldRef.current;
    const canvas = canvasRef.current;
    if (!field || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let last = performance.now();
    let lastFrame = 0;
    let time = 0;

    const resize = () => {
      const rect = field.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      width = Math.max(320, Math.floor(rect.width));
      height = Math.max(520, Math.floor(rect.height));
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const updatePollen = (delta: number, palette: Palette, windNow: number) => {
      const reduce = reduceMotionRef.current;
      const cx = width * 0.5;
      const cy = height * 0.52;
      const next: Pollen[] = [];
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const speck of pollenRef.current) {
        const age = (performance.now() - speck.born) / speck.life;
        if (age >= 1) continue;
        if (!reduce) {
          const dx = speck.x - cx;
          const dy = speck.y - cy;
          const orbit = Math.atan2(dy, dx) + Math.PI / 2;
          speck.vx += Math.cos(orbit) * speck.orbit * delta * 0.00026;
          speck.vy += Math.sin(orbit) * speck.orbit * delta * 0.00026;
          speck.x += (speck.vx + windNow * 16) * delta * 0.001;
          speck.y += speck.vy * delta * 0.001 + Math.sin(time + speck.hue) * 0.05;
        }
        if (speck.x < -40 || speck.x > width + 40 || speck.y < -40 || speck.y > height + 40) continue;
        const alpha = (1 - age) * 0.72;
        ctx.fillStyle = `hsla(${speck.hue}, 88%, 70%, ${alpha})`;
        ctx.beginPath();
        ctx.arc(speck.x, speck.y, speck.radius * (1 + age * 1.8), 0, Math.PI * 2);
        ctx.fill();
        next.push(speck);
      }
      ctx.restore();
      pollenRef.current = next;

      if (!reduce && pollenRef.current.length < 64) {
        for (let i = 0; i < 2; i += 1) {
          const edge = hash(time * 10 + i) > 0.5;
          pollenRef.current.push({
            x: edge ? -12 : width + 12,
            y: hash(time * 30 + i * 7) * height,
            vx: edge ? 16 + hash(i + time) * 26 : -16 - hash(i + time) * 26,
            vy: (hash(i + 101 + time) - 0.5) * 16,
            born: performance.now(),
            life: 3600 + hash(i + 201 + time) * 4200,
            radius: 0.7 + hash(i + 301 + time) * 1.6,
            hue: palette.petalHues[i % palette.petalHues.length] + hash(i + time) * 24,
            orbit: (hash(i + 501 + time) - 0.5) * 54,
          });
        }
      }
    };

    const draw = (now: number) => {
      if (!reduceMotionRef.current && now - lastFrame < 30) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }
      lastFrame = now;

      const delta = Math.min(48, now - last);
      last = now;
      const palette = PALETTES[paletteIndexRef.current];
      const symmetryNow = symmetryRef.current;
      const windNow = windRef.current;

      if (!reduceMotionRef.current) time += delta * 0.001;

      drawBackground(ctx, width, height, palette, time);
      drawWind(ctx, width, height, palette, windNow, time);
      drawTendrils(ctx, width, height, palette, symmetryNow, windNow, time);

      const cx = width * 0.5;
      const cy = height * 0.52;
      FIELD_SEEDS.forEach((seed) => {
        const sway = Math.sin(time * (0.34 + seed.phase * 0.03) + seed.phase) * windNow;
        const x = seed.x * width + sway * 14;
        const y = seed.y * height + Math.cos(time * 0.26 + seed.phase) * windNow * 8;
        const stemLen = seed.size * (1.7 + hash(seed.id + 90) * 1.3);
        const stemAngle = Math.atan2(y - cy, x - cx) + Math.PI * 0.5 + sway * 0.04;
        ctx.save();
        ctx.strokeStyle = colorAlpha(palette.leaf, 0.16);
        ctx.lineWidth = Math.max(0.7, seed.size * 0.035);
        ctx.beginPath();
        ctx.moveTo(x, y + seed.size * 0.24);
        ctx.quadraticCurveTo(x - Math.sin(stemAngle) * stemLen * 0.22, y + stemLen * 0.58, x + sway * 6, y + stemLen);
        ctx.stroke();
        if (seed.id % 3 === 0) drawLeaf(ctx, x + sway * 5, y + stemLen * 0.48, seed.size * 0.24, stemAngle, palette, 0.18);
        ctx.restore();
        drawRosette(
          ctx,
          x,
          y,
          seed.size * (0.66 + Math.sin(time * 0.42 + seed.phase) * 0.04 * windNow),
          seed.petals,
          palette,
          seed.hueShift,
          seed.spin + sway * 0.12,
          0.28,
          time,
        );
      });

      drawMandala(ctx, width, height, palette, symmetryNow, windNow, time);

      const freshMemories: BloomMemory[] = [];
      memoriesRef.current.forEach((memory) => {
        const age = (performance.now() - memory.born) / memory.life;
        if (age < 1) {
          drawSymmetricBloom(ctx, memory, width, height, palette, symmetryNow, time);
          freshMemories.push(memory);
        }
      });
      memoriesRef.current = freshMemories;

      const gesture = gestureRef.current;
      if (gesture.active) {
        ctx.save();
        const halo = ctx.createRadialGradient(gesture.x, gesture.y, 0, gesture.x, gesture.y, 96);
        halo.addColorStop(0, colorAlpha(palette.pollen, 0.22));
        halo.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(gesture.x, gesture.y, 96, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      updatePollen(delta, palette, windNow);
      rafRef.current = requestAnimationFrame(draw);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(field);
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const markControl = useCallback((meta: string, intensity: number) => {
    const now = performance.now();
    if (now - lastTapeAt.current < 120) return;
    lastTapeAt.current = now;
    try { getFieldAudio().playNote(55 + Math.round(intensity * 24), 95); } catch { /* noop */ }
    try { haptics.tap(); } catch { /* noop */ }
    useField.getState().recordTape("sigil", 0.34 + intensity * 0.46, `flowers/${meta}`);
  }, []);

  const addBloom = useCallback((x: number, y: number, strength: number, velocity: number) => {
    const palette = PALETTES[paletteIndexRef.current];
    const hueShift = ((x * 0.13 + y * 0.21 + memoryIdRef.current * 9) % 90) - 20;
    const bloom: BloomMemory = {
      id: memoryIdRef.current++,
      x,
      y,
      born: performance.now(),
      life: 3400 + strength * 1700,
      strength: clamp(strength, 0.36, 1.2),
      radius: 21 + strength * 28 + velocity * 0.34,
      spin: Math.atan2(y - window.innerHeight * 0.52, x - window.innerWidth * 0.5),
      petals: 5 + Math.floor((symmetryRef.current + memoryIdRef.current) % 7),
      hueShift,
    };
    memoriesRef.current = [...memoriesRef.current.slice(-(MAX_MEMORIES - 1)), bloom];

    const pollenCount = Math.round(7 + strength * 11 + velocity * 0.08);
    for (let i = 0; i < pollenCount; i += 1) {
      const angle = hash(memoryIdRef.current * 13 + i) * Math.PI * 2;
      const speed = 34 + hash(memoryIdRef.current * 23 + i) * 120 + velocity * 1.2;
      pollenRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        born: performance.now(),
        life: 1250 + hash(memoryIdRef.current * 31 + i) * 2600,
        radius: 0.75 + hash(memoryIdRef.current * 37 + i) * 2.4,
        hue: palette.petalHues[i % palette.petalHues.length] + hueShift + hash(i + 10) * 18,
        orbit: (hash(memoryIdRef.current * 43 + i) - 0.5) * 80,
      });
    }
    if (pollenRef.current.length > MAX_POLLEN) pollenRef.current = pollenRef.current.slice(-MAX_POLLEN);
    setBloomCount(memoriesRef.current.length);
  }, []);

  const pollinate = useCallback((clientX: number, clientY: number, force = 1) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = clamp(clientX - rect.left, 0, rect.width);
    const y = clamp(clientY - rect.top, 0, rect.height);
    const gesture = gestureRef.current;
    const distance = Math.hypot(x - gesture.lastX, y - gesture.lastY);
    const now = performance.now();
    gesture.x = x;
    gesture.y = y;
    gesture.moved += distance;

    if (now - gesture.lastBloom > 70 || distance > 46) {
      gesture.lastBloom = now;
      addBloom(x, y, clamp(force + distance / 110, 0.42, 1.18), distance);
    }

    if (now - lastAudioAt.current > 86) {
      lastAudioAt.current = now;
      const xPct = rect.width ? x / rect.width : 0.5;
      const yPct = rect.height ? y / rect.height : 0.5;
      try { getFieldAudio().playNote(52 + Math.round((1 - yPct) * 22) + Math.round(xPct * 8), 96); } catch { /* noop */ }
      useField.getState().recordTape("ripple", 0.34 + (1 - yPct) * 0.48, "flowers/pollinate");
      try { haptics.ripple(0.28 + force * 0.24); } catch { /* noop */ }
    }

    gesture.lastX = x;
    gesture.lastY = y;
  }, [addBloom]);

  const cycleSymmetry = () => {
    setSymmetry((value) => {
      const next = SYMMETRY_STEPS[(SYMMETRY_STEPS.indexOf(value) + 1) % SYMMETRY_STEPS.length];
      markControl(`symmetry/${next}`, next / 12);
      return next;
    });
  };

  const cycleWind = () => {
    setWind((value) => {
      const index = WIND_STEPS.findIndex((step) => Math.abs(step - value) < 0.01);
      const next = WIND_STEPS[(index + 1) % WIND_STEPS.length];
      markControl(`wind/${Math.round(next * 100)}`, next);
      return next;
    });
  };

  const replayBouquet = () => {
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    const width = rect?.width ?? 900;
    const height = rect?.height ?? 620;
    const recent = memoriesRef.current.slice(-7);
    const bouquet = recent.length > 0
      ? recent
      : Array.from({ length: 7 }, (_, index) => ({
          id: -index,
          x: width * (0.5 + Math.cos((index / 7) * Math.PI * 2) * 0.12),
          y: height * (0.52 + Math.sin((index / 7) * Math.PI * 2) * 0.1),
          born: performance.now(),
          life: 1,
          strength: 1,
          radius: 1,
          spin: 0,
          petals: 7,
          hueShift: index * 7,
        }));

    try {
      getFieldAudio().bell();
      bouquet.forEach((bloom, index) => {
        window.setTimeout(() => {
          try { getFieldAudio().playNote(57 + index * 3 + Math.round((1 - bloom.y / height) * 8), 140); } catch { /* noop */ }
        }, index * 90);
      });
    } catch { /* noop */ }
    try { haptics.roll(); } catch { /* noop */ }
    useField.getState().recordTape("sigil", 0.86, "flowers/bouquet");

    bouquet.forEach((bloom, index) => {
      window.setTimeout(() => {
        addBloom(bloom.x, bloom.y, 1.08, 34 + index * 10);
      }, index * 70);
    });
  };

  const clearBouquet = () => {
    memoriesRef.current = [];
    pollenRef.current = [];
    setBloomCount(0);
    try { getFieldAudio().thud(); } catch { /* noop */ }
    try { haptics.chop(); } catch { /* noop */ }
    useField.getState().recordTape("object", 0.38, "flowers/clear");
  };

  const selectPalette = (index: number) => {
    setPaletteIndex(index);
    markControl(`palette/${PALETTES[index].id}`, index / Math.max(1, PALETTES.length - 1));
  };

  return (
    <div className="flowers-page" data-touch-surface="true" data-pretext-ignore="true">
      <section ref={fieldRef} className="flowers-field" aria-label="radial botanical instrument">
        <canvas
          ref={canvasRef}
          className="flowers-canvas"
          role="img"
          aria-label="A touch responsive field of radial petals, pollen, wind, and bouquet symmetry"
          onPointerDown={(event) => {
            const canvas = event.currentTarget;
            const rect = canvas.getBoundingClientRect();
            const x = clamp(event.clientX - rect.left, 0, rect.width);
            const y = clamp(event.clientY - rect.top, 0, rect.height);
            gestureRef.current = {
              active: true,
              pointerId: event.pointerId,
              x,
              y,
              lastX: x,
              lastY: y,
              moved: 0,
              lastBloom: 0,
            };
            pollinate(event.clientX, event.clientY, 1.08);
            try { canvas.setPointerCapture(event.pointerId); } catch { /* noop */ }
          }}
          onPointerMove={(event) => {
            const gesture = gestureRef.current;
            if (!gesture.active || gesture.pointerId !== event.pointerId) return;
            pollinate(event.clientX, event.clientY, event.pressure > 0 ? event.pressure + 0.35 : 0.86);
          }}
          onPointerUp={(event) => {
            const gesture = gestureRef.current;
            if (gesture.pointerId !== event.pointerId) return;
            gesture.active = false;
            gesture.pointerId = null;
            if (gesture.moved < 8) addBloom(gesture.x, gesture.y, 1.18, 42);
            try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* noop */ }
          }}
          onPointerCancel={(event) => {
            const gesture = gestureRef.current;
            gesture.active = false;
            gesture.pointerId = null;
            try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* noop */ }
          }}
        />

        <div className="flowers-toolbar" aria-label="flower instrument controls">
          <div className="flowers-swatches" aria-label="palettes">
            {PALETTES.map((palette, index) => (
              <button
                key={palette.id}
                type="button"
                className="flowers-swatch"
                aria-label={`palette ${palette.id}`}
                aria-pressed={paletteIndex === index}
                title={palette.id}
                onClick={() => selectPalette(index)}
              >
                <span
                  style={{
                    background: `linear-gradient(135deg, ${palette.glow}, hsl(${palette.petalHues[0]} 82% 62%), ${palette.vein})`,
                  }}
                />
              </button>
            ))}
          </div>

          <button
            type="button"
            className="flowers-icon-button"
            aria-label={`cycle radial symmetry, currently ${symmetry}`}
            title="symmetry"
            onClick={cycleSymmetry}
          >
            <SymmetryIcon />
          </button>
          <button
            type="button"
            className="flowers-icon-button"
            aria-label={`cycle wind, currently ${Math.round(wind * 100)}`}
            title="wind"
            onClick={cycleWind}
          >
            <WindIcon />
          </button>
          <button
            type="button"
            className="flowers-icon-button"
            aria-label="replay bouquet"
            title="bouquet"
            onClick={replayBouquet}
          >
            <BouquetIcon />
          </button>
          <button
            type="button"
            className="flowers-icon-button"
            aria-label="clear bouquet"
            title="clear"
            onClick={clearBouquet}
          >
            <ClearIcon />
          </button>

          <output
            className="flowers-readout"
            aria-live="polite"
            aria-label={`symmetry ${symmetry}, wind ${Math.round(wind * 100)}, blooms ${bloomCount}`}
          >
            <span>{String(symmetry).padStart(2, "0")}</span>
            <span>{String(Math.round(wind * 100)).padStart(2, "0")}</span>
            <span>{String(Math.min(99, bloomCount)).padStart(2, "0")}</span>
          </output>
        </div>
      </section>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .flowers-page {
          position: fixed;
          inset: 0;
          min-height: 100svh;
          background:
            radial-gradient(circle at 50% 42%, rgba(245, 214, 128, 0.12), transparent 34%),
            #06100d;
          color: rgba(246, 239, 222, 0.94);
          overflow: hidden;
        }

        .flowers-field {
          position: relative;
          min-height: 100svh;
          isolation: isolate;
          overflow: hidden;
        }

        body:has(.flowers-page) header:not(.oda-site-header) {
          background: transparent !important;
          border-bottom: 0 !important;
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
        }

        body:has(.flowers-page) .oda-field-watch,
        body:has(.flowers-page) .oda-candle-mark,
        body:has(.flowers-page) .oda-tape-shell,
        body:has(.flowers-page) .oda-sound-toggle {
          display: none !important;
        }

        .flowers-canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
          cursor: crosshair;
          touch-action: none;
          z-index: 0;
        }

        .flowers-toolbar {
          position: absolute;
          z-index: 2;
          left: var(--pad-x);
          right: calc(var(--pad-x) + 278px);
          bottom: calc(58px + env(safe-area-inset-bottom, 0px));
          display: flex;
          align-items: center;
          gap: 8px;
          width: min(760px, calc(100vw - var(--pad-x) * 2 - 278px));
          min-width: 0;
          pointer-events: auto;
        }

        .flowers-swatches {
          display: flex;
          align-items: center;
          gap: 6px;
          min-height: 46px;
          padding: 6px;
          border: 1px solid rgba(246, 239, 222, 0.15);
          border-radius: 8px;
          background: rgba(6, 13, 12, 0.54);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          box-shadow: 0 18px 52px rgba(0, 0, 0, 0.26);
        }

        .flowers-swatch,
        .flowers-icon-button {
          appearance: none;
          border: 1px solid rgba(246, 239, 222, 0.18);
          background: rgba(246, 239, 222, 0.07);
          color: rgba(246, 239, 222, 0.95);
          border-radius: 8px;
          cursor: pointer;
          display: grid;
          place-items: center;
          flex: 0 0 auto;
          transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
        }

        .flowers-swatch {
          width: 34px;
          height: 34px;
          padding: 4px;
        }

        .flowers-swatch span {
          display: block;
          width: 100%;
          height: 100%;
          border-radius: 999px;
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.22), 0 0 18px rgba(255, 210, 118, 0.18);
        }

        .flowers-swatch[aria-pressed="true"] {
          border-color: rgba(255, 231, 150, 0.72);
          background: rgba(255, 231, 150, 0.1);
        }

        .flowers-icon-button {
          width: 46px;
          height: 46px;
          background: rgba(6, 13, 12, 0.58);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          box-shadow: 0 18px 52px rgba(0, 0, 0, 0.24);
        }

        .flowers-icon-button svg {
          width: 22px;
          height: 22px;
          fill: none;
          stroke: currentColor;
          stroke-width: 1.6;
          stroke-linecap: round;
          stroke-linejoin: round;
        }

        .flowers-icon-button svg circle,
        .flowers-icon-button svg ellipse {
          fill: currentColor;
          stroke: none;
          opacity: 0.82;
        }

        .flowers-swatch:hover,
        .flowers-icon-button:hover {
          border-color: rgba(255, 231, 150, 0.5);
          background: rgba(246, 239, 222, 0.11);
          transform: translateY(-1px);
        }

        .flowers-swatch:focus-visible,
        .flowers-icon-button:focus-visible {
          outline: 2px solid rgba(255, 231, 150, 0.82);
          outline-offset: 3px;
        }

        .flowers-readout {
          min-height: 46px;
          display: grid;
          grid-template-columns: repeat(3, minmax(32px, auto));
          align-items: center;
          gap: 2px;
          padding: 0 10px;
          border: 1px solid rgba(246, 239, 222, 0.15);
          border-radius: 8px;
          background: rgba(6, 13, 12, 0.54);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          color: rgba(246, 239, 222, 0.72);
          font-family: var(--font-numerals);
          font-size: 13px;
          letter-spacing: 0;
          white-space: nowrap;
          box-shadow: 0 18px 52px rgba(0, 0, 0, 0.24);
        }

        .flowers-readout span {
          display: inline-grid;
          place-items: center;
          min-width: 32px;
          font-variant-numeric: tabular-nums;
        }

        @media (prefers-reduced-motion: reduce) {
          .flowers-swatch,
          .flowers-icon-button {
            transition: none;
          }

          .flowers-swatch:hover,
          .flowers-icon-button:hover {
            transform: none;
          }
        }

        @media (max-width: 920px) {
          .flowers-field {
            min-height: 100svh;
          }

          .flowers-toolbar {
            left: var(--pad-x);
            right: var(--pad-x);
            bottom: calc(98px + env(safe-area-inset-bottom, 0px));
            width: auto;
            flex-wrap: wrap;
            gap: 7px;
          }

          .flowers-swatches {
            order: 1;
            flex: 1 1 188px;
            justify-content: space-between;
          }

          .flowers-icon-button {
            width: 44px;
            height: 44px;
          }

          .flowers-readout {
            order: 2;
            flex: 1 1 132px;
            min-width: 132px;
            justify-content: center;
          }
        }

        @media (max-width: 520px) {
          .flowers-toolbar {
            bottom: calc(88px + env(safe-area-inset-bottom, 0px));
          }

          .flowers-swatches {
            flex: 1 1 100%;
          }

          .flowers-swatch {
            width: 32px;
            height: 32px;
          }

          .flowers-icon-button {
            flex: 1 1 44px;
            min-width: 44px;
            max-width: 58px;
          }

          .flowers-readout {
            min-height: 44px;
            flex: 2 1 132px;
          }
        }
      ` }}
      />
    </div>
  );
}
