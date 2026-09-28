import { getHub } from "@/lib/universe-mcp/windows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const H = { "cache-control": "no-store, no-transform" };
const MAX = 64 * 1024;

export async function POST(req: Request) {
  let raw = "";
  try {
    raw = await req.text();
  } catch {}
  if (raw.length > MAX) return Response.json({ ok: false, reason: "too-big" }, { status: 413, headers: H });
  let b: Record<string, unknown> = {};
  try {
    const p = JSON.parse(raw);
    if (p && typeof p === "object") b = p as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, reason: "bad-json" }, { status: 400, headers: H });
  }
  const hub = getHub();
  const code = String(b.code ?? "");
  const key = String(b.key ?? "");
  // A post with a route and no call id only tells the hub where the page is.
  if (b.id === undefined && b.route !== undefined) {
    const ok = hub.setRoute(code, key, b.route);
    return Response.json({ ok }, { status: ok ? 200 : 403, headers: H });
  }
  const r = hub.reply(code, key, String(b.id ?? ""), b.result === undefined ? null : b.result);
  return Response.json(r, { status: r.reason === "not-yours" ? 403 : 200, headers: H });
}
