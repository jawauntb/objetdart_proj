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
 * Portalled to <body> for the same stacking reason as RoomHelp / LetGo: a
 * room's `position: fixed` wrapper opens a stacking context in Chrome, and
 * an in-tree overlay would sit under the tape. z-index 68 sits under travel
 * films (72) and beside the help scrim (70).
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
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={TITLE_ID}
          aria-describedby={BODY_ID}
          tabIndex={-1}
          className="oda-arrival-card"
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
            <em>an album you play</em>
          </h2>

          <div id={BODY_ID} className="t-body oda-arrival-body">
            <p>
              rooms, not pages. rest a finger and something gathers; hold longer and it
              deepens.
            </p>
            <p>
              pinch to travel scale; twist to see the same thing another way. there are
              no menus.
            </p>
            <p>the small ? is the field guide, if you want words.</p>
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
          width: min(420px, 100%);
          max-height: min(70vh, 560px);
          overflow-y: auto;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
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
          margin: 0 44px 14px 0;
          color: var(--ink);
        }

        .oda-arrival-body { margin: 0; color: var(--ink); }
        .oda-arrival-body > p { margin: 0 0 0.85em; }
        .oda-arrival-body > p:last-child { margin-bottom: 0; }

        .oda-arrival-enter {
          appearance: none;
          -webkit-appearance: none;
          display: inline-flex;
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
            max-height: min(62vh, 520px);
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
