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
  // The payload uses the canonical decimal-12 representation.  The
  // Coulomb seam is compared with a tolerance that accounts for this rounded
  // conversion constant (the source measurement used the unrounded value).
  bohrPerAngstrom: 1.889726124626,
  quantizationVersion: "decimal-12",
  traceVersion: 1,
} as const;

/** Numeric payload precision and the propagated Coulomb seam tolerance. */
export const H2_RHF_CANONICAL_DECIMALS = 12 as const;
export const H2_RHF_CANONICAL_TOLERANCE = 0.00000000005 as const;

/** Updated only when the reviewed scientific artifact is intentionally replaced. */
export const H2_RHF_TRUSTED_PAYLOAD_SHA256 = "034a06f55bf15f2ae85dcbf6a3f135c7a83e631a995e4aec5095c35a1417db00" as const;
export const H2_RHF_TRUSTED_GENERATOR_SHA256 = "1aadcc6b7b3718637737f63a29132da7b7733387f4f76278a4ef7fc1a44e74ae" as const;
export const H2_RHF_TRUSTED_SWIFT_SOURCE_SHA256 = "91186c0ebe8f7539b1eacbf57aa7bcfedd53754dd6699472ee3f21b210a58dc9" as const;
export const H2_RHF_TRUSTED_CANONICALIZATION_VECTORS_SHA256 = "bbeef961e925cdf901a1a1bace91eb60b69322a815e18120b33ac07edb118926" as const;
export const H2_RHF_TRUSTED_SENTINEL = Object.freeze({
  separationAngstrom: 0.75,
  enuc: 0.70556961456,
  referenceDensity: [0.604838540352, 0.604838540352, 0.604838540352, 0.604838540352],
  referenceEnergy: -1.116151448939,
  referenceElectronCount: 2,
} as const);

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
  readonly sourceHash: string;
  readonly scf: {
    readonly convTol: number;
    readonly convTolGrad: number;
    readonly maxCycle: number;
    readonly diisSpace: number;
  };
  readonly build: {
    readonly basis: string;
    readonly charge: number;
    readonly spin: number;
    readonly unit: string;
    readonly cart: boolean;
    readonly verbose: number;
    readonly overlapIntegral: string;
    readonly eriIntegral: string;
  };
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
    readonly eriNotation: "chemists";
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
    readonly canonicalNumericTolerance: 0.00000000005;
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
  eriNotation: "chemists",
  eriOrder: ["mu", "nu", "lambda", "sigma"],
  occupiedOrbitals: 1,
  electronCount: 2,
} as const;

const EXPECTED_COMPARISON = {
  densityMatrixMaxAbs: H2_RHF_MODEL_TUPLE.solver.densityTolerance,
  totalEnergyMaxAbs: H2_RHF_MODEL_TUPLE.solver.energyTolerance,
  electronCountMaxAbs: H2_RHF_MODEL_TUPLE.solver.electronCountTolerance,
  canonicalNumericTolerance: H2_RHF_CANONICAL_TOLERANCE,
} as const;

const EXPECTED_PROVENANCE_SCF = {
  convTol: 0.000000000001,
  convTolGrad: 0.0000000001,
  maxCycle: 100,
  diisSpace: 8,
} as const;

const EXPECTED_PROVENANCE_TOOLCHAIN = {
  generator: "scripts/native/generate-h2-rhf-cassette.py",
  python: "3.11.1",
  pyscf: "2.6.2",
  numpy: "1.26.4",
  scipy: "1.11.4",
  blas: "openblas64 0.3.23.dev",
} as const;

const EXPECTED_PROVENANCE_BUILD = {
  basis: "sto-3g",
  charge: 0,
  spin: 0,
  unit: "Angstrom",
  cart: false,
  verbose: 0,
  overlapIntegral: "int1e_ovlp_sph",
  eriIntegral: "int2e_sph",
} as const;

const EXPECTED_SOURCE_IDS = [
  "pyscf:2.6.2:gto-rhf",
  "basis:sto-3g:ao-order:0H1s-1H1s",
  "oracle:adjacent-midpoints:v1",
] as const;
const REPLAY_ORACLE_TOLERANCE = 0.000000001;

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

export function canonicalH2RHFNumber(value: number): string {
  if (!Number.isFinite(value)) throw new TypeError("H2 RHF digest cannot encode NaN or Infinity");
  if (Object.is(value, -0)) return "0";
  // The generator rounds every numeric leaf to 12 decimal places.  Keeping
  // that rule in the digest makes Python, JavaScript, and Swift agree without
  // relying on each language's exponent formatting.
  const fixed = value.toFixed(H2_RHF_CANONICAL_DECIMALS);
  const trimmed = fixed.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "-0" || trimmed === "" ? "0" : trimmed;
}

/** Canonical JSON used for the payload hash; object keys are lexical. */
export function canonicalH2RHFJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") return canonicalH2RHFNumber(value);
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

function canonicalNumericValue(value: number): number {
  return Number(canonicalH2RHFNumber(value));
}

function checkCanonicalNumbers(value: unknown, path: string, errors: string[]): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return;
    if (Object.is(value, -0) || value !== canonicalNumericValue(value)) {
      errors.push(`${path} must be rounded to decimal-${H2_RHF_CANONICAL_DECIMALS}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => checkCanonicalNumbers(item, `${path}[${index}]`, errors));
    return;
  }
  if (isRecord(value)) {
    Object.entries(value).forEach(([key, item]) => checkCanonicalNumbers(item, `${path}.${key}`, errors));
  }
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
  if (finiteNumber(value.separationAngstrom) && finiteNumber(value.enuc)) {
    const expectedEnuc = 1 / (H2_RHF_MODEL_TUPLE.bohrPerAngstrom * value.separationAngstrom);
    if (Math.abs(value.enuc - expectedEnuc) > H2_RHF_CANONICAL_TOLERANCE) errors.push(`${label}.enuc is not the exact Coulomb value for its separation`);
  }
  if (Array.isArray(value.overlap) && value.overlap.length === 4) {
    if (finiteNumber(value.overlap[1]) && finiteNumber(value.overlap[2]) && Math.abs(value.overlap[1] - value.overlap[2]) > H2_RHF_CANONICAL_TOLERANCE) errors.push(`${label}.overlap must be symmetric`);
    try {
      inverseSqrt2(value.overlap);
    } catch {
      errors.push(`${label}.overlap must be positive definite`);
    }
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

type ReplayInput = Pick<H2RHFNode, "overlap" | "core" | "eri" | "enuc">;

export type H2RHFReplay = {
  readonly density: H2RHFMatrix;
  readonly energy: number;
  readonly electronCount: number;
  readonly electronCountError: number;
  readonly densityDelta: number;
  readonly energyDelta: number;
  readonly iteration: number;
  readonly gateStreak: number;
  readonly converged: boolean;
};

export type H2RHFReplaySolver = {
  readonly damping: number;
  readonly maxIterations: number;
  readonly fixedPointDensityTolerance: number;
  readonly fixedPointEnergyTolerance: number;
  readonly electronCountTolerance: number;
  readonly consecutiveGateTicks: number;
};

function symmetricEigen2(a: number, b: number, d: number): { readonly values: readonly [number, number]; readonly vectors: readonly [[number, number], [number, number]] } {
  const theta = 0.5 * Math.atan2(2 * b, a - d);
  const cosine = Math.cos(theta);
  const sine = Math.sin(theta);
  const first: [number, number] = [cosine, sine];
  const second: [number, number] = [-sine, cosine];
  const firstValue = first[0] * (a * first[0] + b * first[1]) + first[1] * (b * first[0] + d * first[1]);
  const secondValue = second[0] * (a * second[0] + b * second[1]) + second[1] * (b * second[0] + d * second[1]);
  return firstValue <= secondValue
    ? { values: [firstValue, secondValue], vectors: [first, second] }
    : { values: [secondValue, firstValue], vectors: [second, first] };
}

function inverseSqrt2(overlap: readonly number[]): H2RHFMatrix {
  const eig = symmetricEigen2(overlap[0], 0.5 * (overlap[1] + overlap[2]), overlap[3]);
  if (eig.values.some((value) => !finiteNumber(value) || value <= 0)) throw new Error("overlap matrix is not positive definite");
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

function multiply2(left: readonly number[], right: readonly number[]): H2RHFMatrix {
  return [
    left[0] * right[0] + left[1] * right[2],
    left[0] * right[1] + left[1] * right[3],
    left[2] * right[0] + left[3] * right[2],
    left[2] * right[1] + left[3] * right[3],
  ];
}

/** F = h + J − 0.5K with ERI indexed as chemists' (mu nu | lambda sigma). */
export function buildH2RHFFock(density: readonly number[], core: readonly number[], eri: readonly number[]): H2RHFMatrix {
  const fock = [...core];
  for (let p = 0; p < 2; p += 1) {
    for (let q = 0; q < 2; q += 1) {
      let coulomb = 0;
      let exchange = 0;
      for (let r = 0; r < 2; r += 1) {
        for (let s = 0; s < 2; s += 1) {
          const muNuLambdaSigma = ((p * 2 + q) * 2 + r) * 2 + s;
          const muLambdaNuSigma = ((p * 2 + r) * 2 + q) * 2 + s;
          coulomb += density[r * 2 + s] * eri[muNuLambdaSigma];
          exchange += density[r * 2 + s] * eri[muLambdaNuSigma];
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

function densityFromFock(fock: readonly number[], overlap: readonly number[]): H2RHFMatrix {
  const orthogonalizer = inverseSqrt2(overlap);
  const transformed = multiply2(multiply2(orthogonalizer, fock), orthogonalizer);
  const eig = symmetricEigen2(transformed[0], 0.5 * (transformed[1] + transformed[2]), transformed[3]);
  const orbital = [
    orthogonalizer[0] * eig.vectors[0][0] + orthogonalizer[1] * eig.vectors[0][1],
    orthogonalizer[2] * eig.vectors[0][0] + orthogonalizer[3] * eig.vectors[0][1],
  ];
  return [2 * orbital[0] * orbital[0], 2 * orbital[0] * orbital[1], 2 * orbital[1] * orbital[0], 2 * orbital[1] * orbital[1]];
}

function replayElectronCount(density: readonly number[], overlap: readonly number[]): number {
  return density[0] * overlap[0] + density[1] * overlap[2] + density[2] * overlap[1] + density[3] * overlap[3];
}

function replayEnergy(density: readonly number[], core: readonly number[], eri: readonly number[], enuc: number): number {
  const fock = buildH2RHFFock(density, core, eri);
  let sum = 0;
  for (let index = 0; index < 4; index += 1) sum += density[index] * (core[index] + fock[index]);
  return 0.5 * sum + enuc;
}

/** Replay the exact bounded map and require two consecutive strict gate ticks. */
export function replayH2RHF(input: ReplayInput, solver: H2RHFReplaySolver = H2_RHF_MODEL_TUPLE.solver): H2RHFReplay {
  const densityInput = [0, 0, 0, 0];
  let density = densityInput;
  let previousEnergy: number | null = null;
  let energy = Number.NaN;
  let electronCount = Number.NaN;
  let densityDelta = Number.POSITIVE_INFINITY;
  let energyDelta = Number.POSITIVE_INFINITY;
  let electronCountError = Number.POSITIVE_INFINITY;
  let gateStreak = 0;
  let iteration = 0;
  for (let nextIteration = 1; nextIteration <= solver.maxIterations; nextIteration += 1) {
    iteration = nextIteration;
    const target = densityFromFock(buildH2RHFFock(density, input.core, input.eri), input.overlap);
    const mixed = density.map((value, index) => (1 - solver.damping) * value + solver.damping * target[index]);
    energy = replayEnergy(mixed, input.core, input.eri, input.enuc);
    densityDelta = Math.max(...mixed.map((value, index) => Math.abs(value - density[index])));
    energyDelta = previousEnergy === null ? Number.POSITIVE_INFINITY : Math.abs(energy - previousEnergy);
    electronCount = replayElectronCount(mixed, input.overlap);
    electronCountError = Math.abs(electronCount - EXPECTED_AO_CONVENTION.electronCount);
    density = mixed;
    previousEnergy = energy;
    const gatePass = densityDelta <= solver.fixedPointDensityTolerance
      && energyDelta <= solver.fixedPointEnergyTolerance
      && electronCountError <= solver.electronCountTolerance;
    gateStreak = gatePass ? gateStreak + 1 : 0;
    if (gateStreak >= solver.consecutiveGateTicks) break;
  }
  return {
    density,
    energy,
    electronCount,
    electronCountError,
    densityDelta,
    energyDelta,
    iteration,
    gateStreak,
    converged: gateStreak >= solver.consecutiveGateTicks && iteration <= solver.maxIterations,
  };
}

function replayError(replay: H2RHFReplay, node: ReplayInput, label: string, errors: string[]): void {
  if (!replay.converged) errors.push(`${label} replay did not converge within ${H2_RHF_MODEL_TUPLE.solver.maxIterations} iterations and ${H2_RHF_MODEL_TUPLE.solver.consecutiveGateTicks} consecutive gate ticks`);
  if (replay.electronCountError > H2_RHF_MODEL_TUPLE.solver.electronCountTolerance) errors.push(`${label} replay electron count exceeds ceiling`);
  if (!replay.density.every(finiteNumber) || !finiteNumber(replay.energy) || !finiteNumber(replay.electronCount)) errors.push(`${label} replay produced non-finite values`);
  if (!node.overlap.every(finiteNumber)) errors.push(`${label}.overlap is non-finite`);
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

function interpolationWeights(position: number, leftNode: number, rightNode: number, nodeCount: number): { readonly indices: readonly [number, number, number]; readonly weights: readonly [number, number, number] } {
  const indices: [number, number, number] = leftNode <= 0
    ? [0, 1, 2]
    : rightNode >= nodeCount - 1
      ? [nodeCount - 3, nodeCount - 2, nodeCount - 1]
      : [leftNode - 1, leftNode, leftNode + 1];
  const weights: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    let weight = 1;
    for (let j = 0; j < 3; j += 1) if (i !== j) weight *= (position - indices[j]) / (indices[i] - indices[j]);
    weights[i] = weight;
  }
  return { indices, weights };
}

function interpolatedMatrix(nodes: readonly H2RHFNode[], key: "overlap" | "core" | "eri", position: number, leftNode: number, rightNode: number): H2RHFMatrix {
  const { indices, weights } = interpolationWeights(position, leftNode, rightNode, nodes.length);
  return nodes[indices[0]][key].map((_, entry) => weights.reduce((sum, weight, sample) => sum + weight * nodes[indices[sample]][key][entry], 0));
}

function maxAbsDifference(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length) return Number.POSITIVE_INFINITY;
  return Math.max(...left.map((value, index) => Math.abs(value - right[index])));
}

/** Validate a cassette and its digest before it can enter an authority. */
export function validateH2RHFCassette(value: unknown): H2RHFValidation {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["cassette must be an object"] };
  checkCanonicalNumbers(value, "cassette", errors);
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
    for (const key of ["generator", "python", "pyscf", "numpy", "scipy", "blas", "sourceHash"] as const) {
      if (typeof value.provenance[key] !== "string" || value.provenance[key].length === 0) errors.push(`provenance.${key} must be a non-empty string`);
    }
    if (!Array.isArray(value.provenance.sourceIds) || value.provenance.sourceIds.length === 0 || value.provenance.sourceIds.some((id) => typeof id !== "string" || id.length === 0)) {
      errors.push("provenance.sourceIds must contain non-empty strings");
    }
    for (const key of Object.keys(EXPECTED_PROVENANCE_TOOLCHAIN) as Array<keyof typeof EXPECTED_PROVENANCE_TOOLCHAIN>) {
      if (value.provenance[key] !== EXPECTED_PROVENANCE_TOOLCHAIN[key]) errors.push(`unsupported ${key} provenance`);
    }
    if (typeof value.provenance.sourceHash === "string" && value.provenance.sourceHash !== H2_RHF_TRUSTED_GENERATOR_SHA256) errors.push("unsupported generator source hash");
    checkExact(value.provenance.scf, EXPECTED_PROVENANCE_SCF, "SCF provenance", errors);
    checkExact(value.provenance.build, EXPECTED_PROVENANCE_BUILD, "build provenance", errors);
    checkExact(value.provenance.sourceIds, EXPECTED_SOURCE_IDS, "source identifiers", errors);
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
    const nodes = value.nodes;
    nodes.forEach((node, index) => {
      checkNode(node, `nodes[${index}]`, errors);
      checkEnvelopeAndOrdering(node, `nodes[${index}]`, errors);
      if (isRecord(node) && finiteNumber(node.separationAngstrom)) {
        const expectedSeparation = H2_RHF_MODEL_TUPLE.envelope.minAngstrom + index * H2_RHF_MODEL_TUPLE.envelope.spacingAngstrom;
        if (Math.abs(node.separationAngstrom - expectedSeparation) > H2_RHF_CANONICAL_TOLERANCE) errors.push(`nodes[${index}] is out of canonical ordering`);
      }
      const previousNode = index > 0 ? nodes[index - 1] : null;
      if (isRecord(previousNode) && isRecord(node) && finiteNumber(previousNode.separationAngstrom) && finiteNumber(node.separationAngstrom) && node.separationAngstrom <= previousNode.separationAngstrom) errors.push(`nodes[${index}] is not strictly after the previous node`);
      if (isRecord(node) && finiteNumber(node.referenceElectronCount) && Math.abs(node.referenceElectronCount - EXPECTED_AO_CONVENTION.electronCount) > EXPECTED_COMPARISON.electronCountMaxAbs) errors.push(`nodes[${index}].referenceElectronCount is not two electrons`);
      if (isRecord(node) && Array.isArray(node.overlap) && Array.isArray(node.core) && Array.isArray(node.eri) && finiteNumber(node.enuc)) {
        try {
          inverseSqrt2(node.overlap);
          const replay = replayH2RHF(node as unknown as ReplayInput);
          replayError(replay, node as unknown as ReplayInput, `nodes[${index}]`, errors);
          if (maxAbsDifference(replay.density, node.referenceDensity as number[]) > EXPECTED_COMPARISON.densityMatrixMaxAbs) errors.push(`nodes[${index}] replay density exceeds ceiling`);
          if (finiteNumber(node.referenceEnergy) && Math.abs(replay.energy - node.referenceEnergy) > EXPECTED_COMPARISON.totalEnergyMaxAbs) errors.push(`nodes[${index}] replay energy exceeds ceiling`);
          if (finiteNumber(node.referenceElectronCount) && Math.abs(replay.electronCount - node.referenceElectronCount) > EXPECTED_COMPARISON.electronCountMaxAbs) errors.push(`nodes[${index}] replay electron count disagrees with reference`);
        } catch {
          // Structural overlap validation above already records the failure.
        }
      }
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
      const expectedSeparation = H2_RHF_MODEL_TUPLE.envelope.minAngstrom + (index + 0.5) * H2_RHF_MODEL_TUPLE.envelope.spacingAngstrom;
      if (finiteNumber(node.separationAngstrom) && Math.abs(node.separationAngstrom - expectedSeparation) > H2_RHF_CANONICAL_TOLERANCE) errors.push(`midpoints[${index}] is out of canonical ordering`);
      for (const key of ["densityError", "energyError", "electronCountError"] as const) {
        checkNonnegativeFinite(node[key], `midpoints[${index}].${key}`, errors);
      }
      if (finiteNumber(node.densityError) && node.densityError > EXPECTED_COMPARISON.densityMatrixMaxAbs) errors.push(`midpoints[${index}].densityError exceeds ceiling`);
      if (finiteNumber(node.energyError) && node.energyError > EXPECTED_COMPARISON.totalEnergyMaxAbs) errors.push(`midpoints[${index}].energyError exceeds ceiling`);
      if (finiteNumber(node.electronCountError) && node.electronCountError > EXPECTED_COMPARISON.electronCountMaxAbs) errors.push(`midpoints[${index}].electronCountError exceeds ceiling`);
      if (Array.isArray(value.nodes) && index + 1 < value.nodes.length && Array.isArray(node.overlap) && Array.isArray(node.core) && Array.isArray(node.eri) && finiteNumber(node.enuc)) {
        try { inverseSqrt2(node.overlap); } catch { return; }
        const position = index + 0.5;
        for (const key of ["overlap", "core", "eri"] as const) {
          const expectedMatrix = interpolatedMatrix(value.nodes as H2RHFNode[], key, position, index, index + 1);
          if (maxAbsDifference(node[key] as number[], expectedMatrix) > 1e-10) errors.push(`midpoints[${index}].${key} is not three-node quadratic interpolation`);
        }
        const replay = replayH2RHF(node as unknown as ReplayInput);
        replayError(replay, node as unknown as ReplayInput, `midpoints[${index}]`, errors);
        // The independent PySCF density is compared against its own oracle;
        // Tr(P*S) here must be recomputed from the replay density and the
        // interpolated overlap that the runtime actually uses.
        const replayCount = replayElectronCount(replay.density, node.overlap as number[]);
        if (finiteNumber(node.referenceElectronCount) && Math.abs(replayCount - node.referenceElectronCount) > EXPECTED_COMPARISON.electronCountMaxAbs) errors.push(`midpoints[${index}].referenceElectronCount disagrees with replay Tr(P*S)`);
        if (Math.abs(replayCount - replay.electronCount) > H2_RHF_CANONICAL_TOLERANCE) errors.push(`midpoints[${index}] replay electron count is not its Tr(P*S)`);
        const densityError = maxAbsDifference(replay.density, node.referenceDensity as number[]);
        const energyError = finiteNumber(node.referenceEnergy) ? Math.abs(replay.energy - node.referenceEnergy) : Number.POSITIVE_INFINITY;
        if (densityError > EXPECTED_COMPARISON.densityMatrixMaxAbs) errors.push(`midpoints[${index}] replay density exceeds ceiling`);
        if (energyError > EXPECTED_COMPARISON.totalEnergyMaxAbs) errors.push(`midpoints[${index}] replay energy exceeds ceiling`);
        if (finiteNumber(node.densityError) && Math.abs(node.densityError - densityError) > REPLAY_ORACLE_TOLERANCE) errors.push(`midpoints[${index}].densityError is stale`);
        if (finiteNumber(node.energyError) && Math.abs(node.energyError - energyError) > REPLAY_ORACLE_TOLERANCE) errors.push(`midpoints[${index}].energyError is stale`);
        if (finiteNumber(node.electronCountError) && Math.abs(node.electronCountError - replay.electronCountError) > REPLAY_ORACLE_TOLERANCE) errors.push(`midpoints[${index}].electronCountError is stale`);
      }
    });
  }
  if (typeof value.payloadSha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.payloadSha256)) {
    errors.push("payloadSha256 must be a lowercase SHA-256 digest");
  } else {
    if (value.payloadSha256 !== H2_RHF_TRUSTED_PAYLOAD_SHA256) errors.push("payload SHA-256 is not the trusted scientific artifact");
    try {
      const expected = hashH2RHFBody(value as unknown as H2RHFCassette);
      if (expected !== value.payloadSha256) errors.push("payload SHA-256 does not match canonical body");
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "payload SHA-256 cannot be computed");
    }
  }
  if (Array.isArray(value.nodes)) {
    const sentinel = value.nodes.find((node) => isRecord(node) && node.separationAngstrom === H2_RHF_TRUSTED_SENTINEL.separationAngstrom);
    if (!isRecord(sentinel)) errors.push("trusted 0.75 Angstrom sentinel node is missing");
    else {
      if (Math.abs((sentinel.enuc as number) - H2_RHF_TRUSTED_SENTINEL.enuc) > H2_RHF_CANONICAL_TOLERANCE) errors.push("trusted sentinel nuclear energy drifted");
      if (Math.abs((sentinel.referenceEnergy as number) - H2_RHF_TRUSTED_SENTINEL.referenceEnergy) > H2_RHF_CANONICAL_TOLERANCE) errors.push("trusted sentinel energy drifted");
      if (maxAbsDifference(sentinel.referenceDensity as number[], H2_RHF_TRUSTED_SENTINEL.referenceDensity) > H2_RHF_CANONICAL_TOLERANCE) errors.push("trusted sentinel density drifted");
      if (Math.abs((sentinel.referenceElectronCount as number) - H2_RHF_TRUSTED_SENTINEL.referenceElectronCount) > H2_RHF_CANONICAL_TOLERANCE) errors.push("trusted sentinel electron count drifted");
    }
  }
  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}
