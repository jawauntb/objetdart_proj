// Universe MCP — the pure data assembly behind the explore tools. Nothing here
// touches fs, fetch or a clock: it reads the registries and returns plain data.
import { ROOM_REGISTRY, ROOM_BY_KEY, GLOBAL_BINDINGS, bandOf, registerOf, requiredBindings, exemptionFor } from "@/lib/room-registry";
import type { RoomEntry } from "@/lib/room-registry";
import { SITE_ROUTES } from "@/lib/routes";
import { SCALE_BANDS, travelOptionsForRoute, scaleBandIdForRoute } from "@/lib/scale";
import { PASSAGES } from "@/lib/travel-passage";
import { peersOf } from "@/lib/peers";
import { GUIDE_ROOM_BY_KEY } from "@/data/guide";

const CLUSTER_BY_KEY: Record<string, string> = Object.fromEntries(SITE_ROUTES.map((r) => [r.key, String(r.cluster)]));

export const MAP_CAP_BYTES = 14000;

const bare = (route: string) => (route.split("?")[0] || route).replace(/\/+$/, "") || "/";

/** A key, "/route" or "route" -> the room, or null. */
export function resolveRoom(input: unknown): { key: string; route: string } | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const hit = (e: RoomEntry) => ({ key: e.key, route: e.href });
  if (ROOM_BY_KEY[lower]) return hit(ROOM_BY_KEY[lower]);
  const path = bare(lower.startsWith("/") ? lower : `/${lower}`);
  if (path === "/") return null;
  let best: RoomEntry | null = null;
  let bestScore = -1;
  for (const e of ROOM_REGISTRY) {
    const h = bare(e.href);
    let score = -1;
    if (path === h) score = 1000;
    else if (path.startsWith(`${h}/`)) score = 500 + h.length; // a sub-page of a room
    else if (h.startsWith(`${path}/`)) score = 100 - h.length; // the room's stem, e.g. /atlas
    if (score > bestScore) { best = e; bestScore = score; }
  }
  return best ? hit(best) : null;
}

/** Neighbor room keys: in, out along the axis, then lateral peers. Deduped, never itself. */
export function doorsOf(key: string): string[] {
  const e = ROOM_BY_KEY[key];
  if (!e) return [];
  const d = doorsBy(e);
  return [...d.in, ...d.out, ...d.lateral].map((x) => x.key).filter(uniq(key));
}

function uniq(self: string) {
  const seen = new Set<string>([self]);
  return (k: string) => (seen.has(k) ? false : (seen.add(k), true));
}

export type Door = { key: string; route: string; film: string | null };

function doorsBy(e: RoomEntry): { in: Door[]; out: Door[]; lateral: Door[] } {
  const from = scaleBandIdForRoute(e.href);
  const dirDoors = (dir: -1 | 1): Door[] => {
    const seen = new Set<string>([e.key]);
    const out: Door[] = [];
    for (const d of travelOptionsForRoute(e.href, dir, {})) {
      const r = resolveRoom(d.route);
      if (!r || seen.has(r.key)) continue;
      seen.add(r.key);
      const film = from ? PASSAGES[`${from}->${d.band.id}` as keyof typeof PASSAGES]?.film ?? null : null;
      out.push({ key: r.key, route: r.route, film });
    }
    return out;
  };
  const lateral: Door[] = [];
  for (const p of peersOf(e.href)) {
    const r = resolveRoom(p.href);
    if (r && r.key !== e.key && !lateral.some((l) => l.key === r.key)) lateral.push({ key: r.key, route: r.route, film: null });
  }
  return { in: dirDoors(-1), out: dirDoors(1), lateral };
}

export function travelDoors(key: string) {
  const e = ROOM_BY_KEY[key];
  return e ? doorsBy(e) : { in: [], out: [], lateral: [] };
}

const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, Math.max(0, n - 1)).trimEnd()}…`);

function registerText(e: RoomEntry): string {
  const r = registerOf(e);
  return r ? `${r.baseHz.toFixed(1)}Hz/${r.lfoHz.toFixed(3)}Hz` : "none";
}

export function bandsInOrder() {
  return SCALE_BANDS.map((b) => ({ id: b.id, label: b.label, route: b.route, sMin: b.sMin, sMax: b.sMax }));
}

/**
 * The whole app, one line per room. `interacts` starts at 160 characters and
 * shrinks only as far as needed to keep the text under the cap.
 */
export function buildMapText(cap = MAP_CAP_BYTES): string {
  const head = [
    "Objet d'art, every room, small to large. Line: key | route | band | register (base/breath) | cluster | creates | interacts | neighbors. Ask universe_room for one room in full.",
    "axis (log10 m): " + SCALE_BANDS.map((b) => `${b.id}${b.route ? "" : "*"}[${b.sMin},${b.sMax}]`).join(" ") + "  (* = address with no page yet)",
  ];
  const rows = ROOM_REGISTRY.map((e) => ({ e, nb: doorsOf(e.key).slice(0, 6).join(",") }));
  const render = (n: number) =>
    [
      ...head,
      ...rows.map(({ e, nb }) =>
        [e.key, e.href, bandOf(e) ?? `exempt`, registerText(e), CLUSTER_BY_KEY[e.key] ?? "", e.creates ?? "", clip(flat(e.interacts ?? ""), n), nb].join(" | "),
      ),
    ].join("\n");
  let n = 160; // neighbors cap at 6 here; universe_room lists them all
  let out = render(n);
  while (Buffer.byteLength(out, "utf8") > cap && n > 0) {
    n -= 10;
    out = render(n);
  }
  return out;
}

/** The five keys closest to a mistyped one. */
export function nearKeys(input: string, count = 5): string[] {
  const q = input.trim().toLowerCase().replace(/^\/+/, "");
  const lev = (a: string, b: string) => {
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  };
  return ROOM_REGISTRY.map((e) => {
    const k = e.key;
    const d = q && (k.includes(q) || q.includes(k)) ? 0 : lev(q, k);
    return { k, d };
  })
    .sort((a, b) => a.d - b.d || a.k.localeCompare(b.k))
    .slice(0, count)
    .map((x) => x.k);
}

export function roomDetail(key: string) {
  const e = ROOM_BY_KEY[key];
  const g = GUIDE_ROOM_BY_KEY[key];
  const band = bandOf(e);
  const b = band ? SCALE_BANDS.find((x) => x.id === band) : null;
  const required = new Set<string>(requiredBindings(e));
  return {
    key: e.key,
    route: e.href,
    kind: e.kind,
    disciplines: e.disciplines ?? [],
    address: e.address,
    frame: e.frame,
    chrome: e.chrome,
    keeps: e.keeps,
    creates: e.creates,
    interacts: e.interacts ?? null,
    guide: g
      ? { title: g.title, essence: g.essence, what: g.plain?.what ?? null, how: g.plain?.how ?? [], moves: g.moves, finds: g.finds, keeps: g.keeps ?? null }
      : null,
    gestures: {
      answers: GLOBAL_BINDINGS.filter((v) => required.has(v)),
      exempts: GLOBAL_BINDINGS.filter((v) => !required.has(v)).map((v) => ({ verb: v, reason: exemptionFor(e, v) })),
    },
    doors: travelDoors(key),
    axis: b ? { band: b.id, label: b.label, sMin: b.sMin, sMax: b.sMax, register: registerText(e) } : { exempt: "exempt" in e.address ? e.address.exempt : null },
  };
}

/** Rooms grouped by hop distance over in/out/lateral doors. */
export function roomsNear(key: string, hops: number): { hop: number; rooms: { key: string; route: string; creates: string | null }[] }[] {
  const seen = new Set<string>([key]);
  let frontier = [key];
  const groups: { hop: number; rooms: { key: string; route: string; creates: string | null }[] }[] = [];
  for (let h = 1; h <= hops; h++) {
    const next: string[] = [];
    for (const k of frontier) for (const n of doorsOf(k)) if (!seen.has(n)) { seen.add(n); next.push(n); }
    if (!next.length) break;
    groups.push({ hop: h, rooms: next.map((k) => ({ key: k, route: ROOM_BY_KEY[k].href, creates: ROOM_BY_KEY[k].creates })) });
    frontier = next;
  }
  return groups;
}
