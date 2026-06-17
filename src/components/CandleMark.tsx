"use client";

import { useEffect, useRef } from "react";
import { getFieldAudio } from "@/lib/audio";

/**
 * The literal candle. Lives in a fixed corner on every page so the
 * brand's central image isn't only a metaphor in the title.
 *
 * Behaviors:
 *  - Leans toward the cursor when the pointer is within ~400px of the
 *    flame (max ~6deg tilt, scaled by distance). Smoothed via lerp on
 *    requestAnimationFrame; decays to upright when no pointer.
 *  - Flame brightness/scale pulses with the audio swell LFO (~0.14 Hz),
 *    matching the wave swell in audio.ts. Falls back to a pure sine
 *    against performance.now when the audio context isn't running.
 *  - prefers-reduced-motion: lean + pulse disabled, candle is static.
 *
 * Reduced motion is also respected by the existing CSS keyframe flicker
 * via the global stylesheet, which we leave in place as the resting
 * idle animation when audio is silent.
 */
export default function CandleMark() {
  // refs to the elements we drive each frame
  const wrapRef = useRef<HTMLDivElement>(null);
  const flameRef = useRef<SVGGElement>(null);
  const haloRef = useRef<SVGGElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const flame = flameRef.current;
    const halo = haloRef.current;
    if (!wrap || !flame || !halo) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      // Leave the CSS keyframes alone; do nothing here.
      return;
    }

    // pointer state — target is the latest event, smoothed values drive the transform
    let targetX = -9999;
    let targetY = -9999;
    let hasPointer = false;
    // smoothed lean magnitudes (sign carries direction)
    let leanDeg = 0;
    let leanPx = 0;

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

      // ── lean toward cursor ──
      let lx = 0; // -1..1 directional pull, scaled by proximity
      if (hasPointer) {
        const dx = targetX - flameCx;
        const dy = targetY - flameCy;
        const d = Math.hypot(dx, dy);
        if (d < 400) {
          const pull = 1 - d / 400; // 0..1
          // sign of dx, falling off with distance
          lx = (dx / (d || 1)) * pull;
        }
      }
      // Smooth toward target. Decays to 0 when hasPointer is false / lx=0.
      const targetDeg = lx * 6;   // up to +/-6deg
      const targetPx  = lx * 2.5; // small translate, up to +/-2.5px
      leanDeg += (targetDeg - leanDeg) * 0.12;
      leanPx  += (targetPx  - leanPx)  * 0.12;

      // ── audio swell pulse (~0.14Hz, matches Sea + ocean swell) ──
      const audioT = audio.getAudioTime?.();
      const t = audioT ?? ((performance.now() - startedAt) / 1000);
      const swell = Math.sin(t * 0.14 * Math.PI * 2); // -1..1
      const pulse01 = (swell + 1) / 2;                // 0..1
      // 0.85..1.05 — subtle
      const intensity = 0.85 + pulse01 * 0.20;

      // Apply transforms.
      // The wrapper carries the lean (so candle body + flame both tilt).
      // The flame group additionally carries the audio-driven scale/opacity
      // pulse, multiplied on top of the existing CSS keyframe flicker.
      wrap.style.transform =
        `translateX(${leanPx.toFixed(3)}px) skewX(${(-leanDeg).toFixed(3)}deg)`;
      // skewX leans the top of the element opposite to its sign, so we
      // negate to make the visible tilt go *toward* the cursor.

      // Flame pulse: scale on the SVG group, opacity on halo.
      // The CSS keyframes already touch transform on .candle-flame, but
      // they target an SVG <g>'s transform attribute via CSS. Setting the
      // style transform here overrides them — to preserve the flicker we
      // multiply the swell into a scale + opacity on a wrapping attribute
      // we control independently.
      flame.style.transformOrigin = "16px 10px";
      flame.style.transform = `scale(${intensity.toFixed(4)})`;
      flame.style.opacity = String(0.85 + pulse01 * 0.20);
      halo.style.opacity = String(0.80 + pulse01 * 0.25);

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
  }, []);

  return (
    <div
      ref={wrapRef}
      aria-hidden="true"
      className="oda-candle-mark"
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
        <g ref={haloRef} className="candle-flicker">
          <circle cx={16} cy={10} r={14} fill="url(#cm-halo)" />
        </g>
        {/* flame — scale + opacity modulated by audio swell at runtime,
            layered on top of the CSS-keyframe flicker via the inner <g> */}
        <g ref={flameRef}>
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
        .candle-flicker {
          transform-origin: 16px 10px;
          animation: candle-flicker-frames 1.4s ease-in-out infinite;
        }
        .candle-flame {
          transform-origin: 16px 10px;
          animation: candle-flame-frames 1.8s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .candle-flicker, .candle-flame { animation: none; }
        }
        @media (max-width: 640px), (pointer: coarse) {
          .oda-candle-mark { display: none !important; }
        }
      `}</style>
    </div>
  );
}
