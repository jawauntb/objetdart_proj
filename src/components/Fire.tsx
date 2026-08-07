"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { tapTrainDepth, tapTrainTier } from "@/lib/gesture/core";
import { onVessel } from "@/lib/vessel";
import { useField } from "@/store/field";
import WaterText from "@/components/WaterText";
import LetGo from "@/components/LetGo";
import {
  onVisibility,
  onGalleryPause,
  resolveDpr,
  createFrameGovernor,
  isEmbeddedFrame,
  detailForTier,
} from "@/lib/room-runtime";
import { clocksFrom } from "@/lib/webgl/sizing";

type Ember = {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  radius: number;
  hue: number;
};

type PressureWell = {
  id: number;
  x: number;
  y: number;
  t0: number;
  strength: number;
  radius: number;
};

type HeatStroke = {
  id: number;
  points: Array<{ x: number; y: number; t: number }>;
  t0: number;
  releasedAt: number | null;
  strength: number;
  hue: number;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

// Hoisted out of the render loop's idle-glimmer branch so it isn't
// re-allocated as a fresh closure every frame the glimmer is visible.
const glimmerSeed = (slot: number, n: number) => {
  const v = Math.sin((slot + n) * 127.1) * 43758.5453;
  return v - Math.floor(v);
};

/**
 * /fire — a tactile combustion field.
 *
 * The old version arranged literal flame objects across a hearth. This version
 * treats fire as matter under energy: a charcoal bed, convection, heat shimmer,
 * sparks, embers, pressure wells, and drag-born shears. Tap to seed ignition,
 * drag to bend convection, hold to compress the field into white heat.
 */
export default function Fire() {
  useEffect(() => { getFieldAudio().setAmbientProfile("fire"); }, []);

  const wrapRef = useRef<HTMLDivElement>(null);
  const heatRef = useRef<HTMLCanvasElement>(null);
  const fxRef = useRef<HTMLCanvasElement>(null);
  const pointerRef = useRef({
    x: 0.5,
    y: 0.72,
    over: false,
    pressed: false,
    pressStart: 0,
  });

  const [heatReadout, setHeatReadout] = useState(0.32);
  const [hasBuilt, setHasBuilt] = useState(false);
  const clearAllRef = useRef<() => void>(() => {});
  const [fireMarks, setFireMarks] = useState<Array<{ id: number; label: string; tone: string; level: number }>>([
    { id: 0, label: "banked", tone: "#d45a24", level: 0.34 },
  ]);
  const markIdRef = useRef(0);
  const markFire = useCallback((label: string, tone = "#f39b44", level = 0.6) => {
    const id = ++markIdRef.current;
    setFireMarks((prev) => [
      { id, label, tone, level: clamp(level, 0, 1) },
      ...prev,
    ].slice(0, 5));
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    const heatCanvas = heatRef.current;
    const fxCanvas = fxRef.current;
    if (!wrap || !heatCanvas || !fxCanvas) return;
    const fx = fxCanvas.getContext("2d");
    if (!fx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const audio = getFieldAudio();
    void audio.start();

    const gl =
      (heatCanvas.getContext("webgl", { antialias: false, premultipliedAlpha: false }) ||
        heatCanvas.getContext(
          "experimental-webgl" as "webgl",
          { antialias: false, premultipliedAlpha: false } as WebGLContextAttributes,
        )) as WebGLRenderingContext | null;

    // The 2D fallback path (no WebGL) reuses this instead of calling
    // getContext("2d") every frame. A canvas's context type is fixed for
    // its lifetime, so this is identical to the old per-frame lookup: when
    // `gl` exists, the canvas already has a webgl context and a "2d"
    // request would return null anyway (matching the old behaviour on the
    // rare transient frames where gl is up but the program hasn't linked).
    const fallback2dCtx: CanvasRenderingContext2D | null = gl ? null : heatCanvas.getContext("2d");
    let cachedBgGradient: CanvasGradient | null = null;
    let cachedBgGradientH = -1;

    let program: WebGLProgram | null = null;
    let vbo: WebGLBuffer | null = null;
    let uTimeLoc: WebGLUniformLocation | null = null;
    let uResLoc: WebGLUniformLocation | null = null;
    let uPointerLoc: WebGLUniformLocation | null = null;
    let uPointerActiveLoc: WebGLUniformLocation | null = null;
    let uPressLoc: WebGLUniformLocation | null = null;
    let uWindLoc: WebGLUniformLocation | null = null;
    let uIgnitionLoc: WebGLUniformLocation | null = null;
    let uLensLoc: WebGLUniformLocation | null = null;
    let uSeasonLoc: WebGLUniformLocation | null = null;
    let uPanLoc: WebGLUniformLocation | null = null;
    let uBreathLoc: WebGLUniformLocation | null = null;

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
        uniform float uBreath;  // shared album 7s respiration, 0..1
        uniform vec2 uRes;
        uniform vec2 uPointer;
        uniform float uPointerActive;
        uniform float uPress;
        uniform float uWind;
        uniform float uIgnition;
        // uLens: 0 = the flame as felt, 1 = the pressure/heat field as a
        // false-colour diagram (two-finger twist — a level of description,
        // not a different fire). uSeason: the hearth's slow cycle, 0 roaring
        // toward 1 banked low (three-finger twist).
        uniform float uLens;
        uniform float uSeason;
        // uPan: two-finger drag leans the whole bed inside the frame.
        uniform vec2 uPan;
        varying vec2 vUv;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        float noise(vec2 p) {
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
          mat2 m = mat2(1.62, 1.19, -1.19, 1.62);
          for (int i = 0; i < 6; i++) {
            v += a * noise(p);
            p = m * p + vec2(7.1, 2.4);
            a *= 0.52;
          }
          return v;
        }

        vec3 blackbody(float t) {
          vec3 coal = vec3(0.018, 0.012, 0.010);
          vec3 red = vec3(0.42, 0.055, 0.018);
          vec3 orange = vec3(0.95, 0.28, 0.055);
          vec3 gold = vec3(1.0, 0.70, 0.22);
          vec3 white = vec3(0.90, 0.95, 1.0);
          vec3 c = mix(coal, red, smoothstep(0.06, 0.26, t));
          c = mix(c, orange, smoothstep(0.22, 0.52, t));
          c = mix(c, gold, smoothstep(0.48, 0.76, t));
          c = mix(c, white, smoothstep(0.82, 1.0, t));
          return c;
        }

        void main() {
          vec2 uv = vUv + uPan;
          float aspect = uRes.x / max(1.0, uRes.y);
          float t = uTime;

          float bed = exp(-uv.y * 4.8);
          float horizon = smoothstep(0.40, 0.04, uv.y);
          vec2 winded = uv + vec2(uWind * (1.0 - uv.y) * 0.12, 0.0);
          float coal = fbm(vec2(winded.x * aspect * 3.1, uv.y * 4.6 + 1.0));
          float fissure = fbm(vec2(winded.x * aspect * 7.6 + t * 0.04, uv.y * 10.0 - t * 0.32));
          float plumeNoise = fbm(vec2((winded.x * aspect + sin(uv.y * 8.0 + t * 0.8) * 0.035) * 2.1, uv.y * 2.6 - t * 0.42));
          float plume = smoothstep(0.48, 0.88, plumeNoise) * smoothstep(1.08, 0.10, uv.y);
          float convection = fbm(vec2(winded.x * aspect * 1.3 + sin(uv.y * 9.0 + t * 0.7) * 0.12, uv.y * 7.0 - t * 1.2));
          float licks = smoothstep(0.54, 0.86, convection) * smoothstep(0.80, 0.08, uv.y) * smoothstep(0.00, 0.20, uv.y);

          vec2 p = vec2(uPointer.x, 1.0 - uPointer.y);
          vec2 dp = vec2((uv.x - p.x) * aspect, uv.y - p.y);
          float local = exp(-dot(dp, dp) / 0.030) * uPointerActive;
          float pressure = exp(-dot(dp, dp) / 0.052) * uPress;

          float heat = bed * (0.18 + coal * 0.36);
          heat += horizon * smoothstep(0.62, 0.94, fissure) * 0.46;
          heat += plume * 0.18 + licks * 0.42;
          heat += local * (0.22 + uPress * 0.45);
          heat += pressure * 0.46;
          heat += uIgnition * smoothstep(0.86, 0.0, uv.y) * (0.16 + plumeNoise * 0.28);
          // season: the hearth's slow cycle banks the bed down toward embers
          // and ash the further toward winter it turns.
          heat *= mix(1.15, 0.5, uSeason);
          heat = clamp(heat, 0.0, 1.0);

          vec3 bgTop = vec3(0.012, 0.010, 0.014);
          vec3 bgLow = vec3(0.075, 0.023, 0.010);
          vec3 col = mix(bgLow, bgTop, smoothstep(0.0, 0.82, uv.y));
          col += vec3(0.11, 0.035, 0.018) * horizon * (0.35 + coal * 0.45);
          col = mix(col, blackbody(heat), smoothstep(0.035, 0.88, heat));

          float shimmer = fbm(vec2(uv.x * aspect * 18.0 + t * 0.5, uv.y * 30.0 - t * 1.7));
          col += vec3(0.16, 0.07, 0.025) * plume * (shimmer - 0.36) * 0.25;
          col += pressure * vec3(0.18, 0.20, 0.24);

          float ash = hash21(gl_FragCoord.xy + floor(t * 9.0));
          col += (ash - 0.5) * 0.018;
          float vignette = smoothstep(0.92, 0.18, distance(vUv, vec2(0.50, 0.54)));
          col *= 0.74 + vignette * 0.30;

          // the lens: fold in a false-colour pressure/temperature diagram —
          // the same heat field, read as a map instead of felt as a flame.
          if (uLens > 0.001) {
            vec3 cold = vec3(0.03, 0.05, 0.22);
            vec3 hot = vec3(0.95, 0.12, 0.05);
            vec3 diagram = mix(cold, hot, heat);
            float iso = smoothstep(0.985, 1.0, fract(heat * 9.0));
            diagram += iso * 0.5;
            col = mix(col, diagram, clamp(uLens, 0.0, 1.0));
          }

          // shared 7s album breath: the hearth's ambient rides ±10% on the
          // site's respiration so /fire inhales with /reef and /root.
          col *= 1.0 + 0.10 * (uBreath - 0.5);

          gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
        }
      `;

      const compile = (type: number, src: string) => {
        const shader = gl.createShader(type);
        if (!shader) return null;
        gl.shaderSource(shader, src);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          console.warn("fire shader compile failed", gl.getShaderInfoLog(shader));
          gl.deleteShader(shader);
          return null;
        }
        return shader;
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
            program = p;
            uTimeLoc = gl.getUniformLocation(p, "uTime");
            uResLoc = gl.getUniformLocation(p, "uRes");
            uPointerLoc = gl.getUniformLocation(p, "uPointer");
            uPointerActiveLoc = gl.getUniformLocation(p, "uPointerActive");
            uPressLoc = gl.getUniformLocation(p, "uPress");
            uWindLoc = gl.getUniformLocation(p, "uWind");
            uIgnitionLoc = gl.getUniformLocation(p, "uIgnition");
            uLensLoc = gl.getUniformLocation(p, "uLens");
            uSeasonLoc = gl.getUniformLocation(p, "uSeason");
            uPanLoc = gl.getUniformLocation(p, "uPan");
            uBreathLoc = gl.getUniformLocation(p, "uBreath");

            const buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
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

    // WebGL context can be lost (mobile GPU pressure, background tabs) and
    // restored later — reinit the program rather than staying dark forever.
    const onContextLost = (ev: Event) => {
      ev.preventDefault();
      program = null;
    };
    const onContextRestored = () => {
      setupProgram();
    };
    heatCanvas.addEventListener("webglcontextlost", onContextLost, false);
    heatCanvas.addEventListener("webglcontextrestored", onContextRestored, false);

    const embedded = isEmbeddedFrame();
    // Stable across the component's lifetime — hoisted so resolveDpr()
    // calls (including the per-frame fallback path) don't allocate a
    // fresh options object every time.
    const dprOpts = { embedded, reducedMotion: reduce };
    const gov = createFrameGovernor(embedded ? "medium" : "high");
    let hidden = document.hidden;
    let galleryPaused = false;
    let asleep = false;
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

    const resize = () => {
      const dpr = resolveDpr(gov.tier(), dprOpts);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      heatCanvas.width = Math.floor(w * dpr);
      heatCanvas.height = Math.floor(h * dpr);
      fxCanvas.width = Math.floor(w * dpr);
      fxCanvas.height = Math.floor(h * dpr);
      fx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (gl) gl.viewport(0, 0, heatCanvas.width, heatCanvas.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const emberPool: Ember[] = Array.from({ length: 320 }, () => ({
      alive: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 1,
      radius: 1,
      hue: 0,
    }));
    const wells: PressureWell[] = [];
    const strokes: HeatStroke[] = [];

    // Ember halos used to allocate a fresh createRadialGradient per ember
    // per frame — on a busy bed that is upwards of 90 gradient objects a
    // frame in a loop the paint test cannot see textually. Follow the
    // Stars/Charts sprite-cache pattern: bake three tinted 128×128 alpha
    // halos once, blit with drawImage under lighter composition and let
    // globalAlpha carry per-ember intensity. `hot` picks the yellow-white
    // core; older embers desaturate through the amber and dusk variants.
    const EMBER_SPRITE_R = 64;
    const bakeEmberHalo = (r: number, g: number, b: number): HTMLCanvasElement => {
      const c = document.createElement("canvas");
      const S = EMBER_SPRITE_R * 2;
      c.width = S;
      c.height = S;
      const sctx = c.getContext("2d");
      if (sctx) {
        const grad = sctx.createRadialGradient(
          EMBER_SPRITE_R, EMBER_SPRITE_R, 0,
          EMBER_SPRITE_R, EMBER_SPRITE_R, EMBER_SPRITE_R,
        );
        grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 1)`);
        grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
        sctx.fillStyle = grad;
        sctx.fillRect(0, 0, S, S);
      }
      return c;
    };
    const emberHaloHot = bakeEmberHalo(255, 232, 150);   // hot yellow-white core
    const emberHaloWarm = bakeEmberHalo(240, 165, 90);   // fading amber
    const emberHaloAsh = bakeEmberHalo(150, 90, 60);     // cool ashy dusk

    // ── the bed's own fuel, a coarse strip along its width ────────────
    // Real combustion, not a decal: every well burns down the fuel under
    // it, starves and dies early where the bed is bare, and a well hot
    // enough spreads to a fuel-rich neighbour on its own. Fuel slowly
    // regrows over the room's slow cycle, so the bed is never permanently
    // spent. This is the pure state Task 2 asks for — deterministic,
    // fed only by taps and by the wells that already exist.
    const FUEL_N = 28;
    const fuel = new Float32Array(FUEL_N).fill(1);
    const fuelIndex = (nx: number) => Math.max(0, Math.min(FUEL_N - 1, Math.round(nx * (FUEL_N - 1))));
    const fuelAt = (nx: number) => fuel[fuelIndex(nx)];
    const addFuel = (nx: number, amount: number) => {
      const i0 = fuelIndex(nx);
      for (let d = -1; d <= 1; d++) {
        const i = i0 + d;
        if (i < 0 || i >= FUEL_N) continue;
        fuel[i] = Math.min(1, fuel[i] + amount * (d === 0 ? 1 : 0.4));
      }
    };
    let lastSpreadAt = 0;

    let nextId = 1;
    let emberHint = 0;
    let activeStroke: HeatStroke | null = null;
    let windTarget = 0;
    let wind = 0;
    let ignitionAmp = 0.2;
    let lastMarkSync = 0;

    // ── the room's clock + law-layer state (gesture grammar) ──────
    // Three fingers held dilate time; three fingers dragged push the
    // wind; a steady tapped pulse entrains the bed; a circling finger
    // whirls the embers. Thresholds live in gesture/core alone.
    let timeScale = 1;
    let timeScaleTarget = 1;
    let simT = 0;                    // warped seconds — the shader clock
    let simNow = performance.now();  // warped ms — stroke/well/ember ages
    let ignitionT0 = simNow;
    let gutter = 0;                  // 3-finger gust momentarily dims the flame
    let lastGutterAt = 0;
    let entrainBpm = 0;
    let entrainUntil = 0;
    let lastEntrainBeat = -1;
    let lastScrubAt = 0;
    let lastSpanVoiceAt = 0;
    let lastGestureAt = performance.now();
    const holdState = { ceremony: false };

    // ── the map layer (two fingers) and the vessel ─────────────────
    let lens = 0; // 0 felt flame, 1 the pressure/heat field as a diagram
    let season = 0; // 0 roaring, 1 banked low — the hearth's slow cycle
    let panX = 0;
    let panY = 0;
    let panXTarget = 0;
    let panYTarget = 0;
    let bank = 0; // face-down night: the fire banks itself down
    let bankTarget = 0;

    const spawnEmber = (x: number, y: number, vx: number, vy: number, strength = 1) => {
      for (let tries = 0; tries < emberPool.length; tries++) {
        const idx = (emberHint + tries) % emberPool.length;
        const ember = emberPool[idx];
        if (!ember.alive) {
          ember.alive = true;
          ember.x = x;
          ember.y = y;
          ember.vx = vx;
          ember.vy = vy;
          ember.maxLife = 1.1 + Math.random() * 3.8;
          ember.life = ember.maxLife;
          ember.radius = (0.45 + Math.random() * 1.65) * strength;
          ember.hue = Math.random();
          emberHint = idx + 1;
          return;
        }
      }
    };

    const burst = (x: number, y: number, count: number, strength = 1) => {
      for (let i = 0; i < count; i++) {
        const angle = -Math.PI * 0.5 + (Math.random() - 0.5) * Math.PI * 1.45;
        const speed = (70 + Math.random() * 260) * strength;
        spawnEmber(
          x,
          y,
          Math.cos(angle) * speed + wind * 90,
          Math.sin(angle) * speed,
          0.8 + strength * 0.7,
        );
      }
    };

    const addWell = (x: number, y: number, strength: number) => {
      wells.push({
        id: ++nextId,
        x,
        y,
        t0: simNow,
        strength,
        radius: 120 + strength * 120,
      });
      // At the population cap the oldest gives way rather than the touch
      // silently doing nothing.
      if (wells.length > 8) wells.shift();
      setHasBuilt(true);
    };

    /** Ceremony hold ON an existing well is its solemn act — snuffed out
     * immediately rather than left to fade, a small dark puff answering. */
    const extinguishWellNear = (x: number, y: number): boolean => {
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 0; i < wells.length; i++) {
        const d = Math.hypot(wells[i].x - x, wells[i].y - y);
        if (d < wells[i].radius * 0.7 && d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestIdx < 0) return false;
      const well = wells[bestIdx];
      wells.splice(bestIdx, 1);
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2;
        spawnEmber(well.x + Math.cos(a) * 6, well.y + Math.sin(a) * 6, Math.cos(a) * 16, -20 - Math.random() * 20, 0.35);
      }
      setHasBuilt(wells.length > 0);
      return true;
    };

    clearAllRef.current = () => {
      wells.length = 0;
      strokes.length = 0;
      for (const e of emberPool) e.alive = false;
      ignitionAmp = 0;
      windTarget = 0;
      gutter = 0;
      setHasBuilt(false);
    };

    const beginStroke = (x: number, y: number) => {
      activeStroke = {
        id: ++nextId,
        points: [{ x, y, t: performance.now() }],
        t0: simNow,
        releasedAt: null,
        strength: 0.08,
        hue: Math.random(),
      };
      strokes.push(activeStroke);
      if (strokes.length > 12) strokes.shift();
    };

    const extendStroke = (x: number, y: number) => {
      if (!activeStroke) return;
      const pts = activeStroke.points;
      const last = pts[pts.length - 1];
      const dx = x - last.x;
      const dy = y - last.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 4) return;
      const dt = Math.max(0.016, (performance.now() - last.t) / 1000);
      activeStroke.strength = clamp(activeStroke.strength + dist / 220, 0, 1);
      pts.push({ x, y, t: performance.now() });
      if (pts.length > 54) pts.shift();
      windTarget = clamp(windTarget + (dx / dt) / 3400, -1, 1);
      if (Math.random() < 0.35) spawnEmber(x, y, dx * 3 + wind * 80, -40 - Math.random() * 70, 0.8);
    };

    const releaseStroke = (record = true) => {
      if (!activeStroke) return;
      activeStroke.releasedAt = simNow;
      if (record && activeStroke.points.length > 5) {
        haptics.ripple(0.24 + activeStroke.strength * 0.30);
        useField.getState().recordTape("region", 0.32 + activeStroke.strength * 0.42, "fire/convection");
        markFire("convection", "#f0a44f", 0.42 + activeStroke.strength * 0.42);
      }
      activeStroke = null;
    };

    const toLocal = (clientX: number, clientY: number) => {
      const rect = fxCanvas.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      return { x: clientX - rect.left, y: clientY - rect.top, w, h };
    };

    const trackPointer = (clientX: number, clientY: number) => {
      const p = toLocal(clientX, clientY);
      pointerRef.current.x = clamp(p.x / p.w, 0, 1);
      pointerRef.current.y = clamp(p.y / p.h, 0, 1);
      pointerRef.current.over = true;
      return p;
    };

    // ── gestures (the shared grammar — src/lib/gesture) ─────────────
    // One finger touches the fire: tap seeds an ember, drag bends
    // convection, dwell compresses white heat, ceremony blooms it fully
    // (or, over an existing well, snuffs it — the touch-reachable delete).
    // Two fingers touch the map: twist reads the bed as a felt flame or a
    // pressure/heat diagram; drag pans the frame's lean; tap steps back.
    // Three fingers touch the law: drag is crosswind, hold slows time,
    // twist turns the hearth's slow season, tap is tutti.
    const detachGestures = attachGestures(fxCanvas, {
      tap: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers === 2) {
          // step back: lower a raised lens, else the fire eases off its lean.
          // ScaleTravel (document.body) reads data-lens-raised to know
          // whether this tap should lower the lens instead of stepping the
          // scale back — the two never both answer the same tap.
          if (lens > 0.02) {
            lens = 0;
            wrap.dataset.lensRaised = "";
          } else {
            panXTarget = 0;
            panYTarget = 0;
            windTarget *= 0.4;
          }
          haptics.tap();
          return;
        }
        if (e.fingers === 3) {
          // tutti — everything alive answers softly at once
          ignitionAmp = Math.max(ignitionAmp, 0.4 + e.intensity * 0.2);
          ignitionT0 = simNow;
          for (const well of wells) well.strength = Math.min(1, well.strength + 0.15);
          try { audio.chime(); } catch { /* noop */ }
          haptics.ripple(0.4);
          markFire("tutti", "#ffe4b8", 0.7);
          return;
        }
        const p = trackPointer(e.x, e.y);
        // rapid-tap ladder (tiers 1 / 3 / 5 / n from gesture/core): ember →
        // spark fountain → the draft opens → the whole bed roars. Depth keeps
        // rising between rungs, so tap seven and tap nine are not the same.
        const tier = tapTrainTier(e.count);
        const depth = tapTrainDepth(e.count);
        if (tier === "n") {
          // crescendo: the bed roars — every well brightens, the flame leaps
          for (const well of wells) well.strength = Math.min(1, well.strength + 0.2 + depth * 0.2);
          burst(p.x, p.y, 26 + Math.round(depth * 18), 1.1 + depth * 0.5);
          ignitionAmp = Math.max(ignitionAmp, 0.7 + depth * 0.3);
          ignitionT0 = simNow;
          try { audio.playNote(48 + Math.round(depth * 12), 240); } catch { /* noop */ }
          try { haptics.storm(); } catch { /* noop */ }
          markFire("the bed roars", "#ffe4b8", 0.85 + depth * 0.15);
          useField.getState().recordTape("ripple", 0.8 + depth * 0.2, "fire/roar");
          return;
        }
        if (tier === 5) {
          // tier 5 — the bed's biggest reachable event: flashover. Fuel
          // permitting, the whole width catches at once — a real chain
          // ignition read off the fuel bed, not a fixed pattern
          for (let i = 0; i < 18; i++) {
            const off = (i / 18 - 0.5) * 26;
            spawnEmber(p.x + off, p.y + Math.abs(off) * 0.4, off * 0.6 + wind * 40, -(240 + Math.random() * 200) * (0.8 + depth * 0.4), 1);
          }
          const lanes = 6;
          for (let i = 0; i < lanes; i++) {
            const nx = (i + 0.5) / lanes;
            if (fuelAt(nx) < 0.18) continue; // bare ground doesn't catch
            addWell(nx * p.w, p.h * (0.78 + (i % 2) * 0.05), 0.7 + depth * 0.3);
            addFuel(nx, -0.3); // the flashover itself burns down what it just lit
          }
          ignitionAmp = Math.max(ignitionAmp, 0.5 + e.intensity * 0.2 + depth * 0.2);
          ignitionT0 = simNow;
          try { audio.chime(); } catch { /* noop */ }
          try { audio.thud(); } catch { /* noop */ }
          try { haptics.storm(); } catch { /* noop */ }
          markFire("flashover", "#dcecff", 0.7 + depth * 0.2);
          useField.getState().recordTape("ripple", 0.6 + depth * 0.2, "fire/flashover");
          return;
        }
        if (tier === 3) {
          // tier 3, near an existing well: it sparks a new flame off itself
          // — a real child well, not a decal spark. On bare bed: fuel is
          // laid down instead of ignition, so the next strike has something
          // to catch.
          let nearest: PressureWell | null = null;
          let nearestD = 90;
          for (const well of wells) {
            const d = Math.hypot(well.x - p.x, well.y - p.y);
            if (d < nearestD) { nearestD = d; nearest = well; }
          }
          burst(p.x, p.y, 16 + Math.round(depth * 10), 0.85 + e.intensity * 0.4 + depth * 0.3);
          if (nearest) {
            const ang = Math.random() * Math.PI * 2;
            const childX = clamp(nearest.x + Math.cos(ang) * 40, 8, p.w - 8);
            addWell(childX, nearest.y + Math.sin(ang) * 18, nearest.strength * 0.7);
            markFire("a flame sparks", "#f5b15a", 0.6 + depth * 0.25);
          } else {
            addFuel(p.x / Math.max(1, p.w), 0.35 + depth * 0.2);
            markFire("fuel laid down", "#c8927a", 0.45 + depth * 0.2);
          }
          ignitionAmp = Math.max(ignitionAmp, 0.38 + e.intensity * 0.2 + depth * 0.15);
          ignitionT0 = simNow;
          try { audio.spark(); } catch { /* noop */ }
          try { haptics.chop(); } catch { /* noop */ }
          return;
        }
        // tap intensity is the strike: ember count, ignition and haptic
        // all ride the same 0..1 from core.
        const yBias = p.h * (0.70 + Math.random() * 0.22);
        burst(p.x, p.y > p.h * 0.84 ? p.y : Math.max(p.y, yBias), 8 + Math.round(e.intensity * 7), 0.55 + e.intensity * 0.4);
        ignitionAmp = Math.max(ignitionAmp, 0.28 + e.intensity * 0.18);
        ignitionT0 = simNow;
        try { audio.spark(); } catch { /* noop */ }
        haptics.ripple(0.2 + e.intensity * 0.36);
        markFire("ember", "#f08d3f", 0.4 + e.intensity * 0.3);
        useField.getState().recordTape("object", 0.3 + e.intensity * 0.25, "fire/ember");
      },
      drag: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers === 3) {
          if (e.phase === "end") return;
          // three fingers drag the weather: the flame leans hard into the
          // crosswind, and a strong gust makes it gutter before it recovers
          windTarget = clamp(windTarget + e.vx * 0.2, -1, 1);
          const nowMs = performance.now();
          if (Math.abs(e.vx) > 0.35 && nowMs - lastGutterAt > 2600) {
            lastGutterAt = nowMs;
            gutter = 1;
            const p = toLocal(e.x, e.y);
            for (let i = 0; i < 10; i++) {
              spawnEmber(
                Math.random() * p.w,
                p.h * (0.72 + Math.random() * 0.2),
                Math.sign(e.vx) * (120 + Math.random() * 160),
                -(10 + Math.random() * 40),
                0.7,
              );
            }
            try { audio.playNote(38, 260); } catch { /* noop */ }
            try { haptics.chop(); } catch { /* noop */ }
            markFire("crosswind", "#c8927a", 0.5 + Math.min(0.4, Math.abs(e.vx) * 0.3));
          }
          return;
        }
        if (e.fingers !== 1) return;
        const p = trackPointer(e.x, e.y);
        if (e.phase === "start") {
          pointerRef.current.pressed = true;
          pointerRef.current.pressStart = performance.now();
          beginStroke(p.x, p.y);
          haptics.tap();
          markFire("pressure", "#f5b15a", 0.46);
          return;
        }
        if (e.phase === "end") {
          pointerRef.current.pressed = false;
          const strokeStrength = activeStroke?.strength ?? 0;
          if (strokeStrength > 0.25) {
            ignitionAmp = Math.max(ignitionAmp, 0.34 + strokeStrength * 0.26);
            ignitionT0 = simNow;
            try { audio.spark(); } catch { /* noop */ }
          }
          releaseStroke(true);
          return;
        }
        extendStroke(p.x, p.y);
      },
      flick: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers !== 1) return;
        // a flick throws sparks — a comet of embers hurled the flick's way
        const p = trackPointer(e.x, e.y);
        const sp = Math.min(420, 160 + e.speed * 260);
        for (let i = 0; i < 14; i++) {
          const jitter = (Math.random() - 0.5) * 0.5;
          spawnEmber(
            p.x, p.y,
            Math.cos(e.angle + jitter) * sp * (0.5 + Math.random() * 0.7),
            Math.sin(e.angle + jitter) * sp * (0.5 + Math.random() * 0.7) - 40,
            0.9,
          );
        }
        pointerRef.current.pressed = false;
        releaseStroke(true);
        try { audio.spark(); } catch { /* noop */ }
        try { haptics.chop(); } catch { /* noop */ }
        markFire("thrown sparks", "#f5b15a", 0.6);
        useField.getState().recordTape("ripple", 0.55, "fire/throw");
      },
      hold: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers === 3) {
          // three fingers hold the law: time keeps thickening for as long as
          // the hand stays — a hold at 900ms and one at 2400ms are different
          // depths of the same stillness, never one switch.
          if (e.phase === "release") {
            timeScaleTarget = 1;
            return;
          }
          timeScaleTarget = 1 - 0.82 * clamp(e.elapsed / 2600, 0, 1);
          if (e.phase === "enter") {
            try { audio.playNote(36, 260); } catch { /* noop */ }
            try { haptics.tap(); } catch { /* noop */ }
          }
          return;
        }
        if (e.fingers !== 1) return;
        const p = trackPointer(e.x, e.y);
        if (e.phase === "enter") {
          holdState.ceremony = false;
          pointerRef.current.pressed = true;
          pointerRef.current.pressStart = performance.now() - e.elapsed;
          haptics.tap();
          markFire("pressure", "#f5b15a", 0.46);
          return;
        }
        if (e.phase === "release") {
          pointerRef.current.pressed = false;
          // dwell tier — the compressed field breaks into white heat
          // (was a private 720ms constant; the threshold now lives in core)
          if (e.tier >= 2 && !holdState.ceremony) {
            const charge = clamp(e.elapsed / 1800, 0, 1);
            addWell(p.x, p.y, 0.45 + charge * 0.55);
            burst(p.x, p.y, 16 + Math.round(charge * 24), 0.9 + charge * 0.75);
            ignitionAmp = Math.max(ignitionAmp, 0.55 + charge * 0.35);
            ignitionT0 = simNow;
            audio.thud();
            window.setTimeout(() => {
              try { audio.bell(); } catch { /* noop */ }
            }, 180);
            haptics.storm();
            markFire("white heat", "#dcecff", 0.82 + charge * 0.16);
            useField.getState().recordTape("sigil", 0.78 + charge * 0.16, "fire/white-heat");
          }
          return;
        }
        // ceremony tier — the room's one solemn act: over an existing well
        // it is annihilated (the touch-reachable delete); over open bed the
        // pyre blooms fully, white through the whole bed, and is kept.
        if (e.tier >= 3 && !holdState.ceremony) {
          holdState.ceremony = true;
          if (extinguishWellNear(p.x, p.y)) {
            try { audio.thud(); } catch { /* noop */ }
            try { haptics.chop(); } catch { /* noop */ }
            markFire("snuffed", "#5a4438", 0.3);
            useField.getState().recordTape("sigil", 0.3, "fire/extinguish");
          } else {
            addWell(p.x, p.y, 1);
            burst(p.x, p.y, 44, 1.5);
            ignitionAmp = 1;
            ignitionT0 = simNow;
            try { audio.bell(); } catch { /* noop */ }
            try { haptics.bloom(); } catch { /* noop */ }
            markFire("sealed in white", "#dcecff", 1);
            useField.getState().recordTape("sigil", 1, "fire/ceremony");
          }
        }
      },
      twist: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers === 3) {
          // three-finger twist: advance/rewind the hearth's slow season
          season = clamp(season + e.angle * 0.12, 0, 1);
          return;
        }
        // two-finger twist rotates the lens — felt flame ↔ heat diagram
        lens = clamp(lens + e.angle * 0.4, 0, 1);
        wrap.dataset.lensRaised = lens > 0.02 ? "1" : "";
      },
      pan2: (e) => {
        lastGestureAt = performance.now();
        // two fingers pan the frame — the bed leans inside the stage
        panXTarget = clamp(panXTarget + e.dx * 0.0006, -0.14, 0.14);
        panYTarget = clamp(panYTarget + e.dy * 0.0006, -0.1, 0.1);
      },
      scrub: (e) => {
        lastGestureAt = performance.now();
        const nowMs = performance.now();
        if (nowMs - lastScrubAt < 700) return;
        lastScrubAt = nowMs;
        // circling stirs a fire whirl — embers caught in a turning column
        const p = toLocal(e.cx, e.cy);
        const sgn = Math.sign(e.winding) || 1;
        for (let i = 0; i < 22; i++) {
          const a = (i / 22) * Math.PI * 2;
          const r0 = 12 + Math.random() * 34;
          spawnEmber(
            p.x + Math.cos(a) * r0,
            p.y + Math.sin(a) * r0 * 0.6,
            -Math.sin(a) * sgn * (90 + Math.random() * 90),
            Math.cos(a) * sgn * 40 - (60 + Math.random() * 80),
            0.85,
          );
        }
        ignitionAmp = Math.max(ignitionAmp, 0.3);
        ignitionT0 = simNow;
        try { audio.playNote(55, 150); } catch { /* noop */ }
        try { haptics.ripple(0.35); } catch { /* noop */ }
        markFire("whirl", "#f0a44f", 0.6);
        useField.getState().recordTape("ripple", 0.5, "fire/whirl");
      },
      span: (e) => {
        lastGestureAt = performance.now();
        // two still fingers are the bellows: they hold a channel of draft
        // open, and the bed between the fingertips brightens and streams
        // sparks up the interval for as long as it is sustained — deeper the
        // longer it is held, wider the further the fingers stand apart.
        if (e.phase === "release") {
          releaseStroke(false);
          try { haptics.ripple(0.2 + clamp(e.elapsed / 4000, 0, 1) * 0.3); } catch { /* noop */ }
          markFire("bellows eased", "#c8927a", 0.35 + clamp(e.elapsed / 4000, 0, 1) * 0.3);
          return;
        }
        const a = toLocal(e.ax, e.ay);
        const b = toLocal(e.bx, e.by);
        const deep = clamp(e.elapsed / 3200, 0, 1);
        if (e.phase === "enter") {
          try { audio.playNote(41, 320); } catch { /* noop */ }
          try { haptics.tap(); } catch { /* noop */ }
          markFire("bellows", "#f0a44f", 0.5);
          useField.getState().recordTape("region", 0.45, "fire/bellows");
        }
        const nowMs = performance.now();
        if (nowMs - lastSpanVoiceAt > 260) {
          lastSpanVoiceAt = nowMs;
          // sparks stream up the held interval, more of them the deeper the
          // sustain; the drawn note climbs the same axis.
          const n = 3 + Math.round(deep * 6);
          for (let i = 0; i < n; i++) {
            const u = (i + 0.5) / n;
            spawnEmber(
              a.x + (b.x - a.x) * u,
              a.y + (b.y - a.y) * u,
              (Math.random() - 0.5) * 30 + wind * 60,
              -(70 + deep * 200 + Math.random() * 70),
              0.6 + deep * 0.6,
            );
          }
          ignitionAmp = Math.max(ignitionAmp, 0.24 + deep * 0.42);
          ignitionT0 = simNow;
          try { audio.playNote(41 + Math.round(deep * 14), 180); } catch { /* noop */ }
          try { haptics.ripple(0.12 + deep * 0.3); } catch { /* noop */ }
        }
      },
      rhythm: (e) => {
        // a steady tapped pulse: the bed's breath falls in with the hand
        if (e.stability <= 0.7) return;
        entrainBpm = Math.max(40, Math.min(120, e.bpm));
        entrainUntil = performance.now() + 9000;
      },
    }, { wheelZoom: false });

    // ── the vessel: the phone's own body is the hearth's other hand ──
    const detachVessel = onVessel({
      tilt: ({ gamma }) => {
        if (reduce || asleep) return;
        windTarget = clamp(windTarget + gamma * 0.0009, -1, 1);
      },
      shake: ({ intensity }) => {
        if (reduce || asleep) return;
        gutter = Math.min(1, gutter + intensity * 0.6);
        const w = fxCanvas.clientWidth;
        const h = fxCanvas.clientHeight;
        for (let i = 0; i < 12; i++) {
          spawnEmber(Math.random() * w, h * (0.7 + Math.random() * 0.25), (Math.random() - 0.5) * 220, -(40 + Math.random() * 90), 0.9);
        }
        try { audio.thud(); } catch { /* noop */ }
        try { haptics.storm(); } catch { /* noop */ }
        markFire("scattered", "#f5b15a", 0.7);
      },
      knock: ({ intensity }) => {
        if (reduce || asleep) return;
        ignitionAmp = Math.max(ignitionAmp, 0.3 + intensity * 0.3);
        ignitionT0 = simNow;
        try { audio.spark(); } catch { /* noop */ }
        try { haptics.tap(); } catch { /* noop */ }
      },
      flip: ({ faceDown }) => {
        // night: the fire banks itself down until the phone turns back up
        bankTarget = faceDown ? 1 : 0;
      },
    });

    // Desktop hover is the grammar's quiet dialect (hover ≈ light touch):
    // heat shimmer still gathers under a passing hand. All contact
    // gestures live in the engine above.
    const onHover = (e: PointerEvent) => {
      trackPointer(e.clientX, e.clientY);
    };
    const onHoverLeave = () => {
      pointerRef.current.over = false;
    };
    fxCanvas.addEventListener("pointermove", onHover);
    fxCanvas.addEventListener("pointerleave", onHoverLeave);

    let raf = 0;
    let lastFrame = performance.now();
    let emberAcc = 0;
    let pressSmoothed = 0;

    const drawStroke = (stroke: HeatStroke, now: number) => {
      if (stroke.points.length < 2) return;
      const age = stroke.releasedAt ? (now - stroke.releasedAt) / 1000 : 0;
      const fade = stroke.releasedAt ? clamp(1 - age / 2.8, 0, 1) : 1;
      if (fade <= 0) return;
      const alpha = fade * (0.14 + stroke.strength * 0.24);
      fx.save();
      fx.globalCompositeOperation = "screen";
      fx.lineCap = "round";
      fx.lineJoin = "round";
      for (let pass = 0; pass < 2; pass++) {
        fx.strokeStyle = pass === 0
          ? `rgba(128, 34, 14, ${(alpha * 0.50).toFixed(3)})`
          : stroke.hue > 0.58
            ? `rgba(245, 174, 73, ${(alpha * 0.72).toFixed(3)})`
            : `rgba(176, 74, 38, ${(alpha * 0.64).toFixed(3)})`;
        fx.lineWidth = pass === 0 ? 24 + stroke.strength * 36 : 1.2 + stroke.strength * 3;
        fx.beginPath();
        const pts = stroke.points;
        fx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length - 1; i++) {
          const midX = (pts[i].x + pts[i + 1].x) * 0.5;
          const midY = (pts[i].y + pts[i + 1].y) * 0.5;
          fx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
        }
        const last = pts[pts.length - 1];
        fx.lineTo(last.x, last.y);
        fx.stroke();
      }
      fx.restore();
    };

    const drawWell = (well: PressureWell, now: number) => {
      const age = (now - well.t0) / 1000;
      const life = 3.8 + well.strength * 1.4;
      const fade = clamp(1 - age / life, 0, 1);
      if (fade <= 0) return;
      const pulse = 1 + Math.sin(age * 5.4) * 0.025;
      const r = well.radius * pulse * (0.86 + age * 0.10);
      fx.save();
      fx.globalCompositeOperation = "source-over";
      const char = fx.createRadialGradient(well.x, well.y, 0, well.x, well.y, r);
      char.addColorStop(0, `rgba(4, 3, 4, ${(0.44 * fade * well.strength).toFixed(3)})`);
      char.addColorStop(0.42, `rgba(62, 12, 8, ${(0.18 * fade * well.strength).toFixed(3)})`);
      char.addColorStop(1, "rgba(4, 3, 4, 0)");
      fx.fillStyle = char;
      fx.beginPath();
      fx.ellipse(well.x, well.y, r, r * 0.38, -0.04, 0, Math.PI * 2);
      fx.fill();

      fx.globalCompositeOperation = "screen";
      const core = fx.createRadialGradient(well.x - r * 0.08, well.y - r * 0.08, 0, well.x, well.y, r * 0.58);
      core.addColorStop(0, `rgba(218, 235, 255, ${(0.36 * fade * well.strength).toFixed(3)})`);
      core.addColorStop(0.28, `rgba(255, 190, 88, ${(0.18 * fade * well.strength).toFixed(3)})`);
      core.addColorStop(1, "rgba(255, 190, 88, 0)");
      fx.fillStyle = core;
      fx.beginPath();
      fx.ellipse(well.x - r * 0.08, well.y - r * 0.08, r * 0.42, r * 0.16, 0.08, 0, Math.PI * 2);
      fx.fill();
      fx.restore();
    };

    const draw = (now: number) => {
      const tier = gov.beginFrame(now);
      if (asleep) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const detail = detailForTier(tier);
      const w = fxCanvas.clientWidth;
      const h = fxCanvas.clientHeight;
      const dt = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      // three-finger time dilation: the room's clock eases to ~1/4 speed
      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dt * 5);
      simT += (reduce ? 0 : dt) * timeScale;
      simNow += dt * 1000 * timeScale;
      const elapsed = reduce ? 0 : simT;
      const step = reduce ? 0 : dt * timeScale;

      if (!pointerRef.current.pressed) windTarget *= Math.pow(0.001, dt / 2.4);
      wind += (windTarget - wind) * Math.min(1, dt * 4.5);
      gutter *= Math.exp(-dt * 2.4);
      panX += (panXTarget - panX) * Math.min(1, dt * 3);
      panY += (panYTarget - panY) * Math.min(1, dt * 3);
      bank += (bankTarget - bank) * Math.min(1, dt * 1.2);

      const held = pointerRef.current.pressed ? (now - pointerRef.current.pressStart) / 1000 : 0;
      const pressTarget = pointerRef.current.pressed ? clamp(held / 1.35, 0, 1) : 0;
      pressSmoothed += (pressTarget - pressSmoothed) * 0.12;

      // rhythm entrainment: while a steady tapped pulse holds, the bed
      // kicks a small ignition breath on every beat, with its own note —
      // sight and sound land in the same frame.
      if (performance.now() < entrainUntil && entrainBpm > 0) {
        const beatLen = 60 / entrainBpm;
        const beatIdx = Math.floor(simT / beatLen);
        if (beatIdx !== lastEntrainBeat) {
          lastEntrainBeat = beatIdx;
          ignitionAmp = Math.max(ignitionAmp, 0.32);
          ignitionT0 = simNow;
          try { audio.playNote(50 + (beatIdx % 2) * 7, 120); } catch { /* noop */ }
        }
      }

      const ignitionAge = (simNow - ignitionT0) / 1000;
      const ignition = Math.max(0, (ignitionAmp * Math.exp(-ignitionAge * 2.2) - gutter * 0.4) * (1 - bank * 0.85));
      if (ignition < 0.01 && ignitionAmp > 0.01 && gutter < 0.02) ignitionAmp = 0;

      if (now - lastMarkSync > 140) {
        lastMarkSync = now;
        setHeatReadout(clamp(0.26 + ignition * 0.44 + pressSmoothed * 0.22 + Math.abs(wind) * 0.10, 0, 1));
      }

      if (gl && program) {
        gl.useProgram(program);
        // shared album clocks: the hearth inhales in step with /reef, /root.
        const { breath } = clocksFrom({ time: now / 1000, turbulence: pressSmoothed, reducedMotion: reduce });
        if (uTimeLoc) gl.uniform1f(uTimeLoc, elapsed);
        if (uBreathLoc) gl.uniform1f(uBreathLoc, breath);
        if (uResLoc) gl.uniform2f(uResLoc, heatCanvas.width, heatCanvas.height);
        if (uPointerLoc) gl.uniform2f(uPointerLoc, pointerRef.current.x, pointerRef.current.y);
        if (uPointerActiveLoc) gl.uniform1f(uPointerActiveLoc, pointerRef.current.over ? 1 : 0);
        if (uPressLoc) gl.uniform1f(uPressLoc, pressSmoothed);
        if (uWindLoc) gl.uniform1f(uWindLoc, wind);
        if (uIgnitionLoc) gl.uniform1f(uIgnitionLoc, ignition);
        if (uLensLoc) gl.uniform1f(uLensLoc, lens);
        if (uSeasonLoc) gl.uniform1f(uSeasonLoc, clamp(season + bank * 0.5, 0, 1));
        if (uPanLoc) gl.uniform2f(uPanLoc, panX, panY);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } else {
        const ctx = fallback2dCtx;
        if (ctx) {
          const dpr = resolveDpr(tier, dprOpts);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          // Same two stops every time — only the height they span can
          // change (on resize), so rebuild the gradient just then instead
          // of once per frame.
          if (!cachedBgGradient || cachedBgGradientH !== h) {
            cachedBgGradientH = h;
            cachedBgGradient = ctx.createLinearGradient(0, 0, 0, h);
            cachedBgGradient.addColorStop(0, "#050304");
            cachedBgGradient.addColorStop(1, "#250b05");
          }
          ctx.fillStyle = cachedBgGradient;
          ctx.fillRect(0, 0, w, h);
        }
      }

      fx.clearRect(0, 0, w, h);

      // ── the fire's own laws: fuel, starving, spreading, merging ──────
      if (!reduce && w > 0) {
        // every well burns down the fuel it sits on, and starves early
        // where the bed is already bare — the strength that drawWell and
        // the shader read is a real function of what's left to burn
        for (const well of wells) {
          const nx = well.x / w;
          const local = fuelAt(nx);
          fuel[fuelIndex(nx)] = Math.max(0, local - well.strength * step * 0.05);
          if (local < 0.12) well.strength = Math.max(0, well.strength - step * 0.6);
        }
        // two wells whose reach overlaps merge into one — bigger, hotter,
        // a third well that is neither parent
        for (let i = 0; i < wells.length; i++) {
          const a = wells[i];
          for (let j = wells.length - 1; j > i; j--) {
            const b = wells[j];
            if (Math.hypot(a.x - b.x, a.y - b.y) > (a.radius + b.radius) * 0.32) continue;
            a.strength = Math.min(1, a.strength + b.strength * 0.7);
            a.radius = Math.min(340, Math.max(a.radius, b.radius) + 30);
            a.x = (a.x + b.x) / 2;
            a.y = (a.y + b.y) / 2;
            a.t0 = simNow; // a merged well burns fresh, not on the older parent's clock
            wells.splice(j, 1);
            burst(a.x, a.y, 14, 1.1);
            try { audio.thud(); } catch { /* noop */ }
            try { haptics.bloom(); } catch { /* noop */ }
          }
        }
        // a hot enough well spreads to a fuel-rich neighbour on the bed,
        // at most a couple of times a second — real fire, not a tap echo
        if (simNow - lastSpreadAt > 420) {
          for (const well of wells) {
            if (well.strength < 0.62 || wells.length >= 8) continue;
            const dir = well.x > w / 2 ? -1 : 1;
            const nx = clamp(well.x / w + dir * 0.07, 0.02, 0.98);
            if (fuelAt(nx) < 0.35) continue;
            lastSpreadAt = simNow;
            addWell(nx * w, well.y, well.strength * 0.55);
            break;
          }
        }
        // fuel regrows slowly on its own — the bed is never permanently spent
        for (let i = 0; i < FUEL_N; i++) fuel[i] = Math.min(1, fuel[i] + step * 0.01);
      }

      for (let i = wells.length - 1; i >= 0; i--) {
        const well = wells[i];
        if ((simNow - well.t0) / 1000 > 5.6 || well.strength <= 0) wells.splice(i, 1);
        else drawWell(well, simNow);
      }

      for (let i = strokes.length - 1; i >= 0; i--) {
        const stroke = strokes[i];
        if (stroke.releasedAt && (simNow - stroke.releasedAt) / 1000 > 2.8) strokes.splice(i, 1);
        else drawStroke(stroke, simNow);
      }

      if (!reduce) {
        emberAcc += (24 + ignition * 58 + pressSmoothed * 36) * dt * detail.particles;
        while (emberAcc > 1) {
          emberAcc -= 1;
          const x = Math.random() * w;
          const y = h * (0.76 + Math.random() * 0.24);
          spawnEmber(x, y, (Math.random() - 0.5) * 34 + wind * 80, -(18 + Math.random() * 82), 0.7 + ignition * 0.8);
        }
      }

      fx.save();
      fx.globalCompositeOperation = "lighter";
      for (const ember of emberPool) {
        if (!ember.alive) continue;
        ember.life -= step;
        if (ember.life <= 0) {
          ember.alive = false;
          continue;
        }
        ember.vx += wind * 96 * step;
        ember.vy -= 18 * step;
        ember.vx *= 0.990;
        ember.x += ember.vx * step;
        ember.y += ember.vy * step;
        if (ember.x < -40 || ember.x > w + 40 || ember.y < -40) {
          ember.alive = false;
          continue;
        }
        const life = ember.life / ember.maxLife;
        const age = 1 - life;
        const hot = age < 0.28;
        const r = ember.radius * (0.55 + life * 0.75);
        const alpha = clamp(life * 1.25, 0, 1);
        const red = hot ? 255 : 190 + Math.round(45 * life);
        const green = hot ? 210 + Math.round(34 * ember.hue) : 62 + Math.round(80 * life);
        const blue = hot ? 120 + Math.round(80 * ember.hue) : 24 + Math.round(30 * life);
        if (ember.radius > 1.25) {
          // pick the baked halo by age instead of building a fresh gradient:
          // hot embers wear the yellow-white core, then the amber, then the
          // ashy dusk as they burn down — the same read as the per-ember
          // gradient was giving us, at drawImage cost.
          const halo = hot ? emberHaloHot : life > 0.35 ? emberHaloWarm : emberHaloAsh;
          const prev = fx.globalAlpha;
          fx.globalAlpha = prev * (0.11 * alpha);
          fx.drawImage(halo, ember.x - r * 3, ember.y - r * 3, r * 6, r * 6);
          fx.globalAlpha = prev;
        }
        fx.fillStyle = `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(3)})`;
        fx.beginPath();
        fx.arc(ember.x, ember.y, Math.max(0.5, r), 0, Math.PI * 2);
        fx.fill();
      }
      fx.restore();

      // glimmer (grammar §6): after ~20s of quiet, a faint turning ring of
      // heat floats above the bed where a circling finger would whirl it —
      // a physical hint, never text.
      if (performance.now() - lastGestureAt > 20000) {
        const slot = Math.floor(now / 9000);
        const gx = (0.22 + glimmerSeed(slot, 0) * 0.56) * w;
        const gy = h * (0.55 + glimmerSeed(slot, 7) * 0.25);
        const pulse = reduce ? 0.5 : 0.5 + Math.sin(now / 480) * 0.5;
        fx.save();
        fx.strokeStyle = `rgba(245, 177, 90, ${(0.05 + pulse * 0.08).toFixed(3)})`;
        fx.lineWidth = 1;
        fx.beginPath();
        fx.ellipse(gx, gy, 22 + pulse * 10, (22 + pulse * 10) * 0.4, 0, 0, Math.PI * 2);
        fx.stroke();
        fx.restore();
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
      fxCanvas.removeEventListener("pointermove", onHover);
      fxCanvas.removeEventListener("pointerleave", onHoverLeave);
      heatCanvas.removeEventListener("webglcontextlost", onContextLost);
      heatCanvas.removeEventListener("webglcontextrestored", onContextRestored);
      delete wrap.dataset.lensRaised;
      if (gl) {
        if (program) gl.deleteProgram(program);
        if (vbo) gl.deleteBuffer(vbo);
      }
    };
  }, [markFire]);

  const letGo = useCallback(() => {
    clearAllRef.current();
    getFieldAudio().thud();
    haptics.roll();
  }, []);

  return (
    <div
      ref={wrapRef}
      className="fire-root"
      data-touch-surface="true"
      aria-label="fire — combustion instrument"
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        background: "#050304",
        WebkitUserSelect: "none",
        userSelect: "none",
        WebkitTouchCallout: "none",
      }}
    >
      <canvas
        ref={heatRef}
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
      />
      <canvas
        ref={fxRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          display: "block",
          touchAction: "none",
          cursor: "crosshair",
        }}
      />

      <div
        className="fire-title"
        style={{
          position: "fixed",
          top: 92,
          left: "var(--pad-x)",
          color: "rgba(255, 236, 196, 0.94)",
          pointerEvents: "none",
          maxWidth: 620,
          zIndex: 4,
        }}
      >
        <div
          className="t-mono"
          style={{
            color: "rgba(255, 208, 148, 0.48)",
            marginBottom: 12,
          }}
        >
          fire / pressure, oxygen, ash
        </div>
        <WaterText
          as="h1"
          bobAmp={0}
          style={{
            display: "block",
            margin: 0,
            fontFamily: "var(--font-serif)",
            fontWeight: 500,
            fontSize: "clamp(48px, 8vw, 108px)",
            lineHeight: 0.94,
            letterSpacing: "-0.018em",
            color: "rgba(255, 238, 210, 0.98)",
          }}
        >
          Pyre
        </WaterText>
        <div
          style={{
            display: "block",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontWeight: 300,
            fontSize: "clamp(17px, 2.1vw, 25px)",
            color: "rgba(255, 178, 102, 0.76)",
            marginTop: 8,
            letterSpacing: "0.002em",
          }}
        >
          touch heat until it remembers matter
        </div>
      </div>

      <div
        className="fire-memory"
        aria-live="polite"
        style={{
          position: "fixed",
          left: "var(--pad-x)",
          bottom: "calc(96px + env(safe-area-inset-bottom, 0px))",
          zIndex: 5,
          display: "flex",
          alignItems: "center",
          gap: 9,
          maxWidth: "min(620px, calc(100vw - 220px))",
          padding: "8px 10px",
          border: "1px solid rgba(255, 218, 164, 0.14)",
          borderRadius: 6,
          background: "rgba(7, 4, 4, 0.44)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          color: "rgba(255, 232, 195, 0.72)",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: 0,
          textTransform: "lowercase",
          pointerEvents: "none",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 62,
            height: 5,
            border: "1px solid rgba(255, 218, 164, 0.28)",
            borderRadius: 999,
            overflow: "hidden",
            display: "inline-flex",
            background: "rgba(255, 218, 164, 0.06)",
            flex: "0 0 auto",
          }}
        >
          <span
            style={{
              width: `${Math.max(8, Math.round(heatReadout * 100))}%`,
              background: "linear-gradient(90deg, #9d2d15, #f08d3f, #dcecff)",
              boxShadow: "0 0 12px rgba(240, 141, 63, 0.65)",
              transition: "width 140ms ease-out",
            }}
          />
        </span>
        {fireMarks.map((mark, index) => (
          <span
            key={mark.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              minWidth: 0,
              opacity: index === 0 ? 0.94 : 0.40 + mark.level * 0.22,
              whiteSpace: "nowrap",
            }}
          >
            <i
              aria-hidden="true"
              style={{
                width: index === 0 ? 20 : 8,
                height: 2,
                flex: "0 0 auto",
                background: mark.tone,
                boxShadow: index === 0 ? `0 0 14px ${mark.tone}` : undefined,
              }}
            />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{mark.label}</span>
          </span>
        ))}
      </div>

      <LetGo label="let the fire bank down" onLetGo={letGo} visible={hasBuilt} />

      <WaterText
        className="fire-legend"
        as="div"
        bobAmp={1.2}
        style={{
          display: "block",
          position: "fixed",
          right: "var(--pad-x)",
          bottom: "calc(100px + env(safe-area-inset-bottom, 0px))",
          maxWidth: 340,
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontWeight: 300,
          fontSize: "clamp(13px, 1.4vw, 17px)",
          lineHeight: 1.35,
          letterSpacing: "0.01em",
          color: "rgba(255, 184, 112, 0.56)",
          pointerEvents: "none",
          textAlign: "right",
          zIndex: 4,
        }}
      >
        tap for ember · drag for convection · hold for white heat
      </WaterText>

      <style
        dangerouslySetInnerHTML={{
          __html: `
            body:has(.fire-root) header:not(.oda-site-header) {
              background: transparent !important;
              border-bottom: 0 !important;
              backdrop-filter: none !important;
              -webkit-backdrop-filter: none !important;
            }
            body:has(.fire-root) .oda-field-watch,
            body:has(.fire-root) .oda-candle-mark,
            body:has(.fire-root) .oda-tape-shell,
            body:has(.fire-root) .oda-sound-toggle {
              display: none !important;
            }
            @media (max-width: 720px) {
              .fire-title {
                top: 78px !important;
                left: 16px !important;
                right: 16px !important;
                max-width: calc(100vw - 32px) !important;
              }
              .fire-title h1 {
                font-size: clamp(42px, 18vw, 72px) !important;
              }
              .fire-memory {
                left: 12px !important;
                right: 12px !important;
                bottom: calc(82px + env(safe-area-inset-bottom, 0px)) !important;
                max-width: none !important;
                gap: 7px !important;
                flex-wrap: wrap;
              }
              .fire-memory > span:nth-child(n+5) {
                display: none !important;
              }
              .fire-legend {
                left: 16px !important;
                right: 16px !important;
                bottom: calc(146px + env(safe-area-inset-bottom, 0px)) !important;
                max-width: none !important;
                text-align: center !important;
              }
            }
          `,
        }}
      />
    </div>
  );
}
