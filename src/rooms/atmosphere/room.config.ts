import type { RoomManifest } from "@/rooms/types";

/**
 * /atmosphere — the air column above the peak, and the first room declared
 * straight into a manifest rather than migrated into one.
 *
 * The ordinal decision (docs/new-room.md §1): the atmosphere band, 10^4.5 to
 * 10^5.5 m — the hundred kilometres of air the Kármán line closes, already
 * cut in `SCALE_BANDS` by docs/plans/ground-and-sky.md and waiting for this
 * page. Its doors are the metric neighbours, unoverridden, because for once
 * part-of and larger-than agree: the air stands on the peak below it and the
 * map is drawn under it. That agreement is the tell that the band was placed
 * right (`src/lib/scale.ts`), so this room adds no travel override at all.
 */
const atmosphere = {
  key: "atmosphere",
  href: "/atmosphere",
  sigil: "clouds",
  desc: "the air column, weighed in colour",
  cluster: "nature",
  dark: true,
  place: { kind: "band", band: "atmosphere" },
  icon: {
    title: "Atmosphere",
    description: "the air column, weighed in colour",
    path: "/atmosphere",
    shortName: "atmosphere",
    kind: "clouds",
    bg: "#0a1526",
    bg2: "#7f9cc0",
    glow: "#dfe9f6",
    accent: "#f3d77a",
    accent2: "#8fb5d8",
    ink: "#eef5ff",
  },
  guide: {
    title: "the air column, weighed in colour",
    scale: "the atmosphere band — between the mountain and the atlas",
    essence:
      "the hundred kilometres of air above the summit, side on and marched as a volume — the blue is the optical depth of the real barometric column, and the clouds a hand makes are parcels of that column lifted until their own vapour condenses.",
    moves: [
      "tap → a pressure ring, sounded at the pressure where it lands — deep near the ground, thin and high aloft — and a push on whatever cloud stands there",
      "press → lifts and warms the air under the finger; it condenses at its own cloud base and starts to build",
      "keep pressing → the parcel warms further, hangs its base higher, and climbs higher still; hold to the ceremony and the candle is given to the wind as a lantern, and kept",
      "drag → stirs the air at that altitude and carries the cloud you are inside; layers slide against each other but the column keeps its momentum",
      "flick → tears a cloud apart and throws the rag downwind",
      "three-finger drag → the world-law: the lapse rate up and down, the sun along its arc — every cloud answers in the same frame",
      "three-finger twist → the season: how much water this air carries, so every cloud base moves at once",
      "twist → raises the lens: isobars crowding toward the ground, the tropopause, the wind profile, the temperature and dew-point curves",
      "scrub → winds a vortex; the cloud it finds turns on its own axis",
      "drumming → gusts the air between the two places the hands alternate over",
      "three-finger tap → tutti: every cloud and lantern answers at once",
      "three-finger hold → time dilation while held",
      "tilt / shake / knock / face-down (once invited) → the vessel is wind; a shake gusts and tears, a knock rings the column from the ground up, face-down is night",
      "keyboard → enter (held) lifts and warms a parcel, backspace tears the last one, arrows walk the sun and the lapse rate, [ and ] turn the season, escape lowers the lens",
    ],
    finds: [
      "a short press makes a puff that sinks back; a long one warms the parcel past the level of free convection and it builds a tower by itself",
      "steepen the lapse rate and every cloud grows taller — an unstable column really does hold deeper convection",
      "dry the season out and every cloud base rises together, because a drier parcel has to be lifted further before it saturates",
      "two clouds that drift into each other merge, and the merged one carries exactly the mass and the spin of both",
      "leave a cloud standing in the jet and the shear tears it apart without anyone touching it",
      "walk the sun down to the horizon and the reds arrive by subtraction — the same λ⁻⁴ that keeps noon blue",
    ],
    keeps: "the lanterns you gave to the wind — they drift on their layer's wind between visits",
  },
} as const satisfies RoomManifest;

export default atmosphere;
