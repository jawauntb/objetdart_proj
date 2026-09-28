// Objet d'art as an MCP server. Stateless Streamable HTTP, same shape as the
// lattice animal's own server: every POST carries one JSON-RPC message and gets
// one JSON reply; notifications get 202; there are no sessions and no stream.
// The tools live in tools-*.ts and are gathered in ./index.ts.

import type { RpcOutcome, ToolCtx, ToolDef, ToolResult } from "@/lib/universe-mcp/types";

export const MCP_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export const text = (t: string, isError = false): ToolResult => ({
  content: [{ type: "text", text: t }],
  ...(isError ? { isError: true } : {}),
});

const ok = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: unknown, code: number, message: string) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

/** On a bound endpoint (/mcp/i/<code>) the `instance` argument is implied. */
export function toolsFor(tools: ToolDef[], bound: string | null) {
  return tools.map((t) => {
    const props = { ...t.inputSchema.properties };
    let required = t.inputSchema.required || [];
    if (bound) {
      delete props.instance;
      required = required.filter((r) => r !== "instance");
    }
    return {
      name: t.name,
      description: t.access === "write" ? `${t.description} (needs the write token)` : t.description,
      inputSchema: { ...t.inputSchema, properties: props, required },
    };
  });
}

export async function handleRpc(
  msg: unknown,
  opts: { tools: ToolDef[]; ctx: ToolCtx; version?: string; instructions?: string },
): Promise<RpcOutcome> {
  const { tools, ctx } = opts;
  const bound = ctx.bound;
  if (Array.isArray(msg)) return { status: 400, body: fail(null, -32600, "batches are not supported") };
  const m = msg as { jsonrpc?: string; id?: unknown; method?: unknown; params?: Record<string, unknown> } | null;
  if (!m || m.jsonrpc !== "2.0" || typeof m.method !== "string") {
    return { status: 400, body: fail(m && m.id, -32600, "invalid request") };
  }
  if (m.id === undefined || m.id === null) return { status: 202, body: null }; // a notification
  const p = m.params || {};
  try {
    if (m.method === "initialize") {
      const asked = String((p as { protocolVersion?: unknown }).protocolVersion || "");
      const v = MCP_VERSIONS.includes(asked) ? asked : MCP_VERSIONS[0];
      return {
        status: 200,
        body: ok(m.id, {
          protocolVersion: v,
          capabilities: { tools: { listChanged: false } },
          serverInfo: {
            name: bound ? `objetdart-${bound}` : "objetdart",
            title: bound ? `Objet d'art — world ${bound}` : "Objet d'art",
            version: opts.version || "1.0.0",
          },
          instructions: opts.instructions || "",
        }),
      };
    }
    if (m.method === "ping") return { status: 200, body: ok(m.id, {}) };
    if (m.method === "tools/list") return { status: 200, body: ok(m.id, { tools: toolsFor(tools, bound) }) };
    if (m.method === "tools/call") {
      const name = String((p as { name?: unknown }).name || "");
      const tool = tools.find((t) => t.name === name);
      if (!tool) return { status: 200, body: fail(m.id, -32602, `unknown tool: ${name}`) };
      if (tool.access === "write" && !ctx.authed) {
        return {
          status: 200,
          body: ok(m.id, text("this tool changes the world and needs the write token (Authorization: Bearer …); it is off until the owner arms it", true)),
        };
      }
      const raw = (p as { arguments?: unknown }).arguments;
      const args: Record<string, unknown> = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as object) } : {};
      if (bound) args.instance = bound;
      return { status: 200, body: ok(m.id, await tool.handler(args, ctx)) };
    }
    return { status: 200, body: fail(m.id, -32601, `method not found: ${m.method}`) };
  } catch {
    return { status: 200, body: ok(m.id, text("the tool failed", true)) };
  }
}

/** Per-address fixed-window limiter; memory only, never returned or logged. */
export function createLimiter(perMin: number, now: () => number = Date.now) {
  const seen = new Map<string, number[]>();
  return (ip: string): boolean => {
    if (!ip) return false;
    const t = now();
    const list = (seen.get(ip) || []).filter((x) => t - x < 60000);
    if (list.length >= perMin) {
      seen.set(ip, list);
      return true;
    }
    list.push(t);
    seen.set(ip, list);
    if (seen.size > 5000) seen.clear();
    return false;
  };
}
