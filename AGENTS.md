# AGENTS.md — read this first

You are working on **objet d'art**: an album-like total artwork of interactive rooms —
*a candle inside the command center, facing the sea*. It is not a normal product site,
and normal product instincts (add controls, add copy, add libraries, make it efficient
and static) will damage it.

## Why this file changed

Everything below used to be here in prose, correctly stated, and an audit still found:

- **`/earth`** never adopted the gesture engine at all — raw `PointerEvent` listeners, a
  private **540ms `setTimeout`** re-implementing the hold tiers, no `onVessel`, no
  persistence, no creatable object. A direct violation of a documented law, shipped and
  merged.
- **`/stars`** (4517 lines) — the same, 100% raw wiring, no vessel layer, no
  three-finger layer.
- **Thirty of thirty-five rooms** never called `createFrameGovernor` / `onVisibility` /
  `resolveDpr` / `detailForTier`. No visibility pause, no DPR ceiling, no quality tier.
- **`src/lib/fork-regions.ts`** was built, tested, merged — with **zero consumers**.
- `pan2` was absent from every room audited; tutti, twist-lens, three-finger twist and
  hold, knock and flip were missing case by case.
- **`/mountain`** bound three-finger *tap* to season — which the grammar assigns to
  three-finger *twist* — leaving tutti unbound. A private dialect, exactly as forbidden.
- **`AtomsField`** hand-rolled a clear button instead of the shared `<LetGo>`,
  reintroducing the stacking-context bug `<LetGo>` exists to fix.
- Mounting conventions differed per room; `/atlas/[region]` mounted nothing at all.

Prose did not hold the line. **So the laws are executable now.** `npm test` runs
`test:room-contract`, which reads `src/lib/room-registry.ts` and fails the build when a
room drifts from it. A red contract test is the law working. Fix the room, or write the
reasoned exemption into the registry. **Never delete the entry you should be updating.**

## Required reading, in order

1. **`INSPIRATION.md`** — the angle: why rooms must be lifelike, interactive, and
   instruction-free; the maps-between-representations method; the stack; the laws; the
   scale-manifold roadmap. Non-negotiable context for any non-trivial change.
2. **`docs/gesture-grammar.md`** — the exhaustive input grammar every room speaks.
   The structural key: **finger count addresses the stack** (one finger touches the
   material, two the representation/frame, three the world-law; the device itself is
   the vessel — tilt, shake, knock, flip, breath). Global bindings are fixed site-wide;
   rooms add discoveries, never private dialects or thresholds.
3. **`src/lib/room-registry.ts`** — the manifest. One entry per room: route, scale
   address, frame ownership, chrome, persistence key, creatable noun, and a written
   reason for every global binding the material cannot express.
4. **`docs/plans/scale-manifold-build-plan.md`** — the active build: one log-scale axis
   from the quantum fields to the spacetime manifold, band detents, handoff anchors,
   twist-lens, scale-as-spectral-register.
5. **`DESIGN.md`** — what exists and why each piece looks the way it does.
6. **`docs/page-feel-audit.md`** — per-route state of play and improvement batches.

## The laws, and the test that checks each one

Full versions in INSPIRATION.md §5. Every law here names its enforcement; a law with a
test is a law, a law without one is a wish.

| law | checked by |
| --- | --- |
| a room registers once, in `ROOM_REGISTRY`; nav, gallery, guide coverage and chrome derive from it | `test:room-contract`, `test:routes` |
| rooms bind meanings through `attachGestures` — **never raw pointer wiring** | `test:room-contract` (§1) |
| thresholds live in `src/lib/gesture/core.ts` **alone** | `test:room-contract` (§2) |
| every global binding is implemented or carries a written exemption | `test:room-contract` (§3) |
| a room that animates pauses when hidden and governs its frame | `test:room-contract` (§4) |
| the whole-field clear is the shared `<LetGo>` | `test:room-contract` (§5) |
| a room with a scale address mounts axis chrome | `test:room-contract` (§6) |
| no room-facing resolver ships with nobody calling it | `test:room-contract` (§7) |
| a room climbs the tap train's rungs — 1 / 3 / 5 / n — instead of answering every tap alike | `test:room-liveness` (§1, §2) |
| a countable material states the force between its objects and what a merge produces | `test:room-liveness` (§3) |
| every travel edge resolves to a film that depicts *that* crossing | `test:room-liveness` (§4) |
| nothing in a room rolls `Math.random()` — the seed is the whole state | `test:room-liveness` (§5) |
| an object that claims a gesture verb implements it | `test:scene` |
| navigation order is derived from the scale graph, never hand-sorted | `test:routes` |
| the guide documents exactly the rooms that exist, with screenshots | `test:guide` |
| every room key sits on a band, in a peer circle, or in `SCALE_EXEMPT_KEYS` | `test:routes` |

### What `test:room-liveness` checks, and why it exists

`test:room-contract` made the *grammar* a law and now reports "68 interactive
rooms, 13 global bindings each, no drift" — while a visitor described the album
as *"just a spinning earth"*. A room can pass every line of that contract and
still be a slideshow. So the same audit was run one level up, and the numbers
are why this file gained four rows:

- **46 of ~68 interactive rooms bound no multi-tap at all.** `gesture/core.ts`
  has published the rungs — 1 / 3 / 5 / *n* — since the engine landed, and
  almost nothing climbed them: a double tap did exactly what a single tap did.
- **36 of 62 travel edges had no film**, and the gap was systematic — the whole
  small-scale spine (quanta→quarks→nucleons→atoms→molecules→organics→dna→
  organelles→cells→tissue) fell back to the shared 2400ms breath while every
  registered film sat on the astronomical trunk. `DEFAULT_PASSAGE` names no
  film, and `makeFilmFor` answers a filmless spec with the chart that curls
  onto a turning globe — so the planet was literally playing between the
  quarks and the nucleons. That is the spinning earth, found.
- **Nothing checked that a room's objects act on each other**, which is the
  entire difference between `/stars` — a black hole consumes the star that
  drifts near it, two holes inspiral into a third thing that is neither
  parent — and a field of decals with a particle count.

So: every interactive room's `tap` reads `e.count` and branches at a rung above
three; every countable material (`creates` non-null) states in the registry's
**`interacts`** field which force acts between its objects and what a merge or
reaction *produces*; every band-to-band travel edge resolves to a film; and no
room calls `Math.random()`. Each has a reasoned-exemption field — `taps`,
`interacts`, `nondeterminism` in `src/lib/room-registry.ts`, `PLAIN_BREATH_EDGES`
in the test — because a stated reason beats a forced binding, and silence beats
neither. Read `/stars`' `interacts` entry before writing yours.

And the laws that no test can reach — hold these yourself:

- Everything generated is a **deterministic function of a small state vector** (the
  concern polygon, a seed). `test:room-liveness` §5 now catches the loud half of
  this — `Math.random()` in a room component — but not a model call in the render
  loop, not a wall clock read as though it were state, and not `src/lib/` itself.
- **Procedural over assets**: Web Audio synthesis, shaders, parametric models — not
  sound packs, stock, or AI illustration.
- **Join the shared buses**, don't grow private ones: `src/lib/audio.ts` (one audio
  graph), `src/lib/haptics.ts`, `src/lib/turbulence.ts`, `src/lib/world.ts`,
  `src/lib/gesture/`, `src/lib/scale.ts`, `src/lib/room-runtime.ts`, `src/lib/scene/`.
- **Duration and intensity are continuous axes, never switches.** A hold must keep
  deepening past its tier; a tap must scale with `e.intensity`. A binding that fires
  identically at 900ms and at 2400ms is a bug the tests cannot see and you must.
- **Lower friction to the next reward.** Gestures and rapid multi-taps (1 / 3 / 5 / *n*)
  exist so the hand reaches the next sight-sound-haptic payoff without menus or
  willpower — the same habit loop as any other low-activation-energy reward. Prefer a
  richer grammar binding over a control that must be learned; a tap that does nothing
  is raised friction, and raised friction is a bug.
- **State lands in ≥2 senses in the same frame** (sight + sound at minimum; haptics
  where hardware allows). The water on `/` is the reference feel.
- **No instructions, ever.** No new explanatory copy, labels, tooltips, or onboarding.
  Discovery is physical: glimmers only, after ~20s idle.
- **Voice**: lowercase product copy, two of the three registers
  (devotional/operational/oceanic) in every line, no marketing verbs, no emoji.
- **Build in one room, then extract the law** — prove a mechanic on a single route
  before generalizing it into `lib/`. And having extracted it, **wire it into that
  room in the same PR**: `fork-regions.ts` is what happens when you skip that half.
- Honor `prefers-reduced-motion`, keep keyboard access, verify at 390px width.

## What a room is

**A background field, a population of objects, and the shared buses.** Not a canvas and
a pile of closures — that shape is what produced a `createRadialGradient` inside
`for (const a of atoms)`, per-nucleon halos, per-petal shadowBlur, and ~44 gradient
allocations a frame on `/stars`. Every object drawing itself is one defect wearing two
faces: no shared object model, and no shared renderer.

`src/lib/scene/` is both halves:

- **`scene/object.ts`** — a `SceneObjectSpec`: a small deterministic state vector plus a
  seed, a lifecycle (born → growing under a dwell → sealed by a ceremony → retiring),
  the **verbs of the grammar it declares it can answer**, and an `emit` that writes
  *instance data* — never draw calls. Declare a verb without a handler and
  `createPopulation` throws; `test:scene` pins that.
- **`scene/instances.ts`** — one Float32Array for the whole population, allocated once
  at capacity. Eight numbers per object.
- **`scene/gl.ts`** — the room's two passes: the background field as a fragment shader,
  then the entire population in **one instanced draw**, an SDF disc with an additive
  corona instead of a gradient per object per frame. Degrades to a 2D path that still
  draws from one cached sprite; handles context loss; disposes.
- **`scene/room.ts`** — `createRoomShell`: the frame governor, the visibility and
  gallery pause, the DPR ceiling, the resize observer, `attachGestures` routed by finger
  count into verbs, `onVessel`, the idle persistence writer, the glimmer clock, `letGo`.

A room author writes the field shader, the object, and what each verb means in *that*
material. Nothing else. `src/components/RoomTemplate.tsx` is the whole shape, and it
passes the contract test unmodified.

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

`/guide` is the one sanctioned reading surface where the site explains itself. It exists
so the rooms never have to — in-room copy stays instruction-free, always.

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

## The pre-merge checklist — all of it, every time

Nothing here is optional, and none of it is new. It is written as a list because the
audit above is what happened when it was written as paragraphs.

- [ ] `npx tsc --noEmit` clean for the files you touched.
- [ ] `npm test` green — including `test:room-contract`. If it is red **because of your
      room**, you are not done. If it is red because of a room you did not touch, say so
      in the PR body and name the room.
- [ ] Your room calls **`attachGestures`** (or `createRoomShell`) and wires **no raw
      `pointerdown` / `touchstart`** on its playable surface.
- [ ] It defines **no timing constant of its own**. Every threshold comes from
      `gesture/core.ts`.
- [ ] **Every global binding** in `docs/gesture-grammar.md` §5 is implemented, or its
      registry entry carries a sentence saying what the material cannot express.
      Especially the commonly-skipped: two-finger tap (step back), three-finger tap
      (tutti), twist (lens, guarded with `if (e.fingers === 3) return;`), three-finger
      twist (season), three-finger drag (wind), three-finger hold (time dilation),
      dwell (plant/grow), ceremony hold (the one solemn act), and the vessel's four —
      tilt, shake, **knock**, **flip**.
- [ ] Nothing fires identically at 900ms and 2400ms. Duration deepens; intensity scales.
- [ ] The **tap train is climbed, not counted**: `tap` reads `e.count`, branches through
      `tapTrainTier` at 1 / 3 / 5 / *n*, and the top rung is the room's largest, rarest
      event — real fidelity spent, not the same answer 30% louder. A `(count - 1) * 0.08`
      multiplier is a loudness knob, not a ladder. `test:room-liveness` §1–2.
- [ ] If the material is countable, the objects **act on each other** — a force appropriate
      to the layer, and two of them meeting produces a third thing that is neither parent.
      Say which force and what it produces in the registry's `interacts` field, in a
      sentence a reviewer can falsify by playing the room. `test:room-liveness` §3.
- [ ] Every travel edge your room opens **resolves to a film** that depicts that crossing,
      registered in `PASSAGES` and dispatched in `makeFilmFor`. An unfilmed edge is not
      silent — it plays the default turning globe. `test:room-liveness` §4.
- [ ] **No `Math.random()`.** Seed it (`hashSeed` / `seededRandom`) or name the one call
      that needs real entropy in the registry's `nondeterminism` field. A film cannot
      replay backward on the return leg if the room rolls. `test:room-liveness` §5.
- [ ] The room **pauses when hidden** (`onVisibility`) and governs its frame
      (`createFrameGovernor` + `detailForTier` + `resolveDpr`), or the shell does it.
- [ ] **No `createRadialGradient` / `createLinearGradient` inside a loop over the
      material.** No per-frame `shadowBlur` or `filter: blur()`. No allocation in the
      RAF loop. Objects describe themselves as instances.
- [ ] If the material is countable: a **dwell creates** one (legibly, while it happens),
      **holding longer deepens** it, a **ceremony hold is its solemn act and its
      touch-reachable delete**, and the whole-field clear is the shared **`<LetGo>`**.
      Every verb has a touch path — nothing reachable only by right-click or keyboard.
- [ ] The room mounts **`<AxisChrome route="…" />`** from its page, and binds pinch or
      `pan2` only if the registry says `frame: "own"`.
- [ ] Reduced motion, keyboard, and 390px all still work.
- [ ] No new explanatory copy. No emoji. Two of three registers in any line you wrote.
- [ ] `src/data/guide.ts` updated and the screenshot re-shot, in this PR.
- [ ] Anything you extracted into `src/lib/` has a consumer in `src/`, in this PR.

## Litmus test before you ship

Run the checklist in `INSPIRATION.md` §7. In short: if your change added text that
explains, a control that must be learned, an asset that was downloaded, or a surface
that sits still — reconsider it.
