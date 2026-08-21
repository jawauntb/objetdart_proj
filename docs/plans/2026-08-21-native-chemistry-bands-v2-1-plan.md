---
title: "feat: native atoms and chemistry bands v2.1"
date: 2026-08-21
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: docs/native/post-validation-horizon.md
execution: code
---

# Native atoms and chemistry bands v2.1

## Goal capsule

Extend the playable scale manifold below the cell scene with two honest,
bounded instrument scenes: atoms and molecules. These are not decorative route
ports. Each scene owns one deterministic solver, exposes the same semantic
gesture path as the existing proof scenes, and turns a real relationship into
several readings without claiming a full quantum-chemistry engine.

## Product shape

- **Atoms:** a small periodic register from hydrogen through iron. Touching
  excites an electron shell; pairing two atoms reveals covalent appetite and
  bond order; ceremony fuses light nuclei and makes the binding-energy curve
  perceptible. The four readings are orbit, periodic, bond, and fusion.
- **Molecules:** a curated real-compound field. Touching seeds a compound;
  dragging/holding changes concentration and vibration; ceremony combines
  compatible reactants through a balanced reaction or a deterministic inert
  fallback. The four readings are mixture, structure, reaction, and vibration.
- **Keeper loop:** the two scenes use the existing local progression envelope.
  Each starts with one reading, then unlocks deeper readings through answered
  material acts, one reaction/fusion ceremony, and sustained growth.
- **Continuity:** `/atoms` and `/molecules` are native routes that retain the
  same fold, trail, guide, accessibility actions, haptics, audio, and local
  progress behavior as wave/cell/solar.

## Technical design

1. Add `atoms` and `molecules` to the native scene contract while preserving
   `RELEASE_SCENE_MANIFEST` as the immutable Release 1 three-scene proof. A
   second manifest covers the v2.1 bands and is validated independently.
2. Add `AtomKernel` and `MoleculeKernel` to `ObjetUniverseCore`. Both use
   fixed-size scalar surfaces, fixed-step deterministic updates, bounded
   populations, seeded variation, and checkpoint digests that include scene,
   tick, representation, and the domain ledger.
3. Extend the shared Metal fragment with material kinds for atomic shells and
   molecular bonds. The shader may stylize visibility, but it receives only
   the kernel projection and never invents identities or reactions.
4. Extend the Expo scene factory, route selection, fold labels, guide notes,
   progression normalization, and native workspace assertions. Old v1 local
   progress migrates by preserving wave/cell/solar counts and adding empty
   atom/molecule records.

## Acceptance criteria

- Same seed and command trace produces identical atom/molecule checkpoints on
  every run and across all supported devices.
- Atom identities remain within Z=1…26, shell counts sum to Z, noble gases do
  not form covalent bonds, bond order follows the lesser valence, and fusion
  energy rises toward iron before turning negative beyond the supported range.
- Molecule identities come from a curated real-compound table, formulas and
  depicted bonds agree, reactions are order-independent, and population caps
  prevent unbounded allocation.
- Every representation is visibly distinct in the scalar projection and in the
  Metal material; locked lenses cannot mutate the kernel.
- Touch, VoiceOver actions, haptics, audio, fold, trail, and guide all share
  the existing semantic command boundary.
- TypeScript, lint, native workspace contracts, focused Swift tests, the full
  Swift host suite, Metal compilation, Expo prebuild, and CI pass.

## Explicit exclusions

No quantum-field solver, molecular-dynamics engine, reaction-network search,
thermodynamic equilibrium optimizer, abiogenesis model, protein folding solver,
CloudKit sync, or new renderer abstraction is included. The web chemistry and
atomic law modules remain the scientific reference inputs, not runtime
dependencies.

## Implementation units

- **U-CHEM-1 — contract and progression:** scene IDs, v2.1 manifest, styles,
  guide fallback notes, persisted progress migration, and route contracts.
- **U-CHEM-2 — atom kernel:** periodic table subset, excitation, covalent pair,
  fusion ledger, four projections, and focused invariants.
- **U-CHEM-3 — molecule kernel:** curated compound/reaction subset, bounded
  field, reaction ceremony, four projections, and focused invariants.
- **U-CHEM-4 — native integration:** scene factory, routes, fold labels,
  accessibility labels/actions, and Metal material branches.
- **U-CHEM-5 — verification and release:** static workspace contracts, native
  host suite, prebuild determinism, lint/typecheck, review, and CI merge.

## Definition of done

The two routes are playable from first touch through a reaction or fusion,
their deeper readings unlock and persist, the same scientific state drives the
visual/audio/haptic response, and all acceptance checks pass without regressing
the original three proof scenes. The horizon family remains marked as
unvalidated until physical-device comprehension and scientific review evidence
are recorded separately.
