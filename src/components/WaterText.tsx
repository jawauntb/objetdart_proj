"use client";

import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";

/**
 * WaterText — cursor-displaced "water" typography.
 *
 * Wrap any text (string or ReactNode) and each WORD (whitespace-split,
 * string children only) is wrapped in an outer JS-driven span containing
 * an inner span. A window-level pointermove feeds a shared (per-instance)
 * RAF loop that:
 *   - reads each word's getBoundingClientRect once per frame
 *   - computes a quadratic falloff inside `radius` px
 *   - targets a displacement up to `maxDisplace` px AWAY from the cursor
 *   - lerps current offset toward target at 0.12 per frame
 *   - optionally adds a small staggered vertical bob
 *   - writes transform directly to the DOM via ref (no React re-render)
 *
 * Falls back to a static render of `children` for ReactNode (non-string)
 * inputs so we don't have to walk an arbitrary tree to split words.
 *
 * Respects prefers-reduced-motion: text renders statically, no listener,
 * no RAF.
 *
 * Mirrors the per-word displacement loop in PerWordHero — kept separate
 * because PerWordHero owns its own per-word absolute positioning via
 * Pretext; WaterText is the lighter, layout-flow version for titles.
 */
export default function WaterText({
  children,
  as = "span",
  radius = 180,
  maxDisplace = 12,
  bobAmp = 0,
  bobFreq = 0.4,
  className,
  style,
}: {
  children: ReactNode;
  as?: "span" | "div" | "h1" | "h2" | "p";
  radius?: number;
  maxDisplace?: number;
  bobAmp?: number;
  bobFreq?: number;
  className?: string;
  style?: CSSProperties;
}) {
  // We only split when children is a string. ReactNode falls through as-is.
  const isString = typeof children === "string";
  // Preserve whitespace runs so layout (single vs. multi-space, line breaks)
  // is identical to the source string.
  const tokens = useMemo<string[]>(() => {
    if (!isString) return [];
    // /(\s+)/ keeps the separator in the array
    return (children as string).split(/(\s+)/).filter((t) => t.length > 0);
  }, [children, isString]);

  // word indices within `tokens` (everything that isn't pure whitespace)
  const wordIndices = useMemo<number[]>(() => {
    const out: number[] = [];
    for (let i = 0; i < tokens.length; i++) {
      if (!/^\s+$/.test(tokens[i])) out.push(i);
    }
    return out;
  }, [tokens]);

  const wordCount = wordIndices.length;

  // refs into the rendered word outer-spans
  const wordRefs = useRef<Array<HTMLSpanElement | null>>([]);
  // current applied offsets per word
  const offsets = useRef<Array<{ x: number; y: number }>>([]);
  // pointer in client coords; null = none active
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const rafId = useRef<number | null>(null);
  const reducedMotion = useRef(false);
  // wall-clock baseline for the bob (seconds since mount)
  const startedAt = useRef<number>(0);

  useEffect(() => {
    if (offsets.current.length !== wordCount) {
      offsets.current = Array.from({ length: wordCount }, () => ({ x: 0, y: 0 }));
    }
    wordRefs.current.length = wordCount;
  }, [wordCount]);

  const setRef = useCallback(
    (i: number) => (el: HTMLSpanElement | null) => {
      wordRefs.current[i] = el;
    },
    [],
  );

  // track prefers-reduced-motion
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

  // pointer listener + RAF loop
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isString) return;
    if (wordCount === 0) return;

    startedAt.current = performance.now();

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

    const LERP = 0.12;
    const TWO_PI = Math.PI * 2;

    const tick = () => {
      const els = wordRefs.current;
      const offs = offsets.current;
      const reduced = reducedMotion.current;
      const p = reduced ? null : pointer.current;
      const tSec = (performance.now() - startedAt.current) / 1000;

      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (!el) continue;
        const off = offs[i];
        if (!off) continue;

        let tx = 0;
        let ty = 0;
        if (p) {
          const rect = el.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          // vector FROM cursor TO word — push word away
          const dx = cx - p.x;
          const dy = cy - p.y;
          const dist = Math.hypot(dx, dy);
          if (dist < radius && dist > 0.0001) {
            // quadratic falloff: 1 at center → 0 at radius
            const f = 1 - dist / radius;
            const mag = maxDisplace * f * f;
            tx = (dx / dist) * mag;
            ty = (dy / dist) * mag;
          }
        }

        off.x += (tx - off.x) * LERP;
        off.y += (ty - off.y) * LERP;
        if (
          Math.abs(off.x) < 0.02 &&
          Math.abs(off.y) < 0.02 &&
          tx === 0 &&
          ty === 0
        ) {
          off.x = 0;
          off.y = 0;
        }

        // optional vertical bob (additive on Y), staggered per word
        let bobY = 0;
        if (!reduced && bobAmp > 0) {
          const phase = i * 0.18;
          bobY = Math.sin(tSec * bobFreq * TWO_PI + phase) * bobAmp;
        }

        el.style.transform = `translate3d(${off.x.toFixed(2)}px, ${(off.y + bobY).toFixed(2)}px, 0)`;
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
  }, [isString, wordCount, radius, maxDisplace, bobAmp, bobFreq]);

  // ── render ───────────────────────────────────────────────────────────
  const wrapperStyle: CSSProperties = {
    // default to inline so titles/headings keep their natural flow
    display: style?.display ?? "inline",
    ...style,
  };

  // Non-string children: render as-is (we don't try to split arbitrary
  // ReactNode trees). Still produces a clean wrapper with the requested
  // className/style.
  if (!isString) {
    return createElement(
      as,
      { className, style: wrapperStyle },
      children,
    );
  }

  // Build a running map from token index → word index (only for word tokens).
  // We render whitespace tokens as plain text so wrapping behaves naturally.
  const tokenToWordIndex = new Map<number, number>();
  wordIndices.forEach((tokIdx, wIdx) => tokenToWordIndex.set(tokIdx, wIdx));

  const content = tokens.map((tok, i) => {
    if (/^\s+$/.test(tok)) {
      // render whitespace verbatim so newlines / multi-spaces survive
      return <span key={`s-${i}`} style={{ whiteSpace: "pre-wrap" }}>{tok}</span>;
    }
    const wIdx = tokenToWordIndex.get(i) ?? 0;
    return (
      <span
        key={`w-${i}`}
        ref={setRef(wIdx)}
        style={{
          display: "inline-block",
          willChange: "transform",
          // initial transform; RAF loop overwrites each frame when active
          transform: "translate3d(0,0,0)",
        }}
      >
        <span style={{ display: "inline-block" }}>{tok}</span>
      </span>
    );
  });

  return createElement(
    as,
    { className, style: wrapperStyle, "aria-label": children as string },
    content,
  );
}
