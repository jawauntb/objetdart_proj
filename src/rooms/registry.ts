/**
 * The room registry — the single place a room is declared.
 *
 * Adding a room is two edits: write `src/rooms/<key>/room.config.ts`, then add
 * one import + one array entry here. From that the site derives, with no
 * further hand-editing:
 *
 *   - `SITE_ROUTES` / `NAVIGATION_ROUTES` / `GALLERY_ROUTES` / dark chrome
 *     (`src/lib/routes.ts`)
 *   - `PEER_CIRCLES` seats + `SCALE_EXEMPT_KEYS` (`src/lib/peers.ts`),
 *     and through them the header dropdown, the home gallery, and the
 *     MetaNavigator ring (`src/lib/nav-order.ts`)
 *   - the favicon / apple-touch / opengraph / manifest palette
 *     (`src/lib/site-icon-config.ts`)
 *   - the field-guide entry (`src/data/guide.ts`)
 *   - `scripts/test-routes.mjs`'s expected key set
 *
 * `scripts/test-rooms.mjs` fails if any of those derivations stop
 * round-tripping. Migration is deliberately incremental: rooms that predate
 * the manifest keep their hand-written registry rows and are merged with
 * these, so nothing has to move at once.
 *
 * Order in `ROOM_MANIFESTS` carries no meaning — placement decides where a
 * room lands. Keep it alphabetical so two lanes appending on the same day
 * conflict on one line instead of overlapping ranges.
 */

import type { RoomGuideEntry, RoomManifest, RoomPlacement } from "@/rooms/types";
import type { SiteIconVisual } from "@/lib/site-icon-types";

import atmosphere from "@/rooms/atmosphere/room.config";
import beam from "@/rooms/beam/room.config";
import cabinet from "@/rooms/cabinet/room.config";
import compass from "@/rooms/compass/room.config";
import galaxy from "@/rooms/galaxy/room.config";
import geyser from "@/rooms/geyser/room.config";
import orb from "@/rooms/orb/room.config";
import pebble from "@/rooms/pebble/room.config";
import planets from "@/rooms/planets/room.config";
import reef from "@/rooms/reef/room.config";
import relativity from "@/rooms/relativity/room.config";
import rocks from "@/rooms/rocks/room.config";
import root from "@/rooms/root/room.config";
import soil from "@/rooms/soil/room.config";
import solar from "@/rooms/solar/room.config";
import spring from "@/rooms/spring/room.config";

export const ROOM_MANIFESTS = [
  atmosphere,
  beam,
  cabinet,
  compass,
  galaxy,
  geyser,
  orb,
  pebble,
  planets,
  reef,
  relativity,
  rocks,
  root,
  soil,
  solar,
  spring,
] as const;

/** Literal union of every manifest-declared room key. */
export type RoomKey = (typeof ROOM_MANIFESTS)[number]["key"];

export const ROOM_MANIFEST_LIST: readonly RoomManifest[] = ROOM_MANIFESTS;

export const ROOM_MANIFEST_BY_KEY: Record<string, RoomManifest> = Object.fromEntries(
  ROOM_MANIFEST_LIST.map((room) => [room.key, room]),
);

export function roomManifest(key: string): RoomManifest | null {
  return ROOM_MANIFEST_BY_KEY[key] ?? null;
}

export function roomManifestForRoute(route: string): RoomManifest | null {
  const path = route.split("?")[0] || route;
  let best: RoomManifest | null = null;
  for (const room of ROOM_MANIFEST_LIST) {
    if (path === room.href || path.startsWith(`${room.href}/`)) {
      if (!best || room.href.length > best.href.length) best = room;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// derivations — one per registry that used to be hand-edited
// ---------------------------------------------------------------------------

/** Route-registry rows, shaped for `SITE_ROUTES`. */
export function roomRouteEntries(): Array<{
  key: string;
  icon: RoomManifest["sigil"];
  href: string;
  anchor?: string;
  desc: string;
  cluster: RoomManifest["cluster"];
  dark?: boolean;
  homePriority?: number;
}> {
  return ROOM_MANIFEST_LIST.map((room) => ({
    key: room.key,
    icon: room.sigil,
    href: room.href,
    ...(room.anchor ? { anchor: room.anchor } : {}),
    desc: room.desc,
    cluster: room.cluster,
    ...(room.dark ? { dark: room.dark } : {}),
    ...(room.homePriority !== undefined ? { homePriority: room.homePriority } : {}),
  }));
}

/** Keys of rooms that declared themselves laws / lenses / reading surfaces. */
export function roomExemptKeys(): string[] {
  return ROOM_MANIFEST_LIST.filter((room) => room.place.kind === "exempt").map((room) => room.key);
}

export type DerivedPeerSeat = {
  key: string;
  href: string;
  label: string;
  band: string;
  circle: string;
  ringAfter?: string;
};

/** Peer seats, grouped by the circle they join. */
export function roomPeerSeats(circleId: string): DerivedPeerSeat[] {
  const out: DerivedPeerSeat[] = [];
  for (const room of ROOM_MANIFEST_LIST) {
    const place: RoomPlacement = room.place;
    if (place.kind !== "peer" || place.circle !== circleId) continue;
    out.push({
      key: room.key,
      href: room.href,
      label: place.label,
      band: place.band,
      circle: place.circle,
      ...(place.ringAfter ? { ringAfter: place.ringAfter } : {}),
    });
  }
  return out;
}

/** Every circle id a manifest wants a seat in. */
export function roomPeerCircleIds(): string[] {
  const ids = new Set<string>();
  for (const room of ROOM_MANIFEST_LIST) {
    if (room.place.kind === "peer") ids.add(room.place.circle);
  }
  return [...ids];
}

/**
 * Splice manifest seats into a circle's hand-written ring. `ringAfter` names
 * the seat a room sits behind; an unknown or absent anchor appends. Pure and
 * order-stable: the same inputs always yield the same ring. Multi-pass so a
 * seat whose anchor is itself a later-declared manifest seat still lands in
 * the right place (a hard requirement when `ROOM_MANIFESTS` is alphabetical
 * and a room like `/geyser` names `/spring` — later in the alphabet — as
 * its ringAfter).
 */
export function mergePeerRing<T extends { key: string }>(
  base: readonly T[],
  seats: readonly DerivedPeerSeat[],
  make: (seat: DerivedPeerSeat) => T,
): T[] {
  const ring: T[] = [...base];
  const lastFor = new Map<string, string>();
  const remaining: DerivedPeerSeat[] = seats.filter(
    (seat) => !ring.some((r) => r.key === seat.key),
  );
  // Iterate until a pass makes no progress. Each pass either places seats
  // whose anchors are now in the ring, or falls back to appending anything
  // still unplaced at the tail (an unknown anchor cannot ever be resolved).
  let guard = remaining.length + 1;
  while (remaining.length > 0 && guard-- > 0) {
    let progressed = false;
    for (let i = 0; i < remaining.length; i++) {
      const seat = remaining[i];
      const anchor = seat.ringAfter
        ? lastFor.get(seat.ringAfter) ?? seat.ringAfter
        : null;
      const at = anchor ? ring.findIndex((r) => r.key === anchor) : -1;
      if (!seat.ringAfter || at >= 0) {
        if (at >= 0) ring.splice(at + 1, 0, make(seat));
        else ring.push(make(seat));
        if (seat.ringAfter) lastFor.set(seat.ringAfter, seat.key);
        remaining.splice(i, 1);
        i--;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  // Anything left has an anchor nothing will ever supply — append at the tail
  // in declared order so the ring is still deterministic.
  for (const seat of remaining) {
    ring.push(make(seat));
    if (seat.ringAfter) lastFor.set(seat.ringAfter, seat.key);
  }
  return ring;
}

/** Icon/OG palettes keyed by room key, for `SITE_ICON_VISUALS`. */
export function roomIconVisuals(): Record<string, SiteIconVisual> {
  return Object.fromEntries(ROOM_MANIFEST_LIST.map((room) => [room.key, room.icon]));
}

/** Field-guide entries, shaped for `GUIDE_ROOMS`. */
export function roomGuideEntries(): Array<
  { key: string; href: string } & {
    title: string;
    essence: string;
    scale?: string;
    moves: string[];
    finds: string[];
    keeps?: string;
    readingSurface?: boolean;
  }
> {
  return ROOM_MANIFEST_LIST.map((room) => {
    const guide: RoomGuideEntry = room.guide;
    return {
      key: room.key,
      href: room.href,
      title: guide.title,
      essence: guide.essence,
      ...(guide.scale ? { scale: guide.scale } : {}),
      moves: [...guide.moves],
      finds: [...(guide.finds ?? [])],
      ...(guide.keeps ? { keeps: guide.keeps } : {}),
      ...(guide.readingSurface ? { readingSurface: true } : {}),
    };
  });
}

/** Band linkage claims: `SCALE_BANDS[band].route` must equal `href`. */
export function roomBandClaims(): Array<{ key: string; band: string; href: string }> {
  const out: Array<{ key: string; band: string; href: string }> = [];
  for (const room of ROOM_MANIFEST_LIST) {
    if (room.place.kind === "band") out.push({ key: room.key, band: room.place.band, href: room.href });
  }
  return out;
}

/** What `<RoomShell>` should mount for a route, with the manifest's overrides. */
export function roomChromeForRoute(route: string): { travel: boolean; peers: boolean } {
  const room = roomManifestForRoute(route);
  return {
    travel: room?.chrome?.travel ?? true,
    peers: room?.chrome?.peers ?? true,
  };
}
