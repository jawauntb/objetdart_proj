import assert from "node:assert/strict";
import { loadTsModule } from "./lib/load-ts.mjs";

const {
  CANONICAL_H2_COMPOUND,
  CANONICAL_H2_SEED,
  DOCK_REACH_FACTOR,
  bindMoleculeContact,
  createMoleculeTargetBody,
  createMoleculeOnOpenField,
  initializeMoleculeCreationState,
  resolveBoundMoleculeContact,
  resolveMoleculeContact,
  resolveMoleculeDockingPartner,
  resolveMoleculeTarget,
  hasActiveH2,
  validateMoleculeTargetBodies,
} = loadTsModule("src/lib/molecule-h2-targeting.ts");

const body = (id, compound = "H2", overrides = {}) => ({
  id,
  seed: compound === "H2" ? CANONICAL_H2_SEED : 42,
  compound,
  x: 100,
  y: 100,
  hitRadius: 37.5,
  interactionRadius: 30,
  closed: true,
  retiring: false,
  ...overrides,
});

assert.equal(CANONICAL_H2_SEED, 109017827, "canonical starter seed stays explicit");
assert.equal(CANONICAL_H2_COMPOUND, "H2", "canonical starter compound is H2");
assert.equal(resolveMoleculeTarget([body("h2")], { x: 100, y: 100 }).compound, "H2");

// Hit reach is intentionally wider than the raw interaction radius, while
// docking uses only the raw radii.
const narrow = createMoleculeTargetBody({ id: "narrow", seed: 12, compound: "O2", x: 100, y: 100, radius: 10, closed: true, retiring: false });
assert.equal(narrow.hitRadius, 34);
assert.equal(narrow.interactionRadius, 10);
assert.equal(resolveMoleculeTarget([narrow], { x: 130, y: 100 }).id, "narrow", "hit envelope uses max(34, sr×1.25)");
assert.equal(resolveMoleculeDockingPartner(narrow, [narrow, { ...narrow, id: "near", x: 135 }]), null, "docking uses raw radii, not hit radius");

// Equal-distance nearest hit uses the stable id, not population order.
const tieA = body("body-a", "H2", { x: 80, y: 100 });
const tieB = body("body-b", "H2", { x: 120, y: 100 });
assert.equal(resolveMoleculeTarget([tieB, tieA], { x: 100, y: 100 }).id, "body-a");
assert.equal(resolveMoleculeTarget([tieA, tieB], { x: 100, y: 100 }).id, "body-a");
assert.equal(resolveMoleculeTarget([tieA], { x: 1000, y: 1000 }), null, "outside every radius misses");

// An eligible closed partner wins before RHF, and the partner tie is stable.
const h2 = body("h2", "H2", { x: 100, y: 100 });
const partnerA = body("partner-a", "O2", { x: 160, y: 100 });
const partnerB = body("partner-b", "N2", { x: 40, y: 100 });
const reaction = resolveMoleculeContact([partnerB, h2, partnerA], { x: 100, y: 100, inputMode: "touch" }, DOCK_REACH_FACTOR);
assert.equal(reaction.status, "bound");
assert.equal(reaction.bodyId, "h2");
assert.equal(reaction.mode, "reaction");
assert.equal(reaction.partnerId, "partner-a", "equal partner distance resolves by stable id");
assert.equal(resolveMoleculeDockingPartner(h2, [partnerB, h2, partnerA]).id, "partner-a");

// A closed, isolated H2 is the only target that enters the RHF branch.
const isolated = resolveMoleculeContact([body("h2", "H2")], { x: 100, y: 100, inputMode: "touch" });
assert.deepEqual(
  isolated,
  { status: "bound", bodyId: "h2", targetId: "h2", mode: "h2-rhf", partnerId: null, dockReachFactor: DOCK_REACH_FACTOR, contactEpoch: null },
);
assert.equal(resolveMoleculeContact([body("open", "H2", { closed: false })], { x: 100, y: 100 }).mode, "molecule");
assert.equal(resolveMoleculeContact([body("water", "H2O")], { x: 100, y: 100 }).mode, "molecule");

// Touch, keyboard, and assistive paths use the same point resolver and return
// exactly the same semantic binding.
const parityBodies = [body("other", "O2", { x: 240, y: 200 }), body("focus", "H2", { x: 200, y: 200 })];
const touch = resolveMoleculeContact(parityBodies, { x: 200, y: 200, inputMode: "touch", contactEpoch: 7 });
const keyboard = resolveMoleculeContact(parityBodies, { x: 200, y: 200, inputMode: "keyboard", contactEpoch: 7 });
const assistive = resolveMoleculeContact(parityBodies, { x: 200, y: 200, inputMode: "assistive", contactEpoch: 7 });
assert.deepEqual(touch, keyboard);
assert.deepEqual(touch, assistive);

// Bind once.  Reordering and moving the body must not retarget the contact.
const binding = bindMoleculeContact([body("first", "H2"), body("second", "H2", { x: 400, y: 100 })], {
  x: 100,
  y: 100,
  inputMode: "touch",
  contactEpoch: "epoch-1",
});
const moved = [body("second", "O2", { x: 100, y: 100 }), body("first", "H2", { x: 450, y: 450 })];
const continued = resolveBoundMoleculeContact(binding, moved);
assert.equal(continued.status, "bound");
assert.equal(continued.bodyId, "first", "movement does not select a new nearest body");
assert.equal(continued.mode, "h2-rhf", "entry mode remains stable");
assert.equal(continued, binding, "valid continuation returns the original immutable binding");

// A later partner cannot change an isolated H2 binding.  A reaction binding,
// however, cancels when its locked partner is closed/near no longer.
const newlyNearby = resolveBoundMoleculeContact(binding, [body("first", "H2"), body("second", "O2", { x: 110, y: 100 })]);
assert.equal(newlyNearby, binding);

const retired = resolveBoundMoleculeContact(binding, [body("first", "H2", { retiring: true }), body("second", "H2")]);
assert.equal(retired.status, "cancelled");
assert.equal(retired.reason, "target-retired");
const missingBound = resolveBoundMoleculeContact(binding, [body("second", "H2")]);
assert.equal(missingBound.status, "cancelled");
assert.equal(missingBound.reason, "target-missing");

const reactionBinding = bindMoleculeContact([h2, partnerA], { x: 100, y: 100 });
assert.equal(resolveBoundMoleculeContact(reactionBinding, [h2]).reason, "partner-missing");
assert.equal(resolveBoundMoleculeContact(reactionBinding, [h2, { ...partnerA, retiring: true }]).reason, "partner-retired");
assert.equal(resolveBoundMoleculeContact(reactionBinding, [h2, { ...partnerA, closed: false }]).reason, "partner-unavailable");
assert.equal(resolveBoundMoleculeContact(reactionBinding, [h2, { ...partnerA, x: 1000 }]).reason, "partner-unavailable");

const ambiguous = [body("duplicate", "H2"), body("duplicate", "O2", { x: 500 })];
assert.equal(validateMoleculeTargetBodies(ambiguous), false);
assert.equal(resolveMoleculeTarget(ambiguous, { x: 100, y: 100 }), null);
assert.equal(resolveMoleculeDockingPartner(ambiguous[0], ambiguous), null);
assert.equal(resolveMoleculeContact(ambiguous, { x: 100, y: 100 }).reason, "ambiguous-targets");
assert.equal(resolveBoundMoleculeContact(binding, ambiguous).reason, "ambiguous-targets");

// Creation policy: only a caller-supplied fresh/missing starter may be loaded
// immediately.  Valid empty/populated records remain unchanged until the
// next open-field action, where H2 is consumed exactly once.
const starter = body("caller-owned-h2", "H2");
const fresh = initializeMoleculeCreationState({ status: "fresh", molecules: [], canonicalH2Starter: starter });
assert.deepEqual(fresh.molecules.map((item) => item.id), ["caller-owned-h2"]);
assert.equal(fresh.nextOpenFieldUsesCanonicalH2, false);

const missing = initializeMoleculeCreationState({ status: "missing", molecules: [], canonicalH2Starter: starter });
assert.equal(missing.molecules.length, 1);
assert.equal(missing.molecules[0].seed, CANONICAL_H2_SEED);
assert.equal(hasActiveH2(missing.molecules), true);

const empty = initializeMoleculeCreationState({ status: "valid-empty", molecules: [], canonicalH2Starter: starter });
assert.deepEqual(empty.molecules, []);
assert.equal(empty.nextOpenFieldUsesCanonicalH2, true);
const emptyCreated = createMoleculeOnOpenField(empty, {
  callerSeed: 77,
  makeMolecule: (seed) => body("empty-created", "H2", { seed }),
});
assert.equal(emptyCreated.usedCanonicalH2, true);
assert.equal(emptyCreated.seed, CANONICAL_H2_SEED);
assert.equal(emptyCreated.state.molecules.length, 1);

const noH2 = initializeMoleculeCreationState({ status: "valid-populated", molecules: [body("existing", "O2")] });
assert.deepEqual(noH2.molecules.map((item) => item.id), ["existing"], "populated load is unchanged");
assert.equal(noH2.nextOpenFieldUsesCanonicalH2, true);
const firstOpen = createMoleculeOnOpenField(noH2, {
  callerSeed: 88,
  makeMolecule: (seed) => body("created-h2", "H2", { seed }),
});
assert.equal(firstOpen.seed, CANONICAL_H2_SEED);
const secondOpen = createMoleculeOnOpenField(firstOpen.state, {
  callerSeed: 88,
  makeMolecule: (seed) => body("created-regular", "O2", { seed }),
});
assert.equal(secondOpen.seed, 88, "later open-field creation returns to caller seed");

const restored = initializeMoleculeCreationState({ status: "valid-populated", molecules: [body("restored", "H2")] });
assert.equal(restored.nextOpenFieldUsesCanonicalH2, false);
const restoredCreated = createMoleculeOnOpenField(restored, {
  callerSeed: 99,
  makeMolecule: (seed) => body("restored-regular", "O2", { seed }),
});
assert.equal(restoredCreated.seed, 99, "restored H2 does not inject another canonical H2");

const multiple = initializeMoleculeCreationState({ status: "valid-populated", molecules: [body("h2-a", "H2"), body("h2-b", "H2")] });
assert.equal(multiple.nextOpenFieldUsesCanonicalH2, false);
assert.equal(multiple.molecules.length, 2, "multiple restored H2 records remain multiple");

for (const callerSeed of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  assert.throws(
    () => createMoleculeOnOpenField(noH2, { callerSeed, makeMolecule: (seed) => body("bad-seed", "O2", { seed }) }),
    /non-negative safe integer/,
  );
}

assert.throws(
  () => initializeMoleculeCreationState({ status: "fresh", molecules: [], canonicalH2Starter: body("wrong", "O2") }),
  /canonical H2 starter/,
);
assert.throws(
  () => createMoleculeOnOpenField(empty, { callerSeed: 77, makeMolecule: (seed) => body("wrong", "O2", { seed }) }),
  /canonical H2 starter/,
);
for (const invalid of [
  body("", "H2", { seed: CANONICAL_H2_SEED }),
  body("retiring-h2", "H2", { retiring: true }),
]) {
  assert.throws(
    () => createMoleculeOnOpenField(empty, { callerSeed: 77, makeMolecule: () => invalid }),
    /canonical H2 starter/,
  );
  assert.equal(empty.nextOpenFieldUsesCanonicalH2, true, "failed creation does not consume canonical state");
}

console.log("molecule H2 targeting: ok (stable target, partner precedence, deterministic creation policy)");
