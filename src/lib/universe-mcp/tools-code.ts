// Universe MCP — tools-code: read the world's source, and (armed) propose changes.
// Everything that touches the outside is injected through CodeDeps; the defaults
// load node:fs lazily and use the platform fetch.
import type { ToolCtx, ToolDef, ToolResult } from "@/lib/universe-mcp/types";
import { text } from "@/lib/universe-mcp/protocol";
import {
  INSTANCE_RE, READ_MAX_FILE_BYTES, SEARCH_MAX_HITS, WRITE_MAX_FILES, WRITE_MAX_FILE_BYTES,
  buildMatcher, createCommitLimiter, globToRegExp, readPolicy, sliceLines, validMessage, writePolicy,
} from "@/lib/universe-mcp/code-policy";
import type { CodeFs, CommitLimiter } from "@/lib/universe-mcp/code-policy";
import { REPO_RE, commitFiles, scrub } from "@/lib/universe-mcp/code-github";
import type { GhFetch } from "@/lib/universe-mcp/code-github";

export type SyntaxCheck = (path: string, content: string) => Promise<string>;
export type CodeDeps = {
  getFs: () => Promise<CodeFs>;
  fetch: GhFetch;
  checkSyntax: SyntaxCheck;
  limiter: CommitLimiter;
};

/** "ok", "unchecked" (with a reason), or "error line N: ...". Never silently passes. */
export const defaultCheckSyntax: SyntaxCheck = async (path, content) => {
  const lower = path.toLowerCase();
  if (lower.endsWith(".json")) {
    try { JSON.parse(content); return "ok"; } catch (e) { return `error: ${e instanceof Error ? e.message.slice(0, 120) : "invalid json"}`; }
  }
  if (!/\.(ts|tsx|js|mjs)$/.test(lower)) return "n/a";
  try {
    const ts = await import("typescript");
    const out = ts.transpileModule(content, {
      fileName: path,
      reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve, allowJs: true },
    });
    const d = (out.diagnostics || []).find((x) => x.category === ts.DiagnosticCategory.Error);
    if (!d) return "ok";
    const msg = ts.flattenDiagnosticMessageText(d.messageText, " ").slice(0, 140);
    const line = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0;
    return `error${line ? ` line ${line}` : ""}: ${msg}`;
  } catch {
    return "unchecked (the syntax checker is not available at runtime)";
  }
};

const realFetch: GhFetch = (url, init) => fetch(url, init) as unknown as ReturnType<GhFetch>;

let sharedLimiter: CommitLimiter | null = null;
const defaults = (): CodeDeps => ({
  getFs: async () => (await import("@/lib/universe-mcp/code-fs")).nodeFs(process.cwd()),
  fetch: realFetch,
  checkSyntax: defaultCheckSyntax,
  limiter: (sharedLimiter ||= createCommitLimiter()),
});

const SEARCH_ROOTS = ["src", "docs", "public", "scripts", "packages"];
const SEARCH_MAX_FILES = 4000;
const SEARCH_MAX_LINES = 600000;
const SEARCH_MAX_MS = 4000;
const RESOLVE_DIRS_SKIP = new Set([".git", "node_modules", ".next", ".universe-data"]);

const lineDiff = (a: string, b: string) => {
  const count = new Map<string, number>();
  for (const l of a.split("\n")) count.set(l, (count.get(l) || 0) + 1);
  let added = 0;
  for (const l of b.split("\n")) {
    const c = count.get(l) || 0;
    if (c > 0) count.set(l, c - 1);
    else added++;
  }
  let removed = 0;
  for (const v of count.values()) removed += v;
  return { added, removed };
};

export function createCodeTools(over: Partial<CodeDeps> = {}): ToolDef[] {
  const deps = { ...defaults(), ...over };

  const worldRead: ToolDef = {
    name: "world_read",
    description: "Read one file of the running world's source by repo-relative path (src, docs, public, scripts, packages and a few root files). Returns at most 400 lines or 200 KB with a next-start hint.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "repo-relative posix path, e.g. src/lib/room-registry.ts" },
        start: { type: "integer", minimum: 1, description: "first line, 1-based" },
        end: { type: "integer", minimum: 1, description: "last line, inclusive" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    access: "open",
    handler: async (args): Promise<ToolResult> => {
      const v = readPolicy(args.path);
      if (!v.ok) return text(`That path cannot be read: ${v.reason}.`, true);
      const fs = await deps.getFs();
      const st = fs.stat(v.path);
      if (!st || !st.file) return text(`No file at ${v.path}.`, true);
      if (st.size > READ_MAX_FILE_BYTES) return text(`${v.path} is larger than 400 KB and is not readable.`, true);
      const body = fs.read(v.path);
      if (body === null) return text(`No file at ${v.path}.`, true);
      if (body.includes("\u0000")) return text(`${v.path} is not a text file.`, true);
      const s = sliceLines(body, args.start, args.end);
      const head = `${v.path} lines ${s.from}-${s.to} of ${s.total}`;
      const tail = s.next ? `\n[more: call again with start=${s.next}]` : "";
      return text(`${head}\n${s.text}${tail}`);
    },
  };

  const worldSearch: ToolDef = {
    name: "world_search",
    description: "Search the readable source for a literal string or a /regex/ (flag i allowed). Returns at most 50 hits as file:line:snippet. glob narrows the files, e.g. src/components/**.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "a literal, or /regex/ or /regex/i" },
        glob: { type: "string", description: "optional path glob with * ** ?" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    access: "open",
    handler: async (args, ctx): Promise<ToolResult> => {
      const m = buildMatcher(args.query);
      if (!m.ok) return text(`That query cannot run: ${m.reason}.`, true);
      let globRe: RegExp | null = null;
      if (args.glob !== undefined && args.glob !== null && args.glob !== "") {
        globRe = typeof args.glob === "string" ? globToRegExp(args.glob) : null;
        if (!globRe) return text("That glob cannot be used.", true);
      }
      const fs = await deps.getFs();
      const started = ctx.now();
      const hits: string[] = [];
      let files = 0;
      let lines = 0;
      let stopped = "";
      const walk = (dir: string): void => {
        if (stopped) return;
        for (const name of fs.readdir(dir)) {
          if (stopped) return;
          if (RESOLVE_DIRS_SKIP.has(name.toLowerCase()) || name.toLowerCase().startsWith(".env")) continue;
          const rel = dir ? `${dir}/${name}` : name;
          const st = fs.stat(rel);
          if (!st) continue;
          if (st.dir) { walk(rel); continue; }
          if (!st.file || st.size > READ_MAX_FILE_BYTES) continue;
          if (!readPolicy(rel).ok) continue;
          if (globRe && !globRe.test(rel)) continue;
          if (++files > SEARCH_MAX_FILES || ctx.now() - started > SEARCH_MAX_MS) { stopped = "the search budget ran out"; return; }
          const body = fs.read(rel);
          if (body === null) continue;
          const ls = body.split("\n");
          for (let i = 0; i < ls.length; i++) {
            if (++lines > SEARCH_MAX_LINES) { stopped = "the search budget ran out"; return; }
            const l = ls[i].length > 300 ? ls[i].slice(0, 300) : ls[i];
            if (m.test(l)) {
              hits.push(`${rel}:${i + 1}:${l.trim().slice(0, 160)}`);
              if (hits.length >= SEARCH_MAX_HITS) { stopped = `stopped at ${SEARCH_MAX_HITS} hits`; return; }
            }
          }
        }
      };
      for (const r of SEARCH_ROOTS) walk(r);
      for (const f of ["README.md", "DESIGN.md", "INSPIRATION.md", "AGENTS.md", "CLAUDE.md", "package.json"]) {
        if (stopped || (globRe && !globRe.test(f))) continue;
        const body = fs.read(f);
        if (body === null) continue;
        body.split("\n").forEach((l, i) => {
          if (hits.length < SEARCH_MAX_HITS && m.test(l.slice(0, 300))) hits.push(`${f}:${i + 1}:${l.trim().slice(0, 160)}`);
        });
      }
      if (!hits.length) return text(`No hits.${stopped ? ` (${stopped})` : ""}`);
      return text(`${hits.join("\n")}${stopped ? `\n[${stopped}]` : ""}`);
    },
  };

  const worldPatch: ToolDef = {
    name: "world_patch",
    description: "Propose a change to the world's own code: up to 5 whole files under src, docs, public or test scripts. dry_run defaults to true and reports policy, size, syntax and a diff summary; dry_run false commits to the configured code branch.",
    inputSchema: {
      type: "object",
      properties: {
        instance: { type: "string", description: "the world proposing the change" },
        files: {
          type: "array",
          maxItems: WRITE_MAX_FILES,
          items: {
            type: "object",
            properties: { path: { type: "string" }, content: { type: "string" } },
            required: ["path", "content"],
            additionalProperties: false,
          },
        },
        message: { type: "string", description: "8 to 200 characters, one line" },
        dry_run: { type: "boolean", description: "default true" },
      },
      required: ["instance", "files", "message"],
      additionalProperties: false,
    },
    access: "write",
    handler: async (args, ctx: ToolCtx): Promise<ToolResult> => {
      if (!ctx.authed) return text("This tool needs the write token and is off until the owner arms it.", true);
      const instance = typeof args.instance === "string" ? args.instance : "";
      if (!INSTANCE_RE.test(instance)) return text("instance must be a world code of 8 to 16 lowercase letters and digits.", true);
      const msgErr = validMessage(args.message);
      if (msgErr) return text(`${msgErr}.`, true);
      const message = args.message as string;
      const raw = args.files;
      if (!Array.isArray(raw) || !raw.length) return text("files must be a non-empty list of {path, content}.", true);
      if (raw.length > WRITE_MAX_FILES) return text(`At most ${WRITE_MAX_FILES} files per patch.`, true);
      const dry = args.dry_run !== false;

      const fs = await deps.getFs();
      const seen = new Set<string>();
      const rows: { path: string; content: string; status: string; bytes: number; syntax: string; policy: string; ok: boolean; diff: string }[] = [];
      for (const f of raw as unknown[]) {
        const o = f && typeof f === "object" ? (f as Record<string, unknown>) : {};
        if (typeof o.content !== "string") return text("every file needs a string content.", true);
        const v = writePolicy(o.path);
        const bytes = Buffer.byteLength(o.content);
        if (!v.ok) {
          rows.push({ path: String(o.path).slice(0, 120), content: "", status: "-", bytes, syntax: "-", policy: `denied(${v.reason})`, ok: false, diff: "" });
          continue;
        }
        if (seen.has(v.path.toLowerCase())) return text(`${v.path} appears twice in one patch.`, true);
        seen.add(v.path.toLowerCase());
        let policy = "ok";
        let ok = true;
        if (bytes > WRITE_MAX_FILE_BYTES) { policy = "denied(larger than 200 KB)"; ok = false; }
        else if (o.content.includes("\u0000")) { policy = "denied(binary content)"; ok = false; }
        const before = fs.stat(v.path)?.file ? fs.read(v.path) : null;
        const status = before === null ? "new" : before === o.content ? "same" : "changed";
        const syntax = ok ? await deps.checkSyntax(v.path, o.content) : "-";
        const d = lineDiff(before ?? "", o.content);
        rows.push({ path: v.path, content: o.content, status, bytes, syntax, policy, ok, diff: status === "same" ? "" : `+${before === null ? o.content.split("\n").length : d.added} -${before === null ? 0 : d.removed}` });
      }
      const syntaxBad = rows.filter((r) => r.syntax.startsWith("error"));
      const denied = rows.filter((r) => !r.ok);
      const changing = rows.filter((r) => r.ok && r.status !== "same");
      const now = ctx.now();
      const wait = deps.limiter.check(instance, now);
      const branch = (ctx.env.UNIVERSE_CODE_BRANCH || "universe").trim() || "universe";
      const repo = (ctx.env.UNIVERSE_GITHUB_REPO || "jawauntb/objetdart_proj").trim();
      const blockers: string[] = [];
      if (denied.length) blockers.push(`${denied.length} file(s) denied by policy`);
      if (syntaxBad.length) blockers.push(`${syntaxBad.length} file(s) with syntax errors`);
      if (!changing.length && !denied.length) blockers.push("nothing would change");
      if (wait) blockers.push(wait);

      const report = [
        `world_patch ${dry ? "dry run" : "commit"} for ${instance}: ${message}`,
        ...rows.map((r) => `- ${r.path}: ${r.status}, ${r.bytes} bytes, syntax ${r.syntax}, policy ${r.policy}${r.diff ? `, lines ${r.diff}` : ""}`),
      ];

      if (dry) {
        report.push(
          blockers.length
            ? `A commit would be refused: ${blockers.join("; ")}.`
            : `A commit would write ${changing.length} file(s) to branch ${branch} of ${repo} as one commit, "universe(${instance}): ${message}".`,
        );
        report.push(ctx.env.UNIVERSE_GITHUB_TOKEN ? "The GitHub token is set." : "The GitHub token is not set, so dry_run false would be refused.");
        return text(scrub(report.join("\n"), ctx.env.UNIVERSE_GITHUB_TOKEN || ""));
      }

      const token = ctx.env.UNIVERSE_GITHUB_TOKEN || "";
      if (token.length < 8) return text("Commits are not armed: UNIVERSE_GITHUB_TOKEN is not set on the server. Use dry_run true, or ask the owner to set it.", true);
      if (!REPO_RE.test(repo)) return text("Commits are not armed: UNIVERSE_GITHUB_REPO is not owner/name.", true);
      if (blockers.length) return text(scrub(`${report.join("\n")}\nNothing was committed: ${blockers.join("; ")}.`, token), true);

      deps.limiter.record(instance, now);
      const res = await commitFiles({
        fetch: deps.fetch, token, repo, branch, instance, message,
        files: changing.map((r) => ({ path: r.path, content: r.content })),
      });
      if (!res.ok) return text(scrub(`Nothing was committed: ${res.error}.`, token), true);
      const live = branch === "main";
      return text(scrub([
        `Committed ${changing.length} file(s) as ${res.sha}.`,
        res.url,
        `branch: ${res.branch}${res.createdBranch ? " (created from the default branch)" : ""}`,
        live
          ? "This is the deploy branch: the host redeploys from it; a failed build leaves the previous deploy serving."
          : "It is on a side branch; the owner merges it to change the live world.",
      ].join("\n"), token));
    },
  };

  return [worldRead, worldSearch, worldPatch];
}

export const TOOLS: ToolDef[] = createCodeTools();
