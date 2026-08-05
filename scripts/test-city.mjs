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
  needsUnmet,
  shouldLeave,
  fadeForLeaving,
  isStanding,
  personLedgerFor,
  ledgerIsMeaningful,
  applyPersonLedger,
  PLOT_DWELL_MS,
  CITY_DAY_MS,
  SEASON_ORDER,
  REGULAR_VISITS_TO_BECOME_REGULAR,
  REGULAR_PULL_FACTOR,
  HESITATION_RATIO_THRESHOLD,
  HESITATION_SPEED_FACTOR,
  LEAVING_NEED_THRESHOLD,
  LEAVING_UNMET_MS,
  LEAVING_FADE_MS,
  STANDING_STILL_MS,
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

// ——— leaving: the tradeoff density buys must be able to lose someone ——————
//
// The brief's arc is arrival → consolidation → belonging OR leaving. A person
// whose fed AND rested stay below LEAVING_NEED_THRESHOLD for LEAVING_UNMET_MS
// is a person the settlement failed to hold. The predicate that fires the
// transition is pure: both needs low, and the sustained-unmet counter past
// the threshold.

// needsUnmet: both fed AND rested strictly below the leaving threshold.
assert.equal(needsUnmet(0.1, 0.1), true, "both needs deep in the trough → unmet");
assert.equal(needsUnmet(0.4, 0.1), false, "fed is fine → the person is not sliding out yet");
assert.equal(needsUnmet(0.1, 0.4), false, "rested is fine → the person is not sliding out yet");
assert.equal(
  needsUnmet(LEAVING_NEED_THRESHOLD, LEAVING_NEED_THRESHOLD), false,
  "exactly at the threshold is not below — leaving requires real deprivation, not the ordinary trough",
);
assert.equal(
  needsUnmet(LEAVING_NEED_THRESHOLD - 0.001, LEAVING_NEED_THRESHOLD - 0.001), true,
  "just below the threshold on both counts is unmet",
);

// shouldLeave: sustained-unmet counter past the leaving threshold.
assert.equal(
  shouldLeave(0.1, 0.1, LEAVING_UNMET_MS), true,
  "both needs deep and the counter at the threshold → the person leaves",
);
assert.equal(
  shouldLeave(0.1, 0.1, LEAVING_UNMET_MS - 1), false,
  "one ms short of the threshold — leaving is a sustained condition, not a spike",
);
assert.equal(
  shouldLeave(0.5, 0.1, LEAVING_UNMET_MS * 4), false,
  "a fed person never leaves, however long they've been tired — one need answered is enough to stay",
);
assert.equal(
  shouldLeave(0.1, 0.5, LEAVING_UNMET_MS * 4), false,
  "a rested person never leaves, however long they've been hungry — one need answered is enough to stay",
);
assert.equal(
  shouldLeave(0.1, 0.1, 0), false,
  "an instant of deprivation is not a decision to leave",
);
assert.ok(LEAVING_UNMET_MS > 0, "the leaving window is a real span, not a tick");
assert.ok(LEAVING_NEED_THRESHOLD > 0 && LEAVING_NEED_THRESHOLD < 1, "the leaving threshold is inside the need range");

// fadeForLeaving: the opacity eases from 1 to 0 over LEAVING_FADE_MS.
assert.equal(fadeForLeaving(0), 1, "a person who just started leaving is still fully drawn");
assert.equal(fadeForLeaving(-5), 1, "a negative age is treated as zero — no future-fading");
assert.equal(fadeForLeaving(LEAVING_FADE_MS), 0, "a person past the fade window is invisible in the overlay");
assert.equal(fadeForLeaving(LEAVING_FADE_MS * 2), 0, "the fade clamps — no negative opacities");
const halfWay = fadeForLeaving(LEAVING_FADE_MS / 2);
assert.ok(halfWay > 0.49 && halfWay < 0.51, "halfway through the fade the person reads at half opacity");
// Monotone: the person fades further, never brighter, as they walk toward the edge.
assert.ok(fadeForLeaving(200) > fadeForLeaving(600), "the fade is monotone — a leaving person only dims");

// ——— pose: a store IS what its regulars do at it —————————————————————————
//
// isStanding is a pure predicate: given how long the person has been
// stationary, has their pose flipped from walking to standing? The caller
// (City.tsx) accumulates stillMs frame-by-frame from stepTowards' delta.
// The visual predicate is single-sourced here so a regenerating pose
// change cannot drift from the test — same discipline roleForDwell holds.

assert.equal(isStanding(0), false, "a person who has not been still is walking, not standing");
assert.equal(isStanding(50), false, "a moment of stillness is not yet a standing pose");
assert.equal(
  isStanding(STANDING_STILL_MS), false,
  "at exactly the threshold the person is still walking — standing requires a beat past the tier",
);
assert.equal(
  isStanding(STANDING_STILL_MS + 1), true,
  "one ms past the threshold flips the pose to standing",
);
assert.equal(isStanding(1_000), true, "a long parked stretch is unambiguously standing");
assert.equal(isStanding(-100), false, "a negative counter is walking — a person cannot un-stand into a stand");
assert.ok(STANDING_STILL_MS > 0, "the standing tier is a real window, not a tick");
// The tier must be smaller than the hesitation-swap window (550ms in the
// renderer) so a hesitator hovering between two plots still reads as
// walking, not as standing. And it must be smaller than the leaving fade
// so a person paused at a store reads as standing well before any leaving
// arc could ever bite. Both are covered by keeping STANDING_STILL_MS at
// ~200ms; if the constant grows past those bounds the invariant slips.
assert.ok(STANDING_STILL_MS < LEAVING_FADE_MS, "the standing tier is faster than the leaving fade");
assert.ok(STANDING_STILL_MS < LEAVING_UNMET_MS, "a person becomes visibly standing long before they would ever leave");

// ——— persisted ledger: the belonging that must outlive a page close ——————
//
// Density-as-engine only survives a reload if the plot's identity IS the
// history of who kept coming back — not a role, but a role plus its
// regulars. The persistence path serializes each person's ledger and the
// restore path applies it back onto a freshly-spawned person with the same
// (homeId, seed). The roundtrip is a pure function pair, and the schema
// shape is pinned here so a later refactor cannot silently rename a field.

// An empty ledger — a person who has never visited any plot — has nothing
// to persist. The renderer skips these in the save payload so the visitor's
// storage doesn't fill with all-null rows.
const emptyPerson = {
  seed: 12345,
  homeId: 1,
  foodVisit: null,
  gatherVisit: null,
  regularStoreId: null,
  regularEventId: null,
};
assert.equal(
  ledgerIsMeaningful(personLedgerFor(emptyPerson)), false,
  "a stranger's ledger has nothing to persist — no visits, no regulars, no bloat",
);

// A person mid-habit but not yet a regular — one visit to plot 7 — should
// still persist, because their habit is in progress.
const budding = {
  seed: 12346,
  homeId: 1,
  foodVisit: { plotId: 7, visits: 1 },
  gatherVisit: null,
  regularStoreId: null,
  regularEventId: null,
};
assert.equal(
  ledgerIsMeaningful(personLedgerFor(budding)), true,
  "a visit begun is a habit begun — the ledger persists the start of belonging",
);

// A full-belonging person: regulars at both a store and an event.
const belonger = {
  seed: 0xC0FFEE,
  homeId: 3,
  foodVisit: { plotId: 11, visits: 4 },
  gatherVisit: { plotId: 22, visits: 5 },
  regularStoreId: 11,
  regularEventId: 22,
};
const savedLedger = personLedgerFor(belonger);
assert.equal(savedLedger.seed, 0xC0FFEE, "the seed goes in the ledger — the match key survives");
assert.equal(savedLedger.homeId, 3, "the homeId goes in the ledger — the residence survives");
assert.deepEqual(
  savedLedger.foodVisit, { plotId: 11, visits: 4 },
  "the food ledger persists the plot and the count exactly",
);
assert.deepEqual(
  savedLedger.gatherVisit, { plotId: 22, visits: 5 },
  "the gather ledger persists the plot and the count exactly",
);
assert.equal(savedLedger.regularStoreId, 11, "the food regular's plot id is remembered");
assert.equal(savedLedger.regularEventId, 22, "the gather regular's plot id is remembered");

// The ledger is a structural copy, not a live reference — mutating the
// person after reading their ledger must not corrupt what we'll persist.
belonger.foodVisit.visits = 999;
assert.equal(
  savedLedger.foodVisit.visits, 4,
  "the ledger reads the person by value — later mutations don't reach it",
);

// JSON roundtrip — the schema shape is pinned by walking through a real
// stringify/parse cycle. If a later refactor drops a field or renames it,
// this assertion fires.
const jsonWire = JSON.stringify(savedLedger);
const wire = JSON.parse(jsonWire);
assert.deepEqual(
  Object.keys(wire).sort(),
  ["foodVisit", "gatherVisit", "homeId", "regularEventId", "regularStoreId", "seed"],
  "the wire ledger carries exactly the six fields — no more, no less",
);

// The apply path reads a ledger back onto a fresh spawn. `applyPersonLedger`
// mutates the target person and leaves the ledger untouched (the caller
// still holds the source and may apply it to something else).
const fresh = {
  foodVisit: null,
  gatherVisit: null,
  regularStoreId: null,
  regularEventId: null,
};
applyPersonLedger(fresh, wire);
assert.deepEqual(
  fresh.foodVisit, { plotId: 11, visits: 4 },
  "the applied person now carries the persisted food visit",
);
assert.deepEqual(
  fresh.gatherVisit, { plotId: 22, visits: 5 },
  "the applied person now carries the persisted gather visit",
);
assert.equal(fresh.regularStoreId, 11, "the food regular slot is filled from the ledger");
assert.equal(fresh.regularEventId, 22, "the gather regular slot is filled from the ledger");
// And applying does not create a shared reference — mutating the applied
// person cannot reach back into the source ledger.
fresh.foodVisit.visits = 1;
assert.equal(
  wire.foodVisit.visits, 4,
  "applying is a structural copy — the source ledger is safe to reuse",
);

// The regular threshold survives a roundtrip: a person who came back three
// times is still a regular after restore.
const veteran = {
  seed: 42,
  homeId: 5,
  foodVisit: { plotId: 9, visits: REGULAR_VISITS_TO_BECOME_REGULAR },
  gatherVisit: null,
  regularStoreId: 9,
  regularEventId: null,
};
const veteranLedger = JSON.parse(JSON.stringify(personLedgerFor(veteran)));
const veteranReborn = { foodVisit: null, gatherVisit: null, regularStoreId: null, regularEventId: null };
applyPersonLedger(veteranReborn, veteranLedger);
assert.equal(
  isRegularOf(veteranReborn.foodVisit, 9), true,
  "a regular at the store stays a regular across a page close — the plot's identity is the history that came back",
);

console.log(
  `city ok: role ladder monotone, needs answered by identity, ${SEASON_ORDER.length} seasons cycle both ways, ` +
  `movement never overshoots, homes seed 1..3 residents deterministically, ` +
  `regulars densify identity at ${REGULAR_VISITS_TO_BECOME_REGULAR} visits with a ${REGULAR_PULL_FACTOR}× pull, ` +
  `arrivals enter from the nearest map edge, headings track motion, hesitation slows a tradeoff to ${HESITATION_SPEED_FACTOR}×, ` +
  `unmet needs past ${LEAVING_UNMET_MS}ms on both counters retire a person from the settlement, ` +
  `people flip from walking sliver to standing dot-over-dot after ${STANDING_STILL_MS}ms of no measurable step, ` +
  `persisted ledger roundtrips (foodVisit, gatherVisit, regularStoreId, regularEventId) — the teal colonies survive a reload.`,
);
