#!/usr/bin/env node
/**
 * Runs `apps/native/src/accessibility/__tests__/UniverseActions.test.tsx`
 * under Node 22's `--experimental-strip-types` loader. Node 22 still refuses
 * to interpret a `.tsx` extension as TypeScript (that arrived in 23+), so
 * the file — which contains no JSX; only imports and assertions — is
 * temporarily copied to a sibling `.ts` inside the same directory so its
 * relative imports keep resolving. The sibling is deleted on exit.
 */

import { copyFileSync, existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const tsxPath = path.join(repoRoot, "apps/native/src/accessibility/__tests__/UniverseActions.test.tsx");
const shimPath = path.join(repoRoot, "apps/native/src/accessibility/__tests__/UniverseActions.test.native-shim.ts");

if (!existsSync(tsxPath)) {
  console.error(`missing test file at ${tsxPath}`);
  process.exit(1);
}

copyFileSync(tsxPath, shimPath);

let status = 1;
try {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings=ExperimentalWarning", "--test", shimPath],
    { stdio: "inherit", cwd: repoRoot },
  );
  status = result.status ?? 1;
} finally {
  if (existsSync(shimPath)) unlinkSync(shimPath);
}

process.exit(status);
