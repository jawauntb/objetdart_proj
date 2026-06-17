"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useField } from "@/store/field";
import type { ConcernKey } from "@/lib/types";

/**
 * Concern tint.
 *
 * A fixed full-screen overlay that gains a faint hue when the user is
 * holding a concern axis (and a concern-tone is playing in audio). The
 * tint matches the held concern's voice color. It fades IN over 300ms
 * (attack) and back out over 800ms (release) — the release is slower
 * than the attack, so letting go feels like a sigh.
 *
 * Coupling, not painting: the goal is to make the whole page palette
 * subtly listen to the tone, not to color it. Alpha stays at ~0.06 and
 * mix-blend-mode: multiply means the tint behaves like a color filter
 * rather than a translucent veil.
 */

const TINT: Record<ConcernKey, string> = {
  prayer:     "rgba(255, 200, 100, 1)",
  love:       "rgba(245, 170, 165, 1)",
  memory:     "rgba(110, 130, 180, 1)",
  work:       "rgba(110, 120, 130, 1)",
  risk:       "rgba(220,  80,  80, 1)",
  future:     "rgba(120, 180, 220, 1)",
  body:       "rgba(140, 170, 110, 1)",
  friendship: "rgba(200, 140, 100, 1)",
};

const PEAK_ALPHA = 0.06;

export default function ConcernTint() {
  const heldConcern = useField((s) => s.heldConcern);
  const pathname = usePathname() ?? "/";

  // The color we're currently rendering. We keep the last color while
  // fading out, so we don't snap to transparent-black mid-release.
  const [color, setColor] = useState<string>("rgba(0, 0, 0, 0)");
  const [opacity, setOpacity] = useState<number>(0);
  const lastKeyRef = useRef<ConcernKey | null>(null);

  useEffect(() => {
    if (heldConcern) {
      setColor(TINT[heldConcern]);
      setOpacity(PEAK_ALPHA);
      lastKeyRef.current = heldConcern;
    } else {
      // keep the previous color so the fade resolves cleanly
      setOpacity(0);
    }
  }, [heldConcern]);

  // hide on reading-share pages (OG / printable) — like Tape and FieldWatch
  if (pathname.startsWith("/reading/")) return null;

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 25,
        mixBlendMode: "multiply",
        backgroundColor: color,
        opacity,
        // attack (color) is faster than release (opacity)
        transition: "background-color 300ms ease, opacity 800ms ease",
        willChange: "opacity",
      }}
    />
  );
}
