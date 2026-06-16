"use client";

import { useEffect, useRef, useState } from "react";
import { useField } from "@/store/field";
import { REGIONS, OBJECTS, ARCHIVE } from "@/data/content";

export default function ConcernAtlas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef({ x: 0, y: 0, z: 1 });
  const pan = useRef<{ active: boolean; last: { x: number; y: number } | null }>({ active: false, last: null });
  const [from, setFrom] = useState("origin");
  const [to, setTo] = useState("workbench");

  const route = useField((s) => s.route);
  const makeRoute = useField((s) => s.makeRoute);
  const generateReading = useField((s) => s.generateReading);
  const setMode = useField((s) => s.setMode);

  const drawAtlas = () => {
    const ac = canvasRef.current;
    if (!ac) return;
    const ctx = ac.getContext("2d");
    if (!ctx) return;
    const r = ac.getBoundingClientRect();
    if (ac.width !== r.width * 2) {
      ac.width = r.width * 2;
      ac.height = r.height * 2;
      ctx.setTransform(2, 0, 0, 2, 0, 0);
    }
    const w = ac.width / 2;
    const h = ac.height / 2;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(7,21,33,.6)";
    ctx.fillRect(0, 0, w, h);
    const v = view.current;
    const px = (rg: { x: number }) => v.x + rg.x * w * v.z;
    const py = (rg: { y: number }) => v.y + rg.y * h * v.z;

    const rt = useField.getState().route;
    if (rt) {
      const a = REGIONS.find((x) => x.id === rt.from)!;
      const b = REGIONS.find((x) => x.id === rt.to)!;
      ctx.strokeStyle = "rgba(214,168,74,.7)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(px(a), py(a));
      ctx.quadraticCurveTo((px(a) + px(b)) / 2, Math.min(py(a), py(b)) - 30, px(b), py(b));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const rg of REGIONS) {
      const x = px(rg);
      const y = py(rg);
      const active = rt && (rt.from === rg.id || rt.to === rg.id);
      ctx.beginPath();
      ctx.arc(x, y, active ? 7 : 4, 0, 7);
      ctx.fillStyle = active ? "#D6A84A" : "rgba(31,111,115,.8)";
      ctx.fill();
      ctx.fillStyle = active ? "#EFE5D0" : "rgba(123,127,128,.9)";
      ctx.font = "9px IBM Plex Mono, monospace";
      ctx.fillText(rg.label, x + 8, y + 3);
    }
  };

  useEffect(() => {
    drawAtlas();
    const onResize = () => drawAtlas();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  const routeObjects = route
    ? OBJECTS.filter((o) => route.objects.includes(o.id)).map((o) => o.label.toLowerCase())
    : [];
  const routeEntries = route
    ? ARCHIVE.filter((a) => route.entries.includes(a.id)).map((a) => a.title)
    : [];
  const fromLabel = route ? REGIONS.find((r) => r.id === route.from)?.label : "";
  const toLabel = route ? REGIONS.find((r) => r.id === route.to)?.label : "";

  const selStyle: React.CSSProperties = {
    background: "rgba(16,24,32,.9)", color: "#F7F1E6", border: "1px solid rgba(185,136,60,.3)",
    fontFamily: "var(--font-mono)", fontSize: ".6rem", padding: ".45rem .5rem", borderRadius: 2, letterSpacing: ".08em",
  };
  const btnStyle: React.CSSProperties = {
    background: "none", border: "1px solid #D6A84A", color: "#D6A84A", fontFamily: "var(--font-mono)",
    fontSize: ".58rem", letterSpacing: ".18em", textTransform: "uppercase", padding: ".5rem .8rem",
    borderRadius: 2, cursor: "pointer",
  };

  return (
    <div>
      <h2 style={{ fontFamily: "var(--font-mono)", fontSize: ".62rem", letterSpacing: ".26em", textTransform: "uppercase", color: "#D6A84A", margin: ".2rem 0 1rem" }}>
        Atlas · route between territories
      </h2>

      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: 230, display: "block", border: "1px solid rgba(185,136,60,.2)", borderRadius: 4, background: "rgba(7,21,33,.6)", touchAction: "none", cursor: "grab" }}
        onPointerDown={(e) => { pan.current = { active: true, last: { x: e.clientX, y: e.clientY } }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => {
          if (!pan.current.active || !pan.current.last) return;
          view.current.x += e.clientX - pan.current.last.x;
          view.current.y += e.clientY - pan.current.last.y;
          pan.current.last = { x: e.clientX, y: e.clientY };
          drawAtlas();
        }}
        onPointerUp={() => { pan.current.active = false; }}
        onWheel={(e) => {
          view.current.z = Math.max(0.6, Math.min(2.2, view.current.z * (e.deltaY < 0 ? 1.08 : 0.93)));
          drawAtlas();
        }}
        aria-label="Atlas map. Pan by dragging, zoom with the wheel."
      />

      <div style={{ display: "flex", flexWrap: "wrap", gap: ".5rem", alignItems: "center", marginTop: ".8rem" }}>
        <select aria-label="Route from" value={from} onChange={(e) => setFrom(e.target.value)} style={selStyle}>
          {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        <span style={{ color: "#7B7F80", fontFamily: "var(--font-mono)", fontSize: ".6rem" }}>→</span>
        <select aria-label="Route to" value={to} onChange={(e) => setTo(e.target.value)} style={selStyle}>
          {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        <button style={btnStyle} onClick={() => makeRoute(from, to)}>Route</button>
        <button
          style={btnStyle}
          onClick={async () => {
            await generateReading();
            setMode("command"); // command mode hosts the reading dialog trigger below; main page shows reading
            useField.getState().setMode("atlas");
            window.dispatchEvent(new CustomEvent("open-reading"));
          }}
        >
          Field reading
        </button>
      </div>

      {/* region list fallback for accessibility */}
      <ul className="sr-only">
        {REGIONS.map((r) => <li key={r.id}>{r.label}: {r.inscription}</li>)}
      </ul>

      {route && (
        <div style={{ marginTop: "1rem", border: "1px solid rgba(185,136,60,.25)", borderRadius: 4, padding: ".9rem" }}>
          <div style={{ fontFamily: "var(--font-serif)", fontSize: "1.3rem", color: "#EFE5D0" }}>{fromLabel} → {toLabel}</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: ".58rem", letterSpacing: ".14em", textTransform: "uppercase", color: "#7B7F80", margin: ".3rem 0" }}>{route.concerns.join(" / ") || "—"}</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: ".58rem", letterSpacing: ".14em", textTransform: "uppercase", color: "#7B7F80", margin: ".3rem 0" }}>objects: {routeObjects.join(", ") || "—"}</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: ".58rem", letterSpacing: ".14em", textTransform: "uppercase", color: "#7B7F80", margin: ".3rem 0" }}>archive: {routeEntries.join(", ") || "—"}</div>
          <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", color: "#D8A08E", marginTop: ".4rem" }}>{route.inscription}</div>
        </div>
      )}
    </div>
  );
}
