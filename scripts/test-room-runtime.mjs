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
  const requireShim = (id) => {
    if (id.startsWith("@/")) return loadTsModule(`src/${id.slice(2)}.ts`);
    throw new Error(`Unexpected require(${id}) while loading ${path}`);
  };
  new Function("module", "exports", "require", code)(module, module.exports, requireShim);
  return module.exports;
}

const {
  resolveDpr,
  tierFromFrameMs,
  detailForTier,
  createFrameGovernor,
  createIdleWriter,
} = loadTsModule("src/lib/room-runtime.ts");

const {
  PEER_CIRCLES,
  peerCircleForRoute,
  peersOf,
  nextPeer,
} = loadTsModule("src/lib/peers.ts");

// — DPR never exceeds the tier ceiling —
assert.ok(resolveDpr("high", { maxDpr: 3 }) <= 2);
assert.ok(resolveDpr("low", { maxDpr: 3 }) <= 1.25);
assert.ok(resolveDpr("sleep") <= 1);
assert.ok(resolveDpr("high", { reducedMotion: true, maxDpr: 3 }) <= 1.25);
assert.ok(resolveDpr("high", { embedded: true, maxDpr: 3 }) <= 1.5);

// — Frame governor demotes under jank, promotes when smooth —
assert.equal(tierFromFrameMs(32, "high"), "low");
assert.equal(tierFromFrameMs(22, "high"), "medium");
assert.equal(tierFromFrameMs(12, "medium"), "high");
assert.equal(tierFromFrameMs(22, "low"), "low", "hysteresis: stay low until clearly recovered");

const hi = detailForTier("high");
const lo = detailForTier("low");
assert.ok(hi.particles > lo.particles);
assert.ok(hi.simHz > lo.simHz);

const gov = createFrameGovernor("high");
assert.equal(gov.tier(), "high");
gov.force("sleep");
assert.equal(gov.tier(), "sleep");
gov.beginFrame(1000);
gov.beginFrame(1040); // 40ms frame
// not enough samples to retier yet — still forced sleep until retier window
assert.equal(gov.tier(), "sleep");

// — Idle writer coalesces and flush forces a write —
let writes = 0;
const w = createIdleWriter(() => {
  writes += 1;
}, 10);
w.schedule();
w.schedule();
w.schedule();
assert.equal(writes, 0, "writes are deferred");
w.flush();
assert.equal(writes, 1, "flush collapses to one write");
w.cancel();

// — Peer circles: cabinet at the drop, shore, meadow, peak, hearth, sky —
assert.ok(PEER_CIRCLES.length >= 6);
assert.equal(peerCircleForRoute("/drop")?.id, "cabinet");
assert.ok(peersOf("/drop").some((r) => r.key === "seed"));
assert.ok(peersOf("/drop").some((r) => r.key === "coin"));
assert.ok(peersOf("/drop").some((r) => r.key === "tourbillon"));
assert.equal(nextPeer("/drop", 1)?.key, "seed");
assert.equal(nextPeer("/seed", -1)?.key, "drop");
assert.equal(peerCircleForRoute("/ocean")?.id, "shore");
assert.equal(peerCircleForRoute("/sine")?.id, "shore");
assert.equal(peerCircleForRoute("/coast")?.id, "shore");
assert.equal(peerCircleForRoute("/mountain")?.id, "peak");
assert.equal(peerCircleForRoute("/storm")?.id, "peak");
assert.equal(peerCircleForRoute("/clouds")?.id, "peak");
assert.equal(peerCircleForRoute("/fire")?.id, "hearth");
assert.equal(peerCircleForRoute("/stars")?.id, "sky");
assert.ok(peersOf("/flowers").some((r) => r.key === "birds"));
assert.ok(peersOf("/flowers").some((r) => r.key === "growth"));
assert.equal(peerCircleForRoute("/colophon"), null);
assert.equal(peerCircleForRoute("/guide"), null);

console.log("test-room-runtime: ok");
