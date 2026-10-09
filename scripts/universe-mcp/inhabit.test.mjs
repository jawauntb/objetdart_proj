// Inhabit lane law: the persistent universe, the twin, the tools. Each
// assertion names the bug it catches.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import fs from "node:fs";
import path from "node:path";
import { loadTsModule } from "../lib/load-ts.mjs";

const S = loadTsModule("src/lib/universe-mcp/store.ts");
const T = loadTsModule("src/lib/universe-mcp/twin.ts");
const W = loadTsModule("src/lib/universe-mcp/instances.ts");
const TI = loadTsModule("src/lib/universe-mcp/tools-inhabit.ts");
const RT = loadTsModule("src/lib/universe-mcp/store-runtime.ts");
const R = loadTsModule("src/lib/room-registry.ts");

const memIo = (init = null) => { const m = { s: init, writes: 0 }; return { m, io: { read: () => m.s, write: (s) => { m.s = s; m.writes++; } } }; };
const mk = (init) => { const { m, io } = memIo(init); const q = []; const store = S.createStore({ io, now: () => 0, schedule: (f) => q.push(f) }); return { m, store, q }; };
const ok = (r) => { assert.equal(r.ok, true, r.error); return r.value; };
const NOW = 1000;

// ——— worldCode golden vectors from the docs ———
assert.equal(W.worldCode("abcd1234", "mind", "7"), "w18sdely0a62ke", "worldCode drifted from the pinned algorithm");
assert.equal(W.worldCode("abcd1234", "body", "frog"), "w0riwarz1cq1mp");
assert.equal(W.worldCode("abcd1234", "field", ""), "w1puy7wr08av8b", "empty unit must still hash");
assert.equal(W.worldCode("anon", "pattern", "0"), "w1dglo291beunb");

// ——— open: derived code, layer homes ———
{
  const { store } = mk();
  const a = ok(W.open(store, { from: "abcd1234", layer: "mind", unit: "7" }, NOW));
  assert.equal(a.instance, "w18sdely0a62ke");
  assert.equal(a.created, true);
  assert.equal(a.mcp, "/mcp/i/w18sdely0a62ke");
  assert.equal(a.room, "cells");
  assert.equal(ok(W.open(store, { from: "abcd1234", layer: "mind", unit: "7" }, NOW)).created, false, "reopening must not reset a world");
  assert.equal(W.open(store, { layer: "nope" }, NOW).ok, false);
  assert.equal(W.open(store, { instance: "BAD CODE" }, NOW).ok, false);
  for (const [layer, room] of Object.entries(T.LAYER_HOME)) assert.ok(R.ROOM_BY_KEY[room], `LAYER_HOME ${layer} -> ${room} is not a real room`);
  assert.equal(Object.keys(T.LAYER_HOME).length, 7);
}

// ——— determinism ———
const script = (store, code) => {
  ok(W.open(store, { instance: code, layer: "field" }, NOW));
  ok(W.step(store, { instance: code, to: "cells" }, NOW));
  for (const g of [{ verb: "tap", count: 3 }, { verb: "tap", count: 3 }, { verb: "tap", count: 3 }, { verb: "tap", count: 5 }, { verb: "drag", dx: 40, dy: -20 }, { verb: "hold", ms: 1500 }, { verb: "chord", fingers: 3 }, { verb: "shake" }, { verb: "tap", count: 9 }])
    ok(W.gesture(store, { instance: code, ...g }, NOW));
  ok(W.step(store, { instance: code, to: "wander" }, NOW));
  return JSON.stringify(store.get());
};
{
  const a = script(mk().store, "aaaaaaaa1"), b = script(mk().store, "aaaaaaaa1"), c = script(mk().store, "bbbbbbbb2");
  assert.equal(a, b, "same code and verb script must give byte-identical state");
  assert.notEqual(a, c.replace(/bbbbbbbb2/g, "aaaaaaaa1"), "a different code's seed must change the physics, not only the name");
}

// ——— tap rungs differ in kind ———
{
  const { store } = mk();
  const code = "tapworld1";
  ok(W.open(store, { instance: code }, NOW));
  ok(W.step(store, { instance: code, to: "zeus" }, NOW));
  const g = (a) => ok(W.gesture(store, { instance: code, ...a }, NOW));
  const one = g({ verb: "tap", count: 1 });
  const zeroObjs = one.state.objects;
  assert.equal(zeroObjs, 0, "rung 1 must only touch");
  assert.equal(one.kind, "touch");
  assert.equal(g({ verb: "tap", count: 3 }).kind, "create");
  g({ verb: "tap", count: 3 });
  const before = store.get().instances[code].rooms.zeus.objects.slice();
  assert.equal(before.length, 2, "rung 3 makes exactly one object per train");
  const five = g({ verb: "tap", count: 5 });
  assert.equal(five.kind, "merge");
  const after = store.get().instances[code].rooms.zeus.objects;
  assert.equal(after.length, 1, "rung 5 merges two into one");
  assert.ok(!before.some((o) => o.seed === after[0].seed), "merge seed must be neither parent's");
  assert.match(five.events[0], /electrostatic|charge|thunderhead/i, "merge event must carry the room's interacts force text");
  g({ verb: "tap", count: 3 });
  const bloom = g({ verb: "tap", count: 7 });
  assert.equal(bloom.kind, "bloom");
  assert.equal(bloom.state.objects, 2, "the bloom must not create or merge");
  const b12 = g({ verb: "tap", count: 12 }).state.bloom, b60 = g({ verb: "tap", count: 60 }).state.bloom, b99 = g({ verb: "tap", count: 99 }).state.bloom;
  assert.ok(b12 > bloom.state.bloom || b12 === 0.5, "bloom grows with n");
  assert.ok(b60 >= b12 && b99 === b60 && b99 <= 1, "bloom is capped");
  assert.equal(g({ verb: "tap", count: 2 }).tier, 1);
  assert.equal(g({ verb: "tap", count: 4 }).tier, 3);
  assert.equal(g({ verb: "tap", count: 6 }).tier, 5);
  assert.equal(g({ verb: "tap", count: 7 }).tier, "n");
}

// ——— hold depth and ceremony ———
{
  const { store } = mk();
  const code = "holdworld";
  ok(W.open(store, { instance: code }, NOW));
  ok(W.step(store, { instance: code, to: "zeus" }, NOW));
  const g = (a) => ok(W.gesture(store, { instance: code, ...a }, NOW));
  g({ verb: "tap", count: 3 });
  const objs = () => store.get().instances[code].rooms.zeus.objects;
  const d900 = g({ verb: "hold", ms: 900 }), d2400 = g({ verb: "hold", ms: 2400 }), d4000 = g({ verb: "hold", ms: 4000 });
  assert.ok(d900.depth < d2400.depth && d2400.depth < d4000.depth, "depth must be strictly monotone in ms");
  assert.ok(g({ verb: "hold", ms: 100 }).depth < d900.depth);
  assert.equal(d900.kind, "grow", "past dwellMs it grows the nearest object");
  assert.equal(d2400.kind, "grow", "below ceremonyMs it does not retire");
  assert.equal(d4000.kind, "let go", "past ceremonyMs it retires the oldest with a let-go event");
  assert.equal(objs().length, 0);
  assert.match(d4000.events[0], /let go/);
  assert.equal(g({ verb: "hold", ms: 1200 }).kind, "plant", "dwell on an empty room plants");
}

// ——— frame verbs do not touch objects; senses present ———
{
  const { store } = mk();
  const code = "framewrld";
  ok(W.open(store, { instance: code }, NOW));
  const g = (a) => ok(W.gesture(store, { instance: code, ...a }, NOW));
  g({ verb: "tap", count: 3 });
  const objs = () => JSON.stringify(store.get().instances[code].rooms.manifold.objects);
  const o0 = objs();
  const c2 = g({ verb: "chord", fingers: 2 }), c3 = g({ verb: "chord", fingers: 3 });
  assert.equal(objs(), o0, "frame verbs must not move or change objects");
  assert.ok(c2.state.frame !== 1 && c3.state.law !== 0, "chord 2 changes the frame, chord 3 the law");
  assert.equal(W.gesture(store, { instance: code, verb: "chord", fingers: 4 }, NOW).ok, false);
  assert.equal(W.gesture(store, { instance: code, verb: "wave" }, NOW).ok, false);
  for (const verb of T.VERBS) {
    const r = g({ verb, count: 3, ms: 1000, fingers: 1, dx: 5, dy: 5, scale: 2, angle: 1 });
    for (const k of ["sight", "sound", "haptic"]) assert.ok(typeof r.senses[k] === "string" && r.senses[k].length > 10, `${verb} must land in ${k}`);
  }
}

// ——— every room answers every verb, including creates===null and exempt ———
{
  const { store } = mk();
  ok(W.open(store, { instance: "everyroom1" }, NOW));
  for (const e of R.ROOM_REGISTRY) {
    ok(W.step(store, { instance: "everyroom1", to: e.key }, NOW));
    for (const verb of T.VERBS) {
      const r = ok(W.gesture(store, { instance: "everyroom1", verb, count: 5, ms: 3000, fingers: 2 }, NOW));
      assert.ok(r.senses.sight && r.senses.sound && r.senses.haptic, `${e.key}/${verb} lacks a sense`);
    }
  }
}

// ——— stepping ———
{
  const { store } = mk();
  const code = "stepworld";
  ok(W.open(store, { instance: code }, NOW));
  const seen = new Set(["manifold"]);
  for (let i = 0; i < 60; i++) seen.add(ok(W.step(store, { instance: code, to: "wander" }, NOW)).arrived);
  assert.ok(seen.size >= 20, `wander visited only ${seen.size} rooms in 60 steps`);
  for (const e of R.ROOM_REGISTRY) {
    ok(W.open(store, { instance: code }, NOW));
    assert.equal(ok(W.step(store, { instance: code, to: e.key }, NOW)).arrived, e.key, `${e.key} unreachable`);
    assert.equal(ok(W.step(store, { instance: code, to: e.href }, NOW)).arrived, e.key, `route ${e.href} does not resolve to ${e.key}`);
  }
  ok(W.step(store, { instance: code, to: "manifold" }, NOW));
  const inn = ok(W.step(store, { instance: code, to: "in" }, NOW)).arrived, outt = ok(W.step(store, { instance: code, to: "out" }, NOW)).arrived;
  assert.notEqual(inn, "manifold");
  assert.ok(outt);
  const bad = W.step(store, { instance: code, to: "manifld" }, NOW);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /manifold/, "an unknown room must list near keys");
  assert.equal(W.step(store, { instance: "nosuchworld" }, NOW).ok, false);
  assert.ok(store.get().instances[code].path.length <= 40, "path is capped at 40");
  // wander is deterministic per code
  const walk = (c) => { const s = mk().store; ok(W.open(s, { instance: c }, NOW)); return Array.from({ length: 12 }, () => ok(W.step(s, { instance: c, to: "wander" }, NOW)).arrived).join(); };
  assert.equal(walk("wanderaaa1"), walk("wanderaaa1"));
}

// ——— polyomino validation ———
{
  const v = (c) => W.validateCells(c).ok;
  assert.equal(v([[0, 0], [1, 0], [1, 1]]), true);
  assert.equal(v([[0, 0], [2, 0]]), false, "disconnected");
  assert.equal(v([[0, 0], [1, 1]]), false, "diagonal-only is not 4-connected");
  assert.equal(v([[0, 0], [1, 0], [1, 0]]), false, "duplicates");
  assert.equal(v([[0.5, 0]]), false, "non-integers");
  assert.equal(v([["0", 0]]), false);
  assert.equal(v([]), false);
  assert.equal(v([[0, 0, 0]]), false);
  assert.equal(v([[1e9, 0]]), false, "insane range");
  assert.equal(v(Array.from({ length: 400 }, (_, i) => [i, 0])), true, "400 in a line passes without recursion trouble");
  assert.equal(v(Array.from({ length: 401 }, (_, i) => [i, 0])), false, ">400");
  assert.equal(v("nope"), false);
}

// ——— inhabit / remember / leave / commons ———
{
  const { store } = mk();
  ok(W.open(store, { instance: "worldaaaa1" }, 1));
  ok(W.open(store, { instance: "worldbbbb2", layer: "body" }, 1));
  const cells = [[0, 0], [1, 0]];
  const a = ok(W.inhabit(store, { instance: "worldaaaa1", animal: { id: "frog-1", species: "frog", cells, from: "seed" } }, 2));
  assert.equal(a.resumed, false);
  ok(W.remember(store, { instance: "worldaaaa1", note: "a\tb\u0007c" }, 3));
  assert.equal(store.get().commons.inhabitants["frog-1"].notes[0], "a bc", "control chars stripped");
  // ownership: an id is public, so another world must not overwrite, write to or retire it
  assert.equal(W.inhabit(store, { instance: "worldbbbb2", animal: { id: "frog-1", species: "toad", cells: [[0, 0]] }, room: "/zeus" }, 4).ok, false, "a stranger cannot overwrite an animal by id");
  assert.equal(W.remember(store, { instance: "worldbbbb2", note: "hijack", animal: "frog-1" }, 4).ok, false, "a stranger cannot write to its memory");
  assert.equal(W.leave(store, { instance: "worldbbbb2", animal: "frog-1" }, 4).ok, false, "a stranger cannot retire it");
  assert.equal(store.get().commons.inhabitants["frog-1"].species, "frog");
  assert.equal(store.get().commons.inhabitants["frog-1"].notes.length, 1);
  // the owner moves it within its own world and can hand it on by leaving first
  const mv = ok(W.inhabit(store, { instance: "worldaaaa1", animal: { id: "frog-1", species: "frog", cells: [[0, 0]] }, room: "/zeus" }, 4));
  assert.equal(mv.resumed, true);
  assert.equal(mv.inhabitant.room, "zeus");
  ok(W.leave(store, { instance: "worldaaaa1", animal: "frog-1" }, 4));
  const b = ok(W.inhabit(store, { instance: "worldbbbb2", animal: { id: "frog-1", species: "frog", cells: [[0, 0]] }, room: "/zeus" }, 5));
  assert.equal(b.resumed, false, "after the owner lets go, the id is free");
  const h = store.get().commons.inhabitants["frog-1"];
  assert.equal(Object.keys(store.get().commons.inhabitants).length, 1);
  for (const id of ["", "a b", "x".repeat(65), "é"]) assert.equal(W.inhabit(store, { instance: "worldaaaa1", animal: { id, species: "s", cells } }, 5).ok, false, `id ${JSON.stringify(id)}`);
  assert.equal(W.remember(store, { instance: "worldaaaa1", note: "x".repeat(281) }, 5).ok, false);
  assert.equal(W.remember(store, { instance: "worldaaaa1", note: "  " }, 5).ok, false);
  assert.equal(W.remember(store, { instance: "worldbbbb2", note: "x".repeat(280) }, 5).ok, true);
  for (let n = 0; n < 45; n++) ok(W.remember(store, { instance: "worldbbbb2", note: `n${n}` }, 6));
  assert.equal(h.notes.length, 40);
  assert.equal(h.notes[0], "n5", "oldest notes retire first");
  const pub = JSON.stringify(ok(W.inhabitants(store, { room: "zeus" })));
  assert.match(pub, /frog-1/);
  assert.ok(!pub.includes("n44") && !pub.includes('"cells"'), "public part carries no notes or cells");
  assert.equal(ok(W.inhabitants(store, { room: "cells" })).count, 0);
  assert.equal(W.inhabitants(store, { room: "nowhere" }).ok, false);
  ok(W.leave(store, { instance: "worldbbbb2" }, 7));
  assert.equal(ok(W.inhabitants(store, {})).count, 0);
  assert.equal(W.leave(store, { instance: "worldbbbb2" }, 8).ok, false);
}

// ——— caps ———
{
  const { store } = mk();
  for (let i = 0; i < 5003; i++) ok(W.open(store, { instance: `w${String(i).padStart(9, "0")}` }, i));
  const keys = Object.keys(store.get().instances);
  assert.equal(keys.length, 5000);
  assert.ok(!keys.includes("w000000000") && keys.includes("w000005002"), "the least recently seen instance is evicted");
  const { store: s2 } = mk();
  ok(W.open(s2, { instance: "capsworld1" }, 1));
  for (let i = 0; i < 70; i++) ok(W.inhabit(s2, { instance: "capsworld1", animal: { id: `a${i}`, species: "s", cells: [[0, 0]] } }, 10 + i));
  const list = Object.keys(s2.get().commons.inhabitants);
  assert.equal(list.length, 64, "64 inhabitants per room");
  assert.ok(!list.includes("a0") && list.includes("a69"), "the oldest inhabitant of a full room retires");
  const big = JSON.parse(JSON.stringify(s2.get()));
  big.instances.capsworld1.rooms.manifold = { ...T.freshRoom(), objects: Array.from({ length: 80 }, (_, i) => ({ id: i, seed: i, x: 0, y: 0, size: 1 })) };
  big.commons.inhabitants.a69.notes = Array.from({ length: 60 }, (_, i) => `n${i}`);
  big.commons.inhabitants.a69.cells = Array.from({ length: 450 }, (_, i) => [i, 0]);
  big.instances.capsworld1.path = Array.from({ length: 60 }, (_, i) => ({ room: "manifold", how: "x", at: i }));
  const loaded = S.parseData(JSON.stringify(big));
  assert.equal(loaded.instances.capsworld1.rooms.manifold.objects.length, 64, "64 objects per room state");
  assert.equal(loaded.commons.inhabitants.a69.notes.length, 40);
  assert.equal(loaded.commons.inhabitants.a69.cells.length, 400);
  assert.equal(loaded.instances.capsworld1.path.length, 40, "40 path entries per instance");
}

// ——— persistence ———
{
  const a = mk();
  ok(W.open(a.store, { instance: "persistaa1", layer: "mind" }, 5));
  ok(W.inhabit(a.store, { instance: "persistaa1", animal: { id: "p1", species: "s", cells: [[0, 0]] } }, 6));
  ok(W.gesture(a.store, { instance: "persistaa1", verb: "tap", count: 3 }, 7));
  assert.equal(a.m.writes, 0, "writes are debounced");
  a.q[0]();
  a.store.flush();
  assert.equal(a.m.writes, 1, "a burst of mutations is one write");
  const b = mk(a.m.s);
  assert.equal(JSON.stringify(b.store.get()), JSON.stringify(a.store.get()), "state must round-trip through io");
  assert.equal(b.store.get().instances.persistaa1.rooms.cells.objects.length, 1);
  for (const bad of ["{not json", "", "null", "[]", '{"v":2}', '{"v":1,"instances":5,"commons":7}']) {
    const c = mk(bad);
    assert.equal(Object.keys(c.store.get().instances).length, 0, `corrupt ${bad} must start empty`);
  }
  const throwing = S.createStore({ io: { read: () => { throw new Error("x"); }, write: () => { throw new Error("y"); } }, now: () => 0, schedule: (f) => f() });
  ok(W.open(throwing, { instance: "throwerabc1" }, 1));
}

// ——— prototype safety ———
{
  const { store } = mk();
  for (const code of ["constructor", "__proto__", "prototypeee"]) {
    const r = W.open(store, { instance: code }, 1);
    if (r.ok) assert.ok(store.get().instances[code]);
  }
  ok(W.open(store, { instance: "protoworld1" }, 1));
  for (const id of ["__proto__", "constructor", "toString"]) ok(W.inhabit(store, { instance: "protoworld1", animal: { id, species: "s", cells: [[0, 0]] } }, 2));
  assert.equal(W.step(store, { instance: "protoworld1", to: "__proto__" }, 2).ok, false, "__proto__ is not a room");
  assert.equal(W.step(store, { instance: "protoworld1", to: "constructor" }, 2).ok, false);
  assert.equal(W.inhabitants(store, { room: "__proto__" }).ok, false);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, "__proto__"), true);
  assert.equal(Object.getPrototypeOf(store.get().commons.inhabitants), null, "maps are null-prototype");
  store.flush();
  const evil = mk('{"v":1,"instances":{"__proto__":{"code":"__proto__"}},"commons":{"inhabitants":{"__proto__":{"polluted":1}}}}');
  assert.equal({}.polluted, undefined, "loading hostile JSON must not pollute Object.prototype");
  assert.equal(Object.keys(evil.store.get().instances).length, 0);
}

// ——— tools: names and required args pinned ———
{
  const { store } = mk();
  const tools = TI.makeTools(() => store);
  const pinned = { universe_open: [], universe_look: ["instance"], universe_step: ["instance", "to"], universe_gesture: ["instance", "verb"], universe_inhabit: ["instance", "animal"], universe_remember: ["instance", "note"], universe_leave: ["instance"], universe_inhabitants: [] };
  assert.deepEqual(tools.map((t) => t.name), Object.keys(pinned));
  for (const t of tools) { assert.deepEqual(t.inputSchema.required ?? [], pinned[t.name], `${t.name} required args`); assert.equal(t.access, "open"); }
  assert.deepEqual(TI.TOOLS.map((t) => t.name), Object.keys(pinned));
  const ctx = { now: () => 5, authed: false, ip: "", env: {}, bound: null };
  const call = (n, a) => tools.find((t) => t.name === n).handler(a, ctx);
  const opened = JSON.parse((await call("universe_open", { from: "abcd1234", layer: "mind", unit: "7" })).content[0].text);
  assert.equal(opened.instance, "w18sdely0a62ke");
  const gest = await call("universe_gesture", { instance: opened.instance, verb: "tap", count: 3 });
  assert.equal(JSON.parse(gest.content[0].text).kind, "create");
  const err = await call("universe_look", { instance: "zzzzzzzzzz" });
  assert.equal(err.isError, true);
  assert.ok(!/at \S+:\d+/.test(err.content[0].text), "errors are sentences, not stacks");
  assert.equal((await call("universe_inhabit", { instance: opened.instance, animal: { id: "x", species: "s", cells: [[0, 0], [5, 5]] } })).isError, true);
}

// ——— runtime: real fs round-trip, unwritable dir -> memory ———
{
  const dir = mkdtempSync(path.join(tmpdir(), "universe-"));
  const io = RT.makeFileIo(fs, path, dir);
  const s = S.createStore({ io, now: () => 0, schedule: () => {} });
  ok(W.open(s, { instance: "fsworld001" }, 1));
  s.flush();
  assert.match(readFileSync(path.join(dir, "universe.json"), "utf8"), /fsworld001/);
  assert.deepEqual(fs.readdirSync(dir), ["universe.json"], "the tmp file is renamed away");
  assert.ok(S.createStore({ io: RT.makeFileIo(fs, path, dir), now: () => 0 }).get().instances.fsworld001);
  assert.equal(RT.makeFileIo(fs, path, path.join(dir, "universe.json", "sub")), null, "an unwritable dir falls back to memory");
  assert.deepEqual(RT.dataDirFor({ UNIVERSE_DATA_DIR: "/a", RAILWAY_VOLUME_MOUNT_PATH: "/b" }), { dir: "/a", mode: "volume" });
  assert.deepEqual(RT.dataDirFor({ RAILWAY_VOLUME_MOUNT_PATH: "/b" }), { dir: "/b", mode: "volume" });
  assert.equal(RT.dataDirFor({}).mode, "disk");
  assert.match(RT.persistenceText("disk"), /not redeploys/);
}
// ——— a persisted room that left the registry; memory can be read back ———
{
  const { store } = mk();
  ok(W.open(store, { instance: "stalerooms1", layer: "mind" }, 1));
  store.get().instances.stalerooms1.room = "a-room-the-world-deleted";
  const l = ok(W.look(store, { instance: "stalerooms1" }, 2));
  assert.equal(l.room, "cells", "a vanished room must send the world home to its layer, not throw");
  store.get().instances.stalerooms1.room = "a-room-the-world-deleted";
  assert.equal(W.gesture(store, { instance: "stalerooms1", verb: "tap", count: 3 }, 3).ok, true);
  assert.deepEqual(l.memory, [], "no animal, no memory");
  ok(W.inhabit(store, { instance: "stalerooms1", animal: { id: "mem-1", species: "s", cells: [[0, 0]] } }, 4));
  for (let n = 0; n < 10; n++) ok(W.remember(store, { instance: "stalerooms1", note: `thought ${n}` }, 5));
  const m = ok(W.look(store, { instance: "stalerooms1" }, 6)).memory;
  assert.equal(m.length, 8, "look returns the last 8 notes");
  assert.equal(m[7], "thought 9", "a remembered note must be readable, newest last");
  assert.ok(!JSON.stringify(ok(W.inhabitants(store, {}))).includes("thought"), "the public listing still carries no notes");
}
// ——— forms: an animal keeps its cells and wears any form the atlas holds ———
{
  const { store } = mk();
  ok(W.open(store, { instance: "formworld1" }, 1));
  ok(W.step(store, { instance: "formworld1", to: "stars" }, 2));
  const body = [[0, 0], [1, 0], [1, 1]];
  const a = ok(W.inhabit(store, { instance: "formworld1", animal: { id: "form-1", species: "frog", cells: body } }, 3));
  assert.equal(a.inhabitant.form, "stars", "with no form chosen, an animal wears its room's own form");
  assert.equal(a.inhabitant.chose, false);
  const b = ok(W.inhabit(store, { instance: "formworld1", animal: { id: "form-1", species: "frog", cells: body, form: "cells-plasm" } }, 4));
  assert.equal(b.inhabitant.form, "cells-plasm", "a chosen form must be worn, even in another room");
  assert.equal(b.inhabitant.chose, true);
  const c = ok(W.inhabit(store, { instance: "formworld1", animal: { id: "form-1", species: "frog", cells: body } }, 5));
  assert.equal(c.inhabitant.form, "cells-plasm", "re-placing without a form must keep the one chosen, not reset it");
  const d = ok(W.inhabit(store, { instance: "formworld1", animal: { id: "form-1", species: "frog", cells: body, form: "" } }, 6));
  assert.equal(d.inhabitant.form, "stars", "an empty form goes back to the room's own");
  const bad = W.inhabit(store, { instance: "formworld1", animal: { id: "form-1", species: "frog", cells: body, form: "not-a-form" } }, 7);
  assert.equal(bad.ok, false, "an unknown form must be refused, not stored");
  assert.match(bad.error, /No form answers/);
  const plain = ok(W.inhabitants(store, { room: "stars" }));
  assert.equal(plain.inhabitants[0].cells, undefined, "the plain listing carries no shapes");
  const shaped = ok(W.inhabitants(store, { room: "stars", shapes: true }));
  assert.deepEqual(shaped.inhabitants[0].cells, body, "shapes:true returns the animal's own cells, so a page can draw it");
  for (let n = 0; n < 60; n++) ok(W.inhabit(store, { instance: "formworld1", animal: { id: `crowd-${n}`, species: "s", cells: [[0, 0]] }, room: n % 2 ? "cells" : "quanta" }, 10 + n));
  const many = ok(W.inhabitants(store, { shapes: true }));
  assert.equal(many.inhabitants.length, W.SHAPES_CAP, "shapes are capped so a page never downloads the whole commons");
  assert.equal(many.inhabitants[0].id, "crowd-59", "the cap keeps the newest, so a just-placed animal is the one that shows");
  // a persisted form that left the atlas must not crash or be advertised
  store.get().commons.inhabitants["form-1"].form = "a-form-the-world-deleted";
  assert.equal(ok(W.inhabitants(store, { room: "stars" })).inhabitants[0].form, "stars");
}
console.log("inhabit: ok");
