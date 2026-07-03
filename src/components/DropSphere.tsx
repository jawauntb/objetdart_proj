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

// ── Palette anchors ────────────────────────────────────────────────────
// The hue control sweeps a single 0..1 axis across three galaxies:
// violet (the reference default) → teal → ember. Kept in sync with the
// palette() function in the fragment shader below.
const HUE_STOPS: Array<{ at: number; name: string; swatch: string }> = [
  { at: 0.0, name: "violet", swatch: "#b26bff" },
  { at: 0.5, name: "teal", swatch: "#3fe0c8" },
  { at: 1.0, name: "ember", swatch: "#ff9a4a" },
];

function hueName(h: number): string {
  if (h < 0.34) return "violet";
  if (h < 0.67) return "teal";
  return "ember";
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

// ── Shaders ────────────────────────────────────────────────────────────
const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// __STEPS__ / __OCT__ are string-substituted at compile so mobile can run a
// lighter march. Everything else is device-independent.
const FRAG = `
precision highp float;

uniform vec2  uRes;
uniform float uTime;
uniform float uYaw;
uniform float uPitch;
uniform float uZoom;      // 0..~1.2 dive depth
uniform float uDiveVel;   // streak amount while diving
uniform float uHue;       // 0..1 palette axis
uniform float uReduced;   // 1 when prefers-reduced-motion
uniform vec3  uSnPos[6];  // supernova seeds, galaxy-local
uniform float uSnAge[6];  // seconds since birth; <0 = inactive
uniform float uSnSeed[6];

#define STEPS __STEPS__
#define OCT __OCT__
#define PI 3.14159265

float hash31(vec3 p) {
  p = fract(p * vec3(127.1, 311.7, 74.7));
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
vec3 hash33(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
           dot(p, vec3(269.5, 183.3, 246.1)),
           dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453);
}
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash31(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash31(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
             mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < OCT; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c); }

void palette(float h, out vec3 deep, out vec3 mid, out vec3 hot) {
  vec3 d0 = vec3(0.10, 0.03, 0.30), m0 = vec3(0.52, 0.14, 0.78), h0 = vec3(1.00, 0.74, 1.00); // violet
  vec3 d1 = vec3(0.02, 0.14, 0.22), m1 = vec3(0.10, 0.56, 0.60), h1 = vec3(0.72, 1.00, 0.95); // teal
  vec3 d2 = vec3(0.22, 0.05, 0.02), m2 = vec3(0.82, 0.28, 0.07), h2 = vec3(1.00, 0.84, 0.52); // ember
  float t = fract(h) * 2.0;
  if (t < 1.0) { deep = mix(d0, d1, t); mid = mix(m0, m1, t); hot = mix(h0, h1, t); }
  else { float u = t - 1.0; deep = mix(d1, d2, u); mid = mix(m1, m2, u); hot = mix(h1, h2, u); }
}

// A star cell — one point per grid cell, jittered, elongated along the radial
// direction when diving so stars streak past the camera.
float starLayer(vec3 p, float scale, float thresh, float streak) {
  vec3 q = p * scale;
  vec3 c = floor(q);
  vec3 f = fract(q) - 0.5;
  float h = hash31(c + scale);
  if (h < thresh) return 0.0;
  vec3 j = hash33(c + scale * 1.7) - 0.5;
  vec3 d = f - j * 0.6;
  vec3 rad = normalize(p + 1e-4);
  float along = dot(d, rad);
  vec3 perp = d - along * rad;
  float dist = length(vec2(length(perp), along / (1.0 + streak * 7.0)));
  float star = smoothstep(0.16, 0.0, dist);
  return star * (0.35 + 0.65 * fract(h * 41.0));
}

vec3 marchGalaxy(vec3 ro, vec3 rd, mat3 rot, float t1, vec2 frag) {
  vec3 col = vec3(0.0);
  float trans = 1.0;
  float dt = t1 / float(STEPS);
  float jitter = hash31(vec3(frag, uTime));
  float t = dt * jitter;
  float streak = uDiveVel;
  float drift = uTime * 0.02 * (1.0 - 0.7 * uReduced);
  vec3 deep, mid, hot; palette(uHue, deep, mid, hot);
  for (int i = 0; i < STEPS; i++) {
    vec3 p = rot * (ro + rd * t);
    float r = length(p);
    // A BROAD, soft, saturated violet→magenta nebula body occupying much of
    // the interior: gentle radial falloff (present across most of the sphere,
    // ~black by the rim) modulated by noise + spiral dust lanes. Kept at LOW
    // gain and coloured only from deep/mid so the magenta never washes white.
    float n = fbm(p * 2.4 + vec3(0.0, drift, 0.0));
    float ang = atan(p.z, p.x);
    float arms = 0.5 + 0.5 * sin(ang * 2.0 + r * 8.0 - drift * 2.0);
    float body = exp(-r * r * 1.7);
    float cloud = (0.30 + 0.70 * n) * (0.55 + 0.45 * arms);
    float density = body * cloud;
    vec3 nebCol = mix(deep * 1.4, mid, smoothstep(0.10, 0.95, cloud));
    // SMALL, tight, white-hot core — the ONLY thing allowed to clip to white.
    float core = exp(-r * r * 42.0);
    vec3 coreCol = mix(hot, vec3(1.0), 0.5) * core * 5.0;
    // crisp, high-contrast star field + a few bright foreground stars
    float st = starLayer(p, 6.5, 0.90, streak) * 1.6
             + starLayer(p * 1.9 + 9.0, 12.0, 0.93, streak) * 1.1
             + starLayer(p * 0.7 - 4.0, 3.4, 0.86, streak) * 2.4;
    vec3 starCol = vec3(0.92, 0.95, 1.0) * st;
    // supernova blooms + spray
    vec3 snCol = vec3(0.0);
    for (int s = 0; s < 6; s++) {
      float age = uSnAge[s];
      if (age < 0.0) continue;
      vec3 dd = p - uSnPos[s];
      float rr = 0.05 + age * 0.55;
      float fall = exp(-dot(dd, dd) / (rr * rr));
      float life = exp(-age * 1.5);
      snCol += (hot + vec3(0.5)) * fall * life * 2.2;
      float ring = smoothstep(0.07, 0.0, abs(length(dd) - rr)) * life;
      float spk = step(0.55, hash31(floor(dd * 42.0) + vec3(uSnSeed[s])));
      snCol += vec3(1.0) * ring * spk * 0.7;
    }
    float emit = density;
    vec3 c = nebCol * emit * 1.1 + coreCol + starCol + snCol;
    col += trans * c * dt * 3.2;
    trans *= 1.0 - clamp(emit * dt * 1.6, 0.0, 0.85);
    t += dt;
    if (trans < 0.02) break;
  }
  return col;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = (frag - 0.5 * uRes) / uRes.y;
  float z = clamp(uZoom, 0.0, 1.0);
  // Camera sits far back so the orb floats CONTAINED in black (~0.34 of the
  // short side) with generous margin; diving pulls in toward the swelling core.
  float camDist = mix(6.8, 3.4, z);
  float focal = mix(2.3, 2.4, z);
  vec3 ro = vec3(0.0, 0.0, camDist);
  vec3 rd = normalize(vec3(uv, -focal));
  float R = 1.0;
  float b = dot(ro, rd);
  float c = dot(ro, ro) - R * R;
  float disc = b * b - c;
  vec3 deep, mid, hot; palette(uHue, deep, mid, hot);
  vec3 color = vec3(0.0);

  if (disc > 0.0) {
    float sq = sqrt(disc);
    float t0 = -b - sq;
    vec3 p0 = ro + rd * t0;
    vec3 n = normalize(p0);
    mat3 rot = rotX(uPitch) * rotY(uYaw);
    float fres = pow(1.0 - max(dot(-rd, n), 0.0), 4.0);

    // chromatic aberration — three IORs split the interior at the rim
    vec3 rdR = refract(rd, n, 1.0 / 1.435);
    vec3 rdG = refract(rd, n, 1.0 / 1.46);
    vec3 rdB = refract(rd, n, 1.0 / 1.49);
    float texR = -2.0 * dot(p0, rdR);
    float texG = -2.0 * dot(p0, rdG);
    float texB = -2.0 * dot(p0, rdB);
    vec3 cR = marchGalaxy(p0, rdR, rot, texR, frag);
    vec3 cG = marchGalaxy(p0, rdG, rot, texG, frag);
    vec3 cB = marchGalaxy(p0, rdB, rot, texB, frag);
    color = vec3(cR.r, cG.g, cB.b);

    // glass: fresnel rim, palette rim tint, crisp specular
    color += vec3(0.9, 0.95, 1.0) * pow(fres, 1.6) * 0.30;
    color += mid * fres * 0.20;
    vec3 L = normalize(vec3(-0.5, 0.72, 0.62));
    float spec = pow(max(dot(reflect(rd, n), L), 0.0), 64.0);
    color += vec3(1.0) * spec * 0.85;

    // chromatic sparkle flecks near the rim where light splits
    float rimband = smoothstep(0.5, 1.0, fres);
    vec3 flk = hash33(vec3(floor(frag * 0.5), floor(uTime * 9.0)));
    float fsp = step(0.991, flk.x) * rimband;
    color += vec3(flk.y, flk.z, 1.0 - flk.y * 0.5) * fsp * 0.9;
  } else {
    // outside: pure black with a faint palette halo hugging the silhouette
    vec3 pc = ro + rd * max(-b, 0.0);
    float dd = length(pc);
    // tight halo hugging the rim so the surrounding black stays pure
    float halo = exp(-(dd - R) * 13.0);
    color += mid * halo * 0.13;
    // whisper of background stars for depth
    float bg = step(0.9994, hash31(vec3(floor(uv * 1100.0), 1.0)));
    color += vec3(0.7, 0.75, 0.9) * bg * 0.45;
  }

  // Gentle per-channel tonemap: nebula gains are low enough that magenta
  // stays magenta (channels well below 1). Only the tiny core exceeds 1 and
  // clips to white. A mild gamma keeps deep space near-black and saturated.
  color = color / (0.6 + color);
  color = pow(color, vec3(1.1));
  gl_FragColor = vec4(color, 1.0);
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

const SN_MAX = 6;
const SN_LIFE = 2.4;

type Supernova = { x: number; y: number; z: number; born: number; seed: number };

export default function DropSphere() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const reduceRef = useRef(false);
  const rotRef = useRef({ yaw: 0.4, pitch: -0.18, velYaw: 0, velPitch: 0 });
  const zoomRef = useRef({ slider: 0, impulse: 0, current: 0, vel: 0 });
  const hueRef = useRef(0);
  const snRef = useRef<Supernova[]>([]);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const dragRef = useRef({
    id: -1,
    lastX: 0,
    lastY: 0,
    lastT: 0,
    downX: 0,
    downY: 0,
    downT: 0,
    moved: 0,
    vx: 0,
    vy: 0,
    throttle: 0,
  });
  const twoRef = useRef({ active: false, lastY: 0 });
  const diveThrottleRef = useRef(0);
  const startRef = useRef(0);

  const [hue, setHue] = useState(0);
  const [dive, setDive] = useState(0);
  const [readout, setReadout] = useState("violet · rest");
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

  // ── WebGL setup + render loop ─────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;

    let gl: GL | null = null;
    try {
      gl = (canvas.getContext("webgl", { alpha: false, antialias: false, premultipliedAlpha: false })
        || canvas.getContext("experimental-webgl")) as GL | null;
    } catch { gl = null; }
    if (!gl) { setFallback(true); return; }

    const coarse = window.matchMedia("(pointer: coarse)").matches
      || window.matchMedia("(max-width: 820px)").matches;
    const steps = coarse ? 12 : 22;
    const oct = coarse ? 4 : 5;
    const fragSrc = FRAG.replace(/__STEPS__/g, String(steps)).replace(/__OCT__/g, String(oct));

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
    if (!vs || !fs) { setFallback(true); return; }
    const prog = gl.createProgram();
    if (!prog) { setFallback(true); return; }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      // eslint-disable-next-line no-console
      console.warn("drop link", gl.getProgramInfoLog(prog));
      setFallback(true);
      return;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const U = {
      res: gl.getUniformLocation(prog, "uRes"),
      time: gl.getUniformLocation(prog, "uTime"),
      yaw: gl.getUniformLocation(prog, "uYaw"),
      pitch: gl.getUniformLocation(prog, "uPitch"),
      zoom: gl.getUniformLocation(prog, "uZoom"),
      diveVel: gl.getUniformLocation(prog, "uDiveVel"),
      hue: gl.getUniformLocation(prog, "uHue"),
      reduced: gl.getUniformLocation(prog, "uReduced"),
      snPos: gl.getUniformLocation(prog, "uSnPos"),
      snAge: gl.getUniformLocation(prog, "uSnAge"),
      snSeed: gl.getUniformLocation(prog, "uSnSeed"),
    };

    let w = 0, h = 0, dpr = 1;
    const resize = () => {
      const rect = root.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 1.75);
      w = Math.max(320, Math.floor(rect.width));
      h = Math.max(420, Math.floor(rect.height));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      gl!.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    const obs = new ResizeObserver(resize);
    obs.observe(root);
    window.addEventListener("resize", resize);

    startRef.current = performance.now();
    let last = startRef.current;
    let raf = 0;
    let readoutAt = 0;

    const snPos = new Float32Array(SN_MAX * 3);
    const snAge = new Float32Array(SN_MAX);
    const snSeed = new Float32Array(SN_MAX);

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const time = (now - startRef.current) / 1000;
      const reduced = reduceRef.current;
      const rot = rotRef.current;
      const dragging = dragRef.current.id !== -1 || twoRef.current.active;

      // rotation inertia + idle drift
      if (!dragging) {
        rot.yaw += rot.velYaw * dt;
        rot.pitch = clamp(rot.pitch + rot.velPitch * dt, -1.35, 1.35);
        const decay = Math.exp(-dt * (reduced ? 6 : 1.6));
        rot.velYaw *= decay;
        rot.velPitch *= decay;
        const drift = reduced ? 0.014 : 0.05;
        rot.yaw += drift * dt;
      }

      // dive easing
      const zs = zoomRef.current;
      zs.impulse *= Math.exp(-dt * 2.2);
      const target = clamp(zs.slider + zs.impulse, 0, 1);
      const prev = zs.current;
      zs.current = mix(zs.current, target, 1 - Math.exp(-dt * 6));
      zs.vel = clamp(Math.abs(zs.current - prev) / Math.max(dt, 0.001) * 0.5, 0, 1.4);

      // pack supernovae
      const list = snRef.current;
      for (let i = 0; i < SN_MAX; i++) {
        const sn = list[i];
        if (sn && time - sn.born < SN_LIFE) {
          snPos[i * 3] = sn.x; snPos[i * 3 + 1] = sn.y; snPos[i * 3 + 2] = sn.z;
          snAge[i] = time - sn.born;
          snSeed[i] = sn.seed;
        } else {
          snAge[i] = -1;
        }
      }

      gl!.uniform2f(U.res, canvas.width, canvas.height);
      gl!.uniform1f(U.time, time);
      gl!.uniform1f(U.yaw, rot.yaw);
      gl!.uniform1f(U.pitch, rot.pitch);
      gl!.uniform1f(U.zoom, zs.current);
      gl!.uniform1f(U.diveVel, zs.vel);
      gl!.uniform1f(U.hue, hueRef.current);
      gl!.uniform1f(U.reduced, reduced ? 1 : 0);
      gl!.uniform3fv(U.snPos, snPos);
      gl!.uniform1fv(U.snAge, snAge);
      gl!.uniform1fv(U.snSeed, snSeed);
      gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);

      if (now - readoutAt > 180) {
        readoutAt = now;
        const depth = zs.current;
        const spin = Math.abs(rot.velYaw) + Math.abs(rot.velPitch);
        const state = depth > 0.04 ? `dive ${depth.toFixed(2)}` : spin > 0.25 ? "spinning" : "rest";
        setReadout(`${hueName(hueRef.current)} · ${state}`);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    // wheel dive (non-passive so we can swallow page scroll)
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomRef.current.impulse = clamp(zoomRef.current.impulse - e.deltaY * 0.0009, -0.2, 1);
      const now = performance.now();
      if (now - diveThrottleRef.current > 90) {
        diveThrottleRef.current = now;
        const depth = clamp(zoomRef.current.slider + zoomRef.current.impulse, 0, 1);
        try { getFieldAudio().playTone(70 + depth * 90, 0.18); } catch { /* noop */ }
        try { haptics.chop(); } catch { /* noop */ }
        recordTape("sigil", 0.3 + depth * 0.5, "drop/dive");
      }
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf);
      obs.disconnect();
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("wheel", onWheel);
      try {
        gl!.deleteProgram(prog);
        gl!.deleteShader(vs);
        gl!.deleteShader(fs);
        gl!.deleteBuffer(buf);
      } catch { /* noop */ }
    };
  }, [recordTape]);

  // ── Screen point → galaxy-local sphere point (mirrors the shader) ──────
  const localHit = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const aspect = rect.width / Math.max(1, rect.height);
    const uvx = ((clientX - rect.left) / Math.max(1, rect.width) - 0.5) * aspect;
    const uvy = 0.5 - (clientY - rect.top) / Math.max(1, rect.height);
    const z = clamp(zoomRef.current.current, 0, 1);
    const camDist = mix(6.8, 3.4, z);
    const focal = mix(2.3, 2.4, z);
    const inv = 1 / Math.hypot(uvx, uvy, focal);
    const rd = [uvx * inv, uvy * inv, -focal * inv];
    const ro = [0, 0, camDist];
    const b = ro[0] * rd[0] + ro[1] * rd[1] + ro[2] * rd[2];
    const c = camDist * camDist - 1;
    const disc = b * b - c;
    let hx: number, hy: number, hz: number;
    if (disc > 0) {
      const t0 = -b - Math.sqrt(disc);
      hx = ro[0] + rd[0] * t0; hy = ro[1] + rd[1] * t0; hz = ro[2] + rd[2] * t0;
    } else {
      const tc = Math.max(-b, 0);
      const px = ro[0] + rd[0] * tc, py = ro[1] + rd[1] * tc, pz = ro[2] + rd[2] * tc;
      const l = Math.hypot(px, py, pz) || 1;
      hx = px / l; hy = py / l; hz = pz / l;
    }
    // rotate into galaxy-local space: rotX(pitch) * rotY(yaw) * hit
    const { yaw, pitch } = rotRef.current;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const rx = cy * hx - sy * hz;
    const rz = sy * hx + cy * hz;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const fy = cp * hy - sp * rz;
    const fz = sp * hy + cp * rz;
    return { x: rx, y: fy, z: fz };
  }, []);

  const spawnSupernova = useCallback((clientX: number, clientY: number) => {
    const p = localHit(clientX, clientY);
    if (!p) return;
    const time = (performance.now() - startRef.current) / 1000;
    const sn: Supernova = { ...p, born: time, seed: Math.random() * 100 };
    const list = snRef.current;
    list.push(sn);
    if (list.length > SN_MAX) list.splice(0, list.length - SN_MAX);
    try { getFieldAudio().bell(); getFieldAudio().chime(); } catch { /* noop */ }
    try { haptics.storm(); } catch { /* noop */ }
    recordTape("object", 0.85, "drop/supernova");
    setReadout(`${hueName(hueRef.current)} · supernova`);
  }, [localHit, recordTape]);

  // ── Pointer gestures ──────────────────────────────────────────────────
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const map = pointersRef.current;
    map.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
    if (map.size >= 2) {
      // two-finger dive
      twoRef.current.active = true;
      let sum = 0; map.forEach((v) => { sum += v.y; });
      twoRef.current.lastY = sum / map.size;
      dragRef.current.id = -1;
      return;
    }
    const d = dragRef.current;
    d.id = e.pointerId;
    d.lastX = e.clientX; d.lastY = e.clientY; d.lastT = performance.now();
    d.downX = e.clientX; d.downY = e.clientY; d.downT = performance.now();
    d.moved = 0; d.vx = 0; d.vy = 0;
    // stop existing spin on grab
    rotRef.current.velYaw = 0; rotRef.current.velPitch = 0;
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const map = pointersRef.current;
    if (!map.has(e.pointerId)) return;
    map.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (twoRef.current.active && map.size >= 2) {
      let sum = 0; map.forEach((v) => { sum += v.y; });
      const avg = sum / map.size;
      const dy = avg - twoRef.current.lastY;
      twoRef.current.lastY = avg;
      zoomRef.current.impulse = clamp(zoomRef.current.impulse - dy * 0.004, -0.2, 1);
      const now = performance.now();
      if (now - diveThrottleRef.current > 90) {
        diveThrottleRef.current = now;
        const depth = clamp(zoomRef.current.slider + zoomRef.current.impulse, 0, 1);
        try { getFieldAudio().playTone(70 + depth * 90, 0.18); } catch { /* noop */ }
        try { haptics.chop(); } catch { /* noop */ }
        recordTape("sigil", 0.3 + depth * 0.5, "drop/dive");
      }
      return;
    }

    const d = dragRef.current;
    if (d.id !== e.pointerId) return;
    const now = performance.now();
    const dt = Math.max(1, now - d.lastT) / 1000;
    const dx = e.clientX - d.lastX;
    const dy = e.clientY - d.lastY;
    d.lastX = e.clientX; d.lastY = e.clientY; d.lastT = now;
    d.moved += Math.hypot(dx, dy);

    const k = 0.006;
    const rot = rotRef.current;
    rot.yaw += dx * k;
    rot.pitch = clamp(rot.pitch - dy * k, -1.35, 1.35);
    // instantaneous angular velocity estimate for flick release
    d.vx = mix(d.vx, (dx * k) / dt, 0.4);
    d.vy = mix(d.vy, (-dy * k) / dt, 0.4);

    if (now - d.throttle > 80) {
      d.throttle = now;
      const speed = clamp((Math.abs(dx) + Math.abs(dy)) / 40, 0, 1);
      try { getFieldAudio().playNote(52 + Math.round(rot.yaw * 4 + speed * 16), 70); } catch { /* noop */ }
      try { haptics.ripple(0.2 + speed * 0.3); } catch { /* noop */ }
      recordTape("ripple", 0.3 + speed * 0.4, "drop/rotate");
    }
  };

  const endPointer = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const map = pointersRef.current;
    const d = dragRef.current;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    const wasDrag = d.id === e.pointerId;
    map.delete(e.pointerId);

    if (twoRef.current.active) {
      if (map.size < 2) twoRef.current.active = false;
      return;
    }

    if (!wasDrag) return;
    d.id = -1;
    const now = performance.now();
    const dur = now - d.downT;
    // tap → supernova
    if (d.moved < 8 && dur < 320) {
      spawnSupernova(e.clientX, e.clientY);
      return;
    }
    // flick → inertial spin
    const reduced = reduceRef.current;
    if (!reduced) {
      const rot = rotRef.current;
      rot.velYaw = clamp(d.vx, -6, 6);
      rot.velPitch = clamp(d.vy, -6, 6);
      const mag = Math.hypot(rot.velYaw, rot.velPitch);
      if (mag > 0.4) {
        try { getFieldAudio().spark(); } catch { /* noop */ }
        try { haptics.roll(); } catch { /* noop */ }
        recordTape("ripple", clamp(0.3 + mag * 0.12, 0.3, 0.95), "drop/flick");
      }
    }
  };

  const onHue = (v: number) => {
    setHue(v);
    hueRef.current = v;
    try { getFieldAudio().playNote(60 + Math.round(v * 14), 130); } catch { /* noop */ }
    try { haptics.tap(); } catch { /* noop */ }
    recordTape("preset", 0.4 + v * 0.3, `drop/hue/${hueName(v)}`);
  };

  const onDive = (v: number) => {
    setDive(v);
    zoomRef.current.slider = v;
    const now = performance.now();
    if (now - diveThrottleRef.current > 90) {
      diveThrottleRef.current = now;
      try { getFieldAudio().playTone(70 + v * 90, 0.18); } catch { /* noop */ }
      try { haptics.chop(); } catch { /* noop */ }
      recordTape("sigil", 0.3 + v * 0.5, "drop/dive");
    }
  };

  return (
    <div
      ref={rootRef}
      className="drop-sphere"
      data-touch-surface="true"
      data-pretext-ignore="true"
      style={{ "--drop-accent": HUE_STOPS[0].swatch } as CSSProperties}
    >
      {!fallback && (
        <canvas
          ref={canvasRef}
          className="drop-canvas"
          role="img"
          aria-label="A glass sphere holding a galaxy. Drag to spin the cosmos inside, scroll or use the dive control to fall toward the core, tap to seed a supernova, and shift the hue."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
        />
      )}

      {fallback && (
        <div className="drop-fallback" data-drop-fallback="true" aria-hidden="true">
          <div className="drop-fallback-orb" />
        </div>
      )}

      <div className="drop-title" aria-hidden="true">
        <span>a cosmos held in glass</span>
        <strong>drop</strong>
      </div>

      <output className="drop-readout" aria-live="polite">{readout}</output>

      <div className="drop-console" aria-label="sphere controls">
        <label className="drop-pill drop-hue">
          <span>hue</span>
          <input
            type="range" min={0} max={1} step={0.001} value={hue}
            aria-label="nebula hue"
            onChange={(e) => onHue(Number(e.target.value))}
          />
          <em style={{ background: HUE_STOPS[0].swatch }} data-swatch />
        </label>
        <label className="drop-pill drop-dive-pill">
          <span>dive</span>
          <input
            type="range" min={0} max={1} step={0.001} value={dive}
            aria-label="dive toward the core"
            onChange={(e) => onDive(Number(e.target.value))}
          />
        </label>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .drop-sphere {
          position: fixed;
          inset: 0;
          overflow: hidden;
          min-height: 100svh;
          background: #000;
          color: rgba(244, 240, 255, 0.94);
          isolation: isolate;
          -webkit-user-select: none;
          user-select: none;
          -webkit-tap-highlight-color: transparent;
        }

        .drop-canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
          touch-action: none;
          cursor: grab;
          z-index: 0;
        }
        .drop-canvas:active { cursor: grabbing; }

        .drop-fallback {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          background: #000;
          z-index: 0;
        }
        .drop-fallback-orb {
          width: min(62vmin, 520px);
          height: min(62vmin, 520px);
          border-radius: 999px;
          background:
            radial-gradient(38% 34% at 42% 38%, rgba(255,255,255,0.95), rgba(255,214,255,0.55) 22%, rgba(150,60,220,0.55) 46%, rgba(40,10,70,0.9) 72%, #050208 100%),
            radial-gradient(120% 120% at 70% 78%, rgba(120,40,180,0.35), transparent 60%);
          box-shadow:
            inset 0 0 90px rgba(180,120,255,0.4),
            inset -18px -22px 80px rgba(0,0,0,0.75),
            0 0 120px rgba(150,70,230,0.35);
        }

        .drop-title {
          position: fixed;
          z-index: 2;
          top: 78px;
          left: var(--pad-x);
          pointer-events: none;
        }
        .drop-title span {
          display: block;
          margin-bottom: 8px;
          color: rgba(226, 220, 250, 0.5);
          font-family: var(--font-mono);
          font-size: 11px;
          line-height: 1;
          text-transform: lowercase;
        }
        .drop-title strong {
          display: block;
          color: rgba(246, 242, 255, 0.96);
          font-family: var(--font-serif);
          font-size: 132px;
          font-weight: 500;
          line-height: 0.86;
          text-shadow: 0 0 40px rgba(150, 90, 240, 0.35);
        }

        .drop-readout {
          position: fixed;
          z-index: 3;
          top: 92px;
          right: var(--pad-x);
          padding: 8px 14px;
          border: 1px solid rgba(210, 200, 255, 0.16);
          border-radius: 999px;
          background: rgba(10, 6, 20, 0.5);
          color: rgba(232, 226, 252, 0.8);
          font-family: var(--font-mono);
          font-size: 11px;
          letter-spacing: 0.02em;
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          pointer-events: none;
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
          border: 1px solid rgba(210, 200, 255, 0.14);
          border-radius: 999px;
          background: rgba(10, 6, 20, 0.52);
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
          pointer-events: auto;
        }

        .drop-pill {
          display: flex;
          align-items: center;
          gap: 10px;
          min-height: 48px;
          padding: 0 16px;
          border-radius: 999px;
          background: rgba(244, 240, 255, 0.05);
          font-family: var(--font-mono);
          font-size: 11px;
          color: rgba(226, 220, 250, 0.66);
          text-transform: lowercase;
        }
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
          width: 140px;
          height: 28px;
          margin: 0;
          background: transparent;
          cursor: pointer;
        }
        .drop-hue input::-webkit-slider-runnable-track {
          height: 4px;
          border-radius: 999px;
          background: linear-gradient(90deg, #b26bff 0%, #3fe0c8 50%, #ff9a4a 100%);
        }
        .drop-hue input::-moz-range-track {
          height: 4px;
          border-radius: 999px;
          background: linear-gradient(90deg, #b26bff 0%, #3fe0c8 50%, #ff9a4a 100%);
        }
        .drop-dive-pill input::-webkit-slider-runnable-track {
          height: 4px;
          border-radius: 999px;
          background: linear-gradient(90deg, rgba(150,90,240,0.25), rgba(255,255,255,0.85));
        }
        .drop-dive-pill input::-moz-range-track {
          height: 4px;
          border-radius: 999px;
          background: linear-gradient(90deg, rgba(150,90,240,0.25), rgba(255,255,255,0.85));
        }
        .drop-pill input::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          margin-top: -6px;
          border: 0;
          border-radius: 999px;
          background: #f6f2ff;
          box-shadow: 0 0 14px rgba(200, 170, 255, 0.9);
          cursor: pointer;
        }
        .drop-pill input::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border: 0;
          border-radius: 999px;
          background: #f6f2ff;
          box-shadow: 0 0 14px rgba(200, 170, 255, 0.9);
          cursor: pointer;
        }

        body:has(.drop-sphere) { overflow: hidden; background: #000; }
        body:has(.drop-sphere) header:not(.oda-site-header) { display: none !important; }
        body:has(.drop-sphere) .oda-field-watch,
        body:has(.drop-sphere) .oda-candle-mark,
        body:has(.drop-sphere) .oda-tape-shell,
        body:has(.drop-sphere) .oda-sound-toggle { display: none !important; }

        @media (max-width: 820px) {
          .drop-title { top: 34px; left: 22px; }
          .drop-title strong { font-size: 80px; }
          .drop-readout { top: 40px; }
          .drop-console { flex-direction: column; border-radius: 20px; }
          .drop-pill input { width: 132px; }
        }

        @media (max-width: 520px) {
          .drop-title strong { font-size: 60px; }
          .drop-pill input { width: 42vw; max-width: 180px; }
        }
      `,
        }}
      />
    </div>
  );
}
