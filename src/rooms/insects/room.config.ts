import type { RoomManifest } from "@/rooms/types";

/**
 * /insects — a dusk meadow-edge swarm at the drop band (~0.3mm–3cm), a peer in
 * the cabinet ring beside the drop and the seed: the size where a body is small
 * enough to be nothing but its behavior. An insect here is its behavior + its
 * lifecycle stage + its causal role — a mote grazes the flock, a pollinator
 * takes the light, a predator hunts — so the same body drawn as an egg, a
 * larva, and an imago is three causal things, not one sprite three ways.
 *
 * The scale door up opens onto the flowers (the blooms these pollinators work);
 * that address is the author's physics and lives in `src/lib/scale.ts`. The
 * manifest only takes the seat — circle and ringAfter are finalized by the
 * registry wiring.
 */
const insects = {
  key: "insects",
  href: "/insects",
  sigil: "earth",
  desc: "bodies that are their behaviors",
  cluster: "nature",
  dark: true,
  homePriority: 8,
  place: { kind: "peer", circle: "cabinet", band: "drop", label: "the swarm", ringAfter: "viruses" },
  icon: {
    title: "Insects",
    description: "a dusk meadow-edge swarm — motes, pollinators, a mantis",
    path: "/insects",
    shortName: "insects",
    kind: "earth",
    bg: "#0b0a14",
    bg2: "#16132a",
    glow: "#cfd6ea",
    accent: "#e8b46a",
    accent2: "#8fbf72",
    ink: "#eeeadb",
  },
  guide: {
    title: "bodies that are their behaviors",
    scale:
      "the drop band — a cabinet peer beside the drop and the seed, with an up-door onto the flowers the pollinators work: the size at which a body is nothing but what it does.",
    essence:
      "a dusk meadow-edge swarm, milling by real flocking under a lantern that breathes on the 7s clock. an insect is its behavior + its lifecycle stage + its causal role: a mote grazes the flock, a pollinator takes the light, a predator hunts — and an egg, a larva, and an imago are three causal things, not one body three ways.",
    moves: [
      "tap → startles the nearest body into a chirp; on bare air, a hush of wingbeat",
      "rapid taps (1 / 3 / 5 / n) → a chirp → the near swarm scatters into a startled swirl → a light-ripple sweeps the whole meadow toward the lantern → the whole meadow stridulates at once, louder with every extra tap",
      "hold on the grass → lays a clutch of eggs; keep holding and the brood advances a whole stage at a time, egg → larva → imago under your finger",
      "hold to the ceremony tier → releases a mantis that hunts and thins the swarm on the shared trophic law",
      "drag → draws a scent trail the swarm follows; the flock steers to your line",
      "flick → a swat: a scatter burst, and a body or two struck loose",
      "scrub → stirs a gust that herds the swarm around the circle",
      "twist → raises the lens: the swarm, then the trophic web drawn predator-to-prey, then the stridulation spectrum read out of each body's own pitch",
      "twist (three fingers) → turns the season, dawn ↔ dusk ↔ night; the swarm is most awake at dusk and the chorus follows",
      "drag (three fingers) → the breeze, herding or scattering the flock",
      "hold (three fingers) → time dilation — the meadow slows the longer the hold, toward stillness",
      "tap (three fingers) → tutti; the whole meadow stridulates at once",
      "tilt / shake / knock / flip (once invited) → the flock leans on real gravity, agitation scatters it, a rap on the case rings the meadow, face-down is night",
      "arrows → move where a clutch would land · enter → lay one · esc → lower the lens",
    ],
    finds: [
      "the flock's shape is nobody's drawing — it is the balance of three rules, alignment and cohesion and separation, and you can feel it swerve as a whole around the mantis",
      "a laid clutch hatches and pupates on its own if you leave it: an egg becomes a larva becomes a flying imago while nobody watches",
      "two mature motes that drift together lay an egg that is neither of them — the swarm grows its own next generation",
      "the lantern is always drawing the imagoes a little; scrub the air or draw a scent and you can pull the whole swarm off the light",
      "after about twenty seconds of quiet one cricket chirps and a ripple of light passes through the swarm — the meadow reminding you it is alive",
    ],
    keeps: "every body still on the wing, its seed and stage and role, so the swarm you left is the swarm you return to.",
    plain: {
      what: "this room is a swarm of insects at a meadow's edge at dusk, milling around a lantern. each body simply is its behavior — grazers drift with the flock, pollinators chase the light, a hunter thins the crowd — and the eggs you lay hatch and grow up on their own.",
      how: [
        "tap → startles the nearest insect into a chirp",
        "press and hold on the grass → lays a clutch of eggs; keep holding → they hatch and grow up under your finger",
        "hold to the deepest tier → releases a mantis that hunts the swarm",
        "drag → draws a scent trail the swarm follows",
        "flick → a swat: the crowd scatters, and a body or two is struck loose",
        "twist three fingers → turns dusk to night to dawn; the chorus follows",
        "press the clear button → the meadow empties, and stays empty",
      ],
    },
  },
  // ——— the room quality bar, structured ————————————————————————————————
  // AGENTS.md §"The room quality bar" items 3, 5 and 6, declared per
  // Insects.tsx as it is today. `scripts/test-room-quality.mjs` reads this
  // block and verifies each claim against the component source:
  //   1. `uBreath` in `reads` → the 7s uniform is declared in FIELD and used
  //      (the lantern, the grass sway, the dust) past its declaration.
  //   2. `createIdleWriter` persists to objetdart:insects:v1; the 20000ms
  //      glimmer is honored (one cricket chirp + a ripple through the swarm).
  //   3. Every verb named in `haptics_grammar` has its `haptics.<pattern>()`
  //      call in the file. Verbs with no haptic (tilt, the surface lean) are
  //      omitted so the check does not misread silence as a hole.
  //   4. `letgo_clears_population: true` — <LetGo> fades every body and writes
  //      the meadow empty (a deliberate clearing is remembered).
  //   5. `ceremony_is` — the mantis released at the tier-3 hold, the room's
  //      one solemn act and its touch-reachable thinning of the swarm.
  life: {
    population: {
      objects: [
        {
          noun: "insect",
          max_count: 80, // SWARM_CAP from @/lib/insects
          state_shape:
            "id, seed, nx, ny, vx, vy, stage (egg|larva|imago), role (mote|pollinator|predator), mature (ms of metamorphosis), bornMs, bred (ms of last brood), presence",
          lifecycle:
            "born as an egg under a dwell (layClutch scatters a clutch on the grass) → the metamorphosis clock turns at rest so egg → larva → imago (stageOf(mature)), and a continued dwell advances the brood a whole stage at a time (broodAdvance) → an imago mote flocks, a pollinator takes the light, and two mature motes that meet lay a new egg (layEgg, a third body neither parent) → hunted down by a released mantis (huntCatches sets it fading) → retires via <LetGo>, the swat (flick), or SWARM_CAP overflow (retireOldest, oldest first)",
          persistence: "localStorage",
          creates_via_verb: "dwell",
          retires_via: ["LetGo", "predator", "flick", "SWARM_CAP overflow"],
          implementation_hint: "inline array (swarm) + createInstanceBuffer/createPopulationLayer, persisted through createIdleWriter",
        },
      ],
    },
    breath: {
      period_seconds: 7,
      reads: ["uBreath uniform (FIELD shader — lantern glow, grass sway, and drifting dust all ride it)"],
      behavior_at_rest:
        "the lantern low at the meadow's edge swells and dims on the 7s breath, the grass silhouette sways with it, and dust drifts through the dusk air — while the flock mills by boids and any laid clutch quietly hatches. the meadow is never still.",
    },
    glimmer: {
      after_idle_ms: 20000,
      visual:
        "after ~20s of no touch and no vessel event, one imago (chosen deterministically from a hashed second) chirps and a short ripple of scent-light passes through the swarm — one breath long, and nothing is said.",
    },
    haptics_grammar: {
      tap: "ripple",     // startle / hush → haptics.ripple(...)
      dwell: "ripple",   // lay a clutch → haptics.ripple(0.45)
      ceremony: "storm", // release the mantis → haptics.storm()
      drag: "tap",       // draw a scent trail → haptics.tap()
      flick: "chop",     // swat → haptics.chop()
      twist: "lens",     // raise the lens → haptics.lens()
      twist3: "detent",  // turn the season → haptics.detent()
      tap3: "roll",      // tutti → haptics.roll()
      hold3: "tap",      // time dilation enter → haptics.tap()
      scrub: "ripple",   // stir a gust → haptics.ripple(0.35)
      knock: "detent",   // rap on the case rings the meadow → haptics.detent()
      shake: "chop",     // agitation scatters the swarm → haptics.chop()
      flip: "detent",    // face-down night → haptics.detent()
    },
    make_unmake: {
      letgo_clears_population: true,
      ceremony_is:
        "releases a mantis (an imago predator) that hunts the nearest prey and thins the swarm on the shared trophic law — the room's one solemn act, fired by a hold to the ceremony tier, and its touch-reachable way to cull what has overgrown",
    },
  },
} as const satisfies RoomManifest;

export default insects;
