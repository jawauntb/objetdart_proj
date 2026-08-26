/**
 * Presentation-only seams for the bounded H₂ RHF instrument.
 *
 * The authority owns the density, gates, support envelope, and terminal
 * disposition.  This file may read that immutable snapshot, but it never
 * solves, edits, or promotes scientific state.  The eight projection lanes
 * are intentionally compact so a caller can keep one Float32Array alive for
 * the life of a room:
 *
 *   [density[0], density[1], density[2], density[3], tension, footprint,
 *    phase, fieldStrength]
 *
 * The first four lanes are the authoritative AO density coefficients, copied
 * directly into the GPU record. `tension`, `footprint`, and `fieldStrength`
 * are bounded presentation lanes that remain identical when reduced motion is
 * enabled. `phase` is the presentation-only motion lane and is held at a
 * quiet detent for reduced motion. The target geometry is a visual envelope,
 * not a second source of H₂ values.
 */

import { H2_RHF_MODEL_TUPLE, digestH2RHFCheckpoint } from "./h2-rhf.ts";
import type {
  H2RHFCandidateSnapshot,
  H2RHFCheckpoint,
  H2RHFDisposition,
  H2RHFMilestone,
  H2RHFSnapshot,
} from "./h2-rhf.ts";

export const H2_RHF_PROJECTION_COMPONENTS = Object.freeze({
  density0: 0,
  density1: 1,
  density2: 2,
  density3: 3,
  tension: 4,
  footprint: 5,
  phase: 6,
  fieldStrength: 7,
  length: 8,
} as const);

export const H2_RHF_PROJECTION_LENGTH = H2_RHF_PROJECTION_COMPONENTS.length;

export type H2RHFProjectionTarget = {
  /** Stable molecule identity. A mismatch disables the projection. */
  readonly targetId: string;
  /** CSS-pixel centre of the focused molecule. */
  readonly centerX: number;
  readonly centerY: number;
  /** CSS-pixel molecular body radius. */
  readonly radiusPx: number;
  /** CSS-pixel H–H separation used to shape the local field. */
  readonly separationPx: number;
};

/** A few names make the seam friendly to existing room geometry records. */
export type H2RHFProjectionTargetLike = {
  readonly targetId: string;
  readonly centerX?: number;
  readonly centerY?: number;
  readonly radiusPx?: number;
  readonly separationPx?: number;
  readonly x?: number;
  readonly y?: number;
  readonly radius?: number;
  readonly separation?: number;
};

export type H2RHFProjectionSource = "candidate" | "last-good";

export type H2RHFProjectionReadout = {
  readonly source: H2RHFProjectionSource;
  readonly targetId: string;
  readonly density: readonly number[];
  readonly residual: number | null;
  readonly separationAngstrom: number;
};

export type H2RHFTransitionCueKind = "correction" | "settled" | "refusal";

export type H2RHFOutcomeCode =
  | "correcting"
  | "promoted"
  | "outside-envelope"
  | "reference-unverified"
  | "max-iterations"
  | "numerical-failure"
  | "cancelled";

export type H2RHFRetrySemantics =
  | "continue-contact"
  | "no-retry-needed"
  | "release-then-retry"
  | "next-action-retry"
  | "restore-reference";

export type H2RHFOutcomeText = {
  /** Plain-language data for the sought accessibility surface. */
  readonly plain: string;
  /** Field-note data for the same non-room-visible outcome. */
  readonly field: string;
  readonly retry: string;
};

export type H2RHFTransitionCue = {
  /** Stable dedupe identity for both accessibility and sensory delivery. */
  readonly id: string;
  readonly modelVersion: string;
  /** Semantic category used by the shared buses. */
  readonly kind: `field-${"correcting" | "settled" | "refused"}`;
  readonly cueKind: H2RHFTransitionCueKind;
  readonly outcome: H2RHFOutcomeCode;
  readonly disposition: H2RHFDisposition;
  readonly tick: number;
  readonly contactEpoch: number | string | null;
  readonly promotionGeneration: number;
  readonly checkpointDigest: string | null;
  readonly targetId: string | null;
  readonly retry: H2RHFRetrySemantics;
  readonly outcomeText: H2RHFOutcomeText;
  readonly accessibility: {
    readonly announcement: string;
    readonly retry: H2RHFRetrySemantics;
  };
  readonly sensory: {
    readonly eventId: string;
    readonly intensity: number;
    readonly cadence: H2RHFTransitionCueKind;
  };
};

export type H2RHFTransitionCueState = {
  /** The trusted authority tuple this deduper belongs to. */
  readonly modelVersion: string;
  /** Last authority tick inspected by this deduper. */
  lastProcessedTick: number;
  /** Only identities from `lastProcessedTick` are retained. */
  readonly identitiesAtLastTick: Set<string>;
  /** Object-identity cursor into the authority's immutable milestone queue. */
  lastMilestone: H2RHFMilestone | null;
  /** True when more events elapsed than the bounded authority queue retained. */
  historyGapDetected: boolean;
};

export type H2RHFTransitionCueDeduper = {
  readonly emittedCount: number;
  drain(snapshot: H2RHFSnapshot): readonly H2RHFTransitionCue[];
  reset(): void;
};

const EMPTY_CUES: readonly H2RHFTransitionCue[] = Object.freeze([]);
const RESIDUAL_SCALE = 0.01;
const TRUSTED_MODEL_VERSION = H2_RHF_MODEL_TUPLE.modelVersion;

// Authority snapshots reuse the same immutable last-good checkpoint. Cache
// the one-time digest verification by checkpoint identity so the hot writer
// remains allocation-free after its first read, while malformed clones still
// fail closed through the existing authority digest helper.
const CHECKPOINT_DIGEST_VALIDITY = new WeakMap<object, boolean>();

const TERMINAL_DISPOSITIONS = new Set<H2RHFDisposition>([
  "outside-envelope",
  "reference-unverified",
  "max-iterations",
  "numerical-failure",
  "cancelled",
]);

const OUTCOME_DETAILS: Readonly<Record<H2RHFOutcomeCode, {
  readonly cueKind: H2RHFTransitionCueKind;
  readonly kind: `field-${"correcting" | "settled" | "refused"}`;
  readonly retry: H2RHFRetrySemantics;
  readonly plain: string;
  readonly field: string;
  readonly retryText: string;
}>> = Object.freeze({
  correcting: {
    cueKind: "correction",
    kind: "field-correcting",
    retry: "continue-contact",
    plain: "the field is correcting toward the held separation",
    field: "the provisional field is re-forming its self-consistent shape",
    retryText: "continue the contact to let the correction settle",
  },
  promoted: {
    cueKind: "settled",
    kind: "field-settled",
    retry: "no-retry-needed",
    plain: "the corrected field is settled",
    field: "the self-consistent field has taken the new place",
    retryText: "no retry is needed",
  },
  "outside-envelope": {
    cueKind: "refusal",
    kind: "field-refused",
    retry: "release-then-retry",
    plain: "that separation is outside the supported field",
    field: "the bounded cassette keeps the last good field at the shore",
    retryText: "release, then try again inside the supported range",
  },
  "reference-unverified": {
    cueKind: "refusal",
    kind: "field-refused",
    retry: "restore-reference",
    plain: "the reference field could not be verified",
    field: "the scientific source is unverified, so the old field stays",
    retryText: "restore the verified reference before trying again",
  },
  "max-iterations": {
    cueKind: "refusal",
    kind: "field-refused",
    retry: "release-then-retry",
    plain: "the field did not settle within its bounded correction",
    field: "the fixed-point gate remained open at the iteration shore",
    retryText: "release, then try the correction again",
  },
  "numerical-failure": {
    cueKind: "refusal",
    kind: "field-refused",
    retry: "release-then-retry",
    plain: "the field correction became unusable",
    field: "the numerical thread broke, so the last good field remains",
    retryText: "release, then try the correction again",
  },
  cancelled: {
    cueKind: "refusal",
    kind: "field-refused",
    retry: "next-action-retry",
    plain: "the field correction was cancelled",
    field: "the held correction was returned to the last good field",
    retryText: "the next action may begin a new correction",
  },
});

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function clamp01(value: number): number {
  if (!finite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function validDensity(value: readonly number[] | null | undefined): value is readonly number[] {
  return Array.isArray(value) && value.length === 4 && value.every(finite);
}

function validResidual(value: number | null): boolean {
  return value === null || (finite(value) && value >= 0);
}

function validCheckpointDigest(checkpoint: H2RHFCheckpoint): boolean {
  if (typeof checkpoint.digest !== "string" || checkpoint.digest.length === 0) return false;
  const cacheable = Object.isFrozen(checkpoint) && Object.isFrozen(checkpoint.density);
  const cached = cacheable ? CHECKPOINT_DIGEST_VALIDITY.get(checkpoint) : undefined;
  if (cached !== undefined) return cached;
  let valid = false;
  try {
    valid = digestH2RHFCheckpoint(checkpoint) === checkpoint.digest;
  } catch {
    valid = false;
  }
  if (cacheable) CHECKPOINT_DIGEST_VALIDITY.set(checkpoint, valid);
  return valid;
}

function candidateFor(snapshot: H2RHFSnapshot): H2RHFCandidateSnapshot | null {
  return snapshot.movingCandidate ?? snapshot.candidate ?? snapshot.frozenCandidate;
}

function checkpointSource(checkpoint: H2RHFCheckpoint | null): H2RHFProjectionReadout | null {
  if (!checkpoint || typeof checkpoint.targetId !== "string" || !validDensity(checkpoint.density)) return null;
  if (!validCheckpointDigest(checkpoint)) return null;
  if (![checkpoint.separationAngstrom, checkpoint.energy, checkpoint.electronCount, checkpoint.promotionGeneration].every(finite)) return null;
  return {
    source: "last-good",
    targetId: checkpoint.targetId,
    density: checkpoint.density,
    residual: 0,
    separationAngstrom: checkpoint.separationAngstrom,
  };
}

function candidateSource(candidate: H2RHFCandidateSnapshot | null): H2RHFProjectionReadout | null {
  if (!candidate || typeof candidate.targetId !== "string" || !validDensity(candidate.density)) return null;
  if (!validResidual(candidate.residual)) return null;
  if (![candidate.rawSeparationAngstrom, candidate.energy, candidate.electronCount, candidate.electronCountError, candidate.iteration, candidate.gateStreak].every(finite)) return null;
  return {
    source: "candidate",
    targetId: candidate.targetId,
    density: candidate.density,
    residual: candidate.residual,
    separationAngstrom: candidate.rawSeparationAngstrom,
  };
}

/**
 * Resolve the only scientifically legal field for a snapshot.  A refusal is
 * deliberately treated as last-good even if a malformed caller leaves a
 * candidate-shaped object beside it.
 */
export function h2RHFProjectionSource(snapshot: H2RHFSnapshot): H2RHFProjectionReadout | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  if (snapshot.disposition === "correcting") return candidateSource(candidateFor(snapshot));
  return checkpointSource(snapshot.lastGood);
}

/** Map an authoritative residual to bounded visual/audio tension. */
export function h2RHFResidualToTension(residual: number | null): number {
  if (residual === null || !finite(residual)) return 1;
  return clamp01(1 - Math.exp(-Math.max(0, residual) / RESIDUAL_SCALE));
}

function densityToFieldStrength(density: readonly number[]): number {
  // The norm is only a compact visual coefficient; it never feeds the map.
  const diagonal = (Math.abs(density[0]) + Math.abs(density[3])) * 0.5;
  const offDiagonal = (Math.abs(density[1]) + Math.abs(density[2])) * 0.5;
  return clamp01(0.18 + 0.48 * Math.tanh(diagonal + offDiagonal * 0.75));
}

/**
 * Write the bounded H₂ field projection into caller-owned scratch storage.
 * Returns false and clears `out` when the scientific target cannot be proved
 * to match the geometry.  The function never allocates or mutates `snapshot`.
 */
export function writeH2RHFProjection(
  snapshot: H2RHFSnapshot,
  target: H2RHFProjectionTargetLike,
  reducedMotion: boolean,
  out: Float32Array,
): boolean {
  if (!(out instanceof Float32Array) || out.length < H2_RHF_PROJECTION_LENGTH) throw new TypeError("H2 RHF projection requires Float32Array(8) scratch");
  out.fill(0);
  if (!snapshot || typeof snapshot !== "object" || !target || typeof target !== "object") return false;
  if (typeof target.targetId !== "string" || target.targetId.length === 0 || snapshot.targetId !== target.targetId) return false;
  const centerX = target.centerX ?? target.x;
  const centerY = target.centerY ?? target.y;
  const radiusPx = target.radiusPx ?? target.radius;
  const separationPx = target.separationPx ?? target.separation;
  if (typeof centerX !== "number" || typeof centerY !== "number" || typeof radiusPx !== "number" || typeof separationPx !== "number") return false;
  if (!finite(centerX) || !finite(centerY) || !finite(radiusPx) || !finite(separationPx) || radiusPx <= 0 || separationPx < 0) return false;

  let density: readonly number[] | null = null;
  let residual: number | null = null;
  let sourceTargetId: string | null = null;
  let candidateSourceActive = false;
  if (snapshot.disposition === "correcting") {
    const candidate = candidateFor(snapshot);
    if (candidate) {
      density = candidate.density;
      residual = candidate.residual;
      sourceTargetId = candidate.targetId;
      candidateSourceActive = true;
      if (!validDensity(density)
        || typeof sourceTargetId !== "string"
        || !finite(candidate.rawSeparationAngstrom)
        || !finite(candidate.energy)
        || !finite(candidate.electronCount)
        || !finite(candidate.electronCountError)
        || !finite(candidate.iteration)
        || !finite(candidate.gateStreak)
        || !validResidual(residual)) {
        return false;
      }
    }
  } else {
    const checkpoint = snapshot.lastGood;
    if (checkpoint) {
      density = checkpoint.density;
      sourceTargetId = checkpoint.targetId;
      if (!validDensity(density)
        || typeof sourceTargetId !== "string"
        || !validCheckpointDigest(checkpoint)
        || !finite(checkpoint.separationAngstrom)
        || !finite(checkpoint.energy)
        || !finite(checkpoint.electronCount)
        || !finite(checkpoint.promotionGeneration)) {
        return false;
      }
    }
  }
  if (!density || sourceTargetId !== target.targetId) return false;
  const fieldStrength = densityToFieldStrength(density);
  const tension = candidateSourceActive ? h2RHFResidualToTension(residual) : 0;
  const span = radiusPx + separationPx;
  const footprint = span > 0 ? clamp01(radiusPx / span) : 0;
  const geometryPhase = centerX * 0.017 + centerY * 0.013 + separationPx * 0.071;
  const densityPhase = density[0] * 0.19 + density[1] * 0.37 + density[3] * 0.23;
  const phase = reducedMotion ? 0.5 : fract(Math.abs(Math.sin(geometryPhase + densityPhase) * 43758.5453));
  out[H2_RHF_PROJECTION_COMPONENTS.density0] = density[0];
  out[H2_RHF_PROJECTION_COMPONENTS.density1] = density[1];
  out[H2_RHF_PROJECTION_COMPONENTS.density2] = density[2];
  out[H2_RHF_PROJECTION_COMPONENTS.density3] = density[3];
  out[H2_RHF_PROJECTION_COMPONENTS.tension] = tension;
  out[H2_RHF_PROJECTION_COMPONENTS.footprint] = footprint;
  out[H2_RHF_PROJECTION_COMPONENTS.phase] = clamp01(phase);
  out[H2_RHF_PROJECTION_COMPONENTS.fieldStrength] = fieldStrength;
  return true;
}

function outcomeForMilestone(milestone: H2RHFMilestone): H2RHFOutcomeCode | null {
  // A contact is the semantic transition into correction. Request milestones
  // are solver inputs within that same contact and must not buzz or announce
  // once per hold update.
  if (milestone.kind === "contact-begin") return "correcting";
  if (milestone.kind === "promotion") return "promoted";
  if (milestone.kind === "reference-unverified") return "reference-unverified";
  if (milestone.kind === "outside-envelope") return "outside-envelope";
  if (milestone.kind === "max-iterations") return "max-iterations";
  if (milestone.kind === "numerical-failure") return "numerical-failure";
  if (milestone.kind === "cancel" || milestone.disposition === "cancelled") return "cancelled";
  if (TERMINAL_DISPOSITIONS.has(milestone.disposition)) {
    return milestone.disposition as Exclude<H2RHFDisposition, "idle" | "correcting" | "promoted">;
  }
  return null;
}

/** The semantic identity is stable across repeated snapshot reads. */
export function h2RHFTransitionIdentity(
  milestone: H2RHFMilestone,
  modelVersion: string = TRUSTED_MODEL_VERSION,
): string {
  return [
    modelVersion,
    milestone.targetId ?? "",
    milestone.kind,
    milestone.tick,
    milestone.contactEpoch === null ? "" : String(milestone.contactEpoch),
    milestone.promotionGeneration,
    milestone.checkpointDigest ?? "",
  ].join("|");
}

function cueForMilestone(milestone: H2RHFMilestone, identity: string): H2RHFTransitionCue | null {
  const outcome = outcomeForMilestone(milestone);
  if (!outcome) return null;
  const details = OUTCOME_DETAILS[outcome];
  const id = `h2-rhf:${identity}`;
  const intensity = outcome === "correcting"
    ? clamp01(0.24 + h2RHFResidualToTension(milestone.residual) * 0.56)
    : outcome === "promoted" ? 0.82 : 0.62;
  return Object.freeze({
    id,
    modelVersion: TRUSTED_MODEL_VERSION,
    kind: details.kind,
    cueKind: details.cueKind,
    outcome,
    disposition: milestone.disposition,
    tick: milestone.tick,
    contactEpoch: milestone.contactEpoch,
    promotionGeneration: milestone.promotionGeneration,
    checkpointDigest: milestone.checkpointDigest,
    targetId: milestone.targetId,
    retry: details.retry,
    outcomeText: Object.freeze({ plain: details.plain, field: details.field, retry: details.retryText }),
    accessibility: Object.freeze({ announcement: details.plain, retry: details.retry }),
    sensory: Object.freeze({ eventId: id, intensity, cadence: details.cueKind }),
  });
}

export function createH2RHFTransitionCueState(_legacyMaxKeys?: number): H2RHFTransitionCueState {
  // The former max-key argument is intentionally ignored. A deduper belongs
  // to one monotonic authority, so retaining only the current tick is both
  // bounded and stronger than evicting identities from an arbitrary window.
  return {
    modelVersion: TRUSTED_MODEL_VERSION,
    lastProcessedTick: -1,
    identitiesAtLastTick: new Set<string>(),
    lastMilestone: null,
    historyGapDetected: false,
  };
}

/**
 * Project only semantic milestones. Tick records and gate passes intentionally
 * produce no cue; a solver may run for many ticks without spamming a bus.
 * The cursor assumes integration drains after each adapter advance and that
 * a hidden/rebased presentation advances zero authority ticks. If a caller
 * delays long enough for the authority's bounded milestone history to drop
 * entries, no presentation-only seam can reconstruct those lost events.
 */
export function projectH2RHFTransitionCues(
  snapshot: H2RHFSnapshot,
  state: H2RHFTransitionCueState,
): readonly H2RHFTransitionCue[] {
  if (!snapshot || !state || !(state.identitiesAtLastTick instanceof Set)) return EMPTY_CUES;
  // A lower tick means the caller replaced the authority without resetting
  // its cursor. Do not replay a previous authority's history accidentally;
  // integration resets explicitly when it replaces an authority.
  if (snapshot.tick < state.lastProcessedTick) return EMPTY_CUES;
  const milestones = snapshot.milestones;
  const tail = milestones.length > 0 ? milestones[milestones.length - 1] : null;
  if (tail === state.lastMilestone) {
    if (state.lastProcessedTick < snapshot.tick) {
      state.lastProcessedTick = snapshot.tick;
      state.identitiesAtLastTick.clear();
    }
    return EMPTY_CUES;
  }

  let startIndex = 0;
  if (state.lastMilestone !== null) {
    const previousIndex = milestones.indexOf(state.lastMilestone);
    if (previousIndex >= 0) startIndex = previousIndex + 1;
    else state.historyGapDetected = true;
  }
  let cues: H2RHFTransitionCue[] | null = null;
  for (let index = startIndex; index < milestones.length; index += 1) {
    const milestone = milestones[index];
    if (milestone.tick < state.lastProcessedTick) continue;
    if (milestone.tick > state.lastProcessedTick) {
      state.lastProcessedTick = milestone.tick;
      state.identitiesAtLastTick.clear();
    }
    const identity = h2RHFTransitionIdentity(milestone, state.modelVersion);
    if (state.identitiesAtLastTick.has(identity)) continue;
    // Mark even an intentionally silent milestone as seen so a malformed or
    // future event cannot be retried every frame after its first inspection.
    state.identitiesAtLastTick.add(identity);
    const cue = cueForMilestone(milestone, identity);
    if (cue) {
      if (cues === null) cues = [];
      cues.push(cue);
    }
  }
  // If this logical tick carried no milestone, still advance the cursor so
  // subsequent presentation frames skip old history without building keys.
  if (state.lastProcessedTick < snapshot.tick) {
    state.lastProcessedTick = snapshot.tick;
    state.identitiesAtLastTick.clear();
  }
  state.lastMilestone = tail;
  return cues === null ? EMPTY_CUES : Object.freeze(cues);
}

export function createH2RHFTransitionCueDeduper(_legacyMaxKeys?: number): H2RHFTransitionCueDeduper {
  const state = createH2RHFTransitionCueState();
  return {
    get emittedCount() { return state.identitiesAtLastTick.size; },
    drain(snapshot) { return projectH2RHFTransitionCues(snapshot, state); },
    reset() {
      state.lastProcessedTick = -1;
      state.identitiesAtLastTick.clear();
      state.lastMilestone = null;
      state.historyGapDetected = false;
    },
  };
}
