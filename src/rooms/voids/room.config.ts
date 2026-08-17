import type { RoomManifest } from "@/rooms/types";

/**
 * /voids — the emptiness that pushes. A great underdense cosmic void in the
 * beyond band (~10^22–3e25 m), bounded by the web: nodes (galaxy clusters)
 * strung by filaments into walls that wrap the growing emptiness. It takes a
 * seat in the cabinet ring beside the plank's aphros register — the vast
 * negative-space counterpart to the plank's smallest one. `circle` /
 * `ringAfter` are finalized by the axis owner; the manifest only takes the
 * seat and states the room's own facts.
 */
const voids = {
  key: "voids",
  href: "/voids",
  sigil: "aphros",
  desc: "the emptiness that pushes · matter drained onto the walls",
  cluster: "field",
  dark: true,
  place: { kind: "peer", circle: "sky", band: "beyond", label: "the voids", ringAfter: "localgroup" },
  icon: {
    title: "Voids",
    description: "the emptiness that pushes — a cosmic void draining matter onto its walls",
    path: "/voids",
    shortName: "voids",
    kind: "aphros",
    bg: "#04050a",
    bg2: "#140b20",
    glow: "#b9a6e8",
    accent: "#c98f5e",
    accent2: "#8fb6e6",
    ink: "#e6eefb",
  },
  guide: {
    title: "the emptiness that pushes · matter drained onto the walls",
    scale:
      "the beyond band — 10²²–3×10²⁵ m, a great underdense void wrapped by the cosmic web; the vast negative-space peer of the plank's smallest register",
    essence:
      "a near-black emptiness that is the subject, not the backdrop. clusters of galaxies " +
      "condense into nodes and string themselves into filaments — walls of the web — and a " +
      "filament is nothing but the tension line between two nodes, thinning and snapping as " +
      "the void stretches it. the void itself is not a thing but a push: the outward flow it " +
      "leaves in its wake, breathing wider on the 7s clock and draining matter along the " +
      "filaments onto the walls. rest a finger and a node condenses; hold longer and it pulls " +
      "in mass; and everywhere the emptiness presses its walls apart.",
    moves: [
      "tap → the nearest cluster rings at its mass's own pitch, deep for a great attractor",
      "rapid taps → three gather two wanderers toward a merger; five send the wave filament by filament through the whole web; seven and beyond ring the web and surge the outflow",
      "rest a finger → matter condenses into a node; keep holding and it pulls in more mass, rung by rung, each one lower-voiced",
      "the long solemn hold → a new void nucleates inside the wall, a void-in-wall pushing its own bubble",
      "drag a cluster onto another → they fall together into one great attractor carrying both masses",
      "drag the open dark → the void stretches: its wall pushes apart, the filaments thin and the redshift deepens",
      "flick across a wall → it collapses, its nodes falling into one great attractor",
      "two fingers twisting → the lens: the luminous web, then the density field, then the outflow velocity",
      "circle a finger → matter drains along the filaments toward the walls, and the outflow stirs",
      "three fingers → a drag is the intergalactic wind, a twist turns the expansion epoch (accelerate or reverse the Hubble flow), a hold slows the expansion until it can be watched",
      "three-finger tap → the whole web states itself at once",
      "pinch out → up the scale; the frame is the viewport and ScaleTravel owns its one verb",
    ],
    finds: [
      "two clusters that drift together on their own will merge unbidden — the web composes itself while you watch, and the attractor rings lower than either parent",
      "a filament flares every so often as matter crosses it; after twenty idle seconds the emptiness lights one on its own",
      "run the season backward and the outflow reverses into an inflow — the walls fall back toward the centre",
      "a knock on the case is a knock on the web: every cluster jumps, and settles",
    ],
    keeps: "the web — every cluster at the mass and place you left it, and every void at the size it had grown to",
    plain: {
      what: "this room is the biggest empty places in the universe — the voids between galaxies, walled in by a web of matter. the emptiness is not nothing: it pushes, stretching its walls apart and draining matter along the threads that join them.",
      how: [
        "tap → the nearest cluster of galaxies rings; the heavier it is, the deeper the note",
        "rest a finger → matter gathers into a new cluster; keep holding → it pulls in more and more",
        "hold to the deepest tier → a new bubble of emptiness is born inside a wall and starts to push",
        "drag one cluster onto another → they fall together into one giant",
        "drag the open dark → stretches the void; the threads between clusters thin",
        "flick across a wall → it collapses, its clusters falling into one",
        "twist three fingers → runs the universe's expansion forward or backward",
      ],
    },
  },
  // ——— the room quality bar, structured (AGENTS.md items 3, 5, 6) ————————
  life: {
    population: {
      objects: [
        {
          noun: "node",
          max_count: 64, // NODE_CAP from @/lib/voids
          state_shape:
            "id, seed, nx, ny, vx, vy, mass (its whole identity — pitch/size/pull), growth, glow, drain, presence; strung by filaments {a, b, strain} and pushed by voids {cx, cy, radius, strength}",
          lifecycle:
            "condensed under a dwell on the open dark (spawnNode seeds a cluster and pulls in mass while held) → grows and strings filaments to its neighbours → carried by a one-finger drag onto another and merged into one great attractor (mergeNodes, mass conserved) → a wall collapses under a flick (collapseWall throws its nodes inward to merge) → drains out via <LetGo> or when the NODE_CAP retires the oldest first",
          persistence: "localStorage",
          creates_via_verb: "dwell",
          retires_via: ["LetGo", "flick", "merge", "NODE_CAP overflow"],
          implementation_hint: "inline array (nodes) + createIdleWriter to objetdart:voids:v1",
        },
      ],
    },
    breath: {
      period_seconds: 7,
      reads: ["uBreath"],
      behavior_at_rest:
        "the field shader reads `uBreath` to breathe every void's wall wider and back on the shared 7s clock (`rad = u_voids[...] * (0.95 + 0.07 * uBreath)`), brighten the outflow shell and the web glow, while the clusters' radii and the matter-motes creeping along the filaments pulse with the same breath.",
    },
    glimmer: {
      after_idle_ms: 20000,
      visual:
        "after ~20s of quiet the emptiness lights one filament: a chosen tension line's two nodes flare (glow += 0.35) and it rings at the wall's pitch — a single filament flaring as matter crosses it, never text.",
    },
    haptics_grammar: {
      tap: "tap", // ring a cluster / step-back soft / dilation enter → haptics.tap()
      dwell: "ripple", // condense a node → haptics.ripple(0.4)
      ceremony: "bloom", // nucleate a void-in-wall → haptics.bloom() (and on merge)
      drag: "chop", // stretch the void → haptics.chop()
      flick: "storm", // collapse a wall → haptics.storm()
      twist: "lens", // lens snap → haptics.lens()
      twist3: "detent", // season detent → haptics.detent()
      tap3: "ripple", // tutti → haptics.ripple(0.4)
      drag3: "roll", // intergalactic wind → haptics.roll()
      hold3: "tap", // time dilation enter → haptics.tap()
      scrub: "ripple", // drain the outflow → haptics.ripple(0.3)
      knock: "detent", // vessel knock → haptics.detent()
      shake: "chop", // vessel shake → haptics.chop()
      flip: "roll", // vessel flip → haptics.roll()
    },
    make_unmake: {
      letgo_clears_population: true,
      ceremony_is:
        "the tier-3 hold nucleates a NEW void inside the wall where the finger rests — a void-in-wall that pushes its own bubble outward, draining the wall it was born in; the branch lives in the `hold` handler (`e.tier >= 3`).",
    },
  },
} as const satisfies RoomManifest;

export default voids;
