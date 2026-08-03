# Building a New Room

The distilled method, extracted from building all twelve bands and adopting the
grammar across every room. You should be playing your room within the hour and
shipping it the same day.

Required context first: `INSPIRATION.md` (the why), `docs/gesture-grammar.md`
(the verbs), `AGENTS.md` (the laws, and **the room quality bar** — that section
is the shipping bar, not advice). This doc is the how.

**Two files and one line.** Everything below is detail on this shape:

```
src/rooms/<key>/room.config.ts   the manifest — declared once, derived everywhere
src/components/<Room>.tsx        your material, wrapped in <RoomShell>
src/app/<key>/page.tsx           the thin page + layout.tsx (siteMetadata)
src/rooms/registry.ts            one import line
```

You should not be hand-editing `routes.ts`, `peers.ts`, `site-icon-config.ts`,
`guide.ts`, or `test-routes.mjs`. If you feel the urge, the manifest is missing
a field — add the field.

## 1. Find your level (the ordinal decision)

Before writing anything, place the room in the cosmology. Answer in order:

1. **Is it a *place* with a physical scale?** Then it lives on the axis.
   - Does its scale fall inside an existing band? Then it probably isn't a new
     room — it's new life inside an existing one (a new species in the garden,
     a new creature in the plasm). Prefer deepening a band over adding rooms.
   - Does it genuinely need its own band position? Give it a scale address in
     `SCALE_BANDS` (`src/lib/scale.ts`), and decide its **doors**: default is
     the metric neighbors; override in `TRAVEL_OVERRIDES` when containment
     says otherwise (a drop belongs to the sea, not to the next size up). A
     room that shares a band with siblings but needs its own vertical doors
     uses `ROUTE_TRAVEL_OVERRIDES` (see `docs/plans/ground-and-sky.md`).
2. **Is it a *law*, *lens*, or *abstraction*?** Then it takes no scale address
   (the `/relativity` precedent — note the deliberate exemption in the PR), or
   it branches off the band it comments on (the `/beyond` precedent).
3. **Keep the tree shallow.** Branches exist only where containment genuinely
   forks (the earth holds both the atlas and the flowers). The fork-door
   mechanic (press, release, press again) carries two or three doors per wall
   gracefully; if you're about to give a wall a fourth door, the cosmology is
   probably wrong — look for the level you're missing.
4. **State the decision in the PR body.** One sentence: where it sits, what
   its doors are, or why it's exempt.

## 2. Write the material inside `<RoomShell>`

The shell mounts the stack so you can spend the hour on the material:

```tsx
<RoomShell
  route="/your-room"
  voice={{ tap: …, plant: …, deepen: …, wind: …, scatter: … }}
  letGo={{ label: "let the field go", onLetGo, visible: hasKept }}
  onGlimmer={…}
>
  <canvas ref={canvasRef} role="application" aria-label="…" />
</RoomShell>
```

You get, without asking: `AxisChrome` (ScaleTravel + MetaNavigator) configured
from your manifest, the **complete** gesture binding table, the vessel bus, the
audio register glided from your scale address, haptics, the ~20s glimmer clock,
the keyboard dialect (held Enter reaches the dwell and ceremony tiers), reduced
motion, and the quiet clear. `voice` is only the verbs your material genuinely
means — every verb you omit still lands softly, scaled by the magnitude the
hand offered, so there are no dead taps to discover later.

Draw with **`createGLStage`** (`src/lib/webgl/stage.ts`), not canvas-2D:

```ts
const stage = createGLStage(canvas, { wrap, label: "your-room", overlay: overlayCanvas });
if (!stage) { /* your 2D fallback — a design decision, so it's yours */ }
const prog = stage.program(FULLSCREEN_VERT_CLIP, FRAG);
const quad = stage.fullscreenQuad(prog);
// per frame:
stage.beginFrame(clocksFrom({ time: audio.getAudioTime() ?? t, turbulence, register }), prog);
quad.draw();
// on unmount: stage.dispose();
```

It owns the context cascade, DPR through `room-runtime`'s quality tiers, the
lockstep 2D overlay for your *thin* interaction layer, shader errors with the
offending line, the shared clocks (7s breath, audio time, turbulence, spectral
register) in both uniform dialects, `stage.instanced(prog)` for one draw call
per population, context-loss recovery, and complete teardown.
`npm run test:paint` will fail a new component that reaches for
`createRadialGradient`, `shadowBlur`, or `ctx.filter` blur.

**`src/components/RoomTemplate.tsx`** remains the readable worked example of
every law below — read it once, then use the shell. Its numbered sections are
the contract:

1. deterministic seeds (hash + mulberry32, no `Math.random`, no `Date.now` in
   render logic)
2. the shared breath (`getAudioTime`, ~7s, 0.14 Hz)
3. gesture bindings — the global verbs pre-wired, marked where your material
   interprets them; thresholds come from `gesture/core` and nowhere else
4. duration and intensity as continuous axes (the law: nothing fires
   identically at 900ms and 2400ms)
5. the vessel (tilt/shake via `lib/vessel` — passive subscription; the candle
   owns permission)
6. sound through `lib/audio`'s existing API only; haptics through
   `lib/haptics`
7. glimmer after ~20s idle — physical, never text
8. persistence: versioned key, capped population, oldest retired gracefully,
   and the quiet clear control at the bottom (hard to hit by accident, clear
   of browser chrome)
9. keyboard dialect (arrows / Enter / held Enter / Esc) and reduced motion
   (stillness never removes a verb)
10. ScaleTravel mount (rooms on the axis) — never bind pinch/pan2 yourself

## 3. Declare it once

Write `src/rooms/<key>/room.config.ts` — the whole registration, in the room's
own directory (`/beam` and `/relativity` are the worked examples):

```ts
import type { RoomManifest } from "@/rooms/types";

export default {
  key: "your-room",
  href: "/your-room",
  sigil: "growth",              // a RouteSigil glyph
  desc: "one lowercase line",   // the dropdown
  cluster: "nature",
  dark: true,
  place: { kind: "band", band: "cells" },
  // or { kind: "peer", circle: "sky", band: "stars", label: "the beam", ringAfter: "comb" }
  // or { kind: "exempt", why: "a law, not a place — …" }
  chrome: { travel: false },    // only when the room owns pinch itself
  icon: { title, description, path: "/your-room", shortName, kind, bg, bg2, glow, accent, accent2, ink },
  guide: { title, essence, scale, moves: ["gesture → what answers", …], finds: [...], keeps: "…" },
} as const satisfies RoomManifest;
```

Then add one import line to `src/rooms/registry.ts`. From that, the site
derives `SITE_ROUTES`, `NAVIGATION_ROUTES` and `GALLERY_ROUTES`, dark chrome,
the `PEER_CIRCLES` seat or the `SCALE_EXEMPT_KEYS` entry, the MetaNavigator
ring, the header dropdown, the favicon/apple/opengraph/manifest assets, the
field-guide entry, and the route test's key set. `scripts/test-rooms.mjs` fails
the moment a manifest and a registry disagree.

Still yours to write by hand:

- `src/app/<key>/page.tsx` + `layout.tsx` — thin page, ambient profile from the
  existing set, `siteMetadata(<key>)`.
- **If it takes a band**: the band's `route` in `SCALE_BANDS` (`src/lib/scale.ts`)
  and its span — those are physics, not registration. `place.kind: "band"`
  asserts the two agree, and `test-scale.mjs`'s band-route-page guard fails
  until the page really exists; that's the point.
- **If it takes a peer seat**: `LATERAL_ROUTE_BANDS` in `scale.ts`, so
  `entryScaleFor` resolves and ScaleTravel can mount. `test-rooms.mjs` checks it.
- The screenshot: `npm run shoot:guide -- --only=<key>` against a running build.
  `test-guide.mjs` fails until it exists — see AGENTS.md, "the documentation law".

**Dropdown / gallery order is automatic** — derived from `SCALE_BANDS`
(manifold → quanta) and `PEER_CIRCLES` via `src/lib/nav-order.ts`. Never
hand-maintain a preferred-nav key list. Every interactive room takes a scale
address: a band primary, or a seat in a ring (cabinet at the drop, shore
instruments, sky, hearth, meadow, peak…). Laws, lenses and reading surfaces are
exempt and append after the axis on purpose. A key that is neither placed nor
exempt fails the tests; that failure means find its place, don't silence it.

Rooms that predate the manifest still carry hand-written rows in `routes.ts`,
`peers.ts`, `site-icon-config.ts` and `guide.ts`, and both paths work side by
side. When you touch one of those rooms, migrating it to a manifest is a small,
welcome PR — it deletes four scattered edits and adds one file.

## 4. Test what can lie

Extract the room's laws into a pure, import-free `src/lib/<something>.ts` and
pin them in a `scripts/test-<something>.mjs` (loadTsModule pattern) wired into
the chain. Falsifiable only — determinism, conservation, monotonicity, caps,
round trips. If you can't name the bug an assertion would catch, don't write
it. Interaction wiring gets no tests; the engine's classifiers are already
covered.

## 5. The bar before you open the PR

Walk **AGENTS.md, "the room quality bar"** line by line — shader material,
every verb answered, create *and* delete of things that interact, the room's
real laws in a pure lib with a test, alive at rest, two senses per act, and the
perf rules (one rAF, one instanced draw, typed arrays, O(visible), closed-form
catch-up, pause when hidden). Then `INSPIRATION.md` §7: everything discoverable
by a curious hand in sixty seconds, deterministic from small vectors, nothing
loud, nothing explained.

`npm test` and `npm run build` green. Small PR, merged on green, fresh main
after.
