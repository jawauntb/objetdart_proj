"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import { useField } from "@/store/field";

/**
 * /time — the grande complication.
 *
 * A chronograph imagined as if Patek Philippe, Seiko, and A. Lange & Söhne
 * shared a bench for a night: a guilloché dial under a fluted bezel, applied
 * markers, a flying tourbillon at six, a moonphase that tracks the real moon,
 * a retrograde power reserve, a central column-wheel chronograph sweep, and a
 * "motion amplitude" complication that reads the energy of your hand (pointer
 * velocity) and the tilt of your device the way a balance reads its mainspring.
 * Below the watch, the old spacetime manifold still bends while it counts.
 */

const C = 200; // dial centre (viewBox 0..400)
const DEG = Math.PI / 180;

function polar(cx: number, cy: number, r: number, deg: number): readonly [number, number] {
  const a = (deg - 90) * DEG;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function formatTime(ms: number) {
  const total = Math.max(0, Math.floor(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const hundredths = Math.floor((total % 1000) / 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

function pathFromPoints(points: Array<readonly [number, number]>) {
  return points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
}

function cubicPoint(
  t: number,
  p0: readonly [number, number],
  p1: readonly [number, number],
  p2: readonly [number, number],
  p3: readonly [number, number],
): readonly [number, number] {
  const inv = 1 - t;
  const x = inv * inv * inv * p0[0] + 3 * inv * inv * t * p1[0] + 3 * inv * t * t * p2[0] + t * t * t * p3[0];
  const y = inv * inv * inv * p0[1] + 3 * inv * inv * t * p1[1] + 3 * inv * t * t * p2[1] + t * t * t * p3[1];
  return [x, y];
}

// Real lunar phase 0..1 (0 = new, 0.5 = full). Conway-ish approximation.
function moonPhase(date: Date) {
  const synodic = 29.530588853;
  const known = Date.UTC(2000, 0, 6, 18, 14); // a known new moon
  const days = (date.getTime() - known) / 86400000;
  return ((days % synodic) + synodic) % synodic / synodic;
}

// SVG path for the illuminated portion of a moon at a given phase.
function moonLitPath(cx: number, cy: number, r: number, phase: number) {
  const a = phase * Math.PI * 2;
  const cosA = Math.cos(a);
  const rx = Math.abs(cosA) * r;
  const waxing = phase < 0.5;            // lit on the right while waxing
  const outerSweep = waxing ? 1 : 0;
  const innerSweep = cosA > 0 ? (waxing ? 0 : 1) : (waxing ? 1 : 0);
  return `M ${cx} ${cy - r} A ${r} ${r} 0 0 ${outerSweep} ${cx} ${cy + r} A ${rx} ${r} 0 0 ${innerSweep} ${cx} ${cy - r} Z`;
}

type Guilloche = { spirals: string[]; rings: number[] };
type MinuteTick = { x1: number; y1: number; x2: number; y2: number; major: boolean };
type HourMarker = { hour: number; angle: number; skip: boolean; doubled: boolean };

/**
 * Everything on the dial that never changes between frames — the case, the
 * fluted bezel, the engine-turned guilloché, the chapter ring, the applied
 * markers, the gradients. Memoised so the per-frame heartbeat only reconciles
 * the moving hands and complications (this is what keeps it smooth on phones).
 */
const StaticDial = memo(function StaticDial(props: {
  guilloche: Guilloche;
  minuteTrack: MinuteTick[];
  hourMarkers: HourMarker[];
}) {
  const { guilloche, minuteTrack, hourMarkers } = props;
  return (
    <>
      <defs>
        <radialGradient id="caseMetal" cx="38%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#3a3631" />
          <stop offset="45%" stopColor="#1d1a18" />
          <stop offset="100%" stopColor="#0c0b0a" />
        </radialGradient>
        <linearGradient id="bezel" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#c9b27e" />
          <stop offset="22%" stopColor="#7a663c" />
          <stop offset="50%" stopColor="#e7d39a" />
          <stop offset="74%" stopColor="#6f5b32" />
          <stop offset="100%" stopColor="#bda367" />
        </linearGradient>
        <radialGradient id="dialFace" cx="42%" cy="34%" r="85%">
          <stop offset="0%" stopColor="#1b2733" />
          <stop offset="40%" stopColor="#121b24" />
          <stop offset="100%" stopColor="#070b10" />
        </radialGradient>
        <radialGradient id="subFace" cx="42%" cy="34%" r="85%">
          <stop offset="0%" stopColor="#22303d" />
          <stop offset="100%" stopColor="#0a1118" />
        </radialGradient>
        <radialGradient id="goldHand" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="#f6e6b4" />
          <stop offset="100%" stopColor="#c79a4e" />
        </radialGradient>
        <radialGradient id="tourbWell" cx="50%" cy="40%" r="70%">
          <stop offset="0%" stopColor="#05080c" />
          <stop offset="100%" stopColor="#0d141c" />
        </radialGradient>
        <radialGradient id="moonSky" cx="50%" cy="50%" r="70%">
          <stop offset="0%" stopColor="#1a2440" />
          <stop offset="100%" stopColor="#070a16" />
        </radialGradient>
        <radialGradient id="lume" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#bfeede" />
          <stop offset="100%" stopColor="#5fae9a" />
        </radialGradient>
        <filter id="softShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="1.4" stdDeviation="1.6" floodColor="#000" floodOpacity="0.55" />
        </filter>
        <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.4" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <clipPath id="tourbClip"><circle cx={C} cy={292} r={36} /></clipPath>
        <clipPath id="moonClip"><circle cx={C + 54} cy={C + 54} r={20} /></clipPath>
      </defs>

      {/* case + fluted bezel */}
      <circle cx={C} cy={C} r={198} fill="url(#caseMetal)" />
      <circle cx={C} cy={C} r={196} fill="none" stroke="#000" strokeOpacity="0.6" strokeWidth="1" />
      <g>
        {Array.from({ length: 120 }, (_, i) => {
          const [x1, y1] = polar(C, C, 196, i * 3);
          const [x2, y2] = polar(C, C, 188, i * 3);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#000" strokeOpacity={i % 2 ? 0.28 : 0.06} strokeWidth="1.4" />;
        })}
      </g>
      <circle cx={C} cy={C} r={188} fill="url(#bezel)" />
      <circle cx={C} cy={C} r={180} fill="#0a0d11" />

      {/* dial face + guilloché */}
      <circle cx={C} cy={C} r={178} fill="url(#dialFace)" />
      <g opacity="0.5" stroke="#9fb6c9" fill="none" strokeWidth="0.35">
        {guilloche.rings.map((r, i) => (
          <circle key={`r${i}`} cx={C} cy={C} r={r} strokeOpacity={0.10 + (i % 3) * 0.04} />
        ))}
        {guilloche.spirals.map((path, i) => (
          <path key={`s${i}`} d={path} strokeOpacity="0.07" />
        ))}
      </g>

      {/* chapter ring: minute track */}
      <g>
        {minuteTrack.map((t, i) => (
          <line
            key={i}
            x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
            stroke={t.major ? "#e7d39a" : "rgba(231,211,154,0.5)"}
            strokeWidth={t.major ? 1.6 : 0.7}
            strokeLinecap="round"
          />
        ))}
      </g>

      {/* applied hour markers + lume */}
      <g>
        {hourMarkers.map((m) => {
          if (m.skip) return null;
          const [bx, by] = polar(C, C, 150, m.angle);
          if (m.doubled) {
            const [lx, ly] = polar(C, C, 150, m.angle - 2.4);
            const [rx, ry] = polar(C, C, 150, m.angle + 2.4);
            return (
              <g key={m.hour} filter="url(#softShadow)">
                {[[lx, ly], [rx, ry]].map(([x, y], k) => (
                  <g key={k} transform={`translate(${x} ${y}) rotate(${m.angle})`}>
                    <rect x={-2.4} y={-12} width={4.8} height={24} rx={1.6} fill="url(#goldHand)" />
                  </g>
                ))}
              </g>
            );
          }
          return (
            <g key={m.hour} transform={`translate(${bx} ${by}) rotate(${m.angle})`} filter="url(#softShadow)">
              <rect x={-2.6} y={-13} width={5.2} height={26} rx={1.8} fill="url(#goldHand)" />
              <circle cx={0} cy={-17} r={1.8} fill="url(#lume)" opacity="0.9" />
            </g>
          );
        })}
      </g>
    </>
  );
});

export default function TimeManifold() {
  // ── chronograph state ───────────────────────────────────────────
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [mass, setMass] = useState(42);
  const [velocity, setVelocity] = useState(0.42);
  const [laps, setLaps] = useState<number[]>([]);
  const startedAt = useRef(0);
  const storedElapsed = useRef(0);
  const lastControlAt = useRef(0);

  // ── live render heartbeat (drives the running dial every frame) ──
  const [, setFrame] = useState(0);
  const reduceRef = useRef(false);

  // animated, smoothed instrument values held in refs (no re-render churn)
  const anim = useRef({
    nowMs: Date.now(),
    tourbillon: 0,   // tourbillon cage rotation (rad)
    balance: 0,      // balance wheel oscillation (rad)
    amplitude: 0,    // motion energy 0..1 (smoothed)
    ampTarget: 0,
    tiltX: 0,        // device / pointer tilt, smoothed, -1..1
    tiltY: 0,
    tiltTX: 0,
    tiltTY: 0,
    power: 1,        // mainspring 0..1
  });
  const pointer = useRef({ x: 0, y: 0, t: 0, has: false });

  // ── live clock + tourbillon + motion loop (always running) ───────
  useEffect(() => {
    reduceRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // phones get a lighter paint cadence; the physics still integrate per frame
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const minInterval = reduceRef.current ? 250 : coarse ? 33 : 16;
    let raf = 0;
    let prev = performance.now();
    let lastPaint = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      const a = anim.current;
      const motion = reduceRef.current ? 0 : 1;
      a.nowMs = Date.now();

      // tourbillon cage: one rotation per minute, classic
      a.tourbillon += dt * (Math.PI * 2 / 60) * 60 * motion; // visually ~1 rev/sec for life
      // balance wheel: 4Hz beat, amplitude swells with motion energy
      const beat = Math.sin(now / 1000 * Math.PI * 2 * 4);
      a.balance = beat * (0.5 + a.amplitude * 0.9);

      // motion amplitude decays unless fed by pointer/tilt
      a.ampTarget *= 0.94;
      a.amplitude += (a.ampTarget - a.amplitude) * 0.12;

      // tilt easing toward target (set by device orientation / pointer)
      a.tiltX += (a.tiltTX - a.tiltX) * 0.08;
      a.tiltY += (a.tiltTY - a.tiltY) * 0.08;

      // mainspring: drains while the chronograph runs, idles otherwise
      if (running) a.power = Math.max(0, a.power - dt / 240);
      else a.power = Math.min(1, a.power + dt / 900);

      if (now - lastPaint >= minInterval) {
        lastPaint = now;
        setFrame((f) => (f + 1) % 1000000);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  // ── chronograph timer ────────────────────────────────────────────
  useEffect(() => {
    if (!running) return;
    startedAt.current = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      setElapsed(storedElapsed.current + now - startedAt.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  // ── motion sensitivity: pointer velocity + device orientation ────
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const p = pointer.current;
      const now = performance.now();
      if (p.has) {
        const dt = Math.max(8, now - p.t);
        const speed = Math.hypot(e.clientX - p.x, e.clientY - p.y) / dt; // px/ms
        anim.current.ampTarget = Math.min(1, anim.current.ampTarget + speed * 0.22);
      }
      p.x = e.clientX; p.y = e.clientY; p.t = now; p.has = true;
      // pointer position also drives a gentle parallax tilt
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      anim.current.tiltTX = Math.max(-1, Math.min(1, nx));
      anim.current.tiltTY = Math.max(-1, Math.min(1, ny));
    };
    const onOrient = (e: DeviceOrientationEvent) => {
      // gamma: left/right [-90,90], beta: front/back [-180,180]
      const gx = (e.gamma ?? 0) / 45;
      const gy = ((e.beta ?? 0) - 45) / 45;
      anim.current.tiltTX = Math.max(-1, Math.min(1, gx));
      anim.current.tiltTY = Math.max(-1, Math.min(1, gy));
      const mag = Math.min(1, (Math.abs(gx) + Math.abs(gy)) * 0.5);
      anim.current.ampTarget = Math.max(anim.current.ampTarget, mag * 0.6);
    };
    // iOS gates DeviceOrientation behind a permission prompt that must be
    // triggered by a user gesture — ask once on the first touch.
    type OrientCtor = { requestPermission?: () => Promise<"granted" | "denied"> };
    const DOE = (window as unknown as { DeviceOrientationEvent?: OrientCtor }).DeviceOrientationEvent;
    const needsPermission = !!DOE && typeof DOE.requestPermission === "function";
    const requestTilt = () => {
      window.removeEventListener("touchend", requestTilt);
      if (needsPermission && DOE?.requestPermission) {
        DOE.requestPermission().catch(() => { /* declined — pointer tilt still works */ });
      }
    };
    if (needsPermission) window.addEventListener("touchend", requestTilt, { once: true });

    window.addEventListener("pointermove", onMove);
    window.addEventListener("deviceorientation", onOrient);
    return () => {
      window.removeEventListener("touchend", requestTilt);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("deviceorientation", onOrient);
    };
  }, []);

  // ── derived relativity values for the manifold ───────────────────
  const gamma = 1 / Math.sqrt(Math.max(0.02, 1 - velocity * velocity));
  const proper = elapsed / gamma;
  const progress = (elapsed % 60000) / 60000;
  const worldline = useMemo(() => ({
    p0: [112, 342 - velocity * 82] as const,
    p1: [280, 280 - mass * 0.34] as const,
    p2: [462, 278 + velocity * 40] as const,
    p3: [812, 132 + velocity * 92] as const,
  }), [mass, velocity]);
  const lapMarkers = useMemo(() => {
    return laps.map((value, index) => {
      const t = (value % 60000) / 60000;
      const [x, y] = cubicPoint(t, worldline.p0, worldline.p1, worldline.p2, worldline.p3);
      return { value, index, x, y };
    });
  }, [laps, worldline]);

  const grid = useMemo(() => {
    const cx = 470;
    const cy = 230;
    const warp = (x: number, y: number): readonly [number, number] => {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy) + 8;
      const pull = (mass / 100) * 92 / d;
      return [x - dx * pull, y - dy * pull + pull * 30];
    };
    const lines: Array<Array<readonly [number, number]>> = [];
    for (let y = 62; y <= 398; y += 42) {
      lines.push(Array.from({ length: 70 }, (_, i) => warp(70 + i * 12, y)));
    }
    for (let x = 82; x <= 850; x += 48) {
      lines.push(Array.from({ length: 46 }, (_, i) => warp(x, 44 + i * 8)));
    }
    return lines;
  }, [mass]);

  // ── static dial furniture (memoised so the RAF doesn't recompute) ─
  const minuteTrack = useMemo(() => {
    return Array.from({ length: 60 }, (_, i) => {
      const major = i % 5 === 0;
      const [x1, y1] = polar(C, C, 178, i * 6);
      const [x2, y2] = polar(C, C, major ? 168 : 173, i * 6);
      return { x1, y1, x2, y2, major };
    });
  }, []);

  const hourMarkers = useMemo(() => {
    // applied baton markers; doubled at 12; subdial seats (3/6/9) skipped
    const skip = new Set([3, 6, 9]);
    return Array.from({ length: 12 }, (_, i) => {
      const hour = i === 0 ? 12 : i;
      return { hour, angle: i * 30, skip: skip.has(i), doubled: i === 0 };
    });
  }, []);

  const guilloche = useMemo(() => {
    // rose-engine spirals: several phase-shifted archimedean spirals + rings
    const spirals: string[] = [];
    const arms = 6;
    for (let s = 0; s < arms; s++) {
      const pts: Array<readonly [number, number]> = [];
      const phase = (s / arms) * Math.PI * 2;
      for (let i = 0; i <= 260; i++) {
        const tt = i / 260;
        const ang = phase + tt * Math.PI * 9;
        const r = 16 + tt * 150;
        pts.push([C + Math.cos(ang) * r, C + Math.sin(ang) * r]);
      }
      spirals.push(pathFromPoints(pts));
    }
    const rings = Array.from({ length: 22 }, (_, i) => 18 + i * 7.4);
    return { spirals, rings };
  }, []);

  // ── live angles (read each render from anim/clock) ───────────────
  const a = anim.current;
  const d = new Date(a.nowMs);
  const ms = d.getMilliseconds();
  const sec = d.getSeconds() + ms / 1000;
  const min = d.getMinutes() + sec / 60;
  const hr = (d.getHours() % 12) + min / 60;
  const hourAngle = hr * 30;
  const minAngle = min * 6;
  const liveSecAngle = sec * 6;            // running seconds subdial (sweep)
  const chronoSecAngle = (elapsed / 1000) % 60 * 6; // central chrono sweep

  const phase = moonPhase(d);              // 0..1
  const dateNum = d.getDate();

  // motion gauge: amplitude mapped to a balance "degrees" reading 0..320
  const ampDeg = Math.round(a.amplitude * 320);
  const ampAngle = -60 + a.amplitude * 120; // gauge needle within 120° arc

  // power reserve retrograde arc (−60°..+60° around 12)
  const powerAngle = -60 + a.power * 120;

  // subtle 3D parallax of the whole watch from tilt
  const tiltStyle = {
    transform: `rotateX(${(-a.tiltY * 7).toFixed(2)}deg) rotateY(${(a.tiltX * 7).toFixed(2)}deg)`,
  };

  // ── interactions ─────────────────────────────────────────────────
  const toggle = () => {
    if (running) {
      storedElapsed.current = elapsed;
      setRunning(false);
      try { getFieldAudio().thud(); } catch { /* noop */ }
      useField.getState().recordTape("sigil", 0.48, "time/pause");
      return;
    }
    setRunning(true);
    try {
      getFieldAudio().chime();
      window.setTimeout(() => getFieldAudio().playNote(72, 85), 95);
    } catch { /* noop */ }
    useField.getState().recordTape("sigil", 0.78, "time/start");
  };

  const reset = () => {
    storedElapsed.current = 0;
    setElapsed(0);
    setRunning(false);
    setLaps([]);
    try { getFieldAudio().thud(); } catch { /* noop */ }
    useField.getState().recordTape("sigil", 0.34, "time/reset");
  };

  const lap = () => {
    setLaps((current) => [elapsed, ...current].slice(0, 4));
    try { getFieldAudio().playNote(76, 120); } catch { /* noop */ }
    useField.getState().recordTape("sigil", 0.72, `time/lap/${formatTime(elapsed)}`);
  };

  const wind = () => {
    anim.current.power = 1;
    try {
      getFieldAudio().bell();
      window.setTimeout(() => getFieldAudio().playNote(67, 90), 70);
    } catch { /* noop */ }
    useField.getState().recordTape("object", 0.6, "time/wind");
  };

  const markControl = (meta: string, normalized: number) => {
    const now = performance.now();
    if (now - lastControlAt.current < 140) return;
    lastControlAt.current = now;
    const value = Math.max(0, Math.min(1, normalized));
    try { getFieldAudio().playNote(45 + Math.round(value * 24), 90); } catch { /* noop */ }
    useField.getState().recordTape("sigil", 0.32 + value * 0.5, `time/${meta}`);
  };

  return (
    <div className="time-page" data-touch-surface="true" data-pretext-ignore="true">
      <section className="time-shell">
        <div className="time-copy">
          <p className="t-eyebrow time-kicker">grande complication / chronographe / manifold of spacetime</p>
          <h1>Time bends while it counts.</h1>
          <p className="time-sub">
            A tourbillon at six, a moon at her station, a retrograde reserve, and a balance that
            reads the energy of your hand. Wind it. Move it. Let it run.
          </p>
        </div>

        <div className="time-grand">
          <svg className="time-grand-svg" style={tiltStyle} viewBox="0 0 400 400" role="img" aria-label="grande complication chronograph">
            <StaticDial guilloche={guilloche} minuteTrack={minuteTrack} hourMarkers={hourMarkers} />

            {/* ─── subdial: POWER RESERVE (12 o'clock, retrograde) ─── */}
            <g transform={`translate(${C} ${108})`}>
              <circle r={40} fill="url(#subFace)" stroke="rgba(231,211,154,0.25)" strokeWidth="0.8" />
              {Array.from({ length: 13 }, (_, i) => {
                const ang = -60 + i * 10;
                const [x1, y1] = polar(0, 0, 34, ang);
                const [x2, y2] = polar(0, 0, 29, ang);
                const hot = i >= 10;
                return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={hot ? "#c0563a" : "rgba(231,211,154,0.6)"} strokeWidth={i % 3 === 0 ? 1.3 : 0.7} />;
              })}
              <text y={26} textAnchor="middle" className="dial-label">réserve de marche</text>
              <line x1={0} y1={6} x2={polar(0, 0, 30, powerAngle)[0]} y2={polar(0, 0, 30, powerAngle)[1]} stroke="url(#goldHand)" strokeWidth="1.8" strokeLinecap="round" />
              <circle r={2.6} fill="url(#goldHand)" />
            </g>

            {/* ─── subdial: RUNNING SECONDS (3 o'clock, live) ─── */}
            <g transform={`translate(${292} ${C})`}>
              <circle r={40} fill="url(#subFace)" stroke="rgba(231,211,154,0.25)" strokeWidth="0.8" />
              {Array.from({ length: 60 }, (_, i) => {
                const major = i % 5 === 0;
                const [x1, y1] = polar(0, 0, 36, i * 6);
                const [x2, y2] = polar(0, 0, major ? 31 : 33.5, i * 6);
                return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(231,211,154,0.55)" strokeWidth={major ? 1.2 : 0.5} />;
              })}
              <text y={26} textAnchor="middle" className="dial-label">petite seconde</text>
              <g transform={`rotate(${liveSecAngle})`}>
                <line x1={0} y1={8} x2={0} y2={-32} stroke="#c0563a" strokeWidth="1.2" strokeLinecap="round" />
              </g>
              <circle r={2.2} fill="#c0563a" />
            </g>

            {/* ─── subdial: MOTION AMPLITUDE (9 o'clock) ─── */}
            <g transform={`translate(${108} ${C})`}>
              <circle r={40} fill="url(#subFace)" stroke="rgba(231,211,154,0.25)" strokeWidth="0.8" />
              {/* amplitude arc */}
              <path
                d={`M ${polar(0, 0, 33, -60)[0]} ${polar(0, 0, 33, -60)[1]} A 33 33 0 0 1 ${polar(0, 0, 33, 60)[0]} ${polar(0, 0, 33, 60)[1]}`}
                fill="none" stroke="rgba(95,174,154,0.4)" strokeWidth="2"
              />
              <path
                d={`M ${polar(0, 0, 33, -60)[0]} ${polar(0, 0, 33, -60)[1]} A 33 33 0 0 1 ${polar(0, 0, 33, ampAngle)[0]} ${polar(0, 0, 33, ampAngle)[1]}`}
                fill="none" stroke="url(#lume)" strokeWidth="2.6" strokeLinecap="round"
                opacity={0.6 + a.amplitude * 0.4}
              />
              {/* level bubble reads device / pointer tilt */}
              <circle cx={a.tiltX * 12} cy={6 + a.tiltY * 8} r={3.4} fill="url(#lume)" opacity="0.85" filter="url(#glow)" />
              <text y={-10} textAnchor="middle" className="dial-label">amplitude</text>
              <text y={24} textAnchor="middle" className="dial-num">{ampDeg}°</text>
              <line x1={0} y1={4} x2={polar(0, 0, 28, ampAngle)[0]} y2={polar(0, 0, 28, ampAngle)[1]} stroke="url(#goldHand)" strokeWidth="1.6" strokeLinecap="round" />
              <circle r={2.4} fill="url(#goldHand)" />
            </g>

            {/* ─── TOURBILLON aperture (6 o'clock, flying cage) ─── */}
            <g>
              <circle cx={C} cy={292} r={38} fill="url(#tourbWell)" stroke="rgba(231,211,154,0.3)" strokeWidth="1" />
              <g clipPath="url(#tourbClip)">
                {/* faint orbital field — the "space" inside the cage */}
                {Array.from({ length: 3 }, (_, i) => (
                  <ellipse key={i} cx={C} cy={292} rx={30 - i * 7} ry={12 - i * 3}
                    fill="none" stroke="rgba(120,170,210,0.18)" strokeWidth="0.6"
                    transform={`rotate(${i * 60 + a.tourbillon * 8} ${C} ${292})`} />
                ))}
                {/* rotating titanium cage */}
                <g transform={`rotate(${(a.tourbillon * 180 / Math.PI)} ${C} ${292})`}>
                  <circle cx={C} cy={292} r={30} fill="none" stroke="url(#bezel)" strokeWidth="1.6" />
                  {Array.from({ length: 3 }, (_, i) => {
                    const ang = i * 120;
                    const [ex, ey] = polar(C, 292, 30, ang);
                    return <line key={i} x1={C} y1={292} x2={ex} y2={ey} stroke="url(#bezel)" strokeWidth="1.4" />;
                  })}
                  {/* the balance wheel, oscillating */}
                  <g transform={`rotate(${a.balance * 60} ${C} ${292})`}>
                    <circle cx={C} cy={292} r={18} fill="none" stroke="#d9c184" strokeWidth="1.4" opacity="0.9" />
                    {Array.from({ length: 8 }, (_, i) => {
                      const ang = i * 45;
                      const [x1, y1] = polar(C, 292, 18, ang);
                      const [x2, y2] = polar(C, 292, 13, ang);
                      return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#d9c184" strokeWidth="2" strokeLinecap="round" opacity="0.8" />;
                    })}
                    <line x1={polar(C, 292, 18, 0)[0]} y1={polar(C, 292, 18, 0)[1]} x2={polar(C, 292, 18, 180)[0]} y2={polar(C, 292, 18, 180)[1]} stroke="#f0e3b8" strokeWidth="1" />
                  </g>
                  {/* blued-steel cage seconds pointer */}
                  <line x1={C} y1={292} x2={polar(C, 292, 30, 0)[0]} y2={polar(C, 292, 30, 0)[1]} stroke="#6aa6d6" strokeWidth="1.4" strokeLinecap="round" />
                  <circle cx={C} cy={292} r={3} fill="#0c1218" stroke="#d9c184" strokeWidth="0.8" />
                </g>
              </g>
              <text x={C} y={292 + 30} textAnchor="middle" className="dial-label">tourbillon</text>
            </g>

            {/* ─── MOONPHASE aperture (lower-right) ─── */}
            <g>
              <circle cx={C + 54} cy={C + 54} r={21} fill="#0a0d14" stroke="rgba(231,211,154,0.3)" strokeWidth="1" />
              <g clipPath="url(#moonClip)">
                <rect x={C + 34} y={C + 34} width={40} height={40} fill="url(#moonSky)" />
                {/* stars */}
                {Array.from({ length: 14 }, (_, i) => {
                  const sx = C + 36 + ((Math.sin(i * 12.9) * 43758) % 1 + 1) % 1 * 36;
                  const sy = C + 36 + ((Math.sin(i * 78.2) * 43758) % 1 + 1) % 1 * 36;
                  return <circle key={i} cx={sx} cy={sy} r={i % 4 === 0 ? 0.9 : 0.5} fill="#dfe7ff" opacity={0.5 + (i % 3) * 0.2} />;
                })}
                {/* the moon disc, illuminated fraction from real phase */}
                {(() => {
                  const cx = C + 54;
                  const cy = C + 54;
                  const r = 9;
                  return (
                    <g>
                      <circle cx={cx} cy={cy} r={r} fill="#10162a" />
                      <path d={moonLitPath(cx, cy, r, phase)} fill="#f3efe0" />
                      {/* faint maria so the full moon isn't a blank disc */}
                      <circle cx={cx - 2.6} cy={cy - 1.6} r={1.4} fill="#0b1020" opacity="0.12" />
                      <circle cx={cx + 1.8} cy={cy + 2.4} r={1.1} fill="#0b1020" opacity="0.10" />
                      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(0,0,0,0.3)" strokeWidth="0.5" />
                    </g>
                  );
                })()}
              </g>
            </g>

            {/* ─── retrograde DATE arc (upper-left) ─── */}
            <g transform={`translate(${C - 52} ${C - 52})`}>
              <path
                d={`M ${polar(0, 0, 22, -55)[0]} ${polar(0, 0, 22, -55)[1]} A 22 22 0 0 1 ${polar(0, 0, 22, 55)[0]} ${polar(0, 0, 22, 55)[1]}`}
                fill="none" stroke="rgba(231,211,154,0.35)" strokeWidth="1"
              />
              {Array.from({ length: 7 }, (_, i) => {
                const ang = -55 + (i / 6) * 110;
                const [x1, y1] = polar(0, 0, 22, ang);
                const [x2, y2] = polar(0, 0, 18, ang);
                return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(231,211,154,0.5)" strokeWidth="0.7" />;
              })}
              {(() => {
                const dAng = -55 + ((dateNum - 1) / 30) * 110;
                const [hx, hy] = polar(0, 0, 19, dAng);
                return <line x1={0} y1={0} x2={hx} y2={hy} stroke="#c0563a" strokeWidth="1.3" strokeLinecap="round" />;
              })()}
              <text y={-2} textAnchor="middle" className="dial-num">{dateNum}</text>
              <text y={32} textAnchor="middle" className="dial-label">date</text>
              <circle r={1.8} fill="#c0563a" />
            </g>

            {/* signature */}
            <text x={C} y={C - 96} textAnchor="middle" className="dial-sig">OBJET D&apos;ART</text>
            <text x={C} y={C - 84} textAnchor="middle" className="dial-fine">tourbillon · spacetime · genève</text>

            {/* ─── central hands ─── */}
            {/* hour */}
            <g transform={`rotate(${hourAngle} ${C} ${C})`} filter="url(#softShadow)">
              <path d={`M ${C} ${C + 18} L ${C - 4} ${C + 8} L ${C - 3} ${C - 78} L ${C} ${C - 96} L ${C + 3} ${C - 78} L ${C + 4} ${C + 8} Z`} fill="url(#goldHand)" stroke="#7a5c2a" strokeWidth="0.4" />
              <rect x={C - 1.4} y={C - 70} width={2.8} height={36} rx={1.4} fill="url(#lume)" opacity="0.8" />
            </g>
            {/* minute */}
            <g transform={`rotate(${minAngle} ${C} ${C})`} filter="url(#softShadow)">
              <path d={`M ${C} ${C + 24} L ${C - 3.4} ${C + 10} L ${C - 2.4} ${C - 116} L ${C} ${C - 134} L ${C + 2.4} ${C - 116} L ${C + 3.4} ${C + 10} Z`} fill="url(#goldHand)" stroke="#7a5c2a" strokeWidth="0.4" />
              <rect x={C - 1.2} y={C - 108} width={2.4} height={56} rx={1.2} fill="url(#lume)" opacity="0.8" />
            </g>
            {/* central chronograph sweep seconds (blued steel) */}
            <g transform={`rotate(${chronoSecAngle} ${C} ${C})`}>
              <line x1={C} y1={C + 40} x2={C} y2={C - 150} stroke="#6aa6d6" strokeWidth="1.5" strokeLinecap="round" filter="url(#glow)" />
              <circle cx={C} cy={C - 150} r={2.2} fill="#9cc8ee" />
              <circle cx={C} cy={C + 40} r={4.4} fill="#6aa6d6" />
            </g>
            {/* central cap */}
            <circle cx={C} cy={C} r={5} fill="url(#goldHand)" stroke="#5a4520" strokeWidth="0.6" />
            <circle cx={C} cy={C} r={1.6} fill="#2a2114" />

            {/* domed crystal sheen */}
            <ellipse cx={C - 46} cy={C - 60} rx={120} ry={70} fill="white" opacity="0.05" transform={`rotate(-24 ${C} ${C})`} />
          </svg>

          <div className="time-readout">
            <strong>{formatTime(elapsed)}</strong>
            <span>
              proper {formatTime(proper)} · γ {gamma.toFixed(2)} · reserve {Math.round(a.power * 100)}% · amp {ampDeg}°
            </span>
          </div>
        </div>

        <div className="time-controls" aria-label="chronograph controls">
          <div className="time-buttons">
            <button type="button" onClick={toggle}>{running ? "pause" : "start"}</button>
            <button type="button" onClick={lap}>lap</button>
            <button type="button" onClick={reset}>reset</button>
            <button type="button" onClick={wind}>wind</button>
          </div>
          <label>
            <span>mass</span>
            <input
              type="range"
              min="0"
              max="100"
              value={mass}
              onChange={(event) => {
                const value = Number(event.target.value);
                setMass(value);
                markControl("mass", value / 100);
              }}
            />
            <strong>{mass}</strong>
          </label>
          <label>
            <span>velocity</span>
            <input
              type="range"
              min="0"
              max="0.94"
              step="0.01"
              value={velocity}
              onChange={(event) => {
                const value = Number(event.target.value);
                setVelocity(value);
                markControl("velocity", value / 0.94);
              }}
            />
            <strong>{velocity.toFixed(2)}c</strong>
          </label>
        </div>

        <ol className="time-laps" aria-label="laps">
          {laps.length === 0 ? <li>laps wait here</li> : laps.map((value, index) => <li key={`${value}-${index}`}>{formatTime(value)}</li>)}
        </ol>

        <div className="time-stage">
          <svg className="time-manifold" viewBox="0 0 920 460" role="img" aria-label="spacetime manifold">
            <rect width="920" height="460" rx="8" fill="#0c0b0a" />
            {grid.map((line, index) => (
              <path
                key={index}
                d={pathFromPoints(line)}
                fill="none"
                stroke={index % 2 ? "rgba(108,181,190,0.28)" : "rgba(217,161,77,0.24)"}
                strokeWidth="1"
              />
            ))}
            <ellipse cx="470" cy="238" rx={42 + mass * 0.34} ry={18 + mass * 0.16} fill="rgba(217,161,77,0.2)" />
            <circle cx="470" cy="230" r={18 + mass * 0.24} fill="#d9a14d" opacity="0.86" />
            <path
              d={`M${worldline.p0[0]} ${worldline.p0[1]} C ${worldline.p1[0]} ${worldline.p1[1]}, ${worldline.p2[0]} ${worldline.p2[1]}, ${worldline.p3[0]} ${worldline.p3[1]}`}
              fill="none"
              stroke="#f2eee6"
              strokeWidth="3"
              strokeLinecap="round"
            />
            {lapMarkers.map((marker) => (
              <g key={`${marker.value}-${marker.index}`} className="time-lap-marker">
                <line
                  x1={marker.x}
                  y1={marker.y - 18}
                  x2={marker.x}
                  y2={marker.y + 18}
                  stroke="rgba(217,161,77,0.62)"
                  strokeWidth="1"
                  strokeDasharray="3 5"
                />
                <circle cx={marker.x} cy={marker.y} r="6" fill="#d9a14d" />
                <circle cx={marker.x} cy={marker.y} r="13" fill="none" stroke="rgba(217,161,77,0.28)" />
                <text x={marker.x + 12} y={marker.y - 10} className="time-caption">lap {marker.index + 1}</text>
              </g>
            ))}
            <text x="68" y="410" className="time-caption">space grid</text>
            <text x="650" y="80" className="time-caption">worldline tilts with velocity</text>
          </svg>
        </div>
      </section>

      <style dangerouslySetInnerHTML={{ __html: `
        .time-page {
          min-height: 100vh;
          background:
            radial-gradient(1200px 700px at 50% -10%, rgba(217,161,77,0.10), transparent 60%),
            #0c0b0a;
          color: rgba(242, 238, 230, 0.94);
        }
        .time-shell {
          max-width: 1240px;
          margin: 0 auto;
          padding: 34px var(--pad-x) 72px;
        }
        .time-kicker {
          color: rgba(242, 238, 230, 0.56);
          letter-spacing: 0;
        }
        .time-copy h1 {
          margin: 0;
          font-family: var(--font-serif);
          font-size: 58px;
          line-height: 1;
          font-weight: 300;
          letter-spacing: 0;
        }
        .time-sub {
          max-width: 56ch;
          margin: 14px 0 0;
          font-family: var(--font-serif);
          font-size: 18px;
          line-height: 1.5;
          color: rgba(242, 238, 230, 0.62);
        }
        .time-grand {
          margin: 30px auto 8px;
          display: grid;
          justify-items: center;
          gap: 16px;
          perspective: 1100px;
          transform-style: preserve-3d;
          will-change: transform;
          transition: transform 0.12s ease-out;
        }
        .time-grand-svg {
          width: min(520px, 88vw);
          height: auto;
          filter: drop-shadow(0 30px 60px rgba(0,0,0,0.6));
          transform-style: preserve-3d;
          will-change: transform;
          transition: transform 0.12s ease-out;
        }
        .dial-label {
          font-family: var(--font-text);
          font-size: 5px;
          letter-spacing: 0.5px;
          text-transform: lowercase;
          fill: rgba(231, 211, 154, 0.6);
        }
        .dial-num {
          font-family: var(--font-numerals);
          font-size: 11px;
          fill: rgba(242, 238, 230, 0.92);
        }
        .dial-sig {
          font-family: var(--font-numerals);
          font-size: 9px;
          letter-spacing: 2px;
          fill: rgba(231, 211, 154, 0.85);
        }
        .dial-fine {
          font-family: var(--font-text);
          font-size: 4.4px;
          letter-spacing: 0.6px;
          fill: rgba(231, 211, 154, 0.5);
        }
        .time-readout {
          display: grid;
          gap: 4px;
          text-align: center;
        }
        .time-readout strong {
          font-family: var(--font-numerals);
          font-size: 44px;
          line-height: 1;
          font-weight: 500;
          letter-spacing: 0.5px;
        }
        .time-readout span,
        .time-laps,
        .time-caption {
          font-family: var(--font-text);
          font-size: 12px;
          letter-spacing: 0;
          color: rgba(242, 238, 230, 0.58);
          fill: rgba(242, 238, 230, 0.58);
        }
        .time-controls {
          display: grid;
          grid-template-columns: minmax(280px, 1fr) repeat(2, minmax(180px, 0.8fr));
          gap: 10px;
          margin: 26px 0 12px;
        }
        .time-buttons,
        .time-controls label {
          min-height: 50px;
          border: 1px solid rgba(231, 211, 154, 0.22);
          border-radius: 6px;
          background: rgba(242, 238, 230, 0.05);
        }
        .time-buttons {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          overflow: hidden;
        }
        .time-buttons button {
          border: 0;
          border-right: 1px solid rgba(242, 238, 230, 0.12);
          background: transparent;
          color: rgba(242, 238, 230, 0.92);
          cursor: pointer;
          font-family: var(--font-text);
          font-size: 12px;
          letter-spacing: 0;
          text-transform: lowercase;
          transition: background 0.18s ease, color 0.18s ease;
        }
        .time-buttons button:hover { background: rgba(231, 211, 154, 0.12); color: #f4ecd6; }
        .time-buttons button:last-child { border-right: 0; }
        .time-controls label {
          display: grid;
          grid-template-columns: auto 1fr auto;
          gap: 10px;
          align-items: center;
          padding: 8px 12px;
          font-family: var(--font-text);
          font-size: 12px;
          letter-spacing: 0;
          text-transform: lowercase;
        }
        .time-controls strong {
          font-family: var(--font-numerals);
          font-size: 15px;
        }
        .time-laps {
          list-style: decimal-leading-zero;
          margin: 0 0 24px;
          padding-left: 28px;
        }
        .time-stage {
          display: grid;
          grid-template-columns: 1fr;
          gap: 14px;
        }
        .time-manifold {
          width: 100%;
          min-height: 380px;
          display: block;
          border: 1px solid rgba(231, 211, 154, 0.16);
          border-radius: 8px;
          background: rgba(242, 238, 230, 0.02);
        }
        @media (max-width: 900px) {
          .time-copy h1 { font-size: 42px; }
          .time-sub { font-size: 16px; }
          .time-controls { grid-template-columns: minmax(0, 1fr); }
          .time-buttons { min-width: 0; }
          .time-controls label {
            grid-template-columns: minmax(66px, auto) minmax(0, 1fr) minmax(58px, auto);
          }
          .time-controls input[type="range"] { min-width: 0; }
          .time-manifold { min-height: 300px; }
        }
        @media (max-width: 560px) {
          .time-readout strong { font-size: 34px; }
          .time-grand-svg { width: 92vw; }
        }
        @media (prefers-reduced-motion: reduce) {
          .time-grand { transition: none; }
        }
      ` }} />
    </div>
  );
}
