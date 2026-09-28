// The world model over store + twin. Every operation returns
// {ok:true,value} or {ok:false,error}; nothing throws to the caller.

import { CAPS, dict, has } from "@/lib/universe-mcp/store";
import type { Inhabitant, Instance, Store } from "@/lib/universe-mcp/store";
import { LAYER_HOME, applyVerb, fnv1a, freshRoom, neighborsOf, resolveStep, roomOf, sensesFor, roomForRoute, nearKeys } from "@/lib/universe-mcp/twin";
import { registerOf } from "@/lib/room-registry";
import { spectralRegisterFor } from "@/lib/scale";

export type Res<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Res<T> => ({ ok: true, value });
const fail = (error: string): Res<never> => ({ ok: false, error });

export const LAYERS = ["mind", "body", "connectome", "tissue", "field", "pattern", "visitor"] as const;
export const CODE_RE = /^[a-z0-9]{8,16}$/;
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function worldCode(from: string, layer: string, unit: string): string {
  const key = `${from}|${layer}|${unit}`;
  return "w" + [0x811c9dc5, 0x9e3779b1].map((sd) => fnv1a(key, sd).toString(36).padStart(7, "0")).join("").slice(0, 13);
}

const clean = (s: unknown, max: number): string =>
  String(s ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

function getInstance(store: Store, code: unknown, now: number): Instance | null {
  if (typeof code !== "string" || !CODE_RE.test(code)) return null;
  const d = store.get();
  if (!has(d.instances, code)) return null;
  const i = d.instances[code];
  i.seen = now;
  // a persisted room can outlive its registry entry (the world rewrites its own code): come home rather than throw
  if (!roomOf(i.room)) i.room = has(LAYER_HOME, i.layer) ? LAYER_HOME[i.layer] : "manifold";
  return i;
}
const NO_INSTANCE = "No such world. Call universe_open first; codes are 8 to 16 lowercase letters and digits.";

const roomState = (i: Instance, key: string) => (has(i.rooms, key) ? i.rooms[key] : (i.rooms[key] = freshRoom()));

function publicOf(h: Inhabitant) {
  return { id: h.id, species: h.species, stage: h.stage, room: h.room, instance: h.instance, size: h.cells.length, lineage: h.lineage.slice(-8) };
}

function inRoom(store: Store, key: string): Inhabitant[] {
  const all = store.get().commons.inhabitants;
  return Object.keys(all).map((k) => all[k]).filter((h) => h.room === key).sort((a, b) => a.since - b.since || (a.id < b.id ? -1 : 1));
}

export function open(store: Store, args: { instance?: unknown; from?: unknown; layer?: unknown; unit?: unknown }, now: number): Res<{ instance: string; layer: string; room: string; created: boolean; mcp: string }> {
  const layerArg = args.layer === undefined ? undefined : String(args.layer);
  if (layerArg !== undefined && !(LAYERS as readonly string[]).includes(layerArg)) return fail(`Unknown layer "${clean(layerArg, 30)}". The layers are ${LAYERS.join(", ")}.`);
  let code: string;
  if (args.instance !== undefined && args.instance !== null && args.instance !== "") {
    if (typeof args.instance !== "string" || !CODE_RE.test(args.instance)) return fail("An instance code is 8 to 16 lowercase letters and digits.");
    code = args.instance;
  } else {
    const from = args.from === undefined ? "anon" : clean(args.from, 64);
    const unit = args.unit === undefined ? "0" : clean(args.unit, 64);
    code = worldCode(from || "anon", layerArg ?? "visitor", unit);
  }
  const created = store.mutate((d) => {
    if (has(d.instances, code)) { d.instances[code].seen = now; return false; }
    const layer = layerArg ?? "visitor";
    const room = LAYER_HOME[layer];
    const i: Instance = { code, layer, seed: fnv1a(code, 0x811c9dc5), room, created: now, seen: now, visits: dict<number>(), path: [{ room, how: "arrival", at: now }], rooms: dict(), verbs: 0, animal: null };
    i.visits[room] = 1;
    d.instances[code] = i;
    return true;
  });
  const i = store.get().instances[code];
  return ok({ instance: code, layer: i.layer, room: i.room, created, mcp: `/mcp/i/${code}` });
}

function hereOf(store: Store, i: Instance) {
  const e = roomOf(i.room)!;
  const st = roomState(i, i.room);
  const pop = inRoom(store, i.room);
  return { e, st, pop };
}

export function look(store: Store, args: { instance?: unknown }, now: number): Res<Record<string, unknown>> {
  return store.mutate(() => {
    const i = getInstance(store, args.instance, now);
    if (!i) return fail(NO_INSTANCE);
    const { e, st, pop } = hereOf(store, i);
    const reg = registerOf(e) ?? spectralRegisterFor(0);
    const phase = Math.round(((now / 1000) * reg.lfoHz % 1) * 1000) / 1000;
    const s = sensesFor(e, st, "The room", Math.min(1, st.objects.length / 8));
    return ok({
      instance: i.code, layer: i.layer, room: i.room, route: e.href, band: "band" in e.address ? e.address.band : null,
      creates: e.creates,
      population: { [e.creates ?? "things"]: st.objects.length, ripples: st.ripples },
      state: { lens: st.lens, frame: st.frame, law: st.law, material: st.material, bloom: st.bloom, night: st.night },
      inhabitants: pop.map(publicOf),
      memory: target(store, i, undefined)?.notes.slice(-8) ?? [],
      inhabitantsSense: pop.slice(0, 8).map((h) => ({ id: h.id, sense: s.sound })),
      senses: s,
      breath: { phase, everySeconds: Math.round((1 / reg.lfoHz) * 10) / 10 },
      recent: st.log.slice(-4),
      lastSteps: i.path.slice(-5),
      neighbors: neighborsOf(i.room),
    });
  });
}

export function step(store: Store, args: { instance?: unknown; to?: unknown }, now: number): Res<Record<string, unknown>> {
  return store.mutate(() => {
    const i = getInstance(store, args.instance, now);
    if (!i) return fail(NO_INSTANCE);
    const pick = resolveStep(i.room, String(args.to ?? ""), i.visits, i.seed, i.verbs);
    if (!pick.ok) return fail(pick.error);
    i.verbs += 1;
    i.room = pick.room;
    i.visits[pick.room] = (has(i.visits, pick.room) ? i.visits[pick.room] : 0) + 1;
    i.path.push({ room: pick.room, how: pick.how, at: now });
    if (i.path.length > CAPS.path) i.path.splice(0, i.path.length - CAPS.path);
    const { e, st, pop } = hereOf(store, i);
    return ok({ arrived: pick.room, route: e.href, by: pick.how, creates: e.creates, here: { [e.creates ?? "things"]: st.objects.length, inhabitants: pop.map(publicOf) }, visits: i.visits[pick.room], neighbors: neighborsOf(pick.room) });
  });
}

export function gesture(store: Store, args: Record<string, unknown>, now: number): Res<Record<string, unknown>> {
  return store.mutate(() => {
    const i = getInstance(store, args.instance, now);
    if (!i) return fail(NO_INSTANCE);
    const e = roomOf(i.room)!;
    const st = roomState(i, i.room);
    const r = applyVerb(e, st, i.seed, i.verbs, args);
    if (!r.ok) return fail(r.error);
    i.verbs += 1;
    return ok({ room: i.room, ...r } as Record<string, unknown>);
  });
}

/** One 4-connected polyomino, iteratively (a 400-cell line must not recurse). */
export function validateCells(cells: unknown): Res<[number, number][]> {
  if (!Array.isArray(cells) || cells.length === 0) return fail("An animal needs at least one cell: [[x,y], ...].");
  if (cells.length > CAPS.cells) return fail(`An animal has at most ${CAPS.cells} cells; this one has ${cells.length}.`);
  const out: [number, number][] = [];
  const seen = new Set<string>();
  for (const c of cells) {
    if (!Array.isArray(c) || c.length !== 2 || !Number.isInteger(c[0]) || !Number.isInteger(c[1])) return fail("Every cell is a pair of whole numbers.");
    if (Math.abs(c[0]) > 100000 || Math.abs(c[1]) > 100000) return fail("A cell coordinate is out of range.");
    const k = `${c[0]},${c[1]}`;
    if (seen.has(k)) return fail(`Cell ${k} is listed twice.`);
    seen.add(k);
    out.push([c[0], c[1]]);
  }
  const reached = new Set<string>([`${out[0][0]},${out[0][1]}`]);
  const stack: [number, number][] = [out[0]];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${x + dx},${y + dy}`;
      if (seen.has(k) && !reached.has(k)) { reached.add(k); stack.push([x + dx, y + dy]); }
    }
  }
  if (reached.size !== out.length) return fail("The cells are not one piece: each cell must touch another along an edge, not only at a corner.");
  return ok(out);
}

export function inhabit(store: Store, args: { instance?: unknown; animal?: unknown; room?: unknown }, now: number): Res<Record<string, unknown>> {
  return store.mutate(() => {
    const i = getInstance(store, args.instance, now);
    if (!i) return fail(NO_INSTANCE);
    const a = args.animal as Record<string, unknown> | null | undefined;
    if (!a || typeof a !== "object") return fail("Give an animal: {id, species, cells}.");
    if (typeof a.id !== "string" || !ID_RE.test(a.id)) return fail("An animal id is 1 to 64 letters, digits, underscores or hyphens.");
    const cells = validateCells(a.cells);
    if (!cells.ok) return fail(cells.error);
    let key = i.room;
    if (args.room !== undefined && args.room !== null && args.room !== "") {
      const r = roomOf(String(args.room).toLowerCase()) ?? (String(args.room).startsWith("/") ? roomForRoute(String(args.room)) : null);
      if (!r) return fail(`No room answers to "${clean(args.room, 60)}". Near: ${nearKeys(String(args.room)).join(", ")}.`);
      key = r.key;
    }
    const inh = store.get().commons.inhabitants;
    const prev = has(inh, a.id) ? inh[a.id] : null;
    const lineage = prev ? prev.lineage.slice() : [];
    const push = (s: string) => { if (s && lineage[lineage.length - 1] !== s) lineage.push(s); };
    if (typeof a.from === "string" && a.from) push(clean(a.from, 64));
    if (!prev || prev.instance !== i.code) push(`@${i.code}`);
    const h: Inhabitant = {
      id: a.id, species: clean(a.species ?? prev?.species ?? "unknown", 40) || "unknown", stage: clean(a.stage ?? prev?.stage ?? "", 40),
      cells: cells.value, room: key, instance: i.code, lineage, notes: prev ? prev.notes : [], since: prev ? prev.since : now, at: now,
    };
    inh[a.id] = h;
    i.animal = a.id;
    return ok({ inhabitant: publicOf(h), remembered: h.notes.length, resumed: !!prev });
  });
}

function target(store: Store, i: Instance, animal: unknown): Inhabitant | null {
  const id = typeof animal === "string" && animal ? animal : i.animal;
  const inh = store.get().commons.inhabitants;
  return id && has(inh, id) ? inh[id] : null;
}

export function remember(store: Store, args: { instance?: unknown; note?: unknown; animal?: unknown }, now: number): Res<Record<string, unknown>> {
  return store.mutate(() => {
    const i = getInstance(store, args.instance, now);
    if (!i) return fail(NO_INSTANCE);
    const raw = String(args.note ?? "");
    const note = raw.replace(/[\t\r\n]/g, " ").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
    if (!note) return fail("A note needs some text.");
    if (note.length > 280) return fail(`A note is at most 280 characters; this one is ${note.length}.`);
    const h = target(store, i, args.animal);
    if (!h) return fail("No inhabitant to remember for. Call universe_inhabit first, or name the animal.");
    h.notes.push(note);
    if (h.notes.length > CAPS.notes) h.notes.splice(0, h.notes.length - CAPS.notes);
    h.at = now;
    return ok({ id: h.id, notes: h.notes.length });
  });
}

export function leave(store: Store, args: { instance?: unknown; animal?: unknown }, now: number): Res<Record<string, unknown>> {
  return store.mutate(() => {
    const i = getInstance(store, args.instance, now);
    if (!i) return fail(NO_INSTANCE);
    const h = target(store, i, args.animal);
    if (!h) return fail("No such inhabitant here.");
    delete store.get().commons.inhabitants[h.id];
    if (i.animal === h.id) i.animal = null;
    return ok({ left: h.id, room: h.room });
  });
}

export function inhabitants(store: Store, args: { room?: unknown }): Res<Record<string, unknown>> {
  const all = store.get().commons.inhabitants;
  let list = Object.keys(all).map((k) => all[k]);
  if (args.room !== undefined && args.room !== null && args.room !== "") {
    const r = roomOf(String(args.room).toLowerCase()) ?? (String(args.room).startsWith("/") ? roomForRoute(String(args.room)) : null);
    if (!r) return fail(`No room answers to "${clean(args.room, 60)}". Near: ${nearKeys(String(args.room)).join(", ")}.`);
    list = list.filter((h) => h.room === r.key);
  }
  list.sort((a, b) => (a.room < b.room ? -1 : a.room > b.room ? 1 : a.since - b.since || (a.id < b.id ? -1 : 1)));
  return ok({ count: list.length, inhabitants: list.slice(0, 200).map(publicOf) });
}
