// One world, bound: /mcp/i/<code> — every call implies `instance: <code>`.
import { notHere, serveMcp } from "@/lib/universe-mcp/serve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CODE_RE = /^[a-z0-9]{8,16}$/;

export async function POST(req: Request, { params }: { params: { code: string } }) {
  const code = String(params.code || "").toLowerCase();
  if (!CODE_RE.test(code)) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "no such world code" } }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }
  return serveMcp(req, code);
}
export const GET = notHere;
export const DELETE = notHere;
