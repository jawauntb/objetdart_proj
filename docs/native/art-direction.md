# native art direction and felt-proof pedagogy

## purpose

Release 1 fans out into three scene lanes — wave, cell, solar — that must feel
like one instrument, not three unrelated apps. This document is the single art
direction they share: what a scene looks and moves like, what makes a scene
brief pass, what the guide is allowed to say, and how discovery precedes
language. The perceptual axis lives in
`packages/universe-contracts/src/scene-style.ts`, the settled scene briefs in
`packages/universe-contracts/src/manifest.ts` (frozen at U2); this doc is the
prose and post-discovery pedagogy that scene lanes read before shipping.

The scientific reduction the scenes stand on lives in
`docs/native/simulation-contract.md` and `docs/native/scientific-references.md`.
The post-release horizon that neighbours a scene lives in
`docs/native/post-validation-horizon.md`. Nothing in this document loosens
those boundaries; a scene lane may consult a horizon family for continuity but
never invents its own scientific claim inside a rendered brief.

## 1. the living scientific sublime — the shared aesthetic

A native cosmogony scene is a **material** first. It is not a diagram, not a
dashboard, not an interactive story. The room breathes at rest, answers a
hand's touch in at least two senses in the same frame, and reveals its causal
structure through play, never through legend. The three scenes share:

- **a dark field with a decisive material.** Night is the ground; light comes
  from state that a hand can address. No white cards, no chrome-heavy
  scaffolding, no ambient glow that is not standing in for scientific state.
- **a bounded, deterministic seed.** Everything visible is a function of a
  small state vector plus the persisted universe seed; nothing rolls
  `Math.random()`. Style variance is a consequence of that seed and the
  hand's history, not a decorator.
- **two-sense minimum on every meaningful act.** Sight and sound (or sight
  and haptic) land in the same frame as the state change. A silent visual
  answer is a bug the guide cannot forgive.
- **restraint about the tools you can see.** A tab bar, an onboarding overlay,
  a first-run lecture, a corner watermark, a labelled control button — none
  are permitted. Chrome is minimal and contextual (fold, trail, `?`).
- **the room is the teacher.** A visitor plays before the scene ever writes a
  word back; language arrives only after material comprehension has landed on
  its own.

The name "living scientific sublime" is deliberate. *Living* pins down the
breath at rest; *scientific* pins down that the sensory answer derives from a
declared law with a stated validity range; *sublime* pins down what a
generic-particle system is not.

## 2. shared state-to-sense mappings

Every scene brief in `RELEASE_SCENE_MANIFEST[i].style.stateToSense` declares
which physical state becomes which senses, always with a stated causal
statement and at least two of the three senses (visual, audio, haptic).
`validateSceneStyle` rejects a brief that omits either.

The scenes agree on the axis, even where the units differ:

| axis | visual | audio | haptic |
| --- | --- | --- | --- |
| amplitude / intensity | brightness of the field or object | loudness and spectral energy | strength of the tick |
| frequency / rate | spatial frequency of the pattern | pitch / harmonic interval | tempo of the pulse |
| structure / lineage | palette family and edge / membrane form | timbre family | shape of the envelope |
| resonance / coupling | phase and moiré alignment | harmonic interval | detent between two ticks |

`sceneStyle.ts` (this workspace) re-exports the settled briefs from the
contracts package; it never invents a second copy. Any state the brief
declares must reach at least the two senses named — never one, never a
sensory effect without a declared cause.

## 3. scale registers — wave, cell, solar

The three scenes fall on three registers of the scale axis. Each register
carries a distinct **material language** so that a sighted visitor recognises
which world they are inside within the first breath, without a label.

- **wave (`wave-medium`, `~1 m`).** A dark **water field**, spectral rings
  when a Fourier lens opens, phase written as slow moiré. Forms:
  `continuous-field`, `spectral-rings`. Motion: propagation, coherent
  reinforcement or cancellation, breath. Palette: `night`, `sea`, `ember`.
- **cell (`cellular-colony`, `~µm`).** A dark **membrane field** with bounded
  populations, nutrient gradients as slow luminance, lineage as edge palette
  drift. Forms: `membrane-loops`, `reaction-field`. Motion: slow division and
  responsive contraction. Palette: `night`, `sea`, `ember`.
- **solar (`solar-formation`, planetary).** A **cold orbital dark** where
  gravity writes arcs and reduced bodies leave accretion trails. Forms:
  `orbital-arcs`, `accretion-disks`. Motion: slow precession with decisive
  collisions. Palette: `night`, `sea`, `ember`.

The shared palette carries scale-invariant meaning — `night` is the ground,
`sea` is the coherent medium, `ember` is the decisive event. Individual
scenes may quote a fourth cool or warm accent from that vocabulary; they may
not introduce a fifth family that changes the palette's story. The
distinctive material language (water vs membrane vs orbit) is what
disambiguates the scale at a glance, not a colour swap.

## 4. typography and iconography

The native lane is not a document; it is an instrument that occasionally
writes back. Typography is spare and load-bearing.

- **system UI (`system`).** iOS system fonts for chrome only — the safe-area
  `?`, the fold and trail, focused summaries for accessibility. Never for
  in-scene prose.
- **editorial (`editorial`).** A serif register (system serif or a locally
  installed editorial serif when U11 defines the fold) for the post-discovery
  reveal: naming, notation, and the one paragraph the room writes after a
  visitor causes the phenomenon. Sparingly, always outside the material.
- **notation (`notation`).** A monospace register for scientific notation,
  units, and numeric readouts inside the guide sheet. Never rendered on top
  of the active material.

Iconography is **iconic, not decorative**. Every guide affordance uses a
glyph that names the shared operation (fold, trail, `?`) — the same glyphs a
web visitor already recognises. No new logos, no per-scene mascots.

## 5. motion language and reduced-motion equivalents

Every scene's motion is a **continuous consequence of state**, never a
timed animation. The motion field in each scene brief is a stated behaviour,
not a decoration:

- **wave** — propagating and breathing (amplitude modulates the field, phase
  writes the moiré).
- **cell** — slow division and responsive contraction (nutrient gradient
  drives luminance, lineage drives palette drift).
- **solar** — slow precession with decisive collisions (orbital energy
  writes the arc, resonance writes the detent).

Under `prefers-reduced-motion` (respected by the scene, the chrome, and the
guide sheet alike) the material's oscillation attenuates but the
**hierarchy, state, and scientific result are preserved**:

- the field still updates its state (position, amplitude, luminance) — but
  the *oscillatory* portion is either quantised to detented steps or
  replaced with a still visualisation of the same authoritative value;
- the sound and haptic answers **remain the same information** at reduced
  amplitude (they never drop below audibility);
- the guide's reveal choreography still runs — reduced motion changes the
  breath duration, not the ordering, and never removes the sought reveal.

A scene lane that turns reduced motion into "silence and stillness" is a
failure of the brief; the reduced-motion path is the same instrument at
lower physical amplitude, not a different instrument.

## 6. banned generic forms

The scene contract declares these forms explicitly banned. They are the
five shapes a scene will fall into if the author defaults to "how apps
usually look":

- **`generic-particles`** — undifferentiated dots that flock without a
  declared force. In the cosmogony these are always either wave points on a
  medium, cells with a lineage, or reduced bodies with a mass and momentum.
- **`glassmorphism`** — frosted translucent panels floating above the
  material. Chrome is minimal and opaque; a translucent panel over the
  material implies the material is decoration.
- **`dashboard-card`** — a boxed metric with a headline. Metrics live in the
  material or in the guide; a dashboard is what a scene becomes when the
  designer no longer trusts the material to teach.
- **`stock-gradient`** — a smooth two-stop background gradient. Palette
  transitions are earned through state (spectral peak, nutrient
  concentration, orbital energy), not drawn.
- **`game-hud`** — a HUD with mini-map, health bar, or button rows. The
  scene has no score. Discovery replaces score.

`validateSceneStyle` rejects any brief whose `forms` array contains one of
the banned strings, and it also rejects any brief whose `bannedForms` does
not declare every one. A scene author may add banned forms; they may not
remove the shared five.

## 7. scene briefs

Each Release 1 scene has a settled brief in
`RELEASE_SCENE_MANIFEST[i].style`. The prose below is the reviewer-facing
statement of that brief, and each section names the exact
composition / material / motion / sensory mapping / banned forms — the six
facts the U7 test suite pins for every scene.

### 7.1 wave — the living water field

- **composition.** A single dark water field fills the frame; a source point
  a hand can plant, a spectral ring lens two fingers can raise, a phase
  reading three fingers can hold.
- **material.** `continuous-field` (the surface), `spectral-rings` (the
  Fourier lens). No particles.
- **motion.** Propagating disturbance and coherent reinforcement or
  cancellation; a breath at rest.
- **sensory mapping.** Amplitude and spectral peak → visual brightness,
  audio pitch, and haptic pulse — the same normalized event energy.
- **banned forms.** All five generic forms, plus the shared list from the
  contract.
- **gesture feedback.** `material` verb triggers visual, audio, and haptic
  in the same frame.

### 7.2 cell — the living membrane field

- **composition.** A dark membrane field with a bounded colony population; a
  seed a dwell plants, division a hold deepens, engulfment a ceremony hold
  performs.
- **material.** `membrane-loops` (population), `reaction-field` (nutrient
  gradient). No particles; the visible structure is always a membrane and
  its environment.
- **motion.** Slow division and responsive contraction; a resting colony
  breathes with the shared clock.
- **sensory mapping.** Nutrient gradient and lineage → membrane luminance,
  tone family, and division pulse.
- **banned forms.** All five generic forms, plus the shared list.
- **gesture feedback.** `grow` verb triggers visual, audio, and haptic in
  the same frame.

### 7.3 solar — the cold orbital dark

- **composition.** A cold orbital dark where reduced bodies leave accretion
  trails; a disk two fingers shape, mass or momentum a drag alters, time a
  three-finger hold dilates.
- **material.** `orbital-arcs` (bodies + trails), `accretion-disks`
  (bounded merger halo). No particles; the visible structure is always a
  path a body wrote.
- **motion.** Slow precession with decisive collisions; between events the
  system is still enough to see the arc, at events it commits.
- **sensory mapping.** Orbital energy and resonance → trajectory brightness,
  harmonic interval, and detent pulse at resonance.
- **banned forms.** All five generic forms, plus the shared list.
- **gesture feedback.** `time-dilation` verb triggers visual, audio, and
  haptic in the same frame.

## 8. post-discovery reveal choreography — Play, Reveal, Name, Transfer, Express

The pedagogy is felt-proof: **material precedes language, always.** A visitor
must produce the phenomenon before the room ever names it. The choreography
is fixed and shared across the three scenes:

1. **Play.** The scene begins at rest, breathing. Idle glimmer appears only
   after a stated dwell (default 20 s); nothing volunteers instructions. The
   sought reveal (`?`, the fold, the trail) is available from the first
   frame but never opens itself.
2. **Reveal.** The visitor causes the phenomenon (a wave, a division, an
   orbit). The room answers in at least two senses in the same frame. No
   text yet — the visual, audio, and haptic answer is the reveal.
3. **Name.** Only after the visitor has caused the phenomenon at least
   once (tracked in the universe state), the guide sheet, if opened, offers
   the plain and the notation for what just happened. The name arrives on a
   volunteered surface, not overlaid on the material.
4. **Transfer.** The guide invites the visitor to reproduce the phenomenon
   with a different hand — a different frequency, a different lineage, a
   different orbital resonance — showing that the name refers to the
   *relation*, not the first performance.
5. **Express.** The scene ends its loop with a small expressive act — a
   composition of the material the visitor authored, saved into the
   persistent universe. The last act is authorship, not a quiz.

Rules the choreography enforces:

- **language never precedes material.** A guide entry whose `plain` or
  `notation` block would appear before the visitor caused its phenomenon
  is a bug. The reveal gate lives in the universe state, not in a timer.
- **no first-launch lecture.** The first frame is the scene; there is no
  onboarding modal, no tap-through tour, no coach mark.
- **the reveal is sought.** The `?` and the guide sheet open on a
  deliberate touch; they do not auto-open, ever. The plan's minimal chrome
  is deliberate.

## 9. minimal safe-area chrome

The native shell mounts no tab bar (`test:native-workspace` asserts that
`<Tabs>` never lands in `app/**`). Chrome is minimal, contextual, and lives
in the safe area only:

- **fold** — the axis affordance, top-left safe area, opens the axis view.
- **trail** — the kept-readings affordance, top-right safe area, opens the
  visitor's persisted trail.
- **`?`** — the guide affordance, bottom-right safe area, opens the current
  scene's `GuideSheet` in plain-first mode.
- **status bar** — hidden in the world route; the material owns the whole
  frame under the safe area.

The chrome respects Dynamic Type up to the accessibility sizes without ever
covering the active material — chrome scales the affordances, not the
material — and it respects `prefers-reduced-motion` and the platform
motion-reduction preferences.

## 10. iPhone vs iPad composition principles

The Release 1 scenes ship on iPhone and iPad simultaneously. The composition
principles differ:

- **compact-width portrait (iPhone).** The scene fills the frame; chrome
  affordances sit in the safe area corners; the guide sheet opens as a
  bottom sheet at 60% of the visible height, dismissable by swipe. Two-hand
  gestures still lift — the guide sheet never covers a hand that is
  currently touching the material.
- **regular-width landscape (iPad).** The scene is a deep creation surface.
  The guide sheet is a side sheet on the leading edge at 40% of the width;
  the material still animates behind it, and chrome affordances follow the
  side-sheet's edge rather than the safe area corners while the sheet is
  open. Landscape gains no new content; it gains room for the hand.
- **shared rule.** No composition splits the material behind chrome that
  covers the state a visitor is currently manipulating. If the guide sheet
  would occlude the active source, the scene shifts the source rather than
  the sheet.

## reviewer checklist

A scene brief passes reviewer sign-off only when the following are true:

- [ ] `validateSceneStyle` accepts the brief.
- [ ] Every declared state mapping reaches at least two senses with a
      causal statement.
- [ ] Every gesture feedback declares a semantic verb and two senses.
- [ ] The forms array contains no banned generic form; the bannedForms
      array declares every shared banned form plus any scene-specific ones.
- [ ] The reduced-motion path preserves hierarchy, state, and scientific
      result.
- [ ] The post-discovery choreography names Play, Reveal, Name, Transfer,
      Express — and language does not precede material.
- [ ] The guide entry for every gesture verb in `GLOBAL_VERBS` supplies a
      plain wording and a notation link, with no wording duplication across
      entries.
- [ ] The chrome is minimal, contextual, safe-area only, and lifts the
      material rather than covering it.
