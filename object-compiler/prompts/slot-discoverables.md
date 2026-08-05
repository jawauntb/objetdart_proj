# slot-discoverables — filling `__SLOT_DISCOVERABLES__`

You are a phase-7 slot in the Object Compiler pipeline (see
`data/object-compiler/audits/phase-7-prompt-rewrite.md`). The template
pass has written a `src/components/<Room>.tsx` skeleton whose
`useEffect(() => { … }, [])` body carries the marker
`__SLOT_DISCOVERABLES__` immediately AFTER the state-machine setup and
BEFORE the draw loop. Your job is to replace exactly that marker with
the room's **discoverables table** — the small state-guarded verb
branches that make the room deeper than its verb sheet reads.

## Why this slot exists — the long tail

`AGENTS.md` §"The room quality bar" §4 says: *rapid taps 1/3/5/n mean
increasing things; a tap is not one event*. §5 says: *the room has
a secret the impatient visitor never learns*. Together they force a
kind of behavior no verb-handler line alone can carry: a `tap` that
answers differently the fifth time in ten seconds than it did the
first, a `dwell` that unlocks a second harmonic only after the room
has drifted into its `agitated` state, a `ceremony` that opens a
different door depending on where on the surface the visitor stood.

These are **discoverables**. They live in the state machine's
transition table and in the room's per-verb count storage. The slot
below the marker writes both.

## Output contract

- Output **only the setup block** that goes at the slot position.
  It must be syntactically legal TypeScript inside the
  `useEffect(() => { … }, [])` body — the surrounding scope already
  has `apiRef`, `audio`, `haptics` (via the module import at the top),
  `writer`, `reduced`, `gov`, `agitation`. Use them.
- The first character of your reply is the first character of the
  setup; the last character is the last of the block. **Do not
  restate `__SLOT_DISCOVERABLES__`** — if the marker appears in
  your reply, the compiler will refuse to write.
- If `spec.discoverables` is empty AND `spec.state_machine.states`
  is empty, emit the single line
  `// no discoverables declared — this room's verb table is the whole
  vocabulary` and nothing else.

## What the slot must produce

For each state in `spec.state_machine.states[]`, and each entry in
`spec.discoverables[]`:

1. **A state variable** — a plain `let state: "<name>" | ...;` typed
   from the state machine's union, initialized to whichever state the
   spec marks as initial (or the first state if none is marked). This
   variable is closed over by the population's `step` and the verb
   handlers.

2. **A `transitions` map** — a small dispatch table from
   `spec.state_machine.transitions[]`. Each entry names a `trigger`
   (a verb, a threshold, or a time-based event) and a `from → to`
   pair. The transitions run when their trigger fires — usually as a
   side effect of a verb, or as a step-loop check against a domain
   value.

3. **A `discoverables` table** — a plain `const` object mapping
   `(trigger, state)` tuples to their `response` function. Each entry
   is one line in `spec.discoverables[]`. The response reads
   `apiRef.current?.<method>` and calls the domain hook the discovery
   opens.

4. **Per-verb rapid-count storage** — a small ring of timestamps per
   verb the discoverables index into. `AGENTS.md` §"The room quality
   bar" §4 says the count grows on 1/3/5/n — so keep a fixed-size
   ring and read `count >= 5` to unlock the discoverable, not a raw
   incrementing counter (which would fire the discovery once and
   never again).

5. **Expose the state and counts onto `apiRef.current`** — the verb
   handler slot (`slot-verbs.md`) reads `apiRef.current?.state?.()`
   and `apiRef.current?.tapCount?.()` to decide which branch of a
   verb to take. Export them here as small closures that read the
   local `state` variable and the count rings.

## What NOT to produce

- **No on-screen hints, no captions, no toasts.** A discoverable is
  invisible until it fires; when it fires, the visible register in
  `spec.discoverables[i].register` is the answer.
- **No `setTimeout` or `setInterval`** for state transitions. The
  transitions ride the shared frame governor via a small check in
  the population's step, or fire from the verb handlers directly.
  Time-of-day and idle transitions read `performance.now()` inside
  `step(ctx)` (not from a top-level clock).
- **No new imports.** The header brought in every symbol you need;
  if you feel one is missing, raise the issue with the domain slot,
  not this one.
- **No `Math.random` for discoverable selection.** Each discoverable
  fires deterministically from its trigger; if the choice among
  multiple discoverables needs randomization, seed it from
  `spec.storage_key` via `mulberry32`.

## Low-friction — the rapid-taps pattern

`AGENTS.md` §4 names 1/3/5/n as the natural tap counts. The pattern:

```ts
const TAP_WINDOW_MS = 3200;
const tapTimes: number[] = [];
const tapCount = (): number => {
  const now = performance.now();
  while (tapTimes.length > 0 && now - tapTimes[0] > TAP_WINDOW_MS) {
    tapTimes.shift();
  }
  return tapTimes.length;
};
const noteTap = () => {
  tapTimes.push(performance.now());
  if (tapTimes.length > 32) tapTimes.shift();
};
```

The verb handler calls `noteTap()` on every tap; the discoverable
checks `tapCount()` before firing. Do NOT set a `justTapped` boolean
and read it on the next frame — the ring is the whole record.

## Silent-until-found — the register-only signal

A discoverable's `response` MUST land in a register the room already
paints — `apiRef.current?.ringPlume(...)`, `apiRef.current?.reef.detune(...)`,
whatever the domain exports for that register. No new audio bell, no
new haptic pattern, no `console.log`. The register the room already
speaks in is the discovery's whole vocabulary.

## Voice — the handler comments

Two-of-three registers (devotional / operational / oceanic) in every
comment. A comment that reads `// tap 5 times → ring the plume` is
out of voice; one that reads `// the fifth tap in three seconds
rings the plume — the visitor's ceremony, discovered, not shown` is
in.

## Retrieval — the one-shot references

The compiler substitutes 2 discoverable-block examples below this
line. Phase 7's retrieval strategy anchors on **depth**: one slot is
the DEEP anchor (the room with the deepest state machine and
richest discoverable table — typically /coin, /stars, or /molecules);
the other is the PEER anchor. /coin's edge-vs-flat behavior is the
canonical case: the coin resolves differently based on velocity and
angle, and only shows itself after ~5 flips. Read that as the
reference for a state machine whose discoverables are gated by a
count AND a domain reading, both.

```typescript
{{one_shot_examples}}
```

## The state machine

The compiler substitutes `spec.state_machine` below this line. Read
every field — `states[].name`, `states[].description`,
`states[].visible_change`, and every transition — as load-bearing.

```yaml
{{state_machine}}
```

## The discoverables

The compiler substitutes `spec.discoverables` below this line. Each
entry is a `(trigger, response, register)` triple; the trigger names
a verb (and optionally the state it must be in for the discovery to
fire), the response names the domain method to call, and the register
names which visible layer the response lands in — that register MUST
match a `shader_layers[i].register` for the discovery to be visible
at all.

```yaml
{{discoverables}}
```

## The verbs and life

The compiler substitutes the verb briefs and the life block so your
discoverables know which verbs are available and which population's
methods to call:

```yaml
{{verbs_answered_with_briefs}}
```

```yaml
{{life}}
```

## The design context

The compiler substitutes the room's `visual_style` block so the
discoverable's response paints in the room's registers — a "kept
ochre" discoverable paints with that hue, not a made-up one.

```yaml
{{visual_style}}
```

## The brief

The compiler substitutes the spec's `verb_intent` below this line;
your discoverables should be *of a piece* with the verbs that room
already answers. Follow it; do not extend the brief with inventions.

```
{{verb_intent}}
```

Emit the setup block.
