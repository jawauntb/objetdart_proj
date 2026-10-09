// Explore lane law: the map is the whole app, every neighbor is real, the cap holds.
import assert from "node:assert/strict";
import { loadTsModule } from "../lib/load-ts.mjs";

const { TOOLS } = loadTsModule("src/lib/universe-mcp/tools-explore.ts");
const { doorsOf, resolveRoom, MAP_CAP_BYTES } = loadTsModule("src/lib/universe-mcp/map.ts");
const { ROOM_REGISTRY, ROOM_BY_KEY } = loadTsModule("src/lib/room-registry.ts");
const ctx = { now: () => 0, authed: false, ip: "", env: {}, bound: null };
const call = (name, args = {}) => TOOLS.find((t) => t.name === name).handler(args, ctx);
const T = (r) => r.content[0].text;

assert.deepEqual(TOOLS.map((t) => t.name), ["universe_map", "universe_room", "universe_rooms_near", "universe_forms"]);

const map = T(await call("universe_map"));
const lines = map.split("\n");
for (const e of ROOM_REGISTRY) {
  assert.ok(lines.some((l) => l.startsWith(`${e.key} | ${e.href} | `)), `map omits room ${e.key}: a room the animal can never find`);
}
assert.ok(Buffer.byteLength(map) <= MAP_CAP_BYTES && MAP_CAP_BYTES <= 14 * 1024, "map exceeds the 14 KB budget");
assert.match(map, /quarks?.*manifold/s, "axis bands are missing or unordered");
assert.ok(map.indexOf("quark") < map.indexOf("manifold["), "axis must run small to large");

let doorCount = 0;
for (const e of ROOM_REGISTRY) {
  for (const k of doorsOf(e.key)) {
    doorCount++;
    assert.ok(ROOM_BY_KEY[k], `${e.key} lists neighbor "${k}" that is not a room`);
    assert.notEqual(k, e.key, `${e.key} is its own neighbor`);
  }
  assert.equal(new Set(doorsOf(e.key)).size, doorsOf(e.key).length, `${e.key} lists a neighbor twice`);
}
assert.ok(doorCount > ROOM_REGISTRY.length, "the travel graph is nearly empty: door resolution broke");

const cells = JSON.parse(T(await call("universe_room", { room: "cells" })));
assert.equal(cells.creates, "a cell");
assert.match(cells.interacts, /adhesion/);
assert.match(cells.interacts, /phagocytosis/);
assert.ok(cells.guide && cells.guide.essence, "guide entry missing");
assert.ok(cells.doors.in.length + cells.doors.out.length > 0, "cells has no travel doors");
const verbs = [...cells.gestures.answers, ...cells.gestures.exempts.map((x) => x.verb)];
assert.equal(new Set(verbs).size, 13, "every global verb is either answered or exempted, once");

// an exempted verb carries its written reason
const withEx = ROOM_REGISTRY.find((e) => Object.keys(e.exempt).length);
const ex = JSON.parse(T(await call("universe_room", { room: withEx.key }))).gestures.exempts.find((x) => x.verb === Object.keys(withEx.exempt)[0]);
assert.equal(ex.reason, Object.values(withEx.exempt)[0], "exemption reason lost");

const forms = ["cells", "/cells", "cells/", "/CELLS"];
for (const f of forms) assert.equal(resolveRoom(f)?.key, "cells", `form ${f} did not resolve`);
assert.equal(resolveRoom("/atlas")?.key, "atlas", "a band stem route must find its room");
assert.equal(resolveRoom("/cells?x=1")?.key, "cells");
assert.equal(resolveRoom("/nonsense-zzz"), null);

const bad = await call("universe_room", { room: "cellz" });
assert.equal(bad.isError, true);
assert.match(T(bad), /cells/, "unknown-room error must name near keys");
assert.equal(T(bad).split("Closest keys:")[1].split(",").length, 5);
assert.equal((await call("universe_rooms_near", { room: "zzzz" })).isError, true);

const near1 = JSON.parse(T(await call("universe_rooms_near", { room: "cells" })));
assert.deepEqual(near1.near[0].rooms.map((r) => r.key).sort(), [...doorsOf("cells")].sort(), "hop 1 must equal the doors");
const near3 = JSON.parse(T(await call("universe_rooms_near", { room: "cells", hops: 9 })));
assert.equal(near3.hops, 3, "hops must clamp to 3");
const seen = near3.near.flatMap((g) => g.rooms.map((r) => r.key));
assert.equal(new Set(seen).size, seen.length, "a room appears in two hop groups");
assert.ok(!seen.includes("cells"), "the start room is listed as near itself");
assert.ok(near3.near.length >= 2, "hops=3 reached only one ring");

// the map must keep enough of each interacts line to be worth reading
const c = lines.find((l) => l.startsWith("cells | ")).split(" | ")[6];
assert.ok(c.length >= 60, `interacts squeezed to ${c.length} chars by the byte cap`);

// prototype keys are not rooms: they must be a clean unknown-room error, never a throw
for (const k of ["__proto__", "constructor", "/constructor", "toString"]) {
  assert.equal(resolveRoom(k), null, `${k} must not resolve to a room`);
  const r = await call("universe_room", { room: k });
  assert.equal(r.isError, true, `${k} must be an unknown-room error`);
}
