// Universe MCP protocol law. Plain node, no browser. Every assertion names a
// bug a plausible edit would introduce.
import assert from "node:assert/strict";
import { loadTsModule } from "../lib/load-ts.mjs";

const { handleRpc, toolsFor, createLimiter, text, MCP_VERSIONS } = loadTsModule("src/lib/universe-mcp/protocol.ts");
const { isAuthed, bearerOf } = loadTsModule("src/lib/universe-mcp/auth.ts");
const { ALL_TOOLS, makeCtx } = loadTsModule("src/lib/universe-mcp/index.ts");

const ctx = (over = {}) => ({ now: () => 0, authed: false, ip: "1.2.3.4", env: {}, bound: null, ...over });
const rpc = (msg, c = ctx(), tools = ALL_TOOLS) => handleRpc(msg, { tools, ctx: c });

// a notification is acknowledged, never answered (a reply would break clients)
assert.deepEqual(await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }), { status: 202, body: null });
// batches are refused rather than half-handled
assert.equal((await rpc([{ jsonrpc: "2.0", id: 1, method: "ping" }])).status, 400);
// initialize negotiates down to a version we speak
assert.equal((await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } })).body.result.protocolVersion, MCP_VERSIONS[0]);
assert.equal((await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })).body.result.protocolVersion, "2025-06-18");

// the front door is always there
const list = (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })).body.result.tools;
assert.ok(list.some((t) => t.name === "universe_about"));
const about = (await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "universe_about", arguments: {} } })).body.result;
assert.match(about.content[0].text, /universe_open/);

// unknown tool is a protocol error, not a crash
assert.equal((await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope" } })).body.error.code, -32602);

// write tools are refused without the token and run with it
const writeTool = { name: "w", description: "d", access: "write", inputSchema: { type: "object", properties: {} }, handler: () => text("did it") };
const denied = (await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "w" } }, ctx(), [writeTool])).body.result;
assert.equal(denied.isError, true);
const allowed = (await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "w" } }, ctx({ authed: true }), [writeTool])).body.result;
assert.equal(allowed.content[0].text, "did it");
assert.match(toolsFor([writeTool], null)[0].description, /write token/);

// a bound endpoint injects the instance and hides the argument
const echo = { name: "e", description: "d", access: "open", inputSchema: { type: "object", properties: { instance: { type: "string" }, x: { type: "string" } }, required: ["instance", "x"] }, handler: (a) => text(String(a.instance)) };
assert.deepEqual(toolsFor([echo], "abcdefgh12")[0].inputSchema.required, ["x"]);
assert.equal("instance" in toolsFor([echo], "abcdefgh12")[0].inputSchema.properties, false);
const bound = (await rpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "e", arguments: { x: "1", instance: "someoneelse" } } }, ctx({ bound: "abcdefgh12" }), [echo])).body.result;
assert.equal(bound.content[0].text, "abcdefgh12", "a bound world cannot be redirected to another by an argument");

// a throwing handler becomes a tool error, not a 500
const boom = { ...echo, name: "b", handler: () => { throw new Error("x"); } };
assert.equal((await rpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "b" } }, ctx(), [boom])).body.result.isError, true);

// auth: unset or short token means write tools are off, even for an empty bearer
assert.equal(isAuthed("Bearer whatever", undefined), false);
assert.equal(isAuthed("Bearer short", "short"), false);
const T = "a".repeat(32);
assert.equal(isAuthed(`Bearer ${T}`, T), true);
assert.equal(isAuthed(`Bearer ${T}x`, T), false);
assert.equal(isAuthed(`Bearer ${T.slice(0, 31)}`, T), false);
assert.equal(isAuthed(null, T), false);
assert.equal(bearerOf("bearer  abc "), "abc");
const req = (h) => ({ headers: { get: (k) => h[k.toLowerCase()] ?? null } });
assert.equal(makeCtx(req({ authorization: `Bearer ${T}` }), { UNIVERSE_WRITE_TOKEN: T }, null).authed, true);
// a spoofed leading x-forwarded-for entry must not choose the rate-limit bucket
assert.equal(makeCtx(req({ "x-forwarded-for": "9.9.9.9, 1.1.1.1" }), {}, null).ip, "1.1.1.1");
assert.equal(makeCtx(req({ "x-forwarded-for": "9.9.9.9, 1.1.1.1", "x-real-ip": "2.2.2.2" }), {}, null).ip, "2.2.2.2");

// limiter counts per address and forgets after a minute
let t = 0;
const lim = createLimiter(2, () => t);
assert.deepEqual([lim("a"), lim("a"), lim("a"), lim("b")], [false, false, true, false]);
t = 61000;
assert.equal(lim("a"), false);

console.log("universe-mcp protocol: ok");
