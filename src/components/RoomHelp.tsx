"use client";

/**
 * RoomHelp — the `?` in the site chrome, and the one surface that explains.
 *
 * AGENTS.md's "no instructions, ever" holds inside the material and is not
 * softened here: no in-room copy, no labels over the canvas, no first-run
 * popup, nothing that opens itself. This is the opposite shape — a small,
 * out-of-the-way control the visitor has to *go and press*. Discovery stays
 * physical; help stays sought.
 *
 * It is a **mirror of /guide, never a second copy of it**. The component owns
 * about five words of chrome and not one sentence about any room: it resolves
 * the current route to its `GUIDE_ROOMS` entry and renders that entry's own
 * fields. Editing `src/rooms/<key>/room.config.ts` or `src/data/guide.ts`
 * changes what the `?` says on that route, with no edit here — and
 * `scripts/test-room-help.mjs` fails if a room key, href or line of room copy
 * ever appears in this file.
 *
 * Two mechanics worth knowing before you touch it:
 *
 * 1. **Portalled to <body>, and that is load-bearing** — the same reason
 *    `<LetGo>` is. Rooms wrap themselves in a `position: fixed` element, which
 *    in Chrome opens a stacking context whatever its z-index, so a control
 *    rendered inside the room is trapped there at an effective z-index of 0,
 *    under the tape's 28, and silently swallows its own clicks. Rendered into
 *    the body it stands in the root context where its z-index counts.
 *
 * 2. **The guide's prose is imported lazily.** `GUIDE_ROOMS` is ~140KB of
 *    strings; the `?` mounts on every screen, so importing it eagerly would put
 *    the whole field guide in every page's client bundle. The render decision
 *    needs only the route → key half (`@/lib/guide-route`, which reads
 *    `SITE_ROUTES` the chrome already carries); the prose arrives on first
 *    hover, focus or press.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GuideBinding, GuideRoom } from "@/data/guide";
import { guideKeyForPath } from "@/lib/guide-route";

type GuideData = {
  rooms: Record<string, GuideRoom>;
  bindings: GuideBinding[];
};

const TITLE_ID = "oda-help-title";

export default function RoomHelp() {
  const pathname = usePathname() ?? "/";
  const key = guideKeyForPath(pathname);

  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<GuideData | null>(null);

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const loadRef = useRef<Promise<void> | null>(null);
  const hasOpenedRef = useRef(false);

  useEffect(() => setMounted(true), []);

  /** the prose, fetched once per session */
  const load = useCallback(() => {
    if (!loadRef.current) {
      loadRef.current = import("@/data/guide").then((mod) => {
        setData({ rooms: mod.GUIDE_ROOM_BY_KEY, bindings: mod.GUIDE_GLOBAL_BINDINGS });
      });
    }
    return loadRef.current;
  }, []);

  /** a route change closes it — the next room asks for itself or not at all */
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  /** the page behind must not scroll under the sheet */
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  /**
   * Seal the keyboard while open. Captured at the window, before the bubble
   * phase any room listens on, so nothing behind the sheet answers an arrow
   * key or an escape meant for this dialog. stopPropagation leaves default
   * actions alone, so buttons, links and scrolling inside the sheet still work.
   */
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
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
  }, [open]);

  /** focus moves in on open and comes home to the `?` on close */
  useEffect(() => {
    if (open) {
      hasOpenedRef.current = true;
      const target =
        dialogRef.current?.querySelector<HTMLElement>("button, a[href], summary") ??
        dialogRef.current;
      target?.focus({ preventScroll: true });
    } else if (hasOpenedRef.current) {
      buttonRef.current?.focus({ preventScroll: true });
    }
  }, [open, data]);

  if (!mounted || !key || typeof document === "undefined") return null;

  const room = data?.rooms[key] ?? null;

  return createPortal(
    <>
      <button
        ref={buttonRef}
        type="button"
        className="t-mono oda-help-button"
        aria-label="how to hold this room"
        aria-haspopup="dialog"
        aria-expanded={open}
        onPointerEnter={() => void load()}
        onFocus={() => void load()}
        onClick={() => {
          void load();
          setOpen((was) => !was);
        }}
      >
        <span aria-hidden="true">?</span>
      </button>

      {open ? (
        <div
          className="oda-help-scrim"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={TITLE_ID}
            tabIndex={-1}
            className="oda-help-panel"
          >
            <button
              type="button"
              className="t-mono oda-help-close"
              aria-label="close"
              onClick={() => setOpen(false)}
            >
              <span aria-hidden="true">×</span>
            </button>

            {room ? (
              <>
                <p className="t-mono oda-help-eyebrow">field guide</p>
                <h2 id={TITLE_ID} className="t-h3 oda-help-title">
                  <em>{room.title}</em>
                </h2>
                {room.scale ? <p className="t-mono oda-help-scale">{room.scale}</p> : null}
                <p className="t-body oda-help-essence">{room.essence}</p>

                <details className="oda-help-section" open>
                  <summary className="t-mono oda-help-summary">moves</summary>
                  <ul className="oda-help-moves">
                    {room.moves.map((move) => {
                      const [gesture, ...rest] = move.split("→");
                      return (
                        <li key={move}>
                          <span className="t-mono oda-help-gesture">{gesture.trim()}</span>
                          <span className="t-body oda-help-answer">{rest.join("→").trim()}</span>
                        </li>
                      );
                    })}
                  </ul>
                </details>

                {room.finds.length > 0 ? (
                  <details className="oda-help-section" open>
                    <summary className="t-mono oda-help-summary">for the patient hand</summary>
                    <ul className="oda-help-finds">
                      {room.finds.map((find) => (
                        <li key={find} className="t-body oda-help-answer">
                          {find}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                {room.keeps ? (
                  <details className="oda-help-section" open>
                    <summary className="t-mono oda-help-summary">it keeps</summary>
                    <p className="t-body oda-help-answer oda-help-keeps">{room.keeps}</p>
                  </details>
                ) : null}

                <details className="oda-help-section">
                  <summary className="t-mono oda-help-summary">anywhere</summary>
                  <ul className="oda-help-moves">
                    {(data?.bindings ?? []).map((binding) => (
                      <li key={binding.gesture}>
                        <span className="t-mono oda-help-gesture">{binding.gesture}</span>
                        <span className="t-body oda-help-answer">{binding.meaning}</span>
                      </li>
                    ))}
                  </ul>
                </details>

                <Link className="t-mono oda-help-through" href="/guide">
                  the whole field guide →
                </Link>
              </>
            ) : (
              <p id={TITLE_ID} className="t-mono oda-help-waiting" aria-live="polite">
                …
              </p>
            )}
          </div>
        </div>
      ) : null}

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .oda-help-button {
          position: fixed;
          /* The bottom edge is one row: the candle bottom-left, <LetGo>
             bottom-centre, and this control bottom-right — all three sharing
             the same baseline (max(18px, safe-area), <LetGo>'s own line), so
             the chrome reads as a single shelf instead of a scatter. The
             sound toggle keeps its seat one step above (56–100, right 16);
             this sits directly under it in the same column. The tape's band
             (0–40) runs beneath — like <LetGo>, a control the hand means to
             press outranks that aria-hidden decoration. On narrow screens
             the centred <LetGo> pill never reaches this corner. */
          bottom: max(18px, env(safe-area-inset-bottom, 0px));
          right: calc(16px + env(safe-area-inset-right, 0px));
          /* above the sound toggle's 35 and the tape's 28; below the header
             panel (60) and the passage film (72), which both outrank chrome. */
          z-index: 36;
          width: 44px;
          height: 44px;
          appearance: none;
          -webkit-appearance: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          background: var(--paper);
          border: 1px solid var(--rule);
          color: var(--ink-2);
          font-size: 14px;
          line-height: 1;
          cursor: pointer;
          transition: color var(--t), border-color var(--t);
        }
        .oda-help-button:hover { color: var(--ink); border-color: var(--ink); }
        .oda-help-button:focus-visible { outline: 2px solid var(--sea); outline-offset: 2px; }

        .oda-help-scrim {
          position: fixed;
          inset: 0;
          z-index: 70;
          background: rgba(8, 10, 14, 0.52);
          display: flex;
          align-items: flex-end;
          justify-content: flex-end;
          padding: calc(12px + env(safe-area-inset-top, 0px))
                   calc(12px + env(safe-area-inset-right, 0px))
                   calc(12px + env(safe-area-inset-bottom, 0px))
                   calc(12px + env(safe-area-inset-left, 0px));
          animation: oda-help-in 180ms ease both;
        }
        @keyframes oda-help-in { from { opacity: 0; } to { opacity: 1; } }

        .oda-help-panel {
          position: relative;
          width: min(520px, 100%);
          max-height: min(78vh, 720px);
          overflow-y: auto;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
          background: var(--paper);
          border: 1px solid var(--rule);
          box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
          padding: 22px 20px 24px;
          color: var(--ink);
        }
        .oda-help-panel:focus { outline: none; }

        .oda-help-close {
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
        .oda-help-close:hover { color: var(--ink); }
        .oda-help-close:focus-visible { outline: 2px solid var(--sea); outline-offset: -2px; }

        .oda-help-eyebrow {
          color: var(--ink-2);
          opacity: 0.7;
          font-size: 10px;
          letter-spacing: 0.14em;
          margin: 0 44px 6px 0;
        }
        .oda-help-title { margin: 0 44px 4px 0; }
        .oda-help-scale { color: var(--ink-2); font-size: 11px; margin: 0 0 6px; }
        .oda-help-essence { margin: 0 0 14px; color: var(--ink); }

        .oda-help-section { border-top: 1px solid var(--rule); padding: 10px 0 2px; }
        /* Block, not flex: GlobalPretextText re-wraps every word on the page
           in its own span, and a flex summary would turn those words into
           unwrappable flex items. Same reason the link below stays inline. */
        .oda-help-summary {
          list-style: none;
          cursor: pointer;
          color: var(--ink-2);
          font-size: 11px;
          letter-spacing: 0.10em;
          line-height: 28px;
          min-height: 28px;
        }
        .oda-help-summary::-webkit-details-marker { display: none; }
        .oda-help-summary::before {
          content: "+";
          display: inline-block;
          width: 10px;
          margin-right: 8px;
          color: var(--ink-2);
        }
        .oda-help-section[open] > .oda-help-summary::before { content: "−"; }
        .oda-help-summary:hover { color: var(--ink); }
        .oda-help-summary:focus-visible { outline: 2px solid var(--sea); outline-offset: 2px; }

        .oda-help-moves, .oda-help-finds { list-style: none; margin: 6px 0 12px; padding: 0; }
        .oda-help-moves > li {
          display: grid;
          grid-template-columns: minmax(96px, 34%) 1fr;
          gap: 4px 12px;
          padding: 5px 0;
          border-top: 1px solid rgba(21, 23, 26, 0.07);
        }
        .oda-help-moves > li:first-child { border-top: 0; }
        .oda-help-finds > li { padding: 5px 0; }
        .oda-help-gesture { font-size: 11px; color: var(--ink-2); letter-spacing: 0.04em; }
        .oda-help-answer { font-size: 15px; line-height: 1.45; color: var(--ink); }
        .oda-help-keeps { margin: 6px 0 12px; }
        .oda-help-waiting { color: var(--ink-2); margin: 0; }

        .oda-help-through {
          display: inline-block;
          line-height: 40px;
          min-height: 40px;
          margin-top: 4px;
          font-size: 11px;
          letter-spacing: 0.08em;
          color: var(--ink-2);
          border-bottom: 1px solid var(--rule);
        }
        .oda-help-through:hover { color: var(--ink); border-bottom-color: var(--ink); }

        /* Mirrors SoundToggle's own breakpoint exactly: there the toggle drops
           its label and becomes a 44px square, so the seat moves in with it. */
        @media (max-width: 640px), (pointer: coarse) {
          .oda-help-button { right: calc(68px + env(safe-area-inset-right, 0px)); }
        }

        @media (max-width: 520px) {
          .oda-help-moves > li { grid-template-columns: 1fr; }
          .oda-help-panel { padding: 20px 16px 22px; max-height: 82vh; }
          .oda-help-answer { font-size: 14px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .oda-help-scrim { animation: none; }
          .oda-help-button { transition: none; }
        }
      `,
        }}
      />
    </>,
    document.body,
  );
}
