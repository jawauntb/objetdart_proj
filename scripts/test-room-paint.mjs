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
//
// The count above is textual — the number of times the source string appears —
// which cannot see the difference between one call at module scope and one
// call inside a per-object per-frame loop. A per-mote or per-ember gradient
// is 60 or 320 allocations a frame while the ledger reads "1", so the file
// looks compliant while the paint tanks on iPhone. The `loopBudget` per-file
// field is the honest declaration for the loop-enclosed case: it counts
// matches that sit under an enclosing `for`/`while`/`.forEach`/`.map` on any
// line ≤40 above. Zero unless explicitly acknowledged — a raised budget is a
// visible flag a reviewer must accept, exactly the shape the primary cap has.
// A pre-baked cache inside a loop (e.g. Stars.tsx:2472's `gPlanet(...)`, where
// the gradient only allocates on cache miss) is legitimately loop-enclosed but
// costs nothing after warmup; that is the "hoisted debt" the loopBudget line
// exists to record.

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

/** How far back to walk when looking for an enclosing loop. */
const LOOP_WINDOW = 40;
/** Anything that opens a per-frame loop we care about. */
const LOOP_OPEN = /\b(for|while)\s*\(|\.(forEach|map)\s*\(/;

/**
 * True when the match at `matchLine` (1-indexed) sits under an enclosing
 * for/while/forEach/map opened within the last `LOOP_WINDOW` lines, judged
 * by indentation: a loop opener at strictly less indent than the match line,
 * with no lower-indent non-loop opener in between, is treated as enclosing.
 * Indentation is used instead of bracket-counting so that `{` inside strings
 * and comments cannot mislead the heuristic.
 */
function isInLoop(lines, matchLine) {
  const line = lines[matchLine - 1] ?? "";
  const matchIndent = line.search(/\S/);
  if (matchIndent <= 0) return false;
  const start = Math.max(1, matchLine - LOOP_WINDOW);
  for (let i = matchLine - 1; i >= start; i--) {
    const l = lines[i - 1];
    if (!l) continue;
    const indent = l.search(/\S/);
    if (indent < 0 || indent >= matchIndent) continue;
    if (LOOP_OPEN.test(l)) return true;
  }
  return false;
}

const dir = new URL("src/components/", rootUrl);
const files = readdirSync(dir)
  .filter((name) => name.endsWith(".tsx"))
  .sort();

/** Count total + loop-enclosed matches per file. */
const counts = {};
const loopCounts = {};
for (const name of files) {
  const source = readFileSync(new URL(name, dir), "utf8");
  const lines = source.split("\n");
  const found = {};
  const loopFound = {};
  for (const { pattern, name: key } of BANNED) {
    pattern.lastIndex = 0;
    let total = 0;
    let loop = 0;
    let m;
    while ((m = pattern.exec(source)) !== null) {
      total += 1;
      const matchLine = source.slice(0, m.index).split("\n").length;
      if (isInLoop(lines, matchLine)) loop += 1;
    }
    if (total > 0) found[key] = total;
    if (loop > 0) loopFound[key] = loop;
  }
  if (Object.keys(found).length) counts[`src/components/${name}`] = found;
  if (Object.keys(loopFound).length) loopCounts[`src/components/${name}`] = loopFound;
}

if (update) {
  const written = {};
  for (const [file, entry] of Object.entries(counts)) {
    const out = { ...entry };
    const lb = loopCounts[file];
    if (lb && Object.keys(lb).length) out.loopBudget = lb;
    written[file] = out;
  }
  writeFileSync(ledgerUrl, `${JSON.stringify(written, null, 2)}\n`);
  const total = Object.values(counts).reduce(
    (sum, entry) => sum + Object.values(entry).reduce((a, b) => a + b, 0),
    0,
  );
  const loopTotal = Object.values(loopCounts).reduce(
    (sum, entry) => sum + Object.values(entry).reduce((a, b) => a + b, 0),
    0,
  );
  console.log(
    `room paint ledger rewritten: ${Object.keys(counts).length} files, ${total} calls, ${loopTotal} loop-enclosed`,
  );
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
  const loopAllowed = allowed.loopBudget ?? {};
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
  const loopFound = loopCounts[file] ?? {};
  for (const [call, n] of Object.entries(loopFound)) {
    const lbCap = loopAllowed[call] ?? 0;
    if (n > lbCap) {
      problems.push(
        lbCap === 0
          ? `${file}: ${call} × ${n} inside a per-frame for/while/forEach/map — ` +
            `each match is an allocation per object per frame the paint test cannot see textually. ` +
            `Hoist to a baked sprite (see Stars.tsx's bakeDot / sprite pattern), or, if it is already ` +
            `pre-baked (e.g. gPlanet's memoised cache miss), add \`loopBudget: { "${call}": ${n} }\` ` +
            `to this file's ledger entry with the reason in the PR body.`
          : `${file}: ${call} × ${n} inside a loop, loopBudget allows ${lbCap}. ` +
            `The loop-enclosed count only ratchets down. Use ${instead[call]}, or promote the ` +
            `existing loopBudget in the same PR with a written reason.`,
      );
    }
  }
}

for (const [file, allowed] of Object.entries(ledger)) {
  for (const [call, cap] of Object.entries(allowed)) {
    if (call === "loopBudget") continue; // handled below
    const now = counts[file]?.[call] ?? 0;
    if (now < cap) shrunk += cap - now;
  }
  const loopAllowed = allowed.loopBudget ?? {};
  for (const [call, cap] of Object.entries(loopAllowed)) {
    const now = loopCounts[file]?.[call] ?? 0;
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
const loopTotal = Object.values(loopCounts).reduce(
  (sum, entry) => sum + Object.values(entry).reduce((a, b) => a + b, 0),
  0,
);
console.log(
  `room paint ok: ${total} banned 2D calls (${loopTotal} loop-enclosed) across ${ledgered} ledgered components, none added` +
    (shrunk > 0 ? ` — ${shrunk} retired since the ledger was written (run --update to bank it)` : ""),
);
