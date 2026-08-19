/** Stable, renderer-free actions that are safe to persist and replay. */

export const ACTION_CONTRACT_VERSION = 1 as const;
export const CONTINUOUS_GESTURE_VERSION = 1 as const;
export const CONTINUOUS_SAMPLE_HZ = 20 as const;
export const CONTINUOUS_SAMPLE_MS = 1000 / CONTINUOUS_SAMPLE_HZ;
export const CONTINUOUS_CHUNK_MS = 250 as const;
const SAMPLES_PER_CHUNK = CONTINUOUS_CHUNK_MS / CONTINUOUS_SAMPLE_MS;

export type ActionLayer = "material" | "representation" | "world" | "vessel" | "accessibility";

export type SemanticVerb =
  | "material"
  | "step-back"
  | "tutti"
  | "train"
  | "scale"
  | "lens"
  | "season"
  | "pan"
  | "weather"
  | "time-dilation"
  | "grow"
  | "ceremony"
  | "agitate"
  | "gravity"
  | "wake"
  | "night"
  | "breath";

export type ActionSource = "touch" | "pencil" | "vessel" | "keyboard" | "assistive" | "system";
export type ActionValue = string | number | boolean | null;
export type ActionPayload = Readonly<Record<string, ActionValue | readonly ActionValue[]>>;

export type SemanticAction = Readonly<{
  verb: SemanticVerb;
  layer: ActionLayer;
  source: ActionSource;
  intensity: number;
  payload: ActionPayload;
}>;

export type VersionedAction = Readonly<{
  version: typeof ACTION_CONTRACT_VERSION;
  id: string;
  logicalTime: number;
  action: SemanticAction;
}>;

export type UnsupportedAction = Readonly<{
  supported: false;
  reason: "invalid-json" | "unsupported-version" | "invalid-action";
  raw: string;
}>;

export type DecodedAction = Readonly<{ supported: true; value: VersionedAction }> | UnsupportedAction;

const VERBS: readonly SemanticVerb[] = [
  "material", "step-back", "tutti", "train", "scale", "lens", "season", "pan",
  "weather", "time-dilation", "grow", "ceremony", "agitate", "gravity", "wake", "night", "breath",
];
const LAYERS: readonly ActionLayer[] = ["material", "representation", "world", "vessel", "accessibility"];
const SOURCES: readonly ActionSource[] = ["touch", "pencil", "vessel", "keyboard", "assistive", "system"];
const RENDERER_FIELD = /(?:renderer|render|canvas|frame|pixel|shader|gpu|webgl|metal)/i;
const ACTION_FIELDS = ["verb", "layer", "source", "intensity", "payload"] as const;
const VERSIONED_ACTION_FIELDS = ["version", "id", "logicalTime", "action"] as const;
const CONTINUOUS_KINDS = ["drag", "hold", "pinch", "twist", "pan", "weather", "time-dilation"] as const;

export function isSemanticVerb(value: unknown): value is SemanticVerb {
  return typeof value === "string" && VERBS.includes(value as SemanticVerb);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(value).every((key) => fields.includes(key));
}

function isActionValue(value: unknown): value is ActionValue | readonly ActionValue[] {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  return Array.isArray(value) && value.every((item) => item === null || typeof item === "string" || typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item)));
}

/** Reject presentation fields so an event cannot become renderer-specific state. */
export function isVersionedAction(value: unknown): value is VersionedAction {
  if (!isRecord(value) || !hasOnlyFields(value, VERSIONED_ACTION_FIELDS) || Object.keys(value).some((key) => RENDERER_FIELD.test(key)) || value.version !== ACTION_CONTRACT_VERSION || typeof value.id !== "string" || !value.id || !Number.isSafeInteger(value.logicalTime) || (value.logicalTime as number) < 0 || !isRecord(value.action)) return false;
  const { action } = value;
  if (!hasOnlyFields(action, ACTION_FIELDS) || Object.keys(action).some((key) => RENDERER_FIELD.test(key)) || !isSemanticVerb(action.verb) || !LAYERS.includes(action.layer as ActionLayer) || !SOURCES.includes(action.source as ActionSource) || typeof action.intensity !== "number" || !Number.isFinite(action.intensity) || action.intensity < 0 || action.intensity > 1 || !isRecord(action.payload)) return false;
  return Object.entries(action.payload).every(([key, item]) => !RENDERER_FIELD.test(key) && isActionValue(item));
}

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Object.is(value, -0) ? "0" : String(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
  }
  throw new Error("Cannot serialize a non-finite action value.");
}

export function serializeAction(value: VersionedAction): string {
  if (!isVersionedAction(value)) throw new Error("Cannot serialize an invalid semantic action.");
  return canonicalize(value);
}

/** Keeps a raw future payload recoverable instead of guessing how to apply it. */
export function deserializeAction(raw: string): DecodedAction {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { supported: false, reason: "invalid-json", raw };
  }
  if (!isRecord(parsed) || parsed.version !== ACTION_CONTRACT_VERSION) return { supported: false, reason: "unsupported-version", raw };
  return isVersionedAction(parsed) ? { supported: true, value: parsed } : { supported: false, reason: "invalid-action", raw };
}

export type ContinuousGestureKind = "drag" | "hold" | "pinch" | "twist" | "pan" | "weather" | "time-dilation";
export type GestureSample = Readonly<{ atMs: number; x: number; y: number; intensity: number }>;
/** Touch-down and touch-up times from the gesture recognizer, not renderer frames. */
export type GestureWindow = Readonly<{ startedAtMs: number; endedAtMs: number }>;
export type QuantizedGestureSample = Readonly<{ atMs: number; x: number; y: number; intensity: number }>;
export type GestureChunk = Readonly<{ index: number; fromMs: number; toMs: number; samples: readonly QuantizedGestureSample[] }>;
export type ContinuousGestureTransaction = Readonly<{
  version: typeof CONTINUOUS_GESTURE_VERSION;
  gestureId: string;
  kind: ContinuousGestureKind;
  sampleHz: typeof CONTINUOUS_SAMPLE_HZ;
  chunkMs: typeof CONTINUOUS_CHUNK_MS;
  startedAtMs: number;
  endedAtMs: number;
  chunks: readonly GestureChunk[];
  final: QuantizedGestureSample;
}>;

export type UnsupportedContinuousGesture = Readonly<{
  supported: false;
  reason: "invalid-json" | "unsupported-version" | "invalid-transaction";
  raw: string;
}>;
export type DecodedContinuousGesture = Readonly<{ supported: true; value: ContinuousGestureTransaction }> | UnsupportedContinuousGesture;

function roundTo(value: number, denominator: number): number {
  const rounded = Math.round(value * denominator) / denominator;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function validSample(sample: GestureSample): boolean {
  return Number.isFinite(sample.atMs) && Number.isFinite(sample.x) && Number.isFinite(sample.y) && Number.isFinite(sample.intensity) && sample.intensity >= 0 && sample.intensity <= 1;
}

function gridIndex(atMs: number): number {
  return Math.round(atMs / CONTINUOUS_SAMPLE_MS);
}

function validGestureWindow(value: GestureWindow): boolean {
  return Number.isFinite(value.startedAtMs) && Number.isFinite(value.endedAtMs) && value.endedAtMs >= value.startedAtMs;
}

function isQuantizedSample(value: unknown): value is QuantizedGestureSample {
  if (!isRecord(value) || !hasOnlyFields(value, ["atMs", "x", "y", "intensity"])) return false;
  return Number.isFinite(value.atMs) && Math.round((value.atMs as number) * 1000) === (value.atMs as number) * 1000 && Number.isFinite(value.x) && Math.round((value.x as number) * 1024) === (value.x as number) * 1024 && Number.isFinite(value.y) && Math.round((value.y as number) * 1024) === (value.y as number) * 1024 && Number.isFinite(value.intensity) && Math.round((value.intensity as number) * 1024) === (value.intensity as number) * 1024 && (value.intensity as number) >= 0 && (value.intensity as number) <= 1;
}

export function isContinuousGestureKind(value: unknown): value is ContinuousGestureKind {
  return typeof value === "string" && CONTINUOUS_KINDS.includes(value as ContinuousGestureKind);
}

/** Validates the durable, presentation-rate-independent gesture wire format. */
export function isContinuousGestureTransaction(value: unknown): value is ContinuousGestureTransaction {
  if (!isRecord(value) || !hasOnlyFields(value, ["version", "gestureId", "kind", "sampleHz", "chunkMs", "startedAtMs", "endedAtMs", "chunks", "final"])) return false;
  if (value.version !== CONTINUOUS_GESTURE_VERSION || typeof value.gestureId !== "string" || !value.gestureId || !isContinuousGestureKind(value.kind) || value.sampleHz !== CONTINUOUS_SAMPLE_HZ || value.chunkMs !== CONTINUOUS_CHUNK_MS || !Number.isFinite(value.startedAtMs) || !Number.isFinite(value.endedAtMs) || (value.endedAtMs as number) < (value.startedAtMs as number) || !Array.isArray(value.chunks) || !isQuantizedSample(value.final)) return false;
  const startedAtMs = value.startedAtMs as number;
  const endedAtMs = value.endedAtMs as number;
  const startedIndex = gridIndex(startedAtMs);
  const endedIndex = gridIndex(endedAtMs);
  if (startedAtMs !== startedIndex * CONTINUOUS_SAMPLE_MS || endedAtMs !== endedIndex * CONTINUOUS_SAMPLE_MS) return false;
  const chunks = value.chunks as unknown[];
  const expectedChunkCount = Math.ceil((endedIndex - startedIndex) / SAMPLES_PER_CHUNK);
  if (chunks.length !== expectedChunkCount || value.final.atMs !== roundTo(endedAtMs, 1000)) return false;
  const actualSamples: QuantizedGestureSample[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const chunkStartIndex = startedIndex + index * SAMPLES_PER_CHUNK;
    if (!isRecord(chunk) || !hasOnlyFields(chunk, ["index", "fromMs", "toMs", "samples"]) || chunk.index !== chunkStartIndex || chunk.fromMs !== chunkStartIndex * CONTINUOUS_SAMPLE_MS || chunk.toMs !== Math.min(endedAtMs, (chunkStartIndex + SAMPLES_PER_CHUNK) * CONTINUOUS_SAMPLE_MS) || !Array.isArray(chunk.samples) || !chunk.samples.every(isQuantizedSample) || chunk.samples.some((sample) => sample.atMs < (chunk.fromMs as number) || sample.atMs >= (chunk.toMs as number))) return false;
    actualSamples.push(...chunk.samples);
  }
  const expectedSamples: number[] = [];
  for (let sampleIndex = startedIndex; sampleIndex < endedIndex; sampleIndex += 1) expectedSamples.push(roundTo(sampleIndex * CONTINUOUS_SAMPLE_MS, 1000));
  return actualSamples.length === expectedSamples.length && actualSamples.every((sample, index) => sample.atMs === expectedSamples[index]);
}

export function deserializeContinuousGesture(raw: string): DecodedContinuousGesture {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { supported: false, reason: "invalid-json", raw };
  }
  if (!isRecord(parsed) || parsed.version !== CONTINUOUS_GESTURE_VERSION) return { supported: false, reason: "unsupported-version", raw };
  return isContinuousGestureTransaction(parsed) ? { supported: true, value: parsed } : { supported: false, reason: "invalid-transaction", raw };
}

function interpolate(samples: readonly GestureSample[], atMs: number): GestureSample {
  let right = 0;
  while (right < samples.length && samples[right].atMs < atMs) right += 1;
  const a = right === 0 ? samples[0] : right === samples.length ? samples[Math.max(0, samples.length - 2)] : samples[right - 1];
  const b = right === 0 ? samples[Math.min(1, samples.length - 1)] : samples[Math.min(right, samples.length - 1)];
  const span = b.atMs - a.atMs;
  const t = span === 0 ? 1 : (atMs - a.atMs) / span;
  return { atMs, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, intensity: a.intensity + (b.intensity - a.intensity) * t };
}

function quantize(sample: GestureSample): QuantizedGestureSample {
  return { atMs: roundTo(sample.atMs, 1000), x: roundTo(sample.x, 1024), y: roundTo(sample.y, 1024), intensity: roundTo(sample.intensity, 1024) };
}

/**
 * Converts presentation-rate samples into the one durable gesture representation.
 * Interpolation is deliberately based on time, not received-frame count.
 */
export function serializeContinuousGesture(gestureId: string, kind: ContinuousGestureKind, input: readonly GestureSample[], window: GestureWindow): ContinuousGestureTransaction {
  if (!gestureId || !isContinuousGestureKind(kind) || input.length === 0 || !input.every(validSample) || !validGestureWindow(window)) throw new Error("A continuous gesture needs finite samples, a kind, an id, and an explicit window.");
  const samples = [...input].sort((a, b) => a.atMs - b.atMs);
  const startedIndex = gridIndex(window.startedAtMs);
  const endedIndex = gridIndex(window.endedAtMs);
  if (endedIndex < startedIndex) throw new Error("A gesture window must not end before its normalized start.");
  const startedAtMs = startedIndex * CONTINUOUS_SAMPLE_MS;
  const endedAtMs = endedIndex * CONTINUOUS_SAMPLE_MS;
  const sampled: QuantizedGestureSample[] = [];
  for (let sampleIndex = startedIndex; sampleIndex < endedIndex; sampleIndex += 1) sampled.push(quantize(interpolate(samples, sampleIndex * CONTINUOUS_SAMPLE_MS)));
  const chunkCount = Math.ceil((endedIndex - startedIndex) / SAMPLES_PER_CHUNK);
  const chunks: GestureChunk[] = Array.from({ length: chunkCount }, (_, index) => {
    const chunkStartIndex = startedIndex + index * SAMPLES_PER_CHUNK;
    const fromMs = chunkStartIndex * CONTINUOUS_SAMPLE_MS;
    const toMs = Math.min(endedAtMs, (chunkStartIndex + SAMPLES_PER_CHUNK) * CONTINUOUS_SAMPLE_MS);
    return { index: chunkStartIndex, fromMs, toMs, samples: sampled.filter((sample) => sample.atMs >= fromMs && sample.atMs < toMs) };
  });
  const transaction = { version: CONTINUOUS_GESTURE_VERSION, gestureId, kind, sampleHz: CONTINUOUS_SAMPLE_HZ, chunkMs: CONTINUOUS_CHUNK_MS, startedAtMs, endedAtMs, chunks, final: quantize(interpolate(samples, endedAtMs)) };
  if (!isContinuousGestureTransaction(transaction)) throw new Error("Continuous gesture serialization violated its contract.");
  return transaction;
}
