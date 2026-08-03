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
      "tap → refocuses the depth of field at that point",
      "hold → the pupil dilates toward night; release → a slow exhale ripples outward",
      "drag → a gust leans the petals",
      "pinch → pulls the two suns apart or reels them together",
      "the tempo slider and \"let night fall\" → scale the whole clock, or force night",
    ],
    finds: [
      "squeezing the two suns close enough merges them into one with a flash, and they drift back apart on their own",
      "a petal breaks formation and streaks across the sky as a meteor every so often, on its own",
    ],
    keeps: "your tempo, day/night state, and how far apart you left the suns",
  },
} as const satisfies RoomManifest;

export default beam;
