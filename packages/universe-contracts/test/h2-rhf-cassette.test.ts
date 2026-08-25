import assert from "node:assert/strict";
import test from "node:test";
import {
  H2_RHF_MODEL_TUPLE,
  hashH2RHFBody,
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
