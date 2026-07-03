"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Sigil from "@/components/Sigil";
import RouteSigil from "@/components/RouteSigil";
import ConstellationGlyph from "@/components/ConstellationGlyph";
import { isDarkRoutePath, PRIMARY_ROUTE_KEYS, SITE_ROUTE_BY_KEY, SITE_ROUTES } from "@/lib/routes";

export default function SiteHeader() {
  const pathname = usePathname() ?? "/";
  const isHome = pathname === "/";
  const dark = isDarkRoutePath(pathname);

  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const hasOpenedPanelRef = useRef(false);
  // swipe-to-dismiss tracking (drag the panel rightward off-screen on mobile)
  const dragRef = useRef<{ startX: number; startY: number; pointerId: number } | null>(null);
  const [dragOffset, setDragOffset] = useState(0);

  const close = useCallback(() => setOpen(false), []);

  // Body scroll lock while the panel is open.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const handleAnchor = (e: React.MouseEvent, id: string) => {
    if (!isHome) return; // let the Link navigate
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const scrollTop = () => {
    if (isHome) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  // ESC closes; Tab traps focus within the panel while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // On open: focus the first interactive in the panel. On close: restore focus to the toggle.
  useEffect(() => {
    if (open) {
      hasOpenedPanelRef.current = true;
      const first = panelRef.current?.querySelector<HTMLElement>("button, a[href]");
      first?.focus();
    } else if (hasOpenedPanelRef.current) {
      toggleRef.current?.focus({ preventScroll: true });
      // reset any pending swipe offset when the panel closes
      setDragOffset(0);
    }
  }, [open]);

  // Mobile swipe-right-to-dismiss handlers. Tracks a horizontal drag and
  // closes when the panel has been dragged > 80px to the right.
  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (typeof window === "undefined" || window.innerWidth > 699) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, textarea, select")) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, pointerId: e.pointerId };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    // cancel if the gesture is clearly vertical (let the panel scroll)
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 12) {
      dragRef.current = null;
      setDragOffset(0);
      return;
    }
    setDragOffset(Math.max(0, dx));
  };

  const endDrag = (commit: boolean) => {
    const offset = dragOffset;
    dragRef.current = null;
    setDragOffset(0);
    if (commit && offset > 80) close();
  };

  const onPointerUp = () => endDrag(true);
  const onPointerCancel = () => endDrag(false);

  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const headerInk = dark ? "rgba(244, 238, 222, 0.96)" : "var(--ink)";
  const headerInk2 = dark ? "rgba(232,226,213,0.78)" : "var(--ink-2)";

  return (
    <>
      <header
        className="oda-site-header"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          // grow by the top safe-area inset (notch) so content stays clear of
          // the device bezel under viewport-fit=cover; the bar itself remains
          // 56px tall below the inset.
          height: "calc(56px + env(safe-area-inset-top, 0px))",
          background: dark ? "rgba(8, 17, 28, 0.72)" : "var(--paper)",
          backdropFilter: dark ? "blur(8px)" : undefined,
          WebkitBackdropFilter: dark ? "blur(8px)" : undefined,
          borderBottom: dark ? "1px solid rgba(232, 226, 213, 0.10)" : "1px solid var(--rule)",
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingLeft: "max(var(--pad-x), env(safe-area-inset-left, 0px))",
          paddingRight: "max(var(--pad-x), env(safe-area-inset-right, 0px))",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Link
          href="/"
          onClick={scrollTop}
          aria-label="objet d'art — home"
          style={{
            fontFamily: "var(--font-serif)",
            fontWeight: 500,
            fontSize: 20,
            letterSpacing: "-0.015em",
            color: headerInk,
            display: "inline-flex",
            alignItems: "center",
            minHeight: 44,
          }}
        >
          objet d&rsquo;art
        </Link>

        <nav style={{ display: "flex", alignItems: "center", gap: "clamp(8px, 2vw, 22px)" }}>
          {/* Inline primary nav — hidden under 900px via scoped CSS below */}
          <div className="oda-primary-nav" style={{ alignItems: "center", gap: 22 }}>
            {PRIMARY_ROUTE_KEYS.map((k) => {
              const r = SITE_ROUTE_BY_KEY[k];
              const onClick = r.anchor
                ? (e: React.MouseEvent) => handleAnchor(e, r.anchor as string)
                : undefined;
              const href = r.anchor && isHome ? `#${r.anchor}` : r.href;
              return (
                <Link
                  key={r.key}
                  className="t-mono"
                  href={href}
                  onClick={onClick}
                  style={dark ? navLinkDark : navLink}
                >
                  {r.key}
                </Link>
              );
            })}
          </div>

          {/* back-to-top home sigil — stays BEFORE view-all */}
          <Link
            href="/"
            onClick={(e) => {
              if (isHome) {
                e.preventDefault();
                scrollTop();
              }
            }}
            aria-label="back to top"
            style={{
              color: headerInk2,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 44,
              minHeight: 44,
            }}
          >
            <Sigil size={14} />
          </Link>

          {/* view-all toggle */}
          <button
            ref={toggleRef}
            type="button"
            aria-label="view all routes"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: "0 12px",
              minHeight: 44,
              minWidth: 44,
              border: `1px solid ${dark ? "rgba(232,226,213,0.28)" : "var(--rule)"}`,
              borderRadius: 999,
              background: "transparent",
              color: dark ? "rgba(232,226,213,0.92)" : "var(--ink)",
              fontFamily: "var(--font-text)",
              fontSize: 12,
              letterSpacing: "0.06em",
              textTransform: "lowercase",
              cursor: "pointer",
              transition: "color var(--t), border-color var(--t), background var(--t)",
            }}
          >
            view all
            <ConstellationGlyph size={18} style={{ opacity: 0.92 }} />
          </button>
        </nav>
      </header>

      {/* scrim — click to close */}
      <div
        onClick={close}
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.32)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 280ms cubic-bezier(.2,.6,.2,1)",
          zIndex: 59,
        }}
      />

      {/* the constellation panel */}
      <aside
        ref={panelRef}
        role={open ? "dialog" : undefined}
        aria-modal={open ? "true" : undefined}
        aria-label="all routes"
        aria-hidden={!open}
        className="oda-panel"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          height: "100vh",
          width: "clamp(320px, 36vw, 480px)",
          background: dark ? "rgba(8, 17, 28, 0.92)" : "var(--paper)",
          backdropFilter: dark ? "blur(14px)" : undefined,
          WebkitBackdropFilter: dark ? "blur(14px)" : undefined,
          borderLeft: dark ? "1px solid rgba(232, 226, 213, 0.10)" : "1px solid var(--rule)",
          color: dark ? "rgba(232,226,213,0.92)" : "var(--ink)",
          transform: open
            ? `translateX(${dragOffset}px)`
            : "translateX(100%)",
          transition:
            dragOffset > 0 || reduceMotion
              ? "none"
              : "transform 280ms cubic-bezier(.2,.6,.2,1)",
          zIndex: 60,
          pointerEvents: open ? "auto" : "none",
          padding:
            "max(24px, env(safe-area-inset-top, 0px)) 28px calc(32px + env(safe-area-inset-bottom, 0px))",
          display: "flex",
          flexDirection: "column",
          gap: 22,
          overflowY: "auto",
          overscrollBehavior: "contain",
          touchAction: "pan-y",
        }}
      >
        {/* title row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div
              className="t-mono"
              style={{
                fontSize: 11,
                letterSpacing: "0.10em",
                textTransform: "lowercase",
                opacity: 0.65,
                marginBottom: 6,
              }}
            >
              the constellation
            </div>
            <div
              style={{
                fontFamily: "var(--font-numerals)",
                fontWeight: 300,
                fontSize: 26,
                lineHeight: 1.15,
                letterSpacing: "-0.01em",
                color: dark ? "rgba(244,238,222,0.96)" : "var(--ink)",
              }}
            >
              all that the room is
            </div>
          </div>

          <button
            type="button"
            onClick={close}
            aria-label="close"
            style={{
              border: `1px solid ${dark ? "rgba(232,226,213,0.28)" : "var(--rule)"}`,
              borderRadius: 4,
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
              padding: "10px 14px",
              minHeight: 44,
              minWidth: 44,
              fontFamily: "var(--font-text)",
              fontSize: 13,
              letterSpacing: "0.06em",
              textTransform: "lowercase",
              lineHeight: 1,
              opacity: 0.85,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            close ×
          </button>
        </div>

        <div
          style={{
            height: 1,
            background: dark ? "rgba(232,226,213,0.14)" : "var(--rule)",
          }}
        />

        {/* the rows */}
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          {SITE_ROUTES.map((r) => {
            const isCurrent =
              pathname === r.href ||
              (r.href !== "/" && pathname.startsWith(r.href));
            const href = r.anchor && isHome ? `#${r.anchor}` : r.href;
            const onClick = (e: React.MouseEvent) => {
              if (r.anchor) handleAnchor(e, r.anchor);
              close();
            };
            return (
              <li key={r.key}>
                <Link
                  href={href}
                  onClick={onClick}
                  className="oda-row"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "28px 1fr auto",
                    alignItems: "center",
                    gap: 14,
                    minHeight: 44,
                    padding: "8px",
                    borderRadius: 4,
                    color: "inherit",
                    opacity: isCurrent ? 1 : 0.92,
                  }}
                >
                  <span
                    className="oda-row__sigil"
                    style={{
                      display: "inline-flex",
                      width: 24,
                      height: 24,
                      alignItems: "center",
                      justifyContent: "center",
                      color: dark ? "rgba(232,226,213,0.86)" : "var(--ink-2)",
                      transition: "transform var(--t), color var(--t)",
                    }}
                  >
                    <RouteSigil kind={r.icon} size={24} />
                  </span>
                  <span
                    className="t-mono"
                    style={{
                      fontSize: 14,
                      letterSpacing: "0.04em",
                      textTransform: "lowercase",
                      color: dark ? "rgba(244,238,222,0.96)" : "var(--ink)",
                    }}
                  >
                    {r.key}
                  </span>
                  <span
                    className="oda-row__desc t-mono"
                    style={{
                      fontSize: 11,
                      letterSpacing: "0.04em",
                      opacity: 0.5,
                      textAlign: "right",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r.desc}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* scoped styles for the panel hover + nav responsiveness */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            .oda-primary-nav { display: flex; }
            .oda-row { transition: background var(--t), color var(--t); }
            .oda-row:hover { background: ${dark ? "rgba(232,226,213,0.06)" : "rgba(21,23,26,0.04)"}; }
            .oda-row:hover .oda-row__sigil { transform: scale(1.12); color: ${dark ? "rgba(244,238,222,0.98)" : "var(--ink)"}; }
            @media (max-width: 899px) { .oda-primary-nav { display: none !important; } }
            @supports (height: 100dvh) { .oda-panel { height: 100dvh !important; } }
            @media (max-width: 699px) {
              .oda-panel {
                width: min(420px, calc(100vw - 48px)) !important;
                padding: max(18px, env(safe-area-inset-top, 0px)) 18px calc(24px + env(safe-area-inset-bottom, 0px)) !important;
              }
              .oda-row { grid-template-columns: 28px 1fr !important; }
              .oda-row__desc { display: none !important; }
            }
          `,
        }}
      />
    </>
  );
}

const navLink: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 44,
  fontSize: 12,
  letterSpacing: "0.06em",
  textTransform: "lowercase",
  color: "var(--ink-2)",
  transition: "color var(--t)",
};

const navLinkDark: React.CSSProperties = {
  ...navLink,
  color: "rgba(232, 226, 213, 0.74)",
};
