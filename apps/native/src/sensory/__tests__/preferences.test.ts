import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  DEFAULT_SENSORY_PREFERENCES,
  applySensoryPreferences,
  busStateFromPreferences,
  enabledSenses,
  isSensoryChannelEnabled,
  type SensoryPreferences,
} from "../preferences.ts";

test("defaults leave audio, haptics, and visual all live", () => {
  assert.equal(DEFAULT_SENSORY_PREFERENCES.audioMuted, false);
  assert.equal(DEFAULT_SENSORY_PREFERENCES.hapticsMuted, false);
  const senses = enabledSenses(DEFAULT_SENSORY_PREFERENCES);
  assert.equal(senses.size, 3);
  assert.ok(senses.has("visual"));
  assert.ok(senses.has("audio"));
  assert.ok(senses.has("haptic"));
});

test("defaults are frozen so no scene can mutate the authoritative preference", () => {
  assert.ok(Object.isFrozen(DEFAULT_SENSORY_PREFERENCES));
});

test("applySensoryPreferences returns a fresh frozen object without touching current", () => {
  const base = DEFAULT_SENSORY_PREFERENCES;
  const next = applySensoryPreferences(base, { audioMuted: true });
  assert.notEqual(next, base);
  assert.ok(Object.isFrozen(next));
  assert.equal(next.audioMuted, true);
  assert.equal(next.hapticsMuted, false);
  // Original is untouched.
  assert.equal(base.audioMuted, false);
});

test("applySensoryPreferences ignores non-boolean patch fields", () => {
  const base: SensoryPreferences = Object.freeze({ audioMuted: false, hapticsMuted: false });
  // A stray undefined must not clear a real setting.
  const next = applySensoryPreferences(base, { audioMuted: undefined });
  assert.equal(next.audioMuted, false);
  assert.equal(next.hapticsMuted, false);
});

test("muting audio does not disable haptics", () => {
  const prefs = applySensoryPreferences(DEFAULT_SENSORY_PREFERENCES, { audioMuted: true });
  const senses = enabledSenses(prefs);
  assert.ok(!senses.has("audio"), "audio must be muted");
  assert.ok(senses.has("haptic"), "haptics must remain live when only audio is muted");
  assert.ok(senses.has("visual"), "visual scientific feedback stays authoritative");
  assert.equal(isSensoryChannelEnabled(prefs, "haptic"), true);
});

test("muting haptics does not disable audio", () => {
  const prefs = applySensoryPreferences(DEFAULT_SENSORY_PREFERENCES, { hapticsMuted: true });
  const senses = enabledSenses(prefs);
  assert.ok(!senses.has("haptic"), "haptics must be muted");
  assert.ok(senses.has("audio"), "audio must remain live when only haptics is muted");
  assert.ok(senses.has("visual"));
  assert.equal(isSensoryChannelEnabled(prefs, "audio"), true);
});

test("muting both audio and haptics still leaves visual scientific feedback authoritative", () => {
  const prefs = applySensoryPreferences(DEFAULT_SENSORY_PREFERENCES, {
    audioMuted: true,
    hapticsMuted: true,
  });
  const senses = enabledSenses(prefs);
  assert.equal(senses.size, 1);
  assert.ok(senses.has("visual"));
  assert.equal(isSensoryChannelEnabled(prefs, "visual"), true);
  assert.equal(isSensoryChannelEnabled(prefs, "audio"), false);
  assert.equal(isSensoryChannelEnabled(prefs, "haptic"), false);
});

test("visual is never muteable through the preferences shape", () => {
  // `SensoryPreferences` intentionally does NOT carry a visualMuted field:
  // scenes render scientific feedback regardless of user preference. This
  // test guards the shape against a future accidental widening.
  const prefs = applySensoryPreferences(DEFAULT_SENSORY_PREFERENCES, {
    audioMuted: true,
    hapticsMuted: true,
    // @ts-expect-error visualMuted must not exist on SensoryPreferences
    visualMuted: true,
  });
  assert.equal(isSensoryChannelEnabled(prefs, "visual"), true);
});

test("busStateFromPreferences surfaces coarse bus state without per-event detail", () => {
  const prefs = applySensoryPreferences(DEFAULT_SENSORY_PREFERENCES, { audioMuted: true });
  const state = busStateFromPreferences(prefs, false);
  assert.ok(Object.isFrozen(state));
  assert.equal(state.audioMuted, true);
  assert.equal(state.hapticsMuted, false);
  assert.equal(state.hapticEngineAvailable, false);
});
