import type { StateToSenseMapping } from "./scene-style.ts";

export const SIMULATION_CONTRACT_VERSION = 1 as const;

export type Unit = Readonly<{ quantity: string; symbol: string }>;
export type SimulationInvariant = Readonly<{ id: string; statement: string; tolerance: number }>;
export type ValidityRange = Readonly<{ parameter: string; min: number; max: number; unit: string; disclosure: string }>;
export type ReferenceCase = Readonly<{ id: string; input: string; expected: string; tolerance: number }>;
export type SimulationContract = Readonly<{
  version: typeof SIMULATION_CONTRACT_VERSION;
  id: string;
  model: string;
  modelVersion: string;
  units: readonly Unit[];
  integrator: string;
  invariants: readonly SimulationInvariant[];
  conservedQuantities: readonly string[];
  validity: readonly ValidityRange[];
  interventions: readonly string[];
  seededVariance: string;
  perceptualMappings: readonly StateToSenseMapping[];
  referenceCases: readonly ReferenceCase[];
  approximations: readonly string[];
}>;

export type SimulationValidation = Readonly<{ valid: boolean; errors: readonly string[] }>;

function nonEmptyStrings(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasStateToSenseMapping(value: unknown): value is StateToSenseMapping {
  if (!isRecord(value) || typeof value.state !== "string" || !value.state || typeof value.causalStatement !== "string" || !value.causalStatement || !Array.isArray(value.senses)) return false;
  const senses = value.senses;
  return new Set(senses).size >= 2 && senses.every((sense) => sense === "visual" || sense === "audio" || sense === "haptic");
}

/** Validates the scientific facts a scene must make reviewable before it can run. */
export function validateSimulationContract(contract: unknown): SimulationValidation {
  const errors: string[] = [];
  if (typeof contract !== "object" || contract === null) return { valid: false, errors: ["simulation contract must be an object"] };
  const candidate = contract as Partial<SimulationContract>;
  if (candidate.version !== SIMULATION_CONTRACT_VERSION) errors.push("simulation version is unsupported");
  if (typeof candidate.id !== "string" || !candidate.id || typeof candidate.model !== "string" || !candidate.model || typeof candidate.modelVersion !== "string" || !candidate.modelVersion || typeof candidate.integrator !== "string" || !candidate.integrator) errors.push("simulation needs identity, model, version, and integrator");
  if (!Array.isArray(candidate.units) || candidate.units.length === 0 || candidate.units.some((unit) => !isRecord(unit) || typeof unit.quantity !== "string" || !unit.quantity || typeof unit.symbol !== "string" || !unit.symbol)) errors.push("simulation needs named units");
  if (!Array.isArray(candidate.invariants) || candidate.invariants.length === 0 || candidate.invariants.some((item) => !isRecord(item) || typeof item.id !== "string" || !item.id || typeof item.statement !== "string" || !item.statement || !Number.isFinite(item.tolerance) || (item.tolerance as number) < 0)) errors.push("simulation needs finite invariant tolerances");
  if (!nonEmptyStrings(candidate.conservedQuantities)) errors.push("simulation needs conserved quantities");
  if (!Array.isArray(candidate.validity) || candidate.validity.length === 0 || candidate.validity.some((item) => !isRecord(item) || typeof item.parameter !== "string" || !item.parameter || typeof item.unit !== "string" || !item.unit || typeof item.disclosure !== "string" || !item.disclosure || !Number.isFinite(item.min) || !Number.isFinite(item.max) || (item.min as number) > (item.max as number))) errors.push("simulation needs declared validity ranges");
  if (!nonEmptyStrings(candidate.interventions)) errors.push("simulation needs an intervention surface");
  if (typeof candidate.seededVariance !== "string" || !candidate.seededVariance) errors.push("simulation needs seeded variance disclosure");
  if (!Array.isArray(candidate.perceptualMappings) || candidate.perceptualMappings.length === 0 || candidate.perceptualMappings.some((mapping) => !hasStateToSenseMapping(mapping))) errors.push("simulation needs perceptual mappings with two senses");
  if (!Array.isArray(candidate.referenceCases) || candidate.referenceCases.length === 0 || candidate.referenceCases.some((item) => !isRecord(item) || typeof item.id !== "string" || !item.id || typeof item.input !== "string" || !item.input || typeof item.expected !== "string" || !item.expected || !Number.isFinite(item.tolerance) || (item.tolerance as number) < 0)) errors.push("simulation needs reference cases");
  if (!nonEmptyStrings(candidate.approximations)) errors.push("simulation needs approximation disclosures");
  return { valid: errors.length === 0, errors };
}
