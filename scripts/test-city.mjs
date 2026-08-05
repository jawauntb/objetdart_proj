import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import vm from "node:vm";

// Compile src/lib/city.ts in-process — same pattern test-atlas.mjs uses.
const rootUrl = new URL("../", import.meta.url);
const source = readFileSync(fileURLToPath(new URL("src/lib/city.ts", rootUrl)), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
  fileName: "src/lib/city.ts",
}).outputText;
const mod = { exports: {} };
vm.runInNewContext(code, { module: mod, exports: mod.exports, require: () => ({}), Math, Object }, { filename: "src/lib/city.ts" });
const {
  roleForDwell,
  needAnsweredBy,
  needFor,
  targetForNeed,
  targetForNeedWithRegular,
  stepTowards,
  dwellersPerHome,
  nextSeason,
  treeFoliage,
  dayFraction,
  isDaytime,
  recordVisit,
  isRegularOf,
  effectiveDistanceSq,
  nearestEdgePoint,
  headingFor,
  hesitationBetween,
  PLOT_DWELL_MS,
  CITY_DAY_MS,
  SEASON_ORDER,
  REGULAR_VISITS_TO_BECOME_REGULAR,
  REGULAR_PULL_FACTOR,
  HESITATION_RATIO_THRESHOLD,
  HESITATION_SPEED_FACTOR,
} = mod.exports;

// ——— the plot role ladder is a causal, monotone function of dwell —————————

assert.equal(roleForDwell(0), "home", "planting is instant — the moment a plot exists, it is a home");
assert.equal(roleForDwell(PLOT_DWELL_MS.store - 1), "home", "just under the store threshold is still a home");
assert.equal(roleForDwell(PLOT_DWELL_MS.store), "store", "reaching the store threshold densifies the home into a store");
assert.equal(roleForDwell(PLOT_DWELL_MS.event), "event", "an event appears when the hold is sustained past the store");
assert.equal(roleForDwell(PLOT_DWELL_MS.tree), "tree", "an even longer hold quiets the plot to a tree");
assert.equal(roleForDwell(60_000), "tree", "the ladder terminates at tree — a plot never advances beyond a park");

// The ladder is monotone: never a step down.
const dwells = [0, 500, PLOT_DWELL_MS.store, 1500, PLOT_DWELL_MS.event, 2500, PLOT_DWELL_MS.tree, 5000];
const seen = new Set(dwells.map(roleForDwell));
assert.ok(seen.has("home") && seen.has("store") && seen.has("event") && seen.has("tree"), "every role appears somewhere on the ladder");

// ——— identity by causal role ——————————————————————————————————————————————

assert.equal(needAnsweredBy("home"), "rest", "a home's identity is rest");
assert.equal(needAnsweredBy("store"), "food", "a store's identity is food");
assert.equal(needAnsweredBy("event"), "gather", "an event's identity is gathering");
assert.equal(needAnsweredBy("tree"), null, "a tree does not answer a person's need directly — its work is on the weather");
assert.equal(needAnsweredBy("empty"), null, "an empty plot has no identity yet");

// ——— the day drives the need cycle ———————————————————————————————————————

assert.ok(isDaytime(0), "the day starts at dawn");
assert.ok(isDaytime(CITY_DAY_MS * 0.25), "noon is daytime");
assert.ok(!isDaytime(CITY_DAY_MS * 0.6), "past dusk is night");
assert.ok(!isDaytime(CITY_DAY_MS * 0.9), "midnight is night");

// A tired person at night seeks rest — no ambiguity.
assert.equal(needFor(CITY_DAY_MS * 0.75, 0.9, 0.2), "rest", "night + unrested → rest");
// A hungry person seeks food regardless of day.
assert.equal(needFor(CITY_DAY_MS * 0.25, 0.1, 0.9), "food", "daylight + hungry → food");
// A fed, rested person during the day → gathers.
assert.equal(needFor(CITY_DAY_MS * 0.3, 0.8, 0.8), "gather", "daylight + fed + rested → gather");

// ——— target selection is nearest, and honors identity —————————————————————

const plots = [
  { id: 1, role: "home", x: 0.5, y: 0.5 },
  { id: 2, role: "store", x: 0.1, y: 0.5 },
  { id: 3, role: "store", x: 0.9, y: 0.5 },
  { id: 4, role: "event", x: 0.5, y: 0.9 },
];
const person = { x: 0.2, y: 0.5, homeId: 1 };

assert.equal(targetForNeed(person, "rest", plots).id, 1, "rest routes to the person's own home");
assert.equal(targetForNeed(person, "food", plots).id, 2, "food picks the nearer store");
assert.equal(targetForNeed(person, "gather", plots).id, 4, "gathering picks the event");

// Empty cities don't cause wandering — a person with no target simply stays.
assert.equal(targetForNeed(person, "food", [{ id: 1, role: "home", x: 0.5, y: 0.5 }]), null, "no store → no target (the person waits)");

// ——— movement is monotone and never overshoots ————————————————————————————

const start = { x: 0.0, y: 0.0 };
const goal = { x: 1.0, y: 0.0 };
const oneSec = stepTowards(start, goal, 1000);
assert.ok(oneSec.x > 0 && oneSec.x < 1, "one second of walking makes progress but does not arrive");
assert.equal(oneSec.y, 0, "walking along x does not drift y");

// A very long tick lands exactly on the target — the person does not skip past.
const arrived = stepTowards(start, goal, 10_000_000);
assert.equal(arrived.x, 1.0, "an oversize step lands on the target, not past it");
assert.equal(arrived.y, 0, "arrival does not perturb the other axis");

// ——— homes spawn a deterministic, small population ————————————————————————

const a = dwellersPerHome(0xC17A);
const b = dwellersPerHome(0xC17A);
assert.equal(a, b, "the same seed always spawns the same headcount");
assert.ok(a >= 1 && a <= 3, "a home holds one to three residents");
const c = dwellersPerHome(0xB100);
assert.ok(typeof c === "number" && c >= 1 && c <= 3, "any seed lands in the [1, 3] population range");

// ——— season is a cycle in both directions —————————————————————————————————

assert.deepEqual(SEASON_ORDER, ["spring", "summer", "fall", "winter"], "the four seasons run in order");
assert.equal(nextSeason("spring", 1), "summer", "twist forward → next season");
assert.equal(nextSeason("winter", 1), "spring", "twist wraps at year's end");
assert.equal(nextSeason("spring", -1), "winter", "twist backward wraps too");

// Flora is monotone across the growth half of the year.
assert.ok(treeFoliage("winter") < treeFoliage("spring"), "trees leaf out from winter into spring");
assert.ok(treeFoliage("spring") < treeFoliage("summer"), "summer is the fullest canopy");
assert.ok(treeFoliage("fall") < treeFoliage("summer"), "fall is thinner than summer");
assert.ok(treeFoliage("fall") > treeFoliage("winter"), "fall is not yet winter");

// ——— dayFraction is a canonical unit-circle time axis ——————————————————————

assert.equal(dayFraction(0), 0, "the day begins at 0");
assert.ok(Math.abs(dayFraction(CITY_DAY_MS) - 0) < 1e-9, "one full day returns to 0");
assert.ok(Math.abs(dayFraction(CITY_DAY_MS * 1.25) - 0.25) < 1e-9, "the second morning has the same fraction as the first");

// ——— regulars: identity densifies from role into small community —————————

// A visit to the same plot as last time deepens the count; a different plot resets it.
let record = null;
for (let i = 0; i < REGULAR_VISITS_TO_BECOME_REGULAR; i += 1) {
  record = recordVisit(record, 7);
}
assert.equal(record.plotId, 7, "the record remembers which plot the person kept returning to");
assert.equal(record.visits, REGULAR_VISITS_TO_BECOME_REGULAR, "each return to the same plot adds one visit");
assert.equal(isRegularOf(record, 7), true, "reaching the threshold makes the person a regular there");
assert.equal(isRegularOf(record, 8), false, "a regular at 7 is not a regular at every plot");

// Going somewhere new resets the ledger — a regular is a habit, not a lifetime count.
const reset = recordVisit(record, 12);
assert.equal(reset.plotId, 12, "visiting a new plot rewrites the ledger");
assert.equal(reset.visits, 1, "the new plot's habit begins at one");
assert.equal(isRegularOf(reset, 12), false, "one visit is not yet a habit");
assert.equal(isRegularOf(null, 7), false, "no ledger → no belonging");

// One-under-threshold is not yet a regular.
let almost = null;
for (let i = 0; i < REGULAR_VISITS_TO_BECOME_REGULAR - 1; i += 1) {
  almost = recordVisit(almost, 3);
}
assert.equal(isRegularOf(almost, 3), false, "one visit short of the threshold is not yet a regular");

// Effective distance: the regular's plot reads as closer than it is.
const dReg = effectiveDistanceSq(4, true);
const dStranger = effectiveDistanceSq(4, false);
assert.ok(dReg < dStranger, "a regular's plot reads as closer than a stranger's plot at the same distance");
assert.equal(dStranger, 4, "a stranger's plot reads as its own distance");
// The shrink is exactly the pull factor squared.
assert.ok(Math.abs(dReg * (REGULAR_PULL_FACTOR ** 2) - dStranger) < 1e-9, "the effective distance shrinks by exactly PULL_FACTOR²");

// A regular is pulled to a farther store — up to but not past the pull factor.
const stores = [
  { id: 10, role: "store", x: 0.4,  y: 0.5 }, // 0.1 away from person
  { id: 20, role: "store", x: 0.65, y: 0.5 }, // 0.15 away — 1.5× farther, inside REGULAR_PULL_FACTOR of 1.6
];
const walker = { x: 0.5, y: 0.5, homeId: 1 };
assert.equal(targetForNeedWithRegular(walker, "food", stores, null).id, 10, "no regular → the near store wins");
assert.equal(targetForNeedWithRegular(walker, "food", stores, 20).id, 20, "regular at the farther store → they walk past the near one");
// If the regular plot is much too far, geography wins after all.
const stretched = [
  { id: 10, role: "store", x: 0.55, y: 0.5 }, // 0.05 away
  { id: 20, role: "store", x: 0.9,  y: 0.5 }, // 0.4 away — 8x farther, well past REGULAR_PULL_FACTOR
];
assert.equal(
  targetForNeedWithRegular(walker, "food", stretched, 20).id, 10,
  "a regular pull only shrinks distance by PULL_FACTOR — a store many times farther still loses",
);
// Rest is unchanged: home wins regardless of regulars.
const homePlot = { id: 1, role: "home", x: 0.1, y: 0.1 };
assert.equal(
  targetForNeedWithRegular(walker, "rest", [homePlot, ...stores], 20).id, 1,
  "rest routes to the person's own home even if they are a regular somewhere else",
);

// ——— arrival: newly-spawned dwellers walk in from the nearest edge ————————

assert.deepEqual(nearestEdgePoint({ x: 0.1, y: 0.5 }), { x: 0, y: 0.5 }, "a home near the west wall births arrivals from the west");
assert.deepEqual(nearestEdgePoint({ x: 0.9, y: 0.5 }), { x: 1, y: 0.5 }, "a home near the east wall births arrivals from the east");
assert.deepEqual(nearestEdgePoint({ x: 0.5, y: 0.1 }), { x: 0.5, y: 0 }, "a home near the north wall births arrivals from the north");
assert.deepEqual(nearestEdgePoint({ x: 0.5, y: 0.9 }), { x: 0.5, y: 1 }, "a home near the south wall births arrivals from the south");
// A spawn on an edge really is on an edge — one axis is always at 0 or 1.
const edgeSpawn = nearestEdgePoint({ x: 0.33, y: 0.72 });
const onEdge = edgeSpawn.x === 0 || edgeSpawn.x === 1 || edgeSpawn.y === 0 || edgeSpawn.y === 1;
assert.ok(onEdge, "the spawn point sits on an edge, whichever is nearest");

// ——— heading: the person faces where they are going ——————————————————————

// Cardinal directions.
assert.ok(Math.abs(headingFor({ x: 0, y: 0 }, { x: 1, y: 0 }, 0) - 0) < 1e-9, "walking east reads as heading 0");
assert.ok(Math.abs(headingFor({ x: 0, y: 0 }, { x: 0, y: 1 }, 0) - Math.PI / 2) < 1e-9, "walking south reads as heading π/2");
assert.ok(Math.abs(headingFor({ x: 0, y: 0 }, { x: -1, y: 0 }, 0) - Math.PI) < 1e-9, "walking west reads as heading π");
// A step too small to measure returns the fallback, not zero — a person standing still keeps their face.
assert.equal(headingFor({ x: 0.3, y: 0.4 }, { x: 0.3, y: 0.4 }, 1.234), 1.234, "no motion → the previous heading is preserved");
// Diagonal.
const diag = headingFor({ x: 0, y: 0 }, { x: 1, y: 1 }, 0);
assert.ok(Math.abs(diag - Math.PI / 4) < 1e-9, "walking southeast reads as heading π/4");

// ——— hesitation: two plots of the same role, close in distance ———————————

const twinStores = [
  { id: 30, role: "store", x: 0.4, y: 0.5 }, // 0.1 west of walker
  { id: 31, role: "store", x: 0.6, y: 0.5 }, // 0.1 east of walker
  { id: 32, role: "home",  x: 0.5, y: 0.5 }, // same-role check
];
const twinResult = hesitationBetween({ x: 0.5, y: 0.5 }, "food", twinStores);
assert.equal(twinResult.hesitating, true, "two stores at the same distance produce hesitation");
assert.ok(twinResult.secondBestId === 30 || twinResult.secondBestId === 31, "the alternate is one of the two candidates");

const soloStores = [
  { id: 40, role: "store", x: 0.5, y: 0.5 }, // right on top
  { id: 41, role: "store", x: 0.99, y: 0.99 }, // very far
];
const soloResult = hesitationBetween({ x: 0.5, y: 0.5 }, "food", soloStores);
assert.equal(soloResult.hesitating, false, "one store far, one close → no hesitation");

// Rest is unique — a home is the home, no competing option.
assert.equal(
  hesitationBetween({ x: 0.5, y: 0.5 }, "rest", twinStores).hesitating,
  false,
  "rest is unique to the person's own home — no hesitation available",
);

// Only one candidate → nothing to hesitate between.
assert.equal(
  hesitationBetween({ x: 0.5, y: 0.5 }, "food", [twinStores[0]]).hesitating,
  false,
  "a single-store city offers no tradeoff, and so no hesitation",
);

// The hesitation speed factor is a real slowdown, not a decoration.
assert.ok(HESITATION_SPEED_FACTOR < 1, "a hesitating step is slower than a decided step");
assert.ok(HESITATION_SPEED_FACTOR > 0, "a hesitating person still moves");
assert.ok(HESITATION_RATIO_THRESHOLD > 1, "hesitation is triggered by nearly-equal distances, not by identical ones alone");

console.log(
  `city ok: role ladder monotone, needs answered by identity, ${SEASON_ORDER.length} seasons cycle both ways, ` +
  `movement never overshoots, homes seed 1..3 residents deterministically, ` +
  `regulars densify identity at ${REGULAR_VISITS_TO_BECOME_REGULAR} visits with a ${REGULAR_PULL_FACTOR}× pull, ` +
  `arrivals enter from the nearest map edge, headings track motion, hesitation slows a tradeoff to ${HESITATION_SPEED_FACTOR}×.`,
);
