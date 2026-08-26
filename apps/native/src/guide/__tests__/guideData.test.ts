/**
 * Guide-data tests. Runs under `node --experimental-strip-types` — no JSX,
 * no react-native imports, plain node:assert.
 *
 * Covers U7 test scenarios:
 *
 *   2. Every scientific concept has plain wording and notation linked to
 *      one guide entry — no duplication.
 *   3. Reduced motion changes movement while preserving hierarchy, state,
 *      and scientific result (covered indirectly by asserting every entry
 *      declares its state-carrying notation, and covered directly by the
 *      motion tokens' `REDUCED_MOTION_EQUIVALENTS`).
 *   4. `guideData.ts` covers every entry in `GLOBAL_VERBS` — or explicitly
 *      documents why an entry is deferred.
 *
 * `GLOBAL_VERBS` lives in `src/lib/gesture/defaults.ts` (web) and uses `@/`
 * path aliases that node cannot resolve without a bundler. We read that
 * file as text and extract the verb list with a regex — the assertion pins
 * the vocabulary the native guide is meant to mirror.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GUIDE_ENTRIES,
  GUIDE_ENTRIES_BY_VERB,
  NATIVE_GUIDE_VERBS,
  REVEAL_STEPS,
  SCIENCE_NOTES_BY_SCENE,
  entriesForRevealStep,
  type GuideEntry,
  type GuideRevealStep,
  type GuideVerb,
} from "../guideData.ts";
import {
  MOTION,
  REDUCED_MOTION_EQUIVALENTS,
  motionDurationMs,
} from "../../design/tokens.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../../..");
const webDefaultsPath = path.join(repoRoot, "src/lib/gesture/defaults.ts");

function extractWebGlobalVerbs(source: string): string[] {
  const start = source.indexOf("export const GLOBAL_VERBS");
  assert.ok(
    start !== -1,
    `expected to find GLOBAL_VERBS in ${webDefaultsPath}`,
  );
  const openBracket = source.indexOf("[", start);
  const closeBracket = source.indexOf("] as const", openBracket);
  assert.ok(
    openBracket !== -1 && closeBracket !== -1,
    "GLOBAL_VERBS declaration is not shaped as expected",
  );
  const body = source.slice(openBracket, closeBracket);
  const verbs: string[] = [];
  const verbRegex = /verb:\s*"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = verbRegex.exec(body)) !== null) {
    verbs.push(match[1]);
  }
  assert.ok(verbs.length > 0, "expected at least one verb in GLOBAL_VERBS");
  return verbs;
}

function main(): void {
  const webSource = readFileSync(webDefaultsPath, "utf8");
  const webVerbs = extractWebGlobalVerbs(webSource);

  const nativeVerbs = new Set<string>(NATIVE_GUIDE_VERBS);
  for (const verb of webVerbs) {
    assert.ok(
      nativeVerbs.has(verb),
      `native guide is missing coverage for web GLOBAL_VERB "${verb}" — add an entry to guideData.ts or a deferredReason`,
    );
  }
  const webSet = new Set(webVerbs);
  for (const verb of NATIVE_GUIDE_VERBS) {
    assert.ok(
      webSet.has(verb),
      `native guide declares verb "${verb}" that is not in web GLOBAL_VERBS — drop it or update the web grammar first`,
    );
  }
  assert.equal(
    NATIVE_GUIDE_VERBS.length,
    webVerbs.length,
    "native GUIDE_VERBS must be a 1:1 mirror of web GLOBAL_VERBS in count",
  );

  const seenPlain = new Set<string>();
  const seenNotation = new Set<string>();
  for (const verb of NATIVE_GUIDE_VERBS) {
    const entry: GuideEntry | undefined = GUIDE_ENTRIES_BY_VERB[verb as GuideVerb];
    assert.ok(entry, `GUIDE_ENTRIES_BY_VERB is missing "${verb}"`);
    assert.equal(entry.verb, verb, `${verb}: entry.verb must equal its key`);

    if (entry.deferredReason !== undefined) {
      assert.ok(
        typeof entry.deferredReason === "string" && entry.deferredReason.length > 0,
        `${verb}: deferredReason must be a non-empty sentence when present`,
      );
    } else {
      assert.ok(
        typeof entry.plain === "string" && entry.plain.length > 0,
        `${verb}: plain wording is required unless the entry is explicitly deferred`,
      );
      assert.ok(
        typeof entry.notation === "string" && entry.notation.length > 0,
        `${verb}: notation is required unless the entry is explicitly deferred`,
      );
      assert.ok(
        !seenPlain.has(entry.plain),
        `${verb}: plain wording duplicates another entry — every entry needs its own words`,
      );
      seenPlain.add(entry.plain);
      assert.ok(
        !seenNotation.has(entry.notation),
        `${verb}: notation duplicates another entry — every notation must name its own state`,
      );
      seenNotation.add(entry.notation);
      assert.ok(
        REVEAL_STEPS.includes(entry.reveal),
        `${verb}: reveal step "${entry.reveal}" is not one of Play/Reveal/Name/Transfer/Express`,
      );
      assert.ok(
        typeof entry.sceneNotes.wave === "string" && entry.sceneNotes.wave.length > 0,
        `${verb}: sceneNotes.wave must be a non-empty statement`,
      );
      assert.ok(
        typeof entry.sceneNotes.cell === "string" && entry.sceneNotes.cell.length > 0,
        `${verb}: sceneNotes.cell must be a non-empty statement`,
      );
      assert.ok(
        typeof entry.sceneNotes.solar === "string" && entry.sceneNotes.solar.length > 0,
        `${verb}: sceneNotes.solar must be a non-empty statement`,
      );
    }
  }

  for (const entry of GUIDE_ENTRIES) {
    assert.doesNotMatch(
      entry.sceneNotes.solar,
      /galaxy|Earth|biosphere|saved star/i,
      `${entry.verb}: solar copy must name only the gravity loom that exists`,
    );
  }

  assert.equal(
    GUIDE_ENTRIES_BY_VERB.drag.sceneNotes.solar,
    "drag a body to reshape its trajectory; press and release open sky to place new matter.",
    "solar body drag and open-sky accretion must not be described as the same gesture",
  );
  assert.equal(
    GUIDE_ENTRIES_BY_VERB.pan2.plain,
    "drag open sky with one finger to turn the frame.",
    "the camera instruction must name the one-finger gesture the native router actually accepts",
  );

  const moleculeScience = SCIENCE_NOTES_BY_SCENE.molecules;
  assert.ok(moleculeScience, "the sought native molecule guide must disclose the H2 model boundary");
  assert.match(moleculeScience.plain, /neutral singlet H₂/i);
  assert.match(moleculeScience.plain, /0\.60–1\.20 å/i);
  assert.match(moleculeScience.notation, /rhf \/ sto-3g/i);
  assert.match(moleculeScience.notation, /25 pyscf 2\.6\.2 nodes \+ 24 midpoint oracles/i);
  assert.match(moleculeScience.notation, /no dft, ks-fno, runtime model, or extrapolation/i);
  assert.equal(SCIENCE_NOTES_BY_SCENE.atoms, undefined, "an H2 disclosure must not leak into the atoms guide");
  assert.match(GUIDE_ENTRIES_BY_VERB.holdDwell.sceneNotes.molecules ?? "", /isolated H₂/);
  assert.match(GUIDE_ENTRIES_BY_VERB.holdCeremony.sceneNotes.molecules ?? "", /settles or refuses/);

  const coverageByStep = new Map<GuideRevealStep, number>();
  for (const step of REVEAL_STEPS) coverageByStep.set(step, entriesForRevealStep(step).length);
  assert.ok(
    (coverageByStep.get("Reveal") ?? 0) >= 1,
    "at least one guide entry must belong to the Reveal step so material precedes language",
  );
  assert.ok(
    (coverageByStep.get("Express") ?? 0) >= 1,
    "at least one guide entry must belong to the Express step so the loop ends in authorship",
  );

  const revealSum = REVEAL_STEPS.reduce(
    (acc, step) => acc + (coverageByStep.get(step) ?? 0),
    0,
  );
  const undeferred = GUIDE_ENTRIES.filter((entry) => entry.deferredReason === undefined).length;
  assert.equal(
    revealSum,
    undeferred,
    "every undeferred entry must belong to exactly one reveal step",
  );

  assert.equal(
    motionDurationMs(MOTION.guideOpenMs, true),
    0,
    "reduced motion must collapse the guide open transition — hierarchy and state stay, movement goes",
  );
  assert.equal(
    motionDurationMs(MOTION.guideOpenMs, false),
    MOTION.guideOpenMs,
    "unreduced motion must return the base guide open duration",
  );
  assert.equal(
    REDUCED_MOTION_EQUIVALENTS.wavePropagation,
    "detented-amplitude-with-tone",
    "reduced motion for wave propagation must preserve state via detent + tone",
  );
  assert.equal(
    REDUCED_MOTION_EQUIVALENTS.cellDivision,
    "step-change-with-pulse",
    "reduced motion for cell division must preserve state via step + pulse",
  );
  assert.equal(
    REDUCED_MOTION_EQUIVALENTS.solarPrecession,
    "hold-with-detent-tick",
    "reduced motion for solar precession must preserve state via detent tick",
  );

  console.log("native guide-data contract: ok");
}

main();
