# Build Plan — Object Compiler, the room-writing compiler learned from the record

An internal meta-tool that learns the compiler `K: (spec, objects, details) → room-code`
from the paired data this project has already produced — Claude Code session
transcripts, git history, `/guide` screenshots, and the shared-system consolidation
that landed yesterday. The framework is *Compiler Tomography*
(`~/Metaphysics of Intelligence/Compiler_Tomography_2026_08_03.pdf`); the two theorems
that ride along are **CT-1** — MDL identification of the true compiler is consistent
at `O(√(log N / N))` total-variation rate when the true `K` lies in a finite hypothesis
family — and **CT-2** — Boltzmann reweighting on reward is monotone-improving. The
hypothesis family here is the shared system as it exists on `main` today
(`<RoomShell>`, `src/lib/scene/*`, `src/lib/webgl/stage.ts`, `src/rooms/registry.ts`,
`src/lib/gesture/defaults.ts`). The reward is the site's own test bar: `npm test` +
`next build` + a landed `/guide` screenshot. Context: `AGENTS.md` (site law),
`INSPIRATION.md` §2 and §4 (the quotient/instantiation cycle, delegated aliveness),
`DESIGN.md` §"How a room is put together", and `docs/plans/scale-manifold-build-plan.md`
(the plan-doc convention this one follows).

## Checkpoint — the return point

**`main` @ `929efa6` (merge of PR #258).** Every one of the five most-recent rooms
(atmosphere, solar, soil, planets, galaxy) is shaped by the consolidated shell — that
is the fixed point this plan takes as ground truth. To retreat from any milestone
below: `git revert` forward, or branch from `929efa6` and redeploy. Nothing in this
plan may rewrite history before that commit; nothing in this plan may edit the shared
system (`<RoomShell>`, `src/lib/scene/*`, `src/lib/webgl/stage.ts`,
`src/lib/gesture/defaults.ts`) — those are the *hypothesis family*, load-bearing and
finite; touching them invalidates every paired sample already collected.

## What ships today (the fixed hypothesis family)

The compiler is learned *against* a fixed target. That target is what landed in the
last week of consolidation, and nothing below rewires it:

- **`<RoomShell>`** — mounts axis chrome, the complete `attachGestures` table, the
  vessel, the glimmer clock, the keyboard dialect, `<LetGo>`. A room author never
  hand-mounts these.
- **`src/lib/scene/object.ts`** — `SceneObjectSpec`: small deterministic state vector,
  seed, lifecycle (born → growing → sealed → retiring), declared verbs. Claiming a
  verb without a handler throws at construction; `test:scene` pins it.
- **`src/lib/scene/population-layer.ts`** — the population as one instanced draw. An
  SDF disc with an additive corona replaces the codebase's most expensive habit.
- **`src/lib/webgl/stage.ts`** — GL context, DPR tiers, shared clocks, teardown.
- **`src/rooms/<key>/room.config.ts` + `src/rooms/registry.ts`** — the manifest
  contract. `SITE_ROUTES`, nav order, peer seats, icons, guide entries, chrome all
  derive from it. `test:room-contract` fails when a room drifts.
- **`src/lib/gesture/defaults.ts`** — every global verb answers by default, scaled by
  the magnitude the hand offered. A verb a material does not mean still lands softly.

The five recent rooms — **`/atmosphere` / `/solar` / `/soil` / `/planets` / `/galaxy`** —
all follow the same file shape. That shape is what the compiler will learn:

```
src/rooms/<key>/room.config.ts       ~70 lines   deterministic from spec
src/app/<key>/page.tsx               ~22 lines   deterministic from spec
src/app/<key>/layout.tsx              ~9 lines   template
src/components/<Room>.tsx      1300–1800 lines   ← creative slot: GLSL + verb wiring
src/lib/<domain>.ts             500–850 lines   ← creative slot: domain physics
scripts/test-<domain>.mjs        370–770 lines   ← derivable, pins the physics
public/guide/<key>.jpg                            captured by `shoot:guide`
+ two-line edits: registry.ts, test-routes.mjs, test-scale.mjs, package.json
```

**Three creative slots, the rest deterministic.** The compiler learns:

1. **the shader body** — the GLSL FRAG/VERT strings that paint the field;
2. **the domain law** — the pure physics in `src/lib/<domain>.ts` (aircolumn, orbits,
   humus, worldforge, spiral);
3. **the per-verb behaviour** — how each global verb (tap / dwell / ceremony /
   twist / tap3 / …) maps into the domain math.

Everything else — palette, guide prose, `<RoomShell>` wiring, `page.tsx` boilerplate,
registry patch, test scaffold — descends from a `spec.yaml`.

## Required reading, in order

1. **`AGENTS.md`** — the executable laws; every room the compiler emits must pass
   `test:room-contract`, `test:scene`, `test:routes`, `test:paint`, `test:guide`.
2. **`INSPIRATION.md` §2 (maps between representations, and §2a instantiation)** and
   **§4 (aliveness at the bottom of the stack)** — the theoretical frame the compiler
   makes operational: this tool *is* the quotient/instantiation cycle applied to the
   album itself. `S` is a spec, `ι` is the compiler, `R'` is the landed room.
3. **`DESIGN.md` §"How a room is put together"** — the two manifests, the object
   model, the one draw call, the shell, the enforcement.
4. **`docs/plans/scale-manifold-build-plan.md`** — the plan-doc convention followed
   here.
5. **`~/Metaphysics of Intelligence/Structural_Intelligence_Conjecture_2026_08_03.pdf`** —
   the general frame: which structures a system can be about, which it can host.
6. **`~/Metaphysics of Intelligence/Compiler_Tomography_2026_08_03.pdf`** — the two
   theorems this build rests on. **CT-1** governs how much paired data buys how much
   identification; **CT-2** governs the update rule when M6 turns on.

## The frame

Compiler Tomography, mapped onto this repository:

| SIC object | Object Compiler here |
| --- | --- |
| Specification `S` | `spec.yaml` — natural-language intent structured into a schema (room key, placement on the axis, objects, verbs, palette, guide prose, ambient profile) |
| Realization `X` | the 5-file room delta + registry patch + `public/guide/<key>.jpg` |
| Compiler `K : S → X` | deterministic template pass + three LLM slot fills, running against the shared system as fixed target |
| Paired data `(s_i, x_i)` | Claude Code transcripts × landed git commits × `/guide` screenshots × the shared-system consolidation record |
| Hypothesis family `Θ` | rooms shaped by the post-consolidation shared system — finite by construction, because the shell is fixed |
| Reward `r(s, x)` | `npm test` (contract laws) + `next build` green + `public/guide/<key>.jpg` present |
| Verifier `q` | `test:room-contract` + `test:routes` + `test:paint` + `test:guide` + `test:scene` |

The **finiteness of `Θ`** is what makes CT-1 apply at all. The shared system is the
prior; the compiler's remaining degrees of freedom are the three creative slots.
Nothing about the axis, the chrome, the persistence, the gesture defaults, or the
audio graph is up for negotiation — so nothing about them needs to be learned.

## Seven milestones

Numbered in dependency order. Each names its deliverables as concrete paths, its
"done" test, and an effort estimate in *Claude Code sessions* — a session is a single
sit-down that can hold a coherent context, roughly one working afternoon.

### M1 — The Corpus (1 session)

Extract the paired data from where it already lives. Nothing new is generated; this
lane only exposes what the record already contains.

- **Deliverables**
  - `scripts/object-compiler/extract-corpus.py` — walks
    `~/.claude/projects/-Users-jawaun-objetdart-proj/` (9 top-level `.jsonl` sessions
    + 51 subagent files, ~127 MB, 2026-07-20 → 2026-08-04) and emits
    `data/object-compiler/sessions.jsonl` — one line per session with
    `{session_id, first_user_message, cwd, git_branch, files_touched,
    tool_call_count, timestamp_first, timestamp_last}`.
  - `scripts/object-compiler/match-to-prs.py` — joins sessions to merged PRs by
    `cwd`, `gitBranch`, and timestamp, using `gh pr list --state=merged --json …`.
  - `data/object-compiler/pairs.jsonl` — one line per session→PR pair, with
    `{session_id, pr_number, merge_sha, files_changed, guide_screenshot_added,
    landed_room_key or null}`.
- **Bucketing** — sessions labelled by task family: `new-room`, `refactor-shared`,
  `bugfix`, `docs`, `chore`. Only `new-room` sessions feed the compiler; the rest go
  in a held-out set for later diagnostics (M7).
- **Hand-audit** — spot-check 10 samples: read the session's first user message,
  read the merged PR, confirm the bucket label and the paired room key.
- **Done when** — `sessions.jsonl` and `pairs.jsonl` both exist, both parse, the
  hand-audit's 10 samples all read cleanly.

### M2 — The Schema (1 session)

Reverse-engineer the coarsest `spec.yaml` that generates the five most-recent rooms.

- **Deliverables**
  - `object-compiler/schema/room-spec.schema.yaml` — JSON Schema, YAML-serialised.
    Fields at minimum: `key`, `route`, `placement` (band or peer), `sigil`, `cluster`,
    `palette` (bg, bg2, glow, accent, accent2, ink), `domain` (name of the physics
    module and a one-paragraph intent brief), `objects` (list of `SceneObjectSpec`
    fields the room grows), `verbs` (map of global verb → one-line behaviour brief),
    `guide` (title, scale, essence, moves, finds, keeps), `ambient` (audio profile),
    `axis_edit` (band or peer-circle patch, if any).
  - `object-compiler/schema/examples/{atmosphere,solar,soil,planets,galaxy}.spec.yaml` —
    hand-authored, each one round-trip-derived from the landed room.
- **Validation** — manually re-derive three of the five rooms from their spec by hand
  (no tooling). If a field cannot be recovered from the spec, either the spec needs
  the field or the field is a template constant. Prefer template constants where the
  five rooms agree; prefer spec fields where they diverge.
- **Done when** — three human-driven re-derivations produce something that would
  pass `test:room-contract` for its target key.

### M3 — The Template (2 sessions)

The deterministic generator: `spec.yaml → { file skeletons with three LLM slots
marked }`.

- **Deliverables**
  - `object-compiler/templates/room.config.ts.hbs`
  - `object-compiler/templates/page.tsx.hbs`
  - `object-compiler/templates/layout.tsx.hbs`
  - `object-compiler/templates/Room.tsx.hbs` — with three `{{! slot }}` markers:
    `SHADER_BODY`, `DOMAIN_IMPORTS_AND_STATE`, `VERB_HANDLERS`.
  - `object-compiler/templates/domain.ts.hbs` — with one slot: `DOMAIN_LAW`.
  - `object-compiler/templates/test-domain.mjs.hbs` — with one slot: `PINS`.
  - `scripts/object-compiler/render.mjs` — reads a spec, writes the five files into a
    target worktree, applies the three two-line registry/test-scale/test-routes/
    package.json edits, leaves the slots marked.
  - `scripts/object-compiler/render.test.mjs` — round-trip: for each of the five
    example specs, render its skeleton, hand-fill its three slots from the landed
    room, run the room's own tests. All pass.
- **Constraint** — the template pass is *pure* and dependency-free (`node` + `js-yaml`
  only). It runs offline. Only slot-filling touches an LLM.
- **Done when** — `render.test.mjs` is green for all five example specs.

### M4 — First Generation (2 sessions)

End-to-end: prose in → landed room out, tests green, at the site's own bar.

- **Deliverables**
  - `scripts/object-compiler/spec-from-prose.mjs` — one Claude call, system prompt is
    the schema, user prompt is a paragraph of intent; output is a validated
    `spec.yaml`.
  - `scripts/object-compiler/fill-slots.mjs` — three Claude calls, one per slot; each
    receives the spec, the shared-system reference (the five example rooms as
    retrieval bank), and the skeleton with everything else already resolved.
  - `scripts/object-compiler/compile.mjs` — orchestrator: prose → spec → skeleton →
    filled → run `npm test` in a fresh worktree → capture pass/fail per contract.
- **First target** — one *concrete* new room somewhere on the axis that is not
  already built (the sky rooms and the strata rooms in `SCALE_BANDS` are candidates,
  as is `/manifold`). The first compilation is a case study, not a general
  benchmark; pick a room whose domain the shared system already covers well.
- **Done when** — one compiled room, generated from a paragraph of prose, passes
  `test:room-contract` + `test:routes` + `test:paint` + `test:guide` (with a
  guide screenshot captured by `npm run shoot:guide --only=<key>`) in a fresh
  worktree.

### M5 — The Harness (1 session)

Wrap the loop in a structured harness so the run is auditable and repeatable.

- **Deliverables**
  - `scripts/object-compiler/harness.mjs` — takes a spec (or a prose brief), creates a
    fresh worktree branched from `main`, runs `compile.mjs`, computes reward
    (`test:room-contract` binary × `test:routes` binary × `test:paint` binary ×
    `next build` binary × `test:guide` binary — five-bit vector plus a scalar), logs
    the whole run to `data/object-compiler/runs/<timestamp>-<key>/`.
  - **Soft-failure retry** — if only one contract fails (e.g. an unbound global
    verb), a single re-fill of the failing slot is allowed; the retry counts as one
    run, its reward is the retry's, and the log preserves both attempts.
  - **Never** — no auto-merge, no auto-push, no `git commit`. The harness's output is
    a branch and a log; a human still opens the PR.
- **Done when** — one full run on M4's target reproduces its reward end-to-end, with
  the run log complete.

### M6 — The Ecology Loop (open-ended; blocked on ≥20 compiled rooms)

Turn CT-2 on. Boltzmann-reweight the generation *strategy* — the retrieval bank, the
prompt structure, the slot decomposition — after enough compiled samples exist.

- **Deliverables**
  - `data/object-compiler/strategies.jsonl` — one line per strategy tried, with the
    reward it accrued across runs.
  - `scripts/object-compiler/reweight.mjs` — CT-2 update on the strategy distribution
    given accumulated reward.
- **The reward is stationary** — the site's own tests do not move under the
  compiler. That is what makes the CT-2 bound apply. If the tests start moving, the
  loop is off; freeze it and re-verify.
- **Not** — the *schema* itself is not learned here. The schema is fixed at M2 and
  edited by hand when it fails a real room. Learning the schema needs a much larger
  corpus than this project will produce; leave it to a successor project.
- **Done when** — 20+ compiled rooms, at least one Boltzmann update landed, one
  measurable improvement in reward on the held-out prose briefs from M4's remaining
  targets.

### M7 — Diagnostics + Release (1–2 sessions)

Audit the compiler's own coherence and package it as something a stranger could run.

- **Deliverables**
  - `scripts/object-compiler/cocycle-audit.mjs` — a Theory Atlas cocycle check on
    pairs of *adjacent* rooms: for two rooms `A` and `B` on the same band, if the
    compiler generated both, does the shared-system's own invariants (peer circle
    membership, gesture defaults, palette relationships) commute across them? A
    failure names a real bug in the compiler, not just an ugly room.
  - `object-compiler/README.md` — the shareable entry point: what the tool is, how to
    run it against a fresh checkout, what the schema means, where the retrieval
    bank lives.
  - **The retrieval bank is a repo asset** — `object-compiler/reference/` holds the
    five example rooms as canonical `(spec, room)` pairs. That directory is
    checked in; the transcripts and PR logs (`data/object-compiler/`) stay
    gitignored (they are large and personal).
- **Done when** — a stranger cloning `main` can run `node
  scripts/object-compiler/compile.mjs "…prose…"` and land a green PR without editing
  anything under `object-compiler/`.

## Two constraints worth naming

- **Pre-consolidation history is a break in the paired data.** Sessions before
  yesterday's shared-system landing produced rooms that no longer type-check against
  today's contracts. Two options: (a) filter the corpus to PRs whose merge_sha is at
  or after `929efa6`, keeping only the five recent rooms plus whatever refactors
  landed since; (b) retroactively normalize old rooms into today's shape and
  re-derive their spec. Option (a) is safe and small; option (b) is the honest way
  to widen the corpus. Start with (a); revisit at M6.
- **Shareability from M3 onward.** The retrieval bank, the templates, and the schema
  are *repo assets*, not local. Anything under `object-compiler/` is checked in;
  anything under `data/object-compiler/` is gitignored (the corpus is 127 MB and
  contains user paths). A stranger with a fresh clone plus a Claude API key and this
  repository must be able to run M4 without touching M1's data at all — the
  retrieval bank replaces the corpus at inference time.

## What we are not doing

- **We are not learning the schema itself from data.** M2 is hand-authored; a spec
  language stable enough to compile against needs a designer, not a fitter. Schema
  learning is a successor project.
- **We are not building a universal cross-domain compiler.** The hypothesis family
  is this project's shared system. A compiler for a different codebase requires a
  different family and a different corpus. What is portable is the *method*, not
  the artifact.
- **We are not editing the shared system.** `<RoomShell>`, `src/lib/scene/*`,
  `src/lib/webgl/stage.ts`, `src/lib/gesture/defaults.ts` are the fixed target;
  changing them invalidates every paired sample. If they need to change, that
  change belongs on the main site's build lane and this plan pauses until it lands.
- **We are not making an autonomous PR-opener.** The harness lands on a branch. A
  human still reads the diff, plays the room, decides whether to merge. The
  compiler's output is a *proposal*, not a commitment.

## Directory conventions

- `docs/plans/object-compiler.md` — this document.
- `scripts/object-compiler/` — extraction, rendering, slot-filling, harness,
  cocycle audit. Everything callable is here.
- `object-compiler/schema/` — the `room-spec.schema.yaml` plus the five example
  specs. Checked in.
- `object-compiler/templates/` — the Handlebars-shaped file skeletons with the
  three creative slots marked. Checked in.
- `object-compiler/reference/` — the retrieval bank of `(spec, room)` pairs used at
  inference time. Checked in.
- `object-compiler/README.md` — the shareable entry point (M7).
- `data/object-compiler/` — the corpus (`sessions.jsonl`, `pairs.jsonl`), the run
  logs, the strategy history. **Gitignored** — too large and too personal to ship.

Add to `.gitignore` on the M1 PR:

```
# object-compiler private corpus and run logs
data/object-compiler/
```

## Progress log

Future agents append to this section at the bottom of each session. Format:
`## YYYY-MM-DD — <milestone>` with a bulleted list of what got done, what got
learned, and what the next agent should pick up first. Keep it short; if a
paragraph is needed, it belongs in the milestone section above and this file owes
that edit.

<!-- append below this line -->

## The one-line summary

**Object Compiler learns `K: spec → room` from this project's own transcripts and
merges, against the shared system as the fixed target; the reward is `npm test`
plus a landed guide screenshot; three slots (shader, domain law, verb wiring) are
the only creative degrees of freedom, and everything else in a room descends from
a `spec.yaml` by template.**
