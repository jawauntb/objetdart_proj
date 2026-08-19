# native simulation contract

## purpose

This is the release boundary for a phenomenon that may become authoritative
state. A renderer, interaction prototype, or attractive approximation is not a
simulation contract. The contract is the versioned account that lets the same
seed, events, and model produce comparable scientific and sensory results on
TypeScript reference tooling and the native authority.

Release 1 has exactly three proof contracts: `wave`, `cell`, and `solar`.
Their machine-readable declarations live in `@objet/universe-contracts`; this
document distinguishes that settled structural schema from the evidence that
later makes its scientific claims credible.

## required contract facts

Every Release 1 scene has all six top-level `requirements`. The settled
machine shape is `{ version: 1, status: "required", summary, evidence }`.
`evidence` carries immutable `evidenceIds`, a `reviewerId`, and
`approval: { status: "required" | "approved", evidenceId }`; science adds
`sourceIds`. It is a release obligation marker with traceable review links,
not a second detailed model. The model detail remains in `simulation`,
`style`, and the event/checkpoint contracts.

| fact | minimum content | release question it answers |
| --- | --- | --- |
| `science` | summary plus evidence IDs, reviewer ID, approval link, and real stable source IDs | what relationship is true, and where does the reduced model stop claiming truth? |
| `sensory` | summary plus evidence IDs, reviewer ID, and approval link; points to `simulation.perceptualMappings` and `style.stateToSense` | does the same lawful event reach at least two senses without inventing a cause? |
| `persistence` | summary plus evidence IDs, reviewer ID, and approval link; points to semantic actions, universe/checkpoint contracts, and history | can an event survive relaunch and replay as the same causal event? |
| `accessibility` | summary plus evidence IDs, reviewer ID, and approval link for semantic actions and focused summaries | can a visitor perform and understand the core relation without canvas-only or multi-finger-only access? |
| `guide` | summary plus evidence IDs, reviewer ID, and approval link for the sought reveal and felt-proof sequence | can a visitor discover the relation before explanation and later name it accurately? |
| `performance` | summary plus evidence IDs, reviewer ID, and approval link for device budgets and measurements | does the authoritative model stay usable without a second physics path? |

The package exports `RELEASE_SCENE_MANIFEST`: every entry has `version`, `id`,
`release`, `scale`, `sharedIdentity`, `simulation`, `style`, and
`requirements`. `sharedIdentity.parameter` is
`equilibrium-temperature-k`; `simulation.id` and `style.id` identify the same
scene. The scope test rejects a missing, empty, unversioned, optional, or
evidence-free requirement, and rejects invalid simulation or style structures.

## settled simulation structure

`simulation` is the detailed, executable science schema. It contains exactly
the versioned identity (`version`, `id`, `model`, `modelVersion`), `units`,
`integrator`, `invariants` with numeric tolerances, `conservedQuantities`,
`validity` ranges with disclosures, `interventions`, `seededVariance`,
two-or-more-sense `perceptualMappings`, `referenceCases` with tolerances, and
`approximations`. It intentionally does not duplicate citations or reviewer
names: `requirements.science.evidence.sourceIds` and each requirement's
`evidence.reviewerId` carry those traceable links.

`style` separately carries the perceptual art contract: field, palette, form
language, motion, banned forms, state-to-sense mappings, and gesture feedback.
The style and simulation validators must both pass before a scene can count
toward the release manifest.

## sources and approval evidence

The source IDs below are the canonical scientific reference set. They are
defined in `docs/native/scientific-references.md` and must appear verbatim in
the matching scene's `requirements.science.evidence.sourceIds`; labels such as
`scientific-references:wave` are not scientific source IDs and are invalid.

| scene | source IDs |
| --- | --- |
| `wave` | `wave-fdtd-taflove-hagness-2005`, `wave-cooley-tukey-1965`, `wave-nist-dlmf` |
| `cell` | `cell-turing-1952`, `cell-murray-2002`, `cell-alberts-2022` |
| `solar` | `solar-murray-dermott-1999`, `solar-wisdom-holman-1991`, `solar-hairer-lubich-wanner-2006` |

Before release candidate status, each scientific review record identifies the
scene and model version, reviewer, decision date, cited source IDs, reviewed
reference cases and validity range, approximation disclosures, perceptual
mappings, and approval decision. Its immutable identifier appears in
`requirements.science.evidence.evidenceIds`, and its approving decision appears
in `requirements.science.evidence.approval`. The same record is used by release
evidence; a fixture passing only proves conformance to the stated reduced model.

The minimum review record is a durable artifact with this shape (the storage
path is chosen by the release-evidence lane, not by a playable scene):

```yaml
scene: wave | cell | solar
modelVersion: v1
reviewer: named scientific reviewer
reviewedAt: ISO-8601 timestamp
sourceIds: [stable IDs from scientific-references.md]
referenceCases: [simulation reference-case IDs]
validityReviewed: true
approximationsReviewed: true
perceptualMappingsReviewed: true
decision: approved | changes-requested | rejected
approvalEvidence: immutable evidence or report identifier
```

Only `decision: approved` with a non-empty `approvalEvidence` satisfies the
scientific review gate. Review provenance must never be inferred from a green
fixture or a present source citation.

## shared authority rules

- The event log and checkpoints are the authority. Render interpolation,
  particles, audio scheduling, and haptic envelopes derive from committed
  event state and never become hidden state.
- The native authority records wall time only as an explicit, quantized event
  input. Frame rate, animation timing, and device clock reads never alter the
  simulation implicitly.
- A continuous gesture may update a reversible preview at display rate, but
  records a versioned 20 Hz path in monotonic 250 ms chunks plus a final
  boundary. Discrete actions append exactly once.
- A scene emits semantic actions to the shared universe writer. It does not
  own SQLite, CloudKit, a private clock, or a private random source.
- Fold and passage previews are frozen, reduced, or derived representations.
  Only the inhabited scene runs an authoritative solver.

## fixture policy

Reference fixtures are generated by
`scripts/native/generate-reference-fixtures.mjs` into
`scripts/native/fixtures/`. They are canonical JSON inputs and expected outputs
for language-independent tests, not serializations of renderer state.

- `wave-reference.json` contains finite-difference and spectral cases from
  the pure wave law: impulse propagation, coherent reinforcement and
  cancellation, and transform/reconstruction values.
- `cell-reference.json` characterizes deterministic morphology, lineage,
  nutrient allocation, engulfment, and bounded absence from `cytology.ts`.
- `solar-reference.json` characterizes Kepler position/velocity, seeded
  systems, orbital energy/angular-momentum invariants, and accretion
  identities from `orbits.ts`.

Each fixture declares `fixtureVersion`, `contractVersion`, `scene`,
`modelVersion`, `simulationVersion`, `seed`, `units`, `referenceCase`, and an
explicit comparison policy. `scripts/test-native-fixtures.mjs` regenerates
them into a temporary directory, checks every byte, then verifies the contract
version, scene, model version, simulation version, units, and policy shape
against the manifest.

Wave and solar references use an absolute tolerance appropriate to their
stated model case. The cell reference uses `kind: "mixed"`: seeds, daughter
and engulfment identities, booleans, and declared integer morphology/lineage
fields compare exactly; every remaining finite numeric output compares with
relative tolerance `1e-9` and absolute tolerance `1e-12`. This keeps causal
identity exact while acknowledging that cross-language `sin`, division, and
fractional culture calculations are not portable as JSON bytes. A fixture
change requires a model-version or evidence change, never a silent snapshot
refresh.

## approval boundary

Physical-device evidence separately verifies the sensory, accessibility,
persistence, and performance requirements. Passing a fixture means only that
an implementation agrees with its stated reduced model; it does not by itself
approve a scientific claim or promote a horizon family.
