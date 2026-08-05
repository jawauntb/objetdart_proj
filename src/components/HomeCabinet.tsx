"use client";

/**
 * /cabinet — the case that used to be the home page.
 *
 * Built as the home instrument, mounted at `/`, and left behind when `/`
 * became a scrolling gallery of route previews: for a while this file was
 * 1,200 lines of finished room that nothing imported. It is a room, so it
 * lives at a room's route now, and the two things it was still missing as a
 * section — a countable material, and the solemn act that takes one away —
 * arrived with the route: embers, gathered under a resting finger and let go
 * by a hold that blooms.
 *
 * It takes no scale address on purpose (`src/rooms/cabinet/room.config.ts`):
 * a case holding every route at once is a view of the tree, like `/overlook`
 * and `/loom`, not a rung on it.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import LetGo from "@/components/LetGo";
import RouteSigil from "@/components/RouteSigil";
import ConcernSigil from "@/components/ConcernSigil";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { attachGestures } from "@/lib/gesture";
import { THRESHOLDS, tapTrainDepth, tapTrainTier } from "@/lib/gesture/core";
import { onVessel } from "@/lib/vessel";
import { createFrameGovernor, createIdleWriter, detailForTier, isEmbeddedFrame, onVisibility, resolveDpr } from "@/lib/room-runtime";
import { SITE_ROUTE_BY_KEY, SITE_ROUTES, type SiteRouteCluster, type SiteRouteEntry } from "@/lib/routes";
import { useField } from "@/store/field";
import type { ConcernKey } from "@/lib/types";

/** An ember a dwell gathered: a small light the case keeps. */
type Ember = {
  /** world units on the case's plane */
  x: number;
  y: number;
  /** 0..1, how long the hand stayed — the dwell's duration made visible */
  weight: number;
  /** cluster index, so it burns in the colour of the current it was born in */
  current: number;
};

type HomeCabinetPatina = {
  glow: number;
  visits: number;
  routes: Record<string, number>;
  cluster: SiteRouteCluster;
  embers: Ember[];
};

const STORAGE_KEY = "objetdart:cabinet:v2";
/** The case holds this many embers; the oldest is retired to make room. */
const EMBER_CAP = 32;

const CLUSTERS: Array<{
  id: SiteRouteCluster;
  label: string;
  desc: string;
  color: string;
  glow: string;
  pitch: number;
}> = [
  { id: "field", label: "field", desc: "tune · cross · read", color: "#f3d37a", glow: "rgba(231,185,78,0.42)", pitch: 55 },
  { id: "water", label: "water", desc: "waves · text · weather", color: "#69d8d0", glow: "rgba(105,216,208,0.36)", pitch: 62 },
  { id: "nature", label: "nature", desc: "fire · earth · stars", color: "#a9d879", glow: "rgba(169,216,121,0.34)", pitch: 67 },
  { id: "mechanism", label: "mechanism", desc: "coin · watch · signal", color: "#d7b4ff", glow: "rgba(215,180,255,0.34)", pitch: 72 },
];

const CLUSTER_BY_ID = Object.fromEntries(CLUSTERS.map((cluster) => [cluster.id, cluster])) as Record<SiteRouteCluster, typeof CLUSTERS[number]>;
const CLUSTER_INDEX_BY_ID = Object.fromEntries(CLUSTERS.map((cluster, index) => [cluster.id, index])) as Record<SiteRouteCluster, number>;

// The four surfaces the case opens onto directly. They were page anchors while
// the cabinet was the home page's first screen; every one of them is a route of
// its own now, so they are links and nothing on this face is dead.
const LOCAL_ENTRIES: Array<{ key: string; label: string; href: string; desc: string; icon: SiteRouteEntry["icon"] }> = [
  { key: "compass", label: "compass", href: "/compass", desc: "the concern compass", icon: "atlas" },
  { key: "charts", label: "chart", href: "/charts", desc: "the departure swell", icon: "charts" },
  { key: "atlas", label: "atlas", href: "/atlas/origin", desc: "the territories", icon: "atlas" },
  { key: "kept", label: "kept", href: "/kept", desc: "the room speaks back", icon: "kept" },
];

const LOCAL_ENTRY_BY_KEY = Object.fromEntries(LOCAL_ENTRIES.map((entry) => [entry.key, entry])) as Record<string, typeof LOCAL_ENTRIES[number]>;
const ROUTES_BY_CLUSTER = Object.fromEntries(
  CLUSTERS.map((cluster) => [cluster.id, SITE_ROUTES.filter((route) => route.cluster === cluster.id)]),
) as Record<SiteRouteCluster, SiteRouteEntry[]>;
const SORTED_ROUTES_BY_CLUSTER = Object.fromEntries(
  CLUSTERS.map((cluster) => [
    cluster.id,
    ROUTES_BY_CLUSTER[cluster.id]
      .slice()
      .sort((a, b) => (b.homePriority ?? 0) - (a.homePriority ?? 0) || a.key.localeCompare(b.key)),
  ]),
) as Record<SiteRouteCluster, SiteRouteEntry[]>;

function blankPatina(): HomeCabinetPatina {
  return { glow: 0, visits: 0, routes: {}, cluster: "field", embers: [] };
}

function safeEmbers(raw: unknown): Ember[] {
  if (!Array.isArray(raw)) return [];
  const out: Ember[] = [];
  for (const item of raw.slice(-EMBER_CAP)) {
    if (!item || typeof item !== "object") continue;
    const e = item as Partial<Ember>;
    const x = Number(e.x);
    const y = Number(e.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({
      x: Math.max(-9, Math.min(9, x)),
      y: Math.max(-7, Math.min(7, y)),
      weight: Math.max(0, Math.min(1, Number(e.weight) || 0)),
      current: Math.max(0, Math.min(CLUSTERS.length - 1, Math.floor(Number(e.current) || 0))),
    });
  }
  return out;
}

function safePatina(raw: string | null): HomeCabinetPatina {
  if (!raw) return blankPatina();
  try {
    const parsed = JSON.parse(raw) as Partial<HomeCabinetPatina>;
    const cluster = parsed.cluster && CLUSTER_BY_ID[parsed.cluster] ? parsed.cluster : "field";
    return {
      glow: Math.max(0, Number(parsed.glow) || 0),
      visits: Math.max(0, Number(parsed.visits) || 0),
      routes: parsed.routes && typeof parsed.routes === "object" ? parsed.routes : {},
      cluster,
      embers: safeEmbers(parsed.embers),
    };
  } catch {
    return blankPatina();
  }
}

function clusterRoutes(cluster: SiteRouteCluster): SiteRouteEntry[] {
  return SORTED_ROUTES_BY_CLUSTER[cluster];
}

function routeAngle(route: SiteRouteEntry, index: number): number {
  const clusterIndex = CLUSTER_INDEX_BY_ID[route.cluster];
  const clusterStart = -Math.PI / 2 + clusterIndex * (Math.PI / 2);
  const siblings = ROUTES_BY_CLUSTER[route.cluster];
  const siblingIndex = siblings.findIndex((candidate) => candidate.key === route.key);
  const lane = siblingIndex >= 0 ? siblingIndex : index;
  const spread = Math.PI / 2 * 0.82;
  const t = siblings.length <= 1 ? 0.5 : lane / (siblings.length - 1);
  return clusterStart - spread / 2 + t * spread;
}

function hotspotStyle(route: SiteRouteEntry, index: number): React.CSSProperties {
  const angle = routeAngle(route, index);
  const radiusX = route.homePriority ? 38 : 43;
  const radiusY = route.homePriority ? 31 : 35;
  const x = (Math.cos(angle) * radiusX).toFixed(4);
  const y = (Math.sin(angle) * radiusY).toFixed(4);
  return {
    left: `calc(50% + ${x}%)`,
    top: `calc(50% + ${y}%)`,
  };
}

function dominantConcern(concerns: Record<ConcernKey, number>): ConcernKey {
  return (Object.entries(concerns) as Array<[ConcernKey, number]>)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? "memory";
}

export default function HomeCabinet() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const patinaRef = useRef<HomeCabinetPatina>(blankPatina());
  const activeKeyRef = useRef("atlas");
  const clusterRef = useRef<SiteRouteCluster>("field");
  const pointerRef = useRef({ x: 0, y: 0, pulse: 0 });
  // The shared idle-persistence bus. Coalesces rapid patina updates so a
  // fast hover walk across the case does not hammer localStorage on each
  // frame. Recreated per mount so a fresh visit starts with an empty
  // pending queue.
  const persistWriterRef = useRef<ReturnType<typeof createIdleWriter> | null>(null);
  const lastFeedbackRef = useRef(0);
  // frame/law/vessel state, read once per tick — never allocated inside it
  const panRef = useRef({ x: 0, y: 0 });
  const gustRef = useRef(0);
  const timeScaleRef = useRef(1);
  const tuttiRef = useRef(0);
  const tiltRef = useRef({ x: 0, y: 0 });
  const agitationRef = useRef(0);
  const nightRef = useRef(0);
  /** 0..1, the case's slow cycle — three-finger twist walks it, continuously. */
  const seasonRef = useRef(0);
  // the rapid-tap ladder's answers, read once per tick and decayed there:
  // three taps ring the standing current's gems, five kindle the embers
  const ringRef = useRef(0);
  const kindleRef = useRef(0);
  // the span: two still fingers hold the case's chord open — depth 0..1
  // keeps deepening with elapsed, spread tunes which octave the glass sings
  const spanRef = useRef(0);
  // The embers are the case's countable material, and the only thing in it a
  // hand makes rather than finds. `emberRef` is what the render loop reads;
  // the patina is what survives the visit; `standing` is only what <LetGo> needs.
  const emberRef = useRef<Ember[]>([]);
  const growingRef = useRef<Ember | null>(null);
  const [standing, setStanding] = useState(0);
  const [night, setNight] = useState(false);

  const concerns = useField((state) => state.concerns);
  const keptReadings = useField((state) => state.keptReadings);
  const loadFromStorage = useField((state) => state.loadFromStorage);
  const [activeKey, setActiveKey] = useState("atlas");
  const [selectedCluster, setSelectedCluster] = useState<SiteRouteCluster>("field");
  const [patina, setPatina] = useState<HomeCabinetPatina>(blankPatina());

  const activeRoute = SITE_ROUTE_BY_KEY[activeKey];
  const activeLocal = LOCAL_ENTRY_BY_KEY[activeKey];
  const activeLabel = activeRoute?.key ?? activeLocal?.label ?? SITE_ROUTE_BY_KEY.atlas.key;
  const activeDesc = activeRoute?.desc ?? activeLocal?.desc ?? SITE_ROUTE_BY_KEY.atlas.desc;
  const activeCluster = CLUSTER_BY_ID[selectedCluster];
  const routesInCluster = useMemo(() => clusterRoutes(selectedCluster), [selectedCluster]);
  const topConcern = useMemo(() => dominantConcern(concerns), [concerns]);

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const loaded = safePatina(readStoredPatina());
    const next = { ...loaded, visits: loaded.visits + 1 };
    patinaRef.current = next;
    clusterRef.current = next.cluster;
    emberRef.current = next.embers.slice(-EMBER_CAP);
    setStanding(emberRef.current.length);
    setPatina(next);
    setSelectedCluster(next.cluster);
    // The shared idle writer: coalesces rapid patina updates and writes
    // through room-runtime's requestIdleCallback path, replacing the
    // private setTimeout debouncer this room used to roll.
    persistWriterRef.current = createIdleWriter(() => savePatina(patinaRef.current));
    savePatina(next);
    return () => {
      persistWriterRef.current?.flush();
      persistWriterRef.current = null;
      savePatina(patinaRef.current);
    };
  }, []);

  const persistLater = useCallback((next: HomeCabinetPatina) => {
    patinaRef.current = next;
    setPatina(next);
    if (typeof window === "undefined") return;
    persistWriterRef.current?.schedule();
  }, []);

  const addPatina = useCallback((routeKey: string, cluster: SiteRouteCluster, amount: number) => {
    const current = patinaRef.current;
    const next = {
      glow: Math.min(80, current.glow + amount),
      visits: current.visits,
      cluster,
      embers: current.embers,
      routes: {
        ...current.routes,
        [routeKey]: (current.routes[routeKey] ?? 0) + 1,
      },
    };
    persistLater(next);
  }, [persistLater]);

  const commitEmbers = useCallback(() => {
    const current = patinaRef.current;
    persistLater({ ...current, embers: emberRef.current.slice(-EMBER_CAP) });
    setStanding(emberRef.current.length);
  }, [persistLater]);

  const selectRoute = useCallback((route: SiteRouteEntry, source: "hover" | "focus" | "activate" = "hover") => {
    activeKeyRef.current = route.key;
    clusterRef.current = route.cluster;
    setActiveKey(route.key);
    setSelectedCluster(route.cluster);
    if (source === "hover") return;
    pointerRef.current.pulse = 1;
    addPatina(route.key, route.cluster, source === "activate" ? 1.2 : 0.22);
    useField.getState().recordTape("sigil", source === "activate" ? 0.72 : 0.34, `home/${route.key}`);
    const now = performance.now();
    if (source !== "activate" && now - lastFeedbackRef.current < 110) return;
    lastFeedbackRef.current = now;
    try {
      const cluster = CLUSTER_BY_ID[route.cluster];
      getFieldAudio().playNote(cluster.pitch + Math.min(12, Math.max(0, route.key.length)), source === "activate" ? 110 : 64);
    } catch { /* noop */ }
    try { source === "activate" ? haptics.ripple(0.45) : haptics.tap(); } catch { /* noop */ }
  }, [addPatina]);

  const selectCluster = useCallback((cluster: SiteRouteCluster, source: "focus" | "activate" = "activate") => {
    clusterRef.current = cluster;
    setSelectedCluster(cluster);
    const first = clusterRoutes(cluster)[0];
    if (first) selectRoute(first, source);
  }, [selectRoute]);

  // Contact point → the case's own plane (z = 0). The camera is the fixed one
  // built below: perspective, fov 36, 14 units back. Both the plant and the
  // ceremony read this, so what a hand touches and what it reaches are one map.
  const worldFromClient = useCallback((clientX: number, clientY: number) => {
    const rect = sectionRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
    const halfH = Math.tan((36 / 2) * (Math.PI / 180)) * 14;
    const halfW = halfH * (rect.width / rect.height);
    return {
      x: ((clientX - rect.left) / rect.width - 0.5) * 2 * halfW,
      y: -((clientY - rect.top) / rect.height - 0.5) * 2 * halfH,
    };
  }, []);

  const emberNear = useCallback((x: number, y: number): Ember | null => {
    let best: Ember | null = null;
    let bestD = Infinity;
    for (const e of emberRef.current) {
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < 0.9 + e.weight * 0.9 && d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }, []);

  // <LetGo> handler: the case's whole-field clear. An exhale, never a
  // blink — dims the ember population away and writes the patina empty at
  // once, so an emptied case stays empty across reloads. Named `letGo` (the
  // shell's convention) rather than the old `letGoEmbers` so the room's
  // grammar reads the same in test-room-quality as it does in every other
  // room's RoomShell wiring.
  const letGo = useCallback(() => {
    emberRef.current = [];
    growingRef.current = null;
    persistLater({ ...patinaRef.current, embers: [] });
    setStanding(0);
    try { getFieldAudio().thud(); } catch { /* noop */ }
    try { haptics.roll(); } catch { /* noop */ }
  }, [persistLater]);

  // Continuous hover parallax has no classified-gesture equivalent (the
  // grammar's contacts only exist between a pointerdown and pointerup) —
  // this is the desktop "hover ≈ light touch" register from the grammar's
  // own desktop-equivalents table, not a raw gesture state machine, so it
  // stays a plain listener. The engine mount below owns every real verb.
  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    pointerRef.current.x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    pointerRef.current.y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
  };

  // gesture layer — one finger on open ground is the old surface-touch
  // pulse, now classified by the engine instead of firing on every raw
  // pointerdown. Two/three fingers add the frame and law the cabinet was
  // missing: two-finger tap steps back to the field; twist(2) rotates the
  // lens through the four route clusters; pan2 nudges the whole
  // assembly, which eases back like it's on a spring; three-finger tap
  // is tutti; three-finger drag is wind through the dust; three-finger
  // twist turns the case's season; three-finger hold dilates the
  // cabinet's own time while held. A one-finger dwell on open glass
  // gathers an ember, and a hold that reaches the ceremony tier lets one
  // go — the case's only made thing, and its only solemn act.
  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    let twistAcc = 0;
    let tuttiTimer: ReturnType<typeof setTimeout> | null = null;
    let ceremonyTarget: Ember | null = null;
    let holdOnFurniture = false;
    const trainTimers = new Set<ReturnType<typeof setTimeout>>();
    let lastStirNoteAt = 0;
    const detach = attachGestures(section, {
      tap: (e) => {
        if (document.elementFromPoint(e.x, e.y)?.closest("a, button")) return;
        if (e.fingers === 1) {
          // the rapid-tap ladder (tiers 1/3/5/n): each rung a deeper answer
          // in the case's own material — never the same tap twice in a train
          const trainTier = tapTrainTier(e.count);
          const depth = tapTrainDepth(e.count);
          pointerRef.current.pulse = Math.max(0.35, e.intensity + depth * 0.4);
          addPatina(`surface-${clusterRef.current}`, clusterRef.current, 0.08 + e.intensity * 0.2 + depth * 0.1);
          if (trainTier === "n") {
            // n taps: the crescendo — the whole case states itself, scaled
            // by how far past seven the train has run
            tuttiRef.current = Math.max(tuttiRef.current, 0.6 + depth * 0.4);
            kindleRef.current = Math.max(kindleRef.current, depth);
            try { getFieldAudio().bell(); } catch { /* noop */ }
            try { haptics.bloom(); } catch { /* noop */ }
            if (tuttiTimer) clearTimeout(tuttiTimer);
            tuttiTimer = setTimeout(() => { tuttiRef.current = 0; }, 700);
          } else if (trainTier === 5) {
            // five taps kindle the embers: every light the hand has planted
            // flares at once — the case remembering out loud
            kindleRef.current = 1;
            try { getFieldAudio().spark(); } catch { /* noop */ }
            try { haptics.ripple(0.5 + e.intensity * 0.3); } catch { /* noop */ }
          } else if (trainTier === 3) {
            // three taps ring the standing current: its gems answer as an
            // arpeggio around the ring, brightening while it runs
            ringRef.current = 1;
            const cluster = CLUSTER_BY_ID[clusterRef.current];
            const gems = ROUTES_BY_CLUSTER[clusterRef.current];
            for (let i = 0; i < Math.min(6, gems.length); i += 1) {
              const t = setTimeout(() => {
                trainTimers.delete(t);
                try { getFieldAudio().playNote(cluster.pitch + i * 2, 70); } catch { /* noop */ }
              }, i * 70);
              trainTimers.add(t);
            }
            try { haptics.ripple(0.35); } catch { /* noop */ }
          } else {
            try { haptics.tap(); } catch { /* noop */ }
            try {
              getFieldAudio().playNote(
                CLUSTER_BY_ID[clusterRef.current].pitch,
                50 + e.intensity * 90,
              );
            } catch { /* noop */ }
          }
          useField.getState().recordTape("ripple", 0.2 + e.intensity * 0.4 + depth * 0.2, `cabinet/${clusterRef.current}`);
          return;
        }
        if (e.fingers === 2) {
          // step back: the case has no camera to retreat, so it lets go of
          // whatever the hand had raised — the lens returns to the field,
          // centered, and the pan spring is released with it.
          activeKeyRef.current = "atlas";
          clusterRef.current = "field";
          panRef.current = { x: 0, y: 0 };
          setActiveKey("atlas");
          setSelectedCluster("field");
          try { haptics.tap(); } catch { /* noop */ }
          return;
        }
        if (e.fingers >= 3) {
          // tutti — every gem, the dust and the core answer at once, by
          // exactly how hard the three fingers landed
          tuttiRef.current = Math.max(0.4, e.intensity);
          pointerRef.current.pulse = 1;
          try { haptics.ripple(0.25 + e.intensity * 0.45); } catch { /* noop */ }
          try { getFieldAudio().chime(); } catch { /* noop */ }
          addPatina("tutti", clusterRef.current, 0.12);
          if (tuttiTimer) clearTimeout(tuttiTimer);
          tuttiTimer = setTimeout(() => { tuttiRef.current = 0; }, 700);
        }
      },
      twist: (e) => {
        if (e.phase !== "move") return;
        if (e.fingers === 3) {
          // the case's season: the light walks from warm to cold and back,
          // continuously with the angle turned, never in steps
          seasonRef.current = (seasonRef.current + e.angle / (Math.PI * 2) + 1) % 1;
          return;
        }
        twistAcc += e.angle;
        const step = Math.PI / 2;
        while (Math.abs(twistAcc) >= step) {
          const direction = twistAcc > 0 ? 1 : -1;
          twistAcc -= direction * step;
          const idx = CLUSTER_INDEX_BY_ID[clusterRef.current];
          const nextCluster = CLUSTERS[(idx + direction + CLUSTERS.length) % CLUSTERS.length].id;
          selectCluster(nextCluster, "focus");
          try { haptics.lens(); } catch { /* noop */ }
        }
      },
      pan2: (e) => {
        if (e.phase === "end") return;
        panRef.current = {
          x: Math.max(-1, Math.min(1, panRef.current.x + e.dx * 0.0025)),
          y: Math.max(-1, Math.min(1, panRef.current.y + e.dy * 0.0025)),
        };
      },
      drag: (e) => {
        if (e.fingers !== 3) return;
        gustRef.current = Math.max(-1, Math.min(1, gustRef.current + e.dx * 0.01));
      },
      scrub: (e) => {
        // a circling hand stirs the dust: the drift follows the circle's own
        // speed and direction, and the motes brighten while they are stirred
        gustRef.current = Math.max(-3, Math.min(3, gustRef.current + Math.max(-6, Math.min(6, e.angularVelocity)) * 0.16));
        agitationRef.current = Math.min(1, agitationRef.current + Math.min(0.4, Math.abs(e.angularVelocity) * 0.05));
        const now = performance.now();
        if (now - lastStirNoteAt > 600) {
          lastStirNoteAt = now;
          try {
            getFieldAudio().playNote(
              CLUSTER_BY_ID[clusterRef.current].pitch - 7 + Math.round(Math.min(5, Math.abs(e.winding)) * 2),
              120,
            );
          } catch { /* noop */ }
          try { haptics.ripple(0.25); } catch { /* noop */ }
        }
      },
      span: (e) => {
        // two still fingers hold the case's chord open: the glass and the
        // core brighten for as long as the interval is sustained — deeper at
        // 2400ms than at 900ms, always — and the spread tunes its voice
        if (e.phase === "enter") {
          spanRef.current = 0.2;
          try { getFieldAudio().playNote(CLUSTER_BY_ID[clusterRef.current].pitch - 12, 260); } catch { /* noop */ }
          try { haptics.tap(); } catch { /* noop */ }
          return;
        }
        if (e.phase === "tick") {
          spanRef.current = 0.2 + 0.8 * (1 - Math.exp(-e.elapsed / 1600));
          pointerRef.current.pulse = Math.max(pointerRef.current.pulse, spanRef.current * 0.5);
          return;
        }
        // release: the chord resolves, weighted by how long it was held and
        // how wide the hand had it open
        const held = Math.min(1, e.elapsed / 4000);
        try {
          getFieldAudio().playNote(
            CLUSTER_BY_ID[clusterRef.current].pitch - 12 + Math.round(Math.min(12, e.spread / 40)),
            140 + held * 160,
          );
        } catch { /* noop */ }
        try { haptics.ripple(0.2 + held * 0.4); } catch { /* noop */ }
        spanRef.current = 0;
      },
      hold: (e) => {
        if (e.fingers >= 3) {
          if (e.phase === "release") { timeScaleRef.current = 1; return; }
          timeScaleRef.current = e.phase === "enter"
            ? 1
            : Math.max(0.2, 1 - Math.min(1, e.elapsed / THRESHOLDS.ceremonyMs) * 0.8);
          return;
        }
        if (e.fingers !== 1) return;

        if (e.phase === "enter") {
          // a hold that begins on the furniture belongs to the furniture; the
          // check lives here alone so a release still lands whatever it lands on
          if (document.elementFromPoint(e.x, e.y)?.closest("a, button")) {
            ceremonyTarget = null;
            growingRef.current = null;
            holdOnFurniture = true;
            return;
          }
          holdOnFurniture = false;
          const at = worldFromClient(e.x, e.y);
          ceremonyTarget = emberNear(at.x, at.y);
          growingRef.current = null;
          return;
        }
        if (holdOnFurniture && e.phase !== "release") return;

        if (e.phase === "release") {
          if (growingRef.current) commitEmbers();
          growingRef.current = null;
          ceremonyTarget = null;
          holdOnFurniture = false;
          return;
        }

        // ceremony (tier >= 3): the hold that began on an ember lets it go —
        // the case's one solemn act, and the delete a thumb can reach.
        if (e.tier >= 3 && ceremonyTarget) {
          const gone = ceremonyTarget;
          ceremonyTarget = null;
          emberRef.current = emberRef.current.filter((x) => x !== gone);
          commitEmbers();
          tuttiRef.current = Math.max(tuttiRef.current, 0.5);
          try { haptics.bloom(); } catch { /* noop */ }
          try { getFieldAudio().thud(); } catch { /* noop */ }
          return;
        }
        if (ceremonyTarget) {
          // while the ceremony gathers, the ember it is about to release
          // brightens — the act is legible before it lands
          ceremonyTarget.weight = Math.min(
            1,
            ceremonyTarget.weight + Math.min(1, e.elapsed / THRESHOLDS.ceremonyMs) * 0.02,
          );
          return;
        }

        // dwell (tier >= 2): an ember gathers under the finger from the moment
        // the tier is crossed, and keeps deepening for as long as the hand
        // stays — never the same thing at 900ms and at 2400ms.
        if (e.tier >= 2) {
          if (!growingRef.current) {
            const at = worldFromClient(e.x, e.y);
            if (emberRef.current.length >= EMBER_CAP) emberRef.current.shift();
            const born: Ember = {
              x: at.x,
              y: at.y,
              weight: 0,
              current: CLUSTER_INDEX_BY_ID[clusterRef.current],
            };
            emberRef.current = [...emberRef.current, born];
            growingRef.current = born;
            setStanding(emberRef.current.length);
            try { haptics.ripple(0.35); } catch { /* noop */ }
            try { getFieldAudio().spark(); } catch { /* noop */ }
          }
          const at = worldFromClient(e.x, e.y);
          growingRef.current.x = at.x;
          growingRef.current.y = at.y;
          growingRef.current.weight = 1 - Math.exp(-e.elapsed / 1800);
          pointerRef.current.pulse = Math.max(pointerRef.current.pulse, growingRef.current.weight);
        }
      },
    }, { wheelZoom: false, manageStyle: false, noCapture: true });

    const releaseHold = () => { timeScaleRef.current = 1; };
    section.addEventListener("pointerup", releaseHold);
    section.addEventListener("pointercancel", releaseHold);

    // vessel: tilt leans the whole assembly beyond the hover parallax,
    // shake agitates the dust field, a knock is tutti, and face-down is
    // night — the lights ease down until the phone turns back over.
    const detachVessel = onVessel({
      tilt: ({ beta, gamma }) => {
        tiltRef.current = {
          x: Math.max(-1, Math.min(1, gamma / 45)),
          y: Math.max(-1, Math.min(1, beta / 45)),
        };
      },
      shake: ({ intensity }) => {
        agitationRef.current = Math.min(1, agitationRef.current + intensity);
        try { haptics.chop(); } catch { /* noop */ }
      },
      knock: ({ intensity }) => {
        // a rap on the case rings it by exactly how hard the case was struck
        tuttiRef.current = 0.6 + Math.min(1, intensity) * 0.4;
        try { getFieldAudio().bell(); } catch { /* noop */ }
        try { haptics.ripple(0.3 + Math.min(1, intensity) * 0.5); } catch { /* noop */ }
        if (tuttiTimer) clearTimeout(tuttiTimer);
        tuttiTimer = setTimeout(() => { tuttiRef.current = 0; }, 700);
      },
      flip: ({ faceDown }) => {
        nightRef.current = faceDown ? 1 : 0;
        setNight(faceDown);
      },
    });

    return () => {
      detach();
      detachVessel();
      section.removeEventListener("pointerup", releaseHold);
      section.removeEventListener("pointercancel", releaseHold);
      if (tuttiTimer) clearTimeout(tuttiTimer);
      trainTimers.forEach((t) => clearTimeout(t));
    };
  }, [addPatina, selectCluster, commitEmbers, emberNear, worldFromClient]);

  useEffect(() => {
    const host = stageRef.current;
    if (!host) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduce = reduceMotion.matches;
    const updateReduce = () => { reduce = reduceMotion.matches; };
    reduceMotion.addEventListener?.("change", updateReduce);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.setAttribute("aria-hidden", "true");
    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.inset = "0";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.pointerEvents = "none";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
    camera.position.set(0, 0, 14);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.03);
    room.dispose();
    scene.environment = env.texture;

    const root = new THREE.Group();
    scene.add(root);

    const gold = new THREE.MeshPhysicalMaterial({
      color: 0xd8a94a,
      metalness: 1,
      roughness: 0.22,
      clearcoat: 0.7,
      clearcoatRoughness: 0.16,
      emissive: 0x2a1702,
      emissiveIntensity: 0.12,
    });
    const darkGold = new THREE.MeshStandardMaterial({
      color: 0x7c5a1e,
      metalness: 1,
      roughness: 0.28,
      emissive: 0x110802,
      emissiveIntensity: 0.1,
    });
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0x9ee4e0,
      metalness: 0,
      roughness: 0.06,
      transmission: 0.46,
      thickness: 0.9,
      ior: 1.45,
      transparent: true,
      opacity: 0.72,
      emissive: 0x113a3c,
      emissiveIntensity: 0.28,
    });
    const candle = new THREE.MeshStandardMaterial({
      color: 0xffd681,
      metalness: 0.35,
      roughness: 0.18,
      emissive: 0x8c4a05,
      emissiveIntensity: 0.4,
    });

    const mainRing = new THREE.Mesh(new THREE.TorusGeometry(4.5, 0.08, 16, 220), gold);
    root.add(mainRing);
    const crossRing = new THREE.Mesh(new THREE.TorusGeometry(3.15, 0.045, 12, 180), darkGold);
    crossRing.rotation.x = Math.PI / 2;
    root.add(crossRing);
    const tiltedRing = new THREE.Mesh(new THREE.TorusGeometry(3.75, 0.04, 12, 180), gold);
    tiltedRing.rotation.set(Math.PI / 2.9, 0.22, 0.1);
    root.add(tiltedRing);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(1.12, 64, 32), glass);
    root.add(lens);
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.46, 2), candle);
    root.add(core);

    const rodMaterial = new THREE.LineBasicMaterial({ color: 0xdfc06a, transparent: true, opacity: 0.28 });
    const routeGemGeometry = new THREE.IcosahedronGeometry(0.18, 1);
    const routeGems = SITE_ROUTES.map((route, index) => {
      const angle = routeAngle(route, index);
      const cluster = CLUSTER_BY_ID[route.cluster];
      const material = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(cluster.color),
        metalness: 0.08,
        roughness: 0.12,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
        emissive: new THREE.Color(cluster.color),
        emissiveIntensity: route.homePriority ? 0.22 : 0.08,
      });
      const radius = route.homePriority ? 4.2 : 4.75;
      const z = route.homePriority ? 0.34 : -0.12;
      const mesh = new THREE.Mesh(routeGemGeometry, material);
      mesh.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.78, z);
      mesh.scale.setScalar(route.homePriority ? 1.2 : 0.9);
      root.add(mesh);

      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, -0.02),
          new THREE.Vector3(mesh.position.x, mesh.position.y, -0.02),
        ]),
        rodMaterial,
      );
      root.add(line);
      return { route, mesh, material, line, baseScale: route.homePriority ? 1.2 : 0.9, angle };
    });

    const dustCount = 540;
    const dustPositions = new Float32Array(dustCount * 3);
    const dustColors = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i += 1) {
      const a = i * 12.9898;
      const r = 5.2 + ((Math.sin(a) * 43758.5453) % 1 + 1) % 1 * 3.8;
      const theta = ((Math.sin(a * 1.7) * 43758.5453) % 1 + 1) % 1 * Math.PI * 2;
      dustPositions[i * 3] = Math.cos(theta) * r;
      dustPositions[i * 3 + 1] = Math.sin(theta) * r * 0.62;
      dustPositions[i * 3 + 2] = -1.6 + (((Math.sin(a * 2.3) * 9999) % 1 + 1) % 1) * 2.6;
      const cluster = CLUSTERS[i % CLUSTERS.length];
      const color = new THREE.Color(cluster.color).lerp(new THREE.Color(0xfff2bf), 0.35);
      dustColors[i * 3] = color.r;
      dustColors[i * 3 + 1] = color.g;
      dustColors[i * 3 + 2] = color.b;
    }
    const dust = new THREE.Points(
      new THREE.BufferGeometry()
        .setAttribute("position", new THREE.BufferAttribute(dustPositions, 3))
        .setAttribute("color", new THREE.BufferAttribute(dustColors, 3)),
      new THREE.PointsMaterial({
        size: 0.036,
        vertexColors: true,
        transparent: true,
        opacity: 0.56,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    scene.add(dust);

    // The embers: one Points object for the whole population, its typed arrays
    // allocated once at capacity and rewritten in place. Nothing about the
    // population is O(history) and nothing is a second draw call.
    const emberPositions = new Float32Array(EMBER_CAP * 3);
    const emberColors = new Float32Array(EMBER_CAP * 3);
    const emberGeometry = new THREE.BufferGeometry()
      .setAttribute("position", new THREE.BufferAttribute(emberPositions, 3))
      .setAttribute("color", new THREE.BufferAttribute(emberColors, 3));
    emberGeometry.setDrawRange(0, 0);
    const emberMaterial = new THREE.PointsMaterial({
      size: 0.34,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const embers = new THREE.Points(emberGeometry, emberMaterial);
    root.add(embers);
    const emberTint = new THREE.Color();
    const emberWarm = new THREE.Color(0xfff2bf);

    const key = new THREE.DirectionalLight(0xfff0c4, 3.2);
    key.position.set(3, 4, 6);
    scene.add(key);
    const sea = new THREE.PointLight(0x68d8d0, 2.4, 22);
    sea.position.set(-4, -2, 4);
    scene.add(sea);
    const rose = new THREE.PointLight(0xd7b4ff, 1.7, 18);
    rose.position.set(4, 1.8, 5);
    scene.add(rose);

    // Performance contract: a quality tier from real frame time, an
    // explicit DPR ceiling (2 on embedded/mobile, 2 otherwise — matching
    // the room's prior clamp exactly at "high"), and a hard sleep while
    // the tab is hidden. No allocation happens inside tick() below.
    const gov = createFrameGovernor();
    let sleeping = false;
    const offVisibility = onVisibility((hidden) => { sleeping = hidden; });
    const embedded = isEmbeddedFrame();

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      const dpr = resolveDpr(gov.tier(), { embedded, reducedMotion: reduce, maxDpr: 2 });
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    let raf = 0;
    let last = performance.now();
    let glowEase = patinaRef.current.glow;
    let rotX = 0;
    let rotY = 0;
    let panX = 0;
    let panY = 0;
    let simTime = 0;
    let lastTier = gov.tier();
    const tick = (now: number) => {
      const tier = gov.beginFrame(now);
      if (tier !== lastTier) { lastTier = tier; resize(); }
      const dtReal = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (sleeping) { raf = requestAnimationFrame(tick); return; } // no draw while hidden

      // three-finger hold dilates the cabinet's own time, eased so it
      // never snaps; every periodic term below reads simTime, not the
      // wall clock, so the whole assembly genuinely slows.
      const timeScale = timeScaleRef.current;
      const dt = dtReal * timeScale;
      simTime += dt;
      const t = simTime;
      const motion = reduce ? 0 : 1;
      const pointer = pointerRef.current;
      pointer.pulse *= 0.92;
      const tutti = tuttiRef.current;
      tuttiRef.current *= 0.9;
      // the tap ladder's lights and the span's sustain, decayed here so the
      // answers ease out instead of switching off
      const ring = ringRef.current;
      ringRef.current *= 0.94;
      const kindle = kindleRef.current;
      kindleRef.current *= 0.95;
      const span = spanRef.current;
      const agitation = agitationRef.current;
      agitationRef.current *= 0.94;
      const nightLevel = nightRef.current;
      glowEase += (patinaRef.current.glow - glowEase) * 0.035;
      const level = 1 - Math.exp(-glowEase * 0.055);

      // pan2 eases the whole assembly off-center, then springs back —
      // a grabbed pan, not a permanent camera move.
      panX += (panRef.current.x * 1.1 - panX) * 0.08;
      panY += (panRef.current.y * 0.9 - panY) * 0.08;
      panRef.current.x *= 0.9;
      panRef.current.y *= 0.9;
      root.position.x = panX;
      root.position.y = -panY;

      const tilt = tiltRef.current;
      rotY += (pointer.x * 0.26 + tilt.x * 0.22 - rotY) * 0.06;
      rotX += (-pointer.y * 0.16 - tilt.y * 0.16 - rotX) * 0.06;
      root.rotation.y = rotY + Math.sin(t * 0.16) * 0.05 * motion;
      root.rotation.x = rotX + Math.cos(t * 0.19) * 0.035 * motion;
      mainRing.rotation.z = t * 0.035 * motion;
      crossRing.rotation.z = -t * 0.06 * motion;
      tiltedRing.rotation.z = t * 0.044 * motion;
      lens.scale.setScalar(1 + Math.sin(t * 1.2) * 0.018 * motion + pointer.pulse * 0.04 + tutti * 0.06 + span * 0.05);
      core.rotation.y = t * 0.5 * motion;
      core.rotation.z = -t * 0.36 * motion;
      (candle as THREE.MeshStandardMaterial).emissiveIntensity =
        (0.35 + pointer.pulse * 0.8 + level * 0.3 + tutti * 0.5 + span * 0.4) * (1 - nightLevel * 0.7);
      (glass as THREE.MeshPhysicalMaterial).emissiveIntensity = 0.22 + pointer.pulse * 0.18 + level * 0.22 + span * 0.25;

      const active = activeKeyRef.current;
      const cluster = clusterRef.current;
      routeGems.forEach(({ route, mesh, material, baseScale, angle }) => {
        const isActive = route.key === active;
        const isCluster = route.cluster === cluster;
        const targetScale = baseScale * (isActive ? 1.68 : isCluster ? 1.16 : 0.88);
        mesh.scale.setScalar(mesh.scale.x + (targetScale - mesh.scale.x) * 0.12);
        mesh.rotation.x += dt * (0.9 + baseScale) * motion;
        mesh.rotation.y += dt * 0.8 * motion;
        mesh.position.z = (route.homePriority ? 0.34 : -0.12) + Math.sin(t * 0.9 + angle * 3) * 0.08 * motion + (isActive ? 0.26 : 0);
        material.emissiveIntensity =
          ((isActive ? 0.84 : isCluster ? 0.34 : 0.08) + pointer.pulse * 0.12 + level * 0.18 + tutti * 0.4 + (isCluster ? ring * 0.5 : 0))
          * (1 - nightLevel * 0.6);
      });
      // three-finger drag = wind: a gust speeds or reverses the dust
      // drift for as long as it's pushed, decaying back to the ambient
      // rate; shake agitates the same field in its own material.
      dust.rotation.z = (-t * 0.015 + gustRef.current * 0.02) * motion;
      gustRef.current *= 0.9;
      (dust.material as THREE.PointsMaterial).opacity =
        (0.34 + level * 0.24 + pointer.pulse * 0.16 + agitation * 0.3) * detailForTier(tier).particles;
      // the embers: written in place, one draw, drawRange sized to the living
      // population — O(visible), never O(history)
      const list = emberRef.current;
      const shown = Math.min(EMBER_CAP, list.length);
      const growingNow = growingRef.current;
      for (let i = 0; i < shown; i += 1) {
        const e = list[i];
        const lift = Math.sin(t * 0.7 + e.x * 0.9 + e.y * 0.6) * 0.16 * motion;
        emberPositions[i * 3] = e.x;
        emberPositions[i * 3 + 1] = e.y + lift;
        emberPositions[i * 3 + 2] = 0.55 + e.weight * 0.5;
        emberTint.set(CLUSTERS[e.current].color).lerp(emberWarm, 0.2 + e.weight * 0.5);
        // the one under the finger burns brightest, so a plant is legible
        // from the instant the dwell tier is crossed
        const heat =
          (0.32 + e.weight * 0.85 + tutti * 0.5 + kindle * 0.8 + (e === growingNow ? 0.7 : 0)) *
          (1 - nightLevel * 0.65);
        emberColors[i * 3] = emberTint.r * heat;
        emberColors[i * 3 + 1] = emberTint.g * heat;
        emberColors[i * 3 + 2] = emberTint.b * heat;
      }
      emberGeometry.setDrawRange(0, shown);
      emberGeometry.attributes.position.needsUpdate = true;
      emberGeometry.attributes.color.needsUpdate = true;
      emberMaterial.size = 0.3 * detailForTier(tier).particles + 0.12;

      // the season: the case's own slow cycle, warm to cold and back, turned
      // by the three-finger twist and read here as light temperature
      const season = seasonRef.current;
      const warmth = 0.5 + Math.cos(season * Math.PI * 2) * 0.5;
      sea.intensity =
        (1.7 + level * 1.2 + pointer.pulse * 0.8 + tutti * 0.6) *
        (0.55 + (1 - warmth) * 0.9) *
        (1 - nightLevel * 0.55);
      rose.intensity = (1.1 + level * 1.0 + agitation * 0.4) * (1 - nightLevel * 0.55);
      key.intensity = 3.2 * (0.6 + warmth * 0.7) * (1 - nightLevel * 0.5);

      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    (window as unknown as Record<string, unknown>).__homeCabinet = {
      ready: true,
      selectRoute: (key: string) => {
        const route = SITE_ROUTE_BY_KEY[key];
        if (route) {
          activeKeyRef.current = route.key;
          clusterRef.current = route.cluster;
          setActiveKey(route.key);
          setSelectedCluster(route.cluster);
        }
      },
      setCluster: (cluster: SiteRouteCluster) => {
        if (CLUSTER_BY_ID[cluster]) {
          clusterRef.current = cluster;
          setSelectedCluster(cluster);
        }
      },
    };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      offVisibility();
      reduceMotion.removeEventListener?.("change", updateReduce);
      delete (window as unknown as Record<string, unknown>).__homeCabinet;
      routeGems.forEach(({ material, line }) => {
        material.dispose();
        line.geometry.dispose();
      });
      routeGemGeometry.dispose();
      rodMaterial.dispose();
      mainRing.geometry.dispose();
      crossRing.geometry.dispose();
      tiltedRing.geometry.dispose();
      lens.geometry.dispose();
      core.geometry.dispose();
      gold.dispose();
      darkGold.dispose();
      glass.dispose();
      candle.dispose();
      dust.geometry.dispose();
      (dust.material as THREE.PointsMaterial).dispose();
      emberGeometry.dispose();
      emberMaterial.dispose();
      renderer.dispose();
      env.dispose();
      pmrem.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <section
      id="cabinet"
      ref={sectionRef}
      className={"home-cabinet" + (night ? " is-night" : "")}
      data-touch-surface="true"
      data-pretext-ignore="true"
      onPointerMove={onPointerMove}
      style={{
        ["--active-color" as string]: activeCluster.color,
        ["--active-glow" as string]: activeCluster.glow,
      }}
    >
      <div className="home-cabinet__scene" ref={stageRef} aria-hidden="true" />

      <div className="home-cabinet__grain" aria-hidden="true" />

      <div className="home-cabinet__title">
        <p className="t-eyebrow">home instrument</p>
        <h1>Cabinet of Currents</h1>
        <p className="home-cabinet__route-line">
          <span>{activeLabel}</span>
          <span>{activeDesc}</span>
        </p>
      </div>

      <div className="home-cabinet__lens" aria-label={`current field, strongest at ${topConcern}`}>
        <ConcernSigil
          concerns={concerns}
          size={150}
          showAxes
          showDots
          stroke="rgba(255,242,191,0.94)"
          fill="rgba(105,216,208,0.10)"
        />
        <div className="home-cabinet__lens-meta">
          <span>{topConcern}</span>
          <span>{keptReadings.length ? `${keptReadings.length} kept` : `${Math.round(patina.glow)} glow`}</span>
        </div>
      </div>

      <div className="home-cabinet__local" aria-label="the case's own doors">
        {LOCAL_ENTRIES.map((entry) => (
          <Link
            key={entry.key}
            href={entry.href}
            aria-label={`${entry.label}: ${entry.desc}`}
            onFocus={() => {
              activeKeyRef.current = entry.key;
              setActiveKey(entry.key);
              setSelectedCluster("field");
              clusterRef.current = "field";
            }}
          >
            <RouteSigil kind={entry.icon} size={18} />
            <span>{entry.label}</span>
          </Link>
        ))}
      </div>

      <div className="home-cabinet__clusters" aria-label="route currents">
        {CLUSTERS.map((cluster) => (
          <button
            key={cluster.id}
            type="button"
            className={selectedCluster === cluster.id ? "is-active" : ""}
            style={{ ["--cluster-color" as string]: cluster.color }}
            aria-pressed={selectedCluster === cluster.id}
            onClick={() => selectCluster(cluster.id, "activate")}
            onFocus={() => selectCluster(cluster.id, "focus")}
          >
            <span>{cluster.label}</span>
            <small>{cluster.desc}</small>
          </button>
        ))}
      </div>

      <nav className="home-cabinet__ring" aria-label="route constellation">
        {SITE_ROUTES.map((route, index) => (
          <Link
            key={route.key}
            href={route.href}
            className={`home-cabinet__hotspot${activeKey === route.key ? " is-active" : ""}${selectedCluster === route.cluster ? " is-cluster" : ""}`}
            style={{
              ...hotspotStyle(route, index),
              ["--route-color" as string]: CLUSTER_BY_ID[route.cluster].color,
            }}
            aria-label={`${route.key}: ${route.desc}`}
            onMouseEnter={() => selectRoute(route)}
            onFocus={() => selectRoute(route, "focus")}
            onClick={() => selectRoute(route, "activate")}
          >
            <RouteSigil kind={route.icon} size={18} />
            <span>{route.key}</span>
          </Link>
        ))}
      </nav>

      <nav className="home-cabinet__drawer" aria-label={`${activeCluster.label} routes`}>
        {routesInCluster.map((route) => (
          <Link
            key={route.key}
            href={route.href}
            className={activeKey === route.key ? "is-active" : ""}
            onMouseEnter={() => selectRoute(route)}
            onFocus={() => selectRoute(route, "focus")}
            onClick={() => selectRoute(route, "activate")}
          >
            <RouteSigil kind={route.icon} size={17} />
            <span>{route.key}</span>
          </Link>
        ))}
      </nav>

      <div className="home-cabinet__edge" aria-hidden="true">
        <span />
      </div>

      <LetGo label="let the embers go" onLetGo={letGo} visible={standing > 0} />

      <style>{`
        .home-cabinet {
          position: relative;
          min-height: calc(100svh - 152px);
          padding: 0;
          overflow: hidden;
          isolation: isolate;
          color: rgba(255, 244, 207, 0.94);
          background:
            radial-gradient(circle at 50% 44%, var(--active-glow), transparent 31%),
            radial-gradient(circle at 22% 20%, rgba(105,216,208,0.16), transparent 28%),
            radial-gradient(circle at 78% 18%, rgba(231,185,78,0.14), transparent 30%),
            linear-gradient(180deg, #060b12 0%, #0b1720 54%, #132532 100%);
          touch-action: pan-y;
        }
        .home-cabinet__scene {
          position: absolute;
          inset: 0;
          z-index: 0;
        }
        .home-cabinet__grain {
          position: absolute;
          inset: 0;
          z-index: 1;
          pointer-events: none;
          background:
            linear-gradient(180deg, rgba(255,244,207,0.04), transparent 22%, rgba(2,7,12,0.22)),
            repeating-linear-gradient(92deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 5px);
          mix-blend-mode: screen;
          opacity: 0.56;
        }
        .home-cabinet__title {
          position: relative;
          z-index: 3;
          width: min(560px, calc(100vw - var(--pad-x) * 2));
          padding: clamp(38px, 8vh, 78px) var(--pad-x) 0;
          pointer-events: none;
        }
        .home-cabinet__title .t-eyebrow {
          color: rgba(255,244,207,0.58);
          letter-spacing: 0;
          margin: 0 0 12px;
        }
        .home-cabinet__title h1 {
          margin: 0;
          font-family: var(--font-serif);
          font-size: clamp(46px, 8vw, 102px);
          line-height: 0.92;
          font-weight: 300;
          letter-spacing: 0;
          text-wrap: balance;
          text-shadow: 0 20px 70px rgba(0,0,0,0.58);
        }
        .home-cabinet__route-line {
          display: flex;
          flex-wrap: wrap;
          gap: 8px 14px;
          margin: 20px 0 0;
          font-family: var(--font-text);
          font-size: 12px;
          letter-spacing: 0;
          text-transform: lowercase;
          color: rgba(255,244,207,0.62);
        }
        .home-cabinet__route-line span:first-child {
          color: var(--active-color);
        }
        .home-cabinet__lens {
          position: absolute;
          z-index: 4;
          left: 50%;
          top: 50%;
          width: 184px;
          min-height: 214px;
          transform: translate(-50%, -50%);
          display: grid;
          place-items: center;
          pointer-events: none;
          filter: drop-shadow(0 18px 46px rgba(0,0,0,0.4));
        }
        .home-cabinet__lens-meta {
          display: flex;
          gap: 12px;
          justify-content: center;
          margin-top: -8px;
          font-family: var(--font-text);
          font-size: 11px;
          letter-spacing: 0;
          text-transform: lowercase;
          color: rgba(255,244,207,0.68);
        }
        .home-cabinet__lens-meta span:first-child {
          color: var(--active-color);
        }
        .home-cabinet__local,
        .home-cabinet__clusters,
        .home-cabinet__drawer {
          position: absolute;
          z-index: 5;
          pointer-events: auto;
        }
        .home-cabinet__local {
          left: var(--pad-x);
          bottom: calc(68px + env(safe-area-inset-bottom, 0px));
          display: grid;
          grid-template-columns: repeat(4, minmax(78px, 1fr));
          gap: 8px;
          width: min(560px, calc(100vw - var(--pad-x) * 2));
        }
        .home-cabinet__local a,
        .home-cabinet__clusters button,
        .home-cabinet__drawer a,
        .home-cabinet__hotspot {
          min-height: 44px;
          color: rgba(255,244,207,0.88);
          font-family: var(--font-text);
          letter-spacing: 0;
          text-transform: lowercase;
          cursor: pointer;
        }
        .home-cabinet__local a {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border: 1px solid rgba(255,244,207,0.18);
          border-radius: 8px;
          background: rgba(5, 10, 16, 0.48);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          font-size: 12px;
          transition: border-color var(--t), color var(--t), background var(--t), transform var(--t);
        }
        .home-cabinet__local a:hover,
        .home-cabinet__local a:focus-visible {
          border-color: var(--active-color);
          color: #fff6da;
          background: rgba(255,244,207,0.08);
          transform: translateY(-1px);
        }
        .home-cabinet__clusters {
          right: var(--pad-x);
          top: clamp(86px, 15vh, 146px);
          display: grid;
          gap: 8px;
          width: min(244px, 28vw);
        }
        .home-cabinet__clusters button {
          min-width: 0;
          display: grid;
          gap: 3px;
          text-align: left;
          border: 1px solid rgba(255,244,207,0.14);
          border-radius: 8px;
          background: rgba(5, 10, 16, 0.42);
          padding: 10px 12px;
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          transition: border-color var(--t), color var(--t), background var(--t);
        }
        .home-cabinet__clusters button span {
          color: rgba(255,244,207,0.92);
          font-size: 12px;
        }
        .home-cabinet__clusters button small {
          color: rgba(255,244,207,0.48);
          font-size: 10px;
          line-height: 1.25;
        }
        .home-cabinet__clusters button:hover,
        .home-cabinet__clusters button:focus-visible,
        .home-cabinet__clusters button.is-active {
          border-color: var(--cluster-color);
          background: rgba(255,244,207,0.07);
        }
        .home-cabinet__clusters button.is-active span {
          color: var(--cluster-color);
        }
        .home-cabinet__ring {
          position: absolute;
          inset: 0;
          z-index: 4;
          pointer-events: none;
        }
        .home-cabinet__hotspot {
          position: absolute;
          width: 50px;
          height: 50px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          border: 1px solid rgba(255,244,207,0.12);
          background: rgba(5, 10, 16, 0.12);
          color: rgba(255,244,207,0.36);
          transform: translate(-50%, -50%);
          pointer-events: auto;
          transition: color var(--t), border-color var(--t), background var(--t), transform var(--t), opacity var(--t);
          opacity: 0.66;
        }
        .home-cabinet__hotspot span {
          position: absolute;
          left: 50%;
          top: calc(100% + 5px);
          transform: translateX(-50%);
          opacity: 0;
          padding: 4px 7px;
          border-radius: 6px;
          background: rgba(5,10,16,0.74);
          border: 1px solid rgba(255,244,207,0.12);
          color: rgba(255,244,207,0.8);
          font-size: 10px;
          white-space: nowrap;
          transition: opacity var(--t);
        }
        .home-cabinet__hotspot.is-cluster {
          color: var(--route-color);
          border-color: color-mix(in srgb, var(--route-color) 46%, transparent);
          opacity: 0.94;
        }
        .home-cabinet__hotspot:hover,
        .home-cabinet__hotspot:focus-visible,
        .home-cabinet__hotspot.is-active {
          color: #fff6da;
          border-color: var(--route-color);
          background: rgba(255,244,207,0.08);
          transform: translate(-50%, -50%) scale(1.12);
          opacity: 1;
        }
        .home-cabinet__hotspot:hover span,
        .home-cabinet__hotspot:focus-visible span,
        .home-cabinet__hotspot.is-active span {
          opacity: 1;
        }
        .home-cabinet__drawer {
          right: calc(var(--pad-x) + 300px);
          bottom: calc(68px + env(safe-area-inset-bottom, 0px));
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 7px;
          width: min(500px, calc(100vw - var(--pad-x) * 2 - 340px));
        }
        .home-cabinet__drawer a {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          min-width: 82px;
          padding: 0 10px;
          border: 1px solid rgba(255,244,207,0.14);
          border-radius: 8px;
          background: rgba(5, 10, 16, 0.38);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          font-size: 11px;
          transition: border-color var(--t), color var(--t), background var(--t);
        }
        .home-cabinet__drawer a:hover,
        .home-cabinet__drawer a:focus-visible,
        .home-cabinet__drawer a.is-active {
          color: #fff6da;
          border-color: var(--active-color);
          background: rgba(255,244,207,0.08);
        }
        .home-cabinet__edge {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 2;
          height: 54px;
          pointer-events: none;
          background: linear-gradient(180deg, transparent, rgba(242,238,230,0.08));
        }
        .home-cabinet__edge span {
          position: absolute;
          left: 50%;
          bottom: 14px;
          width: 42px;
          height: 1px;
          transform: translateX(-50%);
          background: rgba(255,244,207,0.34);
        }
        @media (max-width: 980px) {
          .home-cabinet {
            min-height: calc(100svh - 140px);
          }
          .home-cabinet__title {
            width: min(680px, calc(100vw - 28px));
            padding: 28px 14px 0;
          }
          .home-cabinet__title h1 {
            font-size: clamp(42px, 13vw, 72px);
            max-width: 9ch;
          }
          .home-cabinet__ring {
            display: none;
          }
          .home-cabinet__clusters {
            left: 14px;
            right: 14px;
            top: auto;
            bottom: calc(180px + env(safe-area-inset-bottom, 0px));
            width: auto;
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
          .home-cabinet__clusters button {
            min-height: 50px;
            text-align: center;
            padding: 8px 6px;
          }
          .home-cabinet__clusters button small {
            display: none;
          }
          .home-cabinet__drawer {
            left: 14px;
            right: 14px;
            bottom: calc(112px + env(safe-area-inset-bottom, 0px));
            width: auto;
            justify-content: flex-start;
            overflow-x: auto;
            flex-wrap: nowrap;
            padding-bottom: 3px;
            overscroll-behavior-x: contain;
            -webkit-overflow-scrolling: touch;
          }
          .home-cabinet__drawer a {
            flex: 0 0 auto;
          }
          .home-cabinet__local {
            left: 14px;
            right: 14px;
            bottom: calc(50px + env(safe-area-inset-bottom, 0px));
            width: auto;
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
          .home-cabinet__local a {
            padding: 0 6px;
            font-size: 11px;
          }
          .home-cabinet__lens {
            width: 156px;
            min-height: 180px;
            transform: translate(-50%, -40%);
          }
          .home-cabinet__lens svg {
            width: 124px;
            height: 124px;
          }
        }
        @media (max-width: 560px) {
          .home-cabinet__route-line {
            max-width: 31ch;
          }
          .home-cabinet__local a span {
            display: none;
          }
          .home-cabinet__local a {
            min-width: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .home-cabinet__local a,
          .home-cabinet__clusters button,
          .home-cabinet__drawer a,
          .home-cabinet__hotspot {
            transition: none;
          }
        }
        /* flip face-down — night, until the phone turns back over. The
           WebGL lights ease down inside tick(); this dims the DOM
           furniture around them the same way. */
        .home-cabinet.is-night .home-cabinet__title,
        .home-cabinet.is-night .home-cabinet__lens,
        .home-cabinet.is-night .home-cabinet__local,
        .home-cabinet.is-night .home-cabinet__clusters,
        .home-cabinet.is-night .home-cabinet__drawer,
        .home-cabinet.is-night .home-cabinet__ring {
          opacity: 0.5;
          transition: opacity 900ms ease;
        }
        @media (prefers-reduced-motion: reduce) {
          .home-cabinet.is-night .home-cabinet__title,
          .home-cabinet.is-night .home-cabinet__lens,
          .home-cabinet.is-night .home-cabinet__local,
          .home-cabinet.is-night .home-cabinet__clusters,
          .home-cabinet.is-night .home-cabinet__drawer,
          .home-cabinet.is-night .home-cabinet__ring {
            transition: none;
          }
        }
      `}</style>
    </section>
  );
}

function savePatina(patina: HomeCabinetPatina) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        glow: +patina.glow.toFixed(3),
        visits: patina.visits,
        cluster: patina.cluster,
        routes: patina.routes,
        // capped, oldest first out: an emptied case is a remembered state
        embers: patina.embers.slice(-EMBER_CAP).map((e) => ({
          x: +e.x.toFixed(3),
          y: +e.y.toFixed(3),
          weight: +e.weight.toFixed(3),
          current: e.current,
        })),
      }),
    );
  } catch { /* noop */ }
}

function readStoredPatina(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
