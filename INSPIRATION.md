# INSPIRATION — the angle we are building from

This document explains *why* this site is the way it is, so that anyone — human or agent —
arriving with zero context can build on it without flattening it. `DESIGN.md` describes what
was built and how; this describes the point. If you only read one thing before touching code,
read this. If a proposed change contradicts this document, the change is wrong or this
document needs a deliberate edit — never drift.

---

## 1. What this is

An **album gesamtkunstwerk in the progressive tense**.

A gesamtkunstwerk is a total artwork: the art forms are not adjacent, they are fused. Here
that fusion is literal and technical, not metaphorical. Every sound comes from one Web Audio
graph that shares LFO sources with the visual sea, so what you see breathes with what you
hear because they read the same clock. The voice rules bind even the LLM endpoints. The
haptics ride the same turbulence axis as the water. The routes — `/ocean`, `/tide`, `/waves`,
`/stars`, `/light`, `/comb`, `/drop`, `/fire`, `/flowers`, thirty-some rooms — are a
tracklist: each has its own timbre, all share motifs (the sea, the candle, the polygon, the
long-press).

And it is an *album*, not a compilation: the rooms are one world. A shell planted on
`/ocean` can migrate to `/tide` overnight (`src/lib/world.ts`). The difference between four
scenes and one place is that the shell traveled while you were gone.

Unlike Wagner's gesamtkunstwerk, this one is **open, not closed**. It is indexical — it
points at its author's ongoing world — so it is uncompletable by design. Each PR is
finished; the album never is. It is complete as a *system* at every moment and generative
forever, like a language. Do not treat the openness as a backlog to burn down. The
incompleteness is the medium.

## 2. The formal method: maps between representations

The recurring move of this site, the one every strong feature repeats, is
**category-theoretic in spirit**: take one invariant object and render it under many
representations while preserving its structure.

The concern polygon is the canonical example. It is *the same object* as:

- geometry (the compass, the sigil),
- sound (each vertex a voice; the sigil played as a ~12s phrase),
- prose (line widths ray-cast from the polygon's silhouette),
- an image (the OG card),
- a URL (the 11-byte hash).

Objects are small state vectors. Morphisms are structure-preserving maps between sensory
modalities — and where possible **invertible** (the music↔color work on `/light` is
literally a round trip; the hash codec is lossless). The question every new feature must
answer is: *what is the invariant, and what map carries it into this modality without
losing structure?* If a feature renders state in a new way but the map is arbitrary — if
you couldn't in principle go back — it will feel like decoration, and it is.

Two qualifiers matter:

- **Specialized**: each map is realized in one specific medium with that medium's own
  physics. The sea map is not the star map with a palette swap. A representation earns its
  place by being idiomatic to its material.
- **Temporalized**: representations are alive, not static. They breathe, tide, grow, decay
  on shared clocks. A rendering of state that does not unfold in time is a screenshot, not
  a representation, and screenshots do not belong here.

### 2a. Instantiation, and the recursive cycle

A structure causes nothing by existing abstractly. A concern polygon is inert until some
material system realizes its relations — a compass someone drags, a chord an oscillator
holds, prose a layout engine lays down. Structure becomes causally effective **only through
embodiment**, and the same structure can be embodied in many substrates that preserve its
organization while differing materially. So the real object under everything here is not a
representation but a *cycle*:

```
R  ──q──▶  S  ──ι──▶  R'
```

`q` (a quotient / coarse-graining) extracts a structure `S` from a realization `R`, forgetting
everything irrelevant to it; `ι` (instantiation) embodies `S` in a fresh substrate `R'`, which
preserves the invariant but may have entirely new causal powers because its material and
context differ. Every lens on this site is a `q`; every room that renders shared state is an
`ι`; the album as a whole is this loop run continuously. The manifold is the *fiber* of `S`
— the space `I(S)/∼` of materially different but structurally equivalent embodiments, laid
along an axis.

This reframes the site's own laws as one conjecture — the thesis the whole build enacts:

> **The work finds the level at which the world becomes both compressible and controllable.**
> A representation earns its place when task-relevant dynamics *descend* to it (the map
> commutes with the room's evolution: `q∘Φ ≈ ψ∘q`), irrelevant variation stays confined to
> the fiber, an intervention can be specified compactly in it, that specification can be
> re-instantiated in another substrate, and its consequences stay stable across substrates
> and contexts not chosen to flatter it.

Three consequences are load-bearing for future work:

- **Truth is interventional stability, not compression.** A quotient is not good because it
  is small; it is good when the relations it keeps survive independent tests and keep
  enabling action across contexts the model did not define. Prefer a lens that still holds
  when the room changes than one that merely looks tidy at rest.
- **A symbol reshapes the reachable future only through a compiler.** Text, rule, sigil,
  interface — none move matter until an interpreter enacts them. The site's "magic" (the
  command line, the shared world, the kept reading that others can step into) is exactly
  symbolically-mediated causation: `P(future | state, symbol) ≠ P(future | state)`, with the
  instantiation machinery supplied by the runtime and the hand.
- **Art is the compiler whose output is an encounter.** These rooms do not assert a
  proposition about a world; they instantiate a perceptual world and let a stranger inhabit
  its organization until they feel it. That is why embodiment, not description, is the whole
  method — and why the strongest form of this work is one structure compiled into many
  substrates at once (see `src/lib/structure.ts` and the room that plays it), each medium
  verified to preserve the same invariant.

## 3. The medium is the message: exteriorized phenomenology

This site is a phenomenology — a rendering of how one person sees the world, in maps and
waves and levels of abstraction — but a phenomenology **exteriorized**, pushed out of the
head and into material a stranger's hands can play.

The constraint that makes that honest is the device itself. People experience this work
through phones, tablets, and laptops: touch and click, pressure and duration, gyroscope
and accelerometer, speakers, and (through the iOS shell) real haptic actuators. McLuhan's
point applies with full force: the medium is the message. So interior state must be
translated into **exactly the channels the device has**, and nothing else:

- **State is felt, not parsed.** Everything before the reading should be experienced
  through the body; text is the payoff, never the interface. If a feature needs
  instructions, the feature is wrong.
- **The gesture grammar is exhaustive and universal** (`docs/gesture-grammar.md`): the
  full input space of the device — chords, pressure, contact area, rhythm, winding,
  motion, breath — each dimension given one consistent meaning. The structural key:
  finger count addresses the stack (one finger the material, two the frame, three the
  law; the device is the vessel). Every room interprets the same grammar in its own
  register. No room invents a control a hand cannot discover in ten seconds of play.
- **Every meaningful state change should be simultaneously visible, audible, and — where
  hardware allows — tangible.** The compass drag renders in the same frame as its tone.
  Haptics (`src/lib/haptics.ts`) speak sea-words: tap, ripple, chop, roll, storm.
- **The water is the template for all modalities.** Touch means tone. Dwell means glow.
  The sea rewards attention without demanding it — that is the bar every interaction must
  clear.

This is why things must be **lifelike, active, and interactive**: not as a style choice
but because the whole argument of the site is that meaning arrives through embodied play
before it arrives through reading. A static page here isn't merely dull; it is off-thesis.

## 4. The stack: why aliveness lives at the bottom

The architecture follows a conviction shared with Michael Timothy Bennett's stack theory
(see his thesis *How To Build Conscious Machines* and "Why is anything conscious?"):
systems are stacks of abstraction layers, and a system is more alive the further **down**
its stack adaptation is delegated. Software is usually dead because only its top layer
adapts; biology is alive because cells adapt all the way down.

The history of this repo enacts that. It began as a fully hand-authored room — beautiful
and static, all specification at the top of the stack. It became alive in stages, each one
pushing adaptation downward: generative atlases, weather schedulers, persistent naturals,
then naturals that *migrate between pages over real elapsed time* while nobody is watching.
When you add to this site, prefer the move that gives a lower layer its own behavior over
the move that adds another top-level control.

The same stack is also the site's **content**. The eight concerns are vector-valued
valence (the author's *Metric Stack of Concern*; compare Bennett's "tapestries of
valence") — and the site is a machine for rendering valence vectors as qualia: shape,
tone, temperature, weather, prose. Longer term, the stack becomes navigable in itself:
math → physics → chemistry → biology → phenomenology, traversed by zoom and by lens
(see §6).

## 5. The laws

Operational consequences of the above. These are load-bearing; violating one is a design
regression even if the code is clean.

1. **Determinism from small vectors.** Every generated thing — sigil, music, flower,
   constellation position — is a pure function of a compact seed/state. Your night sounds
   like yours, always. LLM/image calls are allowed at the edges (voice answers, offline
   asset generation) but never in the loop that renders state.
2. **Procedural over assets.** Synthesis, shaders, and parametric models before sound
   packs, stock, or AI illustration. Procedural material stays coherent because it shares
   graphs and clocks with everything else.
3. **Join the shared buses.** New work plugs into the existing organs rather than growing
   private ones: `lib/audio.ts` (one audio graph), `lib/haptics.ts` (one haptic bus, with
   the iOS Core Haptics bridge), `lib/turbulence.ts` (one intensity axis), `lib/world.ts`
   (one persistent world). One clock family: the 7s breath, the slow tides.
4. **Build it in one room, then extract the law.** `/stars` grew nested zoom; the coast
   grew shared persistence; then `world.ts` and `nestedCosmos.ts` were extracted. Prove a
   mechanic locally, generalize it deliberately. Never generalize first.
5. **Three registers.** Devotional / operational / oceanic. A surface is on-voice when at
   least two are present and none dominates — this binds prose, UI copy, and the system
   prompts of every AI endpoint.
6. **No controls to learn.** The gesture grammar of §3, discoverable by play. Prefer
   pressure, duration, and motion over buttons; prefer detents and resistance over
   settings.
7. **Anti-patterns stand.** The list in `DESIGN.md` (no marketing verbs, no emoji in
   product copy, no drop shadows, no "coming soon", no autoplay audio, reduced-motion
   always honored, etc.) applies to every new room.

## 6. Where this is going: the scale manifold

The long arc is a single continuous **scale axis** the whole album mounts onto — think
scaleofuniverse.com, but where every band is one of these living rooms: quanta → quarks →
nucleons → atoms →
molecules → cells → flowers → drop → tide pool → coast → atlas → earth → stars →
`/beyond` → the spacetime manifold. Zoom becomes navigation; the nav becomes vestigial.

Design commitments already made:

- **Bands with detents.** Generalize `src/lib/stars/nestedCosmos.ts` (zoom bands +
  `layerBlend` crossfades) into a site-wide `lib/scale.ts`. Local zoom moves freely within
  a band and rubber-bands at edges; *crossing* a boundary requires sustained intent (hold
  the pinch through resistance), with a haptic tick at each detent. This is the fix for
  accidental scale travel, learned the hard way on `/stars`.
- **Handoff anchors.** Bands render individually and crossfade; the focused object of one
  band becomes the container of the next (petal texture resolves into cell field; the
  atlas sheet curls into the coastline). The anchor is what makes it one world.
- **Twist rotates the lens.** Scale and abstraction are *different axes*. Pinch moves
  through scale; a two-finger twist at fixed scale rotates the level of description —
  the same sea as equation, as fluid, as felt weather. The music↔color inverse was the
  first lens rotation; make it a universal gesture.
- **Scale maps to spectral register.** Sub-bass and minute-long LFOs at the cosmic end,
  mids at human scale, high granular shimmer at the atomic end, crossfaded with the same
  band weights as the visuals. Zooming is a glissando; the site is one instrument and the
  scale axis is its keyboard. Retune toward beauty: long attacks, lowpassed palettes,
  loudness discipline — nothing loud, nothing agitating.
- **Generated life stays deterministic.** Flowers (and later flora/fauna/planets) come
  from a compact latent decoded by parametric models (phyllotaxis, L-systems) — a point in
  the latent *is* a species; press-duration advances its phenology (bud → bloom → close);
  the breath rides the shared 7s clock. Generative models may propose species offline;
  runtime stays procedural, 60fps, yours.

## 7. How to add a room (checklist)

Before shipping a new route or a major mechanic, check:

- [ ] What is the invariant, and which structure-preserving map renders it here? Could
      you, in principle, map back?
- [ ] Is it alive — does it breathe/tide/grow on the shared clocks, and does something in
      it adapt below the top layer?
- [ ] Is every interaction inside the gesture grammar (`docs/gesture-grammar.md`),
      mounted through `lib/gesture` (not private pointer wiring), honoring the global
      bindings, discoverable in ten seconds, instruction-free?
- [ ] Does the room have a scale address (`lib/scale.ts` — where does it live on the
      quark→manifold axis, and what register does it sound in)?
- [ ] Does state land in at least two senses in the same frame (sight + sound, sound +
      haptic)?
- [ ] Is generation deterministic from a small vector?
- [ ] Does it join `audio.ts` / `haptics.ts` / `turbulence.ts` / `world.ts` rather than
      growing private buses?
- [ ] Are two of the three registers present in every line of copy?
- [ ] Does it hold on a 390px touch screen, honor reduced motion, and stay keyboard
      accessible?
- [ ] If the mechanic is good, what is the law hiding in it — and is it worth extracting
      to `lib/` yet?

— The point, compressed: **a living atlas of one person's valence, rendered as an album,
built by delegating aliveness down the stack, played entirely by hand.** Everything else
is technique.
