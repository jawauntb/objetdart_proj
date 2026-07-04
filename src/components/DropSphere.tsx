"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { useField } from "@/store/field";

// ── Water tint control ────────────────────────────────────────────────
// A single 0..1 axis sweeps the water's character: clear rainwater → a
// greener algal pond → a deeper teal. Kept subtle; aqua is always default.
const HUE_STOPS: Array<{ at: number; name: string; swatch: string }> = [
  { at: 0.0, name: "rain", swatch: "#8fe9ff" },
  { at: 0.5, name: "algae", swatch: "#79e6a2" },
  { at: 1.0, name: "deep", swatch: "#49bcd8" },
];

function hueName(h: number): string {
  if (h < 0.34) return "rain";
  if (h < 0.67) return "algae";
  return "deep";
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const TAU = Math.PI * 2;

// Global aqua tint (r,g,b in 0..1) for the glass shell, from the hue axis.
function aquaTint(h: number): [number, number, number] {
  const c0 = [0.56, 0.91, 1.0];
  const c1 = [0.47, 0.9, 0.63];
  const c2 = [0.29, 0.74, 0.86];
  const t = clamp(h, 0, 1) * 2;
  if (t < 1) return [mix(c0[0], c1[0], t), mix(c0[1], c1[1], t), mix(c0[2], c1[2], t)];
  const u = t - 1;
  return [mix(c1[0], c2[0], u), mix(c1[1], c2[1], u), mix(c1[2], c2[2], u)];
}

// microbe fill colour in css rgb from the hue axis
function microTint(h: number): [number, number, number] {
  const [r, g, b] = aquaTint(h);
  return [
    Math.round(mix(200, r * 255, 0.4)),
    Math.round(mix(240, g * 255, 0.5)),
    Math.round(mix(235, b * 255, 0.5)),
  ];
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// smoothstep helper
function smooth(a: number, b: number, x: number): number {
  if (a === b) return x >= b ? 1 : 0;
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// ── Glass overlay shader (screen-space water beads) ────────────────────
const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2  uRes;
uniform float uTime;
uniform float uReduced;
uniform int   uCount;
uniform vec4  uDropGeom[5];  // cx, cy (device px, top-left), r, tintN
uniform vec4  uDropWob[5];   // a2, a3, a4, rot
uniform vec3  uAqua;

float hash21(vec2 p){ p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 34.53); return fract(p.x * p.y); }

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  for (int i = 0; i < 5; i++) {
    if (i >= uCount) break;
    vec4 g = uDropGeom[i];
    vec2 c = g.xy;
    float r = g.z;
    vec2 dvec = frag - c;
    float d = length(dvec);
    if (d > r * 1.7) continue;
    float th = atan(dvec.y, dvec.x);
    vec4 w = uDropWob[i];
    float R = r * (1.0 + w.x * cos(2.0 * (th - w.w)) + w.y * cos(3.0 * (th - w.w)) + w.z * cos(4.0 * (th - w.w)));
    float dn = d / max(R, 1.0);
    if (dn > 1.03) continue;
    float nz = sqrt(max(0.0001, 1.0 - dn * dn));
    vec3 nrm = normalize(vec3(dvec.x / max(R, 1.0), dvec.y / max(R, 1.0), nz * 1.18));
    vec3 V = vec3(0.0, 0.0, 1.0);
    float fres = pow(1.0 - nz, 3.0);
    vec3 Rref = reflect(-V, nrm);
    // sharp specular glint (classic water-drop highlight, upper-left)
    float spec = pow(max(dot(Rref, normalize(vec3(-0.45, -0.55, 0.72))), 0.0), 110.0);
    // soft secondary sheen lower-right
    float spec2 = pow(max(dot(Rref, normalize(vec3(0.5, 0.55, 0.6))), 0.0), 24.0) * 0.18;
    float cover = smoothstep(1.03, 0.985, dn);
    vec3 tint = uAqua * (0.09 + fres * 0.85);
    vec3 rim = vec3(0.86, 0.96, 1.0) * pow(fres, 1.5) * 0.5;
    vec3 glint = vec3(1.0) * (spec + spec2);
    vec3 c3 = tint + rim + glint;
    // chromatic sparkle where light splits at the meniscus
    float rb = smoothstep(0.62, 1.0, fres);
    float fl = step(0.991, hash21(floor(frag * 0.5) + floor(uTime * (uReduced > 0.5 ? 2.0 : 8.0))));
    c3 += vec3(0.55, 0.8, 1.0) * fl * rb * 0.55;
    float a = cover * (0.055 + fres * 0.5 + spec * 0.95);
    a = clamp(a, 0.0, 0.96);
    if (a >= alpha) { alpha = a; col = c3; }
  }
  gl_FragColor = vec4(col, alpha);
}
`;

type GL = WebGLRenderingContext;

function compile(gl: GL, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    // eslint-disable-next-line no-console
    console.warn("drop shader compile", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

// ── Model ──────────────────────────────────────────────────────────────
const MAX_DROPS = 5;
const REF_R = 220; // reference radius for wobble frequency scaling

type Drop = {
  id: number;
  cx: number; cy: number; // css px
  vx: number; vy: number;
  r: number;
  s2: number; s3: number; s4: number; // wobble mode amplitudes (fraction of r)
  v2: number; v3: number; v4: number;
  rot: number;
  seedX: number; seedY: number; phase: number; // microcosm pan seed
};

type MType =
  | "mote" | "bacterium" | "paramecium" | "amoeba" | "diatom"
  | "rotifer" | "tardigrade" | "euglena" | "volvox";

type Microbe = {
  type: MType;
  fx: number; fy: number; fz: number; // field coords, depth 0..1
  size: number; // field-unit base size
  ang: number; phase: number;
  hx: number; hy: number; // heading unit
  speed: number; wander: number;
  seed: number;
  zi0: number; zi1: number; zo0: number; zo1: number; // zoom visibility window
};

const TYPE_BANDS: Record<MType, [number, number, number, number]> = {
  mote: [-0.2, 0.0, 0.85, 1.2],
  bacterium: [0.5, 0.72, 1.3, 1.4],
  paramecium: [0.2, 0.42, 0.92, 1.15],
  amoeba: [0.22, 0.44, 0.92, 1.15],
  diatom: [0.24, 0.46, 0.95, 1.2],
  rotifer: [0.26, 0.48, 0.9, 1.12],
  tardigrade: [0.3, 0.52, 0.9, 1.1],
  euglena: [0.2, 0.42, 0.95, 1.18],
  volvox: [0.24, 0.46, 0.9, 1.12],
};

function makeMicrobes(coarse: boolean): Microbe[] {
  const rnd = mulberry32(0xd0d0f);
  const list: Microbe[] = [];
  const counts: Array<[MType, number]> = [
    ["mote", coarse ? 8 : 12],
    ["bacterium", coarse ? 10 : 16],
    ["paramecium", coarse ? 3 : 4],
    ["amoeba", coarse ? 2 : 3],
    ["diatom", coarse ? 3 : 4],
    ["rotifer", coarse ? 1 : 2],
    ["tardigrade", coarse ? 1 : 2],
    ["euglena", coarse ? 3 : 4],
    ["volvox", coarse ? 1 : 2],
  ];
  const baseSize: Record<MType, number> = {
    mote: 0.012, bacterium: 0.02, paramecium: 0.1, amoeba: 0.12, diatom: 0.075,
    rotifer: 0.1, tardigrade: 0.11, euglena: 0.085, volvox: 0.12,
  };
  for (const [type, count] of counts) {
    const band = TYPE_BANDS[type];
    for (let i = 0; i < count; i++) {
      const a = rnd() * TAU;
      list.push({
        type,
        fx: (rnd() * 2 - 1) * 1.4,
        fy: (rnd() * 2 - 1) * 1.4,
        fz: rnd(),
        size: baseSize[type] * (0.75 + rnd() * 0.6),
        ang: rnd() * TAU,
        phase: rnd() * TAU,
        hx: Math.cos(a), hy: Math.sin(a),
        speed: (type === "amoeba" || type === "diatom" || type === "rotifer" ? 0.01 : 0.05) * (0.5 + rnd()),
        wander: 0.4 + rnd(),
        seed: rnd() * 1000,
        zi0: band[0], zi1: band[1], zo0: band[2], zo1: band[3],
      });
    }
  }
  return list;
}

// ── Water sound layer (custom one-shots + a zoom-driven drone) ─────────
type WaterAudio = {
  kick: () => void;
  plip: (freq: number, dur: number) => void;
  gloop: () => void;
  bloop: () => void;
  drone: (zoom: number) => void;
  stop: () => void;
};

function makeWaterAudio(): WaterAudio {
  let ctx: AudioContext | null = null;
  let noise: AudioBufferSourceNode | null = null;
  let droneFilter: BiquadFilterNode | null = null;
  let droneGain: GainNode | null = null;
  let started = false;

  const isMuted = () => {
    try { return getFieldAudio().isMuted(); } catch { return false; }
  };

  const ensure = (): AudioContext | null => {
    if (ctx) return ctx;
    try { ctx = getFieldAudio().getAudioContext(); } catch { ctx = null; }
    return ctx;
  };

  const startDrone = () => {
    const c = ensure();
    if (!c || started) return;
    started = true;
    try {
      const len = Math.floor(c.sampleRate * 2);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const data = buf.getChannelData(0);
      let lastv = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        lastv = (lastv + 0.02 * white) / 1.02;
        data[i] = lastv * 3.2;
      }
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 220;
      lp.Q.value = 0.6;
      const g = c.createGain();
      g.gain.value = 0.0001;
      src.connect(lp).connect(g).connect(c.destination);
      src.start();
      noise = src; droneFilter = lp; droneGain = g;
    } catch { /* noop */ }
  };

  const kick = () => {
    const c = ensure();
    if (c && c.state === "suspended") { try { void c.resume(); } catch { /* noop */ } }
    startDrone();
  };

  const plip = (freq: number, dur: number) => {
    if (isMuted()) return;
    const c = ensure();
    if (!c) return;
    if (c.state === "suspended") { try { void c.resume(); } catch { /* noop */ } }
    try {
      const now = c.currentTime;
      const osc = c.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.42), now + dur);
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(freq * 3.5, now);
      lp.frequency.exponentialRampToValueAtTime(Math.max(200, freq), now + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.16, now + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(lp).connect(g).connect(c.destination);
      osc.start(now);
      osc.stop(now + dur + 0.03);
      osc.onended = () => { try { osc.disconnect(); lp.disconnect(); g.disconnect(); } catch { /* noop */ } };
    } catch { /* noop */ }
  };

  const gloop = () => plip(190, 0.34);
  const bloop = () => { if (Math.random() < 0.9) plip(520 + Math.random() * 260, 0.09); };

  const drone = (zoom: number) => {
    if (!droneFilter || !droneGain || !ctx) return;
    try {
      const now = ctx.currentTime;
      const z = clamp(zoom, 0, 1);
      const muted = isMuted();
      droneFilter.frequency.setTargetAtTime(180 + z * z * 1400, now, 0.2);
      droneGain.gain.setTargetAtTime(muted ? 0.0001 : 0.012 + z * 0.05, now, 0.25);
    } catch { /* noop */ }
  };

  const stop = () => {
    try { noise?.stop(); } catch { /* noop */ }
    try { noise?.disconnect(); droneFilter?.disconnect(); droneGain?.disconnect(); } catch { /* noop */ }
    noise = null; droneFilter = null; droneGain = null; started = false;
  };

  return { kick, plip, gloop, bloop, drone, stop };
}

// ── Component ──────────────────────────────────────────────────────────
export default function DropSphere() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const microRef = useRef<HTMLCanvasElement | null>(null);
  const glassRef = useRef<HTMLCanvasElement | null>(null);

  const reduceRef = useRef(false);
  const hueRef = useRef(0);
  const zoomRef = useRef({ slider: 0, impulse: 0, current: 0 });
  const dropsRef = useRef<Drop[]>([]);
  const microbesRef = useRef<Microbe[]>([]);
  const nextIdRef = useRef(1);
  const startRef = useRef(0);
  const sizeRef = useRef({ w: 0, h: 0 });
  const glassReadyRef = useRef(false);
  const audioRef = useRef<WaterAudio | null>(null);
  const audioStartedRef = useRef(false);

  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const dragRef = useRef({
    pointerId: -1, dropId: -1, offX: 0, offY: 0,
    lastX: 0, lastY: 0, lastT: 0, downX: 0, downY: 0, downT: 0, moved: 0,
    vx: 0, vy: 0, throttle: 0, lastTapT: 0, lastTapDrop: -1,
  });
  const pinchRef = useRef({ active: false, dist: 0 });
  const throttleRef = useRef({ dive: 0, bloop: 0, tape: 0 });

  const [hue, setHue] = useState(0);
  const [dive, setDive] = useState(0);
  const [readout, setReadout] = useState("rain · zoom 0.00 · 1 drop");
  const [fallback, setFallback] = useState(false);

  const recordTape = useField((s) => s.recordTape);

  useEffect(() => { hueRef.current = hue; }, [hue]);
  useEffect(() => { zoomRef.current.slider = dive; }, [dive]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduceRef.current = mq.matches;
    const update = () => { reduceRef.current = mq.matches; };
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  // home slots so split beads settle apart instead of re-merging
  const homeFor = useCallback((i: number, n: number) => {
    const { w, h } = sizeRef.current;
    const cx = w * 0.5, cy = h * 0.5;
    if (n <= 1) return { x: cx, y: cy };
    const ring = Math.min(w, h) * (n === 2 ? 0.16 : 0.2);
    const a = (i / n) * TAU - Math.PI / 2;
    return { x: cx + Math.cos(a) * ring, y: cy + Math.sin(a) * ring };
  }, []);

  const kickAudio = useCallback(() => {
    if (audioStartedRef.current) return;
    audioStartedRef.current = true;
    try { audioRef.current?.kick(); } catch { /* noop */ }
  }, []);

  const dropRadiusForCount = useCallback((n: number) => {
    const { w, h } = sizeRef.current;
    const base = Math.min(w, h) * 0.3;
    return base * Math.pow(1 / Math.max(1, n), 1 / 3);
  }, []);

  // ── Setup: both canvases + one physics/render loop ────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const root = rootRef.current;
    const micro = microRef.current;
    if (!root || !micro) return;

    const mctx = micro.getContext("2d");
    if (!mctx) setFallback(true);

    const coarse = window.matchMedia("(pointer: coarse)").matches
      || window.matchMedia("(max-width: 820px)").matches;

    if (microbesRef.current.length === 0) microbesRef.current = makeMicrobes(coarse);
    if (!audioRef.current) audioRef.current = makeWaterAudio();

    const rect0 = root.getBoundingClientRect();
    sizeRef.current = { w: Math.max(320, rect0.width), h: Math.max(420, rect0.height) };
    if (dropsRef.current.length === 0) {
      dropsRef.current = [{
        id: nextIdRef.current++,
        cx: sizeRef.current.w / 2, cy: sizeRef.current.h / 2,
        vx: 0, vy: 0, r: dropRadiusForCount(1),
        s2: 0, s3: 0, s4: 0, v2: 0, v3: 0, v4: 0, rot: 0,
        seedX: 0, seedY: 0, phase: 0,
      }];
    }

    // WebGL glass overlay (enhancement; 2D fallback covers if it fails)
    const glass = glassRef.current;
    let gl: GL | null = null;
    let prog: WebGLProgram | null = null;
    let vs: WebGLShader | null = null;
    let fs: WebGLShader | null = null;
    let U: Record<string, WebGLUniformLocation | null> = {};
    if (glass) {
      try {
        gl = (glass.getContext("webgl", { alpha: true, antialias: false, premultipliedAlpha: false })
          || glass.getContext("experimental-webgl")) as GL | null;
      } catch { gl = null; }
      if (gl) {
        vs = compile(gl, gl.VERTEX_SHADER, VERT);
        fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
        prog = gl.createProgram();
        if (vs && fs && prog) {
          gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
          if (gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            gl.useProgram(prog);
            const buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
            const aPos = gl.getAttribLocation(prog, "aPos");
            gl.enableVertexAttribArray(aPos);
            gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            U = {
              res: gl.getUniformLocation(prog, "uRes"),
              time: gl.getUniformLocation(prog, "uTime"),
              reduced: gl.getUniformLocation(prog, "uReduced"),
              count: gl.getUniformLocation(prog, "uCount"),
              geom: gl.getUniformLocation(prog, "uDropGeom"),
              wob: gl.getUniformLocation(prog, "uDropWob"),
              aqua: gl.getUniformLocation(prog, "uAqua"),
            };
            glassReadyRef.current = true;
          } else {
            // eslint-disable-next-line no-console
            console.warn("drop glass link", gl.getProgramInfoLog(prog));
            gl = null;
          }
        } else { gl = null; }
      }
    }
    if (!gl) glassReadyRef.current = false;

    let dpr = 1;
    const resize = () => {
      const rect = root.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 1.75);
      const w = Math.max(320, Math.floor(rect.width));
      const h = Math.max(420, Math.floor(rect.height));
      sizeRef.current = { w, h };
      for (const cv of [micro, glass]) {
        if (!cv) continue;
        cv.width = Math.floor(w * dpr);
        cv.height = Math.floor(h * dpr);
        cv.style.width = `${w}px`;
        cv.style.height = `${h}px`;
      }
      if (gl && glass) gl.viewport(0, 0, glass.width, glass.height);
    };
    resize();
    const obs = new ResizeObserver(resize);
    obs.observe(root);
    window.addEventListener("resize", resize);

    startRef.current = performance.now();
    let last = startRef.current;
    let raf = 0;
    let readoutAt = 0;
    let gpx = 0, gpy = 0; // global microcosm pan
    const geom = new Float32Array(MAX_DROPS * 4);
    const wob = new Float32Array(MAX_DROPS * 4);

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const time = (now - startRef.current) / 1000;
      const reduced = reduceRef.current;
      const { w, h } = sizeRef.current;

      // zoom easing
      const zs = zoomRef.current;
      zs.impulse *= Math.exp(-dt * 2.0);
      const zt = clamp(zs.slider + zs.impulse, 0, 1);
      zs.current = mix(zs.current, zt, 1 - Math.exp(-dt * 6));
      const zoom = zs.current;

      // physics
      const drops = dropsRef.current;
      const n = drops.length;
      const drag = dragRef.current;
      const wdamp = Math.exp(-dt * (reduced ? 4.0 : 2.1));
      const posDamp = Math.exp(-dt * 2.2);
      for (let i = 0; i < n; i++) {
        const d = drops[i];
        const grabbed = drag.dropId === d.id;
        if (!grabbed) {
          const home = homeFor(i, n);
          d.vx += (home.x - d.cx) * 2.4 * dt;
          d.vy += (home.y - d.cy) * 2.4 * dt;
          for (let j = 0; j < n; j++) {
            if (j === i) continue;
            const o = drops[j];
            const dx = d.cx - o.cx, dy = d.cy - o.cy;
            const dist = Math.hypot(dx, dy) || 1;
            const minGap = (d.r + o.r) * 0.92;
            if (dist < minGap) {
              const push = ((minGap - dist) / minGap) * 60;
              d.vx += (dx / dist) * push * dt;
              d.vy += (dy / dist) * push * dt;
            }
          }
          d.vx *= posDamp; d.vy *= posDamp;
          d.cx += d.vx * dt; d.cy += d.vy * dt;
          d.cx = clamp(d.cx, d.r * 0.5, w - d.r * 0.5);
          d.cy = clamp(d.cy, d.r * 0.5, h - d.r * 0.5);
        }
        // wobble oscillators — cohesion pulls the bead back round
        const fscale = Math.sqrt(REF_R / Math.max(60, d.r));
        const o2 = 7.6 * fscale, o3 = 7.6 * 1.6 * fscale, o4 = 7.6 * 2.15 * fscale;
        d.v2 += -o2 * o2 * d.s2 * dt; d.v3 += -o3 * o3 * d.s3 * dt; d.v4 += -o4 * o4 * d.s4 * dt;
        d.v2 *= wdamp; d.v3 *= wdamp; d.v4 *= wdamp;
        d.s2 += d.v2 * dt; d.s3 += d.v3 * dt; d.s4 += d.v4 * dt;
        d.s2 = clamp(d.s2, -0.24, 0.24); d.s3 = clamp(d.s3, -0.18, 0.18); d.s4 = clamp(d.s4, -0.14, 0.14);
        d.rot += (reduced ? 0.15 : 0.5) * dt;
        d.phase += dt;
      }

      // merge while dragging a bead onto another
      if (drag.dropId !== -1 && drops.length > 1) {
        const di = drops.findIndex((x) => x.id === drag.dropId);
        if (di !== -1) {
          const a = drops[di];
          for (let j = 0; j < drops.length; j++) {
            if (j === di) continue;
            const b = drops[j];
            const dist = Math.hypot(a.cx - b.cx, a.cy - b.cy);
            if (dist < (a.r + b.r) * 0.6) {
              const va = a.r ** 3, vb = b.r ** 3;
              a.cx = (a.cx * va + b.cx * vb) / (va + vb);
              a.cy = (a.cy * va + b.cy * vb) / (va + vb);
              a.r = Math.cbrt(va + vb); a.v2 += 3.2; a.v3 -= 1.8;
              drops.splice(j, 1);
              try { audioRef.current?.gloop(); } catch { /* noop */ }
              try { haptics.roll(); } catch { /* noop */ }
              recordTape("preset", 0.6, "drop/merge");
              break;
            }
          }
        }
      }

      // microcosm drift + microbe motion
      const panRate = reduced ? 0.004 : 0.014;
      gpx += Math.cos(time * 0.11) * panRate * dt * 10;
      gpy += Math.sin(time * 0.09) * panRate * dt * 10;
      const microbes = microbesRef.current;
      for (let m = 0; m < microbes.length; m++) {
        const b = microbes[m];
        const spd = reduced ? b.speed * 0.35 : b.speed;
        if (b.type === "bacterium" || b.type === "mote") {
          b.fx += (Math.random() - 0.5) * 0.02 * b.wander;
          b.fy += (Math.random() - 0.5) * 0.02 * b.wander;
          if (b.type === "bacterium") { b.fx += b.hx * spd * dt; b.fy += b.hy * spd * dt; }
        } else {
          const turn = (reduced ? 0.2 : 0.7) * Math.sin(b.phase * 0.7 + b.seed) * dt;
          const ca = Math.cos(turn), sa = Math.sin(turn);
          const nx = ca * b.hx - sa * b.hy, ny = sa * b.hx + ca * b.hy;
          b.hx = nx; b.hy = ny;
          b.fx += b.hx * spd * dt;
          b.fy += b.hy * spd * dt;
          b.ang += (b.type === "volvox" || b.type === "rotifer" ? (reduced ? 0.1 : 0.8) : 0.2) * dt;
        }
        b.phase += dt;
        if (b.fx > 1.6) b.fx -= 3.2; else if (b.fx < -1.6) b.fx += 3.2;
        if (b.fy > 1.6) b.fy -= 3.2; else if (b.fy < -1.6) b.fy += 3.2;
      }

      // ── render 2D layer (bg + caustics + microbes) ──
      if (mctx) {
        mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        mctx.clearRect(0, 0, w, h);
        const bg = mctx.createLinearGradient(0, 0, 0, h);
        bg.addColorStop(0, "#02060a");
        bg.addColorStop(0.55, "#03121a");
        bg.addColorStop(1, "#010407");
        mctx.fillStyle = bg;
        mctx.fillRect(0, 0, w, h);

        const [tr, tg, tb] = microTint(hueRef.current);
        const mag = 1 + zoom * zoom * 8.5;

        for (let i = 0; i < drops.length; i++) {
          const d = drops[i];
          // caustic bright spot beneath the bead
          const cg = mctx.createRadialGradient(d.cx, d.cy + d.r * 0.7, 0, d.cx, d.cy + d.r * 0.85, d.r * 1.1);
          cg.addColorStop(0, `rgba(${tr},${tg},${tb},0.16)`);
          cg.addColorStop(1, "rgba(0,0,0,0)");
          mctx.fillStyle = cg;
          mctx.beginPath();
          mctx.arc(d.cx, d.cy + d.r * 0.8, d.r * 1.1, 0, TAU);
          mctx.fill();

          // clip to the wobbling meniscus
          mctx.save();
          mctx.beginPath();
          const SEG = 56;
          for (let k = 0; k <= SEG; k++) {
            const th = (k / SEG) * TAU;
            const R = d.r * (1 + d.s2 * Math.cos(2 * (th - d.rot)) + d.s3 * Math.cos(3 * (th - d.rot)) + d.s4 * Math.cos(4 * (th - d.rot)));
            const px = d.cx + Math.cos(th) * R, py = d.cy + Math.sin(th) * R;
            if (k === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
          }
          mctx.closePath();
          mctx.clip();

          // watery interior fill (phase-contrast look), darker meniscus
          const wg = mctx.createRadialGradient(d.cx - d.r * 0.2, d.cy - d.r * 0.25, d.r * 0.1, d.cx, d.cy, d.r);
          wg.addColorStop(0, `rgba(${tr},${tg},${tb},0.06)`);
          wg.addColorStop(0.7, `rgba(${Math.round(tr * 0.4)},${Math.round(tg * 0.55)},${Math.round(tb * 0.5)},0.14)`);
          wg.addColorStop(1, "rgba(1,6,10,0.5)");
          mctx.fillStyle = wg;
          mctx.fillRect(d.cx - d.r, d.cy - d.r, d.r * 2, d.r * 2);

          // microbes, magnified into the bead
          for (let m = 0; m < microbes.length; m++) {
            const b = microbes[m];
            const vis = smooth(b.zi0, b.zi1, zoom) * (1 - smooth(b.zo0, b.zo1, zoom));
            if (vis < 0.03) continue;
            const par = 0.5 + b.fz * 0.6;
            let fx = b.fx - (gpx + d.seedX) * par;
            let fy = b.fy - (gpy + d.seedY) * par;
            fx -= Math.round(fx / 3.2) * 3.2;
            fy -= Math.round(fy / 3.2) * 3.2;
            let ox = fx * d.r * 0.5 * mag;
            let oy = fy * d.r * 0.5 * mag;
            const dd = Math.hypot(ox, oy) / d.r;
            if (dd > 1.15) continue;
            const bulge = 1 + 0.16 * (1 - dd * dd);
            ox *= bulge; oy *= bulge;
            const sz = b.size * d.r * 0.5 * mag * bulge;
            if (sz < 0.4) continue;
            const alpha = vis * (0.45 + b.fz * 0.55);
            drawMicrobe(mctx, b, d.cx + ox, d.cy + oy, sz, alpha, tr, tg, tb, time, reduced);
          }

          if (!glassReadyRef.current) draw2DGlass(mctx, d, tr, tg, tb);
          mctx.restore();
        }
      }

      // ── render WebGL glass overlay ──
      if (gl && prog && glass) {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        const cnt = Math.min(MAX_DROPS, drops.length);
        for (let i = 0; i < cnt; i++) {
          const d = drops[i];
          geom[i * 4] = d.cx * dpr;
          geom[i * 4 + 1] = d.cy * dpr;
          geom[i * 4 + 2] = d.r * dpr;
          geom[i * 4 + 3] = hueRef.current;
          wob[i * 4] = d.s2; wob[i * 4 + 1] = d.s3; wob[i * 4 + 2] = d.s4; wob[i * 4 + 3] = d.rot;
        }
        gl.uniform2f(U.res, glass.width, glass.height);
        gl.uniform1f(U.time, time);
        gl.uniform1f(U.reduced, reduced ? 1 : 0);
        gl.uniform1i(U.count, cnt);
        gl.uniform4fv(U.geom, geom);
        gl.uniform4fv(U.wob, wob);
        const [ar, ag, ab] = aquaTint(hueRef.current);
        gl.uniform3f(U.aqua, ar, ag, ab);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }

      // audio drone follows the dive depth
      try { audioRef.current?.drone(zoom); } catch { /* noop */ }
      if (zoom > 0.5 && now - throttleRef.current.bloop > 900 && Math.random() < 0.4) {
        throttleRef.current.bloop = now;
        try { audioRef.current?.bloop(); } catch { /* noop */ }
      }

      if (now - readoutAt > 200) {
        readoutAt = now;
        const dc = drops.length;
        setReadout(`${hueName(hueRef.current)} · zoom ${zoom.toFixed(2)} · ${dc} drop${dc > 1 ? "s" : ""}`);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      kickAudio();
      zoomRef.current.impulse = clamp(zoomRef.current.impulse - e.deltaY * 0.0009, -0.3, 1);
      const now = performance.now();
      if (now - throttleRef.current.dive > 90) {
        throttleRef.current.dive = now;
        const depth = clamp(zoomRef.current.slider + zoomRef.current.impulse, 0, 1);
        try { audioRef.current?.plip(150 + depth * 120, 0.14); } catch { /* noop */ }
        try { haptics.chop(); } catch { /* noop */ }
        recordTape("sigil", 0.3 + depth * 0.5, "drop/dive");
      }
    };
    root.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf);
      obs.disconnect();
      window.removeEventListener("resize", resize);
      root.removeEventListener("wheel", onWheel);
      try {
        if (gl) { if (prog) gl.deleteProgram(prog); if (vs) gl.deleteShader(vs); if (fs) gl.deleteShader(fs); }
      } catch { /* noop */ }
      try { audioRef.current?.stop(); } catch { /* noop */ }
      audioStartedRef.current = false;
    };
  }, [homeFor, dropRadiusForCount, kickAudio, recordTape]);

  // ── hit test: nearest drop containing a css-px point ──────────────────
  const hitDrop = useCallback((x: number, y: number): Drop | null => {
    const drops = dropsRef.current;
    let best: Drop | null = null;
    let bestD = Infinity;
    for (const d of drops) {
      const dist = Math.hypot(x - d.cx, y - d.cy);
      if (dist < d.r * 1.05 && dist < bestD) { bestD = dist; best = d; }
    }
    return best;
  }, []);

  const pokeDrop = useCallback((d: Drop, x: number, y: number) => {
    d.rot = Math.atan2(y - d.cy, x - d.cx);
    d.v2 -= 2.4; d.v3 += 1.4; d.v4 += 0.7;
    try { audioRef.current?.plip(360 + Math.random() * 120, 0.16); } catch { /* noop */ }
    try { haptics.ripple(0.4); } catch { /* noop */ }
    recordTape("ripple", 0.5, "drop/poke");
  }, [recordTape]);

  const splitDrop = useCallback((target?: Drop) => {
    const drops = dropsRef.current;
    if (drops.length >= MAX_DROPS) return;
    const d = target ?? drops.reduce((a, b) => (b.r > a.r ? b : a), drops[0]);
    if (!d || d.r < 40) return;
    const nr = d.r * Math.pow(0.5, 1 / 3);
    const a = Math.random() * TAU;
    const ux = Math.cos(a), uy = Math.sin(a);
    d.r = nr; d.v2 += 3.0; d.v3 -= 1.6;
    d.cx -= ux * nr * 0.5; d.cy -= uy * nr * 0.5;
    d.vx -= ux * 90; d.vy -= uy * 90;
    drops.push({
      id: nextIdRef.current++,
      cx: d.cx + ux * nr * 1.2, cy: d.cy + uy * nr * 1.2,
      vx: ux * 90, vy: uy * 90, r: nr,
      s2: 0.14, s3: -0.08, s4: 0, v2: 3.0, v3: -1.6, v4: 0,
      rot: a, seedX: Math.random() * 2 - 1, seedY: Math.random() * 2 - 1, phase: Math.random() * 6,
    });
    try { audioRef.current?.plip(620, 0.12); } catch { /* noop */ }
    try { haptics.chop(); } catch { /* noop */ }
    recordTape("object", 0.8, "drop/split");
  }, [recordTape]);

  // ── pointer gestures ──────────────────────────────────────────────────
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    kickAudio();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const map = pointersRef.current;
    map.set(e.pointerId, { x, y });
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }

    if (map.size >= 2) {
      const pts = [...map.values()];
      pinchRef.current.active = true;
      pinchRef.current.dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      dragRef.current.dropId = -1;
      dragRef.current.pointerId = -1;
      return;
    }

    const d = dragRef.current;
    d.pointerId = e.pointerId;
    d.lastX = x; d.lastY = y; d.lastT = performance.now();
    d.downX = x; d.downY = y; d.downT = performance.now();
    d.moved = 0; d.vx = 0; d.vy = 0;
    const hit = hitDrop(x, y);
    if (hit) {
      d.dropId = hit.id; d.offX = hit.cx - x; d.offY = hit.cy - y;
      hit.vx = 0; hit.vy = 0;
    } else {
      d.dropId = -1;
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const map = pointersRef.current;
    if (!map.has(e.pointerId)) return;
    map.set(e.pointerId, { x, y });

    if (pinchRef.current.active && map.size >= 2) {
      const pts = [...map.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const delta = dist - pinchRef.current.dist;
      pinchRef.current.dist = dist;
      zoomRef.current.impulse = clamp(zoomRef.current.impulse + delta * 0.006, -0.3, 1);
      const now = performance.now();
      if (now - throttleRef.current.dive > 90) {
        throttleRef.current.dive = now;
        const depth = clamp(zoomRef.current.slider + zoomRef.current.impulse, 0, 1);
        try { audioRef.current?.plip(150 + depth * 120, 0.14); } catch { /* noop */ }
        try { haptics.chop(); } catch { /* noop */ }
        recordTape("sigil", 0.3 + depth * 0.5, "drop/pinch");
      }
      return;
    }

    const d = dragRef.current;
    if (d.pointerId !== e.pointerId) return;
    const now = performance.now();
    const dt = Math.max(1, now - d.lastT) / 1000;
    const dx = x - d.lastX, dy = y - d.lastY;
    d.lastX = x; d.lastY = y; d.lastT = now;
    d.moved += Math.hypot(dx, dy);
    d.vx = mix(d.vx, dx / dt, 0.5);
    d.vy = mix(d.vy, dy / dt, 0.5);

    if (d.dropId !== -1) {
      const drop = dropsRef.current.find((z) => z.id === d.dropId);
      if (drop) {
        drop.cx = x + d.offX; drop.cy = y + d.offY;
        drop.v2 += clamp(dx * 0.006, -0.6, 0.6);
        drop.v3 += clamp(dy * 0.004, -0.4, 0.4);
        if (now - d.throttle > 90) {
          d.throttle = now;
          const speed = clamp((Math.abs(dx) + Math.abs(dy)) / 40, 0, 1);
          try { audioRef.current?.plip(240 + speed * 160, 0.09); } catch { /* noop */ }
          try { haptics.ripple(0.2 + speed * 0.3); } catch { /* noop */ }
          if (now - throttleRef.current.tape > 140) {
            throttleRef.current.tape = now;
            recordTape("ripple", 0.3 + speed * 0.4, "drop/drag");
          }
        }
      }
    }
  };

  const endPointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    const map = pointersRef.current;
    const d = dragRef.current;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    map.delete(e.pointerId);

    if (pinchRef.current.active) {
      if (map.size < 2) pinchRef.current.active = false;
      return;
    }
    if (d.pointerId !== e.pointerId) return;
    d.pointerId = -1;
    const now = performance.now();
    const dur = now - d.downT;
    const wasDrop = d.dropId;
    d.dropId = -1;

    if (d.moved < 9 && dur < 340) {
      const hit = hitDrop(x, y);
      if (hit) {
        const isDouble = now - d.lastTapT < 340 && d.lastTapDrop === hit.id;
        d.lastTapT = now; d.lastTapDrop = hit.id;
        if (isDouble) { splitDrop(hit); return; }
        pokeDrop(hit, x, y);
        return;
      }
      for (const drop of dropsRef.current) { drop.v2 += 0.7; drop.v3 -= 0.4; }
      try { audioRef.current?.plip(300, 0.12); } catch { /* noop */ }
      try { haptics.tap(); } catch { /* noop */ }
      recordTape("ripple", 0.3, "drop/ripple");
      return;
    }

    if (wasDrop !== -1) {
      const drop = dropsRef.current.find((z) => z.id === wasDrop);
      if (drop && !reduceRef.current) {
        drop.vx = clamp(d.vx, -900, 900);
        drop.vy = clamp(d.vy, -900, 900);
        drop.v2 += 1.4;
        const mag = Math.hypot(drop.vx, drop.vy);
        if (mag > 120) {
          try { audioRef.current?.plip(220, 0.14); } catch { /* noop */ }
          try { haptics.roll(); } catch { /* noop */ }
          recordTape("ripple", clamp(0.3 + mag / 1400, 0.3, 0.9), "drop/fling");
        }
      }
    }
  };

  const onHue = (v: number) => {
    setHue(v);
    hueRef.current = v;
    kickAudio();
    try { audioRef.current?.plip(300 + v * 200, 0.1); } catch { /* noop */ }
    try { haptics.tap(); } catch { /* noop */ }
    recordTape("preset", 0.4 + v * 0.3, `drop/tint/${hueName(v)}`);
  };

  const onDive = (v: number) => {
    setDive(v);
    zoomRef.current.slider = v;
    kickAudio();
    const now = performance.now();
    if (now - throttleRef.current.dive > 90) {
      throttleRef.current.dive = now;
      try { audioRef.current?.plip(150 + v * 120, 0.14); } catch { /* noop */ }
      try { haptics.chop(); } catch { /* noop */ }
      recordTape("sigil", 0.3 + v * 0.5, "drop/dive");
    }
  };

  const onSplit = () => { kickAudio(); splitDrop(); };
  const onMerge = () => {
    kickAudio();
    const drops = dropsRef.current;
    if (drops.length < 2) return;
    const { w, h } = sizeRef.current;
    while (dropsRef.current.length > 1) {
      const list = dropsRef.current;
      const a = list[0];
      const b = list[1];
      const va = a.r ** 3, vb = b.r ** 3;
      a.cx = (a.cx * va + b.cx * vb) / (va + vb);
      a.cy = (a.cy * va + b.cy * vb) / (va + vb);
      a.r = Math.cbrt(va + vb);
      a.v2 += 3.0;
      list.splice(1, 1);
    }
    const only = dropsRef.current[0];
    only.cx = w / 2; only.cy = h / 2;
    try { audioRef.current?.gloop(); } catch { /* noop */ }
    try { haptics.roll(); } catch { /* noop */ }
    recordTape("preset", 0.6, "drop/gather");
  };

  return (
    <div
      ref={rootRef}
      className="drop-sphere"
      data-touch-surface="true"
      data-pretext-ignore="true"
      style={{ "--drop-accent": HUE_STOPS[0].swatch } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
    >
      <canvas
        ref={microRef}
        className="drop-canvas drop-micro"
        role="img"
        aria-label="A bead of rainwater held together by surface tension. Drag to move it and it wobbles; tap to poke ripples across it; pinch, scroll, or use the zoom control to dive inside and discover the microscopic life swimming in the water; double-tap or use split to divide the drop, and gather to merge the droplets back together."
      />
      <canvas ref={glassRef} className="drop-canvas drop-glass" aria-hidden="true" />

      {fallback && (
        <div className="drop-fallback" data-drop-fallback="true" aria-hidden="true">
          <div className="drop-fallback-orb" />
        </div>
      )}

      <div className="drop-title" aria-hidden="true">
        <span>a bead of rain, alive</span>
        <strong>drop</strong>
      </div>

      <output className="drop-readout" aria-live="polite">{readout}</output>

      <div className="drop-console" aria-label="droplet controls">
        <label className="drop-pill drop-hue">
          <span>tint</span>
          <input
            type="range" min={0} max={1} step={0.001} value={hue}
            aria-label="water tint"
            onChange={(e) => onHue(Number(e.target.value))}
          />
          <em style={{ background: HUE_STOPS[0].swatch }} data-swatch />
        </label>
        <label className="drop-pill drop-dive-pill">
          <span>zoom</span>
          <input
            type="range" min={0} max={1} step={0.001} value={dive}
            aria-label="zoom into the drop"
            onChange={(e) => onDive(Number(e.target.value))}
          />
        </label>
        <button type="button" className="drop-pill drop-act" onClick={onSplit} aria-label="split the droplet">split</button>
        <button type="button" className="drop-pill drop-act" onClick={onMerge} aria-label="gather droplets back together">gather</button>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .drop-sphere {
          position: fixed;
          inset: 0;
          overflow: hidden;
          min-height: 100svh;
          background: #010407;
          color: rgba(224, 244, 250, 0.94);
          isolation: isolate;
          touch-action: none;
          -webkit-user-select: none;
          user-select: none;
          -webkit-tap-highlight-color: transparent;
          cursor: grab;
        }
        .drop-sphere:active { cursor: grabbing; }

        .drop-canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
        }
        .drop-micro { z-index: 0; }
        .drop-glass { z-index: 1; pointer-events: none; }

        .drop-fallback {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          z-index: 0;
        }
        .drop-fallback-orb {
          width: min(60vmin, 500px);
          height: min(60vmin, 500px);
          border-radius: 999px;
          background:
            radial-gradient(34% 30% at 40% 34%, rgba(255,255,255,0.95), rgba(180,240,255,0.4) 26%, rgba(60,150,180,0.28) 52%, rgba(6,26,34,0.6) 78%, rgba(2,10,14,0.2) 100%);
          box-shadow: inset 0 0 70px rgba(150,230,255,0.28), inset -14px -18px 60px rgba(0,0,0,0.5), 0 0 90px rgba(80,190,230,0.22);
        }

        .drop-title {
          position: fixed;
          z-index: 3;
          top: 78px;
          left: var(--pad-x);
          pointer-events: none;
        }
        .drop-title span {
          display: block;
          margin-bottom: 8px;
          color: rgba(190, 226, 240, 0.5);
          font-family: var(--font-mono);
          font-size: 11px;
          line-height: 1;
          text-transform: lowercase;
        }
        .drop-title strong {
          display: block;
          color: rgba(232, 248, 255, 0.96);
          font-family: var(--font-serif);
          font-size: 132px;
          font-weight: 500;
          line-height: 0.86;
          text-shadow: 0 0 40px rgba(90, 200, 240, 0.35);
        }

        .drop-readout {
          position: fixed;
          z-index: 4;
          left: 50%;
          transform: translateX(-50%);
          bottom: calc(92px + env(safe-area-inset-bottom, 0px));
          padding: 7px 14px;
          border: 1px solid rgba(160, 220, 240, 0.16);
          border-radius: 999px;
          background: rgba(4, 16, 22, 0.5);
          color: rgba(214, 240, 250, 0.82);
          font-family: var(--font-mono);
          font-size: 11px;
          letter-spacing: 0.02em;
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          pointer-events: none;
          white-space: nowrap;
        }

        .drop-console {
          position: fixed;
          z-index: 4;
          left: 50%;
          transform: translateX(-50%);
          bottom: calc(24px + env(safe-area-inset-bottom, 0px));
          display: flex;
          gap: 10px;
          padding: 8px;
          border: 1px solid rgba(160, 220, 240, 0.14);
          border-radius: 999px;
          background: rgba(4, 16, 22, 0.52);
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
          pointer-events: auto;
          max-width: calc(100vw - 24px);
          flex-wrap: wrap;
          justify-content: center;
        }

        .drop-pill {
          display: flex;
          align-items: center;
          gap: 10px;
          min-height: 48px;
          padding: 0 16px;
          border: 0;
          border-radius: 999px;
          background: rgba(224, 244, 250, 0.05);
          font-family: var(--font-mono);
          font-size: 11px;
          color: rgba(206, 236, 246, 0.72);
          text-transform: lowercase;
        }
        .drop-act {
          min-width: 64px;
          justify-content: center;
          cursor: pointer;
          letter-spacing: 0.04em;
          color: rgba(224, 246, 252, 0.9);
        }
        .drop-act:hover { background: rgba(120, 220, 250, 0.14); }
        .drop-act:active { background: rgba(120, 220, 250, 0.22); }
        .drop-pill span { flex: none; }
        .drop-pill em {
          width: 16px;
          height: 16px;
          border-radius: 999px;
          box-shadow: 0 0 12px currentColor;
        }
        .drop-pill input {
          -webkit-appearance: none;
          appearance: none;
          width: 130px;
          height: 28px;
          margin: 0;
          background: transparent;
          cursor: pointer;
        }
        .drop-hue input::-webkit-slider-runnable-track {
          height: 4px; border-radius: 999px;
          background: linear-gradient(90deg, #8fe9ff 0%, #79e6a2 50%, #49bcd8 100%);
        }
        .drop-hue input::-moz-range-track {
          height: 4px; border-radius: 999px;
          background: linear-gradient(90deg, #8fe9ff 0%, #79e6a2 50%, #49bcd8 100%);
        }
        .drop-dive-pill input::-webkit-slider-runnable-track {
          height: 4px; border-radius: 999px;
          background: linear-gradient(90deg, rgba(120,220,250,0.25), rgba(230,250,255,0.9));
        }
        .drop-dive-pill input::-moz-range-track {
          height: 4px; border-radius: 999px;
          background: linear-gradient(90deg, rgba(120,220,250,0.25), rgba(230,250,255,0.9));
        }
        .drop-pill input::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 16px; height: 16px; margin-top: -6px;
          border: 0; border-radius: 999px; background: #eafcff;
          box-shadow: 0 0 14px rgba(150, 230, 255, 0.9); cursor: pointer;
        }
        .drop-pill input::-moz-range-thumb {
          width: 16px; height: 16px; border: 0; border-radius: 999px;
          background: #eafcff; box-shadow: 0 0 14px rgba(150, 230, 255, 0.9); cursor: pointer;
        }

        body:has(.drop-sphere) { overflow: hidden; background: #010407; }
        body:has(.drop-sphere) header:not(.oda-site-header) { display: none !important; }
        body:has(.drop-sphere) .oda-field-watch,
        body:has(.drop-sphere) .oda-candle-mark,
        body:has(.drop-sphere) .oda-tape-shell,
        body:has(.drop-sphere) .oda-sound-toggle { display: none !important; }

        @media (max-width: 820px) {
          .drop-title { top: 34px; left: 22px; }
          .drop-title strong { font-size: 80px; }
          .drop-readout { bottom: calc(150px + env(safe-area-inset-bottom, 0px)); }
          .drop-pill input { width: 40vw; max-width: 160px; }
        }

        @media (max-width: 520px) {
          .drop-title strong { font-size: 60px; }
          .drop-pill { padding: 0 12px; }
          .drop-pill input { width: 34vw; max-width: 150px; }
        }
      `,
        }}
      />
    </div>
  );
}

// ── 2D glass fallback (only when WebGL is unavailable) ────────────────
function draw2DGlass(ctx: CanvasRenderingContext2D, d: Drop, tr: number, tg: number, tb: number) {
  const g = ctx.createRadialGradient(d.cx - d.r * 0.3, d.cy - d.r * 0.3, d.r * 0.2, d.cx, d.cy, d.r);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.78, `rgba(${tr},${tg},${tb},0)`);
  g.addColorStop(0.95, `rgba(${tr},${tg},${tb},0.35)`);
  g.addColorStop(1, "rgba(240,252,255,0.5)");
  ctx.fillStyle = g;
  ctx.fillRect(d.cx - d.r, d.cy - d.r, d.r * 2, d.r * 2);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.ellipse(d.cx - d.r * 0.34, d.cy - d.r * 0.4, d.r * 0.08, d.r * 0.055, -0.5, 0, TAU);
  ctx.fill();
}

// ── procedural microbe drawing ────────────────────────────────────────
function drawMicrobe(
  ctx: CanvasRenderingContext2D, b: Microbe,
  x: number, y: number, s: number, alpha: number,
  tr: number, tg: number, tb: number, time: number, reduced: boolean,
) {
  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.translate(x, y);
  const fill = `rgba(${tr},${tg},${tb},`;
  const line = `rgba(${Math.round(tr * 0.7 + 60)},${Math.round(tg * 0.7 + 70)},${Math.round(tb * 0.7 + 60)},`;
  const t = reduced ? time * 0.35 : time;

  switch (b.type) {
    case "mote": {
      ctx.beginPath();
      ctx.arc(0, 0, s, 0, TAU);
      ctx.fillStyle = `${fill}0.5)`;
      ctx.fill();
      break;
    }
    case "bacterium": {
      ctx.rotate(Math.atan2(b.hy, b.hx));
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 2.2, s, 0, 0, TAU);
      ctx.fillStyle = `${fill}0.55)`;
      ctx.fill();
      break;
    }
    case "paramecium": {
      ctx.rotate(Math.atan2(b.hy, b.hx));
      ctx.beginPath();
      ctx.moveTo(-s, 0);
      ctx.bezierCurveTo(-s * 0.8, -s * 0.72, s * 0.7, -s * 0.6, s * 1.15, 0);
      ctx.bezierCurveTo(s * 0.7, s * 0.6, -s * 0.8, s * 0.72, -s, 0);
      ctx.closePath();
      ctx.fillStyle = `${fill}0.32)`;
      ctx.fill();
      ctx.lineWidth = Math.max(0.6, s * 0.05);
      ctx.strokeStyle = `${line}0.5)`;
      ctx.stroke();
      ctx.strokeStyle = `${line}0.4)`;
      ctx.lineWidth = Math.max(0.4, s * 0.035);
      const cn = 22;
      for (let i = 0; i < cn; i++) {
        const u = i / cn;
        const px = mix(-s, s * 1.15, u);
        const edge = Math.sqrt(Math.max(0, 1 - (px / (s * 1.1)) ** 2)) * s * 0.66;
        const beat = Math.sin(t * 6 + i * 0.8) * s * 0.14;
        for (const sgn of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(px, sgn * edge);
          ctx.lineTo(px + beat, sgn * (edge + s * 0.2));
          ctx.stroke();
        }
      }
      ctx.beginPath();
      ctx.arc(s * 0.2, 0, s * 0.14, 0, TAU);
      ctx.fillStyle = `${fill}0.3)`;
      ctx.fill();
      break;
    }
    case "amoeba": {
      const lobes = 7;
      ctx.beginPath();
      for (let i = 0; i <= lobes; i++) {
        const a = (i / lobes) * TAU;
        const pseudo = 1 + 0.42 * Math.sin(a * 2 + t * 1.1 + b.seed) + 0.24 * Math.sin(a * 3 - t * 0.7);
        const rr = s * pseudo;
        const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = `${fill}0.22)`;
      ctx.fill();
      ctx.lineWidth = Math.max(0.5, s * 0.04);
      ctx.strokeStyle = `${line}0.4)`;
      ctx.stroke();
      const rnd = mulberry32(Math.floor(b.seed * 97));
      ctx.fillStyle = `${fill}0.5)`;
      for (let i = 0; i < 10; i++) {
        const a = rnd() * TAU, rr = rnd() * s * 0.7;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, s * 0.08, 0, TAU);
        ctx.fill();
      }
      break;
    }
    case "diatom": {
      ctx.rotate(b.ang);
      ctx.beginPath();
      ctx.arc(0, 0, s, 0, TAU);
      ctx.fillStyle = `${fill}0.16)`;
      ctx.fill();
      ctx.lineWidth = Math.max(0.6, s * 0.05);
      const grd = ctx.createLinearGradient(-s, -s, s, s);
      grd.addColorStop(0, "rgba(210,235,180,0.6)");
      grd.addColorStop(1, "rgba(150,220,210,0.5)");
      ctx.strokeStyle = grd;
      ctx.stroke();
      const spokes = 12;
      for (let i = 0; i < spokes; i++) {
        const a = (i / spokes) * TAU;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * s, Math.sin(a) * s);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.5, 0, TAU);
      ctx.stroke();
      break;
    }
    case "rotifer": {
      ctx.rotate(Math.atan2(b.hy, b.hx) + Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(-s * 0.5, -s);
      ctx.quadraticCurveTo(-s * 0.7, s * 0.4, -s * 0.25, s * 1.1);
      ctx.lineTo(s * 0.25, s * 1.1);
      ctx.quadraticCurveTo(s * 0.7, s * 0.4, s * 0.5, -s);
      ctx.closePath();
      ctx.fillStyle = `${fill}0.24)`;
      ctx.fill();
      ctx.lineWidth = Math.max(0.5, s * 0.04);
      ctx.strokeStyle = `${line}0.45)`;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.12, s * 1.1); ctx.lineTo(-s * 0.28, s * 1.5);
      ctx.moveTo(s * 0.12, s * 1.1); ctx.lineTo(s * 0.28, s * 1.5);
      ctx.stroke();
      for (const sgn of [-1, 1]) {
        ctx.save();
        ctx.translate(sgn * s * 0.34, -s);
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.34, 0, TAU);
        ctx.fillStyle = `${fill}0.3)`;
        ctx.fill();
        const spin = reduced ? b.ang * 0.3 : b.ang * 2;
        ctx.strokeStyle = `${line}0.5)`;
        ctx.lineWidth = Math.max(0.4, s * 0.03);
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * TAU + spin;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(a) * s * 0.34, Math.sin(a) * s * 0.34);
          ctx.stroke();
        }
        ctx.restore();
      }
      break;
    }
    case "tardigrade": {
      ctx.rotate(Math.atan2(b.hy, b.hx));
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 1.15, s * 0.72, 0, 0, TAU);
      ctx.fillStyle = `${fill}0.3)`;
      ctx.fill();
      ctx.lineWidth = Math.max(0.6, s * 0.05);
      ctx.strokeStyle = `${line}0.5)`;
      ctx.stroke();
      for (let i = -1; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(i * s * 0.32, -s * 0.55);
        ctx.quadraticCurveTo(i * s * 0.32 + s * 0.05, 0, i * s * 0.32, s * 0.55);
        ctx.stroke();
      }
      ctx.lineWidth = Math.max(0.8, s * 0.11);
      ctx.lineCap = "round";
      for (let i = 0; i < 4; i++) {
        const lx = mix(-s * 0.85, s * 0.85, i / 3);
        const swing = Math.sin(t * 3 + i * 1.3) * s * 0.14;
        for (const sgn of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(lx, sgn * s * 0.5);
          ctx.lineTo(lx + swing, sgn * s * 0.92);
          ctx.stroke();
        }
      }
      ctx.lineCap = "butt";
      break;
    }
    case "euglena": {
      const flex = Math.sin(t * 2.2 + b.seed) * 0.5;
      ctx.rotate(Math.atan2(b.hy, b.hx) + flex * 0.25);
      ctx.beginPath();
      ctx.moveTo(-s * 1.2, 0);
      ctx.quadraticCurveTo(0, -s * 0.5 * (1 + flex), s * 1.2, 0);
      ctx.quadraticCurveTo(0, s * 0.5 * (1 - flex), -s * 1.2, 0);
      ctx.closePath();
      const gg = ctx.createLinearGradient(-s, 0, s, 0);
      gg.addColorStop(0, "rgba(120,210,120,0.4)");
      gg.addColorStop(1, "rgba(90,190,140,0.35)");
      ctx.fillStyle = gg;
      ctx.fill();
      ctx.lineWidth = Math.max(0.5, s * 0.04);
      ctx.strokeStyle = "rgba(150,220,150,0.5)";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s * 0.85, -s * 0.12, s * 0.14, 0, TAU);
      ctx.fillStyle = "rgba(255,90,70,0.85)";
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(s * 1.15, 0);
      const whip = Math.sin(t * 8 + b.seed) * s * 0.5;
      ctx.quadraticCurveTo(s * 1.7, whip, s * 2.2, -whip * 0.6);
      ctx.strokeStyle = "rgba(180,230,180,0.5)";
      ctx.lineWidth = Math.max(0.4, s * 0.03);
      ctx.stroke();
      break;
    }
    case "volvox": {
      const spin = reduced ? b.ang * 0.3 : b.ang;
      ctx.beginPath();
      ctx.arc(0, 0, s, 0, TAU);
      const vg = ctx.createRadialGradient(-s * 0.3, -s * 0.3, s * 0.1, 0, 0, s);
      vg.addColorStop(0, "rgba(160,230,150,0.28)");
      vg.addColorStop(1, "rgba(80,180,120,0.12)");
      ctx.fillStyle = vg;
      ctx.fill();
      ctx.lineWidth = Math.max(0.5, s * 0.03);
      ctx.strokeStyle = "rgba(150,220,150,0.5)";
      ctx.stroke();
      const rnd = mulberry32(Math.floor(b.seed * 53));
      ctx.fillStyle = "rgba(120,210,140,0.6)";
      for (let i = 0; i < 22; i++) {
        const a = rnd() * TAU + spin, rr = s * (0.55 + rnd() * 0.4);
        ctx.beginPath();
        ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, s * 0.06, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = "rgba(140,220,150,0.3)";
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU + spin * 0.5;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * s * 0.35, Math.sin(a) * s * 0.35, s * 0.16, 0, TAU);
        ctx.fill();
      }
      break;
    }
  }
  ctx.restore();
}
