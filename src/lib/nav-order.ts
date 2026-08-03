/**
 * nav-order — dropdown / gallery order derived from the scale graph.
 *
 * The site header and the home gallery walk one sequence: largest scale at
 * the top (the manifold), smallest at the bottom (the quanta). Lateral peers
 * from MetaNavigator (`PEER_CIRCLES`) sit together at their circle's highest
 * band, in ring order — so adding a peer to a circle updates the dropdown
 * without a second hand-maintained list.
 *
 * After the axis: meta views of the tree (overlook, relativity, loom), then
 * off-axis instruments and reading surfaces in SITE_ROUTES registration
 * order. Pure helpers; no DOM.
 *
 * Law for agents: never hand-maintain dropdown order. Add the room to
 * SCALE_BANDS and/or PEER_CIRCLES; NAVIGATION_ROUTES re-derives itself.
 */

import { SCALE_BANDS, type ScaleBand } from "@/lib/scale";
import { PEER_CIRCLES, type PeerCircle } from "@/lib/peers";

export type NavRouteRef = {
  key: string;
  href: string;
};

/** Band index in SCALE_BANDS, or -1 if unknown. */
function bandIndex(id: string): number {
  return SCALE_BANDS.findIndex((b) => b.id === id);
}

/**
 * A peer circle anchors at the *largest* band among its rooms, so a meadow
 * that holds both flowers and birds rises to the birds rung when the
 * dropdown walks large → small.
 */
export function peerCircleAnchorBand(circle: PeerCircle): string {
  let best = circle.band;
  let bestIdx = bandIndex(circle.band);
  for (const room of circle.rooms) {
    const i = bandIndex(room.band);
    if (i > bestIdx) {
      bestIdx = i;
      best = room.band;
    }
  }
  return best;
}

/** Match a band's route string to a registered route key via href prefix. */
export function keyForBandRoute(
  route: string | null,
  refs: NavRouteRef[],
): string | null {
  if (!route) return null;
  // Prefer exact href, then longest prefix (so /atlas/origin beats /atlas).
  let best: string | null = null;
  let bestLen = -1;
  for (const r of refs) {
    if (r.href === route || route.startsWith(r.href + "/") || r.href.startsWith(route + "/")) {
      if (r.href.length > bestLen) {
        best = r.key;
        bestLen = r.href.length;
      }
    }
  }
  // Also accept band.route that equals the path of a key (e.g. "/drop").
  if (!best) {
    for (const r of refs) {
      if (r.href === route) return r.key;
    }
  }
  return best;
}

/**
 * Axis keys large → small, with each peer circle expanded in ring order at
 * its anchor band. Returns only keys present in `refs`.
 */
export function axisNavigationKeys(refs: NavRouteRef[]): string[] {
  const byKey = new Map(refs.map((r) => [r.key, r]));
  const seen = new Set<string>();
  const out: string[] = [];

  const emit = (key: string | null | undefined) => {
    if (!key || seen.has(key) || !byKey.has(key)) return;
    seen.add(key);
    out.push(key);
  };

  const circlesAt = new Map<string, PeerCircle[]>();
  for (const circle of PEER_CIRCLES) {
    const anchor = peerCircleAnchorBand(circle);
    const list = circlesAt.get(anchor) ?? [];
    list.push(circle);
    circlesAt.set(anchor, list);
  }
  const emittedCircles = new Set<string>();

  // Walk the axis from the fold down to the field floor.
  for (let i = SCALE_BANDS.length - 1; i >= 0; i--) {
    const band: ScaleBand = SCALE_BANDS[i];
    const circles = circlesAt.get(band.id) ?? [];
    for (const circle of circles) {
      if (emittedCircles.has(circle.id)) continue;
      emittedCircles.add(circle.id);
      for (const room of circle.rooms) emit(room.key);
    }
    // Band primary resident (if not already pulled in by a peer circle).
    emit(keyForBandRoute(band.route, refs));
  }

  return out;
}

/**
 * Full navigation order: scale axis (peers expanded) → meta views of the
 * tree → remaining SITE_ROUTES in registration order.
 */
export function scaleOrderedNavigationKeys(refs: NavRouteRef[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const emit = (key: string) => {
    if (seen.has(key)) return;
    if (!refs.some((r) => r.key === key)) return;
    seen.add(key);
    out.push(key);
  };

  for (const key of axisNavigationKeys(refs)) emit(key);

  // Views of the axis itself — after the fold, before free instruments.
  for (const key of ["overlook", "relativity", "loom"]) emit(key);

  // Everything else, stable in the author's SITE_ROUTES registration order.
  for (const r of refs) emit(r.key);

  return out;
}

/** Bands present on the axis walk, large → small (for tests / docs). */
export function scaleBandIdsLargeToSmall(): string[] {
  return SCALE_BANDS.map((b) => b.id).reverse();
}
