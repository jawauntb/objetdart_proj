/**
 * peers — same-scale sibling rooms that share a band address but are not
 * ordered by pinch travel. A drop and a seed live at the same size; birds
 * and flowers answer each other across a meadow; the beach and the deep
 * share the coast; the peak and the cloud floor share olympus.
 *
 * Pinch still owns the axis. Peer travel is a lateral door discovered by
 * the MetaNavigator (twist to open the ring, ceremony-hold a bead).
 *
 * Pure data + tiny helpers. No DOM.
 */

export type PeerRoom = {
  /** SITE_ROUTES key / guide key. */
  key: string;
  href: string;
  /** Lowercase label shown in the peer ring. */
  label: string;
  /** Scale band this peer circle sits on (for spectral chime). */
  band: string;
};

export type PeerCircle = {
  id: string;
  band: string;
  rooms: PeerRoom[];
};

/**
 * Author's peer cosmology. Order inside a circle is the ring order —
 * twist cycles clockwise through it.
 */
export const PEER_CIRCLES: PeerCircle[] = [
  {
    id: "dew",
    band: "drop",
    rooms: [
      { key: "drop", href: "/drop", label: "a drop", band: "drop" },
      { key: "seed", href: "/seed", label: "a seed", band: "drop" },
    ],
  },
  {
    id: "meadow",
    band: "flowers",
    rooms: [
      { key: "flowers", href: "/flowers", label: "flowers", band: "flowers" },
      { key: "birds", href: "/birds", label: "birds", band: "birds" },
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
    ],
  },
  {
    id: "peak",
    band: "olympus",
    rooms: [
      { key: "mountain", href: "/mountain", label: "the mountain", band: "olympus" },
      { key: "clouds", href: "/clouds", label: "the cloud floor", band: "olympus" },
    ],
  },
];

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
