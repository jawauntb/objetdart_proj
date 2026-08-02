# AGENTS.md — read this first

You are working on **objet d'art**: an album-like total artwork of interactive rooms —
*a candle inside the command center, facing the sea*. It is not a normal product site,
and normal product instincts (add controls, add copy, add libraries, make it efficient
and static) will damage it.

## Required reading, in order

1. **`INSPIRATION.md`** — the angle: why rooms must be lifelike, interactive, and
   instruction-free; the maps-between-representations method; the stack; the laws; the
   scale-manifold roadmap. Non-negotiable context for any non-trivial change.
2. **`DESIGN.md`** — what exists and why each piece looks the way it does (v2 of the
   home instrument; brand tokens; anti-patterns; known gaps).
3. **`docs/page-feel-audit.md`** — per-route state of play and improvement batches.

## The laws, compressed (full versions in INSPIRATION.md §5)

- Everything generated is a **deterministic function of a small state vector** (the
  concern polygon, a seed). No model calls in the state-rendering loop.
- **Procedural over assets**: Web Audio synthesis, shaders, parametric models — not
  sound packs, stock, or AI illustration.
- **Join the shared buses**, don't grow private ones: `src/lib/audio.ts` (one audio
  graph), `src/lib/haptics.ts` (haptic bus + iOS Core Haptics bridge),
  `src/lib/turbulence.ts` (shared intensity), `src/lib/world.ts` (shared persistent
  world across coast pages), `src/lib/stars/nestedCosmos.ts` (zoom bands/crossfades).
- **Gesture grammar only**: tap, press-duration, tap-intensity, drag, pinch, twist,
  shake, tilt. No control a hand can't discover in ten seconds. No instructions.
- **State lands in ≥2 senses in the same frame** (sight + sound at minimum; haptics
  where hardware allows). The water on `/` is the reference feel.
- **Voice**: lowercase product copy, two of the three registers
  (devotional/operational/oceanic) in every line, no marketing verbs, no emoji.
  Anti-pattern list in `DESIGN.md` applies everywhere.
- **Build in one room, then extract the law** — prove a mechanic on a single route
  before generalizing it into `lib/`.
- Honor `prefers-reduced-motion`, keep keyboard access, and verify at 390px width.

## Working on the code

- Next.js 14 App Router + TypeScript + Tailwind + Zustand. Rooms live in
  `src/app/<room>/` (thin page) with the real component in `src/components/`.
- Dev: `npm install && npm run dev` (or yarn). Build: `npm run build`.
- Tests: `npm test` (route registry, atlas, analytics, light-music, dither-avatar).
  New routes must be registered where `scripts/test-routes.mjs` expects them.
- Visual smoke checks live in `scripts/smoke-*.mjs`; screenshots land in `iterations/`.
- Commits follow `feat(room): …` / `fix(room): …` as in the existing history. PRs are
  small and single-purpose: one room, one mechanic.
- AI endpoints (`src/app/api/*`) prefer `ANTHROPIC_API_KEY`, fall back to
  `GEMINI_API_KEY`, and must keep the hard-coded voice rules in their system prompts.
- Deploys: Railway from `main` (see `docs/railway-autodeploy.md`).

## Litmus test before you ship

Run the checklist in `INSPIRATION.md` §7. In short: if your change added text that
explains, a control that must be learned, an asset that was downloaded, or a surface
that sits still — reconsider it.
