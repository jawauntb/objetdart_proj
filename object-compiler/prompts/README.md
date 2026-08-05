# object-compiler prompt library

The prompt files in this directory are the *creative* half of the compiler.
Everything the template pass emits is deterministic; everything a language
model is asked to write is asked here.

## What lives here

| file | slot | called by |
| --- | --- | --- |
| `intent-to-spec.md`   | prose → `spec.yaml`      | `scripts/object-compiler/compile-room.py --prose "…"` |
| `slot-shader.md`      | `__SLOT_SHADER_BODY__`   | `compile-room.py` slot-fill pass, once per rendered `Room.tsx` |
| `slot-domain.md`      | `__SLOT_DOMAIN_LAW__`    | `compile-room.py` slot-fill pass, once per rendered `<domain>.ts` |
| `slot-verbs.md`       | `__SLOT_VERB_HANDLERS__` | `compile-room.py` slot-fill pass, once per rendered `Room.tsx` |
| `slot-pins.md`        | `__SLOT_PINS__`          | `compile-room.py` slot-fill pass, once per rendered `test-<domain>.mjs` |
| `registry-patch.md`   | patch instructions        | `compile-room.py` registry patch step (also has a programmatic fallback) |

Each prompt is a plain markdown file the compiler substitutes into using
`{{spec.field}}` markers and then hands to `claude --print`. The prompts
never touch the file system themselves.

## The chain

The compiler runs the prompts in a fixed sequence. The output of an earlier
call becomes context for a later one, but no prompt ever *loops back* — the
pass is one-directional so that failure at slot N is diagnosable at slot N.

```
prose ──▶ intent-to-spec.md ──▶ spec.yaml ──▶ (schema validation)
                                              │
                                              ├──▶ (template render, no LLM)
                                              │       ├── src/rooms/<key>/room.config.ts
                                              │       ├── src/app/<key>/page.tsx
                                              │       ├── src/app/<key>/layout.tsx
                                              │       ├── src/components/<Room>.tsx      [SLOTS]
                                              │       ├── src/lib/<domain>.ts            [SLOT]
                                              │       └── scripts/test-<domain>.mjs      [SLOT]
                                              │
                                              ├──▶ slot-shader.md    ──▶ Room.tsx  (SHADER_BODY)
                                              ├──▶ slot-domain.md    ──▶ <domain>.ts (DOMAIN_LAW)
                                              ├──▶ slot-verbs.md     ──▶ Room.tsx  (VERB_HANDLERS)
                                              ├──▶ slot-pins.md      ──▶ test-<domain>.mjs (PINS)
                                              │
                                              └──▶ registry-patch.md ──▶ src/rooms/registry.ts
```

## Retrieval context

Each slot prompt is packed with **one-shot examples** at LLM-call time. The
compiler picks 2–3 past rooms whose `invariant_type` matches the spec's own
(a `flux` room retrieves `humus` and `aircolumn`; a `conservation` room
retrieves `orbits`), reads the corresponding section from each, and inlines
that text as examples. The prompt templates themselves refer to the
retrieval bank by *description of where to look*, not by hard-coded content —
the compiler resolves the reference at call time so that a room landing later
this week can appear as an example next week without editing any prompt.

## Design context: `authoring_style` + `visual_style`

The design context every slot prompt speaks inside is split across two
files as of phases 4–6 (see the audits under
`data/object-compiler/audits/`):

- **`object-compiler/design/authoring_style.yaml`** — the CROSS-ROOM
  vocabulary the whole site shares: palette tokens, the six framings,
  the canonical palette-role → what-it-paints register map, the
  AGENTS.md paint bar (`banned_forms`), the form-language taxonomy,
  the shared clocks, and the default gesture-feedback vocabulary.
  Threaded into every slot prompt as `{{authoring_style}}`.
- **`visual_style`** inside each `spec.yaml` — the per-room
  refinements over that shared vocabulary: `subject`, `form_language`,
  `motion_character`, `reference_notes`, `mood`,
  `gesture_feedback_style`. Six fields, all pictorial, all recover
  reliably from a landed screenshot (phase-5 rerun, 0.92 avg
  agreement). Threaded into slot prompts as `{{visual_style}}`.

**`slot-shader.md` consumes both** — the shared artifact FIRST as the
design law, then the per-room block as room-specific refinements —
so the two land as one full brief on the LLM. Older specs that
pre-date `visual_style` still compile: when the block is absent, the
substitution is empty and the prompt tells the model to skip that
section and go straight to the brief.

The other slot prompts (`slot-domain.md`, `slot-verbs.md`,
`slot-pins.md`) do not consume `visual_style` — the block is about
how the room looks and moves, which is the shader's domain. If a
future slot wants a piece of it (for example, `slot-verbs.md`
reading `gesture_feedback_style` to keep tap answers consistent
across rooms), add a matching `{{visual_style}}` reference to that
prompt and a matching substitution key in
`compile-room.py::_call_slot_prompt`.

### Migration note — the three fields removed in phase 6

Earlier revisions of the schema carried `composition`, `registers`,
and `banned_forms` inside the per-room `visual_style` block. Phase 2's
falsifiability audit landed them at 0.42, 0.50, and 0.50 agreement
respectively — they encode DECISIONS the site makes once, not
observations about a single room. Phase 4 moved them into
`authoring_style.yaml`; phase 5 confirmed the split held (0.92 avg on
the surviving six fields); phase 6 removed the deprecated properties
entirely. Old specs that still declare them will fail validation.
See `data/object-compiler/audits/phase-6-schema-cleanup.md`.

## Prompt style — the voice this repo speaks

The prompts inherit the same voice rules as the rest of the codebase
(`AGENTS.md` §"Voice"): lowercase, two-of-three registers (devotional,
operational, oceanic) in every prose line, no marketing verbs, no emoji, no
snapshot-of-implementation tests, no round-tripping constants. The prompts
tell the model this in the system message so its outputs land in the same
register the rest of the site speaks.

## Editing a prompt

- **Never break a slot marker.** The template pass writes the exact strings
  `__SLOT_SHADER_BODY__`, `__SLOT_DOMAIN_LAW__`, `__SLOT_VERB_HANDLERS__`,
  `__SLOT_PINS__` into files. If the LLM output does not replace the marker
  cleanly (either the model refused, or it wrote a version with the marker
  still inside its own reply), the compiler skips the write and reports the
  failure — the marker is preserved for a retry.
- **Resumability.** Running the compiler twice against the same `--out-dir`
  MUST skip already-filled slots. The check is textual: if the marker is
  gone, the slot is filled. Do not add prose to a prompt that could
  regenerate a partially-filled slot from scratch — that would erase a good
  fill on the retry pass.
- **Prompt tests are behavioral.** If you change a prompt, run
  `npm run test:room-contract` and `npm run test:paint` against a freshly
  compiled room to see whether the change survived the site's own laws.
  A prompt-edit that lands a room that still passes both is a good edit.
