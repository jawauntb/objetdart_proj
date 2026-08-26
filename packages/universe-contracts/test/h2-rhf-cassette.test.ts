import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  buildH2RHFFock,
  canonicalH2RHFNumber,
  H2_RHF_TRUSTED_CANONICALIZATION_VECTORS_SHA256,
  H2_RHF_TRUSTED_GENERATOR_SHA256,
  H2_RHF_TRUSTED_SWIFT_SOURCE_SHA256,
  H2_RHF_MODEL_TUPLE,
  hashH2RHFBody,
  replayH2RHF,
  validateH2RHFCassette,
} from "../src/h2-rhf.ts";
import { H2_RHF_CASSETTE } from "../../../src/lib/h2-rhf-cassette.generated.ts";

test("the bundled H2 cassette exposes the declared model and verified payload", () => {
  assert.equal(H2_RHF_CASSETTE.model, H2_RHF_MODEL_TUPLE.model);
  assert.equal(H2_RHF_CASSETTE.nodes.length, 25);
  assert.equal(H2_RHF_CASSETTE.envelope.minAngstrom, 0.6);
  assert.equal(H2_RHF_CASSETTE.envelope.maxAngstrom, 1.2);
  assert.equal(H2_RHF_CASSETTE.envelope.spacingAngstrom, 0.025);
  assert.equal(validateH2RHFCassette(H2_RHF_CASSETTE).ok, true);
  assert.equal(H2_RHF_CASSETTE.payloadSha256, hashH2RHFBody(H2_RHF_CASSETTE));
});

test("cassette validation fails closed on payload and model drift", () => {
  const payloadDrift = structuredClone(H2_RHF_CASSETTE) as unknown as { nodes: Array<{ enuc: number }> };
  payloadDrift.nodes[0].enuc += 1e-8;
  assert.equal(validateH2RHFCassette(payloadDrift).ok, false);

  const modelDrift = structuredClone(H2_RHF_CASSETTE) as unknown as { modelVersion: string };
  modelDrift.modelVersion = "unsupported-model";
  assert.equal(validateH2RHFCassette(modelDrift).ok, false);

  const fabricated = structuredClone(H2_RHF_CASSETTE) as any;
  fabricated.nodes[6].referenceEnergy += 0.000001;
  fabricated.payloadSha256 = hashH2RHFBody(fabricated);
  assert.equal(validateH2RHFCassette(fabricated).ok, false, "recomputing a digest cannot authorize a fabricated scientific payload");

  const unreviewedToolchain = structuredClone(H2_RHF_CASSETTE) as any;
  unreviewedToolchain.provenance.blas = "unknown-blas";
  unreviewedToolchain.payloadSha256 = hashH2RHFBody(unreviewedToolchain);
  assert.equal(validateH2RHFCassette(unreviewedToolchain).ok, false, "recomputing a digest cannot authorize an unreviewed toolchain");
});

test("cassette validation fails closed on malformed structure and unsupported versions", () => {
  const unsupportedVersion = structuredClone(H2_RHF_CASSETTE) as unknown as { cassetteVersion: number };
  unsupportedVersion.cassetteVersion = 2;
  assert.equal(validateH2RHFCassette(unsupportedVersion).ok, false);

  const malformed = structuredClone(H2_RHF_CASSETTE) as unknown as { nodes: Array<{ overlap: number[] }> };
  malformed.nodes[0].overlap = [Number.NaN, ...malformed.nodes[0].overlap.slice(1)];
  assert.doesNotThrow(() => validateH2RHFCassette(malformed));
  assert.equal(validateH2RHFCassette(malformed).ok, false);

  const unsupportedField = structuredClone(H2_RHF_CASSETTE) as unknown as { units: Record<string, unknown> };
  unsupportedField.units.extra = "unsupported";
  assert.equal(validateH2RHFCassette(unsupportedField).ok, false);
});

test("replay requires bounded convergence and two consecutive gate ticks", () => {
  const node = H2_RHF_CASSETTE.nodes[6];
  const replay = replayH2RHF(node);
  assert.equal(replay.converged, true);
  assert.ok(replay.iteration <= H2_RHF_MODEL_TUPLE.solver.maxIterations);
  assert.ok(replay.gateStreak >= H2_RHF_MODEL_TUPLE.solver.consecutiveGateTicks);
  const oneTickBudget = replayH2RHF(node, { ...H2_RHF_MODEL_TUPLE.solver, maxIterations: 1 });
  assert.equal(oneTickBudget.converged, false, "max-iteration fallthrough cannot be accepted as convergence");
});

test("chemists ERI order is exercised by an asymmetric synthetic Fock case", () => {
  const density = [1.2, -0.3, 0.4, 0.7];
  const core = [0.1, 0.2, 0.3, 0.4];
  const eri = Array.from({ length: 16 }, (_, index) => {
    const p = Math.floor(index / 8);
    const q = Math.floor(index / 4) % 2;
    const r = Math.floor(index / 2) % 2;
    const s = index % 2;
    return 0.1 + 0.07 * p + 0.011 * q + 0.013 * r + 0.017 * s + 0.001 * p * q + 0.002 * q * r;
  });
  const fock = buildH2RHFFock(density, core, eri);
  assert.deepEqual(fock.map((value) => Number(value.toFixed(12))), [0.21165, 0.401425, 0.401425, 0.5932]);
});

test("generated JSON, TypeScript, and Swift artifacts carry one normalized payload", () => {
  const root = resolve(new URL("../../..", import.meta.url).pathname);
  const json = JSON.parse(readFileSync(resolve(root, "scripts/native/fixtures/h2-rhf-v1.json"), "utf8"));
  const generatorPath = resolve(root, "scripts/native/generate-h2-rhf-cassette.py");
  const vectorsPath = resolve(root, "scripts/native/h2-rhf-canonicalization-vectors.json");
  const swiftPath = resolve(root, "packages/objet-universe-kit/Sources/ObjetUniverseCore/Molecules/H2RHFCassette.generated.swift");
  const swift = readFileSync(resolve(root, "packages/objet-universe-kit/Sources/ObjetUniverseCore/Molecules/H2RHFCassette.generated.swift"), "utf8");
  const sha256File = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");
  assert.deepEqual(H2_RHF_CASSETTE, json);
  assert.equal(sha256File(generatorPath), H2_RHF_TRUSTED_GENERATOR_SHA256, "generator source must match the reviewed source anchor");
  assert.equal(sha256File(swiftPath), H2_RHF_TRUSTED_SWIFT_SOURCE_SHA256, "complete Swift source must match the reviewed artifact anchor");
  assert.equal(sha256File(vectorsPath), H2_RHF_TRUSTED_CANONICALIZATION_VECTORS_SHA256, "canonicalization vectors must match the reviewed anchor");
  assert.match(swift, new RegExp(`payloadSha256 = "${json.payloadSha256}"`));
  assert.match(swift, /public struct Midpoint: Sendable \{[\s\S]*public let separationAngstrom: Double/);
  assert.equal((swift.match(/Node\(separationAngstrom:/g) ?? []).length, json.nodes.length);
  assert.equal((swift.match(/Midpoint\(separationAngstrom:/g) ?? []).length, json.midpoints.length);
  assert.match(swift, /eriNotation: "chemists"/);
  assert.match(swift, new RegExp(`sourceHash: "${json.provenance.sourceHash}"`));
});

test("canonical decimal-12 vectors normalize signed zero and tiny drift", () => {
  const root = resolve(new URL("../../..", import.meta.url).pathname);
  const vectors = JSON.parse(readFileSync(resolve(root, "scripts/native/h2-rhf-canonicalization-vectors.json"), "utf8")) as Array<{ input: string; canonical: string }>;
  for (const vector of vectors) assert.equal(canonicalH2RHFNumber(Number(vector.input)), vector.canonical);
  const swift = readFileSync(resolve(root, "packages/objet-universe-kit/Sources/ObjetUniverseCore/Molecules/H2RHFCassette.generated.swift"), "utf8");
  for (const vector of vectors) assert.match(swift, new RegExp(`\\("${vector.input}", "${vector.canonical}"\\)`));
});

test("verifier rejects a changed generator source without mutating the reviewed file", () => {
  const root = resolve(new URL("../../..", import.meta.url).pathname);
  const temporaryDirectory = mkdtempSync(`${os.tmpdir()}/h2-rhf-generator-`);
  const alteredGeneratorPath = resolve(temporaryDirectory, "generate-h2-rhf-cassette.py");
  const verifierPath = resolve(root, "scripts/native/verify-h2-rhf-cassette.mjs");
  const fixturePath = resolve(root, "scripts/native/fixtures/h2-rhf-v1.json");
  try {
    writeFileSync(alteredGeneratorPath, `${readFileSync(resolve(root, "scripts/native/generate-h2-rhf-cassette.py"), "utf8")}\n# review-seam mutation\n`, "utf8");
    assert.throws(
      () => execFileSync(process.execPath, [verifierPath, `--fixture=${fixturePath}`, `--generator=${alteredGeneratorPath}`], { encoding: "utf8", stdio: "pipe" }),
      /generator source SHA-256 is not the trusted reviewed artifact/,
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
