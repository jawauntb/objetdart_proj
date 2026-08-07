import type { RoomManifest } from "@/rooms/types";

/**
 * /localgroup — a small gravitationally-bound cluster of galaxies in the space
 * band (~10²⁰–10²² m): the Milky Way, Andromeda, and their dwarf satellites,
 * wheeling about a common barycenter and falling, slowly, toward their future
 * mergers. A cabinet peer beside /space, with an up-door toward /beyond.
 *
 * A galaxy IS its mass, its angular momentum (spin) and its stellar age: two on
 * a bound orbit tidally stream and eventually merge; a satellite is defined by
 * the orbit it keeps, not where it sits. `place` takes the peer seat; the
 * author finalises the circle and `ringAfter`, and the scale span stays in
 * src/lib/scale.ts.
 */
const localgroup = {
  key: "localgroup",
  href: "/localgroup",
  sigil: "atlas",
  desc: "a few galaxies that fall together forever",
  cluster: "nature",
  dark: true,
  place: { kind: "peer", circle: "sky", band: "space", label: "the local group", ringAfter: "stars" },
  icon: {
    title: "Local Group",
    description: "a few galaxies falling together forever about a common barycenter",
    path: "/localgroup",
    shortName: "localgroup",
    kind: "atlas",
    bg: "#05060d",
    bg2: "#140b28",
    glow: "#c9b7f2",
    accent: "#f3d488",
    accent2: "#6f9be0",
    ink: "#e9e6f6",
  },
  guide: {
    title: "a few galaxies that fall together forever",
    scale:
      "the space band — a cabinet peer beside the cosmic web, at the scale where the sky is galaxies, not stars; press up through the floor and you reach the deep field beyond",
    essence:
      "a small gravitationally-bound cluster seen from outside — the Milky Way and " +
      "Andromeda and a scatter of dwarf satellites, each a warm-gold bulge inside " +
      "cool-blue arms inside a faint magenta dark-matter halo, all wheeling about a " +
      "common barycenter on softened orbits that hold forever. a galaxy is its mass, " +
      "its spin and its stellar age: two on a bound orbit stream tidal tails and, given " +
      "cosmic time, coalesce into one disc that is neither parent.",
    moves: [
      "tap a galaxy → it flares at its own mass's pitch — the heavier the disc the lower the ring; the bare void answers with a mote of light",
      "rapid taps (1 / 3 / 5 / n) → the flare → the struck galaxy gathers its neighbours into a small cluster → the two nearest inspiral toward a merger → the whole group heats into a structure-formation burst, harder with every extra tap",
      "rest a finger on the dark → a dwarf galaxy condenses out of the intergalactic medium; keep holding and its mass and halo climb, rung by rung, each one lower-voiced",
      "the long solemn hold on a galaxy → it and its nearest neighbour are forced into a starburst merger, mass and momentum conserved, the new disc flaring young and blue",
      "drag a galaxy → carry it, and the velocity you let go with is a kick that reshapes its whole orbit",
      "flick a galaxy → fling it out of the group; it unbinds and streams a tidal tail as it leaves",
      "two fingers twisting → the lens: the group as starlight, then as dark-matter halos drawn out, then as the velocity field — receding galaxies redshift, approaching ones blue",
      "circle a finger → frame-dragging: the whole group swirls about its barycenter",
      "three fingers → a drag is a cosmic wind, a twist winds cosmic time toward the future mergers or back, a hold slows the wheeling until the orbits can be seen",
      "three-finger tap → every galaxy flares at once; press up through the floor → out to the deep field beyond",
    ],
    finds: [
      "two galaxies drifting together on their own will merge unbidden — the group composes itself while you watch, and the fall never quite stops",
      "wind cosmic time forward with three fingers and dynamical friction bleeds the orbits, pulling the giants toward each other; wind it back and the orbits widen again",
      "a dwarf you flick past a giant is drawn out into a tidal stream that bends toward the mass it is falling past, not along the line you threw",
      "the redshift lens is real: an arrow's colour is the galaxy's own line-of-sight velocity in the group's rest frame, not a decoration",
      "after twenty idle seconds a supernova twinkles in one disc — the group is never quite still",
    ],
    keeps: "the group — every galaxy, at the mass, spin, age and orbit you left it wheeling on",
  },
  // ——— the room quality bar, structured ————————————————————————————————
  // AGENTS.md §"The room quality bar" items 3, 5 and 6, declared per
  // LocalGroup.tsx. scripts/test-room-quality.mjs reads this block and
  // verifies each claim against the component source.
  life: {
    population: {
      objects: [
        {
          noun: "galaxy",
          max_count: 24, // GALAXY_CAP from @/lib/localgroup
          state_shape:
            "id, seed, nx, ny (normalized), vx, vy (units/sec), mass (Milky-Way units), spin (signed angular momentum), age (0 young-blue … 1 old-red), growth, flare, presence",
          lifecycle:
            "condensed under a dwell out of the intergalactic medium (condenseGalaxy) → mass/halo grown while held (growDwarf, each rung lower-voiced) → orbit reshaped by a drag's velocity kick → merged with its nearest neighbour at a ceremony hold, or two drifting together merge unbidden (mergeGalaxies, mass + momentum conserved, a starburst) → flung out by a flick (kickGalaxy unbinds it, a tidal tail trailing) and streams past the escape radius → retired via <LetGo> or at the GALAXY_CAP overflow (oldest first)",
          persistence: "localStorage",
          creates_via_verb: "dwell",
          retires_via: ["ceremony", "flick", "LetGo", "GALAXY_CAP overflow"],
          implementation_hint: "inline array (galaxiesRef) + createIdleWriter to STORAGE_KEY",
        },
      ],
      depth_note:
        "the galaxies interact through one softened N-body gravity field (stepGroup): every disc pulls every other about the shared barycenter, orbits hold on a symplectic integrator, dynamical friction keyed to cosmic time drives the eventual mergers, and two that meet coalesce into a third disc that is neither parent.",
    },
    breath: {
      period_seconds: 7,
      reads: [
        "uBreath uniform (medium shader — the cosmic web brightens by ±40% and the barycenter glow swells)",
        "breath (JS draw — each galaxy's halo radius and baseline glow ride the 7s clock)",
      ],
      behavior_at_rest:
        "the whole group keeps wheeling on its softened orbits with no hand on it; the intergalactic medium's web filaments and the barycenter's well brighten and dim on the shared 7s breath, and every galaxy's magenta halo breathes with them.",
    },
    glimmer: {
      after_idle_ms: 20000,
      visual:
        "after ~20s of quiet one galaxy is chosen (by a hashed 6s slot of the clock) and a supernova twinkle spikes its flare for a beat, sounded at that galaxy's own pitch — the group answers a still room physically, never with text.",
    },
    haptics_grammar: {
      tap: "tap", // ring a galaxy / hold3 enter → haptics.tap()
      dwell: "ripple", // condense a dwarf → haptics.ripple(0.4)
      ceremony: "bloom", // forced merger at tier 3 → haptics.bloom()
      flick: "chop", // fling a galaxy out → haptics.chop()
      twist: "lens", // lens snap on twist end → haptics.lens()
      twist3: "detent", // cosmic-time season detent → haptics.detent()
      tap3: "roll", // tutti → haptics.roll()
      hold3: "tap", // time dilation enter → haptics.tap()
      scrub: "ripple", // frame-dragging swirl → haptics.ripple(0.3)
      knock: "detent", // vessel knock rings the group → haptics.detent()
      shake: "chop", // vessel shake agitates → haptics.chop()
      flip: "detent", // face-down → night → haptics.detent()
    },
    make_unmake: {
      letgo_clears_population: true,
      ceremony_is:
        "a ceremony hold on a galaxy forces it and its nearest neighbour into a starburst merger — the two discs coalesce into one that is neither parent, mass and momentum conserved, flaring young and blue",
    },
  },
} as const satisfies RoomManifest;

export default localgroup;
