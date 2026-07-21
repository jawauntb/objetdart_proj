import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  AtlasGenerationError,
  AtlasProviderConfigurationError,
  AtlasRequestError,
  atlasOperationForRequest,
  createAtlasGenerationContext,
  generateAtlasImage,
  parseAtlasGenerationRequest,
  resolveAtlasPhaseProviderConfig,
  type AtlasGenerationPhase,
  type AtlasGenerationRequest,
  type AtlasProviderConfig,
} from "@/lib/atlas-generation";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const MAX_REQUEST_BODY_CHARS = 8_500_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_REQUESTS = 16;
const RATE_LIMIT_CONCURRENT = 2;
const RATE_LIMIT_MAX_CLIENTS = 1_024;

type RateLimitRecord = {
  active: number;
  requests: number[];
  touchedAt: number;
};

type RateLimitResult = {
  allowed: boolean;
  retryAfter: number;
  release: () => void;
};

const rateLimits = new Map<string, RateLimitRecord>();

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return json({ error: { code: "unsupported_media_type", message: "send a JSON request" } }, 415);
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_CHARS) {
    return json({ error: { code: "request_too_large", message: "atlas request is too large" } }, 413);
  }

  const slot = acquireRateLimitSlot(clientKey(request));
  if (!slot.allowed) {
    return json(
      { error: { code: "rate_limited", message: "the atlas needs a moment before another redraw" } },
      429,
      { "Retry-After": String(slot.retryAfter) },
    );
  }

  try {
    const phase = parseGenerationPhase(request);
    const generationId = resolveGenerationId(request);
    const parsedBody = await readJsonBody(request);
    const input = parseAtlasGenerationRequest(parsedBody);
    let providerConfig: AtlasProviderConfig;
    try {
      providerConfig = resolveAtlasPhaseProviderConfig(process.env, phase);
    } catch (error) {
      if (error instanceof AtlasProviderConfigurationError) {
        console.error("invalid Atlas image provider configuration");
        return configurationErrorResponse(input, phase, generationId);
      }
      throw error;
    }

    if (!atlasGenerationEnabled()) {
      return demoResponse(input, providerConfig, phase, generationId, "generation_disabled");
    }
    if (!providerConfig.apiKey) {
      return demoResponse(input, providerConfig, phase, generationId, "missing_api_key");
    }

    try {
      const result = await generateAtlasImage(input, providerConfig, request.signal);
      return json(
        {
          ...result,
          generation: {
            ...result.generation,
            phase,
            generationId,
          },
        },
        200,
      );
    } catch (error) {
      if (error instanceof AtlasRequestError) {
        return json({ error: { code: error.code, message: error.message } }, 400);
      }
      if (error instanceof AtlasProviderConfigurationError) {
        console.error("invalid Atlas image provider configuration");
        return configurationErrorResponse(input, phase, generationId);
      }
      if (error instanceof AtlasGenerationError) {
        console.warn("atlas image generation failed", {
          code: error.code,
          status: error.httpStatus,
          requestId: error.requestId,
        });
        const context = createAtlasGenerationContext(input.prompt);
        const headers = error.retryAfter ? { "Retry-After": normalizeRetryAfter(error.retryAfter) } : undefined;
        return json(
          {
            dataUrl: null,
            ...context,
            generation: {
              status: "error",
              provider: providerConfig.provider,
              model: providerConfig.model,
              operation: atlasOperationForRequest(input),
              mode: input.mode,
              phase,
              generationId,
              reason: error.code,
              requestId: error.requestId,
            },
            error: { code: error.code, message: error.message },
          },
          error.httpStatus,
          headers,
        );
      }
      console.error("unexpected atlas generation error", error instanceof Error ? error.name : "unknown");
      return json(
        {
          dataUrl: null,
          ...createAtlasGenerationContext(input.prompt),
          generation: {
            status: "error",
            provider: providerConfig.provider,
            model: providerConfig.model,
            operation: atlasOperationForRequest(input),
            mode: input.mode,
            phase,
            generationId,
            reason: "internal_error",
            requestId: null,
          },
          error: { code: "internal_error", message: "the atlas could not be redrawn" },
        },
        500,
      );
    }
  } catch (error) {
    if (error instanceof AtlasRequestError) {
      const status = error.code === "request_too_large" ? 413 : 400;
      return json({ error: { code: error.code, message: error.message } }, status);
    }
    return json({ error: { code: "bad_request", message: "request body must be valid JSON" } }, 400);
  } finally {
    slot.release();
  }
}

async function readJsonBody(request: Request): Promise<unknown> {
  const rawBody = await request.text();
  if (!rawBody || rawBody.length > MAX_REQUEST_BODY_CHARS) {
    throw new AtlasRequestError(
      rawBody ? "request_too_large" : "invalid_request",
      rawBody ? "atlas request is too large" : "request body is required",
    );
  }
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw new AtlasRequestError("bad_request", "request body must be valid JSON");
  }
}

function parseGenerationPhase(request: Request): AtlasGenerationPhase {
  const phase = new URL(request.url).searchParams.get("phase");
  if (phase == null || phase === "" || phase === "final") return "final";
  if (phase === "preview") return phase;
  throw new AtlasRequestError("invalid_phase", "phase must be preview or final");
}

function resolveGenerationId(request: Request): string {
  const candidate = request.headers.get("x-atlas-generation-id")?.trim() ?? "";
  return /^[A-Za-z0-9_-]{8,80}$/.test(candidate) ? candidate : `atlas-${randomUUID()}`;
}

function demoResponse(
  input: AtlasGenerationRequest,
  providerConfig: AtlasProviderConfig,
  phase: AtlasGenerationPhase,
  generationId: string,
  reason: "generation_disabled" | "missing_api_key",
) {
  return json(
    {
      dataUrl: null,
      ...createAtlasGenerationContext(input.prompt),
      generation: {
        status: "demo",
        provider: providerConfig.provider,
        model: providerConfig.model,
        operation: atlasOperationForRequest(input),
        mode: input.mode,
        phase,
        generationId,
        reason,
        requestId: null,
      },
    },
    200,
  );
}

function configurationErrorResponse(
  input: AtlasGenerationRequest,
  phase: AtlasGenerationPhase,
  generationId: string,
) {
  return json(
    {
      dataUrl: null,
      ...createAtlasGenerationContext(input.prompt),
      generation: {
        status: "error",
        provider: "unconfigured",
        model: null,
        operation: atlasOperationForRequest(input),
        mode: input.mode,
        phase,
        generationId,
        reason: "invalid_provider_configuration",
        requestId: null,
      },
      error: {
        code: "invalid_provider_configuration",
        message: "the Atlas image provider is not configured",
      },
    },
    503,
  );
}

function atlasGenerationEnabled(): boolean {
  return /^(?:1|true|yes)$/i.test(process.env.ATLAS_GENERATION_ENABLED?.trim() ?? "");
}

function json(body: unknown, status: number, headers?: Record<string, string>) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      ...headers,
    },
  });
}

function acquireRateLimitSlot(key: string): RateLimitResult {
  const now = Date.now();
  pruneRateLimits(now);
  const record = rateLimits.get(key) ?? { active: 0, requests: [], touchedAt: now };
  record.requests = record.requests.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
  record.touchedAt = now;
  rateLimits.set(key, record);

  if (record.active >= RATE_LIMIT_CONCURRENT) {
    return { allowed: false, retryAfter: 2, release: () => undefined };
  }
  if (record.requests.length >= RATE_LIMIT_REQUESTS) {
    const waitMs = Math.max(1_000, RATE_LIMIT_WINDOW_MS - (now - record.requests[0]));
    return { allowed: false, retryAfter: Math.ceil(waitMs / 1_000), release: () => undefined };
  }

  record.requests.push(now);
  record.active += 1;
  let released = false;
  return {
    allowed: true,
    retryAfter: 0,
    release: () => {
      if (released) return;
      released = true;
      record.active = Math.max(0, record.active - 1);
      record.touchedAt = Date.now();
    },
  };
}

function pruneRateLimits(now: number): void {
  if (rateLimits.size < RATE_LIMIT_MAX_CLIENTS) return;
  for (const [key, record] of rateLimits) {
    if (record.active === 0 && now - record.touchedAt > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimits.delete(key);
    }
  }
  if (rateLimits.size >= RATE_LIMIT_MAX_CLIENTS) {
    const oldestInactive = [...rateLimits.entries()]
      .filter(([, record]) => record.active === 0)
      .sort((a, b) => a[1].touchedAt - b[1].touchedAt)
      .slice(0, Math.ceil(RATE_LIMIT_MAX_CLIENTS / 4));
    for (const [key] of oldestInactive) rateLimits.delete(key);
  }
}

function clientKey(request: Request): string {
  const candidate = request.headers.get("x-real-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]
    ?? "anonymous";
  const normalized = candidate.trim().slice(0, 64);
  return /^[A-Fa-f0-9:.]+$/.test(normalized) ? normalized : "anonymous";
}

function normalizeRetryAfter(value: string): string {
  const seconds = Number.parseInt(value, 10);
  return String(Number.isFinite(seconds) ? Math.max(1, Math.min(3_600, seconds)) : 5);
}
