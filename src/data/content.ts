import type {
  SymbolObject, Concern, MapRegion, ArchiveEntry, ConcernKey, PhaseKey,
} from "@/lib/types";

export const OBJECTS: SymbolObject[] = [
  {
    id: "candle", label: "Candle", glyph: "flame", x: 0.5, y: 0.42,
    means: ["attention", "prayer", "endurance"],
    inscription: "what burns also keeps watch",
    fn: "Hold to focus the field. Drag onto Spirit Interior to open the prayer layer, or onto the Map to lay an attention layer.",
    concerns: ["prayer", "memory"], affordances: ["inspect", "hold", "drag", "route"],
    regions: ["spirit", "crash", "obj:map"],
  },
  {
    id: "key", label: "Key", glyph: "key", x: 0.28, y: 0.58,
    means: ["motion", "origin", "return"],
    inscription: "what carries also remembers",
    fn: "Drag onto Road Current to open the origin route.",
    concerns: ["memory", "future"], affordances: ["inspect", "drag", "combine"],
    regions: ["road", "origin"],
  },
  {
    id: "record", label: "Record", glyph: "record", x: 0.72, y: 0.55,
    means: ["loop", "archive", "memory"],
    inscription: "the groove keeps the year",
    fn: "Drag horizontally to scrub temporal phase. Drag to the sea for the memory current.",
    concerns: ["memory", "body"], affordances: ["inspect", "drag", "combine"],
    regions: ["archive", "origin", "sea"],
  },
  {
    id: "book", label: "Book", glyph: "book", x: 0.4, y: 0.66,
    means: ["theory", "diagram", "proof"],
    inscription: "a page is a held thought",
    fn: "Drag onto the Ascent Plateau for theory mode, or onto the Compass to turn the lens.",
    concerns: ["work"], affordances: ["inspect", "drag", "combine"],
    regions: ["ascent", "workbench", "obj:compass"],
  },
  {
    id: "glass", label: "Glass", glyph: "glass", x: 0.62, y: 0.7,
    means: ["ground", "reset", "clarity"],
    inscription: "still water reads the room",
    fn: "Drag onto Crash Basin to reduce pressure, or onto the Candle to relight an exhausted flame.",
    concerns: ["body", "risk"], affordances: ["inspect", "drag", "combine"],
    regions: ["crash", "obj:candle"],
  },
  {
    id: "flower", label: "Flower", glyph: "flower", x: 0.74, y: 0.4,
    means: ["care", "relation", "warmth"],
    inscription: "tending is a kind of attention",
    fn: "Drag onto House of Loves to reveal the care constellation.",
    concerns: ["love", "friendship"], affordances: ["inspect", "drag", "combine"],
    regions: ["loves"],
  },
  {
    id: "compass", label: "Compass", glyph: "compass", x: 0.5, y: 0.78,
    means: ["lens", "mode", "bearing"],
    inscription: "a bearing is a small promise",
    fn: "Rotate to turn the interpretive lens — ritual, systems, body, archive, horizon.",
    concerns: ["future", "work"], affordances: ["inspect"],
    regions: ["horizon"],
  },
  {
    id: "grid", label: "Grid", glyph: "grid", x: 0.22, y: 0.42,
    means: ["system", "structure", "tool"],
    inscription: "structure is a form of mercy",
    fn: "Drag onto Workbench Harbor to reveal the systems archive.",
    concerns: ["work", "risk"], affordances: ["inspect", "drag", "combine"],
    regions: ["workbench"],
  },
  {
    id: "notebook", label: "Notebook", glyph: "notebook", x: 0.79, y: 0.66,
    means: ["record", "draft", "ledger"],
    inscription: "the page keeps what the day forgot",
    fn: "Drag onto Archive Estuary to open the writing drawers.",
    concerns: ["memory", "work"], affordances: ["inspect", "drag", "combine"],
    regions: ["archive", "workbench"],
  },
  {
    id: "window", label: "Window", glyph: "window", x: 0.5, y: 0.2,
    means: ["threshold", "view", "channel"],
    inscription: "the room opens by a frame",
    fn: "Drag onto Future Horizon to open the future channel.",
    concerns: ["future"], affordances: ["inspect", "drag", "combine"],
    regions: ["horizon"],
  },
  {
    id: "map", label: "Map", glyph: "map", x: 0.14, y: 0.7,
    means: ["territory", "route", "bearing"],
    inscription: "a map is the room turned outward",
    fn: "Drag onto Road Current, Origin Coast, or Future Horizon to lay a route.",
    concerns: ["future", "memory"], affordances: ["inspect", "drag", "combine"],
    regions: ["road", "origin", "horizon"],
  },
];

export const CONCERNS: Concern[] = [
  { id: "memory", label: "Memory", inscription: "the past, kept usable" },
  { id: "work", label: "Work", inscription: "structure as care" },
  { id: "love", label: "Love", inscription: "warmth held open" },
  { id: "prayer", label: "Prayer", inscription: "attention turned upward" },
  { id: "risk", label: "Risk", inscription: "pressure that reveals" },
  { id: "future", label: "Future", inscription: "the open channel" },
  { id: "body", label: "Body", inscription: "the ground note" },
  { id: "friendship", label: "Friendship", inscription: "the constellation" },
];

export const PRESETS: Record<string, Record<ConcernKey, number>> = {
  Origin: { memory: 90, work: 30, love: 40, prayer: 50, risk: 20, future: 30, body: 40, friendship: 50 },
  Builder: { memory: 40, work: 95, love: 30, prayer: 30, risk: 50, future: 60, body: 40, friendship: 40 },
  Crash: { memory: 50, work: 60, love: 30, prayer: 60, risk: 95, future: 40, body: 55, friendship: 30 },
  Lover: { memory: 50, work: 30, love: 95, prayer: 50, risk: 20, future: 40, body: 60, friendship: 70 },
  Prayer: { memory: 50, work: 30, love: 50, prayer: 95, risk: 30, future: 40, body: 40, friendship: 40 },
  Operator: { memory: 40, work: 80, love: 30, prayer: 30, risk: 70, future: 70, body: 50, friendship: 40 },
  Return: { memory: 80, work: 40, love: 60, prayer: 60, risk: 30, future: 50, body: 50, friendship: 60 },
  Horizon: { memory: 30, work: 50, love: 40, prayer: 40, risk: 40, future: 95, body: 40, friendship: 50 },
};

export const REGIONS: MapRegion[] = [
  { id: "origin", label: "Origin Coast", x: 0.12, y: 0.3, inscription: "where the year begins", concerns: ["memory"] },
  { id: "road", label: "Road Current", x: 0.3, y: 0.55, inscription: "motion as inheritance", concerns: ["memory", "future"] },
  { id: "ascent", label: "Ascent Plateau", x: 0.48, y: 0.25, inscription: "the slow climb", concerns: ["work"] },
  { id: "workbench", label: "Workbench Harbor", x: 0.66, y: 0.45, inscription: "structure as a form of mercy", concerns: ["work", "risk"] },
  { id: "crash", label: "Crash Basin", x: 0.4, y: 0.78, inscription: "pressure reveals structure", concerns: ["risk"] },
  { id: "loves", label: "House of Loves", x: 0.78, y: 0.7, inscription: "the warm constellation", concerns: ["love", "friendship"] },
  { id: "spirit", label: "Spirit Interior", x: 0.22, y: 0.78, inscription: "attention turned upward", concerns: ["prayer"] },
  { id: "archive", label: "Archive Estuary", x: 0.86, y: 0.32, inscription: "everything kept", concerns: ["memory"] },
  { id: "horizon", label: "Future Horizon", x: 0.9, y: 0.6, inscription: "the open channel", concerns: ["future"] },
];

export const PHASES: PhaseKey[] = ["seed", "ascent", "crash", "love", "prayer", "return", "horizon"];

export const ARCHIVE: ArchiveEntry[] = [
  { id: "a1", title: "Field Notebook 01", medium: "writing", phase: "seed", concerns: ["memory"], fn: "first maps of the coast", region: "origin",
    year: "2014", status: "kept", objects: ["notebook", "key"], note: "Pocket-sized. Cover salt-blistered. Index in the back." },
  { id: "a2", title: "The Harbor System", medium: "systems", phase: "ascent", concerns: ["work", "risk"], fn: "tools built to hold weight", region: "workbench",
    year: "2018", status: "open", objects: ["grid", "book"], note: "A small library of load-bearing patterns." },
  { id: "a3", title: "Pressure Study", medium: "research", phase: "crash", concerns: ["risk", "work"], fn: "what breaks under load", region: "crash",
    year: "2020", status: "closed", objects: ["glass"], note: "Filed under 'what the year asked of us.'" },
  { id: "a4", title: "Care Constellation", medium: "gatherings", phase: "love", concerns: ["love", "friendship"], fn: "the people who stayed", region: "loves",
    year: "2021", status: "open", objects: ["flower"], note: "Names redacted in the public copy." },
  { id: "a5", title: "Evening Office", medium: "writing", phase: "prayer", concerns: ["prayer"], fn: "the candle hour", region: "spirit",
    year: "2022", status: "kept", objects: ["candle"], note: "Same prayer, four hundred nights." },
  { id: "a6", title: "Return Route", medium: "maps", phase: "return", concerns: ["memory", "future"], fn: "the way back is also forward", region: "road",
    year: "2023", status: "open", objects: ["map", "key"], note: "Drawn in two colors: where I went, where I am going." },
  { id: "a7", title: "Horizon Channel", medium: "experiments", phase: "horizon", concerns: ["future"], fn: "open work, unfinished", region: "horizon",
    year: "2024", status: "open", objects: ["window", "map"], note: "Notes toward a future I haven't earned yet." },
  { id: "a8", title: "Grid Studies", medium: "images", phase: "ascent", concerns: ["work"], fn: "structure, drawn", region: "workbench",
    year: "2019", status: "kept", objects: ["grid", "notebook"], note: "Thirty pages of the same line." },
  { id: "a9", title: "Tide Loops", medium: "music", phase: "return", concerns: ["memory", "body"], fn: "recorded water", region: "archive",
    year: "2022", status: "open", objects: ["record"], note: "Recorded at Origin Coast, 4am." },
  { id: "a10", title: "Origin Letters", medium: "writing", phase: "seed", concerns: ["memory", "love"], fn: "where it all started", region: "origin",
    year: "2010", status: "closed", objects: ["notebook"], note: "Twenty-two envelopes, hand-numbered." },
  { id: "a11", title: "Window Studies", medium: "images", phase: "horizon", concerns: ["future", "prayer"], fn: "what light does to a room", region: "horizon",
    year: "2024", status: "open", objects: ["window", "candle"], note: "Photographed across one year of evenings." },
  { id: "a12", title: "Lens Notes", medium: "research", phase: "ascent", concerns: ["work", "future"], fn: "five ways of looking at the same field", region: "ascent",
    year: "2023", status: "open", objects: ["compass", "book"], note: "Ritual / Systems / Body / Archive / Horizon." },
];

export const INSCRIPTIONS: string[] = [
  "pressure reveals structure",
  "what carries also builds",
  "the candle keeps the watch",
  "still water reads the room",
  "structure is a form of mercy",
  "the groove keeps the year",
  "tending is a kind of attention",
  "a bearing is a small promise",
  "what remains is enough",
];

// Hand-drawn, weighted glyphs — each object reads as that thing,
// not "an icon in a circle." Asymmetry and detail matter.
export const GLYPHS: Record<string, string> = {
  flame:
    '<path d="M12 2.4c.3 3 2.3 4.4 3.6 6.2 1.5 2 2.2 4.1 1.6 6.2-.7 2.5-3 4.2-5.4 4.2-2.4 0-4.6-1.5-5.4-3.8-.8-2.4.4-4.6 1.8-5.7-.1 1.6 1 2.3 2 2 .8-.3 1-1.4.5-2.3-1-1.9-.7-4.2 1.3-6.8z"/><path d="M12 12.6c.6 1.1.4 2.5-.6 3.3"/>',
  key:
    '<circle cx="7.6" cy="8.8" r="3.6"/><circle cx="7.6" cy="8.8" r="1" fill="currentColor" stroke="none"/><path d="M10.2 11.4l9.1 9.1M16.2 17.4l1.7-1.7M18.2 19.4l1.5-1.5"/>',
  record:
    '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="6.6" opacity=".7"/><circle cx="12" cy="12" r="4.4" opacity=".55"/><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r=".7" fill="#050d15" stroke="none"/><path d="M5 7.5L8.5 6" opacity=".4"/>',
  book:
    '<path d="M3.4 5.4c3-.9 5.6-.7 8.6 1.2 3-1.9 5.6-2.1 8.6-1.2v13.8c-3-.9-5.6-.7-8.6 1.2-3-1.9-5.6-2.1-8.6-1.2z"/><path d="M12 6.6v13.8" opacity=".8"/><path d="M5 8.5h4.5M5 11h4M5 13.5h4.5M14.5 8.5h4M14.5 11h4.5M14.5 13.5h4" opacity=".5"/>',
  glass:
    '<path d="M6.6 3.4h10.8l-1 12.4c-.2 1.8-1.4 3-3.4 3h-2c-2 0-3.2-1.2-3.4-3z"/><path d="M7 8.5h10" opacity=".7"/><path d="M9 11.5c1 .6 2 .8 3 .4" opacity=".5"/>',
  flower:
    '<circle cx="12" cy="9" r="2.4"/><circle cx="12" cy="9" r=".8" fill="currentColor" stroke="none"/><path d="M12 6.6c-.6-2.6-3-3.2-4.2-1.7-.6.8 0 1.8 1 2 .9.2 2 0 3.2-.3z"/><path d="M12 6.6c.6-2.6 3-3.2 4.2-1.7.6.8 0 1.8-1 2-.9.2-2 0-3.2-.3z"/><path d="M14 10.4c2.4 0 3.4 1.8 2.6 3.4-.5 1-1.6.9-2.2.2-.6-.7-.8-2-.4-3.6z"/><path d="M10 10.4c-2.4 0-3.4 1.8-2.6 3.4.5 1 1.6.9 2.2.2.6-.7.8-2 .4-3.6z"/><path d="M12 11.4c-.2 3.2-.8 6.4-1.6 9.2" opacity=".9"/>',
  compass:
    '<circle cx="12" cy="12" r="9.4"/><circle cx="12" cy="12" r="7" opacity=".5"/><path d="M12 3.4v1.6M12 19v1.6M3.4 12h1.6M19 12h1.6" opacity=".8"/><path d="M12 5.5l1.9 6.5L12 14l-1.9-2 1.9-6.5z" fill="currentColor" stroke="none" opacity=".9"/><path d="M12 14l-1.9 6.5L12 18.5l1.9 2-1.9-6.5z" fill="currentColor" stroke="none" opacity=".4"/><circle cx="12" cy="12" r=".6" fill="#050d15" stroke="none"/>',
  grid:
    '<rect x="3.4" y="3.4" width="17.2" height="17.2" rx=".4"/><path d="M3.4 8h17.2M3.4 12h17.2M3.4 16h17.2M8 3.4v17.2M12 3.4v17.2M16 3.4v17.2" opacity=".55"/>',
  notebook:
    '<path d="M5 3.4h12.6c.7 0 1 .3 1 1v15.2c0 .7-.3 1-1 1H5z"/><path d="M5 3.4v17.2" stroke-width="1.6"/><path d="M3.2 5h2.4M3.2 8h2.4M3.2 11h2.4M3.2 14h2.4M3.2 17h2.4M3.2 20h2.4"/><path d="M8 7h8M8 10h8M8 13h6M8 16h7" opacity=".5"/>',
  window:
    '<rect x="3.4" y="3.4" width="17.2" height="17.2"/><path d="M3.4 12h17.2M12 3.4v17.2" opacity=".8"/><path d="M7 7q5 4 10 0M7 16q5-4 10 0" opacity=".35"/><path d="M5 5l2 2M19 5l-2 2M5 19l2-2M19 19l-2-2" opacity=".45"/>',
  map:
    '<path d="M3 6.4l5-2 5 2 5-2 3 1.4v13.4l-3-1.4-5 2-5-2-5 2z"/><path d="M8 4.4v15M13 6.4v15M18 4.4v15.4" opacity=".55"/><circle cx="13" cy="11" r=".9" fill="currentColor" stroke="none"/><path d="M9.5 8q2 2 5 0q2-2 5 0" opacity=".35"/>',
};

export const PRESET_KEYS = Object.keys(PRESETS);
