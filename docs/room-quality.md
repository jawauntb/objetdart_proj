# room quality — the felt bar, mechanised

`AGENTS.md` §"The room quality bar — non-negotiable" names seven things that
separate a room that is alive from one that only looks alive in a screenshot:
a shader material, the whole grammar with no dead verbs, make and unmake, the
room's own laws, aliveness at rest, two senses in the same frame, and
performance as a law. `test:room-contract` and `test:paint` catch the grammar
and the paint bans. **`test:room-quality`** catches the rest — the felt
contract that used to live only in the reviewer's eye.

Two files carry the contract:

- **`life:`** on the room manifest — the DECLARATION side. A room states what
  population it holds, how births and retirements happen, what it does on the
  shared 7s breath, when it glimmers after idle, and which haptic pattern
  answers each verb.
- **`scripts/test-room-quality.mjs`** — the VERIFICATION side. For every
  merged room, seven mechanical checks read the manifest and grep the
  component source. A room whose manifest declares a `life:` block gets held
  to the full bar; a room without one is still checked on the always-applicable
  subset so no lane is exempt from the shared runtime primitives.

## the seven checks

1. **`breath_wired`** — when `life.breath.reads` includes `uBreath`, the
   component's FRAG string must declare `uniform float uBreath` and use it in
   at least one computation outside the declaration line. A uniform that
   never appears past its declaration reads as stillness.

2. **`glimmer_wired`** — the room persists through `createIdleWriter` from
   `@/lib/room-runtime`. If `life.glimmer.after_idle_ms` overrides the shared
   20000ms cadence, the literal must appear in source. A room that rolls its
   own persistence loses saves between visits (the SoilGround pattern).

3. **`haptics_per_verb`** — every verb in `life.haptics_grammar` is answered
   by a `haptics.<pattern>()` call somewhere in the RoomVoice memo or the
   engine object it forwards to. Patterns must exist in `src/lib/haptics.ts`.
   Missing haptics for a declared verb is a broken promise: the manifest
   said the hand would feel the act, the code says it will not.

4. **`population_layer_used`** — when `life.population.objects` names an
   object with `implementation_hint: SceneObjectSpec`, the component must
   import from `@/lib/scene/object` or `@/lib/scene/population-layer` and
   declare at least one `SceneObjectSpec<...>`. Inline arrays and
   `world.ts` registry hints skip the check — those are equally valid, just
   not the shared model.

5. **`make_unmake_ceremony`** — when `life.make_unmake.ceremony_is` is
   declared, the RoomVoice memo must implement a `ceremony:` handler. The
   ceremony hold is the room's one solemn act; falling to the shell's
   default is polite but not the promised act.

6. **`letgo_clears`** — when `life.make_unmake.letgo_clears_population` is
   true (or when the registry says the room creates something), the source
   must contain a `letGo` handler AND some form of state reset:
   `setX([])`, `arr = []`, `.retireAll()`, `.clear()`, or a
   `clear<Name>Ref`. The exhale must actually empty the room.

7. **`frame_governor_present`** — sanity floor. Every animating room calls
   `createFrameGovernor` from `@/lib/room-runtime`, delegates to `RoomShell`
   or `@/lib/scene/room`, or carries a `governor` exemption in the room
   registry with a written reason. Without one, the DPR ceiling and detail
   tier never fire and the room burns a phone battery on `low` for nothing.

## pre-life rooms

Rooms that predate the `life:` block (all rooms until they migrate) still
run checks 2, 4 (skip when no population is declared), 6 (permissive:
accepts the registry's `creates` field as the countable-material signal),
and 7. Checks 1, 3, and 5 skip silently — a pre-life room cannot promise a
breath, a haptics grammar, or a ceremony act that it never declared.

## when the test goes red

A red `test:room-quality` names the room and the check. Fix the room, or —
if the material genuinely cannot express the promise — take the field out
of the manifest and state why in the PR body. **Never delete the manifest
field you should be answering.** Same law as `test:room-contract`.
