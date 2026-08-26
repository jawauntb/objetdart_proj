import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generator = path.join(root, "scripts/native/generate-reference-fixtures.mjs");
const committedDirectory = path.join(root, "scripts/native/fixtures");
const contractEntry = path.join(root, "packages/universe-contracts/src/index.ts");
const h2Verifier = path.join(root, "scripts/native/verify-h2-rhf-cassette.mjs");
const h2File = "h2-rhf-v1.json";
const expectedFiles = ["cell-reference.json", "solar-reference.json", "wave-reference.json"];

function assertComparisonPolicy(fixture, file) {
  if (fixture.scene === "cell") {
    assert.equal(fixture.comparison?.kind, "mixed", `${file} must use a mixed integer/float comparison policy`);
    assert.equal(fixture.comparison?.exact?.kind, "exact", `${file} must name its exact identity/integer policy`);
    assert.ok(
      Array.isArray(fixture.comparison?.exact?.paths) && fixture.comparison.exact.paths.includes("expected.daughters") && fixture.comparison.exact.paths.includes("expected.engulfment.productSeed"),
      `${file} must compare lineage and engulfment identities exactly`,
    );
    assert.equal(fixture.comparison?.floats?.kind, "relative", `${file} must use a relative float policy`);
    assert.ok(
      Number.isFinite(fixture.comparison?.floats?.relativeTolerance) && fixture.comparison.floats.relativeTolerance > 0,
      `${file} must declare a positive relative float tolerance`,
    );
    assert.ok(
      Number.isFinite(fixture.comparison?.floats?.absoluteTolerance) && fixture.comparison.floats.absoluteTolerance > 0,
      `${file} must declare a positive absolute float tolerance`,
    );
    assert.ok(fixture.comparison?.floats?.scope?.trim(), `${file} must state which floats use the tolerance`);
    return;
  }
  assert.equal(fixture.comparison?.kind, "absolute", `${file} must use an absolute comparison policy`);
  assert.ok(
    Number.isFinite(fixture.comparison?.tolerance) && fixture.comparison.tolerance > 0,
    `${file} must declare a positive absolute tolerance`,
  );
}

assert.ok(existsSync(generator), "native fixture generator must exist");
assert.ok(existsSync(contractEntry), "native fixture guard needs @objet/universe-contracts");
assert.ok(existsSync(committedDirectory), "canonical native fixtures must be committed");

const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "objet-native-fixtures-"));

try {
  execFileSync(
    process.execPath,
    ["--experimental-strip-types", generator, `--out=${temporaryDirectory}`],
    { cwd: root, encoding: "utf8", stdio: "pipe" },
  );

  const contracts = await import(pathToFileURL(contractEntry).href);
  const manifest = contracts.RELEASE_SCENE_MANIFEST;
  assert.ok(Array.isArray(manifest), "RELEASE_SCENE_MANIFEST must be an array");
  const scenes = new Map(manifest.map((scene) => [scene.id, scene]));

  const committedFiles = readdirSync(committedDirectory).filter((file) => file.endsWith(".json")).sort();
  const generatedFiles = readdirSync(temporaryDirectory).filter((file) => file.endsWith(".json")).sort();
  assert.deepEqual(committedFiles.filter((file) => file !== h2File), expectedFiles, "committed fixture directory must contain exactly the three Release 1 references");
  assert.deepEqual(committedFiles.filter((file) => file === h2File), [h2File], "the H2 cassette must remain in its own verified lane");
  assert.deepEqual(generatedFiles, expectedFiles, "fixture generator must emit exactly the three Release 1 references");

  execFileSync(process.execPath, [h2Verifier, `--fixture=${path.join(committedDirectory, h2File)}`], { cwd: root, encoding: "utf8", stdio: "pipe" });

  for (const file of expectedFiles) {
    const committed = readFileSync(path.join(committedDirectory, file));
    const generated = readFileSync(path.join(temporaryDirectory, file));
    assert.deepEqual(generated, committed, `${file} is stale; regenerate it from the pure law and commit the result`);

    const fixture = JSON.parse(committed.toString("utf8"));
    const scene = scenes.get(fixture.scene);
    assert.ok(scene, `${file} names a scene absent from RELEASE_SCENE_MANIFEST`);
    assert.equal(fixture.fixtureVersion, 1, `${file} must declare fixture version 1`);
    assert.equal(fixture.contractVersion, contracts.NATIVE_CONTRACT_VERSION, `${file} contract version drifted from the manifest package`);
    assert.equal(fixture.modelVersion, scene.simulation.modelVersion, `${file} model version drifted from ${scene.id}`);
    assert.equal(fixture.simulationVersion, scene.simulation.version, `${file} simulation version drifted from ${scene.id}`);
    assert.deepEqual(fixture.units, scene.simulation.units, `${file} units drifted from ${scene.id}`);
    assert.ok(fixture.referenceCase, `${file} must identify its scientific reference case`);
    assert.ok(fixture.expected, `${file} must carry an expected scientific output`);
    assertComparisonPolicy(fixture, file);
  }
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log("native fixtures: fresh and aligned with the release manifest");
