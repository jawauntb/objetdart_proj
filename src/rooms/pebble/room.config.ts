// object-compiler template — docs/plans/object-compiler.md M3.
// Consumes: spec.key, spec.route, spec.sigil, spec.desc, spec.cluster,
//           spec.dark, spec.home_priority, spec.placement, spec.icon (palette
//           + names), spec.guide (title/scale/essence/moves/finds/keeps).
// Deterministic — no LLM slot. Every field comes from the spec.
import type { RoomManifest } from "@/rooms/types";

/**
 * /pebble — one stone, cut open.
 *
 * See docs/new-room.md §1 — placed once, in this manifest, and derived from there.
 */
const pebble = {
  key: "pebble",
  href: "/pebble",
  sigil: "earth",
  desc: "one stone, cut open",
  cluster: "nature",
  dark: true,
  place: {
    kind: "peer",
    circle: "cabinet",
    band: "drop",
    label: "the pebble",
    ringAfter: "geyser"
  },
  icon: {
    title: "one stone, cut open",
    description: "one stone, cut open",
    path: "/pebble",
    shortName: "pebble",
    kind: "earth",
    bg: "#040608",
    bg2: "#0f141c",
    glow: "#e9d9a6",
    accent: "#b48c5a",
    accent2: "#8ba0c0",
    ink: "#f2ecd9",
  },
  guide: {
    title: "one stone, cut open",
    scale: "the drop band — cabinet peer behind the rocks: one water-worn stone held to the light, its section facing you.",
    essence:
      "one pebble, cut open along its own cleavage plane. the interior is the lattice's growth history — concentric rings each with their own metric spacing, cleavage traces drawn as ink lines under the polish. the outer shell is the Wulff hull relaxed by abrasion: the more the water has carried it, the smoother the envelope. the sound is the lattice you can hear (kept from the tray), damped by the polish so a well-worn pebble rings shorter than a fresh crystal — the polish depth is audible.",
    moves: [
      "tap the stone → it rings its own partials, damped by its polish; a fresh crystal rings long, a polished pebble rings short",
      "rapid taps (1 / 3 / 5 / n) → a ring → the lattice's triad sounds as one chord → a knap flashes along the cleavage plane nearest the blow → the full bell rolls and the section spins in the light",
      "tap the dark → the cabinet answers with a low grain",
      "hold on the polished shell → rubs it deeper; the polish grows and the higher partials quiet",
      "hold to the ceremony tier → the stone is polished as far as the lattice will let it; kept between visits",
      "drag → turns the stone in its section; cleavage traces sweep with the lattice, the ring lines rotating in place",
      "flick across the stone → cleaves along the nearest allowed plane; both halves keep their mass and their growth history",
      "three-finger drag → the world-law: horizontal is water-carry (down = older/smoother), vertical is lattice pressure (up = harder mineral)",
      "three-finger twist → seasons of the stream; the stone gets younger and rounder or older and more angular",
      "three-finger hold → clock slows; a season of carry can be inspected",
      "three-finger tap → tutti; every growth ring rings at once, one chord across the stone's history",
      "twist → raises the lattice lens: the reciprocal-lattice partials drawn on the section, the polish depth in mm, the cleavage indices",
      "scrub → stirs the cabinet air; the polish shine changes as the raking light angle shifts",
      "drum (two hands alternating) → drops felt taps at both points; the stone rings the ratio of their distances",
      "arrows → step between growth rings; enter → ring the current ring; held enter → polish that ring's boundary; esc → lower the lens",
      "tilt / shake / knock / flip (once invited) → the section leans, the polished surface catches a moving lamp, a knock rings the stone as a struck bell, face-down is night",
    ],
    finds: [
      "the polish is audible — a pebble carried a hundred years rings shorter than a fresh crystal of the same lattice, because the shell damps the higher partials",
      "cleavage still follows the lattice; a flick cuts along a plane the domain names, not an arbitrary line",
      "each growth ring is a chord of its own; the outer rings sound the newer accretion, the inner ring the seed",
      "a well-polished pebble can be brought back — the polish decay can be pushed back to its lattice, at the cost of the shell's mass",
      "the same mineral can be identified from the ring even under deep polish; the load-bearing map only damps, does not erase",
    ],
    keeps: "the pebble's lattice (system, centering, axial ratios), its growth-ring history, the current polish depth, and the season the stream is at.",
  },
  // ——— the room quality bar, structured ————————————————————————————————
  // Round-trip-derived from Pebble.tsx + pebblecore.ts. Pebble's spec-noun
  // is `cut` (what a flick creates), but the persistent population is
  // `growthRings[]` — the stone's own accretion history. The polish depth
  // is the room's load-bearing NEW dimension (rocks doesn't have polish).
  life: {
    population: {
      objects: [
        {
          noun: "growth-ring",
          max_count: 24,
          state_shape: "id, radius, mineral (species), thickness, seed",
          lifecycle:
            "born when growStep adds a ring (rare — driven by brine saturation over long simulated time); grows further while dwell-polishing → sealed at ceremony (polishDepth = POLISH_MAX, kept between visits) → retires only via <LetGo>; a cleavage flick splits the whole stone into two, each keeping its own history",
          persistence: "LetGo",
          creates_via_verb: "dwell",
          retires_via: ["LetGo"],
          implementation_hint:
            "inline array — state.growthRings: GrowthRing[] in src/lib/pebblecore.ts. Kept inline: growth rings are ANNULAR tint bands inside the single stone SDF (each entry contributes a smoothstep(radius − t·0.6, radius) − smoothstep(radius, radius + t·0.6) weight to sectionTint), not disc-primitives at various world positions. The population-layer's SDF disc + additive corona is the wrong primitive for concentric-annulus rendering, so the migration would either weaken the invariant ('every growth ring is the domain's growthHistory read live, not decoration') or fork a second population-layer shader. See data/object-compiler/audits/phase-4-population-migration.md.",
        },
      ],
    },
    breath: {
      period_seconds: 7,
      reads: ["uBreath"],
      behavior_at_rest:
        "the stone's interior colour breathes by ±6% on the 7s clock — the mineral body reads as breathing under the polish, the shell's Fresnel highlight tracks the raking light.",
    },
    glimmer: {
      after_idle_ms: 20000,
      visual:
        "the polished shell's highlight brightens for a beat (visual only) — the stone catches the cabinet's raking lamp.",
    },
    haptics_grammar: {
      tap: "ripple",     // tap-open answers with haptics.ripple; tap-on-stone → haptics.tap()
      dwell: "tap",      // polishStep tick per hold-cadence lands on haptics.tap()
      ceremony: "bloom", // polishDepth = POLISH_MAX → haptics.bloom()
      flick: "chop",     // cleaves along the nearest allowed plane → haptics.chop()
      twist: "lens",     // lattice lens raise → haptics.lens()
      twist3: "detent",  // season through advanceExact
      tap3: "roll",      // tutti — every growth ring rings at once → haptics.roll()
      drum: "tap",       // two-point tap on the stone
      knock: "detent",   // rings the stone as a struck bell → haptics.detent()
      arrows: "tap",     // step between rings; enter rings the current one
    },
    make_unmake: {
      letgo_clears_population: true,
      ceremony_is:
        "polishes the stone to POLISH_MAX in one commit — kept between visits as the pebble the sea has finished with",
    },
    // The polished shell's raking-lamp highlight is a soft Fresnel falloff
    // by design (a real polish has no hard specular cut), so edge_density
    // sits at 4.2% against the 6% floor even though hue_diversity (8),
    // luminance_range (119), spatial_entropy (5.5) and file_size_floor all
    // clear theirs with real margin. The micro-crystalline stipple and wear
    // scratches added in the phase-9 pass raise edge_density somewhat, but
    // the guide screenshot has not been re-shot in this worktree (no
    // playwright) — the flag stays until it is measured to no longer be
    // needed. See data/object-compiler/audits/phase-9-pebble-and-threshold.md.
    visual: { soft_glow: true },
  },
} as const satisfies RoomManifest;

export default pebble;
