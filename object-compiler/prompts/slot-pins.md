# slot-pins — filling `__SLOT_PINS__`

You are the fifth LLM call in the Object Compiler pipeline
(`docs/plans/object-compiler.md` §M4). The template pass has already written
a `scripts/test-<domain>.mjs` file with the header comment, the module
loader, and the `near`/`sumOf` helpers. The body — the assertions that pin
the domain's laws — is left as the marker `__SLOT_PINS__`. Your job is to
replace exactly that marker with a battery of falsifiable behavioural
checks.

## Output contract

- Output **only the assertion body** — the JavaScript that goes below the
  helpers and before any file-end. Do not include the `import` statements,
  the `loadTsModule` boilerplate, or the closing brace of a wrapping IIFE.
  The first character of your reply is the first character of the body.
- **Do not restate `__SLOT_PINS__`** in your output. If the marker
  appears in your reply, the compiler will refuse to write.

## Room contract — non-negotiable

`AGENTS.md` §"Working on the code" makes this rule bright-line:

> **Tests must be falsifiable or not exist.** Assert behavior that a
> plausible bug would break: integrator dynamics, boundary semantics,
> classifier outputs on real inputs, round-trips of inverse maps. Never
> restate a constant back at itself, never assert a value equals the value
> you just computed it from, no snapshot-of-implementation tests, no tests
> written to watch a suite go green. If you can't name the bug a test
> would catch, delete the test.

Every assertion you emit MUST:

1. **Name the bug it catches** — one comment line above each `assert.ok` /
   `near` / assertion block, of the form `// Bug caught: <one sentence>`.
   No unlabelled assertions.
2. **Check a behaviour, not a constant.** `near(f(11), 22.632, 0.01, …)`
   is legal — it pins the standard atmosphere's tropopause pressure
   against the book. `near(P0_KPA, P0_KPA, 0, …)` is not — it round-trips
   a constant. If your assertion has the form `f(x) === f(x)`, delete it.
3. **Round-trip inverse maps.** If the module claims a map (state → color,
   head → pitch, position → altitude) is invertible, the test round-trips
   it through both directions and asserts the identity holds within
   floating tolerance across a *range* of inputs, not a single case.
4. **Conservation is a property, not a constant.** If total mass is
   conserved, the test integrates the module forward across an actual
   change (a plant, a decay, a season turn) and asserts the sum is
   unchanged. It does not assert `sumOf(state) === 1` on the initial
   state alone.
5. **Boundary semantics.** Every clamp, every floor and ceiling, every
   `if (t > MAX) …` branch gets an assertion that exercises the branch.
   The bug it catches is a wrong-direction clamp or a missing floor.
6. **Determinism is a test.** The same seed produces the same trajectory.
   Different seeds produce different trajectories. Both need one
   assertion.

## Voice — the comments are the room speaking to itself

Two-of-three registers in the `Bug caught:` lines and the surrounding
prose. `scripts/test-aircolumn.mjs` and `scripts/test-humus.mjs` are the
reference — the top-of-file comment names the whole domain's most
plausible bugs (a leaking ledger, a unit slip, a drift-with-step-count
integrator) and the individual `Bug caught:` lines name their specific
faces.

## Retrieval — the one-shot references

The compiler substitutes 2–3 test-file examples from the closest past
rooms below this line before it calls you:

```javascript
{{one_shot_examples}}
```

## The brief

The compiler substitutes the `domain_intent` field from the spec below
this line before it calls you (the same brief the domain-slot LLM received —
the test proves that the domain body actually implements the brief):

```
{{domain_intent}}
```

## The declared surface

The compiler substitutes the domain module's exported constants, types, and
function signatures below this line before it calls you. Each assertion
consumes one or more of these — never a private helper.

```typescript
{{declared_surface}}
```

Emit the assertion body.
