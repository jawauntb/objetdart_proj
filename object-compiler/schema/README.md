# object-compiler/schema — the M2 room-spec contract

This directory is the M2 deliverable of `docs/plans/object-compiler.md`: the
coarsest specification that, together with the fixed shared system on `main`
and three creative slots the LLM fills, deterministically produces a room.
The plan states its guarantee plainly:

> Everything else — palette, guide prose, `<RoomShell>` wiring, `page.tsx`
> boilerplate, registry patch, test scaffold — descends from a `spec.yaml`.

## What is here

- **`room-spec.schema.yaml`** — JSON Schema, YAML-serialised. The one place
  every field name, type, and enumerated value is written down. Adding a
  field is a design decision; renaming one breaks every spec already
  authored against it.
- **`examples/{atmosphere,solar,soil,planets,galaxy}.yaml`** — five
  hand-authored specs, each round-trip-derived from the actual merged
  room. These are the retrieval bank M4's slot-filler reads from, and the
  test corpus for `scripts/object-compiler/render.test.mjs` in M3.

## What the schema captures (the deterministic parts)

The spec carries everything a template pass can consume without an LLM:

- **Identity and cosmology.** `key` (the folder name and route segment),
  `placement` (which band or peer-circle seat), `sigil` and `icon_kind` (the
  glyphs), `cluster`, `dark`, `home_priority`, and optional `chrome`
  overrides.
- **Sound and persistence.** `ambient_profile` (the argument to
  `getFieldAudio().setAmbientProfile`) and `storage_key` (the room's
  `localStorage` key, `objetdart:<key>:v<n>`).
- **The material's shape.** `invariant` (the one-line technical description
  of the small deterministic thing the room is a lens over), `material`
  (`shader` or `2d-over-shader`), `noun` (the countable thing a dwell
  creates), `domain_lib.name` and `domain_lib.invariant_type` (which slot of
  the retrieval bank the domain fill draws from).
- **The look.** Six palette colours — `bg`, `bg2`, `glow`, `accent`,
  `accent2`, `ink`.
- **What the hand can do.** `verbs_answered` — an array of the fixed
  grammar's verb names the material implements. Any verb missing here must
  carry a written reason in the emitted `room-registry.ts` entry's `exempt`
  map; the compiler asks for that reason as part of the verb-slot brief.
- **The guide entry.** `title`, `scale`, `essence`, `moves`, `finds`,
  `keeps` — written verbatim into `RoomManifest.guide`.

Everything above is enough to emit `room.config.ts`, `page.tsx`,
`layout.tsx`, the `room-registry.ts` patch, the `test-<domain>.mjs`
skeleton, and the `<RoomShell>` scaffolding inside the room's component
file — no LLM needed.

## What the schema does not capture (the three LLM slots)

Three creative degrees of freedom remain, and the plan's tomography argument
rests on the family being finite in exactly these three places:

1. **`shader_intent`** — a paragraph brief for the fragment shader that
   paints the room's field. Concrete about layers, palette registers,
   invertibility, and what the hand does to the material.
2. **`domain_intent`** — a paragraph brief for the pure physics module
   at `src/lib/<domain_lib.name>.ts`. Concrete about the invariant, the
   closed-form advance, the load-bearing sensory map (and its inverse),
   and the constants that carry the physics.
3. **`verb_intent`** — a paragraph brief for how each verb in
   `verbs_answered` maps into the domain physics. Names the pure
   functions the handlers call, not the panels they mount.

M3's template pass writes these three regions into the emitted files as
marked slots (`SHADER_BODY`, `DOMAIN_LAW`, `VERB_HANDLERS`); M4's
`fill-slots.mjs` calls the model three times with the brief plus the
retrieval bank plus the resolved skeleton. Everything else in the room is
already resolved when those three calls fire, which is why they can be
independent.

## Authoring a new `spec.yaml`

1. **Read `docs/new-room.md` §1.** The ordinal decision — which band, or
   which peer circle, or a written exemption — is made once, before any
   fields are filled in.
2. **Pick the `invariant_type`.** This chooses the retrieval bank slice
   the domain fill will train on: `latent`, `ledger`, `lattice`, `field`,
   `flock`, `column`, `orbit`, `chain`. If the room's material does not
   fit any of these, the family needs another type — that is a schema
   edit and belongs in a PR that argues for it.
3. **List `verbs_answered`.** Read the fixed grammar
   (`docs/gesture-grammar.md` §5) once; check each verb against the
   material. A verb the material genuinely cannot express is left out
   here and gets a written reason later — never silence.
4. **Write the three intents.** Concrete enough that a good agent given
   ONLY the spec and the retrieval bank at `object-compiler/reference/`
   could produce something close to what a human would have written.
   Say what layers, what constants, what closed-form advance, what
   invertible map. The compiler will not repair vague briefs; it will
   emit vague rooms.
5. **Round-trip check.** Compile the spec into a skeleton, hand-fill
   the three slots by reading the retrieval bank, and run the room's
   tests. If a field in the emitted room came from nowhere the spec
   named, that field belongs in the schema — add it and re-emit.

See the plan's M2 done-when: "three human-driven re-derivations produce
something that would pass `test:room-contract` for its target key." The
five example specs here are those re-derivations, checked against their
merged rooms.
