"use client";

/**
 * ArrivalInvitation — volunteered once on the manifold door, then gone.
 *
 * Owner-approved exception to "no instructions in the room": this card is
 * the album naming itself at the threshold, not a control inside a material.
 * It mounts from `src/app/manifold/page.tsx` only — never from the fold's
 * canvas, never from RoomHelp, never from the root layout. Dismissal is
 * written through the arrival codec and the card does not return. It does
 * not open the chrome `?`.
 *
 * The copy is plain english by owner decree — v1 read as esoteric, so every
 * sentence here must land with a smart twelve-year-old: what the model is,
 * what it is for, how the hand works on a phone and on a computer, and where
 * the per-room big ideas live. Lowercase, no emoji, no marketing verbs — but
 * plain beats voiced on this one card. Every claim must stay true of the
 * shipped site (the grammar, the keyboard dialect, the `?`, the menu).
 *
 * Portalled to <body> for the same stacking reason as RoomHelp / LetGo: a
 * room's `position: fixed` wrapper opens a stacking context in Chrome, and
 * an in-tree overlay would sit under the tape. z-index 68 sits under travel
 * films (72) and beside the help scrim (70). The card is a flex column: the
 * long body scrolls on small screens while the title and the enter control
 * stay in view.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { readArrivalDismissed, writeArrivalDismissed } from "@/lib/arrival";

const TITLE_ID = "oda-arrival-title";
const BODY_ID = "oda-arrival-body";
/** a short breath so the fold is the first thing seen */
const BREATH_MS = 1800;

export default function ArrivalInvitation() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const enterRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    if (readArrivalDismissed()) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      setOpen(true);
      return;
    }

    const id = window.setTimeout(() => setOpen(true), BREATH_MS);
    return () => window.clearTimeout(id);
  }, [mounted]);

  const dismiss = useCallback(() => {
    writeArrivalDismissed();
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !dialogRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialogRef.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, dismiss]);

  useEffect(() => {
    if (!open) return;
    enterRef.current?.focus({ preventScroll: true });
  }, [open]);

  if (!mounted || !open || typeof document === "undefined") return null;

  return createPortal(
    <>
      <div
        className="oda-arrival-scrim"
        onClick={(e) => {
          if (e.target === e.currentTarget) dismiss();
        }}
      >
        {/* data-pretext-ignore: the global word-drift can collide adjacent
            words at its extremes — fine on a poem, not on the one card that
            must read plain. The words on this card hold still. */}
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={TITLE_ID}
          aria-describedby={BODY_ID}
          tabIndex={-1}
          className="oda-arrival-card"
          data-pretext-ignore="true"
        >
          <button
            type="button"
            className="t-mono oda-arrival-close"
            aria-label="close"
            onClick={dismiss}
          >
            <span aria-hidden="true">×</span>
          </button>

          <h2 id={TITLE_ID} className="t-h3 oda-arrival-title">
            <em>a scale model of everything</em>
          </h2>

          <div id={BODY_ID} className="t-body oda-arrival-body">
            <p>
              this is a working scale model of the universe — one room for each size of
              thing, from the quantum fields up to the whole spacetime fold, plus rooms
              for the laws that hold at every size. it is an album you play, not a site
              you read.
            </p>
            <p>
              every room takes one big idea — how atoms bond, how a flock turns, how
              gravity slows time — and makes it something your hands can figure out by
              playing. the rooms never explain themselves in words; they answer what
              you do.
            </p>
            <p className="t-mono oda-arrival-lead">on a phone</p>
            <p>
              rest a finger and something grows. hold longer and it deepens. pinch to
              zoom, and keep pinching to travel to the next size. twist two fingers to
              see the same thing drawn another way. three fingers move the world — drag
              for wind, hold to slow time.
            </p>
            <p className="t-mono oda-arrival-lead">on a computer</p>
            <p>
              the mouse is your finger — click, hold, drag. scroll or pinch the
              trackpad to travel between sizes. arrow keys and enter play too.
            </p>
            <p>
              lost? the small ? at the bottom right explains the room you are in, with
              a plain-words setting. the menu at the top right lists every room,
              grouped by size and kind.
            </p>
          </div>

          <button
            ref={enterRef}
            type="button"
            className="t-mono oda-arrival-enter"
            onClick={dismiss}
          >
            enter
          </button>
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .oda-arrival-scrim {
          position: fixed;
          inset: 0;
          z-index: 68;
          background: rgba(8, 10, 14, 0.36);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: calc(24px + env(safe-area-inset-top, 0px))
                   calc(16px + env(safe-area-inset-right, 0px))
                   calc(72px + env(safe-area-inset-bottom, 0px))
                   calc(16px + env(safe-area-inset-left, 0px));
          animation: oda-arrival-in 280ms ease both;
        }
        @keyframes oda-arrival-in { from { opacity: 0; } to { opacity: 1; } }

        .oda-arrival-card {
          position: relative;
          display: flex;
          flex-direction: column;
          width: min(560px, 100%);
          max-height: min(86vh, 768px);
          background: linear-gradient(180deg, var(--paper) 0%, var(--paper-2) 100%);
          border: 1px solid var(--rule);
          box-shadow: 0 24px 80px rgba(0, 0, 0, 0.38);
          padding: 28px 28px 24px;
          color: var(--ink);
        }
        .oda-arrival-card:focus { outline: none; }
        .oda-arrival-card::before {
          content: "";
          display: block;
          flex: none;
          width: 40px;
          height: 1px;
          background: var(--candle);
          margin: 0 0 18px;
        }

        .oda-arrival-close {
          position: absolute;
          top: 6px;
          right: 6px;
          width: 40px;
          height: 40px;
          appearance: none;
          -webkit-appearance: none;
          background: transparent;
          border: 0;
          color: var(--ink-2);
          font-size: 17px;
          line-height: 1;
          cursor: pointer;
        }
        .oda-arrival-close:hover { color: var(--ink); }
        .oda-arrival-close:focus-visible { outline: 2px solid var(--sea); outline-offset: -2px; }

        .oda-arrival-title {
          flex: none;
          margin: 0 44px 14px 0;
          color: var(--ink);
        }

        /* the long part scrolls; title above and enter below stay in view */
        .oda-arrival-body {
          margin: 0;
          color: var(--ink);
          flex: 1 1 auto;
          min-height: 0;
          overflow-y: auto;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
        }
        .oda-arrival-body > p { margin: 0 0 0.85em; }
        .oda-arrival-body > p:last-child { margin-bottom: 0; }
        .oda-arrival-body > .oda-arrival-lead {
          margin: 1.2em 0 0.4em;
          color: var(--ink-2);
          opacity: 0.8;
          font-size: 10px;
          letter-spacing: 0.14em;
        }
        .oda-arrival-body > .oda-arrival-lead:first-child { margin-top: 0; }

        .oda-arrival-enter {
          appearance: none;
          -webkit-appearance: none;
          display: inline-flex;
          flex: none;
          align-self: flex-start;
          align-items: center;
          justify-content: center;
          margin-top: 22px;
          min-height: 44px;
          padding: 0 22px;
          background: transparent;
          border: 1px solid var(--rule);
          color: var(--ink);
          font-size: 11px;
          letter-spacing: 0.14em;
          cursor: pointer;
          transition: color var(--t), border-color var(--t), background var(--t);
        }
        .oda-arrival-enter:hover {
          color: var(--ink);
          border-color: var(--ink);
        }
        .oda-arrival-enter:focus-visible { outline: 2px solid var(--sea); outline-offset: 2px; }

        @media (max-width: 520px) {
          .oda-arrival-scrim {
            align-items: flex-end;
            padding-bottom: calc(64px + env(safe-area-inset-bottom, 0px));
          }
          .oda-arrival-card {
            width: 100%;
            max-height: min(68vh, 560px);
            padding: 24px 20px 22px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .oda-arrival-scrim { animation: none; }
          .oda-arrival-enter { transition: none; }
        }
      `,
        }}
      />
    </>,
    document.body,
  );
}
