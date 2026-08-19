/**
 * U5 — VoiceOver / keyboard action layer.
 *
 * Wraps a native View with an accessibility action rotor. Each rotor
 * activation calls into the SAME `commandFromShape` assembler the touch path
 * uses, so the durable payload is invariant under source. Every action a
 * touch user can perform is reachable through this rotor.
 *
 * The pure assembler `buildAssistiveCommands` and the rotor label registry
 * live in `actionLabels.ts` so the accessibility test can run under
 * `node --experimental-strip-types` (which does not transform JSX). This
 * component is a thin React shell over the same assembler.
 */

import { forwardRef, useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import type { AccessibilityActionEvent, StyleProp, ViewProps, ViewStyle } from "react-native";
import {
  commandFromShape,
  type NativeGrammarVerb,
  type NativeSemanticCommand,
} from "../universe/actions.ts";
import {
  UNIVERSE_ACTION_LABELS,
  defaultAssistiveId,
  type UniverseActionLabel,
} from "./actionLabels.ts";

export type UniverseActionsProps = Readonly<{
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  /**
   * Emits when the rotor (or a keyboard shortcut wired through the router)
   * activates a semantic action. Downstream consumers pipe this straight into
   * the U2/U3 host boundary; the payload has already passed
   * `isVersionedAction`.
   */
  onSemanticCommand: (command: NativeSemanticCommand) => void;
  /**
   * Optional clock source. Injectable so the test file can pass a
   * deterministic tick counter and prove that touch and assistive sources
   * produce identical serialized payloads.
   */
  nowLogicalTime?: () => number;
  /**
   * Optional id factory (defaults to a monotonic counter). Injected in tests
   * to keep event ids stable.
   */
  makeActionId?: (verb: NativeGrammarVerb) => string;
  /**
   * Subset of the site-wide grammar this surface answers. Absent verbs still
   * exist in the labels registry — the surface simply omits them from its
   * rotor so a room does not advertise gestures it does not answer.
   */
  advertisedVerbs?: readonly NativeGrammarVerb[];
}> & Omit<ViewProps, "accessibilityActions" | "onAccessibilityAction" | "accessibilityLabel">;

function defaultNow(): number {
  return Math.max(0, Math.floor(globalThis.performance?.now?.() ?? Date.now()));
}

export { buildAssistiveCommands } from "./actionLabels.ts";

export const UniverseActions = forwardRef<View, UniverseActionsProps>(function UniverseActions(
  props,
  ref,
) {
  const {
    children,
    style,
    accessibilityLabel = "Objet universe",
    onSemanticCommand,
    nowLogicalTime = defaultNow,
    makeActionId,
    advertisedVerbs,
    ...rest
  } = props;

  const labelIndex = useMemo(() => {
    const map = new Map<string, UniverseActionLabel>();
    for (const entry of UNIVERSE_ACTION_LABELS) {
      if (!advertisedVerbs || advertisedVerbs.includes(entry.grammarVerb)) {
        map.set(entry.label, entry);
      }
    }
    return map;
  }, [advertisedVerbs]);

  const accessibilityActions = useMemo(
    () =>
      Array.from(labelIndex.values()).map((entry) => ({ name: entry.label, label: entry.hint })),
    [labelIndex],
  );

  const handleAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      const entry = labelIndex.get(event.nativeEvent.actionName);
      if (!entry) return;
      const command = commandFromShape({
        id: (makeActionId ?? defaultAssistiveId)(entry.grammarVerb),
        logicalTime: nowLogicalTime(),
        source: "assistive",
        shape: entry.equivalentShape,
      });
      onSemanticCommand(command);
    },
    [labelIndex, makeActionId, nowLogicalTime, onSemanticCommand],
  );

  return (
    <View
      ref={ref}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={handleAccessibilityAction}
      style={style}
      {...rest}
    >
      {children}
    </View>
  );
});

export default UniverseActions;
