"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { useField } from "@/store/field";
import WaterText from "@/components/WaterText";

/**
 * /fire — the element treated as a wave.
 *
 * Multiple distinct flame "sources" arrayed across a hearth — each with its
 * own color, size, and breath. Three layered surfaces:
 *
 *   1. WebGL full-viewport fragment shader — paints up to 8 flame sources
 *      against a dark hearth. Each source contributes a vertical column
 *      shaped by 5-octave FBM, with its own color tint and intensity. The
 *      cursor lifts heat locally; tapping spikes the nearest source; wind
 *      shears columns horizontally.
 *   2. 2D overlay canvas — pooled embers (≤ 280) + pooled sparks (≤ 240)
 *      + dark smoke wisps rising from each source.
 *   3. DOM controls — wind dial + color-shifter button.
 *
 * Interactions:
 *   - Tap a flame → it grows tall + bright for 4s, spawns 30 sparks +
 *     blaze + audio.thud().
 *   - Click upper area away from any flame → ember cluster + spark sound.
 *   - Drag a flame horizontally → relocate it across the hearth.
 *   - Drag horizontally on empty hearth → wind blows that direction;
 *     drag faster → stronger wind, longer decay.
 *   - Color-shifter (top-right) → cycle all flames through the palette.
 *   - Wind dial (bottom-right) → manual override.
 *
 * Constraints: single shader pass with a small uniform array of sources;
 * particle pools fixed-size; 60fps target. Honors prefers-reduced-motion.
 */

// Flame palette — each entry is one "color" you can shift to.
// rgb each 0..1 for the shader; emberR/G/B are 0..255 for the 2D fx layer.
const FLAME_PALETTE: Array<{
  id: string;
  name: string;
  base: [number, number, number];
  mid: [number, number, number];
  tip: [number, number, number];
  core: [number, number, number];
  emberR: number; emberG: number; emberB: number;
}> = [
  {
    id: "classic", name: "classic",
    base: [0.478, 0.125, 0.063],
    mid:  [0.910, 0.353, 0.094],
    tip:  [1.000, 0.808, 0.290],
    core: [1.000, 0.965, 0.863],
    emberR: 255, emberG: 165, emberB: 50,
  },
  {
    id: "blue", name: "hot gas",
    base: [0.04, 0.10, 0.28],
    mid:  [0.12, 0.46, 0.92],
    tip:  [0.55, 0.82, 1.00],
    core: [0.92, 0.98, 1.00],
    emberR: 120, emberG: 180, emberB: 255,
  },
  {
    id: "green", name: "copper",
    base: [0.04, 0.20, 0.06],
    mid:  [0.18, 0.78, 0.32],
    tip:  [0.62, 1.00, 0.58],
    core: [0.94, 1.00, 0.92],
    emberR: 140, emberG: 255, emberB: 110,
  },
  {
    id: "purple", name: "potassium",
    base: [0.18, 0.04, 0.32],
    mid:  [0.62, 0.20, 0.92],
    tip:  [0.86, 0.62, 1.00],
    core: [0.98, 0.94, 1.00],
    emberR: 200, emberG: 130, emberB: 255,
  },
  {
    id: "white", name: "magnesium",
    base: [0.34, 0.34, 0.38],
    mid:  [0.82, 0.82, 0.88],
    tip:  [0.98, 0.98, 1.00],
    core: [1.00, 1.00, 1.00],
    emberR: 240, emberG: 240, emberB: 255,
  },
];

const MAX_FLAMES = 8;

// One flame source — controlled in JS, fed to shader as a uniform array.
type FlameSource = {
  // logical position 0..1 across the hearth
  x: number;
  // base width and height multipliers (relative)
  width: number;     // 0.6..1.4
  height: number;    // 0.5..1.6
  paletteIdx: number;
  // tap-grow envelope: amplitude (0..1) and start time (ms)
  growAmp: number;
  growT0: number;
  // breath phase offset so flames "breathe" out of sync
  breathPhase: number;
  // particle accumulators (per source)
  sparkAcc: number;
  smokeAcc: number;
};

export default function Fire() {
  // page-specific ambient bed: bandpass-filtered crackle
  useEffect(() => { getFieldAudio().setAmbientProfile("fire"); }, []);

  const wrapRef = useRef<HTMLDivElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const fxCanvasRef = useRef<HTMLCanvasElement>(null);

  // Live state read by the render loop. Refs not state so GL isn't torn down.
  const cursorRef = useRef<{ x: number; y: number; over: boolean }>({
    x: 0.5, y: 1.2, over: false,
  });
  const blazeRef = useRef<{ amp: number; t0: number }>({ amp: 0, t0: 0 });
  const windRef = useRef<{ target: number; current: number }>({
    target: 0, current: 0,
  });
  const windDialRef = useRef<number>(0);

  // Initial flame sources — 7 spread across the hearth at varied scales/colors.
  const flamesRef = useRef<FlameSource[]>([
    { x: 0.10, width: 0.85, height: 0.95, paletteIdx: 0, growAmp: 0, growT0: 0, breathPhase: 0.0, sparkAcc: 0, smokeAcc: 0 },
    { x: 0.24, width: 1.05, height: 1.20, paletteIdx: 1, growAmp: 0, growT0: 0, breathPhase: 1.3, sparkAcc: 0, smokeAcc: 0 },
    { x: 0.39, width: 0.75, height: 0.85, paletteIdx: 2, growAmp: 0, growT0: 0, breathPhase: 2.5, sparkAcc: 0, smokeAcc: 0 },
    { x: 0.52, width: 1.20, height: 1.40, paletteIdx: 0, growAmp: 0, growT0: 0, breathPhase: 0.7, sparkAcc: 0, smokeAcc: 0 },
    { x: 0.66, width: 0.90, height: 1.00, paletteIdx: 3, growAmp: 0, growT0: 0, breathPhase: 3.1, sparkAcc: 0, smokeAcc: 0 },
    { x: 0.80, width: 0.70, height: 0.80, paletteIdx: 4, growAmp: 0, growT0: 0, breathPhase: 1.8, sparkAcc: 0, smokeAcc: 0 },
    { x: 0.92, width: 0.80, height: 0.90, paletteIdx: 0, growAmp: 0, growT0: 0, breathPhase: 2.2, sparkAcc: 0, smokeAcc: 0 },
  ]);

  const [windDisplay, setWindDisplay] = useState(0);
  // Forces a re-render of the small flame swatches (color shifter UI).
  const [paletteTick, setPaletteTick] = useState(0);
  const [fireMarks, setFireMarks] = useState<Array<{ label: string; tone: string; t: number }>>([
    { label: "banked", tone: "#e85a18", t: 0 },
  ]);
  const markFire = useCallback((label: string, tone = "#e85a18") => {
    setFireMarks((prev) => [{ label, tone, t: performance.now() }, ...prev].slice(0, 5));
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    const glCanvas = glCanvasRef.current;
    const fxCanvas = fxCanvasRef.current;
    if (!wrap || !glCanvas || !fxCanvas) return;
    const ectx = fxCanvas.getContext("2d");
    if (!ectx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const motion = reduce ? 0 : 1;

    const audio = getFieldAudio();
    void audio.start();

    // ── WebGL setup ─────────────────────────────────────────────────
    const gl =
      (glCanvas.getContext("webgl", {
        antialias: false,
        premultipliedAlpha: false,
      }) ||
        glCanvas.getContext(
          "experimental-webgl" as "webgl",
          { antialias: false, premultipliedAlpha: false } as WebGLContextAttributes,
        )) as WebGLRenderingContext | null;

    let glProg: WebGLProgram | null = null;
    let uTimeLoc: WebGLUniformLocation | null = null;
    let uResLoc: WebGLUniformLocation | null = null;
    let uCursorLoc: WebGLUniformLocation | null = null;
    let uCursorActiveLoc: WebGLUniformLocation | null = null;
    let uBlazeLoc: WebGLUniformLocation | null = null;
    let uWindLoc: WebGLUniformLocation | null = null;
    let uCountLoc: WebGLUniformLocation | null = null;
    let uPosLoc: WebGLUniformLocation | null = null;
    let uShapeLoc: WebGLUniformLocation | null = null;
    const uColorLocs: Array<{
      base: WebGLUniformLocation | null;
      mid: WebGLUniformLocation | null;
      tip: WebGLUniformLocation | null;
      core: WebGLUniformLocation | null;
    }> = [];

    if (gl) {
      const vert = `
        attribute vec2 a_pos;
        varying vec2 vUv;
        void main() {
          vUv = a_pos * 0.5 + 0.5;
          gl_Position = vec4(a_pos, 0.0, 1.0);
        }
      `;
      // Multi-flame field. For each fragment we iterate over the active
      // sources (uCount) and pick the highest-heat contributor, tinting the
      // pixel with that source's palette.
      const frag = `
        precision highp float;
        #define MAXF ${MAX_FLAMES}
        uniform float uTime;
        uniform vec2  uRes;
        uniform vec2  uCursor;
        uniform float uCursorActive;
        uniform float uBlaze;
        uniform float uWind;
        uniform int   uCount;
        // packed sources:
        //   uPos[i]   = (x, _unused_)
        //   uShape[i] = (width, height, growAmp, breathPhase)
        uniform vec2  uPos[MAXF];
        uniform vec4  uShape[MAXF];
        uniform vec3  uBase0; uniform vec3 uMid0; uniform vec3 uTip0; uniform vec3 uCore0;
        uniform vec3  uBase1; uniform vec3 uMid1; uniform vec3 uTip1; uniform vec3 uCore1;
        uniform vec3  uBase2; uniform vec3 uMid2; uniform vec3 uTip2; uniform vec3 uCore2;
        uniform vec3  uBase3; uniform vec3 uMid3; uniform vec3 uTip3; uniform vec3 uCore3;
        uniform vec3  uBase4; uniform vec3 uMid4; uniform vec3 uTip4; uniform vec3 uCore4;
        uniform vec3  uBase5; uniform vec3 uMid5; uniform vec3 uTip5; uniform vec3 uCore5;
        uniform vec3  uBase6; uniform vec3 uMid6; uniform vec3 uTip6; uniform vec3 uCore6;
        uniform vec3  uBase7; uniform vec3 uMid7; uniform vec3 uTip7; uniform vec3 uCore7;
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

        void colorFor(int idx, out vec3 cBase, out vec3 cMid, out vec3 cTip, out vec3 cCore) {
          if (idx == 0)      { cBase = uBase0; cMid = uMid0; cTip = uTip0; cCore = uCore0; }
          else if (idx == 1) { cBase = uBase1; cMid = uMid1; cTip = uTip1; cCore = uCore1; }
          else if (idx == 2) { cBase = uBase2; cMid = uMid2; cTip = uTip2; cCore = uCore2; }
          else if (idx == 3) { cBase = uBase3; cMid = uMid3; cTip = uTip3; cCore = uCore3; }
          else if (idx == 4) { cBase = uBase4; cMid = uMid4; cTip = uTip4; cCore = uCore4; }
          else if (idx == 5) { cBase = uBase5; cMid = uMid5; cTip = uTip5; cCore = uCore5; }
          else if (idx == 6) { cBase = uBase6; cMid = uMid6; cTip = uTip6; cCore = uCore6; }
          else               { cBase = uBase7; cMid = uMid7; cTip = uTip7; cCore = uCore7; }
        }

        void main() {
          vec2 uv = vec2(vUv.x, 1.0 - vUv.y); // y=0 top, y=1 bottom
          float t = uTime;
          float aspect = uRes.x / max(uRes.y, 1.0);

          // background hearth gradient
          vec3 bgTop    = vec3(0.045, 0.020, 0.020);
          vec3 bgBottom = vec3(0.140, 0.055, 0.022);
          vec3 bg = mix(bgTop, bgBottom, smoothstep(0.0, 1.0, uv.y));

          float bestHeat = 0.0;
          float bestRaw  = 0.0;
          int   bestIdx  = 0;

          float windShear = uWind * (1.0 - uv.y) * 0.35;

          for (int i = 0; i < MAXF; i++) {
            if (i >= uCount) break;
            vec2 pos   = uPos[i];
            vec4 shape = uShape[i];
            float fx = pos.x;
            float fwidth  = shape.x;
            float fheight = shape.y;
            float fgrow   = shape.z;
            float fbreath = shape.w;

            float breath = sin(t * 2.094 + fbreath) * 0.10;
            float heightMul = fheight * (1.0 + breath + fgrow * 0.55);
            float widthMul  = fwidth  * (1.0 + breath * 0.3 + fgrow * 0.18);

            vec2 warpP = vec2(uv.x * 2.0, uv.y * 3.0 - t * 0.35 + float(i) * 7.13);
            float warpN = fbm(warpP);
            float warpX = (warpN - 0.5) * 0.12;
            float dx = (uv.x - fx) + warpX + windShear;

            float widthAtY = mix(0.06, 0.13, uv.y) * widthMul;
            float horiz = 1.0 - smoothstep(0.0, widthAtY, abs(dx));

            float topY = 1.0 + (heightMul - 1.0) * 0.55;
            float vert = smoothstep(0.0, 0.85 * heightMul, uv.y);
            vert *= smoothstep(topY + 0.1, topY - 0.2, uv.y);

            float yLift = 0.0;
            if (uCursorActive > 0.5) {
              float colDist = abs(uCursor.x - fx);
              float colMask = exp(-colDist * 16.0);
              float dxC = (uv.x - uCursor.x);
              float dyC = (uv.y - uCursor.y);
              float distC = length(vec2(dxC * 1.6, dyC));
              yLift = exp(-distC * 6.0) * 0.40 * colMask;
            }

            vec2 fp = vec2((uv.x - fx) * (5.0 * aspect / max(widthMul, 0.001)),
                           uv.y * (4.0 / max(heightMul, 0.001)) + t * 1.8 + float(i) * 3.7);
            float n = fbm(fp);
            float n2 = fbm(fp * 1.8 + vec2(11.3, -t * 0.9));
            float heatRaw = (n * 0.72 + n2 * 0.28);

            float heat = heatRaw * horiz * vert + yLift * heatRaw * 0.5;
            heat *= (1.0 + uBlaze * 1.5);
            heat = pow(clamp(heat, 0.0, 1.0), 0.85);
            heat = smoothstep(0.15, 0.95, heat);

            if (heat > bestHeat) {
              bestHeat = heat;
              bestRaw  = heatRaw * horiz * vert;
              bestIdx  = i;
            }
          }

          vec3 cBase, cMid, cTip, cCore;
          colorFor(bestIdx, cBase, cMid, cTip, cCore);

          vec3 color = mix(cBase, cMid, smoothstep(0.10, 0.45, bestHeat));
          color = mix(color, cTip, smoothstep(0.45, 0.75, bestHeat));
          color = mix(color, cCore, smoothstep(0.80, 0.99, bestHeat));

          float bodyMask = smoothstep(0.05, 0.45, bestHeat);
          vec3 outColor = mix(bg, color, bodyMask);

          float halo = smoothstep(0.0, 0.5, bestRaw);
          outColor += halo * cMid * 0.18;

          vec2 vc = vUv - 0.5;
          float vig = smoothstep(0.85, 0.35, length(vc));
          outColor *= mix(0.86, 1.0, vig);

          gl_FragColor = vec4(outColor, 1.0);
        }
      `;

      const compile = (type: number, src: string) => {
        const s = gl.createShader(type);
        if (!s) return null;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          console.warn("fire shader compile failed", gl.getShaderInfoLog(s));
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
            uCursorLoc = gl.getUniformLocation(p, "uCursor");
            uCursorActiveLoc = gl.getUniformLocation(p, "uCursorActive");
            uBlazeLoc = gl.getUniformLocation(p, "uBlaze");
            uWindLoc = gl.getUniformLocation(p, "uWind");
            uCountLoc = gl.getUniformLocation(p, "uCount");
            uPosLoc = gl.getUniformLocation(p, "uPos");
            uShapeLoc = gl.getUniformLocation(p, "uShape");
            for (let i = 0; i < MAX_FLAMES; i++) {
              uColorLocs.push({
                base: gl.getUniformLocation(p, `uBase${i}`),
                mid:  gl.getUniformLocation(p, `uMid${i}`),
                tip:  gl.getUniformLocation(p, `uTip${i}`),
                core: gl.getUniformLocation(p, `uCore${i}`),
              });
            }

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

    // ── resize ──────────────────────────────────────────────────────
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      glCanvas.width = Math.floor(w * dpr);
      glCanvas.height = Math.floor(h * dpr);
      fxCanvas.width = Math.floor(w * dpr);
      fxCanvas.height = Math.floor(h * dpr);
      ectx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (gl) gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // ── ember pool (bottom-rising glow particles) ───────────────────
    type Ember = {
      alive: boolean;
      x: number; y: number;
      vx: number; vy: number;
      life: number; maxLife: number;
      r: number; big: boolean;
      cr: number; cg: number; cb: number;
    };
    const EMBER_POOL = 280;
    const embers: Ember[] = [];
    for (let i = 0; i < EMBER_POOL; i++) {
      embers.push({
        alive: false, x: 0, y: 0, vx: 0, vy: 0,
        life: 0, maxLife: 1, r: 1, big: false,
        cr: 255, cg: 165, cb: 50,
      });
    }
    let emberSpawnHint = 0;
    const spawnEmber = (
      x: number, y: number, vx: number, vy: number,
      cr: number, cg: number, cb: number,
      maxLifeOverride?: number,
    ): number => {
      for (let attempts = 0; attempts < EMBER_POOL; attempts++) {
        const idx = (emberSpawnHint + attempts) % EMBER_POOL;
        const e = embers[idx];
        if (!e.alive) {
          e.alive = true;
          e.x = x; e.y = y; e.vx = vx; e.vy = vy;
          e.maxLife = maxLifeOverride ?? 2 + Math.random() * 4;
          e.life = e.maxLife;
          e.big = Math.random() < 0.08;
          e.r = e.big ? 3 + Math.random() * 2 : 1 + Math.random() * 1.4;
          e.cr = cr; e.cg = cg; e.cb = cb;
          emberSpawnHint = idx + 1;
          return idx;
        }
      }
      return -1;
    };
    const activeEmbers = (): number => {
      let n = 0;
      for (let i = 0; i < EMBER_POOL; i++) if (embers[i].alive) n++;
      return n;
    };

    // ── spark pool (small bright dots with short trails) ────────────
    type Spark = {
      alive: boolean;
      x: number; y: number;
      vx: number; vy: number;
      life: number; maxLife: number;
      trail: Array<{ x: number; y: number }>;
      cr: number; cg: number; cb: number;
    };
    const SPARK_POOL = 240;
    const sparks: Spark[] = [];
    for (let i = 0; i < SPARK_POOL; i++) {
      sparks.push({
        alive: false, x: 0, y: 0, vx: 0, vy: 0,
        life: 0, maxLife: 1, trail: [],
        cr: 255, cg: 220, cb: 120,
      });
    }
    let sparkSpawnHint = 0;
    const spawnSpark = (
      x: number, y: number, vx: number, vy: number,
      cr: number, cg: number, cb: number,
    ): number => {
      for (let attempts = 0; attempts < SPARK_POOL; attempts++) {
        const idx = (sparkSpawnHint + attempts) % SPARK_POOL;
        const s = sparks[idx];
        if (!s.alive) {
          s.alive = true;
          s.x = x; s.y = y; s.vx = vx; s.vy = vy;
          s.maxLife = 0.8 + Math.random() * 1.2;
          s.life = s.maxLife;
          s.trail.length = 0;
          s.cr = cr; s.cg = cg; s.cb = cb;
          sparkSpawnHint = idx + 1;
          return idx;
        }
      }
      return -1;
    };

    // ── smoke pool (dark wisps above each flame) ────────────────────
    type Smoke = {
      alive: boolean;
      x: number; y: number;
      vx: number; vy: number;
      life: number; maxLife: number;
      r: number;
      seed: number;
    };
    const SMOKE_POOL = 90;
    const smokes: Smoke[] = [];
    for (let i = 0; i < SMOKE_POOL; i++) {
      smokes.push({
        alive: false, x: 0, y: 0, vx: 0, vy: 0,
        life: 0, maxLife: 1, r: 8, seed: 0,
      });
    }
    let smokeSpawnHint = 0;
    const spawnSmoke = (x: number, y: number, vx: number, vy: number, r: number): number => {
      for (let attempts = 0; attempts < SMOKE_POOL; attempts++) {
        const idx = (smokeSpawnHint + attempts) % SMOKE_POOL;
        const s = smokes[idx];
        if (!s.alive) {
          s.alive = true;
          s.x = x; s.y = y; s.vx = vx; s.vy = vy;
          s.maxLife = 3 + Math.random() * 3;
          s.life = s.maxLife;
          s.r = r;
          s.seed = Math.random() * 100;
          smokeSpawnHint = idx + 1;
          return idx;
        }
      }
      return -1;
    };

    // ── pointer + drag (flame-drag, wind-fan, taps) ─────────────────
    type DragMode = "none" | "flame" | "wind";
    type DragState = {
      pointerId: number;
      lastX: number; lastY: number;
      startX: number; startY: number;
      moved: boolean;
      t0: number;
      mode: DragMode;
      flameIdx: number;
      windVel: number;
    };
    let drag: DragState | null = null;

    // Find the flame whose base is closest to (xFrac, yFrac=1).
    const pickFlame = (xFrac: number, yFrac: number): number => {
      const flames = flamesRef.current;
      let bestI = -1;
      let bestD = 0.10;
      for (let i = 0; i < flames.length; i++) {
        const f = flames[i];
        // Hit area: flame column reaches up to topY in shader uv
        // (uv y=0 bottom, y=1 top). DOM y is flipped, so flameYTop = 1 - topY.
        const topY = 1.0 + (f.height - 1.0) * 0.55;
        const flameYTop = 1 - topY;
        if (yFrac < flameYTop) continue;
        const baseWidth = 0.06 * f.width + 0.04;
        const dx = Math.abs(xFrac - f.x);
        if (dx < baseWidth && dx < bestD) {
          bestD = dx;
          bestI = i;
        }
      }
      return bestI;
    };

    const spawnSparkBurst = (
      cxPx: number, cyPx: number, n: number, paletteIdx: number,
    ) => {
      const p = FLAME_PALETTE[paletteIdx];
      for (let i = 0; i < n; i++) {
        const ang = -Math.PI * 0.5 + (Math.random() - 0.5) * Math.PI * 1.4;
        const sp = 90 + Math.random() * 220;
        const vx = Math.cos(ang) * sp + (Math.random() - 0.5) * 40;
        const vy = Math.sin(ang) * sp;
        spawnSpark(cxPx, cyPx, vx, vy, p.emberR, p.emberG, p.emberB);
      }
    };

    const spawnEmberBurst = (cx: number, cy: number) => {
      const p = FLAME_PALETTE[0];
      for (let i = 0; i < 20; i++) {
        const ang = -Math.PI * 0.5 + (Math.random() - 0.5) * Math.PI * 1.6;
        const sp = 40 + Math.random() * 110;
        const vx = Math.cos(ang) * sp + (Math.random() - 0.5) * 30;
        const vy = Math.sin(ang) * sp;
        spawnEmber(cx, cy, vx, vy, p.emberR, p.emberG, p.emberB, 1.5 + Math.random() * 2.5);
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      const r = fxCanvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const w = Math.max(1, fxCanvas.clientWidth);
      const h = Math.max(1, fxCanvas.clientHeight);
      const xFrac = x / w;
      const yFrac = y / h;

      const flameIdx = pickFlame(xFrac, yFrac);
      drag = {
        pointerId: e.pointerId,
        lastX: x, lastY: y,
        startX: x, startY: y,
        moved: false,
        t0: performance.now(),
        mode: flameIdx >= 0 ? "flame" : "wind",
        flameIdx,
        windVel: 0,
      };
      try { fxCanvas.setPointerCapture(e.pointerId); } catch { /* noop */ }
      cursorRef.current.x = xFrac;
      cursorRef.current.y = yFrac;
      cursorRef.current.over = true;
    };

    const onPointerMove = (e: PointerEvent) => {
      const r = fxCanvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const w = Math.max(1, fxCanvas.clientWidth);
      const h = Math.max(1, fxCanvas.clientHeight);
      cursorRef.current.x = x / w;
      cursorRef.current.y = y / h;
      cursorRef.current.over = true;

      if (drag && e.pointerId === drag.pointerId) {
        const dx = x - drag.lastX;
        const totalDx = x - drag.startX;
        if (Math.abs(totalDx) > 6) drag.moved = true;

        if (drag.mode === "flame" && drag.flameIdx >= 0) {
          const flames = flamesRef.current;
          flames[drag.flameIdx].x = Math.max(0.02, Math.min(0.98, x / w));
        } else if (drag.mode === "wind") {
          const windFromDrag = Math.max(-1, Math.min(1, totalDx / (w * 0.35)));
          windRef.current.target = windFromDrag;
          drag.windVel = dx;
        }
        drag.lastX = x;
        drag.lastY = y;
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointerId) {
        drag = null;
        return;
      }
      const r = fxCanvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const w = Math.max(1, fxCanvas.clientWidth);
      const h = Math.max(1, fxCanvas.clientHeight);
      const wasDrag = drag.moved;
      const dragMode = drag.mode;
      const dragFlameIdx = drag.flameIdx;
      const dragWindVel = drag.windVel;
      try { fxCanvas.releasePointerCapture(e.pointerId); } catch { /* noop */ }

      if (!wasDrag) {
        const xFrac = x / w;
        const yFrac = y / h;
        const flameIdx = pickFlame(xFrac, yFrac);
        if (flameIdx >= 0) {
          const f = flamesRef.current[flameIdx];
          f.growAmp = 1;
          f.growT0 = performance.now();
          const baseYPx = h * 0.82;
          const baseXPx = f.x * w;
          spawnSparkBurst(baseXPx, baseYPx, 30, f.paletteIdx);
          blazeRef.current = { amp: 0.5, t0: performance.now() };
          audio.thud();
          const palette = FLAME_PALETTE[f.paletteIdx];
          const tone = `rgb(${Math.round(palette.mid[0] * 255)}, ${Math.round(palette.mid[1] * 255)}, ${Math.round(palette.mid[2] * 255)})`;
          haptics.roll();
          markFire("blaze", tone);
          useField.getState().recordTape("sigil", 0.7, "fire/blaze");
        } else if (y < h * 0.5) {
          spawnEmberBurst(x, y);
          audio.spark();
          haptics.ripple(0.42);
          markFire("embers", "#ffb06a");
          useField.getState().recordTape("object", 0.4, "fire/embers");
        } else {
          blazeRef.current = { amp: 0.32, t0: performance.now() };
          audio.thud();
          haptics.ripple(0.35);
          markFire("hearth", "#8f3920");
          useField.getState().recordTape("object", 0.3, "fire/hearth");
        }
      } else {
        if (dragMode === "wind") {
          // fling: high velocity at release → push wind to ±1 briefly.
          if (Math.abs(dragWindVel) > 8) {
            const sign = dragWindVel > 0 ? 1 : -1;
            windRef.current.target = sign;
            haptics.chop();
            markFire(sign > 0 ? "east wind" : "west wind", "#ffd28a");
            useField.getState().recordTape("region", 0.45, sign > 0 ? "fire/east-wind" : "fire/west-wind");
          }
        } else if (dragMode === "flame" && dragFlameIdx >= 0) {
          audio.chime();
          haptics.ripple(0.38);
          markFire("moved flame", "#ff7a2d");
          useField.getState().recordTape("object", 0.35, "fire/move");
        }
      }
      drag = null;
    };

    const onPointerLeave = () => {
      cursorRef.current.over = false;
    };

    fxCanvas.addEventListener("pointerdown", onPointerDown);
    fxCanvas.addEventListener("pointermove", onPointerMove);
    fxCanvas.addEventListener("pointerup", onPointerUp);
    fxCanvas.addEventListener("pointercancel", onPointerUp);
    fxCanvas.addEventListener("pointerleave", onPointerLeave);

    // ── render loop ─────────────────────────────────────────────────
    const tStart = performance.now();
    let raf = 0;
    let lastFrame = performance.now();
    let steadySpawnAcc = 0;

    const posArr = new Float32Array(MAX_FLAMES * 2);
    const shapeArr = new Float32Array(MAX_FLAMES * 4);

    const draw = (now: number) => {
      const w = fxCanvas.clientWidth;
      const h = fxCanvas.clientHeight;
      const dt = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      const tSec = reduce ? 0 : (now - tStart) / 1000;
      const stepDt = reduce ? 0 : dt;

      // ── wind reconciliation ─────────────────────────────────────
      const dialActive = Math.abs(windDialRef.current) > 0.001;
      if (dialActive) {
        windRef.current.target = windDialRef.current;
      } else {
        windRef.current.target *= Math.pow(0.001, dt / 1.5);
        if (Math.abs(windRef.current.target) < 0.001) windRef.current.target = 0;
      }
      windRef.current.current +=
        (windRef.current.target - windRef.current.current) * Math.min(1, dt * 6);
      const wind = windRef.current.current;

      // ── flame grow envelopes (4s ease-out per source) ───────────
      const flames = flamesRef.current;
      for (let i = 0; i < flames.length; i++) {
        const f = flames[i];
        if (f.growAmp > 0) {
          const age = (now - f.growT0) / 1000;
          if (age >= 4) f.growAmp = 0;
          else {
            const k = 1 - age / 4;
            f.growAmp = k * k * k;
          }
        }
      }

      // ── blaze envelope ──────────────────────────────────────────
      let blaze = 0;
      if (blazeRef.current.amp > 0) {
        const age = (now - blazeRef.current.t0) / 1000;
        if (age >= 0.8) {
          blazeRef.current.amp = 0;
        } else {
          const k = 1 - age / 0.8;
          blaze = blazeRef.current.amp * k * k;
        }
      }

      // ── WebGL pass ──────────────────────────────────────────────
      if (gl && glProg) {
        gl.useProgram(glProg);
        if (uTimeLoc) gl.uniform1f(uTimeLoc, tSec);
        if (uResLoc) gl.uniform2f(uResLoc, glCanvas.width, glCanvas.height);
        if (uCursorLoc) {
          const cx = cursorRef.current.x;
          const cyShader = 1 - cursorRef.current.y;
          gl.uniform2f(uCursorLoc, cx, cyShader);
        }
        if (uCursorActiveLoc)
          gl.uniform1f(uCursorActiveLoc, cursorRef.current.over ? 1 : 0);
        if (uBlazeLoc) gl.uniform1f(uBlazeLoc, blaze);
        if (uWindLoc) gl.uniform1f(uWindLoc, wind);

        const count = Math.min(flames.length, MAX_FLAMES);
        if (uCountLoc) gl.uniform1i(uCountLoc, count);

        for (let i = 0; i < MAX_FLAMES; i++) {
          if (i < count) {
            const f = flames[i];
            posArr[i * 2 + 0] = f.x;
            posArr[i * 2 + 1] = 0;
            shapeArr[i * 4 + 0] = f.width;
            shapeArr[i * 4 + 1] = f.height;
            shapeArr[i * 4 + 2] = f.growAmp;
            shapeArr[i * 4 + 3] = f.breathPhase;
          } else {
            posArr[i * 2 + 0] = 0;
            posArr[i * 2 + 1] = 0;
            shapeArr[i * 4 + 0] = 0;
            shapeArr[i * 4 + 1] = 0;
            shapeArr[i * 4 + 2] = 0;
            shapeArr[i * 4 + 3] = 0;
          }
        }
        if (uPosLoc) gl.uniform2fv(uPosLoc, posArr);
        if (uShapeLoc) gl.uniform4fv(uShapeLoc, shapeArr);

        for (let i = 0; i < count; i++) {
          const pIdx = flames[i].paletteIdx;
          const pal = FLAME_PALETTE[pIdx];
          const locs = uColorLocs[i];
          if (locs?.base) gl.uniform3f(locs.base, pal.base[0], pal.base[1], pal.base[2]);
          if (locs?.mid)  gl.uniform3f(locs.mid,  pal.mid[0],  pal.mid[1],  pal.mid[2]);
          if (locs?.tip)  gl.uniform3f(locs.tip,  pal.tip[0],  pal.tip[1],  pal.tip[2]);
          if (locs?.core) gl.uniform3f(locs.core, pal.core[0], pal.core[1], pal.core[2]);
        }
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } else {
        const fctx = glCanvas.getContext("2d");
        if (fctx) {
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          const g = fctx.createLinearGradient(0, 0, 0, h);
          g.addColorStop(0, "#0e0606");
          g.addColorStop(1, "#2a1006");
          fctx.fillStyle = g;
          fctx.fillRect(0, 0, w, h);
        }
      }

      // ── 2D fx layer ─────────────────────────────────────────────
      ectx.clearRect(0, 0, w, h);

      // === smoke first (so it sits beneath embers/sparks) =========
      if (!reduce) {
        for (let i = 0; i < flames.length; i++) {
          const f = flames[i];
          const density = (f.height + f.growAmp) * 0.6;
          f.smokeAcc += density * dt * 3.2;
          while (f.smokeAcc >= 1) {
            f.smokeAcc -= 1;
            const flameTopY = h * (1 - (1 + (f.height - 1) * 0.55) * 0.75);
            const xJitter = (Math.random() - 0.5) * 24 * f.width;
            const x = f.x * w + xJitter;
            const y = Math.max(0, flameTopY) + (Math.random() - 0.5) * 24;
            const vx = wind * 30 + (Math.random() - 0.5) * 10;
            const vy = -(18 + Math.random() * 22);
            const r = 14 + Math.random() * 16 + f.growAmp * 8;
            spawnSmoke(x, y, vx, vy, r);
          }
        }
      }

      for (let i = 0; i < SMOKE_POOL; i++) {
        const s = smokes[i];
        if (!s.alive) continue;
        s.life -= stepDt;
        if (s.life <= 0) { s.alive = false; continue; }
        const tAge = s.maxLife - s.life;
        const curlX = Math.sin(s.seed + tAge * 1.3) * 6;
        s.vx += (wind * 18 - s.vx) * Math.min(1, dt * 1.2);
        s.x += (s.vx + curlX * 0.06) * stepDt;
        s.y += s.vy * stepDt;
        s.r += stepDt * 8;

        const ratio = s.life / s.maxLife;
        const alpha = Math.min(0.32, ratio * 0.42);
        const grad = ectx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
        grad.addColorStop(0, `rgba(40, 28, 22, ${alpha})`);
        grad.addColorStop(1, "rgba(40, 28, 22, 0)");
        ectx.fillStyle = grad;
        ectx.beginPath();
        ectx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ectx.fill();
      }

      // === steady ember spawn ====================================
      const active = activeEmbers();
      if (!reduce && active < 250) {
        const desire = active < 100 ? 80 : active < 180 ? 50 : 24;
        steadySpawnAcc += desire * dt;
        while (steadySpawnAcc >= 1 && activeEmbers() < 250) {
          steadySpawnAcc -= 1;
          // pick a flame source weighted by height + grow
          let total = 0;
          for (const f of flames) total += f.height + f.growAmp;
          let r = Math.random() * total;
          let pick = flames[0];
          for (const f of flames) {
            r -= f.height + f.growAmp;
            if (r <= 0) { pick = f; break; }
          }
          const span = 0.08 * pick.width;
          const xf = pick.x + (Math.random() - 0.5) * span;
          const x = xf * w;
          const y = h + 4;
          const vx = (Math.random() - 0.5) * 36 + wind * 50;
          const vy = -(60 + Math.random() * 90 * pick.height);
          const pal = FLAME_PALETTE[pick.paletteIdx];
          spawnEmber(x, y, vx, vy, pal.emberR, pal.emberG, pal.emberB);
        }
      }

      // === ember integration + draw ==============================
      const gravity = -28;
      const dragF = 0.985;
      const windShove = wind * 80;
      for (let i = 0; i < EMBER_POOL; i++) {
        const e = embers[i];
        if (!e.alive) continue;
        e.life -= stepDt;
        if (e.life <= 0) { e.alive = false; continue; }
        e.vy += gravity * stepDt;
        e.vx += windShove * stepDt;
        e.vx *= dragF;
        e.x += e.vx * stepDt;
        e.y += e.vy * stepDt;
        if (e.y < -20 || e.x < -40 || e.x > w + 40) { e.alive = false; continue; }

        const ratio = e.life / e.maxLife;
        const age = 1 - ratio;
        let rR: number, rG: number, rB: number;
        if (age < 0.45) {
          const k = age / 0.45;
          rR = Math.round(e.cr + (220 - e.cr) * k);
          rG = Math.round(e.cg + (220 - e.cg) * k);
          rB = Math.round(e.cb + (90 - e.cb) * k);
        } else {
          const k = (age - 0.45) / 0.55;
          rR = Math.round(220 + (140 - 220) * k);
          rG = Math.round(220 + (140 - 220) * k);
          rB = Math.round(90 + (135 - 90) * k);
        }
        const alpha = Math.min(1, ratio * 1.4);
        const flick = 0.85 + Math.sin(now * 0.02 + i * 1.7) * 0.15;
        const radius = e.r * (0.6 + 0.4 * ratio) * flick;

        if (e.big) {
          const haloR = radius * 3.2;
          const grad = ectx.createRadialGradient(e.x, e.y, 0, e.x, e.y, haloR);
          grad.addColorStop(0, `rgba(${rR}, ${rG}, ${rB}, ${0.32 * alpha})`);
          grad.addColorStop(1, `rgba(${rR}, ${rG}, ${rB}, 0)`);
          ectx.fillStyle = grad;
          ectx.beginPath();
          ectx.arc(e.x, e.y, haloR, 0, Math.PI * 2);
          ectx.fill();
        }

        ectx.globalAlpha = alpha;
        ectx.fillStyle = `rgb(${rR}, ${rG}, ${rB})`;
        ectx.beginPath();
        ectx.arc(e.x, e.y, Math.max(0.5, radius), 0, Math.PI * 2);
        ectx.fill();
      }
      ectx.globalAlpha = 1;

      // === steady spark spawn ====================================
      if (!reduce) {
        for (let i = 0; i < flames.length; i++) {
          const f = flames[i];
          const rate = (1.0 + f.growAmp * 3) * 1.4;
          f.sparkAcc += rate * dt;
          while (f.sparkAcc >= 1) {
            f.sparkAcc -= 1;
            const flameMidY = h * 0.78;
            const xJitter = (Math.random() - 0.5) * 16 * f.width;
            const x = f.x * w + xJitter;
            const y = flameMidY + (Math.random() - 0.5) * 30;
            const ang = -Math.PI * 0.5 + (Math.random() - 0.5) * Math.PI * 0.6;
            const sp = 60 + Math.random() * 130;
            const vx = Math.cos(ang) * sp + wind * 80;
            const vy = Math.sin(ang) * sp;
            const pal = FLAME_PALETTE[f.paletteIdx];
            spawnSpark(x, y, vx, vy, pal.emberR, pal.emberG, pal.emberB);
          }
        }
      }

      // === spark integration + draw ==============================
      for (let i = 0; i < SPARK_POOL; i++) {
        const s = sparks[i];
        if (!s.alive) continue;
        s.life -= stepDt;
        if (s.life <= 0) { s.alive = false; continue; }
        s.vy += -50 * stepDt;
        s.vx += wind * 110 * stepDt;
        s.vx *= 0.992;
        s.x += s.vx * stepDt;
        s.y += s.vy * stepDt;
        if (s.y < -40 || s.x < -40 || s.x > w + 40) { s.alive = false; continue; }
        s.trail.push({ x: s.x, y: s.y });
        while (s.trail.length > 6) s.trail.shift();

        const ratio = s.life / s.maxLife;
        const alpha = Math.min(1, ratio * 1.4);

        ectx.lineCap = "round";
        for (let k = 0; k < s.trail.length - 1; k++) {
          const a = s.trail[k];
          const b = s.trail[k + 1];
          const ta = (k + 1) / s.trail.length;
          ectx.globalAlpha = alpha * ta * 0.7;
          ectx.strokeStyle = `rgb(${s.cr}, ${s.cg}, ${s.cb})`;
          ectx.lineWidth = 1.2;
          ectx.beginPath();
          ectx.moveTo(a.x, a.y);
          ectx.lineTo(b.x, b.y);
          ectx.stroke();
        }

        // head
        ectx.globalAlpha = alpha;
        ectx.fillStyle = `rgb(255, ${Math.min(255, s.cg + 30)}, ${Math.min(255, s.cb + 50)})`;
        ectx.beginPath();
        ectx.arc(s.x, s.y, 1.6, 0, Math.PI * 2);
        ectx.fill();
      }
      ectx.globalAlpha = 1;

      raf = requestAnimationFrame(draw);
      void motion;
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      fxCanvas.removeEventListener("pointerdown", onPointerDown);
      fxCanvas.removeEventListener("pointermove", onPointerMove);
      fxCanvas.removeEventListener("pointerup", onPointerUp);
      fxCanvas.removeEventListener("pointercancel", onPointerUp);
      fxCanvas.removeEventListener("pointerleave", onPointerLeave);
    };
  }, [markFire]);

  // ── wind dial handlers (small slider, bottom-right) ───────────────
  const onWindChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Math.max(-1, Math.min(1, parseFloat(e.target.value)));
    windDialRef.current = v;
    setWindDisplay(v);
  };

  const onWindCommit = () => {
    const v = windDialRef.current;
    if (Math.abs(v) < 0.02) {
      markFire("still air", "#ffd28a");
      haptics.tap();
      useField.getState().recordTape("region", 0.2, "fire/still-air");
      return;
    }
    markFire(v > 0 ? "east wind" : "west wind", "#ffd28a");
    haptics.ripple(Math.min(0.75, Math.abs(v)));
    useField.getState().recordTape(
      "region",
      Math.min(0.75, Math.abs(v)),
      v > 0 ? "fire/east-wind" : "fire/west-wind",
    );
  };

  // ── color shifter: cycle every flame's palette by +1 ──────────────
  const onColorShift = () => {
    const flames = flamesRef.current;
    for (const f of flames) {
      f.paletteIdx = (f.paletteIdx + 1) % FLAME_PALETTE.length;
    }
    setPaletteTick((t) => t + 1);
    const palette = FLAME_PALETTE[flames[0]?.paletteIdx ?? 0];
    const tone = `rgb(${Math.round(palette.mid[0] * 255)}, ${Math.round(palette.mid[1] * 255)}, ${Math.round(palette.mid[2] * 255)})`;
    markFire(palette.name, tone);
    haptics.roll();
    useField.getState().recordTape("sigil", 0.45, `fire/${palette.id}`);
    try { getFieldAudio().chime(); } catch { /* noop */ }
  };

  const onSplitFlame = () => {
    const flames = flamesRef.current;
    const now = performance.now();
    const didSplit = flames.length < MAX_FLAMES;
    if (didSplit) {
      const source = flames[Math.floor(flames.length / 2)] ?? flames[0];
      flames.push({
        x: Math.max(0.04, Math.min(0.96, source.x + (Math.random() - 0.5) * 0.18)),
        width: Math.max(0.62, source.width * (0.82 + Math.random() * 0.18)),
        height: Math.max(0.72, source.height * (0.82 + Math.random() * 0.26)),
        paletteIdx: (source.paletteIdx + flames.length) % FLAME_PALETTE.length,
        growAmp: 0.7,
        growT0: now,
        breathPhase: Math.random() * Math.PI * 2,
        sparkAcc: 0,
        smokeAcc: 0,
      });
    } else {
      for (const f of flames) {
        f.growAmp = Math.max(f.growAmp, 0.55);
        f.growT0 = now;
      }
    }
    blazeRef.current = { amp: 0.45, t0: now };
    setPaletteTick((t) => t + 1);
    markFire(didSplit ? "split" : "brighten", "#ffcf7a");
    haptics.ripple(0.65);
    useField.getState().recordTape("object", 0.5, "fire/split");
    try { getFieldAudio().spark(); } catch { /* noop */ }
  };

  const onFanBurst = () => {
    const dir = windRef.current.current >= 0 ? -1 : 1;
    windDialRef.current = 0;
    windRef.current.target = dir;
    blazeRef.current = { amp: 0.75, t0: performance.now() };
    for (const f of flamesRef.current) {
      f.growAmp = Math.max(f.growAmp, 0.32);
      f.growT0 = performance.now();
    }
    setWindDisplay(0);
    markFire(dir > 0 ? "fan east" : "fan west", "#ffd28a");
    haptics.chop();
    useField.getState().recordTape("region", 0.65, dir > 0 ? "fire/fan-east" : "fire/fan-west");
    try { getFieldAudio().thud(); } catch { /* noop */ }
  };

  return (
    <div
      ref={wrapRef}
      data-touch-surface="true"
      aria-label="fire — tap a flame to blaze, drag a flame sideways, drag empty hearth to fan the wind"
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        background: "#0e0606",
        WebkitUserSelect: "none",
        userSelect: "none",
        WebkitTouchCallout: "none",
      }}
    >
      <canvas
        ref={glCanvasRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          display: "block",
        }}
      />
      <canvas
        ref={fxCanvasRef}
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

      {/* ── title block ─────────────────────────────────────────── */}
      <div
        className="fire-title"
        style={{
          position: "fixed",
          top: 80,
          left: "var(--pad-x)",
          color: "rgba(255, 246, 220, 0.96)",
          pointerEvents: "none",
          maxWidth: 560,
        }}
      >
        <div
          className="t-mono"
          style={{
            color: "rgba(255, 246, 220, 0.55)",
            marginBottom: 14,
          }}
        >
          fire / the element that breathes
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
            color: "rgba(255, 246, 220, 0.98)",
          }}
        >
          EMBER
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
            color: "rgba(255, 220, 170, 0.82)",
            marginTop: 6,
            letterSpacing: "0.002em",
          }}
        >
          flame is a wave of light
        </WaterText>
      </div>

      <div
        className="fire-memory"
        data-fire-memory="true"
        aria-live="polite"
        style={{
          position: "fixed",
          left: 18,
          bottom: "calc(112px + env(safe-area-inset-bottom, 0px))",
          zIndex: 4,
          display: "flex",
          alignItems: "center",
          gap: 8,
          maxWidth: "min(480px, calc(100vw - 170px))",
          padding: "8px 10px",
          border: "1px solid rgba(255, 246, 220, 0.16)",
          borderRadius: 6,
          background: "rgba(20, 8, 4, 0.52)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          color: "rgba(255, 246, 220, 0.70)",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: 0,
          textTransform: "lowercase",
          pointerEvents: "none",
        }}
      >
        {fireMarks.map((mark, index) => (
          <span
            key={`${mark.label}-${mark.t}-${index}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              minWidth: 0,
              opacity: index === 0 ? 1 : 0.45,
              whiteSpace: "nowrap",
            }}
          >
            <i
              aria-hidden="true"
              style={{
                width: index === 0 ? 24 : 10,
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

      {/* ── bottom inscription ──────────────────────────────────── */}
      <WaterText
        className="fire-legend"
        as="div"
        bobAmp={1.5}
        style={{
          display: "block",
          position: "fixed",
          left: "50%",
          bottom: "calc(152px + env(safe-area-inset-bottom, 0px))",
          transform: "translateX(-50%)",
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontWeight: 300,
          fontSize: "clamp(13px, 1.4vw, 17px)",
          letterSpacing: "0.02em",
          color: "rgba(255, 220, 170, 0.62)",
          pointerEvents: "none",
          whiteSpace: "nowrap",
          textAlign: "center",
        }}
      >
        what burns also keeps watch
      </WaterText>

      {/* ── compact controls (top-right) ────────────────────────── */}
      <div
        className="fire-control-rail"
        style={{
          position: "fixed",
          right: "var(--pad-x)",
          top: 88,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          zIndex: 5,
        }}
      >
        <button
          type="button"
          onClick={onColorShift}
          aria-label="cycle flame colors"
          title="cycle flame colors"
          data-tick={paletteTick}
          className="fire-action"
          style={{
            minWidth: 44,
            minHeight: 44,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            background: "rgba(20, 8, 4, 0.55)",
            border: "1px solid rgba(255, 246, 220, 0.22)",
            color: "rgba(255, 246, 220, 0.86)",
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 11,
            letterSpacing: "0.10em",
            textTransform: "lowercase",
            cursor: "pointer",
          }}
        >
          <span style={{ display: "inline-flex", gap: 3 }}>
            {flamesRef.current.slice(0, 5).map((f, i) => {
              const pal = FLAME_PALETTE[f.paletteIdx];
              const rgb = `rgb(${Math.round(pal.mid[0] * 255)}, ${Math.round(pal.mid[1] * 255)}, ${Math.round(pal.mid[2] * 255)})`;
              return (
                <span
                  key={i}
                  aria-hidden="true"
                  style={{
                    width: 8,
                    height: 14,
                    background: rgb,
                    borderRadius: 1,
                    display: "inline-block",
                  }}
                />
              );
            })}
          </span>
          <span>shift</span>
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={onSplitFlame}
            aria-label="split a new flame"
            title="split a new flame"
            className="fire-action fire-icon-action"
            style={{
              width: 44,
              height: 44,
              border: "1px solid rgba(255, 246, 220, 0.22)",
              background: "rgba(20, 8, 4, 0.55)",
              color: "rgba(255, 246, 220, 0.88)",
              cursor: "pointer",
              fontFamily: "var(--font-serif)",
              fontSize: 21,
              lineHeight: 1,
            }}
          >
            +
          </button>
          <button
            type="button"
            onClick={onFanBurst}
            aria-label="fan the flames"
            title="fan the flames"
            className="fire-action fire-icon-action"
            style={{
              width: 44,
              height: 44,
              border: "1px solid rgba(255, 246, 220, 0.22)",
              background: "rgba(20, 8, 4, 0.55)",
              color: "rgba(255, 246, 220, 0.88)",
              cursor: "pointer",
              fontFamily: "var(--font-serif)",
              fontSize: 18,
              lineHeight: 1,
            }}
          >
            fan
          </button>
        </div>
      </div>

      {/* ── wind dial (bottom-right) ────────────────────────────── */}
      <div
        className="fire-wind-panel"
        style={{
          position: "fixed",
          right: "calc(260px + env(safe-area-inset-right, 0px))",
          bottom: "calc(108px + env(safe-area-inset-bottom, 0px))",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          color: "rgba(255, 246, 220, 0.78)",
          pointerEvents: "auto",
          userSelect: "none",
        }}
      >
        <div
          className="t-mono"
          style={{
            fontSize: 11,
            letterSpacing: "0.10em",
            textTransform: "lowercase",
            color: "rgba(255, 246, 220, 0.55)",
          }}
        >
          wind
        </div>
        <input
          type="range"
          aria-label="wind"
          min={-1}
          max={1}
          step={0.01}
          value={windDisplay}
          onChange={onWindChange}
          onPointerUp={onWindCommit}
          onKeyUp={onWindCommit}
          className="fire-wind-dial"
          style={{
            width: 120,
            height: 44,
            minHeight: 44,
            appearance: "none",
            WebkitAppearance: "none",
            background: "transparent",
            cursor: "ew-resize",
            touchAction: "none",
          }}
        />
      </div>

      {/* scoped styles for the wind input */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .fire-wind-dial::-webkit-slider-runnable-track {
          height: 1px;
          background: rgba(255, 246, 220, 0.30);
        }
        .fire-wind-dial::-moz-range-track {
          height: 1px;
          background: rgba(255, 246, 220, 0.30);
        }
        .fire-wind-dial::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          margin-top: -7px;
          border-radius: 50%;
          background: rgba(255, 246, 220, 0.92);
          box-shadow: 0 0 0 1px rgba(20, 8, 4, 0.55);
          cursor: ew-resize;
        }
        .fire-wind-dial::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border: none;
          border-radius: 50%;
          background: rgba(255, 246, 220, 0.92);
          box-shadow: 0 0 0 1px rgba(20, 8, 4, 0.55);
          cursor: ew-resize;
        }
        .fire-wind-dial:focus { outline: none; }
        .fire-wind-dial:focus-visible::-webkit-slider-thumb {
          box-shadow: 0 0 0 2px rgba(255, 220, 170, 0.85);
        }
        @media (max-width: 720px) {
          .fire-title {
            top: 70px !important;
            left: 16px !important;
            right: 150px;
            max-width: calc(100vw - 166px) !important;
          }
          .fire-title h1 {
            font-size: clamp(34px, 12vw, 58px) !important;
          }
          .fire-control-rail {
            top: 240px !important;
            left: 16px !important;
            right: auto !important;
            flex-direction: row !important;
            align-items: center !important;
            gap: 6px !important;
          }
          .fire-action {
            min-width: 40px !important;
            min-height: 40px !important;
            padding: 6px 8px !important;
            font-size: 10px !important;
          }
          .fire-icon-action {
            width: 40px !important;
            height: 40px !important;
          }
          .fire-wind-panel {
            right: 12px !important;
            bottom: calc(102px + env(safe-area-inset-bottom, 0px)) !important;
            gap: 2px !important;
            transform: scale(0.92);
            transform-origin: right bottom;
          }
          .fire-memory {
            left: 12px !important;
            bottom: calc(108px + env(safe-area-inset-bottom, 0px)) !important;
            max-width: calc(100vw - 136px) !important;
            gap: 6px !important;
            padding: 7px 8px !important;
          }
          .fire-memory span:nth-child(n+4) {
            display: none !important;
          }
          .fire-legend {
            bottom: calc(160px + env(safe-area-inset-bottom, 0px)) !important;
            max-width: calc(100vw - 32px);
            white-space: normal !important;
            line-height: 1.25;
          }
        }
      `,
        }}
      />
    </div>
  );
}
