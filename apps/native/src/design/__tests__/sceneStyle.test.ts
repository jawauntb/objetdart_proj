/**
 * Scene-style tests. Runs under `node --experimental-strip-types` — no JSX,
 * no react-native imports, plain node:assert.
 *
 * Covers U7 test scenarios:
 *
 *   1. Every scene brief has composition, material, motion, sensory
 *      mapping, and banned forms explicitly declared.
 *   5. `sceneStyle.ts` values equal `RELEASE_SCENE_MANIFEST[id].style`
 *      — no drift.
 *   6. `validateSceneStyle` accepts every brief we ship.
 *
 * Also asserts the banned-generic-form list is present on every brief and
 * that the state-to-sense map reaches at least two senses (the same rule the
 * contract enforces, restated here so a scene-lane regression fails loud).
 */

import assert from "node:assert/strict";
import {
  GENERIC_BANNED_FORMS,
  NATIVE_SCENE_MANIFEST,
  validateSceneStyle,
} from "@objet/universe-contracts";
import {
  NATIVE_SCENE_IDS,
  SCENE_STYLES,
  SCENE_STYLE_LIST,
  sceneStyle,
  summariseSceneStyle,
  validateNativeSceneStyle,
} from "../sceneStyle.ts";

function main(): void {
  assert.equal(
    NATIVE_SCENE_IDS.length,
    5,
    "native v2.1 must expose five scene ids",
  );

  for (const scene of NATIVE_SCENE_MANIFEST) {
    const native = sceneStyle(scene.id);
    assert.deepEqual(
      native,
      scene.style,
      `sceneStyle("${scene.id}") must equal RELEASE_SCENE_MANIFEST[i].style — no drift`,
    );

    const validation = validateNativeSceneStyle(native);
    assert.ok(
      validation.valid,
      `validateSceneStyle rejected the ${scene.id} brief: ${validation.errors.join("; ")}`,
    );

    assert.ok(
      typeof native.field === "string" && native.field.length > 0,
      `${scene.id}: composition (style.field) must be a non-empty string`,
    );
    assert.ok(
      Array.isArray(native.forms) && native.forms.length > 0,
      `${scene.id}: material (style.forms) must declare at least one form`,
    );
    assert.ok(
      typeof native.motion === "string" && native.motion.length > 0,
      `${scene.id}: motion must be a non-empty string`,
    );
    assert.ok(
      Array.isArray(native.stateToSense) && native.stateToSense.length > 0,
      `${scene.id}: sensory mapping must declare at least one state`,
    );
    for (const mapping of native.stateToSense) {
      assert.ok(
        mapping.senses.length >= 2,
        `${scene.id}: state "${mapping.state}" must reach at least two senses`,
      );
      assert.ok(
        typeof mapping.causalStatement === "string" && mapping.causalStatement.length > 0,
        `${scene.id}: state "${mapping.state}" is missing a causal statement`,
      );
    }
    for (const banned of GENERIC_BANNED_FORMS) {
      assert.ok(
        native.bannedForms.includes(banned),
        `${scene.id}: bannedForms must declare "${banned}" (generic-form list is shared)`,
      );
      assert.ok(
        !native.forms.includes(banned),
        `${scene.id}: forms must not contain the banned "${banned}"`,
      );
    }

    const summary = summariseSceneStyle(native);
    assert.equal(
      summary.id,
      scene.id,
      `${scene.id}: summary id must match the scene id`,
    );
    assert.equal(
      summary.composition,
      native.field,
      `${scene.id}: summary composition must equal style.field`,
    );
    assert.deepEqual(
      summary.material,
      native.forms,
      `${scene.id}: summary material must equal style.forms`,
    );
    assert.equal(
      summary.motion,
      native.motion,
      `${scene.id}: summary motion must equal style.motion`,
    );
  }

  const expectedIds = NATIVE_SCENE_MANIFEST.map((scene) => scene.id);
  assert.deepEqual(
    NATIVE_SCENE_IDS,
    expectedIds,
    "NATIVE_SCENE_IDS must equal the release manifest ids in order",
  );

  const listIds = SCENE_STYLE_LIST.map((style) => style.id);
  assert.deepEqual(
    listIds,
    expectedIds,
    "SCENE_STYLE_LIST must equal the release manifest styles in order",
  );

  const mapIds = Object.keys(SCENE_STYLES).sort();
  assert.deepEqual(
    mapIds,
    [...expectedIds].sort(),
    "SCENE_STYLES must expose exactly the release scene ids",
  );

  assert.throws(
    () => sceneStyle("nonexistent" as never),
    /unknown scene id/,
    "sceneStyle must throw on an unknown scene id rather than fall back silently",
  );

  console.log("native scene-style contract: ok");
}

main();
