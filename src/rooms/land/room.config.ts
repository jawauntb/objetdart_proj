import type { RoomManifest } from "@/rooms/types";

/**
 * /land — the lived terrain surface, in the ground cluster ordered small→large:
 * soil (grains) → land (this room) → the ground (tectonics). Between the grain
 * of soil and the plates of the ground, /land is the parcel you stand a boot
 * on: fields and hummocks and hills, topsoil and grass, a heightfield lit by a
 * low sun that you can raise and that the rain takes back.
 *
 * A peer seat in the coast band's cabinet ring; the owner finalizes the circle
 * and `ringAfter`. Its physics — heightfield, erosion/hydrology, vegetation
 * cover — live in `src/lib/land.ts`, node-tested in `scripts/test-land.mjs`.
 */
const land = {
  key: "land",
  href: "/land",
  sigil: "earth",
  desc: "ground you can raise, and rain takes back",
  cluster: "nature",
  dark: true,
  place: { kind: "peer", circle: "hearth", band: "coast", label: "the land", ringAfter: "earth" },
  icon: {
    title: "Land",
    description: "a parcel of living ground — loam and grass under a low warm sun",
    path: "/land",
    shortName: "land",
    kind: "earth",
    bg: "#0c0a08",
    bg2: "#1a140d",
    glow: "#e7c98a",
    accent: "#5c7a3a",
    accent2: "#7fc7d6",
    ink: "#eee6d6",
  },
  guide: {
    title: "ground you can raise, and rain takes back",
    scale:
      "the coast band (~160m–2.5km) — the lived terrain surface between the grain of soil and the plates of the ground: fields, hummocks, hills, topsoil and grass",
    essence:
      "a parcel of living ground rendered as a lit heightfield. it IS its elevation, moisture, " +
      "soil-horizon and vegetation cover all at once — grass greens where the ground is wet and " +
      "flat and thins where it is steep or dry, a slope IS its angle of repose, and water that " +
      "you rain onto it flows downhill, cuts channels, and greens the lowlands. raise ground and " +
      "it settles and greens; carve a valley and the rain finds it; hold long, and a river takes " +
      "a course and keeps it.",
    moves: [
      "tap → pats the ground: a splash soaks in and greens the spot",
      "rapid taps (1 / 3 / 5 / n) → a splash → a spring opens at the point → a downpour bands across the field → a cloudburst breaks over the whole parcel and a flock crosses",
      "rest a finger → raises a hummock that greens as it settles; keep holding and it piles higher, rung by rung, then finds its angle of repose when you lift",
      "drag → sculpts the ground: push up a ridge, or drag downward to carve a valley contour",
      "scrub → rain that follows the circling hand — water to flow downhill and cut channels",
      "flick → a slump: the loose face lets go and slides to its angle of repose",
      "hold to the ceremony tier → sets a watershed: a river finds and keeps its course, incised and kept between visits",
      "twist → the lens: terrain, then hydrology (flow accumulation and the river), then a soil-horizon cross-section",
      "three-finger twist → the season, turning the grass green → gold → frost",
      "three-finger tap → the whole field ripples at once",
      "three-finger drag → wind: it wears the peaks down and lays the dust in their lee",
      "three-finger hold → time dilation — the water and the greening slow the longer it is held",
      "two still fingers → hold the raking light where the hands are",
      "tilt / shake / knock / flip → the light leans and the loose soil settles / the slopes shiver down / the whole parcel jumps / night falls",
      "arrows → move the cursor · enter → raise ground · held enter → keep raising · esc → lower the lens",
    ],
    finds: [
      "water is only ever moved, never made: rain gathers, runs to the low ground, and the parcel is a closed basin — nothing drains off the frame",
      "the soil the flow cuts from the highlands is the same soil it lays in the lowlands, grain for grain — the ground plus its sediment never changes total",
      "a slope steeper than the loam's angle of repose cannot stand: leave it and it slumps until the angle is honoured",
      "the river you set with a long hold is kept between visits, and returns already carving the same course",
      "grass drowns under standing water as surely as it browns on a dry cliff — the greenest ground is the flat wet hollow, not the wet riverbed",
    ],
    keeps: "the whole parcel — its elevation and grass at every cell, and the river's course",
  },
  // ——— the room quality bar, structured ————————————————————————————————
  // AGENTS.md §"The room quality bar" items 3, 5 and 6, declared per Land.tsx.
  // scripts/test-room-quality.mjs reads this block and checks each claim
  // against the component source: the 7s breath in the shaders, the 20s idle
  // glimmer, one haptic per verb, the <LetGo> that flattens the parcel, and
  // the ceremony that sets the watershed.
  life: {
    population: {
      objects: [
        {
          noun: "hummock",
          max_count: 2304, // GRID_N² at the default 48×48 grid (@/lib/land)
          state_shape:
            "a heightfield of GRID_N·GRID_N cells (default 48²), each carrying elevation h, surface water w, sediment-in-transit s, soil moisture m, and vegetation cover g (Float64Array grid in @/lib/land)",
          lifecycle:
            "raised under a dwell (raiseHummock piles a Gaussian bump that greens as its moisture and slope allow) → deepens rung by rung while held → finds its angle of repose on release (slump/settleSlopes) → carved or drowned by rain and flow (stepHydrology cuts channels, greens the lowlands) → worn down by wind (windErosion) → flattened by <LetGo> (flatten levels the whole parcel to its mean)",
          persistence: "localStorage",
          creates_via_verb: "dwell",
          retires_via: ["LetGo", "flick", "wind", "erosion"],
          implementation_hint:
            "heightfield grid (Float64Array fields in @/lib/land) + createIdleWriter to STORAGE_KEY — not a discrete object list",
        },
      ],
    },
    breath: {
      period_seconds: 7,
      reads: ["uBreath (sky shader)", "uBreath (terrain vertex shader — grass sway)"],
      behavior_at_rest:
        "two registers ride the 7s clock: the low sun's glow and the ground haze brighten and dim by ±26% on uBreath in the sky shader, and the grass leans on uBreath in the terrain vertex shader so the whole field sways. Between gestures a cloud shadow drifts, the raking light crosses, and the kept river glints.",
    },
    glimmer: {
      after_idle_ms: 20000,
      visual:
        "after ~20s of quiet a cloud shadow (a distant flock) crosses the field: u_cloud sweeps a soft darkening band across the sky shader over ~6s, picked deterministically from a hashed idle clock — nothing is said.",
    },
    haptics_grammar: {
      tap: "tap", // ground tap → haptics.tap()
      dwell: "ripple", // plant a hummock → haptics.ripple(0.4)
      ceremony: "bloom", // set the watershed → haptics.bloom()
      drag: "chop", // sculpt a ridge/valley → haptics.chop()
      flick: "storm", // slump / landslide → haptics.storm()
      twist: "lens", // lens raise/lower → haptics.lens()
      twist3: "detent", // season detent → haptics.detent()
      tap3: "roll", // tutti ripple → haptics.roll()
      drag3: "chop", // wind erosion → haptics.chop()
      hold3: "tap", // time dilation enter → haptics.tap()
      scrub: "ripple", // rain follows the hand → haptics.ripple(0.3)
      knock: "detent", // the parcel jumps → haptics.detent()
      shake: "chop", // slopes shiver down → haptics.chop()
      flip: "detent", // face-down → night → haptics.detent()
    },
    make_unmake: {
      letgo_clears_population: true,
      ceremony_is:
        "sets a watershed: setWatershed traces the parcel's main channel by steepest descent and inciseRiver cuts it a little deeper — the river finds and keeps its course, kept between visits, the parcel's one solemn act",
    },
  },
} as const satisfies RoomManifest;

export default land;
