"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import { getTimbreEngine } from "@/lib/timbre-engine";
import { tap as hapticTap, ripple, roll, chop, lens as hapticLens, bloom as hapticBloom } from "@/lib/haptics";
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
import {
  playLesson,
  timbreGravity,
  timbreLesson,
  type LessonGhost,
} from "@/lib/instrument-lesson";
import { TIMBRE_CHAIN, timbreAt, type TimbreBlend } from "@/lib/timbre";
import { useField } from "@/store/field";
import { attachGestures } from "@/lib/gesture";
import { holdTier } from "@/lib/gesture/core";
import { onVessel } from "@/lib/vessel";
import LetGo from "@/components/LetGo";

type ActiveTouch = {
  id: number;
  x: number;
  y: number;
  color: string;
  note: string;
  voice: string;
};

type KeptChord = {
  id: number;
  x: number;
  y: number;
  nm: number;
  freq: number;
  spec: TimbreBlend;
  color: string;
};

const SCALE_LABELS: Record<ScaleMode, string> = {
  penta: "scale: penta",
  chroma: "scale: chroma",
  pure: "scale: pure",
};

// desktop keys — A minor pentatonic climbing from A2, voiced by the last
// touched spot on the plate
const KEY_ROW = ["a", "s", "d", "f", "g", "h", "j", "k", "l"];
const KEY_SEMITONES = [0, 3, 5, 7, 10, 12, 15, 17, 19];

export default function TimbreInstrument() {
  const plateRef = useRef<HTMLDivElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number; at: number; downAt: number; moved: boolean; ownMarkId: number }>());
  const lastMorphTick = useRef(0);
  const scaleModeRef = useRef<ScaleMode>("chroma");
  const positionRef = useRef(0.5);
  const cancelLesson = useRef<null | (() => void)>(null);
  const markId = useRef(0);
  const keptRef = useRef<KeptChord[]>([]);

  // ── frame-layer state (two/three-finger verbs) ─────────────────────
  const zoomRef = useRef({ cur: 1, target: 1 });
  const panRef = useRef({ cur: 0, target: 0 });
  const lensTwistAccRef = useRef(0);
  const timeScaleRef = useRef(1);
  const windLastAtRef = useRef(0);
  const nightRef = useRef(false);
  const lastTouchAtRef = useRef(0);

  const [wavelength, setWavelength] = useState(553);
  const [position, setPosition] = useState(0.5);
  const [touches, setTouches] = useState<ActiveTouch[]>([]);
  const [ghosts, setGhosts] = useState<LessonGhost[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [lessonLabel, setLessonLabel] = useState("");
  const [scaleMode, setScaleMode] = useState<ScaleMode>("chroma");
  const [kept, setKept] = useState<KeptChord[]>([]);
  const [isReplaying, setIsReplaying] = useState(false);
  const [charges, setCharges] = useState<Array<{ id: number; x: number; y: number; pct: number; mode: "create" | "delete" }>>([]);
  const [glimmering, setGlimmering] = useState(false);
  const glimmeringRef = useRef(false);
  useEffect(() => { glimmeringRef.current = glimmering; }, [glimmering]);
  const isListeningRef = useRef(false);
  useEffect(() => { isListeningRef.current = isListening; }, [isListening]);

  scaleModeRef.current = scaleMode;
  positionRef.current = position;
  keptRef.current = kept;

  const color = useMemo(() => colorFromWavelength(wavelength), [wavelength]);
  const audible = useMemo(
    () => quantizeFrequency(audibleFrequency(wavelength), scaleMode),
    [wavelength, scaleMode],
  );
  const currentNote = useMemo(() => noteName(audible), [audible]);
  const blend = useMemo(() => timbreAt(position), [position]);

  const recordTimbre = useCallback((meta: string, intensity: number) => {
    useField.getState().recordTape("sigil", intensity, `timbre/${meta}`);
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

  // pinch zooms into a narrower slice of pitch; pan2 shifts which slice
  // sits under the plate — the map layer over the same material.
  const mapX = useCallback((x: number) => {
    const mapped = 0.5 + (x - 0.5) / zoomRef.current.cur + panRef.current.cur;
    return clamp(mapped, 0, 1);
  }, []);

  // x is pitch (and color, through the light bridge); y is which instrument
  const translationAt = useCallback((x: number, y: number) => {
    const nm = wavelengthFromX(mapX(x));
    const freq = quantizeFrequency(audibleFrequency(nm), scaleModeRef.current);
    const spec = timbreAt(y);
    return { nm, freq, spec, color: colorFromWavelength(nm) };
  }, [mapX]);

  const showTouch = useCallback((id: number, x: number, y: number, freq: number, touchColor: string, voice: string) => {
    setTouches((current) => {
      const next = current.filter((touch) => touch.id !== id);
      next.push({ id, x, y, color: touchColor, note: noteName(freq), voice });
      return next;
    });
  }, []);

  const hideTouch = useCallback((id: number) => {
    setTouches((current) => current.filter((touch) => touch.id !== id));
  }, []);

  // ── create/delete: the room's material is countable (a kept chord).
  const keepChord = useCallback((x: number, y: number, nm: number, freq: number, spec: TimbreBlend, chordColor: string) => {
    const id = markId.current++;
    setKept((current) => [...current.slice(-11), { id, x, y, nm, freq, spec, color: chordColor }]);
    return id;
  }, []);

  const findNearKept = useCallback((x: number, y: number, excludeId?: number): KeptChord | null => {
    let best: KeptChord | null = null;
    let bestD = 0.05;
    for (const chord of keptRef.current) {
      if (chord.id === excludeId) continue;
      const d = Math.hypot(chord.x - x, chord.y - y);
      if (d < bestD) { bestD = d; best = chord; }
    }
    return best;
  }, []);

  const forgetChord = useCallback((id: number) => {
    setKept((current) => current.filter((chord) => chord.id !== id));
    try { roll(); } catch { /* noop */ }
    try { getFieldAudio().thud(); } catch { /* noop */ }
    recordTimbre("memory/forget", 0.5);
  }, [recordTimbre]);

  const replayKept = useCallback(() => {
    const chords = keptRef.current;
    if (chords.length === 0) {
      try { getFieldAudio().refuse(); } catch { /* noop */ }
      recordTimbre("memory/empty", 0.24);
      return;
    }
    setIsReplaying(true);
    recordTimbre("memory/replay", 0.85);
    chords.forEach((chord, index) => {
      window.setTimeout(() => {
        const id = `replay:${chord.id}`;
        getTimbreEngine().noteOn(id, chord.freq, chord.spec);
        setWavelength(chord.nm);
        setPosition(chord.y);
        window.setTimeout(() => getTimbreEngine().noteOff(id), 240);
      }, index * 260);
    });
    window.setTimeout(() => setIsReplaying(false), chords.length * 260 + 420);
  }, [recordTimbre]);

  const letGoKept = useCallback(() => {
    setKept([]);
    try { getFieldAudio().thud(); } catch { /* noop */ }
    recordTimbre("memory/clear", 0.34);
  }, [recordTimbre]);

  const tuttiBurst = useCallback(() => {
    if (keptRef.current.length > 0) {
      replayKept();
    } else {
      try { getFieldAudio().chime(); } catch { /* noop */ }
    }
    recordTimbre("tutti", 0.6);
    try { roll(); } catch { /* noop */ }
  }, [recordTimbre, replayKept]);


  const stopLesson = useCallback(() => {
    cancelLesson.current?.();
    cancelLesson.current = null;
    getTimbreEngine().stopAll();
    pointers.current.clear();
    setTouches([]);
    setGhosts([]);
    setLessonLabel("");
    setIsListening(false);
  }, []);

  const playListen = useCallback(() => {
    void getFieldAudio().start();
    cancelLesson.current?.();
    getTimbreEngine().stopAll();
    pointers.current.clear();
    setTouches([]);
    setGhosts([]);
    setIsListening(true);
    setLessonLabel("");
    recordTimbre("lesson/listen", 0.7);
    try { ripple(0.5); } catch { /* noop */ }

    cancelLesson.current = playLesson(timbreLesson(), {
      on: (e) => {
        const spec = timbreAt(e.y);
        const touchColor = colorFromWavelength(wavelengthFromX(e.x));
        getTimbreEngine().noteOn(`lesson:${e.id}`, e.freq, spec);
        setWavelength(wavelengthFromX(e.x));
        setPosition(e.y);
        setGhosts((current) => [
          ...current.filter((ghost) => ghost.id !== e.id),
          { id: e.id, x: e.x, y: e.y, note: e.note, voice: e.voice ?? spec.label, color: touchColor },
        ]);
      },
      off: (e) => {
        getTimbreEngine().noteOff(`lesson:${e.id}`);
        setGhosts((current) => current.filter((ghost) => ghost.id !== e.id));
      },
      morph: (e) => {
        const spec = timbreAt(e.y);
        getTimbreEngine().morph(`lesson:${e.id}`, spec);
        setPosition(e.y);
        setGhosts((current) =>
          current.map((ghost) =>
            ghost.id === e.id ? { ...ghost, y: e.y, voice: e.voice ?? spec.label } : ghost,
          ),
        );
      },
      label: (text) => setLessonLabel(text),
      done: () => {
        cancelLesson.current = null;
        setGhosts([]);
        setLessonLabel("");
        setIsListening(false);
      },
    });
  }, [recordTimbre]);

  const cycleScale = useCallback(() => {
    setScaleMode((mode) => (mode === "penta" ? "chroma" : mode === "chroma" ? "pure" : "penta"));
    try { hapticTap(); } catch { /* noop */ }
  }, []);

  // ── the gesture surface ──────────────────────────────────────────────
  // Polyphonic (binds `voice`): every finger is an independent voice that
  // sounds the instant it lands — several fingers stack a chord across
  // instruments (grammar §3). A together-landed pair moving against each
  // other is reclaimed as the frame layer: pinch magnifies the pitch axis,
  // twist(2) rotates the lens through the scale modes, pan2 shifts which
  // slice of the mapping sits under the plate.
  //
  // Three-finger law-layer channels are silenced by the engine on any
  // surface binding `voice` (see LightInstrument.tsx for the same note);
  // time dilation and wind are reconstructed from the raw voice count,
  // season is exempted — the one sacrifice grammar §3 names for instrument
  // surfaces.
  useEffect(() => {
    const plate = plateRef.current;
    if (!plate) return;
    const chargeState = new Map<number, { sealed: boolean }>();

    const detachGestures = attachGestures(
      plate,
      {
        voice: (e) => {
          lastTouchAtRef.current = performance.now();
          const { x, y: rawY } = plateXY(e.x, e.y);
          if (e.phase === "start") {
            void getFieldAudio().start();
            // Band gravity: a slow hand settles onto an instrument.
            const y = timbreGravity(rawY, 0.35);
            const { nm, freq, spec, color: touchColor } = translationAt(x, y);
            const ownMarkId = keepChord(x, y, nm, freq, spec, touchColor);
            pointers.current.set(e.id, { x, y, at: performance.now(), downAt: performance.now(), moved: false, ownMarkId });
            chargeState.set(e.id, { sealed: false });
            getTimbreEngine().noteOn(String(e.id), freq, spec);
            setWavelength(nm);
            setPosition(y);
            showTouch(e.id, x, y, freq, touchColor, spec.label);
            try { ripple(0.4 + (1 - y) * 0.3); } catch { /* noop */ }
            recordTimbre(`${spec.label.replace(/\s/g, "")}/${Math.round(freq)}hz`, clamp(0.3 + spec.mix * 0.3, 0.2, 1));
            return;
          }
          const prev = pointers.current.get(e.id);
          if (e.phase === "move") {
            if (!prev) return;
            const now = performance.now();
            const dt = Math.max(16, now - prev.at);
            const speed = Math.hypot(x - prev.x, rawY - prev.y) / dt;
            // Slow motion pulls toward the nearest instrument band; a quick stroke stays free.
            const y = speed < 0.0012 ? timbreGravity(rawY, 0.28) : rawY;
            if (!prev.moved && Math.hypot(x - prev.x, y - prev.y) > 0.02) {
              prev.moved = true;
              if (pointers.current.size >= 3) {
                const now2 = performance.now();
                if (now2 - windLastAtRef.current > 220) {
                  windLastAtRef.current = now2;
                  const { freq } = translationAt(x, y);
                  getTimbreEngine().noteOn("wind", freq, timbreAt(y));
                  window.setTimeout(() => getTimbreEngine().noteOff("wind"), 90);
                  try { chop(); } catch { /* noop */ }
                  recordTimbre("wind", 0.4);
                }
              }
            }
            pointers.current.set(e.id, { x, y, at: now, downAt: prev.downAt, moved: prev.moved, ownMarkId: prev.ownMarkId });
            const { nm, freq, spec, color: touchColor } = translationAt(x, y);
            const engine = getTimbreEngine();
            engine.glide(String(e.id), freq);
            if (now - lastMorphTick.current > 60) {
              lastMorphTick.current = now;
              engine.morph(String(e.id), spec);
              try { hapticTap(); } catch { /* noop */ }
            }
            setWavelength(nm);
            setPosition(y);
            showTouch(e.id, x, y, freq, touchColor, spec.label);
            return;
          }
          // end / cancel
          pointers.current.delete(e.id);
          chargeState.delete(e.id);
          getTimbreEngine().noteOff(String(e.id));
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
            // step back: leave the lesson, else nudge the zoom home.
            if (isListeningRef.current) {
              stopLesson();
            } else if (Math.abs(zoomRef.current.target - 1) > 0.02) {
              zoomRef.current.target = 1;
            }
            try { hapticTap(); } catch { /* noop */ }
            return;
          }
          if (e.fingers === 3) {
            // tutti — one synchronized pulse of everything alive.
            tuttiBurst();
          }
        },
      },
      { wheelZoom: false },
    );

    const detachVessel = onVessel({
      tilt: ({ gamma }) => {
        panRef.current.target = clamp(panRef.current.target + gamma * 0.0006, -0.4, 0.4);
      },
      shake: () => { tuttiBurst(); },
      knock: () => {
        try { getFieldAudio().chime(); } catch { /* noop */ }
        try { hapticBloom(); } catch { /* noop */ }
        recordTimbre("vessel/knock", 0.6);
      },
      flip: ({ faceDown }) => { nightRef.current = faceDown; },
    });

    let raf = 0;
    const ease = () => {
      raf = requestAnimationFrame(ease);
      const z = zoomRef.current;
      z.cur += (z.target - z.cur) * 0.12;
      const p = panRef.current;
      p.cur += (p.target - p.cur) * 0.1;
      let stationary = 0;
      for (const r of pointers.current.values()) if (!r.moved) stationary++;
      const dilating = stationary >= 3;
      timeScaleRef.current += ((dilating ? 3 : 1) - timeScaleRef.current) * 0.06;
      plate.style.setProperty("--timbre-zoom", z.cur.toFixed(4));
      plate.style.setProperty("--timbre-pan", p.cur.toFixed(4));
      plate.style.setProperty("--timbre-time-scale", timeScaleRef.current.toFixed(3));
      plate.style.setProperty("--timbre-night", nightRef.current ? "0.5" : "0");
    };
    raf = requestAnimationFrame(ease);

    // create/delete poll: dwell/ceremony never reach `on.hold` on a poly
    // surface, so a stationary voice's elapsed time is read by hand each
    // tick, sharing the one classifier (`holdTier`) rather than a new one.
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
        const near = findNearKept(record.x, record.y, record.ownMarkId);
        const mode: "create" | "delete" = near ? "delete" : "create";
        active.push({ id, x: record.x, y: record.y, pct: Math.min(1, (elapsed - 900) / 1600), mode });
        if (!chg.sealed && tier >= 3) {
          chg.sealed = true;
          try { hapticBloom(); } catch { /* noop */ }
          if (mode === "delete" && near) forgetChord(near.id);
          else replayKept();
        }
      }
      setCharges(active);
      if (now - lastTouchAtRef.current > 20000) {
        setGlimmering((g) => (g ? g : true));
      } else if (glimmeringRef.current) {
        setGlimmering(false);
      }
    }, 90);

    return () => {
      detachGestures();
      detachVessel();
      cancelAnimationFrame(raf);
      window.clearInterval(chargeTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── desktop keyboard — pentatonic row voiced by the last touched timbre ──
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
      useField.getState().recordTape("sigil", 0.4, `timbre/key/${key}`);
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

  useEffect(() => {
    return () => {
      cancelLesson.current?.();
      getTimbreEngine().stopAll();
    };
  }, []);

  return (
    <div
      className="timbre-page"
      data-touch-surface="true"
      data-pretext-ignore="true"
      style={{ "--timbre-color": color } as React.CSSProperties}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        ref={plateRef}
        className={`timbre-plate${glimmering ? " is-glimmering" : ""}`}
        role="application"
        tabIndex={0}
        aria-label="meta instrument — sideways is pitch, up and down morphs between harp, piano, guitar, tar, sitar, violin, saxophone and trumpet; several fingers stack chords"
        style={{
          "--timbre-zoom": 1,
          "--timbre-pan": 0,
          "--timbre-time-scale": 1,
          "--timbre-night": 0,
        } as React.CSSProperties}
      >
        <div className="timbre-night-veil" aria-hidden="true" />
        {charges.map((charge) => (
          <span
            key={charge.id}
            className={`timbre-charge timbre-charge--${charge.mode}`}
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
        {kept.map((chord) => (
          <span
            key={`k-${chord.id}`}
            className="timbre-kept-mark"
            aria-hidden="true"
            style={{
              left: `${chord.x * 100}%`,
              top: `${chord.y * 100}%`,
              borderColor: chord.color,
              boxShadow: `0 0 24px ${chord.color}`,
            }}
          />
        ))}
        <div className="timbre-bands" aria-hidden="true">
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
        {ghosts.map((ghost) => (
          <span
            key={`g-${ghost.id}`}
            className="timbre-finger is-ghost"
            style={{
              left: `${ghost.x * 100}%`,
              top: `${ghost.y * 100}%`,
              borderColor: ghost.color ?? "rgba(255,255,255,0.7)",
              boxShadow: `0 0 36px ${ghost.color ?? "rgba(255,255,255,0.45)"}`,
            }}
          >
            <strong>{ghost.note}</strong>
            <em>{ghost.voice ?? "listen"}</em>
          </span>
        ))}
        {touches.map((touch) => (
          <span
            key={touch.id}
            className="timbre-finger"
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
        <div className="timbre-current" aria-hidden="true">
          <span>{blend.label}</span>
          <strong>{currentNote}</strong>
          <em>{lessonLabel || formatHz(audible)}</em>
        </div>
      </div>

      <header className="timbre-hud timbre-hud-top">
        <Link href="/" className="timbre-home">objetd&rsquo;art</Link>
        <p className="timbre-eyebrow">timbre / one surface, every instrument</p>
        <div className="timbre-readout" aria-label="current voice and pitch">
          <span>{blend.label}</span>
          <span className="timbre-readout-wide">{Math.round(wavelength)} nm</span>
          <span>{formatHz(audible)} / {currentNote}</span>
        </div>
      </header>

      <footer className="timbre-hud timbre-hud-bottom">
        <div className="timbre-actions" aria-label="timbre instrument controls">
          <button
            type="button"
            className={isListening ? "timbre-on" : undefined}
            onClick={isListening ? stopLesson : playListen}
          >
            {isListening ? "listening" : "listen"}
          </button>
          <button type="button" onClick={cycleScale}>{SCALE_LABELS[scaleMode]}</button>
          <button type="button" onClick={replayKept} disabled={isReplaying || isListening}>
            {isReplaying ? "replaying" : `replay · ${kept.length} kept`}
          </button>
          <Link href="/light">light</Link>
        </div>
        <p className="timbre-hint">
          {lessonLabel
            ? lessonLabel
            : "rest on a band and it becomes that instrument · listen, then stack your own chord"}
        </p>
      </footer>

      <LetGo label="let the chords go" onLetGo={letGoKept} visible={kept.length > 0} />

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .timbre-page {
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
        body:has(.timbre-page) {
          overflow: hidden;
        }
        body:has(.timbre-page) .oda-field-watch,
        body:has(.timbre-page) .oda-candle-mark,
        body:has(.timbre-page) .oda-tape-shell,
        body:has(.timbre-page) .oda-sound-toggle {
          display: none !important;
        }
        .timbre-plate {
          position: absolute;
          inset: 0;
          overflow: hidden;
          cursor: crosshair;
          touch-action: none;
          background:
            repeating-linear-gradient(180deg, transparent 0 calc(100%/7 - 1px), rgba(255,255,255,0.08) calc(100%/7 - 1px) calc(100%/7)),
            linear-gradient(180deg, rgba(255,255,255,0.06), transparent 20%, rgba(0,0,0,0.5) 100%),
            linear-gradient(90deg, #8e2318 0%, #d83a2e 10.2%, #f08a28 30.4%, #f5d65b 39.1%, #4fca75 51.1%, #45b8e8 64.1%, #5574f7 75.1%, #9a63ee 90.6%, #7a43d8 100%);
          background-blend-mode: normal, normal, normal;
          box-shadow: inset 0 0 160px rgba(0,0,0,0.66);
          filter: saturate(0.72) brightness(0.82);
        }
        .timbre-plate:after {
          content: "";
          position: absolute;
          inset: 0;
          background: radial-gradient(circle at 50% 50%, transparent 0 30%, rgba(2,3,3,0.35) 68%, rgba(2,3,3,0.7) 100%);
          pointer-events: none;
        }
        .timbre-bands {
          position: absolute;
          inset: 0;
          z-index: 2;
          pointer-events: none;
        }
        .timbre-bands span {
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
        .timbre-bands span.is-near {
          color: rgba(255, 255, 255, 0.92);
          text-shadow: 0 0 18px var(--timbre-color), 0 1px 8px rgba(0,0,0,0.7);
        }
        .timbre-bands span.is-near:before {
          content: "";
          position: absolute;
          left: -10px;
          right: -40vw;
          top: 50%;
          height: 1px;
          background: linear-gradient(90deg, rgba(255,255,255,0.35), transparent 70%);
          transform: translateY(-50%);
          pointer-events: none;
        }
        .timbre-finger {
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
        .timbre-finger.is-ghost {
          border-style: dashed;
          opacity: 0.8;
          animation: timbreGhost 900ms ease-in-out infinite;
        }
        @keyframes timbreGhost {
          0%, 100% { transform: translate(-50%, -50%) scale(0.96); opacity: 0.64; }
          50% { transform: translate(-50%, -50%) scale(1.04); opacity: 0.94; }
        }
        @media (prefers-reduced-motion: reduce) {
          .timbre-finger.is-ghost {
            animation: none;
          }
        }
        .timbre-finger strong {
          color: white;
          font-family: var(--font-serif);
          font-size: clamp(26px, 5.4vw, 38px);
          font-weight: 300;
          line-height: 0.9;
        }
        .timbre-finger em {
          color: rgba(245,240,230,0.82);
          font-family: var(--font-text);
          font-size: 11px;
          font-style: normal;
          text-transform: lowercase;
        }
        .timbre-current {
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
        .timbre-current span,
        .timbre-current em {
          color: rgba(245, 240, 230, 0.74);
          font-family: var(--font-text);
          font-size: 12px;
          font-style: normal;
          text-transform: lowercase;
        }
        .timbre-current strong {
          color: white;
          font-family: var(--font-serif);
          font-size: clamp(48px, 8.6vw, 80px);
          line-height: 0.85;
          font-weight: 300;
          text-shadow: 0 0 34px var(--timbre-color);
        }
        .timbre-hud {
          position: absolute;
          left: 0;
          right: 0;
          z-index: 6;
          pointer-events: none;
          padding: 0 clamp(12px, 3vw, 26px);
        }
        .timbre-hud-top {
          top: calc(58px + env(safe-area-inset-top, 0px));
          display: flex;
          align-items: center;
          gap: 14px;
          flex-wrap: wrap;
        }
        .timbre-home {
          pointer-events: auto;
          color: rgba(245,240,230,0.92);
          font-family: var(--font-serif);
          font-size: 19px;
          text-decoration: none;
          text-shadow: 0 1px 12px rgba(0,0,0,0.6);
        }
        .timbre-eyebrow {
          margin: 0;
          color: rgba(245, 240, 230, 0.62);
          font-family: var(--font-text);
          font-size: 11px;
          text-transform: lowercase;
          text-shadow: 0 1px 10px rgba(0,0,0,0.6);
        }
        .timbre-readout {
          margin-left: auto;
          display: flex;
          gap: 1px;
          border: 1px solid rgba(245, 240, 230, 0.16);
          background: rgba(245, 240, 230, 0.14);
        }
        .timbre-readout span {
          padding: 7px 10px;
          background: rgba(8, 10, 9, 0.66);
          backdrop-filter: blur(6px);
          color: rgba(245, 240, 230, 0.92);
          font-family: var(--font-numerals);
          font-size: 12px;
          white-space: nowrap;
          text-transform: lowercase;
        }
        .timbre-hud-bottom {
          bottom: calc(10px + env(safe-area-inset-bottom, 0px));
          display: grid;
          gap: 8px;
        }
        .timbre-actions {
          display: flex;
          gap: 1px;
          border: 1px solid rgba(245, 240, 230, 0.16);
          background: rgba(245, 240, 230, 0.14);
          pointer-events: auto;
          width: fit-content;
        }
        .timbre-actions button,
        .timbre-actions a {
          min-height: 42px;
          display: inline-flex;
          align-items: center;
          padding: 0 14px;
          border: 0;
          background: rgba(8,10,9,0.7);
          backdrop-filter: blur(6px);
          color: rgba(245, 240, 230, 0.88);
          font-family: var(--font-text);
          font-size: 12px;
          line-height: 1;
          text-transform: lowercase;
          text-decoration: none;
          cursor: pointer;
        }
        .timbre-actions button.timbre-on {
          color: #f5d65b;
          box-shadow: inset 0 0 18px rgba(245, 214, 91, 0.22);
        }
        .timbre-hint {
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
          .timbre-readout {
            margin-left: 0;
            width: 100%;
          }
          .timbre-readout span {
            flex: 1;
            text-align: center;
          }
          .timbre-readout-wide {
            display: none;
          }
          .timbre-current {
            top: 40%;
          }
          .timbre-hint {
            font-size: 10px;
          }
        }
      `,
        }}
      />
    </div>
  );
}
