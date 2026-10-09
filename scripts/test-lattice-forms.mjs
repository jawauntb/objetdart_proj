// The lattice animals' forms — the laws that can lie, pinned.
//
// Each assertion names the bug it catches: a stale atlas, a room whose own
// component has no form, a classifier that forgets what /stars is, two
// components collapsing into one form, a body that leaves its lattice, a
// schedule that depends on frame rate, a writer that overruns its buffer.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { loadTsModule } from "./lib/load-ts.mjs";

const L = loadTsModule("src/lib/lattice-forms.ts");
const R = loadTsModule("src/lib/room-registry.ts");
const E = loadTsModule("src/lib/universe-mcp/tools-explore.ts");

// ——— the atlas is the syntax tree's, and current ———
execFileSync(process.execPath, ["scripts/build-form-atlas.mjs", "--check"], { stdio: "inherit" });
const full = JSON.parse(readFileSync(new URL("../public/lattice/forms.json", import.meta.url), "utf8"));
assert.equal(full.count, L.FORMS.length, "the public atlas and the client atlas must list the same forms");

// ——— every component that draws is a form; every room wears its own ———
{
  const ids = new Set(L.FORMS.map((f) => f.id));
  assert.equal(ids.size, L.FORMS.length, "form ids must be unique");
  const files = new Set(full.forms.map((f) => f.file));
  for (const e of R.ROOM_REGISTRY) {
    if (!e.source || !e.source.endsWith(".tsx") || e.source.endsWith("/page.tsx")) continue;
    assert.ok(files.has(e.source), `${e.source} (room ${e.key}) draws the room but is missing from the atlas`);
    const f = L.formForRoom(e.key);
    assert.ok(f, `room ${e.key} has no form of its own`);
    assert.ok(f.rooms.includes(e.key), `formForRoom(${e.key}) returned a form that is not its room's`);
  }
  for (const f of L.FORMS) {
    assert.ok(f.kind in L.KIND_INDEX, `${f.id} has kind ${f.kind}, which the shader cannot draw`);
    assert.equal(f.palette.length, 3);
    for (const c of f.palette) assert.match(c, /^#[0-9a-f]{6}$/, `${f.id} palette ${c}`);
  }
  for (const s of full.skipped) assert.match(s.reason, /no element of its own/);
  assert.ok(full.skipped.every((s) => !R.ROOM_REGISTRY.some((e) => e.source === s.file)), "a room's own component was skipped as non-visual");
}

// ——— the masterpieces read as themselves ———
for (const [room, kind] of [["stars", "star"], ["galaxy", "spiral"], ["cells", "cell"], ["quanta", "quantum"], ["fire", "flame"], ["flowers", "petal"], ["solar", "orbit"], ["ocean", "drop"], ["atoms", "crystal"]]) {
  assert.equal(L.formForRoom(room).kind, kind, `/${room} must wear the ${kind} form; the classifier drifted`);
}

// ——— every component's form is its own ———
{
  const sig = (f) => JSON.stringify([f.kind, f.palette, f.params]);
  const seen = new Map();
  for (const f of L.FORMS) {
    const s = sig(f);
    assert.ok(!seen.has(s), `${f.id} and ${seen.get(s)} collapsed into one identical form`);
    seen.set(s, f.id);
  }
  assert.ok(new Set(L.FORMS.map((f) => f.kind)).size >= 10, "the atlas must use most of the shader's kinds, not one");
}

// ——— the body stays a lattice animal ———
{
  assert.equal(L.isLatticeAnimal([[0, 0], [1, 0], [1, 1]]), true);
  assert.equal(L.isLatticeAnimal([[0, 0], [2, 0]]), false, "two cells that do not touch are not one animal");
  assert.equal(L.isLatticeAnimal([[0, 0], [1, 1]]), false, "a diagonal is not an edge");
  assert.equal(L.isLatticeAnimal([[0, 0], [0, 0]]), false, "a repeated cell is refused");
  assert.equal(L.isLatticeAnimal([[0, 0.5]]), false, "cells are whole numbers");
  for (let s = 1; s < 60; s++) {
    const n = 1 + (s % 17);
    const a = L.wildAnimal(s, n);
    assert.equal(a.length, n);
    assert.ok(L.isLatticeAnimal(a), `wildAnimal(${s}, ${n}) is not one 4-connected piece`);
    assert.deepEqual(L.wildAnimal(s, n), a, "a wild animal is a function of its seed");
  }
  assert.notDeepEqual(L.wildAnimal(1, 9), L.wildAnimal(2, 9), "different seeds must grow different animals");

  const square = L.bodyOf([[0, 0], [1, 0], [0, 1], [1, 1]]);
  assert.equal(square.bondCount, 4, "a 2x2 square shares four edges");
  assert.equal(L.bodyOf([[0, 0], [1, 0], [2, 0]]).bondCount, 2);
  let sx = 0, sy = 0;
  for (let i = 0; i < square.count; i++) { sx += square.cells[i * 2]; sy += square.cells[i * 2 + 1]; }
  assert.ok(Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9, "a body is centred on its centroid");
}

// ——— instances: one per cell and per bond, no overrun, a function of the inputs ———
{
  const body = L.bodyOf([[0, 0], [1, 0], [1, 1], [2, 1]]);
  const form = L.formForRoom("stars");
  const out = new Float32Array(64 * L.FORM_STRIDE);
  const p = { x: 100, y: 80, cell: 10, heading: 0, alpha: 1, time: 3.2, seed: 7 };
  const n = L.writeAnimal(out, 0, 64, body, form, p);
  assert.equal(n, body.count + body.bondCount, "every cell and every shared edge is drawn");
  const kinds = [];
  for (let i = 0; i < n; i++) kinds.push(out[i * L.FORM_STRIDE + 4]);
  assert.equal(kinds.filter((k) => k === L.KIND_INDEX.star).length, body.count, "each cell wears the form's kind");
  assert.equal(kinds.filter((k) => k === L.BOND_KIND).length, body.bondCount);
  const again = new Float32Array(64 * L.FORM_STRIDE);
  L.writeAnimal(again, 0, 64, body, form, p);
  assert.deepEqual(again, out, "the same animal, form, seed and time write the same instances");
  const tight = new Float32Array(3 * L.FORM_STRIDE);
  assert.equal(L.writeAnimal(tight, 0, 3, body, form, p), 3, "the writer stops at the room it was given");
  // a cell's centre stays within its lattice cell however long it trembles
  for (const t of [0, 1.7, 40, 900]) {
    const o = new Float32Array(64 * L.FORM_STRIDE);
    const m = L.writeAnimal(o, 0, 64, body, L.formForRoom("quanta"), { ...p, time: t });
    for (let i = body.bondCount; i < m; i++) {
      const c = i - body.bondCount;
      const dx = (o[i * L.FORM_STRIDE] - p.x) / p.cell - body.cells[c * 2];
      const dy = (o[i * L.FORM_STRIDE + 1] - p.y) / p.cell - body.cells[c * 2 + 1];
      assert.ok(Math.hypot(dx, dy) < 0.15, `at t=${t} a cell left its place on the lattice`);
    }
  }
  const still = new Float32Array(64 * L.FORM_STRIDE), still2 = new Float32Array(64 * L.FORM_STRIDE);
  L.writeAnimal(still, 0, 64, body, form, { ...p, reduced: true, time: 1 });
  L.writeAnimal(still2, 0, 64, body, form, { ...p, reduced: true, time: 50 });
  for (let i = 0; i < n; i++) for (const k of [0, 1, 2, 3]) assert.equal(still[i * L.FORM_STRIDE + k], still2[i * L.FORM_STRIDE + k], "reduced motion: cells hold still");
}

// ——— the visits: seeded, one at a time, never at once ———
{
  const a = [0, 1, 2, 3, 4, 5].map((i) => L.visitAt(99, i));
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => L.visitAt(99, i)), a, "visits are a function of (seed, index)");
  assert.ok(a[0].start >= 5 && a[0].start <= 14, "the first wanderer comes soon, not at once and not never");
  for (let i = 1; i < a.length; i++) assert.ok(a[i].start >= a[i - 1].start + a[i - 1].duration + 18, "visits never overlap and rest between");
  assert.notDeepEqual(L.visitAt(98, 0), a[0], "another session sees another crossing");
  assert.equal(L.liveVisit(99, a[0].start - 0.5), null, "nobody before the first visit");
  assert.equal(L.liveVisit(99, a[2].start + 1).index, 2);
  assert.equal(L.liveVisit(99, a[2].start + 1, 0).index, L.liveVisit(99, a[2].start + 1, 2).index, "the hint is a shortcut, never a different answer");
  const v = a[0];
  const p0 = L.pathPoint(v, 0), p1 = L.pathPoint(v, 1);
  assert.ok(Math.hypot(p0.x - v.from[0], p0.y - v.from[1]) < 1e-9 && Math.hypot(p1.x - v.to[0], p1.y - v.to[1]) < 1e-9, "a crossing runs edge to edge");
  const mid = L.pathPoint(v, 0.5);
  assert.ok(mid.x > -0.05 && mid.x < 1.05 && mid.y > -0.05 && mid.y < 1.05, "mid-crossing, the visitor is on the page");
}

// ——— size: a visitor never fills the page ———
for (const r of [0.5, 2, 10, 20]) for (const [w, h] of [[390, 844], [1440, 900]]) {
  const c = L.cellSize(r, w, h);
  assert.ok(c * r * 2 <= Math.min(w, h) * 0.33, `an animal of radius ${r} would cover the room at ${w}x${h}`);
}

// ——— the MCP lists the forms ———
{
  const tool = E.TOOLS.find((t) => t.name === "universe_forms");
  const list = tool.handler({}).content[0].text;
  assert.ok(list.startsWith(`${L.FORMS.length} forms`));
  assert.equal(JSON.parse(tool.handler({ room: "/stars" }).content[0].text).kind, "star");
  assert.equal(tool.handler({ form: "no-such-form" }).isError, true);
}

console.log(`lattice-forms: ${L.FORMS.length} forms, every room wears its own, laws hold`);
