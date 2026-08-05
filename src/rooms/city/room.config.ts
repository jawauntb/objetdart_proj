// object-compiler template — docs/plans/object-compiler.md M3.
// Consumes: spec.key, spec.route, spec.sigil, spec.desc, spec.cluster,
//           spec.dark, spec.home_priority, spec.placement, spec.icon (palette
//           + names), spec.guide (title/scale/essence/moves/finds/keeps).
// Deterministic — no LLM slot. Every field comes from the spec.
import type { RoomManifest } from "@/rooms/types";

/**
 * /city — a settlement whose parts are what they do — home, store, event, tree.
 *
 * This manifest carries the same fields the hand-written registries carry for
 * /city today (SITE_ROUTES, PEER_CIRCLES, SITE_ICON_VISUALS, GUIDE_ROOMS).
 * The manifest is not yet imported by `src/rooms/registry.ts` — /city predates
 * the manifest path, and moving its registry rows all at once would collide
 * with a lane in flight. What this file DOES declare, and does it now, is the
 * `life:` block that `scripts/test-room-quality.mjs` needs: the shared 7s
 * breath the shaders must read, the 20s idle glimmer the settlement must show
 * between gestures, and one haptic per verb — the same seven-check bar Reef,
 * Spring, and Geyser are scored against. See AGENTS.md §"The room quality bar"
 * and phase-3-recompile.md for why the declaration lives here.
 */
const city = {
  key: "city",
  href: "/city",
  sigil: "atlas",
  desc: "a settlement · homes · stores · events",
  cluster: "field",
  dark: true,
  place: {
    kind: "peer",
    circle: "hearth",
    band: "atlas",
    label: "a city",
    ringAfter: "atlas",
  },
  icon: {
    // A small settlement, identity by causal role: home → store → event → tree,
    // people walking their needs across the plots that answer them.
    title: "City",
    description: "a small settlement whose parts are what they do",
    path: "/city",
    shortName: "city",
    kind: "atlas",
    bg: "#0e0f13",
    bg2: "#1a1a1f",
    glow: "#e8bb81",
    accent: "#c8732a",
    accent2: "#4a916a",
    ink: "#f4eede",
  },
  guide: {
    title: "a settlement · homes · stores · events",
    scale:
      "the atlas band — a peer of the atlas at the ground: the same earth at the level of dwellings, not coastlines.",
    essence:
      "a small settlement whose parts are what they do — a plot is a home the moment it is planted, becomes a store, becomes an event, quiets to a tree; the people carry a need and walk to the plot that answers it.",
    moves: [
      "tap → ripples the ground, or brightens a plot if the tap lands on one",
      "rapid taps → the train: three raps knock on the nearest door and its neighbors turn toward it; five ring a market bell that feeds the near and turns a leaver back; seven and more, a carillon — every plot rings and the town is called home",
      "steady taps → the day entrains to the hand's tempo for a few breaths",
      "pinch → the coupled zoom+pitch camera: pinch out drops the eye toward street-level (SF / London), pinch in lifts it to Currier & Ives bird's-eye — one axis, spring-eased",
      "tap2 → step back to bird's-eye and center the frame",
      "drag2 → pan the camera aim across the ground plane",
      "scrub → stirs the weather the way the hand circles; the people caught inside turn to its center",
      "dwell → plants a home; keep holding and it densifies (home → store → event → tree)",
      "ceremony hold → seals the plot at its current role, kept between visits",
      "drag → traces a road; people walk faster where the road runs",
      "flick → rings a chime at that point; nearby people gather to it",
      "twist → the lens: map, hydrology, satisfaction",
      "twist3 → turns the year through the four seasons; the trees follow",
      "tap3 → tutti; bells ring across the town, people move to the nearest event",
      "drag3 → weather; wind and rain roll across the settlement",
      "hold3 → time dilation — the day slows the longer the hold, toward stillness",
      "tilt / knock / flip → rain leans in / the bell tolls as far as the rap was hard / night falls",
    ],
    finds: [
      "a five-tap market bell reaches a person already walking out — fed at the edge of leaving, they turn back and settle",
      "a home spawns one to three residents deterministically from its own seed — the same seed always brings the same people",
      "roads are only ever as fast as the people who use them; a road with no traffic is just a line you drew",
      "a hungry city with no stores is a city standing still: people wait rather than wander when nothing answers their need",
      "a new resident walks in from the nearest map edge before settling — arrival is a visible passage, not a spawn",
      "returning to the same store or event three times makes the person a regular there, and the plot warms into a small community — a store is where these people eat",
      "when two stores stand at nearly the same distance, the walker slows and, given a moment, swaps route — the tradeoff is legible in the step",
      "the settlement is tuned to d mixolydian: a home rings the tonic, a store the fourth, an event the fifth, a tree the flat seventh — the civic ladder climbs the mode; a sealed plot tolls the triad rooted at its own note, and tutti stacks a voice for every event the city holds",
    ],
    keeps: "every sealed plot, the season the year reached, and the day the city had been living in",
  },
  // ——— the room quality bar, structured ————————————————————————————————
  // AGENTS.md §"The room quality bar" items 3, 5, and 6, declared per
  // City.tsx as it is today. `scripts/test-room-quality.mjs` reads this
  // block and verifies each claim against the component source:
  //   1. `uBreath` in `reads` → the 7s uniform is declared and USED past
  //      its declaration in GROUND_FRAG.
  //   2. `createIdleWriter` is called (city persists to `objetdart:city:v1`)
  //      and the 20s cadence is honored — the settlement glimmers at rest.
  //   3. Every verb named in `haptics_grammar` has its `haptics.<pattern>()`
  //      call in the file. Verbs with no haptic (surface drag, world-law
  //      wind, tilt, shake) are omitted so the check does not misread
  //      silence as a hole.
  //   4. `letgo_clears_population: true` — the onLetGo handler empties
  //      plots/people/roads arrays and the writer schedules a save.
  //   5. `ceremony_is` — the room's one solemn act (a hold to tier 3 seals
  //      the plot at its current civic role).
  life: {
    population: {
      objects: [
        {
          noun: "plot",
          max_count: 48,
          state_shape:
            "id, seed, x (0..1), y (0..1), role (empty|home|store|event|tree), dwellStartMs, liveDwellMs, sealed (bool), bornMs",
          lifecycle:
            "born under dwell (planted as a home at first touch) → densifies through the civic ladder on the closed-form roleForDwell(liveDwellMs) — home at 0ms → store at PLOT_DWELL_MS.store → event at PLOT_DWELL_MS.event → tree at PLOT_DWELL_MS.tree — while a finger holds → sealed at ceremony (tier ≥ 3, kept between visits) → retires only via <LetGo> (population-wide)",
          persistence: "localStorage",
          creates_via_verb: "dwell",
          retires_via: ["LetGo"],
          implementation_hint: "inline array",
        },
      ],
    },
    breath: {
      period_seconds: 7,
      reads: [
        "uBreath uniform (ground shader — soil grain lightens `0.94 + 0.06 * uBreath`)",
        "uBreath uniform (ground shader — sky brightens `0.96 + 0.06 * uBreath`)",
        "uBreath uniform (ground shader — horizon ember swells by `0.85 + 0.15 * uBreath`)",
      ],
      behavior_at_rest:
        "three visible registers ride the 7s clock: the soil grain brightens/dims by ±6%, the sky brightens by ±6%, and the horizon ember's dawn/dusk band swells by ±15%. Between gestures the settlement is never still — the ground breathes under a sun that keeps turning.",
    },
    glimmer: {
      after_idle_ms: 20000,
      visual:
        "after 20s of no touch and no vessel event, one sealed plot (or, in an empty city, a spot near the horizon) breathes a wider ring — a soft ochre halo on the overlay canvas, one full breath long, and nothing is said. Picked deterministically by `cityTimeMs / 313 % plots.length` so the same idle produces the same glimmer.",
    },
    haptics_grammar: {
      tap: "ripple",     // ringHere on a plot → haptics.ripple(0.3 + intensity * 0.35)
      dwell: "tap",      // plant() lands one haptics.tap(), then haptics.detent() on each ladder rung
      ceremony: "bloom", // seal at tier 3 → haptics.bloom()
      drag: "chop",      // road end → haptics.chop()
      flick: "chop",     // chime thrown at a point → haptics.chop()
      twist: "lens",     // two-finger lens raise/lower → haptics.lens()
      twist3: "detent",  // three-finger season detent → haptics.detent()
      tap3: "roll",      // tutti → haptics.roll()
      hold3: "tap",      // time dilation enter → haptics.tap()
      scrub: "tap",      // scrub over the field → haptics.tap()
      knock: "detent",   // the city's bell tolls once → haptics.detent()
      flip: "detent",    // face-down flips the room into night → haptics.detent()
    },
    make_unmake: {
      letgo_clears_population: true,
      ceremony_is:
        "seals the plot at its current civic role (home / store / event / tree) — the sealed plot is kept between visits and reads as a small warm ring at the tile's rim, the settlement's one solemn act",
    },
  },
} as const satisfies RoomManifest;

export default city;
