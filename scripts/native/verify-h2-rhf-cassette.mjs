#!/usr/bin/env node
/**
 * Verify the bounded H2 RHF cassette without importing the generator or any
 * runtime authority.  This is intentionally renderer-free and fail-closed.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(new URL("../..", import.meta.url).pathname);
const PYSCF_VERSION = "2.6.2";
const BOHR_PER_ANGSTROM = 1.8897261246257702;
const ENVELOPE = { minAngstrom: 0.6, maxAngstrom: 1.2, spacingAngstrom: 0.025, nodeCount: 25 };
const SOLVER = {
  damping: 0.5,
  logicalHz: 20,
  maxIterations: 64,
  densityTolerance: 0.0005,
  energyTolerance: 0.00005,
  electronCountTolerance: 0.00000001,
  fixedPointDensityTolerance: 0.0000000001,
  fixedPointEnergyTolerance: 0.0000000001,
  consecutiveGateTicks: 2,
};
const MODEL_TUPLE = {
  model: "RHF/STO-3G",
  modelVersion: "h2-rhf-sto-3g-v1",
  species: "H2",
  charge: 0,
  multiplicity: 1,
  basis: "STO-3G",
  envelope: ENVELOPE,
  solver: SOLVER,
  interpolation: { matrices: "quadratic-three-node", nuclearRepulsion: "exact-coulomb-from-separation" },
  bohrPerAngstrom: BOHR_PER_ANGSTROM,
  quantizationVersion: "decimal-12",
  traceVersion: 1,
};
const UNITS = { distance: "angstrom", energy: "hartree", density: "AO density matrix (dimensionless coefficients)" };
const AO_CONVENTION = {
  labels: ["0 H 1s", "1 H 1s"],
  axis: "z",
  matrixOrder: "row-major",
  eriOrder: ["mu", "nu", "lambda", "sigma"],
  occupiedOrbitals: 1,
  electronCount: 2,
};
const COMPARISON = {
  densityMatrixMaxAbs: SOLVER.densityTolerance,
  totalEnergyMaxAbs: SOLVER.energyTolerance,
  electronCountMaxAbs: SOLVER.electronCountTolerance,
};

function canonicalNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError("canonical JSON cannot encode NaN or Infinity");
  if (Object.is(value, -0) || value === 0) return "0";
  const fixed = value.toFixed(12);
  const trimmed = fixed.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "-0" || trimmed === "" ? "0" : trimmed;
}

function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "number") return canonicalNumber(value);
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new TypeError("canonical JSON received an unsupported value");
}

function hashBody(cassette) {
  const { payloadSha256: _digest, ...body } = cassette;
  return createHash("sha256").update(canonicalJson(body), "utf8").digest("hex");
}

function closeEnough(actual, expected, tolerance = 1e-10) {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function matrix(value, length, label, errors) {
  if (!Array.isArray(value) || value.length !== length || value.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
    errors.push(`${label} must contain ${length} finite values`);
    return null;
  }
  return value;
}

function exact(value, expected, label, errors) {
  try {
    if (canonicalJson(value) !== canonicalJson(expected)) errors.push(`${label} drifted`);
  } catch {
    errors.push(`${label} drifted`);
  }
}

function checkNode(node, label, errors) {
  if (!isRecord(node)) {
    errors.push(`${label} must be an object`);
    return;
  }
  if (typeof node.separationAngstrom !== "number" || !Number.isFinite(node.separationAngstrom)) errors.push(`${label}.separationAngstrom must be finite`);
  matrix(node.overlap, 4, `${label}.overlap`, errors);
  matrix(node.core, 4, `${label}.core`, errors);
  matrix(node.eri, 16, `${label}.eri`, errors);
  matrix(node.referenceDensity, 4, `${label}.referenceDensity`, errors);
  for (const key of ["enuc", "referenceEnergy", "referenceElectronCount"]) {
    if (typeof node[key] !== "number" || !Number.isFinite(node[key])) errors.push(`${label}.${key} must be finite`);
  }
}

function symmetricEigen2(a, b, d) {
  const theta = 0.5 * Math.atan2(2 * b, a - d);
  const cosine = Math.cos(theta);
  const sine = Math.sin(theta);
  const first = [cosine, sine];
  const second = [-sine, cosine];
  const firstValue = first[0] * (a * first[0] + b * first[1]) + first[1] * (b * first[0] + d * first[1]);
  const secondValue = second[0] * (a * second[0] + b * second[1]) + second[1] * (b * second[0] + d * second[1]);
  return firstValue <= secondValue
    ? { values: [firstValue, secondValue], vectors: [first, second] }
    : { values: [secondValue, firstValue], vectors: [second, first] };
}

function inverseSqrt(overlap) {
  const eig = symmetricEigen2(overlap[0], overlap[1], overlap[3]);
  if (eig.values.some((value) => !Number.isFinite(value) || value <= 0)) throw new Error("overlap matrix is not positive definite");
  const [v0, v1] = eig.vectors;
  const w0 = 1 / Math.sqrt(eig.values[0]);
  const w1 = 1 / Math.sqrt(eig.values[1]);
  return [
    w0 * v0[0] * v0[0] + w1 * v1[0] * v1[0],
    w0 * v0[0] * v0[1] + w1 * v1[0] * v1[1],
    w0 * v0[1] * v0[0] + w1 * v1[1] * v1[1],
    w0 * v0[1] * v0[1] + w1 * v1[1] * v1[1],
  ];
}

function multiply2(left, right) {
  return [
    left[0] * right[0] + left[1] * right[2],
    left[0] * right[1] + left[1] * right[3],
    left[2] * right[0] + left[3] * right[2],
    left[2] * right[1] + left[3] * right[3],
  ];
}

function transpose2(matrixValue) {
  return [matrixValue[0], matrixValue[2], matrixValue[1], matrixValue[3]];
}

function buildFock(density, core, eri) {
  const fock = [...core];
  for (let p = 0; p < 2; p += 1) {
    for (let q = 0; q < 2; q += 1) {
      let coulomb = 0;
      let exchange = 0;
      for (let r = 0; r < 2; r += 1) {
        for (let s = 0; s < 2; s += 1) {
          const pqrs = ((p * 2 + q) * 2 + r) * 2 + s;
          const prqs = ((p * 2 + r) * 2 + q) * 2 + s;
          coulomb += density[r * 2 + s] * eri[pqrs];
          exchange += density[r * 2 + s] * eri[prqs];
        }
      }
      fock[p * 2 + q] += coulomb - 0.5 * exchange;
    }
  }
  const offDiagonal = 0.5 * (fock[1] + fock[2]);
  fock[1] = offDiagonal;
  fock[2] = offDiagonal;
  return fock;
}

function densityFromFock(fock, overlap) {
  const orthogonalizer = inverseSqrt(overlap);
  const transformed = multiply2(multiply2(orthogonalizer, fock), orthogonalizer);
  const eig = symmetricEigen2(transformed[0], 0.5 * (transformed[1] + transformed[2]), transformed[3]);
  const orbital = [
    orthogonalizer[0] * eig.vectors[0][0] + orthogonalizer[1] * eig.vectors[0][1],
    orthogonalizer[2] * eig.vectors[0][0] + orthogonalizer[3] * eig.vectors[0][1],
  ];
  return [2 * orbital[0] * orbital[0], 2 * orbital[0] * orbital[1], 2 * orbital[1] * orbital[0], 2 * orbital[1] * orbital[1]];
}

function electronCount(density, overlap) {
  return density[0] * overlap[0] + density[1] * overlap[2] + density[2] * overlap[1] + density[3] * overlap[3];
}

function energy(density, core, eri, enuc) {
  const fock = buildFock(density, core, eri);
  let sum = 0;
  for (let index = 0; index < 4; index += 1) sum += density[index] * (core[index] + fock[index]);
  return 0.5 * sum + enuc;
}

function replay(node) {
  const overlap = node.overlap;
  const core = node.core;
  const eri = node.eri;
  let density = [0, 0, 0, 0];
  let previousEnergy = null;
  let currentEnergy = Number.NaN;
  let countError = Number.NaN;
  for (let iteration = 1; iteration <= SOLVER.maxIterations; iteration += 1) {
    const target = densityFromFock(buildFock(density, core, eri), overlap);
    const mixed = density.map((value, index) => (1 - SOLVER.damping) * value + SOLVER.damping * target[index]);
    currentEnergy = energy(mixed, core, eri, node.enuc);
    const densityDelta = Math.max(...mixed.map((value, index) => Math.abs(value - density[index])));
    const energyDelta = previousEnergy === null ? Number.POSITIVE_INFINITY : Math.abs(currentEnergy - previousEnergy);
    countError = Math.abs(electronCount(mixed, overlap) - 2);
    density = mixed;
    previousEnergy = currentEnergy;
    if (densityDelta <= SOLVER.fixedPointDensityTolerance && energyDelta <= SOLVER.fixedPointEnergyTolerance && countError <= SOLVER.electronCountTolerance) {
      return { density, energy: currentEnergy, countError, iteration };
    }
  }
  return { density, energy: currentEnergy, countError, iteration: SOLVER.maxIterations };
}

function maxAbs(left, right) {
  return Math.max(...left.map((value, index) => Math.abs(value - right[index])));
}

function verify(cassette) {
  const errors = [];
  if (!isRecord(cassette)) return ["cassette must be an object"];
  const expectedTopLevel = ["cassetteVersion", "model", "modelVersion", "modelTuple", "units", "aoConvention", "envelope", "solver", "provenance", "comparison", "oracle", "nodes", "midpoints", "payloadSha256"];
  if (Object.keys(cassette).some((key) => !expectedTopLevel.includes(key))) errors.push("cassette contains unsupported top-level fields");
  if (cassette.cassetteVersion !== 1) errors.push("unsupported cassette version");
  if (cassette.model !== MODEL_TUPLE.model) errors.push("unsupported model");
  if (cassette.modelVersion !== MODEL_TUPLE.modelVersion) errors.push("unsupported model version");
  exact(cassette.modelTuple, MODEL_TUPLE, "model tuple", errors);
  exact(cassette.units, UNITS, "units", errors);
  exact(cassette.aoConvention, AO_CONVENTION, "AO convention", errors);
  exact(cassette.envelope, ENVELOPE, "envelope", errors);
  exact(cassette.solver, SOLVER, "solver", errors);
  exact(cassette.comparison, COMPARISON, "comparison policy", errors);
  if (!isRecord(cassette.provenance)) errors.push("provenance must be an object");
  else {
    for (const key of ["generator", "python", "pyscf", "numpy", "scipy", "blas"]) if (typeof cassette.provenance[key] !== "string" || cassette.provenance[key].length === 0) errors.push(`provenance.${key} must be a non-empty string`);
    if (cassette.provenance.pyscf !== PYSCF_VERSION) errors.push("unsupported PySCF provenance");
    if (!Array.isArray(cassette.provenance.sourceIds) || cassette.provenance.sourceIds.length === 0 || cassette.provenance.sourceIds.some((id) => typeof id !== "string" || id.length === 0)) errors.push("provenance.sourceIds must be non-empty strings");
  }
  if (!isRecord(cassette.oracle)) errors.push("oracle must be an object");
  else for (const key of ["nodeReplayMaxDensityError", "nodeReplayMaxEnergyError", "nodeReplayMaxElectronCountError", "midpointMaxDensityError", "midpointMaxEnergyError", "midpointMaxElectronCountError"]) if (typeof cassette.oracle[key] !== "number" || !Number.isFinite(cassette.oracle[key]) || cassette.oracle[key] < 0) errors.push(`oracle.${key} must be a non-negative finite number`);
  if (!Array.isArray(cassette.nodes) || cassette.nodes.length !== ENVELOPE.nodeCount) errors.push("cassette must contain 25 nodes");
  if (!Array.isArray(cassette.midpoints) || cassette.midpoints.length !== ENVELOPE.nodeCount - 1) errors.push("cassette must contain 24 midpoint checks");
  if (Array.isArray(cassette.nodes)) {
    cassette.nodes.forEach((node, index) => {
      checkNode(node, `nodes[${index}]`, errors);
      if (!isRecord(node) || typeof node.separationAngstrom !== "number") return;
      const expected = ENVELOPE.minAngstrom + index * ENVELOPE.spacingAngstrom;
      if (!closeEnough(node.separationAngstrom, expected)) errors.push(`nodes[${index}] has non-canonical separation`);
      if (Math.abs(node.referenceElectronCount - 2) > SOLVER.electronCountTolerance) errors.push(`nodes[${index}] reference electron count is not two`);
    });
  }
  if (Array.isArray(cassette.midpoints)) cassette.midpoints.forEach((midpoint, index) => {
    checkNode(midpoint, `midpoints[${index}]`, errors);
    if (!isRecord(midpoint)) return;
    if (midpoint.leftNode !== index || midpoint.rightNode !== index + 1) errors.push(`midpoints[${index}] must join adjacent nodes`);
    const expected = ENVELOPE.minAngstrom + (index + 0.5) * ENVELOPE.spacingAngstrom;
    if (!closeEnough(midpoint.separationAngstrom, expected)) errors.push(`midpoints[${index}] has non-canonical separation`);
    for (const key of ["densityError", "energyError", "electronCountError"]) if (typeof midpoint[key] !== "number" || !Number.isFinite(midpoint[key]) || midpoint[key] < 0) errors.push(`midpoints[${index}].${key} must be non-negative and finite`);
  });
  if (typeof cassette.payloadSha256 !== "string" || !/^[0-9a-f]{64}$/.test(cassette.payloadSha256)) errors.push("payloadSha256 must be a lowercase SHA-256 digest");
  if (errors.length > 0) return errors;
  if (hashBody(cassette) !== cassette.payloadSha256) errors.push("payload SHA-256 does not match canonical body");
  let nodeDensityMax = 0;
  let nodeEnergyMax = 0;
  let nodeCountMax = 0;
  for (const node of cassette.nodes) {
    const replayed = replay(node);
    nodeDensityMax = Math.max(nodeDensityMax, maxAbs(replayed.density, node.referenceDensity));
    nodeEnergyMax = Math.max(nodeEnergyMax, Math.abs(replayed.energy - node.referenceEnergy));
    nodeCountMax = Math.max(nodeCountMax, replayed.countError);
  }
  let midpointDensityMax = 0;
  let midpointEnergyMax = 0;
  let midpointCountMax = 0;
  for (let index = 0; index < cassette.midpoints.length; index += 1) {
    const left = cassette.nodes[index];
    const right = cassette.nodes[index + 1];
    const midpoint = cassette.midpoints[index];
    for (const key of ["overlap", "core", "eri"]) {
      const samples = index === 0 ? [cassette.nodes[0], cassette.nodes[1], cassette.nodes[2]] : index === cassette.nodes.length - 2 ? [cassette.nodes[cassette.nodes.length - 3], cassette.nodes[cassette.nodes.length - 2], cassette.nodes[cassette.nodes.length - 1]] : [cassette.nodes[index - 1], left, right];
      const weights = index === 0 ? [0.375, 0.75, -0.125] : [-0.125, 0.75, 0.375];
      const expected = samples[0][key].map((_, entry) => samples.reduce((sum, sample, sampleIndex) => sum + weights[sampleIndex] * sample[key][entry], 0));
      if (maxAbs(midpoint[key], expected) > 1e-10) errors.push(`midpoints[${index}].${key} is not three-node quadratic interpolation`);
    }
    const expectedEnuc = 1 / (BOHR_PER_ANGSTROM * midpoint.separationAngstrom);
    if (!closeEnough(midpoint.enuc, expectedEnuc, 1e-10)) errors.push(`midpoints[${index}].enuc is not the exact Coulomb seam`);
    const replayed = replay(midpoint);
    const densityError = maxAbs(replayed.density, midpoint.referenceDensity);
    const energyError = Math.abs(replayed.energy - midpoint.referenceEnergy);
    midpointDensityMax = Math.max(midpointDensityMax, densityError);
    midpointEnergyMax = Math.max(midpointEnergyMax, energyError);
    midpointCountMax = Math.max(midpointCountMax, replayed.countError);
    if (!closeEnough(midpoint.densityError, densityError, 1e-9)) errors.push(`midpoints[${index}].densityError is stale`);
    if (!closeEnough(midpoint.energyError, energyError, 1e-9)) errors.push(`midpoints[${index}].energyError is stale`);
    if (!closeEnough(midpoint.electronCountError, replayed.countError, 1e-9)) errors.push(`midpoints[${index}].electronCountError is stale`);
  }
  const maxima = {
    nodeReplayMaxDensityError: nodeDensityMax,
    nodeReplayMaxEnergyError: nodeEnergyMax,
    nodeReplayMaxElectronCountError: nodeCountMax,
    midpointMaxDensityError: midpointDensityMax,
    midpointMaxEnergyError: midpointEnergyMax,
    midpointMaxElectronCountError: midpointCountMax,
  };
  for (const [key, actual] of Object.entries(maxima)) {
    if (actual > COMPARISON[key.includes("Density") ? "densityMatrixMaxAbs" : key.includes("Energy") ? "totalEnergyMaxAbs" : "electronCountMaxAbs"] + 1e-9) errors.push(`${key} exceeds comparison ceiling`);
    if (!closeEnough(cassette.oracle[key], actual, 1e-9)) errors.push(`oracle.${key} is stale`);
  }
  return errors;
}

function argumentValue(args, name) {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  return inline?.slice(prefix.length);
}

function main() {
  const args = process.argv.slice(2);
  const fixturePath = resolve(argumentValue(args, "--fixture") ?? `${ROOT}/scripts/native/fixtures/h2-rhf-v1.json`);
  const requestedSeparation = argumentValue(args, "--separation");
  if (requestedSeparation !== undefined) {
    const separation = Number(requestedSeparation);
    if (!Number.isFinite(separation) || separation < ENVELOPE.minAngstrom || separation > ENVELOPE.maxAngstrom) {
      throw new Error("requested separation is outside the inclusive H2 support envelope; no extrapolation is available");
    }
  }
  let cassette;
  try {
    cassette = JSON.parse(readFileSync(fixturePath, "utf8"));
  } catch (error) {
    throw new Error(`cannot read cassette ${fixturePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const errors = verify(cassette);
  if (errors.length > 0) throw new Error(`H2 RHF cassette verification failed:\n- ${errors.join("\n- ")}`);
  console.log(`verified ${fixturePath} payload ${cassette.payloadSha256}`);
  console.log(`nodes=${cassette.nodes.length} midpoints=${cassette.midpoints.length} model=${cassette.model}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
