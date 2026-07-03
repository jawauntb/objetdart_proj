"use client";

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { useField } from "@/store/field";
import GreekKeyFrame from "@/components/GreekKeyFrame";
import WaterText from "@/components/WaterText";

type WeatherCell = {
  id: number;
  kind: "vapor" | "storm";
  x: number;
  y: number;
  t0: number;
  strength: number;
  spread: number;
  drift: number;
  lift: number;
  phase: number;
  rain: number;
};

type WindStroke = {
  id: number;
  points: Array<{ x: number; y: number; t: number }>;
  t0: number;
  releasedAt: number | null;
  strength: number;
  vx: number;
  vy: number;
  hue: number;
};

type RainVeil = {
  id: number;
  x: number;
  y: number;
  t0: number;
  strength: number;
  width: number;
  slant: number;
  seed: number;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * /clouds — Olympus. The cloud floor.
 *
 * Air element of a four-element cosmology, rendered in a Minoan-Greek key.
 * Layer model:
 *   1. WebGL fragment shader: sky gradient + four cloud bands (cirrus,
 *      altostratus, cumulus, nimbus) painted from a 5-octave FBM. A 120s
 *      day-cycle interpolates between morning lilac → midday paper →
 *      afternoon rose → storm grey → deep purple. The cursor uv is passed
 *      to the shader so hovered sky thickens locally; pressing thickens
 *      further toward nimbus dark grey-lilac.
 *   2. 2D overlay: living vapor cells, drag-born wind shear, rain veils,
 *      lightning flash + lightning path, drifting Minoan air spirals at
 *      four altitudes, and the cloud-type labels along the right edge.
 *   3. DOM banners: <GreekKeyFrame /> on all four sides, plus the OLYMPUS title.
 *
 * The sky is an instrument: tap to condense vapor, drag to shear the cloud
 * field, and press for 0.8s+ to build a storm cell that takes lightning.
 * Thud + delayed bell makes the thunder. recordTape on each strike.
 *
 * prefers-reduced-motion freezes the day cycle and spiral drift; lightning
 * is still triggerable, but it never fires on its own.
 */
export default function Clouds() {
  // page-specific ambient bed: airy wind + bird-like tones
  useEffect(() => { getFieldAudio().setAmbientProfile("wind"); }, []);

  const wrapRef = useRef<HTMLDivElement>(null);
  const skyRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  const pointer = useRef<{
    x: number;
    y: number;
    uvx: number;
    uvy: number;
    over: boolean;
    pressed: boolean;
    pressStart: number;
  }>({ x: -1, y: -1, uvx: 0.5, uvy: 0.5, over: false, pressed: false, pressStart: 0 });

  // active lightning strikes (briefly painted by the overlay)
  const lightnings = useRef<
    Array<{ t0: number; segs: Array<{ x: number; y: number }>; flash: number }>
  >([]);

  // expressed sky phase 0..1, mirrored to DOM for banner color flip
  const [phaseLight, setPhaseLight] = useState(true);

  // Visible description popup for cloud-type label taps. Re-rendered in DOM.
  const [labelTip, setLabelTip] = useState<{
    name: string;
    text: string;
    top: string;
  } | null>(null);

  // Manual offset to the day-cycle phase (advanced by sun/moon glyph clicks).
  // Stored on the ref so the loop reads the live value without re-rendering.
  const phaseOffsetRef = useRef<number>(0);

  // current phase mirrored out of the render loop so the sun/moon glyph
  // shows the right icon (sun in day phases, moon in night phases).
  const [iconIsSun, setIconIsSun] = useState(true);
  const [pressCharge, setPressCharge] = useState(0);
  const weatherMarkIdRef = useRef(0);
  const [weatherMarks, setWeatherMarks] = useState<
    Array<{ id: number; label: string; level: number }>
  >([
    { id: 0, label: "thin air", level: 0.35 },
    { id: -1, label: "upper wind", level: 0.52 },
  ]);

  const addWeatherMark = (label: string, level: number) => {
    const id = ++weatherMarkIdRef.current;
    setWeatherMarks((marks) => [
      { id, label, level: clamp(level, 0, 1) },
      ...marks,
    ].slice(0, 4));
  };

  useEffect(() => {
    const wrap = wrapRef.current;
    const sky = skyRef.current;
    const overlay = overlayRef.current;
    if (!wrap || !sky || !overlay) return;
    const octx = overlay.getContext("2d");
    if (!octx) return;

    // ── WebGL setup ─────────────────────────────────────────────────
    const gl =
      (sky.getContext("webgl", { antialias: false, premultipliedAlpha: false }) ||
        sky.getContext(
          "experimental-webgl" as "webgl",
          { antialias: false, premultipliedAlpha: false } as WebGLContextAttributes,
        )) as WebGLRenderingContext | null;

    let glProg: WebGLProgram | null = null;
    let uTimeLoc: WebGLUniformLocation | null = null;
    let uResLoc: WebGLUniformLocation | null = null;
    let uPhaseLoc: WebGLUniformLocation | null = null;
    let uCursorLoc: WebGLUniformLocation | null = null;
    let uPressLoc: WebGLUniformLocation | null = null;
    let uFlashLoc: WebGLUniformLocation | null = null;
    let uWindLoc: WebGLUniformLocation | null = null;
    let lastChargeSync = 0;

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
        uniform float uPhase;   // 0..1 day cycle position
        uniform vec2 uCursor;   // uv 0..1, y up
        uniform float uPress;   // 0 = not pressed, 0..1 = held intensity
        uniform float uFlash;   // 0..1 short flash envelope
        uniform vec2 uWind;     // drag-driven shear vector
        varying vec2 vUv;

        // hash + value noise + fbm — the cloud substrate
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
            p = p * 2.07 + vec2(11.7, 3.2);
            a *= 0.52;
          }
          return v;
        }

        // 5-color day cycle. uPhase is 0..1 wrapping every 120s.
        vec3 skyColor(float p) {
          // stops:
          //   0.00 cold dawn blue     #8fa5c7
          //   0.25 pearl daylight     #d9e2e6
          //   0.50 gold rose          #e6b98f
          //   0.75 mineral storm      #596d72
          //   0.90 deep ion violet    #22243f
          vec3 c0 = vec3(0.561, 0.647, 0.780);
          vec3 c1 = vec3(0.851, 0.886, 0.902);
          vec3 c2 = vec3(0.902, 0.725, 0.561);
          vec3 c3 = vec3(0.349, 0.427, 0.447);
          vec3 c4 = vec3(0.133, 0.141, 0.247);
          vec3 col = c0;
          col = mix(col, c1, smoothstep(0.00, 0.25, p));
          col = mix(col, c2, smoothstep(0.25, 0.50, p));
          col = mix(col, c3, smoothstep(0.50, 0.75, p));
          col = mix(col, c4, smoothstep(0.75, 0.90, p));
          // loop back toward morning lilac in the last 10%
          col = mix(col, c0, smoothstep(0.90, 1.00, p));
          return col;
        }

        void main() {
          vec2 uv = vUv;                       // y up
          vec2 sky_uv = vec2(uv.x, 1.0 - uv.y); // y=0 top
          float aspect = uRes.x / uRes.y;
          float t = uTime;

          // ── base sky gradient ──────────────────────────────────
          vec3 base = skyColor(uPhase);
          // vertical gradient: cold, dense air overhead; warm scattering near horizon.
          float upper = smoothstep(0.10, 1.00, sky_uv.y);
          float horizon = 1.0 - smoothstep(0.02, 0.42, sky_uv.y);
          vec3 zenith = mix(base * vec3(0.62, 0.70, 0.92), vec3(0.085, 0.105, 0.165), upper * 0.38);
          vec3 lowAir = mix(base * 1.05, vec3(1.0, 0.74, 0.46), horizon * 0.26);
          vec3 sky = mix(lowAir, zenith, upper);
          sky += horizon * vec3(0.10, 0.055, 0.015);

          // is the sky "stormy" this minute? boosts cloud darkness.
          float stormy = smoothstep(0.55, 0.85, uPhase);

          // shared cloud uv with mild aspect correction so clouds aren't
          // squashed on wide windows
          float shear = smoothstep(0.08, 0.90, length(uWind));
          vec2 windDrift = vec2(uWind.x * 0.12, uWind.y * 0.05) * (0.45 + sky_uv.y);
          vec2 cuv = vec2(uv.x * aspect, uv.y) + windDrift;
          sky += shear * vec3(0.010, 0.016, 0.035);

          // ── cirrus (high, thin streaks) ─────────────────────────
          vec2 ci_uv = cuv * vec2(2.2, 6.0) + vec2(t * 0.012 + uWind.x * 0.55, uWind.y * 0.22);
          float cirrus = fbm(ci_uv);
          // mask: only in the top ~35% of the sky
          float ciMask = smoothstep(0.95, 0.55, sky_uv.y);
          float ciDensity = smoothstep(0.55, 0.78, cirrus) * ciMask;
          // cirrus is mostly light catching in ice: cool, not chalk-white.
          vec3 col = mix(sky, vec3(0.88, 0.94, 1.0), ciDensity * 0.38);

          // ── altostratus (mid, broad smooth sheet) ───────────────
          vec2 as_uv = cuv * vec2(0.9, 1.6) + vec2(t * 0.018 + uWind.x * 0.22, t * 0.004 + uWind.y * 0.06);
          float alto = fbm(as_uv);
          float asMask = smoothstep(0.75, 0.30, sky_uv.y) * smoothstep(0.05, 0.30, sky_uv.y);
          float asDensity = smoothstep(0.48, 0.74, alto) * asMask;
          vec3 asColor = mix(vec3(0.82, 0.88, 0.90), vec3(0.28, 0.34, 0.40), stormy);
          col = mix(col, asColor, asDensity * 0.42);

          // ── cumulus (low, puffy) — main hover/press target ──────
          vec2 cu_uv = cuv * 1.7 + vec2(t * 0.024 + uWind.x * 0.28, t * 0.009 + uWind.y * 0.10);
          float cum = fbm(cu_uv) + 0.12 * fbm(cu_uv * 2.7 + vec2(5.0, 9.0));
          // gentle altitude band
          float cuBand = smoothstep(0.62, 0.20, sky_uv.y) * smoothstep(0.02, 0.18, sky_uv.y);
          // local cursor thickening — lower the threshold near pointer
          vec2 cursorDelta = uv - uCursor;
          cursorDelta.x *= aspect;
          float dCursor = length(cursorDelta);
          float localPull = exp(-(dCursor * dCursor) / 0.06);
          float threshold = 0.55 - localPull * (0.06 + uPress * 0.12);
          float cuDensity = smoothstep(threshold, threshold + 0.18, cum) * cuBand;
          // cumulus tint — white when calm, deepening to lilac-grey when
          // stormy or locally held.
          float darkPush = clamp(stormy * 0.7 + localPull * uPress, 0.0, 1.0);
          vec3 cuColor = mix(vec3(0.91, 0.96, 0.98), vec3(0.235, 0.250, 0.345), darkPush);
          col = mix(col, cuColor, cuDensity * 0.82);

          // ── nimbus (low, dark, heavy) — emerges in storm phase ──
          vec2 nim_uv = cuv * 1.2 + vec2(t * 0.02 + uWind.x * 0.18, t * 0.006 + uWind.y * 0.08);
          float nim = fbm(nim_uv + vec2(7.3, 2.1));
          float nimBand = smoothstep(0.55, 0.10, sky_uv.y);
          // nimbus presence rides storm phase and local press
          float nimPresence = clamp(stormy + localPull * uPress * 0.9, 0.0, 1.0);
          float nimDensity = smoothstep(0.46, 0.66, nim) * nimBand * nimPresence;
          vec3 nimColor = vec3(0.125, 0.135, 0.195); // dark mineral blue
          col = mix(col, nimColor, nimDensity * 0.66);

          // ── horizon haze at the very bottom — paper-warm ────────
          float horizonGlow = smoothstep(0.0, 0.16, sky_uv.y);
          vec3 hazeColor = mix(vec3(0.945, 0.850, 0.675), base * 0.78, stormy);
          col = mix(hazeColor, col, horizonGlow);

          // gentle local cursor halo — sunlit moisture, not a drawn ring.
          col += localPull * 0.035 * vec3(0.82, 0.92, 1.0) * (1.0 - uPress);

          // lightning flash — ion-blue blast falling off with vertical distance
          // from the strike origin (we approximate that with a uniform global
          // intensity here; the 2D overlay paints the actual bolt).
          col += uFlash * vec3(0.68, 0.78, 1.0) * 0.42;

          float grain = hash21(gl_FragCoord.xy + floor(uTime * 12.0));
          col += (grain - 0.5) * 0.018;
          float vignette = smoothstep(1.10, 0.12, distance(uv, vec2(0.5, 0.54)));
          col *= 0.82 + vignette * 0.22;

          col = clamp(col, 0.0, 1.0);
          gl_FragColor = vec4(col, 1.0);
        }
      `;

      const compile = (type: number, src: string): WebGLShader | null => {
        const s = gl.createShader(type);
        if (!s) return null;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          console.warn("cloud shader compile failed", gl.getShaderInfoLog(s));
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
            uPhaseLoc = gl.getUniformLocation(p, "uPhase");
            uCursorLoc = gl.getUniformLocation(p, "uCursor");
            uPressLoc = gl.getUniformLocation(p, "uPress");
            uFlashLoc = gl.getUniformLocation(p, "uFlash");
            uWindLoc = gl.getUniformLocation(p, "uWind");

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

    // ── resize ─────────────────────────────────────────────────────
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      sky.width = Math.floor(w * dpr);
      sky.height = Math.floor(h * dpr);
      overlay.width = Math.floor(w * dpr);
      overlay.height = Math.floor(h * dpr);
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (gl) gl.viewport(0, 0, sky.width, sky.height);
    };
    resize();
    const ro = new ResizeObserver(() => {
      resize();
      reflowGlyphs();
    });
    ro.observe(wrap);

    // ── interaction ────────────────────────────────────────────────
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let nextWeatherId = 0;
    let activeWindStroke: WindStroke | null = null;
    let lastWindMark = 0;
    let windTargetX = 0;
    let windTargetY = 0;
    let windX = 0;
    let windY = 0;
    let activePointerId: number | null = null;

    // build a jagged path from (x0, y0) to (x1, y1) with mid-jitter forks
    const makeBolt = (x0: number, y0: number, x1: number, y1: number) => {
      const pts: Array<{ x: number; y: number }> = [{ x: x0, y: y0 }];
      const segs = 14;
      for (let i = 1; i < segs; i++) {
        const tt = i / segs;
        const cx = x0 + (x1 - x0) * tt;
        const cy = y0 + (y1 - y0) * tt;
        // perpendicular jitter — broader in the middle, tighter at ends
        const env = Math.sin(tt * Math.PI) * 0.5 + 0.18;
        const dx = (Math.random() - 0.5) * 80 * env;
        const dy = (Math.random() - 0.5) * 24 * env;
        pts.push({ x: cx + dx, y: cy + dy });
      }
      pts.push({ x: x1, y: y1 });
      return pts;
    };

    const clampToSky = (x: number, y: number) => {
      const w = overlay.clientWidth || 1280;
      const h = overlay.clientHeight || 720;
      return {
        x: clamp(x, 24, w - 24),
        y: clamp(y, 84, h - 48),
      };
    };

    const seedWeatherCell = (
      x: number,
      y: number,
      kind: WeatherCell["kind"],
      strength: number,
    ) => {
      const p = clampToSky(x, y);
      weatherCells.push({
        id: ++nextWeatherId,
        kind,
        x: p.x,
        y: p.y,
        t0: performance.now(),
        strength: clamp(strength, 0.2, 1),
        spread: kind === "storm" ? 0.72 + Math.random() * 0.28 : 0.70 + Math.random() * 0.55,
        drift: (Math.random() - 0.5) * (kind === "storm" ? 7 : 16),
        lift: kind === "storm" ? 0.35 + Math.random() * 0.35 : 1.2 + Math.random() * 1.8,
        phase: Math.random() * Math.PI * 2,
        rain: kind === "storm" ? 0.45 + Math.random() * 0.35 + strength * 0.22 : Math.random() * 0.10,
      });
      if (weatherCells.length > 20) weatherCells.shift();
    };

    const seedRainVeil = (x: number, y: number, strength: number, width = 180) => {
      const p = clampToSky(x, y);
      rainVeils.push({
        id: ++nextWeatherId,
        x: p.x,
        y: p.y,
        t0: performance.now(),
        strength: clamp(strength, 0.18, 1),
        width,
        slant: -10 + Math.random() * 22 + windTargetX * 18,
        seed: Math.random() * 1000,
      });
      if (rainVeils.length > 14) rainVeils.shift();
    };

    const beginWindStroke = (x: number, y: number) => {
      activeWindStroke = {
        id: ++nextWeatherId,
        points: [{ x, y, t: performance.now() }],
        t0: performance.now(),
        releasedAt: null,
        strength: 0.12,
        vx: 0,
        vy: 0,
        hue: Math.random(),
      };
      windStrokes.push(activeWindStroke);
      if (windStrokes.length > 14) windStrokes.shift();
    };

    const extendWindStroke = (x: number, y: number) => {
      if (!activeWindStroke) return;
      const nowMs = performance.now();
      const pts = activeWindStroke.points;
      const last = pts[pts.length - 1];
      const dx = x - last.x;
      const dy = y - last.y;
      const d = Math.hypot(dx, dy);
      if (d < 3) return;
      const dtSec = Math.max(0.016, (nowMs - last.t) / 1000);
      activeWindStroke.vx = dx / dtSec;
      activeWindStroke.vy = dy / dtSec;
      activeWindStroke.strength = clamp(activeWindStroke.strength + d / 120, 0, 1);
      pts.push({ x, y, t: nowMs });
      if (pts.length > 48) pts.shift();

      windTargetX = clamp(activeWindStroke.vx / 780, -1, 1);
      windTargetY = clamp(activeWindStroke.vy / 980, -1, 1);
      if (nowMs - lastWindMark > 420) {
        lastWindMark = nowMs;
        addWeatherMark("wind shear", Math.min(0.86, 0.32 + activeWindStroke.strength * 0.62));
      }
    };

    const releaseWindStroke = (record = true) => {
      if (!activeWindStroke) return;
      activeWindStroke.releasedAt = performance.now();
      if (record && activeWindStroke.points.length > 5) {
        useField.getState().recordTape("ripple", 0.42 + activeWindStroke.strength * 0.35, "clouds/wind-shear");
        if (activeWindStroke.strength > 0.55) {
          try { getFieldAudio().spark(); } catch { /* noop */ }
          haptics.ripple(0.22 + activeWindStroke.strength * 0.18);
        }
      }
      activeWindStroke = null;
    };

    const triggerLightning = (uvx: number, target?: { x: number; y: number }) => {
      const w = overlay.clientWidth;
      const h = overlay.clientHeight;
      // strike origin: near top, x near cursor
      const x0 = clamp(uvx * w + (Math.random() - 0.5) * 60, 40, w - 40);
      const y0 = h * 0.05;
      const x1 = target
        ? clamp(target.x + (Math.random() - 0.5) * 46, 20, w - 20)
        : clamp(x0 + (Math.random() - 0.5) * 220, 20, w - 20);
      const y1 = target
        ? clamp(target.y + (Math.random() - 0.5) * 30, h * 0.24, h - 30)
        : h * (0.55 + Math.random() * 0.25);
      lightnings.current.push({
        t0: performance.now(),
        segs: makeBolt(x0, y0, x1, y1),
        flash: 1,
      });
      if (lightnings.current.length > 4) lightnings.current.shift();

      const a = getFieldAudio();
      a.thud();
      // delayed bell = thunder reverb tail
      window.setTimeout(() => a.bell(), 380);
      haptics.storm();

      useField.getState().recordTape("region", 0.9, "olympus/lightning");
      addWeatherMark("lightning", 0.95);
    };

    // Look up the topmost glyph the pointer is currently touching.
    // We have to compute the live y including the bob, so this references
    // the current animation time via elapsedRef.
    const elapsedRef = { v: 0 }; // updated each frame
    const glyphAt = (px: number, py: number): Glyph | null => {
      // iterate front-to-back: bigger glyphs win
      let pick: Glyph | null = null;
      let pickArea = Infinity;
      for (const g of glyphs) {
        if (g.opacity < 0.24) continue;
        const y = reduce
          ? g.baseY
          : g.baseY + Math.sin(elapsedRef.v * g.bobFreq * Math.PI * 2 + g.phase) * g.bobAmp;
        // hit radius derived from drawing size — most glyphs paint within
        // about r * 0.5..1.6 of their center. Use a slightly larger radius
        // for touch (≥ 20px target).
        const hitR = Math.max(20, g.size * 0.85);
        const d2 = (g.x - px) * (g.x - px) + (y - py) * (y - py);
        if (d2 <= hitR * hitR && hitR < pickArea) {
          pick = g;
          pickArea = hitR;
        }
      }
      return pick;
    };

    const updatePointer = (e: PointerEvent) => {
      const r = overlay.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      pointer.current.x = x;
      pointer.current.y = y;
      // y=0 top in DOM, shader expects y=0 bottom
      pointer.current.uvx = clamp(x / r.width, 0, 1);
      pointer.current.uvy = clamp(1 - y / r.height, 0, 1);
      pointer.current.over = true;

      // update per-glyph hover state
      const touched = glyphAt(x, y);
      for (const g of glyphs) g.hovered = g === touched;
    };
    const onDown = (e: PointerEvent) => {
      if (activePointerId !== null) return;
      activePointerId = e.pointerId;
      try { overlay.setPointerCapture(e.pointerId); } catch { /* pointer capture can fail on cancelled touches */ }
      updatePointer(e);
      pointer.current.pressed = true;
      pointer.current.pressStart = performance.now();
      beginWindStroke(pointer.current.x, pointer.current.y);
      haptics.tap();
      addWeatherMark("pressure", 0.45);
    };
    const onMove = (e: PointerEvent) => {
      if (activePointerId !== null && e.pointerId !== activePointerId) return;
      updatePointer(e);
      if (pointer.current.pressed) {
        extendWindStroke(pointer.current.x, pointer.current.y);
      }
    };
    const clearActiveGesture = (pointerId?: number, recordWind = true) => {
      if (pointerId !== undefined) {
        try { overlay.releasePointerCapture(pointerId); } catch { /* already released */ }
      }
      activePointerId = null;
      releaseWindStroke(recordWind);
      pointer.current.pressed = false;
      setPressCharge(0);
    };
    const onUp = (e: PointerEvent) => {
      if (activePointerId !== null && e.pointerId !== activePointerId) return;
      const now = performance.now();
      const held = now - pointer.current.pressStart;
      if (pointer.current.pressed && pointer.current.over) {
        extendWindStroke(pointer.current.x, pointer.current.y);
      }
      if (pointer.current.pressed && held >= 800) {
        // strike comes off the held region (long-press lightning)
        const charge = clamp(held / 1800, 0, 1);
        seedWeatherCell(pointer.current.x, pointer.current.y, "storm", 0.64 + charge * 0.36);
        seedRainVeil(pointer.current.x, pointer.current.y + 44, 0.58 + charge * 0.42, 170 + charge * 110);
        triggerLightning(pointer.current.uvx, { x: pointer.current.x, y: pointer.current.y });
        addWeatherMark("storm cell", 0.88 + charge * 0.12);
      } else if (pointer.current.pressed && held < 500 && pointer.current.over) {
        // a tap. Route in priority: glyph → cloud puff.
        const px = pointer.current.x;
        const py = pointer.current.y;
        const g = glyphAt(px, py);
        if (g) {
          // soft whoosh + breadcrumb trail
          const a = getFieldAudio();
          a.spark();
          haptics.ripple(0.28);
          useField.getState().recordTape("sigil", 0.5, `clouds/${g.kind}`);
          addWeatherMark(g.kind.replace("-", " "), 0.5);
          // seed the trail at the glyph's current rendered position
          const y = reduce
            ? g.baseY
            : g.baseY + Math.sin(elapsedRef.v * g.bobFreq * Math.PI * 2 + g.phase) * g.bobAmp;
          for (let k = 0; k < 6; k++) {
            g.trail.push({
              x: g.x - g.vx * (k * 0.04), // backward steps along its drift
              y: y + (Math.random() - 0.5) * 2,
              t0: performance.now() + k * 30,
            });
          }
          // cap trail length
          while (g.trail.length > 18) g.trail.shift();
        } else {
          // a tap on empty sky — local cloud puff
          cloudPuffs.push({ x: px, y: py, t0: performance.now() });
          if (cloudPuffs.length > 8) cloudPuffs.shift();
          seedWeatherCell(px, py, "vapor", 0.40 + Math.random() * 0.22);
          const a = getFieldAudio();
          a.chime();
          haptics.ripple(0.38);
          useField.getState().recordTape("ripple", 0.4, "clouds/puff");
          addWeatherMark("vapor", 0.42);
        }
      }
      clearActiveGesture(e.pointerId);
    };
    const onCancel = (e: PointerEvent) => {
      if (activePointerId !== null && e.pointerId !== activePointerId) return;
      pointer.current.over = false;
      clearActiveGesture(e.pointerId, false);
    };
    const onLeave = () => {
      if (activePointerId !== null) return;
      pointer.current.over = false;
      clearActiveGesture();
    };
    overlay.addEventListener("pointerdown", onDown);
    overlay.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    // iOS fires pointercancel when a touch is interrupted (e.g. by a system
    // gesture). Without this the press state stays held forever.
    window.addEventListener("pointercancel", onCancel);
    overlay.addEventListener("pointerleave", onLeave);

    // ── air glyphs (Minoan wind chorus across altitudes) ───────────
    // A small library of shapes; each instance is randomly assigned one
    // and drifts at its own altitude / speed / bob / rotation.
    type GlyphKind =
      | "simple-spiral"
      | "double-spiral"
      | "wave-key"
      | "comma-trio"
      | "ring-spiral"
      | "wind-streak";

    type Glyph = {
      kind: GlyphKind;
      size: number;       // 12..48 px
      x: number;          // current x (px in CSS units)
      baseY: number;      // px
      vx: number;         // px/sec — drift speed (positive → right)
      bobAmp: number;     // px (2..6)
      bobFreq: number;    // rad/sec
      phase: number;      // radians — for bob + drawing variants
      opacity: number;    // 0.35..0.7
      strokeWidth: number; // 1.0..1.6
      rotation: number;   // current rotation in radians
      rotSpeed: number;   // rad/frame (signed)
      hovered: boolean;   // pointer-over state — drives scale + spin boost
      trail: Array<{ x: number; y: number; t0: number }>; // brief breadcrumb trail after click
    };

    // Spawn 12 glyphs across altitudes 8%..70%. Positions are seeded at
    // mount; the loop maintains them.
    const GLYPH_KINDS: GlyphKind[] = [
      "simple-spiral",
      "double-spiral",
      "wave-key",
      "comma-trio",
      "ring-spiral",
      "wind-streak",
    ];
    const GLYPH_COUNT = 8;
    const initialW = wrap.clientWidth || 1280;
    const initialH = wrap.clientHeight || 720;
    const glyphs: Glyph[] = [];
    for (let i = 0; i < GLYPH_COUNT; i++) {
      const yFrac = 0.08 + (i / GLYPH_COUNT) * 0.62 + (Math.random() - 0.5) * 0.04;
      const size = 10 + Math.random() * 28; // 10..38
      // Back glyphs (smaller, higher up) drift slowly; front glyphs faster.
      // Mix sizes with altitude so it doesn't look stratified.
      const altWeight = yFrac; // higher y → larger weight
      const baseSpeed = 4 + altWeight * 14 + Math.random() * 6; // 4..24 px/s
      glyphs.push({
        kind: GLYPH_KINDS[i % GLYPH_KINDS.length],
        size,
        x: Math.random() * initialW,
        baseY: yFrac * initialH,
        vx: baseSpeed * (Math.random() < 0.08 ? -1 : 1), // most drift right
        bobAmp: 2 + Math.random() * 4,
        bobFreq: 0.08 + Math.random() * 0.18,
        phase: Math.random() * Math.PI * 2,
        opacity: 0.08 + Math.random() * 0.12,
        strokeWidth: 0.75 + Math.random() * 0.45,
        rotation: Math.random() * Math.PI * 2,
        // 0.02..0.06 deg/frame, half clockwise / half counter
        rotSpeed: ((Math.random() * 0.04 + 0.02) * Math.PI) / 180 *
          (Math.random() < 0.5 ? -1 : 1),
        hovered: false,
        trail: [],
      });
    }

    // local clouds — soft visual puffs at recent cloud taps
    const cloudPuffs: Array<{ x: number; y: number; t0: number }> = [];
    const weatherCells: WeatherCell[] = [];
    const windStrokes: WindStroke[] = [];
    const rainVeils: RainVeil[] = [];
    const cloudClusters = Array.from({ length: 5 }).map((_, i) => ({
      xFrac: 0.08 + i * 0.22 + (Math.random() - 0.5) * 0.05,
      yFrac: 0.30 + (i % 3) * 0.12 + (Math.random() - 0.5) * 0.035,
      scale: 0.90 + Math.random() * 1.20,
      drift: 2.5 + Math.random() * 7,
      phase: Math.random() * Math.PI * 2,
    }));
    const iceCrystals = Array.from({ length: 34 }).map((_, i) => ({
      xFrac: (i * 0.381966 + Math.random() * 0.08) % 1,
      yFrac: 0.10 + Math.random() * 0.23,
      size: 1.4 + Math.random() * 3.8,
      spin: (Math.random() < 0.5 ? -1 : 1) * (0.15 + Math.random() * 0.35),
      phase: Math.random() * Math.PI * 2,
    }));

    // Keep baseY proportional on resize.
    const reflowGlyphs = () => {
      const h = wrap.clientHeight || 720;
      for (let i = 0; i < glyphs.length; i++) {
        const yFrac = 0.08 + (i / glyphs.length) * 0.62;
        glyphs[i].baseY = yFrac * h;
      }
    };

    const drawGlyph = (
      ctx: CanvasRenderingContext2D,
      g: Glyph,
      y: number,
      color: string,
    ) => {
      ctx.save();
      ctx.translate(g.x, y);
      ctx.rotate(g.rotation);
      ctx.globalAlpha = g.opacity;
      ctx.strokeStyle = color;
      ctx.lineWidth = g.strokeWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      const r = g.size;

      switch (g.kind) {
        case "simple-spiral": {
          // Archimedean curl, ~3π
          ctx.beginPath();
          const steps = 56;
          const maxTheta = Math.PI * 3;
          const a = r * 0.08;
          const b = r * 0.085;
          for (let i = 0; i <= steps; i++) {
            const theta = (i / steps) * maxTheta;
            const rr = a + b * theta;
            const px = Math.cos(theta) * rr;
            const py = Math.sin(theta) * rr;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
          break;
        }
        case "double-spiral": {
          // Two mirrored curls from a central node — yin-yang wind.
          // Tiny central dot via short arc
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.06, 0, Math.PI * 2);
          ctx.stroke();
          const steps = 44;
          const maxTheta = Math.PI * 2.4;
          const a = r * 0.06;
          const b = r * 0.07;
          // right curl
          ctx.beginPath();
          for (let i = 0; i <= steps; i++) {
            const theta = (i / steps) * maxTheta;
            const rr = a + b * theta;
            const px = Math.cos(theta) * rr;
            const py = Math.sin(theta) * rr;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
          // left curl (mirror through origin, rotated π)
          ctx.beginPath();
          for (let i = 0; i <= steps; i++) {
            const theta = (i / steps) * maxTheta;
            const rr = a + b * theta;
            const px = -Math.cos(theta) * rr;
            const py = -Math.sin(theta) * rr;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
          break;
        }
        case "wave-key": {
          // Short horizontal sine with curls at each end (Minoan wave).
          const halfLen = r * 0.95;
          const amp = r * 0.22;
          // central bezier sine — two humps
          ctx.beginPath();
          ctx.moveTo(-halfLen, 0);
          ctx.bezierCurveTo(
            -halfLen * 0.55, -amp * 2.0,
            -halfLen * 0.10,  amp * 2.0,
             halfLen * 0.40, -amp * 1.4,
          );
          ctx.bezierCurveTo(
             halfLen * 0.65, -amp * 1.0,
             halfLen * 0.90,  amp * 1.2,
             halfLen,         amp * 0.2,
          );
          ctx.stroke();
          // end curls
          ctx.beginPath();
          ctx.arc(-halfLen, 0, r * 0.14, Math.PI * 0.2, Math.PI * 1.8, true);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(halfLen, amp * 0.2, r * 0.14, Math.PI * 1.2, Math.PI * 2.8);
          ctx.stroke();
          break;
        }
        case "comma-trio": {
          // 3 small comma puffs in a row (cirrus-like)
          const spacing = r * 0.42;
          const puffR = r * 0.16;
          for (let k = -1; k <= 1; k++) {
            const cx = k * spacing;
            ctx.beginPath();
            ctx.arc(cx, 0, puffR, Math.PI * 0.2, Math.PI * 1.6);
            // little tail trailing off to the right
            ctx.quadraticCurveTo(
              cx + puffR * 1.6, puffR * 0.4,
              cx + puffR * 2.4, puffR * 0.1,
            );
            ctx.stroke();
          }
          break;
        }
        case "ring-spiral": {
          // closed ring with a curl breaking off
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.32, 0, Math.PI * 2);
          ctx.stroke();
          // curl breaking off the right side
          ctx.beginPath();
          ctx.moveTo(r * 0.32, 0);
          ctx.quadraticCurveTo(r * 0.70, -r * 0.10, r * 0.62, -r * 0.45);
          ctx.quadraticCurveTo(r * 0.55, -r * 0.70, r * 0.20, -r * 0.62);
          ctx.quadraticCurveTo(-r * 0.05, -r * 0.55, r * 0.05, -r * 0.30);
          ctx.stroke();
          break;
        }
        case "wind-streak": {
          // elongated horizontal swoosh with a curl on the right end
          const len = r * 1.6;
          const amp = r * 0.10;
          ctx.beginPath();
          ctx.moveTo(-len * 0.5, 0);
          ctx.bezierCurveTo(
            -len * 0.22, -amp,
             len * 0.05,  amp * 0.6,
             len * 0.32, -amp * 0.2,
          );
          ctx.stroke();
          // terminal curl
          ctx.beginPath();
          ctx.moveTo(len * 0.32, -amp * 0.2);
          ctx.quadraticCurveTo(
             len * 0.52, -amp * 0.4,
             len * 0.50, -amp * 1.8,
          );
          ctx.quadraticCurveTo(
             len * 0.46, -amp * 3.0,
             len * 0.30, -amp * 2.4,
          );
          ctx.quadraticCurveTo(
             len * 0.20, -amp * 1.8,
             len * 0.34, -amp * 1.2,
          );
          ctx.stroke();
          break;
        }
      }
      ctx.restore();
    };

    const colorWithAlpha = (color: string, alpha: number) => {
      const a = clamp(alpha, 0, 1).toFixed(3);
      const rgba = color.match(/^rgba\((\s*\d+\s*,\s*\d+\s*,\s*\d+)\s*,\s*[\d.]+\s*\)$/);
      if (rgba) return `rgba(${rgba[1]}, ${a})`;
      const rgb = color.match(/^rgb\((\s*\d+\s*,\s*\d+\s*,\s*\d+)\s*\)$/);
      if (rgb) return `rgba(${rgb[1]}, ${a})`;
      return color;
    };

    const drawCloudCluster = (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      s: number,
      fill: string,
      rim: string,
      alpha: number,
    ) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = "screen";
      const lobes = [
        [-76, 10, 78, 0.30, -0.08],
        [-46, -4, 96, 0.42, 0.05],
        [-8, -16, 116, 0.46, -0.02],
        [38, -8, 104, 0.40, 0.08],
        [82, 12, 82, 0.32, -0.06],
        [-16, 22, 132, 0.36, 0.00],
        [42, 30, 118, 0.30, 0.04],
      ];
      for (const [lx, ly, lr, sy, rot] of lobes) {
        ctx.save();
        ctx.translate(x + lx * s, y + ly * s);
        ctx.rotate(rot);
        ctx.scale(1, sy);
        const r = lr * s;
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
        g.addColorStop(0, colorWithAlpha(fill, 0.52));
        g.addColorStop(0.42, colorWithAlpha(fill, 0.22));
        g.addColorStop(0.74, colorWithAlpha(rim, 0.08));
        g.addColorStop(1, colorWithAlpha(fill, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      ctx.restore();
    };

    const drawNimbusMark = (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      strength: number,
      color: string,
    ) => {
      const s = 0.72 + strength * 0.45;
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      const dark = ctx.createRadialGradient(x, y, 0, x, y, 150 * s);
      dark.addColorStop(0, colorWithAlpha(color, 0.26 + strength * 0.20));
      dark.addColorStop(0.48, colorWithAlpha(color, 0.10 + strength * 0.08));
      dark.addColorStop(1, colorWithAlpha(color, 0));
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.ellipse(x, y, 132 * s, 54 * s, -0.04, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalCompositeOperation = "screen";
      const rim = ctx.createRadialGradient(x - 18 * s, y - 12 * s, 0, x - 18 * s, y - 12 * s, 112 * s);
      rim.addColorStop(0, "rgba(206, 231, 255, 0.18)");
      rim.addColorStop(0.56, "rgba(206, 231, 255, 0.06)");
      rim.addColorStop(1, "rgba(206, 231, 255, 0)");
      ctx.fillStyle = rim;
      ctx.beginPath();
      ctx.ellipse(x - 18 * s, y - 12 * s, 104 * s, 34 * s, 0.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    const drawSunShafts = (
      ctx: CanvasRenderingContext2D,
      w: number,
      h: number,
      phase: number,
      elapsed: number,
      isLight: boolean,
    ) => {
      const stormDip = phase > 0.56 && phase < 0.90 ? 0.34 : 1;
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const origin = (0.18 + Math.sin(phase * Math.PI * 2) * 0.18) * w;
      for (let i = 0; i < 5; i++) {
        const spread = 130 + i * 58;
        const x = origin + (i - 2.4) * spread + Math.sin(elapsed * 0.13 + i) * 18;
        const topWidth = 42 + i * 11;
        const lowerWidth = 210 + i * 46;
        const g = ctx.createLinearGradient(0, 58, 0, h);
        const alpha = (isLight ? 0.070 : 0.040) * stormDip * (0.78 + Math.sin(elapsed * 0.20 + i) * 0.22);
        g.addColorStop(0, `rgba(255, 239, 190, ${alpha.toFixed(3)})`);
        g.addColorStop(0.52, `rgba(166, 203, 224, ${(alpha * 0.26).toFixed(3)})`);
        g.addColorStop(1, "rgba(255, 239, 190, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x - topWidth, 58);
        ctx.lineTo(x + topWidth, 58);
        ctx.lineTo(x + lowerWidth, h);
        ctx.lineTo(x - lowerWidth * 0.62, h);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    };

    const drawWindStroke = (
      ctx: CanvasRenderingContext2D,
      stroke: WindStroke,
      now: number,
      isLight: boolean,
    ) => {
      if (stroke.points.length < 2) return;
      const fadeAge = stroke.releasedAt ? (now - stroke.releasedAt) / 1000 : 0;
      const fade = stroke.releasedAt ? Math.max(0, 1 - fadeAge / 2.4) : 1;
      if (fade <= 0) return;
      const alpha = fade * (0.12 + stroke.strength * 0.26);
      const outer = isLight
        ? `rgba(95, 125, 150, ${(alpha * 0.38).toFixed(3)})`
        : `rgba(190, 218, 250, ${(alpha * 0.46).toFixed(3)})`;
      const inner = stroke.hue > 0.55
        ? `rgba(233, 184, 112, ${(alpha * 0.45).toFixed(3)})`
        : `rgba(162, 214, 246, ${(alpha * 0.48).toFixed(3)})`;

      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalCompositeOperation = isLight ? "source-over" : "screen";
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass === 0 ? outer : inner;
        ctx.lineWidth = pass === 0 ? 11 + stroke.strength * 16 : 0.8 + stroke.strength * 1.9;
        ctx.beginPath();
        const pts = stroke.points;
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length - 1; i++) {
          const midX = (pts[i].x + pts[i + 1].x) * 0.5;
          const midY = (pts[i].y + pts[i + 1].y) * 0.5;
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
        }
        const last = pts[pts.length - 1];
        ctx.lineTo(last.x, last.y);
        ctx.stroke();
      }

      ctx.fillStyle = inner;
      for (let i = 2; i < stroke.points.length; i += 7) {
        const p = stroke.points[i];
        const r = 0.7 + Math.sin((now - stroke.t0) * 0.004 + i) * 0.25 + stroke.strength * 0.9;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };

    const drawRainVeil = (
      ctx: CanvasRenderingContext2D,
      veil: RainVeil,
      now: number,
      elapsed: number,
      isLight: boolean,
    ) => {
      const age = (now - veil.t0) / 1000;
      const fade = Math.max(0, 1 - age / 3.2);
      if (fade <= 0) return;
      ctx.save();
      ctx.globalAlpha = fade * (0.18 + veil.strength * 0.24);
      ctx.strokeStyle = isLight ? "rgba(77, 93, 112, 0.24)" : "rgba(176, 213, 255, 0.34)";
      ctx.lineWidth = 0.55 + veil.strength * 0.36;
      ctx.lineCap = "round";
      const drops = 44 + Math.round(veil.strength * 42);
      for (let i = 0; i < drops; i++) {
        const seeded = (Math.sin((i + 1) * 98.233 + veil.seed) * 43758.5453) % 1;
        const u = seeded < 0 ? seeded + 1 : seeded;
        const x = veil.x - veil.width * 0.5 + u * veil.width + Math.sin(elapsed * 1.8 + i) * 6;
        const y = veil.y + ((elapsed * (78 + veil.strength * 44) + i * 17 + veil.seed) % 170) - 52;
        const len = 14 + veil.strength * 26 + (i % 4) * 3;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + veil.slant, y + len);
        ctx.stroke();
      }
      ctx.restore();
    };

    const drawWeatherCell = (
      ctx: CanvasRenderingContext2D,
      cell: WeatherCell,
      now: number,
      elapsed: number,
      dt: number,
      w: number,
      h: number,
      isLight: boolean,
    ) => {
      const age = (now - cell.t0) / 1000;
      const life = cell.kind === "storm" ? 72 : 58;
      const fadeIn = Math.min(1, age / 1.2);
      const fadeOut = Math.max(0, 1 - Math.max(0, age - life * 0.72) / (life * 0.28));
      const alpha = fadeIn * fadeOut;
      if (alpha <= 0) return;

      if (!reduce) {
        cell.x += (cell.drift + windX * (cell.kind === "storm" ? 9 : 18)) * dt;
        cell.y -= cell.lift * dt;
        const margin = 180 * cell.spread;
        if (cell.x > w + margin) cell.x = -margin;
        if (cell.x < -margin) cell.x = w + margin;
        if (cell.y < 76) cell.y = h * (0.66 + Math.random() * 0.12);
      }

      const pulse = 1 + Math.sin(elapsed * (cell.kind === "storm" ? 0.7 : 1.05) + cell.phase) * 0.05;
      const s = cell.spread * (0.82 + cell.strength * 0.82) * pulse;
      const glowRadius = (cell.kind === "storm" ? 112 : 128) * s;
      const glow = ctx.createRadialGradient(cell.x, cell.y, 4, cell.x, cell.y, glowRadius);
      if (cell.kind === "storm") {
        glow.addColorStop(0, `rgba(60, 50, 80, ${(0.26 * alpha).toFixed(3)})`);
        glow.addColorStop(0.45, `rgba(95, 83, 122, ${(0.13 * alpha).toFixed(3)})`);
        glow.addColorStop(1, "rgba(60, 50, 80, 0)");
      } else {
        glow.addColorStop(0, `rgba(255, 254, 246, ${(0.24 * alpha).toFixed(3)})`);
        glow.addColorStop(0.56, `rgba(216, 196, 216, ${(0.10 * alpha).toFixed(3)})`);
        glow.addColorStop(1, "rgba(255, 254, 246, 0)");
      }

      ctx.save();
      ctx.globalCompositeOperation = cell.kind === "storm" ? "source-over" : "screen";
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.ellipse(cell.x, cell.y, glowRadius, glowRadius * 0.38, Math.sin(cell.phase) * 0.10, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const fill = cell.kind === "storm"
        ? isLight ? "rgba(38, 54, 66, 0.46)" : "rgba(14, 20, 34, 0.58)"
        : isLight ? "rgba(222, 242, 250, 0.42)" : "rgba(184, 207, 232, 0.28)";
      const rim = cell.kind === "storm"
        ? "rgba(4, 8, 18, 0.34)"
        : isLight ? "rgba(255, 236, 186, 0.16)" : "rgba(214, 231, 255, 0.16)";
      drawCloudCluster(ctx, cell.x, cell.y, s * (cell.kind === "storm" ? 0.42 : 0.58), fill, rim, alpha * (cell.kind === "storm" ? 0.42 : 0.42));

      if (cell.kind === "storm") {
        ctx.save();
        ctx.globalAlpha = alpha * (0.18 + cell.strength * 0.14);
        ctx.fillStyle = isLight ? "rgba(4, 11, 22, 0.42)" : "rgba(3, 7, 18, 0.52)";
        ctx.beginPath();
        ctx.ellipse(cell.x + 6 * s, cell.y + 22 * s, 42 * s, 13 * s, -0.03, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        if (cell.rain > 0.28) {
          drawRainVeil(
            ctx,
            {
              id: cell.id,
              x: cell.x,
              y: cell.y + 36 * s,
              t0: now - 700,
              strength: cell.rain * alpha,
              width: 150 * s,
              slant: -7 + windX * 20,
              seed: cell.phase * 100,
            },
            now,
            elapsed,
            isLight,
          );
        }
      }
    };

    // ── render loop ────────────────────────────────────────────────
    const t0 = performance.now();
    let raf = 0;
    let lastFrameMs = performance.now();
    // smoothed press strength so the cumulus dark-push doesn't snap
    let pressSmoothed = 0;

    const draw = (now: number) => {
      const w = overlay.clientWidth;
      const h = overlay.clientHeight;
      const elapsed = (now - t0) / 1000;
      const motionElapsed = reduce ? 0 : elapsed;
      elapsedRef.v = elapsed;
      const dt = Math.min(0.05, (now - lastFrameMs) / 1000);
      lastFrameMs = now;
      // 120s day cycle — frozen at 0.2 (midday-warm) when motion is reduced.
      // phaseOffsetRef is advanced by the sun/moon glyph click (0..1).
      const rawPhase = reduce ? 0.2 : (elapsed / 120) % 1;
      const phase = ((rawPhase + phaseOffsetRef.current) % 1 + 1) % 1;

      // mirror phase-bright -> DOM so banners can flip color
      // light phases: 0.00..0.55  /  dark phases: 0.55..0.95
      const isLight = phase < 0.55 || phase > 0.93;
      // setState is cheap — only call when it flips
      if (isLight !== phaseLight) setPhaseLight(isLight);
      if (isLight !== iconIsSun) setIconIsSun(isLight);

      // press intensity: 0..1 derived from how long the user has held
      const heldSec = pointer.current.pressed
        ? (now - pointer.current.pressStart) / 1000
        : 0;
      const pressTarget = pointer.current.pressed ? Math.min(1, heldSec / 1.4) : 0;
      pressSmoothed += (pressTarget - pressSmoothed) * 0.10;
      if (now - lastChargeSync > 120) {
        lastChargeSync = now;
        setPressCharge(pressSmoothed);
      }
      if (!pointer.current.pressed) {
        windTargetX *= 0.965;
        windTargetY *= 0.955;
      }
      windX += (windTargetX - windX) * 0.055;
      windY += (windTargetY - windY) * 0.050;

      // ── WebGL pass ──
      if (gl && glProg) {
        gl.useProgram(glProg);
        if (uTimeLoc) gl.uniform1f(uTimeLoc, elapsed);
        if (uResLoc) gl.uniform2f(uResLoc, sky.width, sky.height);
        if (uPhaseLoc) gl.uniform1f(uPhaseLoc, phase);
        if (uCursorLoc) {
          gl.uniform2f(
            uCursorLoc,
            pointer.current.over ? pointer.current.uvx : -1,
            pointer.current.over ? pointer.current.uvy : -1,
          );
        }
        if (uPressLoc) gl.uniform1f(uPressLoc, pressSmoothed);
        if (uWindLoc) gl.uniform2f(uWindLoc, windX, windY);
        // pick the most recent active lightning for flash
        let flash = 0;
        for (const l of lightnings.current) {
          const age = (now - l.t0) / 1000;
          if (age < 0.36) {
            // sharp attack, exponential decay
            const envelope = age < 0.04 ? age / 0.04 : Math.exp(-(age - 0.04) * 9);
            flash = Math.max(flash, envelope);
          }
        }
        if (uFlashLoc) gl.uniform1f(uFlashLoc, flash);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } else {
        // Fallback: paint a flat sky color so the page isn't blank.
        const sctx = sky.getContext("2d");
        if (sctx) {
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          sctx.fillStyle = "#d8c4d8";
          sctx.fillRect(0, 0, w, h);
        }
      }

      // ── 2D overlay pass ──
      octx.clearRect(0, 0, w, h);

      const stormFade = phase > 0.55 && phase < 0.93 ? 0.55 : 1;
      const cloudFill = isLight ? "rgba(221, 242, 250, 0.34)" : "rgba(172, 198, 226, 0.22)";
      const cloudRim = isLight ? "rgba(255, 221, 164, 0.12)" : "rgba(190, 214, 255, 0.12)";
      drawSunShafts(octx, w, h, phase, motionElapsed, isLight);
      for (const c of cloudClusters) {
        const margin = 240 * c.scale;
        const driftX = reduce ? 0 : ((elapsed * c.drift + c.xFrac * w) % (w + margin * 2)) - margin;
        const x = reduce ? c.xFrac * w : driftX;
        const y = c.yFrac * h + Math.sin(elapsed * 0.18 + c.phase) * 8;
        drawCloudCluster(octx, x, y, c.scale, cloudFill, cloudRim, 0.14 * stormFade);
      }

      for (let i = weatherCells.length - 1; i >= 0; i--) {
        const cell = weatherCells[i];
        const age = (now - cell.t0) / 1000;
        const life = cell.kind === "storm" ? 72 : 58;
        if (age > life) {
          weatherCells.splice(i, 1);
          continue;
        }
        drawWeatherCell(octx, cell, now, motionElapsed, dt, w, h, isLight);
      }

      for (let i = rainVeils.length - 1; i >= 0; i--) {
        const veil = rainVeils[i];
        const age = (now - veil.t0) / 1000;
        if (age > 3.2) {
          rainVeils.splice(i, 1);
          continue;
        }
        drawRainVeil(octx, veil, now, motionElapsed, isLight);
      }

      for (let i = windStrokes.length - 1; i >= 0; i--) {
        const stroke = windStrokes[i];
        if (stroke.releasedAt && (now - stroke.releasedAt) / 1000 > 2.4) {
          windStrokes.splice(i, 1);
          continue;
        }
        drawWindStroke(octx, stroke, now, isLight);
      }

      const crystalColor = isLight ? "rgba(237, 249, 255, 0.42)" : "rgba(184, 219, 255, 0.34)";
      octx.save();
      octx.globalCompositeOperation = "screen";
      octx.strokeStyle = crystalColor;
      octx.lineWidth = 0.8;
      octx.lineCap = "round";
      for (const c of iceCrystals) {
        const x = c.xFrac * w + Math.sin(elapsed * 0.05 + c.phase) * 18;
        const y = c.yFrac * h + Math.cos(elapsed * 0.07 + c.phase) * 5;
        const r = c.size * (1 + Math.sin(elapsed * 0.8 + c.phase) * 0.12);
        const rot = elapsed * c.spin + c.phase;
        octx.save();
        octx.translate(x, y);
        octx.rotate(rot);
        octx.globalAlpha = 0.12 + Math.max(0, Math.sin(elapsed * 0.9 + c.phase)) * 0.22;
        octx.beginPath();
        octx.moveTo(-r, 0); octx.lineTo(r, 0);
        octx.moveTo(0, -r); octx.lineTo(0, r);
        octx.stroke();
        octx.fillStyle = crystalColor;
        octx.beginPath();
        octx.arc(0, 0, Math.max(0.45, r * 0.18), 0, Math.PI * 2);
        octx.fill();
        octx.restore();
      }
      octx.restore();

      // drifting Minoan wind glyphs — a chorus across altitudes
      const glyphColor = isLight ? "rgba(17, 29, 42, 0.32)" : "rgba(202, 225, 255, 0.38)";
      // fainter during storm phase
      for (const g of glyphs) {
        if (!reduce) {
          // drift
          g.x += g.vx * dt;
          // wrap with margin so wide glyphs don't pop in/out
          const margin = g.size * 2 + 8;
          if (g.x > w + margin) g.x = -margin;
          else if (g.x < -margin) g.x = w + margin;
          // rotate (per-frame, dt-normalized to feel right at any framerate)
          // hovered glyphs spin 2× faster (subtle but noticeable)
          const spinMul = g.hovered ? 2 : 1;
          g.rotation += g.rotSpeed * (dt * 60) * spinMul;
        }
        const y = reduce
          ? g.baseY
          : g.baseY + Math.sin(elapsed * g.bobFreq * Math.PI * 2 + g.phase) * g.bobAmp;

        // draw breadcrumb trail BEFORE the glyph so trail sits under it
        if (g.trail.length > 0) {
          for (let ti = g.trail.length - 1; ti >= 0; ti--) {
            const dot = g.trail[ti];
            const age = (now - dot.t0) / 1000;
            if (age > 0.9) { g.trail.splice(ti, 1); continue; }
            const a = Math.max(0, 1 - age / 0.9) * 0.55 * stormFade;
            octx.fillStyle = glyphColor.replace(/[\d.]+\)$/, `${a.toFixed(3)})`);
            octx.beginPath();
            octx.arc(dot.x, dot.y, 1.6, 0, Math.PI * 2);
            octx.fill();
          }
        }

        // temporarily stash the instance opacity so drawGlyph can fade by storm
        const baseOp = g.opacity;
        const titleClear = Math.abs(g.x - w * 0.5) < 250 && y < 170 ? 0.22 : 1;
        g.opacity = baseOp * stormFade * titleClear;
        if (!reduce && g.hovered) {
          // scale 1.15× around (x, y) for the duration of this call
          octx.save();
          octx.translate(g.x, y);
          octx.scale(1.15, 1.15);
          octx.translate(-g.x, -y);
          drawGlyph(octx, g, y, glyphColor);
          octx.restore();
        } else {
          drawGlyph(octx, g, y, glyphColor);
        }
        g.opacity = baseOp;
      }

      if (pointer.current.pressed && pointer.current.over) {
        drawNimbusMark(
          octx,
          pointer.current.x,
          pointer.current.y,
          pressSmoothed,
          isLight ? "rgba(93, 82, 112, 0.88)" : "rgba(38, 34, 54, 0.92)",
        );
      }

      // cloud puffs (cloud-body taps) — soft expanding rings
      if (cloudPuffs.length > 0) {
        for (let i = cloudPuffs.length - 1; i >= 0; i--) {
          const p = cloudPuffs[i];
          const age = (now - p.t0) / 1000;
          if (age > 1.2) { cloudPuffs.splice(i, 1); continue; }
          const t01 = age / 1.2;
          const r = 24 + Math.sin(t01 * Math.PI) * 90;
          const a = Math.max(0, 1 - t01) * (isLight ? 0.22 : 0.16);
          octx.save();
          octx.globalCompositeOperation = "screen";
          const bloom = octx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          bloom.addColorStop(0, `rgba(220, 244, 255, ${(a * 0.65).toFixed(3)})`);
          bloom.addColorStop(0.45, `rgba(255, 223, 176, ${(a * 0.24).toFixed(3)})`);
          bloom.addColorStop(1, "rgba(220, 244, 255, 0)");
          octx.fillStyle = bloom;
          octx.beginPath();
          octx.ellipse(p.x, p.y, r, r * 0.32, Math.sin(age * 2) * 0.08, 0, Math.PI * 2);
          octx.fill();
          octx.restore();
        }
      }

      // lightning bolts
      for (let i = lightnings.current.length - 1; i >= 0; i--) {
        const l = lightnings.current[i];
        const age = (now - l.t0) / 1000;
        if (age > 0.6) {
          lightnings.current.splice(i, 1);
          continue;
        }
        // alpha envelope: hot for ~120ms, fades by 600ms
        const alpha = Math.max(0, 1 - age / 0.6) * (age < 0.12 ? 1 : 0.7);
        // outer glow
        octx.save();
        octx.globalAlpha = alpha * 0.34;
        octx.strokeStyle = "rgba(160, 209, 255, 1)";
        octx.lineWidth = 10;
        octx.lineCap = "round";
        octx.lineJoin = "round";
        octx.beginPath();
        for (let j = 0; j < l.segs.length; j++) {
          const p = l.segs[j];
          if (j === 0) octx.moveTo(p.x, p.y);
          else octx.lineTo(p.x, p.y);
        }
        octx.stroke();
        // core
        octx.globalAlpha = alpha;
        octx.strokeStyle = "rgba(226, 243, 255, 1)";
        octx.lineWidth = 1.45;
        octx.beginPath();
        for (let j = 0; j < l.segs.length; j++) {
          const p = l.segs[j];
          if (j === 0) octx.moveTo(p.x, p.y);
          else octx.lineTo(p.x, p.y);
        }
        octx.stroke();
        octx.restore();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      overlay.removeEventListener("pointerdown", onDown);
      overlay.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      overlay.removeEventListener("pointerleave", onLeave);
    };
    // We intentionally keep this effect dependency-free — the loop reads live
    // refs and only the banner color depends on phaseLight, which is set from
    // inside the loop via the React closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Frame color flips between dark-on-light and cream-on-dark depending on
  // whether the sky is in a bright or stormy phase, so the meander always
  // has enough contrast against the day cycle's underlying gradient.
  const frameColor = phaseLight ? "rgba(21, 23, 26, 0.30)" : "rgba(244, 238, 222, 0.58)";
  const titleColor = phaseLight ? "rgba(21, 23, 26, 0.70)" : "rgba(244, 238, 222, 0.84)";
  const labelColor = phaseLight ? "rgba(21, 23, 26, 0.40)" : "rgba(244, 238, 222, 0.50)";

  return (
    <div
      ref={wrapRef}
      className="clouds-root"
      aria-label="olympus — living weather instrument"
      data-touch-surface="true"
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        background: "var(--paper)",
      }}
    >
      <canvas
        ref={skyRef}
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
      />
      <canvas
        ref={overlayRef}
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

      {/* Classical Hellenic window border — a Greek key meander on all four
          sides framing the sky. The shared header stays available, but is
          made transparent by the route styles below so it does not read as a
          slab over the atmosphere. */}
      <GreekKeyFrame
        top={56}
        bottom={0}
        thickness={18}
        mobileThickness={12}
        strokeThickness={1.4}
        color={frameColor}
        opacity={1}
        zIndex={20}
      />

      {/* OLYMPUS title + subtitle */}
      <div
        className="cloud-title"
        style={{
          position: "absolute",
          top: 84,
          left: 0,
          right: 0,
          textAlign: "center",
          pointerEvents: "none",
          zIndex: 3,
        }}
      >
        <WaterText
          as="h1"
          bobAmp={0}
          style={{
            display: "block",
            margin: 0,
            fontFamily: "var(--font-numerals)",
            fontWeight: 500,
            fontSize: 28,
            letterSpacing: "0.32em",
            color: titleColor,
            textTransform: "uppercase",
          }}
        >
          Olympus
        </WaterText>
        <WaterText
          as="div"
          bobAmp={2}
          style={{
            display: "block",
            marginTop: 6,
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 15,
            color: titleColor,
            opacity: 0.78,
            letterSpacing: "0.02em",
          }}
        >
          living weather
        </WaterText>
      </div>

      {/* Cloud-type labels — right edge, faint mono lowercase. Tappable for
          brief descriptions. */}
      <div
        className="cloud-labels"
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          right: 24,
          width: 80,
          pointerEvents: "none",
          zIndex: 3,
          fontFamily: "var(--font-text)",
          fontSize: 11,
          letterSpacing: "0.10em",
          textTransform: "lowercase",
          color: labelColor,
        }}
      >
        {CLOUD_TYPES.map((ct) => (
          <button
            key={ct.name}
            type="button"
            onClick={() => {
              setLabelTip({ name: ct.name, text: ct.text, top: ct.top });
              try { getFieldAudio().chime(); } catch { /* noop */ }
              haptics.tap();
              useField.getState().recordTape("object", 0.25, `clouds/${ct.name}`);
              addWeatherMark(ct.name, 0.32);
              // auto-clear in 4s; the rAF loop is independent so a window
              // timeout is fine here.
              window.setTimeout(() => {
                setLabelTip((cur) => (cur && cur.name === ct.name ? null : cur));
              }, 4000);
            }}
            style={{
              position: "absolute",
              top: ct.top,
              right: 0,
              pointerEvents: "auto",
              background: "transparent",
              border: "none",
              color: "inherit",
              font: "inherit",
              letterSpacing: "inherit",
              textTransform: "inherit",
              cursor: "pointer",
              padding: "6px 4px", // ≥ touch target
              minHeight: 20,
            }}
            aria-label={`${ct.name} — show description`}
            className="cloud-label-button"
          >
            {ct.name}
          </button>
        ))}
      </div>

      {/* label tip — fades in for ~4s near the tapped label */}
      {labelTip && (
        <div
          className="cloud-label-tip"
          style={{
            position: "absolute",
            top: `calc(${labelTip.top} + 22px)`,
            right: 24,
            maxWidth: 260,
            padding: "8px 10px",
            background: phaseLight
              ? "rgba(244, 238, 222, 0.88)"
              : "rgba(20, 22, 30, 0.85)",
            color: phaseLight ? "rgba(21, 23, 26, 0.92)" : "rgba(244, 238, 222, 0.95)",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 13,
            lineHeight: 1.4,
            letterSpacing: "0.01em",
            pointerEvents: "none",
            zIndex: 4,
            animation: "clouds-fadeIn 240ms ease-out",
          }}
        >
          {labelTip.text}
        </div>
      )}

      {/* Sun / moon glyph — top right corner, clickable to advance day-cycle.
          A hidden affordance — small but reachable. */}
      <button
        className="cloud-day-toggle"
        type="button"
        onClick={() => {
          phaseOffsetRef.current = (phaseOffsetRef.current + 0.25) % 1;
          try { getFieldAudio().bell(); } catch { /* noop */ }
          haptics.roll();
          useField.getState().recordTape("region", 0.45, "clouds/day-cycle");
          addWeatherMark(iconIsSun ? "moonward" : "sunward", 0.58);
        }}
        aria-label="advance day cycle"
        style={{
          position: "absolute",
          top: 88,
          right: 24,
          width: 28,
          height: 28,
          padding: 0,
          background: "transparent",
          border: "none",
          color: phaseLight ? "rgba(21, 23, 26, 0.55)" : "rgba(244, 238, 222, 0.75)",
          cursor: "pointer",
          pointerEvents: "auto",
          zIndex: 4,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {iconIsSun ? (
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="10" cy="10" r="3.6" fill="currentColor" />
            {Array.from({ length: 8 }).map((_, i) => {
              const a = (i / 8) * Math.PI * 2;
              const x1 = 10 + Math.cos(a) * 5.4;
              const y1 = 10 + Math.sin(a) * 5.4;
              const x2 = 10 + Math.cos(a) * 8.2;
              const y2 = 10 + Math.sin(a) * 8.2;
              return (
                <line
                  key={i}
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke="currentColor" strokeWidth={1.2} strokeLinecap="round"
                />
              );
            })}
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <path
              d="M14.4 12.4 A6.2 6.2 0 1 1 10 4 a4.4 4.4 0 0 0 4.4 8.4z"
              fill="currentColor"
            />
          </svg>
        )}
      </button>

      <div
        className="cloud-weather-ribbon"
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 132,
          left: 24,
          display: "flex",
          alignItems: "center",
          gap: 8,
          zIndex: 4,
          pointerEvents: "none",
          color: titleColor,
          fontFamily: "var(--font-text)",
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "lowercase",
        }}
      >
        <span
          style={{
            width: 54,
            height: 6,
            borderRadius: 999,
            border: `1px solid ${phaseLight ? "rgba(21,23,26,0.34)" : "rgba(244,238,222,0.38)"}`,
            overflow: "hidden",
            background: phaseLight ? "rgba(21,23,26,0.08)" : "rgba(244,238,222,0.10)",
            display: "inline-flex",
          }}
        >
          <span
            style={{
              width: `${Math.max(8, Math.round(pressCharge * 100))}%`,
              background: phaseLight ? "rgba(90,77,106,0.66)" : "rgba(216,196,216,0.80)",
              transition: "width 120ms ease-out",
            }}
          />
        </span>
        {weatherMarks.map((mark) => (
          <span
            key={mark.id}
            style={{
              opacity: 0.46 + mark.level * 0.44,
              borderBottom: `1px solid ${phaseLight ? "rgba(21,23,26,0.26)" : "rgba(244,238,222,0.28)"}`,
            }}
          >
            {mark.label}
          </span>
        ))}
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html:
            `
            @keyframes clouds-fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
            body:has(.clouds-root) header:not(.oda-site-header) {
              background: transparent !important;
              border-bottom: 0 !important;
              backdrop-filter: none !important;
              -webkit-backdrop-filter: none !important;
            }
            body:has(.clouds-root) .oda-field-watch,
            body:has(.clouds-root) .oda-candle-mark,
            body:has(.clouds-root) .oda-tape-shell,
            body:has(.clouds-root) .oda-sound-toggle {
              display: none !important;
            }
            @media (max-width: 700px) {
              .cloud-title {
                top: 78px !important;
              }
              .cloud-title h1 {
                font-size: 25px !important;
                letter-spacing: 0.24em !important;
              }
              .cloud-day-toggle {
                top: 84px !important;
                right: 16px !important;
                width: 44px !important;
                height: 44px !important;
              }
              .cloud-labels {
                top: auto !important;
                left: 12px !important;
                right: 12px !important;
                bottom: calc(58px + env(safe-area-inset-bottom, 0px)) !important;
                width: auto !important;
                height: 42px !important;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 3px;
                font-size: 10px !important;
                pointer-events: auto !important;
              }
              .cloud-label-button {
                position: static !important;
                min-height: 36px !important;
                padding: 4px 6px !important;
                flex: 0 1 auto;
              }
              .cloud-label-tip {
                top: auto !important;
                left: 16px !important;
                right: 16px !important;
                bottom: calc(108px + env(safe-area-inset-bottom, 0px)) !important;
                max-width: none !important;
                text-align: center;
              }
              .cloud-weather-ribbon {
                top: 154px !important;
                left: 16px !important;
                right: 16px !important;
                max-width: calc(100vw - 32px);
                flex-wrap: wrap;
                gap: 6px 8px !important;
                font-size: 10px !important;
              }
            }
            `,
        }}
      />
    </div>
  );
}

// Cloud-type label data — top-position keyed to the same fractions used by
// the original span layout, plus a brief description shown on tap.
const CLOUD_TYPES = [
  { name: "cirrus", top: "16%",
    text: "cirrus — ice crystals at altitude, drawn into wisps by the wind." },
  { name: "altostratus", top: "34%",
    text: "altostratus — a uniform mid-level sheet that veils the sun." },
  { name: "cumulus", top: "52%",
    text: "cumulus — heaped, cauliflower clouds of fair-weather convection." },
  { name: "nimbus", top: "70%",
    text: "nimbus — dense and dark, the bearer of rain." },
];
