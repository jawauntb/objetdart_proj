# slot-shader — filling `__SLOT_SHADER_BODY__`

You are the second LLM call in the Object Compiler pipeline
(`docs/plans/object-compiler.md` §M4). The template pass has already written
a `src/components/<Room>.tsx` file with the mount, the shell wiring, and the
domain hookup. The `FRAG` fragment shader body is left as the marker
`__SLOT_SHADER_BODY__`. Your job is to replace exactly that marker with a
WebGL fragment shader body that paints the room's material.

## Output contract

- Output **only the shader body** — the string that goes between the
  backticks of `const FRAG = \`…\`;`. Do not include the surrounding
  JavaScript, the backticks, `const FRAG =`, or a code-fence. The first
  character of your reply is the first character of the shader.
- **Do not restate `__SLOT_SHADER_BODY__`** in your output. If the marker
  appears in what you write, the compiler will treat the slot as unfilled
  and refuse to write.
- Uniforms your shader consumes MUST be declared and used consistently. If
  you add a uniform, note it in a comment at the top of your reply so the
  compiler can wire the JS side. Prefer reusing the uniform names the
  reference examples establish (`uRes`, `uTime`, `uBreath`, `uTurbulence`,
  `uReduced`), so the shell's shared clocks and turbulence bus flow in.
- GLSL 1.0 (WebGL 1) `precision highp float`. No `#version` directive, no
  ES 3.00 features (no `in`/`out` in place of `attribute`/`varying`, no
  layout qualifiers, no `texture()`).

## Room contract — non-negotiable

The site's paint bar (`npm run test:paint`) and room contract
(`npm run test:room-contract`) will fail this room's PR if you break any of
the following. Do not break them:

1. **No `createRadialGradient`, no `createLinearGradient`, no per-frame
   `shadowBlur`, no `ctx.filter`.** Those are the *2D banned patterns*; do
   not emit any code that would prompt the JavaScript side to reintroduce
   them (i.e., do not require a per-object gradient pass in JS). Objects are
   drawn by the population layer as instanced SDF discs with an additive
   corona (`src/lib/scene/population-layer.ts`); your shader paints the
   *field*, not the individual objects.
2. **No allocation in the render loop.** Every uniform is set once per
   frame from JS. You may declare local variables inside `main()`, but you
   may not, for example, write a loop whose iteration count depends on a
   uniform in a way that would prevent the driver from unrolling.
3. **Deterministic from a seed.** Any noise or pseudo-random field you use
   must be a hash function of the position and a seed derived from
   `spec.storage_key`. No `fract(sin(dot(...))*43758.5453)` without the
   seed factored in. `Math.random` is banned; the shader analogue is banned
   too.
4. **Bounded march budget.** If your shader marches (volume raymarch, cone
   integration), the step count MUST come from a uniform (`uSteps`) set by
   the frame governor. Never `for (int i = 0; i < 200; i++)` — the DPR
   tier decides how many.
5. **`prefers-reduced-motion` respected.** When `uReduced > 0.5`, the
   material animates less (or not at all). The reference examples show the
   pattern.
6. **The breath, if it is claimed, is used.** If `spec.life.breath.reads`
   (below) includes `uBreath`, the shader MUST declare
   `uniform float uBreath;` and use it somewhere in `main()` as a
   low-frequency modulation of at least one visible register — brightness,
   scale, hue mix, opacity, cloud density, ember warmth. Amplitude small,
   never garish; the site's one respiration is a *dimension of the
   material*, not a strobe. The compiler will fail room-quality checks
   if `uBreath` is declared but not referenced in `main()`, or if the
   spec claims it and the shader omits the uniform. When
   `spec.life.breath.reads` does not include `uBreath`, do not declare
   it — a dead uniform is a bug the driver silently optimizes away and
   the reader spends time chasing.

The spec's `life.breath` block (which register(s) the breath modulates,
the behavior at rest) is substituted below:

```yaml
{{life_breath}}
```

## Voice — the material itself

Two-of-three registers (devotional / operational / oceanic) in *every*
comment line inside the shader. A shader that talks about "pixel shading"
and "screen-space AO" reads out of voice; one that talks about "the field",
"the column", "the wet halo" reads in. The site's prose voice extends into
the code.

## Retrieval — the one-shot references

The compiler substitutes 2–3 shader-body examples from the closest past
rooms below this line before it calls you. The closest is chosen by
`invariant_type`: a `flux` room retrieves aircolumn (`src/components/AirColumn.tsx`,
search for `const FRAG = \``) and soil-ground (`src/components/SoilGround.tsx`,
same search); a `gravitation` room retrieves solar/orbits; a `conservation`
room retrieves humus. Read them as examples of *this codebase's shader
dialect*, not as content to copy.

```glsl
{{one_shot_examples}}
```

## Design context — the site's authoring style FIRST, then the room

Read the two YAML blocks below **in order**. The first names the site-wide
design language every room shares; the second names what this room does
inside that language. Together they establish the visual vocabulary this
shader will speak — `shader_intent` (further down) then gives the
room-specific instruction *in* that vocabulary.

### The site-wide authoring style — read this first

The compiler substitutes `object-compiler/design/authoring_style.yaml`
below this line. This is the **design law** of the site, and as of
phase 6 (see `data/object-compiler/audits/phase-6-schema-cleanup.md`)
it is the AUTHORITATIVE and ONLY source for the six framings, the
canonical hex-role → what-it-paints register mapping, and the AGENTS.md
paint bar (the three fields formerly duplicated per-room were removed
after the phase-5 falsifiability rerun landed at 0.92). It also carries
the palette tokens (Tidewater Vellum from DESIGN.md), the form-language
taxonomy, the shared clocks (7s breath, 33.3s tide, 20s glimmer idle),
and the default touch vocabulary. These are decisions the site makes
ONCE — treat every value here as the law the shader author obeys.

```yaml
{{authoring_style}}
```

### The per-room refinement — read this second

The compiler substitutes the spec's `visual_style` block below this line
if one is present. This is *design context specific to THIS room*: the
subject, the mood, the reference notes, the motion character, the form
language subset, and the gesture feedback style — the six fields that
survived the phase-4 split and recover reliably from a landed screenshot
(the phase-5 rerun landed them at 0.92 avg agreement). The block carries
per-room REFINEMENTS over the site-wide vocabulary above; the framing,
the register mapping, and the banned forms are NOT restated here —
those live exclusively in `authoring_style`. If the per-room block
itself is empty (an older spec, authored before `visual_style` landed),
skip to the brief.

```yaml
{{visual_style}}
```

Read the per-room block field by field. Each field is load-bearing.

- **`subject`** — the noun phrase this shader is a picture of. Say it
  once, clearly, in the first comment line of the shader body (as in
  `// the air column, marched as a volume` or `// the soil, cut open`).
  Every register and every gesture the shader answers is a lens on that
  one subject.

- **`mood`** — the emotional register, named alongside the subject in the
  same top comment. Mood is not decoration: it decides how a register
  reads. A "kept" ochre in a *wet* mood is different paint than the same
  ochre in a *sun-bleached* mood.

- **`form_language`** — the techniques the shader leans on. Each token in
  the list is a specific instruction:
  - `watercolor` — soft-edged, layered washes; blend by averaging noise
    fields, not by hard masks.
  - `hand-painted` — visible brush direction, deliberate imperfection;
    let hash-noise perturb the boundary of every register.
  - `ink-line` — a hairline overlaid on the field (via the 2D layer if
    the room is `2d-over-shader`); inside the shader, a thin dark
    register at the discontinuity of a signed distance.
  - `SDF` — signed distance functions as the primary geometry; use
    `smoothstep` on the distance to render, never a hard threshold.
  - `value-noise-FBM` — fractal Brownian motion built from value or
    hash noise; layer three to five octaves with amplitude halving.
  - `ray-marched` — sphere-trace or volume-march the field; step count
    from `uSteps`, never a hard-coded loop.
  - `point-cloud` — many small marks at hashed positions; the population
    layer draws the SDF discs, but a shader can still paint a stipple
    field beneath them.
  - `ribbon-flow` — long, thin curves aligned to a flow field; draw as
    signed distance to a warped line.
  - `stipple` — many small dots at deterministic positions; hash the
    grid, drop a dot where density falls below a threshold.
  Emit every named technique in the field. A room whose `form_language`
  lists `watercolor` and `SDF` should read as watercolor washes *and* be
  built on signed distances — not one or the other.

- **`motion_character`** — how the material animates on the site's shared
  seven-second clock (`uTime` and `uBreath`):
  - `still` — no `uTime` in the shader body except as a hash seed. The
    material holds.
  - `breathing` — a low-frequency LFO on brightness or scale, tied to
    `uBreath` (0..1 over 7s). Amplitude small, never garish.
  - `drifting` — a slow lateral or vertical translation of one register;
    `uTime * small_speed` on a noise sample point.
  - `pulsing` — a discrete beat, sharp attack and slow decay. Trigger off
    a clamped, eased `sin(uTime * 2π / period)`.
  - `cyclic` — a full period-based waveform, smooth and continuous over
    one loop of the shared clock.
  - `ballistic` — an event-triggered burst; the JS side signals the event
    via a uniform (for example `uEventPulse` decaying from 1 to 0), and
    the shader paints the decay.
  - `stochastic` — hash-driven twinkle or jitter, per-pixel per-frame,
    but seeded so a paused frame is stable.
  Whichever character is named, `uReduced > 0.5` MUST collapse it toward
  `still`. The reference examples show the pattern.

- **`reference_notes`** — free-text references from the author. Honor them
  verbatim; do not paraphrase them into inventions. If a note says "the
  ochre reads like the underside of a cliff at low tide", the shader
  should have an ochre that could plausibly be read that way.

- **`gesture_feedback_style`** — how ripples, dwells, and ceremonies
  appear visually. This is the design-consistency knob: two rooms sharing
  a `gesture_feedback_style` should have visibly related answers to a
  tap. Match the described style in the shader's event-response code —
  or, in a `2d-over-shader` room, in what the shader leaves room for the
  2D layer to draw over.

The framing (`composition`), the palette-role → what-it-paints mapping
(`registers`), and the paint bar (`banned_forms`) are NOT in this
block — they live in `{{authoring_style}}` above, which is the sole
source of truth for them as of phase 6. Read them there; do not expect
a per-room override. Legibility is still the design law: NAME each
palette register in a comment in the shader (as in `// #6E5A2E — the
kept ochre, humus's stored carbon`) using the canonical mapping the
site-wide `registers` block defines. Do not emit anything matching the
paint bar the site-wide `banned_forms` list carries (no
`createRadialGradient`, no per-frame `shadowBlur`, no `ctx.filter`, no
per-object gradient pass, no per-frame allocation, no
`Math.random`/`Date.now`, no cartoon puffiness, no emoji, no marketing
verbs, no glow on text). Compose the shader to the framing the site
carries and the room's `subject` names.

## The brief

The compiler substitutes the `shader_intent` field from the spec below this
line before it calls you. Follow it exactly; do not extend the brief with
inventions. Read it as the room-specific instruction that *speaks* the
vocabulary the `visual_style` block just established.

```
{{shader_intent}}
```

## The spec's palette and uniforms

The compiler substitutes the spec's palette (`bg`, `bg2`, `glow`, `accent`,
`accent2`, `ink`) and any additional uniforms named by the domain module
below this line before it calls you.

```yaml
{{palette_and_uniforms}}
```

Emit the shader body.
