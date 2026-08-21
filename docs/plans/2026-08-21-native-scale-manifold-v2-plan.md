---
title: "feat: playable scale-manifold v2 — cosmic garden and genome lenses"
date: 2026-08-21
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: docs/plans/2026-08-19-1352-feat-native-cosmogony-garden-plan.md
execution: code
---

# Playable scale-manifold v2

## Goal capsule

Promote the merged wave/cell/solar proof into the first genuinely playable
cosmogony loop without adding a fourth authoritative solver. The player moves
through lawful representations of the same inhabited state: galaxy birth,
stellar nursery, planetary surface, Earth-like biosphere, cellular colony,
membrane exchange, genome inheritance, and protein form.

This is an expansion of the three-scene foundation, not a claim that the full
cosmic-deep-time or abiogenesis horizon is complete. Full nuclear chemistry,
abiogenesis, ecology, and explorable terrain remain in
`docs/native/post-validation-horizon.md` until their evidence gates are met.

## Product shape

- **Form:** an artwork that plays like a keeper game: the visitor tends one
  persistent universe, proposes interventions, and unlocks agency by causing
  observable relationships. There are no coins, XP, streaks, or punitive
  resets.
- **Loop:** touch or hold → observe a lawful response → inspect a new lens →
  use the new lens to make a stronger intervention → return through the trail.
- **Cosmic band:** solar lens 0 is galaxy, 1 star, 2 planet, 3 Earth. The same
  deterministic orbital state is projected differently; changing the lens
  never creates a second universe.
- **Life band:** cell lens 0 is colony, 1 membrane, 2 genome, 3 protein. The
  reaction-diffusion state remains authoritative; genome and protein are
  derived projections with explicit approximation language.
- **Keeper progression:** each scene begins with one available lens. Repeated
  answered interventions and a ceremony unlock later lenses. Unlocks persist
  locally and remain recoverable through the trail.

## Acceptance criteria

1. Solar lens changes visibly and deterministically among galaxy, star,
   planet, and Earth projections; the orbit kernel remains the only authority.
2. Cell lens changes visibly and deterministically among colony, membrane,
   genome, and protein projections; genome/protein remain derived fields.
3. A new player can discover the next lens from the fold without reading a
   long tutorial; locked lenses explain the next material act that will open
   them.
4. Progress survives relaunch, malformed files recover to a safe initial
   state, and each state-changing event remains in the bounded trail.
5. VoiceOver actions, touch, haptics, audio, and visual projections continue
   to enter the same semantic command path.
6. The route never presents a dead chip, a fake physics claim, or a full-horizon
   destination that has not been implemented.
7. TypeScript, lint, native workspace contracts, Swift kernel tests, fixtures,
   Expo prebuild, and CI all pass before merge.

## Implementation units

### U-V2-1 — keeper progression

Add a versioned local progression envelope with pure transition functions.
Count only answered scene events, keep thresholds scene-specific, serialize
through the existing file-system write queue, and make malformed or old state
fall back to the initial unlock. Add unit tests for unlock order, idempotence,
and recovery.

### U-V2-2 — cosmic projections

Extend the solar kernel's four representation detents with deterministic
galaxy density, stellar nursery, planetary terrain, and Earth-like atmosphere
projections. Keep orbital bodies and energy bookkeeping authoritative; expose
the material family and representation through the existing scalar submission.
Add stable seeded reference tests.

### U-V2-3 — life projections

Extend the cell kernel's four representation detents with membrane gradients,
procedural double-helix inheritance, and bounded protein-fold projections.
Keep Gray–Scott concentrations and lineage state authoritative; disclose the
derived nature in the fold copy and guide. Add stable seeded reference tests.

### U-V2-4 — fold and flow

Make fold content scene-aware, show the next keeper act for locked lenses, and
make unlocked lens selection use the same native representation command. Keep
scene travel explicit and preserve the existing trail and guide focus rules.

### U-V2-5 — release verification

Pin the v2 contracts in native workspace assertions, run the full local gates,
run the code review gate, ship through a PR, and verify both Native CI jobs.

## Explicit exclusions

No new SceneID, CloudKit sync, full planet terrain map, molecular chemistry,
abiogenesis solver, multiplayer branch merge, or new renderer abstraction is
part of this chunk. Those remain horizon work after this band proves its
playability and comprehension.
