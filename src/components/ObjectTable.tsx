"use client";

import { useRef, useState } from "react";
import { useField } from "@/store/field";
import { OBJECTS, GLYPHS, REGIONS, PHASES } from "@/data/content";
import type { SymbolObject, LensKey } from "@/lib/types";

const LENS_ORDER: LensKey[] = ["ritual", "systems", "body", "archive", "horizon"];

function Glyph({ name, rotate = 0 }: { name: string; rotate?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={30}
      height={30}
      style={{
        stroke: "#D6A84A", fill: "none", strokeWidth: 1.3,
        strokeLinecap: "round", strokeLinejoin: "round",
        transform: rotate ? `rotate(${rotate}deg)` : undefined,
        transition: "transform .2s",
      }}
      dangerouslySetInnerHTML={{ __html: GLYPHS[name] }}
    />
  );
}

function dropTarget(x: number, y: number, o: SymbolObject): string | null {
  const w = window.innerWidth;
  const h = window.innerHeight;
  let best: string | null = null;
  let bd = 1e9;
  for (const region of o.regions) {
    if (region.startsWith("obj:")) {
      const other = OBJECTS.find((x) => x.id === region.slice(4));
      if (!other) continue;
      const d = Math.hypot(other.x * w - x, other.y * h - y);
      if (d < bd) { bd = d; best = region; }
    } else if (region === "sea") {
      // sea = lower portion of the room
      if (y > h * 0.6 && Math.abs(y - h * 0.78) < bd) {
        bd = Math.abs(y - h * 0.78);
        best = "sea";
      }
    } else {
      const r = REGIONS.find((x) => x.id === region);
      if (!r) continue;
      const d = Math.hypot(r.x * w - x, r.y * h - y);
      if (d < bd) { bd = d; best = region; }
    }
  }
  return bd < 220 ? best : null;
}

function Hotspot({ o, onInspect }: { o: SymbolObject; onInspect: (o: SymbolObject, el: HTMLElement) => void }) {
  const elRef = useRef<HTMLButtonElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rotation, setRotation] = useState(0);
  const state = useRef({ start: null as null | { x: number; y: number }, moved: false, holdTimer: 0 });
  const {
    setHeld, setDragging: setStoreDragging, bumpAttention, resolveCombo,
    cycleLens, setLens, setFlash, setPhase,
  } = useField();
  const lens = useField((s) => s.lens);

  const isCompass = o.id === "compass";
  const isRecord = o.id === "record";

  const startHold = () => {
    if (o.id === "candle") {
      setHeld("candle");
      state.current.holdTimer = window.setInterval(() => bumpAttention(0.04), 40);
    }
  };
  const endHold = () => {
    if (state.current.holdTimer) {
      clearInterval(state.current.holdTimer);
      state.current.holdTimer = 0;
    }
    if (useField.getState().held === "candle") setHeld(null);
  };

  // visual angle of compass = current lens position
  const compassAngle = isCompass && lens
    ? LENS_ORDER.indexOf(lens) * 72
    : rotation;

  return (
    <button
      ref={elRef}
      aria-label={`${o.label}. ${o.inscription}`}
      onPointerDown={(e) => {
        state.current.start = { x: e.clientX, y: e.clientY };
        state.current.moved = false;
        elRef.current?.setPointerCapture(e.pointerId);
        startHold();
      }}
      onPointerMove={(e) => {
        const st = state.current;
        if (!st.start) return;
        const dx = e.clientX - st.start.x;
        const dy = e.clientY - st.start.y;
        if (Math.hypot(dx, dy) > 10) {
          st.moved = true;

          // compass rotates instead of dragging
          if (isCompass) {
            const el = elRef.current!;
            const r = el.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            const ang = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90;
            setRotation(((ang % 360) + 360) % 360);
            return;
          }

          if (!dragging && o.affordances.includes("drag")) {
            setDragging(true);
            setStoreDragging(o.id);
            endHold();
          }
          if (dragging || o.affordances.includes("drag")) {
            // record scrubs phase by horizontal travel
            if (isRecord) {
              const w = window.innerWidth;
              const t = Math.max(0, Math.min(1, e.clientX / w));
              setPhase(Math.round(t * (PHASES.length - 1)));
            }
            const el = elRef.current!;
            el.style.left = e.clientX + "px";
            el.style.top = e.clientY + "px";
          }
        }
      }}
      onPointerUp={(e) => {
        endHold();
        const el = elRef.current!;
        if (isCompass && state.current.moved) {
          // snap rotation to 5 sectors (72°) → lens
          const sector = Math.round(rotation / 72) % 5;
          const idx = (sector + 5) % 5;
          setLens(LENS_ORDER[idx]);
          setFlash("Lens · " + LENS_ORDER[idx]);
          setRotation(idx * 72);
        } else if (dragging) {
          setDragging(false);
          setStoreDragging(null);
          const tgt = dropTarget(e.clientX, e.clientY, o);
          if (tgt) resolveCombo(o.id, tgt);
          else setFlash(`${o.label} has no home there.`);
          el.style.left = o.x * 100 + "%";
          el.style.top = o.y * 100 + "%";
        } else if (isCompass) {
          // bare tap on compass — cycle
          cycleLens();
        }
        state.current.start = null;
      }}
      onPointerCancel={() => {
        endHold();
        setDragging(false);
        setStoreDragging(null);
        const el = elRef.current!;
        el.style.left = o.x * 100 + "%";
        el.style.top = o.y * 100 + "%";
      }}
      onClick={() => {
        if (state.current.moved) { state.current.moved = false; return; }
        onInspect(o, elRef.current!);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") onInspect(o, elRef.current!);
        if (e.key === " " && o.id === "candle") {
          e.preventDefault();
          bumpAttention(0.3);
          setFlash("Attention rises.");
        }
        if (isCompass && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
          e.preventDefault();
          const dir = e.key === "ArrowRight" ? 1 : -1;
          const i = lens ? LENS_ORDER.indexOf(lens) : -1;
          const next = LENS_ORDER[((i + dir) % 5 + 5) % 5];
          setLens(next);
          setFlash("Lens · " + next);
        }
      }}
      style={{
        position: "absolute",
        left: o.x * 100 + "%",
        top: o.y * 100 + "%",
        transform: "translate(-50%,-50%)",
        background: "none",
        border: "none",
        cursor: isCompass ? "grab" : "pointer",
        touchAction: "none",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: ".3rem",
        zIndex: dragging ? 60 : 20,
        padding: 0,
      }}
    >
      <span
        style={{
          width: 54, height: 54, display: "grid", placeItems: "center",
          borderRadius: "50%",
          border: "1px solid rgba(185,136,60,.25)",
          background: "radial-gradient(circle at 50% 40%,rgba(214,168,74,.12),rgba(7,21,33,.4))",
          boxShadow: dragging ? "0 0 40px rgba(214,168,74,.6)" : "none",
          transition: "box-shadow .25s, transform .25s",
        }}
      >
        <Glyph name={o.glyph} rotate={isCompass ? compassAngle : 0} />
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)", fontSize: ".55rem",
          letterSpacing: ".2em", textTransform: "uppercase",
          color: "#7B7F80", opacity: 0.85,
        }}
      >
        {o.label}
      </span>
    </button>
  );
}

export default function ObjectTable({
  onInspect,
}: {
  onInspect: (o: SymbolObject, el: HTMLElement) => void;
}) {
  const entered = useField((s) => s.entered);
  if (!entered) return null;
  return (
    <div style={{ position: "absolute", inset: 0 }} aria-label="Object table">
      {OBJECTS.map((o) => (
        <Hotspot key={o.id} o={o} onInspect={onInspect} />
      ))}
    </div>
  );
}
