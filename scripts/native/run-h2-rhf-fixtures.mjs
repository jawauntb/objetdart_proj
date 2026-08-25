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
const PRESENTATION_DELTA_TOLERANCE_MS = 1e-12;

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
    logicalHz: H2_RHF_CASSETTE.solver.logicalHz,
    tolerances: H2_RHF_CASSETTE.comparison,
  };
}

function options(overrides = {}) {
  return {
    initialSeparationAngstrom: 0.75,
    initialTargetId: "h2-1",
    maxTraceEntries: 128,
    forceMaxIterations: false,
    failNumericallyAtTick: null,
    ...overrides,
  };
}

function contactActions(targetId = "stable-h2", contactEpoch = 4) {
  return [
    {
      ordinal: 0,
      logicalTick: 0,
      kind: "queue-begin-contact",
      separationAngstrom: 0.9,
      targetId,
      contactEpoch,
    },
    { ordinal: 1, logicalTick: 0, kind: "queue-release" },
  ];
}

function advanceAction(ordinal, logicalTick, frameCount, frameCadenceHz) {
  return {
    ordinal,
    logicalTick,
    kind: "advance-frames",
    frameCount,
    presentationDeltaMs: 1000 / frameCadenceHz,
  };
}

function validateScenarioCadence(scenario) {
  if (!Number.isInteger(scenario.frameCadenceHz) || scenario.frameCadenceHz <= 0) {
    throw new Error(`${scenario.scenario}: frameCadenceHz must be a positive integer`);
  }
}

function validateAdvanceAction(scenario, action) {
  validateScenarioCadence(scenario);
  const expected = 1000 / scenario.frameCadenceHz;
  const actual = action.presentationDeltaMs;
  if (!Number.isFinite(expected) || expected <= 0) {
    throw new Error(`${scenario.scenario}: frame cadence produced an invalid presentation delta`);
  }
  if (!Number.isFinite(actual) || actual <= 0) {
    throw new Error(`${scenario.scenario}: action ${action.ordinal} presentationDeltaMs must be finite and positive`);
  }
  if (Math.abs(actual - expected) > PRESENTATION_DELTA_TOLERANCE_MS) {
    throw new Error(`${scenario.scenario}: action ${action.ordinal} presentationDeltaMs ${actual} does not equal 1000/frameCadenceHz ${expected}`);
  }
  if (!Number.isInteger(action.frameCount) || action.frameCount <= 0) {
    throw new Error(`${scenario.scenario}: action ${action.ordinal} frameCount must be a positive integer`);
  }
}

function canonicalInput() {
  const maxIterations = H2_RHF_CASSETTE.solver.maxIterations;
  return {
    metadata: metadata(),
    scenarios: [30, 60, 120].map((frameCadenceHz) => ({
      scenario: `canonical-converged-${frameCadenceHz}`,
      frameCadenceHz,
      options: options(),
      actions: [
        ...contactActions(),
        advanceAction(2, 80, frameCadenceHz * 4, frameCadenceHz),
      ],
    })).concat([
      {
        scenario: "canonical-rebase-60",
        frameCadenceHz: 60,
        options: options(),
        actions: [
          ...contactActions(),
          advanceAction(2, 39, 119, 60),
          { ordinal: 3, logicalTick: 39, kind: "rebase", requireNonZeroAccumulatorBefore: true, expectedAccumulatorAfterMs: 0 },
          advanceAction(4, 80, 123, 60),
        ],
      },
      {
        scenario: "outside-envelope-latch-retry",
        frameCadenceHz: 20,
        options: options(),
        actions: [
          {
            ordinal: 0,
            logicalTick: 0,
            kind: "queue-begin-contact",
            separationAngstrom: H2_RHF_CASSETTE.envelope.minAngstrom - 1e-9,
            targetId: "h2-latch",
            contactEpoch: 10,
          },
          advanceAction(1, 1, 1, 20),
          { ordinal: 2, logicalTick: 1, kind: "queue-request", separationAngstrom: 0.9 },
          advanceAction(3, 2, 1, 20),
          { ordinal: 4, logicalTick: 2, kind: "queue-release" },
          advanceAction(5, 3, 1, 20),
          {
            ordinal: 6,
            logicalTick: 3,
            kind: "queue-begin-contact",
            separationAngstrom: 0.9,
            targetId: "h2-latch",
            contactEpoch: 11,
          },
          advanceAction(7, 4, 1, 20),
          { ordinal: 8, logicalTick: 4, kind: "queue-release" },
          advanceAction(9, 68, maxIterations, 20),
        ],
      },
      {
        scenario: "max-iterations",
        frameCadenceHz: 20,
        options: options({ forceMaxIterations: true }),
        actions: [
          ...contactActions("h2-exhaust", 40),
          advanceAction(2, maxIterations, maxIterations, 20),
        ],
      },
      {
        scenario: "numerical-failure",
        frameCadenceHz: 20,
        options: options({ failNumericallyAtTick: 1 }),
        actions: [
          ...contactActions("h2-fail", 41),
          advanceAction(2, 1, 1, 20),
        ],
      },
    ]),
  };
}

if (!existsSync(inputPath)) writeFileSync(inputPath, `${JSON.stringify(canonicalInput(), null, 2)}\n`);
const input = JSON.parse(readFileSync(inputPath, "utf8"));

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function replayScenario(scenario) {
  validateScenarioCadence(scenario);
  const scenarioOptions = scenario.options ?? {};
  const authority = createH2RHFAuthority({
    initialSeparationAngstrom: scenarioOptions.initialSeparationAngstrom,
    initialTargetId: scenarioOptions.initialTargetId,
    maxTraceEntries: scenarioOptions.maxTraceEntries,
    testSeam: {
      forceMaxIterations: scenarioOptions.forceMaxIterations,
      failNumericallyAtTick: scenarioOptions.failNumericallyAtTick,
    },
  });
  const adapter = createH2RHFAdapter(authority, 1000 / input.metadata.logicalHz);
  for (const action of scenario.actions) {
    switch (action.kind) {
      case "queue-begin-contact":
        adapter.queue({
          kind: "begin-contact",
          separationAngstrom: action.separationAngstrom,
          rawSeparationAngstrom: action.rawSeparationAngstrom,
          targetId: action.targetId,
          contactEpoch: action.contactEpoch,
        });
        break;
      case "queue-request":
        adapter.queue({
          kind: "request",
          separationAngstrom: action.separationAngstrom,
          rawSeparationAngstrom: action.rawSeparationAngstrom,
          targetId: action.targetId,
        });
        break;
      case "queue-release":
        adapter.queue({ kind: "release" });
        break;
      case "queue-cancel":
        adapter.queue({ kind: "cancel" });
        break;
      case "advance-frames":
        validateAdvanceAction(scenario, action);
        for (let frame = 0; frame < action.frameCount; frame += 1) adapter.advance(action.presentationDeltaMs);
        if (adapter.snapshot().logicalTicks !== action.logicalTick) {
          throw new Error(`${scenario.scenario}: action ${action.ordinal} did not land on logical tick ${action.logicalTick}`);
        }
        break;
      case "rebase":
        if (action.requireNonZeroAccumulatorBefore) {
          const before = adapter.snapshot();
          if (!Number.isFinite(before.accumulatorMs) || Math.abs(before.accumulatorMs) <= PRESENTATION_DELTA_TOLERANCE_MS) {
            throw new Error(`${scenario.scenario}: rebase ${action.ordinal} requires a non-zero fractional accumulator before rebase`);
          }
        }
        adapter.rebase();
        if (action.expectedAccumulatorAfterMs !== undefined) {
          const actual = adapter.snapshot().accumulatorMs;
          if (!Number.isFinite(actual) || Math.abs(actual - action.expectedAccumulatorAfterMs) > PRESENTATION_DELTA_TOLERANCE_MS) {
            throw new Error(`${scenario.scenario}: rebase ${action.ordinal} left accumulator ${actual}; expected ${action.expectedAccumulatorAfterMs}`);
          }
        }
        if (adapter.snapshot().logicalTicks !== action.logicalTick) {
          throw new Error(`${scenario.scenario}: rebase ${action.ordinal} changed logical tick unexpectedly`);
        }
        break;
      default:
        throw new Error(`${scenario.scenario}: unknown H2 RHF fixture action ${action.kind}`);
    }
  }
  return {
    scenario: scenario.scenario,
    frameCadenceHz: scenario.frameCadenceHz,
    actions: scenario.actions,
    trace: plain(authority.trace()),
    milestones: plain(authority.milestones()),
    snapshot: plain(authority.snapshot()),
    adapter: plain(adapter.snapshot()),
  };
}

const typescript = {
  metadata: input.metadata,
  scenarios: input.scenarios.map(replayScenario),
};

const canonical60 = typescript.scenarios.find((scenario) => scenario.scenario === "canonical-converged-60");
const rebased60 = typescript.scenarios.find((scenario) => scenario.scenario === "canonical-rebase-60");
if (rebased60) {
  if (!canonical60) throw new Error("canonical-rebase-60 requires canonical-converged-60 for the continuation parity assertion");
  if (rebased60.snapshot.tick !== canonical60.snapshot.tick) {
    throw new Error(`canonical-rebase-60 ended at authority tick ${rebased60.snapshot.tick}; canonical-converged-60 ended at ${canonical60.snapshot.tick}`);
  }
  if (rebased60.snapshot.lastGood?.digest !== canonical60.snapshot.lastGood?.digest) {
    throw new Error("canonical-rebase-60 did not continue to the canonical-60 last-good checkpoint digest");
  }
}
writeFileSync(typescriptPath, `${JSON.stringify(typescript, null, 2)}\n`);

const swift = spawnSync("swift", ["test", "--package-path", "packages/objet-universe-kit", "--filter", "H2RHFFixtureHarnessTests/testFixtureReplayWritesOutput"], {
  cwd: root,
  env: {
    ...process.env,
    H2_RHF_FIXTURE_INPUT: inputPath,
    H2_RHF_FIXTURE_OUTPUT: swiftPath,
    H2_RHF_FIXTURE_REQUIRED: "1",
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
if (swiftOutput.scenarios?.length !== typescript.scenarios.length) {
  throw new Error("Swift fixture scenario count does not match TypeScript");
}
for (let index = 0; index < typescript.scenarios.length; index += 1) {
  if (swiftOutput.scenarios[index]?.snapshot?.lastGood?.digest !== typescript.scenarios[index]?.snapshot?.lastGood?.digest) {
    throw new Error(`Swift fixture last-good checkpoint digest does not match TypeScript for scenario ${typescript.scenarios[index].scenario}`);
  }
}

console.log(JSON.stringify({
  input: inputPath,
  typescript: typescriptPath,
  swift: swiftPath,
  scenarios: input.scenarios.length,
  cassettePayloadSha256: typescript.metadata.cassettePayloadSha256,
  checkpointDigests: typescript.scenarios.map((scenario) => scenario.snapshot.lastGood?.digest ?? null),
}, null, 2));

if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
