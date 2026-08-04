# Object Compiler

An internal meta-tool that turns a paragraph of intent into a landed room on
this site. It learns the compiler `K : (spec, objects, details) → room-code`
from paired data this project has already produced — Claude Code session
transcripts, git history, and `/guide` screenshots — against the shared system
as a fixed target (`<RoomShell>`, `src/lib/scene/*`, `src/lib/webgl/stage.ts`,
`src/lib/gesture/defaults.ts`, `src/rooms/registry.ts`,
`src/lib/gesture/defaults.ts`). The theoretical frame is *Compiler Tomography*
(2026-08-03). The reward is the site's own test bar: `tsc` + `npm test` +
`next build` + a landed `/guide` screenshot.

The Object Compiler is **not** a general code generator. It compiles rooms
into this album, against this shared system, using this project's own writing
as the retrieval bank. The compiler's "hypothesis family" is exactly the five
recent rooms shaped by yesterday's consolidation — atmosphere, solar, soil,
planets, galaxy — and that finiteness is what makes CT-1's identifiability
guarantee apply. A room outside the current shell (a Framer prototype, a
different repo, a route that hand-mounts its own chrome) is not a target for
this tool.

## Quick start

```bash
pip install pyyaml            # only the slot-fill / spec-from-prose paths use YAML
python3 scripts/object-compiler/compile-room.py --prose "A room where a sheet of copper is heated until its resonance modes ring out as sound, and the palette drifts from cold slate to a hot rose."
```

The compile-room script writes into a fresh worktree, marks its three creative
slots (shader body, domain law, verb wiring), fills them by prompting the LLM
against the retrieval bank at `object-compiler/reference/`, and leaves a branch
for a human to review. Nothing is auto-merged. Nothing is auto-pushed.

To run the full auditable loop (M5), wrap it in the harness:

```bash
python3 scripts/object-compiler/harness.py --prose "..." --branch harness/copper-1
```

That produces a JSONL log in `data/object-compiler/runs/` with per-layer
outcomes, per-attempt retries, the final diff-stat, and a scalar reward.

## How the pieces fit

```
spec (yaml)                            <-- M2. Hand-authored today.
    │
    ▼
scripts/object-compiler/compile-room.py <-- M3–M4. Template pass + 3 LLM slots.
    │        (spec → skeleton → filled)
    ▼
worktree at .claude/worktrees/…
    │
    ▼
scripts/object-compiler/harness.py     <-- M5. tsc + tests + build + guide;
    │        reward = 0.3*tsc + 0.3*npm_test + 0.2*build + 0.2*guide
    ▼                                          runs logged one JSONL per attempt
data/object-compiler/runs/*.jsonl
    │
    ▼
scripts/object-compiler/ecology.py     <-- M6. CT-2 Boltzmann update on the
    │        (>=10 runs required)              strategy distribution.
    ▼
data/object-compiler/strategy.yaml     <-- next compile-room run reads this.

scripts/object-compiler/cocycle-audit.py <-- M7. Reads example specs across a
                                             peer circle; classifies discrepancies
                                             as glue / phase transition / missing
                                             latent per Theory Atlas TA-2.
```

Every script supports `--help`. Everything under `object-compiler/` is a repo
asset — schemas, templates, and the retrieval bank of `(spec, room)` pairs.
Everything under `data/object-compiler/` is gitignored: the extracted corpus
is large and contains user paths, and the run logs are per-machine.

## How to add a new room spec by hand

Copy an existing example under `object-compiler/schema/examples/`, edit the
fields, then compile:

```bash
cp object-compiler/schema/examples/soil.spec.yaml my-room.spec.yaml
# edit key, route, palette, domain intent brief, verb briefs, guide prose
python3 scripts/object-compiler/harness.py --spec my-room.spec.yaml
```

Fields the schema pins (see `object-compiler/schema/room-spec.schema.yaml`):

- `key`, `route`, `placement` (scale band, or peer-circle seat)
- `sigil`, `cluster`, `palette` (bg, bg2, glow, accent, accent2, ink)
- `domain` — the physics module name and a one-paragraph intent brief
- `objects` — the `SceneObjectSpec` fields the room grows
- `verbs` — a map of global verb → one-line behaviour brief
- `guide` — title, scale, essence, moves, finds, keeps
- `ambient` — audio profile
- `axis_edit` — band or peer-circle patch, if the room needs to change the axis

Only the three creative slots (`SHADER_BODY`, `DOMAIN_LAW`, `VERB_HANDLERS`)
are LLM-authored. Everything else — the manifest, the page shell, the layout,
the ambient wiring, the registry patch, the test scaffold — descends from the
spec by template. If a field cannot be recovered from the spec, either the
spec needs the field or the field is a template constant.

## How the compiler learns over time

Under CT-2 (Compiler Tomography, Theorem CT-2), the Boltzmann update

```
K_{t+1}(dx | s)  ∝  K_t(dx | s) · exp(β · r(s, x))
```

is monotone-improving in expected reward *for every s*, with equality iff the
reward is constant on the fiber. `ecology.py` applies exactly this update to
the coarse strategy grid (temperature, n-shot count, retrieval top-k, repair
tries, template variant) whenever ≥10 runs have accumulated. The parameter
`--beta` picks the exploration-exploitation dial: `β → 0` is the identity
update, `β → ∞` collapses to the empirical argmax. Default `β = 1.0`.

The reward is *stationary* — the site's own tests do not move under the
compiler. That is what makes CT-2's bound apply. If the tests start moving,
the loop is off and the harness must pause until they stabilise.

## Diagnostics

`cocycle-audit.py` implements the M7 Theory Atlas diagnostic. For a triple of
rooms in a peer circle, it computes the cocycle discrepancy on their spec
fields and classifies (per Theorem TA-2, §3):

- **glue** — the compiler is self-consistent across those rooms.
- **phase transition** — a legitimate boundary; document the edge.
- **missing latent** — the schema is quotienting over a coordinate all charts
  are implicitly hiding; add a new field.

A `missing_latent` verdict is a *schema* signal, not a *code* signal — it does
not fail the build, but a future schema edit should carry it into the spec.

## Reference

- Theory: `docs/plans/object-compiler.md` — the plan doc, the seven milestones,
  what is and is not in scope.
- SIC papers: `~/Metaphysics of Intelligence/`
  - `Compiler_Tomography_2026_08_03.pdf` — CT-1 (MDL identification) and CT-2
    (Boltzmann monotone improvement).
  - `Theory_Atlas_2026_08_03.pdf` — TA-1 (cocycle necessary and sufficient
    for gluing) and TA-2 (cocycle failure classifies obstructions).
  - `Structural_Intelligence_Conjecture_2026_08_03.pdf` — the general frame:
    which structures a system can be about, which it can host.
- Site law: `AGENTS.md` (executable rules), `INSPIRATION.md` (§2, §4),
  `DESIGN.md` (how a room is put together).

## Disclaimer

This compiler is bound to this project's shared system. `<RoomShell>`, the
scene object model, the gesture defaults, the axis, the peer circles — those
are the fixed hypothesis family it learns *against*, and changing them
invalidates every paired sample already collected. A compiler for a different
codebase would require a different family and a different corpus. What is
portable is the *method* (spec → template + three slots, harness-scored,
Boltzmann-reweighted, cocycle-audited); the artifact is not.
