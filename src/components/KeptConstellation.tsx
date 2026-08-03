"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useField } from "@/store/field";
import { decodeReadingHash } from "@/lib/reading";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import ConcernSigil from "@/components/ConcernSigil";
import type { ConcernKey } from "@/lib/types";

/**
 * Your kept readings as a constellation on the threshold sea.
 *
 * Each kept reading gets a deterministic position derived from its hash,
 * twinkles gently in cream-white, and on hover blooms into a larger
 * sigil with the headline. Click opens the shared-reading view.
 * Renders nothing if there's nothing kept.
 *
 * The grammar adds two verbs (tap-to-open stays exactly as it was):
 * a long-press on a star lets its sigil play its ~12s phrase, and a
 * flick sends it streaking briefly before it settles home — a kept
 * night is never lost.
 */
function hashToPos(hash: string): { x: number; y: number } {
  let h = 0;
  for (let i = 0; i < hash.length; i++) h = (h * 31 + hash.charCodeAt(i)) | 0;
  const a = Math.abs(h);
  const b = Math.abs((h * 2654435761) | 0);
  const x = (a % 10000) / 10000;
  const y = (b % 10000) / 10000;
  // keep stars in the upper-mid band of the sea so they're discoverable
  return { x: 0.06 + x * 0.88, y: 0.20 + y * 0.55 };
}

export default function KeptConstellation() {
  const kept = useField((s) => s.keptReadings);
  const loadFromStorage = useField((s) => s.loadFromStorage);

  const wrapRef = useRef<HTMLDivElement>(null);
  // stars the engine can hit-test, refreshed every render
  const starsRef = useRef<Array<{ hash: string; concerns: Record<ConcernKey, number> }>>([]);
  const playingRef = useRef<string | null>(null);
  // the star the finger landed on — a flick releases far from where it
  // began, so the verb resolves against the landing, not the release
  const downHashRef = useRef<string | null>(null);
  // a consumed hold/flick suppresses the click that would follow it,
  // so tap keeps meaning "open" and nothing navigates by accident
  const consumedAtRef = useRef(-1e9);
  const [sounding, setSounding] = useState<string | null>(null);
  const [streak, setStreak] = useState<{ hash: string; dx: number; dy: number; key: number } | null>(null);

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  const visible = kept.slice(0, 24)
    .map((r) => {
      const decoded = decodeReadingHash(r.hash);
      return decoded ? { hash: r.hash, headline: r.headline, concerns: decoded.concerns, pos: hashToPos(r.hash) } : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  starsRef.current = visible.map((v) => ({ hash: v.hash, concerns: v.concerns }));

  // ── engine mount: hold = the star's phrase, flick = a streak ──────
  // Attached to the constellation layer only; manageStyle stays off so
  // the page (and the sea below) keep their own touch behavior.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let played = false;
    let streakTimer: ReturnType<typeof setTimeout> | null = null;

    const starAt = (clientX: number, clientY: number) => {
      const rect = wrap.getBoundingClientRect();
      let best: { hash: string; concerns: Record<ConcernKey, number>; d: number } | null = null;
      for (const s of starsRef.current) {
        const p = hashToPos(s.hash);
        const d = Math.hypot(rect.left + p.x * rect.width - clientX, rect.top + p.y * rect.height - clientY);
        if (d < 34 && (!best || d < best.d)) best = { ...s, d };
      }
      return best;
    };
    const starFor = (clientX: number, clientY: number) => {
      const down = downHashRef.current
        ? starsRef.current.find((s) => s.hash === downHashRef.current) ?? null
        : null;
      return down ?? starAt(clientX, clientY);
    };

    const detach = attachGestures(wrap, {
      hold: (e) => {
        if (e.fingers !== 1) return;
        if (e.phase === "enter") { played = false; return; }
        if (e.phase === "release") {
          if (played) consumedAtRef.current = performance.now();
          return;
        }
        // dwell tier — long-press means charge, everywhere: the star's
        // sigil plays its own ~12s phrase
        if (e.tier >= 2 && !played) {
          played = true;
          const star = starFor(e.x, e.y);
          if (!star || playingRef.current) return;
          consumedAtRef.current = performance.now();
          playingRef.current = star.hash;
          setSounding(star.hash);
          try { haptics.ripple(0.5); } catch { /* noop */ }
          useField.getState().recordTape("sigil", 0.8, "constellation/phrase");
          void getFieldAudio().playSigilPhrase(star.concerns)
            .catch(() => { /* the sea absorbs it */ })
            .finally(() => {
              playingRef.current = null;
              setSounding((h) => (h === star.hash ? null : h));
            });
        }
      },
      flick: (e) => {
        if (e.fingers !== 1) return;
        const star = starFor(e.x, e.y);
        if (!star) return;
        consumedAtRef.current = performance.now();
        const len = reduce ? 0 : 26 + Math.min(22, e.speed * 14);
        setStreak({
          hash: star.hash,
          dx: Math.cos(e.angle) * len,
          dy: Math.sin(e.angle) * len,
          key: Date.now(),
        });
        try { haptics.chop(); } catch { /* noop */ }
        try { getFieldAudio().chime(); } catch { /* noop */ }
        useField.getState().recordTape("ripple", 0.5, "constellation/streak");
        if (streakTimer) clearTimeout(streakTimer);
        streakTimer = setTimeout(() => setStreak(null), 950);
      },
    }, { wheelZoom: false, manageStyle: false, noCapture: true });

    return () => {
      detach();
      if (streakTimer) clearTimeout(streakTimer);
    };
  }, []);

  if (visible.length === 0) return null;

  return (
    <div
      ref={wrapRef}
      aria-label="your kept readings, on the water"
      onPointerDownCapture={(e) => {
        const a = (e.target as HTMLElement).closest?.("a.kept-star") as HTMLAnchorElement | null;
        const href = a?.getAttribute("href") ?? "";
        downHashRef.current = href.startsWith("/reading/") ? href.slice("/reading/".length) : null;
      }}
      onClickCapture={(e) => {
        if (performance.now() - consumedAtRef.current < 700) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 2,
      }}
    >
      {visible.map((r, i) => {
        const p = r.pos;
        const isSounding = sounding === r.hash;
        const isStreaking = streak?.hash === r.hash;
        return (
          <Link
            key={r.hash}
            href={`/reading/${r.hash}`}
            className={
              "kept-star"
              + (isSounding ? " is-sounding" : "")
              + (isStreaking ? " is-streaking" : "")
            }
            aria-label={r.headline}
            draggable={false}
            style={{
              position: "absolute",
              left: `${p.x * 100}%`,
              top: `${p.y * 100}%`,
              transform: "translate(-50%, -50%)",
              pointerEvents: "auto",
              animationDelay: `${(i * 0.43) % 5}s`,
              ...(isStreaking
                ? {
                    ["--streak-x" as string]: `${streak?.dx ?? 0}px`,
                    ["--streak-y" as string]: `${streak?.dy ?? 0}px`,
                  }
                : null),
            }}
          >
            <span className="kept-star-inner" key={isStreaking ? streak?.key : undefined}>
              <ConcernSigil
                concerns={r.concerns}
                size={22}
                showRing={false}
                showAxes={false}
                showDots={false}
                fill="rgba(244, 248, 252, 0.18)"
                stroke="rgba(244, 248, 252, 0.92)"
              />
            </span>
            <span className="kept-star-halo" aria-hidden="true" />
            <span className="kept-star-label">{r.headline}</span>
          </Link>
        );
      })}

      <style>{`
        .kept-star {
          display: block;
          padding: 8px;
          opacity: 0.62;
          transition: opacity 320ms ease, z-index 0ms 320ms;
          animation: kept-twinkle 4.2s ease-in-out infinite;
          position: absolute;
          -webkit-touch-callout: none;
          -webkit-user-select: none;
          user-select: none;
        }
        .kept-star-inner {
          display: inline-block;
          transform-origin: center center;
          transition: transform 360ms cubic-bezier(.2,.7,.2,1), filter 360ms ease;
          filter: drop-shadow(0 0 4px rgba(170, 210, 240, 0.4));
        }
        .kept-star-halo {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 22px;
          height: 22px;
          margin-left: -11px;
          margin-top: -11px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(244,248,252,0.25), rgba(244,248,252,0));
          transform: scale(1);
          transition: transform 360ms cubic-bezier(.2,.7,.2,1), opacity 360ms ease;
          opacity: 0.65;
          pointer-events: none;
        }
        .kept-star:hover, .kept-star:focus-visible {
          opacity: 1;
          z-index: 10;
        }
        .kept-star:hover .kept-star-inner,
        .kept-star:focus-visible .kept-star-inner {
          transform: scale(3.4);
          filter: drop-shadow(0 0 16px rgba(220, 240, 255, 0.7));
        }
        .kept-star:hover .kept-star-halo,
        .kept-star:focus-visible .kept-star-halo {
          transform: scale(5);
          opacity: 1;
        }
        /* while its phrase sounds, the star breathes light */
        .kept-star.is-sounding {
          opacity: 1;
          z-index: 10;
        }
        .kept-star.is-sounding .kept-star-inner {
          animation: kept-sound 3s ease-in-out infinite;
          filter: drop-shadow(0 0 14px rgba(220, 240, 255, 0.75));
        }
        .kept-star.is-sounding .kept-star-halo {
          transform: scale(4.2);
          opacity: 1;
        }
        /* a flicked star streaks out and settles home — never lost */
        .kept-star.is-streaking .kept-star-inner {
          animation: kept-streak 900ms cubic-bezier(.18,.7,.28,1.15) both;
          filter: drop-shadow(0 0 14px rgba(220, 240, 255, 0.85));
        }
        .kept-star-label {
          position: absolute;
          left: 50%;
          top: calc(100% + 78px);
          transform: translateX(-50%);
          white-space: normal;
          max-width: 32ch;
          opacity: 0;
          transition: opacity 360ms ease 100ms;
          pointer-events: none;
          padding: 10px 14px;
          background: rgba(8, 18, 32, 0.78);
          border: 1px solid rgba(244,248,252,0.18);
          backdrop-filter: blur(6px);
          font-family: var(--font-serif);
          font-style: italic;
          font-size: 14px;
          color: #F2EEE6;
          line-height: 1.32;
          text-align: center;
        }
        .kept-star:hover .kept-star-label,
        .kept-star:focus-visible .kept-star-label {
          opacity: 1;
        }
        @keyframes kept-twinkle {
          0%, 100% { filter: brightness(1); }
          50% { filter: brightness(1.35); }
        }
        @keyframes kept-sound {
          0%, 100% { transform: scale(1.7); }
          50% { transform: scale(2.2); }
        }
        @keyframes kept-streak {
          0% { transform: translate(0, 0) scale(1); }
          32% { transform: translate(var(--streak-x, 0px), var(--streak-y, 0px)) scale(1.4); }
          100% { transform: translate(0, 0) scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .kept-star { animation: none; }
          .kept-star.is-streaking .kept-star-inner { animation: none; }
          .kept-star.is-sounding .kept-star-inner { animation: none; transform: scale(1.9); }
        }
      `}</style>
    </div>
  );
}
