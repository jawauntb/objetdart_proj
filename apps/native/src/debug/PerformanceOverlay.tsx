import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

/**
 * U8 performance overlay: displays the coarse budget-compliance numbers used
 * for release-evidence bundles (frame Hz, hitch rate, memory MB, thermal
 * state). It reads from a caller-provided `read()` function so tests and the
 * eventual U6/U16 telemetry bridge can supply values without React coupling.
 *
 * Simulator-only measurements are visually marked (via `simulatorOnly`) so
 * they cannot be silently promoted to release-evidence performance claims,
 * matching the `deviations[]` rule in `docs/native/evidence-schema.md`.
 */

export type ThermalState = "nominal" | "fair" | "serious" | "critical";

export type PerformanceSample = Readonly<{
  targetHz: number;
  sustainedHz: number;
  meanFrameMs: number;
  p99FrameMs: number;
  hitchesPerMinute: number;
  memoryResidentMB: number;
  memoryPeakMB: number;
  thermal: ThermalState;
  simulatorOnly: boolean;
}>;

const DEFAULT_SAMPLE: PerformanceSample = {
  targetHz: 60,
  sustainedHz: 0,
  meanFrameMs: 0,
  p99FrameMs: 0,
  hitchesPerMinute: 0,
  memoryResidentMB: 0,
  memoryPeakMB: 0,
  thermal: "nominal",
  simulatorOnly: false,
};

export type PerformanceOverlayProps = Readonly<{
  read?: () => PerformanceSample;
  pollMs?: number;
}>;

const defaultRead: () => PerformanceSample = () => DEFAULT_SAMPLE;

function thermalTone(state: ThermalState): string {
  switch (state) {
    case "nominal": return "#22c55e";
    case "fair": return "#eab308";
    case "serious": return "#f97316";
    case "critical": return "#ef4444";
  }
}

export function PerformanceOverlay({ read = defaultRead, pollMs = 500 }: PerformanceOverlayProps): JSX.Element {
  const [sample, setSample] = useState<PerformanceSample>(() => read());

  useEffect(() => {
    setSample(read());
    const id = setInterval(() => setSample(read()), Math.max(200, pollMs));
    return () => clearInterval(id);
  }, [pollMs, read]);

  const rows = useMemo(() => [
    ["target", `${sample.targetHz.toFixed(0)} Hz`],
    ["sustained", `${sample.sustainedHz.toFixed(1)} Hz`],
    ["mean frame", `${sample.meanFrameMs.toFixed(2)} ms`],
    ["p99 frame", `${sample.p99FrameMs.toFixed(2)} ms`],
    ["hitch/min", sample.hitchesPerMinute.toFixed(2)],
    ["mem MB", `${sample.memoryResidentMB.toFixed(0)} / ${sample.memoryPeakMB.toFixed(0)}`],
  ] as const, [sample]);

  return (
    <View
      style={[styles.container, sample.simulatorOnly ? styles.simulator : null]}
      accessibilityLabel={sample.simulatorOnly ? "Performance overlay, simulator only" : "Performance overlay"}
    >
      <View style={styles.header}>
        <Text style={styles.headerText}>performance</Text>
        <View style={[styles.dot, { backgroundColor: thermalTone(sample.thermal) }]} />
        <Text style={styles.headerText}>{sample.thermal}</Text>
      </View>
      {sample.simulatorOnly ? (
        <Text style={styles.simulatorText}>simulator only • not release evidence</Text>
      ) : null}
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
    right: 16,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "rgba(0, 0, 0, 0.66)",
    minWidth: 220,
  },
  simulator: {
    borderWidth: 1,
    borderColor: "rgba(234, 179, 8, 0.8)",
  },
  simulatorText: {
    color: "#facc15",
    fontSize: 10,
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  headerText: {
    color: "#f4f4f5",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
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
  },
  value: {
    color: "#f4f4f5",
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
});

export default PerformanceOverlay;
