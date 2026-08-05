import type { RoomManifest } from "@/rooms/types";

/**
 * /compass — the concern compass, the site's founding interaction.
 *
 * Eight concerns as radial axes, one draggable polygon. It lived as a
 * section of the old scrolling home page and was orphaned when `/` became a
 * gallery; the surface itself never stopped working, so it takes a route
 * rather than a rewrite.
 *
 * `place.kind: "exempt"` — the polygon measures attention, not metres. It is
 * the `/time` and `/instrument` precedent: a lens the visitor holds over
 * themselves, readable from any band, resident in none.
 */
const compass = {
  key: "compass",
  href: "/compass",
  sigil: "atlas",
  desc: "eight concerns · drag the points",
  cluster: "field",
  place: {
    kind: "exempt",
    why: "it measures attention rather than metres — a lens over the visitor, readable from every band and resident in none",
  },
  icon: {
    title: "Compass",
    description: "eight concerns on eight axes — the shape of your night",
    path: "/compass",
    shortName: "compass",
    kind: "compare",
    bg: "#f2eee6",
    bg2: "#dfd7c8",
    glow: "#c8732a",
    accent: "#2c4a5c",
    accent2: "#c8732a",
    ink: "#15171a",
  },
  guide: {
    title: "eight concerns · drag the points",
    essence:
      "eight concerns on eight axes, opposites facing across the rose. drag a vertex and the polygon morphs while that concern holds its own tone.",
    moves: [
      "drag a vertex → the weight moves and the concern sings while you hold it",
      "tap a vertex → it blooms by exactly how hard the tap landed",
      "rest a finger on an axis → that concern charges outward for as long as you hold it",
      "hold at the center until the ring closes → the reading is kept",
      "twist (2 fingers) → the rose turns; a different concern comes to the top",
      "three-finger twist → the polygon walks through the presets, forward or back",
      "three-finger drag → a gust redistributes the weights downwind",
      "three-finger tap, or a knock → tutti: all eight voices answer at once",
      "three-finger hold → time dilates for as long as you hold it",
      "two-finger tap → the page steps back to the top",
      "tap a preset chip → the polygon snaps; hover one first to see its ghost",
      "tilt · shake · flip the phone → the compass leans, shivers, and goes dark face-down",
    ],
    finds: [
      "tap a steady tempo anywhere on the rose and the strongest concern falls into your pulse for a while",
      "keeping the same reading twice answers gently instead of refusing",
    ],
    keeps: "your eight weights, the preset you last snapped to, and every reading you kept",
  },
  // ——— the room quality bar, structured ————————————————————————————————
  // Phase 4 (Track 2) migration: the compass's persistence goes through
  // the useField zustand store, which now uses the shared idle writer
  // from room-runtime (see `flushFieldPersist` in `src/store/field.ts`).
  // ConcernField.tsx also holds its own writer for the compass-owned
  // rose angle (a small supplementary key). The state:v1 blob shape is
  // unchanged.
  life: {
    glimmer: {
      after_idle_ms: 20000,
      visual:
        "the rose walks one vertex on the quiet clock — each of the eight concerns sounds its own voice in turn, so a long idle shows the hand that all eight are the same kind of thing.",
    },
    // make_unmake is intentionally omitted: the compass's whole-field
    // clear is the shared `<LetGo>` reachable from the axis chrome, and
    // its ceremony act (the center-hold that keeps a reading) is wired
    // in a raw `hold:` handler inside attachGestures rather than a
    // `useMemo<RoomVoice>` literal — the mechanical make_unmake_ceremony
    // check would need the memo shape it does not have.
  },
} as const satisfies RoomManifest;

export default compass;
