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

    // ── crashing waves ────────────────────────────────────────────
    // Each gesture spawns a "crasher" — a claw wave that rises, peaks,
    // breaks, sheds spray, then dies. Some ride sideways so a swipe
    // reads as a wave train moving in that direction.
    type Crasher = {
      t0: number;
      x0: number;
      y: number;
      vx: number;
      size: number;
      dir: number;
      duration: number;
      breakAt: number;
      broken: boolean;
      kind: "ambient" | "tap" | "hold" | "swipe" | "shake" | "flip";
    };
    const crashers: Crasher[] = [];
    const MAX_CRASHERS = 14;
    let lastAmbientCrasherAt = 0;
    const spawnCrasher = (opts: {
      x: number;
      y: number;
      vx?: number;
      size?: number;
      dir?: number;
      duration?: number;
      breakAt?: number;
      kind?: Crasher["kind"];
    }) => {
      crashers.push({
        t0: performance.now(),
        x0: opts.x,
        y: opts.y,
        vx: opts.vx ?? 0,
        size: opts.size ?? 0.55,
        dir: opts.dir ?? 0,
        duration: opts.duration ?? 2.2,
        breakAt: opts.breakAt ?? 0.55,
        broken: false,
        kind: opts.kind ?? "ambient",
      });
      if (crashers.length > MAX_CRASHERS) crashers.shift();
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

    // per-finger hold timers + move trails so we can distinguish
    // tap / long-hold / swipe on pointerup.
    const holdTimers = new Map<number, ReturnType<typeof setTimeout>>();
    const trails = new Map<number, Array<{ x: number; y: number; t: number }>>();
    const HOLD_MS = 780;
    const SWIPE_MIN_PX = 42;
    const SWIPE_MAX_MS = 480;

    // ── device sensors ────────────────────────────────────────────
    const tiltTarget = { x: 0, y: 0 };
    const tiltSmoothed = { x: 0, y: 0 };
    let sensorsArmed = false;
    let lastAccelMag: number | null = null;
    let lastShakeAt = 0;
    // flip detection: watch beta+gamma for a rapid crossing (phone rotated
    // face-down or spun on its own axis in < 350ms)
    let lastOrient: { beta: number; gamma: number; t: number } | null = null;
    let lastFlipAt = 0;

    const onOrient = (e: DeviceOrientationEvent) => {
      const beta = e.beta ?? 0;
      const gamma = e.gamma ?? 0;
      const gx = gamma / 45;
      const gy = (beta - 45) / 45;
      tiltTarget.x = Math.max(-1, Math.min(1, gx));
      tiltTarget.y = Math.max(-1, Math.min(1, gy));

      const now = performance.now();
      if (lastOrient) {
        const dt = now - lastOrient.t;
        if (dt > 0 && dt < 350) {
          const rate = Math.hypot(beta - lastOrient.beta, gamma - lastOrient.gamma) / (dt / 1000);
          if (rate > 260 && now - lastFlipAt > 900) {
            lastFlipAt = now;
            const w = surf.clientWidth || 1;
            const h = surf.clientHeight || 1;
            const cy = h * 0.15 + (h - h * 0.15) * 0.68;
            // Flip = a whole-frame swell: three crashers marching across
            for (let i = 0; i < 3; i++) {
              spawnCrasher({
                x: w * (0.15 + i * 0.35),
                y: cy,
                vx: -80 + Math.random() * 160,
                size: 1.1 + Math.random() * 0.2,
                dir: (Math.random() - 0.5) * 0.4,
                duration: 2.6,
                kind: "flip",
              });
            }
            try { getFieldAudio().thud(); } catch { /* noop */ }
            try { getFieldAudio().playTone(90, 0.9); } catch { /* noop */ }
            haptics.storm();
            useField.getState().recordTape("ripple", 1, "flip");
          }
        }
      }
      lastOrient = { beta, gamma, t: now };
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
            // shake = spawn a big crasher at a random side of the frame
            const w = surf.clientWidth || 1;
            const h = surf.clientHeight || 1;
            const cy = h * 0.15 + (h - h * 0.15) * 0.68;
            const fromLeft = Math.random() < 0.5;
            spawnCrasher({
              x: fromLeft ? w * 0.1 : w * 0.9,
              y: cy,
              vx: (fromLeft ? 1 : -1) * (60 + jolt * 6),
              size: Math.min(1.15, 0.7 + jolt / 30),
              dir: fromLeft ? 0.05 : Math.PI - 0.05,
              duration: 2.4,
              kind: "shake",
            });
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

    const seaLevelPx = () => {
      const h = surf.clientHeight || 1;
      const horizon = h * 0.15;
      return horizon + (h - horizon) * 0.68;
    };

    const onDown = (e: PointerEvent) => {
      const r = surf.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const p = pressureOf(e);
      const now = performance.now();
      pressed.set(e.pointerId, { x, y, lastEmit: now });
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
        // hard-press taps immediately spawn a small crasher at the surface
        if (p > 0.55) {
          spawnCrasher({
            x, y: seaLevelPx(),
            size: 0.5 + p * 0.35,
            dir: (x > (surf.clientWidth || 0) / 2) ? Math.PI - 0.1 : 0.1,
            duration: 1.8,
            kind: "tap",
          });
        }
      }
      // start hold timer + trail — used to classify tap vs hold vs swipe on up
      trails.set(e.pointerId, [{ x, y, t: now }]);
      const holdTimer = setTimeout(() => {
        // finger still held after HOLD_MS → summon a big crasher toward it
        if (!pressed.has(e.pointerId)) return;
        const f = pressed.get(e.pointerId)!;
        spawnCrasher({
          x: f.x, y: seaLevelPx(),
          size: 1.1,
          dir: (f.x > (surf.clientWidth || 0) / 2) ? Math.PI - 0.2 : 0.2,
          duration: 2.8,
          breakAt: 0.62,
          kind: "hold",
        });
        try { getFieldAudio().playTone(120, 0.7); } catch { /* noop */ }
        haptics.storm();
        useField.getState().recordTape("ripple", 0.9, "hold");
      }, HOLD_MS);
      holdTimers.set(e.pointerId, holdTimer);
      armSensors();
    };
    const onUp = (e: PointerEvent) => {
      const holdT = holdTimers.get(e.pointerId);
      if (holdT != null) clearTimeout(holdT);
      holdTimers.delete(e.pointerId);
      // classify swipe: was the movement fast + directional?
      const trail = trails.get(e.pointerId);
      if (trail && trail.length >= 2) {
        const first = trail[0];
        const last = trail[trail.length - 1];
        const dtMs = last.t - first.t;
        const dx = last.x - first.x;
        const dy = last.y - first.y;
        const dist = Math.hypot(dx, dy);
        if (dtMs > 40 && dtMs < SWIPE_MAX_MS && dist > SWIPE_MIN_PX && depthRef.current < 0.38) {
          const speed = dist / dtMs; // px per ms
          const ang = Math.atan2(dy, dx);
          const vx = Math.cos(ang) * Math.min(340, speed * 500);
          // swipe = a wave train rolling in the swipe direction
          spawnCrasher({
            x: last.x, y: seaLevelPx(),
            vx,
            size: 0.6 + Math.min(0.5, speed * 0.5),
            dir: Math.cos(ang) >= 0 ? 0.1 : Math.PI - 0.1,
            duration: 2.4,
            breakAt: 0.6,
            kind: "swipe",
          });
          try { getFieldAudio().playNote(64 + Math.floor(dy * 0.02), 180); } catch { /* noop */ }
          useField.getState().recordTape("ripple", 0.7, "swipe");
        }
      }
      trails.delete(e.pointerId);
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

      // record trail (bounded to last 12 samples per finger)
      const tr = trails.get(e.pointerId);
      if (tr) {
        tr.push({ x, y, t: now });
        if (tr.length > 12) tr.shift();
      }

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
        const speed = 0.42 + f * 0.75;
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
      // A staged composition: snow-capped Fuji on the horizon, a receding
      // chorus of dark background peaks, then the vast prussian foreground
      // wave curling over the frame and raining claw-foam. Procedural so it
      // drifts and breathes — the wave is never still — and scales from
      // phone to desktop.
      // Device tilt sways the whole wave (gyroscopic Hokusai physics):
      // rolling the phone left/right shifts the wave's centre and tips its
      // curling lip so the swell always leans downhill toward the low edge.
      const tiltSway = tiltSmoothed.x;
      const tiltPitch = tiltSmoothed.y;
      drawFuji(sctx, w, h, horizonY);
      drawDistantSwells(sctx, w, h, horizonY, t * motion, swellMod);
      drawGreatWave(sctx, w, h, horizonY, t * motion, swellMod, tiltSway, tiltPitch);
      drawSecondaryWave(sctx, w, h, horizonY, t * motion, swellMod, tiltSway);

      // ── auto-ambient crashers: keep a low-key procession of waves
      //    rolling in even when nothing is being touched. ──────────
      if (now - lastAmbientCrasherAt > 2100) {
        lastAmbientCrasherAt = now;
        const fromLeft = Math.random() < 0.5;
        const w0 = surf.clientWidth || 1;
        const h0 = surf.clientHeight || 1;
        const horizon0 = h0 * 0.15;
        const sea0 = horizon0 + (h0 - horizon0) * 0.68;
        spawnCrasher({
          x: fromLeft ? -30 : w0 + 30,
          y: sea0 + (Math.random() - 0.5) * 20,
          vx: (fromLeft ? 1 : -1) * (55 + Math.random() * 65),
          size: 0.30 + Math.random() * 0.30,
          dir: fromLeft ? 0.08 : Math.PI - 0.08,
          duration: 2.2 + Math.random() * 0.6,
          breakAt: 0.5 + Math.random() * 0.15,
          kind: "ambient",
        });
      }

      // ── draw + tick all live crashers ────────────────────────────
      drawCrashers(sctx, crashers, now, t, addRipple, addSpark);

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
 * Snow-capped Fuji on the horizon — the small quiet triangle Hokusai
 * anchors his wave against. Drawn with a soft pale side, a bright snowcap,
 * and a hint of cream haze at the base so it reads at any viewport size.
 */
function drawFuji(
  ctx: CanvasRenderingContext2D,
  w: number,
  _h: number,
  horizonY: number,
) {
  const cx = w * 0.62;
  const peakY = horizonY - w * 0.055;
  const base = w * 0.22;
  const baseY = horizonY + 2;
  // silhouette
  ctx.beginPath();
  ctx.moveTo(cx - base, baseY);
  // gentle asymmetry — the left side rises a touch faster
  ctx.lineTo(cx - base * 0.12, peakY + 4);
  ctx.lineTo(cx, peakY);
  ctx.lineTo(cx + base * 0.18, peakY + 6);
  ctx.lineTo(cx + base, baseY);
  ctx.closePath();
  const body = ctx.createLinearGradient(0, peakY, 0, baseY);
  body.addColorStop(0.0, "rgba(70, 80, 96, 0.88)");
  body.addColorStop(0.55, "rgba(52, 62, 78, 0.75)");
  body.addColorStop(1.0, "rgba(214, 202, 174, 0.32)"); // haze into paper
  ctx.fillStyle = body;
  ctx.fill();

  // snowcap — a jagged white crown along the summit
  ctx.beginPath();
  ctx.moveTo(cx - base * 0.36, peakY + base * 0.28);
  ctx.lineTo(cx - base * 0.22, peakY + base * 0.16);
  ctx.lineTo(cx - base * 0.10, peakY + base * 0.22);
  ctx.lineTo(cx - base * 0.02, peakY + base * 0.06);
  ctx.lineTo(cx + base * 0.05, peakY + base * 0.18);
  ctx.lineTo(cx + base * 0.16, peakY + base * 0.10);
  ctx.lineTo(cx + base * 0.28, peakY + base * 0.24);
  ctx.lineTo(cx + base * 0.14, peakY + 4);
  ctx.lineTo(cx, peakY);
  ctx.lineTo(cx - base * 0.12, peakY + 4);
  ctx.closePath();
  ctx.fillStyle = "rgba(246, 250, 252, 0.94)";
  ctx.fill();

  // a paler brushed line where snow meets slope
  ctx.strokeStyle = "rgba(238, 244, 248, 0.55)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - base * 0.34, peakY + base * 0.30);
  ctx.lineTo(cx - base * 0.05, peakY + base * 0.14);
  ctx.lineTo(cx + base * 0.10, peakY + base * 0.20);
  ctx.lineTo(cx + base * 0.30, peakY + base * 0.28);
  ctx.stroke();
}

/**
 * A chorus of dark background peaks receding into haze — the second and
 * third waves that stand behind Hokusai's hero curl and give it depth.
 * Same phase seed as the foreground so the whole sea reads as one system.
 */
function drawDistantSwells(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  horizonY: number,
  t: number,
  swellMod: number,
) {
  const drift = t * 12;
  const layers = [
    { y: horizonY + 6, amp: 10 * swellMod, freq: 0.020, alpha: 0.55, tint: "rgba(28, 60, 96," },
    { y: horizonY + 20, amp: 18 * swellMod, freq: 0.015, alpha: 0.72, tint: "rgba(20, 46, 82," },
  ];
  for (const L of layers) {
    ctx.beginPath();
    ctx.moveTo(0, L.y);
    for (let x = 0; x <= w; x += 3) {
      const ph = x * L.freq + drift * 0.003;
      let s = Math.sin(ph) + 0.45 * Math.sin(ph * 2.1 + drift * 0.006);
      s = Math.sign(s) * Math.pow(Math.abs(s / 1.45), 0.7);
      const y = L.y - Math.max(0, s) * L.amp; // only the crests rise above baseline
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, L.y + L.amp * 0.6);
    ctx.lineTo(0, L.y + L.amp * 0.6);
    ctx.closePath();
    ctx.fillStyle = `${L.tint}${L.alpha})`;
    ctx.fill();

    // pale crest highlight along the top edge
    ctx.strokeStyle = `rgba(232, 244, 250, ${L.alpha * 0.55})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 3) {
      const ph = x * L.freq + drift * 0.003;
      let s = Math.sin(ph) + 0.45 * Math.sin(ph * 2.1 + drift * 0.006);
      s = Math.sign(s) * Math.pow(Math.abs(s / 1.45), 0.7);
      const y = L.y - Math.max(0, s) * L.amp;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // horizon veil so the peaks bleed into the sky haze
  const veil = ctx.createLinearGradient(0, horizonY - 4, 0, horizonY + 28);
  veil.addColorStop(0, "rgba(232, 220, 190, 0.35)");
  veil.addColorStop(1, "rgba(232, 220, 190, 0.0)");
  ctx.fillStyle = veil;
  ctx.fillRect(0, horizonY - 4, w, 32);
  void h;
}

/**
 * The Great Wave — a Hokusai-inspired breaking swell that dominates the
 * frame from the left, its enormous prussian body arching over into a
 * bright barrel eye and raining a cascade of claw-foam fingers forward.
 *
 * Fully procedural: the silhouette breathes and drifts, the crest is
 * sharpened into Hokusai's pointed water rather than a smooth sine, and
 * the whole form scales from phone to desktop off the smaller viewport
 * dimension.
 */
function drawGreatWave(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  horizonY: number,
  t: number,
  swellMod: number,
  tiltSway: number = 0,
  tiltPitch: number = 0,
) {
  const S = Math.min(w, h);
  const seaH = h - horizonY;
  // Baseline: the resting water line the wave grows out of. Sit it well
  // below the horizon so the wave has room to tower up above Fuji.
  const seaLevel = horizonY + seaH * (0.68 + tiltPitch * 0.04);
  const footY = h + 6;
  const drift = t * 22;
  const breathe = 1 + Math.sin(t * 0.5) * 0.04;

  // Hero anchor + amplitude — the wave is the frame's centrepiece, so it
  // takes >= half the sea column and reaches up past the horizon line.
  // Device tilt shifts the hero laterally so the wave sways with the phone.
  const heroX = w * (0.36 + 0.02 * Math.sin(t * 0.05)) + tiltSway * w * 0.08;
  const heroW = Math.max(w * 0.85, S * 0.9);
  const heroAmp = Math.min(seaH * 0.62, S * 0.68) * breathe * swellMod;
  const peakX = heroX;
  const peakY = seaLevel - heroAmp;

  // Radius of the curling barrel — a slice of the hero amplitude. This
  // governs the eye size, the lip thickness and the reach of the claws.
  const R = Math.min(heroAmp * 0.62, S * 0.34) * breathe;

  const heroBoost = (x: number) => {
    const d = (x - heroX) / (heroW * 0.5);
    return Math.exp(-d * d);
  };

  // Sharpened pointed crest — Hokusai's water peaks in jagged fingers, not
  // smooth sines. Localised to the hero: away from it, crestY collapses to
  // seaLevel so the wave silhouette doesn't paint a shallow prussian slab
  // across the whole width.
  const crestY = (x: number) => {
    const ph = x * 0.013 - drift * 0.012;
    let s =
      Math.sin(ph) +
      0.42 * Math.sin(ph * 2.3 - drift * 0.02) +
      0.22 * Math.sin(ph * 3.9 + drift * 0.015);
    s = s / 1.64;
    s = Math.sign(s) * Math.pow(Math.abs(s), 0.55); // pointed
    const bump = heroBoost(x);
    // Only rise where the hero passes. Sharpened chop is layered ON TOP
    // and scaled by the same envelope so tiny wavelets away from the hero
    // don't leave the water raised.
    const rise = bump * heroAmp * (0.9 + s * 0.10);
    return seaLevel - rise;
  };

  // ── (1) main wave body — the prussian silhouette above sea level ──
  // Just the HUMP: rises above the resting sea line where the hero and the
  // ambient chop lift the water; returns to seaLevel elsewhere. The WebGL
  // ocean beneath is already painted, so we don't paint it again.
  const shoulderY = seaLevel + 3;
  ctx.beginPath();
  ctx.moveTo(0, shoulderY);
  for (let x = 0; x <= w; x += 3) {
    const y = crestY(x);
    ctx.lineTo(x, Math.min(y, shoulderY));
  }
  ctx.lineTo(w, shoulderY);
  ctx.closePath();
  const bodyGrad = ctx.createLinearGradient(0, peakY, 0, shoulderY + heroAmp * 0.2);
  bodyGrad.addColorStop(0.0, "rgba(30, 66, 112, 0.68)"); // sunlit shoulder
  bodyGrad.addColorStop(0.18, "rgba(16, 48, 92, 0.94)"); // Hokusai prussian
  bodyGrad.addColorStop(0.65, "rgba(8, 30, 66, 0.86)");
  bodyGrad.addColorStop(1.0, "rgba(4, 18, 44, 0.0)"); // fade into sea below
  ctx.fillStyle = bodyGrad;
  ctx.fill();


  // ── (2) crest ridge line + Hokusai claw foam texture ──────────────
  // A bright thin ink line running the sharpened crest. Comes first so the
  // sub-curls placed along it in the next pass cover it where they land.
  ctx.strokeStyle = "rgba(246, 251, 253, 0.82)";
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let x = 0; x <= w; x += 3) {
    const y = crestY(x);
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // ── (3) FRACTAL SUB-CURLS along the crest ──────────────────────────
  // Hokusai's wave isn't one curl — the whole crest is a chorus of smaller
  // curling barrels, each a self-similar copy of the hero. We place a fleet
  // of them along the crest at multiple scales, each with its own drift
  // phase so the whole ridge reads as tessellated water.
  //
  // The hero anchor at the peak gets the largest scale; siblings get
  // progressively smaller amplitudes falling off toward the flanks.
  const subCurls: Array<{ cx: number; cy: number; r: number; ang: number; alpha: number; depth: number }> = [];
  // The hero itself
  subCurls.push({
    cx: peakX + R * 0.15,
    cy: peakY + R * 0.20,
    r: R,
    ang: 0.05 + Math.sin(t * 0.4) * 0.06,
    alpha: 1.0,
    depth: 2,
  });
  // 7 satellites of decreasing scale scattered across the crest, weighted
  // toward the hero side so the composition stays balanced.
  const satellitePositions = [
    { fx: -0.68, size: 0.28, dropAng: 0.5 },
    { fx: -0.42, size: 0.42, dropAng: 0.3 },
    { fx: -0.18, size: 0.58, dropAng: 0.15 },
    { fx:  0.30, size: 0.50, dropAng: -0.05 },
    { fx:  0.55, size: 0.36, dropAng: -0.2 },
    { fx:  0.78, size: 0.24, dropAng: -0.35 },
    { fx:  0.95, size: 0.16, dropAng: -0.5 },
  ];
  for (let i = 0; i < satellitePositions.length; i++) {
    const s = satellitePositions[i];
    const sx = heroX + s.fx * heroW * 0.55;
    if (sx < -R * 0.2 || sx > w + R * 0.2) continue;
    const sy = crestY(sx) - R * s.size * 0.35;
    const wobble = Math.sin(t * 0.7 + i * 1.3) * 0.15;
    subCurls.push({
      cx: sx,
      cy: sy,
      r: R * s.size,
      ang: s.dropAng + wobble,
      alpha: 0.7 + heroBoost(sx) * 0.3,
      depth: s.size > 0.35 ? 1 : 0,
    });
  }

  // Draw the satellites first (back), then the hero (front) so the hero
  // reads on top — while claws from either can still spill over each other.
  for (let i = 1; i < subCurls.length; i++) {
    const c = subCurls[i];
    drawFractalCurl(ctx, c.cx, c.cy, c.r, c.ang, t, c.depth, c.alpha, i * 7.3);
  }
  const hero = subCurls[0];
  drawFractalCurl(ctx, hero.cx, hero.cy, hero.r, hero.ang, t, hero.depth, hero.alpha, 1.11);

  // ── (4) extra fine claw foam sprinkled along the whole crest ──────
  for (let x = 3; x <= w; x += 5) {
    const boost = heroBoost(x);
    const y = crestY(x);
    const tw = 0.5 + 0.5 * Math.sin(t * 3 + x * 0.05);
    const density = 0.10 + boost * 0.9;
    if (tw * density > 0.32) {
      const r = (0.7 + boost * 2.4) * (0.5 + tw * 0.5);
      ctx.fillStyle = `rgba(247, 251, 252, ${0.24 + boost * 0.45})`;
      ctx.beginPath();
      ctx.arc(x, y - r * 0.5, r, 0, 7);
      ctx.fill();
    }
  }
}

/**
 * A single self-similar Hokusai curl — a hollow crescent barrel with a
 * bright pale rim, nested inner arcs receding into the eye, and a shower
 * of claw fingers spilling off the leading tip. When `depth > 0` those
 * claws are themselves smaller curls, recursing until the scale gets too
 * small to matter, so the whole wave reads as a fractal cascade.
 *
 * `angle` is the direction the curl points its tip in (0 = right, π/2 =
 * down). `seed` shifts phase so simultaneous curls don't twitch in sync.
 */
function drawFractalCurl(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  angle: number,
  t: number,
  depth: number,
  alpha: number,
  seed: number,
) {
  if (r < 4 || alpha < 0.04) return;

  // ── logarithmic-spiral CLAW ────────────────────────────────────────
  // Hokusai's crests aren't semicircles — they're claw-shaped spirals
  // (paisley/comma silhouettes that tighten into a curled eye). We build
  // one by tracing two log-spiral arms and filling between them: the outer
  // arm from the wide base into the tight centre, then the inner arm
  // back out.  The Greek nautilus scroll uses the same construction.
  //
  //   r(θ) = r0 · exp(−b·θ)   log spiral, tightens as θ grows
  //
  // `angle` is the direction the claw's TIP curls toward. The base of the
  // claw grows out of the crest in the OPPOSITE direction (angle − π).
  const N = 40;
  const turns = 1.35;        // how many revolutions from base to centre
  const b = 0.28;            // tightness of the spiral
  const outerR = r;
  const innerRatio = 0.55;   // inner arm radius / outer
  // The spiral centre is offset from (cx, cy) in the direction of the tip
  // so the base of the claw plants itself right at the crest.
  const centerOffset = r * 0.18;
  const scx = cx + Math.cos(angle) * centerOffset;
  const scy = cy + Math.sin(angle) * centerOffset;

  const spiralPoint = (f: number, ratio: number) => {
    const theta = angle - Math.PI + f * Math.PI * 2 * turns;
    const rad = outerR * ratio * Math.exp(-b * f * Math.PI * 2 * turns);
    return { x: scx + Math.cos(theta) * rad, y: scy + Math.sin(theta) * rad };
  };

  // build the closed claw silhouette
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const p = spiralPoint(i / N, 1);
    if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  }
  for (let i = N; i >= 0; i--) {
    const p = spiralPoint(i / N, innerRatio);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();

  // Hokusai's prussian body with a sunlit outer edge
  const gx = Math.cos(angle - Math.PI / 2);
  const gy = Math.sin(angle - Math.PI / 2);
  const grad = ctx.createLinearGradient(cx - gx * r, cy - gy * r, cx + gx * r, cy + gy * r);
  grad.addColorStop(0.0, `rgba(232, 242, 246, ${0.95 * alpha})`); // sunlit crest
  grad.addColorStop(0.35, `rgba(80, 128, 168, ${0.92 * alpha})`);
  grad.addColorStop(0.75, `rgba(14, 44, 88, ${0.96 * alpha})`);
  grad.addColorStop(1.0, `rgba(4, 18, 48, ${0.98 * alpha})`);
  ctx.fillStyle = grad;
  ctx.fill();

  // pale brushed outline along the outer spiral — Hokusai's ink line
  ctx.strokeStyle = `rgba(240, 248, 252, ${0.9 * alpha})`;
  ctx.lineWidth = Math.max(1.0, r * 0.06);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const p = spiralPoint(i / N, 1);
    if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.restore();

  // ── inner receding spiral rings inside the claw's eye ─────────────
  // A pair of tightening arcs traces the Greek nautilus centre.
  for (let k = 0; k < 3; k++) {
    ctx.strokeStyle = `rgba(232, 244, 250, ${(0.55 - k * 0.13) * alpha})`;
    ctx.lineWidth = Math.max(0.7, r * 0.03 - k * 0.30);
    ctx.beginPath();
    const ringScale = innerRatio - k * 0.09;
    if (ringScale <= 0.05) break;
    for (let i = 0; i <= N; i++) {
      const p = spiralPoint(i / N, ringScale);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  // bright cusp at the claw's tightening tip (the spiral's inner point)
  const tip = spiralPoint(1, 1);
  const tipX = tip.x;
  const tipY = tip.y;
  const cusp = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, r * 0.28);
  cusp.addColorStop(0, `rgba(255, 255, 255, ${0.55 * alpha})`);
  cusp.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = cusp;
  ctx.beginPath();
  ctx.arc(tipX, tipY, r * 0.28, 0, 7);
  ctx.fill();

  // ── claw fingers off the tip — RECURSE into smaller curls or fall
  //    back to droplet chains at the finest scales ───────────────────
  const fingerCount = depth > 0 ? 5 : 6;
  const fanSpan = 1.6;
  for (let i = 0; i < fingerCount; i++) {
    const f = i / (fingerCount - 1);
    const fingerAng = angle + (f - 0.5) * fanSpan;
    const reach = r * (0.55 + f * 0.85);
    const fx = tipX + Math.cos(fingerAng) * reach;
    const fy = tipY + Math.sin(fingerAng) * reach * 0.82;
    const fr = r * (0.38 - f * 0.20);
    const twinkle = 0.65 + 0.35 * Math.sin(t * 2.8 + i * 1.7 + seed);
    if (depth > 0 && fr > 5) {
      // recurse: this finger is itself a smaller curl, tipped a bit further
      // in the tip's own direction. Alpha attenuates so recursion fades.
      drawFractalCurl(
        ctx,
        fx,
        fy,
        Math.max(4, fr),
        fingerAng - 0.15,
        t,
        depth - 1,
        alpha * (0.55 + twinkle * 0.15),
        seed + i * 3.7,
      );
    } else {
      // droplet chain — 5 shrinking foam blobs along the finger direction
      const chain = 5;
      for (let c = 0; c < chain; c++) {
        const cf = c / (chain - 1);
        const dr = fr * (1 - cf * 0.7) * (0.55 + twinkle * 0.5);
        if (dr < 0.4) continue;
        const dx = fx + Math.cos(fingerAng) * reach * 0.4 * cf;
        const dy = fy + Math.sin(fingerAng) * reach * 0.4 * cf + cf * cf * r * 0.28;
        ctx.fillStyle = `rgba(248, 252, 253, ${0.55 * alpha * (1 - cf * 0.6) * twinkle})`;
        ctx.beginPath();
        ctx.arc(dx, dy, dr, 0, 7);
        ctx.fill();
      }
    }
  }
}

/**
 * A secondary wave on the right — smaller, later in the cycle — so the
 * hero doesn't stand alone. Its crest peaks between the hero's crest and
 * the horizon, echoing Hokusai's second wave.
 */
function drawSecondaryWave(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  horizonY: number,
  t: number,
  swellMod: number,
  tiltSway: number = 0,
) {
  const S = Math.min(w, h);
  const seaH = h - horizonY;
  const troughY = horizonY + seaH * 0.55;
  const drift = t * 18;
  const amp = Math.min(seaH * 0.32, S * 0.24) * swellMod;
  // Tilt slides the secondary too, but by a smaller amount so parallax reads
  const cx = w * 0.86 + tiltSway * w * 0.05;
  const width = w * 0.58;
  const boost = (x: number) => {
    const d = (x - cx) / (width * 0.5);
    return Math.exp(-d * d);
  };
  const crestY = (x: number) => {
    const ph = x * 0.016 - drift * 0.018;
    let s = Math.sin(ph) + 0.4 * Math.sin(ph * 2.1 + drift * 0.02);
    s = Math.sign(s) * Math.pow(Math.abs(s / 1.4), 0.7);
    return troughY - amp * boost(x) * (s * 0.5 + 0.55);
  };

  // silhouette — a hump above seaLevel only, so we don't paint a slab
  // over the WebGL water below (same rule the hero uses).
  const xStart = w * 0.42;
  ctx.beginPath();
  ctx.moveTo(xStart, troughY);
  for (let x = xStart; x <= w; x += 3) {
    const y = crestY(x);
    ctx.lineTo(x, Math.min(y, troughY));
  }
  ctx.lineTo(w, troughY);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, troughY - amp, 0, troughY);
  grad.addColorStop(0.0, "rgba(28, 60, 100, 0.75)");
  grad.addColorStop(0.6, "rgba(12, 34, 74, 0.88)");
  grad.addColorStop(1.0, "rgba(4, 18, 42, 0.0)");
  ctx.fillStyle = grad;
  ctx.fill();

  // pale crest line
  ctx.strokeStyle = "rgba(240, 248, 252, 0.7)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let x = w * 0.42; x <= w; x += 3) {
    const y = crestY(x);
    if (x === w * 0.42) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // sparser claw foam
  for (let x = w * 0.5; x <= w; x += 8) {
    const b = boost(x);
    const y = crestY(x);
    const tw = 0.5 + 0.5 * Math.sin(t * 3 + x * 0.07);
    if (tw * (0.15 + b * 0.9) > 0.4) {
      const r = (0.7 + b * 1.8) * (0.6 + tw * 0.5);
      ctx.fillStyle = `rgba(246, 250, 252, ${0.25 + b * 0.4})`;
      ctx.beginPath();
      ctx.arc(x, y - r * 0.4, r, 0, 7);
      ctx.fill();
    }
  }
}

/**
 * Draw every live crashing wave and tick its lifecycle. Each crasher
 * rises → peaks → BREAKS (sheds a fan of foam claws + shockwave ripple)
 * → fades. Moving crashers (swipes, shakes, ambient) also slide their
 * position along the surface at `vx` px/sec so the wave visibly travels.
 *
 * Mutates the crashers array in place: expired entries are spliced out,
 * and each crasher's `broken` flag flips when it breaks so the break
 * feedback (ripple + spark) only fires once.
 */
type CrasherLite = {
  t0: number;
  x0: number;
  y: number;
  vx: number;
  size: number;
  dir: number;
  duration: number;
  breakAt: number;
  broken: boolean;
  kind: string;
};
function drawCrashers(
  ctx: CanvasRenderingContext2D,
  crashers: CrasherLite[],
  now: number,
  t: number,
  addRipple: (x: number, y: number, s: number) => void,
  addSpark: (x: number, y: number, s: number) => void,
) {
  const w = ctx.canvas.clientWidth || ctx.canvas.width;
  const h = ctx.canvas.clientHeight || ctx.canvas.height;
  const seaH = h - h * 0.15;
  const S = Math.min(w, h);

  for (let i = crashers.length - 1; i >= 0; i--) {
    const c = crashers[i];
    const age = (now - c.t0) / 1000;
    const phase = age / c.duration;
    if (phase >= 1) {
      crashers.splice(i, 1);
      continue;
    }

    // slide the crasher along the surface (swipes/ambient waves travel)
    const cx = c.x0 + c.vx * age;
    if (cx < -80 || cx > w + 80) {
      crashers.splice(i, 1);
      continue;
    }

    // amplitude envelope: 0 → 1 (rise) → 1 (crest) → 0 (crash/fade)
    let env: number;
    if (phase < 0.18) env = phase / 0.18;
    else if (phase < c.breakAt) env = 1;
    else if (phase < 0.9) env = 1 - (phase - c.breakAt) / (0.9 - c.breakAt);
    else env = 0;

    // radius of the claw. `size` in [0.3..1.3] rescales from a S-relative base.
    const baseR = S * 0.13;
    const r = baseR * c.size * (0.55 + env * 0.9);
    const peakY = c.y - r * 1.7 * env;

    // spawn the break event once (spray + shockwave ripple + haptic beat)
    if (!c.broken && phase >= c.breakAt) {
      c.broken = true;
      addRipple(cx, c.y, 18 * c.size);
      // a shower of foam droplets forward of the tip
      const forwardX = cx + Math.cos(c.dir) * r * 1.5;
      const forwardY = peakY + r * 0.6;
      for (let s = 0; s < 8; s++) {
        addSpark(
          forwardX + (Math.random() - 0.5) * r * 1.2,
          forwardY + Math.random() * r * 0.8,
          0.18 * c.size,
        );
      }
    }

    if (env <= 0 || r < 4) continue;

    // The crasher is drawn as a log-spiral claw (same drawFractalCurl the
    // hero uses) so it matches the rest of the composition. Depth 1 gives
    // one level of recursive sub-claws; alpha and size follow the envelope.
    const drawDepth = c.size > 0.8 ? 1 : 0;
    const alpha = Math.min(1, env * (0.75 + c.size * 0.35));
    // dir is the direction the claw curls toward
    drawFractalCurl(ctx, cx, peakY, r, c.dir, t, drawDepth, alpha, c.t0 % 100);

    // during the crash, shed a fan of extra spray forward
    if (phase >= c.breakAt && phase < 0.88) {
      const crashF = (phase - c.breakAt) / (0.88 - c.breakAt); // 0..1
      const fans = 3;
      const fanAlpha = (1 - crashF) * 0.7;
      for (let fi = 0; fi < fans; fi++) {
        const fF = fi / (fans - 1);
        const ang = c.dir + (fF - 0.5) * 1.7;
        const reach = r * (1.1 + crashF * 1.4);
        const dropletCount = 5;
        for (let dc = 0; dc < dropletCount; dc++) {
          const df = dc / (dropletCount - 1);
          const dropRad = r * (0.25 - df * 0.15) * (1 - crashF * 0.4);
          if (dropRad < 0.5) continue;
          const dx = cx + Math.cos(ang) * reach * (0.4 + df * 0.9);
          const dy = peakY + Math.sin(ang) * reach * (0.4 + df * 0.7) + df * df * r * 0.7;
          ctx.fillStyle = `rgba(248, 252, 253, ${fanAlpha * (1 - df * 0.5)})`;
          ctx.beginPath();
          ctx.arc(dx, dy, Math.max(0.5, dropRad), 0, 7);
          ctx.fill();
        }
      }

      // shockwave ring expanding from the impact point
      const ringR = r * (1.6 + crashF * 4.5);
      const ringAlpha = (1 - crashF) * 0.55;
      ctx.strokeStyle = `rgba(232, 244, 250, ${ringAlpha})`;
      ctx.lineWidth = 1.2 + crashF * 0.6;
      ctx.beginPath();
      ctx.ellipse(cx, c.y, ringR, ringR * 0.35, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // avoid unused warning
    void seaH;
  }
}
