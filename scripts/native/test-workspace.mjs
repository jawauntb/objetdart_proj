import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const nativeRoot = path.join(root, "apps/native");
const nativeRequire = createRequire(path.join(nativeRoot, "package.json"));

function readJson(relativePath) {
  const absolutePath = path.join(root, relativePath);
  return JSON.parse(readFileSync(absolutePath, "utf8"));
}

function readText(relativePath) {
  const absolutePath = path.join(root, relativePath);
  return readFileSync(absolutePath, "utf8");
}

function appFiles(relativePath = "apps/native/app") {
  const absolutePath = path.join(root, relativePath);
  return readdirSync(absolutePath, { recursive: true })
    .filter((entry) => entry.endsWith(".tsx"))
    .map((entry) => path.join(relativePath, entry));
}

function resolvedExpoConfig() {
  const output = execFileSync(
    "npm",
    ["--workspace", "@objet/native-universe", "exec", "expo", "--", "config", "--type", "public", "--json"],
    { cwd: root, encoding: "utf8" },
  );
  return JSON.parse(output);
}

const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
assert.ok(
  nodeMajor === 22 && nodeMinor >= 13,
  "native workspace validation must run under Node 22.13.x",
);

const rootPackage = readJson("package.json");
const rootTsconfig = readJson("tsconfig.json");
assert.ok(Array.isArray(rootPackage.workspaces), "root package must declare npm workspaces");
assert.ok(rootPackage.workspaces.includes("apps/*"), "native apps must be workspace packages");
assert.ok(rootPackage.workspaces.includes("packages/*"), "shared contracts must be workspace packages");
assert.equal(
  rootPackage.scripts["test:native-workspace"],
  "node scripts/native/test-workspace.mjs",
  "native workspace verification must remain independently runnable",
);
assert.ok(
  rootTsconfig.exclude.includes("apps/native"),
  "root TypeScript must not mix web React 18 types with the native React 19 workspace",
);

const nativePackage = readJson("apps/native/package.json");
const nativeTsconfig = readJson("apps/native/tsconfig.json");
assert.equal(nativePackage.private, true, "the native app must remain private");
assert.equal(nativePackage.main, "expo-router/entry", "Expo Router owns the native shell entry point");
assert.match(nativePackage.dependencies.expo, /^~57\./, "native app must target Expo SDK 57");
assert.equal(nativePackage.dependencies.react, "19.2.3", "native React is locked independently from web React 18");
assert.equal(nativePackage.dependencies["react-native"], "0.86.2", "Expo SDK 57 requires React Native 0.86.2");
assert.match(nativePackage.engines.node, /22\.13/, "native builds must use the supported Node 22 line");
assert.ok(nativePackage.dependencies["expo-dev-client"], "native development builds need expo-dev-client");
assert.ok(nativePackage.dependencies["expo-router"], "native shell needs Expo Router");
assert.equal(nativePackage.dependencies["@objet/universe-contracts"], "*", "native bridge consumes the shared universe contract package directly");
assert.ok(nativePackage.devDependencies["babel-preset-expo"], "native bundle must declare Expo's Babel preset directly");
assert.ok(
  !nativePackage.dependencies["react-native-webview"],
  "native shell cannot install a WebView dependency",
);
assert.equal(nativeTsconfig.compilerOptions.allowImportingTsExtensions, true, "native TypeScript must accept the contracts package's versioned source imports");

const expoConfig = resolvedExpoConfig();
assert.equal(expoConfig.ios?.deploymentTarget, "17.0", "iOS 17 is the native deployment floor");
assert.equal(expoConfig.ios?.supportsTablet, true, "native app must support iPad");
assert.equal(expoConfig.userInterfaceStyle, "dark", "launch field begins in darkness");
assert.ok(expoConfig.plugins?.includes("./plugins/withObjetUniverse"), "native config must resolve the source-controlled native-root plugin");
assert.ok(expoConfig.ios?.infoPlist?.NSMotionUsageDescription, "motion access must have a privacy purpose string");

const layout = readText("apps/native/app/_layout.tsx");
const index = readText("apps/native/app/index.tsx");
assert.match(layout, /<Stack/, "native shell uses a stack, not a permanent tab bar");
assert.match(index, /backgroundColor:\s*["']#000000["']/, "launch threshold remains edge-to-edge black");
for (const relativePath of appFiles()) {
  const source = readText(relativePath);
  assert.doesNotMatch(
    source,
    /from\s*["']react-native-webview["']/,
    `${relativePath} cannot render the web app in a WebView`,
  );
  assert.doesNotMatch(
    source,
    /\bTabs\b[\s\S]*from\s*["']expo-router["']/,
    `${relativePath} cannot introduce a permanent tab bar`,
  );
}

const eas = readJson("apps/native/eas.json");
assert.equal(eas.build.development.developmentClient, true, "development profile must build a real dev client");
assert.equal(eas.build.development.distribution, "internal", "development builds are installable on physical devices");
assert.ok(eas.build.production, "a release profile must exist");
assert.ok(
  Object.values(eas.build).every((profile) => !("channel" in profile)),
  "update channels must wait for an explicit expo-updates integration",
);

const metro = nativeRequire("./metro.config.js");
assert.ok(
  metro.watchFolders.includes(path.join(root, "node_modules")),
  "Expo Metro defaults must watch the hoisted native dependency tree",
);

const plugin = readText("apps/native/plugins/withObjetUniverse.ts");
assert.match(plugin, /createRunOncePlugin/, "native-root plugin must stay source controlled");
assert.match(plugin, /objetUniverse/, "native-root plugin must retain the shared root registry");
assert.match(plugin, /objet-universe-kit/, "native-root plugin must reserve the Swift package root for U3 attachment");
assert.match(plugin, /native-tests/, "native-root plugin must reserve the UI-test root for U3 attachment");
assert.match(plugin, /PrivacyInfo\.xcprivacy/, "native-root plugin must reserve the privacy manifest path for U3 attachment");
assert.doesNotMatch(plugin, /withXcodeProject/, "U1 must not attach empty native sources to the generated Xcode project");

const universeModule = readText("apps/native/modules/objet-universe/expo-module.config.json");
const universeBridge = readText("apps/native/modules/objet-universe/src/ObjetUniverseView.tsx");
const universeView = readText("apps/native/modules/objet-universe/ios/ObjetUniverseView.swift");
const universeModuleDefinition = readText("apps/native/modules/objet-universe/ios/ObjetUniverseModule.swift");
const universePodspec = readText("apps/native/modules/objet-universe/ios/ObjetUniverse.podspec");
const universeHost = readText("packages/objet-universe-kit/Sources/ObjetUniverseCore/UniverseHost.swift");
const universeClock = readText("packages/objet-universe-kit/Sources/ObjetUniverseCore/UniverseClock.swift");
const renderHost = readText("packages/objet-universe-kit/Sources/ObjetUniverseRender/RenderHost.swift");
assert.match(universeModule, /ObjetUniverseModule/, "the local Expo module must register the native universe module");
assert.match(universeBridge, /requireNativeViewManager/, "React must use the native universe view rather than recreate a renderer");
assert.match(universeModuleDefinition, /Name\("ObjetUniverse"\)/, "the native module name must match the JS bridge");
assert.match(universeView, /UniverseHost/, "the native view must hold the scientific host");
assert.match(universePodspec, /objet-universe-kit\/Sources/, "the Expo pod must compile the shared Swift authority sources");
assert.match(universeHost, /func handoff\(to/, "the host must own transactional scene handoff");
assert.match(universeHost, /pendingCommands/, "semantic commands must wait at the authoritative host boundary");
assert.match(universeHost, /func shutdown\(\)/, "native teardown must retire the active scientific kernel");
assert.match(universeClock, /maxStepsPerFrame/, "the authority clock must bound presentation stalls");
assert.match(universeClock, /maxPendingActions/, "the authority clock must apply bounded command backpressure");
assert.match(renderHost, /clockStarts/, "the renderer host must expose its one-clock lifecycle");
assert.match(universeView, /weak var view/, "the display link must not retain the native view");
assert.match(universeView, /renderHost\.retireAll\(\)/, "native teardown must retire renderer resources");
assert.match(universeView, /guard window != nil else \{ return \}/, "foreground lifecycle cannot restart a detached native view");

const nativeLayout = readText("apps/native/app/_layout.tsx");
assert.match(nativeLayout, /<ObjetUniverseView/, "the native universe host must mount behind route overlays");
assert.ok(
  nativeLayout.indexOf("<ObjetUniverseView") < nativeLayout.indexOf("<Stack"),
  "route overlays must mount above the persistent native universe host",
);

const nativeReadme = readText("apps/native/README.md");
assert.match(nativeReadme, /apps\/native\/ios\/.*is generated/is, "README must make generated iOS ownership explicit");
assert.match(nativeReadme, /development build/i, "README must require a development build, not Expo Go");
assert.match(nativeReadme, /Node 22\.13\.x/, "README must match the native package's Node 22.13.x constraint");

const nativeCi = readText(".github/workflows/native-ci.yml");
assert.match(nativeCi, /npm run native:check/, "native CI must own its workspace check");
assert.match(nativeCi, /apps\/native/, "native CI must watch native app changes independently");
assert.match(nativeCi, /runs-on: ubuntu-latest/, "workspace-only native CI must not reserve a macOS runner");
assert.match(nativeCi, /node-version:\s*22\.13\.x/, "native CI must run the Node line declared by the native workspace");
assert.match(nativeCi, /expo\s+--\s+export\s+--platform ios/, "native CI must execute Metro for an iOS bundle");
assert.match(nativeCi, /name: Native iOS prebuild/, "native CI must reproduce the generated iOS project on macOS");
assert.match(nativeCi, /npm run native:host/, "native CI must execute the Swift host lifecycle suite on macOS");
assert.match(nativeCi, /pod install/, "native CI must resolve the autolinked universe pod");
// Full xcodebuild + Xcode 26 (Swift 6.2) simulator/device compilation is
// deferred to the U8/U16 physical-device evidence stage per the native
// cosmogony plan. See the comment in .github/workflows/native-ci.yml.
assert.match(nativeCi, /deferred to the U8\/U16/i, "native CI must document that full xcodebuild is deferred to the U8/U16 evidence stage");
assert.match(nativeCi, /tsconfig\.json/, "native CI must run when native-isolation TypeScript changes");
assert.match(nativeCi, /\.gitignore/, "native CI must run when generated-tree ownership changes");

// U8 evidence harness contract: the fixture regression runner, the cross-
// language comparator, the scenario trace type, the scenario runner overlay,
// the performance overlay, and the schema doc must all remain in place.
import { existsSync } from "node:fs";
const u8Files = [
  "scripts/native/run-reference-fixtures.mjs",
  "scripts/native/compare-cross-language-fixtures.mjs",
  "packages/objet-universe-kit/Sources/ObjetUniverseCore/ScenarioTrace.swift",
  "packages/objet-universe-kit/Tests/ObjetUniverseCoreTests/ScenarioTraceTests.swift",
  "apps/native/src/debug/ScenarioRunner.tsx",
  "apps/native/src/debug/PerformanceOverlay.tsx",
  "docs/native/evidence-schema.md",
];
for (const relative of u8Files) {
  assert.ok(existsSync(path.join(root, relative)), `U8 evidence harness requires ${relative}`);
}
assert.equal(
  rootPackage.scripts["native:fixtures:verify"],
  "node --experimental-strip-types scripts/native/run-reference-fixtures.mjs",
  "U8 evidence harness requires the fixture regression script to remain independently runnable",
);
assert.equal(
  rootPackage.scripts["native:fixtures:compare"],
  "node scripts/native/compare-cross-language-fixtures.mjs",
  "U8 evidence harness requires the cross-language fixture comparator to remain independently runnable",
);
const evidenceSchema = readText("docs/native/evidence-schema.md");
assert.match(evidenceSchema, /bundleVersion/i, "evidence schema doc must document the bundle envelope");
assert.match(evidenceSchema, /Simulator evidence/i, "evidence schema doc must call out simulator-only deviation policy");

const gitignore = readText(".gitignore");
assert.match(gitignore, /^apps\/native\/ios\/$/m, "generated apps/native/ios must remain ignored");
assert.equal(
  execFileSync("git", ["ls-files", "apps/native/ios"], { cwd: root, encoding: "utf8" }).trim(),
  "",
  "generated apps/native/ios must not become a source tree",
);

// U7 — native art direction and felt-proof pedagogy.
// The design tokens, scene-style wrapper, chrome, guide data, and guide sheet
// must all be present; the reviewer prose must document the six shared
// sections; the world route must mount the shared chrome; and both U7 test
// files must be runnable under `node --experimental-strip-types`.
const designTokens = readText("apps/native/src/design/tokens.ts");
const designSceneStyle = readText("apps/native/src/design/sceneStyle.ts");
const nativeChrome = readText("apps/native/src/design/NativeChrome.tsx");
const guideData = readText("apps/native/src/guide/guideData.ts");
const guideSheet = readText("apps/native/src/guide/GuideSheet.tsx");
const artDirection = readText("docs/native/art-direction.md");
const worldRoute = readText("apps/native/app/world.tsx");

assert.match(designTokens, /export const PALETTE/, "native design tokens must declare a shared palette");
assert.match(designTokens, /REDUCED_MOTION_EQUIVALENTS/, "native design tokens must declare reduced-motion equivalents that preserve state");
assert.match(designSceneStyle, /RELEASE_SCENE_MANIFEST/, "sceneStyle.ts must consume RELEASE_SCENE_MANIFEST rather than restate scene briefs");
assert.doesNotMatch(designSceneStyle, /bannedForms:\s*\[/, "sceneStyle.ts must not restate bannedForms — read them from the settled manifest");
assert.match(nativeChrome, /GuideSheet/, "NativeChrome must host the GuideSheet as its only writing surface");
assert.doesNotMatch(nativeChrome, /\bTabs\b[\s\S]*from\s*["']expo-router["']/, "NativeChrome must not introduce a permanent tab bar");
assert.match(guideData, /NATIVE_GUIDE_VERBS/, "guideData.ts must declare the site-wide verb vocabulary the guide covers");
assert.match(guideData, /REVEAL_STEPS/, "guideData.ts must declare the Play/Reveal/Name/Transfer/Express choreography");
assert.match(guideSheet, /allowFontScaling/, "GuideSheet must respect Dynamic Type accessibility sizes");
assert.match(guideSheet, /reducedMotion/, "GuideSheet must respect prefers-reduced-motion");

for (const section of [
  /Living scientific sublime/i,
  /state-to-sense mappings/i,
  /Scale registers/i,
  /Typography/i,
  /Motion language/i,
  /Banned generic forms/i,
  /Scene briefs/i,
  /Post-discovery reveal choreography/i,
  /Minimal safe-area chrome/i,
  /iPhone vs iPad/i,
]) {
  assert.match(artDirection, section, `art-direction.md is missing required section matching ${section}`);
}

assert.match(worldRoute, /<NativeChrome/, "the world route must mount NativeChrome above the persistent universe host");
assert.match(worldRoute, /backgroundColor:\s*["']transparent["']/, "the world route must remain transparent so the persistent universe host renders through");

const nativeGuideVerbs = extractStringArrayLiteral(guideData, "NATIVE_GUIDE_VERBS");
assert.ok(nativeGuideVerbs.length > 0, "NATIVE_GUIDE_VERBS must declare the guide-covered verbs");
const webDefaults = readText("src/lib/gesture/defaults.ts");
const webGlobalVerbs = extractGlobalVerbList(webDefaults);
assert.ok(webGlobalVerbs.length > 0, "web GLOBAL_VERBS must remain extractable so native coverage can be pinned");
for (const verb of webGlobalVerbs) {
  assert.ok(nativeGuideVerbs.includes(verb), `native guide missing coverage for web GLOBAL_VERB "${verb}"`);
}
for (const verb of nativeGuideVerbs) {
  assert.ok(webGlobalVerbs.includes(verb), `native guide declares verb "${verb}" that is not in web GLOBAL_VERBS`);
}
assert.equal(nativeGuideVerbs.length, webGlobalVerbs.length, "native guide must map 1:1 to web GLOBAL_VERBS");

// Both U7 test files must remain runnable under node --experimental-strip-types.
execFileSync("node", ["--experimental-strip-types", "apps/native/src/design/__tests__/sceneStyle.test.ts"], { cwd: root, stdio: "inherit" });
execFileSync("node", ["--experimental-strip-types", "apps/native/src/guide/__tests__/guideData.test.ts"], { cwd: root, stdio: "inherit" });

function extractStringArrayLiteral(source, identifier) {
  const marker = `export const ${identifier}`;
  const start = source.indexOf(marker);
  if (start === -1) return [];
  const open = source.indexOf("[", start);
  const close = source.indexOf("]", open);
  if (open === -1 || close === -1) return [];
  const body = source.slice(open + 1, close);
  return body.split(",").map((entry) => entry.trim().replace(/^["']|["'](?:\s*as\s+const)?$/g, "")).filter((entry) => entry.length > 0 && !entry.includes(" "));
}

function extractGlobalVerbList(source) {
  const start = source.indexOf("export const GLOBAL_VERBS");
  if (start === -1) return [];
  const open = source.indexOf("[", start);
  const close = source.indexOf("] as const", open);
  if (open === -1 || close === -1) return [];
  const body = source.slice(open, close);
  const verbs = [];
  const regex = /verb:\s*"([^"]+)"/g;
  let match;
  while ((match = regex.exec(body)) !== null) verbs.push(match[1]);
  return verbs;
}

console.log("native workspace contract: ok");
