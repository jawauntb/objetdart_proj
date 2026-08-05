// object-compiler template — docs/plans/object-compiler.md M3.
// Consumes: spec.key, spec.route, spec.sigil, spec.desc, spec.cluster,
//           spec.dark, spec.home_priority, spec.placement, spec.icon (palette
//           + names), spec.guide (title/scale/essence/moves/finds/keeps).
// Deterministic — no LLM slot. Every field comes from the spec.
import type { RoomManifest } from "@/rooms/types";

/**
 * /pebble — one stone, cut open.
 *
 * See docs/new-room.md §1 — placed once, in this manifest, and derived from there.
 */
const pebble = {
  key: "pebble",
  href: "/pebble",
  sigil: "earth",
  desc: "one stone, cut open",
  cluster: "nature",
  dark: true,
  place: {
    kind: "peer",
    circle: "cabinet",
    band: "drop",
    label: "the pebble",
    ringAfter: "geyser"
  },
  icon: {
    title: "one stone, cut open",
    description: "one stone, cut open",
    path: "/pebble",
    shortName: "pebble",
    kind: "earth",
    bg: "#040608",
    bg2: "#0f141c",
    glow: "#e9d9a6",
    accent: "#b48c5a",
    accent2: "#8ba0c0",
    ink: "#f2ecd9",
  },
  guide: {
    title: "one stone, cut open",
    scale: "the drop band — cabinet peer behind the rocks: one water-worn stone held to the light, its section facing you.",
    essence:
      "one pebble, cut open along its own cleavage plane. the interior is the lattice's growth history — concentric rings each with their own metric spacing, cleavage traces drawn as ink lines under the polish. the outer shell is the Wulff hull relaxed by abrasion: the more the water has carried it, the smoother the envelope. the sound is the lattice you can hear (kept from the tray), damped by the polish so a well-worn pebble rings shorter than a fresh crystal — the polish depth is audible.",
    moves: [
      "tap the stone → it rings its own partials, damped by its polish; a fresh crystal rings long, a polished pebble rings short",
      "tap the dark → the cabinet answers with a low grain",
      "hold on the polished shell → rubs it deeper; the polish grows and the higher partials quiet",
      "hold to the ceremony tier → the stone is polished as far as the lattice will let it; kept between visits",
      "drag → turns the stone in its section; cleavage traces sweep with the lattice, the ring lines rotating in place",
      "flick across the stone → cleaves along the nearest allowed plane; both halves keep their mass and their growth history",
      "three-finger drag → the world-law: horizontal is water-carry (down = older/smoother), vertical is lattice pressure (up = harder mineral)",
      "three-finger twist → seasons of the stream; the stone gets younger and rounder or older and more angular",
      "three-finger hold → clock slows; a season of carry can be inspected",
      "three-finger tap → tutti; every growth ring rings at once, one chord across the stone's history",
      "twist → raises the lattice lens: the reciprocal-lattice partials drawn on the section, the polish depth in mm, the cleavage indices",
      "scrub → stirs the cabinet air; the polish shine changes as the raking light angle shifts",
      "drum (two hands alternating) → drops felt taps at both points; the stone rings the ratio of their distances",
      "arrows → step between growth rings; enter → ring the current ring; held enter → polish that ring's boundary; esc → lower the lens",
      "tilt / shake / knock / flip (once invited) → the section leans, the polished surface catches a moving lamp, a knock rings the stone as a struck bell, face-down is night",
    ],
    finds: [
      "the polish is audible — a pebble carried a hundred years rings shorter than a fresh crystal of the same lattice, because the shell damps the higher partials",
      "cleavage still follows the lattice; a flick cuts along a plane the domain names, not an arbitrary line",
      "each growth ring is a chord of its own; the outer rings sound the newer accretion, the inner ring the seed",
      "a well-polished pebble can be brought back — the polish decay can be pushed back to its lattice, at the cost of the shell's mass",
      "the same mineral can be identified from the ring even under deep polish; the load-bearing map only damps, does not erase",
    ],
    keeps: "the pebble's lattice (system, centering, axial ratios), its growth-ring history, the current polish depth, and the season the stream is at.",
  },
} as const satisfies RoomManifest;

export default pebble;
