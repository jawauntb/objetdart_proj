"use client";

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import { useField } from "@/store/field";
import * as haptics from "@/lib/haptics";

/**
 * /time — the cabinet.
 *
 * A drawer of playable haute-horlogerie instruments beneath the grande
 * complication. Every piece wears the same case: a polished gold bezel, a
 * dark guilloché-deep face, a sapphire crystal sheen. Each one is alive and
 * touchable — poke it, drag it, flip it, and it answers in sight, sound, and
 * (where the device allows) touch.
 */

const DEG = Math.PI / 180;
function polar(cx: number, cy: number, r: number, deg: number): readonly [number, number] {
  const a = (deg - 90) * DEG;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
const reduceMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const tape = (kind: "sigil" | "object" | "ripple", v: number, meta: string) =>
  useField.getState().recordTape(kind, v, meta);

// shared throttled heartbeat — only animates while the instrument is on
// screen (gated by IntersectionObserver) so ten live dials stay cheap.
// Returns [setOnFrame, ref] — attach the ref to the instrument's root.
function useHeartbeat(intervalMs?: number): [
  (fn: (dt: number, now: number) => void) => void,
  React.RefObject<HTMLElement>,
] {
  const [, setFrame] = useState(0);
  const cb = useRef<(dt: number, now: number) => void>(() => {});
  const ref = useRef<HTMLElement>(null);
  const inView = useRef(true);
  const setOnFrame = (fn: (dt: number, now: number) => void) => { cb.current = fn; };
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => { inView.current = es[0]?.isIntersecting ?? true; }, { rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const min = intervalMs ?? (reduceMotion() ? 250 : coarse ? 33 : 16);
    let raf = 0;
    let prev = performance.now();
    let lastPaint = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      if (inView.current) {
        cb.current(dt, now);
        if (now - lastPaint >= min) { lastPaint = now; setFrame((f) => (f + 1) % 1e6); }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [intervalMs]);
  return [setOnFrame, ref];
}

/* ── shared luxe case chrome (ids referenced across every instrument) ── */
function LuxeDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute" }}>
      <defs>
        <linearGradient id="luxeBezel" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#c9b27e" />
          <stop offset="22%" stopColor="#6f5b32" />
          <stop offset="50%" stopColor="#e7d39a" />
          <stop offset="74%" stopColor="#6f5b32" />
          <stop offset="100%" stopColor="#bda367" />
        </linearGradient>
        <radialGradient id="luxeFace" cx="42%" cy="34%" r="82%">
          <stop offset="0%" stopColor="#1a2733" />
          <stop offset="45%" stopColor="#101924" />
          <stop offset="100%" stopColor="#05080d" />
        </radialGradient>
        <radialGradient id="luxeSub" cx="42%" cy="34%" r="82%">
          <stop offset="0%" stopColor="#243340" />
          <stop offset="100%" stopColor="#0a121a" />
        </radialGradient>
        <radialGradient id="luxeGold" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="#f6e6b4" />
          <stop offset="100%" stopColor="#c79a4e" />
        </radialGradient>
        <radialGradient id="luxeNight" cx="50%" cy="40%" r="75%">
          <stop offset="0%" stopColor="#16204a" />
          <stop offset="100%" stopColor="#05071a" />
        </radialGradient>
        <filter id="luxeShadow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="1.6" stdDeviation="1.8" floodColor="#000" floodOpacity="0.55" />
        </filter>
        <filter id="luxeGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.2" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
    </svg>
  );
}

// polished round case: outer gold bezel, dark face. Returns JSX.
function roundCase(cx: number, cy: number, r: number, face = "url(#luxeFace)") {
  return (
    <g filter="url(#luxeShadow)">
      <circle cx={cx} cy={cy} r={r + 8} fill="#0a0c10" />
      <circle cx={cx} cy={cy} r={r + 6} fill="url(#luxeBezel)" />
      <circle cx={cx} cy={cy} r={r + 2} fill="#0a0d11" />
      <circle cx={cx} cy={cy} r={r} fill={face} />
    </g>
  );
}
// sapphire crystal sheen, drawn last over a round case
function crystal(cx: number, cy: number, r: number) {
  return <ellipse cx={cx - r * 0.28} cy={cy - r * 0.34} rx={r * 0.72} ry={r * 0.44} fill="#fff" opacity="0.05" transform={`rotate(-22 ${cx} ${cy})`} />;
}

/* ───────────────────────── Orrery ───────────────────────── */
const PLANETS = [
  { r: 26, period: 6, color: "#c0563a", midi: 64, size: 3.0 },
  { r: 42, period: 11, color: "#6aa6d6", midi: 67, size: 4.2 },
  { r: 58, period: 19, color: "#d9a14d", midi: 71, size: 5.0 },
  { r: 76, period: 31, color: "#9d8fce", midi: 74, size: 3.6 },
] as const;
function Orrery() {
  const t = useRef(0);
  const spin = useRef(0);
  const spinVel = useRef(0.18);
  const trails = useRef<Array<{ x: number; y: number; t0: number; color: string }>>([]);
  const comet = useRef({ active: false, p: 0, y: 0, at: 2 });
  const [onFrame, hbRef] = useHeartbeat();
  onFrame((dt, now) => {
    if (reduceMotion()) return;
    t.current += dt;
    spin.current += spinVel.current * dt;
    spinVel.current += (0.06 - spinVel.current) * 0.01;
    if (!comet.current.active && t.current > comet.current.at) comet.current = { active: true, p: 0, y: 40 + Math.random() * 140, at: 0 };
    if (comet.current.active) { comet.current.p += dt * 0.5; if (comet.current.p > 1.2) comet.current = { active: false, p: 0, y: 0, at: t.current + 6 + Math.random() * 10 }; }
    trails.current = trails.current.filter((tr) => now - tr.t0 < 1400);
  });
  const C = 110;
  const fling = () => {
    spinVel.current += 1.6;
    try { getFieldAudio().playSigilPhrase({ a: 0.7, b: 0.4, c: 0.6 }); } catch { /* noop */ }
    haptics.roll(); tape("sigil", 0.8, "time/orrery/fling");
  };
  const pluck = (i: number, x: number, y: number) => {
    const p = PLANETS[i];
    try { getFieldAudio().playNote(p.midi, 240); } catch { /* noop */ }
    trails.current.push({ x, y, t0: performance.now(), color: p.color });
    spinVel.current += 0.4; haptics.ripple(0.5); tape("object", 0.6, `time/orrery/planet${i}`);
  };
  return (
    <figure className="inst" ref={hbRef}>
      <svg viewBox="0 0 220 220" role="img" aria-label="orrery — planetary clock" onClick={fling}>
        {roundCase(C, C, 100, "url(#luxeNight)")}
        {Array.from({ length: 44 }, (_, i) => {
          const sx = 12 + ((Math.sin(i * 12.9) * 43758) % 1 + 1) % 1 * 196;
          const sy = 12 + ((Math.sin(i * 78.2) * 43758) % 1 + 1) % 1 * 196;
          if (Math.hypot(sx - C, sy - C) > 96) return null;
          const tw = 0.4 + 0.4 * Math.sin(t.current * 1.5 + i);
          return <circle key={i} cx={sx} cy={sy} r={i % 5 === 0 ? 1.1 : 0.6} fill="#dfe7ff" opacity={0.3 + tw * 0.4} />;
        })}
        {trails.current.map((tr, i) => {
          const age = (performance.now() - tr.t0) / 1400;
          return <circle key={i} cx={tr.x} cy={tr.y} r={2 + age * 14} fill="none" stroke={tr.color} strokeOpacity={0.5 * (1 - age)} strokeWidth="1" />;
        })}
        {PLANETS.map((p, i) => <circle key={i} cx={C} cy={C} r={p.r} fill="none" stroke="rgba(159,182,201,0.16)" strokeWidth="0.6" />)}
        {comet.current.active && (() => {
          const cx = C - 90 + comet.current.p * 180;
          const cy = comet.current.y + Math.sin(comet.current.p * 3) * 8;
          return <g><line x1={cx - 16} y1={cy + 6} x2={cx} y2={cy} stroke="rgba(200,220,255,0.5)" strokeWidth="1.4" strokeLinecap="round" /><circle cx={cx} cy={cy} r={2} fill="#eaf2ff" /></g>;
        })()}
        <circle cx={C} cy={C} r={9} fill="url(#luxeGold)" filter="url(#luxeGlow)" />
        {PLANETS.map((p, i) => {
          const ang = t.current * (Math.PI * 2 / p.period) + spin.current + i * 1.3;
          const x = C + Math.cos(ang) * p.r, y = C + Math.sin(ang) * p.r;
          return (
            <g key={i} onClick={(e) => { e.stopPropagation(); pluck(i, x, y); }} style={{ cursor: "pointer" }}>
              <circle cx={x} cy={y} r={p.size + 4} fill={p.color} opacity="0.16" />
              <circle cx={x} cy={y} r={p.size} fill={p.color} />
              {i === 2 && <ellipse cx={x} cy={y} rx={p.size + 3} ry={1.4} fill="none" stroke="#e9d6a6" strokeWidth="0.8" transform={`rotate(${ang * 30} ${x} ${y})`} />}
            </g>
          );
        })}
        {crystal(C, C, 100)}
      </svg>
      <figcaption><span>orrery</span><em>fling the system · pluck a planet</em></figcaption>
    </figure>
  );
}

/* ───────────────────────── Hourglass ───────────────────────── */
function Hourglass() {
  const progress = useRef(0);
  const flip = useRef(0);
  const flipTarget = useRef(0);
  const grains = useRef<Array<{ x: number; y: number; vy: number; t0: number }>>([]);
  const lastGrain = useRef(0);
  const DURATION = 11;
  const [onFrame, hbRef] = useHeartbeat();
  onFrame((dt, now) => {
    const reduce = reduceMotion();
    flip.current += (flipTarget.current - flip.current) * (reduce ? 1 : 0.18);
    const settled = Math.abs(flipTarget.current - flip.current) < 2;
    if (settled && progress.current < 1 && !reduce) {
      progress.current = Math.min(1, progress.current + dt / DURATION);
      if (now - lastGrain.current > 90 && progress.current < 1) { lastGrain.current = now; grains.current.push({ x: 110 + (Math.random() - 0.5) * 3, y: 112, vy: 40 + Math.random() * 30, t0: now }); }
    }
    grains.current = grains.current.filter((g) => now - g.t0 < 700);
    grains.current.forEach((g) => { g.y += g.vy * dt; });
  });
  const doFlip = () => {
    flipTarget.current += 180; progress.current = 0; grains.current = [];
    try { getFieldAudio().chime(); window.setTimeout(() => { try { getFieldAudio().playNote(60, 120); } catch { /* noop */ } }, 120); } catch { /* noop */ }
    haptics.roll(); tape("object", 0.6, "time/hourglass/flip");
  };
  const p = progress.current, topSand = 1 - p, botSand = p, empty = p >= 0.999;
  return (
    <figure className="inst" ref={hbRef}>
      <svg viewBox="0 0 220 220" role="img" aria-label="hourglass — click to flip" onClick={doFlip} style={{ cursor: "pointer" }}>
        {roundCase(110, 110, 100)}
        <defs>
          <linearGradient id="hgSand" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#e7c879" /><stop offset="100%" stopColor="#c08a3c" /></linearGradient>
          <clipPath id="hgTop"><path d="M62 44 H158 L116 108 H104 Z" /></clipPath>
          <clipPath id="hgBot"><path d="M104 116 H116 L158 180 H62 Z" /></clipPath>
        </defs>
        <g transform={`rotate(${flip.current} 110 112)`}>
          <rect x={54} y={38} width={112} height={8} rx={3} fill="#5a4528" />
          <rect x={54} y={178} width={112} height={8} rx={3} fill="#5a4528" />
          <path d="M62 44 H158 L116 108 H104 Z" fill="rgba(210,240,245,0.12)" stroke="rgba(220,240,245,0.4)" strokeWidth="1" />
          <path d="M104 116 H116 L158 180 H62 Z" fill="rgba(210,240,245,0.12)" stroke="rgba(220,240,245,0.4)" strokeWidth="1" />
          <g clipPath="url(#hgTop)"><rect x={62} y={44 + (1 - topSand) * 64} width={96} height={70} fill="url(#hgSand)" /></g>
          <g clipPath="url(#hgBot)"><rect x={62} y={180 - botSand * 64} width={96} height={70} fill="url(#hgSand)" /></g>
          {!empty && <line x1={110} y1={108} x2={110} y2={116} stroke="#e7c879" strokeWidth="1.4" />}
          {grains.current.map((g, i) => <circle key={i} cx={g.x} cy={g.y} r={0.9} fill="#e7c879" />)}
        </g>
        {empty && <text x={110} y={206} textAnchor="middle" className="inst-hint">turn me over</text>}
        {crystal(110, 110, 100)}
      </svg>
      <figcaption><span>hourglass</span><em>click to flip · {Math.round((empty ? 0 : (1 - p)) * 100)}% left</em></figcaption>
    </figure>
  );
}

/* ───────────────────────── Metronome ───────────────────────── */
function Metronome() {
  const running = useRef(false);
  const [, force] = useState(0);
  const phase = useRef(0);
  const lastSide = useRef(1);
  const beat = useRef(0);
  const bpmRef = useRef(96);
  const [bpm, setBpm] = useState(96);
  const dragging = useRef(false);
  const moved = useRef(false);
  const [onFrame, hbRef] = useHeartbeat();
  onFrame((dt) => {
    if (!running.current || reduceMotion()) return;
    phase.current += dt * (bpmRef.current / 60 / 2) * Math.PI * 2;
    const side = Math.sin(phase.current) >= 0 ? 1 : -1;
    if (side !== lastSide.current) {
      lastSide.current = side; beat.current = (beat.current + 1) % 4;
      try { const a = getFieldAudio(); a.playNote(beat.current === 0 ? 84 : 72, beat.current === 0 ? 60 : 45); } catch { /* noop */ }
      if (beat.current === 0) haptics.tap();
    }
  });
  const toggle = () => {
    if (moved.current) { moved.current = false; return; }
    running.current = !running.current;
    if (running.current) { phase.current = 0; lastSide.current = 1; beat.current = 0; }
    try { getFieldAudio()[running.current ? "bell" : "thud"](); } catch { /* noop */ }
    haptics.ripple(running.current ? 0.6 : 0.3); tape("sigil", running.current ? 0.7 : 0.4, `time/metronome/${running.current ? "start" : "stop"}`);
    force((n) => n + 1);
  };
  const onPointerDown = (e: React.PointerEvent) => { dragging.current = true; moved.current = false; (e.target as Element).setPointerCapture?.(e.pointerId); e.stopPropagation(); };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return; moved.current = true;
    const rect = (e.currentTarget as Element).getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    const v = Math.max(40, Math.min(208, Math.round(208 - (Math.max(0.18, Math.min(0.86, y)) - 0.18) / 0.68 * 168)));
    bpmRef.current = v; setBpm(v);
  };
  const onPointerUp = () => { dragging.current = false; };
  const ang = running.current ? Math.sin(phase.current) * 26 : 0;
  const bobR = 30 + (208 - bpm) / 168 * 58;
  const pivotX = 110, pivotY = 178;
  const [bx, by] = polar(pivotX, pivotY, bobR, 180 + ang);
  return (
    <figure className="inst" ref={hbRef}>
      <svg viewBox="0 0 220 220" role="img" aria-label="metronome" onClick={toggle} onPointerMove={onPointerMove} onPointerUp={onPointerUp} style={{ cursor: "pointer" }}>
        {roundCase(110, 110, 100)}
        <path d="M110 36 L168 188 H52 Z" fill="rgba(20,15,9,0.6)" stroke="rgba(231,211,154,0.18)" strokeWidth="1" />
        {Array.from({ length: 9 }, (_, i) => { const yy = 64 + i * 13; return <line key={i} x1={102} y1={yy} x2={118} y2={yy} stroke="rgba(231,211,154,0.3)" strokeWidth="0.8" />; })}
        <line x1={pivotX} y1={pivotY} x2={polar(pivotX, pivotY, 96, 180 + ang)[0]} y2={polar(pivotX, pivotY, 96, 180 + ang)[1]} stroke="#cbb377" strokeWidth="2" strokeLinecap="round" />
        <g onPointerDown={onPointerDown}><rect x={bx - 8} y={by - 6} width={16} height={12} rx={2} fill="url(#luxeGold)" stroke="#8a6c34" strokeWidth="0.8" /></g>
        <circle cx={pivotX} cy={pivotY} r={3} fill="url(#luxeGold)" />
        {Array.from({ length: 4 }, (_, i) => <circle key={i} cx={86 + i * 16} cy={200} r={2.6} fill={running.current && beat.current === i ? "#f3b64e" : "rgba(231,211,154,0.25)"} />)}
        {crystal(110, 110, 100)}
      </svg>
      <figcaption><span>metronome</span><em>{running.current ? "ticking" : "tap to start"} · {bpm} bpm · drag the bob</em></figcaption>
    </figure>
  );
}

/* ───────────────────────── Sundial ───────────────────────── */
function Sundial() {
  const dayT = useRef(0.32);
  const [, force] = useState(0);
  const animating = useRef(false);
  const dragging = useRef(false);
  const moved = useRef(false);
  const [onFrame, hbRef] = useHeartbeat();
  onFrame((dt) => {
    if (!animating.current || reduceMotion()) return;
    dayT.current += dt * 0.12;
    if (dayT.current >= 1) { dayT.current = 1; animating.current = false; }
    force((n) => (n + 1) % 1e6);
  });
  const C = 110, baseY = 150, arcR = 88;
  const sunAng = 180 + dayT.current * 180;
  const [sx, sy] = polar(C, baseY, arcR, sunAng);
  const lowSun = Math.sin(dayT.current * Math.PI);
  const shadowLen = 16 + (1 - lowSun) * 56;
  const [shx, shy] = polar(C, baseY, shadowLen, 90 + (dayT.current * 180 - 90));
  const hour = 6 + dayT.current * 12, hh = Math.floor(hour), mm = Math.floor((hour - hh) * 60);
  const night = dayT.current > 0.97 || dayT.current < 0.03;
  const t = dayT.current;
  const sky = t < 0.18 ? ["#241a2e", "#7a4a3a"] : t < 0.42 ? ["#3a6da0", "#bcd4e6"] : t < 0.6 ? ["#5b96cf", "#dff0fb"] : t < 0.84 ? ["#b58a4a", "#f0c98a"] : ["#2a1f34", "#7a3f30"];
  const setFromPointer = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as Element).getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width * 220, py = (e.clientY - rect.top) / rect.height * 220;
    let deg = Math.atan2(py - baseY, px - C) / DEG;
    if (deg > 0) deg = px < C ? 180 : 0;
    dayT.current = Math.max(0, Math.min(1, (deg + 180) / 180)); force((n) => (n + 1) % 1e6);
  };
  const onPointerDown = (e: React.PointerEvent) => { dragging.current = true; animating.current = false; moved.current = false; (e.target as Element).setPointerCapture?.(e.pointerId); setFromPointer(e); };
  const onPointerMove = (e: React.PointerEvent) => { if (dragging.current) { moved.current = true; setFromPointer(e); } };
  const onPointerUp = () => { if (!dragging.current) return; dragging.current = false; try { getFieldAudio().playNote(60 + Math.round(dayT.current * 24), 140); } catch { /* noop */ } haptics.ripple(0.4); tape("ripple", 0.3 + dayT.current * 0.5, "time/sundial/set"); };
  const runDay = (e: React.MouseEvent) => { e.stopPropagation(); if (moved.current) { moved.current = false; return; } dayT.current = 0; animating.current = true; try { getFieldAudio().bell(); } catch { /* noop */ } haptics.roll(); tape("sigil", 0.7, "time/sundial/run"); };
  return (
    <figure className="inst" ref={hbRef}>
      <svg viewBox="0 0 220 220" role="img" aria-label="sundial — drag the sun" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} style={{ cursor: "grab", touchAction: "none" }}>
        {roundCase(110, 110, 100)}
        <defs>
          <linearGradient id="sunSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={sky[0]} /><stop offset="100%" stopColor={sky[1]} /></linearGradient>
          <clipPath id="sunClip"><circle cx={110} cy={110} r={100} /></clipPath>
        </defs>
        <g clipPath="url(#sunClip)">
          <rect x={10} y={10} width={200} height={baseY - 10} fill="url(#sunSky)" />
          {night && Array.from({ length: 24 }, (_, i) => { const stx = 14 + ((Math.sin(i * 12.9) * 43758) % 1 + 1) % 1 * 192; const sty = 16 + ((Math.sin(i * 41.2) * 43758) % 1 + 1) % 1 * 110; return <circle key={i} cx={stx} cy={sty} r={0.7} fill="#eaf0ff" opacity={0.7} />; })}
          {Array.from({ length: 13 }, (_, i) => { const aa = 180 + (i / 12) * 180; const [x1, y1] = polar(C, baseY, arcR + 4, aa); const [x2, y2] = polar(C, baseY, arcR - 2, aa); return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.32)" strokeWidth={i % 6 === 0 ? 1.4 : 0.7} />; })}
          <circle cx={sx} cy={sy} r={16} fill="#ffe6a8" opacity={0.35 * lowSun + 0.1} />
          <circle cx={sx} cy={sy} r={9} fill="url(#luxeGold)" style={{ cursor: "pointer" }} onClick={runDay} />
          <rect x={10} y={baseY} width={200} height={220 - baseY} fill="#241a12" />
          <rect x={10} y={baseY} width={200} height={3} fill="rgba(231,211,154,0.18)" />
          <line x1={C} y1={baseY} x2={shx} y2={shy} stroke="rgba(0,0,0,0.45)" strokeWidth={3} strokeLinecap="round" />
          <path d={`M${C - 6} ${baseY} L${C} ${baseY - 30} L${C + 6} ${baseY} Z`} fill="#cbb377" stroke="#8a6c34" strokeWidth="0.8" />
          <text x={110} y={188} textAnchor="middle" className="inst-num">{String(hh).padStart(2, "0")}:{String(mm).padStart(2, "0")}</text>
        </g>
        {crystal(110, 110, 100)}
      </svg>
      <figcaption><span>sundial</span><em>drag the sun · click it to run a day</em></figcaption>
    </figure>
  );
}

/* ───────────────────────── Astrolabe ───────────────────────── */
const ZODIAC = ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓"];
function Astrolabe() {
  const rot = useRef(0);
  const vel = useRef(0.05);
  const dragging = useRef(false);
  const last = useRef(0);
  const [onFrame, hbRef] = useHeartbeat();
  onFrame((dt) => { if (reduceMotion() || dragging.current) return; rot.current += vel.current * dt; vel.current += (0.05 - vel.current) * 0.01; });
  const C = 110;
  const stars = useRef(Array.from({ length: 28 }, (_, i) => ({ a: ((Math.sin(i * 9.1) * 43758) % 1 + 1) % 1 * Math.PI * 2, r: 20 + (((Math.sin(i * 3.3) * 9999) % 1 + 1) % 1) * 70, m: i % 5 === 0 }))).current;
  const spin = (e: React.MouseEvent) => { e.stopPropagation(); vel.current += 1.2; try { getFieldAudio().playSigilPhrase({ a: 0.5, b: 0.7 }); } catch { /* noop */ } haptics.roll(); tape("sigil", 0.7, "time/astrolabe/spin"); };
  const onPointerDown = (e: React.PointerEvent) => { dragging.current = true; (e.target as Element).setPointerCapture?.(e.pointerId); const r = (e.currentTarget as Element).getBoundingClientRect(); last.current = Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)); };
  const onPointerMove = (e: React.PointerEvent) => { if (!dragging.current) return; const r = (e.currentTarget as Element).getBoundingClientRect(); const ang = Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)); let dd = ang - last.current; if (dd > Math.PI) dd -= Math.PI * 2; if (dd < -Math.PI) dd += Math.PI * 2; rot.current += dd; vel.current = dd * 4; last.current = ang; };
  const onPointerUp = () => { dragging.current = false; };
  const deg = rot.current / DEG;
  return (
    <figure className="inst" ref={hbRef}>
      <svg viewBox="0 0 220 220" role="img" aria-label="astrolabe — spin the rete" onClick={spin} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} style={{ cursor: "grab", touchAction: "none" }}>
        {roundCase(C, C, 100, "url(#luxeNight)")}
        {/* tympan: altitude almucantar circles */}
        <g stroke="rgba(106,166,214,0.22)" fill="none" strokeWidth="0.6">
          {[24, 44, 64, 84].map((r) => <circle key={r} cx={C} cy={C - 10} r={r} />)}
          <line x1={C - 90} y1={C} x2={C + 90} y2={C} /><line x1={C} y1={C - 84} x2={C} y2={C + 90} />
        </g>
        {/* rete: rotating star map + ecliptic ring */}
        <g transform={`rotate(${deg} ${C} ${C})`}>
          <circle cx={C} cy={C} r={88} fill="none" stroke="url(#luxeBezel)" strokeWidth="1.4" />
          <circle cx={C + 30} cy={C} r={50} fill="none" stroke="#d9a14d" strokeWidth="1" strokeOpacity="0.6" />
          {ZODIAC.map((z, i) => { const [zx, zy] = polar(C + 30, C, 50, i * 30); return <text key={i} x={zx} y={zy + 3} textAnchor="middle" className="astro-glyph">{z}</text>; })}
          {stars.map((s, i) => { const x = C + Math.cos(s.a) * s.r, y = C + Math.sin(s.a) * s.r; return <g key={i}><circle cx={x} cy={y} r={s.m ? 1.6 : 0.9} fill="#eaf2ff" />{s.m && <path d={`M${x} ${y - 3} L${x} ${y + 3} M${x - 3} ${y} L${x + 3} ${y}`} stroke="#eaf2ff" strokeWidth="0.4" opacity="0.6" />}</g>; })}
        </g>
        {/* rule + central boss */}
        <line x1={C} y1={C - 92} x2={C} y2={C + 92} stroke="#c0563a" strokeWidth="1" opacity="0.7" />
        <circle cx={C} cy={C} r={4} fill="url(#luxeGold)" stroke="#5a4520" strokeWidth="0.6" />
        {crystal(C, C, 100)}
      </svg>
      <figcaption><span>astrolabe</span><em>drag or fling the rete</em></figcaption>
    </figure>
  );
}

/* ───────────────────────── World-timer (GMT) ───────────────────────── */
const CITIES = [
  { name: "GVA", off: 1 }, { name: "LON", off: 0 }, { name: "NYC", off: -5 }, { name: "LAX", off: -8 },
  { name: "TYO", off: 9 }, { name: "SYD", off: 11 }, { name: "DXB", off: 4 }, { name: "MOW", off: 3 },
];
function WorldTimer() {
  const [, force] = useState(0);
  const [onFrame, hbRef] = useHeartbeat(1000);
  onFrame(() => force((n) => (n + 1) % 1e6));
  const [sel, setSel] = useState(0);
  const C = 110;
  const now = new Date();
  const utcH = now.getUTCHours() + now.getUTCMinutes() / 60;
  // 24h ring: hour hand points to current UTC; day/night band fixed, ring rotates
  const utcAng = (utcH / 24) * 360;
  const city = CITIES[sel];
  const localH = ((utcH + city.off) % 24 + 24) % 24;
  const lh = Math.floor(localH), lm = Math.floor((localH - lh) * 60);
  const pick = (i: number) => { setSel(i); const c = CITIES[i]; const lH = ((utcH + c.off) % 24 + 24) % 24; try { getFieldAudio().playNote(60 + Math.round(lH), 120); } catch { /* noop */ } haptics.tap(); tape("object", 0.5, `time/world/${c.name}`); };
  return (
    <figure className="inst" ref={hbRef}>
      <svg viewBox="0 0 220 220" role="img" aria-label="world timer">
        {roundCase(C, C, 100)}
        {/* day / night band */}
        <defs><clipPath id="wtClip"><circle cx={C} cy={C} r={86} /></clipPath></defs>
        <g clipPath="url(#wtClip)">
          <circle cx={C} cy={C} r={86} fill="url(#luxeNight)" />
          <path d={`M${C} ${C} L${polar(C, C, 86, 90)[0]} ${polar(C, C, 86, 90)[1]} A 86 86 0 0 1 ${polar(C, C, 86, 270)[0]} ${polar(C, C, 86, 270)[1]} Z`} fill="rgba(120,170,210,0.16)" />
        </g>
        {/* 24h ring */}
        {Array.from({ length: 24 }, (_, i) => { const aa = (i / 24) * 360; const [x1, y1] = polar(C, C, 86, aa); const [x2, y2] = polar(C, C, i % 6 === 0 ? 76 : 81, aa); return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(231,211,154,0.5)" strokeWidth={i % 6 === 0 ? 1.3 : 0.6} />; })}
        {[0, 6, 12, 18].map((h) => { const [nx, ny] = polar(C, C, 68, (h / 24) * 360); return <text key={h} x={nx} y={ny + 3} textAnchor="middle" className="mf-num-sm">{h}</text>; })}
        {/* cities */}
        {CITIES.map((c, i) => { const [cxp, cyp] = polar(C, C, 56, (i / CITIES.length) * 360); return <text key={c.name} x={cxp} y={cyp + 2} textAnchor="middle" className={`wt-city ${i === sel ? "is-sel" : ""}`} style={{ cursor: "pointer" }} onClick={() => pick(i)}>{c.name}</text>; })}
        {/* UTC hand */}
        <line x1={C} y1={C} x2={polar(C, C, 80, utcAng)[0]} y2={polar(C, C, 80, utcAng)[1]} stroke="url(#luxeGold)" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx={C} cy={C} r={16} fill="url(#luxeSub)" stroke="rgba(231,211,154,0.3)" strokeWidth="0.6" />
        <text x={C} y={C - 1} textAnchor="middle" className="wt-time">{String(lh).padStart(2, "0")}:{String(lm).padStart(2, "0")}</text>
        <text x={C} y={C + 9} textAnchor="middle" className="mf-label-sm">{city.name}</text>
        {crystal(C, C, 100)}
      </svg>
      <figcaption><span>world-timer</span><em>tap a city · gmt {city.off >= 0 ? "+" : ""}{city.off}</em></figcaption>
    </figure>
  );
}

/* ───────────────────── Perpetual calendar ───────────────────── */
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function PerpetualCalendar() {
  const [monthOff, setMonthOff] = useState(0);
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth() + monthOff, Math.min(now.getDate(), 28));
  const C = 110;
  const weekday = now.getDay();
  const date = now.getDate();
  const month = base.getMonth();
  const year = base.getFullYear();
  const leapPos = year % 4; // 0 = leap year
  const advance = (e: React.MouseEvent) => { e.stopPropagation(); setMonthOff((m) => (m + 1) % 12); try { getFieldAudio().playNote(64 + ((month + 1) % 12), 110); } catch { /* noop */ } haptics.tap(); tape("object", 0.5, "time/calendar/month"); };
  const sub = (cx: number, cy: number, r: number, label: string, value: string, ang: number) => (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="url(#luxeSub)" stroke="rgba(231,211,154,0.25)" strokeWidth="0.8" />
      {Array.from({ length: 12 }, (_, i) => { const [x1, y1] = polar(cx, cy, r - 2, i * 30); const [x2, y2] = polar(cx, cy, r - 5, i * 30); return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(231,211,154,0.4)" strokeWidth="0.6" />; })}
      <text x={cx} y={cy - 6} textAnchor="middle" className="mf-label-sm">{label}</text>
      <text x={cx} y={cy + 8} textAnchor="middle" className="mf-num-sm">{value}</text>
      <line x1={cx} y1={cy} x2={polar(cx, cy, r - 6, ang)[0]} y2={polar(cx, cy, r - 6, ang)[1]} stroke="url(#luxeGold)" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={1.8} fill="url(#luxeGold)" />
    </g>
  );
  return (
    <figure className="inst">
      <svg viewBox="0 0 220 220" role="img" aria-label="perpetual calendar" onClick={advance} style={{ cursor: "pointer" }}>
        {roundCase(C, C, 100)}
        {sub(C, 64, 30, "jour", WEEKDAYS[weekday], (weekday / 7) * 360)}
        {sub(64, C + 6, 30, "mois", MONTHS[month], (month / 12) * 360)}
        {sub(156, C + 6, 30, "bissext.", leapPos === 0 ? "LY" : String(leapPos), (leapPos / 4) * 360)}
        {/* big date aperture */}
        <g>
          <rect x={C - 22} y={150} width={44} height={30} rx={5} fill="url(#luxeSub)" stroke="rgba(231,211,154,0.3)" strokeWidth="0.8" />
          <text x={C} y={172} textAnchor="middle" className="cal-date">{date}</text>
        </g>
        <text x={C} y={132} textAnchor="middle" className="mf-label-sm">quantième perpétuel · {year}</text>
        {crystal(C, C, 100)}
      </svg>
      <figcaption><span>perpetual calendar</span><em>tap to step the month</em></figcaption>
    </figure>
  );
}

/* ───────────────────── Equation of time ───────────────────── */
function eot(dayOfYear: number) {
  const B = (360 / 365) * (dayOfYear - 81) * DEG;
  return 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B); // minutes
}
function declination(dayOfYear: number) {
  const B = (360 / 365) * (dayOfYear - 81) * DEG;
  return 23.45 * Math.sin(B);
}
function EquationOfTime() {
  const dayRef = useRef(0);
  const animating = useRef(false);
  const [, force] = useState(0);
  const [onFrame, hbRef] = useHeartbeat();
  onFrame((dt) => { if (!animating.current || reduceMotion()) return; dayRef.current = (dayRef.current + dt * 60) % 365; force((n) => (n + 1) % 1e6); });
  const C = 110;
  const today = (() => { const n = new Date(); return Math.floor((n.getTime() - new Date(n.getFullYear(), 0, 0).getTime()) / 86400000); })();
  const day = animating.current ? dayRef.current : today;
  const e = eot(day);
  const analemma = Array.from({ length: 73 }, (_, i) => { const dd = i * 5; const x = C + eot(dd) * 2.4; const y = C - declination(dd) * 1.7; return [x, y] as const; });
  const mx = C + e * 2.4, my = C - declination(day) * 1.7;
  const run = (e2: React.MouseEvent) => { e2.stopPropagation(); dayRef.current = 0; animating.current = !animating.current; try { getFieldAudio().bell(); } catch { /* noop */ } haptics.roll(); tape("sigil", 0.7, "time/eot/run"); };
  const gAng = e / 16 * 70; // ±16 min over ±70°
  return (
    <figure className="inst" ref={hbRef}>
      <svg viewBox="0 0 220 220" role="img" aria-label="equation of time" onClick={run} style={{ cursor: "pointer" }}>
        {roundCase(C, C, 100, "url(#luxeNight)")}
        {/* the analemma figure-8 */}
        <polyline points={analemma.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")} fill="none" stroke="rgba(231,211,154,0.5)" strokeWidth="1" />
        <line x1={C} y1={28} x2={C} y2={192} stroke="rgba(159,182,201,0.2)" strokeWidth="0.5" />
        {/* ±minute scale at top */}
        {[-15, -10, -5, 0, 5, 10, 15].map((mm) => { const x = C + mm * 2.4; return <g key={mm}><line x1={x} y1={40} x2={x} y2={44} stroke="rgba(231,211,154,0.4)" strokeWidth="0.6" /><text x={x} y={36} textAnchor="middle" className="mf-num-sm">{mm > 0 ? `+${mm}` : mm}</text></g>; })}
        {/* sun marker on the analemma */}
        <circle cx={mx} cy={my} r={4} fill="url(#luxeGold)" filter="url(#luxeGlow)" />
        {/* retrograde minute hand at bottom */}
        <g transform={`translate(${C} ${190})`}>
          <path d={`M ${polar(0, 0, 22, -70)[0]} ${polar(0, 0, 22, -70)[1]} A 22 22 0 0 1 ${polar(0, 0, 22, 70)[0]} ${polar(0, 0, 22, 70)[1]}`} fill="none" stroke="rgba(231,211,154,0.4)" strokeWidth="1" />
          <line x1={0} y1={0} x2={polar(0, 0, 19, gAng)[0]} y2={polar(0, 0, 19, gAng)[1]} stroke="#c0563a" strokeWidth="1.4" strokeLinecap="round" />
          <circle r={1.8} fill="#c0563a" />
        </g>
        <text x={C} y={122} textAnchor="middle" className="eot-val">{e >= 0 ? "+" : ""}{e.toFixed(1)} min</text>
        <text x={C} y={210} textAnchor="middle" className="mf-label-sm">équation du temps</text>
        {crystal(C, C, 100)}
      </svg>
      <figcaption><span>equation of time</span><em>tap to trace the year</em></figcaption>
    </figure>
  );
}

/* ───────────────────────── Clepsydra (water clock) ───────────────────────── */
function Clepsydra() {
  const level = useRef(0.0);     // 0 empty (top full) .. 1 (bottom full)
  const ripples = useRef<Array<{ t0: number }>>([]);
  const DURATION = 16;
  const [onFrame, hbRef] = useHeartbeat();
  onFrame((dt, now) => { if (reduceMotion()) return; if (level.current < 1) level.current = Math.min(1, level.current + dt / DURATION); ripples.current = ripples.current.filter((r) => now - r.t0 < 1200); });
  const refill = () => { level.current = 0; ripples.current.push({ t0: performance.now() }); try { getFieldAudio().chime(); window.setTimeout(() => { try { getFieldAudio().playNote(55, 200); } catch { /* noop */ } }, 100); } catch { /* noop */ } haptics.ripple(0.6); tape("ripple", 0.6, "time/clepsydra/refill"); };
  const C = 110, p = level.current;
  const topFill = 1 - p, botFill = p;
  const hourMark = Math.floor(p * 12);
  return (
    <figure className="inst" ref={hbRef}>
      <svg viewBox="0 0 220 220" role="img" aria-label="water clock" onClick={refill} style={{ cursor: "pointer" }}>
        {roundCase(C, C, 100)}
        <defs>
          <linearGradient id="clepWater" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7fd0e6" /><stop offset="100%" stopColor="#2f7fb0" /></linearGradient>
          <clipPath id="clepTop"><rect x={70} y={42} width={80} height={56} rx={8} /></clipPath>
          <clipPath id="clepBot"><rect x={70} y={120} width={80} height={56} rx={8} /></clipPath>
        </defs>
        {/* hour graduations on the lower vessel */}
        <rect x={70} y={42} width={80} height={56} rx={8} fill="rgba(210,240,245,0.08)" stroke="rgba(220,240,245,0.35)" strokeWidth="1" />
        <rect x={70} y={120} width={80} height={56} rx={8} fill="rgba(210,240,245,0.08)" stroke="rgba(220,240,245,0.35)" strokeWidth="1" />
        <g clipPath="url(#clepTop)"><rect x={70} y={42 + (1 - topFill) * 56} width={80} height={56} fill="url(#clepWater)" opacity="0.9" /></g>
        <g clipPath="url(#clepBot)">
          <rect x={70} y={176 - botFill * 56} width={80} height={56} fill="url(#clepWater)" opacity="0.9" />
          {ripples.current.map((r, i) => { const age = (performance.now() - r.t0) / 1200; return <ellipse key={i} cx={110} cy={176 - botFill * 56 + 4} rx={6 + age * 30} ry={2 + age * 6} fill="none" stroke="rgba(220,245,255,0.5)" strokeOpacity={1 - age} strokeWidth="0.8" />; })}
        </g>
        {/* hour ticks beside lower vessel */}
        {Array.from({ length: 13 }, (_, i) => <line key={i} x1={152} y1={176 - (i / 12) * 56} x2={i % 3 === 0 ? 160 : 156} y2={176 - (i / 12) * 56} stroke="rgba(231,211,154,0.5)" strokeWidth="0.7" />)}
        {/* dripping neck */}
        {p < 1 && <line x1={110} y1={98} x2={110} y2={120} stroke="#7fd0e6" strokeWidth="1.2" strokeDasharray="2 3" />}
        <text x={110} y={206} textAnchor="middle" className="mf-label-sm">clepsydre · hour {hourMark}</text>
        {crystal(C, C, 100)}
      </svg>
      <figcaption><span>water clock</span><em>tap to refill the vessel</em></figcaption>
    </figure>
  );
}

/* ───────────────────────── Pulsar (atomic beat) ───────────────────────── */
function Pulsar() {
  const beam = useRef(0);
  const beats = useRef(0);
  const lastBeat = useRef(0);
  const flash = useRef(0);
  const PERIOD = 1.337; // s per rotation — a pulsar's lighthouse
  const [onFrame, hbRef] = useHeartbeat();
  onFrame((dt, now) => {
    if (reduceMotion()) return;
    beam.current += dt / PERIOD * Math.PI * 2;
    flash.current *= 0.9;
    if (now - lastBeat.current > PERIOD * 1000) {
      lastBeat.current = now; beats.current++; flash.current = 1;
      try { getFieldAudio().playNote(48, 40); } catch { /* noop */ }
    }
  });
  const C = 110;
  const sync = (e: React.MouseEvent) => { e.stopPropagation(); flash.current = 1; try { getFieldAudio().bell(); window.setTimeout(() => { try { getFieldAudio().playNote(72, 60); } catch { /* noop */ } }, 60); } catch { /* noop */ } haptics.chop(); tape("sigil", 0.8, "time/pulsar/sync"); };
  const deg = beam.current / DEG;
  return (
    <figure className="inst" ref={hbRef}>
      <svg viewBox="0 0 220 220" role="img" aria-label="pulsar — atomic beat" onClick={sync} style={{ cursor: "pointer" }}>
        {roundCase(C, C, 100, "url(#luxeNight)")}
        <defs>
          <linearGradient id="pulseBeam" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="rgba(127,220,230,0.7)" /><stop offset="100%" stopColor="rgba(127,220,230,0)" /></linearGradient>
          <clipPath id="pulseClip"><circle cx={C} cy={C} r={96} /></clipPath>
        </defs>
        <g clipPath="url(#pulseClip)">
          {/* gravitational-lens rings */}
          {[26, 46, 66, 86].map((r) => <circle key={r} cx={C} cy={C} r={r} fill="none" stroke="rgba(106,166,214,0.16)" strokeWidth="0.6" />)}
          {/* twin beams */}
          {[0, 180].map((o) => <polygon key={o} points={`${C},${C} ${polar(C, C, 96, deg + o - 6)[0]},${polar(C, C, 96, deg + o - 6)[1]} ${polar(C, C, 96, deg + o + 6)[0]},${polar(C, C, 96, deg + o + 6)[1]}`} fill="url(#pulseBeam)" />)}
          {/* neutron star core */}
          <circle cx={C} cy={C} r={6 + flash.current * 6} fill="#dffaff" opacity={0.6 + flash.current * 0.4} filter="url(#luxeGlow)" />
          <circle cx={C} cy={C} r={3} fill="#fff" />
        </g>
        {/* beat counter ring */}
        {Array.from({ length: 12 }, (_, i) => <circle key={i} cx={polar(C, C, 90, i * 30)[0]} cy={polar(C, C, 90, i * 30)[1]} r={1.6} fill={i === beats.current % 12 ? "#7fd0e6" : "rgba(231,211,154,0.3)"} />)}
        <text x={C} y={C + 70} textAnchor="middle" className="mf-label-sm">pulsar · {PERIOD}s</text>
        {crystal(C, C, 100)}
      </svg>
      <figcaption><span>atomic beat</span><em>tap to sync the pulse</em></figcaption>
    </figure>
  );
}

/* ───────────────────────── Cabinet ───────────────────────── */
export default function TimeCabinet() {
  return (
    <div className="time-cabinet">
      <LuxeDefs />
      <div className="cabinet-head">
        <p className="t-eyebrow">the cabinet / ten instruments / wound by hand</p>
        <h2>Other ways to keep it.</h2>
      </div>
      <div className="cabinet-grid">
        <Orrery />
        <Hourglass />
        <Metronome />
        <Sundial />
        <Astrolabe />
        <WorldTimer />
        <PerpetualCalendar />
        <EquationOfTime />
        <Clepsydra />
        <Pulsar />
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .time-cabinet { margin-top: 56px; }
        .cabinet-head h2 {
          margin: 6px 0 0;
          font-family: var(--font-serif);
          font-weight: 300;
          font-size: clamp(28px, 4vw, 40px);
          line-height: 1.05;
        }
        .cabinet-head .t-eyebrow { color: rgba(242,238,230,0.56); }
        .cabinet-grid {
          margin-top: 22px;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 16px;
        }
        .inst {
          margin: 0;
          border: 1px solid rgba(231, 211, 154, 0.16);
          border-radius: 12px;
          background:
            radial-gradient(120% 90% at 50% 0%, rgba(217,161,77,0.07), transparent 60%),
            rgba(242, 238, 230, 0.03);
          padding: 14px 14px 12px;
          display: grid;
          gap: 10px;
          justify-items: center;
          transition: border-color 0.25s ease, transform 0.25s ease, box-shadow 0.25s ease;
        }
        .inst:hover {
          border-color: rgba(231, 211, 154, 0.45);
          transform: translateY(-2px);
          box-shadow: 0 18px 44px rgba(0,0,0,0.45);
        }
        .inst svg { width: 100%; max-width: 250px; height: auto; touch-action: manipulation; }
        .inst figcaption { display: grid; gap: 2px; text-align: center; }
        .inst figcaption span {
          font-family: var(--font-numerals);
          font-size: 15px; letter-spacing: 1px;
          color: rgba(242, 238, 230, 0.92);
        }
        .inst figcaption em {
          font-family: var(--font-text); font-style: normal;
          font-size: 11px; text-transform: lowercase;
          color: rgba(242, 238, 230, 0.5);
        }
        .inst-hint { font-family: var(--font-text); font-size: 9px; letter-spacing: 0.5px; fill: rgba(231, 211, 154, 0.7); }
        .inst-num { font-family: var(--font-numerals); font-size: 16px; fill: rgba(242, 238, 230, 0.92); letter-spacing: 1px; }
        .astro-glyph { font-size: 9px; fill: rgba(231, 211, 154, 0.75); }
        .mf-num-sm { font-family: var(--font-numerals); font-size: 8px; fill: rgba(242,238,230,0.7); }
        .mf-label-sm { font-family: var(--font-text); font-size: 7px; letter-spacing: 0.4px; text-transform: lowercase; fill: rgba(231,211,154,0.55); }
        .wt-city { font-family: var(--font-text); font-size: 7.5px; letter-spacing: 0.5px; fill: rgba(231,211,154,0.55); }
        .wt-city.is-sel { fill: #f3b64e; }
        .wt-time { font-family: var(--font-numerals); font-size: 10px; fill: rgba(242,238,230,0.95); }
        .cal-date { font-family: var(--font-numerals); font-size: 20px; fill: rgba(242,238,230,0.95); }
        .eot-val { font-family: var(--font-numerals); font-size: 14px; fill: rgba(242,238,230,0.92); }
        @media (max-width: 980px) { .cabinet-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 560px) { .cabinet-grid { grid-template-columns: minmax(0, 1fr); } }
        @media (prefers-reduced-motion: reduce) { .inst:hover { transform: none; } }
      ` }} />
    </div>
  );
}
