/**
 * loadTsModule — the one TypeScript loader the node test scripts share.
 *
 * Every `scripts/test-*.mjs` used to carry its own copy, and they drifted:
 * some ran the transpiled module in a `vm` context (which makes
 * `assert.deepStrictEqual` reject arrays whose `Array.prototype` comes from
 * another realm), some resolved `@/` imports, some didn't — so adding a real
 * import anywhere in `src/lib` broke a random subset of the suite.
 *
 * This runs in the current realm and resolves `@/x` → `src/x.ts` the way the
 * tsconfig alias does. Modules are cached per (path, extra-globals) so a
 * diamond import graph loads once.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const rootUrl = new URL("../../", import.meta.url);
const cache = new Map();

/**
 * @param {string} path repo-relative path, e.g. "src/lib/peers.ts"
 * @param {{ requireMap?: Record<string, unknown>, globals?: Record<string, unknown> }} [opts]
 */
export function loadTsModule(path, opts = {}) {
  const { requireMap = {}, globals = {} } = opts;
  const cacheKey = `${path}::${Object.keys(requireMap).sort().join(",")}::${Object.keys(globals).sort().join(",")}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

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
    if (id.startsWith("@/")) return loadTsModule(`src/${id.slice(2)}.ts`, opts);
    throw new Error(`Unexpected require(${id}) while loading ${path}`);
  };

  const names = ["module", "exports", "require", ...Object.keys(globals)];
  const values = [module, module.exports, requireShim, ...Object.values(globals)];
  new Function(...names, code)(...values);

  cache.set(cacheKey, module.exports);
  return module.exports;
}

export { rootUrl };
