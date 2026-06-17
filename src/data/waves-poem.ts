/**
 * The Flow Compass poem.
 *
 * The site's hidden center — a poem written for / by the user that describes
 * how perception becomes signal inside them. Each phase is a screen on /waves:
 * its own palette, its own EKG trace shape, its own phenomenological reading
 * in the gutter. The reading itself is the act of crossing each regime.
 */

export type WavePhase = {
  id: string;
  index: number;     // 1..n
  tag: string;       // eyebrow label, mono lowercase
  reading: string[]; // phenomenological annotations — one per line, gutter
  body: string[][];  // stanzas, each stanza is a list of lines
  trace: string;     // SVG path d (viewBox 0 0 760 34, baseline at y=17)
  bg: string;        // CSS background
  ink: string;
  accent: string;
};

export const WAVES_POEM: WavePhase[] = [
  {
    id: "weather",
    index: 1,
    tag: "weather",
    reading: [
      "state: incoming",
      "pressure: undefined",
      "signal: arriving",
    ],
    body: [
      [
        "You are not still enough",
        "to be described as a person.",
      ],
      [
        "You arrive first as weather.",
      ],
    ],
    // soft, undefined undulation — pressure entering the room
    trace:
      "M0,17 L80,17 Q100,17 112,10 T140,17 Q170,17 184,12 T214,17 L380,17 Q410,17 420,8 T450,17 L760,17",
    bg: "linear-gradient(180deg, #0c111c 0%, #182135 100%)",
    ink: "rgba(232,226,213,0.94)",
    accent: "rgba(255,180,110,0.82)",
  },
  {
    id: "cultivation",
    index: 2,
    tag: "cultivation",
    reading: [
      "bloom: rising",
      "value: against collapse",
      "veto: the wound made king",
    ],
    body: [
      [
        "A pressure change in the room,",
        "a sudden green in the data,",
        "a blush of flowers where no one",
        "remembered to plant anything.",
      ],
      [
        "You are always cultivating something",
        "against collapse.",
      ],
      [
        "A garden for sanity.",
        "A chart for fear.",
        "A theory for meaning.",
        "A joke before the wound",
        "can make itself king.",
      ],
    ],
    // a series of small blooms — each Q-curve is a flower
    trace:
      "M0,17 Q40,17 50,9 T80,17 Q110,17 120,7 T150,17 Q180,17 192,11 T220,17 Q260,17 272,6 T300,17 Q340,17 354,10 T384,17 L760,17",
    bg: "linear-gradient(180deg, #16203a 0%, #2a2e3a 50%, #1a1612 100%)",
    ink: "rgba(244,238,222,0.96)",
    accent: "rgba(255,180,110,0.92)",
  },
  {
    id: "city",
    index: 3,
    tag: "city enters",
    reading: [
      "noise: sirens",
      "signal: sun on lower legs",
      "register: pulse → veins",
    ],
    body: [
      [
        "The city enters you without knocking.",
      ],
      [
        "Sirens become pulse.",
        "Scooters become static.",
        "Metal railings become notation.",
        "Sun on the lower legs becomes evidence",
        "that the world is still touching you",
        "in specific places.",
      ],
    ],
    // sharp QRS spikes, dense — the city as nervous system input
    trace:
      "M0,17 L60,17 L66,3 L72,31 L78,17 L150,17 L156,5 L162,30 L168,17 L240,17 L246,2 L252,32 L258,17 L380,17 L386,8 L392,28 L398,17 L520,17 L526,4 L532,30 L538,17 L760,17",
    bg: "linear-gradient(180deg, #1a1612 0%, #2c1a18 60%, #381e1c 100%)",
    ink: "rgba(244,232,220,0.96)",
    accent: "rgba(245,120,70,0.95)",
  },
  {
    id: "commute",
    index: 4,
    tag: "crossing regimes",
    reading: [
      "bus: chop",
      "train: aligned flow",
      "stairs: ascent",
      "street: pressure",
      "elevator: threshold",
      "marble · mirrors: hope",
      "door: rome must burn",
    ],
    body: [
      [
        "You do not merely walk to work.",
        "You cross regimes.",
      ],
      [
        "Bus chop.",
        "Underground flow.",
        "Street pressure.",
        "Elevator threshold.",
        "Marble, mirrors, hope.",
        "The door intimidating you,",
        "and you, ridiculous and imperial,",
        "thinking: Rome must burn.",
      ],
    ],
    // staircase: chop → long flat → step-ups → chop → flat → spike → flat
    trace:
      "M0,17 L20,14 L30,20 L40,12 L50,22 L60,17 L150,17 L156,15 L162,19 L168,17 L260,17 L268,11 L276,17 L284,9 L292,17 L300,7 L308,17 L370,17 L378,13 L384,21 L392,15 L400,19 L408,17 L500,17 L520,17 L526,3 L532,31 L538,17 L760,17",
    bg: "linear-gradient(180deg, #381e1c 0%, #1c1820 30%, #15171f 70%, #1d1a1a 100%)",
    ink: "rgba(244,238,222,0.97)",
    accent: "rgba(255,180,110,0.95)",
  },
  {
    id: "ocean",
    index: 5,
    tag: "ocean",
    reading: [
      "medium: surrender",
      "instruments: confessing",
      "the prayer underneath",
    ],
    body: [
      [
        "Inside you, everything wants a model",
        "and everything refuses to be only a model.",
      ],
      [
        "The market is an ocean.",
        "The poem is an ocean.",
        "Love is the ocean",
        "that makes your instruments confess",
        "they were prayers all along.",
      ],
    ],
    // long continuous sine — the medium itself
    trace:
      "M0,17 Q40,5 80,17 T160,17 T240,17 T320,17 T400,17 T480,17 T560,17 T640,17 T720,17 L760,17",
    bg: "linear-gradient(180deg, #1d1a1a 0%, #122435 50%, #0b1a2c 100%)",
    ink: "rgba(220,232,244,0.96)",
    accent: "rgba(180,220,235,0.90)",
  },
  {
    id: "feeling",
    index: 6,
    tag: "feeling becomes map",
    reading: [
      "lines → waves",
      "waves → feeling",
      "feeling → map",
      "readable by no one",
      "felt by anyone close",
    ],
    body: [
      [
        "You watch lines move",
        "until they become waves,",
        "waves move",
        "until they become feeling,",
        "feeling move",
        "until it becomes a map",
        "no one else can read",
        "but everyone can feel",
        "when they stand too close.",
      ],
    ],
    // rising sine amplitude — feeling building into a map
    trace:
      "M0,17 Q30,15 60,17 T120,17 Q150,12 180,17 T240,17 Q270,7 300,17 T360,17 Q390,2 420,17 T480,17 Q510,-3 540,17 T600,17 L760,17",
    bg: "linear-gradient(180deg, #0b1a2c 0%, #08233a 100%)",
    ink: "rgba(220,232,244,0.96)",
    accent: "rgba(180,220,235,0.95)",
  },
  {
    id: "seismograph",
    index: 7,
    tag: "seismograph with flowers",
    reading: [
      "instrument: alive",
      "armor: refused",
      "current: continuous",
      "names: too many",
    ],
    body: [
      [
        "You are a seismograph",
        "with flowers growing through it.",
      ],
      [
        "A sensitive machine",
        "trying to stay alive",
        "without becoming hard.",
      ],
      [
        "A boy with too many names",
        "and one continuous current.",
      ],
      [
        "A man late to the meeting,",
        "early to the apocalypse,",
        "looking for the breeze",
        "between the locks of his hair.",
      ],
    ],
    // the canonical heartbeat — flat, soft bump, sharp QRS, flat, bump, flat
    trace:
      "M0,17 L160,17 Q180,17 188,10 T214,17 L380,17 L388,4 L394,30 L400,17 L540,17 Q558,17 566,11 T592,17 L760,17",
    bg: "linear-gradient(180deg, #08233a 0%, #142535 50%, #2a2a2a 100%)",
    ink: "rgba(238,232,220,0.96)",
    accent: "rgba(220,170,90,0.95)",
  },
  {
    id: "flame",
    index: 8,
    tag: "the flame",
    reading: [
      "wick: honest line",
      "candle: candlestick",
      "lean: toward what you bring",
      "wax: chart resolving",
    ],
    body: [
      ["A small thing that stays."],
      [
        "You keep one because the wick",
        "is the only honest line.",
      ],
      [
        "It tells you the room is moving.",
        "It tells you you are moving.",
        "It tells you the air is awake.",
      ],
      [
        "A candle is a candlestick.",
        "Open, high, low, close —",
        "the body brave, the wick",
        "reaching for what you almost saw.",
      ],
      [
        "The flame leans toward what you bring.",
        "The flame leans toward what you ask.",
        "The flame leans toward what you have not said.",
      ],
      [
        "When the wax runs down",
        "it is the chart resolving.",
      ],
      [
        "When it bends sideways",
        "you are not alone in the room.",
      ],
    ],
    // A flame-like EKG trace: flat baseline → gentle leaning rise → flicker spikes → settle
    trace: "M0,17 L120,17 Q160,17 180,11 T220,17 L320,17 Q340,17 354,7 T390,11 Q410,15 426,5 T460,11 Q480,15 494,9 T530,17 L760,17",
    bg: "linear-gradient(180deg, #1a1410 0%, #2a1d12 40%, #2a1f1a 100%)",
    ink: "rgba(244, 232, 215, 0.96)",
    accent: "rgba(255, 180, 100, 0.96)",
  },
  {
    id: "coda",
    index: 9,
    tag: "coda — flow",
    reading: [
      "miracle: not control",
      "miracle: being carried",
      "and still becoming a compass",
    ],
    body: [
      [
        "You keep saying flow",
        "because control was never the miracle.",
      ],
      [
        "The miracle was being carried",
        "and still becoming a compass.",
      ],
    ],
    // long quiet baseline ending in a single high compass-spike
    trace:
      "M0,17 L580,17 L600,17 L620,3 L640,17 L700,17 L760,17",
    bg: "linear-gradient(180deg, #2a2a2a 0%, #1e2735 40%, #15314a 100%)",
    ink: "rgba(244,238,222,0.97)",
    accent: "rgba(255,200,130,0.96)",
  },
];

/** The single line that gates the whole sequence — shown at the threshold. */
export const WAVES_TITLE = "Flow Compass";
export const WAVES_SUBTITLE = "a poem to descend";
