/**
 * nav-groups — the dropdown's sections, computed from registry facts.
 *
 * The law stands untouched: `NAVIGATION_ROUTES` derives from the scale graph
 * (src/lib/nav-order.ts) and is never hand-sorted. This module adds no second
 * order — it *chunks* that same derived sequence into sections a stranger can
 * read: the fold, the scale spine (each peer ring collapsed under the room
 * that leads it), the laws, the lenses, the reading surfaces. Flattening the
 * sections back together reproduces the derived order exactly, and every
 * registered key lands in exactly one section — both pinned by
 * `scripts/test-nav-groups.mjs`, which fails the moment a new room lands in
 * no section or in two.
 *
 * Pure data + tiny helpers. No DOM, no React — node-loadable.
 */

import { SCALE_BANDS, type ScaleBandId } from "@/lib/scale";
import { PEER_CIRCLES } from "@/lib/peers";
import { ROOM_BY_KEY, bandOf, type NavDiscipline } from "@/lib/room-registry";

export type NavRouteRef = {
  key: string;
  href: string;
};

/**
 * One rung of the spine: a peer ring collapsed under its leading room, or a
 * lone band resident with no ring at all (`peers` empty). `primary` is the
 * group's first room in the derived order — for every ring today that is the
 * band's own resident (the drop leads the cabinet, the coast leads the
 * shore) — and `band` / `label` are that room's own scale address.
 */
export type NavBandGroup = {
  /** stable id: `circle:<id>` for a peer ring, `band:<id>` for a lone room. */
  id: string;
  band: ScaleBandId;
  /** the band's label from SCALE_BANDS — "the coast", "a drop", … */
  label: string;
  primary: string;
  /** the rest of the ring, in the same derived order. */
  peers: string[];
};

export type NavSections = {
  /** the top of the axis — the manifold. */
  fold: string[];
  /** every band-addressed room, grouped rung by rung, large → small. */
  spine: NavBandGroup[];
  /** kind "room" with an exempt address — laws and meta views of the tree. */
  laws: string[];
  /** kind "instrument" — spectral lenses and meta-instruments. */
  instruments: string[];
  /** kind "reading" — the surfaces that explain instead of playing. */
  reading: string[];
};

const TOP_BAND_ID: ScaleBandId = SCALE_BANDS[SCALE_BANDS.length - 1].id;

function bandLabel(id: ScaleBandId): string {
  const band = SCALE_BANDS.find((b) => b.id === id);
  return band ? band.label : id;
}

/**
 * Chunk the derived navigation order into sections. `refs` must be
 * `NAVIGATION_ROUTES` (or any list in that derived order); the function
 * neither sorts nor filters beyond the sectioning itself, so concatenating
 * `fold`, the flattened `spine`, and each exempt kind in place reproduces
 * the input order — the invariant test-nav-groups pins.
 */
export function buildNavSections(refs: NavRouteRef[]): NavSections {
  const fold: string[] = [];
  const spine: NavBandGroup[] = [];
  const laws: string[] = [];
  const instruments: string[] = [];
  const reading: string[] = [];
  const groupsById = new Map<string, NavBandGroup>();

  for (const ref of refs) {
    const entry = ROOM_BY_KEY[ref.key];
    if (!entry) {
      throw new Error(`nav-groups: "${ref.key}" is not in ROOM_REGISTRY — register the room first`);
    }
    if (entry.kind === "reading") {
      reading.push(ref.key);
      continue;
    }
    if (entry.kind === "instrument") {
      instruments.push(ref.key);
      continue;
    }
    const band = bandOf(entry);
    if (!band) {
      laws.push(ref.key);
      continue;
    }
    if (band === TOP_BAND_ID) {
      fold.push(ref.key);
      continue;
    }
    // A room in a peer ring groups with its ring (rings are contiguous in the
    // derived order); a lone band resident stands as its own rung.
    const circle = PEER_CIRCLES.find((c) => c.rooms.some((r) => r.key === ref.key));
    const id = circle ? `circle:${circle.id}` : `band:${band}`;
    const group = groupsById.get(id);
    if (group) {
      group.peers.push(ref.key);
    } else {
      const fresh: NavBandGroup = { id, band, label: bandLabel(band), primary: ref.key, peers: [] };
      groupsById.set(id, fresh);
      spine.push(fresh);
    }
  }

  return { fold, spine, laws, instruments, reading };
}

/** The registry's discipline tags for a key — the nav filter reads these. */
export function disciplinesOf(key: string): readonly NavDiscipline[] {
  return ROOM_BY_KEY[key]?.disciplines ?? [];
}
