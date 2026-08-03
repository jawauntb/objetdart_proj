// Color for the field guide's hero, drawn from the album's own palette —
// every room already carries a bg/glow/accent set in site-icon-config.ts.
// The hero doesn't invent color; it samples the rooms that already have it.
// Deterministic from the route key (no Math.random, no Date.now), so the
// guide's face looks the same on every visit until a room's palette changes.

import { SITE_ICON_VISUALS, type SiteIconKey } from "@/lib/site-icon-config";

export type RoomPalette = {
  bg: string;
  bg2: string;
  glow: string;
  accent: string;
  accent2: string;
};

// A handful of guide entries document routes that share metadata with a
// sibling room and have no icon entry of their own (see src/app/*/layout.tsx
// siteMetadata() calls). Borrow the same donor here.
const PALETTE_FALLBACK: Record<string, SiteIconKey> = {
  timbre: "signal",
  instrument: "signal",
  "music-color": "light",
  drop: "jewel",
};

export function resolveRoomPalette(key: string): RoomPalette {
  const iconKey = (key in SITE_ICON_VISUALS ? key : PALETTE_FALLBACK[key] ?? "home") as SiteIconKey;
  const visual = SITE_ICON_VISUALS[iconKey];
  return { bg: visual.bg, bg2: visual.bg2, glow: visual.glow, accent: visual.accent, accent2: visual.accent2 };
}

/** "#rrggbb" → "rgba(r, g, b, alpha)". Falls back to opaque on a bad hex. */
export function hexToRgba(hex: string, alpha: number): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const value = parseInt(match[1], 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type AuroraSpot = {
  key: string;
  leftPct: number;
  topPct: number;
  sizePx: number;
  color: string;
  color2: string;
  delayMs: number;
  durationMs: number;
};

const BREATH_MS = 7000; // the site's one shared clock (AGENTS.md: "one clock family")

/**
 * Lays out one breathing color spot per room key, sampled evenly if there
 * are more keys than `max`. Pure function of the key order — same input,
 * same layout, always.
 */
export function auroraSpots(keys: string[], max = 20): AuroraSpot[] {
  if (keys.length === 0) return [];
  const stride = Math.max(1, Math.ceil(keys.length / max));
  const sampled = keys.filter((_, index) => index % stride === 0);

  return sampled.map((key, index) => {
    const rng = mulberry32(hashString(key) ^ 0x9e3779b1);
    const palette = resolveRoomPalette(key);
    const leftPct = 4 + rng() * 92;
    const topPct = 6 + rng() * 88;
    const sizePx = 90 + rng() * 210;
    const durationMs = BREATH_MS * (1 + Math.floor(rng() * 2)); // 7s or 14s, still the one family
    const delayMs = Math.round((index / sampled.length) * BREATH_MS);
    return {
      key,
      leftPct,
      topPct,
      sizePx,
      color: palette.glow,
      color2: palette.accent2,
      delayMs,
      durationMs,
    };
  });
}
