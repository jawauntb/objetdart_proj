import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const rootUrl = new URL("../", import.meta.url);

// Run in the current realm rather than a vm context (the test-routes.mjs
// precedent): deepStrictEqual rejects arrays whose Array.prototype comes
// from another realm, and this suite deep-compares across two modules.
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
  const requireShim = (id) => {
    throw new Error(`Unexpected require(${id}) while loading ${path}`);
  };
  new Function("module", "exports", "require", code)(module, module.exports, requireShim);
  return module.exports;
}

// The derivation is import-free: the graph arrives as arguments. The live
// cosmology is loaded separately and passed in, so this suite pins BOTH
// that the law is right and that the law is a pure function of the graph.
const { deriveTree, layoutTree } = loadTsModule("src/lib/overlook-tree.ts");
const { SCALE_BANDS, travelNeighbor } = loadTsModule("src/lib/scale.ts");

const liveNeighbor = (id, dir) => travelNeighbor(id, dir);
const tree = deriveTree(SCALE_BANDS, liveNeighbor);
const byId = new Map(tree.nodes.map((n) => [n.id, n]));

// — the trunk is a single chain from quarks to the manifold, no repeats —
assert.equal(tree.trunk[0], "quarks", "the trunk rises from the quarks");
assert.equal(tree.trunk[tree.trunk.length - 1], "manifold", "the trunk ends at the fold");
assert.equal(new Set(tree.trunk).size, tree.trunk.length, "the trunk never revisits a band");
for (let i = 1; i < tree.trunk.length; i++) {
  assert.equal(
    liveNeighbor(tree.trunk[i - 1], 1),
    tree.trunk[i],
    `each trunk step is the canonical upward door (${tree.trunk[i - 1]} → ${tree.trunk[i]})`,
  );
}

// — every band appears exactly once in the tree —
assert.deepEqual(
  tree.nodes.map((n) => n.id).sort(),
  SCALE_BANDS.map((b) => b.id).sort(),
  "the tree holds every band exactly once",
);
assert.equal(
  new Set(tree.nodes.map((n) => n.id)).size,
  tree.nodes.length,
  "no band appears twice",
);

// — axis order is total and follows the metric floor —
for (let i = 1; i < tree.nodes.length; i++) {
  assert.ok(
    tree.nodes[i - 1].sMin <= tree.nodes[i].sMin,
    "nodes stay in axis order, small to large",
  );
  assert.equal(tree.nodes[i].order, i, "order indexes the axis walk");
}

// — branches attach exactly where fork doors exist and nowhere else —
// A branch hangs where its own outward door opens; that reverse pointer is
// precisely what makes it a fork door of the parent in travelOptions.
for (const n of tree.nodes) {
  if (n.onTrunk) {
    assert.equal(n.parent, null, `${n.id} is trunk: no attachment`);
    assert.equal(n.depth, 0, `${n.id} is trunk: depth 0`);
  } else {
    const up = liveNeighbor(n.id, 1);
    const expected = up !== null && up !== n.id ? up : liveNeighbor(n.id, -1);
    assert.equal(n.parent, expected, `${n.id} attaches where its outward door opens`);
    assert.ok(n.depth >= 1, `${n.id} hangs off the trunk`);
    const parent = byId.get(n.parent);
    assert.ok(parent, `${n.id} attaches to a real band`);
    assert.equal(n.depth, parent.depth + 1, `${n.id} is one step past its parent`);
  }
}
// Every edge is a real door of the graph — nothing invented.
for (const e of tree.edges) {
  const isDoor =
    liveNeighbor(e.a, 1) === e.b ||
    liveNeighbor(e.a, -1) === e.b ||
    liveNeighbor(e.b, 1) === e.a ||
    liveNeighbor(e.b, -1) === e.a;
  assert.ok(isDoor, `edge ${e.a}–${e.b} exists in the travel graph`);
}
// ...and no door of the graph is missing from the tree.
const edgeKeys = new Set(tree.edges.map((e) => (e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`)));
for (const b of SCALE_BANDS) {
  for (const dir of [1, -1]) {
    const n = liveNeighbor(b.id, dir);
    if (n === null || n === b.id) continue;
    const key = b.id < n ? `${b.id}|${n}` : `${n}|${b.id}`;
    assert.ok(edgeKeys.has(key), `door ${b.id}→${n} appears among the tree's threads`);
  }
}
// Trunk edges are exactly the chain's consecutive steps.
assert.equal(
  tree.edges.filter((e) => e.trunk).length,
  tree.trunk.length - 1,
  "trunk edges are the chain steps and nothing else",
);

// — the live cosmology's known forks hold (a moved door would move these) —
assert.equal(byId.get("flowers").onTrunk, false, "flowers grow off the trunk");
assert.equal(byId.get("flowers").parent, "earth", "flowers hang off the earth");
assert.equal(byId.get("earth").parent, "atlas", "the ground lies on the atlas");
assert.equal(byId.get("beyond").parent, "manifold", "beyond branches off the fold");

// — the derivation is a pure function of the graph: move a door, the tree moves —
const stubBands = [
  { id: "a", label: "a", route: "/a", sMin: 0, sMax: 1 },
  { id: "b", label: "b", route: "/b", sMin: 1, sMax: 2 },
  { id: "c", label: "c", route: null, sMin: 2, sMax: 3 },
  { id: "d", label: "d", route: "/d", sMin: 3, sMax: 4 },
];
const metric = (bands) => (id, dir) => {
  const i = bands.findIndex((x) => x.id === id);
  return bands[i + dir] ? bands[i + dir].id : null;
};
// Override b's upward door past c: c falls off the trunk and hangs at d.
const skipC = (id, dir) => {
  if (id === "b" && dir === 1) return "d";
  if (id === "d" && dir === -1) return "b";
  return metric(stubBands)(id, dir);
};
const skipped = deriveTree(stubBands, skipC);
assert.deepEqual(skipped.trunk, ["a", "b", "d"], "the trunk follows the moved door");
const cNode = skipped.nodes.find((n) => n.id === "c");
assert.equal(cNode.onTrunk, false, "the bypassed band becomes a branch");
assert.equal(cNode.parent, "d", "the branch hangs where its outward door opens");
// Move c's own outward door instead: the same band re-attaches elsewhere.
const cToB = (id, dir) => {
  if (id === "c" && dir === 1) return "b";
  return skipC(id, dir);
};
const moved = deriveTree(stubBands, cToB);
assert.equal(
  moved.nodes.find((n) => n.id === "c").parent,
  "b",
  "changing one override in the graph moves the attachment",
);
assert.deepEqual(moved.trunk, ["a", "b", "d"], "the trunk is untouched by a branch's door");

// The identity metric graph has no branches at all.
const plain = deriveTree(stubBands, metric(stubBands));
assert.deepEqual(plain.trunk, ["a", "b", "c", "d"], "a pure metric graph is all trunk");
assert.ok(plain.nodes.every((n) => n.onTrunk), "no forks, no branches");

// — layout: honest to the axis, deterministic, branches lean off-trunk —
const place = layoutTree(tree);
for (const n of tree.nodes) {
  if (n.onTrunk) assert.equal(place[n.id].x, 0, `${n.id} stands on the trunk line`);
  else assert.ok(Math.abs(place[n.id].x) === n.depth, `${n.id} leans out by its depth`);
}
const axisSorted = [...tree.nodes].sort((p, q) => p.s - q.s);
for (let i = 1; i < axisSorted.length; i++) {
  assert.ok(
    place[axisSorted[i - 1].id].y <= place[axisSorted[i].id].y,
    "height is monotone in the band's true log10 center",
  );
}
assert.ok(
  Math.sign(place.flowers.x) === Math.sign(place.earth.x),
  "a branch keeps its subtree root's side",
);
assert.deepEqual(layoutTree(tree), place, "the layout is deterministic");

console.log("overlook: the tree derives from the graph — trunk, forks, and layout hold");
