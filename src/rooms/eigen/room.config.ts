import type { RoomManifest } from "@/rooms/types";

/**
 * /eigen — a law, not a place: surviving freedom after a constraint.
 * The visual is the lesson: a visitor asked how much freedom is left
 * should point at how the cloud still moves, never at a drawn axis.
 */
const eigen = {
  key: "eigen",
  href: "/eigen",
  sigil: "stars",
  desc: "surviving freedom after a constraint",
  cluster: "mechanism",
  dark: true,
  place: {
    kind: "exempt",
    why: "a law, not a place — surviving freedom after a constraint, not a size on the quark→manifold axis",
  },
  chrome: { travel: false, peers: false },
  icon: {
    title: "the life that remains",
    description: "a dwell deadens a direction; what still moves is the freedom that survived",
    path: "/eigen",
    shortName: "eigen",
    kind: "stars",
    bg: "#05070c",
    bg2: "#121018",
    glow: "#c8d0dc",
    accent: "#c8732a",
    accent2: "#7a9aa8",
    ink: "#eaf0f6",
  },
  guide: {
    title: "the life that remains",
    essence:
      "a near-black field of pale grains. a dwell plants a dark seam and the sideways shimmer dies into weightless ghosts. what still moves is the freedom that survived. a long hold on a seam that does not thin the ember was only a footprint; a flicked rule can gate the pulse while the cloud refuses to turn.",
    scale: "a law, not a place — the same at every band",
    moves: [
      "dwell → a seam forms under the finger; off-seam life becomes ghosts, and a voice swells as the hold deepens past every tier",
      "rapid taps (1 / 3 / 5 / n) → a nudge along what still lives → a second independent source shears in → the snap (or a glint that slides forever when the season is gaussian) → everything that does not feed the ember deadens at once",
      "ceremony → the nearest seam lifts; if the ember does not thin, it was a footprint — gone from the field, still in the chord",
      "drag → lit grains stir along the surviving span; off-span input only slides the ghosts",
      "flick → a shortcut: the pulse gates, the shimmer does not turn",
      "twist → the lens: cloud or quotient, surviving light only",
      "twist3 → season: sources spike or blur toward gaussian",
      "tap3 → tutti; every standing seam answers at once",
      "drag3 → wind; ghosts drift, the lit cloud stands",
      "hold3 → time dilation, so the dying of a direction can be watched",
      "shake → ghosts scatter; the lit cloud does not",
      "knock → a jolt of the frame: it slides before a snap, holds after",
      "tilt → ghost parallax",
      "flip → night",
      "two-finger tap → the lens lowers",
      "arrows / enter → aim and plant; held enter deepens; shift+enter is the ceremony; space rides the tap train; escape lowers the lens",
    ],
    finds: [
      "two seams that point the same way beat, then fuse into one that is neither parent",
      "a flicked shortcut can still work the ember while the cloud stays unaligned",
      "when the season is gaussian the snap glint never detents — the refusal is the lesson",
      "squeeze past the coarsest enough and the ember starves in the same frame",
    ],
    keeps: "every standing seam with its aim and its depth; an emptied field stays empty",
  },
  life: {
    population: {
      objects: [
        {
          noun: "constraint",
          max_count: 6,
          state_shape: "id, seed, nx, ny, ux, uy, beta, aligned, gaussian, growth, presence",
          lifecycle:
            "born under dwell at the finger (direction + β) → β climbs continuously with the hold → two collinear seams fuse into one that is neither parent → ceremony retires the nearest (load-bearing thins the ember; a footprint still leaves, chord refuses) → whole field clears through <LetGo>",
          persistence: "localStorage",
          creates_via_verb: "dwell",
          retires_via: ["ceremony", "LetGo"],
          implementation_hint: "inline array",
        },
      ],
    },
    breath: {
      period_seconds: 7,
      reads: [
        "uBreath uniform (fragment shader — the near-black ground lifts with 0.55 + 0.45 * uBreath, and the ember drinks 0.7 + 0.3 * uBreath, so an empty field is never still)",
      ],
      behavior_at_rest:
        "forty-eight pale grains shimmer isotropically on the shared 7s clock until a seam is planted; the ember waits low, barely fed",
    },
    glimmer: {
      after_idle_ms: 20000,
      visual:
        "no seam: the shimmer flattens briefly along one seeded direction and recovers. seams present: one ghost slides its killed length and returns. physical, wordless",
    },
    haptics_grammar: {
      tap: "ripple",
      dwell: "ripple",
      ceremony: "chop",
      drag: "ripple",
      flick: "chop",
      twist: "lens",
      twist3: "roll",
      tap3: "roll",
      drag3: "ripple",
      hold3: "roll",
      knock: "tap",
      shake: "storm",
      flip: "roll",
    },
    make_unmake: {
      letgo_clears_population: true,
      ceremony_is:
        "the nearest seam is lifted — load-bearing, a voice drops and the ember thins; footprint, the chord holds and the ember stays",
    },
  },
} as const satisfies RoomManifest;

export default eigen;
