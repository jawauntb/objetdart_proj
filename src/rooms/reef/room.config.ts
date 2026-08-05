// object-compiler template — docs/plans/object-compiler.md M3.
// Consumes: spec.key, spec.route, spec.sigil, spec.desc, spec.cluster,
//           spec.dark, spec.home_priority, spec.placement, spec.icon (palette
//           + names), spec.guide (title/scale/essence/moves/finds/keeps).
// Deterministic — no LLM slot. Every field comes from the spec.
import type { RoomManifest } from "@/rooms/types";

/**
 * /reef — the reef — polyp, colony, cornerstone.
 *
 * See docs/new-room.md §1 — placed once, in this manifest, and derived from there.
 */
const reef = {
  key: "reef",
  href: "/reef",
  sigil: "growth",
  desc: "the colony, ringing at its cornerstones",
  cluster: "nature",
  dark: true,
  place: {
    kind: "peer",
    circle: "shore",
    band: "coast",
    label: "the reef",
    ringAfter: "aphros"
  },
  icon: {
    title: "the reef — polyp, colony, cornerstone",
    description: "the colony, ringing at its cornerstones",
    path: "/reef",
    shortName: "reef",
    kind: "growth",
    bg: "#020814",
    bg2: "#0a2432",
    glow: "#eaa87a",
    accent: "#4ea9a2",
    accent2: "#c26a52",
    ink: "#e8ede5",
  },
  guide: {
    title: "the reef — polyp, colony, cornerstone",
    scale: "the coast band — shore peer behind the foam, ahead of the coast itself: a hand's width of sunlit reef in section, where a colony of coral polyps settles the calcite frame that will hold the next generation.",
    essence:
      "a colony of coral polyps at discrete anchor points on a growing calcite substrate, each carrying a size under a shared current and a depth-based illumination. every polyp's ring IS its size, so from the pitch alone you recover how mature it is; the shallowest and lightest polyps grow fastest, but the current can shear a young recruit off the frame if you knock the reef hard enough. nothing on the shelf is created except what the sun gave from above or the current carried past.",
    moves: [
      "tap → a ripple, and the nearest polyp rings at its own pitch; small polyps ring high, cornerstones ring low, so the map is legible before it is explained",
      "dwell → recruits a new polyp at the finger, its size climbing on a logistic curve; keep pressing and the polyp matures faster toward saturation",
      "ceremony (hold to the tier) → seals the polyp as a cornerstone — kept between visits, an anchor for what settles next",
      "drag → the current lens shears, and the water column slides across the reef; polyps do not move, but the fbm-warped water reads the drag",
      "flick → throws a spat of gametes at that point — a small ring wavefront, its pitch the local illumination",
      "twist → raises the colony lens: every polyp's size as a labelled tick, the current strength, the illumination gradient, and the mean pitch as a barometer of the whole colony's maturity",
      "twist3 → turns the year through illumination; from midsummer's peak growth to midwinter's slow, the colony wintering and waking",
      "tap3 → tutti; every polyp rings at once, one chord of sizes read across the whole colony",
      "drag3 → the world-law: down is illumination (I up), across is current strength (nutrient delivery)",
      "hold3 → time dilation while held; the ledger's clock runs slow so the growth curves can be inspected",
      "scrub → agitates the water column above the reef; nutrients redistribute and the current briefly homogenizes",
      "drum (two hands alternating) → the tidal beat between two zones; feeding pulses that speed nearby polyps",
      "arrows → walk the reef cursor; enter held recruits and matures a polyp at the cursor; escape lowers the lens",
      "tilt / shake / knock / flip (once invited) → the water leans, the surface scatters, a struck reef sheds its unsealed recruits, face-down is night",
    ],
    finds: [
      "the pitch is the size, and the map is invertible — two polyps ringing the same note are the same age, no matter where they sit on the reef",
      "a colony left through summer under bright light matures its recruits from the top down; the deep polyps stay small until the current strengthens",
      "two polyps within a hand's width share a nutrient stream, so recruiting a third near them slows the pair's growth for a season",
      "a hard knock (touch-reachable secret) dislodges every unsealed polyp under a size threshold — the cornerstones stay, the young are swept back out",
      "a fortnight's absence is read off the closed-form logistic — the reef does not owe the visitor the growth they missed",
    ],
    keeps: "every polyp with its size and its ring, the current direction and strength, the illumination gradient's angle, the season the year had reached, and the hour it was last looked at.",
  },
  // The felt-bar declaration for scripts/test-room-quality.mjs — AGENTS.md
  // §"The room quality bar" items 3/5/6, round-trip-derived from spec.life
  // by the compiler (see phase-3-recompile.md for why this block ships in
  // the manifest and phase-5-<key>.md for the template synthesis).
  life: {
    population: {
      objects: [
        {
          noun: "polyp",
          max_count: 24,
          state_shape: "id, x, y, size (0..MAX_SIZE=1), sealed (bool — cornerstone), phase seed",
          lifecycle: "born under dwell (plantPolyp at size 0) → size grows on saturating logistic `MAX_SIZE * (1 - exp(-r_eff * elapsed))` while held → sealed at ceremony (size = MAX_SIZE, sealed=true, kept between visits as a cornerstone) → retires via <LetGo> (population-wide) or via knock (unsealed polyps under DISLODGE_THRESHOLD when a hard knock lands — the room's touch-reachable secret)",
          persistence: "LetGo",
          creates_via_verb: "dwell",
          retires_via: [
            "knock",
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
        "uBreath uniform (mineral bloom on the substrate `0.6 + uBreath * 0.4`)"
      ],
      behavior_at_rest: "three visible registers ride the 7s clock: the water column brightens/dims by ±14%, the Snell surface highlight rides ±15%, the calcite substrate's mineral bloom swells by ±40% — the reef is never still even between taps"
    },
    glimmer: {
      after_idle_ms: 20000,
      visual: "one polyp breathes a wider ring, alone, and nothing is said — the glimmer handler picks a polyp by `state.tau * 977 % state.polyps.length` and pushes a soft ripple through the water above it"
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
      ceremony_is: "sealing the polyp at full size — the cornerstone anchors the calcite frame, kept between visits, an anchor for what settles next"
    }
  },
} as const satisfies RoomManifest;

export default reef;
