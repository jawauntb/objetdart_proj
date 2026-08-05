// object-compiler template — docs/plans/object-compiler.md M3.
// Consumes: spec.key, spec.route, spec.sigil, spec.desc, spec.cluster,
//           spec.dark, spec.home_priority, spec.placement, spec.icon (palette
//           + names), spec.guide (title/scale/essence/moves/finds/keeps).
// Deterministic — no LLM slot. Every field comes from the spec.
import type { RoomManifest } from "@/rooms/types";

/**
 * /tidepool — the tide pool — pocket, kept between the swells.
 *
 * See docs/new-room.md §1 — placed once, in this manifest, and derived from there.
 */
const tidepool = {
  key: "tidepool",
  href: "/tidepool",
  sigil: "aphros",
  desc: "the pocket, held between the swells",
  cluster: "nature",
  dark: true,
  place: {
    kind: "peer",
    circle: "shore",
    band: "coast",
    label: "the tide pool",
    ringAfter: "reef"
  },
  icon: {
    title: "the tide pool — pocket, kept between the swells",
    description: "the pocket, held between the swells",
    path: "/tidepool",
    shortName: "tidepool",
    kind: "aphros",
    bg: "#050f14",
    bg2: "#0f2a2b",
    glow: "#f2c07a",
    accent: "#3a8a76",
    accent2: "#b8543a",
    ink: "#ecefe6",
  },
  guide: {
    title: "the tide pool — pocket, kept between the swells",
    scale: "the coast band — shore peer behind the reef, ahead of the coast itself: a hand's width of sunlit rock pool in section, where three species of creature settle a bowl of water the ocean left behind, and the tide's thirty-three second clock rules the whole small world.",
    essence:
      "a rock pool holding three species at discrete anchor points — snails on the rim, anemones in the hollows, kelp fronds along the sunlit shelf — under a closed-form tidal water level and a state machine (low tide / high tide / storm) whose transitions the water level alone decides. every tap reads a creature at its kind; every dwell plants one at the finger and grows it on a saturating curve; every ceremony seals the creature as a keeper the room remembers between visits. the pool is what happens between the ocean and the rock — nothing in the pool was created except what the tide brought.",
    moves: [
      "tap → a ripple crosses the water surface, and the nearest creature answers at its kind: a snail rings warm, an anemone rings cool, a kelp frond shivers without pitch — the map from kind to sound is invertible and legible",
      "dwell → plants a creature at the finger, kind decided by where the finger sits (rim → snail, hollow → anemone, shelf → kelp); the biomass climbs on a saturating curve as long as the finger presses",
      "ceremony (hold to the tier) → seals the creature as a keeper — one snail per pool becomes the room's kept keeper, an anchor the pool remembers between visits",
      "drag → the current lens shears across the water column above the pool; kelp fronds bend with the drag, snails and anemones do not",
      "flick → throws a small wavefront across the pool surface — the shader reads a ripple; the creatures do not startle unless the flick is strong",
      "twist → raises the pool lens: the water level H(t) as a ticked bar, the current state (low / high / storm), each population's count and mean biomass",
      "twist3 → turns the tide clock by hand — a full 33-second cycle in one twist, so a slow twister can watch the pool empty and fill and empty again in a minute",
      "tap3 → tutti; every creature answers at once — one chord of three kinds, low warm from the snails, cool from the anemones, a shiver from the kelp",
      "drag3 → world-law: down is warmth (climate warmth ↑), across is wet (rain ↑ → the storm displacement grows)",
      "hold3 → time dilation while held; the tide clock runs slow so the ecology can be inspected between transitions",
      "scrub → agitates the pool water column; a scrubbing finger stirs the surface and every kelp frond bends toward the finger",
      "drum (two hands alternating) → the tidal beat between two zones — a feeding pulse that briefly lifts biomass in the neighborhoods of both hands",
      "arrows → walk the pool cursor along the rim / hollow / shelf; enter held plants and matures a creature at the cursor; escape lowers the lens",
      "tilt / shake / knock / flip (once invited) → the water leans, the surface scatters (every anemone curls), a struck pool startles every anemone (tentacles snap shut, snails retreat), face-down is night — the biofilm dims and the state machine cools",
    ],
    finds: [
      "the pool empties and fills every 33 seconds — a hand watching one full cycle can name every creature by how it reads the water level",
      "tap on an anemone during LOW TIDE and its tentacles curl (defensive — the anemone is exposed and the visitor's finger reads as threat)",
      "shake the vessel while touching a snail (once shake is invited) and the snail retreats into its shell — a warm bell rings and the biomass reads unchanged",
      "a breath from the candle (candle-invited) warms the water, and the biofilm on the rocks blooms visibly across the granite — a slow bright pass on the rocks",
      "a hand that dwells during HIGH TIDE near an anemone opens the anemone fully — the tentacles reach further than at low tide, and the anemone rings at its brightest",
      "the storm state raises white foam on the surface and every creature reads it — snails retreat, anemones curl, kelp thrashes; a knock during storm is a rare event the room remembers",
    ],
    keeps: "every keeper creature (snails, anemones, kelp) with kind, position, biomass, and phase; the tide clock's current τ so a returning visitor finds the pool at the right water level; the climate (warmth, wet) the world-law hand last wrote.",
  },
  // The felt-bar declaration for scripts/test-room-quality.mjs — AGENTS.md
  // §"The room quality bar" items 3/5/6, round-trip-derived from spec.life
  // by the compiler (see phase-3-recompile.md for why this block ships in
  // the manifest and phase-5-<key>.md for the template synthesis).
  life: {
    population: {
      depth_note: "three populations share the substrate; snails GRAZE the algae, anemones FILTER the algae, and the state machine READS all three — a storm curls every anemone and retreats every snail. no population is decoration; each acts on the others through the shared ledger.",
      objects: [
        {
          noun: "snail",
          max_count: 12,
          state_shape: "id, x, y, biomass (0..MAX_BIOMASS=1), retreated (bool — hides in shell), phase seed",
          lifecycle: "born under dwell along the rim (plantCreature at biomass 0) → biomass climbs on saturating logistic while held → sealed at ceremony (kept between visits as the pool's keeper snail) → retires via <LetGo> (population-wide) or via knockSweep (unsealed snails retreat but stay; only LetGo removes)",
          persistence: "LetGo",
          creates_via_verb: "dwell",
          retires_via: [
            "LetGo"
          ],
          implementation_hint: "SceneObjectSpec"
        },
        {
          noun: "anemone",
          max_count: 8,
          state_shape: "id, x, y, biomass (0..MAX_BIOMASS=1), curl (0=open .. 1=fully closed), phase seed, sealed",
          lifecycle: "born under ceremony (a hollow accepts an anemone only via ceremonial planting — the room's solemn plant) → biomass climbs on the tick as filtering from algae feeds it → curl responds to the state machine (storm → curl=1, low tide → curl=0.5, high tide → curl=0) → retires via <LetGo> only",
          persistence: "LetGo",
          creates_via_verb: "ceremony",
          retires_via: [
            "LetGo"
          ],
          implementation_hint: "SceneObjectSpec"
        },
        {
          noun: "kelp",
          max_count: 10,
          state_shape: "id, x, y, biomass (0..MAX_BIOMASS=1), bendPhase (drag deflection), phase seed",
          lifecycle: "born by seed-scatter on the shelf when the visitor first arrives (initState scatters KELP_INITIAL kelp fronds along the sunlit shelf, deterministic from seedKey) → biomass grows on the tick under high illumination → bends under drag on the shared current axis → retires via <LetGo> only (kelp is ambient — not a keeper species)",
          persistence: "LetGo",
          creates_via_verb: "dwell",
          retires_via: [
            "LetGo"
          ],
          implementation_hint: "SceneObjectSpec"
        }
      ]
    },
    breath: {
      period_seconds: 7,
      reads: [
        "uBreath uniform (fragment shader — water column brightens `0.86 + 0.14 * uBreath`)",
        "uBreath uniform (Snell surface highlight `0.85 + 0.15 * uBreath`)",
        "uBreath uniform (biofilm bloom on the rock `0.6 + uBreath * 0.4`)",
        "uBreath uniform (creature corona `0.5 + uBreath * 0.5`)"
      ],
      behavior_at_rest: "four visible registers ride the 7s clock — the water column brightens ±14%, the Snell highlight rides ±15%, the biofilm bloom on the granite swells ±40%, and every creature's corona breathes ±50% — over the top of the slower 33s tide cycle so the pool is never still"
    },
    glimmer: {
      after_idle_ms: 20000,
      visual: "one creature (chosen by `state.tau * 1013 % state.count`) breathes a wider ring, alone, and nothing is said — the glimmer handler dispatches on kind: a snail retreats and returns in one breath, an anemone opens one tentacle wider, a kelp frond bends and returns"
    },
    haptics_grammar: {
      tap: "ripple",
      dwell: "tap",
      ceremony: "bloom",
      flick: "chop",
      twist: "lens",
      twist3: "detent",
      tap3: "roll",
      scrub: "tap",
      drum: "tap",
      knock: "detent",
      arrows: "tap"
    },
    make_unmake: {
      letgo_clears_population: true,
      ceremony_is: "planting an anemone in a hollow — the room's one solemn act, and the only way an anemone arrives; snails and kelp arrive under ordinary dwell, but anemones require the ceremony because they anchor for years once placed"
    },
    // Phase-7 depth blocks — the density axes phase 6 named as the gap
    // between compiler rooms and hand-authored deep references. Each is
    // a promise the source keeps: the shader has ≥5 `// layer:` labels,
    // the source has ≥5 state-guarded branches, every state name below
    // appears as a string literal in Tidepool.tsx or tidewater.ts.
    shader_layers: [
      {
        name: "tidal_water_level",
        order: 1,
        register: "background",
        visible_change: "the waterline rides H(t) — a 33s sine plus a storm displacement — and the sky/water split moves with it",
        reads: ["uTide", "uState"],
      },
      {
        name: "sunlit_surface",
        order: 2,
        register: "incident_light",
        visible_change: "a Snell highlight tracks the moving waterline, and caustics ripple across the sunlit shelf; warmth shifts the highlight color from cool at low warmth to golden at high",
        reads: ["uBreath", "uClimate", "uTide", "uState"],
      },
      {
        name: "rock_and_biofilm",
        order: 3,
        register: "midground",
        visible_change: "the granite rim and shelf are painted by value-noise FBM; the biofilm scalar modulates a warm bloom across the rock, brighter after a candle-warmed pool",
        reads: ["uBiofilm", "uBreath"],
      },
      {
        name: "creature_silhouettes",
        order: 4,
        register: "particulate",
        visible_change: "each creature draws through the shared instanced pass; an anemone's curl collapses its silhouette to a knot, a kelp frond bends toward uCurrent, a snail retreat reads its own flag",
        reads: ["uState", "uCurrent"],
      },
      {
        name: "sky_reflection",
        order: 5,
        register: "ink",
        visible_change: "above the waterline: a shallow sky whose color reads uNight and whose reflection ghosts onto the pool surface only during LOW TIDE",
        reads: ["uNight", "uState"],
      },
    ],
    discoverables: [
      {
        name: "anemone_curls_on_tap_at_low_tide",
        trigger: "tap on an anemone while currentState === 'low_tide'",
        reward: "the anemone's tentacles curl fully (curl = 1); a defensive chop haptic fires; the anemone's ring pitch drops by an octave",
        reads_state: ["low_tide"],
        verb: "tap",
      },
      {
        name: "snail_retreats_on_shake",
        trigger: "shake the vessel (invited) while touching a snail",
        reward: "the snail's retreated flag flips true for 3 seconds; a warm bell rings; the biomass is unchanged — retreat is a pose, not a loss",
        reads_state: ["any"],
        verb: "shake",
      },
      {
        name: "breath_warms_water_biofilm_blooms",
        trigger: "the candle invitation lands and the visitor breathes on the pool",
        reward: "the biofilm scalar climbs by 0.35; a slow warm pass moves across the granite; the state may transition from cold-water low_tide to a warmed-water low_tide with visibly brighter biofilm",
        reads_state: ["low_tide", "high_tide"],
        verb: "breath",
      },
      {
        name: "dwell_opens_anemone_at_high_tide",
        trigger: "dwell near an anemone while currentState === 'high_tide' for ≥ 1.5 seconds",
        reward: "the anemone opens fully (curl = 0), tentacles reach 30% farther than at any other state, and the anemone rings at its brightest pitch",
        reads_state: ["high_tide"],
        verb: "dwell",
      },
      {
        name: "storm_leaves_a_mark",
        trigger: "a knock during currentState === 'storm'",
        reward: "every anemone snaps shut, every snail retreats, foam appears on the surface, and the room persists a stormKnockCount — a returning visitor sees the pool remembers the storm",
        reads_state: ["storm"],
        verb: "knock",
      },
    ],
    state_machine: {
      clock: {
        kind: "real",
        period_seconds: 33,
        reads_from_domain: "waterLevel(t, climate) = H_MEAN + H_AMP · sin(2π·t/TIDE_PERIOD_S) + stormDisplacement(climate.wet)",
      },
      states: [
        {
          name: "low_tide",
          condition: "waterLevel(t) < H_MEAN - H_AMP·0.35",
          visible_effect: "water level low; anemones exposed above the waterline (curl relaxes to 0.5); snails visible; kelp fronds hang limp; biofilm reads brightly on the rocks",
        },
        {
          name: "high_tide",
          condition: "waterLevel(t) > H_MEAN + H_AMP·0.35",
          visible_effect: "water level high; anemones fully submerged (curl relaxes to 0, wide open); snails covered; kelp fronds float upward; caustics dance across the whole floor",
        },
        {
          name: "mid_tide",
          condition: "waterLevel(t) within ±STATE_BAND of H_MEAN",
          visible_effect: "water at the mean line; the shader crossfades between the two extremes; creatures relax to their between poses",
        },
        {
          name: "storm",
          condition: "climate.wet > STORM_THRESHOLD (0.85)",
          visible_effect: "the mean level lifts, chop appears on the surface, foam builds along the rim, every creature reads it — anemones curl to 1, snails retreat, kelp thrashes; the biofilm reads dimmer under the churn",
        },
      ],
      transitions: [
        { from: "low_tide", to: "high_tide", on: "waterLevel crossing zero on the way up" },
        { from: "high_tide", to: "low_tide", on: "waterLevel crossing zero on the way down" },
        { from: "mid_tide", to: "any", on: "waterLevel crossing the state band" },
        { from: "any", to: "storm", on: "climate.wet crossing STORM_THRESHOLD" },
        { from: "storm", to: "mid_tide", on: "climate.wet falling below STORM_THRESHOLD" },
      ],
      uniform: {
        name: "uState",
        kind: "vec4",
        packing: "x = low_tide weight, y = high_tide weight, z = mid_tide weight, w = storm weight; sums to 1; crossfades smoothly",
      },
    },
  },
} as const satisfies RoomManifest;

export default tidepool;
