#!/usr/bin/env node
// U8: Re-run the TypeScript reference laws against the committed fixture
// inputs and confirm the recorded `expected` values are still exactly what
// today's pure laws produce. This is the regression tripwire that catches
// silent drift when a scene lane (U9/U10/U11) edits `src/lib/waves.ts`,
// `src/lib/cytology.ts`, or `src/lib/orbits.ts` without regenerating the
// fixtures. It never advertises itself as cross-language verification —
// that is the job of `compare-cross-language-fixtures.mjs`.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 13)) {
  console.error(`native fixture runner requires Node 22.13.x for --experimental-strip-types; found ${process.versions.node}`);
  process.exit(2);
}

async function importTs(relative, label) {
  const abs = path.join(root, relative);
  try {
    return await import(pathToFileURL(abs).href);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} could not load from ${relative}; run with Node 22 --experimental-strip-types. Original error: ${detail}`);
  }
}

function need(module, name, label) {
  if (!(name in module)) throw new Error(`${label} must export ${name}`);
  return module[name];
}

function readFixture(name) {
  return JSON.parse(readFileSync(path.join(root, "scripts/native/fixtures", name), "utf8"));
}

function assertExactly(label, actual, expected) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${label} drifted from committed fixture; regenerate with \`node scripts/native/generate-reference-fixtures.mjs\` if the change was intentional.`);
  }
}

const results = [];

// Wave ----------------------------------------------------------------------
{
  const wave = await importTs("src/lib/waves.ts", "wave law");
  const {
    advanceWave2DInto,
    discreteFourierTransform,
    inverseDiscreteFourierTransform,
    signalEnergy,
  } = wave;
  const fixture = readFixture("wave-reference.json");
  const { finiteDifference, samples } = fixture.inputs;
  const width = finiteDifference.width;
  const height = finiteDifference.height;
  const current = new Float32Array(width * height);
  const previous = new Float32Array(width * height);
  const next = new Float32Array(width * height);
  const impulse = finiteDifference.impulse;
  current[impulse.y * width + impulse.x] = impulse.amplitude;
  advanceWave2DInto({
    current,
    previous,
    next,
    width,
    height,
    cSquared: finiteDifference.cSquared,
    damping: finiteDifference.damping,
  });
  const spectrum = discreteFourierTransform(samples);
  const reconstruction = inverseDiscreteFourierTransform(spectrum);
  const derived = {
    nextField: Array.from(next),
    spectrum,
    reconstruction,
    sampleEnergy: signalEnergy(samples),
  };
  assertExactly("wave.nextField", derived.nextField, fixture.expected.nextField);
  assertExactly("wave.spectrum", derived.spectrum, fixture.expected.spectrum);
  assertExactly("wave.reconstruction", derived.reconstruction, fixture.expected.reconstruction);
  assertExactly("wave.sampleEnergy", derived.sampleEnergy, fixture.expected.sampleEnergy);
  results.push({ scene: "wave", ok: true });
}

// Cell ----------------------------------------------------------------------
{
  const cell = await importTs("src/lib/cytology.ts", "cytology law");
  const {
    cellFromSeed,
    daughterSeeds,
    adhesionBetween,
    competeForNutrient,
    canEngulf,
    engulfSeed,
    advanceCulture,
  } = cell;
  const fixture = readFixture("cell-reference.json");
  const cellSeed = fixture.seed;
  const generation = fixture.inputs.generation;
  const nutrientSupply = fixture.inputs.nutrientSupply;
  const absenceHours = fixture.inputs.absenceHours;
  const siblingSeeds = daughterSeeds(cellSeed, generation);
  const parentMorph = cellFromSeed(cellSeed);
  const siblingMorphs = siblingSeeds.map(cellFromSeed);
  const initialCulture = siblingSeeds.map((seed, index) => ({
    id: `fixture-${index}`,
    seed,
    nx: 0.35 + index * 0.3,
    ny: 0.5,
    generation: 1,
    vitality: 0.8,
  }));
  const derived = {
    parentMorph,
    daughters: siblingSeeds,
    daughterMorphs: siblingMorphs,
    adhesion: adhesionBetween(siblingMorphs[0], siblingMorphs[1]),
    nutrientShares: competeForNutrient([siblingMorphs[0].radius, siblingMorphs[1].radius], nutrientSupply),
    engulfment: {
      allowed: canEngulf(0.18, 0.09),
      productSeed: engulfSeed(siblingSeeds[0], siblingSeeds[1]),
    },
    cultureAfterAbsence: advanceCulture(initialCulture, absenceHours),
  };
  assertExactly("cell.expected", derived, fixture.expected);
  results.push({ scene: "cell", ok: true });
}

// Solar ---------------------------------------------------------------------
{
  const solar = await importTs("src/lib/orbits.ts", "orbital law");
  const {
    systemFromSeed,
    positionAt,
    velocityAt,
    specificEnergyAt,
    angularMomentumAt,
    mergedBody,
    MU_UNIT,
  } = solar;
  const fixture = readFixture("solar-reference.json");
  const solarSystem = systemFromSeed(fixture.seed);
  const primary = solarSystem[fixture.inputs.primaryIndex];
  const merger = mergedBody(
    solarSystem[fixture.inputs.mergeIndices[0]],
    solarSystem[fixture.inputs.mergeIndices[1]],
    MU_UNIT,
    fixture.inputs.timeSeconds,
  );
  const derived = {
    system: solarSystem,
    primary: {
      position: positionAt(primary, MU_UNIT, fixture.inputs.timeSeconds),
      velocity: velocityAt(primary, MU_UNIT, fixture.inputs.timeSeconds),
      specificEnergy: specificEnergyAt(primary, MU_UNIT, fixture.inputs.timeSeconds),
      angularMomentum: angularMomentumAt(primary, MU_UNIT, fixture.inputs.timeSeconds),
    },
    merger,
  };
  assertExactly("solar.expected", derived, fixture.expected);
  results.push({ scene: "solar", ok: true });
}

for (const result of results) {
  console.log(`  ok  ${result.scene} reference matches committed fixture`);
}
console.log("native reference fixture regression: ok");
