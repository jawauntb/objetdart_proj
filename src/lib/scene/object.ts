/**
 * scene/object — the countable things a room is made of.
 *
 * A room is a **background field plus a population of objects**. The field is
 * a fragment shader; the objects are an atom, a nucleon, a shell, a cell, a
 * flower, a bird, a star, a mass, a cairn. Until now every one of those drew
 * itself: `createRadialGradient` inside `for (const a of atoms)`, a shadowBlur
 * per petal, forty-odd gradient allocations a frame in /stars. That is one
 * defect wearing two faces — no shared object model, and no shared renderer —
 * and this module is the half that fixes the model.
 *
 * The contract, in one breath: **an object describes itself; the room draws
 * the population.** An object owns a small deterministic state vector and a
 * seed, declares which verbs of the gesture grammar its material can answer,
 * lives a lifecycle (born → growing under a dwell → sealed by a ceremony →
 * retiring), and contributes *instance data* — position, radius, hue, glow,
 * phase — never a draw call. `scene/instances.ts` packs those instances and
 * `scene/gl.ts` draws the whole population in one pass.
 *
 * Pure: no DOM, no React, no gesture imports. node-testable
 * (`scripts/test-scene.mjs`). The DOM half lives in `scene/room.ts`.
 */

// ———————————————————————————————————————————————————————————————————————
// Verbs — the seam between the room and the things inside it
// ———————————————————————————————————————————————————————————————————————

/**
 * The grammar, as an object can answer it (docs/gesture-grammar.md §3: finger
 * count addresses the stack). The room routes by finger count and hands the
 * object only the verbs it declared:
 *
 *  - **material** (one finger): `touch`, `stroke`, `dwell`, `ceremony`
 *  - **map** (two fingers): `lens` — the level of description turning
 *  - **law** (three fingers): `tutti`, `season`, `wind`, `dilate`
 *  - **vessel** (the device): `gravity`, `agitate`, `knock`, `night`
 *
 * Pinch is deliberately absent: it is the frame verb, owned by ScaleTravel or
 * by the room's camera, never by a thing inside the room.
 */
export const OBJECT_VERBS = [
  "touch",
  "stroke",
  "dwell",
  "ceremony",
  "tutti",
  "lens",
  "season",
  "wind",
  "dilate",
  "gravity",
  "agitate",
  "knock",
  "night",
] as const;

export type ObjectVerb = (typeof OBJECT_VERBS)[number];

/** Verbs that land somewhere: routed to the object nearest the contact. */
export const POSITIONAL_VERBS: ReadonlySet<ObjectVerb> = new Set([
  "touch",
  "stroke",
  "dwell",
  "ceremony",
]);

/**
 * One reusable event, filled by the room and passed down. Reused on purpose:
 * nothing in a RAF loop may allocate, and a fresh object per gesture frame is
 * an allocation per gesture frame.
 *
 * `intensity` and `elapsedMs` are the continuous axes the grammar insists on
 * — a verb that answers identically at 900ms and 2400ms is a bug, and an
 * object receives what it needs to keep deepening.
 */
export type VerbEvent = {
  verb: ObjectVerb;
  /** 0..1, from the best physical channel the hardware had. */
  intensity: number;
  /** hold duration so far, ms. 0 for verbs with no duration. */
  elapsedMs: number;
  /** hold tier (0 touch, 1 press, 2 dwell, 3 ceremony). */
  tier: number;
  /** normalized contact / centroid, 0..1 with ny = 0 at the top. */
  nx: number;
  ny: number;
  /** normalized motion for stroke / wind / gravity. */
  dx: number;
  dy: number;
  /** radians, for lens and season. */
  angle: number;
  /** room clock, ms. */
  tMs: number;
};

export function createVerbEvent(): VerbEvent {
  return {
    verb: "touch",
    intensity: 0,
    elapsedMs: 0,
    tier: 0,
    nx: 0.5,
    ny: 0.5,
    dx: 0,
    dy: 0,
    angle: 0,
    tMs: 0,
  };
}

// ———————————————————————————————————————————————————————————————————————
// State — every object is a small vector plus a seed
// ———————————————————————————————————————————————————————————————————————

/**
 * The fields every scene object carries, so lifecycle, routing, persistence
 * and instancing are generic. A room's own kind extends this with whatever
 * its material needs (charge, petal count, mass, wingbeat) — and everything
 * it adds must still be a small vector a seed can regenerate.
 */
export type SceneObjectState = {
  id: number;
  /** the determinism law: every generated detail is a function of this. */
  seed: number;
  nx: number;
  ny: number;
  bornMs: number;
  /** 0..1, how built it is. A dwell deepens it continuously, never a switch. */
  growth: number;
  /** ms of the ceremony that sealed it, or null. */
  sealedMs: number | null;
  /** 1 while it stands, falling to 0 as it retires. Removed at 0. */
  presence: number;
};

export type StepContext = {
  /** seconds since the last step, already clamped by the room. */
  dt: number;
  /** room clock, ms. */
  tMs: number;
  /** the shared 7s breath, 0..1. */
  breath: number;
  /** quality detail multipliers from room-runtime's detailForTier. */
  detail: number;
  /** whole-room fields the law layer sets: wind, gravity, agitation, season. */
  wind: number;
  gravity: number;
  agitation: number;
  season: number;
  /** 1 normally, < 1 while a three-finger hold dilates time. */
  timeScale: number;
  reducedMotion: boolean;
};

/** Where an object writes its render contribution. See scene/instances.ts. */
export type InstanceSink = {
  push(
    x: number,
    y: number,
    r: number,
    rot: number,
    hue: number,
    glow: number,
    phase: number,
    alpha: number,
  ): void;
};

export type EmitContext = {
  /** css pixels of the room, so an object can place itself in the frame. */
  width: number;
  height: number;
  tMs: number;
  breath: number;
  detail: number;
  reducedMotion: boolean;
};

/**
 * A kind of thing a room contains. One spec per kind; the population holds
 * the instances.
 *
 * `step` and the verb handlers mutate their state in place — determinism is
 * about generation being a function of (seed, state), not about immutability,
 * and a room that allocates a new record per object per frame is the
 * performance bug this module exists to end.
 */
export type SceneObjectSpec<S extends SceneObjectState = SceneObjectState> = {
  /** the room's noun for it: "atom", "shell", "bird". Also the registry's `creates`. */
  kind: string;
  /** how many may stand at once; the oldest retires gracefully past this. */
  cap: number;
  /** deterministic birth. Everything about the thing comes from the seed. */
  born(seed: number, nx: number, ny: number, tMs: number): S;
  /** advance one step, in place. */
  step(s: S, ctx: StepContext): void;
  /** describe yourself as instances — never a draw call. */
  emit(s: S, ctx: EmitContext, out: InstanceSink): void;
  /**
   * The verbs this material can express. Declaring one without a handler is
   * a contract violation `validateSpec` catches — an object that claims a
   * verb must implement it.
   */
  verbs: readonly ObjectVerb[];
  respond: Partial<Record<ObjectVerb, (s: S, e: VerbEvent) => void>>;
  /** how close (normalized) a positional verb must land to reach this thing. */
  reach?: number;
  /** how fast a retiring thing fades, presence per second. Default: a breath. */
  retireRate?: number;
};

/** Default reach for a positional verb: a comfortable thumb, not a hairline. */
export const DEFAULT_REACH = 0.09;
/** Retiring takes ~1.6s — an exhale, never a blink-delete. */
export const DEFAULT_RETIRE_RATE = 0.625;

/**
 * Everything wrong with a spec, as sentences. Empty means it holds.
 *
 * The load-bearing one: a declared verb with no handler. That is how an
 * object comes to *look* like it answers the grammar in a registry entry and
 * silently swallow the gesture in the hand.
 */
export function validateSpec(spec: SceneObjectSpec<never> | SceneObjectSpec<any>): string[] {
  const out: string[] = [];
  if (!spec.kind || !spec.kind.trim()) out.push("a scene object needs a kind — the room's noun for it");
  if (!(spec.cap > 0)) out.push(`${spec.kind}: cap must be a positive population limit`);
  const seen = new Set<string>();
  for (const verb of spec.verbs) {
    if (!(OBJECT_VERBS as readonly string[]).includes(verb)) {
      out.push(`${spec.kind}: "${verb}" is not a verb of the grammar`);
      continue;
    }
    if (seen.has(verb)) out.push(`${spec.kind}: declares "${verb}" twice`);
    seen.add(verb);
    if (typeof spec.respond[verb] !== "function") {
      out.push(
        `${spec.kind}: declares the verb "${verb}" and implements no handler for it — ` +
          "a claimed verb that does nothing is worse than an unbound one, because the " +
          "manifest says the hand will be answered",
      );
    }
  }
  for (const verb of Object.keys(spec.respond)) {
    if (!seen.has(verb)) {
      out.push(
        `${spec.kind}: implements "${verb}" without declaring it — the room routes only ` +
          "declared verbs, so this handler can never fire",
      );
    }
  }
  return out;
}

// ———————————————————————————————————————————————————————————————————————
// Population — the room's whole material, one array
// ———————————————————————————————————————————————————————————————————————

/** Integer hash → seed. The site-wide idiom; no Math.random anywhere. */
export function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h ^= Math.round(p) & 0xffffffff;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Population<S extends SceneObjectState> = {
  readonly spec: SceneObjectSpec<S>;
  readonly items: S[];
  /** how many stand (retiring ones excluded) — drives <LetGo>'s visibility. */
  standing(): number;
  spawn(nx: number, ny: number, tMs: number): S;
  step(ctx: StepContext): void;
  emit(ctx: EmitContext, out: InstanceSink): void;
  /** deliver a verb; returns how many objects answered it. */
  route(e: VerbEvent): number;
  /** the LetGo exhale: everything retires together, gracefully. */
  letGo(): void;
  serialize(): SerializedPopulation;
  load(raw: unknown, tMs: number): void;
};

export type SerializedPopulation = { kind: string; items: unknown[] };

/**
 * Build a population. Throws on an invalid spec rather than shipping an
 * object that claims verbs it cannot answer — the failure belongs at the
 * moment the room is written, not in a stranger's hand.
 */
export function createPopulation<S extends SceneObjectState>(
  spec: SceneObjectSpec<S>,
): Population<S> {
  const problems = validateSpec(spec);
  if (problems.length) throw new Error(`scene object contract: ${problems.join("; ")}`);

  const items: S[] = [];
  const reach = spec.reach ?? DEFAULT_REACH;
  const retireRate = spec.retireRate ?? DEFAULT_RETIRE_RATE;
  const answers = new Set(spec.verbs);
  let nextId = 1;

  const standing = () => {
    let n = 0;
    for (let i = 0; i < items.length; i++) if (items[i].presence >= 1) n++;
    return n;
  };

  const retireOldest = () => {
    let oldest: S | null = null;
    for (let i = 0; i < items.length; i++) {
      const s = items[i];
      if (s.presence < 1) continue; // already leaving
      if (!oldest || s.bornMs < oldest.bornMs) oldest = s;
    }
    if (oldest) oldest.presence = 0.999;
  };

  return {
    spec,
    items,
    standing,

    spawn(nx, ny, tMs) {
      const seed = hashSeed(nextId, Math.round(nx * 8191), Math.round(ny * 4093));
      const s = spec.born(seed, nx, ny, tMs);
      s.id = nextId++;
      s.seed = seed;
      s.nx = nx;
      s.ny = ny;
      s.bornMs = tMs;
      if (s.presence === undefined) s.presence = 1;
      items.push(s);
      // Past the cap the oldest leaves the way everything leaves here: it
      // retires over a breath. Never a silent splice — a thing vanishing
      // between frames is the one motion the eye reads as a bug.
      let alive = 0;
      for (let i = 0; i < items.length; i++) if (items[i].presence >= 1) alive++;
      if (alive > spec.cap) retireOldest();
      return s;
    },

    step(ctx) {
      for (let i = items.length - 1; i >= 0; i--) {
        const s = items[i];
        if (s.presence < 1) {
          s.presence -= retireRate * ctx.dt;
          if (s.presence <= 0) {
            items.splice(i, 1);
            continue;
          }
        }
        spec.step(s, ctx);
      }
    },

    emit(ctx, out) {
      for (let i = 0; i < items.length; i++) spec.emit(items[i], ctx, out);
    },

    route(e) {
      const handler = spec.respond[e.verb];
      if (!handler || !answers.has(e.verb)) return 0;
      if (!POSITIONAL_VERBS.has(e.verb)) {
        // A field verb reaches everything alive at once — that is what makes
        // tutti one pulse of the whole room rather than a pulse of one thing.
        let n = 0;
        for (let i = 0; i < items.length; i++) {
          if (items[i].presence <= 0) continue;
          handler(items[i], e);
          n++;
        }
        return n;
      }
      let best: S | null = null;
      let bestD2 = reach * reach;
      for (let i = 0; i < items.length; i++) {
        const s = items[i];
        if (s.presence < 1) continue; // a retiring thing is past answering
        const dx = s.nx - e.nx;
        const dy = s.ny - e.ny;
        const d2 = dx * dx + dy * dy;
        if (d2 <= bestD2) {
          bestD2 = d2;
          best = s;
        }
      }
      if (!best) return 0;
      handler(best, e);
      return 1;
    },

    letGo() {
      for (let i = 0; i < items.length; i++) {
        if (items[i].presence >= 1) items[i].presence = 0.999;
      }
    },

    serialize() {
      const out: unknown[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].presence < 1) continue; // a thing on its way out is not kept
        out.push(items[i]);
      }
      return { kind: spec.kind, items: out };
    },

    load(raw, tMs) {
      items.length = 0;
      const parsed = raw as SerializedPopulation | null;
      if (!parsed || parsed.kind !== spec.kind || !Array.isArray(parsed.items)) return;
      for (const entry of parsed.items.slice(-spec.cap)) {
        const s = entry as S;
        if (!s || typeof s !== "object") continue;
        if (typeof s.nx !== "number" || typeof s.ny !== "number") continue;
        s.id = nextId++;
        s.presence = 1;
        if (typeof s.seed !== "number") s.seed = hashSeed(s.id, Math.round(s.nx * 8191));
        if (typeof s.growth !== "number") s.growth = 1;
        if (typeof s.bornMs !== "number") s.bornMs = tMs;
        if (s.sealedMs !== null && typeof s.sealedMs !== "number") s.sealedMs = null;
        items.push(s);
      }
    },
  };
}
