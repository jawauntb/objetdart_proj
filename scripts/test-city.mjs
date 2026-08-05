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
  stepTowards,
  dwellersPerHome,
  nextSeason,
  treeFoliage,
  dayFraction,
  isDaytime,
  PLOT_DWELL_MS,
  CITY_DAY_MS,
  SEASON_ORDER,
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

console.log(
  `city ok: role ladder monotone, needs answered by identity, ${SEASON_ORDER.length} seasons cycle both ways, ` +
  `movement never overshoots, homes seed 1..3 residents deterministically.`,
);
