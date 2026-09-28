// Runs every lane's law: scripts/universe-mcp/*.test.mjs, in name order. A lane
// adds a file there and touches nothing shared, so parallel lanes never collide.
import { readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

const dir = new URL("./universe-mcp/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".test.mjs")).sort();
if (!files.length) throw new Error("no universe-mcp tests found");
for (const f of files) {
  process.stdout.write(`· ${f}\n`);
  await import(pathToFileURL(new URL(f, dir).pathname).href);
}
console.log(`universe-mcp: ${files.length} lane test file(s) green`);
