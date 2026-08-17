import type { RoomManifest } from "@/rooms/types";

/**
 * /group — a law, not a place: Weyl's automorphic invariance of a seen
 * fragment, inferred from an incomplete orbit. Dual-registered; chrome none.
 */
const group = {
  key: "group",
  href: "/group",
  sigil: "stars",
  desc: "a move that leaves the figure itself",
  cluster: "mechanism",
  dark: true,
  place: {
    kind: "exempt",
    why: "a law, not a place — Weyl's automorphic invariance of a seen fragment, inferred from an incomplete orbit, holds at every band",
  },
  chrome: { travel: false, peers: false },
  icon: {
    title: "a move that leaves the figure itself",
    description: "an incomplete orbit on a dark field — kept moves predict the unseen seats",
    path: "/group",
    shortName: "group",
    kind: "stars",
    bg: "#05070c",
    bg2: "#10182c",
    glow: "#c6d8f8",
    accent: "#c8732a",
    accent2: "#8fb5e8",
    ink: "#eaf3ff",
  },
  guide: {
    title: "a move that leaves the figure itself",
    essence:
      "an incomplete fragment on a blue-black field — a drag that closes is unison, and the kept move says where the missing seats must sit, so the family is inferred, never given.",
    moves: [
      "dwell → a mark condenses at the contact; holding longer charges its class, never a second body",
      "tap → the last kept move acts on the nearest mark, as hard as the hand landed",
      "rapid taps (1 / 3 / 5 / n) → one flare → the next unused shift ghost-turns and locks if it closes → predicted seats fill and the fragment breathes as one → every kept move acts once",
      "drag / flick → the fragment turns as one ghost body; beating at most angles, unison at one; a straight stroke proposes a flip; release keeps the move if it closes, else the ghosts glide home",
      "ceremony → the nearest kept move retires, and its seats dissolve — or the mark, if none remain",
      "twist → the look climbs the ladder: bilateral, rotational, ornamental — a change of seeing, not of scale",
      "twist3 → matching tightens; grain follows",
      "tap3 → tutti; every mark answers at once",
      "drag3 → the field drifts; the poses hold",
      "hold3 → time dilates so a proposed lock can be seen, deepening with the hold",
      "tilt → the abyss leans with the vessel",
      "shake → poses scatter inside the seen fragment, never inventing the missing",
      "knock → the identity is tried: a unison ping, and nothing moves",
      "flip face-down → the last move runs backward, and the field goes night",
      "arrows / enter → turn a proposal, or plant at the cursor; held enter deepens toward the ceremony; escape lowers the look",
    ],
    finds: [
      "seats appear only after a lock, where the kept move predicts a body — never as a ring granted at arrival",
      "two fragments that close under the same move fuse into one orbit whose hue is neither parent",
      "a rotation meeting a flip raises a brief seam, the kind of family changing, then the seam decays",
      "left idle, the fragment ghost-turns by its last kept move and settles — one breath, near-silent unison",
    ],
    keeps: "every standing mark and every kept move; an emptied field stays empty.",
    plain: {
      what: "this room is about symmetry — the moves that leave a pattern looking the same. you only ever see part of the pattern; when you find a move that fits, it tells you where the missing pieces must go.",
      how: [
        "press and hold → a mark condenses under your finger; holding longer charges it",
        "drag → turns the whole pattern as a ghost; at most angles it shimmers, at the right one it clicks",
        "let go on a click → the move is kept, and pale seats appear where the pattern says pieces must sit",
        "a straight stroke → proposes a mirror flip instead of a turn",
        "tap → the last kept move acts on the nearest mark, as hard as you tapped",
        "hold to the deepest tier → the nearest kept move retires, and the seats it predicted dissolve",
        "press the clear button → every mark and move is let go; the field stays empty",
      ],
    },
  },
  life: {
    population: {
      objects: [
        {
          noun: "mark",
          max_count: 24,
          state_shape: "id, seed, nx, ny, classId, pose (0..7), growth, charge, flare, phase, locked, presence",
          lifecycle:
            "born under dwell at a contact pose of a class → growth and charge deepen while held → a kept generator maps it onto its class → two fragments that close under the same generator fuse into a third class that is neither parent → ceremony retires the nearest generator (or the mark if none) → <LetGo> clears marks and generators; emptied stays empty",
          persistence: "LetGo",
          creates_via_verb: "dwell",
          retires_via: ["ceremony", "LetGo"],
          implementation_hint: "SceneObjectSpec",
        },
      ],
    },
    breath: {
      period_seconds: 7,
      reads: [
        "uBreath uniform (fragment shader — the abyss vignette and undertow grain ride the shared 7s clock, halved under reduced motion)",
        "uBreath uniform (instanced marks — each fragment breathes out of phase until an orbit completes, then phase-locks)",
      ],
      behavior_at_rest:
        "the blue-black abyss vignette swells on the shared 7s clock; each incomplete fragment breathes out of phase; after a lock the completed class inhales as one body",
    },
    glimmer: {
      after_idle_ms: 20000,
      visual:
        "after ~20s idle the fragment ghost-turns by its last kept generator (or the smallest closing shift) and settles — one breath, near-silent unison, never text",
    },
    haptics_grammar: {
      tap: "ripple",
      dwell: "tap",
      ceremony: "roll",
      drag: "ripple",
      flick: "detent",
      twist: "lens",
      twist3: "ripple",
      tap3: "roll",
      drag3: "chop",
      hold3: "roll",
      knock: "tap",
      shake: "chop",
      flip: "ripple",
    },
    make_unmake: {
      letgo_clears_population: true,
      ceremony_is:
        "retires the nearest kept generator and dissolves the seats it predicted — or the nearest mark, if no generator remains; the solemn act is also the touch-reachable delete",
    },
  },
} as const satisfies RoomManifest;

export default group;
