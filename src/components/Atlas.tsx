"use client";

import Image from "next/image";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { REGIONS } from "@/data/content";
import RouteSigil, { type RouteSigilKind } from "@/components/RouteSigil";
import {
  clipRectForFocus,
  clipRectForShiftDirection,
  resolveAtlasBatchPlan,
  type AtlasBatchDirection,
  type AtlasBatchKind,
  type AtlasClipRect,
} from "@/lib/atlas-batch";
import { resolveAtlasEdgeTravel } from "@/lib/atlas-navigation";
import { prepareAtlasSourceImage } from "@/lib/atlas-source";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { useField } from "@/store/field";

const ORIGIN_MAP = "/atlas/atlas-origin.webp";
const MOBILE_ORIGIN_MAP = "/atlas/atlas-origin-mobile.webp";
const DESKTOP_MAP_ASPECT = 4 / 3;
const MOBILE_MAP_ASPECT = 853 / 1538;
const MOBILE_BREAKPOINT = 760;
const MIN_ZOOM = 1;
const MAX_ZOOM = 64;
const SETTLE_TRANSITION = "transform 180ms cubic-bezier(.22,.8,.24,1)";
const ZOOM_SETTLE_DELTA = 0.45;
const MOBILE_ZOOM_SETTLE_MS = 520;
const DESKTOP_ZOOM_SETTLE_MS = 620;
const MOBILE_CROSSFADE_MS = 420;
const DESKTOP_CROSSFADE_MS = 880;
const DRAG_THRESHOLD_PX = 14;
const EDGE_TRAVEL_RATIO = 0.15;
const GESTURE_SUPPRESS_MS = 280;

type Direction = "north" | "east" | "south" | "west";
type GenerationMode = "generate" | "zoom" | "refine" | "shift";
type GenerationPhase = "preview" | "final";
type RenderPhase = "idle" | "local" | "preview" | "final" | "error";
type MapView = { x: number; y: number; zoom: number };
type MapMetrics = {
  width: number;
  height: number;
  mapWidth: number;
  mapHeight: number;
};
type MapSeeds = Record<Direction, string>;
type MarkKind = "coin" | "flower" | "ship" | "star" | "tower";
type MapHotspot = {
  id: string;
  label: string;
  x: number;
  y: number;
  regionId: string;
  prompt?: string;
  kind: MarkKind;
};
type MapSnapshot = {
  image: string;
  hotspots: MapHotspot[];
  seeds: MapSeeds;
  concept: string;
  focusedId: string | null;
  focusedLabel: string | null;
  regionId: string | null;
  view: MapView;
  renderPhase: RenderPhase;
  generationDepth: number;
};
type NeighborSheet = {
  direction: AtlasBatchDirection;
  image: string | null;
  hotspots: MapHotspot[] | null;
  seeds: MapSeeds | null;
  concept: string;
  phase: GenerationPhase | "pending" | "error";
  batchKind: AtlasBatchKind;
};

const REGION_IDS = new Set(REGIONS.map((region) => region.id));
const DIRECTIONS: Direction[] = ["north", "east", "south", "west"];
const DEFAULT_SEEDS: MapSeeds = {
  north: "memory",
  east: "tide",
  south: "matter",
  west: "desire",
};
const DEFAULT_HOTSPOTS: MapHotspot[] = [
  { id: "origin", label: "Origin Coast", x: 0.50, y: 0.52, regionId: "origin", kind: "coin" },
  { id: "road", label: "Road Current", x: 0.38, y: 0.66, regionId: "road", kind: "ship" },
  { id: "ascent", label: "Ascent Plateau", x: 0.58, y: 0.34, regionId: "ascent", kind: "tower" },
  { id: "workbench", label: "Workbench Harbor", x: 0.64, y: 0.56, regionId: "workbench", kind: "coin" },
  { id: "crash", label: "Crash Basin", x: 0.44, y: 0.80, regionId: "crash", kind: "star" },
  { id: "loves", label: "House of Loves", x: 0.70, y: 0.71, regionId: "loves", kind: "flower" },
  { id: "spirit", label: "Spirit Interior", x: 0.67, y: 0.25, regionId: "spirit", kind: "star" },
  { id: "archive", label: "Archive Estuary", x: 0.56, y: 0.68, regionId: "archive", kind: "ship" },
  { id: "horizon", label: "Future Horizon", x: 0.78, y: 0.48, regionId: "horizon", kind: "tower" },
];

const EMPTY_METRICS: MapMetrics = {
  width: 0,
  height: 0,
  mapWidth: 0,
  mapHeight: 0,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function measureMap(width: number, height: number): MapMetrics {
  const aspect = width <= MOBILE_BREAKPOINT ? MOBILE_MAP_ASPECT : DESKTOP_MAP_ASPECT;
  if (width / height > aspect) {
    return { width, height, mapWidth: width, mapHeight: width / aspect };
  }
  return { width, height, mapWidth: height * aspect, mapHeight: height };
}

function responsiveMapSource(source: string, width: number): string {
  const mobile = width <= MOBILE_BREAKPOINT;
  if (mobile && source === ORIGIN_MAP) return MOBILE_ORIGIN_MAP;
  if (!mobile && source === MOBILE_ORIGIN_MAP) return ORIGIN_MAP;
  return source;
}

function centerView(metrics: MapMetrics, zoom = 1): MapView {
  return {
    zoom,
    x: (metrics.width - metrics.mapWidth * zoom) / 2,
    y: (metrics.height - metrics.mapHeight * zoom) / 2,
  };
}

function boundView(view: MapView, metrics: MapMetrics, overscroll = 0): MapView {
  if (!metrics.width) return view;
  const zoom = clamp(view.zoom, MIN_ZOOM, MAX_ZOOM);
  const minX = metrics.width - metrics.mapWidth * zoom;
  const minY = metrics.height - metrics.mapHeight * zoom;
  return {
    zoom,
    x: clamp(view.x, minX - overscroll, overscroll),
    y: clamp(view.y, minY - overscroll, overscroll),
  };
}

function viewTransform(view: MapView) {
  return "translate3d(" + view.x.toFixed(2) + "px," + view.y.toFixed(2) + "px,0) scale(" + view.zoom.toFixed(4) + ")";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function text(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function unit(value: unknown, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return clamp(number > 1 ? number / 100 : number, 0.02, 0.98);
}

function normaliseHotspots(value: unknown): MapHotspot[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const kinds: MarkKind[] = ["coin", "flower", "ship", "star", "tower"];
  return value.slice(0, 12).map((raw, index) => {
    const item = isRecord(raw) ? raw : {};
    const fallback = DEFAULT_HOTSPOTS[index % DEFAULT_HOTSPOTS.length];
    const candidateRegion = text(item.regionId, fallback.regionId);
    const kind = text(item.kind, fallback.kind) as MarkKind;
    return {
      id: text(item.id, "generated-" + index),
      label: text(item.label, fallback.label),
      x: unit(item.x, fallback.x),
      y: unit(item.y, fallback.y),
      regionId: REGION_IDS.has(candidateRegion) ? candidateRegion : fallback.regionId,
      prompt: typeof item.prompt === "string" ? item.prompt : undefined,
      kind: kinds.includes(kind) ? kind : fallback.kind,
    };
  });
}

function normaliseSeeds(value: unknown, fallback: MapSeeds): MapSeeds {
  if (!isRecord(value)) return fallback;
  return {
    north: text(value.north, fallback.north),
    east: text(value.east, fallback.east),
    south: text(value.south, fallback.south),
    west: text(value.west, fallback.west),
  };
}

function localSeeds(prompt: string): MapSeeds {
  const lower = prompt.toLowerCase();
  const families: Array<[string, [string, string, string, string]]> = [
    ["fire", ["ember", "smoke", "cinder", "flame"]],
    ["forest", ["canopy", "moss", "root", "fern"]],
    ["water", ["rain", "current", "depth", "mist"]],
    ["city", ["tower", "market", "alley", "gate"]],
    ["dream", ["memory", "sleep", "omen", "echo"]],
  ];
  const found = families.find(([key]) => lower.includes(key));
  const words = prompt.trim().split(/ +/).filter(Boolean);
  const seeds = found?.[1] ?? [
    words[0] || "memory",
    words[1] || "matter",
    (words[0] || "desire") + " below",
    (words[1] || words[0] || "tide") + " beyond",
  ];
  return { north: seeds[0], east: seeds[1], south: seeds[2], west: seeds[3] };
}

function generationId(sequence: number) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "atlas-" + Date.now() + "-" + sequence;
}

const MARK_SIGILS: Record<MarkKind, RouteSigilKind> = {
  coin: "watch",
  flower: "growth",
  ship: "waves",
  star: "stars",
  tower: "atlas",
};

function MapMark({ kind }: { kind: MarkKind }) {
  return <RouteSigil kind={MARK_SIGILS[kind]} size={24} />;
}

type PointerPoint = { x: number; y: number };
type DragGesture = {
  pointerId: number;
  start: PointerPoint;
  view: MapView;
  moved: boolean;
  last: PointerPoint;
  lastAt: number;
  velocity: PointerPoint;
};
type PinchGesture = {
  distance: number;
  midpoint: PointerPoint;
  view: MapView;
};

export default function Atlas() {
  const selectedRegionId = useField((state) => state.region);
  const setRegion = useField((state) => state.setRegion);
  const recordTape = useField((state) => state.recordTape);

  const stageRef = useRef<HTMLDivElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  const metricsRef = useRef<MapMetrics>(EMPTY_METRICS);
  const viewRef = useRef<MapView>({ x: 0, y: 0, zoom: 1 });
  const pointersRef = useRef(new Map<number, PointerPoint>());
  const dragRef = useRef<DragGesture | null>(null);
  const pinchRef = useRef<PinchGesture | null>(null);
  const pinchZoomRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const requestRef = useRef(0);
  const generationIdRef = useRef<string | null>(null);
  const phaseRankRef = useRef(0);
  const crossfadeRef = useRef<number | null>(null);
  const revealRef = useRef<number | null>(null);
  const incomingImageRef = useRef<string | null>(null);
  const regionSettleRef = useRef<number | null>(null);
  const zoomSettleRef = useRef<number | null>(null);
  const freeZoomParentRef = useRef<MapSnapshot | null>(null);
  const historyRef = useRef<MapSnapshot[]>([]);
  const lastZoomRequestKeyRef = useRef<string | null>(null);
  const renderedZoomRef = useRef(1);
  const activeImageRef = useRef(ORIGIN_MAP);
  const inertiaRef = useRef<number | null>(null);
  const interactingRef = useRef(false);
  const generationDepthRef = useRef(0);
  const neighborSheetsRef = useRef(new Map<AtlasBatchDirection, NeighborSheet>());
  const neighborAbortRef = useRef<AbortController | null>(null);
  const pointerStartRef = useRef<PointerPoint | null>(null);
  const lastGestureAtRef = useRef(0);
  const edgeTravelLockRef = useRef(false);
  const activeNeighborDirectionRef = useRef<AtlasBatchDirection | null>(null);

  const [metrics, setMetrics] = useState<MapMetrics>(EMPTY_METRICS);
  const [activeImage, setActiveImage] = useState(ORIGIN_MAP);
  const [incomingImage, setIncomingImage] = useState<string | null>(null);
  const [incomingVisible, setIncomingVisible] = useState(false);
  const [hotspots, setHotspots] = useState(DEFAULT_HOTSPOTS);
  const [seeds, setSeeds] = useState(DEFAULT_SEEDS);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [focusedLabel, setFocusedLabel] = useState<string | null>(null);
  const [concept, setConcept] = useState("illuminated territories");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyFocus, setBusyFocus] = useState<{ x: number; y: number } | null>(null);
  const [renderPhase, setRenderPhase] = useState<RenderPhase>("idle");
  const [historyDepth, setHistoryDepth] = useState(0);
  const [generationDepth, setGenerationDepth] = useState(0);
  const [status, setStatus] = useState("tap a mark · drag the chart · pinch to breathe");
  const [interacting, setInteracting] = useState(false);
  const [pulse, setPulse] = useState<{ x: number; y: number; key: number } | null>(null);

  const paintPlane = (next: MapView, withTransition: boolean) => {
    const plane = planeRef.current;
    if (!plane) return;
    plane.style.transition = withTransition ? SETTLE_TRANSITION : "none";
    plane.style.transform = viewTransform(next);
    plane.style.setProperty("--atlas-zoom", String(next.zoom));
  };

  const stopInertia = () => {
    if (inertiaRef.current !== null) {
      window.cancelAnimationFrame(inertiaRef.current);
      inertiaRef.current = null;
    }
  };

  const commitView = (next: MapView, options?: { animate?: boolean }) => {
    viewRef.current = next;
    paintPlane(next, Boolean(options?.animate) && !interactingRef.current);
  };

  const applyLiveView = (next: MapView) => {
    viewRef.current = next;
    paintPlane(next, false);
  };

  const markGesture = () => {
    lastGestureAtRef.current = performance.now();
  };

  const tryEdgeTravel = (velocity?: PointerPoint) => {
    if (edgeTravelLockRef.current) return false;
    const metrics = metricsRef.current;
    const view = viewRef.current;
    if (!metrics.width) return false;
    const hard = boundView(view, metrics);
    const margin = Math.max(32, Math.min(metrics.width, metrics.height) * EDGE_TRAVEL_RATIO);
    const direction = resolveAtlasEdgeTravel(view, metrics, velocity ?? { x: 0, y: 0 }, margin);
    if (!direction) return false;
    edgeTravelLockRef.current = true;
    markGesture();
    stopInertia();
    interactingRef.current = false;
    setInteracting(false);
    commitView(hard, { animate: true });
    shiftMap(direction);
    window.setTimeout(() => {
      edgeTravelLockRef.current = false;
    }, 960);
    return true;
  };

  const startInertia = (velocity: PointerPoint) => {
    stopInertia();
    let vx = clamp(velocity.x, -48, 48);
    let vy = clamp(velocity.y, -48, 48);
    if (Math.hypot(vx, vy) < 0.8) {
      commitView(boundView(viewRef.current, metricsRef.current), { animate: true });
      return;
    }
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(32, now - last) / 16.67;
      last = now;
      vx *= Math.pow(0.9, dt);
      vy *= Math.pow(0.9, dt);
      if (tryEdgeTravel({ x: vx, y: vy })) {
        inertiaRef.current = null;
        return;
      }
      if (Math.hypot(vx, vy) < 0.35) {
        inertiaRef.current = null;
        interactingRef.current = false;
        setInteracting(false);
        commitView(boundView(viewRef.current, metricsRef.current), { animate: true });
        if (viewRef.current.zoom > 1.08) queueSettledZoom();
        return;
      }
      applyLiveView(boundView({
        zoom: viewRef.current.zoom,
        x: viewRef.current.x + vx * dt,
        y: viewRef.current.y + vy * dt,
      }, metricsRef.current, 72));
      inertiaRef.current = window.requestAnimationFrame(tick);
    };
    inertiaRef.current = window.requestAnimationFrame(tick);
  };

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const resize = () => {
      const rect = stage.getBoundingClientRect();
      const nextSource = responsiveMapSource(activeImageRef.current, rect.width);
      if (nextSource !== activeImageRef.current) {
        activeImageRef.current = nextSource;
        setActiveImage(nextSource);
      }
      const nextMetrics = measureMap(rect.width, rect.height);
      const previous = metricsRef.current;
      const current = viewRef.current;
      let nextView = centerView(nextMetrics, current.zoom);
      if (previous.width) {
        const worldX = (previous.width / 2 - current.x) / (previous.mapWidth * current.zoom);
        const worldY = (previous.height / 2 - current.y) / (previous.mapHeight * current.zoom);
        nextView = boundView({
          zoom: current.zoom,
          x: nextMetrics.width / 2 - worldX * nextMetrics.mapWidth * current.zoom,
          y: nextMetrics.height / 2 - worldY * nextMetrics.mapHeight * current.zoom,
        }, nextMetrics);
      }
      metricsRef.current = nextMetrics;
      viewRef.current = nextView;
      paintPlane(nextView, false);
      setMetrics(nextMetrics);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      neighborAbortRef.current?.abort();
      stopInertia();
      if (crossfadeRef.current !== null) window.clearTimeout(crossfadeRef.current);
      if (revealRef.current !== null) window.clearTimeout(revealRef.current);
      if (regionSettleRef.current !== null) window.clearTimeout(regionSettleRef.current);
      if (zoomSettleRef.current !== null) window.clearTimeout(zoomSettleRef.current);
    };
  }, []);

  const settleCrossfade = () => {
    if (crossfadeRef.current !== null) window.clearTimeout(crossfadeRef.current);
    if (revealRef.current !== null) window.clearTimeout(revealRef.current);
    const pending = incomingImageRef.current;
    if (pending) {
      activeImageRef.current = pending;
      setActiveImage(pending);
    }
    incomingImageRef.current = null;
    setIncomingImage(null);
    setIncomingVisible(false);
  };

  const crossfadeTo = (source: string) => {
    const nextSource = responsiveMapSource(source, metricsRef.current.width);
    settleCrossfade();
    if (!nextSource || nextSource === activeImageRef.current) return;
    incomingImageRef.current = nextSource;
    setIncomingVisible(false);
    setIncomingImage(nextSource);
    const crossfadeMs = metricsRef.current.width > 0 && metricsRef.current.width <= MOBILE_BREAKPOINT
      ? MOBILE_CROSSFADE_MS
      : DESKTOP_CROSSFADE_MS;
    revealRef.current = window.setTimeout(() => setIncomingVisible(true), 24);
    crossfadeRef.current = window.setTimeout(() => {
      activeImageRef.current = nextSource;
      incomingImageRef.current = null;
      setActiveImage(nextSource);
      setIncomingImage(null);
      setIncomingVisible(false);
    }, crossfadeMs);
  };

  const clearNeighborSheets = () => {
    neighborAbortRef.current?.abort();
    neighborAbortRef.current = null;
    neighborSheetsRef.current.clear();
  };

  const invalidateGeneration = () => {
    requestRef.current += 1;
    generationIdRef.current = null;
    phaseRankRef.current = 0;
    abortRef.current?.abort();
    abortRef.current = null;
    if (regionSettleRef.current !== null) window.clearTimeout(regionSettleRef.current);
    if (zoomSettleRef.current !== null) window.clearTimeout(zoomSettleRef.current);
    regionSettleRef.current = null;
    zoomSettleRef.current = null;
    setBusy(false);
    setBusyFocus(null);
  };

  const captureSnapshot = (): MapSnapshot => {
    settleCrossfade();
    return {
      image: activeImageRef.current,
      hotspots,
      seeds,
      concept,
      focusedId,
      focusedLabel,
      regionId: selectedRegionId,
      view: viewRef.current,
      renderPhase,
      generationDepth: generationDepthRef.current,
    };
  };

  const restoreSnapshot = (snapshot: MapSnapshot) => {
    settleCrossfade();
    clearNeighborSheets();
    setHotspots(snapshot.hotspots);
    setSeeds(snapshot.seeds);
    setConcept(snapshot.concept);
    setFocusedId(snapshot.focusedId);
    setFocusedLabel(snapshot.focusedLabel);
    setRegion(snapshot.regionId);
    setRenderPhase(snapshot.renderPhase);
    generationDepthRef.current = snapshot.generationDepth;
    setGenerationDepth(snapshot.generationDepth);
    renderedZoomRef.current = snapshot.view.zoom;
    commitView(boundView(snapshot.view, metricsRef.current));
    crossfadeTo(snapshot.image);
  };

  const resetOuterMap = () => {
    invalidateGeneration();
    freeZoomParentRef.current = null;
    lastZoomRequestKeyRef.current = null;
    const parent = historyRef.current.pop();
    setHistoryDepth(historyRef.current.length);
    if (parent) {
      restoreSnapshot(parent);
      setStatus(parent.focusedLabel ? "returned to " + parent.focusedLabel.toLowerCase() : "returned to the outer map");
      return;
    }
    setFocusedId(null);
    setFocusedLabel(null);
    setRenderPhase("idle");
    setRegion(null);
    renderedZoomRef.current = 1;
    commitView(centerView(metricsRef.current));
    setStatus("outer map · choose another mark or cross an edge");
  };

  const prefetchNeighborBatch = async ({
    sourceImage,
    subjectPrompt,
    depth,
    parentRequestId,
  }: {
    sourceImage: string;
    subjectPrompt: string;
    depth: number;
    parentRequestId: number;
  }) => {
    if (!sourceImage || sourceImage.startsWith("/atlas/atlas-origin")) return;
    neighborAbortRef.current?.abort();
    const controller = new AbortController();
    neighborAbortRef.current = controller;
    const plan = resolveAtlasBatchPlan(depth);
    const box = stageRef.current?.getBoundingClientRect();
    const viewport = {
      width: Math.round(box?.width ?? 0),
      height: Math.round(box?.height ?? 0),
    };

    for (const slot of plan.slots) {
      neighborSheetsRef.current.set(slot.direction, {
        direction: slot.direction,
        image: null,
        hotspots: null,
        seeds: null,
        concept: subjectPrompt,
        phase: "pending",
        batchKind: plan.kind,
      });
    }

    const queue = [...plan.slots];
    const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
      while (queue.length > 0) {
        if (controller.signal.aborted || parentRequestId !== requestRef.current) return;
        const slot = queue.shift();
        if (!slot) return;
        const cardinal = slot.direction === "north"
          || slot.direction === "east"
          || slot.direction === "south"
          || slot.direction === "west"
          ? slot.direction
          : undefined;
        const preparedSource = await prepareAtlasSourceImage(sourceImage, slot.clip);
        const neighborGenerationId = generationId(parentRequestId) + "-" + slot.direction;
        const body = JSON.stringify({
          prompt: subjectPrompt.replace(/ +/g, " ").trim().slice(0, 240),
          currentImage: preparedSource.currentImage,
          mode: cardinal ? "shift" : "zoom",
          direction: cardinal,
          focus: cardinal
            ? undefined
            : {
                x: slot.clip.x + slot.clip.width / 2,
                y: slot.clip.y + slot.clip.height / 2,
                zoom: 2,
              },
          clip: slot.clip,
          sourceImageCropped: preparedSource.sourceImageCropped,
          batchKind: plan.kind,
          batchRole: "neighbor",
          batchDirection: slot.direction,
          generationDepth: depth,
          viewport,
        });
        const requestNeighborPhase = async (phase: GenerationPhase) => {
          const response = await fetch("/api/atlas/generate?phase=" + phase, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-atlas-generation-id": neighborGenerationId,
            },
            signal: controller.signal,
            body,
          });
          if (!response.ok) throw new Error("neighbor " + phase + " failed");
          const data = await response.json() as unknown;
          if (!isRecord(data) || parentRequestId !== requestRef.current) return null;
          const image = typeof data.dataUrl === "string" && data.dataUrl ? data.dataUrl : null;
          if (!image) return null;
          const next: NeighborSheet = {
            direction: slot.direction,
            image,
            hotspots: normaliseHotspots(data.hotspots),
            seeds: normaliseSeeds(data.seeds, localSeeds(subjectPrompt)),
            concept: subjectPrompt,
            phase,
            batchKind: plan.kind,
          };
          neighborSheetsRef.current.set(slot.direction, next);
          // Upgrade the live sheet if the user already traveled into this neighbor preview.
          if (
            phase === "final"
            && activeNeighborDirectionRef.current === slot.direction
            && activeImageRef.current
            && activeImageRef.current.startsWith("data:")
          ) {
            crossfadeTo(image);
            if (next.hotspots) setHotspots(next.hotspots);
            if (next.seeds) setSeeds(next.seeds);
            setRenderPhase("final");
            setStatus("new territory to the " + slot.direction + " · final chart settled");
          }
          return next;
        };
        try {
          await requestNeighborPhase("preview");
          if (controller.signal.aborted || parentRequestId !== requestRef.current) return;
          await requestNeighborPhase("final");
        } catch {
          if (controller.signal.aborted) return;
          const existing = neighborSheetsRef.current.get(slot.direction);
          if (!existing?.image) {
            neighborSheetsRef.current.set(slot.direction, {
              direction: slot.direction,
              image: null,
              hotspots: null,
              seeds: null,
              concept: subjectPrompt,
              phase: "error",
              batchKind: plan.kind,
            });
          }
        }
      }
    });
    await Promise.allSettled(workers);
  };

  const generateMap = async ({
    mode,
    subjectPrompt,
    focus,
    direction,
    clip,
    optimisticSeeds,
    prefetchNeighbors = true,
  }: {
    mode: GenerationMode;
    subjectPrompt: string;
    focus?: { x: number; y: number; zoom: number };
    direction?: Direction;
    clip?: AtlasClipRect;
    optimisticSeeds?: MapSeeds;
    prefetchNeighbors?: boolean;
  }) => {
    invalidateGeneration();
    settleCrossfade();
    if (prefetchNeighbors) clearNeighborSheets();
    const requestId = ++requestRef.current;
    const clientGenerationId = generationId(requestId);
    generationIdRef.current = clientGenerationId;
    phaseRankRef.current = 0;
    const controller = new AbortController();
    abortRef.current = controller;
    const currentImage = activeImageRef.current;
    const depth = generationDepthRef.current;
    const resolvedClip = clip
      ?? (mode === "zoom" && focus ? clipRectForFocus(focus) : undefined)
      ?? (mode === "shift" && direction ? clipRectForShiftDirection(direction) : undefined);
    const usesClippedSource = Boolean(
      currentImage
      && resolvedClip
      && (mode === "zoom" || mode === "shift"),
    );
    setBusy(true);
    setBusyFocus(focus ? {
      x: viewRef.current.x + focus.x * metricsRef.current.mapWidth * viewRef.current.zoom,
      y: viewRef.current.y + focus.y * metricsRef.current.mapHeight * viewRef.current.zoom,
    } : null);
    setRenderPhase("local");
    if (optimisticSeeds) setSeeds(optimisticSeeds);

    let imageForRequest = currentImage;
    let sourceImageCropped = false;
    if (usesClippedSource && currentImage && resolvedClip) {
      const preparedSource = await prepareAtlasSourceImage(currentImage, resolvedClip);
      imageForRequest = preparedSource.currentImage;
      sourceImageCropped = preparedSource.sourceImageCropped;
    }

    const box = stageRef.current?.getBoundingClientRect();
    const body = JSON.stringify({
      prompt: subjectPrompt.replace(/ +/g, " ").trim().slice(0, 240),
      currentImage: imageForRequest,
      mode,
      direction,
      focus,
      clip: usesClippedSource ? resolvedClip : undefined,
      sourceImageCropped: usesClippedSource ? sourceImageCropped : undefined,
      batchRole: "primary",
      generationDepth: depth,
      viewport: {
        width: Math.round(box?.width ?? 0),
        height: Math.round(box?.height ?? 0),
      },
    });

    let landedImage: string | null = null;

    const requestPhase = async (phase: GenerationPhase) => {
      const response = await fetch("/api/atlas/generate?phase=" + phase, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-atlas-generation-id": clientGenerationId,
        },
        signal: controller.signal,
        body,
      });
      if (!response.ok) throw new Error("The atlas could not be redrawn.");
      const data = await response.json() as unknown;
      if (!isRecord(data)) throw new Error("The atlas returned an unreadable chart.");
      if (requestId !== requestRef.current || generationIdRef.current !== clientGenerationId) return;
      const generation = isRecord(data.generation) ? data.generation : {};
      const echoedId = typeof generation.generationId === "string" ? generation.generationId : clientGenerationId;
      const echoedPhase = generation.phase === "preview" || generation.phase === "final" ? generation.phase : phase;
      if (echoedId !== clientGenerationId || echoedPhase !== phase) return;
      const rank = phase === "final" ? 2 : 1;
      if (rank < phaseRankRef.current) return;
      phaseRankRef.current = rank;
      setRenderPhase(phase);
      const nextHotspots = normaliseHotspots(data.hotspots);
      if (nextHotspots) setHotspots(nextHotspots);
      setSeeds((current) => normaliseSeeds(data.seeds, current));
      if (typeof data.dataUrl === "string" && data.dataUrl) {
        landedImage = data.dataUrl;
        crossfadeTo(data.dataUrl);
        if (mode === "zoom" || mode === "shift") {
          renderedZoomRef.current = 1;
          lastZoomRequestKeyRef.current = null;
          freeZoomParentRef.current = null;
          commitView(centerView(metricsRef.current, 1), { animate: true });
        }
        setStatus(
          phase === "preview"
            ? "a quick chart has surfaced · refining…"
            : mode === "zoom"
              ? "a deeper chart has opened"
              : mode === "shift" && direction
                ? "new territory to the " + direction
                : mode === "refine"
                  ? "the region has deepened"
                  : "a new atlas has surfaced",
        );
      } else {
        setStatus(phase === "preview" ? "the local chart is refining…" : "the local atlas is ready to explore");
      }
      if (phase === "final") {
        setBusy(false);
        setBusyFocus(null);
      }
    };

    const results = await Promise.allSettled([
      requestPhase("preview"),
      requestPhase("final"),
    ]);
    if (controller.signal.aborted || requestId !== requestRef.current || generationIdRef.current !== clientGenerationId) return;
    const rejected = results.filter((result) => result.status === "rejected");
    if (rejected.length === 2) {
      const failure = rejected[0] as PromiseRejectedResult;
      setStatus(failure.reason instanceof Error ? failure.reason.message : "The atlas held its present shape.");
      setRenderPhase("error");
    } else if (results[1].status === "rejected" && phaseRankRef.current === 1) {
      setStatus("the quick chart is ready · the final ink held back");
    } else if (phaseRankRef.current > 0 && (mode === "generate" || mode === "zoom" || mode === "shift")) {
      // First successful place is depth 0 → cardinal4. Later landings use diagonal2.
      generationDepthRef.current = mode === "generate" ? 0 : depth + 1;
      setGenerationDepth(generationDepthRef.current);
      if (prefetchNeighbors && landedImage) {
        void prefetchNeighborBatch({
          sourceImage: landedImage,
          subjectPrompt,
          depth: generationDepthRef.current,
          parentRequestId: requestId,
        });
      }
    }
    setBusy(false);
    setBusyFocus(null);
  };

  const enterHotspot = (hotspot: MapHotspot) => {
    const parent = captureSnapshot();
    historyRef.current.push(parent);
    if (historyRef.current.length > 8) historyRef.current.shift();
    setHistoryDepth(historyRef.current.length);
    invalidateGeneration();
    freeZoomParentRef.current = null;
    lastZoomRequestKeyRef.current = null;
    const nextZoom = Math.max(2.15, Math.min(3, viewRef.current.zoom + 0.85));
    renderedZoomRef.current = nextZoom;
    const next = boundView({
      zoom: nextZoom,
      x: metricsRef.current.width / 2 - hotspot.x * metricsRef.current.mapWidth * nextZoom,
      y: metricsRef.current.height / 2 - hotspot.y * metricsRef.current.mapHeight * nextZoom,
    }, metricsRef.current);
    setFocusedId(hotspot.id);
    setFocusedLabel(hotspot.label);
    setRegion(hotspot.regionId);
    commitView(next, { animate: true });
    setStatus("diffusing detail around " + hotspot.label.toLowerCase());
    setRenderPhase("local");
    try {
      getFieldAudio().chime();
      haptics.roll();
    } catch {
      // Sound and haptics are progressive enhancement.
    }
    recordTape("region", 0.84, "atlas/zoom/" + hotspot.id);
    const settledSelection = requestRef.current;
    setBusy(true);
    regionSettleRef.current = window.setTimeout(() => {
      regionSettleRef.current = null;
      if (settledSelection !== requestRef.current) return;
      void generateMap({
        mode: "refine",
        subjectPrompt: [concept, hotspot.prompt || hotspot.label].filter(Boolean).join(" · "),
        focus: { x: hotspot.x, y: hotspot.y, zoom: nextZoom },
      });
    }, 480);
  };

  const applyNeighborSheet = (direction: Direction, neighbor: NeighborSheet) => {
    if (!neighbor.image) return false;
    invalidateGeneration();
    historyRef.current = [];
    setHistoryDepth(0);
    freeZoomParentRef.current = null;
    lastZoomRequestKeyRef.current = null;
    setFocusedId(null);
    setFocusedLabel(null);
    setRegion(null);
    renderedZoomRef.current = 1;
    activeNeighborDirectionRef.current = direction;
    setConcept(neighbor.concept);
    if (neighbor.hotspots) setHotspots(neighbor.hotspots);
    if (neighbor.seeds) setSeeds(neighbor.seeds);
    commitView(centerView(metricsRef.current, 1), { animate: true });
    crossfadeTo(neighbor.image);
    setRenderPhase(neighbor.phase === "final" ? "final" : "preview");
    setStatus(
      neighbor.phase === "final"
        ? "new territory to the " + direction
        : "new territory to the " + direction + " · refining…",
    );
    generationDepthRef.current = Math.max(1, generationDepthRef.current + 1);
    setGenerationDepth(generationDepthRef.current);
    // Keep the cache entry so a later Pro final can upgrade the live sheet.
    neighborSheetsRef.current.set(direction, neighbor);
    void prefetchNeighborBatch({
      sourceImage: neighbor.image,
      subjectPrompt: neighbor.concept,
      depth: generationDepthRef.current,
      parentRequestId: requestRef.current,
    });
    return true;
  };

  const shiftMap = (direction: Direction) => {
    const cached = neighborSheetsRef.current.get(direction);
    // Prefer a finished Pro neighbor; fall back to Klein preview if that is all we have.
    if (cached?.image && (cached.phase === "final" || cached.phase === "preview")) {
      recordTape("region", 0.72, "atlas/shift/" + direction + "/prefetch-" + cached.phase);
      if (applyNeighborSheet(direction, cached)) return;
    }
    const seed = seeds[direction];
    historyRef.current = [];
    setHistoryDepth(0);
    freeZoomParentRef.current = null;
    lastZoomRequestKeyRef.current = null;
    setFocusedId(null);
    setFocusedLabel(null);
    setRegion(null);
    renderedZoomRef.current = 1;
    setConcept(seed);
    commitView(centerView(metricsRef.current));
    setStatus("crossing " + direction + " toward " + seed);
    setRenderPhase("local");
    recordTape("region", 0.72, "atlas/shift/" + direction + "/" + seed);
    void generateMap({
      mode: "shift",
      direction,
      clip: clipRectForShiftDirection(direction),
      optimisticSeeds: localSeeds(seed),
      subjectPrompt: seed,
    });
  };

  const submitPrompt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const raw = prompt.trim();
    if (!raw) return;
    historyRef.current = [];
    setHistoryDepth(0);
    generationDepthRef.current = 0;
    setGenerationDepth(0);
    activeNeighborDirectionRef.current = null;
    clearNeighborSheets();
    freeZoomParentRef.current = null;
    lastZoomRequestKeyRef.current = null;
    setPrompt("");
    setConcept(raw);
    setFocusedId(null);
    setFocusedLabel(null);
    setRegion(null);
    renderedZoomRef.current = 1;
    commitView(centerView(metricsRef.current));
    setStatus("drawing a map of " + raw);
    setRenderPhase("local");
    recordTape("imagine", 0.94, "atlas/" + raw.slice(0, 32));
    void generateMap({
      mode: "generate",
      optimisticSeeds: localSeeds(raw),
      subjectPrompt: raw,
    });
  };

  const beginFreeZoom = () => {
    if (!freeZoomParentRef.current) {
      freeZoomParentRef.current = captureSnapshot();
      invalidateGeneration();
    }
  };

  const queueSettledZoom = () => {
    if (zoomSettleRef.current !== null) window.clearTimeout(zoomSettleRef.current);
    zoomSettleRef.current = window.setTimeout(() => {
      zoomSettleRef.current = null;
      const current = viewRef.current;
      const parent = freeZoomParentRef.current;
      if (!parent) return;
      const renderedZoom = renderedZoomRef.current;
      const delta = current.zoom - renderedZoom;
      if (Math.abs(delta) < ZOOM_SETTLE_DELTA) {
        freeZoomParentRef.current = null;
        return;
      }

      const atOuterDepth = historyRef.current.length === 0 && renderedZoom <= 1.08;
      // Pull-back toward 1: reconstruct a wider parent sheet instead of only popping history.
      if (delta <= -ZOOM_SETTLE_DELTA) {
        if (atOuterDepth && current.zoom <= 1.08) {
          freeZoomParentRef.current = null;
          resetOuterMap();
          return;
        }
        const mapWidth = Math.max(1, metricsRef.current.mapWidth * current.zoom);
        const mapHeight = Math.max(1, metricsRef.current.mapHeight * current.zoom);
        const focus = {
          x: clamp((metricsRef.current.width / 2 - current.x) / mapWidth, 0, 1),
          y: clamp((metricsRef.current.height / 2 - current.y) / mapHeight, 0, 1),
          zoom: Math.max(MIN_ZOOM, current.zoom),
        };
        const key = [
          concept,
          "wider",
          Math.round(current.zoom * 2) / 2,
          Math.round(focus.x * 8),
          Math.round(focus.y * 8),
        ].join("|");
        if (key === lastZoomRequestKeyRef.current) {
          freeZoomParentRef.current = null;
          return;
        }
        lastZoomRequestKeyRef.current = key;
        historyRef.current.push(parent);
        if (historyRef.current.length > 8) historyRef.current.shift();
        setHistoryDepth(historyRef.current.length);
        freeZoomParentRef.current = null;
        renderedZoomRef.current = 1;
        setStatus("widening the chart to the surrounding territory");
        setRenderPhase("local");
        recordTape("region", 0.68, "atlas/free-zoom-out/" + current.zoom.toFixed(2));
        void generateMap({
          mode: "zoom",
          subjectPrompt: concept + " · wider territory",
          focus,
        });
        return;
      }

      if (current.zoom <= 1.08) {
        freeZoomParentRef.current = null;
        if (!atOuterDepth) resetOuterMap();
        return;
      }

      const mapWidth = metricsRef.current.mapWidth * current.zoom;
      const mapHeight = metricsRef.current.mapHeight * current.zoom;
      const focus = {
        x: clamp((metricsRef.current.width / 2 - current.x) / mapWidth, 0, 1),
        y: clamp((metricsRef.current.height / 2 - current.y) / mapHeight, 0, 1),
        zoom: current.zoom,
      };
      const key = [
        concept,
        Math.round(current.zoom * 2) / 2,
        Math.round(focus.x * 8),
        Math.round(focus.y * 8),
      ].join("|");
      if (key === lastZoomRequestKeyRef.current) {
        freeZoomParentRef.current = null;
        return;
      }
      lastZoomRequestKeyRef.current = key;
      renderedZoomRef.current = current.zoom;
      historyRef.current.push(parent);
      if (historyRef.current.length > 8) historyRef.current.shift();
      setHistoryDepth(historyRef.current.length);
      freeZoomParentRef.current = null;
      setStatus("settling new detail into the visible region");
      setRenderPhase("local");
      recordTape("region", 0.68, "atlas/free-zoom/" + current.zoom.toFixed(2));
      void generateMap({
        mode: "zoom",
        subjectPrompt: concept + " · visible region",
        focus,
      });
    }, metricsRef.current.width > 0 && metricsRef.current.width <= MOBILE_BREAKPOINT
      ? MOBILE_ZOOM_SETTLE_MS
      : DESKTOP_ZOOM_SETTLE_MS);
  };

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("form, input, [data-map-ui]")) return;
    event.preventDefault();
    stopInertia();
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const current = viewRef.current;
    const nextZoom = clamp(current.zoom * Math.exp(-event.deltaY * 0.0018), MIN_ZOOM, MAX_ZOOM);
    beginFreeZoom();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const worldX = (point.x - current.x) / current.zoom;
    const worldY = (point.y - current.y) / current.zoom;
    applyLiveView(boundView({
      zoom: nextZoom,
      x: point.x - worldX * nextZoom,
      y: point.y - worldY * nextZoom,
    }, metricsRef.current));
    queueSettledZoom();
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    // Hotspots are buttons but must not steal the drag; chrome uses data-map-ui.
    if (target.closest("form, input, [data-map-ui]")) return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    stopInertia();
    if (zoomSettleRef.current !== null) {
      window.clearTimeout(zoomSettleRef.current);
      zoomSettleRef.current = null;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    pointerStartRef.current = point;
    pointersRef.current.set(event.pointerId, point);
    interactingRef.current = true;
    setInteracting(true);
    paintPlane(viewRef.current, false);
    if (pointersRef.current.size === 1) {
      dragRef.current = {
        pointerId: event.pointerId,
        start: point,
        view: { ...viewRef.current },
        moved: false,
        last: point,
        lastAt: performance.now(),
        velocity: { x: 0, y: 0 },
      };
      pinchRef.current = null;
    } else if (pointersRef.current.size === 2) {
      beginFreeZoom();
      markGesture();
      pinchZoomRef.current = true;
      const points = Array.from(pointersRef.current.values());
      pinchRef.current = {
        distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y),
        midpoint: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 },
        view: { ...viewRef.current },
      };
      dragRef.current = null;
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    pointersRef.current.set(event.pointerId, point);
    if (pointersRef.current.size >= 2 && pinchRef.current) {
      const points = Array.from(pointersRef.current.values()).slice(0, 2);
      const distance = Math.max(1, Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y));
      const midpoint = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
      const prev = pinchRef.current;
      const zoom = clamp(prev.view.zoom * (distance / Math.max(1, prev.distance)), MIN_ZOOM, MAX_ZOOM);
      // Incremental pinch around the live midpoint keeps mobile two-finger zoom stable.
      const worldX = (midpoint.x - prev.view.x) / prev.view.zoom;
      const worldY = (midpoint.y - prev.view.y) / prev.view.zoom;
      const next = boundView({
        zoom,
        x: midpoint.x - worldX * zoom,
        y: midpoint.y - worldY * zoom,
      }, metricsRef.current, 48);
      applyLiveView(next);
      pinchRef.current = { distance, midpoint, view: next };
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const now = performance.now();
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      if (!drag.moved) markGesture();
      drag.moved = true;
    }
    if (!drag.moved) return;
    const dt = Math.max(1, now - drag.lastAt);
    const instantX = (point.x - drag.last.x) / dt * 16.67;
    const instantY = (point.y - drag.last.y) / dt * 16.67;
    drag.velocity = {
      x: drag.velocity.x * 0.65 + instantX * 0.35,
      y: drag.velocity.y * 0.65 + instantY * 0.35,
    };
    drag.last = point;
    drag.lastAt = now;
    applyLiveView(boundView({
      zoom: drag.view.zoom,
      x: drag.view.x + dx,
      y: drag.view.y + dy,
    }, metricsRef.current, 80));
    if (tryEdgeTravel(drag.velocity)) {
      dragRef.current = null;
    }
  };

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const point = pointersRef.current.get(event.pointerId);
    const drag = dragRef.current;
    pointersRef.current.delete(event.pointerId);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The browser may release capture first.
    }
    if (pointersRef.current.size > 0) {
      const remaining = Array.from(pointersRef.current.entries())[0];
      dragRef.current = {
        pointerId: remaining[0],
        start: remaining[1],
        view: { ...viewRef.current },
        moved: true,
        last: remaining[1],
        lastAt: performance.now(),
        velocity: { x: 0, y: 0 },
      };
      pinchRef.current = null;
      return;
    }

    const wasPinching = pinchZoomRef.current;
    pinchZoomRef.current = false;
    pinchRef.current = null;
    const live = viewRef.current;
    const bounded = boundView(live, metricsRef.current);
    if (wasPinching) {
      interactingRef.current = false;
      setInteracting(false);
      commitView(bounded, { animate: true });
      dragRef.current = null;
      queueSettledZoom();
      return;
    }
    if (!cancelled && drag?.moved && tryEdgeTravel(drag.velocity)) {
      dragRef.current = null;
      return;
    }
    const edgeMargin = Math.max(28, Math.min(metricsRef.current.width, metricsRef.current.height) * EDGE_TRAVEL_RATIO);
    const overflow: Array<[Direction, number]> = [
      ["west", live.x - bounded.x],
      ["east", bounded.x - live.x],
      ["north", live.y - bounded.y],
      ["south", bounded.y - live.y],
    ];
    const crossed = overflow.sort((a, b) => b[1] - a[1])[0];
    if (!cancelled && crossed[1] > edgeMargin * 0.35) {
      interactingRef.current = false;
      setInteracting(false);
      commitView(bounded, { animate: true });
      dragRef.current = null;
      markGesture();
      shiftMap(crossed[0]);
      return;
    }
    if (!cancelled && drag?.moved && Math.hypot(drag.velocity.x, drag.velocity.y) > 0.8) {
      dragRef.current = null;
      startInertia(drag.velocity);
      return;
    }
    interactingRef.current = false;
    setInteracting(false);
    commitView(bounded, { animate: true });
    if (!cancelled && drag && !drag.moved && point) {
      if (performance.now() - lastGestureAtRef.current < GESTURE_SUPPRESS_MS) {
        dragRef.current = null;
        return;
      }
      if (viewRef.current.zoom > 1.05 || focusedId) {
        resetOuterMap();
      } else {
        setPulse({ x: point.x, y: point.y, key: Date.now() });
        setStatus("the water remembers the touch");
        recordTape("ripple", 0.38, "atlas/water");
      }
    } else if (viewRef.current.zoom > 1.08) {
      queueSettledZoom();
    }
    dragRef.current = null;
  };

  const planeStyle: CSSProperties = {
    width: metrics.mapWidth || "100%",
    height: metrics.mapHeight || "100%",
  };

  return (
    <section id="atlas" className="living-atlas" data-touch-surface="true" data-pretext-ignore>
        <div
        ref={stageRef}
        className={
          "living-atlas__stage"
          + (busy ? " is-generating" : "")
          + (interacting ? " is-gesturing" : "")
        }
        data-generation-phase={renderPhase}
        data-history-depth={historyDepth}
        data-generation-depth={generationDepth}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => finishPointer(event)}
        onPointerCancel={(event) => finishPointer(event, true)}
        onDoubleClick={resetOuterMap}
        role="application"
        aria-label="Living atlas. Drag to travel, pinch or wheel to zoom, and select a landmark to enter it."
      >
        <div ref={planeRef} className="living-atlas__plane" style={planeStyle}>
          <Image
            className="living-atlas__image"
            src={activeImage}
            alt=""
            fill
            sizes="100vw"
            priority
            unoptimized
            draggable={false}
          />
          {incomingImage && (
            <Image
              className={"living-atlas__image living-atlas__image--incoming" + (incomingVisible ? " is-visible" : "")}
              src={incomingImage}
              alt=""
              fill
              sizes="100vw"
              unoptimized
              draggable={false}
            />
          )}
          <div className="living-atlas__patina" aria-hidden="true" />
          {(metrics.width > 0 && metrics.width <= MOBILE_BREAKPOINT ? hotspots.slice(0, 5) : hotspots).map((hotspot) => {
            const focused = focusedId === hotspot.id;
            return (
              <button
                key={hotspot.id}
                type="button"
                className={"living-atlas__hotspot" + (focused ? " is-focused" : "")}
                style={{
                  left: hotspot.x * 100 + "%",
                  top: hotspot.y * 100 + "%",
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  if (performance.now() - lastGestureAtRef.current < GESTURE_SUPPRESS_MS) return;
                  if (dragRef.current?.moved || interactingRef.current) return;
                  enterHotspot(hotspot);
                }}
                aria-label={"enter " + hotspot.label}
                aria-pressed={focused}
                data-hotspot={hotspot.id}
              >
                <span className="living-atlas__mark"><MapMark kind={hotspot.kind} /></span>
                <span className="living-atlas__label">{hotspot.label.toLowerCase()}</span>
              </button>
            );
          })}
        </div>

        <div className="living-atlas__shade" aria-hidden="true" />
        <div className="living-atlas__masthead" data-map-ui="true">
          <button
            type="button"
            className="living-atlas__breadcrumb"
            onClick={resetOuterMap}
            aria-label="return to the outer map"
          >
            map
          </button>
          <span aria-hidden="true"> / </span>
          <span>{focusedLabel ? focusedLabel.toLowerCase() : concept}</span>
        </div>

        {DIRECTIONS.map((direction) => (
          <button
            key={direction}
            type="button"
            className={"living-atlas__edge living-atlas__edge--" + direction}
            onClick={() => shiftMap(direction)}
            aria-label={"travel " + direction + " toward " + seeds[direction]}
            data-edge={direction}
          >
            <span>{seeds[direction]}</span>
          </button>
        ))}

        {busy && (
          <div
            className="living-atlas__diffusion"
            style={{ left: busyFocus?.x ?? metrics.width / 2, top: busyFocus?.y ?? metrics.height / 2 }}
            aria-hidden="true"
          >
            <span />
            <span />
            <i />
            <i />
          </div>
        )}
        {pulse && (
          <span
            key={pulse.key}
            className="living-atlas__ripple"
            style={{ left: pulse.x, top: pulse.y }}
            aria-hidden="true"
          />
        )}

        <form className="living-atlas__prompt" onSubmit={submitPrompt} data-map-ui="true">
          <label htmlFor="atlas-prompt">make a map of…</label>
          <input
            id="atlas-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="make a map of…"
            autoComplete="off"
            enterKeyHint="go"
            maxLength={180}
          />
          <button type="submit" disabled={!prompt.trim()} aria-label="generate map">
            <span aria-hidden="true">↗</span>
          </button>
        </form>

        <div className={"living-atlas__status" + (busy ? " is-busy" : "")} role="status" aria-live="polite" data-map-ui="true">
          {busy ? "map detail is being drawn" : status}
        </div>
      </div>

      <style>{`
        .living-atlas {
          padding: 0;
          border: 0;
          background: #07131a;
          color: #efe2bd;
        }
        .living-atlas__stage {
          position: relative;
          width: 100%;
          height: calc(100dvh - 56px - env(safe-area-inset-top, 0px));
          min-height: 620px;
          overflow: hidden;
          isolation: isolate;
          background: #06141d;
          touch-action: none;
          overscroll-behavior: none;
          -webkit-user-select: none;
          user-select: none;
          cursor: grab;
        }
        .living-atlas__stage:active,
        .living-atlas__stage.is-gesturing { cursor: grabbing; }
        .living-atlas__stage.is-gesturing .living-atlas__hotspot {
          pointer-events: none;
        }
        .living-atlas__plane {
          position: absolute;
          left: 0;
          top: 0;
          transform-origin: 0 0;
          will-change: transform;
          backface-visibility: hidden;
        }
        .living-atlas__image {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          pointer-events: none;
          user-select: none;
          filter: saturate(.96) contrast(1.07) brightness(.82);
        }
        .living-atlas__image--incoming {
          opacity: 0;
          transition: opacity 820ms cubic-bezier(.2,.72,.18,1);
        }
        .living-atlas__image--incoming.is-visible { opacity: 1; }
        .living-atlas__patina {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background:
            radial-gradient(circle at 50% 48%, transparent 25%, rgba(2, 10, 15, .2) 100%),
            repeating-linear-gradient(12deg, rgba(245, 220, 154, .022) 0 1px, transparent 1px 6px);
          mix-blend-mode: multiply;
        }
        .living-atlas__shade {
          position: absolute;
          inset: 0;
          z-index: 3;
          pointer-events: none;
          background:
            linear-gradient(180deg, rgba(4, 12, 18, .72), transparent 19%, transparent 70%, rgba(4, 12, 18, .78)),
            linear-gradient(90deg, rgba(4, 12, 18, .34), transparent 15%, transparent 85%, rgba(4, 12, 18, .34));
        }
        .living-atlas__masthead {
          position: absolute;
          z-index: 8;
          top: max(18px, env(safe-area-inset-top, 0px));
          left: max(18px, env(safe-area-inset-left, 0px));
          display: flex;
          align-items: baseline;
          gap: 7px;
          max-width: calc(100% - 40px);
          color: rgba(245, 230, 190, .82);
          font: 11px/1.2 var(--font-text);
          letter-spacing: .08em;
          text-transform: lowercase;
          text-shadow: 0 1px 10px #06141d;
        }
        .living-atlas__breadcrumb {
          min-height: 32px;
          padding: 0;
          border: 0;
          background: none;
          color: #f1d78d;
          font: inherit;
          letter-spacing: inherit;
          cursor: pointer;
        }
        .living-atlas__hotspot {
          position: absolute;
          z-index: 2;
          width: 54px;
          height: 54px;
          padding: 0;
          border: 0;
          border-radius: 50%;
          background: transparent;
          color: rgba(237, 201, 108, .92);
          cursor: pointer;
          transform: translate(-50%, -50%) scale(calc(1 / var(--atlas-zoom, 1)));
          transform-origin: center;
          transition: color 180ms ease, filter 180ms ease;
          overflow: visible;
          touch-action: manipulation;
        }
        .living-atlas__hotspot:hover,
        .living-atlas__hotspot:focus-visible,
        .living-atlas__hotspot.is-focused {
          color: #fff0b6;
          filter: drop-shadow(0 0 10px rgba(239, 197, 92, .66));
        }
        .living-atlas__mark {
          display: grid;
          place-items: center;
          width: 32px;
          height: 32px;
          margin: 11px;
          border-radius: 50%;
          background: rgba(6, 20, 29, .48);
          box-shadow: inset 0 0 0 1px rgba(245, 220, 154, .28), 0 0 0 6px rgba(5, 17, 25, .12);
          backdrop-filter: blur(1px);
        }
        .living-atlas__mark svg { width: 24px; height: 24px; }
        .living-atlas__label {
          position: absolute;
          left: 50%;
          top: calc(100% - 1px);
          transform: translateX(-50%);
          width: max-content;
          max-width: 150px;
          padding: 2px 5px;
          color: rgba(245, 232, 199, .9);
          background: rgba(3, 14, 21, .58);
          border-radius: 2px;
          font: 9px/1.3 var(--font-text);
          letter-spacing: .05em;
          text-shadow: 0 1px 5px #06141d;
          opacity: 0;
          transition: opacity 160ms ease;
          pointer-events: none;
        }
        .living-atlas__hotspot:hover .living-atlas__label,
        .living-atlas__hotspot:focus-visible .living-atlas__label,
        .living-atlas__hotspot.is-focused .living-atlas__label { opacity: 1; }
        .living-atlas__edge {
          position: absolute;
          z-index: 8;
          min-height: 44px;
          padding: 8px 10px;
          border: 0;
          background: none;
          color: rgba(239, 218, 165, .66);
          font: 9px/1 var(--font-text);
          letter-spacing: .12em;
          text-transform: lowercase;
          text-shadow: 0 1px 8px #06141d;
          cursor: pointer;
          transition: color 180ms ease;
        }
        .living-atlas__edge:hover,
        .living-atlas__edge:focus-visible { color: #f4d989; }
        .living-atlas__edge--north { top: 8px; left: 50%; transform: translateX(-50%); }
        .living-atlas__edge--south { bottom: 78px; left: 50%; transform: translateX(-50%); }
        .living-atlas__edge--west { left: 0; top: 50%; transform: translateY(-50%); writing-mode: vertical-rl; }
        .living-atlas__edge--east { right: 0; top: 50%; transform: translateY(-50%); writing-mode: vertical-rl; }
        .living-atlas__prompt {
          position: absolute;
          z-index: 10;
          left: 50%;
          bottom: max(20px, env(safe-area-inset-bottom, 0px));
          width: min(430px, calc(100% - 34px));
          height: 48px;
          transform: translateX(-50%);
          display: grid;
          grid-template-columns: 1fr 46px;
          align-items: center;
          border: 1px solid rgba(242, 222, 170, .32);
          border-radius: 999px;
          background: rgba(4, 17, 25, .72);
          box-shadow: 0 10px 38px rgba(0, 0, 0, .3);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
        }
        .living-atlas__prompt label {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
        }
        .living-atlas__prompt input {
          width: 100%;
          min-width: 0;
          height: 46px;
          padding: 0 4px 0 18px;
          border: 0;
          outline: 0;
          background: transparent;
          color: #f2e5c2;
          font: italic 16px/1.2 var(--font-serif);
        }
        .living-atlas__prompt input::placeholder { color: rgba(240, 225, 188, .58); }
        .living-atlas__prompt button {
          width: 44px;
          height: 44px;
          border: 0;
          border-radius: 50%;
          background: transparent;
          color: #f1d17c;
          font: 18px/1 var(--font-serif);
          cursor: pointer;
        }
        .living-atlas__prompt button:disabled { opacity: .28; cursor: default; }
        .living-atlas__status {
          position: absolute;
          z-index: 8;
          left: max(18px, env(safe-area-inset-left, 0px));
          bottom: max(27px, env(safe-area-inset-bottom, 0px));
          max-width: calc(50% - 230px);
          color: rgba(239, 222, 181, .58);
          font: 9px/1.4 var(--font-text);
          letter-spacing: .08em;
          text-transform: lowercase;
          pointer-events: none;
        }
        .living-atlas__status.is-busy {
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
          white-space: nowrap;
          border: 0;
        }
        .living-atlas__diffusion {
          position: absolute;
          z-index: 4;
          width: 1px;
          height: 1px;
          pointer-events: none;
        }
        .living-atlas__diffusion span {
          position: absolute;
          left: 0;
          top: 0;
          width: min(66vw, 620px);
          aspect-ratio: 1;
          border: 1px solid rgba(246, 211, 116, .36);
          border-radius: 50%;
          box-shadow: 0 0 70px rgba(54, 138, 148, .18), inset 0 0 90px rgba(245, 205, 102, .1);
          animation: atlas-diffuse 2.8s ease-out infinite;
        }
        .living-atlas__diffusion span + span { animation-delay: 1.15s; }
        .living-atlas__diffusion i {
          position: absolute;
          left: 0;
          top: 0;
          width: min(54vw, 520px);
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(244, 211, 126, .32), transparent);
          transform-origin: center;
          animation: atlas-rhumb 2.4s ease-in-out infinite alternate;
        }
        .living-atlas__diffusion i + i {
          transform: translate(-50%, -50%) rotate(71deg);
          animation-delay: -1.2s;
        }
        .living-atlas__ripple {
          position: absolute;
          z-index: 7;
          width: 12px;
          height: 12px;
          margin: -6px;
          border: 1px solid rgba(241, 212, 132, .86);
          border-radius: 50%;
          pointer-events: none;
          animation: atlas-ripple 1s ease-out forwards;
        }
        @keyframes atlas-diffuse {
          0% { transform: translate(-50%, -50%) scale(.12) rotate(0deg); opacity: 0; filter: blur(0); }
          18% { opacity: .8; }
          100% { transform: translate(-50%, -50%) scale(1.25) rotate(18deg); opacity: 0; filter: blur(10px); }
        }
        @keyframes atlas-rhumb {
          from { transform: translate(-50%, -50%) rotate(18deg) scaleX(.45); opacity: .12; }
          to { transform: translate(-50%, -50%) rotate(42deg) scaleX(1); opacity: .58; }
        }
        @keyframes atlas-ripple {
          to { transform: scale(12); opacity: 0; }
        }
        @media (max-width: 760px) {
          .living-atlas__stage { min-height: 540px; }
          .living-atlas__masthead { top: 12px; left: 14px; max-width: calc(100% - 28px); }
          .living-atlas__edge--north { top: 18px; }
          .living-atlas__edge--south { bottom: 72px; }
          .living-atlas__edge--west,
          .living-atlas__edge--east { writing-mode: horizontal-tb; }
          .living-atlas__status { display: none; }
          .living-atlas__hotspot {
            width: 64px;
            height: 64px;
          }
          .living-atlas__mark {
            width: 36px;
            height: 36px;
            margin: 14px;
          }
          .living-atlas__prompt {
            bottom: max(14px, env(safe-area-inset-bottom, 0px));
            width: calc(100% - 28px);
          }
          .living-atlas__image--incoming { transition-duration: 380ms; }
        }
        @media (prefers-reduced-motion: reduce) {
          .living-atlas__plane,
          .living-atlas__image--incoming { transition-duration: 1ms; }
          .living-atlas__diffusion span,
          .living-atlas__ripple { animation: none; }
        }
      `}</style>
    </section>
  );
}
