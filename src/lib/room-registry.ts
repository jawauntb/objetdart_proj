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
   * Why this material has no tap-train ladder. `gesture/core.ts` publishes the
   * rungs — 1 / 3 / 5 / n — and `scripts/test-room-liveness.mjs` requires every
   * interactive room to read `e.count` and to branch at a rung above 3, because
   * an audit found forty-six rooms where a double tap did exactly what a single
   * tap did. A sentence here says what the material cannot express at the top
   * of the ladder; silence is not an answer.
   */
  taps?: string;
  /**
   * **The force between the objects, and what a merge or reaction produces.**
   * Required of every room whose material is countable (`creates` non-null).
   *
   * This is the one property no regex can read honestly, and the one that
   * separates /stars — where a black hole consumes the star that drifts near
   * it and two holes inspiral into a third thing that is neither parent —
   * from a field of decals with a particle count. So the room states it in a
   * sentence a reviewer can falsify by playing it: which law acts between the
   * objects (gravity at astronomical scale, charge and bonding at molecular,
   * adhesion and pressure at cellular, flow and drag in fluids), and what
   * comes out when two of them meet.
   *
   * "they repel a little" is not an answer. Name the product.
   */
  interacts?: string;
  /**
   * Why a `Math.random()` call in this room is not a broken seed — an audio
   * noise buffer filled once, a DOM id. Everything rendered is a deterministic
   * function of a small state vector; that law had no test until
   * `test:room-liveness`, and twenty-six room components were rolling live.
   * The sentence is a licence for the calls it names, not for the file.
   */
  nondeterminism?: string;
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
    interacts:
      "same-kind crowding at the moment of planting: a cairn set down within reach of an " +
      "existing cairn (or a flower near a flower, a trail near a trail) is nudged clear of " +
      "every same-kind neighbour in range, summed exactly as lib/orbfield's disc separation is " +
      "— so two cairns can never stack invisibly on one spot, and a hand that keeps planting " +
      "the same kind in one place watches the cluster visibly spread out (addNatural in " +
      "Atlas.tsx). Different kinds pass through each other; nothing merges or is consumed.",
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
    nondeterminism:
      "both plant paths (the gesture dwell and the hand-tuned pointer's own long-press) now draw " +
      "a planted mark's kind, its drawing seed, and — for a trail — its whole footprint path from " +
      "a seeded hash of where and when it landed, not Math.random(); all three are persisted " +
      "(objetdart:atlas:naturals:v1), so a reload draws back the same cairn, flower or trail it " +
      "left. The 30 Math.random() calls left never reach that storage: the idle glimmer's choice " +
      "of which existing mark to highlight, a fallback id's entropy (crypto.randomUUID covers the " +
      "normal path), the four drifting cloud-shadows, and the flock/cloud/gust/sunbeam/migration/" +
      "meteor weather system (spawn parameters, which kind fires, and the two setTimeout jitters) " +
      "— ambient sky the map never remembers.",
  },
  {
    key: "city",
    href: "/city",
    kind: "room",
    source: "src/components/City.tsx",
    page: "src/app/city/page.tsx",
    address: { band: "atlas" },
    // The room owns its own perspective camera and the pinch that couples
    // zoom with pitch (bird's-eye Currier & Ives → SF/London eye-level).
    // ScaleTravel yields the pinch verb to the material here.
    frame: "own",
    chrome: "axis",
    keeps: "objetdart:city:v1",
    creates: "a plot",
    interacts:
      "plots never touch, but they compete through the population moving between them: a " +
      "dweller's need routes to the nearest matching plot (targetForNeedWithRegular in lib/city), " +
      "so two stores split the same catchment and the plot with no rival within reach keeps every " +
      "visitor who would otherwise have hesitated between them (hesitationBetween). A settlement " +
      "whose store/event plots cannot meet the demand its own homes generate loses residents to a " +
      "real leaving phase — an unmet dweller walks to the map edge and is retired from the " +
      "population — so a plot's worth is read off the traffic its neighbours leave it, not a fixed " +
      "number on the plot itself.",
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
    // The shore joined the shared naturals bus: a shell left here is the shell
    // /tide and /waves already know about. The private objetdart:coast:v1 store
    // is read once on first load and folded forward, so nothing a visitor left
    // is dropped — but it is no longer where the shore keeps anything.
    keeps: "objetdart:world:naturals:v1",
    creates: "a shell",
    exempt: {},
    interacts:
      "swash: a raised breaker (lib/coast's asymmetric run-up) drags every shell caught in its " +
      "lateral reach up the beach on the rise and back on the drain, exactly as it erodes and " +
      "redeposits the shared sand profile beneath them — the same force moves both. Heavy " +
      "redeposition from a rogue set can visibly bury a shell in the new sand; the profile's own " +
      "slow relax later uncovers it. At the shell cap the oldest washes out to the sea rather " +
      "than vanishing silently.",
    nondeterminism:
      "the 2 Math.random() calls in CoastBeach.tsx fill the shore voice's brown-noise and hiss " +
      "audio buffers once, from real entropy, at first use — neither is a shell, a sand-profile " +
      "sample, or anything else the room persists or a replay would need; they are the raw grain " +
      "an audio noise buffer needs, not a material trait.",
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
    interacts:
      "flow and drag: a raised storm swell (tier 5/n of the tap ladder) is a real crasher set " +
      "crossing the surface, and its passage carries every natural on the water a little further " +
      "along the same crossing — the swell and the naturals share one drag field, not two " +
      "unrelated animations. Breaching life (whale/pod/school/seabirds) is a deterministic cycle " +
      "read out of the same field, never a decal fixed to the tap point.",
    nondeterminism:
      "the file already carried the rule ('Deterministic 0..1 from an integer seed — never " +
      "Math.random for placement') for its own hash01, and the code now keeps it: a dwell-planted " +
      "natural's kind, and the rare beachcomber event's kind and where the tide leaves it, draw " +
      "from hash01 rather than a roll — the only two paths that reach the persisted world " +
      "(objetdart:world:v1). The 29 Math.random() calls left are weather and impact texture that " +
      "never becomes a natural: seabirds/phosphor/lightning/rogue-wave/whale spawn parameters, a " +
      "flip or shake's crasher scatter, the ambient wave-train's steady drizzle of crashers, a " +
      "breaking wave's foam-spray offsets, a lightning bolt's jagged path, and the two setTimeout " +
      "jitters that pick only when the scheduler's next tick fires.",
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
    interacts:
      "gravity: the moon and the sun are each a real tidal bulge (bodyTide), and the shore reads " +
      "their sum, never either alone — dragging one body around the sky changes the swash even if " +
      "the other never moves. A tier-5+ tap on a body forces syzygy (the other body's angle snaps " +
      "to align with it), which is what a spring tide actually is: two bulges genuinely " +
      "superposing, not a scripted 'big wave' — the surge that follows visibly floods the shore " +
      "and keeps deepening the longer the train continues.",
    nondeterminism:
      "the natural planted by a dwell — the one persisted, countable object this room creates — " +
      "now draws its kind from a seeded hash of the touch position and time, not Math.random(). " +
      "The 14 Math.random() calls left are all ambient sky weather in the same family /watch " +
      "already exempts: a shake's gust direction, and the meteor/moonhalo/fog/boat/firefly the " +
      "weather scheduler (and the tap train's top rungs) summon — none of it is persisted " +
      "(addWeather is a transient pool, never written to objetdart:world:v1) and none of it is a " +
      "force or a merge outcome, so a replay losing the exact shape of a given firefly or fog " +
      "bank changes nothing a visitor could compare. The two setTimeout jitters only pick when " +
      "the scheduler's next tick fires, never what it spawns.",
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
    interacts:
      "real superposition: every raised source and every tap injects a pulse into the same " +
      "finite-difference height field (2D wave equation), so two sources genuinely interfere — " +
      "constructive and destructive fringes are computed, not painted. A tier-3 tap on a source " +
      "splits it into two coherent emitters that beat against each other in the shared field; a " +
      "tier-5 tap scans the field for where its own wavefronts are already piling up and pours " +
      "energy in there, so the rogue wave that results is emergent from real interference, never " +
      "a scripted extra drop.",
    nondeterminism:
      "wherever a draw becomes a persisted natural (objetdart:world:v1) it is seeded, not " +
      "Math.random(): a falling leaf's rest spot and a surfacing koi's are drawn from a hash01 " +
      "stream advanced once per draw, and a raised source restored from objetdart:waves:sources:v1 " +
      "(which saves only nx/ny/strength) gets its unsaved animation phase back from a hash of its " +
      "own position rather than a fresh roll. The 21 Math.random() calls left are the pond's purely " +
      "ambient weather — the dragonfly, wind gust, frog jump and water-strider events, none of " +
      "which ever becomes a persisted natural — plus a shake's chaotic splash scatter, the sparse " +
      "ambient pluck/drop that keeps the medium from looking dead, and the two setTimeout jitters " +
      "that pick only when the weather scheduler's next tick fires.",
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
    interacts:
      "gravity, the same softened field every mass wells the fabric with: every settled mass " +
      "pulls every other one (src/lib/manifold-field.ts stepMutualGravity), orbiting and " +
      "inspiraling on its own timers whether or not a hand is present. Two masses whose centers " +
      "close inside their combined contact radius merge (mergeBodies) into a third mass that is " +
      "neither parent — mass and momentum exactly summed — landing as a bright pulse, a bell, a " +
      "haptic storm and a damped-sinusoid ringdown (ringdownEnvelope) in the same frame. A " +
      "tier-3 tap on a standing mass instead collapses it a step denser (star, neutron star, " +
      "black hole); a tier-5 tap forces the two nearest masses into an immediate inspiral",
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
    // `creates` is null (the room keeps no belongings), but the planted
    // masses still share one law: stated anyway, since a reviewer should
    // not have to infer it from src/lib/manifold-field.ts.
    interacts:
      "gravity — the same shared stepMutualGravity/mergeBodies pair /manifold uses: every " +
      "settled mass pulls every other one every frame, unattended, and two whose centers touch " +
      "merge into a third mass with the summed mass and momentum, ringing a damped-sinusoid " +
      "ringdown in sight, sound and haptics at once. A tier-3 tap collapses a standing mass a " +
      "step denser (star, neutron star, black hole); tier-5 forces the nearest two into an " +
      "immediate inspiral and merger",
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
    interacts:
      "one state vector constrains all five substrates at once (src/lib/structure.ts): tension, " +
      "coherence and reach are shared, so raising coherence audibly locks the chord AND visibly " +
      "snaps the shape's symmetry in the same frame, not two decals reading one number " +
      "separately. The crossing is the reaction: accumulated tension is SPENT — a discontinuous " +
      "redistribution into reach and coherence conserving total intensity (conservedQuantity) — " +
      "producing a state that is neither the gathering that fed it nor the agency it becomes " +
      "until the redistribution fires. A tier-3 tap carries tension to the lip of its real " +
      "threshold so the next accumulation crosses it for real; tier 5 sustains attention long " +
      "enough for the actual step() dynamics to walk latent through rest unattended",
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
    nondeterminism:
      "storm keeps nothing and creates nothing (both null above) — the room's real state is the " +
      "pressure and charge dials, and both move only from the hand, never a roll. All 35 " +
      "Math.random() calls texture the weather those dials drive: rain particle life/size, spray " +
      "and wind-streak spawn position/speed, a lightning bolt's branching path and flicker timing, " +
      "wave-crash foam scatter, and the gap before the next crash or the next bolt. None of it is " +
      "an object anything else reads back — the discharge event itself is deterministic (charge " +
      "threshold or a tap), only the bolt's exact fork pattern is drawn fresh — so there is nothing " +
      "here a replay of the pressure/charge state would need to reproduce.",
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
    nondeterminism:
      "the sky's own creations are seeded, not Math.random(): the glyph flock born at mount " +
      "(its comment already promised 'seeded at mount', which the code hadn't kept until now) and " +
      "every trait of a tapped weather cell, rain veil, or wind stroke — spread, drift, lift, " +
      "phase, rain, slant, hue — draw from a hash of that object's own id and position, so the " +
      "same run of taps grows the same weather. The 9 Math.random() calls left are geometry no " +
      "population needs back: a lightning bolt's mid-jitter fork and a strike's start/end offset " +
      "(neither lightning nor a weather cell is persisted or kept), a poked glyph's trail jitter, " +
      "and where a weather cell reappears after it drifts off the top of the sky.",
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
    interacts:
      "gravity, felt between the mountain's two populations: falling scree (src/lib/mountain.ts " +
      "screeCairnHits) strikes any standing cairn it passes near and topples it, and a toppled " +
      "cairn's own stones become a fresh scree cascade — a third thing that is neither the " +
      "falling stone nor the standing cairn, felt as a thud, a roll and a haptic in the same " +
      "frame. A tier-3 tap on a cairn topples and rebuilds it in place; on open slope it cycles " +
      "a rockfall, a small avalanche or a cloud inversion; tier-5 sends a full avalanche down " +
      "the face in bands, each guaranteed to find any cairn in its path",
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
    interacts:
      "surface tension: a tier-3 tap on a bloom bursts it into daughters, area-conserving (child " +
      "size² summed equals the parent's), thrown outward and only briefly locked from re-merging " +
      "— the population cap gives way visibly by ascending the oldest bloom into the shell rather " +
      "than dropping it silently. A tier-5 tap blooms the whole sea at once, scattering foam " +
      "across the surface under the shell's own light.",
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
    interacts:
      "light, root space, and pollen that actually travels. Shade is one-directional — only a "
      + "taller neighbour standing inside a plant's canopy takes its light, so a seedling never "
      + "shades the flower above it — and root discs share the soil by their true circle-overlap "
      + "area (lib/botany shadeFrom, rootOverlap). What is left is vigour, and vigour is what a "
      + "plant grows and blooms on, so a crowded corner visibly thins itself and frost takes the "
      + "weakest first. Grains leave an open head on the wind, or ride a pollinator working the "
      + "garden head to head, and where one lands on another open flower A SEED SETS whose genome "
      + "is half of each parent — crossLatent takes each locus from one parent or the other, "
      + "never an average, so the child is a real flower that is neither parent and its hybrid "
      + "genome is persisted. The top rung races a season the length of the garden. Unattended, "
      + "volunteers sprout, heads shed pollen, and pollinators arrive",
    creates: "a flower",
    exempt: {
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
    interacts:
      "alignment/cohesion/separation (src/lib/flock.ts): every air bird's heading is a running " +
      "average of its neighbours', drawn toward their centre and pushed off the ones crowding it " +
      "— the murmuration's shape is that force balance, not a drawn path. A predator (tier-3 " +
      "double-tap-empty, or spawned unattended on its own clock) is a real repulsion field the " +
      "same integrator applies, so the flock's swerve around it is emergent from the same three " +
      "rules, not scripted; a thermal is the same field inverted into lift plus a spiral. A tier-3 " +
      "tap on a held bird flushes it AND repels every bird nearby through the shared lure, so the " +
      "flock visibly answers one bird's fright. Meeting a perch is a reaction, not a decal: a bird " +
      "settles into a real activity (roostNearest/roostSeveral) and a flush reverses it back to " +
      "flight; tier 5 musters the whole animal into a ring that spins and collapses to a point " +
      "through the same lure/lurePull/swirl forces, a shape made of the flock's own physics",
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
    interacts:
      "adhesion and mechanical strain, in one lattice. Every cell is bonded to its neighbours by "
      + "a real rest length, and the position-based solver passes any displacement ring by ring: a "
      + "division now shoves the ring around it outward and the lattice carries that shove across "
      + "the sheet, straining bonds at the far edge — and bonds are drawn and voiced by their "
      + "strain, so the propagation is seen and heard. Past BREAK_STRAIN a bond lets go and the "
      + "chord roughens. Cells struck on the 3-rung divide AND commit one fate further along the "
      + "morphogen, so a struck cell becomes a different kind of cell and its neighbours' chord "
      + "moves with it. The top rung is gastrulation: a blastopore opens and a whole region folds "
      + "in and under, the cells that go under becoming a terminal second germ layer while the "
      + "count stays exactly what it was. The sheet divides and differentiates on its own front",
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
    interacts:
      "adhesion, signalling, competition and phagocytosis — four forces, all real. Cadherin "
      + "binding is homophilic (lib/cytology adhesionBetween), so cells of a lineage hold each "
      + "other far harder than strangers and like visibly sorts with like, junctions drawn where "
      + "two membranes hold; overlapping membranes push back. One finite supply is divided by "
      + "uptake area to the last crumb, so a crowded dish starves proportionally, the weakest dim "
      + "and are resorbed, and a nutrient bloom brings them back. A division, a meal or a tap "
      + "emits a signal that WALKS the culture — every cell it reaches answers in its own voice "
      + "and passes it on. And a cell 1.8× another's area engulfs it: what stands afterwards is "
      + "neither the eater nor the eaten (engulfSeed keeps the phagocyte's lineage nibble and "
      + "re-rolls everything above it, and it is larger by exactly the area it swallowed). "
      + "Unattended, the healthiest cell divides, the culture signals, and food drifts in",
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
    interacts:
      "the membrane budget, and traffic across it. A vesicle is not a new object in the ledger: "
      + "budding takes area OUT of its parent and fusion puts exactly that back, so the plasm's "
      + "total never moves through a whole secretory pathway (ten hand-offs leave the ledger where "
      + "it started, pinned in test-membrane). Parcels know where they are going — raw cargo to the "
      + "er, folded cargo to the golgi, mature cargo out through the rim — and each station "
      + "ADVANCES what it is handed one real step, so what leaves a golgi that was handed folded "
      + "cargo is a mature granule that is neither the vesicle that arrived nor the organ it met. "
      + "Mature parcels are released at the ghost membrane. A mitochondrion with membrane enough "
      + "divides, halving its surface rather than copying it; a smaller one fires atp and the whole "
      + "cytoplasm visibly quickens. The top rung is a metabolic cascade from the lowest voice to "
      + "the highest. Unattended, stations bud and mitochondria fire on their own seeded clocks",
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
    interacts:
      "complementarity and heat. Loose fragments drift in the nucleoplasm and find their site on "
      + "the ladder BY SEQUENCE — lib/helix bestAnnealSite scores every offset, so a probe cut "
      + "from position 5 goes to position 5 and nothing snaps to whatever is nearest on screen. "
      + "Bound, it holds only while its own hydrogen-bond ledger can stand the temperature "
      + "(annealHolds: a G·C-rich patch outlasts an A·T one of the same length), and the "
      + "three-finger heat visibly melts them off. A fragment that holds long enough is READ INTO "
      + "the template — spliceInto rewrites exactly the mismatched bases and nothing else, so what "
      + "stands afterwards is neither the strand that was there nor the patch that landed. The top "
      + "rung replicates the whole strand: the fork runs its length and a complete daughter "
      + "chromatid peels off and condenses. Unattended, primers arrive, genes are transcribed as "
      + "bubbles, and the heat spikes and melts what was bound",
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
    interacts:
      "polarity and hydrogen bonding. Every chain's dipole is computed from the groups it "
      + "actually carries (lib/organic polarity), so a pure hydrocarbon is EXACTLY indifferent "
      + "and two polar chains reach for each other with a real 1/d³ dipole force; close enough, "
      + "donors and acceptors pair and a hydrogen bond is drawn dotted between them. A bond that "
      + "holds on ends the chemistry allows LIGATES: the acid end and the amine end condense into "
      + "one chain that is neither parent (two glycines make glycylglycine, which the room then "
      + "names) and exactly one water walks off as a loose oxygen — product + water = the two "
      + "parents, atom for atom, checked in test-organic. Water run the other way hydrolyses a "
      + "peptide bond and one chain becomes two. The top rung is a polymerisation cascade down "
      + "the whole population, one join per beat. Unattended, the solvent keeps condensing new "
      + "chains and hydrolysing old ones on its own seeded clock",
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
    interacts:
      "polarity and heat, in one solution: like dissolves like, so polar and ionic molecules " +
      "lean toward each other and away from the oily ones (and a solvent shift re-sorts the " +
      "whole population without adding anything). Two that touch only react if the collision " +
      "clears the Arrhenius barrier between them — heat is literally the collision rate, and a " +
      "catalyst lowers the barrier without ever being consumed. What a reaction produces is the " +
      "curated balanced equation's real products (2H₂+O₂→2H₂O, CH₄+2O₂→CO₂+2H₂O), never a " +
      "reactant: the parents retire and new compounds condense with true stoichiometry. The " +
      "cascade fires equation after equation, feeding each round's products back in, so a " +
      "product goes on to be a reactant. Flammables catch from hot neighbours, CO₂ warms the " +
      "whole field, and the bench keeps warming and cooling on its own clock when no hand is on it",
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
    interacts:
      "charge and the electronegativity gap: approaching clouds visibly DEFORM each other " +
      "(the envelope stretches along the line between them and the charge pools on the near " +
      "side), and the force between them is read from Pauling's table — a wide gap attracts " +
      "outright, an even one barely pulls, and a noble gas keeps its distance because it has " +
      "nothing to share. Two nuclei driven together hard enough FUSE into a third element " +
      "that is neither parent (H+H→He, and the ledger pays less each step until iron refuses). " +
      "An ionised atom throws a real free electron into the room; the ion pulls it — or any " +
      "other loose one — back, and what a recombination produces is neither of them: it is " +
      "LIGHT, cascading down the element's own emission lines (hydrogen's 656 nm red). " +
      "Unattended, the ambient field keeps exciting clouds and they keep falling home",
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
    interacts:
      "the Coulomb force, made legible before it is felt: every proton pushes every other, so " +
      "two drops fight a Z_a·Z_b/r² wall the whole way in, and the barrier they are climbing is " +
      "drawn and heard rising until it goes white at the moment they are carrying enough to " +
      "cross. Two that do cross MERGE into a heavier nuclide that is neither parent; two that " +
      "do not bounce off each other's charge. Free neutrons feel no wall at all — they are drawn " +
      "in by each drop's capture cross-section and absorbed, and if the drop is fissile the " +
      "captured neutron pays more into the compound nucleus than its barrier holds and it SPLITS " +
      "AT ONCE into two fragments and two or three prompt neutrons, which go and find the next " +
      "drop: a real chain reaction, propagating. Unstable nuclides decay unattended on their own " +
      "half-life clocks, beta into a neighbour on the chart or alpha, shedding a helium nucleus " +
      "that is itself a new object in the field",
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
    interacts:
      "the colour force. Each hadron is white, so at any distance the others are invisible to " +
      "it — but inside RECONNECT_REACH the colour fields overlap, the two visibly lean into each " +
      "other as a flux tube forms between them, and a gluon crosses: the strings RE-FORM ACROSS " +
      "the pair and what parts is two hadrons neither of which is either parent, their " +
      "constituents traded (recombineSeeds, kinds preserved as a multiset so nothing ever leaves " +
      "un-white). Stretch one tube past SNAP_RATIO and it snaps into two bound things rather " +
      "than freeing a quark, ever. Five rapid taps DECONFINE the whole field into a quark-gluon " +
      "plasma where colour is not confined at all, and as it cools every quark must find partners " +
      "again — the hadrons that freeze out carry the same census and are not the ones that went " +
      "in. Unattended, the vacuum seethes on its seeded schedule and bound things radiate and drop",
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
    interacts:
      "interference and annihilation, field by field. Two ripples of the SAME field that arrive " +
      "at the same place are one wave: matter meeting its own antimatter is gone into TWO " +
      "photons back to back sharing the whole energy (never one — one could not carry off the " +
      "momentum), and two photons resolve by phase, crest on crest reinforcing into a single " +
      "brighter, higher-pitched wave and crest on trough cancelling to nothing, the energy the " +
      "cancellation cannot keep leaving as a neutrino pair that is neither parent. Different " +
      "fields pass straight through each other, which is exactly why a neutrino crosses a planet " +
      "without noticing it. Unattended, cosmic muons rain in and die mid-flight, and the vacuum " +
      "borrows enough on its own seeded clock to make a real pair that then finds its way back " +
      "together",
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
    nondeterminism:
      "fire keeps nothing and creates nothing (both null above) — there is no persisted object " +
      "for any of the 33 Math.random() calls to be a trait of. Every one is an ember's own life: " +
      "spawn position, velocity, lifespan, radius and hue, spark-fountain angle and speed, and how " +
      "many embers a gust or a log-shift throws. Embers pool and expire within a session (the " +
      "`Ember` array) and are never written to storage, so nothing downstream ever reads one back " +
      "— there is no replay for this decoration to owe reproducibility to.",
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
    exempt: {},
    // The worked example the `interacts` field exists to elicit — read this
    // one before writing yours, and read Stars.tsx before believing it.
    interacts:
      "gravity, in one field every object shares: a black hole's horizon draws nearby stars " +
      "in and consumes them (they leave the sky and stay gone, kept in consumedSeedIds); two " +
      "user black holes within reach enter an inspiral and merge into a single heavier hole, " +
      "ringing a gravitational wave across the field as they go; a planet condensed beside a " +
      "star takes an orbit around it and keeps it. Nothing here is a decal — every object is " +
      "in the same force field as every other, and the room keeps spawning and collapsing on " +
      "its own timers when no hand is on it",
    nondeterminism:
      "Math.random() left in Stars.tsx is decorative only, never what the sky is: the " +
      "crypto.randomUUID fallback for a born object's id (3 call sites, only reached when the " +
      "Crypto API is unavailable — the id is a key, not a trait); the infalling-matter mote " +
      "swirl a black hole draws once it exists (6 call sites, a visual grain around an already-" +
      "seeded hole, never a trait a merge or a replay needs); the collapsing-well spark jitter " +
      "(2 call sites, the same kind of grain); and the scheduling delay between one cosmic-" +
      "weather tick and the next (2 call sites, which decides only *when* the timer fires, " +
      "never *what* it spawns). Every call site that decides what is born, where, or whether " +
      "two black holes merge — the comet/tidal/GRB event angles, the unattended supernova's " +
      "target star and collapse roll, the weather timer's spawn position and event choice, the " +
      "merger-scan roll — now draws from `dice()`, a small counter (skyDiceRef) advanced once " +
      "per draw and hashed (hash01), so the same run of taps and elapsed intervals plays back " +
      "identically while a longer or shorter visit still never shows the same sky twice.",
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
    interacts:
      "the invariant density field itself never moves — that is the room's whole argument, a " +
      "galaxy is a measurement, not a scatter — but wanderers do: real bodies (src/lib/cosmicweb.ts " +
      "stepWanderers/mergeWanderers) with a velocity, mutually gravitating and, on contact, " +
      "coalescing into a third body with the summed mass and momentum, felt as a bell, a haptic " +
      "storm and a note in the same frame. A tier-3 tap on a lit galaxy gathers two wanderers " +
      "beside it into a small cluster; on open sky it summons a filament, a void crossing or a " +
      "converging merger in a fixed cycle; tier-5 seeds a cosmic-web-scale structure-formation " +
      "run — a burst of wanderers along real filaments that fall together and merge unattended",
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
    nondeterminism:
      "the room's real state — every defect (+1 vortex / −1 saddle), its position and charge — " +
      "is created only from a touch coordinate (spawnDefect(q, x, y)) and never rolls a die; " +
      "annihilation and splitting are read off defect positions, not chance. All 24 " +
      "Math.random() calls left are the comet field, which the room's own comment names as what " +
      "it is: streaks combed along the direction field like iron filings, respawned continuously, " +
      "counted by targetCount() and never persisted (`creates: null`, no storage key) or read back " +
      "by the field's own law. That covers particle respawn position/color-group/size/speed/life " +
      "(respawn, syncParticles), the gust-stroke scatter a shake or a three-finger drag combs into " +
      "the sky, the drum gesture's spark shower between two hands, and the audio noise buffer " +
      "filled once at first use — decoration a replay of the defect field does not need.",
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
    interacts:
      "gravity between the binary pair: the two suns orbit their shared barycenter (the waltz), " +
      "and every petal's formation radius is measured from whichever sun it belongs to, so pulling " +
      "the suns apart or together (pinch) visibly redistributes the whole ring system around the " +
      "new geometry rather than redrawing a fixed picture. A petal breaking formation on its own " +
      "clock, or a tier-5 shower of them, is that same orbital law losing its grip on one body at a " +
      "time and letting it fall outward as a meteor streak; the ring closes back over the gap it " +
      "left",
    nondeterminism:
      "the 3 Math.random() calls left in Beam.tsx are scheduling only, never what the room is: " +
      "the hiss buffer is filled once from real noise at first use (an audio noise source, not a " +
      "trait), and the two meteorNext rolls only pick how long until the next loose petal, never " +
      "which direction it takes — that draw (aRing/aAng/aDepth/aPhase/aSeed/aSun for the whole " +
      "petal formation, and each meteor's own angle and jitter) now comes from a seeded " +
      "mulberry32/hashSeed stream, so the formation is the same field every load and a given run " +
      "of meteor breaks replays the same way.",
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
    interacts:
      "stated exemption: a kept signal (KeptSignal in Signal.tsx) is a saved bookmark — prompt, " +
      "label, source, model, chip tags — of a broadcast the visitor asked the station to remember, " +
      "the same way a station preset is a memory of a dial position, not a body in a field. It " +
      "carries no position, no mass, no proximity to any other kept signal, so there is no force " +
      "for a second one to exert. A population of presets, not a population of objects.",
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
    // `creates` is null (kept filaments are a rail of positions, not a
    // whole-field population with its own LetGo), but they still act on
    // each other and it should be on record.
    interacts:
      "real magnetic reconnection between the kept filaments: a filament planted close enough " +
      "to an existing one does not sit beside it, it fuses at their midpoint into a third " +
      "filament that is neither parent, releasing a brighter flare, a bell and a haptic bloom " +
      "than either alone would ring",
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
    interacts:
      "adhesion on the membrane: a touch bloom landing near a still-fresh one does not sit " +
      "beside it, it coalesces into one compound flare (strength summed, capped) — a third " +
      "bloom that is neither strike alone, felt as a bell and a haptic bloom in the same frame. " +
      "The four channels also drive each other, not just their own trace: stress raises heart " +
      "rate and narrows breath, a held breath (span) creeps the heart, and a steady tapped or " +
      "drummed pulse entrains it away from its own autonomous rhythm",
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
    interacts:
      "stated exemption: `pinned` in Charts.tsx is typed `Snapshot | null` — the room holds at " +
      "most ONE pinned reading at a time, ever, not an array. A saved snapshot of a candle " +
      "reading, exactly like the room's own guide language calls it, not a population; there is " +
      "no second object for a force to act between.",
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
    interacts:
      "adhesion under the cutter's hand: a new facet planted within its own hit radius of an " +
      "existing one does not sit beside it, it fuses into a single deeper cut — a third facet " +
      "that is neither parent, at their midpoint, with a weight (up to 3×) that reads wider and " +
      "brighter in the shader itself, felt as a bell and a haptic bloom in the same frame the " +
      "hand lands",
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
    nondeterminism:
      "every droplet's own state — its initial microbial population, a new bead's idle-buoyancy " +
      "phase, and the idle event that spawns dust or a bacterium's division (the one idle event " +
      "that leaves permanent state) — now draws from a seeded module-level stream (dropRand01, " +
      "reseeded once at first mount), not Math.random(); the shared rand(a,b) helper used through " +
      "the file's physics now routes through the same stream. The 9 Math.random() calls left are " +
      "texture on an already-deterministic body, never a trait a merge or a replay needs: the " +
      "one-time bubbling audio noise buffer, a shake's random mode/velocity kick (agitate), the " +
      "idle-timer's own scheduling jitter (twice — when the next event fires, not what it is), the " +
      "~20s glimmer's exploratory poke angle, a three-finger drag's wander-heading jitter on the " +
      "life already inside, and the graze-triggered dart flinch's random chance.",
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
    interacts:
      "one pot, one rain, and whoever is nearest drinks. Water percolates down through the soil "
      + "as real drops and the NEAREST kernel takes each one, so two seeds planted close share a "
      + "single rain between them and both come on slower — crowding is felt as time. Uptake "
      + "saturates and softens the husk, which is the only reason a split ever comes (lib/seed "
      + "imbibe), and germination then runs in botanical order, the radicle always before the "
      + "leaves. A kernel carried all the way to a shoot SETS SEEDS: daughters with their own "
      + "seed bits, deterministic in the parent's, which drop into the same soil and immediately "
      + "start competing with it for the same water. At the cap the eldest kernel gives way "
      + "audibly. Unattended, it rains on its own seeded clock and watered seeds germinate stage "
      + "by stage with no hand present",
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
    nondeterminism:
      "Math.random() spawns ambient decoration only, never the watch's own material: candle-" +
      "flame spark jitter, gull flight paths, boat drift timing, and where a background whisper " +
      "sets down. None of it is a countable object the room persists or a physical law the tests " +
      "reach — reseeding it would trade one unnoticed jitter for another with no visible or " +
      "testable gain",
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
    interacts:
      "real coalescence: every cloud a dwell grows is a parcel with mass, position and momentum " +
      "(lib/aircolumn's Parcel), and two whose radii touch (parcelsTouch) do not sit side by side " +
      "— they merge (mergeParcels) into a third parcel at their combined mass and centre of mass, " +
      "carrying the summed momentum forward; nothing is created or lost in the meeting. A parcel " +
      "that thins past PARCEL_MIN_MASS under shear and dry entrainment (dissipationRate) " +
      "dissipates rather than lingering as a ghost. The lantern a ceremony seals is what the hand " +
      "keeps of that grown parcel; the merging happens upstream of the keeping.",
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
    interacts:
      "coalescence: an ember a dwell just finished gathering, released within reach of an " +
      "existing ember of the same current (cluster), does not stand beside it — it combines into " +
      "it, weight (brightness) summed and capped at their midpoint, exactly the way embers heaped " +
      "in a real hearth burn as one hotter light rather than two separate sparks (the release " +
      "handler in HomeCabinet.tsx). Embers lit from a different current never merge — they are " +
      "from a different room, not the same fire.",
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
    interacts:
      "propagating star formation, computed and geometric, not painted: every gas region a hand " +
      "seeds is a point on the disc's own rotation; when one ignites, its shell expands " +
      "(shellRadius) and a second, still-dark region the shell genuinely reaches (shellReaches, " +
      "lib/spiral) ignites in turn, lighting a real chain of regions across the arm rather than " +
      "each one flaring on its own private timer (propagate). The chain runs unattended once " +
      "struck — a region does not wait for a second tap to pass its fire on.",
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
    interacts:
      "one shared thermal reservoir, not independent timers: every heat mark a hand plants " +
      "bleeds its own heat on its own decay (bleedHeatMarks in lib/geyserflow), but every bit it " +
      "sheds is added into the same subsurface temperature T that drives the whole column's phase " +
      "clock — more marks, or marks placed while T is already climbing, genuinely heat the shared " +
      "reservoir faster and pull the next eruption sooner. The eruption a mark's warmth produces " +
      "belongs to the column, never to the mark that fed it.",
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
    interacts:
      "one shared oxygen field, not two unrelated meters: reeds inject O2 into their " +
      "neighbourhood scaled by height and sunlight, biofilm mats drain it scaled by mass, and " +
      "diffusion spreads the difference (advanceExact in lib/marshfield) — a mat parked near a " +
      "young reed measurably slows it, since the reed's own growth rate reads the same local O2 " +
      "the mat is starving. A tier-5/n tap forces a whole-marsh flush (flushMarsh): the field is " +
      "pulled toward saturation and every mat loses mass in the same reaction, in one frame — the " +
      "aeration that lifts every reed's pitch is what starves the mats that were feeding on the " +
      "stagnant water. A tier-3 tap on a reed forks it: a real satellite reed sprouts beside it, " +
      "inheriting a share of its height.",
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
    interacts:
      "plasma pressure and a real electrode pull: every disc pushes on any other it overlaps, " +
      "momentum-neutral and split by their own radii so a large disc shoulders a small one aside " +
      "(separate in lib/orbfield); a tier-5 tap on a disc calls the field — every other disc " +
      "genuinely accelerates toward it, dimmer with distance, plasma gathering around a live " +
      "electrode; a tier-3 tap arcs the charge to the disc's nearest standing neighbour — both " +
      "flare hard and are pushed apart in the same frame, a real discharge dyad, not a scripted " +
      "spark. No two discs fuse into a third, but none of this is decoration: every disc sits in " +
      "the same pressure-and-charge field as every other.",
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
    interacts:
      "stated exemption: /pebble is one stone, cut open — PebbleState in lib/pebblecore holds a " +
      "single lattice, a single set of growth rings, a single polish depth. A dwell deepens it, a " +
      "ceremony seals it, <LetGo> releases it; there is never a second stone in the room for a " +
      "force to act between. The 'cut' the field names is a facet of that one stone, not a member " +
      "of a population.",
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
    interacts:
      "mutual gravity, real and momentum-conserving: every world pulls every other and the star " +
      "pulls all of them (stepBodies in lib/worldforge, a softened kick-drift step), so orbits " +
      "perturb each other and total momentum is exactly conserved with no star present. Two " +
      "worlds whose bodies touch merge (mergeWorlds): mass adds, the latent genome is the mass- " +
      "weighted mean of both parents so the child visibly wears both, the heavier parent's seed " +
      "survives as the terrain lineage, and whatever the display band cannot hold comes back as " +
      "ejecta — mass scattered, never destroyed.",
    exempt: {},
  },
  {
    key: "plank",
    href: "/plank",
    kind: "room",
    source: "src/components/Plank.tsx",
    page: "src/app/plank/page.tsx",
    address: { band: "plank" },
    frame: "yield",
    chrome: "axis",
    keeps: "objetdart:plank:v1",
    creates: "a stitch of space",
    interacts:
      "adjacency and fusion, the way loop quantum gravity says space holds together: stitches " +
      "inside reach thread into the spin network that IS the room's space (weaveLinks in " +
      "lib/plank — symmetric, degree-capped, order-independent), and the foam visibly calms " +
      "where the network is dense because geometry only holds still where something weaves it. " +
      "Two loops drawn together fuse into one that is neither parent — position spin-weighted, " +
      "seed folded from both histories, spin exactly conserved (j = j₁ + j₂, pinned in " +
      "test-plank) — and past SPIN_COLLAPSE the fusion makes not a bigger loop but a pinprick " +
      "hole that consumes its own threads and evaporates in τ ∝ j³, the Hawking scaling, " +
      "giving its light back to the foam grain by grain. Unattended, the foam advects drifting " +
      "stitches into fusions on its own seeded churn, and the vacuum borrows a virtual pair " +
      "every few breaths and gives it back.",
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
    interacts:
      "real competition for space: an equal-or-larger neighbour whose footprint already " +
      "overlaps a polyp's own measurably cuts its growth rate (crowdingAt in lib/coralflow) — a " +
      "colony hemmed in by an established one grows slower than the same polyp alone on open " +
      "reef. A much larger neighbour overlapping deeply goes further and overgrows it outright " +
      "(overgrowthAt): the smaller polyp's own ceiling is pulled down below MAX_SIZE by the " +
      "dominant one, a real reaction — not a merge, but genuine overgrowth, the way real coral " +
      "colonies compete for the same patch of light and substrate.",
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
    interacts:
      "Mohs hardness, straight: dragging one stone across a neighbour it is lying against " +
      "(neighbourOf, RockShelf.tsx) runs a real scratch test — the softer one always takes the " +
      "mark, never the harder, and the groove is stone actually removed: `victim.solid` drops by " +
      "the bite and that same mass is returned into the shared brine pool, where it is available " +
      "to feed and grow crystals nucleating elsewhere on the shelf (`feed`/`drawFrom`). Equal " +
      "hardness only knocks and rings, no material lost. Abrasion between two stones is what " +
      "grows a third.",
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
    interacts:
      "every parent-child edge is a real conductance: water flows up and sugar down between " +
      "them (advanceExact in lib/rootnet), so every tip is a sink competing with its siblings on " +
      "the same finite supply from the crown — a network with more branches divides the same " +
      "flow thinner. A tip whose water starves under a knock, and everything hanging off it " +
      "downstream, is pruned in one cascade (knockSweep) — a real loser, removed, not hidden. A " +
      "tier-3 tap forks a tip into a real child that starts starved and has to earn its own share " +
      "of the flow; a tier-5/n tap races the whole frontier at once, every unsealed tip branching " +
      "together before the ledger is fast-forwarded through the surge.",
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
    interacts:
      "same kind competes, different kingdoms trade — the whole ecology in one law " +
      "(capacityOf in lib/humus): a root's growth capacity divides by the mineral its own root " +
      "neighbours are also drawing on, a fungus's by the humus its own fungal neighbours draw on, " +
      "but a root and a fungus planted near each other genuinely help each other (linkStrength, " +
      "the mycorrhizal trade bonus). Growth is rationed proportionally whenever the whole " +
      "population's demand exceeds what the pool holds (settle) — real competition biting, not " +
      "decoration — and what dies returns its biomass to litter, where the cascade starts again.",
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
    interacts:
      "mutual gravity, computed pairwise every kick: every body perturbs every other's orbit " +
      "(mutualAccelerations in lib/orbits, Newton's third law by construction), and the elements " +
      "are re-read from the perturbed state vector each step (elementsFromState) rather than " +
      "painted. Two bodies close enough to touch merge (mergedBody): mass adds, momentum is " +
      "conserved, the merged body starts from the barycentre of the collision and keeps the " +
      "heavier parent's identity — a world absorbing a wanderer is still that world. A body that " +
      "loses its angular momentum or crosses escape velocity is consumed by the sun or lost for " +
      "good, not silently clamped.",
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
    interacts:
      "one shared aquifer, not independent taps: every seep drains the same aquifer head H " +
      "into the same pool L through Darcy flux (K_SEEP · throat · (H − L)), and it is the SUM of " +
      "every live seep's throat that sets how fast the exchange runs (totalThroat in " +
      "lib/springflow) — opening a second seep wide measurably slows how fast the first one can " +
      "drain the same reservoir, and a seep widened past what the aquifer can feed empties it for " +
      "every seep at once. They share one finite head, genuinely, not a private supply each.",
    exempt: {},
  },
  {
    key: "tidepool",
    href: "/tidepool",
    kind: "room",
    source: "src/components/Tidepool.tsx",
    page: "src/app/tidepool/page.tsx",
    address: { band: "coast" },
    frame: "yield",
    chrome: "axis",
    keeps: "objetdart:tidepool:v1",
    creates: "a creature",
    interacts:
      "a real three-way food web, not three separate meters: a snail's growth rate reads the " +
      "kelp biomass within its own reach (snailGrowthRate) — it is grazing — while a kelp's rate " +
      "falls with the snail biomass grazing IT (kelpGrowthRate, GRAZE_C), and an anemone filters " +
      "biomass straight out of nearby kelp into itself (the Euler coupling in advanceExact, " +
      "lib/tidewater) — plant one shellfish beside a kelp bed and the kelp visibly slows. A tier-3 " +
      "tap reproduces the tapped creature true to its own biology — a snail lays a cluster, a " +
      "kelp frond fragments, an anemone splits by real binary fission (reproduceCreature) — and " +
      "the parent pays a third of its own biomass to fund the offspring, a real budget transfer, " +
      "not a free duplicate.",
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
