import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const rootUrl = new URL("../", import.meta.url);

function loadTsModule(path, requireMap = {}, globals = {}) {
  const filename = fileURLToPath(new URL(path, rootUrl));
  const source = readFileSync(filename, "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  const requireShim = (id) => {
    if (id in requireMap) return requireMap[id];
    if (id.startsWith("@/")) {
      const rel = `src/${id.slice(2)}.ts`;
      return loadTsModule(rel, requireMap, globals);
    }
    throw new Error(`Unexpected require(${id}) while loading ${path}`);
  };
  const env = {
    module,
    exports: module.exports,
    require: requireShim,
    setTimeout: globals.setTimeout ?? setTimeout,
    clearTimeout: globals.clearTimeout ?? clearTimeout,
  };
  new Function(
    "module",
    "exports",
    "require",
    "setTimeout",
    "clearTimeout",
    code,
  )(env.module, env.exports, env.require, env.setTimeout, env.clearTimeout);
  return module.exports;
}

function createFakeTimers() {
  const scheduled = [];
  let nextId = 1;
  const setTimeout = (fn, ms = 0) => {
    const id = nextId++;
    scheduled.push({ id, fn, ms: Math.max(0, ms) });
    return id;
  };
  const clearTimeout = (id) => {
    const idx = scheduled.findIndex((entry) => entry.id === id);
    if (idx >= 0) scheduled.splice(idx, 1);
  };
  const runAll = () => {
    const queue = [...scheduled].sort((a, b) => a.ms - b.ms || a.id - b.id);
    scheduled.length = 0;
    for (const entry of queue) entry.fn();
  };
  return { setTimeout, clearTimeout, scheduled, runAll };
}

const {
  xFromMidi,
  xFromFrequency,
  yFromTimbreKey,
  timbreGravity,
  scaleLattice,
  lightLesson,
  timbreLesson,
  instrumentLesson,
  playLesson,
} = loadTsModule("src/lib/instrument-lesson.ts");

const PENTA_PCS = new Set([9, 0, 2, 4, 7]); // A C D E G

// — log pitch map: higher pitch → larger x (toward violet) —
{
  const midis = [45, 57, 60, 64, 69, 72, 81];
  for (let i = 1; i < midis.length; i++) {
    assert.ok(
      xFromMidi(midis[i]) > xFromMidi(midis[i - 1]),
      `midi ${midis[i]} should sit right of ${midis[i - 1]} on the plate`,
    );
  }
  const freqs = [110, 220, 440, 880, 1760];
  for (let i = 1; i < freqs.length; i++) {
    assert.ok(
      xFromFrequency(freqs[i]) > xFromFrequency(freqs[i - 1]),
      `${freqs[i]} Hz should map to larger x than ${freqs[i - 1]} Hz`,
    );
  }
}

// — timbre chain detents: harp at 0, trumpet at 1, piano between —
{
  assert.equal(yFromTimbreKey("harp"), 0, "harp should anchor the soft end");
  assert.equal(yFromTimbreKey("trumpet"), 1, "trumpet should anchor the bright end");
  const piano = yFromTimbreKey("piano");
  assert.ok(piano > 0 && piano < 1, "piano should sit strictly between harp and trumpet");
}

// — band gravity: pull near a detent, leave out-of-band y alone —
{
  const pulled = timbreGravity(0.02);
  assert.ok(pulled < 0.02, "a y grazing harp should soften toward 0");
  assert.ok(pulled > 0, "gravity should not overshoot the detent");

  const far = 1.4;
  assert.equal(timbreGravity(far), far, "y far from any detent band should stay put");
}

// — scale lattice: penta is A/C/D/E/G only; pure empty; chroma denser —
{
  const pure = scaleLattice("pure");
  const penta = scaleLattice("penta");
  const chroma = scaleLattice("chroma");

  assert.equal(pure.length, 0, "pure mode should show no frets");
  assert.ok(penta.length > 0, "penta should expose mid-register frets");
  assert.ok(chroma.length > penta.length, "chroma should densify beyond penta");

  for (const fret of penta) {
    const pc = ((fret.midi % 12) + 12) % 12;
    assert.ok(PENTA_PCS.has(pc), `penta fret ${fret.note} (${fret.midi}) is not in A/C/D/E/G`);
  }
  for (const fret of chroma) {
    const pc = ((fret.midi % 12) + 12) % 12;
    if (!PENTA_PCS.has(pc)) {
      assert.ok(
        !penta.some((p) => p.midi === fret.midi),
        `non-penta pitch ${fret.note} should not appear in penta lattice`,
      );
    }
  }
}

// — light lesson: stacked chord ons with close timestamps and matching offs —
{
  const events = lightLesson();
  const sorted = [...events].sort((a, b) => a.t - b.t);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i].t >= sorted[i - 1].t, "sorted lesson events must be time-ordered");
  }

  const firstChordOns = events.filter((e) => e.kind === "on" && e.id.startsWith("l0"));
  const firstChordOffs = events.filter((e) => e.kind === "off" && ["l0", "l1", "l2"].includes(e.id));
  assert.equal(firstChordOns.length, 1, "l0 should have one on event");
  assert.equal(firstChordOffs.length, 3, "the opening triad should release all three voices");

  const chordIds = new Set(["l0", "l1", "l2"]);
  const ons = events.filter((e) => e.kind === "on" && chordIds.has(e.id));
  const offs = events.filter((e) => e.kind === "off" && chordIds.has(e.id));
  assert.equal(ons.length, 3, "opening chord needs three simultaneous ons");
  assert.equal(offs.length, 3, "opening chord needs three matching offs");
  const onSpread = Math.max(...ons.map((e) => e.t)) - Math.min(...ons.map((e) => e.t));
  assert.ok(onSpread < 0.1, "chord ons should land in a tight stack, not a slow arpeggio");
  for (const id of chordIds) {
    const on = ons.find((e) => e.id === id);
    const off = offs.find((e) => e.id === id);
    assert.ok(on && off, `${id} should have paired on/off`);
    assert.ok(off.t > on.t, `${id} off should follow its on`);
  }
}

// — timbre lesson: morph walk through the chain, then a stacked multi-y chord —
{
  const events = timbreLesson();
  const morphs = events.filter((e) => e.kind === "morph");
  assert.ok(morphs.length >= 4, "timbre lesson should morph through several instruments");

  const ys = morphs.map((e) => e.y);
  for (let i = 1; i < ys.length; i++) {
    assert.ok(ys[i] >= ys[i - 1], "morph walk should climb the timbre chain");
  }

  const stackOns = events.filter((e) => e.kind === "on" && ["t1", "t2", "t3", "t4"].includes(e.id));
  assert.equal(stackOns.length, 4, "orchestra chord should stack four voices");
  const stackYs = new Set(stackOns.map((e) => e.y));
  assert.ok(stackYs.size >= 3, "stacked chord should spread voices across different y bands");
}

// — instrument lesson teaches window zoom, lens twist, and pinch grips —
{
  const events = instrumentLesson();
  assert.ok(events.some((e) => e.kind === "window"), "instrument lesson should move the pitch window");
  assert.ok(events.some((e) => e.kind === "lens"), "instrument lesson should turn the scale lens");
  assert.ok(events.some((e) => e.kind === "grip"), "instrument lesson should show pinch grips");
  assert.ok(events.some((e) => e.kind === "ungrip"), "instrument lesson should release the grip");

  const windows = events.filter((e) => e.kind === "window");
  const lenses = events.filter((e) => e.kind === "lens");
  assert.ok(windows.length >= 2, "lesson should zoom the window more than once");
  assert.ok(lenses.some((e) => e.mode === "chroma"), "twist should land on chroma");
  assert.ok(lenses.some((e) => e.mode === "pure"), "twist should pass through pure");
}

// — playLesson: handlers fire in time order; done fires; cancel stops the rest —
{
  const timers = createFakeTimers();
  const mod = loadTsModule("src/lib/instrument-lesson.ts", {}, timers);
  const events = [
    { t: 0, kind: "label", text: "a" },
    { t: 0.05, kind: "on", id: "p0", midi: 60, y: 0.5 },
    { t: 0.1, kind: "off", id: "p0" },
    { t: 0.2, kind: "label", text: "b" },
  ];

  const order = [];
  mod.playLesson(events, {
    label: (text) => order.push({ kind: "label", text }),
    on: (e) => order.push({ kind: "on", id: e.id, note: e.note }),
    off: (e) => order.push({ kind: "off", id: e.id }),
    done: () => order.push({ kind: "done" }),
  });
  timers.runAll();

  assert.deepEqual(
    order.map((e) => e.kind),
    ["label", "on", "off", "label", "done"],
    "handlers should run in chronological order and finish with done",
  );
  assert.equal(order[1].note, "C4", "on handler should receive derived note name");
}

{
  const timers = createFakeTimers();
  const mod = loadTsModule("src/lib/instrument-lesson.ts", {}, timers);
  const events = [
    { t: 0, kind: "label", text: "first" },
    { t: 0.5, kind: "label", text: "second" },
  ];

  const labels = [];
  let done = false;
  const cancel = mod.playLesson(events, {
    label: (text) => labels.push(text),
    done: () => {
      done = true;
    },
  });
  cancel();
  timers.runAll();

  assert.deepEqual(labels, [], "cancel should prevent any handler from firing");
  assert.equal(done, false, "cancel should prevent done from firing");
}

console.log("instrument lesson ok");
