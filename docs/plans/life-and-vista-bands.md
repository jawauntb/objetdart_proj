# Build Plan — the life ladder, the flock, the peak, and deep space

Seven new bands, and the re-cut of the axis that makes room for them. Context:
`INSPIRATION.md` §6 (the scale manifold), `docs/plans/scale-manifold-build-plan.md`
(W6 — new bands), `docs/new-room.md` (the method), `docs/gesture-grammar.md`.

The album currently jumps from `/molecules` straight to `/cells` — one pinch
crosses from a water molecule to a living plasm, which is the largest unearned
gap on the axis. Life does not happen in one step. It happens in four: carbon
learns to chain, the chain learns to copy itself, the copies build organs, the
organs make a cell. This plan builds those four rooms, splits the single-cell
band from the multicellular one so the flower has something to grow out of, and
adds three vista bands the axis was thin at: the air above the garden, the peak
above the fog, and the galactic web between the stars and the fold.

---

## 1. The re-cut axis

Nineteen bands. Boundaries at `-9.5` (atoms/molecules), `-3.5` (drop), `0.5`
(flowers ceiling), `4.5` (atlas floor), `22` and `25.5` are **preserved** — so
`/atoms`, `/drop`, `/flowers`, `/atlas`, `/earth`, `/beyond` and `/manifold`
keep their exact spans and nothing about them moves. Every re-cut happens
inside the old `molecules` + `cells` block, inside the old `coast` block, and
inside the old `stars` block.

| band | label | route | sMin | sMax | status |
| --- | --- | --- | --- | --- | --- |
| quarks | quarks | `/quarks` | −19 | −14 | unchanged |
| atoms | atoms | `/atoms` | −14 | −9.5 | unchanged |
| **molecules** | molecules | `/molecules` | −9.5 | **−8.8** | narrowed |
| **organics** | organic molecules | `/organics` | −8.8 | −8.0 | **new** |
| **dna** | dna | `/dna` | −8.0 | −7.2 | **new** |
| **organelles** | organelles | `/organelles` | −7.2 | −5.8 | **new** |
| **cells** | cells | `/cells` | **−5.8** | **−4.4** | narrowed |
| **tissue** | tissue | `/tissue` | −4.4 | −3.5 | **new** |
| drop | a drop | `/drop` | −3.5 | −1.5 | unchanged |
| flowers | flowers | `/flowers` | −1.5 | 0.5 | unchanged |
| **birds** | birds | `/birds` | 0.5 | 2.2 | **new** |
| **coast** | the coast | `/ocean` | **2.2** | **3.4** | narrowed |
| **olympus** | olympus | `/olympus` | 3.4 | 4.5 | **new** |
| atlas | the atlas | `/atlas/origin` | 4.5 | 6.5 | unchanged |
| earth | the earth | `/earth` | 6.5 | 9 | unchanged |
| **stars** | the stars | `/stars` | 9 | **16.5** | narrowed |
| **space** | deep space | `/space` | 16.5 | 22 | **new** |
| beyond | beyond | `/beyond` | 22 | 25.5 | unchanged |
| manifold | the manifold | `/manifold` | 25.5 | 27 | unchanged |

The addresses are honest physics, not decoration: hexane and glucose are
~0.9 nm; a folded protein 4–10 nm; the DNA helix is 2 nm across with a 3.4 nm
turn and an 11 nm nucleosome; a ribosome is 25 nm and a mitochondrion 1 µm; a
eukaryote is ~20 µm; an epithelial sheet is a fraction of a millimetre; a
wingspan is metres and a flock is a hundred of them; a peak stands kilometres
over a valley tens of kilometres wide; the nearest star is 4×10¹⁶ m, a nebula
10¹⁷–10¹⁸, a galaxy 10²¹.

### The doors

Travel follows containment, not size (`TRAVEL_OVERRIDES`). The life ladder
falls out as pure metric adjacency — no overrides needed, because for once
part-of and smaller-than agree all the way down:

```
flower ──▸ tissue ──▸ cell ──▸ organelle ──▸ dna ──▸ organics ──▸ molecule ──▸ atom
```

Three overrides change, and only these:

- `flowers.down`: `cells` → **`tissue`**. A petal *is* tissue; it opens into a
  sheet of cells before it opens into one cell. The old door skipped a rung.
- `tissue.up`: **`flowers`**. Metrically tissue's ceiling touches the drop;
  mereologically a sheet of cells belongs to the thing it is a sheet of.
- `atlas.down`: `coast` → **`olympus`** (metric default, override dropped). The
  map descends onto the peak, the peak descends through the fog, the fog is the
  sea. `coast.down → drop` and `drop.up → coast` are untouched.
- `stars.up`: `manifold` → **`space`** (override dropped; metric default now
  lands on the galactic web). `space.up → manifold` keeps `/beyond` a branch off
  the fold exactly as it is today; `manifold.down` → `space`.

`birds` and `olympus` need **no overrides at all** — the flock's metric
neighbours already are the garden below and the shore above, and the peak's are
the fog below and the map above. That is the tell that they were placed right.

### What this costs

`scaleForRoomZoom` normalises internal zoom across whatever span its band has,
so narrowing `molecules`, `cells`, `coast` and `stars` re-maps their cameras
without touching a line of room code — a pinch inside those rooms simply
traverses its (now shorter) band a little faster. `spectralRegisterFor` is
continuous in `s`, so the audio register glides rather than jumps. Unbuilt
bands already have a defined behaviour: `route: null` and `ScaleTravel`'s
"destination unbuilt — the wall holds" path, so the axis is playable after the
re-cut lands and before a single new room exists.

---

## 2. The rooms

Each is a living room first and a band adapter second. Every one of them
answers the §7 checklist; the entries below record the answers that are not
obvious.

### `/organics` — what carbon does when it has time

**Invariant.** A molecular graph: atoms, bonds, and the free energy of the
arrangement. The room's job is to make *bonding* visible as a thing that
happens rather than a thing that is drawn.

**The map.** Position and bond order → a strain field you can see, a beat
frequency you can hear. Two carbons at the wrong angle beat against each other;
the tetrahedral angle is where the beating stops. **The room is in tune when
the molecule is at its minimum.** That is the invariant carried into sound
without loss — you could recover the geometry from the interval.

**Material.** Carbon, hydrogen, oxygen, nitrogen drift in a solvent of water
you can already see moving. One finger drags an atom; bonds form when valence
allows and snap with a felt click when the geometry settles. Build hexane, then
glucose, then a peptide bond, then hold two amino acids together long enough
and the chain folds on its own — the long-press *is* the folding time.
Extends `lib/chemistry.ts` (real compound library, balanced reactions) and
`lib/atomics.ts` (real shells and covalent valences); the folding law goes in a
new pure `lib/organic.ts`.

**Handoff.** Zoom out through a folded chain and the chain is already the
backbone the helix is made of — `/dna` opens on the same polymer, one level
coarser.

### `/dna` — the ladder that copies

**Invariant.** A base sequence. Everything else in the room is a
representation of it: the helix geometry, the hydrogen-bond count, the
transcript, the sound.

**The map.** Sequence → melody is the load-bearing one, and it is **invertible**
— four bases, four scale degrees, the strand's pitch contour and the strand's
sequence are the same object. Read the melody back and you have the strand.
This is the site's canonical move (the `/light` colour↔music inverse) applied
to the molecule that is literally a code.

**Material.** A helix rendered as instanced geometry in one WebGL pass, breathing
on the shared 7 s clock. One finger unzips it — pull the two strands apart and
the hydrogen bonds break in order, each one a tick you feel and hear. Release
and it re-anneals. Hold a strand open and a polymerase runs the complement; the
melody plays back transposed. Two fingers rotate the helix (the frame). Three
fingers change the world-law: the transcription rate, the mutation temperature.

**Why it earns a band.** Without it the axis says organelles come from
molecules, which is the one place biology genuinely needs an extra rung: the
information is the rung.

### `/organelles` — the organs before the body

**Invariant.** A membrane budget. Every organelle is surface area folded into a
volume, and the room conserves it: pinch a fold flatter somewhere and it has to
go somewhere else.

**The map.** Folded surface → timbre brightness. A tightly cristae-folded
mitochondrion rings bright and complex; a smooth vesicle is a sine. You can
hear how folded a thing is.

**Material.** Mitochondrion, ribosome, golgi, ER, vacuole, nucleus — each a
parametric membrane surface, deterministic from a small latent, drifting in
cytoplasm that flows (reuse `lib/cytology.ts`'s existing plasm streaming).
One finger drags an organelle through the flow and the flow drags back. Long-press
on the nucleus and it opens onto the helix within. Collect the set and the cell
membrane closes around them of its own accord — which is the handoff.

### `/tissue` — when one becomes many

**Invariant.** An adhesion graph over a cell sheet, plus each cell's polarity.

**The map.** Adhesion topology → harmonic consonance. Cells bound in a regular
sheet sound like a chord; a break in the sheet is a dissonance you can hear
before you can see it.

**Material.** A few hundred cells as a soft-body sheet — Verlet constraints on
a fixed timestep with an accumulator, so the sheet is the same sheet at 60 and
120 Hz, rendered as batched passes over typed arrays. Stroke it and cells
divide along the stroke, each daughter taking half the mother's area. A
one-finger dwell draws the sheet in at that point and the sheet invaginates,
which is gastrulation and also just *a beautiful thing a sheet does* — a dwell
rather than a pinch, because pinch belongs to `ScaleTravel` in every room. Held
past the ceremony tier the pit seals into a second layer. Let it run and the
sheet differentiates by position as a front sweeps the morphogen; a three-finger
hold dilates the clock and the front visibly stalls. Its ceiling opens onto the
petal.

### `/birds` — the flock as one animal

**Invariant.** A boid parameter triple (separation, alignment, cohesion) plus
the wind. The flock's *shape* is a deterministic function of it.

**The map.** Flock order parameter → the harmonic series. A scattered flock is
noise; a coherent murmuration collapses onto a single ringing partial. The
sound tells you the order before the eye resolves it.

**Material.** Several thousand birds as GPU point sprites with per-bird wing
phase in the vertex shader; the flocking integrator runs on a fixed timestep in
a typed-array pass, not per-object JS. **The vessel steers the wind** — tilt the
phone and the flock banks into it; shake and it scatters and re-gathers. This is
the strongest gyroscope room on the site after `/coin`, and it is the one where
tilt is unmistakably *the* control. Two fingers rotate the observer; three
change the season, which changes where the flock is going.

### `/olympus` — the wanderer above the sea of fog

**Invariant.** A heightfield seed plus a fog altitude. The whole picture — what
is peak, what is island, what is drowned — is a function of those two numbers.

**The map.** Fog altitude → the sea. Raise the fog and the ridges become an
archipelago; the room is *the same shader family as `/ocean`* with the water
surface set to a level the mountains poke through. That is the handoff anchor
made literal: descend from the peak and the fog you were standing above resolves
into the actual sea.

**Material.** A raymarched heightfield in one fragment shader — FBM ridged
noise, analytic normals, a single sun, aerial perspective, volumetric fog with
a real height falloff. Cheap because it is one fullscreen quad and the marcher
is distance-bounded. The figure with his back to us is *not drawn*: you are him,
and the room is the view. One finger turns the head. Long-press draws breath
(the fog thins and settles on the exhale, on the shared 7 s clock). Tilt is the
horizon — the vessel is level with the world. Three fingers move the sun, and
the whole palette follows it from dawn through alpenglow.

**Note.** `/clouds` keeps its cloud-floor scene; its route description moves off
the word "olympus" when this lands, so the two are not confused.

### `/space` — the web

**Invariant.** A dark-matter density field. Galaxies sit where it is dense,
voids where it is not; the visible material is a readout of the invisible one,
which is the actual physics *and* the actual thesis of the site.

**The map.** Density field → sub-bass. The web is heard as the lowest register
on the axis, minute-long LFOs per `spectralRegisterFor` at s ≈ 20.

**Material.** Deterministic structure-formation from one seed: a coarse density
grid, galaxies placed by threshold, each rendered as an instanced sprite with a
procedural spiral/elliptical/irregular profile — no textures, no assets, Hubble
palette from the site tokens rather than from a photograph. Nebulae as raymarched
emission volumes at the near end of the band, novae as rare deterministic
events on the shared clock. One finger parallaxes; long-press on a galaxy pulls
it into resolution (its own spiral arms, then its star systems — which is the
door back down to `/stars`). Three fingers make the dark matter visible, which
is the room's whole argument: the thing doing the work was never the thing you
could see.

---

## 3. How this stays fast, and stays beautiful

**No p5.js.** Deliberate. The house idiom is raw WebGL fragment shaders plus a
2D canvas for surface and interaction (the two-canvas `Sea.tsx` pattern), with
zero animation libraries — that is why every room shares one rAF and one clock
family. p5 brings its own draw loop and its own immediate-mode 2D renderer;
adopting it would mean two clocks fighting over the 7 s breath, ~900 KB of
dependency, and a per-object JS path exactly where these rooms need thousands of
instances. Everything p5 would have been reached for here (flocking, particles,
noise fields) is faster as typed arrays plus one instanced draw call. Law 2 —
procedural over assets — is the same reason.

The performance rules, applied to every room above:

- **One WebGL context per room, one fullscreen quad or one instanced draw.**
  Populations (birds, galaxies, cells, atoms) are typed arrays uploaded once per
  frame, never DOM or SVG per element, never per-object JS objects in the hot loop.
- **One rAF per room, and the hidden band's simulation pauses** during a
  crossfade — the existing `ScaleTravel` discipline, which is why two live
  bands cost roughly one.
- **Fixed-timestep integrators with accumulators**, so the flock and the sheet
  behave identically at 60 and 120 Hz and stay deterministic from their seed.
- **Shader cost is bounded before it is written**: the raymarchers (`/olympus`,
  the `/space` nebulae) get a step budget and distance-bounded loops, and every
  room is checked at 390 px on a real phone before its PR opens.
- **Reduced motion never removes a verb** — it stills the ambient breath and
  keeps every gesture answerable.

And the aliveness rules, which are the point:

- Every room is doing something before it is touched: the fog settles, the flock
  wheels, the plasm streams, the helix breathes, the web drifts.
- Every act lands in **two senses in the same frame** — sight and sound always,
  haptics wherever the hardware allows, through `lib/haptics.ts`'s existing
  vocabulary plus the scale-words.
- Every room speaks the **global gesture bindings** unchanged (one finger the
  material, two the frame, three the world-law, the vessel for tilt/shake/knock/
  breath), mounted through `lib/gesture` — never private pointer wiring — and
  adds at least three discoveries of its own.
- Nothing is explained. If a room needs a caption, the room is wrong.

---

## 4. Sequence

One PR at a time, merged on green, fresh `main` after each — per `AGENTS.md`.

| # | PR | contents |
| --- | --- | --- |
| 1 | `feat(scale): the life ladder and three vistas take their addresses` | the re-cut in `lib/scale.ts`, doors, `test-scale.mjs`, this plan |
| 2 | `feat(organics): carbon learns to chain` | `/organics` + `lib/organic.ts` + test |
| 3 | `feat(dna): the ladder that copies` | `/dna` + sequence↔melody inverse + test |
| 4 | `feat(organelles): the organs before the body` | `/organelles` + membrane budget + test |
| 5 | `feat(tissue): when one becomes many` | `/tissue` + adhesion sheet + test |
| 6 | `feat(birds): the flock as one animal` | `/birds` + flocking law + test |
| 7 | `feat(olympus): the wanderer above the sea of fog` | `/olympus` + heightfield/fog shader |
| 8 | `feat(space): the web that holds the light` | `/space` + structure formation + test |
| 9 | `feat(scale): the ladder sounds its own rungs` | per-band ambient beds, overlook-tree nodes, the `/cells` room consuming `/organelles`' set |

PR 1 is the only one anything else depends on. PRs 2–8 touch disjoint files and
could run in any order; they are listed in ladder order because building them
that way lets each one's handoff anchor be tested against the room below it as
soon as it exists.

`/coin` is untouched — it is already the reference exemplar for gyroscopic and
haptic feel, and every room above is measured against it.
