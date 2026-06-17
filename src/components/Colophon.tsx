"use client";

import Sigil from "@/components/Sigil";

export default function Colophon() {
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
            written entirely by hand. no analytics, no tracking, no email capture.
            send a message if something here is for you.
          </p>
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
