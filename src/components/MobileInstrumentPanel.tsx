"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

type MobileInstrumentPanelProps = {
  children: ReactNode;
  title?: string;
  triggerLabel?: string;
  summary?: ReactNode;
  className?: string;
  mobileEnabled?: boolean;
};

export const MOBILE_BREAKPOINT = 720;
export const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT}px)`;

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableControls(root: HTMLElement | null) {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  });
}

/**
 * Keeps an instrument's existing desktop console in place while turning the
 * same controls into an opt-in bottom sheet on phones. The artwork remains the
 * default mobile state; exact values and secondary actions stay available to
 * keyboard, switch, and touch users when they ask for them.
 */
export default function MobileInstrumentPanel({
  children,
  title = "tune & manage",
  triggerLabel = "tune",
  summary,
  className,
  mobileEnabled = true,
}: MobileInstrumentPanelProps) {
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const sheetRef = useRef<HTMLElement | null>(null);
  const openRef = useRef(false);
  const focusFrameRef = useRef<number | null>(null);

  const queueFocus = useCallback((target: "trigger" | "content") => {
    if (focusFrameRef.current !== null) window.cancelAnimationFrame(focusFrameRef.current);
    focusFrameRef.current = window.requestAnimationFrame(() => {
      focusFrameRef.current = null;
      if (target === "trigger") {
        triggerRef.current?.focus();
        return;
      }
      focusableControls(sheetRef.current)[0]?.focus();
    });
  }, []);

  const close = useCallback((focusTarget: "trigger" | "content" = "trigger") => {
    openRef.current = false;
    setOpen(false);
    queueFocus(focusTarget);
  }, [queueFocus]);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const sync = () => {
      setIsMobile(media.matches);
      if (!media.matches && openRef.current) close("content");
    };

    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [close]);

  useEffect(() => {
    if (!isMobile || !mobileEnabled || !open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;

      const controls = focusableControls(sheetRef.current);
      if (controls.length === 0) {
        event.preventDefault();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const inerted: Array<{ element: HTMLElement; inert: boolean }> = [];
    let branch: HTMLElement | null = panelRef.current;
    while (branch?.parentElement) {
      const parent: HTMLElement = branch.parentElement;
      Array.from(parent.children).forEach((sibling) => {
        if (sibling === branch || !(sibling instanceof HTMLElement)) return;
        inerted.push({ element: sibling, inert: sibling.inert });
        sibling.inert = true;
      });
      branch = parent;
      if (parent === document.body) break;
    }
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      inerted.forEach(({ element, inert }) => { element.inert = inert; });
      document.body.style.overflow = bodyOverflow;
    };
  }, [close, isMobile, mobileEnabled, open]);

  useEffect(() => {
    if (!mobileEnabled && openRef.current) close("content");
  }, [close, mobileEnabled]);

  useEffect(() => () => {
    if (focusFrameRef.current !== null) window.cancelAnimationFrame(focusFrameRef.current);
  }, []);

  return (
    <div
      ref={panelRef}
      className={`mobile-instrument-panel${className ? ` ${className}` : ""}`}
      data-open={open ? "true" : "false"}
      data-enabled={mobileEnabled ? "true" : "false"}
    >
      <button
        ref={triggerRef}
        type="button"
        className="mobile-instrument-panel__trigger"
        aria-expanded={open}
        aria-controls={`${titleId}-sheet`}
        onClick={() => {
          openRef.current = true;
          setOpen(true);
        }}
      >
        <span>{triggerLabel}</span>
        {summary ? <small>{summary}</small> : null}
      </button>

      <button
        type="button"
        className="mobile-instrument-panel__scrim"
        aria-label="close instrument controls"
        aria-hidden={!open}
        tabIndex={-1}
        onClick={() => close()}
      />

      <section
        ref={sheetRef}
        id={`${titleId}-sheet`}
        className="mobile-instrument-panel__sheet"
        role={isMobile && mobileEnabled ? "dialog" : undefined}
        aria-modal={isMobile && mobileEnabled ? "true" : undefined}
        aria-labelledby={titleId}
        aria-hidden={isMobile && mobileEnabled && !open ? "true" : undefined}
      >
        <div className="mobile-instrument-panel__header">
          <div>
            <span>instrument controls</span>
            <strong id={titleId}>{title}</strong>
          </div>
          <button ref={closeRef} type="button" onClick={() => close()}>close</button>
        </div>
        <div className="mobile-instrument-panel__content">{children}</div>
      </section>

      <style jsx global>{`
        .mobile-instrument-panel,
        .mobile-instrument-panel__sheet,
        .mobile-instrument-panel__content {
          display: contents;
        }

        .mobile-instrument-panel__trigger,
        .mobile-instrument-panel__scrim,
        .mobile-instrument-panel__header {
          display: none;
        }

        @media ${MOBILE_QUERY} {
          .mobile-instrument-panel__trigger {
            position: fixed;
            z-index: 122;
            left: max(14px, env(safe-area-inset-left, 0px));
            bottom: calc(68px + env(safe-area-inset-bottom, 0px));
            min-height: 42px;
            max-width: calc(100vw - 92px);
            display: inline-flex;
            align-items: center;
            gap: 9px;
            border: 1px solid rgba(244, 238, 222, 0.34);
            border-radius: 999px;
            padding: 0 14px;
            color: rgba(244, 238, 222, 0.94);
            background: rgba(7, 13, 20, 0.82);
            box-shadow: 0 12px 34px rgba(0, 0, 0, 0.24);
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
            font: 10px/1 var(--font-mono);
            letter-spacing: 0.09em;
            text-transform: lowercase;
            cursor: pointer;
          }

          .mobile-instrument-panel__trigger small {
            min-width: 0;
            overflow: hidden;
            color: rgba(244, 238, 222, 0.58);
            font: inherit;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .mobile-instrument-panel__trigger small::before {
            content: "·";
            margin-right: 9px;
          }

          .mobile-instrument-panel__scrim {
            position: fixed;
            z-index: 123;
            inset: 0;
            width: 100%;
            height: 100%;
            display: block;
            border: 0;
            padding: 0;
            background: rgba(2, 7, 12, 0.56);
            opacity: 0;
            pointer-events: none;
            transition: opacity 220ms ease;
          }

          .mobile-instrument-panel__sheet {
            position: fixed;
            z-index: 124;
            right: 0;
            bottom: 0;
            left: 0;
            max-height: min(72dvh, 620px);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            color: rgba(244, 238, 222, 0.94);
            background: rgba(7, 13, 20, 0.97);
            border: 1px solid rgba(244, 238, 222, 0.2);
            border-bottom: 0;
            border-radius: 20px 20px 0 0;
            box-shadow: 0 -24px 70px rgba(0, 0, 0, 0.42);
            transform: translateY(calc(100% + 8px));
            visibility: hidden;
            pointer-events: none;
            transition:
              transform 260ms cubic-bezier(.2, .72, .2, 1),
              visibility 0s linear 260ms;
          }

          .mobile-instrument-panel[data-open="true"] .mobile-instrument-panel__scrim {
            opacity: 1;
            pointer-events: auto;
          }

          .mobile-instrument-panel[data-open="true"] .mobile-instrument-panel__sheet {
            transform: translateY(0);
            visibility: visible;
            pointer-events: auto;
            transition-delay: 0s;
          }

          .mobile-instrument-panel__header {
            flex: none;
            min-height: 66px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            padding: 10px 14px 10px 18px;
            border-bottom: 1px solid rgba(244, 238, 222, 0.14);
          }

          .mobile-instrument-panel__header div {
            display: grid;
            gap: 4px;
          }

          .mobile-instrument-panel__header span,
          .mobile-instrument-panel__header strong,
          .mobile-instrument-panel__header button {
            font-family: var(--font-mono);
            text-transform: lowercase;
          }

          .mobile-instrument-panel__header span {
            color: rgba(244, 238, 222, 0.48);
            font-size: 8px;
            letter-spacing: 0.12em;
          }

          .mobile-instrument-panel__header strong {
            font-size: 12px;
            font-weight: 400;
            letter-spacing: 0.08em;
          }

          .mobile-instrument-panel__header button {
            min-width: 64px;
            min-height: 42px;
            border: 1px solid rgba(244, 238, 222, 0.24);
            border-radius: 999px;
            padding: 0 13px;
            color: inherit;
            background: transparent;
            font-size: 9px;
            letter-spacing: 0.08em;
            cursor: pointer;
          }

          .mobile-instrument-panel__content {
            min-height: 0;
            display: block;
            overflow: auto;
            overscroll-behavior: contain;
            padding: 14px 14px calc(20px + env(safe-area-inset-bottom, 0px));
            scrollbar-width: thin;
          }

          .mobile-instrument-panel[data-enabled="true"] .mobile-instrument-panel__content > * {
            position: relative !important;
            inset: auto !important;
            width: 100% !important;
            max-width: none !important;
            height: auto !important;
            max-height: none !important;
            margin: 0 !important;
            transform: none !important;
            opacity: 1 !important;
            pointer-events: auto !important;
          }

          .mobile-instrument-panel[data-enabled="false"] .mobile-instrument-panel__trigger,
          .mobile-instrument-panel[data-enabled="false"] .mobile-instrument-panel__scrim,
          .mobile-instrument-panel[data-enabled="false"] .mobile-instrument-panel__header {
            display: none;
          }

          .mobile-instrument-panel[data-enabled="false"] .mobile-instrument-panel__sheet,
          .mobile-instrument-panel[data-enabled="false"] .mobile-instrument-panel__content {
            display: contents;
            visibility: visible;
            transform: none;
            pointer-events: auto;
          }
        }

        @media ${MOBILE_QUERY} and (prefers-reduced-motion: reduce) {
          .mobile-instrument-panel__scrim,
          .mobile-instrument-panel__sheet {
            transition: none;
          }
        }
      `}</style>
    </div>
  );
}
