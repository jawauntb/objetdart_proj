import { getHub, type Sink } from "@/lib/universe-mcp/windows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS = { "bad-code": 400, "code-taken": 409, full: 503 } as const;

export async function GET(req: Request) {
  const u = new URL(req.url);
  const code = u.searchParams.get("code") ?? "";
  const key = u.searchParams.get("key") ?? "";
  const enc = new TextEncoder();
  let ctl: ReadableStreamDefaultController<Uint8Array> | null = null;
  const queued: string[] = [];
  const sink: Sink = {
    write(c) {
      if (!ctl) {
        queued.push(c);
        return true;
      }
      try {
        ctl.enqueue(enc.encode(c));
        return true;
      } catch {
        return false;
      }
    },
    end() {
      try {
        ctl?.close();
      } catch {}
    },
  };
  const hub = getHub();
  const r = hub.attach(code, key, sink, u.searchParams.get("route") ?? "");
  if (!r.ok) {
    return Response.json({ ok: false, reason: r.reason }, { status: STATUS[r.reason], headers: { "cache-control": "no-store" } });
  }
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctl = c;
      for (const q of queued.splice(0)) c.enqueue(enc.encode(q));
    },
    cancel() {
      hub.detach(code, sink);
    },
  });
  req.signal.addEventListener("abort", () => hub.detach(code, sink));
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
