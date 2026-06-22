"use client";

import Link from "next/link";
import Sigil from "@/components/Sigil";

export default function SiteFooter() {
  return (
    <footer
      style={{
        minHeight: "calc(176px + env(safe-area-inset-bottom, 0px))",
        borderTop: "1px solid var(--rule)",
        padding: "24px var(--pad-x) calc(104px + env(safe-area-inset-bottom, 0px))",
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        alignItems: "center",
        gap: 16,
        background: "var(--paper)",
      }}
    >
      <span className="t-mono" style={kept}>kept since 2010</span>
      <Sigil size={14} style={{ color: "var(--ink-2)" }} />
      <span style={footerLinks}>
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
const footerLinks: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 18,
  paddingRight: "clamp(0px, calc((100vw - 700px) * 0.6), 360px)",
};
