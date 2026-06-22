"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { useField } from "@/store/field";
import WaterText from "@/components/WaterText";
import SeaChart, { type SeaChartCandle } from "@/components/SeaChart";

/**
 * /storm — water at peak intensity.
 *
 * A ship's wheel governs the sea: outer ring tunes amplitude, inner ring
 * tunes frequency. A maelstrom button collapses the linear waves into a
 * spiraling vortex. A wind rose nudges crash direction. Lightning answers
 * heavy weather. A "still the sea" rune resets to glass with a 2s decay.
 */
export default function Storm() {
  // page-specific ambient bed: storm crash + wind hiss
  useEffect(() => { getFieldAudio().setAmbientProfile("storm"); }, []);

  const wrapRef = useRef<HTMLDivElement>(null);
  const waterRef = useRef<HTMLCanvasElement>(null);
  const linesRef = useRef<HTMLCanvasElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);

  // amplitude — outer ring of the wheel.
  const stormRef = useRef<number>(0.45);
  const stormTargetRef = useRef<number>(0.45);
  // frequency / speed — inner ring of the wheel.
  const freqRef = useRef<number>(1.0);
  const freqTargetRef = useRef<number>(1.0);
  const stormSpikeRef = useRef<number>(0);
  const manualCrestsRef = useRef<Array<{ x: number; t0: number; strength: number }>>([]);
  const frontWaveRef = useRef<{ xs: number[]; ys: number[]; w: number; h: number } | null>(null);
  const fujiHaloRef = useRef<{ t0: number } | null>(null);
  const windStreaksRef = useRef<Array<{ t0: number; y: number; vx: number; len: number; alpha: number }>>([]);
  // maelstrom strength 0..1 — smoothly tweens between linear and spiral.
  const maelstromRef = useRef<number>(0);
  const maelstromTargetRef = useRef<number>(0);
  // wind direction in radians (0 = right, π/2 = down).
  const windDirRef = useRef<number>(0);
  // calm scalar — when "still the sea" is pressed, ramps amp toward 0.
  const calmRef = useRef<number>(0);
  const calmStartedRef = useRef<number>(0);
  // lightning flash state.
  const lightningRef = useRef<{ t0: number; intensity: number } | null>(null);
  const lastLightningAt = useRef<number>(0);

  const [stormDisplay, setStormDisplay] = useState(0.45);
  const [freqDisplay, setFreqDisplay] = useState(1.0);
  const [maelstromOn, setMaelstromOn] = useState(false);
  const [dragMode, setDragMode] = useState<null | "outer" | "inner" | "wind">(null);
  const [windAngleDisplay, setWindAngleDisplay] = useState(0);
  const stormMarkIdRef = useRef(0);
  const [stormMarks, setStormMarks] = useState<
    Array<{ id: number; label: string; level: number }>
  >([
    { id: 0, label: "swell", level: 0.45 },
    { id: -1, label: "wind", level: 0.35 },
  ]);
  const lastWheelToneAt = useRef(0);

  const addStormMark = useCallback((label: string, level: number) => {
    const id = ++stormMarkIdRef.current;
    setStormMarks((marks) => [
      { id, label, level: Math.max(0, Math.min(1, level)) },
      ...marks,
    ].slice(0, 4));
  }, []);

  const playWheelTone = useCallback((freq: number) => {
    const now = performance.now();
    if (now - lastWheelToneAt.current < 150) return;
    lastWheelToneAt.current = now;
    getFieldAudio().playTone(freq, 0.055);
    haptics.tap();
  }, []);

  // Rolling 30s storm history for the SeaChart embeds at the bottom-left.
  const stormHistoryRef = useRef<number[]>([]);
  const [chartPullKey, setChartPullKey] = useState(0);

  useEffect(() => {
    const wrap = wrapRef.current;
    const water = waterRef.current;
    const lines = linesRef.current;
    if (!wrap || !water || !lines) return;
    const lctx = lines.getContext("2d");
    if (!lctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const motion = reduce ? 0 : 1;
    if (reduce) {
      stormRef.current = Math.min(stormRef.current, 0.3);
      stormTargetRef.current = stormRef.current;
      setStormDisplay(stormRef.current);
    }

    // ── WebGL setup ───────────────────────────────────────────────
    const gl =
      (water.getContext("webgl", { antialias: false, premultipliedAlpha: false }) ||
        water.getContext(
          "experimental-webgl" as "webgl",
          { antialias: false, premultipliedAlpha: false } as WebGLContextAttributes,
        )) as WebGLRenderingContext | null;

    let glProg: WebGLProgram | null = null;
    let uTimeLoc: WebGLUniformLocation | null = null;
    let uResLoc: WebGLUniformLocation | null = null;
    let uStormLoc: WebGLUniformLocation | null = null;
    let uMaelstromLoc: WebGLUniformLocation | null = null;
    let uFlashLoc: WebGLUniformLocation | null = null;

    if (gl) {
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
        uniform float uStorm;
        uniform float uMaelstrom;
        uniform float uFlash;
        varying vec2 vUv;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float vnoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          float a = hash21(i);
          float b = hash21(i + vec2(1.0, 0.0));
          float c = hash21(i + vec2(0.0, 1.0));
          float d = hash21(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }
        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 5; i++) {
            v += a * vnoise(p);
            p *= 2.07;
            a *= 0.52;
          }
          return v;
        }

        void main() {
          vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
          float t = uTime;
          float s = clamp(uStorm, 0.0, 1.0);
          float m = clamp(uMaelstrom, 0.0, 1.0);

          float seaTop = 0.30;

          vec3 skyCalm  = vec3(0.949, 0.933, 0.902);
          vec3 skyMid   = vec3(0.84, 0.85, 0.86);
          vec3 skyStorm = vec3(0.38, 0.42, 0.50);
          vec3 sky = mix(skyCalm, skyMid, smoothstep(0.0, 0.55, s));
          sky = mix(sky, skyStorm, smoothstep(0.55, 1.0, s));
          float skyV = uv.y / seaTop;
          sky = mix(sky, sky * 0.92, smoothstep(0.6, 1.0, skyV));

          float seaV = (uv.y - seaTop) / (1.0 - seaTop);
          seaV = clamp(seaV, 0.0, 1.0);

          vec3 seaSurface = vec3(0.165, 0.353, 0.549);
          vec3 seaMid     = vec3(0.106, 0.227, 0.392);
          vec3 seaDeep    = vec3(0.055, 0.145, 0.251);

          vec3 sea = mix(seaSurface, seaMid, smoothstep(0.0, 0.5, seaV));
          sea = mix(sea, seaDeep, smoothstep(0.5, 1.0, seaV));

          // maelstrom: vortex bowl + spiral caustics
          vec2 vortexCenter = vec2(0.5, 0.65);
          vec2 toCenter = uv - vortexCenter;
          float r = length(toCenter);
          float ang = atan(toCenter.y, toCenter.x);
          float vortexBowl = smoothstep(0.35, 0.0, r) * m;
          float spiralAng = ang + (1.0 / (r + 0.08)) * (0.4 + s * 0.7) - t * (0.4 + s * 0.6);

          vec2 nuv = vec2(uv.x, seaV) * vec2(uRes.x / uRes.y, 1.0) * (3.0 + s * 1.6)
                   + vec2(t * (0.05 + s * 0.15), t * (0.03 + s * 0.10));
          vec2 spiralUv = vec2(spiralAng, r * (4.0 + s * 4.0));
          nuv = mix(nuv, spiralUv * 1.8, m);
          float n = fbm(nuv);

          float c1 = sin((uv.x + n * 0.20) * 18.0 + t * (0.4 + s * 0.8))
                   * sin((seaV + n * 0.16) * 12.0 - t * (0.30 + s * 0.5));
          float c2 = sin(uv.x * 7.0 - t * (0.25 + s * 0.4) + n * 1.4)
                   * sin(seaV * 5.5 + t * (0.20 + s * 0.3) - n * 1.0);
          float cSpiral = sin(spiralAng * 8.0 + t * 1.2) * sin(r * 30.0 - t * 1.6);
          float caustic = c1 * 0.45 + c2 * 0.40 + cSpiral * m * 0.7;
          caustic = smoothstep(0.4, 1.2, caustic);

          float surfMask = 1.0 - smoothstep(0.05, 0.7, seaV);
          float causticBoost = 0.09 + s * 0.18;
          vec3 causticTint = mix(vec3(0.75, 0.88, 0.98), vec3(0.92, 0.96, 1.00), s);
          sea += caustic * causticBoost * causticTint * surfMask;

          float wash = sin(uv.x * 2.0 + t * 0.1) * sin(seaV * 3.0 - t * 0.06);
          sea += wash * (0.02 + s * 0.04) * vec3(0.85, 0.92, 1.0);

          sea *= mix(1.0, 0.84, s);
          sea *= 1.0 - vortexBowl * 0.55;

          float edge = smoothstep(seaTop - 0.005, seaTop + 0.005, uv.y);
          vec3 color = mix(sky, sea, edge);

          float seam = smoothstep(0.003, 0.0, abs(uv.y - seaTop));
          color = mix(color, vec3(0.20, 0.22, 0.26), seam * 0.18);

          color += vec3(uFlash);
          color = clamp(color, 0.0, 1.5);

          gl_FragColor = vec4(color, 1.0);
        }
      `;
      const compile = (type: number, src: string) => {
        const sh = gl.createShader(type);
        if (!sh) return null;
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
          console.warn("storm shader compile failed", gl.getShaderInfoLog(sh));
          gl.deleteShader(sh);
          return null;
        }
        return sh;
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
            uStormLoc = gl.getUniformLocation(p, "uStorm");
            uMaelstromLoc = gl.getUniformLocation(p, "uMaelstrom");
            uFlashLoc = gl.getUniformLocation(p, "uFlash");

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
          }
        }
      }
    }

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      water.width = Math.floor(w * dpr);
      water.height = Math.floor(h * dpr);
      lines.width = Math.floor(w * dpr);
      lines.height = Math.floor(h * dpr);
      lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (gl) gl.viewport(0, 0, water.width, water.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    type Particle = {
      alive: boolean;
      x: number; y: number;
      vx: number; vy: number;
      life: number;
      maxLife: number;
      r: number;
    };
    const POOL = 400;
    const particles: Particle[] = [];
    for (let i = 0; i < POOL; i++) {
      particles.push({
        alive: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, r: 1,
      });
    }
    let nextSpawnHint = 0;
    const spawnParticle = (x: number, y: number, vx: number, vy: number) => {
      for (let attempts = 0; attempts < POOL; attempts++) {
        const idx = (nextSpawnHint + attempts) % POOL;
        const p = particles[idx];
        if (!p.alive) {
          p.alive = true;
          p.x = x; p.y = y;
          p.vx = vx; p.vy = vy;
          p.maxLife = 0.8 + Math.random() * 0.8;
          p.life = p.maxLife;
          p.r = 1.2 + Math.random() * 1.8;
          nextSpawnHint = idx + 1;
          return;
        }
      }
    };

    type WaveLayer = {
      yFrac: number;
      ampBase: number;
      k: number;
      phaseSpeed: number;
      compound: number;
      offset: number;
      lineColor: string;
      fillColor: string;
    };
    const layers: WaveLayer[] = [
      { yFrac: 0.42, ampBase: 5,  k: 0.0095, phaseSpeed: 0.16, compound: 0.32, offset: 0.0,
        lineColor: "rgba(20, 30, 50, 0.55)", fillColor: "rgba(42, 90, 140, 0.18)" },
      { yFrac: 0.52, ampBase: 9,  k: 0.0090, phaseSpeed: 0.22, compound: 0.38, offset: 1.2,
        lineColor: "rgba(20, 30, 50, 0.62)", fillColor: "rgba(35, 75, 120, 0.22)" },
      { yFrac: 0.64, ampBase: 15, k: 0.0080, phaseSpeed: 0.30, compound: 0.46, offset: 2.4,
        lineColor: "rgba(20, 30, 50, 0.72)", fillColor: "rgba(27, 58, 100, 0.26)" },
      { yFrac: 0.78, ampBase: 24, k: 0.0070, phaseSpeed: 0.38, compound: 0.55, offset: 3.5,
        lineColor: "rgba(20, 30, 50, 0.82)", fillColor: "rgba(18, 42, 78, 0.34)" },
      { yFrac: 0.92, ampBase: 36, k: 0.0058, phaseSpeed: 0.46, compound: 0.66, offset: 4.7,
        lineColor: "rgba(20, 30, 50, 0.92)", fillColor: "rgba(14, 32, 64, 0.46)" },
    ];

    const audio = getFieldAudio();
    audio.start();
    let lastCrashAt = 0;
    let nextCrashGap = 2200 + Math.random() * 1800;

    const manualBump = (x: number, now: number): number => {
      let d = 0;
      const list = manualCrestsRef.current;
      for (let i = list.length - 1; i >= 0; i--) {
        const c = list[i];
        const age = (now - c.t0) / 1000;
        if (age > 3.0) { list.splice(i, 1); continue; }
        const sigma = 60 + age * 30;
        const fall = Math.exp(-((x - c.x) * (x - c.x)) / (2 * sigma * sigma));
        const temporal = Math.max(0, 1 - age / 3.0);
        d += c.strength * fall * temporal;
      }
      return d;
    };

    const particleBoost = new Float32Array(POOL);

    const spawnBurst = (x: number, y: number, count: number, baseSpeed: number) => {
      for (let k = 0; k < count; k++) {
        const ang = -Math.PI * 0.5 + (Math.random() - 0.5) * Math.PI * 0.85;
        const sp = baseSpeed * (0.55 + Math.random() * 0.85);
        const vx = Math.cos(ang) * sp + (Math.random() - 0.5) * 30;
        const vy = Math.sin(ang) * sp * 1.05;
        spawnParticle(x, y, vx, vy);
        const justSpawned = (nextSpawnHint - 1 + POOL) % POOL;
        particleBoost[justSpawned] = 1;
      }
    };

    const pickParticleAt = (x: number, y: number, radius: number): number => {
      let best = -1;
      let bestD2 = radius * radius;
      for (let i = 0; i < POOL; i++) {
        const p = particles[i];
        if (!p.alive) continue;
        const dx = p.x - x;
        const dy = p.y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; best = i; }
      }
      return best;
    };

    let seaDragging = false;
    let lastDragAt = 0;
    let lastDragX = -1;
    let lastDragY = -1;

    const FUJI_HIT_PADDING = 8;
    const isOnFuji = (x: number, y: number): boolean => {
      const wEl = lines.clientWidth;
      const hEl = lines.clientHeight;
      const fujiCenterX = wEl * 0.34;
      const fujiBaseY = hEl * 0.30;
      const fujiHeight = Math.min(hEl * 0.18, 180);
      const fujiHalfW = fujiHeight * 1.4;
      const xLeft = fujiCenterX - fujiHalfW - FUJI_HIT_PADDING;
      const xRight = fujiCenterX + fujiHalfW + FUJI_HIT_PADDING;
      const yTop = fujiBaseY - fujiHeight - FUJI_HIT_PADDING;
      const yBot = fujiBaseY + FUJI_HIT_PADDING;
      if (x < xLeft || x > xRight || y < yTop || y > yBot) return false;
      const tNorm = Math.max(0, Math.min(1, (fujiBaseY - y) / fujiHeight));
      const halfAtY = fujiHalfW * (1 - tNorm * 0.85);
      return Math.abs(x - fujiCenterX) <= halfAtY + FUJI_HIT_PADDING;
    };

    const crestHitDistance = (x: number, y: number): number => {
      const buf = frontWaveRef.current;
      if (!buf) return Infinity;
      let bestDist = Infinity;
      for (let i = 1; i < buf.xs.length - 1; i++) {
        if (buf.ys[i] >= buf.ys[i - 1] || buf.ys[i] >= buf.ys[i + 1]) continue;
        const dx = buf.xs[i] - x;
        if (Math.abs(dx) > 60) continue;
        const dy = buf.ys[i] - y;
        const d = Math.hypot(dx, dy);
        if (d < bestDist) bestDist = d;
      }
      return bestDist;
    };

    const onPointerDown = (e: PointerEvent) => {
      const r = lines.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const seaTopPx = lines.clientHeight * 0.30;

      const pIdx = pickParticleAt(x, y, 16);
      if (pIdx >= 0) {
        const p = particles[pIdx];
        const speed = Math.hypot(p.vx, p.vy);
        if (speed < 5) {
          p.vx += (Math.random() - 0.5) * 60;
          p.vy -= 120;
        } else {
          const mag = 80;
          p.vx += (p.vx / speed) * mag;
          p.vy += (p.vy / speed) * mag * 0.6;
        }
        particleBoost[pIdx] = 1;
        audio.spark();
        haptics.ripple(0.25);
        addStormMark("spray", 0.34);
        return;
      }

      if (isOnFuji(x, y)) {
        fujiHaloRef.current = { t0: performance.now() };
        audio.chime();
        haptics.roll();
        useField.getState().recordTape("object", 0.7, "fuji");
        addStormMark("fuji", 0.62);
        return;
      }

      if (y < seaTopPx) {
        if (!reduce) {
          const goesRight = Math.random() < 0.7;
          windStreaksRef.current.push({
            t0: performance.now(),
            y,
            vx: (goesRight ? 1 : -1) * (90 + Math.random() * 80),
            len: 60 + Math.random() * 50,
            alpha: 0.55,
          });
          if (windStreaksRef.current.length > 8) windStreaksRef.current.shift();
        }
        audio.chime();
        haptics.chop();
        useField.getState().recordTape("ripple", 0.4, "storm/sky");
        addStormMark("squall", 0.44);
        return;
      }

      manualCrestsRef.current.push({ x, t0: performance.now(), strength: 28 });
      if (manualCrestsRef.current.length > 12) manualCrestsRef.current.shift();

      const crestD = crestHitDistance(x, y);
      if (crestD < 24) {
        spawnBurst(x, y, 14, 220);
        audio.thud();
        haptics.storm();
        stormSpikeRef.current = Math.min(0.4, stormSpikeRef.current + 0.05);
        useField.getState().recordTape("ripple", 1.0, "storm/crest");
        addStormMark("crest", 0.95);
      } else {
        haptics.ripple(0.5);
        useField.getState().recordTape("ripple", 0.9, "storm");
        addStormMark("swell", 0.58);
      }

      seaDragging = true;
      lastDragX = x;
      lastDragY = y;
      lastDragAt = 0;
      try { lines.setPointerCapture(e.pointerId); } catch { /* noop */ }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!seaDragging) return;
      const r = lines.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const seaTopPx = lines.clientHeight * 0.30;
      if (y < seaTopPx) {
        lastDragX = x; lastDragY = y;
        return;
      }
      const dist = Math.hypot(x - lastDragX, y - lastDragY);
      if (dist < 3) return;
      const dx = x - lastDragX;
      const ang = Math.atan2(-Math.abs(dx) * 0.2 - 60, dx);
      const sp = 40 + Math.random() * 40;
      spawnParticle(x, y, Math.cos(ang) * sp + (Math.random() - 0.5) * 30, Math.sin(ang) * sp);
      const nowMs = performance.now();
      if (nowMs - lastDragAt > 220) {
        if (crestHitDistance(x, y) < 28) {
          audio.chime();
          haptics.chop();
          addStormMark("break", 0.66);
          lastDragAt = nowMs;
        }
      }
      lastDragX = x; lastDragY = y;
    };

    const onPointerUp = (e: PointerEvent) => {
      seaDragging = false;
      try { lines.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    };

    lines.addEventListener("pointerdown", onPointerDown);
    lines.addEventListener("pointermove", onPointerMove);
    lines.addEventListener("pointerup", onPointerUp);
    lines.addEventListener("pointercancel", onPointerUp);

    const t0 = performance.now();
    let raf = 0;

    const draw = (now: number) => {
      const w = lines.clientWidth;
      const h = lines.clientHeight;

      stormSpikeRef.current *= 0.985;
      if (stormSpikeRef.current < 0.001) stormSpikeRef.current = 0;
      const dialTarget = reduce ? Math.min(stormTargetRef.current, 0.3) : stormTargetRef.current;

      // calm scalar — ease amplitude toward 0 over ~2s when "still the sea" pressed.
      let calmFactor = 1;
      if (calmRef.current > 0.01) {
        const sinceCalm = (now - calmStartedRef.current) / 1000;
        if (sinceCalm < 2.0) {
          const p = sinceCalm / 2.0;
          calmFactor = Math.pow(1 - p, 3);
        } else {
          calmFactor = 0;
          calmRef.current = 0;
        }
      }

      const target = Math.min(1, dialTarget + stormSpikeRef.current) * calmFactor;
      stormRef.current += (target - stormRef.current) * 0.10;
      const s = stormRef.current;

      // smooth frequency and maelstrom toward their targets.
      freqRef.current += (freqTargetRef.current - freqRef.current) * 0.10;
      const freqMulDial = freqRef.current;
      maelstromRef.current += (maelstromTargetRef.current - maelstromRef.current) * 0.06;
      const ml = maelstromRef.current;

      // Lightning — random when storm > 0.8.
      if (!reduce && s > 0.8 && now - lastLightningAt.current > 5000 + Math.random() * 7000) {
        if (Math.random() < 0.02) {
          lightningRef.current = { t0: now, intensity: 0.6 + Math.random() * 0.4 };
          lastLightningAt.current = now;
          audio.thud();
          const fl = flashRef.current;
          if (fl) {
            fl.style.opacity = "0.65";
            window.setTimeout(() => { if (fl) fl.style.opacity = "0"; }, 90);
          }
        }
      }
      let flashAdd = 0;
      if (lightningRef.current) {
        const age = (now - lightningRef.current.t0) / 1000;
        if (age > 0.5) {
          lightningRef.current = null;
        } else {
          const v = Math.max(0, 1 - age / 0.5);
          flashAdd = v * v * lightningRef.current.intensity * 0.85;
        }
      }

      const audioT = audio.getAudioTime();
      const realT = audioT != null ? audioT : (now - t0) / 1000;
      const t = reduce ? 0 : realT;

      // ── WebGL pass ─────────────────────────────────────────────
      if (gl && glProg) {
        gl.useProgram(glProg);
        if (uTimeLoc) gl.uniform1f(uTimeLoc, t);
        if (uResLoc) gl.uniform2f(uResLoc, water.width, water.height);
        if (uStormLoc) gl.uniform1f(uStormLoc, s);
        if (uMaelstromLoc) gl.uniform1f(uMaelstromLoc, ml);
        if (uFlashLoc) gl.uniform1f(uFlashLoc, flashAdd);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } else {
        const wctx = water.getContext("2d");
        if (wctx) {
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          const skyMix = (1 - s);
          wctx.fillStyle = `rgba(${Math.round(95 + skyMix * 145)},${Math.round(110 + skyMix * 130)},${Math.round(130 + skyMix * 100)},1)`;
          wctx.fillRect(0, 0, w, h * 0.30);
          const g = wctx.createLinearGradient(0, h * 0.30, 0, h);
          g.addColorStop(0.00, "rgba( 42, 90,140, 1.0)");
          g.addColorStop(0.55, "rgba( 27, 58,100, 1.0)");
          g.addColorStop(1.00, "rgba( 14, 37, 64, 1.0)");
          wctx.fillStyle = g;
          wctx.fillRect(0, h * 0.30, w, h - h * 0.30);
        }
      }

      lctx.clearRect(0, 0, w, h);

      // ── Mt Fuji ───────────────────────────────────────────────
      const fujiCenterX = w * 0.34;
      const fujiBaseY = h * 0.30;
      const fujiHeight = Math.min(h * 0.18, 180);
      const fujiHalfW = fujiHeight * 1.4;
      const fujiAlpha = (1 - s * 0.6) * 0.42 * (1 - ml * 0.6);

      if (fujiHaloRef.current) {
        const haloAge = (now - fujiHaloRef.current.t0) / 1000;
        if (haloAge > 1.4) {
          fujiHaloRef.current = null;
        } else {
          const haloA = Math.max(0, 1 - haloAge / 1.4);
          const haloR = fujiHeight * (1.0 + haloAge * 0.6);
          const haloGrad = lctx.createRadialGradient(
            fujiCenterX, fujiBaseY - fujiHeight * 0.5, fujiHeight * 0.2,
            fujiCenterX, fujiBaseY - fujiHeight * 0.5, haloR,
          );
          haloGrad.addColorStop(0, `rgba(244, 248, 255, ${0.32 * haloA})`);
          haloGrad.addColorStop(1, "rgba(244, 248, 255, 0)");
          lctx.fillStyle = haloGrad;
          lctx.beginPath();
          lctx.arc(fujiCenterX, fujiBaseY - fujiHeight * 0.5, haloR, 0, Math.PI * 2);
          lctx.fill();
        }
      }

      if (fujiAlpha > 0.005) {
        lctx.fillStyle = `rgba(60, 70, 86, ${fujiAlpha})`;
        lctx.beginPath();
        lctx.moveTo(fujiCenterX - fujiHalfW, fujiBaseY);
        lctx.quadraticCurveTo(
          fujiCenterX - fujiHalfW * 0.55, fujiBaseY - fujiHeight * 0.62,
          fujiCenterX - fujiHalfW * 0.16, fujiBaseY - fujiHeight * 0.95,
        );
        lctx.lineTo(fujiCenterX + fujiHalfW * 0.18, fujiBaseY - fujiHeight * 0.95);
        lctx.quadraticCurveTo(
          fujiCenterX + fujiHalfW * 0.58, fujiBaseY - fujiHeight * 0.60,
          fujiCenterX + fujiHalfW, fujiBaseY,
        );
        lctx.closePath();
        lctx.fill();
        lctx.fillStyle = `rgba(240, 244, 250, ${fujiAlpha * 1.1})`;
        lctx.beginPath();
        lctx.moveTo(fujiCenterX - fujiHalfW * 0.16, fujiBaseY - fujiHeight * 0.95);
        lctx.lineTo(fujiCenterX + fujiHalfW * 0.18, fujiBaseY - fujiHeight * 0.95);
        lctx.lineTo(fujiCenterX + fujiHalfW * 0.06, fujiBaseY - fujiHeight * 0.78);
        lctx.lineTo(fujiCenterX - fujiHalfW * 0.04, fujiBaseY - fujiHeight * 0.70);
        lctx.lineTo(fujiCenterX - fujiHalfW * 0.10, fujiBaseY - fujiHeight * 0.78);
        lctx.closePath();
        lctx.fill();
      }

      lctx.strokeStyle = `rgba(20, 30, 50, ${0.18 + s * 0.10})`;
      lctx.lineWidth = 1;
      lctx.beginPath();
      lctx.moveTo(0, h * 0.30);
      lctx.lineTo(w, h * 0.30);
      lctx.stroke();

      if (windStreaksRef.current.length > 0) {
        for (let i = windStreaksRef.current.length - 1; i >= 0; i--) {
          const ws = windStreaksRef.current[i];
          const age = (now - ws.t0) / 1000;
          if (age > 1.6) { windStreaksRef.current.splice(i, 1); continue; }
          const headX = (ws.vx > 0 ? -ws.len * 0.5 : w + ws.len * 0.5) + ws.vx * age;
          const tailX = headX - Math.sign(ws.vx) * ws.len;
          const a = ws.alpha * Math.max(0, 1 - age / 1.6) * (s < 0.7 ? 1 : 0.7);
          const grad = lctx.createLinearGradient(headX, ws.y, tailX, ws.y);
          grad.addColorStop(0, `rgba(244, 248, 255, ${a})`);
          grad.addColorStop(1, "rgba(244, 248, 255, 0)");
          lctx.strokeStyle = grad;
          lctx.lineWidth = 1.2;
          lctx.lineCap = "round";
          lctx.beginPath();
          lctx.moveTo(headX, ws.y);
          lctx.lineTo(tailX, ws.y);
          lctx.stroke();
        }
      }

      // ── wave layers ────────────────────────────────────────────
      const ampMul = 0.4 + s * 1.6;
      const freqMul = (1.0 + s * 0.6) * freqMulDial;

      const samples = 120;
      const step = w / samples;
      const breakThreshold = 0.85 - s * 0.30;
      const emitRate = s > 0.05 ? s * 120 : 0;
      const emitProbPerCrest = Math.min(0.65, emitRate / 90);

      // wind direction: x-skew and phase sign.
      const windSkewX = Math.cos(windDirRef.current) * 6;
      const windPhase = Math.cos(windDirRef.current);

      let bigBreakCount = 0;

      for (let li = 0; li < layers.length; li++) {
        const layer = layers[li];
        const y0 = h * layer.yFrac;
        const amp = layer.ampBase * ampMul;
        const k = layer.k * freqMul;
        const baseSpeed = layer.phaseSpeed * motion * freqMulDial;
        const phaseT = t * baseSpeed * (windPhase >= 0 ? 1 : -1) * Math.max(0.5, Math.abs(windPhase));

        const xs: number[] = new Array(samples + 1);
        const ys: number[] = new Array(samples + 1);

        const vortexCx = w * 0.5;
        const vortexCy = h * 0.65;
        const ringR = (li / layers.length) * Math.min(w, h) * 0.42 + 30;
        const spinSpeed = (0.4 + s * 0.6) * (1 - li / layers.length * 0.4);

        for (let i = 0; i <= samples; i++) {
          const x = i * step;
          const ph = x * k + phaseT;
          const base =
            Math.sin(ph) +
            layer.compound * Math.sin(ph * 2.3 + phaseT * 0.8 + layer.offset);
          let xx = x + windSkewX;
          let yy = y0 + base * amp;
          if (li === layers.length - 1) {
            yy -= manualBump(x, now);
          }
          if (ml > 0.001) {
            const ang = (x / w) * Math.PI * 2 + t * spinSpeed;
            const ringX = vortexCx + Math.cos(ang) * ringR;
            const ringY = vortexCy + Math.sin(ang) * ringR * 0.45;
            const wobble = base * amp * 0.5;
            const tx = Math.cos(ang + Math.PI / 2);
            const ty = Math.sin(ang + Math.PI / 2);
            const rxc = ringX + tx * wobble;
            const ryc = ringY + ty * wobble;
            xx = xx * (1 - ml) + rxc * ml;
            yy = yy * (1 - ml) + ryc * ml;
          }
          xs[i] = xx;
          ys[i] = yy;
        }

        lctx.fillStyle = layer.fillColor;
        lctx.beginPath();
        lctx.moveTo(xs[0], ys[0]);
        for (let i = 1; i <= samples; i++) lctx.lineTo(xs[i], ys[i]);
        if (ml > 0.5) {
          lctx.lineTo(w, h);
          lctx.lineTo(0, h);
        } else {
          const nextBaseline = li + 1 < layers.length ? h * layers[li + 1].yFrac : h;
          lctx.lineTo(w, nextBaseline);
          lctx.lineTo(0, nextBaseline);
        }
        lctx.closePath();
        lctx.fill();

        lctx.strokeStyle = layer.lineColor;
        lctx.lineWidth = 1.2 + (li / layers.length) * 0.8;
        lctx.beginPath();
        lctx.moveTo(xs[0], ys[0]);
        for (let i = 1; i <= samples; i++) lctx.lineTo(xs[i], ys[i]);
        lctx.stroke();

        const clawColor = `rgba(240, 248, 255, ${0.55 + s * 0.30})`;
        const clawInk = "rgba(20, 30, 50, 0.82)";
        const clawLen = (5 + li * 1.6) * (1.3 - s * 0.5);
        for (let i = 2; i < samples - 1; i++) {
          if (ys[i] >= ys[i - 1] || ys[i] >= ys[i + 1]) continue;
          const crestHeight = (y0 - ys[i]) / Math.max(amp, 0.001);
          if (crestHeight < breakThreshold && ml < 0.3) continue;

          const dy = ys[i + 1] - ys[i];
          const dx = step;
          const slope = Math.abs(dy / dx);
          const dyL = ys[i] - ys[i - 1];
          const slopeL = Math.abs(dyL / dx);
          if (slope < 0.25 && slopeL < 0.25 && ml < 0.3) continue;

          const cx = xs[i];
          const cy = ys[i];

          const claws = 1 + Math.floor((li / 2) + s * 2.4);

          for (let cIdx = 0; cIdx < claws; cIdx++) {
            const dir = cIdx % 2 === 0 ? -1 : 1;
            const spread = (cIdx + 1) * 2.2;
            const arcX = cx + dir * spread;
            const arcY = cy - clawLen * (0.5 + (cIdx / claws) * 0.5);

            lctx.fillStyle = clawColor;
            lctx.beginPath();
            lctx.moveTo(cx, cy);
            lctx.quadraticCurveTo(
              cx + dir * (spread * 0.4), cy - clawLen * 0.6,
              arcX, arcY,
            );
            lctx.quadraticCurveTo(
              cx + dir * (spread * 0.7), cy - clawLen * 0.2,
              cx, cy,
            );
            lctx.closePath();
            lctx.fill();

            if (li >= layers.length - 2) {
              lctx.strokeStyle = clawInk;
              lctx.lineWidth = 0.9;
              lctx.beginPath();
              lctx.moveTo(cx, cy);
              lctx.quadraticCurveTo(
                cx + dir * (spread * 0.4), cy - clawLen * 0.6,
                arcX, arcY,
              );
              lctx.stroke();
            }
          }

          if (s > 0.05 && Math.random() < emitProbPerCrest) {
            const speed = 60 + s * 140 + Math.random() * 60;
            const dirX = (-dyL + dy) * 0.5;
            const tangentMag = Math.hypot(dirX, dx);
            const nx = -dirX / Math.max(tangentMag, 0.001);
            const vx = (Math.random() - 0.5) * 50 + nx * 8;
            const vy = -speed * (0.5 + Math.random() * 0.5);
            spawnParticle(cx, cy, vx, vy);
          }

          if (li >= layers.length - 2 && slope > 0.45 && s > 0.7) {
            bigBreakCount++;
          }
        }

        if (li === layers.length - 1) {
          frontWaveRef.current = { xs, ys, w, h };
        }
      }

      // Maelstrom drain disk
      if (ml > 0.4) {
        const vortexCx = w * 0.5;
        const vortexCy = h * 0.65;
        const r0 = 40 * ml;
        const drainGrad = lctx.createRadialGradient(vortexCx, vortexCy, 0, vortexCx, vortexCy, r0);
        drainGrad.addColorStop(0, `rgba(0, 0, 0, ${0.85 * ml})`);
        drainGrad.addColorStop(0.6, `rgba(10, 20, 35, ${0.5 * ml})`);
        drainGrad.addColorStop(1, "rgba(10, 20, 35, 0)");
        lctx.fillStyle = drainGrad;
        lctx.beginPath();
        lctx.arc(vortexCx, vortexCy, r0, 0, Math.PI * 2);
        lctx.fill();
      }

      // ── particle integration + render ─────────────────────────
      const dt = Math.min(0.05, motion ? 1 / 60 : 0);
      const baseGravity = 320;
      const vortexCxP = w * 0.5;
      const vortexCyP = h * 0.65;
      const drag = 0.985;
      const sprayAlpha = 0.55 + s * 0.35;
      const boostDecay = Math.pow(0.001, dt / 0.2);
      for (let i = 0; i < POOL; i++) {
        const p = particles[i];
        if (!p.alive) continue;
        p.life -= dt;
        if (p.life <= 0) {
          p.alive = false;
          particleBoost[i] = 0;
          continue;
        }
        if (ml > 0.3) {
          const dx = vortexCxP - p.x;
          const dy = vortexCyP - p.y;
          const d = Math.hypot(dx, dy) + 1;
          const nx = dx / d;
          const ny = dy / d;
          const pullStrength = 350 * ml;
          p.vx += nx * pullStrength * dt;
          p.vy += ny * pullStrength * dt;
          const tangX = -ny;
          const tangY = nx;
          p.vx += tangX * 220 * ml * dt;
          p.vy += tangY * 220 * ml * dt;
          p.vy += baseGravity * (1 - ml) * dt;
        } else {
          p.vy += baseGravity * dt;
        }
        p.vx *= drag;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.y > h || p.x < -20 || p.x > w + 20) {
          p.alive = false;
          particleBoost[i] = 0;
          continue;
        }
        if (ml > 0.4) {
          const dxV = p.x - vortexCxP;
          const dyV = p.y - vortexCyP;
          const drainR = 36 * ml;
          if (dxV * dxV + dyV * dyV < drainR * drainR) {
            p.alive = false;
            particleBoost[i] = 0;
            continue;
          }
        }
        const lifeRatio = p.life / p.maxLife;
        const boost = particleBoost[i];
        if (boost > 0) particleBoost[i] = boost * boostDecay;
        const a = Math.min(1, sprayAlpha * lifeRatio + boost * 0.4);
        lctx.globalAlpha = a;
        lctx.fillStyle = boost > 0.05
          ? `rgba(255, 255, 255, 1)`
          : `rgba(244, 248, 255, 1)`;
        lctx.beginPath();
        lctx.arc(
          p.x, p.y,
          p.r * (0.5 + 0.5 * lifeRatio) * (1 + boost * 0.6),
          0, Math.PI * 2,
        );
        lctx.fill();
      }
      lctx.globalAlpha = 1;

      if (!reduce && s > 0.7 && bigBreakCount > 0) {
        if (now - lastCrashAt > nextCrashGap) {
          audio.thud();
          lastCrashAt = now;
          nextCrashGap = 2000 + Math.random() * 2000;
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      lines.removeEventListener("pointerdown", onPointerDown);
      lines.removeEventListener("pointermove", onPointerMove);
      lines.removeEventListener("pointerup", onPointerUp);
      lines.removeEventListener("pointercancel", onPointerUp);
    };
  }, [addStormMark]);

  // Storm-history sampler for the SeaChart embeds (kept).
  useEffect(() => {
    const id = window.setInterval(() => {
      const buf = stormHistoryRef.current;
      buf.push(stormRef.current + stormSpikeRef.current);
      if (buf.length > 120) buf.shift();
      setChartPullKey((k) => k + 1);
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  const stormSource = (i: number): SeaChartCandle => {
    const buf = stormHistoryRef.current;
    const COUNT = 30;
    if (buf.length < 2) {
      return { open: 0.5, close: 0.5, high: 0.5, low: 0.5, volume: 0.05 };
    }
    const offset = i % COUNT;
    const start = Math.max(0, buf.length - COUNT * 2);
    const a = buf[Math.min(buf.length - 1, start + offset * 2)] ?? 0.5;
    const b = buf[Math.min(buf.length - 1, start + offset * 2 + 1)] ?? a;
    const open = a;
    const close = b;
    const high = Math.max(a, b) + Math.abs(b - a) * 0.4 + 0.02;
    const low = Math.min(a, b) - Math.abs(b - a) * 0.4 - 0.02;
    const volume = Math.abs(b - a) + 0.05;
    return { open, close, high, low, volume };
  };

  // ── ship's-wheel handlers ────────────────────────────────────────
  const wheelRef = useRef<HTMLDivElement>(null);

  const wheelGeometry = (clientX: number, clientY: number) => {
    const el = wheelRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    const norm = dist / (r.width / 2);
    return { cx, cy, ang, norm };
  };

  const angleToValue = (ang: number): number => {
    let a = ang + Math.PI / 2;
    if (a < 0) a += Math.PI * 2;
    return Math.min(1, Math.max(0, a / (Math.PI * 2)));
  };

  const setStormFromAngle = (ang: number) => {
    const v = angleToValue(ang);
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const clamped = reduce ? Math.min(v, 0.3) : v;
    stormTargetRef.current = clamped;
    setStormDisplay(clamped);
    playWheelTone(110 + clamped * 180);
  };

  const setFreqFromAngle = (ang: number) => {
    const v = angleToValue(ang);
    const mapped = 0.4 + v * 1.8;
    freqTargetRef.current = mapped;
    setFreqDisplay(mapped);
    playWheelTone(220 + v * 420);
  };

  const onWheelDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = wheelGeometry(e.clientX, e.clientY);
    if (!g) return;
    if (g.norm > 1.05) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (g.norm > 0.62) {
      setDragMode("outer");
      setStormFromAngle(g.ang);
      addStormMark("amplitude", 0.52);
    } else if (g.norm > 0.18) {
      setDragMode("inner");
      setFreqFromAngle(g.ang);
      addStormMark("speed", 0.48);
    }
  };

  const onWheelMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragMode || dragMode === "wind") return;
    const g = wheelGeometry(e.clientX, e.clientY);
    if (!g) return;
    if (dragMode === "outer") setStormFromAngle(g.ang);
    else if (dragMode === "inner") setFreqFromAngle(g.ang);
  };

  const onWheelUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragMode === "outer" || dragMode === "inner") setDragMode(null);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  };

  // Wind rose handlers.
  const windRoseRef = useRef<HTMLDivElement>(null);
  const setWindFromPointer = (clientX: number, clientY: number) => {
    const el = windRoseRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const ang = Math.atan2(clientY - cy, clientX - cx);
    windDirRef.current = ang;
    setWindAngleDisplay(ang);
    playWheelTone(180 + ((ang + Math.PI) / (Math.PI * 2)) * 260);
  };
  const onWindDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragMode("wind");
    setWindFromPointer(e.clientX, e.clientY);
    getFieldAudio().chime();
    haptics.chop();
    useField.getState().recordTape("region", 0.45, "storm/wind");
    addStormMark("wind", 0.5);
  };
  const onWindMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragMode !== "wind") return;
    setWindFromPointer(e.clientX, e.clientY);
  };
  const onWindUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragMode === "wind") setDragMode(null);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  };

  const toggleMaelstrom = () => {
    const next = !maelstromOn;
    setMaelstromOn(next);
    maelstromTargetRef.current = next ? 1 : 0;
    const audio = getFieldAudio();
    if (next) {
      audio.thud();
      window.setTimeout(() => audio.bell(), 220);
      haptics.storm();
      useField.getState().recordTape("ripple", 1.0, "storm/maelstrom");
      addStormMark("maelstrom", 1);
    } else {
      audio.chime();
      haptics.roll();
      addStormMark("release", 0.42);
    }
  };

  const stillTheSea = () => {
    calmRef.current = 1;
    calmStartedRef.current = performance.now();
    stormTargetRef.current = 0;
    freqTargetRef.current = 1.0;
    maelstromTargetRef.current = 0;
    setStormDisplay(0);
    setFreqDisplay(1.0);
    setMaelstromOn(false);
    const audio = getFieldAudio();
    audio.bell();
    haptics.roll();
    useField.getState().recordTape("ripple", 0.3, "storm/calm");
    addStormMark("calm", 0.28);
  };

  const ampPct = Math.round(stormDisplay * 100);
  const freqPct = Math.round(((freqDisplay - 0.4) / 1.8) * 100);
  const outerRot = stormDisplay * 360;
  const innerRot = ((freqDisplay - 0.4) / 1.8) * 360;
  const windRot = (windAngleDisplay * 180) / Math.PI;

  return (
    <div
      ref={wrapRef}
      data-touch-surface="true"
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        background: "#0e2540",
      }}
    >
      <canvas
        ref={waterRef}
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
      />
      <canvas
        ref={linesRef}
        aria-label="the storm — click the sea, turn the wheel"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          display: "block",
          touchAction: "none",
          cursor: "crosshair",
          WebkitUserSelect: "none",
          userSelect: "none",
          WebkitTouchCallout: "none",
        }}
      />

      {/* Lightning flash overlay */}
      <div
        ref={flashRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(255, 255, 255, 1)",
          opacity: 0,
          transition: "opacity 240ms ease-out",
          pointerEvents: "none",
        }}
      />

      {/* ── title block ───────────────────────────────────────── */}
      <div
        className="storm-title"
        style={{
          position: "fixed",
          top: 80,
          left: "var(--pad-x)",
          color: "rgba(244, 248, 255, 0.95)",
          pointerEvents: "none",
          maxWidth: 520,
          WebkitUserSelect: "none",
          userSelect: "none",
        }}
      >
        <div
          className="t-eyebrow"
          style={{
            color: "rgba(244, 248, 255, 0.50)",
            marginBottom: 14,
          }}
        >
          calm &harr; storm &middot; turn the wheel
        </div>
        <WaterText
          as="h1"
          bobAmp={0}
          style={{
            display: "block",
            margin: 0,
            fontFamily: "var(--font-serif)",
            fontWeight: 500,
            fontSize: "clamp(48px, 7vw, 96px)",
            lineHeight: 1.0,
            letterSpacing: "-0.018em",
          }}
        >
          STORM
        </WaterText>
        <WaterText
          as="div"
          bobAmp={2}
          style={{
            display: "block",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontWeight: 300,
            fontSize: "clamp(18px, 2.2vw, 26px)",
            color: "rgba(244, 248, 255, 0.78)",
            marginTop: 6,
            letterSpacing: "0.002em",
          }}
        >
          the wave allowed to rage
        </WaterText>
        <div
          className="storm-mark-ribbon"
          aria-hidden="true"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "7px 10px",
            marginTop: 14,
            maxWidth: 420,
            fontFamily: "var(--font-text)",
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "lowercase",
            color: "rgba(244, 248, 255, 0.64)",
          }}
        >
          {stormMarks.map((mark) => (
            <span
              key={mark.id}
              style={{
                opacity: 0.45 + mark.level * 0.45,
                borderBottom: "1px solid rgba(244,248,255,0.22)",
              }}
            >
              {mark.label}
            </span>
          ))}
        </div>
      </div>

      {/* ── wind rose (top right) ───────────────────────────── */}
      <div
        className="storm-wind-rose"
        ref={windRoseRef}
        role="slider"
        aria-label="wind direction"
        aria-valuemin={-180}
        aria-valuemax={180}
        aria-valuenow={Math.round(windRot)}
        onPointerDown={onWindDown}
        onPointerMove={onWindMove}
        onPointerUp={onWindUp}
        onPointerCancel={onWindUp}
        style={{
          position: "fixed",
          top: 90,
          right: 32,
          width: 88,
          height: 88,
          borderRadius: "50%",
          border: "1px solid rgba(244,248,255,0.30)",
          background: "rgba(20, 30, 50, 0.45)",
          cursor: "grab",
          touchAction: "none",
          WebkitUserSelect: "none",
          userSelect: "none",
          WebkitTouchCallout: "none",
        }}
      >
        <svg viewBox="-50 -50 100 100" width="88" height="88" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          {["N", "E", "S", "W"].map((dir, i) => {
            const a = (i * Math.PI) / 2 - Math.PI / 2;
            const x = Math.cos(a) * 38;
            const y = Math.sin(a) * 38;
            return (
              <text key={dir} x={x} y={y + 3} fill="rgba(244,248,255,0.55)" textAnchor="middle"
                fontSize={9} fontFamily="var(--font-serif)" fontStyle="italic">
                {dir}
              </text>
            );
          })}
          <g style={{ transform: `rotate(${windRot}deg)`, transformOrigin: "0 0", transition: "transform 80ms linear" }}>
            <line x1={-22} y1={0} x2={26} y2={0} stroke="rgba(244,248,255,0.95)" strokeWidth={1.4} />
            <polygon points="26,0 18,-4 18,4" fill="rgba(244,248,255,0.95)" />
            <circle cx={0} cy={0} r={3} fill="rgba(244,248,255,0.95)" />
          </g>
        </svg>
      </div>

      {/* ── ship's wheel (bottom center) ─────────────────────── */}
      <div
        className="storm-wheel-panel"
        style={{
          position: "fixed",
          left: "50%",
          bottom: 56,
          transform: "translateX(-50%)",
          color: "rgba(244, 248, 255, 0.88)",
          pointerEvents: "auto",
          userSelect: "none",
          WebkitUserSelect: "none",
          WebkitTouchCallout: "none",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div
          className="storm-readout"
          style={{
            display: "flex",
            gap: 24,
            fontFamily: "var(--font-numerals)",
            fontSize: 14,
            letterSpacing: "0.06em",
            color: "rgba(244, 248, 255, 0.78)",
            fontFeatureSettings: '"tnum"',
            textTransform: "lowercase",
          }}
        >
          <span>amp {ampPct}%</span>
          <span>speed {freqPct}%</span>
        </div>

        <div
          className="storm-wheel"
          ref={wheelRef}
          role="group"
          aria-label="storm wheel — outer ring is amplitude, inner ring is speed"
          onPointerDown={onWheelDown}
          onPointerMove={onWheelMove}
          onPointerUp={onWheelUp}
          onPointerCancel={onWheelUp}
          style={{
            position: "relative",
            width: 220,
            height: 220,
            touchAction: "none",
            cursor: dragMode === "outer" || dragMode === "inner" ? "grabbing" : "grab",
          }}
        >
          <svg viewBox="-110 -110 220 220" width={220} height={220} style={{ position: "absolute", inset: 0 }}>
            {/* outer ring — amplitude */}
            <circle cx={0} cy={0} r={100} fill="rgba(20,30,50,0.35)" stroke="rgba(244,248,255,0.30)" strokeWidth={1} />
            {Array.from({ length: 24 }).map((_, i) => {
              const a = (i / 24) * Math.PI * 2 - Math.PI / 2;
              const x1 = Math.cos(a) * 88;
              const y1 = Math.sin(a) * 88;
              const x2 = Math.cos(a) * 100;
              const y2 = Math.sin(a) * 100;
              return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
                stroke="rgba(244,248,255,0.40)" strokeWidth={1} />;
            })}
            <g style={{ transform: `rotate(${outerRot}deg)`, transformOrigin: "0 0", transition: dragMode === "outer" ? "none" : "transform 80ms linear" }}>
              <polygon points="0,-100 -6,-86 6,-86" fill="rgba(244,248,255,0.95)" />
              <circle cx={0} cy={-94} r={3} fill="rgba(244,248,255,0.95)" />
            </g>
            {/* inner ring — speed */}
            <circle cx={0} cy={0} r={62} fill="rgba(20,30,50,0.55)" stroke="rgba(244,248,255,0.35)" strokeWidth={1} />
            {Array.from({ length: 8 }).map((_, i) => {
              const a = (i / 8) * Math.PI * 2;
              const x1 = Math.cos(a) * 36;
              const y1 = Math.sin(a) * 36;
              const x2 = Math.cos(a) * 60;
              const y2 = Math.sin(a) * 60;
              return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
                stroke="rgba(244,248,255,0.45)" strokeWidth={1.4} strokeLinecap="round" />;
            })}
            <g style={{ transform: `rotate(${innerRot}deg)`, transformOrigin: "0 0", transition: dragMode === "inner" ? "none" : "transform 80ms linear" }}>
              <line x1={0} y1={-58} x2={0} y2={-32} stroke="rgba(244,248,255,0.95)" strokeWidth={1.6} />
              <circle cx={0} cy={-58} r={3} fill="rgba(244,248,255,0.95)" />
            </g>
            <circle cx={0} cy={0} r={18} fill="rgba(20,30,50,0.95)" stroke="rgba(244,248,255,0.50)" strokeWidth={1.2} />
            <text x={0} y={3} fill="rgba(244,248,255,0.65)" textAnchor="middle"
              fontSize={10} fontStyle="italic" fontFamily="var(--font-serif)">
              wheel
            </text>
          </svg>
        </div>

        <div className="storm-actions" style={{ display: "flex", gap: 12, marginTop: 4 }}>
          <button
            onClick={toggleMaelstrom}
            aria-pressed={maelstromOn}
            style={{
              minHeight: 44,
              minWidth: 44,
              padding: "10px 14px",
              background: maelstromOn ? "rgba(244,248,255,0.92)" : "transparent",
              color: maelstromOn ? "rgba(14,37,64,1)" : "rgba(244,248,255,0.85)",
              border: "1px solid rgba(244,248,255,0.55)",
              borderRadius: 3,
              cursor: "pointer",
              fontFamily: "var(--font-text)",
              fontSize: 12,
              letterSpacing: "0.10em",
              textTransform: "lowercase",
              touchAction: "manipulation",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            maelstrom
          </button>
          <button
            onClick={stillTheSea}
            style={{
              minHeight: 44,
              minWidth: 44,
              padding: "10px 14px",
              background: "transparent",
              color: "rgba(244,248,255,0.85)",
              border: "1px solid rgba(244,248,255,0.55)",
              borderRadius: 3,
              cursor: "pointer",
              fontFamily: "var(--font-text)",
              fontSize: 12,
              letterSpacing: "0.10em",
              textTransform: "lowercase",
              touchAction: "manipulation",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            still the sea
          </button>
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html:
            `
            @media (max-width: 700px) {
              .storm-title {
                top: 76px !important;
                left: 18px !important;
                max-width: calc(100vw - 124px) !important;
              }
              .storm-title .t-eyebrow {
                margin-bottom: 8px !important;
                font-size: 10px !important;
              }
              .storm-title h1 {
                font-size: 52px !important;
                letter-spacing: 0 !important;
              }
              .storm-title [style*="italic"] {
                font-size: 16px !important;
                line-height: 1.1 !important;
              }
              .storm-mark-ribbon {
                margin-top: 8px !important;
                gap: 5px 8px !important;
                font-size: 10px !important;
                max-width: 210px !important;
              }
              .storm-wind-rose {
                top: 84px !important;
                right: 16px !important;
                width: 68px !important;
                height: 68px !important;
              }
              .storm-wind-rose svg {
                width: 68px !important;
                height: 68px !important;
              }
              .storm-wheel-panel {
                bottom: calc(54px + env(safe-area-inset-bottom, 0px)) !important;
                gap: 6px !important;
              }
              .storm-readout {
                gap: 14px !important;
                font-size: 12px !important;
              }
              .storm-wheel {
                width: 150px !important;
                height: 150px !important;
              }
              .storm-wheel svg {
                width: 150px !important;
                height: 150px !important;
              }
              .storm-actions {
                gap: 8px !important;
                margin-top: 0 !important;
              }
              .storm-actions button {
                min-height: 40px !important;
                padding: 8px 10px !important;
                font-size: 11px !important;
                max-width: 124px;
                white-space: normal;
              }
              .storm-chart-stack {
                display: none !important;
              }
            }
            @media (max-width: 700px) and (max-height: 740px) {
              .storm-title h1 {
                font-size: 44px !important;
              }
              .storm-mark-ribbon {
                max-width: 190px !important;
              }
              .storm-wheel {
                width: 132px !important;
                height: 132px !important;
              }
              .storm-wheel svg {
                width: 132px !important;
                height: 132px !important;
              }
              .storm-actions button {
                min-height: 38px !important;
                padding: 7px 9px !important;
              }
            }
            `,
        }}
      />

      {/* ── SeaChart embeds (kept from prior visuals) ──────────── */}
      <div
        className="storm-chart-stack"
        style={{
          position: "fixed",
          left: 24,
          bottom: 56,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          pointerEvents: "auto",
          zIndex: 5,
        }}
      >
        <SeaChart
          variant="inline"
          mode="candles"
          title="storm — last 30s"
          caption="drag a candle to nudge the sea"
          width={280}
          height={100}
          tickMs={0}
          source={stormSource}
          pullKey={chartPullKey}
          static
          feedToOcean
          tapeLabel="storm/chart"
          upColor="#7CC4FF"
          downColor="#FF8A78"
          background="rgba(14, 37, 64, 0.62)"
        />
        <SeaChart
          variant="inline"
          mode="oscillator"
          title="osc · above/below calm"
          caption="zero at 0.5"
          width={280}
          height={56}
          tickMs={0}
          source={stormSource}
          pullKey={chartPullKey}
          static
          feedToOcean={false}
          tapeLabel="storm/osc"
          upColor="#7CC4FF"
          downColor="#FF8A78"
          background="rgba(14, 37, 64, 0.62)"
        />
      </div>
    </div>
  );
}
