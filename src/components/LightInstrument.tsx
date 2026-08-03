"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import { getLight808 } from "@/lib/light-808";
import { ripple, roll, tap as hapticTap, chop, lens as hapticLens, bloom as hapticBloom } from "@/lib/haptics";
import {
  SPECTRAL_STOPS,
  audibleFrequency,
  clamp,
  colorFromWavelength,
  formatHz,
  noteName,
  opticalFrequencyThz,
  quantizeFrequency,
  wavelengthFromX,
  type ScaleMode,
} from "@/lib/light-music";
import {
  lightLesson,
  playLesson,
  scaleLattice,
  type LessonGhost,
} from "@/lib/instrument-lesson";
import { useField } from "@/store/field";
import { attachGestures } from "@/lib/gesture";
import { holdTier } from "@/lib/gesture/core";
import { onVessel, requestVessel, vesselAvailable, vesselGranted } from "@/lib/vessel";
import LetGo from "@/components/LetGo";

type ToneMark = {
  id: number;
  x: number;
  y: number;
  wavelength: number;
  audible: number;
  color: string;
};

type ActiveTouch = {
  id: number;
  x: number;
  y: number;
  color: string;
  note: string;
  freq: number;
};

type PointerRecord = {
  downAt: number;
  downX: number;
  downY: number;
  moved: boolean;
  freq: number;
};

const SCALE_LABELS: Record<ScaleMode, string> = {
  penta: "scale: penta",
  chroma: "scale: chroma",
  pure: "scale: pure light",
};

// desktop keys — A minor pentatonic climbing from A2
const KEY_ROW = ["a", "s", "d", "f", "g", "h", "j", "k", "l"];
const KEY_SEMITONES = [0, 3, 5, 7, 10, 12, 15, 17, 19];

type MotionState = "unavailable" | "needs-permission" | "on";

export default function LightInstrument() {
  const plateRef = useRef<HTMLDivElement | null>(null);
  const markId = useRef(0);
  const pointers = useRef(new Map<number, PointerRecord>());
  const lastMoveTick = useRef(0);
  const flipped = useRef(false);
  const scaleModeRef = useRef<ScaleMode>("penta");
  const marksRef = useRef<ToneMark[]>([]);

  // ── frame-layer state (two/three-finger verbs) ──────────────────────
  // pinch magnifies the spectrum (a narrower slice under the whole width),
  // pan2 shifts which slice of the mapping sits under the plate, twist(2)
  // rotates the lens through the scale modes — penta ↔ chroma ↔ pure
  // light, the same mapping at a different level of description.
  const zoomRef = useRef({ cur: 1, target: 1 });
  const panRef = useRef({ cur: 0, target: 0 });
  const lensTwistAccRef = useRef(0);
  // three fingers touch the law: drag is wind (a transient puff of tone),
  // hold is time dilation (the plate's own animations ease to 1/4 speed),
  // twist is the season (a slow hue drift across the whole instrument).
  const timeScaleRef = useRef(1);
  const seasonRef = useRef(0);
  const seasonTwistAccRef = useRef(0);
  const windLastAtRef = useRef(0);
  const nightRef = useRef(false);
  const lastTouchAtRef = useRef(0);

  const [wavelength, setWavelength] = useState(532);
  const [marks, setMarks] = useState<ToneMark[]>([]);
  const [touches, setTouches] = useState<ActiveTouch[]>([]);
  const [ghosts, setGhosts] = useState<LessonGhost[]>([]);
  const [isReplaying, setIsReplaying] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [lessonLabel, setLessonLabel] = useState("");
  const [scaleMode, setScaleMode] = useState<ScaleMode>("penta");
  const [subMode, setSubMode] = useState(false);
  const [motionState, setMotionState] = useState<MotionState>("unavailable");
  const [flash, setFlash] = useState(0);
  const [glimmering, setGlimmering] = useState(false);
  const glimmeringRef = useRef(false);
  useEffect(() => { glimmeringRef.current = glimmering; }, [glimmering]);
  const [charges, setCharges] = useState<Array<{ id: number; x: number; y: number; pct: number; mode: "create" | "delete" }>>([]);
  const cancelLesson = useRef<null | (() => void)>(null);
  const isListeningRef = useRef(false);
  useEffect(() => { isListeningRef.current = isListening; }, [isListening]);
  const subModeRef = useRef(false);
  useEffect(() => { subModeRef.current = subMode; }, [subMode]);

  scaleModeRef.current = scaleMode;
  marksRef.current = marks;

  const color = useMemo(() => colorFromWavelength(wavelength), [wavelength]);
  const optical = useMemo(() => opticalFrequencyThz(wavelength), [wavelength]);
  const audible = useMemo(
    () => quantizeFrequency(audibleFrequency(wavelength), scaleMode),
    [wavelength, scaleMode],
  );
  const currentNote = useMemo(() => noteName(audible), [audible]);
  // Soft frets: the continuum becoming a piano of light under the active scale.
  const lattice = useMemo(() => scaleLattice(scaleMode), [scaleMode]);
  const nearX = touches[0]?.x ?? ghosts[0]?.x ?? null;

  const recordLight = useCallback((meta: string, intensity: number) => {
    useField.getState().recordTape("sigil", intensity, `light/${meta}`);
  }, []);

  // pinch zooms into a narrower slice of the spectrum; pan2 shifts which
  // slice sits under the plate — the map layer over the same material.
  const mapX = useCallback((x: number) => {
    const mapped = 0.5 + (x - 0.5) / zoomRef.current.cur + panRef.current.cur;
    return clamp(mapped, 0, 1);
  }, []);

  // x in 0..1 plate space sweeps the whole hearing range through the whole
  // spectrum; y stays with the finger as brightness.
  const translationAt = useCallback((x: number) => {
    const nm = wavelengthFromX(mapX(x));
    const freq = quantizeFrequency(audibleFrequency(nm), scaleModeRef.current);
    return { nm, freq, color: colorFromWavelength(nm) };
  }, [mapX]);

  const plateXY = useCallback((clientX: number, clientY: number) => {
    const target = plateRef.current;
    if (!target) return { x: 0.5, y: 0.5 };
    const rect = target.getBoundingClientRect();
    return {
      x: clamp((clientX - rect.left) / rect.width, 0, 1),
      y: clamp((clientY - rect.top) / rect.height, 0, 1),
    };
  }, []);

  const keepMark = useCallback((x: number, y: number, nm: number, freq: number, markColor: string) => {
    const id = markId.current++;
    setMarks((current) => [
      ...current.slice(-15),
      { id, x, y, wavelength: nm, audible: freq, color: markColor },
    ]);
  }, []);

  const showTouch = useCallback((id: number, x: number, y: number, freq: number, touchColor: string) => {
    setTouches((current) => {
      const next = current.filter((touch) => touch.id !== id);
      next.push({ id, x, y, color: touchColor, note: noteName(freq), freq });
      return next;
    });
  }, []);

  const hideTouch = useCallback((id: number) => {
    setTouches((current) => current.filter((touch) => touch.id !== id));
  }, []);

  const pulseFlash = useCallback(() => {
    setFlash((value) => value + 1);
  }, []);

  const subKick = useCallback((x: number) => {
    const nm = wavelengthFromX(mapX(x));
    let freq = quantizeFrequency(audibleFrequency(nm), scaleModeRef.current);
    while (freq > 82) freq /= 2;
    while (freq < 32) freq *= 2;
    getLight808().kick(freq);
    pulseFlash();
    try { ripple(1); } catch { /* noop */ }
    recordLight(`kick/${Math.round(freq)}hz`, 0.9);
  }, [mapX, pulseFlash, recordLight]);

  const findNearMark = useCallback((x: number, y: number): ToneMark | null => {
    let best: ToneMark | null = null;
    let bestD = 0.05;
    for (const mark of marksRef.current) {
      const d = Math.hypot(mark.x - x, mark.y - y);
      if (d < bestD) { bestD = d; best = mark; }
    }
    return best;
  }, []);

  const forgetMark = useCallback((id: number) => {
    setMarks((current) => current.filter((mark) => mark.id !== id));
    try { roll(); } catch { /* noop */ }
    try { getFieldAudio().thud(); } catch { /* noop */ }
    recordLight("memory/forget", 0.5);
  }, [recordLight]);

  const tuttiBurst = useCallback(() => {
    const kept = marksRef.current;
    if (kept.length > 0) {
      getLight808().strum(kept.map((mark) => mark.audible), 0.055);
      recordLight(`tutti/${kept.length}`, 0.95);
    } else {
      getLight808().kick(42);
      recordLight("tutti/kick", 0.8);
    }
    pulseFlash();
    try { roll(); } catch { /* noop */ }
  }, [pulseFlash, recordLight]);

  const replayMarks = useCallback(() => {
    const kept = marksRef.current;
    if (kept.length === 0) {
      try { getFieldAudio().refuse(); } catch { /* noop */ }
      recordLight("memory/empty", 0.24);
      return;
    }
    setIsReplaying(true);
    recordLight("memory/replay", 0.88);
    getLight808().strum(kept.map((mark) => mark.audible), 0.26);
    kept.forEach((mark, index) => {
      window.setTimeout(() => {
        setWavelength(mark.wavelength);
      }, index * 260);
    });
    window.setTimeout(() => setIsReplaying(false), kept.length * 260 + 420);
  }, [recordLight]);

  const clearMarks = useCallback(() => {
    setMarks([]);
    recordLight("memory/clear", 0.34);
    try { getFieldAudio().thud(); } catch { /* noop */ }
  }, [recordLight]);

  const stopLesson = useCallback(() => {
    cancelLesson.current?.();
    cancelLesson.current = null;
    getLight808().stopAll();
    pointers.current.clear();
    setTouches([]);
    setGhosts([]);
    setLessonLabel("");
    setIsListening(false);
  }, []);

  const playListen = useCallback(() => {
    void getFieldAudio().start();
    cancelLesson.current?.();
    getLight808().stopAll();
    pointers.current.clear();
    setTouches([]);
    setGhosts([]);
    setIsListening(true);
    setLessonLabel("");
    recordLight("lesson/listen", 0.7);
    try { ripple(0.5); } catch { /* noop */ }

    cancelLesson.current = playLesson(lightLesson(), {
      on: (e) => {
        const touchColor = colorFromWavelength(wavelengthFromX(e.x));
        getLight808().noteOn(`lesson:${e.id}`, e.freq, { brightness: e.brightness ?? 0.58 });
        setWavelength(wavelengthFromX(e.x));
        setGhosts((current) => [
          ...current.filter((ghost) => ghost.id !== e.id),
          { id: e.id, x: e.x, y: e.y, note: e.note, color: touchColor },
        ]);
      },
      off: (e) => {
        getLight808().noteOff(`lesson:${e.id}`);
        setGhosts((current) => current.filter((ghost) => ghost.id !== e.id));
      },
      lens: (e) => {
        scaleModeRef.current = e.mode;
        setScaleMode(e.mode);
      },
      label: (text) => setLessonLabel(text),
      done: () => {
        cancelLesson.current = null;
        setGhosts([]);
        setLessonLabel("");
        setIsListening(false);
      },
    });
  }, [recordLight]);

  const cycleScale = useCallback(() => {
    setScaleMode((mode) => (mode === "penta" ? "chroma" : mode === "chroma" ? "pure" : "penta"));
    try { hapticTap(); } catch { /* noop */ }
  }, []);

  const toggleSubMode = useCallback((next: boolean, source: string) => {
    setSubMode(next);
    getLight808().setSubMode(next);
    pulseFlash();
    try { roll(); } catch { /* noop */ }
    recordLight(`submode/${next ? "on" : "off"}/${source}`, 0.7);
  }, [pulseFlash, recordLight]);

  // ── the gesture surface ──────────────────────────────────────────────
  // Polyphonic (binds `voice`): every finger is an independent 808 note
  // that sounds the instant it lands — a chord is many voices, not an
  // address into the stack (grammar §3). A together-landed pair moving
  // against each other is reclaimed as the frame layer: pinch magnifies
  // the spectrum, twist(2) rotates the lens through the scale modes,
  // pan2 shifts which slice of the mapping sits under the plate.
  //
  // Three-finger law-layer channels (`drag`/`hold`/`twist(3)`) never fire
  // here — gesture/index.ts silences them unconditionally on any surface
  // that binds `voice` (only a landed pair can be reclaimed past voices).
  // Time dilation and wind are reconstructed by hand from the raw voice
  // count instead (three simultaneous, largely-still voices); season
  // (three-finger twist) needs the engine's chord-rotation math to read
  // cleanly and is exempted here — the same trade the grammar names for
  // instrument surfaces (§3's "one sacrifice").
  useEffect(() => {
    const plate = plateRef.current;
    if (!plate) return;
    const chargeState = new Map<number, { sealed: boolean }>();
    let lastTapPos = { x: -1, y: -1 };

    const toXY = (clientX: number, clientY: number) => plateXY(clientX, clientY);

    const detachGestures = attachGestures(
      plate,
      {
        voice: (e) => {
          lastTouchAtRef.current = performance.now();
          const { x, y } = toXY(e.x, e.y);
          if (e.phase === "start") {
            void getFieldAudio().start();
            const { nm, freq, color: touchColor } = translationAt(x);
            pointers.current.set(e.id, { downAt: performance.now(), downX: x, downY: y, moved: false, freq });
            chargeState.set(e.id, { sealed: false });
            getLight808().noteOn(String(e.id), freq, { brightness: 1 - y });
            setWavelength(nm);
            showTouch(e.id, x, y, freq, touchColor);
            keepMark(x, y, nm, freq, touchColor);
            try { ripple(0.4 + (1 - y) * 0.4); } catch { /* noop */ }
            recordLight(`touch/${Math.round(nm)}nm/${Math.round(freq)}hz`, clamp(0.35 + (1 - y) * 0.4, 0.2, 1));
            return;
          }
          const record = pointers.current.get(e.id);
          if (e.phase === "move") {
            if (!record) return;
            if (!record.moved && Math.hypot(x - record.downX, y - record.downY) > 0.02) {
              record.moved = true;
              // three or more simultaneous voices, one of them sliding —
              // the law's wind: a transient puff pushed across the light.
              if (pointers.current.size >= 3) {
                const now = performance.now();
                if (now - windLastAtRef.current > 220) {
                  windLastAtRef.current = now;
                  const { freq } = translationAt(x);
                  getLight808().strum([freq], 0.05);
                  try { chop(); } catch { /* noop */ }
                  recordLight("wind", 0.4);
                }
              }
            }
            const { nm, freq, color: touchColor } = translationAt(x);
            if (Math.abs(freq - record.freq) > 0.01) {
              getLight808().glide(String(e.id), freq, { brightness: 1 - y });
              record.freq = freq;
              const tick = performance.now();
              if (tick - lastMoveTick.current > 90) {
                lastMoveTick.current = tick;
                try { hapticTap(); } catch { /* noop */ }
              }
            }
            setWavelength(nm);
            showTouch(e.id, x, y, freq, touchColor);
            return;
          }
          // end / cancel
          pointers.current.delete(e.id);
          chargeState.delete(e.id);
          if (record) {
            const heldMs = performance.now() - record.downAt;
            getLight808().noteOff(String(e.id), { boom: heldMs < 200 && !record.moved });
            if (record.moved) recordLight("slide", 0.5);
          }
          hideTouch(e.id);
        },
        pinch: (e) => {
          lastTouchAtRef.current = performance.now();
          if (e.phase === "move") {
            zoomRef.current.target = clamp(zoomRef.current.target * e.scale, 1, 3);
          }
        },
        twist: (e) => {
          if (e.fingers === 3) return; // season — see the exemption note above
          lastTouchAtRef.current = performance.now();
          if (e.phase === "start") lensTwistAccRef.current = 0;
          if (e.phase === "move") lensTwistAccRef.current += e.angle;
          if (e.phase === "end" && Math.abs(lensTwistAccRef.current) > Math.PI / 2) {
            cycleScale();
            try { hapticLens(); } catch { /* noop */ }
          }
        },
        pan2: (e) => {
          lastTouchAtRef.current = performance.now();
          if (e.phase !== "move") return;
          panRef.current.target = clamp(panRef.current.target + e.dx * 0.0006, -0.4, 0.4);
        },
        tap: (e) => {
          lastTouchAtRef.current = performance.now();
          if (e.fingers === 2) {
            // step back: leave the lesson, else lower the zoom, else drop
            // out of sub mode.
            if (isListeningRef.current) {
              stopLesson();
            } else if (Math.abs(zoomRef.current.target - 1) > 0.02) {
              zoomRef.current.target = 1;
            } else if (subModeRef.current) {
              toggleSubMode(false, "stepback");
            }
            try { hapticTap(); } catch { /* noop */ }
            return;
          }
          if (e.fingers === 3) {
            // tutti — one synchronized pulse of everything alive.
            tuttiBurst();
            recordLight("tutti", 0.6);
            return;
          }
          if (e.fingers !== 1) return;
          const { x, y } = toXY(e.x, e.y);
          // double tap in the same spot → deep sub kick. Timing comes from
          // the engine's own tap train (280ms); the spatial check is the
          // room's own material read of the same event, not a threshold.
          if (e.count === 2 && Math.hypot(x - lastTapPos.x, y - lastTapPos.y) < 0.07) {
            subKick(x);
          }
          lastTapPos = { x, y };
        },
      },
      { wheelZoom: false },
    );

    // continuous eases (zoom/pan/season/time-dilation) + the create/delete
    // poll: dwell/ceremony never reach `on.hold` on a poly surface, so a
    // stationary voice's elapsed time is read by hand each tick, sharing
    // the one classifier (`holdTier`) instead of inventing a threshold.
    let raf = 0;
    const ease = () => {
      raf = requestAnimationFrame(ease);
      const z = zoomRef.current;
      z.cur += (z.target - z.cur) * 0.12;
      const p = panRef.current;
      p.cur += (p.target - p.cur) * 0.1;
      const dilating = pointers.current.size >= 3;
      timeScaleRef.current += ((dilating ? 3 : 1) - timeScaleRef.current) * 0.06;
      plate.style.setProperty("--light-zoom", z.cur.toFixed(4));
      plate.style.setProperty("--light-pan", p.cur.toFixed(4));
      plate.style.setProperty("--light-season", `${((seasonRef.current / 8) * 360).toFixed(1)}deg`);
      plate.style.setProperty("--light-time-scale", timeScaleRef.current.toFixed(3));
      plate.style.setProperty("--light-night", nightRef.current ? "0.5" : "0");
    };
    raf = requestAnimationFrame(ease);

    const chargeTimer = window.setInterval(() => {
      const now = performance.now();
      const active: Array<{ id: number; x: number; y: number; pct: number; mode: "create" | "delete" }> = [];
      for (const [id, record] of pointers.current) {
        if (record.moved) continue;
        const elapsed = now - record.downAt;
        const tier = holdTier(elapsed);
        if (tier < 2) continue;
        const chg = chargeState.get(id);
        if (!chg) continue;
        const near = findNearMark(record.downX, record.downY);
        const mode: "create" | "delete" = near ? "delete" : "create";
        active.push({ id, x: record.downX, y: record.downY, pct: Math.min(1, (elapsed - 900) / 1600), mode });
        if (!chg.sealed && tier >= 3) {
          chg.sealed = true;
          try { hapticBloom(); } catch { /* noop */ }
          if (mode === "delete" && near) forgetMark(near.id);
          else replayMarks();
        }
      }
      setCharges(active);
      // idle glimmer (grammar §6): a soft breath after ~20s of quiet.
      if (now - lastTouchAtRef.current > 20000) {
        setGlimmering((g) => (g ? g : true));
      } else if (glimmeringRef.current) {
        setGlimmering(false);
      }
    }, 90);

    return () => {
      detachGestures();
      cancelAnimationFrame(raf);
      window.clearInterval(chargeTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── the vessel ───────────────────────────────────────────────────────
  // tilt left/right sweeps the filter, pitch-tilt adds vibrato, and past
  // ~135° (held upside down) toggles the sub layer — a room-specific tilt
  // discovery, distinct from the sitewide flip-face-down/night meaning
  // (bound separately below via onVessel's `flip`, gravity z-based).
  // shake strums the kept marks; classification (windows, thresholds) is
  // the shared one in gesture/core — never re-derived here.
  useEffect(() => {
    setMotionState(vesselAvailable() ? (vesselGranted() ? "on" : "needs-permission") : "unavailable");
    const detach = onVessel({
      tilt: ({ beta, gamma }) => {
        setMotionState("on");
        const isFlipped = Math.abs(beta) > 135;
        if (isFlipped && !flipped.current) {
          flipped.current = true;
          toggleSubMode(!getLight808().getSubMode(), "flip");
        } else if (!isFlipped && Math.abs(beta) < 100) {
          flipped.current = false;
        }
        getLight808().setMacro({
          cutoff: clamp(gamma / 45, -1, 1),
          vibrato: clamp((Math.abs(beta - 50) - 25) / 60, 0, 1),
        });
      },
      shake: () => { tuttiBurst(); },
      knock: () => {
        subKick(0.5);
        recordLight("vessel/knock", 0.7);
      },
      flip: ({ faceDown }) => { nightRef.current = faceDown; },
    });
    return detach;
  }, [subKick, toggleSubMode, tuttiBurst, recordLight]);

  const requestMotion = useCallback(async () => {
    const ok = await requestVessel();
    if (ok) {
      setMotionState("on");
      recordLight("motion/granted", 0.5);
    }
  }, [recordLight]);

  // ── desktop keyboard — pentatonic row with sustain, space = kick ──────
  useEffect(() => {
    const heldKeys = new Set<string>();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(input|textarea|select|button|a)$/i.test(target.tagName)) return;
      const key = event.key.toLowerCase();
      if (key === " ") {
        event.preventDefault();
        getLight808().kick(46);
        pulseFlash();
        return;
      }
      const index = KEY_ROW.indexOf(key);
      if (index === -1 || heldKeys.has(key)) return;
      event.preventDefault();
      heldKeys.add(key);
      const freq = 110 * 2 ** (KEY_SEMITONES[index] / 12);
      getLight808().noteOn(`key:${key}`, freq, { brightness: 0.6 });
      recordLight(`key/${key}/${Math.round(freq)}hz`, 0.42);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!heldKeys.delete(key)) return;
      getLight808().noteOff(`key:${key}`);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      heldKeys.forEach((key) => getLight808().noteOff(`key:${key}`));
    };
  }, [pulseFlash, recordLight]);

  // block iOS pinch-zoom / callouts while the instrument owns the screen
  useEffect(() => {
    const prevent = (event: Event) => event.preventDefault();
    document.addEventListener("gesturestart", prevent);
    return () => {
      document.removeEventListener("gesturestart", prevent);
      cancelLesson.current?.();
      getLight808().stopAll();
    };
  }, []);

  return (
    <div
      className={`light-page${subMode ? " light-sub" : ""}`}
      data-touch-surface="true"
      data-pretext-ignore="true"
      style={{ "--light-color": color } as React.CSSProperties}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        ref={plateRef}
        className={`light-plate${glimmering ? " is-glimmering" : ""}`}
        role="application"
        tabIndex={0}
        aria-label="full-screen light instrument — touch to play sustained 808 tones, slide to glide, use several fingers for chords"
        style={{
          "--light-zoom": 1,
          "--light-pan": 0,
          "--light-season": "0deg",
          "--light-time-scale": 1,
          "--light-night": 0,
        } as React.CSSProperties}
      >
        <div key={flash} className="light-flash" aria-hidden="true" />
        <div className="light-night-veil" aria-hidden="true" />
        {charges.map((charge) => (
          <span
            key={charge.id}
            className={`light-charge light-charge--${charge.mode}`}
            aria-hidden="true"
            style={{
              left: `${charge.x * 100}%`,
              top: `${charge.y * 100}%`,
              width: 24 + charge.pct * 60,
              height: 24 + charge.pct * 60,
              opacity: 0.25 + charge.pct * 0.55,
            }}
          />
        ))}
        <div className="light-lattice" aria-hidden="true">
          {lattice.map((fret) => {
            const near = nearX != null && Math.abs(nearX - fret.x) < 0.03;
            return (
              <i
                key={fret.midi}
                className={near ? "is-near" : undefined}
                style={{ left: `${fret.x * 100}%` }}
                data-note={fret.note}
              />
            );
          })}
        </div>
        <div className="light-beam" />
        <div className="light-prism">
          <span />
          <span />
          <span />
        </div>
        {marks.map((mark) => (
          <span
            key={mark.id}
            className="light-mark"
            style={{
              left: `${mark.x * 100}%`,
              top: `${mark.y * 100}%`,
              borderColor: mark.color,
              boxShadow: `0 0 30px ${mark.color}`,
            }}
          />
        ))}
        {ghosts.map((ghost) => (
          <span
            key={`g-${ghost.id}`}
            className="light-finger is-ghost"
            style={{
              left: `${ghost.x * 100}%`,
              top: `${ghost.y * 100}%`,
              borderColor: ghost.color ?? "rgba(255,255,255,0.7)",
              boxShadow: `0 0 36px ${ghost.color ?? "rgba(255,255,255,0.45)"}`,
            }}
          >
            <strong>{ghost.note}</strong>
            <em>listen</em>
          </span>
        ))}
        {touches.map((touch) => (
          <span
            key={touch.id}
            className="light-finger"
            style={{
              left: `${touch.x * 100}%`,
              top: `${touch.y * 100}%`,
              borderColor: touch.color,
              boxShadow: `0 0 44px ${touch.color}, inset 0 0 24px ${touch.color}`,
            }}
          >
            <strong>{touch.note}</strong>
            <em>{formatHz(touch.freq)}</em>
          </span>
        ))}
        <div className="light-current" aria-hidden="true">
          <span>{Math.round(wavelength)} nm</span>
          <strong>{currentNote}</strong>
          <em>{lessonLabel || formatHz(audible)}</em>
        </div>
      </div>

      <header className="light-hud light-hud-top">
        <Link href="/" className="light-home">objetd&rsquo;art</Link>
        <p className="light-eyebrow">light / 808 translator</p>
        <div className="light-readout" aria-label="current light and sound translation">
          <span>{Math.round(wavelength)} nm</span>
          <span className="light-readout-wide">{optical.toFixed(1)} THz</span>
          <span className="light-readout-wide">all of hearing across all of sight</span>
          <span>{formatHz(audible)} / {currentNote}</span>
        </div>
      </header>

      <footer className="light-hud light-hud-bottom">
        <div className="light-spectrum" aria-hidden="true">
          {SPECTRAL_STOPS.map((stop) => (
            <i key={stop.name} style={{ background: stop.color }} />
          ))}
        </div>
        <div className="light-actions" aria-label="light instrument controls">
          <button
            type="button"
            className={isListening ? "light-on" : undefined}
            onClick={isListening ? stopLesson : playListen}
          >
            {isListening ? "listening" : "listen"}
          </button>
          <button type="button" onClick={replayMarks} disabled={isReplaying || isListening}>
            {isReplaying ? "replaying" : "replay"}
          </button>
          <button type="button" onClick={cycleScale}>{SCALE_LABELS[scaleMode]}</button>
          <button
            type="button"
            className={subMode ? "light-on" : undefined}
            onClick={() => toggleSubMode(!subMode, "button")}
          >
            {subMode ? "sub: on" : "sub: off"}
          </button>
          {motionState === "needs-permission" && (
            <button type="button" onClick={requestMotion}>enable motion</button>
          )}
          <output>{marks.length} kept</output>
        </div>
        <p className="light-hint">
          {lessonLabel
            ? lessonLabel
            : "the frets bloom where the scale lives · listen, then join with your hands"}
        </p>
      </footer>

      <LetGo label="let the light go" onLetGo={clearMarks} visible={marks.length > 0} />

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .light-page {
          position: fixed;
          inset: 0;
          z-index: 60;
          background: #070908;
          color: rgba(245, 240, 230, 0.94);
          overflow: hidden;
          overscroll-behavior: none;
          user-select: none;
          -webkit-user-select: none;
          -webkit-touch-callout: none;
        }
        body:has(.light-page) {
          overflow: hidden;
        }
        body:has(.light-page) .oda-site-header,
        body:has(.light-page) .oda-field-watch,
        body:has(.light-page) .oda-candle-mark,
        body:has(.light-page) .oda-tape-shell,
        body:has(.light-page) .oda-sound-toggle {
          display: none !important;
        }
        .light-plate {
          position: absolute;
          inset: 0;
          overflow: hidden;
          cursor: crosshair;
          touch-action: none;
          background:
            linear-gradient(180deg, rgba(255,255,255,0.10), transparent 16%, rgba(0,0,0,0.42) 100%),
            linear-gradient(90deg, #8e2318 0%, #d83a2e 10.2%, #f08a28 30.4%, #f5d65b 39.1%, #4fca75 51.1%, #45b8e8 64.1%, #5574f7 75.1%, #9a63ee 90.6%, #7a43d8 100%);
          background-size: 100% 100%, calc(100% * var(--light-zoom, 1)) 100%;
          background-position: 0 0, calc(50% - var(--light-pan, 0) * 100%) 0;
          box-shadow: inset 0 0 140px rgba(0,0,0,0.55);
          isolation: isolate;
          transition: filter 500ms ease;
          filter: hue-rotate(var(--light-season, 0deg));
        }
        .light-sub .light-plate {
          filter: hue-rotate(var(--light-season, 0deg)) brightness(0.62) saturate(1.35);
        }
        .light-night-veil {
          position: absolute;
          inset: 0;
          background: #020302;
          opacity: var(--light-night, 0);
          transition: opacity 900ms ease;
          pointer-events: none;
          z-index: 1;
        }
        .light-charge {
          position: absolute;
          margin-left: -30px;
          margin-top: -30px;
          border-radius: 50%;
          border: 1.5px solid rgba(255, 230, 190, 0.9);
          pointer-events: none;
          z-index: 6;
        }
        .light-charge--delete {
          border-color: rgba(255, 120, 100, 0.9);
        }
        @keyframes lightGlimmerBeam {
          0%, 100% { opacity: 1; }
          50% { opacity: 1.6; filter: brightness(1.5); }
        }
        .light-plate.is-glimmering .light-beam {
          animation: lightGlimmerBeam 1.6s ease;
        }
        @media (prefers-reduced-motion: reduce) {
          .light-plate.is-glimmering .light-beam { animation: none; }
        }
        .light-plate:before {
          content: "";
          position: absolute;
          inset: 0;
          background:
            repeating-linear-gradient(90deg, rgba(255,255,255,0.20) 0 1px, transparent 1px 8.4%),
            repeating-linear-gradient(0deg, rgba(255,255,255,0.10) 0 1px, transparent 1px 14.28%),
            linear-gradient(180deg, rgba(5,7,8,0.10), rgba(5,7,8,0.72));
          mix-blend-mode: overlay;
          pointer-events: none;
        }
        .light-plate:after {
          content: "";
          position: absolute;
          inset: 0;
          background: radial-gradient(circle at 50% 46%, transparent 0 24%, rgba(2,3,3,0.30) 56%, rgba(2,3,3,0.68) 100%);
          pointer-events: none;
          z-index: 1;
        }
        .light-lattice {
          position: absolute;
          inset: 0;
          z-index: 2;
          pointer-events: none;
        }
        .light-lattice i {
          position: absolute;
          top: 8%;
          bottom: 18%;
          width: 1px;
          background: linear-gradient(
            180deg,
            transparent,
            rgba(255,255,255,0.18) 18%,
            rgba(255,255,255,0.34) 50%,
            rgba(255,255,255,0.18) 82%,
            transparent
          );
          transform: translateX(-50%);
          opacity: 0.45;
          transition: opacity 160ms ease, box-shadow 160ms ease, width 160ms ease;
        }
        .light-lattice i.is-near {
          width: 2px;
          opacity: 0.95;
          box-shadow: 0 0 18px rgba(255,255,255,0.55), 0 0 40px var(--light-color);
          background: linear-gradient(
            180deg,
            transparent,
            rgba(255,255,255,0.55) 18%,
            var(--light-color) 50%,
            rgba(255,255,255,0.55) 82%,
            transparent
          );
        }
        .light-flash {
          position: absolute;
          inset: 0;
          background: radial-gradient(circle at 50% 55%, rgba(255,255,255,0.5), transparent 62%);
          opacity: 0;
          pointer-events: none;
          z-index: 7;
          animation: lightFlash calc(520ms * var(--light-time-scale, 1)) ease-out;
        }
        @keyframes lightFlash {
          0% { opacity: 0.85; }
          100% { opacity: 0; }
        }
        .light-beam {
          position: absolute;
          left: -10%;
          top: 45%;
          width: 120%;
          height: 9px;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.94), var(--light-color), transparent);
          filter: blur(0.5px);
          box-shadow: 0 0 42px var(--light-color), 0 0 120px rgba(255,255,255,0.34);
          transform: rotate(-8deg);
          z-index: 2;
          pointer-events: none;
        }
        .light-prism {
          position: absolute;
          left: 50%;
          top: 46%;
          width: clamp(150px, 23vw, 260px);
          aspect-ratio: 1;
          transform: translate(-50%, -50%) rotate(45deg);
          border: 1px solid rgba(255,255,255,0.4);
          background:
            linear-gradient(135deg, rgba(255,255,255,0.20), rgba(255,255,255,0.04) 48%, rgba(0,0,0,0.18)),
            rgba(255,255,255,0.05);
          backdrop-filter: blur(2px);
          z-index: 3;
          pointer-events: none;
        }
        .light-prism span {
          position: absolute;
          inset: 18%;
          border: 1px solid rgba(255,255,255,0.18);
        }
        .light-prism span:nth-child(2) { inset: 33%; }
        .light-prism span:nth-child(3) { inset: 48%; }
        .light-mark {
          position: absolute;
          width: clamp(44px, 8vw, 86px);
          aspect-ratio: 1;
          border: 1px solid currentColor;
          border-radius: 50%;
          transform: translate(-50%, -50%);
          mix-blend-mode: screen;
          opacity: 0.82;
          z-index: 5;
          pointer-events: none;
          animation: lightPulse calc(1600ms * var(--light-time-scale, 1)) ease-out forwards;
        }
        .light-mark:before,
        .light-mark:after {
          content: "";
          position: absolute;
          inset: 50% auto auto 50%;
          width: 150%;
          height: 1px;
          background: currentColor;
          transform: translate(-50%, -50%);
          opacity: 0.7;
        }
        .light-mark:after {
          transform: translate(-50%, -50%) rotate(90deg);
        }
        @keyframes lightPulse {
          0% { opacity: 0.96; scale: 0.24; }
          70% { opacity: 0.62; }
          100% { opacity: 0; scale: 1.9; }
        }
        .light-finger {
          position: absolute;
          width: clamp(84px, 17vw, 130px);
          aspect-ratio: 1;
          border: 1.5px solid currentColor;
          border-radius: 50%;
          transform: translate(-50%, -50%);
          display: grid;
          place-items: center;
          align-content: center;
          gap: 2px;
          background: rgba(5,7,8,0.28);
          backdrop-filter: blur(3px);
          mix-blend-mode: screen;
          z-index: 6;
          pointer-events: none;
        }
        .light-finger.is-ghost {
          border-style: dashed;
          opacity: 0.78;
          animation: lightGhost calc(900ms * var(--light-time-scale, 1)) ease-in-out infinite;
        }
        @keyframes lightGhost {
          0%, 100% { transform: translate(-50%, -50%) scale(0.96); opacity: 0.62; }
          50% { transform: translate(-50%, -50%) scale(1.04); opacity: 0.92; }
        }
        @media (prefers-reduced-motion: reduce) {
          .light-finger.is-ghost {
            animation: none;
          }
        }
        .light-finger strong {
          color: white;
          font-family: var(--font-serif);
          font-size: clamp(26px, 5.4vw, 38px);
          font-weight: 300;
          line-height: 0.9;
        }
        .light-finger em {
          color: rgba(245,240,230,0.78);
          font-family: var(--font-numerals);
          font-size: 11px;
          font-style: normal;
        }
        .light-current {
          position: absolute;
          left: 50%;
          top: 46%;
          width: min(210px, 48vw);
          aspect-ratio: 1;
          transform: translate(-50%, -50%);
          border: 1px solid rgba(255,255,255,0.22);
          border-radius: 50%;
          display: grid;
          place-items: center;
          align-content: center;
          gap: 5px;
          background: rgba(5,7,8,0.32);
          backdrop-filter: blur(6px);
          text-align: center;
          z-index: 4;
          pointer-events: none;
        }
        .light-current span,
        .light-current em {
          color: rgba(245, 240, 230, 0.72);
          font-family: var(--font-numerals);
          font-size: 12px;
          font-style: normal;
        }
        .light-current strong {
          color: white;
          font-family: var(--font-serif);
          font-size: clamp(52px, 9vw, 88px);
          line-height: 0.85;
          font-weight: 300;
          text-shadow: 0 0 34px var(--light-color);
        }
        .light-hud {
          position: absolute;
          left: 0;
          right: 0;
          z-index: 8;
          pointer-events: none;
          padding: 0 clamp(12px, 3vw, 26px);
        }
        .light-hud-top {
          top: calc(10px + env(safe-area-inset-top, 0px));
          display: flex;
          align-items: center;
          gap: 14px;
          flex-wrap: wrap;
        }
        .light-home {
          pointer-events: auto;
          color: rgba(245,240,230,0.92);
          font-family: var(--font-serif);
          font-size: 19px;
          text-decoration: none;
          text-shadow: 0 1px 12px rgba(0,0,0,0.6);
        }
        .light-eyebrow {
          margin: 0;
          color: rgba(245, 240, 230, 0.62);
          font-family: var(--font-text);
          font-size: 11px;
          text-transform: lowercase;
          text-shadow: 0 1px 10px rgba(0,0,0,0.6);
        }
        .light-readout {
          margin-left: auto;
          display: flex;
          gap: 1px;
          border: 1px solid rgba(245, 240, 230, 0.16);
          background: rgba(245, 240, 230, 0.14);
        }
        .light-readout span {
          padding: 7px 10px;
          background: rgba(8, 10, 9, 0.66);
          backdrop-filter: blur(6px);
          color: rgba(245, 240, 230, 0.92);
          font-family: var(--font-numerals);
          font-size: 12px;
          white-space: nowrap;
        }
        .light-hud-bottom {
          bottom: calc(10px + env(safe-area-inset-bottom, 0px));
          display: grid;
          gap: 8px;
        }
        .light-spectrum {
          height: 10px;
          display: grid;
          grid-template-columns: repeat(9, minmax(0, 1fr));
          border: 1px solid rgba(255,255,255,0.28);
          opacity: 0.9;
        }
        .light-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 1px;
          border: 1px solid rgba(245, 240, 230, 0.16);
          background: rgba(245, 240, 230, 0.14);
          pointer-events: auto;
          width: fit-content;
          max-width: 100%;
        }
        .light-actions button,
        .light-actions output {
          min-height: 42px;
          padding: 0 14px;
          border: 0;
          background: rgba(8,10,9,0.7);
          backdrop-filter: blur(6px);
          color: rgba(245, 240, 230, 0.88);
          font-family: var(--font-text);
          font-size: 12px;
          line-height: 1;
          text-transform: lowercase;
          cursor: pointer;
        }
        .light-actions button.light-on {
          color: #f5d65b;
          box-shadow: inset 0 0 18px rgba(245, 214, 91, 0.22);
        }
        .light-actions button:disabled {
          cursor: default;
          opacity: 0.44;
        }
        .light-actions output {
          display: grid;
          place-items: center;
          color: rgba(245, 240, 230, 0.6);
          font-size: 11px;
        }
        .light-hint {
          margin: 0;
          max-width: 640px;
          color: rgba(245, 240, 230, 0.55);
          font-family: var(--font-text);
          font-size: 11px;
          line-height: 1.5;
          text-transform: lowercase;
          text-shadow: 0 1px 10px rgba(0,0,0,0.7);
        }
        @media (max-width: 700px) {
          .light-readout {
            margin-left: 0;
            width: 100%;
          }
          .light-readout span {
            flex: 1;
            text-align: center;
          }
          .light-readout-wide {
            display: none;
          }
          .light-current {
            top: 40%;
          }
          .light-prism {
            top: 40%;
          }
          .light-hint {
            font-size: 10px;
          }
        }
      `,
        }}
      />
    </div>
  );
}
