# Ground and Sky — the strata under the earth, the axis over it

The cosmology behind PR `feat(scale): per-route doors and the sky re-cut`.
Context: `INSPIRATION.md` §6 (the scale manifold), `docs/plans/life-and-vista-bands.md`
(the previous re-cut, whose method this follows), `docs/new-room.md` §1 (the ordinal
decision), `src/lib/scale.ts` (the authority — if this document and the code drift,
the code is right and this file owes an edit).

Two things land together here because they are one decision: the earth's floor
opens downward into its own strata (rocks, soil — rooms that share a band and
need different doors), and the sky above the earth is re-cut into a continuous,
metric-monotone walk from the air column to the web. The ground needed a new
door **mechanism**; the sky needed new **addresses**. Both are declared ahead of
their rooms, which is the axis's standing law: an address without a page is
transparent to travel, never a wall, so nothing playable breaks between this PR
and the rooms that follow it.

---

## 1. The re-cut axis (final table)

Everything at and below `olympus` is untouched. The sky bands:

| band | label | route | sMin | sMax | status |
| --- | --- | --- | --- | --- | --- |
| olympus | olympus | `/mountain` | 3.4 | 4.5 | unchanged |
| **atmosphere** | the atmosphere | — | **4.5** | **5.5** | **new** — the air column is ~100 km deep |
| atlas | the atlas | `/atlas/origin` | **5.5** | 6.5 | narrowed — the chart floor rises |
| earth | the earth | `/earth` | 6.5 | 9 | unchanged |
| **planets** | the planets | — | **9** | **11** | **new** — the sun at 1.4×10⁹ m, Mercury's orbit at 5.8×10¹⁰ |
| **solar** | the solar system | — | **11** | **13.5** | **new** — Neptune at 4.5×10¹², the heliopause at 1.8×10¹³ |
| stars | the stars | `/stars` | **13.5** | **17** | narrowed — interstellar space, the nearest star at 4×10¹⁶ |
| **galaxy** | the galaxy | — | **17** | **20.5** | **new** — one disc, 10²¹ m across, read from ~10¹⁹ |
| space | deep space | `/space` | **20.5** | 22 | narrowed — the web keeps the top |
| beyond | beyond | `/beyond` | 22 | 25.5 | unchanged |
| manifold | the manifold | `/manifold` | 25.5 | 27 | unchanged |

The table is contiguous by construction — `bandIndexAt` assumes it and
`test-scale.mjs` pins it. The four new bands ship with `route: null`; each sky
room lane flips its own single `route:` line when its page exists.

**The upper axis is one continuous zoom-out that is also one continuous
story**: you forge a world, it takes its place in a planetary neighbourhood,
the neighbourhood joins a system, the sun becomes one star among the vault,
the vault streams into an arm, and the galaxy becomes one node of the web.
The author's original narrative order (atlas → solar → planets → galaxy →
stars) is fully contained in this walk as plain pinch travel — just visited
in metric order — so no door contortion was needed above the earth. There is
**no metric inversion anywhere on the upper axis**.

That last sentence was aspirational when this document was written: one
inversion survived the re-cut, `earth.up = "atlas"`, sending a hand that
pinched *out* of the world to a chart of part of it (atlas 5.5–6.5 against
earth 6.5–9). It is gone. The ground now takes **no `up` override** and
climbs the metric axis through `planets` and `solar` into the stars, and the
atlas — a chart of a region of the ground, metrically smaller than it —
became a door **in** (`earth.extraDown`) and the earth's hearth **peer** in
`lib/peers.ts`, since a map is the same ground at another level of
description. The `atlas → stars` trunk passage is untouched. The sentence is
now true, and `test-scale.mjs` walks every band from `olympus` to `space`
asserting each upward door lands on a band no smaller than the one it left.

What the re-cut costs: nothing in room code. `scaleForRoomZoom` normalises a
room's internal camera across whatever span its band has, so `/stars`, `/atlas`
and `/space` re-mapped themselves. The one retune it forced was `/space`'s
listening post (`WEB_SCALE_S` in `lib/cosmicweb.ts`): s = 20 now belongs to the
galaxy, so the web listens from s = 127/6 ≈ 21.17 — G1, 49 Hz, one breath every
~54 s — and `test-cosmicweb.mjs` broke loudly until it did, exactly as that
suite promised.

**The cinematic mandate** (for the four sky-room lanes): every new band
boundary owes a designed handoff anchor — the focused object of band N becomes
the container of band N+1 — with the `/atlas → /stars` planet passage as the
bar. The table above and the doors below only make those passages *possible*;
the rooms make them felt.

## 2. Per-route doors — the mechanism, and why it exists

`TRAVEL_OVERRIDES` speaks at the band grain: one override per band. But the
drop band alone holds `/drop`, `/seed`, `/rocks`, `/soil`, `/coin`, `/jewel`…
— rooms that share a span of centimetres and need **different vertical
destinations**. A drop of water magnifies the plasm swimming in it; a handful
of soil crumbles into cells; a rock cleaves into its lattice of molecules.
The band grain cannot say any of that.

So `scale.ts` grows a second, thin layer, consulted first:

- **`ROUTE_TRAVEL_OVERRIDES`** — doors keyed by route prefix. Resolution
  order: **exact route match → band override → metric adjacency**, and the
  three are **unioned in that order, not substituted**. A route with an
  entry says which door its wall offers *first*; it never says which doors
  its wall *has*. A wall it stays silent on, and every route without an
  entry, falls through to the band grain — so the band grammar stays the
  default and this stays the exception. (This layer shipped as a
  replacement, and that quietly deleted `earth.extraDown` — the shore and
  the peak became unreachable by a fresh pinch down from the ground, which
  is what "weird navigation between coast and mountain and earth" was.)
- **`DOOR_ROOMS`** — rooms that are destinations below the band grain
  (`/rocks`, `/soil`), each with `route: null` until its page ships. While
  null, a door onto it resolves through to the nearest built room of its band
  (`firstBuiltAlong`'s transparency law, extended to routes) — never a 404,
  never a dead wall.
- **`travelOptionsForRoute(route, dir, enteredFrom)`** — the route-aware
  resolver `ScaleTravel` consults whenever a room knows its route. The
  band-level `travelOptions` is unchanged for old callers.
- **Memory still returns you the way you came**, at the finer grain: leaving
  a door room records its route, not just its band, so the return trip finds
  the very room. A remembered origin answers if it is a structural door of
  the wall at either grain, or if its own wall opens onto this room — the
  latter is what keeps travel that resolved *through* an unbuilt address
  round-trippable.

The law this serves is `INSPIRATION.md`'s part-of-not-size-of rule, already
stated over `TRAVEL_OVERRIDES` in `scale.ts`: *travel follows what a thing is
part of — the author's cosmology — with metric adjacency as the default.*
**Doors may invert or skip the metric order; band spans may never.** Spans
are physical addresses: the sound (`spectralRegisterFor`), the crossfade
weights and the room cameras are keyed to them. Doors bend; metres do not.

## 3. The door table (complete)

At a fork, **where on the frame the pinch sits chooses the door**: the doors
are laid across the frame west→east in the offer order below
(`lib/fork-regions.ts` → `fanRegions`, consumed by `ScaleTravel`), with a
neutral disc in the middle. A centred pinch — and every trackpad, wheel and
keyboard, which have no centroid — falls back to the press → release → press
cycle, first door listed first.

| from | direction | doors, in offer order | note |
| --- | --- | --- | --- |
| `/earth` | down | `/flowers` · `/rocks` · `/soil` · `/coast` · `/mountain` · `/atlas` | the route's own fork (what grows from it, what it is made of) leading, then the band grain it may not delete: the shore, the peak, and the chart of itself |
| `/earth` | up | the planets → the system → `/stars` | no override: the ground climbs the metric axis, transparently through the unbuilt neighbourhoods |
| `/soil` | up | `/earth` · `/flowers` · `/coast` | soil returns to the ground, or to the garden rooted in it, then its band's shore |
| `/soil` | down | `/cells` · `/tissue` | soil crumbles into the living plasm; the band's sheet follows |
| `/rocks` | up | `/earth` · `/mountain` (olympus) · `/coast` · `/flowers` | rock returns to the ground, or rises as the peak, then its band's doors |
| `/rocks` | down | `/molecules` · `/tissue` | rock cleaves into its lattice — molecules, not life |
| `/drop` | down | `/cells` · `/tissue` | the drop magnifies what swims in it; the band's sheet stays on the wall behind it |
| `/drop` | up | `/coast` · `/flowers` | unchanged — band grain |
| `/mountain` | down | `/coast` · `/rocks` · `/birds` | shore by default, then the strata, then the flock on the updraft |
| `/coast` | down | `/drop` · `/birds` | the shore keeps its doors and opens onto the sky region |
| `/coast` | up | `/mountain` · `/earth` | unchanged — band grain |
| every drop-band sibling (`/seed`, `/coin`, …) | both | band grain (tissue below, coast above) | no entry ⇒ transparent to the route layer |
| the sky bands | both | metric adjacency | no overrides from the ground to the web |

While `/rocks` and `/soil` are addresses without pages, doors onto them
resolve through to `/drop`; `test-scale.mjs` marks the exact assertions that
flip when the strata rooms land. Both routes already sit in
`LATERAL_ROUTE_BANDS` (band `drop`), so their pages take a scale address the
moment they exist.

## 4. What is pinned

`scripts/test-scale.mjs`, all falsifiable, each naming its bug: the re-cut
boundaries witnessed by physics (Mercury's orbit is `planets`, Neptune's is
`solar`, the nearest star is `stars`); a route override beating its band's
door; two rooms on one band resolving to different destinations; unbuilt
routes and bands walking through, never walling, never 404ing (the page
guard now covers every door of every addressed route in both directions);
and the round-trip law over every route-level door, memory included.
