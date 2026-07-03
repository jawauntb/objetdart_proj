"use client";

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import { useField } from "@/store/field";
import * as haptics from "@/lib/haptics";
import { relaxTurbulence, stirTurbulence } from "@/lib/turbulence";

/**
 * /ocean — the whole body of water, and a dive down through it.
 *
 * The surface is the open ocean seen from just above: a sky meeting the
 * water at a high horizon, a column of sun-glint shivering down the middle,
 * depth falling away from azure through cerulean and a teal-green shelf into
 * prussian blue, and a meandering river ribbon crossing it all.
 *
 * But this page owns DEPTH. A scroll, or a slow two-finger drag, sinks the
 * camera down the water column: sunlit surface → epipelagic blue → twilight
 * (colour drains, light shafts thin, marine snow drifts down) → midnight and
 * the abyss, near-black, alive with drifting BIOLUMINESCENT motes that spark
 * under the fingertip. Rising brings the light and the sky back. That
 * vertical journey is what no sibling page has.
 *
 * Two layered canvases:
 *   1. WebGL water — the deep material. Depth gradient, fbm caustics, sun
 *      glint, the river ribbon, foam, pointer ripples, tilt slosh, and — as
 *      the dive deepens — a whole submerged column with penetrating light
 *      shafts and a ceiling of caustics that fades to black.
 *   2. 2D layer — surface foam and the Great Wave (which dissolve as you
 *      descend), then marine snow and bioluminescent motes that bloom in the
 *      deep and flare where you touch.
 *
 * Touch-sensitive: every finger is a wave source at the surface and a spark
 * of light in the deep; two fingers dragged vertically dive. Motion: tilt
 * sloshes, shake churns whitecaps. If WebGL is unavailable the 2D layer
 * paints its own depth gradient and the piece still reads.
 */
export default function Ocean() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const waterRef = useRef<HTMLCanvasElement>(null);
  const surfRef = useRef<HTMLCanvasElement>(null);
  const ripples = useRef<Array<{ x: number; y: number; t0: number; strength: number }>>([]);
  const pointer = useRef<{ x: number; y: number; over: boolean; pressed: boolean; lastEmit: number }>({
    x: 0, y: 0, over: false, pressed: false, lastEmit: 0,
  });
  // dive position through the water column: 0 = surface, 1 = the abyss.
  const depthRef = useRef(0);
  const depthTargetRef = useRef(0);
  // tiny floating readout — the depth zone and a reading in metres of dark.
  const [zone, setZone] = useState("surface");
  const [depthM, setDepthM] = useState(0);

  useEffect(() => {
    const wrap = wrapRef.current;
    const water = waterRef.current;
    const surf = surfRef.current;
    if (!wrap || !water || !surf) return;
    const sctx = surf.getContext("2d");
    if (!sctx) return;

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
    let uSwellLoc: WebGLUniformLocation | null = null;
    let uTiltLoc: WebGLUniformLocation | null = null;
    let uTurbLoc: WebGLUniformLocation | null = null;
    let uDepthLoc: WebGLUniformLocation | null = null;
    let uRipplesLoc: WebGLUniformLocation | null = null;
    let uRippleCountLoc: WebGLUniformLocation | null = null;

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
        uniform float uSwell;   // audio swell LFO, ~-1..1
        uniform float uTurb;    // storm axis 0..~1 (shake / hard press)
        uniform float uDepth;   // dive depth 0 (surface) .. 1 (abyss)
        uniform vec2 uTilt;     // device tilt bias
        uniform vec4 uRipples[12]; // xy uv, z age sec, w strength
        uniform int uRippleCount;
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
          for (int i = 0; i < 6; i++) {
            v += a * vnoise(p);
            p *= 2.03;
            a *= 0.52;
          }
          return v;
        }

        void main() {
          vec2 uv = vec2(vUv.x, 1.0 - vUv.y); // y=0 sky, y=1 near water
          float aspect = uRes.x / uRes.y;
          float t = uTime;

          // ── horizon split ──────────────────────────────────────
          // sky occupies a thin top band, the sea everything below. A soft
          // band of haze sits where they meet.
          float horizon = 0.15;
          float seaT = clamp((uv.y - horizon) / (1.0 - horizon), 0.0, 1.0);

          // ── pointer ripples (height field) ─────────────────────
          float rippleHi = 0.0;
          for (int i = 0; i < 12; i++) {
            if (i >= uRippleCount) break;
            vec4 r = uRipples[i];
            vec2 dp = (uv - r.xy) * vec2(aspect, 1.0);
            float dist = length(dp);
            float age = r.z;
            if (age > 2.8) continue;
            float speed = 0.30;
            float front = dist - age * speed;
            float env = exp(-(front * front) / 0.0026);
            float falloff = 1.0 / (1.0 + dist * 3.2);
            float temporal = max(0.0, 1.0 - age / 2.8);
            rippleHi += r.w * env * falloff * temporal;
          }

          // perspective compression: detail packs toward the horizon.
          float persp = mix(0.18, 1.0, seaT);

          // ── flow warp ──────────────────────────────────────────
          // larger + faster than a still pond so the body of water visibly
          // moves: swells travel, the surface is never frozen.
          vec2 flow = vec2(
            sin(uv.y * 9.0 + t * 0.72) * 0.022,
            sin(uv.x * 7.0 + t * 0.50) * 0.015
          ) * persp;
          // a second, slower long-period swell so motion reads at every scale
          flow += vec2(
            sin(uv.y * 3.4 - t * 0.30) * 0.010,
            cos(uv.x * 2.6 + t * 0.24) * 0.008
          ) * persp;
          vec2 wuv = uv + flow + uTilt * (0.4 + seaT) + vec2(0.0, uSwell * 0.010 * persp);
          wuv += rippleHi * 0.012;

          // ── depth palette ──────────────────────────────────────
          // azure skyline -> cerulean -> teal-green shelf -> Hokusai
          // prussian blue -> deep ocean -> a near-black abyssal floor.
          // the deep is meant to read as genuinely DEEP: most of the lower
          // sea falls away into prussian and then darkness.
          vec3 azure    = vec3(0.46, 0.66, 0.78);
          vec3 cerulean = vec3(0.16, 0.42, 0.60);
          vec3 teal     = vec3(0.07, 0.34, 0.42); // the green shelf
          vec3 prussian = vec3(0.04, 0.16, 0.32); // Hokusai's prussian blue
          vec3 deep     = vec3(0.02, 0.08, 0.18);
          vec3 abyss    = vec3(0.004, 0.02, 0.06); // near-black deep water

          vec3 color = mix(azure, cerulean, smoothstep(0.00, 0.22, seaT));
          color = mix(color, teal,     smoothstep(0.20, 0.40, seaT));
          color = mix(color, prussian, smoothstep(0.38, 0.60, seaT));
          color = mix(color, deep,     smoothstep(0.58, 0.80, seaT));
          color = mix(color, abyss,    smoothstep(0.80, 1.00, seaT));

          // ── river ribbon ───────────────────────────────────────
          // a meandering current crossing the sea: a brighter, faster band
          // whose centre wanders with fbm and whose interior is advected
          // along its length. reads as a river feeding the ocean.
          float meander = (fbm(vec2(uv.x * 1.6, t * 0.05)) - 0.5) * 0.34;
          float riverY = 0.52 + meander;
          float band = exp(-pow((uv.y - riverY) * 4.6, 2.0));
          vec2 ruv = vec2(uv.x * 3.0 - t * 0.16, uv.y * 6.0);
          float riverFlow = fbm(ruv + fbm(ruv * 0.5));
          vec3 riverCol = mix(vec3(0.16, 0.50, 0.55), vec3(0.40, 0.70, 0.74), riverFlow);
          color = mix(color, riverCol, band * 0.42);

          // ── caustics ───────────────────────────────────────────
          vec2 nuv = wuv * vec2(aspect, 1.0) * (3.0 + 4.0 * seaT) + vec2(t * 0.05, t * 0.03);
          float n = fbm(nuv);
          float c1 = sin((wuv.x + n * 0.18) * 24.0 + t * 0.55)
                   * sin((wuv.y + n * 0.14) * 16.0 - t * 0.38);
          float c2 = sin(wuv.x * 10.0 - t * 0.30 + n * 1.2)
                   * sin(wuv.y *  7.0 + t * 0.22 - n * 1.0);
          float caustic = c1 * 0.45 + c2 * 0.55;
          caustic = smoothstep(0.52, 1.05, caustic);
          float causticVis = mix(0.16, 0.04, seaT); // brighter up near the light
          color += caustic * causticVis * mix(vec3(1.0), vec3(0.72, 0.92, 1.0), seaT);

          // ── sun glint ──────────────────────────────────────────
          // a column of shivering specular near centre-x, strongest just
          // below the horizon, broken into facets by high-freq noise.
          float col = exp(-pow((uv.x - 0.5) * 2.4, 2.0));
          float facets = fbm(vec2(uv.x * 60.0, uv.y * 40.0 - t * 1.4));
          float glint = col * smoothstep(0.55, 1.0, facets) * (1.0 - seaT * 0.7);
          color += glint * 0.55 * vec3(1.0, 0.98, 0.90);

          // ── whitecaps / storm foam (turb-driven) ───────────────
          float caps = fbm(wuv * vec2(aspect, 1.0) * 14.0 + vec2(0.0, -t * 0.6));
          float foam = smoothstep(0.62, 0.9, caps) * uTurb * seaT;
          color = mix(color, vec3(0.86, 0.91, 0.93), foam * 0.6);

          // ripple highlights brighten their wavefronts
          color += rippleHi * 0.012 * vec3(0.74, 0.93, 1.0);

          // low-frequency weather wash
          float wash = sin(wuv.x * 1.8 + t * 0.12) * sin(wuv.y * 2.6 - t * 0.07);
          color += wash * 0.022 * vec3(0.85, 0.92, 1.0);

          // ── sky ────────────────────────────────────────────────
          // a Hokusai sky: warm cream/beige, faintly deeper at the very top,
          // paling to a misty haze at the skyline. ties to the paper palette.
          vec3 skyTop = vec3(0.80, 0.78, 0.70);
          vec3 skyLow = vec3(0.92, 0.89, 0.81);
          vec3 sky = mix(skyTop, skyLow, smoothstep(0.0, horizon, uv.y));
          // faint sun bloom in the sky above the glint column
          sky += col * exp(-pow((horizon - uv.y) * 6.0, 2.0)) * 0.10;

          // horizon haze: blend a soft warm band so the seam is atmospheric.
          float seam = smoothstep(horizon - 0.04, horizon, uv.y)
                     * (1.0 - smoothstep(horizon, horizon + 0.06, uv.y));
          color = mix(color, vec3(0.86, 0.84, 0.76), seam * 0.5);

          // choose sky above the horizon
          float isSea = step(horizon, uv.y);
          vec3 outc = mix(sky, color, isSea);

          // ── the dive: sinking into the water column ────────────
          // As uDepth rises the camera slips below the surface. The whole
          // frame becomes water: a lit ceiling above (caustics + light
          // shafts stabbing down) fading through twilight into near-black.
          float depth01 = clamp(uDepth, 0.0, 1.0);
          float submerge = smoothstep(0.05, 0.34, depth01);
          if (submerge > 0.001) {
            float dc = uv.y; // 0 = toward the light above, 1 = deeper below
            // overall light available at this depth, fading as we descend
            float lightAmt = 1.0 - smoothstep(0.32, 0.95, depth01);
            // light concentrated near the ceiling; the ceiling recedes deeper
            float ceil = exp(-dc * (1.6 + depth01 * 5.5)) * lightAmt;

            // water-column palette: epipelagic blue -> twilight -> midnight
            vec3 epip     = vec3(0.05, 0.24, 0.34);
            vec3 twilight = vec3(0.015, 0.05, 0.14);
            vec3 midnight = vec3(0.002, 0.006, 0.020);
            vec3 base = mix(epip, twilight, smoothstep(0.12, 0.50, depth01));
            base = mix(base, midnight, smoothstep(0.50, 0.92, depth01));
            base *= mix(1.0, 0.55, dc); // darker toward the bottom of frame

            vec3 deepCol = base;
            // the ceiling glow — the underside of the surface far overhead
            deepCol += ceil * vec3(0.35, 0.60, 0.72);

            // crepuscular light shafts: shimmering vertical blades from above
            float shN = fbm(vec2(uv.x * 2.6 + t * 0.03, uv.x * 1.4 + 4.0));
            float streak = sin((uv.x + shN * 0.13) * 24.0 + shN * 4.0);
            float shafts = pow(max(0.0, streak), 4.0)
                         * exp(-dc * (2.2 + depth01 * 4.0)) * lightAmt;
            deepCol += shafts * vec3(0.45, 0.70, 0.80) * 0.6;

            // caustic flicker rippling across the ceiling
            deepCol += caustic * ceil * 0.45 * vec3(0.6, 0.85, 1.0);

            // touch ripples read as bioluminescent bloom the deeper we go
            vec3 bioTint = mix(vec3(0.30, 0.72, 0.92), vec3(0.20, 1.0, 0.78),
                               smoothstep(0.45, 0.9, depth01));
            deepCol += rippleHi * 0.010 * bioTint;

            outc = mix(outc, deepCol, submerge);
          }

          // gentle vignette toward the corners for depth
          vec2 vc = (vUv - 0.5);
          float vig = 1.0 - dot(vc, vc) * 0.35;
          outc *= vig;

          gl_FragColor = vec4(clamp(outc, 0.0, 1.0), 1.0);
        }
      `;
      const compile = (type: number, src: string) => {
        const s = gl.createShader(type);
        if (!s) return null;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          console.warn("ocean shader compile failed", gl.getShaderInfoLog(s));
          gl.deleteShader(s);
          return null;
        }
        return s;
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
            uSwellLoc = gl.getUniformLocation(p, "uSwell");
            uTiltLoc = gl.getUniformLocation(p, "uTilt");
            uTurbLoc = gl.getUniformLocation(p, "uTurb");
            uDepthLoc = gl.getUniformLocation(p, "uDepth");
            uRipplesLoc = gl.getUniformLocation(p, "uRipples");
            uRippleCountLoc = gl.getUniformLocation(p, "uRippleCount");

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

    // ── resize ────────────────────────────────────────────────────
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      water.width = Math.floor(w * dpr);
      water.height = Math.floor(h * dpr);
      surf.width = Math.floor(w * dpr);
      surf.height = Math.floor(h * dpr);
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (gl) gl.viewport(0, 0, water.width, water.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // ── small math helpers ────────────────────────────────────────
    const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
    const smoothstep = (e0: number, e1: number, x: number) => {
      const t = clamp01((x - e0) / (e1 - e0));
      return t * t * (3 - 2 * t);
    };
    // deterministic pseudo-random for seeding drifting particles.
    const rnd = (s: number) => {
      const v = Math.sin(s * 127.1 + 311.7) * 43758.5453;
      return v - Math.floor(v);
    };

    // ── the deep: marine snow + bioluminescent motes ──────────────
    // marine snow drifts down forever through the twilight and below.
    const SNOW = 120;
    const snow = Array.from({ length: SNOW }, (_, i) => ({
      x: rnd(i * 1.7),
      y: rnd(i * 2.3),
      r: 0.5 + rnd(i * 3.1) * 1.6,
      spd: 0.15 + rnd(i * 4.9) * 0.55,
      sway: rnd(i * 5.3) * 6.283,
      a: 0.2 + rnd(i * 6.1) * 0.5,
    }));
    // bioluminescent motes: near-dark until stirred, then they flare cyan-green.
    const MOTES = 84;
    const motes = Array.from({ length: MOTES }, (_, i) => ({
      x: rnd(i * 7.7 + 0.3),
      y: rnd(i * 8.1 + 0.9),
      r: 1.2 + rnd(i * 9.3) * 2.6,
      ph: rnd(i * 10.7) * 6.283,
      hue: rnd(i * 11.9), // 0 = teal, 1 = green
    }));
    // touch-born sparks in the deep: expanding blooms of cold light.
    const sparks: Array<{ x: number; y: number; t0: number; strength: number }> = [];
    const addSpark = (x: number, y: number, strength: number) => {
      sparks.push({ x, y, t0: performance.now(), strength });
      if (sparks.length > 24) sparks.shift();
    };

    // ── pointer / touch ───────────────────────────────────────────
    const addRipple = (x: number, y: number, strength: number) => {
      ripples.current.push({ x, y, t0: performance.now(), strength });
      if (ripples.current.length > 30) ripples.current.shift();
    };
    const pressed = new Map<number, { x: number; y: number; lastEmit: number }>();
    const pressureOf = (e: PointerEvent) => (e.pressure > 0 ? e.pressure : 0.5);
    const strengthScale = (p: number) => 0.6 + p * 0.95;
    // two-finger vertical drag drives the dive; track the fingers' mean Y.
    let lastAvgY: number | null = null;

    // ── device sensors ────────────────────────────────────────────
    const tiltTarget = { x: 0, y: 0 };
    const tiltSmoothed = { x: 0, y: 0 };
    let sensorsArmed = false;
    let lastAccelMag: number | null = null;
    let lastShakeAt = 0;

    const onOrient = (e: DeviceOrientationEvent) => {
      const gx = (e.gamma ?? 0) / 45;
      const gy = ((e.beta ?? 45) - 45) / 45;
      tiltTarget.x = Math.max(-1, Math.min(1, gx));
      tiltTarget.y = Math.max(-1, Math.min(1, gy));
    };
    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a) return;
      const mag = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0);
      if (lastAccelMag != null) {
        const jolt = Math.abs(mag - lastAccelMag);
        if (jolt > 13) {
          stirTurbulence(Math.min(0.6, jolt / 34));
          const now = performance.now();
          if (now - lastShakeAt > 320) {
            lastShakeAt = now;
            haptics.storm();
            try { getFieldAudio().thud(); } catch { /* noop */ }
          }
        }
      }
      lastAccelMag = mag;
    };
    const armSensors = () => {
      if (sensorsArmed) return;
      sensorsArmed = true;
      type PermCtor = { requestPermission?: () => Promise<"granted" | "denied"> };
      const DOE = (window as unknown as { DeviceOrientationEvent?: PermCtor }).DeviceOrientationEvent;
      const DME = (window as unknown as { DeviceMotionEvent?: PermCtor }).DeviceMotionEvent;
      const add = () => {
        window.addEventListener("deviceorientation", onOrient);
        window.addEventListener("devicemotion", onMotion);
      };
      if (DOE && typeof DOE.requestPermission === "function") {
        Promise.allSettled([
          DOE.requestPermission?.(),
          DME?.requestPermission?.(),
        ]).then((res) => {
          if (res.some((r) => r.status === "fulfilled" && r.value === "granted")) add();
        }).catch(() => { /* noop */ });
      } else {
        add();
      }
    };

    const onDown = (e: PointerEvent) => {
      const r = surf.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const p = pressureOf(e);
      pressed.set(e.pointerId, { x, y, lastEmit: performance.now() });
      pointer.current.pressed = true;
      pointer.current.over = true;
      pointer.current.x = x;
      pointer.current.y = y;
      addRipple(x, y, 28 * strengthScale(p));
      stirTurbulence(p * 0.05);
      haptics.ripple(p);
      // in the deep a touch is a spark of cold light, not a splash of foam.
      const deep = depthRef.current > 0.38;
      if (deep) {
        addSpark(x, y, 0.7 + p * 0.6);
        useField.getState().recordTape("ripple", 0.7, "biolume");
        try { getFieldAudio().playNote(74 + Math.floor(p * 10), 160); } catch { /* noop */ }
      } else {
        useField.getState().recordTape("ripple", 0.85);
        try { getFieldAudio().chime(); } catch { /* noop */ }
      }
      armSensors();
    };
    const onUp = (e: PointerEvent) => {
      pressed.delete(e.pointerId);
      if (pressed.size < 2) lastAvgY = null;
      if (pressed.size === 0) pointer.current.pressed = false;
    };
    const onMove = (e: PointerEvent) => {
      const r = surf.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      pointer.current.over = true;
      pointer.current.x = x;
      pointer.current.y = y;
      const now = performance.now();
      const finger = pressed.get(e.pointerId);
      if (finger) { finger.x = x; finger.y = y; }

      // ── two-finger dive: the mean Y of the fingers drives depth ──
      if (pressed.size >= 2) {
        let sy = 0;
        pressed.forEach((f) => { sy += f.y; });
        const avgY = sy / pressed.size;
        const h = surf.clientHeight || 1;
        if (lastAvgY != null) {
          // dragging down descends; dragging up rises.
          depthTargetRef.current = clamp01(
            depthTargetRef.current + ((avgY - lastAvgY) / h) * 1.35,
          );
        }
        lastAvgY = avgY;
        return; // don't shed ripples while diving
      }
      lastAvgY = null;

      const deep = depthRef.current > 0.38;
      if (finger) {
        if (now - finger.lastEmit > 70) {
          const p = pressureOf(e);
          addRipple(x, y, 14 * strengthScale(p));
          finger.lastEmit = now;
          if (deep) {
            addSpark(x, y, 0.4 + p * 0.4);
            useField.getState().recordTape("ripple", 0.4, "biolume");
          } else {
            useField.getState().recordTape("ripple", 0.45);
            haptics.chop();
          }
        }
      } else if (now - pointer.current.lastEmit > 200) {
        addRipple(x, y, 4);
        pointer.current.lastEmit = now;
      }
    };
    const onLeave = () => { pointer.current.over = false; };
    // scroll / trackpad sinks and lifts the camera through the water column.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      depthTargetRef.current = clamp01(depthTargetRef.current + e.deltaY * 0.0011);
    };
    surf.addEventListener("pointerdown", onDown);
    surf.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    surf.addEventListener("pointerleave", onLeave);
    surf.addEventListener("wheel", onWheel, { passive: false });

    // ── render loop ───────────────────────────────────────────────
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const motion = reduce ? 0 : 1;
    const t0 = performance.now();
    let raf = 0;
    let prevNow = t0;
    let lastZone = "surface";
    let lastMReport = 0;
    let lastM = -1;
    const zoneOf = (d: number) =>
      d < 0.12 ? "surface" : d < 0.4 ? "epipelagic" : d < 0.7 ? "twilight" : "midnight";
    // a lower, darker chord as each zone is entered.
    const zoneTone: Record<string, number> = {
      surface: 320, epipelagic: 190, twilight: 120, midnight: 70,
    };

    const rippleDisp = (x: number, y: number, now: number): number => {
      let d = 0;
      const list = ripples.current;
      for (let i = list.length - 1; i >= 0; i--) {
        const r = list[i];
        const age = (now - r.t0) / 1000;
        if (age > 2.8) { list.splice(i, 1); continue; }
        const dx = x - r.x;
        const dy = y - r.y;
        const dist = Math.hypot(dx, dy);
        const spatialFalloff = 1 / (1 + dist / 90);
        const temporal = Math.max(0, 1 - age / 2.8);
        const speed = 260;
        const front = dist - age * speed;
        const env = Math.exp(-(front * front) / (70 * 70));
        d += r.strength * env * spatialFalloff * temporal;
      }
      return d;
    };

    const draw = (now: number) => {
      const w = surf.clientWidth;
      const h = surf.clientHeight;
      const dt = Math.min(60, now - prevNow);
      prevNow = now;

      const audioT = getFieldAudio().getAudioTime();
      const t = audioT != null ? audioT : (now - t0) / 1000;

      // ── dive: ease the camera toward its target depth ───────────
      depthRef.current += (depthTargetRef.current - depthRef.current) * 0.05;
      const depth = depthRef.current;
      const submerge = smoothstep(0.05, 0.34, depth);
      const surfaceVis = 1 - smoothstep(0.05, 0.30, depth);
      const snowVis = smoothstep(0.12, 0.44, depth);
      const bioVis = smoothstep(0.40, 0.74, depth);

      // announce zone changes with a low tone + a haptic roll, and keep the
      // floating readout current without churning React every frame.
      const zoneNow = zoneOf(depth);
      if (zoneNow !== lastZone) {
        lastZone = zoneNow;
        setZone(zoneNow);
        try { getFieldAudio().playTone(zoneTone[zoneNow] ?? 200, 0.55); } catch { /* noop */ }
        try { haptics.roll(); } catch { /* noop */ }
      }
      if (now - lastMReport > 150) {
        lastMReport = now;
        const m = Math.round(depth * 3800);
        if (m !== lastM) { lastM = m; setDepthM(m); }
      }

      const swellLfo = Math.sin(t * Math.PI * 2 * 0.12);
      const driftLfo = Math.sin(t * Math.PI * 2 * 0.03);
      let swellMod = 1 + swellLfo * 0.26 + driftLfo * 0.10;

      const turb = reduce ? 0 : relaxTurbulence(now);
      if (turb > 0) swellMod *= 1 + turb * 0.9;

      tiltSmoothed.x += (tiltTarget.x - tiltSmoothed.x) * 0.06;
      tiltSmoothed.y += (tiltTarget.y - tiltSmoothed.y) * 0.06;

      // ── WebGL water ─────────────────────────────────────────────
      if (gl && glProg) {
        gl.useProgram(glProg);
        if (uTimeLoc) gl.uniform1f(uTimeLoc, t);
        if (uResLoc) gl.uniform2f(uResLoc, water.width, water.height);
        if (uSwellLoc) gl.uniform1f(uSwellLoc, swellLfo + turb * 0.6);
        if (uTurbLoc) gl.uniform1f(uTurbLoc, Math.min(1, turb));
        if (uDepthLoc) gl.uniform1f(uDepthLoc, depth);
        if (uTiltLoc) gl.uniform2f(uTiltLoc, tiltSmoothed.x * 0.028, tiltSmoothed.y * 0.022);

        if (uRipplesLoc && uRippleCountLoc) {
          const MAX = 12;
          const data = new Float32Array(MAX * 4);
          const cw = surf.clientWidth || 1;
          const ch = surf.clientHeight || 1;
          let count = 0;
          for (let i = ripples.current.length - 1; i >= 0 && count < MAX; i--) {
            const r = ripples.current[i];
            const age = (now - r.t0) / 1000;
            if (age > 2.8) continue;
            data[count * 4 + 0] = r.x / cw;
            data[count * 4 + 1] = r.y / ch;
            data[count * 4 + 2] = age;
            data[count * 4 + 3] = r.strength;
            count++;
          }
          gl.uniform4fv(uRipplesLoc, data);
          gl.uniform1i(uRippleCountLoc, count);
        }

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } else {
        // fallback depth gradient
        const wctx = water.getContext("2d");
        if (wctx) {
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          const sg = wctx.createLinearGradient(0, 0, 0, h);
          sg.addColorStop(0.00, "rgba(229,224,206,1)"); // warm cream sky
          sg.addColorStop(0.15, "rgba(150,176,190,1)");
          sg.addColorStop(0.34, "rgba( 20, 92,108,1)"); // teal shelf
          sg.addColorStop(0.56, "rgba( 12, 44, 84,1)"); // prussian
          sg.addColorStop(0.80, "rgba(  6, 22, 48,1)"); // deep
          sg.addColorStop(1.00, "rgba(  2,  8, 18,1)"); // abyss
          wctx.fillStyle = sg;
          wctx.fillRect(0, 0, w, h);
          // dive: sink the whole gradient toward black as we descend.
          if (submerge > 0) {
            wctx.fillStyle = `rgba(2, 7, 16, ${submerge * 0.9})`;
            wctx.fillRect(0, 0, w, h);
          }
        }
      }

      // ── 2D surface layer ────────────────────────────────────────
      sctx.clearRect(0, 0, w, h);
      const horizonY = h * 0.15;

      // Surface features — foam swells and the Great Wave — dissolve as the
      // dive carries us under. Skip the work entirely once we're deep.
      if (surfaceVis > 0.01) {
      sctx.save();
      sctx.globalAlpha = surfaceVis;

      // foam crest lines marching toward the viewer; spacing widens with
      // perspective so they read as receding swells. Faster + taller than a
      // pond so the water visibly travels.
      const crests = 7;
      for (let i = 0; i < crests; i++) {
        const f = i / (crests - 1);
        // perspective: cluster near horizon, spread near the bottom
        const yBase = horizonY + (h - horizonY) * (f * f);
        const amp = (4 + f * 22) * swellMod;
        const freq = 0.006 + (1 - f) * 0.010;
        const speed = 0.24 + f * 0.46;
        const alpha = 0.10 + f * 0.30;
        sctx.strokeStyle = `rgba(232, 244, 248, ${alpha})`;
        sctx.lineWidth = 1 + f * 0.6;
        sctx.beginPath();
        for (let x = 0; x <= w; x += 4) {
          const phase = x * freq + t * speed * motion;
          const base =
            Math.sin(phase) +
            0.35 * Math.sin(phase * 2.3 + t * speed * 0.6 * motion) +
            0.18 * Math.sin(phase * 0.6 - t * speed * 0.3 * motion);
          const yy = yBase + base * amp + rippleDisp(x, yBase, now) * (0.4 + f * 0.6);
          if (x === 0) sctx.moveTo(x, yy);
          else sctx.lineTo(x, yy);
        }
        sctx.stroke();

        // foam dabs at the crests of the nearer swells
        if (f > 0.4) {
          sctx.fillStyle = `rgba(244, 250, 252, ${alpha + 0.1})`;
          for (let x = 0; x <= w; x += 6) {
            const phase = x * freq + t * speed * motion;
            const v = Math.sin(phase) + 0.35 * Math.sin(phase * 2.3 + t * speed * 0.6 * motion);
            if (v > 1.04) {
              const yy = yBase + v * amp + rippleDisp(x, yBase, now) * (0.4 + f * 0.6);
              sctx.fillRect(x, yy - 1, 1.5 + (v - 1.04) * 6, 1.2);
            }
          }
        }
      }

      // ── the Great Wave (Hokusai) ────────────────────────────────
      // A breaking prussian-blue swell rises across the upper sea, its lip
      // curling forward into a barrel and shedding the iconic claw-foam.
      // Procedural so the whole thing drifts and breathes — the wave is
      // never still — and so it scales from phone to desktop.
      drawGreatWave(sctx, w, h, horizonY, t * motion, swellMod);

      sctx.restore();
      }

      // sun-glint sparkle in the central column just under the horizon
      const glintTop = horizonY + 6;
      const glintBottom = h * 0.55;
      const cx = w * 0.5;
      sctx.fillStyle = "rgba(255, 252, 238, 0.5)";
      for (let s = 0; s < 46 && surfaceVis > 0.01; s++) {
        const seed = s * 12.9898;
        const rx = (Math.sin(seed) * 43758.5453) % 1;
        const ry = (Math.sin(seed * 1.7) * 24634.6345) % 1;
        const sparkleX = cx + (Math.abs(rx) - 0.5) * w * 0.34;
        const sy = glintTop + Math.abs(ry) * (glintBottom - glintTop);
        const tw = 0.5 + 0.5 * Math.sin(t * 5 + s * 1.3);
        if (tw > 0.55) {
          const sz = (1 - (sy - glintTop) / (glintBottom - glintTop)) * 2.4 * tw;
          sctx.globalAlpha = (0.18 + tw * 0.4) * surfaceVis;
          sctx.fillRect(sparkleX, sy, sz + 0.6, 0.9);
        }
      }
      sctx.globalAlpha = 1;

      // ── the deep: marine snow, sparks, bioluminescent motes ─────
      // Marine snow drifts down through the twilight and below — faint
      // detritus caught in what light remains.
      if (snowVis > 0.01) {
        const snowT = reduce ? 0 : dt;
        sctx.fillStyle = "#dfeef2";
        for (const p of snow) {
          p.y += (p.spd * snowT) * 0.00006;
          if (p.y > 1.05) { p.y -= 1.1; p.x = rnd(p.sway + p.y * 7.0); }
          const sx = (p.x + Math.sin(t * 0.2 + p.sway) * 0.008) * w;
          const sy = p.y * h;
          sctx.globalAlpha = snowVis * p.a * (0.5 + 0.5 * (1 - bioVis * 0.6));
          sctx.beginPath();
          sctx.arc(sx, sy, p.r, 0, 7);
          sctx.fill();
        }
        sctx.globalAlpha = 1;
      }

      // Touch sparks: cold blooms of light expanding where a finger struck.
      sctx.save();
      sctx.globalCompositeOperation = "lighter";
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        const age = (now - s.t0) / 1000;
        if (age > 1.7) { sparks.splice(i, 1); continue; }
        const life = 1 - age / 1.7;
        const rad = 14 + age * 150;
        const g = sctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, rad);
        g.addColorStop(0, `rgba(150, 255, 224, ${0.30 * life * s.strength})`);
        g.addColorStop(0.5, `rgba(70, 200, 230, ${0.14 * life * s.strength})`);
        g.addColorStop(1, "rgba(40, 120, 200, 0)");
        sctx.fillStyle = g;
        sctx.beginPath();
        sctx.arc(s.x, s.y, rad, 0, 7);
        sctx.fill();
      }
      sctx.restore();

      // Bioluminescent motes: near-dark drifters that flare where they are
      // touched, chased by the cursor, or caught in an expanding spark.
      if (bioVis > 0.01) {
        sctx.save();
        sctx.globalCompositeOperation = "lighter";
        const drift = reduce ? 0 : 1;
        for (const m of motes) {
          const mx = (m.x + Math.sin(t * 0.11 + m.ph) * 0.03 * drift) * w;
          const my = (m.y + Math.cos(t * 0.08 + m.ph * 1.4) * 0.03 * drift
            - (t * 0.004 * drift) % 1) * h;
          let glow = 0.10 + 0.08 * Math.sin(t * 0.9 + m.ph * 3.0);
          if (pointer.current.over) {
            const dx = mx - pointer.current.x;
            const dy = my - pointer.current.y;
            const d2 = dx * dx + dy * dy;
            glow += Math.exp(-d2 / (140 * 140)) * (pointer.current.pressed ? 1.15 : 0.55);
          }
          for (const s of sparks) {
            const age = (now - s.t0) / 1000;
            if (age > 1.7) continue;
            const front = Math.hypot(mx - s.x, my - s.y) - (14 + age * 150);
            glow += Math.exp(-(front * front) / (46 * 46)) * (1 - age / 1.7) * 0.9;
          }
          if (glow < 0.04) continue;
          glow = Math.min(1.5, glow);
          const rad = m.r * (1.6 + glow * 3.2);
          // teal → green by the mote's own hue, brighter cores when flaring.
          const cr = Math.round(90 + m.hue * 70);
          const cg = Math.round(210 + m.hue * 40);
          const cb = Math.round(210 - m.hue * 70);
          const g = sctx.createRadialGradient(mx, my, 0, mx, my, rad);
          g.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, ${Math.min(0.9, glow * 0.8) * bioVis})`);
          g.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`);
          sctx.fillStyle = g;
          sctx.beginPath();
          sctx.arc(mx, my, rad, 0, 7);
          sctx.fill();
        }
        sctx.restore();
      }

      // cursor halo — a warm glow at the surface, a cold one in the deep.
      if (pointer.current.over) {
        const px = pointer.current.x;
        const py = pointer.current.y;
        const rad = 100;
        const hg = sctx.createRadialGradient(px, py, 0, px, py, rad);
        const cold = bioVis;
        const hr = Math.round(224 - cold * 90);
        const hg0 = Math.round(244 + cold * 8);
        const hb = Math.round(250 - cold * 30);
        hg.addColorStop(0, `rgba(${hr}, ${hg0}, ${hb}, ${0.22 + cold * 0.08})`);
        hg.addColorStop(1, `rgba(${hr}, ${hg0}, ${hb}, 0)`);
        sctx.fillStyle = hg;
        sctx.beginPath();
        sctx.arc(px, py, rad, 0, 7);
        sctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      surf.removeEventListener("pointerdown", onDown);
      surf.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      surf.removeEventListener("pointerleave", onLeave);
      surf.removeEventListener("wheel", onWheel);
      window.removeEventListener("deviceorientation", onOrient);
      window.removeEventListener("devicemotion", onMotion);
    };
  }, []);

  // the title dissolves as the dive carries us into the dark.
  const titleFade = zone === "surface" ? 1 : zone === "epipelagic" ? 0.7 : zone === "twilight" ? 0.4 : 0.22;

  return (
    <div
      ref={wrapRef}
      className="ocean-body"
      data-touch-surface="true"
      data-pretext-ignore="true"
      aria-label="The open ocean and the water column beneath it. Drag to disturb the surface; scroll or drag two fingers to dive down through sunlit water, twilight and the bioluminescent abyss; tilt the phone to lean the sea."
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        background: "#03070f",
      }}
    >
      <canvas
        ref={waterRef}
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
      />
      <canvas
        ref={surfRef}
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

      {/* a tiny floating readout: the depth zone and a reading in metres */}
      <div className="ocean-title" aria-hidden="true" style={{ opacity: titleFade }}>
        <span>{`ocean / ${zone}`}</span>
        <strong>Ocean</strong>
      </div>
      <output className="ocean-gauge" aria-live="polite" aria-label={`depth ${depthM} metres, ${zone}`}>
        {`${depthM} m · ${zone}`}
      </output>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .ocean-title {
          position: fixed;
          z-index: 3;
          top: 78px;
          left: var(--pad-x, 24px);
          pointer-events: none;
          transition: opacity 600ms ease;
          mix-blend-mode: screen;
        }
        .ocean-title span {
          display: block;
          margin-bottom: 8px;
          color: rgba(226, 240, 244, 0.62);
          font-family: var(--font-mono);
          font-size: 11px;
          line-height: 1;
          letter-spacing: 0.04em;
          text-transform: lowercase;
        }
        .ocean-title strong {
          display: block;
          color: rgba(238, 247, 250, 0.9);
          font-family: var(--font-serif);
          font-size: 108px;
          font-weight: 500;
          line-height: 0.86;
        }
        .ocean-gauge {
          position: fixed;
          z-index: 3;
          right: var(--pad-x, 24px);
          bottom: calc(22px + env(safe-area-inset-bottom, 0px));
          padding: 6px 12px;
          border: 1px solid rgba(226, 240, 244, 0.14);
          border-radius: 999px;
          background: rgba(6, 14, 26, 0.42);
          color: rgba(226, 240, 244, 0.72);
          font-family: var(--font-mono);
          font-size: 11px;
          letter-spacing: 0.03em;
          pointer-events: none;
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
        }

        body:has(.ocean-body) {
          overflow: hidden;
          background: #03070f;
        }
        body:has(.ocean-body) header:not(.oda-site-header) {
          display: none !important;
        }
        body:has(.ocean-body) .oda-field-watch,
        body:has(.ocean-body) .oda-candle-mark,
        body:has(.ocean-body) .oda-tape-shell,
        body:has(.ocean-body) .oda-sound-toggle {
          display: none !important;
        }

        @media (max-width: 940px) {
          .ocean-title { top: 34px; left: 22px; }
          .ocean-title strong { font-size: 74px; }
        }
        @media (max-width: 520px) {
          .ocean-title strong { font-size: 58px; }
          .ocean-gauge { right: 14px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .ocean-title { transition: none; }
        }
      `,
        }}
      />
    </div>
  );
}

/**
 * The Great Wave — a Hokusai-inspired breaking swell drawn on the 2D surface
 * layer over the WebGL water.
 *
 * It is fully procedural so it lives: the crest sharpens into pointed claws,
 * a hero curl barrels forward across the upper sea and sheds the iconic
 * foam fingers, and the whole form drifts and breathes with time. Scales
 * from phone to desktop off the smaller viewport dimension.
 */
function drawGreatWave(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  horizonY: number,
  t: number,
  swellMod: number,
) {
  const S = Math.min(w, h);
  // the wave rides the upper sea, just under the horizon haze
  const waveBaseY = horizonY + (h - horizonY) * 0.26;
  const drift = t * 22;
  const breathe = 1 + Math.sin(t * 0.5) * 0.04;
  const baseAmp = S * 0.05 * swellMod;
  const heroAmp = S * 0.22 * breathe * swellMod;
  // the hero curl wanders slowly across the upper sea
  const heroX = w * (0.30 + 0.03 * Math.sin(t * 0.05));
  const heroW = w * 0.55;

  const heroBoost = (x: number) =>
    Math.exp(-Math.pow((x - heroX) / (heroW * 0.5), 2));

  // a sharpened, drifting crest — pointed like Hokusai's water, not a smooth
  // sine — amplified under the hero curl.
  const crestY = (x: number) => {
    const ph = x * 0.011 - drift * 0.012;
    let s =
      Math.sin(ph) +
      0.42 * Math.sin(ph * 2.3 - drift * 0.02) +
      0.22 * Math.sin(ph * 3.9 + drift * 0.015);
    s = s / 1.64; // ~ -1..1
    s = Math.sign(s) * Math.pow(Math.abs(s), 0.72); // sharpen the crests
    const amp = baseAmp + heroAmp * heroBoost(x);
    return waveBaseY - amp * (s * 0.5 + 0.5);
  };

  // ── filled wave body — prussian-blue swell ──────────────────────
  const footY = waveBaseY + baseAmp * 1.4;
  ctx.beginPath();
  ctx.moveTo(0, crestY(0));
  for (let x = 4; x <= w; x += 4) ctx.lineTo(x, crestY(x));
  ctx.lineTo(w, footY);
  ctx.lineTo(0, footY);
  ctx.closePath();
  const body = ctx.createLinearGradient(0, waveBaseY - heroAmp, 0, footY);
  body.addColorStop(0.0, "rgba(28, 64, 104, 0.0)");
  body.addColorStop(0.12, "rgba(20, 56, 96, 0.52)");
  body.addColorStop(0.42, "rgba(10, 34, 70, 0.62)");
  body.addColorStop(0.72, "rgba(6, 22, 52, 0.34)");
  body.addColorStop(1.0, "rgba(4, 16, 40, 0.0)");
  ctx.fillStyle = body;
  ctx.fill();

  // ── foam crest line ─────────────────────────────────────────────
  ctx.strokeStyle = "rgba(244, 250, 252, 0.85)";
  ctx.lineWidth = 2.0;
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let x = 0; x <= w; x += 4) {
    const y = crestY(x);
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // ── claw foam scattered along the crest (Hokusai's fingers) ─────
  for (let x = 6; x <= w; x += 9) {
    const boost = heroBoost(x);
    const y = crestY(x);
    const tw = 0.5 + 0.5 * Math.sin(t * 3 + x * 0.05);
    const density = 0.12 + boost * 0.9;
    if (tw * density > 0.32) {
      const r = (0.8 + boost * 2.2) * (0.6 + tw * 0.6);
      ctx.fillStyle = `rgba(247, 251, 252, ${0.25 + boost * 0.5})`;
      ctx.beginPath();
      ctx.arc(x, y - r * 0.4, r, 0, 7);
      ctx.fill();
    }
  }

  // ── the hero barrel: curling lip + spiral eye + claw fingers ────
  const eyeX = heroX + S * 0.085;
  const eyeY = waveBaseY - heroAmp * 0.52;
  const R = S * 0.135 * breathe;

  // the overhanging lip — a bright thick arc sweeping up and over, curling
  // forward to the right (canvas y is down, so this traces left → top → right)
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(248, 252, 253, 0.95)";
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.arc(eyeX, eyeY, R, Math.PI * 1.08, Math.PI * 2.18, false);
  ctx.stroke();

  // inner curls of the barrel — nested fading arcs spiralling into the eye
  for (let k = 1; k <= 3; k++) {
    ctx.strokeStyle = `rgba(236, 246, 250, ${0.5 - k * 0.12})`;
    ctx.lineWidth = 2.2 - k * 0.4;
    ctx.beginPath();
    ctx.arc(
      eyeX + k * R * 0.06,
      eyeY + k * R * 0.05,
      R * (1 - 0.2 * k),
      Math.PI * 1.15,
      Math.PI * 2.05,
      false,
    );
    ctx.stroke();
  }

  // claw fingers spilling off the lip tip — small circles raining forward
  const tipX = eyeX + Math.cos(Math.PI * 2.18) * R;
  const tipY = eyeY + Math.sin(Math.PI * 2.18) * R;
  const fingers = 7;
  for (let i = 0; i < fingers; i++) {
    const f = i / (fingers - 1);
    const ang = -0.5 + f * 1.9; // fan from up-right to down
    const reach = R * (0.5 + f * 0.9);
    const fx = tipX + Math.cos(ang) * reach;
    const fy = tipY + Math.sin(ang) * reach * 0.7;
    const tw = 0.5 + 0.5 * Math.sin(t * 4 + i * 1.3);
    const fr = (2.4 - f * 1.4) * (0.6 + tw * 0.6);
    ctx.fillStyle = `rgba(248, 252, 253, ${0.5 - f * 0.32})`;
    ctx.beginPath();
    ctx.arc(fx, fy, Math.max(0.6, fr), 0, 7);
    ctx.fill();
    // a tiny trailing droplet
    ctx.beginPath();
    ctx.arc(fx + fr * 1.4, fy + fr * 1.1, Math.max(0.4, fr * 0.45), 0, 7);
    ctx.fill();
  }
}
