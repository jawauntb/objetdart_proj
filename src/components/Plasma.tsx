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
import { attachGestures, tapTrainDepth, tapTrainTier } from "@/lib/gesture";
import { useField } from "@/store/field";
import { onVessel } from "@/lib/vessel";
import LetGo from "@/components/LetGo";
import {
  createFrameGovernor,
  createIdleWriter,
  detailForTier,
  isEmbeddedFrame,
  onGalleryPause,
  onVisibility,
  resolveDpr,
  type QualityTier,
} from "@/lib/room-runtime";

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

// A kept filament — the globe's countable material, planted by a dwell
// hold and standing on its own until a ceremony hold on it (or <LetGo/>)
// lets it go. Stored in the sphere's own disc space so it survives resize.
type KeptFilament = { nx: number; ny: number; seed: number };
const MAX_FILAMENTS = 10;
const FILAMENT_HIT = 0.14; // hit radius in disc-space for "on an existing one"
const STORAGE_KEY = "objetdart:plasma:filaments:v1";

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
  const [hasFilaments, setHasFilaments] = useState(false);
  const letGoRef = useRef<() => void>(() => {});

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
      uniform float u_season;      // 3-finger twist: slow warm/cool drift
      uniform float u_polarity;    // 2-finger twist (the lens): 0..1 charge flip
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

        // two-finger twist = rotate the lens: the globe's charge flips —
        // the hot band and the electric fringe swap their roles.
        vec3 polarized = mix(col, electric * (hotMix + coreHi) + bandAColor * elec * 0.4, u_polarity * 0.6);
        col = mix(col, polarized, u_polarity);

        // three-finger twist = season: a slow warm/cool cast over the glass.
        col *= mix(vec3(1.03, 0.97, 0.90), vec3(0.92, 0.98, 1.05), sin(u_season) * 0.5 + 0.5);

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
      season: WebGLUniformLocation | null;
      polarity: WebGLUniformLocation | null;
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
          season: gl.getUniformLocation(prog, "u_season"),
          polarity: gl.getUniformLocation(prog, "u_polarity"),
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

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = mq.matches ? 1 : 0;
    const onMq = () => { reduced = mq.matches ? 1 : 0; };
    if (typeof mq.addEventListener === "function") mq.addEventListener("change", onMq);

    // ── performance contract (room-runtime): frame governor + visibility
    // sleep + DPR ceiling, shared with every other room on the site. ──
    const embedded = isEmbeddedFrame();
    const gov = createFrameGovernor(embedded ? "medium" : "high");
    let tier: QualityTier = gov.tier();
    let hidden = document.hidden;
    let galleryPaused = false;
    let faceDown = false;
    let sleeping = false;
    const syncSleep = () => { sleeping = hidden || galleryPaused || faceDown; };
    const unvis = onVisibility((h) => { hidden = h; syncSleep(); });
    const ungal = onGalleryPause((p) => { galleryPaused = p; syncSleep(); });

    // WebGL context loss/restore: pause cleanly, pick back up on restore.
    let contextLost = false;
    const onLost = (ev: Event) => { ev.preventDefault(); contextLost = true; };
    const onRestored = () => { contextLost = false; resize(); };
    if (gl) {
      orbCanvas.addEventListener("webglcontextlost", onLost);
      orbCanvas.addEventListener("webglcontextrestored", onRestored);
    }

    // ── geometry, refreshed on resize ───────────────────────────────
    let vw = 0, vh = 0;         // viewport (arcs canvas) size in CSS px
    let cx = 0, cy = 0;         // sphere center in CSS px, relative to root
    let radius = 0;             // sphere radius in CSS px

    const resize = () => {
      const dpr = resolveDpr(tier, { embedded, reducedMotion: reduced === 1 });
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

    // ── ambient idle tendrils so the gas looks alive when untouched ──
    const ambient = [
      { a: 0.3, seed: 0.11 },
      { a: 2.4, seed: 0.53 },
      { a: 4.6, seed: 0.87 },
    ];

    // ── the globe's kept material: standing filaments ──────────────
    let filaments: KeptFilament[] = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { filaments?: KeptFilament[] };
        if (Array.isArray(parsed.filaments)) filaments = parsed.filaments.slice(-MAX_FILAMENTS);
      }
    } catch { /* fresh */ }
    setHasFilaments(filaments.length > 0);
    const writer = createIdleWriter(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ filaments })); } catch { /* noop */ }
      setHasFilaments(filaments.length > 0);
    });
    const nearestFilament = (nx: number, ny: number): number => {
      let best = -1; let bestD = FILAMENT_HIT;
      filaments.forEach((f, i) => {
        const d = Math.hypot(f.nx - nx, f.ny - ny);
        if (d < bestD) { bestD = d; best = i; }
      });
      return best;
    };
    const gather = { active: false, nx: 0, ny: 0, hit: -1, committed: false, amt: 0 };

    // ── cached node sprite: the contact-node glow used to be a fresh
    // createRadialGradient per filament per frame (forbidden — catastrophic
    // on mobile). Baked once into an offscreen canvas, redrawn only when
    // the cross-fading palette actually moves, then reused via drawImage. ──
    const NODE_SPRITE = 96;
    const nodeSprite = document.createElement("canvas");
    nodeSprite.width = NODE_SPRITE;
    nodeSprite.height = NODE_SPRITE;
    const nodeSpriteCtx = nodeSprite.getContext("2d");
    let lastSpritePaintAt = 0;
    const paintNodeSprite = () => {
      if (!nodeSpriteCtx) return;
      const r = NODE_SPRITE / 2;
      nodeSpriteCtx.clearRect(0, 0, NODE_SPRITE, NODE_SPRITE);
      const g = nodeSpriteCtx.createRadialGradient(r, r, 0, r, r, r);
      g.addColorStop(0, rgb(pal.paper, 0.9));
      g.addColorStop(0.4, rgb(pal.electric, 0.5));
      g.addColorStop(1, rgb(pal.electric, 0));
      nodeSpriteCtx.fillStyle = g;
      nodeSpriteCtx.beginPath();
      nodeSpriteCtx.arc(r, r, r, 0, Math.PI * 2);
      nodeSpriteCtx.fill();
    };
    paintNodeSprite();

    // ── the vessel: the device itself is the globe's body ──
    let tiltBendX = 0;
    let tiltBendY = 0;
    const detachVessel = onVessel({
      tilt: ({ beta, gamma }) => {
        if (reduced) return;
        tiltBendX = clamp(gamma / 45, -1, 1);
        tiltBendY = clamp((beta - 35) / 60, -1, 1);
      },
      shake: ({ intensity }) => {
        if (reduced) return;
        heatRef.current = clamp(heatRef.current + intensity * 0.35, 0, 1);
        spark(cx, cy, 0.4 + intensity * 0.4);
        try { haptics.chop(); } catch { /* noop */ }
        try { getAudio().buzz(); } catch { /* noop */ }
      },
      knock: ({ intensity }) => {
        spark(cx, cy, 0.5 + intensity * 0.4);
        try { haptics.tap(); } catch { /* noop */ }
        try { getAudio().thud(); } catch { /* noop */ }
      },
      flip: ({ faceDown: fd }) => {
        faceDown = fd;
        syncSleep();
      },
    });

    // two-finger pan: an eased angle that turns the ambient ring + the
    // kept filaments around the core.
    const pan = { x: 0, tx: 0 };
    // twist lens (two fingers): flips the globe's charge polarity.
    const polarity = { v: 0, t: 0 };
    // three-finger twist: the globe's season — a slow warm/cool drift.
    let season = 0;

    // ── the room's clock + law-layer state (gesture grammar) ────────
    // Three fingers held dilate time; three fingers dragged bend every
    // arc; a circling finger sets a filament orbiting; a steady tapped
    // pulse entrains the core. Thresholds live in gesture/core alone.
    let timeScale = 1;
    let timeScaleTarget = 1;
    let simT = 0;                     // warped seconds — orb + filaments
    let simNowMs = performance.now(); // warped ms — flare/corona ages
    let bendX = 0;                    // law-wind: arcs bow with it
    let bendY = 0;
    let bendTX = 0;
    let bendTY = 0;
    let lastBendFxAt = 0;
    let orbitRing: { t0: number; sign: number; ang0: number } | null = null;
    let coronaUntil = 0;
    let entrainBpm = 0;
    let entrainUntil = 0;
    let lastEntrainBeat = -1;
    let lastScrubAt = 0;
    let lastDragRipple = 0;
    let lastGestureAt = performance.now();
    let lastContact = { x: 0, y: 0 }; // root-relative, for the discharge crack
    const holdState = { ceremony: false };
    let twistAcc = 0;
    let lastSeasonCueAt = 0;
    // span: two still fingers hold an arc open BETWEEN them — the one
    // filament in the room that never touches the core
    const spanArc = { active: false, ax: 0, ay: 0, bx: 0, by: 0, elapsed: 0, lastHum: 0 };
    // drum: an alternating patter — the lightning leaps between the hands
    const drumArc = { until: 0, ax: 0, ay: 0, bx: 0, by: 0 };

    // detail.particles scales fork count / segment density on lower tiers —
    // set once per frame by the governor, read by every drawFilament call.
    let detailScale = 1;

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
      const segs = Math.max(3, Math.min(16, Math.round((len / 26) * detailScale)));
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
        // the law-wind (three-finger drag) bows every arc the same way
        pts.push({
          x: sx + dx * f + nx * off + bendX * taper * 42,
          y: sy + dy * f + ny * off + bendY * taper * 42,
        });
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
      const forks = reduced ? 0 : Math.round((1 + (seed > 0.5 ? 1 : 0)) * detailScale);
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

      // contact node where the filament meets the glass / finger — a cached
      // sprite (see paintNodeSprite), never a fresh gradient per element.
      if (contact) {
        const rr = 5 + bright * 9;
        arcsCtx.globalAlpha = Math.min(1, bright);
        arcsCtx.drawImage(nodeSprite, ex - rr, ey - rr, rr * 2, rr * 2);
        arcsCtx.globalAlpha = 1;
      }
      arcsCtx.restore();
    };

    // ── main loop ───────────────────────────────────────────────────
    let lastFrame = performance.now();
    let lastReadout = 0;
    let wasActive = false;
    let raf = 0;

    const draw = (now: number) => {
      tier = gov.beginFrame(now);
      if (sleeping || contextLost) { raf = requestAnimationFrame(draw); return; }
      const detail = detailForTier(tier);
      detailScale = detail.particles;
      // the shared node sprite is a cached bake, only repainted a few times
      // a second as the cross-fading palette actually moves — never per
      // filament, never per frame.
      if (now - lastSpritePaintAt > 220) { lastSpritePaintAt = now; paintNodeSprite(); }

      const dt = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      // three-finger time dilation: the globe's clock eases to ~1/4 speed
      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dt * 5);
      simT += dt * timeScale;
      simNowMs += dt * 1000 * timeScale;
      const t = simT;
      const motion = reduced ? 0.28 : 1;

      // the law-wind eases in, then dies back toward the vacuum's calm —
      // tilt adds a constant gravity lean on top of the hand's wind.
      bendTX = clamp(bendTX + tiltBendX * dt * 0.6, -1.4, 1.4);
      bendTY = clamp(bendTY + tiltBendY * dt * 0.6, -1.4, 1.4);
      bendX += (bendTX - bendX) * Math.min(1, dt * 4);
      bendY += (bendTY - bendY) * Math.min(1, dt * 4);
      bendTX *= Math.exp(-dt * 0.8);
      bendTY *= Math.exp(-dt * 0.8);

      // two-finger pan eases toward its target — it turns the whole ring of
      // ambient tendrils and kept filaments around the core, distinct from
      // a one-finger drag (which only ever reaches the finger touching the
      // glass). The lens (polarity) and the season drift on their own
      // slow clocks.
      pan.x += (pan.tx - pan.x) * Math.min(1, dt * 6);
      polarity.v += (polarity.t - polarity.v) * Math.min(1, dt * 5);
      if (!gather.active) gather.amt *= 0.88;
      const panAngle = pan.x;

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

      // releasing a charged globe discharges — a big bright crack. The
      // material reads its own state: last finger up + banked heat.
      if (wasActive && !active && heatPeakRef.current > 0.55) {
        spark(lastContact.x, lastContact.y, 1);
        try { getAudio().bell(); } catch { /* noop */ }
        try { haptics.storm(); } catch { /* noop */ }
        recordTapeRef.current("concern", 0.6 + heatPeakRef.current * 0.4, "plasma/discharge");
        heatPeakRef.current = 0;
      }
      wasActive = active;

      // rising electric hum while charging
      if (active && !reduced && now - lastHumRef.current > 190 * (2 - timeScale)) {
        lastHumRef.current = now;
        try { getAudio().playTone((70 + heat * 210 + contacts.size * 12) * (0.6 + timeScale * 0.4), 0.22); } catch { /* noop */ }
      }

      // rhythm entrainment: while a steady tapped pulse holds, the core
      // blinks on every beat with its own note — sight and sound land in
      // the same frame.
      if (performance.now() < entrainUntil && entrainBpm > 0) {
        const beatLen = 60 / entrainBpm;
        const beatIdx = Math.floor(simT / beatLen);
        if (beatIdx !== lastEntrainBeat) {
          lastEntrainBeat = beatIdx;
          flashRef.current = Math.max(flashRef.current, 0.18);
          flashT0Ref.current = simNowMs;
          try { getAudio().playNote(58 + (beatIdx % 2) * 7, 120); } catch { /* noop */ }
        }
      }

      // ── flash decay ──
      let flash = 0;
      if (flashRef.current > 0) {
        const age = (simNowMs - flashT0Ref.current) / 1000;
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
        if (uni.season) gl.uniform1f(uni.season, season);
        if (uni.polarity) gl.uniform1f(uni.polarity, polarity.v);
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
        const ang = a.a + panAngle + t * 0.15 * motion + Math.sin(t * 0.4 + a.seed * 6) * 0.5;
        const ex = cx + Math.cos(ang) * radius * 0.94;
        const ey = cy + Math.sin(ang) * radius * 0.94;
        drawFilament(cx, cy, ex, ey, a.seed, t, ambBright, motion, false);
      }

      // kept filaments — the globe's countable material, standing on their
      // own, turning slowly with the panned ring.
      const cosP = Math.cos(panAngle), sinP = Math.sin(panAngle);
      for (const f of filaments) {
        const rx = f.nx * cosP - f.ny * sinP;
        const ry = f.nx * sinP + f.ny * cosP;
        const ex = cx + rx * radius * 0.93;
        const ey = cy + ry * radius * 0.93;
        drawFilament(cx, cy, ex, ey, f.seed, t, 0.5 + heat * 0.3, motion, true);
      }
      // a facet gathering under the held finger — legible from the moment
      // the dwell tier is crossed, deepening the longer it's held.
      if (gather.amt > 0.02) {
        const gx = cx + gather.nx * radius * 0.93;
        const gy = cy + gather.ny * radius * 0.93;
        drawFilament(cx, cy, gx, gy, 0.42, t, gather.amt * 0.9, motion, true);
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
        const age = (simNowMs - fl.t0) / 1000;
        if (age > 0.32) { flares.splice(i, 1); continue; }
        const b = (1 - age / 0.32) * 1.1;
        const d = Math.hypot(fl.x - cx, fl.y - cy) || 1;
        const kk = d > radius ? radius / d : 1;
        const ex = cx + (fl.x - cx) * kk;
        const ey = cy + (fl.y - cy) * kk;
        drawFilament(cx, cy, ex, ey, fl.seed, t, b, motion, true);
      }

      // scrub-born orbit — a filament chases its own tail around the rim
      if (orbitRing) {
        const age = (simNowMs - orbitRing.t0) / 1000;
        if (age > 4.2) {
          orbitRing = null;
        } else {
          const fadeIn = Math.min(1, age / 0.3);
          const fadeOut = Math.max(0, 1 - Math.max(0, age - 3.2) / 1);
          const ang = orbitRing.ang0 + orbitRing.sign * age * 2.4 * motion;
          const ex = cx + Math.cos(ang) * radius * 0.9;
          const ey = cy + Math.sin(ang) * radius * 0.9;
          drawFilament(cx, cy, ex, ey, 0.37, t, (0.55 + heat * 0.3) * fadeIn * fadeOut, motion, true);
        }
      }

      // the sustained interval — an arc bridging two still fingers, glass
      // to glass, whitening the longer it is held
      if (spanArc.active) {
        const deep = Math.min(1, spanArc.elapsed / 4000);
        drawFilament(spanArc.ax, spanArc.ay, spanArc.bx, spanArc.by, 0.63, t, 0.5 + deep * 0.6, motion, true);
      }

      // the drummed patter — lightning leaping between the hands' two spots
      if (simNowMs < drumArc.until) {
        const fade = (drumArc.until - simNowMs) / 600;
        drawFilament(drumArc.ax, drumArc.ay, drumArc.bx, drumArc.by, 0.29, t, 0.35 + fade * 0.5, motion, true);
      }

      // ceremony corona — every direction at once, briefly
      if (simNowMs < coronaUntil) {
        const fade = (coronaUntil - simNowMs) / 1800;
        for (let k = 0; k < 8; k++) {
          const ang = (k / 8) * Math.PI * 2 + t * 0.4 * motion;
          const ex = cx + Math.cos(ang) * radius * 0.92;
          const ey = cy + Math.sin(ang) * radius * 0.92;
          drawFilament(cx, cy, ex, ey, 0.1 + k * 0.09, t, 0.85 * fade, motion, true);
        }
      }

      // glimmer (grammar §6): after ~20s of quiet, one soft tendril leans
      // out and slowly circles, the way a scrub would send it — a physical
      // hint, never text.
      if (performance.now() - lastGestureAt > 20000) {
        const pulse = 0.5 + Math.sin(now / 480) * 0.5;
        const ang = now / 2400;
        const ex = cx + Math.cos(ang) * radius * 0.88;
        const ey = cy + Math.sin(ang) * radius * 0.88;
        drawFilament(cx, cy, ex, ey, 0.71, t, 0.10 + pulse * 0.10, motion, false);
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
      flashT0Ref.current = simNowMs;
      flaresRef.current.push({ x, y, t0: simNowMs, seed: Math.random() });
      if (flaresRef.current.length > 6) flaresRef.current.shift();
    };

    const toLocal = (clientX: number, clientY: number) => {
      const rect = root.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };

    const toDisc = (clientX: number, clientY: number) => {
      const { x, y } = toLocal(clientX, clientY);
      const px = x - cx, py = y - cy;
      const d = Math.hypot(px, py) || 1;
      const k = d > radius ? radius / d : 1;
      const cosP = Math.cos(-pan.x), sinP = Math.sin(-pan.x);
      const rx = (px * k) / radius, ry = (py * k) / radius;
      // un-rotate by the current pan so the stored position is frame-stable
      return { nx: rx * cosP - ry * sinP, ny: rx * sinP + ry * cosP };
    };

    const addFilament = (nx: number, ny: number) => {
      const seed = ((nx * 5171 + ny * 3187 + filaments.length * 97) % 1000) / 1000;
      filaments.push({ nx, ny, seed: Math.abs(seed) });
      if (filaments.length > MAX_FILAMENTS) filaments.shift();
      writer.schedule();
      const { x, y } = toLocal(cx + nx * radius, cy + ny * radius);
      spark(x, y, 0.6);
      try { getAudio().spark(); } catch { /* noop */ }
      try { haptics.ripple(0.5); } catch { /* noop */ }
      recordTapeRef.current("kept", 0.6, "plasma/filament-planted");
    };

    const removeFilament = (idx: number) => {
      if (idx < 0 || idx >= filaments.length) return;
      const f = filaments[idx];
      filaments.splice(idx, 1);
      writer.schedule();
      const { x, y } = toLocal(cx + f.nx * radius, cy + f.ny * radius);
      spark(x, y, 1);
      try { getAudio().bell(); } catch { /* noop */ }
      try { haptics.bloom(); } catch { /* noop */ }
      recordTapeRef.current("kept", 0.85, "plasma/filament-annihilated");
    };

    // ── the contact layer — position only, no semantics ─────────────
    // The glass answers every finger with its own filament, including
    // second and third fingers the semantic engine reserves for frame
    // and law verbs. These listeners only keep the endpoint positions
    // alive for the renderer (like a hover halo); every meaning — tap,
    // hold, heat, discharge — arrives through attachGestures below.
    const onContactDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      contactsRef.current.set(e.pointerId, {
        id: e.pointerId,
        cx: e.clientX, cy: e.clientY,
        downAt: performance.now(), moved: 0,
        lastX: e.clientX, lastY: e.clientY,
        lastRipple: 0, seed: Math.random(),
      });
      heatPeakRef.current = heatRef.current;
      lastContact = toLocal(e.clientX, e.clientY);
    };
    const onContactMove = (e: PointerEvent) => {
      const c = contactsRef.current.get(e.pointerId);
      if (!c) return;
      c.moved += Math.hypot(e.clientX - c.lastX, e.clientY - c.lastY);
      c.cx = e.clientX; c.cy = e.clientY;
      c.lastX = e.clientX; c.lastY = e.clientY;
      lastContact = toLocal(e.clientX, e.clientY);
    };
    const onContactUp = (e: PointerEvent) => {
      contactsRef.current.delete(e.pointerId);
    };
    root.addEventListener("pointerdown", onContactDown);
    root.addEventListener("pointermove", onContactMove);
    root.addEventListener("pointerup", onContactUp);
    root.addEventListener("pointercancel", onContactUp);

    // ── gestures (the shared grammar — src/lib/gesture) ──────────────
    // One finger touches the plasma: tap cracks a spark, a held touch
    // charges the core, a dwell hold plants a filament, ceremony blooms
    // the corona (or annihilates a filament held under it). Two fingers
    // touch the map: pan2 turns the ring, twist flips the charge polarity
    // (the lens — raises data-lens-raised so a two-finger tap can lower
    // it, else the tap falls through to ScaleTravel's own step-back).
    // Three fingers touch the law: drag bends every arc (weather), hold
    // slows the globe (time dilation), twist turns the season, tap is
    // tutti. Pinch stays unbound — the frame belongs to the manifold.
    const detachGestures = attachGestures(root, {
      tap: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers === 3) {
          // tutti — every filament answers at once, the globe stating itself.
          flashRef.current = 1;
          flashT0Ref.current = simNowMs;
          spark(cx, cy, 0.9);
          try { getAudio().bell(); } catch { /* noop */ }
          try { haptics.bloom(); } catch { /* noop */ }
          recordTapeRef.current("region", 0.7, "plasma/tutti");
          return;
        }
        if (e.fingers === 2) {
          // step back: lower the raised polarity lens first. ScaleTravel
          // reads data-lens-raised and yields to us when this is set.
          if (polarity.t > 0.5) {
            polarity.t = 0;
            root.removeAttribute("data-lens-raised");
            try { haptics.tap(); } catch { /* noop */ }
            try { getAudio().playNote(50, 120); } catch { /* noop */ }
          }
          return;
        }
        if (e.fingers !== 1) return;
        const { x, y } = toLocal(e.x, e.y);
        // the rapid-tap ladder (1 / 3 / 5 / n): a spark → a threefold
        // fork → the banked charge lets go at once → the globe overloads
        const trainTier = tapTrainTier(e.count);
        const depth = tapTrainDepth(e.count);
        if (trainTier === "n") {
          // crescendo: overload — a ring of flares off the rim and a
          // surge of heat the glass takes seconds to shed
          heatRef.current = clamp(heatRef.current + 0.3 + depth * 0.3, 0, 1);
          for (let k = 0; k < 6; k++) {
            const ang = (k / 6) * Math.PI * 2 + depth;
            flaresRef.current.push({
              x: cx + Math.cos(ang) * radius * 0.7,
              y: cy + Math.sin(ang) * radius * 0.7,
              t0: simNowMs,
              seed: (k + 1) / 7,
            });
          }
          if (flaresRef.current.length > 10) flaresRef.current.splice(0, flaresRef.current.length - 10);
          flashRef.current = Math.max(flashRef.current, 0.8 + depth * 0.2);
          flashT0Ref.current = simNowMs;
          try { getAudio().bell(); } catch { /* noop */ }
          try { haptics.storm(); } catch { /* noop */ }
          recordTapeRef.current("region", 0.8, "plasma/overload");
          return;
        }
        if (trainTier === 5) {
          // five quick taps milk the banked charge: whatever heat the
          // globe holds discharges NOW, sized by what it held
          const strength = 0.6 + heatRef.current * 0.4;
          spark(x, y, strength);
          try { getAudio().bell(); } catch { /* noop */ }
          try { haptics.storm(); } catch { /* noop */ }
          recordTapeRef.current("concern", 0.5 + heatRef.current * 0.5, "plasma/discharge");
          heatRef.current = Math.max(0, heatRef.current - 0.5);
          heatPeakRef.current = 0;
          return;
        }
        if (trainTier === 3) {
          // three taps fork the strike: the glass answers threefold
          for (let k = 0; k < 3; k++) {
            flaresRef.current.push({ x, y, t0: simNowMs, seed: (0.17 + k * 0.31 + depth * 0.13) % 1 });
          }
          if (flaresRef.current.length > 10) flaresRef.current.splice(0, flaresRef.current.length - 10);
          flashRef.current = Math.max(flashRef.current, 0.4 + depth * 0.3);
          flashT0Ref.current = simNowMs;
          try { getAudio().spark(); } catch { /* noop */ }
          try { getAudio().playNote(62 + Math.round(depth * 8), 140); } catch { /* noop */ }
          try { haptics.ripple(0.4 + depth * 0.3); } catch { /* noop */ }
          recordTapeRef.current("sigil", 0.55 + depth * 0.2, "plasma/fork");
          return;
        }
        // tap intensity is the crack: bloom, sound and haptic ride the
        // same 0..1 from core.
        spark(x, y, 0.55 + e.intensity * 0.45);
        try { getAudio().spark(); } catch { /* noop */ }
        try { haptics.chop(); } catch { /* noop */ }
        recordTapeRef.current("sigil", 0.5 + e.intensity * 0.3, "plasma/spark");
      },
      pan2: (e) => {
        lastGestureAt = performance.now();
        pan.tx += e.dx * 0.004;
      },
      twist: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers === 3) {
          // three fingers turn the season: a slow warm/cool drift whose
          // word tracks how fast the hand winds it.
          if (e.phase === "move") {
            season += e.angle * 0.7;
            const nowMs = performance.now();
            if (Math.abs(e.velocity) > 0.2 && nowMs - lastSeasonCueAt > 420) {
              lastSeasonCueAt = nowMs;
              try { getAudio().playTone(140 + (Math.sin(season) * 0.5 + 0.5) * 160, 0.3); } catch { /* noop */ }
              try { haptics.detent(); } catch { /* noop */ }
            }
          }
          return;
        }
        if (e.phase === "start") twistAcc = 0;
        if (e.phase === "move") twistAcc += e.angle;
        if (e.phase === "end" && Math.abs(twistAcc) > 0.9) {
          polarity.t = polarity.t > 0.5 ? 0 : 1;
          if (polarity.t > 0.5) root.setAttribute("data-lens-raised", "1");
          else root.removeAttribute("data-lens-raised");
          spark(cx, cy, 0.5);
          try { haptics.lens(); } catch { /* noop */ }
          try { getAudio().chime(); } catch { /* noop */ }
          recordTapeRef.current("sigil", 0.6, "plasma/polarity");
        }
      },
      drag: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers === 3) {
          if (e.phase === "end") return;
          // three fingers drag the law: every arc in the globe bows the
          // same way, ambient tendrils included
          bendTX = clamp(bendTX + e.vx * 0.04, -1, 1);
          bendTY = clamp(bendTY + e.vy * 0.04, -1, 1);
          const nowMs = performance.now();
          if (Math.hypot(e.vx, e.vy) > 0.3 && nowMs - lastBendFxAt > 900) {
            lastBendFxAt = nowMs;
            try { getAudio().playTone(96 + Math.hypot(bendTX, bendTY) * 130, 0.3); } catch { /* noop */ }
            try { haptics.chop(); } catch { /* noop */ }
            recordTapeRef.current("region", 0.5, "plasma/bend");
          }
          return;
        }
        if (e.fingers !== 1) return;
        if (e.phase === "start") {
          // the touch lands — a small strike where the finger meets glass
          const { x, y } = toLocal(e.x, e.y);
          spark(x, y, 0.4);
          try { getAudio().spark(); } catch { /* noop */ }
          try { haptics.tap(); } catch { /* noop */ }
          recordTapeRef.current("object", 0.55, "plasma/touch");
          return;
        }
        if (e.phase === "end") {
          if (heatPeakRef.current <= 0.55) {
            try { getAudio().thud(); } catch { /* noop */ }
          }
          return;
        }
        const nowMs = performance.now();
        if (nowMs - lastDragRipple > 90) {
          lastDragRipple = nowMs;
          try { haptics.ripple(0.18 + heatRef.current * 0.3); } catch { /* noop */ }
          recordTapeRef.current("ripple", 0.3 + heatRef.current * 0.4, "plasma/drag");
        }
      },
      flick: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers !== 1) return;
        // a flick throws the arc — it whips out and cracks on the rim
        const ex = cx + Math.cos(e.angle) * radius * 0.95;
        const ey = cy + Math.sin(e.angle) * radius * 0.95;
        spark(ex, ey, 0.7 + Math.min(0.3, e.speed * 0.2));
        try { getAudio().spark(); } catch { /* noop */ }
        try { haptics.chop(); } catch { /* noop */ }
        recordTapeRef.current("ripple", 0.6, "plasma/thrown-arc");
      },
      hold: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers === 3) {
          // three fingers hold the law: the plasma slows to a quarter speed,
          // and duration is an axis — the longer the chord stands, the
          // deeper the stillness gets
          if (e.phase === "enter") {
            timeScaleTarget = 0.25;
            try { getAudio().playNote(36, 260); } catch { /* noop */ }
            try { haptics.tap(); } catch { /* noop */ }
          }
          if (e.phase === "tick") timeScaleTarget = Math.max(0.07, 0.25 - 0.18 * clamp((e.elapsed - 900) / 3000, 0, 1));
          if (e.phase === "release") timeScaleTarget = 1;
          return;
        }
        if (e.fingers !== 1) return;
        if (e.phase === "enter") {
          holdState.ceremony = false;
          const disc = toDisc(e.x, e.y);
          gather.hit = nearestFilament(disc.nx, disc.ny);
          gather.nx = disc.nx; gather.ny = disc.ny;
          gather.active = true; gather.committed = false; gather.amt = 0;
          // the touch lands (a still hold never becomes a drag)
          const { x, y } = toLocal(e.x, e.y);
          spark(x, y, 0.4);
          try { getAudio().spark(); } catch { /* noop */ }
          try { haptics.tap(); } catch { /* noop */ }
          recordTapeRef.current("object", 0.55, "plasma/touch");
          return;
        }
        if (e.phase === "release") {
          gather.active = false;
          if (!holdState.ceremony && heatPeakRef.current <= 0.55) {
            try { getAudio().thud(); } catch { /* noop */ }
          }
          return;
        }
        if (gather.hit >= 0) {
          // ceremony hold on an existing filament: its solemn act is
          // annihilation — the touch-reachable delete.
          if (e.tier >= 3 && !gather.committed) {
            gather.committed = true;
            gather.active = false;
            removeFilament(gather.hit);
          }
          return;
        }
        // dwell on empty glass plants a filament — visibly gathering the
        // moment the dwell tier is crossed, deepening the longer it's held.
        if (e.tier >= 2) {
          gather.amt = Math.min(1, gather.amt + 0.03);
          if (!gather.committed) {
            gather.committed = true;
            addFilament(gather.nx, gather.ny);
          }
        }
        // ceremony tier — the room's one solemn act: the corona. The whole
        // globe reaches out in every direction at once and blooms.
        if (e.tier >= 3 && !holdState.ceremony) {
          holdState.ceremony = true;
          coronaUntil = simNowMs + 1800;
          flashRef.current = 1;
          flashT0Ref.current = simNowMs;
          try { getAudio().bell(); } catch { /* noop */ }
          try { haptics.bloom(); } catch { /* noop */ }
          recordTapeRef.current("sigil", 1, "plasma/corona");
        }
      },
      scrub: (e) => {
        lastGestureAt = performance.now();
        const nowMs = performance.now();
        if (nowMs - lastScrubAt < 700) return;
        lastScrubAt = nowMs;
        // circling sets a filament orbiting — it chases the hand's turn
        const { x, y } = toLocal(e.cx, e.cy);
        orbitRing = {
          t0: simNowMs,
          sign: Math.sign(e.winding) || 1,
          ang0: Math.atan2(y - cy, x - cx),
        };
        try { getAudio().playNote(66, 160); } catch { /* noop */ }
        try { haptics.ripple(0.35); } catch { /* noop */ }
        recordTapeRef.current("ripple", 0.55, "plasma/orbit");
      },
      rhythm: (e) => {
        // a steady tapped pulse: the core blinks in time with the hand
        if (e.stability <= 0.7) return;
        entrainBpm = Math.max(40, Math.min(140, e.bpm));
        entrainUntil = performance.now() + 9000;
      },
      span: (e) => {
        lastGestureAt = performance.now();
        const a = toLocal(e.ax, e.ay);
        const b = toLocal(e.bx, e.by);
        spanArc.ax = a.x;
        spanArc.ay = a.y;
        spanArc.bx = b.x;
        spanArc.by = b.y;
        spanArc.elapsed = e.elapsed;
        if (e.phase === "enter") {
          // two still fingers: an arc bridges them, glass to glass —
          // the sustained interval, and the one filament that skips the core
          spanArc.active = true;
          spark(a.x, a.y, 0.3);
          spark(b.x, b.y, 0.3);
          try { getAudio().buzz(); } catch { /* noop */ }
          try { haptics.tap(); } catch { /* noop */ }
          recordTapeRef.current("object", 0.5, "plasma/bridge");
          return;
        }
        if (e.phase === "release") {
          if (spanArc.active) {
            // the bridge lets go with a crack sized by how long it stood
            spark((spanArc.ax + spanArc.bx) / 2, (spanArc.ay + spanArc.by) / 2, 0.4 + Math.min(0.6, spanArc.elapsed / 4000));
            try { haptics.ripple(0.3 + Math.min(0.5, spanArc.elapsed / 5000)); } catch { /* noop */ }
          }
          spanArc.active = false;
          return;
        }
        // tick: the held interval hums, climbing for as long as it stands
        const nowMs = performance.now();
        if (nowMs - spanArc.lastHum > 240) {
          spanArc.lastHum = nowMs;
          try {
            getAudio().playTone(120 + Math.min(1, spanArc.elapsed / 4000) * 240 + (e.spread / Math.max(1, radius)) * 60, 0.24);
          } catch { /* noop */ }
        }
      },
      drum: (e) => {
        lastGestureAt = performance.now();
        // an alternating patter: the lightning leaps between the two spots
        // the hands keep, playing the space between them
        const a = toLocal(e.ax, e.ay);
        const b = toLocal(e.bx, e.by);
        const hit = toLocal(e.x, e.y);
        drumArc.ax = a.x;
        drumArc.ay = a.y;
        drumArc.bx = b.x;
        drumArc.by = b.y;
        drumArc.until = simNowMs + 600;
        spark(hit.x, hit.y, 0.35 + e.alternation * 0.3);
        try { getAudio().playNote(52 + (e.hits % 2) * 7 + Math.round(e.alternation * 5), 90); } catch { /* noop */ }
        try { haptics.tap(); } catch { /* noop */ }
        recordTapeRef.current("ripple", 0.4 + e.alternation * 0.3, "plasma/patter");
      },
    }, { wheelZoom: false, manageStyle: false });

    letGoRef.current = () => {
      filaments = [];
      writer.flush();
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ filaments: [] })); } catch { /* noop */ }
      setHasFilaments(false);
    };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      unvis();
      ungal();
      detachVessel();
      writer.flush();
      window.removeEventListener("resize", resize);
      if (typeof mq.removeEventListener === "function") mq.removeEventListener("change", onMq);
      detachGestures();
      root.removeEventListener("pointerdown", onContactDown);
      root.removeEventListener("pointermove", onContactMove);
      root.removeEventListener("pointerup", onContactUp);
      root.removeEventListener("pointercancel", onContactUp);
      if (gl) {
        orbCanvas.removeEventListener("webglcontextlost", onLost);
        orbCanvas.removeEventListener("webglcontextrestored", onRestored);
        try {
          if (buf) gl.deleteBuffer(buf);
          if (prog) gl.deleteProgram(prog);
          if (vs) gl.deleteShader(vs);
          if (fs) gl.deleteShader(fs);
        } catch { /* noop */ }
      }
    };
  }, [getAudio]);

  const letGo = () => {
    letGoRef.current();
    try { getFieldAudio().thud(); } catch { /* noop */ }
    try { haptics.roll(); } catch { /* noop */ }
    setHasFilaments(false);
  };

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
      <LetGo label="let the filaments go" onLetGo={letGo} visible={hasFilaments} />

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
        body:has(.plasma-instrument) header:not(.oda-site-header) { display: none !important; }
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
