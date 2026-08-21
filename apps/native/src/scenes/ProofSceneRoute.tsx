import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { NativeSceneId } from "@objet/universe-contracts";
import { ObjetUniverseSurface, type SurfaceCommand } from "../../modules/objet-universe";
import { UniverseActions } from "../accessibility/UniverseActions";
import type { NativeSemanticCommand } from "../universe/actions";
import { NativeChrome } from "../design/NativeChrome";
import { EMPTY_REVEAL, revealAfter, type SceneReveal } from "../guide/reveal";
import {
  FoldSheet,
  TrailSheet,
  type WaveRepresentation,
} from "../surfaces/ReadingSheets";
import {
  appendSessionTrail,
  loadSessionTrail,
  makeTrailEntry,
  type TrailEntry,
} from "../persistence/SessionTrail";

const SCENE_LABEL: Record<NativeSceneId, string> = {
  wave: "wave field",
  cell: "cell colony",
  solar: "solar nursery",
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
  const [reading, setReading] = useState(false);
  const [foldOpen, setFoldOpen] = useState(false);
  const [trailOpen, setTrailOpen] = useState(false);
  const [representation, setRepresentation] = useState<WaveRepresentation>(0);
  const [trail, setTrail] = useState<readonly TrailEntry[]>([]);
  const [trailReady, setTrailReady] = useState(false);
  const trailSequence = useRef(0);
  const [assistiveCommand, setAssistiveCommand] = useState<{
    id: string;
    verb: NativeSemanticCommand["action"]["action"]["verb"];
    intensity: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    let mounted = true;
    void loadSessionTrail().then((entries) => {
      if (!mounted) return;
      trailSequence.current = entries.length;
      setTrail(entries);
      setTrailReady(true);
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
    setReveal((current) => revealAfter(current, command));
    const entry = makeTrailEntry(command, trailSequence.current + 1);
    trailSequence.current += 1;
    setTrail((current) => [...current, entry].slice(-120));
    void appendSessionTrail(entry);
    if (command.semanticVerb === "lens") {
      setRepresentation((current) => (current === 3 ? 0 : ((current + 1) as WaveRepresentation)));
    } else if (command.semanticVerb === "step-back") {
      setRepresentation((current) => (current === 0 ? 0 : ((current - 1) as WaveRepresentation)));
    }
  }, []);

  const closeReadings = useCallback(() => {
    setFoldOpen(false);
    setTrailOpen(false);
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
          enabled={trailReady && !reading && !foldOpen && !trailOpen}
          representation={representation}
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
          setTrailOpen(false);
          setFoldOpen(true);
        }}
        onOpenTrail={() => {
          setFoldOpen(false);
          setTrailOpen(true);
        }}
        onGuideVisibilityChange={setReading}
      />
      {foldOpen ? (
        <FoldSheet
          representation={representation}
          onSelect={setRepresentation}
          onClose={closeReadings}
          onOpenWave={scene === "wave" ? undefined : () => openScene("wave")}
          onOpenCell={scene === "cell" ? undefined : () => openScene("cell")}
          onOpenSolar={scene === "solar" ? undefined : () => openScene("solar")}
        />
      ) : null}
      {trailOpen ? <TrailSheet scene={SCENE_LABEL[scene]} events={trail} onClose={closeReadings} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flex: 1,
    backgroundColor: "transparent",
  },
});
