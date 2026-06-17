"use client";

import {
  prepareWithSegments,
  layoutNextLineRange,
  materializeLineRange,
  type PreparedTextWithSegments,
  type LayoutCursor,
} from "@chenglou/pretext";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Hero typography that lays its sentence out word-by-word using Pretext
 * for line wrapping, then places each word as an absolutely-positioned
 * span. Each word breathes on the same 7s LFO as the ambient audio
 * swell (0.14 Hz), with a small per-word phase offset so the line
 * ripples instead of pulsing in lockstep.
 *
 * Approach: split each Pretext-laid line by whitespace and derive per
 * word x-offsets via Canvas measureText against the same computed font
 * we hand Pretext. Cheap and matches Pretext's metrics closely enough
 * for the visual.
 *
 * Animation is CSS-only — no RAF loop. `prefers-reduced-motion: reduce`
 * disables it. Before fonts/Pretext are ready, a plain h1 renders so
 * the hero is never blank.
 */
export default function PerWordHero({
  text,
  className,
  style,
}: {
  text: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const [font, setFont] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const [lineHeight, setLineHeight] = useState(0);

  // wait for fonts so measurement happens against the real face
  useEffect(() => {
    if (typeof document === "undefined") return;
    if ("fonts" in document) {
      document.fonts.ready.then(() => setFontsReady(true));
    } else {
      setFontsReady(true);
    }
  }, []);

  // resolve the computed font shorthand from the DOM (next/font hashes
  // the family name so we can't hardcode it)
  useEffect(() => {
    if (!fontsReady || !probeRef.current) return;
    const cs = getComputedStyle(probeRef.current);
    setFont(
      `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`,
    );
    const lh = parseFloat(cs.lineHeight);
    const fs = parseFloat(cs.fontSize);
    setLineHeight(
      Number.isFinite(lh) && lh > 0 ? lh : fs * 1.15,
    );
  }, [fontsReady]);

  // observe container width
  useEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const prepared = useMemo<PreparedTextWithSegments | null>(() => {
    if (!font) return null;
    try { return prepareWithSegments(text, font); } catch { return null; }
  }, [text, font]);

  // run pretext, then for each line split by whitespace and use a
  // canvas to get x positions of each word
  const words = useMemo(() => {
    if (!prepared || !font || !width || width <= 0 || !lineHeight) return null;
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.font = font;

    try {
      const out: Array<{ x: number; y: number; text: string; index: number }> = [];
      let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };
      let y = 0;
      let safety = 0;
      let wordIndex = 0;
      while (safety++ < 200) {
        const range = layoutNextLineRange(prepared, cursor, width);
        if (!range) break;
        const line = materializeLineRange(prepared, range);
        // split into [word, space, word, space, ...] preserving widths
        const parts = line.text.split(/(\s+)/);
        let x = 0;
        for (const part of parts) {
          if (!part) continue;
          const w = ctx.measureText(part).width;
          if (!/^\s+$/.test(part)) {
            out.push({ x, y, text: part, index: wordIndex++ });
          }
          x += w;
        }
        cursor = range.end;
        y += lineHeight;
      }
      return { items: out, height: y };
    } catch (e) {
      console.warn("PerWordHero layout failed:", e);
      return null;
    }
  }, [prepared, font, width, lineHeight]);

  // 7-second period matches the 0.14 Hz audio swell LFO. small phase
  // offset per word so the breath ripples across the line.
  const PERIOD_S = 7;
  const PHASE_STEP_S = 0.18;

  // --- cursor-driven repulsive displacement (additive on top of breath) ---
  // The outer wrapper span receives the JS transform; the inner span keeps
  // the CSS keyframe breath untouched. Words "bow away" from the pointer
  // within a 180px falloff radius, up to ~12px peak displacement.
  const REPEL_RADIUS = 180;
  const REPEL_MAX = 12;
  const LERP = 0.12;

  const wordRefs = useRef<Array<HTMLSpanElement | null>>([]);
  // current applied offsets, indexed per word
  const offsets = useRef<Array<{ x: number; y: number }>>([]);
  // pointer in client coords; null = no active pointer (touch lift / blur)
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const rafId = useRef<number | null>(null);
  const reducedMotion = useRef(false);

  // keep offsets array in sync with word count
  const wordCount = words?.items.length ?? 0;
  useEffect(() => {
    if (offsets.current.length !== wordCount) {
      offsets.current = Array.from({ length: wordCount }, () => ({ x: 0, y: 0 }));
    }
    wordRefs.current.length = wordCount;
  }, [wordCount]);

  const setRef = useCallback((i: number) => (el: HTMLSpanElement | null) => {
    wordRefs.current[i] = el;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion.current = mql.matches;
    const onChange = (e: MediaQueryListEvent) => {
      reducedMotion.current = e.matches;
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (wordCount === 0) return;

    const onMove = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    const onLeave = () => {
      pointer.current = null;
    };
    const onBlur = () => {
      pointer.current = null;
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    window.addEventListener("pointercancel", onLeave);
    window.addEventListener("blur", onBlur);

    const tick = () => {
      const els = wordRefs.current;
      const offs = offsets.current;
      const repel = reducedMotion.current ? false : true;
      const p = pointer.current;

      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (!el) continue;
        const off = offs[i];
        if (!off) continue;

        let tx = 0;
        let ty = 0;
        if (repel && p) {
          const rect = el.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const dx = cx - p.x;
          const dy = cy - p.y;
          const dist = Math.hypot(dx, dy);
          if (dist < REPEL_RADIUS && dist > 0.0001) {
            // smooth quadratic falloff: 1 at center, 0 at radius
            const f = 1 - dist / REPEL_RADIUS;
            const mag = REPEL_MAX * f * f;
            tx = (dx / dist) * mag;
            ty = (dy / dist) * mag;
          }
        }

        off.x += (tx - off.x) * LERP;
        off.y += (ty - off.y) * LERP;
        // clamp tiny residuals to zero so settled state is clean
        if (Math.abs(off.x) < 0.02 && Math.abs(off.y) < 0.02 && tx === 0 && ty === 0) {
          off.x = 0;
          off.y = 0;
        }
        el.style.transform = `translate3d(${off.x.toFixed(2)}px, ${off.y.toFixed(2)}px, 0)`;
      }

      rafId.current = window.requestAnimationFrame(tick);
    };
    rafId.current = window.requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("pointercancel", onLeave);
      window.removeEventListener("blur", onBlur);
      if (rafId.current !== null) window.cancelAnimationFrame(rafId.current);
      rafId.current = null;
    };
  }, [wordCount]);

  return (
    <div
      ref={wrapRef}
      className={className}
      style={{
        position: "relative",
        width: "100%",
        minHeight: words?.height ?? undefined,
        ...style,
      }}
    >
      <style>{`
        @keyframes perWordBreath {
          0%   { opacity: 1;    transform: translateY(0); }
          50%  { opacity: 0.86; transform: translateY(-1.2px); }
          100% { opacity: 1;    transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .pw-word { animation: none !important; }
        }
      `}</style>

      {/* probe — rendered so getComputedStyle picks up the real font */}
      <span
        ref={probeRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          left: -9999,
          top: -9999,
          fontFamily: "inherit",
          fontStyle: "inherit",
          fontWeight: "inherit",
          fontSize: "inherit",
          lineHeight: "inherit",
          visibility: "hidden",
        }}
      >
        m
      </span>

      {!words ? (
        // fallback: plain h1 so the hero is always visible. once
        // pretext resolves, this is replaced by per-word spans.
        <h1 style={{ margin: 0, fontFamily: "inherit", fontWeight: "inherit", lineHeight: "inherit" }}>
          {text}
        </h1>
      ) : (
        <h1
          aria-label={text}
          style={{
            margin: 0,
            position: "relative",
            height: words.height,
            fontFamily: "inherit",
            fontWeight: "inherit",
            lineHeight: "inherit",
          }}
        >
          {words.items.map((w) => (
            // Outer span carries the JS-driven cursor displacement; inner
            // span keeps the CSS keyframe breath so the two compose without
            // either having to know about the other.
            <span
              key={w.index}
              ref={setRef(w.index)}
              aria-hidden="true"
              style={{
                position: "absolute",
                left: w.x,
                top: w.y,
                whiteSpace: "pre",
                willChange: "transform",
                // initial transform; RAF loop overwrites each frame
                transform: "translate3d(0,0,0)",
              }}
            >
              <span
                className="pw-word"
                style={{
                  display: "inline-block",
                  willChange: "opacity, transform",
                  animation: `perWordBreath ${PERIOD_S}s ease-in-out ${
                    -PERIOD_S + w.index * PHASE_STEP_S
                  }s infinite`,
                }}
              >
                {w.text}
              </span>
            </span>
          ))}
        </h1>
      )}
    </div>
  );
}
