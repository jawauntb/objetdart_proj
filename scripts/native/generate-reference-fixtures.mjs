import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputOption = process.argv.find((argument) => argument.startsWith("--out="));
const fixtureDirectory = outputOption
  ? path.resolve(root, outputOption.slice("--out=".length))
  : path.join(root, "scripts/native/fixtures");
const contractEntry = path.join(root, "packages/universe-contracts/src/index.ts");

async function loadTypeScript(relativePath, label) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`${label} is unavailable at ${relativePath}; complete its U2 pure-law extraction before generating fixtures`);
  }
  try {
    return await import(pathToFileURL(absolutePath).href);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} could not load. Run this script with Node 22 --experimental-strip-types. Original error: ${detail}`);
  }
}

function need(module, name, label) {
  if (!(name in module)) throw new Error(`${label} must export ${name} for native reference fixtures`);
  return module[name];
}

function fixtureMeta(scene, contractVersion, manifest) {
  const declaration = manifest.find((entry) => entry.id === scene);
  if (!declaration) throw new Error(`@objet/universe-contracts has no ${scene} Release 1 declaration`);
  return {
    fixtureVersion: 1,
    contractVersion,
    scene,
    modelVersion: declaration.simulation.modelVersion,
    simulationVersion: declaration.simulation.version,
    units: declaration.simulation.units,
  };
}

function writeFixture(name, fixture) {
  mkdirSync(fixtureDirectory, { recursive: true });
  writeFileSync(path.join(fixtureDirectory, name), `${JSON.stringify(fixture, null, 2)}\n`);
}

const [contracts, wave, cell, solar] = await Promise.all([
  loadTypeScript("packages/universe-contracts/src/index.ts", "@objet/universe-contracts"),
  loadTypeScript("src/lib/waves.ts", "wave law"),
  loadTypeScript("src/lib/cytology.ts", "cytology law"),
  loadTypeScript("src/lib/orbits.ts", "orbital law"),
]);

const manifest = need(contracts, "RELEASE_SCENE_MANIFEST", "@objet/universe-contracts");
const contractVersion = need(contracts, "NATIVE_CONTRACT_VERSION", "@objet/universe-contracts");
if (!Array.isArray(manifest)) throw new Error("RELEASE_SCENE_MANIFEST must be an array");

const advanceWave2DInto = need(wave, "advanceWave2DInto", "wave law");
const discreteFourierTransform = need(wave, "discreteFourierTransform", "wave law");
const inverseDiscreteFourierTransform = need(wave, "inverseDiscreteFourierTransform", "wave law");
const signalEnergy = need(wave, "signalEnergy", "wave law");
const waveWidth = 7;
const waveHeight = 7;
const waveCurrent = new Float32Array(waveWidth * waveHeight);
const wavePrevious = new Float32Array(waveWidth * waveHeight);
const waveNext = new Float32Array(waveWidth * waveHeight);
waveCurrent[3 * waveWidth + 3] = 1;
advanceWave2DInto({
  current: waveCurrent,
  previous: wavePrevious,
  next: waveNext,
  width: waveWidth,
  height: waveHeight,
  cSquared: 0.25,
  damping: 1,
});
const waveSamples = [0, 1, 0, -1, 0, 1, 0, -1];
const waveSpectrum = discreteFourierTransform(waveSamples);
const waveReconstruction = inverseDiscreteFourierTransform(waveSpectrum);
writeFixture("wave-reference.json", {
  ...fixtureMeta("wave", contractVersion, manifest),
  seed: 0,
  referenceCase: "centered-impulse-and-fourier-round-trip",
  comparison: { kind: "absolute", tolerance: 1e-9 },
  inputs: {
    finiteDifference: { width: waveWidth, height: waveHeight, cSquared: 0.25, damping: 1, impulse: { x: 3, y: 3, amplitude: 1 } },
    samples: waveSamples,
  },
  expected: {
    nextField: Array.from(waveNext),
    spectrum: waveSpectrum,
    reconstruction: waveReconstruction,
    sampleEnergy: signalEnergy(waveSamples),
  },
});

const cellFromSeed = need(cell, "cellFromSeed", "cytology law");
const daughterSeeds = need(cell, "daughterSeeds", "cytology law");
const adhesionBetween = need(cell, "adhesionBetween", "cytology law");
const competeForNutrient = need(cell, "competeForNutrient", "cytology law");
const canEngulf = need(cell, "canEngulf", "cytology law");
const engulfSeed = need(cell, "engulfSeed", "cytology law");
const advanceCulture = need(cell, "advanceCulture", "cytology law");
const cellSeed = 0xc311;
const siblingSeeds = daughterSeeds(cellSeed, 0);
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
writeFixture("cell-reference.json", {
  ...fixtureMeta("cell", contractVersion, manifest),
  seed: cellSeed,
  referenceCase: "lineage-competition-engulfment-and-bounded-absence",
  comparison: {
    kind: "mixed",
    exact: {
      kind: "exact",
      paths: [
        "seed",
        "inputs.generation",
        "expected.daughters",
        "expected.parentMorph.family",
        "expected.parentMorph.membraneTone",
        "expected.parentMorph.cilia.count",
        "expected.parentMorph.voice",
        "expected.daughterMorphs[*].family",
        "expected.daughterMorphs[*].membraneTone",
        "expected.daughterMorphs[*].cilia.count",
        "expected.daughterMorphs[*].voice",
        "expected.engulfment.allowed",
        "expected.engulfment.productSeed",
        "expected.cultureAfterAbsence[*].id",
        "expected.cultureAfterAbsence[*].seed",
        "expected.cultureAfterAbsence[*].generation",
      ],
    },
    floats: {
      kind: "relative",
      relativeTolerance: 1e-9,
      absoluteTolerance: 1e-12,
      scope: "every remaining finite numeric output",
    },
  },
  inputs: { generation: 0, nutrientSupply: 12, absenceHours: 168 },
  expected: {
    parentMorph,
    daughters: siblingSeeds,
    daughterMorphs: siblingMorphs,
    adhesion: adhesionBetween(siblingMorphs[0], siblingMorphs[1]),
    nutrientShares: competeForNutrient([siblingMorphs[0].radius, siblingMorphs[1].radius], 12),
    engulfment: {
      allowed: canEngulf(0.18, 0.09),
      productSeed: engulfSeed(siblingSeeds[0], siblingSeeds[1]),
    },
    cultureAfterAbsence: advanceCulture(initialCulture, 168),
  },
});

const systemFromSeed = need(solar, "systemFromSeed", "orbital law");
const positionAt = need(solar, "positionAt", "orbital law");
const velocityAt = need(solar, "velocityAt", "orbital law");
const specificEnergyAt = need(solar, "specificEnergyAt", "orbital law");
const angularMomentumAt = need(solar, "angularMomentumAt", "orbital law");
const mergedBody = need(solar, "mergedBody", "orbital law");
const MU_UNIT = need(solar, "MU_UNIT", "orbital law");
const solarSeed = 0x501a;
const solarSystem = systemFromSeed(solarSeed);
const solarTime = 137.25;
const primary = solarSystem[2];
const merger = mergedBody(solarSystem[0], solarSystem[1], MU_UNIT, solarTime);
writeFixture("solar-reference.json", {
  ...fixtureMeta("solar", contractVersion, manifest),
  seed: solarSeed,
  referenceCase: "seeded-kepler-state-and-accretion-identity",
  comparison: { kind: "absolute", tolerance: 1e-9 },
  inputs: { timeSeconds: solarTime, mu: MU_UNIT, primaryIndex: 2, mergeIndices: [0, 1] },
  expected: {
    system: solarSystem,
    primary: {
      position: positionAt(primary, MU_UNIT, solarTime),
      velocity: velocityAt(primary, MU_UNIT, solarTime),
      specificEnergy: specificEnergyAt(primary, MU_UNIT, solarTime),
      angularMomentum: angularMomentumAt(primary, MU_UNIT, solarTime),
    },
    merger,
  },
});

console.log(`native reference fixtures: wrote wave, cell, and solar to ${path.relative(root, fixtureDirectory)}`);
