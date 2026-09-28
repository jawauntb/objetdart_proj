// Universe MCP — code-policy: the leash, as pure functions. No fs, no clock read
// as state, no network. Read policy and write policy are separate on purpose:
// the write list is strictly smaller and has its own deny list.

/** The checkout, injected. Paths are canonical repo-relative posix paths. */
export type CodeFs = {
  stat: (rel: string) => { size: number; file: boolean; dir: boolean } | null;
  read: (rel: string) => string | null;
  readdir: (rel: string) => string[];
};

export type PathVerdict = { ok: true; path: string } | { ok: false; reason: string };

export const READ_MAX_FILE_BYTES = 400 * 1024;
export const READ_MAX_BYTES = 200 * 1024;
export const READ_MAX_LINES = 400;
export const SEARCH_MAX_HITS = 50;
export const WRITE_MAX_FILES = 5;
export const WRITE_MAX_FILE_BYTES = 200 * 1024;
export const COMMIT_PER_INSTANCE_MS = 5 * 60 * 1000;
export const COMMIT_GLOBAL_PER_HOUR = 6;

const WRITE_EXT = new Set([".md", ".txt", ".json", ".svg", ".html", ".css", ".js", ".mjs", ".ts", ".tsx"]);
const READ_EXT = new Set([
  ...WRITE_EXT, ".cjs", ".jsx", ".mts", ".yml", ".yaml", ".toml", ".csv", ".sh", ".py", ".xml", ".webmanifest", ".glsl", ".wgsl",
]);
const READ_ROOT_FILES = new Set(["README.md", "DESIGN.md", "INSPIRATION.md", "AGENTS.md", "CLAUDE.md", "package.json"]);
const READ_ROOT_DIRS = ["src", "docs", "public", "scripts", "packages"];
const READ_DENY_SEGMENTS = new Set([".git", "node_modules", ".next", ".universe-data", "doppler.yaml"]);

const extOf = (p: string) => {
  const b = p.slice(p.lastIndexOf("/") + 1);
  const i = b.lastIndexOf(".");
  return i <= 0 ? "" : b.slice(i).toLowerCase();
};
const baseOf = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/** Canonical repo-relative posix path, or the reason it is refused. Shared by read and write. */
export function normalizeRepoPath(raw: unknown): PathVerdict {
  if (typeof raw !== "string" || !raw) return { ok: false, reason: "path must be a non-empty string" };
  if (raw.length > 300) return { ok: false, reason: "path is too long" };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return { ok: false, reason: "path has control characters" };
  if (raw.includes("\\")) return { ok: false, reason: "backslashes are not allowed in paths" };
  let s = raw.normalize("NFKC");
  if (s.includes("\\") || /[\u0000-\u001f\u007f]/.test(s)) return { ok: false, reason: "path has forbidden characters" };
  if (/%[0-9a-f]{2}/i.test(s)) return { ok: false, reason: "percent-encoded paths are not allowed" };
  if (s.startsWith("/") || /^[a-z]:/i.test(s) || s.startsWith("~")) return { ok: false, reason: "path must be repo-relative" };
  const out: string[] = [];
  for (const seg of s.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") return { ok: false, reason: "'..' is not allowed in paths" };
    if (/[. ]$/.test(seg) || /^\s/.test(seg)) return { ok: false, reason: "segments may not start with a space or end with a dot or space" };
    out.push(seg);
  }
  if (!out.length) return { ok: false, reason: "path is empty" };
  s = out.join("/");
  return { ok: true, path: s };
}

/** May this file be read? */
export function readPolicy(raw: unknown): PathVerdict {
  const n = normalizeRepoPath(raw);
  if (!n.ok) return n;
  const p = n.path;
  const segs = p.toLowerCase().split("/");
  for (const s of segs) {
    if (s.startsWith(".env")) return { ok: false, reason: "environment files are never readable" };
    if (READ_DENY_SEGMENTS.has(s)) return { ok: false, reason: `${s} is never readable` };
  }
  if (/\.(pem|key|p12|pfx)$/i.test(p) || /^id_(rsa|ed25519|ecdsa)/i.test(baseOf(p))) return { ok: false, reason: "key material is never readable" };
  if (!p.includes("/")) {
    return READ_ROOT_FILES.has(p) ? n : { ok: false, reason: "not in the readable set (src, docs, public, scripts, packages and a few root files)" };
  }
  const top = p.slice(0, p.indexOf("/"));
  if (!READ_ROOT_DIRS.includes(top)) return { ok: false, reason: "not in the readable set (src, docs, public, scripts, packages and a few root files)" };
  const ext = extOf(p);
  if (top === "public" ? !WRITE_EXT.has(ext) : !READ_EXT.has(ext)) return { ok: false, reason: "only text files are readable" };
  return n;
}

const WRITE_DENY_BASENAME = /^(railway\.json|package[^/]*\.json|next\.config\..*|doppler\.yaml|agents\.md|claude\.md|inspiration\.md|\.env.*)$/;
const LEASH_DIR = "src/lib/universe-mcp/";
// By stem, not by extension: Next resolves an extensionless import to .js and .mjs before .ts,
// so a written auth.js would shadow auth.ts. Any file or folder with a leash stem is denied.
const LEASH_STEM = /^(code[^/]*|tools-code|auth|protocol|serve|index|types)$/;

/** May this file be written by an animal? Stricter than readPolicy and independent of it. */
export function writePolicy(raw: unknown): PathVerdict {
  const n = normalizeRepoPath(raw);
  if (!n.ok) return n;
  const p = n.path;
  const lc = p.toLowerCase();
  const segs = lc.split("/");
  if (segs.some((s) => s === ".github" || s === ".git" || s === "node_modules" || s === ".next" || s.startsWith(".env"))) {
    return { ok: false, reason: "that location is never writable" };
  }
  if (WRITE_DENY_BASENAME.test(segs[segs.length - 1])) return { ok: false, reason: "that file is never writable" };
  if (lc.startsWith("src/app/api/mcp/") || lc.startsWith("src/app/api/universe/")) return { ok: false, reason: "the leash and its transport are never writable" };
  if (lc.startsWith(LEASH_DIR)) {
    const first = lc.slice(LEASH_DIR.length).split("/")[0];
    if (LEASH_STEM.test(first.replace(/\.[^.]*$/, ""))) return { ok: false, reason: "the leash itself is never writable" };
  }
  // A file route or middleware outranks the /mcp rewrite in next.config, so it could stand in for the transport.
  if (lc.startsWith("src/app/mcp/") || /^src\/(middleware|instrumentation)\./.test(lc)) return { ok: false, reason: "the leash and its transport are never writable" };
  if (lc === "scripts/universe-mcp/code.test.mjs") return { ok: false, reason: "the leash's own test is never writable" };
  const ext = extOf(p);
  const top = segs[0];
  if (top === "src" || top === "docs") {
    if (segs.length < 2) return { ok: false, reason: "not a writable path" };
    if (top === "docs" && !WRITE_EXT.has(ext)) return { ok: false, reason: "only text files are writable" };
    if (top === "src" && !WRITE_EXT.has(ext)) return { ok: false, reason: "only text files are writable" };
  } else if (top === "public") {
    if (segs.length < 2 || !WRITE_EXT.has(ext)) return { ok: false, reason: "only text files are writable in public" };
  } else if (top === "scripts") {
    const ok = (segs.length === 2 && /^test-[^/]*\.mjs$/.test(segs[1])) || (segs.length === 3 && segs[1] === "universe-mcp" && /\.test\.mjs$/.test(segs[2]));
    if (!ok) return { ok: false, reason: "scripts are writable only as test files" };
  } else return { ok: false, reason: "not a writable path (src, docs, public and test scripts only)" };
  // case: the allow roots are lowercase; a differently-cased root is another path entirely
  if (p.slice(0, top.length) !== top) return { ok: false, reason: "not a writable path" };
  return n;
}

export type Slice = { text: string; from: number; to: number; total: number; next: number | null };

/** Line slice with the 200 KB / 400 line caps and a next-offset hint. Lines are 1-based, inclusive. */
export function sliceLines(content: string, start?: unknown, end?: unknown): Slice {
  const lines = content.split("\n");
  if (lines.length && lines[lines.length - 1] === "" && lines.length > 1) lines.pop();
  const total = lines.length;
  const s = Math.max(1, Number.isFinite(Number(start)) && start !== undefined && start !== null ? Math.trunc(Number(start)) : 1);
  let e = Number.isFinite(Number(end)) && end !== undefined && end !== null ? Math.trunc(Number(end)) : total;
  e = Math.min(total, Math.max(s, e), s + READ_MAX_LINES - 1);
  const picked: string[] = [];
  let bytes = 0;
  let last = s - 1;
  for (let i = s; i <= e; i++) {
    const l = lines[i - 1];
    const b = Buffer.byteLength(l) + 1;
    if (bytes + b > READ_MAX_BYTES && picked.length) break;
    picked.push(l);
    bytes += b;
    last = i;
  }
  return { text: picked.join("\n"), from: s, to: last, total, next: last < total ? last + 1 : null };
}

/** Reject patterns whose worst case is exponential or that lean on backreferences. */
export function regexRisk(src: string): string | null {
  if (src.length > 100) return "regex is longer than 100 characters";
  if (/\\[1-9]|\\k</.test(src)) return "backreferences are not allowed";
  const stack: { hasQuant: boolean; hasAlt: boolean }[] = [];
  let inClass = false;
  let unbounded = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") { i++; continue; }
    if (inClass) { if (c === "]") inClass = false; continue; }
    if (c === "[") { inClass = true; continue; }
    if (c === "(") { stack.push({ hasQuant: false, hasAlt: false }); continue; }
    if (c === "|" && stack.length) { stack[stack.length - 1].hasAlt = true; continue; }
    const quant = c === "*" || c === "+" || (c === "{" && /^\{\d*,\d*\}/.test(src.slice(i)));
    if (quant) {
      if (c !== "{") unbounded++;
      else {
        const q = /^\{(\d*),(\d*)\}/.exec(src.slice(i));
        if (q && (q[2] === "" || Number(q[2]) > 50)) unbounded++;
      }
      if (stack.length) stack[stack.length - 1].hasQuant = true;
      continue;
    }
    if (c === ")") {
      const g = stack.pop();
      const next = src[i + 1];
      const after = next === "*" || next === "+" || (next === "{" && /^\{\d*,?\d*\}/.test(src.slice(i + 1)));
      if (g && after && (g.hasQuant || g.hasAlt)) return "a repeated group that contains a repeat or alternation is not allowed";
      if (g && stack.length && (g.hasQuant || g.hasAlt)) {
        const parent = stack[stack.length - 1];
        parent.hasQuant = parent.hasQuant || g.hasQuant;
        parent.hasAlt = parent.hasAlt || g.hasAlt;
      }
    }
  }
  // Each open-ended repeat multiplies the work on a failing line by its length: keep it to three.
  if (unbounded > 3) return "too many open-ended repeats";
  return null;
}

export type Matcher = { ok: true; test: (line: string) => boolean } | { ok: false; reason: string };

/** A literal, or /regex/i. Literals are case-sensitive substrings. */
export function buildMatcher(query: unknown): Matcher {
  if (typeof query !== "string" || !query.trim()) return { ok: false, reason: "query must be a non-empty string" };
  if (query.length > 200) return { ok: false, reason: "query is longer than 200 characters" };
  const m = /^\/(.+)\/(i?)$/s.exec(query);
  if (!m) return { ok: true, test: (l) => l.includes(query) };
  const risk = regexRisk(m[1]);
  if (risk) return { ok: false, reason: risk };
  try {
    const re = new RegExp(m[1], m[2]);
    return { ok: true, test: (l) => re.test(l) };
  } catch {
    return { ok: false, reason: "regex does not parse" };
  }
}

/** Small glob: **, *, ? over a posix path. */
export function globToRegExp(glob: string): RegExp | null {
  if (glob.length > 100 || /[\u0000-\u001f\\]/.test(glob)) return null;
  glob = glob.replace(/\*{2,}/g, "**"); // a run of stars is one wildcard
  // Every * or ** is a backtracking loop over the path; a few are fine, dozens hang the process.
  if ((glob.match(/\*+/g) || []).length > 4) return null;
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") { re += ".*"; i++; if (glob[i + 1] === "/") i++; } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export type CommitLimiter = {
  check: (instance: string, now: number) => string | null;
  record: (instance: string, now: number) => void;
};

/** One real commit per 5 minutes per instance and 6 per hour overall. Memory only. */
export function createCommitLimiter(): CommitLimiter {
  const per = new Map<string, number>();
  let all: number[] = [];
  return {
    check(instance, now) {
      const last = per.get(instance);
      if (last !== undefined && now - last < COMMIT_PER_INSTANCE_MS) {
        return `this world committed ${Math.ceil((COMMIT_PER_INSTANCE_MS - (now - last)) / 1000)} seconds ago; one commit per 5 minutes per world`;
      }
      all = all.filter((t) => now - t < 3600000);
      if (all.length >= COMMIT_GLOBAL_PER_HOUR) return `${COMMIT_GLOBAL_PER_HOUR} commits were made in the last hour; that is the limit for the whole universe`;
      return null;
    },
    record(instance, now) {
      per.set(instance, now);
      all.push(now);
      if (per.size > 5000) per.clear();
    },
  };
}

export const INSTANCE_RE = /^[a-z0-9]{8,16}$/;

export function validMessage(m: unknown): string | null {
  if (typeof m !== "string") return "message must be a string";
  if (m.length < 8 || m.length > 200) return "message must be 8 to 200 characters";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\u2028\u2029]/.test(m)) return "message must be a single line";
  return null;
}
