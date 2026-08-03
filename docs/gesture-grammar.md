# The Gesture Grammar

The exhaustive inventory of what a hand (and the device it holds) can actually say to this
site, and what each utterance means everywhere. This is the contract behind
`src/lib/gesture/` — rooms bind meanings from this grammar; they do not invent private
gestures outside it. Companion to `INSPIRATION.md` §3 (the medium is the message) and §5
law 6 (no controls to learn).

The goal is that the full input space of a phone, tablet, or laptop is *structurally*
explored — not just tap/drag/pinch because those are the defaults, but every dimension the
hardware exposes, each given one consistent meaning.

---

## 1. What the hardware can sense

### Per-contact dimensions (each finger, every frame)

| dimension | source | notes |
| --- | --- | --- |
| position | PointerEvent x/y | the baseline |
| duration | timestamps | tap vs. dwell vs. ceremony (see tiers) |
| force | `pressure` / iOS `Touch.force` | real on iPhone/iPad and pens; many Androids report a constant 0.5 — must feature-detect, never require |
| contact area | `width`/`height` | fingertip vs. flat finger pad vs. knuckle — a *free* soft/hard axis that works even without force |
| pointer type | `pointerType` | touch / pen / mouse — pens add tilt, twist, hover, barrel button |
| stylus tilt/twist | `tiltX/tiltY/twist` | Apple Pencil & friends; optional shading dimension |

### Derived per-gesture dimensions

| dimension | derivation | expressive meaning |
| --- | --- | --- |
| chord size | simultaneous contacts (settle window ~40ms) | **which layer of the stack you're addressing** (§3) |
| tap count | taps within 280ms windows | single / double / triple |
| intensity | force → area → approach-velocity, best available | how hard you meant it (0..1) |
| velocity / flick | release speed + direction | throwing, skipping, dismissing |
| direction | continuous angle, or 8-way | steering |
| path shape | line / arc / winding count | a **circular scrub** is a distinct verb (winding ≥ ¾ turn) |
| two-finger decomposition | common translation + radial + angular components | the orthogonal basis of two-finger motion: **pan / pinch / twist** — three independent channels in one grip |
| spread | inter-finger distance held static | a **span**: sustaining an interval, like holding a chord |
| rhythm | inter-tap intervals | tap tempo — the site can *listen to your pulse* and entrain clocks to it |
| drumming | alternating distinct contact points | rolls, patters — percussion on any surface |
| stagger | chord fingers landing spread over >40ms | an arpeggio rather than a chord |

### Whole-device dimensions (the vessel)

| dimension | source | notes |
| --- | --- | --- |
| tilt | DeviceOrientation β/γ | gravity for every room |
| heading | DeviceOrientation α | compass; the room can know which way the real sea is |
| shake | DeviceMotion accel variance | agitation, scatter |
| knock | accel spike while untouched | tapping the *back or side* of the phone — a hidden drum |
| flip face-down | orientation + light heuristic | night; puts the room to sleep |
| **permission** | iOS requires `DeviceMotionEvent.requestPermission()` *inside a user gesture* | motion features must degrade gracefully and be invited, never demanded |

### Beyond touch (available, use sparingly and always opt-in)

- **Breath** — microphone RMS burst with low spectral centroid = blowing. There is a candle
  on every page of this site. *The candle can be blown out.* This is the single most
  on-thesis use of any sensor; everything else microphone stays off.
- **Ambient light** — Chrome/Android sensor; rooms may dim with the real room. Progressive
  enhancement only.
- **Time and weather** — already in use (weather schedulers, the live clock). The site's
  environmental senses.

### Desktop equivalents

Every gesture needs a desktop reading: hover ≈ light touch; wheel = local zoom;
ctrl+wheel / Safari `GestureEvent` = trackpad pinch (and rotation on Safari); drag = drag;
keyboard stays fully wired per the accessibility baseline. Desktop is a quieter dialect of
the same grammar, never a separate one.

## 2. What the OS has already claimed (never fight these)

- **iOS**: bottom-edge swipe (home), top edges (Control Center / notifications),
  left/right screen-edge swipes in Safari (back/forward — the big one), long-press callout
  on links/images, double-tap and pinch page-zoom, text selection; three-finger
  tap/pinch/swipe are system editing gestures *inside text inputs only*; four/five-finger
  swipes switch apps on iPad.
- **Android**: left/right edge back gesture, bottom-edge home, long-press selection,
  double-tap zoom.

Consequences, binding on all rooms:

1. Playable surfaces set `touch-action: none`, `user-select: none`,
   `-webkit-touch-callout: none`, and the viewport disables double-tap zoom.
2. Gestures are recognized only when they *begin* inside a ~24px inset from screen edges
   (the "surf line"). Edge starts are surrendered to the OS.
3. The structural grammar caps at **three fingers**. Four-and-five-finger chords are
   unreliable (iPad app-switching) and may only ever be easter eggs, never required.
4. Three-finger gestures are never bound on or over text inputs.
5. The iOS shell (and installed PWA) reclaims Safari's edge swipes; the web build simply
   lives without them.

## 3. The structural key: fingers address the stack

The grammar's organizing principle — the thing that makes it a *grammar* and not a list:
**the number of fingers selects which abstraction layer you are touching.**

- **One finger touches the material.** Objects, water, petals, stars. Tap, stroke, press,
  plant, throw. The layer of *things*.
- **Two fingers touch the representation.** The frame the things appear in: pinch moves
  through scale, twist rotates the lens (level of description — fluid ↔ equation ↔ felt),
  two-finger drag pans the frame. The layer of *maps*.
- **Three fingers touch the law.** The generative parameters of the room: three-finger
  drag is wind/weather, three-finger hold is time dilation (the room slows while held),
  three-finger twist advances/rewinds the room's season. The layer of *worlds*.
- **The device itself is the vessel.** Tilt is gravity, shake is agitation, a knock on the
  case is a knock on the room's door, face-down is night, breath meets the candle.

Thing → map → law → vessel. The hand climbs the same stack the site is about. This is why
the binding is fixed site-wide: once a hand learns that two fingers mean "the map, not the
thing," that knowledge transfers to every room, forever, with nothing to read.

**Instrument surfaces refine the key from finger *count* to finger *correlation*.** On a
polyphonic surface (a room that binds `voice`), every finger is material — a note that
sounds the instant it lands — because a chord is many independent touches of the thing,
not an address into the stack. The stack is still reachable: fingers that land *together*
(≤80ms) and move *against each other* — spreading, closing, turning about their midpoint —
are one correlated grip, and that grip is the map layer (pinch/twist) exactly as
everywhere else. Staggered landings are voices forever; a chord must never read as a
pinch. The physics of hands makes this instruction-free: chord fingers land staggered or
hold still, gesture fingers land together and move together-against. (One sacrifice: the
anchored-thumb pinch reads as two voices on instrument surfaces; pinch with both fingers
moving, and the desktop wheel, still zoom.)

## 4. The semantic vocabulary (what `lib/gesture` emits)

Rooms receive semantic events, never raw pointers:

```
tap        { fingers 1–3, count 1–3, intensity, x, y }
hold       { fingers, phase: enter|tick|release, elapsed, tier, pressure, x, y }
drag       { fingers 1|3, dx, dy, velocity, path, phase }
flick      { fingers, angle, speed }
pinch      { scale, velocity, phase }          // two-finger radial
twist      { angle, velocity, phase }          // two-finger angular
pan2       { dx, dy, phase }                   // two-finger translation
scrub      { winding, angularVelocity, cx, cy } // circular path, any finger count
voice      { id, phase: start|move|end|cancel, x, y, intensity } // polyphonic surfaces:
           // one stream per finger; binding it switches the surface's dialect
           // (hold/drag/scrub silenced, correlated pairs may cancel into pinch/twist)
span       { spread, phase }                   // two fingers held apart, static
rhythm     { bpm, stability }                  // from tap trains
drum       { hits, alternation, x, y, ax, ay, bx, by } // multi-point patter:
           // the committing hit plus the two zones the hands alternate
           // between, so a room can play the space between them
arpeggio   { fingers, spreadMs, x, y }         // staggered chord landing —
           // instrument surfaces only; the voices already sound in landing
           // order, this narrates the roll and never re-triggers them
shake      { intensity }
tilt       { beta, gamma }                     // smoothed
knock      { intensity }
flip       { faceDown }
breath     { strength }                        // opt-in, candle contexts only
```

Shared thresholds (centralized in `gesture/core.ts`, never redefined per room):
hold tiers **250ms** (touch) / **900ms** (dwell) / **2500ms** (ceremony); tap window
280ms; chord settle 40ms; scrub at ¾ winding; flick above 0.6 px/ms; voice stagger 80ms
and pair-decide 180ms on instrument surfaces. A drum patter commits at three landings
alternating between two zones inside a 1.2s window (a same-spot roll or a chord's
simultaneous landings never drum); an arpeggio is a chord whose landings spread past
the 40ms settle with no entrance more than 600ms after the last. Intensity always
0..1 from the best available physical channel.

## 5. Global bindings (identical in every room)

| gesture | meaning everywhere |
| --- | --- |
| **two-finger tap** | **step back** — the frame retreats one step: a gentle zoom-out nudge within the band (never crossing a wall), one camera step out in rooms that own zoom, and if a lens is raised, it lowers |
| **three-finger tap** | **tutti** — one synchronized pulse of everything alive in the room: every active element answers softly at once, the room stating itself |
| pinch | zoom **within** the current scale band |
| pinch held through the detent | **travel** to the neighboring band (with resistance + haptic click) |
| twist | rotate the **lens** — change level of description at fixed scale |
| two-finger drag | pan the frame |
| three-finger drag | wind / weather |
| three-finger hold | time dilation while held |
| long-press (dwell tier) | plant / grow / charge |
| ceremony hold (2.5s) | the room's one solemn act (keep, seal, bloom fully) |
| shake | scatter / agitate |
| tilt | gravity |
| knock | wake / ring the room |
| flip face-down | night |
| breath | the candle |

Everything else — what a tap *does*, what grows on long-press, what the weather is made
of — is the room's own register, interpreted in its material. Global bindings are the
rhyme scheme; rooms write the lines.

**Duration and intensity are continuous axes, never switches.** The tiers (touch /
dwell / ceremony) mark thresholds where *kinds* of act begin, but within and beyond
each tier the hold keeps counting and the room must keep answering: whatever a hold
does should deepen the longer it is held, and whatever a tap does should scale with
how hard it landed. A binding that fires identically at 900ms and at 2400ms is
wasting the richest dimension the hand has.

**The vessel is not optional decoration.** Once the candle has invited the senses
(`lib/vessel.ts`), every room should hang from the world's real gravity: tilt gives
parallax, weight, or lean; shake agitates in the room's own material; the device is
the room's body, exactly as /coin has always known.

## 6. The discovery economy

No gesture is ever documented in the UI. Instead every room must satisfy:

1. **Implements every global binding** that its material can express (a room with no
   scale neighbor yet still honors twist and weather).
2. **At least three room-specific discoveries** beyond the globals — things a curious
   hand finds within sixty seconds of play, each rewarding in at least two senses in the
   same frame.
3. **Glimmers, not labels.** After ~20s of idle or single-verb play, the room may hint
   physically — a ripple where a scrub would land, a brief shiver suggesting shake —
   never with text.
4. **No punishment.** Unbound gestures do something gently neutral (the material absorbs
   them). Nothing errors, nothing modals.
5. **Reduced-motion and no-sensor paths** exist for everything: motion-derived meanings
   get a touch equivalent; nothing is *only* reachable by shake, tilt, force, or breath.

## 7. Adoption

`src/lib/gesture/` replaces per-room pointer wiring incrementally (law: build in one room,
then extract — the extraction happened here first because five rooms had already grown
divergent dialects). A room adopts by mounting `attachGestures(el, bindings)` and deleting
its private listeners. The per-room binding tables live with the room's component; the
grammar, thresholds, and event shapes live here and in `gesture/core.ts` only.
