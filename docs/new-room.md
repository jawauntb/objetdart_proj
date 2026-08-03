# Building a New Room

The distilled method, extracted from building all twelve bands and adopting the
grammar across every room. Start here; copy `src/components/RoomTemplate.tsx`;
you should be playing your room within the hour and shipping it the same day.

Required context first: `INSPIRATION.md` (the why), `docs/gesture-grammar.md`
(the verbs), `AGENTS.md` (the laws). This doc is the how.

## 1. Find your level (the ordinal decision)

Before writing anything, place the room in the cosmology. Answer in order:

1. **Is it a *place* with a physical scale?** Then it lives on the axis.
   - Does its scale fall inside an existing band? Then it probably isn't a new
     room — it's new life inside an existing one (a new species in the garden,
     a new creature in the plasm). Prefer deepening a band over adding rooms.
   - Does it genuinely need its own band position? Give it a scale address in
     `SCALE_BANDS` (`src/lib/scale.ts`), and decide its **doors**: default is
     the metric neighbors; override in `TRAVEL_OVERRIDES` when containment
     says otherwise (a drop belongs to the sea, not to the next size up).
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

## 2. Copy the template

`src/components/RoomTemplate.tsx` is a compilable, playable scaffold — a field
of breathing motes wired to every bus the site owns. Copy it, rename it, and
replace the mote field with your material. Its numbered sections are the
contract:

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

## 3. Register it

Follow the `/cells` pattern exactly (it is the canonical registration):
`src/app/<room>/page.tsx` + `layout.tsx` (thin page, ambient profile from the
existing set, `siteMetadata`), `src/lib/routes.ts`, `src/lib/site-icon-config.ts`,
`scripts/test-routes.mjs` expectedKeys, and — if it takes a band — the route in
`SCALE_BANDS` (the band-route-page guard in `test-scale.mjs` will fail until
the page really exists; that's the point).

The room also enters the field guide in the same PR: add its entry (essence,
exhaustive moves, discoveries, what it keeps) to `src/data/guide.ts` and shoot
its screenshot with `npm run shoot:guide -- --only=<key>` against a running
build. `test-guide.mjs` fails until both exist — see AGENTS.md, "the
documentation law".

## 4. Test what can lie

Extract the room's laws into a pure, import-free `src/lib/<something>.ts` and
pin them in a `scripts/test-<something>.mjs` (loadTsModule pattern) wired into
the chain. Falsifiable only — determinism, conservation, monotonicity, caps,
round trips. If you can't name the bug an assertion would catch, don't write
it. Interaction wiring gets no tests; the engine's classifiers are already
covered.

## 5. The bar before you open the PR

Run `INSPIRATION.md` §7. In brief: alive at rest, everything discoverable by a
curious hand in sixty seconds, every act landing in two senses in the same
frame, deterministic from small vectors, nothing loud, nothing explained.
`npm test` and `npm run build` green. Small PR, merged on green, fresh main
after.
