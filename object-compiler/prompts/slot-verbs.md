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
