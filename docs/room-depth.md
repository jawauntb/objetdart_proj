# room depth — the density bar, mechanised

`test:room-quality` catches whether the calls are wired: whether the shared
7s breath reaches the shader, whether the idle writer fires, whether every
declared verb lands a haptic, whether the exhale actually empties the room.
It is a contract test.

Phase 6 named the gap the contract test cannot see: a room can pass every
contract check and still feel thin. A single-layer shader that computes one
`vec3`. A "population" of one. A state machine with two states that both
look identical. Contract-green, density-red: the mechanical bar has caught
nothing.

**`test:room-depth`** is the density half. It reads three new declarative
blocks Track A backfills — `shader_layers`, `discoverables`,
`state_machine` — and asks whether the material carries as many layers,
populations, discoverable branches and states as it promised.

## the five checks

1. **`shader_layer_count`** — when `shader_layers` is declared, the FRAG
   body must contain at least that many `// layer:` labels. Under-labelling
   catches the actual bug: a shader whose whole picture is one indivisible
   `mix()` blob is a shader nobody can debug or grow.

2. **`population_count`** — when `life.population.objects` names entries
   whose `implementation_hint` is not `inline array` or a `world.ts
   registry`, the component must declare at least that many
   `SceneObjectSpec<…>` types AND at least two of them. A single
   population is not density; a room is a population, not one object.

3. **`discoverable_count`** — when `discoverables` is declared, the source
   must contain at least that many state-guarded branches
   (`if (state === "…")`, `if (tier === n)`, `switch (state)`, …). Fewer
   branches than promised discoveries is a room that cannot structurally
   answer differently under different states.

4. **`state_machine_states`** — every declared `state.name` must appear as
   a string literal in the component or one of its `@/lib/*` imports. A
   state named in the manifest that never appears in code is a fiction.

5. **`shader_complexity_floor`** — universal. The FRAG body length (chars
   between `` const FRAG = ` `` and the closing backtick, summed across
   FRAG-prefixed template literals) must be ≥ 400. Under 400 is a stub.
   Rooms whose material is legitimately 2D-only skip via
   `life.material_2d_only: true`.

## voluntary until the migration is done

Many rooms will fail until Track A backfills their depth blocks and Track
D compiles them. That failure is the density lift working, not an
obstacle. `test:room-depth` is deliberately absent from the composite
`npm test`; run it directly with `npm run test:room-depth`. When enough
rooms have opted in that the failure surface is small, we wire it into the
default suite the same way `test:room-quality` was landed in phase 3.

## when the test goes red

The report names the room, the check, and the specific missing item — the
manifest declared four shader layers but the FRAG only labels two, the
schema promised three discoverables but only one state-guarded branch
exists. Fix the room by growing the material until the count is real, or
take the field out of the manifest and state why in the PR body. Same law
as `test:room-quality`: **never delete the manifest field you should be
answering.**
