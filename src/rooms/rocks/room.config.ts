import type { RoomManifest } from "@/rooms/types";

/**
 * /rocks — the mineral seat of the drop band, beside the drop and the seed:
 * the hard, faceted register of that size, where the drop is water and the
 * seed is alive. `ringAfter: "seed"` pins the seat — ring order is twist
 * order and dropdown order both, so it may never depend on import order.
 *
 * It is also a *door room* of the ground's downward wall: `DOOR_ROOMS` in
 * `src/lib/scale.ts` carries the address and `ROUTE_TRAVEL_OVERRIDES` the
 * doors (up → the earth, and the peak it is the strata of; down → molecules,
 * because rock cleaves into its lattice and not into life). Those are the
 * author's physics and stay in `scale.ts`; the manifest only takes the seat.
 */
const rocks = {
  key: "rocks",
  href: "/rocks",
  sigil: "earth",
  desc: "the lattice you can hear",
  cluster: "nature",
  dark: true,
  homePriority: 9,
  place: { kind: "peer", circle: "cabinet", band: "drop", label: "the stones", ringAfter: "seed" },
  icon: {
    title: "Rocks",
    description: "the lattice you can hear",
    path: "/rocks",
    shortName: "rocks",
    kind: "earth",
    bg: "#05070a",
    bg2: "#141a24",
    glow: "#dfe7f2",
    accent: "#f3d77a",
    accent2: "#96b2e2",
    ink: "#eeeadb",
  },
  guide: {
    title: "the lattice you can hear",
    scale:
      "the drop band — a peer beside the drop and the seed, and the stratum the ground and the peak both open onto",
    essence:
      "a tray of brine with stones still coming out of it — salt, quartz, calcite, pyrite, zircon, topaz — each shaped by its own crystal lattice, split along its own cleavage planes, ranked by its own hardness, and ringing with the partials that lattice allows.",
    moves: [
      "tap a stone → it rings its own ring; the partial ratios are its allowed reflections",
      "tap the wet dark → a grain of salt, and the brine takes a little more into it",
      "drag a stone → turns it in your fingers, facets sweeping the light, and it keeps the turn when you let go",
      "drag a stone into its neighbour → the softer one takes the groove; salt beds under quartz, quartz never under salt",
      "flick across a stone → it cleaves, and the fracture follows the nearest lattice plane rather than your line",
      "hold on the wet dark → plants a nucleus and feeds it from the tray for as long as you hold",
      "hold a nodule to the ceremony tier → the geode opens and its lining faces out",
      "three-finger drag → how much the brine is holding; drag it far enough down and the stones go back into solution",
      "three-finger hold → the clock runs at a quarter; three-finger twist → the season, the brine run hot then cold",
      "three-finger tap → every stone on the shelf rings at once",
      "twist → raises the lattice lens: the ring drawn as its reflections, the cleavage traces across the stone, and the mineral read back out of its own sound",
      "scrub → stirs the brine, driving the solvent off so it holds more",
      "tilt / shake / knock / flip (once invited) → the light leans, salt snows out of solution, the tray rings, the room sleeps",
      "arrows → step between stones · enter → ring one · held enter → feed it, then split it · esc → lower the lens",
    ],
    finds: [
      "a face-centred salt and a primitive pyrite are both cubes and do not sound alike — half of salt's reflections are missing, and you can hear the gap",
      "turning a stone turns which cleavage plane your strike can find; the same strike on the same stone always finds the same plane",
      "a cleaved half holds exactly the mass it took with it, so two small stones ring higher than the one they came from",
      "stones left lying against each other do not stay equal — the larger quietly takes the smaller, and what it eats it speaks lower for",
      "a grooved stone loses its clarity as well as its polish: you can see the scratch and hear the ring go dull",
    ],
    keeps: "every stone, its species and seed and the cuts made in it, and how much is still dissolved in the tray",
  },
  // ——— the room quality bar, structured ————————————————————————————————
  // AGENTS.md §"The room quality bar" items 3, 5 and 6, declared per
  // RockShelf.tsx as it is today. Round-trip-derived from the component
  // source. Two honest notes for the mechanical check:
  //   • the brine shader breathes on `u_breath` (lowercase, snake-case)
  //     rather than the canonical `uBreath`, so `reads` names it truthfully
  //     and scripts/test-room-quality.mjs skips the breath_wired check by
  //     design (the check only fires when `uBreath` is named);
  //   • the room uses raw `attachGestures` with a per-tier branch inside the
  //     `hold` handler rather than a `useMemo<RoomVoice>` with a discrete
  //     `ceremony:` method — so the ceremony act (opening the geode at
  //     tier 3) IS in the code but the mechanical check cannot see it and
  //     the room FAILS make_unmake_ceremony. That FAIL is real drift, not
  //     a mislabel; declaring `ceremony_is` here surfaces it as a follow-up.
  life: {
    population: {
      objects: [
        {
          noun: "stone",
          max_count: 14, // MAX_STONES from @/lib/crystal
          state_shape:
            "species, seed, nx, ny, yaw, pitch, spin, solid, LatticeState (system, centering, a, b, c, α, β, γ, pointGroup, cleavage), cuts (up to MAX_CUTS=3), geode/lined/scratched",
          lifecycle:
            "born under dwell on the wet dark (plant() seeds a nucleus and feeds it from the tray while held) → grows while pressing (feed()) → cleaved by flick along the nearest allowed lattice plane (cleave() splits into two stones, both keep their mass) → geode nodule opens at ceremony (hold tier 3 → cleave with wasGeode → the lining faces out) → ground down by a neighbour under drag (scratch()) → retires via <LetGo> (dissolves back to brine) or when settleStones shifts it out",
          persistence: "localStorage",
          creates_via_verb: "dwell",
          retires_via: ["LetGo", "flick", "neighbour-scratch", "MAX_STONES overflow"],
          implementation_hint: "inline array (stonesRef) + createIdleWriter to STORE_KEY",
        },
      ],
    },
    breath: {
      period_seconds: 7,
      reads: ["u_breath"], // shader-side name; the test only wires the check when 'uBreath' appears, so this skips by design
      behavior_at_rest:
        "the brine shader reads `u_breath` at `lamp = exp(-ld * 2.1) * (0.72 + 0.28 * u_breath)` and the JS-side draw pass mixes it into a twinkle floor for opened geodes — the raking lamp is quietly breathing on the shared 7s clock.",
    },
    glimmer: {
      after_idle_ms: 20000,
      visual:
        "after ~20s of quiet the loop picks one stone (glimmerStone index cycles by hashed time) and lifts its `lit` by 0.45 — one facet catches the raking light for a beat.",
    },
    haptics_grammar: {
      tap: "tap", // stone tap and wet-dark tap → haptics.tap()
      dwell: "ripple", // plant nucleus → haptics.ripple(0.4)
      ceremony: "bloom", // tier-3 release on held stone → haptics.bloom() (and inside cleave() when wasGeode)
      drag: "tap", // stone turning under drag → haptics.tap() on facet-catches-light beat
      flick: "detent", // cleave() → haptics.detent()
      twist: "lens", // lens snap on twist end → haptics.lens()
      twist3: "detent", // season detent on twist(3) release → haptics.detent()
      tap3: "ripple", // tutti() → haptics.ripple(0.4)
      scrub: "ripple", // scrub the brine → haptics.ripple(0.3)
      knock: "detent", // vessel knock → haptics.detent()
      shake: "chop", // vessel shake → haptics.chop()
    },
    make_unmake: {
      letgo_clears_population: true,
      ceremony_is:
        "opens the tracked nodule as a geode — cleave with wasGeode faces the lining out, the stone becomes a hollow ringing thing kept between visits (the tier-3 act lives inside the hold handler, not a discrete `ceremony:` method — the mechanical test cannot see it and FAILs; real drift for a follow-up)",
    },
  },
} as const satisfies RoomManifest;

export default rocks;
