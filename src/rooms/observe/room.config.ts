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
  // The room owns pinch: the internal zoom sweeps through five altitudes of
  // the same substance (crystal → dissolve → cuvette → molecule → chromophore)
  // and useBandEdgeTravel presses the /drop band walls only at the two
  // extremes. AxisChrome must not mount ScaleTravel on top of that camera.
  chrome: { travel: false },
  guide: {
    title: "the sample · one substance, five altitudes",
    scale:
      "the drop band — cabinet peer beside the coin and the jewel: one substance the maker knows (an aromatic cyclohexanone family, an o-chlorophenyl derivative), rendered in five altitudes the visitor pinches through. widest — a small heap of crystalline solid on a matte-black bench-top. tighter — the crystal falls into a beaker of solvent. tighter — a shallow cuvette from above, its horizontal axis a hidden wavelength axis 200–800 nm. tighter — one molecule swells to fill the frame, ball-and-stick, its ring's chair flipping on the room breath. tightest — the aromatic chromophore's π-cloud alone, with a HOMO/LUMO diagram in the corner and a photon of the finger's wavelength descending toward the ring.",
    essence:
      "the room OWNS pinch. a two-finger squeeze sweeps the internal zoom from 1 (crystal) to 4096 (chromophore); at the extremes the residual pressure crosses out through the /drop band walls exactly as any yielded-frame room does. between the walls each altitude is a different material, but the SUBJECT is the same — the crystalline solid, the solvated molecules, the ball-and-stick model, the ring's electron cloud are the same compound seen at four scales, and the transitions BETWEEN them are legible crossfades the visitor sees, not cuts. every verb dispatches per altitude: a tap on a crystal facet tumbles one flake; a tap on the cuvette fires a photon at the finger's wavelength; a tap on a bond at the molecule altitude highlights it; a tap at the chromophore altitude fires a photon toward the ring.",
    moves: [
      "pinch → travel between the five altitudes; a residual squeeze at either extreme crosses through the /drop band walls",
      "two-finger tap → step back one altitude jump (molecule → solution → crystal); the room's own camera answers, not ScaleTravel",
      "at CRYSTAL altitude · tap a facet → the flake tumbles; a tap-train drops new flakes onto the pile; tilt slides the heap; ceremony hold seals the room",
      "at SOLUTION altitude (Phase 1's cuvette) · tap → fire one photon at that wavelength; rapid taps (1 / 3 / 5 / n) escalate through a burst, a diode-array snapshot, and the whole white beam; drag → sweeps the beam; the ghost spectrum along the top edge accumulates the sample's fingerprint",
      "at MOLECULE altitude · drag → rotate the model in space; twist (two-finger) → flip chirality, (S) ↔ (R), a real mirror across the plane preserving connectivity; tap on a bond → highlights it and prints its order (single / double / triple)",
      "at CHROMOPHORE altitude · tap → fire a photon of the finger's wavelength toward the ring; if resonant with the current ΔE it kicks an electron across the gap; span (two still fingers) → particle-in-a-box: the interval sets L, ΔE recomputes as (n2²−n1²)·h²/(8mL²); twist → cycles n (2, 3, 4, ...)",
      "hold → a droplet of substance falls (solution altitude); molecules gather and multiply as long as the finger stays down",
      "ceremony hold → seals the current spectrum as a kept sigil; the curve returns whenever the room does",
      "three-finger drag → wind through the solvent; the population churns and drift velocities rise",
      "three-finger hold → time dilation; the absorb → relax cycle slows so the electron jump and the return can be seen",
      "three-finger tap → the diode array fires: every wavelength at once, every resonant molecule briefly lit, the ghost spectrum flashes complete",
      "three-finger twist → concentration up or down; deeper concentration means more molecules and deeper wells in the accumulated spectrum",
      "scrub (a winding path) → stirs the solvent; a vortex briefly forms",
      "tilt / shake / knock / flip (once invited) → the solvent leans, the sample fizzes with thermal broadening, a knock is the chopper (every excited molecule falls to ground at once), face-down dims everything but the two absorption bands the sample lives at",
    ],
    finds: [
      "the two bands the sample lives at are its fingerprint: the strong one near true violet and the shallow, broader shoulder to its right — the shape of the ghost curve is the whole identity of the compound",
      "the chair flip at the molecule altitude runs on the album's 7s breath — patience shows the ring inverting through its transition state and back",
      "the chirality flip at the molecule altitude preserves EVERY bond; only the geometry inverts — the same atoms in the same connectivity, arranged as their mirror image",
      "at the chromophore altitude, a photon whose energy hc/λ equals ΔE arrives and disappears; one whose energy misses passes through unabsorbed. widen the box (a longer span) and ΔE drops as 1/L² — the on-resonance wavelength walks toward the red",
      "shaken (or held under a knock's thermal loading) the bands widen and shallow at once — a real sample is not a cold spectrum, and the room reads that",
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
