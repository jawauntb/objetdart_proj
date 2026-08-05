/**
 * /city — the causal laws of a small settlement.
 *
 * A city is not a picture of buildings; it is a **cycle of care**. People
 * carry a need — rest, food, gather — and the plots exist to answer needs.
 * A home answers rest. A store answers food. An event answers gathering. A
 * tree answers weather. Their **identities are their causal roles**: what
 * they do is what they are, and every gesture in the room is chosen to make
 * that concrete.
 *
 * Everything here is pure and deterministic — a plot's role is a function of
 * how long it was held, a person's next step is a function of their need and
 * the plots' positions. `<City>` reads these functions each frame; the tests
 * pin them independently of any rendering.
 */

// ——— roles ————————————————————————————————————————————————————————————————

/**
 * A plot's causal role. Ordered by "civic weight" — how much of the city's
 * flow of care the plot answers. A dwell walks the plot up this ladder.
 */
export type PlotRole = "empty" | "home" | "store" | "event" | "tree";

/** The person's current need. What they walk toward. */
export type Need = "rest" | "food" | "gather";

/** Which lens the map is being read through. */
export type CityLens = "map" | "hydrology" | "satisfaction";

/** The season. Affects flora, weather, and the day's rhythm. */
export type Season = "spring" | "summer" | "fall" | "winter";

// ——— dwell → role ladder ——————————————————————————————————————————————————

/**
 * How long a plot must be held (ms) to advance to each civic role. These are
 * per-role thresholds, and they compound — a home appears first, then
 * densifies into a store, then hosts an event, then quiets to a tree.
 *
 * Kept in one place so the visual dwell ring and the test read the same
 * numbers. `PLOT_DWELL_MS.home = 0` means "a plot is a home the instant it
 * is planted"; the visitor doesn't need a hold to make anything.
 */
export const PLOT_DWELL_MS: Record<Exclude<PlotRole, "empty">, number> = {
  home: 0,
  store: 900,
  event: 2100,
  tree: 3800,
};

/**
 * Given how long the finger has been down, return the plot's current role.
 * Continuous — a longer hold always yields at least the shorter hold's role;
 * a plot never regresses on its own.
 */
export function roleForDwell(dwellMs: number): PlotRole {
  if (dwellMs < PLOT_DWELL_MS.home) return "empty";
  if (dwellMs < PLOT_DWELL_MS.store) return "home";
  if (dwellMs < PLOT_DWELL_MS.event) return "store";
  if (dwellMs < PLOT_DWELL_MS.tree) return "event";
  return "tree";
}

/**
 * Which need does this plot's role answer? A plot's answer is its identity:
 * a home means rest, a store means food, an event means gather, a tree
 * means nothing to a person but everything to the weather. Empty plots
 * answer nothing yet.
 */
export function needAnsweredBy(role: PlotRole): Need | null {
  switch (role) {
    case "home": return "rest";
    case "store": return "food";
    case "event": return "gather";
    default: return null;
  }
}

// ——— time and rhythm ———————————————————————————————————————————————————————

/**
 * The city keeps its own day. `cityTimeMs` runs on the shell's clock; the
 * day-fraction is what determines dawn, noon, dusk, and night. A quarter of
 * a day is roughly two of the site's 7s breaths — long enough that the
 * cycle is felt, short enough that the visitor sees it happen while playing.
 */
export const CITY_DAY_MS = 28_000;

/** 0..1 where 0 is dawn, 0.25 noon, 0.5 dusk, 0.75 midnight. */
export function dayFraction(cityTimeMs: number): number {
  return ((cityTimeMs % CITY_DAY_MS) + CITY_DAY_MS) % CITY_DAY_MS / CITY_DAY_MS;
}

/** True during the working half of the day (between dawn and dusk). */
export function isDaytime(cityTimeMs: number): boolean {
  const f = dayFraction(cityTimeMs);
  return f < 0.5;
}

// ——— person need cycle ————————————————————————————————————————————————————

/**
 * The person picks their next need from the day and their current mood.
 * The rule is causal: a person seeks rest at night, food when hungry, and
 * gathers when the day is full. A person with an unmet need is a person
 * walking somewhere.
 */
export function needFor(cityTimeMs: number, fed: number, rested: number): Need {
  // Night: rest wins over everything, unless the person is already deeply rested.
  if (!isDaytime(cityTimeMs) && rested < 0.9) return "rest";
  // Hungry beats social.
  if (fed < 0.35) return "food";
  // Fed and rested during the day — the day is for gathering.
  if (isDaytime(cityTimeMs) && fed > 0.5 && rested > 0.5) return "gather";
  return "rest";
}

// ——— movement — pure, no rendering ————————————————————————————————————————

export type PlotSample = {
  id: number;
  role: PlotRole;
  x: number; // normalized 0..1
  y: number; // normalized 0..1
};

export type PersonSample = {
  id: number;
  x: number;
  y: number;
  homeId: number;
  need: Need;
  fed: number;   // 0..1
  rested: number; // 0..1
};

/**
 * Find the plot that best answers this need — nearest matching role, or the
 * person's home for rest. Returns `null` if the city has no such plot yet
 * (a hungry person in a city with no stores waits, they don't wander).
 */
export function targetForNeed(
  person: Pick<PersonSample, "x" | "y" | "homeId">,
  need: Need,
  plots: readonly PlotSample[],
): PlotSample | null {
  if (need === "rest") {
    return plots.find((p) => p.id === person.homeId) ?? null;
  }
  const wanted = need === "food" ? "store" : "event";
  let best: PlotSample | null = null;
  let bestDist = Infinity;
  for (const plot of plots) {
    if (plot.role !== wanted) continue;
    const dx = plot.x - person.x;
    const dy = plot.y - person.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDist) {
      bestDist = d2;
      best = plot;
    }
  }
  return best;
}

/**
 * Move a person one tick toward their target. Speed is normalized units per
 * ms — a person crosses the whole city in ~20 seconds at rest, faster along
 * a used road (a caller applies the road multiplier before passing dt in).
 *
 * Returns the person's new (x, y). Never overshoots the target: on arrival
 * the returned position is exactly the target's.
 */
export const PERSON_SPEED_NORM_PER_MS = 0.05 / 1_000; // 5% per second

export function stepTowards(
  person: Pick<PersonSample, "x" | "y">,
  target: { x: number; y: number },
  dtMs: number,
  speedNormPerMs = PERSON_SPEED_NORM_PER_MS,
): { x: number; y: number } {
  const dx = target.x - person.x;
  const dy = target.y - person.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1e-6) return { x: target.x, y: target.y };
  const step = Math.min(dist, speedNormPerMs * dtMs);
  const nx = person.x + (dx / dist) * step;
  const ny = person.y + (dy / dist) * step;
  return { x: nx, y: ny };
}

// ——— dawn spawn ——————————————————————————————————————————————————————————

/**
 * Each home spawns residents at dawn — a deterministic count per home,
 * derived from the home's seed so the same city grows the same population
 * every visit. `dwellersPerHome` is the causal statement: a home means
 * people, and the number of people it means is a small function of the
 * home itself.
 */
export function dwellersPerHome(homeSeed: number): number {
  // 1..3 residents. Mulberry-style hash — deterministic, no Math.random.
  const h = mulberry(homeSeed);
  return 1 + Math.floor(h() * 3);
}

/**
 * A tiny deterministic RNG (mulberry32). Exposed so tests and callers can
 * reproduce identical people from a home's seed without importing the full
 * scene module.
 */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// ——— season ————————————————————————————————————————————————————————————

export const SEASON_ORDER: readonly Season[] = ["spring", "summer", "fall", "winter"];

/** Cycle the season one detent — the 3-finger twist verb. */
export function nextSeason(current: Season, direction: 1 | -1): Season {
  const idx = SEASON_ORDER.indexOf(current);
  const next = (idx + direction + SEASON_ORDER.length) % SEASON_ORDER.length;
  return SEASON_ORDER[next];
}

/**
 * A tree's health as a function of season. Trees are the flora that answer
 * weather — dense in summer, bare in winter, budding in spring. Ranges 0..1.
 */
export function treeFoliage(season: Season): number {
  switch (season) {
    case "spring": return 0.75;
    case "summer": return 1.0;
    case "fall":   return 0.55;
    case "winter": return 0.15;
  }
}
