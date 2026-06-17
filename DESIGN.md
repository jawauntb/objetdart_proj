# objet d'art — Design & Rationale (v2)

A reviewer's brief. What we built, why each piece looks the way it does, where the thinking is weakest, and where to push.

Live: https://objetdart-production.up.railway.app
Repo cwd: `/Users/jawaun/objetdart_proj`

---

## TL;DR

A single-page Next.js 14 site that pretends to be an instrument: *a candle inside the command center, facing the sea.* You tune an eight-axis "concern compass," touch a sea that ripples and breathes audibly, carry objects across a hand-drawn atlas, and the room generates a reading written in voice. Readings can be kept, shared as a permalink whose OG image is the user's own sigil, compared against past nights, or answered live by an LLM in the room's voice.

The throughline is *embodied state*. Every value the user sets is rendered four ways at once: as polygon geometry (the sigil), as a colored point on a compass, as a held tone (the audio voice for that concern), and as a paragraph the room writes back to them. There are no metrics anywhere on the page that aren't simultaneously visible, audible, and writable.

Single deploy target, Railway, ~1100 LOC of canvas/WebGL, ~1500 LOC of React, two AI endpoints, zero analytics, zero auth, zero backend persistence (everything is `localStorage`).

---

## The thesis

The author's brief described three "registers" the page must hold simultaneously:

- **devotional** — candle, prayer, evening office, kept, vigil
- **operational** — command center, calibrate, route, instrument, weights
- **oceanic** — coast, harbor, tide, estuary, horizon, sea

A page is on-brand when at least two registers are present and none dominates. This is the smallest unit of self-checking we use; almost every component touches it.

A second axiom emerged during build:

> *"the best thing so far is how i can play with the water. think more about how a user doesn't need to read much to get value out of the app where just interactions are magical and fun and evocative for every modality."*

So: **the water is the template for all modalities.** Touch should mean tone. Dwell should mean glow. State should be hearable, not described. Reading is the payoff; everything *before* it should be felt, not parsed.

These two axioms — three registers, water-as-template — predict almost every decision below.

---

## User journey

### `/` (the home page)

A single scrolling page with five sections separated by hairlines, plus the candle + sound toggle floating as fixed UI on every route.

1. **Threshold** — `t-h1` hero in Cormorant Garamond 300 italic ("A candle inside the command center, facing the sea."), each word a separately-laid-out span with a 7-second breathing loop and a 0.18s phase offset per word, so they ripple like a slow wave across the line. Eyebrow "an instrument" top-left; live local clock top-right; if you've kept any readings, a candle-underlined "N kept" appears next to the clock. Below the hero: a mono subline ("handle the objects · calibrate concern · route the atlas · leave a reading"), an `enter ↓` button, and the **Sea**.
2. **Concern Field** — a single radar polygon laid over eight radial axes (concern compass). Drag any vertex; the polygon morphs in real time, the corresponding concern's audio voice holds a tone, the value updates, the reading text re-flows, the atlas regions tagged with that concern halo briefly. Below: preset chips that ghost-preview when hovered. A `read the room →` button jumps to Reading.
3. **Atlas** — a hand-authored 16:10 SVG map with nine irregular region shapes, each with its own decorative sigil (wavy shoreline, contour rings, dashed road, branching delta, etc.). Below the map: an object tray of 11 glyphs. Two interaction modes: tap a region then another to draw a route, or carry an object onto a region to trigger that combo's effect. A side drawer slides in from the right when a region is selected, with a generated reading shaped around a region-sigil.
4. **Reading** — generated live from current state. Italic headline; a large user-sigil floated top-right (~360px); three paragraphs of prose laid out by Pretext line-by-line, each line's width derived from the polygon's silhouette so the prose hugs the sigil edge. Below the prose: an "ask the room" text input that sends to Claude/Gemini and returns one paragraph appended in voice. At the bottom: the small clickable sigil mini-mark next to the permalink — clicking plays the user's sigil as procedural music for ~12s. Buttons: `keep this reading`, `permalink ⌁ copy`.
5. **Sea** — the Atlantic returns between Reading and Archive; same shader, smaller height. Frames the archive entrance.
6. **Archive** — sticky left-rail of multi-select filters (medium / concern / object / phase + free-text search + sort). To the right of the rail: an `imagine a drawer` form (title + concern chips) that POSTs to `/api/imagine-entry` and adds an AI-generated entry to localStorage, then below it the canonical 12 archive entries as cards with status pills, year, title, fn, and a small per-entry sigil derived from the entry's tagged concerns.
7. **Colophon** — three short paragraphs of prose ("what this is, and isn't"), credits, mailto.

### Other routes

- `/atlas/[region]` — opens the home page with that region's drawer pre-open.
- `/archive/[slug]` — individual entry with its tags, italic dek, candle-bordered pull-quote, three real body paragraphs (Cormorant 20px) that wrap around the entry's sigil via Pretext, sticky meta panel.
- `/reading/[hash]` — read-only shared reading. Decodes hash, builds the same reading text, renders with a *big* sigil, three columns of prose, "step into this room →" to overwrite local state, "← your own room" to go back. Has its own per-hash OG image (`/reading/[hash]/opengraph-image`) showing the sender's actual polygon.
- `/kept` — your trail. Cards with sigil + date + headline + `compare ↔` toggle + `forget`. Two-selection mode reveals a `compare →` banner.
- `/compare?a=&b=` — two polygons overlaid, candle-orange (A) and sea-blue (B), with axis labels, side-by-side readings, top-4 concern delta.
- `/colophon` — standalone colophon.

---

## Architecture

### Stack
- **Next.js 14** (App Router) + **TypeScript** + **Tailwind** (utility-only, light)
- **Zustand** for global state
- **`@chenglou/pretext`** 0.0.8 — text measurement + layout (no DOM)
- **next/font/google** — Cormorant Garamond + JetBrains Mono, self-hosted
- **Web Audio API** + **WebGL** (one fullscreen-quad fragment shader)
- **Railway** hosting via Nixpacks. No backend; two server-only API routes for AI.

### File map (only what matters)

```
src/
  app/
    layout.tsx                       — html shell, fonts, candle + sound toggle global
    page.tsx                         — home: sections + Sea + sound toggle (in layout)
    icon.svg                         — favicon (sigil-shaped)
    apple-icon.tsx                   — apple-touch icon (180x180 ImageResponse)
    opengraph-image.tsx              — site-wide OG (Cormorant + JetBrains)
    _assets/                         — bundled font files for ImageResponse
    api/
      ask-the-room/route.ts          — POST: returns one paragraph
      imagine-entry/route.ts         — POST: returns archive entry shape
    archive/page.tsx                 — index + imagine form + cards
    archive/[slug]/page.tsx          — full entry, Pretext body wrap
    atlas/[region]/page.tsx          — deep link, opens drawer
    colophon/page.tsx                — standalone
    compare/page.tsx                 — overlay of two polygons
    kept/page.tsx                    — saved-reading trail
    reading/[hash]/page.tsx          — shared reading view
    reading/[hash]/opengraph-image.tsx — per-reading OG with sigil

  components/
    Atlas.tsx                        — SVG map + region click + carry + drawer
    Archive.tsx                      — filters + cards + imagine
    CandleMark.tsx                   — fixed candle SVG, flickers
    Colophon.tsx                     — page body
    ConcernField.tsx                 — the compass (radar polygon, drag, tones)
    ConcernSigil.tsx                 — small polygon glyph (reusable everywhere)
    KeptConstellation.tsx            — kept-readings-as-stars on the sea
    MorphText.tsx                    — paragraph crossfade
    PerWordHero.tsx                  — per-word Pretext + breathing keyframes
    Reading.tsx                      — section: prose, sigil, ask-the-room
    Sea.tsx                          — two-canvas water (WebGL + 2D + ripples)
    SharedReading.tsx                — read-only reading view
    ShapedProse.tsx                  — Pretext shape-wrapping prose primitive
    Sigil.tsx                        — the candle sigil (◦│)
    SiteFooter.tsx, SiteHeader.tsx   — nav
    SoundToggle.tsx                  — bottom-right "wake the sea" button
    Threshold.tsx                    — hero + sea + constellation

  data/
    content.ts                       — concerns, presets, regions, objects, archive
    archive-bodies.ts                — voice-written body paragraphs for 12 entries

  lib/
    audio.ts                         — Web Audio: ocean + voices + sigil music
    reading.ts                       — buildReading, buildRegionReading, hash codec
    sigil-shape.ts                   — polygon points + ray-cast silhouette helpers
    slug.ts                          — title → URL slug; cycle helpers
    types.ts                         — domain types

  store/
    field.ts                         — Zustand: concerns, region, carried, kept,
                                       imagined, archive filters, halos
  styles/
    globals.css                      — palette tokens, type roles, slider/chip styles
```

### Data flow

One Zustand store is the single source of truth. The compass writes `concerns[k]`; that flows into Reading (via `useMemo(buildReading)`), the atlas drawer (`buildRegionReading`), the per-entry sigils (derived weights), and the Sea (which reads `getAudioTime` from the audio module but doesn't otherwise share state). The store persists `concerns / preset / region / carriedObject` to `localStorage[objetdart:state:v1]`, kept readings to `objetdart:kept:v1`, imagined archive entries to `objetdart:imagined:v1`, audio-muted to `objetdart:audio:muted`.

No backend writes. No analytics. The two API routes (`/api/ask-the-room`, `/api/imagine-entry`) are stateless — they take the user's current state in the request body, never store anything.

---

## The systems

### The Sea

**What.** Two stacked canvases of identical clientRect dimensions. The back canvas is a WebGL context with a single fullscreen quad and a fragment shader. The shader paints: a multi-blue depth gradient (azure haze at horizon → cerulean → ultramarine → prussian deep), three crossed sine networks for caustic light, modulated by 5-octave value-noise FBM (so the caustic cells drift instead of pulsing periodically), a slow UV-warp for flow, sub-surface horizon haze, and a hard top-fade to paper. The front canvas is 2D and renders five rolling swell lines with compound sines + foam dabs at each crest + a moon-glint streak + pointer ripples. Both canvases react to pointer events: `pointerdown` adds a ripple at `(x, y)` to a shared array (max 12 active), `pointermove` while pressed adds smaller ripples every 80ms, just hovering adds tiny ripples every 220ms. The ripples are passed to the shader as a `vec4[12]` uniform and to the 2D wave-line displacement as a JS gaussian wavefront math. Audio swell LFO (0.14 Hz) and drift LFO (0.03 Hz) read from `AudioContext.currentTime` (once audio has started) so the visual swell stays in phase with the audible swell. The shader caustic peaks brighten in proportion to the live `uSwell` value.

**Why.** The author's stated favorite interaction was *playing with the water*. Everything else on the site uses the sea as its formal template:
- A *visual modality coupled to touch* (the sigil polygon is similarly draggable; the kept-readings constellation lives literally on the water).
- *Two layers — substance and texture* (the WebGL "depth" and the 2D "surface form" — the same split shows up in shape-wrapped prose: shape on one canvas, prose on another).
- *Audio-visual lock* — what you see breathes with what you hear, because they share an LFO source.
- *Interaction creates a wavefront that propagates and decays* — the same metaphor is later used metaphorically for changing concerns (the atlas halo propagates outward from the touched concern; the compass tone fades on release).

Choosing a real WebGL pass instead of "more wave lines" was a real call — the brief discourages flash. The shader earns its complexity by being the only place where the sea looks like depth and not pattern. Without it, the sea reads as graphic decoration; with it, it reads as a window. We tried both.

### The Compass (Concern Field)

**What.** Eight concerns laid out radially around a center. Each vertex is a draggable handle; the polygon connecting them is the user's "valence geometry" for that night. Concerns are arranged so opposites face across the compass (prayer ↔ body; work ↔ memory; future ↔ love; friendship ↔ risk), which is *intentionally not the data order* — it's the four life-polarities the author identified. Dragging a vertex projects the cursor onto the axis to derive a new value 0–100; visual + audio update in the same frame. Each concern has its own audio voice (timbre + base freq + pitch range + optional lowpass), so dragging holds a continuous tone in that voice and pitches with the value. Release fades over 600ms and rings a chime. Eight presets snap the whole polygon; hovering any chip shows a candle-dashed ghost polygon previewing the snap. Below the compass: a small italic line that speaks for whichever concern is hovered/dragged (its inscription from `data/content.ts`).

**Why.** Sliders were the original UI, and they failed the water test — they are a column of numbers that change, not a thing the user feels. The author was clear:

> *"line sliders are the lamest way to do something lol... we have access to the whole web of stuff like d3 and webgl and shaders... make it feel alive."*

We also read the author's *Metric Stack of Concern* paper, which frames meaning as *vector-valued valence* (not a set of independent scalars). The radar polygon is the cheapest way to render concerns as a shape — your night as a single geometric object. Per-concern audio is the second move: *it makes the polygon hearable*. Pulling the prayer vertex outward sounds different from pulling memory outward.

This is the single highest-leverage UI decision in the build. Everything else extends from it: the sigil is literally the polygon at smaller size; the kept readings are the polygon kept; the music is the polygon played; the OG image is the polygon shared.

### The Sigil

**What.** A small SVG component (`ConcernSigil`) that renders the same eight-axis polygon at any size with optional rings, axes, vertex dots, and color overrides. Same math as the compass, factored out so the polygon is *the* visual primitive.

**Why.** Branding says no single logo lockup; the brief was explicit: *"no logo lockup — the wordmark is the mark."* But the site needed a "mine" mark — something the user can read as a self-portrait. The polygon is that mark, and it's tautologically personal because it's just a rendering of their current concern values. Per-entry archive cards use it (the entry's tagged concerns weighted up), the atlas drawer uses it (the region's concerns weighted up against current state), the OG image uses it, the kept-readings constellation uses tiny ones as stars. The sigil composes everywhere.

### Pretext shape-aware prose

**What.** `@chenglou/pretext` is a measurement engine: it can layout text line-by-line with a different `maxWidth` per line, in microseconds, without touching the DOM. Our `ShapedProse` component:
1. Waits for `document.fonts.ready`
2. Reads the resolved font from a hidden DOM probe (next/font generates random family names; we can't predict them)
3. Splits memo into `prepared` (depends only on text + font) and `layout` (depends on width + obstacle + lineHeight) so dragging the compass doesn't re-prepare
4. For each line: passes the polygon's left-edge at that y as `maxWidth`, gets back a `LayoutLineRange`, materializes it as text, renders as an absolutely-positioned span with a 320ms transition on `top/left/width` so dragging the compass animates the line widths smoothly.
5. Graceful fallback to plain stacked `<p>` until measurement is ready.

The silhouette is computed by `polygonLeftEdgeAt(points, y)` — a ray-cast across all 8 edges, find the leftmost intersection.

**Used on:** Reading section (live state), SharedReading view (`/reading/[hash]`), Atlas drawer (region prose around a region-weighted sigil), Archive entry page (body around the entry's sigil).

**Why.** The brief said *"text wrapping around the image is amazing"* and that Pretext is *"the most important infrastructure in UI engineering in the next few years."* But we also asked: where does shape-wrap *belong* on this site? Answer: where the polygon is the page's argument. The reading section is *literally about the polygon*; the prose flowing around it makes the polygon *load-bearing* in the layout, not decoration. We resisted the temptation to put Pretext everywhere; it's only on the four places that have a sigil obstacle.

### The Atlas

**What.** A hand-authored SVG map with nine irregular region paths. Each region has its own decorative inner mark (origin coast: wavy lines; ascent plateau: contour rings; road current: dashed road; etc.). Interactions:
- **Tap a region** → it lights up, you're in "routing" mode
- **Tap a second region** → a dashed gold curve draws between them (route formed)
- **Tap an object in the tray below** → you're "carrying" it; compatible regions glow teal, incompatible dim
- **Tap a region while carrying** → resolveCombo fires (region-specific effect + thud/refuse sound + tooltip + drawer opens)
- **Region drawer** slides in from the right with: region concerns + title + italic headline keyed to current state + three paragraphs of prose wrapping around a small region-sigil + nearby archive links

Sliding concerns on the compass also briefly halos all atlas regions tagged with that concern (multi-region halo via a `Record<id, timestamp>` map).

**Why.** The brief explicitly named the atlas as "the biggest miss" of the early version (it was a bullet list). Replacing it with a real spatial map made the page bear weight again. The hand-drawn region boundaries are deliberate — they read as personal cartography rather than infographic geometry. Tap-then-tap routing was chosen over drag-and-drop because it's identical across mouse and touch and accessible by keyboard.

### The Reading

**What.** Generated client-side from current `concerns + region + carriedObject` via `buildReading()`. Output is a structured object: `headline / weights / regionPara / objectPara / suggestions[] / hash`. The headline is tier-aware: `burn for` / `lean toward` / `is split between` based on dominant concern value and gap to second. Region picked by scoring (sum of user's concerns over region's tagged concerns). Archive suggestions pick three entries with the highest overlap.

A live render of this is the Reading section. The headline runs through `MorphText` (so it crossfades when concerns change). The three paragraphs flow as `ShapedProse` around a 360px user-sigil. A small mini-sigil at the bottom is a button: clicking it calls `playSigilPhrase(concerns)` and synthesizes a ~12-second procedural piece (each concern is one voice in a soft chord, vertex distances drive amplitude envelopes that stagger across the time, plus a delay-feedback "sea reverb" and a final overtone bell on the dominant concern).

The whole reading state encodes into a compact 11-byte hash: 8 concern values + region index + object index + version. Encoded base64-url, decoded the same. That hash drives `/reading/[hash]` (the shared view), `/reading/[hash]/opengraph-image` (the per-reading OG card), and the `compare?a=&b=` URL.

**Why.** Each line above earns its place:
- *Template-first generation* — instant, deterministic, no API dependency. The site has to feel alive even with no models attached.
- *Tier-aware phrasing* — "burn for prayer" vs. "lean toward prayer" vs. "split between prayer and memory" — same data, three different readings, because the prose should match the *intensity* not just the *rank*.
- *Sigil as music* — the author asked for music generation. Procedural beat AI here because (a) it's deterministic per state, so your night sounds like yours, not like the model's interpretation of yours, (b) it always works without API keys, (c) Gemini doesn't reliably do music gen yet anyway.
- *11-byte hash* — small enough that the URL stays human-friendly, big enough to lossless-encode the whole state. The shareable permalink is a small thing that earns disproportionate weight: people kept readings, shared them, and *that* is the social arc the site supports.

### The Kept & The Constellation

**What.** A "keep this reading" button writes the current reading to a localStorage list keyed by hash. `/kept` renders the trail as cards with sigil + date + headline + `compare ↔` + `forget`. Selecting two opens `/compare?a=&b=`.

The **constellation** is the kept readings rendered as small twinkling sigils *on the threshold sea*. Each kept reading gets a deterministic position from its hash (so the constellation stays the same as long as you keep it). Hover any star: it scales 3.4× and shows the headline. Click: opens the shared reading.

**Why.** The kept system was the move that made the reading have *weight*. Without it, every reading is a one-shot and the site has no accumulation. With it, you can produce a reading every night and watch your shape change.

The constellation was the move that made the kept system *visible from the doorway*. Without it, the kept page is a destination; with it, the trail is part of the threshold composition — you arrive on the sea, the sea has your past nights on it as stars, and you can step into any of them. The kept page becomes a complement, not a destination.

### Compare

**What.** `/compare?a=hash1&b=hash2` overlays two polygons: A in candle-orange, B in sea-blue. Eight axis labels around them. Below: two reading columns side-by-side with their respective headlines + weight paragraphs + region paragraphs + "step into this one →" links. A "where they differ most" section shows the top-4 concern deltas with sign and direction (`+48 in a` / `-30 in b`).

**Why.** Adding compare is what turns "this is your night" into "this is *how your night compares to your past nights*." The user can see their own drift over time as a sigil overlay. Without compare, the kept system is just a journal; with it, the journal *means something*.

### The persistent candle (CandleMark)

**What.** A small SVG (32×48) of a candle with flame and halo, fixed `bottom-left` on every route, just above the SoundToggle's vertical position. Two-layer CSS keyframe flicker (halo 1.4s, flame 1.8s, slightly out of phase).

**Why.** *A candle inside the command center, facing the sea.* The brand's central image is *a candle*. The threshold has one in italic serif; everywhere else, until we added this, the candle was only a metaphor in the title. Now there's a literal candle in the corner of every page. It also keeps the brand from drifting into pure-paper minimalism — the candle's warm hex `#C8732A` is one of two accent colors in the whole palette, and giving it a tiny dedicated surface makes the palette read as intentional rather than accidental.

### Audio (procedurally everything)

`lib/audio.ts` is one module. Capabilities:
- **Ambient ocean** — brown noise → highpass → lowpass → gain. Gain is modulated by a 0.14 Hz sine LFO ("swell") and a 0.03 Hz sine LFO ("tidal drift") summed. Fades in over 5s on first user gesture, persists through navigation.
- **One-shots** — `chime / bell / thud / refuse / spark`. Each is one or two oscillators with attack-decay envelopes, soft lowpass, low gain so they layer cleanly under the ocean.
- **Per-concern continuous tones** — `holdConcernTone(id, value)` / `releaseConcernTone(id)`. Eight voices defined inline; each call updates the tone or creates one. Used by the compass on drag.
- **Sigil music** — `playSigilPhrase(concerns)`. Eight oscillators with staggered enter/peak/end envelopes (`0.45s * index` offset), each in its concern's voice, pitched by value. Master goes through a 0.18s delay with 0.32 feedback for a soft "sea reverb." A final overtone bell on the dominant concern at +9.5s.
- **getAudioTime()** — exposes `AudioContext.currentTime` once audio has started, so the visual sea can phase-lock.

State: `started: boolean`, `muted: boolean`, `liveTones: Map<id, ToneHandle>`. The audio context is created lazily and never closed. Mute state persists to `localStorage[objetdart:audio:muted]`. The whole module is one singleton via `getFieldAudio()`.

**Why entirely procedural?** Three reasons:
1. *Deterministic* — your night sounds like yours, not like a model's interpretation. A given concern shape always plays the same phrase.
2. *Free + offline* — no API, no quota, no key wrangling. The site is fully audible with no external dependencies.
3. *Coherent* — every sound on the site comes from the same Web Audio graph and shares modulation sources with the visual sea. There's no risk of a synthesized-music asset feeling unmatched to the ambient ocean — they literally share gain stages.

A Gemini Music or Suno API could replace the procedural music, but losing determinism + audio-visual coherence is too high a price for the marginal richness gain.

### AI integration

Two API routes, `app/api/ask-the-room/route.ts` and `app/api/imagine-entry/route.ts`. Each:
- Runs `nodejs` runtime (not edge)
- Strict input validation: max length, type checks, array checks
- Prefers `ANTHROPIC_API_KEY` (Claude Haiku 4.5), falls back to `GEMINI_API_KEY` (Gemini 2.5 Flash) if Claude returns null or is missing
- Returns 503 with a hint if neither model is configured

Both system prompts hard-code the voice rules: liturgical-not-mystical, lowercase, short clauses, ≥2 of the three registers (devotional/operational/oceanic), no marketing verbs, no quotation marks, one metaphor per sentence, end on a kept image not a thesis. The user prompt is constructed from the current concern state, the region, and the carried object.

`ask-the-room` returns one paragraph; `imagine-entry` returns a strict JSON `{ fn, note, body[] }` shape (with code-fence tolerant parser since some models still wrap output in ```json fences).

Keys are pulled from the user's separate `cofounder/dev` Doppler config via `doppler -p cofounder -c dev secrets get NAME --plain | railway variable set NAME --stdin --service objetdart --skip-deploys`. The values themselves are not in this repo or in this doc.

**Why these two features specifically (vs. the other AI options we considered).**
- *"Ask the room"* — the only AI feature where the model is *answering the user*. Everything else on the site is the room speaking to the user, generated locally. This one is interactive in a way the template can't be.
- *"Imagine a drawer"* — the only place AI is asked to *create new material* in the archive vocabulary. It extends the archive without losing the author's voice (because the system prompt is the voice).
- We *deliberately did not build*: AI-rewritten reading variations (the template is already in-voice; an LLM rewrite would just blur it); TTS-spoken reading (the procedural ocean already provides the sonic register; a synthetic voice on top would crowd it); AI-driven concern phrasing (it would erode the polygon-as-truth principle — the prose has to be a deterministic function of the polygon, not a probabilistic one).

### Pretext-driven hero

`PerWordHero` is a 190-line variant of `ShapedProse` that lays out each word as a separately-positioned span with a CSS `@keyframes` animation: opacity 1 → 0.86 → 1 and a ≤1.5px vertical translate, with the same 7s period as the audio LFO and a 0.18s per-word phase offset. Respects `prefers-reduced-motion`.

**Why.** Hero is the brand's loudest visible surface, but the brief said "no parallax, no scroll-jacking." The breath is the answer: subtle enough that you might not notice it on the first visit, but the page is *alive* in a way a static `<h1>` isn't. The phase offset is the key choice — without it, all 8 words breathe in lockstep, which reads as a strobe. With it, the breath travels across the line like a wave. Same shape as the sea swell. Same period.

---

## Brand & visual system (Tidewater Vellum)

| token | hex | role |
|---|---|---|
| `--paper` | `#F2EEE6` | page background (warm vellum, not white) |
| `--paper-2` | `#E8E2D5` | panel / card surfaces |
| `--ink` | `#15171A` | primary text, mark |
| `--ink-2` | `#3A3D42` | secondary text |
| `--rule` | `rgba(21,23,26,0.18)` | hairlines, dividers |
| `--candle` | `#C8732A` | warm accent (slider fill, active state, link underline) |
| `--sea` | `#2C4A5C` | cold accent (atlas regions, focus ring) |
| `--kept` | `#6E5A2E` | "kept" status pill |
| `--open` | `#2C4A5C` | "open" status pill |
| `--closed` | `#7A1F1F` | "closed" status pill |

Two typefaces only: **Cormorant Garamond** (display, weights 300 + 500, italic available) and **JetBrains Mono** (text/mono, weights 400 + 500). No sans-serif. The tension between literary serif and instrument-grade mono is the typographic identity.

Motion: every transition `320ms cubic-bezier(.2,.6,.2,1)`. Slider drag halos the affected atlas region for 600ms. Sea swell 7s. Hero breath 7s. Candle flicker 1.4s. Reduced motion always respected via global stylesheet.

Imagery: no stock, no AI-illustration, no 3D. Icons: 1px hairline, 24×24, used only for object glyphs.

---

## What's deliberately not there (anti-patterns we resisted)

- **No emoji in product copy.** Anywhere.
- **No marketing verbs** (discover, explore, unlock, journey, transform, empower, dive). Searchable in PRs.
- **No sentence-case or Title-case headlines.** Lowercase or display serif italic.
- **No drop shadows, gradients on UI, or glow on text.** (Sea has gradient because it's the sea.)
- **No section "cards" wrapping everything.** Only the archive cards and the imagine-a-drawer form are bordered.
- **No analytics, no tracking, no email capture.** Stated explicitly in the colophon.
- **No backend.** Everything is client-state + the two stateless AI routes.
- **No "coming soon" anywhere.** Every section is fully implemented. Earlier drafts said *"longer body text and images forthcoming"* in the archive — that has been replaced with real prose for every entry.
- **No autoplay of audio.** First user gesture starts the ocean; muted state persists.
- **No required login or local install.** It's a URL.

---

## Known gaps & open questions

These are the places where a reviewer should push hardest:

1. **The compass on mobile.** The radar polygon is born for desktop drag; on a 390px viewport, the eight vertices crowd together at ~3px-tap-radius if the user has set values near 0. We mitigate with `touchAction: none` on the SVG and 8px touch padding, but it's still the worst interaction on mobile. The atlas tap-to-route is mobile-graceful; the compass drag isn't.

2. **The reading paragraphs are short.** Three paragraphs of ~25 words each. They wrap nicely around the sigil at desktop widths, but the shape effect is most visible when prose wraps many lines. At default Cormorant 22px on a 1180px-wide container, each paragraph fits in 1–2 lines and the silhouette barely bends them. We *could* concatenate the three paragraphs into one longer block to amplify the visual shape effect — but the three-column structure ("what the weights say / what the region offers / what the object asks") is load-bearing for the reading's argument. Open: should the three become one for visual benefit?

3. **The atlas is not yet a place you linger.** Once you've tapped two regions and seen a route draw, you've exhausted it. Carrying an object adds one more interaction, but it's also one-shot. There's no progression. Hypothesis: regions should *accumulate*. When you've routed through Spirit Interior three times, it should look different from one you've never visited. We didn't build this; it would require persistent "atlas memory" in localStorage and an additional visual state per region.

4. **AI features need observability.** Both API routes log warnings on failure but do not surface them to the user beyond a generic "the room could not answer." If Claude is rate-limited or returning garbage, the user sees the same message as if their network failed. For a personal/private site this is OK; for an exhibit context with many simultaneous visitors, it'd be a blind spot.

5. **The audio system is built around `getFieldAudio()` as a singleton, lazily constructed.** It works, but tearing it down on page navigation isn't tested; if a user navigates between routes 50 times in a session, are oscillators leaking? We never measured. The pattern is fine, but the bookkeeping is fragile.

6. **The sigil shape is the only "self portrait" mechanic.** Two readings can produce *the same hash* if the user happens to set the same eight values + region + object on two different nights — there's no time component in the hash. That collision feels OK for the site's purposes (the sigil is *the shape of that state*, not *the moment*) but should be flagged. The kept-readings list does have `keptAt` timestamps; only the hash and OG image are time-blind.

7. **The OG image fonts are loaded from local TTF files at build time** (`src/app/_assets/CormorantGaramond-Light.ttf`, `JetBrainsMono-Regular.ttf`). If the on-page font ever changes (e.g., next/font version bump alters the loaded face), the OG image won't track that change automatically.

8. **The `imagine-entry` doesn't validate concerns against the canonical list.** The user can technically POST `concerns: ["narnia"]` and the model will play along, producing an entry tagged with a concern that doesn't exist in the system. Filtering on the server is one line we should add.

9. **`/reading/[hash]` accepts any decodable hash**, including ones that don't correspond to a real kept reading from anywhere. This is by design (so links work even if the originator forgets), but it means there's no concept of "who created this." Probably fine; worth deciding deliberately if you'd want to add a creator signature later.

10. **The whole site is single-user.** No notion of "this is X's compass" vs. "this is Y's compass." If two people want to compare their nights, they have to manually share permalinks. A real "shared room" mechanic (websockets, see another cursor on the same sea, drop a kept reading into someone else's archive) would be a big addition. We don't think the site needs it yet; flagged for thought.

---

## How to review

If you're an agent or reviewer, here's the order I'd suggest you do this in:

1. **Load it cold:** https://objetdart-production.up.railway.app — do NOT click anything for 15 seconds. Watch the hero breathe, the sea move, the candle flicker. That ambient state is most of the first-impression argument.
2. **Move your cursor across the sea** for 10 seconds. The ripple feedback is the modal template; if it doesn't read as "playing the water," the rest of the site fails its own test.
3. **Scroll to the compass.** Drag one vertex slowly. Listen for the tone. Watch the polygon. Watch any atlas region halo as you drag. That four-modality coupling is the single highest-leverage move.
4. **Press `read the room →`**, then click the small sigil next to the permalink. You should hear ~12 seconds of music that is *this* night's specifically.
5. **Type a question into "ask the room."** This is the only AI surface in the main flow. If the answer doesn't feel of-a-piece with the rest, the system prompt is wrong.
6. Open `/atlas/spirit`, `/archive/the-harbor-system`, `/kept` (after keeping a couple of readings), and `/compare?a=<hash>&b=<hash>`.
7. Open the home page on mobile (≤414px). Confirm: hero, sea, compass (single-column rows), atlas, archive cards all read. The compass drag is the only known weak interaction here; everything else should be solid.

Push back hardest on the **Known gaps & open questions** section. Items 2, 3, and 10 are the biggest live debates.

---

## Stats

- **Live deploys:** ~25 in one session, all to Railway.
- **LOC:** ~5500 across src/, no generated code excluded; ~3000 are React/TS, ~1100 are canvas/shader, ~400 are AI route servers + audio.
- **External deps that matter:** `next` 14.2.35, `react` 18, `zustand`, `@chenglou/pretext`. No UI library. No animation library.
- **Runtime cost without AI:** zero.
- **Runtime cost with AI:** one Claude Haiku 4.5 call per "ask the room" submit (~150 output tokens, ~$0.001) and per "imagine a drawer" submit (~700 output tokens, ~$0.004). Both are user-initiated; there are no background AI calls.

— end —
