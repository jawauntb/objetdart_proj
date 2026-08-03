// One shared coast, four pages onto it. Every persistent natural — shells,
// kelp, driftwood, starfish, sand dollars, lily pads, leaves, koi — lives in
// this single localStorage-backed pool. Each has a `zone` field naming which
// page's shore it is currently on; each page renders only its own zone. Over
// elapsed real time, naturals occasionally hop between adjacent zones so a
// shell placed on /ocean can turn up on /tide the next day. That is the
// difference between four scenes and one place: the shell travelled while
// you were gone.
//
// Migration on first load: reads the old per-page localStorage keys
// (`objetdart:ocean:naturals:v1`, `objetdart:tide:naturals:v1`,
// `objetdart:waves:naturals:v1`, and the beach's own `objetdart:coast:v1`)
// and folds them into the new shared key, then deletes the old ones. Users
// lose nothing.

// The sky is a zone of the same world: what /atmosphere gives to the wind
// drifts across its own frame while nobody is watching, exactly as a shell
// drifts along the shore. It borders nothing — a lantern released into the
// air column stays in the air column — so no coast page ever sees one.
export type WorldZone = "ocean" | "tide" | "waves" | "coast" | "sky";

// The catalog of everything the coast can carry. Different pages will only
// render kinds that fit — a lily pad on /tide would read as a mistake, so
// migration also validates that a kind belongs in its destination zone.
export type WorldKind =
  | "seashell"
  | "kelp"
  | "driftwood"
  | "starfish"
  | "sanddollar"
  | "lily"
  | "leaf"
  | "koi"
  | "lantern";

export type WorldNatural = {
  id: string;
  kind: WorldKind;
  zone: WorldZone;
  nx: number;        // 0..1 — page-local x
  ny: number;        // 0..1 — page-local band position (page-specific meaning)
  vx: number;        // page-local drift rate, cycles per hour
  seed: number;
  createdAt: number; // ms since epoch — first placed
  lastSeen: number;  // ms since epoch — used for both drift and migration accounting
};

const KEY = "objetdart:world:naturals:v1";
const MAX_NATURALS = 64;         // whole coast, not per zone
const MAX_PER_ZONE = 30;         // gentle per-zone cap so no page gets flooded
const HOUR_MS = 3_600_000;
const MAX_ELAPSED_H = 12;        // don't let drift teleport a shell after weeks away

// Which zone is adjacent to which. A shell on /ocean can drift to /tide's
// shore; kelp fragments and floating things can wash between the three
// water pages. Kept explicit so the geography is legible.
// The beach (coast) borders the tide pools and the breaking waves; a shell
// left on the sand can be carried out to either, and things wash up onto the
// coast from them in turn. The deep (ocean) still reaches the beach through
// the tide it shares.
const NEIGHBORS: Record<WorldZone, WorldZone[]> = {
  ocean: ["tide", "waves"],
  tide: ["ocean", "waves", "coast"],
  waves: ["ocean", "tide", "coast"],
  coast: ["tide", "waves"],
  sky: [],
};

// Which kinds belong in which zones. A lily pad only makes sense on /waves;
// a starfish would look odd on a pond. Kept restrictive at first — we can
// expand as new visuals ship.
const KIND_ZONES: Record<WorldKind, WorldZone[]> = {
  seashell:   ["ocean", "tide", "coast"],
  kelp:       ["ocean", "tide", "waves", "coast"],
  driftwood:  ["ocean", "tide", "waves", "coast"],
  starfish:   ["ocean", "tide", "coast"],
  sanddollar: ["ocean", "tide", "coast"],
  lily:       ["waves"],
  leaf:       ["waves", "ocean"],
  koi:        ["waves"],
  lantern:    ["sky"],
};

// Base probability per real hour that a natural hops to a neighbor zone.
// Kept low so travel feels earned, not chaotic. Wind-scale things (leaves,
// kelp) hop a bit faster; heavy or anchored things (driftwood, starfish,
// koi) hop rarely or never.
const HOP_RATE_PER_HOUR: Record<WorldKind, number> = {
  seashell:   0.03,
  kelp:       0.06,
  driftwood:  0.02,
  starfish:   0.005,
  sanddollar: 0.01,
  lily:       0.015,
  leaf:       0.08,
  koi:        0.002,
  lantern:    0,      // the air column keeps its own
};

function safe(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function validate(raw: unknown): WorldNatural | null {
  if (!raw || typeof raw !== "object") return null;
  const n = raw as Record<string, unknown>;
  if (typeof n.id !== "string") return null;
  if (typeof n.kind !== "string") return null;
  if (typeof n.zone !== "string") return null;
  if (typeof n.nx !== "number") return null;
  if (typeof n.ny !== "number") return null;
  const kind = n.kind as WorldKind;
  const zone = n.zone as WorldZone;
  if (!(kind in KIND_ZONES)) return null;
  if (!(zone in NEIGHBORS)) return null;
  return {
    id: n.id,
    kind,
    zone,
    nx: Math.max(0, Math.min(1, n.nx)),
    ny: Math.max(0, Math.min(1, n.ny)),
    vx: typeof n.vx === "number" ? n.vx : 0,
    seed: typeof n.seed === "number" ? n.seed : 0,
    createdAt: typeof n.createdAt === "number" ? n.createdAt : Date.now(),
    lastSeen: typeof n.lastSeen === "number" ? n.lastSeen : Date.now(),
  };
}

/** The beach's own pre-world store, retired by `migrateLegacy`. */
export const LEGACY_COAST_KEY = "objetdart:coast:v1";

/**
 * Shape-adapter for the beach's private store, which predates the shared
 * pool and looks nothing like it: `{ shells: [{ nx, ny, seed }] }`, no ids,
 * no kinds, no timestamps. Folded forward rather than dropped — a visitor
 * who left shells on the sand before /coast joined the pool still finds
 * them there, and afterwards they can wash out to /tide like any other.
 *
 * Pure so the fold is testable without a Storage. Ids carry the array index
 * as well as the seed: two shells planted at the same seed are still two
 * shells, and per-object delete must not take both.
 */
export function coastShellsToNaturals(parsed: unknown, nowMs = Date.now()): WorldNatural[] {
  const shells = (parsed as { shells?: unknown } | null | undefined)?.shells;
  if (!Array.isArray(shells)) return [];
  const out: WorldNatural[] = [];
  for (let i = 0; i < shells.length; i++) {
    const s = shells[i] as { nx?: unknown; ny?: unknown; seed?: unknown } | null;
    if (!s || typeof s.nx !== "number" || typeof s.ny !== "number") continue;
    if (!Number.isFinite(s.nx) || !Number.isFinite(s.ny)) continue;
    const seed =
      typeof s.seed === "number" && Number.isFinite(s.seed) ? Math.floor(s.seed) >>> 0 : i >>> 0;
    out.push({
      id: `coast-legacy-${seed}-${i}`,
      kind: "seashell",
      zone: "coast",
      nx: Math.max(0, Math.min(1, s.nx)),
      ny: Math.max(0, Math.min(1, s.ny)),
      vx: 0,
      seed,
      // ordered oldest-first so the cap retires the ones left longest ago
      createdAt: nowMs - (shells.length - i) * 1000,
      lastSeen: nowMs,
    });
  }
  return out;
}

// One-shot import from the old per-page keys. Runs once; the old keys are
// removed after the fold so a second load reads clean.
function migrateLegacy(store: Storage): WorldNatural[] {
  const legacyKeys: Array<[string, WorldZone]> = [
    ["objetdart:ocean:naturals:v1", "ocean"],
    ["objetdart:tide:naturals:v1", "tide"],
    ["objetdart:waves:naturals:v1", "waves"],
  ];
  const found: WorldNatural[] = [];
  for (const [key, zone] of legacyKeys) {
    const raw = store.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) continue;
      for (const entry of parsed) {
        const n = validate({ ...entry, zone });
        if (n) found.push(n);
      }
    } catch {
      /* skip */
    }
    store.removeItem(key);
  }
  const coastRaw = store.getItem(LEGACY_COAST_KEY);
  if (coastRaw) {
    try {
      for (const n of coastShellsToNaturals(JSON.parse(coastRaw) as unknown)) found.push(n);
    } catch {
      /* skip */
    }
    store.removeItem(LEGACY_COAST_KEY);
  }
  return found;
}

// Apply drift-while-away + probabilistic zone hops. Called once per load so
// the world visibly evolved between visits. Capped elapsed hours so a
// months-old shell doesn't teleport to the far end of the coast.
function applyElapsed(naturals: WorldNatural[]): WorldNatural[] {
  const nowMs = Date.now();
  return naturals.map((n) => {
    const hoursAway = Math.min(MAX_ELAPSED_H, Math.max(0, (nowMs - n.lastSeen) / HOUR_MS));
    if (hoursAway <= 0) return { ...n, lastSeen: nowMs };

    // horizontal drift within its own zone
    let nx = n.nx + (n.vx || 0) * hoursAway;
    nx = ((nx % 1) + 1) % 1;

    // probabilistic hop to a neighbor. One roll per full hour.
    let zone: WorldZone = n.zone;
    const hopRate = HOP_RATE_PER_HOUR[n.kind] ?? 0.02;
    const rolls = Math.floor(hoursAway);
    for (let i = 0; i < rolls; i++) {
      if (Math.random() > hopRate) continue;
      const candidates = (NEIGHBORS[zone] ?? []).filter((z) => KIND_ZONES[n.kind].includes(z));
      if (!candidates.length) continue;
      zone = candidates[Math.floor(Math.random() * candidates.length)];
      // when it hops it lands at the edge nearest its previous zone — that
      // is more evocative than teleporting to a random spot.
      nx = Math.random() < 0.5 ? 0.05 + Math.random() * 0.15 : 0.85 + Math.random() * 0.10;
    }

    return { ...n, nx, zone, lastSeen: nowMs };
  });
}

// Enforce caps: overall + per-zone. Oldest are removed first so recent
// activity survives.
function enforceCaps(list: WorldNatural[]): WorldNatural[] {
  if (list.length <= MAX_NATURALS && Object.keys(NEIGHBORS).every((z) =>
    list.filter((n) => n.zone === z).length <= MAX_PER_ZONE
  )) {
    return list;
  }
  const sorted = [...list].sort((a, b) => a.createdAt - b.createdAt);
  const perZone: Record<string, number> = {};
  const keep: WorldNatural[] = [];
  // walk newest-first so we keep the recent stuff
  for (let i = sorted.length - 1; i >= 0; i--) {
    const n = sorted[i];
    perZone[n.zone] = (perZone[n.zone] || 0) + 1;
    if (perZone[n.zone] > MAX_PER_ZONE) continue;
    if (keep.length >= MAX_NATURALS) continue;
    keep.push(n);
  }
  return keep.reverse();
}

let cache: WorldNatural[] | null = null;
const listeners = new Set<() => void>();

function persist(list: WorldNatural[]) {
  const store = safe();
  if (!store) return;
  const nowMs = Date.now();
  for (const n of list) n.lastSeen = nowMs;
  try {
    store.setItem(KEY, JSON.stringify(list));
  } catch {
    /* quota; skip */
  }
}

function load(): WorldNatural[] {
  const store = safe();
  if (!store) return [];
  const raw = store.getItem(KEY);
  let list: WorldNatural[] = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        list = parsed.map(validate).filter((n): n is WorldNatural => n != null);
      }
    } catch { /* skip */ }
  }
  // Fold in anything that's still under the old keys.
  const legacy = migrateLegacy(store);
  if (legacy.length) {
    const known = new Set(list.map((n) => n.id));
    for (const n of legacy) if (!known.has(n.id)) list.push(n);
    persist(list);
  }
  list = applyElapsed(list);
  list = enforceCaps(list);
  persist(list);
  return list;
}

function notify() {
  for (const l of listeners) {
    try { l(); } catch { /* skip */ }
  }
}

/** All naturals across every zone. Loads + migrates on first call. */
export function getAllNaturals(): WorldNatural[] {
  if (cache == null) cache = load();
  return cache;
}

/** Naturals currently at a given page. */
export function getNaturalsInZone(zone: WorldZone): WorldNatural[] {
  return getAllNaturals().filter((n) => n.zone === zone);
}

/** Add a new natural. Kind must belong in the zone. */
export function addNatural(
  kind: WorldKind,
  zone: WorldZone,
  nx: number,
  ny: number,
  vx = 0,
): WorldNatural | null {
  if (!KIND_ZONES[kind]?.includes(zone)) return null;
  const nowMs = Date.now();
  const n: WorldNatural = {
    id: `wn-${nowMs}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    zone,
    nx: Math.max(0, Math.min(1, nx)),
    ny: Math.max(0, Math.min(1, ny)),
    vx,
    seed: Math.floor(Math.random() * 0xffffffff),
    createdAt: nowMs,
    lastSeen: nowMs,
  };
  const list = [...getAllNaturals(), n];
  cache = enforceCaps(list);
  persist(cache);
  notify();
  return n;
}

/**
 * Take one natural back out of the world — the per-object delete every room
 * owes its material. Returns false when nothing carried that id, so a room
 * can tell "gone" from "was never there" instead of guessing.
 */
export function removeNatural(id: string): boolean {
  const list = getAllNaturals();
  const next = list.filter((n) => n.id !== id);
  if (next.length === list.length) return false;
  cache = next;
  persist(cache);
  notify();
  return true;
}

/** Replace the cached list — used when a page has mutated positions per-frame
 *  and wants to write them back. Costs one JSON.stringify + write. */
export function commitNaturals(list: WorldNatural[]) {
  cache = enforceCaps(list);
  persist(cache);
}

/** Replace naturals for a single zone without touching other zones' data.
 *  This is what pages should call after mutating positions in their RAF —
 *  each page only knows its own zone, so a full replace would clobber the
 *  others. */
export function commitZone(zone: WorldZone, list: WorldNatural[]) {
  const others = getAllNaturals().filter((n) => n.zone !== zone);
  const own = list.filter((n) => n.zone === zone);
  cache = enforceCaps([...others, ...own]);
  persist(cache);
}

/** Subscribe to any change (add/remove/commit). Returns an unsubscribe fn. */
export function subscribeNaturals(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export const WORLD_LIMITS = { MAX_NATURALS, MAX_PER_ZONE } as const;

// ——— the world clock ————————————————————————————————————————————
//
// Some rooms advance on real elapsed time whether or not anyone watches —
// the solar system keeps orbiting between visits the way a shell keeps
// drifting between zones. Those rooms read this once at mount: it reports
// when the room was first founded (its epoch) and how long the world ran
// unwatched since the last visit, then stamps the new visit. The room owes
// the rest: fold `elapsedMs` into its state in closed form (O(1) — never a
// loop replaying the absence), and touch the wall clock nowhere else.

export type WorldClockReading = {
  /** When this key first joined the world, ms since epoch. */
  epochMs: number;
  /** Previous visit's stamp, ms since epoch (equals epochMs on first read). */
  lastSeenMs: number;
  /** The read itself, ms since epoch. */
  nowMs: number;
  /** nowMs − lastSeenMs, clamped non-negative — the unwatched span. */
  elapsedMs: number;
};

const CLOCK_KEY = "objetdart:world:clock:v1";

type ClockEntry = { epochMs: number; lastSeenMs: number };

function loadClocks(store: Storage): Record<string, ClockEntry> {
  try {
    const raw = store.getItem(CLOCK_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, ClockEntry> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const e = v as Record<string, unknown>;
      if (typeof e.epochMs !== "number" || typeof e.lastSeenMs !== "number") continue;
      out[k] = { epochMs: e.epochMs, lastSeenMs: e.lastSeenMs };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Read the persistent clock for `key`, stamping this visit. One call per
 * mount; the returned `elapsedMs` is the whole absence, ready for a single
 * closed-form advance. SSR-safe: without storage, a zero-elapsed reading.
 */
export function readWorldClock(key: string): WorldClockReading {
  const nowMs = Date.now();
  const store = safe();
  if (!store) return { epochMs: nowMs, lastSeenMs: nowMs, nowMs, elapsedMs: 0 };
  const clocks = loadClocks(store);
  const entry = clocks[key] ?? { epochMs: nowMs, lastSeenMs: nowMs };
  const reading: WorldClockReading = {
    epochMs: entry.epochMs,
    lastSeenMs: entry.lastSeenMs,
    nowMs,
    elapsedMs: Math.max(0, nowMs - entry.lastSeenMs),
  };
  clocks[key] = { epochMs: entry.epochMs, lastSeenMs: nowMs };
  try {
    store.setItem(CLOCK_KEY, JSON.stringify(clocks));
  } catch {
    /* quota; the reading still stands */
  }
  return reading;
}

/**
 * Re-stamp `key` without reading (e.g. on pagehide, so the next absence is
 * measured from the leaving, not the arriving).
 */
export function stampWorldClock(key: string): void {
  const store = safe();
  if (!store) return;
  const clocks = loadClocks(store);
  const nowMs = Date.now();
  const entry = clocks[key] ?? { epochMs: nowMs, lastSeenMs: nowMs };
  clocks[key] = { epochMs: entry.epochMs, lastSeenMs: nowMs };
  try {
    store.setItem(CLOCK_KEY, JSON.stringify(clocks));
  } catch {
    /* noop */
  }
}
