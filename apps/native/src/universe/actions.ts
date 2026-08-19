/**
 * U5 — semantic action assembler for the native cosmogony garden.
 *
 * Mirrors `src/lib/gesture/defaults.ts` on the web side. Every native input
 * source (touch, ordinary Pencil contact, keyboard, VoiceOver custom action,
 * device motion, timeline scrub) funnels through the assemblers here so a
 * single `VersionedAction` shape describes intent regardless of origin.
 *
 * The grammar is defined once, in `NATIVE_GESTURE_THRESHOLDS`, copied verbatim
 * from `src/lib/gesture/core.ts`. Swift's `GestureRouter` reads the same
 * numbers from its constants file — the cross-language fixture pin in
 * `__tests__/UniverseActions.test.tsx` proves they never drift.
 *
 * Renderer keys are intentionally impossible to express: every SemanticAction
 * produced here passes `isVersionedAction`, which rejects fields matching
 * /(renderer|render|canvas|frame|pixel|shader|gpu|webgl|metal)/i.
 */

import {
  CONTINUOUS_CHUNK_MS,
  CONTINUOUS_SAMPLE_HZ,
  CONTINUOUS_SAMPLE_MS,
  ACTION_CONTRACT_VERSION,
  isVersionedAction,
  serializeAction,
  type ActionLayer,
  type ActionPayload,
  type ActionSource,
  type SemanticAction,
  type SemanticVerb,
  type VersionedAction,
} from "@objet/universe-contracts";

/**
 * The single source of truth for native gesture thresholds. The web classifier
 * lives at `src/lib/gesture/core.ts` — these values MUST match verbatim, and
 * `GestureRouter.swift` MUST hold a Swift constant table with the identical
 * numbers. The cross-language fixture test compares both against this map.
 *
 * DO NOT CHANGE ANY NUMBER without changing the same number in
 * `src/lib/gesture/core.ts` (TypeScript grammar) and
 * `apps/native/modules/objet-universe/ios/GestureRouter.swift` (Swift grammar).
 */
export const NATIVE_GESTURE_THRESHOLDS = Object.freeze({
  dwellMs: 900,
  ceremonyMs: 2500,
  tapMaxMs: 250,
  tapTrainMs: 280,
  moveTolPx: 12,
  flickVel: 0.6,
  scrubWinding: 0.75,
  pinchDeadzone: 0.03,
  twistDeadzoneRad: 0.1,
  shakeThresh: 16,
  knockThresh: 22,
  voiceStaggerMs: 80,
  voiceDecideMs: 180,
  spanEnterMs: 350,
  spanTolPx: 16,
} as const);

export type NativeGestureThresholds = typeof NATIVE_GESTURE_THRESHOLDS;

/**
 * Re-exported continuous gesture wire constants so the native module never
 * imports different literals from the contract package.
 */
export const NATIVE_CONTINUOUS_GESTURE = Object.freeze({
  sampleHz: CONTINUOUS_SAMPLE_HZ,
  sampleMs: CONTINUOUS_SAMPLE_MS,
  chunkMs: CONTINUOUS_CHUNK_MS,
} as const);

const RENDERER_FIELD = /(?:renderer|render|canvas|frame|pixel|shader|gpu|webgl|metal)/i;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function assertNoRendererKeys(payload: Readonly<Record<string, unknown>>): void {
  for (const key of Object.keys(payload)) {
    if (RENDERER_FIELD.test(key)) {
      throw new Error(`Semantic action payload rejected renderer-shaped key: ${key}`);
    }
  }
}

/**
 * Every native input path lands here. `assembleAction` returns a
 * `VersionedAction` that has already been round-tripped through
 * `isVersionedAction`, so callers cannot smuggle renderer state into the
 * durable log.
 */
export function assembleAction(input: AssembleInput): VersionedAction {
  const intensity = clamp01(input.intensity);
  assertNoRendererKeys(input.payload);
  const action: SemanticAction = Object.freeze({
    verb: input.verb,
    layer: input.layer,
    source: input.source,
    intensity,
    payload: Object.freeze({ ...input.payload }) as ActionPayload,
  });
  const versioned: VersionedAction = Object.freeze({
    version: ACTION_CONTRACT_VERSION,
    id: input.id,
    logicalTime: input.logicalTime,
    action,
  });
  if (!isVersionedAction(versioned)) {
    throw new Error(
      `assembleAction produced an invalid VersionedAction: ${serializeAction.name} would reject verb=${input.verb} layer=${input.layer}`,
    );
  }
  return versioned;
}

export type AssembleInput = Readonly<{
  id: string;
  logicalTime: number;
  verb: SemanticVerb;
  layer: ActionLayer;
  source: ActionSource;
  intensity: number;
  payload: ActionPayload;
}>;

/**
 * A single gesture-shape descriptor the router normalizes each recognizer
 * emit into. Native touch, VoiceOver custom actions, and keyboard shortcuts
 * all feed this shape — never a raw UIGestureRecognizer.
 */
export type NativeGestureShape =
  | Readonly<{ kind: "tap"; fingers: 1 | 2 | 3; count: number; x: number; y: number; intensity: number }>
  | Readonly<{ kind: "hold"; fingers: 1 | 2 | 3; elapsedMs: number; x: number; y: number; intensity: number }>
  | Readonly<{ kind: "drag"; fingers: 1 | 2 | 3; dx: number; dy: number; vx: number; vy: number; x: number; y: number }>
  | Readonly<{ kind: "flick"; fingers: 1 | 2 | 3; speed: number; angle: number; x: number; y: number }>
  | Readonly<{ kind: "twist"; fingers: 2 | 3; angleRad: number; velocity: number }>
  | Readonly<{ kind: "pinch"; scale: number; velocity: number }>
  | Readonly<{ kind: "scrub"; winding: number; angularVelocity: number; cx: number; cy: number }>
  | Readonly<{ kind: "span"; phase: "enter" | "tick" | "release"; spread: number; elapsedMs: number; cx: number; cy: number }>
  | Readonly<{ kind: "shake"; intensity: number }>
  | Readonly<{ kind: "tilt"; beta: number; gamma: number }>
  | Readonly<{ kind: "knock"; intensity: number }>
  | Readonly<{ kind: "flip"; faceDown: boolean }>
  | Readonly<{ kind: "breath"; strength: number }>;

/**
 * The 23-verb site-wide grammar, mirrored from
 * `src/lib/gesture/defaults.ts` GLOBAL_VERBS. Kept as a native-side reference
 * so the accessibility layer can enumerate every reachable meaning without
 * importing the web `next` bundle.
 */
export const NATIVE_GLOBAL_VERBS = Object.freeze([
  { grammarVerb: "tap",           semanticVerb: "material",       layer: "material",       owner: "room",  meaning: "touch the material — scaled by how hard it landed" },
  { grammarVerb: "tap2",          semanticVerb: "step-back",      layer: "representation", owner: "room",  meaning: "step back — the frame retreats one step; a raised lens lowers" },
  { grammarVerb: "tap3",          semanticVerb: "tutti",          layer: "material",       owner: "room",  meaning: "tutti — everything alive answers softly at once" },
  { grammarVerb: "holdDwell",     semanticVerb: "grow",           layer: "material",       owner: "room",  meaning: "plant / grow / charge, deepening for as long as it is held" },
  { grammarVerb: "holdCeremony",  semanticVerb: "ceremony",       layer: "material",       owner: "room",  meaning: "the room's one solemn act" },
  { grammarVerb: "hold3",         semanticVerb: "time-dilation",  layer: "world",          owner: "room",  meaning: "time dilation while held" },
  { grammarVerb: "drag",          semanticVerb: "material",       layer: "material",       owner: "room",  meaning: "stroke the material" },
  { grammarVerb: "drag3",         semanticVerb: "weather",        layer: "world",          owner: "room",  meaning: "wind / weather" },
  { grammarVerb: "flick",         semanticVerb: "material",       layer: "material",       owner: "room",  meaning: "throw, skip, dismiss" },
  { grammarVerb: "scrub",         semanticVerb: "material",       layer: "material",       owner: "room",  meaning: "stir — a circular path, any finger count" },
  { grammarVerb: "span",          semanticVerb: "material",       layer: "material",       owner: "room",  meaning: "sustain — two still fingers holding an interval open" },
  { grammarVerb: "twist",         semanticVerb: "lens",           layer: "representation", owner: "room",  meaning: "rotate the lens — level of description at fixed scale" },
  { grammarVerb: "twist3",        semanticVerb: "season",         layer: "world",          owner: "room",  meaning: "advance / rewind the room's season" },
  { grammarVerb: "rhythm",        semanticVerb: "train",          layer: "material",       owner: "room",  meaning: "entrain the room's clock to the hand's tempo" },
  { grammarVerb: "drum",          semanticVerb: "material",       layer: "material",       owner: "room",  meaning: "percussion between two zones the hands alternate" },
  { grammarVerb: "arpeggio",      semanticVerb: "material",       layer: "material",       owner: "room",  meaning: "a staggered chord — narrate the roll" },
  { grammarVerb: "shake",         semanticVerb: "agitate",        layer: "vessel",         owner: "room",  meaning: "scatter / agitate" },
  { grammarVerb: "tilt",          semanticVerb: "gravity",        layer: "vessel",         owner: "room",  meaning: "gravity" },
  { grammarVerb: "knock",         semanticVerb: "wake",           layer: "vessel",         owner: "room",  meaning: "wake / ring the room" },
  { grammarVerb: "flip",          semanticVerb: "night",          layer: "vessel",         owner: "room",  meaning: "night" },
  { grammarVerb: "breath",        semanticVerb: "breath",         layer: "vessel",         owner: "room",  meaning: "the candle" },
  { grammarVerb: "pinch",         semanticVerb: "scale",          layer: "representation", owner: "shell", meaning: "zoom within the band; held through the detent, travel" },
  { grammarVerb: "pan2",          semanticVerb: "pan",            layer: "representation", owner: "shell", meaning: "pan the frame" },
] as const);

export type NativeGrammarVerb = (typeof NATIVE_GLOBAL_VERBS)[number]["grammarVerb"];

/**
 * Semantic commands emitted by the router. `native.gestureShape` never
 * touches the durable log — it is telemetry the accessibility layer and the
 * U6 sensory clock use to shape their acknowledgements.
 */
export type NativeSemanticCommand = Readonly<{
  action: VersionedAction;
  source: ActionSource;
  gestureShape: NativeGestureShape;
}>;

/** Emitted by the router when nothing has landed for {@link idleWindowMs}. */
export type IdleInvitation = Readonly<{
  reason: "idle";
  idleForMs: number;
  suggestedFingers: 2 | 3;
}>;

/**
 * Emitted only after a real near-miss: an ambiguous chord landing that could
 * have been a two- or three-finger gesture but was withdrawn without
 * committing. Never a generic tutorial.
 */
export type NearMissInvitation = Readonly<{
  reason: "near-miss";
  observedFingers: 2 | 3;
  withdrawnAfterMs: number;
}>;

export type DiscoveryInvitation = IdleInvitation | NearMissInvitation;

/**
 * Continuous magnitudes chosen to keep duration and intensity as axes rather
 * than tier switches. See `docs/gesture-grammar.md`.
 */
export function intensityFromNativeShape(shape: NativeGestureShape): number {
  switch (shape.kind) {
    case "tap":
    case "hold":
      return clamp01(shape.intensity);
    case "drag":
      return clamp01(Math.hypot(shape.vx, shape.vy) / 3);
    case "flick":
      return clamp01(shape.speed / 3);
    case "twist":
      return clamp01(Math.abs(shape.angleRad) / Math.PI);
    case "pinch":
      return clamp01(Math.abs(shape.scale - 1));
    case "scrub":
      return clamp01(Math.abs(shape.winding));
    case "span":
      return clamp01(shape.elapsedMs / 4000);
    case "shake":
      return clamp01(shape.intensity);
    case "tilt":
      return clamp01(Math.hypot(shape.beta, shape.gamma) / 180);
    case "knock":
      return clamp01(shape.intensity);
    case "flip":
      return shape.faceDown ? 1 : 0;
    case "breath":
      return clamp01(shape.strength);
  }
}

/**
 * Choose the (verb, layer) pair the shape resolves to under the site-wide
 * grammar. Mirrors the branching inside `roomGestureBindings`, but stays a
 * pure lookup — rooms cannot rebind meanings on the native side.
 */
export function resolveVerbFromShape(shape: NativeGestureShape): { verb: SemanticVerb; layer: ActionLayer } {
  switch (shape.kind) {
    case "tap": {
      if (shape.fingers >= 3) return { verb: "tutti", layer: "material" };
      if (shape.fingers === 2) return { verb: "step-back", layer: "representation" };
      return { verb: "material", layer: "material" };
    }
    case "hold": {
      if (shape.fingers >= 3) return { verb: "time-dilation", layer: "world" };
      if (shape.elapsedMs >= NATIVE_GESTURE_THRESHOLDS.ceremonyMs) return { verb: "ceremony", layer: "material" };
      return { verb: "grow", layer: "material" };
    }
    case "drag": {
      if (shape.fingers >= 3) return { verb: "weather", layer: "world" };
      return { verb: "material", layer: "material" };
    }
    case "flick":
      return { verb: "material", layer: "material" };
    case "twist": {
      if (shape.fingers >= 3) return { verb: "season", layer: "world" };
      return { verb: "lens", layer: "representation" };
    }
    case "pinch":
      return { verb: "scale", layer: "representation" };
    case "scrub":
    case "span":
      return { verb: "material", layer: "material" };
    case "shake":
      return { verb: "agitate", layer: "vessel" };
    case "tilt":
      return { verb: "gravity", layer: "vessel" };
    case "knock":
      return { verb: "wake", layer: "vessel" };
    case "flip":
      return { verb: "night", layer: "vessel" };
    case "breath":
      return { verb: "breath", layer: "vessel" };
  }
}

/**
 * Build the durable payload for a gesture shape. Keys are deliberately
 * boring — no camelCase renderer field will pass the `isVersionedAction`
 * guard, so the compiler and the runtime enforce the same policy.
 */
export function payloadFromShape(shape: NativeGestureShape): ActionPayload {
  const payload: Record<string, string | number | boolean> = {};
  payload.kind = shape.kind;
  switch (shape.kind) {
    case "tap":
      payload.fingers = shape.fingers;
      payload.count = Math.max(1, Math.floor(shape.count));
      payload.x = shape.x;
      payload.y = shape.y;
      return Object.freeze(payload);
    case "hold":
      payload.fingers = shape.fingers;
      payload.elapsedMs = shape.elapsedMs;
      payload.x = shape.x;
      payload.y = shape.y;
      return Object.freeze(payload);
    case "drag":
      payload.fingers = shape.fingers;
      payload.dx = shape.dx;
      payload.dy = shape.dy;
      payload.x = shape.x;
      payload.y = shape.y;
      return Object.freeze(payload);
    case "flick":
      payload.fingers = shape.fingers;
      payload.speed = shape.speed;
      payload.angle = shape.angle;
      payload.x = shape.x;
      payload.y = shape.y;
      return Object.freeze(payload);
    case "twist":
      payload.fingers = shape.fingers;
      payload.angleRad = shape.angleRad;
      payload.velocity = shape.velocity;
      return Object.freeze(payload);
    case "pinch":
      payload.scale = shape.scale;
      payload.velocity = shape.velocity;
      return Object.freeze(payload);
    case "scrub":
      payload.winding = shape.winding;
      payload.angularVelocity = shape.angularVelocity;
      payload.cx = shape.cx;
      payload.cy = shape.cy;
      return Object.freeze(payload);
    case "span":
      payload.phase = shape.phase;
      payload.spread = shape.spread;
      payload.elapsedMs = shape.elapsedMs;
      payload.cx = shape.cx;
      payload.cy = shape.cy;
      return Object.freeze(payload);
    case "shake":
      payload.intensity = clamp01(shape.intensity);
      return Object.freeze(payload);
    case "tilt":
      payload.beta = shape.beta;
      payload.gamma = shape.gamma;
      return Object.freeze(payload);
    case "knock":
      payload.intensity = clamp01(shape.intensity);
      return Object.freeze(payload);
    case "flip":
      payload.faceDown = shape.faceDown;
      return Object.freeze(payload);
    case "breath":
      payload.strength = clamp01(shape.strength);
      return Object.freeze(payload);
  }
}

/**
 * Compose the full semantic action for a native gesture. The three-argument
 * shape lets `UniverseActions` and `GestureRouter` reuse one authoritative
 * assembler — the accessibility test asserts touch and assistive sources
 * produce identical payloads when their shape agrees.
 */
export function commandFromShape(
  input: Readonly<{ id: string; logicalTime: number; source: ActionSource; shape: NativeGestureShape }>,
): NativeSemanticCommand {
  const { verb, layer } = resolveVerbFromShape(input.shape);
  const payload = payloadFromShape(input.shape);
  const intensity = intensityFromNativeShape(input.shape);
  const action = assembleAction({
    id: input.id,
    logicalTime: input.logicalTime,
    verb,
    layer,
    source: input.source,
    intensity,
    payload,
  });
  return Object.freeze({ action, source: input.source, gestureShape: input.shape });
}

/**
 * Idle discovery clock — the router must NEVER surface a two- or three-finger
 * suggestion unless the surface has been quiet at least this long AND the
 * grammar's grow / plant tier is unspent.
 */
export const IDLE_DISCOVERY_WINDOW_MS = 6_000 as const;

/**
 * The router feeds this pure classifier idle timing and near-miss counters
 * — it returns a discovery invitation only when the conditions the plan
 * spells out (idle or near-miss, never a generic tutorial) are actually met.
 */
export function classifyDiscovery(
  input: Readonly<{ idleMs: number; nearMissFingers: 2 | 3 | null; nearMissWithdrawnAfterMs: number }>,
): DiscoveryInvitation | null {
  if (input.nearMissFingers != null && input.nearMissWithdrawnAfterMs > 0) {
    return Object.freeze({
      reason: "near-miss",
      observedFingers: input.nearMissFingers,
      withdrawnAfterMs: input.nearMissWithdrawnAfterMs,
    });
  }
  if (input.idleMs >= IDLE_DISCOVERY_WINDOW_MS) {
    return Object.freeze({
      reason: "idle",
      idleForMs: input.idleMs,
      suggestedFingers: 2,
    });
  }
  return null;
}
