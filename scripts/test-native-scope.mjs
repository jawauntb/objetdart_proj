import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractEntry = path.join(root, "packages/universe-contracts/src/index.ts");
const horizonPath = path.join(root, "docs/native/post-validation-horizon.md");
const scientificReferencesPath = path.join(root, "docs/native/scientific-references.md");

const RELEASE_ONE_IDS = ["cell", "solar", "wave"];
const REQUIRED_REQUIREMENTS = [
  "science",
  "sensory",
  "persistence",
  "accessibility",
  "guide",
  "performance",
];
const REQUIRED_HORIZON_FAMILIES = [
  "cosmic-deep-time",
  "particle-and-nuclear-matter",
  "atoms-and-chemistry",
  "abiogenesis-and-molecular-biology",
  "multicellular-life",
  "planetary-worlds",
  "mathematical-and-law-instruments",
  "memory-and-shared-worlds",
  "platform-extensions",
  "web-room-reassessment",
];
const REQUIRED_SOURCES = {
  wave: ["wave-fdtd-taflove-hagness-2005", "wave-cooley-tukey-1965", "wave-nist-dlmf"],
  cell: ["cell-turing-1952", "cell-murray-2002", "cell-alberts-2022"],
  solar: ["solar-murray-dermott-1999", "solar-wisdom-holman-1991", "solar-hairer-lubich-wanner-2006"],
};

async function loadContracts() {
  if (!existsSync(contractEntry)) {
    throw new Error(
      "native scope needs packages/universe-contracts/src/index.ts; complete the U2 contracts package before running this guard",
    );
  }
  try {
    return await import(pathToFileURL(contractEntry).href);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `native scope could not load @objet/universe-contracts. Run with Node 22 --experimental-strip-types and expose its TypeScript entry point. Original error: ${detail}`,
    );
  }
}

function sorted(values) {
  return [...values].sort();
}

function requirePromotionEvidence(family) {
  const evidencePath = path.join(root, "docs/native/validation-promotions", `${family}.md`);
  assert.ok(
    existsSync(evidencePath),
    `${family} disappeared from the post-validation horizon without a validated promotion record`,
  );
  const evidence = readFileSync(evidencePath, "utf8");
  const frontmatter = evidence.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(frontmatter, `${family} promotion evidence needs YAML frontmatter`);
  assert.match(frontmatter[1], new RegExp(`^family:\\s*${family}\\s*$`, "m"), `${family} promotion evidence names the wrong family`);
  assert.match(frontmatter[1], /^validated:\s*true\s*$/m, `${family} promotion evidence must be validated`);
  for (const field of [
    "simulationContract",
    "scientificReview",
    "comprehensionEvidence",
    "accessibilityEvidence",
    "persistenceEvidence",
    "performanceEvidence",
    "universeRelationship",
  ]) {
    assert.match(frontmatter[1], new RegExp(`^${field}:\\s*\\S`, "m"), `${family} promotion evidence lacks ${field}`);
  }
  assert.match(frontmatter[1], /^embodiedRelease:\s*v(?:[2-9]|[1-9]\d+)\s*$/m, `${family} promotion cannot claim Release 1`);
}

const contracts = await loadContracts();
const {
  NATIVE_CONTRACT_VERSION,
  CONTRACT_VERSIONS,
  RELEASE_SCENE_MANIFEST,
  RELEASE_ONE_SCENE_IDS,
  releaseSceneIds,
  validateReleaseSceneManifest,
} = contracts;

assert.ok(NATIVE_CONTRACT_VERSION, "the native contract package must declare its version");
assert.ok(CONTRACT_VERSIONS, "the native contract package must declare component versions");
assert.ok(Array.isArray(RELEASE_SCENE_MANIFEST), "RELEASE_SCENE_MANIFEST must be an array");
assert.ok(Array.isArray(RELEASE_ONE_SCENE_IDS), "RELEASE_ONE_SCENE_IDS must be an array");
assert.deepEqual(
  sorted(RELEASE_ONE_SCENE_IDS),
  RELEASE_ONE_IDS,
  "Release 1 may contain exactly wave, cell, and solar",
);
assert.deepEqual(
  sorted(RELEASE_SCENE_MANIFEST.map((scene) => scene.id)),
  RELEASE_ONE_IDS,
  "a fourth scene or a missing proof scene changes Release 1 scope",
);
assert.deepEqual(
  sorted(releaseSceneIds(RELEASE_SCENE_MANIFEST)),
  RELEASE_ONE_IDS,
  "the manifest's release helper must agree with the three-scene boundary",
);

const validation = validateReleaseSceneManifest(RELEASE_SCENE_MANIFEST);
assert.equal(validation.valid, true, `release scene manifest is invalid: ${validation.errors?.join("; ") ?? "unknown validation failure"}`);

for (const scene of RELEASE_SCENE_MANIFEST) {
  assert.equal(scene.version, NATIVE_CONTRACT_VERSION, `${scene.id} must use the native contract version`);
  assert.equal(scene.release, "v1", `${scene.id} must be explicitly declared Release 1`);
  assert.ok(scene.scale, `${scene.id} must retain a scale address`);
  assert.equal(
    scene.sharedIdentity?.parameter,
    "equilibrium-temperature-k",
    `${scene.id} must name the shared equilibrium-temperature causal thread`,
  );
  assert.ok(scene.sharedIdentity?.relationship?.trim(), `${scene.id} must state its shared-world relationship`);
  assert.ok(scene.simulation, `${scene.id} needs a simulation contract`);
  assert.ok(scene.style, `${scene.id} needs a scene-style contract`);
  assert.equal(scene.simulation.id, scene.id, `${scene.id} simulation must have the same identity as its scene`);
  assert.equal(scene.simulation.version, CONTRACT_VERSIONS.simulation, `${scene.id} simulation version drifted from CONTRACT_VERSIONS`);
  assert.ok(scene.simulation.model?.trim(), `${scene.id} simulation needs a model`);
  assert.ok(scene.simulation.modelVersion?.trim(), `${scene.id} simulation needs a model version`);
  assert.ok(scene.simulation.integrator?.trim(), `${scene.id} simulation needs an integrator`);
  assert.ok(scene.simulation.units?.every((unit) => unit.quantity?.trim() && unit.symbol?.trim()), `${scene.id} simulation needs named units`);
  assert.ok(scene.simulation.invariants?.every((invariant) => invariant.id?.trim() && invariant.statement?.trim() && Number.isFinite(invariant.tolerance)), `${scene.id} simulation needs measurable invariants`);
  assert.ok(scene.simulation.conservedQuantities?.every((quantity) => quantity?.trim()), `${scene.id} simulation needs conserved quantities`);
  assert.ok(scene.simulation.validity?.every((range) => range.parameter?.trim() && range.unit?.trim() && range.disclosure?.trim() && Number.isFinite(range.min) && Number.isFinite(range.max) && range.min <= range.max), `${scene.id} simulation needs stated validity ranges`);
  assert.ok(scene.simulation.interventions?.every((intervention) => intervention?.trim()), `${scene.id} simulation needs interventions`);
  assert.ok(scene.simulation.seededVariance?.trim(), `${scene.id} simulation needs seeded variance`);
  assert.ok(scene.simulation.referenceCases?.every((reference) => reference.id?.trim() && reference.input?.trim() && reference.expected?.trim() && Number.isFinite(reference.tolerance)), `${scene.id} simulation needs reference cases`);
  assert.ok(scene.simulation.approximations?.every((approximation) => approximation?.trim()), `${scene.id} simulation needs approximation disclosures`);
  assert.equal(scene.style.id, scene.id, `${scene.id} style must have the same identity as its scene`);
  assert.equal(scene.style.version, CONTRACT_VERSIONS.sceneStyle, `${scene.id} style version drifted from CONTRACT_VERSIONS`);
  assert.deepEqual(
    sorted(Object.keys(scene.requirements ?? {})),
    sorted(REQUIRED_REQUIREMENTS),
    `${scene.id} needs science, sensory, persistence, accessibility, guide, and performance requirements`,
  );
  for (const category of REQUIRED_REQUIREMENTS) {
    const requirement = scene.requirements[category];
    assert.equal(requirement?.version, 1, `${scene.id}.${category} must be versioned`);
    assert.equal(requirement?.status, "required", `${scene.id}.${category} cannot be optional for Release 1`);
    assert.ok(requirement?.summary?.trim(), `${scene.id}.${category} needs a concrete contract summary`);
    assert.ok(
      Array.isArray(requirement?.evidence?.evidenceIds) && requirement.evidence.evidenceIds.length > 0 && requirement.evidence.evidenceIds.every((id) => id?.trim()),
      `${scene.id}.${category} needs immutable evidence IDs`,
    );
    assert.ok(requirement?.evidence?.reviewerId?.trim(), `${scene.id}.${category} needs a reviewer ID`);
    assert.ok(
      requirement?.evidence?.approval?.status === "required" || requirement?.evidence?.approval?.status === "approved",
      `${scene.id}.${category} needs a required or approved evidence status`,
    );
    assert.ok(requirement?.evidence?.approval?.evidenceId?.trim(), `${scene.id}.${category} needs an approval evidence ID`);
    if (category === "science") {
      assert.deepEqual(
        sorted(requirement.evidence.sourceIds ?? []),
        sorted(REQUIRED_SOURCES[scene.id]),
        `${scene.id}.science must cite the real stable scientific source IDs, not a placeholder`,
      );
    }
  }
}

assert.ok(existsSync(scientificReferencesPath), "Release 1 needs a durable scientific-reference registry");
const scientificReferences = readFileSync(scientificReferencesPath, "utf8");
for (const [scene, sourceIds] of Object.entries(REQUIRED_SOURCES)) {
  for (const sourceId of sourceIds) {
    assert.match(scientificReferences, new RegExp(`\`${sourceId}\``), `${scene} must retain scientific source ${sourceId}`);
  }
}

assert.ok(existsSync(horizonPath), "the full-vision horizon must remain in the repository");
const horizon = readFileSync(horizonPath, "utf8");
assert.match(horizon, /Status:\s*not implemented/i, "the horizon must be visibly marked not implemented");
for (const family of REQUIRED_HORIZON_FAMILIES) {
  const marker = `<!-- native-horizon: ${family} -->`;
  if (!horizon.includes(marker)) requirePromotionEvidence(family);
}

console.log("native release scope: exactly wave, cell, and solar; horizon retained");
