#!/usr/bin/env node

import { readFileSync } from "node:fs";

function argument(prefix) {
  return process.argv.find((value) => value.startsWith(`${prefix}=`))?.slice(prefix.length + 1);
}

const typescriptPath = argument("--typescript") ?? process.argv[2];
const swiftPath = argument("--swift") ?? process.argv[3];
if (!typescriptPath || !swiftPath) throw new Error("usage: compare-h2-rhf-fixtures.mjs --typescript=<path> --swift=<path>");

const typescript = JSON.parse(readFileSync(typescriptPath, "utf8"));
const swift = JSON.parse(readFileSync(swiftPath, "utf8"));
const errors = [];
let worst = { path: null, delta: 0, tolerance: 0 };

// Presentation and sensory output must never become part of the authority
// fixture.  Normalize only the key itself (rather than searching the whole
// path or using a substring regex) so action timing fields such as
// `frameCadenceHz`, `frameCount`, and `actionTimingMs` remain legitimate.
const FORBIDDEN_PRESENTATION_KEYS = new Set([
  "render",
  "renderer",
  "canvas",
  "frame",
  "pixel",
  "shader",
  "gpu",
  "metal",
  "webgl",
  "drawabletexture",
  "audio",
]);

const FORBIDDEN_PRESENTATION_PREFIXES = [
  "render",
  "canvas",
  "pixel",
  "shader",
  "gpu",
  "metal",
  "webgl",
  "drawabletexture",
  "audio",
  "haptic",
];

const ALLOWED_FRAME_TIMING_KEYS = new Set([
  "framecadencehz",
  "framecount",
]);

function normalizeKey(key) {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isForbiddenPresentationKey(key) {
  const normalized = normalizeKey(key);
  if (ALLOWED_FRAME_TIMING_KEYS.has(normalized)) return false;
  if (normalized.startsWith("frame")) return true;
  return FORBIDDEN_PRESENTATION_KEYS.has(normalized)
    || FORBIDDEN_PRESENTATION_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function rejectForbidden(value, path, label) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectForbidden(entry, `${path}[${index}]`, label));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    const entryPath = path ? `${path}.${key}` : key;
    if (isForbiddenPresentationKey(key)) errors.push(`${label} contains forbidden presentation key at ${entryPath}`);
    rejectForbidden(entry, entryPath, label);
  }
}

function keyList(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).sort() : null;
}

function exact(expected, actual, path) {
  if (typeof expected !== typeof actual) {
    errors.push(`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    return;
  }
  if (expected === null || actual === null) {
    if (expected !== actual) errors.push(`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    return;
  }
  if (typeof expected === "number" || typeof expected === "string" || typeof expected === "boolean") {
    if (!Object.is(expected, actual)) errors.push(`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    return;
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) {
      errors.push(`${path}: array shape differs`);
      return;
    }
    for (let index = 0; index < expected.length; index += 1) exact(expected[index], actual[index], `${path}[${index}]`);
    return;
  }
  const expectedKeys = keyList(expected);
  const actualKeys = keyList(actual);
  if (!expectedKeys || !actualKeys || JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) {
    errors.push(`${path}: object keys differ (expected ${JSON.stringify(expectedKeys)}, got ${JSON.stringify(actualKeys)})`);
    return;
  }
  for (const key of expectedKeys) exact(expected[key], actual[key], `${path}.${key}`);
}

function numericTolerance(path, tolerances) {
  if (/(^|\.)density(?:\[|$)/.test(path)) return tolerances.densityMatrixMaxAbs;
  if (/(^|\.)(energy|energyDelta)$/.test(path)) return tolerances.totalEnergyMaxAbs;
  if (/(^|\.)(electronCount|electronCountError)$/.test(path)) return tolerances.electronCountMaxAbs;
  if (/(^|\.)residual$/.test(path)) return tolerances.densityMatrixMaxAbs;
  return null;
}

function semantic(expected, actual, path, tolerances) {
  if (typeof expected !== typeof actual) {
    errors.push(`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    return;
  }
  if (expected === null || actual === null) {
    if (expected !== actual) errors.push(`${path}: nullability differs (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
    return;
  }
  if (typeof expected === "number") {
    if (typeof actual !== "number") {
      errors.push(`${path}: expected numeric value, got ${JSON.stringify(actual)}`);
      return;
    }
    const delta = Math.abs(actual - expected);
    const tolerance = numericTolerance(path, tolerances);
    if (delta > worst.delta) worst = { path, delta, tolerance: tolerance ?? 0 };
    if (tolerance === null ? !Object.is(expected, actual) : delta > tolerance) {
      errors.push(`${path}: expected ${expected}, got ${actual}, delta ${delta}, tolerance ${tolerance ?? 0}`);
    }
    return;
  }
  if (typeof expected === "string" || typeof expected === "boolean") {
    if (!Object.is(expected, actual)) errors.push(`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    return;
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) {
      errors.push(`${path}: array shape differs`);
      return;
    }
    for (let index = 0; index < expected.length; index += 1) semantic(expected[index], actual[index], `${path}[${index}]`, tolerances);
    return;
  }
  const expectedKeys = keyList(expected);
  const actualKeys = keyList(actual);
  if (!expectedKeys || !actualKeys || JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) {
    errors.push(`${path}: object keys differ (expected ${JSON.stringify(expectedKeys)}, got ${JSON.stringify(actualKeys)})`);
    return;
  }
  for (const key of expectedKeys) semantic(expected[key], actual[key], `${path}.${key}`, tolerances);
}

rejectForbidden(typescript, "", "TypeScript fixture");
rejectForbidden(swift, "", "Swift fixture");
exact(typescript.metadata, swift.metadata, "metadata");
if (!typescript.metadata?.tolerances) errors.push("metadata.tolerances is required");

const expectedScenarios = typescript.scenarios;
const actualScenarios = swift.scenarios;
if (!Array.isArray(expectedScenarios) || !Array.isArray(actualScenarios)) {
  errors.push("scenarios must be arrays in both fixture outputs");
} else if (expectedScenarios.length !== actualScenarios.length) {
  errors.push(`scenario count differs (expected ${expectedScenarios.length}, got ${actualScenarios.length})`);
} else {
  for (let index = 0; index < expectedScenarios.length; index += 1) {
    const expected = expectedScenarios[index];
    const actual = actualScenarios[index];
    const path = `scenarios[${index}]`;
    exact(expected.scenario, actual.scenario, `${path}.scenario`);
    exact(expected.frameCadenceHz, actual.frameCadenceHz, `${path}.frameCadenceHz`);
    exact(expected.actions, actual.actions, `${path}.actions`);
    semantic(expected.trace, actual.trace, `${path}.trace`, typescript.metadata.tolerances);
    semantic(expected.milestones, actual.milestones, `${path}.milestones`, typescript.metadata.tolerances);
    semantic(expected.snapshot, actual.snapshot, `${path}.snapshot`, typescript.metadata.tolerances);
    exact(expected.adapter, actual.adapter, `${path}.adapter`);
  }
}

if (errors.length > 0) {
  console.error(`h2-rhf cross-language: ${errors.length} mismatch(es)`);
  for (const error of errors.slice(0, 20)) console.error(`  ${error}`);
  if (errors.length > 20) console.error(`  … ${errors.length - 20} more mismatch(es)`);
  if (worst.path) console.error(`  worst numeric delta: ${worst.path} = ${worst.delta} (tolerance ${worst.tolerance})`);
  process.exit(1);
}

const worstSummary = worst.path ? `; worst numeric delta ${worst.delta} at ${worst.path}` : "";
console.log(`h2-rhf cross-language: ${expectedScenarios.length} scenarios match${worstSummary}`);
