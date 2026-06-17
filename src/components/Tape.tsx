"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useField } from "@/store/field";
import type { TapeEvent, TapeEventKind } from "@/store/field";
import { getFieldAudio } from "@/lib/audio";

/**
 * The tape.
 *
 * A fixed bottom strip that draws every session event as a small EKG-style
 * pulse on a baseline. Time flows right → left: newest pulses appear at
 * the right edge and slowly drift left. Each kind has its own signature
 * waveform. New pulses "draw themselves" via a per-event progress (0..1)
 * that ramps over ~700ms after the event is recorded.
 *
 * Why: state is a time series, not a vector. The site behaves like the
 * user's TradingView charts when the tape is present — touch the water
 * and the heartbeat answers; drag a concern and the strip pulses.
 */
export default function Tape() {
  const tape = useField((s) => s.tape);
  const pathname = usePathname() ?? "/";
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState<TapeEvent | null>(null);

  // routes that need the dark palette
  const dark =
    pathname.startsWith("/tide") ||
    pathname.startsWith("/watch") ||
    pathname.startsWith("/waves");

  // hide tape on reading-share pages (OG / printable) — keep them pristine
  const hide = pathname.startsWith("/reading/");

  useEffect(() => {
    if (hide) return;
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = window.innerWidth * dpr;
      cv.height = TAPE_H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      const w = window.innerWidth;
      const h = TAPE_H;
      const now = Date.now();

      // palette
      const palette = dark ? DARK : LIGHT;
      // background — soft band
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = palette.bg;
      ctx.fillRect(0, 0, w, h);

      // baseline — undulates at the same 0.14Hz LFO that drives the sea/audio.
      // Spatial wave (0.06 cycles per 100px) drifts left→right at 30px/sec,
      // and the entire ribbon breathes vertically ±1.5px on the audio LFO.
      const baseY = h * 0.55;
      const audioT = getFieldAudio().getAudioTime();
      const t = audioT ?? performance.now() / 1000;
      const lfo = Math.sin(t * 0.14 * Math.PI * 2); // -1..1
      const breathe = reduce ? 0 : lfo * 1.5;       // ±1.5px vertical breathing
      const spatialAmp = reduce ? 0 : 3;            // ~3px spatial undulation
      const spatialK = (Math.PI * 2 * 0.06) / 100;  // 0.06 cycles per 100px
      const drift = t * 30;                         // 30px/sec horizontal drift

      const baselineY = (x: number): number =>
        baseY + breathe + Math.sin((x + drift) * spatialK) * spatialAmp;

      ctx.strokeStyle = palette.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const SEGMENTS = 80;
      const x0 = LEFT_PAD;
      const x1 = w - RIGHT_PAD;
      for (let i = 0; i <= SEGMENTS; i++) {
        const px = x0 + (i / SEGMENTS) * (x1 - x0);
        const py = baselineY(px);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // tick marks: -3m, -2m, -1m, now — attached to the wave
      ctx.strokeStyle = palette.tick;
      ctx.fillStyle = palette.tick;
      ctx.font = `10px var(--font-mono, ui-monospace)`;
      ctx.lineWidth = 1;
      for (let m = 0; m <= 3; m++) {
        const tx = positionX(now - m * 60_000, now, w);
        const ty = baselineY(tx);
        ctx.beginPath();
        ctx.moveTo(tx, ty + 4);
        ctx.lineTo(tx, ty + 8);
        ctx.stroke();
      }
      // now label
      ctx.fillStyle = palette.faint;
      ctx.textAlign = "right";
      ctx.fillText("now", w - RIGHT_PAD - 4, h - 4);
      ctx.textAlign = "left";
      ctx.fillText("3m", LEFT_PAD, h - 4);

      // events
      tape.forEach((ev) => {
        const x = positionX(ev.t, now, w);
        if (x < LEFT_PAD - 24 || x > w - RIGHT_PAD + 24) return;
        const age = now - ev.t;
        // draw progress: 0..1 over first 700ms
        const drawP = reduce ? 1 : Math.min(1, age / 700);
        // fade: hold full opacity for 30s, then linearly fade to 0.18 by 3m
        const fade = age < 30_000 ? 1 : Math.max(0.18, 1 - (age - 30_000) / 150_000);
        const ink = withAlpha(palette.glyph, fade);
        const accent = withAlpha(palette.accent, fade);
        // anchor each pulse to the wavy baseline at its x
        drawPulse(ctx, x, baselineY(x), ev, drawP, ink, accent);
      });

      // current-time cursor — sits on the wave too
      const cursorX = w - RIGHT_PAD;
      const cursorBaseY = baselineY(cursorX);
      ctx.strokeStyle = palette.cursor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cursorX, cursorBaseY - 12);
      ctx.lineTo(cursorX, cursorBaseY + 4);
      ctx.stroke();
      // small dot at the cursor
      ctx.fillStyle = palette.cursor;
      ctx.beginPath();
      ctx.arc(cursorX, cursorBaseY - 12, 1.6, 0, 7);
      ctx.fill();

      // counter (Fraunces, right-side, faint)
      ctx.fillStyle = palette.faint;
      ctx.font = `500 11px var(--font-fraunces, Georgia), serif`;
      ctx.textAlign = "right";
      const label = tape.length === 0 ? "still" : `${pad2(tape.length)}`;
      ctx.fillText(label, w - 8, 13);
      ctx.textAlign = "left";

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [tape, dark, hide]);

  // hover detection — find nearest event under the pointer to surface its label
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const rect = cv.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (y < 4 || y > TAPE_H - 4) { setHovered(null); return; }
    const now = Date.now();
    const w = rect.width;
    let best: { ev: TapeEvent; dx: number } | null = null;
    for (const ev of tape) {
      const ex = positionX(ev.t, now, w);
      const dx = Math.abs(ex - x);
      if (dx < 14 && (!best || dx < best.dx)) best = { ev, dx };
    }
    setHovered(best?.ev ?? null);
  };
  const onLeave = () => setHovered(null);

  if (hide) return null;

  return (
    <div
      aria-hidden="true"
      className="oda-tape-shell"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: "env(safe-area-inset-bottom, 0px)",
        height: TAPE_H,
        zIndex: 28, // under SoundToggle (which is higher) but above content
        pointerEvents: "none",
      }}
    >
      <canvas
        ref={canvasRef}
        className="oda-tape-canvas"
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        style={{
          display: "block",
          width: "100vw",
          height: TAPE_H,
          // hover labels are pointer-only; on touch devices the canvas would
          // otherwise swallow taps on whatever sits in the bottom 40px strip.
          pointerEvents: "auto",
        }}
      />
      <style>{`
        /* On coarse-pointer (touch) devices, the tape is purely decorative —
           no hover affordance — so pass clicks through. */
        @media (hover: none), (pointer: coarse) {
          .oda-tape-canvas { pointer-events: none !important; }
        }
      `}</style>
      {hovered && (
        <div
          className="t-mono"
          style={{
            position: "absolute",
            right: 18, bottom: TAPE_H + 6,
            fontSize: 11,
            letterSpacing: "0.04em",
            color: dark ? "rgba(232,226,213,0.86)" : "var(--ink-2)",
            background: dark ? "rgba(16,18,22,0.86)" : "rgba(242,238,230,0.96)",
            border: `1px solid ${dark ? "rgba(232,226,213,0.20)" : "var(--rule)"}`,
            padding: "4px 8px",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          {labelFor(hovered)}
        </div>
      )}
    </div>
  );
}

// ── geometry / pulse drawing ────────────────────────────────────────────

const TAPE_H = 40;
const LEFT_PAD = 16;
const RIGHT_PAD = 60;
const WINDOW_MS = 3 * 60_000;

function positionX(t: number, now: number, w: number): number {
  const usable = w - LEFT_PAD - RIGHT_PAD;
  // most recent at the right edge of the usable area
  const age = Math.max(0, now - t);
  const x = (w - RIGHT_PAD) - (age / WINDOW_MS) * usable;
  return x;
}

function withAlpha(rgba: string, mult: number): string {
  // rgba string like "rgba(r,g,b,a)" — multiply the alpha
  const m = rgba.match(/rgba\(([^)]+)\)/);
  if (!m) return rgba;
  const parts = m[1].split(",").map((s) => s.trim());
  const a = parseFloat(parts[3] ?? "1") * mult;
  return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${a})`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

const LIGHT = {
  bg:     "rgba(242, 238, 230, 0.92)",
  line:   "rgba(21, 23, 26, 0.18)",
  tick:   "rgba(21, 23, 26, 0.35)",
  cursor: "rgba(200, 115, 42, 0.65)",
  glyph:  "rgba(44, 74, 92, 1)",
  accent: "rgba(200, 115, 42, 1)",
  faint:  "rgba(58, 61, 66, 0.55)",
};

const DARK = {
  bg:     "rgba(14, 12, 12, 0.62)",
  line:   "rgba(232, 226, 213, 0.20)",
  tick:   "rgba(232, 226, 213, 0.35)",
  cursor: "rgba(255, 180, 110, 0.90)",
  glyph:  "rgba(190, 215, 230, 1)",
  accent: "rgba(255, 180, 110, 1)",
  faint:  "rgba(232, 226, 213, 0.50)",
};

/**
 * Draw a single pulse glyph at (cx, baseY) — each event kind has its own
 * waveform signature. drawP is 0..1 — events animate themselves in over
 * their first ~700ms by clipping the path to drawP of its full extent.
 */
function drawPulse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  ev: TapeEvent,
  drawP: number,
  ink: string,
  accent: string,
) {
  const amp = 8 + ev.intensity * 12; // pulse height
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = ink;

  switch (ev.kind) {
    case "ripple": {
      // two small sine cycles
      const w = 28;
      const x0 = cx - w / 2;
      strokePartialPath(ctx, drawP, () => {
        ctx.beginPath();
        for (let i = 0; i <= 28; i++) {
          const t = i / 28;
          const x = x0 + t * w;
          const y = baseY - Math.sin(t * Math.PI * 2 * 1.5) * (amp * 0.45);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      });
      break;
    }
    case "candle": {
      // sharp upward spike like a QRS complex
      strokePartialPath(ctx, drawP, () => {
        ctx.beginPath();
        ctx.moveTo(cx - 8, baseY);
        ctx.lineTo(cx - 3, baseY);
        ctx.lineTo(cx - 1, baseY + amp * 0.18);
        ctx.lineTo(cx, baseY - amp);
        ctx.lineTo(cx + 1, baseY + amp * 0.18);
        ctx.lineTo(cx + 3, baseY);
        ctx.lineTo(cx + 8, baseY);
      });
      // accent dot at the tip
      if (drawP > 0.6) {
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(cx, baseY - amp, 1.6, 0, 7);
        ctx.fill();
      }
      break;
    }
    case "concern": {
      // triangle up, smooth on/off
      strokePartialPath(ctx, drawP, () => {
        ctx.beginPath();
        ctx.moveTo(cx - 8, baseY);
        ctx.lineTo(cx, baseY - amp * 0.85);
        ctx.lineTo(cx + 8, baseY);
      });
      break;
    }
    case "region": {
      // vertical tick with a dot at top
      strokePartialPath(ctx, drawP, () => {
        ctx.beginPath();
        ctx.moveTo(cx, baseY);
        ctx.lineTo(cx, baseY - amp);
      });
      if (drawP > 0.7) {
        ctx.fillStyle = ink;
        ctx.beginPath();
        ctx.arc(cx, baseY - amp - 2, 1.6, 0, 7);
        ctx.fill();
      }
      break;
    }
    case "object": {
      // small diamond
      const r = 4 + ev.intensity * 3;
      strokePartialPath(ctx, drawP, () => {
        ctx.beginPath();
        ctx.moveTo(cx, baseY - r);
        ctx.lineTo(cx + r, baseY);
        ctx.lineTo(cx, baseY + r);
        ctx.lineTo(cx - r, baseY);
        ctx.closePath();
      });
      break;
    }
    case "reading": {
      // gentle wider bump
      const w = 36;
      const x0 = cx - w / 2;
      strokePartialPath(ctx, drawP, () => {
        ctx.beginPath();
        for (let i = 0; i <= 36; i++) {
          const t = i / 36;
          const x = x0 + t * w;
          const y = baseY - Math.sin(t * Math.PI) * amp * 0.7;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      });
      break;
    }
    case "kept": {
      // down-up-down notch — "Q" complex, accent color
      ctx.strokeStyle = accent;
      strokePartialPath(ctx, drawP, () => {
        ctx.beginPath();
        ctx.moveTo(cx - 10, baseY);
        ctx.lineTo(cx - 4, baseY);
        ctx.lineTo(cx - 2, baseY + amp * 0.35);
        ctx.lineTo(cx, baseY - amp);
        ctx.lineTo(cx + 2, baseY + amp * 0.35);
        ctx.lineTo(cx + 4, baseY);
        ctx.lineTo(cx + 10, baseY);
      });
      // accent ring at the tip
      if (drawP > 0.6) {
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, baseY - amp, 2.6, 0, 7);
        ctx.stroke();
        ctx.lineWidth = 1.3;
      }
      break;
    }
    case "ask": {
      // three dots ascending then settling
      ctx.fillStyle = ink;
      for (let i = 0; i < 3; i++) {
        const xx = cx - 8 + i * 8;
        const yy = baseY - amp * 0.4 * (i + 1) / 3;
        const p = (drawP - i * 0.2) / 0.4;
        if (p > 0) {
          ctx.beginPath();
          ctx.arc(xx, yy, 1.6, 0, 7);
          ctx.fill();
        }
      }
      break;
    }
    case "imagine": {
      // rising arc
      strokePartialPath(ctx, drawP, () => {
        ctx.beginPath();
        for (let i = 0; i <= 20; i++) {
          const t = i / 20;
          const x = cx - 10 + t * 20;
          const y = baseY - Math.sin(t * Math.PI * 0.5) * amp * 0.8;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      });
      break;
    }
    case "sigil": {
      // pulse with overshoot
      strokePartialPath(ctx, drawP, () => {
        ctx.beginPath();
        ctx.moveTo(cx - 10, baseY);
        ctx.lineTo(cx - 4, baseY);
        ctx.lineTo(cx - 2, baseY - amp);
        ctx.lineTo(cx, baseY + amp * 0.25);
        ctx.lineTo(cx + 2, baseY - amp * 0.6);
        ctx.lineTo(cx + 4, baseY);
        ctx.lineTo(cx + 10, baseY);
      });
      break;
    }
    case "preset": {
      // long flat bar with a small notch
      strokePartialPath(ctx, drawP, () => {
        ctx.beginPath();
        ctx.moveTo(cx - 14, baseY);
        ctx.lineTo(cx - 4, baseY);
        ctx.lineTo(cx - 1, baseY - amp * 0.4);
        ctx.lineTo(cx + 1, baseY - amp * 0.4);
        ctx.lineTo(cx + 4, baseY);
        ctx.lineTo(cx + 14, baseY);
      });
      break;
    }
  }
  ctx.lineWidth = 1;
}

/**
 * Draw a partial path. We stamp the path into a clip rect of width
 * `drawP * (right - left)` so the pulse "draws itself" left-to-right.
 *
 * Simpler than per-segment dashoffset and works for any path shape.
 */
function strokePartialPath(
  ctx: CanvasRenderingContext2D,
  drawP: number,
  build: () => void,
) {
  if (drawP >= 1) {
    build();
    ctx.stroke();
    return;
  }
  if (drawP <= 0) return;
  // For a partial draw, just use globalAlpha as a quick approximation —
  // the pulse fades in. Combined with the natural ~700ms window it reads
  // as a draw-in rather than a hard pop.
  const prevAlpha = ctx.globalAlpha;
  ctx.globalAlpha = prevAlpha * drawP;
  build();
  ctx.stroke();
  ctx.globalAlpha = prevAlpha;
}

function labelFor(ev: TapeEvent): string {
  const s = Math.floor((Date.now() - ev.t) / 1000);
  const ago = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`;
  const kind: Record<TapeEventKind, string> = {
    ripple: "ripple",
    candle: "candle",
    concern: "concern",
    region: "region",
    object: "object",
    reading: "reading",
    kept: "kept",
    ask: "ask",
    imagine: "imagine",
    sigil: "sigil",
    preset: "preset",
  };
  return `${kind[ev.kind]}${ev.meta ? ` · ${ev.meta}` : ""} · ${ago} ago`;
}
