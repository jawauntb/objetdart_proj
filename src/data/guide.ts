// The field guide's content — the one sanctioned place where the site
// explains itself (AGENTS.md, "the documentation law"). Rooms stay
// instruction-free; this file carries every instruction so they don't have to.
//
// Keep it true: when a room, gesture, bus, or API changes, its entry here
// changes in the same PR, and the room's screenshot is re-shot with
// `npm run shoot:guide -- --only=<key>`. scripts/test-guide.mjs enforces
// coverage against src/lib/routes.ts and the presence of every screenshot.
//
// Every move reads "gesture → what answers" (the arrow is load-bearing:
// the test checks for it, and the page splits on it).

import { roomGuideEntries } from "@/rooms/registry";

export type GuideRoom = {
  /** route registry key from src/lib/routes.ts, or "home" for the threshold */
  key: string;
  title: string;
  href: string;
  /** one sentence: the material and what it renders */
  essence: string;
  /** where the room sits on the quark→manifold axis, when it takes a band */
  scale?: string;
  /** exhaustive: every gesture and control the room answers */
  moves: string[];
  /** the non-obvious rewards a patient hand finds */
  finds: string[];
  /** what the room remembers between visits (localStorage) */
  keeps?: string;
  /** declared reading surfaces may document fewer than three moves */
  readingSurface?: boolean;
};

export type GuideStep = { title: string; body: string };
export type GuideBinding = { gesture: string; meaning: string };
export type GuideLayer = { title: string; body: string };
export type GuideWorkshopPart = { title: string; paragraphs: string[] };
export type GuideApi = {
  /** directory name under src/app/api — the test checks it exists */
  name: string;
  method: string;
  takes: string;
  returns: string;
  notes?: string;
};

// ---------------------------------------------------------------------------
// the first minute — the onboarding walk
// ---------------------------------------------------------------------------

export const GUIDE_FIRST_MINUTE: GuideStep[] = [
  {
    title: "wake the sea",
    body:
      "nothing here makes a sound until you ask. the small control at the bottom right of every page wakes the ocean; the candle at the bottom left keeps its watch either way. once woken, the sound follows you from room to room.",
  },
  {
    title: "touch the water",
    body:
      "on the threshold, move slowly across the sea. every touch raises a ripple in the same frame as its tone — this is the covenant the whole site keeps: what you do lands in at least two senses at once.",
  },
  {
    title: "pull a vertex of the compass",
    body:
      "the eight-pointed polygon is your night's shape. drag any vertex and hold it — its concern sings a continuous tone, the prose below reflows to the silhouette, and the atlas briefly halos the territories that share the concern.",
  },
  {
    title: "read the room, then keep it",
    body:
      "press read the room and the instrument writes back to you. keep this reading and the night joins your trail — kept readings return as small stars on the threshold sea, and any two can be laid over each other at /compare.",
  },
  {
    title: "walk the axis",
    body:
      "the rooms are moored along one line from the quantum fields to the spacetime manifold. pinch to zoom inside a room; hold the pinch through the resistance at the edge and you travel to the neighboring band, a haptic tick at the door.",
  },
  {
    title: "hand it the vessel",
    body:
      "the device itself is an instrument. tilt it and rooms lean with gravity; shake and they scatter; knock the case and the room answers the door; lay it face-down for night. when the candle invites you, breath is also a verb.",
  },
];

// ---------------------------------------------------------------------------
// the grammar — the stack the hand climbs
// ---------------------------------------------------------------------------

export const GUIDE_LAYERS: GuideLayer[] = [
  {
    title: "one finger · the material",
    body:
      "touches the things themselves — water, petals, stars, coins. tap, stroke, press, plant, throw. whatever a single finger does, it does to matter.",
  },
  {
    title: "two fingers · the frame",
    body:
      "touch the map the things appear in. pinch moves through scale, twist rotates the lens at fixed scale, a two-finger drag pans the frame, a two-finger tap steps back.",
  },
  {
    title: "three fingers · the law",
    body:
      "touch the room's generative parameters. a three-finger drag is wind and weather, a three-finger hold slows time while held, a three-finger tap asks everything alive to answer at once.",
  },
  {
    title: "the device · the vessel",
    body:
      "the body the rooms live in. tilt is gravity, shake is agitation, a knock on the case is a knock on the door, face-down is night, and breath belongs to the candle.",
  },
];

export const GUIDE_GLOBAL_BINDINGS: GuideBinding[] = [
  { gesture: "tap", meaning: "touch the material — each room decides what a touch means in its own matter" },
  { gesture: "long-press (~1s)", meaning: "plant, grow, charge — and the longer the hold, the deeper it goes; nothing fires the same at one second and at three" },
  { gesture: "ceremony hold (2.5s)", meaning: "the room's one solemn act — keep, seal, bloom fully" },
  { gesture: "two-finger tap", meaning: "step back — the frame retreats one step; a raised lens lowers" },
  { gesture: "three-finger tap", meaning: "tutti — one synchronized pulse of everything alive in the room" },
  { gesture: "pinch", meaning: "zoom within the current scale band" },
  { gesture: "pinch held through the detent", meaning: "travel to the neighboring band, with resistance and a haptic click at the door" },
  { gesture: "twist", meaning: "rotate the lens — the same room at another level of description, fluid to equation to felt" },
  { gesture: "two-finger drag", meaning: "pan the frame" },
  { gesture: "three-finger drag", meaning: "wind and weather" },
  { gesture: "three-finger hold", meaning: "time dilation while held" },
  { gesture: "shake", meaning: "scatter, agitate — in the room's own material" },
  { gesture: "tilt", meaning: "gravity — rooms lean, pour, and parallax with the real world" },
  { gesture: "knock on the case", meaning: "wake the room, ring its door" },
  { gesture: "flip face-down", meaning: "night — the room sleeps" },
  { gesture: "breath", meaning: "the candle's alone — invited, never demanded" },
  { gesture: "desktop dialect", meaning: "hover is a light touch, the wheel is local zoom, ctrl+wheel is the pinch; arrows, enter, and escape stay wired in every room" },
];

// ---------------------------------------------------------------------------
// the rooms — filled per route; test-guide.mjs enforces coverage
// ---------------------------------------------------------------------------

const CORE_GUIDE_ROOMS: GuideRoom[] = [
  // --- threshold ---
  {
    key: "home",
    title: "home",
    href: "/",
    essence: "a vertical snap-scroll gallery where every room plays live behind a veil, one tap from full interaction.",
    moves: [
      "scroll → the gallery snaps room to room; leaving one auto-exits it",
      "tap the veil, \"enter toy\" → that room wakes and takes your touch",
      "\"leave toy · keep scrolling\" → drops back out without losing your place",
      "\"open alone\" → opens the room on its own address",
      "two-finger tap or escape → steps back out of an entered room",
      "the rail's ↑ / ↓ → jumps to the neighboring room",
    ],
    finds: [
      "only the rooms nearest your position ever render live — everything else sleeps as a ghosted name",
      "escape reaches inside the entered room's own toy, not just the gallery's chrome",
    ],
    keeps: "nothing of its own — the candle, the mute state, and the vessel's permission live site-wide",
  },

  // --- field ---
  {
    key: "city",
    title: "a settlement · homes · stores · events",
    href: "/city",
    scale: "the atlas band — a peer of the atlas at the ground: the same earth at the level of dwellings, not coastlines.",
    essence: "a small settlement whose parts are what they do — a plot is a home the moment it is planted, becomes a store, becomes an event, quiets to a tree; the people carry a need and walk to the plot that answers it.",
    moves: [
      "tap → ripples the ground, or brightens a plot if the tap lands on one",
      "rapid taps → the train: three raps knock on the nearest door and its neighbors turn toward it; five ring a market bell that feeds the near and turns a leaver back; seven and more, a carillon — every plot rings and the town is called home",
      "steady taps → the day entrains to the hand's tempo for a few breaths",
      "scrub → stirs the weather the way the hand circles; the people caught inside turn to its center",
      "dwell → plants a home; keep holding and it densifies (home → store → event → tree)",
      "ceremony hold → seals the plot at its current role, kept between visits",
      "drag → traces a road; people walk faster where the road runs",
      "flick → rings a chime at that point; nearby people gather to it",
      "twist → the lens: map, hydrology, satisfaction",
      "twist3 → turns the year through the four seasons; the trees follow",
      "tap3 → tutti; bells ring across the town, people move to the nearest event",
      "drag3 → weather; wind and rain roll across the settlement",
      "hold3 → time dilation — the day slows the longer the hold, toward stillness",
      "tilt / knock / flip → rain leans in / the bell tolls as far as the rap was hard / night falls",
      "arrows → a plot cursor drifts over the field; p held plants and climbs the same civic ladder a dwell climbs; space seals under the cursor; l cycles the lens; escape lowers it",
    ],
    finds: [
      "a five-tap market bell reaches a person already walking out — fed at the edge of leaving, they turn back and settle",
      "a home spawns one to three residents deterministically from its own seed — the same seed always brings the same people",
      "roads are only ever as fast as the people who use them; a road with no traffic is just a line you drew",
      "a hungry city with no stores is a city standing still: people wait rather than wander when nothing answers their need",
      "a new resident walks in from the nearest map edge before settling — arrival is a visible passage, not a spawn",
      "returning to the same store or event three times makes the person a regular there, and the plot warms into a small community — a store is where these people eat",
      "when two stores stand at nearly the same distance, the walker slows and, given a moment, swaps route — the tradeoff is legible in the step",
      "the settlement is tuned to d mixolydian: a home rings the tonic, a store the fourth, an event the fifth, a tree the flat seventh — the civic ladder climbs the mode; a sealed plot tolls the triad rooted at its own note, and tutti stacks a voice for every event the city holds",
    ],
    keeps: "every sealed plot, the season the year reached, and the day the city had been living in",
  },
  {
    key: "atlas",
    title: "the living map",
    href: "/atlas/origin",
    scale: "the atlas band — between the coast and the earth",
    essence: "one continuous generative world-plane you roam by camera — drag to travel, pinch to zoom in place, tap a landmark to open a whole map of that thing.",
    moves: [
      "drag → pans the camera; drifting past the edge travels to the neighboring territory",
      "rapid taps → the train: three raise birds from the tapped ground, five call a migration across that latitude, seven and more the whole sky answers at once",
      "steady taps → the weather arrives on the hand's pulse for a few rounds",
      "scrub → stirs the cloud shadows along the circle; the stirred sky settles back to its own pace",
      "hold still on open ground (~1.8s) → plants a cairn, a wildflower, or a rare animal trail",
      "pinch → zooms in place; pinching at the floor requests a wider chart",
      "tap a hotspot → opens a whole new map of that subject",
      "twist3 → turns the season, and the sky's habits follow — flocks in spring, sunbeams in summer, migrations in autumn, gusts in winter",
      "drag3 → wind; the gust leans the way the hand pushes and grows with its speed",
      "the four edge buttons → travel toward the (sometimes already-named) neighbor",
      "a prompt field → mints an entirely new territory from a few words",
    ],
    finds: [
      "after ~20s idle, a random landmark's halo swells once — a physical hint, never a label",
      "shaking the vessel gusts the sky by how hard it was shaken; a knock rings the whole map at the strength of the rap",
      "diving through the deep wall on /stars over a planet opens the atlas on that world instead of the origin sheet",
    ],
    keeps: "up to 32 planted naturals across the whole plane, plus the territory itself",
  },
  {
    key: "archive",
    title: "the drawers",
    href: "/archive",
    essence: "a wall of specimen drawers you filter, search, sort, and flick open, plus a form that asks the room to write a new one.",
    moves: [
      "search + filter chips → live-filters the wall",
      "long-press a filter chip → solos it, quieting every other filter",
      "flick a card → it shivers on its runners, then opens onto its own page",
      "the \"imagine a drawer\" form → asks the room to write a brand-new entry in its own voice",
    ],
    finds: ["a small live seismograph in the corner tracks every touch you make on the wall itself"],
    keeps: "any drawers you've asked the room to imagine",
  },
  {
    key: "kept",
    title: "a private trail",
    href: "/kept",
    essence: "your kept readings as a night sky over water — each one a star you can open, sound, compare, or let go.",
    moves: [
      "tap a star → opens its reading card (play the sigil, compare, forget, or open in full at /reading/<hash>)",
      "select two stars → draws a line between them and offers /compare, laying both polygons over one compass",
      "hold a star to the ceremony tier → lets it go, the same act as the forget button, spoken by hand",
    ],
    finds: ["a star's position is deterministic from its reading's own hash, so your constellation looks the same on every visit and every device"],
    keeps: "your kept readings",
  },
  {
    key: "colophon",
    title: "what kept this",
    href: "/colophon",
    essence: "the quiet last page — what the site is and isn't, signed in three registers you can actually hear.",
    moves: ["the three register buttons (devotional, operational, oceanic) → each sounds its own note and swaps the line beneath it"],
    finds: ["the three notes are literally a chord — pressed in sequence they sound the site's own tonic triad"],
    readingSurface: true,
  },
  {
    key: "guide",
    title: "how to hold it",
    href: "/guide",
    essence: "this page — the one surface where the site explains itself, kept current in the same pull request as whatever it describes.",
    moves: [
      "the table of contents → jumps to the first minute, the grammar, the rooms, or the workshop",
      "any room's screenshot or title → opens that room",
    ],
    finds: ["this entry documents itself, the same way every other room does"],
    readingSurface: true,
  },

  // --- water ---
  {
    key: "coast",
    title: "the beach · land meets sea",
    href: "/coast",
    scale: "the coast band — between birds and the mountain",
    essence: "a living beach — wet sand, foam lace, a tide line, dunes — the shore that joins the land to the deep.",
    moves: [
      "tap → foam and a note at the waterline",
      "rapid taps (1 / 3 / 5 / n) → print → wave break → surge → the whole shore answers at once",
      "hold (dwell) → plants a shell in the sand; ceremony keeps it",
      "drag → draws a groove that the tide will forget",
      "scrub → stirs a lace of foam along the swash",
      "a steady tapped pulse → the surf's sets fall in with your tempo for a while",
      "drum two spots (hands alternating) → foam leaps the space between them, each side answering in its own register",
      "three-finger drag → wind across the beach",
      "tilt / shake (once invited) → the horizon leans, or sand kicks into spray",
      "two-finger hold to dwell → opens the shore's peer ring (coast · ocean · tide · waves)",
    ],
    finds: [
      "the beach is the coast band's home; the deep, the tide, and the ripple tank sit beside it as peers",
      "earth opens a lateral door down onto this shore — press, release, press again at the wall",
    ],
    keeps: "the shells you plant in the sand",
  },
  {
    key: "ocean",
    title: "the deep · dive down",
    href: "/ocean",
    scale: "the coast band — peer of the beach, between a drop and the atlas",
    essence: "the whole body of water, and a dive straight down through it, from sunlit surface to the abyss.",
    moves: [
      "tap → a ripple at the surface, or a bioluminescent spark in the deep",
      "rapid taps (1 / 3 / 5 / n) → splash → seabirds startle up → a whale answers → a rogue set arrives; in the dark the same ladder wakes the light instead",
      "hold near the surface (dwell) → plants a shell, kelp, driftwood, or starfish; the sea keeps gathering round the finger for as long as it stays",
      "hold to the ceremony tier → the planted thing settles for good",
      "scrub (circle a finger) → stirs a phosphor gyre that carries the drifters round",
      "a steady tapped pulse → the wave train falls in with your tempo",
      "two-finger drag, vertical → dives the camera down the water column",
      "three-finger drag / hold → wind, or the whole sea slowing deeper the longer it is held",
      "tilt / shake (once invited) → the sea leans and churns with the real device",
      "two-finger hold to dwell → opens the shore peer ring toward the beach",
    ],
    finds: [
      "depth gates the vocabulary — planting only works near the surface, the abyss is deliberately quiet",
      "a shell planted here can drift and turn up later on /tide, because naturals share one world, not one page",
      "the tap ladder changes register with depth: what startles birds at the surface flares the motes below",
    ],
    keeps: "the naturals you plant, shared with /tide as one persistent shore",
  },
  {
    key: "tide",
    title: "move the moon",
    href: "/tide",
    essence: "a lunar gravity instrument — drag the Moon or Sun around the Earth and watch the tidal bulge, and the shore, answer.",
    moves: [
      "drag the Moon or Sun → sets its angle; the tide rises and falls with it",
      "tap the Earth → toggles auto-orbit",
      "rapid taps on the open sea (1 / 3 / 5 / n) → a ring → a firefly wakes → a stone skips → a lunar surge rolls through the swell",
      "three-finger tap → everything over the night answers at once: the moon, the sun, the shells, the candle",
      "hold near the waterline (dwell → ceremony) → plants a natural, its kind chosen by the tide you just made",
      "knock the case (once invited) → skips a stone across the water, three real bounces",
      "the \"tune\" panel → align sun (spring tide) or set it to quarter (neap tide)",
    ],
    finds: [
      "what you can plant depends on the tide you made — low water yields starfish, high water yields driftwood",
      "the Moon's face lights by its angle to the Sun, so the phase you build is the phase you see",
      "five quick taps skip the stone the knock skips — the same discovery, reachable by hand alone",
    ],
    keeps: "naturals on this shore, shared with /ocean",
  },
  {
    key: "waves",
    title: "ripple tank",
    href: "/waves",
    essence: "a real wave-equation ripple tank in three media — a pond, a plucked string, a field of bending light — where pulses expand, reflect, and interfere.",
    moves: [
      "tap / drag → a drop, or a continuous disturbance",
      "rapid taps (1 / 3 / 5 / n) → a drop → a beating pair → a focusing ring → the whole tank rings; on the string the same rungs climb the harmonics",
      "hold, in the pond → grows a lily, then a fallen leaf, then a koi takes residence",
      "medium buttons → switch between ripple, string, and refraction",
      "the \"tune\" sliders → speed, damping, drop size",
      "scrub (circle a finger) → stirs the pond into a turning current",
      "a steady tapped pulse → the pond's own life falls in with your tempo",
      "two still fingers held apart → a beating pair stands between them, sounding their interval; on the string, a double stop — the longer the hold, the deeper it drives",
    ],
    finds: [
      "one long hold passes through three stops — lily, leaf, koi — a single press grows a small ecology",
      "leave the pond alone and it keeps living: leaves fall, dragonflies dip, koi surface on their own",
      "five quick taps close a ring whose wavefronts focus back through the centre — interference made a lens",
    ],
    keeps: "the pond's naturals — lilies, leaves, koi",
  },
  {
    key: "sine",
    title: "wave explorer",
    href: "/sine",
    scale: "the coast band — shore peer among the wave instruments",
    essence: "the fundamental oscillator as an instrument — a sine ribbon that bends through every finger you set on it, each one its own voice.",
    moves: [
      "touch → a note sounds instantly, pitched by height; every finger is its own voice",
      "move a finger → glides its pitch and bends the whole waveform",
      "flick → throws a pulse down the wave",
      "circle a finger → bends the frequency up or down",
      "rapid taps → three bloom the overtones, five turn the wave to its next nature, seven and more swell a crescendo",
      "a steady tapped pulse → the oscillator locks its phase to your tempo for a while",
      "mode buttons → source, interference, standing wave",
      "pinch through the edge → travels the scale axis from the coast",
      "two-finger hold to dwell → opens the shore peer ring (coast, ocean, tide, waves…)",
    ],
    finds: [
      "three fingers moving the same way winds the whole phase — read straight off the moving voices, never a separate gesture",
      "a rap on the device's case rings the wave — harder raps ring lower and leave a wavefront mid-ribbon",
    ],
  },
  {
    key: "pretext",
    title: "playable text",
    href: "/pretext",
    essence: "a sentence turned into an instrument — real prose laid out along a wave-shaped column, then loosened into six motions.",
    moves: [
      "drag anywhere → up sets amplitude, right sets frequency; a note tracks both",
      "tap → a drop lands on the sentence: the tide quickens where it fell, pitched by height",
      "rapid taps → three recall the next kept phrase, five crest the tide, seven and more flood it",
      "circle a finger → stirs the tide with or against its clock",
      "a steady tapped pulse → the words lock to your tempo and brighten on every beat",
      "hold → charges a ring that keeps the phrase; the same hold on a kept phrase is the act that lets it go",
      "the six mode buttons (move / shift / shake / quake / wave / sine) → each jumps the wave to that motion's signature shape",
      "the prompt field → asks the room to write the text you're playing",
      "\"speak\" → the room reads the current text aloud",
    ],
    finds: [
      "if the room can't answer, it falls back to one of four sentences chosen deterministically from your own prompt — a failure always fails the same way",
      "three fingers held still slow the tide's clock, and it keeps slowing the longer the hand stays",
    ],
  },
  {
    key: "circularity",
    title: "circles to waves",
    href: "/circularity",
    essence: "a Fourier instrument — a chain of up to twelve rotating circles whose tip draws an unrolled waveform beside it.",
    moves: [
      "drag → rotates the chain and sets how many harmonic terms are drawn",
      "flick → throws the wheel spinning, which slows on its own",
      "rapid taps → three call the next harmonic into the chain, five throw the wheel a full turn, seven and more roll the whole series rising",
      "circle a finger → winds the spring; a wider or faster circle winds harder",
      "a steady tapped pulse → the wheel locks its turning to your tempo",
      "hold (dwell) → grows the series by one more harmonic; to the ceremony tier → all twelve unfurl at once",
      "twist → turns the lens between the spinning circles and the unrolled wave",
      "preset buttons → square, saw, triangle, pulse",
    ],
    finds: [
      "the lens is a ratchet, not a dial — a long twist flips circle and wave once per quarter turn",
      "a rap on the device's case rings every standing harmonic once, louder for a harder rap",
    ],
  },
  {
    key: "beyond",
    title: "novel wave field",
    href: "/beyond",
    scale: "the beyond band — between the stars and the manifold",
    essence: "a living interference field — four incommensurate wave functions summed into one grid, folded and pulled by hand.",
    moves: [
      "press and drag → x folds the pattern, y pulls it, both live",
      "rapid taps → three snap the fold deeper, five bloom the field wide, seven and more flood the pull",
      "circle a finger → stirs harder the faster you circle, and leans the fold with the circling's direction",
      "a steady tapped pulse → the field's clock locks to your tempo and pulses between two poles on the beat",
      "\"keep fold\" then \"replay fold\" → saves the exact composition, including where you touched, and restores it",
      "the \"tune\" sliders → cell size, fold, pull, bloom",
      "pinch → zooms; held through the edge, travels to the neighboring band",
    ],
    finds: [
      "the field is a fixed weighted sum of four frequencies, not noise — the aliveness comes from their incommensurability",
      "three fingers held still dilate the field's time, deepening toward stillness the longer they stay",
    ],
  },
  {
    key: "storm",
    title: "pressure · charge · discharge",
    href: "/storm",
    essence: "a weather instrument — drag the sky to bank static charge, then discharge it as branching lightning with thunder delayed by distance.",
    moves: [
      "drag the sky → banks charge; tap the sky once charged → discharges",
      "tap or drag the sea → raises a crest, or sculpts spray",
      "rapid taps (1 / 3 / 5 / n) → the train: three fork the banked charge loose (or raise a set of crests at sea), five march strikes across the front, seven and more wake the whole tempest",
      "drum between sky and sea → each hand answers in its own register — streaks and charge above, crests below; a held patter arcs a bolt between the hands",
      "two fingers rested → the sea holds its breath for as long as the interval is kept, and lets it out as a surge",
      "three-finger drag → sets the wind heading",
      "hold to the ceremony tier → opens the eye of the storm (a second hold closes it)",
      "the barometer dial and wind rose → set pressure and heading directly",
    ],
    finds: [
      "thunder is delayed by how far the strike lands from center — a bolt at the edge rumbles noticeably later than one overhead",
      "a hold keeps feeding what it planted — the sea cell fattens toward a squall, the sky bank keeps rising — so 900ms and 2400ms are never the same storm",
      "reduced motion floors how fierce the storm is allowed to get, not just how it animates",
    ],
  },
  {
    key: "clouds",
    title: "the air floor, four banks deep",
    href: "/clouds",
    scale: "the olympus band — peer of the mountain, between the coast and the atlas",
    essence: "the cloud floor — heaped towers marched through in a volume, sunlit crowns over bruised bellies, a sea of tops below, four banks of sky running a two-minute day, and weather you can gather by hand.",
    moves: [
      "tap → the air thickens into vapor where the finger landed, or a whoosh from whichever glyph you touched",
      "rapid taps (1 / 3 / 5 / n) → the train: three break the vapor into first rain, five call the bolt down to the finger, seven and more bring the whole front in",
      "hold, gathering charge → the held air darkens and grows a storm cell; held to the ceremony tier, the storm is kept with lightning",
      "drum between two places → each landing condenses its own spot; a held patter strings a squall line from hand to hand, wind running along it",
      "drag → shears the wind locally; three fingers race the whole sky",
      "the sun/moon glyph → advances the day by a quarter turn",
      "two-finger hold to dwell → opens the peak peer ring toward the mountain",
    ],
    finds: [
      "a storm's strength is exactly proportional to how long you held past the threshold",
      "nothing is painted over the sky — the heaps are lit by a sun march inside the volume, so a crown brightens and a belly bruises from the same held finger",
      "the day cycle genuinely drives the palette — labels and tooltips flip between light and dark paper as it turns",
      "the cloud floor and the mountain share one scale address — pinch travels the axis; the peer ring steps sideways",
    ],
  },
  {
    key: "mountain",
    title: "the peak above the fog",
    href: "/mountain",
    scale: "the olympus band — between the coast and the atlas",
    essence:
      "a peak above the sea of fog — cold gray rock, wind-held snow, blue ice in the bowls, scree, and cairns kept by hand.",
    moves: [
      "tap → an echo whose pitch follows the elevation",
      "rapid taps (1 / 3 / 5 / n) → echo → scree → ridge answer → every cairn at once",
      "one-finger drag → turns the head and pitches the look down the slope toward the feet",
      "two-finger pan → the frame yaws and pitches together",
      "hold → places a cairn; ceremony stacks it taller",
      "twist → turns the lens from felt mountain to contour diagram",
      "scrub → stirs the inversion: clockwise draws the fog down, counterclockwise lifts it, deeper circles move more",
      "drumming two spots → a volley of calls into the range, each answered at its own distance",
      "a steady tap tempo → the sea of fog breathes at your pulse for a while",
      "three-finger drag → raises or lowers the fog altitude; sideways moves the sun, independently",
      "tilt / shake (once invited) → the horizon rolls; tipping the vessel pitches the gaze down the flank, or scree loosens",
      "two-finger hold to dwell → opens the peak peer ring toward the cloud floor",
    ],
    finds: [
      "earth opens a lateral door down onto the mountain — press, release, press again",
      "the cloud floor sits beside the peak as a peer, not above it on the pinch axis",
      "look down and the outcrop under the ledge enters the march — the pitch is a camera axis, not a painted horizon slide",
      "snow holds on lee aspects and sheds from windward rock; glacier tongues stay blue in the shaded bowls",
      "cornices brighten only on the lee side of a knife-edge, so the wind decides which arête goes white",
      "raising the fog only ever drowns more land — the swell rolls, but the sea's altitude never secretly falls",
    ],
    keeps: "the cairns you stacked",
  },
  {
    key: "aphros",
    title: "play the shells",
    href: "/aphros",
    essence: "a full-viewport painting of the Triumph of Galatea, where foam is the material and every gesture writes into the shader.",
    moves: [
      "tap → a kiss of foam wake and a note chosen by position",
      "rapid taps (1 / 3 / 5 / n) → foam → the pod leaps → the shell rings → a squall breaks",
      "hold → plants a lace bloom that keeps growing the longer you hold",
      "release at the ceremony tier → the bloom ascends into the shell",
      "twist → the painting crossfades into its own preparatory sepia line-drawing",
      "scrub → winds a whirlpool, churning harder the deeper and faster you circle",
      "a steady tap tempo → the surf entrains, breaking at the shell on your pulse",
      "two-finger tap → the drawing lowers, or the frame springs home",
      "three-finger tap → tutti, every bloom flashes at once",
      "shake / tilt (once invited) → a squall, or a leaning swell",
    ],
    finds: [
      "after 20s untouched, the sea gathers a wake at the shell unbidden",
      "the dolphins' leaps genuinely push wakes into the shader when they break the water",
      "a three-finger hold keeps slowing the shore the longer it stays",
    ],
    keeps: "up to 12 living blooms (ascended ones are let go)",
  },

  // --- nature ---
  {
    key: "flowers",
    title: "petals · symmetry",
    scale: "the flowers band — between a drop and the birds",
    href: "/flowers",
    essence: "a dark garden where every flower is a deterministic species decoded from a seed, grown and bloomed entirely by hand.",
    moves: [
      "hold on open soil (dwell) → plants a seed; keep holding and it grows toward bloom",
      "keep holding past bloom → it overblooms, breathing wider the longer you stay",
      "hold a spent flower to the ceremony tier → it wilts back into the soil",
      "rapid taps (1 / 3 / 5 / n) → a sway → loose pollen → a coaxed crown or a volunteer called up → a wave across the whole garden",
      "a steady tap tempo → every bed sways on your pulse for a while",
      "drag → a breeze that sways nearby heads",
      "twist → turns the lens from felt garden to botanical diagram",
      "scrub → stirs pollen into the air, more the deeper and faster you circle",
      "two-finger hold to dwell → opens the meadow peer ring toward the birds",
    ],
    finds: [
      "on a seeded daily schedule, flowers volunteer and live out a whole life unattended, faster when time isn't dilated",
      "the same botany decodes /growth's blossoms — a species opens the same way in both rooms",
      "earth opens downward onto this garden — the ground's first inward door",
    ],
    keeps: "the flowers you've deliberately planted (volunteers don't persist)",
  },
  {
    key: "cells",
    title: "the plasm keeps its own tide",
    scale: "the cells band — between molecules and a drop",
    href: "/cells",
    essence: "a warm microscopy field where cells are pure functions of a seed — membrane, nucleus, cilia — drifting over brownian motes.",
    moves: [
      "tap → a wavefront through the plasm; harder taps push farther",
      "triple-tap → mitosis of the nearest closed cell, or a seed if the dish is empty",
      "five-tap → rupture — the nearest cell lets its membrane go",
      "rapid train past seven → a wave of mitosis rewrites the nearby culture",
      "hold on open plasm (dwell) → seeds a cell, membrane closing as you hold",
      "hold on an existing cell → charges mitosis; at the ceremony tier it divides into two daughters",
      "drag → stirs the cytoplasm and pushes nearby cells, the current answering under the hand as it moves",
      "two fingers held apart on two cells → a cytoplasmic bridge draws between them, the two voices sustained and the plasm streaming along it, thickening the longer you hold",
      "a steady tap rhythm → cilia entrain to your pulse for a while",
      "twist → turns the lens to a stained microscope slide",
      "tilt / shake (once invited) → the plasm settles downhill, or seethes in a brownian storm",
      "knock the case (once invited) → the coverslip rings and every cell answers at once",
      "lay it face-down (once invited) → night; the lamp under the stage goes down and the plasm nearly stills",
      "blow across it (invited by the ceremony hold) → the candle pool gutters and the motes go with the draught",
    ],
    finds: [
      "the membrane visibly narrows along the true division axis before a cell actually splits",
      "pinch here is deliberately not the room's own — it belongs to the shared travel between bands",
      "the harder you stir or shake, the heavier the room feels in the hand — one intensity axis under sight, sound and touch",
      "leave the dish overnight and it has gone on without you — descendants, a settled dimmer glow on the elders, the census eased toward its own resting point",
    ],
    keeps: "the cells you've seeded, generation by generation, and the real hours between visits",
  },
  {
    key: "organelles",
    title: "the organs before the body",
    scale: "the organelles band — between dna and a whole cell",
    href: "/organelles",
    essence:
      "a streaming plasm holding six organs, and one fixed amount of membrane between them — draw surface into any of them and the others visibly smooth to pay for it.",
    moves: [
      "tap an organelle → it rings its own timbre; how folded it is decides how many partials you hear",
      "triple-tap → draws membrane into the organ, or condenses the organ the cell still lacks",
      "five-tap → rupture — the organ gives its whole membrane back to the plasm",
      "rapid train past seven → gathers every missing organ, then the whole ledger rings",
      "hold an organelle → the membrane budget flows into it while you hold, and the rest of the plasm pays in the same frame",
      "circle a finger on an organelle → winds its folds deeper; the other way lets them out",
      "two fingers held apart on two organs → a membrane tubule draws between them, both timbres sustained and vesicles budding along it — no membrane is spent, so the ledger's total never moves",
      "drag an organelle → it moves through the flow, and the flow drags back",
      "drag an organelle near the ghost membrane → the growing ring pulls it gently inward, gathering the cell by hand",
      "two fingers drag → pan the frame over the plasm; pinch stays with ScaleTravel",
      "hold on open plasm (dwell) → the organ the cell is still missing condenses there",
      "hold the nucleus to the ceremony → it opens onto the helix within",
      "three fingers drag → the streaming rate; three fingers hold → the clock slows to a quarter; three fingers tap → every organ rings in size order",
      "twist → raises the lens to the ledger, where the budget is drawn as shares of one constant total",
      "tilt → the plasm pours; shake → it churns; knock → the nearest organ rings",
    ],
    finds: [
      "a smooth vesicle is one sine, exactly — and a cristae-folded mitochondrion is a stack of partials, so you can hear how folded a thing is without looking",
      "nothing is created here: the ledger's total never moves, however you push the membrane around",
      "gather all six organs in one plasm and the cell membrane closes around them of its own accord — when the ring settles, the plasm becomes the cell above",
    ],
    keeps: "the organs you've gathered, and how the membrane is shared between them",
  },
  {
    key: "tissue",
    title: "when one becomes many",
    scale: "the tissue band — between one cell and the petal it is part of",
    href: "/tissue",
    essence:
      "a sheet of a few hundred cells held together by an adhesion graph, where how many neighbours hold a cell is the interval that cell sings — six is the root, and a cell coming loose falls through fifths and thirds toward the tritone.",
    moves: [
      "tap a cell → it sings its degree; a miss ripples the plasm nearby",
      "triple-tap → mitosis — the nearest cell divides",
      "five-tap → rupture — apoptosis of the nearest cell",
      "rapid train past seven → a cluster of divisions rewrites the local epithelium",
      "stroke across the sheet → the cells the stroke passes divide; both daughters bloom with a brighter note and haptic in the same frame",
      "hold one finger down → the sheet is drawn in at that point and a pit opens, deeper the longer it is held",
      "hold past the ceremony → the pit closes over and its floor becomes a second layer, sealed for good",
      "hold on empty dark (after letting the sheet go) → a new epithelium plants itself under the finger",
      "two fingers drag → pan the frame over the dense sheet, so you can inspect an edge without leaving the band",
      "flick → a tear; every bond the line crosses lets go at once and the chord roughens in the same frame",
      "circle a finger → the sheet swirls under it and the bonds it turns come under strain",
      "two fingers held apart on two cells → the interval between them is held taut, the two degrees ringing as a sustained dyad while the tissue stretches, deepening the longer it is held",
      "three fingers drag → adhesion, the world-law: run it down and the sheet comes apart, run it up and the bonds re-form",
      "three fingers tap → the whole chord at once; three fingers hold → the clock slows to a quarter",
      "three fingers twist → the body axis turns, and the differentiation pattern turns with it",
      "twist → raises the lens to notation: the ratios, the cell count, the roughness, the degree spectrum as bars",
      "a steady tap rhythm → the sheet's contraction wave takes your tempo",
      "arrow keys → step between cells; enter → divides one; held enter → draws the pit in at it; esc → lowers the lens",
      "tilt (once invited) → gravity leans the sheet; shake → every bond strains and the loose ones give; knock → the whole chord rings",
    ],
    finds: [
      "a bond letting go is audible before it is visible — the two cells it held drop a degree and sing a rougher interval in the same frame",
      "after ~20s untouched, a short pale stroke crosses a few cells — the sheet showing its own verb, never a label",
      "a white contour creeps across the sheet: the differentiation front, landing fates behind itself, and under a three-finger hold you can watch it crawl",
      "the bonds are coloured by how hard they are being pulled, so you can see where the sheet is about to give before it gives",
      "the sheet is the same sheet at 60 and 120 hz — a fixed-step integrator, deterministic from its seed",
    ],
    keeps: "the sheet: every division, every tear, every fate landed, and any layer you sealed",
  },
  {
    key: "birds",
    title: "the living aviary",
    scale: "the birds band — between the flowers below and the shore above",
    href: "/birds",
    essence:
      "a small evening aviary over meadow, pond, tree, fruit and hay — thirteen readable bird bodies, each with its own size, place, motion and call.",
    moves: [
      "tilt the device → wind, camera sway, haptic ticks and a small retune; the birds bank into the real vessel",
      "shake → every resident flushes into flight and the aviary bursts outward",
      "tap a bird → that species answers in its own body: hummingbird hovers, peacock displays, duck swims, raptor soars or dives, chicken hops, ibis stalks",
      "rapid taps (1 / 3 / 5 / n) → startle → spawn → cull (or flush) → clear the sky",
      "tap empty air → nearby birds scatter and call",
      "hold one finger → feeds and grows the nearest bird into eating; held on empty meadow, the nearest bird roosts and the flock gathers to the hand",
      "drag one finger → steers the wind and pushes birds aside",
      "flick → a gust, and launches the nearest bird into a swoop or flight",
      "circle a finger → the murmuration turns about its own axis, and winds itself tighter",
      "two-finger drag → pans the habitat frame over meadow, pond and tree; pinch stays with ScaleTravel",
      "two fingers twist → the observer turns, and the sun swings across the sky with your head",
      "three fingers twist → the season, and with it where the flock is going",
      "three fingers drag → the wind, for a device that cannot be tilted; three fingers hold → the clock slows to a quarter; three fingers tap → the tutti",
      "knock → one wave of wingbeats crosses the sky; lay it face-down → night flash, and the aviary goes slow",
      "breath, when granted → softens the flock and lowers its wingbeat",
      "pinch through a scale wall → the birds scatter and die back as the room travels",
      "tap a steady tempo → the wingbeat takes it",
      "drum two spots, hand answering hand → the flock volleys the space between them, each side sounded in its own register; keep the patter and the animal binds tighter",
      "two fingers rested → a held interval from the flock's own chord; the murmuration strings out along it, straighter the longer it is kept, and exhales on release",
      "arrows → the observer turns and the wind pushes; enter → a startle; held enter → the gathering; esc → everything let go",
      "two fingers held to dwell → the meadow peer ring, a lateral door to the garden below",
    ],
    finds: [
      "each of the thirteen kinds keeps its own silhouette and marks: hooked amazon beak, cockatiel crest, falcon malar and pointed wings, red-tailed fan, mallard spatulate bill, chicken comb, tall emu, goldfinch notch, sparrow bib, hummingbird needle, scarlet sickle bill, peacock eye-spots, paradise gold cape",
      "shared across every body: an eye with pupil and glint, breast ruffles, feather barbs on open wings, and a soft mantle sheen — species only customize beak, crest, train and cape",
      "ducks sit low in the pond, hummingbirds blur at the fruiting canopy, raptors cut pointed wings through the upper air, peacocks and paradise birds open plumes, emus stand tall on the grass",
      "the meadow is the same camera as the birds — a ground-plane ray with foreshortened grass blades, a circular pond and a projected tree at the flock's places; the birds are instanced SDF quads that grow nearer and keep a dark rim",
      "the sound is the order parameter and nothing else: count the partials and you can read back how gathered the flock is — one animal is the harmonic series exactly, k× the fundamental",
      "a scattered flock calls more often than a gathered one, so the rate of the chatter is a second reading of the same number",
      "the wave of wingbeats after a knock crosses the sky rather than firing at once — the flock is wide, and the news takes time",
    ],
    keeps: "the flock's character — how it separates, aligns and gathers — with the season and where you were facing",
  },
  {
    key: "dna",
    title: "the ladder that copies",
    scale: "the dna band — between organic molecules and organelles",
    href: "/dna",
    essence:
      "one helix standing in the dark, where the strand and its melody are the same object seen twice — four bases, four scale degrees, and the tune reads back into the sequence it came from.",
    moves: [
      "drag across the helix → unzips it; the hydrogen bonds break in order, each one a tick, and a gc-rich stretch is genuinely harder to pull",
      "keep the finger down while it is open → a polymerase runs the complement and plays the tune back in the mirror",
      "hold through the open stretch → a daughter ribbon peels beside the ladder and condenses into a chromatid",
      "let go → the ladder re-anneals; the chromatid stays as the copy you made",
      "held enter → the same unzip and copy on a keyboard; release and it closes",
      "drag along the helix → supercoils it, winding turns into the length",
      "two fingers held apart on two rungs → a denaturation bubble is held open between them, the two base pairs pinned by the fingers while the stretch between melts and their interval sustains — it re-anneals when you lift",
      "tap a rung → sounds that base's degree",
      "triple-tap a rung → rewrites the nucleotide itself, stepping A→T→G→C with a new tint, note and haptic in the same frame",
      "five-tap a rung → a true mutation lands there (or a snip when the world is cold)",
      "rapid train past seven → a local mutation burst, then the strand sings what it became",
      "three fingers drag → the mutation temperature; the world begins rewriting the code on its own",
      "three fingers tap → the whole strand played as its melody; three fingers hold → the clock slows to a quarter",
      "twist → raises the lens to notation: the letters, the transcript, the melting point, and the melody drawn as a contour",
      "tilt → the ladder leans; shake → a mutation burst; knock → one rung rings",
    ],
    finds: [
      "the resistance of the unzip is the real hydrogen-bond count — two for a·t, three for g·c — so you can feel the composition before the lens tells you",
      "the weak a·t rungs shiver visibly more than the g·c ones, and more still as the world warms",
      "the melody climbs an octave every eight bases, so the ear hears how far along the strand the polymerase has reached",
      "finish a polymerase run on an open stretch and a chromatid peels off — the copy made visible, not only heard",
    ],
    keeps: "the strand, with every mutation you or the world have made to it",
  },
  {
    key: "organics",
    title: "what carbon does when it has time",
    scale: "the organic-molecules band — between molecules and dna",
    href: "/organics",
    essence:
      "a warm solvent holding loose carbon, nitrogen and oxygen, and the chains a hand talks them into — where a strained molecule beats aloud and the beating stops at the tetrahedral angle.",
    moves: [
      "tap a chain → a thermal kick; the geometry bends and the beating starts again",
      "triple-tap → bonds a loose atom onto a chain end, or condenses a new chain in open solvent",
      "five-tap → rupture — a sealed coil comes apart; an open chain takes a hard kick",
      "rapid train past seven → warmth spikes and nearby chains unlock and re-beat",
      "drag a loose atom onto a chain end → it bonds where valence allows, and is pushed firmly away where it does not",
      "hold on open solvent (dwell) → condenses a new chain, bond by bond",
      "hold on a chain → the fold; the press itself is the folding time, extended through nucleated to a locked coil",
      "three fingers drag → warmth, which holds every chain off its floor",
      "three fingers hold → the field's clock slows to a quarter",
      "twist → raises the lens to skeletal notation, where what you built is named",
      "tilt → a current through the solvent; shake → a thermal scatter; knock → one sharp spike",
    ],
    finds: [
      "the beat rate is the strain, exactly: a chain at its minimum makes no beat at all, and the room falls quiet as it settles",
      "hexane, glucose and glycine are all reachable by hand, and two glycines held together give up a water",
      "a fully folded chain is a coil — which is the backbone the ladder one band up is made of",
    ],
    keeps: "the chains you've built, and how far each one has folded",
  },
  {
    key: "molecules",
    title: "what the bond holds, the solvent carries",
    scale: "the molecules band — between atoms and cells",
    href: "/molecules",
    essence: "a solvent of drifting, tumbling molecules with honest bond orders and real curated reaction chemistry.",
    moves: [
      "tap → a thermal kick, lighter molecules flying further than heavy ones",
      "triple-tap → condenses a molecule under the hand, or warms one already there",
      "five-tap → rupture — the nearest molecule dissolves",
      "rapid train past seven → fires a reaction with a docked partner, or a heat storm through the solvent",
      "hold on open field (dwell) → condenses a molecule, bond by bond",
      "hold a molecule near a compatible partner → charges a real reaction; at the ceremony tier it fires",
      "flick → throws a molecule tumbling with a doppler pair of notes",
      "twist → turns the lens to the structural formula, true bond multiplicity drawn honestly",
    ],
    finds: [
      "every compound has one behavioral tell — CO₂ warms the whole field, water finds water and leans together",
      "a dashed arc breathes between two molecules that could react, proposed without a word of text",
    ],
    keeps: "the molecules you've condensed",
  },
  {
    key: "atoms",
    title: "probability breathes around a bright nucleus",
    scale: "the atoms band — between nucleons and molecules",
    href: "/atoms",
    essence: "a near-vacuum of soft probability clouds obeying real covalence and real fusion, all the way up to iron.",
    moves: [
      "tap → excites an electron, ring flashing outward",
      "hold near a compatible partner → charges covalent bonding; refusal pushes incompatible atoms firmly apart",
      "drag or flick a cloud into another fast enough → fuses them into a new element",
      "three-finger hold → slows time, the deliberate way to line up a fusion",
      "twist → turns the lens to the orbital diagram, with the element's symbol and atomic number",
    ],
    finds: [
      "past iron, colliding atoms bounce off an elastic wall instead of fusing — the stellar dead end, felt rather than explained",
      "shift+enter throws the atom under the keyboard cursor at its nearest neighbor, the same fusion physics as a flick",
    ],
    keeps: "the atoms and bonds you've made",
  },
  {
    key: "nucleons",
    title: "the valley makes the elements",
    scale: "the nucleons band — between quarks and atoms",
    href: "/nucleons",
    essence: "a dark field of nuclei as charged liquid drops — gold protons and parchment neutrons packed in a breathing skin — every size, hum, and appetite decided by the semi-empirical mass formula.",
    moves: [
      "tap a drop → the giant resonance rings it; struck hard, a strained drop shakes a neutron loose",
      "hold on open field (dwell) → condenses a free neutron; keep holding to the ceremony and the vacuum pays for a proton instead",
      "flick a free nucleon into a drop → a neutron always walks in; a proton must arrive fast enough to climb the coulomb barrier or it is turned away",
      "hold a drop to the ceremony tier → it does the thing it already wanted: beta, alpha, or fission",
      "scrub a drop → spins it toward a spindle; a fissile drop spun past holding necks and splits, throwing prompt neutrons at its neighbors",
      "three-finger drag → a neutron flux across the field — the r-process, one capture and one beta at a time",
      "drive two drops together hard → they merge into a heavier element, or bounce off each other's charge",
      "twist → turns the lens to the chart of the nuclides — n against z, the valley drawn, every drop plotted with its symbol",
    ],
    finds: [
      "nuclei off the valley of stability decay on their own clock, faster the farther off they sit — the room changes element while nobody touches it",
      "a knock on the case shakes a neutron loose from the heaviest drop",
      "at a = 238 the valley bottoms out at uranium — not placed by hand, it falls out of the energy",
    ],
    keeps: "the nuclei you've made, element by element",
  },
  {
    key: "quarks",
    title: "nothing here can be alone",
    scale: "the quarks band — between the quanta and nucleons",
    href: "/quarks",
    essence: "a vacuum that is never empty — color-neutral hadrons held by gluon flux tubes, seething with a seeded sea of virtual pairs.",
    moves: [
      "hold on open vacuum (dwell) → condenses a hadron, spinning up as it grows",
      "drag across open vacuum → a wake of pairs and a rising degree of the field, the run climbing from the left edge to the right",
      "drag a single quark → the tube resists more the further you pull; pull far enough and it snaps into a new bound pair, never a free quark",
      "hold a hadron to the ceremony tier → annihilates it into real photons at light speed",
      "flick → throws a whole hadron, every quark moving together",
      "twist → turns the lens to the bare Feynman diagram",
      "knock the case (once invited) → a wavefront of pair production crosses the field and everything bound answers at once",
      "lay it face-down (once invited) → night; the seethe goes on under the dark and comes back when you turn it over",
    ],
    finds: [
      "the vacuum's own seethe is fixed and shared — every visitor sees the same virtual pairs flicker at the same moments",
      "you can never isolate a single quark: pulling one free only ever creates a new pair at the break",
      "the room is tuned by its address: every pitch here is an offset from the register this depth of the axis assigns, high and quick, over a bed of zero-point hiss",
    ],
    keeps: "the hadrons you've bound",
  },
  {
    key: "quanta",
    title: "mass buys only a moment",
    scale: "the quanta — the floor of the whole axis",
    href: "/quanta",
    essence: "the field floor: every particle a ripple, and one great law — lifetime and reach are inverse to mass. photons cross forever sounding e = hf; the heavy bosons die within a fingertip's breadth.",
    moves: [
      "hold on open field → deposits energy that climbs the mass ladder; a short hold excites a photon, the dwell tier a matter–antimatter pair, the ceremony at full charge births a higgs",
      "tap a photon → it chirps its own pitch, literally e = hf in the audible register",
      "flick a photon → light cannot be hurried, only redirected — the note doppler-bends instead",
      "flick or drag a charged lepton → the ghosts and the light pass under your finger; only mass can be carried",
      "hold an unstable excitation to the ceremony tier → it decays now, the whole conservation-exact chain cascading down the ladder",
      "scrub → stirs a gluon out of the vacuum: massless yet leashed, dressing itself in cycling color until the field takes it back",
      "three-finger drag → the collision wind; wind it up far enough and it pair-produces — the w pair costs more than a higgs, and only the beam can afford one",
      "three-finger hold → dilates time, and the heavy bosons visibly live longer — the collider's own trick",
      "twist → raises the bare-field lens: the feynman view, world lines and coils and wavy lines, the one lettered surface",
    ],
    finds: [
      "neutrinos stream through everything and answer a tap about one time in eight — the ghost is real",
      "cosmic muons rain in on their own seeded schedule and die into electrons mid-flight",
      "tilt leans only the massive: light and neutrinos ignore gravity entirely",
    ],
    keeps: "the stable residue — the electrons, photons, and neutrinos still crossing",
  },
  {
    key: "fire",
    title: "the element that breathes",
    href: "/fire",
    scale: "the earth band — hearth peer of the strata",
    essence: "a combustion field on WebGL — blackbody heat, convection plumes, embers and pressure wells, driven by touch as though it were real heat.",
    moves: [
      "tap → seeds an ember burst",
      "drag → bends convection, laying a glowing heat stroke",
      "hold, released early → a burst of white heat; held mid-way to the ceremony tier, seals the bed in white",
      "three-finger drag → crosswind, strong enough to gutter the flame",
      "three-finger hold → the whole fire slows to a quarter speed",
      "scrub → a fire whirl catches embers in a turning column",
      "pinch through the edge → travels the scale axis from the earth",
      "two-finger hold to dwell → opens the hearth peer ring toward the earth",
    ],
    finds: [
      "time dilation is honest all the way down — slowing time slows the fire's memory, not just its motion",
      "a steady tap rhythm makes the bed's own breath fall in with your pulse",
    ],
  },
  {
    key: "earth",
    title: "strata · seismograph · root",
    scale: "the earth band — between the atlas and the stars; hearth peer of fire",
    href: "/earth",
    essence: "a mineral cross-section — sky, surface, eight strata, and a live seismograph reading your hand as geologic pressure.",
    moves: [
      "tap a stratum → seeds a mineral proper to that layer and lights it",
      "rapid taps (1 / 3 / 5 / n) → seed → quake → mineral cascade through the column → full rupture",
      "drag through the strata → shears them, laying visible faults",
      "long-press → compresses the rock, blooming a metamorphic glow",
      "tap or long-press the seismograph strip → a quake, rippling through the trace",
      "the stratum buttons → jump straight to any layer",
      "pinch through the inward wall → the garden first; press again for the beach or the mountain",
      "two-finger hold to dwell → opens the hearth peer ring toward fire",
    ],
    finds: [
      "merely moving your hand across the page draws on the seismograph — it's a real integrator, not decoration",
      "a quake's spike genuinely rings back and forth on the trace rather than just decaying",
      "the ground keeps three inward doors — flowers, coast, olympus — cycled by repeated wall-press",
    ],
  },
  {
    key: "growth",
    title: "sigmoid · exponential · decay",
    href: "/growth",
    scale: "the flowers band — meadow peer of birds and flowers",
    essence: "vines whose shape is a growth equation, blossoming with the same species genetics as /flowers.",
    moves: [
      "tap or hold open field → seeds a vine; hold a blossom → carries it toward bloom, then overbloom",
      "rapid taps (1 / 3 / 5 / n) → a wobble → the vine arpeggiates → a bloom-wave runs the stem → the whole trellis pulses",
      "a steady tap tempo → the field's growth pulse entrains to your hand",
      "drag → bends the field's own equation live — gravity, rate, ceiling all reshape as you move",
      "hold, dwell → forces the current model's signature act (saturate, reproduce, collapse, or rest, by mode)",
      "scrub → stirs a falling-petal eddy, more the deeper and faster you circle",
      "two-finger tap → the lens lowers, or the field's forces ease one step toward rest",
      "the four mode buttons → sigmoid, exponential, decay, lifecycle",
      "twist → turns the lens toward the bare equations",
      "pinch through the edge → travels the scale axis from the garden",
      "two-finger hold to dwell → opens the meadow peer ring (birds, flowers, growth)",
    ],
    finds: [
      "forcing the exponential model actually reproduces — it spawns six new vines in a ring",
      "nothing here is stored: a blossom is a pure function of its vine's seed and its place on it, forever",
    ],
  },
  {
    key: "stars",
    title: "the night sky",
    scale: "the stars band — between the earth and beyond; sky peer of comb and beam",
    href: "/stars",
    essence: "a four-layer nested night sky you pan and zoom through, where stars are born by hand, worlds condense, and black holes merge.",
    moves: [
      "tap empty sky → births a star; tap a bright one → a supernova",
      "rapid taps (1 / 3 / 5 / n) → birth → nova → pulsar / tidal flare → gamma-ray burst",
      "hold ~0.8s → opens a black hole's accretion; release and nearby stars are pulled in or swallowed",
      "pinch → zooms, crossfading through galactic, cluster, system, and local layers",
      "shift+click stars, then enter → names and keeps a constellation",
      "double-click a star you made → condenses a world into orbit around it",
      "two-finger hold to dwell → opens the sky peer ring toward comb and beam",
    ],
    finds: [
      "black holes that meet genuinely inspiral and merge, singing a real gravitational chirp as they go",
      "a bright star dies on its own now and then, and its remnant can become a brand-new black hole",
    ],
    keeps: "your named constellations, plus every layer's born stars, worlds, and black holes",
  },
  {
    key: "space",
    title: "the web that holds the light",
    scale: "the deep-space band — between the stars and the fold",
    href: "/space",
    essence:
      "a dark-matter density field with galaxies strung along it, where the sky you can see is a measurement of the one you cannot: light stands exactly where the invisible field stands above its threshold, and nowhere else.",
    moves: [
      "drag one finger → parallaxes the volume; the near web slides over the far",
      "flick → the drift keeps going, and eases",
      "tap a galaxy → it sounds its own local density, a heavier well ringing lower",
      "rapid taps (1 / 3 / 5 / n) → ring → filament neighbors flare → veil peek → the whole web states itself",
      "hold on a galaxy → pulls it into resolution: its arms first, then its star systems; keep holding and the star systems are the sky below, and you are in it",
      "three fingers held → the veil: the dark matter every galaxy has been sitting in becomes visible, and keeps deepening the longer you hold",
      "three fingers drag → sideways cuts deeper into the halo, up and down runs structure formation; wind it far enough back and the sky empties while the dark matter stays",
      "three fingers twist → the same season, turned rather than dragged",
      "three fingers tap → the whole sky states itself once, densest first",
      "circle a finger → rolls the sky about the line of sight",
      "twist → raises the lens onto the skeleton: the knots and the filaments under the light",
      "tilt → leans the volume; shake → peculiar velocities stir the web; knock → the nearest knot rings; face-down → night, and at night the galaxies go out and the web stays",
      "arrows → walk the lit galaxies; enter → sounds one; held enter → resolves it and goes down; v → the veil; esc → lowers everything",
    ],
    finds: [
      "a galaxy's shape is another reading of the same invisible field — ellipticals only ever in the cluster knots, ragged irregulars only out at the void's edge, spirals along the filaments between",
      "novae are rare and real: about one a minute, and the same one in the same second of every visit, because the whole universe here is one seed",
      "the web's own breath is ~48 seconds long — the register the scale axis assigns this place, and the note a median filament sounds is that register exactly",
    ],
    keeps: "the galaxies you have pulled into resolution",
  },
  {
    key: "comb",
    title: "comb the light · the cowlick stays",
    href: "/comb",
    scale: "the stars band — sky peer of the night",
    essence: "a field of light combed by a direction field carrying topological defects, where the total winding never goes away.",
    moves: [
      "drag → combs the streaks of light along your stroke",
      "tap → blooms a vortex; hold on one → feeds it",
      "rapid taps → three invert into a saddle; five split the nearest sun into a conserved trio; seven and beyond flare every charge at once",
      "hold on open field → a saddle point forms and commits on release",
      "hold to the ceremony tier → a charge pair is born together, winding conserved",
      "circle a finger → stirs the comets into a ring; drum two spots → sparks shower between your hands",
      "tap a steady beat → the field's breath entrains to your tempo",
      "twist → rotates the whole field's phase",
      "shake (once invited) → slams the nearest pair of opposite charges together",
    ],
    finds: [
      "slamming opposite charges into contact is the only way to annihilate them and remove winding from the field",
      "five rapid taps split a sun into two suns and a saddle — the total winding never changes, however the field is struck",
      "rotating the device between portrait and landscape flips the direction of time itself",
    ],
  },

  // --- mechanism ---
  {
    key: "signal",
    title: "music is also waves",
    href: "/signal",
    essence: "the room's own sound made visible as a spectrum, a waveform, and a nautilus spiral, wrapped around a text-prompted music receiver.",
    moves: [
      "tap the spectrum band → plays that frequency directly",
      "rapid taps → three stack the tapped frequency with its overtones; five sing the room's whole phrase; seven and beyond climb the bins in a crescendo",
      "drum two spots in alternation → both frequencies sound and their difference tone hums beneath them",
      "tap a steady beat → the nautilus turns at your tempo, pulsing on every beat",
      "drag the waveform → distorts it, harder pressure digging deeper",
      "rest a finger on the spiral → the live signal is kept; held to the ceremony it seals with a bell",
      "the prompt field → asks the room to compose and loop a piece",
      "the nudge buttons (slower, more bells, deeper sea, less bright) → reshapes the current piece without stopping it",
      "\"keep\" → saves the piece to a short list you can replay",
    ],
    finds: [
      "a finished procedural piece quietly regenerates a fresh variation so the music never actually stops",
      "two alternating fingers make a third tone neither is playing — the difference between them, the beat frequency made audible",
    ],
    keeps: "up to 12 kept signals",
  },
  {
    key: "light",
    title: "color music",
    href: "/light",
    essence: "a full-screen spectral plate — x is wavelength, y is brightness, with visible scale frets that bloom near your finger, played on a sustaining synth.",
    moves: [
      "touch → sounds the wavelength under your finger; every finger stacks a chord",
      "drag → glides the pitch",
      "double-tap the same spot → a sub-bass kick",
      "rapid taps → three bloom the color's own triad; five run the whole spectrum red through violet; seven and beyond bring the sub floor up under every strike",
      "drum two spots in alternation → the interval between your hands sounds as one strum",
      "tap a steady beat → a kick walks on your tempo for a few bars, the plate flashing with it",
      "\"listen\" → plays a chord lesson with ghost hands on the plate",
      "keys a s d f g h j k l → a pentatonic keyboard row",
      "shake → strums everything you've touched as an arpeggio",
    ],
    finds: [
      "visible scale frets bloom brighter where your finger is nearest — the continuum becomes a piano of light under the active lens",
      "a quick tap booms like a drum; the same touch held is a sustained note — the release decides which",
    ],
  },
  {
    key: "music-color",
    title: "notes into color",
    href: "/light/inverse",
    essence: "the inverse translator — a written score becomes a long color bar and a matrix, each note carrying its own wavelength.",
    moves: [
      "the score field → write or paste a melody (tempo, key, notes, chords, rests)",
      "tap any color cell → it sounds its own note, ringing longer the firmer the strike",
      "rapid taps on a cell → three play its whole row in score time; five perform the full translation; seven and beyond climb it an octave per strike",
      "\"interpret\" → asks the room to read a sheet-music photo or loose text into a real score",
      "\"play notes\" → plays it back, lighting the bar and matrix in time",
      "\"export bar\" / \"export matrix\" → downloads the color rendering as an image",
    ],
    finds: [
      "unparseable tokens don't fail the whole score — they're quietly skipped and named, and the rest still plays",
      "every cell of the bar and the matrix is itself an instrument — the translation reads back by touch, one color at a time",
    ],
  },
  {
    key: "timbre",
    title: "one surface, every instrument",
    href: "/timbre",
    essence: "one plate where sideways is pitch and up-and-down morphs continuously through eight physically modeled instruments, with soft band gravity that settles a resting hand onto a voice.",
    moves: [
      "touch → sounds a note in whatever instrument that height blends toward",
      "rest on a band → gravity settles you onto that instrument; a fast stroke stays free to morph",
      "drag vertically → morphs the physical model itself, not just the tone color",
      "multiple fingers → each one its own instrument at its own height",
      "\"listen\" → walks one note through the full chain, then stacks an orchestra chord",
      "keys a s d f g h j k l → plays the last-touched instrument from the keyboard",
    ],
    finds: [
      "between two instruments the readout names a real blended hybrid rather than snapping to one or the other",
      "the lesson's ghost fingers land where yours should — one pitch morphing harp through trumpet, then a room-wide chord",
    ],
  },
  {
    key: "instrument",
    title: "every finger a voice",
    href: "/instrument",
    essence: "the same meta-instrument as /timbre, spoken entirely through the gesture grammar — every finger a voice, pinch a zoom, twist a lens.",
    moves: [
      "touch → sounds a note; every finger is independent",
      "pinch → zooms the pitch window to finer and finer intervals",
      "twist → steps the scale lens between pentatonic, chromatic, and pure light-frequency tuning",
      "\"listen\" → demonstrates staggered voices, a pinch that zooms the pitch window, and a twist that turns the scale lens — all with ghost hands",
      "keys a s d f g h j k l → plays the pentatonic row from the plate's last position",
    ],
    finds: ["fingers that land more than 80ms apart are always treated as voices and can never be mistaken for a pinch, so a rolled chord is always safe"],
  },
  {
    key: "plasma",
    title: "plasma globe",
    href: "/plasma",
    essence: "a glass plasma globe — an ionized core under glass, with lightning filaments reaching toward every finger.",
    moves: [
      "touch → cracks a spark where you land",
      "hold and drag → banks heat; lift your last finger with enough heat and it discharges as a bright arc",
      "hold to the ceremony tier → a full corona, filaments in every direction",
      "three-finger drag → bends every arc in the wind",
      "scrub → an orbiting filament chases your turn around the rim",
    ],
    finds: ["heat decays like real inertia rather than resetting instantly, so a globe you just left keeps glowing a little longer"],
  },
  {
    key: "pulse",
    title: "heartbeat · pattern",
    href: "/pulse",
    essence: "a hospital-monitor membrane driven by four physiological oscillators — heart, breath, pressure, mind — plus a fifth pattern you can name and keep.",
    moves: [
      "tap / drag → a pressure bloom, or continuous conducting",
      "drum with two hands, alternating → becomes the heart's own pacemaker, overriding its autonomous beat",
      "hold to the ceremony tier → keeps the current pattern under an auto-generated name",
      "the channel buttons → toggle heart, breath, pressure, mind on or off",
      "\"shock\" → a full defibrillation, then the monitor returns on its own",
    ],
    finds: ["drumming genuinely overrides the room's own heartbeat while your hands keep time, and it settles back the moment you stop"],
    keeps: "up to 18 saved patterns, plus a shareable link that carries your exact settings",
  },
  {
    key: "charts",
    title: "lines · candles · oscillators",
    href: "/charts",
    essence: "a three-panel trading terminal where every plotted candle, derivative point, and oscillator value is a physical handle you can bend by hand.",
    moves: [
      "tap or drag a candle → plays its note and lets you stretch its wick",
      "tap or drag the derivative or oscillator panels → bends those points directly",
      "drag the bare left margin → scrubs volatility, an invisible handle",
      "triple-tap → reseeds the whole field",
      "hold to the ceremony tier → pins the current reading",
      "twist → drops the lens to the raw random walk underneath the candles",
      "tilt the device → the plate tips and the whole reading slides down-slope, with a tick at the steep detent",
      "shake → churns the field; the panels roil and settle back over the next few seconds",
      "knock the case → rings the plate, one wave of light crossing all three panels",
      "lay the device face-down → night; the reading darkens and the scan line stands still",
    ],
    finds: [
      "the chart listens to the rest of the site — recent touches elsewhere in the album nudge its volatility",
      "a long hold does two things in sequence: the candle grows past 900ms, and past 2500ms the reading is pinned",
      "nobody has to touch it: the reading breathes on its own, a slow swell walking the panels on the site's shared clock",
    ],
    keeps: "one pinned snapshot of the whole chart",
  },
  {
    key: "dither",
    title: "ordered dots · signal studies",
    href: "/dither",
    essence: "a dithered data-viz lab — an eight-month chart rendered through a real Bayer pattern, plus a deterministic name-to-avatar generator.",
    moves: [
      "tap the chart → scrubs to that month and locks the tooltip in place",
      "flick → strums all eight months in order",
      "hold to the ceremony tier → snaps the ink to full density and keeps it",
      "twist → resolves the dither into raw continuous tone and back",
      "the name field → presses any name into a mirrored, deterministic avatar",
    ],
    finds: ["the avatar is a pure hash of the letters — the same name always returns the same face"],
  },
  {
    key: "time",
    title: "bend a clock",
    href: "/time",
    essence: "a playable relativity instrument — a worldline climbing between two light cones, and two clocks where proper time visibly falls behind coordinate time.",
    moves: [
      "drag left/right → sets velocity; up/down → sets mass, curving the grid into a well",
      "flick → throws the traveller at that speed",
      "hold on open space (dwell) → gravity gathers; held to the ceremony tier, the well is sealed",
      "scrub → winds both clocks, proper time falling further behind the faster you've set the traveller",
      "twist → turns the lens through the worldline, then duration as it is felt, then the bare metric — one continuous turn, answering the whole way",
      "two-finger drag → slides the frame over the manifold; the dials stay where they are",
      "two-finger tap → steps back: a raised lens lowers a level, then the frame comes home",
      "three-finger drag → drifts the flow of the clock; three-finger hold → both clocks slow to a quarter speed",
      "three-finger tap → one pulse of everything alive at once",
      "tilt the device → gravity: the mass slides downhill with real weight, and every curve follows it",
      "shake → the geodesic shivers and the clock races; knock the case → the manifold rings; lay it face down → night, and both hands stand still",
    ],
    finds: [
      "on a phone, a single tap starts and stops the clocks; on a desktop the same tap sets velocity and mass at once",
      "at the felt-duration lens the two ladders start together and open apart — the gap between them is the falling-behind",
      "the clocks are already running and falling apart the moment you arrive, and the well rings itself down on its own — pausing is the one deliberate stillness here",
    ],
  },
  {
    key: "tourbillon",
    title: "the carriage against gravity",
    href: "/tourbillon",
    scale: "the drop band — cabinet peer among the handhelds",
    essence: "a fully modeled watch calibre in 3D — mainspring, going train, escapement, balance wheel, and a tourbillon carriage that turns once a minute so the case's own lean never has the last word.",
    moves: [
      "tap a part → wind the mainspring, still the movement, or cycle its speed; each gear rings its own pitch",
      "scrub (circle a finger) → turns the crown, ratcheting the mainspring",
      "hold to the ceremony tier → sets the watch to true local time",
      "twist → opens the case, dial off, bare going train",
      "three fingers twist → cycles the dial through genève stripes, aventurine, and nacre",
      "two fingers tap → steps the camera back; three fingers tap → rings every gear at once",
      "tilt the device (a resting cursor stands in without one) → leans the case; shake or knock it → the balance swings wide and rings",
      "drag empty space → orbits the camera around the whole calibre",
      "two-finger hold to dwell → opens the cabinet peer ring (drop, seed, coin, jewel, watch…)",
    ],
    finds: [
      "the parts are the interface — tapping the crown does exactly what winding does, and it visibly depresses",
      "the cage under the balance never stops turning, on its own, whether the case is leaning or dead level",
      "lean the case hard and hold it: the balance's glow swings warm then cool as the cage carries it through the position, proof the average still lands at zero",
    ],
  },
  {
    key: "jewel",
    title: "turn the stone",
    href: "/jewel",
    scale: "the drop band — cabinet peer among the handhelds",
    essence: "one molten-gold gemstone as a full-screen shader — caustics, sparkle, and dispersion that shimmer with the site's own sound.",
    moves: [
      "drag → turns the stone; letting go leaves it spinning with real weight and friction",
      "touch a spinning stone → catches it, arresting the momentum",
      "flick → throws it into a fast spin",
      "twist → turns the stone over to its mirror face",
      "the six gem buttons → re-cuts the stone and plays its own chord",
      "hold to the ceremony tier → seals the stone at full fire",
    ],
    finds: ["every way of handling the stone adds to one shared \"fire\" — it visibly gets hotter the more you touch it"],
  },
  {
    key: "drop",
    title: "a cosmos in glass",
    scale: "the drop band — between cells and flowers",
    href: "/drop",
    essence: "a bead of water as a soft, surface-tension body, with dark-field microscopic life that reveals itself the deeper you dive.",
    moves: [
      "tap or drag → dents and sloshes the bead",
      "a fast, far drag → necks a whole new droplet off and hands it to your finger",
      "flick → throws a droplet clear of the bead; over open water it sends a current through the cluster",
      "double-tap → bounces the bead",
      "two fingers dragged down, or the wheel → sinks the lens into the water, revealing smaller life as you go",
      "tap a microbe → startles it into darting away",
      "hold to the ceremony tier → the water goes glass-calm",
      "tilt → gravity, and the bead runs downhill; shake → sloshes it, and hard enough necks a droplet off",
      "knock the case (once invited) → one concentric shudder rings through every bead",
      "lay the phone face-down → night, and the water sleeps until you turn it back",
      "arrows → sink the lens and shove the water; shift with an arrow → flicks a droplet clear; enter → pokes the bead, and held to the ceremony stills it",
      "two-finger hold to dwell → opens the cabinet peer ring (seed, coin, jewel, tourbillon, watch…)",
      "pinch through the edge → travels the scale axis; twist while the ring is open cycles its beads",
    ],
    finds: [
      "each of the nine microscopic species only fades in at its own depth, so diving in is genuinely discovering",
      "pulling a droplet off takes real force — speed, stretch, and size all have to agree at once",
      "a mouse hovering near the bead is felt before it lands: the surface leans toward the cursor and the life inside notices",
      "the cabinet at this scale holds every handheld room — a drop, a seed, a coin, a watch — without leaving the band",
      "left alone the water keeps trembling and catching a draught, dust keeps settling into it, and its bacteria go on dividing",
    ],
  },
  {
    key: "seed",
    title: "an embryo in dark soil",
    href: "/seed",
    scale: "the drop band — cabinet peer of the drop, between cells and flowers",
    essence: "a single living seed in dark soil — husk, radicle, cotyledons — grown, rattled, and split by hand.",
    moves: [
      "tap → pokes the seed and rings a low note",
      "hold → grows the radicle; ceremony splits the husk",
      "drag → nudges its lean",
      "scrub → stirs the soil around it",
      "three-finger tap → a soft pulse through the field",
      "tilt / shake / knock / flip (once invited) → lean, rattle, shudder, or sleep",
      "two-finger hold to dwell → opens the cabinet peer ring toward the drop and the other handhelds",
    ],
    finds: [
      "growth deepens with how hard and how long you hold — a brief touch and a ceremony are different lives",
      "a seed and a drop share one scale; the cabinet ring steps between them without leaving the band",
    ],
    keeps: "how far this seed has grown, and how many times it has split",
  },
  {
    key: "coin",
    title: "a gold medal · tilt · flip",
    href: "/coin",
    scale: "the drop band — cabinet peer among the handhelds",
    essence: "a real gold medal hanging in an aventurine night that permanently brightens the more you handle it.",
    moves: [
      "tap → flips the coin toward your touch and rings that direction's note",
      "drag → resizes or tilts it; a fast drag rubs it to a shine",
      "twist → rotates it in the hand; a full turn flips it to its other face",
      "tilt the phone → the coin leans and can flip on a sudden tilt",
      "hold to the ceremony tier → blesses the medal, its largest single gift of brilliance",
      "pinch through the edge → travels the scale axis from the drop",
      "two-finger hold to dwell → opens the cabinet peer ring (drop, seed, jewel, tourbillon, watch…)",
    ],
    finds: ["every interaction adds permanent brilliance to the night sky around it — it only ever climbs, asymptotically, never fading"],
    keeps: "how bright the night has become",
  },
  {
    key: "watch",
    title: "the room",
    href: "/watch",
    scale: "the drop band — cabinet peer among the handhelds",
    essence: "a candle-lit still life at night — a living flame at its center, ringed by small instruments: a clock, a music box, a record, a glass, a book, a window on the sea.",
    moves: [
      "tap the candle → sparks, or relights it if it's out",
      "hold the candle (dwell) → snuffs it; hold on through the dark to the ceremony tier → a vigil brings it back, kept, brighter",
      "tap the record → plays or stops; double-tap reverses it; triple-tap changes its mood",
      "drag the glass → pours it, each level its own pitch",
      "knock the case (once invited) → the clock ticks once out of turn and the flame flinches",
      "pinch through the edge → travels the scale axis from the drop",
      "two-finger hold to dwell → opens the cabinet peer ring",
    ],
    finds: ["snuffing and the vigil are the same held press at different depths — you can only keep a vigil over a candle you just put out yourself"],
  },
  {
    key: "manifold",
    title: "every scale kept in one fold",
    scale: "the manifold — the crown of the whole axis",
    href: "/manifold",
    essence: "the whole album as one object — a fabric that wells under masses you place, threaded with a filament carrying every scale band as a bead.",
    moves: [
      "tap open fabric → a pulse that races at exactly light speed; tap a bead → hear that band's own register",
      "hold open fabric (dwell) → a mass gathers, warping the fabric",
      "hold a built room's bead to the ceremony tier → travels there",
      "twist → drops the lens to the bare metric, the only place notation appears on the site",
      "three-finger hold → time slows and the light itself nearly stands still",
    ],
    finds: [
      "your own tap and the light in the shader travel at exactly the same speed — race it and it never wins",
      "the cosmic web genuinely holds together near a mass and expands everywhere else",
    ],
    keeps: "the masses you've placed on the fold",
  },
  {
    key: "overlook",
    title: "the whole tree kept in one glance",
    href: "/overlook",
    essence: "the entire scale axis drawn as a living tree, the quanta at the root and the fold at the crown, derived structurally from the site's own travel graph.",
    moves: [
      "tap a node → chimes at that band's register; tap open air → the tree leans gently",
      "pinch → zooms the whole view (the one room where pinch is a camera, not travel)",
      "hold a node to the ceremony tier → travels there",
      "three-finger tap → every node pulses in order, the whole site heard once as one glissando",
      "twist → drops the lens to the bare derived graph",
    ],
    finds: ["the tree is never hand-authored — it's derived live from the same travel graph the rest of the site uses, so a cosmology change redraws it for free"],
  },
  {
    key: "loom",
    title: "one structure, every sense",
    href: "/loom",
    essence: "one abstract structure compiled at once into five materials — sound, shape, text, space, touch — with a live table proving each still carries the same invariants.",
    moves: [
      "tap or hold → pours attention into the gathering; the longer you hold, the faster it pours",
      "hold to the ceremony tier, once the structure reaches agency → keeps a future, once",
      "pinch → reaches for a farther or nearer future to select",
      "twist → raises the lens onto the bare structure and its conservation law",
      "tilt the phone → pours attention with no touch at all",
    ],
    finds: ["the verification table distinguishes a medium that honestly can't witness something from one that's actually broken — most marks are the natural loss of translation, not failure"],
    keeps: "how many times you've carried the structure across its threshold",
  },
];

/**
 * Every documented room: the hand-written entries above plus the entries
 * rooms declare in their own manifest (`src/rooms/<key>/room.config.ts`).
 * A room with a manifest never edits this file — its guide entry travels with
 * the room, which is what "documentation moves with the change" was always
 * asking for. `scripts/test-guide.mjs` still checks coverage and screenshots
 * for both sources alike.
 */
export const GUIDE_ROOMS: GuideRoom[] = [...CORE_GUIDE_ROOMS, ...roomGuideEntries()];

// ---------------------------------------------------------------------------
// the workshop — how the machinery is kept
// ---------------------------------------------------------------------------

export const GUIDE_WORKSHOP: GuideWorkshopPart[] = [
  {
    title: "how it is made",
    paragraphs: [
      "next.js 14 app router, typescript, tailwind kept light, zustand for the one shared store. every room is a thin page in src/app with its real body in src/components. the seas and skies are fragment shaders on webgl canvases; the surface forms are 2d canvas; the deep objects — the tourbillon, the drop — are three.js; the prose that bends around sigils is measured line by line with pretext. all of it procedural: no stock, no sound packs, no downloaded assets anywhere.",
      "every sound comes from one web audio graph (src/lib/audio.ts) whose lfo clocks are shared with the visuals, so what you see breathes with what you hear. haptics ride the same intensity axis. and everything generated — sigil, music, flower, constellation — is a deterministic function of a small state vector: your night sounds like yours, always.",
    ],
  },
  {
    title: "the laws a room signs",
    paragraphs: [
      "determinism from small vectors, with no model calls in the loop that renders state. procedural over assets. every meaningful change lands in at least two senses in the same frame. no controls to learn and no instructions, ever — everything discoverable by a curious hand in sixty seconds, glimmers instead of labels, nothing punished. lowercase copy holding two of the three registers: devotional, operational, oceanic.",
      "each room honors prefers-reduced-motion, keeps its keyboard dialect, and holds at 390px. the full law is in INSPIRATION.md and AGENTS.md in the repository; the checklist in INSPIRATION.md §7 is the bar a room clears before it ships.",
    ],
  },
  {
    title: "the shared buses",
    paragraphs: [
      "new work joins the organs that exist rather than growing private ones. src/lib/audio.ts — the one audio graph, ambient beds, one-shots, per-concern voices. src/lib/haptics.ts — the haptic bus and the ios core haptics bridge, speaking sea-words: tap, ripple, chop, roll, storm. src/lib/turbulence.ts — the shared intensity axis. src/lib/world.ts — the persistent world, where a shell planted on one shore can migrate overnight. src/lib/vessel.ts — tilt, shake, knock, flip, breath, with the candle owning permission. src/lib/gesture/ — the semantic gesture engine; rooms bind meanings, never raw pointers, and every threshold lives in gesture/core.ts alone. src/lib/scale.ts — the scale manifold: bands, detents, travel, spectral registers.",
    ],
  },
  {
    title: "the scale manifold",
    paragraphs: [
      "the album mounts one logarithmic axis from 10⁻²² meters to the spacetime manifold: the quanta, quarks, nucleons, atoms, molecules, cells, a drop, flowers, the coast, the atlas, the earth, the stars, beyond, the manifold. within a band, pinch zooms freely and rubber-bands at the walls; crossing a wall takes sustained intent — hold the pinch through the resistance and a haptic detent marks the door. the focused object of one band becomes the container of the next, so it stays one world. scale also chooses the sound: sub-bass and minute-long lfos at the cosmic end, mids at human scale, granular shimmer among the atoms — zooming is a glissando on the site's one instrument.",
    ],
  },
  {
    title: "composing a new room",
    paragraphs: [
      "the first decision is ordinal: find the level where the room lives on the quark→manifold axis, prefer deepening an existing band over adding a room, and branch only where containment genuinely forks. then copy src/components/RoomTemplate.tsx — a compilable scaffold already wired to every bus: gestures, vessel, audio, haptics, persistence with the quiet clear control, glimmer, keyboard, reduced motion.",
      "register the room where the tests expect it: src/app/<room>/ (thin page + layout), src/lib/routes.ts, src/lib/site-icon-config.ts, scripts/test-routes.mjs, SCALE_BANDS when it takes a band — and its entry in this guide, with a fresh screenshot. extract the room's laws into a pure lib module and pin them with falsifiable tests only: determinism, conservation, monotonicity, round trips. docs/new-room.md in the repository is the full method.",
    ],
  },
  {
    title: "keeping this guide true",
    paragraphs: [
      "this page is maintained under the documentation law in AGENTS.md: any change that adds, removes, or alters a room, a gesture, a bus, or an api updates src/data/guide.ts in the same pr, and re-shoots the affected screenshots with npm run shoot:guide. the test suite fails when the registry and this guide drift apart — the site cannot quietly outgrow its own account of itself.",
    ],
  },
];

// ---------------------------------------------------------------------------
// the http api — filled from src/app/api; test-guide.mjs checks each exists
// ---------------------------------------------------------------------------

export const GUIDE_APIS: GuideApi[] = [
  {
    name: "ask-the-room",
    method: "POST",
    takes: "a question (≤400 chars), plus the current concern state, region, and carried object",
    returns: "one short paragraph, answered in the room's own voice",
    notes: "Claude Haiku 4.5 first, Gemini 2.5 Flash as fallback; 503 if neither key is set",
  },
  {
    name: "imagine-entry",
    method: "POST",
    takes: "a title (≤80 chars) and a few concern tags",
    returns: "a new archive entry: { fn, note, body[] }",
    notes: "same model ladder as ask-the-room; 502 if the model returns the wrong shape",
  },
  {
    name: "generate-music",
    method: "POST",
    takes: "a prompt (≤500 chars) and whether to thread a sea-wash coda",
    returns: "a short mp3 clip, base64-encoded",
    notes: "Gemini's Lyria only — no Anthropic fallback; 503 without GEMINI_API_KEY",
  },
  {
    name: "generate-speech",
    method: "POST",
    takes: "text (≤1200 chars) and an optional voice name",
    returns: "a wav clip, spoken warm and unhurried, close to the microphone",
    notes: "Gemini TTS only; retries once on failure",
  },
  {
    name: "parse-music-input",
    method: "POST",
    takes: "loose music text and/or a photo of sheet music",
    returns: "a normalized score plus any parsing warnings",
    notes: "falls back to a fully local parser for text with no key; a photo needs GEMINI_API_KEY",
  },
  {
    name: "atlas/generate",
    method: "POST",
    takes: "a prompt, the current atlas tile, viewport, and generation phase (preview or final)",
    returns: "a generated tile image plus its hotspots and seeds, or a demo tile with the same shape",
    notes: "image models (OpenAI or OpenRouter), rate-limited per visitor; runs in demo mode with no keys set, so the atlas stays playable either way",
  },
];
