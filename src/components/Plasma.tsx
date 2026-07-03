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
import { useField } from "@/store/field";

type OrbPalette = "candle" | "sea" | "flame" | "electric" | "aurora";

// Five palettes for the globe. Each is a set of (warm-core, hot-mid,
// paper-band, glow, electric) triples. The color-shift control cycles them.
const ORB_PALETTES: Record<OrbPalette, {
  candle: [number, number, number];
  flameHot: [number, number, number];
  paper: [number, number, number];
  glow: [number, number, number];
  electric: [number, number, number];
  label: string;
}> = {
  candle: {
    candle:   [1.000, 0.706, 0.431],
    flameHot: [1.000, 0.451, 0.180],
    paper:    [0.957, 0.910, 0.839],
    glow:     [0.784, 0.353, 0.110],
    electric: [0.420, 0.690, 1.000],
    label:    "candle",
  },
  sea: {
    candle:   [0.435, 0.812, 0.894],
    flameHot: [0.173, 0.490, 0.661],
    paper:    [0.863, 0.933, 0.957],
    glow:     [0.102, 0.227, 0.322],
    electric: [0.420, 0.890, 1.000],
    label:    "sea",
  },
  flame: {
    candle:   [1.000, 0.416, 0.235],
    flameHot: [0.878, 0.231, 0.165],
    paper:    [0.949, 0.933, 0.902],
    glow:     [0.784, 0.267, 0.094],
    electric: [1.000, 0.808, 0.420],
    label:    "flame",
  },
  electric: {
    candle:   [0.690, 0.420, 1.000],
    flameHot: [0.420, 0.690, 1.000],
    paper:    [0.910, 0.957, 0.957],
    glow:     [0.180, 0.110, 0.420],
    electric: [0.420, 1.000, 0.890],
    label:    "electric",
  },
  aurora: {
    candle:   [0.420, 1.000, 0.690],
    flameHot: [0.580, 0.420, 1.000],
    paper:    [0.910, 0.957, 0.933],
    glow:     [0.110, 0.420, 0.353],
    electric: [1.000, 0.690, 0.890],
    label:    "aurora",
  },
};

const PALETTE_ORDER: OrbPalette[] = ["candle", "sea", "flame", "electric", "aurora"];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const rgb = (c: [number, number, number], a = 1) =>
  `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${a})`;

// A live pointer touching the glass.
type Contact = {
  id: number;
  cx: number;         // clientX
  cy: number;         // clientY
  downAt: number;     // ms
  moved: number;      // accumulated px travelled
  lastX: number;
  lastY: number;
  lastRipple: number; // ms of last drag tape/haptic
  seed: number;       // per-filament jitter seed
};

// A brief bright crackle spawned by a tap.
type Flare = { x: number; y: number; t0: number; seed: number };

/**
 * /plasma — a single tactile PLASMA GLOBE.
 *
 * One full-viewport glass sphere of ionized light sitting in a dark vacuum.
 * The WebGL orb shader (five cross-fading palettes, breathing core, local
 * scrub glow) fills a centered disc. A 2D overlay draws the tactile heart:
 * on touch/drag, bright electric filaments arc from the core out to each
 * contact point and writhe as the finger moves (multi-touch = multi-arc).
 * Holding builds heat — the core swells, brightens, and a rising hum climbs;
 * releasing lets it relax with inertia. A quick tap cracks a spark.
 */
export default function Plasma() {
  // page-specific ambient bed: electric hum + sparkles
  useEffect(() => { getFieldAudio().setAmbientProfile("electric"); }, []);

  const rootRef = useRef<HTMLDivElement>(null);
  const sphereRef = useRef<HTMLDivElement>(null);
  const orbCanvasRef = useRef<HTMLCanvasElement>(null);
  const arcsCanvasRef = useRef<HTMLCanvasElement>(null);

  const [orbPalette, setOrbPalette] = useState<OrbPalette>("candle");
  const orbPaletteRef = useRef<OrbPalette>("candle");
  useEffect(() => { orbPaletteRef.current = orbPalette; }, [orbPalette]);

  const [readout, setReadout] = useState("dormant");

  // shared mutable state read by the single rAF loop
  const contactsRef = useRef<Map<number, Contact>>(new Map());
  const flaresRef = useRef<Flare[]>([]);
  const heatRef = useRef(0);          // 0..1 accumulated charge
  const heatPeakRef = useRef(0);      // peak heat while any finger is down
  const flashRef = useRef(0);         // whitish bloom 0..1
  const flashT0Ref = useRef(0);
  const lastHumRef = useRef(0);
  const recordTape = useField((s) => s.recordTape);
  const recordTapeRef = useRef(recordTape);
  recordTapeRef.current = recordTape;

  const audioRef = useRef<ReturnType<typeof getFieldAudio> | null>(null);
  const getAudio = useCallback(() => {
    if (!audioRef.current) audioRef.current = getFieldAudio();
    return audioRef.current;
  }, []);

  // ── color-shift control ───────────────────────────────────────────
  const cyclePalette = useCallback(() => {
    setOrbPalette((prev) => {
      const idx = PALETTE_ORDER.indexOf(prev);
      const next = PALETTE_ORDER[(idx + 1) % PALETTE_ORDER.length];
      orbPaletteRef.current = next;
      try { getAudio().playNote(56 + idx * 2, 200); } catch { /* noop */ }
      try { haptics.tap(); } catch { /* noop */ }
      recordTapeRef.current("preset", 0.5, `plasma/color/${ORB_PALETTES[next].label}`);
      return next;
    });
  }, [getAudio]);

  // ─────────────────────────────────────────────────────────────────
  // The instrument — one WebGL orb + one 2D filament overlay, one loop.
  // ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const root = rootRef.current;
    const sphere = sphereRef.current;
    const orbCanvas = orbCanvasRef.current;
    const arcsCanvas = arcsCanvasRef.current;
    if (!root || !sphere || !orbCanvas || !arcsCanvas) return;

    const arcsCtx = arcsCanvas.getContext("2d");
    if (!arcsCtx) return;

    // ── WebGL orb (falls back to the CSS gradient on the sphere wrap) ──
    const gl =
      (orbCanvas.getContext("webgl", { antialias: false, premultipliedAlpha: true, alpha: true }) ||
        orbCanvas.getContext(
          "experimental-webgl" as "webgl",
          { antialias: false, premultipliedAlpha: true, alpha: true } as WebGLContextAttributes,
        )) as WebGLRenderingContext | null;
    if (!gl) sphere.setAttribute("data-plasma-fallback", "1");

    const vert = `
      attribute vec2 a_pos;
      varying vec2 vUv;
      void main() { vUv = a_pos; gl_Position = vec4(a_pos, 0.0, 1.0); }
    `;
    const frag = `
      precision highp float;
      uniform float u_time;
      uniform float u_reduced;
      uniform float u_intensity;   // global heat lift
      uniform float u_flash;       // tap / discharge bloom
      uniform vec2  u_cursor;      // primary contact in disc-UV [-1,1]; (-2,-2) = none
      uniform float u_scrub;       // local boost strength near cursor
      uniform vec3  u_pal_candle;
      uniform vec3  u_pal_flame;
      uniform vec3  u_pal_paper;
      uniform vec3  u_pal_glow;
      uniform vec3  u_pal_elec;
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
        for (int i = 0; i < 5; i++) { v += a * vnoise(p); p *= 2.07; a *= 0.52; }
        return v;
      }

      void main() {
        vec2 uv = vUv;
        float r = length(uv);

        float disc = 1.0 - smoothstep(0.98, 1.005, r);
        if (disc <= 0.0) { gl_FragColor = vec4(0.0); return; }

        float t = u_time;
        float motion = mix(0.08, 1.0, 1.0 - u_reduced);
        float flow = 0.40 * motion;

        float breath = 1.0 + sin(t * 6.2831853 * 0.14 * motion) * 0.16;
        float intensity = clamp(u_intensity, 0.0, 1.6);
        float flash = clamp(u_flash, 0.0, 1.0);

        vec2 pA = uv * 1.6 + vec2(t * flow * 0.30, t * flow * 0.22);
        vec2 pB = uv * 1.6 + vec2(t * flow * -0.24, t * flow * 0.30);
        float nA = fbm(pA);
        float nB = fbm(pB + 17.3);

        float curveA = sin((uv.x + nA * 0.50) * 1.9 + t * flow * 0.58) * 0.45;
        float dA = abs(uv.y - curveA);
        float bandA = smoothstep(0.44, 0.02, dA);

        float curveB = sin((uv.y + nB * 0.50) * 1.7 + t * flow * 0.42 + 0.4) * 0.45;
        float dB = abs(uv.x - curveB);
        float bandB = smoothstep(0.44, 0.02, dB);

        float turbA = fbm(uv * 3.4 + vec2(t * flow * 0.5, 0.0));
        float turbB = fbm(uv * 3.4 + vec2(0.0, t * flow * -0.5) + 9.1);
        bandA *= mix(0.75, 1.15, turbA);
        bandB *= mix(0.75, 1.15, turbB);

        float rimFade = smoothstep(1.0, 0.55, r);
        bandA *= rimFade;
        bandB *= rimFade;

        float hotMix = pow(bandA, 1.5) * smoothstep(0.9, 0.0, r);
        float bloom = exp(-r * r * 2.4);
        float coreHi = exp(-r * r * 8.0);

        vec3 candle    = u_pal_candle;
        vec3 flameHot  = u_pal_flame;
        vec3 paper     = u_pal_paper;
        vec3 glow      = u_pal_glow;
        vec3 electric  = u_pal_elec;

        vec3 col = glow * bloom * 0.95;
        vec3 bandAColor = mix(candle, flameHot, hotMix);
        col += bandAColor * bandA * 1.10;
        col += paper * bandB * 0.78;

        float elec = exp(-r * r * 18.0);
        col += electric * elec * (0.18 + 0.10 * sin(t * 4.3));

        col += paper * coreHi * 0.40;
        col += flameHot * coreHi * 0.30;

        // heat lifts overall brightness — the core reads hotter under a hold.
        col *= breath * (0.85 + intensity * 0.55);

        // local scrub — the contact point glows harder so the touch reads.
        vec2 cur = u_cursor;
        if (cur.x > -1.5) {
          float dc = length(uv - cur);
          float local = exp(-(dc * dc) / 0.035);
          col += electric * local * u_scrub * 0.55;
          col += paper * local * u_scrub * 0.30;
        }

        col += vec3(1.0, 0.92, 0.84) * flash * 0.85 * (0.4 + bloom);

        float rimShade = smoothstep(0.86, 1.0, r) * 0.35;
        col *= (1.0 - rimShade);

        float aRadial = smoothstep(1.0, 0.0, r);
        float aField = clamp(bandA * 0.9 + bandB * 0.6 + bloom * 0.9 + coreHi * 1.0 + flash * 0.6, 0.0, 1.0);
        float alpha = clamp(mix(aRadial * 0.35, 1.0, aField), 0.0, 1.0) * disc;
        gl_FragColor = vec4(col * alpha, alpha);
      }
    `;

    let prog: WebGLProgram | null = null;
    let buf: WebGLBuffer | null = null;
    let vs: WebGLShader | null = null;
    let fs: WebGLShader | null = null;
    let uni: {
      time: WebGLUniformLocation | null;
      reduced: WebGLUniformLocation | null;
      intensity: WebGLUniformLocation | null;
      flash: WebGLUniformLocation | null;
      cursor: WebGLUniformLocation | null;
      scrub: WebGLUniformLocation | null;
      candle: WebGLUniformLocation | null;
      flame: WebGLUniformLocation | null;
      paper: WebGLUniformLocation | null;
      glow: WebGLUniformLocation | null;
      elec: WebGLUniformLocation | null;
    } | null = null;

    if (gl) {
      const compile = (type: number, src: string) => {
        const s = gl.createShader(type);
        if (!s) return null;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          console.warn("Plasma orb shader compile failed", gl.getShaderInfoLog(s));
          gl.deleteShader(s);
          return null;
        }
        return s;
      };
      vs = compile(gl.VERTEX_SHADER, vert);
      fs = compile(gl.FRAGMENT_SHADER, frag);
      const p = vs && fs ? gl.createProgram() : null;
      if (p && vs && fs) {
        gl.attachShader(p, vs);
        gl.attachShader(p, fs);
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
          sphere.setAttribute("data-plasma-fallback", "1");
        } else {
          prog = p;
        }
      } else {
        sphere.setAttribute("data-plasma-fallback", "1");
      }

      if (prog) {
        buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const aPos = gl.getAttribLocation(prog, "a_pos");
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
        gl.useProgram(prog);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        uni = {
          time: gl.getUniformLocation(prog, "u_time"),
          reduced: gl.getUniformLocation(prog, "u_reduced"),
          intensity: gl.getUniformLocation(prog, "u_intensity"),
          flash: gl.getUniformLocation(prog, "u_flash"),
          cursor: gl.getUniformLocation(prog, "u_cursor"),
          scrub: gl.getUniformLocation(prog, "u_scrub"),
          candle: gl.getUniformLocation(prog, "u_pal_candle"),
          flame: gl.getUniformLocation(prog, "u_pal_flame"),
          paper: gl.getUniformLocation(prog, "u_pal_paper"),
          glow: gl.getUniformLocation(prog, "u_pal_glow"),
          elec: gl.getUniformLocation(prog, "u_pal_elec"),
        };
      }
    }

    // smoothed palette so the color-shift reads as a wash, not a hard cut
    const pal = {
      candle:   [...ORB_PALETTES.candle.candle]   as [number, number, number],
      flameHot: [...ORB_PALETTES.candle.flameHot] as [number, number, number],
      paper:    [...ORB_PALETTES.candle.paper]    as [number, number, number],
      glow:     [...ORB_PALETTES.candle.glow]     as [number, number, number],
      electric: [...ORB_PALETTES.candle.electric] as [number, number, number],
    };

    // ── geometry, refreshed on resize ───────────────────────────────
    let vw = 0, vh = 0;         // viewport (arcs canvas) size in CSS px
    let cx = 0, cy = 0;         // sphere center in CSS px, relative to root
    let radius = 0;             // sphere radius in CSS px

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rootRect = root.getBoundingClientRect();
      const sphRect = sphere.getBoundingClientRect();
      vw = Math.max(1, Math.floor(rootRect.width));
      vh = Math.max(1, Math.floor(rootRect.height));
      cx = sphRect.left - rootRect.left + sphRect.width / 2;
      cy = sphRect.top - rootRect.top + sphRect.height / 2;
      radius = sphRect.width / 2;

      arcsCanvas.width = Math.floor(vw * dpr);
      arcsCanvas.height = Math.floor(vh * dpr);
      arcsCanvas.style.width = `${vw}px`;
      arcsCanvas.style.height = `${vh}px`;
      arcsCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (gl) {
        const sw = Math.max(1, Math.floor(sphRect.width * dpr));
        orbCanvas.width = sw;
        orbCanvas.height = sw;
        gl.viewport(0, 0, sw, sw);
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(root);
    ro.observe(sphere);
    window.addEventListener("resize", resize);

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = mq.matches ? 1 : 0;
    const onMq = () => { reduced = mq.matches ? 1 : 0; };
    if (typeof mq.addEventListener === "function") mq.addEventListener("change", onMq);

    // ── ambient idle tendrils so the gas looks alive when untouched ──
    const ambient = [
      { a: 0.3, seed: 0.11 },
      { a: 2.4, seed: 0.53 },
      { a: 4.6, seed: 0.87 },
    ];

    // ── filament renderer ───────────────────────────────────────────
    // Draws a jagged, additively-glowing lightning path from the core to a
    // target, with a couple of forks and a bright contact node.
    const drawFilament = (
      sx: number, sy: number, ex: number, ey: number,
      seed: number, time: number, bright: number, motion: number, contact: boolean,
    ) => {
      const dx = ex - sx, dy = ey - sy;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len; // unit perpendicular
      const segs = Math.max(5, Math.min(16, Math.round(len / 26)));
      const amp = clamp(len * 0.13, 6, 46) * motion;

      const pts: Array<{ x: number; y: number }> = [];
      for (let i = 0; i <= segs; i++) {
        const f = i / segs;
        // taper the wander so both ends stay anchored
        const taper = Math.sin(f * Math.PI);
        const j =
          Math.sin(time * 9.0 + f * 11.0 + seed * 40.0) * 0.6 +
          Math.sin(time * 15.0 - f * 7.0 + seed * 80.0) * 0.4;
        const off = j * amp * taper;
        pts.push({ x: sx + dx * f + nx * off, y: sy + dy * f + ny * off });
      }

      const glowCol = rgb(pal.electric, 0.30 * bright);
      const coreCol = rgb(pal.paper, Math.min(1, 0.85 * bright));

      arcsCtx.save();
      arcsCtx.globalCompositeOperation = "lighter";
      arcsCtx.lineJoin = "round";
      arcsCtx.lineCap = "round";

      const stroke = (w: number, style: string) => {
        arcsCtx.beginPath();
        arcsCtx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) arcsCtx.lineTo(pts[i].x, pts[i].y);
        arcsCtx.lineWidth = w;
        arcsCtx.strokeStyle = style;
        arcsCtx.stroke();
      };
      // wide soft glow, then a thin bright core
      stroke(7 + bright * 5, glowCol);
      stroke(2.4 + bright * 1.4, coreCol);

      // a fork or two off the mid third
      const forks = reduced ? 0 : 1 + (seed > 0.5 ? 1 : 0);
      for (let k = 0; k < forks; k++) {
        const bi = Math.floor(segs * (0.4 + 0.18 * k + 0.1 * seed));
        const base = pts[Math.min(segs - 1, Math.max(1, bi))];
        const fl = len * (0.14 + 0.1 * seed);
        const ang = Math.atan2(dy, dx) + (k % 2 ? 1 : -1) * (0.5 + 0.5 * seed);
        const fx = base.x + Math.cos(ang) * fl + nx * amp * 0.4 * Math.sin(time * 12 + k);
        const fy = base.y + Math.sin(ang) * fl + ny * amp * 0.4 * Math.sin(time * 12 + k);
        arcsCtx.beginPath();
        arcsCtx.moveTo(base.x, base.y);
        const mxo = (base.x + fx) / 2 + nx * amp * 0.5 * Math.sin(time * 10 + seed * 20 + k);
        const myo = (base.y + fy) / 2 + ny * amp * 0.5 * Math.sin(time * 10 + seed * 20 + k);
        arcsCtx.quadraticCurveTo(mxo, myo, fx, fy);
        arcsCtx.lineWidth = 1.4 + bright;
        arcsCtx.strokeStyle = rgb(pal.electric, 0.24 * bright);
        arcsCtx.stroke();
      }

      // contact node where the filament meets the glass / finger
      if (contact) {
        const rr = 5 + bright * 9;
        const g = arcsCtx.createRadialGradient(ex, ey, 0, ex, ey, rr);
        g.addColorStop(0, rgb(pal.paper, Math.min(1, 0.9 * bright)));
        g.addColorStop(0.4, rgb(pal.electric, 0.5 * bright));
        g.addColorStop(1, rgb(pal.electric, 0));
        arcsCtx.fillStyle = g;
        arcsCtx.beginPath();
        arcsCtx.arc(ex, ey, rr, 0, Math.PI * 2);
        arcsCtx.fill();
      }
      arcsCtx.restore();
    };

    // ── main loop ───────────────────────────────────────────────────
    const t0 = performance.now();
    let lastFrame = t0;
    let lastReadout = 0;
    let raf = 0;

    const draw = (now: number) => {
      const t = (now - t0) / 1000;
      const dt = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      const motion = reduced ? 0.28 : 1;

      const contacts = contactsRef.current;
      const active = contacts.size > 0;
      const rootRect = root.getBoundingClientRect();

      // ── heat: builds while held, relaxes with inertia on release ──
      if (active) {
        heatRef.current = clamp(heatRef.current + dt * (0.55 + contacts.size * 0.18), 0, 1);
        heatPeakRef.current = Math.max(heatPeakRef.current, heatRef.current);
      } else {
        // slow exponential relax — the afterglow lingers, reads as inertia
        heatRef.current = Math.max(0, heatRef.current - dt * (0.18 + heatRef.current * 0.28));
      }
      const heat = heatRef.current;

      // rising electric hum while charging
      if (active && !reduced && now - lastHumRef.current > 190) {
        lastHumRef.current = now;
        try { getAudio().playTone(70 + heat * 210 + contacts.size * 12, 0.22); } catch { /* noop */ }
      }

      // ── flash decay ──
      let flash = 0;
      if (flashRef.current > 0) {
        const age = (now - flashT0Ref.current) / 1000;
        flash = Math.exp(-age * 6);
        if (flash < 0.001) { flashRef.current = 0; flash = 0; }
        else flashRef.current = flash;
      }

      // ── primary contact drives the shader's local scrub glow ──
      let curX = -2, curY = -2, scrub = 0;
      let primary: Contact | null = null;
      for (const c of contacts.values()) { primary = c; break; }
      if (primary) {
        const px = primary.cx - rootRect.left - cx;
        const py = primary.cy - rootRect.top - cy;
        const d = Math.hypot(px, py) || 1;
        const uxRaw = px / radius;
        const uyRaw = py / radius;
        // clamp the glow point to the disc so it lands on the glass
        const clampK = d > radius ? radius / d : 1;
        curX = uxRaw * clampK;
        curY = -uyRaw * clampK;
        scrub = clamp(1 - Math.max(0, (d - radius) / radius), 0.25, 1);
      }

      // ── WebGL orb ──
      if (gl && prog && uni) {
        const target = ORB_PALETTES[orbPaletteRef.current];
        const k = 0.06;
        const lerp3 = (a: [number, number, number], b: [number, number, number]) => {
          a[0] += (b[0] - a[0]) * k; a[1] += (b[1] - a[1]) * k; a[2] += (b[2] - a[2]) * k;
        };
        lerp3(pal.candle, target.candle);
        lerp3(pal.flameHot, target.flameHot);
        lerp3(pal.paper, target.paper);
        lerp3(pal.glow, target.glow);
        lerp3(pal.electric, target.electric);

        gl.useProgram(prog);
        if (uni.time) gl.uniform1f(uni.time, t);
        if (uni.reduced) gl.uniform1f(uni.reduced, reduced);
        if (uni.intensity) gl.uniform1f(uni.intensity, clamp(heat * 1.25 + scrub * 0.25, 0, 1.6));
        if (uni.flash) gl.uniform1f(uni.flash, flash);
        if (uni.cursor) gl.uniform2f(uni.cursor, curX, curY);
        if (uni.scrub) gl.uniform1f(uni.scrub, active ? scrub : 0);
        if (uni.candle) gl.uniform3f(uni.candle, pal.candle[0], pal.candle[1], pal.candle[2]);
        if (uni.flame) gl.uniform3f(uni.flame, pal.flameHot[0], pal.flameHot[1], pal.flameHot[2]);
        if (uni.paper) gl.uniform3f(uni.paper, pal.paper[0], pal.paper[1], pal.paper[2]);
        if (uni.glow) gl.uniform3f(uni.glow, pal.glow[0], pal.glow[1], pal.glow[2]);
        if (uni.elec) gl.uniform3f(uni.elec, pal.electric[0], pal.electric[1], pal.electric[2]);

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }

      // heat swells the glass a touch + intensifies its outer bloom
      sphere.style.transform = `translate(-50%, -50%) scale(${(1 + heat * 0.06).toFixed(4)})`;
      sphere.style.setProperty("--heat", heat.toFixed(3));

      // ── filaments overlay ──
      arcsCtx.clearRect(0, 0, vw, vh);

      // ambient tendrils — faint, always drifting toward the rim
      const ambBright = (reduced ? 0.10 : 0.16) * (0.7 + heat * 0.6);
      for (const a of ambient) {
        const ang = a.a + t * 0.15 * motion + Math.sin(t * 0.4 + a.seed * 6) * 0.5;
        const ex = cx + Math.cos(ang) * radius * 0.94;
        const ey = cy + Math.sin(ang) * radius * 0.94;
        drawFilament(cx, cy, ex, ey, a.seed, t, ambBright, motion, false);
      }

      // one bright, writhing filament per finger
      for (const c of contacts.values()) {
        const px = c.cx - rootRect.left;
        const py = c.cy - rootRect.top;
        const d = Math.hypot(px - cx, py - cy) || 1;
        // endpoint: the finger if it's inside the glass, else the rim toward it
        const kk = d > radius ? radius / d : 1;
        const ex = cx + (px - cx) * kk;
        const ey = cy + (py - cy) * kk;
        const held = clamp((now - c.downAt) / 900, 0, 1);
        const bright = 0.6 + held * 0.5 + heat * 0.4;
        drawFilament(cx, cy, ex, ey, c.seed, t, bright, motion, true);
      }

      // tap flares — brief bright crackle bursts
      const flares = flaresRef.current;
      for (let i = flares.length - 1; i >= 0; i--) {
        const fl = flares[i];
        const age = (now - fl.t0) / 1000;
        if (age > 0.32) { flares.splice(i, 1); continue; }
        const b = (1 - age / 0.32) * 1.1;
        const d = Math.hypot(fl.x - cx, fl.y - cy) || 1;
        const kk = d > radius ? radius / d : 1;
        const ex = cx + (fl.x - cx) * kk;
        const ey = cy + (fl.y - cy) * kk;
        drawFilament(cx, cy, ex, ey, fl.seed, t, b, motion, true);
      }

      // ── throttled readout ──
      if (now - lastReadout > 180) {
        lastReadout = now;
        const label = ORB_PALETTES[orbPaletteRef.current].label;
        const state = active
          ? (contacts.size > 1 ? `${contacts.size} arcs` : "arcing")
          : heat > 0.04 ? "cooling" : "dormant";
        setReadout(`${label} · ${state} · ${heat.toFixed(2)}`);
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    // ── pointer interactions on the root surface ────────────────────
    const spark = (x: number, y: number, strength: number) => {
      flashRef.current = Math.max(flashRef.current, strength);
      flashT0Ref.current = performance.now();
      flaresRef.current.push({ x, y, t0: performance.now(), seed: Math.random() });
      if (flaresRef.current.length > 6) flaresRef.current.shift();
    };

    const onDown = (e: PointerEvent) => {
      const rect = root.getBoundingClientRect();
      const now = performance.now();
      const c: Contact = {
        id: e.pointerId,
        cx: e.clientX, cy: e.clientY,
        downAt: now, moved: 0,
        lastX: e.clientX, lastY: e.clientY,
        lastRipple: 0, seed: Math.random(),
      };
      contactsRef.current.set(e.pointerId, c);
      heatPeakRef.current = heatRef.current;
      try { root.setPointerCapture(e.pointerId); } catch { /* noop */ }
      // a small strike so the touch lands immediately
      spark(e.clientX - rect.left, e.clientY - rect.top, 0.4);
      try { getAudio().spark(); } catch { /* noop */ }
      try { haptics.tap(); } catch { /* noop */ }
      recordTapeRef.current("object", 0.55, "plasma/touch");
    };

    const onMove = (e: PointerEvent) => {
      const c = contactsRef.current.get(e.pointerId);
      if (!c) return;
      const dxp = e.clientX - c.lastX;
      const dyp = e.clientY - c.lastY;
      c.moved += Math.hypot(dxp, dyp);
      c.cx = e.clientX; c.cy = e.clientY;
      c.lastX = e.clientX; c.lastY = e.clientY;
      const now = performance.now();
      if (now - c.lastRipple > 90) {
        c.lastRipple = now;
        try { haptics.ripple(0.18 + heatRef.current * 0.3); } catch { /* noop */ }
        recordTapeRef.current("ripple", 0.3 + heatRef.current * 0.4, "plasma/drag");
      }
    };

    const release = (e: PointerEvent) => {
      const c = contactsRef.current.get(e.pointerId);
      if (!c) return;
      contactsRef.current.delete(e.pointerId);
      try { root.releasePointerCapture(e.pointerId); } catch { /* noop */ }
      const now = performance.now();
      const rect = root.getBoundingClientRect();
      const held = now - c.downAt;
      const tap = held < 260 && c.moved < 12;
      const lastOne = contactsRef.current.size === 0;

      if (tap) {
        // a quick tap cracks a sharp spark
        spark(c.cx - rect.left, c.cy - rect.top, 0.85);
        try { getAudio().spark(); } catch { /* noop */ }
        try { haptics.chop(); } catch { /* noop */ }
        recordTapeRef.current("sigil", 0.7, "plasma/spark");
      }

      if (lastOne && heatPeakRef.current > 0.55) {
        // releasing a charged globe discharges — a big bright crack
        spark(c.cx - rect.left, c.cy - rect.top, 1);
        try { getAudio().bell(); } catch { /* noop */ }
        try { haptics.storm(); } catch { /* noop */ }
        recordTapeRef.current("concern", 0.6 + heatPeakRef.current * 0.4, "plasma/discharge");
        heatPeakRef.current = 0;
      } else if (!tap) {
        try { getAudio().thud(); } catch { /* noop */ }
      }
    };

    root.addEventListener("pointerdown", onDown);
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerup", release);
    root.addEventListener("pointercancel", release);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", resize);
      if (typeof mq.removeEventListener === "function") mq.removeEventListener("change", onMq);
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerup", release);
      root.removeEventListener("pointercancel", release);
      if (gl) {
        try {
          if (buf) gl.deleteBuffer(buf);
          if (prog) gl.deleteProgram(prog);
          if (vs) gl.deleteShader(vs);
          if (fs) gl.deleteShader(fs);
        } catch { /* noop */ }
      }
    };
  }, [getAudio]);

  const activeTone = rgb(ORB_PALETTES[orbPalette].electric, 1);

  return (
    <div
      ref={rootRef}
      className="plasma-instrument"
      data-touch-surface="true"
      data-pretext-ignore="true"
      style={{ "--plasma-tone": activeTone } as CSSProperties}
    >
      {/* the glass sphere: WebGL orb + CSS fallback gradient + glass shell */}
      <div ref={sphereRef} className="plasma-sphere" aria-hidden="true">
        <canvas ref={orbCanvasRef} className="plasma-orb" />
        <div className="plasma-glass" />
      </div>

      {/* full-viewport filament overlay */}
      <canvas
        ref={arcsCanvasRef}
        className="plasma-arcs"
        role="img"
        aria-label="A touch-responsive plasma globe; drag to draw electric filaments to your finger"
      />

      <div className="plasma-title" aria-hidden="true">
        <span>plasma / ionized globe</span>
        <strong>Plasma</strong>
      </div>

      <output className="plasma-readout" aria-live="polite">{readout}</output>

      <button
        type="button"
        className="plasma-color"
        onClick={cyclePalette}
        aria-label={`color — ${ORB_PALETTES[orbPalette].label}; tap to shift`}
      >
        <i aria-hidden="true" />
        <span>{ORB_PALETTES[orbPalette].label}</span>
      </button>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .plasma-instrument {
          position: fixed;
          inset: 0;
          overflow: hidden;
          min-height: 100svh;
          background:
            radial-gradient(120% 120% at 50% 46%, #0a0a14 0%, #06060c 55%, #030308 100%);
          color: rgba(246, 241, 224, 0.94);
          isolation: isolate;
          touch-action: none;
          -webkit-user-select: none;
          user-select: none;
          -webkit-tap-highlight-color: transparent;
          cursor: crosshair;
        }

        .plasma-sphere {
          --heat: 0;
          position: absolute;
          top: 50%;
          left: 50%;
          width: min(84vmin, 760px);
          height: min(84vmin, 760px);
          transform: translate(-50%, -50%);
          border-radius: 50%;
          pointer-events: none;
          z-index: 1;
          will-change: transform;
          /* the glass vacuum glow around the sphere, lifting with heat */
          box-shadow:
            0 0 calc(50px + var(--heat) * 140px) color-mix(in srgb, var(--plasma-tone) 40%, transparent),
            0 0 calc(120px + var(--heat) * 240px) color-mix(in srgb, var(--plasma-tone) 18%, transparent);
        }

        .plasma-orb {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
          border-radius: 50%;
        }

        /* CSS fallback: paints a radial pulse when WebGL is unavailable. */
        .plasma-sphere[data-plasma-fallback="1"] {
          background: radial-gradient(circle at 50% 50%,
            var(--plasma-tone) 0%,
            color-mix(in srgb, var(--plasma-tone) 40%, #100616) 42%,
            transparent 72%);
          animation: plasma-orb-pulse 7s ease-in-out infinite;
        }

        /* glass shell: thin bright rim + top specular + inner vignette */
        .plasma-glass {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          pointer-events: none;
          background:
            radial-gradient(closest-side at 38% 30%, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 42%),
            radial-gradient(closest-side, transparent 78%, rgba(0,0,0,0.35) 96%, rgba(0,0,0,0.55) 100%);
          box-shadow:
            inset 0 0 0 1px rgba(255,255,255,0.07),
            inset 0 0 60px rgba(0,0,0,0.35);
        }

        .plasma-arcs {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
          pointer-events: none;
          z-index: 2;
        }

        .plasma-title {
          position: fixed;
          z-index: 3;
          top: 40px;
          left: var(--pad-x);
          pointer-events: none;
        }

        .plasma-title span {
          display: block;
          margin-bottom: 8px;
          color: rgba(246, 241, 224, 0.42);
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px;
          line-height: 1;
          text-transform: lowercase;
        }

        .plasma-title strong {
          display: block;
          color: rgba(248, 244, 224, 0.92);
          font-family: var(--font-serif);
          font-size: clamp(56px, 9vw, 120px);
          font-weight: 300;
          line-height: 0.86;
          letter-spacing: -0.02em;
        }

        .plasma-readout {
          position: fixed;
          z-index: 3;
          left: var(--pad-x);
          bottom: calc(22px + env(safe-area-inset-bottom, 0px));
          color: rgba(246, 241, 224, 0.5);
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px;
          letter-spacing: 0.02em;
          pointer-events: none;
        }

        .plasma-color {
          position: fixed;
          z-index: 4;
          right: var(--pad-x);
          bottom: calc(18px + env(safe-area-inset-bottom, 0px));
          display: inline-flex;
          align-items: center;
          gap: 9px;
          min-height: 44px;
          padding: 0 14px 0 11px;
          border: 1px solid color-mix(in srgb, var(--plasma-tone) 30%, transparent);
          border-radius: 999px;
          background: rgba(8, 8, 16, 0.5);
          color: rgba(246, 241, 224, 0.78);
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px;
          text-transform: lowercase;
          cursor: pointer;
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
        }

        .plasma-color i {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--plasma-tone);
          box-shadow: 0 0 14px color-mix(in srgb, var(--plasma-tone) 70%, transparent);
        }

        .plasma-color:focus-visible {
          outline: 2px solid var(--plasma-tone);
          outline-offset: 3px;
        }

        @keyframes plasma-orb-pulse {
          0%, 100% { filter: brightness(0.94); }
          50%      { filter: brightness(1.10); }
        }

        /* full-bleed: hide the site chrome so the globe owns the viewport */
        body:has(.plasma-instrument) { overflow: hidden; background: #06060c; }
        body:has(.plasma-instrument) header { display: none !important; }
        body:has(.plasma-instrument) .oda-field-watch,
        body:has(.plasma-instrument) .oda-candle-mark,
        body:has(.plasma-instrument) .oda-tape-shell,
        body:has(.plasma-instrument) .oda-sound-toggle { display: none !important; }

        @media (max-width: 768px) {
          .plasma-sphere { width: min(90vmin, 560px); height: min(90vmin, 560px); }
          .plasma-title { top: 26px; left: 22px; }
          .plasma-title strong { font-size: clamp(44px, 15vw, 76px); }
        }

        @media (prefers-reduced-motion: reduce) {
          .plasma-sphere[data-plasma-fallback="1"] { animation: none !important; }
        }
      `,
        }}
      />
    </div>
  );
}
