import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
  const requireShim = (id) => {
    if (id in requireMap) return requireMap[id];
    // Room manifests (src/rooms/**) resolve like any other "@/" module.
    if (id.startsWith("@/")) return loadTsModule(`src/${id.slice(2)}.ts`, requireMap);
    throw new Error(`Unexpected require(${id}) while loading ${path}`);
  };
  // Run in the current realm rather than a vm context: newer Node versions
  // make assert.deepStrictEqual reject arrays whose Array.prototype comes
  // from another realm, which broke every deep comparison below.
  new Function("module", "exports", "require", code)(module, module.exports, requireShim);
  return module.exports;
}

// Navigation order is derived from scale + peers — load those first so
// routes.ts can require them through the shim (no hand-sorted key list).
const scaleModule = loadTsModule("src/lib/scale.ts");
const peersModule = loadTsModule("src/lib/peers.ts");
const navOrderModule = loadTsModule("src/lib/nav-order.ts", {
  "@/lib/scale": scaleModule,
  "@/lib/peers": peersModule,
});
const routesModule = loadTsModule("src/lib/routes.ts", {
  "@/lib/nav-order": navOrderModule,
});
const darkRoutesModule = loadTsModule("src/lib/dark-routes.ts", {
  "@/lib/routes": routesModule,
});
const siteHeaderSource = readRepoFile("src/components/SiteHeader.tsx");
const scrollingGallerySource = readRepoFile("src/components/ScrollingGallery.tsx");
const homePageSource = readRepoFile("src/app/page.tsx");

const {
  DARK_ROUTE_PREFIXES,
  GALLERY_ROUTES,
  NAVIGATION_ROUTES,
  PRIMARY_ROUTE_KEYS,
  SITE_ROUTE_BY_KEY,
  SITE_ROUTES,
  isDarkRoutePath,
} = routesModule;
const {
  scaleOrderedNavigationKeys,
  axisNavigationKeys,
  peerCircleAnchorBand,
} = navOrderModule;
const { SCALE_BANDS, entryScaleFor } = scaleModule;
const { PEER_CIRCLES, SCALE_EXEMPT_KEYS, SCALE_EXEMPT_KEY_SET, allPeerRooms } = peersModule;
const { isDarkRoute } = darkRoutesModule;

const expectedKeys = [
  "atlas",
  "coast",
  "ocean",
  "tide",
  "waves",
  "sine",
  "pretext",
  "circularity",
  "beyond",
  "manifold",
  "overlook",
  "relativity",
  "loom",
  "storm",
  "clouds",
  "mountain",
  "aphros",
  "flowers",
  "birds",
  "tissue",
  "cells",
  "organelles",
  "dna",
  "organics",
  "molecules",
  "atoms",
  "nucleons",
  "quarks",
  "quanta",
  "fire",
  "earth",
  "growth",
  "stars",
  "space",
  "comb",
  "beam",
  "signal",
  "light",
  "music-color",
  "timbre",
  "instrument",
  "plasma",
  "pulse",
  "charts",
  "dither",
  "time",
  "tourbillon",
  "jewel",
  "drop",
  "seed",
  "rocks",
  "coin",
  "watch",
  "archive",
  "kept",
  "colophon",
  "guide",
];
const validClusters = new Set(["field", "water", "nature", "mechanism"]);
const validIcons = new Set(
  [...readRepoFile("src/components/RouteSigil.tsx").matchAll(/case "([^"]+)":/g)].map((match) => match[1]),
);
const homeSources = homePageSource;

function hasAnchor(id) {
  return new RegExp(`id=(?:["']${id}["']|\\{["']${id}["']\\})`).test(homeSources);
}

const keys = SITE_ROUTES.map((route) => route.key);
assert.equal(new Set(keys).size, keys.length, "route keys must be unique");
assert.deepEqual([...keys].sort(), [...expectedKeys].sort(), "route registry must contain the public route set");

// Navigation order is a pure function of SCALE_BANDS + PEER_CIRCLES + SITE_ROUTES.
// A hand-sorted preferred list is exactly the debt this catches: if someone
// reintroduces one, this equality against the deriver fails the moment the
// graph and the list disagree.
const routeRefs = SITE_ROUTES.map((route) => ({ key: route.key, href: route.href }));
const expectedNavigationKeys = scaleOrderedNavigationKeys(routeRefs);
assert.deepEqual(
  NAVIGATION_ROUTES.map((route) => route.key),
  expectedNavigationKeys,
  "navigation must equal scaleOrderedNavigationKeys (no hand-sorted preferred list)",
);
assert.equal(NAVIGATION_ROUTES.length, SITE_ROUTES.length, "navigation should include every route exactly once");
assert.equal(
  new Set(NAVIGATION_ROUTES.map((route) => route.key)).size,
  NAVIGATION_ROUTES.length,
  "navigation order should not duplicate routes",
);
assert.ok(NAVIGATION_ROUTES.every(Boolean), "navigation order should contain only known routes");

// Structural pins: manifold at the top of the axis, quanta at the bottom;
// peer circles stay contiguous in ring order.
const navKeys = NAVIGATION_ROUTES.map((route) => route.key);
const axisKeys = axisNavigationKeys(routeRefs);
assert.equal(axisKeys[0], "manifold", "axis opens at the manifold");
assert.equal(axisKeys[axisKeys.length - 1], "quanta", "axis ends at the quanta");
assert.ok(navKeys.indexOf("manifold") < navKeys.indexOf("stars"), "manifold above stars");
assert.ok(navKeys.indexOf("stars") < navKeys.indexOf("earth"), "stars above earth");
assert.ok(navKeys.indexOf("earth") < navKeys.indexOf("atlas"), "earth above atlas");
assert.ok(navKeys.indexOf("mountain") < navKeys.indexOf("coast"), "peak above shore");
assert.ok(navKeys.indexOf("coast") < navKeys.indexOf("birds"), "shore above birds");
assert.ok(navKeys.indexOf("drop") < navKeys.indexOf("cells"), "drop above cells");
assert.ok(navKeys.indexOf("cells") < navKeys.indexOf("organelles"), "cells above organelles");
assert.ok(navKeys.indexOf("organelles") < navKeys.indexOf("quanta"), "organelles above quanta");
for (const circle of PEER_CIRCLES) {
  const idxs = circle.rooms.map((r) => navKeys.indexOf(r.key)).filter((i) => i >= 0);
  assert.ok(idxs.length === circle.rooms.length, `peer circle ${circle.id} fully present in nav`);
  for (let i = 1; i < idxs.length; i++) {
    assert.equal(
      idxs[i],
      idxs[i - 1] + 1,
      `peer circle ${circle.id} must stay contiguous in ring order`,
    );
  }
  let best = circle.band;
  let bestIdx = SCALE_BANDS.findIndex((b) => b.id === circle.band);
  for (const room of circle.rooms) {
    const i = SCALE_BANDS.findIndex((b) => b.id === room.band);
    if (i > bestIdx) {
      bestIdx = i;
      best = room.band;
    }
  }
  assert.equal(
    peerCircleAnchorBand(circle),
    best,
    `peer circle ${circle.id} anchors at its highest band`,
  );
}
assert.ok(
  navKeys.indexOf("overlook") > navKeys.indexOf("quanta"),
  "meta views of the tree sit after the axis",
);

// Completeness: every SITE_ROUTES key is either on the scale axis (band or
// peer circle) or a deliberate SCALE_EXEMPT_KEYS entry. Leftover "tail"
// rooms mean someone shipped without finding a place — fail loud.
const axisKeySet = new Set(axisKeys);
for (const route of SITE_ROUTES) {
  const onAxis = axisKeySet.has(route.key);
  const exempt = SCALE_EXEMPT_KEY_SET.has(route.key);
  assert.ok(
    onAxis || exempt,
    `${route.key} must join SCALE_BANDS / PEER_CIRCLES or SCALE_EXEMPT_KEYS`,
  );
  assert.ok(!(onAxis && exempt), `${route.key} cannot be both on-axis and exempt`);
}
assert.ok(SCALE_EXEMPT_KEYS.includes("guide"), "guide stays a reading-surface exemption");
assert.ok(axisKeySet.has("coin"), "coin sits on the axis (cabinet at the drop)");
assert.ok(axisKeySet.has("tourbillon"), "tourbillon sits on the axis (cabinet at the drop)");
assert.ok(axisKeySet.has("fire"), "fire sits on the axis (hearth with earth)");
assert.ok(axisKeySet.has("sine"), "sine sits on the axis (shore instruments)");
assert.ok(navKeys.indexOf("coin") < navKeys.indexOf("cells"), "cabinet above cells");
assert.ok(navKeys.indexOf("stars") < navKeys.indexOf("comb"), "sky ring keeps stars before comb");
assert.ok(navKeys.indexOf("comb") < navKeys.indexOf("beam"), "sky ring order stars→comb→beam");

// Peer rooms must resolve through entryScaleFor so ScaleTravel can mount.
for (const room of allPeerRooms()) {
  assert.notEqual(
    entryScaleFor(room.href),
    null,
    `entryScaleFor(${room.href}) must resolve (keep LATERAL_ROUTE_BANDS ↔ PEER_CIRCLES)`,
  );
}

assert.deepEqual(
  GALLERY_ROUTES.map((route) => route.key),
  expectedNavigationKeys.filter((key) => !["archive", "kept", "colophon", "guide"].includes(key)),
  "swipe gallery should follow navigation order while omitting non-gallery routes",
);
assert.match(siteHeaderSource, /NAVIGATION_ROUTES\.map/, "site header should render the shared navigation order");
assert.match(scrollingGallerySource, /GALLERY_ROUTES\.map/, "gallery should render the shared swipe order");
assert.doesNotMatch(
  siteHeaderSource,
  /NAVIGATION_ROUTES\.(?:sort|reverse)\(/,
  "site header should not reorder the shared navigation sequence",
);
assert.doesNotMatch(
  scrollingGallerySource,
  /GALLERY_ROUTES\.(?:sort|reverse)\(/,
  "gallery should not reorder the shared swipe sequence",
);
assert.match(
  scrollingGallerySource,
  /circle back to \{GALLERY_ROUTES\[0\]/,
  "gallery loop should derive its label from the first room",
);

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

assert.match(homePageSource, /<ScrollingGallery\s*\/>/, "home page should render the scrolling gallery");
assert.equal(
  existsSync(new URL("src/app/experiment/page.tsx", rootUrl)),
  false,
  "the temporary experiment route should be removed",
);

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

for (const path of ["/aphros", "/archive", "/colophon", "/timekeeper", "/coinage", "/watching", "/wavescape", "/lightness"]) {
  assert.equal(isDarkRoutePath(path), false, `${path} should not match a dark route by prefix accident`);
}

assert.equal(isDarkRoutePath("/"), true, "the scrolling home page should use dark chrome");

for (const path of ["/", "/coin", "/coin/deep", "/tourbillon", "/archive", "/timekeeper"]) {
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
        // /light deliberately blanks all site chrome for its full-screen
        // instrument (LightInstrument.tsx); every other page must spare it.
        .filter((selector) => selector !== "body:has(.light-page) .oda-site-header")
        .map((selector) => `${path}:${line}: ${selector}`);
    });
  });

assert.deepEqual(
  broadHeaderSelectors,
  [],
  "page-scoped CSS must not hide or restyle the global site header",
);

console.log(`route registry ok: ${SITE_ROUTES.length} routes, ${DARK_ROUTE_PREFIXES.length} dark prefixes`);
