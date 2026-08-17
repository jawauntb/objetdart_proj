# Notes — metaphysics corpus → rooms

Agent-readable. Written 2026-08-17 after reading the Metaphysics of Intelligence
papers, the author's notes (intention / DRCA / CS-as-causality), objet d'art
docs, existing rooms, and Weyl *Symmetry* (Princeton 1952; IA scan
`2015.84215.Symmetry.pdf`, 184 scanned pages, no embedded text).

**The plan that must be followed is** `docs/plans/fibration-eigen-group.md`.
This file is the evidence. Do not invent a third program.

---

## 1. Master object (the whole corpus)

A **stochastic fibration with a compiler**:

- `q : X → Z` — coarse-graining. Which concrete differences do not matter.
  Fiber `q⁻¹(z)` = embodiments of structure `z`.
- `K : Z ⇝ X` — compiler kernel, `supp K(·|z) ⊆ q⁻¹(z)`. Samples a
  realization rather than naming one.

Derived (SIC Theorem 1) from Halmos–Savage minimal sufficiency, not posited.
`INSPIRATION.md` §2a already writes this as `R ──q──▶ S ──ι──▶ R'`. `/loom`
(`src/lib/structure.ts`) is **`K`**: one `S` compiled into five substrates.
The visitor still cannot **walk the fiber, drift on it, or choose a section**.

Hand-feel, no captions:

| paper verb | hand |
| --- | --- |
| two embodiments of the same `z` | different hue / register / petal count, same phase jump |
| drift (drunken sailor) | shake / idle samples `K` on the fiber |
| intention (section) | ceremony locks one point of the fiber |
| holonomy (CG-2) | a loop of fibers comes home rotated, or not |
| constraint collapse | pour attention; only some directions still move |
| incomplete orbit | missing poses; a transform that closes the fragment locks |

---

## 2. Weyl *Symmetry* (1952) — what matters for `/group`

Scan is image-only (tiff2pdf, encrypted copy). Identified from title page +
preface. Load-bearing sentence (preface):

> symmetry is the **invariance of a configuration of elements under a group
> of automorphic transformations**.

The book's own ladder is the room's **twist-lens**, never labeled chapters:

1. **Bilateral** — reflection in a plane (left/right). Living forms break it
   (inversive regeneration; Ludwig's competing R/L gradients). Broken
   symmetry is a first-class event, not a bug.
2. **Translatory / rotational** — repeats along a line; cyclic groups.
3. **Ornamental** — wallpaper / frieze; generators compose.
4. **Crystallographic** — discrete groups of isometries. `/rocks` already
   *is* this layer (point groups, `symmetryOps`, cleavage orbits). `/group`
   must not restage the mineral shelf.
5. **Abstract group** — identity, inverse, composition; automorphism of a
   configuration. Appendix: finite rotation groups in 3-space.

Cover figure: hexagonal (6-fold) snowflake — `D6` / `C6`. Left sharp / right
dissolving is accidentally the fiber picture (structure vs sampled kernel).

**Do not put Weyl's name, "automorphism", or "Cayley" on the canvas.** The
guide may say "a move that leaves the figure itself."

---

## 3. Papers → playable claims (ranked)

| # | claim | paper | playable | classroom fake |
| --- | --- | --- | --- | --- |
| 1 | Weakness (symmetry-compatible volume) predicts OOD, not loss/MDL/flatness | `1_Weakness_Predicts_OOD` | two train-perfect habits; only the one that still commutes with more of `Ĝ` survives missing poses | simpler/shorter/flatter winning |
| 2 | The group is inferred from incomplete orbits, not an oracle | `2_Learning_the_Group` | see 3 of 8 poses; a transform that maps same-class→same-class joins `Ĝ`; held-out 5 become reachable | labeled `Z_8`, Cayley table |
| 3 | Sufficiency-then-compress finds the invariant; MDL and accuracy miss it | SIC Fiber Finder | squeeze a cloud against a live task; squeeze to a point → task dies; don't squeeze → noise | "smaller is smarter" |
| 4 | Concern reweights `K` on the fiber; distinctness is Fisher | CG-1 | hold deepens `β`; two concerns split in pitch/corona when KL is felt | a slider named concern |
| 5 | Path-dependent concern = nonzero holonomy | CG-2 | heading around a fiber-loop mismatches on return iff no global potential | compass that always resets |
| 6 | Effective allocation dimension ≠ physical dimension | `28_Effective_Dimension_Law` | a 2-D field still spends like a 1-D trough | heatmap that "looks 2-D" as the law |
| 7 | ICA: independence + non-Gaussian fixes the rotational gauge; PCA does not | SIC Thm 7 | mixed sources stay free until a non-Gaussian snap | covariance arrows, numbered λ |
| 8 | Constraint → pretty geometry → behavior **failed** | Constraint_Swap | a shortcut can solve the task while the cloud stays unaligned | "the rule carves an arrow in the blob" |
| 9 | Availability ≠ use | commitment_surface / Gauge-Fixed | ceremony that kills an axis must change the **action**, or the axis was a footprint | probe-glow as proof |

**Already embodied (do not duplicate):**

- `/loom` — structure compiler, five substrates, conserved quantity, hysteresis
- `/viruses` — Caspar–Klug icosahedral group, T-ladder, template copy
- `/rocks` — crystallographic point groups, reciprocal lattice as timbre
- `/flowers` — phyllotaxis symmetry
- `/spring` — eigen-split of aquifer/pool (`D = H−L`, `Σ = H+L`)
- `/quarks` `/nucleons` `/molecules` — real constraint
- compass — geometry under concern
- `/sine` `/circularity` — coast **instruments** (classroom feel; do not copy panels)

---

## 4. Author notes (images) — keep out of rooms

- "Computer science studies how meaning and causality can be formalized and
  implemented in matter" — already `INSPIRATION.md`. Not a caption.
- DRCA (Difference, Relation, Constraint, Art) — framework, not a room.
- "Intention is all you need", Searle, Haugeland, Brentano, stochastic parrots
  — `/guide` only if anywhere.
- Drunken sailor = drift on the fiber. Choosing one path = a section.
- Hierarchy of 1st/2nd/3rd-order intention — later, not `/eigen`/`/group`.

---

## 5. Placement

`/eigen` and `/group` are **SCALE_EXEMPT law-rooms**, same class as
`/relativity` and `/loom`:

```
place: { kind: "exempt", why: "a law, not a place — …" }
address: { exempt: "…" }
chrome: "none"          // page uses <RoomShell chrome={false}>
frame: "yield"
```

Not a band. Not a peer of `/viruses` or `/rocks`. Not `/sine` on the coast.

Registration (both required; a manifest does **not** auto-enter the gesture
contract):

1. `src/rooms/<key>/room.config.ts` + import in `src/rooms/registry.ts`
2. `src/lib/room-registry.ts` `RoomEntry` (order must match `SITE_ROUTES`)
3. `manifestRoute("<key>")` next to `relativity` in `src/lib/routes.ts`
   so the exempt tail stays with the other laws
4. thin `src/app/<key>/page.tsx` + `layout.tsx`
5. `src/lib/<domain>.ts` + `scripts/test-<domain>.mjs` + `package.json`
6. `public/guide/<key>.jpg` (`npm run shoot:guide -- --only=<key>` before merge)

Copy **relativity's page** (no AxisChrome) + **zeus's RoomShell + tap ladder**.
Do not copy CircularityFourier preset panels.

---

## 6. What `/group` is (and is not)

**Is:** Weyl's automorphism felt as "a move that leaves the figure itself,"
plus Paper 2's incomplete-orbit discovery. A candidate `g` is kept iff it is
approximately label-preserving on the **seen** fragment. OOD = missing orbit
points become reachable only after `Ĝ` is large enough.

**Is not:** Cayley table, icosahedral capsid, mineral point group, organic
functional groups, Local Group galaxies.

Creatable noun: a **mark** (one pose). Generators are inferred, not planted
as labeled buttons.

Interacts (falsifiable by play): two fragments that close under the same
generator **fuse into one orbit** that is neither parent. A rotation-generator
meeting a flip-generator yields a **dihedral** orbit (new kind), not a louder
cyclic. A shortcut that does not close the fragment **dies on the missing
poses**.

---

## 7. What `/eigen` is (and is not)

**Is:** the surviving direction after a constraint collapses a cloud.
Weakness / effective dimension / ICA gauge-fix / Fiber-Finder `q`. Capacity
may still spend as ~1-D with two planted constraints (`28`). A pretty axis
that does not change a later **commitment** is a footprint.

**Is not:** 3Blue1Brown `Av=λv`, numbered eigenvalues, PCA arrows, `/spring`'s
hydraulic ledger restaged, "the rule always carves the blob the right way"
(Constraint_Swap failed).

Creatable noun: a **constraint**.

Interacts: two independent non-Gaussian sources **unmix** into separated
sources (third thing; perm/sign leftover allowed). Two collinear / Gaussian /
same-task constraints **collapse to one**. A shortcut constraint can leave the
cloud unaligned while still "solving" — honor Swap.

---

## 8. Fiber program (not these two rooms)

Deepen `/loom` so the fiber is walkable (shake→drift, ceremony→section), then
holonomy if that still fits one field. Sibling law-room only if the
five-compiler table and the fiber cannot share a canvas. Name it as a place
(`/veil`, `/strand`, `/section`) — never `/stochastic` or `/fiber`.

W7 twist-lens (scale plan) remains the site-wide "same thing, different
description." `/group`'s twist is Weyl's ladder; `/eigen`'s twist is
cloud ↔ quotient. Do not invent a private dialect.

`/viruses` incomplete-orbit deepening is a later PR, not a rename of `/group`.

---

## 9. Tests that catch a fake

**`/group`:** complete orbits on first paint → fail. `e.count` 1 and 5 same
effect → fail. Objects never fuse → fail `interacts`. `Math.random()` in the
orbit law → fail. On-canvas "group / Z_8 / Cayley" → fail. Capsid T-numbers
→ fail. Pixel-permute must not unlock OOD.

**`/eigen`:** PCA arrows or labeled λ → fail. Physical-2-D allocation as
success → fail. Constraint always deforms the blob "correctly" → fail.
Ceremony that doesn't change commitment → fail. Same answer at 900ms and
2400ms → fail. Duplicate `/spring` D/Σ → fail.

---

## 10. Sources (paths)

- `/Users/jawaun/Metaphysics of Intelligence/0_geometric_meaning_and_agency.pdf`
- `/Users/jawaun/Metaphysics of Intelligence/structural_intelligence.pdf`
- `/Users/jawaun/Metaphysics of Intelligence/Concern_as_Fiber_Geometry_2026_08_03.pdf`
- `/Users/jawaun/Metaphysics of Intelligence/2_Learning_the_Group_2026_06_09.pdf`
- `/Users/jawaun/Metaphysics of Intelligence/1_Weakness_Predicts_OOD_2026_06_09.pdf`
- `/Users/jawaun/Metaphysics of Intelligence/28_Effective_Dimension_Law_2026_07_02_draft.pdf`
- `/Users/jawaun/Metaphysics of Intelligence/Autocatalytic_Artwork_2026_08_03.pdf`
- `/Users/jawaun/Downloads/2015.84215.Symmetry.pdf` (Weyl)
- `INSPIRATION.md` §2a, §6; `AGENTS.md`; `docs/new-room.md`; this plan
