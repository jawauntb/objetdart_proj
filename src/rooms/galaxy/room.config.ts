import type { RoomManifest } from "@/rooms/types";

/**
 * /galaxy — the primary resident of the `galaxy` band (s = 17…20.5), between
 * the stellar vault below and the web between galaxies above. The band's
 * `route` in `src/lib/scale.ts` points here; this manifest asserts the link so
 * the two cannot drift apart.
 *
 * Doors are the metric neighbours and need no override: the sky genuinely
 * thins into the arms, and the arms genuinely thin into the web. That the
 * default doors are right is the tell that the band was placed right.
 */
const galaxy = {
  key: "galaxy",
  href: "/galaxy",
  sigil: "stars",
  desc: "the wave the stars stream through",
  cluster: "nature",
  dark: true,
  place: { kind: "band", band: "galaxy" },
  icon: {
    title: "Galaxy",
    description: "the wave the stars stream through",
    path: "/galaxy",
    shortName: "galaxy",
    kind: "stars",
    bg: "#04070f",
    bg2: "#181330",
    glow: "#7d9bd8",
    accent: "#c8732a",
    accent2: "#b9c9e8",
    ink: "#e9edf8",
  },
  guide: {
    title: "the wave the stars stream through",
    scale: "the galaxy band — between the stars and the web",
    essence:
      "one spiral galaxy from inside its arms: a differentially rotating disc of a hundred and eighty thousand stars, each on its own orbit, poured through a two-armed density wave that turns at one pattern speed. the arms are not made of stars — they are the standing crowd the stars pass through — and the register the room sounds in is the pattern's own, near sub-bass, so the turn you hear is the turn you see.",
    moves: [
      "drag one finger → leans the eye around the disc; the near arm sweeps over the far",
      "flick → the lean keeps going, and eases",
      "two fingers drag → holds the frame: swing round the disc, and tip it the whole way from face-on to its own rim",
      "tap a star → it rings at its own orbital speed — the inner disc always higher, the rotation curve as melody",
      "hold → the eye takes the nearest star and rides its orbit; every arm it crosses lands as one felt tick, faster near the centre, silent at corotation",
      "keep holding past the dwell → the same finger gathers gas where it rests, and a star-forming region stands there, caught in the shear from the moment it exists",
      "let go past the ceremony → the region goes off; its shell runs outward, shoves and lights what it passes, and where it reaches the next patch of gas it lights that too",
      "tap a knot → it brightens and takes on gas; tap it twice → it blows out and the disc closes over it",
      "rapid taps (1 / 3 / 5 / n) → the orbit rings → the arm lights where it crosses the struck ring → the gas goes off on the spot, no wait → the whole disc heats into the tutti",
      "tap a steady beat → the pattern speed entrains to the hand's tempo, and the register re-tunes with it",
      "three fingers drag → the world-law: sideways winds the pattern speed, up and down opens or closes the arms — the arms re-pitch and the register re-tunes in the same breath",
      "three fingers twist → turns the pattern itself by hand",
      "three fingers held → the veil: the stars dim and the standing wave shows alone with its corotation circle; held past the ceremony, a bar grows at the centre and stays",
      "three fingers tap → the rotation curve as one arpeggio, centre to rim",
      "circle a finger → stirs the spiral itself: with the arms winds them tighter, against lets them out — the winding problem, run by hand",
      "twist → raises the lens: the crest's own log spiral, the corotation circle, and the rotation curve drawn flat where the halo holds it",
      "tilt → leans the disc; shake → the disc heats and cools back into order; knock → the bar rings; face-down → night, and at night the stars go out and the wave glows on",
      "arrows → left and right lean the eye, up and down walk a ring along the rotation curve, each step heard; enter → follows the nearest star on the ring; held enter → rides it deeper, then gathers gas; esc → lowers everything",
    ],
    finds: [
      "watch one patch of arm and its stars leave it — inside corotation they overtake the pattern, outside it the pattern overtakes them, and the crossing beat you feel while riding is exactly that mismatch",
      "a knot you plant is drawn into an arc while you watch, faster the further in you put it: matter cannot hold an arm open, which is the whole reason the arms are a wave instead",
      "set off two knots near each other and the second lights when the first one's shell arrives — not on a timer, but when the blast actually gets there",
      "the young blue light sits only on the crest, because the crest is where the crowd compresses the gas — the arm is lit by its own physics, not painted",
      "an untouched room sounds precisely the note the scale axis assigns this band; wind the law with three fingers and you can hear how far you have bent it",
    ],
    keeps: "the stars you have ridden through an arm, and the gas and remnants you left in the disc",
    plain: {
      what: "this room is one spiral galaxy seen from inside — thousands of stars, each on its own orbit, pouring through two bright arms. the arms are not made of stars: they are traffic jams the stars pass through, and you can hear the whole disc turn.",
      how: [
        "drag → leans your view around the disc; two fingers swing and tip it all the way over",
        "tap a star → it rings at the speed of its own orbit; stars near the middle ring higher",
        "press and hold → your eye rides the nearest star; every arm it crosses lands as a felt tick",
        "keep holding → gas gathers under your finger; let go after a long hold → it ignites and lights its neighbours",
        "drag with three fingers → winds the arms' speed and shape; the sound re-tunes with them",
        "circle a finger → winds the spiral tighter, or the other way lets it out",
        "tap a steady beat → the galaxy's turning locks onto your tempo",
      ],
    },
  },
  // ——— the room quality bar, structured ————————————————————————————————
  // Phase 4 (Track 2) migration: writeStore() at every gesture endpoint
  // moved to a shared idle writer from room-runtime. Kept stars and
  // star-forming regions still persist to objetdart:galaxy:v1 in the
  // same shape; only the WRITER is different.
  life: {
    glimmer: {
      after_idle_ms: 20000,
      visual:
        "one star-forming region on the crest catches a small brightening, and the pattern's own soft arpeggio walks the ring — the disc answers a quiet room with the register the scale axis assigns this band.",
    },
    make_unmake: {
      letgo_clears_population: true,
      ceremony_is:
        "a ceremony hold on a gas-gathering finger ignites its region — the shell runs outward, lights what it passes, and where it reaches the next patch of gas it lights that too",
    },
  },
} as const satisfies RoomManifest;

export default galaxy;
