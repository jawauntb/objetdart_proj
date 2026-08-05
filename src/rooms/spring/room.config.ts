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
    bg: "#050a0c",
    bg2: "#0e2530",
    glow: "#a9d8e6",
    accent: "#4a91a8",
    accent2: "#c9b988",
    ink: "#e6efe8",
  },
  guide: {
    title: "the spring — head, seep, ring",
    scale: "the drop band — cabinet peer behind the soil, ahead of the coin: a hand's width of wet ground in section, where the aquifer under it breaches and its water rings its own head.",
    essence:
      "a two-cell hydraulic ledger — an aquifer under the ground and a small pool over it — with a seep between them and a lip the pool spills over. the water's pitch IS the head that pushed it up, so from the ringing you can read the depth of the water below the ground; nothing on the shelf is created except what the rain gives back or the sun quietly takes.",
    moves: [
      "tap → a ripple, and the water rings at the local head; deep water rings low, and where the finger lands the pool answers first",
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
    ],
    keeps: "the current head, the pool level, every seep with its throat and its ring, the season the year had reached, and the hour it was last looked at.",
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
          implementation_hint:
            "inline array — state.seeps: Seep[] in src/lib/springflow.ts, drawn as a uSeeps[16] uniform block. Phase-4 note: not yet migrated to SceneObjectSpec.",
        },
      ],
    },
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
