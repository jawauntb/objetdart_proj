// The structural twin of a room: deterministic headless physics that follows
// the registry's facts (creates, interacts, exempt, address) and the gesture
// grammar, not pixels. Pure. No Math.random, no clock: every result is a
// function of (instance seed, room key, verb counter, verb arguments).

import { ROOM_BY_KEY, ROOM_REGISTRY, registerOf } from "@/lib/room-registry";
import type { RoomEntry } from "@/lib/room-registry";
import { THRESHOLDS, tapTrainTier } from "@/lib/gesture/core";
import { spectralRegisterFor, travelOptionsForRoute } from "@/lib/scale";
import { peersOf } from "@/lib/peers";
import { CAPS, dict } from "@/lib/universe-mcp/store";
import type { Dict, RoomState } from "@/lib/universe-mcp/store";

// ——— seeds ———

export const fnv1a = (s: string, seed: number): number => {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
};
export const hashOf = (...parts: (string | number)[]): number => fnv1a(parts.join("|"), 0x811c9dc5);

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A real mixing function: the child's seed is neither parent's. */
export function mixSeeds(a: number, b: number, salt: number): number {
  let m = fnv1a(`${a >>> 0}|${b >>> 0}|${salt}`, 0x9e3779b1);
  let n = 0;
  while ((m === a >>> 0 || m === b >>> 0) && n++ < 8) m = fnv1a(String(m), n);
  return m;
}

// ——— rooms ———

export function roomOf(key: string): RoomEntry | null {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(ROOM_BY_KEY, key) ? ROOM_BY_KEY[key] : null;
}

/**
 * Where each rung of the ladder begins. All seven exist in the registry;
 * `mind` opens in the cells (thought as a tissue of small units), `body` in
 * the tissue, `connectome` in the loom, `tissue` in the organics, `field` on
 * the manifold, `pattern` in the group, and a bare visitor on the manifold.
 */
export const LAYER_HOME: Dict<string> = Object.assign(dict<string>(), {
  mind: "cells", body: "tissue", connectome: "loom", tissue: "organics", field: "manifold", pattern: "group", visitor: "manifold",
});

const routeOf = (e: RoomEntry): string => e.href;

/** "/route?x" or "/route/sub" -> the room whose href is the longest prefix. */
export function roomForRoute(route: string): RoomEntry | null {
  const path = (route.split("?")[0] || route).replace(/\/+$/, "") || "/";
  let best: RoomEntry | null = null;
  for (const e of ROOM_REGISTRY) {
    if (path === e.href || path.startsWith(`${e.href}/`)) if (!best || e.href.length > best.href.length) best = e;
  }
  return best;
}

export function neighborsOf(key: string): string[] {
  const e = roomOf(key);
  if (!e) return [];
  const out: string[] = [];
  const add = (r: RoomEntry | null) => { if (r && r.key !== key && !out.includes(r.key)) out.push(r.key); };
  for (const dir of [-1, 1] as const) for (const d of travelOptionsForRoute(routeOf(e), dir, {})) add(roomForRoute(d.route));
  for (const p of peersOf(routeOf(e))) add(roomOf(p.key));
  // a room off the axis (an instrument, a reading) has no doors of its own; it opens onto the manifold
  if (out.length === 0 && key !== "manifold") out.push("manifold");
  return out;
}

export function nearKeys(q: string, n = 5): string[] {
  const s = String(q).toLowerCase().replace(/^\//, "").slice(0, 40);
  const score = (k: string) => {
    let c = 0;
    while (c < s.length && c < k.length && s[c] === k[c]) c++;
    return c * 2 + (k.includes(s) || s.includes(k) ? 3 : 0) - Math.abs(k.length - s.length) * 0.1;
  };
  return ROOM_REGISTRY.map((e) => e.key).sort((a, b) => score(b) - score(a) || (a < b ? -1 : 1)).slice(0, n);
}

export type StepPick = { ok: true; room: string; how: string } | { ok: false; error: string };

/** to = room key | "/route" | "in" | "out" | "wander". */
export function resolveStep(
  from: string,
  to: string,
  visits: Dict<number>,
  instSeed: number,
  verbs: number,
): StepPick {
  const t = String(to ?? "").trim();
  if (!t) return { ok: false, error: "Say where to: a room key, a route, in, out, or wander." };
  const here = roomOf(from);
  if (t === "in" || t === "out") {
    const dir = t === "in" ? -1 : 1;
    const doors = here ? travelOptionsForRoute(routeOf(here), dir, {}) : [];
    const d = doors.map((x) => ({ x, r: roomForRoute(x.route) })).find((y) => y.r && y.r.key !== from);
    if (!d || !d.r) {
      const near = neighborsOf(from);
      return { ok: false, error: `There is no door ${t} from ${from}. Rooms next to it: ${near.join(", ") || "none"}.` };
    }
    return { ok: true, room: d.r.key, how: `door ${t}: ${d.x.label}` };
  }
  if (t === "wander") {
    const ns = neighborsOf(from);
    if (ns.length === 0) return { ok: false, error: `${from} has no neighbors to wander to.` };
    const seen = (k: string) => (Object.prototype.hasOwnProperty.call(visits, k) ? visits[k] : 0);
    const least = Math.min(...ns.map(seen));
    const cands = ns.filter((k) => seen(k) === least);
    cands.sort((a, b) => hashOf(instSeed, a, verbs) - hashOf(instSeed, b, verbs) || (a < b ? -1 : 1));
    return { ok: true, room: cands[0], how: "wander" };
  }
  const byKey = roomOf(t.toLowerCase());
  const byRoute = t.startsWith("/") ? roomForRoute(t) : null;
  const hit = byRoute ?? byKey;
  if (!hit) return { ok: false, error: `No room answers to "${t.slice(0, 60)}". Near: ${nearKeys(t).join(", ")}.` };
  return { ok: true, room: hit.key, how: neighborsOf(from).includes(hit.key) ? "door" : "jump" };
}

// ——— room state ———

export function freshRoom(): RoomState {
  return { objects: [], next: 1, ripples: 0, lens: 0, frame: 1, law: 0, material: 0, night: false, wind: [0, 0], gravity: [0, 0], bloom: 0, retired: 0, log: [] };
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;
const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

// ——— senses ———

export type Senses = { sight: string; sound: string; haptic: string };

export function sensesFor(entry: RoomEntry, room: RoomState, subject: string, weight: number): Senses {
  const reg = registerOf(entry) ?? spectralRegisterFor(0);
  const w = clamp(weight, 0, 1);
  const strength = w > 0.66 ? "full" : w > 0.33 ? "clear" : "faint";
  const grain = reg.brightness > 0.66 ? "fine quick points" : reg.brightness > 0.33 ? "steady shapes" : "slow broad masses";
  const hz = Math.round(reg.baseHz * (1 + w));
  const every = Math.max(0.1, Math.round((10 / reg.lfoHz)) / 10);
  const noun = entry.creates ?? "material";
  return {
    sight: `${subject} shows as ${grain} in ${entry.key}; ${room.objects.length} ${noun} stand${room.objects.length === 1 ? "s" : ""} here.`,
    sound: `${subject} sounds as a ${strength} tone near ${hz} hertz${reg.brightness > 0.5 ? ", with bright upper partials" : ", dark and without shimmer"}.`,
    haptic: `${subject} lands as a ${strength} pulse that comes round about every ${every} seconds.`,
  };
}

// ——— verbs ———

export const VERBS = ["tap", "hold", "drag", "pinch", "twist", "chord", "tilt", "shake", "knock", "flip", "dwell", "ceremony"] as const;
export type Verb = (typeof VERBS)[number];

const VERB_BINDING: Partial<Record<Verb, string>> = { tilt: "tilt", shake: "shake", knock: "knock", flip: "flip", dwell: "dwell", ceremony: "ceremony", twist: "lens" };

export type GestureResult =
  | { ok: true; verb: Verb; kind: string; tier?: number | string; depth?: number; events: string[]; senses: Senses; room: Dict<number | boolean | string> }
  | { ok: false; error: string };

function plant(room: RoomState, rng: () => number, x?: number, y?: number): void {
  const o = { id: room.next++, seed: (rng() * 4294967296) >>> 0, x: r4(x ?? rng()), y: r4(y ?? rng()), size: r4(0.5 + rng() * 0.5) };
  room.objects.push(o);
  if (room.objects.length > CAPS.objects) room.objects.shift();
}

function nearestTo(room: RoomState, x: number, y: number): number {
  let bi = -1, bd = Infinity;
  room.objects.forEach((o, i) => { const d = (o.x - x) ** 2 + (o.y - y) ** 2; if (d < bd) { bd = d; bi = i; } });
  return bi;
}

function nearestPair(room: RoomState): [number, number] | null {
  const os = room.objects;
  let best: [number, number] | null = null, bd = Infinity;
  for (let i = 0; i < os.length; i++) for (let j = i + 1; j < os.length; j++) {
    const d = (os[i].x - os[j].x) ** 2 + (os[i].y - os[j].y) ** 2;
    if (d < bd) { bd = d; best = [i, j]; }
  }
  return best;
}

const firstSentence = (s: string, n = 220) => (s.length <= n ? s : `${s.slice(0, n).replace(/\s+\S*$/, "")}...`);

export function applyVerb(entry: RoomEntry, room: RoomState, instSeed: number, counter: number, args: Record<string, unknown>): GestureResult {
  const verb = String(args.verb ?? "") as Verb;
  if (!(VERBS as readonly string[]).includes(verb)) return { ok: false, error: `Unknown verb "${String(args.verb).slice(0, 30)}". The verbs are ${VERBS.join(", ")}.` };
  const rng = mulberry32(hashOf(instSeed, entry.key, counter));
  const noun = entry.creates;
  const events: string[] = [];
  let kind = verb as string;
  let tier: number | string | undefined;
  let depth: number | undefined;
  let weight = 0.4;
  let subject = `The ${verb}`;

  const exemptBinding = VERB_BINDING[verb];
  const reason = exemptBinding ? entry.exempt[exemptBinding as keyof RoomEntry["exempt"]] : undefined;
  if (reason) {
    events.push(`${entry.key} does not answer ${verb}: ${reason}`);
    kind = "exempt";
    room.ripples += 1;
  } else if (verb === "tap") {
    const count = Math.round(clamp(num(args.count, 1), 1, 99));
    tier = tapTrainTier(count);
    subject = `The ${count}-tap train`;
    if (tier === 1) {
      kind = "touch";
      room.ripples += 1;
      events.push("a ripple crosses the room");
      weight = 0.2;
    } else if (tier === 3) {
      kind = "create";
      weight = 0.5;
      if (noun) { plant(room, rng); events.push(`one ${noun} appears`); }
      else { room.ripples += 1; events.push("the room answers softly; there is nothing here to count"); kind = "soft"; }
    } else if (tier === 5) {
      weight = 0.75;
      const pair = noun ? nearestPair(room) : null;
      if (pair) {
        const [i, j] = pair;
        const a = room.objects[i], b = room.objects[j];
        const seed = mixSeeds(a.seed, b.seed, counter);
        const size = r4(Math.min(4, a.size + b.size));
        const child = { id: room.next++, seed, x: r4((a.x * a.size + b.x * b.size) / (a.size + b.size)), y: r4((a.y * a.size + b.y * b.size) / (a.size + b.size)), size };
        room.objects = room.objects.filter((_, k) => k !== i && k !== j);
        room.objects.push(child);
        kind = "merge";
        events.push(`two ${noun} meet and become a third that is neither: ${firstSentence(entry.interacts ?? "they act on each other")}`);
      } else {
        kind = "unmet";
        room.ripples += 1;
        events.push(noun ? `there are not two ${noun} here to meet` : "the room answers softly; there is nothing here to meet");
      }
    } else {
      kind = "bloom";
      weight = 1;
      room.bloom = r4(Math.max(room.bloom, Math.min(count, 24) / 24));
      room.ripples += Math.min(count, 24);
      events.push(`a bloom opens, ${r4(Math.min(count, 24) / 24)} of the way to the room's edge`);
    }
  } else if (verb === "hold" || verb === "dwell" || verb === "ceremony") {
    const ms = verb === "dwell" ? THRESHOLDS.dwellMs : verb === "ceremony" ? THRESHOLDS.ceremonyMs : clamp(num(args.ms, 0), 0, 600000);
    depth = r4(1 - Math.exp(-ms / 1400));
    weight = depth;
    subject = `The hold of ${Math.round(ms)} milliseconds`;
    tier = ms >= THRESHOLDS.ceremonyMs ? 3 : ms >= THRESHOLDS.dwellMs ? 2 : ms >= THRESHOLDS.tapMaxMs ? 1 : 0;
    const hx = clamp(num(args.x, 0.5), 0, 1), hy = clamp(num(args.y, 0.5), 0, 1);
    const dwellExempt = entry.exempt.dwell, cerExempt = entry.exempt.ceremony;
    if (tier === 3) {
      if (cerExempt) { kind = "exempt"; events.push(`${entry.key} has no solemn act: ${cerExempt}`); }
      else if (room.objects.length) { const g = room.objects.shift()!; room.retired += 1; kind = "let go"; events.push(`let go: the oldest ${noun ?? "thing"} (${g.id}) is released`); }
      else { kind = "let go"; events.push("let go: there was nothing left to release"); }
    } else if (tier === 2) {
      if (dwellExempt || !noun) { kind = "soft"; events.push(dwellExempt ? `${entry.key} does not grow from a hold: ${dwellExempt}` : "the room settles; nothing here is countable"); }
      else if (!room.objects.length) { plant(room, rng, hx, hy); kind = "plant"; events.push(`a ${noun} is planted where the hand rests`); }
      else { const i = nearestTo(room, hx, hy); room.objects[i].size = r4(Math.min(4, room.objects[i].size * (1 + depth * 0.5))); kind = "grow"; events.push(`the nearest ${noun} (${room.objects[i].id}) grows`); }
    } else {
      kind = "touch";
      room.ripples += 1;
      events.push("the hand rests; the room begins to lean toward it");
    }
  } else if (verb === "drag") {
    const dx = clamp(num(args.dx, 0), -1000, 1000), dy = clamp(num(args.dy, 0), -1000, 1000);
    room.wind = [r4(clamp(room.wind[0] + dx / 100, -10, 10)), r4(clamp(room.wind[1] + dy / 100, -10, 10))];
    for (const o of room.objects) { o.x = r4(clamp(o.x + dx / 1000, 0, 1)); o.y = r4(clamp(o.y + dy / 1000, 0, 1)); }
    events.push(`the material is carried by ${r4(Math.hypot(dx, dy))} units`);
    weight = 0.35;
  } else if (verb === "pinch") {
    const s = clamp(num(args.scale, 1), 0.1, 10);
    room.frame = r4(clamp(room.frame * s, 0.01, 1000));
    events.push(s === 1 ? "the frame holds" : s > 1 ? `the frame opens to ${room.frame}` : `the frame closes to ${room.frame}`);
    kind = "frame";
    weight = 0.45;
  } else if (verb === "twist") {
    room.lens = r4(((room.lens + clamp(num(args.angle, 0), -25, 25)) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2));
    events.push(`the lens turns to ${room.lens} radians`);
    kind = "lens";
    weight = 0.45;
  } else if (verb === "chord") {
    const f = Math.round(num(args.fingers, 0));
    if (f < 1 || f > 3) return { ok: false, error: "A chord addresses the stack with 1, 2 or 3 fingers: material, representation, world-law." };
    const step = r4(0.25 + rng() * 0.5);
    if (f === 1) { room.material = r4(room.material + step); events.push(`the material shifts by ${step}`); kind = "material"; }
    else if (f === 2) { room.frame = r4(room.frame + step); room.lens = r4((room.lens + step) % (Math.PI * 2)); events.push(`the representation changes; the frame is ${room.frame}`); kind = "frame"; }
    else { room.law = r4(room.law + step); events.push(`the law changes by ${step}; it stands at ${room.law}`); kind = "world-law"; }
    tier = f;
    weight = 0.3 + f * 0.2;
    subject = `The ${f}-finger chord`;
  } else if (verb === "tilt") {
    const gx = clamp(num(args.dx, num(args.x, 0)), -1, 1), gy = clamp(num(args.dy, num(args.y, 0)), -1, 1);
    room.gravity = [r4(gx), r4(gy)];
    for (const o of room.objects) { o.x = r4(clamp(o.x + gx * 0.1, 0, 1)); o.y = r4(clamp(o.y + gy * 0.1, 0, 1)); }
    events.push("everything leans with the case");
  } else if (verb === "shake") {
    for (const o of room.objects) { o.x = r4(rng()); o.y = r4(rng()); }
    events.push(room.objects.length ? `${room.objects.length} ${noun ?? "things"} are scattered` : "the room shudders and settles");
    weight = 0.8;
  } else if (verb === "knock") {
    room.ripples += 1;
    events.push("the case is rapped and the room answers once");
    weight = 0.5;
  } else if (verb === "flip") {
    room.night = !room.night;
    events.push(room.night ? "face down is night" : "face up is day");
    weight = 0.3;
  }

  room.log.push(`${verb}: ${events[0] ?? kind}`);
  if (room.log.length > 6) room.log.splice(0, room.log.length - 6);
  const s = sensesFor(entry, room, subject, weight);
  const summary = { objects: room.objects.length, ripples: room.ripples, lens: room.lens, frame: room.frame, law: room.law, material: room.material, bloom: room.bloom, night: room.night } as Dict<number | boolean | string>;
  const out: GestureResult = { ok: true, verb, kind, events, senses: s, room: summary };
  if (tier !== undefined) out.tier = tier;
  if (depth !== undefined) out.depth = depth;
  return out;
}
