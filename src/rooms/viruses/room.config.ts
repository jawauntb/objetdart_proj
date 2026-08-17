import type { RoomManifest } from "@/rooms/types";

/**
 * /viruses — "the shells", a cabinet peer inside the organelles band
 * (~6nm–1.6µm), where a hollow icosahedral capsid is ~100nm. A door-room of
 * the small-scale spine, the geometric register of that size: the same
 * Caspar–Klug family as geodesic domes and fullerenes, treated purely as
 * self-assembling shells of protein subunits — the crystallography sibling of
 * /rocks (mineral lattices) one band up.
 *
 * The manifest takes the peer seat; the circle and ringAfter are finalized by
 * the wiring in peers.ts / scale.ts alongside the registry entry.
 */
const viruses = {
  key: "viruses",
  href: "/viruses",
  sigil: "aphros",
  desc: "the symmetry you can assemble",
  cluster: "nature",
  dark: true,
  homePriority: 8,
  place: { kind: "peer", circle: "cabinet", band: "organelles", label: "the shells", ringAfter: "dither" },
  icon: {
    title: "Viruses",
    description: "the symmetry you can assemble",
    path: "/viruses",
    shortName: "viruses",
    kind: "aphros",
    bg: "#0a0710",
    bg2: "#1a1226",
    glow: "#e6d8f2",
    accent: "#7fe0d8",
    accent2: "#d689f0",
    ink: "#eeeadb",
  },
  guide: {
    title: "the symmetry you can assemble",
    scale:
      "inside the organelles band — a peer of the shells, where a hollow icosahedral capsid is about 100nm across, built of protein subunits by nothing but its own symmetry rule",
    essence:
      "a warm translucent medium of drifting protein subunits that, by the Caspar–Klug arithmetic, snap together into hollow icosahedral shells — the same geometry as a geodesic dome or a fullerene. A shell is its symmetry class T and its geometric seed: two shells of the same class ring alike and are geometrically identical, and every class carries exactly 60·T subunits.",
    moves: [
      "hold on the medium → drifting subunits gather into a T=1 shell; keep holding and it climbs the Caspar–Klug ladder (T=1 → 3 → 4 → 7 …), each rung a lower voice",
      "drag a shell onto the templating floor, or onto another shell → it docks and templates a copy carrying the same seed — geometric self-copying you can watch",
      "flick a shell → it disassembles back into free subunits, which scatter and rejoin the medium; the subunit count is conserved",
      "tap a shell → it rings its class; rapid taps (1 / 3 / 5 / n) → a ring → a dyad with its neighbour → rapped into a bright pulse → the whole medium answers, harder with every extra tap",
      "twist → raises the lens: solid shell → the unfolded subunit net (the triangulation) → the 2·3·5 symmetry axes drawn in cyan",
      "three-finger twist → the season drifts the assembly's fidelity: cold is perfect symmetry, warm lets the geometry wander to nearby classes",
      "hold a shell to the ceremony tier → it folds open along its symmetry planes into a flat geodesic net, kept between visits",
      "three-finger drag → a current through the medium; three-finger hold → the clock keeps slowing for as long as it is held",
      "three-finger tap → every shell pulses and sheds a ring of subunits back to the medium",
      "tilt / shake / knock / flip (once invited) → the medium leans, subunits scatter, the whole population rings, the room sleeps",
      "arrows → move the planting cursor · enter → assemble a shell there · esc → lower the lens",
    ],
    finds: [
      "a T=1 shell is all twelve pentamers and no hexamers; every rung up the ladder adds ten more hexamers and never a thirteenth pentamer — the twelve five-fold vertices are fixed",
      "two shells templated from the same seed are the same shape and ring at the same pitch, wherever they drift — identity is the rule, not the place",
      "a shell folded open into its net still shows exactly twelve magenta pentamers among the pale hexamers",
      "warm the medium and a shell will quietly wander a rung on its own, cold and it holds its class perfectly",
      "left alone the medium keeps assembling: partial shells click together and relax on their own slow clock",
    ],
    keeps: "every standing shell — its class and seed and fold — and how many free subunits drift in the medium",
    plain: {
      what: "this room is about how viruses build themselves: loose protein pieces that snap together into hollow, ball-like shells with no builder but their own symmetry. it is the same trick as a geodesic dome — twelve special corners, always, however big the shell grows.",
      how: [
        "press and hold → drifting pieces gather into a shell; keep holding → it climbs to the next bigger size",
        "tap a shell → it rings its size; bigger shells ring lower",
        "drag a shell onto the floor, or onto another shell → it stamps out a copy of itself",
        "flick a shell → it falls apart into loose pieces, none lost",
        "hold a shell to the deepest tier → it unfolds flat into its map of tiles, and stays that way",
        "twist two fingers → three views: the shell, its unfolded pattern, its lines of symmetry",
        "twist three fingers → warmth lets shells wander in size; cold holds them perfect",
      ],
    },
  },
  // ——— the room-quality bar, structured (AGENTS.md §"The room quality bar")
  // Round-trip-derived from src/components/Viruses.tsx as it stands.
  life: {
    population: {
      objects: [
        {
          noun: "shell",
          max_count: 24, // SHELL_CAP from @/lib/viruses
          state_shape:
            "id, seed (the geometric identity with T), t (Caspar–Klug class), nx, ny, vx, vy, assembly, pulse, net (0 closed .. 1 folded flat), fidelity, presence",
          lifecycle:
            "assembled under a dwell on the medium (assembleShell draws 60 subunits from the free pool into a T=1 shell) → climbs the Caspar–Klug ladder while held (climbShell draws the difference) → templated into a copy carrying the same seed when docked (templateShell) → folded open into its flat net at the ceremony tier → disassembled by a flick or by the cap (dissolveShell returns its 60·T subunits to the medium) → retired via <LetGo>",
          persistence: "localStorage",
          creates_via_verb: "dwell",
          retires_via: ["LetGo", "flick", "tutti-shed", "SHELL_CAP overflow"],
          implementation_hint: "inline array (medium.shells) + createIdleWriter to STORAGE_KEY",
        },
      ],
    },
    breath: {
      period_seconds: 7,
      reads: ["uBreath"],
      behavior_at_rest:
        "the medium shader reads uBreath into `breathe = 0.82 + 0.18 * uBreath`, so the whole warm froth brightens and dims ±18% on the shared 7s clock, and the templating floor glows with it; the shells themselves breathe their radius on the same clock.",
    },
    glimmer: {
      after_idle_ms: 20000,
      visual:
        "after ~20s of quiet the medium spontaneously self-assembles: a partial shell clicks together where a finger might rest and relaxes into a scatter of subunits, over a soft note.",
    },
    haptics_grammar: {
      tap: "tap", // ring a shell / stir the medium → haptics.tap()
      dwell: "ripple", // plant / settle an assembly → haptics.ripple()
      ceremony: "bloom", // fold a shell open into its net → haptics.bloom()
      drag: "tap", // carrying a shell through the medium → haptics.tap()
      flick: "chop", // disassemble a shell → haptics.chop()
      twist: "lens", // raise the lens → haptics.lens()
      twist3: "detent", // the season / fidelity dial → haptics.detent()
      tap3: "ripple", // tutti — every shell sheds a ring → haptics.ripple()
      knock: "detent", // vessel knock rings the population → haptics.detent()
      shake: "chop", // vessel shake scatters subunits → haptics.chop()
    },
    make_unmake: {
      letgo_clears_population: true,
      ceremony_is:
        "folds the shell open along its symmetry planes into a flat geodesic net (net → 1), kept between visits — a discrete `ceremony` method on the room's useMemo<RoomVoice>, dispatched from the hold handler at tier ≥ 3.",
    },
  },
} as const satisfies RoomManifest;

export default viruses;
