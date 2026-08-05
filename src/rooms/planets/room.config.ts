import type { RoomManifest } from "@/rooms/types";

/**
 * /planets — the forge, primary resident of the `planets` band (9–11 on the
 * axis: the sun at 1.4e9 m, Mercury's orbit at 5.8e10). It sits between the
 * ground below and the system above, and it is the room where the album's
 * "a point in the latent IS a species" law is finally applied to worlds.
 *
 * `chrome.travel` stays on: pinch belongs to ScaleTravel here, because the
 * room's own frame never zooms — the field is one fixed disc and every verb
 * the hand has goes into the bodies inside it.
 */
const planets = {
  key: "planets",
  href: "/planets",
  sigil: "stars",
  desc: "worlds condense from kept dust",
  cluster: "nature",
  dark: true,
  homePriority: 10,
  place: { kind: "band", band: "planets" },
  icon: {
    title: "Planets",
    description: "worlds condense from kept dust",
    path: "/planets",
    shortName: "planets",
    kind: "stars",
    bg: "#090b0e",
    bg2: "#1e3440",
    glow: "#c8732a",
    accent: "#ddd3be",
    accent2: "#4e7d8c",
    ink: "#f2eee6",
  },
  guide: {
    title: "worlds condense from kept dust",
    scale: "the planets band — between the ground and the system",
    essence:
      "a star, one fixed budget of dust, and the worlds a hand condenses out of it. each world is a compact latent vector decoded into terrain, ocean, air, ring, moons and spin — and read back off the world exactly. the orbit you leave a world in writes its surface: near the star its seas boil, far out the ice takes it.",
    moves: [
      "hold on open dust → a world condenses under the finger and keeps growing for as long as you hold; it joins the disc on the orbit of the place it was made",
      "hold on a world → keeps accreting onto that one, drawing the field's reserve down as it grows",
      "tap a world → it comes forward and states its chord; tap the dark → the dust stirs where the finger landed",
      "rapid taps (1 / 3 / 5 / n) → stir / chord → bright flash → a world condenses → the forge answers tutti",
      "drag a world → it goes where the hand goes and keeps the throw when you let go",
      "flick a world → a real throw; fling one into the star and it is eaten, and its mass comes back as dust",
      "let two worlds meet → they merge, mass conserved, the child wearing both parents' vectors; what will not fit is ejected",
      "circle a finger around a world → winds its ring denser, the other way lets it out — a felt click where the ring condenses",
      "two still fingers held apart → a span: the worlds under each fingertip hold a sustained duet, chords read off their vectors, deepening as it is held",
      "tap a steady beat on a chosen world → its day entrains to the pulse, one turn every four beats, until the tide takes it back",
      "patter two hands → the nearest world takes the beat as spin and the dust between the hands shimmers",
      "twist → the focused world turns under the hand, and enough turn raises the lens: twelve spokes, the latent read back live",
      "three fingers drag → sideways turns the star up and down and every climate answers; up and down leans the axis",
      "three-finger twist → runs the whole system's clock; three-finger hold → time slows while held; three-finger tap → tutti",
      "tilt (once invited) → the field leans into real gravity; shake → every orbit is perturbed; knock → the focused world answers with its chord; face-down → night",
      "arrow keys → walk the field and raise or flood the focused world; [ and ] → dim and brighten the star; backspace → let one world go",
    ],
    finds: [
      "the shimmer of the disc is the mass reserve itself — forge greedily and the field visibly dims until something is let go",
      "nothing fires the same at 900ms and 2400ms: accretion is one continuous curve of the held time",
      "park a world close in and its oceans boil away and its air escapes; throw it out and ice takes the whole surface",
      "a world close to the star is tidally braked — its day lengthens toward its year, and the fast ones visibly flatten at the poles",
      "each world's chord is read off its vector: ringed worlds carry a fifth the bare ones lack",
    ],
    keeps: "the worlds you forged, where in their orbits they are, and a deliberate clearing",
  },
  // ——— the room quality bar, structured ————————————————————————————————
  // Phase 4 (Track 2) migration: the direct save() calls at every plant,
  // retire and seasonRest event moved to a shared idle writer from
  // room-runtime; on-disk shape at objetdart:planets:v2 is unchanged.
  life: {
    glimmer: {
      after_idle_ms: 20000,
      visual:
        "each world catches a small phase-nudge on the quiet clock and the disc's shimmer eases — the forge answers a still room by making its own reserve visible.",
    },
    make_unmake: {
      letgo_clears_population: true,
      ceremony_is:
        "a ceremony hold on a growing world seals its accretion — the mass reserve settles, the world takes its final vector, and the disc closes on it",
    },
  },
} as const satisfies RoomManifest;

export default planets;
