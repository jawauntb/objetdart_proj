// object-compiler template — docs/plans/object-compiler.md M3.
// Consumes: spec.key, spec.route, spec.sigil, spec.desc, spec.cluster,
//           spec.dark, spec.home_priority, spec.placement, spec.icon (palette
//           + names), spec.guide (title/scale/essence/moves/finds/keeps).
// Deterministic — no LLM slot. Every field comes from the spec.
import type { RoomManifest } from "@/rooms/types";

/**
 * /geyser — the geyser — build, erupt, cool.
 *
 * See docs/new-room.md §1 — placed once, in this manifest, and derived from there.
 */
const geyser = {
  key: "geyser",
  href: "/geyser",
  sigil: "growth",
  desc: "the aquifer, timed and superheated",
  cluster: "nature",
  dark: true,
  place: {
    kind: "peer",
    circle: "cabinet",
    band: "drop",
    label: "the geyser",
    ringAfter: "spring"
  },
  icon: {
    title: "the geyser — build, erupt, cool",
    description: "the aquifer, timed and superheated",
    path: "/geyser",
    shortName: "geyser",
    kind: "growth",
    bg: "#050a08",
    bg2: "#241a12",
    glow: "#f0c690",
    accent: "#5aa89c",
    accent2: "#e88c4a",
    ink: "#f0efe6",
  },
  guide: {
    title: "the geyser — build, erupt, cool",
    scale: "the drop band — cabinet peer behind the spring, ahead of the coin: a hand's width of superheated ground in section, where a narrow throat fills against a hysteretic trigger and fires a ballistic column when head and temperature time each other into the red.",
    essence:
      "a two-state thermal ledger — an aquifer head H(t) under a narrow throat and a temperature T(t) in the same column — with an eruption trigger E = H·T that fires when it crosses upward and reseats only after E has fallen well below it. the room is not a fountain — it is the wait for one; a slow build hisses under the ground, the plume rides the release, the pool cools and starts again. the whole rhythm is read off the two numbers and the phase the column is in; nothing on the shelf is created except what the sky gave back or the mantle quietly poured in.",
    moves: [
      "tap → rings the throat at the local head; the pitch rises through the build and drops after the fire, so the same room sounds like two different rooms across a cycle",
      "rapid taps (1 / 3 / 5 / n) → a ring → a run of steam marches to the vent → the throat coughs a spit of droplets → from seven on the hammering shifts the trigger itself, and a near-ready geyser can be drummed over the top",
      "dwell → warms the local ground with the palm's own heat, accelerating the build; keep pressing and T climbs faster toward the trigger",
      "ceremony (hold to the tier) → releases the throat manually — a fired eruption whether the trigger was ready or not, kept as a mark of intent",
      "drag → the surface film slides while the pool cools; a shear across the plume, no change to the ledger",
      "flick → throws a bubble at that point; a small plume-of-a-plume, its pitch the head that shaped it",
      "twist → raises the cycle lens: H(t), T(t), the trigger line, time-until-next-eruption, plume height",
      "twist3 → walks the year through the thermal register; winter mutes the mantle, summer stokes it, the interval between eruptions changes with the season",
      "tap3 → tutti; every phase rings at once — the room's own beat across the whole cycle",
      "drag3 → the world-law: down is rain (recharge; H rises faster), across is warmth (mantle; T rises faster)",
      "hold3 → time dilation while held; the ledger's clock runs slow so a wait can be inspected",
      "scrub → stirs the pool from above; the pool cools faster as its surface exchanges heat with the air",
      "drum (two hands alternating) → the wave field between them times the build, and a landing hit near the trigger can push it over",
      "arrows → walk the surface cursor; enter held warms the ground at the cursor; escape lowers the lens",
      "tilt / shake / knock / flip (once invited) → the pool leans, the surface scatters, a struck ground rings the column, face-down is night — the ground glows red where the mantle is loudest",
    ],
    finds: [
      "the pitch is the head times the temperature — an eruption is the geometry meaning the room made",
      "a geyser left to itself falls into a rhythm; the interval is the mantle warmth minus the wind's chill, and the cycle keeps in the ledger's own closed form",
      "a manual ceremony is not free — it dumps head and heat that would have fed a bigger natural fire five minutes later",
      "the plume height IS Q_erupt, and Q_erupt IS the head and temperature that got dumped — three lenses on the same instant",
      "a fortnight's absence is read off a closed-form cycle counter, not replayed — the room does not owe the visitor the fires they missed",
    ],
    keeps: "the current head, the temperature, the phase the column is in, the count of eruptions ever fired, the season the year had reached, and the hour it was last looked at.",
  },
  // ——— the room quality bar, structured ————————————————————————————————
  // Round-trip-derived from Geyser.tsx + geyserflow.ts. The declared noun in
  // the spec is `eruption` (the phase-change event); the countable population
  // that actually persists is `heatMarks` (a warmed patch of ground that
  // pushes T upward). The knock verb is a touch-reachable secret: a strong
  // knock near the trigger can push a building state over into fire.
  life: {
    population: {
      objects: [
        {
          noun: "heat-mark",
          max_count: 16,
          state_shape: "id, x, y, strength (contribution to T), t0, decay time constant",
          lifecycle:
            "born under dwell (plantHeatMark, strength grows on saturating curve of e.elapsed) → contributes to T while alive → the ceremony verb calls manualErupt (fires the column whether E was ready or not, increments eruptions count) → retires by exponential decay after eruption dumps T",
          persistence: "LetGo",
          creates_via_verb: "dwell",
          retires_via: ["ceremony", "LetGo"],
          implementation_hint: "SceneObjectSpec",
        },
        {
          noun: "plume-droplet",
          max_count: 40,
          state_shape: "id, x, y, lateral velocity, vertical velocity, birth time, hue seed",
          lifecycle:
            "spawned deterministically (never Math.random) at the vent while phase === \"erupting\", scaled by Q_erupt → rides its own closed-form ballistic arc against a fixed gravity constant → fades and retires ~1.05s after birth, independent of the ledger's own much-faster watched-speed clock so the scatter is still visibly settling into \"cooling\"",
          persistence: "ephemeral",
          creates_via_verb: "(none — spawned by the erupting phase itself, not a gesture)",
          retires_via: ["decay"],
          implementation_hint: "SceneObjectSpec",
        },
      ],
    },
    breath: {
      period_seconds: 7,
      reads: ["uBreath"],
      behavior_at_rest:
        "air column brightens/dims by ±14%, surface highlight rides ±15%, the hot mineral rim swells by ±40%. Between eruptions the throat pulses gently — a gaussian ring migrating up from the mouth whose brightness is monotone in T.",
    },
    glimmer: {
      after_idle_ms: 20000,
      visual:
        "one heat mark's corona lightens for half a breath (visual only), or the throat emits a wider ring as the phase quietly builds.",
    },
    haptics_grammar: {
      tap: "ripple",     // ringHere → haptics.ripple(0.3 + weight * 0.35)
      dwell: "tap",      // plantHeatMark → haptics.tap()
      ceremony: "bloom", // manualErupt → haptics.bloom() (the touch-reachable ignition)
      flick: "chop",     // bubble thrown → haptics.chop()
      twist: "lens",     // cycle lens raise → haptics.lens()
      twist3: "detent",  // year walk detent
      tap3: "roll",      // tutti → haptics.roll()
      drum: "tap",       // beat between zones
      knock: "bloom",    // touch-reachable secret: a knock near the trigger fires (attempt.fired → haptics.bloom())
      arrows: "tap",     // keyTap
    },
    make_unmake: {
      letgo_clears_population: true,
      ceremony_is:
        "fires the throat manually (manualErupt) — a ballistic eruption whether or not the trigger E was ready, and increments the persistent eruptions count",
    },
    // Phase-7 depth: the mechanical machine has three phases (building,
    // erupting, cooling); the shader's own "dormant" is not a fourth ledger
    // state — it is the same "building" phase read at a low E, split by the
    // same continuous fraction the uState uniform carries. See
    // visualPhaseLabel() in Geyser.tsx and data/object-compiler/audits/
    // phase-8-geyser-visual.md for why that made this room easier, not
    // harder, to keep alive at rest.
    state_machine: {
      clock: {
        kind: "phase-branch closed form",
        reads_from_domain: "advanceExact (src/lib/geyserflow.ts)",
      },
      states: [
        {
          name: "dormant",
          condition: 'phase === "building" && (H·T)/(E_TRIGGER_HIGH·1.2) < 0.35',
          visible_effect: "cool register, quiet ground, no plume, no heat-shimmer, no steam",
        },
        {
          name: "building",
          condition: 'phase === "building" && the same ratio ≥ 0.35',
          visible_effect:
            "a subtle rippling heat-shimmer climbs over the ground; the vent rim, the mineral bloom and the sky warm continuously toward the hot register",
        },
        {
          name: "erupting",
          condition: 'phase === "erupting"',
          visible_effect:
            "a bright accent2 plume rides unbroken from the throat through the sky, ballistic droplets scatter off it, hot-weight pins to 1",
        },
        {
          name: "cooling",
          condition: 'phase === "cooling"',
          visible_effect:
            "the plume fades on Q_erupt's own decay, condensation beads on the rocks near the vent and fades as the ground settles back toward the next build",
        },
      ],
      transitions: [
        { from: "dormant", to: "building", on: "E climbs past the 0.35 read on the same ratio" },
        { from: "building", to: "erupting", on: "E crosses E_TRIGGER_HIGH upward, or ceremony/knock" },
        { from: "erupting", to: "cooling", on: "ERUPT_DURATION_S elapses" },
        { from: "cooling", to: "dormant", on: "E falls below E_TRIGGER_LOW — the hysteresis reseat" },
      ],
      uniform: {
        name: "uState",
        kind: "float",
        packing:
          "floor = ledger phase index (0 building / 1 erupting / 2 cooling), fract = continuous progress through it — never a discrete switch",
      },
    },
  },
} as const satisfies RoomManifest;

export default geyser;
