import type { RoomManifest } from "@/rooms/types";

/**
 * /solar — the solar band (11 … 13.5 decades), between the planets below and
 * the stars above. A place, not a law: the system is a physical size, and its
 * doors are the metric neighbours (down through the planetary neighbourhood,
 * up into the vault), both carried by their own films in `TravelPassage`.
 */
const solar = {
  key: "solar",
  href: "/solar",
  sigil: "solar",
  desc: "the system assembled · kept on real time",
  cluster: "nature",
  dark: true,
  place: { kind: "band", band: "solar" },
  icon: {
    title: "Solar",
    description: "the system assembled · kept on real time",
    path: "/solar",
    shortName: "solar",
    kind: "stars",
    bg: "#06080c",
    bg2: "#1a1426",
    glow: "#c8732a",
    accent: "#f2eee6",
    accent2: "#7cac96",
    ink: "#f4efe4",
  },
  guide: {
    title: "the system assembled",
    scale: "the solar band — between the planets and the stars",
    essence:
      "a small solar system that genuinely keeps orbiting while nobody watches — real elapsed time folded into kepler's clockwork in one closed-form step — and the worlds pull on each other while you do, so orbits precess, pairs lock into whole-number ratios, and what touches merges.",
    moves: [
      "tap a world → it flares and sings its orbit; the tone's frequency is the orbital frequency, lifted whole into hearing",
      "tap the sun → it answers with a low bell and a flare of its corona",
      "tap open sky → the dust stirs and one low grain sounds",
      "drag a world → the orbit follows the hand; pulled outward the voice falls, exactly as kepler demands",
      "drag open sky → pitches the plane and sets it turning",
      "hold open sky → a world condenses under the finger: the longer the hold the heavier it is, and the drift of the finger while held is the velocity it is let go with — still, and it lands on a clean circle",
      "hold a world to the ceremony (~2.5s) → the sky gathers behind it — a grand conjunction that then shears open at each body's own rate",
      "flick a world → throws it; a hard enough throw passes escape speed and the system lets it go for good",
      "circle a finger along an orbit → traces it, carrying its body round with soft ticks",
      "two-finger tap → steps the frame back, and lowers the notation lens if it is raised",
      "three-finger tap → tutti: the whole chord at once, every interval a period ratio",
      "three-finger drag → the law: across weighs the sun and the chord retunes; down slows or hastens the epoch",
      "three-finger twist → winds the season, the sky sweeping through its year",
      "three-finger hold → time dilates, deeper the longer it is held",
      "twist two fingers → raises the notation lens: pitch as height, phase as position, eccentricity stretching each note-head, inclination leaning its stem; two-finger tap or escape lowers it",
      "patter two hands → the dust answers between them",
      "tilt → leans the ecliptic; shake → stirs the dust and jostles the wanderers; knock → the sun answers the door; face-down → night",
      "arrows → choose a world and wind the days; enter → sounds the chosen one; held enter → the conjunction; backspace → throws it",
    ],
    finds: [
      "leave and come back: the planets keep to their courses on real elapsed time — a week away lands them exactly where a week puts them",
      "the worlds pull on each other while you watch: orbits precess, a heavy one herds its neighbours, and two that touch become one",
      "when two periods fall into a small whole-number ratio a thin line ties them and each answers the other at periapsis — the resonance is audible before it is visible",
      "drag a world hard enough into the sun and its angular momentum is spent: it falls in and the sun takes it",
      "the chord is the third law made audible: read any voice's frequency back and you have its orbit",
    ],
    keeps:
      "the epoch and every element — precessed orbits, planted worlds, their weights, the sun's own weight, and the pace of the days",
  },
} as const satisfies RoomManifest;

export default solar;
