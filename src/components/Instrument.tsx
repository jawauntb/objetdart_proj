"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import { getTimbreEngine } from "@/lib/timbre-engine";
import { attachGestures } from "@/lib/gesture";
import { tap as hapticTap, ripple } from "@/lib/haptics";
import {
  audibleFrequency,
  clamp,
  colorFromWavelength,
  formatHz,
  noteName,
  quantizeFrequency,
  wavelengthFromX,
  type ScaleMode,
} from "@/lib/light-music";
import { TIMBRE_CHAIN, timbreAt } from "@/lib/timbre";
import { useField } from "@/store/field";

// /instrument — the meta instrument on the shared gesture grammar.
//
// The same surface as /timbre (sideways is pitch through the hearing↔sight
// bridge, up and down morphs between instruments) but spoken entirely in the
// grammar: every finger is a `voice` (the polyphonic channel), pinch zooms
// the pitch window for finer intervals, twist turns the scale lens
// (penta → chroma → pure). No raw pointer wiring in the room.

type ActiveTouch = {
  id: number;
  x: number;
  y: number;
  color: string;
  note: string;
  voice: string;
};

type PitchWindow = { lo: number; w: number };

const SCALE_ORDER: ScaleMode[] = ["penta", "chroma", "pure"];
const SCALE_LABELS: Record<ScaleMode, string> = {
  penta: "penta",
  chroma: "chroma",
  pure: "pure",
};

const SPECTRUM_GRADIENT =
  "linear-gradient(90deg, #8e2318 0%, #d83a2e 10.2%, #f08a28 30.4%, #f5d65b 39.1%, #4fca75 51.1%, #45b8e8 64.1%, #5574f7 75.1%, #9a63ee 90.6%, #7a43d8 100%)";

// desktop keys — A minor pentatonic climbing from A2, voiced by the plate
const KEY_ROW = ["a", "s", "d", "f", "g", "h", "j", "k", "l"];
const KEY_SEMITONES = [0, 3, 5, 7, 10, 12, 15, 17, 19];

export default function Instrument() {
  const plateRef = useRef<HTMLDivElement | null>(null);
  const windowRef = useRef<PitchWindow>({ lo: 0, w: 1 });
  const scaleModeRef = useRef<ScaleMode>("chroma");
  const positionRef = useRef(0.5);
  const twistAcc = useRef(0);
  const lastMorphTick = useRef(0);
  const lastHapticTick = useRef(0);

  const [pitchWindow, setPitchWindow] = useState<PitchWindow>({ lo: 0, w: 1 });
  const [wavelength, setWavelength] = useState(553);
  const [position, setPosition] = useState(0.5);
  const [touches, setTouches] = useState<ActiveTouch[]>([]);
  const [scaleMode, setScaleMode] = useState<ScaleMode>("chroma");

  windowRef.current = pitchWindow;
  scaleModeRef.current = scaleMode;
  positionRef.current = position;

  const color = useMemo(() => colorFromWavelength(wavelength), [wavelength]);
  const audible = useMemo(
    () => quantizeFrequency(audibleFrequency(wavelength), scaleMode),
    [wavelength, scaleMode],
  );
  const currentNote = useMemo(() => noteName(audible), [audible]);
  const blend = useMemo(() => timbreAt(position), [position]);
  const windowLabel = useMemo(() => {
    const { lo, w } = pitchWindow;
    return `${Math.round(wavelengthFromX(lo))}–${Math.round(wavelengthFromX(lo + w))} nm`;
  }, [pitchWindow]);

  const recordInstrument = useCallback((meta: string, intensity: number) => {
    useField.getState().recordTape("sigil", intensity, `instrument/${meta}`);
  }, []);

  useEffect(() => {
    const plate = plateRef.current;
    if (!plate) return;
    const engine = getTimbreEngine();

    const translationAt = (clientX: number, clientY: number) => {
      const rect = plate.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / rect.width, 0, 1);
      const y = clamp((clientY - rect.top) / rect.height, 0, 1);
      const { lo, w } = windowRef.current;
      const nm = wavelengthFromX(lo + x * w);
      const freq = quantizeFrequency(audibleFrequency(nm), scaleModeRef.current);
      return { x, y, nm, freq, spec: timbreAt(y), color: colorFromWavelength(nm) };
    };

    const showTouch = (id: number, x: number, y: number, freq: number, touchColor: string, voice: string) => {
      setTouches((current) => {
        const next = current.filter((touch) => touch.id !== id);
        next.push({ id, x, y, color: touchColor, note: noteName(freq), voice });
        return next;
      });
    };

    const hideTouch = (id: number) => {
      setTouches((current) => current.filter((touch) => touch.id !== id));
    };

    const detach = attachGestures(plate, {
      voice: (e) => {
        const t = translationAt(e.x, e.y);
        const key = `v${e.id}`;
        if (e.phase === "start") {
          void getFieldAudio().start();
          engine.noteOn(key, t.freq, t.spec);
          setWavelength(t.nm);
          setPosition(t.y);
          showTouch(e.id, t.x, t.y, t.freq, t.color, t.spec.label);
          try { ripple(0.35 + e.intensity * 0.4); } catch { /* noop */ }
          recordInstrument(`voice/${Math.round(t.freq)}hz`, clamp(0.3 + e.intensity * 0.4, 0.2, 1));
          return;
        }
        if (e.phase === "move") {
          engine.glide(key, t.freq);
          const tick = performance.now();
          if (tick - lastMorphTick.current > 60) {
            lastMorphTick.current = tick;
            engine.morph(key, t.spec);
          }
          if (tick - lastHapticTick.current > 110) {
            lastHapticTick.current = tick;
            try { hapticTap(); } catch { /* noop */ }
          }
          setWavelength(t.nm);
          setPosition(t.y);
          showTouch(e.id, t.x, t.y, t.freq, t.color, t.spec.label);
          return;
        }
        // end or cancel — a canceled voice was a grip forming, let it go fast
        engine.noteOff(key);
        hideTouch(e.id);
        if (e.phase === "cancel") recordInstrument("voice/became-grip", 0.24);
      },
      pinch: (e) => {
        if (e.phase !== "move") return;
        const rect = plate.getBoundingClientRect();
        const cxNorm = clamp((e.cx - rect.left) / rect.width, 0, 1);
        const { lo, w } = windowRef.current;
        const nextW = clamp(w / e.scale, 0.08, 1);
        const anchor = lo + cxNorm * w;
        const nextLo = clamp(anchor - cxNorm * nextW, 0, 1 - nextW);
        setPitchWindow({ lo: nextLo, w: nextW });
      },
      twist: (e) => {
        if (e.fingers === 3) return; // three fingers turn the season, not the lens
        if (e.phase !== "move") return;
        twistAcc.current += e.angle;
        const step = Math.PI / 2;
        while (Math.abs(twistAcc.current) >= step) {
          const direction = twistAcc.current > 0 ? 1 : -1;
          twistAcc.current -= direction * step;
          setScaleMode((mode) => {
            const index = SCALE_ORDER.indexOf(mode);
            const next = SCALE_ORDER[(index + direction + SCALE_ORDER.length) % SCALE_ORDER.length];
            recordInstrument(`lens/${next}`, 0.4);
            return next;
          });
          try { hapticTap(); } catch { /* noop */ }
        }
      },
    });

    return () => {
      detach();
      engine.stopAll();
    };
  }, [recordInstrument]);

  // ── desktop keyboard — pentatonic row voiced by the plate's last position ──
  useEffect(() => {
    const heldKeys = new Set<string>();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(input|textarea|select|button|a)$/i.test(target.tagName)) return;
      const key = event.key.toLowerCase();
      const index = KEY_ROW.indexOf(key);
      if (index === -1 || heldKeys.has(key)) return;
      event.preventDefault();
      heldKeys.add(key);
      const freq = 110 * 2 ** (KEY_SEMITONES[index] / 12);
      getTimbreEngine().noteOn(`key:${key}`, freq, timbreAt(positionRef.current));
      useField.getState().recordTape("sigil", 0.4, `instrument/key/${key}`);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (!heldKeys.delete(key)) return;
      getTimbreEngine().noteOff(`key:${key}`);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      heldKeys.forEach((key) => getTimbreEngine().noteOff(`key:${key}`));
    };
  }, []);

  const plateBackground = useMemo(() => {
    const { lo, w } = pitchWindow;
    const size = `${100 / w}% 100%`;
    const positionX = w >= 1 ? "0%" : `${(lo / (1 - w)) * 100}%`;
    return { size, positionX };
  }, [pitchWindow]);

  return (
    <div
      className="instr-page"
      data-touch-surface="true"
      data-pretext-ignore="true"
      style={{ "--instr-color": color } as React.CSSProperties}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        ref={plateRef}
        className="instr-plate"
        role="application"
        tabIndex={0}
        aria-label="the meta instrument — every finger is a voice; sideways is pitch, up and down morphs between harp, piano, guitar, tar, sitar, violin, saxophone and trumpet; pinch zooms the pitch range, twist changes the scale"
        style={{
          backgroundSize: `100% 100%, 100% 100%, ${plateBackground.size}`,
          backgroundPosition: `0 0, 0 0, ${plateBackground.positionX} 0`,
        }}
      >
        <div className="instr-bands" aria-hidden="true">
          {TIMBRE_CHAIN.map((voice, index) => (
            <span
              key={voice.key}
              style={{ top: `${(index / (TIMBRE_CHAIN.length - 1)) * 100}%` }}
              className={
                Math.abs(position * (TIMBRE_CHAIN.length - 1) - index) < 0.5 ? "is-near" : undefined
              }
            >
              {voice.label}
            </span>
          ))}
        </div>
        {touches.map((touch) => (
          <span
            key={touch.id}
            className="instr-finger"
            style={{
              left: `${touch.x * 100}%`,
              top: `${touch.y * 100}%`,
              borderColor: touch.color,
              boxShadow: `0 0 44px ${touch.color}, inset 0 0 24px ${touch.color}`,
            }}
          >
            <strong>{touch.note}</strong>
            <em>{touch.voice}</em>
          </span>
        ))}
        <div className="instr-current" aria-hidden="true">
          <span>{blend.label}</span>
          <strong>{currentNote}</strong>
          <em>{formatHz(audible)}</em>
        </div>
      </div>

      <header className="instr-hud instr-hud-top">
        <Link href="/" className="instr-home">objetd&rsquo;art</Link>
        <p className="instr-eyebrow">instrument / every finger a voice</p>
        <div className="instr-readout" aria-label="current voice, pitch, window and scale">
          <span>{blend.label}</span>
          <span className="instr-readout-wide">{windowLabel}</span>
          <span className="instr-readout-wide">lens: {SCALE_LABELS[scaleMode]}</span>
          <span>{formatHz(audible)} / {currentNote}</span>
        </div>
      </header>

      <footer className="instr-hud instr-hud-bottom">
        <div className="instr-actions" aria-label="instrument links">
          <Link href="/timbre">timbre</Link>
          <Link href="/light">light</Link>
        </div>
        <p className="instr-hint">
          fingers are voices, landed apart they stay voices · slide to bend and
          to become another instrument · pinch to zoom the pitch range · twist
          to turn the scale lens
        </p>
      </footer>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .instr-page {
          position: fixed;
          inset: 0;
          background: #070908;
          color: rgba(245, 240, 230, 0.94);
          overflow: hidden;
          overscroll-behavior: none;
          user-select: none;
          -webkit-user-select: none;
          -webkit-touch-callout: none;
        }
        body:has(.instr-page) {
          overflow: hidden;
        }
        body:has(.instr-page) .oda-field-watch,
        body:has(.instr-page) .oda-candle-mark,
        body:has(.instr-page) .oda-tape-shell,
        body:has(.instr-page) .oda-sound-toggle {
          display: none !important;
        }
        .instr-plate {
          position: absolute;
          inset: 0;
          overflow: hidden;
          cursor: crosshair;
          background-image:
            repeating-linear-gradient(180deg, transparent 0 calc(100%/7 - 1px), rgba(255,255,255,0.08) calc(100%/7 - 1px) calc(100%/7)),
            linear-gradient(180deg, rgba(255,255,255,0.06), transparent 20%, rgba(0,0,0,0.5) 100%),
            ${SPECTRUM_GRADIENT};
          background-repeat: no-repeat;
          box-shadow: inset 0 0 160px rgba(0,0,0,0.66);
          filter: saturate(0.72) brightness(0.82);
        }
        .instr-plate:after {
          content: "";
          position: absolute;
          inset: 0;
          background: radial-gradient(circle at 50% 50%, transparent 0 30%, rgba(2,3,3,0.35) 68%, rgba(2,3,3,0.7) 100%);
          pointer-events: none;
        }
        .instr-bands {
          position: absolute;
          inset: 0;
          z-index: 2;
          pointer-events: none;
        }
        .instr-bands span {
          position: absolute;
          left: 14px;
          transform: translateY(-50%);
          color: rgba(245, 240, 230, 0.44);
          font-family: var(--font-text);
          font-size: 12px;
          text-transform: lowercase;
          letter-spacing: 0.04em;
          text-shadow: 0 1px 8px rgba(0,0,0,0.7);
          transition: color 300ms ease, text-shadow 300ms ease;
        }
        .instr-bands span.is-near {
          color: rgba(255, 255, 255, 0.92);
          text-shadow: 0 0 18px var(--instr-color), 0 1px 8px rgba(0,0,0,0.7);
        }
        .instr-finger {
          position: absolute;
          width: clamp(88px, 18vw, 136px);
          aspect-ratio: 1;
          border: 1.5px solid currentColor;
          border-radius: 50%;
          transform: translate(-50%, -50%);
          display: grid;
          place-items: center;
          align-content: center;
          gap: 2px;
          background: rgba(5,7,8,0.3);
          backdrop-filter: blur(3px);
          mix-blend-mode: screen;
          z-index: 4;
          pointer-events: none;
        }
        .instr-finger strong {
          color: white;
          font-family: var(--font-serif);
          font-size: clamp(26px, 5.4vw, 38px);
          font-weight: 300;
          line-height: 0.9;
        }
        .instr-finger em {
          color: rgba(245,240,230,0.82);
          font-family: var(--font-text);
          font-size: 11px;
          font-style: normal;
          text-transform: lowercase;
        }
        .instr-current {
          position: absolute;
          left: 50%;
          top: 46%;
          width: min(230px, 52vw);
          aspect-ratio: 1;
          transform: translate(-50%, -50%);
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 50%;
          display: grid;
          place-items: center;
          align-content: center;
          gap: 6px;
          background: rgba(5,7,8,0.32);
          backdrop-filter: blur(6px);
          text-align: center;
          z-index: 3;
          pointer-events: none;
        }
        .instr-current span,
        .instr-current em {
          color: rgba(245, 240, 230, 0.74);
          font-family: var(--font-text);
          font-size: 12px;
          font-style: normal;
          text-transform: lowercase;
        }
        .instr-current strong {
          color: white;
          font-family: var(--font-serif);
          font-size: clamp(48px, 8.6vw, 80px);
          line-height: 0.85;
          font-weight: 300;
          text-shadow: 0 0 34px var(--instr-color);
        }
        .instr-hud {
          position: absolute;
          left: 0;
          right: 0;
          z-index: 6;
          pointer-events: none;
          padding: 0 clamp(12px, 3vw, 26px);
        }
        .instr-hud-top {
          top: calc(58px + env(safe-area-inset-top, 0px));
          display: flex;
          align-items: center;
          gap: 14px;
          flex-wrap: wrap;
        }
        .instr-home {
          pointer-events: auto;
          color: rgba(245,240,230,0.92);
          font-family: var(--font-serif);
          font-size: 19px;
          text-decoration: none;
          text-shadow: 0 1px 12px rgba(0,0,0,0.6);
        }
        .instr-eyebrow {
          margin: 0;
          color: rgba(245, 240, 230, 0.62);
          font-family: var(--font-text);
          font-size: 11px;
          text-transform: lowercase;
          text-shadow: 0 1px 10px rgba(0,0,0,0.6);
        }
        .instr-readout {
          margin-left: auto;
          display: flex;
          gap: 1px;
          border: 1px solid rgba(245, 240, 230, 0.16);
          background: rgba(245, 240, 230, 0.14);
        }
        .instr-readout span {
          padding: 7px 10px;
          background: rgba(8, 10, 9, 0.66);
          backdrop-filter: blur(6px);
          color: rgba(245, 240, 230, 0.92);
          font-family: var(--font-numerals);
          font-size: 12px;
          white-space: nowrap;
          text-transform: lowercase;
        }
        .instr-hud-bottom {
          bottom: calc(10px + env(safe-area-inset-bottom, 0px));
          display: grid;
          gap: 8px;
        }
        .instr-actions {
          display: flex;
          gap: 1px;
          border: 1px solid rgba(245, 240, 230, 0.16);
          background: rgba(245, 240, 230, 0.14);
          pointer-events: auto;
          width: fit-content;
        }
        .instr-actions a {
          min-height: 42px;
          display: inline-flex;
          align-items: center;
          padding: 0 14px;
          background: rgba(8,10,9,0.7);
          backdrop-filter: blur(6px);
          color: rgba(245, 240, 230, 0.88);
          font-family: var(--font-text);
          font-size: 12px;
          line-height: 1;
          text-transform: lowercase;
          text-decoration: none;
        }
        .instr-hint {
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
          .instr-readout {
            margin-left: 0;
            width: 100%;
          }
          .instr-readout span {
            flex: 1;
            text-align: center;
          }
          .instr-readout-wide {
            display: none;
          }
          .instr-current {
            top: 40%;
          }
          .instr-hint {
            font-size: 10px;
          }
        }
      `,
        }}
      />
    </div>
  );
}
