"use client";

import { useEffect, useRef, useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { tapTrainTier } from "@/lib/gesture/core";
import { onVessel } from "@/lib/vessel";
import { useField } from "@/store/field";
import {
  createFrameGovernor,
  detailForTier,
  isEmbeddedFrame,
  onGalleryPause,
  onVisibility,
  resolveDpr,
} from "@/lib/room-runtime";

type TouchPoint = {
  x: number;
  y: number;
  force: number;
  born: number;
};

type FoldMemory = {
  x: number;
  y: number;
  density: number;
  fold: number;
  pull: number;
  bloom: number;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const clamp01 = (value: number) => clamp(value, 0, 1);

function fieldValue(
  x: number,
  y: number,
  width: number,
  height: number,
  time: number,
  fold: number,
  touch: TouchPoint | null,
  ox = 0,
  oy = 0,
) {
  const nx = (x / width - 0.5) * 2 + ox;
  const ny = (y / height - 0.5) * 2 + oy;
  const cellular = Math.sin((nx * nx - ny * ny) * fold + time * 0.74);
  const braid = Math.sin((nx * 3.3 + Math.sin(ny * fold + time)) * fold * 0.42 - time);
  const moire = Math.cos(Math.hypot(nx + 0.34, ny - 0.22) * fold * 2.4 - time * 1.35);
  const attractor = Math.sin((Math.sin(nx * fold + time * 0.4) + Math.cos(ny * fold - time * 0.35)) * 2.8);

  let pulse = 0;
  if (touch) {
    const dx = x - touch.x;
    const dy = y - touch.y;
    const distance = Math.hypot(dx, dy);
    pulse = Math.sin(distance * 0.045 - time * 5) * Math.exp(-distance * 0.006) * touch.force;
  }

  return cellular * 0.38 + braid * 0.28 + moire * 0.24 + attractor * 0.22 + pulse;
}

export default function BeyondWaveField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const pointerRef = useRef<TouchPoint | null>(null);
  const rafRef = useRef(0);
  const reduceMotionRef = useRef(false);
  const lastStirAt = useRef(0);
  const lastControlAt = useRef(0);
  const useFoldMemoryRef = useRef<() => void>(() => {});

  const [running, setRunning] = useState(true);
  const [density, setDensity] = useState(24);
  const [fold, setFold] = useState(9);
  const [pull, setPull] = useState(0.72);
  const [bloom, setBloom] = useState(0.58);
  const [readout, setReadout] = useState("touch the field");
  const [foldMemory, setFoldMemory] = useState<FoldMemory | null>(null);
  const [controlsOpen, setControlsOpen] = useState(false);

  const runningRef = useRef(running);
  const densityRef = useRef(density);
  const foldRef = useRef(fold);
  const pullRef = useRef(pull);
  const bloomRef = useRef(bloom);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  useEffect(() => {
    densityRef.current = density;
  }, [density]);

  useEffect(() => {
    foldRef.current = fold;
  }, [fold]);

  useEffect(() => {
    pullRef.current = pull;
  }, [pull]);

  useEffect(() => {
    bloomRef.current = bloom;
  }, [bloom]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduceMotionRef.current = mq.matches;
    const update = () => {
      reduceMotionRef.current = mq.matches;
    };
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const shell = shellRef.current;
    if (!canvas || !shell) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    let width = 0;
    let height = 0;
    let last = performance.now();
    let time = 0;

    // ————— performance contract (room-runtime) —————
    const gov = createFrameGovernor();
    let sleeping = false;
    let galleryPaused = false;

    // ————— the law layer (three fingers) and the frame (two) —————
    let windTX = 0, windTY = 0, windX = 0, windY = 0; // three-finger drag: weather nudges fold/pull
    let timeScale = 1, timeScaleTarget = 1;           // three-finger hold: time dilation
    let lens = 0, lensTarget = 0;                      // two-finger twist: vector field ↔ ribbons
    let season = 0, seasonTarget = 0;                  // three-finger twist: the palette's slow drift
    let panX = 0, panY = 0, panTX = 0, panTY = 0;       // two-finger drag: pan the sampled frame
    let tiltOX = 0, tiltOY = 0;                         // vessel tilt: gravity leans the frame
    let night = 0, nightTarget = 0;                     // vessel flip
    let lastInteractionAt = performance.now();
    let holdDeepenAt = -1e9;
    let entrainBpm = 0, entrainUntil = 0, entrainLastBeat = -1; // rhythm: the field's clock entrained to the hand

    // background gradient's shape only depends on `bloom`, which changes
    // rarely — cache it by a coarse bucket instead of allocating one every
    // frame (room-runtime contract forbids per-frame createRadialGradient).
    let bgGradient: CanvasGradient | null = null;
    let bgBucket = -1;

    const resize = () => {
      const rect = shell.getBoundingClientRect();
      const ratio = resolveDpr(gov.tier(), {
        embedded: isEmbeddedFrame(),
        reducedMotion: reduceMotionRef.current,
      });
      width = Math.max(320, Math.floor(rect.width));
      height = Math.max(520, Math.floor(rect.height));
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      bgBucket = -1; // geometry changed — the cached gradient's coordinates are stale
    };

    const draw = (now: number) => {
      rafRef.current = requestAnimationFrame(draw);
      const tier = gov.beginFrame(now);
      if (sleeping || galleryPaused) return; // no draw while hidden or embedded-paused
      const detail = detailForTier(tier);
      const delta = Math.min(48, now - last);
      last = now;
      const dt = delta / 1000;

      windX += (windTX - windX) * Math.min(1, dt * 3);
      windY += (windTY - windY) * Math.min(1, dt * 3);
      windTX *= Math.exp(-dt * 0.6); // the weather relaxes once the hand lets go
      windTY *= Math.exp(-dt * 0.6);
      timeScale += (timeScaleTarget - timeScale) * Math.min(1, dt * 5);
      lens += (lensTarget - lens) * Math.min(1, dt * 4);
      season += (seasonTarget - season) * Math.min(1, dt * 2);
      panX += (panTX - panX) * Math.min(1, dt * 6);
      panY += (panTY - panY) * Math.min(1, dt * 6);
      night += (nightTarget - night) * Math.min(1, dt * 2.4);

      if (runningRef.current && !reduceMotionRef.current) {
        time += delta * 0.001 * timeScale;
      }
      // an entrained clock: while the hand's tempo holds, the field pulses
      // on the beat, alternating between two zones like a slow tide
      if (entrainBpm > 0 && now < entrainUntil) {
        const beatIdx = Math.floor(now / (60000 / entrainBpm));
        if (beatIdx !== entrainLastBeat) {
          entrainLastBeat = beatIdx;
          pointerRef.current = {
            x: width * (beatIdx % 2 ? 0.62 : 0.38),
            y: height * 0.5,
            force: 0.9,
            born: now,
          };
          try { getFieldAudio().playNote(50 + (beatIdx % 2) * 7, 90); } catch { /* noop */ }
        }
      }
      // weather leans the field's own parameters, continuously
      if (windX !== 0 || windY !== 0) {
        foldRef.current = clamp(foldRef.current + windX * dt * 3, 4, 16);
        pullRef.current = clamp(pullRef.current + windY * dt * 0.6, 0.1, 1.6);
      }

      context.fillStyle = "rgba(7, 12, 20, 0.24)";
      context.fillRect(0, 0, width, height);

      const bloomBucket = Math.round(bloomRef.current * 20);
      if (!bgGradient || bloomBucket !== bgBucket) {
        bgBucket = bloomBucket;
        bgGradient = context.createRadialGradient(width * 0.48, height * 0.4, 20, width * 0.5, height * 0.5, Math.max(width, height));
        bgGradient.addColorStop(0, `rgba(243, 210, 126, ${0.08 + bloomRef.current * 0.08})`);
        bgGradient.addColorStop(0.45, "rgba(69, 188, 175, 0.05)");
        bgGradient.addColorStop(1, "rgba(7, 12, 20, 0.42)");
      }
      context.fillStyle = bgGradient;
      context.fillRect(0, 0, width, height);
      // the season's veil — a slow drift toward the palette's far register
      if (season > 0.02) {
        context.fillStyle = `rgba(${season > 0 ? "120, 90, 210" : "210, 120, 70"}, ${Math.abs(season) * 0.05})`;
        context.fillRect(0, 0, width, height);
      }

      const step = densityRef.current / Math.max(0.4, detail.samples);
      const foldNow = foldRef.current;
      const pullNow = pullRef.current;
      const bloomNow = bloomRef.current;
      const touch = pointerRef.current;
      const ox = panX + tiltOX;
      const oy = panY + tiltOY;

      if (touch) {
        touch.force *= 0.985;
        if (touch.force < 0.04) pointerRef.current = null;
      }

      context.lineCap = "round";
      for (let y = step * 0.8; y < height; y += step) {
        for (let x = step * 0.8; x < width; x += step) {
          const a = fieldValue(x, y, width, height, time, foldNow, touch, ox, oy);
          const b = fieldValue(x + 8, y + 6, width, height, time + 0.18, foldNow, touch, ox, oy);
          const angle = Math.atan2(b - a, 0.22) + a * pullNow;
          const length = step * (0.26 + Math.abs(a) * 0.48);
          const hue = 166 + a * 62 + Math.sin(time + x * 0.006) * 22 + season * 40;
          const alpha = (0.18 + Math.abs(a) * (0.22 + bloomNow * 0.22)) * (1 - lens * 0.7);

          context.strokeStyle = `hsla(${hue}, 78%, ${58 + Math.abs(b) * 18}%, ${alpha})`;
          context.lineWidth = 0.8 + Math.abs(a) * 1.7;
          context.beginPath();
          context.moveTo(x - Math.cos(angle) * length, y - Math.sin(angle) * length);
          context.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
          context.stroke();
        }
      }

      const ribbons = 5;
      const ribbonPoints = Math.max(40, Math.round(150 * detail.samples));
      for (let r = 0; r < ribbons; r += 1) {
        context.beginPath();
        for (let i = 0; i < ribbonPoints; i += 1) {
          const u = i / (ribbonPoints - 1);
          const baseX = u * width;
          const drift = Math.sin(time * (0.45 + r * 0.09) + u * foldNow * 2.2 + r) * height * 0.11;
          const v = fieldValue(baseX, height * (0.24 + r * 0.12) + drift, width, height, time, foldNow, touch, ox, oy);
          const px = baseX + Math.sin(v * 2 + time + r) * 18;
          const py = height * (0.2 + r * 0.14) + drift + v * 54;
          if (i === 0) context.moveTo(px, py);
          else context.lineTo(px, py);
        }
        context.strokeStyle = `rgba(${r % 2 ? "245, 188, 104" : "105, 214, 205"}, ${(0.2 + bloomNow * 0.18) * (0.4 + lens * 0.6)})`;
        context.lineWidth = 1.2 + r * 0.22;
        context.stroke();
      }

      if (touch) {
        const age = Math.min(1, (now - touch.born) / 1100);
        const radius = 42 + age * 190 * touch.force;
        context.strokeStyle = `rgba(244, 238, 222, ${0.26 * touch.force})`;
        context.lineWidth = 1.5;
        context.beginPath();
        context.arc(touch.x, touch.y, radius, 0, Math.PI * 2);
        context.stroke();
      }

      // glimmer (grammar §6): after ~20s idle, a faint ring where a dwell
      // would land — physical, never text
      if (now - lastInteractionAt > 20000 && !reduceMotionRef.current) {
        const pulse = 0.5 + Math.sin(now / 480) * 0.5;
        context.strokeStyle = `rgba(244, 238, 222, ${0.05 + pulse * 0.06})`;
        context.lineWidth = 1;
        context.beginPath();
        context.arc(width * 0.5, height * 0.5, 24 + pulse * 14, 0, Math.PI * 2);
        context.stroke();
      }

      // flip face-down: the room sleeps and the light goes out of it
      if (night > 0.004) {
        context.fillStyle = `rgba(2, 2, 6, ${(night * 0.9).toFixed(3)})`;
        context.fillRect(0, 0, width, height);
      }
    };

    resize();
    window.addEventListener("resize", resize);
    rafRef.current = requestAnimationFrame(draw);
    const offVis = onVisibility((hiddenNow) => {
      sleeping = hiddenNow;
      if (!hiddenNow && !galleryPaused && !rafRef.current) rafRef.current = requestAnimationFrame(draw);
    });
    const offGallery = onGalleryPause((pausedNow) => {
      galleryPaused = pausedNow;
      if (!pausedNow && !sleeping && !rafRef.current) rafRef.current = requestAnimationFrame(draw);
    });

    // tier 5: the room's biggest, rarest event — the fold cascade. A rapid
    // sequence of deepening folds, each ringing the lattice from the same
    // point, fixed steps on a schedule (never Math.random) so the same tap
    // always plays the same cascade; it resolves into the bloom.
    let foldCascadeTimers: number[] = [];
    const foldCascade = (screenX: number, screenY: number, intensity: number) => {
      for (const t of foldCascadeTimers) window.clearTimeout(t);
      foldCascadeTimers = [];
      const rect = canvas.getBoundingClientRect();
      const px = clamp(screenX - rect.left, 0, rect.width);
      const py = clamp(screenY - rect.top, 0, rect.height);
      const steps = 6;
      for (let i = 1; i <= steps; i += 1) {
        const id = window.setTimeout(() => {
          const nextFold = clamp(foldRef.current + 1.1 + intensity * 0.4, 4, 16);
          setFold(Number(nextFold.toFixed(1)));
          pointerRef.current = { x: px, y: py, force: 1.3 + i * 0.1, born: performance.now() };
          try { getFieldAudio().playNote(50 + i * 2, 110); } catch { /* noop */ }
          try { haptics.ripple(0.3 + i * 0.05); } catch { /* noop */ }
        }, i * 180);
        foldCascadeTimers.push(id);
      }
      const id = window.setTimeout(() => {
        setBloom(clamp01(bloomRef.current + 0.32));
        try { getFieldAudio().bell(); } catch { /* noop */ }
        try { haptics.storm(); } catch { /* noop */ }
        useField.getState().recordTape("sigil", 1, "beyond/fold-cascade-complete");
      }, steps * 180);
      foldCascadeTimers.push(id);
    };

    // ————— the grammar (src/lib/gesture) — replaces raw pointer wiring —————
    const detachGestures = attachGestures(
      canvas,
      {
        tap: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 2) {
            // step back: a raised lens lowers first, then a panned frame
            // comes home — the frame retreats one step, never two at once
            if (lensTarget > 0.01) {
              lensTarget = 0;
              try { haptics.lens(); } catch { /* noop */ }
              try { getFieldAudio().playNote(48, 160); } catch { /* noop */ }
            } else if (Math.abs(panTX) > 0.01 || Math.abs(panTY) > 0.01) {
              panTX = 0;
              panTY = 0;
              try { haptics.tap(); } catch { /* noop */ }
            } else {
              // already home: the field breathes out once, softly
              pointerRef.current = { x: width / 2, y: height / 2, force: 0.5, born: performance.now() };
              try { getFieldAudio().playNote(41, 180); } catch { /* noop */ }
              try { haptics.tap(); } catch { /* noop */ }
            }
            return;
          }
          if (e.fingers === 3) {
            // tutti: the whole field answers once, as loud as the chord landed
            pointerRef.current = { x: width / 2, y: height / 2, force: 1.2 + e.intensity * 0.8, born: performance.now() };
            try { getFieldAudio().chime(); } catch { /* noop */ }
            try { haptics.ripple(0.35 + e.intensity * 0.3); } catch { /* noop */ }
            return;
          }
          if (e.fingers !== 1) return;
          stir(e.x, e.y, e.intensity + (e.count - 1) * 0.08);
          // train tiers (1 / 3 / 5 / n from gesture/core): rapid taps fold,
          // bloom, then flood the interference
          const trainTier = tapTrainTier(e.count);
          if (trainTier === 3 && e.count === 3) {
            // three taps snap the fold deeper — the whole lattice tightens
            const nextFold = clamp(foldRef.current + 2.2, 4, 16);
            setFold(Number(nextFold.toFixed(1)));
            try { getFieldAudio().playNote(52, 130); } catch { /* noop */ }
            try { getFieldAudio().playNote(59, 190); } catch { /* noop */ }
            try { haptics.ripple(0.44); } catch { /* noop */ }
            useField.getState().recordTape("sigil", 0.5, "beyond/train-fold");
          } else if (trainTier === 5) {
            // the room's biggest, rarest event: the fold cascade
            foldCascade(e.x, e.y, e.intensity);
          } else if (trainTier === "n") {
            // seven and beyond: the crescendo — the pull climbs and each
            // further tap sends a stronger ring through the lattice
            setPull(Number(clamp(pullRef.current + 0.1, 0.1, 1.6).toFixed(2)));
            const rect = canvas.getBoundingClientRect();
            pointerRef.current = {
              x: clamp(e.x - rect.left, 0, rect.width),
              y: clamp(e.y - rect.top, 0, rect.height),
              force: clamp(1.2 + (e.count - 6) * 0.2, 1.2, 2),
              born: performance.now(),
            };
            try { getFieldAudio().playNote(38 + (e.count - 7) * 2, 200); } catch { /* noop */ }
            try { (e.count === 7 ? haptics.storm : () => haptics.ripple(0.55))(); } catch { /* noop */ }
            useField.getState().recordTape("sigil", clamp(0.6 + (e.count - 7) * 0.08, 0.6, 1), "beyond/train-crescendo");
          }
        },
        drag: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 3) {
            if (e.phase === "end") return;
            windTX = clamp(e.vx * 0.6, -1, 1);
            windTY = clamp(e.vy * 0.6, -1, 1);
            return;
          }
          if (e.fingers !== 1 || e.phase === "end") return;
          stir(e.x, e.y, 1);
        },
        pan2: (e) => {
          lastInteractionAt = performance.now();
          // two fingers pan the sampled frame — the field drifts beneath it
          panTX = clamp(panTX - e.dx / Math.max(1, width), -0.9, 0.9);
          panTY = clamp(panTY - e.dy / Math.max(1, height), -0.9, 0.9);
        },
        twist: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 3) {
            // three fingers turn the season: the palette's own slow weather
            seasonTarget = clamp(seasonTarget + e.angle / 2.4, -1, 1);
            return;
          }
          // two fingers rotate the lens: the vector field gives way to ribbons
          lensTarget = clamp01(lensTarget + e.angle / 1.8);
          if (e.phase === "end") {
            const snapped = lensTarget > 0.5 ? 1 : 0;
            lensTarget = snapped;
            try { haptics.lens(); } catch { /* noop */ }
          }
        },
        scrub: (e) => {
          lastInteractionAt = performance.now();
          // a faster or wider circle stirs harder, and the circling's
          // direction leans the fold itself — with the clock or against it
          stir(e.cx, e.cy, 1.2 + Math.min(1, Math.abs(e.winding) * 0.3 + Math.abs(e.angularVelocity) * 60));
          foldRef.current = clamp(foldRef.current + Math.sign(e.winding) * 0.18, 4, 16);
        },
        flick: (e) => {
          lastInteractionAt = performance.now();
          const canvasEl = canvasRef.current;
          if (!canvasEl) return;
          const rect = canvasEl.getBoundingClientRect();
          const x = clamp(e.x - rect.left, 0, rect.width);
          const y = clamp(e.y - rect.top, 0, rect.height);
          pointerRef.current = { x, y, force: clamp(0.6 + e.speed / 1400, 0.6, 2), born: performance.now() };
          try { getFieldAudio().playNote(50 + Math.round(Math.min(1, e.speed / 1200) * 20), 140); } catch { /* noop */ }
          try { haptics.chop(); } catch { /* noop */ }
        },
        hold: (e) => {
          lastInteractionAt = performance.now();
          if (e.fingers === 3) {
            // three fingers hold the law: time dilates while the hand stays,
            // and keeps deepening toward stillness the longer it is held
            if (e.phase === "enter") { timeScaleTarget = 0.25; try { haptics.tap(); } catch { /* noop */ } }
            if (e.phase === "tick") timeScaleTarget = Math.max(0.08, 0.25 - 0.17 * Math.min(1, e.elapsed / 4000));
            if (e.phase === "release") timeScaleTarget = 1;
            return;
          }
          if (e.fingers !== 1) return;
          if (e.phase === "enter") { holdDeepenAt = performance.now(); return; }
          if (e.phase === "release") return;
          const canvasEl = canvasRef.current;
          if (!canvasEl) return;
          const rect = canvasEl.getBoundingClientRect();
          const x = clamp(e.x - rect.left, 0, rect.width);
          const y = clamp(e.y - rect.top, 0, rect.height);
          // dwell tier: the fold gathers under the finger, deepening with time
          if (e.tier >= 2) {
            pointerRef.current = { x, y, force: clamp01(0.4 + e.elapsed / 2400), born: pointerRef.current?.born ?? performance.now() };
            const now = performance.now();
            if (now - holdDeepenAt > 260) {
              holdDeepenAt = now;
              try { getFieldAudio().playNote(44 + Math.round((e.elapsed / 2600) * 20), 90); } catch { /* noop */ }
              try { haptics.tap(); } catch { /* noop */ }
            }
          }
          // ceremony: this room's one solemn act — keep the fold, or (if one
          // is already kept) let it speak again. Touch-reachable now, not
          // only the panel button.
          if (e.tier >= 3 && holdDeepenAt > -1e8) {
            holdDeepenAt = -1e8; // fire once per hold
            useFoldMemoryRef.current();
          }
        },
        rhythm: (e) => {
          // a steady tapped pulse: the field's clock locks to your tempo and
          // pulses on the beat for a while (visible in the draw loop above)
          if (e.stability <= 0.7) return;
          entrainBpm = Math.max(40, Math.min(150, e.bpm));
          entrainUntil = performance.now() + 9000;
          try { getFieldAudio().chime(); } catch { /* noop */ }
          try { haptics.tap(); } catch { /* noop */ }
          useField.getState().recordTape("sigil", 0.45, "beyond/entrain");
        },
      },
      { wheelZoom: false },
    );

    // ————— the vessel: the device is this field's body —————
    let lastTiltNoteAt = 0;
    const detachVessel = onVessel({
      tilt: ({ beta, gamma }) => {
        if (reduceMotionRef.current) { tiltOX = 0; tiltOY = 0; return; }
        tiltOX = clamp(gamma / 40, -1, 1) * 0.5;
        tiltOY = clamp((beta - 35) / 40, -1, 1) * 0.5;
        const now = performance.now();
        const mag = Math.hypot(tiltOX, tiltOY);
        if (mag > 0.3 && now - lastTiltNoteAt > 900) {
          lastTiltNoteAt = now;
          try { getFieldAudio().playNote(40 + Math.round(mag * 8), 140); } catch { /* noop */ }
        }
      },
      shake: ({ intensity }) => {
        if (reduceMotionRef.current) return;
        lastInteractionAt = performance.now();
        // deterministic scatter — seeded by the clock, never Math.random
        const seed = performance.now() * 0.0137;
        pointerRef.current = {
          x: width * (0.3 + (0.5 + Math.sin(seed) * 0.5) * 0.4),
          y: height * (0.3 + (0.5 + Math.cos(seed * 1.7) * 0.5) * 0.4),
          force: clamp01(1 + intensity),
          born: performance.now(),
        };
        try { getFieldAudio().thud(); } catch { /* noop */ }
        try { (intensity > 0.7 ? haptics.storm : haptics.chop)(); } catch { /* noop */ }
      },
      knock: ({ intensity }) => {
        lastInteractionAt = performance.now();
        pointerRef.current = { x: width / 2, y: height / 2, force: clamp01(0.9 + intensity * 0.6), born: performance.now() };
        try { getFieldAudio().playNote(38 + Math.round(intensity * 8), 260); } catch { /* noop */ }
        try { haptics.roll(); } catch { /* noop */ }
      },
      flip: ({ faceDown }) => {
        nightTarget = faceDown ? 1 : 0;
        try { getFieldAudio().playNote(faceDown ? 24 : 48, 400); } catch { /* noop */ }
        try { haptics.roll(); } catch { /* noop */ }
      },
    });

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(rafRef.current);
      offVis();
      offGallery();
      detachGestures();
      detachVessel();
      for (const t of foldCascadeTimers) window.clearTimeout(t);
    };
  }, []);

  const stir = (clientX: number, clientY: number, intensity = 1) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = clamp(clientX - rect.left, 0, rect.width);
    const y = clamp(clientY - rect.top, 0, rect.height);
    pointerRef.current = { x, y, force: 0.8 + clamp(intensity, 0, 2) * 0.55, born: performance.now() };
    setFold(Number((6 + (x / rect.width) * 9).toFixed(1)));
    setPull(Number((0.22 + (1 - y / rect.height) * 1.2).toFixed(2)));
    setReadout(`${Math.round((x / rect.width) * 100)} / ${Math.round((1 - y / rect.height) * 100)}`);

    const now = performance.now();
    if (now - lastStirAt.current < 95) return;
    lastStirAt.current = now;
    const xPct = x / rect.width;
    const yPct = y / rect.height;
    try { getFieldAudio().playNote(44 + Math.round((1 - yPct) * 22) + Math.round(xPct * 7), 90); } catch { /* noop */ }
    useField.getState().recordTape("ripple", 0.34 + (1 - yPct) * 0.48, "beyond/stir");
  };

  const markControl = (meta: string, normalized: number) => {
    const now = performance.now();
    if (now - lastControlAt.current < 135) return;
    lastControlAt.current = now;
    const value = clamp(normalized, 0, 1);
    try { getFieldAudio().playNote(42 + Math.round(value * 28), 95); } catch { /* noop */ }
    useField.getState().recordTape("ripple", 0.28 + value * 0.5, `beyond/${meta}`);
  };

  const toggleRunning = () => {
    setRunning((value) => {
      const next = !value;
      try {
        if (next) getFieldAudio().chime();
        else getFieldAudio().thud();
      } catch { /* noop */ }
      useField.getState().recordTape("sigil", next ? 0.64 : 0.42, next ? "beyond/move" : "beyond/pause");
      return next;
    });
  };

  const toggleControls = () => {
    setControlsOpen((value) => {
      const next = !value;
      try {
        if (next) getFieldAudio().chime();
        else getFieldAudio().thud();
      } catch { /* noop */ }
      useField.getState().recordTape("sigil", next ? 0.58 : 0.34, next ? "beyond/open-tune" : "beyond/close-tune");
      return next;
    });
  };

  const useFoldMemory = () => {
    if (!foldMemory) {
      const canvas = canvasRef.current;
      const rect = canvas?.getBoundingClientRect();
      const touch = pointerRef.current;
      setFoldMemory({
        x: rect && touch ? clamp(touch.x / rect.width, 0, 1) : 0.52,
        y: rect && touch ? clamp(touch.y / rect.height, 0, 1) : 0.44,
        density,
        fold,
        pull,
        bloom,
      });
      setReadout("fold kept");
      try { getFieldAudio().bell(); } catch { /* noop */ }
      useField.getState().recordTape("sigil", 0.72, "beyond/keep-fold");
      return;
    }

    setDensity(foldMemory.density);
    setFold(foldMemory.fold);
    setPull(foldMemory.pull);
    setBloom(foldMemory.bloom);
    const canvas = canvasRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      pointerRef.current = {
        x: foldMemory.x * rect.width,
        y: foldMemory.y * rect.height,
        force: 1.55,
        born: performance.now(),
      };
    }
    setReadout("fold replay");
    try {
      getFieldAudio().playNote(64, 120);
      window.setTimeout(() => getFieldAudio().playNote(71, 170), 110);
    } catch { /* noop */ }
    useField.getState().recordTape("sigil", 0.86, "beyond/replay-fold");
  };
  useFoldMemoryRef.current = useFoldMemory;

  return (
    <div className="beyond-page" data-touch-surface="true" data-pretext-ignore="true">
      <section ref={shellRef} className="beyond-field" aria-label="novel wave field">
        <canvas ref={canvasRef} className="beyond-canvas" aria-hidden="true" />

        <div className="beyond-copy">
          <p className="t-eyebrow beyond-kicker">novel wave / beyond all this</p>
          <h1>Not a line. Not a circle. A living interference.</h1>
        </div>

        <div className="beyond-panel" aria-label="field controls" data-expanded={controlsOpen ? "true" : "false"}>
          <div className="beyond-actions">
            <button className="beyond-run-button" type="button" onClick={toggleRunning} aria-pressed={running}>
              {running ? "pause" : "move"}
            </button>
            <button className="beyond-memory-button" type="button" onClick={useFoldMemory} aria-pressed={Boolean(foldMemory)}>
              {foldMemory ? "replay fold" : "keep fold"}
            </button>
            <button className="beyond-tune-toggle" type="button" onClick={toggleControls} aria-expanded={controlsOpen}>
              {controlsOpen ? "hide tune" : "tune"}
            </button>
            <output className="beyond-readout" aria-live="polite">{readout}</output>
          </div>

          <div className="beyond-sliders">
            <label>
              <span>cell size</span>
              <input
                type="range"
                min="16"
                max="36"
                step="1"
                value={density}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setDensity(value);
                  markControl("density", (value - 16) / 20);
                }}
              />
              <strong>{density}</strong>
            </label>
            <label>
              <span>fold</span>
              <input
                type="range"
                min="4"
                max="16"
                step="0.1"
                value={fold}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setFold(value);
                  markControl("fold", (value - 4) / 12);
                }}
              />
              <strong>{fold.toFixed(1)}</strong>
            </label>
            <label>
              <span>pull</span>
              <input
                type="range"
                min="0.1"
                max="1.6"
                step="0.01"
                value={pull}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setPull(value);
                  markControl("pull", (value - 0.1) / 1.5);
                }}
              />
              <strong>{pull.toFixed(2)}</strong>
            </label>
            <label>
              <span>bloom</span>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.01"
                value={bloom}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setBloom(value);
                  markControl("bloom", (value - 0.1) / 0.9);
                }}
              />
              <strong>{bloom.toFixed(2)}</strong>
            </label>
          </div>
        </div>
      </section>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .beyond-page {
          min-height: 100vh;
          background:
            radial-gradient(circle at 18% 14%, rgba(244, 188, 93, 0.16), transparent 28%),
            radial-gradient(circle at 82% 22%, rgba(82, 210, 196, 0.14), transparent 30%),
            #070c14;
          color: rgba(244, 238, 222, 0.94);
          overflow: hidden;
        }

        .beyond-field {
          position: relative;
          min-height: calc(100svh - 56px);
          isolation: isolate;
          overflow: hidden;
        }

        .beyond-canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          cursor: crosshair;
          touch-action: none;
          z-index: 0;
        }

        .beyond-copy {
          position: relative;
          z-index: 1;
          width: min(780px, calc(100vw - var(--pad-x) * 2));
          padding: clamp(42px, 8vh, 86px) var(--pad-x) 0;
          pointer-events: none;
        }

        .beyond-kicker {
          color: rgba(244, 238, 222, 0.62);
          letter-spacing: 0;
          margin-bottom: 12px;
        }

        .beyond-copy h1 {
          margin: 0;
          font-family: var(--font-serif);
          font-size: clamp(44px, 8vw, 104px);
          line-height: 0.94;
          font-weight: 300;
          letter-spacing: 0;
          text-wrap: balance;
          text-shadow: 0 18px 54px rgba(7, 12, 20, 0.72);
        }

        .beyond-panel {
          position: absolute;
          z-index: 2;
          left: var(--pad-x);
          right: calc(var(--pad-x) + 278px);
          bottom: calc(58px + env(safe-area-inset-bottom, 0px));
          display: grid;
          grid-template-columns: minmax(190px, 0.9fr) minmax(0, 4fr);
          gap: 8px;
          align-items: stretch;
        }

        .beyond-sliders {
          display: grid;
          grid-template-columns: repeat(4, minmax(130px, 1fr));
          gap: 8px;
          min-width: 0;
        }

        .beyond-actions,
        .beyond-panel label {
          min-height: 58px;
          border: 1px solid rgba(244, 238, 222, 0.18);
          border-radius: 8px;
          background: rgba(7, 12, 20, 0.62);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          box-shadow: 0 18px 48px rgba(0, 0, 0, 0.22);
        }

        .beyond-actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          overflow: hidden;
        }

        .beyond-actions button {
          border: 0;
          border-bottom: 1px solid rgba(244, 238, 222, 0.12);
          border-right: 1px solid rgba(244, 238, 222, 0.12);
          background: rgba(244, 238, 222, 0.08);
          color: rgba(244, 238, 222, 0.95);
          min-height: 34px;
          cursor: pointer;
          font-family: var(--font-text);
          font-size: 12px;
          letter-spacing: 0;
          text-transform: lowercase;
          white-space: nowrap;
        }

        .beyond-actions button:last-of-type {
          border-right: 0;
        }

        .beyond-actions button[aria-pressed="false"] {
          color: #f4bc5d;
        }

        .beyond-actions button[aria-pressed="true"]:last-of-type {
          color: #62d6ca;
        }

        .beyond-memory-button[aria-pressed="true"] {
          color: #62d6ca;
        }

        .beyond-tune-toggle {
          display: none;
        }

        .beyond-readout {
          grid-column: 1 / -1;
          display: flex;
          align-items: center;
          padding: 0 12px;
          color: rgba(244, 238, 222, 0.68);
          font-family: var(--font-numerals);
          font-size: 13px;
          white-space: nowrap;
        }

        .beyond-panel label {
          display: grid;
          grid-template-columns: 1fr auto;
          grid-template-rows: auto auto;
          gap: 4px 12px;
          padding: 10px 12px 9px;
          font-family: var(--font-text);
          font-size: 12px;
          letter-spacing: 0;
          text-transform: lowercase;
        }

        .beyond-panel label span {
          color: rgba(244, 238, 222, 0.66);
        }

        .beyond-panel label strong {
          grid-column: 2;
          grid-row: 1;
          color: rgba(244, 238, 222, 0.95);
          font-family: var(--font-numerals);
          font-size: 13px;
          font-weight: 500;
        }

        .beyond-panel input {
          grid-column: 1 / -1;
          grid-row: 2;
          width: 100%;
          accent-color: #62d6ca;
        }

        @media (max-width: 920px) {
          .beyond-page ~ .oda-field-watch {
            display: none !important;
          }

          .beyond-field {
            min-height: calc(100svh - 56px);
          }

          .beyond-copy {
            padding-top: 34px;
          }

          .beyond-panel {
            right: var(--pad-x);
            bottom: calc(104px + env(safe-area-inset-bottom, 0px));
            grid-template-columns: minmax(0, 1fr);
            grid-auto-flow: row;
            overflow: visible;
          }

          .beyond-actions,
          .beyond-sliders {
            grid-column: 1 / -1;
          }

          .beyond-sliders {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 7px;
          }
        }

        @media (max-width: 560px) {
          .beyond-copy h1 {
            font-size: clamp(38px, 14vw, 58px);
          }

          .beyond-copy {
            width: auto;
            padding-right: 18px;
          }

          .beyond-panel {
            left: 14px;
            right: 14px;
            bottom: calc(100px + env(safe-area-inset-bottom, 0px));
            gap: 7px;
          }

          .beyond-sliders {
            display: none;
          }

          .beyond-panel[data-expanded="true"] .beyond-sliders {
            display: flex;
            gap: 7px;
            overflow-x: auto;
            overflow-y: hidden;
            overscroll-behavior-x: contain;
            scroll-snap-type: x proximity;
            -webkit-overflow-scrolling: touch;
            padding-bottom: 2px;
          }

          .beyond-panel[data-expanded="true"] .beyond-sliders label {
            display: grid;
            flex: 0 0 calc((100% - 14px) / 2.15);
            min-height: 58px;
            height: 58px;
            min-width: 0;
            scroll-snap-align: start;
            grid-template-rows: auto 18px;
            gap: 2px 8px;
            padding: 7px 9px;
          }

          .beyond-panel[data-expanded="true"] .beyond-sliders input {
            height: 18px;
          }

          .beyond-actions {
            grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(74px, 0.72fr);
          }

          .beyond-actions,
          .beyond-panel label {
            min-height: 54px;
          }

          .beyond-actions button {
            min-width: 0;
            padding: 0 8px;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .beyond-tune-toggle {
            display: block;
          }

          .beyond-panel label {
            padding: 8px 10px 7px;
          }

          .beyond-readout {
            min-height: 26px;
            font-size: 12px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .beyond-canvas {
            cursor: default;
          }
        }
      `,
        }}
      />
    </div>
  );
}
