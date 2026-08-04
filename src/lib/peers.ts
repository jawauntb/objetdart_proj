/**
 * peers — same-scale sibling rooms that share a band address but are not
 * ordered by pinch travel. A drop and a seed live at the same size; birds
 * and flowers answer each other across a meadow; the beach and the deep
 * share the coast; the peak and the cloud floor share olympus; the
 * cabinet of handheld objects (coin, watch, jewel…) sits at the drop.
 *
 * Pinch still owns the axis. Peer travel is a lateral door discovered by
 * the MetaNavigator (two-finger dwell opens the ring, twist cycles,
 * ceremony-hold travels).
 *
 * Every interactive room that takes a physical scale address appears in
 * exactly one peer circle *or* as a band primary in SCALE_BANDS. Rooms
 * that are laws, lenses, or reading surfaces stay in SCALE_EXEMPT_KEYS
 * and sit after the axis in the dropdown — never hand-sorted into the
 * middle of the manifold.
 *
 * Pure data + tiny helpers. No DOM.
 *
 * Rooms that carry a manifest (`src/rooms/<key>/room.config.ts`) declare their
 * seat there — `place: { kind: "peer", circle, band, label, ringAfter }` — and
 * are spliced into the rings below by `mergePeerRing`. Nothing here is
 * hand-edited for those rooms; `scripts/test-rooms.mjs` pins the splice.
 */

import { mergePeerRing, roomExemptKeys, roomPeerCircleIds, roomPeerSeats } from "@/rooms/registry";

export type PeerRoom = {
  /** SITE_ROUTES key / guide key. */
  key: string;
  href: string;
  /** Lowercase label shown in the peer ring. */
  label: string;
  /** Scale band id from SCALE_BANDS (for spectral chime + nav placement). */
  band: string;
};

export type PeerCircle = {
  id: string;
  band: string;
  rooms: PeerRoom[];
};

/**
 * Deliberate exemptions from the scale axis: meta views of the tree,
 * spectral meta-instruments, and reading surfaces. Most are registered in
 * SITE_ROUTES and simply sit after the quark→manifold walk in the dropdown;
 * the last two are pages that exist on disk and are deliberately NOT
 * registered at all. Either way this list is the one place an exemption is
 * declared. If a page is neither here nor on a band/peer circle, tests fail
 * — that failure means find its place, don't silence the test.
 */
const CORE_SCALE_EXEMPT_KEYS = [
  "overlook",
  "loom",
  "time", // relativity instrument — the covenant holds at every band
  "signal",
  "light",
  "music-color",
  "timbre",
  "instrument", // meta-instruments / spectral lenses, not places
  "archive",
  "kept",
  "colophon",
  "guide", // reading surfaces
  // /compare and /reading/[hash] are pages on disk that are deliberately
  // NOT in SITE_ROUTES: they are reading surfaces over a kept reading,
  // reached only from /kept and from a shared permalink, and they would be
  // noise in the gallery. Listing them here is the standing answer to "why
  // does this page escape the axis"; scripts/test-routes.mjs pins the list
  // against src/app so the next unregistered room fails loudly instead of
  // slipping past the completeness check the way /compare did.
  "compare",
  "reading",
] as const;

/** Core exemptions plus every manifest room that declared `place.kind === "exempt"`. */
export const SCALE_EXEMPT_KEYS: readonly string[] = [
  ...CORE_SCALE_EXEMPT_KEYS,
  ...roomExemptKeys(),
];

export type ScaleExemptKey = (typeof CORE_SCALE_EXEMPT_KEYS)[number] | (string & {});

export const SCALE_EXEMPT_KEY_SET: ReadonlySet<string> = new Set(SCALE_EXEMPT_KEYS);

/**
 * Author's peer cosmology. Order inside a circle is the ring order —
 * twist cycles clockwise through it, and the site dropdown / gallery
 * expand the same order at the circle's highest band (see nav-order.ts).
 * Adding a peer here updates MetaNavigator and the nav sequence together.
 */
const CORE_PEER_CIRCLES: PeerCircle[] = [
  {
    id: "sky",
    band: "stars",
    rooms: [
      { key: "stars", href: "/stars", label: "the stars", band: "stars" },
      { key: "comb", href: "/comb", label: "the comb", band: "stars" },
      // /beam declares its seat in src/rooms/beam/room.config.ts (ringAfter: comb).
    ],
  },
  {
    id: "hearth",
    band: "earth",
    // The ground, its fire, and its map. The atlas keeps its own band (it is
    // a chart of a region, metrically smaller than the globe) but it is not
    // a size away from the earth — it is the same ground at a different
    // level of description, which is a lateral door, not a pinch. Removing
    // `earth.up = "atlas"` from the travel graph took the map off the axis's
    // up-wall; this is where it lands instead. Circle anchors at earth
    // (the highest band among its rooms), so the nav order is unchanged.
    rooms: [
      { key: "earth", href: "/earth", label: "the earth", band: "earth" },
      { key: "fire", href: "/fire", label: "fire", band: "earth" },
      { key: "atlas", href: "/atlas/origin", label: "the atlas", band: "atlas" },
    ],
  },
  {
    id: "peak",
    band: "olympus",
    rooms: [
      { key: "mountain", href: "/mountain", label: "the mountain", band: "olympus" },
      { key: "clouds", href: "/clouds", label: "the cloud floor", band: "olympus" },
      { key: "storm", href: "/storm", label: "the storm", band: "olympus" },
    ],
  },
  {
    id: "shore",
    band: "coast",
    rooms: [
      { key: "coast", href: "/coast", label: "the coast", band: "coast" },
      { key: "ocean", href: "/ocean", label: "the deep", band: "coast" },
      { key: "tide", href: "/tide", label: "the tide", band: "coast" },
      { key: "waves", href: "/waves", label: "waves", band: "coast" },
      { key: "sine", href: "/sine", label: "a sine", band: "coast" },
      { key: "circularity", href: "/circularity", label: "circles", band: "coast" },
      { key: "pretext", href: "/pretext", label: "pretext", band: "coast" },
      { key: "aphros", href: "/aphros", label: "aphros", band: "coast" },
    ],
  },
  {
    id: "meadow",
    // Anchor at birds (the higher rung); ring order large → small so the
    // dropdown and the peer twist agree: flock above garden above growth.
    band: "birds",
    rooms: [
      { key: "birds", href: "/birds", label: "birds", band: "birds" },
      { key: "flowers", href: "/flowers", label: "flowers", band: "flowers" },
      { key: "growth", href: "/growth", label: "growth", band: "flowers" },
    ],
  },
  {
    id: "cabinet",
    // Handheld and desk-scale objects at the drop: living micro-worlds and
    // the instruments you turn in your hands.
    band: "drop",
    rooms: [
      { key: "drop", href: "/drop", label: "a drop", band: "drop" },
      { key: "seed", href: "/seed", label: "a seed", band: "drop" },
      { key: "coin", href: "/coin", label: "a coin", band: "drop" },
      { key: "jewel", href: "/jewel", label: "a jewel", band: "drop" },
      { key: "tourbillon", href: "/tourbillon", label: "tourbillon", band: "drop" },
      { key: "watch", href: "/watch", label: "the watch", band: "drop" },
      { key: "plasma", href: "/plasma", label: "plasma", band: "drop" },
      { key: "pulse", href: "/pulse", label: "pulse", band: "drop" },
      { key: "charts", href: "/charts", label: "charts", band: "drop" },
      { key: "dither", href: "/dither", label: "dither", band: "drop" },
    ],
  },
];

/**
 * The rings the site actually walks: the author's cosmology above, with every
 * manifest-declared seat spliced in at its `ringAfter` anchor. A manifest that
 * names a circle nobody defined is a typo, not a new ring — fail loud.
 */
export const PEER_CIRCLES: PeerCircle[] = CORE_PEER_CIRCLES.map((circle) => ({
  ...circle,
  rooms: mergePeerRing(circle.rooms, roomPeerSeats(circle.id), (seat) => ({
    key: seat.key,
    href: seat.href,
    label: seat.label,
    band: seat.band,
  })),
}));

for (const id of roomPeerCircleIds()) {
  if (!CORE_PEER_CIRCLES.some((c) => c.id === id)) {
    throw new Error(
      `Room manifest names peer circle "${id}", which is not in PEER_CIRCLES. ` +
        `A new ring is a cosmology decision — add it here deliberately.`,
    );
  }
}

/** Flat index of every peer-placed room (excludes solo band primaries). */
export function allPeerRooms(): PeerRoom[] {
  const out: PeerRoom[] = [];
  const seen = new Set<string>();
  for (const circle of PEER_CIRCLES) {
    for (const room of circle.rooms) {
      if (seen.has(room.key)) continue;
      seen.add(room.key);
      out.push(room);
    }
  }
  return out;
}

export function peerRoomForRoute(route: string): PeerRoom | null {
  const path = route.split("?")[0] || route;
  for (const room of allPeerRooms()) {
    if (path === room.href || path.startsWith(`${room.href}/`)) return room;
  }
  return null;
}

export function peerCircleForRoute(route: string): PeerCircle | null {
  const path = route.split("?")[0] || route;
  for (const circle of PEER_CIRCLES) {
    if (circle.rooms.some((r) => path === r.href || path.startsWith(`${r.href}/`))) {
      return circle;
    }
  }
  return null;
}

export function peersOf(route: string): PeerRoom[] {
  const circle = peerCircleForRoute(route);
  if (!circle) return [];
  const path = route.split("?")[0] || route;
  return circle.rooms.filter((r) => !(path === r.href || path.startsWith(`${r.href}/`)));
}

export function nextPeer(route: string, delta = 1): PeerRoom | null {
  const circle = peerCircleForRoute(route);
  if (!circle || circle.rooms.length < 2) return null;
  const path = route.split("?")[0] || route;
  const idx = circle.rooms.findIndex((r) => path === r.href || path.startsWith(`${r.href}/`));
  if (idx < 0) return null;
  const n = circle.rooms.length;
  return circle.rooms[((idx + delta) % n + n) % n] ?? null;
}
