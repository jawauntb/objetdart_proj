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

## Building a new room

Start from **`docs/new-room.md`** and copy **`src/components/RoomTemplate.tsx`**
(a compilable scaffold wired to every bus — gestures, vessel, audio, haptics,
persistence with the quiet clear control, glimmer, keyboard, reduced motion).
The first decision is always ordinal: find the level where the room fits on
the quark→manifold axis, prefer deepening an existing band over adding rooms,
and branch only where containment genuinely forks. State the placement (or
the law/lens exemption) in one sentence in the PR body.

## The field guide (`/guide`) — the documentation law

`/guide` is the one sanctioned reading surface where the site explains itself: an
onboarding walk, the gesture grammar, exhaustive per-room instructions with a
screenshot of every room, and the workshop (system + HTTP API) docs. It exists so
the rooms never have to — in-room copy stays instruction-free, always.

- Content lives in **`src/data/guide.ts`** (one entry per route, plus the shared
  sections). Screenshots live in **`public/guide/<key>.jpg`**, captured by
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
- Tests: `npm test` (route registry, atlas, analytics, light-music, dither-avatar,
  gesture, scale). New routes must be registered where `scripts/test-routes.mjs`
  expects them.
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
