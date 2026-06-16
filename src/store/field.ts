import { create } from "zustand";
import type { ConcernKey, LensKey, ModeKey, FieldTrace } from "@/lib/types";
import {
  CONCERNS, PRESETS, REGIONS, OBJECTS, ARCHIVE, INSCRIPTIONS,
} from "@/data/content";
import { putTrace, getTraces } from "@/lib/idb";

interface RouteResult {
  from: string;
  to: string;
  concerns: ConcernKey[];
  objects: string[];
  entries: string[];
  inscription: string;
}

export type ArchFacet = "concern" | "object" | "phase";

interface FieldState {
  entered: boolean;
  mode: ModeKey;
  lens: LensKey | null;
  concerns: Record<ConcernKey, number>;
  phase: number;
  held: string | null;
  dragging: string | null;
  attention: number; // 0..1, the candle field
  candleUse: number; // accumulated hold time — past 1 the candle exhausts
  exhausted: boolean;
  route: RouteResult | null;
  archFilter: string | null;
  archFacets: { concern: ConcernKey | null; object: string | null; phase: string | null };
  archQuery: string;
  traces: FieldTrace[];
  flash: string | null;

  enter: () => void;
  setMode: (m: ModeKey) => void;
  setLens: (l: LensKey) => void;
  cycleLens: () => void;
  setConcern: (k: ConcernKey, v: number) => void;
  applyPreset: (name: string) => void;
  setPhase: (p: number) => void;
  setHeld: (id: string | null) => void;
  setDragging: (id: string | null) => void;
  bumpAttention: (d: number) => void;
  decayAttention: () => void;
  makeRoute: (fromId: string, toId: string) => void;
  resolveCombo: (objectId: string, target: string) => void;
  setArchFilter: (m: string | null) => void;
  setArchFacet: (k: ArchFacet, v: string | null) => void;
  setArchQuery: (q: string) => void;
  generateReading: () => Promise<FieldTrace>;
  loadTraces: () => Promise<void>;
  setFlash: (msg: string | null) => void;
  runCommand: (q: string) => void;
}

const baseConcerns = Object.fromEntries(
  CONCERNS.map((c) => [c.id, 50]),
) as Record<ConcernKey, number>;

export const useField = create<FieldState>((set, get) => ({
  entered: false,
  mode: "window",
  lens: null,
  concerns: { ...baseConcerns },
  phase: 0,
  held: null,
  dragging: null,
  attention: 0,
  candleUse: 0,
  exhausted: false,
  route: null,
  archFilter: null,
  archFacets: { concern: null, object: null, phase: null },
  archQuery: "",
  traces: [],
  flash: null,

  enter: () => set({ entered: true, mode: "table" }),

  setMode: (mode) => set({ mode }),

  setLens: (lens) => {
    const nudge: Record<LensKey, ConcernKey> = {
      ritual: "prayer", systems: "work", body: "body",
      archive: "memory", horizon: "future",
    };
    const k = nudge[lens];
    set((s) => ({
      lens,
      concerns: { ...s.concerns, [k]: Math.min(100, s.concerns[k] + 15) },
    }));
  },

  cycleLens: () => {
    const order: LensKey[] = ["ritual", "systems", "body", "archive", "horizon"];
    const i = order.indexOf(get().lens as LensKey);
    const next = order[(i + 1) % order.length];
    get().setLens(next);
    get().setFlash("Lens · " + next);
  },

  setConcern: (k, v) =>
    set((s) => ({ concerns: { ...s.concerns, [k]: v } })),

  applyPreset: (name) => {
    const p = PRESETS[name];
    if (p) set({ concerns: { ...p } });
  },

  setPhase: (phase) => set({ phase }),
  setHeld: (held) => set({ held }),
  setDragging: (dragging) => set({ dragging }),
  bumpAttention: (d) =>
    set((s) => {
      if (s.exhausted) return s;
      const attention = Math.max(0, Math.min(1, s.attention + d));
      const candleUse = s.candleUse + Math.max(0, d);
      if (candleUse > 1.1 && !s.exhausted) {
        return { attention: Math.min(attention, 0.2), candleUse, exhausted: true };
      }
      return { attention, candleUse };
    }),
  decayAttention: () =>
    set((s) => {
      if (s.exhausted) {
        return { attention: Math.max(0, s.attention - 0.02) };
      }
      return s.held === "candle"
        ? s
        : { attention: Math.max(0, s.attention - 0.012) };
    }),

  makeRoute: (fromId, toId) => {
    const from = REGIONS.find((r) => r.id === fromId);
    const to = REGIONS.find((r) => r.id === toId);
    if (!from || !to) return;
    const concerns = Array.from(new Set([...from.concerns, ...to.concerns]));
    const objects = OBJECTS.filter((o) =>
      o.regions.some((r) => r === from.id || r === to.id),
    ).slice(0, 3).map((o) => o.id);
    const entries = ARCHIVE.filter(
      (a) => a.region === from.id || a.region === to.id,
    ).slice(0, 3).map((e) => e.id);
    const inscription =
      INSCRIPTIONS[(from.label.length + to.label.length) % INSCRIPTIONS.length];
    set({ route: { from: from.id, to: to.id, concerns, objects, entries, inscription } });
  },

  resolveCombo: (objectId, target) => {
    const o = OBJECTS.find((x) => x.id === objectId);
    if (!o) return;

    // object → object pair
    if (target.startsWith("obj:")) {
      const otherId = target.slice(4);
      const other = OBJECTS.find((x) => x.id === otherId);
      if (!other) return;
      if (objectId === "candle" && otherId === "map") {
        get().bumpAttention(0.6);
        get().setFlash("Attention layer · candle on the map");
        return;
      }
      if (objectId === "book" && otherId === "compass") {
        get().setLens("systems");
        get().setFlash("Theory mode");
        return;
      }
      if (objectId === "glass" && otherId === "candle") {
        set({ exhausted: false, candleUse: 0, attention: 0 });
        get().setFlash("The candle is relit.");
        return;
      }
      get().setFlash(`${o.label} ↔ ${other.label}`);
      return;
    }

    // sea zone — record + sea = memory current
    if (target === "sea") {
      if (objectId === "record") {
        get().applyPreset("Return");
        get().bumpAttention(0.15);
        get().setFlash("Memory current");
      } else {
        get().setFlash(`${o.label} on the water`);
      }
      return;
    }

    // object → region
    const r = REGIONS.find((x) => x.id === target);
    if (!r) return;
    get().setFlash(`${o.label} → ${r.label}`);

    if (objectId === "candle") get().bumpAttention(0.4);
    if (objectId === "glass" && r.id === "crash") {
      get().applyPreset("Return");
      get().setFlash("Pressure reduced");
    }
    if (objectId === "flower" && r.id === "loves") {
      get().applyPreset("Lover");
      get().setFlash("Care constellation");
    }
    if (objectId === "grid" && r.id === "workbench") {
      get().setArchFilter("systems");
      get().setFlash("Systems filter set");
    }
    if (objectId === "key" && r.id === "road") {
      get().makeRoute("origin", "road");
      get().setFlash("Origin route opens");
      return;
    }
    if (objectId === "book" && r.id === "ascent") {
      get().setLens("systems");
      get().setFlash("Theory mode");
    }
    if (objectId === "window" && r.id === "horizon") {
      get().applyPreset("Horizon");
      get().setFlash("Future channel open");
    }
    if (objectId === "notebook" && r.id === "archive") {
      get().setArchFilter("writing");
      get().setFlash("Writing drawers");
    }
    if (objectId === "map") {
      get().setFlash(`Route laid: ${r.label}`);
    }

    get().makeRoute(o.regions.find((x) => x !== r.id && !x.startsWith("obj:") && x !== "sea") ?? r.id, r.id);
  },

  setArchFilter: (archFilter) => set({ archFilter }),
  setArchFacet: (k, v) =>
    set((s) => ({ archFacets: { ...s.archFacets, [k]: v } })),
  setArchQuery: (archQuery) => set({ archQuery }),

  generateReading: async () => {
    const s = get();
    const top = (Object.entries(s.concerns) as [ConcernKey, number][])
      .sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]);
    const objects = (s.route ? s.route.objects : OBJECTS.slice(0, 3).map((o) => o.id)).slice(0, 3);
    const region = s.route
      ? REGIONS.find((r) => r.id === s.route!.to)!
      : REGIONS[Math.floor(Math.random() * REGIONS.length)];
    const rec = ARCHIVE.find((a) => a.concerns.some((c) => top.includes(c))) ?? ARCHIVE[0];
    const inscription = s.route
      ? s.route.inscription
      : INSCRIPTIONS[top.join("").length % INSCRIPTIONS.length];
    const trace: FieldTrace = {
      id: "t" + Date.now(),
      timestamp: new Date().toISOString(),
      concerns: { ...s.concerns },
      objects,
      region: region.id,
      archiveId: rec.id,
      inscription,
      route: s.route ? { from: s.route.from, to: s.route.to } : undefined,
    };
    await putTrace(trace);
    set((st) => ({ traces: [...st.traces, trace] }));
    return trace;
  },

  loadTraces: async () => {
    const traces = await getTraces();
    set({ traces });
  },

  setFlash: (flash) => set({ flash }),

  runCommand: (qRaw) => {
    const q = qRaw.toLowerCase();
    const g = get();
    if (q.includes("reset")) { g.applyPreset("Return"); set({ attention: 0, candleUse: 0, exhausted: false }); g.setFlash("Field reset."); return; }
    if (q.includes("archive")) { g.setMode("archive"); return; }
    if (q.includes("risk")) { g.applyPreset("Crash"); g.setMode("console"); return; }
    if (q.includes("prayer")) { g.applyPreset("Prayer"); g.setMode("console"); return; }
    if (q.includes("system")) { g.setArchFilter("systems"); g.setMode("archive"); return; }
    if (q.includes("love") && q.includes("work")) { g.makeRoute("loves", "workbench"); g.setMode("atlas"); return; }
    g.setFlash('The field heard: "' + qRaw + '"');
  },
}));
