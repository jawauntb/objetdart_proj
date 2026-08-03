/**
 * The room manifest — one room, declared once.
 *
 * Before this file, shipping a room meant hand-editing seven registries
 * (`src/lib/routes.ts`, `src/lib/peers.ts`, `src/lib/site-icon-config.ts`,
 * `src/data/guide.ts`, `scripts/test-routes.mjs`, plus nav and MetaNavigator
 * by way of the first two). Every lane touched the same lines, and every lane
 * collided. A manifest inverts that: the room states its own facts in its own
 * directory, and the registries *derive* themselves from it.
 *
 * The rule for agents: a new room writes `src/rooms/<key>/room.config.ts` and
 * adds one import line to `src/rooms/index.ts`. Nothing else. If you find
 * yourself hand-adding a key to a registry, the manifest is missing a field —
 * add the field, don't hand-edit the registry.
 *
 * Pure types and pure data. No DOM, no React, no imports from the registries
 * this feeds (that would close a cycle) — `scripts/test-rooms.mjs` loads this
 * tree in plain node.
 */

import type { RouteSigilKind } from "@/components/RouteSigil";
import type { SiteIconVisual } from "@/lib/site-icon-types";

/** Home-gallery grouping. Re-exported by `src/lib/routes.ts`. */
export type SiteRouteCluster = "field" | "water" | "nature" | "mechanism";

/**
 * Where the room sits in the cosmology — the ordinal decision from
 * `docs/new-room.md` §1, made once, in the room's own file.
 *
 * - `band`   — the primary resident of a `SCALE_BANDS` band. The band's
 *              `route` in `src/lib/scale.ts` must already point at this room;
 *              the manifest does not write scale spans (those are the author's
 *              physics), it only asserts the link so the two cannot drift.
 * - `peer`   — a seat in a MetaNavigator ring (`PEER_CIRCLES`). `ringAfter`
 *              pins the seat deterministically: ring order is twist order and
 *              dropdown order, so it may never depend on import order.
 * - `exempt` — a law, lens, or reading surface with no physical scale. `why`
 *              is the one sentence AGENTS.md asks for in the PR body.
 */
export type RoomPlacement =
  | { kind: "band"; band: string }
  | { kind: "peer"; circle: string; band: string; label: string; ringAfter?: string }
  | { kind: "exempt"; why: string };

/** The room's field-guide entry, minus the key/href the manifest already owns. */
export type RoomGuideEntry = {
  title: string;
  essence: string;
  /** where it sits on the quark→manifold axis, in the room's own words */
  scale?: string;
  /** exhaustive: every gesture the room answers, each reading "verb → answer" */
  moves: readonly string[];
  /** the non-obvious rewards a patient hand finds */
  finds?: readonly string[];
  /** what it remembers between visits */
  keeps?: string;
  /** declared reading surfaces may document fewer than three moves */
  readingSurface?: boolean;
};

/** What `<RoomShell>` mounts for this room by default. */
export type RoomChrome = {
  /** Pinch-owned scale travel. Default true; false while the room owns pinch. */
  travel?: boolean;
  /** Lateral peer ring. Default true; no-ops when the route has no circle. */
  peers?: boolean;
};

export type RoomManifest = {
  /** Registry key: `SITE_ROUTES`, guide, icon config, and tests all use it. */
  key: string;
  /** Absolute path. */
  href: string;
  /** `RouteSigil` glyph shown in the header dropdown and gallery. */
  sigil: RouteSigilKind;
  /** One lowercase line for the dropdown. */
  desc: string;
  cluster: SiteRouteCluster;
  /** Dark chrome for this route and its children. */
  dark?: boolean;
  /** Home-gallery weight, when the room earns a larger tile. */
  homePriority?: number;
  /** Anchor id on the home page; home links scroll instead of navigating. */
  anchor?: string;
  place: RoomPlacement;
  /** Favicon / apple-touch / opengraph / manifest palette. */
  icon: SiteIconVisual;
  guide: RoomGuideEntry;
  chrome?: RoomChrome;
};

/** Narrow a placement without a `switch` at every call site. */
export function isPeerPlacement(
  place: RoomPlacement,
): place is Extract<RoomPlacement, { kind: "peer" }> {
  return place.kind === "peer";
}
