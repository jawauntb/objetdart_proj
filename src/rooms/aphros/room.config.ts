import type { RoomManifest } from "@/rooms/types";

/**
 * /aphros — the birth room. A full-viewport painting where foam is the
 * material and the ceremony hold is a genuine birth: a gathered bloom
 * ascends into the shell, the goddess brightens, the pod celebrates,
 * the tritons hail, and — for the twenty-five seconds the birthGlow
 * holds — the palette itself shifts from Botticelli warmth to icon
 * white and celestial blue, earthly Aphrodite giving way to heavenly
 * Aphrodite, then cools back to the sensual register as the afterglow
 * decays.
 *
 * See src/components/Aphros.tsx for the shader; this manifest is the
 * felt-bar declaration `scripts/test-room-quality.mjs` reads to audit
 * the room's promises against its source. The old registry row in
 * `src/lib/room-registry.ts` stays — AGENTS.md's coexistence rule —
 * this manifest supplies route/peer/guide/icon derivations.
 */
const aphros = {
  key: "aphros",
  href: "/aphros",
  sigil: "aphros",
  desc: "play the shells",
  cluster: "water",
  dark: false,
  place: {
    kind: "peer",
    circle: "shore",
    band: "coast",
    label: "aphros",
    ringAfter: "pretext",
  },
  icon: {
    title: "Aphros",
    description: "foam, shells, and love",
    path: "/aphros",
    shortName: "aphros",
    kind: "aphros",
    // Palette drawn from the shader's own composition — warm nacre-cream
    // ground with sea-blue deeps, gold-rent horizon, rose flesh: the
    // earthly register the room paints when nothing is being born.
    bg: "#fbf4e7",   // nacre-cream — the paper the painting lives on
    bg2: "#1e5961",  // sea-blue — turq / aegean deep
    glow: "#e6b7a1", // rose-gold — the horizon rent
    accent: "#f4d6c7", // pale rose — the flesh and silk
    accent2: "#157983", // teal-blue — the shell's shadow
    ink: "#24383d",
  },
  guide: {
    title: "the birth room · foam gathered into her shell",
    scale:
      "the coast band — shore peer beside the pretext and the reef: a full-viewport painting of the Triumph of Galatea, held at a scale no ruler can measure — the invariant composition of a low sun pouring light down a glitter path into a great scallop of nacre standing in the sea, foam gathering around it, dolphins as dark arcs under the swell, a shore of wet mirror-sand at the bottom of the frame. The material is foam and the ceremony hold is the birth: a gathered bloom ascends into the shell, the goddess brightens, and — for the twenty-five seconds the birthGlow holds — the palette itself shifts from Botticelli warmth to icon-white and celestial-blue, earthly Aphrodite giving way to heavenly Aphrodite, then cools back to the sensual register as the afterglow decays.",
    essence:
      "everything visible is one shader painting — no SVG, no icon, no band, no button. Foam is the countable material: one finger stirs it into wakes, a hold gathers it into a phyllotaxis bloom, and a long-held release lets that bloom ASCEND into the shell — the room's one solemn act, felt as her birth. On that ascent the sea answers: the goddess brightens, all three dolphins boost into celebration play, the three tritons hail together, a birth ripple radiates outward, and the palette shifts from earthly Aphrodite (rose, gold, ochre, sea-blue) to heavenly Aphrodite (white, celestial-blue, halo-cream) for the twenty-five seconds the birthGlow holds. Two-finger twist rotates the lens: the same sea as painting or as its own preparatory sepia drawing. Three fingers are the law — drag is wind, hold dilates time, tap is a tutti. The device is the vessel: tilt leans the swell, a shake raises a squall, a knock surges the whole sea, face-down is night.",
    moves: [
      "tap on open water → a kiss of foam and a note chosen by the finger's position on the shell scale",
      "tap on a figure → each answers in its own register: the woman with a bell and her glow, a cherub with a barrel roll, a hippocamp with a rear, a triton with a low dive, a dolphin with a burst of play, a silk with a billow",
      "rapid taps (1 / 3 / 5 / n) → foam → the pod leaps → the whole sea blooms under the shell's own light → a squall breaks in triads",
      "tap on a bloom (tier 3) → bursts it into daughters, area-conserving (child size² summed equals the parent's), thrown outward on golden angles",
      "hold on open water → plants a lace bloom that keeps gathering the longer you hold; hold on an existing bloom to seal it",
      "hold to the ceremony tier and release → the gathered bloom ASCENDS into the shell — her birth — and everything answers: the goddess brightens for twenty-five seconds, a chord of root-third-fifth sounds, a ripple of foam kisses radiates outward for two seconds, the pod boosts into fifteen seconds of celebration, all three tritons hail together, and the palette shifts from earthly Botticelli warmth to heavenly icon-white and celestial-blue for the duration of the afterglow, then cools back to earthly as the birthGlow decays",
      "twist → rotates the lens: the painting crossfades into its own preparatory sepia line-drawing on parchment, the identical fields as contours",
      "twist3 → turns the season through the water's own light, warm to cool and back over the room's slow cycle",
      "drag → stirs the water; a wake follows the finger, foam gathers under it, the note deepens with speed",
      "drag3 → three fingers wind through the shore; the sea leans on the shore-wind",
      "hold3 → three fingers dilate the shore's time; the dilation deepens as long as the hand stays",
      "tap3 → tutti; every bloom flashes at once, the sea answers in a chord, exactly as hard as the hand asked",
      "pan2 → two fingers pan the frame in a small elastic look-around; springs home when released",
      "two-finger tap → step back: a raised drawing lowers first, or the elastic frame springs home and the sea settles",
      "scrub → winds a whirlpool; deeper circling churns a stronger wake, speed whitens the lace, direction picks the note",
      "a steady tap tempo → the surf entrains: wakes break at the shell on your pulse for ten seconds, steadier hands stirring more sea",
      "breath (on the candle) → the foam brightens a moment, the album's respiration reaching the shader",
      "arrows / space / L / Enter → wind, a kiss at the shell, the lens toggle, a bloom planted",
      "tilt / shake / knock / flip (once the vessel is invited) → the swell leans, a squall breaks, a knock surges the whole sea in a full-storm wake, face-down is night and the shore eases to a slow watch",
    ],
    finds: [
      "the ceremony is her birth — earthly Aphrodite births heavenly Aphrodite; the palette shifts from Botticelli warmth (rose, gold, ochre, sea-blue) to icon-white and celestial-blue for the twenty-five seconds the afterglow holds, then cools back to earthly as it decays",
      "on that birth, all three tritons glow at once and the pod boosts into celebration play — the sea audibly and visibly celebrates the ascent",
      "the dolphins' leaps genuinely push wakes into the shader when they break the water; a struck dolphin plays harder for the next four seconds",
      "after twenty seconds of quiet, foam gathers at the shell unbidden — the glimmer the whole album speaks, never with text",
      "the population cap gives way visibly: burst a bloom past twelve and the oldest ascends into the shell rather than vanishing silently — every birth is seen",
      "the woman herself breathes at rest — the shared 7s respiration lifts her back-lit rim ±10%, so she is alive before the hand touches her",
      "hold your own steady tempo for a few beats and the surf enters that pulse — wakes break at the shell on your rhythm for the next ten seconds",
      "face-down is night: the painting dims as though a hand had covered the candle, and the shore's time eases to a slow watch until you flip her back",
    ],
    keeps:
      "up to twelve living blooms — the ones you planted and gathered, at their sizes and their seeded phyllotaxis phases. Ascended blooms are let go the moment the shell has taken them.",
  },
  // ——— the felt-bar declaration, per scripts/test-room-quality.mjs ————
  life: {
    breath: {
      period_seconds: 7,
      reads: [
        "uBreath uniform (fragment shader — the gold rent at the horizon swells ±15% on the site's respiration)",
        "uBreath uniform (the shell's rim and the halo around it ride ±30% on the same clock, so the nacre inhales with the sea)",
        "uBreath uniform (Galatea's back-lit rim lifts by ±10% at rest — she breathes before the hand touches her)",
        "uBreath uniform (the shell's radius pulses ±0.4% so the scallop is never geometrically still)",
      ],
      behavior_at_rest:
        "three visible registers ride the 7s album breath: the horizon rent swells ±15%, the shell's halo and rim ride ±30%, and Galatea's back-lit rim inhales ±10% — the whole painting breathes together, and she breathes with it before the hand ever touches the canvas.",
    },
    glimmer: {
      after_idle_ms: 20000,
      visual:
        "after twenty seconds of quiet, a soft wake is pushed at the shell on a seeded schedule — foam gathers at her feet unbidden, and nothing is said. The scheduler advances at nine-second intervals; the offset is deterministic from the current time floored, so the same clock hour always answers with the same drift.",
    },
    haptics_grammar: {
      tap: "ripple",
      dwell: "ripple",
      ceremony: "bloom",
      twist: "lens",
      twist3: "tap",
      tap3: "ripple",
      scrub: "ripple",
      shake: "chop",
      knock: "storm",
      flip: "bloom",
    },
    population: {
      objects: [
        {
          noun: "bloom",
          max_count: 12,
          state_shape:
            "nx, ny (0..1 of viewport), size (0.035..0.12 in uv-height units), seed (deterministic phase), born (performance.now() at planting; 0 for restored), ascendAt (0 at rest, else timestamp the ascent began)",
          lifecycle:
            "born under a dwell (a lace bloom gathers at the finger while held; size climbs 0.035 → 0.12 over ~4.2s of hold) → sealed on a ceremony release (tier ≥ 3) which sets ascendAt and starts the 2.4s ascent into the shell — her birth, answered by galateaGlow, birthGlow, dolphin boosts, triton hails, a birth ripple and the palette shift → retires either at the ascent's end, or when the population cap gives way (the oldest ascends rather than vanishing), or via <LetGo> which ascends every kept bloom",
          persistence: "localStorage",
          creates_via_verb: "dwell",
          retires_via: ["ceremony", "LetGo"],
          implementation_hint: "inline array",
        },
        {
          noun: "wake",
          max_count: 14,
          state_shape: "x, y (0..1 of viewport), born (performance.now()), strength (0..1)",
          lifecycle:
            "born on every tap, drag, scrub, shake or ceremony ripple → radiates as a wavefront front = distance - age * 0.09, fading over 2.2 seconds → retires when age exceeds 2.2s or when the oldest is dropped for a fresh one at the cap",
          persistence: "ephemeral",
          creates_via_verb: "tap",
          retires_via: ["age"],
          implementation_hint: "inline array",
        },
      ],
    },
    make_unmake: {
      letgo_clears_population: true,
      ceremony_is:
        "the ceremony hold ascends a gathered bloom into the shell, and the goddess brightens in answer — the room's one solemn act, felt as her birth: the palette shifts from earthly Botticelli warmth to heavenly icon-white and celestial-blue for the twenty-five seconds the afterglow holds, all three tritons hail together, the pod boosts into fifteen seconds of celebration play, a chord of root-third-fifth sounds, and a ripple of foam kisses radiates outward for two seconds.",
    },
  },
} as const satisfies RoomManifest;

export default aphros;
