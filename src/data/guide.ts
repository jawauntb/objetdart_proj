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
      "the rooms are moored along one line from quarks to the spacetime manifold. pinch to zoom inside a room; hold the pinch through the resistance at the edge and you travel to the neighboring band, a haptic tick at the door.",
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

export const GUIDE_ROOMS: GuideRoom[] = [
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
    key: "atlas",
    title: "the living map",
    href: "/atlas/origin",
    scale: "the atlas band — between the coast and the earth",
    essence: "one continuous generative world-plane you roam by camera — drag to travel, pinch to zoom in place, tap a landmark to open a whole map of that thing.",
    moves: [
      "drag → pans the camera; drifting past the edge travels to the neighboring territory",
      "hold still on open ground (~1.8s) → plants a cairn, a wildflower, or a rare animal trail",
      "pinch → zooms in place; pinching at the floor requests a wider chart",
      "tap a hotspot → opens a whole new map of that subject",
      "the four edge buttons → travel toward the (sometimes already-named) neighbor",
      "a prompt field → mints an entirely new territory from a few words",
    ],
    finds: [
      "after ~20s idle, a random landmark's halo swells once — a physical hint, never a label",
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
    key: "ocean",
    title: "the deep · dive down",
    href: "/ocean",
    scale: "the coast band — between a drop and the atlas",
    essence: "the whole body of water, and a dive straight down through it, from sunlit surface to the abyss.",
    moves: [
      "tap → a ripple at the surface, or a bioluminescent spark in the deep",
      "hold near the surface (dwell) → plants a shell, kelp, driftwood, or starfish",
      "hold to the ceremony tier → the planted thing settles for good",
      "two-finger drag, vertical → dives the camera down the water column",
      "three-finger drag / hold → wind, or the whole sea slowed to a quarter speed",
      "tilt / shake (once invited) → the sea leans and churns with the real device",
    ],
    finds: [
      "depth gates the vocabulary — planting only works near the surface, the abyss is deliberately quiet",
      "a shell planted here can drift and turn up later on /tide, because naturals share one world, not one page",
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
      "hold near the waterline (dwell → ceremony) → plants a natural, its kind chosen by the tide you just made",
      "knock the case (once invited) → skips a stone across the water, three real bounces",
      "the \"tune\" panel → align sun (spring tide) or set it to quarter (neap tide)",
    ],
    finds: [
      "what you can plant depends on the tide you made — low water yields starfish, high water yields driftwood",
      "the Moon's face lights by its angle to the Sun, so the phase you build is the phase you see",
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
      "hold, in the pond → grows a lily, then a fallen leaf, then a koi takes residence",
      "medium buttons → switch between ripple, string, and refraction",
      "the \"tune\" sliders → speed, damping, drop size",
      "scrub (circle a finger) → stirs the pond into a turning current",
    ],
    finds: [
      "one long hold passes through three stops — lily, leaf, koi — a single press grows a small ecology",
      "leave the pond alone and it keeps living: leaves fall, dragonflies dip, koi surface on their own",
    ],
    keeps: "the pond's naturals — lilies, leaves, koi",
  },
  {
    key: "sine",
    title: "wave explorer",
    href: "/sine",
    essence: "the fundamental oscillator as an instrument — a sine ribbon that bends through every finger you set on it, each one its own voice.",
    moves: [
      "touch → a note sounds instantly, pitched by height; every finger is its own voice",
      "move a finger → glides its pitch and bends the whole waveform",
      "flick → throws a pulse down the wave",
      "circle a finger → bends the frequency up or down",
      "mode buttons → source, interference, standing wave",
    ],
    finds: ["three fingers moving the same way winds the whole phase — read straight off the moving voices, never a separate gesture"],
  },
  {
    key: "pretext",
    title: "playable text",
    href: "/pretext",
    essence: "a sentence turned into an instrument — real prose laid out along a wave-shaped column, then loosened into six motions.",
    moves: [
      "drag anywhere → up sets amplitude, right sets frequency; a note tracks both",
      "the six mode buttons (move / shift / shake / quake / wave / sine) → each jumps the wave to that motion's signature shape",
      "the prompt field → asks the room to write the text you're playing",
      "\"speak\" → the room reads the current text aloud",
    ],
    finds: ["if the room can't answer, it falls back to one of four sentences chosen deterministically from your own prompt — a failure always fails the same way"],
  },
  {
    key: "circularity",
    title: "circles to waves",
    href: "/circularity",
    essence: "a Fourier instrument — a chain of up to twelve rotating circles whose tip draws an unrolled waveform beside it.",
    moves: [
      "drag → rotates the chain and sets how many harmonic terms are drawn",
      "flick → throws the wheel spinning, which slows on its own",
      "hold (dwell) → grows the series by one more harmonic; to the ceremony tier → all twelve unfurl at once",
      "twist → turns the lens between the spinning circles and the unrolled wave",
      "preset buttons → square, saw, triangle, pulse",
    ],
    finds: ["the lens is a ratchet, not a dial — a long twist flips circle and wave once per quarter turn"],
  },
  {
    key: "beyond",
    title: "novel wave field",
    href: "/beyond",
    scale: "the beyond band — between the stars and the manifold",
    essence: "a living interference field — four incommensurate wave functions summed into one grid, folded and pulled by hand.",
    moves: [
      "press and drag → x folds the pattern, y pulls it, both live",
      "\"keep fold\" then \"replay fold\" → saves the exact composition, including where you touched, and restores it",
      "the \"tune\" sliders → cell size, fold, pull, bloom",
      "pinch → zooms; held through the edge, travels to the neighboring band",
    ],
    finds: ["the field is a fixed weighted sum of four frequencies, not noise — the aliveness comes from their incommensurability"],
  },
  {
    key: "storm",
    title: "pressure · charge · discharge",
    href: "/storm",
    essence: "a weather instrument — drag the sky to bank static charge, then discharge it as branching lightning with thunder delayed by distance.",
    moves: [
      "drag the sky → banks charge; tap the sky once charged → discharges",
      "tap or drag the sea → raises a crest, or sculpts spray",
      "three-finger drag → sets the wind heading",
      "hold to the ceremony tier → opens the eye of the storm (a second hold closes it)",
      "the barometer dial and wind rose → set pressure and heading directly",
    ],
    finds: [
      "thunder is delayed by how far the strike lands from center — a bolt at the edge rumbles noticeably later than one overhead",
      "reduced motion floors how fierce the storm is allowed to get, not just how it animates",
    ],
  },
  {
    key: "clouds",
    title: "olympus",
    href: "/clouds",
    essence: "the cloud floor — four banks of sky running a two-minute day, with a drifting chorus of air glyphs and weather you can gather by hand.",
    moves: [
      "tap → a cloud puff, or a whoosh from whichever glyph you touched",
      "hold, gathering charge → releases as a storm cell; held to the ceremony tier, the storm is kept with lightning",
      "drag → shears the wind locally; three fingers race the whole sky",
      "the sun/moon glyph → advances the day by a quarter turn",
    ],
    finds: [
      "a storm's strength is exactly proportional to how long you held past the threshold",
      "the day cycle genuinely drives the palette — labels and tooltips flip between light and dark paper as it turns",
    ],
  },
  {
    key: "aphros",
    title: "play the shells",
    href: "/aphros",
    essence: "a full-viewport painting of the Triumph of Galatea, where foam is the material and every gesture writes into the shader.",
    moves: [
      "tap → a kiss of foam wake and a note chosen by position",
      "hold → plants a lace bloom that keeps growing the longer you hold",
      "release at the ceremony tier → the bloom ascends into the shell",
      "twist → the painting crossfades into its own preparatory sepia line-drawing",
      "three-finger tap → tutti, every bloom flashes at once",
      "shake / tilt (once invited) → a squall, or a leaning swell",
    ],
    finds: [
      "after 20s untouched, the sea gathers a wake at the shell unbidden",
      "the dolphins' leaps genuinely push wakes into the shader when they break the water",
    ],
    keeps: "up to 12 living blooms (ascended ones are let go)",
  },

  // --- nature ---
  {
    key: "flowers",
    title: "petals · symmetry",
    scale: "the flowers band — between a drop and the coast",
    href: "/flowers",
    essence: "a dark garden where every flower is a deterministic species decoded from a seed, grown and bloomed entirely by hand.",
    moves: [
      "hold on open soil (dwell) → plants a seed; keep holding and it grows toward bloom",
      "keep holding past bloom → it overblooms, breathing wider the longer you stay",
      "hold a spent flower to the ceremony tier → it wilts back into the soil",
      "drag → a breeze that sways nearby heads",
      "twist → turns the lens from felt garden to botanical diagram",
      "scrub → stirs pollen into the air",
    ],
    finds: [
      "on a seeded daily schedule, flowers volunteer and live out a whole life unattended, faster when time isn't dilated",
      "the same botany decodes /growth's blossoms — a species opens the same way in both rooms",
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
      "hold on open plasm (dwell) → seeds a cell, membrane closing as you hold",
      "hold on an existing cell → charges mitosis; at the ceremony tier it divides into two daughters",
      "drag → stirs the cytoplasm and pushes nearby cells",
      "a steady tap rhythm → cilia entrain to your pulse for a while",
      "twist → turns the lens to a stained microscope slide",
    ],
    finds: [
      "the membrane visibly narrows along the true division axis before a cell actually splits",
      "pinch here is deliberately not the room's own — it belongs to the shared travel between bands",
    ],
    keeps: "the cells you've seeded, generation by generation",
  },
  {
    key: "molecules",
    title: "what the bond holds, the solvent carries",
    scale: "the molecules band — between atoms and cells",
    href: "/molecules",
    essence: "a solvent of drifting, tumbling molecules with honest bond orders and real curated reaction chemistry.",
    moves: [
      "tap → a thermal kick, lighter molecules flying further than heavy ones",
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
    scale: "the atoms band — between quarks and molecules",
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
    key: "quarks",
    title: "nothing here can be alone",
    scale: "quarks — the floor of the whole axis",
    href: "/quarks",
    essence: "a vacuum that is never empty — color-neutral hadrons held by gluon flux tubes, sitting in a seeded sea of virtual pairs.",
    moves: [
      "hold on open vacuum (dwell) → condenses a hadron, spinning up as it grows",
      "drag a single quark → the tube resists more the further you pull; pull far enough and it snaps into a new bound pair, never a free quark",
      "hold a hadron to the ceremony tier → annihilates it into real photons at light speed",
      "flick → throws a whole hadron, every quark moving together",
      "twist → turns the lens to the bare Feynman diagram",
    ],
    finds: [
      "the vacuum's own seethe is fixed and shared — every visitor sees the same virtual pairs flicker at the same moments",
      "you can never isolate a single quark: pulling one free only ever creates a new pair at the break",
    ],
    keeps: "the hadrons you've bound",
  },
  {
    key: "fire",
    title: "the element that breathes",
    href: "/fire",
    essence: "a combustion field on WebGL — blackbody heat, convection plumes, embers and pressure wells, driven by touch as though it were real heat.",
    moves: [
      "tap → seeds an ember burst",
      "drag → bends convection, laying a glowing heat stroke",
      "hold, released early → a burst of white heat; held mid-way to the ceremony tier, seals the bed in white",
      "three-finger drag → crosswind, strong enough to gutter the flame",
      "three-finger hold → the whole fire slows to a quarter speed",
      "scrub → a fire whirl catches embers in a turning column",
    ],
    finds: [
      "time dilation is honest all the way down — slowing time slows the fire's memory, not just its motion",
      "a steady tap rhythm makes the bed's own breath fall in with your pulse",
    ],
  },
  {
    key: "earth",
    title: "strata · seismograph · root",
    scale: "the earth band — between the atlas and the stars",
    href: "/earth",
    essence: "a mineral cross-section — sky, surface, eight strata, and a live seismograph reading your hand as geologic pressure.",
    moves: [
      "tap a stratum → seeds a mineral proper to that layer and lights it",
      "drag through the strata → shears them, laying visible faults",
      "long-press → compresses the rock, blooming a metamorphic glow",
      "tap or long-press the seismograph strip → a quake, rippling through the trace",
      "the stratum buttons → jump straight to any layer",
    ],
    finds: [
      "merely moving your hand across the page draws on the seismograph — it's a real integrator, not decoration",
      "a quake's spike genuinely rings back and forth on the trace rather than just decaying",
    ],
  },
  {
    key: "growth",
    title: "sigmoid · exponential · decay",
    href: "/growth",
    essence: "vines whose shape is a growth equation, blossoming with the same species genetics as /flowers.",
    moves: [
      "tap or hold open field → seeds a vine; hold a blossom → carries it toward bloom, then overbloom",
      "drag → bends the field's own equation live — gravity, rate, ceiling all reshape as you move",
      "hold, dwell → forces the current model's signature act (saturate, reproduce, collapse, or rest, by mode)",
      "the four mode buttons → sigmoid, exponential, decay, lifecycle",
      "twist → turns the lens toward the bare equations",
    ],
    finds: [
      "forcing the exponential model actually reproduces — it spawns six new vines in a ring",
      "nothing here is stored: a blossom is a pure function of its vine's seed and its place on it, forever",
    ],
  },
  {
    key: "stars",
    title: "the night sky",
    scale: "the stars band — between the earth and beyond",
    href: "/stars",
    essence: "a four-layer nested night sky you pan and zoom through, where stars are born by hand, worlds condense, and black holes merge.",
    moves: [
      "tap empty sky → births a star; tap a bright one → a supernova",
      "hold ~0.8s → opens a black hole's accretion; release and nearby stars are pulled in or swallowed",
      "pinch → zooms, crossfading through galactic, cluster, system, and local layers",
      "shift+click stars, then enter → names and keeps a constellation",
      "double-click a star you made → condenses a world into orbit around it",
    ],
    finds: [
      "black holes that meet genuinely inspiral and merge, singing a real gravitational chirp as they go",
      "a bright star dies on its own now and then, and its remnant can become a brand-new black hole",
    ],
    keeps: "your named constellations, plus every layer's born stars, worlds, and black holes",
  },
  {
    key: "comb",
    title: "comb the light · the cowlick stays",
    href: "/comb",
    essence: "a field of light combed by a direction field carrying topological defects, where the total winding never goes away.",
    moves: [
      "drag → combs the streaks of light along your stroke",
      "tap → blooms a vortex; hold on one → feeds it",
      "hold on open field → a saddle point forms and commits on release",
      "hold to the ceremony tier → a charge pair is born together, winding conserved",
      "twist → rotates the whole field's phase",
      "shake (once invited) → slams the nearest pair of opposite charges together",
    ],
    finds: [
      "slamming opposite charges into contact is the only way to annihilate them and remove winding from the field",
      "rotating the device between portrait and landscape flips the direction of time itself",
    ],
  },
  {
    key: "beam",
    title: "the eye of heaven · bokeh petals",
    href: "/beam",
    essence: "a binary pair of soft suns wearing rings of comet-petal bokeh, sweeping through a day of shifting color.",
    moves: [
      "tap → refocuses the depth of field at that point",
      "hold → the pupil dilates toward night; release → a slow exhale ripples outward",
      "drag → a gust leans the petals",
      "pinch → pulls the two suns apart or reels them together",
      "the tempo slider and \"let night fall\" → scale the whole clock, or force night",
    ],
    finds: [
      "squeezing the two suns close enough merges them into one with a flash, and they drift back apart on their own",
      "a petal breaks formation and streaks across the sky as a meteor every so often, on its own",
    ],
    keeps: "your tempo, day/night state, and how far apart you left the suns",
  },

  // --- mechanism ---
  {
    key: "signal",
    title: "music is also waves",
    href: "/signal",
    essence: "the room's own sound made visible as a spectrum, a waveform, and a nautilus spiral, wrapped around a text-prompted music receiver.",
    moves: [
      "tap the spectrum band → plays that frequency directly",
      "drag the waveform → distorts it, harder pressure digging deeper",
      "the prompt field → asks the room to compose and loop a piece",
      "the nudge buttons (slower, more bells, deeper sea, less bright) → reshapes the current piece without stopping it",
      "\"keep\" → saves the piece to a short list you can replay",
    ],
    finds: ["a finished procedural piece quietly regenerates a fresh variation so the music never actually stops"],
    keeps: "up to 12 kept signals",
  },
  {
    key: "light",
    title: "color music",
    href: "/light",
    essence: "a full-screen spectral plate — x is wavelength, y is brightness, played on a sustaining synth.",
    moves: [
      "touch → sounds the wavelength under your finger; every finger stacks a chord",
      "drag → glides the pitch",
      "double-tap the same spot → a sub-bass kick",
      "keys a s d f g h j k l → a pentatonic keyboard row",
      "shake → strums everything you've touched as an arpeggio",
    ],
    finds: ["a quick tap booms like a drum; the same touch held is a sustained note — the release decides which"],
  },
  {
    key: "music-color",
    title: "notes into color",
    href: "/light/inverse",
    essence: "the inverse translator — a written score becomes a long color bar and a matrix, each note carrying its own wavelength.",
    moves: [
      "the score field → write or paste a melody (tempo, key, notes, chords, rests)",
      "\"interpret\" → asks the room to read a sheet-music photo or loose text into a real score",
      "\"play notes\" → plays it back, lighting the bar and matrix in time",
      "\"export bar\" / \"export matrix\" → downloads the color rendering as an image",
    ],
    finds: ["unparseable tokens don't fail the whole score — they're quietly skipped and named, and the rest still plays"],
  },
  {
    key: "timbre",
    title: "one surface, every instrument",
    href: "/timbre",
    essence: "one plate where sideways is pitch and up-and-down morphs continuously through eight physically modeled instruments.",
    moves: [
      "touch → sounds a note in whatever instrument that height blends toward",
      "drag vertically → morphs the physical model itself, not just the tone color",
      "multiple fingers → each one its own instrument at its own height",
      "keys a s d f g h j k l → plays the last-touched instrument from the keyboard",
    ],
    finds: ["between two instruments the readout names a real blended hybrid rather than snapping to one or the other"],
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
    ],
    finds: [
      "the chart listens to the rest of the site — recent touches elsewhere in the album nudge its volatility",
      "a long hold does two things in sequence: the candle grows past 900ms, and past 2500ms the reading is pinned",
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
    ],
  },
  {
    key: "movement",
    title: "mechanical movement",
    href: "/movement",
    essence: "a fully modeled watch calibre in 3D — mainspring, going train, escapement, balance wheel — that you orbit, wind, and set by hand.",
    moves: [
      "tap a part → wind the mainspring, still the movement, or cycle its speed; each gear rings its own pitch",
      "scrub (circle a finger) → turns the crown, ratcheting the mainspring",
      "hold to the ceremony tier → sets the watch to true local time",
      "twist → opens the case, dial off, bare going train",
      "drag empty space → orbits the camera around the whole calibre",
    ],
    finds: ["the parts are the interface — tapping the crown does exactly what winding does, and it visibly depresses"],
  },
  {
    key: "jewel",
    title: "turn the stone",
    href: "/jewel",
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
      "double-tap → bounces the bead",
      "wheel or the zoom slider → dives into the water, revealing smaller life as you go",
      "tap a microbe → startles it into darting away",
      "hold to the ceremony tier → the water goes glass-calm",
    ],
    finds: [
      "each of the nine microscopic species only fades in at its own depth, so diving in is genuinely discovering",
      "pulling a droplet off takes real force — speed, stretch, and size all have to agree at once",
    ],
  },
  {
    key: "coin",
    title: "a gold medal · tilt · flip",
    href: "/coin",
    essence: "a real gold medal hanging in an aventurine night that permanently brightens the more you handle it.",
    moves: [
      "tap → flips the coin toward your touch and rings that direction's note",
      "drag → resizes or tilts it; a fast drag rubs it to a shine",
      "twist → rotates it in the hand; a full turn flips it to its other face",
      "tilt the phone → the coin leans and can flip on a sudden tilt",
      "hold to the ceremony tier → blesses the medal, its largest single gift of brilliance",
    ],
    finds: ["every interaction adds permanent brilliance to the night sky around it — it only ever climbs, asymptotically, never fading"],
    keeps: "how bright the night has become",
  },
  {
    key: "watch",
    title: "the room",
    href: "/watch",
    essence: "a candle-lit still life at night — a living flame at its center, ringed by small instruments: a clock, a music box, a record, a glass, a book, a window on the sea.",
    moves: [
      "tap the candle → sparks, or relights it if it's out",
      "hold the candle (dwell) → snuffs it; hold on through the dark to the ceremony tier → a vigil brings it back, kept, brighter",
      "tap the record → plays or stops; double-tap reverses it; triple-tap changes its mood",
      "drag the glass → pours it, each level its own pitch",
      "knock the case (once invited) → the clock ticks once out of turn and the flame flinches",
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
    essence: "the entire scale axis drawn as a living tree, quarks at the root and the fold at the crown, derived structurally from the site's own travel graph.",
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
    key: "relativity",
    title: "light keeps its own covenant",
    href: "/relativity",
    essence: "the law of relativity taught by hand — light's fixed speed, time dilation, gravity, doppler, simultaneity, and the twin paradox, sharing one dark room.",
    moves: [
      "tap open dark → a pulse at exactly the speed of light",
      "drag a light clock → carrying it visibly slows its own tick",
      "flick a beacon → sends its twin on a journey; it returns visibly younger, sounded as a detuned chord",
      "tap the gliding car → one flash splits toward both ends, but the room's own strikes land unevenly — simultaneity, heard as a gap",
      "three-finger hold → time slows and light itself nearly stands still, so its own geometry can be seen",
    ],
    finds: ["harder flicks make comets glow hotter rather than move faster — effort is capped at the speed of light and turns to heat instead"],
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

// ---------------------------------------------------------------------------
// the workshop — how the machinery is kept
// ---------------------------------------------------------------------------

export const GUIDE_WORKSHOP: GuideWorkshopPart[] = [
  {
    title: "how it is made",
    paragraphs: [
      "next.js 14 app router, typescript, tailwind kept light, zustand for the one shared store. every room is a thin page in src/app with its real body in src/components. the seas and skies are fragment shaders on webgl canvases; the surface forms are 2d canvas; the deep objects — the movement, the drop — are three.js; the prose that bends around sigils is measured line by line with pretext. all of it procedural: no stock, no sound packs, no downloaded assets anywhere.",
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
      "the album mounts one logarithmic axis from 10⁻¹⁹ meters to the spacetime manifold: quarks, atoms, molecules, cells, a drop, flowers, the coast, the atlas, the earth, the stars, beyond, the manifold. within a band, pinch zooms freely and rubber-bands at the walls; crossing a wall takes sustained intent — hold the pinch through the resistance and a haptic detent marks the door. the focused object of one band becomes the container of the next, so it stays one world. scale also chooses the sound: sub-bass and minute-long lfos at the cosmic end, mids at human scale, granular shimmer among the atoms — zooming is a glissando on the site's one instrument.",
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
