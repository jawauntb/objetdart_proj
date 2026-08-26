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

function inspectOpaqueRgbPng(relativePath) {
  const png = readFileSync(path.join(root, relativePath));
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.subarray(0, 8).equals(signature), `${relativePath} must be a PNG`);

  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const bitDepth = png[24];
  const colorType = png[25];
  const interlace = png[28];
  assert.equal(bitDepth, 8, `${relativePath} must use 8-bit channels`);
  assert.equal(colorType, 2, `${relativePath} must be opaque RGB with no alpha channel`);
  assert.equal(interlace, 0, `${relativePath} must be non-interlaced`);

  return {
    width,
    height,
    encodedBytes: png.byteLength,
  };
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
assert.equal(
  nativePackage.scripts.prebuild,
  "expo prebuild --clean --platform ios --no-install",
  "native prebuild must remain a clean Expo prebuild so the generated ios/ tree is disposable",
);
assert.equal(
  nativePackage.scripts["build:prod"],
  "npx eas-cli@22.4.0 build --platform ios --profile production",
  "production TestFlight must pin the verified eas-cli release",
);
assert.equal(
  nativePackage.scripts.submit,
  "npx eas-cli@22.4.0 submit --platform ios --latest",
  "manual TestFlight submit must use the same verified eas-cli release",
);
assert.match(nativePackage.dependencies.expo, /^~57\./, "native app must target Expo SDK 57");
assert.equal(nativePackage.dependencies.react, "19.2.3", "native React is locked independently from web React 18");
assert.equal(nativePackage.dependencies["react-native"], "0.86.2", "Expo SDK 57 requires React Native 0.86.2");
assert.match(nativePackage.engines.node, /22\.13/, "native builds must use the supported Node 22 line");
assert.ok(nativePackage.dependencies["expo-dev-client"], "native development builds need expo-dev-client");
assert.equal(nativePackage.dependencies["expo-file-system"], "57.0.4", "the native trail adapter must pin the Expo file-system API to the SDK 57 baseline");
assert.ok(nativePackage.dependencies["expo-router"], "native shell needs Expo Router");
assert.equal(nativePackage.dependencies["@objet/universe-contracts"], "*", "native bridge consumes the shared universe contract package directly");
assert.equal(
  nativePackage.dependencies["@objet/objet-universe"],
  "file:./modules/objet-universe",
  "native app must autolink the local universe Expo module",
);
assert.ok(nativePackage.devDependencies["babel-preset-expo"], "native bundle must declare Expo's Babel preset directly");
assert.ok(
  !nativePackage.dependencies["react-native-webview"],
  "native shell cannot install a WebView dependency",
);
assert.equal(nativeTsconfig.compilerOptions.allowImportingTsExtensions, true, "native TypeScript must accept the contracts package's versioned source imports");

const expoConfig = resolvedExpoConfig();
assert.equal(expoConfig.ios?.deploymentTarget, "17.0", "iOS 17 is the native deployment floor");
assert.equal(expoConfig.ios?.buildNumber, undefined, "remote EAS versioning must be the only iOS build-number authority");
assert.equal(expoConfig.ios?.supportsTablet, true, "native app must support iPad");
assert.equal(expoConfig.userInterfaceStyle, "dark", "launch field begins in darkness");
assert.ok(expoConfig.plugins?.includes("./plugins/withObjetUniverse"), "native config must resolve the source-controlled native-root plugin");
assert.ok(expoConfig.ios?.infoPlist?.NSMotionUsageDescription, "motion access must have a privacy purpose string");
assert.equal(expoConfig.icon, "./assets/icon.png", "Expo must package the source-controlled app icon");
const appIcon = inspectOpaqueRgbPng("apps/native/assets/icon.png");
assert.deepEqual([appIcon.width, appIcon.height], [1024, 1024], "the App Store icon must be exactly 1024 × 1024");
assert.ok(appIcon.encodedBytes >= 64_000, "the icon cannot regress to the previous flat-black placeholder");

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
assert.equal(eas.cli.appVersionSource, "remote", "EAS must own iOS buildNumber so every store submit is unique");
assert.equal(eas.build.production.autoIncrement, true, "production must auto-increment the remote iOS buildNumber");
assert.equal(eas.build.production.node, "22.13.0", "EAS production must use the native Node 22.13 line");
assert.equal(eas.build["simulator-release"].developmentClient, false, "release simulator must run the standalone app shell");
assert.equal(eas.build["simulator-release"].distribution, "internal", "release simulator builds must remain directly installable");
assert.equal(eas.build["simulator-release"].ios.simulator, true, "release simulator profile must target the simulator");
assert.equal(eas.submit.production.ios.bundleIdentifier, "com.objetdart.universe", "TestFlight submit must name the store bundle id");
assert.equal(eas.submit.production.ios.appleTeamId, "58877MPK38", "TestFlight submit must name the Apple team");
assert.equal(eas.submit.production.ios.ascAppId, "6803362991", "TestFlight submit must name the App Store Connect app so CI can run non-interactive");
assert.ok(
  Object.values(eas.build).every((profile) => !("channel" in profile)),
  "update channels must wait for an explicit expo-updates integration",
);
assert.equal(expoConfig.runtimeVersion, undefined, "runtime policy must land with the explicit expo-updates integration");

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
const universeSurfaceBridge = readText("apps/native/modules/objet-universe/src/ObjetUniverseSurface.tsx");
const universeSurfaceView = readText("apps/native/modules/objet-universe/ios/ObjetUniverseSurfaceView.swift");
const universeRuntime = readText("apps/native/modules/objet-universe/ios/UniverseRuntime.swift");
const universePodspec = readText("apps/native/modules/objet-universe/ios/ObjetUniverse.podspec");
const universeHost = readText("packages/objet-universe-kit/Sources/ObjetUniverseCore/UniverseHost.swift");
const universeClock = readText("packages/objet-universe-kit/Sources/ObjetUniverseCore/UniverseClock.swift");
const renderHost = readText("packages/objet-universe-kit/Sources/ObjetUniverseRender/RenderHost.swift");
const metalRenderTest = readText("packages/objet-universe-kit/Tests/ObjetUniverseCoreTests/WaveMetalRenderTests.swift");
const nativeCI = readText(".github/workflows/native-ci.yml");
assert.match(universeView, /maximum:\s*60,\s*preferred:\s*60/, "native presentation must stay within a 60 Hz frame budget");
assert.match(metalRenderTest, /environment\["CI"\]\s*==\s*"true"[\s\S]*XCTFail/, "Metal visibility must fail rather than skip in CI");
assert.match(nativeCI, /swift test -c release --package-path packages\/objet-universe-kit/, "macOS CI must execute the Metal visibility gate");
assert.match(universeModule, /ObjetUniverseModule/, "the local Expo module must register the native universe module");
assert.match(universeBridge, /requireNativeViewManager/, "React must use the native universe view rather than recreate a renderer");
assert.match(universeModuleDefinition, /Name\("ObjetUniverse"\)/, "the native module name must match the JS bridge");
assert.match(universeView, /UniverseHost/, "the native view must hold the scientific host");
assert.match(universePodspec, /objet-universe-kit\/Sources/, "the Expo pod must compile the shared Swift authority sources");
assert.match(universePodspec, /s\.dependency ["']ObjetUniverseKit["']/, "the Expo pod must depend on the shared Swift kit pod");
const kitPodspec = readText("packages/objet-universe-kit/ObjetUniverseKit.podspec");
assert.match(kitPodspec, /s\.name = ["']ObjetUniverseKit["']/, "the Swift kit must ship a CocoaPods spec for Expo prebuild");
assert.match(kitPodspec, /Sources\/ObjetUniverseCore/, "the kit pod must compile the host and clock");
assert.doesNotMatch(kitPodspec, /ObjetUniversePersistence/, "the Expo kit pod must not pull GRDB persistence into the first store build");
const appConfig = readText("apps/native/app.config.ts");
assert.match(appConfig, /name:\s*["']ObjetUniverseKit["']/, "prebuild must extra-pod the Swift kit");
assert.match(appConfig, /path:\s*["']\.\.\/\.\.\/\.\.\/packages\/objet-universe-kit["']/, "the kit extra pod path must resolve from the generated ios/ tree");
assert.match(appConfig, /appleTeamId:\s*["']58877MPK38["']/, "the Expo ios config must name the Apple team for EAS credentials");
assert.doesNotMatch(appConfig, /runtimeVersion/, "unused OTA runtime policy must not warn during binary-only TestFlight builds");
assert.match(appConfig, /version:\s*["']0\.2\.0["']/, "the chemistry native slice must ship a new app runtime version");
assert.match(universeView, /import ObjetUniverseKit/, "the native view must import the shared Swift kit module");
assert.match(universeHost, /func handoff\(to/, "the host must own transactional scene handoff");
assert.match(universeHost, /pendingCommands/, "semantic commands must wait at the authoritative host boundary");
assert.match(universeHost, /func shutdown\(\)/, "native teardown must retire the active scientific kernel");
assert.match(universeClock, /maxStepsPerFrame/, "the authority clock must bound presentation stalls");
assert.match(universeClock, /maxPendingActions/, "the authority clock must apply bounded command backpressure");
assert.match(renderHost, /clockStarts/, "the renderer host must expose its one-clock lifecycle");
assert.match(universeView, /weak var view/, "the display link must not retain the native view");
assert.match(universeView, /nonisolated fileprivate func advanceFrame/, "the display-link tick must be nonisolated so Swift 6.2 will not send CADisplayLink");
assert.doesNotMatch(universeView, /func display\(_ link: CADisplayLink\)/, "naming the tick display(_:) makes Xcode type the argument as CALayer");
assert.match(universeView, /nonisolated\(unsafe\)/, "view hosts must be retireable from Swift 6.2's nonisolated UIView deinit");
assert.match(universeView, /@unchecked Sendable/, "the display-link target must be Sendable so the tick can hop to the view");
assert.match(universeView, /renderHost\.retireAll\(\)/, "native teardown must retire renderer resources");
assert.match(universeView, /guard window != nil else \{ return \}/, "foreground lifecycle cannot restart a detached native view");

// The first screen must show the material, not a black rectangle. Each of the
// three links below has been the whole failure on its own: a kernel with no
// state to draw, a layer nothing can draw into, and a renderer that counts
// frames instead of painting them.
const waveField = readText("packages/objet-universe-kit/Sources/ObjetUniverseCore/Wave/WaveField.swift");
const waveKernel = readText("packages/objet-universe-kit/Sources/ObjetUniverseCore/Wave/WaveKernel.swift");
const waveRenderer = readText("packages/objet-universe-kit/Sources/ObjetUniverseRender/Wave/WaveMaterialRenderer.swift");
const waveShaders = readText("packages/objet-universe-kit/Sources/ObjetUniverseRender/Wave/WaveShaders.swift");
const cellKernel = readText("packages/objet-universe-kit/Sources/ObjetUniverseCore/Cell/CellKernel.swift");
const solarKernel = readText("packages/objet-universe-kit/Sources/ObjetUniverseCore/Solar/SolarKernel.swift");
const solarPhysics = readText("packages/objet-universe-kit/Sources/ObjetUniverseCore/Solar/SolarPhysics.swift");
const solarSnapshot = readText("packages/objet-universe-kit/Sources/ObjetUniverseCore/Solar/SolarRenderSnapshot.swift");
const solarRenderer = readText("packages/objet-universe-kit/Sources/ObjetUniverseRender/Solar/SolarRenderer.swift");
const solarShaders = readText("packages/objet-universe-kit/Sources/ObjetUniverseRender/Solar/SolarShaders.swift");
const sceneRendererFactory = readText("packages/objet-universe-kit/Sources/ObjetUniverseRender/SceneRendererFactory.swift");
const atomKernel = readText("packages/objet-universe-kit/Sources/ObjetUniverseCore/Atoms/AtomKernel.swift");
const moleculeKernel = readText("packages/objet-universe-kit/Sources/ObjetUniverseCore/Molecules/MoleculeKernel.swift");
assert.match(universeView, /WaveKernel\(/, "the wave scene must run its own kernel; a probe kernel has no material to show");
assert.match(universeView, /CAMetalLayer/, "the persistent native view must own a Metal layer for the material to draw into");
assert.match(universeView, /renderHost\.submitField/, "each frame's authoritative field must reach the renderer");
assert.doesNotMatch(
  universeView,
  /renderHost\.install\(RendererProbe/,
  "a RendererProbe draws nothing: installing one behind the persistent view is the blank first screen",
);
assert.match(waveKernel, /SimulationKernel/, "the wave medium must reach the host through the shared kernel protocol");
assert.match(waveKernel, /Representation/, "the wave kernel must expose a bounded representation lens");
assert.match(waveKernel, /case \.lens/, "twist-lens commands must change the wave representation");
assert.doesNotMatch(universeView, /NativeProbeKernel/, "every first-release destination must own a drawable kernel");
assert.match(universeView, /CellKernel\(/, "the cell scene must hand off to a real reaction-diffusion kernel");
assert.match(universeView, /SolarKernel\(/, "the solar scene must hand off to a real orbital kernel");
assert.match(universeView, /AtomKernel\(/, "the atoms scene must hand off to a real atomic kernel");
assert.match(universeView, /MoleculeKernel\(/, "the molecules scene must hand off to a real molecular kernel");
assert.match(universeView, /materialKind: kernel\.materialKind/, "the active material family must reach the shared renderer");
assert.match(universeView, /renderHost\.submitSolar/, "solar snapshots must reach their entity renderer without crossing React Native");
assert.match(cellKernel, /SurfaceSimulationKernel/, "the cell lane must provide a shared scalar surface");
assert.match(cellKernel, /reaction.diffusion|Gray.Scott/i, "the cell lane must be governed by a reaction-diffusion law");
assert.match(solarKernel, /SurfaceSimulationKernel/, "the solar lane must provide a shared scalar surface");
assert.match(solarKernel, /symplectic|integrat/i, "the solar lane must advance bodies with a bounded integrator");
assert.match(solarPhysics, /maxBodies = 14/, "the solar lane must bound its live body population");
assert.match(solarSnapshot, /UnsafeBufferPointer<SolarRenderBody>/, "the solar renderer boundary must borrow bounded body state");
assert.match(solarSnapshot, /SolarAccretionPreview/, "open-sky growth must have a non-authoritative visual preview");
assert.match(sceneRendererFactory, /case \.solar:[\s\S]*SolarRenderer/, "the scene factory must replace the field renderer for solar");
assert.match(solarRenderer, /framesInFlight = 3/, "the solar renderer must preallocate a triple-buffered frame ring");
assert.match(solarRenderer, /submitSolar\(_ snapshot: SolarRenderSnapshot\)/, "the solar renderer must consume typed kernel snapshots");
assert.match(solarRenderer, /snapshot\.accretionPreview/, "the solar renderer must draw the growing-world preview");
assert.match(solarRenderer, /orientSolarCamera/, "open-sky drag must reach a renderer-owned camera instead of moving a body");
assert.match(solarRenderer, /SolarCameraState/, "solar camera inertia must stay bounded presentation state");
assert.match(universeView, /renderHost\.orientSolarCamera/, "camera intent must stay inside the native host without a per-frame React bridge");
assert.match(solarShaders, /objet_solar_background_fragment/, "the solar material must own a dedicated Metal background pass");
assert.match(solarShaders, /objet_solar_body_fragment/, "solar bodies must be instanced material, not scalar-field colours");
assert.match(solarKernel, /command\.payload\.vessel\?\.gammaDegrees/, "solar gravity must read signed typed vessel tilt");
assert.match(solarKernel, /centralMass = 1 \+ normalizedGamma \* 0\.5/, "the solar lane must map tilt absolutely into the bounded 0.5...1.5 mass range");
assert.match(atomKernel, /maximumAtoms = 8/, "the atomic lane must bound atom growth");
assert.match(atomKernel, /fusionEnergy/, "the atomic lane must retain a fusion ledger");
assert.match(moleculeKernel, /maximumMolecules = 18/, "the molecular lane must bound molecule growth");
assert.match(moleculeKernel, /reactionFor/, "the molecular lane must expose a deterministic reaction table");
assert.match(waveRenderer, /MTLRenderPipelineState/, "the wave material must reach the screen through a Metal pipeline");
assert.match(waveRenderer, /representation/, "the renderer must receive the selected wave representation");
assert.match(waveRenderer, /materialKind == 0/, "the Wave renderer must accept water fields only");
assert.match(waveShaders, /objet_wave_fragment/, "the material is a shader, not a canvas-2D fallback");
assert.match(waveShaders, /float spectrumValue\(int bin, constant Uniforms &uniforms\)/, "the spectrum projection must read pre-reduced spectrum bins");
assert.match(waveShaders, /float magnitude = spectrumValue\(bin, uniforms\)/, "each spectrum bar must consume its pre-reduced bin");
assert.doesNotMatch(waveShaders, /\bspectrumSampler\b/, "the spectrum projection must not restore a per-fragment spectrum texture sampler");
assert.doesNotMatch(waveShaders, /\bmaterialKind\b/, "the dedicated-water shader must not branch on a scene material kind");
assert.doesNotMatch(
  sceneRendererFactory,
  /case \.wave(?:,\s*\.atoms|,\s*\.molecules)+:\s*WaveMaterialRenderer/,
  "the water renderer must not share a factory branch with chemistry scenes",
);
assert.doesNotMatch(
  waveField,
  /arc4random|SystemRandomNumberGenerator|\.random\(/,
  "the wave medium must derive every value from its seed",
);
assert.doesNotMatch(
  waveField,
  /Date\(\)|CACurrentMediaTime|systemUptime/,
  "authoritative wave time comes from steps, never from a wall clock",
);

const nativeLayout = readText("apps/native/app/_layout.tsx");
const cellRoute = readText("apps/native/app/cell.tsx");
const solarRoute = readText("apps/native/app/solar.tsx");
const moleculesRoute = readText("apps/native/app/molecules.tsx");
const atomsRoute = readText("apps/native/app/atoms.tsx");
const proofRoute = readText("apps/native/src/scenes/ProofSceneRoute.tsx");
const progression = readText("apps/native/src/progression/UniverseProgress.ts");
const progressionLogic = readText("apps/native/src/progression/UniverseProgressLogic.ts");
const readingSheets = readText("apps/native/src/surfaces/ReadingSheets.tsx");
assert.match(nativeLayout, /<ObjetUniverseView/, "the native universe host must mount behind route overlays");
assert.match(nativeLayout, /useSegments/, "the persistent host must follow the active native scene route");
assert.match(cellRoute, /ProofSceneRoute/, "cell must be a real route over the persistent native host");
assert.match(solarRoute, /ProofSceneRoute/, "solar must be a real route over the persistent native host");
assert.match(moleculesRoute, /ProofSceneRoute/, "molecules must be a real route over the persistent native host");
assert.match(atomsRoute, /ProofSceneRoute/, "atoms must be a real route over the persistent native host");
assert.match(proofRoute, /ObjetUniverseSurface/, "every proof scene must expose the same native touch surface");
assert.match(proofRoute, /appendSessionTrail/, "every proof scene must keep the trail affordance honest");
assert.match(proofRoute, /loadUniverseProgress/, "every proof scene must restore keeper progression before accepting input");
assert.match(proofRoute, /unlockedLenses/, "every proof scene must gate new agency on caused phenomena");
assert.match(progressionLogic, /UNIVERSE_PROGRESS_VERSION = 2/, "keeper progression must be versioned");
assert.match(progression, /writeQueue/, "keeper progression writes must serialize rapid commands");
assert.match(progressionLogic, /unlockedLenses/, "keeper progression must expose deterministic lens unlocks");
assert.match(readingSheets, /system/, "the solar fold must name the live system register");
assert.match(readingSheets, /trajectories/, "the solar fold must name the trajectory register");
assert.match(readingSheets, /harmonics/, "the solar fold must name the harmonic register");
assert.match(readingSheets, /felt/, "the solar fold must name the multisensory register");
assert.doesNotMatch(readingSheets, /label: "(?:galaxy|star|planet|Earth)"/, "the solar fold must not claim four simulations it does not contain");
assert.match(readingSheets, /genome/, "the fold must name the genome register");
assert.match(readingSheets, /protein/, "the fold must name the protein register");
assert.match(readingSheets, /molecules/, "the fold must name the molecular register");
assert.match(readingSheets, /atoms/, "the fold must name the atomic register");
assert.ok(
  nativeLayout.indexOf("<ObjetUniverseView") < nativeLayout.indexOf("<Stack"),
  "route overlays must mount above the persistent native universe host",
);
assert.match(
  nativeLayout,
  /contentStyle:\s*\{\s*backgroundColor:\s*["']transparent["']/,
  "each route's content must be transparent or it paints over the persistent universe host",
);
assert.match(
  nativeLayout,
  /background:\s*["']transparent["']/,
  "the navigation theme paints the stack container too; leaving it opaque hides the material behind a flat rectangle",
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
assert.match(nativeCi, /actions\/checkout@v7/, "native CI checkout must use the Node 24 action runtime");
assert.match(nativeCi, /actions\/setup-node@v7/, "native CI setup-node must use the Node 24 action runtime");
assert.doesNotMatch(nativeCi, /cache:\s*npm/, "native release gates must not depend on GitHub's optional cache service");
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
assert.match(nativeCi, /ios-eas-production\.yml/, "native CI must run when the TestFlight workflow changes");
assert.match(nativeCi, /\.easignore/, "native CI must run when the EAS archive rules change");

const easWorkflow = readText(".github/workflows/ios-eas-production.yml");
assert.match(easWorkflow, /working-directory: apps\/native/, "TestFlight CI must run eas from the Expo app, not the web root");
assert.match(easWorkflow, /--auto-submit/, "TestFlight CI must hand the IPA to App Store Connect");
assert.match(easWorkflow, /actions\/checkout@v7/, "TestFlight checkout must use the Node 24 action runtime");
assert.match(easWorkflow, /actions\/setup-node@v7/, "TestFlight setup-node must use the Node 24 action runtime");
assert.match(easWorkflow, /expo\/expo-github-action@v9/, "TestFlight EAS setup must use Expo's Node 24 action runtime");
assert.match(easWorkflow, /eas-version: 22\.4\.0/, "TestFlight CI must pin the verified eas-cli release");
assert.match(easWorkflow, /eas-cache:\s*false/, "TestFlight delivery must not depend on the optional EAS CLI cache");
assert.doesNotMatch(easWorkflow, /cache:\s*npm/, "TestFlight delivery must not depend on the optional npm cache");
assert.doesNotMatch(easWorkflow, /^\s*EAS_NO_VCS=1/m, "EAS must keep the git root so packages/objet-universe-kit is on the worker");
assert.match(easWorkflow, /secrets\.EXPO_TOKEN/, "TestFlight CI needs the Expo token the same way Mapvest does");

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
const sessionTrail = readText("apps/native/src/persistence/SessionTrail.ts");
assert.match(proofRoute, /onOpenFold=/, "proof scenes must wire the fold affordance to a real surface");
assert.match(proofRoute, /onOpenTrail=/, "proof scenes must wire the trail affordance to a real surface");
assert.match(proofRoute, /<FoldSheet/, "proof scenes must render the fold surface when requested");
assert.match(proofRoute, /<TrailSheet/, "proof scenes must render the trail surface when requested");
assert.match(proofRoute, /representation=\{representation\}/, "proof scenes must pass the selected lens to the native surface");
assert.match(proofRoute, /loadSessionTrail/, "proof scenes must recover the local trail without blocking the material");
assert.match(proofRoute, /enabled=\{!reading\s*&&\s*!foldOpen\s*&&\s*!trailOpen\}/, "proof scenes must keep the material touchable while persistence hydrates");
assert.match(sessionTrail, /SESSION_TRAIL_VERSION = 1/, "session trail storage must be versioned");
assert.match(sessionTrail, /SESSION_TRAIL_LIMIT = 120/, "session trail storage must remain bounded");
assert.match(sessionTrail, /writeQueue/, "session trail writes must serialize rapid gesture appends");

assert.match(designTokens, /export const PALETTE/, "native design tokens must declare a shared palette");
assert.match(designTokens, /REDUCED_MOTION_EQUIVALENTS/, "native design tokens must declare reduced-motion equivalents that preserve state");
assert.match(designSceneStyle, /NATIVE_SCENE_MANIFEST/, "sceneStyle.ts must consume NATIVE_SCENE_MANIFEST rather than restate scene briefs");
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

assert.match(proofRoute, /<NativeChrome/, "proof scenes must mount NativeChrome above the persistent universe host");
assert.match(proofRoute, /backgroundColor:\s*["']transparent["']/, "proof scenes must remain transparent so the persistent universe host renders through");

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
execFileSync("node", ["--experimental-strip-types", "--test", "apps/native/src/progression/__tests__/UniverseProgress.test.ts"], { cwd: root, stdio: "inherit" });

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

// U5 — gesture grammar, vessel bus, and accessibility action assertions.
const gestureActions = readText("apps/native/src/universe/actions.ts");
const gestureLabels = readText("apps/native/src/accessibility/actionLabels.ts");
const gestureRotor = readText("apps/native/src/accessibility/UniverseActions.tsx");
const gestureRouter = readText("apps/native/modules/objet-universe/ios/GestureRouter.swift");
const vesselSensors = readText("apps/native/modules/objet-universe/ios/VesselSensors.swift");
const gestureTest = readText("apps/native/src/accessibility/__tests__/UniverseActions.test.tsx");

for (const [line, name] of [
  ["dwellMs: 900", "dwellMs"],
  ["ceremonyMs: 2500", "ceremonyMs"],
  ["tapMaxMs: 250", "tapMaxMs"],
  ["tapTrainMs: 280", "tapTrainMs"],
  ["moveTolPx: 12", "moveTolPx"],
  ["flickVel: 0.6", "flickVel"],
  ["scrubWinding: 0.75", "scrubWinding"],
  ["pinchDeadzone: 0.03", "pinchDeadzone"],
  ["twistDeadzoneRad: 0.1", "twistDeadzoneRad"],
  ["shakeThresh: 16", "shakeThresh"],
  ["knockThresh: 22", "knockThresh"],
  ["voiceStaggerMs: 80", "voiceStaggerMs"],
  ["voiceDecideMs: 180", "voiceDecideMs"],
  ["spanEnterMs: 350", "spanEnterMs"],
  ["spanTolPx: 16", "spanTolPx"],
]) {
  assert.ok(
    gestureActions.includes(line),
    `native actions.ts must declare ${name} verbatim as \`${line}\``,
  );
}
for (const line of [
  "public static let dwellMs: Double = 900",
  "public static let ceremonyMs: Double = 2500",
  "public static let tapMaxMs: Double = 250",
  "public static let tapTrainMs: Double = 280",
  "public static let moveTolPx: Double = 12",
  "public static let flickVel: Double = 0.6",
  "public static let scrubWinding: Double = 0.75",
  "public static let pinchDeadzone: Double = 0.03",
  "public static let twistDeadzoneRad: Double = 0.1",
  "public static let shakeThresh: Double = 16",
  "public static let knockThresh: Double = 22",
  "public static let voiceStaggerMs: Double = 80",
  "public static let voiceDecideMs: Double = 180",
  "public static let spanEnterMs: Double = 350",
  "public static let spanTolPx: Double = 16",
]) {
  assert.ok(gestureRouter.includes(line), `Swift GestureRouter must declare threshold ${line}`);
}
assert.match(gestureRouter, /public final class GestureRouter/, "GestureRouter must remain the free-standing service");
assert.match(gestureRouter, /public static func resolve\(shape: NativeGestureShape\)/, "GestureRouter must expose a pure verb resolver");
assert.match(gestureRouter, /public static func intensity\(from shape: NativeGestureShape\)/, "GestureRouter must expose a pure intensity classifier");
assert.match(gestureRouter, /public func pumpDiscovery/, "GestureRouter must own the discovery clock");
assert.match(vesselSensors, /public final class VesselSensors/, "VesselSensors must remain the free-standing service");
assert.match(vesselSensors, /askedThisSession/, "VesselSensors must honour the ask-at-most-once invariant");
assert.match(vesselSensors, /flipEnterDeg/, "VesselSensors must hysteresis-guard face-down");
assert.match(vesselSensors, /public func suspend/, "VesselSensors must suspend on backgrounding");
assert.match(vesselSensors, /public func resume/, "VesselSensors must resume on foreground without prompting");
assert.match(vesselSensors, /onShake: \(@Sendable/, "Listener callbacks must be Sendable so Swift 6 EAS Xcode can compile the vessel");
assert.match(gestureLabels, /UNIVERSE_ACTION_LABELS/, "actionLabels.ts must expose the VoiceOver rotor registry");
assert.match(gestureLabels, /buildAssistiveCommands/, "actionLabels.ts must expose the pure assembler shared with the React shell");
assert.match(gestureRotor, /accessibilityActions/, "UniverseActions.tsx must attach accessibilityActions to its View");
assert.match(gestureRotor, /commandFromShape/, "UniverseActions.tsx must reuse the same command assembler as touch");
assert.match(
  gestureTest,
  /cross-language threshold pin — Swift GestureRouter constants match TypeScript verbatim/,
  "accessibility test must pin Swift thresholds against TypeScript",
);

// Execute the U5 accessibility test suite. It runs under
// `node --experimental-strip-types`; the wrapper handles the .tsx extension
// (Node 22 still refuses to interpret .tsx directly).
execFileSync(process.execPath, ["scripts/native/run-accessibility-test.mjs"], {
  cwd: root,
  stdio: "inherit",
});

// U5 — the half that makes contact: recognisers, the seam to the kernel, and
// the surface a route mounts.
//
// The router could always say what a shape means; nothing was making shapes.
// A recogniser attached to nothing is the bug these guards exist to catch a
// second time.
const surfaceInput = readText("apps/native/modules/objet-universe/ios/SurfaceInput.swift");
const surfaceView = readText("apps/native/modules/objet-universe/ios/ObjetUniverseSurfaceView.swift");


for (const recogniser of [
  "UITapGestureRecognizer",
  "UILongPressGestureRecognizer",
  "UIPanGestureRecognizer",
  "UIRotationGestureRecognizer",
  "UIPinchGestureRecognizer",
]) {
  assert.match(
    surfaceInput,
    new RegExp(recogniser),
    `SurfaceInput must install a ${recogniser} — an unrecognised gesture is a dead surface`,
  );
}
assert.match(surfaceInput, /view\.addGestureRecognizer\(recogniser\)/, "SurfaceInput must attach its recognisers to a real view");
assert.match(surfaceInput, /router\.route\(shape:/, "every recognised shape must reach the router, never the kernel directly");
assert.match(surfaceInput, /router\.advanceTapTrain\(\)/, "a tap must climb the train's rung rather than always landing as a first tap");
assert.match(surfaceInput, /phase: \.tick/, "a press must keep deepening while it is held");
assert.match(surfaceInput, /phase: \.release/, "the ceremony is committed when the hand lets go");

// A room defines no timing constant of its own: every threshold comes from
// gesture/core.ts, through NativeGestureThresholds. A bare copy of one of
// those numbers in the input layer is a private dialect.
for (const value of ["900", "2500", "250", "280", "12", "0.6", "0.75", "0.03", "0.1", "16", "22", "80", "180", "350"]) {
  const literal = new RegExp(`(?<![\\d._])${value.replace(".", "\\.")}(?![\\d_])`);
  assert.doesNotMatch(
    surfaceInput,
    literal,
    `SurfaceInput restates the threshold ${value} — read it from NativeGestureThresholds instead`,
  );
}

assert.match(surfaceView, /UniverseRuntime\.shared\.commit/, "the surface must reach the kernel only through the one seam");
assert.match(surfaceView, /MaterialProjection\.materialPoint/, "contact must be projected onto the material the shader draws, or the ring lands where the finger is not");
assert.match(surfaceView, /MaterialProjection\.materialVector/, "drag vectors must cross the same aspect-fill projection as contact points");
assert.match(surfaceView, /SemanticDragPayload/, "drag enter, tick, and release must reach the durable semantic payload");
assert.match(surfaceView, /SemanticContactPayload/, "hold preview, release, and Pencil axes must reach the durable semantic payload");
assert.match(surfaceView, /isAccessibilityElement = false/, "the surface must not silence the universe's VoiceOver identity");
assert.match(universeView, /UniverseRuntime\.shared\.attach\(self\)/, "the mounted universe must register itself as the one live host");

assert.match(universeRuntime, /expresses\(verb\)/, "a command must be committed only when the medium says the verb");
assert.match(universeRuntime, /HapticBus\.shared\.schedule/, "state must land in a second sense in the same frame");
assert.match(universeRuntime, /AudioBus\.shared\.schedule/, "state must land in a second sense in the same frame");
assert.match(universeRuntime, /publishAuthoritativeOutcomes/, "typed kernel outcomes must reach native sensory buses");
assert.match(universeView, /drainSimulationOutcomes/, "frame-authored collisions and fates must be drained from the kernel");
assert.doesNotMatch(universeRuntime, /collisionPulse/, "runtime must never infer collision meaning from render state");
assert.match(universeRuntime, /vessel\.subscribe/, "tilt, shake, knock and flip must reach the same grammar as touch");
assert.match(universeRuntime, /SemanticVesselPayload\(betaDegrees: beta, gammaDegrees: gamma\)/, "signed calibrated tilt axes must cross the native semantic boundary");
assert.match(surfaceView, /guard routed\.isCommitBoundary else \{ return \}/, "continuous native previews must emit one React persistence receipt at release");
assert.match(surfaceInput, /emitDrag\(phase: \.cancel/, "UIKit cancellation must remain distinct from an intentional release");
assert.match(universeRuntime, /vessel\.request/, "the vessel is invited from inside a real gesture, never demanded on launch");
assert.match(universeRuntime, /vesselRouter\.route\(shape:/, "the vessel must speak through the router like every other source");
assert.match(universeSurfaceBridge, /maxRepresentation/, "the touch surface must receive the keeper lens ceiling");
assert.match(universeRuntime, /canApplyRepresentation/, "native gesture commits must enforce the keeper lens ceiling");

assert.ok(
  universeModuleDefinition.indexOf("View(ObjetUniverseView.self)") <
    universeModuleDefinition.indexOf("View(ObjetUniverseSurfaceView.self)"),
  "the universe stays the module's default view — the surface is the second one",
);
assert.match(universeModuleDefinition, /ViewName\("ObjetUniverseSurface"\)/, "the surface needs the name React asks for");
assert.match(universeModuleDefinition, /Events\("onSemanticCommand"\)/, "committed gestures must be able to reach the route");
assert.match(universeSurfaceBridge, /assistiveCommandId/, "the surface bridge must expose the assistive command commit edge");
assert.match(universeSurfaceView, /setAssistiveCommandId/, "the native surface must accept assistive commands");
assert.match(universeRuntime, /commitAssistive/, "assistive commands must enter the shared native runtime");

// The world route mounts the surface below the chrome and keeps the reveal
// state the guide gates on. A route that mounts chrome alone is the screen
// that could not be touched.
assert.match(proofRoute, /<ObjetUniverseSurface/, "proof scenes must mount the touch surface over the persistent universe");
assert.ok(
  proofRoute.indexOf("<ObjetUniverseSurface") < proofRoute.indexOf("<NativeChrome"),
  "the chrome sits above the surface so the `?` keeps its own taps",
);
assert.match(proofRoute, /revealAfter/, "proof scenes must keep what the visitor has caused, not a frozen placeholder");
assert.match(proofRoute, /onGuideVisibilityChange/, "intervention pauses while a reading surface is open");
assert.match(proofRoute, /enabled=\{!reading\s*&&\s*!foldOpen\s*&&\s*!trailOpen\}/, "the surface stays live while recovery hydrates and closes while any reading surface has focus");
assert.match(proofRoute, /<UniverseActions/, "proof scenes must mount the VoiceOver action surface");
assert.match(proofRoute, /onAssistiveCommand/, "assistive commands must be forwarded to the native surface");

// No affordance that leads nowhere: a chip answering a press with nothing is
// friction wearing the costume of a feature.
assert.doesNotMatch(nativeChrome, /disabled=\{!onPress\}/, "NativeChrome must not draw an affordance it cannot answer");
assert.match(nativeChrome, /onOpenFold \? \(/, "fold appears only once a lane hands the chrome a handler");
assert.match(nativeChrome, /onOpenTrail \? \(/, "trail appears only once a lane hands the chrome a handler");

// Cross-language pins for the two numbers the input layer added.
assert.match(gestureRouter, /public static let tapTrainCap = 9/, "the Swift train cap must be declared");
assert.match(readText("src/lib/gesture/core.ts"), /tapTrainCap: 9/, "the web train cap must stay the same number");
assert.match(gestureRouter, /public static let continuousSampleHz: Double = 20/, "the Swift sample cadence must be declared");
assert.match(
  readText("packages/universe-contracts/src/actions.ts"),
  /export const CONTINUOUS_SAMPLE_HZ = 20 as const;/,
  "the wire contract's sample cadence must stay the same number",
);

// The hold's phase is what keeps duration an axis, and it has to mean the
// same thing in both languages.
assert.match(gestureRouter, /case hold\([\s\S]*?phase: GesturePhase,[\s\S]*?target: NativeContactTarget[\s\S]*?\)/, "the Swift hold shape must carry phase, Pencil axes, and stable target identity");
assert.match(gestureActions, /kind: "hold";[^}]*phase: GesturePhase/, "the TypeScript hold shape must carry its phase");
assert.match(gestureRouter, /if phase == \.release, elapsedMs >= NativeGestureThresholds\.ceremonyMs/, "Swift must commit the ceremony on intentional release, never on tick or cancel");
assert.match(gestureActions, /shape\.phase === "release" && shape\.elapsedMs >= NATIVE_GESTURE_THRESHOLDS\.ceremonyMs/, "TypeScript must commit the ceremony on intentional release, never on tick or cancel");

// Grammar verb → durable meaning: one table in TypeScript, one switch in
// Swift, and they must agree verb for verb.
const swiftSemanticVerbs = extractSwiftSemanticVerbMap(gestureRouter);
const typescriptSemanticVerbs = extractNativeGlobalVerbMap(gestureActions);
assert.ok(typescriptSemanticVerbs.size > 0, "NATIVE_GLOBAL_VERBS must remain extractable");
assert.equal(
  swiftSemanticVerbs.size,
  typescriptSemanticVerbs.size,
  "the Swift verb map and NATIVE_GLOBAL_VERBS must cover the same verbs",
);
for (const [grammarVerb, semanticVerb] of typescriptSemanticVerbs) {
  assert.equal(
    swiftSemanticVerbs.get(grammarVerb),
    semanticVerb,
    `Swift maps "${grammarVerb}" to a different meaning than NATIVE_GLOBAL_VERBS does`,
  );
}

execFileSync("node", ["--experimental-strip-types", "apps/native/src/guide/__tests__/reveal.test.ts"], {
  cwd: root,
  stdio: "inherit",
});

/** Read `GestureRouter.semanticVerb(for:)` as a grammar verb → meaning map. */
function extractSwiftSemanticVerbMap(source) {
  const start = source.indexOf("public static func semanticVerb(for verb: NativeGrammarVerb)");
  if (start === -1) return new Map();
  const body = source.slice(start, source.indexOf("\n  }", start));
  const map = new Map();
  const regex = /case ((?:\.[A-Za-z0-9]+(?:,\s*)?)+):\s*(?:return\s+)?\.([A-Za-z0-9]+)/g;
  let match;
  while ((match = regex.exec(body)) !== null) {
    const meaning = kebabFromSwiftCase(match[2]);
    for (const verb of match[1].split(",")) {
      map.set(verb.trim().slice(1), meaning);
    }
  }
  return map;
}

/** Swift spells the two hyphenated meanings in camel case. */
function kebabFromSwiftCase(name) {
  if (name === "stepBack") return "step-back";
  if (name === "timeDilation") return "time-dilation";
  return name;
}

/** Read NATIVE_GLOBAL_VERBS as the same map, from the other language. */
function extractNativeGlobalVerbMap(source) {
  const start = source.indexOf("export const NATIVE_GLOBAL_VERBS");
  if (start === -1) return new Map();
  const body = source.slice(start, source.indexOf("] as const)", start));
  const map = new Map();
  const regex = /grammarVerb:\s*"([^"]+)",\s*semanticVerb:\s*"([^"]+)"/g;
  let match;
  while ((match = regex.exec(body)) !== null) map.set(match[1], match[2]);
  return map;
}

// U6 — Shared audio, haptic, and sensory clock. The native sensory bus lives
// in its own SPM target so scenes cannot import it accidentally through
// ObjetUniverseCore, and its React surface is limited to muting preferences.
const sensoryPackage = readText("packages/objet-universe-kit/Package.swift");
assert.match(sensoryPackage, /ObjetUniverseSensory/, "the kit must publish the sensory library as a separate SPM target");
assert.match(sensoryPackage, /ObjetUniverseSensoryTests/, "the kit must run the sensory test target");

const sensoryEvent = readText("packages/objet-universe-kit/Sources/ObjetUniverseSensory/SensoryEvent.swift");
assert.match(sensoryEvent, /SensoryClock/, "the sensory event must carry the shared native event clock");
assert.match(sensoryEvent, /logicalTick/, "the sensory event must accept a logicalTick from the host");
assert.match(sensoryEvent, /wallOffset/, "the sensory event must accept a wallOffset from the host");
assert.match(sensoryEvent, /SensoryDerivation/, "state, audio, and haptic must derive from one normalized energy");
assert.match(sensoryEvent, /SensorySkewBudget/, "the sensory event must declare a skew budget the host can measure against");
assert.match(sensoryEvent, /SensoryFallbackPolicy/, "the sensory bus must document its restrained fallback policy");

const audioBus = readText("packages/objet-universe-kit/Sources/ObjetUniverseSensory/AudioBus.swift");
assert.match(audioBus, /public static let shared/, "the audio bus must remain a singleton — one AVAudioSession per app");
assert.match(audioBus, /interruption/i, "the audio bus must handle interruption + route change recovery");
assert.match(audioBus, /public func prewarm\(\)/, "the audio graph and tone buffers must prewarm before first interaction");
assert.match(audioBus, /performOnset\(event\)/, "delayed audio must revalidate mute and interruption state at actual onset");
assert.match(audioBus, /appliedEventIDs/, "the audio bus must keep an authoritative ledger so recovery cannot duplicate events");
assert.match(audioBus, /Confirmation/, "the audio bus must expose a clean async completion handle for UniverseHost.promote");
assert.match(audioBus, /AVAudioPlayerNode/, "the audio bus must play low-latency native one-shot tones");
assert.match(audioBus, /setPreferredIOBufferDuration/, "the audio bus must request an interactive output buffer");

const hapticBus = readText("packages/objet-universe-kit/Sources/ObjetUniverseSensory/HapticBus.swift");
assert.match(hapticBus, /public static let shared/, "the haptic bus must remain a singleton — one CHHapticEngine per app");
assert.match(hapticBus, /SensoryFallbackPolicy/, "the haptic bus must respect the restrained fallback policy");
assert.match(hapticBus, /appliedEventIDs/, "the haptic bus must keep an authoritative ledger so engine reset cannot duplicate events");
assert.match(hapticBus, /resetHandler/, "the haptic bus must recover from engine reset");

const sensoryTests = readText("packages/objet-universe-kit/Tests/ObjetUniverseSensoryTests/SensoryClockTests.swift");
assert.match(sensoryTests, /testCollisionEnergyDerivesEverySenseFromOneNumber/, "sensory tests must prove derivation identity from one normalized energy");
assert.match(sensoryTests, /testAudioInterruptionRecoveryDoesNotDuplicatePastEvents/, "sensory tests must prove interruption recovery is idempotent");
assert.match(sensoryTests, /testMutingAudioDoesNotSilenceHapticsOrVisualFeedback/, "sensory tests must prove muting isolation across senses");
assert.match(sensoryTests, /testUnsupportedHapticFallbackNeverFiresAGenericBuzzOnPlainSuccess/, "sensory tests must prove the restrained fallback discipline");
assert.match(sensoryTests, /testScheduledOnsetsStayWithinDeclaredSkewBudget/, "sensory tests must prove skew stays within the declared budget");

const sensoryModule = readText("apps/native/modules/objet-universe/ios/SensoryModule.swift");
assert.match(sensoryModule, /Name\("ObjetSensory"\)/, "the native sensory module must register as ObjetSensory");
assert.match(sensoryModule, /AudioBus\.shared/, "the native sensory module must consult the singleton audio bus");
assert.match(sensoryModule, /HapticBus\.shared/, "the native sensory module must consult the singleton haptic bus");
assert.doesNotMatch(sensoryModule, /class\s+ObjetUniverseModule/, "the sensory helper must not redefine the universe module");

const expoModuleConfig = JSON.parse(readText("apps/native/modules/objet-universe/expo-module.config.json"));
assert.ok(expoModuleConfig.apple?.modules?.includes("ObjetUniverseModule"), "the Expo module config must keep registering the universe module");
assert.ok(expoModuleConfig.apple?.modules?.includes("SensoryModule"), "the Expo module config must register the new sensory helper module");

const sensoryPreferences = readText("apps/native/src/sensory/preferences.ts");
assert.match(sensoryPreferences, /DEFAULT_SENSORY_PREFERENCES/, "preferences must publish a frozen default the bridge can seed from");
assert.match(sensoryPreferences, /enabledSenses/, "preferences must derive the enabled sense set for the bus");
assert.match(sensoryPreferences, /createSensoryPreferenceCoordinator/, "preferences must restore, apply, and persist through one serialized owner");
assert.match(sensoryPreferences, /Visual scientific feedback stays authoritative/, "preferences must document that visual feedback remains authoritative");
assert.doesNotMatch(sensoryPreferences, /visualMuted/, "preferences must never expose a visual mute — visual feedback is authoritative");

const sensoryPreferencesTest = readText("apps/native/src/sensory/__tests__/preferences.test.ts");
assert.match(sensoryPreferencesTest, /muting audio does not disable haptics/, "preferences tests must prove audio muting does not silence haptics");
assert.match(sensoryPreferencesTest, /muting haptics does not disable audio/, "preferences tests must prove haptic muting does not silence audio");

// Run the sensory preferences test with node --experimental-strip-types so
// the TypeScript source doubles as its own executable spec.
execFileSync(
  process.execPath,
  ["--experimental-strip-types", "--test", "apps/native/src/sensory/__tests__/preferences.test.ts"],
  { cwd: root, stdio: "inherit" },
);

console.log("native workspace contract: ok");
