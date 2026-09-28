// Universe MCP — code-fs: the one place that touches node:fs for the code tools.
// It is loaded lazily by tools-code so tests and other lanes never need it.
import * as fs from "node:fs";
import * as path from "node:path";
import type { CodeFs } from "@/lib/universe-mcp/code-policy";

/** Reads a checkout rooted at `root`. Symlinks are refused; nothing outside root is reachable. */
export function nodeFs(root: string): CodeFs {
  const abs = (rel: string) => path.join(root, ...rel.split("/"));
  const inside = (p: string) => {
    const r = path.relative(root, p);
    return !!r && !r.startsWith("..") && !path.isAbsolute(r);
  };
  return {
    stat(rel) {
      try {
        const p = abs(rel);
        if (!inside(p)) return null;
        const st = fs.lstatSync(p);
        if (st.isSymbolicLink()) return null;
        return { size: st.size, file: st.isFile(), dir: st.isDirectory() };
      } catch {
        return null;
      }
    },
    read(rel) {
      try {
        const p = abs(rel);
        if (!inside(p)) return null;
        const st = fs.lstatSync(p);
        if (!st.isFile()) return null;
        return fs.readFileSync(p, "utf8");
      } catch {
        return null;
      }
    },
    readdir(rel) {
      try {
        const p = abs(rel);
        if (!inside(p)) return [];
        return fs.readdirSync(p).sort();
      } catch {
        return [];
      }
    },
  };
}
