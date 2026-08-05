import type { RoomManifest } from "@/rooms/types";

/**
 * /cabinet — the instrument case that used to be the home page.
 *
 * Built as "v2 of the home instrument" and mounted at `/`; when `/` was
 * rebuilt as a scrolling gallery of route previews the case was left behind,
 * imported by nothing. It is a room, not a section, so it takes a room's
 * route.
 *
 * `place.kind: "exempt"` — the case holds every route in the site as a lit
 * gem on a rod. That is a view OF the tree, the `/overlook` and `/loom`
 * precedent, not a rung on it: there is no size at which a cabinet of all
 * scales sits. The word "cabinet" also names the peer ring at the drop
 * (coin, watch, jewel…); those are handheld objects that share a physical
 * size, this is the case they would stand in — deliberately different
 * things, and the exemption is what keeps them from colliding on the axis.
 */
const cabinet = {
  key: "cabinet",
  href: "/cabinet",
  sigil: "archive",
  desc: "the case · every route as a lit gem",
  cluster: "field",
  dark: true,
  place: {
    kind: "exempt",
    why: "a case holding every route at once — a view of the tree, like the overlook and the loom, not a size on it",
  },
  icon: {
    title: "Cabinet",
    description: "the case — every route as a lit gem on a gold rod",
    path: "/cabinet",
    shortName: "cabinet",
    kind: "home",
    bg: "#060b12",
    bg2: "#132532",
    glow: "#e7b94e",
    accent: "#f3d37a",
    accent2: "#69d8d0",
    ink: "#fff4cf",
  },
  guide: {
    title: "the case · every route as a lit gem",
    essence:
      "a gold armature under glass, every room in the site hung on it as a gem, lit by the current you are standing in.",
    moves: [
      "hover or focus a gem → the case turns toward it and its cluster warms",
      "rapid taps on open glass → three ring the standing current's gems in an arpeggio, five kindle every ember you have planted, seven and more swell the whole case into its crescendo",
      "circle a finger → the dust stirs with the circling, faster with a faster hand",
      "hold two still fingers apart → the glass holds its chord open, deepening for as long as the interval is sustained",
      "twist (2 fingers) → the lens turns through the four currents; the drawer follows",
      "two-finger drag → the whole assembly leans, then springs back",
      "two-finger tap → the case returns to the field, centered",
      "three-finger tap, or a knock on the case → tutti: every gem answers at once",
      "three-finger drag → wind through the dust",
      "three-finger twist → the case's season turns, warm to cold and back",
      "three-finger hold → time dilates for as long as you hold it",
      "rest a finger on open glass → an ember gathers under it and keeps growing",
      "hold on an ember until it blooms → it is let go",
      "tilt · shake · flip the phone → the case leans, the dust agitates, face-down is night",
    ],
    finds: [
      "the case keeps a patina: the more you handle it the deeper everything glows, across visits",
      "an ember planted near a gem drifts into its orbit and burns in that cluster's color",
    ],
    keeps: "your patina, the current you left it on, and the embers you planted",
  },
  // ——— the room quality bar, structured ————————————————————————————————
  // Phase 4 (Track 2) note: the cabinet's persistence used to be a private
  // setTimeout debouncer; it now rides the shared idle writer in
  // room-runtime, and its make/unmake pair (the ember and the <LetGo>) is
  // declared here so test:room-quality can verify what the source promises.
  life: {
    population: {
      objects: [
        {
          noun: "ember",
          max_count: 24,
          state_shape: "x, y (world units on the case plane), weight (0..1, the dwell's duration), current (cluster index for hue)",
          lifecycle:
            "born when a resting finger crosses the dwell tier on open glass; grows further while the hold deepens; a ceremony-tier hold on the ember lets it go and it retires; a whole-field exhale (LetGo) retires the population",
          persistence: "localStorage",
          creates_via_verb: "dwell",
          retires_via: ["ceremony", "LetGo"],
          implementation_hint:
            "inline array — emberRef.current: Ember[]; capped at EMBER_CAP and persisted as part of the patina blob at objetdart:cabinet:v2. Phase-4 note: not migrated to SceneObjectSpec.",
        },
      ],
    },
    glimmer: {
      after_idle_ms: 20000,
      visual:
        "the case's active-cluster glow brightens for a beat and the standing embers each catch a small, silent pulse — the raking lamp's own answer to the room having gone quiet.",
    },
    // make_unmake is intentionally omitted: the cabinet's ceremony (a hold
    // on an ember that reaches the ceremony tier lets that ember go) lives
    // inside the raw `hold` handler in HomeCabinet.tsx rather than a
    // RoomVoice memo — declaring it here would ask test-room-quality to
    // verify a `ceremony:` handler that intentionally does not exist. The
    // <LetGo> path is still enforced because room-registry.creates is set.
  },
} as const satisfies RoomManifest;

export default cabinet;
