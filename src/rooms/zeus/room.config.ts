import type { RoomManifest } from "@/rooms/types";

/**
 * /zeus — the charged sky, held as the god who surveys the whole world.
 *
 * See docs/new-room.md §1 — placed once, in this manifest, and derived from
 * there. The peak ring already holds the mountain, the cloud floor and the
 * storm-as-weather; this is the fourth seat, the same sky as governance —
 * the register the ring's own names (olympus, aphros) have pointed at all
 * along. The scene has moved from one peak to the cosmos: the visitor's
 * gaze IS the god's gaze, and the earth sits small in the corner.
 */
const zeus = {
  key: "zeus",
  href: "/zeus",
  sigil: "storm",
  desc: "the sky-father · the bolt arcs across the cosmos to the earth",
  cluster: "nature",
  dark: true,
  place: {
    kind: "peer",
    circle: "peak",
    band: "olympus",
    label: "zeus",
    ringAfter: "storm",
  },
  icon: {
    title: "zeus — the bolt arcs across the cosmos to the earth",
    description: "the sky-father · cosmic thunderheads court, merge, and spend themselves across space onto the small world",
    path: "/zeus",
    shortName: "zeus",
    kind: "storm",
    bg: "#05070f",
    bg2: "#1c1533",
    glow: "#f5ecc9",
    accent: "#8f7bff",
    accent2: "#e3c66b",
    ink: "#e9e6f4",
  },
  guide: {
    title: "zeus — the bolt arcs across the cosmos to the earth",
    scale: "the olympus band — the peak ring's fourth seat, behind the storm: the same charged sky /storm holds as weather, held here as governance. the scene is the god's own gaze, and the earth sits small in the corner.",
    essence:
      "a court of cosmic thunderheads adrift in deep space above the earth — each house carries charge and a water column, courts its neighbors by induction, and merges on contact into a greater house that is neither parent. the ceremony spends a house in one bolt across the cosmos to the world, and the earth glows warm where the god's touch lands. the thunder still rings, and the pitch alone tells you what the bolt spent.",
    moves: [
      "tap → sheet lightning inside the nearest house, as bright as the hand landed",
      "rapid taps (1 / 3 / 5 / n) → a flicker → the tapped house calves a satellite, paying real charge for it → the two nearest houses are summoned into one → the peal: every house strikes in nearest-first order, each bolt its own pitch",
      "dwell → a thunderhead gathers under the finger; keep holding and both its stores deepen — more charge, a taller column",
      "ceremony (hold to the tier) → the bolt: the held house spends everything in one strike across the cosmos to the earth, and the world glows warm where he touched it — the solemn act is also the letting-go of one house",
      "drag → shepherds a house across the cosmos; the court's own induction resumes when the hand lifts",
      "twist → the lens: the sky turns toward its chart — isolines rise while the twist lives",
      "twist3 → turns the year; the deep cosmos leans in tint",
      "tap3 → tutti; sheet lightning in every house at once",
      "drag3 → wind; the whole court drifts with the weather the fingers drew",
      "hold3 → time dilation; the courtship and the peal both slow while held",
      "tilt → the court leans with the vessel's own gravity",
      "shake → friction across the sky: every house gains charge and flickers",
      "knock → the houses startle and answer with a local flash",
      "flip face-down → night; the cosmos goes quiet until it is faced again",
      "arrows / enter → walk the sky and gather a house at the cursor; escape lowers the lens",
    ],
    finds: [
      "the thunder is invertible — the pitch of a strike is exactly its energy, so two bolts that ring the same spent the same",
      "a union conserves: the merged house carries exactly the charge and water its parents brought, and stands nearer the one that brought more",
      "left alone, a charged court closes on itself — induction pulls the houses together until they merge without any hand",
      "the peal walks nearest-first from wherever the hand named, so where you stand in the cosmos changes the order the verdict falls",
      "the earth is very small; the god's bolts are vast; a strike that reaches it is a proportionality the room asks the eye to hold",
    ],
    keeps: "every standing house with its charge and its water column; a spent house is spent between visits too.",
  },
  // The felt-bar declaration for scripts/test-room-quality.mjs — AGENTS.md
  // §"The room quality bar" items 3/5/6. The code answers each line the
  // manifest names: uBreath rides the three visible cosmic registers, the
  // peal and every strike land in the hand, the population rides the shared
  // scene-model, and the ceremony is the bolt across the cosmos to the earth.
  life: {
    population: {
      objects: [
        {
          noun: "thunderhead",
          max_count: 12,
          state_shape: "id, nx, ny (position in the cosmos above the earth), charge (0..2, the store a bolt spends), water (0..1.5, the column that conducts), flicker (0..1.4, sheet lightning inside the anvil), vx/vy (velocity from induction and wind), drift (own slow orbit), phase seed",
          lifecycle: "born under dwell (or seeded on first visit) → grows on saturating logistic while held → courts every other house by induction (attraction) → merges on contact into a greater house that is neither parent (mergeCells conserves both stores) → spends everything in one bolt across the cosmos to the earth when the ceremony fires (presence → 0.999, the house leaves the cosmos it lit) → retires via <LetGo>",
          persistence: "LetGo",
          creates_via_verb: "dwell",
          retires_via: [
            "ceremony",
            "LetGo"
          ],
          implementation_hint: "SceneObjectSpec"
        }
      ]
    },
    breath: {
      period_seconds: 7,
      reads: [
        "uBreath uniform (fragment shader — the seeded stars breathe `0.5 + 0.35 * uBreath` against the near-black cosmos, and the tint drifts `0.5 + 0.5 * uBreath` so an empty sky is never still)",
        "uBreath uniform (cosmic dust across the frame rides `0.55 + 0.45 * uBreath` — the charge that gathers in space visibly holds its breath)",
        "uBreath uniform (the earth's atmosphere rim breathes `0.85 + 0.15 * uBreath` so the world's air is legible between strikes)"
      ],
      behavior_at_rest: "three visible registers ride the 7s clock: the star field brightens/dims by ±35% and its tint drifts, the cosmic dust swells by ±45%, and the earth's atmosphere rim breathes ±15% — a viewer watching an empty cosmos still sees it live; the frame also flashes softly every 6-14s after ~15s of stillness, with a low delayed peal, so the sky reminds you it is there."
    },
    glimmer: {
      after_idle_ms: 15000,
      visual: "the eldest standing house murmurs once with a wider sheet-lightning flicker; separately, distant flashes appear across the cosmos and a low delayed rumble arrives from beyond the frame — the sky answers itself"
    },
    haptics_grammar: {
      tap: "ripple",
      dwell: "tap",
      ceremony: "storm",
      twist: "lens",
      tap3: "roll",
      knock: "detent",
      shake: "chop"
    },
    make_unmake: {
      letgo_clears_population: true,
      ceremony_is: "the bolt across the cosmos to the earth — the held house spends everything in one strike and leaves the sky, and the world glows warm where he touched it"
    }
  },
} as const satisfies RoomManifest;

export default zeus;
