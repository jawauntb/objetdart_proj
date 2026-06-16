"use client";

import { useEffect, useRef } from "react";
import { useField } from "@/store/field";
import { OBJECTS, REGIONS } from "@/data/content";

export default function RoomScene() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const t0 = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = window.innerWidth * dpr;
      cv.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = (now: number) => {
      const s = useField.getState();
      const t = (now - t0) / 1000;
      const w = window.innerWidth;
      const h = window.innerHeight;
      ctx.clearRect(0, 0, w, h);

      // temperature from concerns
      const c = s.concerns;
      const warm = (c.love + c.prayer + c.body) / 300;
      const danger = c.risk / 100;

      // night
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#04101a");
      g.addColorStop(0.55, "#071521");
      g.addColorStop(1, "#0a1e2b");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      // sea
      const seaY = h * 0.6;
      const sg = ctx.createLinearGradient(0, seaY, 0, h);
      sg.addColorStop(0, `rgba(${(20 + danger * 30) | 0},${(60 - danger * 20) | 0},75,0.5)`);
      sg.addColorStop(1, "rgba(4,16,26,0.9)");
      ctx.fillStyle = sg;
      ctx.fillRect(0, seaY, w, h - seaY);

      // tide lines
      ctx.save();
      ctx.globalAlpha = 0.18 + danger * 0.15;
      for (let i = 0; i < 8; i++) {
        const y = seaY + i * ((h - seaY) / 8);
        ctx.strokeStyle = i % 2 ? "rgba(31,111,115,.5)" : "rgba(214,168,74,.25)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 12) {
          const amp = (reduce ? 0 : 1) * (3 + i * 1.5 + danger * 8);
          const yy = y + Math.sin(x * 0.02 + t * (0.4 + i * 0.12) + s.phase * 0.6) * amp;
          x === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
      ctx.restore();

      // candle glow — primary light, attention expands it
      if (s.entered) {
        const cx = w * 0.5;
        const cy = h * 0.42;
        const att = s.attention;
        const flick = reduce ? 1 : 1 + Math.sin(t * 7) * 0.06 + Math.sin(t * 13) * 0.03;
        const R = (120 + att * 260) * flick;
        const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
        const goldA = 0.5 + att * 0.4 + warm * 0.15;
        cg.addColorStop(0, `rgba(242,${(170 - danger * 40) | 0},90,${0.55 * flick})`);
        cg.addColorStop(0.25, `rgba(214,168,74,${goldA * 0.4})`);
        cg.addColorStop(1, "rgba(214,168,74,0)");
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, 7);
        ctx.fill();
      }

      // window frame
      ctx.strokeStyle = "rgba(74,44,26,.5)";
      ctx.lineWidth = 3;
      ctx.strokeRect(w * 0.5 - w * 0.16, h * 0.12, w * 0.32, h * 0.34);
      ctx.beginPath();
      ctx.moveTo(w * 0.5, h * 0.12);
      ctx.lineTo(w * 0.5, h * 0.46);
      ctx.moveTo(w * 0.5 - w * 0.16, h * 0.29);
      ctx.lineTo(w * 0.5 + w * 0.16, h * 0.29);
      ctx.stroke();

      // drop-target glow — only while an object is being dragged
      const draggingId = s.dragging;
      if (draggingId) {
        const obj = OBJECTS.find((o) => o.id === draggingId);
        if (obj) {
          const pulse = reduce ? 1 : 0.7 + Math.sin(t * 4) * 0.3;
          ctx.save();
          for (const target of obj.regions) {
            let tx = 0, ty = 0, label = "";
            if (target.startsWith("obj:")) {
              const other = OBJECTS.find((o) => o.id === target.slice(4));
              if (!other) continue;
              tx = other.x * w; ty = other.y * h; label = other.label;
            } else if (target === "sea") {
              tx = w * 0.5; ty = h * 0.82; label = "the sea";
            } else {
              const r = REGIONS.find((x) => x.id === target);
              if (!r) continue;
              tx = r.x * w; ty = r.y * h; label = r.label;
            }
            // outer ring
            const ring = ctx.createRadialGradient(tx, ty, 6, tx, ty, 90);
            ring.addColorStop(0, `rgba(214,168,74,${0.55 * pulse})`);
            ring.addColorStop(0.6, `rgba(214,168,74,${0.15 * pulse})`);
            ring.addColorStop(1, "rgba(214,168,74,0)");
            ctx.fillStyle = ring;
            ctx.beginPath();
            ctx.arc(tx, ty, 90, 0, 7);
            ctx.fill();
            // inner pin
            ctx.strokeStyle = `rgba(239,229,208,${0.85 * pulse})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(tx, ty, 14, 0, 7);
            ctx.stroke();
            // label
            ctx.fillStyle = `rgba(239,229,208,${0.9 * pulse})`;
            ctx.font = "10px IBM Plex Mono, monospace";
            ctx.textAlign = "center";
            ctx.fillText(label.toUpperCase(), tx, ty + 32);
          }
          ctx.restore();
        }
      }

      s.decayAttention();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
    />
  );
}
