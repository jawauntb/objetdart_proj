import type { RoomManifest } from "@/rooms/types";

/**
 * /beam — migrated to a manifest as the proof for the *peer* path. The third
 * seat in the sky ring (stars → comb → beam), at the stars band. `ringAfter`
 * pins the seat: ring order is twist order and dropdown order both, so it
 * must never depend on module import order.
 *
 * `chrome.travel: false` — the room still owns pinch (it pulls the binary
 * suns apart), so ScaleTravel waits; MetaNavigator's lateral ring still opens.
 */
const beam = {
  key: "beam",
  href: "/beam",
  sigil: "growth",
  desc: "the eye of heaven · bokeh petals",
  cluster: "nature",
  homePriority: 10,
  place: { kind: "peer", circle: "sky", band: "stars", label: "the beam", ringAfter: "comb" },
  chrome: { travel: false },
  icon: {
    title: "Beam",
    description: "the eye of heaven — bokeh petals around binary suns",
    path: "/beam",
    shortName: "beam",
    kind: "flowers",
    bg: "#ede8db",
    bg2: "#d3bd9a",
    glow: "#e8c476",
    accent: "#a6c0dc",
    accent2: "#9a94c4",
    ink: "#40311f",
  },
  guide: {
    title: "the eye of heaven · bokeh petals",
    essence:
      "a binary pair of soft suns wearing rings of comet-petal bokeh, sweeping through a day of shifting color.",
    moves: [
      "tap → refocuses the depth of field at that point, the ripple as wide as the strike",
      "rapid taps → three send the shimmer-wind sprinting round the rings; five quicken the suns' waltz; seven and beyond blaze the whole bloom",
      "hold → the pupil keeps dilating for as long as you hold; release → an exhale as wide as the hold was long",
      "drag → a gust leans the petals; circle a finger → stirs the whole formation after your hand",
      "tap a steady beat → the room's clock entrains to your tempo and keeps it",
      "pinch → pulls the two suns apart or reels them together",
      "the tempo slider and \"let night fall\" → scale the whole clock, or force night",
    ],
    finds: [
      "squeezing the two suns close enough merges them into one with a flash, and they drift back apart on their own",
      "a steady tapped pulse becomes the room's remembered tempo — it survives a reload the way the suns' separation does",
      "a petal breaks formation and streaks across the sky as a meteor every so often, on its own",
    ],
    keeps: "your tempo, day/night state, and how far apart you left the suns",
    plain: {
      what: "this room is a pair of soft suns wearing rings of glowing petals, drifting through a day of changing light. it behaves like a great eye: tap to refocus it, hold to open it wider, and it remembers the rhythm you give it.",
      how: [
        "tap → the focus shifts to where you tapped, with a ripple as wide as the strike",
        "press and hold → the eye keeps opening for as long as you hold; let go → a long exhale",
        "drag → a gust leans the petals; circle your finger → the whole formation stirs after your hand",
        "tap a steady beat → the room learns your tempo and keeps it, even after you leave",
        "pinch → pulls the two suns apart or squeezes them together; close enough and they merge in a flash",
        "rapid taps → three send a shimmer round the rings, five quicken the suns' dance, seven wake the whole bloom",
      ],
    },
  },
  // ——— the room quality bar, structured ————————————————————————————————
  // Phase 4 (Track 2) migration: saveMemory() at every tempo/night/sep
  // change moved to a shared idle writer from room-runtime. The
  // objetdart:beam:memory blob (`{ tempo, night, sep }`) is unchanged.
  life: {
    // The manifest used to describe the meteor-glimmer without a single line
    // of source ever driving it. The wiring landed with this manifest's
    // update: every classified gesture and every vessel event bumps
    // `lastGestureRef`; after 20s of quiet the render loop chooses one petal
    // through the seeded PRNG and drives `uMeteorIdx`/`uMeteorT` into the
    // PETAL_VERT shader, which brightens that petal's trail for 1.4s. The
    // literal `20000` lives in Beam.tsx (GLIMMER_IDLE_MS) so a future drift
    // between manifest and source is a grep away.
    glimmer: {
      after_idle_ms: 20000,
      visual:
        "one petal breaks formation and streaks across the sky as a meteor (its trail brightened for 1.4s via uMeteorIdx / uMeteorT), and the two suns' bokeh softens by a hair — the eye of heaven blinks the way a quiet sky does.",
    },
    // make_unmake is intentionally omitted: beam wires its whole-field
    // clear as a `letGo` callback passed to <LetGo>, not through a
    // `useMemo<RoomVoice>` / `useRef<RoomVoice>` literal, and the room
    // has no separate ceremony act in the source shape the mechanical
    // check searches. The letgo_clears floor still holds via
    // registry.creates.
  },
} as const satisfies RoomManifest;

export default beam;
