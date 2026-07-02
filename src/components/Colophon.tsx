"use client";

import { useState } from "react";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import Sigil from "@/components/Sigil";
import { useField } from "@/store/field";

const REGISTERS = [
  {
    id: "devotional",
    note: 57,
    tone: "var(--candle)",
    line: "a candle: attention given a small visible body.",
  },
  {
    id: "operational",
    note: 64,
    tone: "var(--sea)",
    line: "a command center: every surface answers touch.",
  },
  {
    id: "oceanic",
    note: 69,
    tone: "#A3CFCB",
    line: "the sea: a pattern that keeps changing and remains itself.",
  },
];

export default function Colophon() {
  const [activeRegister, setActiveRegister] = useState(REGISTERS[0]);
  const recordTape = useField((s) => s.recordTape);

  const playRegister = (register: typeof REGISTERS[number]) => {
    setActiveRegister(register);
    const audio = getFieldAudio();
    audio.playNote(register.note, 260);
    haptics.ripple(0.42);
    recordTape("sigil", 0.4, `colophon/${register.id}`);
  };

  return (
    <section id="colophon" className="rule" style={{ scrollMarginTop: 72 }}>
      <div className="wrap" style={{ maxWidth: 720 }}>
        <div className="t-eyebrow">colophon</div>
        <h2 className="t-h2 italic" style={{ marginTop: 12, marginBottom: 24 }}>
          what this is, and isn&rsquo;t
        </h2>

        <div className="t-body" style={{ display: "grid", gap: 16, maxWidth: "60ch" }}>
          <p>
            objet d&rsquo;art is not a portfolio. it is an instrument — a room you tune,
            an atlas you cross, an archive you keep.
          </p>
          <p>
            the page tries to hold three registers at once: devotional, operational,
            oceanic. a candle, a command center, the sea.
          </p>
          <p>
            written entirely by hand. quiet usage analytics may be enabled to see
            what people touch; no email capture. send a message if something here is for you.
          </p>
        </div>

        <div
          data-colophon-memory="true"
          style={{
            marginTop: 34,
            display: "grid",
            gap: 12,
            maxWidth: "min(60ch, calc(100vw - 108px))",
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            {REGISTERS.map((register) => {
              const active = activeRegister.id === register.id;
              return (
                <button
                  key={register.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => playRegister(register)}
                  className="t-mono"
                  style={{
                    minHeight: 44,
                    padding: "0 13px",
                    border: active ? `1px solid ${register.tone}` : "1px solid var(--rule)",
                    background: active ? "rgba(42, 74, 92, 0.08)" : "transparent",
                    color: active ? "var(--ink)" : "var(--ink-2)",
                    fontSize: 11,
                    letterSpacing: 0,
                    textTransform: "lowercase",
                    cursor: "pointer",
                  }}
                >
                  {register.id}
                </button>
              );
            })}
          </div>
          <div
            aria-live="polite"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              minHeight: 28,
              color: "var(--ink-2)",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: 17,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 28,
                height: 2,
                flex: "0 0 auto",
                background: activeRegister.tone,
                boxShadow: `0 0 14px ${activeRegister.tone}`,
              }}
            />
            <span>{activeRegister.line}</span>
          </div>
        </div>

        <div className="rule" style={{ marginTop: 40, paddingTop: 24 }}>
          <div className="t-eyebrow">credits</div>
          <ul style={{ listStyle: "none", padding: 0, margin: "14px 0 0", display: "grid", gap: 8 }}>
            <li className="t-meta">type · cormorant garamond + jetbrains mono</li>
            <li className="t-meta">palette · tidewater vellum</li>
            <li className="t-meta">build · next.js 14 · typescript · railway</li>
            <li className="t-meta">
              correspondence ·{" "}
              <a
                href="mailto:hello@objetdart.com"
                style={{ borderBottom: "1px solid var(--candle)", color: "var(--ink)" }}
              >
                hello@objetdart.com
              </a>
            </li>
          </ul>
        </div>

        <div style={{ marginTop: 56, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="t-mono" style={{ fontSize: 12, letterSpacing: "0.06em", textTransform: "lowercase", color: "var(--ink-2)" }}>
            kept since 2010
          </span>
          <span style={{ color: "var(--ink-2)" }}>
            <Sigil size={16} />
          </span>
          <span
            className="t-mono"
            style={{ fontSize: 12, letterSpacing: "0.06em", textTransform: "lowercase", color: "var(--ink-2)" }}
            suppressHydrationWarning
          >
            v1.0
          </span>
        </div>
      </div>
    </section>
  );
}
