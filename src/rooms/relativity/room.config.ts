import type { RoomManifest } from "@/rooms/types";

/**
 * /relativity — migrated to a manifest as the proof for the *exempt* path.
 * A law, not a place: it comments on every band at once, so it takes no scale
 * address and appends after the axis in the dropdown.
 */
const relativity = {
  key: "relativity",
  href: "/relativity",
  sigil: "stars",
  desc: "light keeps its own covenant",
  cluster: "mechanism",
  dark: true,
  place: {
    kind: "exempt",
    why: "a law, not a place — the covenant holds identically at every band, so it has no scale address of its own",
  },
  icon: {
    title: "Relativity",
    description: "light keeps its own covenant",
    path: "/relativity",
    shortName: "relativity",
    kind: "beyond",
    bg: "#05070c",
    bg2: "#111b30",
    glow: "#c6d8f8",
    accent: "#e7ac52",
    accent2: "#8fb5e8",
    ink: "#eaf3ff",
  },
  guide: {
    title: "light keeps its own covenant",
    essence:
      "the law of relativity taught by hand — light's fixed speed, time dilation, gravity, doppler, simultaneity, and the twin paradox, sharing one dark room.",
    moves: [
      "tap open dark → a pulse at exactly the speed of light",
      "drag a light clock → carrying it visibly slows its own tick",
      "flick a beacon → sends its twin on a journey; it returns visibly younger, sounded as a detuned chord",
      "tap the gliding car → one flash splits toward both ends, but the room's own strikes land unevenly — simultaneity, heard as a gap",
      "three-finger hold → time slows and light itself nearly stands still, so its own geometry can be seen",
    ],
    finds: [
      "harder flicks make comets glow hotter rather than move faster — effort is capped at the speed of light and turns to heat instead",
    ],
  },
} as const satisfies RoomManifest;

export default relativity;
