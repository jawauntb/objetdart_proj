"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { useField } from "@/store/field";
import WaterText from "@/components/WaterText";

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

    let program: WebGLProgram | null = null;
    let uTimeLoc: WebGLUniformLocation | null = null;
    let uResLoc: WebGLUniformLocation | null = null;
    let uPointerLoc: WebGLUniformLocation | null = null;
    let uPointerActiveLoc: WebGLUniformLocation | null = null;
    let uPressLoc: WebGLUniformLocation | null = null;
    let uWindLoc: WebGLUniformLocation | null = null;
    let uIgnitionLoc: WebGLUniformLocation | null = null;

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
        uniform vec2 uPointer;
        uniform float uPointerActive;
        uniform float uPress;
        uniform float uWind;
        uniform float uIgnition;
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
          vec2 uv = vUv;
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

            const buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
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

    let nextId = 1;
    let emberHint = 0;
    let activePointerId: number | null = null;
    let activeStroke: HeatStroke | null = null;
    let windTarget = 0;
    let wind = 0;
    let ignitionAmp = 0.2;
    let ignitionT0 = performance.now();
    let lastMarkSync = 0;

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
        t0: performance.now(),
        strength,
        radius: 120 + strength * 120,
      });
      if (wells.length > 8) wells.shift();
    };

    const beginStroke = (x: number, y: number) => {
      activeStroke = {
        id: ++nextId,
        points: [{ x, y, t: performance.now() }],
        t0: performance.now(),
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
      activeStroke.releasedAt = performance.now();
      if (record && activeStroke.points.length > 5) {
        haptics.ripple(0.24 + activeStroke.strength * 0.30);
        useField.getState().recordTape("region", 0.32 + activeStroke.strength * 0.42, "fire/convection");
        markFire("convection", "#f0a44f", 0.42 + activeStroke.strength * 0.42);
      }
      activeStroke = null;
    };

    const updatePointer = (e: PointerEvent) => {
      const rect = fxCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      pointerRef.current.x = clamp(x / w, 0, 1);
      pointerRef.current.y = clamp(y / h, 0, 1);
      pointerRef.current.over = true;
      return { x, y, w, h };
    };

    const clearGesture = (pointerId?: number, recordStroke = true) => {
      if (pointerId !== undefined) {
        try { fxCanvas.releasePointerCapture(pointerId); } catch { /* already released */ }
      }
      activePointerId = null;
      pointerRef.current.pressed = false;
      releaseStroke(recordStroke);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (activePointerId !== null) return;
      activePointerId = e.pointerId;
      try { fxCanvas.setPointerCapture(e.pointerId); } catch { /* noop */ }
      const p = updatePointer(e);
      pointerRef.current.pressed = true;
      pointerRef.current.pressStart = performance.now();
      beginStroke(p.x, p.y);
      haptics.tap();
      markFire("pressure", "#f5b15a", 0.46);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (activePointerId !== null && e.pointerId !== activePointerId) return;
      const p = updatePointer(e);
      if (pointerRef.current.pressed) extendStroke(p.x, p.y);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (activePointerId !== null && e.pointerId !== activePointerId) return;
      const p = updatePointer(e);
      const held = performance.now() - pointerRef.current.pressStart;
      const strokeStrength = activeStroke?.strength ?? 0;
      if (pointerRef.current.pressed && held > 720) {
        const charge = clamp(held / 1800, 0, 1);
        addWell(p.x, p.y, 0.45 + charge * 0.55);
        burst(p.x, p.y, 16 + Math.round(charge * 24), 0.9 + charge * 0.75);
        ignitionAmp = Math.max(ignitionAmp, 0.55 + charge * 0.35);
        ignitionT0 = performance.now();
        audio.thud();
        window.setTimeout(() => {
          try { audio.bell(); } catch { /* noop */ }
        }, 180);
        haptics.storm();
        markFire("white heat", "#dcecff", 0.82 + charge * 0.16);
        useField.getState().recordTape("sigil", 0.78 + charge * 0.16, "fire/white-heat");
      } else if (strokeStrength > 0.25) {
        ignitionAmp = Math.max(ignitionAmp, 0.34 + strokeStrength * 0.26);
        ignitionT0 = performance.now();
        try { audio.spark(); } catch { /* noop */ }
      } else {
        const yBias = p.h * (0.70 + Math.random() * 0.22);
        burst(p.x, p.y > p.h * 0.84 ? p.y : Math.max(p.y, yBias), 11, 0.72);
        ignitionAmp = Math.max(ignitionAmp, 0.36);
        ignitionT0 = performance.now();
        try { audio.spark(); } catch { /* noop */ }
        haptics.ripple(0.38);
        markFire("ember", "#f08d3f", 0.54);
        useField.getState().recordTape("object", 0.42, "fire/ember");
      }
      clearGesture(e.pointerId);
    };

    const onPointerCancel = (e: PointerEvent) => {
      if (activePointerId !== null && e.pointerId !== activePointerId) return;
      pointerRef.current.over = false;
      clearGesture(e.pointerId, false);
    };

    const onPointerLeave = () => {
      if (activePointerId !== null) return;
      pointerRef.current.over = false;
      clearGesture();
    };

    fxCanvas.addEventListener("pointerdown", onPointerDown);
    fxCanvas.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    fxCanvas.addEventListener("pointerleave", onPointerLeave);

    const t0 = performance.now();
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
      const w = fxCanvas.clientWidth;
      const h = fxCanvas.clientHeight;
      const elapsed = reduce ? 0 : (now - t0) / 1000;
      const dt = Math.min(0.05, (now - lastFrame) / 1000);
      const step = reduce ? 0 : dt;
      lastFrame = now;

      if (!pointerRef.current.pressed) windTarget *= Math.pow(0.001, dt / 2.4);
      wind += (windTarget - wind) * Math.min(1, dt * 4.5);

      const held = pointerRef.current.pressed ? (now - pointerRef.current.pressStart) / 1000 : 0;
      const pressTarget = pointerRef.current.pressed ? clamp(held / 1.35, 0, 1) : 0;
      pressSmoothed += (pressTarget - pressSmoothed) * 0.12;

      const ignitionAge = (now - ignitionT0) / 1000;
      const ignition = ignitionAmp * Math.exp(-ignitionAge * 2.2);
      if (ignition < 0.01 && ignitionAmp > 0.01) ignitionAmp = 0;

      if (now - lastMarkSync > 140) {
        lastMarkSync = now;
        setHeatReadout(clamp(0.26 + ignition * 0.44 + pressSmoothed * 0.22 + Math.abs(wind) * 0.10, 0, 1));
      }

      if (gl && program) {
        gl.useProgram(program);
        if (uTimeLoc) gl.uniform1f(uTimeLoc, elapsed);
        if (uResLoc) gl.uniform2f(uResLoc, heatCanvas.width, heatCanvas.height);
        if (uPointerLoc) gl.uniform2f(uPointerLoc, pointerRef.current.x, pointerRef.current.y);
        if (uPointerActiveLoc) gl.uniform1f(uPointerActiveLoc, pointerRef.current.over ? 1 : 0);
        if (uPressLoc) gl.uniform1f(uPressLoc, pressSmoothed);
        if (uWindLoc) gl.uniform1f(uWindLoc, wind);
        if (uIgnitionLoc) gl.uniform1f(uIgnitionLoc, ignition);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } else {
        const ctx = heatCanvas.getContext("2d");
        if (ctx) {
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          const g = ctx.createLinearGradient(0, 0, 0, h);
          g.addColorStop(0, "#050304");
          g.addColorStop(1, "#250b05");
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, w, h);
        }
      }

      fx.clearRect(0, 0, w, h);

      for (let i = wells.length - 1; i >= 0; i--) {
        const well = wells[i];
        if ((now - well.t0) / 1000 > 5.6) wells.splice(i, 1);
        else drawWell(well, now);
      }

      for (let i = strokes.length - 1; i >= 0; i--) {
        const stroke = strokes[i];
        if (stroke.releasedAt && (now - stroke.releasedAt) / 1000 > 2.8) strokes.splice(i, 1);
        else drawStroke(stroke, now);
      }

      if (!reduce) {
        emberAcc += (24 + ignition * 58 + pressSmoothed * 36) * dt;
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
          const halo = fx.createRadialGradient(ember.x, ember.y, 0, ember.x, ember.y, r * 3.0);
          halo.addColorStop(0, `rgba(${red}, ${green}, ${blue}, ${(0.11 * alpha).toFixed(3)})`);
          halo.addColorStop(1, `rgba(${red}, ${green}, ${blue}, 0)`);
          fx.fillStyle = halo;
          fx.beginPath();
          fx.arc(ember.x, ember.y, r * 3.0, 0, Math.PI * 2);
          fx.fill();
        }
        fx.fillStyle = `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(3)})`;
        fx.beginPath();
        fx.arc(ember.x, ember.y, Math.max(0.5, r), 0, Math.PI * 2);
        fx.fill();
      }
      fx.restore();

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      fxCanvas.removeEventListener("pointerdown", onPointerDown);
      fxCanvas.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      fxCanvas.removeEventListener("pointerleave", onPointerLeave);
    };
  }, [markFire]);

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
            body:has(.fire-root) header {
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
