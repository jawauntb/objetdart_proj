/**
 * route → field-guide key.
 *
 * The first half of the only path the help control (`src/components/RoomHelp.tsx`)
 * is allowed to take from "where the visitor is standing" to "what the guide says
 * about it". The second half is `GUIDE_ROOM_BY_KEY` in `src/data/guide.ts`.
 *
 * Split in two on purpose:
 *
 *   - this half is small and reads only `SITE_ROUTES`, so the chrome can decide
 *     whether to render a `?` at all without pulling the guide's ~140KB of prose
 *     into every page's client bundle;
 *   - the second half is the prose, imported lazily the first time the `?` is
 *     pressed.
 *
 * Both halves are total over the routes they claim, and `scripts/test-room-help.mjs`
 * pins that: every row of `SITE_ROUTES` resolves here to its own key, and every key
 * this returns names a real `GUIDE_ROOMS` entry. A room shipped without a guide
 * entry would otherwise open a `?` onto nothing.
 */

import { SITE_ROUTES } from "@/lib/routes";

/** the threshold is a room in the guide, but it has no registry row */
export const HOME_GUIDE_KEY = "home";

/** strip query, hash and any trailing slash; "/" stays "/" */
function normalize(pathname: string): string {
  const path = (pathname.split("?")[0] ?? "").split("#")[0] ?? "";
  if (!path || path === "/") return "/";
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

/** the first path segment, with its leading slash: "/atlas/origin" → "/atlas" */
function baseSegment(path: string): string {
  return `/${path.split("/")[1] ?? ""}`;
}

/**
 * The guide key for a pathname, or null when the route deliberately carries no
 * entry (`/compare`, `/reading/<hash>`, `/site-icons/*` — surfaces that are not
 * rooms and are not registered). Null means: render no `?`, rather than a `?`
 * that opens an empty shell.
 *
 * Three steps, deepest match first, so a room whose registry href already carries
 * a child segment still wins over its parent:
 *
 *   1. `/` is the threshold.
 *   2. The longest registered href that is this path, or a path-prefix of it —
 *      `/light/inverse` resolves to its own room, not to `/light`.
 *   3. The base segment, for dynamic children the registry samples with one
 *      representative href — `/atlas/anywhere` resolves through `/atlas/origin`.
 */
export function guideKeyForPath(pathname: string): string | null {
  const path = normalize(pathname);
  if (path === "/") return HOME_GUIDE_KEY;

  let best: { key: string; depth: number } | null = null;
  for (const route of SITE_ROUTES) {
    const href = normalize(route.href);
    if (path === href || path.startsWith(`${href}/`)) {
      if (!best || href.length > best.depth) best = { key: route.key, depth: href.length };
    }
  }
  if (best) return best.key;

  const base = baseSegment(path);
  const candidates = SITE_ROUTES.filter((route) => {
    const href = normalize(route.href);
    return href === base || href.startsWith(`${base}/`);
  });
  if (candidates.length === 0) return null;
  // A base segment that is itself a room answers for its own unregistered
  // children; otherwise only an unambiguous single claimant may answer.
  const exact = candidates.find((route) => normalize(route.href) === base);
  if (exact) return exact.key;
  return candidates.length === 1 ? candidates[0].key : null;
}
