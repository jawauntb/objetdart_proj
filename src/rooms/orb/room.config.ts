import type { RoomManifest } from "@/rooms/types";

/**
 * /orb — plasma held in the hand, and countable.
 *
 * `place.kind: "peer"` in the cabinet ring at the drop, immediately after
 * `/plasma`: the same material at the same size (a globe you could pick up),
 * but where the plasma globe is one sealed sphere with filaments, this is a
 * field of loose discs you can add to and take away. Two rooms about the same
 * matter at the same scale are peers, not a pinch apart — so `ringAfter:
 * "plasma"` seats it beside the globe and `LATERAL_ROUTE_BANDS` in
 * `src/lib/scale.ts` gives it the drop's entry scale.
 */
const orb = {
  key: "orb",
  href: "/orb",
  sigil: "plasma",
  desc: "plasma discs · make them, unmake them",
  cluster: "mechanism",
  dark: true,
  place: { kind: "peer", circle: "cabinet", band: "drop", label: "the orb", ringAfter: "plasma" },
  icon: {
    title: "Orb",
    description: "plasma discs — crossing bands of light you can gather and let go",
    path: "/orb",
    shortName: "orb",
    kind: "plasma",
    bg: "#05080f",
    bg2: "#1a0e05",
    glow: "#c8732a",
    accent: "#ffb46e",
    accent2: "#6fcfe4",
    ink: "#fff2bf",
  },
  guide: {
    title: "plasma discs · make them, unmake them",
    essence:
      "loose discs of plasma drifting in the dark, each one two crossing ribbons of light inside a bloom. they push on each other and answer the hand together.",
    moves: [
      "tap a disc → it flares by exactly how hard the tap landed",
      "rest a finger on empty dark → a disc gathers under it and keeps growing while you hold",
      "hold on a disc until it blooms → it is annihilated",
      "drag → the discs lean toward the stroke",
      "twist (2 fingers) → the ribbons inside every disc turn",
      "three-finger twist → the season turns: candle, sea, flame",
      "three-finger drag → wind pushes the whole field",
      "three-finger hold → time dilates for as long as you hold it",
      "three-finger tap, or a knock → tutti: every disc pulses once",
      "shake · tilt · flip the phone → they scatter, they fall, face-down is night",
      "let the plasma go → the field empties and stays empty",
    ],
    finds: [
      "discs that drift close push each other apart, and two crowded ones burn brighter at the seam",
      "a disc held past its bloom leaves a slow ring behind where it stood",
    ],
    keeps: "every disc you gathered — where it stands, how big it grew, and which season it was born into",
  },
} as const satisfies RoomManifest;

export default orb;
