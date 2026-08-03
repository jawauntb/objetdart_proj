// The paint bar, executable.
//
// INSPIRATION.md's law is "procedural over assets: shaders, not sprites", and
// DESIGN.md names three canvas-2D calls as anti-patterns because they are both
// the ugly look and the slow one: `createRadialGradient` allocates and rasters
// a gradient object every frame it is called in, `shadowBlur` on a path forces
// a full-surface blur pass per stroke, and `ctx.filter = "blur(...)"` is a
// software convolution over the whole canvas. A room that reaches for these
// per frame is a room that should have written a fragment shader.
//
// Prose did not stop it: 38 of the components in src/ call
// `createRadialGradient` today. So this is a ratchet, not a purge. The ledger
// in scripts/room-paint-ledger.json records exactly what each file uses right
// now. From here:
//
//   - a component with no ledger entry may not use these calls at all,
//   - a ledgered component may not use them MORE than it already does.
//
// Existing debt is visible and shrinks; new debt cannot be added. When a room
// is rewritten onto `src/lib/webgl/stage.ts`, run
// `node scripts/test-room-paint.mjs --update` and commit the smaller ledger.
//
// Raising a count is not forbidden by accident — it is forbidden. If a room
// genuinely needs one more gradient (a static one built once outside the frame
// loop, say), hoist it out of the draw call; if it truly cannot be hoisted,
// update the ledger in the same PR and say why in the PR body. An honest
// declaration beats a silenced check.

import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const rootUrl = new URL("../", import.meta.url);
const ledgerUrl = new URL("scripts/room-paint-ledger.json", rootUrl);
const update = process.argv.includes("--update");

/** The banned per-frame calls, each with the shader that replaces it. */
const BANNED = [
  {
    pattern: /createRadialGradient\s*\(/g,
    name: "createRadialGradient",
    instead: "a radial falloff in a fragment shader, or one gradient built once outside the frame loop",
  },
  {
    pattern: /\bshadowBlur\s*=/g,
    name: "shadowBlur",
    instead: "an additive glow pass on the GPU (stage.fullscreenQuad with ONE/ONE blending)",
  },
  {
    pattern: /\bctx\.filter\s*=|\.filter\s*=\s*[`"']blur\(/g,
    name: "ctx.filter blur",
    instead: "a separable blur in a shader, or a downscaled render target",
  },
];

const dir = new URL("src/components/", rootUrl);
const files = readdirSync(dir)
  .filter((name) => name.endsWith(".tsx"))
  .sort();

/** Count banned calls per file. */
const counts = {};
for (const name of files) {
  const source = readFileSync(new URL(name, dir), "utf8");
  const found = {};
  for (const { pattern, name: key } of BANNED) {
    pattern.lastIndex = 0;
    const n = (source.match(pattern) ?? []).length;
    if (n > 0) found[key] = n;
  }
  if (Object.keys(found).length) counts[`src/components/${name}`] = found;
}

if (update) {
  writeFileSync(ledgerUrl, `${JSON.stringify(counts, null, 2)}\n`);
  const total = Object.values(counts).reduce(
    (sum, entry) => sum + Object.values(entry).reduce((a, b) => a + b, 0),
    0,
  );
  console.log(`room paint ledger rewritten: ${Object.keys(counts).length} files, ${total} calls`);
  process.exit(0);
}

let ledger;
try {
  ledger = JSON.parse(readFileSync(ledgerUrl, "utf8"));
} catch {
  assert.fail(
    "scripts/room-paint-ledger.json is missing — run `node scripts/test-room-paint.mjs --update` and commit it",
  );
}

const instead = Object.fromEntries(BANNED.map((b) => [b.name, b.instead]));
const problems = [];
let shrunk = 0;

for (const [file, found] of Object.entries(counts)) {
  const allowed = ledger[file] ?? {};
  for (const [call, n] of Object.entries(found)) {
    const cap = allowed[call] ?? 0;
    if (n > cap) {
      problems.push(
        cap === 0
          ? `${file}: ${call} × ${n} — this component has no ledger entry for it. ` +
            `Use ${instead[call]}. See src/lib/webgl/stage.ts and AGENTS.md, "the room quality bar".`
          : `${file}: ${call} × ${n}, ledger allows ${cap}. ` +
            `The bar only ratchets down. Use ${instead[call]}, or hoist it out of the frame loop.`,
      );
    }
  }
}

for (const [file, allowed] of Object.entries(ledger)) {
  for (const [call, cap] of Object.entries(allowed)) {
    const now = counts[file]?.[call] ?? 0;
    if (now < cap) shrunk += cap - now;
  }
}

assert.deepEqual(problems, [], `\n\n${problems.join("\n\n")}\n`);

// The ledger must stay a ledger of real files — an entry for a component that
// no longer exists is a stale allowance a new file could inherit by name.
for (const file of Object.keys(ledger)) {
  const name = file.replace("src/components/", "");
  assert.ok(
    files.includes(name),
    `${file} is in the paint ledger but no longer exists — run --update and commit`,
  );
}

const ledgered = Object.keys(ledger).length;
const total = Object.values(counts).reduce(
  (sum, entry) => sum + Object.values(entry).reduce((a, b) => a + b, 0),
  0,
);
console.log(
  `room paint ok: ${total} banned 2D calls across ${ledgered} ledgered components, none added` +
    (shrunk > 0 ? ` — ${shrunk} retired since the ledger was written (run --update to bank it)` : ""),
);
