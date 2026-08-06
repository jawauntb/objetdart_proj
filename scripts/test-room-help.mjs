// The `?` in the site chrome (src/components/RoomHelp.tsx) is the one surface
// that explains, and AGENTS.md permits it on exactly one condition: it is a
// *mirror* of /guide, never a second copy of it. These assertions are what
// keeps that true. Each names the bug it catches:
//
//   §1  a room ships and its `?` opens onto nothing (no guide entry).
//   §2  the resolver is partial or ambiguous — a route falls through to a
//       neighbour's entry, or to none.
//   §3  a page exists that the `?` cannot answer for, and is not a declared
//       reading-through surface.
//   §4  someone types a sentence about a room into the component, and the
//       modal quietly forks from the guide.
//   §5  the component stops rendering the guide's own fields at all.
//   §6  the control is un-mounted, or re-mounted inside a room where Chrome's
//       stacking context swallows its clicks (the bug <LetGo> exists to fix).

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const rootUrl = new URL("../", import.meta.url);

function readRepoFile(path) {
  return readFileSync(new URL(path, rootUrl), "utf8");
}

const moduleCache = new Map();

function loadTsModule(path) {
  if (moduleCache.has(path)) return moduleCache.get(path);
  const filename = fileURLToPath(new URL(path, rootUrl));
  const code = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  const requireShim = (id) => {
    if (id.startsWith("@/")) return loadTsModule(`src/${id.slice(2)}.ts`);
    throw new Error(`Unexpected require(${id}) while loading ${path}`);
  };
  new Function("module", "exports", "require", code)(module, module.exports, requireShim);
  moduleCache.set(path, module.exports);
  return module.exports;
}

const { SITE_ROUTES } = loadTsModule("src/lib/routes.ts");
const { GUIDE_ROOMS, GUIDE_ROOM_BY_KEY, GUIDE_GLOBAL_BINDINGS } = loadTsModule("src/data/guide.ts");
const { guideKeyForPath, HOME_GUIDE_KEY } = loadTsModule("src/lib/guide-route.ts");

const HELP_PATH = "src/components/RoomHelp.tsx";
const helpSource = readRepoFile(HELP_PATH);

// ---------------------------------------------------------------------------
// §1 every registered route resolves to exactly one guide entry
// ---------------------------------------------------------------------------

for (const route of SITE_ROUTES) {
  const key = guideKeyForPath(route.href);
  assert.ok(
    key,
    `${route.href}: the help control resolves no guide key — a room shipped with a "?" that opens onto nothing`,
  );
  assert.ok(
    GUIDE_ROOM_BY_KEY[key],
    `${route.href}: resolves to "${key}", which is not a GUIDE_ROOMS entry`,
  );
}

// the threshold is a guide room without a registry row, and it must stay one
assert.equal(guideKeyForPath("/"), HOME_GUIDE_KEY, "the threshold must resolve to its own entry");
assert.ok(GUIDE_ROOM_BY_KEY[HOME_GUIDE_KEY], "the threshold's guide entry must exist");

// the lookup half is total over the entries it claims
assert.equal(
  Object.keys(GUIDE_ROOM_BY_KEY).length,
  GUIDE_ROOMS.length,
  "GUIDE_ROOM_BY_KEY must hold every entry — two rooms sharing a key would silently drop one",
);

// ---------------------------------------------------------------------------
// §2 the mapping is unambiguous, and total over dynamic children
// ---------------------------------------------------------------------------

// A route must resolve to *its own* key, never a neighbour's. /light/inverse is
// the live case: a shallower-first resolver hands it to /light's entry.
for (const route of SITE_ROUTES) {
  assert.equal(
    guideKeyForPath(route.href),
    route.key,
    `${route.href}: resolves to another room's entry — the deepest registered href must win`,
  );
  // trailing slashes, queries and hashes are the same room
  assert.equal(guideKeyForPath(`${route.href}/?x=1#y`), route.key, `${route.href}: decorated url must resolve alike`);
}

// A registry href with a child segment is a *sample* of a dynamic route
// (/atlas/origin stands for every region). Siblings it never names must still
// resolve, or the atlas opens a "?" onto nothing everywhere but one region.
for (const route of SITE_ROUTES) {
  const segments = route.href.split("/").filter(Boolean);
  if (segments.length < 2) continue;
  const sibling = `/${segments[0]}/oda-unregistered-child`;
  assert.ok(
    guideKeyForPath(sibling),
    `${sibling}: an unregistered child of ${route.href} resolves to nothing`,
  );
}

// Not everything is a room. These two surfaces are exempt by declaration:
// /compare lays two kept readings over each other and /reading/<hash> renders
// one back — neither is registered, neither has a guide entry, and the control
// must render nothing there rather than an empty shell.
const DECLARED_EXEMPT_ROUTES = ["/compare", "/reading/oda-some-hash"];
for (const route of DECLARED_EXEMPT_ROUTES) {
  assert.equal(guideKeyForPath(route), null, `${route}: declared exempt, must resolve to no entry`);
}

// ---------------------------------------------------------------------------
// §3 no page exists that the control cannot answer for
// ---------------------------------------------------------------------------

function appRoutes(dir = "src/app", prefix = "") {
  const out = [];
  const base = fileURLToPath(new URL(dir, rootUrl));
  for (const name of readdirSync(base)) {
    if (name.startsWith("_") || name === "api") continue;
    const full = `${dir}/${name}`;
    if (!statSync(fileURLToPath(new URL(full, rootUrl))).isDirectory()) continue;
    // route groups are invisible in the url; dynamic segments get a probe value
    const segment = name.startsWith("(")
      ? ""
      : name.startsWith("[")
        ? "/oda-probe-segment"
        : `/${name}`;
    const here = `${prefix}${segment}`;
    if (readdirSync(fileURLToPath(new URL(full, rootUrl))).includes("page.tsx")) out.push(here || "/");
    out.push(...appRoutes(full, here));
  }
  return out;
}

const EXEMPT_PREFIXES = ["/compare", "/reading"];
for (const route of appRoutes()) {
  if (EXEMPT_PREFIXES.some((p) => route === p || route.startsWith(`${p}/`))) continue;
  assert.ok(
    guideKeyForPath(route),
    `${route}: a page with no field-guide entry — register the room, or add it to the ` +
      `declared exemptions in this test with a reason`,
  );
}

// ---------------------------------------------------------------------------
// §4 the component writes no room-specific prose
// ---------------------------------------------------------------------------

const source = ts.createSourceFile(HELP_PATH, helpSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const literals = [];
const jsxText = [];

(function walk(node) {
  // module specifiers are plumbing, not prose: `import ... from "@/data/guide"`
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) return;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) literals.push(node.text);
  if (ts.isJsxText(node)) {
    const text = node.text.trim();
    if (text) jsxText.push(text);
  }
  node.forEachChild(walk);
})(source);

// Two hrefs the component may name. "/guide" is the link through to the full
// field guide — the whole point of the control, and nobody's room content.
// "/" is the threshold's href but also the null-pathname fallback; it is too
// generic to be evidence of a hand-written route table.
const ALLOWED_HREFS = new Set(["/guide", "/"]);

for (const room of GUIDE_ROOMS) {
  assert.ok(
    !literals.includes(room.key),
    `${HELP_PATH}: names the room key "${room.key}" as a literal — the modal must branch on no room`,
  );
  if (!ALLOWED_HREFS.has(room.href)) {
    assert.ok(
      !literals.includes(room.href),
      `${HELP_PATH}: names the route "${room.href}" — the modal must render the resolved entry, not a route table`,
    );
  }
  // room titles are the shortest room-specific prose there is; a heading typed
  // by hand instead of read from the entry shows up here first
  const title = new RegExp(`(^|[^\\w-])${room.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w-]|$)`, "i");
  for (const text of jsxText) {
    assert.ok(
      !title.test(text),
      `${HELP_PATH}: renders the literal title of "${room.key}" — render room.title instead`,
    );
  }
  // and the long-form copy, anywhere in the file, comments included
  for (const line of [room.essence, ...room.moves, ...room.finds, ...(room.keeps ? [room.keeps] : [])]) {
    assert.ok(
      !helpSource.includes(line),
      `${HELP_PATH}: contains copy from "${room.key}" — the modal is a mirror of the guide, not a fork of it`,
    );
  }
}

for (const binding of GUIDE_GLOBAL_BINDINGS) {
  assert.ok(
    !helpSource.includes(binding.meaning),
    `${HELP_PATH}: contains a global binding's copy — render GUIDE_GLOBAL_BINDINGS instead`,
  );
}

// ---------------------------------------------------------------------------
// §5 it renders the guide's own fields, from the guide's own module
// ---------------------------------------------------------------------------

assert.match(
  helpSource,
  /GUIDE_ROOM_BY_KEY/,
  `${HELP_PATH}: must resolve its entry through GUIDE_ROOM_BY_KEY`,
);
assert.match(
  helpSource,
  /GUIDE_GLOBAL_BINDINGS/,
  `${HELP_PATH}: must render the site-wide grammar from GUIDE_GLOBAL_BINDINGS`,
);
assert.match(helpSource, /guideKeyForPath/, `${HELP_PATH}: must resolve the route through the shared resolver`);
// Reading a field is not showing it: `room.finds.length` satisfied a looser
// check while the list itself had been deleted. Assert the render site.
for (const field of ["moves", "finds"]) {
  assert.match(
    helpSource,
    new RegExp(`room\\.${field}\\.map\\(`),
    `${HELP_PATH}: never maps room.${field} — a guide list the visitor can no longer see`,
  );
}
for (const field of ["title", "essence", "keeps"]) {
  assert.match(
    helpSource,
    new RegExp(`\\{room\\.${field}\\}`),
    `${HELP_PATH}: never renders room.${field} — a guide field the visitor can no longer see`,
  );
}
assert.match(
  helpSource,
  /binding\.gesture[\s\S]{0,400}binding\.meaning/,
  `${HELP_PATH}: the "anywhere" section must render both halves of each global binding`,
);

// ---------------------------------------------------------------------------
// §6 it is mounted site-wide, and portalled out of the room's stacking context
// ---------------------------------------------------------------------------

const layout = readRepoFile("src/app/layout.tsx");
assert.match(layout, /<RoomHelp\s*\/>/, "the help control must mount in the root layout, on every screen");
assert.match(
  helpSource,
  /createPortal\([\s\S]*document\.body/,
  `${HELP_PATH}: must portal to document.body — a room's fixed wrapper opens a stacking ` +
    `context in Chrome that traps in-tree controls under the tape and eats their clicks`,
);
assert.match(helpSource, /role="dialog"/, `${HELP_PATH}: the modal must be a dialog`);
assert.match(helpSource, /aria-modal="true"/, `${HELP_PATH}: the modal must be modal to assistive tech`);
assert.match(helpSource, /aria-label(?:ledby)?=/, `${HELP_PATH}: the "?" and the dialog need accessible names`);
assert.match(
  helpSource,
  /prefers-reduced-motion/,
  `${HELP_PATH}: any transition must honour prefers-reduced-motion`,
);

console.log(
  `room-help ok: ${SITE_ROUTES.length} routes resolve into ${GUIDE_ROOMS.length} guide entries, ` +
    `${DECLARED_EXEMPT_ROUTES.length} declared exemptions, no room prose in the component`,
);
