#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CHEMISTRY_SCENE_MANIFEST,
  SCIENCE_SOURCE_IDS,
} from "../packages/universe-contracts/src/manifest.ts";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const REVIEW_PATH = "docs/native/reviews/h2-rhf-v1.json";
const EXPECTED_ARTIFACTS = [
  "scripts/native/fixtures/h2-rhf-v1.json",
  "scripts/native/generate-h2-rhf-cassette.py",
  "scripts/native/verify-h2-rhf-cassette.mjs",
  "scripts/native/h2-rhf-model.md",
  "src/lib/h2-rhf.ts",
  "src/lib/h2-rhf-presentation.ts",
  "src/lib/h2-rhf-webgl.ts",
  "src/components/MoleculesField.tsx",
  "packages/objet-universe-kit/Sources/ObjetUniverseCore/Molecules/H2RHF.swift",
  "packages/objet-universe-kit/Sources/ObjetUniverseCore/Molecules/MoleculeH2Outcome.swift",
  "packages/objet-universe-kit/Sources/ObjetUniverseCore/Molecules/MoleculeRenderSnapshot.swift",
  "packages/objet-universe-kit/Sources/ObjetUniverseRender/Molecules/MoleculeRenderer.swift",
  "packages/objet-universe-kit/Sources/ObjetUniverseRender/Molecules/MoleculeShaders.swift",
  "apps/native/modules/objet-universe/ios/UniverseRuntime.swift",
  "src/data/guide.ts",
  "apps/native/src/guide/guideData.ts",
  "docs/native/scientific-references.md",
  "docs/native/simulation-contract.md",
  "docs/native/evidence-schema.md",
];

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fileHash(path) {
  return sha256(readFileSync(resolve(ROOT, path)));
}

const review = JSON.parse(readFileSync(resolve(ROOT, REVIEW_PATH), "utf8"));
const cassette = JSON.parse(readFileSync(resolve(ROOT, "scripts/native/fixtures/h2-rhf-v1.json"), "utf8"));
const { evidenceSha256, ...reviewBody } = review;
const computedEvidenceSha256 = sha256(canonical(reviewBody));

assert.equal(review.recordVersion, 1);
assert.equal(review.id, "h2-rhf-scientific-review-v1");
assert.equal(review.scene, "molecules");
assert.equal(review.modelVersion, cassette.modelVersion);
assert.match(review.reviewedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
assert.deepEqual(review.reviewer, {
  id: "luna-independent-science-audit-2026-08-25",
  kind: "independent-model-audit",
  model: "gpt-5.6-luna",
  reasoningEffort: "max",
  independence: "read-only lane with no implementation ownership",
  credentialBoundary: "internal model audit; not external peer review or a credentialed scientific sign-off",
});
assert.deepEqual(review.sourceIds, SCIENCE_SOURCE_IDS.molecules);
assert.equal(review.cassette.payloadSha256, cassette.payloadSha256);
assert.equal(review.cassette.model, cassette.model);
assert.equal(review.cassette.nodeCount, cassette.nodes.length);
assert.equal(review.cassette.midpointCount, cassette.midpoints.length);
assert.deepEqual(review.cassette.validityAngstrom, [cassette.envelope.minAngstrom, cassette.envelope.maxAngstrom]);
assert.deepEqual(review.cassette.oracleMaxima, {
  densityMatrixMaxAbs: cassette.oracle.midpointMaxDensityError,
  totalEnergyMaxAbsHartree: cassette.oracle.midpointMaxEnergyError,
  electronCountMaxAbs: cassette.oracle.midpointMaxElectronCountError,
});
assert.deepEqual(review.cassette.blockingCeilings, {
  densityMatrixMaxAbs: cassette.comparison.densityMatrixMaxAbs,
  totalEnergyMaxAbsHartree: cassette.comparison.totalEnergyMaxAbs,
  electronCountMaxAbs: cassette.comparison.electronCountMaxAbs,
});
assert.deepEqual(review.referenceCases.map(({ id, count, assessment }) => [id, count, assessment]), [
  ["pyscf-rhf-sto-3g-nodes-0-through-24", 25, "pass"],
  ["pyscf-rhf-sto-3g-adjacent-midpoints-0-through-23", 24, "pass"],
  ["typescript-swift-semantic-trace-parity-v1", 7, "pass"],
]);
for (const key of ["approximation", "promotionAndRefusal", "perceptualMapping", "crossPlatform"]) {
  assert.equal(typeof review.assessments[key], "string");
  assert.ok(review.assessments[key].length > 80, `${key} assessment must be substantive`);
}
assert.ok(review.limitations.some((line) => line.includes("not external peer review")));
assert.ok(review.limitations.some((line) => line.includes("did not independently install and rerun PySCF")));
assert.ok(review.prohibitedClaims.includes("electron motion"));
assert.ok(review.prohibitedClaims.includes("general quantum-chemistry solver"));
assert.equal(review.decision, "approved-for-bounded-instrument");
assert.equal(evidenceSha256, computedEvidenceSha256, "review evidence hash must match its canonical body");

assert.deepEqual(review.artifacts.map(({ path }) => path), EXPECTED_ARTIFACTS);
for (const artifact of review.artifacts) {
  assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
  assert.equal(artifact.sha256, fileHash(artifact.path), `${artifact.path} drifted after review`);
}

const evidenceId = `${review.id}:sha256:${evidenceSha256}`;
const molecule = CHEMISTRY_SCENE_MANIFEST.find(({ id }) => id === "molecules");
assert.ok(molecule);
assert.ok(molecule.requirements.science.evidence.evidenceIds.includes(evidenceId));
assert.equal(molecule.requirements.science.evidence.reviewerId, review.reviewer.id);
assert.deepEqual(molecule.requirements.science.evidence.approval, { status: "approved", evidenceId });

console.log(`h2 scientific review: ${review.decision} (${evidenceSha256})`);
