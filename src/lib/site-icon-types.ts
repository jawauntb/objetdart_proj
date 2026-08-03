/**
 * site-icon-types — the leaf shape of a room's icon/OG palette.
 *
 * Split out of `site-icon-config.ts` so a room manifest
 * (`src/rooms/<key>/room.config.ts`) can declare its palette without
 * importing the registry that will consume it. No values live here, only
 * the shape: `site-icon-config.ts` re-exports both names, so nothing that
 * already imports from there needs to change.
 */

export type SiteIconKind =
  | "aphros"
  | "archive"
  | "atlas"
  | "beyond"
  | "charts"
  | "circularity"
  | "clouds"
  | "coin"
  | "colophon"
  | "compare"
  | "earth"
  | "fire"
  | "flowers"
  | "growth"
  | "home"
  | "jewel"
  | "kept"
  | "light"
  | "tourbillon"
  | "ocean"
  | "plasma"
  | "pretext"
  | "pulse"
  | "reading"
  | "signal"
  | "sine"
  | "stars"
  | "storm"
  | "tide"
  | "time"
  | "watch"
  | "waves";

export type SiteIconVisual = {
  title: string;
  description: string;
  path: string;
  shortName: string;
  kind: SiteIconKind;
  bg: string;
  bg2: string;
  glow: string;
  accent: string;
  accent2: string;
  ink: string;
};
