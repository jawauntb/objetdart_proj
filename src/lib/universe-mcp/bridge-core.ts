// Universe MCP — the pure half of the browser bridge. Everything the page does
// for an animal is decided here and dispatched through an injected Env, so it
// runs in node tests exactly as it runs in a tab. The bridge only DISPATCHES
// pointer events at the point under the finger; the room's own gesture engine
// handles them as it would a person's touch. It adds no listener to a room.

import { THRESHOLDS } from "@/lib/gesture/core";
import { ROOM_BY_KEY, bandOf } from "@/lib/room-registry";
import { guideKeyForPath } from "@/lib/guide-route";

export const CODE_RE = /^[a-z0-9]{8,16}$/;
export const KEY_RE = /^[A-Za-z0-9_-]{12,64}$/;
export const STORAGE_PREFIX = "objetdart:";
export const MAX_HOLD_MS = 10000;

export function codeFromSearch(search: string): string | null {
  const q = new URLSearchParams(search).get("universe");
  return q && CODE_RE.test(q) ? q : null;
}

/** Where a room key or a route leads, or null. Never external. */
export function resolveNavigate(to: unknown): string | null {
  if (typeof to !== "string") return null;
  const t = to.trim();
  if (!t) return null;
  if (t === "home") return "/";
  if (Object.prototype.hasOwnProperty.call(ROOM_BY_KEY, t)) return ROOM_BY_KEY[t].href;
  if (!t.startsWith("/") || t.startsWith("//") || /[\\\u0000-\u001f]/.test(t)) return null;
  const path = t.split("?")[0].split("#")[0];
  if (path.includes("//") || path.split("/").includes("..")) return null;
  if (path !== "/" && guideKeyForPath(path) === null) return null;
  return t;
}

// ---- persisted state summary: sizes, never values ------------------------

const byteLength = (s: string) => new TextEncoder().encode(s).length;

export function summarizeStorage(entries: [string, string][]) {
  const out: { key: string; bytes: number; items?: number }[] = [];
  for (const [k, v] of entries) {
    if (!k.startsWith(STORAGE_PREFIX)) continue;
    const row: { key: string; bytes: number; items?: number } = { key: k, bytes: byteLength(v) };
    if (v.startsWith("[")) {
      try {
        const p = JSON.parse(v);
        if (Array.isArray(p)) row.items = p.length;
      } catch {}
    }
    out.push(row);
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : 1)).slice(0, 64);
}

// ---- chrome ---------------------------------------------------------------

export type ChainLink = { tag: string; cls: string; role?: string };
const CHROME_CLASS = /\boda-(help|sound-toggle|letgo|tape|field-watch|candle-mark|arrival)/;

/** True when a point lands on the frame (header, help, sound, let-go, tape), not the material. */
export function isChromeHit(chain: ChainLink[]): boolean {
  return chain.some((l) => {
    const tag = l.tag.toLowerCase();
    return tag === "header" || tag === "nav" || l.role === "dialog" || CHROME_CLASS.test(l.cls || "");
  });
}

// ---- gesture scripts -------------------------------------------------------

export type PtrEvent = { t: number; type: "pointerdown" | "pointermove" | "pointerup"; pointerId: number; x: number; y: number };
export type Viewport = { w: number; h: number };

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const STEPS = 8;

/** A gesture as timed pointer events. Every duration derives from THRESHOLDS. */
export function gestureScript(args: Record<string, unknown>, vp: Viewport, idBase = 1): PtrEvent[] | { error: string } {
  const verb = String(args.verb ?? "");
  const cx = clamp(num(args.x, 0.5), 0, 1) * vp.w;
  const cy = clamp(num(args.y, 0.5), 0, 1) * vp.h;
  const min = Math.min(vp.w, vp.h);
  const ev: PtrEvent[] = [];
  const P = (t: number, type: PtrEvent["type"], i: number, x: number, y: number) =>
    ev.push({ t: Math.round(t), type, pointerId: idBase + i, x, y });

  if (verb === "tap") {
    const n = clamp(Math.round(num(args.count, 1)), 1, THRESHOLDS.tapTrainCap);
    const period = Math.floor(THRESHOLDS.tapTrainMs * 0.75);
    const press = Math.floor(THRESHOLDS.tapMaxMs * 0.4);
    for (let i = 0; i < n; i++) {
      P(i * period, "pointerdown", 0, cx, cy);
      P(i * period + press, "pointerup", 0, cx, cy);
    }
  } else if (verb === "hold") {
    const ms = clamp(Math.round(num(args.ms, THRESHOLDS.dwellMs + THRESHOLDS.tapMaxMs)), THRESHOLDS.tapMaxMs + 1, MAX_HOLD_MS);
    P(0, "pointerdown", 0, cx, cy);
    P(ms, "pointerup", 0, cx, cy);
  } else if (verb === "drag") {
    const dx = clamp(num(args.dx, 0.2), -1, 1) * vp.w;
    const dy = clamp(num(args.dy, 0), -1, 1) * vp.h;
    const dist = Math.hypot(dx, dy);
    const calm = Math.ceil(dist / (THRESHOLDS.flickVel * 0.5));
    const ms = clamp(Math.round(num(args.ms, Math.max(THRESHOLDS.tapMaxMs * 2, calm))), THRESHOLDS.tapMaxMs, MAX_HOLD_MS);
    P(0, "pointerdown", 0, cx, cy);
    for (let s = 1; s <= STEPS; s++) P((ms * s) / STEPS, "pointermove", 0, cx + (dx * s) / STEPS, cy + (dy * s) / STEPS);
    P(ms, "pointerup", 0, cx + dx, cy + dy);
  } else if (verb === "pinch") {
    const s0 = 0.2 * min;
    const s1 = Math.max(2, s0 + clamp(num(args.dx, 0.2), -0.19, 1) * min);
    const ms = clamp(Math.round(num(args.ms, THRESHOLDS.tapMaxMs * 2)), THRESHOLDS.tapMaxMs, MAX_HOLD_MS);
    P(0, "pointerdown", 0, cx - s0 / 2, cy);
    P(0, "pointerdown", 1, cx + s0 / 2, cy);
    for (let s = 1; s <= STEPS; s++) {
      const w = s0 + ((s1 - s0) * s) / STEPS;
      P((ms * s) / STEPS, "pointermove", 0, cx - w / 2, cy);
      P((ms * s) / STEPS, "pointermove", 1, cx + w / 2, cy);
    }
    P(ms, "pointerup", 0, cx - s1 / 2, cy);
    P(ms, "pointerup", 1, cx + s1 / 2, cy);
  } else if (verb === "twist") {
    const r = 0.1 * min;
    const ang = (clamp(num(args.angle, 45), -180, 180) * Math.PI) / 180;
    const ms = clamp(Math.round(num(args.ms, THRESHOLDS.tapMaxMs * 2)), THRESHOLDS.tapMaxMs, MAX_HOLD_MS);
    const at = (a: number, i: number) => [cx + Math.cos(a + i * Math.PI) * r, cy + Math.sin(a + i * Math.PI) * r] as const;
    for (let i = 0; i < 2; i++) P(0, "pointerdown", i, ...at(0, i));
    for (let s = 1; s <= STEPS; s++) for (let i = 0; i < 2; i++) P((ms * s) / STEPS, "pointermove", i, ...at((ang * s) / STEPS, i));
    for (let i = 0; i < 2; i++) P(ms, "pointerup", i, ...at(ang, i));
  } else if (verb === "chord") {
    const n = clamp(Math.round(num(args.fingers, 3)), 2, 5);
    const gap = Math.floor((THRESHOLDS.chordSettleMs - 1) / (n - 1));
    const r = 0.03 * min;
    const at = (i: number) => [cx + Math.cos((i / n) * 2 * Math.PI) * r, cy + Math.sin((i / n) * 2 * Math.PI) * r] as const;
    const settle = (n - 1) * gap;
    for (let i = 0; i < n; i++) P(i * gap, "pointerdown", i, ...at(i));
    const hold = clamp(Math.round(num(args.ms, Math.floor(THRESHOLDS.tapMaxMs / 2))), 1, MAX_HOLD_MS);
    for (let i = 0; i < n; i++) P(settle + hold, "pointerup", i, ...at(i));
  } else {
    return { error: "The verb must be one of tap, hold, drag, pinch, twist, chord." };
  }
  return ev.sort((a, b) => a.t - b.t);
}

// ---- executor ---------------------------------------------------------------

export type Env = {
  pathname(): string;
  title(): string;
  viewport(): Viewport;
  canvases(): { w: number; h: number }[];
  storage(): [string, string][];
  push(href: string): void;
  hit(x: number, y: number): { target: unknown; chain: ChainLink[] } | null;
  dispatch(target: unknown, type: PtrEvent["type"], init: { pointerId: number; x: number; y: number; primary: boolean }): void;
  sleep(ms: number): Promise<void>;
};

export type Outcome = { ok: true; [k: string]: unknown } | { ok: false; error: string };

export function roomFacts(pathname: string) {
  const key = guideKeyForPath(pathname);
  const e = key ? ROOM_BY_KEY[key] : undefined;
  return { key, entry: e, band: e ? bandOf(e) : null };
}

export function look(env: Env) {
  const path = env.pathname();
  const { key, band } = roomFacts(path);
  const cs = env.canvases();
  return {
    ok: true as const,
    route: path,
    room: key,
    title: env.title().slice(0, 120),
    band,
    viewport: env.viewport(),
    canvases: { count: cs.length, sizes: cs.slice(0, 8) },
    persisted: summarizeStorage(env.storage()),
  };
}

export function state(env: Env) {
  const { key, entry, band } = roomFacts(env.pathname());
  if (!entry) return { ok: true as const, room: key, href: env.pathname() };
  return {
    ok: true as const,
    room: entry.key,
    href: entry.href,
    kind: entry.kind,
    band,
    creates: entry.creates,
    interacts: entry.interacts ?? null,
    keeps: entry.keeps,
    chrome: entry.chrome,
    exempt: Object.keys(entry.exempt),
  };
}

let ids = 0;

export async function gesture(env: Env, args: Record<string, unknown>): Promise<Outcome> {
  const vp = env.viewport();
  const script = gestureScript(args, vp, 1000 + ((ids += 8) % 100000));
  if (!Array.isArray(script)) return { ok: false, error: script.error };
  const targets = new Map<number, unknown>();
  for (const e of script) {
    if (e.type !== "pointerdown") continue;
    const h = env.hit(e.x, e.y);
    if (!h) return { ok: false, error: "That point is outside the page." };
    if (isChromeHit(h.chain)) return { ok: false, error: "That point is on the frame (header, help, sound or let-go). Touch the material instead." };
    targets.set(e.pointerId, h.target);
  }
  let at = 0;
  const first = script[0]?.pointerId;
  for (const e of script) {
    if (e.t > at) {
      await env.sleep(e.t - at);
      at = e.t;
    }
    env.dispatch(targets.get(e.pointerId), e.type, { pointerId: e.pointerId, x: e.x, y: e.y, primary: e.pointerId === first });
  }
  return { ok: true, verb: String(args.verb), events: script.length, ms: at };
}

export async function execute(env: Env, action: string, args: Record<string, unknown>): Promise<Outcome> {
  if (action === "look") return look(env);
  if (action === "state") return state(env);
  if (action === "navigate") {
    const href = resolveNavigate(args.to);
    if (!href) return { ok: false, error: "That is not a room or route of this site." };
    env.push(href);
    return { ok: true, to: href };
  }
  if (action === "gesture") return gesture(env, args);
  return { ok: false, error: "The action must be look, navigate, gesture or state." };
}
