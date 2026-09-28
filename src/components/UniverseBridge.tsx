"use client";

// The window an animal looks through. Inert unless the URL carries
// ?universe=<code>: an ordinary visitor's page makes no request and adds no
// listener. It renders nothing, ever. Its work is in the bridge core.

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

const CODE_RE = /^[a-z0-9]{8,16}$/;
const CODE_SLOT = "od-universe-code";
const KEY_SLOT = "od-universe-key";

function tabCode(): string | null {
  try {
    const q = new URLSearchParams(window.location.search).get("universe");
    if (q && CODE_RE.test(q)) {
      sessionStorage.setItem(CODE_SLOT, q);
      return q;
    }
    const s = sessionStorage.getItem(CODE_SLOT);
    return s && CODE_RE.test(s) ? s : null;
  } catch {
    return null;
  }
}

function tabKey(): string {
  try {
    const s = sessionStorage.getItem(KEY_SLOT);
    if (s && /^[A-Za-z0-9_-]{12,64}$/.test(s)) return s;
  } catch {}
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  const k = Array.from(b, (x) => x.toString(36).padStart(2, "0")).join("").slice(0, 32);
  try {
    sessionStorage.setItem(KEY_SLOT, k);
  } catch {}
  return k;
}

export default function UniverseBridge() {
  const router = useRouter();
  const pathname = usePathname();
  const routerRef = useRef(router);
  routerRef.current = router;
  const live = useRef<{ code: string; key: string } | null>(null);

  useEffect(() => {
    const code = tabCode();
    if (!code) return;
    const key = tabKey();
    let es: EventSource | null = null;
    let closed = false;
    live.current = { code, key };
    const post = (body: unknown) =>
      fetch("/api/universe/window/reply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => {});

    import("@/lib/universe-mcp/bridge-core").then((core) => {
      if (closed) return;
      const env: import("@/lib/universe-mcp/bridge-core").Env = {
        pathname: () => window.location.pathname,
        title: () => document.title,
        viewport: () => ({ w: window.innerWidth, h: window.innerHeight }),
        canvases: () =>
          Array.from(document.querySelectorAll("canvas")).map((c) => ({ w: c.width, h: c.height })),
        storage: () => {
          const out: [string, string][] = [];
          try {
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (k && k.startsWith(core.STORAGE_PREFIX)) out.push([k, localStorage.getItem(k) ?? ""]);
            }
          } catch {}
          return out;
        },
        push: (href) => routerRef.current.push(href),
        hit: (x, y) => {
          const t = document.elementFromPoint(x, y);
          if (!t) return null;
          const chain: import("@/lib/universe-mcp/bridge-core").ChainLink[] = [];
          for (let n: Element | null = t; n; n = n.parentElement) {
            chain.push({
              tag: n.tagName,
              cls: typeof n.className === "string" ? n.className : "",
              role: n.getAttribute("role") ?? undefined,
            });
          }
          return { target: t, chain };
        },
        dispatch: (target, type, p) => {
          (target as Element).dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              composed: true,
              pointerId: p.pointerId,
              pointerType: "touch",
              isPrimary: p.primary,
              clientX: p.x,
              clientY: p.y,
              pressure: type === "pointerup" ? 0 : 0.5,
              width: 24,
              height: 24,
              button: 0,
              buttons: type === "pointerup" ? 0 : 1,
            }),
          );
        },
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      };
      const url =
        `/api/universe/window/stream?code=${code}&key=${key}&route=${encodeURIComponent(window.location.pathname)}`;
      es = new EventSource(url);
      es.addEventListener("call", (m) => {
        let c: { id?: string; action?: string; args?: Record<string, unknown> } = {};
        try {
          c = JSON.parse((m as MessageEvent).data);
        } catch {
          return;
        }
        core
          .execute(env, String(c.action ?? ""), c.args ?? {})
          .catch((e) => ({ ok: false, error: String(e && (e as Error).message ? (e as Error).message : e).slice(0, 200) }))
          .then((result) => post({ code, key, id: c.id, result }));
      });
    });
    return () => {
      closed = true;
      live.current = null;
      if (es) es.close();
    };
  }, []);

  useEffect(() => {
    const l = live.current;
    if (!l) return;
    fetch("/api/universe/window/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: l.code, key: l.key, route: pathname }),
    }).catch(() => {});
  }, [pathname]);

  return null;
}
