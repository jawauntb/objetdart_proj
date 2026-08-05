# gesture grammar completion — every room, the whole hand

`test:room-contract` is green: all 66 interactive rooms grep-pass the 13 global
bindings. This plan is about the half the contract test cannot see — depth.
A binding that answers generically, a hold that fires the same at 900ms and
2400ms, a tap train nobody bound past 1 — present, but not played.

## the inventory (2026-08-05, from main @ 6c143da)

- **tap-train tiers (1/3/5/n)** — the grammar's habit loop — are bound in only
  ~14 of 66 rooms. This is the single widest gap.
- **expressive verbs are patchy**: `atlas`, `pretext`, `beam`, `music-color`
  bind none of scrub / span / rhythm / drum / voice; ~20 rooms bind exactly one.
- `stars` is the deepest room (scrub + rhythm + voice + train tiers), with
  geyser / reef / spring at 7/7 on the quality bar. These are the reference
  feel, not the work.
- the quality bar (`test:room-quality`) covers only the 15 manifest rooms;
  the other ~50 predate it.

## what "complete" means per room

1. **all 13 globals answer in the material** — not the soft default. Each
   handler body reads the room's own nouns: tutti pulses the population,
   season turns the room's real slow cycle, knock rings the room's body.
2. **duration and intensity are continuous axes.** Holds keep deepening past
   their tier (`elapsed` shapes the answer); taps scale with `e.intensity`;
   twist/scrub use velocity. Nothing fires identically at 900ms and 2400ms.
3. **tap-train tiers bound**: 1 acknowledges, 3 and 5 unlock room-specific
   specials, n (≥7) crescendos — in the room's material, two senses per rung.
4. **the expressive verbs the material suits**: scrub (stir), span (sustain an
   interval), rhythm (entrain the room's clock), drum (play the space between
   two zones), arpeggio/voice only on instrument surfaces. At least three
   room-specific discoveries findable in sixty seconds.
5. **two senses in the same frame** on every meaningful act: `lib/audio` +
   `lib/haptics`, the vessel subscribed.
6. **guide text moves in the same PR** (`room.config.ts guide:` for manifest
   rooms, `src/data/guide.ts` otherwise). Screenshots re-shot only when the
   resting look changed.

Constraints, unchanged: thresholds from `gesture/core.ts` alone; no raw
pointer wiring; no per-frame gradient/shadowBlur allocation; no new copy,
no emoji; reduced-motion and 390px paths intact.

## the lanes

Fifteen lanes, one PR each, grouped so a lane's rooms share a material logic
and shared-file contention (`src/data/guide.ts`) stays mergeable. Each lane
branches from fresh `origin/main`, rebases before push and at least every
20 minutes, and merges the moment its tests are green.

| lane | rooms |
| --- | --- |
| water | coast, ocean, tide, waves |
| wave-math | sine, circularity, beyond, pretext |
| atlas-city | atlas, city |
| sky | storm, clouds, atmosphere, birds |
| peak-garden | mountain, aphros, flowers, growth |
| life | tissue, cells, organelles, dna |
| chemistry | organics, molecules, atoms, nucleons |
| quantum | quarks, quanta, plasma, pulse |
| hearth | fire, earth, soil, seed |
| cosmos | stars, space, galaxy, solar, planets |
| optics-signal | comb, beam, signal, light, music-color |
| played-objects | timbre, instrument, coin, jewel, tourbillon |
| meta | cabinet, compass, overlook, loom, relativity, manifold |
| drop-stone | drop, geyser, orb, pebble, rocks, spring, reef |
| time-charts | time, watch, charts, dither |

Rooms already deep (stars, geyser, reef, spring, fire…) get a verify-and-top-up
pass, not a rewrite. Rooms whose registry exemptions are genuinely material
(coin's flip, music-color's near-total exemption) keep them — an exemption with
a true sentence is the grammar working.

A final sweep runs the full `npm test` against merged main and files fixes.

## after

The quality bar should extend past the manifest rooms as they migrate; the
tap-train tier check belongs in `test:room-contract` once the fleet lands.
