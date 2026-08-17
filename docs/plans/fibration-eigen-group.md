# Build Plan — Fibration, `/eigen`, `/group`

The executable plan for compiling the Structural Intelligence master object
into the album: two named law-rooms first (`/group`, `/eigen`), then the
fiber walk on `/loom`, then W7. Context: `INSPIRATION.md` §2a,
`docs/notes/metaphysics-to-rooms.md` (the reading), `docs/new-room.md`,
`AGENTS.md` (room quality bar). Weyl *Symmetry* (1952) supplies the group
ladder; the papers supply the tests.

**This file is required reading.** A PR that ships a Cayley table, a labeled
eigenvalue, or a `/sine`-style preset panel has not followed it.

## Checkpoint

Work from current `main` of the worktree. Nothing here rewrites history.
Retreat by reverting the room PRs; the docs can stay.

## Shape of the work

```
Lane L  law rooms     /group  →  /eigen     (this file, serial: group first)
Lane F  fiber         deepen /loom → holonomy sibling only if needed
Lane W  W7 twist-lens sea↔equation, light↔music (scale-manifold plan)
Lane V  /viruses      incomplete-orbit discovery (after /group exists)
```

One PR per room. Group before eigen: weakness is feelable only once a live
`G` exists. Fiber is not a rename of either room.

## The album today — every room (snapshot 2026-08-17)

Derived from `ROOM_REGISTRY`, `SCALE_BANDS`, `PEER_CIRCLES`; the code is the
authority and this list owes an edit where they disagree. **82 registered
rooms**: 26 band primaries, 41 same-band peers, 11 laws/lenses, 4 reading
surfaces — plus `/`, and `/compare` + `/reading/[hash]`, deliberately
unregistered. New lanes must not duplicate anything here.

**The spine, top → bottom** (band primary in bold; peers after, ring in
parens):

- manifold 10^25.5..27 — **/manifold** every scale kept in one fold
- beyond 10^22..25.5 — **/beyond** novel wave field · /voids (sky)
- space 10^20.5..22 — **/space** the web that holds the light · /localgroup (sky)
- galaxy 10^17..20.5 — **/galaxy** the spiral disc
- stars 10^13.5..17 — **/stars** the night sky · /comb, /beam (sky)
- solar 10^11..13.5 — **/solar** the solar system
- planets 10^9..11 — **/planets** the neighbourhood
- earth 10^6.5..9 — **/earth** strata · seismograph · /fire (hearth)
- atlas 10^5.5..6.5 — **/atlas** (origin + [region]) the living map · /city (hearth)
- atmosphere 10^4.5..5.5 — **/atmosphere** the air column
- olympus 10^3.4..4.5 — **/mountain** the peak · /clouds, /storm, /zeus (peak)
- coast 10^2.2..3.4 — **/coast** land meets sea · /ocean, /tide, /waves,
  /sine, /circularity, /pretext, /aphros, /reef, /tidepool (shore) · /land (hearth)
- birds 10^0.5..2.2 — **/birds** a murmuration (meadow)
- flowers 10^-1.5..0.5 — **/flowers** petals · /growth (meadow)
- drop 10^-3.5..-1.5 — **/drop** a cosmos in glass · cabinet ring: /seed,
  /coin, /jewel, /tourbillon, /watch, /plasma, /orb, /pulse, /charts, /dither,
  /observe, /gate, /rocks, /pebble, /soil, /root, /spring, /geyser, /marsh, /insects
- tissue 10^-4.4..-3.5 — **/tissue** when one becomes many
- cells 10^-5.8..-4.4 — **/cells** the plasm keeps its own tide
- organelles 10^-7.2..-5.8 — **/organelles** the organs before the body · /viruses (cabinet)
- dna 10^-8..-7.2 — **/dna** the ladder that copies
- organics 10^-8.8..-8 — **/organics** what carbon does when it has time
- molecules 10^-9.5..-8.8 — **/molecules** the bond and the solvent
- atoms 10^-14..-9.5 — **/atoms** probability breathes around a bright nucleus
- nucleons 10^-15..-14 — **/nucleons** the valley makes the elements
- quarks 10^-19..-15 — **/quarks** nothing here can be alone
- quanta 10^-22..-19 — **/quanta** mass buys only a moment
- plank 10^-35..-22 — **/plank** the floor of the world

**Laws and lenses (exempt, appended after the axis):** /overlook · /relativity ·
/loom · /time · /signal · /light · /light/inverse · /timbre · /instrument ·
/compass · /cabinet — and, this plan: **/group**, **/eigen**.

**Reading surfaces:** /archive (+ /archive/[slug]) · /kept · /colophon ·
/guide · /compare · /reading/[hash] · the home manifold `/`.

## Build order (proposed — awaiting owner approval)

0. **Docs** — this plan, `docs/notes/metaphysics-to-rooms.md`, the doc
   patches. Drafted domain libs (`src/lib/group-action.ts`,
   `src/lib/eigen-field.ts` + tests) exist but are **unverified**; they ship
   inside steps 1–2, or are deleted if the owner rejects the lane.
1. **/group** — verify lib, then room: manifest, `ROOM_REGISTRY` row,
   `routes.ts` seat beside relativity, page/layout, `<RoomShell
   chrome={false}>` component, guide screenshot. One PR, merged on green.
2. **/eigen** — same shape, after /group merges. One PR.
3. **/loom fiber walk** — shake = drift on the `Params` fiber, ceremony =
   lock a section, twist gains the fiber-cloud stop. No new route. One PR.
4. **W7 twist-lens** — sea felt↔equation first, then light color↔music
   promotion (scale-manifold plan owns this lane). One lens pair per PR.
5. **/viruses incomplete orbit** — the shells start with missing seats;
   deepening, not a second /group. One PR.

## Laws that apply (do not weaken)

- Instruction-free canvas. Prose lives in `room.config.ts` `guide:` only.
- `attachGestures` / `<RoomShell>`. No raw pointer wiring on the playable
  surface. Thresholds from `gesture/core.ts` alone.
- Tap train 1 / 3 / 5 / *n* with real fidelity at the top, not loudness.
- Countable material: `creates` + `interacts` (force + product that is
  neither parent) + shared `<LetGo>`.
- No `Math.random()`. Seed is the whole state.
- Shader field + instanced population. No per-frame gradients / blur.
- `place: { kind: "exempt" }`. `chrome: "none"`. Thin page, no AxisChrome.
- Dual registration: manifest **and** `ROOM_REGISTRY` row. Order of
  `ROOM_REGISTRY` keys === `SITE_ROUTES` keys.
- Tests falsifiable: assert a bug a plausible fake would hit.

## The visual is the lesson (pedagogy law)

The owner's bar for every lane in this plan: **a stranger must be able to
learn the concept from play alone, because the visual design induces the
mental state that constitutes grasping it.** Operationally:

- Every lane states one falsifiable **induced state** — what a visitor
  believes after a few minutes of undirected play — and names the single
  visual mechanic that causes it. A reviewer falsifies it by playing.
- The aha is *caused*, never illustrated: unison/beating IS invariance
  (/group); dying shimmer IS lost dimension (/eigen); the unbroken trace IS
  the invariant (/loom); strands peeling in place ARE the equation (W7 sea);
  prediction-before-matter IS the inferred rule (/viruses).
- Nothing on the canvas explains. If the induced state seems to need a
  caption, the mechanic is wrong — redesign the mechanic, never add the
  caption.
- Misleads are part of the spec: each lane lists the likeliest wrong
  readings (zodiac wheel, gravity toy, drawing app, …) and the
  counter-choice that blocks each one.

### resonance anchors (ordinary-human footholds)

Every mechanic above is anchored in a perception people already own —
never in schooling. If a mechanic needs math literacy to land, replace the
mechanic, not the audience.

- **/group** — tuning two guitar strings: beating → unison is how every ear
  already hears "almost the same" become "the same." Moiré is two window
  screens overlapping. A kept move is a playing card turned and landing on
  itself. Predicted seats are knowing where the next fence post goes.
- **/eigen** — freedom is proprioception: an open field versus a narrow
  hallway; a net pulled taut in one direction; a choir losing one voice; the
  ghosts are sparkler trails; the ember is a fire the task feeds.
- **/loom fiber** — same song, different singer; one body changing costume;
  a wanderer who never picks a door until the ceremony.
- **W7 sea** — a boat wake spreading: long swells outrun ripples. That
  spreading, which the visitor has already watched, *is* dispersion.
- **/viruses orbit** — quilting: the pattern tells you the missing patch
  before you cut it.

### technique map (how it is built, and why it will be beautiful)

The stack is already in the repo and proven by the recent rooms; no new
library enters.

- **Base**: `createGLStage` (`src/lib/webgl/stage.ts`) — context, DPR
  quality tiers, shared clock uniforms (uBreath, turbulence, register),
  context-loss recovery, lockstep 2D overlay for the thin interaction layer.
  Field = one fragment shader; population = `scene/population-layer` — one
  `drawArraysInstanced`, SDF disc + additive corona, typed-array instance
  buffer, one rAF, closed-form advance after pause.
- **Per mechanic**:
  - beating / moiré (/group): two rim passes phase-offset in the field
    shader; `u_beat` drives luminance oscillation 0–7 Hz; unison =
    alpha-fuse + corona widen + haptic detent in the same frame.
  - ghost preview and seats: the same instance buffer with a role channel
    (real / ghost / seat) mapped to alpha + corona — zero extra draw calls.
  - phase-locked breath: per-instance phase attribute lerped onto the shared
    breath phase when an orbit completes.
  - anisotropic shimmer (/eigen): seeded curl noise written CPU-side into
    instance data (≤96 instances — trivial); `survival(direction)` scales
    displacement; reduced motion swaps displacement for luminance breathing.
  - fiberveil / emberline: field-shader layers reading the killed span and
    `taskReadout` as uniforms.
  - kurtosis glint (the ICA snap): the 16-angle sweep is closed-form CPU
    math (microseconds), rendered as one arc highlight that detents or
    slides.
  - W7 strands: the sea shader already evaluates a sum of sines; the
    equation side renders each addend as its own band from the same
    uniforms, so phase — and the visitor's own swell — carries across the
    lens by construction.
- **Deliberately not used**: **p5.js** — not in the repo, and the law is
  procedural-over-assets with canvas-2D material banned (`test:paint`); the
  GL stage is the short path. **WebAssembly** — populations here are ≤96
  objects under closed-form laws; O(visible) + typed arrays make WASM dead
  weight. It earns a place only if a future room genuinely needs ~10⁵
  interacting objects, and then as a `src/lib/` module with a consumer in
  the same PR. **three.js** — present (cabinet, city) but law rooms stay on
  `stage.ts`; a camera armature is reaching past the shell without a reason.
- **Beauty is enforced, not hoped**: `test:room-visual` reads pixels (hue
  diversity, luminance range, spatial entropy, edge density, file floor);
  the palette stays in site tokens — blue-black deeps, candle `#C8732A` as
  one of two accents; audio keeps the loudness discipline; everything
  breathes on the shared 7s clock so the new rooms inhale with the album.

## L1 — `/group` (first ship)

**Invariant.** A candidate transform is kept iff it is an automorphism of
the *seen* fragment: it maps marks of a class to marks of the same class.
Weyl: invariance of a configuration under automorphic transformations.
Paper 2: the group is inferred, not oracle-supplied. The orbit starts
**incomplete**. Completing it is the rare event.

**Material.** Marks on a dark field, seated on an unseen cyclic lattice of
8 poses (the paper's `Z_8`, never labeled). A dwell plants a mark at the
contact pose of a class. Drag/flick proposes a shift; if consistency on the
fragment ≥ τ, it locks as a generator (haptic + tone of that `k`). Two
fragments that close under the same generator fuse into one orbit. A
rotation-generator meeting a flip-generator yields a dihedral orbit.

**Gestures**

| verb | meaning here |
| --- | --- |
| dwell | plant a mark (partial orbit) |
| deepen | the mark's class charges; longer hold does not plant a second |
| tap 1 | apply the last kept generator to the nearest mark |
| tap 3 | propose the next unused shift; lock if it closes |
| tap 5 | complete the held-out poses of the nearest class (the missing ones) |
| tap n | tutti: every kept generator acts once |
| ceremony | retire the nearest generator (or the mark if none) |
| drag / flick | propose a transform from the stroke |
| twist | lens: bilateral ↔ rotational ↔ ornamental (Weyl's ladder as *look*, not labels) |
| twist3 | matching τ (season / fidelity) |
| tap3 | tutti of `Ĝ` |
| drag3 | wind: the field drifts; marks keep their poses |
| hold3 | time dilation so a proposed lock can be seen |
| shake | scatter poses *within* the seen fragment — does not invent missing ones |
| knock | try the identity (always kept) |
| flip | invert the last generator |
| `<LetGo>` | clear marks and generators; emptied room stays empty |

### how `/group` teaches

**induced state.** after three minutes the visitor believes some moves leave
the figure itself, that those form one closed family, and that the family
says where unseen marks must sit — falsifiable: they point at ghost seats
before tap-5 fills them and call ring-or-beat mid-drag.

**arrival.** blue-black abyss. one incomplete fragment: three marks of one
class, uneven seats, breathing out of phase on the 7s clock — no symmetry
granted. a second two-mark fragment, another hue, lower. a faint rotational
undertow around each — grain, not geometry. no ring, no seats, no seam. two
roots hum, slightly detuned.

**learning arc.**

- 0–10s. a tap flares the nearest mark with its partial and a ripple; a
  dwell condenses a new mark under the finger. aha: i can add.
- 10–60s. a drag turns the whole fragment as one ghost body — beating at
  most angles, unison at one; release keeps the move (detent, candle bloom).
  aha: invariance is consonance. dim seats condense where kept moves predict
  marks, never before a lock. aha: my moves predict the unseen.
- 2–5min. tap-5 fills exactly those seats; the orbit phase-locks its breath —
  one body. the same drag closes the second fragment: fusion, child hue
  neither parent — one thing. a straight stroke proposes a flip; its lock
  raises the motion-only seam, coronas spiraling opposite ways — the kind of
  group changes.

**shader layers.**

1. abyss: blue-black base, slow vignette; reads uBreath, u_night, u_reduced.
2. undertow: rotational grain around class centroids, strength from kept
   generators; reads uTime, uWind, uBreath, u_lens (weyl ladder: bilateral,
   rotational, ornamental).
3. seam: the earned mirror; reads u_seam (rises at flip lock, decays at
   rest — standing, it would read as a crack), u_seamAngle.
4. beatfield: brightens where ghosts land, beats where they miss; reads
   u_propose, u_consonance, u_beat, u_reduced.
5. marks: one instanced draw — real, ghost, seat by role channel; hue from
   classId; breath phase locks on completion; reads uBreath, uTime, u_dilate.

**verb → sight + sound + haptic** (all continuous; nothing identical at
900ms and 2400ms):

- dwell/deepen: mark condenses, corona thickening past tiers; root swells
  with pressure; tap, ripple.
- tap 1: the mark flares with intensity; its partial, scaled; ripple.
- tap 3: next unused shift ghost-turns, locks if closing; dyad to unison;
  detent or exhale.
- tap 5: predicted seats fill, breath locks; the full chord; bloom.
- tap n: tutti of the kept group; every interval arpeggiated; storm.
- 3f tap: all marks answer softly; one unison swell; roll.
- drag/flick: the preview, momentum kept; detune-to-unison; ripple tracks
  consonance.
- twist: the ladder look rises; timbre brightens; lens.
- 3f twist: tau tightens, grain follows; noise floor falls; ripple.
- 3f drag: field drifts, poses hold; airy noise, pitch fixed; ripple.
- 3f hold: beats crawl, deepening with elapsed; beats stretch; roll.
- ceremony: nearest generator retires, seats dissolve; interval withdrawn;
  chop, long roll.
- shake: poses scatter within the seen, never inventing; chord reshuffles; chop.
- knock: identity tried, nothing moves; pure unison ping; tap.
- flip: last generator runs backward; interval inverted below root; ripple.
- letgo: all exhale, emptied stays empty; chord fades; long roll.

**the invariance preview mechanic.** eye and ear share one beat rate.

- theta = stroke winding about the nearest centroid, never snapped; k* the
  nearest shift, delta their gap; a straight stroke proposes the flip.
- the class re-emits as ghosts at raw theta: alpha 0.35, same hue, thinner
  corona. consonance = consistency(marks, k*) shrunk by delta.
- one shared SDF: overlap doubles amplitude, the moiré fuses; misses
  interleave rims, luminance beating at u_beat = delta mapped 0–7 Hz.
- the root holds; a proposal voice at root plus theta/2pi octave (8-tet)
  beats at that rate; flips invert below the root.
- ripple tracks consonance. release above tau: detent, one-breath bloom,
  seats condense at the closure. below, ghosts glide home, the dyad detunes
  out — no punishment.

**reduced motion / keyboard / 390px / desktop.** reduced motion: no flicker
or moiré beating; a miss is static doubled rims, the beat stays audible;
breath halved; seam fades without sweep. keyboard: arrows turn a proposal,
held they glide; shift+arrows flip; Enter plants, held Enter reaches
ceremony; Escape cancels or lowers the lens; Tab cycles fragments. 390px: a
ring near 62px radius keeps seats 44px apart; ghosts thicken. desktop: hover
breathes a pre-ghost; click-hold plants; drag proposes; wheel zooms; safari
rotation is the lens.

**glimmer.** after 20s idle the room tries its own move: the fragment
ghost-turns by its last kept generator and settles — one breath, near-silent
unison. nothing kept: the smallest closing shift, one beat, rest.

**misleads → counter-choices.**

1. zodiac wheel — never draw ring, spokes, ticks; seats only as earned
   predictions; eight, not twelve; lattice unseen.
2. clock — no radial hand; the fragment turns as one body, bidirectional,
   settling; nothing sweeps steadily.
3. color-matching game — the fused hue hashes far from both parents, never
   their mix; hue is kinship, matching is angular.
4. constellation map — marks have body and act on each other; undertow, not
   twinkle; completed orbits sit at seats no sky would.
5. kaleidoscope toy — symmetry is never free: first paint asymmetric, seam
   earned, failed proposals audibly beat; symmetric only once made so.

**Lib.** `src/lib/group-action.ts` — pure, import-free. `scripts/test-group-action.mjs`
must catch: identical seed → identical fragment; a shift that does not
preserve class is rejected; identity is always kept; completeOrbit adds
only missing poses; fuse produces a third class id that is neither parent;
rotation∘flip is dihedral, not a louder cyclic; permute-of-pixels analogue
(a shuffle of pose indices that is not a group element) does not unlock.

**Fake.** Complete orbits at mount. Preset "Z_8" chips. Capsid geometry.
Mineral habits. Any on-canvas word "group".

**Registry `interacts`.** One sentence: the force is automorphism of the
seen fragment; two fragments that close under the same generator fuse into
one orbit that is neither parent; a rotation meeting a flip yields a
dihedral orbit.

## L2 — `/eigen` (second ship)

**Invariant.** A planted constraint collapses only the directions the task
does not need. Surviving axes are the eigen. Capacity may still spend as
~1-D with two constraints planted (`28`). A surviving axis that does not
change a later commitment is a footprint (Gauge-Fixed) — ceremony that
kills it must change the action, or it was fake. Constraint_Swap: a
shortcut can "work" while the cloud stays unaligned; do not force the blob
to look like the rule.

**Material.** A cloud of seeded points. A dwell plants a constraint
(direction + β). Hold deepens β (Fisher distance grows). The cloud
projects onto the surviving span. Two independent non-Gaussian sources
snap apart (ICA event). Two collinear constraints merge into one.

**Gestures**

| verb | meaning here |
| --- | --- |
| dwell | plant a constraint at the finger |
| deepen | β climbs continuously past every tier |
| tap 1 | nudge the cloud along the current survivor |
| tap 3 | split a second independent source at the contact |
| tap 5 | snap the rotational gauge (ICA) — the rare event |
| tap n | collapse to the coarsest sufficient `q` (Fiber Finder) |
| ceremony | kill the nearest axis; if the task readout does not move, it was a footprint (still retire it, but the chord refuses) |
| twist | lens: cloud ↔ quotient (the surviving span drawn as the only light) |
| twist3 | season: non-Gaussianity / source kurtosis |
| hold3 | time dilation so collapse is visible |
| knock | gauge-fix intervention |
| shake | agitation in the fiber of the current `q` (irrelevant variation) |
| `<LetGo>` | empty constraints; cloud returns to unconstrained; emptied stays empty |

### how `/eigen` teaches

**induced state.** after five minutes of undirected play a visitor, asked
how much freedom the cloud has left, answers by pointing at how it still
moves — and expects a new constraint to deaden motion rather than draw an
axis; if they count drawn axes or hunt for arrows, the room failed.

**arrival.** a near-black field on the 7s breath. forty-eight pale grains
shimmer isotropically — every direction equally alive — over a low ground
drone. one small warm ember (#C8732A) waits low in the frame, barely fed.
nothing is drawn but motion: no axes, no chrome, no numbers.

**learning arc.**

- 0–10s: taps nudge, drags stir; the cloud moves every way — freedom legible
  before any concept (cause: isotropic shimmer, equal amplitude everywhere).
- 10–60s: a dwell plants a seam; off-seam shimmer dies while a voice swells.
  aha: holding kills directions, not points — the sideways life becomes
  weightless ghosts (cause: continuous anisotropy ramp plus afterimage
  split). a second collinear seam beats, then fuses. aha: two same rules are
  one rule.
- 2–5min: tap 3 shears in a second source; tap 5 snaps two hue-and-rhythm
  streams apart, and refuses on a gaussian season. aha: independence fixes
  the frame (cause: the glint that detents, or slides forever). ceremony
  sometimes drops a voice and thins the ember, sometimes changes nothing.
  aha: available is not used. a flicked rule gates the pulse while the
  shimmer stands. aha: a shortcut can work while the shape ignores it.

**shader layers** (one fragment field bottom-up, then one instanced draw;
every phase and hue offset seeded, no wall clock as state):

- ground — breathing near-black, slow vignette; reads uBreath, u_reduced,
  turbulence.
- fiberveil — weightless streaks along killed directions, never additive;
  reads the killed span, shake, wind, tilt.
- seams — up to six dark pressure-lines, darkness rising with β; shortcut
  seams shutter in time with the pulse, no alignment glow; reads each
  constraint's position, direction, β, aligned, presence.
- emberline — a breath-synced pulse along the surviving span feeding the
  ember; reads taskReadout and chord weights.
- cloud (instanced, last) — 96 instances, one buffer, one draw: 48 lit
  grains (sdf disc + corona) and their 48 coronaless ghosts; shimmer written
  cpu-side into instance data.

**verb → sight + sound + haptic** (≥2 senses same frame; continuous):

| verb | sight | sound | haptic |
| --- | --- | --- | --- |
| dwell | seam forms, aimed by the finger's pull; off-seam shimmer starts dying | a voice fades in, pitch from angle | ripple |
| deepen | seam darkens; deadening continues past every tier, never completes | voice swells, filter opens | roll, thickening |
| tap 1 | nudge along the survivor, intensity-scaled | pluck at the root, scaled | tap |
| tap 3 | a second source shears in as a diagonal smear | detuned second pulse-train | tap, doubled |
| tap 5 | the snap — or the sliding refusal | registers split, or endless glide | detent, or none |
| tap n | coarsest sufficient q: everything not feeding the ember deadens at once | chord folds to root and octave | bloom |
| ceremony | nearest axis dies; ember thins iff load-bearing | a voice withdrawn, or the chord holds | chop |
| drag | stirs lit grains along the span; off-span input slides ghosts | granular wash, pitched by heading | ripple |
| flick | throws a shortcut: the pulse gates, the shimmer does not turn | click-gate rhythm, no new voice | chop |
| twist | lens: cloud ↔ quotient, surviving light only | timbre thins toward sine | lens |
| twist 3f | season: spiky ↔ gaussian sources | rhythms sharpen or blur | roll |
| hold 3f | time dilation; collapse watchable | chord glides low, holds | roll |
| shake | ghosts scatter, lit cloud stands still; scales with vigor | dry rattle | storm |
| knock | jolts the frame: it slides pre-snap, holds post-snap | a knock through the drone | tap |
| letgo | seams gone, shimmer everywhere; emptied stays empty | release to ground drone | bloom |

unlisted globals — step back, tutti, wind, pan/pinch (frame yields), tilt
(ghost parallax), flip (night) — keep site defaults, absorbed softly.

**the collapse mechanic.** each grain displaces by seeded curl noise scaled
per direction: a(e) = rest·(0.08 + 0.92·survival(e)), rest ≈ 0.6% of the
short edge at breath peak; survival follows β = 1−exp(−hold/1400ms), so
deadening is continuous past every tier, and killed directions keep a
residual — deadened, never frozen. motion along killed directions continues
near rest amplitude but on the ghost instances: low alpha, no corona, no
weight in the emberline. shake and wind move ghosts only; the lit cloud
stands still under hard shaking — irrelevant variation confined to the
fiber, visible and weightless. two aligned seams with |cosθ| ≥ 0.95 bow
together over ~1.2s while their voices beat; they fuse into one seam on the
β-weighted mean, fresh hue-phase, neither parent — one voice, one detent.

**the snap and the chord.** tap 5 runs the sixteen-angle kurtosis sweep as
one glint arcing the cloud within a breath. peaked landscape: the frame
detents; grains split into candle-warm and sea-glass streams, pulse rates
lock 3:2, the chord fixes a two-voice interval. flat landscape (gaussian
season): the glint finishes and keeps sliding, the chord glides without
landing, no detent — the refusal is the lesson. chord voices are axes
weighted by use — their share of the emberline — not by existence; a
footprint survives, glows, and carries no voice. ceremony dims the field
toward the nearest axis, then lifts the seam: load-bearing → a voice drops
and the pulse thins in the same frame, chop; footprint → seam gone, chord
whole, ember steady, softer chop. the eye sees availability; the ear hears
use.

**reduced motion / keyboard / 390px / desktop.** reduced motion:
displacement becomes directional luminance breathing (grains brighten along
free directions), ghosts become faint static smears, the snap crossfades.
keyboard: arrows aim, enter plants, held enter deepens, shift+enter is the
ceremony, escape lowers the lens, repeated space rides the tap train. 390px:
three seams stay legible, 44px grips, ember clear of the thumb arc. desktop:
hover faintly excites shimmer, wheel zooms, ctrl+wheel pinches, trackpad
rotate or a scrub twists, double-click knocks.

**glimmer.** after ~20s idle: no seam planted, the shimmer flattens briefly
along one direction and recovers — the room demonstrating a dwell; seams
present, one ghost slides its full killed length and returns. physical,
wordless.

**misleads → counter-choices.**

1. gravity toy — grains falling toward seams. counter: seams never attract;
   nothing accelerates; a constraint only deadens motion.
2. pca arrows — seams read as drawn axes. counter: dark, headless, tickless
   pressure-lines; the surviving direction exists only as motion, never as a
   lit ray.
3. drawing app — dwell reads as ink. counter: no stroke persists; the line
   becomes a seam acting on shimmer within the second, and letgo leaves
   nothing.
4. the rule carves the blob. counter: flicked shortcuts gate the pulse while
   the principal direction stands; the room keeps showing working rules the
   geometry ignores.
5. smaller is smarter. counter: past the coarsest sufficient q the ember
   starves — over-collapse reads as loss in the frame it happens.

**Lib.** `src/lib/eigen-field.ts` — pure. Tests must catch: collinear
constraints → effective dim 1; two orthogonal non-Gaussian sources → snap
yields two axes (perm/sign leftover ok); a shortcut constraint (declared
`aligned: false`) does not drag the cloud's principal direction; killing a
load-bearing axis changes `taskReadout`; killing a footprint does not;
`Math.random()` absent; deepen(2400) ≠ deepen(900).

**Fake.** Numbered λ. PCA arrows as the picture. `/spring` D/Σ restaged.
"Smaller is smarter." Physical 2-D as success.

**Registry `interacts`.** Two independent non-Gaussian sources unmix into
separated sources (neither parent; leftover perm/sign). Two collinear
constraints collapse to one.

## L3 — Fiber (after L1/L2 are playable)

Prefer deepening `/loom`: `Params` is already the realization fiber. Map
shake → sample `K` (drift), ceremony → lock a section (intention). If the
five-compiler table cannot share the field, fork a sibling exempt room
named as a place (`/veil` / `/strand` / `/section`), never `/stochastic`.

Holonomy (CG-2) only when a loop of fibers can come home rotated in sight
and as a chord that does not return to the same root.

### how the fiber walk teaches

**induced state.** the visitor shakes mid-gathering without fear: drift
changed hue, root, and petal count — never phase, total, or a green cell —
and only ceremony makes a change that survives leaving.

**core visual mechanic.** drift is one eased scalar on the fiber, driving
all five surface params — hueDeg, soundBaseHz, symmetry, voices, accumRate —
in the same frame: the panes re-costume as one sliding body. the commutation
table and conserved-quantity trace sit on a second layer that never joins
the crossfade — the trace draws one unbroken line through the wander.
stillness against wander is the aha, rendered.

**verb deltas.** shake → a magnitude-scaled kick of drift; idle drifts
slowly on its own — real movement, chooses nothing, never settles. ceremony
→ locks a section: that embodiment persists, becoming the attractor drift
relaxes back to; a second ceremony releases it. twist → one new stop: the
fiber cloud — nearby embodiments as faint siblings, a locked section bright
among them.

**misleads → counters.** drift that eases toward prettier params, or
settles, reads as the room choosing — keep the walk unbiased, no rest point;
only ceremony settles. surfaces re-costuming out of sync read as five things
changing, not one point moving — one fiber position moves all five in the
same frame; the table never blinks.

## L4 — W7 and `/viruses`

Unchanged from `docs/plans/scale-manifold-build-plan.md` W7. `/group`'s
twist is local to that room (Weyl ladder). Site-wide twist-lens is still
the sea as felt water ↔ equation.

`/viruses` may later start with an incomplete T-orbit. That is a deepening,
not a second `/group`.

### how the W7 sea pair teaches

**induced state.** the visitor makes a swell, rotates the lens, and can
point at which bundle of traveling sines is their swell — then finds it
again rotating back; losing it falsifies the pair.

**core visual mechanic.** one simulation, two quotients: the felt side
renders the sum, the equation side the summands. mid-twist is a live
separation — sines peel out of the surface they sum to, in place, keeping
phase and speed, re-summing on the way home. dispersion is the wordless
equation: longer strands outrun shorter ones — the spreading the swell
already showed.

**verb deltas.** twist (two fingers, fixed scale) gains its first
destination: a continuous angle; partial angles hold partial decomposition,
release below halfway eases home, clocks never pause. touch on the equation
side still makes a swell, injected as its spectrum: strands born already
traveling, re-summing when the lens returns.

**misleads → counters.** a crossfade to a prepared spectrogram is a scene
swap — two objects, state lost; both sides render one live field, the
decomposition animates in place, so the swell carries. axes, grids, symbols
to say equation — classroom, and text is banned; show the equation as
behavior: strand speed differing by wavelength, dispersion as a sight.

### how the `/viruses` orbit teaches

**induced state.** given a fresh fragment, the visitor hunts for the turn
that lays seen capsomers onto seen capsomers instead of holding longer, and
says afterward that finding the move finished the shell.

**core visual mechanic.** prediction precedes matter. a fragment is legible
absence — holes with rim glow, never a textured whole. dragging its rim
turns it against a faint copy of itself; when seen lands on seen it locks
(flash, tone of that turn) and the rule draws every missing face as ghost
geometry — the orbit closure of the seen. free subunits then fill the
ghosts, pool drawn down, count conserved. rule, prediction, matter — in that
order, visible.

**verb deltas.** dwell births a fragment (a partial orbit of seats); holding
adds no unseen seats — it lets the medium search rotations slowly, so a long
hold still ends whole through the same visible lock; the T-ladder climbs as
today. rim-drag on a fragment proposes its rotation; a drag through its
center still carries it to dock, and a templated fragment copies the same
missing seats.

**misleads → counters.** silent completion under time teaches waiting —
every completion routes through a lock event; the hold only searches, the
hand's rotation finds it faster. ghosts drawn too solid read as a finished
shell with a glitch — predictions appear only after the lock, faint and
distinct, becoming real only as subunits arrive.

## Files every law-room PR touches

```
src/rooms/<key>/room.config.ts
src/rooms/registry.ts                 one import + ROOM_MANIFESTS (alpha)
src/lib/room-registry.ts              RoomEntry; key order = SITE_ROUTES
src/lib/routes.ts                     manifestRoute("<key>") beside relativity
src/app/<key>/page.tsx + layout.tsx
src/components/<Name>.tsx             RoomShell chrome={false}
src/lib/<domain>.ts
scripts/test-<domain>.mjs
package.json                          test:<domain> on the npm test chain
public/guide/<key>.jpg                shoot:guide before merge
```

Do not hand-edit `guide.ts`, `peers.ts`, `site-icon-config.ts`.

## Definition of done (each room)

- [ ] `npx tsc --noEmit` clean for files touched
- [ ] `npm run test:<domain>` green (falsifiable)
- [ ] `npm run test:rooms`, `test:room-contract`, `test:room-liveness`,
      `test:guide`, `test:routes` green
- [ ] No in-room copy. Guide `moves` all contain `→`, lowercase title
- [ ] 390px, reduced motion, keyboard (Enter plants, Escape lowers lens)
- [ ] Screenshot shot, not copied from another room, before merge

## What this plan forbids

Philosopher names on the canvas. Theorem IDs. DRCA labels. Cayley tables.
3Blue1Brown eigen vis. A second Caspar–Klug. `/spring` rebuilt. `/sine`
preset chips. Shipping `/eigen` before `/group`. Calling a classroom
route a law-room.
