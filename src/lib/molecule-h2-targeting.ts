/**
 * Pure targeting and first-creation policy for the molecule room.
 *
 * A body is addressed by its persisted id, never by its array position or its
 * seed.  The resolver is deliberately shared by touch, keyboard, and
 * assistive callers: they all provide the same virtual screen point and get
 * the same semantic binding.  Once a binding exists, later frames may move or
 * reorder the population, but they may not choose a different body.
 */

import { compoundFromSeed, reactionOf } from "@/lib/chemistry";

/** The one seed reserved for the first H₂ instrument encounter. */
export const CANONICAL_H2_SEED = 109017827 as const;
export const CANONICAL_H2_COMPOUND = "H2" as const;

// Fail closed if the curated chemistry library ever changes this evidence
// seam.  A future seed-table edit must update the explicit canonical starter,
// rather than silently turning the H₂ route into another compound.
if (compoundFromSeed(CANONICAL_H2_SEED).key !== CANONICAL_H2_COMPOUND) {
  throw new Error("canonical H2 seed no longer maps to H2");
}

export type MoleculeTargetBody = Readonly<{
  /** Persisted identity; this is the only target key the contact may carry. */
  readonly id: string;
  readonly seed: number;
  readonly compound: string;
  /** CSS/screen-pixel centre and hit radius. */
  readonly x: number;
  readonly y: number;
  /** The hand's hit envelope: max(34px, raw interaction radius × 1.25). */
  readonly hitRadius: number;
  /** The raw visual/body radius used by docking geometry. */
  readonly interactionRadius: number;
  readonly closed: boolean;
  readonly retiring: boolean;
}>;

export type MoleculeTargetBodyInput = Readonly<{
  readonly id: string;
  readonly seed: number;
  readonly compound: string;
  readonly x: number;
  readonly y: number;
  /** Raw screen/body radius from the renderer. */
  readonly radius: number;
  readonly closed: boolean;
  readonly retiring: boolean;
}>;

export type MoleculeScreenPoint = Readonly<{
  readonly x: number;
  readonly y: number;
}>;

export type MoleculeInputMode = "touch" | "keyboard" | "assistive";

/** Optional source metadata is accepted, but never changes semantic output. */
export type MoleculeContactInput = MoleculeScreenPoint &
  Readonly<{
    readonly inputMode?: MoleculeInputMode;
    readonly contactEpoch?: number | string;
  }>;

export type MoleculeContactMode = "reaction" | "h2-rhf" | "molecule";

export type MoleculeContactBinding = Readonly<{
  readonly status: "bound";
  readonly bodyId: string;
  /** Alias for callers whose domain vocabulary is target rather than body. */
  readonly targetId: string;
  readonly mode: MoleculeContactMode;
  /** Present only when an existing docking/reaction partner won the branch. */
  readonly partnerId: string | null;
  /** The entry-time docking geometry is part of the semantic binding. */
  readonly dockReachFactor: number;
  readonly contactEpoch: number | string | null;
}>;

export type MoleculeContactCancellation = Readonly<{
  readonly status: "cancelled";
  readonly reason:
    | "no-hit"
    | "invalid-point"
    | "ambiguous-targets"
    | "target-missing"
    | "target-retired"
    | "partner-missing"
    | "partner-retired"
    | "partner-unavailable";
  readonly bodyId: string | null;
  readonly targetId: string | null;
}>;

export type MoleculeContactResult = MoleculeContactBinding | MoleculeContactCancellation;

/** Existing room geometry uses 1.7× the summed radii as docking reach. */
export const DOCK_REACH_FACTOR = 1.7 as const;
export const MIN_HIT_RADIUS = 34 as const;
export const HIT_RADIUS_FACTOR = 1.25 as const;

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function validBody(body: MoleculeTargetBody): boolean {
  return (
    typeof body.id === "string" &&
    body.id.length > 0 &&
    finite(body.seed) &&
    typeof body.compound === "string" &&
    finite(body.x) &&
    finite(body.y) &&
    finite(body.hitRadius) &&
    body.hitRadius >= 0 &&
    finite(body.interactionRadius) &&
    body.interactionRadius >= 0 &&
    typeof body.closed === "boolean" &&
    typeof body.retiring === "boolean"
  );
}

/** Derive the two room geometry radii without letting hit testing alter docking. */
export function createMoleculeTargetBody(input: MoleculeTargetBodyInput): MoleculeTargetBody {
  if (!finite(input.radius) || input.radius < 0) throw new Error("molecule radius must be finite and non-negative");
  return Object.freeze({
    id: input.id,
    seed: input.seed,
    compound: input.compound,
    x: input.x,
    y: input.y,
    hitRadius: Math.max(MIN_HIT_RADIUS, input.radius * HIT_RADIUS_FACTOR),
    interactionRadius: input.radius,
    closed: input.closed,
    retiring: input.retiring,
  });
}

/** A duplicate or malformed stable-id set is unsafe to resolve. */
export function validateMoleculeTargetBodies(bodies: readonly MoleculeTargetBody[]): boolean {
  for (let index = 0; index < bodies.length; index += 1) {
    const body = bodies[index];
    if (!validBody(body)) return false;
    for (let previous = 0; previous < index; previous += 1) {
      if (bodies[previous].id === body.id) return false;
    }
  }
  return true;
}

function liveClosed(body: MoleculeTargetBody): boolean {
  return validBody(body) && body.closed && !body.retiring;
}

function distanceSquared(a: MoleculeScreenPoint, b: MoleculeTargetBody): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function idBefore(a: string, b: string): boolean {
  return a < b;
}

/**
 * Resolve the nearest body under a screen point.  Equal-distance bodies are
 * ordered by stable id, so population array order cannot affect the result.
 */
export function resolveMoleculeTarget(
  bodies: readonly MoleculeTargetBody[],
  point: MoleculeScreenPoint,
): MoleculeTargetBody | null {
  if (!validateMoleculeTargetBodies(bodies) || !finite(point.x) || !finite(point.y)) return null;
  let best: MoleculeTargetBody | null = null;
  let bestDistance = Infinity;
  for (const body of bodies) {
    if (!validBody(body) || body.retiring) continue;
    const d2 = distanceSquared(point, body);
    const r2 = body.hitRadius * body.hitRadius;
    if (d2 > r2) continue;
    if (
      best === null ||
      d2 < bestDistance ||
      (d2 === bestDistance && idBefore(body.id, best.id))
    ) {
      best = body;
      bestDistance = d2;
    }
  }
  return best;
}

/**
 * Return the nearest stable partner which can take the existing docking /
 * reaction branch.  A partner is a closed, live body in docking reach.  The
 * reaction table is consulted as evidence when available, but docking remains
 * a valid existing ceremony for pairs without a curated equation.
 */
export function resolveMoleculeDockingPartner(
  target: MoleculeTargetBody,
  bodies: readonly MoleculeTargetBody[],
  reachFactor = DOCK_REACH_FACTOR,
): MoleculeTargetBody | null {
  if (
    !validateMoleculeTargetBodies(bodies) ||
    !liveClosed(target) ||
    !finite(reachFactor) ||
    reachFactor < 0
  ) return null;
  let best: MoleculeTargetBody | null = null;
  let bestDistance = Infinity;
  for (const body of bodies) {
    if (body.id === target.id || !liveClosed(body)) continue;
    const d2 = distanceSquared(target, body);
    const reach = (target.interactionRadius + body.interactionRadius) * reachFactor;
    if (d2 > reach * reach) continue;
    if (
      best === null ||
      d2 < bestDistance ||
      (d2 === bestDistance && idBefore(body.id, best.id))
    ) {
      best = body;
      bestDistance = d2;
    }
  }
  return best;
}

/** Whether the chemistry table recognizes the two bodies as a reaction pair. */
export function isCuratedReactionPair(a: MoleculeTargetBody, b: MoleculeTargetBody): boolean {
  return reactionOf(a.compound, b.compound) !== null;
}

function bound(
  target: MoleculeTargetBody,
  mode: MoleculeContactMode,
  partner: MoleculeTargetBody | null,
  dockReachFactor: number,
  contactEpoch: number | string | null,
): MoleculeContactBinding {
  return Object.freeze({
    status: "bound" as const,
    bodyId: target.id,
    targetId: target.id,
    mode,
    partnerId: partner?.id ?? null,
    dockReachFactor,
    contactEpoch,
  });
}

function cancelled(
  reason: MoleculeContactCancellation["reason"],
  bodyId: string | null,
): MoleculeContactCancellation {
  return Object.freeze({
    status: "cancelled" as const,
    reason,
    bodyId,
    targetId: bodyId,
  });
}

/**
 * Resolve the semantic action exactly once at contact entry.
 *
 * The input mode is intentionally ignored after type-checking.  A keyboard
 * virtual cursor and a touch point therefore share the same target law.  A
 * closed H₂ with no eligible partner receives the RHF branch; an existing
 * partner always wins before that branch is considered.
 */
export function resolveMoleculeContact(
  bodies: readonly MoleculeTargetBody[],
  input: MoleculeContactInput,
  reachFactor = DOCK_REACH_FACTOR,
): MoleculeContactResult {
  if (!validateMoleculeTargetBodies(bodies)) return cancelled("ambiguous-targets", null);
  if (!finite(input.x) || !finite(input.y)) return cancelled("invalid-point", null);
  const target = resolveMoleculeTarget(bodies, input);
  if (!target) return cancelled("no-hit", null);

  const partner = resolveMoleculeDockingPartner(target, bodies, reachFactor);
  if (partner) {
    return bound(target, "reaction", partner, reachFactor, input.contactEpoch ?? null);
  }
  if (liveClosed(target) && target.compound === CANONICAL_H2_COMPOUND) {
    return bound(target, "h2-rhf", null, reachFactor, input.contactEpoch ?? null);
  }
  return bound(target, "molecule", null, reachFactor, input.contactEpoch ?? null);
}

/** Alias that makes the entry-time nature explicit at call sites. */
export const bindMoleculeContact = resolveMoleculeContact;

function findById(
  bodies: readonly MoleculeTargetBody[],
  id: string,
): MoleculeTargetBody | null {
  for (const body of bodies) {
    if (body.id === id) return body;
  }
  return null;
}

/**
 * Validate a previously bound contact against the current population without
 * running hit testing again.  Movement and reordering are harmless; a missing
 * or retiring bound body (or its bound partner) cancels instead of retargeting.
 */
export function resolveBoundMoleculeContact(
  binding: MoleculeContactBinding,
  bodies: readonly MoleculeTargetBody[],
): MoleculeContactResult {
  if (binding.status !== "bound") return cancelled("target-missing", binding.targetId ?? null);
  if (!validateMoleculeTargetBodies(bodies)) return cancelled("ambiguous-targets", binding.bodyId);
  const target = findById(bodies, binding.bodyId);
  if (!target) return cancelled("target-missing", binding.bodyId);
  if (!validBody(target) || target.retiring) return cancelled("target-retired", binding.bodyId);

  if (binding.mode === "h2-rhf" && (!liveClosed(target) || target.compound !== CANONICAL_H2_COMPOUND)) {
    return cancelled(target.retiring ? "target-retired" : "target-missing", binding.bodyId);
  }
  if (binding.mode === "reaction" && binding.partnerId) {
    if (!liveClosed(target)) return cancelled(target.retiring ? "target-retired" : "partner-unavailable", binding.bodyId);
    const partner = findById(bodies, binding.partnerId);
    if (!partner) return cancelled("partner-missing", binding.bodyId);
    if (!validBody(partner) || partner.retiring) return cancelled("partner-retired", binding.bodyId);
    if (
      !partner.closed ||
      (target.interactionRadius + partner.interactionRadius) * binding.dockReachFactor <
        Math.hypot(target.x - partner.x, target.y - partner.y)
    ) {
      return cancelled("partner-unavailable", binding.bodyId);
    }
  }
  return binding;
}

/** A readable alias for the cancellation-safe continuation check. */
export const continueMoleculeContact = resolveBoundMoleculeContact;

export type MoleculeCreationStatus = "missing" | "fresh" | "valid-empty" | "valid-populated";

export type MoleculeCreationRecord = Readonly<{
  readonly id: string;
  readonly seed: number;
  readonly compound: string;
  readonly retiring?: boolean;
}>;

export type MoleculeCreationState<T extends MoleculeCreationRecord = MoleculeCreationRecord> = Readonly<{
  readonly status: MoleculeCreationStatus;
  readonly molecules: readonly T[];
  /** True means the next open-field action, not loading, gets canonical H₂. */
  readonly nextOpenFieldUsesCanonicalH2: boolean;
}>;

export type InitializeMoleculeCreationInput<T extends MoleculeCreationRecord> = Readonly<{
  readonly status: MoleculeCreationStatus;
  readonly molecules?: readonly T[];
  /** Caller creates the body and owns its id and ordinal. */
  readonly canonicalH2Starter?: T;
}>;

function isActiveH2(record: MoleculeCreationRecord): boolean {
  return record.compound === CANONICAL_H2_COMPOUND && record.retiring !== true;
}

function assertCanonicalStarter(record: MoleculeCreationRecord): void {
  if (
    typeof record.id !== "string" ||
    record.id.length === 0 ||
    record.retiring === true ||
    record.seed !== CANONICAL_H2_SEED ||
    record.compound !== CANONICAL_H2_COMPOUND
  ) {
    throw new Error("canonical H2 starter must use the trusted seed and compound");
  }
}

/**
 * Apply load semantics without inventing ids or ordinals.  Missing/fresh may
 * supply one caller-owned canonical starter.  Valid empty and valid populated
 * states are returned unchanged; their first subsequent open-field creation
 * is the deterministic place where H₂ becomes available.
 */
export function initializeMoleculeCreationState<T extends MoleculeCreationRecord>(
  input: InitializeMoleculeCreationInput<T>,
): MoleculeCreationState<T> {
  const molecules = input.molecules ?? [];
  const hasH2 = molecules.some(isActiveH2);
  if ((input.status === "missing" || input.status === "fresh") && !hasH2 && input.canonicalH2Starter) {
    assertCanonicalStarter(input.canonicalH2Starter);
    return Object.freeze({
      status: input.status,
      molecules: Object.freeze([...molecules, input.canonicalH2Starter]),
      nextOpenFieldUsesCanonicalH2: false,
    });
  }
  return Object.freeze({
    status: input.status,
    molecules,
    nextOpenFieldUsesCanonicalH2: !hasH2,
  });
}

export type OpenFieldCreationRequest<T extends MoleculeCreationRecord> = Readonly<{
  readonly callerSeed: number;
  /** Caller supplies id, ordinal, geometry, and any room-local fields. */
  readonly makeMolecule: (seed: number) => T;
}>;

export type OpenFieldCreationResult<T extends MoleculeCreationRecord> = Readonly<{
  readonly state: MoleculeCreationState<T>;
  readonly molecule: T;
  readonly seed: number;
  readonly usedCanonicalH2: boolean;
}>;

/**
 * Choose the next open-field seed and append the caller-owned molecule.  A
 * no-H₂ state consumes the canonical seed exactly once; all later actions use
 * the caller's deterministic seed.  Restored or multiple H₂ states never
 * consume the canonical seed again.
 */
export function createMoleculeOnOpenField<T extends MoleculeCreationRecord>(
  state: MoleculeCreationState<T>,
  request: OpenFieldCreationRequest<T>,
): OpenFieldCreationResult<T> {
  if (!Number.isSafeInteger(request.callerSeed) || request.callerSeed < 0) {
    throw new Error("caller seed must be a non-negative safe integer");
  }
  const usedCanonicalH2 = state.nextOpenFieldUsesCanonicalH2;
  const seed = usedCanonicalH2 ? CANONICAL_H2_SEED : request.callerSeed;
  const molecule = request.makeMolecule(seed);
  if (usedCanonicalH2) assertCanonicalStarter(molecule);
  const nextState = Object.freeze({
    status: "valid-populated" as const,
    molecules: Object.freeze([...state.molecules, molecule]),
    nextOpenFieldUsesCanonicalH2: false,
  });
  return Object.freeze({ state: nextState, molecule, seed, usedCanonicalH2 });
}

/** Return whether an active state already contains one or more H₂ bodies. */
export function hasActiveH2<T extends MoleculeCreationRecord>(molecules: readonly T[]): boolean {
  return molecules.some(isActiveH2);
}
