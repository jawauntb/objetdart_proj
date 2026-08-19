import { isSemanticVerb, type SemanticVerb } from "./actions.ts";

export const SCENE_STYLE_VERSION = 1 as const;
export const GENERIC_BANNED_FORMS = ["generic-particles", "glassmorphism", "dashboard-card", "stock-gradient", "game-hud"] as const;

export type Sense = "visual" | "audio" | "haptic";
export type StateToSenseMapping = Readonly<{
  state: string;
  senses: readonly Sense[];
  causalStatement: string;
}>;
export type GestureFeedback = Readonly<{
  verb: SemanticVerb;
  state: string;
  senses: readonly Sense[];
}>;
export type SceneStyle = Readonly<{
  version: typeof SCENE_STYLE_VERSION;
  id: string;
  field: string;
  palette: readonly string[];
  forms: readonly string[];
  motion: string;
  bannedForms: readonly string[];
  stateToSense: readonly StateToSenseMapping[];
  gestureFeedback: readonly GestureFeedback[];
}>;

export type ContractValidation = Readonly<{ valid: boolean; errors: readonly string[] }>;
const SENSES: readonly Sense[] = ["visual", "audio", "haptic"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasTwoKnownSenses(value: unknown): value is readonly Sense[] {
  return Array.isArray(value) && new Set(value).size >= 2 && value.every((sense) => typeof sense === "string" && SENSES.includes(sense as Sense));
}

function isStateMapping(value: unknown): value is StateToSenseMapping {
  return isRecord(value) && typeof value.state === "string" && value.state.length > 0 && typeof value.causalStatement === "string" && value.causalStatement.length > 0 && hasTwoKnownSenses(value.senses);
}

function isGestureFeedback(value: unknown): value is GestureFeedback {
  return isRecord(value) && isSemanticVerb(value.verb) && typeof value.state === "string" && value.state.length > 0 && hasTwoKnownSenses(value.senses);
}

export function validateSceneStyle(style: unknown): ContractValidation {
  const errors: string[] = [];
  if (typeof style !== "object" || style === null) return { valid: false, errors: ["style must be an object"] };
  const candidate = style as Partial<SceneStyle>;
  if (candidate.version !== SCENE_STYLE_VERSION) errors.push("style version is unsupported");
  if (typeof candidate.id !== "string" || !candidate.id || typeof candidate.field !== "string" || !candidate.field || typeof candidate.motion !== "string" || !candidate.motion) errors.push("style needs identity, field, and motion");
  if (!Array.isArray(candidate.palette) || candidate.palette.length === 0 || candidate.palette.some((colour) => typeof colour !== "string" || !colour)) errors.push("style needs a palette");
  if (!Array.isArray(candidate.forms) || candidate.forms.length === 0 || candidate.forms.some((form) => typeof form !== "string" || !form)) errors.push("style needs forms");
  if (Array.isArray(candidate.forms) && candidate.forms.some((form) => GENERIC_BANNED_FORMS.includes(form as typeof GENERIC_BANNED_FORMS[number]))) errors.push("style uses a banned generic form");
  if (!Array.isArray(candidate.bannedForms) || GENERIC_BANNED_FORMS.some((form) => !candidate.bannedForms?.includes(form))) errors.push("style must declare every generic banned form");
  if (!Array.isArray(candidate.stateToSense) || candidate.stateToSense.length === 0 || candidate.stateToSense.some((mapping) => !isStateMapping(mapping))) errors.push("every state mapping needs a causal statement and two senses");
  if (!Array.isArray(candidate.gestureFeedback) || candidate.gestureFeedback.length === 0 || candidate.gestureFeedback.some((mapping) => !isGestureFeedback(mapping))) errors.push("every gesture feedback mapping needs a verb, state, and two senses");
  return { valid: errors.length === 0, errors };
}
