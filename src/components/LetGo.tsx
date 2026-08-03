"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * LetGo — the quiet clear control (RoomTemplate §8c), one shared shape.
 *
 * Every room that keeps things offers this small parting word: a tiny mono
 * button held at bottom-center — the slot the site reserves for it, clear
 * of the candle and sound toggle at bottom-left and any toggles at bottom-
 * right, and clear of the browser's own chrome via the safe-area inset.
 * It renders only while something stands, sits clear of the candle (bottom-left)
 * and above the tape that would otherwise swallow its clicks,
 * and is deliberately small so a wandering thumb never finds it by accident
 * — but its hit target stays a full 40px for the hand that means it.
 *
 * One press is one act, and the act is an exhale, never a blink: the room
 * lets its kept things leave gracefully in its own material over a breath
 * or two, writes its storage empty (an empty room is a remembered state —
 * nothing respawns over a deliberate clearing), and says one low word.
 * No confirmation dialogs — the site has none.
 *
 * Rooms whose own furniture already stands at bottom-center (the coast
 * instruments) may lift it in their stylesheet:
 * `body:has(.room-class) .oda-letgo { bottom: …; }`.
 */

type LetGoProps = {
  /** the room's own words, lowercase — also the accessible name */
  label: string;
  /** the room's exhale — clears its material gracefully and its storage */
  onLetGo: () => void;
  /** driven by the actual population: nothing kept, nothing offered */
  visible: boolean;
};

export default function LetGo({ label, onLetGo, visible }: LetGoProps) {
  // Portalled to <body>, and that is load-bearing rather than tidiness. Rooms
  // wrap themselves in a `position: fixed` element, which in Chrome opens a
  // stacking context whatever its z-index — so a control rendered inside the
  // room was trapped in that context at an effective z-index of 0, underneath
  // the tape's 28, and no z-index written here could lift it out. Rendered
  // into the body it stands in the root context where its own z-index counts.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!visible || !mounted || typeof document === "undefined") return null;
  return createPortal(
    <>
      <button type="button" className="oda-letgo" aria-label={label} onClick={onLetGo}>
        {label}
      </button>
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .oda-letgo {
          position: fixed;
          left: 50%;
          transform: translateX(-50%);
          bottom: max(18px, env(safe-area-inset-bottom, 0px));
          /* Above the tape (28), which is fixed across the bottom 40px with
             pointer-events:auto on fine pointers for its hover labels — it was
             swallowing every click on this control on desktop, in every room
             that keeps anything. The tape is aria-hidden decoration; a control
             the hand means to press outranks it. Still clear of the candle,
             which sits bottom-left and never overlaps this slot. */
          z-index: 29;
          appearance: none;
          -webkit-appearance: none;
          background: rgba(8, 10, 13, 0.32);
          border: 1px solid rgba(238, 234, 219, 0.16);
          border-radius: 3px;
          color: rgba(238, 234, 219, 0.48);
          font-family: var(--font-mono, "IBM Plex Mono", monospace);
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: lowercase;
          line-height: 1;
          white-space: nowrap;
          min-height: 40px;
          padding: 0 14px;
          display: inline-flex;
          align-items: center;
          cursor: pointer;
          transition: color 200ms ease, border-color 200ms ease;
        }
        .oda-letgo:hover {
          color: rgba(242, 238, 230, 0.75);
          border-color: rgba(242, 238, 230, 0.35);
        }
        .oda-letgo:focus-visible {
          outline: 2px solid rgba(231, 172, 82, 0.7);
          outline-offset: 2px;
        }
      `,
        }}
      />
    </>,
    document.body,
  );
}
