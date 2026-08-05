# slot-verbs — filling `__SLOT_VERB_HANDLERS__`

You are the fourth LLM call in the Object Compiler pipeline
(`docs/plans/object-compiler.md` §M4). The template pass has already written
a `src/components/<Room>.tsx` file with the mount, the shell wiring, and the
domain hookup. The `useMemo<RoomVoice>` / `useRef<RoomVoice>` block that
maps grammar verbs to the domain API is left as the marker
`__SLOT_VERB_HANDLERS__`. Your job is to replace exactly that marker with
the room's verb handlers.

## Output contract

- Output **only the object literal** — the `{ tap: (e) => …, plant: (e) =>
  …, … }` that goes inside `useMemo<RoomVoice>(() => (…), [])` or
  `useRef<RoomVoice>(…)`. Do not include the `useMemo`, `useRef`, `[]`
  dependency array, or the surrounding TSX. The first character of your
  reply is `{`, the last is `}`.
- **Do not restate `__SLOT_VERB_HANDLERS__`** in your output. If the marker
  appears in your reply, the compiler will refuse to write.

## Room contract — non-negotiable

The site's `test:room-contract` (`src/lib/room-registry.ts`) and
`docs/gesture-grammar.md` §5 enforce the following. Do not break them:

1. **Every verb in `spec.verbs_answered` gets a handler.** Missing one is a
   bug the room's registry entry would have to write an exemption for; you
   are the one adding the handler, so the exemption is not the way out. If
   a verb genuinely cannot be expressed in this material, still emit a
   soft-landing handler that calls into the domain API's most graceful
   answer (typically an audio bell + a small ripple), and note the
   softness in a one-line comment above the handler.
2. **Scale with intensity and duration.** A verb whose `e.intensity` or
   `e.elapsed` parameter is ignored fires identically at 200 ms and at
   2400 ms, and that is the exact bug the contract test catches. A hold
   must keep deepening past its tier; a tap must scale with `e.intensity`.
3. **No raw pointer wiring.** The verbs are the vocabulary; the handlers
   dispatch to `apiRef.current?.<method>` (see the reference examples). No
   `addEventListener("pointerdown", …)`, no `setTimeout` re-implementing a
   tier, no private threshold constants.
4. **No allocation per gesture.** A tap creates no closures, no arrays; it
   forwards its arguments to the domain method that owns them.
5. **`apiRef` pattern.** The handler reads `apiRef.current?.…`, never a
   captured `api` variable. React re-renders and effect resets must not
   drop an in-flight hold — the ref makes them safe.

## Haptics — the third sense (mandatory)

Two senses in the same frame is the room quality bar (`AGENTS.md` §"The
room quality bar" §6): every meaningful act must land in sight *and*
sound *and*, where the hardware allows, haptics. This slot writes the
haptic call.

**For each verb this room implements, the handler body MUST call
`haptics.<pattern>()` where `<pattern>` is drawn from
`spec.life.haptics_grammar.<verb>`.** Read the block below and honor it
verbatim — a `tap: bloom` line means the `tap` handler calls
`haptics.bloom()`; a `ceremony: roll` line means the `ceremony` handler
calls `haptics.roll()`.

```yaml
{{life_haptics_grammar}}
```

The named patterns are the ones exported by `src/lib/haptics.ts`: `tap`,
`ripple`, `chop`, `roll`, `storm`, `detent`, `crossing`, `lens`, `bloom`.
Any name outside that set is a bug — do not invent new pattern names in
this slot; if the room needs a new haptic, that is a shared-bus PR that
predates this one.

**If a verb has no entry in `haptics_grammar`,** the handler MUST include
a one-line comment explaining why (e.g. `// pointer-only feedback; no
haptic for keyboard arrows`, or `// the material is silent on a knock —
the vessel already answered`). The compiler will fail room-quality checks
if a verb handler lacks both a `haptics.` call and an inline reason
comment.

Scale the haptic with what the hand offered: `haptics.ripple(e.intensity)`,
not a bare `haptics.ripple()`, when the pattern takes a strength argument.
The turbulence bus already lifts intensity in a storm; the handler's job
is to pass the hand's own force through.

## Population — creating and retiring the countable things (mandatory
when the room has any)

The `__SLOT_POPULATION__` fill above yours has already bound population
methods onto `apiRef.current`. For verbs the spec marks as *creating* or
*retiring* a countable object, the handler MUST call the appropriate
method:

- If `spec.life.population.objects[i].creates_via_verb === "<verb>"`, the
  `<verb>` handler MUST call `apiRef.current?.add<Noun>(e.nx, e.ny)` (or
  whatever creator method the population slot bound — read the retrieval
  examples for the exact shape). Typical creators are `dwell` and
  `ceremony`.
- If `<verb>` appears in `spec.life.population.objects[i].retires_via`,
  the `<verb>` handler MUST call `apiRef.current?.retire<Noun>(e.nx,
  e.ny)` (or the population's retire method).
- The `letGo` handler is the whole-field clear (`<LetGo>` mounts it):
  it MUST call `apiRef.current?.letGoPopulation()` for every population
  in the room.

Read the population block below to see the create/retire assignments.

```yaml
{{life_population}}
```

If the room has no population (empty `life.population.objects`), skip
this rule.

## Discoverables — the long tail

Phase 7 (see `data/object-compiler/audits/phase-7-prompt-rewrite.md`)
requires that verb handlers know about **discoverables** — verb
behaviors that fire only when the room is in a particular state, or
only after a small ceremony of gesture. A discoverable is what the
patient visitor finds and the impatient one never learns exists. The
site's densest rooms (/coin, /stars, /molecules) hide a handful of
these behind state or velocity checks, and the discovery IS the
reward.

The compiler substitutes `spec.discoverables` and (if any)
`spec.state_machine` below this line before it calls you:

```yaml
{{discoverables}}
```

```yaml
{{state_machine}}
```

For each entry in `spec.discoverables`, the verb handler for the
entry's `trigger` MUST implement the `response` on the condition the
entry names. The pattern:

```ts
tap: (e) => {
  haptics.bloom(e.intensity);
  const state = apiRef.current?.state?.() as string | undefined;
  if (state === "erupting") {
    // discoverable: tap during eruption → the plume rings a note
    apiRef.current?.ringPlume?.(e.nx, e.ny, e.intensity);
  } else {
    apiRef.current?.tap?.(e.nx, e.ny, e.intensity);
  }
},
```

**Silent until found.** A discoverable never carries an on-screen
hint. Its existence is legible only through the visible response
when the visitor happens to trigger it. Do not add a `console.log`,
do not add a toast, do not add a caption. The register the response
lands in (`spec.discoverables[i].register`) IS the hint — a
particulate register that only ever flashes at ceremony-count 5 is
the room saying "keep going" without a word.

**Guard on state, not on time.** If the discoverable belongs to a
state, guard on `apiRef.current?.state?.()`; if it belongs to a
count, read the count from the domain (see `apiRef.current?.tapCount`
or equivalent — the domain slot exports the counter). Do not
`setTimeout` a discoverable; do not read `Date.now()` in the handler.

The full slot-discoverables prompt (`slot-discoverables.md`) writes
the DEDICATED state-machine + discoverable table into
`__SLOT_DISCOVERABLES__` further down in the effect body; this
verbs slot only needs to KNOW about the discoverables so its verb
handlers branch correctly. If a discoverable's `trigger` names a
verb this room does not answer, that is a spec bug — flag it in a
comment inside the handler that would have carried it.

## Voice — the handler comments and grouping

Two-of-three registers in every comment. Group the handlers thematically
(the hand's verbs first, the vessel's verbs next, the world-law verbs last),
so a reader can see the grammar's shape at a glance. `src/components/AirColumn.tsx`
around line 1203 (`const voice = useMemo<RoomVoice>(…)`) is the reference
layout; `src/components/SoilGround.tsx` around line 375 (`const voiceRef =
useRef<RoomVoice>(…)`) is the ref variant for a room whose lifecycle needs
one.

## Retrieval — the one-shot references

The compiler substitutes 2–3 voice-block examples from the closest past
rooms below this line before it calls you. The closest is chosen by
`invariant_type` and by which shell pattern the compiled room's template
already picked (memo vs. ref):

```typescript
{{one_shot_examples}}
```

## The brief

The compiler substitutes the `verb_intent` field from the spec below this
line before it calls you:

```
{{verb_intent}}
```

## The verbs to answer

The compiler substitutes `spec.verbs_answered` (with each verb's one-line
`spec.verbs.<name>` brief) below this line before it calls you. Emit
one handler per verb, in the order given, and no others.

```yaml
{{verbs_answered_with_briefs}}
```

## The domain API surface

The compiler substitutes the domain module's exported method signatures
(`SpringApi.tap(x, y, intensity)`, `SpringApi.plant(x, y)`, …) below this
line before it calls you. Each handler must dispatch into one of these
methods.

```typescript
{{domain_api_surface}}
```

Emit the object literal.
