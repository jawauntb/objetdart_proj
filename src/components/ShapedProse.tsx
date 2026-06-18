"use client";

import {
  prepareWithSegments,
  layoutNextLineRange,
  materializeLineRange,
  type PreparedTextWithSegments,
  type LayoutCursor,
} from "@chenglou/pretext";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ObstacleShape } from "@/lib/sigil-shape";

/**
 * Prose that wraps around a shape obstacle (typically the sigil
 * polygon) using Pretext for line-by-line measurement. Each line is
 * absolutely positioned and given exactly the width available at its
 * y-row, so the text hugs the polygon silhouette instead of a bounding
 * box.
 *
 * The font is read from getComputedStyle on the container element so
 * Cormorant Garamond's auto-generated next/font family resolves
 * correctly. Layout waits for document.fonts.ready to avoid measuring
 * against the serif fallback.
 */
export default function ShapedProse({
  text,
  lineHeight,
  width,
  obstacle,
  minLineWidth = 100,
  paragraphGap = 14,
  className,
  style,
}: {
  text: string | string[];           // single paragraph or list of paragraphs
  lineHeight: number;
  width: number;
  obstacle?: ObstacleShape;
  minLineWidth?: number;
  paragraphGap?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const probeRef = useRef<HTMLSpanElement>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const [font, setFont] = useState<string | null>(null);

  // wait for document fonts so Pretext measures against the real face,
  // not Georgia fallback
  useEffect(() => {
    if (typeof document === "undefined") return;
    if ("fonts" in document) {
      document.fonts.ready.then(() => setFontsReady(true));
    } else {
      setFontsReady(true);
    }
  }, []);

  // resolve the computed font string from the DOM after mount, since
  // next/font generates a randomised family name we can't predict
  useEffect(() => {
    if (!fontsReady || !probeRef.current) return;
    const cs = getComputedStyle(probeRef.current);
    const resolved = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    setFont(resolved);
  }, [fontsReady]);

  // a single "paragraphs" array — pretext layouts per paragraph and we
  // stack them with paragraphGap between
  const paragraphs = useMemo(
    () => (Array.isArray(text) ? text : [text]),
    [text],
  );

  // prepare each paragraph once per (text, font) — re-running prepare
  // every time the obstacle moves is wasteful
  const prepared = useMemo(() => {
    if (!font) return null;
    return paragraphs.map((p): PreparedTextWithSegments | null => {
      try { return prepareWithSegments(p, font); } catch { return null; }
    });
  }, [paragraphs, font]);

  const layout = useMemo(() => {
    if (!prepared || !width || width <= 0) return null;
    try {
      let y = 0;
      const allLines: Array<{
        y: number;
        left: number;
        width: number;
        text: string;
        paragraph: number;
      }> = [];

      prepared.forEach((preparedPara, pIdx) => {
        if (!preparedPara) return;
        let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };
        let safety = 0;
        while (safety++ < 400) {
          const yMid = y + lineHeight * 0.55;
          let lineMaxWidth = width;
          let lineLeft = 0;
          if (obstacle && yMid >= obstacle.top && yMid <= obstacle.top + obstacle.height) {
            const edge = obstacle.edgeAt(yMid);
            if (edge !== null) {
              const padding = obstacle.padding ?? 18;
              if (obstacle.side === "right") {
                lineMaxWidth = Math.max(minLineWidth, edge - padding);
              } else {
                lineLeft = Math.min(width - minLineWidth, edge + padding);
                lineMaxWidth = Math.max(minLineWidth, width - lineLeft);
              }
            }
          }
          const range = layoutNextLineRange(preparedPara, cursor, lineMaxWidth);
          if (!range) break;
          const line = materializeLineRange(preparedPara, range);
          allLines.push({
            y, left: lineLeft, width: lineMaxWidth, text: line.text, paragraph: pIdx,
          });
          cursor = range.end;
          y += lineHeight;
        }
        // gap between paragraphs (except after last)
        if (pIdx < (prepared?.length ?? 0) - 1) y += paragraphGap;
      });

      return { lines: allLines, height: y };
    } catch (e) {
      console.warn("ShapedProse layout failed:", e);
      return null;
    }
  }, [prepared, lineHeight, width, obstacle, minLineWidth, paragraphGap]);

  return (
    <div
      className={className}
      data-pretext-engine="shaped-prose"
      data-pretext-ignore="true"
      style={{
        position: "relative",
        width,
        // before pretext lays out, render a hidden probe so the font
        // resolves on a real DOM node, then show the laid-out lines
        minHeight: layout?.height ?? lineHeight * 4,
        ...style,
      }}
    >
      {/* probe — actually rendered so getComputedStyle works, but kept
          off-screen and invisible after first measure */}
      <span
        ref={probeRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          left: -9999, top: -9999,
          fontFamily: "inherit",
          fontStyle: "inherit",
          fontWeight: "inherit",
          fontSize: "inherit",
          visibility: "hidden",
        }}
      >
        m
      </span>

      {!layout ? (
        // graceful fallback: plain stacked paragraphs (text appears
        // immediately, then re-flows once pretext is ready)
        <div style={{ opacity: 0.85 }}>
          {paragraphs.map((p, i) => (
            <p key={i} style={{ margin: i === 0 ? "0 0 14px" : "0 0 14px", lineHeight: `${lineHeight}px` }}>{p}</p>
          ))}
        </div>
      ) : (
        layout.lines.map((line, i) => (
          <span
            key={i}
            style={{
              position: "absolute",
              top: line.y,
              left: line.left,
              width: line.width,
              lineHeight: `${lineHeight}px`,
              whiteSpace: "pre",
              transition: "top 320ms ease, left 320ms ease, width 320ms ease",
            }}
          >
            {line.text}
          </span>
        ))
      )}
    </div>
  );
}
