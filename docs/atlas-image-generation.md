# Atlas image generation

Status: v1 GPT Image 2 default with a live OpenRouter adapter already wired for six switchable models. Flip `ATLAS_IMAGE_PROVIDER` in the deploy environment to change the final-phase provider without a code change.

Last verified against the live provider documentation and OpenRouter model-discovery endpoints: **2026-08-04**.

## Decision summary

- **V1 provider:** OpenAI's Image API with `gpt-image-2`.
- **V1 whole-map flow:** a person enters only a concept such as `fire forest`; Atlas turns that into an internal art-direction prompt and generates one complete map image.
- **Refinement flow:** a lateral shift or an in-place refine may send the current rendered map as the image input. **Zoom never does.** Every deeper layer is drawn natively from coordinates (`atlasOperationForRequest` returns `generation` for `mode: "zoom"`), because editing the on-screen bitmap upsamples whatever softness the preview left and compounds it at every depth. See "Progressive descent" below for the geometry this feeds.
- **Immediate interaction:** pan, zoom, and fold happen on the client immediately. They do not wait for generation and remain available if generation fails.
- **UI boundary:** there is no visible coordinate editor, provider picker, model picker, or prompt-engineering panel. Coordinates/transforms may exist as private client state, but the only creative text input is the concept.
- **Live OpenRouter adapter:** `generateWithOpenRouter` in `src/lib/atlas-generation.ts` is wired and exercised in tests. It targets `POST https://openrouter.ai/api/v1/images` and accepts any model in `OPENROUTER_MODEL_ALLOWLIST`. The current allowlist is:
  - `black-forest-labs/flux.2-klein-4b` — the preview draft (always used, regardless of final selector)
  - `black-forest-labs/flux.2-pro` — BFL midweight
  - `black-forest-labs/flux.2-flex` — BFL latency-optimized sibling of Pro
  - `black-forest-labs/flux.2-max` — BFL quality upgrade over Pro (slower)
  - `google/gemini-3.1-flash-image` (Nano Banana 2) — Google's flash-tier image model; ~90% of OpenRouter image traffic
  - `bytedance-seed/seedream-4.5` — ByteDance's flagship, flat $0.04/image, painterly bent

## V1 experience and failure behavior

1. The empty state asks for one concept, for example `fire forest`.
2. The server expands that concept into the Atlas visual contract and calls `gpt-image-2` for a whole-map image.
3. The returned image becomes the current Atlas surface.
4. Dragging, pinching/wheeling, and folding transform the current surface locally and instantly.
5. A later “regenerate” or “make this view” action exports the current rendered view as an image and sends that image plus the original concept to the server. The server uses the image-edit path; the person never edits numeric coordinates.
6. While generation is pending, the existing surface stays interactive. On timeout, moderation block, quota error, or provider outage, Atlas keeps the current image and offers a retry instead of replacing the map with an empty/error screen.

This deliberately separates **fast navigation** from **slow synthesis**. Generation enriches the map; it is not required for every gesture.

## Progressive descent — how a sheet stays sharp

`src/lib/atlas-pyramid.ts` owns this, and `scripts/test-atlas.mjs` pins it. The
whole mechanism is two moves:

1. **Detail.** When the camera magnifies the deepest drawing past
   `PYRAMID_DETAIL_MAGNIFICATION` (1.15), the client asks for a child sheet of
   exactly **half** the ground (`PYRAMID_RATIO`), centered on what the camera
   is looking at. Half the ground with the same pixel budget is four times the
   density, so the child lands already downsampled — it is the sharper drawing
   from the instant it arrives, not after some later refinement.
   `pyramidLayerBlend` dissolves it in against the live `--atlas-zoom`, and a
   ~5.5% feathered mask keeps the join from reading as a seam.
2. **Promotion.** The moment that child covers the whole viewport, the frame is
   re-expressed around it: the child becomes the unit cell, its ancestors keep
   their places at negative levels, and the camera's numbers are rewritten so
   nothing moves on screen. `promoteView` and `demoteView` are exact inverses,
   so pulling back out at the plane's floor climbs the same stair upward and
   lands where the descent left.

Promotion is what makes the descent endless. Camera zoom never leaves roughly
[1, 8] (`pyramidZoomCeiling`) however deep the traveler goes — depth lives in
the descent stack, not in a transform scale of four thousand where CSS
sub-pixel geometry and compositor precision both fail. Twelve layers of real,
natively drawn ground cost twelve promotions and no precision at all;
`PYRAMID_MAX_DEPTH` allows twenty-four, and only there does the deep clamp —
and the band wall toward `/coast` behind it — come back into reach.

Descending also changes **what kind of map this is**. `pyramidPerspective`
walks a fixed ladder — continental survey → region → district → settlement →
quarter → block → room → object → surface → microscopy → lattice → grain — and
`formatAtlasPerspectiveClause` tells the generator both the register and how
many layers below the outer chart this sheet stands. Without it, twelve layers
would be twelve renderings of the same coastline.

`npm run smoke:atlas-descent -- http://127.0.0.1:3210` drives this in a real
browser against a stubbed generator: it descends twelve layers, asserts the
camera never leaves the plane's range, and measures the magnification of the
deepest drawing actually under the middle of the stage.

## Provider-neutral server boundary (proposed Atlas contract)

The browser must call one Atlas-owned route, not OpenAI or OpenRouter directly. The route chooses the provider from server configuration and normalizes provider output.

Proposed future file boundary:

```text
src/app/api/atlas-image/route.ts
  -> validates the Atlas request and owns user-safe errors
  -> calls one AtlasImageProvider

src/lib/atlas-image/provider.ts
  -> provider-neutral request/result types

src/lib/atlas-image/providers/openai.ts
  -> v1 gpt-image-2 generation and edit adapter

src/lib/atlas-image/providers/openrouter.ts
  -> future OpenRouter image adapter
```

The exact names are placeholders until implementation. The important constraint is that provider/model selection remains server-side.

```ts
type AtlasImageIntent = "generate" | "regenerate";

type AtlasImageRequest = {
  concept: string;
  intent: AtlasImageIntent;
  // Present for regeneration. This is the already-rendered current view,
  // so the provider does not need user-visible x/y/zoom controls.
  currentImage?: {
    dataUrl: string;
  };
};

type AtlasImageArtifact = {
  base64: string;
  mediaType: string;
  provider: "openai" | "openrouter";
  model: string;
};

interface AtlasImageProvider {
  generate(request: AtlasImageRequest): Promise<AtlasImageArtifact>;
}
```

Route-level rules:

- Accept `concept`, `intent`, and an optional current image; do not accept a client-supplied provider, model ID, raw upstream prompt, or API key.
- Validate concept length and image type/size before making a paid request.
- Add the visual-system prompt on the server so all providers receive the same composition requirements.
- Normalize every provider response into one artifact shape before returning it to the client.
- Keep upstream error details and request IDs in server logs; return stable, non-sensitive error codes to the browser.
- Put provider/model metadata in telemetry, not in the creative UI.

## V1 OpenAI adapter: verified facts

OpenAI documents `gpt-image-2` as its current default/state-of-the-art image model, accepting text and image input and producing image output. For a single generation or edit, OpenAI recommends the Image API:

- Whole-map generation: `POST https://api.openai.com/v1/images/generations` with `model: "gpt-image-2"` and `prompt`.
- Current-image regeneration: `POST https://api.openai.com/v1/images/edits` as multipart form data with `model=gpt-image-2`, `image[]`, and `prompt`.
- Both paths return base64 image data at `data[0].b64_json`.
- `gpt-image-2` always processes edit/reference images at high fidelity; its `input_fidelity` is not configurable.
- It supports flexible image sizes, but not transparent backgrounds.
- Complex requests can take up to two minutes. Text placement, cross-generation consistency, and precise structured composition can still fail.

Atlas implications:

- Render territory names, controls, and accessibility text in HTML/SVG above the generated artwork rather than baking critical labels into pixels.
- Preserve the current image during long requests.
- Retry `429` and `5xx` only with bounded backoff. Do not blindly retry user-correctable or moderation errors.

## Future OpenRouter + FLUX.2 Klein path

### Verified OpenRouter model availability

OpenRouter exposes a dedicated image-generation API and live model discovery at [`GET /api/v1/images/models`](https://openrouter.ai/api/v1/images/models). On 2026-07-20, the Klein entries were:

| OpenRouter model slug | OpenRouter status | Input -> output | Current endpoint capabilities |
| --- | --- | --- | --- |
| `black-forest-labs/flux.2-klein-4b` | **Verified present** | text/image -> image | PNG or JPEG; exactly one output; zero to four references; seed; no streaming |
| FLUX.2 Klein 9B | **Not present in OpenRouter's image-model or filtered general-model inventory** | Unknown through OpenRouter | Do not invent or preconfigure an OpenRouter slug |

Black Forest Labs separately documents direct BFL endpoints named `flux-2-klein-4b`, `flux-2-klein-9b-preview`, and `flux-2-klein-9b`. Those are **BFL endpoint names, not OpenRouter model IDs**. The 9B names must not be prefixed or transformed into an OpenRouter slug unless OpenRouter's live discovery API later returns that exact slug.

### Exact buffered OpenRouter request

Use OpenRouter's dedicated Image API, not its beta image-generation server tool:

```http
POST https://openrouter.ai/api/v1/images
Authorization: Bearer $OPENROUTER_API_KEY
Content-Type: application/json
```

Minimal whole-map request:

```json
{
  "model": "black-forest-labs/flux.2-klein-4b",
  "prompt": "<server-composed Atlas prompt derived from the concept>",
  "output_format": "png",
  "n": 1
}
```

Current-image regeneration adds one reference:

```json
{
  "model": "black-forest-labs/flux.2-klein-4b",
  "prompt": "<server-composed edit prompt derived from the concept>",
  "output_format": "png",
  "n": 1,
  "input_references": [
    {
      "type": "image_url",
      "image_url": {
        "url": "data:image/png;base64,<current-rendered-map>"
      }
    }
  ]
}
```

OpenRouter also accepts an HTTPS URL in `image_url.url`. A private/current browser image should use an uploaded private URL or a base64 data URL rather than a public asset URL.

The endpoint record allows these provider passthrough keys under `provider.options.black-forest-labs`: `steps`, `guidance`, and `safety_tolerance`. OpenRouter does not publish their accepted ranges in the endpoint record, so the future adapter must omit them by default and only add validated values after checking current BFL documentation.

```json
{
  "provider": {
    "options": {
      "black-forest-labs": {
        "steps": "<verified provider-supported value>",
        "guidance": "<verified provider-supported value>",
        "safety_tolerance": "<verified provider-supported value>"
      }
    }
  }
}
```

Those strings are documentation placeholders, not valid values to ship.

### Exact buffered OpenRouter response and parsing

The dedicated Image API returns base64-encoded images:

```json
{
  "created": 1748372400,
  "data": [
    {
      "b64_json": "<base64-encoded-image>",
      "media_type": "image/png"
    }
  ],
  "usage": {
    "prompt_tokens": 0,
    "completion_tokens": 4175,
    "total_tokens": 4175,
    "cost": 0.04
  }
}
```

`usage` fields may be unavailable, and `media_type` may be omitted when OpenRouter cannot determine it. The adapter should require a non-empty `data[0].b64_json`, use the returned media type when present, and otherwise fall back to the requested format:

```ts
const response = await fetch("https://openrouter.ai/api/v1/images", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${openRouterApiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

const payload = await response.json();
if (!response.ok) throw new AtlasUpstreamError(response.status, payload);

const firstImage = payload.data?.[0];
if (!firstImage?.b64_json) throw new AtlasInvalidUpstreamResponseError();

return {
  base64: firstImage.b64_json,
  mediaType: firstImage.media_type ?? "image/png",
  provider: "openrouter",
  model: "black-forest-labs/flux.2-klein-4b",
};
```

The real adapter should also cap response size, validate the decoded file signature, set a request timeout, and retain upstream request/cost metadata for observability.

### Current Klein 4B limitations through OpenRouter

The live OpenRouter endpoint record is definitive for the hosted path. It currently says:

- `output_format`: `png` or `jpeg`.
- `n`: minimum 1, maximum 1.
- `input_references`: zero to four.
- `seed`: supported.
- `supports_streaming`: `false`.
- The only current provider is Black Forest Labs.
- `resolution`, `size`, `aspect_ratio`, `quality`, `background`, and `output_compression` are absent. OpenRouter's documentation says an absent capability is unsupported by that endpoint, so Atlas must not send those fields until discovery says otherwise.

The missing size/aspect-ratio control is the main unresolved fit issue for a map surface. Keep the provider adapter available, but do not promote Klein 4B to the production default until its returned dimensions and crop behavior have been tested against Atlas at desktop and mobile ratios.

## Environment configuration

### Verified upstream requirements

- Direct OpenAI v1 requires `OPENAI_API_KEY` in the server environment.
- OpenRouter requires `OPENROUTER_API_KEY` and sends it as a Bearer token.
- Neither secret may use a `NEXT_PUBLIC_` prefix or be returned to the browser.

### Live Atlas configuration contract

Model selection is server-side and driven by a single env var — the model slug is not free-form and there is no client override:

```dotenv
# V1 default (final phase → OpenAI, preview phase → OpenRouter Klein 4B)
ATLAS_IMAGE_PROVIDER=openai
OPENAI_API_KEY=...
OPENROUTER_API_KEY=...

# Env-flip selectors for the OpenRouter final path
#   openrouter          → black-forest-labs/flux.2-klein-4b
#   openrouter-pro      → black-forest-labs/flux.2-pro
#   openrouter-flex     → black-forest-labs/flux.2-flex
#   openrouter-max      → black-forest-labs/flux.2-max
#   openrouter-nano2    → google/gemini-3.1-flash-image      (Nano Banana 2)
#   openrouter-seedream → bytedance-seed/seedream-4.5
ATLAS_IMAGE_PROVIDER=openrouter-nano2
OPENROUTER_API_KEY=...

# Optional OpenRouter attribution headers only
OPENROUTER_SITE_URL=https://example.com
OPENROUTER_APP_NAME="objet d'art atlas"
```

Preview always resolves to Klein 4B regardless of the final selector, so switching finals never breaks the fast draft path.

Rules the implementation enforces:

- `ATLAS_IMAGE_PROVIDER` is an allowlisted server enum, never free-form client input. `resolveAtlasProviderConfig` uses `Object.hasOwn` against a fixed selector table so prototype keys like `constructor` cannot slip through.
- OpenRouter models are validated against `OPENROUTER_MODEL_ALLOWLIST` at request time. Introducing a new model requires a code change plus a discovery check via `openrouter.ai/api/v1/images/models` before flipping in prod.
- No silent fallback between providers or models — a change in slug materially changes visuals, cost, privacy, and terms.
- `OPENROUTER_SITE_URL` maps to optional `HTTP-Referer`; `OPENROUTER_APP_NAME` maps to optional `X-Title`. Neither is an authentication requirement.

### Bake-off harness

Before flipping the production final selector, run `scratchpad/atlas-image-bakeoff.mjs`. It hits the OpenRouter Image API directly across every selector for a shared set of concepts and writes PNGs + timings to `scratchpad/bakeoff-out/`. This is the concrete way to satisfy items 4-7 of the revalidation checklist below.

```bash
OPENROUTER_API_KEY=... node scratchpad/atlas-image-bakeoff.mjs
```

## Licensing and operational constraints

Verified facts:

- BFL describes the FLUX.2 Klein 4B open weights as Apache 2.0 and the 9B weights as FLUX Non-Commercial License. Commercial self-hosting of 9B requires separate rights.
- BFL says use through its own hosted API includes commercial rights without a separate weights license.
- OpenRouter's terms say model-provider terms govern model and output use, can change, and must be reviewed by the customer. OpenRouter does not guarantee model availability or output suitability.
- OpenRouter's live inventory can add or remove models. The slug in this note is a verified current value, not a permanence guarantee.

Do not conflate the Apache 2.0 license for downloadable 4B weights with the contract for hosted inference through OpenRouter. Before enabling FLUX in production, review the then-current OpenRouter model terms, BFL hosted-use terms, data handling, and the product's intended commercial use. This note is an engineering record, not legal advice.

## Revalidation checklist before enabling FLUX

1. Query `https://openrouter.ai/api/v1/images/models` and confirm the configured slug is still present.
2. Query the model's `endpoints` URL and re-read supported parameters, passthrough parameters, providers, streaming, and pricing.
3. Confirm whether OpenRouter has added an official Klein 9B slug. Use only the exact returned ID.
4. Test whole-map output dimensions and mobile/desktop cropping; current metadata exposes no size or aspect-ratio knob.
5. Test a current-map reference edit and verify style/territory continuity.
6. Review current OpenRouter and BFL model terms, output rights, logging, retention, and regional restrictions.
7. Compare latency, cost, moderation behavior, and visual quality with the `gpt-image-2` v1 baseline before changing the default.

## Official sources

- OpenAI: [GPT Image 2 model](https://developers.openai.com/api/docs/models/gpt-image-2)
- OpenAI: [Image generation guide](https://developers.openai.com/api/docs/guides/image-generation)
- OpenRouter: [Image generation guide](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)
- OpenRouter: [Live image-model inventory](https://openrouter.ai/api/v1/images/models)
- OpenRouter: [Live Klein 4B endpoint record](https://openrouter.ai/api/v1/images/models/black-forest-labs/flux.2-klein-4b/endpoints)
- OpenRouter: [FLUX.2 Klein 4B model page](https://openrouter.ai/black-forest-labs/flux.2-klein-4b)
- OpenRouter: [Terms of Service](https://openrouter.ai/terms)
- Black Forest Labs: [FLUX.2 overview and Klein comparison](https://docs.bfl.ai/flux_2/flux2_overview)
- Black Forest Labs: [Direct API image-generation endpoints](https://docs.bfl.ai/quick_start/generating_images)
- Black Forest Labs: [Licensing overview](https://help.bfl.ai/articles/9272590838-self-serve-dev-license-overview-pricing)
