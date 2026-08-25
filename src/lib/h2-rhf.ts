/**
 * The renderer-free TypeScript authority for the bounded H₂ RHF/STO-3G
 * instrument.
 *
 * The cassette is the scientific input. This module owns only the exact
 * two-AO fixed-point map and the small contact/clock state machine around it.
 * It intentionally has no browser, renderer, sensory, persistence, network,
 * wall-clock, or entropy dependency.
 */

import {
  canonicalH2RHFJson,
  validateH2RHFCassette,
  type H2RHFCassette,
  type H2RHFMatrix,
  type H2RHFNode,
  type H2RHFValidation,
} from "../../packages/universe-contracts/src/h2-rhf.ts";
import { H2_RHF_CASSETTE } from "./h2-rhf-cassette.generated.ts";

export { H2_RHF_CASSETTE } from "./h2-rhf-cassette.generated.ts";
export { H2_RHF_MODEL_TUPLE } from "../../packages/universe-contracts/src/h2-rhf.ts";

export type H2RHFContactEpoch = number | string;

export type H2RHFDisposition =
  | "idle"
  | "correcting"
  | "promoted"
  | "cancelled"
  | "outside-envelope"
  | "max-iterations"
  | "reference-unverified"
  | "numerical-failure";

export type H2RHFTraceKind =
  | "reference-unverified"
  | "contact-begin"
  | "request"
  | "request-ignored"
  | "tick"
  | "gate-pass"
  | "release"
  | "promotion"
  | "outside-envelope"
  | "max-iterations"
  | "numerical-failure"
  | "cancel";

export type H2RHFMatrixResult = {
  readonly overlap: H2RHFMatrix;
  readonly core: H2RHFMatrix;
  readonly eri: H2RHFMatrix;
  readonly enuc: number;
  readonly leftNode: number;
  readonly rightNode: number;
};

export type H2RHFInterpolationResult =
  | {
      readonly supported: true;
      readonly rawSeparationAngstrom: number;
      /** Semantic boundary value; internal math uses the raw request. */
      readonly separationAngstrom: number;
      readonly matrices: H2RHFMatrixResult;
    }
  | {
      readonly supported: false;
      readonly rawSeparationAngstrom: number;
      readonly separationAngstrom: null;
      readonly reason: "outside-envelope" | "reference-unverified";
    };

export type H2RHFCheckpoint = {
  readonly targetId: string;
  readonly separationAngstrom: number;
  readonly density: H2RHFMatrix;
  readonly energy: number;
  readonly electronCount: number;
  readonly promotionGeneration: number;
  readonly digest: string;
};

export type H2RHFCandidateSnapshot = {
  readonly targetId: string;
  readonly contactEpoch: H2RHFContactEpoch;
  readonly status: "moving" | "frozen";
  readonly rawSeparationAngstrom: number;
  readonly requestSeparationAngstrom: number;
  readonly density: H2RHFMatrix;
  readonly energy: number;
  readonly residual: number | null;
  readonly energyDelta: number | null;
  readonly electronCount: number;
  readonly electronCountError: number;
  readonly iteration: number;
  readonly gateStreak: number;
};

type H2RHFTraceFields = {
  readonly tick: number;
  readonly contactEpoch: H2RHFContactEpoch | null;
  readonly targetId: string | null;
  readonly disposition: H2RHFDisposition;
  readonly iteration: number;
  readonly gateStreak: number;
  readonly separationAngstrom: number | null;
  readonly residual: number | null;
  readonly energyDelta: number | null;
  readonly electronCountError: number | null;
  readonly promotionGeneration: number;
  readonly checkpointDigest: string | null;
};

export type H2RHFMilestone = H2RHFTraceFields & {
  readonly kind: Exclude<H2RHFTraceKind, "tick" | "request-ignored">;
};

export type H2RHFTraceEvent = H2RHFTraceFields & {
  readonly kind: H2RHFTraceKind;
  readonly gatePass: boolean;
};

export type H2RHFSnapshot = {
  readonly tick: number;
  readonly contactEpoch: H2RHFContactEpoch | null;
  readonly targetId: string | null;
  readonly contactActive: boolean;
  readonly outsideEnvelopeLatched: boolean;
  readonly disposition: H2RHFDisposition;
  readonly movingCandidate: H2RHFCandidateSnapshot | null;
  readonly frozenCandidate: H2RHFCandidateSnapshot | null;
  /** Alias kept for render consumers that do not distinguish moving/frozen. */
  readonly candidate: H2RHFCandidateSnapshot | null;
  readonly lastGood: H2RHFCheckpoint | null;
  readonly gateStreak: number;
  readonly perRequestIterations: number;
  readonly promotionGeneration: number;
  readonly traceLength: number;
  readonly milestones: readonly H2RHFMilestone[];
};

export type H2RHFContactInput = {
  readonly contactEpoch?: H2RHFContactEpoch;
  readonly targetId?: string;
  /** Raw geometry. It is checked before any semantic quantization. */
  readonly separationAngstrom: number;
  readonly rawSeparationAngstrom?: number;
};

export type H2RHFRequestInput = number | {
  readonly separationAngstrom: number;
  readonly rawSeparationAngstrom?: number;
  readonly targetId?: string;
};

export type H2RHFReleaseInput = { readonly separationAngstrom?: number; readonly rawSeparationAngstrom?: number } | undefined;

export type H2RHFAuthorityTestSeam = {
  /** Make the fixed-point gates fail while retaining the exact map output. */
  readonly forceMaxIterations?: boolean;
  /** Inject a non-finite map result at a 1-based logical tick. */
  readonly failNumericallyAtTick?: number;
};

export type H2RHFAuthorityOptions = {
  readonly cassette?: unknown;
  readonly initialSeparationAngstrom?: number;
  readonly initialTargetId?: string;
  readonly maxTraceEntries?: number;
  readonly testSeam?: H2RHFAuthorityTestSeam;
};

export type H2RHFCommand =
  | ({ readonly kind: "begin-contact" | "beginContact" } & H2RHFContactInput)
  | { readonly kind: "request" | "request-separation" | "requestSeparation"; readonly separationAngstrom: number; readonly rawSeparationAngstrom?: number; readonly targetId?: string }
  | { readonly kind: "release"; readonly separationAngstrom?: number; readonly rawSeparationAngstrom?: number }
  | { readonly kind: "cancel" };

export type H2RHFAdapterSnapshot = {
  readonly accumulatorMs: number;
  readonly logicalTicks: number;
  readonly queuedCommands: number;
  readonly rebaseCount: number;
};

export interface H2RHFAuthority {
  readonly validation: H2RHFValidation;
  beginContact(input: H2RHFContactInput | number, targetId?: string, contactEpoch?: H2RHFContactEpoch): H2RHFSnapshot;
  requestSeparation(input: H2RHFRequestInput): H2RHFSnapshot;
  updateRequest(input: H2RHFRequestInput): H2RHFSnapshot;
  release(input?: H2RHFReleaseInput): H2RHFSnapshot;
  cancel(): H2RHFSnapshot;
  dispatch(command: H2RHFCommand): H2RHFSnapshot;
  tick(): H2RHFSnapshot;
  advanceTicks(count: number): H2RHFSnapshot;
  snapshot(): H2RHFSnapshot;
  getSnapshot(): H2RHFSnapshot;
  trace(): readonly H2RHFTraceEvent[];
  getTrace(): readonly H2RHFTraceEvent[];
  milestones(): readonly H2RHFMilestone[];
}

export interface H2RHFAdapter {
  queue(command: H2RHFCommand): H2RHFAdapterSnapshot;
  enqueue(command: H2RHFCommand): H2RHFAdapterSnapshot;
  advance(presentationDeltaMs: number): H2RHFAdapterSnapshot;
  advancePresentation(presentationDeltaMs: number): H2RHFAdapterSnapshot;
  tick(): H2RHFAdapterSnapshot;
  rebase(): H2RHFAdapterSnapshot;
  resume(): H2RHFAdapterSnapshot;
  onVisibility(hidden: boolean): H2RHFAdapterSnapshot;
  snapshot(): H2RHFAdapterSnapshot;
}

const DEFAULT_TARGET_ID = "h2-1";
const DEFAULT_INITIAL_SEPARATION = 0.75;
const DEFAULT_TRACE_ENTRIES = 128;
const HOLD_MAX_DURATION_MS = 2400;
const TRACE_QUANTIZATION_DECIMALS = 12;
const EPSILON = 1e-12;

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function quantize(value: number): number {
  if (!finite(value)) return value;
  const factor = 10 ** TRACE_QUANTIZATION_DECIMALS;
  const result = Math.round(value * factor) / factor;
  return Object.is(result, -0) ? 0 : result;
}

function quantizedFinite(value: number): number | null {
  return finite(value) ? quantize(value) : null;
}

function immutableArray(values: readonly number[]): H2RHFMatrix {
  return Object.freeze(values.map((value) => quantize(value)));
}

function immutableObject<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function maxAbsDifference(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length) throw new Error("H2 RHF matrix dimensions differ");
  let maximum = 0;
  for (let index = 0; index < left.length; index += 1) {
    maximum = Math.max(maximum, Math.abs(left[index] - right[index]));
  }
  return maximum;
}

function matrixFinite(value: readonly number[], length: number): boolean {
  return value.length === length && value.every((entry) => finite(entry));
}

function matrix2Symmetric(value: readonly number[]): [number, number, number, number] {
  if (!matrixFinite(value, 4)) throw new Error("H2 RHF matrix is non-finite or has the wrong dimension");
  const offDiagonal = 0.5 * (value[1] + value[2]);
  if (!finite(offDiagonal)) throw new Error("H2 RHF matrix is non-finite");
  return [value[0], offDiagonal, offDiagonal, value[3]];
}

function multiply2(left: readonly number[], right: readonly number[]): H2RHFMatrix {
  return [
    left[0] * right[0] + left[1] * right[2],
    left[0] * right[1] + left[1] * right[3],
    left[2] * right[0] + left[3] * right[2],
    left[2] * right[1] + left[3] * right[3],
  ];
}

function transpose2(value: readonly number[]): H2RHFMatrix {
  return [value[0], value[2], value[1], value[3]];
}

function canonicalVector(vector: readonly [number, number]): [number, number] {
  const sign = Math.abs(vector[0]) > EPSILON ? (vector[0] < 0 ? -1 : 1) : vector[1] < 0 ? -1 : 1;
  return [sign * vector[0], sign * vector[1]];
}

/** Deterministic symmetric 2×2 eigensolve, with ascending eigenvalues. */
export function symmetricEigen2x2(a: number, b: number, d: number): {
  readonly values: readonly [number, number];
  readonly vectors: readonly [[number, number], [number, number]];
} {
  if (![a, b, d].every(finite)) throw new Error("H2 RHF eigensolve received a non-finite matrix");
  const theta = 0.5 * Math.atan2(2 * b, a - d);
  const cosine = Math.cos(theta);
  const sine = Math.sin(theta);
  const first = canonicalVector([cosine, sine]);
  const second = canonicalVector([-sine, cosine]);
  const firstValue = first[0] * (a * first[0] + b * first[1]) + first[1] * (b * first[0] + d * first[1]);
  const secondValue = second[0] * (a * second[0] + b * second[1]) + second[1] * (b * second[0] + d * second[1]);
  if (![firstValue, secondValue].every(finite)) throw new Error("H2 RHF eigensolve became non-finite");
  return firstValue <= secondValue
    ? { values: [firstValue, secondValue], vectors: [first, second] }
    : { values: [secondValue, firstValue], vectors: [second, first] };
}

function inverseSqrt2(overlap: readonly number[]): H2RHFMatrix {
  const symmetric = matrix2Symmetric(overlap);
  const eig = symmetricEigen2x2(symmetric[0], symmetric[1], symmetric[3]);
  if (eig.values.some((value) => !finite(value) || value <= 0)) throw new Error("H2 RHF overlap matrix is not positive definite");
  const [v0, v1] = eig.vectors;
  const w0 = 1 / Math.sqrt(eig.values[0]);
  const w1 = 1 / Math.sqrt(eig.values[1]);
  const result: H2RHFMatrix = [
    w0 * v0[0] * v0[0] + w1 * v1[0] * v1[0],
    w0 * v0[0] * v0[1] + w1 * v1[0] * v1[1],
    w0 * v0[1] * v0[0] + w1 * v1[1] * v1[1],
    w0 * v0[1] * v0[1] + w1 * v1[1] * v1[1],
  ];
  if (!matrixFinite(result, 4)) throw new Error("H2 RHF orthogonalizer became non-finite");
  return result;
}

/** Exact F = h + J − 0.5K map in the cassette's declared AO/ERI order. */
export function buildH2Fock(density: readonly number[], core: readonly number[], eri: readonly number[]): H2RHFMatrix {
  if (!matrixFinite(density, 4) || !matrixFinite(core, 4) || !matrixFinite(eri, 16)) throw new Error("H2 RHF Fock input is non-finite or has the wrong dimension");
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
  return matrix2Symmetric(fock);
}

/** Build the canonical two-electron density from a generalized Fock solve. */
export function densityFromH2Fock(fock: readonly number[], overlap: readonly number[]): H2RHFMatrix {
  const orthogonalizer = inverseSqrt2(overlap);
  const symmetricFock = matrix2Symmetric(fock);
  const transformed = matrix2Symmetric(multiply2(multiply2(orthogonalizer, symmetricFock), orthogonalizer));
  const eig = symmetricEigen2x2(transformed[0], transformed[1], transformed[3]);
  const orbital = canonicalVector([
    orthogonalizer[0] * eig.vectors[0][0] + orthogonalizer[1] * eig.vectors[0][1],
    orthogonalizer[2] * eig.vectors[0][0] + orthogonalizer[3] * eig.vectors[0][1],
  ]);
  const density: H2RHFMatrix = [
    2 * orbital[0] * orbital[0],
    2 * orbital[0] * orbital[1],
    2 * orbital[1] * orbital[0],
    2 * orbital[1] * orbital[1],
  ];
  if (!matrixFinite(density, 4)) throw new Error("H2 RHF density became non-finite");
  return density;
}

export function electronCountForH2Density(density: readonly number[], overlap: readonly number[]): number {
  if (!matrixFinite(density, 4) || !matrixFinite(overlap, 4)) throw new Error("H2 RHF electron-count input is invalid");
  return density[0] * overlap[0] + density[1] * overlap[2] + density[2] * overlap[1] + density[3] * overlap[3];
}

export function energyForH2Density(density: readonly number[], core: readonly number[], eri: readonly number[], enuc: number): number {
  if (!finite(enuc)) throw new Error("H2 RHF nuclear energy is non-finite");
  const fock = buildH2Fock(density, core, eri);
  let sum = 0;
  for (let index = 0; index < 4; index += 1) sum += density[index] * (core[index] + fock[index]);
  const result = 0.5 * sum + enuc;
  if (!finite(result)) throw new Error("H2 RHF energy became non-finite");
  return result;
}

export const h2RHFMap = densityFromH2Fock;
export const h2RHFEnergy = energyForH2Density;
export const h2RHFElectronCount = electronCountForH2Density;
export const buildFock = buildH2Fock;
export const densityFromFock = densityFromH2Fock;
export const electronCount = electronCountForH2Density;
export const rhfEnergy = energyForH2Density;

function interpolationWeights(position: number, leftNode: number, rightNode: number): { readonly indices: readonly [number, number, number]; readonly weights: readonly [number, number, number] } {
  const n = rightNode + 1;
  let indices: [number, number, number];
  if (leftNode <= 0) indices = [0, 1, 2];
  else if (rightNode >= n - 1) indices = [n - 3, n - 2, n - 1];
  else indices = [leftNode - 1, leftNode, leftNode + 1];
  const x = position;
  const xs = indices;
  const weights: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    let weight = 1;
    for (let j = 0; j < 3; j += 1) if (i !== j) weight *= (x - xs[j]) / (xs[i] - xs[j]);
    weights[i] = weight;
  }
  return { indices, weights };
}

function interpolateMatrix(nodes: readonly H2RHFNode[], key: "overlap" | "core" | "eri", position: number, leftNode: number, rightNode: number): H2RHFMatrix {
  const { indices, weights } = interpolationWeights(position, leftNode, rightNode);
  const length = nodes[0][key].length;
  const result = Array.from({ length }, () => 0);
  for (let sample = 0; sample < 3; sample += 1) {
    const values = nodes[indices[sample]][key];
    for (let index = 0; index < length; index += 1) result[index] += weights[sample] * values[index];
  }
  if (!result.every(finite)) throw new Error("H2 RHF interpolation became non-finite");
  return result;
}

function nodeForExactPosition(nodes: readonly H2RHFNode[], position: number): number | null {
  const rounded = Math.round(position);
  return Math.abs(position - rounded) <= EPSILON && rounded >= 0 && rounded < nodes.length ? rounded : null;
}

/** Interpolate a raw geometry request without clamping it into support. */
function interpolateValidatedH2Request(rawSeparationAngstrom: number, cassette: H2RHFCassette): H2RHFInterpolationResult {
  if (!finite(rawSeparationAngstrom)) return { supported: false, rawSeparationAngstrom, separationAngstrom: null, reason: "outside-envelope" };
  const { minAngstrom, maxAngstrom, spacingAngstrom, nodeCount } = cassette.envelope;
  if (rawSeparationAngstrom < minAngstrom || rawSeparationAngstrom > maxAngstrom) return { supported: false, rawSeparationAngstrom, separationAngstrom: null, reason: "outside-envelope" };
  const position = (rawSeparationAngstrom - minAngstrom) / spacingAngstrom;
  const exactNode = nodeForExactPosition(cassette.nodes, position);
  const leftNode = exactNode === null ? Math.min(nodeCount - 2, Math.max(0, Math.floor(position))) : Math.min(nodeCount - 2, exactNode);
  const rightNode = exactNode === null ? leftNode + 1 : Math.max(1, Math.min(nodeCount - 1, exactNode));
  const matrices = exactNode === null
    ? {
        overlap: interpolateMatrix(cassette.nodes, "overlap", position, leftNode, rightNode),
        core: interpolateMatrix(cassette.nodes, "core", position, leftNode, rightNode),
        eri: interpolateMatrix(cassette.nodes, "eri", position, leftNode, rightNode),
        enuc: 1 / (cassette.modelTuple.bohrPerAngstrom * rawSeparationAngstrom),
        leftNode,
        rightNode,
      }
    : {
        overlap: [...cassette.nodes[exactNode].overlap],
        core: [...cassette.nodes[exactNode].core],
        eri: [...cassette.nodes[exactNode].eri],
        enuc: 1 / (cassette.modelTuple.bohrPerAngstrom * rawSeparationAngstrom),
        leftNode: exactNode,
        rightNode: exactNode,
      };
  if (![...matrices.overlap, ...matrices.core, ...matrices.eri, matrices.enuc].every(finite)) throw new Error("H2 RHF interpolation produced a non-finite matrix");
  return { supported: true, rawSeparationAngstrom, separationAngstrom: quantize(rawSeparationAngstrom), matrices };
}

export function interpolateH2Request(rawSeparationAngstrom: number, cassette: H2RHFCassette = H2_RHF_CASSETTE): H2RHFInterpolationResult {
  if (!finite(rawSeparationAngstrom)) return { supported: false, rawSeparationAngstrom, separationAngstrom: null, reason: "outside-envelope" };
  const validation = validateH2RHFInput(cassette);
  if (!validation.ok) return { supported: false, rawSeparationAngstrom, separationAngstrom: null, reason: "reference-unverified" };
  return interpolateValidatedH2Request(rawSeparationAngstrom, cassette);
}

export const interpolateH2Matrices = interpolateH2Request;

/** Validate before a cassette can be used by the authority. */
export function validateH2RHFInput(value: unknown): H2RHFValidation {
  try {
    return validateH2RHFCassette(value);
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
}

export function holdDurationToSeparation(durationMs: number, intensity = 1, startSeparationAngstrom = (H2_RHF_CASSETTE.envelope.minAngstrom + H2_RHF_CASSETTE.envelope.maxAngstrom) / 2): {
  readonly rawSeparationAngstrom: number;
  readonly separationAngstrom: number;
  readonly supported: boolean;
} {
  if (![durationMs, intensity, startSeparationAngstrom].every(finite)) throw new TypeError("H2 hold mapping requires finite values");
  const duration = Math.max(0, durationMs);
  const progress = Math.min(1, duration / HOLD_MAX_DURATION_MS);
  const eased = progress * progress * (3 - 2 * progress);
  const signedIntensity = Math.max(-1, Math.min(1, intensity));
  const travel = (H2_RHF_CASSETTE.envelope.maxAngstrom - H2_RHF_CASSETTE.envelope.minAngstrom) * 0.5;
  const rawSeparationAngstrom = startSeparationAngstrom + signedIntensity * travel * eased;
  const supported = rawSeparationAngstrom >= H2_RHF_CASSETTE.envelope.minAngstrom && rawSeparationAngstrom <= H2_RHF_CASSETTE.envelope.maxAngstrom;
  return { rawSeparationAngstrom, separationAngstrom: quantize(rawSeparationAngstrom), supported };
}

export const separationFromHold = holdDurationToSeparation;
export const h2SeparationForHold = holdDurationToSeparation;

function fnv1aHex(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Compact deterministic digest for a quantized trusted checkpoint. */
export function digestH2RHFCheckpoint(checkpoint: Pick<H2RHFCheckpoint, "targetId" | "separationAngstrom" | "density" | "energy" | "electronCount" | "promotionGeneration">): string {
  return fnv1aHex(canonicalH2RHFJson({
    targetId: checkpoint.targetId,
    separationAngstrom: quantize(checkpoint.separationAngstrom),
    density: checkpoint.density.map(quantize),
    energy: quantize(checkpoint.energy),
    electronCount: quantize(checkpoint.electronCount),
    promotionGeneration: checkpoint.promotionGeneration,
  }));
}

type InternalCandidate = {
  targetId: string;
  contactEpoch: H2RHFContactEpoch;
  rawSeparationAngstrom: number;
  density: H2RHFMatrix;
  energy: number;
  residual: number;
  energyDelta: number;
  electronCount: number;
  electronCountError: number;
  iteration: number;
  gateStreak: number;
};

function initialDensityFor(cassette: H2RHFCassette, separation: number): { readonly density: H2RHFMatrix; readonly energy: number; readonly electronCount: number } {
  const request = interpolateValidatedH2Request(separation, cassette);
  if (!request.supported) throw new Error("initial H2 separation is outside the supported envelope");
  const startNode = cassette.nodes[Math.max(0, Math.min(cassette.nodes.length - 1, Math.round((separation - cassette.envelope.minAngstrom) / cassette.envelope.spacingAngstrom)))];
  let density = [...startNode.referenceDensity];
  let energy = energyForH2Density(density, request.matrices.core, request.matrices.eri, request.matrices.enuc);
  for (let iteration = 0; iteration < cassette.solver.maxIterations; iteration += 1) {
    const target = densityFromH2Fock(buildH2Fock(density, request.matrices.core, request.matrices.eri), request.matrices.overlap);
    const mixed = density.map((value, index) => (1 - cassette.solver.damping) * value + cassette.solver.damping * target[index]);
    const nextEnergy = energyForH2Density(mixed, request.matrices.core, request.matrices.eri, request.matrices.enuc);
    const residual = maxAbsDifference(mixed, density);
    const delta = Math.abs(nextEnergy - energy);
    density = mixed;
    energy = nextEnergy;
    if (residual <= cassette.solver.fixedPointDensityTolerance && delta <= cassette.solver.fixedPointEnergyTolerance) break;
  }
  const electronCount = electronCountForH2Density(density, request.matrices.overlap);
  if (!matrixFinite(density, 4) || !finite(energy) || !finite(electronCount)) throw new Error("initial H2 RHF state became non-finite");
  return { density, energy, electronCount };
}

class H2RHFAuthorityImpl implements H2RHFAuthority {
  readonly validation: H2RHFValidation;

  private readonly cassette: H2RHFCassette | null;
  private readonly traceLimit: number;
  private readonly seam: H2RHFAuthorityTestSeam;
  private readonly traceEntries: H2RHFTraceEvent[] = [];
  private readonly milestoneEntries: H2RHFMilestone[] = [];
  private tickCount = 0;
  private contactSequence = 0;
  private contactEpoch: H2RHFContactEpoch | null = null;
  private targetId: string | null = null;
  private contactActive = false;
  private outsideEnvelopeLatched = false;
  private disposition: H2RHFDisposition = "idle";
  private movingCandidate: InternalCandidate | null = null;
  private frozenCandidate: InternalCandidate | null = null;
  private lastGood: H2RHFCheckpoint | null = null;
  private gateStreak = 0;
  private promotionGeneration = 0;

  constructor(cassette: unknown, options: H2RHFAuthorityOptions) {
    this.validation = validateH2RHFInput(cassette);
    this.traceLimit = Math.max(8, Math.min(256, Math.floor(options.maxTraceEntries ?? DEFAULT_TRACE_ENTRIES)));
    this.seam = options.testSeam ?? {};
    if (!this.validation.ok) {
      this.cassette = null;
      this.disposition = "reference-unverified";
      this.record("reference-unverified", null, null, null);
      return;
    }
    this.cassette = cassette as H2RHFCassette;
    const initialSeparation = options.initialSeparationAngstrom ?? DEFAULT_INITIAL_SEPARATION;
    const initialTargetId = options.initialTargetId ?? DEFAULT_TARGET_ID;
    const initial = initialDensityFor(this.cassette, initialSeparation);
    this.lastGood = this.makeCheckpoint(initialTargetId, initialSeparation, initial.density, initial.energy, initial.electronCount, 0);
    this.targetId = initialTargetId;
  }

  beginContact(input: H2RHFContactInput | number, targetId = DEFAULT_TARGET_ID, contactEpoch?: H2RHFContactEpoch): H2RHFSnapshot {
    if (!this.cassette) return this.snapshot();
    const normalized = typeof input === "number"
      ? { separationAngstrom: input, rawSeparationAngstrom: input, targetId, contactEpoch }
      : input;
    const raw = normalized.rawSeparationAngstrom ?? normalized.separationAngstrom;
    this.contactSequence += 1;
    this.contactEpoch = normalized.contactEpoch ?? this.contactSequence;
    this.targetId = normalized.targetId ?? targetId;
    this.contactActive = true;
    this.outsideEnvelopeLatched = false;
    this.movingCandidate = null;
    this.frozenCandidate = null;
    this.gateStreak = 0;
    const request = interpolateValidatedH2Request(raw, this.cassette);
    if (!request.supported) {
      this.outsideEnvelopeLatched = request.reason === "outside-envelope";
      this.disposition = request.reason;
      this.record(request.reason, null, raw, null);
      return this.snapshot();
    }
    this.movingCandidate = this.newCandidate(raw, this.lastGood?.density ?? [0, 0, 0, 0], this.lastGood?.energy ?? 0);
    this.disposition = "correcting";
    this.record("contact-begin", this.movingCandidate, raw, null);
    return this.snapshot();
  }

  requestSeparation(input: H2RHFRequestInput): H2RHFSnapshot {
    if (!this.cassette || !this.contactActive || this.outsideEnvelopeLatched || this.frozenCandidate) return this.snapshot();
    const normalized = typeof input === "number" ? { separationAngstrom: input, rawSeparationAngstrom: input } : input;
    if (normalized.targetId !== undefined && normalized.targetId !== this.targetId) {
      this.record("request-ignored", this.movingCandidate, null, null);
      return this.snapshot();
    }
    const raw = normalized.rawSeparationAngstrom ?? normalized.separationAngstrom;
    const request = interpolateValidatedH2Request(raw, this.cassette);
    if (!request.supported) {
      this.outsideEnvelopeLatched = request.reason === "outside-envelope";
      this.disposition = request.reason;
      this.movingCandidate = null;
      this.frozenCandidate = null;
      this.gateStreak = 0;
      this.record(request.reason, null, raw, null);
      return this.snapshot();
    }
    if (!this.movingCandidate) return this.snapshot();
    this.movingCandidate.rawSeparationAngstrom = raw;
    this.movingCandidate.iteration = 0;
    this.movingCandidate.gateStreak = 0;
    this.movingCandidate.residual = Number.POSITIVE_INFINITY;
    this.movingCandidate.energyDelta = Number.POSITIVE_INFINITY;
    this.gateStreak = 0;
    this.disposition = "correcting";
    this.record("request", this.movingCandidate, raw, null);
    return this.snapshot();
  }

  updateRequest(input: H2RHFRequestInput): H2RHFSnapshot {
    return this.requestSeparation(input);
  }

  release(input?: H2RHFReleaseInput): H2RHFSnapshot {
    if (!this.cassette) return this.snapshot();
    if (input?.separationAngstrom !== undefined || input?.rawSeparationAngstrom !== undefined) {
      this.requestSeparation({
        separationAngstrom: input.separationAngstrom ?? input.rawSeparationAngstrom as number,
        rawSeparationAngstrom: input.rawSeparationAngstrom,
      });
    }
    const candidate = this.movingCandidate;
    this.contactActive = false;
    this.outsideEnvelopeLatched = false;
    this.movingCandidate = null;
    if (candidate) {
      this.frozenCandidate = candidate;
      this.record("release", candidate, candidate.rawSeparationAngstrom, null);
    } else {
      this.frozenCandidate = null;
      this.record("release", null, null, null);
    }
    return this.snapshot();
  }

  cancel(): H2RHFSnapshot {
    if (!this.cassette) return this.snapshot();
    this.contactActive = false;
    this.outsideEnvelopeLatched = false;
    this.movingCandidate = null;
    this.frozenCandidate = null;
    this.gateStreak = 0;
    this.disposition = "cancelled";
    this.record("cancel", null, null, null);
    return this.snapshot();
  }

  dispatch(command: H2RHFCommand): H2RHFSnapshot {
    switch (command.kind) {
      case "begin-contact":
      case "beginContact":
        return this.beginContact(command);
      case "request":
      case "request-separation":
      case "requestSeparation":
        return this.requestSeparation(command);
      case "release":
        return this.release(command);
      case "cancel":
        return this.cancel();
      default: {
        const neverCommand: never = command;
        throw new Error(`unsupported H2 RHF command ${(neverCommand as { readonly kind: string }).kind}`);
      }
    }
  }

  tick(): H2RHFSnapshot {
    this.tickCount += 1;
    if (!this.cassette) return this.snapshot();
    const candidate = this.frozenCandidate ?? this.movingCandidate;
    if (!candidate) return this.snapshot();
    if (this.seam.failNumericallyAtTick === this.tickCount) {
      this.failNumerically(candidate);
      return this.snapshot();
    }
    try {
      const cassette = this.cassette;
      const request = interpolateValidatedH2Request(candidate.rawSeparationAngstrom, cassette);
      if (!request.supported) {
        this.failNumerically(candidate);
        return this.snapshot();
      }
      const target = densityFromH2Fock(buildH2Fock(candidate.density, request.matrices.core, request.matrices.eri), request.matrices.overlap);
      const mixed = candidate.density.map((value, index) => (1 - cassette.solver.damping) * value + cassette.solver.damping * target[index]);
      const nextEnergy = energyForH2Density(mixed, request.matrices.core, request.matrices.eri, request.matrices.enuc);
      const residual = maxAbsDifference(mixed, candidate.density);
      const energyDelta = candidate.iteration === 0 ? Number.POSITIVE_INFINITY : Math.abs(nextEnergy - candidate.energy);
      const electronCount = electronCountForH2Density(mixed, request.matrices.overlap);
      const electronCountError = Math.abs(electronCount - cassette.aoConvention.electronCount);
      if (![...mixed, nextEnergy, residual, electronCount, electronCountError].every(finite) || Number.isNaN(energyDelta)) throw new Error("H2 RHF fixed-point result became non-finite");
      candidate.density = mixed;
      candidate.energy = nextEnergy;
      candidate.residual = residual;
      candidate.energyDelta = energyDelta;
      candidate.electronCount = electronCount;
      candidate.electronCountError = electronCountError;
      candidate.iteration += 1;
      const strictPass = !this.seam.forceMaxIterations
        && residual <= cassette.solver.fixedPointDensityTolerance
        && energyDelta <= cassette.solver.fixedPointEnergyTolerance
        && electronCountError <= cassette.solver.electronCountTolerance;
      candidate.gateStreak = strictPass ? candidate.gateStreak + 1 : 0;
      this.gateStreak = candidate.gateStreak;
      this.record("tick", candidate, candidate.rawSeparationAngstrom, strictPass);
      if (strictPass) this.record("gate-pass", candidate, candidate.rawSeparationAngstrom, true);
      if (strictPass && candidate.gateStreak >= this.cassette.solver.consecutiveGateTicks && this.frozenCandidate === candidate) {
        this.promote(candidate);
      } else if (candidate.iteration >= cassette.solver.maxIterations && candidate.gateStreak < cassette.solver.consecutiveGateTicks) {
        this.failMaxIterations(candidate);
      }
    } catch {
      this.failNumerically(candidate);
    }
    return this.snapshot();
  }

  advanceTicks(count: number): H2RHFSnapshot {
    if (!Number.isFinite(count) || count < 0) throw new TypeError("H2 RHF tick count must be a non-negative finite number");
    const whole = Math.floor(count);
    for (let index = 0; index < whole; index += 1) this.tick();
    return this.snapshot();
  }

  snapshot(): H2RHFSnapshot {
    const movingCandidate = this.movingCandidate ? this.candidateSnapshot(this.movingCandidate, "moving") : null;
    const frozenCandidate = this.frozenCandidate ? this.candidateSnapshot(this.frozenCandidate, "frozen") : null;
    const candidate = movingCandidate ?? frozenCandidate;
    return immutableObject({
      tick: this.tickCount,
      contactEpoch: this.contactEpoch,
      targetId: this.targetId,
      contactActive: this.contactActive,
      outsideEnvelopeLatched: this.outsideEnvelopeLatched,
      disposition: this.disposition,
      movingCandidate,
      frozenCandidate,
      candidate,
      lastGood: this.lastGood,
      gateStreak: this.gateStreak,
      perRequestIterations: this.movingCandidate?.iteration ?? this.frozenCandidate?.iteration ?? 0,
      promotionGeneration: this.promotionGeneration,
      traceLength: this.traceEntries.length,
      milestones: Object.freeze(this.milestoneEntries.slice()),
    });
  }

  getSnapshot(): H2RHFSnapshot {
    return this.snapshot();
  }

  trace(): readonly H2RHFTraceEvent[] {
    return Object.freeze(this.traceEntries.slice());
  }

  getTrace(): readonly H2RHFTraceEvent[] {
    return this.trace();
  }

  milestones(): readonly H2RHFMilestone[] {
    return Object.freeze(this.milestoneEntries.slice());
  }

  private newCandidate(rawSeparationAngstrom: number, density: readonly number[], energy: number): InternalCandidate {
    return {
      targetId: this.targetId ?? DEFAULT_TARGET_ID,
      contactEpoch: this.contactEpoch ?? this.contactSequence,
      rawSeparationAngstrom,
      density: [...density],
      energy,
      residual: Number.POSITIVE_INFINITY,
      energyDelta: Number.POSITIVE_INFINITY,
      electronCount: 2,
      electronCountError: 0,
      iteration: 0,
      gateStreak: 0,
    };
  }

  private makeCheckpoint(targetId: string, separation: number, density: readonly number[], energy: number, electronCount: number, generation: number): H2RHFCheckpoint {
    const checkpoint = {
      targetId,
      separationAngstrom: quantize(separation),
      density: immutableArray(density),
      energy: quantize(energy),
      electronCount: quantize(electronCount),
      promotionGeneration: generation,
      digest: "",
    };
    return immutableObject({ ...checkpoint, digest: digestH2RHFCheckpoint(checkpoint) });
  }

  private candidateSnapshot(candidate: InternalCandidate, status: "moving" | "frozen"): H2RHFCandidateSnapshot {
    return immutableObject({
      targetId: candidate.targetId,
      contactEpoch: candidate.contactEpoch,
      status,
      rawSeparationAngstrom: quantize(candidate.rawSeparationAngstrom),
      requestSeparationAngstrom: quantize(candidate.rawSeparationAngstrom),
      density: immutableArray(candidate.density),
      energy: quantize(candidate.energy),
      residual: quantizedFinite(candidate.residual),
      energyDelta: quantizedFinite(candidate.energyDelta),
      electronCount: quantize(candidate.electronCount),
      electronCountError: quantize(candidate.electronCountError),
      iteration: candidate.iteration,
      gateStreak: candidate.gateStreak,
    });
  }

  private record(kind: H2RHFTraceKind, candidate: InternalCandidate | null, separation: number | null, gatePass: boolean | null): void {
    const event: H2RHFTraceEvent = immutableObject({
      kind,
      tick: this.tickCount,
      contactEpoch: candidate?.contactEpoch ?? this.contactEpoch,
      targetId: candidate?.targetId ?? this.targetId,
      disposition: this.disposition,
      iteration: candidate?.iteration ?? 0,
      gateStreak: candidate?.gateStreak ?? this.gateStreak,
      separationAngstrom: separation === null ? null : quantize(separation),
      residual: candidate ? quantizedFinite(candidate.residual) : null,
      energyDelta: candidate ? quantizedFinite(candidate.energyDelta) : null,
      electronCountError: candidate ? quantize(candidate.electronCountError) : null,
      promotionGeneration: this.promotionGeneration,
      checkpointDigest: this.lastGood?.digest ?? null,
      gatePass: gatePass ?? false,
    });
    this.traceEntries.push(event);
    while (this.traceEntries.length > this.traceLimit) this.traceEntries.shift();
    if (kind !== "tick" && kind !== "request-ignored") {
      this.milestoneEntries.push(event as H2RHFMilestone);
      while (this.milestoneEntries.length > this.traceLimit) this.milestoneEntries.shift();
    }
  }

  private promote(candidate: InternalCandidate): void {
    this.promotionGeneration += 1;
    this.lastGood = this.makeCheckpoint(candidate.targetId, candidate.rawSeparationAngstrom, candidate.density, candidate.energy, candidate.electronCount, this.promotionGeneration);
    this.frozenCandidate = null;
    this.movingCandidate = null;
    this.contactActive = false;
    this.outsideEnvelopeLatched = false;
    this.gateStreak = candidate.gateStreak;
    this.disposition = "promoted";
    this.record("promotion", null, candidate.rawSeparationAngstrom, true);
  }

  private failMaxIterations(candidate: InternalCandidate): void {
    this.movingCandidate = null;
    this.frozenCandidate = null;
    this.contactActive = false;
    this.outsideEnvelopeLatched = false;
    this.disposition = "max-iterations";
    this.gateStreak = candidate.gateStreak;
    this.record("max-iterations", candidate, candidate.rawSeparationAngstrom, false);
  }

  private failNumerically(candidate: InternalCandidate): void {
    this.movingCandidate = null;
    this.frozenCandidate = null;
    this.contactActive = false;
    this.outsideEnvelopeLatched = false;
    this.disposition = "numerical-failure";
    this.gateStreak = 0;
    this.record("numerical-failure", candidate, candidate.rawSeparationAngstrom, false);
  }
}

function isCassetteLike(value: unknown): value is H2RHFCassette {
  return typeof value === "object" && value !== null && ("nodes" in value || "cassetteVersion" in value || "modelTuple" in value);
}

export function createH2RHFAuthority(options?: H2RHFAuthorityOptions): H2RHFAuthority;
export function createH2RHFAuthority(cassette: H2RHFCassette | unknown, options?: H2RHFAuthorityOptions): H2RHFAuthority;
export function createH2RHFAuthority(first?: H2RHFAuthorityOptions | H2RHFCassette | unknown, second: H2RHFAuthorityOptions = {}): H2RHFAuthority {
  const options = isCassetteLike(first) ? second : (first as H2RHFAuthorityOptions | undefined) ?? {};
  const cassette = isCassetteLike(first) ? first : options.cassette ?? H2_RHF_CASSETTE;
  return new H2RHFAuthorityImpl(cassette, options);
}

export const createH2RHF = createH2RHFAuthority;
export const createH2Authority = createH2RHFAuthority;

type PendingCommand = { readonly command: H2RHFCommand; readonly dueTick: number; readonly sequence: number };

class H2RHFAdapterImpl implements H2RHFAdapter {
  private accumulatorMs = 0;
  private logicalTicks = 0;
  private sequence = 0;
  private rebaseCount = 0;
  private readonly queueEntries: PendingCommand[] = [];
  private readonly authority: H2RHFAuthority;
  private readonly tickMs: number;

  constructor(authority: H2RHFAuthority, tickMs = 50) {
    this.authority = authority;
    this.tickMs = tickMs;
  }

  queue(command: H2RHFCommand): H2RHFAdapterSnapshot {
    this.sequence += 1;
    this.queueEntries.push({ command: immutableObject({ ...command }), dueTick: this.logicalTicks + 1, sequence: this.sequence });
    return this.snapshot();
  }

  enqueue(command: H2RHFCommand): H2RHFAdapterSnapshot {
    return this.queue(command);
  }

  advance(presentationDeltaMs: number): H2RHFAdapterSnapshot {
    if (!finite(presentationDeltaMs) || presentationDeltaMs < 0) throw new TypeError("H2 RHF presentation delta must be a non-negative finite number");
    this.accumulatorMs += presentationDeltaMs;
    const epsilon = this.tickMs * 1e-9;
    while (this.accumulatorMs + epsilon >= this.tickMs) {
      this.accumulatorMs -= this.tickMs;
      if (Math.abs(this.accumulatorMs) < epsilon) this.accumulatorMs = 0;
      this.logicalTicks += 1;
      this.applyCommands();
      this.authority.tick();
    }
    return this.snapshot();
  }

  advancePresentation(presentationDeltaMs: number): H2RHFAdapterSnapshot {
    return this.advance(presentationDeltaMs);
  }

  tick(): H2RHFAdapterSnapshot {
    this.accumulatorMs = 0;
    this.logicalTicks += 1;
    this.applyCommands();
    this.authority.tick();
    return this.snapshot();
  }

  rebase(): H2RHFAdapterSnapshot {
    this.accumulatorMs = 0;
    this.rebaseCount += 1;
    return this.snapshot();
  }

  resume(): H2RHFAdapterSnapshot {
    return this.rebase();
  }

  onVisibility(hidden: boolean): H2RHFAdapterSnapshot {
    if (hidden) this.rebase();
    else this.rebase();
    return this.snapshot();
  }

  snapshot(): H2RHFAdapterSnapshot {
    return immutableObject({
      accumulatorMs: quantize(this.accumulatorMs),
      logicalTicks: this.logicalTicks,
      queuedCommands: this.queueEntries.length,
      rebaseCount: this.rebaseCount,
    });
  }

  private applyCommands(): void {
    if (this.queueEntries.length === 0) return;
    const due = this.queueEntries.filter((entry) => entry.dueTick <= this.logicalTicks).sort((left, right) => left.sequence - right.sequence);
    if (due.length === 0) return;
    for (const entry of due) this.authority.dispatch(entry.command);
    const dueSequences = new Set(due.map((entry) => entry.sequence));
    for (let index = this.queueEntries.length - 1; index >= 0; index -= 1) if (dueSequences.has(this.queueEntries[index].sequence)) this.queueEntries.splice(index, 1);
  }
}

export function createH2RHFAdapter(authority: H2RHFAuthority, tickMs = 50): H2RHFAdapter {
  if (!Number.isFinite(tickMs) || tickMs <= 0) throw new TypeError("H2 RHF adapter tick duration must be positive");
  return new H2RHFAdapterImpl(authority, tickMs);
}

export const createH2RHFClock = createH2RHFAdapter;
export const createH2RHFClockAdapter = createH2RHFAdapter;
