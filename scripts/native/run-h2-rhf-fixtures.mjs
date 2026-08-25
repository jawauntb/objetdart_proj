#!/usr/bin/env node

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { H2_RHF_CASSETTE } = await import(pathToFileURL(path.join(root, "src/lib/h2-rhf-cassette.generated.ts")).href);
const { createH2RHFAuthority, createH2RHFAdapter } = await import(pathToFileURL(path.join(root, "src/lib/h2-rhf.ts")).href);

const argument = (prefix) => process.argv.find((value) => value.startsWith(`${prefix}=`))?.slice(prefix.length + 1);
const inputArgument = argument("--input");
const typescriptArgument = argument("--typescript-out");
const swiftArgument = argument("--swift-out");
const temporaryDirectory = inputArgument ? null : mkdtempSync(path.join(os.tmpdir(), "objet-h2-rhf-fixture-"));
const inputPath = path.resolve(inputArgument ?? path.join(temporaryDirectory, "input.json"));
const typescriptPath = path.resolve(typescriptArgument ?? path.join(temporaryDirectory ?? path.dirname(inputPath), "typescript.json"));
const swiftPath = path.resolve(swiftArgument ?? path.join(temporaryDirectory ?? path.dirname(inputPath), "swift.json"));

function metadata() {
  return {
    fixtureVersion: 1,
    lane: "h2-rhf-cross-language-v1",
    cassetteVersion: H2_RHF_CASSETTE.cassetteVersion,
    model: H2_RHF_CASSETTE.model,
    modelVersion: H2_RHF_CASSETTE.modelVersion,
    cassettePayloadSha256: H2_RHF_CASSETTE.payloadSha256,
    quantizationVersion: H2_RHF_CASSETTE.modelTuple.quantizationVersion,
    traceVersion: H2_RHF_CASSETTE.modelTuple.traceVersion,
    tolerances: H2_RHF_CASSETTE.comparison,
  };
}

function canonicalInput() {
  return {
    metadata: metadata(),
    scenario: "canonical-converged",
    actions: [
      {
        ordinal: 0,
        logicalTick: 0,
        kind: "queue-begin-contact",
        separationAngstrom: 0.9,
        targetId: "stable-h2",
        contactEpoch: 4,
      },
      { ordinal: 1, logicalTick: 0, kind: "queue-release" },
      {
        ordinal: 2,
        logicalTick: H2_RHF_CASSETTE.solver.maxIterations,
        kind: "advance",
        presentationDeltaMs: H2_RHF_CASSETTE.solver.maxIterations * 1000 / H2_RHF_CASSETTE.solver.logicalHz,
      },
    ],
  };
}

if (!inputArgument) writeFileSync(inputPath, `${JSON.stringify(canonicalInput(), null, 2)}\n`);
const input = JSON.parse(readFileSync(inputPath, "utf8"));

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function replayTypeScript() {
  const authority = createH2RHFAuthority();
  const adapter = createH2RHFAdapter(authority, 1000 / H2_RHF_CASSETTE.solver.logicalHz);
  for (const action of input.actions) {
    switch (action.kind) {
      case "queue-begin-contact":
        adapter.queue({ ...action, kind: "begin-contact" });
        break;
      case "queue-release":
        adapter.queue({ kind: "release" });
        break;
      case "advance":
        adapter.advance(action.presentationDeltaMs);
        if (adapter.snapshot().logicalTicks !== action.logicalTick) {
          throw new Error(`fixture action ${action.ordinal} did not land on logical tick ${action.logicalTick}`);
        }
        break;
      default:
        throw new Error(`unknown H2 RHF fixture action ${action.kind}`);
    }
  }
  return {
    metadata: input.metadata,
    scenario: input.scenario,
    actions: input.actions,
    trace: plain(authority.trace()),
    milestones: plain(authority.milestones()),
    snapshot: plain(authority.snapshot()),
    adapter: plain(adapter.snapshot()),
  };
}

const typescript = replayTypeScript();
writeFileSync(typescriptPath, `${JSON.stringify(typescript, null, 2)}\n`);

const swift = spawnSync("swift", ["test", "--package-path", "packages/objet-universe-kit", "--filter", "H2RHFTests"], {
  cwd: root,
  env: {
    ...process.env,
    H2_RHF_FIXTURE_INPUT: inputPath,
    H2_RHF_FIXTURE_OUTPUT: swiftPath,
  },
  stdio: "inherit",
});
if (swift.error) throw swift.error;
if (swift.status !== 0) throw new Error(`swift test exited with status ${swift.status}`);
if (!existsSync(swiftPath)) throw new Error(`Swift fixture test did not write ${swiftPath}`);

const swiftOutput = JSON.parse(readFileSync(swiftPath, "utf8"));
if (swiftOutput.metadata?.cassettePayloadSha256 !== typescript.metadata.cassettePayloadSha256) {
  throw new Error("Swift fixture metadata cassette digest does not match TypeScript");
}
if (swiftOutput.snapshot?.lastGood?.digest !== typescript.snapshot?.lastGood?.digest) {
  throw new Error("Swift fixture last-good checkpoint digest does not match TypeScript");
}

console.log(JSON.stringify({
  input: inputPath,
  typescript: typescriptPath,
  swift: swiftPath,
  scenario: input.scenario,
  cassettePayloadSha256: typescript.metadata.cassettePayloadSha256,
  checkpointDigest: typescript.snapshot.lastGood?.digest ?? null,
}, null, 2));

if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
