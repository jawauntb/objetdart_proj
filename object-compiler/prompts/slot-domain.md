# slot-domain — filling `__SLOT_DOMAIN_LAW__`

You are the third LLM call in the Object Compiler pipeline
(`docs/plans/object-compiler.md` §M4). The template pass has already written
a `src/lib/<domain>.ts` file with the file header docstring, the imports,
the type declarations, and the exported constants. The body of the module —
the rate laws, the closed-form solutions, the invariant enforcement — is
left as the marker `__SLOT_DOMAIN_LAW__`. Your job is to replace exactly
that marker with the module's physics.

## Output contract

- Output **only the domain body** — the TypeScript that replaces the
  marker. Do not include the surrounding module (no header comment, no
  imports, no re-declarations of types the header already declared). The
  first character of your reply is the first character of the body.
- **Do not restate `__SLOT_DOMAIN_LAW__`** in your output. If the marker
  appears in your reply, the compiler will refuse to write.
- **Pure module.** No DOM, no React, no imports from `src/components/` or
  `src/app/`. Only `src/lib/` peers and node built-ins. `AGENTS.md` says
  every extractable law belongs in `src/lib/` with a node-testable file;
  this is that file, so it must be node-testable.

## Room contract — non-negotiable

The `test:room-contract` and the room's own `scripts/test-<domain>.mjs`
enforce the following. Do not break them:

1. **Closed-form or bounded-iteration.** No unbounded loops, no numerical
   integration with an unbounded step count. If the law integrates a
   differential equation, it must have a closed-form solution or a fixed
   step budget declared as a `const`. A visit after a fortnight is one
   `exp()` per organism, never a replayed timeline (`humus.ts` is the
   reference).
2. **Deterministic from seed.** Any pseudo-randomness comes from
   `mulberry32(hashSeed(...))` or an equivalent seeded PRNG. Never
   `Math.random`. The room's storage key is the ultimate root.
3. **Testable invariants.** For every conservation law, invertible map, or
   boundary condition your module claims, expose the observable that lets
   the test check it. If you conserve total mass, export `totalOf(state)`.
   If your sensory map is invertible, export both directions (`f` and
   `f_inverse`) so the test can round-trip through them.
4. **Numeric bounds.** Every rate has a floor and ceiling (`clamp01`, an
   `MIN`/`MAX` pair). A NaN in the state is a bug the tests will catch.
5. **No `Math.random`, no `Date.now`** — the module is a pure function of
   its inputs.

## Voice — the module's docstring already speaks

The template pass has written the module's file header; you are writing the
body. Comments inside the body follow the same voice rules (lowercase,
two-of-three registers, no marketing verbs). A comment that says "compute
the pressure" reads out of voice; one that says "the column, weighed by the
hand it is inside of" reads in. See `src/lib/aircolumn.ts` and
`src/lib/humus.ts` for the register.

## Retrieval — the one-shot references

The compiler substitutes 2–3 domain-lib examples from the closest past
rooms below this line before it calls you. The closest is chosen by
`invariant_type`: a `flux` room retrieves `src/lib/aircolumn.ts` (the
closed-form barometric column) and `src/lib/humus.ts` (the two-cell nutrient
ledger integrated in closed form); a `gravitation` room retrieves
`src/lib/orbits.ts` (mutual gravity with a bounded step); a
`bounded_iteration` room retrieves `src/lib/flock.ts` and `src/lib/chemistry.ts`.
Read them as examples of *this codebase's law-writing dialect*, not as
content to copy.

```typescript
{{one_shot_examples}}
```

## The brief

The compiler substitutes the `domain_intent` field from the spec below this
line before it calls you. Follow it exactly; do not extend the brief with
inventions.

```
{{domain_intent}}
```

## The declared surface

The compiler substitutes the module's already-declared surface — the
exported constants, the exported types, the function signatures whose
bodies you are filling — below this line before it calls you. Do NOT
re-declare these; add the bodies.

```typescript
{{declared_surface}}
```

Emit the domain body.
