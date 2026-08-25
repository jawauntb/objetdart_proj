/**
 * The bounded H₂ scientific contract shared by the web reference authority
 * and the native cassette representation.
 *
 * This is intentionally a small, renderer-free model declaration.  The
 * cassette is generated offline by PySCF and imported by each runtime; this
 * module owns the shape, canonical digest, and fail-closed structural checks.
 */

export const H2_RHF_MODEL_TUPLE = {
  model: "RHF/STO-3G",
  modelVersion: "h2-rhf-sto-3g-v1",
  species: "H2",
  charge: 0,
  multiplicity: 1,
  basis: "STO-3G",
  envelope: {
    minAngstrom: 0.6,
    maxAngstrom: 1.2,
    spacingAngstrom: 0.025,
    nodeCount: 25,
  },
  solver: {
    damping: 0.5,
    logicalHz: 20,
    maxIterations: 64,
    densityTolerance: 0.0005,
    energyTolerance: 0.00005,
    electronCountTolerance: 0.00000001,
    fixedPointDensityTolerance: 0.0000000001,
    fixedPointEnergyTolerance: 0.0000000001,
    consecutiveGateTicks: 2,
  },
  interpolation: {
    matrices: "quadratic-three-node",
    nuclearRepulsion: "exact-coulomb-from-separation",
  },
  bohrPerAngstrom: 1.8897261246257702,
  quantizationVersion: "decimal-12",
  traceVersion: 1,
} as const;

export type H2RHFModelTuple = typeof H2_RHF_MODEL_TUPLE;

export type H2RHFMatrix = readonly number[];

export type H2RHFNode = {
  readonly separationAngstrom: number;
  /** Row-major AO matrix in the declared two-AO order. */
  readonly overlap: H2RHFMatrix;
  /** Row-major one-electron core Hamiltonian. */
  readonly core: H2RHFMatrix;
  /** Row-major (mu,nu,lambda,sigma) electron-repulsion tensor. */
  readonly eri: H2RHFMatrix;
  readonly enuc: number;
  readonly referenceDensity: H2RHFMatrix;
  readonly referenceEnergy: number;
  readonly referenceElectronCount: number;
};

export type H2RHFMidpoint = H2RHFNode & {
  readonly leftNode: number;
  readonly rightNode: number;
  readonly densityError: number;
  readonly energyError: number;
  readonly electronCountError: number;
};

export type H2RHFProvenance = {
  readonly generator: string;
  readonly python: string;
  readonly pyscf: string;
  readonly numpy: string;
  readonly scipy: string;
  readonly blas: string;
  readonly sourceIds: readonly string[];
};

export type H2RHFCassette = {
  readonly cassetteVersion: 1;
  readonly model: H2RHFModelTuple["model"];
  readonly modelVersion: H2RHFModelTuple["modelVersion"];
  readonly modelTuple: H2RHFModelTuple;
  readonly units: {
    readonly distance: "angstrom";
    readonly energy: "hartree";
    readonly density: "AO density matrix (dimensionless coefficients)";
  };
  readonly aoConvention: {
    readonly labels: readonly [string, string];
    readonly axis: "z";
    readonly matrixOrder: "row-major";
    readonly eriOrder: readonly ["mu", "nu", "lambda", "sigma"];
    readonly occupiedOrbitals: 1;
    readonly electronCount: 2;
  };
  readonly envelope: H2RHFModelTuple["envelope"];
  readonly solver: H2RHFModelTuple["solver"];
  readonly provenance: H2RHFProvenance;
  readonly comparison: {
    readonly densityMatrixMaxAbs: 0.0005;
    readonly totalEnergyMaxAbs: 0.00005;
    readonly electronCountMaxAbs: 0.00000001;
  };
  readonly oracle: {
    readonly nodeReplayMaxDensityError: number;
    readonly nodeReplayMaxEnergyError: number;
    readonly nodeReplayMaxElectronCountError: number;
    readonly midpointMaxDensityError: number;
    readonly midpointMaxEnergyError: number;
    readonly midpointMaxElectronCountError: number;
  };
  readonly nodes: readonly H2RHFNode[];
  /** Independent PySCF checks at the 24 adjacent-node midpoints. */
  readonly midpoints: readonly H2RHFMidpoint[];
  readonly payloadSha256: string;
};

export type H2RHFValidation =
  | { readonly ok: true; readonly errors: readonly [] }
  | { readonly ok: false; readonly errors: readonly string[] };

const MODEL_KEYS = Object.keys(H2_RHF_MODEL_TUPLE) as Array<keyof H2RHFModelTuple>;

const EXPECTED_UNITS = {
  distance: "angstrom",
  energy: "hartree",
  density: "AO density matrix (dimensionless coefficients)",
} as const;

const EXPECTED_AO_CONVENTION = {
  labels: ["0 H 1s", "1 H 1s"],
  axis: "z",
  matrixOrder: "row-major",
  eriOrder: ["mu", "nu", "lambda", "sigma"],
  occupiedOrbitals: 1,
  electronCount: 2,
} as const;

const EXPECTED_COMPARISON = {
  densityMatrixMaxAbs: H2_RHF_MODEL_TUPLE.solver.densityTolerance,
  totalEnergyMaxAbs: H2_RHF_MODEL_TUPLE.solver.energyTolerance,
  electronCountMaxAbs: H2_RHF_MODEL_TUPLE.solver.electronCountTolerance,
} as const;

const EXPECTED_CASSETTE_KEYS = [
  "cassetteVersion",
  "model",
  "modelVersion",
  "modelTuple",
  "units",
  "aoConvention",
  "envelope",
  "solver",
  "provenance",
  "comparison",
  "oracle",
  "nodes",
  "midpoints",
  "payloadSha256",
].sort();

const EXPECTED_NODE_KEYS = [
  "separationAngstrom",
  "overlap",
  "core",
  "eri",
  "enuc",
  "referenceDensity",
  "referenceEnergy",
  "referenceElectronCount",
].sort();

const EXPECTED_MIDPOINT_KEYS = [
  ...EXPECTED_NODE_KEYS,
  "leftNode",
  "rightNode",
  "densityError",
  "energyError",
  "electronCountError",
].sort();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) throw new TypeError("H2 RHF digest cannot encode NaN or Infinity");
  if (Object.is(value, -0)) return "0";
  // The generator rounds every numeric leaf to 12 decimal places.  Keeping
  // that rule in the digest makes Python, JavaScript, and Swift agree without
  // relying on each language's exponent formatting.
  const fixed = value.toFixed(12);
  const trimmed = fixed.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "-0" || trimmed === "" ? "0" : trimmed;
}

/** Canonical JSON used for the payload hash; object keys are lexical. */
export function canonicalH2RHFJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") return canonicalNumber(value);
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalH2RHFJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalH2RHFJson(value[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("H2 RHF digest received an unsupported value");
}

function bodyWithoutDigest(value: H2RHFCassette): Omit<H2RHFCassette, "payloadSha256"> {
  const { payloadSha256: _payloadSha256, ...body } = value;
  return body;
}

// SHA-256 is kept local and synchronous so cassette verification can happen
// once at authority construction without importing a Node-only crypto API.
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  const paddedLength = ((bytes.length + 9 + 63) >> 6) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const lengthOffset = padded.length - 8;
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  padded[lengthOffset] = (high >>> 24) & 0xff;
  padded[lengthOffset + 1] = (high >>> 16) & 0xff;
  padded[lengthOffset + 2] = (high >>> 8) & 0xff;
  padded[lengthOffset + 3] = high & 0xff;
  padded[lengthOffset + 4] = (low >>> 24) & 0xff;
  padded[lengthOffset + 5] = (low >>> 16) & 0xff;
  padded[lengthOffset + 6] = (low >>> 8) & 0xff;
  padded[lengthOffset + 7] = low & 0xff;

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const schedule = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      const p = offset + i * 4;
      schedule[i] = ((padded[p] << 24) | (padded[p + 1] << 16) | (padded[p + 2] << 8) | padded[p + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const value1 = rotateRight(schedule[i - 15], 7) ^ rotateRight(schedule[i - 15], 18) ^ (schedule[i - 15] >>> 3);
      const value2 = rotateRight(schedule[i - 2], 17) ^ rotateRight(schedule[i - 2], 19) ^ (schedule[i - 2] >>> 10);
      schedule[i] = (schedule[i - 16] + value1 + schedule[i - 7] + value2) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i++) {
      const bigSigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + bigSigma1 + choose + SHA256_K[i] + schedule[i]) >>> 0;
      const bigSigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (bigSigma0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((word) => word.toString(16).padStart(8, "0")).join("");
}

export function hashH2RHFBody(value: H2RHFCassette): string {
  return sha256Hex(canonicalH2RHFJson(bodyWithoutDigest(value)));
}

function sameModelTuple(candidate: unknown): boolean {
  if (!isRecord(candidate)) return false;
  if (JSON.stringify(Object.keys(candidate).sort()) !== JSON.stringify(MODEL_KEYS.slice().sort())) return false;
  for (const key of MODEL_KEYS) {
    if (!(key in candidate)) return false;
    try {
      if (canonicalH2RHFJson(candidate[key]) !== canonicalH2RHFJson(H2_RHF_MODEL_TUPLE[key])) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function checkMatrix(value: unknown, length: number, label: string, errors: string[]): value is H2RHFMatrix {
  if (!Array.isArray(value) || value.length !== length || value.some((item) => !finiteNumber(item))) {
    errors.push(`${label} must contain ${length} finite values`);
    return false;
  }
  return true;
}

function checkNode(value: unknown, label: string, errors: string[], midpoint = false): value is H2RHFNode {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return false;
  }
  const expectedKeys = midpoint ? EXPECTED_MIDPOINT_KEYS : EXPECTED_NODE_KEYS;
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys)) errors.push(`${label} contains unsupported fields`);
  if (!finiteNumber(value.separationAngstrom)) errors.push(`${label}.separationAngstrom must be finite`);
  checkMatrix(value.overlap, 4, `${label}.overlap`, errors);
  checkMatrix(value.core, 4, `${label}.core`, errors);
  checkMatrix(value.eri, 16, `${label}.eri`, errors);
  checkMatrix(value.referenceDensity, 4, `${label}.referenceDensity`, errors);
  for (const key of ["enuc", "referenceEnergy", "referenceElectronCount"] as const) {
    if (!finiteNumber(value[key])) errors.push(`${label}.${key} must be finite`);
  }
  return errors.length === 0;
}

function checkExact(value: unknown, expected: unknown, label: string, errors: string[]): void {
  try {
    if (canonicalH2RHFJson(value) !== canonicalH2RHFJson(expected)) errors.push(`${label} drifted`);
  } catch {
    errors.push(`${label} drifted`);
  }
}

function checkNonnegativeFinite(value: unknown, label: string, errors: string[]): void {
  if (!finiteNumber(value) || value < 0) errors.push(`${label} must be a non-negative finite number`);
}

function checkEnvelopeAndOrdering(value: unknown, label: string, errors: string[], allowMidpoint = false): void {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return;
  }
  if (!finiteNumber(value.separationAngstrom)) return;
  const min = H2_RHF_MODEL_TUPLE.envelope.minAngstrom;
  const max = H2_RHF_MODEL_TUPLE.envelope.maxAngstrom;
  const spacing = H2_RHF_MODEL_TUPLE.envelope.spacingAngstrom;
  const ratio = (value.separationAngstrom - min) / spacing;
  const index = Math.round(ratio);
  const isNode = Math.abs(ratio - index) <= 1e-10 && index >= 0 && index <= H2_RHF_MODEL_TUPLE.envelope.nodeCount - 1;
  const midpointIndex = Math.floor(ratio);
  const isMidpoint = allowMidpoint && Math.abs(ratio - (midpointIndex + 0.5)) <= 1e-10 && midpointIndex >= 0 && midpointIndex < H2_RHF_MODEL_TUPLE.envelope.nodeCount - 1;
  if (!isNode && !isMidpoint) {
    errors.push(`${label}.separationAngstrom is outside the canonical envelope`);
  }
}

/** Validate a cassette and its digest before it can enter an authority. */
export function validateH2RHFCassette(value: unknown): H2RHFValidation {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["cassette must be an object"] };
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(EXPECTED_CASSETTE_KEYS)) errors.push("cassette contains unsupported fields");
  if (value.cassetteVersion !== 1) errors.push("unsupported cassette version");
  if (value.model !== H2_RHF_MODEL_TUPLE.model) errors.push("unsupported model");
  if (value.modelVersion !== H2_RHF_MODEL_TUPLE.modelVersion) errors.push("unsupported model version");
  if (!sameModelTuple(value.modelTuple)) errors.push("model tuple drifted");
  checkExact(value.envelope, H2_RHF_MODEL_TUPLE.envelope, "envelope", errors);
  checkExact(value.solver, H2_RHF_MODEL_TUPLE.solver, "solver", errors);
  checkExact(value.units, EXPECTED_UNITS, "units", errors);
  checkExact(value.aoConvention, EXPECTED_AO_CONVENTION, "AO convention", errors);
  checkExact(value.comparison, EXPECTED_COMPARISON, "comparison policy", errors);
  if (!isRecord(value.provenance)) {
    errors.push("provenance must be an object");
  } else {
    for (const key of ["generator", "python", "pyscf", "numpy", "scipy", "blas"] as const) {
      if (typeof value.provenance[key] !== "string" || value.provenance[key].length === 0) errors.push(`provenance.${key} must be a non-empty string`);
    }
    if (!Array.isArray(value.provenance.sourceIds) || value.provenance.sourceIds.length === 0 || value.provenance.sourceIds.some((id) => typeof id !== "string" || id.length === 0)) {
      errors.push("provenance.sourceIds must contain non-empty strings");
    }
    if (value.provenance.pyscf !== "2.6.2") errors.push("unsupported PySCF provenance");
  }
  if (!isRecord(value.oracle)) {
    errors.push("oracle must be an object");
  } else {
    for (const key of [
      "nodeReplayMaxDensityError",
      "nodeReplayMaxEnergyError",
      "nodeReplayMaxElectronCountError",
      "midpointMaxDensityError",
      "midpointMaxEnergyError",
      "midpointMaxElectronCountError",
    ] as const) checkNonnegativeFinite(value.oracle[key], `oracle.${key}`, errors);
    if (finiteNumber(value.oracle.nodeReplayMaxDensityError) && value.oracle.nodeReplayMaxDensityError > EXPECTED_COMPARISON.densityMatrixMaxAbs) errors.push("node density oracle exceeds ceiling");
    if (finiteNumber(value.oracle.nodeReplayMaxEnergyError) && value.oracle.nodeReplayMaxEnergyError > EXPECTED_COMPARISON.totalEnergyMaxAbs) errors.push("node energy oracle exceeds ceiling");
    if (finiteNumber(value.oracle.nodeReplayMaxElectronCountError) && value.oracle.nodeReplayMaxElectronCountError > EXPECTED_COMPARISON.electronCountMaxAbs) errors.push("node electron-count oracle exceeds ceiling");
    if (finiteNumber(value.oracle.midpointMaxDensityError) && value.oracle.midpointMaxDensityError > EXPECTED_COMPARISON.densityMatrixMaxAbs) errors.push("midpoint density oracle exceeds ceiling");
    if (finiteNumber(value.oracle.midpointMaxEnergyError) && value.oracle.midpointMaxEnergyError > EXPECTED_COMPARISON.totalEnergyMaxAbs) errors.push("midpoint energy oracle exceeds ceiling");
    if (finiteNumber(value.oracle.midpointMaxElectronCountError) && value.oracle.midpointMaxElectronCountError > EXPECTED_COMPARISON.electronCountMaxAbs) errors.push("midpoint electron-count oracle exceeds ceiling");
  }
  if (!Array.isArray(value.nodes) || value.nodes.length !== 25) errors.push("cassette must contain 25 nodes");
  if (!Array.isArray(value.midpoints) || value.midpoints.length !== 24) errors.push("cassette must contain 24 midpoint checks");
  if (Array.isArray(value.nodes)) {
    value.nodes.forEach((node, index) => {
      checkNode(node, `nodes[${index}]`, errors);
      checkEnvelopeAndOrdering(node, `nodes[${index}]`, errors);
      if (isRecord(node) && finiteNumber(node.referenceElectronCount) && Math.abs(node.referenceElectronCount - 2) > EXPECTED_COMPARISON.electronCountMaxAbs) errors.push(`nodes[${index}].referenceElectronCount is not two electrons`);
    });
  }
  if (Array.isArray(value.midpoints)) {
    value.midpoints.forEach((node, index) => {
      checkNode(node, `midpoints[${index}]`, errors, true);
      checkEnvelopeAndOrdering(node, `midpoints[${index}]`, errors, true);
      if (!isRecord(node)) return;
      if (JSON.stringify(Object.keys(node).sort()) !== JSON.stringify(EXPECTED_MIDPOINT_KEYS)) errors.push(`midpoints[${index}] contains unsupported fields`);
      for (const key of ["leftNode", "rightNode"] as const) {
        if (!Number.isInteger(node[key])) errors.push(`midpoints[${index}].${key} must be an integer`);
      }
      if (node.leftNode !== index || node.rightNode !== index + 1) errors.push(`midpoints[${index}] must join adjacent nodes`);
      for (const key of ["densityError", "energyError", "electronCountError"] as const) {
        checkNonnegativeFinite(node[key], `midpoints[${index}].${key}`, errors);
      }
      if (finiteNumber(node.densityError) && node.densityError > EXPECTED_COMPARISON.densityMatrixMaxAbs) errors.push(`midpoints[${index}].densityError exceeds ceiling`);
      if (finiteNumber(node.energyError) && node.energyError > EXPECTED_COMPARISON.totalEnergyMaxAbs) errors.push(`midpoints[${index}].energyError exceeds ceiling`);
      if (finiteNumber(node.electronCountError) && node.electronCountError > EXPECTED_COMPARISON.electronCountMaxAbs) errors.push(`midpoints[${index}].electronCountError exceeds ceiling`);
    });
  }
  if (typeof value.payloadSha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.payloadSha256)) {
    errors.push("payloadSha256 must be a lowercase SHA-256 digest");
  } else if (errors.length === 0) {
    const expected = hashH2RHFBody(value as unknown as H2RHFCassette);
    if (expected !== value.payloadSha256) errors.push("payload SHA-256 does not match canonical body");
  }
  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}
