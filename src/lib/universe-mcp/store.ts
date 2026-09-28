// Universe store — pure persistence. The whole universe is one small JSON
// document; io and the timer are injected so this file never touches fs.
// Maps are null-prototype objects and keys are validated, so "__proto__" or
// "constructor" as a code, room or animal id is only ever data.

export type Dict<T> = Record<string, T>;

export type Obj = { id: number; seed: number; x: number; y: number; size: number };

export type RoomState = {
  objects: Obj[];
  next: number;
  ripples: number;
  lens: number;
  frame: number;
  law: number;
  material: number;
  night: boolean;
  wind: [number, number];
  gravity: [number, number];
  bloom: number;
  retired: number;
  log: string[];
};

export type PathEntry = { room: string; how: string; at: number };

export type Instance = {
  code: string;
  layer: string;
  seed: number;
  room: string;
  created: number;
  seen: number;
  visits: Dict<number>;
  path: PathEntry[];
  rooms: Dict<RoomState>;
  verbs: number;
  animal: string | null;
};

export type Inhabitant = {
  id: string;
  species: string;
  stage: string;
  cells: [number, number][];
  room: string;
  instance: string;
  lineage: string[];
  notes: string[];
  since: number;
  at: number;
};

export type UniverseData = {
  v: 1;
  instances: Dict<Instance>;
  commons: { inhabitants: Dict<Inhabitant> };
};

export const CAPS = {
  instances: 5000,
  perRoom: 64,
  cells: 400,
  notes: 40,
  path: 40,
  objects: 64,
  lineage: 40,
  inhabitants: 20000,
} as const;

export type StoreIo = { read(): string | null; write(s: string): void };

export type Store = {
  get(): UniverseData;
  mutate<T>(fn: (d: UniverseData) => T): T;
  flush(): void;
};

export type StoreOpts = {
  io: StoreIo;
  now: () => number;
  debounceMs?: number;
  schedule?: (fn: () => void, ms: number) => void;
};

export const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
export const dict = <T>(): Dict<T> => Object.create(null) as Dict<T>;

/** Rebuild parsed JSON so every plain object is null-prototype. */
function nullify(v: unknown, depth = 0): unknown {
  if (Array.isArray(v)) return v.map((x) => nullify(x, depth + 1));
  if (v && typeof v === "object" && depth < 12) {
    const o = dict<unknown>();
    for (const k of Object.keys(v as object)) o[k] = nullify((v as Record<string, unknown>)[k], depth + 1);
    return o;
  }
  return v;
}

export function emptyData(): UniverseData {
  return { v: 1, instances: dict<Instance>(), commons: { inhabitants: dict<Inhabitant>() } };
}

export function parseData(raw: string | null): UniverseData {
  if (!raw) return emptyData();
  try {
    const j = nullify(JSON.parse(raw)) as { v?: unknown; instances?: unknown; commons?: { inhabitants?: unknown } } | null;
    if (!j || typeof j !== "object" || j.v !== 1) return emptyData();
    const d = emptyData();
    const inst = j.instances && typeof j.instances === "object" ? (j.instances as Dict<Instance>) : dict<Instance>();
    for (const k of Object.keys(inst)) {
      const i = inst[k];
      if (/^[a-z0-9]{8,16}$/.test(k) && i && typeof i === "object" && i.code === k && i.rooms && i.visits && Array.isArray(i.path)) d.instances[k] = i;
    }
    const inh = j.commons?.inhabitants && typeof j.commons.inhabitants === "object" ? (j.commons.inhabitants as Dict<Inhabitant>) : dict<Inhabitant>();
    for (const k of Object.keys(inh)) {
      const h = inh[k];
      if (/^[A-Za-z0-9_-]{1,64}$/.test(k) && h && typeof h === "object" && h.id === k && Array.isArray(h.cells) && Array.isArray(h.notes) && Array.isArray(h.lineage)) d.commons.inhabitants[k] = h;
    }
    enforceCaps(d);
    return d;
  } catch {
    return emptyData();
  }
}

function dropOldest<T>(map: Dict<T>, keys: string[], stamp: (v: T) => number, over: number): void {
  const order = keys.map((k, i) => ({ k, i, t: stamp(map[k]) })).sort((a, b) => a.t - b.t || a.i - b.i);
  for (let n = 0; n < over; n++) delete map[order[n].k];
}

/** Every cap in one place. Oldest / least-recently-seen retires first. */
export function enforceCaps(d: UniverseData, full = true): void {
  const ik = Object.keys(d.instances);
  if (ik.length > CAPS.instances) dropOldest(d.instances, ik, (i) => i.seen, ik.length - CAPS.instances);
  if (full) for (const k of Object.keys(d.instances)) {
    const i = d.instances[k];
    if (i.path.length > CAPS.path) i.path.splice(0, i.path.length - CAPS.path);
    for (const rk of Object.keys(i.rooms)) {
      const r = i.rooms[rk];
      if (r.objects.length > CAPS.objects) r.objects.splice(0, r.objects.length - CAPS.objects);
    }
  }
  const hk = Object.keys(d.commons.inhabitants);
  const byRoom = dict<string[]>();
  for (const k of hk) {
    const h = d.commons.inhabitants[k];
    if (full) {
      if (h.cells.length > CAPS.cells) h.cells.length = CAPS.cells;
      if (h.notes.length > CAPS.notes) h.notes.splice(0, h.notes.length - CAPS.notes);
      if (h.lineage.length > CAPS.lineage) h.lineage.splice(0, h.lineage.length - CAPS.lineage);
    }
    (byRoom[h.room] ??= []).push(k);
  }
  for (const room of Object.keys(byRoom)) {
    const ks = byRoom[room];
    if (ks.length > CAPS.perRoom) dropOldest(d.commons.inhabitants, ks, (h) => h.at, ks.length - CAPS.perRoom);
  }
  const left = Object.keys(d.commons.inhabitants);
  if (left.length > CAPS.inhabitants) dropOldest(d.commons.inhabitants, left, (h) => h.at, left.length - CAPS.inhabitants);
}

export function createStore(opts: StoreOpts): Store {
  const { io, debounceMs = 800 } = opts;
  const schedule = opts.schedule ?? ((fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms) as unknown as { unref?: () => void };
    t.unref?.();
  });
  let raw: string | null = null;
  try { raw = io.read(); } catch { raw = null; }
  const data = parseData(raw);
  let dirty = false;
  let pending = false;

  const flush = () => {
    pending = false;
    if (!dirty) return;
    dirty = false;
    try { io.write(JSON.stringify(data)); } catch { dirty = true; }
  };

  return {
    get: () => data,
    mutate(fn) {
      const out = fn(data);
      enforceCaps(data, false); // per-item caps are held at the write sites; a load checks them all
      dirty = true;
      if (!pending) {
        pending = true;
        schedule(flush, debounceMs);
      }
      return out;
    },
    flush,
  };
}
