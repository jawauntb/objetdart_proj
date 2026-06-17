"use client";

import { useEffect, useState } from "react";

/**
 * Renders text that gently fades when its content changes — instead of
 * the new string snapping in, the old fades out and the new fades in over
 * ~360ms. Used for reading paragraphs that update live with the concern
 * compass.
 *
 * Implementation: when the children prop changes, we hold the previous
 * text for the duration of a fade-out, then swap to the new. A small
 * debounce avoids flicker during rapid drags.
 */
export default function MorphText({
  children,
  className,
  style,
  delay = 60,
  duration = 360,
}: {
  children: string;
  className?: string;
  style?: React.CSSProperties;
  delay?: number;
  duration?: number;
}) {
  const [shown, setShown] = useState(children);
  const [phase, setPhase] = useState<"in" | "out">("in");

  useEffect(() => {
    if (children === shown) return;
    let cancelled = false;
    setPhase("out");
    const fadeOut = setTimeout(() => {
      if (cancelled) return;
      setShown(children);
      requestAnimationFrame(() => {
        if (cancelled) return;
        setPhase("in");
      });
    }, delay + duration * 0.4);
    return () => {
      cancelled = true;
      clearTimeout(fadeOut);
    };
  }, [children, shown, delay, duration]);

  return (
    <span
      className={className}
      style={{
        ...style,
        display: "inline-block",
        transition: `opacity ${duration}ms ease, transform ${duration}ms ease`,
        opacity: phase === "out" ? 0 : 1,
        transform: phase === "out" ? "translateY(2px)" : "translateY(0)",
      }}
    >
      {shown}
    </span>
  );
}
