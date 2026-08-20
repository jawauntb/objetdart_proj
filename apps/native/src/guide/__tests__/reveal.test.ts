/**
 * The reveal law: what the visitor has caused is what the guide may name.
 *
 * Run under `node --experimental-strip-types` from
 * `scripts/native/test-workspace.mjs`.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { EMPTY_REVEAL, revealAfter } from "../reveal.ts";

const strike = { verb: "tap", semanticVerb: "material", answered: true } as const;

test("a gesture the medium did not express reveals nothing", () => {
  const acknowledged = revealAfter(EMPTY_REVEAL, {
    verb: "twist",
    semanticVerb: "lens",
    answered: false,
  });
  assert.equal(acknowledged, EMPTY_REVEAL, "an acknowledgement is not a phenomenon");
  assert.deepEqual(acknowledged.causedVerbs, []);
});

test("a caused phenomenon unlocks its verb exactly once", () => {
  const once = revealAfter(EMPTY_REVEAL, strike);
  const twice = revealAfter(once, strike);
  assert.deepEqual(once.causedVerbs, ["tap"]);
  assert.deepEqual(twice.causedVerbs, ["tap"], "the verb is a set, not a tally");
  assert.equal(twice.primaryReproductions, 2, "reproductions are the tally");
});

test("authorship is the only thing that sets expressed", () => {
  const struck = revealAfter(EMPTY_REVEAL, strike);
  assert.equal(struck.expressed, false, "striking the water is play, not authorship");

  const tutti = revealAfter(struck, { verb: "tap3", semanticVerb: "tutti", answered: true });
  assert.equal(tutti.expressed, true);
  assert.deepEqual(tutti.causedVerbs, ["tap", "tap3"]);

  const ceremony = revealAfter(EMPTY_REVEAL, {
    verb: "holdCeremony",
    semanticVerb: "ceremony",
    answered: true,
  });
  assert.equal(ceremony.expressed, true, "the solemn act is authorship too");
  assert.equal(ceremony.primaryReproductions, 0, "the ceremony is not a strike");
});

test("a verb outside the site-wide grammar cannot enter the reveal state", () => {
  const invented = revealAfter(EMPTY_REVEAL, {
    verb: "swipeUpTwice",
    semanticVerb: "material",
    answered: true,
  });
  assert.equal(invented, EMPTY_REVEAL, "a private dialect never reaches the guide");
});

test("the state is immutable across updates", () => {
  const first = revealAfter(EMPTY_REVEAL, strike);
  const second = revealAfter(first, { verb: "drag", semanticVerb: "material", answered: true });
  assert.deepEqual(first.causedVerbs, ["tap"], "an earlier snapshot is never mutated");
  assert.deepEqual(second.causedVerbs, ["tap", "drag"]);
  assert.equal(EMPTY_REVEAL.causedVerbs.length, 0);
});
