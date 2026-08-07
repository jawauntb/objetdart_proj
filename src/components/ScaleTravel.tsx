"use client";

/**
 * ScaleTravel — a room's membership card in the scale manifold.
 *
 * Mount once in any full-canvas room and the room joins the quark→manifold
 * axis: a two-finger pinch pushes the scale position toward the band's walls;
 * the wall answers with a felt detent; 320ms of sustained push breaks through
 * and the site travels to the neighboring band's room. Neighbors that aren't
 * built yet simply hold — the world ends there, quietly, for now.
 *
 * Rooms that own an internal camera (/stars, /atlas) adopt the manifold with
 * useBandEdgeTravel instead: their zoom stays theirs inside its range, and
 * only the residual pinch at a held extreme presses the same walls — same
 * physics (lib/scale.ts), same haptics, same presentation.
 *
 * Renders nothing until the hand is at a wall: then a vignette deepens with
 * edge pressure and the neighbor's name surfaces. No buttons, no chrome.
 *
 * Where a wall forks (the ground opens onto the garden, the strata, the
 * shore and the peak), *where on the frame the pinch sits* chooses which
 * door — lib/fork-regions.ts holds that law, `declareForkRegions` below
 * lets a room replace the default geography with its own, and the vignette
 * opens toward the offered door so the choice is felt before it commits.
 * A centred pinch points at nothing and keeps the press-release-press
 * carousel, which is still the whole story for keyboards and trackpads.
 *
 * See lib/scale.ts for the physics and docs/gesture-grammar.md for the verb.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { attachGestures } from "@/lib/gesture";
import {
  SCALE_BANDS,
  bandAt,
  bandIndexAt,
  doorMemoryFor,
  entryScaleFor,
  entryScaleInto,
  initialScaleState,
  liveInput,
  residualScaleInput,
  roomZoomWall,
  scaleBandIdForRoute,
  scaleForRoomZoom,
  stepBackVelocity,
  stepScale,
  travelOptions,
  travelOptionsForRoute,
  type EnteredFromMap,
  type RoomZoomSpec,
  type RouteRef,
  type ScaleBandId,
  type ScaleInput,
  type ScaleState,
  type TravelDir,
  type TravelDoor,
} from "@/lib/scale";
import {
  fanColumnCenter,
  fanRegions,
  resolveForkByPoint,
  type ForkRegion,
} from "@/lib/fork-regions";
import { detent as hapticDetent, crossing as hapticCrossing, tap as hapticTap } from "@/lib/haptics";
import { playTravelPassage } from "@/components/TravelPassage";

const STORAGE_KEY = "objetdart:scale:s";
const ENTERED_FROM_KEY = "objetdart:scale:enteredFrom:v1";

// Every band remembers the neighbor you last crossed from, so a parent with
// two children (the earth holds the atlas and the flowers) sends you back
// the way you came.
function loadEnteredFrom(): EnteredFromMap {
  try {
    const raw = window.sessionStorage.getItem(ENTERED_FROM_KEY);
    if (raw) return JSON.parse(raw) as EnteredFromMap;
  } catch {
    /* noop */
  }
  return {};
}

function recordEnteredFrom(dest: ScaleBandId, from: ScaleBandId | RouteRef): void {
  try {
    const map = loadEnteredFrom();
    map[dest] = from;
    window.sessionStorage.setItem(ENTERED_FROM_KEY, JSON.stringify(map));
  } catch {
    /* noop */
  }
}

// At a fork (the earth holds the atlas and the flowers), pressing the wall
// offers the first door; releasing and pressing again within this window
// cycles the whisper to the next. Deterministic, discoverable, no chrome.
const FORK_RECALL_MS = 2500;

type WallOffer = { dir: TravelDir | 0; idx: number; releasedAt: number; wasPressing: boolean };

function freshOffer(): WallOffer {
  return { dir: 0, idx: 0, releasedAt: -1e9, wasPressing: false };
}

function advanceOfferOnDetent(offer: WallOffer, dir: TravelDir, now: number): void {
  if (offer.dir === dir && now - offer.releasedAt < FORK_RECALL_MS) offer.idx += 1;
  else {
    offer.dir = dir;
    offer.idx = 0;
  }
}

/** Track wall release so the next press can cycle the offer. */
function noteOfferPressing(offer: WallOffer, pressing: number, now: number): void {
  if (offer.wasPressing && pressing === 0) offer.releasedAt = now;
  offer.wasPressing = pressing !== 0;
}

/**
 * Every built door out of this room in `dir` — route-aware when the room's
 * live path has a scale address (per-route doors: the ground forks to the
 * strata), band-grain otherwise (rooms living under a dynamic segment of
 * their band route, e.g. /atlas/[region]).
 */
function doorsFor(route: string, from: ScaleBandId, dir: TravelDir): TravelDoor[] {
  if (scaleBandIdForRoute(route)) {
    return travelOptionsForRoute(route, dir, loadEnteredFrom());
  }
  return travelOptions(from, dir, loadEnteredFrom()).map((b) => ({
    band: b,
    route: b.route as string,
    label: b.label,
  }));
}

/**
 * A wall is asked for its doors on every frame of a press — and answering
 * costs a sessionStorage read and a JSON parse. The offer cannot change
 * under a live press (arrival memory is written for the band being entered,
 * so this room's own memory is fixed for the life of the mount), so one
 * entry of cache per (route, band, direction) is enough to keep the hot
 * path free of parsing and allocation.
 */
let doorCache: {
  key: string;
  doors: TravelDoor[];
  routes: string[];
  /** The default fan over those doors — built once, not once per frame. */
  fan: ForkRegion[];
} | null = null;

function cachedWall(route: string, from: ScaleBandId, dir: TravelDir) {
  const key = `${route}|${from}|${dir}`;
  if (doorCache?.key !== key) {
    const doors = doorsFor(route, from, dir);
    const routes = doors.map((d) => d.route);
    doorCache = { key, doors, routes, fan: fanRegions(routes) };
  }
  return doorCache;
}

// ——— Where the pinch happens chooses the door ————————————————————
//
// The press-release-press cycle above is a blind carousel: the hand cannot
// see which door it is taking, it just presses again until the right name
// surfaces. lib/fork-regions.ts holds the law that fixes that — regions of
// the frame, each claiming a door, resolved by the pinch centroid. Every
// fork wall gets `fanRegions` by default (the doors laid west→east across
// the frame with a neutral disc in the middle); a room that knows its own
// geography — the fog line, the ridge silhouette — replaces that default
// through `declareForkRegions`. A centred pinch, or a point no region
// claims, or a claim the travel graph does not offer, all answer null and
// the cycle keeps the wall exactly as before.

/** A pinch centroid in the room's frame: nx, ny ∈ [0,1], ny = 0 at the top. */
type FramePoint = { nx: number; ny: number };

const declaredForkRegions = new Map<string, readonly ForkRegion[]>();

function forkKey(route: string, dir: TravelDir): string {
  return `${route}|${dir}`;
}

/**
 * A room declares the geography of one of its fork walls: the doors are
 * named exactly as the travel graph names them here — by ROUTE, so
 * `region("/coast", …)`, `horizonSplit(fogNy, "/mountain", "/coast")`.
 * Returns the disposer; call it on unmount. Rooms may re-declare per frame
 * (silhouetteSplit copies its samples, so a wall already being pressed
 * cannot be redrawn under the hand).
 */
export function declareForkRegions(
  route: string,
  dir: TravelDir,
  regions: readonly ForkRegion[] | null,
): () => void {
  const key = forkKey(route, dir);
  if (regions && regions.length > 0) declaredForkRegions.set(key, regions);
  else declaredForkRegions.delete(key);
  return () => {
    declaredForkRegions.delete(key);
  };
}

/**
 * The door on offer through the wall pressed in `dir`, plus where it sits on
 * the frame. Direction comes from the scale event itself, never re-derived
 * from metric order — at the axis's glued ends (the plank's floor opens onto
 * the manifold) the pressed direction and the metric direction disagree, and
 * the pressed one is the truth.
 */
type Offered = { door: TravelDoor; idx: number; count: number };

function offeredDoor(
  route: string,
  from: ScaleBandId,
  dir: TravelDir,
  offer: WallOffer,
  point: FramePoint | null,
): Offered | null {
  const wall = cachedWall(route, from, dir);
  const options = wall.doors;
  if (options.length === 0) return null;
  let idx = offer.idx % options.length;
  if (options.length > 1 && point) {
    const regions = declaredForkRegions.get(forkKey(route, dir)) ?? wall.fan;
    const picked = resolveForkByPoint(regions, point.nx, point.ny, wall.routes);
    if (picked !== null) idx = wall.routes.indexOf(picked);
  }
  return { door: options[idx], idx, count: options.length };
}

export type EdgeUI = {
  pressure: number;
  towardLabel: string | null;
  crossing: boolean;
  /**
   * Where on the frame the offered door lies, 0..1 west→east — the vignette
   * opens toward it so the choice is felt before it commits. Null (or
   * absent) is the centred, undirected wall.
   */
  towardX?: number | null;
};

const IDLE_UI: EdgeUI = { pressure: 0, towardLabel: null, crossing: false, towardX: null };

/**
 * Two-finger tap = step back (gesture grammar §5): if the room has a lens
 * raised it lowers first — rooms mark their playable surface with
 * data-lens-raised="1" and own that step themselves; only then does the
 * frame retreat. One DOM read per tap, nothing per frame.
 */
function roomLensRaised(): boolean {
  try {
    return !!document.querySelector('[data-lens-raised="1"]');
  } catch {
    return false;
  }
}

/** Which built destination the whispered name should promise while idle. */
function nearestNeighborLabel(route: string, s: number): string | null {
  const band = bandAt(s);
  const nearUpper = band.sMax - s < s - band.sMin;
  return cachedWall(route, band.id, nearUpper ? 1 : -1).doors[0]?.label ?? null;
}

/**
 * The shared travel execution: haptic roll, persist the landing position so
 * the destination room enters just inside its wall, then go. Every edge plays
 * a film — registered trunk passages when present, otherwise the shared
 * default in TravelPassage. The ink fade remains only when the passage host
 * is not mounted (SSR / tests).
 */
function executeTravel(
  router: { push: (href: string) => void },
  from: ScaleBandId,
  door: TravelDoor,
  s: number,
): EdgeUI {
  hapticCrossing();
  try {
    window.dispatchEvent(new CustomEvent("objetdart:scale-travel:start", { detail: { from, to: door.band.id } }));
  } catch {
    /* noop */
  }
  try {
    window.sessionStorage.setItem(STORAGE_KEY, String(s));
  } catch {
    /* noop */
  }
  if (playTravelPassage(from, door.band, s, () => router.push(door.route))) {
    return IDLE_UI;
  }
  window.setTimeout(() => router.push(door.route), 380);
  return { pressure: 1, towardLabel: door.label, crossing: true };
}

/**
 * The shared wall presentation: edge vignette + serif whisper + ink fade —
 * and, at a fork, the side of the frame the offered door lies on answering
 * under the fingers. The vignette's eye slides to that column and a warm
 * bloom gathers there as the pressure builds, so *which* door this press
 * takes is legible physically, before it commits, with no menu and no label
 * beyond the whisper the wall always had.
 */
export function ScaleTravelOverlay({ ui }: { ui: EdgeUI }) {
  if (ui.pressure <= 0 && !ui.crossing) return null;

  const fx = ui.towardX == null ? 50 : Math.max(0, Math.min(1, ui.towardX)) * 100;

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 60,
        background: ui.crossing
          ? "rgba(9, 11, 14, 0.96)"
          : `radial-gradient(ellipse at ${fx.toFixed(1)}% 50%, transparent 52%, rgba(9, 11, 14, ${
              0.55 * ui.pressure
            }) 100%)`,
        transition: ui.crossing ? "background 360ms ease-in" : "none",
      }}
    >
      {ui.towardX != null && !ui.crossing && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `radial-gradient(circle at ${fx.toFixed(1)}% 50%, rgba(255, 236, 200, ${(
              0.17 * ui.pressure
            ).toFixed(3)}) 0%, rgba(255, 236, 200, 0) 44%)`,
          }}
        />
      )}
      {ui.towardLabel && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: "12vh",
            textAlign: "center",
            fontFamily: "var(--font-serif, Cormorant Garamond, serif)",
            fontStyle: "italic",
            fontSize: 18,
            letterSpacing: "0.04em",
            color: `rgba(242, 238, 230, ${ui.crossing ? 0.9 : 0.35 + 0.55 * ui.pressure})`,
          }}
        >
          toward {ui.towardLabel}
        </div>
      )}
    </div>
  );
}

/**
 * The band adapter for rooms that own an internal zoom. The room keeps its
 * camera exactly as it is and reports every zoom gesture — clamped internal
 * zoom plus the attempted ln-ratio velocity per second (+ = zooming in).
 * Inside the range nothing happens; at a held extreme the residual pinch
 * becomes wall pressure through the one shared integrator, so the detent,
 * the vignette, the whisper, and the 320ms of intent feel identical to
 * every other room on the axis.
 */
export function useBandEdgeTravel(
  route: string,
  spec: RoomZoomSpec,
): {
  /** Call on every internal zoom event (pinch frame / wheel tick). */
  report: (zoom: number, zoomInVel: number) => void;
  /** The gesture ended cleanly — let any wall pressure decay. */
  release: () => void;
  /** The room answered the extreme itself (e.g. minted a wider chart). */
  reset: () => void;
  overlay: ReactNode;
} {
  const router = useRouter();
  const [ui, setUi] = useState<EdgeUI>(IDLE_UI);
  const refs = useRef({
    state: null as ScaleState | null,
    input: { zoomVel: 0, active: false } as ScaleInput,
    lastEventAt: 0,
    lastT: 0,
    raf: 0,
    leaving: false,
    uiPressure: 0,
    offer: freshOffer(),
    // Fingers still pressing: the room reports() while active and release()s
    // on lift, so the tick TTL (a wheel/trackpad safety) must not steal the
    // input mid-gesture. Without this a hand held at the room's zoom extreme
    // — where no more report() calls arrive because the room's own zoom has
    // stopped moving — bleeds wall intent instead of building it.
    pressing: false,
  });

  const loop = useCallback(
    function step(now: number) {
      const r = refs.current;
      const st = r.state;
      if (!st || r.leaving) {
        r.raf = 0;
        return;
      }
      const dt = now - r.lastT;
      r.lastT = now;
      // Skip the tick TTL while the hand is pressing — the room signals
      // release() explicitly on lift, so stationary fingers at the extreme
      // must keep pressing so intent can build past 320 ms.
      if (!r.pressing) {
        r.input = liveInput(r.input, now - r.lastEventAt);
      }
      const { state, events, edgePressure } = stepScale(st, r.input, dt);
      r.state = state;

      noteOfferPressing(r.offer, state.pressing, now);
      let toward: string | null = null;
      for (const e of events) {
        if (e.type === "detent") {
          hapticDetent();
          if (state.pressing !== 0) advanceOfferOnDetent(r.offer, state.pressing, now);
        }
        if (e.type === "edge") {
          // The adapter path carries no pinch centroid (the room owns the
          // gesture and reports only zoom), so its forks keep the cycle.
          const off = offeredDoor(route, bandAt(state.s).id, e.dir, r.offer, null);
          // No built door on offer: hold forever, promise nothing.
          toward = off ? off.door.label : null;
          if (!off && r.state) {
            // `r.state` is this frame's own fresh object from stepScale, held
            // nowhere else — mutate the field in place rather than spreading
            // a copy every frame the wall is held with no door on offer.
            r.state.intentMs = Math.min(r.state.intentMs, 200);
          }
        }
        if (e.type === "crossing") {
          const dir = e.dir;
          const off = offeredDoor(route, e.from, dir, r.offer, null);
          const dest = off?.door;
          if (dest && dest.route !== route) {
            recordEnteredFrom(dest.band.id, doorMemoryFor(route) ?? e.from);
            r.leaving = true;
            r.raf = 0;
            setUi(executeTravel(router, e.from, dest, entryScaleInto(dest.band, dir)));
            return;
          }
          // Destination unbuilt: the wall holds — step back inside the band.
          r.state = initialScaleState(dir === 1 ? e.s - 0.4 : e.s + 0.4);
        }
      }

      if (edgePressure !== r.uiPressure) {
        r.uiPressure = edgePressure;
        setUi({
          pressure: edgePressure,
          towardLabel:
            toward ?? (edgePressure > 0 ? nearestNeighborLabel(route, state.s) : null),
          crossing: false,
        });
      }

      const resting =
        !r.input.active && Math.abs(state.v) < 0.01 && state.intentMs === 0;
      if (!resting) r.raf = requestAnimationFrame(step);
      else r.raf = 0;
    },
    [route, router],
  );

  const wake = useCallback(() => {
    const r = refs.current;
    if (!r.raf && !r.leaving) {
      r.lastT = performance.now();
      r.raf = requestAnimationFrame(loop);
    }
  }, [loop]);

  const report = useCallback(
    (zoom: number, zoomInVel: number) => {
      const r = refs.current;
      if (r.leaving) return;
      const input = residualScaleInput(spec, zoom, zoomInVel);
      if (input.active) {
        if (!r.state) r.state = initialScaleState(scaleForRoomZoom(spec, zoom));
        r.input = input;
        r.lastEventAt = performance.now();
        r.pressing = true;
      } else {
        r.input = { zoomVel: 0, active: false };
        // Inside the range the room owns the camera: keep s in lockstep and
        // drop stale wall intent. At a pinned extreme the state stays, so a
        // released push decays exactly as it does in ScaleTravel rooms.
        if (roomZoomWall(spec, zoom) === 0 || !r.state) {
          r.state = initialScaleState(scaleForRoomZoom(spec, zoom));
        }
      }
      wake();
    },
    [spec, wake],
  );

  const release = useCallback(() => {
    const r = refs.current;
    r.pressing = false;
    r.input = { zoomVel: 0, active: false };
    wake();
  }, [wake]);

  const reset = useCallback(() => {
    const r = refs.current;
    r.input = { zoomVel: 0, active: false };
    r.state = null;
    r.pressing = false;
    if (r.uiPressure !== 0 && !r.leaving) {
      r.uiPressure = 0;
      setUi(IDLE_UI);
    }
  }, []);

  useEffect(() => {
    const r = refs.current;
    return () => {
      if (r.raf) cancelAnimationFrame(r.raf);
    };
  }, []);

  return { report, release, reset, overlay: <ScaleTravelOverlay ui={ui} /> };
}

export default function ScaleTravel({ route }: { route: string }) {
  const router = useRouter();
  const [ui, setUi] = useState<EdgeUI>(IDLE_UI);
  const stateRef = useRef<ScaleState | null>(null);
  const inputRef = useRef({ zoomVel: 0, active: false });
  const lastPinchAtRef = useRef(0);
  const rafRef = useRef(0);
  const leavingRef = useRef(false);
  const offerRef = useRef<WallOffer>(freshOffer());
  // Where the live pinch is on the frame, and which door that last chose —
  // a change in the door is a felt event, not just a redrawn vignette.
  const pointRef = useRef<FramePoint | null>(null);
  const offeredRouteRef = useRef<string | null>(null);
  // Fingers still on the glass, between pinch:start and pinch:end. The
  // gesture engine only emits pinch:move when the two-pointer decomposition
  // detects a scale change; once the hand has reached its physical range
  // and stopped moving, no more move events fire and liveInput's tick TTL
  // (a wheel/trackpad safety) marks the input inactive within 150 ms —
  // pinch-holding at a wall then bleeds intent instead of building it, and
  // the hand can never actually cross. Touch pinch has an explicit end,
  // so we ignore the TTL while the fingers are known to be down.
  const pinchDownRef = useRef(false);

  useEffect(() => {
    const entry = entryScaleFor(route);
    if (entry === null) return; // room has no scale address; nothing to mount

    const home = bandAt(entry);
    let s = entry;
    try {
      const stored = window.sessionStorage.getItem(STORAGE_KEY);
      if (stored !== null) {
        const v = Number(stored);
        if (Number.isFinite(v) && bandAt(v).id === home.id) s = v;
      }
    } catch {
      /* storage unavailable — enter at band center */
    }
    stateRef.current = initialScaleState(s);

    let lastT = performance.now();
    let uiPressure = -1;
    // The offered door's side of the frame persists while the wall fades, so
    // letting go dims the bloom instead of snapping it back to centre.
    let lastTowardX: number | null = null;

    const loop = (now: number) => {
      const st = stateRef.current;
      if (!st || leavingRef.current) return;
      const dt = now - lastT;
      lastT = now;
      // Skip the tick TTL while fingers are known to be down — the pinch:end
      // signal is the reliable release for touch, and stationary fingers at
      // a wall must keep pressing so intent can build past 320 ms. Wheel
      // pinch has no start/end, so pinchDownRef stays false and the TTL is
      // the only guard against a stray tick keeping the wall pressed.
      if (!pinchDownRef.current) {
        inputRef.current = liveInput(inputRef.current, now - lastPinchAtRef.current);
      }
      const { state, events, edgePressure } = stepScale(st, inputRef.current, dt);
      stateRef.current = state;

      noteOfferPressing(offerRef.current, state.pressing, now);
      let toward: string | null = null;
      let towardX: number | null = null;
      for (const e of events) {
        if (e.type === "detent") {
          hapticDetent();
          if (state.pressing !== 0) advanceOfferOnDetent(offerRef.current, state.pressing, now);
        }
        if (e.type === "edge") {
          const off = offeredDoor(
            route,
            bandAt(state.s).id,
            e.dir,
            offerRef.current,
            pointRef.current,
          );
          // No built door on offer: hold forever, promise nothing.
          toward = off ? off.door.label : null;
          towardX = off && off.count > 1 ? fanColumnCenter(off.idx, off.count) : null;
          lastTowardX = towardX;
          // The door answering under the fingers changed: let the hand feel
          // it, so sliding across the wall reads as choosing, not drifting.
          const offeredRoute = off ? off.door.route : null;
          if (offeredRoute !== offeredRouteRef.current) {
            if (offeredRouteRef.current !== null && offeredRoute !== null) hapticTap();
            offeredRouteRef.current = offeredRoute;
          }
          if (!off) {
            // Same rationale as the adapter loop above: `state` is this
            // frame's own fresh object, so clamp in place instead of
            // allocating a spread copy on every frame the wall holds.
            state.intentMs = Math.min(state.intentMs, 200);
          }
        }
        if (e.type === "crossing") {
          const dir = e.dir;
          const dest = offeredDoor(route, e.from, dir, offerRef.current, pointRef.current)?.door;
          if (dest && dest.route !== route) {
            recordEnteredFrom(dest.band.id, doorMemoryFor(route) ?? e.from);
            leavingRef.current = true;
            setUi(executeTravel(router, e.from, dest, entryScaleInto(dest.band, dir)));
            return;
          }
          // Destination unbuilt: the wall holds — step back inside the band.
          stateRef.current = initialScaleState(dir === 1 ? e.s - 0.4 : e.s + 0.4);
        }
      }

      if (edgePressure !== uiPressure) {
        uiPressure = edgePressure;
        // Which wall is closer decides the whispered destination while idle.
        if (toward === null && edgePressure > 0) {
          toward = nearestNeighborLabel(route, state.s);
          towardX = lastTowardX;
        }
        if (edgePressure === 0) lastTowardX = null;
        setUi({ pressure: edgePressure, towardLabel: toward, crossing: false, towardX });
      }

      const resting =
        !inputRef.current.active && Math.abs(state.v) < 0.01 && state.intentMs === 0;
      if (!resting) rafRef.current = requestAnimationFrame(loop);
      else rafRef.current = 0;
    };

    const wake = () => {
      if (!rafRef.current && !leavingRef.current) {
        lastT = performance.now();
        rafRef.current = requestAnimationFrame(loop);
      }
    };

    const detach = attachGestures(
      document.body,
      {
        pinch: (e) => {
          if (e.phase === "end") {
            pinchDownRef.current = false;
            inputRef.current = { zoomVel: 0, active: false };
            pointRef.current = null;
            offeredRouteRef.current = null;
          } else {
            // Touch pinch fires start/move; wheel pinch fires only move. On
            // touch this marks the hand as pressing so the loop can hold the
            // last velocity past the tick TTL; on wheel it stays false and
            // TTL still governs release.
            pinchDownRef.current = true;
            // Spreading fingers = zoom in = toward smaller scales (s falls).
            inputRef.current = { zoomVel: -e.velocity, active: true };
            lastPinchAtRef.current = performance.now();
            // Where the grip sits on the frame chooses the door at a fork.
            const w = window.innerWidth || 1;
            const h = window.innerHeight || 1;
            pointRef.current = { nx: e.cx / w, ny: e.cy / h };
          }
          wake();
        },
        tap: (e) => {
          // Two-finger tap = step back: a gentle nudge toward larger scales,
          // clamped inside the band — the wall is never touched, never crossed.
          if (e.fingers !== 2 || leavingRef.current) return;
          if (roomLensRaised()) return; // the room lowers its lens first
          const st = stateRef.current;
          if (!st) return;
          const v0 = stepBackVelocity(st.s);
          if (v0 > 1e-6) {
            stateRef.current = { ...st, v: Math.max(st.v, 0) + v0 };
            hapticTap();
            wake();
          }
        },
      },
      { noCapture: true, manageStyle: false, wheelZoom: false },
    );

    return () => {
      detach();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const st = stateRef.current;
      if (st) {
        try {
          window.sessionStorage.setItem(STORAGE_KEY, String(st.s));
        } catch {
          /* noop */
        }
      }
    };
  }, [route, router]);

  return <ScaleTravelOverlay ui={ui} />;
}
