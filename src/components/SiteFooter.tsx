"use client";

import Link from "next/link";
import Sigil from "@/components/Sigil";

export default function SiteFooter() {
  return (
    <footer
      style={{
        minHeight: "calc(80px + env(safe-area-inset-bottom, 0px))",
        borderTop: "1px solid var(--rule)",
        padding: "0 var(--pad-x) env(safe-area-inset-bottom, 0px)",
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        alignItems: "center",
        gap: 16,
        background: "var(--paper)",
      }}
    >
      <span className="t-mono" style={kept}>kept since 2010</span>
      <Sigil size={14} style={{ color: "var(--ink-2)" }} />
      <span style={{ display: "flex", justifyContent: "flex-end", gap: 18 }}>
        <Link className="t-mono" href="/colophon" style={link}>colophon</Link>
        <Link className="t-mono" href="/archive" style={link}>archive</Link>
      </span>
    </footer>
  );
}

const kept: React.CSSProperties = {
  fontSize: 12,
  letterSpacing: "0.06em",
  textTransform: "lowercase",
  color: "var(--ink-2)",
};
const link: React.CSSProperties = {
  ...kept,
  display: "inline-flex",
  alignItems: "center",
  minHeight: 44,
  transition: "color var(--t)",
};
