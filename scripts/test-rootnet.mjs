// object-compiler template — docs/plans/object-compiler.md M3.
// Consumes: spec.domain_lib.name, spec.route.
// Filled by phase-6 track A — the pins for /root's chain-invariant physics.

// The /root laws. Every assertion names the bug it catches — a
// test that only restates a constant back at itself is not a test.

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
  new Function("module", "exports", "require", code)(module, module.exports, (id) => {
    throw new Error(`Unexpected require(${id}) while loading ${path}`);
  });
  return module.exports;
}

const M = loadTsModule("src/lib/rootnet.ts");

const abs = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg} (|${a} - ${b}| = ${Math.abs(a - b)} > ${tol})`);

// —— DEPTH → PITCH IS A TRUE ROUND-TRIP ————————————————————————————
// The room's central legibility claim: from the ring alone you recover the
// tip's depth. The bug this catches: a pitch that only reacts to depth
// instead of encoding it — no inverse.
{
  for (const y of [M.CROWN_Y, 0.2, 0.35, 0.5, 0.7, 0.85, 0.96]) {
    const hz = M.ringHzFor(y);
    assert.ok(hz > 0, "the pitch is always a real frequency");
    if (y >= M.CROWN_Y && y <= M.POOL_Y_MAX) {
      abs(M.depthForRingHz(hz), y, 1e-9, `y → hz → y at y = ${y}`);
    }
  }
  for (const hz of [110, 220, 330, 440, 660]) {
    const yBack = M.depthForRingHz(hz);
    if (yBack >= M.CROWN_Y && yBack <= M.POOL_Y_MAX) {
      abs(M.ringHzFor(yBack), hz, 1e-9, `hz → y → hz at hz = ${hz}`);
    }
  }
  let lastHz = Infinity;
  for (let i = 0; i <= 20; i++) {
    const y = M.CROWN_Y + (i / 20) * (M.POOL_Y_MAX - M.CROWN_Y);
    const hz = M.ringHzFor(y);
    assert.ok(hz < lastHz + 1e-9, `ringHzFor monotone decreasing at y = ${y.toFixed(2)}`);
    lastHz = hz;
  }
  abs(M.ringHzFor(M.CROWN_Y), M.PITCH_BASE_HZ, 1e-12, "y = CROWN_Y rings at base pitch");
  abs(
    M.PITCH_BASE_HZ / M.ringHzFor(M.CROWN_Y + M.PITCH_SCALE_Y),
    2,
    1e-12,
    "one scale of depth is one octave down",
  );
}

// —— GROWTH SATURATES AT MAX_GROWTH, NEVER OVERSHOOTS ———————————————
// The strongest claim about growth: no matter how long you wait, an
// unsealed tip cannot exceed MAX_GROWTH.
{
  const s0 = M.initState(0x1234);
  const climate = { warmth: 1, wet: 1 };
  const s1 = M.advanceExact(s0, M.MAX_ELAPSED_S, climate);
  for (const n of s1.nodes) {
    assert.ok(n.growth <= M.MAX_GROWTH + 1e-9, `node ${n.id} did not overshoot growth ceiling`);
    assert.ok(n.growth >= 0, `node ${n.id} growth stayed non-negative`);
    assert.ok(n.water <= 1 + 1e-9, `node ${n.id} water stayed bounded`);
    assert.ok(n.sugar <= 1 + 1e-9, `node ${n.id} sugar stayed bounded`);
  }
  assert.ok(
    M.totalRootLength(s1) >= M.totalRootLength(s0) - 1e-9,
    "root length is monotone non-decreasing under advanceExact",
  );
}

// —— SEALED TIPS FREEZE AT MAX_GROWTH, REFUSE DEEPEN ———————————————
// The ceremony's promise: a sealed tip stays sealed.
{
  let s = M.initState(0xabc);
  const sealedNode = s.nodes.find((n) => n.sealed && n.parentId !== null);
  assert.ok(sealedNode, "initState creates at least one sealed starter branch");
  const g0 = sealedNode.growth;
  s = M.deepenTip(s, sealedNode.id, -0.5);
  const after = s.nodes.find((n) => n.id === sealedNode.id);
  abs(after.growth, g0, 1e-9, "sealed tip refused deepen(-0.5) — growth unchanged");
  s = M.advanceExact(s, M.MAX_ELAPSED_S, { warmth: 0, wet: 0 });
  const after2 = s.nodes.find((n) => n.id === sealedNode.id);
  abs(after2.growth, M.MAX_GROWTH, 1e-9, "sealed tip held at MAX_GROWTH through the drought");
}

// —— MAX_ELAPSED_S CAPS THE CENTURY BUG ———————————————————————————
{
  const s0 = M.initState(0xdead);
  const s1 = M.advanceExact(s0, 100 * 365 * 24 * 3600, { warmth: 0.5, wet: 0.5 });
  for (const n of s1.nodes) {
    assert.ok(Number.isFinite(n.growth), `node ${n.id} growth is finite`);
    assert.ok(Number.isFinite(n.water), `node ${n.id} water is finite`);
    assert.ok(Number.isFinite(n.sugar), `node ${n.id} sugar is finite`);
  }
  abs(s1.tau - s0.tau, M.MAX_ELAPSED_S, 1, "advance capped at MAX_ELAPSED_S");
}

// —— spawnTip REFUSES OUTSIDE BOUNDS, HITS THE CAP, IS DETERMINISTIC ——
{
  const s0 = M.initState(0x11);
  const beforeN = s0.nodes.length;
  const s1 = M.spawnTip(s0, 0.5, 0.02, null);
  assert.equal(s1.nodes.length, beforeN, "spawnTip above the crown line was refused");
  const s2 = M.spawnTip(s0, 0.5, 0.99, null);
  assert.equal(s2.nodes.length, beforeN, "spawnTip below bedrock was refused");
  let s = s0;
  for (let i = 0; i < M.MAX_NODES + 5; i++) {
    s = M.spawnTip(s, 0.3 + i * 0.01, 0.2 + i * 0.01, 1);
  }
  assert.ok(s.nodes.length <= M.MAX_NODES, "population capped at MAX_NODES");
  const a = M.initState(0x1111);
  const b = M.initState(0x1111);
  assert.equal(a.nodes.length, b.nodes.length, "same seed → same node count");
  for (let i = 0; i < a.nodes.length; i++) {
    abs(a.nodes[i].phase, b.nodes[i].phase, 1e-12, `node ${i} phase deterministic from seed`);
  }
}

// —— knockSweep DISLODGES UNSEALED YOUNG TIPS, SPARES SEALED ONES ——————
{
  let s = M.initState(0x55);
  s = {
    ...s,
    nodes: s.nodes.map((n) => {
      if (n.parentId === null) return n;
      if (n.sealed) return { ...n, water: 1 };
      return { ...n, water: 0.05 };
    }),
  };
  const beforeCrown = s.nodes.filter((n) => n.parentId === null).length;
  const beforeSealed = s.nodes.filter((n) => n.sealed).length;
  const { state: s1, dislodged } = M.knockSweep(s, 1);
  assert.ok(dislodged > 0, "hard knock dislodged at least one unsealed low-water tip");
  const afterCrown = s1.nodes.filter((n) => n.parentId === null).length;
  const afterSealed = s1.nodes.filter((n) => n.sealed).length;
  assert.equal(afterCrown, beforeCrown, "crown always survives a knock");
  assert.equal(afterSealed, beforeSealed, "sealed nodes always survive a knock");
  const gentle = M.knockSweep(s, 0);
  assert.ok(
    gentle.dislodged <= dislodged,
    `gentle knock swept fewer (${gentle.dislodged}) than hard (${dislodged})`,
  );
}

// —— SOIL WATER + SUNLIGHT AXES ARE INDEPENDENT ————————————————————
// Test with a fresh low-reserve state so climate axes are the only signal.
{
  const seed = 0x7777;
  const fresh = M.initState(seed);
  const zeroed = {
    ...fresh,
    nodes: fresh.nodes.map((n) =>
      n.sealed
        ? { ...n, water: 0, sugar: 0 }
        : { ...n, growth: 0.01, water: 0, sugar: 0 },
    ),
    soilWater: 0,
    sunlight: 0,
  };
  const short = 900;
  const wetDark = M.advanceExact(
    { ...zeroed, soilWater: 1, sunlight: 0 },
    short,
    { warmth: 0, wet: 1 },
  );
  const brightDry = M.advanceExact(
    { ...zeroed, soilWater: 0, sunlight: 1 },
    short,
    { warmth: 1, wet: 0 },
  );
  const brightWet = M.advanceExact(
    { ...zeroed, soilWater: 1, sunlight: 1 },
    short,
    { warmth: 1, wet: 1 },
  );
  assert.ok(
    M.meanWater(wetDark) > M.meanWater(brightDry) + 1e-4,
    `wetDark meanWater ${M.meanWater(wetDark).toFixed(4)} > brightDry ${M.meanWater(brightDry).toFixed(4)} — soilWater axis moves water into the network`,
  );
  const crownSugarOf = (st) => {
    const c = st.nodes.find((n) => n.parentId === null);
    return c ? c.sugar : 0;
  };
  assert.ok(
    crownSugarOf(brightWet) > crownSugarOf(wetDark) + 1e-4,
    `brightWet crown sugar ${crownSugarOf(brightWet).toFixed(4)} > wetDark ${crownSugarOf(wetDark).toFixed(4)} — sunlight axis feeds crown`,
  );
}

// —— soilWaterAt IS MONOTONE-INCREASING IN y ——————————————————————
{
  const soilWater = 1;
  let last = -Infinity;
  for (let i = 0; i <= 10; i++) {
    const y = M.CROWN_Y + (i / 10) * (M.POOL_Y_MAX - M.CROWN_Y);
    const w = M.soilWaterAt(y, soilWater);
    assert.ok(w > last - 1e-9, `soilWaterAt monotone increasing at y = ${y.toFixed(2)}`);
    last = w;
  }
}

// —— NEAREST NODE ————————————————————————————————————————————
{
  const s = M.initState(0x99);
  const target = s.nodes[1];
  const found = M.nearestNode(s, target.x + 0.001, target.y + 0.001, 0.1);
  assert.equal(found?.id, target.id, "nearestNode finds the right node");
  const missed = M.nearestNode(s, 0.99, 0.99, 0.01);
  assert.equal(missed, null, "nearestNode returns null when nothing is close enough");
}

console.log("rootnet: all pins green");
