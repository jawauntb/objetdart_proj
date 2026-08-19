import type { SceneStyle } from "./scene-style.ts";
import { validateSceneStyle, type ContractValidation } from "./scene-style.ts";
import { isScaleAddress, NATIVE_SCALE_ADDRESSES, type ScaleAddress } from "./scale.ts";
import type { SimulationContract } from "./simulation.ts";
import { validateSimulationContract } from "./simulation.ts";

export const NATIVE_CONTRACT_VERSION = 1 as const;
export const CONTRACT_VERSIONS = Object.freeze({ native: NATIVE_CONTRACT_VERSION, action: 1, continuousGesture: 1, universe: 1, history: 1, scale: 1, simulation: 1, sceneStyle: 1 });
export type NativeSceneId = "wave" | "cell" | "solar";
export type RequiredContractCategory = "science" | "sensory" | "persistence" | "accessibility" | "guide" | "performance";
export type ApprovalEvidence = Readonly<{ status: "required" | "approved"; evidenceId: string }>;
export type RequirementEvidence = Readonly<{
  /** Immutable IDs for the records that demonstrate this category. */
  evidenceIds: readonly string[];
  reviewerId: string;
  approval: ApprovalEvidence;
}>;
export type ScienceRequirementEvidence = Readonly<RequirementEvidence & {
  /** Scientific sources that constrain the model rather than merely decorate it. */
  sourceIds: readonly string[];
}>;
export type RequiredContract = Readonly<{ version: 1; status: "required"; summary: string; evidence: RequirementEvidence }>;
export type ScienceRequiredContract = Readonly<Omit<RequiredContract, "evidence"> & { evidence: ScienceRequirementEvidence }>;
export type SceneRequirements = Readonly<{
  science: ScienceRequiredContract;
  sensory: RequiredContract;
  persistence: RequiredContract;
  accessibility: RequiredContract;
  guide: RequiredContract;
  performance: RequiredContract;
}>;
export type NativeSceneManifest = Readonly<{
  version: typeof NATIVE_CONTRACT_VERSION;
  id: NativeSceneId;
  release: "v1";
  scale: ScaleAddress;
  sharedIdentity: Readonly<{ parameter: "equilibrium-temperature-k"; relationship: string }>;
  simulation: SimulationContract;
  style: SceneStyle;
  requirements: SceneRequirements;
}>;

const REQUIRED_CATEGORIES: readonly RequiredContractCategory[] = ["science", "sensory", "persistence", "accessibility", "guide", "performance"];
export const SCIENCE_SOURCE_IDS: Readonly<Record<NativeSceneId, readonly string[]>> = {
  wave: ["wave-fdtd-taflove-hagness-2005", "wave-cooley-tukey-1965", "wave-nist-dlmf"],
  cell: ["cell-turing-1952", "cell-murray-2002", "cell-alberts-2022"],
  solar: ["solar-murray-dermott-1999", "solar-wisdom-holman-1991", "solar-hairer-lubich-wanner-2006"],
};

function isNativeSceneId(value: unknown): value is NativeSceneId {
  return value === "wave" || value === "cell" || value === "solar";
}

function requirements(sceneId: NativeSceneId, summary: Readonly<Record<RequiredContractCategory, string>>): SceneRequirements {
  const reviewerId: Record<RequiredContractCategory, string> = { science: "native-science-review", sensory: "native-sensory-review", persistence: "native-persistence-review", accessibility: "native-accessibility-review", guide: "native-guide-review", performance: "native-performance-review" };
  const entries = REQUIRED_CATEGORIES.map((category) => {
    const evidence: RequirementEvidence = { evidenceIds: [`${sceneId}-${category}-evidence-v1`], reviewerId: reviewerId[category], approval: { status: "required", evidenceId: `${sceneId}-${category}-approval-v1` } };
    const requirement = { version: 1 as const, status: "required" as const, summary: summary[category], evidence: category === "science" ? { ...evidence, sourceIds: SCIENCE_SOURCE_IDS[sceneId] } : evidence };
    return [category, requirement];
  });
  return Object.fromEntries(entries) as SceneRequirements;
}

function mappings(state: string, causalStatement: string) {
  return [{ state, causalStatement, senses: ["visual", "audio", "haptic"] as const }];
}

function style(id: string, field: string, forms: readonly string[], motion: string, verb: "material" | "grow" | "time-dilation", state: string, causalStatement: string): SceneStyle {
  return { version: 1, id, field, palette: ["night", "sea", "ember"], forms, motion, bannedForms: ["generic-particles", "glassmorphism", "dashboard-card", "stock-gradient", "game-hud"], stateToSense: mappings(state, causalStatement), gestureFeedback: [{ verb, state, senses: ["visual", "audio", "haptic"] }] };
}

function simulation(id: string, model: string, units: readonly { quantity: string; symbol: string }[], invariant: string, conserved: readonly string[], validity: string, intervention: string, state: string, causalStatement: string, reference: string, approximation: string): SimulationContract {
  return { version: 1, id, model, modelVersion: "v1", units, integrator: "fixed-step deterministic authority", invariants: [{ id: `${id}-invariant`, statement: invariant, tolerance: 0.000001 }], conservedQuantities: conserved, validity: [{ parameter: "release operating range", min: 0, max: 1, unit: "normalized", disclosure: validity }], interventions: [intervention], seededVariance: "all variation derives from the persisted universe seed", perceptualMappings: mappings(state, causalStatement), referenceCases: [{ id: `${id}-reference`, input: "canonical seeded fixture", expected: reference, tolerance: 0.000001 }], approximations: [approximation] };
}

export const RELEASE_SCENE_MANIFEST: readonly NativeSceneManifest[] = [
  { version: 1, id: "wave", release: "v1", scale: NATIVE_SCALE_ADDRESSES["wave-medium"], sharedIdentity: { parameter: "equilibrium-temperature-k", relationship: "temperature bounds damping in the selected wave medium" }, simulation: simulation("wave", "finite-difference wave field with spectral decomposition", [{ quantity: "length", symbol: "m" }, { quantity: "time", symbol: "s" }], "bounded numerical energy under the declared stable step", ["wave energy"], "Only stable Courant-limited steps are authoritative.", "create and combine waves", "amplitude and spectrum", "amplitude becomes brightness, pitch, and pulse without changing sign or frequency ordering", "analytical mode and spectral peak agree", "The field is reduced to a bounded grid."), style: style("wave", "a dark water field that makes interference legible", ["continuous-field", "spectral-rings"], "propagating and breathing", "material", "amplitude and spectrum", "amplitude and spectrum become light, pitch, and pulse"), requirements: requirements("wave", { science: "analytical, spectral, reconstruction, and validity fixtures", sensory: "state-derived synchronized sound and haptics", persistence: "seeded event log and checkpoints", accessibility: "named wave actions and stable summaries", guide: "post-discovery wave proof and notation", performance: "fixed-step authority with bounded field resolution" }) },
  { version: 1, id: "cell", release: "v1", scale: NATIVE_SCALE_ADDRESSES["cellular-colony"], sharedIdentity: { parameter: "equilibrium-temperature-k", relationship: "temperature changes declared reaction rates within the cell model validity range" }, simulation: simulation("cell", "deterministic cellular colony with reaction-diffusion and lineage", [{ quantity: "length", symbol: "µm" }, { quantity: "time", symbol: "s" }], "nutrient and lineage bookkeeping remain non-negative", ["nutrient mass"], "The colony uses bounded population and reduced reaction-diffusion fields.", "seed, feed, divide, differentiate, engulf, and retire", "nutrient gradient and lineage", "nutrient and lineage become membrane color, tone, and tactile division pulse", "canonical colony conserves bounded nutrient accounting", "The model retains causal competition rather than every molecular process."), style: style("cell", "a living membrane field with bounded lineage", ["membrane-loops", "reaction-field"], "slow division and responsive contraction", "grow", "nutrient gradient and lineage", "nutrient gradient and lineage become membrane light, tone, and pulse"), requirements: requirements("cell", { science: "conservation, reaction-diffusion, lineage, and absence fixtures", sensory: "division and uptake become coupled sight, sound, and haptics", persistence: "lineage and retirements remain recoverable history", accessibility: "bounded population groups and named interventions", guide: "post-discovery colony causality", performance: "bounded agents and closed-form background advancement" }) },
  { version: 1, id: "solar", release: "v1", scale: NATIVE_SCALE_ADDRESSES["solar-formation"], sharedIdentity: { parameter: "equilibrium-temperature-k", relationship: "temperature identifies the selected world's bounded equilibrium thread" }, simulation: simulation("solar", "deterministic reduced N-body accretion and orbital dynamics", [{ quantity: "mass", symbol: "kg" }, { quantity: "length", symbol: "m" }, { quantity: "time", symbol: "s" }], "energy and angular-momentum drift stay within declared integration tolerance", ["mass", "linear momentum"], "The release model uses bounded bodies and documented collision reduction.", "shape disk, alter mass and momentum, and accelerate time", "orbital energy and resonance", "orbital energy and resonance become trajectory light, harmonic interval, and detent pulse", "canonical two-body orbit remains within energy tolerance", "Collisions merge reduced bodies; full disk chemistry is outside the model."), style: style("solar", "a cold orbital dark where gravity writes arcs", ["orbital-arcs", "accretion-disks"], "slow precession with decisive collisions", "time-dilation", "orbital energy and resonance", "orbital energy and resonance become trajectories, intervals, and detent pulses"), requirements: requirements("solar", { science: "analytical, conservation, collision, resonance, and long-run fixtures", sensory: "state-derived orbital tone and collision haptics", persistence: "mergers and catastrophes append natural history", accessibility: "adjustable physical values and stable orbit summaries", guide: "post-discovery orbital cause and prediction", performance: "bounded body count and fixed-step authority" }) },
];

export const RELEASE_ONE_SCENE_IDS = RELEASE_SCENE_MANIFEST.map((scene) => scene.id) as readonly NativeSceneId[];

export function releaseSceneIds(manifest: readonly NativeSceneManifest[] = RELEASE_SCENE_MANIFEST): readonly NativeSceneId[] {
  return manifest.filter((scene) => scene.release === "v1").map((scene) => scene.id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.length > 0);
}

function hasExactSourceIds(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && value.length === expected.length && value.every((sourceId, index) => sourceId === expected[index]);
}

function isRequirementEvidence(value: unknown, sourceIds?: readonly string[]): boolean {
  if (!isRecord(value) || !nonEmptyStringArray(value.evidenceIds) || typeof value.reviewerId !== "string" || !value.reviewerId || !isRecord(value.approval) || (value.approval.status !== "required" && value.approval.status !== "approved") || typeof value.approval.evidenceId !== "string" || !value.approval.evidenceId) return false;
  return sourceIds === undefined || hasExactSourceIds(value.sourceIds, sourceIds);
}

function isRequiredContract(value: unknown, sourceIds?: readonly string[]): boolean {
  return isRecord(value) && value.version === 1 && value.status === "required" && typeof value.summary === "string" && value.summary.length > 0 && isRequirementEvidence(value.evidence, sourceIds);
}

export function validateReleaseSceneManifest(manifest: unknown): ContractValidation {
  const errors: string[] = [];
  if (!Array.isArray(manifest)) return { valid: false, errors: ["release manifest must be an array"] };
  const ids = new Set<string>();
  for (const value of manifest) {
    if (!isRecord(value)) {
      errors.push("release manifest contains a non-object scene");
      continue;
    }
    const id = typeof value.id === "string" ? value.id : "unknown";
    if (value.version !== NATIVE_CONTRACT_VERSION || value.release !== "v1") errors.push(`${id}: unsupported manifest version or release`);
    if (typeof value.id !== "string" || !value.id) errors.push("scene is missing an id");
    else if (ids.has(value.id)) errors.push(`${value.id}: duplicate scene id`);
    else ids.add(value.id);
    if (!isRecord(value.sharedIdentity) || value.sharedIdentity.parameter !== "equilibrium-temperature-k" || typeof value.sharedIdentity.relationship !== "string" || !value.sharedIdentity.relationship) errors.push(`${id}: missing shared identity relationship`);
    if (!isScaleAddress(value.scale)) errors.push(`${id}: invalid physical scale address`);
    if (!isRecord(value.requirements)) errors.push(`${id}: missing requirements`);
    else for (const category of REQUIRED_CATEGORIES) if (!isRequiredContract(value.requirements[category], category === "science" && isNativeSceneId(value.id) ? SCIENCE_SOURCE_IDS[value.id] : category === "science" ? [] : undefined)) errors.push(`${id}: missing ${category} requirement evidence`);
    for (const error of validateSimulationContract(value.simulation).errors) errors.push(`${id}: ${error}`);
    for (const error of validateSceneStyle(value.style).errors) errors.push(`${id}: ${error}`);
  }
  const expected: readonly NativeSceneId[] = ["wave", "cell", "solar"];
  if (manifest.length !== expected.length || expected.some((id) => !ids.has(id))) errors.push("Release 1 must declare exactly wave, cell, and solar.");
  return { valid: errors.length === 0, errors };
}
