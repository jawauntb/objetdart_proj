// object-compiler template — docs/plans/object-compiler.md M3.
// Consumes: spec.key, spec.route, spec.sigil, spec.desc, spec.cluster,
//           spec.dark, spec.home_priority, spec.placement, spec.icon (palette
//           + names), spec.guide (title/scale/essence/moves/finds/keeps).
// Deterministic — no LLM slot. Every field comes from the spec.
import type { RoomManifest } from "@/rooms/types";

/**
 * /spring — the spring — head, seep, ring.
 *
 * See docs/new-room.md §1 — placed once, in this manifest, and derived from there.
 */
const spring = {
  key: "spring",
  href: "/spring",
  sigil: "growth",
  desc: "the aquifer, ringing at its head",
  cluster: "nature",
  dark: true,
  place: {
    kind: "peer",
    circle: "cabinet",
    band: "drop",
    label: "the spring",
    ringAfter: "soil"
  },
  icon: {
    title: "the spring — head, seep, ring",
    description: "the aquifer, ringing at its head",
    path: "/spring",
    shortName: "spring",
    kind: "growth",
    // phase-8 visual pass: bg2 turns from a second teal into a real
    // wet-ground brown, and glow/accent2 both brighten so the water
    // surface and the mineral bloom read as distinct pixels instead of
    // dark siblings of the aquifer. See
    // data/object-compiler/audits/phase-8-spring-visual.md.
    bg: "#060a10",
    bg2: "#2e2013",
    glow: "#d7f2fb",
    accent: "#3f9dc2",
    accent2: "#e3ac57",
    ink: "#e6efe8",
  },
  guide: {
    title: "the spring — head, seep, ring",
    scale: "the drop band — cabinet peer behind the soil, ahead of the coin: a hand's width of wet ground in section, where the aquifer under it breaches and its water rings its own head.",
    essence:
      "a two-cell hydraulic ledger — an aquifer under the ground and a small pool over it — with a seep between them and a lip the pool spills over. the water's pitch IS the head that pushed it up, so from the ringing you can read the depth of the water below the ground; nothing on the shelf is created except what the rain gives back or the sun quietly takes.",
    moves: [
      "tap → a ripple, and the water rings at the local head; deep water rings low, and where the finger lands the pool answers first",
      "rapid taps (1 / 3 / 5 / n) → a ring → the pool's chord: fundamental, fifth and octave of the live head → a breath of bubbles shaken loose → the whole ledger rings, wider with every extra tap",
      "dwell → plants a seep, its rate climbing the head under it; keep pressing and the seep's throat widens, drawing more of the aquifer through",
      "ceremony (hold to the tier) → opens the seep to the aquifer at full — a small artesian rise, kept between visits",
      "drag → the surface film slides, and the pool climbs the far edge; layers of the pool slip against each other without changing the ledger",
      "flick → throws the standing bubble at that point — a cast bell over the water, the ring the head that shaped it",
      "twist → raises the flow lens: H(t), L(t), the flux between, the weir line, and the pool as a barometer of the aquifer below it",
      "twist3 → turns the year; from thaw's peak flow to summer's low, the aquifer emptying and refilling",
      "tap3 → tutti; every seep and every bubble rings at once, one chord across the whole ledger",
      "drag3 → the world-law: down is rain (W up), across is evaporation (E up or down)",
      "hold3 → time dilation while held; the ledger's clock runs slow",
      "scrub → stirs the pool from above; the surface rotates until the vorticity bleeds off through the walls",
      "drum (two hands alternating) → the wave field between them sings its beat over the pool",
      "arrows → walk the surface cursor; enter held plants and deepens a seep at the cursor; escape lowers the lens",
      "tilt / shake / knock / flip (once invited) → the pool leans, the surface scatters, a struck stone rings the pool, face-down is night",
    ],
    finds: [
      "the pitch is the head, and the map is invertible — a ring of the same note twice comes from the same depth of water below",
      "a spring left running through summer empties its aquifer; a rainy fortnight refills it and the pitch climbs by itself",
      "two seeps within a hand's width share the same aquifer, so widening one quiets the other — the head is common",
      "a drowned lip stops giving: raise the pool past the weir crest and the flux out of it exceeds what the seep can put in",
      "the water's ring was in the ground before you touched it — a fortnight's absence is read off a closed-form ledger, not replayed",
      "a wide-throated seep bubbles on its own, unasked — the air it breathes rises and pops at the surface at a rate that is just the flux, seen",
    ],
    keeps: "the current head, the pool level, every seep with its throat and its ring, the season the year had reached, and the hour it was last looked at.",
    plain: {
      what: "this room is a natural spring: a small pool fed from underground water through openings you make in the ground. the note of every ripple is the pressure of the water below, so you can hear how full the ground is.",
      how: [
        "tap → a ripple; its note tells you the water pressure underneath — deep water rings low",
        "press and hold → opens a seep in the ground; keep holding and it widens, letting more water through",
        "hold to the deepest tier → the seep opens fully and stays open between visits",
        "flick → tosses the standing bubble; it rings like a little bell where it lands",
        "drag three fingers → down is rain refilling the ground, across is the sun drying it out",
        "twist three fingers → turns the year: the thaw runs high, late summer runs low",
        "watch an open seep → it bubbles on its own, exactly as fast as the water flows",
      ],
    },
  },
  // ——— the room quality bar, structured ————————————————————————————————
  // AGENTS.md §"The room quality bar" items 3, 5 and 6, declared per
  // Spring.tsx as it is today. Round-trip-derived from the component
  // source; the audit at data/object-compiler/audits/phase-3-recompile.md
  // says what each claim refers to in the file. Only verbs that DO fire a
  // haptic appear in `haptics_grammar` — a verb with no haptic (surface
  // drag, world-law wind, time dilation, tilt/shake/flip) is omitted, so
  // scripts/test-room-quality.mjs does not misread silence as a hole.
  life: {
    population: {
      objects: [
        {
          noun: "seep",
          max_count: 16,
          state_shape: "id, nx, ny, throat (0..MAX_THROAT=1), sealed (bool), t0, phase seed",
          lifecycle:
            "born under dwell (plantSeep at throat 0) → throat widens on saturating curve DWELL_THROAT_MAX·(1 − exp(-elapsed / THROAT_WIDEN_TAU_MS)) while held → sealed at ceremony (throat = MAX_THROAT, sealed=true, kept between visits) → retires only via <LetGo>",
          persistence: "LetGo",
          creates_via_verb: "dwell",
          retires_via: ["LetGo"],
          implementation_hint: "SceneObjectSpec",
        },
        {
          noun: "bubble",
          max_count: 28,
          state_shape: "id, nx, ny, vy (rise rate), wobbleAmp/wobbleFreq/wobblePhase, r0, popping (bool)",
          lifecycle:
            "born from an open seep's flux (spawn budget accumulates as fluxBright·rate·dt, no RNG in the timing) → rises and wobbles on its own seeded sine → pops the instant it crosses the waterline (popping=true, presence begins the population's own graceful fade) → never persisted, always ephemeral",
          persistence: "ephemeral",
          creates_via_verb: "(automatic — spawned by an active seep, not a hand verb)",
          retires_via: ["waterline crossing", "LetGo"],
          implementation_hint: "SceneObjectSpec",
        },
      ],
      depth_note:
        "the two populations share one ledger: a seep's live flux (springflow.ts) is the bubble population's only spawn source, so a wider throat is not just a brighter corona — it visibly bubbles harder. Both populations write into the same instanced draw call.",
    },
    // phase-8 visual pass: the FRAG's `// layer:` labels, one per named
    // register. See data/object-compiler/audits/phase-8-spring-visual.md.
    shader_layers: [
      { name: "sky_and_clouds", order: 1, register: "background", visible_change: "a faint fbm cloud streak rides the horizon band" },
      { name: "seep_wet_halo", order: 2, register: "underwater+ground", visible_change: "every seep's halo is monotone in flux, visible whether the seep sits in open water or in the wet ground below the floor" },
      { name: "refraction_wobble", order: 3, register: "underwater", visible_change: "a small horizontal sine displacement bends the caustic and ripple sampling below the waterline" },
      { name: "underwater_column", order: 4, register: "pool", visible_change: "a shallow-to-aquifer depth gradient, the Snell surface highlight, and an fbm caustic shimmer tinted glow" },
      { name: "wet_ground_moisture", order: 5, register: "ground", visible_change: "moisture runs from bg2 (wet, dark, at the waterline) to a pale dry tone with distance from the water in either direction" },
      { name: "mineral_bloom", order: 6, register: "ground", visible_change: "accent2 patches gated by fbm, amplitude monotone in moisture — invert a lit patch's brightness and recover the local wetness" },
      { name: "vignette_and_night", order: 7, register: "overlay", visible_change: "corner falloff and the night multiply, unchanged in kind from the room's other passes" },
    ],
    breath: {
      period_seconds: 7,
      reads: ["uBreath"],
      behavior_at_rest:
        "three visible registers ride the 7s clock: the air column brightens by ±14%, the Snell surface highlight rides ±15%, the mineral bloom at the wet edge swells by ±40%. Between taps the pool is never still.",
    },
    glimmer: {
      after_idle_ms: 20000,
      visual:
        "one seep breathes a wider ring, alone, and nothing is said — the glimmer handler picks a seep and pushes a soft ripple.",
    },
    haptics_grammar: {
      tap: "ripple",     // ringHere → haptics.ripple(0.3 + weight * 0.35)
      dwell: "tap",      // plant() lands one haptics.tap()
      ceremony: "bloom", // sealSeep → haptics.bloom()
      flick: "chop",     // bubble thrown → haptics.chop()
      twist: "lens",     // lens raise/lower → haptics.lens()
      twist3: "detent",  // season detent on release
      tap3: "roll",      // tutti → haptics.roll()
      drum: "tap",       // beat between two zones → haptics.tap()
      knock: "detent",   // struck stone rings the pool → haptics.detent()
      arrows: "tap",     // keyTap → ringHere → haptics.ripple is the audible half; a tap is the tactile half
    },
    make_unmake: {
      letgo_clears_population: true,
      ceremony_is:
        "seals the seep at full throat — the aquifer opens, kept between visits as a small artesian rise in the pool",
    },
  },
} as const satisfies RoomManifest;

export default spring;
