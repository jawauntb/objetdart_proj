// object-compiler template — docs/plans/object-compiler.md M3.
// Consumes: spec.key, spec.route, spec.sigil, spec.desc, spec.cluster,
//           spec.dark, spec.home_priority, spec.placement, spec.icon (palette
//           + names), spec.guide (title/scale/essence/moves/finds/keeps).
// Deterministic — no LLM slot. Every field comes from the spec.
import type { RoomManifest } from "@/rooms/types";

/**
 * /root — the root — plant, node, edge.
 *
 * See docs/new-room.md §1 — placed once, in this manifest, and derived from there.
 */
const root = {
  key: "root",
  href: "/root",
  sigil: "growth",
  desc: "the network, hunting water in the dark",
  cluster: "nature",
  dark: true,
  place: {
    kind: "peer",
    circle: "cabinet",
    band: "drop",
    label: "the root",
    ringAfter: "pebble"
  },
  icon: {
    title: "the root — plant, node, edge",
    description: "the network, hunting water in the dark",
    path: "/root",
    shortName: "root",
    kind: "growth",
    bg: "#070504",
    bg2: "#3a2a1a",
    glow: "#dbc98a",
    accent: "#5a8b8b",
    accent2: "#c8945a",
    ink: "#efe8dc",
  },
  guide: {
    title: "the root — plant, node, edge",
    scale: "the drop band — cabinet peer behind the pebble, ahead of the coin: a hand's width of soil in section, where a directed tree of root nodes hunts water in the dark and pushes sugar down to every tip through the same edges its water climbed.",
    essence:
      "a rooted directed tree of nodes anchored under a plant crown, each node carrying a water scalar and a sugar scalar. every edge transports water up and sugar down, both in closed form; only tips grow, and only where local sugar × water is high. the tip's pitch IS its depth in the ground, so from the ringing you recover the network's reach; nothing on the shelf is created except what the sun gave from above or the aquifer lifted from below.",
    moves: [
      "tap → a ripple through the network, and the nearest tip rings at its depth; near the surface it rings high, near the bedrock it rings low, so the depth is legible before it is explained",
      "dwell → recruits a new tip at the finger, branching from the nearest existing node; its water and sugar climb toward saturation as the network delivers them",
      "ceremony (hold to the tier) → seals the tip as a mature branch point — kept between visits, an anchor the next generation grows from",
      "drag → the soil lens slides; the ground column shears past the network without moving the roots",
      "flick → throws a growth impulse at that point — a small ring wavefront up the nearest edge, its pitch the local sugar",
      "twist → raises the network lens: every tip's depth as a labelled tick, the total root length, the mean water and sugar, and the network's mean pitch",
      "twist3 → turns the year through sunlight; from midsummer's peak sugar to midwinter's slow, the roots stall and wake",
      "tap3 → tutti; every tip rings at once, one chord across the whole network",
      "drag3 → the world-law: down is soil water (aquifer lifting), across is sunlight (crown pushing sugar)",
      "hold3 → time dilation while held; the ledger's clock runs slow so the transports can be inspected",
      "scrub → agitates the soil column around the network; local water redistributes",
      "drum (two hands alternating) → a rhythmic pulse of sugar down the crown side; feeding waves that speed nearby tips",
      "arrows → walk the root cursor; enter held recruits and matures a tip at the cursor; escape lowers the lens",
      "tilt / shake / knock / flip (once invited) → the soil leans, the ground shakes, a struck root sheds its unsealed young tips, face-down is night",
    ],
    finds: [
      "the pitch is the depth, and the map is invertible — two tips ringing the same note sit at the same depth",
      "a network left through summer under bright light matures its deepest tips first; the shallow ones stay small until sugar reaches them",
      "two tips within a hand's width share the same parent's sugar stream, so recruiting a third near them slows the pair's growth",
      "a hard knock (touch-reachable secret) dislodges every unsealed tip below a water threshold — the mature branch points stay, the young are swept back",
      "a fortnight's absence is read off the closed-form transport equations — the network does not owe the visitor the growth they missed",
    ],
    keeps: "every node with its depth, water, sugar and sealed status, the tree's parent-child edges, the total sunlight and soil-water levels, the season the year had reached, and the hour it was last looked at.",
  },
  // The felt-bar declaration for scripts/test-room-quality.mjs — AGENTS.md
  // §"The room quality bar" items 3/5/6, round-trip-derived from spec.life
  // by the compiler (see phase-3-recompile.md for why this block ships in
  // the manifest and phase-5-<key>.md for the template synthesis).
  life: {
    population: {
      objects: [
        {
          noun: "tip",
          max_count: 24,
          state_shape: "id, x, y (depth), parentId (null for crown, int for child), generation, water (0..1), sugar (0..1), sealed (bool), phase seed",
          lifecycle: "born under dwell (spawnTip under nearest node) → water climbs from soil and sugar climbs from parent along closed-form transports while growing → sealed at ceremony (kept between visits as a mature branch point) → retires via <LetGo> or via knock (unsealed young tips below KNOCK_THRESHOLD)",
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
        "uBreath uniform (fragment shader — soil moisture bloom `0.86 + 0.14 * uBreath`)",
        "uBreath uniform (plant crown highlight `0.85 + 0.15 * uBreath`)",
        "uBreath uniform (root ink line breath — the network softens/hardens by ±20%)"
      ],
      behavior_at_rest: "three visible registers ride the 7s clock: the plant crown highlight brightens/dims by ±15%, the soil moisture bloom rides ±14%, the root ink-lines soften/harden by ±20%"
    },
    glimmer: {
      after_idle_ms: 20000,
      visual: "one tip breathes a wider ring, alone, and nothing is said — the glimmer handler picks a tip by `state.tau * 977 % state.nodes.length` and pushes a soft impulse"
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
      ceremony_is: "sealing the tip as a mature branch point — the anchor persists between visits and every next dwell branches from an existing sealed or unsealed node"
    }
  },
} as const satisfies RoomManifest;

export default root;
