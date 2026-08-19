# Native evidence schema (U8)

Release 1 promotes each of wave, cell, and solar only when a **complete
evidence bundle** ships for every acceptance example it is responsible for.
This document is the canonical shape of that bundle. `scripts/native/run-
release-evidence.mjs` (U16) will assemble bundles that pass the schema here;
`scripts/native/compare-cross-language-fixtures.mjs` (this unit) uses the
`comparison` policy already recorded on each reference fixture and refuses
to complete a bundle whose scientific comparison silently falls back to
byte equality or wall-clock hashing.

Simulator evidence is deliberately **tagged and non-substitutive**: haptic,
Metal, sensor, energy, and sustained-thermal claims may never rely on a
simulator-only recording (see §Deviation reporting below).

## Bundle envelope

Every evidence bundle is a JSON document with the following top-level keys.
Missing or malformed keys must fail bundle assembly.

```jsonc
{
  "bundleVersion": 1,                    // integer, matches this schema revision
  "generatedAt": "2026-08-19T20:15:00Z", // ISO-8601 UTC, produced by the harness
  "generatorHash": "sha256:…",           // hash of run-release-evidence.mjs at write time
  "run": {
    "seed": "<opaque string>",           // same string embedded in every scenario trace below
    "modelVersions": {                   // one row per scene invoked in the run
      "wave":  "v1",
      "cell":  "v1",
      "solar": "v1"
    },
    "contractVersions": {                // frozen at CONTRACT_VERSIONS.native
      "native": 1, "action": 1, "continuousGesture": 1,
      "universe": 1, "history": 1, "scale": 1,
      "simulation": 1, "sceneStyle": 1
    }
  },
  "environment": {                       // runtime and device provenance
    "kind": "device" | "simulator",
    "device": {                          // required; see §Device metadata
      "modelIdentifier": "iPhone17,1",
      "productMarketingName": "iPhone 17 Pro",
      "systemName": "iOS",
      "systemVersion": "18.4.1",
      "cpuArchitecture": "arm64",
      "gpuFamily": "Apple9",
      "screenScale": 3,
      "screenPointSize": { "width": 402, "height": 874 }
    },
    "process": {
      "bundleIdentifier": "co.objetdart.native",
      "buildConfiguration": "Debug" | "Release",
      "commitSha": "<short sha>",
      "branch": "<git branch>"
    }
  },
  "scenarios": [                          // one entry per acceptance example
    { "id": "AE1-wave-conservation", "scene": "wave", "trace": { … }, "signposts": [ … ], "comparison": { … }, "performance": { … } }
  ],
  "deviations": [                         // see §Deviation reporting
    { "id": "…", "reason": "simulator-only-metric", "path": "scenarios[3].performance.hitchRate" }
  ]
}
```

The bundle is **complete** when:

- every acceptance example ID declared in `docs/native/post-validation-
  horizon.md` for the shipping release appears exactly once in `scenarios`,
- every `scenarios[i].comparison.result` is `"pass"`,
- no `deviations[]` entry has `severity: "block"`.

## Device metadata (required)

`environment.device` must include exactly the fields shown. Unknown or
missing fields fail the schema — the release gate cannot approve haptic,
Metal, sensor, energy, or thermal claims from Simulator data, and the
device row is the only place we distinguish that.

- `modelIdentifier` — Apple's `hw.model` (`iPhone17,1`, `iPad14,3`, etc.)
- `productMarketingName` — the human-readable label (`iPhone 17 Pro`)
- `systemName` — `iOS` or `iPadOS`
- `systemVersion` — full triple, e.g. `18.4.1`
- `cpuArchitecture` — `arm64` for all supported hardware
- `gpuFamily` — Metal `MTLGPUFamily` string (`Apple8`, `Apple9`, …)
- `screenScale` — points→pixels multiplier
- `screenPointSize` — logical viewport at scenario start

If `kind == "simulator"`, `device` must still report Apple's simulated
model identifier, and every performance/haptic/sensor/energy/thermal
metric attached to that bundle **must** be flagged as
`severity: "block"` inside `deviations` unless the scenario explicitly
declares itself simulator-safe.

## Scenario trace

Each entry inside `scenarios[]` embeds a deterministic timestamped trace
that the Swift `ScenarioTrace` struct produces. The TypeScript comparator
never invents its own trace shape; it consumes exactly this envelope:

```jsonc
{
  "id": "AE1-wave-conservation",
  "scene": "wave",
  "actorLabel": "cold-visitor-1",
  "trace": {
    "traceVersion": 1,                    // ScenarioTrace.traceVersion
    "seed": "…",                          // repeats run.seed
    "modelVersion": "v1",
    "startedAtLogicalTick": 0,
    "endedAtLogicalTick": 12345,
    "presentationHz": 60,
    "actions": [
      {
        "ordinal": 0,                     // stable within trace
        "atMs": 12.5,                     // wall-clock intent, quantized to 1/1000
        "logicalTick": 2,                 // clock's rounded assignment
        "action": {                       // exactly VersionedAction — no renderer keys
          "version": 1,
          "id": "…",
          "logicalTime": { "tick": 2, "ordinal": 0 },
          "action": { "verb": "material", "layer": "material", "source": "touch", "intensity": 0.8, "payload": { "x": 0.5, "y": 0.5 } }
        }
      }
    ],
    "checkpoints": [
      { "id": "…", "branchId": "root", "logicalTime": { "tick": 12345, "ordinal": 0 }, "modelVersion": "v1", "stateDigest": "sha256:…" }
    ],
    "canonicalStateDigest": "sha256:…"    // final state, sha256 of stable serialization
  },
  "signposts": [ … ],                     // see §Signposts
  "comparison": { … },                    // see §Comparison policy
  "performance": { … }                    // see §Performance metrics
}
```

The trace envelope MUST NOT contain any of `renderer|render|canvas|
frame|pixel|shader|gpu|webgl|metal|drawableTexture` outside signposts
(same regex `packages/universe-contracts/src/actions.ts::isVersionedAction`
already enforces).

## Signposts

Every scenario emits a shared, bounded signpost stream. Signposts are
distinct from `HostBoundary` markers because they carry a timestamp,
tick, optional payload, and are meant to be diffed across runs.

Signpost `kind` values (one row per kind per event):

| kind                     | when it fires                                                          | required payload                                       |
| ------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| `actionPreviewed`        | UI has staged the action before durability                             | `{ actionId }`                                         |
| `actionDurablyAppended`  | Durable write-ahead store returned success                             | `{ actionId, storeVersion }`                           |
| `authoritativelyApplied` | Kernel `apply(_:)` returned                                            | `{ actionId, kernelTick }`                             |
| `checkpointPromoted`     | Checkpoint became the new stable point                                 | `{ checkpointId, digestPrefix }`                       |
| `uiAcknowledged`         | React received the coarse projection derived from that tick            | `{ actionId, bridgeLatencyMs }`                        |
| `audioScheduled`         | AudioBus scheduled envelope for a specific event                       | `{ actionId, onsetMs, energy }`                        |
| `hapticEmitted`          | HapticBus fired the pattern                                            | `{ actionId, kind, intensity }`                        |
| `sensoryConfirmed`       | Sensory buses have both acknowledged the same event id                 | `{ actionId }`                                         |
| `outputQuarantined`      | Kernel returned unstable / mismatched scene                            | `{ reason }`                                           |
| `bridgeCrossed`          | React↔native crossing observed (either direction)                     | `{ direction, payloadBytes }`                          |
| `memorySnapshot`         | Peak-since-last-snapshot memory sampled                                | `{ residentMB, peakMB }`                               |
| `energySnapshot`         | `ProcessInfo.thermalState` + PMU frame captured                        | `{ thermal, cpuMs, gpuMs, batteryPercent, deltaMWh }`  |
| `thermalState`           | Thermal state edge crossing                                            | `{ state }`                                            |

Signposts are timestamped by `logicalTick` + monotonic wall-clock delta
in µs. The stream is bounded per scenario to the same 64-entry ring the
`UniverseHost.boundaries` uses; overflow is reported once and dropped.

## Comparison policy

`scenarios[i].comparison` is the machine-verifiable comparison that
promoted the scenario from `pending` to `pass`. It is derived from the
per-scene fixture's `comparison` field and never overridden at the bundle
layer:

- **Absolute policy** (wave, solar):
  ```jsonc
  { "kind": "absolute", "tolerance": 1e-9,
    "result": "pass", "worstDeltaAbs": 3.42e-11,
    "referenceFixture": "scripts/native/fixtures/wave-reference.json" }
  ```
- **Mixed policy** (cell):
  ```jsonc
  { "kind": "mixed",
    "exact": { "kind": "exact", "paths": [ "seed", … ] },
    "floats": { "kind": "relative", "relativeTolerance": 1e-9, "absoluteTolerance": 1e-12 },
    "result": "pass",
    "worstRelative": 6.1e-10, "worstAbsolute": 8.3e-14,
    "referenceFixture": "scripts/native/fixtures/cell-reference.json" }
  ```

`compare-cross-language-fixtures.mjs` (this unit) validates this shape
against `packages/universe-contracts/src/simulation.ts` ReferenceCase
policies. A shader or solver change that improves appearance while
violating the fixture must produce `result: "fail"`.

## Performance metrics

`scenarios[i].performance` captures the coarse budget compliance during
the scenario. All timings are milliseconds unless stated otherwise.

```jsonc
{
  "targetHz": 60,                           // 60 for target tier, 30 for baseline
  "sustainedHz": 59.4,                       // measured p50 over scenario body
  "hitchRatePer60s": 1.2,                    // hitches / minute
  "meanFrameMs": 16.6, "p99FrameMs": 22.1,
  "inputLatencyMs": { "p50": 12, "p99": 34 },
  "sensorySkewMsBudget": 8, "sensorySkewMsWorst": 3.7,
  "memoryResidentPeakMB": 187,
  "checkpointWriteMsBudget": 12, "checkpointWriteMsWorst": 7.8,
  "thermalMaxState": "fair",
  "thermalRecoveryMs": 4200,
  "durationSeconds": 1800
}
```

## Deviation reporting

Any measurement that the harness cannot honestly attest to (for example,
haptic timing captured only in Simulator, or a benchmark aborted early
by the OS) is enumerated in `deviations[]`. Each deviation has:

- `id` — machine-readable label (`simulator-only-haptic`, `thermal-early-exit`, …)
- `reason` — human-readable explanation
- `path` — JSON pointer into the bundle where the affected value lives
- `severity` — `"block"` if the release cannot ship with this deviation, `"note"` otherwise

`block` deviations force `bundle.status = "incomplete"`. A release
cannot progress with any `block` deviation open.

## Referenced fixtures

The comparator reads reference-fixture files verbatim from disk. Their
identity policy (below, produced by `scripts/native/generate-reference-
fixtures.mjs`) is authoritative:

- `scripts/native/fixtures/wave-reference.json` — `{ kind: "absolute", tolerance: 1e-9 }`
- `scripts/native/fixtures/cell-reference.json` — `{ kind: "mixed", exact: { … }, floats: { kind: "relative", relativeTolerance: 1e-9, absoluteTolerance: 1e-12 } }`
- `scripts/native/fixtures/solar-reference.json` — `{ kind: "absolute", tolerance: 1e-9 }`

## Bro

Every recording we ship is one JSON with the same skeleton: which device
it ran on, what actions and clock ticks happened, whether the numbers
match the fixture, and how the phone actually behaved for those 30 minutes.
If any of those parts is missing or fudged, the bundle refuses to ship.
