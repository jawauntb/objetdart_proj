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

## The `visual_style` block — the design context for the shader slot

`shader_intent` is a paragraph brief. On its own it carries what the shader
DOES; it does not carry what the room SHOULD LOOK LIKE with any of the
vocabulary a designer would reach for. That gap is why /spring's shader
landed simple and /geyser's crossfade was hand-tuned: the picture-diff
between the rendered room and its `public/guide/<key>.jpg` was mediated by
prose alone. `visual_style` closes that gap by structuring the design
context the brief assumes. It gives the slot-shader author (and, where
useful, the slot-verbs author) a name for the composition, the subject, the
form language, the temporal character, the palette registers *by function*,
the reference images a designer would cite, the explicit no-fly list, the
mood, and the visual language for gesture feedback. All fields are
optional; a spec without a `visual_style` block still compiles.

To author one: study the landed screenshot and answer each field in the
vocabulary a colleague would use to point at the picture. Concrete
examples:

- **`composition`** — pick one of `side-section`, `top-down`,
  `first-person`, `ambient-column`, `cutaway`, `silhouette`. Soil is a
  `side-section` cutaway; atmosphere is an `ambient-column`; galaxy is
  `top-down`.
- **`subject`** — a one-line noun phrase: *"a hand's width of wet ground
  with a small pool over an aquifer"*, *"a heliocentric map of orbits on
  warm paper"*.
- **`form_language`** — one or more tokens from the enum: `watercolor`,
  `hand-painted`, `ink-line`, `SDF`, `value-noise-FBM`, `ray-marched`,
  `point-cloud`, `ribbon-flow`, `stipple`. Multiple values are legal — a
  watercolor SDF room is a real thing.
- **`motion_character`** — `still` / `breathing` / `drifting` / `pulsing`
  / `cyclic` / `ballistic` / `stochastic`. `breathing` picks up the site's
  7s clock; `ballistic` fits an erupt phase; `cyclic` fits a year-scale
  loop.
- **`registers`** — one string per palette-slot assignment, mapping the
  abstract hex to what it PAINTS: *"deep water: bg→bg2"*, *"mineral
  bloom: accent2"*, *"sunlit highlight: glow"*. Arrow (→) permitted for
  gradients.
- **`reference_notes`** — described references, not URLs: *"like a wet
  cross-section of clay in a jar; the aquifer register echoes the ocean's
  depth gradient"*, *"reads as an ink-line orrery on warm paper"*.
- **`banned_forms`** — always includes the AGENTS.md bar (no
  `createRadialGradient`, no per-frame `shadowBlur`, no `ctx.filter`);
  add room-specific negatives when a landed screenshot exposed a failure
  mode: *"no cartoon puffiness on the plume"*, *"no visible seam between
  layers"*.
- **`mood`** — one line, felt sense: *"contemplative and low"*,
  *"anticipatory then eruptive"*, *"buoyant, weightless, held"*. Not a
  marketing verb; the adjective a visitor would offer unprompted.
- **`gesture_feedback_style`** — how touch shows up: *"ripple wavefront
  that decays radially"*, *"burn-in halo that fades over 3s"*,
  *"displacement wave under the surface"*. This bridges the shader to
  the verb handlers.

When a `visual_style` block is present, `slot-shader.md` consumes it
alongside `shader_intent`; the shader author gets both the specific brief
and the design vocabulary the brief assumes.

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
