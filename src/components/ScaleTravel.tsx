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

/** Direction of a metric-neighbor crossing/edge event relative to `from`. */
function dirToward(from: ScaleBandId, towardMetric: ScaleBandId): TravelDir {
  const fi = SCALE_BANDS.findIndex((b) => b.id === from);
  const ti = SCALE_BANDS.findIndex((b) => b.id === towardMetric);
  return ti > fi ? 1 : -1;
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

/** The door currently on offer toward `towardMetric` from `from`. */
function offeredDoor(
  route: string,
  from: ScaleBandId,
  towardMetric: ScaleBandId,
  offer: WallOffer,
): TravelDoor | null {
  const options = doorsFor(route, from, dirToward(from, towardMetric));
  if (options.length === 0) return null;
  return options[offer.idx % options.length];
}

export type EdgeUI = {
  pressure: number;
  towardLabel: string | null;
  crossing: boolean;
};

const IDLE_UI: EdgeUI = { pressure: 0, towardLabel: null, crossing: false };

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
  const doors = doorsFor(route, band.id, nearUpper ? 1 : -1);
  return doors[0]?.label ?? null;
}

/**
 * The shared travel execution: haptic roll, persist the landing position so
 * the destination room enters just inside its wall, then go. Edges with a
 * registered passage (TravelPassage.PASSAGES — the atlas ↔ stars trunk)
 * travel through the film: the passage owns the screen and navigation fires
 * mid-passage behind it. Every other edge keeps the ink fade exactly as-is.
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

/** The shared wall presentation: edge vignette + serif whisper + ink fade. */
export function ScaleTravelOverlay({ ui }: { ui: EdgeUI }) {
  if (ui.pressure <= 0 && !ui.crossing) return null;

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
          : `radial-gradient(ellipse at center, transparent 52%, rgba(9, 11, 14, ${
              0.55 * ui.pressure
            }) 100%)`,
        transition: ui.crossing ? "background 360ms ease-in" : "none",
      }}
    >
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
      r.input = liveInput(r.input, now - r.lastEventAt);
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
          const door = offeredDoor(route, bandAt(state.s).id, e.toward, r.offer);
          // No built door on offer: hold forever, promise nothing.
          toward = door ? door.label : null;
          if (!door && r.state) {
            r.state = { ...r.state, intentMs: Math.min(r.state.intentMs, 200) };
          }
        }
        if (e.type === "crossing") {
          const dir = dirToward(e.from, e.to);
          const dest = offeredDoor(route, e.from, e.to, r.offer);
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
    refs.current.input = { zoomVel: 0, active: false };
    wake();
  }, [wake]);

  const reset = useCallback(() => {
    const r = refs.current;
    r.input = { zoomVel: 0, active: false };
    r.state = null;
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

    const loop = (now: number) => {
      const st = stateRef.current;
      if (!st || leavingRef.current) return;
      const dt = now - lastT;
      lastT = now;
      inputRef.current = liveInput(inputRef.current, now - lastPinchAtRef.current);
      const { state, events, edgePressure } = stepScale(st, inputRef.current, dt);
      stateRef.current = state;

      noteOfferPressing(offerRef.current, state.pressing, now);
      let toward: string | null = null;
      for (const e of events) {
        if (e.type === "detent") {
          hapticDetent();
          if (state.pressing !== 0) advanceOfferOnDetent(offerRef.current, state.pressing, now);
        }
        if (e.type === "edge") {
          const door = offeredDoor(route, bandAt(state.s).id, e.toward, offerRef.current);
          // No built door on offer: hold forever, promise nothing.
          toward = door ? door.label : null;
          if (!door) {
            stateRef.current = { ...state, intentMs: Math.min(state.intentMs, 200) };
          }
        }
        if (e.type === "crossing") {
          const dir = dirToward(e.from, e.to);
          const dest = offeredDoor(route, e.from, e.to, offerRef.current);
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
        }
        setUi({ pressure: edgePressure, towardLabel: toward, crossing: false });
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
            inputRef.current = { zoomVel: 0, active: false };
          } else {
            // Spreading fingers = zoom in = toward smaller scales (s falls).
            inputRef.current = { zoomVel: -e.velocity, active: true };
            lastPinchAtRef.current = performance.now();
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
