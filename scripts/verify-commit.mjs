/**
 * verify-commit — check what you are about to push, not what you have open.
 *
 * The failure this ends, three times over on one branch: many agents write to
 * one working tree, you run `tsc`, it is clean, you `git add` and push — and
 * the thing you staged is not the thing you checked, because a file moved in
 * between. Twice it was a half-migrated component; once it was a constant used
 * one edit before it was declared, which Vercel found and every local check
 * missed, because the fix was sitting uncommitted right beside the break.
 *
 * So: build HEAD in a detached worktree, with node_modules symlinked in and
 * nothing of the live tree reachable. If it compiles there, it compiles on the
 * deploy. Nothing else about a shared tree can promise that.
 *
 * Usage:
 *   node scripts/verify-commit.mjs            # typecheck HEAD (fast)
 *   node scripts/verify-commit.mjs --build     # full next build (slow, exact)
 *   node scripts/verify-commit.mjs --ref=<sha>
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const REF = arg("ref", "HEAD");
const FULL = process.argv.includes("--build");
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const sha = execFileSync("git", ["rev-parse", "--short", REF], { encoding: "utf8" }).trim();

const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
if (dirty) {
  // Not an error — it is the normal state here. But say it, because the whole
  // point is that these files are NOT in what we are about to check.
  const n = dirty.split("\n").length;
  console.log(`note: ${n} path(s) dirty in the working tree and not in ${sha} — that is what this checks.`);
}

const work = mkdtempSync(path.join(tmpdir(), "verify-commit-"));
let failed = false;
try {
  execFileSync("git", ["worktree", "add", "-f", "--detach", work, REF], { cwd: root, stdio: "pipe" });
  const mods = path.join(root, "node_modules");
  if (existsSync(mods)) symlinkSync(mods, path.join(work, "node_modules"));

  if (FULL) {
    console.log(`building ${sha} in isolation…`);
    execFileSync("npx", ["next", "build"], { cwd: work, stdio: "inherit" });
  } else {
    console.log(`typechecking ${sha} in isolation…`);
    execFileSync("npx", ["tsc", "--noEmit"], { cwd: work, stdio: "inherit" });
  }
  console.log(`\n${sha} is sound — what is committed is what was checked.`);
} catch {
  failed = true;
  console.error(`\n${sha} does NOT ${FULL ? "build" : "typecheck"}. Do not push it.`);
} finally {
  try {
    execFileSync("git", ["worktree", "remove", "--force", work], { cwd: root, stdio: "pipe" });
  } catch {
    rmSync(work, { recursive: true, force: true });
  }
}
process.exit(failed ? 1 : 0);
