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

/**
 * The room-quality bar, structured. AGENTS.md §"The room quality bar" names
 * seven items; this block is the DECLARATION side of items 3 (make + unmake),
 * 5 (alive at rest — breath + glimmer), and 6 (two senses in the same frame —
 * haptics on every meaningful act). `scripts/test-room-quality.mjs` reads
 * `manifest.life` and verifies each claim against the component source.
 *
 * All fields optional so pre-life manifests still compile — the mechanical
 * checks skip when a room does not carry the block. A room WITH `life` is a
 * room that has promised to satisfy the felt-bar; the audit at
 * `data/object-compiler/audits/phase-3-recompile.md` explains why each field
 * matches its component.
 */
export type RoomLifePopulationObject = {
  /** Singular, lowercase, no article — matches the noun in `guide.moves`. */
  noun: string;
  /** Population cap — the same constant the room's domain lib exports. */
  max_count: number;
  /** One-line description of the per-object state vector. */
  state_shape: string;
  /** One-line description of the object's arc. */
  lifecycle: string;
  /** Which shared bus persists the population between visits. */
  persistence: "world" | "LetGo" | "localStorage" | "ephemeral";
  /** The verb that births a new instance. */
  creates_via_verb: string;
  /** Verbs that retire an instance, in order of everyday reach. */
  retires_via: readonly string[];
  /** How the population is stored — SceneObjectSpec, inline array, or the world.ts registry. */
  implementation_hint: string;
};

export type RoomLifeBreath = {
  /** Breath period in seconds; default 7 matches the site's shared LFO. */
  period_seconds?: number;
  /** What the shader or component reads from the breath (uBreath, getBreath(), ...). */
  reads: readonly string[];
  /** One-line description of what the visitor sees change when nothing is being touched. */
  behavior_at_rest?: string;
};

export type RoomLifeGlimmer = {
  /** Idle threshold in ms; default 20000 per AGENTS.md. */
  after_idle_ms?: number;
  /** One-line description of what a glimmer looks like in this material. */
  visual?: string;
};

/**
 * A verb → haptic-pattern mapping. Only verbs that DO fire a haptic appear
 * here (a verb without a haptic simply is omitted); the mechanical check
 * treats a present key as a promise the pattern lands in the source.
 */
export type RoomLifeHapticsGrammar = {
  tap?: "ripple" | "roll" | "chop" | "tap" | "storm";
  dwell?: string;
  ceremony?: string;
  drag?: string;
  flick?: string;
  twist?: string;
  twist3?: string;
  tap3?: string;
  drag3?: string;
  hold3?: string;
  scrub?: string;
  drum?: string;
  knock?: string;
  shake?: string;
  tilt?: string;
  flip?: string;
  arrows?: string;
};

export type RoomLifeMakeUnmake = {
  /** True if the shared <LetGo> button empties this room's population. */
  letgo_clears_population: boolean;
  /** One line naming the room's solemn act. */
  ceremony_is: string;
};

export type RoomLife = {
  population?: {
    objects: readonly RoomLifePopulationObject[];
  };
  breath?: RoomLifeBreath;
  glimmer?: RoomLifeGlimmer;
  haptics_grammar?: RoomLifeHapticsGrammar;
  make_unmake?: RoomLifeMakeUnmake;
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
  /**
   * The felt-bar declaration for `scripts/test-room-quality.mjs`. When
   * present, every field is a promise the component must keep — a breath
   * uniform declared and modulated, an idle writer running, one haptic per
   * verb in the grammar, `<LetGo>` that actually empties. See AGENTS.md
   * §"The room quality bar".
   */
  life?: RoomLife;
};

/** Narrow a placement without a `switch` at every call site. */
export function isPeerPlacement(
  place: RoomPlacement,
): place is Extract<RoomPlacement, { kind: "peer" }> {
  return place.kind === "peer";
}
