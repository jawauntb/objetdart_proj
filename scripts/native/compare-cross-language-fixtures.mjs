#!/usr/bin/env node
// U8: Compare a Swift-emitted fixture snapshot against the committed
// TypeScript reference fixture under the fixture's own `comparison`
// policy. This is the enforcement point for the plan's rule that
// "tolerance-based scientific comparisons never become sync hashes
// implicitly": absolute-tolerance fixtures apply a numeric max-delta
// gate, mixed-tolerance fixtures split into an exact-path set and a
// relative/absolute float scope, and any structural drift (missing
// keys, wrong types, extra keys) fails the comparison immediately.
//
// Usage:
//   node scripts/native/compare-cross-language-fixtures.mjs \
//     --scene wave \
//     --swift path/to/swift-output.json \
//     [--tolerance-report path/to/report.json]

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function parseArgs(argv) {
  const args = new Map();
  for (let i = 2; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith("--")) continue;
    const eq = value.indexOf("=");
    if (eq >= 0) {
      args.set(value.slice(2, eq), value.slice(eq + 1));
    } else {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args.set(value.slice(2), next);
        i += 1;
      } else {
        args.set(value.slice(2), "true");
      }
    }
  }
  return args;
}

const args = parseArgs(process.argv);
const sceneArg = args.get("scene");
const swiftArg = args.get("swift");
const reportArg = args.get("tolerance-report");
if (!sceneArg || !swiftArg) {
  console.error("usage: compare-cross-language-fixtures.mjs --scene wave|cell|solar --swift <path> [--tolerance-report <path>]");
  process.exit(2);
}
if (!["wave", "cell", "solar"].includes(sceneArg)) {
  console.error(`unknown scene ${sceneArg}; expected wave|cell|solar`);
  process.exit(2);
}

const referencePath = path.join(root, "scripts/native/fixtures", `${sceneArg}-reference.json`);
const reference = JSON.parse(readFileSync(referencePath, "utf8"));
const swiftPath = path.isAbsolute(swiftArg) ? swiftArg : path.join(process.cwd(), swiftArg);
const swift = JSON.parse(readFileSync(swiftPath, "utf8"));

function headerFieldMissing(fixture, keys) {
  return keys.filter((key) => !(key in fixture));
}

const requiredHeader = ["fixtureVersion", "contractVersion", "scene", "modelVersion", "simulationVersion", "units", "seed", "referenceCase", "comparison", "inputs", "expected"];
const missing = headerFieldMissing(swift, requiredHeader);
if (missing.length > 0) {
  console.error(`swift output for ${sceneArg} is missing required header keys: ${missing.join(", ")}`);
  process.exit(1);
}

if (swift.scene !== reference.scene) {
  console.error(`swift scene ${swift.scene} does not match reference ${reference.scene}`);
  process.exit(1);
}
if (swift.fixtureVersion !== reference.fixtureVersion) {
  console.error(`swift fixtureVersion ${swift.fixtureVersion} does not match reference ${reference.fixtureVersion}; regenerate before comparing`);
  process.exit(1);
}
if (swift.contractVersion !== reference.contractVersion) {
  console.error(`swift contractVersion ${swift.contractVersion} does not match reference ${reference.contractVersion}`);
  process.exit(1);
}
if (swift.modelVersion !== reference.modelVersion) {
  console.error(`swift modelVersion ${swift.modelVersion} does not match reference ${reference.modelVersion}`);
  process.exit(1);
}
if (swift.simulationVersion !== reference.simulationVersion) {
  console.error(`swift simulationVersion ${swift.simulationVersion} does not match reference ${reference.simulationVersion}`);
  process.exit(1);
}

// Structural drift detector -------------------------------------------------

function collectShape(value, path = "") {
  if (value === null) return [[path, "null"]];
  if (Array.isArray(value)) {
    if (value.length === 0) return [[path, "array/0"]];
    const shapes = [[path, `array/${value.length}`]];
    for (let i = 0; i < value.length; i += 1) {
      shapes.push(...collectShape(value[i], `${path}[${i}]`));
    }
    return shapes;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    const shapes = [[path, `object/${keys.join(",")}`]];
    for (const key of keys) {
      shapes.push(...collectShape(value[key], path ? `${path}.${key}` : key));
    }
    return shapes;
  }
  return [[path, typeof value]];
}

function structuralDiff(swiftValue, refValue) {
  const swiftShape = new Map(collectShape(swiftValue));
  const refShape = new Map(collectShape(refValue));
  const drift = [];
  for (const [path, kind] of refShape) {
    if (!swiftShape.has(path)) drift.push({ path, expected: kind, actual: "missing" });
    else if (swiftShape.get(path) !== kind) drift.push({ path, expected: kind, actual: swiftShape.get(path) });
  }
  for (const [path, kind] of swiftShape) {
    if (!refShape.has(path)) drift.push({ path, expected: "missing", actual: kind });
  }
  return drift;
}

const drift = structuralDiff(swift.expected, reference.expected);
if (drift.length > 0) {
  console.error(`swift expected shape drifts from reference for ${sceneArg}:`);
  for (const entry of drift.slice(0, 20)) {
    console.error(`  ${entry.path || "<root>"}: expected ${entry.expected}, actual ${entry.actual}`);
  }
  if (drift.length > 20) console.error(`  … ${drift.length - 20} more entries suppressed`);
  process.exit(1);
}

// Comparison policies -------------------------------------------------------

function walk(value, prefix, visit) {
  visit(prefix, value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) walk(value[i], `${prefix}[${i}]`, visit);
    return;
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) walk(value[key], prefix ? `${prefix}.${key}` : key, visit);
  }
}

function resolvePath(container, dotted) {
  const parts = dotted.split(".");
  let cursor = container;
  for (const part of parts) {
    if (cursor === null || cursor === undefined) return { present: false, value: undefined };
    if (part.endsWith("]")) {
      const [name, indexRaw] = part.split("[");
      if (name) {
        cursor = cursor[name];
        if (cursor === undefined) return { present: false, value: undefined };
      }
      const index = Number(indexRaw.slice(0, -1));
      cursor = cursor[index];
    } else {
      cursor = cursor[part];
    }
  }
  return { present: cursor !== undefined, value: cursor };
}

function expandExactPaths(patterns, container) {
  const expanded = new Set();
  for (const pattern of patterns) {
    if (!pattern.includes("[*]")) {
      expanded.add(pattern);
      continue;
    }
    const [head, ...rest] = pattern.split("[*]");
    const source = resolvePath(container, head).value;
    if (!Array.isArray(source)) continue;
    for (let i = 0; i < source.length; i += 1) {
      expanded.add(`${head}[${i}]${rest.join("[*]")}`);
    }
  }
  return expanded;
}

function evaluateAbsolute(swiftValue, refValue, tolerance) {
  const report = { kind: "absolute", tolerance, worstDeltaAbs: 0, worstPath: null };
  const errors = [];
  walk(refValue, "", (path, reference) => {
    const swiftCursor = resolvePath({ root: swiftValue }, path ? `root.${path}` : "root");
    const swiftAtPath = swiftCursor.value;
    if (typeof reference !== "number") {
      if (swiftAtPath !== reference && !(Array.isArray(swiftAtPath) && Array.isArray(reference)) && !(swiftAtPath && typeof swiftAtPath === "object")) {
        errors.push({ path, kind: "structural", reference, actual: swiftAtPath });
      }
      return;
    }
    if (typeof swiftAtPath !== "number") {
      errors.push({ path, kind: "type", reference, actual: swiftAtPath });
      return;
    }
    const delta = Math.abs(swiftAtPath - reference);
    if (delta > report.worstDeltaAbs) {
      report.worstDeltaAbs = delta;
      report.worstPath = path;
    }
    if (delta > tolerance) {
      errors.push({ path, kind: "delta", reference, actual: swiftAtPath, delta });
    }
  });
  return { report, errors };
}

function evaluateMixed(swiftValue, refValue, policy) {
  const errors = [];
  const exactPaths = expandExactPaths(policy.exact?.paths ?? [], { expected: refValue });
  const rootedExact = new Set();
  for (const path of exactPaths) {
    // Fixture paths are rooted at the fixture document; strip the "expected." prefix
    // that the file records so we can walk swift.expected / reference.expected.
    const trimmed = path.startsWith("expected.") ? path.slice("expected.".length) : path;
    rootedExact.add(trimmed);
  }
  for (const relativePath of rootedExact) {
    const refCursor = resolvePath({ expected: refValue }, `expected.${relativePath}`);
    const swiftCursor = resolvePath({ expected: swiftValue }, `expected.${relativePath}`);
    if (!refCursor.present) continue;
    if (JSON.stringify(swiftCursor.value) !== JSON.stringify(refCursor.value)) {
      errors.push({ path: relativePath, kind: "exact", reference: refCursor.value, actual: swiftCursor.value });
    }
  }

  const floats = policy.floats ?? {};
  const relative = floats.relativeTolerance ?? 0;
  const absolute = floats.absoluteTolerance ?? 0;
  const report = { kind: "mixed", exactPaths: rootedExact.size, floats: { relativeTolerance: relative, absoluteTolerance: absolute }, worstRelative: 0, worstAbsolute: 0, worstPath: null };
  walk(refValue, "", (path, reference) => {
    if (rootedExact.has(path)) return;
    if (typeof reference !== "number") return;
    const swiftCursor = resolvePath({ root: swiftValue }, path ? `root.${path}` : "root");
    const swiftAtPath = swiftCursor.value;
    if (typeof swiftAtPath !== "number") {
      errors.push({ path, kind: "type", reference, actual: swiftAtPath });
      return;
    }
    const abs = Math.abs(swiftAtPath - reference);
    const rel = Math.abs(reference) > 0 ? abs / Math.abs(reference) : abs;
    if (rel > report.worstRelative) { report.worstRelative = rel; report.worstPath = path; }
    if (abs > report.worstAbsolute) { report.worstAbsolute = abs; }
    if (abs > absolute && rel > relative) {
      errors.push({ path, kind: "float", reference, actual: swiftAtPath, delta: abs, relative: rel });
    }
  });
  return { report, errors };
}

const policy = reference.comparison;
let report;
let errors;
if (policy.kind === "absolute") {
  ({ report, errors } = evaluateAbsolute(swift.expected, reference.expected, policy.tolerance));
} else if (policy.kind === "mixed") {
  ({ report, errors } = evaluateMixed(swift.expected, reference.expected, policy));
} else {
  console.error(`unknown comparison kind ${policy.kind} in ${referencePath}`);
  process.exit(1);
}

const summary = {
  scene: sceneArg,
  referenceFixture: path.relative(root, referencePath),
  swiftOutput: path.relative(root, swiftPath),
  result: errors.length === 0 ? "pass" : "fail",
  report,
  errors: errors.slice(0, 32),
  errorsTotal: errors.length,
};

if (reportArg) {
  writeFileSync(path.isAbsolute(reportArg) ? reportArg : path.join(process.cwd(), reportArg), `${JSON.stringify(summary, null, 2)}\n`);
}

if (summary.result === "pass") {
  const kind = report.kind === "absolute" ? `worst abs=${report.worstDeltaAbs.toExponential(3)}` : `worst rel=${report.worstRelative.toExponential(3)}, abs=${report.worstAbsolute.toExponential(3)}`;
  console.log(`  ok  ${sceneArg} matches ${path.relative(root, referencePath)} (${kind})`);
} else {
  console.error(`swift/reference mismatch for ${sceneArg} (${errors.length} error${errors.length === 1 ? "" : "s"}):`);
  for (const entry of summary.errors) {
    console.error(`  ${entry.path || "<root>"}: ${JSON.stringify(entry).slice(0, 240)}`);
  }
  process.exit(1);
}
