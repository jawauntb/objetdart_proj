"use client";

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
  onVisibility,
  onGalleryPause,
  resolveDpr,
  createFrameGovernor,
  isEmbeddedFrame,
  detailForTier,
} from "@/lib/room-runtime";

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
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

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
  // bridge for LetGo — the room's kept storm cells, cleared from outside the loop.
  const clearCellsRef = useRef<() => void>(() => {});

  const [pressureDisplay, setPressureDisplay] = useState(0.62);
  const [chargeDisplay, setChargeDisplay] = useState(0);
  const [hasBuilt, setHasBuilt] = useState(false);
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
    let vbo: WebGLBuffer | null = null;
    let uTimeLoc: WebGLUniformLocation | null = null;
    let uResLoc: WebGLUniformLocation | null = null;
    let uStormLoc: WebGLUniformLocation | null = null;
    let uMaelstromLoc: WebGLUniformLocation | null = null;
    let uFlashLoc: WebGLUniformLocation | null = null;
    let uChargeLoc: WebGLUniformLocation | null = null;
    let uLensLoc: WebGLUniformLocation | null = null;
    let uSeasonLoc: WebGLUniformLocation | null = null;
    let uPanLoc: WebGLUniformLocation | null = null;

    const setupProgram = () => {
      if (!gl) return;
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
        // uLens: 0 felt weather, 1 the pressure/temperature field as a map
        // (two-finger twist). uSeason: the slow annual cycle, tropical warm
        // toward arctic cold (three-finger twist).
        uniform float uLens;
        uniform float uSeason;
        uniform vec2 uPan;
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
          vec2 uv = vec2(vUv.x, 1.0 - vUv.y) + uPan;
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
          // season: warm tropical toward cold arctic slate, a slow cycle
          vec3 arctic = vec3(0.20, 0.24, 0.28);
          seaSurface = mix(seaSurface, arctic * 1.3, uSeason * 0.5);
          seaDeep = mix(seaDeep, arctic * 0.5, uSeason * 0.6);

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

          // the lens: read the same field as pressure/temperature, not felt
          if (uLens > 0.001) {
            vec3 low = vec3(0.85, 0.15, 0.10);
            vec3 high = vec3(0.10, 0.30, 0.85);
            vec3 diagram = mix(low, high, s);
            diagram += smoothstep(0.985, 1.0, fract(seaV * 7.0)) * 0.35;
            color = mix(color, diagram, clamp(uLens, 0.0, 1.0));
          }

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
            uLensLoc = gl.getUniformLocation(p, "uLens");
            uSeasonLoc = gl.getUniformLocation(p, "uSeason");
            uPanLoc = gl.getUniformLocation(p, "uPan");

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
            vbo = buf;
          }
        }
      }
    };
    setupProgram();

    const onContextLost = (ev: Event) => {
      ev.preventDefault();
      glProg = null;
    };
    const onContextRestored = () => {
      setupProgram();
    };
    water.addEventListener("webglcontextlost", onContextLost, false);
    water.addEventListener("webglcontextrestored", onContextRestored, false);

    const embedded = isEmbeddedFrame();
    const gov = createFrameGovernor(embedded ? "medium" : "high");
    let hiddenDoc = document.hidden;
    let galleryPaused = false;
    let asleep = false;
    const syncSleep = () => {
      asleep = hiddenDoc || galleryPaused;
      if (asleep) gov.force("sleep");
    };
    const unvis = onVisibility((h) => {
      hiddenDoc = h;
      syncSleep();
    });
    const ungal = onGalleryPause((p) => {
      galleryPaused = p;
      syncSleep();
    });

    const resize = () => {
      const dpr = resolveDpr(gov.tier(), { embedded, reducedMotion: reduce });
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

    // ── the room's clock + law-layer state (gesture grammar) ──────
    // Three fingers held dilate time; three fingers dragged shear the
    // rain and wind; a circling finger spins up a gyre; a steady tapped
    // pulse entrains the sea's surge. Thresholds live in gesture/core.
    let timeScale = 1;
    let timeScaleTarget = 1;
    let simT: number | null = null;  // warped seconds — waves, spirals
    let simNow = performance.now();  // warped ms — streak/crest/bolt ages
    let lastFrameAt: number | null = null;
    let gyre = 0;                    // scrub-born whirl, decays to calm
    let lastScrubAt = 0;
    let lastWindLawAt = 0;
    let entrainBpm = 0;
    let entrainUntil = 0;
    let lastEntrainBeat = -1;
    let lastGestureAt = performance.now();
    const holdState = { ceremony: false };

    // ── the map layer (two fingers) and the vessel ─────────────────
    let lens = 0; // 0 felt weather, 1 the pressure/temperature field
    let season = 0; // 0 warm, 1 arctic — the slow annual cycle
    let panX = 0;
    let panY = 0;
    let panXTarget = 0;
    let panYTarget = 0;
    let holdZone: "sky" | "sea" | null = null;
    // the dwell-planted cell still under the finger, fed while the hold lasts
    let heldCellId = -1;
    // span — two fingers resting: the storm holds its breath while they stay
    let spanHold = 0;

    // ── storm cells: the room's countable material ──────────────────
    // A hand plants a localized cell of weather in the sea with a dwell
    // hold; ceremony hold on an existing cell snuffs it; the eye (ceremony
    // on open water) remains the room's other solemn act.
    type StormCell = { id: number; x: number; y: number; t0: number; strength: number; fed: boolean };
    const cells: StormCell[] = [];
    let nextCellId = 1;
    const addCell = (x: number, y: number, strength: number) => {
      cells.push({ id: ++nextCellId, x, y, t0: simNow, strength, fed: false });
      if (cells.length > 6) cells.shift();
      setHasBuilt(true);
    };
    const extinguishCellNear = (x: number, y: number): boolean => {
      let bestIdx = -1;
      let bestD = 70;
      for (let i = 0; i < cells.length; i++) {
        const d = Math.hypot(cells[i].x - x, cells[i].y - y);
        if (d < bestD) { bestD = d; bestIdx = i; }
      }
      if (bestIdx < 0) return false;
      cells.splice(bestIdx, 1);
      setHasBuilt(cells.length > 0);
      return true;
    };
    clearCellsRef.current = () => {
      cells.length = 0;
      manualCrestsRef.current = [];
      chargeRef.current = 0;
      stormSpikeRef.current = 0;
      setHasBuilt(false);
    };

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
      if (cur && simNow - cur.t0 < 130) return;
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
      lightningRef.current = { t0: simNow, life: 0.42, segments, intensity, hitX, hitY };
      lastLightningAt.current = now;

      // sea surges where it strikes
      stormSpikeRef.current = Math.min(0.5, stormSpikeRef.current + 0.22 * charge);
      manualCrestsRef.current.push({ x: hitX, t0: simNow, strength: 30 * charge });
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

    // ── gestures (the shared grammar — src/lib/gesture) ───────────
    // One finger touches the weather: the sky banks charge, the sea
    // bumps crests and kicks spray. Three fingers touch the law: drag
    // shears the wind and rain, hold slows the whole storm. Ceremony
    // (2.5s) opens the eye. Pinch and pan2 stay unbound — the frame
    // belongs to the scale manifold.
    let skyCharging = false;
    let dragZone: "sky" | "sea" | null = null;
    let lastDragAt = 0;
    let lastDragX = -1;
    let lastDragY = -1;
    let skyLastX = 0;
    let skyLastSound = 0;

    const spawnWindStreak = (y: number, strong: boolean) => {
      if (reduce) return;
      const goesRight = Math.random() < 0.6;
      windStreaksRef.current.push({
        t0: simNow,
        y,
        vx: (goesRight ? 1 : -1) * (90 + Math.random() * 90 + (strong ? 60 : 0)),
        len: 60 + Math.random() * 50,
        alpha: strong ? 0.6 : 0.4,
      });
      if (windStreaksRef.current.length > 12) windStreaksRef.current.shift();
    };

    const toLocal = (clientX: number, clientY: number) => {
      const r = lines.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    };

    // the "touch lands" verbs shared by tap, drag start and hold enter —
    // exactly what pointerdown did before the grammar arrived.
    const boostParticle = (x: number, y: number, intensity: number): boolean => {
      const pIdx = pickParticleAt(x, y, 16);
      if (pIdx < 0) return false;
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
      try { haptics.ripple(0.15 + intensity * 0.2); } catch { /* noop */ }
      return true;
    };

    const touchFuji = (x: number, y: number): boolean => {
      if (!isOnFuji(x, y)) return false;
      fujiHaloRef.current = { t0: simNow };
      try { audio.chime(); } catch { /* noop */ }
      try { haptics.roll(); } catch { /* noop */ }
      useField.getState().recordTape("object", 0.7, "storm/peak");
      return true;
    };

    const bumpSea = (x: number, y: number, intensity: number) => {
      // tap intensity is the blow: crest height, spray count and haptic
      // all ride the same 0..1 from core.
      manualCrestsRef.current.push({ x, t0: simNow, strength: 20 + intensity * 16 });
      if (manualCrestsRef.current.length > 12) manualCrestsRef.current.shift();
      const crestD = crestHitDistance(x, y);
      if (crestD < 24) {
        spawnBurst(x, y, 10 + Math.round(intensity * 8), 200 + intensity * 60);
        try { audio.thud(); } catch { /* noop */ }
        try { haptics.storm(); } catch { /* noop */ }
        stormSpikeRef.current = Math.min(0.4, stormSpikeRef.current + 0.05);
        useField.getState().recordTape("ripple", 1.0, "storm/crest");
      } else {
        try { haptics.ripple(0.3 + intensity * 0.4); } catch { /* noop */ }
        useField.getState().recordTape("ripple", 0.9, "storm/sea");
      }
    };

    const detachGestures = attachGestures(lines, {
      tap: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers === 2) {
          // step back: lower a raised lens, else the storm eases its lean.
          // ScaleTravel (document.body) reads data-lens-raised so this tap
          // and the shared scale step-back never both answer at once.
          if (lens > 0.02) {
            lens = 0;
            wrap.dataset.lensRaised = "";
          } else {
            panXTarget = 0;
            panYTarget = 0;
            calmRef.current = Math.max(calmRef.current, 0.25);
            calmStartedRef.current = performance.now();
          }
          haptics.tap();
          return;
        }
        if (e.fingers === 3) {
          // tutti — everything alive answers softly at once, as loud as asked
          stormSpikeRef.current = Math.min(0.5, stormSpikeRef.current + 0.08 + e.intensity * 0.1);
          chargeRef.current = Math.min(1, chargeRef.current + 0.05 + e.intensity * 0.08);
          for (const cell of cells) cell.strength = Math.min(1, cell.strength + 0.1 + e.intensity * 0.12);
          try { audio.chime(); } catch { /* noop */ }
          haptics.ripple(0.3 + e.intensity * 0.3);
          return;
        }
        const { x, y } = toLocal(e.x, e.y);
        const w = lines.clientWidth;
        const seaTopPx = lines.clientHeight * SEA_TOP;
        const sky = y < seaTopPx;
        // rapid-tap ladder (tiers from gesture/core): the low-friction rungs
        const tier = tapTrainTier(e.count);
        const depth = tapTrainDepth(e.count);
        if (tier === "n") {
          // the crescendo: the tempest itself answers — charge saturates,
          // the sea rears, every planted cell surges with the train
          lastStrikeXFracRef.current = x / Math.max(1, w);
          chargeRef.current = Math.min(1, chargeRef.current + 0.3 + depth * 0.4);
          stormSpikeRef.current = Math.min(0.5, stormSpikeRef.current + 0.1 + depth * 0.12);
          for (const cell of cells) cell.strength = Math.min(1, cell.strength + 0.12 + depth * 0.1);
          spawnBurst(x, Math.max(y, seaTopPx + 6), 10 + Math.round(depth * 14), 200 + depth * 90);
          if (chargeRef.current > 0.5) dischargeAt(lastStrikeXFracRef.current);
          else { try { audio.thud(); } catch { /* noop */ } }
          try { haptics.storm(); } catch { /* noop */ }
          useField.getState().recordTape("ripple", 0.8 + depth * 0.2, "storm/crescendo");
          return;
        }
        if (tier === 5 && maelstromTargetRef.current < 0.5) {
          // tier 5 — the room's biggest reachable event: the eye of the
          // storm opens, the same act the ceremony hold owns, now also
          // reachable by hand at the top of the tap ladder
          maelstromTargetRef.current = 1;
          setMaelstromOn(true);
          try { audio.thud(); } catch { /* noop */ }
          window.setTimeout(() => { try { audio.bell(); } catch { /* noop */ } }, 220);
          try { haptics.bloom(); } catch { /* noop */ }
          useField.getState().recordTape("ripple", 1.0, "storm/eye");
          // and the sky still answers where the hand struck
          if (sky) {
            lastStrikeXFracRef.current = x / Math.max(1, w);
            chargeRef.current = Math.max(chargeRef.current, 0.3 + depth * 0.4);
            dischargeAt(lastStrikeXFracRef.current);
          }
          return;
        }
        if (tier >= 3 && sky) {
          // three taps fork the sky: the bank lets go where the train lands;
          // five march the strike across the front, bolt answering bolt
          lastStrikeXFracRef.current = x / Math.max(1, w);
          chargeRef.current = Math.max(chargeRef.current, 0.3 + depth * 0.4);
          dischargeAt(lastStrikeXFracRef.current);
          if (tier >= 5) {
            const step = 0.14 + depth * 0.08;
            window.setTimeout(() => dischargeAt(clamp01(lastStrikeXFracRef.current - step)), 180);
            window.setTimeout(() => dischargeAt(clamp01(lastStrikeXFracRef.current + step)), 360);
          }
          return;
        }
        if (tier >= 3) {
          // in the sea the train raises a set: crest after crest walking out
          // from the tapped water, three abreast at three, spray at five
          for (let k = -1; k <= 1; k++) {
            manualCrestsRef.current.push({ x: x + k * (36 + depth * 30), t0: simNow, strength: 18 + depth * 18 });
          }
          if (manualCrestsRef.current.length > 12) {
            manualCrestsRef.current.splice(0, manualCrestsRef.current.length - 12);
          }
          if (tier >= 5) {
            spawnBurst(x, y, 12 + Math.round(depth * 12), 220 + depth * 80);
            stormSpikeRef.current = Math.min(0.5, stormSpikeRef.current + 0.06 + depth * 0.08);
          }
          try { audio.thud(); } catch { /* noop */ }
          try { haptics.chop(); } catch { /* noop */ }
          useField.getState().recordTape("ripple", 0.6 + depth * 0.2, "storm/set");
          return;
        }
        if (boostParticle(x, y, e.intensity)) return;
        if (touchFuji(x, y)) return;
        if (sky) {
          // SKY — a tap releases banked charge, or banks a little more.
          lastStrikeXFracRef.current = x / Math.max(1, w);
          spawnWindStreak(y, false);
          if (chargeRef.current > 0.12) {
            dischargeAt(lastStrikeXFracRef.current);
          } else {
            chargeRef.current = Math.min(1, chargeRef.current + 0.10 + e.intensity * 0.12);
            try { audio.spark(); } catch { /* noop */ }
            try { haptics.tap(); } catch { /* noop */ }
          }
          return;
        }
        bumpSea(x, y, e.intensity);
      },
      drag: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers === 3) {
          if (e.phase === "end") return;
          // three fingers drag the weather: the rain shears over and the
          // whole wave train leans into the pushed wind
          const speed = Math.hypot(e.vx, e.vy);
          if (speed > 0.15) {
            const ang = Math.atan2(e.vy, e.vx);
            windDirRef.current = ang;
            setWindAngleDisplay(ang);
          }
          const nowMs = performance.now();
          if (speed > 0.3 && nowMs - lastWindLawAt > 700) {
            lastWindLawAt = nowMs;
            const { y } = toLocal(e.x, e.y);
            const skyY = Math.min(y, lines.clientHeight * SEA_TOP * 0.9);
            spawnWindStreak(skyY, true);
            spawnWindStreak(Math.max(16, skyY - 34), false);
            stormSpikeRef.current = Math.min(0.4, stormSpikeRef.current + 0.03);
            try { audio.playTone(70 + Math.abs(Math.cos(windDirRef.current)) * 40, 0.4); } catch { /* noop */ }
            try { haptics.chop(); } catch { /* noop */ }
            useField.getState().recordTape("region", 0.45, "storm/wind");
          }
          return;
        }
        if (e.fingers !== 1) return;
        const { x, y } = toLocal(e.x, e.y);
        const w = lines.clientWidth;
        const seaTopPx = lines.clientHeight * SEA_TOP;
        if (e.phase === "start") {
          dragZone = null;
          if (boostParticle(x, y, 0.5)) return;
          if (touchFuji(x, y)) return;
          if (y < seaTopPx) {
            dragZone = "sky";
            skyCharging = true;
            skyLastX = x;
            skyLastSound = 0;
            lastStrikeXFracRef.current = x / Math.max(1, w);
            spawnWindStreak(y, false);
            try { audio.spark(); } catch { /* noop */ }
            try { haptics.tap(); } catch { /* noop */ }
          } else {
            dragZone = "sea";
            bumpSea(x, y, 0.5);
            lastDragX = x;
            lastDragY = y;
            lastDragAt = 0;
          }
          return;
        }
        if (e.phase === "end") {
          dragZone = null;
          skyCharging = false;
          return;
        }
        if (dragZone === "sky") {
          const dx = Math.abs(x - skyLastX);
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
        if (dragZone !== "sea") return;
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
      },
      flick: (e) => {
        lastGestureAt = performance.now();
        dragZone = null;
        skyCharging = false;
        if (e.fingers !== 1) return;
        const { y } = toLocal(e.x, e.y);
        if (y >= lines.clientHeight * SEA_TOP) return;
        // a flick across the sky throws the wind — the vane whips to the
        // flick's heading and a gust of streaks rides it out
        windDirRef.current = e.angle;
        setWindAngleDisplay(e.angle);
        for (let i = 0; i < 4; i++) {
          spawnWindStreak(Math.max(16, y - 26 + i * 18), i < 2);
        }
        try { audio.playTone(180 + ((e.angle + Math.PI) / (Math.PI * 2)) * 260, 0.2); } catch { /* noop */ }
        try { haptics.chop(); } catch { /* noop */ }
        useField.getState().recordTape("region", 0.5, "storm/gust");
      },
      hold: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers === 3) {
          // three fingers hold the law: time keeps thickening the longer
          // they stay — a moment at 900ms, near-stillness by 2400ms
          if (e.phase === "release") { timeScaleTarget = 1; return; }
          timeScaleTarget = 1 - 0.75 * clamp01(e.elapsed / 2000);
          if (e.phase === "enter") {
            try { audio.playNote(36, 260); } catch { /* noop */ }
            try { haptics.tap(); } catch { /* noop */ }
          }
          return;
        }
        if (e.fingers !== 1) return;
        const { x, y } = toLocal(e.x, e.y);
        if (e.phase === "enter") {
          holdState.ceremony = false;
          (holdState as { dwell?: boolean }).dwell = false;
          heldCellId = -1;
          holdZone = y < lines.clientHeight * SEA_TOP ? "sky" : "sea";
          // the touch still lands — the same verbs pointerdown spoke
          if (boostParticle(x, y, 0.5)) return;
          if (touchFuji(x, y)) return;
          if (holdZone === "sky") {
            lastStrikeXFracRef.current = x / Math.max(1, lines.clientWidth);
            spawnWindStreak(y, false);
            try { audio.spark(); } catch { /* noop */ }
            try { haptics.tap(); } catch { /* noop */ }
          } else {
            bumpSea(x, y, 0.5);
          }
          return;
        }
        if (e.phase === "release") return;
        // dwell tier — something visibly gathers under the finger: a cell
        // of the storm plants in the sea (deepens the longer it holds), or
        // the banked charge surges harder held in the sky.
        const dwellState = holdState as { dwell?: boolean };
        if (e.tier >= 2 && !dwellState.dwell && !holdState.ceremony) {
          dwellState.dwell = true;
          if (holdZone === "sea") {
            const charge = Math.min(1, e.elapsed / 1800);
            addCell(x, y, 0.4 + charge * 0.6);
            heldCellId = cells.length ? cells[cells.length - 1].id : -1;
            spawnBurst(x, y, 8 + Math.round(charge * 10), 160);
            stormSpikeRef.current = Math.min(0.4, stormSpikeRef.current + 0.06);
            try { audio.thud(); } catch { /* noop */ }
            try { haptics.storm(); } catch { /* noop */ }
            useField.getState().recordTape("sigil", 0.6 + charge * 0.2, "storm/cell");
          } else {
            chargeRef.current = Math.min(1, chargeRef.current + 0.22);
            try { audio.spark(); } catch { /* noop */ }
            try { haptics.ripple(0.4); } catch { /* noop */ }
          }
        } else if (e.tier >= 2 && dwellState.dwell && !holdState.ceremony) {
          // duration is an axis: the hold keeps feeding what it planted —
          // the sea cell fattens toward a squall, the sky bank keeps rising
          if (holdZone === "sea" && heldCellId >= 0) {
            const held = cells.find((c) => c.id === heldCellId);
            if (held) {
              held.strength = Math.min(1, held.strength + 0.004);
              if (e.elapsed % 700 < 60) {
                manualCrestsRef.current.push({ x: held.x, t0: simNow, strength: 12 + held.strength * 14 });
                if (manualCrestsRef.current.length > 12) manualCrestsRef.current.shift();
                try { audio.playTone(52 + held.strength * 26, 0.07); } catch { /* noop */ }
                try { haptics.ripple(0.15 + held.strength * 0.2); } catch { /* noop */ }
              }
            }
          } else if (holdZone === "sky") {
            chargeRef.current = Math.min(1, chargeRef.current + 0.005);
            if (e.elapsed % 700 < 60) {
              try { audio.playTone(360 + chargeRef.current * 900, 0.05); } catch { /* noop */ }
              try { haptics.ripple(0.1 + chargeRef.current * 0.2); } catch { /* noop */ }
            }
          }
        }
        // ceremony tier — the room's one solemn act: over an existing cell
        // it is snuffed out (the touch-reachable delete); over open water
        // the eye of the storm opens (a second ceremony closes it again)
        if (e.tier >= 3 && !holdState.ceremony) {
          holdState.ceremony = true;
          if (holdZone === "sea" && extinguishCellNear(x, y)) {
            try { audio.thud(); } catch { /* noop */ }
            try { haptics.chop(); } catch { /* noop */ }
            useField.getState().recordTape("sigil", 0.3, "storm/dissolve");
            return;
          }
          const next = maelstromTargetRef.current < 0.5;
          maelstromTargetRef.current = next ? 1 : 0;
          setMaelstromOn(next);
          if (next) {
            try { audio.thud(); } catch { /* noop */ }
            window.setTimeout(() => { try { audio.bell(); } catch { /* noop */ } }, 220);
            try { haptics.bloom(); } catch { /* noop */ }
            useField.getState().recordTape("ripple", 1.0, "storm/eye");
          } else {
            try { audio.chime(); } catch { /* noop */ }
            try { haptics.roll(); } catch { /* noop */ }
          }
        }
      },
      twist: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers === 3) {
          // three-finger twist: advance/rewind the storm's slow season
          season = clamp01(season + e.angle * 0.12);
          return;
        }
        // two-finger twist rotates the lens — felt weather ↔ pressure map
        lens = clamp01(lens + e.angle * 0.4);
        wrap.dataset.lensRaised = lens > 0.02 ? "1" : "";
      },
      pan2: (e) => {
        lastGestureAt = performance.now();
        panXTarget = Math.max(-0.14, Math.min(0.14, panXTarget + e.dx * 0.0006));
        panYTarget = Math.max(-0.1, Math.min(0.1, panYTarget + e.dy * 0.0006));
      },
      scrub: (e) => {
        lastGestureAt = performance.now();
        const nowMs = performance.now();
        if (nowMs - lastScrubAt < 700) return;
        lastScrubAt = nowMs;
        // circling stirs a gyre — the wave train winds toward the spiral
        // for a few seconds, spray curling with it; a faster hand winds it
        // harder, and the water's own note deepens with the whirl
        const vig = clamp01(Math.abs(e.angularVelocity) / 1.6);
        gyre = Math.min(0.85, gyre + 0.25 + vig * 0.35);
        const { x, y } = toLocal(e.cx, e.cy);
        const seaY = Math.max(y, lines.clientHeight * SEA_TOP + 10);
        spawnBurst(x, seaY, 8 + Math.round(vig * 10), 160 + vig * 90);
        try { audio.playNote(48 - Math.round(vig * 7), 200 + vig * 160); } catch { /* noop */ }
        try { haptics.ripple(0.3 + vig * 0.3); } catch { /* noop */ }
        useField.getState().recordTape("ripple", 0.5 + vig * 0.3, "storm/gyre");
      },
      span: (e) => {
        lastGestureAt = performance.now();
        // span — two still fingers hold the weather's breath: the sea
        // flattens for as long as the interval stands, broader with the
        // spread, deeper with the wait, and lets go as a surge sized by both
        if (e.phase === "release") {
          const pent = spanHold;
          spanHold = 0;
          stormSpikeRef.current = Math.min(0.5, stormSpikeRef.current + 0.12 + pent * 0.25);
          manualCrestsRef.current.push({ x: toLocal(e.cx, e.cy).x, t0: simNow, strength: 16 + pent * 22 });
          if (manualCrestsRef.current.length > 12) manualCrestsRef.current.shift();
          try { audio.thud(); } catch { /* noop */ }
          try { haptics.storm(); } catch { /* noop */ }
          useField.getState().recordTape("ripple", 0.5 + pent * 0.4, "storm/exhale");
          return;
        }
        spanHold = clamp01(e.elapsed / 2500) * (0.6 + clamp01(e.spread / 500) * 0.4);
        if (e.phase === "enter") {
          try { audio.playNote(31, 420); } catch { /* noop */ }
          try { haptics.ripple(0.25); } catch { /* noop */ }
        } else if (e.elapsed % 700 < 60) {
          // the interval itself is audible: two low tones spaced by the spread
          try {
            audio.playTone(56, 0.1);
            audio.playTone(56 * (1.2 + clamp01(e.spread / 420) * 0.8), 0.09);
          } catch { /* noop */ }
          try { haptics.ripple(0.1 + spanHold * 0.15); } catch { /* noop */ }
        }
      },
      drum: (e) => {
        lastGestureAt = performance.now();
        // drumming plays the space between the hands: each landing kicks
        // its own zone — crests in the sea, streaks and charge in the sky —
        // and a patter that straddles the sea line arcs a bolt between them
        const hit = toLocal(e.x, e.y);
        const za = toLocal(e.ax, e.ay);
        const zb = toLocal(e.bx, e.by);
        const seaTopPx = lines.clientHeight * SEA_TOP;
        const roll = clamp01(e.hits / 9);
        if (hit.y < seaTopPx) {
          chargeRef.current = Math.min(1, chargeRef.current + 0.05 + e.alternation * 0.05);
          spawnWindStreak(hit.y, roll > 0.5);
          try { audio.playTone(300 + chargeRef.current * 500, 0.05); } catch { /* noop */ }
        } else {
          manualCrestsRef.current.push({ x: hit.x, t0: simNow, strength: 12 + roll * 16 });
          if (manualCrestsRef.current.length > 12) manualCrestsRef.current.shift();
          try { audio.playTone(58 + roll * 20, 0.07); } catch { /* noop */ }
        }
        try { haptics.tap(); } catch { /* noop */ }
        if (e.hits >= 5 && e.alternation > 0.85 && (za.y < seaTopPx) !== (zb.y < seaTopPx)) {
          const skyZone = za.y < seaTopPx ? za : zb;
          lastStrikeXFracRef.current = skyZone.x / Math.max(1, lines.clientWidth);
          chargeRef.current = Math.max(chargeRef.current, 0.45);
          dischargeAt(lastStrikeXFracRef.current);
          useField.getState().recordTape("ripple", 0.9, "storm/antiphon");
        }
      },
      rhythm: (e) => {
        // a steady tapped pulse: the surge falls in with the hand
        if (e.stability <= 0.7) return;
        entrainBpm = Math.max(40, Math.min(110, e.bpm));
        entrainUntil = performance.now() + 9000;
      },
    }, { wheelZoom: false });

    // ── the vessel: the phone's own body reads the weather too ───────
    const detachVessel = onVessel({
      tilt: ({ gamma }) => {
        if (reduce || asleep) return;
        windDirRef.current += gamma * 0.0006;
        setWindAngleDisplay(windDirRef.current);
      },
      shake: ({ intensity }) => {
        if (reduce || asleep) return;
        stormSpikeRef.current = Math.min(0.5, stormSpikeRef.current + intensity * 0.3);
        chargeRef.current = Math.min(1, chargeRef.current + intensity * 0.2);
        try { audio.thud(); } catch { /* noop */ }
        try { haptics.storm(); } catch { /* noop */ }
      },
      knock: ({ intensity }) => {
        if (reduce || asleep) return;
        chargeRef.current = Math.min(1, chargeRef.current + 0.15 + intensity * 0.1);
        try { audio.spark(); } catch { /* noop */ }
        try { haptics.tap(); } catch { /* noop */ }
      },
      flip: ({ faceDown }) => {
        // night: the storm settles toward calm until the phone turns back up
        if (faceDown) {
          calmRef.current = Math.max(calmRef.current, 0.6);
          calmStartedRef.current = performance.now();
        }
      },
    });

    const t0 = performance.now();
    let raf = 0;
    let lastUiSync = 0;

    const draw = (now: number) => {
      const tier = gov.beginFrame(now);
      if (asleep) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const detail = detailForTier(tier);
      const w = lines.clientWidth;
      const h = lines.clientHeight;

      if (lastFrameAt == null) lastFrameAt = now;
      const frameDt = Math.min(0.1, Math.max(0, (now - lastFrameAt) / 1000));
      lastFrameAt = now;
      // three-finger time dilation: the storm's clock eases to ~1/4 speed
      timeScale += (timeScaleTarget - timeScale) * Math.min(1, frameDt * 5);
      simNow += frameDt * 1000 * timeScale;
      // the scrub-born gyre unwinds on its own over a few seconds
      gyre *= Math.exp(-frameDt * 0.4);
      if (gyre < 0.005) gyre = 0;
      panX += (panXTarget - panX) * Math.min(1, frameDt * 3);
      panY += (panYTarget - panY) * Math.min(1, frameDt * 3);

      // storm cells act on each other: two whose patches of sea overlap
      // merge into one stronger cell (a third cell that is neither
      // parent), and a cell strong enough sheds a downdraft that seeds a
      // fresh, weaker cell beside it — a chain rather than isolated bumps.
      for (let i = 0; i < cells.length; i++) {
        const a = cells[i];
        for (let j = cells.length - 1; j > i; j--) {
          const b = cells[j];
          if (Math.abs(a.x - b.x) > 46) continue;
          a.strength = Math.min(1.4, a.strength + b.strength * 0.7);
          a.x = (a.x + b.x) / 2;
          a.t0 = Math.min(a.t0, b.t0);
          cells.splice(j, 1);
          manualCrestsRef.current.push({ x: a.x, t0: simNow, strength: 22 * a.strength });
          try { haptics.bloom(); } catch { /* noop */ }
        }
        if (a.strength > 0.9 && !a.fed && (simNow - a.t0) > 900) {
          a.fed = true;
          cells.push({ id: ++nextCellId, x: a.x + (a.x > w / 2 ? -70 : 70), y: a.y, t0: simNow, strength: a.strength * 0.45, fed: false });
        }
      }

      // storm cells: each keeps bumping its patch of sea until it decays
      // (~14s) or a ceremony hold snuffs it out early.
      for (let i = cells.length - 1; i >= 0; i--) {
        const cell = cells[i];
        const age = (simNow - cell.t0) / 1000;
        if (age > 14) {
          cells.splice(i, 1);
          setHasBuilt(cells.length > 0);
          continue;
        }
        if (Math.floor(age * 1.1) !== Math.floor((age - frameDt * timeScale) * 1.1)) {
          manualCrestsRef.current.push({ x: cell.x, t0: simNow, strength: 14 * cell.strength });
          if (manualCrestsRef.current.length > 12) manualCrestsRef.current.shift();
        }
      }

      stormSpikeRef.current *= 0.985;
      if (stormSpikeRef.current < 0.001) stormSpikeRef.current = 0;

      // rhythm entrainment: while a steady tapped pulse holds, the sea
      // surges softly on every beat with its own low tick — sight and
      // sound land in the same frame.
      if (performance.now() < entrainUntil && entrainBpm > 0 && simT != null) {
        const beatLen = 60 / entrainBpm;
        const beatIdx = Math.floor(simT / beatLen);
        if (beatIdx !== lastEntrainBeat) {
          lastEntrainBeat = beatIdx;
          stormSpikeRef.current = Math.min(0.5, stormSpikeRef.current + 0.05);
          try { audio.playTone(88 + (beatIdx % 2) * 22, 0.06); } catch { /* noop */ }
        }
      }

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
      // the span's held breath: the sea flattens as long as (and as deep as)
      // two fingers keep the interval
      const target = Math.min(1, dialTarget + stormSpikeRef.current) * calmFactor * (1 - spanHold * 0.7);
      stormRef.current += (target - stormRef.current) * 0.10;
      const s = stormRef.current;

      // cadence follows pressure; maelstrom eases toward target.
      const freqTarget = 0.6 + (1 - pressure) * 1.2;
      freqRef.current += (freqTarget - freqRef.current) * 0.08;
      const freqMulDial = freqRef.current;
      maelstromRef.current += (maelstromTargetRef.current - maelstromRef.current) * 0.06;
      // the eye plus any scrub-born gyre — the sea winds toward the spiral
      const ml = Math.min(1, maelstromRef.current + gyre);

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
        const age = (simNow - lightningRef.current.t0) / 1000;
        if (age > lightningRef.current.life) {
          lightningRef.current = null;
        } else {
          const v = Math.max(0, 1 - age / lightningRef.current.life);
          flashAdd = v * v * lightningRef.current.intensity * (reduce ? 0.2 : 0.7);
        }
      }

      // the room's clock: seeded from the shared audio clock so the swell
      // starts in phase, then accumulated so three fingers can dilate it.
      if (simT == null) {
        const audioT = audio.getAudioTime();
        simT = audioT != null ? audioT : (now - t0) / 1000;
      } else {
        simT += frameDt * timeScale;
      }
      const t = reduce ? 0 : simT;

      // ── WebGL pass ─────────────────────────────────────────────
      if (gl && glProg) {
        gl.useProgram(glProg);
        if (uTimeLoc) gl.uniform1f(uTimeLoc, t);
        if (uResLoc) gl.uniform2f(uResLoc, water.width, water.height);
        if (uStormLoc) gl.uniform1f(uStormLoc, s);
        if (uMaelstromLoc) gl.uniform1f(uMaelstromLoc, ml);
        if (uFlashLoc) gl.uniform1f(uFlashLoc, flashAdd);
        if (uChargeLoc) gl.uniform1f(uChargeLoc, cq);
        if (uLensLoc) gl.uniform1f(uLensLoc, lens);
        if (uSeasonLoc) gl.uniform1f(uSeasonLoc, season);
        if (uPanLoc) gl.uniform2f(uPanLoc, panX, panY);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } else {
        const wctx = water.getContext("2d");
        if (wctx) {
          const dpr = resolveDpr(tier, { embedded, reducedMotion: reduce });
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
        const haloAge = (simNow - fujiHaloRef.current.t0) / 1000;
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
      if (!reduce && s > 0.32 && Math.random() < (s - 0.28) * 0.05 * detail.particles) {
        spawnWindStreak(Math.random() * h * SEA_TOP * 0.9, s > 0.7);
      }

      if (windStreaksRef.current.length > 0) {
        for (let i = windStreaksRef.current.length - 1; i >= 0; i--) {
          const ws = windStreaksRef.current[i];
          const age = (simNow - ws.t0) / 1000;
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
          const fx = ((i + 0.5) / filaments) * w + Math.sin(simNow * 0.004 + i * 1.7) * 26;
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
      const emitProbPerCrest = Math.min(0.65, emitRate / 90) * detail.particles;

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
            yy -= manualBump(x, simNow);
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

      // storm cells: a faint turning ring marks each planted cell so the
      // hand can find it again to snuff it out.
      for (const cell of cells) {
        const age = (simNow - cell.t0) / 1000;
        const life = Math.max(0, 1 - age / 14);
        const cy = Math.max(cell.y, h * SEA_TOP + 10);
        lctx.save();
        lctx.strokeStyle = `rgba(200, 220, 255, ${(0.10 + life * 0.10) * cell.strength})`;
        lctx.lineWidth = 1;
        lctx.beginPath();
        lctx.ellipse(cell.x, cy, 24 + Math.sin(simNow * 0.002 + cell.id) * 4, 9, 0, 0, Math.PI * 2);
        lctx.stroke();
        lctx.restore();
      }

      // ── particle integration + render ─────────────────────────
      const dt = Math.min(0.05, motion ? 1 / 60 : 0) * timeScale;
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
        const age = (simNow - lb.t0) / 1000;
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

      // glimmer (grammar §6): after ~20s of quiet, a faint turning current
      // rides the sea where a circling finger would spin the gyre — a
      // physical hint, never text.
      if (performance.now() - lastGestureAt > 20000) {
        const slot = Math.floor(now / 9000);
        const gseed = (n: number) => { const v = Math.sin((slot + n) * 127.1) * 43758.5453; return v - Math.floor(v); };
        const gx = (0.22 + gseed(0) * 0.56) * w;
        const gy = h * (SEA_TOP + 0.14 + gseed(7) * 0.3);
        const pulse = reduce ? 0.5 : 0.5 + Math.sin(now / 480) * 0.5;
        lctx.save();
        lctx.strokeStyle = `rgba(220, 235, 255, ${(0.05 + pulse * 0.08).toFixed(3)})`;
        lctx.lineWidth = 1;
        lctx.beginPath();
        lctx.ellipse(gx, gy, 22 + pulse * 9, (22 + pulse * 9) * 0.34, 0, 0, Math.PI * 2);
        lctx.stroke();
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
      detachGestures();
      detachVessel();
      unvis();
      ungal();
      dischargeRef.current = null;
      clearCellsRef.current = () => {};
      water.removeEventListener("webglcontextlost", onContextLost);
      water.removeEventListener("webglcontextrestored", onContextRestored);
      delete wrap.dataset.lensRaised;
      if (gl) {
        if (glProg) gl.deleteProgram(glProg);
        if (vbo) gl.deleteBuffer(vbo);
      }
    };
  }, []);

  const letGo = useCallback(() => {
    clearCellsRef.current();
    getFieldAudio().thud();
    haptics.roll();
  }, []);

  // ── barometer dial handlers ──────────────────────────────────────
  const baroRef = useRef<HTMLDivElement>(null);

  const normalizePressure = (value: number) => {
    const clamped = Math.max(0, Math.min(1, value));
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return reduce ? Math.max(clamped, 0.72) : clamped;
  };

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
    const v = normalizePressure((deg + 120) / 240);
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

  const setPressureExact = (value: number, label = "exact") => {
    const next = normalizePressure(value);
    pressureRef.current = next;
    stormTargetRef.current = 1 - next;
    calmRef.current = 0;
    setPressureDisplay(next);
    playDialTone(90 + next * 260);
    useField.getState().recordTape("concern", 0.35 + (1 - next) * 0.5, `storm/${label}`);
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

      <div className="storm-gesture" aria-hidden="true">swipe sky to charge · sculpt the sea · turn pressure</div>

      <LetGo label="let the storm pass" onLetGo={letGo} visible={hasBuilt} />

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

        <MobileInstrumentPanel
          className="storm-mobile-panel"
          title="pressure & weather"
          triggerLabel="tune"
          summary={`${hPa} hPa · ${chargePct}% charge`}
        >
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

          <div className="storm-tune-controls">
            <label>
              <span>exact pressure</span>
              <strong>{hPa} hPa</strong>
              <input
                type="range"
                min={960}
                max={1040}
                step={1}
                value={hPa}
                onChange={(event) => setPressureExact((Number(event.target.value) - 960) / 80)}
              />
            </label>
            <div role="group" aria-label="weather presets">
              <button type="button" onClick={clearSky}>fair</button>
              <button type="button" onClick={() => setPressureExact(0.62, "gathering")}>gathering</button>
              <button type="button" onClick={() => setPressureExact(0.12, "tempest")}>tempest</button>
            </div>
          </div>

          <div className="storm-actions">
            <button type="button" onClick={toggleMaelstrom} aria-pressed={maelstromOn} className={maelstromOn ? "is-on" : ""}>
              eye
            </button>
            <button type="button" onClick={clearSky}>
              clear sky
            </button>
          </div>
        </MobileInstrumentPanel>
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

            .storm-gesture,
            .storm-tune-controls {
              display: none;
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
              right: 0;
              left: 0;
              bottom: 48px;
              width: max-content;
              margin-inline: auto;
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

            body:has(.storm-instrument) header:not(.oda-site-header) { display: none !important; }
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
              .storm-baro-panel {
                bottom: calc(116px + env(safe-area-inset-bottom, 0px)) !important;
                gap: 8px !important;
              }
              .storm-baro { width: 112px !important; height: 112px !important; }
              .storm-baro svg { width: 112px !important; height: 112px !important; }
              .storm-baro-panel > .storm-readout { display: none; }

              .storm-gesture {
                position: fixed;
                z-index: 3;
                right: 16px;
                bottom: calc(236px + env(safe-area-inset-bottom, 0px));
                left: 16px;
                display: block;
                color: rgba(244, 248, 255, 0.62);
                font-family: var(--font-text);
                font-size: 9px;
                letter-spacing: 0.05em;
                text-align: center;
                text-shadow: 0 2px 14px rgba(4, 12, 24, 0.94);
                text-transform: lowercase;
                pointer-events: none;
              }

              .storm-mobile-panel .mobile-instrument-panel__trigger {
                border-color: rgba(190, 210, 255, 0.42);
                background: rgba(14, 30, 52, 0.88);
              }

              .mobile-instrument-panel__content .storm-charge {
                display: grid;
                grid-template-columns: 32px minmax(0, 1fr);
                align-items: center;
                justify-items: center;
                gap: 10px;
                min-height: 92px;
                padding: 10px;
              }

              .mobile-instrument-panel__content .storm-charge-track {
                height: 68px !important;
              }

              .mobile-instrument-panel__content .storm-tune-controls {
                display: grid;
                gap: 9px;
                margin-top: 9px !important;
              }

              .storm-tune-controls label {
                display: grid;
                grid-template-columns: minmax(0, 1fr) auto;
                align-items: center;
                gap: 8px 12px;
                padding: 10px 12px;
                border: 1px solid rgba(244, 248, 255, 0.14);
                border-radius: 8px;
                color: rgba(244, 248, 255, 0.62);
                font-family: var(--font-text);
                font-size: 10px;
                text-transform: lowercase;
              }

              .storm-tune-controls label strong {
                color: rgba(244, 248, 255, 0.94);
                font-family: var(--font-numerals);
                font-size: 14px;
                font-weight: 400;
              }

              .storm-tune-controls input {
                grid-column: 1 / -1;
                width: 100%;
                accent-color: rgba(190, 210, 255, 0.92);
              }

              .storm-tune-controls > div,
              .mobile-instrument-panel__content .storm-actions {
                display: grid;
                grid-template-columns: repeat(3, minmax(0, 1fr));
                gap: 8px;
              }

              .storm-tune-controls button,
              .mobile-instrument-panel__content .storm-actions button {
                min-width: 0;
                min-height: 44px;
                padding: 9px 8px !important;
                border: 1px solid rgba(244,248,255,0.34);
                border-radius: 7px;
                background: transparent;
                color: rgba(244,248,255,0.82);
                font-family: var(--font-text);
                font-size: 10px !important;
                letter-spacing: 0.05em;
                text-transform: lowercase;
              }

              .mobile-instrument-panel__content .storm-actions {
                grid-template-columns: repeat(2, minmax(0, 1fr));
                margin-top: 9px !important;
              }

              .mobile-instrument-panel__content .storm-actions button.is-on {
                background: rgba(244,248,255,0.92);
                color: rgba(14,37,64,1);
              }
            }
            @media (max-width: 700px) and (max-height: 740px) {
              .storm-title strong { font-size: 50px !important; }
              .storm-baro-panel { bottom: calc(106px + env(safe-area-inset-bottom, 0px)) !important; }
              .storm-baro { width: 96px !important; height: 96px !important; }
              .storm-baro svg { width: 96px !important; height: 96px !important; }
              .storm-gesture { bottom: calc(210px + env(safe-area-inset-bottom, 0px)); }
            }
          `,
        }}
      />
    </div>
  );
}
