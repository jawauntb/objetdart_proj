import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const rootUrl = new URL("../", import.meta.url);

function loadTsModule(path) {
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
  // Same realm as the test: vm.runInNewContext builds arrays, objects and
  // strings on a foreign prototype chain, so deepStrictEqual rejects them
  // against host literals of identical content.
  new Function("module", "exports", code)(module, module.exports);
  return module.exports;
}

const {
  tideLine,
  sandWetness,
  duneLine,
  zoneAt,
  zoneDepth,
  zoneVoice,
  surfBreath,
  seasonProfile,
  spawnFoam,
  stepFoam,
  capFoam,
  ZONE_ORDER,
  SEA_BAND,
  WET_BAND,
  DRY_MIN,
} = loadTsModule("src/lib/coast.ts");

const {
  coastShellsToNaturals,
  addNatural,
  removeNatural,
  getNaturalsInZone,
} = loadTsModule("src/lib/world.ts");

// ——— the tide still moves ———
{
  const samples = Array.from({ length: 80 }, (_, i) => tideLine(i * 0.4, 0.5));
  for (const t of samples) assert.ok(t > 0.4 && t < 0.8);
  assert.ok(Math.max(...samples) - Math.min(...samples) > 0.02, "tide moves");
}

// ——— the section through the shore ———
// The bug this catches: a tap that cannot tell where it landed. If the bands
// are ordered wrongly, overlap, or one collapses to nothing at some tide,
// a whole material becomes unreachable and the room answers it as another.
{
  for (const moon of [0, 0.25, 0.5, 0.75, 1]) {
    for (const tSec of [0, 3.3, 11.7, 29.1, 57.4]) {
      const tide = tideLine(tSec, moon);
      for (const nx of [0.02, 0.31, 0.5, 0.77, 0.99]) {
        const seen = [];
        for (let ny = 0; ny <= 1.0001; ny += 0.002) {
          const z = zoneAt(nx, Math.min(1, ny), tide);
          if (seen[seen.length - 1] !== z) seen.push(z);
        }
        assert.deepStrictEqual(
          seen,
          [...ZONE_ORDER],
          `zones must stack sky→sea→wet→dry→dune exactly once (nx=${nx}, tide=${tide})`,
        );
      }
    }
  }
}

// A high spring tide must not drown the dry beach: the dune line yields.
{
  const highTide = 0.75;
  const line = duneLine(0.5, highTide);
  assert.ok(line >= highTide + DRY_MIN - 1e-9, "the dune gives way to a high tide");
  const dryWidth = line - (highTide + WET_BAND);
  assert.ok(dryWidth > 0.05, `dry beach survives a spring tide (${dryWidth})`);
}

// zoneDepth must run 0→1 across the zone it names, and never leave it.
{
  const tide = 0.6;
  for (const [ny, zone] of [
    [0.2, "sky"], [tide - 0.05, "sea"], [tide + 0.03, "wet"], [tide + 0.12, "dry"], [0.95, "dune"],
  ]) {
    assert.equal(zoneAt(0.5, ny, tide), zone);
    const d = zoneDepth(0.5, ny, tide);
    assert.ok(d >= 0 && d <= 1, `${zone} depth in range`);
  }
  const top = zoneDepth(0.5, tide + 0.0005, tide);
  const bottom = zoneDepth(0.5, tide + WET_BAND - 0.0005, tide);
  assert.ok(bottom > top, "wet-sand depth grows away from the waterline");
}

// ——— the sheen follows the swash, not the clock ———
// The bug this catches: a wetness that ignores `swash` — the sheen would sit
// still while the sets visibly ran up and down the beach.
{
  const tide = 0.6;
  assert.equal(sandWetness(tide - 0.02, tide), 0, "there is no wet sand above the waterline");
  assert.equal(sandWetness(tide + 0.005, tide), 1, "sand at the waterline is soaked");
  assert.equal(sandWetness(0.98, tide), 0, "the top of the beach is dry");
  let prev = Infinity;
  for (let ny = tide + 0.001; ny < tide + 0.2; ny += 0.004) {
    const w = sandWetness(ny, tide);
    assert.ok(w <= prev + 1e-9, "wetness falls as the beach climbs");
    prev = w;
  }
  const dryish = tide + 0.06;
  assert.ok(
    sandWetness(dryish, tide, 1) > sandWetness(dryish, tide, 0) + 1e-6,
    "a bigger swash wets sand further up the beach",
  );
}

// ——— five voices, not one pitch-shifted voice ———
// The bug this catches (and the one that was actually shipped): every zone
// answering with the same sound at a different pitch. Registers must not
// overlap across any position or intensity, and no two zones may share a
// timbre.
{
  const ranges = new Map();
  for (const zone of ZONE_ORDER) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let d = 0; d <= 1.0001; d += 0.1) {
      for (let i = 0; i <= 1.0001; i += 0.1) {
        const v = zoneVoice(zone, d, i);
        lo = Math.min(lo, v.midi);
        hi = Math.max(hi, v.midi);
      }
    }
    ranges.set(zone, [lo, hi]);
  }
  const zones = [...ZONE_ORDER];
  for (let a = 0; a < zones.length; a++) {
    for (let b = a + 1; b < zones.length; b++) {
      const [alo, ahi] = ranges.get(zones[a]);
      const [blo, bhi] = ranges.get(zones[b]);
      assert.ok(
        ahi < blo || bhi < alo,
        `${zones[a]} and ${zones[b]} must never share a register (${alo}..${ahi} vs ${blo}..${bhi})`,
      );
    }
  }
  const timbres = new Set();
  for (const zone of ZONE_ORDER) {
    const v = zoneVoice(zone, 0.5, 0.5);
    const key = `${v.wave}:${Math.round(v.noiseHz)}:${Math.round(v.noiseGain * 1e4)}`;
    assert.ok(!timbres.has(key), `${zone} must not reuse another zone's timbre`);
    timbres.add(key);
  }
  // intensity is a continuous axis, never a switch
  const soft = zoneVoice("sea", 0.5, 0.1);
  const hard = zoneVoice("sea", 0.5, 0.9);
  assert.ok(hard.toneGain > soft.toneGain * 1.5, "a harder tap lands harder");
  assert.ok(hard.dur > soft.dur, "a harder tap rings longer");
}

// ——— the surf breathes in sets ———
// The bug this catches: replacing the beat of two swell trains with one sine,
// which would make the idle room metronomic — audibly a loop, not a sea.
{
  let lo = 1;
  let hi = 0;
  let differsAtPeriod = false;
  for (let t = 0; t < 400; t += 0.13) {
    const v = surfBreath(t, 9);
    assert.ok(v >= 0 && v <= 1, "surf breath stays in 0..1");
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
    if (Math.abs(v - surfBreath(t + 9, 9)) > 0.1) differsAtPeriod = true;
  }
  assert.ok(hi - lo > 0.6, "the surf actually swells and drains");
  assert.ok(differsAtPeriod, "waves arrive in sets, not on a metronome");
}

// ——— the shore's year ———
// The bug this catches: a season that is a counter rather than an angle (it
// would run off the end), or a storm beach that keeps its berm — the sand
// goes offshore *because* the swell took it, so the two must be antiphase.
{
  for (const s of [0.13, 0.4, 0.77]) {
    const a = seasonProfile(s);
    const b = seasonProfile(s + 1);
    const c = seasonProfile(s - 3);
    for (const k of ["berm", "swell", "grass", "warmth", "foam"]) {
      assert.ok(Math.abs(a[k] - b[k]) < 1e-9, `season wraps (${k})`);
      assert.ok(Math.abs(a[k] - c[k]) < 1e-9, `season wraps backwards (${k})`);
    }
  }
  const summer = seasonProfile(0);
  const winter = seasonProfile(0.5);
  assert.ok(summer.berm > winter.berm + 1.5, "summer piles the berm, winter takes it");
  assert.ok(winter.swell > summer.swell + 0.3, "the storm season carries the swell");
  let dot = 0;
  for (let s = 0; s < 1; s += 0.02) {
    const p = seasonProfile(s);
    dot += p.berm * (p.swell - 0.5);
  }
  assert.ok(dot < 0, "berm and swell are antiphase — sand leaves when the sea is big");
}

// ——— foam is ballistic, and the pool never allocates ———
// The bug this catches: specks that only fade in place (the old behaviour),
// so a splash never looked thrown; and a step that returns a fresh array
// every frame, which the RAF contract forbids.
{
  const arc = spawnFoam(9, 0.5, 0.5, 1, { spread: 0, rise: 0.2, drift: 0, decay: 0.05 });
  const ys = [];
  for (let i = 0; i < 60; i++) {
    stepFoam(arc, 1 / 30, 0, 0.6);
    if (arc.length) ys.push(arc[0].y);
  }
  const lowest = Math.min(...ys);
  assert.ok(lowest < 0.5 - 1e-4, "a thrown speck actually rises");
  assert.ok(ys[ys.length - 1] > lowest + 1e-4, "and gravity brings it back down");

  const still = spawnFoam(4, 0.5, 0.5, 6, { rise: 0, drift: 0, decay: 0.05 });
  const blown = spawnFoam(4, 0.5, 0.5, 6, { rise: 0, drift: 0, decay: 0.05 });
  for (let i = 0; i < 20; i++) {
    stepFoam(still, 1 / 30, 0, 0);
    stepFoam(blown, 1 / 30, 1, 0);
  }
  assert.ok(blown[0].x > still[0].x + 1e-4, "the wind carries the foam downwind");

  const pool = spawnFoam(12, 0.5, 0.6, 8);
  assert.equal(pool.length, 8);
  const returned = stepFoam(pool, 2, 0);
  assert.equal(returned, pool, "stepFoam works in place — no allocation per frame");
  assert.ok(pool.length < 8, "foam dissolves with time");

  const many = spawnFoam(1, 0.5, 0.5, 40);
  const lives = many.map((s) => s.life).sort((a, b) => b - a);
  capFoam(many, 10);
  assert.equal(many.length, 10);
  assert.ok(
    Math.min(...many.map((s) => s.life)) >= lives[9] - 1e-9,
    "the cap keeps the freshest specks, not an arbitrary slice",
  );
}

// ——— the beach joins the shared world ———
// The bug this catches: dropping what a visitor already left on the sand
// when /coast moved off its private `objetdart:coast:v1` store, and id
// collisions that would make one delete take two shells.
{
  assert.deepStrictEqual(coastShellsToNaturals(null), []);
  assert.deepStrictEqual(coastShellsToNaturals({}), []);
  assert.deepStrictEqual(coastShellsToNaturals({ shells: "no" }), []);
  assert.deepStrictEqual(coastShellsToNaturals({ shells: [{ nx: "a", ny: 1 }] }), []);

  const folded = coastShellsToNaturals({ shells: [{ nx: 1.4, ny: -0.2, seed: 7 }] }, 1000);
  assert.equal(folded.length, 1);
  assert.equal(folded[0].kind, "seashell");
  assert.equal(folded[0].zone, "coast", "a coast shell must land on the coast, not adrift");
  assert.equal(folded[0].nx, 1);
  assert.equal(folded[0].ny, 0);

  const twins = coastShellsToNaturals({
    shells: [{ nx: 0.1, ny: 0.9, seed: 3 }, { nx: 0.2, ny: 0.8, seed: 3 }],
  });
  assert.equal(twins.length, 2);
  assert.notEqual(twins[0].id, twins[1].id, "two shells at one seed are still two shells");
  assert.ok(twins[0].createdAt < twins[1].createdAt, "order survives the fold");
}

// ——— per-object delete ———
{
  const a = addNatural("seashell", "coast", 0.2, 0.8);
  const b = addNatural("seashell", "coast", 0.6, 0.85);
  assert.ok(a && b);
  assert.equal(addNatural("lily", "coast", 0.5, 0.5), null, "a lily pad is not a beach thing");
  const before = getNaturalsInZone("coast").length;
  assert.ok(before >= 2);
  assert.equal(removeNatural("no-such-id"), false, "removing nothing reports nothing");
  assert.equal(getNaturalsInZone("coast").length, before, "and takes nothing with it");
  assert.equal(removeNatural(a.id), true);
  const left = getNaturalsInZone("coast");
  assert.equal(left.length, before - 1, "the sea takes exactly one");
  assert.ok(left.some((n) => n.id === b.id), "and leaves the other standing");
}

console.log("coast ok");
