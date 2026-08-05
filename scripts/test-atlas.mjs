import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import * as ts from "typescript";

const rootUrl = new URL("../", import.meta.url);

const tsModuleCache = new Map();

function loadTsModule(path, requireMap = {}, globals = {}) {
  const cacheable = Object.keys(requireMap).length === 0 && Object.keys(globals).length === 0;
  if (cacheable && tsModuleCache.has(path)) return tsModuleCache.get(path);
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
  const sandbox = {
    ...globals,
    module,
    exports: module.exports,
    JSON,
    Object,
    require: (id) => {
      if (id in requireMap) return requireMap[id];
      if (id.startsWith("@/")) {
        return loadTsModule(`src/${id.slice(2)}.ts`, requireMap, globals);
      }
      throw new Error(`Unexpected require(${id}) while loading ${path}`);
    },
  };
  vm.runInNewContext(code, sandbox, { filename });
  if (cacheable) tsModuleCache.set(path, module.exports);
  return module.exports;
}

const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nOQAAAAASUVORK5CYII=";
const FAKE_WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(20)]).toString("base64");
const SOURCE_PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("atlas-canonical-source"),
  Buffer.alloc(96, 0x2a),
]);
const SOURCE_PNG = SOURCE_PNG_BYTES.toString("base64");
const SHARP_CROP_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("sharp-mock-cropped-atlas-region"),
]);
const providerCalls = [];
let failKleinPreview = false;
let failOpenAIGeneration = false;
let failOpenAIEdit = false;

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertRequestError(callback, code, message) {
  let caught;
  try {
    callback();
  } catch (error) {
    caught = error;
  }
  assert.equal(caught?.code, code, message);
}

const atlasBatchModule = loadTsModule("src/lib/atlas-batch.ts");
const atlasNavigationModule = loadTsModule("src/lib/atlas-navigation.ts");
const atlasCropModule = loadTsModule("src/lib/atlas-crop.ts", {
  "@/lib/atlas-batch": atlasBatchModule,
});
const croppedSourceModule = loadTsModule("src/lib/atlas-source.ts", {
  "@/lib/atlas-crop": {
    cropAtlasDataUrl: async () => "data:image/png;base64,cropped",
  },
});
const uncroppedSourceModule = loadTsModule("src/lib/atlas-source.ts", {
  "@/lib/atlas-crop": {
    cropAtlasDataUrl: async () => {
      throw new Error("canvas unavailable");
    },
  },
});
const sharpExtractCalls = [];
function createSharpMock() {
  const sharp = (input) => {
    const api = {
      metadata: async () => {
        // Real 1x1 PNG used by most edit fixtures; larger synthetic sizes for crop math checks.
        if (Buffer.isBuffer(input) && input.length <= 80) return { width: 1, height: 1 };
        return { width: 100, height: 80 };
      },
      extract: (region) => {
        sharpExtractCalls.push({ region, byteLength: Buffer.isBuffer(input) ? input.length : 0 });
        return api;
      },
      png: () => api,
      toBuffer: async () => SHARP_CROP_BYTES,
    };
    return api;
  };
  return sharp;
}
const atlasModule = loadTsModule("src/lib/atlas-generation.ts", {
  "server-only": {},
  "@/lib/atlas-batch": atlasBatchModule,
  "@/lib/atlas-crop": atlasCropModule,
  sharp: createSharpMock(),
  "node:fs/promises": {
    readFile: async () => {
      throw new Error("provider file access is outside this unit test");
    },
  },
  "node:path": { extname, resolve, sep },
}, {
  AbortController,
  Blob,
  Buffer,
  DOMException,
  FormData,
  Response,
  clearTimeout,
  process,
  setTimeout,
  fetch: async (url, init) => {
    providerCalls.push({ url, init });
    if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
    if (url === "https://api.openai.com/v1/images/generations") {
      if (failOpenAIGeneration) {
        return new Response(JSON.stringify({ error: { code: "upstream_busy" } }), {
          status: 503,
          headers: { "content-type": "application/json", "x-request-id": "openai-generation-failure" },
        });
      }
      return new Response(JSON.stringify({
        data: [{ b64_json: FAKE_WEBP }],
        usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
      }), {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": "openai-test-request" },
      });
    }
    if (url === "https://api.openai.com/v1/images/edits") {
      if (failOpenAIEdit) {
        return new Response(JSON.stringify({ error: { code: "upstream_busy" } }), {
          status: 503,
          headers: { "content-type": "application/json", "x-request-id": "openai-edit-failure" },
        });
      }
      return new Response(JSON.stringify({
        data: [{ b64_json: FAKE_WEBP }],
        usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
      }), {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": "openai-edit-test-request" },
      });
    }
    const body = JSON.parse(init.body);
    if (failKleinPreview && body.model === "black-forest-labs/flux.2-klein-4b") {
      return new Response(JSON.stringify({ error: { code: "upstream_busy" } }), {
        status: 503,
        headers: { "content-type": "application/json", "retry-after": "1" },
      });
    }
    return new Response(JSON.stringify({
      data: [{ b64_json: ONE_PIXEL_PNG, media_type: "image/png" }],
      usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46, cost: 0.004 },
    }), {
      status: 200,
      headers: { "content-type": "application/json", "x-request-id": "openrouter-test-request" },
    });
  },
});
const routesModule = loadTsModule("src/lib/routes.ts");

function loadAtlasRoute(environment) {
  return loadTsModule("src/app/api/atlas/generate/route.ts", {
    "node:crypto": { randomUUID },
    "next/server": {
      NextResponse: {
        json: (body, init = {}) => ({ body, status: init.status ?? 200, headers: init.headers ?? {} }),
      },
    },
    "@/lib/atlas-generation": atlasModule,
  }, {
    URL,
    console: { error: () => undefined, log: () => undefined, warn: () => undefined },
    process: { env: environment },
  });
}

const {
  atlasOperationForRequest,
  clipRectForBatchDirection,
  createAtlasGenerationContext,
  formatAtlasPerspectiveClause,
  formatAtlasVisualStyleClause,
  generateAtlasImage,
  parseAtlasGenerationRequest,
  pixelBoundsForClip,
  resolveAtlasBatchPlan,
  resolveAtlasPhaseProviderConfig,
  resolveAtlasProviderConfig,
  resolveAtlasVisualStyle,
} = atlasModule;
const {
  atlasGenerationIsCurrent,
  resolveAtlasEdgeTravel,
  resolveAtlasGenerationInterruption,
} = atlasNavigationModule;
const { prepareAtlasSourceImage: prepareCroppedSource } = croppedSourceModule;
const { prepareAtlasSourceImage: prepareUncroppedSource } = uncroppedSourceModule;
assert.equal(
  typeof atlasBatchModule.resolveAtlasBatchPlan,
  "function",
  "atlas-batch should export shared plan resolution for client and server",
);
assert.equal(
  typeof atlasCropModule.pixelBoundsForClip,
  "function",
  "atlas-crop should export pure pixel bounds for client and server crop paths",
);
assert.equal(
  typeof atlasCropModule.cropAtlasDataUrl,
  "function",
  "atlas-crop should export the browser Canvas crop helper",
);
const { SITE_ROUTE_BY_KEY, isDarkRoutePath } = routesModule;

assert.equal(
  atlasGenerationIsCurrent(8, 8, "atlas-current", "atlas-current"),
  true,
  "the active Atlas generation should be allowed to commit",
);
assert.equal(
  atlasGenerationIsCurrent(8, 9, "atlas-current", null),
  false,
  "a camera interaction must make an older Atlas response stale",
);
assert.equal(
  atlasGenerationIsCurrent(8, 8, "atlas-old", "atlas-new"),
  false,
  "a replaced generation id must reject the old response even when request ids match",
);
assert.equal(
  atlasGenerationIsCurrent(8, 8, "atlas-old", null),
  false,
  "a completed or cancelled ticket must reject a delayed response",
);

assert.deepEqual(
  { ...resolveAtlasGenerationInterruption({
    requestId: 8,
    generationId: "atlas-current",
    activeImage: "stable-sheet",
    incomingImage: "unrevealed-sheet",
    incomingRevealed: false,
  }) },
  { requestId: 9, generationId: null, activeImage: "stable-sheet" },
  "interaction before reveal should invalidate the ticket and keep the stable sheet",
);
assert.deepEqual(
  { ...resolveAtlasGenerationInterruption({
    requestId: 8,
    generationId: "atlas-current",
    activeImage: "stable-sheet",
    incomingImage: "visible-preview",
    incomingRevealed: true,
  }) },
  { requestId: 9, generationId: null, activeImage: "visible-preview" },
  "interaction after reveal should preserve the preview already under the user's hand",
);

const parsed = plain(parseAtlasGenerationRequest({
  prompt: "  fire   forest  ",
  viewport: { width: 390, height: 844 },
  mode: "generate",
}));
assert.equal(parsed.prompt, "fire forest", "concept prompts should be normalized and accepted");
assert.deepEqual(parsed.viewport, { width: 390, height: 844 }, "valid mobile viewports should survive parsing");
assert.equal(parsed.mode, "generate", "generate should remain the canonical mode");

const spaceStyle = resolveAtlasVisualStyle("space nebula chart");
assert.equal(spaceStyle.id, "space", "space prompts should select the space atlas pack");
assert.match(spaceStyle.primary, /deep-space|nebula|constellation/i, "space style should dominate the visual language");
assert.match(spaceStyle.dna, /Do not render a medieval Catalan portolan/i, "craft DNA should forbid a default Catalan costume");
assert.match(
  formatAtlasVisualStyleClause(spaceStyle),
  /Do not render a medieval Catalan portolan/,
  "formatted style clauses should keep the anti-Catalan default attached",
);

const fireStyle = resolveAtlasVisualStyle("fire forest");
assert.equal(fireStyle.id, "fire", "the first matched theme token should win style selection");
assert.match(fireStyle.primary, /volcanic|ember|molten/i, "fire prompts should not stay locked to Catalan blue portolan paint");

const heavenStyle = resolveAtlasVisualStyle("Heaven");
assert.equal(heavenStyle.id, "heaven", "heaven prompts should select the paradise pack");
assert.match(heavenStyle.primary, /celestial|paradise|luminous/i, "heaven should look like heaven, not a portolan");

const coinStyle = resolveAtlasVisualStyle("a world of coins");
assert.equal(coinStyle.id, "coin", "coin prompts should select the coin-world pack");

const cityStyle = resolveAtlasVisualStyle("New York City");
assert.equal(cityStyle.id, "city", "named cities should select the civic pack");

const fallbackStyle = resolveAtlasVisualStyle("quiet marble quarries");
assert.equal(fallbackStyle.id, "concept", "unknown prompts should fall back to concept-shaped style");
assert.match(fallbackStyle.primary, /visual concept as its own world-map/i, "fallback style should put the subject first");
assert.match(fallbackStyle.dna, /Do not render a medieval Catalan portolan/i, "fallback style must not force Catalan DNA");

const defaultProviderConfig = resolveAtlasProviderConfig({ OPENAI_API_KEY: "openai-test-key" });
const defaultProvider = plain(defaultProviderConfig);
assert.equal(defaultProvider.provider, "openai", "GPT Image should be the default final Atlas provider");
assert.equal(defaultProvider.model, "gpt-image-2", "the default final adapter should pin GPT Image 2");

const generatedWithDefault = plain(await generateAtlasImage(
  parseAtlasGenerationRequest({ prompt: "space nebula", mode: "generate" }),
  defaultProviderConfig,
));
assert.equal(generatedWithDefault.generation.provider, "openai", "the default adapter should return OpenAI metadata");
assert.match(generatedWithDefault.dataUrl, /^data:image\/webp;base64,/, "GPT Image output should retain WebP media type");
const defaultCall = providerCalls.find((call) => call.url === "https://api.openai.com/v1/images/generations");
assert.ok(defaultCall, "default generation should call GPT Image 2");
const defaultBody = JSON.parse(defaultCall.init.body);
assert.equal(defaultBody.model, "gpt-image-2", "final generation should use GPT Image 2");
assert.equal(defaultBody.quality, "high", "final generation should request high rendering quality");
// Sheet geometry, asserted as geometry: the desktop sheet must carry the
// room's 4:3 map ratio and enough pixels to fill a 2x stage, because the
// pyramid holds every drawing within ~1.15x of its own fit and the only
// softness left to fix at the widest view is device-pixel deficit.
{
  const [w, h] = defaultBody.size.split("x").map(Number);
  assert.ok(Math.abs(w / h - 4 / 3) < 0.01, "desktop final generation should preserve the Atlas sheet aspect ratio");
  assert.ok(w >= 1600, "a desktop sheet must out-resolve a 2x stage or the widest view is soft before any zoom");
  assert.ok(w % 16 === 0 && h % 16 === 0, "sheet dimensions must stay 16px aligned for the providers");
}
assert.equal(defaultBody.output_format, "webp", "final generation should request a compact lossless-looking web format");
assert.equal(defaultBody.output_compression, 92, "final generation should avoid low-quality compression artifacts");
const defaultPrompt = defaultBody.prompt;
assert.match(defaultPrompt, /deep-space|nebula|constellation/i, "provider prompts should mutate toward the concept theme");
assert.match(defaultPrompt, /Do not restyle it as a default antique Catalan atlas/i, "provider prompts should forbid the Catalan default");
assert.match(defaultPrompt, /<visual_concept>space nebula<\/visual_concept>/, "concept text should stay inside the subject tag");
assert.doesNotMatch(
  defaultPrompt.split("<visual_concept>")[0] ?? "",
  /richly illuminated Catalan portolan chart translated into a dark contemporary instrument/,
  "the old always-Catalan primary clause should no longer dominate themed prompts",
);
assert.doesNotMatch(
  defaultPrompt,
  /faint Catalan portolan residue/i,
  "provider prompts should no longer inject Catalan residue into every subject",
);

// Landmark NAMES must never reach the image model. The hotspot labels are
// navigation text and the seeds for neighboring ground; they are drawn from
// a small fixed word pool, so dictating them as art direction ("embody
// copper delta as a distinct illustrated landmark") grew the same generic
// cartography on every unrelated subject — a map of a nebula told to render
// a copper river delta duly rendered one. Only the four POSITIONS are the
// atlas's to dictate; what stands at them belongs to the subject.
{
  const nebulaContext = plain(createAtlasGenerationContext("space nebula"));
  assert.equal(nebulaContext.hotspots.length, 4, "a concept should still anchor four reachable landmarks");
  assert.doesNotMatch(defaultPrompt, /\bembody\b/i, "the prompt must not dictate what a landmark is");
  for (const hotspot of nebulaContext.hotspots) {
    assert.ok(
      !defaultPrompt.includes(hotspot.label),
      `the invented label "${hotspot.label}" must never be handed to the image model as art direction`,
    );
  }
  // The spatial contract survives: every hotspot's position is still asked
  // for, so invisible touch targets keep landing on real visual features.
  for (const hotspot of nebulaContext.hotspots) {
    const x = Math.round(hotspot.x * 100);
    const y = Math.round(hotspot.y * 100);
    assert.ok(
      defaultPrompt.includes(`${x}% from the left and ${y}% from the top`),
      `the prompt must still anchor a landmark at ${x}%,${y}% for the hand to reach`,
    );
  }
}

await generateAtlasImage(
  parseAtlasGenerationRequest({ prompt: "Heaven", mode: "generate" }),
  resolveAtlasProviderConfig({ OPENAI_API_KEY: "openai-test-key" }),
);
const heavenCall = providerCalls.filter((call) => call.url === "https://api.openai.com/v1/images/generations").at(-1);
assert.ok(heavenCall, "heaven generation should call GPT Image");
assert.match(JSON.parse(heavenCall.init.body).prompt, /celestial|paradise/i, "heaven should ask for paradise visual language");

const openAIProvider = resolveAtlasProviderConfig({ OPENAI_API_KEY: "openai-test-key" }, "openai");
assert.equal(openAIProvider.provider, "openai", "OpenAI should be an allowlisted final provider");
assert.equal(openAIProvider.model, "gpt-image-2", "OpenAI should pin the current high-quality image model");

const openRouterProvider = resolveAtlasProviderConfig(
  { OPENROUTER_API_KEY: "openrouter-test-key" },
  "openrouter",
);
assert.equal(openRouterProvider.provider, "openrouter", "OpenRouter should be an allowlisted Atlas provider");
assert.equal(
  openRouterProvider.model,
  "black-forest-labs/flux.2-klein-4b",
  "the OpenRouter adapter should pin the verified FLUX.2 Klein model",
);

const previewProvider = resolveAtlasPhaseProviderConfig({
  ATLAS_IMAGE_PROVIDER: "openrouter-pro",
  OPENAI_API_KEY: "openai-test-key",
  OPENROUTER_API_KEY: "openrouter-test-key",
}, "preview");
assert.equal(previewProvider.provider, "openrouter", "the preview phase should always stay server-routed through OpenRouter");
assert.equal(
  previewProvider.model,
  "black-forest-labs/flux.2-klein-4b",
  "the preview phase should always use the fast Klein model",
);

const proFinalProvider = resolveAtlasPhaseProviderConfig({
  ATLAS_IMAGE_PROVIDER: "openrouter-pro",
  OPENROUTER_API_KEY: "openrouter-test-key",
}, "final");
assert.equal(proFinalProvider.provider, "openrouter", "FLUX Pro should remain an OpenRouter server adapter");
assert.equal(
  proFinalProvider.model,
  "black-forest-labs/flux.2-pro",
  "the final phase should allow the server-owned FLUX Pro A/B variant",
);

const generatedWithPro = plain(await generateAtlasImage(
  parseAtlasGenerationRequest({ prompt: "fire forest", mode: "generate" }),
  proFinalProvider,
));
assert.equal(generatedWithPro.generation.model, "black-forest-labs/flux.2-pro", "Pro results should retain their model metadata");
const proCall = providerCalls.find((call) => {
  if (call.url !== "https://openrouter.ai/api/v1/images") return false;
  return JSON.parse(call.init.body).model === "black-forest-labs/flux.2-pro";
});
assert.ok(proCall, "the Pro adapter should call OpenRouter with the verified model slug");

// Four env-flip selectors added for the OpenRouter model bake-off. Each must
// route through the OpenRouter adapter with the verified model slug, and each
// must actually reach the OpenRouter Image API when generation runs.
const OPENROUTER_SELECTOR_MATRIX = [
  ["openrouter-flex", "black-forest-labs/flux.2-flex"],
  ["openrouter-max", "black-forest-labs/flux.2-max"],
  ["openrouter-nano2", "google/gemini-3.1-flash-image"],
  ["openrouter-seedream", "bytedance-seed/seedream-4.5"],
];
for (const [selector, expectedModel] of OPENROUTER_SELECTOR_MATRIX) {
  const config = resolveAtlasProviderConfig(
    { OPENROUTER_API_KEY: "openrouter-test-key" },
    selector,
  );
  assert.equal(config.provider, "openrouter", `${selector} should route through OpenRouter`);
  assert.equal(config.model, expectedModel, `${selector} should pin ${expectedModel}`);

  const phaseConfig = resolveAtlasPhaseProviderConfig({
    ATLAS_IMAGE_PROVIDER: selector,
    OPENROUTER_API_KEY: "openrouter-test-key",
  }, "final");
  assert.equal(phaseConfig.model, expectedModel, `final phase should honor ${selector}`);

  const generated = plain(await generateAtlasImage(
    parseAtlasGenerationRequest({ prompt: "fire forest", mode: "generate" }),
    config,
  ));
  assert.equal(generated.generation.model, expectedModel, `${selector} result metadata should name ${expectedModel}`);
  const call = providerCalls.find((entry) => {
    if (entry.url !== "https://openrouter.ai/api/v1/images") return false;
    return JSON.parse(entry.init.body).model === expectedModel;
  });
  assert.ok(call, `${selector} should send its model slug to the OpenRouter Image API`);
}

// Preview stays pinned to Klein 4B regardless of which final selector is in play.
for (const [selector] of OPENROUTER_SELECTOR_MATRIX) {
  const preview = resolveAtlasPhaseProviderConfig({
    ATLAS_IMAGE_PROVIDER: selector,
    OPENAI_API_KEY: "openai-test-key",
    OPENROUTER_API_KEY: "openrouter-test-key",
  }, "preview");
  assert.equal(
    preview.model,
    "black-forest-labs/flux.2-klein-4b",
    `preview must stay on Klein 4B even when final is ${selector}`,
  );
}

assertRequestError(
  () => resolveAtlasProviderConfig({}, "untrusted-provider"),
  "invalid_provider_configuration",
  "unknown provider configuration must be rejected rather than reflected or silently selected",
);

// Prototype-key lookups must not slip past the OpenRouter selector allowlist.
for (const proto of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
  assertRequestError(
    () => resolveAtlasProviderConfig({}, proto),
    "invalid_provider_configuration",
    `${proto} must be rejected as a provider selector, not resolved via prototype`,
  );
}

assertRequestError(
  () => parseAtlasGenerationRequest({
    prompt: "fire forest",
    currentImage: "https://attacker.example/map.webp",
    mode: "generate",
  }),
  "invalid_current_image",
  "remote currentImage URLs must be rejected",
);

assertRequestError(
  () => parseAtlasGenerationRequest({
    prompt: "fire forest",
    currentImage: "/atlas/source.webp",
    mode: "zoom",
  }),
  "focus_required",
  "zoom mode must require a normalized focus point",
);

assertRequestError(
  () => parseAtlasGenerationRequest({
    prompt: "fire forest",
    currentImage: "/atlas/source.webp",
    mode: "shift",
  }),
  "direction_required",
  "shift mode must require a compass direction",
);

const firstContext = plain(createAtlasGenerationContext("fire forest"));
const secondContext = plain(createAtlasGenerationContext("fire forest"));
assert.deepEqual(firstContext, secondContext, "the same concept should create deterministic navigation metadata");
assert.equal(firstContext.hotspots.length, 4, "each generated map should expose four hotspots");
assert.deepEqual(
  Object.keys(firstContext.seeds).sort(),
  ["east", "north", "south", "west"],
  "each map should seed all four neighboring directions",
);
for (const hotspot of firstContext.hotspots) {
  assert.ok(hotspot.id && hotspot.label, "hotspots should have stable identities and labels");
  assert.ok(Number.isFinite(hotspot.x) && hotspot.x >= 0 && hotspot.x <= 1, "hotspot x should be normalized");
  assert.ok(Number.isFinite(hotspot.y) && hotspot.y >= 0 && hotspot.y <= 1, "hotspot y should be normalized");
}

// ── the naming law: derived ground stays inside its subject ────────────
// A hotspot label is the subject Atlas generates when you enter that
// landmark; an edge seed is the subject it generates beyond that edge. So
// a name drawn from our own vocabulary does not merely mislabel the map —
// it replaces the world. These pin that every derived name still carries
// the concept, and that hopping can never accrete one.
const atlasNamingModule = loadTsModule("src/lib/atlas-naming.ts");
const { atlasBaseConcept, atlasNamePart, atlasQuarterLabel, atlasReachesLabel } = atlasNamingModule;

assert.equal(atlasBaseConcept("tokyo"), "tokyo", "a bare concept is its own base");
assert.equal(atlasBaseConcept("tokyo · eastern reaches"), "tokyo", "a qualifier must strip back to the base subject");
assert.equal(atlasBaseConcept("  fire   forest  "), "fire forest", "the base must collapse stray whitespace");
assert.equal(atlasBaseConcept("· only a qualifier"), "· only a qualifier", "a nameless base must fall back to the whole string, never empty");
assert.equal(atlasNamePart("tokyo · north quarter"), "north quarter", "the map prints the part, not the whole subject");
assert.equal(atlasNamePart("tokyo"), "tokyo", "an unqualified name prints itself");

// Crossing a border must not rename the world. This is the regression that
// let a Tokyo map's east edge be "copper harbor", which then generated an
// actual copper harbor and reseeded the next hop from that.
for (const direction of ["north", "east", "south", "west"]) {
  for (const concept of ["tokyo", "Heaven", "a cathedral of bone"]) {
    const base = atlasBaseConcept(concept);
    assert.ok(
      atlasQuarterLabel(concept, direction).startsWith(base),
      `entering a ${direction} landmark of "${concept}" must stay inside that subject`,
    );
    assert.ok(
      atlasReachesLabel(concept, direction).startsWith(base),
      `crossing ${direction} from "${concept}" must stay inside that subject`,
    );
  }
}

// Every hop re-derives from the base, so a long walk can never grow an
// unbounded prompt (the route caps concepts at 240 characters).
{
  let walked = "fire forest";
  for (let hop = 0; hop < 24; hop += 1) {
    walked = atlasReachesLabel(walked, hop % 2 === 0 ? "east" : "north");
    assert.ok(walked.length <= 64, `a ${hop + 1}-hop walk must not accrete qualifiers (${walked.length} chars)`);
    assert.equal(atlasBaseConcept(walked), "fire forest", "a walk must never lose the subject it started from");
  }
}

// A district and the ground beyond that same edge are different places,
// so they must not collapse to one string.
for (const direction of ["north", "east", "south", "west"]) {
  assert.notEqual(
    atlasQuarterLabel("fire forest", direction),
    atlasReachesLabel("fire forest", direction),
    `a ${direction} district and the ${direction} territory beyond it must name different ground`,
  );
}
assert.deepEqual(
  Object.values(plain(createAtlasGenerationContext("fire forest")).seeds).sort(),
  ["fire forest · eastern reaches", "fire forest · northern reaches", "fire forest · southern reaches", "fire forest · western reaches"],
  "edges must name the subject's own outward reaches",
);
// Concept casing reaches the slug now that labels carry the visitor's text.
for (const hotspot of plain(createAtlasGenerationContext("Tokyo")).hotspots) {
  assert.ok(
    /^[a-z0-9-]+$/.test(hotspot.id),
    `a hotspot id must stay a clean slug even from capitalized concepts (got "${hotspot.id}")`,
  );
  assert.ok(hotspot.id.includes("tokyo"), `a hotspot id should keep the subject readable (got "${hotspot.id}")`);
}

const generatedWithOpenRouter = plain(await generateAtlasImage(
  parseAtlasGenerationRequest({ prompt: "fire forest", mode: "generate" }),
  openRouterProvider,
));
assert.equal(generatedWithOpenRouter.generation.provider, "openrouter", "result metadata should name OpenRouter");
assert.equal(
  generatedWithOpenRouter.generation.model,
  "black-forest-labs/flux.2-klein-4b",
  "result metadata should name the selected FLUX model",
);
assert.match(generatedWithOpenRouter.dataUrl, /^data:image\/png;base64,/, "OpenRouter output should retain PNG media type");

const generationCall = providerCalls.find((call) => {
  if (call.url !== "https://openrouter.ai/api/v1/images") return false;
  return JSON.parse(call.init.body).model === "black-forest-labs/flux.2-klein-4b";
});
const generationBody = JSON.parse(generationCall.init.body);
assert.equal(generationCall.url, "https://openrouter.ai/api/v1/images", "OpenRouter should use its dedicated Image API");
assert.equal(generationCall.init.headers.authorization, "Bearer openrouter-test-key", "OpenRouter auth should stay server-side");
assert.equal(generationBody.model, "black-forest-labs/flux.2-klein-4b", "generation should send the allowlisted model");
assert.equal(generationBody.output_format, "png", "generation should request a supported output format");
assert.equal(generationBody.n, 1, "FLUX.2 Klein supports exactly one output");
assert.equal("size" in generationBody, false, "unsupported size controls must not be sent to OpenRouter");
assert.equal("quality" in generationBody, false, "unsupported quality controls must not be sent to OpenRouter");

const firstBatch = plain(resolveAtlasBatchPlan(0));
assert.equal(firstBatch.kind, "cardinal4", "first navigation should plan four cardinal neighbor sheets");
assert.deepEqual(
  firstBatch.slots.map((slot) => slot.direction),
  ["north", "east", "south", "west"],
  "cardinal4 should cover N/E/S/W",
);
assert.equal(firstBatch.slots.length, 4, "first batch should request four images");
for (const slot of firstBatch.slots) {
  assert.ok(slot.clip.width > 0.4 && slot.clip.height > 0.4, "cardinal clips should sample a useful edge strip");
  assert.ok(slot.clip.x >= 0 && slot.clip.y >= 0, "clip origins should stay normalized");
  assert.ok(slot.clip.x + slot.clip.width <= 1.0001, "clip widths should stay in bounds");
  assert.ok(slot.clip.y + slot.clip.height <= 1.0001, "clip heights should stay in bounds");
}
assert.deepEqual(
  clipRectForBatchDirection("northwest"),
  firstBatch.slots[0] && clipRectForBatchDirection("northwest"),
  "northwest clip helper should stay stable",
);
const nw = clipRectForBatchDirection("northwest");
const se = clipRectForBatchDirection("southeast");
assert.ok(nw.x === 0 && nw.y === 0, "northwest sample should start at the origin corner");
assert.ok(se.x < 0.5 && se.y < 0.5, "southeast sample should include a buffer into the center");
assert.ok(nw.width > 0.5 && nw.height > 0.5, "northwest clip should include ~12% buffer past the quadrant");

const laterBatch = plain(resolveAtlasBatchPlan(1));
assert.equal(laterBatch.kind, "diagonal2", "subsequent generations should plan northwest/southeast samples");
assert.deepEqual(
  laterBatch.slots.map((slot) => slot.direction),
  ["northwest", "southeast"],
  "diagonal2 should cover NW and SE",
);
assert.equal(laterBatch.slots.length, 2, "subsequent batch should request two images");
assert.deepEqual(plain(laterBatch.slots[0].clip), plain(nw), "diagonal2 northwest clip should match the shared helper");
assert.deepEqual(plain(laterBatch.slots[1].clip), plain(se), "diagonal2 southeast clip should match the shared helper");

const mobileZoomMetrics = { width: 390, height: 788, mapWidth: 437, mapHeight: 788 };
assert.equal(
  resolveAtlasEdgeTravel(
    { x: -360, y: -470, zoom: 2.55 },
    mobileZoomMetrics,
    { x: -48, y: 0 },
    59,
  ),
  null,
  "a fast pan through the middle of a zoomed sheet must not jump to a neighboring region",
);
assert.equal(
  resolveAtlasEdgeTravel(
    { x: -724, y: -470, zoom: 2.55 },
    mobileZoomMetrics,
    { x: -12, y: 0 },
    59,
  ),
  "east",
  "continuing to pan outward at the eastern edge should travel to the eastern neighbor",
);
assert.equal(
  resolveAtlasEdgeTravel(
    { x: -704, y: -470, zoom: 2.55 },
    mobileZoomMetrics,
    { x: -12, y: 0 },
    59,
  ),
  null,
  "a fast pan must not travel while visible content remains before the edge",
);

const edgeTravelCases = [
  ["west", { x: 0, y: -470, zoom: 2.55 }, { x: 12, y: 0 }],
  ["north", { x: -360, y: 0, zoom: 2.55 }, { x: 0, y: 12 }],
  ["south", { x: -360, y: -1221.4, zoom: 2.55 }, { x: 0, y: -12 }],
];
for (const [direction, view, velocity] of edgeTravelCases) {
  assert.equal(
    resolveAtlasEdgeTravel(view, mobileZoomMetrics, velocity, 59),
    direction,
    `${direction} edge travel should resolve only at the matching boundary`,
  );
}

const focusClip = clipRectForBatchDirection("southeast");

const preparedCroppedSource = plain(await prepareCroppedSource("data:image/png;base64,parent", focusClip));
assert.deepEqual(
  preparedCroppedSource,
  { currentImage: "data:image/png;base64,cropped", sourceImageCropped: true },
  "a successful browser crop should pair the cropped source with the server skip marker",
);
const preparedUncroppedSource = plain(await prepareUncroppedSource("data:image/png;base64,parent", focusClip));
assert.deepEqual(
  preparedUncroppedSource,
  { currentImage: "data:image/png;base64,parent", sourceImageCropped: false },
  "a failed browser crop should preserve the parent source and let the server crop it",
);

assert.deepEqual(
  plain(pixelBoundsForClip({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, 100, 200)),
  { left: 25, top: 50, width: 50, height: 100 },
  "pixelBoundsForClip should map normalized clips onto integer pixel extracts",
);
assert.deepEqual(
  plain(pixelBoundsForClip({ x: 0, y: 0, width: 1, height: 1 }, 1, 1)),
  { left: 0, top: 0, width: 1, height: 1 },
  "pixelBoundsForClip should keep at least a 1x1 extract on tiny sources",
);
const eastPixelBounds = pixelBoundsForClip(clipRectForBatchDirection("east"), 100, 80);
assert.equal(eastPixelBounds.left, Math.round(0.38 * 100), "east crop should start near the buffered midline");
assert.equal(eastPixelBounds.top, 0, "east crop should span the full height origin");
assert.ok(eastPixelBounds.width >= 50, "east crop should cover the eastern half plus buffer");
assert.equal(eastPixelBounds.height, 80, "east crop should span the full image height");

const zoomSourceRequest = parseAtlasGenerationRequest({
  prompt: "fire forest",
  currentImage: `data:image/png;base64,${ONE_PIXEL_PNG}`,
  focus: { x: 0.4, y: 0.6, zoom: 2 },
  clip: plain(focusClip),
  mode: "zoom",
  batchRole: "primary",
  generationDepth: 1,
});
assert.equal(
  atlasOperationForRequest(zoomSourceRequest),
  "generation",
  "free zoom always draws a native sheet — never an edit/upscale of the soft parent",
);
// A fresh concept must draw from scratch even when a sheet is on screen — the
// bug that made a new prompt return the same coastline was a `generate` request
// silently becoming an edit of the current image.
assert.equal(
  atlasOperationForRequest({ mode: "generate", currentImage: `data:image/png;base64,${ONE_PIXEL_PNG}` }),
  "generation",
  "a new prompt draws a new world from scratch, never an edit of the current map",
);
assert.equal(
  atlasOperationForRequest({ mode: "generate" }),
  "generation",
  "the first map is a generation too",
);
const sharpCallsBeforeZoom = sharpExtractCalls.length;
const zoomResult = plain(await generateAtlasImage(zoomSourceRequest, openRouterProvider));
assert.equal(zoomResult.generation.operation, "generation", "free zoom must generate, not edit the parent bitmap");
assert.equal(
  sharpExtractCalls.length,
  sharpCallsBeforeZoom,
  "free zoom must not pixel-crop the parent — that path is what stacked blur",
);
const openRouterCalls = () => providerCalls.filter((call) => call.url === "https://openrouter.ai/api/v1/images");
const zoomCall = [...openRouterCalls()].reverse().find((call) => {
  const body = JSON.parse(call.init.body);
  return typeof body.prompt === "string" && body.prompt.includes("full-resolution atlas sheet");
});
assert.ok(zoomCall, "zoom should ask for a native full-resolution close view");
const zoomBody = JSON.parse(zoomCall.init.body);
assert.equal(zoomBody.input_references, undefined, "zoom must not send the soft parent as an edit reference");

const preCroppedShiftRequest = parseAtlasGenerationRequest({
  prompt: "fire forest",
  currentImage: `data:image/png;base64,${ONE_PIXEL_PNG}`,
  direction: "east",
  clip: plain(focusClip),
  sourceImageCropped: true,
  mode: "shift",
  batchRole: "primary",
  generationDepth: 1,
});
assertRequestError(
  () => parseAtlasGenerationRequest({
    prompt: "fire forest",
    currentImage: `data:image/png;base64,${ONE_PIXEL_PNG}`,
    sourceImageCropped: true,
    mode: "generate",
  }),
  "clip_required",
  "pre-cropped sources must retain the parent clip coordinates used to create them",
);
assertRequestError(
  () => parseAtlasGenerationRequest({
    prompt: "fire forest",
    currentImage: `data:image/png;base64,${ONE_PIXEL_PNG}`,
    clip: plain(focusClip),
    sourceImageCropped: "yes",
    mode: "shift",
  }),
  "invalid_request",
  "sourceImageCropped must be a strict boolean",
);
const sharpCallsBeforePreCroppedShift = sharpExtractCalls.length;
await generateAtlasImage(preCroppedShiftRequest, openRouterProvider);
assert.equal(
  sharpExtractCalls.length,
  sharpCallsBeforePreCroppedShift,
  "a browser-cropped shift source must not be cropped a second time on the server",
);
assert.match(
  zoomBody.prompt,
  /full-resolution|Do not produce a soft, blurry|zoomable and pannable again/i,
  "zoom prompts should demand a native sharp close view, not an upscale",
);

const refineResult = plain(await generateAtlasImage(
  parseAtlasGenerationRequest({
    prompt: "fire forest",
    currentImage: `data:image/png;base64,${ONE_PIXEL_PNG}`,
    focus: { x: 0.4, y: 0.6, zoom: 2 },
    mode: "refine",
  }),
  openRouterProvider,
));
assert.equal(refineResult.generation.operation, "edit", "landmark clicks should refine/edit a subsection");
const refineCall = [...openRouterCalls()].reverse().find((call) => {
  const body = JSON.parse(call.init.body);
  return typeof body.prompt === "string" && body.prompt.includes("deepen and improve only the subsection");
});
assert.ok(refineCall, "refine should ask the provider to edit a local region");
const refineBody = JSON.parse(refineCall.init.body);
assert.equal(refineBody.input_references.length, 1, "refine should send the current map as an edit reference");
assert.match(refineBody.prompt, /subsection|in place/i, "refine prompts should stay local to the clicked region");

const shiftWithoutImage = plain(parseAtlasGenerationRequest({
  prompt: "fire forest",
  direction: "east",
  mode: "shift",
}));
assert.equal(shiftWithoutImage.mode, "shift", "shift should parse without a current image");
assert.equal(shiftWithoutImage.direction, "east", "shift should keep the compass direction");
assert.equal(shiftWithoutImage.currentImage, undefined, "shift should not require a source image");

const eastClip = clipRectForBatchDirection("east");
const shiftSourceRequest = parseAtlasGenerationRequest({
  prompt: "fire forest",
  currentImage: `data:image/png;base64,${ONE_PIXEL_PNG}`,
  direction: "east",
  clip: eastClip,
  mode: "shift",
  batchKind: "cardinal4",
  batchRole: "neighbor",
  batchDirection: "east",
  generationDepth: 0,
});
assert.equal(
  atlasOperationForRequest(shiftSourceRequest),
  "edit",
  "shift with a current image should extend from the clipped source",
);
const shiftResult = plain(await generateAtlasImage(shiftSourceRequest, openRouterProvider));
assert.equal(shiftResult.generation.operation, "edit", "edge pan with a source sheet should edit/extend");
const shiftCall = [...openRouterCalls()].reverse().find((call) => {
  const body = JSON.parse(call.init.body);
  return typeof body.prompt === "string" && body.prompt.includes("neighboring territory toward the east");
});
assert.ok(shiftCall, "shift should ask the provider to extend from the clipped east sample");
const shiftBody = JSON.parse(shiftCall.init.body);
assert.equal(shiftBody.input_references.length, 1, "shift must send the previous map as a clipped source reference");
assert.match(
  shiftBody.input_references[0].image_url.url,
  /^data:image\/png;base64,/,
  "shift input_references must carry the cropped PNG sample",
);
assert.match(
  shiftBody.prompt,
  /supplied image IS the cropped region sample|pannable and zoomable again/i,
  "shift prompts should treat the reference as an already-cropped neighbor sample",
);

const diagonalNeighbor = plain(parseAtlasGenerationRequest({
  prompt: "fire forest",
  currentImage: `data:image/png;base64,${ONE_PIXEL_PNG}`,
  mode: "zoom",
  focus: { x: nw.x + nw.width / 2, y: nw.y + nw.height / 2, zoom: 2 },
  clip: nw,
  batchKind: "diagonal2",
  batchRole: "neighbor",
  batchDirection: "northwest",
  generationDepth: 2,
}));
assert.equal(diagonalNeighbor.batchDirection, "northwest", "diagonal neighbor requests should accept northwest");
assert.deepEqual(plain(diagonalNeighbor.clip), plain(nw), "diagonal neighbor requests should keep the NW clip rect");

const progressiveRoute = loadAtlasRoute({
  ATLAS_GENERATION_ENABLED: "true",
  ATLAS_IMAGE_PROVIDER: "openai",
  OPENAI_API_KEY: "openai-test-key",
  OPENROUTER_API_KEY: "openrouter-test-key",
});
const canonicalInteractionId = "atlas-canonical-interaction-001";
const canonicalClip = { x: 0.2, y: 0.25, width: 0.4, height: 0.5 };
// Shift still samples the parent edge; free-zoom no longer does (blur stack).
const canonicalBody = JSON.stringify({
  prompt: "fire forest",
  currentImage: `data:image/png;base64,${SOURCE_PNG}`,
  viewport: { width: 390, height: 844 },
  direction: "east",
  clip: canonicalClip,
  mode: "shift",
});
const progressiveCallsStart = providerCalls.length;
const progressiveSharpCallsStart = sharpExtractCalls.length;
const [previewResponse, finalResponse] = await Promise.all([
  progressiveRoute.POST(new Request("https://atlas.test/api/atlas/generate?phase=preview", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-atlas-generation-id": canonicalInteractionId,
      "x-real-ip": "127.0.0.31",
    },
    body: canonicalBody,
  })),
  progressiveRoute.POST(new Request("https://atlas.test/api/atlas/generate?phase=final", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-atlas-generation-id": canonicalInteractionId,
      "x-real-ip": "127.0.0.31",
    },
    body: canonicalBody,
  })),
]);
assert.equal(previewResponse.status, 200, "the Klein preview should resolve independently");
assert.equal(finalResponse.status, 200, "the GPT Image final should resolve independently");
assert.equal(previewResponse.body.generation.phase, "preview", "preview responses should identify their phase");
assert.equal(finalResponse.body.generation.phase, "final", "final responses should identify their phase");
assert.equal(previewResponse.body.generation.generationId, canonicalInteractionId, "preview should echo the safe stale-response token");
assert.equal(finalResponse.body.generation.generationId, canonicalInteractionId, "final should echo the same stale-response token");
assert.equal(previewResponse.body.generation.model, "black-forest-labs/flux.2-klein-4b", "hybrid preview should use Klein");
assert.equal(finalResponse.body.generation.model, "gpt-image-2", "the default hybrid final should use GPT Image 2");

const progressiveCalls = providerCalls.slice(progressiveCallsStart);
const canonicalPreviewCall = progressiveCalls.find((call) => {
  if (call.url !== "https://openrouter.ai/api/v1/images") return false;
  return JSON.parse(call.init.body).model === "black-forest-labs/flux.2-klein-4b";
});
const canonicalFinalCall = progressiveCalls.find((call) => call.url === "https://api.openai.com/v1/images/edits");
assert.ok(canonicalPreviewCall, "the preview phase should call Klein");
assert.ok(canonicalFinalCall, "the final phase should reconstruct with GPT Image 2");
const canonicalPreviewBody = JSON.parse(canonicalPreviewCall.init.body);
const canonicalFinalBody = canonicalFinalCall.init.body;
assert.equal(canonicalPreviewBody.input_references?.length, 1, "shift preview should sample from the current map");
assert.ok(canonicalFinalBody.get("image") instanceof Blob, "shift final should sample from the current map");
assert.equal(canonicalFinalBody.get("model"), "gpt-image-2", "shift final should edit with GPT Image 2");
assert.equal(canonicalFinalBody.get("quality"), "high", "shift final should request high rendering quality");
{
  const [w, h] = String(canonicalFinalBody.get("size")).split("x").map(Number);
  assert.ok(Math.abs(w / h - 853 / 1538) < 0.01, "mobile shift final should preserve the authored portrait sheet geometry");
  assert.ok(w >= 1100, "a phone sheet must out-resolve a 3x 390px stage as far as the providers allow");
  assert.ok(w % 16 === 0 && h % 16 === 0, "sheet dimensions must stay 16px aligned for the providers");
}
const [mobileOutputWidth, mobileOutputHeight] = canonicalFinalBody.get("size").split("x").map(Number);
assert.equal(mobileOutputWidth % 16, 0, "mobile output width should align to the image model's 16px grid");
assert.equal(mobileOutputHeight % 16, 0, "mobile output height should align to the image model's 16px grid");
assert.ok(
  Math.abs((mobileOutputWidth / mobileOutputHeight) - (853 / 1538)) < 0.001,
  "mobile output geometry should match the Atlas MOBILE_MAP_ASPECT within one-thousandth",
);
const previewCropBytes = Buffer.from(canonicalPreviewBody.input_references[0].image_url.url.split(",")[1], "base64");
const finalCropBytes = Buffer.from(await canonicalFinalBody.get("image").arrayBuffer());
assert.deepEqual(previewCropBytes, SHARP_CROP_BYTES, "Flux preview should receive the exact Sharp-mock crop bytes");
assert.deepEqual(finalCropBytes, SHARP_CROP_BYTES, "OpenAI edit should receive the exact Sharp-mock crop bytes");
assert.deepEqual(finalCropBytes, previewCropBytes, "preview and final providers should receive byte-identical crop input");
const expectedCanonicalCrop = plain(pixelBoundsForClip(canonicalClip, 100, 80));
const progressiveSharpCalls = sharpExtractCalls.slice(progressiveSharpCallsStart);
assert.equal(progressiveSharpCalls.length, 2, "each progressive phase should crop the canonical source once");
assert.ok(
  progressiveSharpCalls.every((call) => JSON.stringify(call.region) === JSON.stringify(expectedCanonicalCrop)),
  "both progressive phases should apply the exact canonical clip bounds",
);
assert.match(
  canonicalPreviewBody.prompt,
  /neighboring territory toward the east|supplied atlas sample/i,
  "shift preview should extend from the edge sample",
);
assert.equal(
  canonicalFinalBody.get("prompt"),
  canonicalPreviewBody.prompt,
  "preview and final should share one canonical server-composed prompt",
);
assert.equal(previewResponse.body.generation.operation, "edit", "shift preview with a source sheet should edit/reconstruct");
assert.equal(finalResponse.body.generation.operation, "edit", "shift final with a source sheet should edit/reconstruct");

const zoomProgressiveBody = JSON.stringify({
  prompt: "fire forest",
  viewport: { width: 390, height: 844 },
  focus: { x: 0.42, y: 0.58, zoom: 2.5 },
  mode: "zoom",
});
const zoomProgressiveId = "atlas-zoom-native-001";
const [zoomPreviewResponse, zoomFinalResponse] = await Promise.all([
  progressiveRoute.POST(new Request("https://atlas.test/api/atlas/generate?phase=preview", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-atlas-generation-id": zoomProgressiveId,
      "x-real-ip": "127.0.0.41",
    },
    body: zoomProgressiveBody,
  })),
  progressiveRoute.POST(new Request("https://atlas.test/api/atlas/generate?phase=final", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-atlas-generation-id": zoomProgressiveId,
      "x-real-ip": "127.0.0.41",
    },
    body: zoomProgressiveBody,
  })),
]);
assert.equal(zoomPreviewResponse.body.generation.operation, "generation", "zoom preview must generate natively");
assert.equal(zoomFinalResponse.body.generation.operation, "generation", "zoom final must generate natively");
assert.equal(zoomFinalResponse.body.generation.model, "gpt-image-2", "zoom final should still use GPT Image 2");
const zoomFinalGenCall = [...providerCalls].reverse().find((call) => call.url === "https://api.openai.com/v1/images/generations");
assert.ok(zoomFinalGenCall, "zoom final should hit the generations endpoint, not edits");
assert.match(
  JSON.parse(zoomFinalGenCall.init.body).prompt,
  /Do not produce a soft, blurry/i,
  "zoom finals should forbid soft upscales in the provider prompt",
);

const preCroppedSharpCallsStart = sharpExtractCalls.length;
const preCroppedResult = plain(await generateAtlasImage(parseAtlasGenerationRequest({
  prompt: "fire forest",
  currentImage: `data:image/png;base64,${SHARP_CROP_BYTES.toString("base64")}`,
  viewport: { width: 390, height: 844 },
  direction: "east",
  clip: canonicalClip,
  sourceImageCropped: true,
  mode: "shift",
}), openAIProvider));
assert.equal(preCroppedResult.generation.operation, "edit", "pre-cropped shift sources should still use the OpenAI edit endpoint");
const preCroppedCall = [...providerCalls].reverse().find((call) => call.url === "https://api.openai.com/v1/images/edits");
const preCroppedBytes = Buffer.from(await preCroppedCall.init.body.get("image").arrayBuffer());
assert.deepEqual(preCroppedBytes, SHARP_CROP_BYTES, "pre-cropped sources should reach OpenAI without another crop");
assert.equal(sharpExtractCalls.length, preCroppedSharpCallsStart, "sourceImageCropped should suppress duplicate Sharp extraction");

const proFinalRoute = loadAtlasRoute({
  ATLAS_GENERATION_ENABLED: "true",
  ATLAS_IMAGE_PROVIDER: "openrouter-pro",
  OPENROUTER_API_KEY: "openrouter-test-key",
});
const proFinalResponse = await proFinalRoute.POST(new Request("https://atlas.test/api/atlas/generate?phase=final", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-atlas-generation-id": "atlas-pro-ab-test-001",
    "x-real-ip": "127.0.0.36",
  },
  body: JSON.stringify({ prompt: "fire forest", mode: "generate" }),
}));
assert.equal(proFinalResponse.status, 200, "the server-selected Pro final should generate successfully");
assert.equal(proFinalResponse.body.generation.provider, "openrouter", "the browser should only see normalized provider metadata");
assert.equal(proFinalResponse.body.generation.model, "black-forest-labs/flux.2-pro", "the final A/B route should select FLUX Pro from server env");

failKleinPreview = true;
try {
  const independentBody = JSON.stringify({ prompt: "storm archive", mode: "generate" });
  const [failedPreview, survivingFinal] = await Promise.all([
    progressiveRoute.POST(new Request("https://atlas.test/api/atlas/generate?phase=preview", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-atlas-generation-id": "atlas-independent-failure-001",
        "x-real-ip": "127.0.0.32",
      },
      body: independentBody,
    })),
    progressiveRoute.POST(new Request("https://atlas.test/api/atlas/generate?phase=final", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-atlas-generation-id": "atlas-independent-failure-001",
        "x-real-ip": "127.0.0.32",
      },
      body: independentBody,
    })),
  ]);
  assert.equal(failedPreview.status, 503, "a preview provider failure should remain scoped to preview");
  assert.equal(failedPreview.body.generation.phase, "preview", "preview errors should retain phase metadata");
  assert.equal(survivingFinal.status, 200, "preview failure must not block the final provider");
  assert.equal(survivingFinal.body.generation.phase, "final", "the surviving final should retain phase metadata");
} finally {
  failKleinPreview = false;
}

const keylessOpenAIRoute = loadAtlasRoute({
  ATLAS_GENERATION_ENABLED: "true",
  ATLAS_IMAGE_PROVIDER: "openai",
  OPENROUTER_API_KEY: "openrouter-test-key",
});
const keylessGenerationId = "atlas-keyless-openai-final-001";
const [keylessPreview, keylessFinal] = await Promise.all([
  keylessOpenAIRoute.POST(new Request("https://atlas.test/api/atlas/generate?phase=preview", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-atlas-generation-id": keylessGenerationId,
      "x-real-ip": "127.0.0.37",
    },
    body: JSON.stringify({ prompt: "keyless harbor", mode: "generate" }),
  })),
  keylessOpenAIRoute.POST(new Request("https://atlas.test/api/atlas/generate?phase=final", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-atlas-generation-id": keylessGenerationId,
      "x-real-ip": "127.0.0.37",
    },
    body: JSON.stringify({ prompt: "keyless harbor", mode: "generate" }),
  })),
]);
assert.equal(keylessPreview.status, 200, "a configured Flux preview should succeed independently of the final key");
assert.equal(keylessFinal.status, 503, "an enabled keyless OpenAI final should fail as configuration, not demo mode");
assert.equal(keylessFinal.body.error.code, "invalid_provider_configuration", "keyless finals should expose a stable configuration error");
assert.equal(keylessFinal.body.generation.reason, "missing_api_key", "keyless finals should identify the missing credential without exposing it");
assert.equal(keylessFinal.body.generation.phase, "final", "keyless errors should retain final phase metadata");
assert.equal(keylessFinal.body.generation.generationId, keylessGenerationId, "keyless errors should retain the interaction generation ID");

failOpenAIGeneration = true;
try {
  const failedGenerationId = "atlas-openai-generation-failure-001";
  const [survivingPreview, failedFinal] = await Promise.all([
    progressiveRoute.POST(new Request("https://atlas.test/api/atlas/generate?phase=preview", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-atlas-generation-id": failedGenerationId,
        "x-real-ip": "127.0.0.38",
      },
      body: JSON.stringify({ prompt: "openai generation failure", mode: "generate" }),
    })),
    progressiveRoute.POST(new Request("https://atlas.test/api/atlas/generate?phase=final", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-atlas-generation-id": failedGenerationId,
        "x-real-ip": "127.0.0.38",
      },
      body: JSON.stringify({ prompt: "openai generation failure", mode: "generate" }),
    })),
  ]);
  assert.equal(survivingPreview.status, 200, "a Flux preview should survive an OpenAI generation failure");
  assert.equal(failedFinal.status, 503, "OpenAI generation failures should remain scoped to final");
  assert.equal(failedFinal.body.generation.phase, "final", "OpenAI generation errors should retain final phase metadata");
  assert.equal(failedFinal.body.generation.generationId, failedGenerationId, "OpenAI generation errors should retain generationId");
} finally {
  failOpenAIGeneration = false;
}

failOpenAIEdit = true;
try {
  const failedEditGenerationId = "atlas-openai-edit-failure-001";
  const failedEdit = await progressiveRoute.POST(new Request("https://atlas.test/api/atlas/generate?phase=final", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-atlas-generation-id": failedEditGenerationId,
      "x-real-ip": "127.0.0.39",
    },
    body: canonicalBody,
  }));
  assert.equal(failedEdit.status, 503, "OpenAI edit failures should remain scoped to final");
  assert.equal(failedEdit.body.generation.operation, "edit", "OpenAI edit errors should preserve operation metadata");
  assert.equal(failedEdit.body.generation.phase, "final", "OpenAI edit errors should retain final phase metadata");
  assert.equal(failedEdit.body.generation.generationId, failedEditGenerationId, "OpenAI edit errors should retain generationId");
} finally {
  failOpenAIEdit = false;
}

const cancelledController = new AbortController();
cancelledController.abort();
const cancelledResponse = await progressiveRoute.POST(new Request("https://atlas.test/api/atlas/generate?phase=preview", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-atlas-generation-id": "atlas-cancelled-interaction-001",
    "x-real-ip": "127.0.0.33",
  },
  body: JSON.stringify({ prompt: "cancelled forest", mode: "generate" }),
  signal: cancelledController.signal,
}));
assert.equal(cancelledResponse.status, 408, "an aborted phase should stop at the provider boundary");
assert.equal(cancelledResponse.body.generation.phase, "preview", "cancelled responses should retain phase metadata");
assert.equal(
  cancelledResponse.body.generation.generationId,
  "atlas-cancelled-interaction-001",
  "cancelled responses should remain attributable to the stale interaction",
);

const invalidPhaseResponse = await progressiveRoute.POST(new Request("https://atlas.test/api/atlas/generate?phase=provider-secret", {
  method: "POST",
  headers: { "content-type": "application/json", "x-real-ip": "127.0.0.34" },
  body: JSON.stringify({ prompt: "fire forest", mode: "generate" }),
}));
assert.equal(invalidPhaseResponse.status, 400, "unknown phases should fail closed");
assert.equal(invalidPhaseResponse.body.error.code, "invalid_phase", "unknown phases should return a stable safe error");

const interactionLimitedRoute = loadAtlasRoute({
  ATLAS_GENERATION_ENABLED: "false",
  ATLAS_IMAGE_PROVIDER: "openrouter-pro",
});
for (let interaction = 0; interaction < 8; interaction += 1) {
  const interactionBody = JSON.stringify({ prompt: `rate limit map ${interaction}`, mode: "generate" });
  const phaseResponses = await Promise.all(["preview", "final"].map((phase) => (
    interactionLimitedRoute.POST(new Request(`https://atlas.test/api/atlas/generate?phase=${phase}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-atlas-generation-id": `atlas-rate-limit-${interaction}`,
        "x-real-ip": "127.0.0.35",
      },
      body: interactionBody,
    }))
  )));
  assert.deepEqual(phaseResponses.map((response) => response.status), [200, 200], "eight full interactions should fit the phase-aware window");
}
const seventeenthPhaseCall = await interactionLimitedRoute.POST(new Request("https://atlas.test/api/atlas/generate?phase=preview", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-atlas-generation-id": "atlas-rate-limit-overflow",
    "x-real-ip": "127.0.0.35",
  },
  body: JSON.stringify({ prompt: "rate limit overflow", mode: "generate" }),
}));
assert.equal(seventeenthPhaseCall.status, 429, "the seventeenth phase call should be rate limited");

const openRouterDemoRoute = loadAtlasRoute({
  ATLAS_GENERATION_ENABLED: "false",
  ATLAS_IMAGE_PROVIDER: "openrouter",
});
const demoResponse = await openRouterDemoRoute.POST(new Request("https://atlas.test/api/atlas/generate", {
  method: "POST",
  headers: { "content-type": "application/json", "x-real-ip": "127.0.0.21" },
  body: JSON.stringify({ prompt: "fire forest", mode: "generate" }),
}));
assert.equal(demoResponse.status, 200, "disabled generation should keep the Atlas usable in demo mode");
assert.equal(demoResponse.body.dataUrl, null, "demo mode should not invent a provider image");
assert.equal(demoResponse.body.generation.provider, "openrouter", "demo metadata should safely name the selected provider");
assert.equal(demoResponse.body.generation.phase, "final", "legacy requests should remain final-phase JSON responses");
assert.match(demoResponse.body.generation.generationId, /^[A-Za-z0-9_-]{8,80}$/, "legacy requests should receive a safe server generation ID");
assert.equal(
  demoResponse.body.generation.model,
  "black-forest-labs/flux.2-klein-4b",
  "demo metadata should safely name the allowlisted model",
);

const invalidProviderRoute = loadAtlasRoute({
  ATLAS_GENERATION_ENABLED: "false",
  ATLAS_IMAGE_PROVIDER: "private-provider-value",
});
const invalidProviderResponse = await invalidProviderRoute.POST(new Request("https://atlas.test/api/atlas/generate", {
  method: "POST",
  headers: { "content-type": "application/json", "x-real-ip": "127.0.0.22" },
  body: JSON.stringify({ prompt: "fire forest", mode: "generate" }),
}));
assert.equal(invalidProviderResponse.status, 503, "invalid server provider configuration should fail closed");
assert.equal(
  invalidProviderResponse.body.generation.provider,
  "unconfigured",
  "invalid provider values must not be reflected to the browser",
);
assert.equal(invalidProviderResponse.body.generation.phase, "final", "configuration errors should retain final phase metadata");
assert.doesNotMatch(
  JSON.stringify(invalidProviderResponse.body),
  /private-provider-value/,
  "invalid provider values must remain server-only",
);

assert.equal(SITE_ROUTE_BY_KEY.atlas.href, "/atlas/origin", "atlas should resolve to its living-map entry route");
assert.equal(SITE_ROUTE_BY_KEY.atlas.dark, true, "atlas should opt into dark site chrome");
assert.equal(isDarkRoutePath("/atlas/origin"), true, "/atlas/origin should resolve as a dark route");

// ── the world chart: sheets take addresses, travel returns ────────────

const atlasWorldModule = loadTsModule("src/lib/atlas-world.ts");
const {
  addressKey: worldAddressKey,
  createAtlasWorld,
  shiftAddress,
  zoomLabelTier,
} = atlasWorldModule;

// Travel must round-trip: a sign error in any cardinal delta strands the
// traveler on a different address than the one they left.
for (const [there, back] of [["east", "west"], ["west", "east"], ["north", "south"], ["south", "north"]]) {
  const away = shiftAddress({ wx: 3, wy: -2 }, there);
  assert.notDeepEqual(plain(away), { wx: 3, wy: -2 }, "travel " + there + " must move the address");
  assert.deepEqual(
    plain(shiftAddress(away, back)),
    { wx: 3, wy: -2 },
    "travel " + there + " then " + back + " must return to the departure address",
  );
}

// Diagonal speculation must agree with cardinal composition, or a NW sheet
// prefetched today would be unreachable by tomorrow's north-then-west walk.
assert.equal(
  worldAddressKey(shiftAddress({ wx: 0, wy: 0 }, "northwest")),
  worldAddressKey(shiftAddress(shiftAddress({ wx: 0, wy: 0 }, "north"), "west")),
  "northwest must land where north composed with west lands",
);
assert.equal(
  worldAddressKey(shiftAddress({ wx: 0, wy: 0 }, "southeast")),
  worldAddressKey(shiftAddress(shiftAddress({ wx: 0, wy: 0 }, "south"), "east")),
  "southeast must land where south composed with east lands",
);

const sheetAt = (address, phase, image) => ({
  address,
  image,
  hotspots: null,
  seeds: null,
  concept: "test ground",
  phase,
  depth: 1,
});

// The core promise: travel east then back west lands on the sheet that
// was left — not a stranger, not nothing.
const world = createAtlasWorld(8);
world.remember(sheetAt({ wx: 0, wy: 0 }, "final", "origin-sheet"));
world.remember(sheetAt({ wx: 1, wy: 0 }, "final", "east-sheet"));
assert.equal(
  world.recall(shiftAddress({ wx: 1, wy: 0 }, "west"))?.image,
  "origin-sheet",
  "returning west must recall the origin sheet instead of regenerating it",
);

// A settled final must not be erased by a late speculative preview.
world.remember(sheetAt({ wx: 1, wy: 0 }, "preview", "stale-preview"));
assert.equal(
  world.recall({ wx: 1, wy: 0 })?.image,
  "east-sheet",
  "a late preview must not overwrite settled final ink",
);
assert.equal(
  world.recall({ wx: 1, wy: 0 })?.phase,
  "final",
  "the kept sheet must keep its final phase after a stale preview arrives",
);

// A final upgrade replaces the preview it refines.
world.remember(sheetAt({ wx: 0, wy: 1 }, "preview", "south-preview"));
world.remember(sheetAt({ wx: 0, wy: 1 }, "final", "south-final"));
assert.equal(
  world.recall({ wx: 0, wy: 1 })?.image,
  "south-final",
  "a final must upgrade the preview beneath it",
);

// Bounded memory: the least recently walked ground slips away first, and
// walking a sheet protects it.
const smallWorld = createAtlasWorld(3);
smallWorld.remember(sheetAt({ wx: 0, wy: 0 }, "final", "a"));
smallWorld.remember(sheetAt({ wx: 1, wy: 0 }, "final", "b"));
smallWorld.remember(sheetAt({ wx: 2, wy: 0 }, "final", "c"));
smallWorld.recall({ wx: 0, wy: 0 });
smallWorld.remember(sheetAt({ wx: 3, wy: 0 }, "final", "d"));
assert.equal(
  smallWorld.peek({ wx: 1, wy: 0 }),
  null,
  "the least recently walked sheet must be the one evicted at capacity",
);
assert.equal(
  smallWorld.peek({ wx: 0, wy: 0 })?.image,
  "a",
  "recalling a sheet must protect it from eviction",
);
assert.equal(smallWorld.size(), 3, "the world must hold exactly its capacity after eviction");

// Glances must not count as walking, or the traverse chart and edge
// names would silently reorder eviction.
const peekWorld = createAtlasWorld(2);
peekWorld.remember(sheetAt({ wx: 0, wy: 0 }, "final", "first"));
peekWorld.remember(sheetAt({ wx: 1, wy: 0 }, "final", "second"));
peekWorld.peek({ wx: 0, wy: 0 });
peekWorld.remember(sheetAt({ wx: 2, wy: 0 }, "final", "third"));
assert.equal(
  peekWorld.peek({ wx: 0, wy: 0 }),
  null,
  "peek must not protect a sheet from eviction",
);

// Label tiers must rise with descent and never fall back mid-zoom.
const tierRank = { far: 0, mid: 1, near: 2 };
let previousTierRank = -1;
for (const zoom of [0.5, 1, 1.2, 1.34, 1.36, 2, 2.39, 2.41, 8, 64]) {
  const rank = tierRank[zoomLabelTier(zoom)];
  assert.ok(rank >= previousTierRank, "label tier must not fall as zoom rises (zoom " + zoom + ")");
  previousTierRank = rank;
}
assert.equal(zoomLabelTier(1), "far", "the fit view must keep its labels quiet");
assert.equal(zoomLabelTier(64), "near", "the deepest zoom must name the ground outright");
assert.equal(zoomLabelTier(Number.NaN), "far", "a broken zoom reading must fail quiet, not loud");

// ── the plane frame: one camera over a continuous world ───────────────

const atlasPlaneModule = loadTsModule("src/lib/atlas-plane.ts");
const {
  boundViewToBounds,
  cellAt,
  deepestTileAt,
  dynamicZoomFloor,
  exploredBounds,
  fitZoomForBounds,
  focusForSheet,
  placeChildRect,
  resolvePlaneEdgeTravel,
  viewForCenter,
  worldCenter,
} = atlasPlaneModule;

const atlasPyramidModule = loadTsModule("src/lib/atlas-pyramid.ts");
const {
  PYRAMID_DETAIL_MAGNIFICATION,
  PYRAMID_MAX_DEPTH,
  PYRAMID_PLANE_ZOOM_CEILING,
  PYRAMID_RATIO,
  demoteView,
  promotableTile,
  promoteRect,
  promoteTiles,
  promoteView,
  pyramidClipForFocus,
  pyramidLayerBlend,
  pyramidNeedsDetail,
  pyramidPerspective,
  pyramidZoomCeiling,
  tileCoversViewport,
  tileMagnification,
} = atlasPyramidModule;

const PLANE_METRICS = { width: 1200, height: 900, mapWidth: 1200, mapHeight: 900 };

// Camera round trip: centering on a world point and asking where the
// center is must return the same point, or every glide lands off-target.
{
  const point = { wx: 1.62, wy: -0.38 };
  const view = viewForCenter(PLANE_METRICS, point, 2.5);
  const back = worldCenter(view, PLANE_METRICS);
  assert.ok(
    Math.abs(back.wx - point.wx) < 1e-9 && Math.abs(back.wy - point.wy) < 1e-9,
    "viewForCenter and worldCenter must invert each other",
  );
}

// Cell resolution must floor, not truncate — the negative quadrants are
// real ground west and north of the origin.
assert.deepEqual(plain(cellAt({ wx: -0.2, wy: 1.7 })), { wx: -1, wy: 1 }, "cellAt must floor into the negative quadrant");
assert.deepEqual(plain(cellAt({ wx: 0.999, wy: -1.001 })), { wx: 0, wy: -2 }, "cellAt must floor on both axes");

// Explored bounds must cover every remembered cell and always include
// the cell the traveler stands on.
{
  const bounds = exploredBounds([{ wx: -1, wy: 0 }, { wx: 2, wy: 1 }], { wx: 0, wy: -1 });
  assert.deepEqual(plain(bounds), { x: -1, y: -1, width: 4, height: 3 }, "explored bounds must span all cells plus the standing one");
  const alone = exploredBounds([], { wx: 3, wy: 3 });
  assert.deepEqual(plain(alone), { x: 3, y: 3, width: 1, height: 1 }, "an empty world still bounds the standing cell");
}

// The overview floor falls as the world grows — a two-cell-wide plane
// fits at half the zoom of one cell — but never rises above the classic
// single-sheet fit.
{
  const one = { x: 0, y: 0, width: 1, height: 1 };
  const two = { x: 0, y: 0, width: 2, height: 1 };
  assert.equal(dynamicZoomFloor(one, PLANE_METRICS), 1, "a single explored cell keeps the fit-to-sheet floor");
  const floorTwo = dynamicZoomFloor(two, PLANE_METRICS);
  assert.ok(Math.abs(floorTwo - 0.5) < 1e-9, "a two-cell-wide world must survey at half zoom");
  assert.ok(
    Math.abs(fitZoomForBounds(two, PLANE_METRICS) * 2 - fitZoomForBounds(one, PLANE_METRICS)) < 1e-9,
    "doubling the bounds must halve the fit zoom on the limiting axis",
  );
}

// Camera clamping: the frame stops at the explored edges where the world
// overflows the viewport, and the world rides centered where it fits.
{
  const bounds = { x: 0, y: 0, width: 2, height: 1 };
  const clamped = boundViewToBounds({ x: 400, y: 0, zoom: 1 }, PLANE_METRICS, bounds, 0.5, 64);
  assert.equal(clamped.x, 0, "the camera must stop at the western explored edge");
  const east = boundViewToBounds({ x: -9999, y: 0, zoom: 1 }, PLANE_METRICS, bounds, 0.5, 64);
  assert.equal(east.x, PLANE_METRICS.width - 2 * PLANE_METRICS.mapWidth, "the camera must stop at the eastern explored edge");
  // height 1 * 900 = viewport height → vertical axis centers exactly
  assert.equal(clamped.y, 0, "a fitting axis must ride centered");
  const surveyed = boundViewToBounds({ x: 0, y: 0, zoom: 0.5 }, PLANE_METRICS, bounds, 0.5, 64);
  assert.equal(surveyed.zoom, 0.5, "the floor zoom must be reachable");
  assert.equal(surveyed.x, 0, "at the floor the surveyed world must span the frame");
  assert.ok(Math.abs(surveyed.y - (900 - 450) / 2) < 1e-9, "the shallower axis must center at the floor");
}

// The pyramid's placement law: a child drawn from the camera's focus
// must occupy ground containing the point the camera looks at.
{
  const sheetRect = { x: 1, y: 0, width: 1, height: 1 };
  const view = viewForCenter(PLANE_METRICS, { wx: 1.7, wy: 0.4 }, 3);
  const localFocus = focusForSheet(view, PLANE_METRICS, sheetRect);
  assert.ok(Math.abs(localFocus.x - 0.7) < 1e-9 && Math.abs(localFocus.y - 0.4) < 1e-9, "focus must be sheet-local");
  assert.ok(Math.abs(localFocus.zoom - 3) < 1e-9, "a root sheet's focus zoom is the camera zoom");
  const child = placeChildRect(sheetRect, pyramidClipForFocus(localFocus));
  assert.ok(
    child.x <= 1.7 && 1.7 <= child.x + child.width && child.y <= 0.4 && 0.4 <= child.y + child.height,
    "the child rect must contain the looked-at point",
  );
  assert.ok(child.x >= 1 && child.x + child.width <= 2, "the child must stay inside its parent sheet");
}

// The deepest tile wins, and only tiles actually under the point count.
{
  const root = { id: "root", rect: { x: 0, y: 0, width: 1, height: 1 }, level: 0, image: "r", phase: "final" };
  const child = { id: "child", rect: { x: 0.3, y: 0.3, width: 0.4, height: 0.4 }, level: 1, image: "c", phase: "final" };
  const elsewhere = { id: "far", rect: { x: 3, y: 3, width: 1, height: 1 }, level: 5, image: "f", phase: "final" };
  assert.equal(deepestTileAt([root, child, elsewhere], { wx: 0.5, wy: 0.5 })?.id, "child", "the deeper covering tile must win");
  assert.equal(deepestTileAt([root, child, elsewhere], { wx: 0.1, wy: 0.1 })?.id, "root", "a point outside the child falls to its parent");
  assert.equal(deepestTileAt([elsewhere], { wx: 0.5, wy: 0.5 }), null, "no covering tile means no ground");
}

// ── the pyramid: the law that keeps an endless zoom sharp ─────────────

// The pyramid's termination: a parent outrun at zoom 2 stops wanting
// detail once its half-width child lands under the camera.
{
  const parent = { x: 0, y: 0, width: 1, height: 1 };
  const child = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
  assert.equal(pyramidNeedsDetail(parent, 2), true, "a doubled zoom must outrun the root sheet");
  assert.equal(pyramidNeedsDetail(child, 2), false, "the landed child must satisfy the same zoom");
  assert.equal(pyramidNeedsDetail(child, 4), true, "outrunning the child asks for the next level down");
}

// The sharpness law, stated as arithmetic: a child is asked for at the
// detail threshold and lands at ratio × that of its own fit. If the ratio
// ever stopped being < 1/threshold, every landed child would already be
// magnified past the ceiling it exists to enforce, and the descent would
// compound blur instead of clearing it.
{
  const bornAt = PYRAMID_RATIO * PYRAMID_DETAIL_MAGNIFICATION;
  assert.ok(
    bornAt < 1,
    "a freshly landed child must be downsampled, not already stretched — otherwise the pyramid adds blur",
  );
  // ...and landing it must actually satisfy the camera that asked.
  const zoomThatAsked = PYRAMID_DETAIL_MAGNIFICATION;
  const childRect = { x: 0.25, y: 0.25, width: PYRAMID_RATIO, height: PYRAMID_RATIO };
  assert.equal(
    pyramidNeedsDetail(childRect, zoomThatAsked),
    false,
    "the child a zoom asked for must answer that zoom, or the pyramid never terminates",
  );
  assert.ok(
    Math.abs(tileMagnification(childRect, zoomThatAsked) - bornAt) < 1e-12,
    "magnification at birth must be ratio × threshold",
  );
}

// Twelve layers of real ground, and the camera never leaves the plane's
// own range. This is the whole claim of the descent: depth lives in the
// stack, not in a transform scale of four thousand.
{
  let span = 1;
  for (let layer = 0; layer < 12; layer += 1) span *= PYRAMID_RATIO;
  assert.ok(
    span * (1 / PYRAMID_RATIO) ** 12 === 1,
    "twelve promotions must be exactly twelve halvings of the ground",
  );
  assert.equal(
    pyramidZoomCeiling(11, 64),
    PYRAMID_PLANE_ZOOM_CEILING,
    "inside the pyramid a harder pinch buys deeper ground, not a stretched sheet",
  );
  assert.equal(
    pyramidZoomCeiling(PYRAMID_MAX_DEPTH, 64),
    64,
    "at the bottom of the descent the deep clamp — and the coast wall behind it — must open again",
  );
  assert.ok(PYRAMID_MAX_DEPTH >= 12, "the room promises twelve layers; the depth budget must exceed it");
}

// The clip is exactly the ratio, centered, and held inside the parent —
// a buffered clip shrinks by less than the ratio and flattens the pyramid
// until each generated layer buys almost no new detail.
{
  const middle = pyramidClipForFocus({ x: 0.5, y: 0.5 });
  assert.equal(middle.width, PYRAMID_RATIO, "a child must draw exactly the ratio of its parent's ground");
  assert.ok(Math.abs(middle.x - 0.25) < 1e-12, "a centered focus must centre the clip");
  const corner = pyramidClipForFocus({ x: 0.02, y: 0.99 });
  assert.equal(corner.x, 0, "a clip at the western edge must not run outside the parent");
  assert.ok(Math.abs(corner.y + corner.height - 1) < 1e-12, "a clip at the southern edge must stop at the parent's edge");
}

// The crossfade: a child is fully present at the magnification it was
// born at and gone once the camera has pulled well back, so an outer view
// never shows a hard rectangle of some other drawing floating on the
// parent.
{
  const child = { rect: { x: 0, y: 0, width: PYRAMID_RATIO, height: PYRAMID_RATIO }, level: 1 };
  const bornZoom = PYRAMID_DETAIL_MAGNIFICATION;
  assert.equal(pyramidLayerBlend(child, bornZoom), 1, "a child must be fully present at the zoom that asked for it");
  assert.equal(pyramidLayerBlend(child, bornZoom * 4), 1, "and stay present as the camera goes deeper");
  assert.equal(pyramidLayerBlend(child, bornZoom * 0.4), 0, "and be gone once the camera has pulled back past it");
  const mid = pyramidLayerBlend(child, bornZoom * 0.75);
  assert.ok(mid > 0 && mid < 1, "the fade must be a ramp, not a switch");
  assert.equal(
    pyramidLayerBlend({ rect: { x: 0, y: 0, width: 4, height: 4 }, level: -2 }, 0.01),
    1,
    "an ancestor is the floor under everything and never fades",
  );
}

// Promotion is a change of coordinates, not a move: the anchor becomes
// the unit cell and every screen position is preserved exactly. A bug
// here is a visible jolt on every single descent.
{
  const anchor = { x: 0.25, y: 0.5, width: 0.5, height: 0.5 };
  const view = { x: -340, y: -155, zoom: 2.4 };
  const promoted = promoteView(view, PLANE_METRICS, anchor);
  const screenOf = (v, wx, wy) => ({
    x: v.x + wx * PLANE_METRICS.mapWidth * v.zoom,
    y: v.y + wy * PLANE_METRICS.mapHeight * v.zoom,
  });
  for (const [wx, wy] of [[0.3, 0.55], [0.7, 0.9], [0.25, 0.5]]) {
    const before = screenOf(view, wx, wy);
    const rebased = promoteRect({ x: wx, y: wy, width: 0, height: 0 }, anchor);
    const after = screenOf(promoted, rebased.x, rebased.y);
    assert.ok(
      Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9,
      "promotion must not move a single point on screen",
    );
  }
  // ...and the ascent is its exact inverse, so descending and rising are
  // one reversible map rather than two lossy ones.
  const back = demoteView(promoted, PLANE_METRICS, anchor);
  assert.ok(
    Math.abs(back.x - view.x) < 1e-9
    && Math.abs(back.y - view.y) < 1e-9
    && Math.abs(back.zoom - view.zoom) < 1e-9,
    "demoteView must invert promoteView exactly",
  );
  assert.ok(Math.abs(promoted.zoom - view.zoom * anchor.width) < 1e-12, "promotion must rebase the zoom by the anchor's span");
}

// A promoted frame keeps its ancestors (they fill the margins until the
// new plane grows children of its own) and renumbers levels around the
// anchor, which is what lets the same detail logic run at any depth.
{
  const anchor = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
  const tiles = [
    { id: "root", rect: { x: 0, y: 0, width: 1, height: 1 }, level: 0, image: "r", phase: "final" },
    { id: "kid", rect: anchor, level: 1, image: "k", phase: "final" },
    { id: "gone", rect: { x: 8, y: 8, width: 1, height: 1 }, level: 0, image: "g", phase: "final" },
  ];
  const promoted = promoteTiles(tiles, anchor, 1);
  const byId = Object.fromEntries(promoted.map((tile) => [tile.id, tile]));
  assert.ok(byId.kid, "the promoted child must survive as the plane's own ground");
  assert.equal(byId.kid.level, 0, "the anchor becomes level zero");
  assert.deepEqual(
    plain(byId.kid.rect),
    { x: 0, y: 0, width: 1, height: 1 },
    "the anchor becomes the unit cell exactly",
  );
  assert.equal(byId.root.level, -1, "the parent stays mounted as an ancestor beneath it");
  assert.equal(byId.root.rect.width, 2, "and spans twice the promoted sheet, as a halving implies");
  assert.equal(byId.gone, undefined, "ground far outside the promoted neighbourhood is left to the descent stack");
}

// Promotion waits for the child to own the whole viewport. That is what
// makes the rebased camera legal without a re-centring snap — and it is
// why promoting cannot leave an empty margin on screen.
{
  const cover = { x: 0, y: 0, width: 1, height: 1 };
  const covering = { x: 0, y: 0, zoom: 1 };
  assert.equal(tileCoversViewport(cover, covering, PLANE_METRICS), true, "a fitted cell covers the frame");
  assert.equal(
    tileCoversViewport(cover, { x: 0, y: 0, zoom: 0.6 }, PLANE_METRICS),
    false,
    "a cell smaller than the frame leaves margin and must not promote",
  );
  const tiles = [
    { id: "root", rect: cover, level: 0, image: "r", phase: "final" },
    { id: "small", rect: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, level: 1, image: "s", phase: "final" },
  ];
  assert.equal(
    promotableTile(tiles, covering, PLANE_METRICS),
    null,
    "a child that does not yet fill the frame is not promotable",
  );
  // Zoom in until that half-width child fills the frame: view centred on it.
  const zoomed = { x: -0.25 * PLANE_METRICS.mapWidth * 2, y: -0.25 * PLANE_METRICS.mapHeight * 2, zoom: 2 };
  assert.equal(
    promotableTile(tiles, zoomed, PLANE_METRICS)?.id,
    "small",
    "once the child owns the viewport it becomes the plane",
  );
  assert.equal(
    promotableTile([tiles[0]], zoomed, PLANE_METRICS),
    null,
    "the plane's own ground is already where it belongs and never promotes itself",
  );
}

// The descent must change what kind of map this is, not only how sharp
// it is: twelve renderings of the same continental survey is a slideshow.
{
  const registers = new Set();
  for (let depth = 0; depth < 12; depth += 1) registers.add(pyramidPerspective(depth));
  assert.equal(registers.size, 12, "each of the twelve promised layers must name a different cartographic register");
  assert.equal(
    pyramidPerspective(400),
    pyramidPerspective(11),
    "past the ladder's end the deepest register must hold, not fall off the end",
  );
  const clause = formatAtlasPerspectiveClause(5);
  assert.ok(clause.includes(pyramidPerspective(5)), "the generator must be told which register this sheet is");
  assert.match(clause, /5 zoom layers below/, "and how deep it stands");
}

// The ceiling promotion removes, kept here so it cannot creep back in.
// A same-plane pyramid compounds: each child's rect shrinks by the ratio,
// so the zoom needed to outrun it again grows geometrically, and past a
// handful of levels it exceeds anything the camera can ever reach — the
// room's real "goes blurry and never gets crisp again" failure.
{
  const MAX_ZOOM = 64;
  let rect = { x: 0, y: 0, width: 1, height: 1 };
  let reachedLevel = 0;
  for (let level = 0; level < 40; level += 1) {
    const neededZoom = PYRAMID_DETAIL_MAGNIFICATION / rect.width;
    if (neededZoom > MAX_ZOOM) break;
    reachedLevel = level + 1;
    rect = placeChildRect(rect, pyramidClipForFocus({ x: 0.5, y: 0.5 }));
  }
  assert.ok(
    reachedLevel < 13,
    "an unbounded same-plane pyramid must hit its zoom ceiling well short of level 13 — this is the failure promotion exists to remove",
  );
}

// ...and the same sequence, promoted. Re-expressing the frame around each
// child that takes the viewport puts the required zoom back where it
// started, so it never grows at all: sixty-four levels stay inside the
// plane's own ceiling, with the camera's numbers exact at every one.
{
  const metrics = PLANE_METRICS;
  let rect = { x: 0, y: 0, width: 1, height: 1 };
  let view = viewForCenter(metrics, { wx: 0.5, wy: 0.5 }, 1);
  let worstZoom = 0;
  for (let level = 0; level < 64; level += 1) {
    // Press in until the ground under the camera wants a deeper drawing.
    view = viewForCenter(
      metrics,
      { wx: rect.x + rect.width / 2, wy: rect.y + rect.height / 2 },
      PYRAMID_DETAIL_MAGNIFICATION / rect.width,
    );
    worstZoom = Math.max(worstZoom, view.zoom);
    assert.ok(
      view.zoom <= pyramidZoomCeiling(level, 64) + 1e-9,
      `level ${level} must stay reachable inside the plane's own ceiling once promotion is honored`,
    );
    const child = placeChildRect(rect, pyramidClipForFocus({ x: 0.5, y: 0.5 }));
    // Deepen, then promote once the child owns the frame — the frame
    // re-expression is what resets the requirement instead of compounding it.
    view = viewForCenter(metrics, { wx: child.x + child.width / 2, wy: child.y + child.height / 2 }, 1 / child.width);
    assert.ok(tileCoversViewport(child, view, metrics), `level ${level} child must own the frame before promotion`);
    view = promoteView(view, metrics, child);
    rect = promoteRect(child, child);
  }
  assert.ok(
    worstZoom <= PYRAMID_PLANE_ZOOM_CEILING,
    `sixty-four promoted levels must never ask the camera past the plane ceiling; asked ${worstZoom.toFixed(2)}`,
  );
}

// Frontier travel: only pressing past the explored edge asks for new
// ground; panning across the interior of the surveyed world does not.
{
  const bounds = { x: 0, y: 0, width: 2, height: 1 };
  const margin = 120;
  const interior = resolvePlaneEdgeTravel({ x: -600, y: 0, zoom: 1 }, PLANE_METRICS, bounds, { x: 40, y: 0 }, margin);
  assert.equal(interior, null, "a fast pan through the interior of explored ground must not travel");
  const west = resolvePlaneEdgeTravel({ x: 60, y: 0, zoom: 1 }, PLANE_METRICS, bounds, { x: 20, y: 0 }, margin);
  assert.equal(west, "west", "pressing past the western frontier must travel west");
  const east = resolvePlaneEdgeTravel({ x: PLANE_METRICS.width - 2 * PLANE_METRICS.mapWidth - 60, y: 0, zoom: 1 }, PLANE_METRICS, bounds, { x: -20, y: 0 }, margin);
  assert.equal(east, "east", "pressing past the eastern frontier must travel east");
}

console.log("atlas generation contract ok: parser, navigation metadata, dark route, world chart, and plane frame");
