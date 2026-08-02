# Build Plan — Scale Manifold, Gesture Grammar, and the Living Album

The comprehensive plan for turning the album of rooms into one navigable world: a
continuous scale axis from quarks to the spacetime manifold, an exhaustive gesture
grammar every room speaks, deterministic flora, retuned sound, and the twist-lens that
rotates between levels of description. Context: `INSPIRATION.md` (esp. §6),
`docs/gesture-grammar.md`.

## Checkpoint — the return point

**`main` @ `23e0b8a` (merge of PR #136).** The complete pre-manifold album.
To retreat: `git revert` forward or branch from `23e0b8a` and redeploy. Nothing in this
plan may rewrite history before that commit.

## Shape of the work

Eight workstreams. W0 is the serial foundation; after it lands, four lanes run in
parallel. Every deliverable is a small single-purpose PR in the repo's existing style
(`feat(room): …` / `feat(lib): …`), each independently shippable and revertible — the
album must remain playable after every merge. No big-bang branch.

```
W0 foundation: lib/gesture + lib/scale        ──► serial, everything depends on it
   ├─ Lane A  W1 scale spine ─► W6 new bands (fan-out) ─► W7 twist-lens
   ├─ Lane B  W3 sound rebirth (independent)
   ├─ Lane C  W4 flora latent (independent)
   └─ Lane D  W2 room-by-room gesture adoption (fan-out, one PR per batch)
        W5 haptic vocabulary rides along inside W0/W1 PRs (tiny)
```

## W0 — Foundation (serial; this branch)

**Deliverables**
- `src/lib/gesture/core.ts` — pure, import-free classifier math: chord settle, tap
  trains, hold tiers, two-finger decomposition (pan/pinch/twist), winding/scrub, flick,
  intensity, rhythm, shake detection. Unit-testable in node.
- `src/lib/gesture/index.ts` — DOM binding: pointer/gesture/motion/wheel listeners →
  semantic events per `docs/gesture-grammar.md`; SSR-safe, feature-detected, iOS motion
  permission flow, OS-reserved-gesture avoidance (edge insets, 3-finger-over-text guard).
- `src/lib/scale.ts` — the manifold math, generalized from `lib/stars/nestedCosmos.ts`:
  band registry (log₁₀-meter addresses for every current and planned room), `bandAt`,
  `bandBlend` (crossfade weights), detent field (restoring force near band centers,
  resistance at edges), the two-regime integrator (`local zoom` vs. `travel` with
  sustained-intent crossing), and `spectralRegisterFor(s)` for W3.
- `scripts/test-gesture.mjs`, `scripts/test-scale.mjs` wired into `npm test`.
- **Definition of done:** tests + `next build` green; no room behavior changed yet.

## W1 — The scale spine (Lane A; needs W0)

1. `ScaleManifold` client component: owns the global `s` coordinate, runs the detent
   integrator, renders current band + `bandBlend` crossfade partner, routes semantic
   pinch/travel events, fires haptic detents.
2. Band adapters for existing rooms — a room exports `{ mount, unmount, anchor }`;
   the **handoff anchor** rule: the focused object of band N becomes the container of
   band N+1 (petal → cell field; atlas sheet → coastline).
3. First traversal live: **coast (ocean/tide/waves) ↔ atlas ↔ earth ↔ stars ↔ beyond**,
   entered from any of those rooms; existing routes keep working standalone (the manifold
   is additive, never a rewrite).
4. Persist `s` + per-band camera in `lib/world.ts` storage.
- **PR slices:** manifold shell; coast↔atlas; atlas↔earth; earth↔stars↔beyond.
- **Risks:** perf (two live bands during crossfade — budget one rAF, pause the hidden
  band's simulation); `/stars` already proved the pinch-accident failure mode, its fixes
  become the shared detent defaults.

## W2 — Gesture adoption per room (Lane D; needs W0; embarrassingly parallel)

Each batch PR: mount `attachGestures`, delete private listeners, implement every global
binding the material supports + ≥3 discoveries + glimmers (grammar §6).

- Batch 1 (dialect donors — they already half-speak it): `/ocean` `/tide` `/waves`
  `/drop` `/light` `/stars` `/comb`
- Batch 2 (element scenes): `/fire` `/storm` `/clouds` `/earth` `/plasma` `/pulse`
  `/aphros` `/growth` `/flowers`
- Batch 3 (instruments & abstractions): `/sine` `/circularity` `/time` `/watch`
  `/charts` `/beyond` `/jewel` `/coin` `/dither` `/movement` `/signal` `/pretext`
- Batch 4 (home + reading surfaces): `/` compass/sea/atlas sections, `/kept`,
  `/compare`, `/archive`.
- **Per-room binding tables live in the room's component; thresholds only in core.**

## W3 — Sound rebirth (Lane B; independent, start immediately)

1. **Master bus discipline** in `lib/audio.ts`: gentle compressor/limiter, global
   loudness target, headroom rules — nothing loud, nothing agitating, ever.
2. **Palette retune**: longer attacks, lowpassed partials, filtered-noise textures;
   audit every one-shot (`chime/bell/thud/refuse/spark`) and room ambient against the
   new bar: *would this be beautiful at 2am on headphones?*
3. **Scale → spectral register**: implement `setScaleRegister(s)` consuming
   `spectralRegisterFor` — sub-bass/minute-LFOs at cosmic scale, mids at human, granular
   shimmer at atomic; crossfaded with the same `bandBlend` weights (zoom = glissando).
4. Per-band ambient beds for the W6 rooms as they land.
- **PR slices:** master bus; palette retune; register mapping (this one waits for W0's
  `spectralRegisterFor`, the rest doesn't wait at all).

## W4 — Flora latent (Lane C; independent after W0 hold events)

1. `src/lib/botany.ts`: parametric flower decoder — ~32-dim latent → species
  (phyllotaxis counts, petal Bézier profiles, branching L-system, palette within the
  site's tokens). Pure function of the latent: deterministic, testable
  (`scripts/test-botany.mjs`).
2. Phenology clock: bud → bloom → close driven by hold duration/intensity; breath rides
   the shared 7s LFO; growth persists via `lib/world.ts`.
3. Rebuild `/flowers` (garden of discrete species) and wire `/growth` (they grow *on*
   the existing vines); flowers can migrate zones like coast naturals.
4. Later (optional, offline): image-model-proposed "species sheets" fitted into latents.
   Runtime stays procedural. Concern polygon → latent projection so your valence blooms.

## W5 — Haptic vocabulary (tiny; inside W0/W1 PRs)

Extend `lib/haptics.ts` sea-words with scale-words: `detent()` (focus-ring click),
`crossing()` (band travel roll), `lens()` (twist click), `bloom()` (soft swell). Keep the
turbulence gain; wire into ScaleManifold and botany.

## W6 — New bands (after W1; one PR per band, fully parallel)

Below: `/cells` (10⁻⁵ m), `/molecules` (10⁻⁹), `/atoms` (10⁻¹⁰), `/quarks` (10⁻¹⁶).
Above: `/manifold` (10²⁶ — spacetime foam, geodesics, the whole album as one point).
Each is a normal living room first (grammar-compliant, alive, deterministic) and a band
adapter second. The stack is also the *content* axis here: quarks are math-flavored,
atoms physics, molecules chemistry, cells biology, flowers upward phenomenology — the
zoom traverses levels of explanation, not just meters.

## W7 — Twist-lens (after W1)

Lens registry + global twist binding: at fixed scale, twist rotates the level of
description. First lenses: sea as *felt water ↔ wave equation*; light as *color ↔ music*
(the inverse maps already exist — this is their promotion to a universal gesture);
stars as *sky ↔ gravity field*. One lens pair per PR.

## Sequencing & parallel capacity

| phase | can run at once |
| --- | --- |
| now | W0 (serial) |
| W0 merged | W1 + W3 + W4 + W2-batch-1 (4 lanes) |
| W1 merged | + W6 fan-out (bands in parallel) + W7; W2 batches continue |
| steady state | any number of W2/W6/W7 PRs concurrently — they touch disjoint files |

Merge conflicts are structurally rare: lanes own disjoint directories (`lib/gesture`,
`lib/audio`, `lib/botany`, per-room components); the only shared hot files are
`lib/scale.ts` (owned by Lane A after W0) and `routes.ts` registrations (one-line,
trivial).

## Invariants during the whole build (from INSPIRATION.md)

- The deployed album is never broken: every PR leaves all existing routes playable.
- Determinism from small vectors; procedural over assets; join the buses.
- Nothing requires instructions; nothing loud; reduced-motion + keyboard + 390px always.
- When in doubt, retreat to the checkpoint rather than patch forward.
