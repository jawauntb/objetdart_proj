import type { RoomManifest } from "@/rooms/types";

/**
 * /soil — a hand's width of ground, in section, at the drop band: the seat
 * behind the stones in the cabinet ring, so the two strata of the ground sit
 * next to each other on the twist, and the earth's lower door.
 *
 * The vertical doors are not the band's — they are declared per route in
 * `ROUTE_TRAVEL_OVERRIDES` (`src/lib/scale.ts`), because from the same span of
 * centimetres a drop of water sinks into the plasm and the soil crumbles into
 * cells: up to the ground it is the ground of, or the garden rooted in it;
 * down into the living plasm. Landing this room is what flips its
 * `DOOR_ROOMS` entry from an address to a room, so those doors go live.
 */
const soil = {
  key: "soil",
  href: "/soil",
  sigil: "growth",
  desc: "compost · minerals · roots",
  cluster: "nature",
  dark: true,
  homePriority: 9,
  place: { kind: "peer", circle: "cabinet", band: "drop", label: "the soil", ringAfter: "rocks" },
  icon: {
    title: "Soil",
    description: "compost · minerals · roots",
    path: "/soil",
    shortName: "soil",
    kind: "growth",
    bg: "#0a0806",
    bg2: "#1d1209",
    glow: "#c6a874",
    accent: "#8a5a30",
    accent2: "#e4d8ba",
    ink: "#efe3cc",
  },
  guide: {
    title: "compost · minerals · roots",
    scale:
      "the drop band — cabinet peer of the drop and the seed, and the ground's lower door: a hand's width of earth in section, opening up to the ground and the garden, down into the plasm",
    essence:
      "one nutrient ledger held in five pools — litter, humus, mineral, mycelium, root — where litter rots to humus, humus mineralizes, and the roots and fungi standing in the section are two of those pools rather than things drawn on top of them.",
    moves: [
      "tap the ground → lifts a handful at that depth and sounds it; the surface and the floor are different soils, and hear different",
      "tap a root or a fungus → sounds that life alone, its mass its pitch",
      "hold (dwell) → presses litter down into humus, deeper the longer it is held",
      "hold to the ceremony tier → plants a life where the finger is: up in the litter it is a fungus, down in the mineral a root. its body is taken out of the litter lying there, so a spent surface refuses",
      "drag a life up past the surface → it comes out of the ground with the hand and lands back on the litter it was made from — planting run backwards, over the same ledger",
      "flick → throws whatever the hand had hold of; over bare ground it throws a clod instead",
      "drag → rakes the ground, stirring the layering flat and setting the grains chattering",
      "scrub → turns the compost; the pile answers an octave down",
      "drum (two hands alternating) → sifts the section: the grit rings, the fines fall through",
      "three-finger drag → the weather: across is warmth, down is rain",
      "three-finger twist → turns the year through thaw, high summer, fall, frost — and the soil ages by the span it names",
      "three-finger hold → slows the room's clock while held",
      "three-finger tap → the whole ledger sounded at once",
      "two-finger twist → raises the ledger lens: the five pools as a bar, the timbre in numbers, the roots and fungi counted, and what grew while you were away",
      "arrows → move the depth cursor and sample there; held enter presses and at full charge plants; delete pulls out what is under the cursor",
      "tilt / shake / knock / flip (once invited) → lean, turn the ground over, settle the grains, or let it sleep",
      "pinch through the edge → up to the ground it is the ground of, or the garden rooted in it; down into the plasm",
      "two-finger hold to dwell → opens the cabinet peer ring toward the drop, the seed, and the other handhelds",
    ],
    finds: [
      "two roots planted within a hand's width take each other's supper, and the weaker one starves; a fungus planted beside a root feeds it and is paid back — the hypha between them is drawn only where the network actually holds one",
      "depth is the decision: a root reaches the mineral by going down, a fungus eats the litter lying on top, so the same press means a different life at a different height",
      "the sound is the ledger, not a reaction to it: litter sets the brightness, humus the damping, mineral the ring, mycelium the beat, and the mass the pitch — a rotted handful is audibly fewer voices than a fresh one",
      "nothing here is created; planting, pulling, pressing, raking and shaking only move nutrient between pools, and the total changes only when the shared coast drops something on the surface",
      "warmth doubles the rotting every ten degrees and a drowned soil goes slower than a moist one, so the sourest corner of the weather is the wet one, not the cold one",
      "the roots grew while you were away — a fortnight's absence is read off a closed-form trajectory, not replayed",
    ],
    keeps:
      "the ledger, every life standing in it and how big it has grown, the season the year had reached, and the hour it was last looked at",
  },
} as const satisfies RoomManifest;

export default soil;
