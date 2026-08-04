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

## The brief

The compiler substitutes the `shader_intent` field from the spec below this
line before it calls you. Follow it exactly; do not extend the brief with
inventions.

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
