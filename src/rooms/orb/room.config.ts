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
      "rapid taps (1 / 3 / 5 / n) → a flare → the charge arcs to the nearest disc → the whole field leans in toward the strike → the plasma surges wilder with every extra tap",
      "circle a finger → a magnetic stir: the discs take up an orbit around it, faster with the hand",
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
  // ——— the room quality bar, structured ————————————————————————————————
  // AGENTS.md §"The room quality bar" items 3, 5 and 6, declared per
  // PlasmaOrb.tsx as it is today. Round-trip-derived from the component
  // source. Two honest notes for the mechanical check:
  //   • the shader breathes on `u_breath` (lowercase, snake-case) rather
  //     than the canonical `uBreath` — so `reads` names it truthfully and
  //     scripts/test-room-quality.mjs skips the breath_wired check by
  //     design (the check only fires when `uBreath` is named);
  //   • the RoomVoice memo is `useRef({ ... }).current` with an inline
  //     shape rather than `useRef<RoomVoice>({ ... })`, so the ceremony
  //     check cannot find the `ceremony:` handler the code actually
  //     defines — declaring `ceremony_is` here surfaces that drift as a
  //     FAIL rather than hiding it under a skip.
  life: {
    population: {
      objects: [
        {
          noun: "disc",
          max_count: 9, // DISC_CAP from @/lib/orbfield
          state_shape: "x, y, vx, vy, radius, weight, seed, born, flare, retire",
          lifecycle:
            "born under dwell on open dark (api.plant seeds a disc at MIN_RADIUS and stamps growing) → grows while held (deepen widens radius via dwellRadius) → sealed at ceremony (weight=1, flare=1.4) OR annihilated at ceremony (retire) → the oldest disc is retired when the population exceeds DISC_CAP",
          persistence: "localStorage",
          creates_via_verb: "dwell",
          retires_via: ["ceremony", "LetGo", "DISC_CAP overflow"],
          implementation_hint: "inline array + createIdleWriter to STORAGE_KEY",
        },
      ],
    },
    breath: {
      period_seconds: 7,
      reads: ["u_breath"], // shader-side name; the test only wires the check when 'uBreath' appears, so this skips by design
      behavior_at_rest:
        "the fragment shader reads `u_breath` at `bg *= 0.55 + 0.45 * u_breath` and folds a per-disc `breathe = 1.0 + sin(t * 2π * 0.14 * motion + seed * 2π) * 0.14` — the background and every standing disc pulse on the shared 7s clock even when nothing is touched.",
    },
    glimmer: {
      after_idle_ms: 20000,
      visual:
        "RoomShell.onGlimmer routes to api.current.glimmer(); when discs stand, one disc's flare rises for a beat; when the field is empty, the whole-field tutti swells softly.",
    },
    haptics_grammar: {
      tap: "ripple", // api.tap → haptics.ripple(0.15 + intensity * 0.5)
      dwell: "ripple", // api.plant on empty dark → haptics.ripple(0.35 + intensity * 0.3); on a standing disc → haptics.tap()
      ceremony: "bloom", // api.ceremony (annihilate branch and seal branch) → haptics.bloom()
      tap3: "bloom", // api.tutti (three-finger tap) → haptics.bloom()
      shake: "chop", // api.scatter → haptics.chop()
      knock: "tap", // api.knock → haptics.tap()
    },
    make_unmake: {
      letgo_clears_population: true,
      ceremony_is:
        "seals or annihilates the disc under the finger — a hold that began on a standing disc annihilates it (the touch-reachable delete), a hold that made one seals it (weight=1, flare=1.4)",
    },
  },
} as const satisfies RoomManifest;

export default orb;
