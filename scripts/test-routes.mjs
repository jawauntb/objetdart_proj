import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import * as ts from "typescript";

const rootUrl = new URL("../", import.meta.url);

function readRepoFile(path) {
  return readFileSync(new URL(path, rootUrl), "utf8");
}

function walkRepoFiles(path) {
  const dir = new URL(path, rootUrl);
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const childPath = `${path}/${entry.name}`;
    const childUrl = new URL(childPath, rootUrl);
    if (entry.isDirectory()) return walkRepoFiles(childPath);
    if (entry.isFile() && statSync(childUrl).isFile()) return [childPath];
    return [];
  });
}

function loadTsModule(path, requireMap = {}) {
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
  const sandbox = {
    module,
    exports: module.exports,
    require: (id) => {
      if (id in requireMap) return requireMap[id];
      throw new Error(`Unexpected require(${id}) while loading ${path}`);
    },
  };
  vm.runInNewContext(code, sandbox, { filename });
  return module.exports;
}

const routesModule = loadTsModule("src/lib/routes.ts");
const darkRoutesModule = loadTsModule("src/lib/dark-routes.ts", {
  "@/lib/routes": routesModule,
});
const siteHeaderSource = readRepoFile("src/components/SiteHeader.tsx");

const {
  DARK_ROUTE_PREFIXES,
  PRIMARY_ROUTE_KEYS,
  SITE_ROUTE_BY_KEY,
  SITE_ROUTES,
  isDarkRoutePath,
} = routesModule;
const { isDarkRoute } = darkRoutesModule;

const expectedKeys = [
  "atlas",
  "ocean",
  "tide",
  "waves",
  "sine",
  "pretext",
  "circularity",
  "beyond",
  "storm",
  "clouds",
  "aphros",
  "flowers",
  "fire",
  "earth",
  "growth",
  "stars",
  "signal",
  "light",
  "plasma",
  "pulse",
  "charts",
  "time",
  "movement",
  "jewel",
  "coin",
  "watch",
  "archive",
  "kept",
  "colophon",
];
const validClusters = new Set(["field", "water", "nature", "mechanism"]);
const validIcons = new Set(
  [...readRepoFile("src/components/RouteSigil.tsx").matchAll(/case "([^"]+)":/g)].map((match) => match[1]),
);
const homeSources = [
  "src/app/page.tsx",
  "src/components/ConcernField.tsx",
  "src/components/Atlas.tsx",
  "src/components/Reading.tsx",
  "src/components/Archive.tsx",
  "src/components/Colophon.tsx",
].map(readRepoFile).join("\n");

function hasAnchor(id) {
  return new RegExp(`id=(?:["']${id}["']|\\{["']${id}["']\\})`).test(homeSources);
}

const keys = SITE_ROUTES.map((route) => route.key);
assert.equal(new Set(keys).size, keys.length, "route keys must be unique");
assert.deepEqual([...keys].sort(), [...expectedKeys].sort(), "route registry must contain the public route set");

for (const route of SITE_ROUTES) {
  assert.ok(SITE_ROUTE_BY_KEY[route.key] === route, `${route.key} should resolve through SITE_ROUTE_BY_KEY`);
  assert.ok(validClusters.has(route.cluster), `${route.key} has an unknown cluster`);
  assert.ok(validIcons.has(route.icon), `${route.key} has an icon that RouteSigil cannot render`);
  assert.ok(route.href.startsWith("/"), `${route.key} href must be absolute`);
  if (route.anchor) assert.ok(hasAnchor(route.anchor), `${route.key} anchor ${route.anchor} should exist on the home page`);
}

for (const key of PRIMARY_ROUTE_KEYS) {
  assert.ok(SITE_ROUTE_BY_KEY[key], `primary route ${key} should resolve`);
}

for (const anchor of ["live-chart", "concern-field", "atlas", "reading", "archive", "colophon"]) {
  assert.ok(hasAnchor(anchor), `home anchor ${anchor} should exist`);
}

const darkPrefixes = new Set(DARK_ROUTE_PREFIXES);
for (const route of SITE_ROUTES) {
  if (route.dark) {
    assert.ok(darkPrefixes.has(route.href), `${route.key} should contribute a dark prefix`);
    assert.equal(isDarkRoutePath(route.href), true, `${route.href} should be dark`);
    assert.equal(isDarkRoutePath(`${route.href}/nested`), true, `${route.href}/nested should be dark`);
  } else {
    assert.equal(isDarkRoutePath(route.href), false, `${route.href} should not be dark`);
  }
}

for (const path of ["/", "/aphros", "/archive", "/colophon", "/timekeeper", "/coinage", "/watching", "/wavescape", "/lightness"]) {
  assert.equal(isDarkRoutePath(path), false, `${path} should not match a dark route by prefix accident`);
}

for (const path of ["/", "/coin", "/coin/deep", "/movement", "/archive", "/timekeeper"]) {
  assert.equal(isDarkRoute(path), isDarkRoutePath(path), `isDarkRoute should delegate ${path}`);
}

assert.match(siteHeaderSource, /className="oda-site-header"/, "site header should carry a stable class for page CSS to spare");

const broadHeaderSelectors = walkRepoFiles("src")
  .filter((path) => /\.(?:css|tsx?)$/.test(path))
  .flatMap((path) => {
    const source = readRepoFile(path);
    return [...source.matchAll(/([^{}]+)\{/g)].flatMap((match) => {
      const selectorBlock = match[1];
      if (!selectorBlock.includes("body:has(")) return [];
      const line = source.slice(0, match.index).split("\n").length;
      return selectorBlock
        .split(",")
        .map((selector) => selector.trim())
        .filter((selector) => selector.includes("body:has("))
        .filter((selector) => {
          const targetsHeader = /\bheader\b/.test(selector);
          const sparesSiteHeader = /\bheader:not\(\.oda-site-header\)/.test(selector);
          const targetsSiteHeader = /\.oda-site-header\b/.test(selector) && !sparesSiteHeader;
          return (targetsHeader && !sparesSiteHeader) || targetsSiteHeader;
        })
        .map((selector) => `${path}:${line}: ${selector}`);
    });
  });

assert.deepEqual(
  broadHeaderSelectors,
  [],
  "page-scoped CSS must not hide or restyle the global site header",
);

console.log(`route registry ok: ${SITE_ROUTES.length} routes, ${DARK_ROUTE_PREFIXES.length} dark prefixes`);
