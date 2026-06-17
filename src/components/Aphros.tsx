"use client";

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import { useField } from "@/store/field";
import GreekKeyFrame from "@/components/GreekKeyFrame";
import WaterText from "@/components/WaterText";
import SeaChart, { type SeaChartCandle } from "@/components/SeaChart";

/**
 * /aphros — the love / foam page.
 *
 * "born of foam" — a Botticelli-palette beach scene with a spinnable
 * nautilus at its center, surrounded by shells. Each shell carries
 * a one-line inscription. The nautilus drifts on its own and
 * accepts drag — release at speed for a soft bell.
 *
 * Layers (top → bottom):
 *   sky (rose → cream → coral)
 *   sea band (translucent aqua)
 *   foam band (procedural canvas bubbles)
 *   sand (cream/ochre + grain noise)
 *
 * The interactive layer is SVG over the canvas — shells and the
 * nautilus are inline SVG paths so the file is self-contained.
 */

// ── Palette ──────────────────────────────────────────────────────────
const C = {
  skyRose: "#F4D5D0",
  creamBone: "#F0E8D8",
  coralSoft: "#E8B4A4",
  pinkShell: "#F2C0BC",
  ochreWarm: "#D9B68A",
  pearl: "#F8EDE3",
  nautilusStripe: "#B8693A",
  foam: "#FFFFFF",
  ink: "#6B4A3F",
  aqua: "#BFDDD8",
  aquaDeep: "#A3CFCB",
  // Galatea / Minoan accents
  minoanBlue: "#1E5A8C",
  dolphinBelly: "#E8B47A",
  puttoBody: "#F8EDE3",
  puttoRibbon: "#E8B4A4",
  ribbonUmber: "#B8693A",
};

// ── Shell definitions ────────────────────────────────────────────────
type ShellId =
  | "nautilus"
  | "scallop"
  | "conch"
  | "starfish"
  | "sanddollar"
  | "murex"
  | "cowrie"
  | "auger"
  | "limpet"
  | "cone"
  | "periwinkle"
  | "abalone";

// MIDI notes per shell — each shell has its own pitch in an A-major-ish
// scale so tapping them in sequence composes a small melody. Used by
// onShellClick and by the bottom Shell Tuner pad.
const SHELL_NOTES: Record<ShellId, number> = {
  nautilus:   69, // A4
  scallop:    72, // C5
  conch:      76, // E5
  starfish:   79, // G5
  sanddollar: 83, // B5
  murex:      74, // D5
  cowrie:     77, // F5
  auger:      84, // C6
  limpet:     71, // B4
  cone:       81, // A5
  periwinkle: 78, // F#5
  abalone:    66, // F#4
};

// Order in which the tuner pad displays the dots — visually grouped
// ascending so the user can sweep across to play a scale.
const TUNER_ORDER: ShellId[] = [
  "abalone", "nautilus", "limpet", "scallop", "murex", "cowrie", "periwinkle", "conch", "starfish", "cone", "sanddollar",
];

type Shell = {
  id: ShellId;
  // polar position around the nautilus center
  angle: number; // radians
  radius: number; // px from center
  size: number; // bounding diameter
  phrase: string;
};

const INSCRIPTIONS: Record<ShellId, string> = {
  nautilus: "the spiral remembers the smaller shell it used to be.",
  scallop: "the fan keeps the wind it was made by.",
  conch: "the sea is louder once you carry it.",
  starfish: "five arms — one star — no center but you.",
  sanddollar: "the flower the ocean prints in bone.",
  murex: "the dye that made the kings hid here.",
  cowrie: "a small mouth open to nothing — and still polished.",
  auger: "the spiral standing up.",
  limpet: "the small hat the tide tries on each day.",
  cone: "a single quiet note, sharpened.",
  periwinkle: "the smallest house the sea has ever built.",
  abalone: "the inner sky of an iridescent room.",
};

const SHELLS: Shell[] = [
  // top-left scallop
  { id: "scallop", angle: -Math.PI * 0.78, radius: 260, size: 96, phrase: INSCRIPTIONS.scallop },
  // top auger (small, tall)
  { id: "auger", angle: -Math.PI * 0.5, radius: 280, size: 90, phrase: INSCRIPTIONS.auger },
  // top-right starfish
  { id: "starfish", angle: -Math.PI * 0.22, radius: 260, size: 104, phrase: INSCRIPTIONS.starfish },
  // right conch
  { id: "conch", angle: 0.0, radius: 290, size: 110, phrase: INSCRIPTIONS.conch },
  // bottom-right cowrie
  { id: "cowrie", angle: Math.PI * 0.28, radius: 250, size: 80, phrase: INSCRIPTIONS.cowrie },
  // bottom-left sand dollar
  { id: "sanddollar", angle: Math.PI * 0.72, radius: 260, size: 92, phrase: INSCRIPTIONS.sanddollar },
  // left murex
  { id: "murex", angle: Math.PI, radius: 290, size: 100, phrase: INSCRIPTIONS.murex },
];

// ── Galatea-band creatures ───────────────────────────────────────────
// Dolphins arc through the sea band (Minoan fresco at Knossos).
// Putti drift through the sky band — circular sprites with windblown
// ribbon tails — abstract suggestions of cherubs (not literal angels).
// A single arching "Galatea sash" ribbon drapes across the upper-middle.

type Dolphin = {
  id: number;
  // arc cycle period (s) and phase offset (s) — staggered starts
  period: number;
  offset: number;
  // x positions of arc endpoints (as 0..1 fraction of viewport width)
  xStart: number;
  xEnd: number;
  // peak height of the arc, as a fraction of the SEA BAND height that
  // it rises ABOVE the sea band's top (so dolphin breaches into sky).
  // Values > 1.0 mean the dolphin clears the surface and is briefly
  // airborne above the foam line.
  peakLift: number;
  // last arc index seen (so we only splash once per cycle)
  lastCycle: number;
  // entry/exit splash gates — one shot per cycle for each
  lastEntryCycle: number;
  lastExitCycle: number;
};

const DOLPHINS: Dolphin[] = [
  // peakLift > 1.0 means the arc peaks ABOVE the sea band — the dolphin
  // genuinely breaches the water surface, briefly airborne and fully
  // visible above it. lastEntryCycle / lastExitCycle gate per-cycle
  // splash audio so we only fire once per crossing of the surface.
  { id: 0, period: 11.0, offset: 0.0,  xStart: -0.06, xEnd: 1.06, peakLift: 1.25, lastCycle: -1, lastEntryCycle: -1, lastExitCycle: -1 },
  { id: 1, period: 14.5, offset: 4.2,  xStart: 1.06,  xEnd: -0.06, peakLift: 1.40, lastCycle: -1, lastEntryCycle: -1, lastExitCycle: -1 },
  { id: 2, period: 9.8,  offset: 7.7,  xStart: -0.06, xEnd: 1.06, peakLift: 1.15, lastCycle: -1, lastEntryCycle: -1, lastExitCycle: -1 },
  // A 4th dolphin that pairs with #0 — same phase, slight x offset for
  // "two arcing in formation". Period matches #0; offset by half a sec.
  { id: 3, period: 11.0, offset: 0.55, xStart: -0.10, xEnd: 1.02, peakLift: 1.10, lastCycle: -1, lastEntryCycle: -1, lastExitCycle: -1 },
];

type Putto = {
  id: number;
  // sky-band vertical position (0..1 of sky band height)
  altY: number;
  // drift speed in px/sec (sign = direction)
  vx: number;
  // bob frequency + phase
  bobFreq: number;
  bobPhase: number;
  // size (radius, px)
  r: number;
  // ribbon direction: 1 = ribbon trails right of body, -1 = left
  ribbonDir: 1 | -1;
  // initial x as fraction of viewport
  x0: number;
};

const PUTTI: Putto[] = [
  { id: 0, altY: 0.34, vx: 7.0,  bobFreq: 0.45, bobPhase: 0.0, r: 13, ribbonDir: -1, x0: 0.08 },
  { id: 1, altY: 0.58, vx: -5.5, bobFreq: 0.38, bobPhase: 1.7, r: 16, ribbonDir: 1,  x0: 0.62 },
  { id: 2, altY: 0.46, vx: 9.5,  bobFreq: 0.52, bobPhase: 3.1, r: 11, ribbonDir: -1, x0: 0.36 },
];

// Splash bubble spawned when a dolphin re-enters the foam at the end of its arc.
type Splash = {
  id: number;
  x: number;
  y: number;
  born: number; // performance.now()
  life: number; // ms
};

// Brief shimmer-trail of dots left behind a clicked dolphin.
type Shimmer = {
  id: number;
  // path samples along the dolphin's recent arc
  pts: { x: number; y: number }[];
  born: number;
  life: number;
};

// Foam bubble — lifted to module scope so click handlers outside the canvas
// effect (and the React render) can pop them.  Each entry has a `pop` flag
// that the draw loop reads to animate the burst before culling.
type FoamBubble = {
  x: number;
  y: number;
  r: number;
  a: number;
  vx: number;
  born: number;
  life: number;
  swell: number;  // 0..1 hover swell amount, eased toward target
  pop: number;    // 0 = alive; >0 = ms since pop began
};

// Star planted on the sky band by tap.  Twinkles for ~10s then fades.
type SkyStar = { id: number; x: number; y: number; born: number; life: number };

// Sea ripple — circular ring expanding from a tap point.
type SeaRipple = { id: number; x: number; y: number; born: number; life: number };
type AphrosBurst = { id: number; x: number; y: number; born: number };

// Foam tongue — a small advancing arc of foam that "laps" onto the sand.
// Tongues are spawned every ~600ms across the foam/sand boundary and
// advance forward over ~1.2s before pulling back.
type FoamTongue = {
  id: number;
  x: number;       // center x
  width: number;   // px wide
  reach: number;   // max forward distance into sand band
  born: number;
  life: number;
};

// Sand impression — a darker depression on the sand where the user
// long-pressed. Persists for a while then slowly fades.
type SandImpression = {
  id: number;
  x: number;       // sand-band-local x
  y: number;       // sand-band-local y
  r: number;       // radius
  born: number;
  life: number;
};

export default function Aphros() {
  // page-specific ambient bed: ocean swell
  useEffect(() => { getFieldAudio().setAmbientProfile("ocean"); }, []);

  // foam canvas + sand grain canvas
  const foamRef = useRef<HTMLCanvasElement>(null);
  const sandRef = useRef<HTMLCanvasElement>(null);
  // sand-trail overlay canvas — captures finger marks the user drags into
  // the sand band. Sits on top of the static `sandRef` grain canvas.
  const sandTrailRef = useRef<HTMLCanvasElement>(null);
  // WebGL water canvas — renders a soft tropical-shallow water shader
  // behind the sea band CSS gradient. If WebGL fails, the gradient
  // alone still reads.
  const waterRef = useRef<HTMLCanvasElement>(null);
  // Aurora canvas — a faint slow-shifting pastel wisp shader in the
  // upper sky band. Drawn on top of the sky gradient.
  const auroraRef = useRef<HTMLCanvasElement>(null);
  // Water-ripple ref array (live) — read by the water shader uniform
  // each frame. Push entries on shell clicks / sea taps.
  const waterRipplesRef = useRef<Array<{ x: number; y: number; t0: number; strength: number }>>([]);

  // bubbles ref — populated by the foam useEffect, read by the foam-band
  // pointer overlay so hover/click can affect existing bubble objects.
  const bubblesRef = useRef<FoamBubble[]>([]);

  // nautilus rotation (radians) and angular velocity (rad/sec)
  const nautilusRot = useRef(0);
  const nautilusVel = useRef((5 * Math.PI) / 180); // ~5°/sec auto spin

  // drag state on nautilus
  const drag = useRef<{
    active: boolean;
    lastA: number; // last angle from center (rad)
    pointerId: number | null;
    moved: boolean;
    velSamples: number[]; // recent dω samples for inertia
    centerX: number;
    centerY: number;
  }>({
    active: false,
    lastA: 0,
    pointerId: null,
    moved: false,
    velSamples: [],
    centerX: 0,
    centerY: 0,
  });

  // hover phrase (small tooltip near a shell)
  const [hoverShell, setHoverShell] = useState<ShellId | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  // bottom-center inscription state (managed via ref + force-render via state stamp)
  const inscriptionRef = useRef<{ text: string; t0: number } | null>(null);
  const [inscriptionStamp, setInscriptionStamp] = useState(0);

  // per-shell scale-pop state for click feedback
  const popRef = useRef<Record<string, number>>({});

  // viewport tracking — so SVG and overlays know the center
  const [viewport, setViewport] = useState({ w: 0, h: 0 });

  // ── Galatea overlays: dolphins, putti, ribbon ────────────────────
  // Refs (not state) so the RAF loop updates SVG attributes directly,
  // avoiding per-frame React re-renders.
  const dolphinGroupRefs = useRef<Record<number, SVGGElement | null>>({});
  const puttoGroupRefs = useRef<Record<number, SVGGElement | null>>({});
  const ribbonPathRef = useRef<SVGPathElement | null>(null);

  // Mutable dolphin state — last seen progress used to detect a fresh splash
  // and to mark a cycle for shimmer trail sampling.
  const dolphinState = useRef<Dolphin[]>(DOLPHINS.map((d) => ({ ...d })));

  // Splashes + shimmer trails (state — count is small, updates rare)
  const [splashes, setSplashes] = useState<Splash[]>([]);
  const [shimmers, setShimmers] = useState<Shimmer[]>([]);
  const splashIdRef = useRef(0);
  const shimmerIdRef = useRef(0);

  // Hovered putto (for soft glow)
  const [hoverPutto, setHoverPutto] = useState<number | null>(null);

  // ── Sky stars & sea ripples (state — handful at a time) ──────────
  const [skyStars, setSkyStars] = useState<SkyStar[]>([]);
  const [seaRipples, setSeaRipples] = useState<SeaRipple[]>([]);
  const [aphrosBursts, setAphrosBursts] = useState<AphrosBurst[]>([]);
  const skyStarIdRef = useRef(0);
  const seaRippleIdRef = useRef(0);
  const aphrosBurstIdRef = useRef(0);

  // Foam tongues — live in a ref so the foam draw loop can append/cull
  // without forcing a React re-render every spawn.
  const foamTonguesRef = useRef<FoamTongue[]>([]);
  const foamTongueIdRef = useRef(0);

  // Sand impressions (long-press depressions). Drawn by the sand-trail
  // canvas — held as refs for the same reason as foam tongues.
  const sandImpressionsRef = useRef<SandImpression[]>([]);
  const sandImpressionIdRef = useRef(0);

  // Long-press timer for the sand surface.
  const sandPressTimerRef = useRef<number | null>(null);

  // Shell-tuner tap sequence — last few shells the user tapped through
  // the tuner pad. Displayed as a tiny breadcrumb so the user sees what
  // they composed. Cleared after 3s of inactivity.
  const [tunerSeq, setTunerSeq] = useState<ShellId[]>([]);
  const tunerSeqTimerRef = useRef<number | null>(null);

  // Foam chart sampling: at 600ms intervals we read the foam bubble list
  // length (a proxy for "foam intensity") into a rolling buffer used by the
  // inline SeaChart embed.
  const foamHistoryRef = useRef<number[]>([]);
  const [foamChartPullKey, setFoamChartPullKey] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      const intensity = bubblesRef.current.length / 70; // ~0..1
      const buf = foamHistoryRef.current;
      buf.push(intensity);
      if (buf.length > 120) buf.shift();
      setFoamChartPullKey((k) => k + 1);
    }, 600);
    return () => window.clearInterval(id);
  }, []);
  const foamSource = (i: number): SeaChartCandle => {
    const buf = foamHistoryRef.current;
    const COUNT = 30;
    if (buf.length < 2) {
      return { open: 0.5, close: 0.5, high: 0.55, low: 0.45, volume: 0.05 };
    }
    const offset = i % COUNT;
    const start = Math.max(0, buf.length - COUNT * 2);
    const a = buf[Math.min(buf.length - 1, start + offset * 2)] ?? 0.5;
    const b = buf[Math.min(buf.length - 1, start + offset * 2 + 1)] ?? a;
    const open = a;
    const close = b;
    const high = Math.max(a, b) + Math.abs(b - a) * 0.4 + 0.02;
    const low = Math.min(a, b) - Math.abs(b - a) * 0.4 - 0.02;
    const volume = Math.abs(b - a) + 0.04;
    return { open, close, high, low, volume };
  };

  // Per-shell bloom animation state — refs not state. Each entry is an
  // age in ms; the RAF tick decrements it and applies a scale 0→1.1→1.0
  // envelope on the shell group's transform.
  const shellBloomRef = useRef<Record<string, number>>({});

  // ── Sky-band hover warming: 0..1, eased toward target ─────────────
  // Toggled true while the cursor is hovering over the sky band; the
  // gradient interpolates toward warmer rose/coral.
  const [skyWarm, setSkyWarm] = useState(false);

  // ── Ribbon drag state ─────────────────────────────────────────────
  // The ribbon path is a cubic with two control points.  While dragged
  // we offset those control points; on release we spring them back over
  // ~3s.  ribbonOffset is read each animation frame by the ribbon RAF.
  const ribbonOffset = useRef({
    c1x: 0, c1y: 0, c2x: 0, c2y: 0,
    // bias of the START / END points too, capped tightly
    sx: 0, sy: 0, ex: 0, ey: 0,
    // release state — when > 0, time of release; springs back over RELEASE_MS
    releasedAt: 0,
    releasedFrom: { c1x: 0, c1y: 0, c2x: 0, c2y: 0, sx: 0, sy: 0, ex: 0, ey: 0 },
  });
  const ribbonDrag = useRef<{
    active: boolean;
    pointerId: number | null;
    lastX: number;
    lastY: number;
  }>({ active: false, pointerId: null, lastX: 0, lastY: 0 });

  // ── Putti "fly" state ─────────────────────────────────────────────
  // When a putto is clicked it briefly accelerates: while flyUntil > now
  // the RAF adds a flyBoost (px/sec) to its drift velocity.
  const puttoFly = useRef<Record<number, { flyUntil: number; boost: number }>>({});

  // ── Inscription save pulse ────────────────────────────────────────
  // Pulse is a small CSS-driven scale bump — `pulseOn` flips true on save
  // and back to false after 600ms via a timeout.  We keep React state so
  // CSS transitions interpolate transform between the two values.
  const [pulseOn, setPulseOn] = useState(false);
  // Track the shell id whose inscription is showing, so the save tape
  // event can record which one was kept.
  const inscriptionShellRef = useRef<ShellId | null>(null);

  useEffect(() => {
    const onResize = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ── Sand grain noise (drawn once after viewport set) ───────────────
  useEffect(() => {
    const cv = sandRef.current;
    if (!cv || viewport.w === 0) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = viewport.w;
    const h = Math.max(1, Math.floor(viewport.h * 0.38));
    cv.width = w * dpr;
    cv.height = h * dpr;
    cv.style.width = `${w}px`;
    cv.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // base gradient (cream → ochre)
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, C.creamBone);
    g.addColorStop(0.55, C.pearl);
    g.addColorStop(1, C.ochreWarm);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // grains: many tiny dots
    const grains = Math.floor((w * h) / 900);
    for (let i = 0; i < grains; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const a = 0.04 + Math.random() * 0.08;
      const r = Math.random() < 0.92 ? 0.6 : 1.1;
      // mix warm/cool grain colors
      const warm = Math.random() < 0.7;
      ctx.fillStyle = warm
        ? `rgba(120, 88, 56, ${a})`
        : `rgba(70, 56, 44, ${a * 0.8})`;
      ctx.fillRect(x, y, r, r);
    }
    // a few pale shell-flecks
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      ctx.fillStyle = `rgba(255, 248, 232, ${0.12 + Math.random() * 0.18})`;
      ctx.fillRect(x, y, 1.4, 1.4);
    }
  }, [viewport.w, viewport.h]);

  // ── WebGL water (sea band) + aurora (sky band) ─────────────────────
  // Two small WebGL canvases — one for the sea band, one for the sky.
  // Each owns its own GL context, shaders, and RAF loop. If GL is
  // unavailable for either, the underlying CSS gradient still reads.
  useEffect(() => {
    if (viewport.w === 0) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ── WATER ────────────────────────────────────────────────────
    const water = waterRef.current;
    let waterCleanup: (() => void) | null = null;
    if (water) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = viewport.w;
      const h = Math.floor(viewport.h * 0.25);
      water.width = Math.floor(w * dpr);
      water.height = Math.floor(h * dpr);
      water.style.width = `${w}px`;
      water.style.height = `${h}px`;

      const gl =
        (water.getContext("webgl", { antialias: false, premultipliedAlpha: true }) ||
          water.getContext(
            "experimental-webgl" as "webgl",
            { antialias: false, premultipliedAlpha: true } as WebGLContextAttributes,
          )) as WebGLRenderingContext | null;

      if (gl) {
        const vert = `
          attribute vec2 a_pos;
          varying vec2 vUv;
          void main() {
            vUv = a_pos * 0.5 + 0.5;
            gl_Position = vec4(a_pos, 0.0, 1.0);
          }
        `;
        // Tropical shallow water: pale aqua at the top (sky-reflective),
        // deeper aqua/teal toward the bottom, with slow wave displacement
        // and subtle caustic glints. Outputs RGBA with the alpha tied to
        // the depth gradient so the existing rose/cream sky shows through
        // softly at the horizon.
        const frag = `
          precision highp float;
          uniform float uTime;
          uniform vec2 uRes;
          uniform vec4 uRipples[8];
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
            for (int i = 0; i < 4; i++) {
              v += a * vnoise(p);
              p *= 2.05;
              a *= 0.52;
            }
            return v;
          }

          void main() {
            vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
            float t = uTime;

            // ── ripples from shell pops & sea taps ──
            float rippleHi = 0.0;
            for (int i = 0; i < 8; i++) {
              if (i >= uRippleCount) break;
              vec4 r = uRipples[i];
              vec2 dp = uv - r.xy;
              float dist = length(dp);
              float age = r.z;
              if (age > 2.4) continue;
              float speed = 0.34;
              float front = dist - age * speed;
              float env = exp(-(front * front) / 0.0028);
              float falloff = 1.0 / (1.0 + dist * 3.2);
              float temporal = max(0.0, 1.0 - age / 2.4);
              rippleHi += r.w * env * falloff * temporal;
            }

            // gentle flow displacement
            vec2 flow = vec2(
              sin(uv.y * 9.0 + t * 0.32) * 0.012,
              sin(uv.x * 7.0 + t * 0.22) * 0.008
            );
            vec2 wuv = uv + flow;
            wuv += rippleHi * 0.010;

            // Tropical shallow depth gradient — pale sky-reflective aqua
            // at top, warmer turquoise mid, pale sand glow at very bottom.
            vec3 aquaPale = vec3(0.78, 0.92, 0.92);  // BFDDD8 approx
            vec3 aquaMid  = vec3(0.55, 0.83, 0.84);  // 8FDED1 approx
            vec3 aquaWarm = vec3(0.66, 0.86, 0.81);  // shallow tint
            vec3 sandLit  = vec3(0.92, 0.83, 0.69);  // EBD2B0 — sand under water
            vec3 col = mix(aquaPale, aquaMid, smoothstep(0.0, 0.55, wuv.y));
            col = mix(col, aquaWarm, smoothstep(0.55, 0.85, wuv.y));
            col = mix(col, sandLit, smoothstep(0.85, 1.0, wuv.y));

            // caustic glints — fbm + sine product, brighter near surface
            vec2 nuv = wuv * vec2(uRes.x / uRes.y, 1.0) * 4.2 + vec2(t * 0.06, t * 0.04);
            float n = fbm(nuv);
            float c1 = sin((wuv.x + n * 0.18) * 22.0 + t * 0.40)
                     * sin((wuv.y + n * 0.14) * 12.0 - t * 0.30);
            float caustic = smoothstep(0.55, 1.05, c1 * 0.7 + n * 0.3);
            float surfMask = 1.0 - smoothstep(0.0, 0.5, wuv.y);
            col += caustic * 0.10 * vec3(1.0, 0.98, 0.92) * surfMask;

            // ripple highlights
            col += rippleHi * 0.012 * vec3(1.0, 1.0, 0.95);

            // soft wave-crest white streaks at midline — very subtle
            float crest = smoothstep(0.6, 1.0, sin(wuv.x * 30.0 + t * 0.8 + n * 1.5)
                                            * sin(wuv.y * 18.0 - t * 0.5));
            col += crest * 0.04 * vec3(1.0);

            // alpha: fade in at top so the rose horizon shows through softly,
            // full at bottom where the foam band takes over
            float a = smoothstep(0.0, 0.18, wuv.y) * 0.78 + 0.12;

            gl_FragColor = vec4(col * a, a);
          }
        `;
        const compile = (type: number, src: string) => {
          const s = gl.createShader(type);
          if (!s) return null;
          gl.shaderSource(s, src);
          gl.compileShader(s);
          if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            console.warn("aphros water shader failed", gl.getShaderInfoLog(s));
            gl.deleteShader(s);
            return null;
          }
          return s;
        };
        const vs = compile(gl.VERTEX_SHADER, vert);
        const fs = compile(gl.FRAGMENT_SHADER, frag);
        let prog: WebGLProgram | null = null;
        let uTimeLoc: WebGLUniformLocation | null = null;
        let uResLoc: WebGLUniformLocation | null = null;
        let uRipplesLoc: WebGLUniformLocation | null = null;
        let uRippleCountLoc: WebGLUniformLocation | null = null;
        if (vs && fs) {
          const p = gl.createProgram();
          if (p) {
            gl.attachShader(p, vs);
            gl.attachShader(p, fs);
            gl.linkProgram(p);
            if (gl.getProgramParameter(p, gl.LINK_STATUS)) {
              prog = p;
              uTimeLoc = gl.getUniformLocation(p, "uTime");
              uResLoc = gl.getUniformLocation(p, "uRes");
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
              gl.viewport(0, 0, water.width, water.height);
              gl.enable(gl.BLEND);
              gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            }
          }
        }
        if (prog) {
          const t0 = performance.now();
          let raf = 0;
          const draw = (now: number) => {
            const t = (now - t0) / 1000 * (reduce ? 0.35 : 1);
            gl.useProgram(prog!);
            if (uTimeLoc) gl.uniform1f(uTimeLoc, t);
            if (uResLoc) gl.uniform2f(uResLoc, water.width, water.height);
            if (uRipplesLoc && uRippleCountLoc) {
              const MAX = 8;
              const data = new Float32Array(MAX * 4);
              const cw = w || 1;
              const ch = h || 1;
              let count = 0;
              for (let i = waterRipplesRef.current.length - 1; i >= 0 && count < MAX; i--) {
                const r = waterRipplesRef.current[i];
                const age = (now - r.t0) / 1000;
                if (age > 2.4) continue;
                data[count * 4 + 0] = r.x / cw;
                // y is in sea-band-local coords (already)
                data[count * 4 + 1] = r.y / ch;
                data[count * 4 + 2] = age;
                data[count * 4 + 3] = r.strength;
                count++;
              }
              // GC old
              waterRipplesRef.current = waterRipplesRef.current.filter(
                (r) => (now - r.t0) / 1000 <= 2.4,
              );
              gl.uniform4fv(uRipplesLoc, data);
              gl.uniform1i(uRippleCountLoc, count);
            }
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            raf = requestAnimationFrame(draw);
          };
          raf = requestAnimationFrame(draw);
          waterCleanup = () => cancelAnimationFrame(raf);
        }
      }
    }

    // ── AURORA ───────────────────────────────────────────────────
    const aurora = auroraRef.current;
    let auroraCleanup: (() => void) | null = null;
    if (aurora) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = viewport.w;
      const h = Math.floor(viewport.h * 0.25);
      aurora.width = Math.floor(w * dpr);
      aurora.height = Math.floor(h * dpr);
      aurora.style.width = `${w}px`;
      aurora.style.height = `${h}px`;

      const gl =
        (aurora.getContext("webgl", { antialias: false, premultipliedAlpha: true }) ||
          aurora.getContext(
            "experimental-webgl" as "webgl",
            { antialias: false, premultipliedAlpha: true } as WebGLContextAttributes,
          )) as WebGLRenderingContext | null;
      if (gl) {
        const vert = `
          attribute vec2 a_pos;
          varying vec2 vUv;
          void main() {
            vUv = a_pos * 0.5 + 0.5;
            gl_Position = vec4(a_pos, 0.0, 1.0);
          }
        `;
        // Slow drifting pastel wisps — pink/coral/cream. Very low alpha
        // so the underlying rose sky reads through cleanly.
        const frag = `
          precision highp float;
          uniform float uTime;
          uniform vec2 uRes;
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
              p *= 2.04;
              a *= 0.55;
            }
            return v;
          }

          void main() {
            vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
            float t = uTime;

            // wisp field — fbm advected horizontally with a slow drift
            vec2 nuv = vec2(uv.x * 2.2 + t * 0.03, uv.y * 2.8 + sin(t * 0.07) * 0.1);
            float n1 = fbm(nuv);
            float n2 = fbm(nuv * 1.6 + vec2(t * 0.02, 0.0));

            // three color veils — pink, coral, cream — each masked by a
            // band of the noise field, so they blend instead of stacking
            float band1 = smoothstep(0.45, 0.85, n1);
            float band2 = smoothstep(0.40, 0.80, 1.0 - n2);
            float band3 = smoothstep(0.50, 0.90, sin(n1 * 6.28 + t * 0.1) * 0.5 + 0.5);

            vec3 pink  = vec3(0.96, 0.83, 0.82); // F4D5D0
            vec3 coral = vec3(0.91, 0.71, 0.65); // E8B4A4
            vec3 cream = vec3(0.94, 0.91, 0.85); // F0E8D8

            vec3 color = pink * band1 * 0.35
                       + coral * band2 * 0.28
                       + cream * band3 * 0.22;

            // vertical mask: brightest in the upper third, fades to nothing
            // at the horizon so the aurora doesn't clash with the sea.
            float vMask = 1.0 - smoothstep(0.45, 0.95, uv.y);
            // hide at the very top edge so the page header doesn't get streaks
            float topMask = smoothstep(0.0, 0.08, uv.y);

            float a = (band1 * 0.18 + band2 * 0.14 + band3 * 0.10) * vMask * topMask;
            gl_FragColor = vec4(color, a);
          }
        `;
        const compile = (type: number, src: string) => {
          const s = gl.createShader(type);
          if (!s) return null;
          gl.shaderSource(s, src);
          gl.compileShader(s);
          if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            console.warn("aphros aurora shader failed", gl.getShaderInfoLog(s));
            gl.deleteShader(s);
            return null;
          }
          return s;
        };
        const vs = compile(gl.VERTEX_SHADER, vert);
        const fs = compile(gl.FRAGMENT_SHADER, frag);
        let prog: WebGLProgram | null = null;
        let uTimeLoc: WebGLUniformLocation | null = null;
        let uResLoc: WebGLUniformLocation | null = null;
        if (vs && fs) {
          const p = gl.createProgram();
          if (p) {
            gl.attachShader(p, vs);
            gl.attachShader(p, fs);
            gl.linkProgram(p);
            if (gl.getProgramParameter(p, gl.LINK_STATUS)) {
              prog = p;
              uTimeLoc = gl.getUniformLocation(p, "uTime");
              uResLoc = gl.getUniformLocation(p, "uRes");
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
              gl.viewport(0, 0, aurora.width, aurora.height);
              gl.enable(gl.BLEND);
              gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            }
          }
        }
        if (prog) {
          const t0 = performance.now();
          let raf = 0;
          // Aurora animates very slowly — under reduced motion we still
          // let it drift, just at 0.2× speed.
          const speedScale = reduce ? 0.2 : 1.0;
          const draw = (now: number) => {
            const t = ((now - t0) / 1000) * speedScale;
            gl.useProgram(prog!);
            if (uTimeLoc) gl.uniform1f(uTimeLoc, t);
            if (uResLoc) gl.uniform2f(uResLoc, aurora.width, aurora.height);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            raf = requestAnimationFrame(draw);
          };
          raf = requestAnimationFrame(draw);
          auroraCleanup = () => cancelAnimationFrame(raf);
        }
      }
    }

    return () => {
      if (waterCleanup) waterCleanup();
      if (auroraCleanup) auroraCleanup();
    };
  }, [viewport.w, viewport.h]);

  // ── Foam canvas + animation loop ───────────────────────────────────
  useEffect(() => {
    const cv = foamRef.current;
    if (!cv || viewport.w === 0) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = viewport.w;
    const h = Math.max(80, Math.floor(viewport.h * 0.12));
    cv.width = w * dpr;
    cv.height = h * dpr;
    cv.style.width = `${w}px`;
    cv.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // bubble objects — shared with the foam-band pointer overlay so hover
    // can swell individual bubbles and click can pop them. Density scales
    // with viewport width so it reads as continuous foam, not specks.
    const bubbles = bubblesRef.current;
    bubbles.length = 0;
    const TARGET = reduce ? 90 : Math.min(360, 180 + Math.floor(w / 5));
    const seed = (force = false) => {
      while (bubbles.length < TARGET) {
        // mostly tiny; some medium; rare big — looks like genuine sea foam
        const r0 = Math.random();
        const r = r0 < 0.62 ? 0.8 + Math.random() * 2.0
              : r0 < 0.92 ? 2.2 + Math.random() * 3.6
              :              5.8 + Math.random() * 7.4;
        bubbles.push({
          x: Math.random() * w,
          y: force ? Math.random() * h : Math.random() * h * 0.45,
          r,
          a: 0.32 + Math.random() * 0.55,
          vx: (Math.random() - 0.5) * 0.42,
          born: performance.now(),
          life: 2400 + Math.random() * 5400,
          swell: 0,
          pop: 0,
        });
      }
    };
    seed(true);

    // Foam tongue spawner — every ~600ms a small advancing arc of foam
    // is born along the foam/sand boundary. Drawn at the bottom of the
    // foam canvas so it visually "laps" onto the sand below.
    let lastTongueSpawn = performance.now();

    let raf = 0;
    let lastT = performance.now();

    const draw = (now: number) => {
      const dt = Math.min(64, now - lastT) / 1000;
      lastT = now;
      const motion = reduce ? 0.2 : 1;

      ctx.clearRect(0, 0, w, h);

      // base wash — translucent cream so the band has a presence even when bubbles thin
      const baseG = ctx.createLinearGradient(0, 0, 0, h);
      baseG.addColorStop(0, "rgba(255, 252, 246, 0.78)");
      baseG.addColorStop(0.65, "rgba(248, 240, 226, 0.65)");
      baseG.addColorStop(1, "rgba(240, 232, 216, 0.55)");
      ctx.fillStyle = baseG;
      ctx.fillRect(0, 0, w, h);

      // animate + draw bubbles
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        // popped bubbles: brief expanding ring, then removed
        if (b.pop > 0) {
          b.pop += dt * 1000;
          const pt = Math.min(1, b.pop / 320);
          const popR = b.r * (1 + pt * 3.2);
          const popA = (1 - pt) * 0.6;
          ctx.strokeStyle = `rgba(255, 255, 252, ${popA})`;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(b.x, b.y, popR, 0, Math.PI * 2);
          ctx.stroke();
          if (pt >= 1) bubbles.splice(i, 1);
          continue;
        }
        // gentle drift, slight upward birth then settle
        b.x += b.vx * motion * (dt * 60) * 0.4;
        b.y += Math.sin((now / 1400 + i) * 0.6) * 0.03 * motion;
        if (b.x < -20) b.x = w + 20;
        if (b.x > w + 20) b.x = -20;
        const age = (now - b.born) / b.life;
        if (age > 1) {
          bubbles.splice(i, 1);
          continue;
        }
        // ease swell toward 0 — hover sets it to 1, then it relaxes once
        // the pointer leaves.  Increases the rendered radius by up to 35%.
        b.swell += (0 - b.swell) * Math.min(1, dt * 1.6);
        // alpha envelope: fast in, slow out
        const env = age < 0.12 ? age / 0.12 : 1 - (age - 0.12) / 0.88;
        const alpha = b.a * Math.max(0, env);
        const renderR = b.r * (1 + b.swell * 0.35);
        // radial gradient — cream center, fading edges
        const grad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, renderR);
        grad.addColorStop(0, `rgba(255, 255, 252, ${alpha})`);
        grad.addColorStop(0.6, `rgba(252, 246, 232, ${alpha * 0.65})`);
        grad.addColorStop(1, `rgba(248, 240, 220, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(b.x, b.y, renderR, 0, Math.PI * 2);
        ctx.fill();
      }
      seed();

      // ── Foam tongues — lapping arcs at the foam/sand boundary ──
      // Spawn a new tongue periodically. They live in a module-level
      // ref array so other handlers (sea taps, dolphin entries) can
      // also push tongues — but here we just maintain the steady rhythm.
      const tongueInterval = reduce ? 1600 : 700;
      if (now - lastTongueSpawn > tongueInterval) {
        lastTongueSpawn = now;
        foamTonguesRef.current.push({
          id: foamTongueIdRef.current++,
          x: Math.random() * w,
          width: 60 + Math.random() * 120,
          reach: 10 + Math.random() * 22,
          born: now,
          life: 1500 + Math.random() * 900,
        });
        if (foamTonguesRef.current.length > 18) foamTonguesRef.current.shift();
      }
      for (let i = foamTonguesRef.current.length - 1; i >= 0; i--) {
        const tg = foamTonguesRef.current[i];
        const tAge = (now - tg.born) / tg.life;
        if (tAge >= 1) {
          foamTonguesRef.current.splice(i, 1);
          continue;
        }
        // forward then pull back — sin envelope across the life span
        const reachT = Math.sin(tAge * Math.PI);
        const alphaT = Math.sin(tAge * Math.PI);
        // Draw the tongue as a wide, low-arch arc spanning the bottom
        // of the foam band. As reachT grows, the arc dome rises (so the
        // foam "advances" upward) and a leading-edge bubble cluster
        // disperses outward. Mirrored vertically vs. the previous draft
        // so the dome reads as a crest moving up-and-back, not down off
        // the canvas (which would be clipped).
        const cx = tg.x;
        const rx = tg.width * 0.5;
        const archH = 4 + 10 * reachT; // dome height: 4..14px
        const baseY = h - 3;
        // Build the dome as a quadratic curve and fill softly
        const grad = ctx.createLinearGradient(cx, baseY - archH, cx, baseY);
        grad.addColorStop(0, `rgba(255, 254, 250, ${0.55 * alphaT})`);
        grad.addColorStop(1, `rgba(252, 244, 226, ${0.20 * alphaT})`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(cx - rx, baseY);
        ctx.quadraticCurveTo(cx, baseY - archH * 2, cx + rx, baseY);
        ctx.closePath();
        ctx.fill();
        // leading-edge bubble cluster — sits along the dome's top edge
        const cluster = 8 + Math.floor(reachT * 10);
        for (let k = 0; k < cluster; k++) {
          const u = (k / cluster) - 0.5;
          const bx = cx + u * tg.width * 0.85;
          // arc top at this x: y = baseY - archH * (1 - 4u²)  (parabola)
          const by = baseY - archH * (1 - 4 * u * u) + (Math.random() - 0.5) * 1.4;
          const br = 0.7 + Math.random() * 1.7;
          ctx.fillStyle = `rgba(255, 255, 252, ${0.7 * alphaT})`;
          ctx.beginPath();
          ctx.arc(bx, by, br, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // clumped foam patches — fewer, larger, very low alpha
      for (let i = 0; i < 6; i++) {
        const cx = ((Math.sin(now / 4200 + i * 1.7) + 1) / 2) * w;
        const cy = ((Math.cos(now / 5300 + i * 2.1) + 1) / 2) * h * 0.7 + h * 0.15;
        const r = 26 + (i % 3) * 8;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, "rgba(255, 254, 248, 0.34)");
        g.addColorStop(1, "rgba(255, 254, 248, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [viewport.w, viewport.h]);

  // ── Nautilus + shell animation loop (SVG transforms via refs) ──────
  const nautilusGroupRef = useRef<SVGGElement>(null);
  const shellRefs = useRef<Record<string, SVGGElement | null>>({});

  useEffect(() => {
    if (viewport.w === 0) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let raf = 0;
    let lastT = performance.now();
    const t0 = lastT;

    const tick = (now: number) => {
      const dt = Math.min(64, now - lastT) / 1000;
      lastT = now;
      const t = (now - t0) / 1000;

      // auto-spin baseline (slower when reduced)
      const autoVel = (reduce ? (1.2 * Math.PI) / 180 : (5 * Math.PI) / 180);
      if (!drag.current.active) {
        // ease velocity toward auto baseline with light damping
        // larger velocity from a fling decays back to autoVel
        nautilusVel.current += (autoVel - nautilusVel.current) * Math.min(1, dt * 0.6);
      }
      nautilusRot.current += nautilusVel.current * dt;

      // apply nautilus rotation
      const ng = nautilusGroupRef.current;
      if (ng) {
        const cx = viewport.w / 2;
        const cy = viewport.h * 0.55;
        const deg = (nautilusRot.current * 180) / Math.PI;
        ng.setAttribute("transform", `translate(${cx} ${cy}) rotate(${deg})`);
      }

      // shell bob + pop
      const cx = viewport.w / 2;
      const cy = viewport.h * 0.55;
      // Responsive radius + shell scale. Below 700px viewport width the
      // baseline radius (~260–290 CSS px) pushes the shells past the
      // viewport edges and overlaps the nautilus disc. Pull them closer
      // and shrink them proportionally to the smaller of width/height.
      const narrow = viewport.w < 700;
      const radiusScale = narrow
        ? Math.max(0.55, Math.min(1, viewport.w / 720))
        : 1;
      const shellScaleBase = narrow ? Math.max(0.62, radiusScale) : 1;
      SHELLS.forEach((sh, i) => {
        const el = shellRefs.current[sh.id];
        if (!el) return;
        const bob = reduce ? 0 : Math.sin(t * 0.9 + i * 0.7) * 4;
        const radius = sh.radius * radiusScale;
        const px = cx + Math.cos(sh.angle) * radius;
        const py = cy + Math.sin(sh.angle) * radius + bob;
        // pop ease: 1 → bigger → 1
        const popAmt = popRef.current[sh.id] ?? 0;
        if (popAmt > 0) {
          popRef.current[sh.id] = Math.max(0, popAmt - dt * 2.2);
        }
        const pop = popRef.current[sh.id] ?? 0;
        const hover = hoverShell === sh.id ? 0.06 : 0;

        // Bloom envelope — when a shell is clicked, shellBloomRef[id] is
        // set to 0.001 (a "started" sentinel). We advance it as an age in
        // SECONDS and produce a scale + lift envelope: scale 0 → 1.1 → 1.0
        // over ~520ms; vertical "lift off the sand" of ~10px over the
        // same window.
        const BLOOM_MS = 520;
        let bloomScale = 0;
        let bloomLift = 0;
        const bloomAge = shellBloomRef.current[sh.id] ?? 0;
        if (bloomAge > 0) {
          const newAge = bloomAge + dt * 1000;
          if (newAge >= BLOOM_MS) {
            shellBloomRef.current[sh.id] = 0;
          } else {
            shellBloomRef.current[sh.id] = newAge;
            const u = newAge / BLOOM_MS;
            // ease: 0 → 1 at 0.4 (bloom up), then 1 → 0 by 1.0 (settle)
            // amplitude = sin(u*π) — a single hump
            const env = Math.sin(u * Math.PI);
            bloomScale = env * 0.16; // up to +16% size at peak
            bloomLift = env * 10;    // up to 10px lift
          }
        }

        const scale = shellScaleBase * (1 + hover + pop * 0.12 + bloomScale);
        el.setAttribute("transform", `translate(${px} ${py - bloomLift}) scale(${scale})`);
        // bloom adds a soft opacity halo via an inline filter — we
        // toggle a CSS class for prefers-reduced-motion compatibility,
        // and let the SVG group's opacity ride the bloom amount.
        if (bloomScale > 0) {
          el.setAttribute("filter", `drop-shadow(0 0 ${(8 * (bloomScale / 0.16)).toFixed(1)}px rgba(248, 236, 220, 0.85))`);
        } else if (el.hasAttribute("filter")) {
          el.removeAttribute("filter");
        }
      });

      // inscription auto-clear
      const ins = inscriptionRef.current;
      if (ins) {
        const age = now - ins.t0;
        if (age > 6200) {
          inscriptionRef.current = null;
          setInscriptionStamp((s) => s + 1);
        }
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [viewport.w, viewport.h, hoverShell]);

  // ── Dolphin / putti / ribbon animation loop ────────────────────────
  useEffect(() => {
    if (viewport.w === 0) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let raf = 0;
    const t0 = performance.now();
    let lastT = t0;

    const skyHL = viewport.h * 0.25;
    const seaHL = viewport.h * 0.25;
    const seaBottom = skyHL + seaHL;

    const tick = (now: number) => {
      const tSec = (now - t0) / 1000;
      const dt = Math.min(64, now - lastT) / 1000;
      lastT = now;
      // motion factor: under reduced-motion the arcs still happen but slower,
      // and the putto bob / ribbon sway freeze.
      const motion = reduce ? 0.25 : 1;

      // ── Dolphins ────────────────────────────────────────────────
      // The surface line is at seaBottom (bottom of the sea band, top of
      // the foam). When peakLift > 1.0 the dolphin's arc carries it
      // ABOVE the surface — the segments where y < surfaceY are airborne.
      // We compute the parametric points where the parabola crosses the
      // surface and emit ENTRY (downward crossing on the right side) and
      // EXIT (upward crossing on the left side) events with splashes +
      // a small audio click.
      const surfaceY = seaBottom; // foam top line
      for (let i = 0; i < dolphinState.current.length; i++) {
        const d = dolphinState.current[i];
        const cyclePos = (tSec * motion + d.offset) / d.period;
        const cycleIdx = Math.floor(cyclePos);
        const p = cyclePos - cycleIdx; // 0..1 within current arc

        const xStart = d.xStart * viewport.w;
        const xEnd = d.xEnd * viewport.w;
        const x = xStart + (xEnd - xStart) * p;
        // arc: parabola y = bottom - lift * 4 p (1-p); lift ~ seaH * peak
        const lift = seaHL * d.peakLift + seaHL * 0.3;
        const y = seaBottom - lift * 4 * p * (1 - p);

        const dirRight = xEnd > xStart;
        const dyDp = -lift * 4 * (1 - 2 * p);
        const dxDp = xEnd - xStart;
        const angleRad = Math.atan2(dyDp, dxDp);
        const angleDeg = (angleRad * 180) / Math.PI;
        const scaleX = dirRight ? 1 : -1;

        const g = dolphinGroupRefs.current[d.id];
        if (g) {
          g.setAttribute(
            "transform",
            `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${angleDeg.toFixed(2)}) scale(${scaleX} 1)`,
          );
        }

        // Compute surface-crossing parameters. The parabola y(p) crosses
        // surfaceY when 4*lift*p*(1-p) > seaBottom - surfaceY = 0 (since
        // surfaceY === seaBottom), i.e. for ANY p in (0,1). But we want
        // crossings of a TRUE surface line that sits a hair below the
        // peakLift threshold. Use a virtual "skin" at the foam top + a
        // small bias so we only fire splashes during a clean break.
        const SKIN_BIAS = 4; // px below seaBottom (foam line)
        // y goes upward → we treat "above the surface" as y < seaBottom - SKIN_BIAS.
        const aboveSurface = y < seaBottom - SKIN_BIAS;
        // Compute previous-step elevation cheaply: a dt back (mirroring
        // the same motion scaling used to compute p above).
        const pPrev = Math.max(0, p - (dt * motion) / d.period);
        const yPrev = seaBottom - lift * 4 * pPrev * (1 - pPrev);
        const wasAbove = yPrev < seaBottom - SKIN_BIAS;

        const spawnSplash = (sx: number, kind: "entry" | "exit") => {
          const sy = seaBottom + 4;
          const id = splashIdRef.current++;
          setSplashes((prev) => {
            const live = prev.filter((s) => now - s.born < s.life);
            return [...live, { id, x: sx, y: sy, born: now, life: 900 }];
          });
          // small ripple in the water shader (so the surface visibly bends)
          waterRipplesRef.current.push({ x: sx, y: seaHL - 4, t0: now, strength: 12 });
          if (waterRipplesRef.current.length > 16) waterRipplesRef.current.shift();
          // spawn a foam tongue at the splash x so the lap continues onto sand
          foamTonguesRef.current.push({
            id: foamTongueIdRef.current++,
            x: sx,
            width: 50 + Math.random() * 60,
            reach: 14 + Math.random() * 16,
            born: now,
            life: 1200,
          });
          if (foamTonguesRef.current.length > 24) foamTonguesRef.current.shift();
          // audio: quick noise-burst splash (use audio context if ready)
          if (!reduce) {
            const audio = getFieldAudio();
            const ctx = audio.getAudioContext();
            if (ctx) {
              const tnow = ctx.currentTime;
              // a noise burst → bandpass → fast decay = "splash"
              const bufLen = Math.floor(ctx.sampleRate * 0.15);
              const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
              const data = buf.getChannelData(0);
              for (let k = 0; k < bufLen; k++) data[k] = (Math.random() * 2 - 1) * (1 - k / bufLen);
              const src = ctx.createBufferSource();
              src.buffer = buf;
              const bp = ctx.createBiquadFilter();
              bp.type = "bandpass";
              bp.frequency.value = kind === "entry" ? 1400 : 1100;
              bp.Q.value = 1.2;
              const gn = ctx.createGain();
              gn.gain.setValueAtTime(0.0001, tnow);
              gn.gain.exponentialRampToValueAtTime(kind === "entry" ? 0.05 : 0.04, tnow + 0.005);
              gn.gain.exponentialRampToValueAtTime(0.0001, tnow + 0.18);
              src.connect(bp).connect(gn).connect(ctx.destination);
              src.start(tnow);
              src.stop(tnow + 0.2);
            }
          }
        };

        // EXIT — dolphin going UP through the surface (left side of arc)
        if (d.peakLift > 1.0 && p < 0.5 && aboveSurface && !wasAbove && d.lastExitCycle !== cycleIdx) {
          d.lastExitCycle = cycleIdx;
          spawnSplash(x, "exit");
        }
        // ENTRY — dolphin coming DOWN through the surface (right side of arc)
        if (d.peakLift > 1.0 && p > 0.5 && !aboveSurface && wasAbove && d.lastEntryCycle !== cycleIdx) {
          d.lastEntryCycle = cycleIdx;
          spawnSplash(x, "entry");
        }

        // legacy end-of-arc splash (still triggered for low-lift dolphins
        // whose arcs don't breach the surface — kept for visual variety)
        if (d.peakLift <= 1.0 && p > 0.9 && d.lastCycle !== cycleIdx) {
          d.lastCycle = cycleIdx;
          spawnSplash(x, "entry");
        }
      }

      // ── Putti drift ─────────────────────────────────────────────
      for (let i = 0; i < PUTTI.length; i++) {
        const pt = PUTTI[i];
        // accumulated "fly" displacement — integrate any active boost.
        const fly = puttoFly.current[pt.id];
        // We store an integrated boost displacement in fly.boost (px); a
        // click sets fly.flyUntil = now+2000 and we add boost while active.
        if (fly && fly.flyUntil > now) {
          // accelerate horizontally in the direction of natural drift
          const boostVx = Math.sign(pt.vx) * 220; // px/sec while flying
          fly.boost += boostVx * dt;
        }
        const flyOffset = fly ? fly.boost : 0;
        const driftX = pt.x0 * viewport.w + pt.vx * tSec * motion + flyOffset;
        const range = viewport.w + 120;
        const x = ((driftX + 60) % range + range) % range - 60;
        const baseY = skyHL * pt.altY;
        const bob = reduce ? 0 : Math.sin(tSec * pt.bobFreq + pt.bobPhase) * 5;
        // a slight upward arc while flying
        const flying = fly && fly.flyUntil > now;
        const flyArc = flying
          ? -Math.sin((1 - (fly!.flyUntil - now) / 2000) * Math.PI) * 18
          : 0;
        const y = baseY + bob + flyArc;
        const g = puttoGroupRefs.current[pt.id];
        if (g) {
          const isHover = hoverPutto === pt.id;
          const scale = (isHover ? 1.18 : 1.0) * (flying ? 1.05 : 1);
          g.setAttribute(
            "transform",
            `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${scale.toFixed(3)})`,
          );
          g.setAttribute("opacity", String(isHover ? 0.95 : flying ? 0.92 : 0.78));
        }
      }

      // ── Ribbon bezier modulation ────────────────────────────────
      // Spring-release: when the user releases a drag, decay the offsets
      // back to zero with a slight overshoot (~3s window). The overshoot
      // is a damped harmonic — 1.1 → 0.95 → 1.0 ratio against the
      // released-from values, fitted into an ease-out envelope.
      let releaseOvershoot = 0; // -1..+1, drives a small wave-amp boost
      {
        const off = ribbonOffset.current;
        if (off.releasedAt > 0) {
          const RELEASE_MS = 3000;
          const t = Math.min(1, (now - off.releasedAt) / RELEASE_MS);
          // damped harmonic: cos(t * pi * 2) * (1 - t) ≈ ~1 oscillation
          const damp = Math.pow(1 - t, 1.6);
          // residual: starts at 1, overshoots to -0.1 (i.e. +10% past zero),
          // returns to ~0.05, settles at 0.
          const residual = damp * Math.cos(t * Math.PI * 1.9);
          releaseOvershoot = damp * Math.sin(t * Math.PI * 1.9);
          const from = off.releasedFrom;
          off.c1x = from.c1x * residual;
          off.c1y = from.c1y * residual;
          off.c2x = from.c2x * residual;
          off.c2y = from.c2y * residual;
          off.sx = from.sx * residual;
          off.sy = from.sy * residual;
          off.ex = from.ex * residual;
          off.ey = from.ey * residual;
          if (t >= 1) {
            off.releasedAt = 0;
          }
        }
      }
      if (ribbonPathRef.current) {
        const W = viewport.w;
        const H = viewport.h;
        const phase = (tSec / 24) * Math.PI * 2;
        const off = ribbonOffset.current;
        const swayMx = reduce ? 0 : 1;
        const sx = W * 0.06 + off.sx;
        const sy = H * 0.18 + Math.sin(phase) * 6 * swayMx + off.sy;
        const ex = W * 0.92 + off.ex;
        const ey = H * 0.22 + Math.cos(phase * 0.9) * 6 * swayMx + off.ey;
        const c1x = W * 0.32 + Math.sin(phase + 0.6) * 18 * swayMx + off.c1x;
        const c1y = H * 0.04 + Math.cos(phase + 0.4) * 10 * swayMx + off.c1y;
        const c2x = W * 0.68 + Math.sin(phase + 1.2) * 18 * swayMx + off.c2x;
        const c2y = H * 0.06 + Math.cos(phase + 0.9) * 10 * swayMx + off.c2y;

        // ── Ripple along length (multi-segment + bezier) ──
        // Sample the smooth bezier into ~10 points, then offset each
        // sample by a small perpendicular wave so the ribbon visibly
        // ripples when dragged or released. Outside of drag/release the
        // ripple amplitude decays to a steady whisper.
        const dragging = ribbonDrag.current.active;
        // base ripple amp: while dragging, modest wave; on release adds
        // a transient lift; idle is a thin background ripple.
        const baseAmp = (dragging ? 8 : 1.4) + Math.abs(releaseOvershoot) * 14;
        const segs = 10;
        // Cubic bezier point at parameter u
        const cubic = (u: number) => {
          const mu = 1 - u;
          const bx = mu * mu * mu * sx
            + 3 * mu * mu * u * c1x
            + 3 * mu * u * u * c2x
            + u * u * u * ex;
          const by = mu * mu * mu * sy
            + 3 * mu * mu * u * c1y
            + 3 * mu * u * u * c2y
            + u * u * u * ey;
          // tangent
          const tx = 3 * (mu * mu * (c1x - sx) + 2 * mu * u * (c2x - c1x) + u * u * (ex - c2x));
          const ty = 3 * (mu * mu * (c1y - sy) + 2 * mu * u * (c2y - c1y) + u * u * (ey - c2y));
          const tl = Math.hypot(tx, ty) || 1;
          // perpendicular (normalized)
          const nx = -ty / tl;
          const ny = tx / tl;
          return { bx, by, nx, ny };
        };
        // Build the rippled path as a polyline (smooth enough at 10 segs).
        const pts: Array<{ x: number; y: number }> = [];
        for (let k = 0; k <= segs; k++) {
          const u = k / segs;
          const { bx, by, nx, ny } = cubic(u);
          // ripple modulator: a traveling wave along u, attenuated at endpoints
          const ends = Math.sin(u * Math.PI); // 0 at u=0,1 — peaks at center
          const wave = Math.sin(u * Math.PI * 3.2 + tSec * 4.0) * baseAmp * ends * swayMx;
          pts.push({ x: bx + nx * wave, y: by + ny * wave });
        }
        // smooth curve through points using cardinal-ish segments
        let dStr = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
        for (let k = 1; k < pts.length; k++) {
          const p0 = pts[k - 1];
          const p1 = pts[k];
          const midx = (p0.x + p1.x) / 2;
          const midy = (p0.y + p1.y) / 2;
          dStr += ` Q ${p0.x.toFixed(1)} ${p0.y.toFixed(1)} ${midx.toFixed(1)} ${midy.toFixed(1)}`;
        }
        dStr += ` T ${pts[pts.length - 1].x.toFixed(1)} ${pts[pts.length - 1].y.toFixed(1)}`;

        const curlA = `Q ${(ex + 30).toFixed(1)} ${(ey - 4).toFixed(1)} ${(ex + 18).toFixed(1)} ${(ey + 14).toFixed(1)}`;
        const curlB = `Q ${(ex + 8).toFixed(1)} ${(ey + 28).toFixed(1)} ${(ex + 26).toFixed(1)} ${(ey + 22).toFixed(1)}`;
        ribbonPathRef.current.setAttribute("d", `${dStr} ${curlA} ${curlB}`);
      }

      // ── GC old splashes / shimmers / stars / ripples ────────────
      // Each setX returns a new array when entries elapse, otherwise the
      // previous reference (React short-circuits — no re-render). When
      // any stars/ripples are alive we DO want a re-render per frame so
      // the SVG can recompute opacity/radius from their age; we accept
      // the cost only while they exist.
      setSplashes((prev) => {
        if (prev.length === 0) return prev;
        const next = prev.filter((s) => now - s.born < s.life);
        return next.length === prev.length ? prev : next;
      });
      setShimmers((prev) => {
        if (prev.length === 0) return prev;
        const next = prev.filter((s) => now - s.born < s.life);
        return next.length === prev.length ? prev : next;
      });
      setSkyStars((prev) => {
        if (prev.length === 0) return prev;
        // Force a fresh array each frame while stars exist (twinkle animation).
        const next = prev.filter((s) => now - s.born < s.life);
        return next.length === 0 ? next : [...next];
      });
      setSeaRipples((prev) => {
        if (prev.length === 0) return prev;
        const next = prev.filter((s) => now - s.born < s.life);
        return next.length === 0 ? next : [...next];
      });

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [viewport.w, viewport.h, hoverPutto]);

  // ── Ribbon: seed initial path so it's visible even before RAF / under reduced motion ─
  useEffect(() => {
    if (viewport.w === 0 || !ribbonPathRef.current) return;
    const W = viewport.w;
    const H = viewport.h;
    const sx = W * 0.06, sy = H * 0.18;
    const ex = W * 0.92, ey = H * 0.22;
    const c1x = W * 0.32, c1y = H * 0.04;
    const c2x = W * 0.68, c2y = H * 0.06;
    const curlA = `Q ${ex + 30} ${ey - 4} ${ex + 18} ${ey + 14}`;
    const curlB = `Q ${ex + 8} ${ey + 28} ${ex + 26} ${ey + 22}`;
    ribbonPathRef.current.setAttribute(
      "d",
      `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${ex} ${ey} ${curlA} ${curlB}`,
    );
  }, [viewport.w, viewport.h]);

  const addAphrosBurst = (x: number, y: number) => {
    const id = aphrosBurstIdRef.current++;
    const now = performance.now();
    setAphrosBursts((prev) => [...prev.slice(-7), { id, x, y, born: now }]);
    window.setTimeout(() => {
      setAphrosBursts((prev) => prev.filter((b) => b.id !== id));
    }, 1200);
  };

  // ── Putto click — send the putto flying briefly ──────────────────
  const onPuttoClick = (puttoId: number) => {
    const audio = getFieldAudio();
    const tape = useField.getState().recordTape;
    audio.chime();
    tape("object", 0.55, `putto:${puttoId}`);
    const existing = puttoFly.current[puttoId];
    puttoFly.current[puttoId] = {
      flyUntil: performance.now() + 2000,
      // preserve the accumulated boost so successive clicks compound
      // a little, but cap it so the putto can't drift offscreen forever.
      boost: existing ? Math.max(-1200, Math.min(1200, existing.boost)) : 0,
    };
    addAphrosBurst(viewport.w * 0.5, viewport.h * 0.18);
  };

  // ── Sky-band tap — plant a small twinkling star ───────────────────
  const onSkyClick = (clientX: number, clientY: number) => {
    const audio = getFieldAudio();
    const tape = useField.getState().recordTape;
    const id = skyStarIdRef.current++;
    const now = performance.now();
    setSkyStars((prev) => {
      // cull old + cap to 18 stars so the SVG doesn't keep growing
      const live = prev.filter((s) => now - s.born < s.life).slice(-17);
      return [...live, { id, x: clientX, y: clientY, born: now, life: 10000 }];
    });
    addAphrosBurst(clientX, clientY);
    audio.chime();
    tape("object", 0.4, "sky:star");
  };

  // ── Sea-band tap — spawn an expanding ripple ──────────────────────
  const onSeaClick = (clientX: number, clientY: number) => {
    const audio = getFieldAudio();
    const tape = useField.getState().recordTape;
    const id = seaRippleIdRef.current++;
    const now = performance.now();
    setSeaRipples((prev) => {
      const live = prev.filter((s) => now - s.born < s.life).slice(-14);
      return [...live, { id, x: clientX, y: clientY, born: now, life: 1400 }];
    });
    // Push into the WebGL water shader so the surface visibly bends.
    // Convert clientY to sea-band-local coords.
    const seaTopPx = viewport.h * 0.25; // skyH
    const seaY = clientY - seaTopPx;
    waterRipplesRef.current.push({ x: clientX, y: seaY, t0: now, strength: 18 });
    if (waterRipplesRef.current.length > 16) waterRipplesRef.current.shift();
    addAphrosBurst(clientX, clientY);
    audio.chime();
    tape("ripple", 0.45, "sea");
  };

  // ── Foam-band pointer overlay handlers ────────────────────────────
  // The overlay sits above the foam canvas (which has pointer-events: none).
  // We translate the cursor into foam-band-local coordinates and let the
  // bubble array decide whether to swell or pop a bubble.
  const foamBandTopRef = useRef(0); // updated in render to viewport-relative top
  const onFoamMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const top = foamBandTopRef.current;
    const lx = e.clientX;
    const ly = e.clientY - top;
    // swell any bubble within range of the cursor
    const bubbles = bubblesRef.current;
    for (const b of bubbles) {
      if (b.pop > 0) continue;
      const d = Math.hypot(b.x - lx, b.y - ly);
      if (d < b.r + 14) {
        b.swell = 1;
      }
    }
  };
  const onFoamClick = (e: React.PointerEvent<HTMLDivElement>) => {
    const top = foamBandTopRef.current;
    const lx = e.clientX;
    const ly = e.clientY - top;
    const bubbles = bubblesRef.current;
    // find the nearest bubble within a small radius and pop it
    let best: FoamBubble | null = null;
    let bestD = Infinity;
    for (const b of bubbles) {
      if (b.pop > 0) continue;
      const d = Math.hypot(b.x - lx, b.y - ly);
      if (d < (b.r + 16) && d < bestD) {
        best = b;
        bestD = d;
      }
    }
    if (best) {
      best.pop = 0.001;
      const audio = getFieldAudio();
      const tape = useField.getState().recordTape;
      // a higher-pitched thud via a quick custom one-shot through the audio
      // context.  Falls back to the default thud when no context yet.
      const ctx = audio.getAudioContext();
      if (ctx) {
        const tnow = ctx.currentTime;
        // randomized "thup" — sine pluck around 320-460Hz
        const f0 = 360 + Math.random() * 110;
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(f0, tnow);
        osc.frequency.exponentialRampToValueAtTime(80, tnow + 0.18);
        const gnode = ctx.createGain();
        gnode.gain.setValueAtTime(0.0001, tnow);
        gnode.gain.exponentialRampToValueAtTime(0.07, tnow + 0.008);
        gnode.gain.exponentialRampToValueAtTime(0.0001, tnow + 0.22);
        osc.connect(gnode).connect(ctx.destination);
        osc.start(tnow);
        osc.stop(tnow + 0.26);
      } else {
        audio.thud();
      }
      tape("ripple", 0.35, "foam:pop");
    }
  };

  // ── Sand-trail drawing ────────────────────────────────────────────
  // Pointer drag across the sand band draws faint marks to sandTrailRef.
  // The marks fade over ~8s — every render frame we apply a low-alpha
  // black-out wipe.  A short RAF inside this effect handles that wipe.
  const sandDrawing = useRef<{
    active: boolean;
    pointerId: number | null;
    lastX: number;
    lastY: number;
  }>({ active: false, pointerId: null, lastX: 0, lastY: 0 });
  const sandBandTopRef = useRef(0);

  useEffect(() => {
    const cv = sandTrailRef.current;
    if (!cv || viewport.w === 0) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = viewport.w;
    const h = Math.max(1, Math.floor(viewport.h * 0.38));
    cv.width = w * dpr;
    cv.height = h * dpr;
    cv.style.width = `${w}px`;
    cv.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let raf = 0;
    const tick = (now: number) => {
      // exponential fade — wipe with a low-alpha background-color rect that
      // mimics the underlying sand wash so wet-sand trails decay back into
      // the dry sand. Slowed down (~12s full fade) so wet patches read.
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,0.012)";
      ctx.fillRect(0, 0, w, h);
      ctx.restore();

      // Sand impressions — soft dark depressions where the user
      // long-pressed. Drawn each frame so age can drive alpha decay.
      for (let i = sandImpressionsRef.current.length - 1; i >= 0; i--) {
        const ip = sandImpressionsRef.current[i];
        const age = (now - ip.born) / ip.life;
        if (age >= 1) {
          sandImpressionsRef.current.splice(i, 1);
          continue;
        }
        const alpha = (1 - age) * 0.32;
        const grad = ctx.createRadialGradient(ip.x, ip.y, 0, ip.x, ip.y, ip.r);
        grad.addColorStop(0, `rgba(70, 50, 32, ${alpha})`);
        grad.addColorStop(0.7, `rgba(82, 60, 38, ${alpha * 0.55})`);
        grad.addColorStop(1, "rgba(80, 58, 36, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(ip.x, ip.y, ip.r, 0, Math.PI * 2);
        ctx.fill();
        // rim highlight (cream) so the depression reads as having an edge
        ctx.strokeStyle = `rgba(255, 248, 230, ${alpha * 0.45})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(ip.x, ip.y - ip.r * 0.18, ip.r * 0.9, Math.PI * 0.85, Math.PI * 2.15);
        ctx.stroke();
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [viewport.w, viewport.h]);

  // Wet-sand trail — layered translucent strokes simulate a wet path
  // that's darker than surrounding dry sand. Multiple drags layer.
  const drawSandMark = (lx: number, ly: number, lastX: number, lastY: number) => {
    const cv = sandTrailRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Wet-sand halo: broad, very translucent (damp spreading)
    ctx.lineWidth = 14;
    ctx.strokeStyle = "rgba(60, 44, 30, 0.10)";
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(lx, ly);
    ctx.stroke();

    // Wet-sand core: the actually-darker stroke
    ctx.lineWidth = 7;
    ctx.strokeStyle = "rgba(75, 52, 32, 0.22)";
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(lx, ly);
    ctx.stroke();

    // raised-lip highlight (one side catches cream light)
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = "rgba(255, 248, 230, 0.22)";
    ctx.beginPath();
    ctx.moveTo(lastX + 0.5, lastY - 1.4);
    ctx.lineTo(lx + 0.5, ly - 1.4);
    ctx.stroke();

    // deepest groove streak
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "rgba(50, 36, 24, 0.30)";
    ctx.beginPath();
    ctx.moveTo(lastX, lastY + 0.4);
    ctx.lineTo(lx, ly + 0.4);
    ctx.stroke();
  };

  const onSandDown = (e: React.PointerEvent<HTMLDivElement>) => {
    sandDrawing.current.active = true;
    sandDrawing.current.pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY - sandBandTopRef.current;
    sandDrawing.current.lastX = startX;
    sandDrawing.current.lastY = startY;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
    // Long-press timer — if the pointer stays roughly still for 600ms,
    // record a sand impression (depression) at this point. Movement
    // cancels the timer (in onSandMove).
    if (sandPressTimerRef.current !== null) {
      window.clearTimeout(sandPressTimerRef.current);
    }
    sandPressTimerRef.current = window.setTimeout(() => {
      sandImpressionsRef.current.push({
        id: sandImpressionIdRef.current++,
        x: startX,
        y: startY,
        r: 18 + Math.random() * 10,
        born: performance.now(),
        life: 6000,
      });
      if (sandImpressionsRef.current.length > 14) sandImpressionsRef.current.shift();
      // soft thud audio so the user knows their press made a mark
      const audio = getFieldAudio();
      audio.thud();
      useField.getState().recordTape("object", 0.4, "sand:impression");
      sandPressTimerRef.current = null;
    }, 600);
  };
  const onSandMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!sandDrawing.current.active) return;
    const lx = e.clientX;
    const ly = e.clientY - sandBandTopRef.current;
    const dx = lx - sandDrawing.current.lastX;
    const dy = ly - sandDrawing.current.lastY;
    // movement > 4px cancels the pending long-press impression
    if (sandPressTimerRef.current !== null && Math.hypot(dx, dy) > 4) {
      window.clearTimeout(sandPressTimerRef.current);
      sandPressTimerRef.current = null;
    }
    drawSandMark(lx, ly, sandDrawing.current.lastX, sandDrawing.current.lastY);
    sandDrawing.current.lastX = lx;
    sandDrawing.current.lastY = ly;
  };
  const onSandUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!sandDrawing.current.active) return;
    sandDrawing.current.active = false;
    if (sandPressTimerRef.current !== null) {
      window.clearTimeout(sandPressTimerRef.current);
      sandPressTimerRef.current = null;
    }
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  };

  // ── Ribbon drag handlers — re-curve the ribbon on drag, spring back on release ─
  const onRibbonDown = (e: React.PointerEvent<SVGPathElement>) => {
    ribbonDrag.current.active = true;
    ribbonDrag.current.pointerId = e.pointerId;
    ribbonDrag.current.lastX = e.clientX;
    ribbonDrag.current.lastY = e.clientY;
    // cancel any in-progress release spring so the new drag starts fresh
    ribbonOffset.current.releasedAt = 0;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
  };
  const onRibbonMove = (e: React.PointerEvent<SVGPathElement>) => {
    if (!ribbonDrag.current.active) return;
    const dx = e.clientX - ribbonDrag.current.lastX;
    const dy = e.clientY - ribbonDrag.current.lastY;
    ribbonDrag.current.lastX = e.clientX;
    ribbonDrag.current.lastY = e.clientY;
    // figure out which "segment" of the ribbon we're dragging by the
    // pointer's x-fraction across the viewport.  Pulling on the middle
    // affects c1+c2 most; near the ends, the corresponding endpoint moves.
    const fx = viewport.w > 0 ? e.clientX / viewport.w : 0.5;
    const o = ribbonOffset.current;
    const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));
    if (fx < 0.2) {
      o.sx = clamp(o.sx + dx, 40);
      o.sy = clamp(o.sy + dy, 60);
    } else if (fx > 0.8) {
      o.ex = clamp(o.ex + dx, 40);
      o.ey = clamp(o.ey + dy, 60);
    } else {
      // distribute to c1 / c2 weighted by which half we're in
      const w1 = Math.max(0, 1 - Math.abs(fx - 0.32) * 3);
      const w2 = Math.max(0, 1 - Math.abs(fx - 0.68) * 3);
      const totalW = w1 + w2 || 1;
      o.c1x = clamp(o.c1x + dx * (w1 / totalW), 90);
      o.c1y = clamp(o.c1y + dy * (w1 / totalW), 80);
      o.c2x = clamp(o.c2x + dx * (w2 / totalW), 90);
      o.c2y = clamp(o.c2y + dy * (w2 / totalW), 80);
    }
  };
  const onRibbonUp = (e: React.PointerEvent<SVGPathElement>) => {
    if (!ribbonDrag.current.active) return;
    ribbonDrag.current.active = false;
    const o = ribbonOffset.current;
    o.releasedAt = performance.now();
    o.releasedFrom = {
      c1x: o.c1x, c1y: o.c1y, c2x: o.c2x, c2y: o.c2y,
      sx: o.sx, sy: o.sy, ex: o.ex, ey: o.ey,
    };
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    const audio = getFieldAudio();
    const tape = useField.getState().recordTape;
    audio.chime();
    tape("sigil", 0.5, "ribbon");
  };

  // ── Inscription click — save it ────────────────────────────────────
  const onInscriptionClick = () => {
    const ins = inscriptionRef.current;
    if (!ins) return;
    const tape = useField.getState().recordTape;
    const audio = getFieldAudio();
    const shellId = inscriptionShellRef.current;
    audio.bell();
    tape("kept", 0.85, shellId ? `inscription/${shellId}` : "inscription");
    setPulseOn(true);
    // keep the inscription on screen a bit longer so the pulse reads
    inscriptionRef.current = { text: ins.text, t0: performance.now() - 4800 };
    setInscriptionStamp((s) => s + 1);
    // Release the pulse after the bump (CSS transition will smoothly
    // animate the scale back to 1).
    window.setTimeout(() => setPulseOn(false), 360);
  };

  // ── Dolphin click handler ──────────────────────────────────────────
  const onDolphinClick = (dolphinId: number) => {
    const audio = getFieldAudio();
    const tape = useField.getState().recordTape;
    audio.chime();
    tape("object", 0.6, "dolphin");

    const d = dolphinState.current.find((x) => x.id === dolphinId);
    if (!d) return;
    const now = performance.now();
    // Recover the dolphin's current arc position by reading the SVG transform —
    // simpler and avoids dependency on t0 / motion factor.
    const skyHL = viewport.h * 0.25;
    const seaHL = viewport.h * 0.25;
    const seaBottom = skyHL + seaHL;
    const lift = seaHL * d.peakLift + seaHL * 0.3;
    const xStart = d.xStart * viewport.w;
    const xEnd = d.xEnd * viewport.w;

    // Reconstruct p from current transform's x (linear in p).
    const g = dolphinGroupRefs.current[d.id];
    let p = 0.5;
    if (g) {
      const m = g.getAttribute("transform")?.match(/translate\(([-\d.]+)\s+([-\d.]+)\)/);
      if (m) {
        const curX = parseFloat(m[1]);
        const denom = xEnd - xStart;
        if (Math.abs(denom) > 1e-3) p = Math.max(0, Math.min(1, (curX - xStart) / denom));
      }
    }

    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < 14; i++) {
      const pp = Math.max(0, p - i * 0.025);
      const xx = xStart + (xEnd - xStart) * pp;
      const yy = seaBottom - lift * 4 * pp * (1 - pp);
      pts.push({ x: xx, y: yy });
    }

    const id = shimmerIdRef.current++;
    setShimmers((prev) => [...prev, { id, pts, born: now, life: 1100 }]);
  };

  // ── Nautilus drag handlers ─────────────────────────────────────────
  const angleFromCenter = (clientX: number, clientY: number) => {
    const cx = viewport.w / 2;
    const cy = viewport.h * 0.55;
    return Math.atan2(clientY - cy, clientX - cx);
  };

  const onNautilusDown = (e: React.PointerEvent<SVGGElement>) => {
    const target = e.currentTarget;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    drag.current.active = true;
    drag.current.pointerId = e.pointerId;
    drag.current.lastA = angleFromCenter(e.clientX, e.clientY);
    drag.current.moved = false;
    drag.current.velSamples = [];
    drag.current.centerX = viewport.w / 2;
    drag.current.centerY = viewport.h * 0.55;
    nautilusVel.current = 0;
  };

  const onNautilusMove = (e: React.PointerEvent<SVGGElement>) => {
    if (!drag.current.active) return;
    const a = angleFromCenter(e.clientX, e.clientY);
    let dA = a - drag.current.lastA;
    // unwrap
    if (dA > Math.PI) dA -= Math.PI * 2;
    if (dA < -Math.PI) dA += Math.PI * 2;
    drag.current.lastA = a;
    if (Math.abs(dA) > 0.008) drag.current.moved = true;
    nautilusRot.current += dA;
    // estimate instantaneous angular velocity (rad/sec) — assume ~60fps tick
    const inst = dA * 60;
    drag.current.velSamples.push(inst);
    if (drag.current.velSamples.length > 6) drag.current.velSamples.shift();
  };

  const onNautilusUp = (e: React.PointerEvent<SVGGElement>) => {
    if (!drag.current.active) return;
    const target = e.currentTarget;
    try {
      target.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    // fling: average of recent samples
    const samples = drag.current.velSamples;
    const avg = samples.length
      ? samples.reduce((s, v) => s + v, 0) / samples.length
      : 0;
    nautilusVel.current = avg;
    const audio = getFieldAudio();
    const tape = useField.getState().recordTape;
    if (!drag.current.moved) {
      // a click — play the nautilus note (A4) and show inscription
      audio.playNote(SHELL_NOTES.nautilus, 260);
      tape("object", 0.5, "nautilus");
      inscriptionShellRef.current = "nautilus";
      showInscription(INSCRIPTIONS.nautilus);
      popRef.current["nautilus"] = 1;
      shellBloomRef.current["nautilus"] = 0.001;
      addAphrosBurst(viewport.w / 2, viewport.h * 0.55);
    } else {
      // dragged release: tape it as a sigil; bell if high spin
      tape("sigil", 0.7, "nautilus");
      if (Math.abs(avg) > 2.4) {
        audio.bell();
      }
    }
    drag.current.active = false;
    drag.current.pointerId = null;
    drag.current.moved = false;
    drag.current.velSamples = [];
  };

  // ── Shell interactions ─────────────────────────────────────────────
  const onShellEnter = (id: ShellId, e: React.PointerEvent) => {
    setHoverShell(id);
    setHoverPos({ x: e.clientX, y: e.clientY });
  };
  const onShellMove = (id: ShellId, e: React.PointerEvent) => {
    if (hoverShell !== id) return;
    setHoverPos({ x: e.clientX, y: e.clientY });
  };
  const onShellLeave = () => {
    setHoverShell(null);
    setHoverPos(null);
  };
  const onShellClick = (id: ShellId) => {
    const audio = getFieldAudio();
    const tape = useField.getState().recordTape;
    // Each shell sounds its own pitch on the A-major-ish scale
    audio.playNote(SHELL_NOTES[id], 240);
    tape("object", 0.5, id);
    popRef.current[id] = 1;
    // bloom animation: a stronger scale + bloom envelope on the shell.
    // shellBloomRef holds an age (ms) that the RAF tick decays.
    shellBloomRef.current[id] = 0.001;
    inscriptionShellRef.current = id;
    showInscription(INSCRIPTIONS[id]);

    // Broadcast a water ripple ABOVE this shell's screen position so the
    // sea surface visibly responds. We compute the shell's current screen
    // x from its angle/radius, then push a ripple into the water shader
    // in sea-band-local (uv) coords.
    const sh = SHELLS.find((s) => s.id === id);
    if (sh) {
      const cx = viewport.w / 2;
      const narrow = viewport.w < 700;
      const radiusScale = narrow
        ? Math.max(0.55, Math.min(1, viewport.w / 720))
        : 1;
      const radius = sh.radius * radiusScale;
      const shellX = cx + Math.cos(sh.angle) * radius;
      const shellY = viewport.h * 0.55 + Math.sin(sh.angle) * radius;
      addAphrosBurst(shellX, shellY);
      // For the water ripple, the y is sea-band-local — push to the
      // bottom 40% of the sea band so the ripple sits where the surface
      // meets the shell visually.
      const seaH = viewport.h * 0.25;
      waterRipplesRef.current.push({
        x: shellX,
        y: seaH * 0.65,
        t0: performance.now(),
        strength: 8,
      });
      if (waterRipplesRef.current.length > 16) waterRipplesRef.current.shift();
    }
  };

  // Play a shell's note via the tuner pad (without changing the shown
  // inscription). Also visually pops the shell on the scene so the user
  // sees what they tapped.
  const tunerPlayShell = (id: ShellId) => {
    const audio = getFieldAudio();
    const tape = useField.getState().recordTape;
    audio.playNote(SHELL_NOTES[id], 220);
    tape("object", 0.35, `tuner:${id}`);
    popRef.current[id] = 1;
    shellBloomRef.current[id] = 0.001;
    const sh = SHELLS.find((s) => s.id === id);
    if (sh && viewport.w > 0) {
      const radiusScale = viewport.w < 700
        ? Math.max(0.55, Math.min(1, viewport.w / 720))
        : 1;
      addAphrosBurst(
        viewport.w / 2 + Math.cos(sh.angle) * sh.radius * radiusScale,
        viewport.h * 0.55 + Math.sin(sh.angle) * sh.radius * radiusScale,
      );
    }
    // append to displayed sequence; cap at 8
    setTunerSeq((prev) => [...prev, id].slice(-8));
    // clear sequence after 3s of silence
    if (tunerSeqTimerRef.current !== null) {
      window.clearTimeout(tunerSeqTimerRef.current);
    }
    tunerSeqTimerRef.current = window.setTimeout(() => {
      setTunerSeq([]);
      tunerSeqTimerRef.current = null;
    }, 3000);
  };

  const showInscription = (text: string) => {
    inscriptionRef.current = { text, t0: performance.now() };
    setInscriptionStamp((s) => s + 1);
  };

  // ── Render ─────────────────────────────────────────────────────────
  const W = viewport.w;
  const H = viewport.h;
  // band heights
  const skyH = H * 0.25;
  const seaH = H * 0.25;
  const foamH = Math.max(80, H * 0.12);
  const sandH = H * 0.38;
  const sandTop = skyH + seaH + foamH;
  const centerX = W / 2;
  const centerY = H * 0.55;

  // inscription opacity (fade in/hold/fade out) + bloom scale envelope.
  // Bloom: 0 → 1.1 (overshoot) → 1.0 within the first 400ms, then steady.
  const ins = inscriptionRef.current;
  let insOpacity = 0;
  let insScale = 1;
  if (ins) {
    const age = performance.now() - ins.t0;
    if (age < 400) insOpacity = age / 400;
    else if (age < 5400) insOpacity = 1;
    else insOpacity = Math.max(0, 1 - (age - 5400) / 1000);
    // physics-like overshoot — quick rise, brief overshoot, settle
    if (age < 140) insScale = (age / 140) * 1.1;
    else if (age < 320) insScale = 1.1 - ((age - 140) / 180) * 0.1;
    else insScale = 1;
  }

  return (
    <div
      data-touch-surface="true"
      style={{
        position: "fixed",
        inset: 0,
        background: C.skyRose,
        overflow: "hidden",
      }}
    >
      {/* sky band — gradient warms slightly when the cursor is over it */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: skyH,
          background: skyWarm
            ? `linear-gradient(180deg, #F8C6BD 0%, #F4D5C8 50%, ${C.coralSoft} 100%)`
            : `linear-gradient(180deg, ${C.skyRose} 0%, ${C.creamBone} 60%, ${C.coralSoft} 100%)`,
          transition: "background 700ms ease",
        }}
      />
      {/* aurora — WebGL pastel wisps over the sky band */}
      <canvas
        ref={auroraRef}
        aria-hidden
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: skyH,
          display: "block",
          pointerEvents: "none",
        }}
      />
      {/* sea band — WebGL water shader sits ON TOP of the band gradient
          but the shader fades out at the top so the rose horizon still
          reads through softly. The fallback gradient below remains for
          devices without WebGL — the shader's pre-multiplied alpha will
          composite cleanly on top of it. */}
      <div
        style={{
          position: "absolute",
          top: skyH,
          left: 0,
          width: "100%",
          height: seaH,
          background: `linear-gradient(180deg, rgba(191,221,216,0.85) 0%, rgba(163,207,203,0.75) 60%, rgba(232,180,164,0.45) 100%)`,
        }}
      />
      <canvas
        ref={waterRef}
        aria-hidden
        style={{
          position: "absolute",
          top: skyH,
          left: 0,
          width: "100%",
          height: seaH,
          display: "block",
          pointerEvents: "none",
        }}
      />
      {/* foam band — canvas */}
      <canvas
        ref={foamRef}
        aria-hidden
        style={{
          position: "absolute",
          top: skyH + seaH,
          left: 0,
          width: "100%",
          height: foamH,
          display: "block",
          pointerEvents: "none",
        }}
      />
      {/* sand band — canvas with grain */}
      <canvas
        ref={sandRef}
        aria-hidden
        style={{
          position: "absolute",
          top: sandTop,
          left: 0,
          width: "100%",
          height: sandH,
          display: "block",
          pointerEvents: "none",
        }}
      />
      {/* sand-trail canvas — captures finger marks on top of the grain */}
      <canvas
        ref={sandTrailRef}
        aria-hidden
        style={{
          position: "absolute",
          top: sandTop,
          left: 0,
          width: "100%",
          height: sandH,
          display: "block",
          pointerEvents: "none",
        }}
      />

      {/* ── Band-level pointer overlays ──────────────────────────────
          Each band is its own transparent <div> sitting above the band
          canvas but BELOW the scene SVG (so shells/nautilus still win
          hit-testing). Each handles its own pointer kind.
      */}
      {/* sky band overlay — hover warms, click plants a star */}
      <div
        onPointerEnter={() => setSkyWarm(true)}
        onPointerLeave={() => setSkyWarm(false)}
        onClick={(e) => onSkyClick(e.clientX, e.clientY)}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: skyH,
          cursor: "crosshair",
          touchAction: "none",
        }}
      />
      {/* sea band overlay — tap to ripple */}
      <div
        onClick={(e) => onSeaClick(e.clientX, e.clientY)}
        style={{
          position: "absolute",
          top: skyH,
          left: 0,
          width: "100%",
          height: seaH,
          cursor: "crosshair",
          touchAction: "none",
        }}
      />
      {/* foam band overlay — hover to swell, click to pop */}
      <div
        ref={(el) => {
          if (el) foamBandTopRef.current = skyH + seaH;
        }}
        onPointerMove={onFoamMove}
        onClick={onFoamClick}
        style={{
          position: "absolute",
          top: skyH + seaH,
          left: 0,
          width: "100%",
          height: foamH,
          cursor: "crosshair",
          touchAction: "none",
        }}
      />
      {/* sand band overlay — drag to draw finger marks */}
      <div
        ref={(el) => {
          if (el) sandBandTopRef.current = sandTop;
        }}
        onPointerDown={onSandDown}
        onPointerMove={onSandMove}
        onPointerUp={onSandUp}
        onPointerCancel={onSandUp}
        style={{
          position: "absolute",
          top: sandTop,
          left: 0,
          width: "100%",
          height: sandH,
          cursor: "crosshair",
          touchAction: "none",
        }}
      />

      {/* SVG overlays for sky stars + sea ripples */}
      {W > 0 && (
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            display: "block",
            pointerEvents: "none",
          }}
        >
          {skyStars.map((s) => {
            const age = (performance.now() - s.born) / s.life;
            if (age >= 1) return null;
            // twinkle: a few opacity peaks during life
            const tw = 0.6 + 0.4 * Math.sin(performance.now() / 220 + s.id);
            const fade = age < 0.85 ? 1 : 1 - (age - 0.85) / 0.15;
            return (
              <g key={`star-${s.id}`}>
                <circle cx={s.x} cy={s.y} r={2.2} fill="#FFFCF0" opacity={0.8 * tw * fade} />
                <circle cx={s.x} cy={s.y} r={1.0} fill="#FFFFFF" opacity={fade} />
              </g>
            );
          })}
          {seaRipples.map((r) => {
            const age = (performance.now() - r.born) / r.life;
            if (age >= 1) return null;
            const radius = 4 + age * 60;
            const a = (1 - age) * 0.55;
            return (
              <circle
                key={`ripple-${r.id}`}
                cx={r.x}
                cy={r.y}
                r={radius}
                fill="none"
                stroke={C.pearl}
                strokeWidth={1.2}
                opacity={a}
              />
            );
          })}
        </svg>
      )}

      <div aria-hidden className="aphros-burst-layer">
        {aphrosBursts.map((b) => (
          <span
            key={`aphros-burst-${b.id}`}
            className="aphros-burst"
            style={{ left: b.x, top: b.y } as React.CSSProperties}
          >
            {Array.from({ length: 8 }).map((_, i) => (
              <i
                key={i}
                style={{
                  transform: `rotate(${i * 45}deg) translateY(-1px)`,
                  animationDelay: `${i * 24}ms`,
                }}
              />
            ))}
          </span>
        ))}
      </div>

      {/* title — pushed down to clear the top Greek-key banner */}
      <div
        style={{
          position: "absolute",
          top: Math.max(skyH * 0.18, 52),
          left: 0,
          right: 0,
          textAlign: "center",
          pointerEvents: "none",
          color: C.ink,
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
            fontSize: "clamp(48px, 7vw, 96px)",
            letterSpacing: "0.12em",
            lineHeight: 1,
          }}
        >
          APHROS
        </WaterText>
        <WaterText
          as="div"
          bobAmp={2}
          style={{
            display: "block",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "clamp(14px, 1.4vw, 18px)",
            letterSpacing: "0.02em",
            marginTop: 8,
            color: "rgba(107, 74, 63, 0.75)",
          }}
        >
          born of foam — the body of love
        </WaterText>
      </div>

      {/* ── Galatea overlay: ribbon + putti + dolphins ──────────────
          Placed BETWEEN backgrounds and the main scene SVG.
          The main scene SVG below renders later in the DOM, so shells
          naturally win z-order and hit-testing. This overlay has
          pointer-events: none by default; individual interactive
          children (dolphins, putti) re-enable pointer events.
      */}
      {W > 0 && (
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            display: "block",
            pointerEvents: "none",
          }}
        >
          <defs>
            {/* Galatea sash gradient — coral fading to warm umber */}
            <linearGradient id="aphros-ribbon" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={C.coralSoft} stopOpacity={0.0} />
              <stop offset="15%" stopColor={C.coralSoft} stopOpacity={0.9} />
              <stop offset="60%" stopColor={C.coralSoft} stopOpacity={0.8} />
              <stop offset="100%" stopColor={C.ribbonUmber} stopOpacity={0.85} />
            </linearGradient>
          </defs>

          {/* The Galatea sash — draggable; releases spring back over 3s.
              The stroke is fat (14px) for fingertip-friendly hit area. */}
          <path
            ref={ribbonPathRef}
            d=""
            stroke="url(#aphros-ribbon)"
            strokeWidth={14}
            strokeLinecap="round"
            fill="none"
            opacity={0.3}
            style={{ pointerEvents: "stroke", cursor: "grab", touchAction: "none" } as React.CSSProperties}
            onPointerDown={onRibbonDown}
            onPointerMove={onRibbonMove}
            onPointerUp={onRibbonUp}
            onPointerCancel={onRibbonUp}
          />
          {/* Putti — small drifting cherub glyphs in the sky band */}
          {PUTTI.map((pt) => {
            // ribbon shape: a curling tail in the wind direction
            // path is centered on (0,0) — the body sits at origin
            const dir = pt.ribbonDir;
            const tailD = `M ${dir * pt.r * 0.7} ${pt.r * 0.1}
                           Q ${dir * pt.r * 2.0} ${-pt.r * 0.4},
                             ${dir * pt.r * 2.6} ${pt.r * 0.6}
                           Q ${dir * pt.r * 3.2} ${pt.r * 1.2},
                             ${dir * pt.r * 2.4} ${pt.r * 1.4}`;
            return (
              <g
                key={`putto-${pt.id}`}
                ref={(el) => {
                  puttoGroupRefs.current[pt.id] = el;
                }}
                style={{ pointerEvents: "auto", cursor: "pointer" } as React.CSSProperties}
                onPointerEnter={() => setHoverPutto(pt.id)}
                onPointerLeave={() => setHoverPutto(null)}
                onClick={() => onPuttoClick(pt.id)}
              >
                {/* drapery ribbon (in the wind) */}
                <path
                  d={tailD}
                  stroke={C.puttoRibbon}
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  fill="none"
                  opacity={0.7}
                />
                {/* a softer parallel ribbon for depth */}
                <path
                  d={tailD}
                  stroke={C.coralSoft}
                  strokeWidth={1.0}
                  strokeLinecap="round"
                  fill="none"
                  opacity={0.55}
                  transform={`translate(0 ${pt.r * 0.25})`}
                />
                {/* body — a pearl circle with a faint highlight */}
                <circle r={pt.r} fill={C.puttoBody} opacity={0.92} />
                <circle
                  cx={-pt.r * 0.28}
                  cy={-pt.r * 0.32}
                  r={pt.r * 0.32}
                  fill="rgba(255,255,250,0.7)"
                />
                {/* faint ink halo — sketched, not drawn */}
                <circle
                  r={pt.r * 1.15}
                  fill="none"
                  stroke={C.coralSoft}
                  strokeWidth={0.6}
                  opacity={0.35}
                />
              </g>
            );
          })}

          {/* Dolphins — arcing through the sea band */}
          {DOLPHINS.map((d) => (
            <g
              key={`dolphin-${d.id}`}
              ref={(el) => {
                dolphinGroupRefs.current[d.id] = el;
              }}
              style={{ pointerEvents: "auto", cursor: "pointer" } as React.CSSProperties}
              onClick={() => onDolphinClick(d.id)}
            >
              {renderDolphin()}
            </g>
          ))}

          {/* Shimmer trails left by clicked dolphins */}
          {shimmers.map((sh) => {
            const age = (performance.now() - sh.born) / sh.life;
            const alpha = Math.max(0, 1 - age);
            return (
              <g key={`shim-${sh.id}`} style={{ pointerEvents: "none" }}>
                {sh.pts.map((p, i) => {
                  const a = alpha * (1 - i / sh.pts.length);
                  return (
                    <circle
                      key={`sh-${sh.id}-${i}`}
                      cx={p.x}
                      cy={p.y}
                      r={1.6 + (1 - i / sh.pts.length) * 1.4}
                      fill={C.pearl}
                      opacity={a * 0.85}
                    />
                  );
                })}
              </g>
            );
          })}

          {/* Splash bubbles from dolphin re-entry */}
          {splashes.map((sp) => {
            const age = (performance.now() - sp.born) / sp.life;
            const alpha = Math.max(0, 1 - age);
            const spread = age * 22;
            return (
              <g key={`splash-${sp.id}`} style={{ pointerEvents: "none" }}>
                {[0, 1, 2, 3, 4].map((k) => {
                  const ang = (k / 5) * Math.PI - Math.PI;
                  const dx = Math.cos(ang) * spread;
                  const dy = Math.sin(ang) * spread * 0.45 - age * 6;
                  return (
                    <circle
                      key={`sp-${sp.id}-${k}`}
                      cx={sp.x + dx}
                      cy={sp.y + dy}
                      r={2.0 + (1 - age) * 1.6}
                      fill="#FFFCF5"
                      opacity={alpha * 0.85}
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>
      )}

      {/* the scene SVG — nautilus + shells */}
      {W > 0 && (
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          style={{
            position: "absolute",
            inset: 0,
            display: "block",
          }}
        >
          <defs>
            {/* nautilus pearl wash */}
            <radialGradient id="aphros-pearl" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FFF8EF" stopOpacity={0.95} />
              <stop offset="60%" stopColor="#F8EDE3" stopOpacity={0.7} />
              <stop offset="100%" stopColor="#E8B4A4" stopOpacity={0.45} />
            </radialGradient>
            <radialGradient id="aphros-pearl-2" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#F4D5D0" stopOpacity={0.55} />
              <stop offset="100%" stopColor="#F4D5D0" stopOpacity={0} />
            </radialGradient>
            {/* sand dollar etching */}
            <radialGradient id="aphros-sanddollar" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#F8EDE3" />
              <stop offset="100%" stopColor="#E8DCC6" />
            </radialGradient>
          </defs>

          {/* shells: drawn first so the nautilus floats over their nearest edges */}
          {SHELLS.map((sh) => (
            <g
              key={sh.id}
              ref={(el) => {
                shellRefs.current[sh.id] = el;
              }}
              style={{ cursor: "pointer", transformBox: "fill-box" } as React.CSSProperties}
              onPointerEnter={(e) => onShellEnter(sh.id, e)}
              onPointerMove={(e) => onShellMove(sh.id, e)}
              onPointerLeave={onShellLeave}
              onClick={() => onShellClick(sh.id)}
            >
              {renderShell(sh.id, sh.size)}
            </g>
          ))}

          {/* nautilus — central spinnable. Scaled down on narrow viewports
              so it doesn't crowd the shells. */}
          <g
            ref={nautilusGroupRef}
            style={{ cursor: "grab", touchAction: "none" } as React.CSSProperties}
            onPointerDown={onNautilusDown}
            onPointerMove={onNautilusMove}
            onPointerUp={onNautilusUp}
            onPointerCancel={onNautilusUp}
          >
            {renderNautilus(W < 700 ? Math.max(120, Math.min(180, W * 0.32)) : 180)}
          </g>

          {/* faint instruction (only when idle and no inscription) */}
          {!ins && (
            <text
              x={centerX}
              y={centerY + 230}
              textAnchor="middle"
              fontFamily="var(--font-serif)"
              fontStyle="italic"
              fontSize={13}
              fill="rgba(107, 74, 63, 0.42)"
          style={{ pointerEvents: "none" }}
            >
              foam answers touch
            </text>
          )}
        </svg>
      )}

      {/* ── Shell Tuner ──────────────────────────────────────────────
          A row of 7 tiny touch-target dots above the inscription, each
          representing one of the shells around the page. Tapping them
          sequentially plays a tiny melody using each shell's note. The
          dots are sized for fingertip-friendly tapping (44×44 hit area
          with 14px visual). */}
      {W > 0 && (
        <div
          className="aphros-tuner"
          aria-label="shell tuner — tap to play a melody"
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 96,
            display: "flex",
            justifyContent: "center",
            flexWrap: "wrap",
            gap: 6,
            maxWidth: "min(560px, calc(100vw - 24px))",
            margin: "0 auto",
            pointerEvents: "auto",
            zIndex: 5,
          }}
        >
          {TUNER_ORDER.map((id) => {
            const recent = tunerSeq.length > 0 && tunerSeq[tunerSeq.length - 1] === id;
            return (
              <button
                key={`tuner-${id}`}
                type="button"
                aria-label={`play ${id} note`}
                onClick={(e) => { e.stopPropagation(); tunerPlayShell(id); }}
                onPointerDown={(e) => e.stopPropagation()}
                className="aphros-tuner-button"
                style={{
                  width: 44,
                  height: 44,
                  padding: 0,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  touchAction: "manipulation",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                <span
                  style={{
                    width: recent ? 18 : 14,
                    height: recent ? 18 : 14,
                    borderRadius: "50%",
                    background: recent
                      ? `radial-gradient(circle at 30% 30%, #FFF, ${C.coralSoft})`
                      : `radial-gradient(circle at 30% 30%, ${C.pearl}, ${C.pinkShell})`,
                    border: `1px solid ${C.ink}`,
                    boxShadow: recent
                      ? `0 0 12px ${C.coralSoft}, 0 0 2px rgba(107, 74, 63, 0.4)`
                      : "0 1px 2px rgba(107, 74, 63, 0.18)",
                    transition: "all 180ms ease",
                  }}
                />
              </button>
            );
          })}
        </div>
      )}
      {/* breadcrumb of the recently-tapped shells (the user's composed
          phrase) — fades out after 3s of inactivity. */}
      {W > 0 && tunerSeq.length > 0 && (
        <div
          aria-hidden
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 144,
            textAlign: "center",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 11,
            color: "rgba(107, 74, 63, 0.55)",
            letterSpacing: "0.04em",
            pointerEvents: "none",
            zIndex: 5,
          }}
        >
          {tunerSeq.join(" · ")}
        </div>
      )}

      {/* hover tooltip */}
      {hoverShell && hoverPos && (
        <div
          className="aphros-hover-tooltip"
          style={{
            position: "fixed",
            left: hoverPos.x + 16,
            top: hoverPos.y - 24,
            pointerEvents: "none",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 13,
            color: C.ink,
            background: "rgba(255, 252, 246, 0.86)",
            padding: "4px 9px",
            border: "1px solid rgba(107, 74, 63, 0.18)",
            maxWidth: 280,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {INSCRIPTIONS[hoverShell]}
        </div>
      )}

      {/* bottom-center inscription — clickable to "save" the inscription.
          Saving pulses the text briefly and records a `kept` tape event. */}
      <div
        // re-key on inscriptionStamp so React keeps it fresh
        key={inscriptionStamp}
        className="aphros-inscription"
        onClick={ins ? onInscriptionClick : undefined}
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 58,
          textAlign: "center",
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: 18,
          color: C.ink,
          opacity: ins ? insOpacity : 0.32,
          letterSpacing: "0.005em",
          pointerEvents: ins ? "auto" : "none",
          cursor: ins ? "pointer" : "default",
          transition: "opacity 240ms ease",
          padding: "0 var(--pad-x)",
          transform: pulseOn ? "scale(1.10)" : `scale(${insScale.toFixed(3)})`,
          willChange: "transform",
        }}
      >
        {ins ? ins.text : "listen for shells"}
      </div>

      {/* Classical Hellenic window border — a Greek key meander on all four
          sides (Minoan / Mediterranean framing). The Aphros scene wrapper is
          `position: fixed; inset: 0` and sits BEHIND the 56px sticky
          SiteHeader (z-index 30); the frame's `top: 56` offset keeps the
          upper band just below the header. The frame is rendered as a
          single component so the four bands stay continuous around each
          corner via small meander knots. */}
      {/* `bottom: 40` lifts the lower meander band ABOVE the global Tape
          strip (zIndex 28, 40px tall) so the bottom of the frame stays
          visible. Without this offset the Tape covers the lower band on
          every page that uses the frame — user has reported this twice. */}
      <GreekKeyFrame
        top={56}
        bottom={40}
        thickness={22}
        mobileThickness={16}
        strokeThickness={2}
        color="#B8693A"
        opacity={0.55}
        zIndex={4}
      />

      {/* ── Foam-intensity chart, tucked into the top-left corner. ── */}
      <div
        className="aphros-chart-wrap"
        style={{
          position: "fixed",
          left: 24,
          top: 96,
          pointerEvents: "auto",
          zIndex: 5,
        }}
      >
        <SeaChart
          variant="inline"
          mode="candles"
          title="foam · intensity"
          caption="bubbles per second"
          width={260}
          height={92}
          tickMs={0}
          source={foamSource}
          pullKey={foamChartPullKey}
          static
          feedToOcean
          tapeLabel="aphros/foam"
          upColor="#F8EDE3"
          downColor="#B8693A"
          background="rgba(248, 237, 227, 0.42)"
        />
      </div>

      <style>{`
        .aphros-burst-layer {
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 6;
        }
        .aphros-burst {
          position: absolute;
          width: 1px;
          height: 1px;
          pointer-events: none;
          animation: aphros-burst-core 900ms ease-out forwards;
        }
        .aphros-burst i {
          position: absolute;
          left: -3px;
          top: -3px;
          width: 6px;
          height: 12px;
          border-radius: 999px 999px 2px 2px;
          background: linear-gradient(180deg, rgba(255,255,255,0.95), rgba(232,180,164,0.72));
          transform-origin: 3px 3px;
          animation: aphros-burst-petal 760ms ease-out forwards;
        }
        @keyframes aphros-burst-core {
          from { opacity: 1; transform: scale(0.45); }
          to { opacity: 0; transform: scale(1.35); }
        }
        @keyframes aphros-burst-petal {
          from { opacity: 0.95; translate: 0 0; }
          to { opacity: 0; translate: 0 -34px; }
        }
        @media (max-width: 720px) {
          .aphros-chart-wrap {
            display: none !important;
          }
          .aphros-tuner {
            bottom: 76px !important;
            gap: 0 !important;
            row-gap: 0 !important;
          }
          .aphros-tuner-button {
            width: 40px !important;
            height: 38px !important;
          }
          .aphros-inscription {
            bottom: 48px !important;
            font-size: 15px !important;
            padding: 0 16px !important;
          }
          .aphros-hover-tooltip {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}

// ── Nautilus geometry ────────────────────────────────────────────────
function renderNautilus(diameter: number) {
  const R = diameter / 2;
  // logarithmic spiral: r = a * e^(b * theta), b ≈ 0.306 (golden)
  const b = 0.306;
  // choose a so spiral fills the disk after ~3 full turns
  const turns = 3.2;
  const thetaMax = turns * Math.PI * 2;
  const a = R / Math.exp(b * thetaMax);

  // sample the spiral
  const steps = 240;
  const pts: Array<{ x: number; y: number; r: number; theta: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * thetaMax;
    const r = a * Math.exp(b * theta);
    pts.push({ x: Math.cos(theta) * r, y: Math.sin(theta) * r, r, theta });
  }
  const path = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ");

  // chamber radial lines: 14 chambers along the outer turn or so
  const chambers: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  const chamberCount = 14;
  const chamberStart = thetaMax - Math.PI * 2 * 2.0; // last two turns get chambers
  for (let i = 0; i < chamberCount; i++) {
    const theta = chamberStart + (i / chamberCount) * (thetaMax - chamberStart);
    const rOuter = a * Math.exp(b * theta);
    const rInner = rOuter * 0.55;
    chambers.push({
      x1: Math.cos(theta) * rInner,
      y1: Math.sin(theta) * rInner,
      x2: Math.cos(theta) * rOuter,
      y2: Math.sin(theta) * rOuter,
    });
  }

  // outer-chamber "tiger stripes": short umber arcs radiating from spiral edge
  const stripes: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  const stripeCount = 22;
  for (let i = 0; i < stripeCount; i++) {
    const theta = thetaMax - Math.PI * 2 * 1.2 + (i / stripeCount) * Math.PI * 2 * 1.2;
    if (theta > thetaMax) continue;
    const rOuter = a * Math.exp(b * theta);
    const rEdge = rOuter * 1.08;
    const rInner = rOuter * 0.86;
    stripes.push({
      x1: Math.cos(theta) * rInner,
      y1: Math.sin(theta) * rInner,
      x2: Math.cos(theta) * rEdge,
      y2: Math.sin(theta) * rEdge,
    });
  }

  return (
    <g>
      {/* outer pearl disc */}
      <circle r={R * 1.05} fill="url(#aphros-pearl)" />
      <circle r={R * 0.88} fill="url(#aphros-pearl-2)" />
      {/* shadow under spiral */}
      <circle r={R * 0.92} fill="rgba(255,248,239,0.35)" />
      {/* iridescent offset layers */}
      <path d={path} stroke="rgba(244, 213, 208, 0.45)" strokeWidth={2.6} fill="none" transform="translate(1.5 -1)" />
      <path d={path} stroke="rgba(232, 180, 164, 0.55)" strokeWidth={2.2} fill="none" transform="translate(-1 0.8)" />
      <path d={path} stroke={C.ink} strokeWidth={1.2} fill="none" />
      {/* chamber radials */}
      {chambers.map((c, i) => (
        <line
          key={`ch-${i}`}
          x1={c.x1}
          y1={c.y1}
          x2={c.x2}
          y2={c.y2}
          stroke={C.ink}
          strokeOpacity={0.55}
          strokeWidth={0.9}
        />
      ))}
      {/* tiger stripes (warm umber) */}
      {stripes.map((s, i) => (
        <line
          key={`st-${i}`}
          x1={s.x1}
          y1={s.y1}
          x2={s.x2}
          y2={s.y2}
          stroke={C.nautilusStripe}
          strokeOpacity={0.78}
          strokeWidth={2.2}
          strokeLinecap="round"
        />
      ))}
      {/* opening lip — a small accent on the outer end */}
      <circle
        cx={pts[pts.length - 1].x * 0.96}
        cy={pts[pts.length - 1].y * 0.96}
        r={6}
        fill={C.pinkShell}
        opacity={0.7}
      />
      {/* spiral center bead */}
      <circle r={2.4} fill={C.ink} opacity={0.55} />
    </g>
  );
}

// ── Shell renderers ──────────────────────────────────────────────────
function renderShell(id: ShellId, size: number): JSX.Element {
  switch (id) {
    case "scallop":
      return renderScallop(size);
    case "conch":
      return renderConch(size);
    case "starfish":
      return renderStarfish(size);
    case "sanddollar":
      return renderSandDollar(size);
    case "murex":
      return renderMurex(size);
    case "cowrie":
      return renderCowrie(size);
    case "auger":
      return renderAuger(size);
    case "nautilus":
      return <g />;
    default:
      return <g />;
  }
}

function renderScallop(size: number): JSX.Element {
  const R = size / 2;
  // fan shape: arc on top, hinge at bottom
  const ridges = 9;
  const ridgeLines: JSX.Element[] = [];
  for (let i = 1; i < ridges; i++) {
    const t = i / ridges;
    const ang = -Math.PI + t * Math.PI; // -π → 0 (top arc)
    ridgeLines.push(
      <line
        key={`r-${i}`}
        x1={0}
        y1={R * 0.5}
        x2={Math.cos(ang) * R}
        y2={Math.sin(ang) * R + R * 0.05}
        stroke={C.ink}
        strokeOpacity={0.35}
        strokeWidth={0.8}
      />,
    );
  }
  return (
    <g>
      <path
        d={`M ${-R} ${R * 0.5} A ${R} ${R} 0 0 1 ${R} ${R * 0.5} L 0 ${R * 0.62} Z`}
        fill={C.pinkShell}
        stroke={C.ink}
        strokeOpacity={0.6}
        strokeWidth={1}
      />
      {/* coral wash */}
      <path
        d={`M ${-R * 0.85} ${R * 0.45} A ${R * 0.85} ${R * 0.85} 0 0 1 ${R * 0.85} ${R * 0.45} L 0 ${R * 0.55} Z`}
        fill={C.coralSoft}
        opacity={0.5}
      />
      {ridgeLines}
      {/* hinge */}
      <circle cx={0} cy={R * 0.55} r={3} fill={C.nautilusStripe} opacity={0.6} />
    </g>
  );
}

function renderConch(size: number): JSX.Element {
  const R = size / 2;
  // a cone with a curl at one end — drawn as a teardrop with a spiral
  const path = `M ${-R} 0 Q ${-R * 0.5} ${-R * 0.7}, ${R * 0.2} ${-R * 0.6} Q ${R} ${-R * 0.3}, ${R * 0.95} 0 Q ${R} ${R * 0.3}, ${R * 0.3} ${R * 0.55} Q ${-R * 0.4} ${R * 0.7}, ${-R} 0 Z`;
  // spiral marks on left
  const spirals: JSX.Element[] = [];
  for (let i = 0; i < 4; i++) {
    const r = R * (0.18 + i * 0.08);
    spirals.push(
      <ellipse
        key={`s-${i}`}
        cx={-R * 0.5}
        cy={0}
        rx={r * 0.55}
        ry={r}
        stroke={C.ink}
        strokeOpacity={0.3}
        strokeWidth={0.7}
        fill="none"
      />,
    );
  }
  return (
    <g>
      <path d={path} fill={C.coralSoft} stroke={C.ink} strokeOpacity={0.55} strokeWidth={1} />
      <path
        d={`M ${-R * 0.9} ${R * 0.05} Q ${-R * 0.5} ${-R * 0.4}, ${R * 0.1} ${-R * 0.45} Q ${R * 0.7} ${-R * 0.15}, ${R * 0.85} ${R * 0.05}`}
        fill="none"
        stroke={C.pinkShell}
        strokeOpacity={0.8}
        strokeWidth={2}
      />
      {spirals}
      {/* opening lip */}
      <path
        d={`M ${R * 0.6} ${-R * 0.2} Q ${R * 0.95} 0, ${R * 0.5} ${R * 0.35}`}
        fill="none"
        stroke={C.ink}
        strokeOpacity={0.45}
        strokeWidth={1}
      />
    </g>
  );
}

function renderStarfish(size: number): JSX.Element {
  const R = size / 2;
  // 5-point star path
  const arms = 5;
  const inner = R * 0.42;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < arms * 2; i++) {
    const r = i % 2 === 0 ? R : inner;
    const a = (i / (arms * 2)) * Math.PI * 2 - Math.PI / 2;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  // round the points with a Q midpoint for a stubby starfish
  let d = "";
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i === 0) d += `M ${p[0].toFixed(1)} ${p[1].toFixed(1)} `;
    else d += `L ${p[0].toFixed(1)} ${p[1].toFixed(1)} `;
  }
  d += "Z";
  // bumps on the arms
  const bumps: JSX.Element[] = [];
  for (let arm = 0; arm < arms; arm++) {
    const a = (arm / arms) * Math.PI * 2 - Math.PI / 2;
    for (let j = 1; j <= 4; j++) {
      const t = j / 5;
      const r = inner + (R - inner) * t * 0.86;
      bumps.push(
        <circle
          key={`b-${arm}-${j}`}
          cx={Math.cos(a) * r}
          cy={Math.sin(a) * r}
          r={1.6}
          fill={C.nautilusStripe}
          opacity={0.55}
        />,
      );
    }
  }
  return (
    <g>
      <path d={d} fill={C.ochreWarm} stroke={C.ink} strokeOpacity={0.55} strokeWidth={1} />
      {/* a wash of warmer coral in the middle */}
      <circle r={R * 0.28} fill={C.coralSoft} opacity={0.5} />
      {bumps}
    </g>
  );
}

function renderSandDollar(size: number): JSX.Element {
  const R = size / 2;
  // 5-petal flower in the middle
  const petals: JSX.Element[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const cx = Math.cos(a) * R * 0.28;
    const cy = Math.sin(a) * R * 0.28;
    petals.push(
      <ellipse
        key={`p-${i}`}
        cx={cx}
        cy={cy}
        rx={R * 0.10}
        ry={R * 0.26}
        transform={`rotate(${(a * 180) / Math.PI + 90} ${cx} ${cy})`}
        stroke={C.ink}
        strokeOpacity={0.32}
        strokeWidth={0.7}
        fill="rgba(232, 220, 198, 0.4)"
      />,
    );
  }
  return (
    <g>
      <circle r={R} fill="url(#aphros-sanddollar)" stroke={C.ink} strokeOpacity={0.45} strokeWidth={0.9} />
      {/* edge fleck dots */}
      {Array.from({ length: 28 }).map((_, i) => {
        const a = (i / 28) * Math.PI * 2;
        return (
          <circle
            key={`e-${i}`}
            cx={Math.cos(a) * R * 0.92}
            cy={Math.sin(a) * R * 0.92}
            r={0.7}
            fill={C.ink}
            opacity={0.3}
          />
        );
      })}
      {petals}
      {/* center hole */}
      <circle r={R * 0.06} fill={C.ink} opacity={0.35} />
    </g>
  );
}

function renderMurex(size: number): JSX.Element {
  const R = size / 2;
  // twisted spiral body
  const path = `M ${-R * 0.85} ${R * 0.1} Q ${-R * 0.4} ${-R * 0.85}, ${R * 0.25} ${-R * 0.6} Q ${R * 0.95} ${-R * 0.1}, ${R * 0.75} ${R * 0.45} Q ${R * 0.1} ${R * 0.85}, ${-R * 0.6} ${R * 0.5} Q ${-R} ${R * 0.25}, ${-R * 0.85} ${R * 0.1} Z`;
  // spines
  const spines: JSX.Element[] = [];
  const spineCount = 10;
  for (let i = 0; i < spineCount; i++) {
    const a = (i / spineCount) * Math.PI * 2;
    const r1 = R * 0.78;
    const r2 = R * 1.08;
    spines.push(
      <line
        key={`sp-${i}`}
        x1={Math.cos(a) * r1}
        y1={Math.sin(a) * r1}
        x2={Math.cos(a) * r2}
        y2={Math.sin(a) * r2}
        stroke={C.ink}
        strokeOpacity={0.55}
        strokeWidth={1.4}
        strokeLinecap="round"
      />,
    );
  }
  // deeper pink stripes radiating
  const stripes: JSX.Element[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.15;
    stripes.push(
      <line
        key={`mst-${i}`}
        x1={Math.cos(a) * R * 0.2}
        y1={Math.sin(a) * R * 0.2}
        x2={Math.cos(a) * R * 0.78}
        y2={Math.sin(a) * R * 0.78}
        stroke={C.nautilusStripe}
        strokeOpacity={0.5}
        strokeWidth={2}
      />,
    );
  }
  return (
    <g>
      <path d={path} fill={C.pinkShell} stroke={C.ink} strokeOpacity={0.55} strokeWidth={1} />
      {stripes}
      {spines}
      {/* center swirl */}
      <circle r={R * 0.22} fill={C.coralSoft} opacity={0.75} />
      <circle r={R * 0.08} fill={C.ink} opacity={0.35} />
    </g>
  );
}

function renderCowrie(size: number): JSX.Element {
  const R = size / 2;
  // smooth oval
  return (
    <g>
      <ellipse
        cx={0}
        cy={0}
        rx={R}
        ry={R * 0.62}
        fill={C.pearl}
        stroke={C.ink}
        strokeOpacity={0.5}
        strokeWidth={1}
      />
      {/* pearly highlight */}
      <ellipse
        cx={-R * 0.2}
        cy={-R * 0.18}
        rx={R * 0.55}
        ry={R * 0.25}
        fill="rgba(255, 255, 250, 0.6)"
      />
      {/* slit mouth */}
      <path
        d={`M ${-R * 0.78} 0 Q 0 ${R * 0.06}, ${R * 0.78} 0`}
        stroke={C.ink}
        strokeOpacity={0.65}
        strokeWidth={1.1}
        fill="none"
      />
      {/* teeth marks along slit */}
      {Array.from({ length: 9 }).map((_, i) => {
        const t = (i - 4) / 4;
        const x = t * R * 0.72;
        return (
          <line
            key={`t-${i}`}
            x1={x}
            y1={-2}
            x2={x}
            y2={4}
            stroke={C.ink}
            strokeOpacity={0.32}
            strokeWidth={0.6}
          />
        );
      })}
      {/* faint speckles */}
      {Array.from({ length: 16 }).map((_, i) => {
        const a = Math.random() * Math.PI * 2;
        const rr = Math.random() * R * 0.7;
        return (
          <circle
            key={`sp-${i}`}
            cx={Math.cos(a) * rr}
            cy={Math.sin(a) * rr * 0.6 - R * 0.18}
            r={0.6}
            fill={C.nautilusStripe}
            opacity={0.25}
          />
        );
      })}
    </g>
  );
}

function renderAuger(size: number): JSX.Element {
  const R = size / 2;
  // tall thin spiral cone — drawn as a triangle with horizontal stripes
  const pts = `0 ${-R} ${R * 0.32} ${R} ${-R * 0.32} ${R}`;
  // brown stripes (horizontal bands)
  const stripes: JSX.Element[] = [];
  const bands = 10;
  for (let i = 0; i < bands; i++) {
    const t = i / bands;
    const y = -R + t * R * 2;
    const halfW = R * 0.32 * (0.05 + t);
    stripes.push(
      <line
        key={`au-${i}`}
        x1={-halfW}
        y1={y}
        x2={halfW}
        y2={y}
        stroke={C.nautilusStripe}
        strokeOpacity={0.5}
        strokeWidth={1.4}
      />,
    );
  }
  // a diagonal that suggests the spiral wrap
  const spiral: JSX.Element[] = [];
  for (let i = 0; i < 12; i++) {
    const t = i / 12;
    const y1 = -R + t * R * 2;
    const halfW1 = R * 0.32 * (0.05 + t);
    spiral.push(
      <line
        key={`sp-${i}`}
        x1={-halfW1}
        y1={y1}
        x2={halfW1 * 0.8}
        y2={y1 + R * 0.18}
        stroke={C.ink}
        strokeOpacity={0.3}
        strokeWidth={0.7}
      />,
    );
  }
  return (
    <g>
      <polygon points={pts} fill={C.pearl} stroke={C.ink} strokeOpacity={0.55} strokeWidth={1} />
      {stripes}
      {spiral}
    </g>
  );
}

// ── Dolphin (Minoan abstract) ───────────────────────────────────────
// Drawn pointing rightward and centered on the body. The RAF loop applies
// translate + rotate + scaleX(-1) when traveling leftward so the belly
// stays toward the water. Total body length ~80px.
function renderDolphin(): JSX.Element {
  // Body: smooth lozenge with a small dorsal nub and a forked tail at the
  // left end (since the dolphin "points" right, the tail trails behind).
  // Coordinates are in body-local space.
  const bodyD =
    "M -38 2 " +
    "Q -28 -12, -8 -10 " + // back arch toward head
    "Q 18 -10, 34 -2 " +   // forehead / beak base
    "Q 40 2, 34 6 " +      // round nose
    "Q 18 12, -8 12 " +    // belly curve
    "Q -24 12, -34 8 " +   // tail base
    "L -38 12 " +          // top tail fluke point
    "L -30 4 " +           // notch
    "L -38 -2 Z";          // bottom fluke
  // Belly band — a warm orange-cream stripe inset
  const bellyD =
    "M -28 6 " +
    "Q -12 12, 18 10 " +
    "Q 28 9, 30 4 " +
    "Q 14 9, -8 10 " +
    "Q -22 10, -28 6 Z";
  // Dorsal fin — small triangle on the back
  const dorsalD = "M -6 -10 L 4 -18 L 10 -10 Z";
  // Pectoral fin — small flipper under the front body
  const pectoralD = "M 8 8 Q 14 14, 20 12 Q 18 9, 8 8 Z";
  return (
    <g>
      {/* soft underwater shadow */}
      <ellipse cx={-2} cy={11} rx={28} ry={3.2} fill="rgba(30,90,140,0.18)" />
      {/* body */}
      <path d={bodyD} fill="#1E5A8C" />
      {/* belly band */}
      <path d={bellyD} fill="#E8B47A" opacity={0.92} />
      {/* dorsal + pectoral */}
      <path d={dorsalD} fill="#1E5A8C" />
      <path d={pectoralD} fill="#1E5A8C" />
      {/* eye dot (pearl with ink center) */}
      <circle cx={24} cy={-3} r={1.6} fill="#F8EDE3" />
      <circle cx={24} cy={-3} r={0.7} fill="#15171A" />
      {/* a thin highlight along the back — fresco-like */}
      <path
        d="M -28 -4 Q 0 -10, 28 -4"
        stroke="rgba(255,255,250,0.35)"
        strokeWidth={1.1}
        strokeLinecap="round"
        fill="none"
      />
    </g>
  );
}
