import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import * as ts from "typescript";

const rootUrl = new URL("../", import.meta.url);

function loadTsModule(path) {
  const filename = fileURLToPath(new URL(path, rootUrl));
  const source = readFileSync(filename, "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  // Same realm as the test: vm.runInNewContext builds arrays, objects and
  // strings on a foreign prototype chain, so deepStrictEqual rejects them
  // against host literals of identical content.
  new Function("module", "exports", code)(module, module.exports);
  return module.exports;
}

const {
  candleNext,
  holdAction,
  inviteNext,
  FRESH_LEDGER,
  parseCandle,
} = loadTsModule("src/lib/candle.ts");

// (objects cross a vm realm boundary, so compare fields, not prototypes)
const transition = (state, event) => {
  const t = candleNext(state, event);
  return `${t.state}/${t.changed}`;
};

// — lit ↔ snuffed: the only legal transitions, effects fire exactly once —
assert.equal(transition("lit", "snuff"), "snuffed/true");
assert.equal(transition("snuffed", "relight"), "lit/true");
// a second blow on a dead flame moves nothing (would double the night thud)
assert.equal(transition("snuffed", "snuff"), "snuffed/false");
// relighting a burning candle must not re-bloom
assert.equal(transition("lit", "relight"), "lit/false");
// round trip: snuff then relight lands back where it started
{
  const down = candleNext("lit", "snuff");
  const up = candleNext(down.state, "relight");
  assert.equal(up.state, "lit");
  assert.ok(up.changed);
}

// — the hold ladder fires on tier crossings, never on dwelling at a tier —
assert.equal(holdAction("lit", 2, 1), "invite-vessel", "crossing dwell on a lit candle invites the vessel");
assert.equal(holdAction("lit", 2, 2), null, "staying at dwell is not asking again");
assert.equal(holdAction("lit", 3, 2), "invite-breath", "holding on to ceremony invites breath");
assert.equal(holdAction("lit", 3, 3), null, "a hand that keeps holding fires nothing");
assert.equal(holdAction("lit", 1, 0), null, "touch tier alone invites nothing");
assert.equal(holdAction("lit", 3, 1), "invite-breath", "a coarse tick that jumps to ceremony still lands the deeper ask");
assert.equal(holdAction("snuffed", 2, 1), "relight", "dwell on the unlit wick relights");
assert.equal(holdAction("snuffed", 2, 2), null, "the wick relights once per crossing");
assert.equal(holdAction("snuffed", 3, 2), null, "ceremony on a dead candle asks for nothing");

// — never ask twice: the invitation ledger is monotone —
{
  let { ledger, ask } = inviteNext(FRESH_LEDGER, "vessel");
  assert.equal(ask, true, "first vessel invitation goes out");
  const second = inviteNext(ledger, "vessel");
  assert.equal(second.ask, false, "vessel is never asked twice");
  assert.equal(second.ledger, ledger, "a refused ask does not mutate the ledger");
  const breath = inviteNext(ledger, "breath");
  assert.equal(breath.ask, true, "breath is its own, separate invitation");
  assert.equal(inviteNext(breath.ledger, "breath").ask, false, "breath also asks once");
  assert.equal(inviteNext(breath.ledger, "vessel").ask, false, "asked flags never clear");
  assert.equal(FRESH_LEDGER.vessel, false, "the fresh ledger was not mutated");
  assert.equal(FRESH_LEDGER.breath, false, "the fresh ledger was not mutated");
}

// — persistence codec: only a remembered night reads as snuffed —
assert.equal(parseCandle("snuffed"), "snuffed");
assert.equal(parseCandle("lit"), "lit");
assert.equal(parseCandle(null), "lit", "a first visit starts lit");
assert.equal(parseCandle("corrupt-value"), "lit", "garbage must never trap the site in the dark");
assert.equal(parseCandle(undefined), "lit");
// round trip: what the candle writes, the candle reads
for (const s of ["lit", "snuffed"]) assert.equal(parseCandle(s), s);

console.log("test-candle: all assertions passed");
