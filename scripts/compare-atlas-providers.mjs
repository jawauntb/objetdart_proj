import { randomUUID } from "node:crypto";
import * as fsPromises from "node:fs/promises";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as pathModule from "node:path";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import * as ts from "typescript";

const rootUrl = new URL("../", import.meta.url);

async function loadAtlasModuleAsync() {
  const filename = fileURLToPath(new URL("src/lib/atlas-generation.ts", rootUrl));
  const source = await readFile(filename, "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  const requireMap = {
    "server-only": {},
    "node:fs/promises": fsPromises,
    "node:path": pathModule,
  };
  const sandbox = {
    module,
    exports: module.exports,
    Object,
    AbortController,
    Blob,
    Buffer,
    DOMException,
    FormData,
    Response,
    clearTimeout,
    fetch,
    process,
    setTimeout,
    require: (id) => {
      if (id in requireMap) return requireMap[id];
      throw new Error(`Unexpected server module ${id}`);
    },
  };
  vm.runInNewContext(code, sandbox, { filename });
  return module.exports;
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") return { help: true };
    if (!["--prompt", "--out", "--width", "--height", "--source"].includes(flag)) {
      throw new Error(`unknown option: ${flag}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    options[flag.slice(2)] = value;
    index += 1;
  }

  if (!options.prompt) throw new Error("--prompt is required");
  if (!options.out) throw new Error("--out is required");
  if ((options.width == null) !== (options.height == null)) {
    throw new Error("--width and --height must be supplied together");
  }

  const viewport = options.width == null
    ? { width: 1024, height: 1024 }
    : {
        width: parsePositiveInteger(options.width, "--width"),
        height: parsePositiveInteger(options.height, "--height"),
      };
  return {
    help: false,
    prompt: options.prompt,
    outputRoot: resolve(options.out),
    viewport,
    source: options.source,
  };
}

function parsePositiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function usage() {
  return [
    "Compare Atlas image providers with the same server-composed prompt.",
    "",
    "Usage:",
    "  npm run compare:atlas-providers -- --prompt \"fire forest\" --out /tmp/atlas-provider-comparison [--width 390 --height 844]",
    "  npm run compare:atlas-providers -- --prompt \"fire forest · ember citadel\" --source /atlas/atlas-origin.webp --out /tmp/atlas-provider-edit-comparison",
    "",
    "Required environment:",
    "  OPENAI_API_KEY",
    "  OPENROUTER_API_KEY",
    "",
    "This command makes one paid generation request to each provider concurrently.",
  ].join("\n");
}

function dataUrlBytes(dataUrl) {
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw new Error("provider result was not a supported image data URL");
  return { mediaType: match[1], bytes: Buffer.from(match[2], "base64") };
}

function imageExtension(mediaType) {
  if (mediaType === "image/png") return ".png";
  if (mediaType === "image/jpeg") return ".jpg";
  if (mediaType === "image/webp") return ".webp";
  throw new Error("unsupported image media type");
}

function imageDimensions(bytes, mediaType) {
  if (mediaType === "image/png" && bytes.length >= 24) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (mediaType === "image/jpeg") return jpegDimensions(bytes);
  if (mediaType === "image/webp") return webpDimensions(bytes);
  return null;
}

function jpegDimensions(bytes) {
  let offset = 2;
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if (startOfFrame.has(marker) && segmentLength >= 7) {
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    offset += segmentLength;
  }
  return null;
}

function webpDimensions(bytes) {
  if (bytes.length < 30 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") {
    return null;
  }
  const chunk = bytes.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3),
    };
  }
  if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const b1 = bytes[21];
    const b2 = bytes[22];
    const b3 = bytes[23];
    const b4 = bytes[24];
    return {
      width: 1 + (((b2 & 0x3f) << 8) | b1),
      height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
    };
  }
  return null;
}

function safeFailure(error) {
  return {
    code: typeof error?.code === "string" ? error.code : "comparison_failed",
    message: error instanceof Error ? error.message : "provider comparison failed",
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const atlasModule = await loadAtlasModuleAsync();
  const { generateAtlasImage, parseAtlasGenerationRequest, resolveAtlasProviderConfig } = atlasModule;
  const providerConfigs = ["openai", "openrouter"].map((provider) => (
    resolveAtlasProviderConfig(process.env, provider)
  ));
  const missingProviders = providerConfigs.filter((config) => !config.apiKey).map((config) => config.provider);
  if (missingProviders.length > 0) {
    const missingVariables = missingProviders.map((provider) => (
      provider === "openai" ? "OPENAI_API_KEY" : "OPENROUTER_API_KEY"
    ));
    throw new Error(`missing required environment: ${missingVariables.join(", ")}`);
  }

  const request = parseAtlasGenerationRequest({
    prompt: options.prompt,
    viewport: options.viewport,
    ...(options.source
      ? {
          currentImage: options.source,
          focus: { x: 0.5, y: 0.5, zoom: 2.4 },
          mode: "zoom",
        }
      : { mode: "generate" }),
  });
  await mkdir(options.outputRoot, { recursive: true });
  const runDirectory = resolve(options.outputRoot, `atlas-${Date.now()}-${randomUUID().slice(0, 8)}`);
  await mkdir(runDirectory, { recursive: false });
  const startedAt = new Date().toISOString();

  const settled = await Promise.allSettled(providerConfigs.map(async (config) => {
    const providerStartedAt = Date.now();
    const result = await generateAtlasImage(request, config);
    const image = dataUrlBytes(result.dataUrl);
    const filename = `${config.provider}${imageExtension(image.mediaType)}`;
    const outputPath = resolve(runDirectory, filename);
    await writeFile(outputPath, image.bytes, { flag: "wx" });
    return {
      status: "generated",
      provider: config.provider,
      model: config.model,
      durationMs: Date.now() - providerStartedAt,
      file: basename(outputPath),
      mediaType: image.mediaType,
      byteLength: image.bytes.length,
      dimensions: imageDimensions(image.bytes, image.mediaType),
      requestedSize: result.generation.size,
      requestId: result.generation.requestId,
      usage: result.generation.usage,
    };
  }));

  const results = settled.map((entry, index) => {
    if (entry.status === "fulfilled") return entry.value;
    const config = providerConfigs[index];
    return {
      status: "failed",
      provider: config.provider,
      model: config.model,
      error: safeFailure(entry.reason),
    };
  });
  const metadata = {
    schemaVersion: 1,
    prompt: request.prompt,
    viewport: request.viewport,
    mode: request.mode,
    source: request.currentImage ?? null,
    startedAt,
    completedAt: new Date().toISOString(),
    results,
  };
  const metadataPath = resolve(runDirectory, "comparison.json");
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ outputDirectory: runDirectory, ...metadata }, null, 2));

  if (settled.some((entry) => entry.status === "rejected")) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "provider comparison failed");
  process.exitCode = 1;
});
