import type { RoomManifest } from "@/rooms/types";

/**
 * /gate — the channel that answers the sample.
 *
 * A cross-section of the NMDA-type ionotropic glutamate receptor's ion
 * channel, with the same substance /observe circles around — the
 * o-chlorophenyl cyclohexanone family — sitting in the transmembrane
 * vestibule between the M2 and M3 helices, above the gate. Four subunit
 * helices arrange themselves in a fourfold-ish assembly: two GluN1 (light
 * grey) and two GluN2 (green for 2A, blue for 2B, toggleable by twist).
 * The pore descends from the extracellular vestibule (top) through the gate
 * (middle constriction) to the selectivity filter (below). Ions accumulate
 * above the gate; when the gate is open AND the substance is unbound they
 * descend through the pore. When the substance is bound or the gate closed,
 * they cannot pass.
 *
 * A lateral peer of /observe in the /drop band's cabinet ring — the two
 * rooms are the same substance in two different situations. /observe stages
 * the compound; /gate stages the channel that receives it. No zoom sweep
 * inside /gate — one scene at one altitude — so the room YIELDS the frame,
 * and ScaleTravel presses the /drop band walls normally through pinch.
 */
const gate = {
  key: "gate",
  href: "/gate",
  sigil: "plasma",
  desc: "the channel · the same sample bound in the pore",
  cluster: "mechanism",
  dark: true,
  place: {
    kind: "peer",
    circle: "cabinet",
    band: "drop",
    label: "the channel",
    ringAfter: "observe",
  },
  icon: {
    title: "the channel · the sample bound in the vestibule",
    description:
      "a cross-section of the NMDA-type ionotropic glutamate receptor's pore, with the same sample bound between the M2 and M3 helices above the gate — ions gather above and cannot pass while it holds",
    path: "/gate",
    shortName: "gate",
    kind: "plasma",
    bg: "#04060c",
    bg2: "#0d1420",
    glow: "#e0e6f2",
    accent: "#3fb85a", // GluN2A green
    accent2: "#4a86d8", // GluN2B blue (twist-toggle)
    ink: "#f0edd8",
  },
  guide: {
    title: "the channel · the sample bound in the vestibule",
    scale:
      "the drop band — cabinet peer beside the sample: /observe holds the substance five altitudes deep, and this room holds the receptor its molecule is shaped to answer. the four helices of the pore are drawn cross-section, seen from a low angle, and the substance sits in the vestibule above the gate — the same ball-and-stick model /observe builds up to at its molecule altitude, imported (not copied) from the shared physics module. no internal zoom; one scene at one altitude, so pinch belongs to the manifold as usual.",
    essence:
      "the substance from /observe is here, in the pore. the four helices pinch toward the gate at the middle of the frame and dilate under a two-finger span; the substance in the vestibule blocks the gate wherever it sits above the pinch. ions ride down the column when the gate is open and the vestibule empty, and pile up above when it is not — the block is felt as the absence of the flow, not as a caption. twist toggles the GluN2 subunit (2A → 2B → 2A), a real identity switch the hue answers. dwell above the pore spawns a fresh molecule that may drift down and bind on its own; twist3 walks the bound molecule through the pore — vestibule → filter → out; a ceremony hold seals the current arrangement.",
    moves: [
      "drag the substance → grab and move it. drag into the vestibule and it binds; drag it up and out and it releases and drifts back above the membrane.",
      "tap on the channel walls → a soft glow travels up the subunit's helix — the ligand-binding domain answers a touch.",
      "tap on the substance → wiggles it in place.",
      "two-finger tap → step back through the /drop band wall (the room yields the frame).",
      "three-finger tap → the whole channel flexes at once; a soft ion pulse rides through the pore.",
      "dwell above the pore → a fresh molecule spawns; if the vestibule is empty it may drift down and bind.",
      "ceremony hold → seals the current state (subunit, openness, binding) as a kept sigil.",
      "three-finger hold → time dilation; residency time visibly extends, the gate's motion slows to a quarter.",
      "span (two still fingers) → holds the gate open. if the substance is bound the span has no effect: the block is the whole rule.",
      "twist (two-finger) → toggles the GluN2 subunit — (2A) ↔ (2B). the two coloured helices shift hue.",
      "three-finger twist → walks the bound substance vestibule → deeper (selectivity filter) → out (unbound above); continuous, not stepped.",
      "three-finger drag → the membrane vibrates; ions pile up faster above and the substance may pop out of the vestibule.",
      "scrub (a winding path) → swirls the ions in the extracellular space above the gate.",
      "flick → a single sharp push on the substance in its current position — a small kick along the flick direction.",
      "tilt → the whole channel leans; unbound substance drifts with gravity in the extracellular space.",
      "shake → full membrane vibration; a force-unbind is possible.",
      "knock → one clean ion pulse rides through if the gate is open and the vestibule empty.",
      "flip (face down) → the receptor darkens to just the substance's outline, holding its bond geometry.",
    ],
    finds: [
      "a bound substance does not just close the gate visibly — it removes the ion current entirely. the two channels the gate opens and the block closes are the same channel, and the block is the exact absence of the flow.",
      "the gate breathes on the album's 7s clock even at rest — the pore is never fully closed, and the width of a closed gate rises and falls with the breath.",
      "the (2A) and (2B) subunits are the same protein family with different residues; the room shows them as a hue swap on the two coloured helices, and the pore geometry stays identical.",
      "walking the substance through the pore with a three-finger twist takes it past the gate — a real conformational passage, not a fade — and the flow returns as it passes out the other side.",
    ],
    keeps:
      "the current subunit (2A or 2B) and the standing binding — an empty pore stays empty, a bound one holds its block across the visit.",
  },
  // ——— the room quality bar, structured ————————————————————————————
  life: {
    population: {
      objects: [
        {
          noun: "ion",
          max_count: 96, // ION_CAP from @/lib/gate
          state_shape:
            "id, seed, z (height in the pore column), phase (time offset), retire (0..1 leaving)",
          lifecycle:
            "born under dwell as a fresh drop above the membrane (rare — the visitor mostly makes molecules, which drift down and bind) → drifts down through the pore when the gate is open and the vestibule empty (ionColumnSample gives its jitter) → retires past the selectivity filter or when the population exceeds ION_CAP (oldest first) → cleared by <LetGo>",
          persistence: "localStorage",
          creates_via_verb: "dwell",
          retires_via: ["LetGo"],
          implementation_hint: "SceneObjectSpec",
        },
      ],
    },
    breath: {
      period_seconds: 7,
      reads: ["uBreath uniform (the pore's baseline openness rides ±10% on the 7s clock)"],
      behavior_at_rest:
        "the gate breathes between a closed-hair (GATE_BASELINE_LO=0.15) and a slightly open (GATE_BASELINE_HI=0.35) on the album's 7s clock; the four helices' halfwidth taper reads that breath in the shader so the pore visibly widens and narrows even when nothing is touched.",
    },
    glimmer: {
      after_idle_ms: 20000,
      visual:
        "a soft ion pulse rides down the pore column at a seeded phase — one clean speck descends through the gate when it can, deterministic in the room's own seed, never with text.",
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
        "seals the current channel state (subunit, openness, whether the substance is bound) at the objetdart:gate:v1 key — the receptor's momentary posture kept between visits",
    },
  },
} as const satisfies RoomManifest;

export default gate;
