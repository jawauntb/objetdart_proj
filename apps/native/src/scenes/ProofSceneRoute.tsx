import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { NativeSceneId } from "@objet/universe-contracts";
import { ObjetUniverseSurface, type SurfaceCommand } from "../../modules/objet-universe";
import { UniverseActions } from "../accessibility/UniverseActions";
import type { NativeSemanticCommand } from "../universe/actions";
import { NativeChrome } from "../design/NativeChrome";
import { EMPTY_REVEAL, revealAfter, type SceneReveal } from "../guide/reveal";
import { FoldSheet, type SceneLensIndex } from "../surfaces/ReadingSheets";
import {
  appendSessionTrail,
  loadSessionTrailState,
  makeTrailEntry,
  SESSION_TRAIL_LIMIT,
  switchSessionBranch,
  type TrailEntry,
} from "../persistence/SessionTrail";
import { mergeTrailEntries } from "../trail/sessionState";
import {
  EMPTY_UNIVERSE_PROGRESS,
  cycleLens,
  loadUniverseProgress,
  nextLensHint,
  recordProgress,
  saveUniverseProgress,
  unlockedLenses,
  type UniverseProgress,
} from "../progression/UniverseProgress";

const SCENE_LABEL: Record<NativeSceneId, string> = {
  wave: "wave field",
  cell: "cell colony",
  solar: "solar nursery",
  molecules: "molecular field",
  atoms: "atomic field",
};

/**
 * The shared first-proof route for every native material. Keeping this shell
 * identical across scales makes the meaningful difference the field itself:
 * the same touch, assistive action, fold, trail, and guide vocabulary can be
 * learned once and carried from water to cells to orbits.
 */
export function ProofSceneRoute({ scene }: Readonly<{ scene: NativeSceneId }>) {
  const router = useRouter();
  const [reveal, setReveal] = useState<SceneReveal>(EMPTY_REVEAL);
  const [routeFocused, setRouteFocused] = useState(true);
  const [foldOpen, setFoldOpen] = useState(false);
  const [representation, setRepresentation] = useState<SceneLensIndex>(0);
  const [progress, setProgress] = useState<UniverseProgress>(EMPTY_UNIVERSE_PROGRESS);
  const progressRef = useRef(progress);
  const trailRef = useRef<readonly TrailEntry[]>([]);
  const trailSequence = useRef(0);
  const activeBranchRef = useRef("local-main");
  const trailHydratedRef = useRef(false);
  const interactedBeforeTrailHydrationRef = useRef(false);
  const pendingProgressCommandsRef = useRef<SurfaceCommand[]>([]);
  const [assistiveCommand, setAssistiveCommand] = useState<{
    id: string;
    verb: NativeSemanticCommand["action"]["action"]["verb"];
    intensity: number;
    originX: number;
    originY: number;
  } | null>(null);
  const unlockedRepresentations = unlockedLenses(progress, scene);

  useFocusEffect(useCallback(() => {
    let focusActive = true;
    if (trailHydratedRef.current) {
      // A trail overlay may have switched branches. Hold input for the brief
      // local read so the first returning touch cannot land on the old branch.
      setRouteFocused(false);
      void loadSessionTrailState().then((trailState) => {
        if (!focusActive) return;
        activeBranchRef.current = trailState.activeBranchId;
        trailRef.current = mergeTrailEntries(trailRef.current, trailState.entries);
        trailSequence.current = Math.max(trailSequence.current, trailRef.current.length);
        setRouteFocused(true);
      });
    } else {
      setRouteFocused(true);
    }
    return () => {
      focusActive = false;
      setRouteFocused(false);
    };
  }, []));

  useEffect(() => {
    let mounted = true;
    void Promise.all([loadSessionTrailState(), loadUniverseProgress()]).then(([trailState, savedProgress]) => {
      const mergedEntries = mergeTrailEntries(trailRef.current, trailState.entries);
      trailSequence.current = Math.max(trailSequence.current, mergedEntries.length);
      trailRef.current = mergedEntries;
      if (interactedBeforeTrailHydrationRef.current) {
        // The first touch is authoritative for the branch the visitor already
        // inhabited. Persist that choice after the disk read instead of
        // silently moving subsequent gestures to a different saved branch.
        void switchSessionBranch(activeBranchRef.current);
      } else {
        activeBranchRef.current = trailState.activeBranchId;
      }
      trailHydratedRef.current = true;
      let mergedProgress = savedProgress;
      for (const command of pendingProgressCommandsRef.current) {
        mergedProgress = recordProgress(mergedProgress, scene, command);
      }
      pendingProgressCommandsRef.current = [];
      progressRef.current = mergedProgress;
      if (mergedProgress !== savedProgress) void saveUniverseProgress(mergedProgress);
      if (!mounted) return;
      setProgress(mergedProgress);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const onAssistiveCommand = useCallback((command: NativeSemanticCommand) => {
    const payload = command.action.action.payload as Readonly<Record<string, unknown>>;
    setAssistiveCommand({
      id: command.action.id,
      verb: command.action.action.verb,
      intensity: command.action.action.intensity,
      originX: typeof payload.x === "number" ? payload.x : 0.5,
      originY: typeof payload.y === "number" ? payload.y : 0.5,
    });
  }, []);

  const onSemanticCommand = useCallback((event: { nativeEvent: SurfaceCommand }) => {
    const command = event.nativeEvent;
    if (!trailHydratedRef.current) {
      interactedBeforeTrailHydrationRef.current = true;
      pendingProgressCommandsRef.current.push(command);
    }
    setReveal((current) => revealAfter(current, command));
    if (command.answered) {
      const activeBranchId = activeBranchRef.current;
      const parentEvent = trailRef.current.slice().reverse().find((entry) => entry.branchId === activeBranchId);
      const entry = makeTrailEntry(command, trailSequence.current + 1, Date.now(), {
        scene,
        branchId: activeBranchId,
        parentEventId: parentEvent?.id ?? null,
      });
      trailSequence.current += 1;
      trailRef.current = [...trailRef.current, entry].slice(-SESSION_TRAIL_LIMIT);
      void appendSessionTrail(entry);
    }
    const nextProgress = recordProgress(progressRef.current, scene, command);
    if (nextProgress !== progressRef.current) {
      progressRef.current = nextProgress;
      setProgress(nextProgress);
      // Before hydration, keep the live delta in memory. Persisting it first
      // would let the subsequent load read that delta and replay it twice.
      if (trailHydratedRef.current) void saveUniverseProgress(nextProgress);
    }
    if (command.answered && command.semanticVerb === "lens") {
      setRepresentation((current) => cycleLens(nextProgress, scene, current, 1));
    } else if (command.answered && command.semanticVerb === "step-back") {
      setRepresentation((current) => cycleLens(nextProgress, scene, current, -1));
    }
  }, [scene]);

  const closeReadings = useCallback(() => {
    setFoldOpen(false);
  }, []);
  const openScene = useCallback((destination: NativeSceneId) => {
    closeReadings();
    router.push(destination === "wave" ? "/world" : `/${destination}`);
  }, [closeReadings, router]);

  return (
    <View style={styles.field} accessibilityLabel={`A living ${SCENE_LABEL[scene]}`}>
      <UniverseActions
        style={StyleSheet.absoluteFill}
        accessibilityLabel={`Living ${SCENE_LABEL[scene]}. Use actions to touch, step back, rotate the lens, or ring the field.`}
        advertisedVerbs={["tap", "tap2", "tap3", "twist", "knock", "holdDwell", "holdCeremony"]}
        onSemanticCommand={onAssistiveCommand}
      >
        <ObjetUniverseSurface
          style={StyleSheet.absoluteFill}
          // Persistence hydrates beside the material; it must never gate the
          // first touch. The native kernel is deterministic from launch and
          // the trail/progression files are convenience state, not authority.
          enabled={routeFocused && !foldOpen}
          representation={representation}
          maxRepresentation={unlockedRepresentations[unlockedRepresentations.length - 1]}
          assistiveVerb={assistiveCommand?.verb}
          assistiveIntensity={assistiveCommand?.intensity}
          assistiveOriginX={assistiveCommand?.originX}
          assistiveOriginY={assistiveCommand?.originY}
          assistiveCommandId={assistiveCommand?.id}
          onSemanticCommand={onSemanticCommand}
        />
      </UniverseActions>
      <NativeChrome
        scene={scene}
        reveal={reveal}
        onOpenFold={() => {
          setFoldOpen(true);
        }}
        onOpenTrail={() => router.push(`/trail?scene=${scene}`)}
        onOpenGuide={(access) => router.push(`/guide?scene=${scene}&access=${access}`)}
      />
      {foldOpen ? (
        <FoldSheet
          scene={scene}
          representation={representation}
          onSelect={setRepresentation}
          unlockedRepresentations={unlockedRepresentations}
          nextHint={nextLensHint(progress, scene)}
          onClose={closeReadings}
          onOpenScene={openScene}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flex: 1,
    backgroundColor: "transparent",
  },
});
