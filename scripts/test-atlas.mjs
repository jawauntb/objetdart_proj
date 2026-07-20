import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import * as ts from "typescript";

const rootUrl = new URL("../", import.meta.url);

function loadTsModule(path, requireMap = {}, globals = {}) {
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
      throw new Error(`Unexpected require(${id}) while loading ${path}`);
    },
  };
  vm.runInNewContext(code, sandbox, { filename });
  return module.exports;
}

const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nOQAAAAASUVORK5CYII=";
const FAKE_WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(20)]).toString("base64");
const SOURCE_PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("atlas-canonical-source"),
]);
const SOURCE_PNG = SOURCE_PNG_BYTES.toString("base64");
const providerCalls = [];
let failKleinPreview = false;

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

const atlasModule = loadTsModule("src/lib/atlas-generation.ts", {
  "server-only": {},
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
      return new Response(JSON.stringify({
        data: [{ b64_json: FAKE_WEBP }],
        usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
      }), {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": "openai-test-request" },
      });
    }
    if (url === "https://api.openai.com/v1/images/edits") {
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
  createAtlasGenerationContext,
  generateAtlasImage,
  parseAtlasGenerationRequest,
  resolveAtlasPhaseProviderConfig,
  resolveAtlasProviderConfig,
} = atlasModule;
const { SITE_ROUTE_BY_KEY, isDarkRoutePath } = routesModule;

const parsed = plain(parseAtlasGenerationRequest({
  prompt: "  fire   forest  ",
  viewport: { width: 390, height: 844 },
  mode: "generate",
}));
assert.equal(parsed.prompt, "fire forest", "concept prompts should be normalized and accepted");
assert.deepEqual(parsed.viewport, { width: 390, height: 844 }, "valid mobile viewports should survive parsing");
assert.equal(parsed.mode, "generate", "generate should remain the canonical mode");

const defaultProviderConfig = resolveAtlasProviderConfig({ OPENAI_API_KEY: "openai-test-key" });
const defaultProvider = plain(defaultProviderConfig);
assert.equal(defaultProvider.provider, "openai", "OpenAI should remain the default Atlas provider");
assert.equal(defaultProvider.model, "gpt-image-2", "the OpenAI adapter should pin GPT Image 2");

const generatedWithOpenAI = plain(await generateAtlasImage(
  parseAtlasGenerationRequest({ prompt: "fire forest", mode: "generate" }),
  defaultProviderConfig,
));
assert.equal(generatedWithOpenAI.generation.provider, "openai", "the default adapter should return OpenAI metadata");
assert.match(generatedWithOpenAI.dataUrl, /^data:image\/webp;base64,/, "GPT Image output should retain WebP media type");
const openAICall = providerCalls.find((call) => call.url === "https://api.openai.com/v1/images/generations");
const openAIBody = JSON.parse(openAICall.init.body);
assert.equal(openAIBody.model, "gpt-image-2", "OpenAI generation should pin GPT Image 2");
assert.equal(openAIBody.output_format, "webp", "OpenAI generation should request compact WebP output");

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

assertRequestError(
  () => resolveAtlasProviderConfig({}, "untrusted-provider"),
  "invalid_provider_configuration",
  "unknown provider configuration must be rejected rather than reflected or silently selected",
);

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

await generateAtlasImage(
  parseAtlasGenerationRequest({
    prompt: "fire forest",
    currentImage: `data:image/png;base64,${ONE_PIXEL_PNG}`,
    focus: { x: 0.4, y: 0.6, zoom: 2 },
    mode: "zoom",
  }),
  openRouterProvider,
);
const openRouterCalls = providerCalls.filter((call) => call.url === "https://openrouter.ai/api/v1/images");
const editCall = openRouterCalls.find((call) => Array.isArray(JSON.parse(call.init.body).input_references));
const editBody = JSON.parse(editCall.init.body);
assert.equal(editBody.input_references.length, 1, "OpenRouter edits should send one current-map reference");
assert.equal(editBody.input_references[0].type, "image_url", "current maps should use image_url references");
assert.match(
  editBody.input_references[0].image_url.url,
  /^data:image\/png;base64,/,
  "current maps should remain private bounded data URLs",
);

const progressiveRoute = loadAtlasRoute({
  ATLAS_GENERATION_ENABLED: "true",
  ATLAS_IMAGE_PROVIDER: "openai",
  OPENAI_API_KEY: "openai-test-key",
  OPENROUTER_API_KEY: "openrouter-test-key",
});
const canonicalInteractionId = "atlas-canonical-interaction-001";
const canonicalBody = JSON.stringify({
  prompt: "fire forest",
  currentImage: `data:image/png;base64,${SOURCE_PNG}`,
  viewport: { width: 390, height: 844 },
  focus: { x: 0.42, y: 0.58, zoom: 2.5 },
  mode: "zoom",
});
const progressiveCallsStart = providerCalls.length;
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
assert.equal(finalResponse.status, 200, "the GPT final should resolve independently");
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
assert.ok(canonicalFinalCall, "the final phase should edit with GPT Image 2");
const canonicalPreviewBody = JSON.parse(canonicalPreviewCall.init.body);
assert.equal(
  canonicalPreviewBody.input_references[0].image_url.url,
  `data:image/png;base64,${SOURCE_PNG}`,
  "the preview should use the canonical current map",
);
const finalImageEntry = [...canonicalFinalCall.init.body.entries()].find(([, value]) => value instanceof Blob);
assert.ok(finalImageEntry, "the final edit should upload the canonical current map");
const finalSourceBytes = Buffer.from(await finalImageEntry[1].arrayBuffer());
assert.deepEqual(finalSourceBytes, SOURCE_PNG_BYTES, "the final must start from the canonical map, not the Klein preview");
assert.notDeepEqual(finalSourceBytes, Buffer.from(ONE_PIXEL_PNG, "base64"), "the preview output must never become GPT's edit source");
assert.equal(
  canonicalFinalCall.init.body.get("prompt"),
  canonicalPreviewBody.prompt,
  "preview and final should share one canonical server-composed prompt",
);

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
  ATLAS_IMAGE_PROVIDER: "openai",
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

console.log("atlas generation contract ok: parser, navigation metadata, and dark route");
