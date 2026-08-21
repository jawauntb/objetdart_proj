import { RELEASE_ONE_SCENE_IDS, type NativeSceneId } from "@objet/universe-contracts";
import type { SurfaceCommand } from "../../modules/objet-universe";

export const UNIVERSE_PROGRESS_VERSION = 1 as const;
export type LensIndex = 0 | 1 | 2 | 3;

export type SceneProgress = Readonly<{
  answeredActs: number;
  growthActs: number;
  ceremonies: number;
}>;

export type UniverseProgress = Readonly<{
  version: typeof UNIVERSE_PROGRESS_VERSION;
  wave: SceneProgress;
  cell: SceneProgress;
  solar: SceneProgress;
}>;

const EMPTY_SCENE: SceneProgress = Object.freeze({ answeredActs: 0, growthActs: 0, ceremonies: 0 });
const ANSWERED_ACTS_FOR_LENS_ONE = 3;
const CEREMONIES_FOR_LENS_TWO = 1;
const GROWTH_ACTS_FOR_LENS_THREE = 5;
const ANSWERED_ACTS_FOR_LENS_THREE = 9;
export const EMPTY_UNIVERSE_PROGRESS: UniverseProgress = Object.freeze({
  version: UNIVERSE_PROGRESS_VERSION,
  wave: EMPTY_SCENE,
  cell: EMPTY_SCENE,
  solar: EMPTY_SCENE,
});

function finiteCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function sceneProgress(value: unknown): SceneProgress {
  if (!value || typeof value !== "object") return EMPTY_SCENE;
  const source = value as Partial<SceneProgress>;
  return Object.freeze({
    answeredActs: finiteCount(source.answeredActs),
    growthActs: finiteCount(source.growthActs),
    ceremonies: finiteCount(source.ceremonies),
  });
}

function validProgress(value: unknown): value is UniverseProgress {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UniverseProgress>;
  return candidate.version === UNIVERSE_PROGRESS_VERSION && RELEASE_ONE_SCENE_IDS.every((scene) => scene in candidate);
}

export function normalizeUniverseProgress(value: unknown): UniverseProgress {
  if (!validProgress(value)) return EMPTY_UNIVERSE_PROGRESS;
  return Object.freeze({
    version: UNIVERSE_PROGRESS_VERSION,
    wave: sceneProgress(value.wave),
    cell: sceneProgress(value.cell),
    solar: sceneProgress(value.solar),
  });
}

export function recordProgress(progress: UniverseProgress, scene: NativeSceneId, command: SurfaceCommand): UniverseProgress {
  if (!command.answered || !(scene in progress)) return progress;
  const current = progress[scene];
  return Object.freeze({
    ...progress,
    [scene]: Object.freeze({
      answeredActs: current.answeredActs + 1,
      growthActs: current.growthActs + (command.semanticVerb === "grow" ? 1 : 0),
      ceremonies: current.ceremonies + (command.semanticVerb === "ceremony" ? 1 : 0),
    }),
  });
}

export function unlockedLenses(progress: UniverseProgress, scene: NativeSceneId): readonly LensIndex[] {
  if (scene === "wave") return [0, 1, 2, 3];
  const current = progress[scene];
  const unlocked: LensIndex[] = [0];
  if (current.answeredActs >= ANSWERED_ACTS_FOR_LENS_ONE) unlocked.push(1);
  if (current.ceremonies >= CEREMONIES_FOR_LENS_TWO) unlocked.push(2);
  if (current.growthActs >= GROWTH_ACTS_FOR_LENS_THREE || current.answeredActs >= ANSWERED_ACTS_FOR_LENS_THREE) unlocked.push(3);
  return unlocked;
}

export function cycleLens(
  progress: UniverseProgress,
  scene: NativeSceneId,
  current: LensIndex,
  direction: 1 | -1,
): LensIndex {
  const available = unlockedLenses(progress, scene);
  const position = Math.max(0, available.indexOf(current));
  if (direction < 0 && position === 0) return available[0];
  return available[(position + direction + available.length) % available.length];
}

export function nextLensHint(progress: UniverseProgress, scene: NativeSceneId): string {
  if (scene === "wave") return "all four readings are open — use the field as an instrument.";
  const current = progress[scene];
  if (current.answeredActs < ANSWERED_ACTS_FOR_LENS_ONE) return `${ANSWERED_ACTS_FOR_LENS_ONE - current.answeredActs} more answered acts open the next register.`;
  if (current.ceremonies < CEREMONIES_FOR_LENS_TWO) return "make the scene's solemn act to open the deeper register.";
  if (current.growthActs < GROWTH_ACTS_FOR_LENS_THREE && current.answeredActs < ANSWERED_ACTS_FOR_LENS_THREE) return "keep growing the material to open its finest register.";
  return "all four registers are open — tend the state, then travel through the fold.";
}
