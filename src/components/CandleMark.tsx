"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { getFieldAudio } from "@/lib/audio";
import { attachGestures, enableBreath } from "@/lib/gesture";
import { THRESHOLDS, holdTier, tapTrain } from "@/lib/gesture/core";
import { onVessel, requestVessel } from "@/lib/vessel";
import { bloom, roll } from "@/lib/haptics";
import { getTurbulence } from "@/lib/turbulence";
import {
  holdAction,
  loadCandleState,
  saveCandleState,
  shouldInvite,
  type HoldAction,
} from "@/lib/candle";

/**
 * The literal candle. Lives in a fixed corner on every page so the
 * brand's central image isn't only a metaphor in the title — and it is
 * the site's one invitation surface and its most intimate mechanic.
 *
 * Behaviors:
 *  - Leans toward the cursor when the pointer is within ~400px of the
 *    flame; leans toward a holding finger; leans with real gravity once
 *    the vessel is granted. Smoothed via lerp on requestAnimationFrame.
 *  - Flame brightness/scale pulses with the audio swell LFO (~0.14 Hz)
 *    and is faintly agitated by the shared turbulence axis.
 *  - Press-and-hold (dwell tier) is the invitation: the vessel (device
 *    motion) is requested; holding on to ceremony tier invites breath
 *    (microphone). Declines are silent — the candle keeps burning, and
 *    nothing asks twice in a session (lib/candle's ledger).
 *  - Blow (granted breath), shake (granted vessel), flip face-down, or a
 *    quick triple-tap: the candle goes out — flame collapses to an ember
 *    and the whole site dims under a translucent ink veil (fixed overlay
 *    below the candle's z-index, pointer-events none; rooms stay fully
 *    playable). Lit/unlit persists in objetdart:candle:v1.
 *  - Press the unlit wick (dwell) to relight: spark + chime + a bloom in
 *    the hand, and the veil lifts.
 *  - Keyboard: the hit surface is focusable; Enter/Space held climbs the
 *    same dwell/ceremony ladder, quick triple-press snuffs.
 *  - prefers-reduced-motion: lean/flicker/pulse stilled; snuff and
 *    relight become instant crossfades (CSS class, no transitions).
 */
export default function CandleMark() {
  const pathname = usePathname() ?? "/";
  const hide = pathname.startsWith("/atlas/");
  // refs to the elements we drive each frame
  const wrapRef = useRef<HTMLDivElement>(null);
  const hitRef = useRef<HTMLDivElement>(null);
  const flameRef = useRef<SVGGElement>(null);
  const haloRef = useRef<SVGGElement>(null);
  // shared with the rAF loop: where a holding finger is, how the device tilts
  const leanRef = useRef<{ holdX: number | null; tilt: number }>({ holdX: null, tilt: 0 });
  const litRef = useRef(true);
  const [lit, setLit] = useState(true);
  const [reduce, setReduce] = useState(false);

  // Hydrate the remembered night + reduced-motion preference.
  useEffect(() => {
    const s = loadCandleState();
    litRef.current = s === "lit";
    setLit(s === "lit");
    try {
      setReduce(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch {
      /* noop */
    }
  }, []);

  // Every route inherits the night: expose it as a CSS variable too.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty("--oda-night", lit ? "0" : "1");
  }, [lit]);

  // ── the candle as instrument: gestures, senses, keyboard ──
  useEffect(() => {
    if (hide) return;
    const hit = hitRef.current;
    if (!hit) return;
    const lean = leanRef.current;

    const doSnuff = () => {
      if (!litRef.current) return;
      litRef.current = false;
      setLit(false);
      saveCandleState("snuffed");
      try {
        getFieldAudio().thud();
      } catch {
        /* noop */
      }
      roll();
    };

    const doRelight = () => {
      if (litRef.current) return;
      litRef.current = true;
      setLit(true);
      saveCandleState("lit");
      try {
        const a = getFieldAudio();
        a.spark();
        a.chime();
      } catch {
        /* noop */
      }
      bloom();
    };

    // — breath: armed only by the ceremony hold; a sustained low blow snuffs —
    let breathStop: (() => void) | null = null;
    let breathHeat = 0;
    let lastBreathAt = 0;
    const onBreathEvt = ({ strength }: { strength: number }) => {
      const now = performance.now();
      if (now - lastBreathAt > 400) breathHeat = 0;
      lastBreathAt = now;
      if (strength > 0.45) breathHeat += strength;
      if (breathHeat > 7 && litRef.current) {
        breathHeat = 0;
        doSnuff();
      }
    };
    const armBreath = async () => {
      if (breathStop) return;
      const stop = await enableBreath({ breath: onBreathEvt });
      if (stop) breathStop = stop;
    };

    // — the vessel: shake snuffs, flip face-down is night, tilt is gravity —
    const detachVessel = onVessel({
      shake: () => doSnuff(),
      flip: ({ faceDown }) => {
        if (faceDown) doSnuff();
      },
      tilt: ({ gamma }) => {
        lean.tilt = Math.max(-1, Math.min(1, gamma / 45));
      },
    });

    const act = (action: HoldAction) => {
      if (action === "relight") doRelight();
      else if (action === "invite-vessel") {
        if (shouldInvite("vessel")) void requestVessel();
      } else if (action === "invite-breath") {
        if (shouldInvite("breath")) void armBreath();
      }
    };

    // — touch/mouse: the gesture engine on the candle element only —
    let prevTier = 0;
    const detachGestures = attachGestures(
      hit,
      {
        hold: (e) => {
          if (e.phase === "release") {
            prevTier = 0;
            lean.holdX = null;
            return;
          }
          lean.holdX = e.x;
          const action = holdAction(litRef.current ? "lit" : "snuffed", e.tier, prevTier);
          prevTier = Math.max(prevTier, e.tier);
          act(action);
        },
        tap: (e) => {
          lean.holdX = null;
          if (litRef.current) {
            try {
              getFieldAudio().spark();
            } catch {
              /* noop */
            }
            if (e.count >= 3) doSnuff();
          }
        },
      },
      // The candle lives near the screen edge on purpose — no surf line here —
      // and it must never swallow the page's scroll wheel.
      { edgeInset: 0, wheelZoom: false },
    );

    // — keyboard: Enter/Space held climbs the same ladder; triple-press snuffs —
    let keyDownAt = 0;
    let keyPrevTier = 0;
    let keyTimer: ReturnType<typeof setInterval> | null = null;
    let keyTapCount = 0;
    let keyTapTime = -1e9;
    const isActKey = (k: string) => k === "Enter" || k === " ";
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isActKey(e.key)) return;
      e.preventDefault();
      if (e.repeat || keyTimer) return;
      keyDownAt = performance.now();
      keyPrevTier = 0;
      keyTimer = setInterval(() => {
        const tier = holdTier(performance.now() - keyDownAt);
        const action = holdAction(litRef.current ? "lit" : "snuffed", tier, keyPrevTier);
        keyPrevTier = Math.max(keyPrevTier, tier);
        act(action);
      }, 100);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!isActKey(e.key)) return;
      if (keyTimer) clearInterval(keyTimer);
      keyTimer = null;
      const now = performance.now();
      if (now - keyDownAt <= THRESHOLDS.tapMaxMs) {
        keyTapCount = tapTrain(keyTapCount, keyTapTime, now);
        keyTapTime = now;
        if (litRef.current) {
          try {
            getFieldAudio().spark();
          } catch {
            /* noop */
          }
          if (keyTapCount >= 3) doSnuff();
        }
      } else {
        keyTapCount = 0;
      }
    };
    hit.addEventListener("keydown", onKeyDown);
    hit.addEventListener("keyup", onKeyUp);

    return () => {
      detachGestures();
      detachVessel();
      if (breathStop) breathStop();
      if (keyTimer) clearInterval(keyTimer);
      hit.removeEventListener("keydown", onKeyDown);
      hit.removeEventListener("keyup", onKeyUp);
      lean.holdX = null;
    };
  }, [hide]);

  // ── the flame each frame: lean, swell, agitation, collapse/bloom ──
  useEffect(() => {
    if (hide) return;
    const wrap = wrapRef.current;
    const flame = flameRef.current;
    const halo = haloRef.current;
    if (!wrap || !flame || !halo) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      // Leave the CSS keyframes + snuffed class alone; do nothing here.
      return;
    }

    // pointer state — target is the latest event, smoothed values drive the transform
    let targetX = -9999;
    let targetY = -9999;
    let hasPointer = false;
    // smoothed lean magnitudes (sign carries direction)
    let leanDeg = 0;
    let leanPx = 0;
    // 1 = burning, 0 = ember; eased so snuff collapses and relight blooms
    let litAmt = litRef.current ? 1 : 0;

    const onMove = (e: PointerEvent) => {
      targetX = e.clientX;
      targetY = e.clientY;
      hasPointer = true;
    };
    const onLeave = () => { hasPointer = false; };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);

    const audio = getFieldAudio();
    const startedAt = performance.now();

    let raf = 0;
    const tick = () => {
      // candle flame center in screen space — re-read each frame so the
      // math survives scroll, resize, and any fixed-position changes.
      const rect = wrap.getBoundingClientRect();
      // flame tip sits near (cx=16, cy=10) inside a 32x48 viewBox.
      const flameCx = rect.left + rect.width * 0.5;
      const flameCy = rect.top + rect.height * (10 / 48);

      // ── lean: a holding finger > the passing cursor; gravity underneath ──
      let lx = 0; // -1..1 directional pull
      const holdX = leanRef.current.holdX;
      if (holdX !== null) {
        // the flame leans toward the finger pressed on it
        lx = Math.max(-1, Math.min(1, (holdX - flameCx) / 24));
      } else if (hasPointer) {
        const dx = targetX - flameCx;
        const dy = targetY - flameCy;
        const d = Math.hypot(dx, dy);
        if (d < 400) {
          const pull = 1 - d / 400; // 0..1
          lx = (dx / (d || 1)) * pull;
        }
      }
      // real gravity, once the vessel is granted (flame hangs upwind of tilt)
      lx = Math.max(-1, Math.min(1, lx + leanRef.current.tilt * 0.6));

      // Smooth toward target. Decays to 0 when nothing pulls.
      const targetDeg = lx * 6;   // up to +/-6deg
      const targetPx  = lx * 2.5; // small translate, up to +/-2.5px
      leanDeg += (targetDeg - leanDeg) * 0.12;
      leanPx  += (targetPx  - leanPx)  * 0.12;

      // ── lit ↔ ember easing: fast collapse, slower warm bloom ──
      const litTarget = litRef.current ? 1 : 0;
      litAmt += (litTarget - litAmt) * (litTarget < litAmt ? 0.16 : 0.06);

      // ── audio swell pulse (~0.14Hz, matches Sea + ocean swell) ──
      const audioT = audio.getAudioTime?.();
      const t = audioT ?? ((performance.now() - startedAt) / 1000);
      const swell = Math.sin(t * 0.14 * Math.PI * 2); // -1..1
      const pulse01 = (swell + 1) / 2;                // 0..1
      // a stormy sea agitates the flame, faintly
      const agit = getTurbulence() * 0.05 * Math.sin(t * 7.3);
      // 0.85..1.05 — subtle — then collapsed toward the wick when snuffed
      const intensity = (0.85 + pulse01 * 0.20 + agit) * (0.06 + 0.94 * litAmt);

      // Apply transforms. The wrapper carries the lean (candle body + flame
      // tilt together); skewX leans the top opposite its sign, so negate.
      wrap.style.transform =
        `translateX(${leanPx.toFixed(3)}px) skewX(${(-leanDeg).toFixed(3)}deg)`;

      // Flame pulse: scale on the SVG group, opacity on flame + halo, both
      // multiplied by the lit amount so night takes the flame down with it.
      flame.style.transformOrigin = "16px 10px";
      flame.style.transform = `scale(${intensity.toFixed(4)})`;
      flame.style.opacity = String((0.85 + pulse01 * 0.20) * litAmt);
      halo.style.opacity = String((0.80 + pulse01 * 0.25) * litAmt);

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
      // restore neutral state
      wrap.style.transform = "";
      flame.style.transform = "";
      flame.style.opacity = "";
      halo.style.opacity = "";
    };
  }, [hide]);

  if (hide) return null;

  return (
    <>
      {/* the night — a translucent ink veil every route inherits. Sits under
          the candle's z-index, pointer-events none: rooms stay playable. */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 24,
          pointerEvents: "none",
          background:
            "radial-gradient(56rem 56rem at 40px calc(100% - 90px), rgba(13,15,21,0.42), rgba(8,10,15,0.66))",
          opacity: lit ? 0 : 1,
          transition: reduce ? "none" : "opacity 1.8s ease",
        }}
      />

      <div
        ref={wrapRef}
        aria-hidden="true"
        className={`oda-candle-mark${lit ? "" : " snuffed"}`}
        style={{
          position: "fixed",
          left: "calc(16px + env(safe-area-inset-left, 0px))",
          bottom: "calc(56px + env(safe-area-inset-bottom, 0px))",
          zIndex: 25,
          pointerEvents: "none",
          width: 32,
          height: 48,
          // transform-origin at the base of the candle so the lean pivots
          // from the candle bottom rather than the center.
          transformOrigin: "16px 44px",
          willChange: "transform",
        }}
      >
        <svg
          viewBox="0 0 32 48"
          width={32}
          height={48}
          style={{ display: "block", overflow: "visible" }}
        >
          <defs>
            <radialGradient id="cm-halo" cx="16" cy="10" r="14" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#C8732A" stopOpacity="0.55" />
              <stop offset="0.6" stopColor="#C8732A" stopOpacity="0.10" />
              <stop offset="1" stopColor="#C8732A" stopOpacity="0" />
            </radialGradient>
          </defs>
          {/* halo — opacity modulated by audio swell at runtime */}
          <g ref={haloRef} className="candle-flicker cm-halo-outer">
            <circle cx={16} cy={10} r={14} fill="url(#cm-halo)" />
          </g>
          {/* flame — scale + opacity modulated by audio swell at runtime,
              layered on top of the CSS-keyframe flicker via the inner <g> */}
          <g ref={flameRef} className="cm-flame-outer">
            <g className="candle-flame">
              <path
                className="touchable-line"
                d="M16 4 c1 3 3.2 4.4 3.8 6.6 c.7 2.4 -.4 5 -3.8 5 c-3.4 0 -4.5 -2.6 -3.8 -5 c.6 -2.2 2.8 -3.6 3.8 -6.6 z"
                fill="rgba(200,115,42,0.32)"
                stroke="#C8732A"
                strokeWidth={1.2}
                strokeLinejoin="round"
              />
            </g>
          </g>
          {/* the ember — visible only while snuffed; catches on relight */}
          <circle className="cm-ember" cx={16} cy={16.2} r={1.7} fill="#C8732A" />
          {/* wick — short, dark */}
          <line className="touchable-line" x1={16} y1={15} x2={16} y2={19} stroke="#15171A" strokeWidth={1.2} strokeLinecap="round" />
          {/* candle body — paper rectangle with ink rule */}
          <rect className="touchable-line" x={11} y={19} width={10} height={25} fill="var(--paper)" stroke="#15171A" strokeWidth={1.2} />
          <line className="touchable-line" x1={11} y1={24} x2={21} y2={24} stroke="rgba(21,23,26,0.35)" strokeWidth={0.6} />
          <ellipse cx={16} cy={19} rx={5} ry={1.2} fill="#3A3D42" />
        </svg>

        <style>{`
          @keyframes candle-flicker-frames {
            0%, 100% { opacity: 1; transform: scale(1); }
            45% { opacity: 0.78; transform: scale(0.94); }
            55% { opacity: 1; transform: scale(1.02); }
            70% { opacity: 0.86; transform: scale(0.98); }
          }
          @keyframes candle-flame-frames {
            0%, 100% { transform: translateY(0) scaleY(1); }
            50% { transform: translateY(0.4px) scaleY(0.95); }
          }
          @keyframes cm-ember-glow {
            0%, 100% { opacity: 0.5; }
            50% { opacity: 0.95; }
          }
          .candle-flicker {
            transform-origin: 16px 10px;
            animation: candle-flicker-frames 1.4s ease-in-out infinite;
          }
          .candle-flame {
            transform-origin: 16px 10px;
            animation: candle-flame-frames 1.8s ease-in-out infinite;
          }
          .oda-candle-mark .cm-ember {
            opacity: 0;
            transition: opacity 0.8s ease;
          }
          .oda-candle-mark.snuffed .cm-ember {
            opacity: 0.9;
            animation: cm-ember-glow 2.8s ease-in-out infinite;
          }
          /* Reduced motion (and any state before the rAF loop writes inline
             styles): the snuffed class alone takes the flame down. */
          .oda-candle-mark.snuffed .cm-flame-outer,
          .oda-candle-mark.snuffed .cm-halo-outer {
            opacity: 0;
          }
          @media (prefers-reduced-motion: reduce) {
            .candle-flicker, .candle-flame { animation: none; }
            .oda-candle-mark .cm-ember { transition: none; animation: none; }
          }
        `}</style>
      </div>

      {/* the touchable candle — a quiet, focusable hit surface a little
          larger than the mark itself. No copy: the candle IS the interface. */}
      <div
        ref={hitRef}
        role="button"
        tabIndex={0}
        aria-label="candle"
        aria-pressed={!lit}
        style={{
          position: "fixed",
          left: "calc(6px + env(safe-area-inset-left, 0px))",
          bottom: "calc(46px + env(safe-area-inset-bottom, 0px))",
          width: 52,
          height: 68,
          zIndex: 26,
          background: "transparent",
          cursor: "pointer",
          WebkitTapHighlightColor: "transparent",
        }}
      />
    </>
  );
}
