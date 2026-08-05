"use client";

import { useEffect, useRef, useState } from "react";
import LetGo from "@/components/LetGo";
import { attachGestures } from "@/lib/gesture";
import { getFieldAudio } from "@/lib/audio";
import * as haptics from "@/lib/haptics";
import { onVessel } from "@/lib/vessel";
import {
  createFrameGovernor,
  createIdleWriter,
  detailForTier,
  onGalleryPause,
  onVisibility,
  resolveDpr,
} from "@/lib/room-runtime";
import {
  CITY_DAY_MS,
  HESITATION_SPEED_FACTOR,
  PLOT_DWELL_MS,
  REGULAR_VISITS_TO_BECOME_REGULAR,
  SEASON_ORDER,
  dayFraction,
  dwellersPerHome,
  headingFor,
  hesitationBetween,
  isDaytime,
  isRegularOf,
  mulberry,
  nearestEdgePoint,
  needFor,
  nextSeason,
  recordVisit,
  roleForDwell,
  stepTowards,
  targetForNeedWithRegular,
  treeFoliage,
  type CityLens,
  type Need,
  type PersonPhase,
  type PlotRole,
  type PlotSample,
  type Season,
  type VisitRecord,
} from "@/lib/city";
import {
  bellChord,
  chordForCeremony,
  dwellClimbNote,
  noteForFlickAngle,
  noteForPlot,
  noteForRole,
  noteForSeason,
  type CityRole,
} from "@/lib/city-audio";

/**
 * /city — a small settlement whose identity IS its causal roles.
 *
 * A city is not architecture; it is a cycle of care. Homes shelter, stores
 * feed, events gather, trees temper the weather, people walk between them
 * carrying a need. Every gesture in this room chooses one of those causal
 * roles: a plot's identity is what the hand held it long enough to become.
 *
 *   one finger tap    → ripple this ground; the city notices where you touched
 *   one finger dwell  → plant a plot. keep holding and it climbs the civic
 *                        ladder: home → store → event → tree (each rung is
 *                        a different answer to a different need)
 *   ceremony hold     → seals the plot at its current role (permanent,
 *                        the room's one solemn act) and lights it kept
 *   drag              → traces a road; roads speed the people who walk them
 *   two-finger twist  → the lens: map / hydrology / satisfaction
 *   three-finger tap  → tutti; every home rings its bell and the people
 *                        gather to the nearest event
 *   three-finger drag → wind; pushes weather across the settlement
 *   three-finger twist→ season; the year turns and the trees follow
 *   three-finger hold → time dilation; the day runs at 1/4
 *   tilt              → rain leans across the field
 *   knock             → the city's bell tolls once — people gather
 *   flip              → night, whatever the day said
 *
 * The laws are extracted to `src/lib/city.ts` and pinned by test-city.mjs;
 * this file is only rendering + gesture translation.
 *
 * The population is the density that manufactures the city's possibilities:
 * every dweller carries a heading (so a street of walkers reads as a street
 * of directed walkers), an arrival phase (a new resident enters from the
 * nearest edge and walks in, so the phased arc arrival → consolidation →
 * belonging is visible), a small per-need visit ledger (returning to the
 * same store or event N times makes that person a regular there, and the
 * plot's identity densifies from a role into a small community of the
 * people who keep coming back), and a hesitation state (when two plots
 * answer the same need at nearly-equal distance, the step slows and the
 * route may swap — the visible tradeoff density buys). All of that is
 * decided by pure functions in `src/lib/city.ts`; this file only writes
 * the rendering.
 */

const STORAGE_KEY = "objetdart:city:v1";
const MAX_PLOTS = 48;
const MAX_PEOPLE = 96;
const MAX_ROADS = 32;

type Plot = {
  id: number;
  seed: number;
  x: number;
  y: number;
  role: PlotRole;
  dwellStartMs: number;
  liveDwellMs: number; // grows while the finger is still down
  sealed: boolean;
  bornMs: number;
};

type Person = {
  id: number;
  seed: number;
  x: number;
  y: number;
  homeId: number;
  targetPlotId: number | null;
  need: Need;
  fed: number;
  rested: number;
  // heading (radians) is the person's facing — the direction the last non-trivial
  // step took them. Renderer draws each dweller as a small sliver along heading.
  heading: number;
  // "arriving" until the first arrival at home; then "settled" — the phased arc.
  phase: PersonPhase;
  // the plot they most recently arrived at for food. Same plot as last time
  // deepens the count; a different plot resets it. See `recordVisit` in city.ts.
  foodVisit: VisitRecord | null;
  gatherVisit: VisitRecord | null;
  // once foodVisit.visits crosses REGULAR_VISITS_TO_BECOME_REGULAR, the plot
  // becomes this person's regular store — same for events. These slots feed
  // `targetForNeedWithRegular`, and the plot's regular-count is derived by
  // scanning people at draw time.
  regularStoreId: number | null;
  regularEventId: number | null;
  // hesitation: true while the current need has two plots at nearly-equal
  // distance. Slows the step by HESITATION_SPEED_FACTOR and marks the person
  // visually. `hesitationSince` is when the state entered — used to gate a
  // route swap so a hesitating person does not thrash between targets every
  // frame; a real hesitation buys a second look, then commits.
  hesitating: boolean;
  hesitationSince: number;
};

type Road = { x1: number; y1: number; x2: number; y2: number; bornMs: number };

type Persisted = {
  version: 1;
  plots: Array<Omit<Plot, "dwellStartMs" | "liveDwellMs">>;
  season: Season;
  cityTimeMs: number;
};

const ROLE_COLORS: Record<PlotRole, string> = {
  empty: "rgba(232, 226, 213, 0.20)",
  home:  "rgba(232, 187, 129, 0.92)", // warm candle
  store: "rgba(200, 115, 42, 0.95)",  // deep candle
  event: "rgba(255, 232, 178, 0.98)", // event flare
  tree:  "rgba(74, 145, 106, 0.90)",  // canopy
};

const SEASON_TINT: Record<Season, [number, number, number]> = {
  spring: [214, 232, 210],
  summer: [232, 222, 190],
  fall:   [212, 168, 122],
  winter: [204, 210, 220],
};

export default function City() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fgCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // A separate DOM layer over the field, tied to the vessel's face-down flip.
  // The tick loop pokes its opacity directly — same pattern the coin uses,
  // so no React state churns on a device motion event.
  const nightVeilRef = useRef<HTMLDivElement | null>(null);
  // The hint fades once the visitor has planted anything — no on-the-nose
  // dismissal, just a small quieting.
  const hintRef = useRef<HTMLDivElement | null>(null);
  // The room "stands" (LetGo is shown) whenever anything has been kept —
  // any plot at all is enough. Sealed plots persist across visits, unsealed
  // ones are the ones that follow the dwell.
  // Deliberately not a dep of the mount effect: the effect owns the plot
  // arrays for the whole life of the room, and remounting on a standing-poll
  // flip would tear down the canvas contexts (fatal once this becomes WebGL).
  const [hasKept, setHasKept] = useState(false);
  // A stable callback for the <LetGo> click: dispatches the shared event the
  // frame loop already listens for. The event pattern lets the effect own
  // all mutation of the plot arrays.
  const letGo = () => {
    try { window.dispatchEvent(new Event("letgo")); } catch { /* noop */ }
    setHasKept(false);
  };

  useEffect(() => {
    const wrap = wrapRef.current;
    const bg = bgCanvasRef.current;
    const fg = fgCanvasRef.current;
    if (!wrap || !bg || !fg) return;

    const bgctxMaybe = bg.getContext("2d");
    const fgctxMaybe = fg.getContext("2d");
    if (!bgctxMaybe || !fgctxMaybe) return;
    // Aliased to non-nullable constants so TypeScript keeps the narrowing
    // through every nested closure below without hitting the reassignment
    // limitation that resets narrowing across function boundaries.
    const bgctx: CanvasRenderingContext2D = bgctxMaybe;
    const fgctx: CanvasRenderingContext2D = fgctxMaybe;

    // ── state ────────────────────────────────────────────────────────────
    const embedded = window.self !== window.top;
    const governor = createFrameGovernor(embedded ? "medium" : "high");
    let dpr = resolveDpr("high");
    let width = 0;
    let height = 0;

    const plots: Plot[] = [];
    const people: Person[] = [];
    const roads: Road[] = [];

    let nextPlotId = 1;
    let nextPersonId = 1;

    // active plant — while a finger is down on empty ground, this rises up
    // the role ladder. Released short → the plot keeps whichever role it hit.
    let activePlant: Plot | null = null;
    let activePlantStartedAt = 0;
    let plantRingWeight = 0;

    // roads being traced by the current drag
    let dragRoadStart: { x: number; y: number } | null = null;

    let cityTimeMs = 0;
    let cityTimeScale = 1;
    let lastFrameAt = performance.now();

    let season: Season = "spring";
    let lens: CityLens = "map";
    let weatherRain = 0;      // 0..1
    let weatherWind = 0;      // -1..1

    let reduceMotion = false;
    if (typeof window !== "undefined" && window.matchMedia) {
      reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }
    // Population walk slowdown under reduced motion — a settlement still
    // breathes, but the small figures move at a calmer pace so the field
    // does not ripple against the visitor's setting.
    const populationSpeed = reduceMotion ? 0.4 : 1;

    // The night veil: face-down = night, tracked as a boolean the flip
    // handler flips and the tick loop eases into a real opacity on the
    // separate `nightVeilRef` element (Coin's pattern). Kept out of React
    // state so a vessel event never re-renders.
    let nightOn = false;
    let nightAmt = 0;
    // Hint-hidden edge tracker so the tick loop only writes to the DOM
    // when the state flips, not every frame.
    let hintHidden = false;

    // ── restore ─────────────────────────────────────────────────────────
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Persisted;
        if (parsed?.version === 1) {
          for (const p of parsed.plots.slice(0, MAX_PLOTS)) {
            plots.push({ ...p, dwellStartMs: 0, liveDwellMs: 0 });
            nextPlotId = Math.max(nextPlotId, p.id + 1);
          }
          if (SEASON_ORDER.includes(parsed.season)) season = parsed.season;
          cityTimeMs = Number.isFinite(parsed.cityTimeMs) ? parsed.cityTimeMs : 0;
        }
      }
    } catch { /* corrupt persistence is silently discarded — it is not the visitor's problem */ }

    // spawn initial residents from any restored homes
    respawnPeopleFromHomes();

    // ── sizing ──────────────────────────────────────────────────────────
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      width = Math.max(240, Math.floor(rect.width));
      height = Math.max(240, Math.floor(rect.height));
      dpr = resolveDpr(governor.tier());
      for (const c of [bg, fg]) {
        c.width = Math.floor(width * dpr);
        c.height = Math.floor(height * dpr);
        c.style.width = `${width}px`;
        c.style.height = `${height}px`;
      }
      bgctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      fgctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    // ── audio + haptics wake ─────────────────────────────────────────────
    // The audio grammar (mode, per-role notes, ceremony chords, tutti chord,
    // weather noise target) is pure and lives in `@/lib/city-audio`; this
    // component only asks it what to play and hands the answer to the shared
    // FieldAudio graph. `ring()` plays a single MIDI, `ringChord()` stacks
    // voices with a small stagger so the ear reads them as one chord and
    // not as a chord-shaped scale — same trick a real bell tower uses.
    const A = () => getFieldAudio();
    const isPlayableRole = (r: PlotRole): r is CityRole => r !== "empty";
    const ring = (midi: number, durationMs = 240) => {
      try { A().playNote(midi, durationMs); } catch { /* noop */ }
    };
    const ringChord = (notes: readonly number[], durationMs = 320, staggerMs = 22) => {
      notes.forEach((midi, i) => {
        if (i === 0) {
          ring(midi, durationMs);
        } else {
          window.setTimeout(() => ring(midi, durationMs), i * staggerMs);
        }
      });
    };

    // ── persistence writer ───────────────────────────────────────────────
    const saveState = () => {
      try {
        const payload: Persisted = {
          version: 1,
          plots: plots.map((p) => ({
            id: p.id, seed: p.seed, x: p.x, y: p.y, role: p.role, sealed: p.sealed, bornMs: p.bornMs,
          })),
          season,
          cityTimeMs,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch { /* quota exhausted → the city is a session, not a record */ }
    };
    const idleWrite = createIdleWriter(saveState);

    // ── gestures ─────────────────────────────────────────────────────────
    const detach = attachGestures(wrap, {
      tap: (e) => {
        if (e.fingers === 1) {
          // ripple this ground; if the tap hit a plot, brighten it with the
          // plot's own identity note — the same pitch that plot rings when
          // it climbs the civic ladder, so the ear associates the pitch
          // with THAT plot's role rather than with a random MIDI offset.
          const p = plotAt(e.x, e.y);
          if (p && isPlayableRole(p.role)) {
            plantRingWeight = 0.9;
            ring(noteForPlot({ role: p.role, seed: p.seed }), 220);
            try { haptics.ripple(0.3 + e.intensity * 0.35); } catch { /* noop */ }
          } else {
            try { haptics.tap(); } catch { /* noop */ }
          }
        } else if (e.fingers === 3) {
          // tutti — every home rings, people gather to the nearest event.
          // The bell chord's voice count IS the event count: a settlement
          // with three events rings a fuller chord than one with one.
          const events = plots.filter((p) => p.role === "event");
          for (const person of people) {
            if (events.length > 0) {
              const target = events.reduce((best, ev) => {
                const d2 = (ev.x - person.x) ** 2 + (ev.y - person.y) ** 2;
                return d2 < best.d ? { d: d2, ev } : best;
              }, { d: Infinity, ev: events[0] });
              person.targetPlotId = target.ev.id;
              person.need = "gather";
            }
          }
          try { A().bell(); } catch { /* noop */ }
          ringChord(bellChord(events.length), 380, 28);
          try { haptics.roll(); } catch { /* noop */ }
        }
      },

      hold: (e) => {
        if (e.fingers === 3) {
          if (e.phase === "enter") {
            cityTimeScale = 0.25;
            try { haptics.tap(); } catch { /* noop */ }
          }
          if (e.phase === "release") cityTimeScale = 1;
          return;
        }
        if (e.fingers !== 1) return;

        if (e.phase === "enter") {
          // start a plant. If the tap landed on an existing plot, dwell
          // deepens THAT plot instead — no duplicate on the same ground.
          const existing = plotAt(e.x, e.y);
          if (existing && !existing.sealed) {
            activePlant = existing;
            activePlantStartedAt = performance.now();
            existing.dwellStartMs = activePlantStartedAt;
          } else if (!existing) {
            if (plots.length >= MAX_PLOTS) return;
            const seed = ((e.x * 1000) | 0) ^ ((e.y * 1000) | 0) ^ nextPlotId;
            const plot: Plot = {
              id: nextPlotId++,
              seed,
              x: e.x / width,
              y: e.y / height,
              role: "home",
              dwellStartMs: performance.now(),
              liveDwellMs: 0,
              sealed: false,
              bornMs: cityTimeMs,
            };
            plots.push(plot);
            activePlant = plot;
            activePlantStartedAt = plot.dwellStartMs;
            // a home spawns its residents immediately
            spawnDwellersFor(plot);
            // a plant is a new home — ring its identity note
            ring(noteForPlot({ role: "home", seed: plot.seed }), 240);
            try { haptics.tap(); } catch { /* noop */ }
          }
        }

        if (e.phase === "tick" && activePlant) {
          activePlant.liveDwellMs = performance.now() - activePlantStartedAt;
          // At the dwell tier the plot is still climbing the civic ladder —
          // home → store → event → tree. That climb is the verb "dwell" in
          // this material: a longer press is a deeper answer to a real need.
          // Each rung rings its ladder-climb note (one octave above the role
          // note) so the ear reads climb-then-settle instead of a fresh
          // pitch each time.
          if (e.tier >= 2 && !activePlant.sealed) {
            const newRole = roleForDwell(activePlant.liveDwellMs);
            if (newRole !== activePlant.role && isPlayableRole(newRole)) {
              activePlant.role = newRole;
              ring(dwellClimbNote(newRole), 260);
              try { haptics.detent(); } catch { /* noop */ }
              plantRingWeight = 1;
            }
          }
          // ceremony seals the plot at its current role — the one solemn
          // act. The seal tolls a diatonic triad rooted at that role: a
          // sealed home tolls D major, a sealed store G major, a sealed
          // event A minor, a sealed tree C major. Every seal is the same
          // chord *shape* at a different *pitch*.
          if (e.tier >= 3 && !activePlant.sealed) {
            activePlant.sealed = true;
            try { A().bell(); } catch { /* noop */ }
            if (isPlayableRole(activePlant.role)) {
              ringChord(chordForCeremony(activePlant.role), 520, 34);
            }
            try { haptics.bloom(); } catch { /* noop */ }
            plantRingWeight = 1;
            idleWrite.schedule();
          }
        }

        if (e.phase === "release") {
          activePlant = null;
          idleWrite.schedule();
        }
      },

      drag: (e) => {
        if (e.fingers === 3) {
          // three-finger drag — wind rolls the weather across the city
          if (e.phase === "end") return;
          weatherWind = Math.max(-1, Math.min(1, weatherWind + e.dx * 0.006));
          weatherRain = Math.max(0, Math.min(1, weatherRain + Math.abs(e.dy) * 0.002));
          return;
        }
        if (e.fingers !== 1) return;
        if (e.phase === "start") {
          dragRoadStart = { x: e.x / width, y: e.y / height };
          return;
        }
        if (e.phase === "end") {
          if (dragRoadStart) {
            if (roads.length >= MAX_ROADS) roads.shift();
            roads.push({
              x1: dragRoadStart.x, y1: dragRoadStart.y,
              x2: e.x / width, y2: e.y / height,
              bornMs: cityTimeMs,
            });
            try { haptics.chop(); } catch { /* noop */ }
          }
          dragRoadStart = null;
        }
      },

      twist: (e) => {
        if (e.fingers === 3) {
          if (e.phase !== "move") return;
          // season detent — one 90° crossing steps the year
          const detent = Math.PI / 2;
          if (Math.abs(e.angle) < detent * 0.9) return;
          season = nextSeason(season, e.angle > 0 ? 1 : -1);
          // each season lands on a different scale degree of the mode —
          // the year rounds through bud → fruit → harvest → hearth
          ring(noteForSeason(season), 320);
          try { haptics.detent(); } catch { /* noop */ }
          idleWrite.schedule();
          return;
        }
        if (e.fingers === 3) return;
        if (e.phase !== "move") return;
        // two-finger twist — rotate the lens through map / hydrology / satisfaction
        if (Math.abs(e.angle) < Math.PI / 3) return;
        const lenses: CityLens[] = ["map", "hydrology", "satisfaction"];
        const cur = lenses.indexOf(lens);
        lens = lenses[(cur + (e.angle > 0 ? 1 : -1) + lenses.length) % lenses.length];
        try { haptics.lens(); } catch { /* noop */ }
      },

      flick: (e) => {
        if (e.fingers !== 1) return;
        // a flick from the ground → ring a chime at that point; people
        // nearby drift toward it (a brief attractor). The chime rings one
        // octave above the tonic, angle-picked but always in-mode, so a
        // flick never introduces a note that fights the settlement.
        ring(noteForFlickAngle(e.angle), 260);
        try { haptics.chop(); } catch { /* noop */ }
        const px = e.x / width;
        const py = e.y / height;
        for (const person of people) {
          const d2 = (person.x - px) ** 2 + (person.y - py) ** 2;
          if (d2 < 0.09) person.need = "gather";
        }
      },

      scrub: () => {
        try { haptics.tap(); } catch { /* noop */ }
      },
    }, { wheelZoom: false });

    // ── vessel: tilt / shake / knock / flip through the shared onVessel bus ─
    // The city's world-law channel. Each verb is chosen so its meaning IS its
    // causal effect on the settlement — tilt rains on it, a knock rings the
    // bell and gathers the people, face-down is night regardless of the sun.
    const detachVessel = onVessel({
      tilt: (e) => {
        // gravity leans across the settlement: rain follows the lean
        const lean = Math.min(1, Math.hypot(e.beta, e.gamma) / 45);
        weatherRain = Math.max(weatherRain, lean * 0.9);
      },
      shake: (e) => {
        // agitation scatters the pending drag — a shaken city drops its road
        dragRoadStart = null;
        weatherWind = Math.max(-1, Math.min(1, weatherWind + (e.intensity - 0.5) * 0.4));
      },
      knock: () => {
        // one bell across the town — the tutti chord, same as three-finger
        // tap. The knock and the tutti tap answer the same civic call.
        const events = plots.filter((p) => p.role === "event");
        try { A().bell(); } catch { /* noop */ }
        ringChord(bellChord(events.length), 380, 28);
        try { haptics.detent(); } catch { /* noop */ }
        if (events.length === 0) return;
        for (const person of people) {
          person.targetPlotId = events[0].id;
          person.need = "gather";
        }
      },
      flip: (e) => {
        // face-down is night, no matter what the day said — jump city time
        // to mid-night; face-up returns to whatever day the clock had
        // reached. The veil (nightVeilRef) darkens the whole field alongside,
        // so the settlement's dusk lands in two channels at once — the
        // simulated day-clock and the room-wide overlay.
        nightOn = e.faceDown;
        if (e.faceDown) {
          cityTimeMs = Math.floor(cityTimeMs / CITY_DAY_MS) * CITY_DAY_MS + CITY_DAY_MS * 0.75;
          // night is the settlement's tonic sunk two octaves — the hearth
          // note transposed into the low register. The room's day-clock
          // jumps, the veil closes, and the tonic falls to bass at once.
          ring(noteForRole("home") - 24, 320);
          try { haptics.detent(); } catch { /* noop */ }
        }
      },
    });

    // ── pause and visibility ────────────────────────────────────────────
    let docHidden = document.hidden;
    let galleryPaused = embedded;
    const applyPause = () => {
      if (docHidden || galleryPaused) governor.force("sleep");
    };
    applyPause();
    const offVisibility = onVisibility((hidden) => { docHidden = hidden; applyPause(); });
    const offGallery = onGalleryPause((paused) => { galleryPaused = paused; applyPause(); });

    // ── frame loop ──────────────────────────────────────────────────────
    // Same pattern the rest of the album's hand-authored rooms use: rAF into
    // a tick, governor.beginFrame(now) returns the tier we should draw at,
    // and hardPaused / sleeping short-circuit to a quiet 4Hz wake so the
    // room does not spin its wheels while another tab or gallery holds it.
    let stopped = false;
    let raf = 0;
    let slowWake: ReturnType<typeof setTimeout> | null = null;
    const tick = (now: number) => {
      if (stopped) return;
      if (docHidden || galleryPaused) {
        slowWake = setTimeout(() => { raf = requestAnimationFrame(tick); }, 250);
        return;
      }
      const tier = governor.beginFrame(now);
      void tier; // detail is read per-frame from detailForTier below
      const dt = Math.min(66, now - lastFrameAt);
      lastFrameAt = now;
      cityTimeMs += dt * cityTimeScale;
      stepPopulation(dt * populationSpeed);
      decayWeather(dt);
      plantRingWeight = Math.max(0, plantRingWeight - dt * 0.002);
      // ease the night veil toward its target (face-down = night). Under
      // reduced motion we still let it move — a fade to black is a color
      // change, not a shake — just a touch faster so it lands quietly.
      const nightEase = reduceMotion ? 0.10 : Math.min(1, dt * 0.0025);
      nightAmt += ((nightOn ? 1 : 0) - nightAmt) * nightEase;
      if (nightVeilRef.current) {
        nightVeilRef.current.style.opacity = String(nightAmt * 0.82);
      }
      // hint fades to nothing once the visitor has planted a single plot —
      // the settlement takes it from here. Written only on the transition
      // so this loop stays quiet DOM-wise.
      const wantHintHidden = plots.length > 0;
      if (hintRef.current && wantHintHidden !== hintHidden) {
        hintHidden = wantHintHidden;
        hintRef.current.style.opacity = wantHintHidden ? "0" : "";
      }
      drawBackground();
      drawForeground();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // ── helpers ─────────────────────────────────────────────────────────

    function plotAt(px: number, py: number): Plot | null {
      const nx = px / width;
      const ny = py / height;
      const r = 22 / Math.min(width, height); // touch radius in normalized units
      let best: Plot | null = null;
      let bestD = r * r;
      for (const plot of plots) {
        const d = (plot.x - nx) ** 2 + (plot.y - ny) ** 2;
        if (d < bestD) { bestD = d; best = plot; }
      }
      return best;
    }

    function spawnDwellersFor(home: Plot): void {
      const count = dwellersPerHome(home.seed);
      const rng = mulberry(home.seed ^ 0x1eaf);
      // Arrivals begin at the nearest map edge and walk home — the phased-arc
      // "arrival" is what the visitor sees before the first "settled" step.
      // Small deterministic jitter along the edge so two siblings do not stand
      // in the same pixel; still 100% seed-derived, no `Math.random`.
      const edge = nearestEdgePoint({ x: home.x, y: home.y });
      const onVerticalEdge = edge.x === 0 || edge.x === 1;
      for (let i = 0; i < count && people.length < MAX_PEOPLE; i += 1) {
        const jitter = (rng() - 0.5) * 0.06;
        const sx = onVerticalEdge ? edge.x : clamp(edge.x + jitter, 0, 1);
        const sy = onVerticalEdge ? clamp(edge.y + jitter, 0, 1) : edge.y;
        const initialHeading = Math.atan2(home.y - sy, home.x - sx);
        people.push({
          id: nextPersonId++,
          seed: home.seed ^ (i + 1),
          x: sx,
          y: sy,
          homeId: home.id,
          targetPlotId: home.id,
          need: "rest",
          fed: 0.7,
          rested: 0.6,
          heading: initialHeading,
          phase: "arriving",
          foodVisit: null,
          gatherVisit: null,
          regularStoreId: null,
          regularEventId: null,
          hesitating: false,
          hesitationSince: 0,
        });
      }
    }

    function respawnPeopleFromHomes(): void {
      people.length = 0;
      for (const p of plots) {
        if (p.role === "home" || p.role === "store" || p.role === "event") {
          // homes reliably spawn; the others are inhabited by history
        }
        if (p.role === "home") spawnDwellersFor(p);
      }
    }

    function stepPopulation(dt: number): void {
      // arrivals are gated on distance-to-home: the traveller is "arriving"
      // until their first close pass with the front door, then flips to
      // "settled" and the ordinary need cycle takes over. Route swaps only
      // land on a settled person — an arriving dweller has one target and
      // one job (get home). Every visible slowdown is a hesitation, and
      // every hesitation is a genuine same-need tradeoff, not a stutter.
      const HESITATION_SWAP_MS = 550; // "a real hesitation buys a second look, then commits"
      const ARRIVAL_MS = 260; // once close to home for ~1/4s, they belong
      for (const person of people) {
        const prevX = person.x;
        const prevY = person.y;

        // decay
        person.fed = Math.max(0, person.fed - dt * 0.00003);
        person.rested = Math.max(0, person.rested - dt * 0.00002);

        // ── target selection ────────────────────────────────────────────
        let chosenNeed: Need;
        let regularForNeed: number | null = null;
        if (person.phase === "arriving") {
          // an arriving dweller has one job: reach home. Their need is rest
          // and their target is fixed to their own home id — no wandering.
          chosenNeed = "rest";
          if (person.need !== chosenNeed || person.targetPlotId !== person.homeId) {
            person.need = chosenNeed;
            person.targetPlotId = person.homeId;
          }
        } else {
          chosenNeed = needFor(cityTimeMs, person.fed, person.rested);
          regularForNeed =
            chosenNeed === "food" ? person.regularStoreId :
            chosenNeed === "gather" ? person.regularEventId : null;
          if (person.need !== chosenNeed || person.targetPlotId == null) {
            const target = targetForNeedWithRegular(
              { x: person.x, y: person.y, homeId: person.homeId },
              chosenNeed,
              plots as PlotSample[],
              regularForNeed,
            );
            person.targetPlotId = target?.id ?? null;
            person.need = chosenNeed;
            person.hesitating = false;
            person.hesitationSince = 0;
          }
        }

        // ── hesitation: two same-need plots, close in distance ─────────
        // Only settled people can hesitate — an arriving traveller has no
        // choice to make. Rest never hesitates: home is unique.
        if (person.phase === "settled" && (chosenNeed === "food" || chosenNeed === "gather")) {
          const h = hesitationBetween(
            { x: person.x, y: person.y },
            chosenNeed,
            plots as PlotSample[],
          );
          if (h.hesitating) {
            if (!person.hesitating) {
              person.hesitating = true;
              person.hesitationSince = cityTimeMs;
            }
            // A hesitation past HESITATION_SWAP_MS commits to the alternate
            // once — the person swaps and the state clears. That is the
            // visible route-swap; without it a hesitation would just be a
            // permanent slowdown, not a tradeoff.
            if (h.secondBestId != null &&
                h.secondBestId !== person.targetPlotId &&
                cityTimeMs - person.hesitationSince > HESITATION_SWAP_MS) {
              person.targetPlotId = h.secondBestId;
              person.hesitating = false;
              person.hesitationSince = 0;
            }
          } else if (person.hesitating) {
            person.hesitating = false;
            person.hesitationSince = 0;
          }
        }

        // ── step ────────────────────────────────────────────────────────
        if (person.targetPlotId != null) {
          const target = plots.find((p) => p.id === person.targetPlotId);
          if (target) {
            const roadBoost = personOnRoad(person) ? 2.2 : 1;
            const hesitationBrake = person.hesitating ? HESITATION_SPEED_FACTOR : 1;
            const stepped = stepTowards(
              { x: person.x, y: person.y },
              { x: target.x, y: target.y },
              dt * roadBoost * hesitationBrake,
            );
            person.x = stepped.x;
            person.y = stepped.y;
            const arrived =
              Math.abs(person.x - target.x) < 0.008 &&
              Math.abs(person.y - target.y) < 0.008;
            if (arrived) {
              if (target.role === "store") person.fed = Math.min(1, person.fed + dt * 0.0015);
              if (target.role === "event") person.rested = Math.min(1, person.rested + dt * 0.0004);
              if (target.role === "home") person.rested = Math.min(1, person.rested + dt * 0.0012);
              // the phased arc: an arriving dweller who touches home is now settled.
              if (person.phase === "arriving" && target.id === person.homeId) {
                // require a short close-in dwell so a flyover does not settle them
                if (!person.hesitationSince) person.hesitationSince = cityTimeMs;
                else if (cityTimeMs - person.hesitationSince > ARRIVAL_MS) {
                  person.phase = "settled";
                  person.hesitating = false;
                  person.hesitationSince = 0;
                }
              }
              // regulars: on arrival at a store/event, deepen (or reset) the
              // per-need ledger and lift the person to "regular" once they
              // cross the threshold. Same plot as last time → visits += 1.
              if (person.phase === "settled" && target.role === "store") {
                person.foodVisit = recordVisit(person.foodVisit, target.id);
                if (isRegularOf(person.foodVisit, target.id)) person.regularStoreId = target.id;
              }
              if (person.phase === "settled" && target.role === "event") {
                person.gatherVisit = recordVisit(person.gatherVisit, target.id);
                if (isRegularOf(person.gatherVisit, target.id)) person.regularEventId = target.id;
              }
            }
          }
        }

        // ── heading: face where the last step took us ───────────────────
        person.heading = headingFor(
          { x: prevX, y: prevY },
          { x: person.x, y: person.y },
          person.heading,
        );
      }
    }

    function personOnRoad(person: Person): boolean {
      // rough — if the person is within a fixed normalized distance of any
      // road segment, they are on it. Enough to feel the speedup.
      for (const road of roads) {
        const t = clamp(((person.x - road.x1) * (road.x2 - road.x1) + (person.y - road.y1) * (road.y2 - road.y1))
          / Math.max(1e-6, (road.x2 - road.x1) ** 2 + (road.y2 - road.y1) ** 2), 0, 1);
        const px = road.x1 + t * (road.x2 - road.x1);
        const py = road.y1 + t * (road.y2 - road.y1);
        if ((person.x - px) ** 2 + (person.y - py) ** 2 < 0.0004) return true;
      }
      return false;
    }

    function decayWeather(dt: number): void {
      weatherRain = Math.max(0, weatherRain - dt * 0.00008);
      weatherWind *= Math.exp(-dt * 0.00015);
    }

    // ── drawing ─────────────────────────────────────────────────────────

    function drawBackground(): void {
      const detail = detailForTier(governor.tier());
      bgctx.clearRect(0, 0, width, height);

      // day-night gradient (linear, not radial — paint-test safe)
      const f = dayFraction(cityTimeMs);
      const day = isDaytime(cityTimeMs);
      const [sr, sg, sb] = SEASON_TINT[season];
      const light = day ? 1 : 0.28 + 0.16 * Math.cos(f * Math.PI * 2);
      const skyR = Math.floor(sr * light);
      const skyG = Math.floor(sg * light);
      const skyB = Math.floor(sb * light);
      const groundR = Math.floor(sr * light * 0.72);
      const groundG = Math.floor(sg * light * 0.72);
      const groundB = Math.floor(sb * light * 0.68);

      const grad = bgctx.createLinearGradient(0, 0, 0, height);
      grad.addColorStop(0, `rgb(${skyR}, ${skyG}, ${skyB})`);
      grad.addColorStop(1, `rgb(${groundR}, ${groundG}, ${groundB})`);
      bgctx.fillStyle = grad;
      bgctx.fillRect(0, 0, width, height);

      // subtle grid — a plain map, in the "map" lens
      if (lens === "map" && detail.samples >= 1) {
        bgctx.strokeStyle = `rgba(21, 23, 26, ${day ? 0.06 : 0.10})`;
        bgctx.lineWidth = 1;
        const step = 48;
        bgctx.beginPath();
        for (let x = 0; x < width; x += step) {
          bgctx.moveTo(x, 0);
          bgctx.lineTo(x, height);
        }
        for (let y = 0; y < height; y += step) {
          bgctx.moveTo(0, y);
          bgctx.lineTo(width, y);
        }
        bgctx.stroke();
      }

      // hydrology overlay — soft blue meander lines
      if (lens === "hydrology") {
        bgctx.strokeStyle = "rgba(44, 74, 92, 0.32)";
        bgctx.lineWidth = 2.5;
        bgctx.beginPath();
        for (let x = 0; x < width; x += 3) {
          const y = height * 0.55 + Math.sin(x * 0.02 + cityTimeMs * 0.0005) * 26;
          if (x === 0) bgctx.moveTo(x, y); else bgctx.lineTo(x, y);
        }
        bgctx.stroke();
      }
    }

    function drawForeground(): void {
      fgctx.clearRect(0, 0, width, height);

      // roads
      fgctx.strokeStyle = "rgba(21, 23, 26, 0.35)";
      fgctx.lineWidth = 3;
      fgctx.lineCap = "round";
      for (const road of roads) {
        fgctx.beginPath();
        fgctx.moveTo(road.x1 * width, road.y1 * height);
        fgctx.lineTo(road.x2 * width, road.y2 * height);
        fgctx.stroke();
      }

      // (a live drag-preview stroke was dropped: we do not carry the
      // pointer's live position outside the drag handler, so the branch
      // could only ever draw a beginPath()/stroke() with no lineTo — a
      // no-op that still ran on every frame. The road lands legibly on
      // release; the road-in-progress is felt in the haptic ripple, not
      // pre-drawn.)

      // plots
      for (const plot of plots) {
        const px = plot.x * width;
        const py = plot.y * height;
        const isTree = plot.role === "tree";
        const treeScale = isTree ? treeFoliage(season) : 1;
        const baseSize = plot.sealed ? 12 : 9;
        const size = baseSize * (0.6 + 0.4 * treeScale);
        fgctx.fillStyle = ROLE_COLORS[plot.role];
        if (plot.role === "tree") {
          // trees are round canopies
          fgctx.beginPath();
          fgctx.arc(px, py, size, 0, Math.PI * 2);
          fgctx.fill();
        } else if (plot.role === "event") {
          // events flare — a soft diamond
          fgctx.beginPath();
          fgctx.moveTo(px, py - size);
          fgctx.lineTo(px + size, py);
          fgctx.lineTo(px, py + size);
          fgctx.lineTo(px - size, py);
          fgctx.closePath();
          fgctx.fill();
        } else {
          // homes and stores are little rects
          fgctx.fillRect(px - size, py - size, size * 2, size * 2);
        }
        if (plot.sealed) {
          fgctx.strokeStyle = "rgba(232, 226, 213, 0.75)";
          fgctx.lineWidth = 1.5;
          fgctx.strokeRect(px - size - 2, py - size - 2, size * 2 + 4, size * 2 + 4);
        }
      }

      // active plant dwell ring
      if (activePlant && !activePlant.sealed) {
        const dwell = activePlant.liveDwellMs;
        const nextThreshold = nextRoleThreshold(activePlant.role);
        const prev = prevRoleThreshold(activePlant.role);
        const frac = nextThreshold ? Math.min(1, (dwell - prev) / (nextThreshold - prev)) : 1;
        const px = activePlant.x * width;
        const py = activePlant.y * height;
        fgctx.strokeStyle = `rgba(255, 232, 178, ${0.55 + plantRingWeight * 0.35})`;
        fgctx.lineWidth = 2;
        fgctx.beginPath();
        fgctx.arc(px, py, 22 + frac * 12, 0, Math.PI * 2);
        fgctx.stroke();
      }

      // micro-communities: a plot with two or more regulars carries a small,
      // warm ring, its diameter widening with the count. The ring is the
      // visible record of the plot's identity densifying from a role into a
      // community — "a store is where THESE people eat", drawn.
      const regularCountByPlot = new Map<number, number>();
      for (const person of people) {
        if (person.regularStoreId != null) {
          regularCountByPlot.set(
            person.regularStoreId,
            (regularCountByPlot.get(person.regularStoreId) ?? 0) + 1,
          );
        }
        if (person.regularEventId != null) {
          regularCountByPlot.set(
            person.regularEventId,
            (regularCountByPlot.get(person.regularEventId) ?? 0) + 1,
          );
        }
      }
      for (const plot of plots) {
        const count = regularCountByPlot.get(plot.id) ?? 0;
        if (count < 2) continue; // one regular is a habit, two is a community
        const px = plot.x * width;
        const py = plot.y * height;
        const radius = 16 + count * 3;
        fgctx.strokeStyle = `rgba(232, 187, 129, ${Math.min(0.55, 0.18 + count * 0.08)})`;
        fgctx.lineWidth = 1.5;
        fgctx.beginPath();
        fgctx.arc(px, py, radius, 0, Math.PI * 2);
        fgctx.stroke();
      }

      // people. Each dweller is a small heading-aligned sliver — a line
      // segment along their facing angle. Arrivals carry a faint tail from
      // where they came in; regulars carry a slightly warmer head so the
      // eye can pick a community out of a crowd; hesitating people are
      // marked with a paler body so a tradeoff is legible.
      for (const person of people) {
        const px = person.x * width;
        const py = person.y * height;
        const cos = Math.cos(person.heading);
        const sin = Math.sin(person.heading);
        // body is a short line along heading (~5px), longer if arriving so a
        // walker coming in from the edge reads as a mover, not a dot
        const length = person.phase === "arriving" ? 6 : 5;
        const bx = px + cos * (length * 0.5);
        const by = py + sin * (length * 0.5);
        const tx = px - cos * (length * 0.5);
        const ty = py - sin * (length * 0.5);
        // arrival tail — from the person back toward their home, a faint hint
        // of the phased arc (only during arriving, and only when far enough
        // from home that the tail has room to draw)
        if (person.phase === "arriving") {
          const home = plots.find((p) => p.id === person.homeId);
          if (home) {
            const hx = home.x * width;
            const hy = home.y * height;
            const dx = px - hx;
            const dy = py - hy;
            const dLen = Math.hypot(dx, dy);
            if (dLen > 16) {
              const backLen = Math.min(14, dLen * 0.25);
              fgctx.strokeStyle = "rgba(232, 226, 213, 0.18)";
              fgctx.lineWidth = 1;
              fgctx.beginPath();
              fgctx.moveTo(px, py);
              fgctx.lineTo(px + (dx / dLen) * backLen, py + (dy / dLen) * backLen);
              fgctx.stroke();
            }
          }
        }
        // body
        const bodyAlpha = person.hesitating ? 0.55 : 0.85;
        const bodyColor = person.regularStoreId != null || person.regularEventId != null
          ? `rgba(200, 115, 42, ${bodyAlpha + 0.05})` // regulars carry a warm cast
          : `rgba(21, 23, 26, ${bodyAlpha})`;
        fgctx.strokeStyle = bodyColor;
        fgctx.lineWidth = 2;
        fgctx.lineCap = "round";
        fgctx.beginPath();
        fgctx.moveTo(tx, ty);
        fgctx.lineTo(bx, by);
        fgctx.stroke();
        // small head dot to keep dwellers legible at 390px width
        fgctx.fillStyle = bodyColor;
        fgctx.beginPath();
        fgctx.arc(bx, by, 1.4, 0, Math.PI * 2);
        fgctx.fill();
      }

      // satisfaction lens — draw halos around plots by how many people are near
      if (lens === "satisfaction") {
        for (const plot of plots) {
          if (plot.role !== "home" && plot.role !== "store" && plot.role !== "event") continue;
          let visitors = 0;
          for (const person of people) {
            if ((person.x - plot.x) ** 2 + (person.y - plot.y) ** 2 < 0.005) visitors += 1;
          }
          if (visitors === 0) continue;
          fgctx.strokeStyle = `rgba(74, 145, 106, ${Math.min(0.55, visitors * 0.18)})`;
          fgctx.lineWidth = 4;
          fgctx.beginPath();
          fgctx.arc(plot.x * width, plot.y * height, 14 + visitors * 2, 0, Math.PI * 2);
          fgctx.stroke();
        }
      }

      // rain streaks (weatherRain) — plain lines, safe for paint test.
      // Under reduced motion the layer is frozen: the streaks are drawn
      // from a stationary seed so the sky is still "under weather" without
      // any animated fall — the settlement is still legibly damp.
      if (weatherRain > 0.01) {
        fgctx.strokeStyle = `rgba(44, 74, 92, ${0.15 + weatherRain * 0.35})`;
        fgctx.lineWidth = 1;
        const count = Math.floor(weatherRain * 60);
        const seedT = reduceMotion ? 1 : Math.floor(cityTimeMs / 40);
        const rng = mulberry(seedT);
        for (let i = 0; i < count; i += 1) {
          const x = rng() * width;
          const y = reduceMotion
            ? rng() * height
            : ((rng() * height) + (cityTimeMs * 0.4)) % height;
          const wind = weatherWind * 22;
          fgctx.beginPath();
          fgctx.moveTo(x, y);
          fgctx.lineTo(x + wind, y + 12);
          fgctx.stroke();
        }
      }
    }

    function nextRoleThreshold(role: PlotRole): number | null {
      if (role === "home") return PLOT_DWELL_MS.store;
      if (role === "store") return PLOT_DWELL_MS.event;
      if (role === "event") return PLOT_DWELL_MS.tree;
      return null;
    }
    function prevRoleThreshold(role: PlotRole): number {
      if (role === "home") return 0;
      if (role === "store") return PLOT_DWELL_MS.home;
      if (role === "event") return PLOT_DWELL_MS.store;
      if (role === "tree") return PLOT_DWELL_MS.event;
      return 0;
    }
    function clamp(v: number, lo: number, hi: number): number {
      return v < lo ? lo : v > hi ? hi : v;
    }

    // <LetGo> support — the shared clear button dispatches a "letgo" event.
    const onLetGo = () => {
      plots.length = 0;
      people.length = 0;
      roads.length = 0;
      activePlant = null;
      idleWrite.schedule();
    };
    window.addEventListener("letgo", onLetGo);

    // Poll the room's "standing" state so the <LetGo> button appears only
    // while something is kept. Cheap — 8Hz is enough to catch a first plot.
    // We track the last-broadcast standing state in a local so this effect
    // stays `[]`-mounted; reading `hasKept` from the enclosing closure would
    // either force this effect back onto the plot arrays (a full remount,
    // which is what Item 1's WebGL context must never do) or go stale here.
    let standingBroadcast = plots.length > 0;
    setHasKept(standingBroadcast);
    const standingInterval = window.setInterval(() => {
      const standing = plots.length > 0;
      if (standing !== standingBroadcast) {
        standingBroadcast = standing;
        setHasKept(standing);
      }
    }, 125);

    return () => {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      if (slowWake) clearTimeout(slowWake);
      detach();
      observer.disconnect();
      offVisibility();
      offGallery();
      detachVessel();
      window.removeEventListener("letgo", onLetGo);
      window.clearInterval(standingInterval);
      idleWrite.flush();
      idleWrite.cancel();
      saveState();
    };
    // Mount once. All room mutation flows through refs and the event/letgo
    // channels above; the standing-poll broadcasts into React state
    // without re-entering this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={wrapRef}
      style={{
        position: "fixed",
        inset: 0,
        touchAction: "none",
        overflow: "hidden",
        background: "#0e0f13",
      }}
    >
      <canvas ref={bgCanvasRef} style={{ position: "absolute", inset: 0 }} />
      <canvas ref={fgCanvasRef} style={{ position: "absolute", inset: 0 }} />
      {/* Night veil — face-down flips this from transparent to a deep dusk
          across the whole field. Positioned above the canvases but below
          the HUD/LetGo so the small copy stays readable at night. */}
      <div
        ref={nightVeilRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 3,
          background: "#04060b",
          opacity: 0,
          pointerEvents: "none",
          transition: "opacity 220ms ease",
        }}
      />
      <div className="city-hud">
        <div className="city-title">objet&nbsp;d&rsquo;art &mdash; la cit&eacute;</div>
        <div className="city-hint" ref={hintRef}>
          a settlement made of the care it takes
        </div>
      </div>
      <LetGo label="let the city go" onLetGo={letGo} visible={hasKept} />
      <style dangerouslySetInnerHTML={{ __html: `
        .city-hud {
          position: absolute; left: 0; right: 0; z-index: 10; pointer-events: none;
          top: 0; padding: calc(70px + env(safe-area-inset-top,0px)) 20px 0;
          display: grid; gap: 6px; justify-items: center; text-align: center;
        }
        .city-title {
          font-family: var(--font-fraunces, var(--font-serif, Georgia), serif);
          font-weight: 600; font-size: clamp(20px, 4.5vw, 30px);
          background: linear-gradient(180deg,#fff6da,#f6e6b4 30%,#e7b94e 70%,#b8860b 100%);
          -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: #e7b94e;
          text-shadow: 0 2px 16px rgba(0,0,0,0.5);
        }
        .city-hint {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 11px; letter-spacing: 0.14em; text-transform: lowercase;
          color: rgba(246,230,180,0.6);
          transition: opacity .6s ease;
        }
        @media (max-width: 560px){ .city-hint{ font-size: 10px; padding: 0 18px; line-height: 1.45; } }
      ` }} />
    </div>
  );
}
