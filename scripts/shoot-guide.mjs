// Captures one framed screenshot per room for the field guide (/guide).
// Output: public/guide/<key>.jpg — committed, referenced by src/data/guide.ts.
//
// Usage:
//   npm run build && npm start &        # or any served base URL
//   node scripts/shoot-guide.mjs [baseUrl] [--only=coin,tide,...]
//
// Re-run after any visible change to a room so the guide stays true.
// The guide test (scripts/test-guide.mjs) fails if a documented room has
// no screenshot on disk.

import { mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const rootUrl = new URL("../", import.meta.url);
const args = process.argv.slice(2);
const baseUrl = process.env.GUIDE_SHOOT_BASE_URL || args.find((a) => !a.startsWith("--")) || "http://127.0.0.1:3000";
const onlyArg = args.find((a) => a.startsWith("--only="));
const only = onlyArg ? new Set(onlyArg.slice("--only=".length).split(",").filter(Boolean)) : null;
const outDir = fileURLToPath(new URL("public/guide/", rootUrl));
const playwrightModule = process.env.PLAYWRIGHT_MODULE || "playwright";

let chromium;
try {
  const mod = await import(playwrightModule);
  // Some global Playwright installs don't statically analyze as ESM named
  // exports (no cjs-module-lexer match), so only `default` shows up.
  chromium = mod.chromium ?? mod.default?.chromium;
  if (!chromium) throw new Error("module has no chromium export");
} catch (error) {
  console.error(`Unable to import Playwright from ${playwrightModule}. Set PLAYWRIGHT_MODULE to an installed Playwright module path.`);
  console.error(error?.message || error);
  process.exit(1);
}

function loadTsModule(path) {
  const filename = fileURLToPath(new URL(path, rootUrl));
  const source = readFileSync(filename, "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", code)(module, module.exports, () => {
    throw new Error(`Unexpected require while loading ${path}`);
  });
  return module.exports;
}

const { SITE_ROUTES } = loadTsModule("src/lib/routes.ts");

const shots = [
  { key: "home", href: "/" },
  ...SITE_ROUTES.map((route) => ({ key: route.key, href: route.href })),
].filter((shot) => !only || only.has(shot.key));

if (shots.length === 0) {
  console.error("Nothing to shoot — check --only keys against src/lib/routes.ts.");
  process.exit(1);
}

await mkdir(outDir, { recursive: true });

const launchOptions = {
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--no-sandbox"],
};
if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) {
  launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
}

// One frame size for every room so the guide's cards sit in an even rhythm.
const VIEWPORT = { width: 1200, height: 750 };
// Rooms breathe on ~7s clocks; give canvases time to arrive at a live frame.
const SETTLE_MS = 4500;

const browser = await chromium.launch(launchOptions);
const failures = [];
try {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  for (const shot of shots) {
    const url = new URL(shot.href, baseUrl).toString();
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 45000 }).catch(async () => {
        // Long-polling assets can hold networkidle open; fall back to load.
        await page.goto(url, { waitUntil: "load", timeout: 45000 });
      });
      await page.waitForTimeout(SETTLE_MS);
      await page.screenshot({
        path: `${outDir}${shot.key}.jpg`,
        type: "jpeg",
        quality: 82,
        fullPage: false,
      });
      console.log(`shot ${shot.key} ← ${shot.href}`);
    } catch (error) {
      failures.push(`${shot.key}: ${error?.message || error}`);
    }
  }
  await context.close();
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} shot(s) failed:`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`\nguide shots ok: ${shots.length} rooms → public/guide/`);
