#!/usr/bin/env node

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "objet-h2-rhf-cross-language-"));
const inputPath = path.join(temporaryDirectory, "input.json");
const typescriptPath = path.join(temporaryDirectory, "typescript.json");
const swiftPath = path.join(temporaryDirectory, "swift.json");

function run(label, command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw new Error(`${label} failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} exited with status ${result.status}`);
}

function runExpectFailure(label, command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "pipe" });
  if (result.error) throw new Error(`${label} failed: ${result.error.message}`);
  if (result.status === 0) throw new Error(`${label} unexpectedly passed`);
}

function runPresentationMutationChecks() {
  const typescript = JSON.parse(readFileSync(typescriptPath, "utf8"));
  const swift = JSON.parse(readFileSync(swiftPath, "utf8"));
  const prohibitedKeys = [
    "render",
    "renderState",
    "renderer",
    "canvas",
    "canvasContext",
    "frame",
    "frameBuffer",
    "pixel",
    "pixelBuffer",
    "shader",
    "shaderProgram",
    "gpu",
    "gpuBuffer",
    "metal",
    "metalTexture",
    "webgl",
    "webglContext",
    "drawableTexture",
    "audio",
    "audioScheduler",
    "haptic",
    "hapticEngine",
    "hapticPattern",
    "haptic-feedback",
  ];
  for (const key of prohibitedKeys) {
    const mutatedTypescript = structuredClone(typescript);
    const mutatedSwift = structuredClone(swift);
    mutatedTypescript.metadata[key] = true;
    mutatedSwift.metadata[key] = true;
    const mutatedTypescriptPath = path.join(temporaryDirectory, `mutated-typescript-${key}.json`);
    const mutatedSwiftPath = path.join(temporaryDirectory, `mutated-swift-${key}.json`);
    writeFileSync(mutatedTypescriptPath, `${JSON.stringify(mutatedTypescript)}\n`);
    writeFileSync(mutatedSwiftPath, `${JSON.stringify(mutatedSwift)}\n`);
    runExpectFailure(`presentation mutation ${key}`, process.execPath, [
      "scripts/native/compare-h2-rhf-fixtures.mjs",
      `--typescript=${mutatedTypescriptPath}`,
      `--swift=${mutatedSwiftPath}`,
    ]);
  }

  const allowedTypescript = structuredClone(typescript);
  const allowedSwift = structuredClone(swift);
  for (const key of ["frameCadenceHz", "frameCount", "actionTimingMs"]) {
    allowedTypescript.metadata[key] = 1;
    allowedSwift.metadata[key] = 1;
  }
  const allowedTypescriptPath = path.join(temporaryDirectory, "allowed-timing-typescript.json");
  const allowedSwiftPath = path.join(temporaryDirectory, "allowed-timing-swift.json");
  writeFileSync(allowedTypescriptPath, `${JSON.stringify(allowedTypescript)}\n`);
  writeFileSync(allowedSwiftPath, `${JSON.stringify(allowedSwift)}\n`);
  run("legitimate timing fields", process.execPath, [
    "scripts/native/compare-h2-rhf-fixtures.mjs",
    `--typescript=${allowedTypescriptPath}`,
    `--swift=${allowedSwiftPath}`,
  ]);
}

try {
  run("H2 RHF fixture runner", process.execPath, [
    "--experimental-strip-types",
    "scripts/native/run-h2-rhf-fixtures.mjs",
    `--input=${inputPath}`,
    `--typescript-out=${typescriptPath}`,
    `--swift-out=${swiftPath}`,
  ]);
  run("H2 RHF fixture comparator", process.execPath, [
    "scripts/native/compare-h2-rhf-fixtures.mjs",
    `--typescript=${typescriptPath}`,
    `--swift=${swiftPath}`,
  ]);
  runPresentationMutationChecks();
  console.log("h2-rhf cross-language: ok (7 deterministic scenarios; presentation mutations rejected; temporary fixtures removed)");
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
