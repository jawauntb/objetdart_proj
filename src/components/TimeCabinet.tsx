"use client";

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import { useField } from "@/store/field";

/**
 * /time — the cabinet.
 *
 * A drawer of playable timepieces that live below the grande complication.
 * Each one is a small instrument you can poke, drag, flip, and listen to:
 *
 *   · Orrery     — a planetary clock; fling it, pluck planets for notes.
 *   · Hourglass  — click to flip; sand falls; it chimes when turned.
 *   · Metronome  — start/stop; drag the bob to change tempo; it tocks.
 *   · Sundial    — drag the sun across the sky; the shadow tells the hour.
 */

const DEG = Math.PI / 180;
function polar(cx: number, cy: number, r: number, deg: number): readonly [number, number] {
  const a = (deg - 90) * DEG;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
const reduceMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// shared throttled heartbeat — returns a frame counter that ticks while active
function useHeartbeat(active = true, intervalMs?: number) {
  const [, setFrame] = useState(0);
  const cb = useRef<(dt: number, now: number) => void>(() => {});
  const setOnFrame = (fn: (dt: number, now: number) => void) => { cb.current = fn; };
  useEffect(() => {
    if (!active) return;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const min = intervalMs ?? (reduceMotion() ? 250 : coarse ? 33 : 16);
    let raf = 0;
    let prev = performance.now();
    let lastPaint = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      cb.current(dt, now);
      if (now - lastPaint >= min) { lastPaint = now; setFrame((f) => (f + 1) % 1e6); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, intervalMs]);
  return setOnFrame;
}

/* ───────────────────────── Orrery ───────────────────────── */
const PLANETS = [
  { r: 30, period: 6, color: "#c0563a", midi: 64, size: 3.2 },
  { r: 48, period: 11, color: "#6aa6d6", midi: 67, size: 4.4 },
  { r: 66, period: 19, color: "#d9a14d", midi: 71, size: 5.2 },
  { r: 84, period: 31, color: "#9d8fce", midi: 74, size: 3.8 },
] as const;

function Orrery() {
  const t = useRef(0);
  const spin = useRef(0);
  const spinVel = useRef(0.18);
  const trails = useRef<Array<{ x: number; y: number; t0: number; color: string }>>([]);
  const comet = useRef({ active: false, p: 0, y: 0, at: 2 });
  const [, force] = useState(0);

  const onFrame = useHeartbeat(true);
  onFrame((dt, now) => {
    if (reduceMotion()) { force((n) => (n + 1) % 1e6); return; }
    t.current += dt;
    spin.current += spinVel.current * dt;
    spinVel.current += (0.06 - spinVel.current) * 0.01; // settle toward a calm idle
    // comet scheduler
    if (!comet.current.active && t.current > comet.current.at) {
      comet.current = { active: true, p: 0, y: 20 + Math.random() * 160, at: 0 };
    }
    if (comet.current.active) {
      comet.current.p += dt * 0.5;
      if (comet.current.p > 1.2) comet.current = { active: false, p: 0, y: 0, at: t.current + 6 + Math.random() * 10 };
    }
    trails.current = trails.current.filter((tr) => now - tr.t0 < 1400);
  });

  const C = 110;
  const fling = () => {
    spinVel.current += 1.6;
    try { getFieldAudio().playSigilPhrase({ a: 0.7, b: 0.4, c: 0.6 }); } catch { /* noop */ }
    useField.getState().recordTape("sigil", 0.8, "time/orrery/fling");
  };
  const pluck = (i: number, x: number, y: number) => {
    const p = PLANETS[i];
    try { getFieldAudio().playNote(p.midi, 240); } catch { /* noop */ }
    trails.current.push({ x, y, t0: performance.now(), color: p.color });
    spinVel.current += 0.4;
    useField.getState().recordTape("object", 0.6, `time/orrery/planet${i}`);
  };

  return (
    <figure className="inst">
      <svg viewBox="0 0 220 220" role="img" aria-label="orrery — planetary clock" onClick={fling}>
        <defs>
          <radialGradient id="orrSky" cx="50%" cy="42%" r="70%">
            <stop offset="0%" stopColor="#141d2e" />
            <stop offset="100%" stopColor="#05070d" />
          </radialGradient>
          <radialGradient id="orrSun" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fff3cf" />
            <stop offset="55%" stopColor="#f3b64e" />
            <stop offset="100%" stopColor="#b9712a" />
          </radialGradient>
        </defs>
        <circle cx={C} cy={C} r={108} fill="url(#orrSky)" />
        {/* starfield */}
        {Array.from({ length: 40 }, (_, i) => {
          const sx = 8 + ((Math.sin(i * 12.9) * 43758) % 1 + 1) % 1 * 204;
          const sy = 8 + ((Math.sin(i * 78.2) * 43758) % 1 + 1) % 1 * 204;
          const tw = 0.4 + 0.4 * Math.sin(t.current * 1.5 + i);
          return <circle key={i} cx={sx} cy={sy} r={i % 5 === 0 ? 1.1 : 0.6} fill="#dfe7ff" opacity={0.3 + tw * 0.4} />;
        })}
        {/* trails */}
        {trails.current.map((tr, i) => {
          const age = (performance.now() - tr.t0) / 1400;
          return <circle key={i} cx={tr.x} cy={tr.y} r={2 + age * 14} fill="none" stroke={tr.color} strokeOpacity={0.5 * (1 - age)} strokeWidth="1" />;
        })}
        {/* orbit rings */}
        {PLANETS.map((p, i) => (
          <circle key={i} cx={C} cy={C} r={p.r} fill="none" stroke="rgba(159,182,201,0.18)" strokeWidth="0.6" />
        ))}
        {/* comet */}
        {comet.current.active && (() => {
          const cx = -10 + comet.current.p * 240;
          const cy = comet.current.y + Math.sin(comet.current.p * 3) * 8;
          return (
            <g>
              <line x1={cx - 16} y1={cy + 6} x2={cx} y2={cy} stroke="rgba(200,220,255,0.5)" strokeWidth="1.4" strokeLinecap="round" />
              <circle cx={cx} cy={cy} r={2} fill="#eaf2ff" />
            </g>
          );
        })()}
        {/* sun */}
        <circle cx={C} cy={C} r={10} fill="url(#orrSun)" />
        <circle cx={C} cy={C} r={10} fill="none" stroke="rgba(255,210,140,0.4)" strokeWidth="3" opacity={0.5 + 0.3 * Math.sin(t.current * 2)} />
        {/* planets */}
        {PLANETS.map((p, i) => {
          const ang = t.current * (Math.PI * 2 / p.period) + spin.current + i * 1.3;
          const x = C + Math.cos(ang) * p.r;
          const y = C + Math.sin(ang) * p.r;
          return (
            <g key={i} onClick={(e) => { e.stopPropagation(); pluck(i, x, y); }} style={{ cursor: "pointer" }}>
              <circle cx={x} cy={y} r={p.size + 4} fill={p.color} opacity="0.16" />
              <circle cx={x} cy={y} r={p.size} fill={p.color} />
              {i === 2 && <ellipse cx={x} cy={y} rx={p.size + 3} ry={1.4} fill="none" stroke="#e9d6a6" strokeWidth="0.8" transform={`rotate(${ang * 30} ${x} ${y})`} />}
            </g>
          );
        })}
      </svg>
      <figcaption><span>orrery</span><em>fling the system · pluck a planet</em></figcaption>
    </figure>
  );
}

/* ───────────────────────── Hourglass ───────────────────────── */
function Hourglass() {
  const progress = useRef(0);          // 0..1 of sand fallen this turn
  const flip = useRef(0);              // current rotation in deg (animated)
  const flipTarget = useRef(0);
  const grains = useRef<Array<{ x: number; y: number; vy: number; t0: number }>>([]);
  const lastGrain = useRef(0);
  const DURATION = 11;                 // seconds for a full turn

  const onFrame = useHeartbeat(true);
  onFrame((dt, now) => {
    const reduce = reduceMotion();
    flip.current += (flipTarget.current - flip.current) * (reduce ? 1 : 0.18);
    const settled = Math.abs(flipTarget.current - flip.current) < 2;
    if (settled && progress.current < 1 && !reduce) {
      progress.current = Math.min(1, progress.current + dt / DURATION);
      // spawn falling grains at the neck
      if (now - lastGrain.current > 90 && progress.current < 1) {
        lastGrain.current = now;
        grains.current.push({ x: 90 + (Math.random() - 0.5) * 3, y: 100, vy: 40 + Math.random() * 30, t0: now });
      }
    }
    grains.current = grains.current.filter((g) => now - g.t0 < 700);
    grains.current.forEach((g) => { g.y += g.vy * dt; });
  });

  const doFlip = () => {
    flipTarget.current += 180;
    progress.current = 0;
    grains.current = [];
    try {
      getFieldAudio().chime();
      window.setTimeout(() => { try { getFieldAudio().playNote(60, 120); } catch { /* noop */ } }, 120);
    } catch { /* noop */ }
    useField.getState().recordTape("object", 0.6, "time/hourglass/flip");
  };

  const p = progress.current;
  const topSand = 1 - p;     // fraction remaining in the top bulb
  const botSand = p;         // fraction piled in the bottom bulb
  const empty = p >= 0.999;

  return (
    <figure className="inst">
      <svg viewBox="0 0 180 200" role="img" aria-label="hourglass — click to flip" onClick={doFlip} style={{ cursor: "pointer" }}>
        <defs>
          <linearGradient id="hgGlass" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(180,210,220,0.10)" />
            <stop offset="50%" stopColor="rgba(220,240,245,0.22)" />
            <stop offset="100%" stopColor="rgba(180,210,220,0.10)" />
          </linearGradient>
          <linearGradient id="hgSand" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e7c879" />
            <stop offset="100%" stopColor="#c08a3c" />
          </linearGradient>
          <clipPath id="hgTop"><path d="M40 22 H140 L96 96 H84 Z" /></clipPath>
          <clipPath id="hgBot"><path d="M84 104 H96 L140 178 H40 Z" /></clipPath>
        </defs>
        <g transform={`rotate(${flip.current} 90 100)`}>
          {/* frame caps */}
          <rect x={32} y={16} width={116} height={8} rx={3} fill="#5a4528" />
          <rect x={32} y={176} width={116} height={8} rx={3} fill="#5a4528" />
          <line x1={40} y1={22} x2={40} y2={178} stroke="#7a5c34" strokeWidth="3" />
          <line x1={140} y1={22} x2={140} y2={178} stroke="#7a5c34" strokeWidth="3" />
          {/* glass bulbs */}
          <path d="M40 22 H140 L96 96 H84 Z" fill="url(#hgGlass)" stroke="rgba(220,240,245,0.45)" strokeWidth="1" />
          <path d="M84 104 H96 L140 178 H40 Z" fill="url(#hgGlass)" stroke="rgba(220,240,245,0.45)" strokeWidth="1" />
          {/* top sand (drains downward) */}
          <g clipPath="url(#hgTop)">
            <rect x={40} y={22 + (1 - topSand) * 74} width={100} height={80} fill="url(#hgSand)" />
          </g>
          {/* bottom pile (grows upward as a cone) */}
          <g clipPath="url(#hgBot)">
            <rect x={40} y={178 - botSand * 74} width={100} height={80} fill="url(#hgSand)" />
          </g>
          {/* falling stream */}
          {!empty && (
            <line x1={90} y1={96} x2={90} y2={104} stroke="#e7c879" strokeWidth="1.4" />
          )}
          {grains.current.map((g, i) => (
            <circle key={i} cx={g.x} cy={g.y} r={0.9} fill="#e7c879" opacity={0.9} />
          ))}
        </g>
        {empty && (
          <text x={90} y={196} textAnchor="middle" className="inst-hint">turn me over</text>
        )}
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

  const onFrame = useHeartbeat(true);
  onFrame((dt) => {
    if (!running.current || reduceMotion()) return;
    const hz = bpmRef.current / 60 / 2; // a full swing is two beats
    phase.current += dt * hz * Math.PI * 2;
    const s = Math.sin(phase.current);
    const side = s >= 0 ? 1 : -1;
    if (side !== lastSide.current) {
      lastSide.current = side;
      beat.current = (beat.current + 1) % 4;
      try {
        const a = getFieldAudio();
        if (beat.current === 0) a.playNote(84, 60); else a.playNote(72, 45);
      } catch { /* noop */ }
    }
  });

  const toggle = () => {
    if (moved.current) { moved.current = false; return; } // a drag, not a tap
    running.current = !running.current;
    if (running.current) { phase.current = 0; lastSide.current = 1; beat.current = 0; }
    try { getFieldAudio()[running.current ? "bell" : "thud"](); } catch { /* noop */ }
    useField.getState().recordTape("sigil", running.current ? 0.7 : 0.4, `time/metronome/${running.current ? "start" : "stop"}`);
    force((n) => n + 1);
  };

  // drag the bob vertically to change tempo (higher bob = slower)
  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    moved.current = false;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    e.stopPropagation();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    moved.current = true;
    const rect = (e.currentTarget as Element).getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height; // 0 top .. 1 bottom
    const v = Math.max(40, Math.min(208, Math.round(208 - (Math.max(0.12, Math.min(0.82, y)) - 0.12) / 0.7 * 168)));
    bpmRef.current = v; setBpm(v);
  };
  const onPointerUp = () => { dragging.current = false; };

  const ang = running.current ? Math.sin(phase.current) * 26 : 0;
  // bob position along the arm encodes tempo
  const bobR = 30 + (208 - bpm) / 168 * 58; // slower → bob higher (longer)
  const pivotX = 90, pivotY = 168;
  const [bx, by] = polar(pivotX, pivotY, bobR, 180 + ang);

  return (
    <figure className="inst">
      <svg
        viewBox="0 0 180 200" role="img" aria-label="metronome"
        onClick={toggle}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ cursor: "pointer" }}
      >
        <defs>
          <linearGradient id="metBody" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b2c1c" />
            <stop offset="100%" stopColor="#1c150d" />
          </linearGradient>
        </defs>
        {/* wooden pyramid body */}
        <path d="M90 18 L150 184 H30 Z" fill="url(#metBody)" stroke="#6a5230" strokeWidth="1.4" />
        <path d="M90 18 L150 184 H30 Z" fill="none" stroke="rgba(231,211,154,0.12)" strokeWidth="0.6" />
        {/* tempo scale */}
        {Array.from({ length: 9 }, (_, i) => {
          const yy = 50 + i * 14;
          return <line key={i} x1={84} y1={yy} x2={96} y2={yy} stroke="rgba(231,211,154,0.3)" strokeWidth="0.8" />;
        })}
        {/* pendulum */}
        <g>
          <line x1={pivotX} y1={pivotY} x2={polar(pivotX, pivotY, 96, 180 + ang)[0]} y2={polar(pivotX, pivotY, 96, 180 + ang)[1]} stroke="#cbb377" strokeWidth="2" strokeLinecap="round" />
          {/* draggable bob */}
          <g onPointerDown={onPointerDown}>
            <rect x={bx - 7} y={by - 5} width={14} height={10} rx={2} fill="#e7d39a" stroke="#8a6c34" strokeWidth="0.8" />
          </g>
          <circle cx={pivotX} cy={pivotY} r={3} fill="#e7d39a" />
        </g>
        {/* beat lamps */}
        {Array.from({ length: 4 }, (_, i) => (
          <circle key={i} cx={66 + i * 16} cy={192} r={2.6}
            fill={running.current && beat.current === i ? "#f3b64e" : "rgba(231,211,154,0.25)"} />
        ))}
      </svg>
      <figcaption><span>metronome</span><em>{running.current ? "ticking" : "tap to start"} · {bpm} bpm · drag the bob</em></figcaption>
    </figure>
  );
}

/* ───────────────────────── Sundial ───────────────────────── */
function Sundial() {
  const dayT = useRef(0.32);           // 0 dawn .. 0.5 noon .. 1 dusk
  const [, force] = useState(0);
  const animating = useRef(false);
  const dragging = useRef(false);
  const moved = useRef(false);

  const onFrame = useHeartbeat(true);
  onFrame((dt) => {
    if (!animating.current || reduceMotion()) return;
    dayT.current += dt * 0.12;
    if (dayT.current >= 1) { dayT.current = 1; animating.current = false; }
    force((n) => (n + 1) % 1e6);
  });

  const C = 110, baseY = 150, arcR = 92;
  const sunAng = 180 + dayT.current * 180; // sweeps left→right across the top
  const [sx, sy] = polar(C, baseY, arcR, sunAng);
  // shadow opposite the sun, length grows near dawn/dusk
  const lowSun = Math.sin(dayT.current * Math.PI);
  const shadowLen = 18 + (1 - lowSun) * 64;
  const shadowAng = dayT.current * 180 - 90; // gnomon shadow direction
  const [shx, shy] = polar(C, baseY, shadowLen, 90 + shadowAng);

  const hour = 6 + dayT.current * 12; // 6:00 .. 18:00
  const hh = Math.floor(hour);
  const mm = Math.floor((hour - hh) * 60);
  const night = dayT.current > 0.97 || dayT.current < 0.03;

  // sky palette by phase
  const t = dayT.current;
  const sky = t < 0.18
    ? ["#241a2e", "#7a4a3a"]      // dawn
    : t < 0.42
    ? ["#5a8fc0", "#bcd4e6"]      // morning
    : t < 0.6
    ? ["#7db4e6", "#dff0fb"]      // noon
    : t < 0.84
    ? ["#caa05a", "#f0c98a"]      // golden
    : ["#3a2a44", "#8a4a3a"];     // dusk

  const setFromPointer = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as Element).getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width * 220;
    const py = (e.clientY - rect.top) / rect.height * 200;
    const ang = Math.atan2(py - baseY, px - C); // radians, screen coords
    // map angle across the top arc to dayT 0..1
    let deg = ang / DEG; // -180..180; top is negative
    if (deg > 0) deg = py < baseY ? deg : (px < C ? 180 : 0);
    const frac = Math.max(0, Math.min(1, (deg + 180) / 180));
    dayT.current = frac;
    force((n) => (n + 1) % 1e6);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true; animating.current = false; moved.current = false;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setFromPointer(e);
  };
  const onPointerMove = (e: React.PointerEvent) => { if (dragging.current) { moved.current = true; setFromPointer(e); } };
  const onPointerUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    try { getFieldAudio().playNote(60 + Math.round(dayT.current * 24), 140); } catch { /* noop */ }
    useField.getState().recordTape("ripple", 0.3 + dayT.current * 0.5, "time/sundial/set");
  };
  const runDay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (moved.current) { moved.current = false; return; } // released after a drag
    dayT.current = 0; animating.current = true;
    try { getFieldAudio().bell(); } catch { /* noop */ }
    useField.getState().recordTape("sigil", 0.7, "time/sundial/run");
  };

  return (
    <figure className="inst">
      <svg
        viewBox="0 0 220 200" role="img" aria-label="sundial — drag the sun"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ cursor: "grab", touchAction: "none" }}
      >
        <defs>
          <linearGradient id="sunSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={sky[0]} />
            <stop offset="100%" stopColor={sky[1]} />
          </linearGradient>
          <radialGradient id="sunDisc" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fff6da" />
            <stop offset="60%" stopColor="#fbcf6b" />
            <stop offset="100%" stopColor="#e89a35" />
          </radialGradient>
        </defs>
        <rect x={0} y={0} width={220} height={baseY} fill="url(#sunSky)" />
        {/* stars at night */}
        {night && Array.from({ length: 26 }, (_, i) => {
          const stx = 8 + ((Math.sin(i * 12.9) * 43758) % 1 + 1) % 1 * 204;
          const sty = 8 + ((Math.sin(i * 41.2) * 43758) % 1 + 1) % 1 * 120;
          return <circle key={i} cx={stx} cy={sty} r={0.7} fill="#eaf0ff" opacity={0.7} />;
        })}
        {/* hour ticks along the arc */}
        {Array.from({ length: 13 }, (_, i) => {
          const a = 180 + (i / 12) * 180;
          const [x1, y1] = polar(C, baseY, arcR + 4, a);
          const [x2, y2] = polar(C, baseY, arcR - 2, a);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.35)" strokeWidth={i % 6 === 0 ? 1.4 : 0.7} />;
        })}
        {/* sun glow + disc */}
        <circle cx={sx} cy={sy} r={18} fill="#ffe6a8" opacity={0.35 * lowSun + 0.1} />
        <circle cx={sx} cy={sy} r={9} fill="url(#sunDisc)" style={{ cursor: "pointer" }} onClick={runDay} />
        {/* ground */}
        <rect x={0} y={baseY} width={220} height={200 - baseY} fill="#241a12" />
        <rect x={0} y={baseY} width={220} height={3} fill="rgba(231,211,154,0.18)" />
        {/* gnomon + cast shadow */}
        <line x1={C} y1={baseY} x2={shx} y2={shy} stroke="rgba(0,0,0,0.45)" strokeWidth={3} strokeLinecap="round" />
        <path d={`M${C - 6} ${baseY} L${C} ${baseY - 30} L${C + 6} ${baseY} Z`} fill="#cbb377" stroke="#8a6c34" strokeWidth="0.8" />
        {/* readout */}
        <text x={110} y={184} textAnchor="middle" className="inst-num">
          {String(hh).padStart(2, "0")}:{String(mm).padStart(2, "0")}
        </text>
      </svg>
      <figcaption><span>sundial</span><em>drag the sun · click it to run a day</em></figcaption>
    </figure>
  );
}

/* ───────────────────────── Cabinet ───────────────────────── */
export default function TimeCabinet() {
  return (
    <div className="time-cabinet">
      <div className="cabinet-head">
        <p className="t-eyebrow">the cabinet / four instruments / wound by hand</p>
        <h2>Other ways to keep it.</h2>
      </div>
      <div className="cabinet-grid">
        <Orrery />
        <Hourglass />
        <Metronome />
        <Sundial />
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
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
        }
        .inst {
          margin: 0;
          border: 1px solid rgba(231, 211, 154, 0.16);
          border-radius: 10px;
          background:
            radial-gradient(120% 90% at 50% 0%, rgba(217,161,77,0.06), transparent 60%),
            rgba(242, 238, 230, 0.03);
          padding: 14px 14px 12px;
          display: grid;
          gap: 10px;
          justify-items: center;
          transition: border-color 0.25s ease, transform 0.25s ease, box-shadow 0.25s ease;
        }
        .inst:hover {
          border-color: rgba(231, 211, 154, 0.42);
          transform: translateY(-2px);
          box-shadow: 0 18px 40px rgba(0,0,0,0.4);
        }
        .inst svg {
          width: 100%;
          max-width: 260px;
          height: auto;
          touch-action: manipulation;
        }
        .inst figcaption {
          display: grid;
          gap: 2px;
          text-align: center;
        }
        .inst figcaption span {
          font-family: var(--font-numerals);
          font-size: 15px;
          letter-spacing: 1px;
          color: rgba(242, 238, 230, 0.9);
        }
        .inst figcaption em {
          font-family: var(--font-text);
          font-style: normal;
          font-size: 11px;
          letter-spacing: 0;
          text-transform: lowercase;
          color: rgba(242, 238, 230, 0.5);
        }
        .inst-hint {
          font-family: var(--font-text);
          font-size: 9px;
          letter-spacing: 0.5px;
          fill: rgba(231, 211, 154, 0.7);
        }
        .inst-num {
          font-family: var(--font-numerals);
          font-size: 16px;
          fill: rgba(242, 238, 230, 0.92);
          letter-spacing: 1px;
        }
        @media (max-width: 720px) {
          .cabinet-grid { grid-template-columns: minmax(0, 1fr); }
        }
        @media (prefers-reduced-motion: reduce) {
          .inst:hover { transform: none; }
        }
      ` }} />
    </div>
  );
}
