"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import { useField } from "@/store/field";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { onVessel } from "@/lib/vessel";
import MobileInstrumentPanel from "@/components/MobileInstrumentPanel";
import {
  addNatural as worldAddNatural,
  commitZone as worldCommitZone,
  getNaturalsInZone,
  subscribeNaturals,
  type WorldKind,
  type WorldNatural,
} from "@/lib/world";
import LetGo from "@/components/LetGo";

/**
 * /tide — the lunar gravity-phase instrument.
 *
 * Night over the Atlantic. Candle on the sill. Floating in the sky is the
 * mechanism of the tide itself: the Earth, its exaggerated water ellipse,
 * and the Moon on its orbit. DRAG THE MOON around the Earth and the two
 * tidal bulges (near-side and antipodal) swing with it — so the sea at
 * your shore rises to HIGH when a bulge faces it and falls to LOW between.
 *
 * A second body, the Sun, also pulls. When Sun and Moon ALIGN (syzygy)
 * the bulges reinforce — a SPRING tide, extra high and low. When they sit
 * at right angles the pulls fight — a muted NEAP tide. Move the Sun, or
 * snap it, to feel the difference. The Moon's face lights by its angle to
 * the Sun, so the phase you make is the phase you see.
 *
 * Motion of the Moon -> phase of the tide. Everything else is felt.
 */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const TAU = Math.PI * 2;

// Real-ish ratio: the Sun's tide-raising force is ~46% of the Moon's.
const MOON_AMP = 1.0;
const SUN_AMP = 0.46;
// "Your shore" sits at the top of the Earth (toward the sky). Screen-space
// angle, y-down, so straight up is -PI/2.
const SHORE_PHI = -Math.PI / 2;

// tide height contributed by a body at orbital angle `ang` with strength `s`.
// Two bulges 180deg apart -> the field has period PI in the body's angle.
const bodyTide = (ang: number, s: number) => s * Math.cos(2 * (SHORE_PHI - ang));

function phaseName(illum: number, waxing: boolean): string {
  if (illum < 0.04) return "new moon";
  if (illum > 0.96) return "full moon";
  if (illum < 0.46) return waxing ? "waxing crescent" : "waning crescent";
  if (illum < 0.54) return waxing ? "first quarter" : "last quarter";
  return waxing ? "waxing gibbous" : "waning gibbous";
}

export default function Tide() {
  // keep the page ambient bed: slow lunar water and buoy pulse
  useEffect(() => { getFieldAudio().setAmbientProfile("tide"); }, []);

  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // orbital state — the whole instrument lives in these two angles.
  const moonAngRef = useRef(-Math.PI / 2);   // start near shore -> high tide
  const sunAngRef = useRef(-Math.PI / 2 + 0.5);

  // drag state: which body (if any) the hand has grabbed (set by gestures).
  const grabRef = useRef<"moon" | "sun" | null>(null);
  // live geometry, published each frame for hit-testing.
  const geomRef = useRef({
    earth: { x: 0, y: 0, r: 0 },
    moon: { x: 0, y: 0, r: 0 },
    sun: { x: 0, y: 0, r: 0 },
    orbitR: 0,
    sunOrbitR: 0,
  });

  // candle flame-lean, same feel as the original scene.
  const cursor = useRef({ x: -9999, y: -9999, tx: -9999, ty: -9999, over: false });
  const candleLean = useRef(0);
  const candleSparkRef = useRef(0);

  // event-band trackers so we only fire feedback on true crossings.
  const tideBandRef = useRef<"high" | "mid" | "low">("mid");
  const springBandRef = useRef<"spring" | "mid" | "neap">("mid");
  const lastBeatRef = useRef(-1);
  const lastDragToneRef = useRef(0);
  const lastDragTapeRef = useRef(0);
  const reduceMotionRef = useRef(false);
  const autoRef = useRef(false);

  const recordTape = useField((s) => s.recordTape);
  const recordTapeRef = useRef(recordTape);
  useEffect(() => { recordTapeRef.current = recordTape; }, [recordTape]);

  const [auto, setAuto] = useState(false);
  const [readout, setReadout] = useState("tide held");
  useEffect(() => { autoRef.current = auto; }, [auto]);

  // whether this tideline still keeps anything — gates the quiet clear (§8c)
  const letGoRef = useRef<() => void>(() => {});
  const [keptHere, setKeptHere] = useState(false);

  // DOM ripples for taps on the open sea.
  const [ripples, setRipples] = useState<Array<{ id: number; x: number; y: number; size: number; tone: "gold" | "pale" }>>([]);
  const rippleIdRef = useRef(0);
  const addRipple = useCallback((x: number, y: number, size: number, tone: "gold" | "pale") => {
    if (reduceMotionRef.current) return;
    const id = ++rippleIdRef.current;
    setRipples((rs) => [...rs.slice(-8), { id, x, y, size, tone }]);
    window.setTimeout(() => setRipples((rs) => rs.filter((r) => r.id !== id)), 720);
  }, []);

  // snap the Sun to a fixed elongation from the Moon (spring vs neap shortcut).
  const setSunOffset = useCallback((offset: number, label: string) => {
    sunAngRef.current = moonAngRef.current + offset;
    try { getFieldAudio().playNote(offset === 0 ? 67 : 60, 180); } catch { /* noop */ }
    try { haptics.tap(); } catch { /* noop */ }
    recordTapeRef.current("preset", offset === 0 ? 0.82 : 0.5, `tide/${label}`);
  }, []);

  const toggleAuto = useCallback(() => {
    setAuto((v) => {
      const next = !v;
      autoRef.current = next;
      try {
        if (next) getFieldAudio().chime();
        else getFieldAudio().thud();
      } catch { /* noop */ }
      recordTapeRef.current("sigil", next ? 0.7 : 0.4, next ? "tide/orbit" : "tide/still");
      return next;
    });
  }, []);

  useEffect(() => {
    const cv = canvasRef.current;
    const root = rootRef.current;
    if (!cv || !root) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const audio = getFieldAudio();
    audio.start();

    reduceMotionRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMq = () => { reduceMotionRef.current = mq.matches; };
    mq.addEventListener?.("change", onMq);

    let raf = 0;
    const t0 = performance.now();

    // ── persistent tideline naturals (from the shared world) ────
    // Shells, driftwood, starfish left along the shore live in the shared
    // pool (see src/lib/world.ts). /tide only shows things whose zone is
    // "tide", but a shell can migrate from /ocean over real elapsed time.
    // ny is tide-band space: 0 = high-tide mark, 1 = low-tide mark. A shell
    // placed higher up is only exposed when the moon drags a low enough
    // tide — the simulation IS the gameplay.
    type NaturalKind = Extract<WorldKind, "seashell" | "driftwood" | "starfish">;
    let naturals: WorldNatural[] = getNaturalsInZone("tide");
    const syncKept = () => setKeptHere(naturals.length > 0);
    syncKept();
    const unsubscribeWorld = subscribeNaturals(() => {
      naturals = getNaturalsInZone("tide");
      syncKept();
    });
    const addNatural = (kind: NaturalKind, nx: number, ny: number) => {
      const created = worldAddNatural(
        kind,
        "tide",
        Math.max(0.02, Math.min(0.98, nx)),
        Math.max(0, Math.min(1, ny)),
        0, // /tide naturals stay put — the tide moves, not the shells
      );
      naturals = getNaturalsInZone("tide");
      syncKept();
      return created;
    };
    const persistNaturals = () => {
      worldCommitZone("tide", naturals);
    };
    let lastNaturalsSaveAt = performance.now();

    // the tideline's parting (LetGo, §8c): this zone's keepsakes only — the
    // shells slip below the waterline and the sea takes them back over a
    // couple of breaths; the world is written empty for this zone at once,
    // so nothing washes back up on reload.
    type Departing = WorldNatural & { bny: number; bx: number };
    let departing: Departing[] = [];
    let letGoAt = 0;
    let letGoDur = 1800;
    const letGo = () => {
      if (naturals.length === 0) return;
      departing = naturals.map((n) => ({ ...n, bny: n.ny, bx: n.nx }));
      naturals = [];
      letGoAt = performance.now();
      letGoDur = reduceMotionRef.current ? 420 : 1800;
      worldCommitZone("tide", []);
      try { audio.thud(); } catch { /* noop */ }
      try { audio.playNote(36, 520); } catch { /* noop */ }
      try { haptics.roll(); } catch { /* noop */ }
      recordTapeRef.current("object", 0.3, "tide/letgo");
      setKeptHere(false);
    };
    letGoRef.current = letGo;

    // ── weather events (autonomic) ───────────────────────────────
    // Ephemeral things that happen against the moonlit sea while you
    // watch: meteors, moon halos, fog banks, a distant boat lantern,
    // and a firefly by the candle. The scheduler is jittered so it
    // never feels metronomic. Same pattern as /stars and /ocean.
    type WeatherEvent =
      | { kind: "meteor"; t0: number; duration: number; x0: number; y0: number; x1: number; y1: number }
      | { kind: "moonhalo"; t0: number; duration: number }
      | { kind: "fog"; t0: number; duration: number; dir: 1 | -1; density: number }
      | { kind: "boat"; t0: number; duration: number; dir: 1 | -1; yOffset: number }
      | { kind: "firefly"; t0: number; duration: number; seed: number };
    const weather: WeatherEvent[] = [];
    const addWeather = (e: WeatherEvent) => {
      weather.push(e);
      if (weather.length > 8) weather.shift();
    };

    // ── the room's clock + law-layer state (gesture grammar) ────
    // Three fingers held dilate time; three fingers dragged push the wind;
    // a steady tapped pulse entrains the beat; a circling finger stirs.
    let simNow = performance.now();  // warped ms — weather + stir ages
    let simT = 0;                    // warped seconds — swells, stars, beat
    let lastFrameAt: number | null = null;
    let timeScale = 1;
    let timeScaleTarget = 1;
    let wind = 0;
    let windTarget = 0;
    let windPhase = 0;               // accumulated directional swell drift
    let lastWindFxAt = 0;
    let entrainBpm = 0;
    let entrainUntil = 0;
    let lastScrubAt = 0;
    const stirs: Array<{ x: number; y: number; t0: number; sign: number }> = [];
    let lastGestureAt = performance.now();
    const holdState: { planted: boolean; skipped: boolean; settled: boolean; body: "moon" | "sun" | null } =
      { planted: false, skipped: false, settled: false, body: null };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.floor(window.innerWidth * dpr);
      cv.height = Math.floor(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    // ── pointer handling ────────────────────────────────────────────
    const grab = (clientX: number, clientY: number): "moon" | "sun" | null => {
      const g = geomRef.current;
      const dm = Math.hypot(clientX - g.moon.x, clientY - g.moon.y);
      const ds = Math.hypot(clientX - g.sun.x, clientY - g.sun.y);
      const moonReach = g.moon.r + 34;
      const sunReach = g.sun.r + 34;
      const moonOk = dm <= moonReach;
      const sunOk = ds <= sunReach;
      if (moonOk && sunOk) return dm <= ds ? "moon" : "sun";
      if (moonOk) return "moon";
      if (sunOk) return "sun";
      return null;
    };

    const angleFromEarth = (clientX: number, clientY: number) => {
      const g = geomRef.current;
      return Math.atan2(clientY - g.earth.y, clientX - g.earth.x);
    };

    // ── gestures (the shared grammar — src/lib/gesture) ─────────────
    // One finger touches the mechanism and the sea; two-finger pinch is
    // left to the scale manifold listening on document.body; three
    // fingers touch the law: drag is wind, hold dilates time.
    const drag = { target: null as "moon" | "sun" | null };
    const detachGestures = attachGestures(cv, {
      tap: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers !== 1) return; // the night absorbs frame/law taps
        const body = grab(e.x, e.y);
        if (body) {
          try { audio.playNote(body === "moon" ? 62 : 57, 140); } catch { /* noop */ }
          try { haptics.tap(); } catch { /* noop */ }
          recordTapeRef.current("object", 0.5, `tide/grab-${body}`);
          return;
        }
        const g = geomRef.current;
        if (Math.hypot(e.x - g.earth.x, e.y - g.earth.y) <= g.earth.r * 1.35) {
          toggleAuto();
          addRipple(e.x, e.y, Math.max(70, g.earth.r * 2.4), "gold");
          return;
        }
        // a tap on the open sea — chime and a ring sized by how hard it landed
        try { audio.chime(); } catch { /* noop */ }
        try { haptics.ripple(0.15 + e.intensity * 0.4); } catch { /* noop */ }
        recordTapeRef.current("ripple", 0.24, "tide/sea");
        addRipple(e.x, e.y, 46 + e.intensity * 54, "pale");
      },
      drag: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers === 3) {
          if (e.phase === "end") return;
          // three fingers drag the weather: the swell leans into the wind
          // and a strong push can roll a fog bank the same way
          windTarget = clamp(windTarget + e.vx * 0.2, -1, 1);
          const nowMs = performance.now();
          if (Math.abs(e.vx) > 0.3 && nowMs - lastWindFxAt > 3600) {
            lastWindFxAt = nowMs;
            addWeather({
              kind: "fog",
              t0: simNow,
              duration: 26,
              dir: e.vx >= 0 ? 1 : -1,
              density: 0.4 + Math.min(0.4, Math.abs(e.vx) * 0.3),
            });
            try { audio.playNote(41, 260); } catch { /* noop */ }
            try { haptics.chop(); } catch { /* noop */ }
          }
          return;
        }
        if (e.fingers !== 1) return;
        if (e.phase === "start") {
          drag.target = grab(e.x, e.y);
          grabRef.current = drag.target;
          if (drag.target) {
            try { audio.playNote(drag.target === "moon" ? 62 : 57, 140); } catch { /* noop */ }
            try { haptics.tap(); } catch { /* noop */ }
            recordTapeRef.current("object", 0.5, `tide/grab-${drag.target}`);
          }
          return;
        }
        if (e.phase === "end") {
          drag.target = null;
          grabRef.current = null;
          return;
        }
        if (!drag.target) return;
        const ang = angleFromEarth(e.x, e.y);
        if (drag.target === "moon") moonAngRef.current = ang;
        else sunAngRef.current = ang;
        const now = performance.now();
        if (now - lastDragToneRef.current > 90) {
          lastDragToneRef.current = now;
          const tN = clamp(
            (bodyTide(moonAngRef.current, MOON_AMP) + bodyTide(sunAngRef.current, SUN_AMP)) / (MOON_AMP + SUN_AMP),
            -1, 1,
          );
          try { audio.playNote(52 + Math.round((tN * 0.5 + 0.5) * 20), 90); } catch { /* noop */ }
          try { haptics.ripple(0.18 + Math.abs(tN) * 0.22); } catch { /* noop */ }
        }
        if (now - lastDragTapeRef.current > 560) {
          lastDragTapeRef.current = now;
          recordTapeRef.current("ripple", 0.3, `tide/${drag.target}`);
        }
      },
      hold: (e) => {
        lastGestureAt = performance.now();
        if (e.fingers === 3) {
          // three fingers hold the law: the night slows while held
          if (e.phase === "enter") {
            timeScaleTarget = 0.25;
            try { audio.playNote(36, 260); } catch { /* noop */ }
            try { haptics.tap(); } catch { /* noop */ }
          }
          if (e.phase === "release") timeScaleTarget = 1;
          return;
        }
        if (e.fingers !== 1) return;
        if (e.phase === "enter") {
          holdState.planted = false;
          holdState.skipped = false;
          holdState.settled = false;
          holdState.body = grab(e.x, e.y);
          if (holdState.body) grabRef.current = holdState.body;
          return;
        }
        if (e.phase === "release") {
          if (holdState.body) grabRef.current = null;
          return;
        }
        if (holdState.body) return; // holding a body just keeps hold of it
        // dwell tier — plant a natural on the tideline. Kind depends on the
        // tide: low tide yields shells, high tide floats driftwood.
        if (e.tier >= 2 && !holdState.planted && !holdState.skipped) {
          const w = window.innerWidth;
          const h = window.innerHeight;
          const meanSeaY = h * 0.64;
          const swing = h * 0.085;
          const hiY = meanSeaY - swing;
          const loY = meanSeaY + swing;
          if (e.y < hiY - 20) { holdState.skipped = true; return; } // the sky absorbs it
          const ny = Math.max(0, Math.min(1, (e.y - hiY) / (loY - hiY)));
          const nx = e.x / w;
          const tideN = clamp(
            (bodyTide(moonAngRef.current, MOON_AMP) + bodyTide(sunAngRef.current, SUN_AMP)) / (MOON_AMP + SUN_AMP),
            -1, 1,
          );
          const roll = Math.random();
          const kind: NaturalKind =
            tideN < -0.3 ? (roll < 0.72 ? "seashell" : roll < 0.94 ? "starfish" : "driftwood")
            : tideN > 0.3 ? (roll < 0.72 ? "driftwood" : "seashell")
            : (roll < 0.5 ? "seashell" : roll < 0.85 ? "driftwood" : "starfish");
          addNatural(kind, nx, ny);
          try { audio.chime(); } catch { /* noop */ }
          try { haptics.ripple(0.7); } catch { /* noop */ }
          recordTapeRef.current("ripple", 0.9, "tide/plant");
          addRipple(e.x, e.y, 60, "gold");
          holdState.planted = true;
        }
        // ceremony tier — the placed natural settles into the shore
        if (e.tier >= 3 && holdState.planted && !holdState.settled) {
          holdState.settled = true;
          try { audio.bell(); } catch { /* noop */ }
          try { haptics.bloom(); } catch { /* noop */ }
          addRipple(e.x, e.y, 110, "gold");
          recordTapeRef.current("sigil", 0.9, "tide/settle");
        }
      },
      scrub: (e) => {
        lastGestureAt = performance.now();
        const nowMs = performance.now();
        if (nowMs - lastScrubAt < 700) return;
        lastScrubAt = nowMs;
        const h = window.innerHeight;
        if (e.cy < h * 0.5) return; // stirring is a sea verb; the sky absorbs it
        const sgn = Math.sign(e.winding) || 1;
        stirs.push({ x: e.cx, y: e.cy, t0: simNow, sign: sgn });
        if (stirs.length > 4) stirs.shift();
        // the turning current carries what the tide left nearby
        const w = window.innerWidth;
        for (const n of naturals) {
          const d = Math.abs(n.nx - e.cx / w);
          if (d < 0.15) n.nx = Math.max(0.02, Math.min(0.98, n.nx + sgn * 0.015 * (1 - d / 0.15)));
        }
        addRipple(e.cx, e.cy, 84, "pale");
        try { audio.playNote(58, 150); } catch { /* noop */ }
        try { haptics.ripple(0.35); } catch { /* noop */ }
        recordTapeRef.current("ripple", 0.5, "tide/stir");
      },
      rhythm: (e) => {
        // a steady tapped pulse: the tide's beat falls in with the hand
        if (e.stability <= 0.7) return;
        entrainBpm = Math.max(40, Math.min(96, e.bpm));
        entrainUntil = performance.now() + 10000;
      },
    }, { wheelZoom: false });

    // ── the vessel (lib/vessel): a knock on the case skips a stone ─────
    // Passive subscription — nothing flows until the candle has granted
    // the senses. The stone leaves the same shore point every time and
    // takes three diminishing bounces across the moonlit water: a ring, a
    // falling note and a softer haptic at each touch. Reduced motion keeps
    // the notes and the haptics; the stone and its rings stay still.
    type StoneBounce = { at: number; fx: number; done: boolean };
    let stoneSkip: { t0: number; intensity: number; bounces: StoneBounce[] } | null = null;
    const STONE_LAUNCH_FX = 0.10; // the deterministic edge point, a fraction of width
    const detachVessel = onVessel({
      knock: (e) => {
        const nowMs = performance.now();
        if (stoneSkip && nowMs - stoneSkip.t0 < 1600) return;
        lastGestureAt = nowMs;
        stoneSkip = {
          t0: nowMs,
          intensity: e.intensity,
          // hops shorten and quicken as the skip dies
          bounces: [
            { at: 300, fx: 0.30, done: false },
            { at: 560, fx: 0.46, done: false },
            { at: 760, fx: 0.56, done: false },
          ],
        };
        try { audio.playNote(52, 90); } catch { /* noop */ }
        try { haptics.tap(); } catch { /* noop */ }
        recordTapeRef.current("ripple", 0.4 + e.intensity * 0.4, "tide/skip");
      },
    });

    // Desktop hover — the candle still leans toward a passing hand.
    const onHover = (e: PointerEvent) => {
      cursor.current.tx = e.clientX;
      cursor.current.ty = e.clientY;
      cursor.current.over = true;
    };
    const onLeave = () => { cursor.current.over = false; };
    window.addEventListener("pointermove", onHover);
    window.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);

    // ── audio cadence: the beat tracks the tidal phase ──────────────
    const stepBeat = (tSec: number, tideN: number, band: "high" | "mid" | "low") => {
      // rhythm entrainment: a steady tapped pulse briefly sets the tempo
      const bpm = performance.now() < entrainUntil
        ? entrainBpm
        : 48 + (tideN * 0.5 + 0.5) * 36;
      const beatLen = 60 / bpm;
      const idx = Math.floor(tSec / beatLen);
      const phase = tSec % beatLen;
      if (idx === lastBeatRef.current || phase > 0.06) return;
      lastBeatRef.current = idx;
      // sparse — skip beats in the muddy middle band so highs/lows sing.
      if (band === "mid" && idx % 2 === 0) return;
      const midi = 50 + Math.round((tideN * 0.5 + 0.5) * 15);
      try {
        if (band === "high") audio.playNote(midi + 5, 260);
        else if (band === "low") audio.playNote(midi - 4, 320);
        else audio.playNote(midi, 200);
      } catch { /* noop */ }
    };

    // ── weather scheduler — the sea is never static, never chaotic ─
    // Every 11–19s a jittered scheduler fires one of five natural
    // events against the moonlit sea. Modelled on Stars' cosmic weather
    // block. Slower cadence than /ocean because /tide is a calmer
    // scene meant for contemplation.
    let weatherTimer: ReturnType<typeof setTimeout> | 0 = 0;
    const spawnMeteor = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const startSide = Math.random() < 0.5 ? 1 : -1;
      const x0 = startSide > 0 ? -20 : w + 20;
      const y0 = h * (0.05 + Math.random() * 0.22);
      const dx = (300 + Math.random() * 220) * -startSide;
      const dy = 80 + Math.random() * 60;
      addWeather({
        kind: "meteor",
        t0: simNow,
        duration: 1.4,
        x0, y0,
        x1: x0 + dx,
        y1: y0 + dy,
      });
    };
    const spawnMoonhalo = () => {
      addWeather({ kind: "moonhalo", t0: simNow, duration: 9 });
    };
    const spawnFog = () => {
      addWeather({
        kind: "fog",
        t0: simNow,
        duration: 42,
        dir: Math.random() < 0.5 ? 1 : -1,
        density: 0.55 + Math.random() * 0.3,
      });
    };
    const spawnBoat = () => {
      addWeather({
        kind: "boat",
        t0: simNow,
        duration: 28,
        dir: Math.random() < 0.5 ? 1 : -1,
        yOffset: -8 + Math.random() * 16,
      });
    };
    const spawnFirefly = () => {
      addWeather({
        kind: "firefly",
        t0: simNow,
        duration: 7,
        seed: Math.random() * 1000,
      });
    };
    const fireWeather = () => {
      if (!document.hidden) {
        const roll = Math.random();
        // weighted: boat 26, firefly 22, moonhalo 22, fog 16, meteor 14
        if (roll < 0.26) spawnBoat();
        else if (roll < 0.48) spawnFirefly();
        else if (roll < 0.70) spawnMoonhalo();
        else if (roll < 0.86) spawnFog();
        else spawnMeteor();
      }
      weatherTimer = setTimeout(fireWeather, 11000 + Math.random() * 8000);
    };
    weatherTimer = setTimeout(fireWeather, 4500 + Math.random() * 4500);

    // ── render loop ─────────────────────────────────────────────────
    const draw = (nowMs: number) => {
      const now = nowMs;
      if (lastFrameAt == null) lastFrameAt = nowMs;
      const dtSec = Math.min(0.1, Math.max(0, (nowMs - lastFrameAt) / 1000));
      lastFrameAt = nowMs;
      // three-finger time dilation: the room's clock eases to ~1/4 speed
      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dtSec * 5);
      simT += dtSec * timeScale;
      simNow += dtSec * 1000 * timeScale;
      // wind (three-finger drag) eases in and decays back toward calm;
      // its phase pushes the swell lines directionally.
      wind += (windTarget - wind) * Math.min(1, dtSec * 2.4);
      windTarget *= Math.exp(-dtSec * 0.5);
      windPhase += wind * dtSec * 2.2;
      const t = simT;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const motion = reduceMotionRef.current ? 0 : 1;

      // auto-orbit: the passage of hours moves the Moon on its own.
      if (autoRef.current && !grabRef.current && motion) {
        moonAngRef.current = (moonAngRef.current + 0.0055 * timeScale) % TAU;
      }

      const moonAng = moonAngRef.current;
      const sunAng = sunAngRef.current;

      // tide height at the shore, exaggerated for legibility.
      const rawTide = bodyTide(moonAng, MOON_AMP) + bodyTide(sunAng, SUN_AMP);
      const tideN = clamp(rawTide / (MOON_AMP + SUN_AMP), -1, 1);
      // alignment: +1 at syzygy (new or full) -> spring; -1 at quadrature -> neap.
      const align = Math.cos(2 * (moonAng - sunAng));
      // moon illumination follows elongation from the Sun.
      const elong = ((moonAng - sunAng) % TAU + TAU) % TAU;
      const illum = (1 - Math.cos(elong)) / 2;
      const waxing = Math.sin(elong) > 0;

      // ── sky ──────────────────────────────────────────────────────
      const skyG = ctx.createLinearGradient(0, 0, 0, h * 0.62);
      skyG.addColorStop(0, "rgba(14, 19, 32, 1)");
      skyG.addColorStop(0.5, "rgba(22, 40, 68, 1)");
      skyG.addColorStop(1, "rgba(38, 68, 104, 1)");
      ctx.fillStyle = skyG;
      ctx.fillRect(0, 0, w, h);

      // stars (deterministic constellation, faint twinkle)
      ctx.fillStyle = "rgba(240, 244, 248, 0.6)";
      for (let i = 0; i < 70; i++) {
        const sx = (((Math.sin(i * 12.9898) * 43758.5453) % 1) + 1) % 1;
        const sy = (((Math.sin(i * 78.233) * 43758.5453) % 1) + 1) % 1;
        const tw = 0.6 + 0.4 * Math.sin(t * 1.4 + i * 1.3);
        ctx.globalAlpha = 0.42 * tw;
        ctx.fillRect(sx * w, sy * h * 0.5, 1.2, 1.2);
      }
      ctx.globalAlpha = 1;

      // meteor streaks sit above the sea, behind the mechanism
      drawTideMeteors(ctx, weather, simNow);

      // ── sea: its level rises and falls with the computed tide ─────
      const meanSeaY = h * 0.64;
      const swing = h * 0.085;
      const waterY = meanSeaY - tideN * swing;
      const seaG = ctx.createLinearGradient(0, waterY, 0, h);
      seaG.addColorStop(0, "rgba(34, 62, 96, 1)");
      seaG.addColorStop(0.4, "rgba(18, 38, 66, 1)");
      seaG.addColorStop(1, "rgba(6, 14, 28, 1)");
      ctx.fillStyle = seaG;
      ctx.fillRect(0, waterY, w, h - waterY);

      // moon-glint on the water beneath the Moon's azimuth
      const glintX = clamp(w * 0.5 + Math.cos(moonAng) * w * 0.28, 40, w - 40);
      const glint = ctx.createLinearGradient(glintX, waterY, glintX, h);
      glint.addColorStop(0, `rgba(232, 240, 252, ${0.28 + illum * 0.22})`);
      glint.addColorStop(1, "rgba(232, 240, 252, 0)");
      ctx.fillStyle = glint;
      ctx.fillRect(glintX - 30, waterY, 60, h - waterY);

      // swell lines — cadence quickens toward high tide
      const speed = 0.3 + (tideN * 0.5 + 0.5) * 0.9 + Math.abs(wind) * 0.7;
      const swells = [
        { off: 0.04, amp: 6, freq: 0.011, color: "rgba(160, 200, 230, 0.42)" },
        { off: 0.13, amp: 10, freq: 0.0095, color: "rgba(120, 170, 210, 0.5)" },
        { off: 0.24, amp: 15, freq: 0.008, color: "rgba(80, 130, 180, 0.6)" },
        { off: 0.34, amp: 21, freq: 0.0065, color: "rgba(50, 100, 150, 0.72)" },
      ];
      for (const s of swells) {
        const y0 = waterY + (h - waterY) * s.off;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 4) {
          const ph = x * s.freq + (t * speed + windPhase * 40 * s.freq) * motion;
          const v = Math.sin(ph) + 0.35 * Math.sin(ph * 2.3);
          const yy = y0 + v * s.amp;
          if (x === 0) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
      // waterline highlight
      ctx.strokeStyle = `rgba(220, 235, 255, ${0.2 + Math.abs(tideN) * 0.14})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, waterY);
      ctx.lineTo(w, waterY);
      ctx.stroke();

      // ── tideline naturals (persistent) and boat/fog weather ─────
      // Naturals live between the high-tide and low-tide marks; a
      // shell placed higher up is only exposed when the water pulls
      // back far enough. This is the whole gameplay of /tide made
      // literal: play the moon, expose the beach.
      drawTideNaturals(ctx, naturals, waterY, meanSeaY, swing, w, h, t);
      // the letting go: departing shells slide under the waterline and the
      // driftwood rides out, all fading as the sea takes them back.
      if (departing.length > 0) {
        const u = (performance.now() - letGoAt) / letGoDur;
        if (u >= 1) {
          departing = [];
        } else {
          for (const d of departing) {
            if (d.kind === "driftwood") d.nx = (((d.bx + u * u * 0.14) % 1) + 1) % 1;
            else d.ny = d.bny + u * u * 1.4;
          }
          drawTideNaturals(ctx, departing, waterY, meanSeaY, swing, w, h, t, 1 - u);
        }
      }
      // Boat lantern floats on the horizon at the sea surface.
      drawTideBoat(ctx, weather, simNow, w, h, waterY);
      // Fog roll drifts across the sea over ~40s.
      drawTideFog(ctx, weather, simNow, w, h);

      // stir arcs — a circling finger leaves a briefly visible turning
      // current on the water (the scrub verb, discovered by play).
      for (let i = stirs.length - 1; i >= 0; i--) {
        const st = stirs[i];
        const age = (simNow - st.t0) / 1000;
        if (age > 1.4) { stirs.splice(i, 1); continue; }
        const f = age / 1.4;
        const alpha = (1 - f) * 0.4;
        const rad = 18 + f * 46;
        const a0 = st.sign * t * 3.2;
        ctx.save();
        ctx.strokeStyle = `rgba(190, 220, 245, ${alpha})`;
        ctx.lineWidth = 1.2;
        for (let k = 0; k < 2; k++) {
          ctx.beginPath();
          ctx.ellipse(st.x, st.y, rad * (1 - k * 0.35), rad * 0.34 * (1 - k * 0.35), 0, a0 + k * 2, a0 + k * 2 + Math.PI * 1.2);
          ctx.stroke();
        }
        ctx.restore();
      }

      // ── skipped stone (vessel knock): three diminishing bounces ──
      if (stoneSkip) {
        const skipAge = now - stoneSkip.t0;
        for (let i = 0; i < stoneSkip.bounces.length; i++) {
          const b = stoneSkip.bounces[i];
          if (!b.done && skipAge >= b.at) {
            b.done = true;
            // ring + note + haptic per bounce, each softer than the last
            addRipple(b.fx * w, waterY, 58 - i * 14, "pale");
            try { audio.playNote(64 - i * 3, 90 - i * 18); } catch { /* noop */ }
            try { haptics.ripple(0.36 - i * 0.09); } catch { /* noop */ }
          }
        }
        const lastBounce = stoneSkip.bounces[stoneSkip.bounces.length - 1];
        if (skipAge > lastBounce.at + 600) {
          stoneSkip = null;
        } else if (motion) {
          // the stone in flight: a flat pale fleck arcing hop to hop,
          // settling into the water after the last touch
          const pts = [
            { fx: STONE_LAUNCH_FX, at: 0 },
            ...stoneSkip.bounces.map((b) => ({ fx: b.fx, at: b.at })),
          ];
          let sx = lastBounce.fx * w;
          let sy = waterY;
          let alpha = 0.85;
          if (skipAge <= lastBounce.at) {
            for (let k = 0; k < pts.length - 1; k++) {
              if (skipAge >= pts[k].at && skipAge < pts[k + 1].at) {
                const u = (skipAge - pts[k].at) / (pts[k + 1].at - pts[k].at);
                sx = lerp(pts[k].fx, pts[k + 1].fx, u) * w;
                sy = waterY - Math.sin(u * Math.PI) * [16, 11, 7][k];
                break;
              }
            }
          } else {
            const sink = (skipAge - lastBounce.at) / 600;
            sx = (lastBounce.fx + sink * 0.015) * w;
            sy = waterY + sink * 9;
            alpha = 0.85 * (1 - sink);
          }
          ctx.fillStyle = `rgba(214, 224, 235, ${alpha})`;
          ctx.beginPath();
          ctx.ellipse(sx, sy, 3.2, 2, 0, 0, TAU);
          ctx.fill();
        }
      }

      // ── tide staff: a shore ruler with HIGH / MEAN / LOW + float ──
      const staffX = w < 620 ? 30 : 52;
      const hiY = meanSeaY - swing;
      const loY = meanSeaY + swing;
      ctx.strokeStyle = "rgba(242, 238, 230, 0.28)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(staffX, hiY);
      ctx.lineTo(staffX, loY);
      ctx.stroke();
      const ticks: Array<[number, string]> = [[hiY, "high"], [meanSeaY, "mean"], [loY, "low"]];
      ctx.font = "10px var(--font-mono, monospace)";
      ctx.textBaseline = "middle";
      for (const [ty, label] of ticks) {
        ctx.strokeStyle = "rgba(242, 238, 230, 0.35)";
        ctx.beginPath();
        ctx.moveTo(staffX - 5, ty);
        ctx.lineTo(staffX + 5, ty);
        ctx.stroke();
        ctx.fillStyle = "rgba(242, 238, 230, 0.42)";
        ctx.fillText(label, staffX + 10, ty);
      }
      // float at the current level
      const floatY = meanSeaY - tideN * swing;
      ctx.fillStyle = "rgba(200, 115, 42, 0.95)";
      ctx.beginPath();
      ctx.arc(staffX, floatY, 5.4, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 220, 160, 0.7)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(staffX, floatY, 9, 0, TAU);
      ctx.stroke();

      // ── the mechanism: Earth, water ellipse, orbit, Moon, Sun ─────
      const ex = w * 0.5;
      const ey = h * (w < 620 ? 0.34 : 0.36);
      const earthR = Math.min(w, h) * (w < 620 ? 0.072 : 0.06);
      const orbitR = Math.min(w * 0.32, h * 0.24);
      const sunOrbitR = orbitR * 1.34;

      // orbit rings
      ctx.strokeStyle = "rgba(220, 235, 255, 0.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(ex, ey, orbitR, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255, 220, 160, 0.09)";
      ctx.beginPath();
      ctx.arc(ex, ey, sunOrbitR, 0, TAU);
      ctx.stroke();

      // alignment line — glows near spring (syzygy)
      const springGlow = clamp((align - 0.2) / 0.8, 0, 1);
      if (springGlow > 0.01) {
        ctx.save();
        ctx.strokeStyle = `rgba(255, 224, 168, ${springGlow * 0.5})`;
        ctx.lineWidth = 1 + springGlow * 2;
        ctx.beginPath();
        ctx.moveTo(ex + Math.cos(moonAng) * orbitR, ey + Math.sin(moonAng) * orbitR);
        ctx.lineTo(ex - Math.cos(moonAng) * orbitR, ey - Math.sin(moonAng) * orbitR);
        ctx.stroke();
        ctx.restore();
      }

      // water ellipse — long axis points at the Moon, fatter near spring.
      const bulge = 0.24 + (align * 0.5 + 0.5) * 0.4; // 0.24 (neap) .. 0.64 (spring)
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(moonAng);
      const rx = earthR * (1 + bulge);
      const ry = earthR * (1 - bulge * 0.42);
      const wg = ctx.createRadialGradient(0, 0, earthR * 0.4, 0, 0, rx);
      wg.addColorStop(0, "rgba(90, 150, 200, 0.05)");
      wg.addColorStop(0.7, "rgba(110, 170, 220, 0.28)");
      wg.addColorStop(1, "rgba(150, 200, 240, 0.06)");
      ctx.fillStyle = wg;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = `rgba(180, 216, 245, ${0.3 + springGlow * 0.35})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();

      // Earth body
      const eg = ctx.createRadialGradient(ex - earthR * 0.3, ey - earthR * 0.3, earthR * 0.1, ex, ey, earthR);
      eg.addColorStop(0, "rgba(70, 120, 150, 1)");
      eg.addColorStop(0.6, "rgba(34, 74, 104, 1)");
      eg.addColorStop(1, "rgba(16, 38, 62, 1)");
      ctx.fillStyle = eg;
      ctx.beginPath();
      ctx.arc(ex, ey, earthR, 0, TAU);
      ctx.fill();

      // shore marker on the Earth rim (the point whose tide we read)
      const shoreX = ex + Math.cos(SHORE_PHI) * earthR;
      const shoreY = ey + Math.sin(SHORE_PHI) * earthR;
      const shoreHot = clamp(tideN * 0.5 + 0.5, 0, 1);
      ctx.fillStyle = `rgba(255, ${Math.round(190 + shoreHot * 40)}, ${Math.round(120 + (1 - shoreHot) * 60)}, 0.95)`;
      ctx.beginPath();
      ctx.arc(shoreX, shoreY, 4 + shoreHot * 2, 0, TAU);
      ctx.fill();

      // Sun — draggable warm body on the outer ring
      const sx = ex + Math.cos(sunAng) * sunOrbitR;
      const sy = ey + Math.sin(sunAng) * sunOrbitR;
      const sunR = earthR * 0.62;
      const sunHalo = ctx.createRadialGradient(sx, sy, 0, sx, sy, sunR * 3);
      sunHalo.addColorStop(0, "rgba(255, 214, 130, 0.5)");
      sunHalo.addColorStop(0.4, "rgba(255, 180, 90, 0.18)");
      sunHalo.addColorStop(1, "rgba(255, 180, 90, 0)");
      ctx.fillStyle = sunHalo;
      ctx.beginPath();
      ctx.arc(sx, sy, sunR * 3, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 226, 158, 1)";
      ctx.beginPath();
      ctx.arc(sx, sy, sunR, 0, TAU);
      ctx.fill();

      // Moon — on the inner orbit, lit by its angle to the Sun
      const mx = ex + Math.cos(moonAng) * orbitR;
      const my = ey + Math.sin(moonAng) * orbitR;
      const moonR = earthR * 0.5;
      const grabbedMoon = grabRef.current === "moon";
      // soft grab halo
      ctx.fillStyle = `rgba(226, 236, 250, ${grabbedMoon ? 0.22 : 0.12})`;
      ctx.beginPath();
      ctx.arc(mx, my, moonR * (grabbedMoon ? 2 : 1.6), 0, TAU);
      ctx.fill();
      // dark disc
      ctx.fillStyle = "rgba(40, 54, 78, 1)";
      ctx.beginPath();
      ctx.arc(mx, my, moonR, 0, TAU);
      ctx.fill();
      // lit crescent/gibbous: clip to the disc, draw a lit lens toward the Sun
      ctx.save();
      ctx.beginPath();
      ctx.arc(mx, my, moonR, 0, TAU);
      ctx.clip();
      const lit = ctx.createRadialGradient(
        mx + Math.cos(sunAng) * moonR * 0.9,
        my + Math.sin(sunAng) * moonR * 0.9,
        0,
        mx + Math.cos(sunAng) * moonR * 0.9,
        my + Math.sin(sunAng) * moonR * 0.9,
        moonR * (0.7 + illum * 1.8),
      );
      lit.addColorStop(0, "rgba(244, 246, 250, 0.98)");
      lit.addColorStop(1, "rgba(244, 246, 250, 0)");
      ctx.fillStyle = lit;
      ctx.fillRect(mx - moonR, my - moonR, moonR * 2, moonR * 2);
      ctx.restore();
      ctx.strokeStyle = "rgba(226, 236, 250, 0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(mx, my, moonR, 0, TAU);
      ctx.stroke();

      // Moon halo weather event: soft cool ring around the moon
      drawTideMoonhalo(ctx, weather, simNow, mx, my, moonR);

      // publish geometry for hit-testing
      geomRef.current = {
        earth: { x: ex, y: ey, r: earthR },
        moon: { x: mx, y: my, r: moonR },
        sun: { x: sx, y: sy, r: sunR },
        orbitR,
        sunOrbitR,
      };

      // ── candle on the sill (kept atmosphere + flame-lean) ─────────
      const narrow = w < 700;
      const sillY = h - (narrow ? 26 : 34);
      const candleX = w - (narrow ? 56 : 96);
      const candleH = narrow ? 58 : 74;
      const candleW = narrow ? 17 : 21;
      const candleBaseY = sillY;

      // sill ledge
      ctx.fillStyle = "rgba(80, 56, 36, 0.9)";
      ctx.fillRect(candleX - 44, sillY, 88, 12);

      const cur = cursor.current;
      if (cur.tx > -9000) {
        cur.x = cur.x < -9000 ? cur.tx : cur.x + (cur.tx - cur.x) * 0.2;
        cur.y = cur.y < -9000 ? cur.ty : cur.y + (cur.ty - cur.y) * 0.2;
      }
      const flameAnchorX = candleX;
      const flameAnchorY = candleBaseY - candleH - 18;
      let leanTarget = 0;
      if (cur.over && motion && cur.x > -9000) {
        const dx = cur.x - flameAnchorX;
        const dy = cur.y - flameAnchorY;
        const dd = Math.hypot(dx, dy);
        const pull = Math.max(0, 1 - dd / 300);
        leanTarget = (dx / (dd || 1)) * pull * 6;
      }
      candleLean.current += (leanTarget - candleLean.current) * 0.15;
      const leanX = candleLean.current;

      const sparkAge = candleSparkRef.current ? now - candleSparkRef.current : Infinity;
      const sparkBoost = sparkAge < 350 ? 1 - sparkAge / 350 : 0;
      const flickerR = (40 + Math.sin(t * 3.4) * 6 + Math.sin(t * 7.1) * 3) * (motion || 1) * (1 + sparkBoost * 0.6);
      const halo = ctx.createRadialGradient(candleX, candleBaseY - candleH - 10, 0, candleX, candleBaseY - candleH - 10, flickerR);
      halo.addColorStop(0, `rgba(255, 200, 130, ${0.5 + sparkBoost * 0.4})`);
      halo.addColorStop(0.4, `rgba(200, 115, 42, ${0.28 + sparkBoost * 0.3})`);
      halo.addColorStop(1, "rgba(200, 115, 42, 0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(candleX, candleBaseY - candleH - 10, flickerR, 0, TAU);
      ctx.fill();

      ctx.fillStyle = "rgba(242, 238, 230, 0.95)";
      ctx.fillRect(candleX - candleW / 2, candleBaseY - candleH, candleW, candleH);
      ctx.strokeStyle = "rgba(21,23,26,0.4)";
      ctx.lineWidth = 1;
      ctx.strokeRect(candleX - candleW / 2, candleBaseY - candleH, candleW, candleH);
      ctx.strokeStyle = "rgba(21,23,26,0.85)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(candleX, candleBaseY - candleH - 1);
      ctx.lineTo(candleX, candleBaseY - candleH - 9);
      ctx.stroke();
      const flameJitter = motion ? Math.sin(t * 9) * 1.2 + Math.cos(t * 5.3) * 0.8 : 0;
      ctx.fillStyle = "rgba(255, 200, 130, 0.85)";
      ctx.beginPath();
      ctx.moveTo(candleX, candleBaseY - candleH - 9);
      ctx.quadraticCurveTo(candleX + 5 + flameJitter + leanX, candleBaseY - candleH - 16, candleX + leanX * 0.6, candleBaseY - candleH - 26);
      ctx.quadraticCurveTo(candleX - 5 - flameJitter + leanX, candleBaseY - candleH - 16, candleX, candleBaseY - candleH - 9);
      ctx.fill();
      ctx.fillStyle = "rgba(200, 115, 42, 0.92)";
      ctx.beginPath();
      ctx.moveTo(candleX, candleBaseY - candleH - 9);
      ctx.quadraticCurveTo(candleX + 2.6 + leanX * 0.6, candleBaseY - candleH - 13, candleX + leanX * 0.4, candleBaseY - candleH - 20);
      ctx.quadraticCurveTo(candleX - 2.6 + leanX * 0.6, candleBaseY - candleH - 13, candleX, candleBaseY - candleH - 9);
      ctx.fill();

      // Firefly weather event: a tiny warm speck loops near the candle
      drawTideFirefly(ctx, weather, simNow, candleX, candleBaseY - candleH - 18);

      // glimmer (§6): after ~20s of quiet, a faint ring floats on the sea
      // where a scrub would land — a physical hint, never text.
      if (performance.now() - lastGestureAt > 20000) {
        const slot = Math.floor(now / 9000);
        const gseed = (n: number) => { const v = Math.sin((slot + n) * 127.1) * 43758.5453; return v - Math.floor(v); };
        const gx = (0.2 + gseed(0) * 0.6) * w;
        const gy = waterY + (0.2 + gseed(7) * 0.5) * Math.max(40, h - waterY - 60);
        const pulse = motion ? 0.5 + Math.sin(now / 480) * 0.5 : 0.5;
        ctx.strokeStyle = `rgba(220, 235, 255, ${0.05 + pulse * 0.08})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(gx, gy, 20 + pulse * 9, (20 + pulse * 9) * 0.34, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // periodic naturals save so drift/plant survives a hard reload
      if (naturals.length > 0 && nowMs - lastNaturalsSaveAt > 4000) {
        lastNaturalsSaveAt = nowMs;
        persistNaturals();
      }

      // ── events: tide-band + spring crossings drive haptics/bell ───
      const band: "high" | "mid" | "low" = tideN > 0.55 ? "high" : tideN < -0.55 ? "low" : "mid";
      if (band !== tideBandRef.current) {
        if (band === "high") {
          try { audio.chime(); } catch { /* noop */ }
          try { haptics.ripple(0.6); } catch { /* noop */ }
          recordTapeRef.current("ripple", 0.66, "tide/high");
          addRipple(shoreX, shoreY, 96, "gold");
        } else if (band === "low") {
          try { audio.thud(); } catch { /* noop */ }
          try { haptics.roll(); } catch { /* noop */ }
          recordTapeRef.current("ripple", 0.5, "tide/low");
        }
        tideBandRef.current = band;
      }
      const sBand: "spring" | "mid" | "neap" = align > 0.72 ? "spring" : align < -0.72 ? "neap" : "mid";
      if (sBand !== springBandRef.current) {
        if (sBand === "spring") {
          try { audio.bell(); } catch { /* noop */ }
          try { haptics.tap(); } catch { /* noop */ }
          recordTapeRef.current("sigil", 0.82, "tide/spring");
        } else if (sBand === "neap") {
          try { audio.thud(); } catch { /* noop */ }
          recordTapeRef.current("sigil", 0.4, "tide/neap");
        }
        springBandRef.current = sBand;
      }

      stepBeat(simT, tideN, band);

      // ── readout (throttled) ──────────────────────────────────────
      if (Math.floor(t * 7) !== Math.floor((t - 0.016) * 7)) {
        const pct = Math.round(tideN * 100);
        const phaseWord = sBand === "spring" ? "spring" : sBand === "neap" ? "neap" : "mid";
        const bandWord = band === "high" ? "high" : band === "low" ? "low" : "rising/falling";
        setReadout(`tide ${pct >= 0 ? "+" : ""}${pct}% · ${bandWord} · ${phaseWord} · ${phaseName(illum, waxing)}`);
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      if (weatherTimer) clearTimeout(weatherTimer);
      persistNaturals();
      unsubscribeWorld();
      window.removeEventListener("resize", resize);
      mq.removeEventListener?.("change", onMq);
      detachGestures();
      detachVessel();
      window.removeEventListener("pointermove", onHover);
      window.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
    };
  }, [addRipple, toggleAuto]);

  return (
    <div
      ref={rootRef}
      className="tide-instrument"
      data-touch-surface="true"
      data-pretext-ignore="true"
    >
      <canvas
        ref={canvasRef}
        className="tide-canvas"
        role="img"
        aria-label="A lunar tide instrument. Drag the moon around the earth to swing the tidal bulges; the sea at the shore rises to high tide and falls to low. Move the sun to feel spring and neap tides."
      />

      <div className="tide-title" aria-hidden="true">
        <span>tide / lunar gravity</span>
        <strong>Tide</strong>
      </div>

      <button type="button" className="tide-orbit-primary" aria-pressed={auto} onClick={toggleAuto}>
        {auto ? "pause" : "orbit"}
      </button>

      <span className="tide-play-hint" aria-hidden="true">drag moon &amp; sun · tap earth</span>

      <MobileInstrumentPanel
        className="tide-mobile-panel"
        title="orbit & alignment"
        triggerLabel="tune"
        summary={readout}
      >
        <div className="tide-rail" aria-label="tide controls">
          <button type="button" className="tide-btn tide-orbit-secondary" aria-pressed={auto} onClick={toggleAuto}>
            {auto ? "pause orbit" : "let it orbit"}
          </button>
          <button type="button" className="tide-btn" onClick={() => setSunOffset(0, "spring")}>
            align sun · spring
          </button>
          <button type="button" className="tide-btn" onClick={() => setSunOffset(Math.PI / 2, "neap")}>
            quarter sun · neap
          </button>
        </div>
      </MobileInstrumentPanel>

      <output className="tide-readout" aria-live="polite">{readout}</output>

      <LetGo label="give back to the sea" onLetGo={() => letGoRef.current()} visible={keptHere} />

      <div
        className="tide-inscription-wrap"
        style={{ position: "fixed", left: 0, right: 0, bottom: 62, textAlign: "center", pointerEvents: "none", zIndex: 6 }}
      >
        <span
          className="tide-inscription"
          role="button"
          tabIndex={0}
          aria-label="what burns also keeps watch — chime"
          onClick={(e) => {
            e.stopPropagation();
            try { getFieldAudio().bell(); } catch { /* noop */ }
            try { haptics.roll(); } catch { /* noop */ }
            candleSparkRef.current = performance.now();
            recordTape("candle", 0.55, "inscription");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              try { getFieldAudio().bell(); } catch { /* noop */ }
              try { haptics.roll(); } catch { /* noop */ }
              candleSparkRef.current = performance.now();
              recordTape("candle", 0.55, "inscription");
            }
          }}
        >
          what burns also keeps watch.
        </span>
      </div>

      <div aria-hidden="true" style={{ position: "fixed", inset: 0, pointerEvents: "none" }}>
        {ripples.map((r) => (
          <span
            key={r.id}
            className="tide-ripple"
            style={{
              left: r.x - r.size / 2,
              top: r.y - r.size / 2,
              width: r.size,
              height: r.size,
              borderColor: r.tone === "gold" ? "rgba(200,115,42,0.85)" : "rgba(220,235,255,0.45)",
            }}
          />
        ))}
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .tide-instrument {
          position: fixed;
          inset: 0;
          overflow: hidden;
          min-height: 100svh;
          background: #0c1422;
          color: rgba(242, 238, 230, 0.94);
          isolation: isolate;
          -webkit-user-select: none;
          user-select: none;
          -webkit-tap-highlight-color: transparent;
        }
        .tide-canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: block;
          touch-action: none;
          cursor: grab;
          z-index: 0;
        }
        .tide-canvas:active { cursor: grabbing; }

        .tide-title {
          position: fixed;
          z-index: 2;
          top: 78px;
          left: var(--pad-x, 28px);
          pointer-events: none;
        }
        .tide-title span {
          display: block;
          margin-bottom: 8px;
          color: rgba(242, 238, 230, 0.46);
          font-family: var(--font-mono);
          font-size: 11px;
          line-height: 1;
          text-transform: lowercase;
        }
        .tide-title strong {
          display: block;
          color: rgba(246, 242, 226, 0.96);
          font-family: var(--font-serif);
          font-size: 128px;
          font-weight: 500;
          line-height: 0.86;
        }

        .tide-rail {
          position: fixed;
          z-index: 3;
          top: 92px;
          right: var(--pad-x, 28px);
          display: grid;
          gap: 8px;
          width: min(230px, 40vw);
        }
        .tide-btn {
          min-height: 48px;
          border: 1px solid rgba(200, 150, 90, 0.28);
          border-radius: 8px;
          background: rgba(12, 20, 34, 0.56);
          color: rgba(242, 238, 230, 0.82);
          padding: 8px 12px;
          font-family: var(--font-mono);
          font-size: 11px;
          text-align: left;
          cursor: pointer;
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
        }
        .tide-btn[aria-pressed="true"] {
          border-color: rgba(200, 115, 42, 0.6);
          color: rgba(255, 214, 150, 0.96);
          background: rgba(200, 115, 42, 0.14);
        }

        .tide-orbit-primary,
        .tide-play-hint { display: none; }

        .tide-readout {
          position: fixed;
          z-index: 4;
          left: 50%;
          transform: translateX(-50%);
          bottom: calc(22px + env(safe-area-inset-bottom, 0px));
          max-width: min(560px, calc(100vw - 32px));
          padding: 9px 16px;
          border: 1px solid rgba(242, 238, 230, 0.13);
          border-radius: 999px;
          background: rgba(8, 14, 24, 0.58);
          color: rgba(242, 238, 230, 0.74);
          font-family: var(--font-mono);
          font-size: 11px;
          line-height: 1;
          text-align: center;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          pointer-events: none;
        }

        .tide-inscription {
          display: inline-block;
          padding: 4px 8px;
          font-family: var(--font-serif);
          font-style: italic;
          font-size: 16px;
          color: rgba(242, 238, 230, 0.55);
          cursor: pointer;
          pointer-events: auto;
        }

        .tide-ripple {
          position: absolute;
          border-radius: 999px;
          border: 1.5px solid rgba(220, 235, 255, 0.45);
          animation: tide-ripple 0.72s ease-out forwards;
        }
        @keyframes tide-ripple {
          from { transform: scale(0.2); opacity: 0.8; }
          to { transform: scale(1); opacity: 0; }
        }

        body:has(.tide-instrument) {
          background: #0c1422;
          overflow: hidden;
        }
        body:has(.tide-instrument) header:not(.oda-site-header) { display: none !important; }
        body:has(.tide-instrument) .oda-field-watch,
        body:has(.tide-instrument) .oda-candle-mark,
        body:has(.tide-instrument) .oda-tape-shell,
        body:has(.tide-instrument) .oda-sound-toggle {
          display: none !important;
        }

        @media (prefers-reduced-motion: reduce) {
          .tide-ripple { animation: none; display: none; }
        }

        @media (max-width: 940px) {
          .tide-title { top: 34px; left: 20px; }
          .tide-title strong { font-size: 82px; }
          .tide-rail { top: auto; left: 12px; right: 12px; bottom: calc(74px + env(safe-area-inset-bottom, 0px)); width: auto; grid-template-columns: repeat(3, minmax(0, 1fr)); }
          .tide-btn { text-align: center; font-size: 10px; padding: 8px 6px; }
        }
        @media (max-width: 720px) {
          .tide-readout { display: none; }
          .tide-orbit-primary {
            position: fixed;
            z-index: 5;
            right: 14px;
            bottom: calc(68px + env(safe-area-inset-bottom, 0px));
            min-width: 72px;
            min-height: 42px;
            display: inline-grid;
            place-items: center;
            border: 1px solid rgba(200, 150, 90, 0.42);
            border-radius: 999px;
            padding: 0 14px;
            background: rgba(12, 20, 34, 0.84);
            color: rgba(242, 238, 230, 0.9);
            box-shadow: 0 12px 34px rgba(0, 0, 0, 0.24);
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
            font: 10px/1 var(--font-mono);
            letter-spacing: 0.08em;
            text-transform: lowercase;
            cursor: pointer;
          }
          .tide-orbit-primary[aria-pressed="true"] {
            border-color: rgba(200, 115, 42, 0.7);
            background: rgba(200, 115, 42, 0.18);
            color: rgba(255, 214, 150, 0.96);
          }
          .tide-play-hint {
            position: fixed;
            z-index: 2;
            left: 50%;
            bottom: calc(122px + env(safe-area-inset-bottom, 0px));
            display: block;
            transform: translateX(-50%);
            color: rgba(242, 238, 230, 0.6);
            font: 10px/1 var(--font-mono);
            letter-spacing: 0.06em;
            white-space: nowrap;
            text-shadow: 0 2px 12px rgba(0, 0, 0, 0.82);
            pointer-events: none;
          }
          .tide-mobile-panel .mobile-instrument-panel__trigger {
            max-width: calc(100vw - 112px);
            border-color: rgba(200, 150, 90, 0.38);
            background: rgba(12, 20, 34, 0.86);
          }
          .tide-mobile-panel .mobile-instrument-panel__sheet {
            background: rgba(9, 16, 28, 0.98);
            border-color: rgba(200, 150, 90, 0.24);
          }
          .tide-mobile-panel .tide-rail {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
          }
          .tide-mobile-panel .tide-orbit-secondary { display: none; }
          .tide-mobile-panel .tide-btn {
            min-height: 58px;
            padding: 10px;
            text-align: center;
          }
          .tide-inscription-wrap { bottom: 158px !important; }
        }
        @media (max-width: 520px) {
          .tide-title strong { font-size: 62px; }
          .tide-mobile-panel .tide-rail { grid-template-columns: 1fr; }
        }

        /* this room's own furniture already stands at bottom-center, so the
           quiet clear lifts above the readout and the inscription (§8c). */
        body:has(.tide-instrument) .oda-letgo {
          bottom: calc(100px + env(safe-area-inset-bottom, 0px));
        }
        @media (max-width: 940px) {
          body:has(.tide-instrument) .oda-letgo {
            bottom: calc(136px + env(safe-area-inset-bottom, 0px));
          }
        }
        @media (max-width: 720px) {
          body:has(.tide-instrument) .oda-letgo {
            bottom: max(18px, env(safe-area-inset-bottom, 0px));
          }
        }
      `,
        }}
      />
    </div>
  );
}

// ── tideline naturals ──────────────────────────────────────────────
// A shell/starfish sitting at (nx, ny_tide) is exposed when the water
// line is drawn below it (larger y). When the tide covers it, we still
// render but at reduced alpha with a bluish tint to read as "under
// water" — the shell hasn't moved, just been submerged.
type TideNaturalLite = {
  id: string;
  kind: string;
  nx: number;
  ny: number;
  seed: number;
};
function drawTideNaturals(
  ctx: CanvasRenderingContext2D,
  naturals: TideNaturalLite[],
  waterY: number,
  meanSeaY: number,
  swing: number,
  w: number,
  _h: number,
  t: number,
  fade = 1, // < 1 while the shore gives its keepsakes back to the sea
) {
  if (naturals.length === 0) return;
  const hiY = meanSeaY - swing;
  const loY = meanSeaY + swing;
  const bandH = loY - hiY;
  ctx.save();
  for (const n of naturals) {
    const sx = n.nx * w;
    let sy: number;
    let alpha = 1;
    let tinted = false;
    if (n.kind === "driftwood") {
      // Driftwood floats on the surface; it's always visible AT the waterline.
      sy = waterY - 3 + Math.sin(t * 0.9 + n.seed * 0.001) * 1.2;
    } else {
      // Shells/starfish are anchored to their ny in the tide band.
      sy = hiY + n.ny * bandH;
      const covered = sy > waterY;
      if (covered) {
        // depth below waterline in swing units
        const depth = Math.min(1, (sy - waterY) / swing);
        alpha = 1 - depth * 0.75;
        tinted = true;
      }
    }
    ctx.globalAlpha = alpha * fade;
    switch (n.kind) {
      case "seashell": drawTideSeashell(ctx, sx, sy, 5 + (1 - n.ny) * 3, n.seed, tinted); break;
      case "starfish": drawTideStarfish(ctx, sx, sy, 6 + (1 - n.ny) * 3, n.seed, tinted); break;
      case "driftwood": drawTideDriftwood(ctx, sx, sy, 22 + (1 - n.ny) * 12, n.seed); break;
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawTideSeashell(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number, tinted: boolean) {
  const rot = Math.sin(seed * 0.017) * 0.9;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = tinted ? "rgba(80, 130, 180, 0.55)" : "rgba(246, 218, 190, 0.94)";
  ctx.beginPath();
  ctx.moveTo(-r, 0);
  ctx.quadraticCurveTo(0, -r * 1.5, r, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = tinted ? "rgba(160, 200, 230, 0.6)" : "rgba(190, 132, 90, 0.6)";
  ctx.lineWidth = 0.7;
  for (let i = 1; i < 6; i++) {
    const ang = -Math.PI + (i / 6) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(ang) * r * 0.9, Math.sin(ang) * r * 0.85);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTideStarfish(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number, tinted: boolean) {
  const rot = Math.sin(seed * 0.011) * Math.PI;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const ang = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * 0.42;
    const px = Math.cos(ang) * rad;
    const py = Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = tinted ? "rgba(90, 140, 190, 0.6)" : "rgba(220, 148, 76, 0.94)";
  ctx.fill();
  ctx.strokeStyle = tinted ? "rgba(180, 210, 240, 0.55)" : "rgba(120, 62, 32, 0.55)";
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.restore();
}

function drawTideDriftwood(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, seed: number) {
  const rot = Math.sin(seed * 0.021) * 0.4;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  const g = ctx.createLinearGradient(0, -3, 0, 3);
  g.addColorStop(0, "rgba(214, 196, 168, 0.94)");
  g.addColorStop(1, "rgba(120, 92, 72, 0.9)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, len * 0.5, 2.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(96, 68, 46, 0.55)";
  ctx.lineWidth = 0.5;
  for (let i = 0; i < 3; i++) {
    const gy = -1.2 + i;
    ctx.beginPath();
    ctx.moveTo(-len * 0.42, gy);
    ctx.lineTo(len * 0.42, gy + Math.sin(seed + i) * 0.6);
    ctx.stroke();
  }
  ctx.restore();
}

// ── tide weather event drawing ─────────────────────────────────────
type TideWeatherLite =
  | { kind: "meteor"; t0: number; duration: number; x0: number; y0: number; x1: number; y1: number }
  | { kind: "moonhalo"; t0: number; duration: number }
  | { kind: "fog"; t0: number; duration: number; dir: 1 | -1; density: number }
  | { kind: "boat"; t0: number; duration: number; dir: 1 | -1; yOffset: number }
  | { kind: "firefly"; t0: number; duration: number; seed: number };

function drawTideMeteors(ctx: CanvasRenderingContext2D, events: TideWeatherLite[], now: number) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    const age = (now - e.t0) / 1000;
    if (age >= e.duration) {
      if (e.kind === "meteor") events.splice(i, 1);
      continue;
    }
    if (e.kind !== "meteor") continue;
    const f = age / e.duration;
    const headX = e.x0 + (e.x1 - e.x0) * f;
    const headY = e.y0 + (e.y1 - e.y0) * f;
    const tailF = Math.max(0, f - 0.4);
    const tailX = e.x0 + (e.x1 - e.x0) * tailF;
    const tailY = e.y0 + (e.y1 - e.y0) * tailF;
    const alpha = Math.max(0, 1 - Math.abs(f - 0.5) * 1.4);
    const g = ctx.createLinearGradient(tailX, tailY, headX, headY);
    g.addColorStop(0, "rgba(255, 240, 210, 0)");
    g.addColorStop(1, `rgba(255, 244, 220, ${alpha})`);
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(headX, headY);
    ctx.stroke();
    ctx.fillStyle = `rgba(255, 250, 230, ${alpha})`;
    ctx.beginPath();
    ctx.arc(headX, headY, 1.6, 0, TAU);
    ctx.fill();
  }
}

function drawTideMoonhalo(ctx: CanvasRenderingContext2D, events: TideWeatherLite[], now: number, mx: number, my: number, moonR: number) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    const age = (now - e.t0) / 1000;
    if (age >= e.duration) {
      if (e.kind === "moonhalo") events.splice(i, 1);
      continue;
    }
    if (e.kind !== "moonhalo") continue;
    const f = age / e.duration;
    const env = Math.sin(Math.PI * f);
    const alpha = env * 0.28;
    if (alpha < 0.005) continue;
    const rInner = moonR * 2.4;
    const rOuter = moonR * 3.8;
    const g = ctx.createRadialGradient(mx, my, rInner, mx, my, rOuter);
    g.addColorStop(0, `rgba(220, 232, 252, ${alpha})`);
    g.addColorStop(0.6, `rgba(200, 218, 248, ${alpha * 0.4})`);
    g.addColorStop(1, "rgba(200, 218, 248, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(mx, my, rOuter, 0, TAU);
    ctx.fill();
  }
}

function drawTideFog(ctx: CanvasRenderingContext2D, events: TideWeatherLite[], now: number, w: number, h: number) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    const age = (now - e.t0) / 1000;
    if (age >= e.duration) {
      if (e.kind === "fog") events.splice(i, 1);
      continue;
    }
    if (e.kind !== "fog") continue;
    const f = age / e.duration;
    // fade in over first 20%, hold, fade out over last 20%
    const env = f < 0.2 ? f / 0.2 : f > 0.8 ? 1 - (f - 0.8) / 0.2 : 1;
    const alpha = env * e.density * 0.24;
    if (alpha < 0.005) continue;
    // fog spans a broad band that drifts horizontally across the sea
    const fogY = h * 0.5;
    const fogH = h * 0.4;
    const drift = (f - 0.5) * w * 1.8 * e.dir;
    const g = ctx.createLinearGradient(0, fogY, 0, fogY + fogH);
    g.addColorStop(0, `rgba(220, 230, 236, 0)`);
    g.addColorStop(0.4, `rgba(220, 230, 236, ${alpha})`);
    g.addColorStop(1, `rgba(220, 230, 236, 0)`);
    ctx.save();
    ctx.translate(drift, 0);
    ctx.fillStyle = g;
    ctx.fillRect(-w * 0.5, fogY, w * 2, fogH);
    ctx.restore();
  }
}

function drawTideBoat(ctx: CanvasRenderingContext2D, events: TideWeatherLite[], now: number, w: number, _h: number, waterY: number) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    const age = (now - e.t0) / 1000;
    if (age >= e.duration) {
      if (e.kind === "boat") events.splice(i, 1);
      continue;
    }
    if (e.kind !== "boat") continue;
    const f = age / e.duration;
    const x = e.dir > 0 ? -30 + f * (w + 60) : w + 30 - f * (w + 60);
    const y = waterY + e.yOffset;
    const env = Math.sin(Math.PI * f);
    // warm pinprick lantern with a soft halo
    const halo = ctx.createRadialGradient(x, y, 0, x, y, 18);
    halo.addColorStop(0, `rgba(255, 200, 120, ${0.7 * env})`);
    halo.addColorStop(1, "rgba(255, 200, 120, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, TAU);
    ctx.fill();
    ctx.fillStyle = `rgba(255, 232, 180, ${0.95 * env})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.6, 0, TAU);
    ctx.fill();
  }
}

function drawTideFirefly(ctx: CanvasRenderingContext2D, events: TideWeatherLite[], now: number, cx: number, cy: number) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    const age = (now - e.t0) / 1000;
    if (age >= e.duration) {
      if (e.kind === "firefly") events.splice(i, 1);
      continue;
    }
    if (e.kind !== "firefly") continue;
    const f = age / e.duration;
    const env = Math.sin(Math.PI * f);
    // firefly circles around the candle in a wobbly ellipse
    const ang = e.seed + age * 2.4;
    const rx = 34 + Math.sin(age * 1.7) * 6;
    const ry = 18 + Math.cos(age * 2.1) * 4;
    const x = cx + Math.cos(ang) * rx;
    const y = cy + Math.sin(ang) * ry - 6;
    const flicker = 0.5 + 0.5 * Math.sin(age * 22);
    const alpha = env * (0.6 + flicker * 0.4);
    const halo = ctx.createRadialGradient(x, y, 0, x, y, 9);
    halo.addColorStop(0, `rgba(220, 255, 170, ${0.9 * alpha})`);
    halo.addColorStop(1, "rgba(180, 240, 130, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, TAU);
    ctx.fill();
    ctx.fillStyle = `rgba(255, 255, 220, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.2, 0, TAU);
    ctx.fill();
  }
}
