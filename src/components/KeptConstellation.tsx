"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useField } from "@/store/field";
import { decodeReadingHash } from "@/lib/reading";
import ConcernSigil from "@/components/ConcernSigil";

/**
 * Your kept readings as a constellation on the threshold sea.
 *
 * Each kept reading gets a deterministic position derived from its hash,
 * twinkles gently in cream-white, and on hover blooms into a larger
 * sigil with the headline. Click opens the shared-reading view.
 * Renders nothing if there's nothing kept.
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

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  if (kept.length === 0) return null;

  return (
    <div
      aria-label="your kept readings, on the water"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 2,
      }}
    >
      {kept.slice(0, 24).map((r, i) => {
        const decoded = decodeReadingHash(r.hash);
        if (!decoded) return null;
        const p = hashToPos(r.hash);
        return (
          <Link
            key={r.hash}
            href={`/reading/${r.hash}`}
            className="kept-star"
            aria-label={r.headline}
            style={{
              position: "absolute",
              left: `${p.x * 100}%`,
              top: `${p.y * 100}%`,
              transform: "translate(-50%, -50%)",
              pointerEvents: "auto",
              animationDelay: `${(i * 0.43) % 5}s`,
            }}
          >
            <span className="kept-star-inner">
              <ConcernSigil
                concerns={decoded.concerns}
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
        @media (prefers-reduced-motion: reduce) {
          .kept-star { animation: none; }
        }
      `}</style>
    </div>
  );
}
