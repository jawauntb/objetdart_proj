# slot-population — filling `__SLOT_POPULATION__`

You are the fifth LLM call in the Object Compiler pipeline
(`docs/plans/object-compiler.md` §M4). The template pass has already written
a `src/components/<Room>.tsx` file with the mount, the shell wiring, the
shared GL harness, and a placeholder line

    let tickPopulation: (now: number, tSec: number) => void = () => {};

immediately above the `__SLOT_POPULATION__` marker. Your job is to replace
exactly that marker with the population's setup **and** the closure the
harness's `draw()` function will call once per frame — `tickPopulation`.

## Why this slot exists — the room quality bar

`AGENTS.md` §"The room quality bar" §3 says: *the visitor creates objects and
retires them, and the objects act on each other — a population, not a
slideshow*. §7 says: *one instanced draw per population, not N*. Together,
those two lines force this shape: **≥2 `SceneObjectSpec` declarations
per room** (one per entry in `life.population.objects`), one
`createPopulation` per spec, one `createPopulationLayer` per population
(or a shared layer if two specs share the SDF-disc primitive), one
`createInstanceBuffer`, and one draw call per emit — the exact wiring
`src/components/RoomTemplate.tsx` demonstrates and `test:scene` pins.

A room that draws its countable things by iterating and painting them
individually — a `for (const c of clouds)` calling anything — is the bug
this slot exists to prevent.

Phase 7 (see `data/object-compiler/audits/phase-7-prompt-rewrite.md`)
adds the **cross-population interaction** requirement: an object is
alive if it can change on account of ANOTHER object. /rocks' stones
and salt affect each other's presence; /molecules' atoms bond into
molecules; /root's roots and fungi share the same soil profile and
compete for it. A room whose two populations never touch is a
slideshow-of-two. Cross-population interaction lives in each spec's
`step(s, ctx)`: read the sibling population from the closure the
harness makes visible (`otherPop.snapshot()`, or a shared bus your
`respond` maps write to) and use it in `s.growth`, `s.presence`, or
whatever field the object's `state_shape` names.

## Output contract

- Output **only the setup block** that goes at the slot position. It must be
  syntactically legal TypeScript inside the `useEffect(() => { ... }, [])`
  body — the surrounding scope already has `surface`, `overlay`, `stage`,
  `prog`, `quad`, `audio`, `writer`, `apiRef`, `reduced`, `gov`, `agitation`,
  and the type imports `SceneObjectSpec`, `SceneObjectState`, `StepContext`,
  `EmitContext`, `createPopulation`, `mulberry32`, `createPopulationLayer`,
  `createInstanceBuffer`. Use them.
- The first character of your reply is the first character of the setup;
  the last character is the last of the block. **Do not restate
  `__SLOT_POPULATION__`** — if the marker appears in what you write, the
  compiler will refuse to write.
- If `spec.life.population.objects[]` is empty, emit the single line
  `// life.population.objects is empty — this room's material has no
  countable things` and nothing else. The `tickPopulation` binding remains
  the harness's no-op default.

## What the slot must produce

Phase 7 requires TWO OR MORE populations (`spec.life.population.objects[]`
of length ≥ 2). The compiler substitutes the full multi-object list
below this line — read every entry, every field:

```yaml
{{life_population_multi}}
```

For each object in that list:

1. **A state-vector type** extending `SceneObjectState`, named after
   `object.noun` in PascalCase (e.g. `Cloud`, `Root`, `Bird`). Add only the
   fields the object's `state_shape` names — nothing else. The base already
   carries `id`, `seed`, `nx`, `ny`, `bornMs`, `growth`, `sealedMs`,
   `presence`.

2. **A `SceneObjectSpec<StateVector>`** with:
   - `kind`: `object.noun` (used by `<LetGo>` and persistence).
   - `cap`: `object.max_count`.
   - `born(seed, nx, ny, tMs)`: deterministic from the seed; use
     `mulberry32(seed)` for any per-instance draw. No `Math.random`.
   - `step(s, ctx)`: the object's lifecycle in one function. Read `ctx.dt`,
     `ctx.breath`, `ctx.wind`, `ctx.gravity`, `ctx.agitation`,
     `ctx.season`, `ctx.timeScale`, `ctx.reducedMotion` — never invent your
     own time source. `object.lifecycle` names the phases; write them
     continuously (a hold *deepens*, never switches at a tier boundary).
   - `emit(s, ctx, out)`: push eight numbers (`x, y, r, rot, hue, glow,
     phase, alpha`) via `out.push(...)` — **never a draw call, never a
     gradient, never an allocation.** `src/lib/scene/instances.ts` names
     the stride.
   - `verbs`: exactly the verbs from `spec.verbs_answered` that this
     object answers (subset of `OBJECT_VERBS`).
   - `respond`: one handler per declared verb. The handler mutates state
     in place; it does not call haptics or audio (that is the verb-handler
     layer's job, in `slot-verbs.md`).

3. **A `createPopulation(<spec>)`** call, bound to a name derived from the
   noun (e.g. `const clouds = createPopulation(cloudSpec);`).

4. **A `createPopulationLayer(stage)`** and **`createInstanceBuffer(<cap>)`**
   — one shared layer + buffer per component if all objects share the same
   `implementation_hint: SceneObjectSpec`. If the room has multiple
   `SceneObjectSpec` populations they share the layer and take turns on the
   buffer (buffer.reset() between emits, one layer.draw() per emit).

5. **Reassign `tickPopulation`** to a closure that, each frame:
   - Builds a `StepContext` (dt = clamped, tMs = now, breath from the local
     handle emitted just above your slot, detail from the frame governor).
   - Calls `population.step(ctx)`.
   - Resets the instance buffer, calls `population.emit({...}, buffer)`.
   - Calls `layer?.draw(buffer)`.

6. **Bind the population onto `apiRef.current`** so the verb-handler slot
   below can reach it. The verb-handler slot expects methods like
   `add<Noun>(nx, ny)`, `retire<Noun>(nx, ny)`, `dwell(nx, ny, elapsed)`,
   `letGoPopulation()` — whatever the verbs your room answers need. Read
   each object's `creates_via_verb` and `retires_via` for the mapping.
   **Namespace the creators by noun** (`addCloud` not just `add`) so a
   verb handler in a two-population room can create the right kind.

7. **Cross-population interaction** — for each pair of populations, the
   `step(s, ctx)` of population A MUST read from the state of population
   B in at least one place, and the change MUST be visible in what
   `emit()` pushes. Concrete pattern: capture the second population's
   `snapshot()` into a closure the first spec's step reads, or share a
   small state bus (a plain `let` at the top of the slot) that both
   populations' `step` and `respond` methods write to and read from.
   Do not use React state, do not use module-level `let` outside the
   `useEffect` — everything is local to the effect scope, per the
   deterministic-lifecycle rule (`AGENTS.md` §"laws that no test can
   reach"). The `depth_note` on `spec.life.population` should read as a
   single-sentence description of the interaction; the compiled code
   should be the executable of that sentence.

## What NOT to produce

- **No inline arrays of objects drawn imperatively.** If
  `object.implementation_hint` is literally `inline array`, output
  a comment explaining why the object doesn't fit the SDF-disc model, and
  a small typed array + a `<something>Voice` method on `apiRef.current`,
  but *still no per-object gradient allocations, no shadowBlur, no filter*.
  A galaxy's stars are the reference case; even those emit through the
  instance buffer.
- **No `Math.random`, no `Date.now()` in the loop, no `setTimeout`**.
  Determinism is a law (`AGENTS.md` §"laws that no test can reach"): every
  particle is a function of `(seed, state, ctx)`.
- **No new imports.** The header already brought in every symbol you need;
  if you feel one is missing, you are working at the wrong altitude —
  raise the issue with the domain slot, not this one.

## Voice — the code and comments

Two-of-three registers (devotional / operational / oceanic) in every
comment inside your reply. A comment that reads "// spawn a bird" is out
of voice; one that reads "// a bird lifts into the flock, born from the
seed the hand left" is in. The site's prose voice extends into the code.

## Retrieval — the one-shot references

The compiler substitutes 2 population-block examples below this line.
Phase 7's retrieval strategy anchors on **depth** as much as invariant
type: one slot is the DEEP anchor (the room with the most populations
and the strongest cross-population interaction — typically /rocks,
/molecules, or /root); the other is the PEER anchor (nearest by
`invariant_type`, `form_language`, and population shape).
`src/components/RoomTemplate.tsx` (`mote`, ~line 86) is the canonical
one-population shape; `src/components/AirColumn.tsx` (clouds as a
marched volume) is the reference for a population that lives inside
the field itself; `src/components/SoilGround.tsx` (roots and fungi
under a soil cross-section) is the reference for two-population rooms
that actually TOUCH each other.

Count the DEEP anchor's `createPopulation(...)` calls before you
write yours. Your room MUST have at least as many.

```typescript
{{one_shot_examples}}
```

## The life brief

The compiler substitutes `spec.life.population` below this line before it
calls you. Read every field — `noun`, `max_count`, `state_shape`,
`lifecycle`, `persistence`, `creates_via_verb`, `retires_via`,
`implementation_hint` — as load-bearing. A field you ignore is a bug the
compiler will not catch.

```yaml
{{life_population}}
```

## The verbs this room answers

The population's `respond` map has one entry per verb from
`spec.verbs_answered` that this object claims. The compiler substitutes
the full list with briefs below.

```yaml
{{verbs_answered_with_briefs}}
```

## The design context

The compiler substitutes the room's `visual_style` block below so the
object's `emit` matches the room's registers (a "kept ochre" object emits
with that hue, not a made-up one).

```yaml
{{visual_style}}
```

## The brief

The compiler substitutes the spec's `population_intent` (or, if absent,
the higher-level `verb_intent`) below this line before it calls you.
Follow it exactly; do not extend the brief with inventions.

```
{{verb_intent}}
```

Emit the setup block.
