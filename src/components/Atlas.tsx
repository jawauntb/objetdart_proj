"use client";

import Image from "next/image";
import {
  useEffect,
  useMemo,
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
  type AtlasClipRect,
} from "@/lib/atlas-batch";
import {
  ATLAS_ZOOM_SPEC,
  atlasGenerationIsCurrent,
} from "@/lib/atlas-navigation";
import {
  boundViewToBounds,
  cellAt,
  cellRect,
  deepestTileAt,
  dynamicZoomFloor,
  exploredBounds,
  focusForSheet,
  hasZoomHeadroom,
  placeChildRect,
  resolvePlaneEdgeTravel,
  tileNeedsDetail,
  viewForCenter,
  worldCenter,
  worldPointAtScreen,
  type PlaneRect,
  type PlaneTile,
} from "@/lib/atlas-plane";
import { atlasBaseConcept, atlasNamePart } from "@/lib/atlas-naming";
import { prepareAtlasSourceImage } from "@/lib/atlas-source";
import {
  ATLAS_WORLD_ORIGIN,
  addressKey,
  addressesEqual,
  createAtlasWorld,
  shiftAddress,
  zoomLabelTier,
  type AtlasWorldAddress,
  type AtlasWorldSheet,
} from "@/lib/atlas-world";
import { getFieldAudio } from "@/lib/audio";
import { PLANET_DESCENT_KEY } from "@/lib/stars/nestedCosmos";
import { intensityFrom, tapTrainTier, THRESHOLDS } from "@/lib/gesture/core";
import { attachGestures } from "@/lib/gesture";
import { onVessel } from "@/lib/vessel";
import * as haptics from "@/lib/haptics";
import { resolveDpr, onGalleryPause, onVisibility, isEmbeddedFrame, createFrameGovernor, detailForTier } from "@/lib/room-runtime";
import { bakeRadialSprite, drawRadialStamp } from "@/lib/scene/radial-sprite";
import { useField } from "@/store/field";
import { useBandEdgeTravel } from "@/components/ScaleTravel";
import LetGo from "@/components/LetGo";

const ORIGIN_MAP = "/atlas/atlas-origin.webp";
const MOBILE_ORIGIN_MAP = "/atlas/atlas-origin-mobile.webp";
const DESKTOP_MAP_ASPECT = 4 / 3;
const MOBILE_MAP_ASPECT = 853 / 1538;
const MOBILE_BREAKPOINT = 760;
// The deep clamp comes from the room's manifold spec so the camera's
// range and its band walls (coast below, earth above) can never disagree;
// the shallow floor is dynamic — it falls as the explored plane grows.
const MAX_ZOOM = ATLAS_ZOOM_SPEC.zoomMax;
const SETTLE_TRANSITION = "transform 180ms cubic-bezier(.22,.8,.24,1)";
// Travel between cells is a real camera glide across the plane.
const GLIDE_TRANSITION = "transform 640ms cubic-bezier(.3,.7,.2,1)";
const MOBILE_ZOOM_SETTLE_MS = 520;
const DESKTOP_ZOOM_SETTLE_MS = 620;
const DRAG_THRESHOLD_PX = 14;
const EDGE_TRAVEL_RATIO = 0.15;
// Long-press planting: hold on the map through the dwell tier to leave
// a natural (mostly a cairn, sometimes a wildflower, rarely an animal
// trail). This used to be a private 1800ms timer — a threshold shadowing
// the grammar's own dwell tier (gesture/core.ts THRESHOLDS.dwellMs,
// 900ms). Never redefine a threshold: the plant now fires at the
// engine's own dwell tier, like every other room's long-press.
const ATLAS_PLANT_MS = THRESHOLDS.dwellMs;

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
type GenerationIntent = {
  mode: GenerationMode;
  subjectPrompt: string;
  focus?: { x: number; y: number; zoom: number };
  direction?: Direction;
  clip?: AtlasClipRect;
  optimisticSeeds?: MapSeeds;
  prefetchNeighbors?: boolean;
  sourceImage?: string;
  // Whether the landing joins the standing plane (a lateral cell, a
  // deeper child tile, an in-place refine) or replaces the plane whole
  // (a new subject, a wider territory). Same-plane landings never move
  // the camera; new-plane landings wait for a still hand.
  plane: "same" | "new";
  // The cell a lateral landing occupies (defaults derive from mode).
  targetCell?: AtlasWorldAddress;
  // Where a zoom child lands on the plane, in root-cell units.
  childRect?: { x: number; y: number; width: number; height: number };
  // Pyramid level of a zoom child (parent level + 1).
  level?: number;
  // Travel that is waiting on this landing: glide the camera onto the
  // cell and adopt it when the sheet arrives.
  glideOnLand?: boolean;
};
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
// A whole plane kept for the history stack: every remembered sheet,
// every child tile, and where the traveler stood — so stepping back
// restores the world, not just a picture.
type MapSnapshot = {
  sheets: Array<AtlasWorldSheet<MapHotspot[], MapSeeds>>;
  children: PlaneTile[];
  address: AtlasWorldAddress;
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
// A new plane that landed while a hand was still on the map — applied
// once the camera settles so an arrival never fights the gesture.
type LandedPlane = {
  image: string;
  hotspots: MapHotspot[] | null;
  seeds: MapSeeds;
  concept: string;
  phase: GenerationPhase;
  depth: number;
  generationId: string;
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

// The optimistic twin of the server's edge naming: shown the instant a
// concept is submitted, before any sheet has landed. It used to carry its
// own private word families (ember/smoke/cinder, tower/market/alley…),
// which meant the edges visibly changed their names when the server's
// answer arrived — and, since an edge name is the subject Atlas generates
// for the ground beyond it, the two vocabularies disagreed about what the
// neighboring world even was. Both sides now name the same way: the
// subject, and which way you left it.
function localSeeds(prompt: string): MapSeeds {
  const base = atlasBaseConcept(prompt);
  return {
    north: base + " · northern reaches",
    east: base + " · eastern reaches",
    south: base + " · southern reaches",
    west: base + " · western reaches",
  };
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

const TILE_CROSSFADE_MS = 560;

// A tile's DOM key stays fixed across its own lifetime (a landing sheet
// upgrades a preview to a final in place, a re-rooted plane's origin
// sheet does the same), so React never remounts it and the plain CSS
// mount animation on .living-atlas__tile never gets to replay for that
// swap. Without this, a sharper drawing arriving under the same id was a
// hard cut — the ground now blends into the ground it replaces.
function AtlasTileImage({ src, priority }: { src: string; priority: boolean }) {
  const [shown, setShown] = useState(src);
  const [incoming, setIncoming] = useState<string | null>(null);
  const [incomingVisible, setIncomingVisible] = useState(false);
  const shownRef = useRef(src);

  useEffect(() => {
    if (src === shownRef.current) return;
    setIncoming(src);
    setIncomingVisible(false);
    const raf = window.requestAnimationFrame(() => setIncomingVisible(true));
    const settle = window.setTimeout(() => {
      shownRef.current = src;
      setShown(src);
      setIncoming(null);
      setIncomingVisible(false);
    }, TILE_CROSSFADE_MS);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(settle);
    };
  }, [src]);

  return (
    <>
      <Image
        className="living-atlas__image"
        src={shown}
        alt=""
        fill
        sizes="100vw"
        priority={priority}
        unoptimized
        draggable={false}
      />
      {incoming && (
        <Image
          className={"living-atlas__image living-atlas__image--incoming" + (incomingVisible ? " is-visible" : "")}
          src={incoming}
          alt=""
          fill
          sizes="100vw"
          unoptimized
          draggable={false}
        />
      )}
    </>
  );
}

// ── living-atlas atmosphere types ───────────────────────────────
// Naturals ride the map plane (positions are normalized to the plane's
// dimensions), so a cairn placed on a coastline stays on that coastline
// as the user pans and zooms. Weather events are frame-relative — the
// sky belongs to the viewport, not the terrain — modelled after the
// Ocean weather scheduler.
type AtlasNaturalKind = "cairn" | "flower" | "trail";
type AtlasNatural = {
  id: string;
  kind: AtlasNaturalKind;
  nx: number;
  ny: number;
  seed: number;
  createdAt: number;
  lastSeen: number;
  // For "trail" kind only: a short arc of small offsets from (nx, ny)
  // in normalized map coords, so the whole path scales with the plane.
  trail?: Array<{ dx: number; dy: number }>;
};
type AtlasWeatherEvent =
  | { kind: "flock"; t0: number; duration: number; count: number; yBase: number; dir: 1 | -1; seed: number }
  | { kind: "cloud"; t0: number; duration: number; y: number; dir: 1 | -1; radius: number; alpha: number }
  | { kind: "gust"; t0: number; duration: number; y: number; dir: 1 | -1 }
  | { kind: "sunbeam"; t0: number; duration: number; y: number; dir: 1 | -1 }
  | { kind: "migration"; t0: number; duration: number; count: number; yBase: number; dir: 1 | -1; seed: number }
  | { kind: "meteor"; t0: number; duration: number; x0: number; y0: number; dx: number; dy: number };

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

// The gesture grammar here, conservatively: the material and map layers
// (one-finger drag/tap/plant, two-finger pinch through the band walls
// via useBandEdgeTravel) are a hand-tuned pointer state machine that
// already speaks the grammar faithfully — it is not migrated onto
// attachGestures in this pass, because the risk of a subtle regression
// in that physics (pinch floor/ceiling, plant-vs-drag disambiguation,
// inertia) outweighs any benefit of moving working code, and the spec
// that governs this room says so explicitly: preserve every behaviour,
// do not redesign. The one real bug in that system — a private
// ATLAS_PLANT_MS shadowing the grammar's own dwell tier — is fixed
// (see its definition above). Everything the room had none of is
// additive, mounted alongside via a second, noCapture attachGestures
// call: three-finger tap (tutti), twist(2) (the lens — the traverse
// chart, the map and not the territory, swells briefly), three-finger
// drag (wind, leaning the way the hand pushed), three-finger hold
// (time dilation — the sim clock driving every periodic wobble slows
// continuously while held), three-finger twist (season — the atlas
// keeps no day, but the sky keeps habits: the year turns and the
// weather mix follows), the rapid-tap train (a second tap deepens the
// ripple; three raise birds from the tapped ground; five call a
// migration; seven and more, the whole sky answers), a circular scrub
// (stirs the cloud shadows along the winding), a steady rhythm (the
// weather arrives on the hand's pulse for a few rounds), and the
// vessel (shake gusts by how hard it was shaken, a knock is tutti,
// face-down is night). Tilt is left unbound — there is no honest
// gravity in a map seen from directly above (the registry carries the
// sentence). The naturals a hand plants are the room's countable
// material; the shared <LetGo/> below is their whole-field clear. A
// per-mark ceremony-hold delete was deliberately not added: it would
// share the same touch as the existing plant timer and could delete
// the wrong mark or plant on top of the one being held — a correctness
// risk the conservative mandate for this room says to leave alone
// rather than rush.
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
  // Time of the previous pinch event, for the manifold's residual velocity.
  const pinchAtRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const requestRef = useRef(0);
  const generationIdRef = useRef<string | null>(null);
  const phaseRankRef = useRef(0);
  const regionSettleRef = useRef<number | null>(null);
  const zoomSettleRef = useRef<number | null>(null);
  // Debounce for "wider territory" generation triggered by zoom-out at the floor.
  const lastWidenAtRef = useRef(0);
  const historyRef = useRef<MapSnapshot[]>([]);
  const inertiaRef = useRef<number | null>(null);
  const interactingRef = useRef(false);
  const generationDepthRef = useRef(0);
  const generationIntentRef = useRef<GenerationIntent | null>(null);
  // Floor-pinch contractions only mint a wider chart after the fingers
  // settle — never mid-gesture, or a late response can land under a moving hand.
  const pendingWiderTerritoryRef = useRef(false);
  const neighborAbortRef = useRef<AbortController | null>(null);
  // The world chart: sheets remembered by integer address on the current
  // plane (see src/lib/atlas-world.ts). The camera roams the whole plane —
  // sheets render adjacent at their addresses and panning crosses them
  // bodily; a new subject or a wider territory mints a fresh plane.
  const worldRef = useRef(createAtlasWorld<MapHotspot[], MapSeeds>());
  const worldAddressRef = useRef<AtlasWorldAddress>({ ...ATLAS_WORLD_ORIGIN });
  // Zoom children: deeper drawings of fractional ground, layered above
  // their parents at their world rects — the pyramid. Reset per plane.
  const childTilesRef = useRef<PlaneTile[]>([]);
  // The previous plane's tiles, kept beneath a newly landing plane while
  // it fades in, then released.
  const retiringTilesRef = useRef<PlaneTile[]>([]);
  const retireTimerRef = useRef<number | null>(null);
  // Every tile currently mounted (cells + children), mirrored for the
  // per-frame label-tier and detail checks without re-rendering.
  const allTilesRef = useRef<PlaneTile[]>([]);
  // Monotonic plane epoch, part of tile ids so React remounts tiles
  // across plane swaps (replaying the fade-in) but not within one plane.
  const planeEpochRef = useRef(0);
  // Cells a background speculation is currently drawing (absolute keys),
  // and the cell a traveler is waiting to glide onto when it lands.
  const pendingCellsRef = useRef(new Set<string>());
  const awaitedCellRef = useRef<AtlasWorldAddress | null>(null);
  // A landed new plane held until the hand lifts (see LandedPlane).
  const pendingPlaneRef = useRef<LandedPlane | null>(null);
  // The generation whose plane swap has already happened, so its second
  // phase upgrades the origin sheet in place instead of swapping again.
  const planeAppliedForRef = useRef<string | null>(null);
  // Dedupe for settled child-detail requests.
  const childRequestKeyRef = useRef<string | null>(null);
  const pointerStartRef = useRef<PointerPoint | null>(null);
  const lastGestureAtRef = useRef(0);
  const edgeTravelLockRef = useRef(false);
  // Living-atlas atmosphere: an overlay canvas that always redraws so the
  // map has weather, cloud shadows drift over the land, and cairns/
  // flowers/animal trails the user leaves survive across sessions.
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const plantTimersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const addNaturalRef = useRef<((kind: AtlasNaturalKind, nx: number, ny: number) => void) | null>(null);
  // create/delete law: naturals are the atlas's countable material —
  // addNatural above is the create, these two are the take-away. A
  // ceremony hold near a mark is its own solemn act (annihilate); the
  // shared <LetGo/> is the whole-field clear, both bridged the same way
  // addNatural is, so the pointer/gesture layers never reach into the
  // render effect's closure directly.
  const removeNaturalRef = useRef<((id: string) => void) | null>(null);
  const clearNaturalsRef = useRef<(() => void) | null>(null);
  const [naturalsCount, setNaturalsCount] = useState(0);
  // twist(2) = rotate the lens: the traverse mini-map (the map, not the
  // territory) flashes into prominence — the same representation, read
  // differently for a moment.
  const [lensFlash, setLensFlash] = useState(false);

  const [metrics, setMetrics] = useState<MapMetrics>(EMPTY_METRICS);
  const [hotspots, setHotspots] = useState(DEFAULT_HOTSPOTS);
  const [seeds, setSeeds] = useState(DEFAULT_SEEDS);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [focusedLabel, setFocusedLabel] = useState<string | null>(null);
  const [concept, setConcept] = useState("illuminated territories");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const [busyFocus, setBusyFocus] = useState<{ x: number; y: number } | null>(null);
  const [renderPhase, setRenderPhase] = useState<RenderPhase>("idle");
  const [historyDepth, setHistoryDepth] = useState(0);
  const [generationDepth, setGenerationDepth] = useState(0);
  const [status, setStatus] = useState("tap a mark · drag the chart · pinch to breathe");
  const [interacting, setInteracting] = useState(false);
  const [pulse, setPulse] = useState<{ x: number; y: number; key: number; intensity: number } | null>(null);
  // How hard the last touch meant it (0..1 from gesture/core) — the tap's
  // ripple and the region halo it lands on both ride this.
  const lastTapIntensityRef = useRef(0.5);
  // Glimmer (grammar §6): after ~20s of quiet the map hints a route
  // physically — one mark's halo swells once, never a label, never text.
  const [glimmerId, setGlimmerId] = useState<string | null>(null);
  // Bumped whenever the remembered world or the standing address changes,
  // so the tile plane, traverse chart, and edge names re-read the world.
  const [worldVersion, setWorldVersion] = useState(0);
  // Bumped when child or retiring tiles change (they live in refs so the
  // per-frame paths can read them without re-rendering).
  const [tileVersion, setTileVersion] = useState(0);

  // The scale manifold at the sheet's walls. A single pinch-out at
  // fit-to-view still mints a wider chart (the room's own answer);
  // only pinch held past that answer presses toward the earth. At the
  // deepest zoom the sustained pinch presses down toward the coast.
  const {
    report: reportScaleEdge,
    release: releaseScaleEdge,
    reset: resetScaleEdge,
    overlay: scaleEdgeOverlay,
  } = useBandEdgeTravel("/atlas/origin", ATLAS_ZOOM_SPEC);

  const rememberWorldSheet = (sheet: AtlasWorldSheet<MapHotspot[], MapSeeds>) => {
    worldRef.current.remember(sheet);
    setWorldVersion((version) => version + 1);
  };

  const moveWorldAddress = (address: AtlasWorldAddress) => {
    worldAddressRef.current = { ...address };
    setWorldVersion((version) => version + 1);
  };

  const originWorldSheet = (): AtlasWorldSheet<MapHotspot[], MapSeeds> => ({
    address: { ...ATLAS_WORLD_ORIGIN },
    image: ORIGIN_MAP,
    hotspots: DEFAULT_HOTSPOTS,
    seeds: DEFAULT_SEEDS,
    concept: "illuminated territories",
    phase: "final",
    depth: 0,
  });

  // Clamp the camera to explored ground: the union of remembered cells
  // (always including the standing one), with the overview floor falling
  // as the world grows so the whole walked plane can be surveyed.
  const boundCamera = (view: MapView, metrics: MapMetrics, overscroll = 0): MapView => {
    const bounds = exploredBounds(worldRef.current.visited(), worldAddressRef.current);
    return boundViewToBounds(
      view,
      metrics,
      bounds,
      dynamicZoomFloor(bounds, metrics),
      MAX_ZOOM,
      overscroll,
    );
  };

  const cameraZoomFloor = (metrics: MapMetrics): number => dynamicZoomFloor(
    exploredBounds(worldRef.current.visited(), worldAddressRef.current),
    metrics,
  );

  const centerOnCell = (address: AtlasWorldAddress, zoom: number): MapView => boundCamera(
    viewForCenter(metricsRef.current, { wx: address.wx + 0.5, wy: address.wy + 0.5 }, zoom),
    metricsRef.current,
  );

  const paintPlane = (next: MapView, transition: string | null) => {
    const plane = planeRef.current;
    if (!plane) return;
    plane.style.transition = transition ?? "none";
    plane.style.transform = viewTransform(next);
    plane.style.setProperty("--atlas-zoom", String(next.zoom));
    // Label tier rides the camera, relative to the deepest tile under it:
    // names surface as ground nears its own fit, so descending into a
    // freshly drawn child quiets the labels again until it too is outrun.
    const stage = stageRef.current;
    if (stage) {
      const deep = deepestTileAt(allTilesRef.current, worldCenter(next, metricsRef.current));
      const tier = zoomLabelTier(deep ? next.zoom * deep.rect.width : next.zoom);
      if (stage.dataset.zoomTier !== tier) stage.dataset.zoomTier = tier;
    }
  };

  const stopInertia = () => {
    if (inertiaRef.current !== null) {
      window.cancelAnimationFrame(inertiaRef.current);
      inertiaRef.current = null;
    }
  };

  const commitView = (next: MapView, options?: { animate?: boolean; transition?: string }) => {
    viewRef.current = next;
    const wants = Boolean(options?.animate) && !interactingRef.current;
    paintPlane(next, wants ? options?.transition ?? SETTLE_TRANSITION : null);
  };

  const applyLiveView = (next: MapView) => {
    viewRef.current = next;
    paintPlane(next, null);
  };

  const markGesture = () => {
    lastGestureAtRef.current = performance.now();
  };

  const tryEdgeTravel = (velocity?: PointerPoint) => {
    if (edgeTravelLockRef.current) return false;
    const metrics = metricsRef.current;
    const view = viewRef.current;
    if (!metrics.width) return false;
    // Only the true frontier — the edge of explored ground — answers with
    // travel. Panning across interior cells is ordinary movement.
    const bounds = exploredBounds(worldRef.current.visited(), worldAddressRef.current);
    const margin = Math.max(32, Math.min(metrics.width, metrics.height) * EDGE_TRAVEL_RATIO);
    const direction = resolvePlaneEdgeTravel(view, metrics, bounds, velocity ?? { x: 0, y: 0 }, margin);
    if (!direction) return false;
    edgeTravelLockRef.current = true;
    markGesture();
    stopInertia();
    interactingRef.current = false;
    setInteracting(false);
    commitView(boundCamera(view, metrics), { animate: true });
    travel(direction);
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
      commitView(boundCamera(viewRef.current, metricsRef.current), { animate: true });
      scheduleSettle();
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
        commitView(boundCamera(viewRef.current, metricsRef.current), { animate: true });
        scheduleSettle();
        return;
      }
      applyLiveView(boundCamera({
        zoom: viewRef.current.zoom,
        x: viewRef.current.x + vx * dt,
        y: viewRef.current.y + vy * dt,
      }, metricsRef.current, 72));
      inertiaRef.current = window.requestAnimationFrame(tick);
    };
    inertiaRef.current = window.requestAnimationFrame(tick);
  };

  // Ambient audio bed: compass drone + map-paper air. The atlas page
  // route already sets this on mount; the redundant call here matches
  // Ocean.tsx and covers the case where <Atlas /> is embedded outside
  // its own page.
  useEffect(() => {
    try { getFieldAudio().setAmbientProfile("atlas"); } catch { /* noop */ }
  }, []);

  // The origin coast is the world's first remembered sheet, so a traveler
  // who crosses an edge and doubles back lands home without a redraw.
  useEffect(() => {
    worldRef.current.remember(originWorldSheet());
    setWorldVersion((version) => version + 1);
    // one-shot seed at mount; the helper reads only constants
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Glimmer scheduler: a quiet map occasionally lets one mark's halo
  // swell — a physical hint of where a tap would land. Skipped under
  // reduced motion, while generating, and while any hand is on the map.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let clearTimer: number | null = null;
    const tick = window.setInterval(() => {
      if (document.hidden || busy || interactingRef.current) return;
      if (performance.now() - lastGestureAtRef.current < 20000) return;
      if (hotspots.length === 0) return;
      const pick = hotspots[Math.floor(Math.random() * hotspots.length)];
      setGlimmerId(pick.id);
      if (clearTimer) window.clearTimeout(clearTimer);
      clearTimer = window.setTimeout(() => setGlimmerId(null), 2600);
      // re-arm the idle window so the hint stays rare
      lastGestureAtRef.current = performance.now() - 12000;
    }, 7000);
    return () => {
      window.clearInterval(tick);
      if (clearTimer) window.clearTimeout(clearTimer);
    };
  }, [busy, hotspots]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const resize = () => {
      const rect = stage.getBoundingClientRect();
      const nextMetrics = measureMap(rect.width, rect.height);
      const previous = metricsRef.current;
      const current = viewRef.current;
      let nextView: MapView = viewForCenter(nextMetrics, {
        wx: worldAddressRef.current.wx + 0.5,
        wy: worldAddressRef.current.wy + 0.5,
      }, current.zoom);
      if (previous.width) {
        const kept = worldCenter(current, previous);
        nextView = viewForCenter(nextMetrics, kept, current.zoom);
      }
      metricsRef.current = nextMetrics;
      nextView = boundCamera(nextView, nextMetrics);
      viewRef.current = nextView;
      paintPlane(nextView, null);
      setMetrics(nextMetrics);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    // Snapshot the plant-timer map so the cleanup closes over the same
    // instance the effect saw at mount (satisfies react-hooks/exhaustive-deps).
    const plantTimers = plantTimersRef.current;
    return () => {
      abortRef.current?.abort();
      neighborAbortRef.current?.abort();
      stopInertia();
      if (retireTimerRef.current !== null) window.clearTimeout(retireTimerRef.current);
      if (regionSettleRef.current !== null) window.clearTimeout(regionSettleRef.current);
      if (zoomSettleRef.current !== null) window.clearTimeout(zoomSettleRef.current);
      // Cancel any pending plant timers so an unmount mid-hold does not
      // fire after the DOM is torn down.
      plantTimers.forEach((id) => window.clearTimeout(id));
      plantTimers.clear();
    };
  }, []);

  // ── living-atlas RAF: weather, cloud shadows, breathing map ─────
  // Why: the map used to be a static image between clicks; this loop
  // makes the page always alive. Modelled on Ocean.tsx:750 fireWeather
  // and its persistent naturals block. Slower cadence (12-20s) because
  // a map is a calmer place than an open ocean.
  useEffect(() => {
    const stage = stageRef.current;
    const overlay = overlayRef.current;
    if (!stage || !overlay) return;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;

    // DPR-aware canvas sizing. A second ResizeObserver on the stage
    // element runs alongside the metrics one above; each observer has a
    // narrow concern and stays self-contained.
    const resize = () => {
      const rect = stage.getBoundingClientRect();
      const dpr = resolveDpr(isEmbeddedFrame() ? "medium" : "high", { embedded: isEmbeddedFrame(), maxDpr: 2 });
      overlay.width = Math.max(1, Math.round(rect.width * dpr));
      overlay.height = Math.max(1, Math.round(rect.height * dpr));
      overlay.style.width = "100%";
      overlay.style.height = "100%";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(stage);

    // ── persistent naturals ──────────────────────────────────────
    // Cairns the user stacked, wildflowers they planted, and rare
    // animal trails crossing the ground. Positions are normalized in
    // map-plane coordinates so they follow the terrain when the user
    // pans and zooms. Global (not per-region) because the map itself
    // reshapes on every generation — the terrain the cairn was placed
    // on may no longer exist by the next visit. This is a limitation
    // (a cairn from one continent shows on another) but keeps the
    // user's marks continuous.
    const NAT_KEY = "objetdart:atlas:naturals:v1";
    const MAX_NATURALS = 32;
    let naturals: AtlasNatural[] = [];
    const loadNaturals = () => {
      if (typeof window === "undefined") return;
      try {
        const raw = window.localStorage.getItem(NAT_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return;
        const nowMs = Date.now();
        naturals = parsed
          .filter((n): n is AtlasNatural =>
            !!n && typeof (n as AtlasNatural).id === "string" &&
            typeof (n as AtlasNatural).kind === "string" &&
            typeof (n as AtlasNatural).nx === "number" &&
            typeof (n as AtlasNatural).ny === "number",
          )
          .map((n) => ({ ...n, lastSeen: nowMs }))
          .slice(-MAX_NATURALS);
      } catch { /* noop */ }
    };
    const persistNaturals = () => {
      if (typeof window === "undefined") return;
      try {
        const nowMs = Date.now();
        for (const n of naturals) n.lastSeen = nowMs;
        window.localStorage.setItem(NAT_KEY, JSON.stringify(naturals.slice(-MAX_NATURALS)));
      } catch { /* noop */ }
    };
    // An animal trail is a short curved series of small footprints
    // stored as offsets in normalized map coords — so the whole path
    // scales with the plane when the user zooms.
    const genTrail = (): Array<{ dx: number; dy: number }> => {
      const heading = Math.random() * Math.PI * 2;
      const count = 6 + Math.floor(Math.random() * 4);
      const step = 0.010 + Math.random() * 0.008;
      const curve = (Math.random() - 0.5) * 0.35;
      const pts: Array<{ dx: number; dy: number }> = [];
      let hx = 0;
      let hy = 0;
      let ang = heading;
      for (let i = 0; i < count; i++) {
        pts.push({ dx: hx, dy: hy });
        ang += curve;
        hx += Math.cos(ang) * step;
        hy += Math.sin(ang) * step;
      }
      return pts;
    };
    const addNatural = (kind: AtlasNaturalKind, nx: number, ny: number) => {
      const nowMs = Date.now();
      const n: AtlasNatural = {
        id: `nat-${nowMs}-${Math.random().toString(36).slice(2, 8)}`,
        kind,
        nx: Math.max(0.02, Math.min(0.98, nx)),
        ny: Math.max(0.02, Math.min(0.98, ny)),
        seed: Math.floor(Math.random() * 0xFFFFFFFF),
        createdAt: nowMs,
        lastSeen: nowMs,
        trail: kind === "trail" ? genTrail() : undefined,
      };
      naturals.push(n);
      while (naturals.length > MAX_NATURALS) naturals.shift();
      persistNaturals();
      setNaturalsCount(naturals.length);
      return n;
    };
    // ceremony hold's solemn act: annihilate the one mark under the hand
    const removeNatural = (id: string) => {
      const idx = naturals.findIndex((n) => n.id === id);
      if (idx === -1) return;
      naturals.splice(idx, 1);
      persistNaturals();
      setNaturalsCount(naturals.length);
    };
    // the shared <LetGo/> — every mark released at once
    const clearNaturals = () => {
      naturals = [];
      persistNaturals();
      setNaturalsCount(0);
    };
    loadNaturals();
    setNaturalsCount(naturals.length);
    // Bridge the closures to the pointer-down / gesture / LetGo handlers.
    addNaturalRef.current = addNatural;
    removeNaturalRef.current = removeNatural;
    clearNaturalsRef.current = clearNaturals;

    // ── ambient cloud shadows ────────────────────────────────────
    // 4 soft gray radial gradients slowly drift W→E at slightly
    // different speeds so the day visibly passes over the land.
    // `vx0` is each cloud's own resting pace: a scrub whips `vx` away from
    // it and the draw loop relaxes back, so a stirred sky always settles.
    type Cloud = { x: number; y: number; r: number; vx: number; vx0: number; alpha: number };
    const clouds: Cloud[] = Array.from({ length: 4 }, () => {
      const vx = 0.008 + Math.random() * 0.013; // fraction of viewport width per second
      return {
        x: Math.random() * 1.4 - 0.2,
        y: 0.08 + Math.random() * 0.74,
        r: 0.16 + Math.random() * 0.10,
        vx,
        vx0: vx,
        alpha: 0.04 + Math.random() * 0.05,
      };
    });

    // ── weather events ────────────────────────────────────────────
    // Jittered self-rescheduling setTimeout. Six kinds, weighted so
    // the common flocks/clouds show often and the meteor stays rare.
    // Same shape as Ocean.tsx fireWeather.
    const weather: AtlasWeatherEvent[] = [];
    const addWeather = (e: AtlasWeatherEvent) => {
      weather.push(e);
      if (weather.length > 6) weather.shift();
    };
    const spawnFlock = () => {
      addWeather({
        kind: "flock",
        t0: performance.now(),
        duration: 14,
        count: 5 + Math.floor(Math.random() * 5),
        yBase: 0.10 + Math.random() * 0.25,
        dir: Math.random() < 0.5 ? 1 : -1,
        seed: Math.random() * 1000,
      });
    };
    const spawnCloud = () => {
      addWeather({
        kind: "cloud",
        t0: performance.now(),
        duration: 12,
        y: 0.15 + Math.random() * 0.55,
        dir: Math.random() < 0.85 ? 1 : -1,
        radius: 0.14 + Math.random() * 0.10,
        alpha: 0.11 + Math.random() * 0.08,
      });
    };
    const spawnGust = () => {
      addWeather({
        kind: "gust",
        t0: performance.now(),
        duration: 3,
        y: 0.30 + Math.random() * 0.40,
        dir: Math.random() < 0.5 ? 1 : -1,
      });
    };
    const spawnSunbeam = () => {
      addWeather({
        kind: "sunbeam",
        t0: performance.now(),
        duration: 8,
        y: 0.20 + Math.random() * 0.40,
        dir: Math.random() < 0.5 ? 1 : -1,
      });
    };
    const spawnMigration = () => {
      addWeather({
        kind: "migration",
        t0: performance.now(),
        duration: 22,
        count: 15 + Math.floor(Math.random() * 11),
        yBase: 0.06 + Math.random() * 0.14,
        dir: Math.random() < 0.5 ? 1 : -1,
        seed: Math.random() * 1000,
      });
    };
    const spawnMeteor = () => {
      const ang = 0.4 + Math.random() * 0.6;
      const len = 0.15 + Math.random() * 0.10;
      addWeather({
        kind: "meteor",
        t0: performance.now(),
        duration: 1.2,
        x0: Math.random() * 0.7,
        y0: Math.random() * 0.15,
        dx: Math.cos(ang) * len,
        dy: Math.sin(ang) * len,
      });
    };
    // The room's slow cycle: the atlas keeps no day/night, but the sky
    // keeps seasonal habits — three-finger twist turns this index and the
    // weather mix follows. 0 spring · 1 summer · 2 autumn · 3 winter.
    let seasonIdx = 0;
    // Per-season spawn weights: flock, cloud, gust, sunbeam, migration —
    // the meteor takes the remainder and stays rare in every year.
    const SEASON_WEATHER_WEIGHTS = [
      [0.40, 0.20, 0.10, 0.13, 0.12], // spring — the flocks return
      [0.18, 0.16, 0.08, 0.42, 0.11], // summer — sunbeams own the land
      [0.14, 0.20, 0.14, 0.10, 0.37], // autumn — the migrations cross
      [0.14, 0.26, 0.40, 0.06, 0.09], // winter — gusts and low cloud
    ] as const;
    // Rhythm entrainment: a steady tap train sets the sky's cadence for a
    // few rounds, then the scheduler returns to its own jittered pace.
    let weatherEveryMs = 0;
    let weatherPulsesLeft = 0;
    let weatherTimer: ReturnType<typeof setTimeout> | 0 = 0;
    const fireWeather = () => {
      if (!document.hidden) {
        const roll = Math.random();
        const w = SEASON_WEATHER_WEIGHTS[seasonIdx];
        let acc = 0;
        if (roll < (acc += w[0])) spawnFlock();
        else if (roll < (acc += w[1])) spawnCloud();
        else if (roll < (acc += w[2])) spawnGust();
        else if (roll < (acc += w[3])) spawnSunbeam();
        else if (roll < (acc += w[4])) spawnMigration();
        else spawnMeteor();
      }
      const entrained = weatherPulsesLeft > 0 && weatherEveryMs > 0;
      if (entrained) weatherPulsesLeft -= 1;
      weatherTimer = setTimeout(
        fireWeather,
        entrained ? weatherEveryMs : 12000 + Math.random() * 8000,
      );
    };
    weatherTimer = setTimeout(fireWeather, 5000 + Math.random() * 4000);

    // ── the frame and law, additive ──────────────────────────────
    // Mounted alongside — never instead of — the hand-tuned pointer
    // state machine below (its own pan/pinch/plant, already faithful to
    // the grammar's material and frame verbs via useBandEdgeTravel).
    // noCapture keeps that state machine as the sole owner of pointer
    // capture; this layer only adds the verbs Atlas had none of yet.
    let timeScale = 1;
    let lensTimer: ReturnType<typeof setTimeout> | null = null;
    let twoTwistAcc = 0;
    // three-finger twist accumulates toward a quarter-turn detent, then
    // the year advances (or rewinds) one season.
    let seasonTwistAcc = 0;
    // three-finger drag accumulates pull so the wind answers with one
    // leaning gust per armful, not one gust per pointer event.
    let windAcc = 0;
    // scrub half-turns already answered, so the stir sounds once per
    // half-winding instead of chattering on every sample.
    let stirTurns = 0;
    // One-finger hold gather: create at dwell, annihilate at ceremony.
    // Declared here so the handler and the overlay share one state object —
    // shipping the handler without this declaration is what broke the deploy.
    const charge: {
      active: boolean;
      x: number;
      y: number;
      amount: number;
      planted: AtlasNaturalKind | null;
      onId: string | null;
      sealed: boolean;
    } = {
      active: false,
      x: 0,
      y: 0,
      amount: 0,
      planted: null,
      onId: null,
      sealed: false,
    };
    /** Nearest natural under a screen point, or null if none within reach. */
    const naturalNear = (sx: number, sy: number): string | null => {
      const m = metricsRef.current;
      const view = viewRef.current;
      if (m.width <= 0 || m.mapWidth <= 0) return null;
      const mapPxW = m.mapWidth * view.zoom;
      const mapPxH = m.mapHeight * view.zoom;
      const addr = worldAddressRef.current;
      const reach = 28 * Math.max(0.55, Math.min(3.5, Math.sqrt(view.zoom)));
      let bestId: string | null = null;
      let bestD = reach * reach;
      for (const n of naturals) {
        const nx = view.x + (addr.wx + n.nx) * mapPxW;
        const ny = view.y + (addr.wy + n.ny) * mapPxH;
        const d = (nx - sx) * (nx - sx) + (ny - sy) * (ny - sy);
        if (d <= bestD) {
          bestD = d;
          bestId = n.id;
        }
      }
      return bestId;
    };
    const detachGrammar = attachGestures(stage, {
      tap: (e) => {
        if (e.fingers === 3) {
          // tutti — every alive thing on the map answers together, as
          // loud as the hand meant it: the ripple, the chime, and the
          // tape all ride e.intensity instead of a fixed pulse.
          setPulse({ x: e.x, y: e.y, key: Date.now(), intensity: 0.35 + e.intensity * 0.5 });
          try { getFieldAudio().chime(); } catch { /* noop */ }
          try { haptics.ripple(0.25 + e.intensity * 0.45); } catch { /* noop */ }
          recordTape("ripple", 0.3 + e.intensity * 0.4, "atlas/tutti");
          return;
        }
        if (e.fingers !== 1 || e.count < 2) return;
        // The rapid-tap train (tiers 1 / 3 / 5 / n). A bare tap is the
        // water's own — the pointer state machine already answers it,
        // scaled by intensityFrom — so this ladder starts at the second
        // tap and climbs in the map's material: birds, then a
        // migration, then the whole sky at once.
        const tier = tapTrainTier(e.count);
        if (e.count === 3) {
          // three taps — birds rise from the tapped ground and cross
          // the land on the side the hand chose.
          addWeather({
            kind: "flock",
            t0: performance.now(),
            duration: 12,
            count: 4 + Math.round(e.intensity * 5),
            yBase: Math.max(0.06, Math.min(0.6, e.y / Math.max(1, metricsRef.current.height))),
            dir: e.x > metricsRef.current.width / 2 ? -1 : 1,
            seed: (e.x * 7 + e.y * 13) % 1000,
          });
          setPulse({ x: e.x, y: e.y, key: Date.now(), intensity: 0.5 + e.intensity * 0.3 });
          try { getFieldAudio().chime(); } catch { /* noop */ }
          try { haptics.ripple(0.4 + e.intensity * 0.3); } catch { /* noop */ }
          recordTape("ripple", 0.5, "atlas/train/3");
          return;
        }
        if (e.count === 5) {
          // five taps — the rare gift arrives on call: a migration
          // crosses at the tapped latitude.
          addWeather({
            kind: "migration",
            t0: performance.now(),
            duration: 18,
            count: 12 + Math.round(e.intensity * 10),
            yBase: Math.max(0.05, Math.min(0.5, e.y / Math.max(1, metricsRef.current.height))),
            dir: e.x > metricsRef.current.width / 2 ? -1 : 1,
            seed: (e.x * 11 + e.y * 3) % 1000,
          });
          setPulse({ x: e.x, y: e.y, key: Date.now(), intensity: 0.7 + e.intensity * 0.25 });
          try { getFieldAudio().bell(); } catch { /* noop */ }
          try { haptics.roll(); } catch { /* noop */ }
          recordTape("region", 0.65, "atlas/train/5");
          return;
        }
        if (tier === "n") {
          // seven and beyond — the crescendo: the whole sky answers at
          // once, deeper with every further tap in the train.
          const depth = Math.min(1, 0.7 + (e.count - 7) * 0.15);
          spawnSunbeam();
          spawnGust();
          if (e.count === 7) spawnMeteor();
          setPulse({ x: e.x, y: e.y, key: Date.now(), intensity: depth });
          try { getFieldAudio().bell(); getFieldAudio().chime(); } catch { /* noop */ }
          try { haptics.storm(); } catch { /* noop */ }
          recordTape("region", depth, "atlas/train/n");
          return;
        }
        // between the rungs the previous payoff deepens rather than a
        // new one firing: a slightly stronger ripple, a touch to match.
        setPulse({ x: e.x, y: e.y, key: Date.now(), intensity: 0.3 + e.intensity * 0.3 + e.count * 0.04 });
        try { haptics.tap(); } catch { /* noop */ }
      },
      twist: (e) => {
        if (e.phase !== "move") return;
        if (e.fingers === 3) {
          // season — the atlas keeps no day, but the sky keeps habits:
          // a quarter-turn detent advances (or rewinds) the year, the
          // weather mix follows, and the turned season announces itself
          // in its own signature weather.
          seasonTwistAcc += e.angle;
          if (Math.abs(seasonTwistAcc) < Math.PI / 2) return;
          const dir = seasonTwistAcc > 0 ? 1 : -1;
          seasonTwistAcc = 0;
          seasonIdx = (seasonIdx + dir + 4) % 4;
          if (seasonIdx === 0) spawnFlock();
          else if (seasonIdx === 1) spawnSunbeam();
          else if (seasonIdx === 2) spawnMigration();
          else spawnGust();
          try { getFieldAudio().playNote(50 + seasonIdx * 5, 360); } catch { /* noop */ }
          try { haptics.detent(); } catch { /* noop */ }
          recordTape("region", 0.4, "atlas/season");
          return;
        }
        twoTwistAcc += e.angle;
        if (Math.abs(twoTwistAcc) < THRESHOLDS.twistDeadzoneRad * 3) return;
        twoTwistAcc = 0;
        setLensFlash(true);
        if (lensTimer) clearTimeout(lensTimer);
        // velocity is an axis, not a switch: a slow turn raises the
        // chart for a glance, a fast one holds it up longer.
        lensTimer = setTimeout(
          () => setLensFlash(false),
          900 + Math.min(1400, Math.abs(e.velocity) * 500),
        );
        try { haptics.lens(); } catch { /* noop */ }
        recordTape("region", 0.3, "atlas/lens");
      },
      drag: (e) => {
        if (e.fingers !== 3) return;
        // wind — the gust leans the way the hand pushed and grows with
        // its speed: pull accumulates into one armful per gust, never
        // one gust per pointer event.
        windAcc += e.dx;
        if (Math.abs(windAcc) < 48) return;
        const speed = Math.hypot(e.vx, e.vy);
        addWeather({
          kind: "gust",
          t0: performance.now(),
          duration: 2 + Math.min(3, speed * 2),
          y: Math.max(0.1, Math.min(0.85, e.y / Math.max(1, metricsRef.current.height))),
          dir: windAcc > 0 ? 1 : -1,
        });
        windAcc = 0;
        try { haptics.chop(); } catch { /* noop */ }
      },
      scrub: (e) => {
        // stir — a circular path whips the cloud shadows along the
        // winding; the sky visibly hurries (or reverses) under the
        // hand, then settles back to each cloud's own resting pace.
        const push = Math.max(-0.03, Math.min(0.03, (e.winding > 0 ? 1 : -1) * (0.008 + Math.abs(e.angularVelocity) * 0.012)));
        for (const c of clouds) {
          c.vx = Math.max(-0.06, Math.min(0.06, c.vx + push));
        }
        const turn = Math.trunc(e.winding * 2);
        if (turn !== stirTurns) {
          stirTurns = turn;
          try { getFieldAudio().chime(); } catch { /* noop */ }
          try { haptics.ripple(Math.min(1, 0.3 + Math.abs(e.angularVelocity) * 0.4)); } catch { /* noop */ }
          recordTape("ripple", 0.35, "atlas/stir");
        }
      },
      rhythm: (e) => {
        if (e.stability < 0.55) return;
        // entrain — the sky answers on the hand's pulse: the next few
        // weather events arrive on multiples of the tapped tempo, more
        // of them the steadier the pulse was.
        weatherEveryMs = Math.max(2500, Math.min(16000, (60000 / Math.max(1, e.bpm)) * 8));
        weatherPulsesLeft = 2 + Math.round(e.stability * 2);
        if (weatherTimer) clearTimeout(weatherTimer);
        weatherTimer = setTimeout(fireWeather, Math.min(weatherEveryMs, 1200));
        try { getFieldAudio().chime(); } catch { /* noop */ }
        try { haptics.detent(); } catch { /* noop */ }
        recordTape("ripple", 0.3 + e.stability * 0.3, "atlas/rhythm");
      },
      hold: (e) => {
        if (e.fingers === 3) {
          if (e.phase === "release") { timeScale = 1; return; }
          // time dilation while held — the sky and clouds slow continuously
          timeScale = e.phase === "enter"
            ? 1
            : Math.max(0.15, 1 - Math.min(1, e.elapsed / THRESHOLDS.ceremonyMs) * 0.85);
          return;
        }
        if (e.fingers !== 1) return;
        // One finger dwelling on the ground is the create/delete law: from
        // the touch tier something visibly gathers under the finger (so the
        // hand learns the verb without being told), at the dwell tier it
        // lands as a natural, past the dwell tier the gather keeps feeding
        // it, and a ceremony hold on a mark already standing is the room's
        // solemn act — its touch-reachable delete.
        if (e.phase === "release") {
          charge.active = false;
          charge.amount = 0;
          return;
        }
        if (e.phase === "enter") {
          charge.active = true;
          charge.x = e.x;
          charge.y = e.y;
          charge.amount = 0;
          charge.planted = null;
          charge.onId = naturalNear(e.x, e.y);
          charge.sealed = false;
          return;
        }
        if (!charge.active) return;
        // Continuous, never a switch: the gather crosses 1 exactly at the
        // dwell tier and keeps climbing toward the ceremony.
        charge.amount = (e.elapsed - THRESHOLDS.tapMaxMs) /
          (THRESHOLDS.dwellMs - THRESHOLDS.tapMaxMs);
        if (charge.onId) {
          // annihilate: a mark under the finger unmakes itself at the
          // ceremony tier, after visibly fraying for the whole hold
          if (e.tier >= 3 && !charge.sealed) {
            charge.sealed = true;
            removeNaturalRef.current?.(charge.onId);
            setPulse({ x: e.x, y: e.y, key: Date.now(), intensity: 0.85 });
            setStatus("the ground takes it back");
            try { getFieldAudio().bell(); haptics.roll(); } catch { /* noop */ }
            recordTape("region", 0.7, "atlas/annihilate");
            charge.onId = null;
            charge.active = false;
          }
          return;
        }
        if (e.tier >= 2 && !charge.planted && !busyRef.current) {
          const mNow = metricsRef.current;
          const place = addNaturalRef.current;
          if (!mNow.width || !place) return;
          const wpt = worldPointAtScreen(viewRef.current, mNow, e.x, e.y);
          const addr = worldAddressRef.current;
          const nx = wpt.wx - addr.wx;
          const ny = wpt.wy - addr.wy;
          if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
          if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return;
          // Cairn is the default surprise; a wildflower shows up often
          // enough to feel warm; a trail is a rare gift.
          const roll = Math.random();
          const kind: AtlasNaturalKind =
            roll < 0.70 ? "cairn" :
            roll < 0.95 ? "flower" :
            "trail";
          place(kind, nx, ny);
          charge.planted = kind;
          setPulse({ x: e.x, y: e.y, key: Date.now(), intensity: 0.7 });
          setStatus(
            kind === "cairn" ? "a cairn stands where you paused" :
            kind === "flower" ? "a wildflower opens where you paused" :
            "an animal trail crosses the ground",
          );
          try { getFieldAudio().chime(); haptics.roll(); } catch { /* noop */ }
          recordTape("region", 0.68, "atlas/plant/" + kind);
        }
      },
    }, { wheelZoom: false, manageStyle: false, noCapture: true });

    // vessel: shake scatters a gust across the sky, a knock rings the
    // map like tutti, and face-down is night — the overlay dims until
    // the phone turns back over. Tilt has no honest gravity on a map
    // seen from directly above, so it is left unbound.
    let nightTarget = 0;
    const detachVessel = onVessel({
      shake: (e) => {
        // agitation in the sky's own material: a harder shake sends
        // more gusts across the land, never the same one twice.
        const gusts = 1 + Math.round(Math.min(2, e.intensity * 2));
        for (let i = 0; i < gusts; i++) spawnGust();
        try { haptics.chop(); } catch { /* noop */ }
        try { getFieldAudio().chime(); } catch { /* noop */ }
      },
      knock: (e) => {
        // a rap on the case rings the map like tutti, as hard as it was
        // struck.
        setPulse({ x: (metricsRef.current.width || 0) / 2, y: (metricsRef.current.height || 0) / 2, key: Date.now(), intensity: 0.35 + e.intensity * 0.5 });
        try { getFieldAudio().bell(); } catch { /* noop */ }
        try { haptics.tap(); } catch { /* noop */ }
      },
      flip: ({ faceDown }) => { nightTarget = faceDown ? 1 : 0; },
    });

    // ── render loop ───────────────────────────────────────────────
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now();
    let raf = 0;
    let prevNow = t0;
    let lastSaveAt = t0;
    let nightEase = 0;
    let simTime = 0;

    // Performance contract: sleep the heavy per-frame work while the tab
    // is hidden (the rAF loop itself keeps ticking cheaply so it wakes
    // instantly), and read a quality tier from real frame time to scale
    // the ambient cloud shadows on low-power devices.
    const gov = createFrameGovernor();
    let sleeping = false;
    const offVisibility = onVisibility((hidden) => { sleeping = hidden; });

    // Cloud shadows used to build a fresh radial gradient for all 4
    // clouds every single frame — forbidden inside a per-element loop.
    // A radial gradient is a fixed shape (1 at center → 0 at the edge);
    // only alpha and radius differ per cloud, so one normalized sprite,
    // baked once through the shared radial-sprite cache, covers every
    // cloud via drawRadialStamp (drawImage + globalAlpha).
    const cloudSprite = bakeRadialSprite("atlas-cloud-shadow", {
      width: 256,
      height: 256,
      stops: [
        { offset: 0, color: "rgba(8, 14, 22, 1)" },
        { offset: 1, color: "rgba(8, 14, 22, 0)" },
      ],
    });

    const draw = (now: number) => {
      const tier = gov.beginFrame(now);
      if (sleeping) { raf = requestAnimationFrame(draw); return; } // no draw while hidden
      const detail = detailForTier(tier);
      const rect = stage.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const dtSec = Math.min(0.1, (now - prevNow) / 1000);
      prevNow = now;
      // three-finger hold dilates time: this sim clock (not the wall
      // clock) drives every periodic wobble below, so a held dilation
      // genuinely slows the sky and the naturals, continuously.
      simTime += dtSec * timeScale;
      const t = simTime;

      // Parallax breath — a very slow lung-scale (1..1.008) on the map
      // image. Applied via a CSS custom property so we do NOT touch
      // the plane's inline pan/zoom transform, which the drag/pinch
      // handlers write to on every event.
      if (!reduce) {
        const breath = 1 + Math.sin(t * 0.05) * 0.008;
        stage.style.setProperty("--atlas-breath", breath.toFixed(4));
      }

      ctx.clearRect(0, 0, w, h);

      // ── ambient cloud shadows (always drifting) ─────────────────
      // three-finger hold dilates time: the drift (and, below, the
      // naturals' own idle wobble via `t`) slows continuously while held.
      for (const c of clouds) {
        // a stirred sky settles: whatever a scrub whipped `vx` to, it
        // relaxes back to this cloud's own resting pace.
        c.vx += (c.vx0 - c.vx) * Math.min(1, dtSec * 0.25);
        c.x += c.vx * dtSec * timeScale;
        if (c.x > 1.3) c.x = -0.3;
        else if (c.x < -0.3) c.x = 1.3;
        const cx = c.x * w;
        const cy = c.y * h;
        const rad = c.r * Math.min(w, h) * 1.8;
        drawRadialStamp(ctx, cloudSprite, cx, cy, rad, c.alpha * detail.shadows);
      }

      // ── weather events (transient, frame-relative) ──────────────
      for (let i = weather.length - 1; i >= 0; i--) {
        const e = weather[i];
        const age = (now - e.t0) / 1000;
        if (age >= e.duration) { weather.splice(i, 1); continue; }
        drawAtlasWeather(ctx, e, age, w, h);
      }

      // ── naturals (map-anchored) ─────────────────────────────────
      // Compute screen position from the current view + metrics so
      // cairns and flowers pan and scale with the terrain. Size grows
      // gently with sqrt(zoom) so they stay readable at all zoom
      // levels without swallowing the frame at 30x.
      const view = viewRef.current;
      const m = metricsRef.current;
      if (m.width > 0 && m.mapWidth > 0) {
        const scale = Math.max(0.55, Math.min(3.5, Math.sqrt(view.zoom)));
        const mapPxW = m.mapWidth * view.zoom;
        const mapPxH = m.mapHeight * view.zoom;
        // Naturals ride the cell the traveler stands on, so they keep
        // their ground as the camera roams the wider plane.
        const addr = worldAddressRef.current;
        for (const n of naturals) {
          const sx = view.x + (addr.wx + n.nx) * mapPxW;
          const sy = view.y + (addr.wy + n.ny) * mapPxH;
          if (sx < -80 || sy < -80 || sx > w + 80 || sy > h + 80) continue;
          drawAtlasNatural(ctx, n, sx, sy, scale, t, mapPxW, mapPxH);
        }
      }

      // Periodic checkpoint so a hard refresh does not lose the cairn
      // the user placed 30 seconds ago (unmount also flushes).
      if (naturals.length > 0 && now - lastSaveAt > 4000) {
        lastSaveAt = now;
        persistNaturals();
      }

      // Hold gather — a soft ring that fills toward dwell, then ceremony.
      // Drawn without banned paint calls (no createRadialGradient / blur).
      if (charge.active && charge.amount > 0) {
        const a = Math.max(0, Math.min(2.2, charge.amount));
        const r = 10 + a * 14;
        ctx.beginPath();
        ctx.arc(charge.x, charge.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = charge.onId
          ? `rgba(220, 170, 120, ${0.25 + Math.min(1, a) * 0.45})`
          : `rgba(180, 210, 170, ${0.2 + Math.min(1, a) * 0.4})`;
        ctx.lineWidth = 1.5 + Math.min(1, a);
        ctx.stroke();
      }

      // flip face-down — night, until the phone turns back over
      nightEase += (nightTarget - nightEase) * 0.05;
      if (nightEase > 0.002) {
        ctx.fillStyle = `rgba(4, 8, 14, ${nightEase * 0.6})`;
        ctx.fillRect(0, 0, w, h);
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      offVisibility();
      detachGrammar();
      detachVessel();
      if (lensTimer) clearTimeout(lensTimer);
      if (weatherTimer) clearTimeout(weatherTimer);
      persistNaturals();
      ro.disconnect();
      stage.style.removeProperty("--atlas-breath");
      addNaturalRef.current = null;
      removeNaturalRef.current = null;
      clearNaturalsRef.current = null;
    };
  }, []);

  const stopNeighborGeneration = () => {
    neighborAbortRef.current?.abort();
    neighborAbortRef.current = null;
    pendingCellsRef.current.clear();
    awaitedCellRef.current = null;
  };

  const invalidateGeneration = () => {
    requestRef.current += 1;
    generationIdRef.current = null;
    phaseRankRef.current = 0;
    generationIntentRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    if (regionSettleRef.current !== null) window.clearTimeout(regionSettleRef.current);
    regionSettleRef.current = null;
    pendingPlaneRef.current = null;
    pendingWiderTerritoryRef.current = false;
    setBusy(false);
    setBusyFocus(null);
  };

  const hasPendingGenerationWork = () => Boolean(
    generationIdRef.current
    || abortRef.current
    || regionSettleRef.current !== null,
  );

  // ── the tile plane ──────────────────────────────────────────────
  const bumpTiles = () => setTileVersion((version) => version + 1);

  // The previous plane's tiles stay mounted beneath a landing newcomer
  // while it fades in, then release — an arrival covers, never blinks.
  const retirePlane = () => {
    const keep = allTilesRef.current.filter((tile) => tile.level >= 0);
    retiringTilesRef.current = keep.slice(-8).map((tile) => ({
      ...tile,
      id: "retired-" + tile.id,
      level: -1,
    }));
    if (retireTimerRef.current !== null) window.clearTimeout(retireTimerRef.current);
    retireTimerRef.current = window.setTimeout(() => {
      retireTimerRef.current = null;
      retiringTilesRef.current = [];
      bumpTiles();
    }, 950);
  };

  const upsertChildTile = (
    id: string,
    rect: PlaneRect,
    level: number,
    image: string,
    phase: GenerationPhase,
  ) => {
    const tiles = childTilesRef.current.filter((tile) => tile.id !== id);
    tiles.push({ id, rect, level, image, phase });
    while (tiles.length > 10) tiles.shift();
    childTilesRef.current = tiles;
    bumpTiles();
  };

  // Swap the whole plane for a landed newcomer: old tiles retire beneath
  // it, the world restarts from its origin sheet, the camera settles home.
  const applyLandedPlane = (landed: LandedPlane) => {
    retirePlane();
    stopNeighborGeneration();
    worldRef.current.reset();
    worldAddressRef.current = { ...ATLAS_WORLD_ORIGIN };
    childTilesRef.current = [];
    childRequestKeyRef.current = null;
    planeEpochRef.current += 1;
    worldRef.current.remember({
      address: { ...ATLAS_WORLD_ORIGIN },
      image: landed.image,
      hotspots: landed.hotspots,
      seeds: landed.seeds,
      concept: landed.concept,
      phase: landed.phase,
      depth: landed.depth,
    });
    setWorldVersion((version) => version + 1);
    bumpTiles();
    if (landed.hotspots) setHotspots(landed.hotspots);
    setSeeds(landed.seeds);
    setConcept(landed.concept);
    setRenderPhase(landed.phase);
    generationDepthRef.current = landed.depth;
    setGenerationDepth(landed.depth);
    commitView(centerOnCell(ATLAS_WORLD_ORIGIN, 1), { animate: true });
  };

  // Standing on a different sheet now — its names, seeds, and depth take
  // over. The camera does not move; the ground already did.
  const adoptSheet = (
    sheet: AtlasWorldSheet<MapHotspot[], MapSeeds>,
    announcement?: string,
  ) => {
    moveWorldAddress(sheet.address);
    setConcept(sheet.concept);
    if (sheet.hotspots) setHotspots(sheet.hotspots);
    if (sheet.seeds) setSeeds(sheet.seeds);
    setFocusedId(null);
    setFocusedLabel(null);
    setRegion(null);
    generationDepthRef.current = sheet.depth;
    setGenerationDepth(sheet.depth);
    setRenderPhase(sheet.phase);
    childRequestKeyRef.current = null;
    if (announcement) setStatus(announcement);
  };

  const glideToCell = (address: AtlasWorldAddress) => {
    stopInertia();
    commitView(centerOnCell(address, 1), { animate: true, transition: GLIDE_TRANSITION });
  };

  // After the camera settles over a neighboring cell, that sheet becomes
  // the standing ground — crossing by pan is the same act as traveling.
  const maybeAdoptCell = () => {
    const cell = cellAt(worldCenter(viewRef.current, metricsRef.current));
    if (addressesEqual(cell, worldAddressRef.current)) return false;
    const sheet = worldRef.current.recall(cell);
    if (!sheet) return false;
    const name = sheet.concept.split("·")[0].trim().toLowerCase();
    adoptSheet(sheet, "crossed into " + (name || "neighboring ground"));
    recordTape("region", 0.5, "atlas/adopt/" + addressKey(cell));
    try {
      haptics.tap();
    } catch {
      // Haptics are progressive enhancement.
    }
    return true;
  };

  // When the camera outruns the deepest drawing beneath it, ask for a
  // child sheet of just that ground. Most levels resolve in place — the
  // camera never moves, and zooming back out still shows the parent
  // around it. But a child's rect shrinks every level, so the zoom the
  // camera would need to outrun it again grows the same way; left
  // unchecked that requirement eventually exceeds what the camera can
  // ever reach and a tile is stuck over-magnified forever. Once
  // hasZoomHeadroom says the well is running dry, this landing re-roots
  // the plane instead — the same swap a fresh concept or a widened chart
  // already uses — so the sharper sheet becomes a new full-zoom world
  // with a full MAX_ZOOM of headroom again. The pyramid, endless one
  // checkpoint at a time.
  const maybeRequestDetail = () => {
    if (busy || hasPendingGenerationWork()) return;
    const m = metricsRef.current;
    if (!m.width) return;
    const view = viewRef.current;
    const center = worldCenter(view, m);
    const live = allTilesRef.current.filter((tile) => tile.level >= 0);
    const deep = deepestTileAt(live, center);
    if (!deep || !tileNeedsDetail(deep, view.zoom)) return;
    const localFocus = focusForSheet(view, m, deep.rect);
    const clip = clipRectForFocus(localFocus);
    const childRect = placeChildRect(deep.rect, clip);
    const key = [
      concept,
      deep.level + 1,
      Math.round(childRect.x * 40),
      Math.round(childRect.y * 40),
      Math.round(childRect.width * 40),
    ].join("|");
    if (key === childRequestKeyRef.current) return;
    childRequestKeyRef.current = key;
    const reroot = !hasZoomHeadroom(childRect, MAX_ZOOM);
    setStatus(reroot ? "a sharper world is coming into focus" : "settling new detail into the visible ground");
    recordTape("region", 0.68, "atlas/detail/" + (deep.level + 1));
    void generateMap({
      mode: "zoom",
      plane: reroot ? "new" : "same",
      subjectPrompt: concept + " · visible region",
      focus: localFocus,
      childRect,
      level: deep.level + 1,
      prefetchNeighbors: false,
    });
  };

  // One settle path for every gesture's end: apply a plane that waited
  // for stillness, mint a wider chart the pinch asked for, adopt the
  // cell underfoot, then consider deeper detail.
  const onCameraSettled = () => {
    if (interactingRef.current) return;
    const landed = pendingPlaneRef.current;
    if (landed) {
      pendingPlaneRef.current = null;
      planeAppliedForRef.current = landed.generationId;
      applyLandedPlane(landed);
      setRenderPhase(landed.phase);
      setStatus(landed.phase === "preview" ? "a quick chart has surfaced · refining…" : "a new atlas has surfaced");
      return;
    }
    if (pendingWiderTerritoryRef.current) {
      pendingWiderTerritoryRef.current = false;
      requestWiderTerritory(true);
      return;
    }
    maybeAdoptCell();
    maybeRequestDetail();
  };

  const scheduleSettle = () => {
    if (zoomSettleRef.current !== null) window.clearTimeout(zoomSettleRef.current);
    const delay = metricsRef.current.width > 0 && metricsRef.current.width <= MOBILE_BREAKPOINT
      ? MOBILE_ZOOM_SETTLE_MS
      : DESKTOP_ZOOM_SETTLE_MS;
    zoomSettleRef.current = window.setTimeout(() => {
      zoomSettleRef.current = null;
      onCameraSettled();
    }, delay);
  };

  const captureSnapshot = (): MapSnapshot => ({
    sheets: worldRef.current.export(),
    children: [...childTilesRef.current],
    address: { ...worldAddressRef.current },
    hotspots,
    seeds,
    concept,
    focusedId,
    focusedLabel,
    regionId: selectedRegionId,
    view: viewRef.current,
    renderPhase,
    generationDepth: generationDepthRef.current,
  });

  // A popped plane comes back whole: every sheet at its address, every
  // child tile in place, and the traveler standing where they stood.
  const restoreSnapshot = (snapshot: MapSnapshot) => {
    stopNeighborGeneration();
    retirePlane();
    worldRef.current.reset();
    for (const sheet of snapshot.sheets) worldRef.current.remember(sheet);
    worldAddressRef.current = { ...snapshot.address };
    childTilesRef.current = snapshot.children.map((tile) => ({ ...tile }));
    childRequestKeyRef.current = null;
    planeEpochRef.current += 1;
    setWorldVersion((version) => version + 1);
    bumpTiles();
    setHotspots(snapshot.hotspots);
    setSeeds(snapshot.seeds);
    setConcept(snapshot.concept);
    setFocusedId(snapshot.focusedId);
    setFocusedLabel(snapshot.focusedLabel);
    setRegion(snapshot.regionId);
    setRenderPhase(snapshot.renderPhase);
    generationDepthRef.current = snapshot.generationDepth;
    setGenerationDepth(snapshot.generationDepth);
    commitView(boundCamera(snapshot.view, metricsRef.current), { animate: true });
  };

  const resetOuterMap = () => {
    invalidateGeneration();
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
    commitView(centerOnCell(worldAddressRef.current, 1), { animate: true });
    setStatus("outer map · choose another mark or cross an edge");
  };

  const prefetchNeighborBatch = async ({
    sourceCell,
    sourceImage,
    subjectPrompt,
    depth,
    parentRequestId,
  }: {
    sourceCell: AtlasWorldAddress;
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
    // Speculate only toward addresses still unknown — ground the world
    // already holds final is simply there, the way loaded tiles are.
    // Cells being drawn are marked so a traveler heading toward one
    // waits for the landing instead of duplicating the work.
    const slots = plan.slots.filter((slot) => {
      const address = shiftAddress(sourceCell, slot.direction);
      return worldRef.current.peek(address)?.phase !== "final"
        && !pendingCellsRef.current.has(addressKey(address));
    });
    if (slots.length === 0) return;
    for (const slot of slots) {
      pendingCellsRef.current.add(addressKey(shiftAddress(sourceCell, slot.direction)));
    }
    const box = stageRef.current?.getBoundingClientRect();
    const viewport = {
      width: Math.round(box?.width ?? 0),
      height: Math.round(box?.height ?? 0),
    };

    const queue = [...slots];
    const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
      while (queue.length > 0) {
        if (controller.signal.aborted || parentRequestId !== requestRef.current) return;
        const slot = queue.shift();
        if (!slot) return;
        const address = shiftAddress(sourceCell, slot.direction);
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
          const sheet: AtlasWorldSheet<MapHotspot[], MapSeeds> = {
            address,
            image,
            hotspots: normaliseHotspots(data.hotspots),
            seeds: normaliseSeeds(data.seeds, localSeeds(subjectPrompt)),
            concept: subjectPrompt,
            phase,
            depth: depth + 1,
          };
          rememberWorldSheet(sheet);
          // A traveler already waiting on this ground glides onto it the
          // moment it exists; a final landing underfoot settles the ink.
          if (awaitedCellRef.current && addressesEqual(awaitedCellRef.current, address)) {
            awaitedCellRef.current = null;
            glideToCell(address);
            adoptSheet(sheet, "new territory to the " + slot.direction);
          } else if (phase === "final" && addressesEqual(worldAddressRef.current, address)) {
            setRenderPhase("final");
            setStatus("new territory to the " + slot.direction + " · final chart settled");
          }
          return sheet;
        };
        try {
          await requestNeighborPhase("preview");
          if (controller.signal.aborted || parentRequestId !== requestRef.current) return;
          await requestNeighborPhase("final");
        } catch {
          if (controller.signal.aborted) return;
        } finally {
          pendingCellsRef.current.delete(addressKey(address));
        }
      }
    });
    await Promise.allSettled(workers);
    if (neighborAbortRef.current === controller) neighborAbortRef.current = null;
  };

  const generateMap = async ({
    mode,
    subjectPrompt,
    focus,
    direction,
    clip,
    optimisticSeeds,
    prefetchNeighbors = true,
    sourceImage,
    plane,
    targetCell,
    childRect,
    level,
    glideOnLand,
  }: GenerationIntent) => {
    invalidateGeneration();
    const requestId = ++requestRef.current;
    const clientGenerationId = generationId(requestId);
    generationIdRef.current = clientGenerationId;
    phaseRankRef.current = 0;
    generationIntentRef.current = {
      mode,
      subjectPrompt,
      focus,
      direction,
      clip,
      optimisticSeeds,
      prefetchNeighbors,
      sourceImage,
      plane,
      targetCell,
      childRect,
      level,
      glideOnLand,
    };
    const controller = new AbortController();
    abortRef.current = controller;
    const generationIsCurrent = () => atlasGenerationIsCurrent(
      requestId,
      requestRef.current,
      clientGenerationId,
      generationIdRef.current,
    );
    // Fresh concepts and zoom children draw native sheets. Zoom used to crop
    // and edit the on-screen bitmap; once Flux left a soft preview, every
    // deeper zoom upsampled that mush and the blur never cleared.
    const currentImage = (mode === "generate" || mode === "zoom")
      ? null
      : (sourceImage ?? worldRef.current.peek(worldAddressRef.current)?.image ?? null);
    const depth = generationDepthRef.current;
    // Where this landing sits on the world plane: lateral travel takes the
    // neighboring address, a refine deepens the ground it stands on, and a
    // new plane restarts at the origin.
    const departingAddress = { ...worldAddressRef.current };
    const landCell = targetCell
      ?? (mode === "shift" && direction
        ? shiftAddress(departingAddress, direction)
        : mode === "refine"
          ? departingAddress
          : { ...ATLAS_WORLD_ORIGIN });
    const landDepth = mode === "generate" ? 0 : mode === "refine" ? depth : depth + 1;
    const childLevel = level ?? 0;
    const resolvedClip = clip
      ?? (mode === "shift" && direction ? clipRectForShiftDirection(direction) : undefined);
    const usesClippedSource = Boolean(
      currentImage
      && resolvedClip
      && mode === "shift",
    );
    setBusy(true);
    // The diffusion ring stands where the drawing will land on the plane.
    setBusyFocus(childRect ? {
      x: viewRef.current.x + (childRect.x + childRect.width / 2) * metricsRef.current.mapWidth * viewRef.current.zoom,
      y: viewRef.current.y + (childRect.y + childRect.height / 2) * metricsRef.current.mapHeight * viewRef.current.zoom,
    } : null);
    if (plane === "new") setRenderPhase("local");
    if (optimisticSeeds) setSeeds(optimisticSeeds);

    let imageForRequest = currentImage;
    let sourceImageCropped = false;
    if (usesClippedSource && currentImage && resolvedClip) {
      const preparedSource = await prepareAtlasSourceImage(currentImage, resolvedClip);
      if (controller.signal.aborted || !generationIsCurrent()) return;
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
    let hasGlided = false;

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
      if (!generationIsCurrent()) return;
      const generation = isRecord(data.generation) ? data.generation : {};
      const echoedId = typeof generation.generationId === "string" ? generation.generationId : clientGenerationId;
      const echoedPhase = generation.phase === "preview" || generation.phase === "final" ? generation.phase : phase;
      if (echoedId !== clientGenerationId || echoedPhase !== phase) return;
      const rank = phase === "final" ? 2 : 1;
      if (rank < phaseRankRef.current) return;
      phaseRankRef.current = rank;
      const nextHotspots = normaliseHotspots(data.hotspots);
      const nextSeeds = normaliseSeeds(data.seeds, optimisticSeeds ?? localSeeds(subjectPrompt));
      if (typeof data.dataUrl === "string" && data.dataUrl) {
        landedImage = data.dataUrl;
        if (plane === "new" && planeAppliedForRef.current !== clientGenerationId) {
          // A whole new plane. It lands only under a still hand — if the
          // camera is being played, the arrival waits at the settle path.
          const payload: LandedPlane = {
            image: data.dataUrl,
            hotspots: nextHotspots,
            seeds: nextSeeds,
            concept: subjectPrompt,
            phase,
            depth: landDepth,
            generationId: clientGenerationId,
          };
          if (interactingRef.current || pointersRef.current.size > 0 || inertiaRef.current !== null) {
            pendingPlaneRef.current = payload;
            setStatus("a new chart has surfaced · it waits for stillness");
          } else {
            planeAppliedForRef.current = clientGenerationId;
            applyLandedPlane(payload);
            setRenderPhase(phase);
            setStatus(phase === "preview" ? "a quick chart has surfaced · refining…" : "a new atlas has surfaced");
          }
        } else if (plane === "new") {
          // Second phase of an already-applied plane: settle the origin ink.
          rememberWorldSheet({
            address: { ...ATLAS_WORLD_ORIGIN },
            image: data.dataUrl,
            hotspots: nextHotspots,
            seeds: nextSeeds,
            concept: subjectPrompt,
            phase,
            depth: landDepth,
          });
          if (addressesEqual(worldAddressRef.current, ATLAS_WORLD_ORIGIN)) {
            if (nextHotspots) setHotspots(nextHotspots);
            setSeeds(nextSeeds);
            setRenderPhase(phase);
          }
          setStatus(phase === "final" ? "the final ink has settled" : "a quick chart has surfaced · refining…");
        } else if (mode === "zoom" && childRect) {
          // A child of the pyramid: deeper ground resolves exactly where
          // the camera already looks. No recenter, no swap — the blur
          // under the zoom simply becomes drawing.
          upsertChildTile(
            "child-" + planeEpochRef.current + "-" + clientGenerationId,
            childRect,
            childLevel,
            data.dataUrl,
            phase,
          );
          setRenderPhase(phase);
          setStatus(phase === "preview" ? "deeper ground is surfacing · refining…" : "the deeper ground has settled");
        } else {
          // A lateral shift or an in-place refine: the sheet takes its
          // cell on the plane; a waiting traveler glides onto it.
          const sheet: AtlasWorldSheet<MapHotspot[], MapSeeds> = {
            address: { ...landCell },
            image: data.dataUrl,
            hotspots: nextHotspots,
            seeds: nextSeeds,
            concept: subjectPrompt,
            phase,
            depth: landDepth,
          };
          rememberWorldSheet(sheet);
          if (glideOnLand && !hasGlided) {
            hasGlided = true;
            glideToCell(landCell);
            adoptSheet(sheet);
            setStatus(direction
              ? "new territory to the " + direction + (phase === "preview" ? " · refining…" : "")
              : "the chart has grown");
          } else if (addressesEqual(worldAddressRef.current, landCell)) {
            if (nextHotspots) setHotspots(nextHotspots);
            setSeeds(nextSeeds);
            setRenderPhase(phase);
            if (mode === "refine") {
              setStatus(phase === "final" ? "the ground has deepened" : "the ground is deepening…");
            } else if (direction) {
              setStatus("new territory to the " + direction + (phase === "preview" ? " · refining…" : ""));
            }
          }
        }
      } else {
        if (nextHotspots) setHotspots(nextHotspots);
        setSeeds(nextSeeds);
        setStatus(phase === "preview" ? "the local chart is refining…" : "the local atlas is ready to explore");
      }
      if (phase === "final") {
        setBusy(false);
        setBusyFocus(null);
      }
    };

    // Preview first, then final. Parallel finals were dying as cancelled/408 when
    // the long GPT Image connection outlived the edge — the sheet stuck on Flux.
    // Sequential + one retry gives the final a fresh request after Klein lands.
    let previewFailed = false;
    let finalFailed = false;
    try {
      await requestPhase("preview");
    } catch (error) {
      previewFailed = true;
      if (controller.signal.aborted || !generationIsCurrent()) {
        abortRef.current = null;
        generationIdRef.current = null;
        phaseRankRef.current = 0;
        generationIntentRef.current = null;
        setBusy(false);
        setBusyFocus(null);
        return;
      }
      setStatus(error instanceof Error ? error.message : "The atlas held its present shape.");
    }
    if (!controller.signal.aborted && generationIsCurrent()) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await requestPhase("final");
          finalFailed = false;
          break;
        } catch {
          finalFailed = true;
          if (controller.signal.aborted || !generationIsCurrent()) break;
        }
      }
    }
    if (controller.signal.aborted || !generationIsCurrent()) {
      abortRef.current = null;
      generationIdRef.current = null;
      phaseRankRef.current = 0;
      generationIntentRef.current = null;
      setBusy(false);
      setBusyFocus(null);
      return;
    }
    if (previewFailed && finalFailed) {
      setRenderPhase("error");
    } else if (finalFailed && phaseRankRef.current === 1) {
      setStatus("the quick chart is ready · the final ink held back");
    } else if (
      phaseRankRef.current > 0
      && landedImage
      && prefetchNeighbors
      && (plane === "new" || mode === "shift")
    ) {
      // Speculate laterally from the landed ground — but never from a
      // plane still waiting for a still hand, whose world isn't live yet.
      const planeStillPending = plane === "new" && planeAppliedForRef.current !== clientGenerationId;
      if (!planeStillPending) {
        void prefetchNeighborBatch({
          sourceCell: plane === "new" ? { ...ATLAS_WORLD_ORIGIN } : { ...landCell },
          sourceImage: landedImage,
          subjectPrompt,
          depth: generationDepthRef.current,
          parentRequestId: requestId,
        });
      }
    }
    abortRef.current = null;
    generationIdRef.current = null;
    phaseRankRef.current = 0;
    generationIntentRef.current = null;
    setBusy(false);
    setBusyFocus(null);
  };

  const scheduleGeneration = (intent: GenerationIntent, delayMs: number) => {
    if (regionSettleRef.current !== null) window.clearTimeout(regionSettleRef.current);
    const settledSelection = requestRef.current;
    generationIntentRef.current = intent;
    setBusy(true);
    regionSettleRef.current = window.setTimeout(() => {
      regionSettleRef.current = null;
      if (settledSelection !== requestRef.current) return;
      void generateMap(intent);
    }, delayMs);
  };

  const enterHotspot = (hotspot: MapHotspot) => {
    const parent = captureSnapshot();
    historyRef.current.push(parent);
    if (historyRef.current.length > 8) historyRef.current.shift();
    setHistoryDepth(historyRef.current.length);
    invalidateGeneration();
    stopNeighborGeneration();
    // A mark is a door into that thing's own world — a coin opens a coin map,
    // not a refined patch of the parent Catalan sheet. The standing plane
    // keeps breathing until the new one lands.
    const subject = (hotspot.prompt || hotspot.label).replace(/ +/g, " ").trim();
    setConcept(subject);
    setFocusedId(hotspot.id);
    setFocusedLabel(hotspot.label);
    setRegion(hotspot.regionId);
    // the region halo answers with the same weight the finger gave it
    const tapPoint = pointerStartRef.current;
    if (tapPoint) {
      setPulse({ x: tapPoint.x, y: tapPoint.y, key: Date.now(), intensity: lastTapIntensityRef.current });
    }
    setStatus("opening a world of " + subject.toLowerCase());
    setRenderPhase("local");
    try {
      getFieldAudio().chime();
      haptics.roll();
    } catch {
      // Sound and haptics are progressive enhancement.
    }
    recordTape("region", 0.84, "atlas/enter/" + hotspot.id);
    scheduleGeneration({
      mode: "generate",
      plane: "new",
      subjectPrompt: subject,
      optimisticSeeds: localSeeds(subject),
    }, 280);
  };

  // Travel across the plane: remembered ground is simply glided onto;
  // ground being drawn is waited for; unknown ground is asked for and
  // glided onto when it lands. The camera moves — the world does not swap.
  const travel = (direction: Direction) => {
    maybeAdoptCell();
    const target = shiftAddress(worldAddressRef.current, direction);
    const known = worldRef.current.recall(target);
    markGesture();
    if (known) {
      recordTape("region", 0.72, "atlas/travel/" + direction + "/known");
      glideToCell(target);
      adoptSheet(known, "familiar ground to the " + direction + " \u00b7 the chart kept it");
      if (known.phase === "preview" && !pendingCellsRef.current.has(addressKey(target))) {
        // Ground that never settled gets its final ink on return. Refine
        // requires a focus point server-side; the whole-sheet settle
        // centers on the middle of the chart.
        scheduleGeneration({
          mode: "refine",
          plane: "same",
          targetCell: target,
          subjectPrompt: known.concept,
          focus: { x: 0.5, y: 0.5, zoom: 1 },
          prefetchNeighbors: false,
          sourceImage: known.image,
        }, 80);
      } else if (known.phase === "final") {
        void prefetchNeighborBatch({
          sourceCell: { ...target },
          sourceImage: known.image,
          subjectPrompt: known.concept,
          depth: known.depth,
          parentRequestId: requestRef.current,
        });
      }
      return;
    }
    if (pendingCellsRef.current.has(addressKey(target))) {
      // A speculative drawing of that ground is already in flight — wait
      // at the frontier and glide on the moment it lands.
      awaitedCellRef.current = { ...target };
      setStatus("crossing " + direction + " \u00b7 the chart is drawing that ground");
      recordTape("region", 0.72, "atlas/travel/" + direction + "/awaited");
      return;
    }
    const seed = seeds[direction];
    setConcept(seed);
    setFocusedId(null);
    setFocusedLabel(null);
    setRegion(null);
    setStatus("crossing " + direction + " toward " + seed);
    setRenderPhase("local");
    recordTape("region", 0.72, "atlas/travel/" + direction + "/" + seed);
    void generateMap({
      mode: "shift",
      plane: "same",
      direction,
      targetCell: target,
      clip: clipRectForShiftDirection(direction),
      optimisticSeeds: localSeeds(seed),
      subjectPrompt: seed,
      glideOnLand: true,
      sourceImage: worldRef.current.peek(worldAddressRef.current)?.image,
    });
  };


  const submitPrompt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const raw = prompt.trim();
    if (!raw) return;
    historyRef.current = [];
    setHistoryDepth(0);
    stopNeighborGeneration();
    setPrompt("");
    setConcept(raw);
    setFocusedId(null);
    setFocusedLabel(null);
    setRegion(null);
    setStatus("drawing a map of " + raw);
    setRenderPhase("local");
    recordTape("imagine", 0.94, "atlas/" + raw.slice(0, 32));
    void generateMap({
      mode: "generate",
      plane: "new",
      optimisticSeeds: localSeeds(raw),
      subjectPrompt: raw,
    });
  };

  // a world carried down from the stars: whoever dove through the deep
  // wall while over a condensed planet left its name in sessionStorage —
  // the chart opens on that world instead of the origin sheet. Consumed
  // once, honored only while fresh; an ordinary arrival changes nothing.
  const descentConsumedRef = useRef(false);
  useEffect(() => {
    if (descentConsumedRef.current) return;
    descentConsumedRef.current = true;
    try {
      const raw = window.sessionStorage.getItem(PLANET_DESCENT_KEY);
      if (!raw) return;
      window.sessionStorage.removeItem(PLANET_DESCENT_KEY);
      const d = JSON.parse(raw) as { prompt?: unknown; at?: unknown };
      if (typeof d.prompt !== "string" || !d.prompt) return;
      if (Date.now() - (typeof d.at === "number" ? d.at : 0) > 90_000) return;
      const subject = d.prompt.slice(0, 96);
      setConcept(subject);
      setStatus("drawing a map of " + subject);
      setRenderPhase("local");
      recordTape("imagine", 0.94, "atlas/descent/" + subject.slice(0, 32));
      void generateMap({
        mode: "generate",
        plane: "new",
        optimisticSeeds: localSeeds(subject),
        subjectPrompt: subject,
      });
    } catch { /* noop */ }
    // one-shot arrival read — the closure's helpers are stable for it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Zoom-out at the camera floor is a request for a wider world: the
  // floor already shows everything explored, so pulling back further
  // asks the generator for a wider chart of the surroundings — a new
  // plane, with this one kept on the history stack. Rate-limited so a
  // burst of scroll ticks mints exactly one.
  // Returns true only when a wider-chart generation was dispatched; a
  // false means the room has already answered this extreme and further
  // pinch-out is the manifold's to catch.
  const requestWiderTerritory = (force = false): boolean => {
    if (hasPendingGenerationWork()) return false;
    const nowMs = performance.now();
    if (!force && nowMs - lastWidenAtRef.current < 1500) return false;
    const m = metricsRef.current;
    if (!m.width) return false;
    lastWidenAtRef.current = nowMs;
    // Focus in the standing sheet's local coordinates, at its own fit.
    const focus = {
      ...focusForSheet(viewRef.current, m, cellRect(worldAddressRef.current)),
      zoom: 1,
    };
    const parent = captureSnapshot();
    invalidateGeneration();
    historyRef.current.push(parent);
    if (historyRef.current.length > 8) historyRef.current.shift();
    setHistoryDepth(historyRef.current.length);
    setStatus("widening the chart to the surrounding territory");
    setRenderPhase("local");
    recordTape("region", 0.68, "atlas/widen-from-fit");
    void generateMap({
      mode: "zoom",
      plane: "new",
      subjectPrompt: concept + " \u00b7 wider territory",
      focus,
    });
    return true;
  };


  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("form, input, [data-map-ui]")) return;
    event.preventDefault();
    stopInertia();
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const current = viewRef.current;
    const floor = cameraZoomFloor(metricsRef.current);
    // The attempted log-zoom velocity of this tick, in the gesture engine's
    // wheel convention (ln-ratio × 60/s); positive means zooming in.
    const attemptedVel = -event.deltaY * 0.0018 * 60;
    // Already surveying all explored ground and still pulling back —
    // treat that as "show me a wider world" and mint one. When the room
    // has already answered (busy or debounced), the residue goes to the
    // manifold wall toward the earth.
    if (event.deltaY > 0 && current.zoom <= floor + 0.02) {
      if (requestWiderTerritory()) resetScaleEdge();
      else reportScaleEdge(current.zoom, attemptedVel);
      return;
    }
    const nextZoom = clamp(current.zoom * Math.exp(-event.deltaY * 0.0018), floor, MAX_ZOOM);
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const worldX = (point.x - current.x) / current.zoom;
    const worldY = (point.y - current.y) / current.zoom;
    applyLiveView(boundCamera({
      zoom: nextZoom,
      x: point.x - worldX * nextZoom,
      y: point.y - worldY * nextZoom,
    }, metricsRef.current));
    scheduleSettle();
    // Attempted minus achieved ln-ratio: zero strictly inside the range,
    // and at the deepest zoom the clamped residue presses toward the coast.
    reportScaleEdge(nextZoom, attemptedVel - Math.log(nextZoom / current.zoom) * 60);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    // Hotspots are buttons but must not steal the drag; chrome uses data-map-ui.
    if (target.closest("form, input, [data-map-ui]")) return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    stopInertia();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    // intensity from the best physical channel (force → contact area),
    // read once at landing so taps and hotspot halos share it
    lastTapIntensityRef.current = intensityFrom({
      pressure: event.pressure,
      width: event.width,
      height: event.height,
    });
    pointerStartRef.current = point;
    pointersRef.current.set(event.pointerId, point);
    interactingRef.current = true;
    setInteracting(true);
    paintPlane(viewRef.current, null);
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
      // Long-press plant: if the finger stays essentially still for
      // ATLAS_PLANT_MS, leave a natural at that spot. Coexists with the
      // existing tap/click/drag behavior because the timer is cancelled
      // the moment the drag threshold is crossed (see onPointerMove) or
      // the pointer lifts (see finishPointer).
      const pid = event.pointerId;
      const plantTimer = setTimeout(() => {
        plantTimersRef.current.delete(pid);
        const stageEl = stageRef.current;
        const mNow = metricsRef.current;
        const place = addNaturalRef.current;
        if (!stageEl || !mNow.width || !place) return;
        // Cancel if the pointer already lifted, or was reclassified as
        // pinch/drag, or the hold happened during a busy generation.
        if (!pointersRef.current.has(pid)) return;
        if (dragRef.current?.moved || pinchZoomRef.current) return;
        if (busy) return;
        const startPt = pointerStartRef.current;
        if (!startPt) return;
        // The plant lands in the standing cell's local coordinates so it
        // stays with that ground on the plane.
        const wpt = worldPointAtScreen(viewRef.current, mNow, startPt.x, startPt.y);
        const addr = worldAddressRef.current;
        const nx = wpt.wx - addr.wx;
        const ny = wpt.wy - addr.wy;
        if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
        if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return;
        // Cairn is the default surprise; a wildflower shows up often
        // enough to feel warm; a trail is a rare gift.
        const roll = Math.random();
        const kind: AtlasNaturalKind =
          roll < 0.70 ? "cairn" :
          roll < 0.95 ? "flower" :
          "trail";
        place(kind, nx, ny);
        setPulse({ x: startPt.x, y: startPt.y, key: Date.now(), intensity: 0.7 });
        setStatus(
          kind === "cairn" ? "a cairn stands where you paused" :
          kind === "flower" ? "a wildflower opens where you paused" :
          "an animal trail crosses the ground",
        );
        try {
          getFieldAudio().chime();
          haptics.roll();
        } catch {
          // Sound and haptics are progressive enhancement.
        }
        recordTape("region", 0.68, "atlas/plant/" + kind);
      }, ATLAS_PLANT_MS);
      plantTimersRef.current.set(pid, plantTimer);
    } else if (pointersRef.current.size === 2) {
      markGesture();
      pinchZoomRef.current = true;
      pinchAtRef.current = performance.now();
      const points = Array.from(pointersRef.current.values());
      pinchRef.current = {
        distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y),
        midpoint: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 },
        view: { ...viewRef.current },
      };
      dragRef.current = null;
      // A second finger arriving means the gesture is a pinch; cancel
      // any pending plant so we do not drop a cairn mid-zoom.
      plantTimersRef.current.forEach((id) => window.clearTimeout(id));
      plantTimersRef.current.clear();
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
      const floor = cameraZoomFloor(metricsRef.current);
      // Contracting pinch at the camera floor is a request for a wider
      // world. When the room has already answered, the continued
      // contraction becomes manifold wall pressure below.
      const wantsWider = distance < prev.distance * 0.94
        && viewRef.current.zoom <= floor + 0.02;
      const zoom = clamp(prev.view.zoom * (distance / Math.max(1, prev.distance)), floor, MAX_ZOOM);
      // Incremental pinch around the live midpoint keeps mobile two-finger zoom stable.
      const worldX = (midpoint.x - prev.view.x) / prev.view.zoom;
      const worldY = (midpoint.y - prev.view.y) / prev.view.zoom;
      const next = boundCamera({
        zoom,
        x: midpoint.x - worldX * zoom,
        y: midpoint.y - worldY * zoom,
      }, metricsRef.current, 48);
      const liveViewChanged = (
        Math.abs(viewRef.current.x - prev.view.x) > 0.5
        || Math.abs(viewRef.current.y - prev.view.y) > 0.5
        || Math.abs(viewRef.current.zoom - prev.view.zoom) > 0.001
      );
      if (liveViewChanged) {
        pinchRef.current = { distance, midpoint, view: { ...viewRef.current } };
        pinchAtRef.current = performance.now();
        return;
      }
      applyLiveView(next);
      pinchRef.current = { distance, midpoint, view: next };
      // Defer wider-chart minting until fingers settle — mid-gesture dispatch
      // is what lets a stale wider sheet land under a still-moving pinch.
      if (wantsWider) {
        pendingWiderTerritoryRef.current = true;
        resetScaleEdge();
      }
      // Residual pinch past a held extreme → the band walls: attempted
      // minus achieved ln-ratio per second, zero inside the plane's range.
      const nowMs = performance.now();
      const dtMs = nowMs - pinchAtRef.current;
      pinchAtRef.current = nowMs;
      if (pendingWiderTerritoryRef.current) {
        resetScaleEdge();
      } else if (dtMs > 0) {
        const attempted = distance / Math.max(1, prev.distance);
        const achieved = zoom / prev.view.zoom;
        reportScaleEdge(zoom, Math.log(attempted / Math.max(1e-6, achieved)) / (dtMs / 1000));
      }
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const now = performance.now();
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      if (!drag.moved) {
        markGesture();
        const liveViewChanged = (
          Math.abs(viewRef.current.x - drag.view.x) > 0.5
          || Math.abs(viewRef.current.y - drag.view.y) > 0.5
          || Math.abs(viewRef.current.zoom - drag.view.zoom) > 0.001
        );
        // Moving past the drag threshold means this is not a hold; drop
        // any pending plant timer for this finger.
        const pending = plantTimersRef.current.get(event.pointerId);
        if (pending != null) {
          window.clearTimeout(pending);
          plantTimersRef.current.delete(event.pointerId);
        }
        if (liveViewChanged) {
          drag.start = point;
          drag.view = { ...viewRef.current };
          drag.last = point;
          drag.lastAt = now;
          drag.velocity = { x: 0, y: 0 };
          drag.moved = true;
          return;
        }
      }
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
    applyLiveView(boundCamera({
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
    // Whichever way the pointer leaves — clean lift, cancel, whatever —
    // the plant timer for that finger has to go with it or a stale
    // timeout would fire on a lifted pointer.
    const pendingPlant = plantTimersRef.current.get(event.pointerId);
    if (pendingPlant != null) {
      window.clearTimeout(pendingPlant);
      plantTimersRef.current.delete(event.pointerId);
    }
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
    if (wasPinching) releaseScaleEdge();
    const live = viewRef.current;
    const bounded = boundCamera(live, metricsRef.current);
    if (wasPinching) {
      interactingRef.current = false;
      setInteracting(false);
      commitView(bounded, { animate: true });
      dragRef.current = null;
      scheduleSettle();
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
      travel(crossed[0]);
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
      if (performance.now() - lastGestureAtRef.current < THRESHOLDS.tapTrainMs) {
        dragRef.current = null;
        return;
      }
      // A bare tap steps back out of an entered world; on open ground it
      // is simply a touch the water remembers. Zoom no longer implies a
      // stacked state — the camera owns it.
      if (focusedId && historyRef.current.length > 0) {
        resetOuterMap();
      } else {
        setPulse({ x: point.x, y: point.y, key: Date.now(), intensity: lastTapIntensityRef.current });
        setStatus("the water remembers the touch");
        recordTape("ripple", 0.3 + lastTapIntensityRef.current * 0.3, "atlas/water");
      }
    } else {
      scheduleSettle();
    }
    dragRef.current = null;
  };

  // A glance across the world plane: the 5×5 of addresses around the
  // standing sheet for the traverse chart, and the names of remembered
  // neighbors so an edge into known territory answers with its own name.
  const worldGlance = useMemo(() => {
    void worldVersion;
    const world = worldRef.current;
    const center = worldAddressRef.current;
    const cells: Array<{ key: string; state: "here" | "final" | "preview" | "unknown" }> = [];
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const address = { wx: center.wx + dx, wy: center.wy + dy };
        const sheet = world.peek(address);
        cells.push({
          key: addressKey(address),
          state: dx === 0 && dy === 0
            ? "here"
            : sheet
              ? sheet.phase === "final" ? "final" : "preview"
              : "unknown",
        });
      }
    }
    const edges: Partial<Record<Direction, string>> = {};
    for (const direction of DIRECTIONS) {
      const sheet = world.peek(shiftAddress(center, direction));
      if (!sheet) continue;
      const name = sheet.concept.split("·")[0].trim().toLowerCase().slice(0, 28);
      if (name) edges[direction] = name;
    }
    return { cells, edges, size: world.size(), address: { ...center } };
  }, [worldVersion]);

  // Every tile on the plane: retiring ground beneath, cell sheets at
  // their addresses, zoom children above. Mounted regardless of camera —
  // the browser skips painting what is offscreen, and the mirror ref
  // feeds the per-frame label-tier and detail checks.
  const planeTiles = useMemo<PlaneTile[]>(() => {
    void worldVersion;
    void tileVersion;
    const width = metrics.width > 0 ? metrics.width : MOBILE_BREAKPOINT + 1;
    const cellTiles: PlaneTile[] = worldRef.current.export().map((sheet) => ({
      id: "cell-" + planeEpochRef.current + "-" + addressKey(sheet.address),
      rect: cellRect(sheet.address),
      level: 0,
      image: responsiveMapSource(sheet.image, width),
      phase: sheet.phase,
    }));
    // Before the origin seed effect runs, the plane still shows home.
    if (cellTiles.length === 0) {
      cellTiles.push({
        id: "cell-boot-origin",
        rect: cellRect(ATLAS_WORLD_ORIGIN),
        level: 0,
        image: responsiveMapSource(ORIGIN_MAP, width),
        phase: "final",
      });
    }
    const live = [...cellTiles, ...childTilesRef.current];
    allTilesRef.current = live;
    return [...retiringTilesRef.current, ...live];
  }, [worldVersion, tileVersion, metrics.width]);

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
          {planeTiles.map((tile) => (
            <div
              key={tile.id}
              className={
                "living-atlas__tile"
                + (tile.phase === "preview" ? " is-preview" : "")
                + (tile.level < 0 ? " is-retiring" : "")
              }
              style={{
                left: tile.rect.x * 100 + "%",
                top: tile.rect.y * 100 + "%",
                width: tile.rect.width * 100 + "%",
                height: tile.rect.height * 100 + "%",
                zIndex: tile.level + 2,
              }}
            >
              <AtlasTileImage src={tile.image} priority={tile.level === 0} />
            </div>
          ))}
          <div
            className="living-atlas__cell-anchor"
            style={{
              left: worldGlance.address.wx * 100 + "%",
              top: worldGlance.address.wy * 100 + "%",
            }}
          >
            {(metrics.width > 0 && metrics.width <= MOBILE_BREAKPOINT ? hotspots.slice(0, 5) : hotspots).map((hotspot) => {
              const focused = focusedId === hotspot.id;
              return (
                <button
                  key={hotspot.id}
                  type="button"
                  className={
                    "living-atlas__hotspot"
                    + (focused ? " is-focused" : "")
                    + (glimmerId === hotspot.id ? " is-glimmer" : "")
                  }
                  style={{
                    left: hotspot.x * 100 + "%",
                    top: hotspot.y * 100 + "%",
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (performance.now() - lastGestureAtRef.current < THRESHOLDS.tapTrainMs) return;
                    if (dragRef.current?.moved || interactingRef.current) return;
                    enterHotspot(hotspot);
                  }}
                  aria-label={"enter " + hotspot.label}
                  aria-pressed={focused}
                  data-hotspot={hotspot.id}
                >
                  <span className="living-atlas__mark"><MapMark kind={hotspot.kind} /></span>
                  <span className="living-atlas__label">{atlasNamePart(hotspot.label).toLowerCase()}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Living-atlas overlay: cloud shadows, weather, and naturals.
            Sits above the map plane but below the map UI (masthead,
            edges, prompt). pointer-events: none so map clicks and drags
            still land on the plane and its hotspots. */}
        <canvas
          ref={overlayRef}
          className="living-atlas__overlay"
          aria-hidden="true"
        />
        {scaleEdgeOverlay}
        <div className="living-atlas__patina" aria-hidden="true" />
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

        {DIRECTIONS.map((direction) => {
          // Ground the world already holds answers with its own name;
          // unknown ground keeps the seed's guess.
          const edgeName = worldGlance.edges[direction] ?? seeds[direction];
          const known = Boolean(worldGlance.edges[direction]);
          return (
            <button
              key={direction}
              type="button"
              className={
                "living-atlas__edge living-atlas__edge--" + direction
                + (known ? " is-known" : "")
              }
              onClick={() => travel(direction)}
              aria-label={
                (known ? "return " : "travel ") + direction + " toward " + edgeName
              }
              data-edge={direction}
            >
              <span>{atlasNamePart(edgeName)}</span>
            </button>
          );
        })}

        {worldGlance.size > 1 && (
          <div
            className={"living-atlas__traverse" + (lensFlash ? " is-lens" : "")}
            aria-hidden="true"
            data-map-ui="true"
          >
            {worldGlance.cells.map((cell) => (
              <span
                key={cell.key}
                className={
                  cell.state === "here"
                    ? "is-here"
                    : cell.state === "final"
                      ? "is-final"
                      : cell.state === "preview"
                        ? "is-preview"
                        : undefined
                }
              />
            ))}
          </div>
        )}

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
            style={{ left: pulse.x, top: pulse.y, ["--pulse-i" as string]: pulse.intensity }}
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
          /* Prefer hard pixels while the camera is CSS-scaled awaiting a
             native redraw — soft bilinear stretch made mid-zoom look mushy. */
          image-rendering: crisp-edges;
          filter: saturate(.96) contrast(1.07) brightness(.82);
          /* Very slow lung-scale set per-frame by the RAF loop via the
             --atlas-breath custom property on the stage. Composes on top
             of the plane's pan/zoom transform so the map has quiet
             motion even when nobody is touching it. */
          transform: scale(var(--atlas-breath, 1));
          transform-origin: center center;
        }
        /* A sharper drawing landing under the same tile (preview → final,
           or a re-rooted plane's origin sheet) sits on top and dissolves
           in — the ground blends into its own deeper self instead of
           popping. */
        .living-atlas__image--incoming {
          opacity: 0;
          transition: opacity 560ms ease;
        }
        .living-atlas__image--incoming.is-visible { opacity: 1; }
        .living-atlas__overlay {
          position: absolute;
          inset: 0;
          z-index: 5;
          width: 100%;
          height: 100%;
          pointer-events: none;
          mix-blend-mode: normal;
        }
        .living-atlas__tile {
          position: absolute;
          overflow: hidden;
          /* Every tile fades up on mount — a landing resolves into the
             plane where it belongs instead of swapping the whole frame. */
          animation: atlas-tile-in 700ms ease-out both;
        }
        .living-atlas__tile.is-retiring { animation: none; }
        .living-atlas__tile.is-preview .living-atlas__image {
          filter: saturate(.9) contrast(1.04) brightness(.8);
        }
        .living-atlas__cell-anchor {
          position: absolute;
          width: 100%;
          height: 100%;
          z-index: 14;
          pointer-events: none;
        }
        .living-atlas__cell-anchor .living-atlas__hotspot { pointer-events: auto; }
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
        /* Names surface with descent: quiet at the fit view, faint at
           mid zoom, named outright near the ground — the chart earns its
           annotations the way a map does. Hover still answers at any tier
           (the rules below win the cascade). */
        .living-atlas__stage[data-zoom-tier="mid"] .living-atlas__label { opacity: .45; }
        .living-atlas__stage[data-zoom-tier="near"] .living-atlas__label { opacity: .92; }
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
        /* An edge into remembered ground carries its settled name a
           shade brighter than a seed's guess. */
        .living-atlas__edge.is-known { color: rgba(244, 222, 156, .84); }
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
        .living-atlas__traverse {
          /* The traverse chart: a 5×5 glance of the plane around the
             standing sheet. Walked ground glows, the current address
             burns — the map's own memory, visible at the corner of the
             eye, never a control. */
          position: absolute;
          z-index: 8;
          right: max(18px, env(safe-area-inset-right, 0px));
          bottom: max(27px, env(safe-area-inset-bottom, 0px));
          display: grid;
          grid-template-columns: repeat(5, 8px);
          grid-auto-rows: 8px;
          gap: 3px;
          pointer-events: none;
          opacity: .85;
        }
        .living-atlas__traverse span {
          border-radius: 1px;
          background: rgba(245, 220, 154, .06);
          box-shadow: inset 0 0 0 1px rgba(245, 220, 154, .05);
        }
        .living-atlas__traverse span.is-final { background: rgba(241, 212, 132, .34); }
        .living-atlas__traverse span.is-preview { background: rgba(241, 212, 132, .15); }
        .living-atlas__traverse span.is-here {
          background: rgba(248, 226, 150, .85);
          box-shadow: 0 0 8px rgba(239, 197, 92, .5);
        }
        /* twist(2) = rotate the lens: the traverse chart — the map, not
           the territory — swells into plain view for a moment. */
        .living-atlas__traverse.is-lens {
          opacity: 1;
          transform: scale(1.7);
          transform-origin: bottom right;
          transition: transform 420ms cubic-bezier(.2,.7,.2,1), opacity 420ms ease;
        }
        .living-atlas__traverse:not(.is-lens) {
          transition: transform 420ms cubic-bezier(.2,.7,.2,1), opacity 420ms ease;
        }
        @media (prefers-reduced-motion: reduce) {
          .living-atlas__traverse.is-lens,
          .living-atlas__traverse:not(.is-lens) { transition: none; }
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
          /* tap intensity (0..1 from gesture/core) sizes the ring and
             weights its ink — a harder touch leaves a larger mark */
          width: calc(8px + var(--pulse-i, 0.5) * 12px);
          height: calc(8px + var(--pulse-i, 0.5) * 12px);
          margin: calc(-4px - var(--pulse-i, 0.5) * 6px);
          border: 1px solid rgba(241, 212, 132, calc(0.55 + var(--pulse-i, 0.5) * 0.4));
          border-radius: 50%;
          pointer-events: none;
          animation: atlas-ripple 1s ease-out forwards;
        }
        .living-atlas__hotspot.is-glimmer .living-atlas__mark {
          animation: atlas-glimmer 2.6s ease-in-out 1;
        }
        @keyframes atlas-tile-in {
          /* A faint inward settle reads as the ground coming into focus
             rather than a flat cut — the same depth cue a lens racks. */
          from { opacity: 0; transform: scale(1.018); }
          to { opacity: 1; transform: scale(1); }
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
          to { transform: scale(calc(8 + var(--pulse-i, 0.5) * 8)); opacity: 0; }
        }
        @keyframes atlas-glimmer {
          0%, 100% { box-shadow: inset 0 0 0 1px rgba(245, 220, 154, .28), 0 0 0 6px rgba(5, 17, 25, .12); }
          45% { box-shadow: inset 0 0 0 1px rgba(245, 220, 154, .6), 0 0 22px 8px rgba(239, 197, 92, .34); }
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
          .living-atlas__tile { animation-duration: 380ms; }
          .living-atlas__traverse {
            /* clear the full-width prompt row */
            right: 14px;
            bottom: 76px;
            grid-template-columns: repeat(5, 6px);
            grid-auto-rows: 6px;
            gap: 2px;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .living-atlas__tile { animation-duration: 1ms; }
          .living-atlas__diffusion span,
          .living-atlas__ripple,
          .living-atlas__hotspot.is-glimmer .living-atlas__mark { animation: none; }
          /* The RAF loop already skips writing --atlas-breath when
             reduced motion is set; this line makes any stale value
             harmless. */
          .living-atlas__image { transform: none; }
        }
      `}</style>
      <LetGo
        label="let the ground go"
        visible={naturalsCount > 0}
        onLetGo={() => {
          clearNaturalsRef.current?.();
          try { getFieldAudio().thud(); } catch { /* noop */ }
          try { haptics.roll(); } catch { /* noop */ }
          recordTape("kept", 0.3, "atlas/naturals/let-go");
        }}
      />
    </section>
  );
}

// ── living-atlas atmosphere helpers ──────────────────────────────
// Weather events (frame-relative) and naturals (map-anchored) are
// drawn on the overlay canvas by Atlas's RAF loop. Same helper-at-
// bottom pattern as Ocean.tsx so the render loop above stays readable.

/**
 * A single weather event painted into the overlay canvas at its current
 * age. Frame-relative — the sky belongs to the viewport, not the map —
 * so a bird flock crosses the visible width regardless of pan/zoom.
 */
function drawAtlasWeather(
  ctx: CanvasRenderingContext2D,
  e: AtlasWeatherEvent,
  age: number,
  w: number,
  h: number,
) {
  if (e.kind === "flock") {
    // A skein of small V-silhouettes crossing the map. Ported from
    // Ocean.tsx drawWeatherSky seabirds and re-tinted for land.
    const f = age / e.duration;
    ctx.save();
    ctx.strokeStyle = "rgba(22, 28, 40, 0.72)";
    ctx.lineWidth = 1;
    for (let b = 0; b < e.count; b++) {
      const bf = b / e.count;
      const p = f + bf * 0.06;
      const bx = e.dir > 0 ? -30 + p * (w + 60) : w + 30 - p * (w + 60);
      const by = e.yBase * h + Math.sin(e.seed + b * 1.7 + age * 0.9) * 4 + bf * 5;
      const wing = 3 + Math.sin(age * 8 + b) * 1.4;
      ctx.beginPath();
      ctx.moveTo(bx - wing, by + wing * 0.4);
      ctx.lineTo(bx, by);
      ctx.lineTo(bx + wing, by + wing * 0.4);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  if (e.kind === "cloud") {
    // A bigger, darker cloud shadow than the ambient bed. Grows in,
    // plateaus, and dissolves as it drifts across the frame.
    const f = age / e.duration;
    const grow = f < 0.15 ? f / 0.15 : f < 0.85 ? 1 : 1 - (f - 0.85) / 0.15;
    const x = e.dir > 0 ? -0.15 + f * 1.30 : 1.15 - f * 1.30;
    const cx = x * w;
    const cy = e.y * h;
    const rad = e.radius * Math.min(w, h) * 2.4;
    // Same colour every time this fires — only alpha (e.alpha * grow) and
    // radius vary — so the sprite bakes once, ever, through the shared
    // radial-sprite cache, and this call is a Map lookup + a stamp.
    const sprite = bakeRadialSprite("atlas-weather-cloud", {
      width: 256,
      height: 256,
      stops: [
        { offset: 0, color: "rgba(6, 10, 18, 1)" },
        { offset: 1, color: "rgba(6, 10, 18, 0)" },
      ],
    });
    drawRadialStamp(ctx, sprite, cx, cy, rad, e.alpha * grow);
    return;
  }
  if (e.kind === "gust") {
    // A thin, fast horizontal shimmer streak — wind moving over grass,
    // but abstract. Additive so it reads like light, not a shadow.
    const f = age / e.duration;
    const grow = f < 0.2 ? f / 0.2 : f < 0.8 ? 1 : 1 - (f - 0.8) / 0.2;
    const cx = (e.dir > 0 ? -0.2 + f * 1.4 : 1.2 - f * 1.4) * w;
    const cy = e.y * h;
    const streakW = w * 0.45;
    const streakH = 22;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createLinearGradient(cx - streakW / 2, cy, cx + streakW / 2, cy);
    const alpha = 0.10 * grow;
    g.addColorStop(0.0, "rgba(240, 232, 200, 0)");
    g.addColorStop(0.5, `rgba(240, 232, 200, ${alpha})`);
    g.addColorStop(1.0, "rgba(240, 232, 200, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(cx - streakW / 2, cy - streakH / 2, streakW, streakH);
    ctx.restore();
    return;
  }
  if (e.kind === "sunbeam") {
    // A soft warm-tinted diagonal light patch sweeping across the map
    // as if a cloud briefly parted. Additive.
    const f = age / e.duration;
    const grow = f < 0.25 ? f / 0.25 : f < 0.75 ? 1 : 1 - (f - 0.75) / 0.25;
    const cx = (e.dir > 0 ? -0.1 + f * 1.20 : 1.10 - f * 1.20) * w;
    const cy = e.y * h;
    const beamW = w * 0.35;
    const beamH = h * 0.55;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.translate(cx, cy);
    ctx.rotate(0.35 * e.dir);
    const g = ctx.createLinearGradient(-beamW / 2, 0, beamW / 2, 0);
    const alpha = 0.14 * grow;
    g.addColorStop(0.0, "rgba(255, 230, 168, 0)");
    g.addColorStop(0.5, `rgba(255, 230, 168, ${alpha})`);
    g.addColorStop(1.0, "rgba(255, 230, 168, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(-beamW / 2, -beamH / 2, beamW, beamH);
    ctx.restore();
    return;
  }
  if (e.kind === "migration") {
    // A much larger V of 15-25 birds traversing the whole width slowly.
    // Row offset from the formation midpoint gives the classic V.
    const f = age / e.duration;
    ctx.save();
    ctx.strokeStyle = "rgba(20, 26, 38, 0.78)";
    ctx.lineWidth = 1;
    for (let b = 0; b < e.count; b++) {
      const bf = b / Math.max(1, e.count - 1);
      const p = f - bf * 0.02;
      if (p < 0 || p > 1.05) continue;
      const bx = e.dir > 0 ? -40 + p * (w + 80) : w + 40 - p * (w + 80);
      const rowY = e.yBase * h + Math.abs(bf - 0.5) * 20 + Math.sin(e.seed + b * 0.4 + age * 0.6) * 3;
      const wing = 4 + Math.sin(age * 5 + b) * 1.5;
      ctx.beginPath();
      ctx.moveTo(bx - wing, rowY + wing * 0.5);
      ctx.lineTo(bx, rowY);
      ctx.lineTo(bx + wing, rowY + wing * 0.5);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  if (e.kind === "meteor") {
    // A brief bright streak across a small portion of the sky. Fires
    // at the natural rare cadence; there is no explicit day/night on
    // the atlas so it just reads as a shooting star.
    const f = age / e.duration;
    const headX = (e.x0 + e.dx * f) * w;
    const headY = (e.y0 + e.dy * f) * h;
    const tailX = (e.x0 + e.dx * Math.max(0, f - 0.08)) * w;
    const tailY = (e.y0 + e.dy * Math.max(0, f - 0.08)) * h;
    const alpha = Math.max(0, 1 - f);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createLinearGradient(tailX, tailY, headX, headY);
    g.addColorStop(0, "rgba(255, 240, 210, 0)");
    g.addColorStop(1, `rgba(255, 250, 220, ${alpha * 0.9})`);
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(headX, headY);
    ctx.stroke();
    ctx.fillStyle = `rgba(255, 250, 220, ${alpha})`;
    ctx.beginPath();
    ctx.arc(headX, headY, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/**
 * A single natural (cairn, wildflower, or animal trail) painted at its
 * screen position. Naturals are map-anchored: `sx`/`sy` are the screen
 * pixels where (nx, ny) lands under the current pan/zoom; `scale` is a
 * sqrt(zoom) factor so a cairn stays legible at zoom=1 without eating
 * the frame at zoom=30. Trail offsets are in normalized map coords, so
 * the whole path scales with the plane via `mapPxW`/`mapPxH`.
 */
function drawAtlasNatural(
  ctx: CanvasRenderingContext2D,
  n: AtlasNatural,
  sx: number,
  sy: number,
  scale: number,
  t: number,
  mapPxW: number,
  mapPxH: number,
) {
  if (n.kind === "cairn") {
    // A small tan pile of stones — three warm-gray ellipses stacked
    // with a soft ground shadow so it reads on a busy map.
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(scale, scale);
    ctx.fillStyle = "rgba(20, 12, 8, 0.35)";
    ctx.beginPath();
    ctx.ellipse(0, 5, 10, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    const stones = [
      { y: 2, rx: 8, ry: 4, c: "rgba(180, 154, 118, 0.95)" },
      { y: -4, rx: 6, ry: 3.4, c: "rgba(196, 168, 130, 0.94)" },
      { y: -9, rx: 4, ry: 2.6, c: "rgba(214, 188, 148, 0.9)" },
    ];
    ctx.strokeStyle = "rgba(78, 60, 40, 0.35)";
    ctx.lineWidth = 0.6;
    for (const s of stones) {
      ctx.fillStyle = s.c;
      ctx.beginPath();
      ctx.ellipse(0, s.y, s.rx, s.ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  if (n.kind === "flower") {
    // A bright dot with 4-6 petals. Petal count and hue driven by seed
    // for stable identity across renders. Sways very gently with time.
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(scale, scale);
    const petals = 4 + (n.seed % 3);
    const sway = Math.sin(t * 0.9 + n.seed * 0.01) * 0.05;
    ctx.rotate(sway);
    const hues: Array<[number, number, number]> = [
      [246, 208, 96],
      [240, 132, 108],
      [196, 170, 232],
      [236, 236, 228],
    ];
    const c = hues[n.seed % hues.length];
    for (let i = 0; i < petals; i++) {
      const ang = (i / petals) * Math.PI * 2;
      const px = Math.cos(ang) * 4.5;
      const py = Math.sin(ang) * 4.5;
      ctx.fillStyle = `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.9)`;
      ctx.beginPath();
      ctx.ellipse(px, py, 3.4, 2.4, ang, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(80, 54, 24, 0.95)";
    ctx.beginPath();
    ctx.arc(0, 0, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  if (n.kind === "trail") {
    // A short curved sequence of small tan-brown dots reading as an
    // animal path across the region. Because offsets are in normalized
    // map coords, the whole arc scales with the plane on zoom.
    if (!n.trail || n.trail.length === 0) return;
    ctx.save();
    const dotRx = 2.4 * scale * 0.7;
    const dotRy = 1.4 * scale * 0.7;
    for (let i = 0; i < n.trail.length; i++) {
      const p = n.trail[i];
      const x = sx + p.dx * mapPxW;
      const y = sy + p.dy * mapPxH;
      const alpha = 0.42 + 0.35 * (1 - i / n.trail.length);
      ctx.fillStyle = `rgba(122, 88, 58, ${alpha})`;
      ctx.beginPath();
      ctx.ellipse(x, y, dotRx, dotRy, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
