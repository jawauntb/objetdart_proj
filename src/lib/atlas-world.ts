/**
 * The world chart: every generated atlas sheet takes an integer address
 * on a plane (east = +wx, south = +wy), so traveled territory persists
 * and a return trip lands on the sheet you left instead of minting a
 * stranger. This is the room's memory of ground covered — the camera,
 * gestures, and generation orchestration stay in Atlas.tsx; this module
 * is pure and DOM-free so the plane's arithmetic can be held to account
 * under plain node.
 *
 * A world lives at one scale. Minting a new subject or settling a new
 * zoom depth starts a fresh plane (reset + origin); lateral travel moves
 * across the current one.
 */

export type AtlasWorldDirection =
  | "north"
  | "east"
  | "south"
  | "west"
  | "northwest"
  | "southeast";

export type AtlasWorldAddress = { wx: number; wy: number };

export type AtlasSheetPhase = "preview" | "final";

export type AtlasWorldSheet<Hotspots = unknown, Seeds = unknown> = {
  address: AtlasWorldAddress;
  image: string;
  hotspots: Hotspots | null;
  seeds: Seeds | null;
  concept: string;
  phase: AtlasSheetPhase;
  depth: number;
};

const DIRECTION_DELTAS: Record<AtlasWorldDirection, AtlasWorldAddress> = {
  north: { wx: 0, wy: -1 },
  south: { wx: 0, wy: 1 },
  east: { wx: 1, wy: 0 },
  west: { wx: -1, wy: 0 },
  northwest: { wx: -1, wy: -1 },
  southeast: { wx: 1, wy: 1 },
};

export const ATLAS_WORLD_ORIGIN: AtlasWorldAddress = Object.freeze({ wx: 0, wy: 0 });

export function shiftAddress(
  address: AtlasWorldAddress,
  direction: AtlasWorldDirection,
): AtlasWorldAddress {
  const delta = DIRECTION_DELTAS[direction];
  return { wx: address.wx + delta.wx, wy: address.wy + delta.wy };
}

export function addressKey(address: AtlasWorldAddress): string {
  return address.wx + "," + address.wy;
}

export function addressesEqual(a: AtlasWorldAddress, b: AtlasWorldAddress): boolean {
  return a.wx === b.wx && a.wy === b.wy;
}

/**
 * Where a newly entered sheet slides in from, in plane units: the sign of
 * the travel delta. Going east, the new land enters from the right and
 * the old ground falls away left — the motion carries the geography.
 */
export function slideVectorFor(direction: AtlasWorldDirection): AtlasWorldAddress {
  const delta = DIRECTION_DELTAS[direction];
  return { wx: delta.wx, wy: delta.wy };
}

/**
 * How strongly place names surface at a given camera zoom. Far ground
 * keeps its quiet (labels only answer the hand); mid descent lets names
 * rise faintly; near ground names the land outright — detail resolves
 * with descent the way a chart earns its annotations.
 */
export function zoomLabelTier(zoom: number): "far" | "mid" | "near" {
  if (!Number.isFinite(zoom) || zoom < 1.35) return "far";
  return zoom < 2.4 ? "mid" : "near";
}

export type AtlasWorld<Hotspots = unknown, Seeds = unknown> = {
  /**
   * Store a sheet at its address. A settled final never yields to a
   * later preview of the same ground — stale speculative work must not
   * erase finished ink. Returns the sheet actually kept.
   */
  remember(sheet: AtlasWorldSheet<Hotspots, Seeds>): AtlasWorldSheet<Hotspots, Seeds>;
  /** Retrieve a sheet and mark it recently walked (protects it from eviction). */
  recall(address: AtlasWorldAddress): AtlasWorldSheet<Hotspots, Seeds> | null;
  /** Retrieve without touching recency — for glances (edge names, the traverse chart). */
  peek(address: AtlasWorldAddress): AtlasWorldSheet<Hotspots, Seeds> | null;
  visited(): AtlasWorldAddress[];
  size(): number;
  reset(): void;
};

/**
 * Sheets are megabyte-scale data URLs, so the world holds a bounded
 * number and lets the least recently walked ground slip back beneath
 * the fog. Recall counts as walking; remembering counts as walking.
 */
export function createAtlasWorld<Hotspots = unknown, Seeds = unknown>(
  capacity = 24,
): AtlasWorld<Hotspots, Seeds> {
  const limit = Math.max(1, Math.floor(capacity));
  // Map iteration order is insertion order; delete + re-set on every
  // touch makes the first key the least recently walked.
  const sheets = new Map<string, AtlasWorldSheet<Hotspots, Seeds>>();
  const touch = (key: string, sheet: AtlasWorldSheet<Hotspots, Seeds>) => {
    sheets.delete(key);
    sheets.set(key, sheet);
  };
  return {
    remember(sheet) {
      const key = addressKey(sheet.address);
      const existing = sheets.get(key);
      const kept = existing && existing.phase === "final" && sheet.phase === "preview"
        ? existing
        : sheet;
      touch(key, kept);
      while (sheets.size > limit) {
        const oldest = sheets.keys().next().value;
        if (oldest === undefined) break;
        sheets.delete(oldest);
      }
      return kept;
    },
    recall(address) {
      const key = addressKey(address);
      const sheet = sheets.get(key) ?? null;
      if (sheet) touch(key, sheet);
      return sheet;
    },
    peek(address) {
      return sheets.get(addressKey(address)) ?? null;
    },
    visited() {
      return Array.from(sheets.values(), (sheet) => sheet.address);
    },
    size() {
      return sheets.size;
    },
    reset() {
      sheets.clear();
    },
  };
}
