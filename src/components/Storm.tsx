"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { useField } from "@/store/field";

/**
 * /storm — a PRESSURE + ELECTRICITY instrument.
 *
 * The WebGL sea is the churning body. Two coupled forces drive it:
 *
 *   PRESSURE  — a barometric dial. Drop the needle toward LOW and the sea
 *               rages, wind rises, the sky thickens and darkens. Raise it
 *               toward HIGH and everything calms.
 *   CHARGE    — drag across the sky to accumulate static charge. It glows
 *               up the meter and crackles as filaments flicker between the
 *               cloud base and the sea. Cross the threshold — or tap to
 *               release — and it DISCHARGES: a branching forked bolt, a
 *               screen flash, a heavy haptic, then THUNDER delayed by the
 *               strike's distance. Charge resets and the sea surges.
 *
 * "eye" collapses the sea into a vortex; "clear sky" raises the barometer
 * to fair and stills the water to glass.
 */
export default function Storm() {
  // page-specific ambient bed: storm crash + wind hiss
  useEffect(() => { getFieldAudio().setAmbientProfile("storm"); }, []);

  const wrapRef = useRef<HTMLDivElement>(null);
  const waterRef = useRef<HTMLCanvasElement>(null);
  const linesRef = useRef<HTMLCanvasElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);

  // barometric pressure — 1 = high / fair, 0 = deep low / rage.
  const pressureRef = useRef<number>(0.62);
  // derived storm intensity (eased toward 1 - pressure).
  const stormRef = useRef<number>(0.38);
  const stormTargetRef = useRef<number>(0.38);
  // frequency / cadence, eased; falls out of pressure.
  const freqRef = useRef<number>(1.0);
  // transient surge added on strikes / crest kicks.
  const stormSpikeRef = useRef<number>(0);
  // accumulated static charge 0..1, plus a smoothed value for shader/meter.
  const chargeRef = useRef<number>(0);
  const chargeVisualRef = useRef<number>(0);
  const lastStrikeXFracRef = useRef<number>(0.5);

  const manualCrestsRef = useRef<Array<{ x: number; t0: number; strength: number }>>([]);
  const frontWaveRef = useRef<{ xs: number[]; ys: number[]; w: number; h: number } | null>(null);
  const fujiHaloRef = useRef<{ t0: number } | null>(null);
  const windStreaksRef = useRef<Array<{ t0: number; y: number; vx: number; len: number; alpha: number }>>([]);
  // maelstrom strength 0..1 — smoothly tweens between linear and spiral.
  const maelstromRef = useRef<number>(0);
  const maelstromTargetRef = useRef<number>(0);
  // wind direction in radians (0 = right, π/2 = down).
  const windDirRef = useRef<number>(0);
  // calm scalar — when "clear sky" is pressed, ramps amp toward 0.
  const calmRef = useRef<number>(0);
  const calmStartedRef = useRef<number>(0);
  // forked lightning bolt currently on screen.
  type BoltSeg = { x0: number; y0: number; x1: number; y1: number; main: boolean };
  const lightningRef = useRef<{
    t0: number; life: number; segments: BoltSeg[]; intensity: number; hitX: number; hitY: number;
  } | null>(null);
  const lastLightningAt = useRef<number>(0);
  // bridge so React controls can trigger a discharge defined inside the loop.
  const dischargeRef = useRef<(() => void) | null>(null);

  const [pressureDisplay, setPressureDisplay] = useState(0.62);
  const [chargeDisplay, setChargeDisplay] = useState(0);
  const [maelstromOn, setMaelstromOn] = useState(false);
  const [dragMode, setDragMode] = useState<null | "baro" | "wind">(null);
  const [windAngleDisplay, setWindAngleDisplay] = useState(0);
  const lastDialToneAt = useRef(0);

  const playDialTone = useCallback((freq: number) => {
    const now = performance.now();
    if (now - lastDialToneAt.current < 150) return;
    lastDialToneAt.current = now;
    try { getFieldAudio().playTone(freq, 0.055); } catch { /* noop */ }
    try { haptics.tap(); } catch { /* noop */ }
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    const water = waterRef.current;
    const lines = linesRef.current;
    if (!wrap || !water || !lines) return;
    const lctx = lines.getContext("2d");
    if (!lctx) return;

    const SEA_TOP = 0.30;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const motion = reduce ? 0 : 1;
    if (reduce) {
      pressureRef.current = Math.max(pressureRef.current, 0.72);
      stormRef.current = Math.min(stormRef.current, 0.3);
      stormTargetRef.current = stormRef.current;
      setPressureDisplay(pressureRef.current);
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
    let uChargeLoc: WebGLUniformLocation | null = null;

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
        uniform float uCharge;
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
          vec3 skyStorm = vec3(0.32, 0.36, 0.45);
          vec3 sky = mix(skyCalm, skyMid, smoothstep(0.0, 0.55, s));
          sky = mix(sky, skyStorm, smoothstep(0.55, 1.0, s));
          float skyV = uv.y / seaTop;
          sky = mix(sky, sky * 0.92, smoothstep(0.6, 1.0, skyV));

          // cloud thickening: churning fbm shadow that deepens as pressure drops.
          float clouds = fbm(vec2(uv.x * 3.2 + t * 0.05, uv.y * 5.0 - t * 0.02));
          sky -= clouds * (0.05 + s * 0.30) * (1.0 - skyV) * vec3(0.7, 0.72, 0.8);

          // electric potential: violet shimmer building at the cloud base.
          float band = smoothstep(0.35, 1.0, skyV);
          float flick = vnoise(vec2(uv.x * 9.0, t * 7.0)) * vnoise(vec2(uv.x * 2.0 - t, 3.0));
          sky += uCharge * band * (0.10 + 0.55 * flick) * vec3(0.55, 0.60, 0.95);

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

          // charge reflection glinting on the near water.
          sea += uCharge * caustic * 0.10 * surfMask * vec3(0.6, 0.66, 0.95);

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
            uChargeLoc = gl.getUniformLocation(p, "uCharge");

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

    const FUJI_HIT_PADDING = 8;
    const isOnFuji = (x: number, y: number): boolean => {
      const wEl = lines.clientWidth;
      const hEl = lines.clientHeight;
      const fujiCenterX = wEl * 0.34;
      const fujiBaseY = hEl * SEA_TOP;
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

    // ── forked lightning generator ────────────────────────────────
    const buildBolt = (
      x0: number, y0: number, x1: number, y1: number,
      gen: number, disp: number, main: boolean, out: BoltSeg[],
    ) => {
      const dx = x1 - x0;
      const dy = y1 - y0;
      if (gen <= 0 || dx * dx + dy * dy < 64) {
        out.push({ x0, y0, x1, y1, main });
        return;
      }
      const mx = (x0 + x1) / 2 + (Math.random() - 0.5) * disp;
      const my = (y0 + y1) / 2 + (Math.random() - 0.5) * disp * 0.35;
      buildBolt(x0, y0, mx, my, gen - 1, disp * 0.58, main, out);
      buildBolt(mx, my, x1, y1, gen - 1, disp * 0.58, main, out);
      if (gen > 1 && Math.random() < 0.42) {
        const bl = 0.5 + Math.random() * 0.7;
        const bx = mx + dx * bl * 0.5 + (Math.random() - 0.5) * disp * 1.2;
        const by = my + Math.abs(dy) * bl * 0.5 + Math.random() * disp * 0.4;
        buildBolt(mx, my, bx, by, gen - 2, disp * 0.5, false, out);
      }
    };

    const dischargeAt = (sxFrac: number) => {
      const now = performance.now();
      const cur = lightningRef.current;
      if (cur && now - cur.t0 < 130) return;
      const w = lines.clientWidth;
      const h = lines.clientHeight;
      const charge = Math.max(0.28, chargeRef.current);
      const intensity = 0.5 + charge * 0.55;
      const x0 = sxFrac * w + (Math.random() - 0.5) * w * 0.04;
      const y0 = h * 0.015;
      const seaTopPx = h * SEA_TOP;
      const hitY = seaTopPx + h * (0.03 + Math.random() * 0.10);
      const hitX = x0 + (Math.random() - 0.5) * w * 0.10;
      const segments: BoltSeg[] = [];
      buildBolt(x0, y0, hitX, hitY, 6, w * 0.12, true, segments);
      lightningRef.current = { t0: now, life: 0.42, segments, intensity, hitX, hitY };
      lastLightningAt.current = now;

      // sea surges where it strikes
      stormSpikeRef.current = Math.min(0.5, stormSpikeRef.current + 0.22 * charge);
      manualCrestsRef.current.push({ x: hitX, t0: now, strength: 30 * charge });
      if (manualCrestsRef.current.length > 12) manualCrestsRef.current.shift();
      spawnBurst(hitX, seaTopPx + 4, Math.round(16 + charge * 24), 240);

      // screen flash (dimmed under reduced motion)
      const fl = flashRef.current;
      if (fl) {
        fl.style.opacity = String((0.55 * intensity + 0.22) * (reduce ? 0.25 : 1));
        window.setTimeout(() => { if (fl) fl.style.opacity = "0"; }, 110);
      }

      try { haptics.storm(); } catch { /* noop */ }
      try { audio.spark(); } catch { /* noop */ }

      // thunder delayed by distance from the viewer (screen centre)
      const dist = Math.abs(sxFrac - 0.5) * 2;
      const delay = 90 + dist * 300 + (1 - charge) * 240;
      window.setTimeout(() => {
        try {
          audio.playTone(46 + Math.random() * 12, 1.15);
          audio.playTone(74, 0.7);
          audio.thud();
        } catch { /* noop */ }
      }, delay);

      useField.getState().recordTape("ripple", 1.0, "storm/strike");
      chargeRef.current = 0;
      lastStrikeXFracRef.current = sxFrac;
    };
    dischargeRef.current = () => dischargeAt(lastStrikeXFracRef.current);

    // ── pointer interaction on the sea / sky ──────────────────────
    let seaDragging = false;
    let lastDragAt = 0;
    let lastDragX = -1;
    let lastDragY = -1;

    let skyCharging = false;
    let skyStartT = 0;
    let skyMoved = 0;
    let skyLastX = 0;
    let skyLastSound = 0;

    const spawnWindStreak = (y: number, strong: boolean) => {
      if (reduce) return;
      const goesRight = Math.random() < 0.6;
      windStreaksRef.current.push({
        t0: performance.now(),
        y,
        vx: (goesRight ? 1 : -1) * (90 + Math.random() * 90 + (strong ? 60 : 0)),
        len: 60 + Math.random() * 50,
        alpha: strong ? 0.6 : 0.4,
      });
      if (windStreaksRef.current.length > 12) windStreaksRef.current.shift();
    };

    const onPointerDown = (e: PointerEvent) => {
      const r = lines.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const seaTopPx = lines.clientHeight * SEA_TOP;

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
        try { audio.spark(); } catch { /* noop */ }
        try { haptics.ripple(0.25); } catch { /* noop */ }
        return;
      }

      if (isOnFuji(x, y)) {
        fujiHaloRef.current = { t0: performance.now() };
        try { audio.chime(); } catch { /* noop */ }
        try { haptics.roll(); } catch { /* noop */ }
        useField.getState().recordTape("object", 0.7, "storm/peak");
        return;
      }

      // SKY — accumulate charge on drag, discharge on tap.
      if (y < seaTopPx) {
        skyCharging = true;
        skyStartT = performance.now();
        skyMoved = 0;
        skyLastX = x;
        skyLastSound = 0;
        lastStrikeXFracRef.current = x / Math.max(1, lines.clientWidth);
        spawnWindStreak(y, false);
        try { audio.spark(); } catch { /* noop */ }
        try { haptics.tap(); } catch { /* noop */ }
        try { lines.setPointerCapture(e.pointerId); } catch { /* noop */ }
        return;
      }

      // SEA — bump crests, kick spray.
      manualCrestsRef.current.push({ x, t0: performance.now(), strength: 28 });
      if (manualCrestsRef.current.length > 12) manualCrestsRef.current.shift();

      const crestD = crestHitDistance(x, y);
      if (crestD < 24) {
        spawnBurst(x, y, 14, 220);
        try { audio.thud(); } catch { /* noop */ }
        try { haptics.storm(); } catch { /* noop */ }
        stormSpikeRef.current = Math.min(0.4, stormSpikeRef.current + 0.05);
        useField.getState().recordTape("ripple", 1.0, "storm/crest");
      } else {
        try { haptics.ripple(0.5); } catch { /* noop */ }
        useField.getState().recordTape("ripple", 0.9, "storm/sea");
      }

      seaDragging = true;
      lastDragX = x;
      lastDragY = y;
      lastDragAt = 0;
      try { lines.setPointerCapture(e.pointerId); } catch { /* noop */ }
    };

    const onPointerMove = (e: PointerEvent) => {
      const r = lines.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const w = lines.clientWidth;
      const seaTopPx = lines.clientHeight * SEA_TOP;

      if (skyCharging) {
        const dx = Math.abs(x - skyLastX);
        skyMoved += dx;
        skyLastX = x;
        lastStrikeXFracRef.current = x / Math.max(1, w);
        chargeRef.current = Math.min(1, chargeRef.current + dx / Math.max(1, w) * 0.95);
        const nowMs = performance.now();
        if (nowMs - skyLastSound > 150) {
          skyLastSound = nowMs;
          const cq = chargeRef.current;
          try { audio.playTone(360 + cq * 1000, 0.03); } catch { /* noop */ }
          if (Math.random() < 0.4) spawnWindStreak(y, cq > 0.6);
          try { haptics.ripple(0.12 + cq * 0.22); } catch { /* noop */ }
          useField.getState().recordTape("sigil", 0.2 + cq * 0.5, "storm/charge");
        }
        return;
      }

      if (!seaDragging) return;
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
          try { audio.chime(); } catch { /* noop */ }
          try { haptics.chop(); } catch { /* noop */ }
          lastDragAt = nowMs;
        }
      }
      lastDragX = x; lastDragY = y;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (skyCharging) {
        skyCharging = false;
        const tap = skyMoved < 16 && performance.now() - skyStartT < 340;
        if (tap) {
          if (chargeRef.current > 0.12) {
            dischargeAt(lastStrikeXFracRef.current);
          } else {
            chargeRef.current = Math.min(1, chargeRef.current + 0.16);
            try { audio.spark(); } catch { /* noop */ }
          }
        }
      }
      seaDragging = false;
      try { lines.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    };

    lines.addEventListener("pointerdown", onPointerDown);
    lines.addEventListener("pointermove", onPointerMove);
    lines.addEventListener("pointerup", onPointerUp);
    lines.addEventListener("pointercancel", onPointerUp);

    const t0 = performance.now();
    let raf = 0;
    let lastUiSync = 0;

    const draw = (now: number) => {
      const w = lines.clientWidth;
      const h = lines.clientHeight;

      stormSpikeRef.current *= 0.985;
      if (stormSpikeRef.current < 0.001) stormSpikeRef.current = 0;

      // pressure → storm target. Low pressure rages the sea.
      const pressure = reduce ? Math.max(pressureRef.current, 0.72) : pressureRef.current;
      stormTargetRef.current = 1 - pressure;

      // calm scalar — ease amplitude toward 0 over ~2s when "clear sky" pressed.
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

      const dialTarget = reduce ? Math.min(stormTargetRef.current, 0.3) : stormTargetRef.current;
      const target = Math.min(1, dialTarget + stormSpikeRef.current) * calmFactor;
      stormRef.current += (target - stormRef.current) * 0.10;
      const s = stormRef.current;

      // cadence follows pressure; maelstrom eases toward target.
      const freqTarget = 0.6 + (1 - pressure) * 1.2;
      freqRef.current += (freqTarget - freqRef.current) * 0.08;
      const freqMulDial = freqRef.current;
      maelstromRef.current += (maelstromTargetRef.current - maelstromRef.current) * 0.06;
      const ml = maelstromRef.current;

      // charge slowly leaks; smoothed value drives shader + meter.
      if (!skyCharging) chargeRef.current = Math.max(0, chargeRef.current - 0.0016);
      chargeVisualRef.current += (chargeRef.current - chargeVisualRef.current) * 0.18;
      const cq = chargeVisualRef.current;

      // auto-discharge when charge saturates.
      if (chargeRef.current >= 1 && !lightningRef.current) {
        dischargeAt(lastStrikeXFracRef.current);
      }

      let flashAdd = 0;
      if (lightningRef.current) {
        const age = (now - lightningRef.current.t0) / 1000;
        if (age > lightningRef.current.life) {
          lightningRef.current = null;
        } else {
          const v = Math.max(0, 1 - age / lightningRef.current.life);
          flashAdd = v * v * lightningRef.current.intensity * (reduce ? 0.2 : 0.7);
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
        if (uChargeLoc) gl.uniform1f(uChargeLoc, cq);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } else {
        const wctx = water.getContext("2d");
        if (wctx) {
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          const skyMix = (1 - s);
          wctx.fillStyle = `rgba(${Math.round(80 + skyMix * 160)},${Math.round(96 + skyMix * 144)},${Math.round(120 + skyMix * 110)},1)`;
          wctx.fillRect(0, 0, w, h * SEA_TOP);
          if (cq > 0.05) {
            wctx.fillStyle = `rgba(150, 165, 245, ${cq * 0.18})`;
            wctx.fillRect(0, h * SEA_TOP * 0.5, w, h * SEA_TOP * 0.5);
          }
          const g = wctx.createLinearGradient(0, h * SEA_TOP, 0, h);
          g.addColorStop(0.00, "rgba( 42, 90,140, 1.0)");
          g.addColorStop(0.55, "rgba( 27, 58,100, 1.0)");
          g.addColorStop(1.00, "rgba( 14, 37, 64, 1.0)");
          wctx.fillStyle = g;
          wctx.fillRect(0, h * SEA_TOP, w, h - h * SEA_TOP);
          if (flashAdd > 0.01) {
            wctx.fillStyle = `rgba(255,255,255,${Math.min(0.7, flashAdd)})`;
            wctx.fillRect(0, 0, w, h);
          }
        }
      }

      lctx.clearRect(0, 0, w, h);

      // ── Mt Fuji ───────────────────────────────────────────────
      const fujiCenterX = w * 0.34;
      const fujiBaseY = h * SEA_TOP;
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
      lctx.moveTo(0, h * SEA_TOP);
      lctx.lineTo(w, h * SEA_TOP);
      lctx.stroke();

      // ambient wind rising as pressure drops.
      if (!reduce && s > 0.32 && Math.random() < (s - 0.28) * 0.05) {
        spawnWindStreak(Math.random() * h * SEA_TOP * 0.9, s > 0.7);
      }

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

      // ── charge filaments: flickering potential at the cloud base ──
      if (cq > 0.05 && !lightningRef.current) {
        const seaTopPx = h * SEA_TOP;
        lctx.save();
        lctx.globalCompositeOperation = "screen";
        lctx.lineCap = "round";
        const filaments = Math.round(2 + cq * 7);
        for (let i = 0; i < filaments; i++) {
          if (Math.random() > 0.55) continue;
          const fx = ((i + 0.5) / filaments) * w + Math.sin(now * 0.004 + i * 1.7) * 26;
          const topY = seaTopPx - (14 + cq * 46) * (0.4 + Math.random() * 0.6);
          const a = cq * (0.2 + Math.random() * 0.5);
          lctx.strokeStyle = `rgba(178, 196, 255, ${a})`;
          lctx.lineWidth = 0.8 + cq;
          lctx.beginPath();
          let px = fx;
          let py = topY;
          lctx.moveTo(px, py);
          const steps = 4;
          for (let sIdx = 1; sIdx <= steps; sIdx++) {
            px = fx + (Math.random() - 0.5) * (10 + cq * 16);
            py = topY + ((seaTopPx + 6 - topY) * sIdx) / steps;
            lctx.lineTo(px, py);
          }
          lctx.stroke();
        }
        lctx.restore();
      }

      // ── wave layers ────────────────────────────────────────────
      const ampMul = 0.4 + s * 1.6;
      const freqMul = (1.0 + s * 0.6) * freqMulDial;

      const samples = 120;
      const step = w / samples;
      const breakThreshold = 0.85 - s * 0.30;
      const emitRate = s > 0.05 ? s * 120 : 0;
      const emitProbPerCrest = Math.min(0.65, emitRate / 90);

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

      // ── forked lightning bolt ──────────────────────────────────
      if (lightningRef.current) {
        const lb = lightningRef.current;
        const age = (now - lb.t0) / 1000;
        const k = Math.max(0, 1 - age / lb.life);
        const flick = 0.4 + 0.6 * Math.random();
        const a = Math.pow(k, 1.3) * flick * lb.intensity;
        lctx.save();
        lctx.globalCompositeOperation = "screen";
        lctx.lineCap = "round";
        lctx.lineJoin = "round";

        // soft glow underlay
        lctx.strokeStyle = `rgba(150, 178, 255, ${a * 0.32})`;
        lctx.lineWidth = 8;
        lctx.beginPath();
        for (const sg of lb.segments) {
          lctx.moveTo(sg.x0, sg.y0);
          lctx.lineTo(sg.x1, sg.y1);
        }
        lctx.stroke();

        // branches
        lctx.strokeStyle = `rgba(210, 224, 255, ${Math.min(1, a)})`;
        lctx.lineWidth = 1.1;
        lctx.beginPath();
        for (const sg of lb.segments) {
          if (sg.main) continue;
          lctx.moveTo(sg.x0, sg.y0);
          lctx.lineTo(sg.x1, sg.y1);
        }
        lctx.stroke();

        // bright main channel
        lctx.strokeStyle = `rgba(248, 250, 255, ${Math.min(1, a * 1.25)})`;
        lctx.lineWidth = 2.2;
        lctx.beginPath();
        for (const sg of lb.segments) {
          if (!sg.main) continue;
          lctx.moveTo(sg.x0, sg.y0);
          lctx.lineTo(sg.x1, sg.y1);
        }
        lctx.stroke();

        // impact glow on the sea
        const hitGrad = lctx.createRadialGradient(lb.hitX, lb.hitY, 0, lb.hitX, lb.hitY, 60 + a * 90);
        hitGrad.addColorStop(0, `rgba(220, 232, 255, ${a * 0.7})`);
        hitGrad.addColorStop(1, "rgba(220, 232, 255, 0)");
        lctx.fillStyle = hitGrad;
        lctx.beginPath();
        lctx.arc(lb.hitX, lb.hitY, 60 + a * 90, 0, Math.PI * 2);
        lctx.fill();
        lctx.restore();
      }

      if (!reduce && s > 0.7 && bigBreakCount > 0) {
        if (now - lastCrashAt > nextCrashGap) {
          try { audio.thud(); } catch { /* noop */ }
          lastCrashAt = now;
          nextCrashGap = 2000 + Math.random() * 2000;
        }
      }

      if (now - lastUiSync > 120) {
        lastUiSync = now;
        setChargeDisplay(chargeRef.current);
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
      dischargeRef.current = null;
    };
  }, []);

  // ── barometer dial handlers ──────────────────────────────────────
  const baroRef = useRef<HTMLDivElement>(null);

  const setPressureFromPointer = (clientX: number, clientY: number) => {
    const el = baroRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const ang = Math.atan2(clientY - cy, clientX - cx);
    let deg = (ang * 180) / Math.PI + 90; // up = 0, right = +90, left = -90
    if (deg > 180) deg -= 360;
    deg = Math.max(-120, Math.min(120, deg));
    let v = (deg + 120) / 240;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) v = Math.max(v, 0.72);
    pressureRef.current = v;
    setPressureDisplay(v);
    playDialTone(90 + v * 260);
  };

  const onBaroDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragMode("baro");
    setPressureFromPointer(e.clientX, e.clientY);
    useField.getState().recordTape("concern", 0.5, "storm/pressure");
  };
  const onBaroMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragMode !== "baro") return;
    setPressureFromPointer(e.clientX, e.clientY);
  };
  const onBaroUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragMode === "baro") setDragMode(null);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  };

  // ── wind rose handlers ───────────────────────────────────────────
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
    playDialTone(180 + ((ang + Math.PI) / (Math.PI * 2)) * 260);
  };
  const onWindDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragMode("wind");
    setWindFromPointer(e.clientX, e.clientY);
    try { getFieldAudio().chime(); } catch { /* noop */ }
    try { haptics.chop(); } catch { /* noop */ }
    useField.getState().recordTape("region", 0.45, "storm/wind");
  };
  const onWindMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragMode !== "wind") return;
    setWindFromPointer(e.clientX, e.clientY);
  };
  const onWindUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragMode === "wind") setDragMode(null);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  };

  const releaseCharge = () => {
    dischargeRef.current?.();
  };

  const toggleMaelstrom = () => {
    const next = !maelstromOn;
    setMaelstromOn(next);
    maelstromTargetRef.current = next ? 1 : 0;
    const a = getFieldAudio();
    if (next) {
      try { a.thud(); } catch { /* noop */ }
      window.setTimeout(() => { try { a.bell(); } catch { /* noop */ } }, 220);
      try { haptics.storm(); } catch { /* noop */ }
      useField.getState().recordTape("ripple", 1.0, "storm/eye");
    } else {
      try { a.chime(); } catch { /* noop */ }
      try { haptics.roll(); } catch { /* noop */ }
    }
  };

  const clearSky = () => {
    calmRef.current = 1;
    calmStartedRef.current = performance.now();
    pressureRef.current = 1;
    stormTargetRef.current = 0;
    maelstromTargetRef.current = 0;
    chargeRef.current = 0;
    setPressureDisplay(1);
    setChargeDisplay(0);
    setMaelstromOn(false);
    const a = getFieldAudio();
    try { a.bell(); } catch { /* noop */ }
    try { haptics.roll(); } catch { /* noop */ }
    useField.getState().recordTape("ripple", 0.3, "storm/clear");
  };

  const hPa = Math.round(960 + pressureDisplay * 80);
  const chargePct = Math.round(chargeDisplay * 100);
  const armed = chargeDisplay >= 0.85;
  const needleDeg = -120 + pressureDisplay * 240;
  const windRot = (windAngleDisplay * 180) / Math.PI;

  return (
    <div
      ref={wrapRef}
      className="storm-instrument"
      data-touch-surface="true"
      data-pretext-ignore="true"
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
        aria-label="storm — drop the barometer to rage the sea; drag the sky to build charge, then release lightning"
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
          background: "rgba(238, 244, 255, 1)",
          opacity: 0,
          transition: "opacity 220ms ease-out",
          pointerEvents: "none",
        }}
      />

      {/* ── quiet title ──────────────────────────────────────────── */}
      <div className="storm-title" aria-hidden="true">
        <span>pressure · charge · discharge</span>
        <strong>Storm</strong>
      </div>

      {/* ── wind rose (top right) ────────────────────────────────── */}
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

      {/* ── static charge meter (right) — tap to release ─────────── */}
      <button
        type="button"
        className={`storm-charge${armed ? " is-armed" : ""}`}
        onClick={releaseCharge}
        aria-label={`static charge ${chargePct} percent, tap to discharge`}
      >
        <span className="storm-charge-track">
          <span className="storm-charge-fill" style={{ height: `${chargePct}%` }} />
          <span className="storm-charge-thresh" />
        </span>
        <span className="storm-charge-label">{armed ? "release" : "charge"}</span>
      </button>

      {/* ── barometer + actions (bottom center) ──────────────────── */}
      <div className="storm-baro-panel">
        <div className="storm-readout">
          <span>{hPa} hPa</span>
          <span>charge {chargePct}%</span>
        </div>

        <div
          className="storm-baro"
          ref={baroRef}
          role="slider"
          aria-label="barometric pressure — drop toward low to rage the sea"
          aria-valuemin={960}
          aria-valuemax={1040}
          aria-valuenow={hPa}
          onPointerDown={onBaroDown}
          onPointerMove={onBaroMove}
          onPointerUp={onBaroUp}
          onPointerCancel={onBaroUp}
          style={{ cursor: dragMode === "baro" ? "grabbing" : "grab" }}
        >
          <svg viewBox="-110 -110 220 220" width={220} height={220} style={{ position: "absolute", inset: 0 }}>
            <circle cx={0} cy={0} r={100} fill="rgba(20,30,50,0.42)" stroke="rgba(244,248,255,0.28)" strokeWidth={1} />
            {/* gauge arc + ticks over the top 240° sweep */}
            {Array.from({ length: 25 }).map((_, i) => {
              const frac = i / 24;
              const deg = -120 + frac * 240;
              const a = ((deg - 90) * Math.PI) / 180;
              const inner = i % 4 === 0 ? 78 : 86;
              const x1 = Math.cos(a) * inner;
              const y1 = Math.sin(a) * inner;
              const x2 = Math.cos(a) * 98;
              const y2 = Math.sin(a) * 98;
              const lit = frac <= pressureDisplay;
              return (
                <line
                  key={i}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={lit ? "rgba(244,248,255,0.70)" : "rgba(244,248,255,0.24)"}
                  strokeWidth={i % 4 === 0 ? 1.6 : 1}
                />
              );
            })}
            <text x={-70} y={72} fill="rgba(255,180,170,0.72)" textAnchor="middle" fontSize={11}
              fontStyle="italic" fontFamily="var(--font-serif)">low</text>
            <text x={70} y={72} fill="rgba(170,210,255,0.72)" textAnchor="middle" fontSize={11}
              fontStyle="italic" fontFamily="var(--font-serif)">high</text>
            {/* needle */}
            <g style={{ transform: `rotate(${needleDeg}deg)`, transformOrigin: "0 0", transition: dragMode === "baro" ? "none" : "transform 90ms linear" }}>
              <line x1={0} y1={14} x2={0} y2={-84} stroke="rgba(244,248,255,0.96)" strokeWidth={2} strokeLinecap="round" />
              <polygon points="0,-96 -5,-82 5,-82" fill="rgba(244,248,255,0.96)" />
            </g>
            <circle cx={0} cy={0} r={22} fill="rgba(14,30,52,0.96)" stroke="rgba(244,248,255,0.46)" strokeWidth={1.2} />
            <text x={0} y={-2} fill="rgba(244,248,255,0.92)" textAnchor="middle" fontSize={15}
              fontFamily="var(--font-numerals)">{hPa}</text>
            <text x={0} y={12} fill="rgba(244,248,255,0.5)" textAnchor="middle" fontSize={8}
              fontFamily="var(--font-serif)" fontStyle="italic">hPa</text>
          </svg>
        </div>

        <div className="storm-actions">
          <button type="button" onClick={toggleMaelstrom} aria-pressed={maelstromOn} className={maelstromOn ? "is-on" : ""}>
            eye
          </button>
          <button type="button" onClick={clearSky}>
            clear sky
          </button>
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
            .storm-title {
              position: fixed;
              z-index: 3;
              top: 80px;
              left: var(--pad-x);
              pointer-events: none;
              -webkit-user-select: none;
              user-select: none;
            }
            .storm-title span {
              display: block;
              margin-bottom: 12px;
              color: rgba(244, 248, 255, 0.52);
              font-family: var(--font-text);
              font-size: 11px;
              letter-spacing: 0.04em;
              text-transform: lowercase;
            }
            .storm-title strong {
              display: block;
              color: rgba(246, 250, 255, 0.96);
              font-family: var(--font-serif);
              font-weight: 500;
              font-size: clamp(56px, 8vw, 112px);
              line-height: 0.9;
              letter-spacing: -0.02em;
            }

            .storm-wind-rose {
              position: fixed;
              z-index: 4;
              top: 90px;
              right: 32px;
              width: 88px;
              height: 88px;
              border-radius: 50%;
              border: 1px solid rgba(244,248,255,0.30);
              background: rgba(20, 30, 50, 0.45);
              backdrop-filter: blur(10px);
              -webkit-backdrop-filter: blur(10px);
              cursor: grab;
              touch-action: none;
              -webkit-user-select: none;
              user-select: none;
              -webkit-touch-callout: none;
            }

            .storm-charge {
              position: fixed;
              z-index: 4;
              top: 50%;
              right: 30px;
              transform: translateY(-50%);
              display: flex;
              flex-direction: column;
              align-items: center;
              gap: 8px;
              width: 46px;
              padding: 12px 8px;
              border: 1px solid rgba(244,248,255,0.20);
              border-radius: 10px;
              background: rgba(14, 28, 50, 0.5);
              backdrop-filter: blur(12px);
              -webkit-backdrop-filter: blur(12px);
              cursor: pointer;
              touch-action: manipulation;
              -webkit-tap-highlight-color: transparent;
            }
            .storm-charge-track {
              position: relative;
              width: 12px;
              height: 200px;
              border-radius: 999px;
              background: rgba(244,248,255,0.09);
              overflow: hidden;
              display: block;
            }
            .storm-charge-fill {
              position: absolute;
              left: 0;
              right: 0;
              bottom: 0;
              border-radius: 999px;
              background: linear-gradient(180deg, rgba(180,200,255,0.95), rgba(120,150,240,0.75));
              box-shadow: 0 0 14px rgba(150,180,255,0.55);
              transition: height 120ms linear;
            }
            .storm-charge-thresh {
              position: absolute;
              left: -3px;
              right: -3px;
              bottom: 85%;
              height: 1px;
              background: rgba(255,255,255,0.5);
            }
            .storm-charge-label {
              font-family: var(--font-text);
              font-size: 9px;
              letter-spacing: 0.06em;
              text-transform: lowercase;
              color: rgba(244,248,255,0.62);
            }
            .storm-charge.is-armed {
              border-color: rgba(190,210,255,0.7);
              box-shadow: 0 0 22px rgba(150,180,255,0.5);
            }
            .storm-charge.is-armed .storm-charge-fill {
              background: linear-gradient(180deg, rgba(235,242,255,1), rgba(170,195,255,0.9));
              box-shadow: 0 0 22px rgba(200,220,255,0.85);
            }
            .storm-charge.is-armed .storm-charge-label {
              color: rgba(246,250,255,0.95);
            }

            .storm-baro-panel {
              position: fixed;
              z-index: 4;
              left: 50%;
              bottom: 48px;
              transform: translateX(-50%);
              display: flex;
              flex-direction: column;
              align-items: center;
              gap: 12px;
              color: rgba(244, 248, 255, 0.88);
              -webkit-user-select: none;
              user-select: none;
              -webkit-touch-callout: none;
            }
            .storm-readout {
              display: flex;
              gap: 24px;
              font-family: var(--font-numerals);
              font-size: 14px;
              letter-spacing: 0.04em;
              color: rgba(244, 248, 255, 0.78);
              font-feature-settings: "tnum";
              text-transform: lowercase;
            }
            .storm-baro {
              position: relative;
              width: 220px;
              height: 220px;
              touch-action: none;
            }
            .storm-actions {
              display: flex;
              gap: 12px;
              margin-top: 2px;
            }
            .storm-actions button {
              min-height: 44px;
              min-width: 44px;
              padding: 10px 16px;
              background: transparent;
              color: rgba(244,248,255,0.85);
              border: 1px solid rgba(244,248,255,0.5);
              border-radius: 4px;
              cursor: pointer;
              font-family: var(--font-text);
              font-size: 12px;
              letter-spacing: 0.10em;
              text-transform: lowercase;
              touch-action: manipulation;
              -webkit-tap-highlight-color: transparent;
            }
            .storm-actions button.is-on {
              background: rgba(244,248,255,0.92);
              color: rgba(14,37,64,1);
            }

            body:has(.storm-instrument) header { display: none !important; }
            body:has(.storm-instrument) .oda-field-watch,
            body:has(.storm-instrument) .oda-candle-mark,
            body:has(.storm-instrument) .oda-tape-shell,
            body:has(.storm-instrument) .oda-sound-toggle { display: none !important; }
            body:has(.storm-instrument) { overflow: hidden; background: #0e2540; }

            @media (max-width: 700px) {
              .storm-title {
                top: 72px !important;
                left: 18px !important;
              }
              .storm-title span { margin-bottom: 8px !important; font-size: 10px !important; }
              .storm-title strong { font-size: 60px !important; }
              .storm-wind-rose {
                top: 78px !important;
                right: 16px !important;
                width: 64px !important;
                height: 64px !important;
              }
              .storm-wind-rose svg { width: 64px !important; height: 64px !important; }
              .storm-charge {
                right: 14px !important;
                width: 40px !important;
                padding: 10px 6px !important;
              }
              .storm-charge-track { height: 150px !important; }
              .storm-baro-panel {
                bottom: calc(44px + env(safe-area-inset-bottom, 0px)) !important;
                gap: 8px !important;
              }
              .storm-readout { gap: 16px !important; font-size: 12px !important; }
              .storm-baro { width: 156px !important; height: 156px !important; }
              .storm-baro svg { width: 156px !important; height: 156px !important; }
              .storm-actions button { padding: 9px 12px !important; font-size: 11px !important; }
            }
            @media (max-width: 700px) and (max-height: 740px) {
              .storm-title strong { font-size: 50px !important; }
              .storm-baro { width: 138px !important; height: 138px !important; }
              .storm-baro svg { width: 138px !important; height: 138px !important; }
              .storm-charge-track { height: 120px !important; }
            }
          `,
        }}
      />
    </div>
  );
}
