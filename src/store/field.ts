"use client";

import { create } from "zustand";
import type { ConcernKey, PhaseKey } from "@/lib/types";
import { CONCERNS, PRESETS, REGIONS, OBJECTS } from "@/data/content";

type Medium = string;

export type KeptReading = {
  hash: string;
  headline: string;
  topConcern: ConcernKey;
  region: string | null;
  carriedObject: string | null;
  keptAt: number; // unix ms — set on save, but we never read it during render
};

interface FieldState {
  concerns: Record<ConcernKey, number>;
  preset: string | null;
  region: string | null;            // selected atlas region
  carriedObject: string | null;     // object the user is carrying
  // archive filters
  archMedium: Set<Medium>;
  archConcern: Set<ConcernKey>;
  archObject: Set<string>;
  archPhase: Set<PhaseKey>;
  archQuery: string;
  archSort: "recent" | "oldest" | "phase" | "medium";
  // halo pulses on regions when concerns slide. region id → timestamp.
  haloRegions: Record<string, number>;
  // readings the user has kept — a private trail of past nights.
  keptReadings: KeptReading[];
  // which concern axis the user is currently holding/dragging, if any.
  // ConcernTint reads this to gently tint the global page palette to
  // match the tone currently playing under their finger.
  heldConcern: ConcernKey | null;

  setConcern: (k: ConcernKey, v: number) => void;
  setHeldConcern: (k: ConcernKey | null) => void;
  applyPreset: (name: string) => void;
  setRegion: (id: string | null) => void;
  setCarried: (id: string | null) => void;
  toggleArchFilter: (kind: "medium" | "concern" | "object" | "phase", v: string) => void;
  setArchQuery: (q: string) => void;
  setArchSort: (s: FieldState["archSort"]) => void;
  pulseRegions: (ids: string[]) => void;
  loadFromStorage: () => void;
  hydrateFromHash: (hash: string) => void;
  keepReading: (r: KeptReading) => void;
  forgetReading: (hash: string) => void;
  imaginedEntries: ImaginedEntry[];
  addImaginedEntry: (e: ImaginedEntry) => void;
  forgetImaginedEntry: (id: string) => void;
  // the tape — session-only seismograph
  tape: TapeEvent[];
  recordTape: (kind: TapeEventKind, intensity?: number, meta?: string) => void;
  clearTape: () => void;
}

export type ImaginedEntry = {
  id: string;
  title: string;
  fn: string;
  note: string;
  body: string[];
  concerns: ConcernKey[];
  medium: string;
  region: string;
  imaginedAt: number;
};

/**
 * The tape — a perceptual seismograph.
 *
 * Each event the user makes (touching water, dragging a concern, entering a
 * region, keeping a reading) leaves a pulse here. The tape is session-only
 * (not persisted) — today's nervous system. The visual strip draws each
 * pulse like an EKG mark and they slowly drift left as time passes.
 *
 * Why: the site's missing layer was that state is not just a vector — it's
 * a time series. The tape makes the object behave like the user's charts.
 */
export type TapeEventKind =
  | "ripple"   // water touched
  | "candle"   // candle / attention
  | "concern"  // concern axis moved
  | "region"   // atlas region entered
  | "object"   // object carried
  | "reading"  // reading composed
  | "kept"     // reading kept
  | "ask"      // ask-the-room used
  | "imagine"  // imagine-entry used
  | "sigil"    // sigil phrase played
  | "preset";  // preset applied

export type TapeEvent = {
  t: number;          // unix ms
  kind: TapeEventKind;
  intensity: number;  // 0..1 — height/weight of the pulse
  meta?: string;      // optional short label (region id, concern key, etc.)
};

const baseConcerns = Object.fromEntries(
  CONCERNS.map((c) => [c.id, 50]),
) as Record<ConcernKey, number>;

const STORAGE_KEY = "objetdart:state:v1";
const KEPT_KEY = "objetdart:kept:v1";
const IMAGINED_KEY = "objetdart:imagined:v1";

function persist(s: Partial<FieldState>) {
  if (typeof window === "undefined") return;
  try {
    const minimal = {
      concerns: s.concerns,
      preset: s.preset,
      region: s.region,
      carriedObject: s.carriedObject,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(minimal));
  } catch { /* noop */ }
}

function persistKept(list: KeptReading[]) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(KEPT_KEY, JSON.stringify(list)); } catch { /* noop */ }
}

export const useField = create<FieldState>((set, get) => ({
  concerns: { ...baseConcerns },
  preset: null,
  region: null,
  carriedObject: null,
  archMedium: new Set(),
  archConcern: new Set(),
  archObject: new Set(),
  archPhase: new Set(),
  archQuery: "",
  archSort: "recent",
  haloRegions: {},
  keptReadings: [],
  imaginedEntries: [],
  tape: [],
  heldConcern: null,

  setHeldConcern: (k) => set({ heldConcern: k }),

  setConcern: (k, v) => {
    const prev = get().concerns[k] ?? 50;
    const next = { ...get().concerns, [k]: v };
    set({ concerns: next, preset: null });
    persist({ ...get(), concerns: next });

    // pulse every region tagged with this concern, simultaneously.
    const ids = REGIONS.filter((r) => r.concerns.includes(k)).map((r) => r.id);
    if (ids.length) get().pulseRegions(ids);

    // record on the tape — intensity scales with the magnitude of the move
    get().recordTape("concern", Math.min(1, Math.abs(v - prev) / 50 + 0.15), k);
  },

  applyPreset: (name) => {
    const p = PRESETS[name];
    if (!p) return;
    set({ concerns: { ...p }, preset: name });
    persist({ ...get(), concerns: p, preset: name });
    get().recordTape("preset", 0.9, name);
  },

  setRegion: (region) => {
    set({ region });
    persist({ ...get(), region });
    if (region) get().recordTape("region", 0.7, region);
  },

  setCarried: (carriedObject) => {
    set({ carriedObject });
    persist({ ...get(), carriedObject });
    if (carriedObject) {
      get().recordTape("object", 0.6, carriedObject);
      // when an object is carried, filter archive to include its tags
      const o = OBJECTS.find((x) => x.id === carriedObject);
      if (o) {
        const archObject = new Set(get().archObject);
        archObject.add(o.id);
        set({ archObject });
      }
    }
  },

  toggleArchFilter: (kind, v) => {
    const key = ({
      medium: "archMedium" as const,
      concern: "archConcern" as const,
      object: "archObject" as const,
      phase: "archPhase" as const,
    })[kind];
    const s = get()[key] as Set<string>;
    const next = new Set(s);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    set({ [key]: next } as Partial<FieldState>);
  },

  setArchQuery: (archQuery) => set({ archQuery }),
  setArchSort: (archSort) => set({ archSort }),

  pulseRegions: (ids) => {
    const now = Date.now();
    const next = { ...get().haloRegions };
    ids.forEach((id) => { next[id] = now; });
    set({ haloRegions: next });
  },

  recordTape: (kind, intensity = 0.6, meta) => {
    const now = Date.now();
    // dedupe rapid-fire same-kind events from a single drag — collapse anything
    // within 80ms of the previous same-kind into one pulse with max intensity.
    const last = get().tape[0];
    if (last && last.kind === kind && now - last.t < 80) {
      const merged: TapeEvent = {
        t: now,
        kind,
        intensity: Math.max(last.intensity, Math.min(1, Math.max(0, intensity))),
        meta: meta ?? last.meta,
      };
      const rest = get().tape.slice(1);
      set({ tape: [merged, ...rest].slice(0, 240) });
      return;
    }
    const ev: TapeEvent = {
      t: now,
      kind,
      intensity: Math.min(1, Math.max(0.1, intensity)),
      meta,
    };
    // trim older than 8 minutes and cap to 240 entries
    const cutoff = now - 8 * 60 * 1000;
    const next = [ev, ...get().tape.filter((e) => e.t >= cutoff)].slice(0, 240);
    set({ tape: next });
  },
  clearTape: () => set({ tape: [] }),

  loadFromStorage: () => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const j = JSON.parse(raw);
        const patch: Partial<FieldState> = {};
        if (j.concerns) patch.concerns = { ...baseConcerns, ...j.concerns };
        if (j.preset) patch.preset = j.preset;
        // NOTE: deliberately do NOT restore j.region here.  The Atlas drawer
        // should always start closed on a fresh page load — it only opens when
        // the user explicitly clicks a region (or when a route param like
        // /atlas/[region] explicitly sets it after hydration).
        if (j.carriedObject) patch.carriedObject = j.carriedObject;
        set(patch as FieldState);
      }
      const keptRaw = localStorage.getItem(KEPT_KEY);
      if (keptRaw) {
        const kept = JSON.parse(keptRaw) as KeptReading[];
        if (Array.isArray(kept)) set({ keptReadings: kept });
      }
      const imRaw = localStorage.getItem(IMAGINED_KEY);
      if (imRaw) {
        const im = JSON.parse(imRaw) as ImaginedEntry[];
        if (Array.isArray(im)) set({ imaginedEntries: im });
      }
    } catch { /* noop */ }
  },

  keepReading: (r) => {
    const list = [r, ...get().keptReadings.filter((x) => x.hash !== r.hash)].slice(0, 64);
    set({ keptReadings: list });
    persistKept(list);
    get().recordTape("kept", 1.0, r.topConcern);
  },
  forgetReading: (hash) => {
    const list = get().keptReadings.filter((r) => r.hash !== hash);
    set({ keptReadings: list });
    persistKept(list);
  },

  addImaginedEntry: (e) => {
    const list = [e, ...get().imaginedEntries.filter((x) => x.id !== e.id)].slice(0, 64);
    set({ imaginedEntries: list });
    if (typeof window !== "undefined") {
      try { localStorage.setItem(IMAGINED_KEY, JSON.stringify(list)); } catch { /* noop */ }
    }
    get().recordTape("imagine", 0.85, e.region);
  },
  forgetImaginedEntry: (id) => {
    const list = get().imaginedEntries.filter((e) => e.id !== id);
    set({ imaginedEntries: list });
    if (typeof window !== "undefined") {
      try { localStorage.setItem(IMAGINED_KEY, JSON.stringify(list)); } catch { /* noop */ }
    }
  },

  hydrateFromHash: (hash: string) => {
    if (!hash) return;
    try {
      const b64 = hash.replace(/-/g, "+").replace(/_/g, "/");
      const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
      const bin = atob(padded);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      if (bytes.length < 10) return;
      const order = ["memory","work","love","prayer","risk","future","body","friendship"] as const;
      const concerns = { ...get().concerns };
      order.forEach((k, i) => { concerns[k] = Math.min(100, Math.max(0, bytes[i])); });
      const rIdx = bytes[8] - 1;
      const oIdx = bytes[9] - 1;
      const region = rIdx >= 0 && rIdx < REGIONS.length ? REGIONS[rIdx].id : null;
      const carriedObject = oIdx >= 0 && oIdx < OBJECTS.length ? OBJECTS[oIdx].id : null;
      set({ concerns, region, carriedObject, preset: null });
    } catch { /* noop */ }
  },
}));
