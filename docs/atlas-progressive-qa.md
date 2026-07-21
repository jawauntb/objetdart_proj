# Atlas progressive-render QA

This checklist is intentionally narrow. Fail the release for a blank or stale
map, blocked interaction, incorrect zoom history, or destructive provider
failure. Do not block it for minor animation timing or cosmetic differences
that do not change the map interaction.

## Scope and observables

- Route: `/atlas/origin`
- API: `POST /api/atlas/generate?phase=preview|final`
- Mobile viewport: `390 × 844`
- Desktop viewport: `1280 × 720`
- Stage: `.living-atlas__stage`
- Phase: `data-generation-phase="idle|local|preview|final|error"`
- History: `data-history-depth="N"`
- Pending work: `.living-atlas__stage.is-generating`
- Status: `.living-atlas__status[role="status"]`
- Incoming image: `.living-atlas__image--incoming.is-visible`

Run the browser checks against the same authoritative branch server. Do not use
the current production URL until the deployment SHA is proven to match merged
`main`.

## Required preflight

```bash
npm ci
npm run lint
npx tsc --noEmit --pretty false
npm run test:atlas
npm test
npm run build
```

## High-signal browser matrix

Run every row at both viewports unless the row says otherwise.

| Flow | Exercise | Release condition |
| --- | --- | --- |
| Progressive render | Submit `fire forest` and observe both phase requests. | The existing map stays usable; `local` becomes `preview` and then `final`; the final image replaces the preview in the same map and immediately ends the visible pending state. If final wins the race, a late preview must not replace it. |
| Stale request | Submit `fire forest`, then immediately submit `glass ocean`; delay the first response pair so it arrives last. | Only the second generation ID can change image, hotspots, seeds, phase, or status. The first result never flashes back into view. |
| Zoom history | Record the current image and hotspot labels, enter a landmark, wait for the render, then choose `return to the outer map`. Repeat to depth two. | History increments once per entered level and decrements once per return. Each return restores the exact prior image, hotspots, concept, and view; it does not regenerate the parent. |
| Failure recovery | Test preview-only failure, final-only failure, and both failures. | Preview failure does not block a successful final. Final failure keeps a successful preview. Two failures keep the prior usable map, end pending state, and expose `error`; no folded or blank placeholder remains. |
| Interaction continuity | While each phase is pending, drag/pinch on mobile, wheel/drag on desktop, select a landmark, return, and submit a newer prompt. | The map and prompt stay operable. A new action cancels or supersedes old work without input lockup, document overflow, or a lower-screen control wall. |

For the stale and failure rows, intercept only the two Atlas API requests. Echo
the request's `x-atlas-generation-id` and requested phase in the mocked response;
otherwise the check is not exercising the production stale-response guard.

During pending work, the current map remains visible and `.living-atlas__diffusion`
is the only visible busy affordance. The busy status copy is clipped visually
but remains available to screen readers.

## Provider and A/B checks

The client must always make the same two server-routed phase requests. Provider
selection stays server-side:

| Server setting | Preview | Final |
| --- | --- | --- |
| `ATLAS_IMAGE_PROVIDER=openrouter-pro` (default) | FLUX.2 Klein through OpenRouter | FLUX.2 Pro through OpenRouter |
| `ATLAS_IMAGE_PROVIDER=openrouter` | FLUX.2 Klein through OpenRouter | FLUX.2 Klein through OpenRouter |
| `ATLAS_IMAGE_PROVIDER=openai` | disabled for now | disabled for now |

For a paid A/B, use the same prompt, canonical source image, viewport, and focus
for both settings. Run at least three matched pairs and record time-to-preview,
time-to-final, output dimensions/crop, landmark continuity, legibility, and
provider cost. The preview should remain comparable because only the final
provider changes. Never use the preview image as the final provider's edit
source; both phases must start from the same canonical map.

The existing `npm run compare:atlas-providers` command compares GPT Image 2
with FLUX.2 Klein by default. Add `--openrouter-provider openrouter-pro` to run
the same matched request against FLUX.2 Pro instead and prove the optional Pro
final path without changing production configuration.

## Production smoke after a verified deploy

Avoid paid generation calls until the service revision and provider variables
are confirmed. The root healthcheck alone does not exercise Atlas providers.

```bash
curl -fsS -o /dev/null -w 'home %{http_code} %{time_total}s\n' \
  https://objetdart-production.up.railway.app/
curl -fsS -o /dev/null -w 'atlas %{http_code} %{time_total}s\n' \
  https://objetdart-production.up.railway.app/atlas/origin
curl -sS -o /dev/null -w 'atlas-api-get %{http_code} %{time_total}s\n' \
  https://objetdart-production.up.railway.app/api/atlas/generate
```

Expected: home `200`, Atlas `200`, and API GET `405` because generation is
POST-only. Then run one paid prompt in the browser and inspect only Atlas-route
errors and request timing:

```bash
railway logs \
  --project b4e02a7a-826b-4eb9-9f0d-d6c55c61e5fe \
  --environment production \
  --service objetdart \
  --http --method POST --path /api/atlas/generate --since 30m --json \
| jq -c '{timestamp,httpStatus,totalDuration,responseTime,requestId,deploymentId,responseDetails}'

railway logs \
  --project b4e02a7a-826b-4eb9-9f0d-d6c55c61e5fe \
  --environment production \
  --service objetdart \
  --latest --lines 200 \
  --filter '@level:error OR "atlas image generation failed"'
```

## Deployment caveats

- The route allows 120 seconds and each provider times out at 110 seconds, so
  preview and final must remain concurrent rather than serial.
- The client interaction creates two phase calls. The route allows 16 phase
  calls per minute and two concurrent calls per client, equivalent to eight
  complete interactions in the current single-replica deployment.
- The in-memory limiter resets with a deploy and is not shared across replicas.
- Checking variable names proves presence, not valid credentials or provider
  quota. Do not print variable values during verification.
