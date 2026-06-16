"use client";

import { useEffect, useRef, useState } from "react";
import { useField } from "@/store/field";
import { OBJECTS, REGIONS, ARCHIVE } from "@/data/content";
import type { SymbolObject, FieldTrace, ConcernKey } from "@/lib/types";

export function SymbolCard({
  object, onClose,
}: {
  object: SymbolObject | null;
  anchor: DOMRect | null;
  onClose: () => void;
}) {
  const open = !!object;
  return (
    <aside
      role="dialog"
      aria-label={object?.label ?? "Object card"}
      aria-hidden={!open}
      style={{
        position: "absolute",
        top: "3.4rem",
        right: 0,
        bottom: "4.4rem",
        width: "min(220px, 76vw)",
        zIndex: 65,
        background: "linear-gradient(180deg, rgba(7,21,33,.94), rgba(7,21,33,.86))",
        borderLeft: "1px solid rgba(185,136,60,.22)",
        padding: "1.1rem 1rem",
        transform: open ? "none" : "translateX(105%)",
        transition: "transform .42s cubic-bezier(.2,.8,.2,1)",
        pointerEvents: open ? "auto" : "none",
        display: "flex",
        flexDirection: "column",
        gap: ".55rem",
      }}
    >
      {object && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: ".5rem", letterSpacing: ".28em", textTransform: "uppercase", color: "#D6A84A" }}>
              {object.means.join(" · ")}
            </span>
            <button
              onClick={onClose}
              aria-label="Close card"
              style={{
                background: "none", border: "none", color: "#7B7F80", cursor: "pointer",
                fontFamily: "var(--font-mono)", fontSize: ".62rem", padding: 0, lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>
          <h3 style={{ fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: "1.55rem", margin: 0, color: "#EFE5D0", letterSpacing: ".005em", lineHeight: 1.05 }}>
            {object.label}
          </h3>
          <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontWeight: 300, fontSize: ".98rem", color: "#D8A08E", lineHeight: 1.32, maxWidth: "22ch" }}>
            {object.inscription}
          </div>
          <div style={{ height: 1, background: "rgba(185,136,60,.18)", margin: ".15rem 0 .1rem" }} />
          <div style={{ fontFamily: "var(--font-body)", fontSize: ".74rem", color: "#F7F1E6", opacity: 0.78, lineHeight: 1.5, maxWidth: "28ch" }}>
            {object.fn}
          </div>
        </>
      )}
    </aside>
  );
}

const CMD_OPTS = ["show risk", "open archive", "route love to work", "calibrate prayer", "reveal systems", "reset field"];

export function CommandChapel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const runCommand = useField((s) => s.runCommand);
  const inputRef = useRef<HTMLInputElement>(null);
  const [val, setVal] = useState("");
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 80); }, [open]);
  if (!open) return null;
  const run = (q: string) => { runCommand(q); setVal(""); onClose(); };
  return (
    <div
      role="dialog" aria-label="Command chapel"
      style={{
        position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 80,
        width: "min(440px,90vw)", background: "rgba(16,24,32,.98)", border: "1px solid rgba(185,136,60,.4)",
        borderRadius: 5, padding: "1rem", backdropFilter: "blur(10px)",
      }}
    >
      <input
        ref={inputRef}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") run(val); }}
        placeholder="show risk · route love to work · reset field…"
        aria-label="Command"
        style={{ width: "100%", background: "none", border: "none", borderBottom: "1px solid rgba(185,136,60,.3)", color: "#F7F1E6", fontFamily: "var(--font-serif)", fontSize: "1.3rem", padding: ".4rem .2rem", outline: "none" }}
      />
      <div style={{ display: "flex", flexWrap: "wrap", gap: ".35rem", marginTop: ".8rem" }}>
        {CMD_OPTS.map((q) => (
          <button
            key={q}
            onClick={() => run(q)}
            style={{ background: "none", border: "1px solid rgba(185,136,60,.3)", color: "#7B7F80", fontFamily: "var(--font-mono)", fontSize: ".55rem", letterSpacing: ".14em", textTransform: "uppercase", padding: ".4rem .6rem", borderRadius: 2, cursor: "pointer" }}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

function Seal({ top, regionLabel }: { top: ConcernKey[]; regionLabel: string }) {
  const a = (top.join("").length + regionLabel.length) % 360;
  return (
    <svg width={64} height={64} viewBox="0 0 64 64" aria-hidden="true" style={{ display: "block", margin: "0 auto .6rem" }}>
      <circle cx="32" cy="32" r="28" fill="none" stroke="#B9883C" strokeWidth="1" />
      <path d="M4 38 Q16 30 32 38 T60 38" fill="none" stroke="#1F6F73" strokeWidth="1.2" />
      <g transform={`rotate(${a} 32 32)`}><path d="M32 10 L34 30 L32 32 L30 30 Z" fill="#D6A84A" /></g>
      <circle cx="32" cy="32" r="2" fill="#D8A08E" />
      <path d="M20 20h24M20 44h24" stroke="rgba(185,136,60,.4)" strokeWidth=".5" />
    </svg>
  );
}

export function FieldReading({ trace, onClose }: { trace: FieldTrace | null; onClose: () => void }) {
  const traceCount = useField((s) => s.traces.length);
  const setFlash = useField((s) => s.setFlash);
  if (!trace) return null;
  const top = (Object.entries(trace.concerns) as [ConcernKey, number][])
    .sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]);
  const region = REGIONS.find((r) => r.id === trace.region);
  const rec = ARCHIVE.find((a) => a.id === trace.archiveId);
  const objLabels = trace.objects.map((id) => OBJECTS.find((o) => o.id === id)?.label.toLowerCase() ?? id);
  const fromLabel = trace.route ? REGIONS.find((r) => r.id === trace.route!.from)?.label : null;

  const row: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: ".6rem", letterSpacing: ".14em", textTransform: "uppercase", color: "#7B7F80", margin: ".35rem 0", textAlign: "center" };
  const btn: React.CSSProperties = { background: "none", border: "1px solid #D6A84A", color: "#D6A84A", fontFamily: "var(--font-mono)", fontSize: ".58rem", letterSpacing: ".18em", textTransform: "uppercase", padding: ".5rem .8rem", borderRadius: 2, cursor: "pointer" };

  return (
    <div
      role="dialog" aria-label="Field reading"
      style={{
        position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 80,
        width: "min(380px,90vw)", background: "rgba(7,21,33,.98)", border: "1px solid #D6A84A",
        borderRadius: 5, padding: "1.3rem", boxShadow: "0 0 80px rgba(214,168,74,.25)",
      }}
    >
      <Seal top={top} regionLabel={region?.label ?? ""} />
      <h2 style={{ textAlign: "center", fontFamily: "var(--font-mono)", fontSize: ".62rem", letterSpacing: ".26em", color: "#D6A84A", textTransform: "uppercase" }}>
        Field reading
      </h2>
      {fromLabel && <div style={row}>route · <b style={{ color: "#F7F1E6", fontWeight: 500 }}>{fromLabel} → {region?.label}</b></div>}
      <div style={row}>objects · <b style={{ color: "#F7F1E6", fontWeight: 500 }}>{objLabels.join(" / ")}</b></div>
      <div style={row}>concerns · <b style={{ color: "#F7F1E6", fontWeight: 500 }}>{top.join(", ")}</b></div>
      <div style={row}>archive · <b style={{ color: "#F7F1E6", fontWeight: 500 }}>{rec?.title}</b></div>
      <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: "1.3rem", color: "#D8A08E", textAlign: "center", margin: ".8rem 0" }}>
        {trace.inscription}
      </div>
      <div style={{ display: "flex", gap: ".4rem", justifyContent: "center", marginTop: ".6rem", flexWrap: "wrap" }}>
        <button
          style={btn}
          onClick={() => {
            navigator.clipboard?.writeText(
              `FIELD READING\nconcerns: ${top.join(", ")}\nobjects: ${objLabels.join(" / ")}\nregion: ${region?.label}\n— ${trace.inscription}`,
            );
            setFlash("Trace copied.");
          }}
        >
          Copy
        </button>
        <button style={btn} onClick={onClose}>Leave</button>
      </div>
      <div style={{ ...row, marginTop: ".6rem", opacity: 0.6 }}>
        {traceCount} trace{traceCount === 1 ? "" : "s"} saved · {new Date(trace.timestamp).toLocaleString()}
      </div>
    </div>
  );
}
