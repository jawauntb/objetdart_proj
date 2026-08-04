// The scene model: objects describe themselves, the room draws the population.
//
// Every assertion here names a bug a plausible change would introduce. None
// of them restates a constant back at itself.

import assert from "node:assert/strict";
import { loadTsModule } from "./lib/load-ts.mjs";

const objectModule = loadTsModule("src/lib/scene/object.ts");
const instancesModule = loadTsModule("src/lib/scene/instances.ts");

const {
  OBJECT_VERBS,
  POSITIONAL_VERBS,
  createPopulation,
  createVerbEvent,
  validateSpec,
  hashSeed,
  mulberry32,
  DEFAULT_REACH,
} = objectModule;
const { createInstanceBuffer, readInstance, instanceBudget, INSTANCE_STRIDE } = instancesModule;

// ———————————————————————————————————————————————————————————————————————
// a spec to play with
// ———————————————————————————————————————————————————————————————————————

function speck(overrides = {}) {
  return {
    kind: "speck",
    cap: 3,
    reach: 0.1,
    retireRate: 1, // one second to leave, so the test can measure the exhale
    born(seed, nx, ny, tMs) {
      const rng = mulberry32(seed);
      return {
        id: 0,
        seed,
        nx,
        ny,
        bornMs: tMs,
        growth: 0.1,
        sealedMs: null,
        presence: 1,
        heat: 0,
        tint: rng(),
      };
    },
    step(s, ctx) {
      s.growth = Math.min(1, s.growth + ctx.dt);
    },
    emit(s, ctx, out) {
      out.push(s.nx * ctx.width, s.ny * ctx.height, 4 + s.growth * 6, 0, s.tint, 0.5, 0, s.presence);
    },
    verbs: ["touch", "tutti"],
    respond: {
      touch: (s, e) => {
        s.heat += e.intensity;
      },
      tutti: (s) => {
        s.heat += 1;
      },
    },
    ...overrides,
  };
}

function ctxOf(dt) {
  return {
    dt,
    tMs: 0,
    breath: 0.5,
    detail: 1,
    wind: 0,
    gravity: 0,
    agitation: 0,
    season: 0,
    timeScale: 1,
    reducedMotion: false,
  };
}

// ———————————————————————————————————————————————————————————————————————
// 1. the verb contract — a claimed verb that does nothing is the bug
// ———————————————————————————————————————————————————————————————————————

{
  // Catches: someone adds "season" to the manifest of verbs a room advertises
  // and forgets the handler. The hand twists three fingers, nothing answers,
  // and nothing anywhere says so.
  const problems = validateSpec(
    speck({ verbs: ["touch", "season"], respond: { touch: () => {} } }),
  );
  assert.equal(problems.length, 1, "one unimplemented verb should raise exactly one problem");
  assert.match(problems[0], /season/, "the problem must name the verb that has no handler");

  // Catches the mirror bug: a handler written but never declared, so the room
  // routes around it forever and the code reads as though it works.
  const orphan = validateSpec(
    speck({ verbs: ["touch"], respond: { touch: () => {}, agitate: () => {} } }),
  );
  assert.equal(orphan.length, 1, "an undeclared handler is also a contract violation");
  assert.match(orphan[0], /agitate/);

  assert.deepEqual(validateSpec(speck()), [], "a whole spec has nothing to report");

  assert.throws(
    () => createPopulation(speck({ verbs: ["touch", "night"], respond: { touch: () => {} } })),
    /night/,
    "createPopulation must refuse a spec that claims a verb it cannot answer — the failure " +
      "belongs at the moment the room is written, not in a stranger's hand",
  );

  const unknown = validateSpec(
    speck({ verbs: ["touch", "wiggle"], respond: { touch: () => {} } }),
  );
  assert.match(unknown[0], /not a verb of the grammar/, "rooms may not invent private verbs");
  assert.ok(
    OBJECT_VERBS.every((v) => typeof v === "string"),
    "the verb vocabulary must be a flat list of names",
  );
}

// ———————————————————————————————————————————————————————————————————————
// 2. routing — the stack, and the reach
// ———————————————————————————————————————————————————————————————————————

{
  const pop = createPopulation(speck());
  const near = pop.spawn(0.5, 0.5, 0);
  const far = pop.spawn(0.9, 0.9, 1);
  const e = createVerbEvent();

  // Catches a routing regression that sprays a positional verb over the whole
  // population — the difference between touching a thing and shouting.
  e.verb = "touch";
  e.intensity = 1;
  e.nx = 0.5;
  e.ny = 0.5;
  assert.equal(pop.route(e), 1, "a positional verb reaches exactly one object");
  assert.equal(near.heat, 1, "the object under the finger answered");
  assert.equal(far.heat, 0, "the object across the room did not");

  // Catches a reach that silently became infinite (or zero): just inside the
  // radius answers, just outside does not.
  e.nx = 0.5 + DEFAULT_REACH; // spec's reach is 0.1, DEFAULT_REACH is smaller
  assert.equal(pop.route(e), 1, "a contact inside the reach still lands");
  e.nx = 0.5 + 0.1001;
  e.ny = 0.5;
  assert.equal(pop.route(e), 0, "a contact past the reach touches nothing");

  // Catches tutti degrading into "the nearest thing pulses" — it is the whole
  // room stating itself at once or it is not tutti.
  const beforeNear = near.heat;
  const beforeFar = far.heat;
  e.verb = "tutti";
  assert.equal(pop.route(e), 2, "a field verb reaches every standing object");
  assert.equal(near.heat, beforeNear + 1);
  assert.equal(far.heat, beforeFar + 1);

  assert.ok(POSITIONAL_VERBS.has("dwell"), "planting is positional");
  assert.ok(!POSITIONAL_VERBS.has("wind"), "weather is not");

  // Catches an undeclared verb quietly reaching objects anyway.
  e.verb = "knock";
  assert.equal(pop.route(e), 0, "a verb the material never claimed reaches nobody");
}

// ———————————————————————————————————————————————————————————————————————
// 3. lifecycle — the cap retires, it does not delete
// ———————————————————————————————————————————————————————————————————————

{
  const pop = createPopulation(speck()); // cap 3, retireRate 1
  const first = pop.spawn(0.1, 0.1, 0);
  pop.spawn(0.3, 0.1, 10);
  pop.spawn(0.5, 0.1, 20);
  assert.equal(pop.standing(), 3);

  pop.spawn(0.7, 0.1, 30);
  // Catches the splice: a thing that vanishes between frames is the one
  // motion the eye reads as a bug, and it is what "capped population" used to
  // mean everywhere in this codebase.
  assert.ok(first.presence < 1, "past the cap the oldest starts leaving");
  assert.ok(first.presence > 0, "and it is still on screen this frame");
  assert.equal(pop.items.length, 4, "it has not been removed yet");
  assert.equal(pop.standing(), 3, "but it no longer counts as standing");

  // Catches a retiring object still answering the hand.
  const e = createVerbEvent();
  e.verb = "touch";
  e.intensity = 1;
  e.nx = first.nx;
  e.ny = first.ny;
  assert.equal(pop.route(e), 0, "a thing on its way out is past answering");

  pop.step(ctxOf(0.5));
  assert.equal(pop.items.length, 4, "half a second in, it is still fading");
  pop.step(ctxOf(0.6));
  assert.equal(pop.items.length, 3, "past its retire time it is gone");
  assert.ok(!pop.items.includes(first));

  // Catches letGo() emptying the array instantly instead of exhaling.
  pop.letGo();
  assert.equal(pop.standing(), 0, "nothing stands after the exhale");
  assert.equal(pop.items.length, 3, "but the room still has something to draw while they leave");
  pop.step(ctxOf(1.1));
  assert.equal(pop.items.length, 0, "and then it is empty");
}

// ———————————————————————————————————————————————————————————————————————
// 4. determinism and persistence
// ———————————————————————————————————————————————————————————————————————

{
  const spec = speck();
  const a = spec.born(hashSeed(7, 11), 0.25, 0.75, 0);
  const b = spec.born(hashSeed(7, 11), 0.25, 0.75, 0);
  // Catches Math.random or Date.now creeping into birth: your night must
  // look like yours, every time.
  assert.equal(a.tint, b.tint, "the same seed births the same thing");
  const c = spec.born(hashSeed(7, 12), 0.25, 0.75, 0);
  assert.notEqual(a.tint, c.tint, "and a different seed births a different one");

  const pop = createPopulation(speck());
  pop.spawn(0.2, 0.4, 0);
  pop.spawn(0.6, 0.8, 5);
  const leaving = pop.spawn(0.9, 0.1, 9);
  leaving.presence = 0.5;
  const saved = pop.serialize();
  assert.equal(saved.items.length, 2, "a thing already leaving is not kept — it chose to go");

  const restored = createPopulation(speck());
  restored.load(saved, 100);
  assert.equal(restored.standing(), 2, "what stood, stands again");
  assert.equal(restored.items[0].nx, 0.2);
  assert.equal(restored.items[1].ny, 0.8);
  // Catches ids colliding after a reload, which makes two objects one.
  assert.notEqual(restored.items[0].id, restored.items[1].id, "reloaded objects keep distinct ids");

  // Catches a corrupted or foreign payload replacing the room's material.
  restored.load({ kind: "not-a-speck", items: [{ nx: 0, ny: 0 }] }, 100);
  assert.equal(restored.items.length, 0, "a payload from another room is refused, not adopted");
  restored.load(null, 100);
  assert.equal(restored.items.length, 0, "and so is nothing at all");

  // Catches a stored file that has grown past the cap re-inflating the room.
  const over = { kind: "speck", items: Array.from({ length: 9 }, (_, i) => ({ nx: i / 9, ny: 0.5, seed: i, growth: 1, bornMs: 0, sealedMs: null, presence: 1 })) };
  restored.load(over, 100);
  assert.equal(restored.items.length, 3, "loading honours the cap the room declared");
}

// ———————————————————————————————————————————————————————————————————————
// 5. the instance buffer — the ceiling is real, and nothing invisible ships
// ———————————————————————————————————————————————————————————————————————

{
  const buf = createInstanceBuffer(2);
  buf.push(1, 2, 3, 0, 0.5, 0.5, 0, 1);
  buf.push(4, 5, 6, 0, 0.5, 0.5, 0, 1);
  buf.push(7, 8, 9, 0, 0.5, 0.5, 0, 1);
  // Catches a buffer that quietly grows: an allocation in the RAF loop, and
  // a GPU upload that no longer matches its declared size.
  assert.equal(buf.count, 2, "capacity is a hard ceiling");
  assert.equal(buf.overflow, 1, "and what it refused is counted, not lost silently");
  assert.equal(buf.data.length, 2 * INSTANCE_STRIDE, "the array was allocated once, at capacity");
  assert.equal(buf.view().length, 2 * INSTANCE_STRIDE, "only the written region uploads");

  const first = readInstance(buf, 0);
  assert.equal(first.x, 1);
  assert.equal(first.r, 3);
  assert.equal(readInstance(buf, 2), null, "there is no third instance to read");

  buf.reset();
  assert.equal(buf.count, 0);
  assert.equal(buf.overflow, 0, "reset clears the overflow tally too");

  // Catches invisible instances still costing a vertex fetch and a blend.
  buf.push(1, 1, 5, 0, 0, 0, 0, 0);
  assert.equal(buf.count, 0, "a fully transparent instance never reaches the GPU");
  buf.push(1, 1, 0, 0, 0, 0, 0, 1);
  assert.equal(buf.count, 0, "nor does one with no radius");

  // Catches a detail multiplier that stops biting at a low quality tier.
  assert.ok(instanceBudget(1000, 0.4) < 1000, "a low tier really does cost the room particles");
  assert.equal(instanceBudget(1000, 1), 1000);
  assert.ok(instanceBudget(1000, 0) >= 1, "and it never reaches zero — a room with nothing in it is not a saving");
}

// ———————————————————————————————————————————————————————————————————————
// 6. emit writes instances, not draw calls
// ———————————————————————————————————————————————————————————————————————

{
  const pop = createPopulation(speck());
  pop.spawn(0.5, 0.25, 0);
  pop.spawn(0.5, 0.75, 0);
  const buf = createInstanceBuffer(16);
  pop.emit({ width: 400, height: 800, tMs: 0, breath: 0.5, detail: 1, reducedMotion: false }, buf);
  assert.equal(buf.count, 2, "each standing object contributed its instance");
  assert.equal(readInstance(buf, 0).y, 200, "and placed itself in the room's own pixels");
  assert.equal(readInstance(buf, 1).y, 600);
}

// ———————————————————————————————————————————————————————————————————————
// 7. the radial-sprite cache — a key really has to mean "same bake"
// ———————————————————————————————————————————————————————————————————————

{
  // A tiny fake canvas/2D-context, just enough surface for the module to
  // run against in node: no real rasterizing, but every call is counted, so
  // the test can tell a fresh bake from a cache hit without a browser.
  function fakeDocument() {
    let createRadialGradientCalls = 0;
    const makeCanvas = () => {
      const ctx = {
        fillStyle: null,
        createRadialGradient(...args) {
          createRadialGradientCalls += 1;
          const stops = [];
          return {
            args,
            addColorStop(offset, color) {
              stops.push([offset, color]);
            },
            stops,
          };
        },
        fillRect() {},
      };
      return {
        width: 0,
        height: 0,
        getContext: () => ctx,
        _ctx: ctx,
      };
    };
    const document = { createElement: () => makeCanvas() };
    return { document, calls: () => createRadialGradientCalls };
  }

  const { document: doc1, calls: calls1 } = fakeDocument();
  const spriteModule = loadTsModule("src/lib/scene/radial-sprite.ts", { globals: { document: doc1 } });
  const { bakeRadialSprite } = spriteModule;

  const specA = {
    width: 32,
    height: 32,
    stops: [
      { offset: 0, color: "rgba(1,2,3,1)" },
      { offset: 1, color: "rgba(1,2,3,0)" },
    ],
  };
  const a1 = bakeRadialSprite("sprite-a", specA);
  const a2 = bakeRadialSprite("sprite-a", specA);
  // Catches a cache-key bug that rebuilds on every call — the entire point
  // of the shared baker is that a repeat key costs a Map lookup, not a
  // fresh `createRadialGradient` allocation and raster.
  assert.equal(calls1(), 1, "the same key bakes exactly once, however many times it's requested");
  assert.equal(a1, a2, "a repeat key returns the identical cached canvas, not a lookalike");

  const specB = {
    width: 32,
    height: 32,
    stops: [
      { offset: 0, color: "rgba(9,9,9,1)" },
      { offset: 1, color: "rgba(9,9,9,0)" },
    ],
  };
  const b1 = bakeRadialSprite("sprite-b", specB);
  // Catches the mirror bug: a cache that collapses every key onto the first
  // sprite it ever baked, so two genuinely different-looking sprites would
  // silently render identically.
  assert.equal(calls1(), 2, "a new key bakes a new sprite");
  assert.notEqual(a1, b1, "two distinct keys never share a canvas");

  // The `detail` hook layers deterministic extra texture onto a sprite
  // (TissueSheet's cytoplasmic grain) — it must run once, on the bake, and
  // never again on a cache hit, or a cached sprite would accumulate a fresh
  // scatter of grain every frame it's requested.
  let detailRuns = 0;
  const specC = {
    width: 16,
    height: 16,
    stops: [{ offset: 0, color: "rgba(0,0,0,1)" }],
    detail: () => { detailRuns += 1; },
  };
  bakeRadialSprite("sprite-c", specC);
  bakeRadialSprite("sprite-c", specC);
  bakeRadialSprite("sprite-c", specC);
  assert.equal(detailRuns, 1, "the detail hook fires once, on the bake, never on a cache hit");

  // A missing `document` (a server render, same as every other room's own
  // bakers) must fail soft — the room draws nothing that frame, not throw.
  // No `globals` override at all: node has no ambient `document`, exactly
  // like an SSR pass — and a distinct cache key from the loads above, so
  // this genuinely re-runs the module rather than reusing the doc1-bound one.
  const ssrModule = loadTsModule("src/lib/scene/radial-sprite.ts");
  assert.equal(ssrModule.bakeRadialSprite("sprite-d", specA), null, "no document, no sprite — and no throw");
}

console.log(
  `scene ok: ${OBJECT_VERBS.length} verbs, ${INSTANCE_STRIDE} instance fields, ` +
    "contract refuses a claimed verb with no handler, radial-sprite cache keys on the bake that matters",
);
