"use client";

import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { useField } from "@/store/field";
import WaterText from "@/components/WaterText";

type OrbPalette = "candle" | "sea" | "flame" | "electric" | "aurora";

// Five palettes for Zone 1. Each is a tuple of (warm-core, hot-mid,
// paper-band, glow, electric). The button below cycles through them.
const ORB_PALETTES: Record<OrbPalette, {
  candle: [number, number, number];
  flameHot: [number, number, number];
  paper: [number, number, number];
  glow: [number, number, number];
  electric: [number, number, number];
  label: string;
}> = {
  candle:   {
    candle:   [1.000, 0.706, 0.431],
    flameHot: [1.000, 0.451, 0.180],
    paper:    [0.957, 0.910, 0.839],
    glow:     [0.784, 0.353, 0.110],
    electric: [0.420, 0.690, 1.000],
    label:    "candle",
  },
  sea:      {
    candle:   [0.435, 0.812, 0.894],
    flameHot: [0.173, 0.490, 0.661],
    paper:    [0.863, 0.933, 0.957],
    glow:     [0.102, 0.227, 0.322],
    electric: [0.420, 0.890, 1.000],
    label:    "sea",
  },
  flame:    {
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
  aurora:   {
    candle:   [0.420, 1.000, 0.690],
    flameHot: [0.580, 0.420, 1.000],
    paper:    [0.910, 0.957, 0.933],
    glow:     [0.110, 0.420, 0.353],
    electric: [1.000, 0.690, 0.890],
    label:    "aurora",
  },
};

const PALETTE_ORDER: OrbPalette[] = ["candle", "sea", "flame", "electric", "aurora"];

/**
 * PrismKnob — a 56px rotary dial with a needle indicator.
 *
 * The needle is driven by a self-owned RAF that reads from a global
 * window-attached "live value" hook keyed by the knob's `label`. This
 * keeps the knob completely decoupled from the Plasma component's state
 * while still updating at 60fps (the alternative — driving needle angle
 * through React state — would create a re-render storm during knob
 * drags). The Plasma component writes window.__plasmaKnobs[label] every
 * frame inside Zone 2's draw loop.
 *
 * Interactions are owned by the parent's Zone 2 effect (which attaches
 * pointer listeners directly to the ref'd element); this component only
 * handles the visual.
 */
const PrismKnob = forwardRef<HTMLDivElement, {
  label: string;
  value: number;
  valueRange: [number, number];
}>(function PrismKnob({ label, value, valueRange }, ref) {
  const visualRef = useRef<HTMLCanvasElement>(null);
  // Reads the live value from a window-side bag if Plasma has wired it,
  // otherwise falls back to the React prop (used for the very first paint).
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(() => {
    const canvas = visualRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = 56;
    canvas.width = Math.floor(size * dpr);
    canvas.height = Math.floor(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let raf = 0;
    const draw = () => {
      const live =
        (window as unknown as { __plasmaKnobs?: Record<string, number> }).__plasmaKnobs?.[label];
      const v = typeof live === "number" ? live : valueRef.current;
      const [lo, hi] = valueRange;
      // map v to 0..1
      const u = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
      // needle sweeps from -135° to +135° (270° arc)
      const startA = -Math.PI * 0.75;
      const endA = Math.PI * 0.75;
      const a = startA + (endA - startA) * u;

      const cx = size / 2;
      const cy = size / 2;
      ctx.clearRect(0, 0, size, size);
      // outer ring
      ctx.strokeStyle = "rgba(232, 226, 213, 0.35)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(cx, cy, size / 2 - 4, 0, Math.PI * 2);
      ctx.stroke();
      // tick marks at min, mid, max
      ctx.strokeStyle = "rgba(232, 226, 213, 0.55)";
      ctx.lineWidth = 1.4;
      for (const ang of [startA, 0, endA]) {
        const x1 = cx + Math.cos(ang) * (size / 2 - 6);
        const y1 = cy + Math.sin(ang) * (size / 2 - 6);
        const x2 = cx + Math.cos(ang) * (size / 2 - 10);
        const y2 = cy + Math.sin(ang) * (size / 2 - 10);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      // needle
      const needleR = size / 2 - 10;
      const nx = cx + Math.cos(a) * needleR;
      const ny = cy + Math.sin(a) * needleR;
      ctx.strokeStyle = "rgba(255, 252, 245, 0.92)";
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      // centre dot
      ctx.fillStyle = "rgba(255, 252, 245, 0.85)";
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [label, valueRange]);

  return (
    <div
      ref={ref}
      role="slider"
      aria-label={label}
      aria-valuemin={valueRange[0]}
      aria-valuemax={valueRange[1]}
      aria-valuenow={value}
      style={{
        position: "relative",
        width: 84,
        height: 84,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        cursor: "grab",
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
      }}
    >
      <canvas
        ref={visualRef}
        aria-hidden="true"
        style={{ width: 56, height: 56, display: "block", pointerEvents: "none" }}
      />
      <span
        className="t-mono"
        style={{
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "rgba(232, 226, 213, 0.72)",
          pointerEvents: "none",
        }}
      >
        {label}
      </span>
    </div>
  );
});

/**
 * /plasma — the light element.
 *
 * A five-band meditation on light as wave AND particle.
 *
 *   Zone 1 (top): a large central plasma orb. Cursor proximity raises its
 *     intensity; a click pulses a flash. On touch (or any pointerdown
 *     anywhere on the orb wrap) the same pulse fires so the surface stays
 *     responsive on devices that can't carry a hover.
 *
 *   Zone 2 (prism): white light enters from the left, hits a triangular
 *     prism, splits into seven dispersed rays. On desktop drag the prism
 *     and shift-drag to rotate. On mobile two large handles sit beside
 *     the prism — TILT (vertical drag) and ROTATE (horizontal drag) —
 *     so the modifier key is never required.
 *
 *   Zone 3 (dial): a continuous sinusoidal beam on the left morphs into
 *     discrete glowing particles on the right. A central dial drives the
 *     morph value m ∈ [0,1]; large touch-target dots ring the dial.
 *
 *   Zone 4 (interference): a 2D heatmap of standing-wave amplitude from
 *     2–3 draggable point sources. The field is computed on a coarse grid
 *     (~12px cells) and rendered as a deep-blue → cyan → amber → white
 *     ramp. Tap an empty area to add a third source (max 3).
 *
 *   Zone 5 (refraction): a horizontal beam enters from the left, crosses
 *     three rectangular media at different refractive indices, refracting
 *     at each boundary by Snell's law. Drag the boundaries horizontally
 *     to resize regions; the beam disperses into seven sub-rays.
 */

// shared mobile breakpoint heuristic. The actual interactivity always
// goes through PointerEvent, but layout switches to a per-zone full-
// screen rhythm at narrow widths so each interaction has room to breathe.
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    return undefined;
  }, []);
  return isMobile;
}

export default function Plasma() {
  // page-specific ambient bed: electric hum + sparkles
  useEffect(() => { getFieldAudio().setAmbientProfile("electric"); }, []);

  const isMobile = useIsMobile();
  const [plasmaMarks, setPlasmaMarks] = useState<Array<{ label: string; tone: string; t: number }>>([
    { label: "field", tone: "#6fcfe4", t: 0 },
  ]);
  const markPlasma = useCallback((label: string, tone = "#6fcfe4") => {
    setPlasmaMarks((prev) => [{ label, tone, t: performance.now() }, ...prev].slice(0, 5));
  }, []);
  // ── refs for each canvas + interactions ─────────────────────────
  const orbWrapRef = useRef<HTMLDivElement>(null);
  const orbCanvasRef = useRef<HTMLCanvasElement>(null);
  // dedicated 2D layer that paints spark trails on top of the orb
  const orbSparkRef = useRef<HTMLCanvasElement>(null);
  const prismWrapRef = useRef<HTMLDivElement>(null);
  const prismCanvasRef = useRef<HTMLCanvasElement>(null);
  // dedicated WebGL canvas for the iridescent prism body. Sits behind the
  // 2D canvas which paints the beam, rays, and tap targets.
  const prismGlassCanvasRef = useRef<HTMLCanvasElement>(null);
  const prismTiltKnobRef = useRef<HTMLDivElement>(null);
  const prismSpinKnobRef = useRef<HTMLDivElement>(null);
  const duaWrapRef = useRef<HTMLDivElement>(null);
  const duaCanvasRef = useRef<HTMLCanvasElement>(null);
  const interferenceWrapRef = useRef<HTMLDivElement>(null);
  const interferenceCanvasRef = useRef<HTMLCanvasElement>(null);
  const refractionWrapRef = useRef<HTMLDivElement>(null);
  const refractionCanvasRef = useRef<HTMLCanvasElement>(null);
  // Zone 6 (metal mirror) — WebGL backdrop for the brushed-steel surface,
  // plus a 2D overlay for the reflected dispersion rays.
  const metalWrapRef = useRef<HTMLDivElement>(null);
  const metalGlassRef = useRef<HTMLCanvasElement>(null);
  const metalCanvasRef = useRef<HTMLCanvasElement>(null);

  // Zone 1: cursor in canvas-local UV coords + click flash decay + spark
  // trails that fire from outside-the-orb clicks toward the center.
  type OrbSpark = {
    x0: number; y0: number; // start (css px relative to wrap)
    t0: number;             // ms — when the spark was born
    seed: number;           // small per-spark variation
  };
  const [orbPalette, setOrbPalette] = useState<OrbPalette>("candle");
  const orbPaletteRef = useRef<OrbPalette>("candle");
  useEffect(() => { orbPaletteRef.current = orbPalette; }, [orbPalette]);
  const orbState = useRef<{
    cx: number; cy: number; over: boolean; flash: number; flashT0: number;
    // additional fields populated by the effect; kept here so the type is
    // self-documenting in one place.
    scrubBoost: number;     // 0..1 — held boost so the local scrub feels alive
    sparks: OrbSpark[];
  }>({
    cx: 0, cy: 0, over: false, flash: 0, flashT0: 0,
    scrubBoost: 0, sparks: [],
  });

  // Zone 2: prism state.
  //   tilt  — vertical position (fraction of canvas h, 0.5 = middle).
  //           Driven by the TILT knob's circular drag (clockwise lowers).
  //   spin  — axial rotation of the prism (radians). Driven by the SPIN knob.
  //   autoRotate — long-press toggle; spin advances at a slow constant rate.
  //   sparkleT0 — performance.now() of the most recent "tap-the-prism"
  //               sparkle, drives a 700ms burst of glitter on the prism.
  //   randomize — non-null while the eased Randomize animation is running.
  //   incomingHue — hue selected via the left-side hue picker (0..1 around
  //                 the wheel). When hueWhite === true the beam is full
  //                 spectrum (the original ROYGBIV behaviour).
  //   rayBrightT0 — 7 slots of per-output-ray brightness pulse start times.
  //   beamFlash — head position of a white-beam injection (tap on beam).
  const prismState = useRef<{
    tilt: number;            // 0.18..0.82 — canvas-y fraction
    spin: number;            // radians, clamped to ~ ±2π so it doesn't accumulate
    autoRotate: boolean;
    sparkleT0: number;       // 0 = inactive
    randomize: {
      t0: number; from: { tilt: number; spin: number };
      to: { tilt: number; spin: number };
    } | null;
    incomingHue: number;     // 0..1 — beam hue
    hueWhite: boolean;       // true = full-spectrum white beam
    lastChimeAt: number;
    rayBrightT0: number[];   // 7 slots, 0 = inactive
    beamFlash: { x0: number; t0: number } | null;
  }>({
    tilt: 0.5, spin: 0, autoRotate: false, sparkleT0: 0, randomize: null,
    incomingHue: 0, hueWhite: true,
    lastChimeAt: 0,
    rayBrightT0: [0, 0, 0, 0, 0, 0, 0],
    beamFlash: null,
  });
  // mirror hue/auto-rotate selection to React so the UI chrome updates
  // (the active swatch ring, auto-rotate pill, etc).
  const [hueSelection, setHueSelection] = useState<{ hue: number; white: boolean }>({
    hue: 0, white: true,
  });
  const [autoRotateUi, setAutoRotateUi] = useState(false);

  // Zone 3: morph value m ∈ [0,1]. dialState tracks drag.
  // ripples carry the x position + birth-time of localized bumps on the wave;
  // jiggles is a sparse map: particle index → birth-time of its kick.
  const duaState = useRef<{
    m: number; dragging: boolean; grabX: number; grabM: number;
    lastChimeAt: number; lastExtreme: number;
    ripples: Array<{ x: number; t0: number }>;
    jiggles: Map<number, number>;
  }>({
    m: 0.0, dragging: false, grabX: 0, grabM: 0,
    lastChimeAt: 0, lastExtreme: -1,
    ripples: [],
    jiggles: new Map(),
  });

  // mirror m into React state so the inscribed label can re-render smoothly
  const [readout, setReadout] = useState({ wave: 100, particle: 0 });

  // Zone 4: standing-wave sources. We start with two; the user can add
  // a third by tapping an empty area. Positions are stored in CANVAS-LOCAL
  // CSS pixel coordinates and rescaled relative to the current canvas size
  // when we draw, so resizing doesn't strand them.
  type WaveSource = {
    // normalized [0,1] coords (so the source stays put across resizes)
    nx: number; ny: number;
  };
  const interferenceState = useRef<{
    sources: WaveSource[];
    dragIdx: number;       // -1 = not dragging
    grabDx: number; grabDy: number;
  }>({
    sources: [
      { nx: 0.30, ny: 0.45 },
      { nx: 0.70, ny: 0.55 },
    ],
    dragIdx: -1,
    grabDx: 0, grabDy: 0,
  });
  const [interferenceCount, setInterferenceCount] = useState(2);

  // Zone 5: light-through-media. Three regions separated by two vertical
  // boundaries (each in [0,1]). Three refractive indices, plus a beam
  // entry y (also normalized). Dragging a boundary horizontally resizes
  // its neighbouring regions.
  const refractionState = useRef<{
    b1: number; b2: number;    // normalized x of boundaries, b1 < b2
    n: [number, number, number]; // refractive indices
    entryY: number;            // normalized y for beam entry
    dragB: 0 | 1 | -1;         // 0=b1, 1=b2, -1=none
    lastThudAt: number;
  }>({
    b1: 0.33, b2: 0.66,
    n: [1.00, 1.50, 1.20],
    entryY: 0.50,
    dragB: -1,
    lastThudAt: 0,
  });

  // Zone 6 — metal mirror.
  // A horizontal-ish strip near the bottom of the prism zone is rendered
  // with brushed-chrome shading. The dispersed rays from Zone 2 land on
  // it and reflect outward, with chromatic-aberration (RGB channel
  // separation) baked into the reflection. The user can rotate + slide
  // the strip with two handles.
  //   centerY  — vertical centre as canvas-fraction (0.5 = middle).
  //   tilt     — radians, surface normal angle from vertical.
  //   dragMode — "move" / "rot" / null while dragging.
  const metalState = useRef<{
    centerY: number; tilt: number;
    dragMode: "move" | "rot" | null;
    grabCenterY: number; grabTilt: number;
    grabPX: number; grabPY: number;
    lastThudAt: number;
  }>({
    centerY: 0.78, tilt: 0.05,
    dragMode: null,
    grabCenterY: 0, grabTilt: 0, grabPX: 0, grabPY: 0,
    lastThudAt: 0,
  });

  // recordTape — pulled from the store, stable identity via getState()
  const recordTape = useField((s) => s.recordTape);
  const recordTapeRef = useRef(recordTape);
  recordTapeRef.current = recordTape;

  // a single audio handle, lazily created
  const audioRef = useRef<ReturnType<typeof getFieldAudio> | null>(null);
  const getAudio = useCallback(() => {
    if (!audioRef.current) audioRef.current = getFieldAudio();
    return audioRef.current;
  }, []);

  // ─────────────────────────────────────────────────────────────────
  // Zone 1 — Plasma Orb
  // ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const wrap = orbWrapRef.current;
    const canvas = orbCanvasRef.current;
    if (!wrap || !canvas) return;

    const gl =
      (canvas.getContext("webgl", { antialias: false, premultipliedAlpha: true, alpha: true }) ||
        canvas.getContext(
          "experimental-webgl" as "webgl",
          { antialias: false, premultipliedAlpha: true, alpha: true } as WebGLContextAttributes,
        )) as WebGLRenderingContext | null;
    if (!gl) {
      wrap.setAttribute("data-plasma-fallback", "1");
      return;
    }

    const vert = `
      attribute vec2 a_pos;
      varying vec2 vUv;
      void main() {
        vUv = a_pos;
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }
    `;
    // Hotter, slightly more electric palette than the candle PlasmaOrb —
    // candle warmth at the core, flame mid, cool electric blue rim spark.
    const frag = `
      precision highp float;
      uniform float u_time;
      uniform float u_reduced;
      uniform float u_intensity;
      uniform float u_flash;
      uniform vec2  u_cursor;     // canvas-local UV in [-1, 1], inside the disc; (-2, -2) when off
      uniform float u_scrub;      // 0..1 — local boost strength near cursor
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
        for (int i = 0; i < 5; i++) {
          v += a * vnoise(p);
          p *= 2.07;
          a *= 0.52;
        }
        return v;
      }

      void main() {
        vec2 uv = vUv;
        float r = length(uv);

        float disc = 1.0 - smoothstep(0.98, 1.005, r);
        if (disc <= 0.0) {
          gl_FragColor = vec4(0.0);
          return;
        }

        float t = u_time;
        float motion = mix(0.08, 1.0, 1.0 - u_reduced);
        float flow = 0.40 * motion;

        // breath + flash boost
        float breath = 1.0 + sin(t * 6.2831853 * 0.14 * motion) * 0.16;
        float intensity = clamp(u_intensity, 0.0, 1.6);
        float flash = clamp(u_flash, 0.0, 1.0);

        // 2 crossed FBM-warped bands
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

        // palette comes in via uniforms — same shape as the original
        // candle/flame/paper/glow/electric quintet, but driven by the
        // "color shift" toggle below the orb.
        vec3 candle    = u_pal_candle;
        vec3 flameHot  = u_pal_flame;
        vec3 paper     = u_pal_paper;
        vec3 glow      = u_pal_glow;
        vec3 electric  = u_pal_elec;

        vec3 col = glow * bloom * 0.95;
        vec3 bandAColor = mix(candle, flameHot, hotMix);
        col += bandAColor * bandA * 1.10;
        col += paper * bandB * 0.78;

        // a small electric pulse at the core — pushes "plasma" reading
        float elec = exp(-r * r * 18.0);
        col += electric * elec * (0.18 + 0.10 * sin(t * 4.3));

        col += paper * coreHi * 0.40;
        col += flameHot * coreHi * 0.30;

        // intensity (cursor proximity) lifts overall brightness
        col *= breath * (0.85 + intensity * 0.55);

        // local scrub — a small region around the cursor brightens harder
        // than the rest of the disc, so the orb feels touchable.
        vec2 cur = u_cursor;
        if (cur.x > -1.5) {
          float dc = length(uv - cur);
          float local = exp(-(dc * dc) / 0.025);
          col += electric * local * u_scrub * 0.45;
          col += paper * local * u_scrub * 0.30;
        }

        // flash: brief whitish bloom
        col += vec3(1.0, 0.92, 0.84) * flash * 0.85 * (0.4 + bloom);

        // rim shade so the orb reads as a body
        float rimShade = smoothstep(0.86, 1.0, r) * 0.35;
        col *= (1.0 - rimShade);

        float aRadial = smoothstep(1.0, 0.0, r);
        float aField = clamp(bandA * 0.9 + bandB * 0.6 + bloom * 0.9 + coreHi * 1.0 + flash * 0.6, 0.0, 1.0);
        float alpha = clamp(mix(aRadial * 0.35, 1.0, aField), 0.0, 1.0) * disc;
        gl_FragColor = vec4(col * alpha, alpha);
      }
    `;

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
    const vs = compile(gl.VERTEX_SHADER, vert);
    const fs = compile(gl.FRAGMENT_SHADER, frag);
    if (!vs || !fs) {
      wrap.setAttribute("data-plasma-fallback", "1");
      return;
    }
    const prog = gl.createProgram();
    if (!prog) {
      wrap.setAttribute("data-plasma-fallback", "1");
      return;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      wrap.setAttribute("data-plasma-fallback", "1");
      return;
    }

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const aPos = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const uTime = gl.getUniformLocation(prog, "u_time");
    const uReduced = gl.getUniformLocation(prog, "u_reduced");
    const uIntensity = gl.getUniformLocation(prog, "u_intensity");
    const uFlash = gl.getUniformLocation(prog, "u_flash");
    const uCursor = gl.getUniformLocation(prog, "u_cursor");
    const uScrub = gl.getUniformLocation(prog, "u_scrub");
    const uPalCandle = gl.getUniformLocation(prog, "u_pal_candle");
    const uPalFlame  = gl.getUniformLocation(prog, "u_pal_flame");
    const uPalPaper  = gl.getUniformLocation(prog, "u_pal_paper");
    const uPalGlow   = gl.getUniformLocation(prog, "u_pal_glow");
    const uPalElec   = gl.getUniformLocation(prog, "u_pal_elec");

    // Smoothed palette so toggling cross-fades over ~250ms instead of jumping.
    const palSmoothed = {
      candle:   [...ORB_PALETTES.candle.candle]   as [number, number, number],
      flameHot: [...ORB_PALETTES.candle.flameHot] as [number, number, number],
      paper:    [...ORB_PALETTES.candle.paper]    as [number, number, number],
      glow:     [...ORB_PALETTES.candle.glow]     as [number, number, number],
      electric: [...ORB_PALETTES.candle.electric] as [number, number, number],
    };

    const sparkCanvas = orbSparkRef.current;
    const sparkCtx = sparkCanvas?.getContext("2d") ?? null;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
      if (sparkCanvas && sparkCtx) {
        sparkCanvas.width = Math.max(1, Math.floor(w * dpr));
        sparkCanvas.height = Math.max(1, Math.floor(h * dpr));
        sparkCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = mq.matches ? 1 : 0;
    const onMq = () => { reduced = mq.matches ? 1 : 0; };
    if (typeof mq.addEventListener === "function") mq.addEventListener("change", onMq);

    // helper: how far the pointer is from the centre of the orb, in the
    // same normalized units the shader uses (1.0 = edge of the disc).
    const orbR = (cx01: number, cy01: number): number => {
      const w = wrap.clientWidth || 1;
      const h = wrap.clientHeight || 1;
      const ar = w / h;
      const dx = (cx01 - 0.5) * ar;
      const dy = (cy01 - 0.5);
      // the disc fills the height (vUv ∈ [-1,1] x [-1,1] orthographic); we
      // scale dy by 2 to span [-1,1] across the canvas.
      return Math.hypot(dx * 2, dy * 2);
    };

    // ── pointer interactions on the wrap (the canvas is pointer-events:none) ──
    const onMove = (e: PointerEvent) => {
      const rect = wrap.getBoundingClientRect();
      const cx = (e.clientX - rect.left) / rect.width;  // 0..1
      const cy = (e.clientY - rect.top) / rect.height;
      orbState.current.cx = cx;
      orbState.current.cy = cy;
      orbState.current.over = true;
      // hovering over the disc lifts the scrub boost; it relaxes when the
      // cursor strays past the edge, so the surface feels touchable.
      const r = orbR(cx, cy);
      orbState.current.scrubBoost = Math.max(0, 1 - Math.max(0, r));
    };
    const onLeave = () => {
      orbState.current.over = false;
      orbState.current.scrubBoost = 0;
    };
    const onDown = (e: PointerEvent) => {
      const now = performance.now();
      const rect = wrap.getBoundingClientRect();
      const cx01 = (e.clientX - rect.left) / rect.width;
      const cy01 = (e.clientY - rect.top) / rect.height;
      orbState.current.cx = cx01;
      orbState.current.cy = cy01;
      orbState.current.over = true;
      const r = orbR(cx01, cy01);
      // Touch input never produces a hover-driven intensity ramp, so we
      // lift scrubBoost briefly here so the disc visibly responds to the
      // tap even before the flash decay fires. The boost decays again
      // through the onMove / onLeave handlers.
      const isTouch = e.pointerType === "touch" || e.pointerType === "pen";
      if (isTouch) {
        orbState.current.scrubBoost = Math.max(orbState.current.scrubBoost, 0.85);
      }
      if (r > 1.0) {
        // OUTSIDE the orb — spawn a spark trail that travels toward center.
        // On touch we ALSO fire the flash so a tap-anywhere on the wrap
        // is always read as an interaction.
        const sx = (e.clientX - rect.left);
        const sy = (e.clientY - rect.top);
        orbState.current.sparks.push({
          x0: sx, y0: sy, t0: now, seed: Math.random(),
        });
        if (orbState.current.sparks.length > 8) orbState.current.sparks.shift();
        try { getAudio().spark(); } catch { /* noop */ }
        if (isTouch) {
          // tap-anywhere-to-pulse fallback — a softer flash than the
          // direct-hit version, so it still feels like the disc is the
          // primary surface, just reachable from anywhere.
          orbState.current.flash = Math.max(orbState.current.flash, 0.55);
          orbState.current.flashT0 = now;
          try { getAudio().bell(); } catch { /* noop */ }
          recordTapeRef.current("sigil", 0.7, "plasma/burst-touch");
        }
      } else {
        // click → flash burst + bell + tape (unchanged behavior inside the orb)
        orbState.current.flash = 1.0;
        orbState.current.flashT0 = now;
        try { getAudio().bell(); } catch { /* noop */ }
        recordTapeRef.current("sigil", 1.0, "plasma/burst");
      }
    };
    wrap.addEventListener("pointermove", onMove);
    wrap.addEventListener("pointerleave", onLeave);
    wrap.addEventListener("pointerdown", onDown);

    const t0 = performance.now();
    let raf = 0;

    const draw = (now: number) => {
      const t = (now - t0) / 1000;

      // ── intensity from cursor proximity to centre ───────────────
      // canvas centre is 0.5,0.5; aspect-correct distance.
      const s = orbState.current;
      let intensity = 0;
      if (s.over) {
        const w = wrap.clientWidth || 1;
        const h = wrap.clientHeight || 1;
        const ar = w / h;
        const dx = (s.cx - 0.5) * ar;
        const dy = (s.cy - 0.5);
        const d = Math.hypot(dx, dy);
        // within ~0.6 normalized units, ramp intensity up to 1
        intensity = Math.max(0, 1 - d / 0.6);
      }

      // flash decays exponentially over ~400ms
      let flash = 0;
      if (s.flash > 0) {
        const age = (now - s.flashT0) / 1000;
        flash = Math.exp(-age * 6); // ~85% gone by 400 ms
        if (flash < 0.001) { s.flash = 0; flash = 0; }
        else s.flash = flash;
      }

      // cursor in clip-space coords matching vUv (centered, ortho)
      let curX = -2;
      let curY = -2;
      let scrub = 0;
      if (s.over) {
        const w = wrap.clientWidth || 1;
        const h = wrap.clientHeight || 1;
        const ar = w / h;
        // vUv covers [-1..1] across the canvas; scale x by aspect so the
        // local boost is round in CSS space.
        curX = (s.cx - 0.5) * 2 * ar;
        curY = -(s.cy - 0.5) * 2;
        // only "scrub" while inside the disc
        const rr = Math.hypot((s.cx - 0.5) * ar, s.cy - 0.5);
        if (rr < 0.5) {
          scrub = s.scrubBoost;
        }
      }

      gl.useProgram(prog);
      if (uTime) gl.uniform1f(uTime, t);
      if (uReduced) gl.uniform1f(uReduced, reduced);
      if (uIntensity) gl.uniform1f(uIntensity, intensity);
      if (uFlash) gl.uniform1f(uFlash, flash);
      if (uCursor) gl.uniform2f(uCursor, curX, curY);
      if (uScrub) gl.uniform1f(uScrub, scrub);

      // ── palette cross-fade ──────────────────────────────────────
      // Lerp the live palette toward the selected one at ~0.06/frame so
      // the toggle reads as a smooth wash, not a hard cut.
      const target = ORB_PALETTES[orbPaletteRef.current];
      const k = 0.06;
      const lerpTriple = (
        cur: [number, number, number],
        dst: [number, number, number],
      ) => {
        cur[0] += (dst[0] - cur[0]) * k;
        cur[1] += (dst[1] - cur[1]) * k;
        cur[2] += (dst[2] - cur[2]) * k;
      };
      lerpTriple(palSmoothed.candle,   target.candle);
      lerpTriple(palSmoothed.flameHot, target.flameHot);
      lerpTriple(palSmoothed.paper,    target.paper);
      lerpTriple(palSmoothed.glow,     target.glow);
      lerpTriple(palSmoothed.electric, target.electric);
      if (uPalCandle) gl.uniform3f(uPalCandle, palSmoothed.candle[0],   palSmoothed.candle[1],   palSmoothed.candle[2]);
      if (uPalFlame)  gl.uniform3f(uPalFlame,  palSmoothed.flameHot[0], palSmoothed.flameHot[1], palSmoothed.flameHot[2]);
      if (uPalPaper)  gl.uniform3f(uPalPaper,  palSmoothed.paper[0],    palSmoothed.paper[1],    palSmoothed.paper[2]);
      if (uPalGlow)   gl.uniform3f(uPalGlow,   palSmoothed.glow[0],     palSmoothed.glow[1],     palSmoothed.glow[2]);
      if (uPalElec)   gl.uniform3f(uPalElec,   palSmoothed.electric[0], palSmoothed.electric[1], palSmoothed.electric[2]);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // ── spark trails (drawn into the 2D overlay above the WebGL canvas) ──
      if (sparkCanvas && sparkCtx) {
        const w = wrap.clientWidth || 1;
        const h = wrap.clientHeight || 1;
        sparkCtx.clearRect(0, 0, w, h);
        const centerX = w * 0.5;
        const centerY = h * 0.5;
        for (let i = s.sparks.length - 1; i >= 0; i--) {
          const sp = s.sparks[i];
          const age = (now - sp.t0) / 1000;
          if (age > 0.75) { s.sparks.splice(i, 1); continue; }
          // travel: ease-in toward center; trail behind position
          const tt = Math.min(1, age / 0.65);
          const k = tt * tt; // ease-in
          const px = sp.x0 + (centerX - sp.x0) * k;
          const py = sp.y0 + (centerY - sp.y0) * k;
          // draw a short comet tail (a couple of segments)
          const tailSteps = 6;
          for (let j = 0; j < tailSteps; j++) {
            const ut = Math.max(0, k - j * 0.07);
            const tx = sp.x0 + (centerX - sp.x0) * ut;
            const ty = sp.y0 + (centerY - sp.y0) * ut;
            const aDot = Math.max(0, 1 - age / 0.75) * (1 - j / tailSteps) * 0.85;
            const rDot = 2.0 + j * 0.5;
            sparkCtx.fillStyle = `rgba(255, 240, 220, ${aDot * 0.5})`;
            sparkCtx.beginPath();
            sparkCtx.arc(tx, ty, rDot + 1.5, 0, Math.PI * 2);
            sparkCtx.fill();
            sparkCtx.fillStyle = `rgba(255, 252, 245, ${aDot})`;
            sparkCtx.beginPath();
            sparkCtx.arc(tx, ty, rDot * 0.5, 0, Math.PI * 2);
            sparkCtx.fill();
          }
          // when the spark reaches center, give the orb a tiny kick
          if (tt >= 1 && !(sp as OrbSpark & { _kicked?: boolean })._kicked) {
            (sp as OrbSpark & { _kicked?: boolean })._kicked = true;
            s.flash = Math.max(s.flash, 0.45);
            s.flashT0 = now;
          }
          // reference px/py to keep them in scope (avoids dead-code warning)
          void px; void py;
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerleave", onLeave);
      wrap.removeEventListener("pointerdown", onDown);
      if (typeof mq.removeEventListener === "function") mq.removeEventListener("change", onMq);
      try {
        gl.deleteBuffer(buf);
        gl.deleteProgram(prog);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
      } catch { /* noop */ }
    };
  }, [getAudio]);

  // ─────────────────────────────────────────────────────────────────
  // Zone 2 — Prism Dispersion (iridescent + color-aware)
  // ─────────────────────────────────────────────────────────────────
  //
  // The prism is now rendered in two layers:
  //   1. A WebGL canvas (prismGlassCanvas) paints the iridescent body —
  //      a soap-bubble / oil-slick fragment shader with 4-octave FBM,
  //      driven by the prism's spin + tilt and a thin-film interference
  //      term that washes a rainbow over the glass.
  //   2. A 2D canvas on top paints the beam, the dispersed rays, the
  //      "tap-the-prism" sparkles, and the wireframe triangle outline.
  //
  // Interactions are no longer drag-the-prism + shift-drag-rotate. They
  // are now two RING KNOBS below the prism (TILT and SPIN). Each knob
  // accepts a circular drag and shows a needle for the current angle.
  // Tapping the prism (no drag) sparkles. Long-pressing it toggles an
  // auto-rotate mode. A Randomize button animates both knobs to a fresh
  // pose over ~1.2s with easeOutCubic.
  useEffect(() => {
    const wrap = prismWrapRef.current;
    const canvas = prismCanvasRef.current;
    const glassCanvas = prismGlassCanvasRef.current;
    if (!wrap || !canvas || !glassCanvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ── ray spectrum (canonical wavelength weights for ROYGBIV) ─────
    // We still address rays by name for tape entries and tones, but the
    // colour the ray paints with is now COMPUTED at draw time from the
    // incoming beam hue + the prism's spin/tilt + the wavelength weight.
    type RaySpec = { name: string; w: number; freq: number };
    const RAY_SPECS: RaySpec[] = [
      { name: "red",    w: 0.00, freq: 261.63 },
      { name: "orange", w: 0.16, freq: 293.66 },
      { name: "yellow", w: 0.32, freq: 329.63 },
      { name: "green",  w: 0.50, freq: 369.99 },
      { name: "blue",   w: 0.68, freq: 415.30 },
      { name: "indigo", w: 0.84, freq: 466.16 },
      { name: "violet", w: 1.00, freq: 523.25 },
    ];

    // HSL → RGB (returns [0..255] triples for canvas styles).
    const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
      // h, s, l in 0..1
      const a = s * Math.min(l, 1 - l);
      const f = (n: number) => {
        const k = (n + h * 12) % 12;
        return l - a * Math.max(-1, Math.min(Math.min(k - 3, 9 - k), 1));
      };
      return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
    };

    // Compute the RGB triple for ray i ∈ [0..6] given the current state.
    //   When the beam is white (full spectrum), each ray gets a canonical
    //   wavelength hue (red=0, violet=0.78) but tilted by the prism spin
    //   and dispersed by the tilt — so rotating the prism shifts the
    //   palette and tilting compresses/expands the spread.
    //   When the beam is a chosen hue, the seven rays are SHADES of that
    //   hue: same h, but with l (and a tiny h) walked by the wavelength
    //   weight. The result is e.g. 7 distinct reds rather than ROYGBIV.
    const rayColor = (
      i: number,
      hueWhite: boolean,
      hue: number,
      spin: number,
      tilt: number,
    ): { r: number; g: number; b: number } => {
      const w = RAY_SPECS[i].w;
      if (hueWhite) {
        // approximate visible-light hue range: red 0deg → violet 280deg
        // (i.e. h ∈ [0, 0.78] in 0..1). spin walks the whole palette by
        // up to ±15% of the wheel; tilt subtly nudges saturation/luminance.
        const hueBase = w * 0.78;
        const spinShift = (spin / (Math.PI * 2)) * 0.15;
        const h = (hueBase + spinShift + 1) % 1;
        const sat = 0.78 - Math.abs(tilt) * 0.12;
        const lum = 0.62 - Math.abs(tilt) * 0.06;
        const [r, g, b] = hslToRgb(h, Math.max(0, Math.min(1, sat)), Math.max(0, Math.min(1, lum)));
        return { r, g, b };
      } else {
        // shades of the chosen hue. Slight chromatic spread (±0.04 of the
        // wheel) so the rays don't ALL look identical at l=midpoint.
        const spinShift = (spin / (Math.PI * 2)) * 0.10;
        const h = ((hue + (w - 0.5) * 0.08 + spinShift) + 1) % 1;
        const sat = 0.85;
        const lum = 0.34 + w * 0.46; // ray 0 dark, ray 6 bright
        const [r, g, b] = hslToRgb(h, sat, Math.max(0, Math.min(1, lum)));
        return { r, g, b };
      }
    };

    // ── WebGL setup for the iridescent glass body ──────────────────
    // The glass is rendered as a fullscreen quad; the fragment shader
    // tests whether vUv (in CSS px coords) is inside the prism triangle
    // and, if so, applies an oil-slick thin-film interference pattern.
    // 4-octave FBM keeps the GPU cost predictable across phones.
    const gl =
      (glassCanvas.getContext("webgl", { antialias: false, premultipliedAlpha: true, alpha: true }) ||
        glassCanvas.getContext(
          "experimental-webgl" as "webgl",
          { antialias: false, premultipliedAlpha: true, alpha: true } as WebGLContextAttributes,
        )) as WebGLRenderingContext | null;
    let glProg: WebGLProgram | null = null;
    let uGlTime: WebGLUniformLocation | null = null;
    let uGlPa: WebGLUniformLocation | null = null;
    let uGlPb: WebGLUniformLocation | null = null;
    let uGlPc: WebGLUniformLocation | null = null;
    let uGlRes: WebGLUniformLocation | null = null;
    let uGlSpin: WebGLUniformLocation | null = null;
    let uGlReduced: WebGLUniformLocation | null = null;

    if (gl) {
      const vert = `
        attribute vec2 a_pos;
        varying vec2 vUv;
        void main() {
          vUv = a_pos * 0.5 + 0.5;
          gl_Position = vec4(a_pos, 0.0, 1.0);
        }
      `;
      // Iridescent thin-film shader. 4-octave FBM only.
      const frag = `
        precision mediump float;
        uniform float uTime;
        uniform vec2  uPa;        // triangle vertex A (CSS px)
        uniform vec2  uPb;
        uniform vec2  uPc;
        uniform vec2  uRes;       // canvas size in CSS px (w, h)
        uniform float uSpin;      // radians — drives the rainbow sweep
        uniform float uReduced;   // 1.0 freezes animation
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
        // 4-octave FBM — capped for phone perf.
        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 4; i++) {
            v += a * vnoise(p);
            p *= 2.07;
            a *= 0.52;
          }
          return v;
        }

        // Point-in-triangle via sign tests.
        float sideSign(vec2 p, vec2 a, vec2 b) {
          return (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
        }
        // 0..1 distance from edge — used to soft-shade the rim.
        float edgeDistance(vec2 p, vec2 a, vec2 b) {
          vec2 d = b - a;
          float t = clamp(dot(p - a, d) / max(1e-3, dot(d, d)), 0.0, 1.0);
          vec2 c = a + d * t;
          return length(p - c);
        }

        // Hue → RGB (HSL with l=0.55, s=0.8) — used for thin-film bands.
        vec3 hueRgb(float h) {
          h = fract(h);
          float r = abs(h * 6.0 - 3.0) - 1.0;
          float g = 2.0 - abs(h * 6.0 - 2.0);
          float b = 2.0 - abs(h * 6.0 - 4.0);
          return clamp(vec3(r, g, b), 0.0, 1.0);
        }

        void main() {
          // vUv is 0..1; convert to CSS px to match the JS triangle coords.
          vec2 p = vec2(vUv.x * uRes.x, (1.0 - vUv.y) * uRes.y);

          float s1 = sideSign(p, uPa, uPb);
          float s2 = sideSign(p, uPb, uPc);
          float s3 = sideSign(p, uPc, uPa);
          bool inside = (s1 >= 0.0 && s2 >= 0.0 && s3 >= 0.0)
                     || (s1 <= 0.0 && s2 <= 0.0 && s3 <= 0.0);

          if (!inside) {
            // outside the triangle — paint a soft glow ring around it.
            float d1 = edgeDistance(p, uPa, uPb);
            float d2 = edgeDistance(p, uPb, uPc);
            float d3 = edgeDistance(p, uPc, uPa);
            float d = min(min(d1, d2), d3);
            float haloA = exp(-d * d / (28.0 * 28.0)) * 0.55;
            if (haloA < 0.01) { gl_FragColor = vec4(0.0); return; }
            // halo carries a desaturated rainbow hint so the prism reads
            // as iridescent even before you tilt it.
            float hueH = uSpin / 6.2831853 + 0.5;
            vec3 haloCol = mix(vec3(0.86, 0.88, 0.95), hueRgb(hueH), 0.30);
            gl_FragColor = vec4(haloCol * haloA, haloA);
            return;
          }

          // INSIDE the prism. Build a thin-film color via FBM-warped
          // hue gradients. The warp coords ride spin so the colors
          // SWIRL when the prism turns — a true iridescent feel.
          float time = (uReduced > 0.5) ? 0.0 : uTime;
          vec2 q = vUv * 4.0;
          // rotate by spin
          float cs = cos(uSpin);
          float sn = sin(uSpin);
          q = vec2(q.x * cs - q.y * sn, q.x * sn + q.y * cs);
          float n1 = fbm(q + vec2(time * 0.10, time * 0.08));
          float n2 = fbm(q * 1.4 + vec2(-time * 0.06, time * 0.12) + 11.0);
          // thin-film band index — wavelength-ish layers stack with depth
          float band = n1 * 0.6 + n2 * 0.4;
          float h = fract(band * 1.4 + uSpin / 6.2831853);
          vec3 film = hueRgb(h);

          // mix in a paper-tinted glass body so the iridescence sits on
          // top of a translucent material rather than replacing it.
          vec3 glassBody = vec3(0.78, 0.83, 0.93);
          // edge halo inside the body — accentuates the wireframe and
          // gives the glass a believable thin-edge highlight.
          float d1 = edgeDistance(p, uPa, uPb);
          float d2 = edgeDistance(p, uPb, uPc);
          float d3 = edgeDistance(p, uPc, uPa);
          float dEdge = min(min(d1, d2), d3);
          float edgeBoost = exp(-dEdge / 16.0) * 0.55;

          vec3 col = mix(glassBody, film, 0.45 + edgeBoost * 0.35);
          // gentle inner highlight from band density
          float spec = pow(max(0.0, n1 - 0.5) * 2.0, 6.0) * 0.5;
          col += vec3(spec);

          // alpha — translucent body, ramps up near edges so the glass
          // reads as a body. ~0.62 in centre, ~0.90 at edges.
          float a = 0.62 + edgeBoost * 0.28;
          a = clamp(a, 0.0, 1.0);
          // premultiplied output
          gl_FragColor = vec4(col * a, a);
        }
      `;
      const compile = (type: number, src: string) => {
        const s = gl.createShader(type);
        if (!s) return null;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          console.warn("Prism iridescent shader compile failed", gl.getShaderInfoLog(s));
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
            uGlTime = gl.getUniformLocation(p, "uTime");
            uGlPa = gl.getUniformLocation(p, "uPa");
            uGlPb = gl.getUniformLocation(p, "uPb");
            uGlPc = gl.getUniformLocation(p, "uPc");
            uGlRes = gl.getUniformLocation(p, "uRes");
            uGlSpin = gl.getUniformLocation(p, "uSpin");
            uGlReduced = gl.getUniformLocation(p, "uReduced");
            const buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(
              gl.ARRAY_BUFFER,
              new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
              gl.STATIC_DRAW,
            );
            const aPos = gl.getAttribLocation(p, "a_pos");
            gl.enableVertexAttribArray(aPos);
            gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
            gl.useProgram(p);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          }
        }
      }
    }

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      glassCanvas.width = Math.max(1, Math.floor(w * dpr));
      glassCanvas.height = Math.max(1, Math.floor(h * dpr));
      if (gl) gl.viewport(0, 0, glassCanvas.width, glassCanvas.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // ── audio helper for a per-ray tone ─────────────────────────────
    const playRayTone = (i: number) => {
      try {
        const a = getAudio();
        const ctx0 = a.getAudioContext();
        if (!ctx0) return;
        if (ctx0.state === "suspended") { try { void ctx0.resume(); } catch { /* noop */ } }
        const t = ctx0.currentTime;
        const osc = ctx0.createOscillator();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(RAY_SPECS[i].freq, t);
        const g = ctx0.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.07, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
        osc.connect(g).connect(ctx0.destination);
        osc.start(t);
        osc.stop(t + 0.6);
      } catch { /* noop */ }
    };

    const distToSeg = (
      px: number, py: number,
      ax: number, ay: number,
      bx: number, by: number,
    ): number => {
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-6) return Math.hypot(px - ax, py - ay);
      let t = ((px - ax) * dx + (py - ay) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const cx = ax + dx * t;
      const cy = ay + dy * t;
      return Math.hypot(px - cx, py - cy);
    };

    // ── sparkles (Zone 2): brief glitter when the prism is tapped ──
    type Sparkle = { x: number; y: number; vx: number; vy: number; t0: number; hue: number };
    const sparkles: Sparkle[] = [];

    // ── long-press detection on the prism ──────────────────────────
    let longPressTimer: number | null = null;
    let longPressFired = false;       // true once the timer's callback runs
    let dragStarted = false;
    let downPos: { x: number; y: number; t: number } | null = null;
    const LONG_PRESS_MS = 520;
    const TAP_TOLERANCE_PX = 8;

    const onDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const w = rect.width;
      const h = rect.height;
      const st = prismState.current;
      const cx = w * 0.5;
      const cy = h * st.tilt;

      // common ray geometry (must match the draw loop)
      const tri = 64;
      const triH = tri * Math.sqrt(3);
      const cosR = Math.cos(st.spin);
      const sinR = Math.sin(st.spin);
      const rotPt = (x: number, y: number) => ({
        x: cx + (x * cosR - y * sinR),
        y: cy + (x * sinR + y * cosR),
      });
      const pA = rotPt(0, -triH * 0.55);
      const pC = rotPt(tri, triH * 0.45);
      const exitX = (pA.x + pC.x) * 0.5;
      const exitY = (pA.y + pC.y) * 0.5;
      const tiltAngle = st.spin * 1.4;
      const baseSpread = 0.55;
      const rayLen = Math.max(180, w - exitX - 30);

      // 1. tap-the-prism — within ~80px of prism centre is "the prism"
      const hit = Math.hypot(px - cx, py - cy) < 80;
      if (hit) {
        downPos = { x: px, y: py, t: performance.now() };
        dragStarted = false;
        longPressFired = false;
        // arm long-press → toggle auto-rotate
        if (longPressTimer != null) window.clearTimeout(longPressTimer);
        longPressTimer = window.setTimeout(() => {
          if (downPos && !dragStarted) {
            // toggle auto-rotate
            longPressFired = true;
            prismState.current.autoRotate = !prismState.current.autoRotate;
            setAutoRotateUi(prismState.current.autoRotate);
            try { getAudio().bell(); } catch { /* noop */ }
            recordTapeRef.current(
              "sigil",
              0.6,
              prismState.current.autoRotate ? "plasma/prism/auto-on" : "plasma/prism/auto-off",
            );
          }
          longPressTimer = null;
        }, LONG_PRESS_MS);
        canvas.setPointerCapture?.(e.pointerId);
        return;
      }

      // 2. ray tap
      let bestRay = -1;
      let bestD = Infinity;
      for (let i = 0; i < RAY_SPECS.length; i++) {
        const ws = RAY_SPECS[i].w;
        const angle = tiltAngle + (ws - 0.5) * baseSpread;
        const ex = exitX + Math.cos(angle) * rayLen;
        const ey = exitY + Math.sin(angle) * rayLen;
        const d = distToSeg(px, py, exitX, exitY, ex, ey);
        if (d < bestD) { bestD = d; bestRay = i; }
      }
      if (bestRay >= 0 && bestD < 12) {
        st.rayBrightT0[bestRay] = performance.now();
        playRayTone(bestRay);
        recordTapeRef.current("sigil", 0.6, `plasma/ray/${RAY_SPECS[bestRay].name}`);
        return;
      }

      // 3. white-beam tap
      const beamY = cy + 6 * Math.sin(st.spin);
      const beamStartX = 24;
      const beamEndX = cx - 36;
      if (px >= beamStartX - 10 && px <= beamEndX + 10 && Math.abs(py - beamY) < 14) {
        st.beamFlash = {
          x0: Math.max(beamStartX, Math.min(beamEndX, px)),
          t0: performance.now(),
        };
        try { getAudio().spark(); } catch { /* noop */ }
        return;
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!downPos) return;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const dx = px - downPos.x;
      const dy = py - downPos.y;
      if (!dragStarted && Math.hypot(dx, dy) > TAP_TOLERANCE_PX) {
        dragStarted = true;
        // cancel long-press
        if (longPressTimer != null) {
          window.clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      }
    };

    // tap-to-sparkle / tap-to-stop-auto-rotate
    const spawnSparkle = (cx: number, cy: number, hue: number) => {
      const N = 18;
      const now = performance.now();
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2 + Math.random() * 0.4;
        const sp = 70 + Math.random() * 60;
        sparkles.push({
          x: cx + (Math.random() - 0.5) * 12,
          y: cy + (Math.random() - 0.5) * 12,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          t0: now,
          hue: (hue + (Math.random() - 0.5) * 0.18 + 1) % 1,
        });
      }
      if (sparkles.length > 96) sparkles.splice(0, sparkles.length - 96);
    };
    const onUp = (e: PointerEvent) => {
      if (longPressTimer != null) {
        window.clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      // Only treat this as a tap if the long-press DIDN'T fire and the
      // user didn't drag. Otherwise the release just ends the long-press
      // (which already toggled auto-rotate inside its setTimeout callback).
      if (downPos && !dragStarted && !longPressFired) {
        const st = prismState.current;
        const rect = canvas.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;
        const cx = w * 0.5;
        const cy = h * st.tilt;
        // if auto-rotate is on (entered via a PREVIOUS long-press), a
        // short tap turns it off — no sparkle.
        if (st.autoRotate) {
          st.autoRotate = false;
          setAutoRotateUi(false);
          try { getAudio().chime(); } catch { /* noop */ }
        } else {
          st.sparkleT0 = performance.now();
          spawnSparkle(cx, cy, st.hueWhite ? 0.55 : st.incomingHue);
          try { getAudio().spark(); } catch { /* noop */ }
          recordTapeRef.current("sigil", 0.5, "plasma/prism/tap");
        }
      }
      downPos = null;
      dragStarted = false;
      longPressFired = false;
      try { canvas.releasePointerCapture?.(e.pointerId); } catch { /* noop */ }
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    // ── ROTARY KNOBS ───────────────────────────────────────────────
    // Each knob is an HTMLDivElement we read via ref. The user drags
    // anywhere inside the knob; the angle from the knob's centre to the
    // pointer becomes the knob's value. We compute deltas relative to
    // grab so the user doesn't have to "find" the needle first.
    type KnobBinding = {
      el: HTMLDivElement | null;
      apply: (value: number) => void;
      read: () => number;     // current angle in radians
      sensitivity: number;    // 1 = linear; 1.4 stretches the spin knob
      tape: string;
    };

    const setupKnob = (b: KnobBinding) => {
      if (!b.el) return () => {};
      let drag: { centerX: number; centerY: number; startAngle: number; startVal: number } | null = null;
      const onKnobDown = (e: PointerEvent) => {
        if (!b.el) return;
        const rect = b.el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const ang = Math.atan2(e.clientY - cy, e.clientX - cx);
        drag = {
          centerX: cx, centerY: cy,
          startAngle: ang, startVal: b.read(),
        };
        try { b.el.setPointerCapture(e.pointerId); } catch { /* noop */ }
        e.preventDefault();
      };
      const onKnobMove = (e: PointerEvent) => {
        if (!drag) return;
        const ang = Math.atan2(e.clientY - drag.centerY, e.clientX - drag.centerX);
        // smallest signed delta — wraps around the back of the dial
        let d = ang - drag.startAngle;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        b.apply(drag.startVal + d * b.sensitivity);
        const now = performance.now();
        if (now - prismState.current.lastChimeAt > 320) {
          try { getAudio().chime(); } catch { /* noop */ }
          prismState.current.lastChimeAt = now;
        }
      };
      const onKnobUp = (e: PointerEvent) => {
        if (drag) {
          recordTapeRef.current("sigil", 0.4, b.tape);
        }
        drag = null;
        try { b.el?.releasePointerCapture(e.pointerId); } catch { /* noop */ }
      };
      b.el.addEventListener("pointerdown", onKnobDown);
      b.el.addEventListener("pointermove", onKnobMove);
      b.el.addEventListener("pointerup", onKnobUp);
      b.el.addEventListener("pointercancel", onKnobUp);
      return () => {
        if (!b.el) return;
        b.el.removeEventListener("pointerdown", onKnobDown);
        b.el.removeEventListener("pointermove", onKnobMove);
        b.el.removeEventListener("pointerup", onKnobUp);
        b.el.removeEventListener("pointercancel", onKnobUp);
      };
    };

    // TILT knob — drives prismState.tilt (canvas y-fraction).
    // The knob's needle angle ψ ∈ [-π/2..+π/2] maps to tilt ∈ [0.18..0.82].
    const tiltCleanup = setupKnob({
      el: prismTiltKnobRef.current,
      sensitivity: 0.6,
      read: () => (prismState.current.tilt - 0.5) * Math.PI, // back-convert
      apply: (psi: number) => {
        // clamp ψ to ±π/2 so the knob can't wrap into the upside-down zone
        const c = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, psi));
        prismState.current.tilt = Math.max(0.18, Math.min(0.82, 0.5 + c / Math.PI));
        // cancel auto-rotate when the user interacts directly
        if (prismState.current.autoRotate) {
          prismState.current.autoRotate = false;
          setAutoRotateUi(false);
        }
      },
      tape: "plasma/prism/tilt",
    });
    const spinCleanup = setupKnob({
      el: prismSpinKnobRef.current,
      sensitivity: 1.0,
      read: () => prismState.current.spin,
      apply: (val: number) => {
        // allow wrap-around freely, but clamp to ±2π so float drift can't accumulate
        let v = val;
        while (v > Math.PI * 2) v -= Math.PI * 2;
        while (v < -Math.PI * 2) v += Math.PI * 2;
        prismState.current.spin = v;
        if (prismState.current.autoRotate) {
          prismState.current.autoRotate = false;
          setAutoRotateUi(false);
        }
      },
      tape: "plasma/prism/spin",
    });

    // ── RANDOMIZE listener ─────────────────────────────────────────
    // The Randomize button fires a CustomEvent on the wrap. The effect
    // listens here so we can keep the eased animation state local.
    const onRandomize = () => {
      const st = prismState.current;
      // sample a fresh pose — within the same clamped bounds the knobs use.
      const targetTilt = 0.28 + Math.random() * 0.44;
      // spin in a wider arc than ±π so the rotation reads as obvious
      const targetSpin = (Math.random() * 2 - 1) * Math.PI * 0.85;
      st.randomize = {
        t0: performance.now(),
        from: { tilt: st.tilt, spin: st.spin },
        to: { tilt: targetTilt, spin: targetSpin },
      };
      // also disable autoRotate so the animation isn't smeared
      if (st.autoRotate) {
        st.autoRotate = false;
        setAutoRotateUi(false);
      }
      try { getAudio().chime(); } catch { /* noop */ }
      recordTapeRef.current("sigil", 0.7, "plasma/prism/randomize");
    };
    wrap.addEventListener("plasma:prism-randomize", onRandomize as EventListener);

    const t0 = performance.now();
    let raf = 0;
    let lastAutoSpinUpdate = performance.now();

    const draw = (now: number) => {
      const t = (now - t0) / 1000;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const motion = reduce ? 0 : 1;

      // ── ease the randomize animation (1.2s, easeOutCubic) ──────
      const st = prismState.current;
      if (st.randomize) {
        const age = (now - st.randomize.t0) / 1000;
        const dur = 1.2;
        if (age >= dur) {
          st.tilt = st.randomize.to.tilt;
          st.spin = st.randomize.to.spin;
          st.randomize = null;
        } else {
          const u = age / dur;
          const k = 1 - Math.pow(1 - u, 3); // easeOutCubic
          st.tilt = st.randomize.from.tilt + (st.randomize.to.tilt - st.randomize.from.tilt) * k;
          st.spin = st.randomize.from.spin + (st.randomize.to.spin - st.randomize.from.spin) * k;
        }
      }

      // ── auto-rotate (long-press toggle) ─────────────────────────
      if (st.autoRotate && motion) {
        const dt = (now - lastAutoSpinUpdate) / 1000;
        st.spin += dt * 0.35; // ~0.35 rad/s
        // keep spin numerically bounded
        if (st.spin > Math.PI * 2) st.spin -= Math.PI * 2;
        if (st.spin < -Math.PI * 2) st.spin += Math.PI * 2;
      }
      lastAutoSpinUpdate = now;

      // ── triangle geometry ──────────────────────────────────────
      const cx = w * 0.5;
      const cy = h * st.tilt;
      const tri = 64;
      const triH = tri * Math.sqrt(3);
      const cosR = Math.cos(st.spin);
      const sinR = Math.sin(st.spin);
      const rotPt = (x: number, y: number) => ({
        x: cx + (x * cosR - y * sinR),
        y: cy + (x * sinR + y * cosR),
      });
      const pA = rotPt(0, -triH * 0.55);
      const pB = rotPt(-tri, triH * 0.45);
      const pC = rotPt(tri, triH * 0.45);

      // ── WebGL pass: iridescent body ────────────────────────────
      if (gl && glProg) {
        gl.useProgram(glProg);
        if (uGlTime) gl.uniform1f(uGlTime, t);
        if (uGlPa) gl.uniform2f(uGlPa, pA.x, pA.y);
        if (uGlPb) gl.uniform2f(uGlPb, pB.x, pB.y);
        if (uGlPc) gl.uniform2f(uGlPc, pC.x, pC.y);
        if (uGlRes) gl.uniform2f(uGlRes, w, h);
        if (uGlSpin) gl.uniform1f(uGlSpin, st.spin);
        if (uGlReduced) gl.uniform1f(uGlReduced, reduce ? 1 : 0);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }

      // ── 2D pass: beam + rays + sparkles + outline ─────────────
      ctx.clearRect(0, 0, w, h);

      // beam
      const beamY = cy + 6 * Math.sin(st.spin);
      const beamStartX = 24;
      const beamEndX = cx - 36;
      // The "incoming" color is white when hueWhite, otherwise the picked hue.
      const incomingColor: [number, number, number] = st.hueWhite
        ? [255, 248, 232]
        : hslToRgb(st.incomingHue, 0.85, 0.55);
      const beamGlow = ctx.createLinearGradient(beamStartX, beamY, beamEndX, beamY);
      const rgb = `${incomingColor[0]}, ${incomingColor[1]}, ${incomingColor[2]}`;
      beamGlow.addColorStop(0, `rgba(${rgb}, 0)`);
      beamGlow.addColorStop(0.15, `rgba(${rgb}, 0.55)`);
      beamGlow.addColorStop(1, `rgba(${rgb}, 0.95)`);
      ctx.strokeStyle = beamGlow;
      ctx.lineWidth = 10;
      ctx.lineCap = "round";
      ctx.shadowColor = `rgba(${rgb}, 0.6)`;
      ctx.shadowBlur = 22;
      ctx.beginPath();
      ctx.moveTo(beamStartX, beamY);
      ctx.lineTo(beamEndX, beamY);
      ctx.stroke();
      ctx.shadowBlur = 0;
      // hot core
      ctx.strokeStyle = `rgba(${rgb}, 0.95)`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(beamStartX, beamY);
      ctx.lineTo(beamEndX, beamY);
      ctx.stroke();

      // small entry marker on the left edge so it reads as "beam in here"
      ctx.fillStyle = `rgba(${rgb}, 0.85)`;
      ctx.fillRect(0, beamY - 2, 8, 4);

      // ── beam flash injection ──────────────────────────────────
      let beamHead: { x: number; y: number } | null = null;
      if (st.beamFlash) {
        const age = (now - st.beamFlash.t0) / 1000;
        const TRAVEL = 0.32;
        if (age < TRAVEL) {
          const u = age / TRAVEL;
          beamHead = {
            x: st.beamFlash.x0 + (beamEndX - st.beamFlash.x0) * u,
            y: beamY,
          };
        } else if (age < TRAVEL + 0.05) {
          const arriveT = st.beamFlash.t0 + TRAVEL * 1000;
          for (let i = 0; i < st.rayBrightT0.length; i++) {
            if (st.rayBrightT0[i] < arriveT) st.rayBrightT0[i] = arriveT;
          }
          st.beamFlash = null;
        } else {
          st.beamFlash = null;
        }
      }
      if (beamHead) {
        ctx.save();
        ctx.shadowColor = `rgba(${rgb}, 0.85)`;
        ctx.shadowBlur = 14;
        ctx.fillStyle = `rgba(${rgb}, 0.95)`;
        ctx.beginPath();
        ctx.arc(beamHead.x, beamHead.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        const trailGrad = ctx.createLinearGradient(
          beamHead.x - 36, beamHead.y, beamHead.x, beamHead.y,
        );
        trailGrad.addColorStop(0, `rgba(${rgb}, 0)`);
        trailGrad.addColorStop(1, `rgba(${rgb}, 0.95)`);
        ctx.strokeStyle = trailGrad;
        ctx.lineWidth = 2.4;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(beamHead.x - 36, beamHead.y);
        ctx.lineTo(beamHead.x, beamHead.y);
        ctx.stroke();
        ctx.restore();
      }

      // ── triangle outline (sits on top of WebGL glass) ─────────
      ctx.strokeStyle = "rgba(232, 226, 213, 0.55)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(pA.x, pA.y);
      ctx.lineTo(pB.x, pB.y);
      ctx.lineTo(pC.x, pC.y);
      ctx.closePath();
      ctx.stroke();

      // ── dispersed rays ────────────────────────────────────────
      const exitX = (pA.x + pC.x) * 0.5;
      const exitY = (pA.y + pC.y) * 0.5;
      const baseSpread = 0.55;
      const tiltAngle = st.spin * 1.4;
      const rayLen = Math.max(180, w - exitX - 30);
      const stNow = prismState.current;
      // expose for Zone 6 reflection — written each frame to a Map on
      // the window so the metal mirror effect can read the live rays.
      const rayExports: Array<{
        x0: number; y0: number; x1: number; y1: number;
        r: number; g: number; b: number; bMul: number;
      }> = [];

      for (let i = 0; i < RAY_SPECS.length; i++) {
        const sp = RAY_SPECS[i];
        const angle = tiltAngle + (sp.w - 0.5) * baseSpread;
        const gx1 = exitX + Math.cos(angle) * rayLen;
        const gy1 = exitY + Math.sin(angle) * rayLen;

        const brightT0 = stNow.rayBrightT0[i];
        let bMul = 1;
        if (brightT0 > 0) {
          const bAge = (now - brightT0) / 1000;
          if (bAge < 0.8) {
            const env = bAge < 0.05 ? bAge / 0.05 : Math.max(0, 1 - (bAge - 0.05) / 0.75);
            bMul = 1 + env * 1.4;
          } else {
            stNow.rayBrightT0[i] = 0;
          }
        }

        const { r, g, b } = rayColor(
          i, st.hueWhite, st.incomingHue, st.spin, st.spin * 0.3,
        );
        rayExports.push({ x0: exitX, y0: exitY, x1: gx1, y1: gy1, r, g, b, bMul });

        const perpX = -Math.sin(angle);
        const perpY = Math.cos(angle);
        const SEG = 24;
        const phase = motion ? t * (1.0 + sp.w * 0.6) : 0;
        const amp = 1.4 + sp.w * 0.6;
        const wob = motion ? Math.sin(t * 0.7 + sp.w * 6) * 0.6 : 0;

        // soft halo stroke — wider, ALPHA bumped by bMul
        const haloA = Math.min(0.95, 0.55 * bMul);
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${haloA.toFixed(3)})`;
        ctx.lineWidth = 8 * Math.min(1.7, bMul);
        ctx.lineCap = "round";
        ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${haloA.toFixed(3)})`;
        ctx.shadowBlur = 16 * Math.min(2.0, bMul);
        ctx.beginPath();
        for (let k = 0; k <= SEG; k++) {
          const u = k / SEG;
          const x = exitX + (gx1 - exitX) * u;
          const y = exitY + (gy1 - exitY) * u;
          const disp = Math.sin(u * Math.PI * 6 + phase + sp.w * 3) * amp * Math.min(1, u * 2) + wob;
          const xx = x + perpX * disp;
          const yy = y + perpY * disp;
          if (k === 0) ctx.moveTo(xx, yy);
          else ctx.lineTo(xx, yy);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // thin core line — bright + tight
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${Math.min(0.98, 0.95 * bMul).toFixed(3)})`;
        ctx.lineWidth = 1.4 * Math.min(2.4, bMul);
        ctx.beginPath();
        for (let k = 0; k <= SEG; k++) {
          const u = k / SEG;
          const x = exitX + (gx1 - exitX) * u;
          const y = exitY + (gy1 - exitY) * u;
          const disp = Math.sin(u * Math.PI * 6 + phase + sp.w * 3) * amp * Math.min(1, u * 2) + wob;
          const xx = x + perpX * disp;
          const yy = y + perpY * disp;
          if (k === 0) ctx.moveTo(xx, yy);
          else ctx.lineTo(xx, yy);
        }
        ctx.stroke();
      }

      // share rays with Zone 6 (metal mirror). We store on a module-level
      // ref-like global so the metal effect can read without forcing this
      // effect to re-render. The shape is intentionally small.
      (window as unknown as { __plasmaRays?: typeof rayExports }).__plasmaRays = rayExports;
      // exit point + spin for the metal effect (informs the reflection geometry)
      (window as unknown as { __plasmaExit?: { x: number; y: number; spin: number; tilt: number } })
        .__plasmaExit = { x: exitX, y: exitY, spin: st.spin, tilt: st.tilt };

      // expose knob live values for the PrismKnob visual layer
      const knobBag = ((window as unknown as { __plasmaKnobs?: Record<string, number> })
        .__plasmaKnobs ??= {});
      knobBag["tilt"] = (st.tilt - 0.5) * Math.PI;
      knobBag["spin"] = st.spin;

      // ── sparkles ─────────────────────────────────────────────
      for (let i = sparkles.length - 1; i >= 0; i--) {
        const s = sparkles[i];
        const age = (now - s.t0) / 1000;
        if (age > 0.7) { sparkles.splice(i, 1); continue; }
        const u = age / 0.7;
        const x = s.x + s.vx * age;
        const y = s.y + s.vy * age + 60 * age * age; // slight gravity
        const a = (1 - u) * 0.9;
        const [sr, sg, sb] = hslToRgb(s.hue, 0.85, 0.65);
        ctx.fillStyle = `rgba(${sr}, ${sg}, ${sb}, ${a.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, 1.8 + (1 - u) * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── tiny labels at ray endpoints ─────────────────────────
      ctx.font = "10px var(--font-mono), ui-monospace, monospace";
      ctx.fillStyle = "rgba(232, 226, 213, 0.32)";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      for (let i = 0; i < RAY_SPECS.length; i++) {
        const sp = RAY_SPECS[i];
        const angle = tiltAngle + (sp.w - 0.5) * baseSpread;
        const labelX = exitX + Math.cos(angle) * (rayLen + 10);
        const labelY = exitY + Math.sin(angle) * (rayLen + 10);
        ctx.fillText(sp.name.slice(0, 3), labelX, labelY);
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      wrap.removeEventListener("plasma:prism-randomize", onRandomize as EventListener);
      if (longPressTimer != null) window.clearTimeout(longPressTimer);
      tiltCleanup();
      spinCleanup();
      if (gl) {
        try { if (glProg) gl.deleteProgram(glProg); } catch { /* noop */ }
      }
      delete (window as unknown as { __plasmaRays?: unknown }).__plasmaRays;
      delete (window as unknown as { __plasmaExit?: unknown }).__plasmaExit;
    };
  }, [getAudio]);

  // ─────────────────────────────────────────────────────────────────
  // Zone 3 — Wave / Particle Duality
  // ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const wrap = duaWrapRef.current;
    const canvas = duaCanvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // ── dial drag interaction ───────────────────────────────────────
    const dialHit = (px: number, py: number, w: number, h: number) => {
      const dialCx = w * 0.5;
      const dialCy = h * 0.5;
      // 44px finger-friendly hit target; dial is drawn at r=28 + ring=4
      return Math.hypot(px - dialCx, py - dialCy) < 44;
    };
    // returns matching dot index (0..7) if tap hits a touch dot, else -1
    const touchDotHit = (px: number, py: number, w: number, h: number) => {
      const dialCx = w * 0.5;
      const dialCy = h * 0.5;
      const touchR = 28 + 18; // dialR + touch-target offset
      const TOUCH_DOT_COUNT = 8;
      for (let i = 0; i < TOUCH_DOT_COUNT; i++) {
        const a = Math.PI + (i / (TOUCH_DOT_COUNT - 1)) * Math.PI;
        const tx = dialCx + Math.cos(a) * touchR;
        const ty = dialCy + Math.sin(a) * touchR;
        if (Math.hypot(px - tx, py - ty) < 22) return i;
      }
      return -1;
    };
    const onDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const w = rect.width;
      const h = rect.height;
      // 1. dial drag (preserves existing behavior)
      if (dialHit(px, py, w, h)) {
        duaState.current.dragging = true;
        duaState.current.grabX = px;
        duaState.current.grabM = duaState.current.m;
        canvas.setPointerCapture?.(e.pointerId);
        return;
      }
      // 1b. touch dot tap — snap m to that position, plus a small bell.
      const dotIdx = touchDotHit(px, py, w, h);
      if (dotIdx >= 0) {
        const TOUCH_DOT_COUNT = 8;
        duaState.current.m = dotIdx / (TOUCH_DOT_COUNT - 1);
        try { getAudio().chime(); } catch { /* noop */ }
        return;
      }
      const axisY = h * 0.5;
      const axisPadX = 40;
      const axisLeft = axisPadX;
      const axisRight = w - axisPadX;
      const m = duaState.current.m;

      // 2. particle tap — when m is high enough that particles exist, try
      // to pick one within 18px. The particle layout matches the draw loop.
      const PCOUNT = 48;
      if (m > 0.05) {
        for (let i = 0; i < PCOUNT; i++) {
          const u = (i + 0.5) / PCOUNT;
          const x0 = axisLeft + (axisRight - axisLeft) * u;
          // hash01 mirror — same as the draw loop's per-position noise
          const hash01 = (k: number) => {
            const v = Math.sin(k * 12.9898) * 43758.5453;
            return v - Math.floor(v);
          };
          const wobX = (hash01(i + 3) - 0.5) * 4;
          const x = x0 + wobX;
          if (Math.abs(px - x) > 18) continue;
          // particle y near the wave line + jitter
          const jitterY = (hash01(i + 7) - 0.5) * 6;
          // we don't know the live wavePhase here; just check vertical bounds
          // around axisY ± waveAmp + jitter
          if (Math.abs(py - axisY) < 38 + Math.abs(jitterY)) {
            duaState.current.jiggles.set(i, performance.now());
            try { getAudio().spark(); } catch { /* noop */ }
            return;
          }
        }
      }

      // 3. wave-line tap — vertical proximity to the wave band
      // (the wave amplitude is 28; allow a touchable band of ±28 + 14 slack)
      if (px >= axisLeft && px <= axisRight && Math.abs(py - axisY) < 42) {
        duaState.current.ripples.push({ x: px, t0: performance.now() });
        if (duaState.current.ripples.length > 6) duaState.current.ripples.shift();
        try { getAudio().chime(); } catch { /* noop */ }
        return;
      }
    };
    const onMove = (e: PointerEvent) => {
      const st = duaState.current;
      if (!st.dragging) return;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const w = rect.width;
      // 1/2 viewport drag = full sweep
      const dx = (px - st.grabX) / (w * 0.5);
      st.m = Math.max(0, Math.min(1, st.grabM + dx));
      // chime softly at extremes (passing 0 or 1). Distinct sound per side:
      //   wave (m≈0) → bell;  particle (m≈1) → chime.
      const now = performance.now();
      if ((st.m < 0.03 || st.m > 0.97) && now - st.lastChimeAt > 600) {
        const extreme = st.m < 0.5 ? 0 : 1;
        if (extreme !== st.lastExtreme) {
          try {
            const a = getAudio();
            if (extreme === 0) a.bell();
            else a.chime();
          } catch { /* noop */ }
          st.lastChimeAt = now;
          st.lastExtreme = extreme;
        }
      } else if (st.m > 0.1 && st.m < 0.9) {
        st.lastExtreme = -1;
      }
    };
    const onUp = (e: PointerEvent) => {
      duaState.current.dragging = false;
      try { canvas.releasePointerCapture?.(e.pointerId); } catch { /* noop */ }
    };
    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    const t0 = performance.now();
    let raf = 0;
    let lastReadoutAt = 0;

    // deterministic per-position noise (so particle smear arcs stay coherent)
    const hash01 = (i: number) => {
      const v = Math.sin(i * 12.9898) * 43758.5453;
      return v - Math.floor(v);
    };

    const draw = (now: number) => {
      const t = (now - t0) / 1000;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const motion = reduce ? 0 : 1;
      const m = duaState.current.m;

      ctx.clearRect(0, 0, w, h);

      // ── axis line ────────────────────────────────────────────────
      const axisY = h * 0.5;
      const axisPadX = 40;
      const axisLeft = axisPadX;
      const axisRight = w - axisPadX;

      // very faint baseline
      ctx.strokeStyle = "rgba(232, 226, 213, 0.10)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(axisLeft, axisY);
      ctx.lineTo(axisRight, axisY);
      ctx.stroke();

      // ── shared parameters for the morph ──────────────────────────
      // we sample N positions along the axis. At each position we have
      //   - a wave value (sine of x + phase)
      //   - a particle bucket (rounded x) with a per-bucket offset
      // and we blend them by m.
      // wave alpha = (1-m), particle alpha = m, BUT we also "stitch" the
      // wave at intermediate m (drop segments) and "smear" particles
      // (extend them into short arcs of length ~m*..).
      const N = 240;
      const wavePhase = motion ? t * 1.6 : 0;
      const waveAmp = 28;
      const baseFreq = 0.040;

      // ── ripple displacement helper ──────────────────────────────
      // Each ripple is a Gaussian bump centered on its x position; the bump
      // travels outward as a small wave (its envelope contracts over time).
      const rippleBump = (x: number): number => {
        let sum = 0;
        const arr = duaState.current.ripples;
        for (let i = arr.length - 1; i >= 0; i--) {
          const rp = arr[i];
          const age = (now - rp.t0) / 1000;
          if (age > 1.4) { arr.splice(i, 1); continue; }
          const fall = Math.max(0, 1 - age / 1.4);
          // a small outward propagation: the bump itself doesn't move, but
          // we make the "carrier" oscillate to give a sense of propagation
          const sigma = 14 + age * 60;
          const dx = x - rp.x;
          const env = Math.exp(-(dx * dx) / (2 * sigma * sigma));
          // upward bump (negative y on canvas)
          sum -= env * 18 * fall * (1 + 0.25 * Math.sin(age * 18));
        }
        return sum;
      };

      // ── wave (polyline). We now keep the wave coherent across the
      // entire morph range but taper its alpha asymmetrically so that
      // mid-range values (m ≈ 0.4–0.6) show BOTH the wave and the
      // particles overlapping at half strength — a clearer visualization
      // of duality than a hard hand-off.
      // We use a long-tail curve: pow((1 - m), 0.65). Wave reaches zero
      // only at m === 1, so even at m=0.5 the wave is still ~62% present.
      const waveAlphaBase = Math.pow(Math.max(0, 1 - m), 0.65);
      // small per-segment hash flutter for life — bumps individual segments
      // by ±2px in y, scaled by a sin(m·π) bell so it only kicks in at the
      // intermediate region where both representations coexist.
      const fluxBell = Math.sin(Math.max(0, Math.min(1, m)) * Math.PI);
      // outer glow
      ctx.strokeStyle = `rgba(120, 220, 255, ${0.18 * waveAlphaBase})`;
      ctx.lineWidth = 6;
      ctx.lineCap = "round";
      ctx.shadowColor = `rgba(120, 220, 255, ${0.4 * waveAlphaBase})`;
      ctx.shadowBlur = motion ? 10 : 0;
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const x = axisLeft + (axisRight - axisLeft) * u;
        const flux = (hash01(i + 11) - 0.5) * fluxBell * 4;
        const y = axisY + Math.sin(x * baseFreq + wavePhase) * waveAmp
                + rippleBump(x) + flux;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      // thin core
      ctx.strokeStyle = `rgba(180, 240, 255, ${0.85 * waveAlphaBase})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const x = axisLeft + (axisRight - axisLeft) * u;
        const flux = (hash01(i + 11) - 0.5) * fluxBell * 4;
        const y = axisY + Math.sin(x * baseFreq + wavePhase) * waveAmp
                + rippleBump(x) + flux;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // ── particles. At m=0 they don't appear; at m=1 they sit as bright
      // dots scattered along the line. At intermediate m, each particle
      // is SMEARED into a short arc whose length scales with (1-m).
      // The arc traces a short tangent to the underlying wave curve.
      const PCOUNT = 48;
      // Mirror of the wave's pow(1-m, 0.65): particles ramp in early so
      // the two readings coexist around m ≈ 0.5. Together with the wave's
      // alpha the union stays ≥ ~1 across the full m range.
      const particleAlphaBase = Math.pow(Math.max(0, m), 0.65);
      // prune dead jiggles up front so the map doesn't grow without bound
      duaState.current.jiggles.forEach((startMs, idx) => {
        if (now - startMs > 600) duaState.current.jiggles.delete(idx);
      });
      for (let i = 0; i < PCOUNT; i++) {
        const u = (i + 0.5) / PCOUNT;
        const x0 = axisLeft + (axisRight - axisLeft) * u;
        // slight per-particle wobble so they don't sit on a perfect grid
        const wobX = (hash01(i + 3) - 0.5) * 4;
        let x = x0 + wobX;
        // particle y target — under-wave at m=1, on-wave smeared earlier
        const waveY = axisY + Math.sin(x * baseFreq + wavePhase) * waveAmp + rippleBump(x);
        // smear arc length — long when m is low, ~0 when m is high
        const smearLen = (1 - m) * 36; // px arc half-length
        // jitter per particle
        const jitterY = (hash01(i + 7) - 0.5) * 6;
        let py = waveY + jitterY;
        // jiggle: brief sinusoidal offset after tap
        const jStart = duaState.current.jiggles.get(i);
        if (jStart !== undefined) {
          const jAge = (now - jStart) / 1000;
          if (jAge < 0.6) {
            const env = Math.max(0, 1 - jAge / 0.6);
            const f = 22; // Hz
            x += Math.sin(jAge * f * Math.PI * 2) * 3 * env;
            py += Math.cos(jAge * f * Math.PI * 2 + 0.7) * 3 * env;
          }
        }

        const aBase = particleAlphaBase;
        const dotR = 2.2 + (1 - m) * 1.0;

        if (smearLen > 1.5) {
          // smear: draw an arc that traces the tangent of the wave
          // tangent direction at x:
          // d/dx sin(x*f + p) = f * cos(x*f + p), so dy/dx = waveAmp*baseFreq*cos
          const tx = 1;
          const ty = waveAmp * baseFreq * Math.cos(x * baseFreq + wavePhase);
          const tn = Math.hypot(tx, ty);
          const ux = tx / tn;
          const uy = ty / tn;
          const x1 = x - ux * smearLen;
          const y1 = py - uy * smearLen;
          const x2 = x + ux * smearLen;
          const y2 = py + uy * smearLen;
          const grad = ctx.createLinearGradient(x1, y1, x2, y2);
          grad.addColorStop(0, `rgba(170, 230, 255, 0)`);
          grad.addColorStop(0.5, `rgba(210, 240, 255, ${0.65 * aBase})`);
          grad.addColorStop(1, `rgba(170, 230, 255, 0)`);
          ctx.strokeStyle = grad;
          ctx.lineWidth = 2.2;
          ctx.lineCap = "round";
          ctx.shadowColor = `rgba(170, 230, 255, ${0.4 * aBase})`;
          ctx.shadowBlur = motion ? 6 : 0;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          ctx.shadowBlur = 0;
        } else {
          // pure particle dot with glow
          ctx.fillStyle = `rgba(170, 230, 255, ${0.20 * aBase})`;
          ctx.beginPath();
          ctx.arc(x, py, dotR + 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = `rgba(220, 245, 255, ${0.95 * aBase})`;
          ctx.beginPath();
          ctx.arc(x, py, dotR, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ── dial in the centre ───────────────────────────────────────
      const dialCx = w * 0.5;
      const dialCy = axisY;
      const dialR = 28;

      // dial backdrop
      ctx.fillStyle = "rgba(10, 16, 32, 0.85)";
      ctx.beginPath();
      ctx.arc(dialCx, dialCy, dialR + 4, 0, Math.PI * 2);
      ctx.fill();
      // ring
      ctx.strokeStyle = "rgba(232, 226, 213, 0.55)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(dialCx, dialCy, dialR, 0, Math.PI * 2);
      ctx.stroke();

      // dial pointer — angle goes left (wave) to right (particle)
      // m=0 → angle = π (pointing left), m=1 → angle = 0 (pointing right)
      const dialAngle = Math.PI * (1 - m);
      const px = dialCx + Math.cos(dialAngle) * (dialR - 6);
      const py2 = dialCy + Math.sin(dialAngle) * (dialR - 6);
      ctx.strokeStyle = "rgba(255, 248, 232, 0.92)";
      ctx.lineWidth = 1.6;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(dialCx, dialCy);
      ctx.lineTo(px, py2);
      ctx.stroke();

      // little glyph dots on the dial — left "wave" right "particle"
      // a tiny sine for wave on the left
      ctx.strokeStyle = "rgba(120, 220, 255, 0.7)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      const leftX = dialCx - dialR - 24;
      for (let i = 0; i <= 16; i++) {
        const u = i / 16;
        const lx = leftX + u * 18;
        const ly = dialCy + Math.sin(u * Math.PI * 2) * 4;
        if (i === 0) ctx.moveTo(lx, ly);
        else ctx.lineTo(lx, ly);
      }
      ctx.stroke();
      // three dots for particle on the right
      ctx.fillStyle = "rgba(220, 245, 255, 0.85)";
      for (let i = 0; i < 3; i++) {
        const rx = dialCx + dialR + 8 + i * 7;
        ctx.beginPath();
        ctx.arc(rx, dialCy, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── touch-target ring — eight discoverable hit dots around the
      // dial so the surface reads as touchable. Tapping any of these
      // snaps m to the corresponding angular position. We paint a
      // soft outer ring + dots; the actual hit-test math lives in the
      // pointerdown handler.
      const touchR = dialR + 18;
      const TOUCH_DOT_COUNT = 8;
      for (let i = 0; i < TOUCH_DOT_COUNT; i++) {
        // distribute across the bottom semicircle so the dots feel
        // tied to the [wave ←→ particle] axis rather than orbiting
        // the dial freely. angle goes from π (left) to 2π (right).
        const a = Math.PI + (i / (TOUCH_DOT_COUNT - 1)) * Math.PI;
        const tx = dialCx + Math.cos(a) * touchR;
        const ty = dialCy + Math.sin(a) * touchR;
        // active indicator — the dot closest to current m is brighter
        const dotM = i / (TOUCH_DOT_COUNT - 1);
        const near = 1 - Math.min(1, Math.abs(dotM - m) * 3.0);
        ctx.fillStyle = `rgba(232, 226, 213, ${0.35 + near * 0.55})`;
        ctx.beginPath();
        ctx.arc(tx, ty, 3.2 + near * 1.4, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── readout label, debounced to 5 Hz ─────────────────────────
      if (now - lastReadoutAt > 200) {
        const wavePct = Math.round((1 - m) * 100);
        const partPct = 100 - wavePct;
        setReadout({ wave: wavePct, particle: partPct });
        lastReadoutAt = now;
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [getAudio]);

  // ─────────────────────────────────────────────────────────────────
  // Zone 4 — Standing-wave Interference
  // ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const wrap = interferenceWrapRef.current;
    const canvas = interferenceCanvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // wave parameters
    const k = 0.045;          // wavenumber (radians per CSS px)
    const omega = 2.2;        // angular frequency (rad/s)
    const CELL = 12;          // heatmap grid cell size (CSS px)

    // helper: at a tap, return the source index whose center is within
    // pickRadius, or -1 if none.
    const sourceAt = (px: number, py: number, w: number, h: number) => {
      const sources = interferenceState.current.sources;
      for (let i = 0; i < sources.length; i++) {
        const sx = sources[i].nx * w;
        const sy = sources[i].ny * h;
        if (Math.hypot(px - sx, py - sy) < 28) return i;
      }
      return -1;
    };

    const playSourceChime = () => {
      try {
        const a = getAudio();
        const ctx0 = a.getAudioContext();
        if (!ctx0) return;
        if (ctx0.state === "suspended") { try { void ctx0.resume(); } catch { /* noop */ } }
        const t = ctx0.currentTime;
        // a pair of partials — a quick "ting" with bell-like decay
        const osc1 = ctx0.createOscillator();
        const osc2 = ctx0.createOscillator();
        osc1.type = "sine";
        osc2.type = "sine";
        osc1.frequency.setValueAtTime(880, t);
        osc2.frequency.setValueAtTime(1320, t);
        const g = ctx0.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.10, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
        osc1.connect(g);
        osc2.connect(g);
        g.connect(ctx0.destination);
        osc1.start(t); osc2.start(t);
        osc1.stop(t + 0.6); osc2.stop(t + 0.6);
      } catch { /* noop */ }
    };

    const onDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const w = rect.width;
      const h = rect.height;
      const st = interferenceState.current;
      const idx = sourceAt(px, py, w, h);
      if (idx >= 0) {
        // start drag on existing source
        st.dragIdx = idx;
        st.grabDx = px - st.sources[idx].nx * w;
        st.grabDy = py - st.sources[idx].ny * h;
        playSourceChime();
        canvas.setPointerCapture?.(e.pointerId);
        return;
      }
      // empty tap — add a third source if under cap
      if (st.sources.length < 3) {
        st.sources.push({ nx: px / w, ny: py / h });
        setInterferenceCount(st.sources.length);
        playSourceChime();
        recordTapeRef.current("sigil", 0.6, "plasma/interference");
      }
    };
    const onMove = (e: PointerEvent) => {
      const st = interferenceState.current;
      if (st.dragIdx < 0) return;
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const nx = (px - st.grabDx) / w;
      const ny = (py - st.grabDy) / h;
      st.sources[st.dragIdx] = {
        nx: Math.max(0.04, Math.min(0.96, nx)),
        ny: Math.max(0.06, Math.min(0.94, ny)),
      };
    };
    const onUp = (e: PointerEvent) => {
      interferenceState.current.dragIdx = -1;
      try { canvas.releasePointerCapture?.(e.pointerId); } catch { /* noop */ }
    };
    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    // amplitude → color ramp: deep blue → cyan → amber → white
    // Output a CSS-style rgb tuple.
    const sampleRamp = (v: number): [number, number, number] => {
      // v in [-1, 1] is the normalized amplitude
      // map to [0, 1] for the ramp
      const u = (v + 1) * 0.5;
      // four-stop ramp
      const stops: Array<{ at: number; c: [number, number, number] }> = [
        { at: 0.00, c: [6,  10,  46]   }, // deep blue (trough)
        { at: 0.35, c: [40, 110, 200] }, // mid blue
        { at: 0.55, c: [80, 220, 230] }, // cyan
        { at: 0.78, c: [255, 178, 70] }, // amber
        { at: 1.00, c: [255, 250, 240]}, // white (peak)
      ];
      for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i]; const b = stops[i + 1];
        if (u <= b.at) {
          const t = (u - a.at) / Math.max(1e-6, b.at - a.at);
          return [
            a.c[0] + (b.c[0] - a.c[0]) * t,
            a.c[1] + (b.c[1] - a.c[1]) * t,
            a.c[2] + (b.c[2] - a.c[2]) * t,
          ];
        }
      }
      return stops[stops.length - 1].c;
    };

    const t0 = performance.now();
    let raf = 0;

    const draw = (now: number) => {
      const t = reduce ? 0 : (now - t0) / 1000;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w <= 0 || h <= 0) {
        raf = requestAnimationFrame(draw);
        return;
      }
      // black backdrop (the page is dark; we paint the field opaque)
      ctx.fillStyle = "rgba(2, 4, 22, 1)";
      ctx.fillRect(0, 0, w, h);

      const sources = interferenceState.current.sources;
      const phase = -t * omega;

      // walk the grid; sum sin(k*r + phase) over sources
      const cols = Math.ceil(w / CELL);
      const rows = Math.ceil(h / CELL);
      for (let yy = 0; yy < rows; yy++) {
        for (let xx = 0; xx < cols; xx++) {
          const cx = xx * CELL + CELL * 0.5;
          const cy = yy * CELL + CELL * 0.5;
          let amp = 0;
          for (let i = 0; i < sources.length; i++) {
            const sx = sources[i].nx * w;
            const sy = sources[i].ny * h;
            const r = Math.hypot(cx - sx, cy - sy);
            // distance attenuation so far cells don't dominate. Mild.
            const att = 1 / Math.sqrt(1 + r * 0.012);
            amp += Math.sin(r * k + phase) * att;
          }
          // normalize approximately: max amplitude is ~sources.length
          const norm = sources.length > 0 ? amp / sources.length : 0;
          const [r0, g0, b0] = sampleRamp(Math.max(-1, Math.min(1, norm)));
          ctx.fillStyle = `rgb(${r0 | 0}, ${g0 | 0}, ${b0 | 0})`;
          ctx.fillRect(xx * CELL, yy * CELL, CELL + 1, CELL + 1);
        }
      }

      // sources — small bright crosshairs so they read as draggable handles
      for (let i = 0; i < sources.length; i++) {
        const sx = sources[i].nx * w;
        const sy = sources[i].ny * h;
        // halo
        const halo = ctx.createRadialGradient(sx, sy, 0, sx, sy, 32);
        halo.addColorStop(0, "rgba(255, 250, 230, 0.55)");
        halo.addColorStop(1, "rgba(255, 250, 230, 0)");
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(sx, sy, 32, 0, Math.PI * 2);
        ctx.fill();
        // core
        ctx.fillStyle = "rgba(255, 252, 245, 0.95)";
        ctx.beginPath();
        ctx.arc(sx, sy, 6, 0, Math.PI * 2);
        ctx.fill();
        // ring (touch-target hint, 44px diameter)
        ctx.strokeStyle = "rgba(255, 250, 230, 0.45)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, 22, 0, Math.PI * 2);
        ctx.stroke();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [getAudio]);

  // ─────────────────────────────────────────────────────────────────
  // Zone 5 — Light Through Media (refraction)
  // ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const wrap = refractionWrapRef.current;
    const canvas = refractionCanvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const playBoundaryThud = () => {
      try { getAudio().thud(); } catch { /* noop */ }
    };

    // hit-test the two boundaries
    const boundaryAt = (px: number, w: number): 0 | 1 | -1 => {
      const st = refractionState.current;
      const b1x = st.b1 * w;
      const b2x = st.b2 * w;
      if (Math.abs(px - b1x) < 22) return 0;
      if (Math.abs(px - b2x) < 22) return 1;
      return -1;
    };
    const onDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const w = rect.width;
      const idx = boundaryAt(px, w);
      if (idx >= 0) {
        refractionState.current.dragB = idx;
        playBoundaryThud();
        canvas.setPointerCapture?.(e.pointerId);
      }
    };
    const onMove = (e: PointerEvent) => {
      const st = refractionState.current;
      if (st.dragB < 0) return;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const w = rect.width;
      if (w <= 0) return;
      const nx = Math.max(0.06, Math.min(0.94, px / w));
      if (st.dragB === 0) {
        // ensure b1 < b2 - 0.05
        st.b1 = Math.min(nx, st.b2 - 0.06);
      } else if (st.dragB === 1) {
        st.b2 = Math.max(nx, st.b1 + 0.06);
      }
      // rate-limit the thud so it isn't a buzz during the drag
      const now = performance.now();
      if (now - st.lastThudAt > 280) {
        playBoundaryThud();
        st.lastThudAt = now;
        recordTapeRef.current("object", 0.5, "plasma/refraction");
      }
    };
    const onUp = (e: PointerEvent) => {
      refractionState.current.dragB = -1;
      try { canvas.releasePointerCapture?.(e.pointerId); } catch { /* noop */ }
    };
    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    // ROYGBIV palette for sub-rays (each at a slightly different n offset
    // to fake chromatic dispersion). w is wavelength-weight 0..1.
    const SUBRAYS: Array<{ hue: string; w: number }> = [
      { hue: "rgba(255, 92,  92,  ALPHA)", w: 0.00 },
      { hue: "rgba(255, 158, 64,  ALPHA)", w: 0.16 },
      { hue: "rgba(255, 224, 110, ALPHA)", w: 0.32 },
      { hue: "rgba(120, 220, 140, ALPHA)", w: 0.50 },
      { hue: "rgba(96,  168, 240, ALPHA)", w: 0.68 },
      { hue: "rgba(120, 110, 220, ALPHA)", w: 0.84 },
      { hue: "rgba(180, 110, 230, ALPHA)", w: 1.00 },
    ];

    const t0 = performance.now();
    let raf = 0;

    const draw = (now: number) => {
      const t = reduce ? 0 : (now - t0) / 1000;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w <= 0 || h <= 0) {
        raf = requestAnimationFrame(draw);
        return;
      }
      ctx.clearRect(0, 0, w, h);

      const st = refractionState.current;
      const b1x = st.b1 * w;
      const b2x = st.b2 * w;
      // region bounds: [0, b1x], [b1x, b2x], [b2x, w]
      // refractive indices (we render the *middle* and *third* as denser
      // glass — see refractionState defaults).
      // air is implicitly 1.00; we treat the leftmost region as air-like.
      // ── paint media as faint tinted bands ─────────────────────────
      const mediaFill = [
        "rgba(8, 14, 36, 0.0)",      // air-ish (no fill)
        "rgba(80, 120, 200, 0.10)",  // glass
        "rgba(140, 110, 200, 0.12)", // denser glass
      ];
      const xs = [0, b1x, b2x, w];
      for (let i = 0; i < 3; i++) {
        const x0 = xs[i];
        const x1 = xs[i + 1];
        ctx.fillStyle = mediaFill[i];
        ctx.fillRect(x0, 0, x1 - x0, h);
        // label index n in subdued mono
        if (x1 - x0 > 40) {
          ctx.font = "10px var(--font-mono), ui-monospace, monospace";
          ctx.fillStyle = "rgba(232, 226, 213, 0.45)";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillText(`n = ${st.n[i].toFixed(2)}`, (x0 + x1) / 2, 10);
        }
      }

      // ── boundary lines (draggable) ────────────────────────────────
      const drawBoundary = (x: number, isActive: boolean) => {
        // grab handle visual: a dashed vertical line + two small caps
        ctx.strokeStyle = isActive
          ? "rgba(255, 252, 245, 0.85)"
          : "rgba(232, 226, 213, 0.45)";
        ctx.lineWidth = isActive ? 2.0 : 1.4;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(x, 4);
        ctx.lineTo(x, h - 4);
        ctx.stroke();
        ctx.setLineDash([]);
        // cap dots
        ctx.fillStyle = isActive ? "rgba(255, 252, 245, 0.95)" : "rgba(232, 226, 213, 0.7)";
        for (const yy of [10, h - 10]) {
          ctx.beginPath();
          ctx.arc(x, yy, 4, 0, Math.PI * 2);
          ctx.fill();
        }
        // mid-grip — a 44px-tall touchable cue
        const midY = h * 0.5;
        ctx.fillStyle = isActive ? "rgba(255, 252, 245, 0.9)" : "rgba(232, 226, 213, 0.55)";
        ctx.fillRect(x - 1.5, midY - 22, 3, 44);
      };
      const ent = refractionState.current.dragB;
      drawBoundary(b1x, ent === 0);
      drawBoundary(b2x, ent === 1);

      // ── trace each of the 7 sub-rays through the 3 media ─────────
      // Snell's law: n1 sin θ1 = n2 sin θ2.  We compute θ at each
      // boundary by treating the ray as a vector and decomposing it
      // against the boundary normal (which is the +x axis since
      // boundaries are vertical).
      // For chromatic dispersion we shift each sub-ray's n by a tiny
      // wavelength-dependent delta (Cauchy's relation, simplified).
      const entryX = 0;
      const entryY = st.entryY * h;
      // we draw lazily-animated phase so even with a static beam it
      // reads as living. (Frozen under prefers-reduced-motion.)
      const phaseSeed = t * 0.6;

      for (let s = 0; s < SUBRAYS.length; s++) {
        const sub = SUBRAYS[s];
        // per-sub-ray refractive index offset — small, but visible.
        // shorter wavelengths bend more.
        const dn = (sub.w - 0.5) * 0.18;
        const nVals = [st.n[0], st.n[1] + dn, st.n[2] + dn * 0.7];

        // start travelling horizontally (incident angle 0 from normal)
        let x = entryX;
        let y = entryY + (sub.w - 0.5) * 0.6; // tiny vertical separation so the spectrum reads
        // initial direction (unit vector). +x.
        let dx = 1;
        let dy = 0;
        // tiny sinusoidal vertical wobble for "wave-like" feel
        const wobble = Math.sin(phaseSeed + sub.w * 6) * 0.02;
        dy += wobble;
        // re-normalize
        {
          const n0 = Math.hypot(dx, dy);
          dx /= n0; dy /= n0;
        }
        // The beam runs through three media. Boundaries are at b1x and b2x.
        // At each boundary, refract using Snell's law (normal is +x).
        const points: Array<{ x: number; y: number }> = [{ x, y }];

        // helper: advance from current (x,y) along (dx,dy) until hitting
        // x === xBoundary (assuming dx > 0). Updates x, y, returns true on hit.
        const advanceTo = (xBoundary: number): boolean => {
          if (dx <= 0) return false; // shouldn't happen — we never refract backwards
          const dt = (xBoundary - x) / dx;
          x = xBoundary;
          y = y + dy * dt;
          points.push({ x, y });
          return true;
        };

        // refract — given incoming (dx,dy) and the ratio n1/n2, update.
        // boundary normal is +x; we use cos θ = dx, sin θ = dy
        // (since the beam direction is the unit vector).
        const refract = (n1: number, n2: number) => {
          const ratio = n1 / n2;
          const cosI = dx;
          const sinI = dy;
          // sin θ2 = (n1/n2) sin θ1
          let sinT = ratio * sinI;
          // clamp — beyond critical angle the ray would TIR; here we
          // just clamp so the simulation keeps moving forward.
          if (sinT > 0.95) sinT = 0.95;
          if (sinT < -0.95) sinT = -0.95;
          const cosT = Math.sqrt(Math.max(0, 1 - sinT * sinT));
          dx = cosT;
          dy = sinT;
          // re-normalize defensively
          const nrm = Math.hypot(dx, dy);
          if (nrm > 0) { dx /= nrm; dy /= nrm; }
          void cosI;
        };

        // air → medium 1 (boundary at b1x)
        advanceTo(b1x);
        refract(nVals[0], nVals[1]);
        // medium 1 → medium 2 (boundary at b2x)
        advanceTo(b2x);
        refract(nVals[1], nVals[2]);
        // medium 2 → exit (right edge)
        advanceTo(w);

        // ── render this ray as a glow + thin core polyline ─────────
        const alphaCore = 0.85;
        const alphaGlow = 0.45;

        // glow
        ctx.strokeStyle = sub.hue.replace("ALPHA", alphaGlow.toFixed(3));
        ctx.lineWidth = 5;
        ctx.lineCap = "round";
        ctx.shadowColor = sub.hue.replace("ALPHA", alphaGlow.toFixed(3));
        ctx.shadowBlur = 10;
        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
          const p = points[i];
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // core
        ctx.strokeStyle = sub.hue.replace("ALPHA", alphaCore.toFixed(3));
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
          const p = points[i];
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }

      // entry marker — a faint white square at the left edge that
      // reinforces "beam in here". Drawn last so it sits on top.
      ctx.fillStyle = "rgba(255, 252, 245, 0.55)";
      ctx.fillRect(0, entryY - 1.5, 6, 3);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [getAudio]);

  // ─────────────────────────────────────────────────────────────────
  // Zone 6 — Metal Mirror (chromatic-aberration reflection)
  // ─────────────────────────────────────────────────────────────────
  //
  // A brushed-steel surface sits at the bottom-third of its own zone.
  // The dispersed rays from Zone 2 are mirrored across the surface; the
  // mirrored versions are rendered with a chromatic-aberration effect
  // (RGB channels separated by a small offset) to evoke a camera lens
  // flare bouncing off metal.
  //
  // Two interactions:
  //   - dragging the surface CENTRE → translates it vertically
  //   - dragging near either END   → rotates it
  // Both interactions reuse the same canvas pointer events and pick
  // the mode based on hit position.
  useEffect(() => {
    const wrap = metalWrapRef.current;
    const canvas = metalCanvasRef.current;
    const glassCanvas = metalGlassRef.current;
    if (!wrap || !canvas || !glassCanvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ── WebGL brushed-steel shader ─────────────────────────────────
    const gl =
      (glassCanvas.getContext("webgl", { antialias: false, premultipliedAlpha: false }) ||
        glassCanvas.getContext(
          "experimental-webgl" as "webgl",
          { antialias: false, premultipliedAlpha: false } as WebGLContextAttributes,
        )) as WebGLRenderingContext | null;
    let glProg: WebGLProgram | null = null;
    let uTime: WebGLUniformLocation | null = null;
    let uRes: WebGLUniformLocation | null = null;
    let uTilt: WebGLUniformLocation | null = null;
    let uSurfY: WebGLUniformLocation | null = null;
    let uReduced: WebGLUniformLocation | null = null;
    if (gl) {
      const vert = `
        attribute vec2 a_pos;
        varying vec2 vUv;
        void main() {
          vUv = a_pos * 0.5 + 0.5;
          gl_Position = vec4(a_pos, 0.0, 1.0);
        }
      `;
      // Brushed-steel + soft background. Same 4-octave FBM cap.
      const frag = `
        precision mediump float;
        uniform float uTime;
        uniform vec2  uRes;
        uniform float uTilt;     // radians
        uniform float uSurfY;    // 0..1 surface centre y
        uniform float uReduced;
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
          for (int i = 0; i < 4; i++) {
            v += a * vnoise(p);
            p *= 2.07;
            a *= 0.52;
          }
          return v;
        }

        void main() {
          vec2 uv = vUv;
          // background — deep gradient that mirrors the page
          vec3 bg = mix(
            vec3(0.020, 0.020, 0.078),
            vec3(0.035, 0.060, 0.150),
            uv.y
          );

          // ── compute distance from the surface line (in css px space) ──
          // surface centre + tilt define a line; we render anything within
          // ~30px of the line as the metal strip.
          float cy = (1.0 - uSurfY) * uRes.y;
          float cx = uRes.x * 0.5;
          vec2 p = vec2(uv.x * uRes.x, (1.0 - uv.y) * uRes.y);
          vec2 dir = vec2(cos(uTilt), sin(uTilt));
          vec2 nor = vec2(-dir.y, dir.x);
          vec2 d2 = p - vec2(cx, cy);
          float along = dot(d2, dir);
          float across = dot(d2, nor);

          float strip = smoothstep(60.0, 38.0, abs(across));
          // limit horizontal extent (strip length ~ 70% of width)
          float halfLen = uRes.x * 0.42;
          strip *= smoothstep(halfLen + 14.0, halfLen - 4.0, abs(along));
          if (strip < 0.001) {
            gl_FragColor = vec4(bg, 1.0);
            return;
          }

          // ── brushed-steel pattern: streaks along surface direction ──
          // We sample noise heavily anisotropic so the grain reads as
          // brushed (long thin lines parallel to the surface).
          float time = (uReduced > 0.5) ? 0.0 : uTime * 0.15;
          vec2 stretchedUv = vec2(along * 0.04, across * 0.55) + vec2(time, 0.0);
          float n = fbm(stretchedUv);
          float n2 = fbm(stretchedUv * 2.1 + vec2(7.0));
          float grain = n * 0.7 + n2 * 0.5;
          // base steel
          vec3 steel = mix(vec3(0.22, 0.24, 0.30), vec3(0.78, 0.82, 0.88), grain);
          // a high specular streak near the surface line
          float specBand = exp(-(across * across) / 220.0);
          steel = mix(steel, vec3(1.0, 0.98, 0.94), specBand * 0.45);
          // edge darkening so the strip reads as a thin object
          float edge = smoothstep(60.0, 30.0, abs(across));
          steel = mix(bg, steel, edge);
          // small bevel on the very top/bottom of the strip
          float bevel = smoothstep(28.0, 22.0, abs(across));
          steel = mix(steel, steel * 1.18, bevel);

          gl_FragColor = vec4(mix(bg, steel, strip), 1.0);
        }
      `;
      const compile = (type: number, src: string) => {
        const s = gl.createShader(type);
        if (!s) return null;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          console.warn("Metal shader compile failed", gl.getShaderInfoLog(s));
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
            uTime = gl.getUniformLocation(p, "uTime");
            uRes = gl.getUniformLocation(p, "uRes");
            uTilt = gl.getUniformLocation(p, "uTilt");
            uSurfY = gl.getUniformLocation(p, "uSurfY");
            uReduced = gl.getUniformLocation(p, "uReduced");
            const buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(
              gl.ARRAY_BUFFER,
              new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
              gl.STATIC_DRAW,
            );
            const aPos = gl.getAttribLocation(p, "a_pos");
            gl.enableVertexAttribArray(aPos);
            gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
            gl.useProgram(p);
          }
        }
      }
    }

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      glassCanvas.width = Math.max(1, Math.floor(w * dpr));
      glassCanvas.height = Math.max(1, Math.floor(h * dpr));
      if (gl) gl.viewport(0, 0, glassCanvas.width, glassCanvas.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // ── pointer interaction ────────────────────────────────────────
    // The surface itself is a line. We test how far the pointer is from
    // the line; near the ends → rotate; near the middle → move.
    const onDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const w = rect.width;
      const h = rect.height;
      const st = metalState.current;
      const cy = st.centerY * h;
      const cx = w * 0.5;
      const dir = { x: Math.cos(st.tilt), y: Math.sin(st.tilt) };
      const nor = { x: -dir.y, y: dir.x };
      const dx = px - cx;
      const dy = py - cy;
      const along = dx * dir.x + dy * dir.y;
      const across = dx * nor.x + dy * nor.y;
      const halfLen = w * 0.42;
      if (Math.abs(across) > 60) return; // outside the strip — ignore
      if (Math.abs(along) > halfLen + 30) return;
      st.dragMode = Math.abs(along) > halfLen * 0.65 ? "rot" : "move";
      st.grabCenterY = st.centerY;
      st.grabTilt = st.tilt;
      st.grabPX = px;
      st.grabPY = py;
      try { getAudio().thud(); } catch { /* noop */ }
      canvas.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const st = metalState.current;
      if (!st.dragMode) return;
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      if (st.dragMode === "move") {
        const dy = (py - st.grabPY) / h;
        st.centerY = Math.max(0.30, Math.min(0.90, st.grabCenterY + dy));
      } else if (st.dragMode === "rot") {
        // rotation: relative angle change about canvas centre
        const cx = w * 0.5;
        const cy = st.grabCenterY * h;
        const a0 = Math.atan2(st.grabPY - cy, st.grabPX - cx);
        const a1 = Math.atan2(py - cy, px - cx);
        let d = a1 - a0;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        let t = st.grabTilt + d;
        if (t > 0.6) t = 0.6;
        if (t < -0.6) t = -0.6;
        st.tilt = t;
      }
      const now = performance.now();
      if (now - st.lastThudAt > 320) {
        try { getAudio().thud(); } catch { /* noop */ }
        st.lastThudAt = now;
      }
    };
    const onUp = (e: PointerEvent) => {
      const st = metalState.current;
      if (st.dragMode) {
        recordTapeRef.current("object", 0.5, "plasma/metal");
      }
      st.dragMode = null;
      try { canvas.releasePointerCapture?.(e.pointerId); } catch { /* noop */ }
    };
    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    const t0 = performance.now();
    let raf = 0;

    // helper: reflect a 2D vector around a normal
    const reflectVec = (vx: number, vy: number, nx: number, ny: number) => {
      const dot = vx * nx + vy * ny;
      return { x: vx - 2 * dot * nx, y: vy - 2 * dot * ny };
    };

    // helper: line-segment vs surface-line intersection. Returns the
    // parameter along the ray (0..1) when an intersection exists, else null.
    const intersectSegLine = (
      sx: number, sy: number, ex: number, ey: number,
      cx: number, cy: number, dirX: number, dirY: number, halfLen: number,
    ): { hx: number; hy: number; t: number } | null => {
      // surface as L(s) = (cx,cy) + s*(dirX,dirY) for s in [-halfLen, halfLen]
      // ray as R(t) = (sx,sy) + t*((ex,ey) - (sx,sy)) for t in [0,1]
      const rdx = ex - sx;
      const rdy = ey - sy;
      // solve: sx + t*rdx = cx + s*dirX
      //        sy + t*rdy = cy + s*dirY
      // => [rdx -dirX; rdy -dirY] [t;s] = [cx-sx; cy-sy]
      const a = rdx;
      const b = -dirX;
      const c = rdy;
      const d = -dirY;
      const det = a * d - b * c;
      if (Math.abs(det) < 1e-6) return null;
      const rx = cx - sx;
      const ry = cy - sy;
      const t = (rx * d - b * ry) / det;
      const s = (a * ry - rx * c) / det;
      if (t < 0 || t > 1) return null;
      if (s < -halfLen || s > halfLen) return null;
      return { hx: sx + rdx * t, hy: sy + rdy * t, t };
    };

    const draw = (now: number) => {
      const t = (now - t0) / 1000;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w <= 0 || h <= 0) {
        raf = requestAnimationFrame(draw);
        return;
      }

      const st = metalState.current;

      // ── WebGL background pass ────────────────────────────────────
      if (gl && glProg) {
        gl.useProgram(glProg);
        if (uTime) gl.uniform1f(uTime, t);
        if (uRes) gl.uniform2f(uRes, w, h);
        if (uTilt) gl.uniform1f(uTilt, st.tilt);
        if (uSurfY) gl.uniform1f(uSurfY, 1 - st.centerY); // shader expects 0=bottom
        if (uReduced) gl.uniform1f(uReduced, reduce ? 1 : 0);
        gl.clearColor(0.012, 0.016, 0.078, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } else {
        // 2D fallback gradient
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, "#02041a");
        grad.addColorStop(1, "#080f26");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }

      // ── 2D pass: incoming rays (small preview) + reflections ─────
      ctx.clearRect(0, 0, w, h);

      // pull live rays from Zone 2 (set every frame).
      const rays = (window as unknown as { __plasmaRays?: Array<{
        x0: number; y0: number; x1: number; y1: number;
        r: number; g: number; b: number; bMul: number;
      }> }).__plasmaRays;
      const exit = (window as unknown as { __plasmaExit?: { x: number; y: number; spin: number; tilt: number } }).__plasmaExit;

      // Translate the prism's coordinate frame into this canvas. Zone 2
      // lives on a different surface — we DON'T actually share pixel
      // coords. Instead we re-create a "virtual exit point" near the top
      // of this canvas and re-derive ray directions from the spin so the
      // reflection geometry stays believable.
      const virtExitX = w * 0.20;
      const virtExitY = h * 0.20;
      const baseSpread = 0.55;
      const spin = exit?.spin ?? 0;
      const tiltAngle = spin * 1.4;

      // surface line params
      const cy = st.centerY * h;
      const cx = w * 0.5;
      const dirX = Math.cos(st.tilt);
      const dirY = Math.sin(st.tilt);
      const norX = -dirY;
      const norY = dirX;
      const halfLen = w * 0.42;

      const RAY_SPECS_LOCAL = [0.00, 0.16, 0.32, 0.50, 0.68, 0.84, 1.00];

      // colour fallback if Zone 2 hasn't published rays yet (e.g. first
      // frame): use a generic ROYGBIV.
      const FALLBACK_HUES: Array<[number, number, number]> = [
        [255, 92, 92],
        [255, 158, 64],
        [255, 224, 110],
        [120, 220, 140],
        [96, 168, 240],
        [120, 110, 220],
        [180, 110, 230],
      ];

      // draw a small "incoming ray bundle" from the upper-left + reflections
      for (let i = 0; i < RAY_SPECS_LOCAL.length; i++) {
        const wlen = RAY_SPECS_LOCAL[i];
        const ang = tiltAngle + (wlen - 0.5) * baseSpread + 0.35; // angled toward the surface
        const rayLen = Math.max(220, h * 0.9);
        const ex = virtExitX + Math.cos(ang) * rayLen;
        const ey = virtExitY + Math.sin(ang) * rayLen;

        const remote = rays?.[i];
        const rr = remote?.r ?? FALLBACK_HUES[i][0];
        const gg = remote?.g ?? FALLBACK_HUES[i][1];
        const bb = remote?.b ?? FALLBACK_HUES[i][2];
        const bMul = remote?.bMul ?? 1;

        // does this ray hit the surface?
        const hit = intersectSegLine(virtExitX, virtExitY, ex, ey, cx, cy, dirX, dirY, halfLen);

        // incident ray (from exit point to either hit or end)
        const endX = hit ? hit.hx : ex;
        const endY = hit ? hit.hy : ey;
        // incident — soft halo + thin core
        ctx.strokeStyle = `rgba(${rr}, ${gg}, ${bb}, ${(0.45 * bMul).toFixed(3)})`;
        ctx.lineWidth = 6 * Math.min(1.7, bMul);
        ctx.lineCap = "round";
        ctx.shadowColor = `rgba(${rr}, ${gg}, ${bb}, ${(0.45 * bMul).toFixed(3)})`;
        ctx.shadowBlur = 12 * Math.min(2.0, bMul);
        ctx.beginPath();
        ctx.moveTo(virtExitX, virtExitY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = `rgba(${rr}, ${gg}, ${bb}, ${(0.9 * bMul).toFixed(3)})`;
        ctx.lineWidth = 1.4 * Math.min(2.4, bMul);
        ctx.beginPath();
        ctx.moveTo(virtExitX, virtExitY);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        if (hit) {
          // reflection. The incident direction is (cos ang, sin ang). Reflect
          // about the surface normal (norX, norY).
          const ix = Math.cos(ang);
          const iy = Math.sin(ang);
          const r = reflectVec(ix, iy, norX, norY);
          const reflLen = Math.max(180, w - hit.hx - 20);
          const rx = hit.hx + r.x * reflLen;
          const ry = hit.hy + r.y * reflLen;

          // ── chromatic-aberration: paint three offset copies for the
          // R / G / B channels of this ray's color. The offset is
          // perpendicular to the reflected direction. ───────────────
          const perpX = -r.y;
          const perpY = r.x;
          const AB = 3.5; // px aberration distance
          const components: Array<{ r: number; g: number; b: number; ox: number; oy: number }> = [
            { r: rr, g: 0,  b: 0,  ox: -AB * perpX, oy: -AB * perpY },
            { r: 0,  g: gg, b: 0,  ox: 0,            oy: 0 },
            { r: 0,  g: 0,  b: bb, ox: AB * perpX,  oy: AB * perpY },
          ];
          // additive blend for the chromatic bands so they "stack" to
          // re-form the white-ish core where they overlap exactly, but
          // separate into RGB fringes at the edges.
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          for (const comp of components) {
            // halo
            ctx.strokeStyle = `rgba(${comp.r | 0}, ${comp.g | 0}, ${comp.b | 0}, ${(0.55 * bMul).toFixed(3)})`;
            ctx.lineWidth = 5 * Math.min(1.7, bMul);
            ctx.lineCap = "round";
            ctx.shadowColor = `rgba(${comp.r | 0}, ${comp.g | 0}, ${comp.b | 0}, ${(0.45 * bMul).toFixed(3)})`;
            ctx.shadowBlur = 14 * Math.min(2.0, bMul);
            ctx.beginPath();
            ctx.moveTo(hit.hx + comp.ox, hit.hy + comp.oy);
            ctx.lineTo(rx + comp.ox, ry + comp.oy);
            ctx.stroke();
            ctx.shadowBlur = 0;
            // core
            ctx.strokeStyle = `rgba(${comp.r | 0}, ${comp.g | 0}, ${comp.b | 0}, ${(0.95 * bMul).toFixed(3)})`;
            ctx.lineWidth = 1.4 * Math.min(2.4, bMul);
            ctx.beginPath();
            ctx.moveTo(hit.hx + comp.ox, hit.hy + comp.oy);
            ctx.lineTo(rx + comp.ox, ry + comp.oy);
            ctx.stroke();
          }
          ctx.restore();

          // tiny bright impact dot
          ctx.fillStyle = `rgba(255, 252, 245, ${(0.7 * bMul).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(hit.hx, hit.hy, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // surface outline — a thin highlight + drag affordances at the ends
      ctx.strokeStyle = "rgba(255, 252, 245, 0.55)";
      ctx.lineWidth = 1.4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cx - dirX * halfLen, cy - dirY * halfLen);
      ctx.lineTo(cx + dirX * halfLen, cy + dirY * halfLen);
      ctx.stroke();
      // end caps — bigger touch targets
      ctx.fillStyle = st.dragMode === "rot"
        ? "rgba(255, 252, 245, 0.95)" : "rgba(232, 226, 213, 0.7)";
      for (const sign of [-1, 1]) {
        const ex = cx + dirX * halfLen * sign;
        const ey = cy + dirY * halfLen * sign;
        ctx.beginPath();
        ctx.arc(ex, ey, 8, 0, Math.PI * 2);
        ctx.fill();
      }

      // entry-point marker for the virtual beam
      ctx.fillStyle = "rgba(255, 252, 245, 0.55)";
      ctx.beginPath();
      ctx.arc(virtExitX, virtExitY, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "10px var(--font-mono), ui-monospace, monospace";
      ctx.fillStyle = "rgba(232, 226, 213, 0.55)";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText("rays from prism", virtExitX + 8, virtExitY - 6);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (gl && glProg) {
        try { gl.deleteProgram(glProg); } catch { /* noop */ }
      }
    };
  }, [getAudio]);

  // ─────────────────────────────────────────────────────────────────
  // Layout
  // ─────────────────────────────────────────────────────────────────
  return (
    <div
      data-touch-surface="true"
      style={{
        position: "relative",
        minHeight: "calc(100vh - 56px)", // minus the sticky header
        paddingBottom: "calc(112px + env(safe-area-inset-bottom, 0px))",
        background:
          "linear-gradient(180deg, #020314 0%, #060823 28%, #08102a 62%, #0a1028 100%)",
        color: "rgba(232, 226, 213, 0.92)",
        overflowX: "hidden",
      }}
    >
      <div
        className="plasma-memory"
        data-plasma-memory="true"
        aria-live="polite"
        style={{
          position: "fixed",
          left: 18,
          bottom: "calc(112px + env(safe-area-inset-bottom, 0px))",
          zIndex: 4,
          display: "flex",
          alignItems: "center",
          gap: 8,
          maxWidth: "min(520px, calc(100vw - 150px))",
          padding: "8px 10px",
          border: "1px solid rgba(232, 226, 213, 0.16)",
          borderRadius: 6,
          background: "rgba(3, 6, 20, 0.62)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          color: "rgba(232, 226, 213, 0.68)",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: 0,
          textTransform: "lowercase",
          pointerEvents: "none",
        }}
      >
        {plasmaMarks.map((mark, index) => (
          <span
            key={`${mark.label}-${mark.t}-${index}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              minWidth: 0,
              opacity: index === 0 ? 1 : 0.46,
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

      {/* page title block */}
      <div
        style={{
          padding: "44px var(--pad-x, 24px) 18px",
          maxWidth: 1200,
          margin: "0 auto",
        }}
      >
        <div
          className="t-mono"
          style={{
            fontSize: 11,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "rgba(232, 226, 213, 0.5)",
            marginBottom: 14,
          }}
        >
          plasma / light
        </div>
        <WaterText
          as="h1"
          bobAmp={0}
          style={{
            display: "block",
            fontFamily: "var(--font-numerals)",
            fontWeight: 500,
            fontSize: "clamp(34px, 5.4vw, 64px)",
            lineHeight: 1.05,
            letterSpacing: "-0.018em",
            color: "rgba(244, 238, 222, 0.96)",
            margin: 0,
          }}
        >
          the body of light
        </WaterText>
        <WaterText
          as="div"
          bobAmp={2}
          style={{
            display: "block",
            marginTop: 10,
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontWeight: 300,
            fontSize: "clamp(16px, 2vw, 22px)",
            color: "rgba(232, 226, 213, 0.68)",
          }}
        >
          wave and particle, frequency and field
        </WaterText>
      </div>

      {/* ─── Zone 1: The Plasma Field ─────────────────────────────── */}
      <section
        style={{
          // each zone gets a full-screen rhythm on mobile so the
          // interaction has room and the user can scroll one
          // interaction at a time.
          minHeight: isMobile ? "92vh" : undefined,
          padding: "22px var(--pad-x, 24px) 36px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: isMobile ? "center" : undefined,
          gap: 18,
        }}
        aria-label="the plasma field"
      >
        <div
          ref={orbWrapRef}
          style={{
            position: "relative",
            width: isMobile ? "min(80vw, 420px)" : "min(70vw, 420px)",
            height: isMobile ? "min(80vw, 420px)" : "min(70vw, 420px)",
            cursor: "pointer",
            touchAction: "none",
            userSelect: "none",
            WebkitTouchCallout: "none",
            WebkitUserSelect: "none",
            // soft halo behind canvas; canvas paints over it cleanly
            background:
              "radial-gradient(circle at 50% 50%, rgba(255, 140, 80, 0.10) 0%, rgba(20, 30, 60, 0) 70%)",
          }}
        >
          <canvas
            ref={orbCanvasRef}
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              display: "block",
              pointerEvents: "none",
              userSelect: "none",
              WebkitUserSelect: "none",
              WebkitTouchCallout: "none",
            }}
          />
          {/* spark-trail overlay — paints small comets traveling toward
              the orb's center after outside-the-disc clicks */}
          <canvas
            ref={orbSparkRef}
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              display: "block",
              pointerEvents: "none",
              userSelect: "none",
              WebkitUserSelect: "none",
              WebkitTouchCallout: "none",
            }}
          />
        </div>
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontWeight: 300,
            fontSize: "clamp(15px, 1.6vw, 18px)",
            color: "rgba(232, 226, 213, 0.62)",
            textAlign: "center",
            minHeight: 44,
            display: "flex",
            alignItems: "center",
            touchAction: "manipulation",
          }}
        >
          {isMobile ? "tap anywhere to pulse" : "the field is alive"}
        </div>
        {/* color-shift toggle — cycles the orb through 5 palettes */}
        <button
          type="button"
          aria-label={`color shift — ${ORB_PALETTES[orbPalette].label}`}
          onClick={() => {
            const idx = PALETTE_ORDER.indexOf(orbPalette);
            const next = PALETTE_ORDER[(idx + 1) % PALETTE_ORDER.length];
            setOrbPalette(next);
            const palette = ORB_PALETTES[next];
            const tone = `rgb(${Math.round(palette.electric[0] * 255)}, ${Math.round(palette.electric[1] * 255)}, ${Math.round(palette.electric[2] * 255)})`;
            markPlasma(`color ${palette.label}`, tone);
            haptics.roll();
            recordTapeRef.current("sigil", 0.42, `plasma/color/${next}`);
            try { getAudio().chime(); } catch { /* noop */ }
          }}
          style={{
            minHeight: 44,
            padding: "10px 18px",
            border: "1px solid rgba(232, 226, 213, 0.35)",
            background: "rgba(232, 226, 213, 0.05)",
            color: "rgba(232, 226, 213, 0.85)",
            borderRadius: 22,
            fontFamily: "var(--font-mono), ui-monospace, monospace",
            fontSize: 11,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            cursor: "pointer",
            touchAction: "manipulation",
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: `rgb(${Math.round(ORB_PALETTES[orbPalette].candle[0] * 255)}, ${Math.round(ORB_PALETTES[orbPalette].candle[1] * 255)}, ${Math.round(ORB_PALETTES[orbPalette].candle[2] * 255)})`,
              boxShadow: `0 0 12px rgba(${Math.round(ORB_PALETTES[orbPalette].electric[0] * 255)}, ${Math.round(ORB_PALETTES[orbPalette].electric[1] * 255)}, ${Math.round(ORB_PALETTES[orbPalette].electric[2] * 255)}, 0.7)`,
            }}
          />
          color: {ORB_PALETTES[orbPalette].label}
        </button>
      </section>

      {/* divider */}
      <div
        style={{
          height: 1,
          background: "rgba(232, 226, 213, 0.08)",
          maxWidth: 1100,
          margin: "0 auto",
        }}
      />

      {/* ─── Zone 2: Prism Dispersion ─────────────────────────────── */}
      <section
        style={{
          minHeight: isMobile ? "92vh" : undefined,
          padding: "36px var(--pad-x, 24px) 36px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: isMobile ? "center" : undefined,
          gap: 14,
        }}
        aria-label="prism dispersion"
      >
        {/* prism row — hue picker on the left, prism in the middle. The
            two ring knobs (TILT + SPIN) and the Randomize button sit
            below. */}
        <div
          style={{
            display: "flex",
            alignItems: "stretch",
            justifyContent: "center",
            gap: 12,
            width: "min(100%, 1100px)",
          }}
        >
          {/* HUE PICKER — a vertical strip of 44px swatches that set the
              incoming beam color. The first swatch (white) is the default,
              full-spectrum behaviour; the rest pick a single hue and the
              dispersion produces seven shades of that hue. */}
          <div
            role="radiogroup"
            aria-label="incoming beam hue"
            style={{
              flex: "0 0 auto",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              padding: 6,
              borderRadius: 14,
              background: "rgba(232, 226, 213, 0.04)",
              border: "1px solid rgba(232, 226, 213, 0.10)",
            }}
          >
            {[
              { white: true, hue: 0, label: "white", color: "linear-gradient(180deg, #ff5c5c, #ff9e40, #ffe06e, #78dc8c, #60a8f0, #786ee0, #b46ee6)" },
              { white: false, hue: 0.00, label: "red",     color: "#ff5c5c" },
              { white: false, hue: 0.08, label: "orange",  color: "#ff9e40" },
              { white: false, hue: 0.16, label: "yellow",  color: "#ffe06e" },
              { white: false, hue: 0.32, label: "green",   color: "#78dc8c" },
              { white: false, hue: 0.48, label: "cyan",    color: "#60d8e6" },
              { white: false, hue: 0.62, label: "blue",    color: "#60a8f0" },
              { white: false, hue: 0.82, label: "violet",  color: "#b46ee6" },
            ].map((s) => {
              const active =
                (s.white && hueSelection.white) ||
                (!s.white && !hueSelection.white && Math.abs(s.hue - hueSelection.hue) < 0.01);
              return (
                <button
                  key={s.label}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={`beam color ${s.label}`}
                  onClick={() => {
                    setHueSelection({ hue: s.hue, white: s.white });
                    prismState.current.incomingHue = s.hue;
                    prismState.current.hueWhite = s.white;
                    markPlasma(`beam ${s.label}`, typeof s.color === "string" && s.color.startsWith("#") ? s.color : "#f4eedf");
                    haptics.ripple(0.35);
                    recordTapeRef.current("sigil", 0.32, `plasma/beam/${s.label}`);
                    try { getAudio().spark(); } catch { /* noop */ }
                  }}
                  style={{
                    width: 44,
                    height: 44,
                    minWidth: 44,
                    minHeight: 44,
                    borderRadius: 22,
                    border: active
                      ? "2px solid rgba(255, 252, 245, 0.95)"
                      : "1px solid rgba(232, 226, 213, 0.35)",
                    background: s.color,
                    cursor: "pointer",
                    touchAction: "manipulation",
                    padding: 0,
                    boxShadow: active
                      ? "0 0 12px rgba(255, 252, 245, 0.45)"
                      : "none",
                  }}
                />
              );
            })}
          </div>

          <div
            ref={prismWrapRef}
            style={{
              position: "relative",
              flex: "1 1 auto",
              height: isMobile ? "clamp(280px, 60vh, 460px)" : "clamp(220px, 36vw, 320px)",
              userSelect: "none",
              WebkitUserSelect: "none",
              WebkitTouchCallout: "none",
            }}
          >
            {/* iridescent WebGL glass layer (paints behind the 2D layer) */}
            <canvas
              ref={prismGlassCanvasRef}
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                display: "block",
                pointerEvents: "none",
                userSelect: "none",
                WebkitUserSelect: "none",
                WebkitTouchCallout: "none",
              }}
            />
            {/* 2D interaction layer — beam, rays, sparkles, outline */}
            <canvas
              ref={prismCanvasRef}
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                display: "block",
                cursor: "pointer",
                touchAction: "none",
                userSelect: "none",
                WebkitUserSelect: "none",
                WebkitTouchCallout: "none",
              }}
            />
          </div>
        </div>

        {/* ── knob row + randomize button ────────────────────────── */}
        <div
          style={{
            display: "flex",
            gap: 18,
            alignItems: "center",
            flexWrap: "wrap",
            justifyContent: "center",
            minHeight: 44,
            touchAction: "manipulation",
            marginTop: 6,
          }}
        >
          <PrismKnob
            ref={prismTiltKnobRef}
            label="tilt"
            value={(prismState.current.tilt - 0.5) * Math.PI}
            valueRange={[-Math.PI / 2, Math.PI / 2]}
          />
          <PrismKnob
            ref={prismSpinKnobRef}
            label="spin"
            value={prismState.current.spin}
            valueRange={[-Math.PI * 2, Math.PI * 2]}
          />
          <button
            type="button"
            aria-label="randomize prism orientation"
            onClick={() => {
              const wrap = prismWrapRef.current;
              if (!wrap) return;
              markPlasma("random prism", "#ffe06e");
              haptics.roll();
              wrap.dispatchEvent(new CustomEvent("plasma:prism-randomize"));
            }}
            style={{
              minHeight: 44,
              padding: "10px 18px",
              borderRadius: 22,
              border: "1px solid rgba(232, 226, 213, 0.35)",
              background: "rgba(232, 226, 213, 0.05)",
              color: "rgba(232, 226, 213, 0.85)",
              fontFamily: "var(--font-mono), ui-monospace, monospace",
              fontSize: 11,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              cursor: "pointer",
              touchAction: "manipulation",
            }}
          >
            randomize
          </button>
          {autoRotateUi ? (
            <span
              className="t-mono"
              aria-live="polite"
              style={{
                fontSize: 11,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "rgba(232, 226, 213, 0.72)",
                background: "rgba(232, 226, 213, 0.08)",
                padding: "6px 12px",
                borderRadius: 999,
                border: "1px solid rgba(232, 226, 213, 0.30)",
              }}
            >
              auto-rotate · tap prism to stop
            </span>
          ) : null}
        </div>
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
            justifyContent: "center",
            minHeight: 44,
            touchAction: "manipulation",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontWeight: 300,
              fontSize: "clamp(15px, 1.6vw, 18px)",
              color: "rgba(232, 226, 213, 0.62)",
            }}
          >
            white light is many lights
          </div>
          <div
            className="t-mono"
            style={{
              fontSize: 11,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "rgba(232, 226, 213, 0.42)",
            }}
          >
            turn knobs · tap prism to sparkle · long-press for auto-rotate
          </div>
        </div>
      </section>

      {/* ─── Zone 6: Metal Mirror ────────────────────────────────── */}
      <section
        style={{
          minHeight: isMobile ? "92vh" : undefined,
          padding: "36px var(--pad-x, 24px) 36px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: isMobile ? "center" : undefined,
          gap: 12,
        }}
        aria-label="metal mirror — drag the surface to redirect reflections"
      >
        <div
          ref={metalWrapRef}
          style={{
            position: "relative",
            width: "min(100%, 1100px)",
            height: isMobile ? "clamp(280px, 60vh, 480px)" : "clamp(220px, 36vw, 360px)",
            border: "1px solid rgba(232, 226, 213, 0.10)",
            borderRadius: 4,
            overflow: "hidden",
            userSelect: "none",
            WebkitUserSelect: "none",
            WebkitTouchCallout: "none",
          }}
        >
          <canvas
            ref={metalGlassRef}
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              display: "block",
              pointerEvents: "none",
            }}
          />
          <canvas
            ref={metalCanvasRef}
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              display: "block",
              cursor: "grab",
              touchAction: "none",
              userSelect: "none",
              WebkitUserSelect: "none",
              WebkitTouchCallout: "none",
            }}
          />
        </div>
        <div
          className="t-mono"
          style={{
            fontSize: 11,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "rgba(232, 226, 213, 0.42)",
            minHeight: 44,
            display: "flex",
            alignItems: "center",
            touchAction: "manipulation",
          }}
        >
          drag the surface to redirect · pinch the rim to rotate
        </div>
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontWeight: 300,
            fontSize: "clamp(15px, 1.6vw, 18px)",
            color: "rgba(232, 226, 213, 0.62)",
            textAlign: "center",
          }}
        >
          metal remembers every wavelength differently
        </div>
      </section>

      {/* divider */}
      <div
        style={{
          height: 1,
          background: "rgba(232, 226, 213, 0.08)",
          maxWidth: 1100,
          margin: "0 auto",
        }}
      />

      {/* ─── Zone 3: Wave / Particle Duality ──────────────────────── */}
      <section
        style={{
          minHeight: isMobile ? "92vh" : undefined,
          padding: "36px var(--pad-x, 24px) 64px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: isMobile ? "center" : undefined,
          gap: 12,
        }}
        aria-label="wave / particle dial — drag to morph"
      >
        <div
          ref={duaWrapRef}
          style={{
            position: "relative",
            width: "min(100%, 1100px)",
            height: isMobile ? "clamp(260px, 58vh, 420px)" : "clamp(180px, 28vw, 260px)",
            userSelect: "none",
            WebkitUserSelect: "none",
            WebkitTouchCallout: "none",
          }}
        >
          <canvas
            ref={duaCanvasRef}
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              display: "block",
              cursor: "ew-resize",
              touchAction: "none",
              userSelect: "none",
              WebkitUserSelect: "none",
              WebkitTouchCallout: "none",
            }}
          />
        </div>
        {/* live readout */}
        <div
          className="t-mono"
          style={{
            fontSize: 13,
            letterSpacing: "0.06em",
            color: "rgba(232, 226, 213, 0.78)",
            minHeight: 44,
            display: "flex",
            alignItems: "center",
            touchAction: "manipulation",
          }}
        >
          wave {readout.wave}% · particle {readout.particle}%
        </div>
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontWeight: 300,
            fontSize: "clamp(15px, 1.6vw, 18px)",
            color: "rgba(232, 226, 213, 0.62)",
            textAlign: "center",
          }}
        >
          the same thing seen two ways
        </div>
      </section>

      {/* divider */}
      <div
        style={{
          height: 1,
          background: "rgba(232, 226, 213, 0.08)",
          maxWidth: 1100,
          margin: "0 auto",
        }}
      />

      {/* ─── Zone 4: Standing-wave Interference ───────────────────── */}
      <section
        style={{
          minHeight: isMobile ? "92vh" : undefined,
          padding: "36px var(--pad-x, 24px) 36px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: isMobile ? "center" : undefined,
          gap: 12,
        }}
        aria-label="standing wave interference — drag the sources"
      >
        <div
          ref={interferenceWrapRef}
          style={{
            position: "relative",
            width: "min(100%, 1100px)",
            height: isMobile ? "clamp(280px, 62vh, 520px)" : "clamp(280px, 50vh, 480px)",
            border: "1px solid rgba(232, 226, 213, 0.10)",
            borderRadius: 4,
            overflow: "hidden",
            userSelect: "none",
            WebkitUserSelect: "none",
            WebkitTouchCallout: "none",
          }}
        >
          <canvas
            ref={interferenceCanvasRef}
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              display: "block",
              cursor: "crosshair",
              touchAction: "none",
              userSelect: "none",
              WebkitUserSelect: "none",
              WebkitTouchCallout: "none",
            }}
          />
        </div>
        <div
          className="t-mono"
          style={{
            fontSize: 13,
            letterSpacing: "0.06em",
            color: "rgba(232, 226, 213, 0.78)",
            minHeight: 44,
            display: "flex",
            alignItems: "center",
            touchAction: "manipulation",
          }}
        >
          frequency: {(2.2 / (2 * Math.PI)).toFixed(2)} Hz · sources: {interferenceCount}
        </div>
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontWeight: 300,
            fontSize: "clamp(15px, 1.6vw, 18px)",
            color: "rgba(232, 226, 213, 0.62)",
            textAlign: "center",
          }}
        >
          waves meet, waves cancel
        </div>
      </section>

      {/* divider */}
      <div
        style={{
          height: 1,
          background: "rgba(232, 226, 213, 0.08)",
          maxWidth: 1100,
          margin: "0 auto",
        }}
      />

      {/* ─── Zone 5: Light through media (refraction) ────────────── */}
      <section
        style={{
          minHeight: isMobile ? "92vh" : undefined,
          padding: "36px var(--pad-x, 24px) calc(136px + env(safe-area-inset-bottom, 0px))",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: isMobile ? "center" : undefined,
          gap: 12,
        }}
        aria-label="light through media — drag the boundaries"
      >
        <div
          ref={refractionWrapRef}
          style={{
            position: "relative",
            width: "min(100%, 1100px)",
            height: isMobile ? "clamp(280px, 62vh, 520px)" : "clamp(260px, 50vh, 460px)",
            border: "1px solid rgba(232, 226, 213, 0.10)",
            borderRadius: 4,
            overflow: "hidden",
            userSelect: "none",
            WebkitUserSelect: "none",
            WebkitTouchCallout: "none",
          }}
        >
          <canvas
            ref={refractionCanvasRef}
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              display: "block",
              cursor: "ew-resize",
              touchAction: "none",
              userSelect: "none",
              WebkitUserSelect: "none",
              WebkitTouchCallout: "none",
            }}
          />
        </div>
        <div
          className="t-mono"
          style={{
            fontSize: 11,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "rgba(232, 226, 213, 0.42)",
            minHeight: 44,
            display: "flex",
            alignItems: "center",
            touchAction: "manipulation",
          }}
        >
          drag the dashed boundaries to resize each medium
        </div>
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontWeight: 300,
            fontSize: "clamp(15px, 1.6vw, 18px)",
            color: "rgba(232, 226, 213, 0.62)",
            textAlign: "center",
          }}
        >
          glass bends what it lets through
        </div>
      </section>
    </div>
  );
}
