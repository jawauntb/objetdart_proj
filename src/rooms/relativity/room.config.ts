import type { RoomManifest } from "@/rooms/types";

/**
 * /relativity — migrated to a manifest as the proof for the *exempt* path.
 * A law, not a place: it comments on every band at once, so it takes no scale
 * address and appends after the axis in the dropdown.
 */
const relativity = {
  key: "relativity",
  href: "/relativity",
  sigil: "stars",
  desc: "light keeps its own covenant",
  cluster: "mechanism",
  dark: true,
  place: {
    kind: "exempt",
    why: "a law, not a place — the covenant holds identically at every band, so it has no scale address of its own",
  },
  icon: {
    title: "Relativity",
    description: "light keeps its own covenant",
    path: "/relativity",
    shortName: "relativity",
    kind: "beyond",
    bg: "#05070c",
    bg2: "#111b30",
    glow: "#c6d8f8",
    accent: "#e7ac52",
    accent2: "#8fb5e8",
    ink: "#eaf3ff",
  },
  guide: {
    title: "light keeps its own covenant",
    essence:
      "the law of relativity taught by hand — light's fixed speed, time dilation, gravity, doppler, simultaneity, and the twin paradox, sharing one dark room.",
    moves: [
      "tap open dark → a pulse at exactly the speed of light",
      "rapid taps → three stage the race (a flash and a comet leave the same point — light wins), five make every standing well echo the strike, seven and more swell the covenant's crescendo",
      "hold two still fingers apart → a photon bounces between the fingertips at exactly c; spread them and the tick audibly slows",
      "drag a light clock → carrying it visibly slows its own tick",
      "flick a beacon → sends its twin on a journey; it returns visibly younger, sounded as a detuned chord",
      "tap the gliding car → one flash splits toward both ends, but the room's own strikes land unevenly — simultaneity, heard as a gap",
      "three-finger hold → time slows and light itself nearly stands still, so its own geometry can be seen",
    ],
    finds: [
      "harder flicks make comets glow hotter rather than move faster — effort is capped at the speed of light and turns to heat instead",
    ],
    plain: {
      what: "this room shows why the speed of light is a speed limit and what that does to time: clocks that move tick slower, and nothing you throw can beat a light pulse.",
      how: [
        "tap the dark → a pulse of light spreads at exactly light speed",
        "hold two still fingers apart → a light clock ticks between them; spread them and the tick slows",
        "drag a light clock → carrying it visibly slows its own tick",
        "flick a beacon → its twin flies away and comes back younger than the one that stayed",
        "flick harder → the thrown comet doesn't go faster, it just glows hotter — the limit holds",
        "hold three fingers → time slows until light itself almost stands still",
      ],
    },
  },
  // ——— the room quality bar, structured ————————————————————————————————
  // AGENTS.md §"The room quality bar" items 3, 5 and 6, declared per
  // RelativityRoom.tsx as it is today. Round-trip-derived from the
  // component. One honest note:
  //   • the room uses raw `attachGestures` with a per-tier branch inside
  //     the `hold` handler rather than a `useMemo<RoomVoice>` with a
  //     discrete `ceremony:` method — so the ceremony act (evaporating a
  //     held mass at tier 3) IS in the code but the mechanical check
  //     cannot see it and the room FAILS make_unmake_ceremony. That FAIL
  //     is real drift, not a mislabel; declaring `ceremony_is` here
  //     surfaces it as a follow-up.
  life: {
    population: {
      objects: [
        {
          noun: "mass",
          max_count: 4, // MAX_MASSES
          state_shape: "id, nx, ny, m, growth (0..1), settled, charge (0..1), evapAt, plantedAt",
          lifecycle:
            "born under dwell (placeMass while held past tier 2) → grows and settles (settleMass fires haptics.bloom) → keeps deepening while held past settle → evaporated at ceremony (tier-3 hold on the mass) or oldest-first when the population exceeds MAX_MASSES; not persisted between visits (a law keeps no belongings the visitor planted)",
          persistence: "ephemeral",
          creates_via_verb: "dwell",
          retires_via: ["ceremony", "LetGo", "MAX_MASSES overflow"],
          implementation_hint: "inline array (masses[])",
        },
      ],
    },
    // The covenant's own bodies — the light clocks, the twin beacons, the
    // flung comets — carry positions/velocities/proper-time between visits.
    // createIdleWriter under `objetdart:relativity:v1` matches the Solar /
    // Galaxy pattern for orbital-element persistence: on mount the room
    // finds itself already mid-motion instead of always at seed. The masses
    // above stay ephemeral (a law keeps no belongings the visitor planted);
    // only the room's own instruments ride the writer.
    breath: {
      period_seconds: 7,
      reads: [
        "clocksFrom({ time: localT, reducedMotion: reduce }).breath — the ambient star-field halo brightness rides the album's shared 7s exhale (0.14 Hz), so two rooms opened side by side inhale together",
      ],
      behavior_at_rest:
        "the cold star-field halo behind the covenant brightens/dims by ±3% on the shared 7s clock — the room is never still between taps, and the beat is the same one Reef/Root/Geyser/Spring/Tidepool/Marsh already ride",
    },
    glimmer: {
      after_idle_ms: 20000,
      visual:
        "after ~20s idle a warm ring appears where a dwell would land — deterministic (seeded by `Math.floor(now / 9000)`), never text",
    },
    haptics_grammar: {
      tap: "ripple", // firePulse tap path → haptics.ripple(0.3 + intensity * 0.4)
      dwell: "tap", // hold + settleMass growth notes → haptics.tap() at growth beats
      ceremony: "roll", // evaporate() → haptics.roll() (also fired on knock/flip and LetGo)
      drag: "tap", // grabAt + carry → haptics.tap() on grab
      flick: "ripple", // throwComet fire → haptics.ripple(0.3 + heat * 0.4)
      twist: "lens", // lens snap on twist end → haptics.lens()
      twist3: "tap", // season release → haptics.tap()
      drag3: "chop", // three-finger wind → haptics.chop()
      hold3: "tap", // three-finger hold enter → haptics.tap()
      scrub: "ripple", // orbit stir → haptics.ripple(0.25)
      knock: "roll", // vessel knock → haptics.roll()
      shake: "chop", // vessel shake → haptics.chop() (or haptics.storm on intensity > 0.7)
      flip: "roll", // vessel flip → haptics.roll()
    },
    make_unmake: {
      letgo_clears_population: true,
      ceremony_is:
        "evaporates the mass under the finger — a strong pulse at c and it is gone; the collapse path also runs when <LetGo> is pulled (the tier-3 act lives inside the hold handler, not a discrete `ceremony:` method — the mechanical test cannot see it and FAILs; real drift for a follow-up)",
    },
  },
} as const satisfies RoomManifest;

export default relativity;
