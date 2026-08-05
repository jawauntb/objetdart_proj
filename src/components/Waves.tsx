"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures, THRESHOLDS } from "@/lib/gesture";
import { tapTrainDepth, tapTrainTier } from "@/lib/gesture/core";
import { onVessel } from "@/lib/vessel";
import { useField } from "@/store/field";
import MobileInstrumentPanel from "@/components/MobileInstrumentPanel";
import {
  addNatural as worldAddNatural,
  commitZone as worldCommitZone,
  getNaturalsInZone,
  subscribeNaturals,
  type WorldKind,
  type WorldNatural,
} from "@/lib/world";
import LetGo from "@/components/LetGo";
import {
  onVisibility,
  onGalleryPause,
  resolveDpr,
  createFrameGovernor,
  createIdleWriter,
  isEmbeddedFrame,
  detailForTier,
} from "@/lib/room-runtime";
import { bakeRadialSprite, drawRadialStamp } from "@/lib/scene/radial-sprite";

/**
 * Waves — a wave-propagation instrument.
 *
 * A wave is a travelling disturbance. Here it is literal: a real
 * finite-difference wave equation runs on a grid (a ripple tank), so pulses
 * expand at a finite speed, reflect off the walls, and interfere into moiré.
 * Three media share the same physics:
 *   ripple      — 2D open tank, circular wavefronts
 *   string      — 1D plucked line reflecting at both ends
 *   refraction  — 2D tank with a speed gradient, so wavefronts bend
 *
 * The simulation (the state vector: the height field + its previous step)
 * stays a deterministic JS integrator, exactly as before. What changed is
 * how it is *seen*: ripple and refraction now upload that field to a
 * fragment shader as a small packed texture and let the GPU do the
 * per-pixel colour work a CPU loop + putImageData used to do — real
 * gradient-lit water, sun glint on the crests, foam on the steep water,
 * depth in the troughs. If WebGL is unavailable or the context is lost the
 * original CPU raster is still here, guarded, not deleted.
 */

type WaveMode = "ripple" | "string" | "refraction";

type ModeCfg = {
  id: WaveMode;
  label: string;
  hint: string;
  tone: string;
  midi: number;
};

const MODES: ModeCfg[] = [
  { id: "ripple", label: "ripple", hint: "open tank", tone: "#5fd4e0", midi: 48 },
  { id: "string", label: "string", hint: "plucked line", tone: "#f3d77a", midi: 55 },
  { id: "refraction", label: "refraction", hint: "bent front", tone: "#b99aff", midi: 43 },
];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

type RGB = readonly [number, number, number];

type Palette = {
  mid: RGB;
  crest: RGB;
  trough: RGB;
  caustic: RGB;
  foam: RGB;
};

const PALETTES: Record<"ripple" | "refraction", Palette> = {
  ripple: {
    mid: [8, 30, 46],
    crest: [138, 228, 238],
    trough: [22, 30, 88],
    caustic: [214, 248, 255],
    foam: [236, 250, 255],
  },
  refraction: {
    mid: [18, 16, 40],
    crest: [190, 156, 255],
    trough: [58, 26, 96],
    caustic: [238, 228, 255],
    foam: [244, 236, 255],
  },
};

// Flip's "night" — everything the palette blends toward under uNight.
const NIGHT_TINT: Palette = {
  mid: [3, 8, 18],
  crest: [96, 140, 190],
  trough: [4, 8, 26],
  caustic: [150, 190, 230],
  foam: [204, 218, 236],
};

const mixColor = (a: RGB, b: RGB, t: number): RGB => [
  mix(a[0], b[0], t),
  mix(a[1], b[1], t),
  mix(a[2], b[2], t),
];

// ── the field shader ────────────────────────────────────────────────
// The height field is packed into a two-channel 8-bit texture (16-bit
// fixed point, ±FIELD_RANGE) so it works identically on WebGL1
// (LUMINANCE_ALPHA, no extensions) and WebGL2 (RG8) without needing
// OES_texture_float. The colouring body is written once and shared
// between both shader variants via textual macros (TEXTURE/FIELD_SWIZZLE/
// FRAG_COLOR) so the two never drift apart.
const FIELD_RANGE = 1.5;

const FIELD_CORE = `
uniform sampler2D uField;
uniform vec2 uGridSize;
uniform vec3 uMid;
uniform vec3 uCrest;
uniform vec3 uTrough;
uniform vec3 uCaustic;
uniform vec3 uFoam;
uniform float uGlow;
uniform float uLens;
uniform float uNight;
uniform vec2 uSunDir;
uniform float uTime;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float decodeH(vec2 enc) {
  float v = enc.x * 255.0 * 256.0 + enc.y * 255.0;
  return v / 65535.0 * (2.0 * ${FIELD_RANGE.toFixed(2)}) - ${FIELD_RANGE.toFixed(2)};
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 texel = 1.0 / uGridSize;

  float hC = decodeH(TEXTURE(uField, uv).FIELD_SWIZZLE);
  float hL = decodeH(TEXTURE(uField, uv - vec2(texel.x, 0.0)).FIELD_SWIZZLE);
  float hR = decodeH(TEXTURE(uField, uv + vec2(texel.x, 0.0)).FIELD_SWIZZLE);
  float hT = decodeH(TEXTURE(uField, uv - vec2(0.0, texel.y)).FIELD_SWIZZLE);
  float hB = decodeH(TEXTURE(uField, uv + vec2(0.0, texel.y)).FIELD_SWIZZLE);
  float sx = hR - hL;
  float sy = hB - hT;
  float slope = sqrt(sx * sx + sy * sy);

  float t = clamp(hC * 2.3, -1.0, 1.0);
  vec3 color = t >= 0.0 ? mix(uMid, uCrest, t) : mix(uMid, uTrough, -t);

  // depth in the troughs — the deeper below still water, the more the
  // light is swallowed
  float depth = clamp(-t, 0.0, 1.0);
  color *= mix(1.0, 0.60, depth * depth);
  color = mix(color, vec3(dot(color, vec3(0.299, 0.587, 0.114))), depth * 0.16);

  // caustics riding the slope, same shape the CPU raster used
  float caus = clamp(slope * 3.6, 0.0, 1.0);
  caus *= caus;
  float causGlow = caus * (0.55 + uGlow * 0.5);
  color += (uCaustic - color) * causGlow * 0.9;

  // a surface normal from the gradient — sun/sky glint riding the crests
  vec3 normal = normalize(vec3(-sx * 6.0, -sy * 6.0, 1.0));
  vec3 lightDir = normalize(vec3(uSunDir, 0.72));
  vec3 halfV = normalize(lightDir + vec3(0.0, 0.0, 1.0));
  float ndoth = max(dot(normal, halfV), 0.0);
  float glint = pow(ndoth, mix(70.0, 20.0, uGlow)) * mix(1.0, 0.4, uNight);
  vec3 glintColor = mix(vec3(1.0, 0.96, 0.82), vec3(0.72, 0.80, 1.0), uNight);
  color += glintColor * glint * (0.55 + t * 0.4);

  // a broad sky sheen so the whole surface reads lit, not just the glints
  float sheen = clamp(dot(normal, vec3(0.0, 0.0, 1.0)), 0.0, 1.0);
  color += mix(vec3(0.5, 0.68, 0.82), vec3(0.24, 0.30, 0.48), uNight) * (1.0 - sheen) * 0.05;

  // foam where the gradient is steep, textured so it never reads as a
  // flat band
  float foamMask = smoothstep(0.34, 0.80, slope);
  float foamNoise = hash21(floor(uv * uGridSize * 0.6) + floor(uTime * 6.0));
  foamMask *= 0.5 + 0.5 * foamNoise;
  color = mix(color, uFoam, clamp(foamMask, 0.0, 1.0) * 0.85);

  // the lens: rotate the level of description — surface / equation / felt
  if (uLens > 0.001) {
    vec3 paper = vec3(0.90, 0.88, 0.80);
    vec3 ink = vec3(0.12, 0.14, 0.20);
    float iso = abs(fract(hC * 5.0 + 0.5) - 0.5) * 2.0;
    float line = 1.0 - smoothstep(0.0, 0.08 + slope * 0.4, iso);
    float gx = 1.0 - smoothstep(0.0, 0.35, abs(fract(uv.x * uGridSize.x / 8.0) - 0.5) * 2.0 - 0.96);
    float gy = 1.0 - smoothstep(0.0, 0.35, abs(fract(uv.y * uGridSize.y / 8.0) - 0.5) * 2.0 - 0.96);
    vec3 eqColor = mix(paper, ink, clamp(line * 0.85 + max(gx, gy) * 0.12, 0.0, 1.0));
    eqColor = mix(eqColor, ink, clamp(abs(t) * 0.25, 0.0, 1.0));
    color = mix(color, eqColor, clamp(uLens, 0.0, 1.0));

    float energy = clamp(slope * 3.2 + abs(t) * 0.6, 0.0, 1.0);
    vec3 feltColor = mix(vec3(0.03, 0.035, 0.05), vec3(0.95, 0.55, 0.28), energy);
    color = mix(color, feltColor, clamp(uLens - 1.0, 0.0, 1.0));
  }

  FRAG_COLOR = vec4(clamp(color, 0.0, 1.6), 1.0);
}
`;

const FRAG_GL1 = `
precision highp float;
#define TEXTURE texture2D
#define FIELD_SWIZZLE ra
#define FRAG_COLOR gl_FragColor
varying vec2 vUv;
${FIELD_CORE}`;

const FRAG_GL2 = `#version 300 es
precision highp float;
#define TEXTURE texture
#define FIELD_SWIZZLE rg
#define FRAG_COLOR oColor
in vec2 vUv;
out vec4 oColor;
${FIELD_CORE}`;

const VERT_GL1 = `
attribute vec2 a_pos;
varying vec2 vUv;
void main() {
  vUv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const VERT_GL2 = `#version 300 es
in vec2 a_pos;
out vec2 vUv;
void main() {
  vUv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

type GLCtx = WebGL2RenderingContext | WebGLRenderingContext;

type FieldProgram = {
  program: WebGLProgram;
  buffer: WebGLBuffer;
  texture: WebGLTexture;
  loc: {
    uField: WebGLUniformLocation | null;
    uGridSize: WebGLUniformLocation | null;
    uMid: WebGLUniformLocation | null;
    uCrest: WebGLUniformLocation | null;
    uTrough: WebGLUniformLocation | null;
    uCaustic: WebGLUniformLocation | null;
    uFoam: WebGLUniformLocation | null;
    uGlow: WebGLUniformLocation | null;
    uLens: WebGLUniformLocation | null;
    uNight: WebGLUniformLocation | null;
    uSunDir: WebGLUniformLocation | null;
    uTime: WebGLUniformLocation | null;
  };
};

function compileShader(gl: GLCtx, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.warn("waves field shader failed", gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

function buildFieldProgram(gl: GLCtx, isGL2: boolean): FieldProgram | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, isGL2 ? VERT_GL2 : VERT_GL1);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, isGL2 ? FRAG_GL2 : FRAG_GL1);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn("waves field program failed", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  const buffer = gl.createBuffer();
  const texture = gl.createTexture();
  if (!buffer || !texture) return null;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, "a_pos");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.useProgram(program);
  gl.enableVertexAttribArray(aPos);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  return {
    program,
    buffer,
    texture,
    loc: {
      uField: gl.getUniformLocation(program, "uField"),
      uGridSize: gl.getUniformLocation(program, "uGridSize"),
      uMid: gl.getUniformLocation(program, "uMid"),
      uCrest: gl.getUniformLocation(program, "uCrest"),
      uTrough: gl.getUniformLocation(program, "uTrough"),
      uCaustic: gl.getUniformLocation(program, "uCaustic"),
      uFoam: gl.getUniformLocation(program, "uFoam"),
      uGlow: gl.getUniformLocation(program, "uGlow"),
      uLens: gl.getUniformLocation(program, "uLens"),
      uNight: gl.getUniformLocation(program, "uNight"),
      uSunDir: gl.getUniformLocation(program, "uSunDir"),
      uTime: gl.getUniformLocation(program, "uTime"),
    },
  };
}

/** Pack the height field into a 16-bit fixed-point RG/LUMINANCE_ALPHA texture. */
function encodeField(a: Float32Array, out: Uint8Array): void {
  const inv = 65535 / (FIELD_RANGE * 2);
  for (let i = 0; i < a.length; i += 1) {
    let v = a[i];
    if (v < -FIELD_RANGE) v = -FIELD_RANGE;
    else if (v > FIELD_RANGE) v = FIELD_RANGE;
    const enc = Math.round((v + FIELD_RANGE) * inv);
    out[i * 2] = (enc >> 8) & 255;
    out[i * 2 + 1] = enc & 255;
  }
}

// Simulation state, allocated lazily on resize and never re-created per frame.
type Sim = {
  gw: number;
  gh: number;
  a: Float32Array; // current field u(t)
  b: Float32Array; // previous field u(t-1) / scratch for next
  speedFld: Float32Array; // per-cell speed multiplier (refraction)
  fieldEnc: Uint8Array; // packed height field, uploaded to the GPU each frame
  // 1D string
  sN: number;
  sa: Float32Array;
  sb: Float32Array;
  // offscreen grid raster — CPU fallback only, guarded not deleted
  grid: HTMLCanvasElement | null;
  gctx: CanvasRenderingContext2D | null;
  image: ImageData | null;
};

// A hand-raised wave train — the room's countable, create/deletable object
// (SPEC §3). Grows continuously while its dwell-hold is held, then radiates
// its own train every frame until stilled by a ceremony-hold.
type WaveSource = { id: number; nx: number; ny: number; strength: number; phase: number };

export default function Waves() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const simRef = useRef<Sim | null>(null);
  const pointerRef = useRef({ active: false, id: -1, x: 0.5, y: 0.5, lastTone: 0, moved: 0 });
  const reduceRef = useRef(false);

  const speedRef = useRef(0.34); // c^2 (Courant-stable below 0.5)
  const dampRef = useRef(0.006); // energy loss per step
  const dropRef = useRef(1.05); // impulse strength
  const runningRef = useRef(true);
  const modeRef = useRef<WaveMode>("ripple");
  const energyRef = useRef(0);
  const lastAmbient = useRef(0);
  const lastControlAt = useRef(0);

  const recordTape = useField((s) => s.recordTape);

  const [speed, setSpeed] = useState(0.34);
  const [damp, setDamp] = useState(0.006);
  const [drop, setDrop] = useState(1.05);
  const [running, setRunning] = useState(true);
  const [mode, setMode] = useState<WaveMode>("ripple");
  const [readout, setReadout] = useState("ripple · c 0.34 · still");
  // whether the pond still keeps anything (naturals or a raised source) —
  // gates the quiet clear (§8c)
  const letGoRef = useRef<() => void>(() => {});
  const [keptHere, setKeptHere] = useState(false);

  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { dampRef.current = damp; }, [damp]);
  useEffect(() => { dropRef.current = drop; }, [drop]);
  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduceRef.current = mq.matches;
    const update = () => { reduceRef.current = mq.matches; };
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  // Ambient audio bed: phasey stereo swell + soft clicks. Kept alongside
  // the /stars pattern so the pond is never acoustically dead on arrival.
  useEffect(() => {
    try { getFieldAudio().setAmbientProfile("waves"); } catch { /* noop */ }
  }, []);

  // ---- field helpers -------------------------------------------------------

  const clearFields = useCallback(() => {
    const sim = simRef.current;
    if (!sim) return;
    sim.a.fill(0);
    sim.b.fill(0);
    sim.sa.fill(0);
    sim.sb.fill(0);
    energyRef.current = 0;
  }, []);

  // Drop a smooth circular disturbance into the 2D field at normalized (nx,ny).
  const drop2D = useCallback((nx: number, ny: number, amp: number) => {
    const sim = simRef.current;
    if (!sim) return;
    const { gw, gh, a } = sim;
    const cx = clamp(nx, 0.02, 0.98) * gw;
    const cy = clamp(ny, 0.02, 0.98) * gh;
    const rad = Math.max(2.5, gw * 0.028);
    const sig2 = rad * rad * 0.5;
    const r0 = Math.ceil(rad * 2.4);
    const x0 = Math.max(1, Math.floor(cx - r0));
    const x1 = Math.min(gw - 2, Math.ceil(cx + r0));
    const y0 = Math.max(1, Math.floor(cy - r0));
    const y1 = Math.min(gh - 2, Math.ceil(cy + r0));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const dx = x - cx;
        const dy = y - cy;
        const g = Math.exp(-(dx * dx + dy * dy) / (2 * sig2));
        a[y * gw + x] += amp * g;
      }
    }
  }, []);

  // Pluck the 1D string: displace toward the pointer offset from the axis.
  const pluck1D = useCallback((nx: number, ny: number, amp: number) => {
    const sim = simRef.current;
    if (!sim) return;
    const { sN, sa } = sim;
    const c = clamp(nx, 0.03, 0.97) * (sN - 1);
    const rad = Math.max(3, sN * 0.05);
    const sig2 = rad * rad * 0.5;
    const target = (0.5 - ny) * amp; // above axis => positive
    const r0 = Math.ceil(rad * 2.6);
    const i0 = Math.max(1, Math.floor(c - r0));
    const i1 = Math.min(sN - 2, Math.ceil(c + r0));
    for (let i = i0; i <= i1; i += 1) {
      const d = i - c;
      const g = Math.exp(-(d * d) / (2 * sig2));
      sa[i] = mix(sa[i], target, g);
    }
  }, []);

  // ---- main loop -----------------------------------------------------------

  const disturb = useCallback((clientX: number, clientY: number, strength: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const nx = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    const ny = clamp((clientY - rect.top) / Math.max(1, rect.height), 0, 1);
    const pointer = pointerRef.current;
    pointer.moved += Math.hypot(nx - pointer.x, ny - pointer.y);
    pointer.x = nx;
    pointer.y = ny;

    const m = modeRef.current;
    const amp = dropRef.current * (0.5 + strength * 0.7);
    if (m === "string") pluck1D(nx, ny, amp);
    else drop2D(nx, ny, amp);

    const now = performance.now();
    if (now - pointer.lastTone > 82) {
      pointer.lastTone = now;
      const cfg = MODES.find((it) => it.id === m) ?? MODES[0];
      const speedShift = Math.round(speedRef.current * 12);
      const midi = cfg.midi + Math.round((1 - ny) * 24) + Math.round(nx * 5) + speedShift;
      try { getFieldAudio().playNote(midi, 90); } catch { /* noop */ }
      try { haptics.ripple(0.24 + strength * 0.3); } catch { /* noop */ }
      recordTape("ripple", clamp(0.32 + (1 - ny) * 0.4 + strength * 0.2, 0, 1), `waves/${m}`);
      setReadout(`${m} · c ${speedRef.current.toFixed(2)} · flowing`);
    }
  }, [drop2D, pluck1D, recordTape]);

  const markControl = useCallback((meta: string, intensity: number) => {
    const now = performance.now();
    if (now - lastControlAt.current < 100) return;
    lastControlAt.current = now;
    const cfg = MODES.find((it) => it.id === modeRef.current) ?? MODES[0];
    try { getFieldAudio().playNote(cfg.midi + 12 + Math.round(intensity * 20), 80); } catch { /* noop */ }
    try { haptics.tap(); } catch { /* noop */ }
    recordTape("sigil", 0.26 + intensity * 0.44, `waves/${meta}`);
  }, [recordTape]);


  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const glCanvas = glCanvasRef.current;
    if (!root || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let raf = 0;
    let last = performance.now();

    const buildSim = (w: number, h: number, detail: ReturnType<typeof detailForTier>) => {
      const aspect = w / Math.max(1, h);
      const target = Math.round(clamp(190 * (0.55 + 0.45 * detail.samples), 118, 210));
      let gw: number;
      let gh: number;
      if (aspect >= 1) {
        gw = target;
        gh = clamp(Math.round(target / aspect), 90, 220);
      } else {
        gh = target;
        gw = clamp(Math.round(target * aspect), 90, 220);
      }
      const n = gw * gh;
      const sN = clamp(Math.round((w / 3) * (0.6 + 0.4 * detail.samples)), 160, 640);
      const grid = document.createElement("canvas");
      grid.width = gw;
      grid.height = gh;
      const gctx = grid.getContext("2d");
      const image = gctx ? gctx.createImageData(gw, gh) : null;
      if (image) {
        // opaque alpha up front; RGB filled per frame
        for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
      }
      const speedFld = new Float32Array(n);
      for (let y = 0; y < gh; y += 1) {
        // slow band across the lower third bends fronts (refraction)
        const fy = y / gh;
        const s = 0.42 + 0.58 * (1 - clamp((fy - 0.3) / 0.6, 0, 1));
        for (let x = 0; x < gw; x += 1) speedFld[y * gw + x] = s;
      }
      simRef.current = {
        gw,
        gh,
        a: new Float32Array(n),
        b: new Float32Array(n),
        speedFld,
        fieldEnc: new Uint8Array(n * 2),
        sN,
        sa: new Float32Array(sN),
        sb: new Float32Array(sN),
        grid,
        gctx,
        image,
      };
    };

    const embedded = isEmbeddedFrame();
    const governor = createFrameGovernor(embedded ? "medium" : "high");
    let galleryPaused = false;
    let paused = document.hidden;
    const unvis = onVisibility((h) => { paused = h || galleryPaused; });
    const ungal = onGalleryPause((p) => { galleryPaused = p; paused = document.hidden || p; });

    // ── WebGL field renderer (ripple/refraction) ──────────────────────
    // WebGL2 first, WebGL1 fallback, and — if neither is available or the
    // context is later lost — the original CPU raster below still runs,
    // guarded rather than deleted (SPEC §1).
    const glOpts: WebGLContextAttributes = { antialias: false, premultipliedAlpha: false };
    let gl2: WebGL2RenderingContext | null = glCanvas
      ? (glCanvas.getContext("webgl2", glOpts) as WebGL2RenderingContext | null)
      : null;
    let gl1: WebGLRenderingContext | null = null;
    if (!gl2 && glCanvas) {
      gl1 = (glCanvas.getContext("webgl", glOpts) ||
        glCanvas.getContext("experimental-webgl" as "webgl", glOpts)) as WebGLRenderingContext | null;
    }
    const gl: GLCtx | null = gl2 ?? gl1;
    const isGL2 = !!gl2;
    let fieldProgram: FieldProgram | null = gl ? buildFieldProgram(gl, isGL2) : null;
    let glLost = false;
    const glActive = () => !!(gl && fieldProgram && !glLost);

    const onGlLost = (ev: Event) => {
      ev.preventDefault();
      glLost = true;
    };
    const onGlRestored = () => {
      glLost = false;
      if (gl) fieldProgram = buildFieldProgram(gl, isGL2);
      if (gl && fieldProgram && glCanvas) gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    };
    glCanvas?.addEventListener("webglcontextlost", onGlLost, false);
    glCanvas?.addEventListener("webglcontextrestored", onGlRestored, false);

    const resize = () => {
      const rect = root.getBoundingClientRect();
      const tier = governor.tier();
      const dpr = resolveDpr(tier, { embedded, reducedMotion: reduceRef.current });
      width = Math.max(320, Math.floor(rect.width));
      height = Math.max(480, Math.floor(rect.height));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (glCanvas) {
        glCanvas.width = canvas.width;
        glCanvas.height = canvas.height;
        glCanvas.style.width = `${width}px`;
        glCanvas.style.height = `${height}px`;
        if (gl && fieldProgram) gl.viewport(0, 0, glCanvas.width, glCanvas.height);
      }
      buildSim(width, height, detailForTier(tier));
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(root);
    window.addEventListener("resize", resize);

    // 2D finite-difference step. usesField => refraction speed gradient.
    const step2D = (sim: Sim, c2: number, dampFactor: number, usesField: boolean) => {
      const { gw, gh, a, b, speedFld } = sim;
      for (let y = 1; y < gh - 1; y += 1) {
        const row = y * gw;
        for (let x = 1; x < gw - 1; x += 1) {
          const i = row + x;
          const lap = a[i - 1] + a[i + 1] + a[i - gw] + a[i + gw] - 4 * a[i];
          const cc = usesField ? c2 * speedFld[i] : c2;
          b[i] = (2 * a[i] - b[i] + cc * lap) * dampFactor;
        }
      }
      // fixed edges (u=0) reflect the wavefronts back into the tank
      sim.a = b;
      sim.b = a;
    };

    const step1D = (sim: Sim, c2: number, dampFactor: number) => {
      const { sN, sa, sb } = sim;
      for (let i = 1; i < sN - 1; i += 1) {
        const lap = sa[i - 1] + sa[i + 1] - 2 * sa[i];
        sb[i] = (2 * sa[i] - sb[i] + c2 * lap) * dampFactor;
      }
      sim.sa = sb;
      sim.sb = sa;
    };

    // CPU fallback raster — the exact original per-pixel loop, only reached
    // when WebGL2/WebGL1 are both unavailable or the context has been lost.
    const renderFieldCPU = (sim: Sim, m: "ripple" | "refraction", glow: number) => {
      const { gw, gh, a, image, gctx, grid } = sim;
      if (!image || !gctx || !grid) return;
      const data = image.data;
      const pal = PALETTES[m];
      const [mr, mg, mb] = pal.mid;
      const [cr, cg, cb] = pal.crest;
      const [tr, tg, tb] = pal.trough;
      const [xr, xg, xb] = pal.caustic;
      const hScale = 2.3;
      const causScale = 3.6;
      for (let y = 0; y < gh; y += 1) {
        const row = y * gw;
        for (let x = 0; x < gw; x += 1) {
          const i = row + x;
          const h = a[i];
          const xl = x > 0 ? a[i - 1] : h;
          const xrr = x < gw - 1 ? a[i + 1] : h;
          const yt = y > 0 ? a[i - gw] : h;
          const yb = y < gh - 1 ? a[i + gw] : h;
          const sx = xrr - xl;
          const sy = yb - yt;
          const slope = Math.sqrt(sx * sx + sy * sy);
          const t = clamp(h * hScale, -1, 1);
          let r: number;
          let g: number;
          let bl: number;
          if (t >= 0) {
            r = mr + (cr - mr) * t;
            g = mg + (cg - mg) * t;
            bl = mb + (cb - mb) * t;
          } else {
            const f = -t;
            r = mr + (tr - mr) * f;
            g = mg + (tg - mg) * f;
            bl = mb + (tb - mb) * f;
          }
          let caus = clamp(slope * causScale, 0, 1);
          caus *= caus;
          const cg2 = caus * (0.55 + glow * 0.5);
          r += (xr - r) * cg2 * 0.9;
          g += (xg - g) * cg2 * 0.9;
          bl += (xb - bl) * cg2 * 0.9;
          const p = i * 4;
          data[p] = r;
          data[p + 1] = g;
          data[p + 2] = bl;
        }
      }
      gctx.putImageData(image, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(grid, 0, 0, gw, gh, 0, 0, width, height);
    };

    const renderString = (sim: Sim, tone: string, glow: number) => {
      const bg = ctx.createLinearGradient(0, 0, 0, height);
      bg.addColorStop(0, "#05070f");
      bg.addColorStop(0.5, "#0a1420");
      bg.addColorStop(1, "#080610");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      const { sN, sa } = sim;
      const center = height * 0.52;
      const amp = height * 0.26;
      const left = width * 0.06;
      const usable = width * 0.88;

      // axis
      ctx.save();
      ctx.strokeStyle = "rgba(238,234,219,0.10)";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 12]);
      ctx.beginPath();
      ctx.moveTo(left, center);
      ctx.lineTo(left + usable, center);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      const pathAt = (mult: number) => {
        ctx.beginPath();
        for (let i = 0; i < sN; i += 1) {
          const u = i / (sN - 1);
          const x = left + usable * u;
          const y = center - sa[i] * amp * mult;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      };

      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      // reflection halo
      ctx.strokeStyle = colorAlpha(tone, 0.16 + glow * 0.12);
      ctx.lineWidth = 9;
      pathAt(1);
      ctx.stroke();
      // core line
      ctx.strokeStyle = colorAlpha(tone, 0.95);
      ctx.lineWidth = 2.4;
      pathAt(1);
      ctx.stroke();
      ctx.restore();

      // endpoints (fixed nodes where reflection happens)
      for (const nx of [0, 1]) {
        const x = left + usable * nx;
        ctx.fillStyle = colorAlpha(tone, 0.8);
        ctx.beginPath();
        ctx.arc(x, center, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = colorAlpha(tone, 0.3);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, center, 10, 0, Math.PI * 2);
        ctx.stroke();
      }
    };

    // ── persistent naturals ─────────────────────────────────────────
    // Things the pond carries between visits: lily pads, fallen leaves,
    // and (rarely) a koi drifting under the surface. They advance their
    // position by elapsed real time on load (cap 12h) so the pond has
    // been *doing something* while the user was away. Nothing man-made.
    // Positions are normalized to survive resize.
    // Persistent pond life (from the shared world). Lily pads, fallen
    // leaves, and rare koi live in the shared pool (src/lib/world.ts) so a
    // leaf placed here can wash into /ocean over time. Rotation is derived
    // from seed at render time. These now arrive only through the pond's own
    // weather (a falling leaf, a surfacing koi) — the hand's create/delete
    // verb belongs to wave-train sources below (SPEC §3).
    type NaturalKind = Extract<WorldKind, "lily" | "leaf" | "koi">;
    const vxForKind = (kind: NaturalKind): number =>
      kind === "leaf" ? 0.024
      : kind === "koi" ? 0.014
      : 0.004;
    let naturals: WorldNatural[] = getNaturalsInZone("waves");
    const unsubscribeWorld = subscribeNaturals(() => {
      naturals = getNaturalsInZone("waves");
      refreshKept();
    });
    const addNatural = (kind: NaturalKind, nx?: number, ny?: number) => {
      const finalNx = nx != null ? clamp(nx, 0.04, 0.96) : Math.random();
      const finalNy = ny != null ? clamp(ny, 0.10, 0.94) : 0.2 + Math.random() * 0.7;
      const created = worldAddNatural(kind, "waves", finalNx, finalNy, vxForKind(kind));
      naturals = getNaturalsInZone("waves");
      refreshKept();
      return created;
    };
    const persistNaturals = () => {
      worldCommitZone("waves", naturals);
    };
    const idlePersist = createIdleWriter(() => { persistNaturals(); }, 500);

    // ── wave-train sources — the room's create/delete object (SPEC §3) ──
    // A dwell-hold on open water raises a new source: it gathers under the
    // finger immediately (a growing glow) and radiates its own concentric
    // train every frame, deepening the longer it's held. A ceremony-hold on
    // an existing source stills it — the touch-reachable delete. Persisted
    // to the room's own key, independent of the shared coast/pond naturals.
    const SOURCES_KEY = "objetdart:waves:sources:v1";
    const MAX_SOURCES = 6;
    let sourceIdCounter = 0;
    let sources: WaveSource[] = [];
    try {
      const raw = window.localStorage.getItem(SOURCES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (
              item && typeof item === "object" &&
              typeof (item as { nx?: unknown }).nx === "number" &&
              typeof (item as { ny?: unknown }).ny === "number" &&
              typeof (item as { strength?: unknown }).strength === "number"
            ) {
              sourceIdCounter += 1;
              const it = item as { nx: number; ny: number; strength: number };
              sources.push({
                id: sourceIdCounter,
                nx: clamp(it.nx, 0, 1),
                ny: clamp(it.ny, 0, 1),
                strength: clamp(it.strength, 0.1, 1),
                phase: Math.random(),
              });
            }
          }
          sources = sources.slice(-MAX_SOURCES);
        }
      }
    } catch { /* a fresh tank */ }
    const persistSourcesNow = () => {
      try {
        window.localStorage.setItem(
          SOURCES_KEY,
          JSON.stringify(sources.map((s) => ({ nx: s.nx, ny: s.ny, strength: s.strength }))),
        );
      } catch { /* quota; skip */ }
    };
    const idleSourcePersist = createIdleWriter(persistSourcesNow, 500);

    const refreshKept = () => setKeptHere(naturals.length > 0 || sources.length > 0);
    refreshKept();

    // the pond's parting (LetGo, §8c): this zone's naturals AND its raised
    // sources ride the downstream current out over a couple of breaths,
    // fading as they go; storage for both is written empty at once so
    // nothing floats back on reload.
    type Departing = WorldNatural & { bx: number };
    let departing: Departing[] = [];
    let departingSources: Array<{ nx: number; ny: number; strength: number }> = [];
    let letGoAt = 0;
    let letGoDur = 1800;
    const letGo = () => {
      if (naturals.length === 0 && sources.length === 0) return;
      departing = naturals.map((n) => ({ ...n, bx: n.nx }));
      departingSources = sources.map((s) => ({ nx: s.nx, ny: s.ny, strength: s.strength }));
      naturals = [];
      sources = [];
      letGoAt = performance.now();
      letGoDur = reduceRef.current ? 420 : 1800;
      worldCommitZone("waves", []);
      persistSourcesNow();
      try { getFieldAudio().thud(); } catch { /* noop */ }
      try { getFieldAudio().playNote(36, 520); } catch { /* noop */ }
      try { haptics.roll(); } catch { /* noop */ }
      useField.getState().recordTape("object", 0.3, "waves/letgo");
      refreshKept();
    };
    letGoRef.current = letGo;

    // ── weather events (autonomic, transient) ───────────────────────
    // Every 9-17s a jittered scheduler fires one of six natural events:
    // a falling leaf, a dragonfly hover, a wind gust, a frog jump, a
    // water strider crossing, or (rare) a koi surfacing. Pattern
    // borrowed from Stars.tsx cosmic weather / Ocean.tsx so the pond
    // feels like a place, not just an instrument. Only fires in ripple
    // mode — string and refraction stay analytic.
    type WeatherEvent =
      | { kind: "leaf"; t0: number; duration: number; startX: number; startY: number; endX: number; endY: number; rot0: number; spin: number; landed: boolean; nat: WorldNatural | null }
      | { kind: "dragonfly"; t0: number; duration: number; ax: number; ay: number; bx: number; by: number; lastDip: number }
      | { kind: "wind"; t0: number; duration: number; dir: number; band: number; lastEmit: number }
      | { kind: "frog"; t0: number; duration: number; x: number; y: number }
      | { kind: "strider"; t0: number; duration: number; ax: number; ay: number; bx: number; by: number; lastStep: number }
      | { kind: "koi"; t0: number; duration: number; x: number; y: number; dir: number; splashed: boolean; nat: WorldNatural | null };
    const weather: WeatherEvent[] = [];
    const addWeather = (e: WeatherEvent) => {
      weather.push(e);
      if (weather.length > 8) weather.shift();
    };

    const spawnFallingLeaf = () => {
      const startX = 0.1 + Math.random() * 0.8;
      const startY = -0.06;
      const endX = clamp(startX + (Math.random() - 0.5) * 0.35, 0.08, 0.92);
      const endY = 0.35 + Math.random() * 0.5;
      addWeather({
        kind: "leaf",
        t0: performance.now(),
        duration: 4.8 + Math.random() * 1.4,
        startX, startY, endX, endY,
        rot0: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 4,
        landed: false,
        nat: null,
      });
    };
    const spawnDragonfly = () => {
      const y = 0.15 + Math.random() * 0.7;
      const dir = Math.random() < 0.5 ? 1 : -1;
      addWeather({
        kind: "dragonfly",
        t0: performance.now(),
        duration: 6 + Math.random() * 2,
        ax: dir > 0 ? -0.05 : 1.05,
        ay: y,
        bx: dir > 0 ? 1.05 : -0.05,
        by: clamp(y + (Math.random() - 0.5) * 0.25, 0.1, 0.85),
        lastDip: 0,
      });
    };
    const spawnWindGust = () => {
      const dir = Math.random() < 0.5 ? 1 : -1;
      addWeather({
        kind: "wind",
        t0: performance.now(),
        duration: 4.0,
        dir,
        band: 0.2 + Math.random() * 0.6,
        lastEmit: 0,
      });
    };
    const spawnFrogJump = () => {
      const x = 0.12 + Math.random() * 0.76;
      const y = 0.15 + Math.random() * 0.7;
      drop2D(x, y, 2.4); // bigger than a tap
      addWeather({
        kind: "frog",
        t0: performance.now(),
        duration: 1.4,
        x, y,
      });
      // audio.ts has no bloop — chime is the friendliest fallback.
      try { getFieldAudio().playTone(140, 0.35); } catch { /* noop */ }
      try { getFieldAudio().chime(); } catch { /* noop */ }
    };
    const spawnStrider = () => {
      const y = 0.2 + Math.random() * 0.6;
      const dir = Math.random() < 0.5 ? 1 : -1;
      const arc = 0.22 + Math.random() * 0.18;
      addWeather({
        kind: "strider",
        t0: performance.now(),
        duration: 5.5,
        ax: dir > 0 ? 0.1 : 0.9,
        ay: y,
        bx: dir > 0 ? 0.1 + arc : 0.9 - arc,
        by: clamp(y + (Math.random() - 0.5) * 0.12, 0.15, 0.85),
        lastStep: 0,
      });
    };
    const spawnKoiSurface = () => {
      const x = 0.15 + Math.random() * 0.7;
      const y = 0.25 + Math.random() * 0.55;
      const dir = Math.random() < 0.5 ? 1 : -1;
      addWeather({
        kind: "koi",
        t0: performance.now(),
        duration: 3.6,
        x, y, dir,
        splashed: false,
        nat: null,
      });
      try { getFieldAudio().playTone(160, 0.5); } catch { /* noop */ }
    };

    let weatherTimer: ReturnType<typeof setTimeout> | 0 = 0;
    const fireWeather = () => {
      // Only stir the pond when the user is here and in ripple mode.
      // string / refraction stay untouched analytical instruments.
      if (!document.hidden && modeRef.current === "ripple" && runningRef.current) {
        const roll = Math.random();
        // weighted: leaf 25, dragonfly 22, wind 18, frog 16, strider 12, koi 7
        if (roll < 0.25) spawnFallingLeaf();
        else if (roll < 0.47) spawnDragonfly();
        else if (roll < 0.65) spawnWindGust();
        else if (roll < 0.81) spawnFrogJump();
        else if (roll < 0.93) spawnStrider();
        else spawnKoiSurface();
      }
      weatherTimer = setTimeout(fireWeather, 9000 + Math.random() * 8000);
    };
    weatherTimer = setTimeout(fireWeather, 3500 + Math.random() * 4000);

    // ── the law layer: lens, season, wind, night, gravity ────────────
    // Two-finger twist rotates the lens (surface → equation → felt swell,
    // clamped, persists until turned again). Three-finger twist advances the
    // season, which turns the sun. Three-finger drag pushes a real wind
    // vector that keeps driving the spectrum after release, decaying like
    // real air; vessel tilt adds a steady gravity-lean to the same vector.
    let lensPos = 0; // 0..2 continuous — surface / equation / felt
    let seasonPos = 0; // 0..1 wrapping — the sun's slow walk
    // deterministic double-tap-on-empty-water cycle: drop → gust → stone.
    // Advances one step per double tap, never Math.random.
    let doubleEmptyCycle = 0;
    let windDirX = 1;
    let windDirY = 0;
    let windStrength = 0;
    let windStrengthTarget = 0;
    let tiltTargetX = 0;
    let tiltTargetY = 0;
    let tiltBiasX = 0;
    let tiltBiasY = 0;
    let nightTarget = 0;
    let nightVal = 0;
    let lastWindEmitAt = 0;
    let lastWindToneAt2 = 0;
    let lastSeasonToneAt = 0;

    // ── gestures (the shared grammar — src/lib/gesture) ─────────────
    // One finger touches the water: taps and strokes disturb the field, a
    // dwell raises a wave-train source, the ceremony stills one. Two fingers
    // touch the map: twist rotates the lens (pinch and the two-finger tap's
    // step-back already belong to ScaleTravel on document.body, per SPEC).
    // Three fingers touch the law: a tap is tutti, a drag is wind, a hold
    // dilates time, a twist turns the season.
    const holdState: { targetSource: WaveSource | null; creatingId: number | null; stillingId: number | null } = {
      targetSource: null,
      creatingId: null,
      stillingId: null,
    };
    let timeScale = 1;
    let timeScaleTarget = 1;
    let stepAcc = 0;
    let entrainInterval = 3200;
    let entrainUntil = 0;
    let lastGestureAt = performance.now();
    let lastGlimmerAt = 0;
    let glimmerStep = 0;
    let lastWindFxAt = 0;
    let lastWindToneAt = 0;
    let lastScrubAt = 0;
    let lastSpanDriveAt = 0;
    let lastSpanToneAt = 0;
    const detachGestures = attachGestures(canvas, {
      tap: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers === 3) {
          // tutti — one synchronized pulse of everything alive in the tank
          energyRef.current = 1;
          if (modeRef.current === "string") {
            pluck1D(0.5, 0.5, 0.7);
          } else {
            drop2D(0.5, 0.18, 0.55);
            drop2D(0.22, 0.62, 0.42);
            drop2D(0.78, 0.62, 0.42);
            for (const s of sources) drop2D(s.nx, s.ny, 0.3 + s.strength * 0.5);
          }
          try { getFieldAudio().chime(); } catch { /* noop */ }
          try { haptics.ripple(0.7); } catch { /* noop */ }
          useField.getState().recordTape("sigil", 0.8, "waves/tutti");
          return;
        }
        if (e.fingers !== 1) return; // two-finger tap = step back, ScaleTravel's verb
        energyRef.current = Math.min(1, energyRef.current + 0.35);
        // the rapid-tap ladder, in wave physics: one drop, then a beating
        // pair, then a focusing ring, then the whole tank rings. On the
        // string the same rungs climb the harmonics instead.
        const rect = canvas.getBoundingClientRect();
        const nx = clamp((e.x - rect.left) / Math.max(1, rect.width), 0.02, 0.98);
        const ny = clamp((e.y - rect.top) / Math.max(1, rect.height), 0.02, 0.98);
        const trainTier = tapTrainTier(e.count);
        const trainDepth = tapTrainDepth(e.count);
        const cfg = MODES.find((it) => it.id === modeRef.current) ?? MODES[0];

        // double tap: on a raised source, splits it in two so the pair beats
        // as real independent emitters; on open water, cycles a deterministic
        // set of rarer disturbances — a drop, a gust-line, a dropped stone.
        if (e.count === 2) {
          if (modeRef.current === "string") {
            pluck1D(nx, ny, 0.55 + e.intensity * 0.35);
            pluck1D(clamp(nx + (nx < 0.5 ? 0.2 : -0.2), 0.05, 0.95), 0.5, 0.4);
            try { getFieldAudio().playNote(cfg.midi + 7, 220); } catch { /* noop */ }
            try { haptics.ripple(0.5); } catch { /* noop */ }
            return;
          }
          let nearest: WaveSource | null = null;
          let nearestD = 0.055;
          for (const s of sources) {
            const d = Math.hypot(s.nx - nx, s.ny - ny);
            if (d < nearestD) { nearestD = d; nearest = s; }
          }
          if (nearest && sources.length < MAX_SOURCES) {
            // split into two coherent emitters, a half-turn out of phase —
            // the pair now genuinely beats in the shared field rather than
            // ringing a single tone alone
            const halfStrength = Math.max(0.14, nearest.strength * 0.62);
            const ang = (((nearest.id * 2654435761) % 1000) / 1000) * Math.PI * 2;
            const off = 0.045 + trainDepth * 0.02;
            sourceIdCounter += 1;
            const twin: WaveSource = {
              id: sourceIdCounter,
              nx: clamp(nearest.nx + Math.cos(ang) * off, 0.04, 0.96),
              ny: clamp(nearest.ny + Math.sin(ang) * off, 0.06, 0.94),
              strength: halfStrength,
              phase: 0.5,
            };
            nearest.strength = halfStrength;
            nearest.phase = 0;
            sources.push(twin);
            drop2D(nearest.nx, nearest.ny, 0.45 + e.intensity * 0.3);
            drop2D(twin.nx, twin.ny, 0.45 + e.intensity * 0.3);
            try { getFieldAudio().chime(); } catch { /* noop */ }
            try { getFieldAudio().playTone(cfg.midi * 6 + 40, 0.22); } catch { /* noop */ }
            try { haptics.roll(); } catch { /* noop */ }
            useField.getState().recordTape("object", 0.75, "waves/split-source");
            idleSourcePersist.schedule();
            refreshKept();
            return;
          }
          // open water: cycle drop → gust-line → dropped stone, seeded by a
          // simple advancing counter (deterministic, not Math.random)
          const kind = doubleEmptyCycle % 3;
          doubleEmptyCycle += 1;
          if (kind === 0) {
            drop2D(nx, ny, 0.75 + e.intensity * 0.5);
            try { getFieldAudio().chime(); } catch { /* noop */ }
          } else if (kind === 1) {
            const ang = (((nx * 137 + ny * 971) % 1) + 1) % 1 * Math.PI * 2; // deterministic from tap position
            const ux = Math.cos(ang);
            const uy = Math.sin(ang);
            for (let k = -2; k <= 2; k += 1) {
              drop2D(
                clamp(nx + ux * k * 0.05, 0.03, 0.97),
                clamp(ny + uy * k * 0.05, 0.05, 0.95),
                0.22 + e.intensity * 0.2,
              );
            }
            try { getFieldAudio().playTone(96 + e.intensity * 40, 0.3); } catch { /* noop */ }
          } else {
            // a stone: a slow, heavy, wide trough that keeps settling
            drop2D(nx, ny, -(0.9 + e.intensity * 0.5));
            drop2D(nx, ny, 0.3 + e.intensity * 0.2);
            try { getFieldAudio().thud(); } catch { /* noop */ }
          }
          try { haptics.ripple(0.4 + trainDepth * 0.2); } catch { /* noop */ }
          useField.getState().recordTape("ripple", 0.55, `waves/double-${kind}`);
          return;
        }
        if (trainTier === "n") {
          // seven and more: the crescendo — a rain of drops round the hand,
          // wider and harder with every extra tap
          energyRef.current = 1;
          if (modeRef.current === "string") {
            pluck1D(nx, 0.5, 0.9 + trainDepth * 0.3);
            pluck1D(clamp(nx - 0.18, 0.05, 0.95), 0.5, 0.5);
            pluck1D(clamp(nx + 0.18, 0.05, 0.95), 0.5, 0.5);
          } else {
            for (let k = 0; k < 7; k++) {
              const a = (k / 7) * Math.PI * 2;
              const r = 0.15 + trainDepth * 0.08;
              drop2D(nx + Math.cos(a) * r, ny + Math.sin(a) * r, 0.55 + trainDepth * 0.4);
            }
            drop2D(nx, ny, 1.0 + trainDepth * 0.4);
          }
          try { getFieldAudio().bell(); } catch { /* noop */ }
          try { haptics.storm(); } catch { /* noop */ }
          useField.getState().recordTape("ripple", 0.9, "waves/crescendo");
          return;
        }
        if (trainTier === 5) {
          // five taps close a ring of drops: the fronts converge back
          // through the centre — a lens made of interference. The string's
          // fifth rung is the octave, plucked at the half.
          if (modeRef.current === "string") {
            pluck1D(nx, 0.5, 0.8);
            pluck1D(clamp(nx * 0.5, 0.05, 0.95), 0.5, 0.6);
          } else {
            for (let k = 0; k < 8; k++) {
              const a = (k / 8) * Math.PI * 2;
              drop2D(nx + Math.cos(a) * 0.12, ny + Math.sin(a) * 0.12, 0.5 + trainDepth * 0.3);
            }
          }
          try { getFieldAudio().chime(); } catch { /* noop */ }
          try { haptics.roll(); } catch { /* noop */ }
          useField.getState().recordTape("ripple", 0.8, "waves/focus");
          return;
        }
        if (trainTier === 3) {
          // triple tap: a rogue wave. Not a scripted third drop — the tank
          // is scanned for where its *existing* wavefronts already sum
          // constructively (real superposition, read straight out of the
          // finite-difference field), and the strike pours its energy in
          // there. Where the sea is already piling up, it now breaks.
          if (modeRef.current === "string") {
            const sim = simRef.current;
            let peak = 0;
            let peakAt = 0.5;
            if (sim) {
              for (let i = 2; i < sim.sN - 2; i += 1) {
                const h = Math.abs(sim.sa[i]);
                if (h > peak) { peak = h; peakAt = i / (sim.sN - 1); }
              }
            }
            pluck1D(nx, 0.5, 0.55 + e.intensity * 0.4);
            pluck1D(peakAt, 0.5, 0.5 + Math.min(1.4, peak * 2.2));
          } else {
            const sim = simRef.current;
            let bestX = nx;
            let bestY = ny;
            let bestH = sim ? Math.abs(sim.a[
              clamp(Math.round(ny * sim.gh), 0, sim.gh - 1) * sim.gw
              + clamp(Math.round(nx * sim.gw), 0, sim.gw - 1)
            ]) : 0;
            if (sim) {
              const { gw, gh, a } = sim;
              const ring = 24;
              for (let k = 0; k < ring; k += 1) {
                const ang = (k / ring) * Math.PI * 2;
                const px = clamp(nx + Math.cos(ang) * 0.16, 0.04, 0.96);
                const py = clamp(ny + Math.sin(ang) * 0.16, 0.06, 0.94);
                const gx = clamp(Math.round(px * gw), 0, gw - 1);
                const gy = clamp(Math.round(py * gh), 0, gh - 1);
                const h = Math.abs(a[gy * gw + gx]);
                if (h > bestH) { bestH = h; bestX = px; bestY = py; }
              }
            }
            // amplitude scales with how much constructive energy was
            // already sitting there, so the rogue wave is genuinely emergent
            const amp = (0.75 + e.intensity * 0.55) * (1 + Math.min(2.4, bestH * 3.4));
            drop2D(bestX, bestY, amp);
            drop2D(nx, ny, 0.4 + e.intensity * 0.3);
            const dx = bestX - 0.5;
            const dy = bestY - 0.5;
            const dl = Math.hypot(dx, dy) || 1;
            drop2D(
              clamp(bestX + (dx / dl) * 0.06, 0.03, 0.97),
              clamp(bestY + (dy / dl) * 0.06, 0.05, 0.95),
              amp * 0.45,
            );
          }
          energyRef.current = 1;
          try { getFieldAudio().bell(); } catch { /* noop */ }
          try { haptics.storm(); } catch { /* noop */ }
          useField.getState().recordTape("ripple", 0.85, "waves/rogue");
          return;
        }
        // tap intensity is the drop: amplitude rides the same 0..1, and the
        // train keeps deepening it between the rungs
        disturb(e.x, e.y, 0.35 + e.intensity * 0.9 + trainDepth * 0.3);
        try { haptics.tap(); } catch { /* noop */ }
      },
      drag: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers === 3) {
          if (e.phase === "end") {
            windStrengthTarget = Math.max(0, windStrengthTarget - 0.15);
            return;
          }
          // three fingers drag the law: a real wind vector that keeps
          // driving the spectrum (see the per-frame emitter below), not
          // just a momentary bar of plucks under the hand
          const speed = Math.hypot(e.vx, e.vy);
          if (speed > 0.02) {
            const inv = 1 / speed;
            windDirX = e.vx * inv;
            windDirY = e.vy * inv;
          }
          windStrengthTarget = clamp(windStrengthTarget + speed * 0.5, 0, 1);
          const rect = canvas.getBoundingClientRect();
          const nx = clamp((e.x - rect.left) / Math.max(1, rect.width), 0.02, 0.98);
          const ny = clamp((e.y - rect.top) / Math.max(1, rect.height), 0.05, 0.95);
          const nowMs = performance.now();
          if (modeRef.current === "string") {
            if (nowMs - lastWindFxAt > 90) {
              lastWindFxAt = nowMs;
              pluck1D(nx, 0.5 - clamp(e.vx, -1, 1) * 0.08, 0.3);
            }
          } else if (nowMs - lastWindFxAt > 80) {
            lastWindFxAt = nowMs;
            for (let r = -1; r <= 1; r++) {
              const y2 = ny + r * 0.03;
              if (y2 > 0 && y2 < 1) drop2D(nx, y2, 0.2);
            }
          }
          if (nowMs - lastWindToneAt > 420) {
            lastWindToneAt = nowMs;
            const cfg = MODES.find((it) => it.id === modeRef.current) ?? MODES[0];
            try { getFieldAudio().playNote(cfg.midi - 5, 200); } catch { /* noop */ }
            try { haptics.chop(); } catch { /* noop */ }
          }
          return;
        }
        if (e.fingers !== 1) return;
        if (e.phase === "start") {
          pointerRef.current.active = true;
          disturb(e.x, e.y, 0.6);
          return;
        }
        if (e.phase === "end") {
          pointerRef.current.active = false;
          return;
        }
        disturb(e.x, e.y, clamp(0.5 + Math.hypot(e.vx, e.vy) * 0.45, 0.5, 1.15));
      },
      hold: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers === 3) {
          // three fingers hold the law: the medium slows while held, and
          // keeps slowing — deeper at 2400ms than at 900ms, never a switch
          if (e.phase === "enter") {
            try { getFieldAudio().playNote(36, 260); } catch { /* noop */ }
            try { haptics.tap(); } catch { /* noop */ }
          }
          if (e.phase === "release") timeScaleTarget = 1;
          else timeScaleTarget = 1 - 0.78 * Math.min(1, e.elapsed / 2400);
          return;
        }
        if (e.fingers !== 1) return;
        if (e.phase === "enter") {
          holdState.creatingId = null;
          holdState.stillingId = null;
          holdState.targetSource = null;
          pointerRef.current.active = true;
          if (modeRef.current === "ripple") {
            const rect = canvas.getBoundingClientRect();
            const nx = (e.x - rect.left) / Math.max(1, rect.width);
            const ny = (e.y - rect.top) / Math.max(1, rect.height);
            let best: WaveSource | null = null;
            let bestD = 0.06;
            for (const s of sources) {
              const d = Math.hypot(s.nx - nx, s.ny - ny);
              if (d < bestD) { bestD = d; best = s; }
            }
            holdState.targetSource = best;
          }
          return;
        }
        if (e.phase === "release") {
          pointerRef.current.active = false;
          if (holdState.creatingId != null || holdState.stillingId != null) idleSourcePersist.schedule();
          return;
        }
        if (modeRef.current !== "ripple") return; // the analytic media absorb the dwell
        const rect = canvas.getBoundingClientRect();
        const nx = clamp((e.x - rect.left) / Math.max(1, rect.width), 0.03, 0.97);
        const ny = clamp((e.y - rect.top) / Math.max(1, rect.height), 0.06, 0.94);

        if (holdState.targetSource) {
          // holding on an existing source: the ceremony stills it —
          // the touch-reachable delete
          if (e.tier >= 3 && holdState.stillingId == null) {
            const target = holdState.targetSource;
            holdState.stillingId = target.id;
            sources = sources.filter((s) => s.id !== target.id);
            drop2D(target.nx, target.ny, -0.6); // a settling trough, not a strike
            try { getFieldAudio().thud(); } catch { /* noop */ }
            try { haptics.bloom(); } catch { /* noop */ }
            useField.getState().recordTape("concern", 0.6, "waves/still");
            refreshKept();
          }
          return;
        }

        // dwell: a source gathers under the finger, legible immediately —
        // it starts radiating the moment the tier is crossed, and holding
        // longer deepens it (bigger, further-reaching train), continuous.
        if (e.tier >= 2 && holdState.creatingId == null && sources.length < MAX_SOURCES) {
          sourceIdCounter += 1;
          const id = sourceIdCounter;
          sources.push({ id, nx, ny, strength: 0.16, phase: 0 });
          holdState.creatingId = id;
          drop2D(nx, ny, 0.5);
          try { getFieldAudio().chime(); } catch { /* noop */ }
          try { haptics.ripple(0.5); } catch { /* noop */ }
          useField.getState().recordTape("ripple", 0.6, "waves/source");
          refreshKept();
        }
        if (holdState.creatingId != null) {
          const src = sources.find((s) => s.id === holdState.creatingId);
          if (src) {
            const growT = clamp((e.elapsed - THRESHOLDS.dwellMs) / 2200, 0, 1);
            src.strength = 0.16 + growT * 0.84;
          }
        }
      },
      twist: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers === 3) {
          // three fingers turn the season — the sun's slow walk
          if (e.phase === "move") {
            seasonPos = ((seasonPos + e.angle / (Math.PI * 2)) % 1 + 1) % 1;
            const nowMs = performance.now();
            if (nowMs - lastSeasonToneAt > 260) {
              lastSeasonToneAt = nowMs;
              try { getFieldAudio().playTone(120 + seasonPos * 220, 0.12); } catch { /* noop */ }
              try { haptics.lens(); } catch { /* noop */ }
            }
          }
          return;
        }
        // guard: three-finger twist is the season, above — never re-read here
        if (e.fingers !== 2) return;
        // two fingers rotate the lens: the water surface → the wave
        // equation → the felt swell — a natural ladder, persists until
        // turned again
        if (e.phase === "move") {
          const prevStation = Math.floor(lensPos);
          lensPos = clamp(lensPos + e.angle / (Math.PI * 0.5), 0, 2);
          if (Math.floor(lensPos) !== prevStation) {
            try { haptics.lens(); } catch { /* noop */ }
            try { getFieldAudio().chime(); } catch { /* noop */ }
            useField.getState().recordTape("sigil", 0.5, "waves/lens");
          }
        }
      },
      scrub: (e) => {
        lastGestureAt = performance.now();
        if (modeRef.current === "string") return;
        const nowMs = performance.now();
        if (nowMs - lastScrubAt < 700) return;
        lastScrubAt = nowMs;
        const rect = canvas.getBoundingClientRect();
        const cx = (e.cx - rect.left) / Math.max(1, rect.width);
        const cy = (e.cy - rect.top) / Math.max(1, rect.height);
        const sgn = Math.sign(e.winding) || 1;
        // stir: a ring of displacements interferes into a turning current,
        // and nearby floaters ride the gyre
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          const rx = cx + Math.cos(a) * 0.05;
          const ry = cy + Math.sin(a) * 0.05;
          if (rx > 0 && rx < 1 && ry > 0 && ry < 1) drop2D(rx, ry, 0.32);
        }
        for (const n of naturals) {
          const d = Math.hypot(n.nx - cx, n.ny - cy);
          if (d < 0.2) n.nx = clamp(n.nx + sgn * 0.02 * (1 - d / 0.2), 0.02, 0.98);
        }
        const cfg = MODES.find((it) => it.id === modeRef.current) ?? MODES[0];
        try { getFieldAudio().playNote(cfg.midi + 7, 150); } catch { /* noop */ }
        try { haptics.ripple(0.35); } catch { /* noop */ }
      },
      rhythm: (e) => {
        // a steady tapped pulse: the pond's ambient life falls in with it
        if (e.stability <= 0.7) return;
        entrainInterval = Math.max(500, Math.min(2400, 60000 / e.bpm));
        entrainUntil = performance.now() + 9000;
      },
      span: (e) => {
        // the sustained interval: two still fingers pin a beating pair — twin
        // sources driven together whose interference stands between the
        // fingertips, fringe spacing set by the spread. Holding longer drives
        // it deeper; the pair falls silent the moment the interval closes.
        lastGestureAt = performance.now();
        const rect = canvas.getBoundingClientRect();
        const ax = clamp((e.ax - rect.left) / Math.max(1, rect.width), 0.02, 0.98);
        const ay = clamp((e.ay - rect.top) / Math.max(1, rect.height), 0.02, 0.98);
        const bx = clamp((e.bx - rect.left) / Math.max(1, rect.width), 0.02, 0.98);
        const by = clamp((e.by - rect.top) / Math.max(1, rect.height), 0.02, 0.98);
        const depth = Math.min(1, e.elapsed / 6000); // sustain keeps deepening
        const nowMs = performance.now();
        if (e.phase === "release") {
          // the interval closes: one settling trough at each source
          if (modeRef.current !== "string") {
            drop2D(ax, ay, -0.3 - depth * 0.3);
            drop2D(bx, by, -0.3 - depth * 0.3);
          }
          try { haptics.ripple(0.25 + depth * 0.35); } catch { /* noop */ }
          useField.getState().recordTape("ripple", 0.4 + depth * 0.4, "waves/span");
          return;
        }
        if (e.phase === "enter") {
          energyRef.current = Math.min(1, energyRef.current + 0.25);
          try { haptics.tap(); } catch { /* noop */ }
        }
        // drive the pair in phase — every other tick keeps the integrator calm
        if (nowMs - lastSpanDriveAt < 140) return;
        lastSpanDriveAt = nowMs;
        const amp = 0.14 + depth * 0.3;
        if (modeRef.current === "string") {
          // a double stop: both positions sound together, the interval theirs
          pluck1D(ax, 0.5, amp);
          pluck1D(bx, 0.5, amp * 0.9);
        } else {
          drop2D(ax, ay, amp);
          drop2D(bx, by, amp);
        }
        if (nowMs - lastSpanToneAt > 900) {
          lastSpanToneAt = nowMs;
          // the audible interval widens with the spread and settles with depth
          const cfg = MODES.find((it) => it.id === modeRef.current) ?? MODES[0];
          const step = Math.round(3 + clamp(e.spread / Math.max(1, rect.width), 0, 1) * 9);
          try {
            getFieldAudio().playNote(cfg.midi, 220 + depth * 260);
            getFieldAudio().playNote(cfg.midi + step, 220 + depth * 260);
          } catch { /* noop */ }
          try { haptics.ripple(0.2 + depth * 0.3); } catch { /* noop */ }
        }
      },
    }, { wheelZoom: false });

    // ── the vessel (lib/vessel): tilt/shake/knock/flip ───────────────
    // Passive subscription — nothing flows until the candle has granted the
    // senses. Tilt leans gravity into the same wind vector three-finger drag
    // pushes; a shake agitates a scatter of chop across the tank; a knock on
    // the case rings a strike through the centre of the surface; a flip puts
    // the pond to sleep under moonlight.
    const detachVessel = onVessel({
      tilt: ({ beta, gamma }) => {
        if (reduceRef.current) return;
        tiltTargetX = clamp(gamma / 45, -1, 1);
        tiltTargetY = clamp((beta - 45) / 45, -1, 1);
      },
      shake: ({ intensity }) => {
        lastGestureAt = performance.now();
        const n = 4 + Math.round(intensity * 8);
        for (let i = 0; i < n; i += 1) drop2D(Math.random(), Math.random(), 0.14 + intensity * 0.32);
        energyRef.current = Math.min(1, energyRef.current + intensity * 0.5);
        try { getFieldAudio().thud(); } catch { /* noop */ }
        try { haptics.storm(); } catch { /* noop */ }
        useField.getState().recordTape("ripple", 0.5 + intensity * 0.4, "waves/shake");
      },
      knock: ({ intensity }) => {
        lastGestureAt = performance.now();
        drop2D(0.5, 0.5, 1.3 + intensity * 1.7);
        try { getFieldAudio().bell(); } catch { /* noop */ }
        try { haptics.roll(); } catch { /* noop */ }
        useField.getState().recordTape("sigil", 0.6 + intensity * 0.4, "waves/knock");
      },
      flip: ({ faceDown }) => {
        lastGestureAt = performance.now();
        nightTarget = faceDown ? 1 : 0;
        try { haptics.tap(); } catch { /* noop */ }
        useField.getState().recordTape("sigil", 0.3, faceDown ? "waves/night" : "waves/day");
      },
    });

    // ── backdrop & natural rendering helpers ────────────────────────
    // Paint a soft horizon mist across the top so the pond reads as a place
    // with a far shore instead of just a top-down grid. (The full-canvas sky
    // gradient the CPU raster used to cover before the field painted over it
    // is gone — the field always covers the frame now, GL or CPU, so it was
    // never visible; this keeps only the part that was.)
    const drawHorizon = (w: number, h: number) => {
      const horizonY = h * 0.14;
      const mist = ctx.createLinearGradient(0, 0, 0, horizonY + 42);
      mist.addColorStop(0.0, "rgba(226, 214, 186, 0.86)");
      mist.addColorStop(0.7, "rgba(180, 174, 164, 0.28)");
      mist.addColorStop(1.0, "rgba(180, 174, 164, 0.0)");
      ctx.fillStyle = mist;
      ctx.fillRect(0, 0, w, horizonY + 42);
      // a barely-there horizon line
      ctx.strokeStyle = "rgba(232, 220, 194, 0.28)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, horizonY);
      ctx.lineTo(w, horizonY);
      ctx.stroke();
    };

    // Wave-train source glows: fixed colour each, only alpha and radius vary
    // per source per frame — one normalized sprite per colour, baked once
    // through the shared radial-sprite cache, stamped and scaled instead of
    // a fresh gradient per source per frame.
    const creatingGlowSprite = bakeRadialSprite("waves-creating-glow", {
      width: 128,
      height: 128,
      stops: [
        { offset: 0, color: "rgba(255,246,220,1)" },
        { offset: 1, color: "rgba(255,246,220,0)" },
      ],
    });
    const departingGlowSprite = bakeRadialSprite("waves-departing-glow", {
      width: 128,
      height: 128,
      stops: [
        { offset: 0, color: "rgba(255,244,214,1)" },
        { offset: 1, color: "rgba(255,244,214,0)" },
      ],
    });

    let lastNaturalsSaveAt = performance.now();
    let prevDrawSec = performance.now() / 1000;

    const draw = (now: number) => {
      if (paused) {
        governor.force("sleep");
        raf = window.setTimeout(() => { raf = requestAnimationFrame(draw); }, 200) as unknown as number;
        return;
      }
      governor.beginFrame(now);
      last = now;
      const sim = simRef.current;
      if (!sim) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const reduce = reduceRef.current;
      const m = modeRef.current;
      const cfg = MODES.find((it) => it.id === m) ?? MODES[0];
      const isRunning = runningRef.current;
      const c2 = speedRef.current;
      const dampFactor = 1 - dampRef.current;
      const pointer = pointerRef.current;
      const detail = detailForTier(governor.tier());

      energyRef.current = mix(energyRef.current, pointer.active ? 1 : 0, pointer.active ? 0.14 : 0.03);
      const glow = energyRef.current;

      // sparse ambient life so the medium is never dead (not when reduced)
      const ambientEvery = performance.now() < entrainUntil ? entrainInterval : 3200;
      if (isRunning && !reduce && !pointer.active && now - lastAmbient.current > ambientEvery) {
        lastAmbient.current = now;
        if (m === "string") pluck1D(0.2 + Math.random() * 0.6, 0.5 - (Math.random() * 0.16 + 0.05), 0.35);
        else drop2D(Math.random(), Math.random() * 0.9 + 0.05, 0.35);
      }

      const nowSec = now / 1000;
      const dt = Math.min(0.06, Math.max(0, nowSec - prevDrawSec));
      prevDrawSec = nowSec;

      // ── the law layer: wind (3-finger drag) + gravity (vessel tilt)
      // continuously drive the spectrum; night (vessel flip) eases the
      // palette; sources radiate their own train ─────────────────────
      if (m !== "string") {
        windStrength += (windStrengthTarget - windStrength) * Math.min(1, dt * 3);
        windStrengthTarget = Math.max(0, windStrengthTarget - dt * 0.10);
        tiltBiasX += (tiltTargetX - tiltBiasX) * Math.min(1, dt * 2);
        tiltBiasY += (tiltTargetY - tiltBiasY) * Math.min(1, dt * 2);
        const envX = windDirX * windStrength * 0.85 + tiltBiasX * 0.55;
        const envY = windDirY * windStrength * 0.85 + tiltBiasY * 0.55;
        const envMag = Math.min(1, Math.hypot(envX, envY));
        if (envMag > 0.05 && isRunning && !reduce) {
          const period = mix(640, 90, envMag);
          if (now - lastWindEmitAt > period) {
            lastWindEmitAt = now;
            const ux = envMag > 1e-4 ? envX / envMag : 1;
            const uy = envMag > 1e-4 ? envY / envMag : 0;
            for (let k = -2; k <= 2; k += 1) {
              const px = clamp(0.5 - ux * 0.44 + -uy * k * 0.07, 0.03, 0.97);
              const py = clamp(0.5 - uy * 0.44 + ux * k * 0.07, 0.05, 0.95);
              drop2D(px, py, 0.10 + envMag * 0.45);
            }
            if (now - lastWindToneAt2 > 480) {
              lastWindToneAt2 = now;
              try { getFieldAudio().playTone(72 + envMag * 60, 0.4); } catch { /* noop */ }
            }
          }
        }
        if (isRunning) {
          for (const s of sources) {
            const rate = mix(0.6, 2.4, s.strength);
            s.phase += dt * rate;
            if (s.phase >= 1) {
              s.phase -= Math.floor(s.phase);
              drop2D(s.nx, s.ny, 0.22 + s.strength * 0.5);
            }
          }
        }
      }
      nightVal += (nightTarget - nightVal) * Math.min(1, dt * 0.5);

      // ── tick weather (may inject displacement into the sim BEFORE
      //    the step, so the ripples read at the current frame) ───────
      if (m === "ripple") {
        for (let i = weather.length - 1; i >= 0; i--) {
          const e = weather[i];
          const age = (now - e.t0) / 1000;
          if (age >= e.duration) { weather.splice(i, 1); continue; }
          if (e.kind === "leaf") {
            const f = clamp(age / e.duration, 0, 1);
            if (!e.landed && f > 0.92) {
              e.landed = true;
              // touch-down pluck + persistent leaf at landing spot
              drop2D(e.endX, e.endY, 1.4);
              e.nat = addNatural("leaf", e.endX, e.endY);
              try { getFieldAudio().playTone(220, 0.28); } catch { /* noop */ }
            }
          } else if (e.kind === "dragonfly") {
            // dip every 900-1400ms while crossing
            if (age - e.lastDip > 0.9 + Math.random() * 0.5) {
              e.lastDip = age;
              const f = clamp(age / e.duration, 0, 1);
              const dx = e.ax + (e.bx - e.ax) * f;
              const dy = e.ay + (e.by - e.ay) * f + Math.sin(age * 3) * 0.02;
              if (dx > 0 && dx < 1 && dy > 0 && dy < 1) drop2D(dx, dy, 0.28);
            }
          } else if (e.kind === "wind") {
            // step a bar of tiny pluck sources across the field
            const f = clamp(age / e.duration, 0, 1);
            const xLead = e.dir > 0 ? f : 1 - f;
            if (age - e.lastEmit > 0.08) {
              e.lastEmit = age;
              const rows = 3;
              for (let r0 = 0; r0 < rows; r0++) {
                const y = e.band + (r0 - 1) * 0.03;
                if (y > 0 && y < 1) drop2D(clamp(xLead, 0.02, 0.98), y, 0.18);
              }
            }
          } else if (e.kind === "koi") {
            const f = clamp(age / e.duration, 0, 1);
            if (!e.splashed && f > 0.35 && f < 0.42) {
              e.splashed = true;
              drop2D(e.x, e.y, 1.6);
              e.nat = addNatural("koi", e.x, e.y);
              try { getFieldAudio().playTone(120, 0.4); } catch { /* noop */ }
            }
          }
          // strider intentionally leaves NO ripples — only visible dimples
        }
      }

      // three-finger time dilation: fractional substeps accumulate so the
      // medium itself runs slow while the law is held. Substep rate is
      // scaled by the frame governor's tier, per SPEC §4.
      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dt * 5);
      const simRate = detail.simHz / 60;
      stepAcc += (isRunning ? (reduce ? 1 : 2) : 0) * timeScale * simRate;
      const substeps = Math.floor(stepAcc);
      stepAcc -= substeps;
      for (let s = 0; s < substeps; s += 1) {
        if (m === "string") step1D(sim, c2, dampFactor);
        else step2D(sim, c2, dampFactor, m === "refraction");
      }

      if (m === "string") {
        renderString(sim, cfg.tone, glow);
      } else {
        const pal = PALETTES[m];
        if (glActive() && gl && fieldProgram) {
          encodeField(sim.a, sim.fieldEnc);
          gl.bindTexture(gl.TEXTURE_2D, fieldProgram.texture);
          if (isGL2 && gl2) {
            gl2.texImage2D(gl2.TEXTURE_2D, 0, gl2.RG8, sim.gw, sim.gh, 0, gl2.RG, gl2.UNSIGNED_BYTE, sim.fieldEnc);
          } else if (gl1) {
            gl1.texImage2D(gl1.TEXTURE_2D, 0, gl1.LUMINANCE_ALPHA, sim.gw, sim.gh, 0, gl1.LUMINANCE_ALPHA, gl1.UNSIGNED_BYTE, sim.fieldEnc);
          }
          const palMid = mixColor(pal.mid, NIGHT_TINT.mid, nightVal);
          const palCrest = mixColor(pal.crest, NIGHT_TINT.crest, nightVal);
          const palTrough = mixColor(pal.trough, NIGHT_TINT.trough, nightVal);
          const palCaustic = mixColor(pal.caustic, NIGHT_TINT.caustic, nightVal);
          const palFoam = mixColor(pal.foam, NIGHT_TINT.foam, nightVal);
          const sunAngle = seasonPos * Math.PI * 2;
          const sunDirX = Math.cos(sunAngle) * 0.65;
          const sunDirY = Math.sin(sunAngle) * 0.35 - 0.15;

          gl.activeTexture(gl.TEXTURE0);
          gl.uniform1i(fieldProgram.loc.uField, 0);
          gl.uniform2f(fieldProgram.loc.uGridSize, sim.gw, sim.gh);
          gl.uniform3f(fieldProgram.loc.uMid, palMid[0] / 255, palMid[1] / 255, palMid[2] / 255);
          gl.uniform3f(fieldProgram.loc.uCrest, palCrest[0] / 255, palCrest[1] / 255, palCrest[2] / 255);
          gl.uniform3f(fieldProgram.loc.uTrough, palTrough[0] / 255, palTrough[1] / 255, palTrough[2] / 255);
          gl.uniform3f(fieldProgram.loc.uCaustic, palCaustic[0] / 255, palCaustic[1] / 255, palCaustic[2] / 255);
          gl.uniform3f(fieldProgram.loc.uFoam, palFoam[0] / 255, palFoam[1] / 255, palFoam[2] / 255);
          gl.uniform1f(fieldProgram.loc.uGlow, glow);
          gl.uniform1f(fieldProgram.loc.uLens, lensPos);
          gl.uniform1f(fieldProgram.loc.uNight, nightVal);
          gl.uniform2f(fieldProgram.loc.uSunDir, sunDirX, sunDirY);
          gl.uniform1f(fieldProgram.loc.uTime, nowSec);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          ctx.clearRect(0, 0, width, height);
        } else {
          // no WebGL2/WebGL1, or the context was lost — the original CPU
          // raster, guarded rather than deleted (SPEC §1)
          renderFieldCPU(sim, m, glow);
        }
        if (m === "ripple") {
          drawHorizon(width, height);
          // drift + draw persistent naturals on the pond
          if (naturals.length > 0) {
            for (const n of naturals) {
              if (dt > 0) {
                let nx = n.nx + n.vx * (dt / 3600);
                nx = ((nx % 1) + 1) % 1;
                n.nx = nx;
              }
              const sx = n.nx * width;
              const sy = n.ny * height;
              const bob = Math.sin(nowSec * 1.2 + n.seed * 0.001) * 1.4;
              // rot derived from seed (WorldNatural has no rot field —
              // deterministic from seed keeps each leaf's cant stable
              // across reloads without persisting the extra number).
              const rot = ((n.seed % 6283) / 1000);
              if (n.kind === "lily") drawLilyPad(ctx, sx, sy + bob, 18 + (n.seed & 15), n.seed);
              else if (n.kind === "leaf") drawFallenLeaf(ctx, sx, sy + bob, 10 + (n.seed & 7), rot + nowSec * 0.05, n.seed);
              else if (n.kind === "koi") drawKoiShadow(ctx, sx, sy, 28 + (n.seed & 15), nowSec, n.seed);
            }
          }
          // the letting go: departing pond life and departing sources ride
          // the downstream current out, fading as the water takes them back.
          if (departing.length > 0 || departingSources.length > 0) {
            const u = (now - letGoAt) / letGoDur;
            if (u >= 1) {
              departing = [];
              departingSources = [];
            } else {
              ctx.save();
              ctx.globalAlpha = 1 - u;
              for (const d of departing) {
                d.nx = (((d.bx + u * u * 0.2) % 1) + 1) % 1;
                const sx = d.nx * width;
                const sy = d.ny * height;
                const bob = Math.sin(nowSec * 1.2 + d.seed * 0.001) * 1.4;
                const rot = ((d.seed % 6283) / 1000);
                if (d.kind === "lily") drawLilyPad(ctx, sx, sy + bob, 18 + (d.seed & 15), d.seed);
                else if (d.kind === "leaf") drawFallenLeaf(ctx, sx, sy + bob, 10 + (d.seed & 7), rot + nowSec * 0.05, d.seed);
                else if (d.kind === "koi") drawKoiShadow(ctx, sx, sy, 28 + (d.seed & 15), nowSec, d.seed);
              }
              for (const s of departingSources) {
                const sx = s.nx * width;
                const sy = s.ny * height;
                const r = 10 + s.strength * 34;
                drawRadialStamp(ctx, departingGlowSprite, sx, sy, r, 0.3 + s.strength * 0.3);
              }
              ctx.restore();
            }
          }
          // draw weather overlays after the naturals so they read on top
          drawWeatherOverlay(ctx, weather, now, nowSec, width, height);
          // active wave-train sources — the gathering glow that makes the
          // create verb legible while it happens
          if (sources.length > 0) {
            for (const s of sources) {
              const sx = s.nx * width;
              const sy = s.ny * height;
              const r = 9 + s.strength * 30;
              const pulse = 0.5 + 0.5 * Math.sin(nowSec * 3.2 + s.id);
              drawRadialStamp(ctx, creatingGlowSprite, sx, sy, r, 0.16 + s.strength * 0.26 + pulse * 0.06);
            }
          }
          // glimmer (§6): after ~20s of quiet the water itself sketches a
          // small circle of dimples where a scrub would land — never text.
          if (isRunning && performance.now() - lastGestureAt > 20000 && now - lastGlimmerAt > 2600) {
            lastGlimmerAt = now;
            const slot = Math.floor(now / 9000);
            const g1 = Math.abs(Math.sin(slot * 127.1) * 43758.5453) % 1;
            const g2 = Math.abs(Math.sin(slot * 311.7) * 43758.5453) % 1;
            const gx = 0.2 + g1 * 0.6;
            const gy = 0.25 + g2 * 0.5;
            glimmerStep = (glimmerStep + 1) % 6;
            const ga = (glimmerStep / 6) * Math.PI * 2;
            drop2D(gx + Math.cos(ga) * 0.045, gy + Math.sin(ga) * 0.045, 0.1);
          }
        }
        if (m === "refraction") {
          // faint marker of the slow medium boundary
          const gy = height * 0.6;
          const grad = ctx.createLinearGradient(0, gy - 40, 0, gy + 40);
          grad.addColorStop(0, "rgba(0,0,0,0)");
          grad.addColorStop(0.5, colorAlpha(cfg.tone, 0.05));
          grad.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = grad;
          ctx.fillRect(0, gy - 40, width, 80);
        }
      }

      // vignette — the stops are constant, only width/height (resize-time,
      // not per-frame) select the bake, so this is a Map lookup on every
      // frame that isn't a resize.
      const vignetteSprite = bakeRadialSprite(`waves-vignette:${Math.round(width)}x${Math.round(height)}`, {
        width,
        height,
        inner: { x: width * 0.5, y: height * 0.5, r: Math.min(width, height) * 0.3 },
        outer: { x: width * 0.5, y: height * 0.5, r: Math.max(width, height) * 0.72 },
        stops: [
          { offset: 0, color: "rgba(0,0,0,0)" },
          { offset: 1, color: "rgba(0,0,0,0.42)" },
        ],
      });
      if (vignetteSprite) ctx.drawImage(vignetteSprite, 0, 0, width, height);

      // periodic persistence — visible drift/growth is applied per frame,
      // this makes sure the mutations get written before unmount races.
      if ((naturals.length > 0 || sources.length > 0) && now - lastNaturalsSaveAt > 4000) {
        lastNaturalsSaveAt = now;
        idlePersist.schedule();
        idleSourcePersist.schedule();
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      if (weatherTimer) clearTimeout(weatherTimer);
      // final checkpoint so re-entry advances drift from now.
      idlePersist.flush();
      idleSourcePersist.flush();
      unvis();
      ungal();
      unsubscribeWorld();
      observer.disconnect();
      window.removeEventListener("resize", resize);
      detachGestures();
      detachVessel();
      glCanvas?.removeEventListener("webglcontextlost", onGlLost);
      glCanvas?.removeEventListener("webglcontextrestored", onGlRestored);
      if (gl && fieldProgram) {
        gl.deleteProgram(fieldProgram.program);
        gl.deleteBuffer(fieldProgram.buffer);
        gl.deleteTexture(fieldProgram.texture);
      }
    };
  }, [disturb, drop2D, pluck1D]);

  // ---- interaction ---------------------------------------------------------

  const setWaveMode = (next: WaveMode) => {
    if (next === modeRef.current) return;
    setMode(next);
    modeRef.current = next;
    clearFields();
    const cfg = MODES.find((it) => it.id === next) ?? MODES[0];
    setReadout(`${next} · c ${speedRef.current.toFixed(2)} · still`);
    try { getFieldAudio().playNote(cfg.midi + 12, 130); } catch { /* noop */ }
    try { haptics.roll(); } catch { /* noop */ }
    recordTape("object", 0.62, `waves/mode/${next}`);
  };

  const toggleRunning = () => {
    setRunning((v) => {
      const next = !v;
      runningRef.current = next;
      try {
        if (next) getFieldAudio().chime();
        else getFieldAudio().thud();
      } catch { /* noop */ }
      recordTape("sigil", next ? 0.7 : 0.4, next ? "waves/run" : "waves/still");
      return next;
    });
  };

  const stillTank = () => {
    clearFields();
    setReadout(`${modeRef.current} · c ${speedRef.current.toFixed(2)} · still`);
    try { getFieldAudio().thud(); } catch { /* noop */ }
    try { haptics.chop(); } catch { /* noop */ }
    recordTape("concern", 0.5, "waves/still");
  };

  const activeTone = (MODES.find((it) => it.id === mode) ?? MODES[0]).tone;

  return (
    <div
      ref={rootRef}
      className="waves-instrument"
      data-touch-surface="true"
      data-pretext-ignore="true"
      style={{ "--wave-tone": activeTone } as CSSProperties}
    >
      <canvas ref={glCanvasRef} className="waves-canvas-gl" aria-hidden="true" />
      <canvas
        ref={canvasRef}
        className="waves-canvas"
        role="img"
        aria-label="A touch responsive wave propagation instrument. Touch to send travelling pulses that reflect and interfere."
      />

      <div className="waves-title" aria-hidden="true">
        <span>waves / travelling disturbance</span>
        <strong>Waves</strong>
      </div>

      <div className="waves-mode-rail" aria-label="wave media">
        {MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={mode === item.id}
            onClick={() => setWaveMode(item.id)}
            style={{ "--mode-tone": item.tone } as CSSProperties}
          >
            <i aria-hidden="true" />
            <span>
              <b>{item.label}</b>
              <em>{item.hint}</em>
            </span>
          </button>
        ))}
      </div>

      <label className="waves-mode-compact">
        <span>medium</span>
        <select
          aria-label="wave medium"
          value={mode}
          onChange={(event) => setWaveMode(event.target.value as WaveMode)}
        >
          {MODES.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
      </label>

      <span className="waves-play-hint" aria-hidden="true">tap or drag · rest to plant</span>

      <MobileInstrumentPanel
        className="waves-mobile-panel"
        title="propagation"
        triggerLabel="tune"
        summary={readout}
      >
        <div className="waves-console" aria-label="propagation controls">
          <button type="button" className="waves-btn" onClick={toggleRunning} aria-pressed={running}>
            {running ? "pause" : "play"}
          </button>
          <WaveSlider
            label="speed"
            min={0.14}
            max={0.5}
            step={0.01}
            value={speed}
            display={speed.toFixed(2)}
            onChange={(v) => { setSpeed(v); speedRef.current = v; markControl("speed", (v - 0.14) / 0.36); }}
          />
          <WaveSlider
            label="damp"
            min={0}
            max={0.03}
            step={0.001}
            value={damp}
            display={damp.toFixed(3)}
            onChange={(v) => { setDamp(v); dampRef.current = v; markControl("damp", v / 0.03); }}
          />
          <WaveSlider
            label="drop"
            min={0.3}
            max={2}
            step={0.05}
            value={drop}
            display={drop.toFixed(2)}
            onChange={(v) => { setDrop(v); dropRef.current = v; markControl("drop", (v - 0.3) / 1.7); }}
          />
          <button type="button" className="waves-btn" onClick={stillTank}>
            still
          </button>
          <output className="waves-readout" aria-live="polite" aria-label={`wave readout ${readout}`}>
            {readout}
          </output>
        </div>
      </MobileInstrumentPanel>

      <LetGo label="give back to the sea" onLetGo={() => letGoRef.current()} visible={keptHere} />

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .waves-instrument {
          position: fixed;
          inset: 0;
          overflow: hidden;
          min-height: 100svh;
          background: #04070d;
          color: rgba(246, 241, 224, 0.94);
          isolation: isolate;
          -webkit-user-select: none;
          user-select: none;
          -webkit-tap-highlight-color: transparent;
        }

        .waves-canvas-gl {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
          pointer-events: none;
        }

        .waves-canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
          touch-action: none;
          cursor: crosshair;
          z-index: 0;
        }

        .waves-title {
          position: fixed;
          z-index: 2;
          top: 78px;
          left: var(--pad-x);
          pointer-events: none;
        }

        .waves-title span {
          display: block;
          margin-bottom: 8px;
          color: rgba(246, 241, 224, 0.48);
          font-family: var(--font-mono);
          font-size: 11px;
          line-height: 1;
          text-transform: lowercase;
        }

        .waves-title strong {
          display: block;
          color: rgba(248, 244, 224, 0.96);
          font-family: var(--font-serif);
          font-size: 136px;
          font-weight: 500;
          line-height: 0.86;
          text-shadow: 0 0 44px color-mix(in srgb, var(--wave-tone) 30%, transparent);
        }

        .waves-mode-rail {
          position: fixed;
          z-index: 3;
          top: 92px;
          right: var(--pad-x);
          display: grid;
          gap: 8px;
          width: min(264px, 30vw);
          pointer-events: auto;
        }

        .waves-mode-rail button {
          min-width: 0;
          min-height: 52px;
          display: grid;
          grid-template-columns: 30px 1fr;
          align-items: center;
          gap: 11px;
          border: 1px solid color-mix(in srgb, var(--mode-tone) 32%, transparent);
          border-radius: 8px;
          background: rgba(5, 8, 15, 0.56);
          color: rgba(246, 241, 224, 0.78);
          padding: 7px 11px;
          text-align: left;
          cursor: pointer;
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
        }

        .waves-mode-rail button i {
          width: 26px;
          height: 26px;
          border-radius: 999px;
          border: 1px solid var(--mode-tone);
          box-shadow: 0 0 18px color-mix(in srgb, var(--mode-tone) 34%, transparent);
        }

        .waves-mode-rail button span {
          display: grid;
          gap: 2px;
        }

        .waves-mode-rail button b {
          font-family: var(--font-mono);
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 0.02em;
        }

        .waves-mode-rail button em {
          font-family: var(--font-mono);
          font-size: 10px;
          font-style: normal;
          color: rgba(246, 241, 224, 0.42);
        }

        .waves-mode-rail button[aria-pressed="true"] {
          background: color-mix(in srgb, var(--mode-tone) 15%, rgba(5, 8, 15, 0.6));
          color: rgba(248, 244, 224, 0.96);
        }

        .waves-mode-rail button[aria-pressed="true"] i {
          background: color-mix(in srgb, var(--mode-tone) 60%, transparent);
        }

        .waves-mode-compact,
        .waves-play-hint { display: none; }

        .waves-console {
          position: fixed;
          z-index: 4;
          left: var(--pad-x);
          right: var(--pad-x);
          bottom: calc(20px + env(safe-area-inset-bottom, 0px));
          display: grid;
          grid-template-columns: 82px repeat(3, minmax(112px, 1fr)) 82px minmax(160px, 0.8fr);
          gap: 8px;
          padding: 8px;
          border: 1px solid rgba(246, 241, 224, 0.13);
          border-radius: 8px;
          background: rgba(5, 8, 15, 0.62);
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
          box-shadow: 0 24px 70px rgba(0, 0, 0, 0.4);
          pointer-events: auto;
        }

        .waves-btn,
        .waves-slider,
        .waves-readout {
          min-width: 0;
          min-height: 58px;
          border: 1px solid rgba(246, 241, 224, 0.12);
          border-radius: 6px;
          background: rgba(246, 241, 224, 0.055);
          color: rgba(246, 241, 224, 0.9);
        }

        .waves-btn {
          cursor: pointer;
          font-family: var(--font-mono);
          font-size: 12px;
          text-transform: lowercase;
        }

        .waves-btn[aria-pressed="true"] {
          border-color: color-mix(in srgb, var(--wave-tone) 42%, transparent);
          color: var(--wave-tone);
        }

        .waves-slider {
          display: grid;
          grid-template-columns: 1fr auto;
          grid-template-rows: auto 28px;
          gap: 4px 8px;
          align-items: center;
          padding: 7px 9px;
          font-family: var(--font-mono);
          font-size: 10px;
          color: rgba(246, 241, 224, 0.58);
        }

        .waves-slider strong {
          color: var(--wave-tone);
          font-family: var(--font-numerals, var(--font-mono));
          font-size: 13px;
          font-weight: 500;
        }

        .waves-slider input {
          -webkit-appearance: none;
          appearance: none;
          grid-column: 1 / -1;
          width: 100%;
          height: 28px;
          margin: 0;
          background: transparent;
          accent-color: var(--wave-tone);
        }

        .waves-slider input::-webkit-slider-runnable-track {
          height: 2px;
          border-radius: 999px;
          background: linear-gradient(90deg, var(--wave-tone), rgba(246, 241, 224, 0.15));
        }

        .waves-slider input::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          margin-top: -6px;
          border: 0;
          border-radius: 4px;
          background: var(--wave-tone);
          box-shadow: 0 0 14px var(--wave-tone);
          cursor: pointer;
        }

        .waves-slider input::-moz-range-track {
          height: 2px;
          border-radius: 999px;
          background: linear-gradient(90deg, var(--wave-tone), rgba(246, 241, 224, 0.15));
        }

        .waves-slider input::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border: 0;
          border-radius: 4px;
          background: var(--wave-tone);
          box-shadow: 0 0 14px var(--wave-tone);
          cursor: pointer;
        }

        .waves-readout {
          display: grid;
          place-items: center;
          padding: 0 12px;
          color: rgba(246, 241, 224, 0.72);
          font-family: var(--font-mono);
          font-size: 11px;
          line-height: 1.2;
          text-align: center;
          word-break: break-word;
        }

        body:has(.waves-instrument) {
          background: #04070d;
          overflow: hidden;
        }

        body:has(.waves-instrument) header:not(.oda-site-header) {
          display: none !important;
        }

        body:has(.waves-instrument) .oda-field-watch,
        body:has(.waves-instrument) .oda-candle-mark,
        body:has(.waves-instrument) .oda-tape-shell,
        body:has(.waves-instrument) .oda-sound-toggle {
          display: none !important;
        }

        @media (max-width: 940px) {
          .waves-mode-rail {
            top: auto;
            left: 12px;
            right: 12px;
            bottom: calc(214px + env(safe-area-inset-bottom, 0px));
            width: auto;
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .waves-mode-rail button {
            grid-template-columns: 22px 1fr;
            min-height: 46px;
            padding: 6px 8px;
            gap: 8px;
          }

          .waves-mode-rail button i {
            width: 20px;
            height: 20px;
          }

          .waves-mode-rail button em {
            display: none;
          }

          .waves-console {
            left: 10px;
            right: 10px;
            bottom: calc(10px + env(safe-area-inset-bottom, 0px));
            grid-template-columns: repeat(3, minmax(0, 1fr));
            max-height: min(42svh, 380px);
            overflow-y: auto;
          }

          .waves-readout {
            grid-column: 1 / -1;
            min-height: 42px;
          }

          .waves-title {
            top: 34px;
            left: 24px;
          }

          .waves-title strong {
            font-size: 84px;
          }
        }

        @media (max-width: 720px) {
          .waves-mode-rail { display: none; }
          .waves-mode-compact {
            position: fixed;
            z-index: 5;
            right: 14px;
            bottom: calc(68px + env(safe-area-inset-bottom, 0px));
            min-height: 42px;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            border: 1px solid color-mix(in srgb, var(--wave-tone) 42%, transparent);
            border-radius: 999px;
            padding: 0 10px 0 13px;
            background: rgba(5, 8, 15, 0.82);
            color: rgba(246, 241, 224, 0.62);
            box-shadow: 0 12px 34px rgba(0, 0, 0, 0.24);
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
            font: 9px/1 var(--font-mono);
            letter-spacing: 0.07em;
            text-transform: lowercase;
          }
          .waves-mode-compact select {
            min-height: 32px;
            border: 0;
            padding: 0 18px 0 4px;
            background: transparent;
            color: var(--wave-tone);
            font: 10px/1 var(--font-mono);
            text-transform: lowercase;
          }
          .waves-play-hint {
            position: fixed;
            z-index: 2;
            left: 50%;
            bottom: calc(122px + env(safe-area-inset-bottom, 0px));
            display: block;
            transform: translateX(-50%);
            color: rgba(246, 241, 224, 0.58);
            font: 10px/1 var(--font-mono);
            letter-spacing: 0.07em;
            white-space: nowrap;
            text-shadow: 0 2px 12px rgba(0, 0, 0, 0.86);
            pointer-events: none;
          }
          .waves-mobile-panel .mobile-instrument-panel__trigger {
            max-width: calc(100vw - 190px);
            border-color: color-mix(in srgb, var(--wave-tone) 38%, transparent);
            background: rgba(5, 8, 15, 0.86);
          }
          .waves-mobile-panel .mobile-instrument-panel__sheet {
            background: rgba(4, 7, 13, 0.98);
            border-color: color-mix(in srgb, var(--wave-tone) 26%, transparent);
          }
          .waves-mobile-panel .waves-console {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
            padding: 0;
            border: 0;
            border-radius: 0;
            background: transparent;
            box-shadow: none;
            backdrop-filter: none;
            -webkit-backdrop-filter: none;
            overflow: visible;
          }
          .waves-mobile-panel .waves-readout { grid-column: 1 / -1; }
        }

        @media (max-width: 520px) {
          .waves-slider,
          .waves-btn {
            min-height: 52px;
          }

          .waves-title strong {
            font-size: 62px;
          }
        }

        /* this room's console already spans the bottom, so the quiet clear
           lifts above it until the console folds into the sheet (§8c). */
        body:has(.waves-instrument) .oda-letgo {
          bottom: calc(96px + env(safe-area-inset-bottom, 0px));
        }
        @media (max-width: 940px) {
          body:has(.waves-instrument) .oda-letgo {
            bottom: calc(282px + env(safe-area-inset-bottom, 0px));
          }
        }
        @media (max-width: 720px) {
          body:has(.waves-instrument) .oda-letgo {
            bottom: max(18px, env(safe-area-inset-bottom, 0px));
          }
        }
      `,
        }}
      />
    </div>
  );
}

function colorAlpha(hex: string, alpha: number) {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((ch) => ch + ch).join("") : clean;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ── natural drawing helpers ────────────────────────────────────────
// Small tight paintings for things that live on the pond. Kept
// procedural (no assets) and never man-made — leaves, pads, koi.

function drawLilyPad(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  seed: number,
) {
  // A round pad with the classic notch cut toward the current, a light
  // rim, and a subtle underwater shadow.
  const rot = Math.sin(seed * 0.013) * Math.PI;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  // shadow beneath the pad in the water
  ctx.fillStyle = "rgba(6, 18, 30, 0.28)";
  ctx.beginPath();
  ctx.ellipse(2, 2, r * 1.02, r * 0.92, 0, 0, Math.PI * 2);
  ctx.fill();
  // body — flat green oval with a wedge notch removed. The gradient's
  // offsets and colours are fixed and every one of its own coordinates
  // scales with r, so one sprite normalized to r=1 — baked once through the
  // shared radial-sprite cache — covers every pad at any size: clip to the
  // wedge, then stamp the sprite scaled to this pad's own r.
  const lilySprite = bakeRadialSprite("waves-lily-body", {
    width: 256,
    height: 256,
    inner: { x: 128 - 128 * 0.25, y: 128 - 128 * 0.3, r: 128 * 0.1 },
    outer: { x: 128, y: 128, r: 128 },
    stops: [
      { offset: 0, color: "rgba(150, 196, 118, 0.98)" },
      { offset: 0.6, color: "rgba( 92, 152,  86, 0.96)" },
      { offset: 1, color: "rgba( 46, 100,  62, 0.94)" },
    ],
  });
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arc(0, 0, r, 0, Math.PI * 2 - 0.55, false);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.clip();
  if (lilySprite) ctx.drawImage(lilySprite, -r, -r, r * 2, r * 2);
  ctx.restore();
  // rim highlight
  ctx.strokeStyle = "rgba(214, 244, 178, 0.55)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.96, 0, Math.PI * 2 - 0.55, false);
  ctx.stroke();
  // vein radiating from the notch centre
  ctx.strokeStyle = "rgba(58, 100, 62, 0.55)";
  ctx.lineWidth = 0.6;
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI + 0.35 + (i / 4) * (Math.PI * 2 - 0.7);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * r * 0.88, Math.sin(a) * r * 0.88);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFallenLeaf(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  rot: number,
  seed: number,
) {
  // A small ochre / rust leaf shape floating on the surface. Two lobes
  // pinched at both ends, thin stem, veined centre.
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  // shadow
  ctx.fillStyle = "rgba(6, 18, 30, 0.24)";
  ctx.beginPath();
  ctx.ellipse(1, 1, r * 1.1, r * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  // body — pinched lens
  const g = ctx.createLinearGradient(-r, 0, r, 0);
  const warm = (seed & 3);
  const base = warm === 0 ? "rgba(214, 138, 68, 0.96)"
             : warm === 1 ? "rgba(196, 108, 54, 0.96)"
             : warm === 2 ? "rgba(228, 176, 90, 0.96)"
             : "rgba(180, 128, 76, 0.96)";
  g.addColorStop(0, "rgba(240, 210, 154, 0.92)");
  g.addColorStop(0.5, base);
  g.addColorStop(1, "rgba(120, 78, 48, 0.94)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-r, 0);
  ctx.quadraticCurveTo(0, -r * 0.55, r, 0);
  ctx.quadraticCurveTo(0, r * 0.55, -r, 0);
  ctx.closePath();
  ctx.fill();
  // central vein
  ctx.strokeStyle = "rgba(96, 56, 32, 0.7)";
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(-r * 0.95, 0);
  ctx.lineTo(r * 0.95, 0);
  ctx.stroke();
  // side veins
  for (let i = 1; i <= 3; i++) {
    const f = i / 4;
    const px = -r + f * 2 * r;
    const vy = Math.sqrt(Math.max(0, 1 - Math.pow((px / r), 2))) * r * 0.48;
    ctx.beginPath();
    ctx.moveTo(px * 0.3, 0);
    ctx.lineTo(px, -vy * 0.6);
    ctx.moveTo(px * 0.3, 0);
    ctx.lineTo(px, vy * 0.6);
    ctx.stroke();
  }
  ctx.restore();
}

function drawKoiShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  t: number,
  seed: number,
) {
  // A dark elongated silhouette drifting under the surface, with a
  // slight fish-tail wiggle. A single warm orange dab hints at colour
  // in the koi's back.
  const angle = Math.sin(t * 0.15 + seed * 0.01) * 0.4;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  // body shadow — soft, wide. Fixed colour and offsets, every coordinate
  // proportional to r, so one sprite normalized to r=1 covers every koi:
  // clip to the body ellipse, then stamp the sprite scaled to this fish's r.
  const koiSprite = bakeRadialSprite("waves-koi-body", {
    width: 256,
    height: 256,
    inner: { x: 128, y: 128, r: 128 * 0.15 },
    outer: { x: 128, y: 128, r: 128 },
    stops: [
      { offset: 0, color: "rgba(6, 14, 26, 0.55)" },
      { offset: 0.6, color: "rgba(6, 14, 26, 0.35)" },
      { offset: 1, color: "rgba(6, 14, 26, 0)" },
    ],
  });
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, r, r * 0.34, 0, 0, Math.PI * 2);
  ctx.clip();
  if (koiSprite) ctx.drawImage(koiSprite, -r, -r, r * 2, r * 2);
  ctx.restore();
  // tail wiggle
  const wag = Math.sin(t * 2.4 + seed * 0.03) * 0.5;
  ctx.beginPath();
  ctx.moveTo(-r * 0.85, 0);
  ctx.quadraticCurveTo(-r * 1.05, wag * r * 0.3, -r * 1.15, wag * r * 0.55);
  ctx.quadraticCurveTo(-r * 1.05, wag * r * 0.15 - r * 0.05, -r * 0.85, 0);
  ctx.fillStyle = "rgba(6, 14, 26, 0.42)";
  ctx.fill();
  // orange back dab — the koi's colour barely showing through the water
  ctx.fillStyle = "rgba(224, 120, 56, 0.42)";
  ctx.beginPath();
  ctx.ellipse(r * 0.15, -r * 0.02, r * 0.32, r * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ── weather overlay drawing ────────────────────────────────────────
// Ephemeral acts that fire on their own schedule. Displacement is
// injected in the sim tick above; this pass just paints their bodies.
type WeatherLite =
  | { kind: "leaf"; t0: number; duration: number; startX: number; startY: number; endX: number; endY: number; rot0: number; spin: number; landed: boolean }
  | { kind: "dragonfly"; t0: number; duration: number; ax: number; ay: number; bx: number; by: number }
  | { kind: "wind"; t0: number; duration: number; dir: number; band: number }
  | { kind: "frog"; t0: number; duration: number; x: number; y: number }
  | { kind: "strider"; t0: number; duration: number; ax: number; ay: number; bx: number; by: number }
  | { kind: "koi"; t0: number; duration: number; x: number; y: number; dir: number; splashed: boolean };

function drawWeatherOverlay(
  ctx: CanvasRenderingContext2D,
  events: WeatherLite[],
  now: number,
  t: number,
  w: number,
  h: number,
) {
  for (const e of events) {
    const age = (now - e.t0) / 1000;
    if (age < 0 || age >= e.duration) continue;
    const f = age / e.duration;
    if (e.kind === "leaf" && !e.landed) {
      // spiral down from top: mix start→end with a sinusoidal x wobble
      const ease = f;
      const x = (e.startX + (e.endX - e.startX) * ease + Math.sin(age * 3.2) * 0.03) * w;
      const y = (e.startY + (e.endY - e.startY) * ease) * h;
      const rot = e.rot0 + age * e.spin;
      drawFallenLeaf(ctx, x, y, 9 + Math.sin(age * 2) * 1.4, rot, e.t0 & 0xffff);
    } else if (e.kind === "dragonfly") {
      const x = (e.ax + (e.bx - e.ax) * f) * w;
      const y = (e.ay + (e.by - e.ay) * f + Math.sin(age * 6) * 0.02) * h;
      // body
      ctx.save();
      ctx.fillStyle = "rgba(80, 220, 200, 0.85)";
      ctx.beginPath();
      ctx.ellipse(x, y, 4, 1.2, 0, 0, Math.PI * 2);
      ctx.fill();
      // shimmering wing blur
      const wing = 6 + Math.sin(age * 40) * 1.4;
      ctx.strokeStyle = "rgba(200, 240, 232, 0.35)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.ellipse(x, y - 2, wing, 2, 0.4, 0, Math.PI * 2);
      ctx.ellipse(x, y + 2, wing, 2, -0.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (e.kind === "wind") {
      // subtle directional streak sweeping the band; the actual water
      // motion is done by drop2D above.
      const cy = e.band * h;
      const lead = (e.dir > 0 ? f : 1 - f) * w;
      const grad = ctx.createLinearGradient(lead - 60 * e.dir, cy, lead + 60 * e.dir, cy);
      grad.addColorStop(0, "rgba(230, 240, 240, 0)");
      grad.addColorStop(0.5, "rgba(230, 240, 240, 0.08)");
      grad.addColorStop(1, "rgba(230, 240, 240, 0)");
      ctx.fillStyle = grad;
      ctx.fillRect(lead - 90, cy - 40, 180, 80);
    } else if (e.kind === "frog") {
      // splash rings — the pluck already deformed the water, this is
      // just the outer shockwave ring for a moment.
      const rad = 8 + age * 90;
      const alpha = Math.max(0, 1 - age / e.duration) * 0.55;
      ctx.save();
      ctx.strokeStyle = `rgba(230, 244, 232, ${alpha})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(e.x * w, e.y * h, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (e.kind === "strider") {
      const x = (e.ax + (e.bx - e.ax) * f) * w;
      const y = (e.ay + (e.by - e.ay) * f + Math.sin(age * 5) * 0.006) * h;
      // little dimple pair (the strider's feet meniscus)
      ctx.save();
      ctx.fillStyle = "rgba(6, 18, 30, 0.55)";
      ctx.beginPath();
      ctx.arc(x - 2, y - 1, 0.8, 0, Math.PI * 2);
      ctx.arc(x + 2, y + 1, 0.8, 0, Math.PI * 2);
      ctx.fill();
      // very faint bug body
      ctx.strokeStyle = "rgba(20, 40, 24, 0.7)";
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(x - 4, y);
      ctx.lineTo(x + 4, y);
      ctx.stroke();
      ctx.restore();
      // suppress unused-t warning
      void t;
    } else if (e.kind === "koi") {
      // A rising then descending dark silhouette. Splash ring fires
      // once at the surface break moment.
      const arc = Math.sin(Math.PI * f);
      const bob = arc * 8;
      const bx = e.x * w + e.dir * (f - 0.5) * 32;
      const by = e.y * h - bob;
      drawKoiShadow(ctx, bx, by, 32, t, e.t0 & 0xffff);
      if (f > 0.34 && f < 0.5) {
        const rf = (f - 0.34) / 0.16;
        const rad = 4 + rf * 42;
        ctx.strokeStyle = `rgba(232, 244, 250, ${(1 - rf) * 0.6})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(bx, by + 4, rad, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
}

function WaveSlider({
  label,
  min,
  max,
  step,
  value,
  display,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="waves-slider">
      <span>{label}</span>
      <strong>{display}</strong>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
