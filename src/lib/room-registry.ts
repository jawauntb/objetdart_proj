/**
 * room-registry — what every room owes the hand, and the reasons for whatever
 * it cannot say.
 *
 * `src/rooms/` answers *where a room is*: its route, its sigil, its placement
 * on the axis, its guide entry — declared once per room and derived into
 * `SITE_ROUTES`, `PEER_CIRCLES`, the icon config and the guide. This file
 * answers the other half, the one no registry had: **what a room owes the
 * grammar.** Which global bindings it implements, which it genuinely cannot
 * express and why, who owns the two-finger frame verb, what it keeps, what a
 * dwell-hold creates, what chrome its page mounts.
 *
 * The two are cross-checked against each other (`registryDrift()`), never
 * duplicated: this table holds no `desc`, no `icon`, no cluster — ask
 * `SITE_ROUTES` for those.
 *
 * Why it exists, stated plainly so it is never softened back into prose:
 * AGENTS.md already said every one of these laws in words, and an audit still
 * found /earth wired to raw PointerEvents with a private 540ms hold timer,
 * /stars (4517 lines) with no vessel layer at all, thirty of thirty-five rooms
 * never touching `room-runtime`, `src/lib/fork-regions.ts` built and tested and
 * merged with zero consumers, and `AtomsField` hand-rolling the clear button
 * that `<LetGo>` exists to fix. Prose did not hold the line. This table plus
 * `scripts/test-room-contract.mjs` is the line.
 *
 * Pure data + tiny helpers. Imports only the scale manifold and the peer
 * cosmology (no DOM, no React) so node can load it — keep it that way.
 *
 * TODO (follow-up merge, one PR): fold these fields into `RoomManifest`
 * (`src/rooms/types.ts`) as a `contract:` block, so a room states everything
 * about itself in `src/rooms/<key>/room.config.ts` and this file becomes the
 * derivation rather than a second table. Only two rooms (beam, relativity) had
 * migrated to the manifest when this landed, and the contract has to cover all
 * fifty-six today; merging now would mean fifty-four half-manifests. Until
 * then `registryDrift()` fails loudly if the two disagree.
 */

import { SCALE_BANDS, scaleBandIdForRoute, spectralRegisterFor, entryScaleFor } from "@/lib/scale";
import type { ScaleBandId, SpectralRegister } from "@/lib/scale";
import { SCALE_EXEMPT_KEY_SET, peerCircleForRoute } from "@/lib/peers";

// ———————————————————————————————————————————————————————————————————————
// The global bindings (docs/gesture-grammar.md §5), as checkable names.
// ———————————————————————————————————————————————————————————————————————

/**
 * Every global binding a room owes its visitor. The grammar is the contract:
 * a room implements each one its material can express, and each one it cannot
 * carries a written reason in `exempt` — never silence.
 *
 * Two of the grammar's rows are deliberately absent from this list:
 *  - **pinch / travel** is the frame verb; it is owned by `ScaleTravel` for
 *    every room whose `frame` is `"yield"`, and by the room itself only when
 *    `frame` is `"own"`. See `frame` below.
 *  - **breath** is opt-in and candle-only (grammar §1, "beyond touch"): the
 *    microphone stays off unless the candle has invited it, so requiring it
 *    site-wide would be requiring a permission prompt in every room.
 */
export const GLOBAL_BINDINGS = [
  "stepBack", // two-finger tap — lower a raised lens, else one step out
  "tutti", // three-finger tap — one synchronized pulse of everything alive
  "lens", // twist (2) — rotate the level of description at fixed scale
  "season", // twist (3) — advance / rewind the room's slow cycle
  "pan", // two-finger drag — pan the frame (rooms that own a frame)
  "weather", // three-finger drag — wind / weather
  "dilation", // three-finger hold — time dilation while held
  "dwell", // long-press tier ≥ 1 — plant / grow / charge
  "ceremony", // hold tier ≥ 3 — the room's one solemn act
  "tilt", // vessel — gravity
  "shake", // vessel — scatter / agitate
  "knock", // vessel — wake / ring the room
  "flip", // vessel — night
] as const;

export type GlobalBinding = (typeof GLOBAL_BINDINGS)[number];

/**
 * What the contract test greps for in a room's source to decide a binding is
 * really wired. These are read off the *handler bodies* the room passes to
 * `attachGestures` / `onVessel`, not the whole file, so a comment mentioning
 * "tutti" proves nothing and a stray `fingers === 3` in the render loop
 * proves nothing either.
 *
 * `handler` names the semantic event; `inBody` is the shape the binding takes
 * inside it; `vessel` marks the four the device speaks rather than the hand.
 */
export type BindingProbe = {
  binding: GlobalBinding;
  /** gesture handler key, or vessel handler key when `vessel` is true. */
  handler: string;
  vessel?: boolean;
  /** required inside that handler's body; omitted = the handler alone is it. */
  inBody?: RegExp;
  /** what a hand loses when this is missing — used verbatim in the failure. */
  loses: string;
};

const FINGERS_3 = /fingers\s*[=!]==?\s*3|fingers\s*>=\s*3/;
const FINGERS_2 = /fingers\s*[=!]==?\s*2/;

export const BINDING_PROBES: BindingProbe[] = [
  { binding: "stepBack", handler: "tap", inBody: FINGERS_2, loses: "the frame never retreats a step" },
  { binding: "tutti", handler: "tap", inBody: FINGERS_3, loses: "the room can never state itself at once" },
  { binding: "lens", handler: "twist", loses: "the level of description is frozen" },
  { binding: "season", handler: "twist", inBody: FINGERS_3, loses: "the room's slow cycle cannot be turned" },
  { binding: "pan", handler: "pan2", loses: "a frame larger than the screen cannot be moved" },
  { binding: "weather", handler: "drag", inBody: FINGERS_3, loses: "no wind reaches the material" },
  { binding: "dilation", handler: "hold", inBody: FINGERS_3, loses: "time cannot be held still" },
  { binding: "dwell", handler: "hold", inBody: /tier\s*(?:>=|>|===)\s*[12]\b/, loses: "nothing can be planted or grown" },
  { binding: "ceremony", handler: "hold", inBody: /tier\s*(?:>=|>|===)\s*3\b/, loses: "the room has no solemn act, and no touch-reachable delete" },
  { binding: "tilt", handler: "tilt", vessel: true, loses: "the room ignores real gravity" },
  { binding: "shake", handler: "shake", vessel: true, loses: "agitation does nothing" },
  { binding: "knock", handler: "knock", vessel: true, loses: "a rap on the case goes unanswered" },
  { binding: "flip", handler: "flip", vessel: true, loses: "face-down is not night" },
];

// ———————————————————————————————————————————————————————————————————————
// The entry
// ———————————————————————————————————————————————————————————————————————

/**
 * `"room"` — a place with material a hand plays.
 * `"instrument"` — a spectral meta-instrument or lens (`/light`, `/timbre`…):
 *   still owes the grammar, but takes no scale address.
 * `"reading"` — a declared reading surface (`/guide`, `/kept`…): prose, not
 *   material. Exempt from the gesture contract by kind, never by silence.
 */
export type RoomKind = "room" | "instrument" | "reading";

/** Who owns the two-finger frame verb — pinch, and therefore travel and pan. */
export type FrameOwner =
  /** ScaleTravel owns pinch; the room must NOT bind it, and has no frame to pan. */
  | "yield"
  /** The room owns its camera (the /stars case): it must bind pinch AND pan2. */
  | "own";

/**
 * What the room's page mounts. `"axis"` (`<AxisChrome route=…/>`) is the one
 * convention for new rooms; `"travel+peers"` / `"travel"` are the older
 * hand-mounted pairs still standing in ~20 pages, declared here so the
 * migration is visible instead of ambient. `"none"` is legal only for
 * scale-exempt kinds — a room with a band address and no chrome is a bug
 * (`/atlas/[region]` is the live one).
 */
export type RoomChrome = "axis" | "travel+peers" | "travel" | "peers" | "none";

export type RoomEntry = {
  /** route registry key; also the guide key and the screenshot filename. */
  key: string;
  href: string;
  kind: RoomKind;
  /** repo-relative source of the component that owns the material. */
  source: string | null;
  /** repo-relative thin page that mounts it. */
  page: string;
  /**
   * Where it lives on the quark→manifold axis, or why it takes no address.
   * Cross-checked against `scaleBandIdForRoute` / `SCALE_EXEMPT_KEYS`.
   */
  address: { band: ScaleBandId } | { exempt: string };
  frame: FrameOwner;
  chrome: RoomChrome;
  /** the room's own localStorage key, written through `createIdleWriter`. */
  keeps: string | null;
  /**
   * The noun a dwell-hold makes, when the material is countable. Non-null
   * means the room owes a whole-field clear through the shared `<LetGo>`.
   * Null means the room keeps settings or a single object, not a population.
   */
  creates: string | null;
  /**
   * Global bindings this material genuinely cannot express, each with the
   * reason. An unbound, unexempted binding fails the contract test — that
   * failure is the grammar working, not an obstacle.
   */
  exempt: Partial<Record<GlobalBinding, string>>;
  /**
   * Why this room touches a raw pointer alongside `attachGestures` (an audio
   * unlock, a `stopPropagation` on a panel). Rooms with no gesture engine at
   * all are not covered by this — that is the Earth/Stars violation.
   */
  rawPointer?: string;
  /** Why an animating room needs no `createFrameGovernor`. */
  governor?: string;
  /**
   * Why a constant whose *name* reads like a gesture tier is not one. The
   * contract test flags any `const FOO_SETTLE_MS = 520` because "settle",
   * "hold", "tap" and "tier" are the grammar's own words, and it cannot tell
   * a camera's quiet-debounce from a chord-settle window by looking at it.
   * The room says which it is, in a sentence a human reads.
   *
   * This is not a licence: the test requires the sentence to *name* every
   * constant it covers, so a real hold tier can never hide behind a reason
   * written for something else. Gesture thresholds still live in
   * `src/lib/gesture/core.ts` and nowhere else.
   */
  thresholds?: string;
};

/**
 * Rooms that yield the frame have no frame of their own to pan: the viewport
 * is the frame, and its one verb (pinch → zoom, held → travel) belongs to
 * ScaleTravel. Rooms that declare `frame: "own"` own a camera, and a camera
 * you can zoom but not move is half a frame — those must bind `pan2`.
 */
export const PAN_YIELDED_REASON =
  "the frame is the viewport and ScaleTravel owns its one verb; there is no camera to move";

/**
 * One entry per registered route. Kept in `SITE_ROUTES` order so the two lists
 * read side by side; order carries no meaning here.
 */
export const ROOM_REGISTRY: RoomEntry[] = [
  {
    key: "atlas",
    href: "/atlas/origin",
    kind: "room",
    source: "src/components/Atlas.tsx",
    page: "src/app/atlas/[region]/page.tsx",
    address: { band: "atlas" },
    frame: "yield",
    chrome: "axis",
    keeps: "objetdart:atlas:naturals:v1",
    creates: "a natural",
    exempt: {
      tilt:
        "the map is seen from directly overhead, so there is no down for the device to lean " +
        "toward: a tilt would slide the paper sideways under the reader rather than pull " +
        "anything toward the ground, which is the one thing tilt means everywhere else",
    },
    rawPointer:
      "the one-finger pan, the two-finger pinch and the inertia are a hand-tuned pointer state " +
      "machine that already speaks the material and frame verbs and reports its residual zoom to " +
      "the manifold through useBandEdgeTravel; the grammar layer is mounted alongside it with " +
      "noCapture so the state machine stays the sole owner of pointer capture",
    thresholds:
      "MOBILE_ZOOM_SETTLE_MS and DESKTOP_ZOOM_SETTLE_MS are the camera's quiet-debounce — how " +
      "long the view must stop moving before the room spends a tile generation on it — and the " +
      "two differ because a phone's glide is shorter than a trackpad's. Neither classifies a " +
      "contact: no hold, tap or chord is measured against them, and the room's one real gesture " +
      "timing (the plant) is THRESHOLDS.dwellMs from gesture/core.ts",
  },
  {
    key: "city",
    href: "/city",
    kind: "room",
    source: "src/components/City.tsx",
    page: "src/app/city/page.tsx",
    address: { band: "atlas" },
    frame: "yield",
    chrome: "axis",
    keeps: "objetdart:city:v1",
    creates: "a plot",
    exempt: {},
  },
  {
    key: "coast",
    href: "/coast",
    kind: "room",
    source: "src/components/CoastBeach.tsx",
    page: "src/app/coast/page.tsx",
    address: { band: "coast" },
    frame: "yield",
    chrome: "axis",
    keeps: "objetdart:coast:v1",
    creates: "a shell",
    exempt: {},
  },
  {
    key: "ocean",
    href: "/ocean",
    kind: "room",
    source: "src/components/Ocean.tsx",
    page: "src/app/ocean/page.tsx",
    address: { band: "coast" },
    frame: "yield",
    chrome: "travel+peers",
    keeps: "objetdart:world:v1",
    creates: "a natural",
    exempt: {},
  },
  {
    key: "tide",
    href: "/tide",
    kind: "room",
    source: "src/components/Tide.tsx",
    page: "src/app/tide/page.tsx",
    address: { band: "coast" },
    frame: "yield",
    chrome: "travel+peers",
    keeps: "objetdart:world:v1",
    creates: "a natural",
    exempt: {},
  },
  {
    key: "waves",
    href: "/waves",
    kind: "room",
    source: "src/components/Waves.tsx",
    page: "src/app/waves/page.tsx",
    address: { band: "coast" },
    frame: "yield",
    chrome: "travel+peers",
    keeps: "objetdart:world:v1",
    creates: "a natural",
    exempt: {},
  },
  {
    key: "sine",
    href: "/sine",
    kind: "room",
    source: "src/components/SineWaveExplorer.tsx",
    page: "src/app/sine/page.tsx",
    address: { band: "coast" },
    frame: "yield",
    chrome: "axis",
    keeps: null,
    creates: null,
    exempt: {
      weather: "a sine equation has amplitude and phase but no directional weather field; adding wind would misstate its one-dimensional material law",
      dilation: "the oscillator's timebase is its represented quantity, so slowing it would change the signal rather than hold the room's world still",
      dwell: "the surface is a single analytic wave, not a field that can receive a planted or growing object",
      ceremony: "there is no countable material to seal or retire: the waveform remains a continuously recomputed function",
    },
  },
  {
    key: "pretext",
    href: "/pretext",
    kind: "room",
    source: "src/components/PretextWave.tsx",
    page: "src/app/pretext/page.tsx",
    address: { band: "coast" },
    frame: "own",
    chrome: "axis",
    keeps: null,
    creates: null,
    exempt: {},
    rawPointer: "the typography layer samples pointer contact continuously to deform the wave beneath a fingertip; semantic gesture handlers remain the owner of classified hand meanings",
    governor: "the room's requestAnimationFrame loop is a short visual settling pass after a contact, not a continuously running simulation, so it has no sustained frame budget to tier",
  },
  {
    key: "circularity",
    href: "/circularity",
    kind: "room",
    source: "src/components/CircularityFourier.tsx",
    page: "src/app/circularity/page.tsx",
    address: { band: "coast" },
    frame: "yield",
    chrome: "axis",
    keeps: null,
    creates: null,
    exempt: {},
    rawPointer: "the spectrum bars are a panel control, not the playable surface: each bar stops propagation so a tap on a harmonic never reaches the field behind it",
  },
  {
    key: "beyond",
    href: "/beyond",
    kind: "room",
    source: "src/components/BeyondWaveField.tsx",
    page: "src/app/beyond/page.tsx",
    address: { band: "beyond" },
    frame: "yield",
    chrome: "travel",
    keeps: null,
    creates: null,
    exempt: {},
  },
  {
    key: "manifold",
    href: "/manifold",
    kind: "room",
    source: "src/components/ManifoldFold.tsx",
    page: "src/app/manifold/page.tsx",
    address: { band: "manifold" },
    frame: "yield",
    chrome: "axis",
    keeps: "objetdart:manifold:v1",
    creates: "a mass",
    exempt: {},
  },
  {
    key: "overlook",
    href: "/overlook",
    kind: "room",
    source: "src/components/OverlookTree.tsx",
    page: "src/app/overlook/page.tsx",
    address: { exempt: "a meta view of the tree itself, not a place on it" },
    frame: "own",
    chrome: "none",
    keeps: null,
    creates: null,
    exempt: {
      dwell: "the overlook is one generated tree-view rather than soil or a population; a dwell already focuses its existing branches and cannot plant a second tree into the lens",
    },
  },
  {
    key: "relativity",
    href: "/relativity",
    kind: "room",
    source: "src/components/RelativityRoom.tsx",
    page: "src/app/relativity/page.tsx",
    address: { exempt: "a law, not a scale: the covenant holds at every band" },
    frame: "yield",
    chrome: "none",
    keeps: null,
    creates: null,
    exempt: {},
  },
  {
    key: "loom",
    href: "/loom",
    kind: "room",
    source: "src/components/StructureLoom.tsx",
    page: "src/app/loom/page.tsx",
    address: { exempt: "one structure compiled into every sense — a lens, not a size" },
    frame: "own",
    chrome: "none",
    keeps: "objetdart:loom:v1",
    creates: "a crossing",
    exempt: {
      dwell: "a crossing is created by a completed stroke, not planted by duration; growing one under a stationary hand would break the loom's deterministic thread geometry",
    },
  },
  {
    key: "storm",
    href: "/storm",
    kind: "room",
    source: "src/components/Storm.tsx",
    page: "src/app/storm/page.tsx",
    address: { band: "olympus" },
    frame: "yield",
    chrome: "axis",
    keeps: null,
    creates: null,
    exempt: {},
    rawPointer: "the wind vane and the barometer are instrument panels with pointer capture — continuous dials the engine has no verb for",
  },
  {
    key: "clouds",
    href: "/clouds",
    kind: "room",
    source: "src/components/Clouds.tsx",
    page: "src/app/clouds/page.tsx",
    address: { band: "olympus" },
    frame: "yield",
    chrome: "travel+peers",
    keeps: null,
    creates: null,
    exempt: {},
  },
  {
    key: "mountain",
    href: "/mountain",
    kind: "room",
    source: "src/components/MountainPeak.tsx",
    page: "src/app/mountain/page.tsx",
    address: { band: "olympus" },
    frame: "yield",
    chrome: "axis",
    keeps: "objetdart:mountain:v1",
    creates: "a cairn",
    exempt: {},
  },
  {
    key: "aphros",
    href: "/aphros",
    kind: "room",
    source: "src/components/Aphros.tsx",
    page: "src/app/aphros/page.tsx",
    address: { band: "coast" },
    frame: "yield",
    chrome: "axis",
    keeps: "objetdart:aphros:v2",
    creates: "a bloom",
    exempt: {},
  },
  {
    key: "flowers",
    href: "/flowers",
    kind: "room",
    source: "src/components/FlowersGarden.tsx",
    page: "src/app/flowers/page.tsx",
    address: { band: "flowers" },
    frame: "own",
    chrome: "axis",
    keeps: "objetdart:flowers:v1",
    creates: "a flower",
    exempt: {
      pan: "the garden camera is anchored to its bed: pinch changes the botanical scale but translation would move the visitor outside the bounded plot",
      dwell: "the garden's pressure-bloom is continuous from contact and already owns its growth axis; a second dwell plant would duplicate a flower at the same contact",
    },
    rawPointer: "reads contact count and the surf-line inset directly for the press-bloom; the engine reports intensity per event but no continuous pressure channel while held",
  },
  {
    key: "birds",
    href: "/birds",
    kind: "room",
    source: "src/components/Murmuration.tsx",
    page: "src/app/birds/page.tsx",
    address: { band: "birds" },
    frame: "yield",
    chrome: "travel+peers",
    keeps: "objetdart:birds:v1",
    creates: "a bird",
    exempt: {},
  },
  {
    key: "tissue",
    href: "/tissue",
    kind: "room",
    source: "src/components/TissueSheet.tsx",
    page: "src/app/tissue/page.tsx",
    address: { band: "tissue" },
    frame: "yield",
    chrome: "travel",
    keeps: "objetdart:tissue:v1",
    creates: "a cell",
    exempt: {},
  },
  {
    key: "cells",
    href: "/cells",
    kind: "room",
    source: "src/components/CellsPlasm.tsx",
    page: "src/app/cells/page.tsx",
    address: { band: "cells" },
    frame: "yield",
    chrome: "travel",
    keeps: "objetdart:cells:v1",
    creates: "a cell",
    exempt: {},
  },
  {
    key: "organelles",
    href: "/organelles",
    kind: "room",
    source: "src/components/OrganellesPlasm.tsx",
    page: "src/app/organelles/page.tsx",
    address: { band: "organelles" },
    frame: "yield",
    chrome: "travel",
    keeps: "objetdart:organelles:v1",
    creates: "an organelle",
    exempt: {},
  },
  {
    key: "dna",
    href: "/dna",
    kind: "room",
    source: "src/components/HelixLadder.tsx",
    page: "src/app/dna/page.tsx",
    address: { band: "dna" },
    frame: "yield",
    chrome: "travel",
    keeps: "objetdart:dna:v1",
    creates: "a base pair",
    exempt: {},
  },
  {
    key: "organics",
    href: "/organics",
    kind: "room",
    source: "src/components/OrganicsField.tsx",
    page: "src/app/organics/page.tsx",
    address: { band: "organics" },
    frame: "yield",
    chrome: "travel",
    keeps: "objetdart:organics:v1",
    creates: "a chain",
    exempt: {},
  },
  {
    key: "molecules",
    href: "/molecules",
    kind: "room",
    source: "src/components/MoleculesField.tsx",
    page: "src/app/molecules/page.tsx",
    address: { band: "molecules" },
    frame: "yield",
    chrome: "travel",
    keeps: "objetdart:molecules:v1",
    creates: "a molecule",
    exempt: {},
  },
  {
    key: "atoms",
    href: "/atoms",
    kind: "room",
    source: "src/components/AtomsField.tsx",
    page: "src/app/atoms/page.tsx",
    address: { band: "atoms" },
    frame: "yield",
    chrome: "travel",
    keeps: "objetdart:atoms:v1",
    creates: "an atom",
    exempt: {},
  },
  {
    key: "nucleons",
    href: "/nucleons",
    kind: "room",
    source: "src/components/NucleonsField.tsx",
    page: "src/app/nucleons/page.tsx",
    address: { band: "nucleons" },
    frame: "yield",
    chrome: "travel",
    keeps: "objetdart:nucleons:v1",
    creates: "a nucleus",
    exempt: {},
  },
  {
    key: "quarks",
    href: "/quarks",
    kind: "room",
    source: "src/components/QuarksVacuum.tsx",
    page: "src/app/quarks/page.tsx",
    address: { band: "quarks" },
    frame: "yield",
    chrome: "travel",
    keeps: "objetdart:quarks:v1",
    creates: "a hadron",
    exempt: {},
  },
  {
    key: "quanta",
    href: "/quanta",
    kind: "room",
    source: "src/components/QuantaField.tsx",
    page: "src/app/quanta/page.tsx",
    address: { band: "quanta" },
    frame: "yield",
    chrome: "travel",
    keeps: "objetdart:quanta:v1",
    creates: "a particle",
    exempt: {
      dwell: "a quantum event is emitted at contact and evolves probabilistically; a stationary dwell cannot plant a second particle without inventing a classical seed",
    },
  },
  {
    key: "fire",
    href: "/fire",
    kind: "room",
    source: "src/components/Fire.tsx",
    page: "src/app/fire/page.tsx",
    address: { band: "earth" },
    frame: "yield",
    chrome: "axis",
    keeps: null,
    creates: null,
    exempt: {},
  },
  {
    key: "earth",
    href: "/earth",
    kind: "room",
    source: "src/components/Earth.tsx",
    page: "src/app/earth/page.tsx",
    address: { band: "earth" },
    frame: "yield",
    chrome: "axis",
    keeps: null,
    creates: null,
    exempt: {},
  },
  {
    key: "growth",
    href: "/growth",
    kind: "room",
    source: "src/components/Growth.tsx",
    page: "src/app/growth/page.tsx",
    address: { band: "flowers" },
    frame: "yield",
    chrome: "axis",
    keeps: null,
    creates: null,
    exempt: {},
  },
  {
    key: "stars",
    href: "/stars",
    kind: "room",
    source: "src/components/Stars.tsx",
    page: "src/app/stars/page.tsx",
    address: { band: "stars" },
    frame: "own",
    chrome: "axis",
    keeps: "objetdart:constellations:v1",
    creates: "a star",
    exempt: {
      dilation: "the star field's clock is astronomical position rather than room-time; holding it would falsify the orbital representation",
      dwell: "constellations are named from a completed contact path, not grown under a stationary finger",
      ceremony: "the kept sky is sealed by naming a constellation; there is no separate ceremony that can safely retire a shared star",
    },
  },
  {
    key: "space",
    href: "/space",
    kind: "room",
    source: "src/components/DeepSpaceWeb.tsx",
    page: "src/app/space/page.tsx",
    address: { band: "space" },
    frame: "yield",
    chrome: "axis",
    keeps: "objetdart:space:v1",
    creates: "a galaxy",
    exempt: {
      ceremony: "a galaxy web has no singular touch-reachable object to seal or retire; its persistence is the topology of the whole field",
    },
  },
  {
    key: "comb",
    href: "/comb",
    kind: "room",
    source: "src/components/Comb.tsx",
    page: "src/app/comb/page.tsx",
    address: { band: "stars" },
    frame: "yield",
    chrome: "axis",
    keeps: null,
    creates: null,
    exempt: {},
  },
  {
    key: "beam",
    href: "/beam",
    kind: "room",
    source: "src/components/Beam.tsx",
    page: "src/app/beam/page.tsx",
    address: { band: "stars" },
    frame: "own",
    chrome: "axis",
    keeps: "objetdart:beam:memory",
    creates: "a kept sky",
    exempt: {
      pan: "the beam's perspective is locked to its source and target; translation would detach the kept sky from the optical axis",
    },
  },
  {
    key: "signal",
    href: "/signal",
    kind: "instrument",
    source: "src/components/Signal.tsx",
    page: "src/app/signal/page.tsx",
    address: { exempt: "a spectral meta-instrument, not a place" },
    frame: "own",
    chrome: "none",
    keeps: "objetdart:signal-kept:v1",
    creates: "a kept signal",
    exempt: {
      weather: "the signal is an ordered spectral trace with no spatial weather field; wind would change its encoded measurement rather than its material",
      dilation: "time is the horizontal coordinate of the signal, so dilation would rewrite the reading rather than hold a simulated world",
    },
    rawPointer: "the transport scrubber needs immediate pointer contact to audition a frequency before a semantic gesture has classified; classified grammar remains attached to the same stage",
  },
  {
    key: "light",
    href: "/light",
    kind: "instrument",
    source: "src/components/LightInstrument.tsx",
    page: "src/app/light/page.tsx",
    address: { exempt: "a spectral meta-instrument, not a place" },
    frame: "own",
    chrome: "none",
    keeps: null,
    creates: null,
    exempt: {
      weather: "the light plate is a fixed chromatic relation, not a directional field that can carry wind",
      dilation: "its temporal behavior is an audio envelope; slowing it would alter a performed note rather than dilate a world clock",
      dwell: "marks are placed by discrete touch and the plate has no soil or population lifecycle to grow beneath a held contact",
      ceremony: "kept marks are explicitly saved through their existing composition act; no solitary object can be sealed or retired by a second ceremony",
    },
    governor: "the animation is a bounded audiovisual envelope driven by note playback, not a persistent simulation requiring adaptive detail",
  },
  {
    key: "music-color",
    href: "/light/inverse",
    kind: "instrument",
    source: "src/components/MusicColorInstrument.tsx",
    page: "src/app/light/inverse/page.tsx",
    address: { exempt: "the inverse lens of /light — a map between senses" },
    frame: "yield",
    chrome: "none",
    keeps: null,
    creates: null,
    exempt: {
      stepBack: "the inverse is a fixed, single-screen mapping with no camera or raised lens to retreat",
      tutti: "the surface renders one invertible music-to-colour relation, not a population capable of synchronized response",
      lens: "this route is itself the inverse lens; rotating a second lens would lose the one-to-one mapping it demonstrates",
      season: "the inverse mapping is timeless and has no slow environmental cycle to turn",
      weather: "a colour transform has no spatial material or wind field",
      dilation: "the mapping has no simulation clock to hold",
      dwell: "the instrument renders a relation, not countable material that can be planted or grown",
      ceremony: "there is no persistent object on this inverse surface to seal or touch-delete",
      tilt: "device gravity cannot be represented in a two-dimensional colour-to-pitch transform without changing its value",
      shake: "agitation has no material counterpart in a deterministic inverse mapping",
      knock: "the inverse is a static relation with no body to wake or ring",
      flip: "face-down night belongs to a world or stage; this reading lens has no illuminated material to sleep",
    },
  },
  {
    key: "timbre",
    href: "/timbre",
    kind: "instrument",
    source: "src/components/TimbreInstrument.tsx",
    page: "src/app/timbre/page.tsx",
    address: { exempt: "a meta-instrument: one surface, every instrument" },
    frame: "own",
    chrome: "none",
    keeps: null,
    creates: null,
    exempt: {
      pan: "the timbre plate is a bounded performance surface whose coordinates are the instrument; translation would make notes unreachable",
      weather: "timbre parameters are not a spatial field and have no directional wind component",
      dilation: "a held instrument note already owns duration as sound; room-time dilation would change its performed envelope",
      dwell: "a sustained press is a note charge rather than a plantable object",
      ceremony: "the plate contains no persistent countable object to seal or retire",
    },
    governor: "animation is limited to active note envelopes and ends after release; it is not a continuous scene simulation",
  },
  {
    key: "instrument",
    href: "/instrument",
    kind: "instrument",
    source: "src/components/Instrument.tsx",
    page: "src/app/instrument/page.tsx",
    address: { exempt: "a polyphonic surface; every finger is material, not an address" },
    frame: "own",
    chrome: "none",
    keeps: null,
    creates: null,
    exempt: {
      tutti: "a polyphonic plate answers each finger as a voice; a simultaneous field pulse would collapse the independent-note material into one control",
      dwell: "duration is already the sustain of an active voice, not a growth axis for a separate object",
      ceremony: "the instrument leaves no persistent object on the plate to seal or retire",
    },
  },
  {
    key: "plasma",
    href: "/plasma",
    kind: "room",
    source: "src/components/Plasma.tsx",
    page: "src/app/plasma/page.tsx",
    address: { band: "drop" },
    frame: "yield",
    chrome: "axis",
    keeps: null,
    creates: null,
    exempt: {},
    rawPointer: "tracks per-contact filaments; the engine speaks this as `voice`, and adopting it is owed work, not a permanent exemption",
  },
  {
    key: "pulse",
    href: "/pulse",
    kind: "room",
    source: "src/components/Pulse.tsx",
    page: "src/app/pulse/page.tsx",
    address: { band: "drop" },
    frame: "yield",
    chrome: "axis",
    keeps: "objetdart:patterns:v1",
    creates: "a pattern",
    exempt: {
      dwell: "a pattern is struck and recorded on contact; holding the same cell sustains its pulse instead of planting a duplicate pattern",
    },
    rawPointer: "the sequencer needs immediate cell lighting at touchdown for low-latency performance, while attachGestures continues to classify every grammar-level act",
  },
  {
    key: "charts",
    href: "/charts",
    kind: "room",
    source: "src/components/Charts.tsx",
    page: "src/app/charts/page.tsx",
    address: { band: "drop" },
    frame: "yield",
    chrome: "axis",
    keeps: "objetdart:charts:pinned:v1",
    creates: "a pinned reading",
    exempt: {},
    governor: "chart motion is a short transition between readings and stops at rest, so adaptive simulation detail would not govern any persistent frame loop",
  },
  {
    key: "dither",
    href: "/dither",
    kind: "room",
    source: "src/app/dither/DitherLab.tsx",
    page: "src/app/dither/page.tsx",
    address: { band: "drop" },
    frame: "yield",
    chrome: "axis",
    keeps: null,
    creates: null,
    exempt: {
      tutti: "the page is a collection of reading specimens, not one shared material population that can pulse together",
      dwell: "the dither chart already gathers ink through its own analytic hold; it has no countable object to plant",
      tilt: "gravity has no directional counterpart in the fixed pixel grid",
      shake: "agitating a deterministic dither pattern would only corrupt the encoded image",
      knock: "the specimen sheet has no body or resonance to wake",
      flip: "the page has no illuminated simulation that can enter night",
    },
    governor: "the only requestAnimationFrame is a finite chart reveal; it ceases once the reveal reaches its final reading",
  },
  {
    key: "time",
    href: "/time",
    kind: "room",
    source: "src/components/TimeManifold.tsx",
    page: "src/app/time/page.tsx",
    address: { exempt: "the relativity instrument; it reads every band, occupies none" },
    frame: "yield",
    chrome: "none",
    keeps: null,
    creates: null,
    exempt: {},
  },
  {
    key: "tourbillon",
    href: "/tourbillon",
    kind: "room",
    source: "src/components/Tourbillon.tsx",
    page: "src/app/tourbillon/page.tsx",
    address: { band: "drop" },
    frame: "yield",
    chrome: "axis",
    keeps: null,
    creates: null,
    exempt: {
      dwell: "a tourbillon's dwell is its continuous escapement pressure, not a place where a new object can be planted",
    },
  },
  {
    key: "jewel",
    href: "/jewel",
    kind: "room",
    source: "src/components/Jewel.tsx",
    page: "src/app/jewel/page.tsx",
    address: { band: "drop" },
    frame: "yield",
    chrome: "axis",
    keeps: "objetdart:jewel:facets:v1",
    creates: "a facet",
    exempt: {},
    rawPointer: "arrests a spinning stone on the instant of contact, below any gesture threshold — the engine classifies tap and hold, and emits nothing at touchdown",
  },
  {
    key: "drop",
    href: "/drop",
    kind: "room",
    source: "src/components/DropSphere.tsx",
    page: "src/app/drop/page.tsx",
    address: { band: "drop" },
    frame: "yield",
    chrome: "travel+peers",
    keeps: null,
    creates: null,
    exempt: {
      dwell: "a drop pinches off only from continuous vessel tilt and surface tension; a stationary touch cannot plant a second physical droplet",
    },
    governor: "the sphere's requestAnimationFrame loop is event-driven settling after an impact and sleeps when no drop is moving",
  },
  {
    key: "seed",
    href: "/seed",
    kind: "room",
    source: "src/components/SeedEmbryo.tsx",
    page: "src/app/seed/page.tsx",
    address: { band: "drop" },
    frame: "yield",
    chrome: "travel+peers",
    keeps: "objetdart:seed:v1",
    creates: "a seed",
    exempt: {
      dwell: "the seed's phenology is already advanced by its existing pressure interaction; a second dwell plant would create an impossible duplicate embryo",
    },
  },
  {
    key: "coin",
    href: "/coin",
    kind: "room",
    source: "src/components/Coin.tsx",
    page: "src/app/coin/page.tsx",
    address: { band: "drop" },
    frame: "yield",
    chrome: "axis",
    keeps: "objetdart:coin:aventurine",
    creates: null,
    exempt: {
      tutti: "the coin is a single object, so a population-wide synchronized response has no distinct material meaning",
      dwell: "a held coin is already a continuous spin-brake; it cannot grow or plant a second coin",
      tilt: "the coin's world-space gravity is fixed by its ceremonial face, so device tilt would contradict the minted orientation",
      shake: "agitation would make the coin's deterministic spin unreadable rather than scatter a population",
      knock: "the coin has no room-door or resonant population to wake; its existing tap is the direct contact reading",
      flip: "face-down does not mean night for a two-sided medal: it is already a meaningful physical orientation of the object",
    },
  },
  {
    key: "watch",
    href: "/watch",
    kind: "room",
    source: "src/components/Watch.tsx",
    page: "src/app/watch/page.tsx",
    address: { band: "drop" },
    frame: "yield",
    chrome: "axis",
    keeps: null,
    creates: null,
    exempt: {},
  },
  {
    key: "archive",
    href: "/archive",
    kind: "reading",
    source: "src/components/Archive.tsx",
    page: "src/app/archive/page.tsx",
    address: { exempt: "a reading surface" },
    frame: "yield",
    chrome: "none",
    keeps: null,
    creates: null,
    exempt: {},
  },
  {
    key: "kept",
    href: "/kept",
    kind: "reading",
    source: null,
    page: "src/app/kept/page.tsx",
    address: { exempt: "a reading surface" },
    frame: "yield",
    chrome: "none",
    keeps: null,
    creates: null,
    exempt: {},
  },
  {
    key: "colophon",
    href: "/colophon",
    kind: "reading",
    source: "src/components/Colophon.tsx",
    page: "src/app/colophon/page.tsx",
    address: { exempt: "a reading surface" },
    frame: "yield",
    chrome: "none",
    keeps: null,
    creates: null,
    exempt: {},
  },
  {
    key: "guide",
    href: "/guide",
    kind: "reading",
    source: "src/app/guide/page.tsx",
    page: "src/app/guide/page.tsx",
    address: { exempt: "a reading surface — the one place the site explains itself" },
    frame: "yield",
    chrome: "none",
    keeps: null,
    creates: null,
    exempt: {},
  },
  // Manifest-spread rooms at the SITE_ROUTES tail — alphabetical among the
  // unplaced manifests, so the two lists stay one derivation apart.
  {
    key: "atmosphere",
    href: "/atmosphere",
    kind: "room",
    source: "src/components/AirColumn.tsx",
    page: "src/app/atmosphere/page.tsx",
    address: { band: "atmosphere" },
    frame: "yield",
    chrome: "axis",
    keeps: null,
    creates: "a lantern",
    exempt: {},
  },
  {
    key: "cabinet",
    href: "/cabinet",
    kind: "room",
    source: "src/components/HomeCabinet.tsx",
    page: "src/app/cabinet/page.tsx",
    address: {
      exempt:
        "a case holding every route at once — a view of the tree like /overlook and /loom, not a size on it",
    },
    frame: "yield",
    chrome: "none",
    keeps: "objetdart:cabinet:v2",
    creates: "an ember",
    exempt: {},
    rawPointer:
      "a pointermove parallax (the grammar's own desktop 'hover ≈ light touch' register, which has no classified-gesture equivalent) and a pointerup/pointercancel that releases the three-finger dilation; every real verb comes from attachGestures",
  },
  {
    key: "compass",
    href: "/compass",
    kind: "room",
    source: "src/components/ConcernField.tsx",
    page: "src/app/compass/page.tsx",
    address: {
      exempt:
        "it measures attention rather than metres — a lens over the visitor, readable from every band and resident in none",
    },
    frame: "yield",
    chrome: "none",
    keeps: "objetdart:state:v1",
    creates: null,
    exempt: {},
    rawPointer:
      "the founding vertex drag: each handle takes pointer capture on touchdown and tracks the pointer continuously against its own axis, which is a value scrub the engine classifies no verb for",
  },
  {
    key: "galaxy",
    href: "/galaxy",
    kind: "room",
    source: "src/components/GalaxyArms.tsx",
    page: "src/app/galaxy/page.tsx",
    address: { band: "galaxy" },
    frame: "yield",
    chrome: "axis",
    keeps: "objetdart:galaxy:v1",
    creates: "a star",
    exempt: {},
  },
  {
    key: "geyser",
    href: "/geyser",
    kind: "room",
    source: "src/components/Geyser.tsx",
    page: "src/app/geyser/page.tsx",
    address: { band: "drop" },
    frame: "yield",
    chrome: "axis",
    keeps: "objetdart:geyser:v1",
    creates: "an eruption",
    exempt: {},
  },
  {
    key: "marsh",
    href: "/marsh",
    kind: "room",
    source: "src/components/Marsh.tsx",
    page: "src/app/marsh/page.tsx",
    address: { band: "drop" },
    frame: "yield",
    chrome: "axis",
    keeps: "objetdart:marsh:v1",
    creates: "a reed",
    exempt: {},
  },
  {
    key: "orb",
    href: "/orb",
    kind: "room",
    source: "src/components/PlasmaOrb.tsx",
    page: "src/app/orb/page.tsx",
    address: { band: "drop" },
    frame: "yield",
    chrome: "axis",
    keeps: "objetdart:orb:v1",
    creates: "a disc",
    exempt: {},
  },
  {
    key: "pebble",
    href: "/pebble",
    kind: "room",
    source: "src/components/Pebble.tsx",
    page: "src/app/pebble/page.tsx",
    address: { band: "drop" },
    frame: "yield",
    chrome: "axis",
    keeps: "objetdart:pebble:v1",
    creates: "a cut",
    exempt: {},
  },
  {
    key: "planets",
    href: "/planets",
    kind: "room",
    source: "src/components/PlanetForge.tsx",
    page: "src/app/planets/page.tsx",
    address: { band: "planets" },
    frame: "yield",
    chrome: "axis",
    keeps: "objetdart:planets:v2",
    creates: "a world",
    exempt: {},
  },
  {
    key: "reef",
    href: "/reef",
    kind: "room",
    source: "src/components/Reef.tsx",
    page: "src/app/reef/page.tsx",
    address: { band: "coast" },
    frame: "yield",
    chrome: "axis",
    keeps: "objetdart:reef:v1",
    creates: "a polyp",
    exempt: {},
  },
  {
    key: "rocks",
    href: "/rocks",
    kind: "room",
    source: "src/components/RockShelf.tsx",
    page: "src/app/rocks/page.tsx",
    address: { band: "drop" },
    frame: "yield",
    chrome: "travel+peers",
    keeps: "objetdart:rocks:v1",
    creates: "a stone",
    exempt: {},
  },
  {
    key: "root",
    href: "/root",
    kind: "room",
    source: "src/components/Root.tsx",
    page: "src/app/root/page.tsx",
    address: { band: "drop" },
    frame: "yield",
    chrome: "axis",
    keeps: "objetdart:root:v1",
    creates: "a tip",
    exempt: {},
  },
  {
    key: "soil",
    href: "/soil",
    kind: "room",
    source: "src/components/SoilGround.tsx",
    page: "src/app/soil/page.tsx",
    address: { band: "drop" },
    frame: "yield",
    chrome: "axis",
    keeps: "objetdart:soil:v2",
    creates: "a root",
    exempt: {},
  },
  {
    key: "solar",
    href: "/solar",
    kind: "room",
    source: "src/components/SolarSystem.tsx",
    page: "src/app/solar/page.tsx",
    address: { band: "solar" },
    frame: "yield",
    chrome: "axis",
    keeps: "objetdart:solar:v1",
    creates: "a body",
    exempt: {},
  },
  {
    key: "spring",
    href: "/spring",
    kind: "room",
    source: "src/components/Spring.tsx",
    page: "src/app/spring/page.tsx",
    address: { band: "drop" },
    frame: "yield",
    chrome: "axis",
    keeps: "objetdart:spring:v1",
    creates: "a seep",
    exempt: {},
  },
];

export const ROOM_BY_KEY: Record<string, RoomEntry> = Object.fromEntries(
  ROOM_REGISTRY.map((r) => [r.key, r]),
);

// ———————————————————————————————————————————————————————————————————————
// Derivations — what the rest of the site reads instead of a second list
// ———————————————————————————————————————————————————————————————————————

/** Reading surfaces: omitted from the swipe gallery, lighter in the guide. */
export const READING_SURFACE_KEYS: ReadonlySet<string> = new Set(
  ROOM_REGISTRY.filter((r) => r.kind === "reading").map((r) => r.key),
);

/** Every key the field guide must document (plus "home", which has no route). */
export function guideKeys(): string[] {
  return ["home", ...ROOM_REGISTRY.map((r) => r.key)];
}

/** The band a room addresses, or null when it is a declared exemption. */
export function bandOf(entry: RoomEntry): ScaleBandId | null {
  return "band" in entry.address ? entry.address.band : null;
}

/**
 * Scale as spectral register (INSPIRATION.md §6): the audio address a room
 * inherits from its band, so a new room sounds in the right octave before
 * anyone tunes it. Null for the deliberate exemptions.
 */
export function registerOf(entry: RoomEntry): SpectralRegister | null {
  const s = entryScaleFor(entry.href);
  return s == null ? null : spectralRegisterFor(s);
}

/** Which global bindings this entry must actually implement. */
export function requiredBindings(entry: RoomEntry): GlobalBinding[] {
  if (entry.kind === "reading") return [];
  return GLOBAL_BINDINGS.filter((b) => {
    if (entry.exempt[b]) return false;
    // A yielded frame has nothing to pan (see PAN_YIELDED_REASON).
    if (b === "pan" && entry.frame === "yield") return false;
    // Two-finger tap is ScaleTravel's verb — but only where ScaleTravel is
    // actually mounted AND the room yielded the frame to it. A room that keeps
    // its own camera owes the hand the step back itself: one camera step out.
    if (b === "stepBack" && entry.frame === "yield" && entry.chrome !== "none" && entry.chrome !== "peers") {
      return false;
    }
    return true;
  });
}

/** The stated reason a binding is not required — for the report, and for humans. */
export function exemptionFor(entry: RoomEntry, b: GlobalBinding): string | null {
  if (entry.exempt[b]) return entry.exempt[b] ?? null;
  if (entry.kind === "reading") return "a declared reading surface: prose, not material";
  if (b === "pan" && entry.frame === "yield") return PAN_YIELDED_REASON;
  if (b === "stepBack" && entry.frame === "yield" && entry.chrome !== "none" && entry.chrome !== "peers") {
    return "ScaleTravel binds the two-finger tap for every room that yields it the frame";
  }
  return null;
}

// ———————————————————————————————————————————————————————————————————————
// Cross-checks — the registry is the authority; drift fails loudly
// ———————————————————————————————————————————————————————————————————————

/**
 * Every way this table can disagree with the two files that still hold a
 * second copy of a room's address (`scale.ts`, `peers.ts`). Returns human
 * sentences; empty means the manifold and the manifest agree.
 *
 * This is the guard that makes the TODO at the top of this file safe to
 * defer: while the copies exist, they cannot silently diverge.
 */
export function registryDrift(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of ROOM_REGISTRY) {
    if (seen.has(entry.key)) out.push(`${entry.key}: registered twice`);
    seen.add(entry.key);

    const declared = bandOf(entry);
    const resolved = scaleBandIdForRoute(entry.href);
    const exemptInPeers = SCALE_EXEMPT_KEY_SET.has(entry.key);

    if (declared) {
      if (resolved !== declared) {
        out.push(
          `${entry.key}: registry says band "${declared}", scale.ts resolves ${entry.href} to ` +
            `${resolved ?? "no band"} — add it to SCALE_BANDS or LATERAL_ROUTE_BANDS`,
        );
      }
      if (exemptInPeers) {
        out.push(`${entry.key}: has band "${declared}" and also sits in SCALE_EXEMPT_KEYS — pick one`);
      }
      if (!SCALE_BANDS.some((b) => b.id === declared)) {
        out.push(`${entry.key}: band "${declared}" is not in SCALE_BANDS`);
      }
    } else {
      if (!exemptInPeers) {
        out.push(
          `${entry.key}: registry declares a scale exemption ("${
            "exempt" in entry.address ? entry.address.exempt : "?"
          }") but peers.ts does not list it in SCALE_EXEMPT_KEYS`,
        );
      }
      if (resolved) {
        out.push(`${entry.key}: declared exempt but scale.ts resolves ${entry.href} to band "${resolved}"`);
      }
    }

    // Peer-circle membership implies chrome that can open the ring.
    const circle = peerCircleForRoute(entry.href);
    if (circle && entry.chrome !== "axis" && entry.chrome !== "travel+peers" && entry.chrome !== "peers") {
      out.push(
        `${entry.key}: sits in the "${circle.id}" peer circle but its page mounts no MetaNavigator ` +
          `(chrome: "${entry.chrome}") — the lateral ring is unreachable`,
      );
    }
  }
  return out;
}
