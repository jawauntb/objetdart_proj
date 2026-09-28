// The one function both MCP routes call: a Request in, a Response out.

import { ALL_TOOLS, INSTRUCTIONS, makeCtx } from "@/lib/universe-mcp/index";
import { createLimiter, handleRpc } from "@/lib/universe-mcp/protocol";

const limited = createLimiter(120);

const json = (status: number, body: unknown) =>
  status === 202 || body === null
    ? new Response(null, { status })
    : new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });

export async function serveMcp(req: Request, bound: string | null): Promise<Response> {
  const ctx = makeCtx(req, process.env, bound);
  if (limited(ctx.ip)) {
    return json(429, { jsonrpc: "2.0", id: null, error: { code: -32000, message: "too many calls from here this minute; wait a little" } });
  }
  let msg: unknown;
  try {
    msg = await req.json();
  } catch {
    return json(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
  }
  const out = await handleRpc(msg, { tools: ALL_TOOLS, ctx, instructions: INSTRUCTIONS });
  return json(out.status, out.body);
}

export const notHere = () =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "POST JSON-RPC here; this server keeps no stream or session" } }), {
    status: 405,
    headers: { allow: "POST", "content-type": "application/json" },
  });
