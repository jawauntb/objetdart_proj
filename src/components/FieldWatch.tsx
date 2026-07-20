"use client";

import { usePathname } from "next/navigation";
import { useField } from "@/store/field";
import { deriveFieldState } from "@/lib/field-state";
import { isDarkRoute } from "@/lib/dark-routes";

/**
 * Field watch.
 *
 * A small, fixed panel that reads the user's current phenomenological
 * state as a list of eight short words — flow, pressure, bloom, ambient,
 * veto, value, ridge, undertow. The words are derived from the concern
 * vector and the recent tape, so they shift as the user moves through
 * the site. Quiet by design — no per-tick animation; values just change.
 */
export default function FieldWatch() {
  const concerns = useField((s) => s.concerns);
  const tape = useField((s) => s.tape);
  const pathname = usePathname() ?? "/";

  // Reading shares stay pristine; Atlas needs every pixel to remain map.
  if (pathname.startsWith("/reading/") || pathname.startsWith("/atlas/")) return null;

  // dark route palette — same rule as Tape
  const dark = isDarkRoute(pathname);

  const state = deriveFieldState(concerns, tape);

  const rows: [string, string][] = [
    ["flow", state.flow],
    ["pressure", state.pressure],
    ["bloom", state.bloom],
    ["ambient", state.ambient],
    ["veto", state.veto],
    ["value", state.value],
    ["ridge", state.ridge],
    ["undertow", state.undertow],
  ];

  const labelColor = dark ? "rgba(232, 226, 213, 0.55)" : "rgba(58, 61, 66, 0.55)";
  const valueColor = dark ? "rgba(232, 226, 213, 0.92)" : "rgba(21, 23, 26, 0.92)";
  const eyebrowColor = dark ? "rgba(232, 226, 213, 0.50)" : "rgba(58, 61, 66, 0.50)";

  return (
    <div
      aria-hidden="true"
      className="oda-field-watch"
      style={{
        position: "fixed",
        right: "calc(16px + env(safe-area-inset-right, 0px))",
        bottom: "calc(112px + env(safe-area-inset-bottom, 0px))",
        width: 220,
        padding: "12px 14px",
        zIndex: 28,
        // ambient panel — no interactive children, so it must never intercept
        // clicks meant for content underneath (cards, links in the corner).
        pointerEvents: "none",
        background: dark ? "rgba(14, 12, 12, 0.72)" : "rgba(242, 238, 230, 0.94)",
        border: `1px solid ${dark ? "rgba(232, 226, 213, 0.18)" : "var(--rule)"}`,
        backdropFilter: dark ? "blur(6px)" : undefined,
        WebkitBackdropFilter: dark ? "blur(6px)" : undefined,
      }}
    >
      {/* Narrow viewports: hide the panel entirely. It's a quiet ambient
          reading — it competes with the tape, sound toggle, and candle
          for the same corner on phones. */}
      <style>{`
        @media (max-width: 720px) { .oda-field-watch { display: none !important; } }
      `}</style>
      <div
        style={{
          fontFamily: "var(--font-mono, ui-monospace)",
          fontSize: 9.5,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          opacity: 0.5,
          color: eyebrowColor,
          marginBottom: 8,
        }}
      >
        field watch
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          columnGap: 12,
          rowGap: 4,
          alignItems: "baseline",
        }}
      >
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: "contents" }}>
            <span
              style={{
                fontFamily: "var(--font-mono, ui-monospace)",
                fontSize: 10,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                opacity: 0.55,
                color: labelColor,
              }}
            >
              {label}
            </span>
            <span
              style={{
                fontFamily: "var(--font-fraunces, Georgia), serif",
                fontWeight: 500,
                fontSize: 13,
                fontVariantNumeric: "lining-nums",
                opacity: 0.92,
                color: valueColor,
                textAlign: "right",
              }}
            >
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
