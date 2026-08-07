import type { RoomManifest } from "@/rooms/types";

/**
 * /observe — the sample under the beam.
 *
 * A shallow cuvette of solvent seen from above, dissolved with a molecular
 * sample (the o-chlorophenyl cyclohexanone family — an aromatic π→π* band
 * around 260 nm and a carbonyl n→π* band around 285 nm). The visitor's hand
 * is the beam: the horizontal axis of the frame is a hidden wavelength axis
 * from 200 nm at one edge to 800 nm at the other, and touching sends a
 * coherent shaft of that color down through the bath. Molecules whose
 * transition matches the photon energy briefly ignite — a shudder and an
 * outer glow — then relax back to ground and dump the energy as a heat
 * ripple; molecules the beam does not resonate with pass it through. The
 * far wall paints Beer-Lambert transmittance.
 *
 * The room sits in the cabinet ring at the drop band, beside /coin, /watch,
 * /jewel and /tourbillon — the instruments-that-are-rooms. It is a lateral
 * peer, not a rung on the axis, so its scale address lives in
 * LATERAL_ROUTE_BANDS.
 */
const observe = {
  key: "observe",
  href: "/observe",
  sigil: "waves",
  desc: "the sample · the beam finds its band",
  cluster: "mechanism",
  dark: true,
  place: {
    kind: "peer",
    circle: "cabinet",
    band: "drop",
    label: "the sample",
    ringAfter: "jewel",
  },
  icon: {
    title: "the sample · the beam finds its band",
    description:
      "a shallow cuvette from above; a violet-to-red rainbow axis lies hidden under the bath, and molecules ignite where the beam finds their band",
    path: "/observe",
    shortName: "observe",
    kind: "waves",
    bg: "#050912",
    bg2: "#0b1524",
    glow: "#f2e4b0",
    accent: "#8a3ad8", // deep violet — the UV end of the axis
    accent2: "#d84a3c", // red — the far end
    ink: "#f0edd8",
  },
  guide: {
    title: "the sample · the beam finds its band",
    scale:
      "the drop band — cabinet peer beside the coin and the jewel: a shallow bath from above, dissolved with an aromatic cyclohexanone family (an o-chlorophenyl derivative). the room's horizontal axis is a hidden wavelength axis, 200 nm at one edge to 800 nm at the other; the finger picks the wavelength, the beam finds its band.",
    essence:
      "molecules drifting in Brownian motion, and a beam of coherent light the hand aims through them by wavelength. on-band the beam is swallowed — the molecule shudders, its outer cloud brightens the color of the emission, then it relaxes and the wall behind it darkens. off-band the beam passes through and paints the far wall bright. a sweep of the finger builds the sample's own absorbance curve along the top of the cuvette from felt experience, not from a chart.",
    moves: [
      "tap → fire one photon at that wavelength toward the nearest molecule; it either resonates and ignites, or passes",
      "rapid taps (1 / 3 / 5 / n) → a photon → a burst at that wavelength → a mid-band diode-array snapshot → the whole white beam and every resonant molecule alight",
      "hold → a droplet of substance falls at that position; molecules gather and multiply as long as the finger stays down",
      "hold to the ceremony tier → seals the current spectrum as a kept sigil; the curve returns whenever the room does",
      "drag → sweeps the beam across the bath; the ghost spectrum along the top edge accumulates as it goes",
      "flick → whips the beam across; a bright streak paints the wall, molecules along the path shake once",
      "twist → cycles the lens: raw beam and molecules → normalized absorbance versus wavelength → an orbital diagram with the ground and excited states drawn faintly",
      "twist3 → concentration up or down; deeper concentration means more molecules and deeper wells in the accumulated spectrum",
      "three-finger drag → wind through the solvent; the population churns and drift velocities rise",
      "three-finger hold → time dilation; the absorb → relax cycle slows so the electron jump and the return can be seen",
      "three-finger tap → the diode array fires: every wavelength at once, every resonant molecule briefly lit, the ghost spectrum flashes complete",
      "two-finger tap → step back through the lens tiers",
      "two still fingers held apart → a sustained beam at the midpoint wavelength; molecules resonant with that λ keep re-exciting for as long as it is held",
      "scrub (a winding path) → stirs the solvent; a vortex briefly forms",
      "tap a steady beat → the beam's intensity rides your tempo",
      "tilt / shake / knock / flip (once invited) → the solvent leans, the sample fizzes with thermal broadening, a knock is the chopper (every excited molecule falls to ground at once), face-down dims everything but the two absorption bands the sample lives at",
    ],
    finds: [
      "the two bands the sample lives at are its fingerprint: the strong one near true violet and the shallow, broader shoulder to its right — the shape of the ghost curve is the whole identity of the compound",
      "shaken (or held under a knock's thermal loading) the bands widen and shallow at once — a real sample is not a cold spectrum, and the room reads that",
      "a wavelength between the bands paints the wall almost as bright as pure water — this sample is transparent through most of the visible",
      "the beam intensity breathes with the album's 7s candle — a patient hand feels the room breathe with the site",
    ],
    keeps:
      "the ghost spectrum you built and the standing population of molecules, at the concentration and wavelength you left the beam on",
  },
  // ——— the room quality bar, structured ————————————————————————————
  life: {
    population: {
      objects: [
        {
          noun: "molecule",
          max_count: 220,
          state_shape:
            "id, seed, x, y (normalized in the cuvette plane), vx, vy (Brownian drift), excited (0..1 excited-state charge), lastAbsorbMs, lastLambda (the beam wavelength that lit it), presence",
          lifecycle:
            "born under a dwell (a droplet of substance falls at the finger; molecules gather and multiply) → drifts on seeded Brownian noise → absorbs when a beam of a wavelength inside a band lands on it (excited state climbs, lastLambda records the color of the emission) → relaxes back exponentially with tau ~450ms, dumping the energy → retires via <LetGo> or when the population exceeds MOLECULE_CAP (oldest first)",
          persistence: "localStorage",
          creates_via_verb: "dwell",
          retires_via: ["LetGo"],
          implementation_hint: "SceneObjectSpec",
        },
      ],
    },
    breath: {
      period_seconds: 7,
      reads: ["uBreath uniform (beam intensity rides ±20% on the 7s clock)"],
      behavior_at_rest:
        "the beam's brightness breathes with the album's 7s candle; the ghost spectrum's opacity rides the same clock, so the whole scene inhales together",
    },
    glimmer: {
      after_idle_ms: 20000,
      visual:
        "a lone molecule briefly ignites at a wavelength deterministic in the room's own seed — the sample glimmers on its own after ~20s of quiet, never with text",
    },
    haptics_grammar: {
      tap: "ripple",
      dwell: "tap",
      ceremony: "bloom",
      drag: "tap",
      flick: "chop",
      twist: "lens",
      twist3: "detent",
      tap3: "roll",
      drag3: "roll",
      hold3: "tap",
      scrub: "tap",
      knock: "detent",
      shake: "storm",
    },
    make_unmake: {
      letgo_clears_population: true,
      ceremony_is:
        "seals the accumulated ghost spectrum as a kept sigil at the objetdart:observe:v1 key — the sample's UV/Vis fingerprint held between visits",
    },
  },
} as const satisfies RoomManifest;

export default observe;
