"use client";

/**
 * /relativity — the law itself, taught by hand in one continuous room.
 * The intimate counterpart to /manifold's cosmic overlook: where the fold
 * shows curvature from above, this room puts the covenant of light in
 * your fingers within two minutes, no words.
 *
 * Four phenomena share the space. Light is fast and nothing beats it:
 * rays cross at shooting-star speed, a tap rings a pulse at exactly c,
 * and a flick throws a matter comet that always lags its own launch
 * flash — harder flicks glow hotter instead of going faster (effort is
 * rapidity; energy diverges, speed doesn't). Motion slows time: two big
 * light clocks tick side by side, and dragging one stretches its
 * photon's path into diagonals at the same c, so its tick audibly and
 * visibly slows, recovering at rest. Gravity slows time: dwell plants a
 * mass (capped at four; the oldest evaporates), rays whip around the
 * well blue-in red-out, and of the twin drifting beacons the one caught
 * near a well blinks slower and warmer. Doppler: a grabbed lantern runs
 * blue ahead and red behind and its hum pitch-bends the same way.
 *
 * Twist rotates the lens: the room re-renders as a minimal Minkowski
 * diagram — worldlines of clocks, comets, lantern; tapped pulses as
 * light cones at exactly 45°; the moving clock's tick dots visibly
 * sparser. Thin mono numerals appear only there. Three-finger hold is
 * this room's one legitimate slow-light moment: time dilates and the
 * light nearly stands still so its geometry can be seen.
 *
 * Pure math in src/lib/relativity.ts (tick dilation, matter cap, doppler)
 * and src/lib/manifold-field.ts (bending, wells, gravitational dilation —
 * reused, not rebuilt). Deterministic throughout; no persistence — this
 * room is a law, not a place, and a law keeps no belongings.
 */

import { useEffect, useRef } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { useField } from "@/store/field";
import {
  SOFTENING,
  accelAt,
  geodesicStep,
  timeDilation,
  wellDepth,
  type MassPoint,
  type Ray,
} from "@/lib/manifold-field";
import {
  MATTER_CAP,
  dopplerShift,
  lorentzGamma,
  matterGlow,
  matterSpeed,
} from "@/lib/relativity";

const MAX_MASSES = 4;
const RAY_COUNT = 5;
const RAY_TRAIL = 26;
const EVAP_MS = 1600;
const MESH_GAP = 44;
const DIL_SOFT = 96; // wells read wide for clocks and beacons
const DIL_K = 4;
const MAX_COMETS = 7;
const MAX_PULSES = 8;
const MAX_RINGS = 9;
const HIST_MAX = 260;
const TICKS_MAX = 48;
const CLOCK_V_CAP = 0.95; // a carried clock's effective fraction of c
const RING_EVERY = 0.3; // lantern wavefront cadence, seconds of light time

type Mass = {
  id: string;
  nx: number;
  ny: number;
  m: number;
  plantedAt: number;
  growth: number;
  settled: boolean;
  charge: number;
  evapAt: number;
};

type RayState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  trail: Array<{ x: number; y: number; w: number }>;
};

type Pulse = { x: number; y: number; bornLight: number; strength: number };

type Comet = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  heat: number;
  born: number;
  trail: Array<{ x: number; y: number }>;
  hist: Array<{ x: number; tau: number }>;
};

type Ring = { x: number; y: number; bornLight: number; dx: number; dy: number; beta: number };

type Clock = {
  homeNx: number;
  homeNy: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  dir: 1 | -1;
  held: boolean;
  targetX: number;
  targetY: number;
  vEff: number;
  flashTop: number;
  flashBot: number;
  lastNoteAt: number;
  photonTrail: Array<{ x: number; y: number }>;
  hist: Array<{ x: number; tau: number }>;
  ticks: Array<{ x: number; tau: number }>;
};

type Lantern = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  held: boolean;
  targetX: number;
  targetY: number;
  humOn: boolean;
  lastRingAt: number;
  hist: Array<{ x: number; tau: number }>;
};

type Current = { x: number; y: number; dx: number; dy: number; born: number };

type Orbit = { x: number; y: number; omega: number; until: number };

type Carried = "clockA" | "clockB" | "lantern" | null;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const clamp01 = (v: number) => clamp(v, 0, 1);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function hash01(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

export default function RelativityRoom() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // ————— state —————
    let masses: Mass[] = [];
    let massSerial = 0;
    const rays: RayState[] = [];
    let spawnSerial = 0;
    const pulses: Pulse[] = [];
    const comets: Comet[] = [];
    const rings: Ring[] = [];
    const currents: Current[] = [];
    let orbit: Orbit | null = null;
    let width = 0;
    let height = 0;
    let rectLeft = 0;
    let rectTop = 0;
    let c = 600; // px/s — the one speed; rays, pulses, rings all ride it
    let rayG = 0;
    let clockGap = 150;
    let clockHalfW = 36;
    let raf = 0;
    let lastFrame = 0;
    let last = performance.now();
    let localT = 0; // matter's clock (dilatable ×0.25)
    let lightT = 0; // light's clock (freeze-frame under the three-finger law)
    let reduce = false;
    let timeScale = 1;
    let timeScaleTarget = 1;
    let rayScale = 1;
    let rayScaleTarget = 1;
    let windX = 0;
    let windY = 0;
    let windTargetX = 0;
    let windTargetY = 0;
    let lens = 0;
    let lensTarget = 0;
    let lensSnapped = 0;
    let carried: Carried = null;
    const beaconPhase = [0.4, 3.1];
    let beaconOffX = 0;
    let beaconOffY = 0;
    let lastInteractionAt = performance.now();
    let focused = false;
    let cursorNx = 0.5;
    let cursorNy = 0.55;
    let cursorVisible = false;
    let kbCharge = 0;
    let kbMassId: string | null = null;
    let lastGrowNoteAt = 0;
    let lastChargeNoteAt = 0;
    let lastCurrentNoteAt = 0;
    let lastScrubSoundAt = 0;
    let lastWindSoundAt = 0;
    let lastCaptureSoundAt = 0;
    let staticRayPaths: Array<Array<{ x: number; y: number }>> = [];
    let staticRaysStale = true;
    const hold: { mode: "fabric" | "mass" | null; massId: string | null; placed: boolean; done: boolean } = {
      mode: null,
      massId: null,
      placed: false,
      done: false,
    };

    const mkClock = (homeNx: number, homeNy: number, phase0: number): Clock => ({
      homeNx,
      homeNy,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      phase: phase0,
      dir: 1,
      held: false,
      targetX: 0,
      targetY: 0,
      vEff: 0,
      flashTop: -1e9,
      flashBot: -1e9,
      lastNoteAt: 0,
      photonTrail: [],
      hist: [],
      ticks: [],
    });
    // the twin at rest, and the one made to move — side by side, unmissable
    const clockA = mkClock(0.3, 0.3, 0.0);
    const clockB = mkClock(0.66, 0.3, 0.0);
    const lantern: Lantern = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      held: false,
      targetX: 0,
      targetY: 0,
      humOn: false,
      lastRingAt: 0,
      hist: [],
    };
    let placed = false; // homes assigned on first resize

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduce = mq.matches;
    const onMq = () => { reduce = mq.matches; staticRaysStale = true; };
    mq.addEventListener?.("change", onMq);

    // ————— helpers —————
    const audio = () => getFieldAudio();
    const note = (midi: number, ms = 120) => { try { audio().playNote(midi, ms); } catch { /* noop */ } };
    const tone = (hz: number, sec = 0.4) => { try { audio().playTone(hz, sec); } catch { /* noop */ } };

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      width = Math.max(320, Math.floor(r.width));
      height = Math.max(480, Math.floor(r.height));
      rectLeft = r.left;
      rectTop = r.top;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      // one speed of light for this viewport — rays, pulses, rings, comets' ceiling
      c = 0.85 * Math.max(width, height);
      rayG = 50 * c * c; // manifold strengths: whips and slingshots, not drift
      clockGap = clamp(0.22 * c, 84, height * 0.26);
      clockHalfW = clamp(width * 0.085, 26, 44);
      if (!placed) {
        placed = true;
        clockA.x = clockA.homeNx * width; clockA.y = clockA.homeNy * height;
        clockB.x = clockB.homeNx * width; clockB.y = clockB.homeNy * height;
        clockA.targetX = clockA.x; clockA.targetY = clockA.y;
        clockB.targetX = clockB.x; clockB.targetY = clockB.y;
        lantern.x = width * 0.5; lantern.y = height * 0.72;
        lantern.targetX = lantern.x; lantern.targetY = lantern.y;
      }
      staticRaysStale = true;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    const toLocal = (clientX: number, clientY: number) => ({
      x: clamp(clientX - rectLeft, 0, width),
      y: clamp(clientY - rectTop, 0, height),
    });

    const livePoints = (): MassPoint[] =>
      masses
        .filter((m) => !m.evapAt)
        .map((m) => ({ x: m.nx * width, y: m.ny * height, m: m.m * (m.settled ? 1 : 0.25 + 0.75 * m.growth) }));

    const massAt = (x: number, y: number): Mass | null => {
      let best: Mass | null = null;
      let bestD = Infinity;
      for (const m of masses) {
        if (m.evapAt) continue;
        const d = Math.hypot(x - m.nx * width, y - m.ny * height);
        if (d < Math.max(30, 12 + m.m * 18) && d < bestD) { bestD = d; best = m; }
      }
      return best;
    };

    const clockAt = (x: number, y: number): "clockA" | "clockB" | null => {
      for (const [id, k] of [["clockA", clockA], ["clockB", clockB]] as const) {
        if (Math.abs(x - k.x) < clockHalfW + 20 && Math.abs(y - k.y) < clockGap / 2 + 26) return id;
      }
      return null;
    };

    const lanternAt = (x: number, y: number): boolean =>
      Math.hypot(x - lantern.x, y - lantern.y) < 40;

    const firePulse = (x: number, y: number, strength: number) => {
      pulses.push({ x, y, bornLight: lightT, strength });
      if (pulses.length > MAX_PULSES) pulses.shift();
    };

    const placeMass = (x: number, y: number, settled: boolean): Mass => {
      const m: Mass = {
        id: `rm-${massSerial++}`,
        nx: clamp(x / width, 0.05, 0.95),
        ny: clamp(y / height, 0.08, 0.92),
        m: settled ? 0.9 : 0.5,
        plantedAt: performance.now(),
        growth: settled ? 1 : 0.06,
        settled,
        charge: 0,
        evapAt: 0,
      };
      masses.push(m);
      const alive = masses.filter((q) => !q.evapAt);
      if (alive.length > MAX_MASSES) {
        const oldest = alive.reduce((a, b) => (a.plantedAt <= b.plantedAt ? a : b));
        evaporate(oldest, 0.7);
      }
      note(26, 240);
      try { haptics.ripple(0.4); } catch { /* noop */ }
      staticRaysStale = true;
      useField.getState().recordTape("object", 0.6, "relativity/mass");
      return m;
    };

    const settleMass = (m: Mass) => {
      if (m.settled) return;
      m.settled = true;
      m.growth = 1;
      try { haptics.bloom(); } catch { /* noop */ }
      note(31, 420);
      staticRaysStale = true;
    };

    const evaporate = (m: Mass, strength = 1) => {
      if (m.evapAt) return;
      m.evapAt = performance.now();
      m.charge = 0;
      // collapse: one strong wave through everything, at c and no faster
      firePulse(m.nx * width, m.ny * height, (1.2 + m.m * 0.5) * strength);
      try { audio().bell(); } catch { /* noop */ }
      try { haptics.roll(); } catch { /* noop */ }
      staticRaysStale = true;
      useField.getState().recordTape("sigil", 0.85, "relativity/collapse");
    };

    const throwComet = (x: number, y: number, angle: number, speedPxMs: number) => {
      const effort = speedPxMs * 1000; // px/s of intent
      const v = matterSpeed(effort, c);
      const heat = matterGlow(effort, c);
      comets.push({
        x,
        y,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v,
        heat,
        born: performance.now(),
        trail: [],
        hist: [],
      });
      if (comets.length > MAX_COMETS) comets.shift();
      // the launch flash: light from the same hand, same instant — it wins,
      // every time, no matter the effort
      firePulse(x, y, 0.3 + heat * 0.25);
      note(38 + Math.round(heat * 10), 170);
      try { haptics.ripple(0.3 + heat * 0.4); } catch { /* noop */ }
      useField.getState().recordTape("object", 0.5, "relativity/comet");
    };

    // deterministic ray spawning, seeded by serial, entering from an edge
    const spawnRay = (): RayState => {
      const s = spawnSerial++;
      const edge = Math.floor(hash01(s * 7 + 1) * 4);
      const along = 0.12 + hash01(s * 13 + 5) * 0.76;
      const tilt = (hash01(s * 29 + 11) - 0.5) * 0.9;
      let x = 0, y = 0, a = 0;
      if (edge === 0) { x = -20; y = along * height; a = tilt; }
      else if (edge === 1) { x = width + 20; y = along * height; a = Math.PI + tilt; }
      else if (edge === 2) { x = along * width; y = -20; a = Math.PI / 2 + tilt; }
      else { x = along * width; y = height + 20; a = -Math.PI / 2 + tilt; }
      return { x, y, vx: Math.cos(a) * c, vy: Math.sin(a) * c, trail: [] };
    };
    for (let i = 0; i < RAY_COUNT; i++) rays.push(spawnRay());

    const grabAt = (x: number, y: number): Carried => {
      const k = clockAt(x, y);
      if (k) return k;
      if (lanternAt(x, y)) return "lantern";
      return null;
    };

    const carriedObj = (): Clock | Lantern | null =>
      carried === "clockA" ? clockA : carried === "clockB" ? clockB : carried === "lantern" ? lantern : null;

    const releaseCarried = (throwVx?: number, throwVy?: number) => {
      const obj = carriedObj();
      if (!obj) return;
      obj.held = false;
      if (throwVx !== undefined && throwVy !== undefined) {
        const cap = carried === "lantern" ? 0.9 * c : CLOCK_V_CAP * c;
        const sp = Math.hypot(throwVx, throwVy);
        const s = sp > cap ? cap / sp : 1;
        obj.vx = throwVx * s;
        obj.vy = throwVy * s;
      }
      carried = null;
    };

    // ————— gestures (grammar only; thresholds live in gesture/core) —————
    const detach = attachGestures(wrap, {
      tap: (e) => {
        lastInteractionAt = performance.now();
        if (e.fingers !== 1) return; // frame and law absorb stray taps
        const { x, y } = toLocal(e.x, e.y);
        // your pulse: a ring at exactly c — race it with anything you like
        firePulse(x, y, 0.5 + e.intensity * 0.8);
        note(45 + Math.round(e.intensity * 7), 200);
        try { haptics.ripple(0.3 + e.intensity * 0.4); } catch { /* noop */ }
      },
      flick: (e) => {
        lastInteractionAt = performance.now();
        if (carried) {
          // a thrown clock or lantern keeps its cast-off speed (capped, of course)
          releaseCarried(Math.cos(e.angle) * e.speed * 1000, Math.sin(e.angle) * e.speed * 1000);
          try { audio().chime(); } catch { /* noop */ }
          return;
        }
        if (e.fingers !== 1) return;
        const { x, y } = toLocal(e.x, e.y);
        throwComet(x, y, e.angle, e.speed);
      },
      hold: (e) => {
        lastInteractionAt = performance.now();
        if (e.fingers === 3) {
          // three fingers touch the law: time dilates, and — this room's one
          // legitimate slow-light moment — the light itself nearly stands
          // still, so its geometry can finally be seen
          if (e.phase === "enter") {
            timeScaleTarget = 0.25;
            rayScaleTarget = 0.04;
            note(24, 500);
            try { haptics.tap(); } catch { /* noop */ }
          }
          if (e.phase === "release") { timeScaleTarget = 1; rayScaleTarget = 1; }
          return;
        }
        if (e.fingers !== 1) return;
        const { x, y } = toLocal(e.x, e.y);
        if (e.phase === "enter") {
          if (grabAt(x, y)) { hold.mode = null; hold.massId = null; return; } // resting on an instrument is rest
          const m = massAt(x, y);
          if (m) { hold.mode = "mass"; hold.massId = m.id; }
          else { hold.mode = "fabric"; hold.massId = null; }
          hold.placed = false;
          hold.done = false;
          return;
        }
        if (e.phase === "release") {
          if (hold.mode === "fabric" && hold.massId) {
            const m = masses.find((q) => q.id === hold.massId);
            if (m && !m.settled) settleMass(m);
          }
          if (hold.mode === "mass" && hold.massId) {
            const m = masses.find((q) => q.id === hold.massId);
            if (m) m.charge = 0;
          }
          hold.mode = null;
          hold.massId = null;
          return;
        }
        if (hold.mode === "mass" && hold.massId) {
          const m = masses.find((q) => q.id === hold.massId);
          if (!m || m.evapAt) return;
          m.charge = clamp01((e.elapsed - 900) / 1600);
          const now = performance.now();
          if (m.charge > 0 && now - lastChargeNoteAt > 340) {
            lastChargeNoteAt = now;
            note(30 + Math.round(m.charge * 10), 100);
            try { haptics.tap(); } catch { /* noop */ }
          }
          if (e.tier >= 3 && !hold.done) {
            hold.done = true;
            hold.massId = null;
            evaporate(m);
          }
          return;
        }
        if (hold.mode === "fabric") {
          if (!hold.placed && e.tier >= 2) {
            // dwell on open dark: a mass gathers — long-press means grow
            hold.placed = true;
            const m = placeMass(x, y, false);
            hold.massId = m.id;
          } else if (hold.placed && hold.massId) {
            const m = masses.find((q) => q.id === hold.massId);
            if (m && !m.settled) {
              m.growth = clamp01(m.growth + 0.088 * (1 + e.intensity * 0.5));
              m.m = 0.5 + m.growth * 1.1;
              const now = performance.now();
              if (now - lastGrowNoteAt > 380) {
                lastGrowNoteAt = now;
                note(26 + Math.round(m.growth * 5), 140);
                try { haptics.tap(); } catch { /* noop */ }
              }
              if (m.growth >= 1) settleMass(m);
            }
          }
        }
      },
      drag: (e) => {
        lastInteractionAt = performance.now();
        const { x, y } = toLocal(e.x, e.y);
        if (e.fingers === 3) {
          // three fingers sweep the wanderers — comets, lantern, beacons, light
          windTargetX = clamp(e.vx * 1.3, -1, 1);
          windTargetY = clamp(e.vy * 1.3, -1, 1);
          const now = performance.now();
          const mag = Math.hypot(windTargetX, windTargetY);
          if (mag > 0.5 && now - lastWindSoundAt > 520) {
            lastWindSoundAt = now;
            note(38 + Math.round(mag * 5), 260);
            try { haptics.chop(); } catch { /* noop */ }
          }
          return;
        }
        if (e.fingers !== 1) return;
        if (e.phase === "start") {
          carried = grabAt(x, y);
          const obj = carriedObj();
          if (obj) {
            obj.held = true;
            obj.targetX = x;
            obj.targetY = y;
            try { audio().chime(); } catch { /* noop */ }
            try { haptics.tap(); } catch { /* noop */ }
          }
          return;
        }
        if (e.phase === "end") { releaseCarried(); return; }
        const obj = carriedObj();
        if (obj) {
          obj.targetX = x;
          obj.targetY = y;
          return;
        }
        // one finger elsewhere: a gentle aether current the light leans into
        currents.push({ x, y, dx: e.vx, dy: e.vy, born: performance.now() });
        if (currents.length > 10) currents.shift();
        const now = performance.now();
        if (now - lastCurrentNoteAt > 700) {
          lastCurrentNoteAt = now;
          note(50, 90);
        }
      },
      scrub: (e) => {
        lastInteractionAt = performance.now();
        const { x, y } = toLocal(e.cx, e.cy);
        // a circling hand stirs nearby light into brief closed orbits
        orbit = { x, y, omega: clamp(e.angularVelocity, -6, 6), until: performance.now() + 2600 };
        const now = performance.now();
        if (now - lastScrubSoundAt > 600) {
          lastScrubSoundAt = now;
          note(45 + Math.round(Math.min(6, Math.abs(e.winding))), 130);
          try { haptics.ripple(0.25); } catch { /* noop */ }
        }
      },
      twist: (e) => {
        lastInteractionAt = performance.now();
        // two fingers rotate the lens: the felt room ↔ its spacetime record
        if (e.phase === "move") {
          lensTarget = clamp01(lensTarget + e.angle / 1.7);
        } else if (e.phase === "end") {
          const snapped = lensTarget > 0.5 ? 1 : 0;
          if (snapped !== lensSnapped) {
            lensSnapped = snapped;
            try { haptics.lens(); } catch { /* noop */ }
            if (snapped === 1) { try { audio().chime(); } catch { /* noop */ } }
            else note(48, 160);
          }
          lensTarget = snapped;
        }
      },
    });

    // ————— keyboard dialect (arrows + enter + escape, quieter) —————
    const onKeyDown = (ev: KeyboardEvent) => {
      const step = 0.05;
      if (ev.key === "Escape") {
        lensTarget = 0;
        lensSnapped = 0;
        cursorVisible = false;
        kbCharge = 0;
        kbMassId = null;
        return;
      }
      if (ev.key.startsWith("Arrow")) {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        cursorVisible = true;
        if (ev.key === "ArrowLeft") cursorNx = clamp(cursorNx - step, 0.05, 0.95);
        if (ev.key === "ArrowRight") cursorNx = clamp(cursorNx + step, 0.05, 0.95);
        if (ev.key === "ArrowUp") cursorNy = clamp(cursorNy - step, 0.08, 0.95);
        if (ev.key === "ArrowDown") cursorNy = clamp(cursorNy + step, 0.08, 0.95);
        return;
      }
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        lastInteractionAt = performance.now();
        if (!cursorVisible) { cursorVisible = true; return; }
        const x = cursorNx * width;
        const y = cursorNy * height;
        const m = massAt(x, y);
        if (!ev.repeat && !m) {
          // a press is a tap: your pulse, at exactly c
          firePulse(x, y, 0.8);
          note(47, 200);
          return;
        }
        // held enter is the keyboard's dwell and ceremony
        kbCharge = clamp01(kbCharge + (ev.repeat ? 0.09 : 0.02));
        if (m) {
          if (kbMassId !== m.id) { kbMassId = m.id; kbCharge = 0.02; }
          m.charge = kbCharge;
          const now = performance.now();
          if (now - lastChargeNoteAt > 340) {
            lastChargeNoteAt = now;
            note(30 + Math.round(kbCharge * 10), 100);
          }
          if (kbCharge >= 1) {
            kbCharge = 0;
            kbMassId = null;
            evaporate(m);
          }
        } else if (kbCharge >= 1) {
          kbCharge = 0;
          placeMass(x, y, true);
        }
      }
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " ") {
        const m = masses.find((q) => q.id === kbMassId);
        if (m) m.charge = 0;
        kbCharge = 0;
        kbMassId = null;
      }
    };
    const onFocus = () => { focused = true; };
    const onBlur = () => { focused = false; cursorVisible = false; };
    wrap.addEventListener("keydown", onKeyDown);
    wrap.addEventListener("keyup", onKeyUp);
    wrap.addEventListener("focus", onFocus);
    wrap.addEventListener("blur", onBlur);

    // ————— field geometry: masses well the mesh, pulses ring through it —————
    const dispAt = (x: number, y: number, pts: MassPoint[]): { dx: number; dy: number } => {
      let dx = 0;
      let dy = 0;
      for (const p of pts) {
        const ddx = p.x - x;
        const ddy = p.y - y;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < 1) continue;
        const s2 = 70 * 70;
        const f = (22 * p.m * s2) / (d2 + s2) / Math.sqrt(d2);
        dx += ddx * f;
        dy += ddy * f;
      }
      for (const p of pulses) {
        const age = lightT - p.bornLight;
        const rf = age * c;
        const prog = clamp01(rf / (Math.max(width, height) * 1.2));
        const ddx = x - p.x;
        const ddy = y - p.y;
        const d = Math.hypot(ddx, ddy);
        if (d < 1) continue;
        const g = Math.exp(-((d - rf) * (d - rf)) / (2 * 30 * 30));
        const amp = 9 * p.strength * (1 - prog) * g;
        dx += (ddx / d) * amp;
        dy += (ddy / d) * amp;
      }
      return { dx, dy };
    };

    /** Reduced motion: light as still dashed geodesic traces, bent honestly. */
    const rebuildStaticRays = (pts: MassPoint[]) => {
      staticRaysStale = false;
      staticRayPaths = [];
      const dt = 1 / 120;
      for (let i = 0; i < 5; i++) {
        const y0 = height * (0.12 + 0.76 * (i / 4));
        let r: Ray = { x: -10, y: y0, vx: c, vy: 0 };
        const path = [{ x: r.x, y: r.y }];
        for (let s = 0; s < 420; s++) {
          r = geodesicStep(pts, r, dt, c, rayG, SOFTENING);
          path.push({ x: r.x, y: r.y });
          if (r.x < -40 || r.x > width + 40 || r.y < -40 || r.y > height + 40) break;
        }
        staticRayPaths.push(path);
      }
    };

    const pushHist = (hist: Array<{ x: number; tau: number }>, x: number) => {
      hist.push({ x, tau: lightT });
      if (hist.length > HIST_MAX) hist.shift();
    };

    // ————— per-frame physics —————
    const stepClock = (k: Clock, other: Clock, pts: MassPoint[], dt: number, now: number) => {
      if (k.held) {
        const nx = mix(k.x, k.targetX, Math.min(1, dt * 16));
        const ny = mix(k.y, k.targetY, Math.min(1, dt * 16));
        k.vx = dt > 0 ? (nx - k.x) / dt : 0;
        k.vy = dt > 0 ? (ny - k.y) / dt : 0;
        k.x = nx;
        k.y = ny;
      } else {
        // glide, then a soft damped spring home — the twins end up side by side
        const hx = k.homeNx * width;
        const hy = k.homeNy * height;
        k.vx += ((hx - k.x) * 1.6 - k.vx * 1.5) * dt;
        k.vy += ((hy - k.y) * 1.6 - k.vy * 1.5) * dt;
        const sp = Math.hypot(k.vx, k.vy);
        const cap = CLOCK_V_CAP * c;
        if (sp > cap) { k.vx *= cap / sp; k.vy *= cap / sp; }
        k.x = clamp(k.x + k.vx * dt * timeScale, clockHalfW, width - clockHalfW);
        k.y = clamp(k.y + k.vy * dt * timeScale, clockGap / 2 + 24, height - clockGap / 2 - 24);
      }
      // keep the twins from overlapping into one clock
      const sep = clockHalfW * 2 + 14;
      const ddx = k.x - other.x;
      if (Math.abs(ddx) < sep && Math.abs(k.y - other.y) < clockGap) {
        k.x = clamp(other.x + (ddx >= 0 ? sep : -sep), clockHalfW, width - clockHalfW);
      }
      const vMag = Math.min(Math.hypot(k.vx, k.vy), CLOCK_V_CAP * c);
      k.vEff = mix(k.vEff, vMag, Math.min(1, dt * 8));
      // the photon holds c: its vertical share is what motion leaves over —
      // and a nearby well leans on the clock too (gravitational dilation)
      const grav = timeDilation(pts, k.x, k.y, DIL_K, DIL_SOFT);
      const vert = Math.sqrt(Math.max(0, c * c - k.vEff * k.vEff));
      const lightRate = reduce ? 1 : rayScale;
      k.phase += (k.dir * vert * grav * dt * lightRate) / clockGap;
      if (k.phase >= 1 || k.phase <= 0) {
        k.phase = clamp01(k.phase);
        k.dir = (k.dir === 1 ? -1 : 1) as 1 | -1;
        if (k.phase >= 1) k.flashBot = now; else k.flashTop = now;
        k.ticks.push({ x: k.x, tau: lightT });
        if (k.ticks.length > TICKS_MAX) k.ticks.shift();
        // the tick: deeper and softer as the clock slows — heard, not read
        if (now - k.lastNoteAt > 80) {
          k.lastNoteAt = now;
          const gamma = lorentzGamma(k.vEff, c) / Math.max(0.25, grav);
          const dropped = Math.round(clamp((gamma - 1) * 8, 0, 12));
          if (k.phase <= 0) note(64 - dropped, 90);
          else tone(660 / Math.pow(2, dropped / 12), 0.06);
          if (k.held) { try { haptics.tap(); } catch { /* noop */ } }
        }
      }
      // the photon's world-path: straight down at rest, a long diagonal in
      // motion — the stretched path IS the slower tick, drawn
      k.photonTrail.push({ x: k.x, y: k.y - clockGap / 2 + k.phase * clockGap });
      if (k.photonTrail.length > 22) k.photonTrail.shift();
      pushHist(k.hist, k.x);
    };

    const stepLantern = (dt: number) => {
      if (lantern.held) {
        const nx = mix(lantern.x, lantern.targetX, Math.min(1, dt * 16));
        const ny = mix(lantern.y, lantern.targetY, Math.min(1, dt * 16));
        lantern.vx = dt > 0 ? (nx - lantern.x) / dt : 0;
        lantern.vy = dt > 0 ? (ny - lantern.y) / dt : 0;
        lantern.x = nx;
        lantern.y = ny;
      } else {
        // released: it coasts, then settles
        lantern.vx *= Math.exp(-dt * 1.1);
        lantern.vy *= Math.exp(-dt * 1.1);
        lantern.vx += windX * c * 0.25 * dt;
        lantern.vy += windY * c * 0.25 * dt;
        const sp = Math.hypot(lantern.vx, lantern.vy);
        const cap = 0.9 * c;
        if (sp > cap) { lantern.vx *= cap / sp; lantern.vy *= cap / sp; }
        lantern.x += lantern.vx * dt * timeScale;
        lantern.y += lantern.vy * dt * timeScale;
        if (lantern.x < 30 || lantern.x > width - 30) { lantern.vx *= -0.6; lantern.x = clamp(lantern.x, 30, width - 30); }
        if (lantern.y < 30 || lantern.y > height - 30) { lantern.vy *= -0.6; lantern.y = clamp(lantern.y, 30, height - 30); }
      }
      const sp = Math.hypot(lantern.vx, lantern.vy);
      // moving light leaves its wavefronts behind: rings at c, blue ahead,
      // red behind — the doppler pattern drawn by the lantern itself
      if ((sp > 40 || lantern.held) && lightT - lantern.lastRingAt > RING_EVERY) {
        lantern.lastRingAt = lightT;
        const beta = clamp(sp / c, 0, 0.95);
        rings.push({
          x: lantern.x,
          y: lantern.y,
          bornLight: lightT,
          dx: sp > 1 ? lantern.vx / sp : 1,
          dy: sp > 1 ? lantern.vy / sp : 0,
          beta,
        });
        if (rings.length > MAX_RINGS) rings.shift();
      }
      // the hum: pitch-bent toward the listener by the same law as the color
      if (sp > 24 || lantern.held) {
        const lx = width / 2;
        const ly = height / 2;
        const rx = lantern.x - lx;
        const ry = lantern.y - ly;
        const rd = Math.hypot(rx, ry) || 1;
        const vTow = -(lantern.vx * rx + lantern.vy * ry) / rd;
        const shift = dopplerShift(clamp(vTow, -0.9 * c, 0.9 * c), c);
        lantern.humOn = true;
        try { audio().holdConcernTone("love", clamp(50 + (shift - 1) * 55, 2, 98)); } catch { /* noop */ }
      } else if (lantern.humOn) {
        lantern.humOn = false;
        try { audio().releaseConcernTone("love"); } catch { /* noop */ }
      }
      pushHist(lantern.hist, lantern.x);
    };

    // ————— the loop —————
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (!reduce && now - lastFrame < 30) return;
      lastFrame = now;
      const delta = Math.min(64, now - last);
      last = now;
      const dt = delta / 1000;

      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dt * 5);
      rayScale += (rayScaleTarget - rayScale) * Math.min(1, dt * 5);
      if (!reduce) localT += dt * timeScale;
      lightT += dt * (reduce ? 1 : rayScale);
      windX += (windTargetX - windX) * Math.min(1, dt * 2.2);
      windY += (windTargetY - windY) * Math.min(1, dt * 2.2);
      windTargetX *= Math.exp(-dt * 0.5);
      windTargetY *= Math.exp(-dt * 0.5);
      lens += (lensTarget - lens) * Math.min(1, dt * 6);
      beaconOffX = beaconOffX * Math.exp(-dt * 0.6) + windX * 160 * dt;
      beaconOffY = beaconOffY * Math.exp(-dt * 0.6) + windY * 160 * dt;

      const pts = livePoints();

      for (let i = masses.length - 1; i >= 0; i--) {
        const m = masses[i];
        if (m.evapAt && now - m.evapAt > EVAP_MS) { masses.splice(i, 1); continue; }
        if (!hold.massId || hold.massId !== m.id) {
          if (kbMassId !== m.id) m.charge = Math.max(0, m.charge - dt * 1.6);
        }
      }
      for (let i = currents.length - 1; i >= 0; i--) if (now - currents[i].born > 900) currents.splice(i, 1);
      for (let i = pulses.length - 1; i >= 0; i--) {
        if ((lightT - pulses[i].bornLight) * c > Math.max(width, height) * 1.35) pulses.splice(i, 1);
      }
      for (let i = rings.length - 1; i >= 0; i--) {
        if ((lightT - rings[i].bornLight) * c > Math.max(width, height) * 0.9) rings.splice(i, 1);
      }
      if (orbit && now > orbit.until) orbit = null;

      // matter: comets fall toward wells, never past their cap
      const matterCap = MATTER_CAP * c;
      for (let i = comets.length - 1; i >= 0; i--) {
        const q = comets[i];
        const a = accelAt(pts, q.x, q.y, rayG * 0.35, SOFTENING);
        q.vx += (a.ax + windX * c * 0.4) * dt * timeScale;
        q.vy += (a.ay + windY * c * 0.4) * dt * timeScale;
        const sp = Math.hypot(q.vx, q.vy);
        if (sp > matterCap) { q.vx *= matterCap / sp; q.vy *= matterCap / sp; }
        q.x += q.vx * dt * timeScale;
        q.y += q.vy * dt * timeScale;
        q.trail.push({ x: q.x, y: q.y });
        if (q.trail.length > 30) q.trail.shift();
        pushHist(q.hist, q.x);
        let gone = q.x < -70 || q.x > width + 70 || q.y < -70 || q.y > height + 70 || now - q.born > 14000;
        for (const p of pts) {
          if (Math.hypot(q.x - p.x, q.y - p.y) < 12) {
            gone = true;
            if (now - lastCaptureSoundAt > 1500) { lastCaptureSoundAt = now; note(28, 180); }
            break;
          }
        }
        if (gone) comets.splice(i, 1);
      }

      stepClock(clockA, clockB, pts, dt, now);
      stepClock(clockB, clockA, pts, dt, now);
      stepLantern(dt);

      // ————— background: ink with a cold slow breath —————
      const bg = ctx.createLinearGradient(0, 0, 0, height);
      bg.addColorStop(0, "#05070c");
      bg.addColorStop(0.6, "#05070e");
      bg.addColorStop(1, "#070810");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
      const breathA = reduce ? 0.05 : 0.04 + Math.sin(localT * Math.PI * 2 * 0.14) * 0.015;
      const halo = ctx.createRadialGradient(width * 0.5, height * 0.36, 20, width * 0.5, height * 0.36, Math.max(width, height) * 0.8);
      halo.addColorStop(0, `rgba(130, 160, 220, ${breathA})`);
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, width, height);

      // ————— the mesh: hairlines, welling only where mass gathers —————
      if (pts.length > 0 || pulses.length > 0) {
        const cols = Math.ceil(width / MESH_GAP) + 1;
        const rows = Math.ceil(height / MESH_GAP) + 1;
        const vx: number[] = new Array(cols * rows);
        const vy: number[] = new Array(cols * rows);
        for (let j = 0; j < rows; j++) {
          for (let i = 0; i < cols; i++) {
            const x = i * MESH_GAP;
            const y = j * MESH_GAP;
            const d = dispAt(x, y, pts);
            vx[j * cols + i] = x + d.dx;
            vy[j * cols + i] = y + d.dy;
          }
        }
        ctx.lineWidth = 0.6;
        ctx.strokeStyle = "rgba(206, 222, 250, 0.045)";
        ctx.beginPath();
        for (let j = 0; j < rows; j++) {
          for (let i = 0; i < cols; i++) {
            const idx = j * cols + i;
            if (i === 0) ctx.moveTo(vx[idx], vy[idx]);
            else ctx.lineTo(vx[idx], vy[idx]);
          }
        }
        for (let i = 0; i < cols; i++) {
          for (let j = 0; j < rows; j++) {
            const idx = j * cols + i;
            if (j === 0) ctx.moveTo(vx[idx], vy[idx]);
            else ctx.lineTo(vx[idx], vy[idx]);
          }
        }
        ctx.stroke();
      }

      // ————— masses: dark presences with a cold rim —————
      for (const m of masses) {
        const mx = m.nx * width;
        const my = m.ny * height;
        const grow = m.settled ? 1 : 0.3 + 0.7 * m.growth;
        let R = (10 + m.m * 16) * grow;
        let evapP = 0;
        if (m.evapAt) {
          evapP = clamp01((now - m.evapAt) / EVAP_MS);
          R *= 1 - evapP * 0.85;
        }
        const depth = wellDepth(pts, mx, my, SOFTENING);
        const shade = ctx.createRadialGradient(mx, my, R * 0.2, mx, my, R * 3.2);
        shade.addColorStop(0, `rgba(0, 0, 0, ${0.5 * (1 - evapP)})`);
        shade.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = shade;
        ctx.fillRect(mx - R * 3.2, my - R * 3.2, R * 6.4, R * 6.4);
        ctx.fillStyle = `rgba(2, 3, 6, ${(0.92 - depth * 0.1) * (1 - evapP)})`;
        ctx.beginPath();
        ctx.arc(mx, my, R, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(150, 175, 225, ${(m.settled ? 0.13 : 0.3) * (1 - evapP)})`;
        ctx.lineWidth = m.settled ? 0.8 : 1.2;
        ctx.beginPath();
        ctx.arc(mx, my, R, 0, Math.PI * 2);
        ctx.stroke();
        if (m.charge > 0 && !m.evapAt) {
          ctx.strokeStyle = `rgba(231, 172, 82, ${0.25 + m.charge * 0.5})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(mx, my, R + 7, -Math.PI / 2, -Math.PI / 2 + m.charge * Math.PI * 2);
          ctx.stroke();
        }
        if (m.evapAt) {
          const flare = Math.sin(evapP * Math.PI);
          const fr = R + evapP * 90;
          const flash = ctx.createRadialGradient(mx, my, 0, mx, my, fr);
          flash.addColorStop(0, `rgba(235, 242, 255, ${0.5 * flare})`);
          flash.addColorStop(0.5, `rgba(180, 200, 245, ${0.18 * flare})`);
          flash.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = flash;
          ctx.fillRect(mx - fr, my - fr, fr * 2, fr * 2);
        }
      }

      // ————— pulses: your ring, at exactly c, first across any line —————
      for (const p of pulses) {
        const rf = (lightT - p.bornLight) * c;
        const prog = clamp01(rf / (Math.max(width, height) * 1.2));
        if (rf < 2) continue;
        ctx.strokeStyle = `rgba(198, 216, 248, ${0.24 * p.strength * (1 - prog)})`;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rf, 0, Math.PI * 2);
        ctx.stroke();
      }

      // ————— lantern wavefronts: bunched blue ahead, stretched red behind —————
      {
        const SEG = 22;
        for (const ring of rings) {
          const rf = (lightT - ring.bornLight) * c;
          if (rf < 3) continue;
          const fade = clamp01(1 - rf / (Math.max(width, height) * 0.85));
          for (let s = 0; s < SEG; s++) {
            const a0 = (s / SEG) * Math.PI * 2;
            const a1 = ((s + 1) / SEG) * Math.PI * 2;
            const am = (a0 + a1) / 2;
            const cosA = Math.cos(am) * ring.dx + Math.sin(am) * ring.dy;
            const shift = dopplerShift(ring.beta * cosA * c, c);
            const t = clamp((shift - 1) * 1.4, -1, 1);
            const rr = t > 0 ? Math.round(mix(240, 130, t)) : Math.round(mix(240, 255, -t));
            const gg = t > 0 ? Math.round(mix(228, 175, t)) : Math.round(mix(228, 130, -t));
            const bb = t > 0 ? Math.round(mix(210, 255, t)) : Math.round(mix(210, 90, -t));
            ctx.strokeStyle = `rgba(${rr}, ${gg}, ${bb}, ${0.22 * fade * (0.5 + 0.5 * Math.abs(t) + 0.3)})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(ring.x, ring.y, rf, a0, a1);
            ctx.stroke();
          }
        }
      }

      // ————— light: few rays racing, bending hard, never slowing —————
      if (!reduce) {
        const stepDt = (dt * rayScale) / 4;
        for (const r of rays) {
          for (let s = 0; s < 4; s++) {
            const st = geodesicStep(pts, r, stepDt, c, rayG, SOFTENING);
            r.x = st.x; r.y = st.y; r.vx = st.vx; r.vy = st.vy;
            if (windX !== 0 || windY !== 0) {
              r.vx += windX * c * 0.5 * stepDt;
              r.vy += windY * c * 0.5 * stepDt;
              const sp = Math.hypot(r.vx, r.vy);
              if (sp > 0) { r.vx *= c / sp; r.vy *= c / sp; }
            }
            for (const cur of currents) {
              const age = (now - cur.born) / 900;
              if (age >= 1) continue;
              const d2 = (r.x - cur.x) * (r.x - cur.x) + (r.y - cur.y) * (r.y - cur.y);
              if (d2 > 170 * 170) continue;
              const k = Math.exp(-d2 / (120 * 120)) * (1 - age) * 2.4 * stepDt;
              r.vx += cur.dx * c * k;
              r.vy += cur.dy * c * k;
              const sp = Math.hypot(r.vx, r.vy);
              if (sp > 0) { r.vx *= c / sp; r.vy *= c / sp; }
            }
            if (orbit) {
              const ox = r.x - orbit.x;
              const oy = r.y - orbit.y;
              const od = Math.hypot(ox, oy);
              if (od > 8 && od < 190) {
                const sgn = orbit.omega >= 0 ? 1 : -1;
                const tx = (-oy / od) * sgn;
                const ty = (ox / od) * sgn;
                const k = Math.min(1, 6 * stepDt * Math.abs(orbit.omega));
                r.vx = mix(r.vx, tx * c, k);
                r.vy = mix(r.vy, ty * c, k);
                const sp = Math.hypot(r.vx, r.vy);
                if (sp > 0) { r.vx *= c / sp; r.vy *= c / sp; }
              }
            }
          }
          // doppler tint: blue falling in, red climbing out
          const a = accelAt(pts, r.x, r.y, rayG, SOFTENING);
          const am = Math.hypot(a.ax, a.ay);
          let w = 0;
          if (am > 1) {
            const proj = (r.vx * a.ax + r.vy * a.ay) / (am * c);
            w = clamp(proj * wellDepth(pts, r.x, r.y, SOFTENING) * 6, -1, 1);
          }
          r.trail.push({ x: r.x, y: r.y, w });
          if (r.trail.length > RAY_TRAIL) r.trail.shift();

          let captured = false;
          for (const p of pts) {
            if (Math.hypot(r.x - p.x, r.y - p.y) < 11) { captured = true; break; }
          }
          const gone = r.x < -60 || r.x > width + 60 || r.y < -60 || r.y > height + 60;
          if (captured || gone) {
            if (captured && now - lastCaptureSoundAt > 2000) {
              lastCaptureSoundAt = now;
              note(28, 180);
            }
            const fresh = spawnRay();
            r.x = fresh.x; r.y = fresh.y; r.vx = fresh.vx; r.vy = fresh.vy;
            r.trail.length = 0;
          }
        }

        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const dimmed = rayScale < 0.5 ? 0.7 : 1;
        for (const r of rays) {
          const n = r.trail.length;
          for (let i = 1; i < n; i++) {
            const p0 = r.trail[i - 1];
            const p1 = r.trail[i];
            const f = i / n;
            const warm = p1.w < 0 ? -p1.w : 0;
            const cool = p1.w > 0 ? p1.w : 0;
            const rr = Math.round(mix(212, 255, warm) - cool * 60);
            const gg = Math.round(mix(226, 190, warm * 0.7) - cool * 30);
            const bb = Math.round(mix(255, 165, warm));
            ctx.strokeStyle = `rgba(${rr}, ${gg}, ${bb}, ${0.36 * f * f * dimmed * (1 - lens * 0.7)})`;
            ctx.lineWidth = 0.8 + f * 0.8;
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.stroke();
          }
          if (n > 0) {
            const h = r.trail[n - 1];
            const glow = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, 7);
            glow.addColorStop(0, `rgba(240, 246, 255, ${0.9 * (1 - lens * 0.7)})`);
            glow.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(h.x, h.y, 7, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      } else {
        // stilled light: the same geodesics as slow dashed traces
        if (staticRaysStale) rebuildStaticRays(pts);
        ctx.strokeStyle = "rgba(220, 232, 255, 0.16)";
        ctx.lineWidth = 0.8;
        ctx.setLineDash([5, 9]);
        ctx.lineDashOffset = -((lightT * 12) % 14);
        for (const path of staticRayPaths) {
          ctx.beginPath();
          for (let i = 0; i < path.length; i++) {
            if (i === 0) ctx.moveTo(path[i].x, path[i].y);
            else ctx.lineTo(path[i].x, path[i].y);
          }
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }

      // ————— comets: matter that lags the light, hotter the harder thrown —————
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const q of comets) {
        const rr = Math.round(160 + 95 * clamp01(q.heat * 1.4));
        const gg = Math.round(190 + 40 * q.heat - 60 * Math.max(0, q.heat - 0.6));
        const bb = Math.round(255 - 160 * q.heat);
        const n = q.trail.length;
        for (let i = 1; i < n; i++) {
          const f = i / n;
          ctx.strokeStyle = `rgba(${rr}, ${gg}, ${bb}, ${(0.1 + q.heat * 0.3) * f * f})`;
          ctx.lineWidth = 1 + f * (1.6 + q.heat * 1.6);
          ctx.beginPath();
          ctx.moveTo(q.trail[i - 1].x, q.trail[i - 1].y);
          ctx.lineTo(q.trail[i].x, q.trail[i].y);
          ctx.stroke();
        }
        const R = 3.5 + q.heat * 5;
        const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, R * 2.4);
        g.addColorStop(0, `rgba(255, 250, 240, ${0.65 + q.heat * 0.35})`);
        g.addColorStop(0.5, `rgba(${rr}, ${gg}, ${bb}, ${0.3 + q.heat * 0.35})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(q.x, q.y, R * 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // ————— the lantern: blue running ahead, red trailing behind —————
      {
        const sp = Math.hypot(lantern.vx, lantern.vy);
        const beta = clamp(sp / c, 0, 0.95);
        const dxn = sp > 1 ? lantern.vx / sp : 0;
        const dyn = sp > 1 ? lantern.vy / sp : 0;
        const body = ctx.createRadialGradient(lantern.x, lantern.y, 0, lantern.x, lantern.y, 26);
        body.addColorStop(0, "rgba(255, 226, 170, 0.9)");
        body.addColorStop(0.4, "rgba(231, 172, 82, 0.35)");
        body.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.arc(lantern.x, lantern.y, 26, 0, Math.PI * 2);
        ctx.fill();
        if (beta > 0.04) {
          const lead = ctx.createRadialGradient(
            lantern.x + dxn * 14, lantern.y + dyn * 14, 0,
            lantern.x + dxn * 14, lantern.y + dyn * 14, 22,
          );
          lead.addColorStop(0, `rgba(150, 190, 255, ${0.5 * beta})`);
          lead.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = lead;
          ctx.beginPath();
          ctx.arc(lantern.x + dxn * 14, lantern.y + dyn * 14, 22, 0, Math.PI * 2);
          ctx.fill();
          const tail = ctx.createRadialGradient(
            lantern.x - dxn * 16, lantern.y - dyn * 16, 0,
            lantern.x - dxn * 16, lantern.y - dyn * 16, 24,
          );
          tail.addColorStop(0, `rgba(255, 120, 70, ${0.45 * beta})`);
          tail.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = tail;
          ctx.beginPath();
          ctx.arc(lantern.x - dxn * 16, lantern.y - dyn * 16, 24, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "rgba(255, 240, 205, 0.95)";
        ctx.beginPath();
        ctx.arc(lantern.x, lantern.y, 3.2, 0, Math.PI * 2);
        ctx.fill();
        if (lantern.held) {
          ctx.strokeStyle = "rgba(255, 226, 170, 0.35)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(lantern.x, lantern.y, 32, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // ————— the light clocks: the centerpiece, big and unmissable —————
      for (const k of [clockA, clockB]) {
        const topY = k.y - clockGap / 2;
        const botY = k.y + clockGap / 2;
        const grav = timeDilation(pts, k.x, k.y, DIL_K, DIL_SOFT);
        const gamma = lorentzGamma(k.vEff, c) / Math.max(0.25, grav);
        const slow = clamp01((gamma - 1) / 1.6); // 0 at rest → 1 well dilated
        // frame: a faint slot the clock lives in
        ctx.strokeStyle = `rgba(190, 208, 240, ${k.held ? 0.22 : 0.1})`;
        ctx.lineWidth = 1;
        ctx.strokeRect(k.x - clockHalfW - 10, topY - 14, (clockHalfW + 10) * 2, clockGap + 28);
        // mirrors: two bars, flashing softly on each strike
        for (const [my, flash] of [[topY, k.flashTop], [botY, k.flashBot]] as const) {
          const f = clamp01(1 - (now - flash) / 220);
          ctx.fillStyle = `rgba(220, 232, 255, ${0.35 + f * 0.5})`;
          ctx.fillRect(k.x - clockHalfW, my - 2.5, clockHalfW * 2, 5);
        }
        // the photon: a world-trail — diagonals appear the moment it moves
        const py = topY + k.phase * clockGap;
        if (!reduce) {
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          const n = k.photonTrail.length;
          for (let i = 1; i < n; i++) {
            const f = i / n;
            ctx.strokeStyle = `rgba(255, ${Math.round(246 - slow * 60)}, ${Math.round(235 - slow * 110)}, ${0.55 * f * f})`;
            ctx.lineWidth = 1 + f * 1.2;
            ctx.beginPath();
            ctx.moveTo(k.photonTrail[i - 1].x, k.photonTrail[i - 1].y);
            ctx.lineTo(k.photonTrail[i].x, k.photonTrail[i].y);
            ctx.stroke();
          }
          const glow = ctx.createRadialGradient(k.x, py, 0, k.x, py, 9);
          glow.addColorStop(0, `rgba(255, ${Math.round(250 - slow * 60)}, ${Math.round(240 - slow * 120)}, 0.95)`);
          glow.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(k.x, py, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } else {
          // stilled: the geometry itself — vertical at rest, a long diagonal
          // in motion; the comparison carries even without the flight
          const vert = Math.sqrt(Math.max(0, c * c - k.vEff * k.vEff));
          const legT = vert > 1 ? clockGap / vert : 0;
          const sp = Math.hypot(k.vx, k.vy);
          const dxLeg = sp > 1 ? (k.vx / sp) * Math.min(sp, CLOCK_V_CAP * c) * legT : 0;
          ctx.strokeStyle = `rgba(255, ${Math.round(246 - slow * 60)}, ${Math.round(235 - slow * 110)}, 0.55)`;
          ctx.lineWidth = 1.2;
          ctx.setLineDash([4, 6]);
          ctx.beginPath();
          ctx.moveTo(k.x - dxLeg / 2, topY);
          ctx.lineTo(k.x, botY);
          ctx.lineTo(k.x + dxLeg / 2, topY);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = "rgba(255, 246, 235, 0.9)";
          ctx.beginPath();
          ctx.arc(k.x, (topY + botY) / 2, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ————— twin beacons: gravity slowing time, watched, no numbers —————
      {
        const bxA = width * (0.5 + 0.34 * Math.sin(localT * 0.045 + 1.3)) + beaconOffX;
        const byA = height * (0.56 + 0.2 * Math.sin(localT * 0.036 + 0.4)) + beaconOffY;
        const bxB = width * (0.5 + 0.4 * Math.sin(localT * 0.03 + 4.1)) + beaconOffX;
        const byB = height * (0.84 + 0.05 * Math.sin(localT * 0.023 + 2.2)) + beaconOffY;
        const spots: Array<[number, number, number]> = [[bxA, byA, 0], [bxB, byB, 1]];
        for (const [bx, by, bi] of spots) {
          const f = timeDilation(pts, bx, by, DIL_K, DIL_SOFT);
          if (!reduce) beaconPhase[bi] += dt * timeScale * Math.PI * 2 * 0.55 * f;
          const blink = reduce
            ? 0.35 + 0.5 * f
            : Math.pow(0.5 + 0.5 * Math.sin(beaconPhase[bi]), 3);
          const warmth = clamp01((1 - f) * 1.9);
          const rr = Math.round(mix(223, 255, warmth));
          const gg = Math.round(mix(233, 158, warmth));
          const bb = Math.round(mix(255, 106, warmth));
          const a = 0.2 + blink * 0.7;
          const g = ctx.createRadialGradient(bx, by, 0, bx, by, 13);
          g.addColorStop(0, `rgba(${rr}, ${gg}, ${bb}, ${a})`);
          g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(bx, by, 13, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = `rgba(${rr}, ${gg}, ${bb}, ${0.5 + blink * 0.5})`;
          ctx.beginPath();
          ctx.arc(bx, by, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ————— the lens: the room re-read as a Minkowski diagram —————
      if (lens > 0.02) {
        ctx.fillStyle = `rgba(4, 6, 11, ${lens * 0.86})`;
        ctx.fillRect(0, 0, width, height);
        const la = lens;
        const topY = height * 0.14;
        const botY = height * 0.92;
        const yOf = (tau: number) => topY + (lightT - tau) * c;
        // the now-line, and thin mono numerals — the room's only notation
        ctx.strokeStyle = `rgba(206, 222, 250, ${0.35 * la})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(0, topY);
        ctx.lineTo(width, topY);
        ctx.stroke();
        ctx.font = "300 10px ui-monospace, 'SF Mono', Menlo, monospace";
        ctx.textAlign = "right";
        for (let kk = 0; ; kk++) {
          const tauBack = kk * 0.25;
          const y = topY + tauBack * c;
          if (y > botY) break;
          ctx.strokeStyle = `rgba(206, 222, 250, ${(kk === 0 ? 0 : 0.1) * la})`;
          if (kk > 0) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
          }
          ctx.fillStyle = `rgba(206, 222, 250, ${0.45 * la})`;
          ctx.fillText(tauBack === 0 ? "0" : `−${tauBack.toFixed(2)}`, width - 8, y - 4);
        }
        // light cones from each pulse: exactly 45°, always
        for (const p of pulses) {
          const y0 = yOf(p.bornLight);
          if (y0 < topY || y0 > botY + width) continue;
          const span = y0 - topY; // px of elapsed light-time = px of reach
          ctx.strokeStyle = `rgba(240, 246, 255, ${0.5 * la * p.strength})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p.x, Math.min(y0, botY));
          ctx.lineTo(p.x - span, topY);
          ctx.moveTo(p.x, Math.min(y0, botY));
          ctx.lineTo(p.x + span, topY);
          ctx.stroke();
          ctx.fillStyle = `rgba(240, 246, 255, ${0.7 * la})`;
          ctx.beginPath();
          ctx.arc(p.x, Math.min(y0, botY), 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
        // worldlines: rest is vertical, motion tilts, light alone touches 45°
        const drawWorldline = (
          hist: Array<{ x: number; tau: number }>,
          color: string,
          lw: number,
        ) => {
          if (hist.length < 2) return;
          ctx.strokeStyle = color;
          ctx.lineWidth = lw;
          ctx.beginPath();
          let started = false;
          for (const h of hist) {
            const y = yOf(h.tau);
            if (y > botY) { started = false; continue; }
            if (!started) { ctx.moveTo(h.x, y); started = true; }
            else ctx.lineTo(h.x, y);
          }
          ctx.stroke();
        };
        drawWorldline(clockA.hist, `rgba(206, 226, 255, ${0.75 * la})`, 1.3);
        drawWorldline(clockB.hist, `rgba(255, 214, 150, ${0.8 * la})`, 1.3);
        drawWorldline(lantern.hist, `rgba(231, 172, 82, ${0.55 * la})`, 1);
        for (const q of comets) {
          drawWorldline(q.hist, `rgba(${Math.round(180 + 75 * q.heat)}, 200, ${Math.round(255 - 140 * q.heat)}, ${0.55 * la})`, 1);
        }
        // tick dots: the moving clock's ticks sit visibly farther apart
        for (const [k, col] of [[clockA, "206, 226, 255"], [clockB, "255, 214, 150"]] as const) {
          for (const t of k.ticks) {
            const y = yOf(t.tau);
            if (y < topY || y > botY) continue;
            ctx.fillStyle = `rgba(${col}, ${0.9 * la})`;
            ctx.beginPath();
            ctx.arc(t.x, y, 2.2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        // now-markers so the hand still finds its instruments under the lens
        for (const [x, col] of [
          [clockA.x, "206, 226, 255"],
          [clockB.x, "255, 214, 150"],
          [lantern.x, "231, 172, 82"],
        ] as const) {
          ctx.fillStyle = `rgba(${col}, ${0.85 * la})`;
          ctx.beginPath();
          ctx.arc(x, topY, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // glimmer — after quiet, a ring where a dwell would land (never text)
      const idleMs = now - lastInteractionAt;
      if (idleMs > 20000) {
        const slot = Math.floor(now / 9000);
        const gx = (0.22 + hash01(slot) * 0.56) * width;
        const gy = (0.5 + hash01(slot + 7) * 0.38) * height;
        const pulse = reduce ? 0.5 : 0.5 + Math.sin(now / 480) * 0.5;
        ctx.strokeStyle = `rgba(231, 172, 82, ${0.08 + pulse * 0.1})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(gx, gy, 14 + pulse * 8, 0, Math.PI * 2);
        ctx.stroke();
      }

      // keyboard cursor
      if (focused && cursorVisible) {
        const cx = cursorNx * width;
        const cy = cursorNy * height;
        ctx.strokeStyle = "rgba(242, 238, 230, 0.7)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(cx, cy, 12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "rgba(231, 172, 82, 0.85)";
        ctx.beginPath();
        ctx.arc(cx, cy, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      detach();
      wrap.removeEventListener("keydown", onKeyDown);
      wrap.removeEventListener("keyup", onKeyUp);
      wrap.removeEventListener("focus", onFocus);
      wrap.removeEventListener("blur", onBlur);
      mq.removeEventListener?.("change", onMq);
      try { getFieldAudio().releaseConcernTone("love"); } catch { /* noop */ }
    };
  }, []);

  return (
    <div className="relativity-page" data-touch-surface="true" data-pretext-ignore="true">
      <div
        ref={wrapRef}
        className="relativity-field"
        role="application"
        tabIndex={0}
        aria-label="relativity — light keeps its own covenant; tap and your ring runs at the one speed, flick matter and watch it lose the race, drag a clock and hear its tick slow, rest a finger and a mass gathers to slow the beacons near it; arrows walk, enter pulses and, held, gathers or collapses; escape lowers the lens"
      >
        <canvas ref={canvasRef} className="relativity-canvas" aria-hidden="true" />
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .relativity-page {
          position: fixed;
          inset: 0;
          min-height: 100svh;
          background: #05070c;
          overflow: hidden;
        }

        .relativity-field {
          position: relative;
          min-height: 100svh;
          isolation: isolate;
          overflow: hidden;
          outline: none;
        }

        .relativity-field:focus-visible {
          outline: 2px solid rgba(231, 172, 82, 0.7);
          outline-offset: -2px;
        }

        body:has(.relativity-page) {
          overflow: hidden;
          background: #05070c;
        }

        body:has(.relativity-page) header:not(.oda-site-header) {
          background: transparent !important;
          border-bottom: 0 !important;
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
        }

        body:has(.relativity-page) .oda-field-watch,
        body:has(.relativity-page) .oda-candle-mark,
        body:has(.relativity-page) .oda-tape-shell,
        body:has(.relativity-page) .oda-sound-toggle {
          display: none !important;
        }

        .relativity-canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
          cursor: crosshair;
          touch-action: none;
          z-index: 0;
        }
      ` }}
      />
    </div>
  );
}
