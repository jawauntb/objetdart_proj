"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { getFieldAudio } from "@/lib/audio";
import { useField } from "@/store/field";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { THRESHOLDS, tapTrainDepth, tapTrainTier } from "@/lib/gesture/core";
import { onVessel } from "@/lib/vessel";
import { relaxTurbulence, stirTurbulence } from "@/lib/turbulence";
import MobileInstrumentPanel from "@/components/MobileInstrumentPanel";
import LetGo from "@/components/LetGo";
import { useBandEdgeTravel } from "@/components/ScaleTravel";
import type { RoomZoomSpec } from "@/lib/scale";
import {
  createFrameGovernor,
  isEmbeddedFrame,
  onGalleryPause,
  resolveDpr,
  type QualityTier,
} from "@/lib/room-runtime";

// /tourbillon lives in the drop band and owns its own OrbitControls camera
// (AxisChrome travel={false}). It joins the manifold via the adapter: as
// zoom parameter it uses MAX_CAM_DISTANCE / distance, so the widest OrbitControls
// view (distance = MAX_CAM_DISTANCE = 70) maps to zoomMin = 1 (band ceiling —
// larger scales beyond, toward flowers), and the tightest view (distance =
// MIN_CAM_DISTANCE = 8) maps to zoomMax = MAX_CAM_DISTANCE/MIN_CAM_DISTANCE
// (band floor — smaller scales beyond, toward tissue). Residual pinch at
// either extreme becomes wall pressure the same physics as everywhere else.
const MIN_CAM_DISTANCE = 8;
const MAX_CAM_DISTANCE = 70;
export const TOURBILLON_ZOOM_SPEC: RoomZoomSpec = {
  band: "drop",
  zoomMin: 1,
  zoomMax: MAX_CAM_DISTANCE / MIN_CAM_DISTANCE,
};

/**
 * /tourbillon — a real(ish) mechanical watch movement in Three.js, built
 * around the one part that gives the room its name.
 *
 * A skeletonised going train laid face-up: mainspring barrel → centre wheel →
 * third wheel → fourth wheel → escape wheel, regulated by a Swiss lever
 * escapement and an oscillating balance. The wheels are compound (wheel +
 * pinion) so the ratios are real: the centre arbor turns once an hour, the
 * fourth once a minute, and the hands tell the actual local time.
 *
 * The escapement, fork and balance ride a rotating carriage — the tourbillon
 * cage — turning once per simulated minute on the fourth wheel's own arbor.
 * A real tourbillon exists to cancel gravity's effect on the balance by
 * continuously re-presenting every position to it, so no single lean biases
 * the rate. Here the device's own tilt (`lib/vessel.ts`) is the gravity being
 * cancelled: the whole case leans with the phone (or the cursor, or a slow
 * autonomous drift when nobody is touching anything), the cage keeps
 * spinning regardless, and the balance's glow reads the instantaneous
 * position error the cage is in the middle of averaging away.
 *
 * Everything is polished metal under a studio environment so it reads like a
 * movement, not a diagram. Orbit to inspect; ?view= and ?spin= drive the
 * camera.
 */

// ── tunable configuration (refined through the screenshot loop) ──────────
const CFG = {
  module: 0.16,          // gear tooth module (size of teeth)
  plateR: 13,
  plateThick: 0.7,
  wheelThick: 0.34,
  pinionThick: 0.5,
  exposure: 1.12,
  bg: 0x0a0b0e,
  // stations: compound gears. teeth = big wheel, pinion = small driving gear.
  // pos filled in below by the meshing solver.
};

type Vec2 = { x: number; y: number };

function add(a: Vec2, d: number, ang: number): Vec2 {
  return { x: a.x + d * Math.cos(ang), y: a.y + d * Math.sin(ang) };
}

// Build a toothed gear profile as an extruded shape with optional spokes.
function gearGeometry(opts: {
  teeth: number; module: number; thick: number;
  bore?: number; spokes?: number; rimRatio?: number; hub?: number; bevel?: number;
}): THREE.ExtrudeGeometry {
  const { teeth, module: m, thick } = opts;
  const bevel = opts.bevel ?? 0.04;
  const pitch = (m * teeth) / 2;
  const Ra = pitch + m * 1.0;   // addendum (tip)
  const Rr = pitch - m * 1.25;  // dedendum (root)
  const step = (Math.PI * 2) / teeth;
  const shape = new THREE.Shape();
  for (let i = 0; i < teeth; i++) {
    const a0 = i * step;
    // trapezoidal tooth with a flat valley; bevel rounds the edges later
    const pts: Array<[number, number]> = [
      [Rr, 0.00], [Rr, 0.30], [Ra, 0.40], [Ra, 0.60], [Rr, 0.70], [Rr, 1.0],
    ];
    pts.forEach(([r, f], k) => {
      const a = a0 + f * step;
      const x = r * Math.cos(a), y = r * Math.sin(a);
      if (i === 0 && k === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
  }
  shape.closePath();

  // crossings / spokes: cut lightening holes between hub and rim
  const spokes = opts.spokes ?? 0;
  if (spokes > 0) {
    const rimInner = Rr - m * 1.6;
    const hub = opts.hub ?? pitch * 0.20;
    const holeR = (rimInner - hub) * 0.5 * 0.82;
    const ringR = (rimInner + hub) * 0.5;
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2 + step / 2;
      const hx = ringR * Math.cos(a), hy = ringR * Math.sin(a);
      const hole = new THREE.Path();
      hole.absarc(hx, hy, holeR, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
  }
  // central bore
  const bore = opts.bore ?? pitch * 0.08;
  const boreHole = new THREE.Path();
  boreHole.absarc(0, 0, bore, 0, Math.PI * 2, true);
  shape.holes.push(boreHole);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thick, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: 2, steps: 1, curveSegments: Math.max(24, teeth * 2),
  });
  geo.center();
  geo.rotateX(-Math.PI / 2); // lay flat: extrude along +Y
  return geo;
}

const SPEEDS = [
  { label: "still", v: 0 },
  { label: "real time", v: 1 },
  { label: "30×", v: 30 },
  { label: "300×", v: 300 },
];
const VIEWS = ["iso", "top", "side", "macro-balance", "macro-escape", "macro-train"];
const FACES = ["genève", "aventurine", "nacre"];

// a small, cute, draggable sundial — overlaid at the foot of the movement.
// Reworked to read like forged jewellery: a polished gold bezel with a
// beveled bright/dark edge + specular glint, a domed sapphire-crystal sheen,
// an atmospheric sky (sun bloom & rays by day, stars & a moon by night,
// drifting cloud wisps) and a soft gradient gnomon shadow. Dragging still
// scrubs dayT across dawn→noon→dusk→night and now ticks at each hour, chimes
// at noon & sunset, and plays a warm whoosh on release.
function SundialChip() {
  const [dayT, setDayT] = useState(0.36);
  const dragging = useRef(false);
  const lastHour = useRef(-1);
  const reduceRef = useRef(false);
  const W = 150, H = 118, C = W / 2, baseY = 92, arcR = 60;
  const polar = (r: number, deg: number): [number, number] => {
    const a = (deg - 90) * (Math.PI / 180);
    return [C + r * Math.cos(a), baseY + r * Math.sin(a)];
  };
  const t = dayT;
  const ang = 180 + t * 180;
  const [sx, sy] = polar(arcR, ang);
  const low = Math.sin(t * Math.PI);          // sun altitude 0..1
  const [shx, shy] = polar(14 + (1 - low) * 40, 90 + (t * 180 - 90));
  const hour = 6 + t * 12; const hh = Math.floor(hour); const mm = Math.floor((hour - hh) * 60);
  const night = t > 0.97 || t < 0.03;
  const golden = (t > 0.06 && t < 0.2) || (t > 0.78 && t < 0.94); // warm low sun
  // atmospheric sky: zenith → mid → horizon. Phases preserved, deepened.
  const sky = t < 0.18 ? ["#1a1430", "#3a2a4e", "#a85a3a"]      // dawn
    : t < 0.42 ? ["#2b5e9e", "#5b96cf", "#cfe4f2"]               // morning
    : t < 0.6 ? ["#3f82c8", "#6aa8de", "#e6f3fb"]                // noon
    : t < 0.84 ? ["#5a4a8a", "#b5793e", "#f2c478"]               // golden hour
    : ["#0e0a22", "#241a40", "#6a3a34"];                          // dusk→night
  // warm sun glow tint — amber near the horizon, white near zenith
  const sunCore = golden ? "#fff0c0" : "#fffbe8";
  const sunMid = golden ? "#ffc060" : "#ffd96b";
  const sunEdge = golden ? "#e8721f" : "#ef9b2e";

  // soft tactile feedback at each hour boundary + chimes at noon / sunset
  const feedback = (nt: number) => {
    const h = Math.floor(6 + nt * 12);
    if (h !== lastHour.current) {
      lastHour.current = h;
      if (!reduceRef.current) { try { haptics.tap(); } catch { /* noop */ } }
      // noon (12h) and sunset (~18h) get a gentle chime
      if (h === 12 || h === 18) { try { getFieldAudio().chime(); } catch { /* noop */ } }
      else { try { getFieldAudio().playNote(64 + Math.round((nt) * 18), 55); } catch { /* noop */ } }
    }
  };

  // the sundial speaks the shared grammar too: a one-finger drag scrubs
  // the day, a tap jumps straight to that hour (private wiring deleted).
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dayTRef = useRef(dayT);
  const feedbackRef = useRef(feedback);
  feedbackRef.current = feedback;
  useEffect(() => { dayTRef.current = dayT; }, [dayT]);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const setFrom = (clientX: number) => {
      const r = svg.getBoundingClientRect();
      const nt = Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width)));
      setDayT(nt);
      feedbackRef.current(nt);
      return nt;
    };
    const detach = attachGestures(svg as unknown as HTMLElement, {
      tap: (e) => {
        if (e.fingers !== 1) return;
        lastHour.current = -1;
        setFrom(e.x);
      },
      drag: (e) => {
        if (e.fingers !== 1) return;
        if (e.phase === "start") {
          dragging.current = true;
          lastHour.current = Math.floor(6 + dayTRef.current * 12);
          try { reduceRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { /* noop */ }
          setFrom(e.x);
          return;
        }
        if (e.phase === "end") {
          if (!dragging.current) return;
          dragging.current = false;
          // warm whoosh on release: a soft bell + a settling note
          try { getFieldAudio().bell(); window.setTimeout(() => { try { getFieldAudio().playNote(60 + Math.round(dayTRef.current * 24), 160); } catch { /* noop */ } }, 60); } catch { /* noop */ }
          if (!reduceRef.current) haptics.ripple(0.4);
          useField.getState().recordTape("ripple", 0.3 + dayTRef.current * 0.5, "tourbillon/sundial");
          return;
        }
        setFrom(e.x);
      },
    }, { wheelZoom: false });
    return detach;
  }, []);

  // pseudo-random helper for stars (stable per index)
  const rnd = (i: number, s: number) => ((Math.sin(i * s) * 43758.5) % 1 + 1) % 1;

  return (
    <div className="tb-sundial">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ touchAction: "none", cursor: "grab" }}>
        <defs>
          {/* atmospheric vertical sky: zenith → mid → horizon glow */}
          <linearGradient id="mvSunSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={sky[0]} />
            <stop offset="55%" stopColor={sky[1]} />
            <stop offset="100%" stopColor={sky[2]} />
          </linearGradient>
          {/* sun disc */}
          <radialGradient id="mvSunDisc" cx="42%" cy="38%" r="62%">
            <stop offset="0%" stopColor={sunCore} />
            <stop offset="55%" stopColor={sunMid} />
            <stop offset="100%" stopColor={sunEdge} />
          </radialGradient>
          {/* soft sun bloom */}
          <radialGradient id="mvSunBloom" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={sunMid} stopOpacity={0.85} />
            <stop offset="40%" stopColor={sunMid} stopOpacity={0.32} />
            <stop offset="100%" stopColor={sunMid} stopOpacity={0} />
          </radialGradient>
          {/* moon */}
          <radialGradient id="mvMoon" cx="40%" cy="36%" r="64%">
            <stop offset="0%" stopColor="#fdfbf2" />
            <stop offset="70%" stopColor="#d8dceb" />
            <stop offset="100%" stopColor="#9aa3bd" />
          </radialGradient>
          {/* multi-stop forged gold for the bezel */}
          <linearGradient id="mvSunGold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fff6da" />
            <stop offset="22%" stopColor="#e7b94e" />
            <stop offset="50%" stopColor="#b8860b" />
            <stop offset="74%" stopColor="#8a6410" />
            <stop offset="100%" stopColor="#e7d39a" />
          </linearGradient>
          {/* brighter gold for the inner bevel highlight */}
          <linearGradient id="mvSunGoldHi" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fff8e4" />
            <stop offset="45%" stopColor="#ffe7a0" />
            <stop offset="100%" stopColor="#caa238" />
          </linearGradient>
          {/* gnomon blade gold */}
          <linearGradient id="mvSunBlade" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#fff4cf" />
            <stop offset="50%" stopColor="#d9ad48" />
            <stop offset="100%" stopColor="#8a6410" />
          </linearGradient>
          {/* soft gradient for the cast shadow */}
          <linearGradient id="mvSunShadow" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(8,6,2,0.5)" />
            <stop offset="100%" stopColor="rgba(8,6,2,0)" />
          </linearGradient>
          {/* domed sapphire-crystal sheen across the top */}
          <linearGradient id="mvSunCrystal" x1="0" y1="0" x2="0.35" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.5)" />
            <stop offset="22%" stopColor="rgba(255,255,255,0.16)" />
            <stop offset="55%" stopColor="rgba(255,255,255,0)" />
          </linearGradient>
          {/* warm horizon glow band */}
          <linearGradient id="mvSunHorizon" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={golden ? "rgba(255,180,90,0)" : "rgba(255,220,150,0)"} />
            <stop offset="100%" stopColor={golden ? "rgba(255,150,70,0.55)" : "rgba(255,230,170,0.32)"} />
          </linearGradient>
          {/* soft outer drop-shadow so the chip reads like a forged case */}
          <filter id="mvSunDrop" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="3" stdDeviation="3.4" floodColor="#000" floodOpacity="0.55" />
          </filter>
          <filter id="mvSunBlur" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.4" />
          </filter>
          <clipPath id="mvSunClip"><rect x="9" y="9" width={W - 18} height={baseY - 9} rx="9" /></clipPath>
        </defs>

        {/* forged gold case body with soft outer drop-shadow */}
        <rect x="3" y="3" width={W - 6} height={H - 6} rx="13" fill="url(#mvSunGold)" filter="url(#mvSunDrop)" />

        <g clipPath="url(#mvSunClip)">
          {/* sky */}
          <rect x="6" y="6" width={W - 12} height={baseY - 6} fill="url(#mvSunSky)" />

          {/* night: moon + scattered stars of varying brightness */}
          {night && (
            <g>
              <circle cx={W - 34} cy={26} r={9.5} fill="url(#mvMoon)" />
              <circle cx={W - 30} cy={23} r={7.5} fill={sky[1]} opacity={0.85} />
              {Array.from({ length: 22 }, (_, i) => {
                const stx = 12 + rnd(i, 12.9) * (W - 24);
                const sty = 10 + rnd(i, 41.2) * 62;
                const br = 0.35 + rnd(i, 7.3) * 0.6;
                return <circle key={i} cx={stx} cy={sty} r={0.5 + rnd(i, 3.1) * 0.7} fill="#eaf0ff" opacity={br} />;
              })}
            </g>
          )}

          {/* daytime drifting cloud wisps */}
          {!night && (
            <g opacity={0.6 * low + 0.15} fill="#ffffff" filter="url(#mvSunBlur)">
              <ellipse cx={36} cy={26} rx={16} ry={4.5} opacity={0.5} />
              <ellipse cx={104} cy={18} rx={20} ry={5} opacity={0.4} />
            </g>
          )}

          {/* warm horizon glow band near the ground */}
          <rect x="6" y={baseY - 26} width={W - 12} height={26} fill="url(#mvSunHorizon)" />

          {/* engraved hour ticks on an inner ring */}
          {Array.from({ length: 13 }, (_, i) => {
            const aa = 180 + (i / 12) * 180;
            const [x1, y1] = polar(arcR + 3, aa); const [x2, y2] = polar(arcR - 2, aa);
            const major = i % 6 === 0;
            return (
              <g key={i}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(0,0,0,0.35)" strokeWidth={major ? 1.6 : 0.9} transform="translate(0.5,0.6)" />
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,247,214,0.55)" strokeWidth={major ? 1.2 : 0.6} />
              </g>
            );
          })}

          {/* sun: bloom + faint rays + disc */}
          {!night && (
            <g>
              <circle cx={sx} cy={sy} r={20} fill="url(#mvSunBloom)" opacity={0.55 * low + 0.35} />
              <g stroke={sunMid} strokeWidth={0.9} strokeLinecap="round" opacity={(golden ? 0.5 : 0.35) * (low * 0.7 + 0.3)}>
                {Array.from({ length: 10 }, (_, i) => {
                  const ra = (i / 10) * Math.PI * 2;
                  const r0 = 8, r1 = 13 + (i % 2) * 3;
                  return <line key={i} x1={sx + Math.cos(ra) * r0} y1={sy + Math.sin(ra) * r0} x2={sx + Math.cos(ra) * r1} y2={sy + Math.sin(ra) * r1} />;
                })}
              </g>
              <circle cx={sx} cy={sy} r={6} fill="url(#mvSunDisc)" />
              <circle cx={sx - 1.6} cy={sy - 1.8} r={1.8} fill="#fffdf2" opacity={0.7} />
            </g>
          )}

          {/* ground */}
          <rect x="6" y={baseY} width={W - 12} height={H - baseY} fill="#221710" />
          <rect x="6" y={baseY} width={W - 12} height={3} fill="rgba(255,210,140,0.18)" />

          {/* soft gradient gnomon shadow (lengthens at dawn/dusk) */}
          <g transform={`rotate(${(t * 180 - 90)} ${C} ${baseY})`} opacity={0.9}>
            <rect x={C} y={baseY - 1.6} width={14 + (1 - low) * 40} height={3.2} rx={1.6}
              fill="url(#mvSunShadow)" filter="url(#mvSunBlur)" />
          </g>
          <line x1={C} y1={baseY} x2={shx} y2={shy} stroke="rgba(6,4,1,0.28)" strokeWidth="1.4" strokeLinecap="round" filter="url(#mvSunBlur)" />

          {/* gnomon — a little gold blade */}
          <path d={`M${C - 3.4} ${baseY} L${C} ${baseY - 22} L${C + 3.4} ${baseY} Z`} fill="url(#mvSunBlade)" stroke="#6f5410" strokeWidth="0.5" />
          <path d={`M${C} ${baseY - 22} L${C + 3.4} ${baseY} L${C + 1.2} ${baseY} Z`} fill="rgba(0,0,0,0.22)" />
        </g>

        {/* domed sapphire crystal sheen over the dial */}
        <rect x="9" y="9" width={W - 18} height={(baseY - 9) * 0.62} rx="9" fill="url(#mvSunCrystal)" pointerEvents="none" />
        <ellipse cx={C} cy={20} rx={W * 0.34} ry={9} fill="#ffffff" opacity={0.14} pointerEvents="none" filter="url(#mvSunBlur)" />

        {/* polished gold bezel: outer dark edge, gradient ring, bright inner bevel */}
        <rect x="3.6" y="3.6" width={W - 7.2} height={H - 7.2} rx="12.4" fill="none" stroke="#6f5410" strokeWidth="1" />
        <rect x="5" y="5" width={W - 10} height={H - 10} rx="11" fill="none" stroke="url(#mvSunGold)" strokeWidth="3.2" />
        <rect x="8.4" y="8.4" width={W - 16.8} height={H - 16.8} rx="9.2" fill="none" stroke="url(#mvSunGoldHi)" strokeWidth="1" opacity={0.9} />
        <rect x="9.6" y="9.6" width={W - 19.2} height={H - 19.2} rx="8.4" fill="none" stroke="rgba(60,42,8,0.55)" strokeWidth="0.6" />
        {/* specular glint on the bezel — top-left arc */}
        <path d={`M8 ${H * 0.42} Q8 8 ${W * 0.42} 8`} fill="none" stroke="rgba(255,252,230,0.85)" strokeWidth="1.4" strokeLinecap="round" pointerEvents="none" />

        <text x={C} y={baseY + 20} textAnchor="middle" className="tb-sun-time">{String(hh).padStart(2, "0")}:{String(mm).padStart(2, "0")}</text>
      </svg>
    </div>
  );
}

export default function Tourbillon() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const speedRef = useRef(1);
  const resyncRef = useRef(false);
  const applyViewRef = useRef<((n: string) => void) | null>(null);
  const swapFaceRef = useRef<((f: string) => void) | null>(null);
  const dialRef = useRef<THREE.Object3D | null>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const faceIdxRef = useRef(0);
  const [speed, setSpeed] = useState(1);
  const [view, setView] = useState("iso");
  const [face, setFace] = useState("genève");
  const [dialOn, setDialOn] = useState(true);

  // The scale manifold at the OrbitControls extremes. A pinch inside the
  // tourbillon's own zoom range moves the camera as always; only pinch
  // held past the widest or tightest view presses toward the neighboring
  // band — the same physics as every other axis room.
  const {
    report: reportScaleEdge,
    release: releaseScaleEdge,
    overlay: scaleEdgeOverlay,
  } = useBandEdgeTravel("/tourbillon", TOURBILLON_ZOOM_SPEC);
  // Held in a ref so the useEffect closure — mounted once — always reads the
  // current callback identity that useBandEdgeTravel returns each render.
  const reportScaleEdgeRef = useRef(reportScaleEdge);
  const releaseScaleEdgeRef = useRef(releaseScaleEdge);
  reportScaleEdgeRef.current = reportScaleEdge;
  releaseScaleEdgeRef.current = releaseScaleEdge;

  const toggleDial = () => {
    const next = !dialOn;
    if (dialRef.current) dialRef.current.visible = next;
    setDialOn(next);
    try { getFieldAudio().thud(); } catch { /* noop */ }
    haptics.tap();
    useField.getState().recordTape("object", 0.4, `tourbillon/dial/${next ? "on" : "open"}`);
  };

  const pickSpeed = (v: number) => {
    speedRef.current = v;
    if (v === 1) resyncRef.current = true;
    setSpeed(v);
    try { getFieldAudio().playNote(v === 0 ? 50 : 60 + Math.round(Math.log2(v || 1) * 4), 80); } catch { /* noop */ }
    haptics.tap();
    useField.getState().recordTape("object", 0.4, `tourbillon/speed/${v}`);
  };

  // refs so the gesture bindings (mounted once) always see the live acts
  const toggleDialRef = useRef<() => void>(() => {});
  const pickSpeedRef = useRef<(v: number) => void>(() => {});
  toggleDialRef.current = toggleDial;
  pickSpeedRef.current = pickSpeed;

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    try { getFieldAudio().setAmbientProfile("time"); } catch { /* noop */ }

    const params = new URLSearchParams(window.location.search);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const spin = params.get("spin") !== "0" && !reduced;
    const view0 = params.get("view") || "iso";
    const shotMode = params.get("shot") === "1"; // cheap render for headless capture

    // ── performance contract (room-runtime): frame governor + DPR ceiling,
    // shared with every other room. Visibility pause already lived here
    // (below) — gallery-pause joins it. ──
    const embedded = isEmbeddedFrame();
    const gov = createFrameGovernor(embedded ? "medium" : "high");
    let tier: QualityTier = gov.tier();

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(shotMode ? 1 : resolveDpr(tier, { embedded, reducedMotion: reduced }));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = CFG.exposure;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = !shotMode;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    wrap.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(CFG.bg);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    camera.position.set(0, 26, 20);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = MIN_CAM_DISTANCE;
    controls.maxDistance = MAX_CAM_DISTANCE;
    controls.target.set(0, 0, 0);
    controls.autoRotate = spin;
    controls.autoRotateSpeed = 0.7;

    // ── lighting ──
    const key = new THREE.DirectionalLight(0xfff2dd, 2.4);
    key.position.set(10, 22, 12);
    key.castShadow = !shotMode;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1; key.shadow.camera.far = 80;
    key.shadow.camera.left = -20; key.shadow.camera.right = 20;
    key.shadow.camera.top = 20; key.shadow.camera.bottom = -20;
    key.shadow.bias = -0.0004;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x88aaff, 1.1);
    rim.position.set(-14, 8, -10);
    scene.add(rim);
    scene.add(new THREE.AmbientLight(0xffffff, 0.18));

    // Côtes de Genève — sweeping circular stripes that make the plate shimmer.
    const genevaTex = (() => {
      const s = 1024;
      const c = document.createElement("canvas"); c.width = c.height = s;
      const x = c.getContext("2d")!;
      x.fillStyle = "#8f9298"; x.fillRect(0, 0, s, s);
      const cx = s * 1.35, cy = s * 0.5;
      for (let r = 40; r < 2400; r += 24) {
        const band = Math.floor(r / 24) % 2;
        const g = band ? 150 : 132;
        x.strokeStyle = `rgb(${g},${g + 3},${g + 8})`;
        x.lineWidth = 13; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.stroke();
      }
      // faint perlage speckle for the rest
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    })();
    const genevaRough = genevaTex.clone(); genevaRough.colorSpace = THREE.NoColorSpace;

    // Aventurine — deep blue glass scattered with gold flecks (the "starry
    // night" dial from the original watch, kept as switchable character).
    const aventurineTex = (() => {
      const s = 1024;
      const c = document.createElement("canvas"); c.width = c.height = s;
      const x = c.getContext("2d")!;
      const bg = x.createRadialGradient(s * 0.42, s * 0.36, 0, s / 2, s / 2, s * 0.7);
      bg.addColorStop(0, "#2a52a8"); bg.addColorStop(0.6, "#16306b"); bg.addColorStop(1, "#0a1640");
      x.fillStyle = bg; x.fillRect(0, 0, s, s);
      for (let i = 0; i < 1400; i++) {
        const px = ((Math.sin(i * 12.99) * 43758.5) % 1 + 1) % 1 * s;
        const py = ((Math.sin(i * 78.23) * 43758.5) % 1 + 1) % 1 * s;
        const r = 0.5 + (((Math.sin(i * 3.7) * 9999) % 1 + 1) % 1) * 1.9;
        x.fillStyle = i % 4 === 0 ? "rgba(255,232,170,1)" : "rgba(225,235,255,0.85)";
        x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
      }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
      return t;
    })();

    // Nacre — opalescent mother-of-pearl: pearl base, drifting pastel blooms,
    // and a fine wavy shell grain. Real iridescence comes from the material.
    const nacreTex = (() => {
      const s = 1024;
      const c = document.createElement("canvas"); c.width = c.height = s;
      const x = c.getContext("2d")!;
      const base = x.createLinearGradient(0, 0, s, s);
      base.addColorStop(0, "#f6f1f4"); base.addColorStop(0.5, "#eef4f6"); base.addColorStop(1, "#f5eef7");
      x.fillStyle = base; x.fillRect(0, 0, s, s);
      const rnd = (i: number) => ((Math.sin(i * 127.1) * 43758.5) % 1 + 1) % 1;
      const hues = ["247,217,227", "214,235,247", "219,247,231", "233,219,247", "247,238,214"];
      x.globalCompositeOperation = "lighter";
      for (let i = 0; i < 46; i++) {
        const px = rnd(i) * s, py = rnd(i + 99) * s, r = 140 + rnd(i + 7) * 300;
        const hue = hues[i % hues.length];
        const g = x.createRadialGradient(px, py, 0, px, py, r);
        g.addColorStop(0, `rgba(${hue},0.22)`); g.addColorStop(1, `rgba(${hue},0)`);
        x.fillStyle = g; x.fillRect(px - r, py - r, 2 * r, 2 * r);
      }
      x.globalCompositeOperation = "source-over";
      x.strokeStyle = "rgba(255,255,255,0.16)"; x.lineWidth = 1.1;
      for (let yy = 0; yy < s; yy += 9) {
        x.beginPath();
        for (let xx = 0; xx <= s; xx += 8) {
          const yo = Math.sin(xx * 0.02 + yy * 0.05) * 6;
          if (xx === 0) x.moveTo(xx, yy + yo); else x.lineTo(xx, yy + yo);
        }
        x.stroke();
      }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
      return t;
    })();

    // ── materials ──
    const matPlate = new THREE.MeshPhysicalMaterial({ color: 0xc3c6cc, metalness: 1, roughness: 0.55, map: genevaTex, roughnessMap: genevaRough });
    const matBridge = new THREE.MeshStandardMaterial({ color: 0xc3c6cc, metalness: 1, roughness: 0.4 });
    // bright 24k yellow gold for the case sides + bezel lip
    const matGold24 = new THREE.MeshStandardMaterial({ color: 0xffc62e, metalness: 1, roughness: 0.14 });
    const matBrass = new THREE.MeshStandardMaterial({ color: 0xd8a85a, metalness: 1, roughness: 0.22 });
    const matSteel = new THREE.MeshStandardMaterial({ color: 0xdfe3ea, metalness: 1, roughness: 0.16 });
    const matBlued = new THREE.MeshStandardMaterial({ color: 0x2b3d6b, metalness: 1, roughness: 0.18 });
    const matBalance = new THREE.MeshStandardMaterial({ color: 0xe9c873, metalness: 1, roughness: 0.2 });
    const matRuby = new THREE.MeshPhysicalMaterial({ color: 0x8e1326, metalness: 0, roughness: 0.08, transmission: 0.5, ior: 1.76, thickness: 0.4 });
    const matBlack = new THREE.MeshStandardMaterial({ color: 0x111317, metalness: 0.6, roughness: 0.4 });
    const matGold = new THREE.MeshStandardMaterial({ color: 0xf2d089, metalness: 1, roughness: 0.18 });

    const root = new THREE.Group();
    scene.add(root);

    // base / main plate
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(CFG.plateR, CFG.plateR, CFG.plateThick, 96),
      matPlate,
    );
    plate.position.y = -1.2;
    plate.receiveShadow = true;
    root.add(plate);
    // polished 24k bezel lip
    const rimRing = new THREE.Mesh(
      new THREE.TorusGeometry(CFG.plateR, 0.5, 20, 120),
      matGold24,
    );
    rimRing.rotation.x = Math.PI / 2;
    rimRing.position.y = -1.2 + CFG.plateThick / 2;
    rimRing.castShadow = true;
    root.add(rimRing);
    // bright yellow-gold case band — the watch's sides
    const caseBand = new THREE.Mesh(
      new THREE.CylinderGeometry(CFG.plateR + 0.18, CFG.plateR + 0.32, 2.3, 160, 1, true),
      matGold24,
    );
    caseBand.position.y = -0.65;
    caseBand.castShadow = true;
    root.add(caseBand);
    // a lower lip so the case reads solid from the side
    const caseFoot = new THREE.Mesh(
      new THREE.TorusGeometry(CFG.plateR + 0.28, 0.34, 18, 120),
      matGold24,
    );
    caseFoot.rotation.x = Math.PI / 2;
    caseFoot.position.y = -1.75;
    root.add(caseFoot);

    // switchable dial finish — Côtes de Genève · aventurine · nacre
    const applyFace = (f: string) => {
      matPlate.iridescence = 0; matPlate.clearcoat = 0; matPlate.emissiveMap = null; // reset extras
      if (f === "aventurine") {
        matPlate.map = aventurineTex; matPlate.roughnessMap = null;
        matPlate.color.set(0xffffff); matPlate.metalness = 0.4; matPlate.roughness = 0.34;
        matPlate.emissive.set(0x16306b); matPlate.emissiveIntensity = 0.35;
        matPlate.emissiveMap = aventurineTex;
      } else if (f === "nacre") {
        matPlate.map = nacreTex; matPlate.roughnessMap = null;
        matPlate.color.set(0xf3eef2); matPlate.metalness = 0.2; matPlate.roughness = 0.22;
        matPlate.emissive.set(0x0c0c14); matPlate.emissiveIntensity = 0.05;
        matPlate.iridescence = 1; matPlate.iridescenceIOR = 1.4;
        matPlate.iridescenceThicknessRange = [180, 680];
        matPlate.clearcoat = 0.7; matPlate.clearcoatRoughness = 0.2;
      } else {
        matPlate.map = genevaTex; matPlate.roughnessMap = genevaRough;
        matPlate.color.set(0xc3c6cc); matPlate.metalness = 1; matPlate.roughness = 0.55;
        matPlate.emissive.set(0x000000); matPlate.emissiveIntensity = 0;
      }
      matPlate.needsUpdate = true;
    };
    swapFaceRef.current = applyFace;

    // pressable parts: collected for raycasting + a little push-in animation
    const pressables: Array<{ mesh: THREE.Object3D; rest: THREE.Vector3; inDir: THREE.Vector3; act: string }> = [];
    const pressAnim: { rec: typeof pressables[number] | null; t0: number } = { rec: null, t0: 0 };

    // ── studio grounding (added to scene, not root, so framing ignores it) ──
    const floorY = -1.2 - CFG.plateThick / 2 - 0.05;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(240, 240),
      new THREE.MeshStandardMaterial({ color: 0x070809, metalness: 0.5, roughness: 0.55 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = floorY;
    floor.receiveShadow = true;
    scene.add(floor);
    // soft contact-shadow decal (works even when dynamic shadows are off)
    const shadowTex = (() => {
      const s = 256; const c = document.createElement("canvas"); c.width = c.height = s;
      const x = c.getContext("2d")!;
      const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, "rgba(0,0,0,0.55)");
      g.addColorStop(0.55, "rgba(0,0,0,0.32)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = g; x.fillRect(0, 0, s, s);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const contact = new THREE.Mesh(
      new THREE.PlaneGeometry(CFG.plateR * 3.4, CFG.plateR * 3.4),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
    );
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = floorY + 0.02;
    scene.add(contact);

    // helper to add a jewel in a chaton (optionally to a moving parent, in
    // that parent's local space rather than root/world space)
    const addJewel = (x: number, z: number, y: number, r = 0.42, parent: THREE.Object3D = root) => {
      const j = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.22, 20), matRuby);
      j.position.set(x, y, z);
      parent.add(j);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.12, 0.09, 10, 24), matGold);
      ring.rotation.x = Math.PI / 2; ring.position.set(x, y, z);
      parent.add(ring);
    };

    // a spinning compound wheel: big wheel + pinion + arbor, grouped.
    type Station = {
      group: THREE.Group; omega: number; pos: Vec2; pitchWheel: number; pinionR: number;
    };
    const m = CFG.module;
    const planeY = 0; // wheels sit around here, stacked slightly in Y

    const makeStation = (o: {
      pos: Vec2; wheelTeeth: number; pinionTeeth: number; omega: number;
      y?: number; spokes?: number; wheelMat?: THREE.Material; tall?: boolean;
      parent?: THREE.Object3D; origin?: Vec2;
    }): Station => {
      const g = new THREE.Group();
      const origin = o.origin ?? { x: 0, y: 0 };
      g.position.set(o.pos.x - origin.x, o.y ?? planeY, o.pos.y - origin.y);
      const wheel = new THREE.Mesh(
        gearGeometry({ teeth: o.wheelTeeth, module: m, thick: CFG.wheelThick, spokes: o.spokes ?? 5 }),
        o.wheelMat ?? matBrass,
      );
      wheel.castShadow = true; wheel.receiveShadow = true;
      g.add(wheel);
      // pinion sits below the wheel (toward plate)
      const pinion = new THREE.Mesh(
        gearGeometry({ teeth: o.pinionTeeth, module: m, thick: CFG.pinionThick, spokes: 0, bevel: 0.02 }),
        matSteel,
      );
      pinion.position.y = -0.42;
      pinion.castShadow = true;
      g.add(pinion);
      // arbor
      const arbor = new THREE.Mesh(new THREE.CylinderGeometry(m * 1.0, m * 1.0, 2.2, 16), matSteel);
      arbor.position.y = -0.6;
      g.add(arbor);
      (o.parent ?? root).add(g);
      return { group: g, omega: o.omega, pos: o.pos, pitchWheel: (m * o.wheelTeeth) / 2, pinionR: (m * o.pinionTeeth) / 2 };
    };

    // ── going-train geometry (compound ratios → real time) ──
    // base angular rate: centre wheel = 1 rev / 3600 s
    const wc = (Math.PI * 2) / 3600;
    // teeth chosen so centre→fourth = 60×  (Wc*Wt)/(Pt*Pf) = (80*75)/(10*10)=60
    const Wc = 80, Pt = 10, Wt = 75, Pf = 10, Wf = 70, Pe = 7, Pc = 12, Wbar = 96;

    const centerPos: Vec2 = { x: 0, y: 0 };
    const thirdPos = add(centerPos, m * (Wc + Pt) / 2, -0.55);
    const fourthPos = add(thirdPos, m * (Wt + Pf) / 2, -1.7);
    const escapePos = add(fourthPos, m * (Wf + Pe) / 2, -2.9);
    const barrelPos = add(centerPos, m * (Wbar + Pc) / 2, 2.5);

    // the tourbillon cage: the carriage that carries the escapement, fork and
    // balance, pivoting on the escape wheel's own arbor. It turns once per
    // simulated minute — the fourth wheel's own rate — so every position the
    // balance can lean into is re-presented once a revolution; a real
    // tourbillon exists to average gravity's bias to zero this way.
    const cage = new THREE.Group();
    cage.position.set(escapePos.x, 0, escapePos.y);
    root.add(cage);

    // centre wheel (carries minute hand). spins clockwise-from-top = -wc about Y
    const center = makeStation({ pos: centerPos, wheelTeeth: Wc, pinionTeeth: Pc, omega: -wc, spokes: 5 });
    const third = makeStation({ pos: thirdPos, wheelTeeth: Wt, pinionTeeth: Pt, omega: wc * (Wc / Pt), spokes: 4 });
    const fourth = makeStation({ pos: fourthPos, wheelTeeth: Wf, pinionTeeth: Pf, omega: -wc * (Wc * Wt) / (Pt * Pf), spokes: 4 });
    const escape = makeStation({
      pos: escapePos, wheelTeeth: 15, pinionTeeth: Pe,
      omega: wc * (Wc * Wt * Wf) / (Pt * Pf * Pe), spokes: 0, wheelMat: matSteel,
      parent: cage, origin: escapePos,
    });
    const barrel = makeStation({ pos: barrelPos, wheelTeeth: Wbar, pinionTeeth: 12, omega: -wc * (Pc / Wbar), spokes: 6, wheelMat: matGold });

    // mainspring barrel: a drum narrower than the wheel so the teeth ring
    // shows, capped by a ratchet wheel + blued click and three screws.
    const barrelPitch = (m * Wbar) / 2;
    const drum = new THREE.Mesh(
      new THREE.CylinderGeometry(barrelPitch * 0.6, barrelPitch * 0.6, 0.9, 64),
      new THREE.MeshStandardMaterial({ color: 0xc9a14e, metalness: 1, roughness: 0.32 }),
    );
    drum.position.set(barrelPos.x, 0.55, barrelPos.y);
    drum.castShadow = true;
    root.add(drum);
    // ratchet wheel on top
    const ratchet = new THREE.Mesh(
      gearGeometry({ teeth: 30, module: m * 0.9, thick: 0.3, spokes: 0, bevel: 0.03 }),
      matGold,
    );
    ratchet.position.set(barrelPos.x, 1.15, barrelPos.y);
    ratchet.castShadow = true;
    root.add(ratchet);
    // three blued screws on the drum cap
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.18, 16), matBlued);
      screw.position.set(barrelPos.x + Math.cos(a) * barrelPitch * 0.32, 1.05, barrelPos.y + Math.sin(a) * barrelPitch * 0.32);
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.08), matSteel);
      slot.position.copy(screw.position); slot.position.y += 0.1; slot.rotation.y = a;
      root.add(screw); root.add(slot);
    }

    const stations = [center, third, fourth, escape, barrel];
    [centerPos, thirdPos, fourthPos, barrelPos].forEach((p) => addJewel(p.x, p.y, 1.0, 0.34));
    addJewel(0, 0, 1.0, 0.34, cage); // the escape arbor's jewel rides the cage

    // ── escapement: pallet fork + balance, both riding the cage ──
    // all positions below are expressed relative to escapePos (the cage's
    // own origin), since the fork, balance and cock are children of `cage`.
    const escR = (15 * m) / 2;
    const balancePos = add(escapePos, escR + 4.2, -0.2);
    const balOff: Vec2 = { x: balancePos.x - escapePos.x, y: balancePos.y - escapePos.y };

    // pallet fork (blued steel), pivoting between escape and balance
    const fork = new THREE.Group();
    const forkPos = add(escapePos, escR + 1.4, 0.4);
    fork.position.set(forkPos.x - escapePos.x, 0.4, forkPos.y - escapePos.y);
    const forkBar = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.18, 0.5), matBlued);
    fork.add(forkBar);
    const forkStem = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 2.0), matBlued);
    forkStem.position.z = 1.0; fork.add(forkStem);
    [-1.2, 1.2].forEach((x) => {
      const pallet = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.5), matRuby);
      pallet.position.set(x, 0, 0); fork.add(pallet);
    });
    fork.castShadow = true;
    cage.add(fork);

    // balance wheel: rim + crossing + hairspring
    const balance = new THREE.Group();
    balance.position.set(balOff.x, 1.0, balOff.y);
    const balR = 3.4;
    const balRim = new THREE.Mesh(new THREE.TorusGeometry(balR, 0.22, 16, 64), matBalance);
    balRim.rotation.x = Math.PI / 2; balRim.castShadow = true; balance.add(balRim);
    for (let i = 0; i < 3; i++) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(balR * 2, 0.14, 0.34), matBalance);
      arm.rotation.y = (i / 3) * Math.PI; balance.add(arm);
    }
    // timing screws around the rim
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 10), matSteel);
      screw.rotation.z = Math.PI / 2;
      screw.position.set(Math.cos(a) * balR, 0, Math.sin(a) * balR);
      screw.lookAt(balance.position);
      balance.add(screw);
    }
    // hairspring: a flat spiral of tube segments
    const spiralPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 240; i++) {
      const tt = i / 240; const a = tt * Math.PI * 2 * 5; const r = 0.4 + tt * 1.7;
      spiralPts.push(new THREE.Vector3(Math.cos(a) * r, -0.5, Math.sin(a) * r));
    }
    const hair = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(spiralPts), 240, 0.03, 6, false), matBlued);
    balance.add(hair);
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.4, 12), matSteel);
    balance.add(staff);
    cage.add(balance);
    addJewel(balOff.x, balOff.y, 1.9, 0.4, cage);

    // balance cock — a slim polished bridge arching over the balance, anchored
    // toward the escape side, carrying the upper balance jewel. It rides the
    // cage too: on a real tourbillon this bridge (or a full bridge on both
    // ends) IS the carriage the balance is mounted to.
    {
      const anchorAbs = add(balancePos, balR + 1.2, Math.atan2(escapePos.y - balancePos.y, escapePos.x - balancePos.x));
      const anchor: Vec2 = { x: anchorAbs.x - escapePos.x, y: anchorAbs.y - escapePos.y };
      const cock = new THREE.Group();
      const dx = balOff.x - anchor.x, dz = balOff.y - anchor.y;
      const len = Math.hypot(dx, dz);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(len, 0.34, 1.1), matBridge);
      arm.position.set(anchor.x + dx / 2, 2.35, anchor.y + dz / 2);
      arm.rotation.y = -Math.atan2(dz, dx);
      arm.castShadow = true;
      cock.add(arm);
      // foot + two screws at the anchored end
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.4, 20), matBridge);
      foot.position.set(anchor.x, 2.25, anchor.y); cock.add(foot);
      [-0.5, 0.5].forEach((o) => {
        const sx = anchor.x + Math.cos(arm.rotation.y + Math.PI / 2) * o;
        const sz = anchor.y - Math.sin(arm.rotation.y + Math.PI / 2) * o;
        const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.5, 14), matBlued);
        screw.position.set(sx, 2.4, sz); cock.add(screw);
      });
      // end boss + upper jewel over the balance staff
      const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.42, 20), matBridge);
      boss.position.set(balOff.x, 2.4, balOff.y); cock.add(boss);
      const upperJewel = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.16, 16), matRuby);
      upperJewel.position.set(balOff.x, 2.62, balOff.y); cock.add(upperJewel);
      cage.add(cock);
    }

    // the cage ring — an open skeleton hoop below the balance, the visual
    // signature of a tourbillon carriage: three slender polished spokes and
    // a counterweight opposite the fork, so the rotation itself reads as a
    // carriage and not an accident of the escape wheel spinning in place.
    {
      const cageR = balR + 1.0;
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(cageR, 0.08, 10, 72), matBlued);
      hoop.rotation.x = Math.PI / 2;
      hoop.position.set(balOff.x, 0.15, balOff.y);
      hoop.castShadow = true;
      cage.add(hoop);
      const spokeCount = 3;
      for (let i = 0; i < spokeCount; i++) {
        const a = (i / spokeCount) * Math.PI * 2;
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(cageR * 1.96, 0.08, 0.16), matSteel);
        spoke.position.set(balOff.x, 0.15, balOff.y);
        spoke.rotation.y = a;
        spoke.castShadow = true;
        cage.add(spoke);
      }
      // a small brass counterweight opposite the fork, poising the carriage
      const cwAngle = Math.atan2(-balOff.y, -balOff.x) + Math.PI;
      const counterweight = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 16), matGold);
      counterweight.position.set(
        balOff.x + Math.cos(cwAngle) * cageR * 0.94,
        0.15,
        balOff.y + Math.sin(cwAngle) * cageR * 0.94,
      );
      cage.add(counterweight);
    }

    // ── dial: a floating chapter ring (numerals + minute track) over the
    // movement, with applied gold markers — so the watch reads the time while
    // the gears still show through. Toggle to "open" for the bare movement.
    const dialOuter = CFG.plateR - 0.7;     // ~12.3
    const dialInner = dialOuter - 3.4;      // chapter band only; centre open
    const dialTex = (() => {
      const s = 1024, c = document.createElement("canvas"); c.width = c.height = s;
      const x = c.getContext("2d")!;
      const C0 = s / 2;
      const rBandI = s * 0.345, rBandO = s * 0.5;
      const rNum = s * 0.43, rTickO = s * 0.49, rTickMaj = s * 0.455, rTickMin = s * 0.47;
      x.clearRect(0, 0, s, s);
      // fumé chapter-ring band: translucent toward the open centre, deep at rim
      const grad = x.createRadialGradient(C0, C0, rBandI, C0, C0, rBandO);
      grad.addColorStop(0, "rgba(20,24,30,0.05)");
      grad.addColorStop(0.18, "rgba(17,20,26,0.78)");
      grad.addColorStop(0.7, "rgba(12,14,19,0.92)");
      grad.addColorStop(1, "rgba(6,8,11,0.98)");
      x.beginPath(); x.arc(C0, C0, rBandO, 0, Math.PI * 2); x.fillStyle = grad; x.fill();
      x.globalCompositeOperation = "destination-out";
      x.beginPath(); x.arc(C0, C0, rBandI, 0, Math.PI * 2); x.fill();
      x.globalCompositeOperation = "source-over";
      // inner + outer hairline rails
      x.strokeStyle = "rgba(231,211,154,0.5)"; x.lineWidth = 2.5;
      x.beginPath(); x.arc(C0, C0, rBandI + 6, 0, Math.PI * 2); x.stroke();
      // minute track (opaque)
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
        const major = i % 5 === 0;
        const ri = major ? rTickMaj : rTickMin;
        x.strokeStyle = major ? "rgba(244,232,200,1)" : "rgba(231,211,154,0.8)";
        x.lineWidth = major ? 6 : 2.4;
        x.beginPath(); x.moveTo(C0 + Math.cos(a) * ri, C0 + Math.sin(a) * ri); x.lineTo(C0 + Math.cos(a) * rTickO, C0 + Math.sin(a) * rTickO); x.stroke();
      }
      // hour numerals — fully opaque, bright, with a soft dark halo for contrast
      x.textAlign = "center"; x.textBaseline = "middle";
      x.font = `700 ${Math.round(s * 0.058)}px "Times New Roman", Georgia, serif`;
      for (let h = 1; h <= 12; h++) {
        const a = (h / 12) * Math.PI * 2 - Math.PI / 2;
        const nx = C0 + Math.cos(a) * rNum, ny = C0 + Math.sin(a) * rNum + s * 0.004;
        x.shadowColor = "rgba(0,0,0,0.85)"; x.shadowBlur = 10;
        x.fillStyle = "#f6e6b4"; x.fillText(String(h), nx, ny);
      }
      x.shadowBlur = 0;
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
      return t;
    })();
    const dialGroup = new THREE.Group();
    dialGroup.position.y = 1.5;
    void dialInner;
    // Draw the chapter ring on a full transparent disc (square texture maps 1:1);
    // the printed band lives in the outer area, the centre stays clear so the
    // gear train shows through.
    const dialDisc = new THREE.Mesh(
      new THREE.CircleGeometry(dialOuter, 96),
      new THREE.MeshBasicMaterial({ map: dialTex, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
    );
    dialDisc.rotation.x = -Math.PI / 2;
    dialGroup.add(dialDisc);
    // applied gold hour batons for depth + shine
    for (let h = 0; h < 12; h++) {
      const a = (h / 12) * Math.PI * 2;
      const rr = dialOuter - 1.15;
      const baton = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, h % 3 === 0 ? 1.5 : 1.0), matGold);
      baton.position.set(Math.cos(a) * rr, 0.06, Math.sin(a) * rr);
      baton.rotation.y = -a + Math.PI / 2;
      baton.castShadow = true;
      dialGroup.add(baton);
    }
    root.add(dialGroup);
    dialRef.current = dialGroup;

    // ── motion works + hands at centre ──
    const hands = new THREE.Group();
    hands.position.set(centerPos.x, 1.85, centerPos.y);
    root.add(hands);
    const mkHand = (len: number, w: number, h: number, mat: THREE.Material, tailMul = 0.22) => {
      const g = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(w, h, len), mat);
      shaft.position.z = len / 2 - len * tailMul; shaft.castShadow = true; g.add(shaft);
      return g;
    };
    const hourHand = mkHand(7.4, 0.5, 0.2, matBlued);
    const minuteHand = mkHand(10.6, 0.36, 0.18, matBlued);
    hands.add(hourHand); hands.add(minuteHand);
    const capH = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.5, 18), matGold);
    hands.add(capH);
    // small seconds on the fourth-wheel arbor
    const secHand = mkHand(2.2, 0.16, 0.12, matBlued, 0.28);
    const secGroup = new THREE.Group();
    secGroup.position.set(fourthPos.x, 1.7, fourthPos.y);
    secGroup.add(secHand);
    const secCap = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.3, 12), matGold);
    secGroup.add(secCap);
    root.add(secGroup);

    // ── tag the moving parts so taps can find them ──
    const tag = (o: THREE.Object3D, act: string) => { o.traverse((c) => { c.userData.act = act; }); };
    tag(center.group, "gear-center"); tag(third.group, "gear-third");
    tag(fourth.group, "gear-fourth"); tag(escape.group, "gear-escape");
    tag(barrel.group, "wind"); tag(drum, "wind"); tag(ratchet, "wind");
    tag(balance, "balance");
    const GEAR_PITCH: Record<string, number> = { "gear-center": 60, "gear-third": 64, "gear-fourth": 67, "gear-escape": 72 };

    // ── crown + chronograph pushers on the case (3 o'clock) ──
    const caseY = -0.55;
    const mkButton = (angDeg: number, act: string, crown: boolean) => {
      const ang = (angDeg * Math.PI) / 180;
      const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
      const len = crown ? 1.9 : 1.2;
      const rad = crown ? 1.15 : 0.55;
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, len, crown ? 28 : 18), crown ? matGold : matSteel);
      body.rotation.z = Math.PI / 2; body.position.x = len / 2; g.add(body);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(rad * (crown ? 0.78 : 0.92), rad * (crown ? 0.78 : 0.92), 0.22, crown ? 24 : 16), crown ? matGold : matGold);
      cap.rotation.z = Math.PI / 2; cap.position.x = len + 0.1; g.add(cap);
      if (crown) {
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          const flute = new THREE.Mesh(new THREE.BoxGeometry(len * 0.92, 0.12, 0.12), matGold);
          flute.position.set(len / 2, Math.cos(a) * rad, Math.sin(a) * rad);
          g.add(flute);
        }
      }
      g.position.set(dir.x * CFG.plateR, caseY, dir.z * CFG.plateR);
      g.rotation.y = -ang;
      g.traverse((o) => { o.castShadow = true; });
      tag(g, act);
      root.add(g);
      pressables.push({ mesh: g, rest: g.position.clone(), inDir: dir.clone().multiplyScalar(-1), act });
    };
    mkButton(0, "wind", true);      // crown — wind
    mkButton(24, "still", false);   // upper pusher — still / run
    mkButton(-24, "speed", false);  // lower pusher — cycle speed

    // ── interactions: tap a part for sound · haptic · tape (like the site) ──
    const windKick = { v: 0 };
    const wind = () => {
      try { getFieldAudio().bell(); window.setTimeout(() => { try { getFieldAudio().playNote(67, 90); } catch { /* noop */ } }, 70); } catch { /* noop */ }
      windKick.v = 0.5; haptics.roll();
      useField.getState().recordTape("object", 0.6, "tourbillon/wind");
    };
    const press = (act: string) => {
      const rec = pressables.find((p) => p.act === act);
      if (rec) { pressAnim.rec = rec; pressAnim.t0 = performance.now(); }
    };
    const handleHit = (act: string | undefined, intensity = 0.5) => {
      const a = getFieldAudio();
      if (!act) { try { a.playNote(57, 60 + Math.round(intensity * 90)); } catch { /* noop */ } haptics.tap(); useField.getState().recordTape("object", 0.2 + intensity * 0.3, "tourbillon/plate"); return; }
      if (act === "wind") { wind(); press("wind"); return; }
      if (act === "still") { const next = speedRef.current === 0 ? 1 : 0; pickSpeed(next); press("still"); return; }
      if (act === "speed") { const order = [0, 1, 30, 300]; pickSpeed(order[(order.indexOf(speedRef.current) + 1) % order.length]); press("speed"); return; }
      if (act === "balance") { try { a.chime(); } catch { /* noop */ } haptics.ripple(0.35 + intensity * 0.5); useField.getState().recordTape("sigil", 0.5 + intensity * 0.4, "tourbillon/balance"); return; }
      if (act.startsWith("gear")) { try { a.playNote(GEAR_PITCH[act] ?? 60, 120 + Math.round(intensity * 120)); } catch { /* noop */ } haptics.tap(); useField.getState().recordTape("object", 0.3 + intensity * 0.4, `tourbillon/${act}`); return; }
    };
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const actAt = (clientX: number, clientY: number): string | undefined => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObject(root, true);
      if (!hits.length) return undefined;
      let o: THREE.Object3D | null = hits[0].object;
      while (o) { if (o.userData && o.userData.act) return o.userData.act as string; o = o.parent; }
      return undefined;
    };

    // ── the vessel: real gravity, real agitation, real touch on the case ──
    // lean.tx/tz are the target lean (device tilt, or its stand-ins); leanX/Z
    // (declared with the animation state below) are the eased values the
    // case actually renders. No tilt sensor ever fully replaces another
    // sense: a light idle drift keeps the case alive with nobody touching
    // it, and on desktop the cursor's offset from centre stands in for tilt
    // (grammar's "hover ≈ light touch" equivalence) until a real gyroscope
    // reports in.
    const lean = { tx: 0, tz: 0 };
    let haveTilt = false;
    let lastHoverAt = 0;
    let night = false;
    const onHoverMove = (ev: PointerEvent) => {
      if (haveTilt) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const nx = ((ev.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      const ny = ((ev.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1;
      lean.tx = Math.max(-1, Math.min(1, nx * 0.6));
      lean.tz = Math.max(-1, Math.min(1, ny * 0.6));
      lastHoverAt = performance.now();
    };
    renderer.domElement.addEventListener("pointermove", onHoverMove);
    const detachVessel = onVessel({
      tilt: ({ beta, gamma }) => {
        if (reduced) return;
        haveTilt = true;
        lastHoverAt = performance.now();
        lean.tx = Math.max(-1, Math.min(1, gamma / 45));
        lean.tz = Math.max(-1, Math.min(1, (beta - 45) / 45));
      },
      shake: ({ intensity }) => {
        if (reduced) return;
        stirTurbulence(Math.min(0.5, intensity * 0.4));
        escapeKick.amp = Math.max(escapeKick.amp, Math.min(0.7, 0.3 + intensity * 0.3));
        escapeKick.at = performance.now();
        try { haptics.chop(); } catch { /* noop */ }
        useField.getState().recordTape("ripple", 0.5, "tourbillon/shake");
      },
      knock: () => {
        // a knock on the case's own body — answered exactly like a flick:
        // the balance swings wide, then the hairspring gathers it back
        escapeKick.amp = Math.max(escapeKick.amp, 0.45);
        escapeKick.at = performance.now();
        try { getFieldAudio().chime(); } catch { /* noop */ }
        try { haptics.ripple(0.5); } catch { /* noop */ }
        useField.getState().recordTape("ripple", 0.5, "tourbillon/knock-case");
      },
      flip: ({ faceDown }) => { night = faceDown; },
    });

    // ── gestures (the shared grammar — src/lib/gesture) ────────────────
    // One finger touches the matter: tap a part and it speaks; a flick
    // knocks the balance wide; a circling finger turns the crown; a
    // ceremony hold sets the watch to true local time. Two fingers twist
    // the lens: dial ↔ open movement, and a two-finger tap steps the camera
    // back. Three fingers touch the law: drag winds the mainspring, hold
    // dilates time, twist cycles the dial's finish, and a tutti tap rings
    // every gear at once. OrbitControls keeps the camera (its pinch is the
    // frame, not a room binding); the engine rides the same canvas without
    // capturing the stream.
    const escapeKick = { amp: 0, at: 0 };            // flick → balance swings wide
    const entrainT = { bpm: 0, until: 0, lastBeat: -1 };
    const timeScale = { cur: 1, target: 1 };
    let lastGestureAt = performance.now();
    let twistAcc = 0;
    let twist3Acc = 0;
    let ceremonyDone = false;
    let lastCrankAt = 0;
    let lastWindCueAt = 0;

    const stepBack = () => {
      const dir = camera.position.clone().sub(controls.target);
      const d = dir.length();
      if (d < 1e-4) return;
      const nd = Math.min(controls.maxDistance, d * 1.22);
      camera.position.copy(controls.target).add(dir.normalize().multiplyScalar(nd));
      controls.update();
      try { haptics.tap(); } catch { /* noop */ }
      try { getFieldAudio().playNote(50, 140); } catch { /* noop */ }
    };
    // Current OrbitControls distance re-expressed in the RoomZoomSpec's
    // domain: zoom = MAX_CAM_DISTANCE / distance, so distance=MAX gives
    // zoomMin (widest — band ceiling) and distance=MIN gives zoomMax
    // (tightest — band floor). scaleForRoomZoom does the log map.
    const zoomFromCamera = () =>
      MAX_CAM_DISTANCE / Math.max(1e-4, camera.position.distanceTo(controls.target));
    const tutti = (intensity = 0.5) => {
      // one synchronized pulse of everything alive — scaled by how hard
      // the chord landed: the balance swings wider, the ratchet surges more
      const a = getFieldAudio();
      const order: Array<[string, THREE.Object3D]> = [
        ["gear-center", center.group], ["gear-third", third.group],
        ["gear-fourth", fourth.group], ["gear-escape", escape.group],
      ];
      order.forEach(([act], i) => {
        window.setTimeout(() => { try { a.playNote(GEAR_PITCH[act] ?? 60, 90); } catch { /* noop */ } }, i * 45);
      });
      try { a.chime(); } catch { /* noop */ }
      escapeKick.amp = Math.max(escapeKick.amp, 0.35 + intensity * 0.35);
      escapeKick.at = performance.now();
      windKick.v = Math.min(1, windKick.v + 0.25 + intensity * 0.3);
      try { haptics.ripple(0.4 + intensity * 0.4); } catch { /* noop */ }
      useField.getState().recordTape("sigil", 0.4 + intensity * 0.4, "tourbillon/tutti");
    };
    // the repeater — the rapid-tap train (grammar tiers 1 / 3 / 5 / n)
    // strikes the movement's own complications
    const strike = (count: number, high: boolean, gapMs: number) => {
      const a = getFieldAudio();
      for (let i = 0; i < count; i++) {
        window.setTimeout(() => { try { a.playNote(high ? 84 : 72, 140); } catch { /* noop */ } }, i * gapMs);
      }
    };

    const detachGestures = attachGestures(renderer.domElement, {
      tap: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers === 2) { stepBack(); return; }
        if (e.fingers === 3) { tutti(e.intensity); return; }
        if (e.fingers !== 1) return;
        const tier = tapTrainTier(e.count);
        const depth = tapTrainDepth(e.count);
        if (tier === 3) {
          // three rapid taps: the quarter repeater — the two-tone
          // ding-dong of a minute repeater striking a quarter
          strike(1, true, 0);
          window.setTimeout(() => strike(1, false, 0), 160);
          escapeKick.amp = Math.max(escapeKick.amp, 0.25 + e.intensity * 0.2);
          escapeKick.at = performance.now();
          try { haptics.roll(); } catch { /* noop */ }
          useField.getState().recordTape("sigil", 0.55, "tourbillon/quarter-repeater");
          return;
        }
        if (tier === 5) {
          // five: the hour strike — the gong counts the hour the hands
          // are actually telling, one low blow per hour
          const hour = (Math.floor(simAccum / 3600) % 12) || 12;
          strike(hour, false, 260);
          windKick.v = Math.min(1.2, windKick.v + 0.3);
          try { haptics.bloom(); } catch { /* noop */ }
          useField.getState().recordTape("kept", 0.7, "tourbillon/hour-strike");
          return;
        }
        if (tier === "n") {
          // seven and beyond: grande sonnerie — every gear rings in
          // train order, the mainspring surges, deeper with every strike
          tutti(Math.min(1, 0.5 + depth * 0.5));
          windKick.v = Math.min(1.2, windKick.v + 0.3 + depth * 0.4);
          try { haptics.storm(); } catch { /* noop */ }
          useField.getState().recordTape("ripple", 0.6 + depth * 0.3, "tourbillon/sonnerie");
          return;
        }
        handleHit(actAt(e.x, e.y), e.intensity);
      },
      flick: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers !== 1) return;
        // a flick is a watchmaker's knock: the balance swings wide, rings,
        // then the hairspring gathers it back
        escapeKick.amp = Math.min(0.6, 0.25 + e.speed * 0.2);
        escapeKick.at = performance.now();
        try { getFieldAudio().chime(); } catch { /* noop */ }
        try { haptics.ripple(0.5); } catch { /* noop */ }
        useField.getState().recordTape("ripple", 0.55, "tourbillon/knock");
      },
      scrub: (e) => {
        lastGestureAt = performance.now();
        const now = performance.now();
        if (now - lastCrankAt < 420) return;
        lastCrankAt = now;
        // a circling finger turns the crown — the ratchet clicks over,
        // and a faster wrist pours more wind in per pass
        windKick.v = Math.min(1.1, windKick.v + 0.25 + Math.min(0.35, Math.abs(e.angularVelocity) * 0.12));
        try { getFieldAudio().playNote(62 + ((Math.abs(Math.round(e.winding)) % 3) * 2), 70); } catch { /* noop */ }
        try { haptics.tap(); } catch { /* noop */ }
        useField.getState().recordTape("object", 0.45, "tourbillon/crank");
      },
      drag: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers !== 3 || e.phase === "end") return;
        // three fingers drag the law: wind pours into the mainspring —
        // the barrel and ratchet surge with the stroke
        windKick.v = Math.min(1.2, windKick.v + Math.hypot(e.dx, e.dy) * 0.004);
        const now = performance.now();
        if (now - lastWindCueAt > 500) {
          lastWindCueAt = now;
          try { getFieldAudio().playNote(43, 160); } catch { /* noop */ }
          try { haptics.chop(); } catch { /* noop */ }
          useField.getState().recordTape("region", 0.5, "tourbillon/mainspring");
        }
      },
      hold: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers === 3) {
          // three fingers hold the law: the whole train keeps slowing the
          // longer the chord is held — toward 1/8 by the ceremony tier,
          // never the same at 900ms as at 2400ms
          if (e.phase === "release") { timeScale.target = 1; return; }
          timeScale.target = Math.max(0.125, 1 - 0.875 * Math.min(1, e.elapsed / THRESHOLDS.ceremonyMs));
          if (e.phase === "enter") {
            try { getFieldAudio().playNote(36, 260); } catch { /* noop */ }
            try { haptics.tap(); } catch { /* noop */ }
          }
          return;
        }
        if (e.fingers !== 1) return;
        if (e.phase === "enter") ceremonyDone = false;
        if (e.phase === "release") { ceremonyDone = false; return; }
        // ceremony — the room's one solemn act: the watch is set. It
        // returns to real time, synchronised to this very moment.
        if (e.tier >= 3 && !ceremonyDone) {
          ceremonyDone = true;
          resyncRef.current = true;
          if (speedRef.current !== 1) pickSpeedRef.current(1);
          try { getFieldAudio().bell(); } catch { /* noop */ }
          try { haptics.bloom(); } catch { /* noop */ }
          useField.getState().recordTape("kept", 0.85, "tourbillon/set");
        }
      },
      twist: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers === 3) {
          // three fingers turn the season: the dial's finish cycles instead
          // — genève, aventurine, nacre are this room's seasons
          if (e.phase === "start") twist3Acc = 0;
          if (e.phase === "move") twist3Acc += e.angle;
          if (e.phase === "end" && Math.abs(twist3Acc) > 0.9) {
            const dir = twist3Acc > 0 ? 1 : -1;
            faceIdxRef.current = (faceIdxRef.current + dir + FACES.length) % FACES.length;
            const f = FACES[faceIdxRef.current];
            swapFaceRef.current?.(f);
            setFace(f);
            try { getFieldAudio().chime(); } catch { /* noop */ }
            try { haptics.lens(); } catch { /* noop */ }
            useField.getState().recordTape("object", 0.5, `tourbillon/face/${f}`);
          }
          return;
        }
        // two fingers rotate the lens: the same hour as chapter ring or as
        // bare going train — dial on, dial off
        if (e.phase === "start") twistAcc = 0;
        if (e.phase === "move") twistAcc += e.angle;
        if (e.phase === "end" && Math.abs(twistAcc) > 0.9) {
          toggleDialRef.current();
          try { haptics.lens(); } catch { /* noop */ }
        }
      },
      rhythm: (e) => {
        // tap a steady beat and the escapement beats audibly with you
        if (e.stability <= 0.7 || e.bpm < 40 || e.bpm > 220) return;
        lastGestureAt = performance.now();
        entrainT.bpm = e.bpm;
        entrainT.until = performance.now() + 9000;
        entrainT.lastBeat = -1;
        useField.getState().recordTape("sigil", 0.5, "tourbillon/entrain");
      },
      span: (e) => {
        lastGestureAt = performance.now();
        // two still fingers hold the movement: hacking seconds — the
        // watchmaker's stop that stills the balance to set the time true.
        // The train slows further the longer the interval is sustained,
        // and springs back to full beat the moment the fingers lift.
        if (e.phase === "release") {
          timeScale.target = 1;
          escapeKick.amp = Math.max(escapeKick.amp, 0.3);
          escapeKick.at = performance.now();
          try { getFieldAudio().chime(); } catch { /* noop */ }
          try { haptics.tap(); } catch { /* noop */ }
          useField.getState().recordTape("object", 0.5, "tourbillon/hack-release");
          return;
        }
        timeScale.target = Math.max(0.04, 1 - Math.min(1, e.elapsed / THRESHOLDS.ceremonyMs));
        if (e.phase === "enter") {
          try { getFieldAudio().playNote(48, 200); } catch { /* noop */ }
          try { haptics.tap(); } catch { /* noop */ }
          useField.getState().recordTape("object", 0.45, "tourbillon/hack");
        }
      },
      pinch: (e) => {
        // OrbitControls owns the visible zoom; this handler only reports the
        // attempted pinch velocity to the scale adapter. Inside the room's
        // own range the adapter answers inactive (residualScaleInput), so
        // the report is inert. Only at the widest or tightest camera does
        // continued pinch press become manifold wall pressure and, past
        // TRAVEL_INTENT_MS, travel to the neighboring band.
        if (e.phase === "end") { releaseScaleEdgeRef.current(); return; }
        reportScaleEdgeRef.current(zoomFromCamera(), e.velocity);
      },
    }, { wheelZoom: false, noCapture: true, manageStyle: false });

    // Desktop wheel goes to OrbitControls (wheelZoom: false above); mirror it
    // at capture phase so the adapter sees the same attempted velocity — a
    // wheel-scrub at the deepest/widest orbit reaches the manifold the same
    // way the touch pinch does. Passive so OrbitControls' handler still runs.
    const onWheelReport = (event: WheelEvent) => {
      const attemptedVel = -event.deltaY * 0.0018 * 60;
      reportScaleEdgeRef.current(zoomFromCamera(), attemptedVel);
    };
    renderer.domElement.addEventListener("wheel", onWheelReport, { capture: true, passive: true });

    // ── camera presets (framed from the assembly's bounding sphere) ──
    const box = new THREE.Box3().setFromObject(root);
    const ctr = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const R = sphere.radius;
    const applyView = (name: string) => {
      controls.autoRotate = false;
      const set = (dir: THREE.Vector3, dist: number, t: THREE.Vector3) => {
        camera.position.copy(t).add(dir.clone().normalize().multiplyScalar(dist));
        controls.target.copy(t); controls.update();
      };
      const C0 = ctr.clone();
      const bal = new THREE.Vector3(balancePos.x, 1, balancePos.y);
      const esc = new THREE.Vector3(escapePos.x, 0.6, escapePos.y);
      const trn = new THREE.Vector3(thirdPos.x, 0, thirdPos.y);
      switch (name) {
        case "top": set(new THREE.Vector3(0, 1, 0.0001), R * 2.5, C0); break;
        case "iso": set(new THREE.Vector3(0.7, 1.0, 0.95), R * 2.3, C0); break;
        case "side": set(new THREE.Vector3(0, 0.18, 1), R * 2.6, C0); break;
        case "macro-balance": set(new THREE.Vector3(0.6, 0.9, 1), R * 0.9, bal); break;
        case "macro-escape": set(new THREE.Vector3(0.7, 0.8, 1), R * 0.7, esc); break;
        case "macro-train": set(new THREE.Vector3(0.4, 1.1, 1), R * 1.2, trn); break;
        default: set(new THREE.Vector3(0.7, 1.0, 0.95), R * 2.3, C0);
      }
    };
    applyView(view0);
    applyViewRef.current = applyView;
    controls.autoRotate = spin;

    // hide the global site chrome while inspecting the movement
    const hideStyle = document.createElement("style");
    hideStyle.textContent = ".oda-tape-shell,.oda-field-watch,.oda-candle-mark,.oda-sound-toggle{display:none !important;}";
    document.head.appendChild(hideStyle);

    // expose hooks for the screenshot harness
    (window as unknown as Record<string, unknown>).__tourbillon = {
      setView: (n: string) => { applyView(n); renderer.render(scene, camera); },
      ready: true,
    };

    // ── resize ──
    const resize = () => {
      const w = wrap.clientWidth || 1, h = wrap.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // ── animation ──────────────────────────────────────────────────
    // The escapement releases one escape-wheel tooth per balance cycle, so
    // the fast wheels (escape/fourth/third) and the seconds hand advance in
    // quantised steps — the signature "tick" of a mechanical watch — while
    // the balance itself swings smoothly. At real-time rate this still tells
    // the actual local time; the speed control fast-forwards the whole train.
    let simAccum = (() => {
      const d = new Date();
      return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000;
    })();
    let lastNow = performance.now();
    const TICK = 0.4;          // seconds per escape tooth (15 teeth → 6 s/rev)
    const balHz = 1 / TICK;    // one balance cycle per tooth = 2.5 Hz
    const CAGE_PERIOD = 60;    // one carriage revolution per simulated minute
    let raf = 0;
    let leanX = 0, leanZ = 0;  // eased lean, rendered on the root each frame
    const MAX_LEAN = 0.15;     // radians — a visible lean, never enough to un-mesh a gear

    const tick = () => {
      const sp = speedRef.current;
      const now = performance.now();
      tier = gov.beginFrame(now);
      let dt = (now - lastNow) / 1000; lastNow = now;
      if (dt > 0.1) dt = 0.1;
      // three-finger time dilation eases the whole train to 1/4 speed
      timeScale.cur += (timeScale.target - timeScale.cur) * Math.min(1, dt * 5);

      // the case's lean: real device tilt when granted, the cursor's offset
      // as a light-touch stand-in, and — since a watch is alive whether or
      // not a hand is near it — a slow autonomous drift once both have been
      // quiet for a few seconds. Never a switch: the drift fades in and the
      // moment either sense reports again, it fades back out.
      if (!reduced) {
        const idleFor = now - lastHoverAt;
        if (!haveTilt && idleFor > 3500) {
          const drift = Math.min(1, (idleFor - 3500) / 2500);
          const t = now / 1000;
          const driftX = Math.sin(t * 0.11) * 0.55 + Math.sin(t * 0.033) * 0.25;
          const driftZ = Math.cos(t * 0.085) * 0.5;
          lean.tx = lean.tx * (1 - drift) + driftX * drift;
          lean.tz = lean.tz * (1 - drift) + driftZ * drift;
        }
        leanX += (lean.tx - leanX) * Math.min(1, dt * 1.8);
        leanZ += (lean.tz - leanZ) * Math.min(1, dt * 1.8);
      }
      root.rotation.x = leanZ * MAX_LEAN;
      root.rotation.z = -leanX * MAX_LEAN;
      if (resyncRef.current) {
        const d = new Date();
        simAccum = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000;
        resyncRef.current = false;
      }
      simAccum += dt * sp * timeScale.cur; // still mode (sp=0) freezes the whole train
      const simSec = simAccum;

      // the escapement beats with a steadily tapped hand — an audible tick
      // and a visible pulse of the balance on every beat, for a while
      let entrainPulse = 0;
      if (now < entrainT.until && entrainT.bpm > 0) {
        const beatLen = 60000 / entrainT.bpm;
        const beatIdx = Math.floor(now / beatLen);
        if (beatIdx !== entrainT.lastBeat) {
          entrainT.lastBeat = beatIdx;
          try { getFieldAudio().playNote(76 + (beatIdx % 2) * 3, 30); } catch { /* noop */ }
        }
        if (!reduced) entrainPulse = Math.max(0, 1 - ((now % beatLen) / beatLen) * 3) * 0.16;
      }
      // a knock rings down: the balance swings wide then gathers back
      const kickAge = (now - escapeKick.at) / 1000;
      const kick = !reduced && escapeKick.amp > 0 && kickAge < 2.4 ? escapeKick.amp * Math.exp(-kickAge * 1.8) : 0;

      const tEff = Math.floor(simSec / TICK) * TICK; // quantised time for fast wheels

      // the cage's own slow turn — a full revolution every simulated minute,
      // riding the same clock (and speed/dilation) as everything else. This
      // is the correction itself: whatever the case's instantaneous lean,
      // the escapement spends equal time in every orientation.
      const cagePhase = (simSec / CAGE_PERIOD) * Math.PI * 2;
      cage.rotation.y = cagePhase;
      const leanMag = Math.min(1, Math.hypot(leanX, leanZ));
      const leanHeading = Math.atan2(leanZ, leanX);
      // instantaneous positional bias the cage is in the middle of averaging
      // to zero: at leanMag's peak, without the cage this would be a fixed
      // rate error; with it, the sign flips every half-turn.
      const gravityBias = leanMag * Math.cos(cagePhase - leanHeading);
      if (!reduced) stirTurbulence(Math.min(0.02, Math.abs(gravityBias) * dt * 0.05));
      const storm = relaxTurbulence(now);
      void storm; // read each frame so this room's own decay owns the shared axis

      for (let i = 0; i < stations.length; i++) {
        const s = stations[i];
        const smooth = s === center || s === barrel;
        s.group.rotation.y = s.omega * (smooth ? simSec : tEff);
      }
      windKick.v *= 0.9;
      drum.rotation.y = barrel.omega * simSec + windKick.v;
      ratchet.rotation.y = barrel.omega * simSec + windKick.v * 1.6;

      // balance: smooth SHM; pallet fork snaps with the tick. A knock or an
      // entrained beat widens the swing without touching the timekeeping.
      const ph = simSec * balHz;
      balance.rotation.y = Math.sin(ph * Math.PI * 2) * (1.05 + kick + entrainPulse);
      fork.rotation.y = (Math.floor(ph * 2) % 2 ? 1 : -1) * 0.17;

      // the balance rim reads the instantaneous bias the cage is fighting:
      // warm amber when this instant is running fast, cool blue when slow,
      // dark when it passes through zero — sight answering the same signal
      // the haptics and the shared turbulence axis just felt.
      matBalance.emissive.setRGB(
        0.14 + Math.max(0, gravityBias) * 0.7,
        0.1 + Math.abs(gravityBias) * 0.08,
        0.16 + Math.max(0, -gravityBias) * 0.75,
      );
      matBalance.emissiveIntensity = 0.25 + Math.abs(gravityBias) * 0.55;

      // glimmer (grammar §6): after ~20s untouched the rim light breathes
      // over the case — a glint where a hand would land, never text
      if (!reduced && now - lastGestureAt > 20000) {
        rim.intensity = 1.1 + (0.5 + Math.sin(now / 480) * 0.5) * 0.7;
      } else {
        rim.intensity = 1.1;
      }
      // face-down puts the room to sleep: the case dims until it's turned back
      renderer.toneMappingExposure = night ? CFG.exposure * 0.4 : CFG.exposure;

      // hands: hour/minute smooth, seconds steps with the escapement
      hourHand.rotation.y = -((simSec / 3600) % 12) / 12 * Math.PI * 2;
      minuteHand.rotation.y = -((simSec / 60) % 60) / 60 * Math.PI * 2;
      secGroup.rotation.y = -((tEff % 60) / 60) * Math.PI * 2;

      // button press-in animation
      for (let i = 0; i < pressables.length; i++) pressables[i].mesh.position.copy(pressables[i].rest);
      if (pressAnim.rec) {
        const el = now - pressAnim.t0;
        if (el < 170) {
          const d = Math.sin((el / 170) * Math.PI) * 0.24;
          pressAnim.rec.mesh.position.copy(pressAnim.rec.rest).addScaledVector(pressAnim.rec.inDir, d);
        } else pressAnim.rec = null;
      }

      if (clockRef.current) {
        const s = Math.floor(simSec) % 86400;
        const hh = String(Math.floor(s / 3600) % 24).padStart(2, "0");
        const mm = String(Math.floor(s / 60) % 60).padStart(2, "0");
        const ss = String(s % 60).padStart(2, "0");
        clockRef.current.textContent = `${hh}:${mm}:${ss}`;
      }

      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    // pause entirely while the tab is hidden — a hidden watch still keeps
    // real time (simAccum keeps summing dt on the next visible frame via
    // lastNow), it simply spends no frames rendering nobody is watching
    let galleryPaused = false;
    const onVisibility = () => {
      if (document.hidden || galleryPaused) {
        cancelAnimationFrame(raf);
      } else {
        lastNow = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    const ungal = onGalleryPause((p) => {
      galleryPaused = p;
      onVisibility();
    });

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      ungal();
      ro.disconnect();
      detachGestures();
      detachVessel();
      renderer.domElement.removeEventListener("pointermove", onHoverMove);
      renderer.domElement.removeEventListener("wheel", onWheelReport, { capture: true } as EventListenerOptions);
      controls.dispose();
      renderer.dispose();
      pmrem.dispose();
      hideStyle.remove();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    };
  }, []);

  const speedLabel = SPEEDS.find((option) => option.v === speed)?.label ?? `${speed}×`;

  return (
    <div
      ref={wrapRef}
      className="tourbillon-instrument"
      data-touch-surface="true"
      style={{ position: "fixed", inset: 0, background: "#0a0b0e" }}
    >
      <div className="tb-hud">
        <div className="tb-title">
          objet&nbsp;d&apos;art — calibre OD·1 <span className="tb-clock" ref={clockRef}>--:--:--</span>
        </div>
        <MobileInstrumentPanel
          title="calibre controls"
          triggerLabel="tune"
          summary={`${speedLabel} · ${face} · ${view.replace("macro-", "")}`}
        >
          <div className="tb-console">
            <div className="tb-row" role="group" aria-label="tourbillon speed">
              {SPEEDS.map((s) => (
                <button key={s.v} type="button" className={speed === s.v ? "on" : ""}
                  aria-pressed={speed === s.v}
                  onClick={() => pickSpeed(s.v)}>{s.label}</button>
              ))}
            </div>
            <div className="tb-row" role="group" aria-label="tourbillon finish">
              {FACES.map((f) => (
                <button key={f} type="button" className={face === f ? "on" : ""}
                  aria-pressed={face === f}
                  onClick={() => { faceIdxRef.current = FACES.indexOf(f); swapFaceRef.current?.(f); setFace(f); try { getFieldAudio().chime(); } catch { /* noop */ } haptics.tap(); useField.getState().recordTape("object", 0.5, `tourbillon/face/${f}`); }}>{f}</button>
              ))}
              <button type="button" className={dialOn ? "on" : ""} aria-pressed={dialOn} onClick={toggleDial}>{dialOn ? "dial" : "open"}</button>
            </div>
            <div className="tb-row" role="group" aria-label="camera view">
              {VIEWS.map((v) => (
                <button key={v} type="button" className={view === v ? "on" : ""}
                  aria-pressed={view === v}
                  onClick={() => { applyViewRef.current?.(v); setView(v); }}>{v.replace("macro-", "")}</button>
              ))}
            </div>
          </div>
        </MobileInstrumentPanel>
        <div className="tb-hint" aria-hidden="true">drag to orbit · tap parts to play · pinch to zoom</div>
      </div>
      <div className="tb-sundial-wrap"><SundialChip /></div>
      {scaleEdgeOverlay}
      <style dangerouslySetInnerHTML={{ __html: `
        .tb-hud {
          position: absolute; left: 0; top: 0;
          padding: calc(64px + env(safe-area-inset-top, 0px)) 16px 16px 16px;
          display: grid; gap: 8px; justify-items: start;
          pointer-events: none; z-index: 11;
          font-family: var(--font-mono, ui-monospace, monospace);
        }
        .tb-title {
          font-family: var(--font-fraunces, Georgia, serif);
          font-size: 15px; letter-spacing: 0.4px;
          color: rgba(242,238,230,0.92);
          text-shadow: 0 1px 8px rgba(0,0,0,0.6);
        }
        .tb-clock { color: #e7c873; margin-left: 8px; font-variant-numeric: tabular-nums; }
        .tb-row { display: flex; gap: 6px; flex-wrap: wrap; pointer-events: auto; }
        .tb-console { display: grid; gap: 8px; justify-items: start; }
        .tb-row button {
          appearance: none; cursor: pointer;
          border: 1px solid rgba(231,211,154,0.3);
          background: rgba(12,13,16,0.55); backdrop-filter: blur(6px);
          color: rgba(242,238,230,0.82);
          font-size: 11px; letter-spacing: 0.3px; text-transform: lowercase;
          padding: 7px 11px; border-radius: 7px;
          transition: background 0.18s ease, color 0.18s ease, border-color 0.18s ease;
        }
        .tb-row button:hover { border-color: rgba(231,211,154,0.6); color: #f4ecd6; }
        .tb-row button.on { background: rgba(231,211,154,0.18); border-color: rgba(231,211,154,0.8); color: #f6e6b4; }
        .tb-hint {
          font-size: 10px; letter-spacing: 0.3px; text-transform: lowercase;
          color: rgba(242,238,230,0.4); text-shadow: 0 1px 6px rgba(0,0,0,0.6);
        }
        .tb-sundial-wrap {
          position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%);
          z-index: 10; pointer-events: auto; width: 168px;
          filter: drop-shadow(0 10px 24px rgba(0,0,0,0.5));
        }
        .tb-sundial svg { width: 100%; height: auto; display: block; }
        .tb-sun-time {
          font-family: var(--font-fraunces, Georgia, serif); font-size: 13px;
          fill: #f0d68a; letter-spacing: 1px; font-variant-numeric: tabular-nums;
        }
        @media (max-width: 720px) {
          .tb-hud {
            right: 0;
            padding: calc(54px + env(safe-area-inset-top, 0px)) 16px 16px;
          }
          .tb-title { font-size: 12px; }
          .tb-hint {
            max-width: min(72vw, 330px);
            font-size: 9px;
            line-height: 1.45;
          }
          .tb-console {
            width: 100%;
            gap: 12px;
          }
          .tb-row {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            width: 100%;
            gap: 7px;
          }
          .tb-row:first-child { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .tb-row button {
            min-height: 44px;
            padding: 8px 7px;
          }
          .tourbillon-instrument .mobile-instrument-panel__trigger {
            right: max(14px, env(safe-area-inset-right, 0px));
            left: auto;
            border-color: rgba(231,211,154,0.48);
            pointer-events: auto;
          }
          .tb-sundial-wrap {
            right: 14px;
            bottom: calc(118px + env(safe-area-inset-bottom, 0px));
            left: auto;
            width: 116px;
            transform: none;
          }
        }
      ` }} />
    </div>
  );
}
