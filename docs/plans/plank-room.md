# /plank — the floor of the world

The design plan for the album's last room downward: a new bottom band on the
scale axis, below `/quanta`, at the Planck length. Companion to
`docs/plans/scale-manifold-build-plan.md` (the axis this closes) and
`INSPIRATION.md` §6 (the roadmap this finishes the bottom of).

The name keeps the visitor's spelling: a *plank* is a floorboard, and this room
is the floorboard of the universe — the last surface before there is no
"before." The pun is load-bearing, not accidental: every scale above stands on
this floor, and the room renders that literally.

---

## 1. The ordinal decision

The Planck length is 1.6 × 10⁻³⁵ m — log₁₀ ≈ −34.8. Between it and the quanta
band's floor (10⁻²²) physics offers no structure at all: thirteen decades of
desert. The band is therefore honest as one wide address:

```
{ id: "plank", label: "the plank", route: "/plank", sMin: -35, sMax: -22 }
```

placed as `SCALE_BANDS[0]`. Spans stay contiguous; `SCALE_MIN` moves from −22
to −35; the whole audio axis re-normalizes (deliberate — the glissando gets a
deeper floor; `NEUTRAL_LFO_HZ` in `audio-register.ts` is retuned in lockstep,
as its own comment instructs). Nav order derives: the dropdown and gallery gain
`/plank` after `/quanta`, at the very bottom, with nothing hand-sorted.

## 2. What the room is

**The loom.** At the Planck scale, spacetime is not a stage — it is the thing
being woven. The material is quantum foam: a churning, mother-of-pearl froth
where geometry itself boils. The population is **stitches** — closed loops of
space, the spin-network quanta of loop quantum gravity. The visitor does not
decorate the floor of the world; they *weave more world*, and the room shows
the consequence: where the network is dense, the foam calms into something that
can hold still — where it is sparse, there is no space yet, only seethe.

The invariant and its maps (INSPIRATION.md §2): one spin network — a graph with
integer spins on its nodes — rendered as geometry (rings and threads), as sound
(each stitch a grain-voice pitched by its spin; the network a chord), as
calm (the foam-suppression field), and as the travel films at both walls. The
lens rotates between three descriptions of the same graph: the foam (material),
the network (graph), the metric (curvature contours).

## 3. The laws in the material (src/lib/plank.ts, pure, node-tested)

- **Adjacency is space.** Stitches within reach link into the spin network;
  links are the only distance there is. The link graph is symmetric, capped per
  node, deterministic from positions.
- **Fusion conserves spin.** Two stitches drawn together merge into one whose
  spin is the sum of both — a third thing that is neither parent — at the
  spin-weighted midpoint, with a ring of released curvature.
- **Collapse and evaporation.** The ceremony presses a stitch past its limit:
  it becomes a pinprick hole that consumes its own links and evaporates in
  closed-form time τ ∝ j³ (the Hawking scaling), giving its light back to the
  foam grain by grain. This is the room's solemn act and its touch-reachable
  delete, in one gesture, as the checklist requires.
- **The cap unravels.** At 64 stitches the oldest visibly unravels — its links
  release as travelling plucks — never a silent no-op.
- **Determinism.** Births, drift, pair-pops: all `hashSeed`/`mulberry32` from
  the room's small state vector and the room clock. No `Math.random`, anywhere.

`scripts/test-plank.mjs` pins each law falsifiably: spin conservation across
fusion, τ(j) monotone and closed-form (no catch-up loops), link symmetry and
degree cap, same-seed-same-world, cap-retirement order.

## 4. The voice (every verb, no dead ends)

| verb | in this material |
| --- | --- |
| tap | ring the nearest stitch at its spin's pitch; the foam ripples; intensity scales the strike |
| tap ×3 | the stitch buds — a satellite loop pinches off carrying one unit of its spin, linked to its parent |
| tap ×5 | the loom-wave — curvature sweeps the network outward from the strike, each stitch ringing in graph order |
| tap ×n | **coherence** — for one breath the whole foam smooths into the manifold's geodesic grid: the largest scale glimpsed inside the smallest, under the room's only sub-bass swell |
| two-finger tap | step back — a raised lens lowers; otherwise the soft default |
| three-finger tap | tutti — the whole network sounds its current chord once, softly |
| dwell | weave — threads gather from the foam and close into a new stitch under the finger |
| deepen | the held stitch's spin keeps climbing; pitch descends, ring thickens — continuous past every tier |
| settle | release commits the stitch at the spin it reached; it links, and the chord answers |
| ceremony | collapse: the pressed stitch becomes a pinprick hole and evaporates in τ ∝ j³ |
| drag | stir the foam — a curvature wake that advects nearby stitches |
| flick | throw the nearest stitch, links stretching elastically — the hand's road to fusion |
| scrub | frame-dragging — winding twists a vortex into the metric; stitches orbit it |
| span | a standing wave held between two still fingers — wavelength from the spread, amplitude from the hold |
| twist | the lens: foam ↔ network ↔ metric, continuously |
| three-finger twist | the epoch — vacuum energy dialed between cold calm and Planck-era fury |
| three-finger drag | wind — metric shear streaming the foam and the weave |
| three-finger hold | time dilation — the churn slows toward frozen, and the foam's instantaneous structure becomes legible for the first time |
| rhythm | the foam's churn entrains to the tapped tempo |
| shake | vacuum fluctuation burst — virtual pairs pop; the weakest links snap |
| tilt | curvature gradient — the weave hangs and sags like fabric under real gravity |
| knock | a knock on the underside of the floor — one deep thud through every thread |
| flip | night — the loom rests |
| drum / arpeggio / breath | the shell's soft acknowledgements (stated exemptions: a patter and a roll land as strikes; the candle belongs to the chrome) |

Three-plus discoveries within a minute: the bud at three taps, fusion by flick,
the vortex, the standing wave, the frozen foam under a three-finger hold.

## 5. The bottom wall — the determination

The axis used to end in silence: at the absolute floor, `stepScale` refused to
call a wall a wall (`i > 0`), so a pinch down died with no detent, no pressure,
no door. The determination made here:

**The floor is a door, and it opens onto the manifold.** Below the smallest
length there is no smaller — there is only the whole. Pressing through the
plank's floor with the same sustained intent as any crossing travels to
`/manifold`: the ouroboros closes, and the axis becomes a loop. This is stated
in the cosmology (`TRAVEL_OVERRIDES: plank.down = manifold`), and honored by
one principled change in the physics: a wall at the axis's end is a travel wall
whenever the travel graph declares a neighbor beyond it — the crossing event
takes its destination from `travelNeighbor`, not the array index, and carries
its direction explicitly so the arrival enters the manifold from its widest
edge. The reverse door exists by the standing swings-both-ways law: pinching
out past the manifold's ceiling falls back into the foam. Both new laws are
pinned in `scripts/test-scale.mjs`.

Why not the homepage: home is already one reach away at the top of every
screen, always; spending the room's one structural exit on a duplicate of the
header would waste the most meaningful edge on the site. The wrap is the
thesis rendered as navigation — the stack is a loop, and the floor of the
world is the ceiling of the world.

## 6. The films

Two edges open, four legs, both filmed as pure functions of `u` and a seed —
the return legs replay backward onto the same frames.

- **`quanta ↔ plank` — "loom."** The descent through the desert: the field's
  ripples thin and grain, thirteen decades of dark fall ticked by passing
  scale-lines, then the foam boils up from below and the first threads of the
  weave catch the light. Spine budget (≈2.2 s / 850 ms reduced).
- **`plank ↔ manifold` — "ouroboros."** The crossing that closes the axis: the
  foam's cells knit and smooth, the weave tightens into a geodesic grid, and
  the grid curves away as the fold seen from outside — the smallest turning
  inside-out into the largest.

## 7. Performance budget

One GL stage, two passes: the foam as a single fragment shader (fbm octaves
governed by `detailForTier`), the population as one instanced draw (SDF ring
with additive corona; spin as lobe count and glow). Links stroked flat on the
lockstep overlay in one batched path per style — no gradients, no shadowBlur,
no per-frame allocation. Typed arrays at capacity 64; O(n²) pair scan at n=64
is ~2k comparisons; evaporation and drift advance closed-form after a pause;
the shell pauses the frame when hidden. Calm-field reaches the shader as a
fixed uniform array, written in place.

## 8. Copy, kept things, guide

- dropdown: `the floor of the world · where space is woven`
- creates: `a stitch of space` · keeps: `objetdart:plank:v1` · LetGo:
  `let the weave go`
- interacts: stitches link into the spin network that is space itself; two
  drawn together fuse into one carrying both spins; a ceremony collapses one
  into a pinprick hole that evaporates in j³ time, giving its light back to
  the foam.
- guide entry from the manifest; screenshot `public/guide/plank.jpg` via
  `shoot:guide`. `/quanta`'s guide line calling itself "the floor of the whole
  axis" becomes false the moment this band exists and is corrected in the same
  PR, per the documentation law.
