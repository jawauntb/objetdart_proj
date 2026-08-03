"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import { getLight808 } from "@/lib/light-808";
import { ripple, roll, tap as hapticTap } from "@/lib/haptics";
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

type PermissionRequester = { requestPermission?: () => Promise<string> };

export default function LightInstrument() {
  const plateRef = useRef<HTMLDivElement | null>(null);
  const markId = useRef(0);
  const pointers = useRef(new Map<number, PointerRecord>());
  const lastDown = useRef({ time: 0, x: -1, y: -1 });
  const lastMoveTick = useRef(0);
  const lastShakeAt = useRef(0);
  const lastJerkAt = useRef(0);
  const lastAccel = useRef<{ x: number; y: number; z: number } | null>(null);
  const flipped = useRef(false);
  const scaleModeRef = useRef<ScaleMode>("penta");
  const marksRef = useRef<ToneMark[]>([]);

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
  const cancelLesson = useRef<null | (() => void)>(null);

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

  // x in 0..1 plate space sweeps the whole hearing range through the whole
  // spectrum; y stays with the finger as brightness.
  const translationAt = useCallback((x: number) => {
    const nm = wavelengthFromX(x);
    const freq = quantizeFrequency(audibleFrequency(nm), scaleModeRef.current);
    return { nm, freq, color: colorFromWavelength(nm) };
  }, []);

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
    const nm = wavelengthFromX(x);
    let freq = quantizeFrequency(audibleFrequency(nm), scaleModeRef.current);
    while (freq > 82) freq /= 2;
    while (freq < 32) freq *= 2;
    getLight808().kick(freq);
    pulseFlash();
    try { ripple(1); } catch { /* noop */ }
    recordLight(`kick/${Math.round(freq)}hz`, 0.9);
  }, [pulseFlash, recordLight]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const engine = getLight808();
    void getFieldAudio().start();
    const { x, y } = plateXY(event.clientX, event.clientY);
    const { nm, freq, color: touchColor } = translationAt(x);
    const now = performance.now();

    // double tap in the same spot → deep sub kick
    const previous = lastDown.current;
    const isDoubleTap =
      now - previous.time < 320 &&
      Math.hypot(x - previous.x, y - previous.y) < 0.07;
    lastDown.current = { time: now, x, y };

    pointers.current.set(event.pointerId, { downAt: now, downX: x, downY: y, moved: false, freq });
    engine.noteOn(String(event.pointerId), freq, { brightness: 1 - y });
    setWavelength(nm);
    showTouch(event.pointerId, x, y, freq, touchColor);
    keepMark(x, y, nm, freq, touchColor);
    try { ripple(0.4 + (1 - y) * 0.4); } catch { /* noop */ }
    recordLight(`touch/${Math.round(nm)}nm/${Math.round(freq)}hz`, clamp(0.35 + (1 - y) * 0.4, 0.2, 1));

    if (isDoubleTap) subKick(x);

    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* noop */ }
  }, [keepMark, plateXY, recordLight, showTouch, subKick, translationAt]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const record = pointers.current.get(event.pointerId);
    if (!record) return;
    const { x, y } = plateXY(event.clientX, event.clientY);
    if (!record.moved && Math.hypot(x - record.downX, y - record.downY) > 0.02) {
      record.moved = true;
    }
    const { nm, freq, color: touchColor } = translationAt(x);
    if (Math.abs(freq - record.freq) > 0.01) {
      getLight808().glide(String(event.pointerId), freq, { brightness: 1 - y });
      record.freq = freq;
      const tick = performance.now();
      if (tick - lastMoveTick.current > 90) {
        lastMoveTick.current = tick;
        try { hapticTap(); } catch { /* noop */ }
      }
    }
    setWavelength(nm);
    showTouch(event.pointerId, x, y, freq, touchColor);
  }, [plateXY, showTouch, translationAt]);

  const handlePointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const record = pointers.current.get(event.pointerId);
    pointers.current.delete(event.pointerId);
    if (record) {
      const heldMs = performance.now() - record.downAt;
      // quick unmoved taps release as a long 808 boom; held notes release tight
      getLight808().noteOff(String(event.pointerId), { boom: heldMs < 200 && !record.moved });
      if (record.moved) recordLight("slide", 0.5);
    }
    hideTouch(event.pointerId);
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* noop */ }
  }, [hideTouch, recordLight]);

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

  // shake → strum every kept translation as a fast light-burst arpeggio
  const onShake = useCallback(() => {
    const now = performance.now();
    if (now - lastShakeAt.current < 1200) return;
    lastShakeAt.current = now;
    const kept = marksRef.current;
    if (kept.length > 0) {
      getLight808().strum(kept.map((mark) => mark.audible), 0.055);
      recordLight(`shake/strum/${kept.length}`, 0.95);
    } else {
      getLight808().kick(42);
      recordLight("shake/kick", 0.8);
    }
    pulseFlash();
    try { roll(); } catch { /* noop */ }
  }, [pulseFlash, recordLight]);

  // ── device motion + orientation ────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hasMotion = "DeviceMotionEvent" in window || "DeviceOrientationEvent" in window;
    if (!hasMotion) return;
    const motionCtor = (window as { DeviceMotionEvent?: PermissionRequester }).DeviceMotionEvent;
    const needsPermission = typeof motionCtor?.requestPermission === "function";
    setMotionState(needsPermission ? "needs-permission" : "on");
  }, []);

  useEffect(() => {
    if (motionState !== "on" || typeof window === "undefined") return;

    const onMotion = (event: DeviceMotionEvent) => {
      const accel = event.accelerationIncludingGravity ?? event.acceleration;
      if (!accel || accel.x == null || accel.y == null || accel.z == null) return;
      const previous = lastAccel.current;
      lastAccel.current = { x: accel.x, y: accel.y, z: accel.z };
      if (!previous) return;
      const jerk = Math.hypot(accel.x - previous.x, accel.y - previous.y, accel.z - previous.z);
      if (jerk > 16) {
        const now = performance.now();
        if (now - lastJerkAt.current < 500) onShake();
        lastJerkAt.current = now;
      }
    };

    const onOrientation = (event: DeviceOrientationEvent) => {
      const beta = event.beta ?? 0;
      const gamma = event.gamma ?? 0;

      // flip the phone past face-down → toggle sub mode
      const isFlipped = Math.abs(beta) > 135;
      if (isFlipped && !flipped.current) {
        flipped.current = true;
        toggleSubMode(!getLight808().getSubMode(), "flip");
      } else if (!isFlipped && Math.abs(beta) < 100) {
        flipped.current = false;
      }

      // tilt left/right sweeps the filter, pitch-tilt adds vibrato
      getLight808().setMacro({
        cutoff: clamp(gamma / 45, -1, 1),
        vibrato: clamp((Math.abs(beta - 50) - 25) / 60, 0, 1),
      });
    };

    window.addEventListener("devicemotion", onMotion);
    window.addEventListener("deviceorientation", onOrientation);
    return () => {
      window.removeEventListener("devicemotion", onMotion);
      window.removeEventListener("deviceorientation", onOrientation);
    };
  }, [motionState, onShake, toggleSubMode]);

  const requestMotion = useCallback(async () => {
    const win = window as {
      DeviceMotionEvent?: PermissionRequester;
      DeviceOrientationEvent?: PermissionRequester;
    };
    try {
      const results = await Promise.all([
        win.DeviceMotionEvent?.requestPermission?.() ?? Promise.resolve("granted"),
        win.DeviceOrientationEvent?.requestPermission?.() ?? Promise.resolve("granted"),
      ]);
      if (results.every((result) => result === "granted")) {
        setMotionState("on");
        recordLight("motion/granted", 0.5);
      }
    } catch { /* user dismissed the prompt */ }
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
        className="light-plate"
        role="application"
        tabIndex={0}
        aria-label="full-screen light instrument — touch to play sustained 808 tones, slide to glide, use several fingers for chords"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      >
        <div key={flash} className="light-flash" aria-hidden="true" />
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
          <button type="button" onClick={clearMarks} disabled={marks.length === 0}>
            clear
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
          box-shadow: inset 0 0 140px rgba(0,0,0,0.55);
          isolation: isolate;
          transition: filter 500ms ease;
        }
        .light-sub .light-plate {
          filter: brightness(0.62) saturate(1.35);
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
          animation: lightFlash 520ms ease-out;
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
          animation: lightPulse 1600ms ease-out forwards;
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
          animation: lightGhost 900ms ease-in-out infinite;
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
