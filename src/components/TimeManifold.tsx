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
import { attachGestures } from "@/lib/gesture";
import { relaxTurbulence, stirTurbulence } from "@/lib/turbulence";
import { onVessel } from "@/lib/vessel";
import { useField } from "@/store/field";
import MobileInstrumentPanel, { MOBILE_QUERY } from "@/components/MobileInstrumentPanel";
import {
  createFrameGovernor,
  detailForTier,
  isEmbeddedFrame,
  onVisibility,
  resolveDpr,
} from "@/lib/room-runtime";

/**
 * /time — a playable relativity instrument.
 *
 * The hero is a mass-warped spacetime manifold. A worldline climbs out of the
 * observer's origin; dragging left/right sets VELOCITY (the worldline tilts
 * toward the 45° light cone), dragging up/down sets MASS (the grid curves into
 * a gravity well). Two clocks sit side by side — coordinate time runs at the
 * full rate while proper time falls behind by the Lorentz factor
 * γ = 1/√(1−v²/c²), so proper = elapsed / γ. Ticks strung along the worldline
 * mark equal intervals of proper time; as v rises they spread apart, which is
 * the whole story: speed up, and your own clock runs slow.
 *
 * Fingers address the stack (docs/gesture-grammar.md §3). One finger touches
 * the material — velocity, mass, the traveller. Two fingers touch the frame:
 * a twist rotates the LENS along one continuous axis — the worldline, then
 * duration as it is felt, then the bare metric — and a two-finger drag pans
 * the frame over the manifold. Three fingers touch the law. The device is the
 * vessel: its real lean is real gravity, and the mass slides downhill with the
 * weight of something heavy.
 */

const TAU = Math.PI * 2;
const VMAX = 0.985;
const SECONDS_PER_CLIMB = 12; // coordinate seconds spanned by the visible worldline
const BREATH_MS = 7000; // the site's one shared clock (AGENTS.md: "one clock family")

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const gammaOf = (v: number) => 1 / Math.sqrt(Math.max(1e-4, 1 - v * v));

function colorAlpha(hex: string, alpha: number) {
  const clean = hex.replace("#", "");
  const n = parseInt(
    clean.length === 3 ? clean.split("").map((ch) => ch + ch).join("") : clean,
    16,
  );
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function formatTime(ms: number) {
  const total = Math.max(0, Math.floor(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const hundredths = Math.floor((total % 1000) / 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

const GEO = "#ffcf7a";   // worldline / proper geodesic
const LIGHT = "#7fb0ff"; // light cone
const WELL = "#ff8f6a";  // mass well
const INK = "rgba(246, 241, 224, 0.94)";

export default function TimeManifold() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const velRef = useRef(0.42);   // |v|/c magnitude
  const dirRef = useRef(1);      // tilt direction of the worldline (+right / -left)
  const massRef = useRef(38);    // 0..100
  const runningRef = useRef(true);
  const coordRef = useRef(0);    // coordinate time (ms)
  const properRef = useRef(0);   // proper time (ms)
  const lastTickRef = useRef(0); // last whole proper-second that chimed
  const reduceRef = useRef(false);
  const lastSyncRef = useRef(0);
  const lastToneRef = useRef(0);
  const lastControlRef = useRef(0);
  // ── gesture-grammar state (law layer) ──
  // The flow of the room's clock rides the shared calm↔storm axis
  // (lib/turbulence): three fingers and a shaken vessel stir the same scalar,
  // and this ref only remembers which way the drift was pushed.
  const flowRef = useRef({ cur: 0, dir: 1 });
  const timeScaleRef = useRef({ cur: 1, target: 1 }); // 3-finger hold: time dilation ×0.25
  const entrainRef = useRef({ bpm: 0, until: 0, lastBeat: -1 });
  const pulseRef = useRef(0);        // traveller glow on entrained beats
  const ceremonyAtRef = useRef(-1e9); // ring flash when the well is sealed
  const lastGestureAtRef = useRef(0);
  // ── frame layer (two fingers) ──
  const lensRef = useRef({ cur: 0, target: 0 }); // 0 worldline · 1 felt duration · 2 metric
  const panRef = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  // ── law layer, angular channel (three-finger twist) ──
  // the room's slow cycle is cosmic epoch: 0 young and hot, 1 late and cold.
  // it tints the manifold's own palette and drifts the well's idle hum —
  // a season the hand can turn forward or back, never a switch.
  const epochRef = useRef({ cur: 0.18, target: 0.18 });
  // ── vessel layer (the device) ──
  // Gravity's lean is a mass on a spring, not a reading: the target comes
  // from the smoothed tilt, and the well takes about a second to settle.
  const leanRef = useRef({ cur: 0, vel: 0, target: 0 });
  const nightRef = useRef({ cur: 0, target: 0 });
  const knockAtRef = useRef(-1e9);
  const tuttiRef = useRef(0);
  // idle life: the well never stops radiating on its own, jittered like
  // /ocean's weather — see the scheduler in the draw loop below.
  const radiateAtRef = useRef(-1e9);
  const nextRadiateAtRef = useRef(-1);

  const recordTape = useField((s) => s.recordTape);

  const [velocity, setVelocity] = useState(0.42);
  const [mass, setMass] = useState(38);
  // this room's subject is the passage of time, so the clocks run and keep
  // diverging from the moment you arrive — nobody has to press start for
  // time to pass. Pausing stays a real, deliberate act: the room's one
  // stillness a hand can choose, not its resting state.
  const [running, setRunning] = useState(true);
  const [readout, setReadout] = useState("proper 00:00.00 · γ 1.10 · v/c 0.420");

  useEffect(() => { velRef.current = velocity; }, [velocity]);
  useEffect(() => { massRef.current = mass; }, [mass]);
  useEffect(() => { runningRef.current = running; }, [running]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduceRef.current = mq.matches;
    const update = () => { reduceRef.current = mq.matches; };
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  // ── the heartbeat: integrate the two clocks + paint the manifold ──
  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let raf = 0;
    let last = performance.now();
    // clock faces (60 ticks × 2 dials) never change shape between frames —
    // cache them to an offscreen sprite per (radius, accent) instead of
    // walking the 60-iteration loop every frame.
    const tickSprites = new Map<string, HTMLCanvasElement>();
    if (nextRadiateAtRef.current < 0) {
      nextRadiateAtRef.current = last + 5000 + Math.random() * 6000;
    }

    // ── performance contract (room-runtime): a frame governor picks a
    // quality tier from real frame time, and the DPR ceiling + a hard sleep
    // while hidden ride on it. Nothing here draws while the tab can't see it.
    // (offVis is wired up below, once `draw` exists — onVisibility fires
    // immediately on subscribe and must not close over a not-yet-declared const.)
    const gov = createFrameGovernor();
    let sleeping = false;

    const resize = () => {
      const rect = root.getBoundingClientRect();
      const dpr = resolveDpr(gov.tier(), {
        embedded: isEmbeddedFrame(),
        reducedMotion: reduceRef.current,
      });
      width = Math.max(320, Math.floor(rect.width));
      height = Math.max(480, Math.floor(rect.height));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      tickSprites.clear(); // dpr changed — cached clock faces are stale
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(root);
    window.addEventListener("resize", resize);

    const draw = (now: number) => {
      const delta = Math.min(60, now - last);
      last = now;
      const tier = gov.beginFrame(now);
      if (sleeping) { raf = 0; return; } // no draw while hidden — resumed by onVisibility
      const detail = detailForTier(tier);

      const reduce = reduceRef.current;
      const vel = velRef.current;
      const dir = dirRef.current;
      const massN = massRef.current / 100;
      const gamma = gammaOf(vel);

      // ── the law layer (gesture grammar): three fingers held dilate the
      // room's clock; three fingers dragged push the flow of time itself;
      // a steady tapped pulse entrains the clocks to the hand's tempo ──
      const ts = timeScaleRef.current;
      ts.cur += (ts.target - ts.cur) * Math.min(1, delta * 0.005);
      // the shared calm↔storm axis carries the drift's magnitude; this room
      // owns the frame loop, so it is the one that relaxes it back to glass
      const turb = relaxTurbulence(now);
      const storm = reduce ? 0 : turb;
      const flow = flowRef.current;
      const flowTarget = flow.dir > 0 ? storm * 2.4 : -storm * 0.85;
      flow.cur += (flowTarget - flow.cur) * Math.min(1, delta * 0.004);
      const entrain = entrainRef.current;
      const entrained = now < entrain.until && entrain.bpm > 0;
      const entrainMul = entrained ? clamp(entrain.bpm / 60, 0.6, 2.4) : 1;
      const rate = ts.cur * (1 + flow.cur) * entrainMul;
      if (entrained) {
        const beatIdx = Math.floor(now / (60000 / entrain.bpm));
        if (beatIdx !== entrain.lastBeat) {
          entrain.lastBeat = beatIdx;
          pulseRef.current = 1;
          try { getFieldAudio().playNote(62 + (beatIdx % 2) * 5, 80); } catch { /* noop */ }
        }
      }
      pulseRef.current *= Math.exp(-delta / 320);
      tuttiRef.current *= Math.exp(-delta / 460);

      // ── idle life: the well never stops radiating ──
      // Spacetime does not hold still while nobody watches: on a jittered
      // schedule (9-17s, like /ocean's weather) the mass rings itself
      // down — a gravitational wave leaves the well, joining the room's
      // one calm↔storm axis so the metric ripples and the clock's own
      // flow briefly races exactly as it would under a real hand's drag.
      // Only reachable while the loop runs, which is only while visible.
      if (now > nextRadiateAtRef.current) {
        nextRadiateAtRef.current = now + 9000 + Math.random() * 8000;
        radiateAtRef.current = now;
        if (!reduce) stirTurbulence(0.16 + massN * 0.14);
        try { getFieldAudio().playNote(30 + Math.round(massN * 6), 900); } catch { /* noop */ }
      }

      // ── the frame layer: the lens turns, the frame slides ──
      const lens = lensRef.current;
      lens.cur += (lens.target - lens.cur) * Math.min(1, delta * 0.011);
      const L = lens.cur;
      const wGeo = clamp(1 - Math.abs(L), 0, 1);
      const wFelt = clamp(1 - Math.abs(L - 1), 0, 1);
      const wMetric = clamp(1 - Math.abs(L - 2), 0, 1);
      const pan = panRef.current;
      pan.x += (pan.tx - pan.x) * Math.min(1, delta * 0.013);
      pan.y += (pan.ty - pan.y) * Math.min(1, delta * 0.013);

      // ── the vessel: the device's lean is gravity, and mass has weight ──
      // A damped spring (ω ≈ 5 rad/s, ζ ≈ 0.5) so the well leans over about a
      // second and settles once — never the twitch of raw orientation.
      const lean = leanRef.current;
      const dtSec = Math.min(0.05, delta / 1000);
      lean.vel += ((reduce ? 0 : lean.target) - lean.cur) * 26 * dtSec;
      lean.vel -= lean.vel * 5.2 * dtSec;
      lean.cur += lean.vel * dtSec;
      const night = nightRef.current;
      night.cur += (night.target - night.cur) * Math.min(1, delta * 0.004);

      // integrate the two clocks — proper time dilates by 1/γ; face-down the
      // room sleeps and both hands stand still
      if (runningRef.current && night.cur < 0.5) {
        coordRef.current += delta * rate;
        properRef.current += (delta * rate) / gamma;
        const ps = Math.floor(properRef.current / 1000);
        if (ps > lastTickRef.current) {
          lastTickRef.current = ps;
          try { getFieldAudio().playNote(62, 120); } catch { /* noop */ }
          try { haptics.tap(); } catch { /* noop */ }
        }
      }

      // ── geometry ──
      const Ox = width * 0.5;
      const Oy = height * 0.86;
      const S = Math.min(width, height);
      // gravity is whichever way the device is really leaning: the mass slides
      // downhill and every curve in the room follows it, because it is the
      // mass that bends them
      const cx = width * 0.5 + lean.cur * S * 0.17;
      const cy = height * 0.42 + Math.abs(lean.cur) * S * 0.03;
      const CLIMB = Oy - height * 0.06;
      const strength = massN * S * 0.5;

      const warp = (x: number, y: number): [number, number] => {
        const dx = x - cx;
        const dy = y - cy;
        const d = Math.hypot(dx, dy) + S * 0.06;
        let pull = strength / d;
        if (pull > 0.9) pull = 0.9;
        return [x - dx * pull, y - dy * pull + pull * pull * S * 0.2];
      };
      const baseAt = (u: number): [number, number] => {
        const up = u * CLIMB;
        return [Ox + dir * vel * up, Oy - up];
      };

      // ── background ──
      const bg = ctx.createLinearGradient(0, 0, 0, height);
      bg.addColorStop(0, "#080611");
      bg.addColorStop(0.55, "#0a0a16");
      bg.addColorStop(1, "#050409");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
      const hx = cx + pan.x;
      const hy = cy + pan.y;
      const halo = ctx.createRadialGradient(hx, hy, 0, hx, hy, S * 0.7);
      halo.addColorStop(0, colorAlpha(WELL, 0.05 + massN * 0.08));
      halo.addColorStop(0.5, "rgba(127, 176, 255, 0.03)");
      halo.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, width, height);

      // everything from here to the dials is the manifold itself, and the
      // frame slides over it under two fingers
      ctx.save();
      ctx.translate(pan.x, pan.y);

      // ── warped spacetime grid ──
      ctx.save();
      ctx.lineWidth = 1;
      const stepX = Math.max(38, width / 16);
      const stepY = Math.max(38, height / 12);
      // the lattice is anchored to the manifold, not the screen: snapping the
      // start to it keeps the line count constant however far the frame slides
      const gx0 = Math.floor((-width * 0.15 - pan.x) / stepX) * stepX;
      const gx1 = width * 1.15 - pan.x;
      const gy0 = Math.floor((height * 0.02 - pan.y) / stepY) * stepY;
      const gy1 = height * 0.98 - pan.y;
      // the lens dims the lattice: at the bare metric it is nearly gone
      const gridA = 0.030 + wGeo * 0.070 + storm * 0.03;
      // lines of constant space (vertical)
      ctx.strokeStyle = `rgba(129, 150, 178, ${gridA.toFixed(3)})`;
      for (let x = gx0; x <= gx1; x += stepX) {
        ctx.beginPath();
        for (let y = gy0; y <= gy1; y += 10) {
          const [wx, wy] = warp(x, y);
          if (y === gy0) ctx.moveTo(wx, wy);
          else ctx.lineTo(wx, wy);
        }
        ctx.stroke();
      }
      // lines of constant time (horizontal)
      ctx.strokeStyle = `rgba(129, 150, 178, ${(gridA * 0.85).toFixed(3)})`;
      for (let y = gy0; y <= gy1; y += stepY) {
        ctx.beginPath();
        for (let x = gx0; x <= gx1; x += 12) {
          const [wx, wy] = warp(x, y);
          if (x === gx0) ctx.moveTo(wx, wy);
          else ctx.lineTo(wx, wy);
        }
        ctx.stroke();
      }
      ctx.restore();

      // ── light cone ──
      const coneUp = CLIMB;
      const lx = Ox - coneUp;
      const rx = Ox + coneUp;
      const topY = Oy - coneUp;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(Ox, Oy);
      ctx.lineTo(lx, topY);
      ctx.lineTo(rx, topY);
      ctx.closePath();
      const coneA = 0.25 + wGeo * 0.75;
      const coneFill = ctx.createLinearGradient(0, Oy, 0, topY);
      coneFill.addColorStop(0, colorAlpha(LIGHT, 0.10 * coneA));
      coneFill.addColorStop(1, "rgba(127, 176, 255, 0)");
      ctx.fillStyle = coneFill;
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.setLineDash([5, 8]);
      ctx.strokeStyle = colorAlpha(LIGHT, 0.4 * coneA);
      ctx.beginPath();
      ctx.moveTo(Ox, Oy); ctx.lineTo(lx, topY);
      ctx.moveTo(Ox, Oy); ctx.lineTo(rx, topY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // ── mass well marker ──
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      // mass settles: a barely-there breath on the site's shared 7s clock,
      // so the well is never quite at rest even when nothing else moves —
      // render-time only, costs a sine, free on a loop that already runs
      const breath = reduce ? 0 : Math.sin((now / BREATH_MS) * TAU) * 0.02;
      const wellR = S * (0.03 + massN * 0.09) * (1 + breath);
      const wg = ctx.createRadialGradient(cx, cy, 0, cx, cy, wellR * 2.4);
      wg.addColorStop(0, colorAlpha(WELL, 0.42 + massN * 0.28));
      wg.addColorStop(0.5, colorAlpha(WELL, 0.16));
      wg.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = wg;
      ctx.beginPath();
      ctx.arc(cx, cy, wellR * 2.4, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = colorAlpha(WELL, 0.9);
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(3, wellR * 0.42), 0, TAU);
      ctx.fill();
      ctx.restore();

      // ── lens 1 · duration as it is felt ──
      // The same climb, told as two ladders: one rung per coordinate second in
      // the light's blue, one per proper second in the traveller's gold. They
      // start together at the origin and open apart as γ rises — the gap is
      // the falling-behind, laid across the whole frame.
      if (wFelt > 0.02) {
        ctx.save();
        ctx.lineWidth = 1.2;
        const span = width * 0.3;
        for (let k = 1; k <= SECONDS_PER_CLIMB; k += 1) {
          const uc = k / SECONDS_PER_CLIMB;
          const up = (k * gamma) / SECONDS_PER_CLIMB;
          const fade = (1 - uc * 0.62) * wFelt;
          const yc = Oy - uc * CLIMB;
          if (yc < height * 0.3) break; // the dials keep the top of the frame
          const wide = span * (1 - uc * 0.42);
          ctx.strokeStyle = colorAlpha(LIGHT, 0.26 * fade);
          ctx.beginPath();
          ctx.moveTo(Ox - wide, yc);
          ctx.lineTo(Ox + wide, yc);
          ctx.stroke();
          if (up > 1) continue;
          const yp = Oy - up * CLIMB;
          const narrow = wide * 0.66;
          // the lag itself, accumulating: a column of light standing between
          // the second you counted and the second you lived
          ctx.fillStyle = colorAlpha(GEO, 0.085 * fade);
          ctx.fillRect(Ox - narrow * 0.24, yp, narrow * 0.48, yc - yp);
          ctx.strokeStyle = colorAlpha(GEO, 0.44 * fade);
          ctx.beginPath();
          ctx.moveTo(Ox - narrow, yp);
          ctx.lineTo(Ox + narrow, yp);
          ctx.stroke();
        }
        ctx.restore();
      }

      // ── lens 2 · the bare metric ──
      // No curve, no traveller: just what the mass does to the light cone at
      // every point. Each little V is the local cone — squeezed and tipped by
      // the well, upright and open far from it.
      if (wMetric > 0.02) {
        ctx.save();
        ctx.lineWidth = 1.1;
        const fieldSparsity = 1 / Math.max(0.4, detail.samples);
        const colStep = Math.max(52, (width / 6) * fieldSparsity);
        const rowStep = Math.max(52, (height / 8) * fieldSparsity);
        const arm = Math.min(colStep, rowStep) * 0.3;
        // anchored to the manifold like the lattice, so the field slides under
        // a panning frame instead of riding along with it
        const mx0 = Math.floor(-pan.x / colStep) * colStep + colStep * 0.5;
        const my0 = Math.floor(-pan.y / rowStep) * rowStep + rowStep * 0.5;
        for (let x = mx0; x < width - pan.x; x += colStep) {
          for (let y = my0; y < height - pan.y; y += rowStep) {
            const dx = x - cx;
            const dy = y - cy;
            const raw = Math.hypot(dx, dy);
            if (raw < S * (0.055 + massN * 0.12)) continue; // the mass keeps its own place
            const d = raw + S * 0.06;
            const pull = Math.min(0.9, strength / d);
            // near the mass the cone closes and tips toward it; far away it
            // stands upright and open — the metric, drawn one point at a time
            const open = Math.max(0.16, (1 - pull * 1.35) * 0.78);
            const tilt = -(dx / d) * pull * 1.1 + dir * vel * 0.5;
            const a0 = -Math.PI / 2 + tilt - open;
            const a1 = -Math.PI / 2 + tilt + open;
            ctx.strokeStyle = colorAlpha(LIGHT, (0.16 + pull * 0.5) * wMetric);
            ctx.beginPath();
            ctx.moveTo(x + Math.cos(a0) * arm, y + Math.sin(a0) * arm);
            ctx.lineTo(x, y);
            ctx.lineTo(x + Math.cos(a1) * arm, y + Math.sin(a1) * arm);
            ctx.stroke();
          }
        }
        ctx.restore();
      }

      // ── worldline (glowing geodesic) ──
      // sample count scales with the frame governor's tier; the glow is a
      // cheap additive pass (two wider, fainter strokes under the line)
      // rather than a per-frame ctx.shadowBlur, which is catastrophic on
      // mobile at this line's length.
      const SAMPLES = Math.max(24, Math.round(90 * detail.samples));
      const lineA = 0.34 + wGeo * 0.61 + wFelt * 0.2;
      const pts: [number, number][] = [];
      const shiver = storm * 3.2;
      for (let i = 0; i <= SAMPLES; i += 1) {
        const [wx, wy] = warp(...baseAt(i / SAMPLES));
        const j = shiver > 0.02 ? Math.sin(i * 1.7 + now * 0.006) * shiver : 0;
        pts.push([wx + j, wy]);
      }
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const strokePath = () => {
        ctx.beginPath();
        pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
        ctx.stroke();
      };
      if (!reduce) {
        ctx.strokeStyle = colorAlpha(GEO, lineA * 0.16);
        ctx.lineWidth = 7 + 4 * (wGeo + wFelt);
        strokePath();
        ctx.strokeStyle = colorAlpha(GEO, lineA * 0.28);
        ctx.lineWidth = 3.6 + 3 * (wGeo + wFelt);
        strokePath();
      }
      ctx.strokeStyle = colorAlpha(GEO, lineA);
      ctx.lineWidth = 1.4 + 2 * (wGeo + wFelt);
      strokePath();
      ctx.restore();

      // ── proper-time ticks strung along the worldline ──
      // proper second k sits at u = k·γ / SECONDS_PER_CLIMB → they spread as γ grows
      ctx.save();
      const du = gamma / SECONDS_PER_CLIMB;
      const tickA = 0.3 + wGeo * 0.7;
      const tutti = tuttiRef.current;
      for (let k = 1; k * du <= 1; k += 1) {
        const u = k * du;
        const [bx, by] = baseAt(u);
        const [b2x, b2y] = baseAt(Math.min(1, u + 0.004));
        const [px, py] = warp(bx, by);
        const [p2x, p2y] = warp(b2x, b2y);
        const ang = Math.atan2(p2y - py, p2x - px) + Math.PI / 2;
        const nx = Math.cos(ang);
        const ny = Math.sin(ang);
        const len = 7 + tutti * 6;
        ctx.strokeStyle = colorAlpha(GEO, (0.7 + tutti * 0.3) * tickA);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(px - nx * len, py - ny * len);
        ctx.lineTo(px + nx * len, py + ny * len);
        ctx.stroke();
        ctx.fillStyle = colorAlpha(GEO, 0.9 * tickA);
        ctx.beginPath();
        ctx.arc(px, py, 2.2 + tutti * 1.6, 0, TAU);
        ctx.fill();
      }
      ctx.restore();

      // ── the traveller climbing the worldline with coordinate time ──
      const prog = (coordRef.current / 1000 % SECONDS_PER_CLIMB) / SECONDS_PER_CLIMB;
      const [tx, ty] = warp(...baseAt(prog));
      // the traveller belongs to the lower lenses; at the bare metric there is
      // no one travelling, only the field
      const travA = clamp(0.2 + (wGeo + wFelt) * 0.8, 0, 1);
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const tg = ctx.createRadialGradient(tx, ty, 0, tx, ty, 22);
      tg.addColorStop(0, colorAlpha("#fff3d6", 0.95 * travA));
      tg.addColorStop(0.4, colorAlpha(GEO, 0.5 * travA));
      tg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = tg;
      ctx.beginPath();
      ctx.arc(tx, ty, 22, 0, TAU);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = colorAlpha("#fff6e2", travA);
      ctx.beginPath();
      ctx.arc(tx, ty, 4.4, 0, TAU);
      ctx.fill();
      // entrained beats pulse the traveller — the clock keeps your tempo
      if (pulseRef.current > 0.03) {
        ctx.strokeStyle = colorAlpha(GEO, 0.5 * pulseRef.current);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(tx, ty, 10 + (1 - pulseRef.current) * 26, 0, TAU);
        ctx.stroke();
      }

      // ceremony flash — the well sealed at full mass
      const sinceCeremony = now - ceremonyAtRef.current;
      if (sinceCeremony > 0 && sinceCeremony < 1100) {
        const p = sinceCeremony / 1100;
        ctx.strokeStyle = colorAlpha(WELL, 0.6 * (1 - p));
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, S * (0.06 + p * 0.34), 0, TAU);
        ctx.stroke();
      }

      // a knock on the case rings the manifold — the wave leaves the mass
      const sinceKnock = now - knockAtRef.current;
      if (sinceKnock > 0 && sinceKnock < 1500) {
        const p = sinceKnock / 1500;
        ctx.strokeStyle = colorAlpha(LIGHT, 0.5 * (1 - p) * (1 - p));
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(cx, cy, S * (0.04 + p * 0.62), 0, TAU);
        ctx.stroke();
      }

      // idle radiation: the same shudder, but the well's own — slower,
      // fainter, unprompted. What a real mass does at rest: it rings down
      // and the ring leaves without anyone having knocked on anything.
      const sinceRadiate = now - radiateAtRef.current;
      if (sinceRadiate > 0 && sinceRadiate < 2400) {
        const p = sinceRadiate / 2400;
        ctx.strokeStyle = colorAlpha(WELL, 0.26 * (1 - p) * (1 - p));
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(cx, cy, S * (0.05 + p * 0.5), 0, TAU);
        ctx.stroke();
      }

      // tutti — everything alive answers at once, from the origin outward
      if (tutti > 0.03) {
        ctx.strokeStyle = `rgba(246, 241, 224, ${(0.24 * tutti).toFixed(3)})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(Ox, Oy, 14 + (1 - tutti) * S * 0.5, 0, TAU);
        ctx.stroke();
      }

      // glimmer (grammar §6): after ~20s of quiet, a faint ring breathes at
      // the origin where a finger would land — physical, never text.
      if (now - lastGestureAtRef.current > 20000) {
        const pulse = reduce ? 0.5 : 0.5 + Math.sin(now / 480) * 0.5;
        ctx.strokeStyle = colorAlpha(GEO, 0.05 + pulse * 0.09);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(Ox, Oy, 18 + pulse * 9, 0, TAU);
        ctx.stroke();
      }

      // ── velocity vector at the origin ──
      const [vTipX, vTipY] = baseAt(0.16);
      ctx.save();
      ctx.strokeStyle = colorAlpha(GEO, 0.85);
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(Ox, Oy);
      ctx.lineTo(vTipX, vTipY);
      ctx.stroke();
      const va = Math.atan2(vTipY - Oy, vTipX - Ox);
      ctx.fillStyle = colorAlpha(GEO, 0.9);
      ctx.beginPath();
      ctx.moveTo(vTipX, vTipY);
      ctx.lineTo(vTipX - Math.cos(va - 0.4) * 10, vTipY - Math.sin(va - 0.4) * 10);
      ctx.lineTo(vTipX - Math.cos(va + 0.4) * 10, vTipY - Math.sin(va + 0.4) * 10);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      // origin node
      ctx.fillStyle = colorAlpha(LIGHT, 0.95);
      ctx.beginPath();
      ctx.arc(Ox, Oy, 5, 0, TAU);
      ctx.fill();

      ctx.restore(); // the frame's slide ends; the dials are furniture

      // ── the two clocks, side by side ──
      const dialX = width * 0.5;
      const cyClock = clamp(height * 0.16, 92, 210);
      const r = clamp(S * 0.088, 40, Math.min(width * 0.2, cyClock - 30));
      const off = r * 1.42;
      drawClock(ctx, tickSprites, dialX - off, cyClock, r, coordRef.current, LIGHT, "coordinate");
      drawClock(ctx, tickSprites, dialX + off, cyClock, r, properRef.current, GEO, "proper");
      // γ bridge between the dials
      ctx.save();
      ctx.fillStyle = "rgba(246, 241, 224, 0.6)";
      ctx.font = `600 ${Math.round(r * 0.34)}px var(--font-numerals, monospace)`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`γ ${gamma.toFixed(2)}`, dialX, cyClock);
      ctx.restore();

      // face-down: the room sleeps and the light goes out of it
      if (night.cur > 0.005) {
        ctx.fillStyle = `rgba(3, 2, 8, ${(night.cur * 0.9).toFixed(3)})`;
        ctx.fillRect(0, 0, width, height);
      }

      // ── throttled sync to React for the console readout ──
      if (now - lastSyncRef.current > 110) {
        lastSyncRef.current = now;
        setReadout(
          `proper ${formatTime(properRef.current)} · γ ${gamma.toFixed(2)} · v/c ${vel.toFixed(3)}`,
        );
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    // an unwatched room costs nothing: the loop stops with the tab and picks
    // the clock back up where it left off
    const offVis = onVisibility((hidden) => {
      sleeping = hidden;
      if (!hidden && !raf) {
        last = performance.now();
        raf = requestAnimationFrame(draw);
      }
    });
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      offVis();
      window.removeEventListener("resize", resize);
    };
  }, []);

  // ── direct manipulation on the manifold ──
  const tuneFromPointer = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    // read the touch in the manifold's own coordinates, not the frame's
    const px = clamp(clientX - rect.left - panRef.current.x, 0, rect.width);
    const py = clamp(clientY - rect.top - panRef.current.y, 0, rect.height);
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);

    const signed = clamp((px - w / 2) / (w * 0.42), -1, 1);
    const nextVel = Number((Math.abs(signed) * VMAX).toFixed(3));
    const nextDir = signed < 0 ? -1 : 1;
    const nextMass = Math.round(clamp((h * 0.66 - py) / (h * 0.5), 0, 1) * 100);

    dirRef.current = nextDir;
    velRef.current = nextVel;
    massRef.current = nextMass;
    setVelocity(nextVel);
    setMass(nextMass);

    const now = performance.now();
    if (now - lastToneRef.current > 80) {
      lastToneRef.current = now;
      try { getFieldAudio().playNote(48 + Math.round(nextVel * 26), 80); } catch { /* noop */ }
      try { haptics.ripple(0.2 + nextVel * 0.3); } catch { /* noop */ }
      recordTape("ripple", 0.3 + nextVel * 0.5, "time/drag");
    }
  }, [recordTape]);

  const markControl = useCallback((meta: string, normalized: number) => {
    const now = performance.now();
    if (now - lastControlRef.current < 110) return;
    lastControlRef.current = now;
    const value = clamp(normalized, 0, 1);
    try { getFieldAudio().playNote(46 + Math.round(value * 24), 90); } catch { /* noop */ }
    try { haptics.tap(); } catch { /* noop */ }
    recordTape("sigil", 0.32 + value * 0.5, `time/${meta}`);
  }, [recordTape]);

  const toggleRunning = () => {
    setRunning((value) => {
      const next = !value;
      runningRef.current = next;
      try {
        if (next) getFieldAudio().chime();
        else getFieldAudio().thud();
      } catch { /* noop */ }
      recordTape("sigil", next ? 0.78 : 0.48, next ? "time/start" : "time/pause");
      return next;
    });
  };

  const reset = () => {
    coordRef.current = 0;
    properRef.current = 0;
    lastTickRef.current = 0;
    setRunning(false);
    runningRef.current = false;
    try { getFieldAudio().thud(); } catch { /* noop */ }
    recordTape("sigil", 0.34, "time/reset");
  };

  const toggleRunningRef = useRef<() => void>(() => {});

  // ── gestures (the shared grammar — src/lib/gesture) ────────────────────
  // One finger touches the material (place velocity and mass, throw the
  // traveller, wind the clock); two fingers touch the frame (twist turns the
  // lens through worldline → felt duration → bare metric, a two-finger drag
  // slides the frame, a two-finger tap steps back); three fingers touch the
  // law (drag drifts the flow of time, hold dilates it ×0.25 — time slowing
  // under your fingers, in the room about exactly that).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const audio = getFieldAudio();
    let lastFlowCueAt = 0;
    let lastScrubAt = 0;
    let lastGrowTickAt = 0;
    let lastPanCueAt = 0;
    let twistDetent = 0;   // last integer lens level crossed
    let twistTickAcc = 0;  // radians since the last haptic tick
    let holdCeremony = false;

    // three-finger tap: everything alive in the room answers at once
    let lastTuttiAt = 0;
    const tutti = () => {
      const nowMs = performance.now();
      if (nowMs - lastTuttiAt < 1200) return;
      lastTuttiAt = nowMs;
      tuttiRef.current = 1;
      pulseRef.current = 1;
      const g = gammaOf(velRef.current);
      [0, 70, 140].forEach((at, i) => {
        window.setTimeout(() => {
          try { audio.playNote(50 + i * 5 + Math.round(g * 3), 150); } catch { /* noop */ }
        }, at);
      });
      try { haptics.roll(); } catch { /* noop */ }
      recordTape("sigil", 0.6, "time/tutti");
    };

    const detach = attachGestures(canvas, {
      tap: (e) => {
        lastGestureAtRef.current = performance.now();
        if (e.fingers === 3) { tutti(); return; }
        if (e.fingers === 2) {
          // step back (grammar §5): a raised lens lowers a level first, then
          // the frame comes home. Both already home, the manifold still answers.
          const lens = lensRef.current;
          const pan = panRef.current;
          if (lens.target > 0.02) {
            lens.target = Math.max(0, Math.ceil(lens.target - 0.02) - 1);
            twistDetent = Math.round(lens.target);
            try { haptics.lens(); } catch { /* noop */ }
            try { audio.playNote(46 + Math.round(lens.target * 7), 220); } catch { /* noop */ }
            recordTape("region", 0.4, "time/lens-down");
            return;
          }
          if (Math.abs(pan.tx) > 1 || Math.abs(pan.ty) > 1) {
            pan.tx = 0;
            pan.ty = 0;
            try { haptics.tap(); } catch { /* noop */ }
            try { audio.playNote(43, 240); } catch { /* noop */ }
            recordTape("region", 0.34, "time/recenter");
            return;
          }
          tuttiRef.current = Math.max(tuttiRef.current, 0.5);
          try { haptics.tap(); } catch { /* noop */ }
          try { audio.playNote(41, 260); } catch { /* noop */ }
          return;
        }
        if (e.fingers !== 1) return;
        const mobile = window.matchMedia(MOBILE_QUERY).matches;
        if (mobile) {
          // a deliberate tap is the primary play action on phones
          toggleRunningRef.current();
          return;
        }
        // desktop: click places velocity and mass; tap intensity is the
        // strike — note weight and haptic ride the same 0..1 from core
        tuneFromPointer(e.x, e.y);
        try { haptics.ripple(0.2 + e.intensity * 0.3); } catch { /* noop */ }
      },
      drag: (e) => {
        lastGestureAtRef.current = performance.now();
        if (e.fingers === 3) {
          if (e.phase === "end") return;
          // three fingers drag the weather: the flow of the room's clock
          // drifts — pushed right it races, pushed left it wades. The
          // magnitude is the site's one calm↔storm axis, so a storm raised
          // here is felt in the hand and carried into the next room.
          if (Math.abs(e.vx) > 0.05) flowRef.current.dir = e.vx > 0 ? 1 : -1;
          stirTurbulence(Math.min(0.10, Math.abs(e.vx) * 0.07));
          const nowMs = performance.now();
          if (nowMs - lastFlowCueAt > 700 && Math.abs(e.vx) > 0.25) {
            lastFlowCueAt = nowMs;
            try { audio.playNote(40, 240); } catch { /* noop */ }
            try { haptics.chop(); } catch { /* noop */ }
            recordTape("region", 0.45, "time/flow");
          }
          return;
        }
        if (e.fingers !== 1 || e.phase === "end") return;
        tuneFromPointer(e.x, e.y);
      },
      twist: (e) => {
        lastGestureAtRef.current = performance.now();
        // two fingers turn the lens — one continuous axis, not a switch:
        // the worldline you draw, the duration you feel, the metric that
        // makes both. It answers all the way through the turn, in a tone
        // that glides with the wrist and a tick at every detent.
        const lens = lensRef.current;
        if (e.phase === "start") {
          twistDetent = Math.round(lens.target);
          twistTickAcc = 0;
          try { audio.holdConcernTone("memory", 8 + (lens.target / 2) * 84); } catch { /* noop */ }
          return;
        }
        if (e.phase === "end") {
          try { audio.releaseConcernTone("memory"); } catch { /* noop */ }
          recordTape("region", 0.3 + (lens.target / 2) * 0.5, "time/lens");
          return;
        }
        lens.target = clamp(lens.target + e.angle / 1.25, 0, 2);
        try { audio.holdConcernTone("memory", 8 + (lens.target / 2) * 84); } catch { /* noop */ }
        twistTickAcc += Math.abs(e.angle);
        if (twistTickAcc > 0.2) {
          twistTickAcc = 0;
          try { haptics.tap(); } catch { /* noop */ }
        }
        const level = Math.round(lens.target);
        if (level !== twistDetent && Math.abs(lens.target - level) < 0.14) {
          twistDetent = level;
          try { haptics.lens(); } catch { /* noop */ }
          try { audio.playNote(52 + level * 7, 180); } catch { /* noop */ }
        }
      },
      pan2: (e) => {
        lastGestureAtRef.current = performance.now();
        // two fingers slide the frame over the manifold; the mass and the
        // origin stay where they are, only the view moves
        const pan = panRef.current;
        if (e.phase === "end") {
          try { audio.releaseConcernTone("body"); } catch { /* noop */ }
          return;
        }
        const canvasEl = canvasRef.current;
        const lim = canvasEl ? Math.min(canvasEl.clientWidth, canvasEl.clientHeight) * 0.22 : 90;
        pan.tx = clamp(pan.tx + e.dx, -lim, lim);
        pan.ty = clamp(pan.ty + e.dy, -lim, lim);
        const reach = Math.hypot(pan.tx, pan.ty) / Math.max(1, lim);
        try { audio.holdConcernTone("body", 6 + reach * 70); } catch { /* noop */ }
        const nowMs = performance.now();
        if (nowMs - lastPanCueAt > 240) {
          lastPanCueAt = nowMs;
          try { haptics.tap(); } catch { /* noop */ }
        }
      },
      flick: (e) => {
        lastGestureAtRef.current = performance.now();
        if (e.fingers !== 1) return;
        // a flick throws the traveller — velocity from the hand's speed
        const vx = Math.cos(e.angle) * e.speed;
        const nextVel = Number((clamp(Math.abs(vx) / 2.4, 0.08, 1) * VMAX).toFixed(3));
        dirRef.current = vx < 0 ? -1 : 1;
        velRef.current = nextVel;
        setVelocity(nextVel);
        try { audio.playNote(48 + Math.round(nextVel * 26), 160); } catch { /* noop */ }
        try { haptics.chop(); } catch { /* noop */ }
        recordTape("ripple", 0.3 + nextVel * 0.5, "time/throw");
      },
      hold: (e) => {
        lastGestureAtRef.current = performance.now();
        if (e.fingers === 3) {
          // three fingers hold the law: time dilates to a quarter speed —
          // both clocks slow while the hand stays
          if (e.phase === "enter") {
            timeScaleRef.current.target = 0.25;
            try { audio.playNote(36, 260); } catch { /* noop */ }
            try { haptics.tap(); } catch { /* noop */ }
          }
          if (e.phase === "release") timeScaleRef.current.target = 1;
          return;
        }
        if (e.fingers !== 1) return;
        if (e.phase === "enter") {
          holdCeremony = false;
          return;
        }
        if (e.phase === "release") return;
        // dwell tier — gravity accretes under the held finger: mass grows
        if (e.tier >= 2 && !holdCeremony) {
          const nowMs = performance.now();
          if (nowMs - lastGrowTickAt > 160) {
            lastGrowTickAt = nowMs;
            const next = Math.min(100, massRef.current + 2);
            massRef.current = next;
            setMass(next);
            try { audio.playNote(46 + Math.round((next / 100) * 18), 70); } catch { /* noop */ }
            try { haptics.tap(); } catch { /* noop */ }
          }
        }
        // ceremony tier — the room's one solemn act: the well is sealed at
        // full mass, the manifold rings once
        if (e.tier >= 3 && !holdCeremony) {
          holdCeremony = true;
          massRef.current = 100;
          setMass(100);
          ceremonyAtRef.current = performance.now();
          try { audio.bell(); } catch { /* noop */ }
          try { haptics.bloom(); } catch { /* noop */ }
          recordTape("sigil", 1, "time/sealed-well");
        }
      },
      scrub: (e) => {
        lastGestureAtRef.current = performance.now();
        const nowMs = performance.now();
        if (nowMs - lastScrubAt < 500) return;
        lastScrubAt = nowMs;
        // circling winds the clocks — with the turn they run ahead,
        // against it they are drawn back
        const dir = Math.sign(e.winding) || 1;
        const gamma = gammaOf(velRef.current);
        coordRef.current = Math.max(0, coordRef.current + dir * 1500);
        properRef.current = Math.max(0, properRef.current + (dir * 1500) / gamma);
        lastTickRef.current = Math.floor(properRef.current / 1000);
        try { audio.playNote(dir > 0 ? 69 : 57, 80); } catch { /* noop */ }
        try { haptics.tap(); } catch { /* noop */ }
        recordTape("object", 0.4, "time/wind");
      },
      rhythm: (e) => {
        // a steady tapped pulse: the clocks fall in with the hand
        if (e.stability <= 0.7) return;
        entrainRef.current.bpm = Math.max(40, Math.min(150, e.bpm));
        entrainRef.current.until = performance.now() + 9000;
        recordTape("sigil", 0.45, "time/entrain");
      },
    }, { wheelZoom: false });

    // ── the vessel: this room is about mass bending spacetime, so the lean
    // of the thing in your hand is the most literal gravity on the site.
    // Subscribed passively — nothing flows until the candle has invited the
    // senses, and these handlers only set targets the loop smooths. ──
    let lastTiltNoteAt = 0;
    let lastTiltSector = 9;
    const detachVessel = onVessel({
      tilt: ({ gamma }) => {
        if (reduceRef.current) { leanRef.current.target = 0; return; }
        const g = clamp(gamma / 34, -1, 1);
        leanRef.current.target = g;
        // the mass answers as it passes each quarter of its travel, never at
        // sensor rate — a heavy thing sliding, not a needle twitching
        const sector = Math.round(g * 3);
        const nowMs = performance.now();
        if (sector !== lastTiltSector && nowMs - lastTiltNoteAt > 520) {
          lastTiltSector = sector;
          lastTiltNoteAt = nowMs;
          try { audio.playNote(38 + Math.round((g + 1) * 7), 260); } catch { /* noop */ }
          try { haptics.tap(); } catch { /* noop */ }
        }
      },
      shake: ({ intensity }) => {
        lastGestureAtRef.current = performance.now();
        // agitation joins the one calm↔storm axis: the geodesic shivers, the
        // flow of the clock races, the hand feels the storm
        flowRef.current.dir = 1;
        stirTurbulence(Math.min(0.7, 0.24 + intensity * 0.5));
        try { audio.thud(); } catch { /* noop */ }
        try { haptics.storm(); } catch { /* noop */ }
        recordTape("region", 0.5 + intensity * 0.4, "time/agitate");
      },
      knock: ({ intensity }) => {
        const nowMs = performance.now();
        if (nowMs - knockAtRef.current < 420) return;
        knockAtRef.current = nowMs;
        lastGestureAtRef.current = nowMs;
        // a rap on the case rings the manifold: a wave leaves the mass
        try { audio.playNote(45 + Math.round(intensity * 9), 320); } catch { /* noop */ }
        try { haptics.roll(); } catch { /* noop */ }
        recordTape("object", 0.4 + intensity * 0.4, "time/knock");
      },
      flip: ({ faceDown }) => {
        nightRef.current.target = faceDown ? 1 : 0;
        try { audio.playNote(faceDown ? 33 : 57, 420); } catch { /* noop */ }
        try { haptics.roll(); } catch { /* noop */ }
        recordTape("sigil", faceDown ? 0.28 : 0.5, faceDown ? "time/night" : "time/wake");
      },
    });

    return () => {
      detach();
      detachVessel();
      try { audio.releaseConcernTone("memory"); } catch { /* noop */ }
      try { audio.releaseConcernTone("body"); } catch { /* noop */ }
    };
  }, [recordTape, tuneFromPointer]);

  toggleRunningRef.current = toggleRunning;

  return (
    <div
      ref={rootRef}
      className="time-instrument"
      data-touch-surface="true"
      data-pretext-ignore="true"
      style={{ "--geo": GEO } as CSSProperties}
    >
      <canvas
        ref={canvasRef}
        className="time-canvas"
        role="img"
        aria-label="a spacetime manifold. on a phone, tap to start or pause. drag sideways to set velocity and up or down to set mass; hold to grow the well."
      />

      <div className="time-title" aria-hidden="true">
        <span>time · coordinate vs proper</span>
        <strong>Relativity</strong>
      </div>

      <p className="time-hint" aria-hidden="true">
        <span className="time-hint-mobile">tap to {running ? "pause" : "start"} · </span>
        drag ← → for velocity · ↑ ↓ for mass
      </p>

      <MobileInstrumentPanel
        title="relativity controls"
        triggerLabel="tune"
        summary={`${running ? "running" : "paused"} · ${velocity.toFixed(3)}c · mass ${mass}`}
      >
        <div className="time-console" aria-label="relativity controls">
          <button
            type="button"
            className="time-run"
            onClick={toggleRunning}
            aria-pressed={running}
            aria-label={running ? "pause the relativity clocks" : "start the relativity clocks"}
          >
            {running ? "pause" : "start"}
          </button>
          <button type="button" className="time-reset" onClick={reset} aria-label="reset both relativity clocks">
            reset
          </button>
          <TimeSlider
            label="velocity"
            min={0}
            max={VMAX}
            step={0.005}
            value={velocity}
            display={`${velocity.toFixed(3)}c`}
            onChange={(value) => {
              const v = Number(value.toFixed(3));
              setVelocity(v);
              velRef.current = v;
              markControl("velocity", v / VMAX);
            }}
          />
          <TimeSlider
            label="mass"
            min={0}
            max={100}
            step={1}
            value={mass}
            display={String(Math.round(mass))}
            onChange={(value) => {
              const m = Math.round(value);
              setMass(m);
              massRef.current = m;
              markControl("mass", m / 100);
            }}
          />
          <output className="time-readout" aria-live="polite" aria-label={`relativity readout ${readout}`}>
            {readout}
          </output>
        </div>
      </MobileInstrumentPanel>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .time-instrument {
          position: fixed;
          inset: 0;
          overflow: hidden;
          min-height: 100svh;
          background: #050409;
          color: ${INK};
          isolation: isolate;
          -webkit-user-select: none;
          user-select: none;
          -webkit-tap-highlight-color: transparent;
        }

        .time-canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
          touch-action: none;
          cursor: grab;
          z-index: 0;
        }

        .time-canvas:active { cursor: grabbing; }

        .time-title {
          position: fixed;
          z-index: 2;
          top: 76px;
          left: var(--pad-x);
          pointer-events: none;
        }

        .time-title span {
          display: block;
          margin-bottom: 8px;
          color: rgba(246, 241, 224, 0.46);
          font-family: var(--font-mono);
          font-size: 11px;
          line-height: 1;
          text-transform: lowercase;
        }

        .time-title strong {
          display: block;
          color: rgba(248, 244, 224, 0.96);
          font-family: var(--font-serif);
          font-size: 118px;
          font-weight: 400;
          line-height: 0.86;
          letter-spacing: -0.02em;
        }

        .time-hint {
          position: fixed;
          z-index: 2;
          left: var(--pad-x);
          bottom: calc(150px + env(safe-area-inset-bottom, 0px));
          margin: 0;
          color: rgba(246, 241, 224, 0.42);
          font-family: var(--font-mono);
          font-size: 11px;
          letter-spacing: 0.02em;
          pointer-events: none;
        }

        .time-hint-mobile { display: none; }

        .time-console {
          position: fixed;
          z-index: 4;
          left: var(--pad-x);
          right: var(--pad-x);
          bottom: calc(20px + env(safe-area-inset-bottom, 0px));
          display: grid;
          grid-template-columns: 92px 92px minmax(150px, 1.2fr) minmax(150px, 1.2fr) minmax(200px, 1fr);
          gap: 8px;
          padding: 8px;
          border: 1px solid rgba(246, 241, 224, 0.13);
          border-radius: 8px;
          background: rgba(8, 7, 16, 0.62);
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
          box-shadow: 0 24px 70px rgba(0, 0, 0, 0.4);
          pointer-events: auto;
        }

        .time-run,
        .time-reset,
        .time-slider,
        .time-readout {
          min-width: 0;
          min-height: 58px;
          border: 1px solid rgba(246, 241, 224, 0.12);
          border-radius: 6px;
          background: rgba(246, 241, 224, 0.055);
          color: rgba(246, 241, 224, 0.9);
        }

        .time-run,
        .time-reset {
          cursor: pointer;
          font-family: var(--font-mono);
          font-size: 12px;
          text-transform: lowercase;
        }

        .time-run[aria-pressed="true"] {
          border-color: color-mix(in srgb, var(--geo) 46%, transparent);
          color: var(--geo);
        }

        .time-slider {
          display: grid;
          grid-template-columns: 1fr auto;
          grid-template-rows: auto 28px;
          gap: 4px 8px;
          align-items: center;
          padding: 7px 11px;
          font-family: var(--font-mono);
          font-size: 10px;
          color: rgba(246, 241, 224, 0.58);
        }

        .time-slider strong {
          color: var(--geo);
          font-family: var(--font-numerals, var(--font-mono));
          font-size: 13px;
          font-weight: 500;
        }

        .time-slider input {
          -webkit-appearance: none;
          appearance: none;
          grid-column: 1 / -1;
          width: 100%;
          height: 28px;
          margin: 0;
          background: transparent;
          accent-color: var(--geo);
        }

        .time-slider input::-webkit-slider-runnable-track {
          height: 2px;
          border-radius: 999px;
          background: linear-gradient(90deg, var(--geo), rgba(246, 241, 224, 0.15));
        }

        .time-slider input::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          margin-top: -7px;
          border: 0;
          border-radius: 4px;
          background: var(--geo);
          box-shadow: 0 0 14px var(--geo);
          cursor: pointer;
        }

        .time-slider input::-moz-range-track {
          height: 2px;
          border-radius: 999px;
          background: linear-gradient(90deg, var(--geo), rgba(246, 241, 224, 0.15));
        }

        .time-slider input::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border: 0;
          border-radius: 4px;
          background: var(--geo);
          box-shadow: 0 0 14px var(--geo);
          cursor: pointer;
        }

        .time-readout {
          display: grid;
          place-items: center;
          padding: 0 12px;
          color: rgba(246, 241, 224, 0.74);
          font-family: var(--font-mono);
          font-size: 11px;
          line-height: 1.3;
          text-align: center;
          word-break: break-word;
        }

        body:has(.time-instrument) {
          overflow: hidden;
          background: #050409;
        }

        body:has(.time-instrument) header:not(.oda-site-header) {
          display: none !important;
        }

        body:has(.time-instrument) .oda-field-watch,
        body:has(.time-instrument) .oda-candle-mark,
        body:has(.time-instrument) .oda-tape-shell,
        body:has(.time-instrument) .oda-sound-toggle {
          display: none !important;
        }

        @media (max-width: 940px) {
          .time-title {
            top: 30px;
            left: 22px;
          }

          .time-title strong {
            font-size: 72px;
          }

          .time-hint {
            bottom: calc(206px + env(safe-area-inset-bottom, 0px));
            left: 12px;
          }

          .time-console {
            left: 10px;
            right: 10px;
            bottom: calc(10px + env(safe-area-inset-bottom, 0px));
            grid-template-columns: 1fr 1fr;
            max-height: min(46svh, 380px);
            overflow-y: auto;
          }

          .time-slider {
            grid-column: 1 / -1;
          }

          .time-readout {
            grid-column: 1 / -1;
            min-height: 44px;
          }
        }

        @media (max-width: 520px) {
          .time-title strong {
            font-size: 56px;
          }

          .time-run,
          .time-reset {
            min-height: 52px;
          }
        }

        @media (max-width: 720px) {
          .time-title {
            top: calc(22px + env(safe-area-inset-top, 0px));
          }

          .time-hint {
            right: 16px;
            bottom: calc(122px + env(safe-area-inset-bottom, 0px));
            left: 16px;
            font-size: 9px;
            line-height: 1.45;
          }

          .time-hint-mobile { display: inline; }

          .time-console {
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            padding: 0;
            border: 0;
            background: transparent;
            box-shadow: none;
            backdrop-filter: none;
            -webkit-backdrop-filter: none;
          }

          .time-run,
          .time-reset {
            min-height: 48px;
          }

          .time-instrument .mobile-instrument-panel__trigger {
            border-color: color-mix(in srgb, var(--geo) 38%, transparent);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .time-canvas { cursor: default; }
        }
      `,
        }}
      />
    </div>
  );
}

/** Ticks never change shape between frames — cached once per (radius, accent). */
function getTickSprite(cache: Map<string, HTMLCanvasElement>, r: number, accent: string): HTMLCanvasElement {
  const key = `${Math.round(r)}|${accent}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const res = 2; // supersample so the cached face stays crisp under the ctx's own dpr transform
  const size = Math.max(2, Math.ceil(r * 2 * res));
  const sprite = document.createElement("canvas");
  sprite.width = size;
  sprite.height = size;
  const sctx = sprite.getContext("2d");
  if (sctx) {
    sctx.translate(size / 2, size / 2);
    sctx.scale(res, res);
    for (let i = 0; i < 60; i += 1) {
      const major = i % 5 === 0;
      const a = (i / 60) * TAU;
      const outer = r - 3;
      const inner = r - (major ? 10 : 5);
      sctx.strokeStyle = colorAlpha(accent, major ? 0.7 : 0.32);
      sctx.lineWidth = major ? 1.4 : 0.7;
      sctx.beginPath();
      sctx.moveTo(Math.sin(a) * outer, -Math.cos(a) * outer);
      sctx.lineTo(Math.sin(a) * inner, -Math.cos(a) * inner);
      sctx.stroke();
    }
  }
  cache.set(key, sprite);
  return sprite;
}

function drawClock(
  ctx: CanvasRenderingContext2D,
  tickSprites: Map<string, HTMLCanvasElement>,
  cx: number,
  cy: number,
  r: number,
  ms: number,
  accent: string,
  label: string,
) {
  ctx.save();
  // face
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fillStyle = "rgba(6, 8, 16, 0.66)";
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = colorAlpha(accent, 0.55);
  ctx.stroke();

  // ticks — drawn once to an offscreen sprite, blitted every frame
  const sprite = getTickSprite(tickSprites, r, accent);
  ctx.drawImage(sprite, cx - r, cy - r, r * 2, r * 2);

  const secA = ((ms / 1000) % 60) / 60 * TAU;
  const minA = ((ms / 60000) % 60) / 60 * TAU;

  // minute hand
  ctx.strokeStyle = colorAlpha(accent, 0.85);
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.sin(minA) * r * 0.5, cy - Math.cos(minA) * r * 0.5);
  ctx.stroke();

  // second hand — a cheap additive glow (two wider, fainter strokes under
  // the line) instead of a per-frame ctx.shadowBlur, which is catastrophic
  // on mobile drawn twice a frame for two dials.
  const handFrom: [number, number] = [cx - Math.sin(secA) * r * 0.16, cy + Math.cos(secA) * r * 0.16];
  const handTo: [number, number] = [cx + Math.sin(secA) * r * 0.82, cy - Math.cos(secA) * r * 0.82];
  const strokeHand = () => {
    ctx.beginPath();
    ctx.moveTo(handFrom[0], handFrom[1]);
    ctx.lineTo(handTo[0], handTo[1]);
    ctx.stroke();
  };
  ctx.strokeStyle = colorAlpha(accent, 0.22);
  ctx.lineWidth = 5;
  strokeHand();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.6;
  strokeHand();

  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(cx, cy, 2.6, 0, TAU);
  ctx.fill();

  // label + digital readout
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(246, 241, 224, 0.5)";
  ctx.font = `${Math.round(r * 0.2)}px var(--font-mono, monospace)`;
  ctx.fillText(label, cx, cy - r - r * 0.24);
  ctx.fillStyle = colorAlpha(accent, 0.95);
  ctx.font = `600 ${Math.round(r * 0.28)}px var(--font-numerals, monospace)`;
  ctx.fillText(formatTime(ms), cx, cy + r + r * 0.32);
  ctx.restore();
}

function TimeSlider({
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
    <label className="time-slider">
      <span>{label}</span>
      <strong>{display}</strong>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
