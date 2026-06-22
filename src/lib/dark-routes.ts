/**
 * Immersive "dark" routes — full-bleed scenes painted over deep water, night
 * sky, fire, etc. The floating chrome (header, tape, field watch) switches to
 * a dark palette on these so it never stamps a light band over the scene.
 *
 * Kept in one place so every overlay agrees on which routes are dark.
 */
const DARK_ROUTE_PREFIXES = [
  "/ocean",
  "/tide",
  "/watch",
  "/waves",
  "/sine",
  "/pretext",
  "/circularity",
  "/beyond",
  "/storm",
  "/clouds",
  "/flowers",
  "/signal",
  "/light",
  "/plasma",
  "/pulse",
  "/charts",
  "/time",
  "/fire",
  "/earth",
  "/growth",
  "/stars",
];

export function isDarkRoute(pathname: string): boolean {
  return DARK_ROUTE_PREFIXES.some((p) => pathname.startsWith(p));
}
