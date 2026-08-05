import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
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
  BLOOM_PEAK,
  LSYSTEM_SEGMENT_CAP,
  LATENT_DIM,
  speciesFromSeed,
  flowerGeometry,
  phenologyOpenness,
  latentFromSeed,
  expandLSystem,
  hashSeed,
  speciesFromLatent,
  crossLatent,
  shadeFrom,
  rootOverlap,
  vigour,
  canopySpread,
  DRIFT_RATE,
} = loadTsModule("src/lib/botany.ts");

const SEEDS = Array.from({ length: 60 }, (_, i) => hashSeed(i + 1, 7, 13));

// — Determinism: same seed → identical species and identical geometry —
{
  const a = speciesFromSeed(123456789);
  const b = speciesFromSeed(123456789);
  assert.deepEqual(a, b, "species is a pure function of the seed");
  const ga = JSON.stringify(flowerGeometry(a, 0.61));
  const gb = JSON.stringify(flowerGeometry(b, 0.61));
  assert.equal(ga, gb, "geometry is a pure function of (species, phenophase)");
  // and the latent is stable across calls
  assert.deepEqual(latentFromSeed(42), latentFromSeed(42));
  assert.equal(latentFromSeed(42).length, LATENT_DIM);
}

// — Distinctness: different seeds decode measurably different species —
{
  assert.notDeepEqual(
    latentFromSeed(1),
    latentFromSeed(2),
    "neighboring seeds land on different latent points",
  );
  const signatures = new Set(
    SEEDS.map((s) => {
      const sp = speciesFromSeed(s);
      return [sp.petals, sp.layers, sp.habit, sp.florets, sp.palette.petal, sp.lsystem.depth].join("|");
    }),
  );
  assert.ok(
    signatures.size >= 24,
    `60 seeds must spread across the species space (got ${signatures.size} distinct)`,
  );
  // geometry differs too, not just labels
  const g1 = JSON.stringify(flowerGeometry(speciesFromSeed(SEEDS[0]), 0.7));
  const g2 = JSON.stringify(flowerGeometry(speciesFromSeed(SEEDS[1]), 0.7));
  assert.notEqual(g1, g2, "different species render different geometry");
}

// — Phenology: openness grows monotonically from bud to bloom, then closes —
for (const seed of SEEDS.slice(0, 8)) {
  const sp = speciesFromSeed(seed);
  let prev = -1;
  for (let i = 0; i <= 40; i++) {
    const o = phenologyOpenness(sp, (i / 40) * BLOOM_PEAK);
    assert.ok(o >= prev - 1e-12, `openness never dips on the way to bloom (seed ${seed})`);
    prev = o;
  }
  assert.ok(phenologyOpenness(sp, 0.03) < 0.35, "a young bud is mostly closed");
  assert.ok(phenologyOpenness(sp, BLOOM_PEAK) > 0.999, "full bloom reaches 1");
  assert.ok(
    phenologyOpenness(sp, 1) < phenologyOpenness(sp, BLOOM_PEAK) - 0.2,
    "past the peak the flower folds back",
  );
  // the rendered petals follow the envelope
  const splayAt = (p) => {
    const g = flowerGeometry(sp, p);
    return g.petals.reduce((a, q) => a + q.splay, 0) / g.petals.length;
  };
  assert.ok(splayAt(0.65) > splayAt(0.1) + 0.3, "petal splay opens from bud to bloom");
}

// — Palette containment: every color sits inside the site's token families —
// candle golds / parchment (hue 20–50), merlot (hue ≥348 or ≤14), sea teals
// (hue 185–220). Anything green, blue-violet, or magenta is a regression.
function hslOf(hex) {
  const v = parseInt(hex.slice(1), 16);
  const r = ((v >> 16) & 255) / 255;
  const g = ((v >> 8) & 255) / 255;
  const b = (v & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d + 6) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h, s, l };
}
const inFamilies = ({ h, s }) =>
  (h >= 20 && h <= 50) || (h >= 185 && h <= 220) || ((h >= 348 || h <= 14) && s > 0.05);
for (const seed of SEEDS) {
  const sp = speciesFromSeed(seed);
  for (const [role, hex] of Object.entries(sp.palette)) {
    assert.match(hex, /^#[0-9a-fA-F]{6}$/, `palette.${role} is a hex color`);
    const hsl = hslOf(hex);
    assert.ok(
      inFamilies(hsl) && hsl.s <= 0.9,
      `palette.${role}=${hex} (h=${hsl.h.toFixed(1)}) strays outside the token families (seed ${seed})`,
    );
  }
}

// — L-system boundedness: segment count stays under the hard cap at max depth —
{
  let worst = 0;
  for (const seed of SEEDS) {
    const sp = speciesFromSeed(seed);
    const tokens = expandLSystem({ ...sp.lsystem, depth: 4 });
    const fCount = (tokens.match(/F/g) ?? []).length;
    worst = Math.max(worst, fCount);
    assert.ok(
      fCount <= LSYSTEM_SEGMENT_CAP,
      `depth-4 expansion of seed ${seed} emits ${fCount} segments (> cap ${LSYSTEM_SEGMENT_CAP})`,
    );
    const g = flowerGeometry(sp, 1);
    assert.ok(g.segmentCount <= LSYSTEM_SEGMENT_CAP, "turtle honors the cap");
    assert.ok(g.segmentCount >= 3, "a plant is more than a sprout at full growth");
    assert.ok(g.heads.length >= 1 && g.heads[0].scale >= g.heads[g.heads.length - 1].scale,
      "primary crown sorts first");
  }
  assert.ok(worst >= 8, `cap test saw real expansions (worst ${worst})`);
}

// — hashSeed mixes position + count into well-spread seeds —
{
  const a = hashSeed(300, 640, 4);
  const b = hashSeed(300, 640, 5);
  const c = hashSeed(301, 640, 4);
  assert.ok(a !== b && a !== c && b !== c, "nearby plantings get distinct seeds");
}

// —— crossing: a child is inherited, never averaged ————————————————
// The bug this catches: a "cross" that blends the two latents. Every child
// would land in the middle of latent space and a garden would go beige in
// three generations — while each individual flower still looked fine.
{
  const a = latentFromSeed(hashSeed(11, 2, 3));
  const b = latentFromSeed(hashSeed(99, 5, 8));
  const child = crossLatent(a, b, 0x51de, 0);
  assert.equal(child.length, LATENT_DIM, "a child carries a whole genome");
  let fromA = 0;
  let fromB = 0;
  for (let i = 0; i < LATENT_DIM; i++) {
    const isA = child[i] === a[i];
    const isB = child[i] === b[i];
    assert.ok(isA || isB, `locus ${i} came from a parent, not from between them`);
    if (isA) fromA += 1;
    if (isB) fromB += 1;
  }
  assert.ok(fromA > 0 && fromB > 0, "the child really is of both parents");
  assert.notDeepEqual(child, a, "and is neither parent");
  assert.notDeepEqual(child, b);
  assert.deepEqual(crossLatent(a, b, 0x51de, 0), child, "the same pollen makes the same child");
  assert.notDeepEqual(crossLatent(a, b, 0x51df, 0), child, "a different grain makes a different one");
  // a plant crossed with itself, with no drift, is itself — the law that
  // proves inheritance is real inheritance and not noise wearing its name
  assert.deepEqual(crossLatent(a, a, 0xabc, 0), a, "selfing without drift reproduces the parent exactly");
  // ...and with drift, it does not
  const selfed = crossLatent(a, a, 0xabc, 1);
  assert.notDeepEqual(selfed, a, "drift is where new form comes from");
  for (const v of selfed) assert.ok(v >= 0 && v <= 1, "and it never leaves latent space");
  assert.ok(DRIFT_RATE > 0 && DRIFT_RATE < 0.25, "the default drift is a mutation rate, not a shuffle");
  // the crossed latent decodes through the SAME decoder as a seeded one
  const sp = speciesFromLatent(child, 0x1234);
  assert.deepEqual(sp.latent, child, "the child's species is decoded from the child's genome");
  assert.equal(speciesFromLatent(latentFromSeed(SEEDS[3]), SEEDS[3]).petals, speciesFromSeed(SEEDS[3]).petals,
    "and the decoder is the one seeded species already use");
}

// —— shade is one-directional; roots are not ————————————————————————
{
  // a shorter neighbour cannot shade a taller one, at any distance
  for (const d of [0, 0.02, 0.05, 0.1]) {
    assert.equal(shadeFrom(0.9, 0.4, d, 0.2), 0, "a seedling never shades the plant above it");
  }
  assert.ok(shadeFrom(0.4, 0.9, 0.01, 0.2) > 0, "but a tall neighbour standing over it does");
  assert.ok(
    shadeFrom(0.4, 0.9, 0.02, 0.2) > shadeFrom(0.4, 0.9, 0.15, 0.2),
    "and takes less light the further off it stands",
  );
  assert.equal(shadeFrom(0.4, 0.9, 0.2, 0.2), 0, "outside the canopy, nothing");
  assert.equal(shadeFrom(0.4, 0.4, 0, 0.2), 0, "equals do not shade each other");
  assert.ok(canopySpread(speciesFromSeed(SEEDS[0])) > 0, "every plant casts some canopy");

  // root overlap is the real lens area of two discs
  assert.equal(rootOverlap(0.5, 0.1, 0.1), 0, "roots that do not reach each other share nothing");
  assert.equal(rootOverlap(0.2, 0.1, 0.1), 0, "and rims that just touch still share nothing");
  assert.equal(rootOverlap(0, 0.1, 0.1), 1, "roots in the same place share everything");
  assert.ok(rootOverlap(0.05, 0.1, 0.1) > rootOverlap(0.15, 0.1, 0.1), "and closer is more");
  assert.equal(rootOverlap(0.02, 0.3, 0.05), 1, "a small root inside a big one is wholly in its shadow");
  for (let d = 0; d <= 0.25; d += 0.01) {
    const v = rootOverlap(d, 0.1, 0.12);
    assert.ok(v >= 0 && v <= 1, "overlap stays a fraction");
  }
  // vigour: full light and no neighbours is a whole plant; shade and
  // crowding take it away, and neither can drive it negative
  assert.equal(vigour(1, 0), 1, "alone in full light, a plant has all of itself");
  assert.ok(vigour(0.4, 0) < vigour(1, 0), "shade costs it");
  assert.ok(vigour(1, 1) < vigour(1, 0), "so does a crowded root");
  assert.ok(vigour(0, 1) >= 0, "and it never goes negative");
}

console.log("botany latent tests passed");
console.log(
  "botany garden ok: crossing inherits locus by locus (never averages), selfing without drift is the identity, shade is one-directional, and root overlap is the true lens area",
);
