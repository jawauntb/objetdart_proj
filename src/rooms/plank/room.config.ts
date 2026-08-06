import type { RoomManifest } from "@/rooms/types";

/**
 * /plank — the new bottom of the scale axis, at the Planck length. The band
 * spans the thirteen empty decades between the quantum fields and the last
 * floorboard (10^-35…10^-22 m — see SCALE_BANDS in lib/scale.ts), and its
 * floor is the one wall on the axis that opens onto the manifold: below the
 * smallest length there is no smaller, only the whole. The name keeps its
 * pun on purpose — a plank is a floorboard, and this room is the floor the
 * whole world stands on.
 */
const plank = {
  key: "plank",
  href: "/plank",
  sigil: "aphros",
  desc: "the floor of the world · where space is woven",
  cluster: "field",
  dark: true,
  place: { kind: "band", band: "plank" },
  icon: {
    title: "Planck",
    description: "the floor of the world — quantum foam, and the weave that calms it",
    path: "/plank",
    shortName: "plank",
    kind: "aphros",
    bg: "#050308",
    bg2: "#140b20",
    glow: "#cfc3e8",
    accent: "#7fd4c9",
    accent2: "#c99df0",
    ink: "#e9e4f2",
  },
  guide: {
    title: "the floor of the world · where space is woven",
    scale: "the Planck length — 10⁻³⁵ m, the last floorboard; below it, only the whole",
    essence:
      "quantum foam, mother-of-pearl and restless, with nothing under it. rest a finger " +
      "and threads gather into a stitch of space — a loop of geometry that joins the " +
      "spin network which is all the space there is. where the weave grows dense the " +
      "foam calms; where it is bare the seethe never stops. press through the floor " +
      "and you arrive at the manifold: the axis is a loop, and the smallest length " +
      "opens onto the whole.",
    moves: [
      "tap → the nearest stitch rings at its spin's own pitch; bare foam answers with a borrowed pair",
      "rapid taps → three bud a satellite loop off a stitch; five send the loom-wave thread by thread through the network; seven and beyond hold the foam's breath until the manifold's grid shows through",
      "rest a finger → threads gather into a new stitch; keep holding and its spin climbs, rung by rung, each one lower-voiced — hold past the limit and the weave makes a hole of it",
      "the long solemn hold on a stitch → it collapses into a pinprick hole that evaporates in j³ time, giving its light back grain by grain",
      "drag a stitch onto another → they fuse into one loop carrying both spins joined",
      "two fingers twisting → the lens: foam, then the bare network, then the metric drawn as contours",
      "two still fingers held apart → a standing wave rings between them, deeper the wider the hands",
      "circle a finger → frame-dragging: the metric twists into a vortex and the weave orbits it",
      "three fingers → a drag is metric shear, a twist turns the vacuum's epoch, a hold slows the churn until the foam can finally be seen",
      "pinch out → up to the quanta; press through the floor → the ouroboros, out onto the manifold",
    ],
    finds: [
      "two stitches that drift together on their own will fuse unbidden — the weave composes itself while you watch",
      "a knock on the case is a knock on the underside of the floor: the whole weave jumps, and settles",
      "the vacuum borrows a pair every few breaths and gives it back; after twenty idle seconds it borrows one where your finger might rest",
    ],
    keeps: "the weave — every stitch, at the spin and the place you left it",
  },
} as const satisfies RoomManifest;

export default plank;
