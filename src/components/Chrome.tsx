"use client";

import { useField } from "@/store/field";
import { PHASES } from "@/data/content";
import type { LensKey, ModeKey } from "@/lib/types";

const LENSES: LensKey[] = ["ritual", "systems", "body", "archive", "horizon"];
const MODES: { id: ModeKey; label: string }[] = [
  { id: "window", label: "Window" },
  { id: "table", label: "Table" },
  { id: "console", label: "Console" },
  { id: "atlas", label: "Atlas" },
  { id: "archive", label: "Archive" },
  { id: "command", label: "⌘" },
];

export function TopBar() {
  const entered = useField((s) => s.entered);
  const lens = useField((s) => s.lens);
  const setLens = useField((s) => s.setLens);
  if (!entered) return null;
  return (
    <div
      style={{
        position: "absolute", top: 0, left: 0, right: 0, display: "flex",
        alignItems: "baseline", justifyContent: "space-between",
        padding: "1.05rem 1.5rem .8rem", zIndex: 30,
      }}
    >
      <span style={{
        fontFamily: "var(--font-serif)", fontStyle: "italic", fontWeight: 400,
        fontSize: "1.02rem", color: "rgba(216,160,142,.72)", letterSpacing: ".005em",
      }}>
        a candle inside the command center
      </span>
      <div role="group" aria-label="Interpretive lens" style={{
        display: "flex", gap: ".55rem", alignItems: "baseline",
        fontFamily: "var(--font-mono)", fontSize: ".55rem",
        letterSpacing: ".26em", textTransform: "uppercase",
      }}>
        {LENSES.map((l, i) => {
          const on = lens === l;
          return (
            <span key={l} style={{ display: "flex", alignItems: "baseline", gap: ".55rem" }}>
              {i > 0 && <span style={{ color: "rgba(155,160,165,.35)" }}>·</span>}
              <button
                aria-pressed={on}
                onClick={() => setLens(l)}
                style={{
                  background: "none", border: "none", padding: 0, cursor: "pointer",
                  color: on ? "#E2B968" : "rgba(155,160,165,.55)",
                  font: "inherit", letterSpacing: ".26em", textTransform: "uppercase",
                  transition: "color .25s",
                }}
              >
                {l}
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function ModeNav() {
  const entered = useField((s) => s.entered);
  const mode = useField((s) => s.mode);
  const setMode = useField((s) => s.setMode);
  if (!entered) return null;
  return (
    <div
      role="group"
      aria-label="Modes"
      style={{
        position: "absolute", bottom: 0, left: 0, right: 0, display: "flex",
        justifyContent: "center", gap: ".5rem", padding: "1rem 1rem 1.1rem", zIndex: 30,
        alignItems: "baseline",
      }}
    >
      {MODES.map((m, i) => {
        const on = mode === m.id;
        return (
          <span key={m.id} style={{ display: "flex", alignItems: "baseline", gap: ".5rem" }}>
            {i > 0 && <span style={{ color: "rgba(155,160,165,.3)", fontSize: ".6rem" }}>·</span>}
            <button
              aria-pressed={on}
              onClick={() => setMode(m.id)}
              style={{
                background: "none", border: "none", padding: 0, cursor: "pointer",
                color: on ? "#E2B968" : "rgba(155,160,165,.55)",
                fontFamily: "var(--font-mono)", fontSize: ".55rem",
                letterSpacing: ".26em", textTransform: "uppercase",
                transition: "color .25s",
              }}
            >
              {m.label}
            </button>
          </span>
        );
      })}
    </div>
  );
}

export function TideScrub() {
  const entered = useField((s) => s.entered);
  const phase = useField((s) => s.phase);
  const setPhase = useField((s) => s.setPhase);
  if (!entered) return null;
  return (
    <div style={{ position: "absolute", left: "1rem", right: "1rem", bottom: "3.6rem", zIndex: 28, display: "flex", alignItems: "center", gap: ".6rem" }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: ".55rem", letterSpacing: ".18em", textTransform: "uppercase", color: "#D6A84A", width: "5em", flex: "none" }}>
        {PHASES[phase]}
      </span>
      <input
        type="range" min={0} max={6} step={1} value={phase}
        onChange={(e) => setPhase(+e.target.value)}
        aria-label="Temporal phase" aria-valuetext={PHASES[phase]}
        style={{ flex: 1 }}
      />
    </div>
  );
}

export function Panel({ open, label, children }: { open: boolean; label: string; children: React.ReactNode }) {
  return (
    <div
      role="region"
      aria-label={label}
      aria-hidden={!open}
      style={{
        position: "absolute", inset: "auto 0 0 0", zIndex: 25, maxHeight: "62%",
        background: "linear-gradient(0deg,rgba(7,21,33,.97),rgba(7,21,33,.82))",
        borderTop: "1px solid rgba(185,136,60,.3)", overflowY: "auto",
        padding: "1rem 1.1rem 5rem",
        transform: open ? "none" : "translateY(100%)",
        transition: "transform .45s cubic-bezier(.2,.8,.2,1)",
        pointerEvents: open ? "auto" : "none",
        WebkitOverflowScrolling: "touch",
      }}
    >
      {children}
    </div>
  );
}

export function Scrim({ show, onClose }: { show: boolean; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      aria-hidden="true"
      style={{
        position: "absolute", inset: 0, zIndex: 24, background: "rgba(7,21,33,.4)",
        opacity: show ? 1 : 0, pointerEvents: show ? "auto" : "none", transition: "opacity .3s",
      }}
    />
  );
}

export function Flash() {
  const flash = useField((s) => s.flash);
  if (!flash) return null;
  return (
    <div
      style={{
        position: "absolute", top: "3.2rem", left: "50%", transform: "translateX(-50%)", zIndex: 90,
        fontFamily: "var(--font-mono)", fontSize: ".6rem", letterSpacing: ".16em", textTransform: "uppercase",
        color: "#071521", background: "#D6A84A", padding: ".5rem .9rem", borderRadius: 2, pointerEvents: "none",
      }}
      role="status"
    >
      {flash}
    </div>
  );
}
