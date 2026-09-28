// Universe MCP — the window hub. A live page (a real browser on a real room)
// attaches one event stream under its world code; a tool call is relayed down
// that stream and the page posts the result back. Nothing about the person
// crosses: the hub keeps the code, the route the page is on, and the calls in
// flight. It never sees or stores an address. Pure and injectable: the sink is
// anything with write/end, the clock is passed in.

export const CODE_RE = /^[a-z0-9]{8,16}$/;
export const KEY_RE = /^[A-Za-z0-9_-]{12,64}$/;

export type Sink = { write(chunk: string): boolean | void; end(): void };
export type CallOutcome = { ok: true; result: unknown } | { ok: false; reason: string };
export type AttachOutcome = { ok: true } | { ok: false; reason: "bad-code" | "code-taken" | "full" };

type Win = {
  key: string;
  sink: Sink | null;
  route: string;
  since: number;
  calls: Map<string, { resolve: (o: CallOutcome) => void; timer: ReturnType<typeof setTimeout> }>;
  recent: number[];
  beat: ReturnType<typeof setInterval> | null;
  dropTimer: ReturnType<typeof setTimeout> | null;
};

export type HubOptions = {
  now?: () => number;
  callTimeoutMs?: number;
  perMin?: number;
  maxWindows?: number;
  beatMs?: number;
  graceMs?: number;
  maxInFlight?: number;
};

const cleanRoute = (r: unknown) =>
  String(r == null ? "" : r).replace(/[\u0000-\u001f]+/g, " ").split("?")[0].split("#")[0].slice(0, 120);

const unref = (t: unknown) => {
  const x = t as { unref?: () => void };
  if (x && typeof x.unref === "function") x.unref();
};

export function createHub(opts: HubOptions = {}) {
  const now = opts.now ?? Date.now;
  const callTimeoutMs = opts.callTimeoutMs ?? 20000;
  const perMin = opts.perMin ?? 20;
  const maxWindows = opts.maxWindows ?? 2000;
  const beatMs = opts.beatMs ?? 20000;
  const graceMs = opts.graceMs ?? 15000;
  const maxInFlight = opts.maxInFlight ?? 4;
  const wins = new Map<string, Win>();
  let seq = 0;

  const send = (sink: Sink, event: string, data: unknown) => {
    try {
      return sink.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) !== false;
    } catch {
      return false;
    }
  };

  function drop(code: string) {
    const w = wins.get(code);
    if (!w) return;
    for (const [, c] of w.calls) {
      clearTimeout(c.timer);
      c.resolve({ ok: false, reason: "gone" });
    }
    w.calls.clear();
    if (w.beat) clearInterval(w.beat);
    if (w.dropTimer) clearTimeout(w.dropTimer);
    wins.delete(code);
  }

  return {
    size: () => wins.size,

    attach(code: string, key: string, sink: Sink, route = ""): AttachOutcome {
      if (!CODE_RE.test(String(code || "")) || !KEY_RE.test(String(key || ""))) return { ok: false, reason: "bad-code" };
      let w = wins.get(code);
      if (w && w.key !== key) return { ok: false, reason: "code-taken" };
      if (!w && wins.size >= maxWindows) return { ok: false, reason: "full" };
      if (!w) {
        w = { key, sink: null, route: "", since: now(), calls: new Map(), recent: [], beat: null, dropTimer: null };
        wins.set(code, w);
      }
      if (w.dropTimer) clearTimeout(w.dropTimer);
      w.dropTimer = null;
      if (w.beat) clearInterval(w.beat);
      if (w.sink && w.sink !== sink) {
        try {
          w.sink.end();
        } catch {}
      }
      w.sink = sink;
      w.route = cleanRoute(route);
      const win = w;
      w.beat = setInterval(() => {
        if (win.sink) {
          try {
            win.sink.write(": beat\n\n");
          } catch {}
        }
      }, beatMs);
      unref(w.beat);
      send(sink, "hello", { code });
      return { ok: true };
    },

    detach(code: string, sink: Sink) {
      const w = wins.get(code);
      if (!w || w.sink !== sink) return;
      w.sink = null;
      if (w.beat) clearInterval(w.beat);
      w.beat = null;
      w.dropTimer = setTimeout(() => {
        if (!w.sink) drop(code);
      }, graceMs);
      unref(w.dropTimer);
    },

    /** The page says which route it is on (no call id). */
    setRoute(code: string, key: string, route: unknown): boolean {
      const w = wins.get(String(code || ""));
      if (!w || w.key !== key) return false;
      w.route = cleanRoute(route);
      return true;
    },

    reply(code: string, key: string, id: string, result: unknown): { ok: boolean; reason?: string } {
      const w = wins.get(String(code || ""));
      if (!w || w.key !== key) return { ok: false, reason: "not-yours" };
      const c = w.calls.get(String(id || ""));
      if (!c) return { ok: false, reason: "no-such-call" };
      w.calls.delete(String(id));
      clearTimeout(c.timer);
      c.resolve({ ok: true, result });
      return { ok: true };
    },

    call(code: string, action: string, args: Record<string, unknown> = {}, at: number = now()): Promise<CallOutcome> {
      const w = wins.get(String(code || ""));
      if (!w) return Promise.resolve({ ok: false, reason: "no-window" });
      if (!w.sink) return Promise.resolve({ ok: false, reason: "away" });
      w.recent = w.recent.filter((t) => at - t < 60000);
      if (w.recent.length >= perMin || w.calls.size >= maxInFlight) return Promise.resolve({ ok: false, reason: "busy" });
      w.recent.push(at);
      const id = `c${++seq}`;
      const sink = w.sink;
      return new Promise<CallOutcome>((resolve) => {
        const timer = setTimeout(() => {
          w.calls.delete(id);
          resolve({ ok: false, reason: "timeout" });
        }, callTimeoutMs);
        w.calls.set(id, { resolve, timer });
        if (!send(sink, "call", { id, action, args })) {
          clearTimeout(timer);
          w.calls.delete(id);
          resolve({ ok: false, reason: "away" });
        }
      });
    },

    /** Windows with a live page: the code and the route. Nothing about the person. */
    list(at: number = now()) {
      return [...wins.entries()]
        .filter(([, w]) => w.sink)
        .map(([instance, w]) => ({ instance, route: w.route, openSeconds: Math.max(0, Math.round((at - w.since) / 1000)) }))
        .sort((a, b) => (a.instance < b.instance ? -1 : 1));
    },
  };
}

export type Hub = ReturnType<typeof createHub>;

const SLOT = "__universeWindowHub";
export function getHub(): Hub {
  const g = globalThis as unknown as Record<string, Hub | undefined>;
  if (!g[SLOT]) g[SLOT] = createHub();
  return g[SLOT] as Hub;
}
