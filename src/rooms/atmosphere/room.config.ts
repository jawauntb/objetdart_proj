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
      "rapid taps (1 / 3 / 5 / n) → ring → seed a puff → warm a tower → the column scatters",
      "press → lifts and warms the air under the finger; it condenses at its own cloud base and starts to build",
      "keep pressing → the parcel warms further, hangs its base higher, and climbs higher still; hold to the ceremony and the candle is given to the wind as a lantern, and kept",
      "drag → stirs the air at that altitude and carries the cloud you are inside; layers slide against each other but the column keeps its momentum",
      "flick → tears a cloud apart and throws the rag downwind",
      "three-finger drag → the world-law: the lapse rate up and down, the sun along its arc — every cloud answers in the same frame",
      "three-finger twist → the season: how much water this air carries, so every cloud base moves at once",
      "twist → raises the lens: isobars crowding toward the ground, the tropopause, the wind profile, the temperature and dew-point curves",
      "scrub → winds a vortex; the cloud it finds turns on its own axis",
      "drumming → gusts the layer under each landing, harder as the patter lengthens — a ring seen, the layer's own pressure heard",
      "tap a steady tempo → the thermals take the hand's pulse: every beat lifts the clouds together while the tempo holds",
      "two fingers rested → a lid held by hand: the air between the fingertips steadies, climbing parcels flatten under it, and both levels sound as one held interval — letting go frees the band to convect again",
      "two-finger tap → the frame steps back: a raised lens lowers, or the stirred column settles and the haze thins",
      "three-finger tap → tutti: every cloud and lantern answers at once, ground and tropopause sounding together",
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
    plain: {
      what: "this room is the column of air above a mountain, seen from the side — ground at the bottom, the edge of space at the top. press to warm a patch of air: it rises, cools, and turns to cloud exactly the way real clouds form.",
      how: [
        "tap → a ring of sound; deep near the ground, thin and high up near space",
        "press and hold → warms the air under your finger until it rises and turns to cloud",
        "keep holding → the cloud builds taller; hold to the very end → a lantern joins the wind and is kept",
        "drag → stirs the air at that height and carries the cloud you touch",
        "flick → tears a cloud apart and throws the rag downwind",
        "drag with three fingers → walks the sun across the sky and changes the weather every cloud obeys",
        "press the clear button → your lanterns are let go",
      ],
    },
  },
  // ——— the room quality bar, structured ————————————————————————————————
  // AGENTS.md §"The room quality bar" items 3, 5 and 6, declared per
  // AirColumn.tsx as it is today. Round-trip-derived from the component:
  // parcels are transient (inline array, retired by tearing, merging, or
  // ceremony); lanterns are the kept object, born only at ceremony into the
  // shared world's "sky" zone and retired only via <LetGo>. Only verbs that
  // DO fire a direct haptic appear in haptics_grammar — the tutti, dwell,
  // ceremony, drag, twist, season, scrub, gust, gravity and knock paths
  // land audibly and visually but pass no haptic through today, so they
  // are omitted here so scripts/test-room-quality.mjs does not misread
  // silence as a hole.
  life: {
    population: {
      objects: [
        {
          noun: "parcel",
          max_count: 10, // MAX_PARCELS from @/lib/aircolumn
          state_shape: "id, xKm, zKm, mass, w (vertical velocity), spin, lclKm (cloud base), t0",
          lifecycle:
            "born under dwell (seedParcel from plant()) → warmed and lifted while held (deepen → relift) → torn by flick (tearParcel) → merges with a neighbour (mergeParcels) → falls out of the array when mass drops below PARCEL_MIN_MASS",
          persistence: "ephemeral",
          creates_via_verb: "dwell",
          retires_via: ["flick", "merge", "dissipation"],
          implementation_hint: "inline array (parcels[])",
        },
        {
          noun: "lantern",
          max_count: 12, // MAX_LANTERNS
          state_shape: "a WorldNatural — id, zone='sky', nx (0..1), ny (0..1), magnitude",
          lifecycle:
            "born at ceremony (addNatural('lantern','sky',...)) → drifts on its own altitude's wind between visits → retires only via <LetGo>; silently shifted out when the population exceeds MAX_LANTERNS (real defect per AGENTS.md item 3 — no explicit retire verb from the visitor's side)",
          persistence: "world",
          creates_via_verb: "ceremony",
          retires_via: ["LetGo"],
          implementation_hint: "world.ts registry",
        },
      ],
    },
    breath: {
      period_seconds: 7,
      reads: ["uBreath"],
      behavior_at_rest:
        "the shared 7s uBreath swells the base sky (`(uBreath - 0.5) * 0.34 * exp(-p.y / 9.0)`) and warms the lamp (`0.24 + 0.16 * uBreath`) — the whole column is always breathing between taps.",
    },
    glimmer: {
      after_idle_ms: 20000,
      visual:
        "RoomShell.onGlimmer routes to airRef.current.glimmer(), which stamps glimmerAt = now; the draw loop reads it and pushes one soft ring on the overlay pass.",
    },
    haptics_grammar: {
      tap: "tap", // single-touch tap tier 1 → haptics.tap(); tier 3 → haptics.ripple; tier 5 → haptics.bloom; tier n → haptics.roll — all under the same verb, tier=1 declared as the base
      flick: "chop", // tearParcel → haptics.chop()
    },
    make_unmake: {
      letgo_clears_population: true,
      ceremony_is:
        "gives a candle to the wind as a lantern — one addNatural into the shared 'sky' zone, kept between visits on the layer's own wind",
    },
    // The column's sky is one continuous exponential wash (breath-modulated,
    // never a hard specular cut), so edge_density sits at 3.5% against the
    // 6% floor even though hue_diversity (15), luminance_range (230),
    // spatial_entropy (7.3) and file_size_floor all clear theirs by a wide
    // margin — see phase-9-pebble-and-threshold.md.
    visual: { soft_glow: true },
  },
} as const satisfies RoomManifest;

export default atmosphere;
