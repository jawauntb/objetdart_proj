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

// ——— regulars — identity densifies from role into small community ————————
//
// A store answers food, but a store that a person visits often answers *their*
// food — the plot's identity is the causal history of who kept coming back.
// After `REGULAR_VISITS_TO_BECOME_REGULAR` returns, a person is a regular at
// that plot, and the plot's pull on that person grows by `REGULAR_PULL_FACTOR`
// (a farther regular store is chosen over a nearer stranger's, up to but not
// past the factor). The map does not need to store anything about the plots
// — the community lives on the people, and a plot's regulars are counted by
// how many people carry the plot as their regular slot.

/** How many arrivals at the same plot before a person is a regular there. */
export const REGULAR_VISITS_TO_BECOME_REGULAR = 3;

/**
 * Effective-distance shrink factor for a person's own regular plot. A regular
 * store 1.5× farther than a stranger's is still preferred; a regular store
 * 2× farther is not. The value is deliberately modest: regulars deepen the
 * city, they do not distort geography.
 */
export const REGULAR_PULL_FACTOR = 1.6;

/**
 * A per-need visit ledger for one person. `plotId` is the plot they last
 * arrived at for this need; `visits` is how many times in a row they arrived
 * at *that same* plot. A different plot resets to 1 — a regular is a habit,
 * not a lifetime count.
 */
export type VisitRecord = {
  plotId: number;
  visits: number;
};

/**
 * Called once when a person arrives at a plot answering some need. Returns
 * the new record. Same plot as last time → count deepens; different plot →
 * the habit resets and the ledger begins again with `visits: 1`.
 */
export function recordVisit(current: VisitRecord | null, plotId: number): VisitRecord {
  if (!current || current.plotId !== plotId) return { plotId, visits: 1 };
  return { plotId, visits: current.visits + 1 };
}

/** True when this record's visit count has crossed the regular threshold. */
export function isRegularOf(record: VisitRecord | null, plotId: number): boolean {
  if (!record) return false;
  return record.plotId === plotId && record.visits >= REGULAR_VISITS_TO_BECOME_REGULAR;
}

/**
 * Effective squared distance under the regular-pull rule. A plot the person
 * is a regular at reads as closer than it is; every other plot reads as
 * itself. Working in squared distances lets callers keep a hot inner loop
 * with no `sqrt`.
 */
export function effectiveDistanceSq(d2: number, regular: boolean): number {
  return regular ? d2 / (REGULAR_PULL_FACTOR * REGULAR_PULL_FACTOR) : d2;
}

/**
 * Like `targetForNeed`, but honors a person's regular slot. The signature
 * takes the plot id (or `null`) rather than the full record so the caller can
 * decide per-need which regular to consult — the store one for food, the
 * event one for gathering. Rest still routes to the person's home, unchanged.
 */
export function targetForNeedWithRegular(
  person: Pick<PersonSample, "x" | "y" | "homeId">,
  need: Need,
  plots: readonly PlotSample[],
  regularPlotId: number | null,
): PlotSample | null {
  if (need === "rest") {
    return plots.find((p) => p.id === person.homeId) ?? null;
  }
  const wanted = need === "food" ? "store" : "event";
  let best: PlotSample | null = null;
  let bestEff = Infinity;
  for (const plot of plots) {
    if (plot.role !== wanted) continue;
    const dx = plot.x - person.x;
    const dy = plot.y - person.y;
    const d2 = dx * dx + dy * dy;
    const eff = effectiveDistanceSq(d2, plot.id === regularPlotId);
    if (eff < bestEff) {
      bestEff = eff;
      best = plot;
    }
  }
  return best;
}

// ——— arrival — a phased arc, edge → home → belonging or leaving ——————————
//
// A newly-spawned dweller does not blink into existence at their front door;
// they walk in from the nearest edge of the map. The arrival phase is short
// (a single trip home) but visible — the whole point of density-as-engine is
// that arrivals *manufacture* the possibility of the next encounter. Once
// they reach home the first time, they are "settled" and the ordinary need
// cycle takes over.
//
// Density-as-engine is not one-way. A settlement that only gains people is
// not a settlement — it is a bag. A dweller whose needs stay unmet long
// enough enters a **leaving** phase: their target is the nearest map edge,
// and on arrival they are retired from the population. The arc reads as
// arrival → consolidation → belonging OR leaving, and the tradeoff of
// density becomes visible: proximity manufactures possibility, and the
// absence of proximity retires a person from the field.

/**
 * Person phase — a small state machine.
 *
 *   arriving → the first walk in from the map edge to home. Cannot yet
 *              gather, cannot leave.
 *   settled  → the ordinary need cycle. Rest, food, gather; regulars form;
 *              hesitation slows the step when the tradeoff is real.
 *   leaving  → both needs sustained below LEAVING_NEED_THRESHOLD for
 *              LEAVING_UNMET_MS. Target is the nearest map edge, not a
 *              plot; on arrival the caller retires the person.
 */
export type PersonPhase = "arriving" | "settled" | "leaving";

// ——— leaving — the tradeoff density buys must be able to lose someone ——
//
// The brief's arc is arrival → consolidation → belonging OR leaving, and
// PersonPhase was one-way until now. A dweller whose `fed` AND `rested` stay
// below LEAVING_NEED_THRESHOLD for LEAVING_UNMET_MS has been trying and
// failing to answer their needs — the plots they need do not exist, or lie
// too far. Density manufactures possibility; the absence of density manuf-
// actures loss. The threshold is strict-less-than so a person at exactly
// 0.25 (barely fed, barely rested) is not yet leaving — leaving requires
// real deprivation, not the ordinary trough of the day.

/** Below this on BOTH fed and rested, the counter for leaving accrues. */
export const LEAVING_NEED_THRESHOLD = 0.25;

/**
 * How long both needs must remain below the threshold before the transition
 * fires. About one-quarter of a city day — a visible stretch of the visitor
 * watching the person try, not an instantaneous flip. Kept here so the test
 * and the renderer read the same constant.
 */
export const LEAVING_UNMET_MS = 8_000;

/**
 * True when both needs are below the leaving threshold. The caller ticks a
 * counter while this holds and resets it the moment it doesn't — a person
 * who eats resets the timer, a person who rests resets the timer, only a
 * person who cannot answer either need for a sustained stretch leaves.
 */
export function needsUnmet(fed: number, rested: number): boolean {
  return fed < LEAVING_NEED_THRESHOLD && rested < LEAVING_NEED_THRESHOLD;
}

/**
 * True when a person's sustained-unmet counter has crossed the leaving
 * threshold. The caller separately tracks `unmetMs` — this predicate is
 * the causal statement of when a transition fires.
 */
export function shouldLeave(fed: number, rested: number, unmetMs: number): boolean {
  if (!needsUnmet(fed, rested)) return false;
  return unmetMs >= LEAVING_UNMET_MS;
}

/**
 * How long the leaving fade takes, in ms. The overlay's opacity for a
 * leaving person eases from 1 to 0 over this window as they walk to the
 * edge; retirement happens on arrival at the edge, whichever comes first.
 * A leaving person is honest — they do not vanish mid-street.
 */
export const LEAVING_FADE_MS = 1_400;

/**
 * Fade opacity for a leaving person, given how long since the transition.
 * Clamped to [0, 1]. Callers pass the ms since `phase` became "leaving";
 * the renderer multiplies the person's alpha by this. A person retired at
 * the edge before the fade completes is retired at whatever alpha they had.
 */
export function fadeForLeaving(msSinceLeaving: number): number {
  if (msSinceLeaving <= 0) return 1;
  if (msSinceLeaving >= LEAVING_FADE_MS) return 0;
  return 1 - msSinceLeaving / LEAVING_FADE_MS;
}

export type Vec2 = { x: number; y: number };

/**
 * The nearest map-edge point to `target` in the unit square. Used to spawn
 * new dwellers: they enter from the closest edge and walk toward their home.
 * The rule is deliberately geometric — no randomness, no rolls — so a home
 * on the north end always births people who arrive from the north.
 */
export function nearestEdgePoint(target: Vec2): Vec2 {
  const dLeft = target.x;
  const dRight = 1 - target.x;
  const dTop = target.y;
  const dBot = 1 - target.y;
  const min = Math.min(dLeft, dRight, dTop, dBot);
  if (min === dLeft) return { x: 0, y: target.y };
  if (min === dRight) return { x: 1, y: target.y };
  if (min === dTop) return { x: target.x, y: 0 };
  return { x: target.x, y: 1 };
}

// ——— heading — the person faces where they are going ————————————————————
//
// v1 people were 2.4px black dots. Dots point nowhere. A heading gives every
// person a facing angle, and the renderer draws them as tiny slivers along
// that angle so a street of walkers reads as a street of directed walkers.
// The heading lags one frame — it is a function of the previous position and
// the new one — and falls back to whatever the last angle was when the step
// is too small to measure a direction.

export function headingFor(prev: Vec2, cur: Vec2, fallback: number): number {
  const dx = cur.x - prev.x;
  const dy = cur.y - prev.y;
  if (dx * dx + dy * dy < 1e-10) return fallback;
  return Math.atan2(dy, dx);
}

// ——— pose — a store IS what its regulars do at it ————————————————————————
//
// A store answering food is a plot with people STANDING at it, not a plot
// with slivers on top of it. v2's regulars ring told you a plot was a
// community, but every person at the plot was still drawn as a heading-
// aligned sliver — the pose the eye reads as "walking". A colony of
// regulars at a plot has to read as a colony of *stationary bodies*, or
// the invariant "identity by causal role" fails at the exact spot where
// role densifies into community.
//
// The predicate is pure: given how long the person has been still
// (`stillMs`, accumulated by the caller from stepTowards' returned delta),
// return whether the pose has flipped from walking to standing. Kept in
// this file so the visual predicate is single-sourced and testable, in the
// same discipline as `roleForDwell` (the dwell → role ladder both the
// finger and the keyboard climb through this one function).

/**
 * How long a person must have made no measurable step before their pose
 * reads as standing rather than walking. 200ms is a beat below a slow
 * gait cycle — long enough that a person parked at a store IS visibly
 * still, short enough that arrival flips them from walker to stander in
 * the same second the eye reads their body.
 *
 * Strict-greater: at exactly 200ms the person is still walking. Standing
 * is a decision the visitor has watched happen, not an instantaneous
 * predicate on a single frame.
 */
export const STANDING_STILL_MS = 200;

/**
 * True when the person has been stationary long enough to read as
 * standing. The caller accumulates `stillMs` frame-by-frame while
 * stepTowards' returned delta is near zero, and resets it the frame the
 * person moves. A negative or zero counter is walking — a person who has
 * not yet had a chance to be still is not standing. The threshold's
 * strict inequality matches the follow-up brief exactly: "when delta ≈ 0
 * for > 200ms, draw a small vertical body".
 */
export function isStanding(stillMs: number): boolean {
  return stillMs > STANDING_STILL_MS;
}

// ——— hesitation — two needs, two plots, one slower step ——————————————————
//
// Density manufactures tradeoffs. If a person's need can be answered by two
// plots at nearly the same distance, they hesitate: their next step is slower
// and their route is unstable — one visit they aim at A, the next at B. The
// visible slowdown is what the eye reads as choice. The ratio threshold
// (`HESITATION_RATIO_THRESHOLD`) is measured in linear distance, not squared,
// because "nearly the same distance" is a linear concept.

export const HESITATION_RATIO_THRESHOLD = 1.2;
export const HESITATION_SPEED_FACTOR = 0.45;

/**
 * When a person's current need has more than one plot able to answer it and
 * the two nearest are within `HESITATION_RATIO_THRESHOLD` of each other,
 * return `{ hesitating: true, secondBestId }` — the caller can slow the
 * person's step, swap the target to the alternate, or both. Rest never
 * hesitates: home is unique.
 */
export function hesitationBetween(
  person: Pick<PersonSample, "x" | "y">,
  need: Need,
  plots: readonly PlotSample[],
): { hesitating: boolean; secondBestId: number | null } {
  const wanted = need === "food" ? "store" : need === "gather" ? "event" : null;
  if (!wanted) return { hesitating: false, secondBestId: null };
  let d1 = Infinity;
  let d2 = Infinity;
  let id1: number | null = null;
  let id2: number | null = null;
  for (const p of plots) {
    if (p.role !== wanted) continue;
    const dd = (p.x - person.x) ** 2 + (p.y - person.y) ** 2;
    if (dd < d1) {
      d2 = d1;
      id2 = id1;
      d1 = dd;
      id1 = p.id;
    } else if (dd < d2) {
      d2 = dd;
      id2 = p.id;
    }
  }
  if (!Number.isFinite(d2) || d1 <= 0) return { hesitating: false, secondBestId: null };
  const ratio = Math.sqrt(d2 / d1); // linear ratio of distances
  return { hesitating: ratio < HESITATION_RATIO_THRESHOLD, secondBestId: id2 };
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
