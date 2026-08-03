# AGENTS.md — read this first

You are working on **objet d'art**: an album-like total artwork of interactive rooms —
*a candle inside the command center, facing the sea*. It is not a normal product site,
and normal product instincts (add controls, add copy, add libraries, make it efficient
and static) will damage it.

## Required reading, in order

1. **`INSPIRATION.md`** — the angle: why rooms must be lifelike, interactive, and
   instruction-free; the maps-between-representations method; the stack; the laws; the
   scale-manifold roadmap. Non-negotiable context for any non-trivial change.
2. **`docs/gesture-grammar.md`** — the exhaustive input grammar every room speaks.
   The structural key: **finger count addresses the stack** (one finger touches the
   material, two the representation/frame, three the world-law; the device itself is
   the vessel — tilt, shake, knock, flip, breath). Global bindings are fixed site-wide;
   rooms add discoveries, never private dialects or thresholds.
3. **`docs/plans/scale-manifold-build-plan.md`** — the active build: one log-scale axis
   from the quantum fields to the spacetime manifold, band detents, handoff anchors, twist-lens,
   scale-as-spectral-register. Workstreams, lanes, and the checkpoint to retreat to.
4. **`DESIGN.md`** — what exists and why each piece looks the way it does (v2 of the
   home instrument; brand tokens; anti-patterns; known gaps).
5. **`docs/page-feel-audit.md`** — per-route state of play and improvement batches.

## The laws, compressed (full versions in INSPIRATION.md §5)

- Everything generated is a **deterministic function of a small state vector** (the
  concern polygon, a seed). No model calls in the state-rendering loop.
- **Procedural over assets**: Web Audio synthesis, shaders, parametric models — not
  sound packs, stock, or AI illustration.
- **Join the shared buses**, don't grow private ones: `src/lib/audio.ts` (one audio
  graph), `src/lib/haptics.ts` (haptic bus + iOS Core Haptics bridge),
  `src/lib/turbulence.ts` (shared intensity), `src/lib/world.ts` (shared persistent
  world), `src/lib/gesture/` (the semantic gesture engine — never raw pointer wiring
  in new rooms), `src/lib/scale.ts` (the scale manifold: bands, detents, registers).
- **Gesture grammar only** (`docs/gesture-grammar.md`): rooms bind meanings from the
  grammar via `attachGestures`; thresholds live in `gesture/core.ts` alone. Global
  bindings (pinch = zoom in band, pinch-through-detent = travel, twist = rotate the
  lens, 3-finger = weather/time, long-press = grow, shake/tilt/knock/flip/breath =
  vessel) mean the same thing in every room. No control a hand can't discover in ten
  seconds. No instructions, ever.
- **Every new page takes a scale address.** Even a standalone room should know where
  it lives on the quark→manifold axis (`SCALE_BANDS` in `src/lib/scale.ts`) and what
  its spectral register is (`spectralRegisterFor`), so it can join the manifold and
  the album's one-instrument sound without rework. If it truly has no physical scale
  (e.g. a reading surface), say so in the PR — that's a deliberate exemption.
- **State lands in ≥2 senses in the same frame** (sight + sound at minimum; haptics
  where hardware allows). The water on `/` is the reference feel.
- **Voice**: lowercase product copy, two of the three registers
  (devotional/operational/oceanic) in every line, no marketing verbs, no emoji.
  Anti-pattern list in `DESIGN.md` applies everywhere.
- **Build in one room, then extract the law** — prove a mechanic on a single route
  before generalizing it into `lib/`.
- Honor `prefers-reduced-motion`, keep keyboard access, and verify at 390px width.

## The room quality bar — non-negotiable

A room that misses any of these is not finished, whatever it looks like in a
screenshot. Each line names the check that catches it.

1. **The material is a shader.** WebGL for the primary material, canvas-2D only
   as a *thin* layer over it. Banned per frame and enforced by
   `npm run test:paint`: `createRadialGradient`, `shadowBlur` on paths,
   `ctx.filter` blur. `src/lib/webgl/stage.ts` owns context, DPR, the quad,
   instancing, the shared clocks and teardown — the GPU path is the short one.
2. **The whole grammar, no dead verbs.** Bind through `attachGestures` +
   `src/lib/gesture/defaults.ts`, which answers every global verb by default:
   a verb your material doesn't mean still lands softly, scaled by the
   magnitude the hand offered. A tap or press that does nothing is a bug.
   Thresholds from `gesture/core.ts` alone; never raw pointer wiring.
3. **Make and unmake.** The visitor creates objects *and* retires them, and the
   objects act on each other — a population, not a slideshow. Persist it
   (versioned key, capped, oldest retired gracefully) with `<LetGo>`; an
   emptied room stays empty.
4. **The room's laws are the real ones.** Molecules obey chemistry, the valley
   makes the elements, the flock obeys alignment/cohesion/separation. Extract
   them into a pure `src/lib/<name>.ts` and pin them in `test-<name>.mjs`. A
   room that only *looks* like its layer of abstraction is decoration.
5. **Alive at rest**, on the shared 7s breath — and glimmering physically after
   ~20s idle, never with text.
6. **Two senses in the same frame**, haptics included: `lib/audio`,
   `lib/haptics` on every meaningful act, the vessel subscribed passively.
7. **Performance is a law.** One rAF. One instanced draw per population, not N.
   Typed arrays allocated once, no per-frame churn. O(visible), never
   O(history). Closed-form elapsed-time advance after a pause, never a
   catch-up loop. Pause when hidden; take a DPR tier from `room-runtime.ts`.

`<RoomShell>` mounts 2, 5, 6 and the chrome; `stage.ts` makes 1 and 7 easy.
Reaching past them is allowed — say why in the PR.

## Building a new room

Start from **`docs/new-room.md`**. The first decision is always ordinal: find
the level where the room fits on the quark→manifold axis, prefer deepening an
existing band over adding rooms, and branch only where containment genuinely
forks. State the placement (or the law/lens exemption) in one sentence in the
PR body.

Then the room is **declared once**, in `src/rooms/<key>/room.config.ts` (route
row, sigil, cluster, placement, icon palette, guide entry, chrome overrides)
plus one import line in `src/rooms/registry.ts`. `SITE_ROUTES`, dropdown and
gallery order, the peer seat or the exemption, the icon/opengraph assets, the
guide entry and the route test all derive from it — do **not** hand-add the
room to those files; `scripts/test-rooms.mjs` fails when a manifest and a
registry disagree. Rooms predating the manifest keep their hand-written rows;
both paths work, so migrate one when you touch it.

Wrap the material in **`<RoomShell route="…" voice={…}>`** for the full stack,
and override only what is special. `src/components/RoomTemplate.tsx` stays as
the readable worked example of the same contract — read it, then use the shell.

**Nav order follows the scale graph.** The header dropdown and home gallery
are derived from `SCALE_BANDS` + `PEER_CIRCLES` (`src/lib/nav-order.ts`) —
manifold at the top, quanta at the bottom, MetaNavigator peers contiguous in
ring order. Never hand-sort `NAVIGATION_ROUTES`. Every extant interactive
page belongs on the axis (band or peer circle) or in `SCALE_EXEMPT_KEYS`
(laws / lenses / reading surfaces) — coin, tourbillon, sine, fire, and the
rest of the cabinet/shore/sky/hearth rings included. A manifest states this
once, as its `place`; `<RoomShell>` mounts `AxisChrome` from it.
`scripts/test-routes.mjs` and `scripts/test-rooms.mjs` pin it.

## The field guide (`/guide`) — the documentation law

`/guide` is the one sanctioned reading surface where the site explains itself: an
onboarding walk, the gesture grammar, exhaustive per-room instructions with a
screenshot of every room, and the workshop (system + HTTP API) docs. It exists so
the rooms never have to — in-room copy stays instruction-free, always.

- Content lives in the room's own **`room.config.ts`** (`guide:`) for rooms with
  a manifest, and in **`src/data/guide.ts`** for the rest, plus the shared
  sections. Screenshots live in **`public/guide/<key>.jpg`**, captured by
  **`npm run shoot:guide`** (Playwright against a running build;
  `--only=<key>` re-shoots a single room).
- **Documentation moves with the change, in the same PR.** If your PR adds,
  removes, or renames a room; changes what a gesture does; changes an API
  contract; or visibly changes how a room looks — update that room's entry in
  `src/data/guide.ts` (and the workshop section for system-level changes) and
  re-shoot the affected screenshots before you merge.
- `npm run test:guide` enforces this: it fails when the route registry and the
  guide drift apart, and when a documented room has no screenshot. That failure
  is the reminder working, not an obstacle — never silence it by deleting the
  entry you should be updating.
- The same law extends to the other load-bearing docs: a change that makes
  `DESIGN.md`, `docs/gesture-grammar.md`, or `docs/new-room.md` false must edit
  them in the same PR.

## Working on the code

- Next.js 14 App Router + TypeScript + Tailwind + Zustand. Rooms live in
  `src/app/<room>/` (thin page) with the real component in `src/components/`.
- Dev: `npm install && npm run dev` (or yarn). Build: `npm run build`.
- Tests: `npm test` (route registry, rooms, paint bar, atlas, analytics,
  light-music, dither-avatar, gesture, scale, plus each room's own laws). New
  rooms arrive through `src/rooms/<key>/room.config.ts`; `test:rooms` checks
  the derivation and `test:paint` the 2D ban.
- **Tests must be falsifiable or not exist.** Assert behavior that a plausible bug
  would break: integrator dynamics, boundary semantics, classifier outputs on real
  inputs, round-trips of inverse maps. Never restate a constant back at itself, never
  assert a value equals the value you just computed it from, no
  snapshot-of-implementation tests, no tests written to watch a suite go green. If
  you can't name the bug a test would catch, delete the test. Fewer, sharper tests —
  the suite must stay fast (plain node, no browser).
- Visual smoke checks live in `scripts/smoke-*.mjs`; screenshots land in `iterations/`.
- Commits follow `feat(room): …` / `fix(room): …` as in the existing history. PRs are
  small and single-purpose: one room, one mechanic.
- **Merge as soon as green, never let PRs pile up.** After pushing a branch, always
  open a PR and merge it the moment tests + build pass (auto-merge if checks gate it;
  merge directly otherwise) — don't leave pushed work waiting. One PR in flight at a
  time per lane; restart the working branch from fresh `origin/main` before the next
  piece. Stale branches and stacked PRs are how conflicts happen in a repo where
  lanes share `lib/`.
- AI endpoints (`src/app/api/*`) prefer `ANTHROPIC_API_KEY`, fall back to
  `GEMINI_API_KEY`, and must keep the hard-coded voice rules in their system prompts.
- Deploys: Railway from `main` (see `docs/railway-autodeploy.md`).

## Litmus test before you ship

Run the checklist in `INSPIRATION.md` §7. In short: if your change added text that
explains, a control that must be learned, an asset that was downloaded, or a surface
that sits still — reconsider it.
