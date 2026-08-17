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
   - Does its scale fall inside an existing band? Then it probably isn't a new room —
     it's new life inside an existing one (a new species in the garden, a new creature
     in the plasm). Prefer deepening a band over adding rooms.
   - Does it genuinely need its own band position? Give it a scale address in
     `SCALE_BANDS` (`src/lib/scale.ts`), and decide its **doors**: default is the metric
     neighbors; override in `TRAVEL_OVERRIDES` when containment says otherwise (a drop
     belongs to the sea, not to the next size up). A room that shares a band with
     siblings but needs its own vertical doors uses `ROUTE_TRAVEL_OVERRIDES`.
2. **Is it a *law*, *lens*, or *abstraction*?** Then it takes no scale address (the
   `/relativity` precedent — write the exemption into your registry entry's
   `address: { exempt: "…" }` and add the key to `SCALE_EXEMPT_KEYS`; `/group` and
   `/eigen` are the next two — see `docs/plans/fibration-eigen-group.md`), or it branches
   off the band it comments on (the `/beyond` precedent). `/sine` and `/circularity` are
   coast instruments, not this class.
3. **Keep the tree shallow.** Branches exist only where containment genuinely forks. If
   you're about to give a wall a fourth door, the cosmology is probably wrong — look for
   the level you're missing.

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

```ts
{
  key: "template",
  href: "/template",
  desc: "…",                       // lowercase, no marketing verbs; the nav shows it
  icon: "growth",                  // a RouteSigil kind
  cluster: "field",
  dark: true,
  kind: "room",                    // "room" | "instrument" | "reading"
  source: "src/components/YourRoom.tsx",
  page: "src/app/template/page.tsx",
  address: { band: "drop" },       // or { exempt: "why it has no physical scale" }
  frame: "yield",                  // "own" only if you keep your own camera
  chrome: "axis",                  // <AxisChrome route="/template" />
  keeps: "objetdart:template:v1",  // or null
  creates: "a mote",               // the noun a dwell makes, or null
  exempt: {},                      // every global binding you cannot express, + why
  interacts: "…",                  // required when `creates` is set — see §2b below
}
```

## 2b. The three things a new room ships from the start

`test:room-liveness` fails a room that skips any of these, because an audit
found forty-six rooms where a double tap did what a single tap did and thirty-six
travel edges playing a turning globe over a crossing it had nothing to do with.
They are not polish added later; they are what makes the room a room.

**A tap ladder.** Bind `tap`, read `e.count`, and climb the site-wide rungs
through `tapTrainTier` — 1 / 3 / 5 / *n*, from `gesture/core.ts`, never a private
dialect of your own:

```ts
tap: (e) => {
  const tier = tapTrainTier(e.count);
  const depth = tapTrainDepth(e.count);            // 0..1, for the in-between taps
  if (tier === "n") { /* the peal — the rarest thing the room can do */ return; }
  if (tier === 5)   { /* larger still, scaled by e.intensity */        return; }
  if (tier === 3)   { /* the transformation: this thing becomes another kind
                         of thing, or gives birth to a satellite of itself */ return; }
  /* tier 1: the room's ordinary answer, scaled by e.intensity */
},
```

Spend real fidelity at the top rung — that is the moment a visitor tells someone
else about. A rung that repeats the previous rung 30% louder is a loudness knob,
not a ladder, and the test reads it as one.

**Physics between the objects.** A population is objects that act on each other,
not a particle count: gravity at astronomical scale, charge and bonding at
molecular, adhesion and pressure at cellular, flow and drag in fluids. Two of
them meeting must be able to **merge, react or consume** — producing a third
thing that is neither parent — and the collision lands in sight, sound and
haptics in the same frame. Population caps stay; at the cap the oldest gives way
*visibly*, never as a silent no-op. Then say what you built in the registry's
`interacts` field, in one sentence naming the force and the product. `/stars` is
the worked example, in the code and in its registry entry.

**A film on every edge you open.** If your room takes a band, `travelOptions`
now offers edges in and out of it. Each one needs a `PassageSpec` with a `film`
in `src/lib/travel-passage.ts` and a `make…Film` dispatched from `makeFilmFor`
in `src/components/TravelPassage.tsx`. A film is a pure function of `u ∈ [0,1]`
and a seed — the return leg replays it backward and must land on the same frames
— and it depicts *what actually happens between those two scales*, not a zoom.
An unregistered edge is not silent: it plays `DEFAULT_PASSAGE`, which is the
chart curling onto a turning globe.

**And no `Math.random()`,** anywhere in the room. `hashSeed` / `seededRandom`,
seeded from the room's small state vector, or a named reason in the registry's
`nondeterminism` field.

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

`src/components/RoomTemplate.tsx` is a whole conformant room. It passes
`npm run test:room-contract` unmodified. Copy it, rename it, and change two things:

1. **`FIELD`** — the background, as a GLSL `vec3 field(vec2 uv, float t)`. A field of
   light is what a fragment shader is for; 2D compositing can only imitate depth. The
   room's law-layer uniforms (`uBreath`, `uWind`, `uGravity`, `uAgitation`, `uSeason`,
   `uDetail`, `uRes`) arrive already wired.
2. **The object spec** — your material as a `SceneObjectSpec`:
   - `born(seed, nx, ny, tMs)` — deterministic. No `Math.random`, ever.
   - `step(s, ctx)` — in place; read `ctx.wind`, `ctx.gravity`, `ctx.season`,
     `ctx.breath`, `ctx.timeScale`.
   - `emit(s, ctx, out)` — **eight numbers**, not draw calls. The room draws the whole
     population in one instanced pass.
   - `verbs` + `respond` — the verbs of the grammar your material can answer. Declare
     one without a handler and `createPopulation` throws.

`createRoomShell` (`src/lib/scene/room.ts`) does the rest: the gesture engine routed by
finger count (one finger the material, two the frame, three the law), the vessel, the
frame governor, the visibility and gallery pause, the DPR ceiling, the resize observer,
the idle persistence writer, the glimmer clock, and `letGo`.

`born(seed, …)` and `step` are where the seed law and the inter-object physics
meet: `step` reads the whole population, so it is the honest place for the force
one object exerts on another and for the merge that consumes two and returns a
third. Whatever you write there is what the registry's `interacts` sentence has
to be true about.

Walk **AGENTS.md, "the room quality bar"** line by line — shader material,
every verb answered, create *and* delete of things that interact, the room's
real laws in a pure lib with a test, alive at rest, two senses per act, and the
perf rules (one rAF, one instanced draw, typed arrays, O(visible), closed-form
catch-up, pause when hidden). Then `INSPIRATION.md` §7: everything discoverable
by a curious hand in sixty seconds, deterministic from small vectors, nothing
loud, nothing explained.

`npm test` and `npm run build` green. Small PR, merged on green, fresh main
after.
