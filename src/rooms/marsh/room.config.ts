// object-compiler template — docs/plans/object-compiler.md M3.
// Consumes: spec.key, spec.route, spec.sigil, spec.desc, spec.cluster,
//           spec.dark, spec.home_priority, spec.placement, spec.icon (palette
//           + names), spec.guide (title/scale/essence/moves/finds/keeps).
// Deterministic — no LLM slot. Every field comes from the spec.
import type { RoomManifest } from "@/rooms/types";

/**
 * /marsh — the marsh — reed, biofilm, oxygen.
 *
 * See docs/new-room.md §1 — placed once, in this manifest, and derived from there.
 */
const marsh = {
  key: "marsh",
  href: "/marsh",
  sigil: "aphros",
  desc: "the wetland, breathing between reeds",
  cluster: "nature",
  dark: true,
  place: {
    kind: "peer",
    circle: "cabinet",
    band: "drop",
    label: "the marsh",
    ringAfter: "root"
  },
  icon: {
    title: "the marsh — reed, biofilm, oxygen",
    description: "the wetland, breathing between reeds",
    path: "/marsh",
    shortName: "marsh",
    kind: "aphros",
    bg: "#0a1614",
    bg2: "#153228",
    glow: "#c8dc9c",
    accent: "#5a8c78",
    accent2: "#a89050",
    ink: "#e8eee0",
  },
  guide: {
    title: "the marsh — reed, biofilm, oxygen",
    scale: "the drop band — cabinet peer behind the root, ahead of the coin: a hand's width of wetland from just above, where reed cores stand in a shallow water field and the dissolved oxygen breathes between them.",
    essence:
      "a continuous scalar field of dissolved oxygen over the water surface, with reeds that produce oxygen and biofilm mats that consume it. every closed-form advance the field diffuses laterally, reeds inject oxygen scaled by sunlight, biofilm mats sink it scaled by their mass. the load-bearing pitch is the local oxygen concentration, so from the ringing you recover the field's state; nothing on the shelf is created except what the sun gave from above or the biofilm quietly took.",
    moves: [
      "tap → a ripple through the water, and the tile at the finger rings at its local oxygen; a fresh tile rings high, a stagnant tile rings low, so the field is legible before it is explained",
      "dwell → plants a reed at the finger, its height climbing on a saturating curve; while held the reed pushes oxygen into its neighborhood",
      "ceremony (hold to the tier) → seals the reed at full height — kept between visits, a mature stand the biofilm consumes around",
      "drag → the water lens slides — the surface film shears past the reeds without moving them; the oxygen field is unchanged",
      "flick → throws an oxygen impulse at that point — a small ring wavefront through the field, its pitch the local oxygen",
      "twist → raises the marsh lens: the mean oxygen, the reed heights, the biofilm mass, and the field's mean pitch as a barometer",
      "twist3 → turns the year through sunlight; from midsummer's peak photosynthesis to midwinter's slow, the field emptying and refilling",
      "tap3 → tutti; every reed rings at once at its local oxygen, one chord across the whole field",
      "drag3 → the world-law: down is oxygen inflow (sunlight up), across is biofilm mass",
      "hold3 → time dilation while held; the diffusion clock runs slow",
      "scrub → agitates the water surface; the oxygen field redistributes toward its mean",
      "drum (two hands alternating) → wave field between the two zones; oxygen pulses back and forth",
      "arrows → walk the marsh cursor; enter held plants and matures a reed at the cursor; escape lowers the lens",
      "tilt / shake / knock / flip (once invited) → the water leans, the surface scatters, a struck marsh stirs the oxygen field, face-down is night",
    ],
    finds: [
      "the pitch is the oxygen, and the map is invertible — two tiles ringing the same note carry the same amount of dissolved oxygen",
      "a marsh left through summer under bright light overflows with oxygen; the biofilm blooms in response and pulls it back down",
      "two reeds within a hand's width share the same oxygen pool, so a third one nearby competes for the same photons",
      "a hard knock (touch-reachable secret) stirs the oxygen field — the mean stays but the local gradients dissolve, mixing every stagnant patch back into the whole",
      "a fortnight's absence is read off a closed-form diffusion — the marsh does not owe the visitor the breaths it took",
    ],
    keeps: "every reed with its height, sealed status and phase, every biofilm mat's mass, the oxygen field as a small grid, the sunlight scalar, the season the year had reached, and the hour it was last looked at.",
  },
  // The felt-bar declaration for scripts/test-room-quality.mjs — AGENTS.md
  // §"The room quality bar" items 3/5/6, round-trip-derived from spec.life
  // by the compiler (see phase-3-recompile.md for why this block ships in
  // the manifest and phase-5-<key>.md for the template synthesis).
  life: {
    population: {
      objects: [
        {
          noun: "reed",
          max_count: 20,
          state_shape: "id, x, y, height (0..1), tilt (phase-driven sway), breath phase, sealed (bool), phase seed",
          lifecycle: "born under dwell (plantReed at cursor, height 0) → height grows on saturating curve while held, injects oxygen into surrounding field → sealed at ceremony (height = MAX_HEIGHT, sealed=true, kept between visits) → retires via <LetGo> (whole marsh)",
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
        "uBreath uniform (fragment shader — water surface highlight `0.85 + 0.15 * uBreath`)",
        "uBreath uniform (biofilm mass modulation — the mats breathe by ±20%)",
        "uBreath uniform (reed tilt phase — the reeds sway on the shared clock)"
      ],
      behavior_at_rest: "three visible registers ride the 7s clock: the water surface highlight brightens/dims by ±15%, the biofilm mats swell by ±20%, the reeds sway by ±15°. Between taps the marsh is never still"
    },
    glimmer: {
      after_idle_ms: 20000,
      visual: "one reed sways wider than the others, alone, and nothing is said — the glimmer handler picks a reed by `state.tau * 977 % state.reeds.length` and pushes a soft impulse through its base"
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
      ceremony_is: "sealing the reed at full height — the mature stand persists between visits and lets the biofilm around it settle into equilibrium"
    }
  },
} as const satisfies RoomManifest;

export default marsh;
