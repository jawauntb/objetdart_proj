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
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { useField } from "@/store/field";

const ORIGIN_MAP = "/atlas/atlas-origin.webp";
const FOLDED_MAP = "/atlas/atlas-folded.webp";
const MOBILE_ORIGIN_MAP = "/atlas/atlas-origin-mobile.webp";
const MOBILE_FOLDED_MAP = "/atlas/atlas-folded-mobile.webp";
const DESKTOP_MAP_ASPECT = 4 / 3;
const MOBILE_MAP_ASPECT = 853 / 1538;
const MOBILE_BREAKPOINT = 760;

type Direction = "north" | "east" | "south" | "west";
type GenerationMode = "generate" | "zoom" | "shift";
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
  if (mobile && source === FOLDED_MAP) return MOBILE_FOLDED_MAP;
  if (!mobile && source === MOBILE_ORIGIN_MAP) return ORIGIN_MAP;
  if (!mobile && source === MOBILE_FOLDED_MAP) return FOLDED_MAP;
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
  const minX = metrics.width - metrics.mapWidth * view.zoom;
  const minY = metrics.height - metrics.mapHeight * view.zoom;
  return {
    zoom: clamp(view.zoom, 1, 4),
    x: clamp(view.x, minX - overscroll, overscroll),
    y: clamp(view.y, minY - overscroll, overscroll),
  };
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
};
type PinchGesture = {
  distance: number;
  midpoint: PointerPoint;
  view: MapView;
};

export default function Atlas() {
  const setRegion = useField((state) => state.setRegion);
  const recordTape = useField((state) => state.recordTape);

  const stageRef = useRef<HTMLDivElement>(null);
  const metricsRef = useRef<MapMetrics>(EMPTY_METRICS);
  const viewRef = useRef<MapView>({ x: 0, y: 0, zoom: 1 });
  const pointersRef = useRef(new Map<number, PointerPoint>());
  const dragRef = useRef<DragGesture | null>(null);
  const pinchRef = useRef<PinchGesture | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestRef = useRef(0);
  const crossfadeRef = useRef<number | null>(null);
  const revealRef = useRef<number | null>(null);
  const activeImageRef = useRef(ORIGIN_MAP);

  const [metrics, setMetrics] = useState<MapMetrics>(EMPTY_METRICS);
  const [view, setView] = useState<MapView>({ x: 0, y: 0, zoom: 1 });
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
  const [status, setStatus] = useState("tap a mark · drag the chart · pinch to breathe");
  const [interacting, setInteracting] = useState(false);
  const [pulse, setPulse] = useState<{ x: number; y: number; key: number } | null>(null);

  const commitView = (next: MapView) => {
    viewRef.current = next;
    setView(next);
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
      setMetrics(nextMetrics);
      setView(nextView);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (crossfadeRef.current !== null) window.clearTimeout(crossfadeRef.current);
      if (revealRef.current !== null) window.clearTimeout(revealRef.current);
    };
  }, []);

  const crossfadeTo = (source: string) => {
    const nextSource = responsiveMapSource(source, metricsRef.current.width);
    if (!nextSource || nextSource === activeImageRef.current) return;
    if (crossfadeRef.current !== null) window.clearTimeout(crossfadeRef.current);
    if (revealRef.current !== null) window.clearTimeout(revealRef.current);
    setIncomingVisible(false);
    setIncomingImage(nextSource);
    revealRef.current = window.setTimeout(() => setIncomingVisible(true), 24);
    crossfadeRef.current = window.setTimeout(() => {
      activeImageRef.current = nextSource;
      setActiveImage(nextSource);
      setIncomingImage(null);
      setIncomingVisible(false);
    }, 880);
  };

  const resetOuterMap = () => {
    setFocusedId(null);
    setFocusedLabel(null);
    setRegion(null);
    commitView(centerView(metricsRef.current));
    setStatus("outer map · choose another mark or cross an edge");
  };

  const generateMap = async ({
    mode,
    subjectPrompt,
    focus,
    direction,
    optimisticSeeds,
  }: {
    mode: GenerationMode;
    subjectPrompt: string;
    focus?: { x: number; y: number; zoom: number };
    direction?: Direction;
    optimisticSeeds?: MapSeeds;
  }) => {
    const requestId = ++requestRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const currentImage = activeImageRef.current;
    setBusy(true);
    if (optimisticSeeds) setSeeds(optimisticSeeds);
    if (mode !== "zoom") crossfadeTo(FOLDED_MAP);

    const box = stageRef.current?.getBoundingClientRect();
    try {
      const response = await fetch("/api/atlas/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          prompt: subjectPrompt.replace(/ +/g, " ").trim().slice(0, 240),
          currentImage,
          mode,
          direction,
          focus,
          viewport: {
            width: Math.round(box?.width ?? 0),
            height: Math.round(box?.height ?? 0),
          },
        }),
      });
      if (!response.ok) throw new Error("The atlas could not be redrawn.");
      const data = await response.json() as unknown;
      if (!isRecord(data)) throw new Error("The atlas returned an unreadable chart.");
      if (requestId !== requestRef.current) return;
      const nextHotspots = normaliseHotspots(data.hotspots);
      if (nextHotspots) setHotspots(nextHotspots);
      setSeeds((current) => normaliseSeeds(data.seeds, current));
      if (typeof data.dataUrl === "string" && data.dataUrl) {
        crossfadeTo(data.dataUrl);
        setStatus(mode === "zoom" ? "the region has deepened" : "a new atlas has surfaced");
      } else {
        setStatus("the local atlas is ready to explore");
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setStatus(error instanceof Error ? error.message : "The atlas held its present shape.");
    } finally {
      if (requestId === requestRef.current) setBusy(false);
    }
  };

  const enterHotspot = (hotspot: MapHotspot) => {
    const nextZoom = Math.max(2.15, Math.min(3, viewRef.current.zoom + 0.85));
    const next = boundView({
      zoom: nextZoom,
      x: metricsRef.current.width / 2 - hotspot.x * metricsRef.current.mapWidth * nextZoom,
      y: metricsRef.current.height / 2 - hotspot.y * metricsRef.current.mapHeight * nextZoom,
    }, metricsRef.current);
    setFocusedId(hotspot.id);
    setFocusedLabel(hotspot.label);
    setRegion(hotspot.regionId);
    commitView(next);
    setStatus("diffusing detail around " + hotspot.label.toLowerCase());
    try {
      getFieldAudio().chime();
      haptics.roll();
    } catch {
      // Sound and haptics are progressive enhancement.
    }
    recordTape("region", 0.84, "atlas/zoom/" + hotspot.id);
    void generateMap({
      mode: "zoom",
      subjectPrompt: [concept, hotspot.prompt || hotspot.label].filter(Boolean).join(" · "),
      focus: { x: hotspot.x, y: hotspot.y, zoom: nextZoom },
    });
  };

  const shiftMap = (direction: Direction) => {
    const seed = seeds[direction];
    setFocusedId(null);
    setFocusedLabel(null);
    setRegion(null);
    setConcept(seed);
    commitView(centerView(metricsRef.current));
    setStatus("crossing " + direction + " toward " + seed);
    recordTape("region", 0.72, "atlas/shift/" + direction + "/" + seed);
    void generateMap({
      mode: "shift",
      direction,
      optimisticSeeds: localSeeds(seed),
      subjectPrompt: seed,
    });
  };

  const submitPrompt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const raw = prompt.trim();
    if (!raw) return;
    setPrompt("");
    setConcept(raw);
    setFocusedId(null);
    setFocusedLabel(null);
    setRegion(null);
    commitView(centerView(metricsRef.current));
    setStatus("drawing a map of " + raw);
    recordTape("imagine", 0.94, "atlas/" + raw.slice(0, 32));
    void generateMap({
      mode: "generate",
      optimisticSeeds: localSeeds(raw),
      subjectPrompt: raw,
    });
  };

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("form, input, button")) return;
    event.preventDefault();
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const current = viewRef.current;
    const nextZoom = clamp(current.zoom * Math.exp(-event.deltaY * 0.0015), 1, 4);
    if (nextZoom <= 1.015) {
      resetOuterMap();
      return;
    }
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const worldX = (point.x - current.x) / current.zoom;
    const worldY = (point.y - current.y) / current.zoom;
    commitView(boundView({
      zoom: nextZoom,
      x: point.x - worldX * nextZoom,
      y: point.y - worldY * nextZoom,
    }, metricsRef.current));
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("form, input, button, [data-map-ui]")) return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    pointersRef.current.set(event.pointerId, point);
    setInteracting(true);
    if (pointersRef.current.size === 1) {
      dragRef.current = {
        pointerId: event.pointerId,
        start: point,
        view: viewRef.current,
        moved: false,
      };
      pinchRef.current = null;
    } else if (pointersRef.current.size === 2) {
      const points = Array.from(pointersRef.current.values());
      pinchRef.current = {
        distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y),
        midpoint: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 },
        view: viewRef.current,
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
      const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
      const midpoint = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
      const start = pinchRef.current;
      const zoom = clamp(start.view.zoom * distance / Math.max(1, start.distance), 1, 4);
      const worldX = (start.midpoint.x - start.view.x) / start.view.zoom;
      const worldY = (start.midpoint.y - start.view.y) / start.view.zoom;
      commitView(boundView({
        zoom,
        x: midpoint.x - worldX * zoom,
        y: midpoint.y - worldY * zoom,
      }, metricsRef.current, 28));
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    if (Math.hypot(dx, dy) > 7) drag.moved = true;
    commitView(boundView({
      zoom: drag.view.zoom,
      x: drag.view.x + dx,
      y: drag.view.y + dy,
    }, metricsRef.current, 52));
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
        view: viewRef.current,
        moved: true,
      };
      pinchRef.current = null;
      return;
    }

    setInteracting(false);
    pinchRef.current = null;
    const bounded = boundView(viewRef.current, metricsRef.current);
    const overflow: Array<[Direction, number]> = [
      ["west", viewRef.current.x - bounded.x],
      ["east", bounded.x - viewRef.current.x],
      ["north", viewRef.current.y - bounded.y],
      ["south", bounded.y - viewRef.current.y],
    ];
    const crossed = overflow.sort((a, b) => b[1] - a[1])[0];
    if (!cancelled && crossed[1] > 28) {
      commitView(bounded);
      shiftMap(crossed[0]);
    } else {
      commitView(bounded);
      if (!cancelled && drag && !drag.moved && point) {
        if (viewRef.current.zoom > 1.05 || focusedId) {
          resetOuterMap();
        } else {
          setPulse({ x: point.x, y: point.y, key: Date.now() });
          setStatus("the water remembers the touch");
          recordTape("ripple", 0.38, "atlas/water");
        }
      }
    }
    dragRef.current = null;
  };

  const planeStyle: CSSProperties = {
    width: metrics.mapWidth || "100%",
    height: metrics.mapHeight || "100%",
    transform: "translate3d(" + view.x + "px," + view.y + "px,0) scale(" + view.zoom + ")",
    transition: interacting ? "none" : "transform 760ms cubic-bezier(.2,.72,.18,1)",
  };

  return (
    <section id="atlas" className="living-atlas" data-touch-surface="true" data-pretext-ignore>
      <div
        ref={stageRef}
        className={"living-atlas__stage" + (busy ? " is-generating" : "")}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => finishPointer(event)}
        onPointerCancel={(event) => finishPointer(event, true)}
        onDoubleClick={resetOuterMap}
        role="application"
        aria-label="Living atlas. Drag to travel, pinch or wheel to zoom, and select a landmark to enter it."
      >
        <div className="living-atlas__plane" style={planeStyle}>
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
                  transform: "translate(-50%,-50%) scale(" + (1 / view.zoom) + ")",
                }}
                onClick={(event) => {
                  event.stopPropagation();
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
          <div className="living-atlas__diffusion" aria-hidden="true">
            <span />
            <span />
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

        <div className="living-atlas__status" role="status" aria-live="polite" data-map-ui="true">
          {busy ? "the ink is moving…" : status}
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
          cursor: grab;
        }
        .living-atlas__stage:active { cursor: grabbing; }
        .living-atlas__plane {
          position: absolute;
          left: 0;
          top: 0;
          transform-origin: 0 0;
          will-change: transform;
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
          transform-origin: center;
          transition: color 180ms ease, filter 180ms ease;
          overflow: visible;
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
        .living-atlas__diffusion {
          position: absolute;
          z-index: 4;
          inset: 0;
          display: grid;
          place-items: center;
          pointer-events: none;
          overflow: hidden;
        }
        .living-atlas__diffusion span {
          position: absolute;
          width: min(66vw, 620px);
          aspect-ratio: 1;
          border: 1px solid rgba(246, 211, 116, .36);
          border-radius: 50%;
          box-shadow: 0 0 70px rgba(54, 138, 148, .18), inset 0 0 90px rgba(245, 205, 102, .1);
          animation: atlas-diffuse 2.8s ease-out infinite;
        }
        .living-atlas__diffusion span + span { animation-delay: 1.15s; }
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
          0% { transform: scale(.12); opacity: 0; filter: blur(0); }
          18% { opacity: .8; }
          100% { transform: scale(1.25); opacity: 0; filter: blur(10px); }
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
          .living-atlas__prompt {
            bottom: max(14px, env(safe-area-inset-bottom, 0px));
            width: calc(100% - 28px);
          }
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
