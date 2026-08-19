import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

/**
 * U8 scenario runner: shows what the native host is currently doing without
 * mutating scene state. It is a diagnostic overlay meant for release-evidence
 * capture and physical-device profiling; it does NOT own a fixture kernel or
 * a private timeline of its own — the host's tick, active scene, and pending
 * command count are the only values it displays.
 *
 * The bridge between JS and the native host is not yet complete (U3 exposes
 * only the `scene` prop); when U9 wires action ingress + host telemetry into
 * the module, this component will subscribe to that stream directly. Until
 * then the runner reports `state: "unbound"` so it is never mistaken for a
 * live signpost feed in a bundle capture.
 */

export type ScenarioRunnerState =
  | { state: "unbound" }
  | {
      state: "bound";
      activeScene: "wave" | "cell" | "solar";
      logicalTick: number;
      pendingActions: number;
      committedScenes: readonly ("wave" | "cell" | "solar")[];
      droppedFrameDebt: number;
      quarantinedOutputs: number;
      lastBoundary:
        | "previewed"
        | "durablyAppended"
        | "authoritativelyApplied"
        | "checkpointPromoted"
        | "uiAcknowledged"
        | "sensoryConfirmed"
        | "outputQuarantined";
    };

export type ScenarioRunnerProps = Readonly<{
  /** Poll interval in ms; ignored when unbound. */
  pollMs?: number;
  /** Injection point for tests / future host bridge. */
  read?: () => ScenarioRunnerState;
}>;

const defaultRead: () => ScenarioRunnerState = () => ({ state: "unbound" });

export function ScenarioRunner({ pollMs = 1000, read = defaultRead }: ScenarioRunnerProps): JSX.Element {
  const [state, setState] = useState<ScenarioRunnerState>(() => read());

  useEffect(() => {
    setState(read());
    const id = setInterval(() => setState(read()), Math.max(200, pollMs));
    return () => clearInterval(id);
  }, [pollMs, read]);

  const rows = useMemo(() => {
    if (state.state === "unbound") {
      return [
        ["state", "unbound (host telemetry not yet wired)"],
      ] as const;
    }
    return [
      ["scene", state.activeScene],
      ["tick", String(state.logicalTick)],
      ["pending", String(state.pendingActions)],
      ["committed", state.committedScenes.join(", ") || "-"],
      ["droppedDebt", String(state.droppedFrameDebt)],
      ["quarantined", String(state.quarantinedOutputs)],
      ["lastBoundary", state.lastBoundary],
    ] as const;
  }, [state]);

  return (
    <View style={styles.container} accessibilityLabel="Scenario runner status">
      <Text style={styles.header}>scenario</Text>
      {rows.map(([key, value]) => (
        <View key={key} style={styles.row}>
          <Text style={styles.key}>{key}</Text>
          <Text style={styles.value}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 16,
    left: 16,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "rgba(0, 0, 0, 0.66)",
    minWidth: 200,
  },
  header: {
    color: "#f4f4f5",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 1,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginVertical: 2,
    gap: 12,
  },
  key: {
    color: "#a1a1aa",
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  value: {
    color: "#f4f4f5",
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
});

export default ScenarioRunner;
