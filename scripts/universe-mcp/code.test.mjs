// Code lane law: the leash holds against path tricks, limits and races, the token never leaks.
import assert from "node:assert/strict";
import * as ts from "typescript";
import { loadTsModule } from "../lib/load-ts.mjs";

const P = loadTsModule("src/lib/universe-mcp/code-policy.ts");
const G = loadTsModule("src/lib/universe-mcp/code-github.ts");
const { createCodeTools, defaultCheckSyntax } = loadTsModule("src/lib/universe-mcp/tools-code.ts");
const T = (r) => r.content[0].text;
const denied = (v) => v.ok === false;

// ---- path attacks: every one must be refused for write; sensitive ones for read too
const attacks = [
  "../etc/passwd", "src/../../etc/passwd", "..%2fetc/passwd", "%2e%2e/secret", "src/%2e%2e/.github/x", "./src/../.github/workflows/x.yml",
  "SRC/LIB/UNIVERSE-MCP/CODE-POLICY.ts", "src//lib/universe-mcp/auth.ts", "src/./lib/universe-mcp/protocol.ts", "/etc/passwd", "/src/lib/x.ts",
  "C:/windows/x.ts", "src\\lib\\universe-mcp\\auth.ts", "src/lib/a.ts\u0000.md", "src/lib/a\u0000.ts", "\uff0e\uff0e/etc/passwd",
  "src/\uff0e\uff0e/.github/x.yml", "src/lib/universe-mcp/code-policy.ts.", "src/lib/universe-mcp/code-policy.ts ", ".env", ".ENV", ".env.local", "src/.env",
  "src/.env.production", "docs/.env", ".github/workflows/deploy.yml", ".GITHUB/workflows/x.yml", "railway.json", "RAILWAY.JSON", "package.json", "package-lock.json",
  "src/package.json", "next.config.js", "next.config.mjs", "doppler.yaml", "AGENTS.md", "agents.md", "CLAUDE.md", "INSPIRATION.md", "docs/AGENTS.md",
  "src/lib/universe-mcp/code-github.ts", "src/lib/universe-mcp/code-fs.ts", "src/lib/universe-mcp/tools-code.ts", "src/lib/universe-mcp/auth.ts",
  "src/lib/universe-mcp/protocol.ts", "src/lib/universe-mcp/serve.ts", "src/lib/universe-mcp/index.ts", "src/app/api/mcp/route.ts", "src/app/api/mcp/i/[code]/route.ts",
  "src/app/api/universe/bridge/route.ts", "src/app/api/MCP/route.ts", "src/lib/x.exe", "src/lib/x.png", "public/a.png", "public/a.js.map", "scripts/build.mjs",
  "scripts/deploy.sh", "scripts/universe-mcp/code.test.mjs", "node_modules/x/index.js", "src/node_modules/x.ts", ".git/config", "src/.git/x.ts", "README.md",
  "packages/x/index.ts", "src", "", "   ", "src/lib/", "a".repeat(400),
];
for (const a of attacks) assert.ok(denied(P.writePolicy(a)), `write policy let through ${JSON.stringify(a)}`);
const readAttacks = [
  "../etc/passwd", "..%2fetc/passwd", "/etc/passwd", "src\\..\\.env", ".env", ".env.local", "src/.env", "\uff0e\uff0e/.env", ".git/config", "src/.git/HEAD",
  "node_modules/typescript/package.json", "src/node_modules/x.js", ".next/server/x.js", "doppler.yaml", ".universe-data/store.json", "packages/x/.env.local",
  "next.config.mjs", "railway.json", "src/a.pem", "public/a.png", "src/a\u0000.ts", "src/lib/x.ts.", ".ENV", "src/../.env", "Dockerfile", "src/lib/x", "id_rsa",
];
for (const a of readAttacks) assert.ok(denied(P.readPolicy(a)), `read policy let through ${JSON.stringify(a)}`);

// ---- the leash holds by stem: Next resolves .js/.mjs before .ts, and a file route outranks the /mcp rewrite
for (const a of [
  "src/lib/universe-mcp/auth.js", "src/lib/universe-mcp/auth.mjs", "src/lib/universe-mcp/auth.tsx", "src/lib/universe-mcp/protocol.js", "src/lib/universe-mcp/code-policy.js",
  "src/lib/universe-mcp/code-github.mjs", "src/lib/universe-mcp/tools-code.tsx", "src/lib/universe-mcp/index.js", "src/lib/universe-mcp/types.tsx", "src/lib/universe-mcp/serve.mjs",
  "src/lib/universe-mcp/code/index.ts", "src/lib/universe-mcp/Auth.JS", "src/app/mcp/route.ts", "src/app/mcp/i/[code]/route.ts", "src/app/MCP/route.ts", "src/middleware.ts", "src/middleware.js", "src/instrumentation.ts",
]) assert.ok(denied(P.writePolicy(a)), `leash shadow let through ${a}`);

// ---- allowed paths stay allowed (a policy that denies everything is also a bug)
for (const a of ["src/lib/x.ts", "src/components/Foo.tsx", "docs/notes.md", "public/a.svg", "public/x/y.json", "scripts/test-foo.mjs", "scripts/universe-mcp/foo.test.mjs", "src/app/page.tsx", "./src//lib/./y.ts", "src/lib/universe-mcp/tools-explore.ts", "src/app/api/other/route.ts"]) {
  assert.ok(P.writePolicy(a).ok, `write policy blocked legitimate ${a}`);
}
for (const a of ["src/lib/x.ts", "README.md", "package.json", "AGENTS.md", "docs/universe-mcp.md", "scripts/lib/load-ts.mjs", "packages/objet-universe-kit/package.json", "public/a.svg", "src/lib/universe-mcp/auth.ts"]) {
  assert.ok(P.readPolicy(a).ok, `read policy blocked legitimate ${a}`);
}
assert.equal(P.writePolicy("./src//lib/./y.ts").path, "src/lib/y.ts", "path was not canonicalised before use");
assert.ok(denied(P.readPolicy("public/a.js.map")) && denied(P.readPolicy("README.txt")), "unlisted root or ext readable");
assert.ok(P.writePolicy("scripts/test-a.mjs").ok && denied(P.writePolicy("scripts/sub/test-a.mjs")), "scripts write must be test files only, at the listed depth");

// ---- slicing and regex risk
const big = Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`).join("\n");
const s1 = P.sliceLines(big);
assert.equal(s1.to, 400, "400 line cap missing");
assert.equal(s1.next, 401, "next-offset hint wrong");
assert.equal(P.sliceLines(big, 401, 405).text, "line 401\nline 402\nline 403\nline 404\nline 405", "start/end ignored");
assert.equal(P.sliceLines("a\nb\n").total, 2, "trailing newline counted as a line");
const wide = P.sliceLines(Array.from({ length: 300 }, () => "x".repeat(1000)).join("\n"));
assert.ok(Buffer.byteLength(wide.text) <= 200 * 1024 && wide.next !== null, "200 KB cap missing");
for (const r of [".*.*.*.*Q", "\\w*\\w*\\w*\\w*x", "a{1,}b{1,}c{1,}d{1,}e", "[a-z]{0,300}[a-z]{0,300}[a-z]{0,300}[a-z]{0,300}!", "(a+)+$", "(a|aa)+b", "(a*)*", "(.*a){9}x*", "(x+x+)+y", "(a+)*b", "(\\w+\\s?)*$", "(a)\\1", "a".repeat(101), "a*b*c*d*e*f*g*"]) {
  assert.ok(P.regexRisk(r), `regex ${r} would be allowed to run: catastrophic backtracking`);
}
for (const r of ["foo\\(bar\\)", "[a-z]+\\d{2,3}", "export (const|function) \\w+", "(abc)+", "\\[(x+)\\]"]) assert.equal(P.regexRisk(r), null, `safe regex ${r} refused`);

// ---- glob: a pile of wildcards is a backtracking bomb; it must be refused, and the wildcards that remain must stay cheap
assert.equal(P.globToRegExp("**/".repeat(30) + "Q"), null, "glob with dozens of ** accepted");
{
  const run = P.globToRegExp("**".repeat(30) + "Q");
  const t0 = Date.now();
  run?.test("src/components/rooms/ManifoldAtlasRoomView.ts");
  assert.ok(Date.now() - t0 < 500, "a run of stars must collapse to one wildcard");
}
assert.equal(P.globToRegExp("*a".repeat(30) + "Q"), null, "glob with dozens of * accepted");
assert.ok(P.globToRegExp("src/**/rooms/*.tsx") && P.globToRegExp("**/*.md")?.test("docs/a.md"), "ordinary globs refused");
{
  const g = P.globToRegExp("**/*/*/*/x");
  const t0 = Date.now();
  g?.test("src/components/rooms/ManifoldAtlasRoomView.ts");
  assert.ok(Date.now() - t0 < 500, "four-wildcard glob is not cheap");
}
{
  const m = P.buildMatcher("/.*.*.*Q/");
  assert.ok(m.ok, "three open-ended repeats should still run");
  const t0 = Date.now();
  m.test("  const registry = buildRoomRegistry(rooms, { scale: 'log', bands: 12 }); // stays deterministic".repeat(3).slice(0, 200));
  assert.ok(Date.now() - t0 < 1500, "three-repeat regex on a 200-char line is not cheap");
  assert.ok(!P.buildMatcher("/.*.*.*.*Q/").ok, "four open-ended repeats accepted");
}

// ---- fake checkout, fake github
const files = new Map([
  ["src/lib/a.ts", "export const a = 1;\nexport const b = 2;\n"],
  ["src/lib/secret.env.ts", "export const NEEDLE = 'x';\n"],
  ["src/.env", "NEEDLE=leaked\n"],
  ["src/a.png", "NEEDLE"],
  ["node_modules/x/i.js", "NEEDLE\n"],
  [".env", "NEEDLE=leaked\n"],
  ["docs/d.md", "hello NEEDLE world\n"],
  ["README.md", "NEEDLE root\n"],
  ["src/huge.ts", "x".repeat(401 * 1024)],
]);
const dirs = new Set(["src", "src/lib", "node_modules", "node_modules/x", "docs"]);
const fsx = {
  stat: (p) => (files.has(p) ? { size: Buffer.byteLength(files.get(p)), file: true, dir: false } : dirs.has(p) ? { size: 0, file: false, dir: true } : null),
  read: (p) => files.get(p) ?? null,
  readdir: (d) => {
    const pre = d ? d + "/" : "";
    const out = new Set();
    for (const k of [...files.keys(), ...dirs]) if (k.startsWith(pre) && k !== d) out.add(k.slice(pre.length).split("/")[0]);
    return [...out].sort();
  },
};
const TOKEN = "ghp_SECRETTOKEN1234567890abcdef";
let clock = 1_000_000;
const mkGh = (script = {}) => {
  const calls = [];
  const fetch = async (url, init) => {
    const path = url.replace("https://api.github.com/repos/o/r", "");
    const key = `${init.method} ${path}`;
    calls.push({ key, body: init.body ? JSON.parse(init.body) : null, auth: init.headers.Authorization });
    const h = script[key];
    const r = typeof h === "function" ? h(calls.filter((c) => c.key === key).length) : h;
    if (r) return { status: r[0], text: async () => JSON.stringify(r[1]) };
    const dflt = {
      "GET /git/ref/heads/universe": [200, { object: { sha: "h0" } }],
      "GET /git/commits/h0": [200, { tree: { sha: "t0" } }],
      "POST /git/blobs": [201, { sha: "b" + calls.length }],
      "POST /git/trees": [201, { sha: "t1" }],
      "POST /git/commits": [201, { sha: "c1" }],
      "PATCH /git/refs/heads/universe": [200, {}],
    }[key];
    if (!dflt) return { status: 500, text: async () => `no script for ${key}` };
    return { status: dflt[0], text: async () => JSON.stringify(dflt[1]) };
  };
  return { fetch, calls };
};
const mk = (gh, extra = {}) => {
  const tools = createCodeTools({ getFs: async () => fsx, fetch: gh?.fetch, checkSyntax: defaultCheckSyntax, limiter: P.createCommitLimiter(), ...extra });
  return (name, args, ctx = {}) => tools.find((t) => t.name === name).handler(args, { now: () => clock, authed: true, ip: "", bound: null, env: { UNIVERSE_GITHUB_REPO: "o/r", UNIVERSE_GITHUB_TOKEN: TOKEN }, ...ctx });
};

assert.deepEqual(createCodeTools({ getFs: async () => fsx }).map((t) => `${t.name}:${t.access}`), ["world_read:open", "world_search:open", "world_patch:write"]);

// ---- world_read
{
  const call = mk(mkGh());
  assert.match(T(await call("world_read", { path: "src/lib/a.ts" })), /export const a = 1;/);
  for (const p of ["src/.env", ".env", "../x", "node_modules/x/i.js", "src/huge.ts", "src/a.png", "src/missing.ts"]) {
    const r = await call("world_read", { path: p });
    assert.ok(r.isError, `world_read served ${p}`);
    assert.ok(!/leaked/.test(T(r)), "env content leaked");
  }
  assert.match(T(await call("world_read", { path: "src/lib/a.ts", start: 2, end: 2 })), /export const b = 2;/);
}

// ---- world_search
{
  const call = mk(mkGh());
  const r = T(await call("world_search", { query: "NEEDLE" }));
  assert.ok(r.includes("docs/d.md:1:") && r.includes("README.md:1:") && r.includes("src/lib/secret.env.ts:1:"), "search misses readable files");
  assert.ok(!/leaked|node_modules|src\/\.env|a\.png|huge/.test(r), "search reached a denied path");
  assert.ok(!T(await call("world_search", { query: "NEEDLE", glob: "docs/**" })).includes("README"), "glob ignored");
  assert.match(T(await call("world_search", { query: "/NEED[A-Z]+E/" })), /docs\/d\.md/);
  assert.ok((await call("world_search", { query: "/(a+)+$/" })).isError, "catastrophic regex accepted");
  assert.ok((await call("world_search", { query: "/(/" })).isError, "bad regex not an error");
  assert.ok((await call("world_search", { query: "" })).isError, "empty query accepted");
  for (let i = 0; i < 80; i++) files.set(`src/lib/many${i}.ts`, "HITME\n");
  const many = T(await call("world_search", { query: "HITME" })).split("\n").filter((l) => l.includes("HITME"));
  assert.equal(many.length, 50, "hit cap is not 50");
  for (let i = 0; i < 80; i++) files.delete(`src/lib/many${i}.ts`);
  let t = 0;
  const slow = mk(mkGh(), {});
  const budget = T(await slow("world_search", { query: "zzzz-none" }, { now: () => (t += 3000) }));
  assert.match(budget, /budget/, "search has no time budget");
  // files a glob skips still spend the budget; a glob cannot make the walk free
  t = 0;
  const skipped = T(await slow("world_search", { query: "zzzz-none", glob: "nomatch/**" }, { now: () => (t += 3000) }));
  assert.match(skipped, /budget/, "glob-skipped files were free");
  // the clock is also read between lines, not only between files
  files.set("docs/lines.md", Array.from({ length: 30 }, () => "HITLINE").join("\n"));
  t = 0;
  const lineBudget = T(await slow("world_search", { query: "HITLINE", glob: "docs/lines.md" }, { now: () => (t += 3000) }));
  assert.ok(/budget/.test(lineBudget) && lineBudget.split("\n").filter((l) => l.includes("HITLINE")).length < 30, "no time check between lines");
  files.delete("docs/lines.md");
  assert.ok((await call("world_search", { query: "NEEDLE", glob: "**/".repeat(30) + "Q" })).isError, "glob bomb accepted by the tool");
}

// ---- syntax checker: never silently passes
assert.match(await defaultCheckSyntax("src/x.ts", "const = ;"), /unchecked/, "missing typescript must say unchecked, not ok");
{
  const withTs = loadTsModule("src/lib/universe-mcp/tools-code.ts", { requireMap: { typescript: ts } });
  assert.match(await withTs.defaultCheckSyntax("src/x.ts", "const = ;"), /^error/, "syntax error not caught");
  assert.equal(await withTs.defaultCheckSyntax("src/x.ts", "export const x: number = 1;"), "ok");
  assert.equal(await withTs.defaultCheckSyntax("public/x.md", "###"), "n/a");
  assert.match(await withTs.defaultCheckSyntax("docs/x.json", "{bad"), /^error/, "bad json passes");
}

// ---- world_patch: dry run
const goodFile = { path: "src/lib/new.ts", content: "export const n = 1;\n" };
const msg = "add a small constant module";
{
  const gh = mkGh();
  const call = mk(gh);
  const r = await call("world_patch", { instance: "w18sdely0a62ke", files: [goodFile, { path: "src/lib/a.ts", content: "export const a = 9;\n" }, { path: "src/lib/a.ts".replace("a", "b"), content: "1" }], message: msg });
  assert.ok(!r.isError && /dry run/.test(T(r)), "dry_run must default to true when omitted");
  assert.equal(gh.calls.length, 0, "dry run touched the network");
  assert.match(T(r), /src\/lib\/new\.ts: new/);
  assert.match(T(r), /src\/lib\/a\.ts: changed/);
  assert.match(T(r), /src\/lib\/b\.ts: new/);
  const same = T(await call("world_patch", { instance: "w18sdely0a62ke", files: [{ path: "src/lib/a.ts", content: files.get("src/lib/a.ts") }], message: msg }));
  assert.match(same, /: same/);
  assert.match(same, /nothing would change/);
  const bad = T(await call("world_patch", { instance: "w18sdely0a62ke", files: [{ path: "src/lib/universe-mcp/auth.ts", content: "x" }, goodFile], message: msg }));
  assert.match(bad, /denied\(/);
  assert.match(bad, /would be refused/);
  const syn = T(await call("world_patch", { instance: "w18sdely0a62ke", files: [{ path: "docs/x.json", content: "{nope" }], message: msg }));
  assert.match(syn, /syntax error/, "dry run passed bad json");
  assert.match(syn, /syntax unchecked|syntax error/);
  assert.match(T(await call("world_patch", { instance: "w18sdely0a62ke", files: [goodFile], message: msg })), /syntax unchecked/, "unavailable checker must be reported in the report");
  assert.ok(!T(r).includes(TOKEN));
}

// ---- world_patch: argument limits
{
  const call = mk(mkGh());
  const base = { instance: "w18sdely0a62ke", files: [goodFile], message: msg };
  assert.ok((await call("world_patch", { ...base, files: Array.from({ length: 6 }, (_, i) => ({ path: `src/lib/f${i}.ts`, content: "1" })) })).isError, "6 files accepted");
  assert.ok(!(await call("world_patch", { ...base, files: Array.from({ length: 5 }, (_, i) => ({ path: `src/lib/f${i}.ts`, content: "1" })) })).isError, "5 files refused");
  assert.match(T(await call("world_patch", { ...base, files: [{ path: "src/lib/big.ts", content: "x".repeat(200 * 1024 + 1) }] })), /larger than 200 KB/);
  assert.ok(!/larger than 200/.test(T(await call("world_patch", { ...base, files: [{ path: "src/lib/big.ts", content: "x".repeat(200 * 1024) }] }))), "exactly 200 KB refused");
  for (const m of ["short", "x".repeat(201), "two\nlines here", "cr\rline here", "", null, 42]) assert.ok((await call("world_patch", { ...base, message: m })).isError, `message ${JSON.stringify(m)} accepted`);
  assert.ok(!(await call("world_patch", { ...base, message: "12345678" })).isError, "8-char message refused");
  for (const i of ["", "BAD", "short", "x".repeat(17), "has space1", undefined]) assert.ok((await call("world_patch", { ...base, instance: i })).isError, `instance ${i} accepted`);
  assert.ok((await call("world_patch", { ...base, files: [goodFile, goodFile] })).isError, "duplicate path accepted");
  assert.ok((await call("world_patch", { ...base, files: [{ path: "src/lib/n.ts", content: 5 }] })).isError, "non-string content accepted");
  assert.ok((await call("world_patch", base, { authed: false })).isError, "unauthed handler call succeeded");
}

// ---- world_patch: commit sequence, side branch, force:false, token hygiene
const seq = (gh) => gh.calls.map((c) => c.key);
const args = { instance: "w18sdely0a62ke", files: [goodFile], message: msg, dry_run: false };
{
  const gh = mkGh();
  const r = await mk(gh)("world_patch", args);
  assert.ok(!r.isError, T(r));
  assert.deepEqual(seq(gh), ["GET /git/ref/heads/universe", "GET /git/commits/h0", "POST /git/blobs", "POST /git/trees", "POST /git/commits", "PATCH /git/refs/heads/universe"], "commit call sequence");
  const patch = gh.calls.at(-1);
  assert.equal(patch.body.force, false, "ref update must be force:false");
  assert.equal(patch.body.sha, "c1");
  assert.equal(gh.calls[3].body.base_tree, "t0", "tree not built on the head tree");
  assert.deepEqual(gh.calls[4].body.parents, ["h0"]);
  assert.match(gh.calls[4].body.message, /^universe\(w18sdely0a62ke\): add a small constant module\n\nAuthored-by: a lattice animal via the objet d'art MCP$/);
  assert.equal(gh.calls[2].body.content, goodFile.content);
  assert.ok(gh.calls.every((c) => c.key.split(" ")[0] !== "DELETE" && c.key.split(" ")[0] !== "PUT"), "only additive verbs");
  assert.match(T(r), /c1/); assert.match(T(r), /github\.com\/o\/r\/commit\/c1/); assert.match(T(r), /branch: universe/);
  assert.match(T(r), /side branch; the owner merges it/);
  assert.ok(!T(r).includes("redeploys"), "side branch claimed a redeploy");
  assert.match(T(r), /Warning: syntax was NOT checked for src\/lib\/new\.ts/, "a commit of unchecked code must say so");
  assert.ok(gh.calls.every((c) => c.auth === `Bearer ${TOKEN}`), "token not sent to github");
}
{ // side branch is created from the default branch when missing
  const gh = mkGh({
    "GET /git/ref/heads/universe": [404, { message: "Not Found" }],
    "GET ": [200, { default_branch: "trunk" }],
    "GET /git/ref/heads/trunk": [200, { object: { sha: "h0" } }],
    "POST /git/refs": [201, {}],
  });
  const r = await mk(gh)("world_patch", args);
  assert.ok(!r.isError, T(r));
  assert.deepEqual(seq(gh).slice(0, 5), ["GET /git/ref/heads/universe", "GET ", "GET /git/ref/heads/trunk", "POST /git/refs", "GET /git/commits/h0"]);
  assert.deepEqual(gh.calls[3].body, { ref: "refs/heads/universe", sha: "h0" });
  assert.match(T(r), /created from the default branch/);
}
{ // branch comes from env only; main says redeploy
  const gh = mkGh({ "GET /git/ref/heads/main": [200, { object: { sha: "h0" } }], "PATCH /git/refs/heads/main": [200, {}] });
  const r = await mk(gh)("world_patch", { ...args, branch: "evil", ref: "evil", UNIVERSE_CODE_BRANCH: "evil" }, { env: { UNIVERSE_GITHUB_REPO: "o/r", UNIVERSE_GITHUB_TOKEN: TOKEN, UNIVERSE_CODE_BRANCH: "main" } });
  assert.ok(!r.isError, T(r));
  assert.ok(seq(gh).includes("PATCH /git/refs/heads/main") && !seq(gh).some((k) => k.includes("evil")), "branch taken from arguments");
  assert.match(T(r), /the host redeploys from it; a failed build leaves the previous deploy serving/);
  const gh2 = mkGh();
  await mk(gh2)("world_patch", { ...args, branch: "main" });
  assert.ok(seq(gh2).every((k) => !k.includes("heads/main")), "args.branch changed the target");
}
{ // a bad env branch or repo is refused before any call
  const gh = mkGh();
  for (const env of [{ UNIVERSE_CODE_BRANCH: "../x" }, { UNIVERSE_CODE_BRANCH: "a b" }, { UNIVERSE_GITHUB_REPO: "evil/../x/y" }, { UNIVERSE_GITHUB_REPO: "a b/c" }]) {
    const r = await mk(gh)("world_patch", args, { env: { UNIVERSE_GITHUB_REPO: "o/r", UNIVERSE_GITHUB_TOKEN: TOKEN, ...env } });
    assert.ok(r.isError, `env ${JSON.stringify(env)} accepted`);
  }
  assert.equal(gh.calls.length, 0);
}
{ // unarmed
  const gh = mkGh();
  const r = await mk(gh)("world_patch", args, { env: { UNIVERSE_GITHUB_REPO: "o/r" } });
  assert.ok(r.isError && /not armed/.test(T(r)) && /UNIVERSE_GITHUB_TOKEN/.test(T(r)));
  assert.equal(gh.calls.length, 0);
}
{ // the token never appears, even when github echoes it
  const gh = mkGh({ "POST /git/blobs": [401, { message: `Bad credentials for ${TOKEN} and Bearer ${TOKEN} also ghp_ANOTHERSECRET99` }] });
  const r = await mk(gh)("world_patch", args);
  assert.ok(r.isError);
  assert.ok(!T(r).includes(TOKEN) && !T(r).includes("ANOTHERSECRET"), "token leaked through an error body");
  const thrower = mk({ fetch: async () => { throw new Error(`connect failed with ${TOKEN}`); }, calls: [] });
  const r2 = await thrower("world_patch", args);
  assert.ok(r2.isError && !T(r2).includes(TOKEN), "token leaked through a thrown error");
  const dry = T(await mk(gh)("world_patch", { ...args, dry_run: true }));
  assert.ok(!dry.includes(TOKEN));
  assert.ok(!G.scrub(`x ${TOKEN} y`, TOKEN).includes(TOKEN));
}
{ // ref race: retry once then succeed; twice then give up, no force ever
  const race = (n) => (i) => (i <= n ? [409, { message: "Update is not a fast forward" }] : [200, {}]);
  const gh = mkGh({ "PATCH /git/refs/heads/universe": race(1) });
  const r = await mk(gh)("world_patch", args);
  assert.ok(!r.isError, T(r));
  assert.equal(seq(gh).filter((k) => k.startsWith("PATCH")).length, 2, "must retry once");
  assert.equal(seq(gh).filter((k) => k === "GET /git/ref/heads/universe").length, 2, "retry must refetch the ref");
  assert.ok(gh.calls.filter((c) => c.body && "force" in c.body).every((c) => c.body.force === false));
  const gh2 = mkGh({ "PATCH /git/refs/heads/universe": (i) => [422, { message: "not fast forward" }] });
  const r2 = await mk(gh2)("world_patch", args);
  assert.ok(r2.isError && /moved/.test(T(r2)), "second race must give up honestly");
  assert.equal(seq(gh2).filter((k) => k.startsWith("PATCH")).length, 2, "retried more than once");
}

// ---- rate limits: 1 per 5 min per instance, 6 per hour overall (ctx.now only)
{
  const gh = mkGh();
  const call = mk(gh);
  const at = (t, inst = "w18sdely0a62ke", n = 0) => { clock = t; return call("world_patch", { ...args, instance: inst, files: [{ path: `src/lib/r${n}.ts`, content: `export const r = ${n};\n` }] }); };
  assert.ok(!(await at(0)).isError);
  const early = await at(299_000, "w18sdely0a62ke", 1);
  assert.ok(early.isError && /5 minutes/.test(T(early)), "second commit inside 5 minutes allowed");
  assert.ok(!(await at(300_000, "w18sdely0a62ke", 2)).isError, "commit after 5 minutes refused");
  assert.match(T(await call("world_patch", { ...args, dry_run: true, files: [goodFile] })), /5 minutes/, "dry run does not report the limit");
  for (let i = 0; i < 4; i++) assert.ok(!(await at(400_000 + i, `worldnumber${i}00`, 10 + i)).isError, `global commit ${i}`);
  const sixth = await at(500_000, "worldnumberzzz1", 20);
  assert.ok(sixth.isError && /universe/.test(T(sixth)), "7th commit inside an hour allowed");
  assert.ok(!(await at(500_000 + 3600_000, "worldnumberzzz1", 21)).isError, "limit did not lift after an hour");
  const failed = mkGh({ "POST /git/blobs": [500, {}] });
  const c2 = mk(failed);
  clock = 0;
  await c2("world_patch", args);
}
console.log("code lane: ok");
