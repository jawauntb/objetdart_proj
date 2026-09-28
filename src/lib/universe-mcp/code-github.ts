// Universe MCP — code-github: commit files through the GitHub Git Data REST API
// with an injected fetch. Never force, never delete, never echo the token.

export type GhResponse = { status: number; text: () => Promise<string> };
export type GhFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<GhResponse>;

export type CommitInput = {
  fetch: GhFetch;
  token: string;
  repo: string;
  branch: string;
  instance: string;
  message: string;
  files: { path: string; content: string }[];
};
export type CommitResult =
  | { ok: true; sha: string; url: string; branch: string; createdBranch: boolean }
  | { ok: false; error: string };

export const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
export const BRANCH_RE = /^[\w][\w./-]{0,99}$/;
export const TRAILER = "Authored-by: a lattice animal via the objet d'art MCP";

/** Remove the token and anything shaped like a GitHub credential from a string. */
export function scrub(s: string, token: string): string {
  let out = String(s);
  if (token) out = out.split(token).join("[token]");
  return out.replace(/(gh[pousr]_|github_pat_)[A-Za-z0-9_]+/g, "[token]").replace(/Bearer\s+\S+/gi, "Bearer [token]");
}

const API = "https://api.github.com";

export async function commitFiles(inp: CommitInput): Promise<CommitResult> {
  const { token, repo, branch } = inp;
  if (!REPO_RE.test(repo)) return { ok: false, error: "UNIVERSE_GITHUB_REPO is not owner/name" };
  if (!BRANCH_RE.test(branch) || branch.includes("..") || branch.endsWith("/") || branch.endsWith(".lock")) {
    return { ok: false, error: "UNIVERSE_CODE_BRANCH is not a usable branch name" };
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "objetdart-universe-mcp",
    "Content-Type": "application/json",
  };
  const call = async (method: string, path: string, body?: unknown) => {
    let res: GhResponse;
    try {
      res = await inp.fetch(`${API}/repos/${repo}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch (e) {
      throw new Failure(`could not reach GitHub: ${scrub(e instanceof Error ? e.message : String(e), token).slice(0, 160)}`);
    }
    let raw = "";
    try { raw = await res.text(); } catch { /* empty body */ }
    let json: Record<string, unknown> = {};
    try { json = raw ? JSON.parse(raw) : {}; } catch { /* not json */ }
    return { status: res.status, json, raw };
  };
  const bad = (step: string, r: { status: number; raw: string }) =>
    new Failure(`GitHub refused ${step} (${r.status}): ${scrub(r.raw, token).replace(/\s+/g, " ").slice(0, 200)}`);
  const str = (o: unknown, ...keys: string[]): string => {
    let v: unknown = o;
    for (const k of keys) v = v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined;
    return typeof v === "string" ? v : "";
  };

  let createdBranch = false;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      let ref = await call("GET", `/git/ref/heads/${branch}`);
      let head = str(ref.json, "object", "sha");
      if (ref.status === 404) {
        const info = await call("GET", "");
        if (info.status !== 200) throw bad("reading the repository", info);
        const def = str(info.json, "default_branch") || "main";
        const base = await call("GET", `/git/ref/heads/${def}`);
        const baseSha = str(base.json, "object", "sha");
        if (base.status !== 200 || !baseSha) throw bad("reading the default branch", base);
        const made = await call("POST", "/git/refs", { ref: `refs/heads/${branch}`, sha: baseSha });
        if (made.status === 422 && attempt === 0) continue;
        if (made.status !== 201) throw bad("creating the branch", made);
        createdBranch = true;
        head = baseSha;
      } else if (ref.status !== 200 || !head) throw bad("reading the branch", ref);

      const commit = await call("GET", `/git/commits/${head}`);
      const baseTree = str(commit.json, "tree", "sha");
      if (commit.status !== 200 || !baseTree) throw bad("reading the head commit", commit);

      const tree: { path: string; mode: string; type: string; sha: string }[] = [];
      for (const f of inp.files) {
        const b = await call("POST", "/git/blobs", { content: f.content, encoding: "utf-8" });
        const sha = str(b.json, "sha");
        if (b.status !== 201 || !sha) throw bad("storing a file", b);
        tree.push({ path: f.path, mode: "100644", type: "blob", sha });
      }
      const t = await call("POST", "/git/trees", { base_tree: baseTree, tree });
      const treeSha = str(t.json, "sha");
      if (t.status !== 201 || !treeSha) throw bad("building the tree", t);

      const c = await call("POST", "/git/commits", {
        message: `universe(${inp.instance}): ${inp.message}\n\n${TRAILER}`,
        tree: treeSha,
        parents: [head],
      });
      const sha = str(c.json, "sha");
      if (c.status !== 201 || !sha) throw bad("writing the commit", c);

      const moved = await call("PATCH", `/git/refs/heads/${branch}`, { sha, force: false });
      if ((moved.status === 409 || moved.status === 422) && attempt === 0) continue;
      if (moved.status === 409 || moved.status === 422) {
        return { ok: false, error: "the branch moved twice while committing; nothing was written, try again later" };
      }
      if (moved.status !== 200) throw bad("moving the branch", moved);
      return { ok: true, sha, url: `https://github.com/${repo}/commit/${sha}`, branch, createdBranch };
    }
    return { ok: false, error: "the branch moved while committing; nothing was written, try again later" };
  } catch (e) {
    if (e instanceof Failure) return { ok: false, error: e.message };
    return { ok: false, error: "the commit failed" };
  }
}

class Failure extends Error {}
