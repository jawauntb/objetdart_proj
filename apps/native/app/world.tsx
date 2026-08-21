import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { ObjetUniverseSurface, type SurfaceCommand } from "../modules/objet-universe";
import { UniverseActions } from "../src/accessibility/UniverseActions";
import type { NativeSemanticCommand } from "../src/universe/actions";
import { NativeChrome } from "../src/design/NativeChrome";
import { EMPTY_REVEAL, revealAfter, type SceneReveal } from "../src/guide/reveal";
import {
  FoldSheet,
  TrailSheet,
  type WaveRepresentation,
} from "../src/surfaces/ReadingSheets";
import {
  appendSessionTrail,
  loadSessionTrail,
  makeTrailEntry,
  type TrailEntry,
} from "../src/persistence/SessionTrail";

/**
 * The world route sits above the persistent `<ObjetUniverseView>` and stays
 * transparent so the native material renders through. It mounts the surface
 * the hand meets, the shared safe-area chrome, and the two sought reading
 * surfaces (fold and trail). No tab bar, no first-launch overlay, no HUD. See
 * `docs/native/art-direction.md` §9.
 *
 * The surface is a native view rather than a React touch handler on purpose.
 * UIKit hit-tests the topmost view at a point, so a recogniser on the
 * universe below would never see a finger through the navigator's screens —
 * and recognition belongs in Swift regardless, where the one grammar lives.
 * React learns only which phenomena the visitor has caused, because the guide
 * may not describe a phenomenon that has not landed.
 *
 * While the guide sheet is open the surface is closed: the state contract
 * pauses authoritative intervention for the reading surfaces.
 */
export default function WorldRoute() {
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

  return (
    <View style={styles.field} accessibilityLabel="A living wave field">
      <UniverseActions
        style={StyleSheet.absoluteFill}
        accessibilityLabel="Living wave field. Use actions to touch, step back, rotate the lens, or ring the field."
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
        scene="wave"
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
        />
      ) : null}
      {trailOpen ? <TrailSheet events={trail} onClose={closeReadings} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flex: 1,
    backgroundColor: "transparent",
  },
});
