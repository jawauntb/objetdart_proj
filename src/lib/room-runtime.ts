/**
 * room-runtime — shared performance primitives for living rooms.
 *
 * Extracted so every canvas/WebGL room can pause when hidden, pick a DPR
 * tier, govern frame detail from real frame time, and debounce persistence
 * without inventing a private bus. Pure helpers + tiny DOM subscriptions;
 * no React, no audio, no gesture thresholds.
 */

export type QualityTier = "high" | "medium" | "low" | "sleep";

export type QualityContext = {
  /** Prefer lower tiers inside gallery iframes and reduced-motion. */
  embedded?: boolean;
  reducedMotion?: boolean;
  /** Override: force a ceiling (e.g. mobile). */
  maxDpr?: number;
};

/** Resolve a device-pixel ratio for the given quality tier. */
export function resolveDpr(tier: QualityTier = "high", ctx: QualityContext = {}): number {
  const device = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const ceiling =
    ctx.maxDpr ??
    (tier === "sleep" ? 1 : tier === "low" ? 1.25 : tier === "medium" ? 1.5 : 2);
  const base = Math.min(device, ceiling);
  if (ctx.reducedMotion) return Math.min(base, 1.25);
  if (ctx.embedded) return Math.min(base, tier === "high" ? 1.5 : base);
  return base;
}

/**
 * Pick a quality tier from recent frame time (ms). Call once per second or
 * so — not every frame — so the tier doesn't chatter.
 */
export function tierFromFrameMs(frameMs: number, prev: QualityTier = "high"): QualityTier {
  if (frameMs > 28) return "low";
  if (frameMs > 20) return prev === "low" ? "low" : "medium";
  if (frameMs < 14) return "high";
  return prev === "high" ? "high" : "medium";
}

/** Detail multipliers rooms can multiply particle counts / sample steps by. */
export function detailForTier(tier: QualityTier): {
  particles: number;
  samples: number;
  shadows: number;
  simHz: number;
} {
  switch (tier) {
    case "sleep":
      return { particles: 0.15, samples: 0.25, shadows: 0, simHz: 8 };
    case "low":
      return { particles: 0.4, samples: 0.5, shadows: 0.35, simHz: 24 };
    case "medium":
      return { particles: 0.7, samples: 0.75, shadows: 0.7, simHz: 36 };
    default:
      return { particles: 1, samples: 1, shadows: 1, simHz: 60 };
  }
}

/**
 * Subscribe to document visibility. Fires immediately with the current
 * state. Returns an unsubscribe.
 */
export function onVisibility(fn: (hidden: boolean) => void): () => void {
  if (typeof document === "undefined") return () => {};
  const fire = () => fn(document.hidden);
  fire();
  document.addEventListener("visibilitychange", fire);
  return () => document.removeEventListener("visibilitychange", fire);
}

/**
 * Gallery iframe pause protocol. Parent posts `{ type: "objetdart:room", pause: true|false }`.
 * Rooms call this once and treat `paused` as a hard sleep bit alongside document.hidden.
 */
export function onGalleryPause(fn: (paused: boolean) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (ev: MessageEvent) => {
    const data = ev.data;
    if (!data || typeof data !== "object") return;
    if ((data as { type?: string }).type !== "objetdart:room") return;
    if (typeof (data as { pause?: unknown }).pause === "boolean") {
      fn((data as { pause: boolean }).pause);
    }
  };
  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}

/** True when this document is running inside a cross-origin or same-origin iframe. */
export function isEmbeddedFrame(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/**
 * Debounced / idle localStorage writer. Coalesces rapid saves; prefers
 * requestIdleCallback when available. Call `flush()` on unmount.
 */
export function createIdleWriter(write: () => void, delayMs = 400): {
  schedule: () => void;
  flush: () => void;
  cancel: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let idleId: number | null = null;
  let pending = false;

  const run = () => {
    timer = null;
    idleId = null;
    if (!pending) return;
    pending = false;
    try {
      write();
    } catch {
      /* quota / private mode */
    }
  };

  const schedule = () => {
    pending = true;
    if (timer != null || idleId != null) return;
    timer = setTimeout(() => {
      timer = null;
      const ric = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
        .requestIdleCallback;
      if (typeof ric === "function") {
        idleId = ric(run, { timeout: 800 });
      } else {
        run();
      }
    }, delayMs);
  };

  const cancel = () => {
    if (timer != null) clearTimeout(timer);
    timer = null;
    const cic = (globalThis as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
    if (idleId != null && typeof cic === "function") cic(idleId);
    idleId = null;
    pending = false;
  };

  const flush = () => {
    if (timer != null) clearTimeout(timer);
    timer = null;
    const cic = (globalThis as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
    if (idleId != null && typeof cic === "function") cic(idleId);
    idleId = null;
    if (pending) run();
  };

  return { schedule, flush, cancel };
}

/**
 * Lightweight frame governor: tracks ema frame time and exposes a quality
 * tier that rooms re-read from a ref each draw.
 */
export function createFrameGovernor(initial: QualityTier = "high"): {
  beginFrame: (now: number) => QualityTier;
  tier: () => QualityTier;
  force: (t: QualityTier) => void;
} {
  let tier: QualityTier = initial;
  let last = 0;
  let ema = 16.7;
  let sinceRetier = 0;

  return {
    beginFrame(now: number) {
      if (last > 0) {
        const dt = Math.min(64, now - last);
        ema = ema * 0.9 + dt * 0.1;
        sinceRetier += dt;
        if (sinceRetier > 750) {
          tier = tierFromFrameMs(ema, tier);
          sinceRetier = 0;
        }
      }
      last = now;
      return tier;
    },
    tier: () => tier,
    force(t: QualityTier) {
      tier = t;
    },
  };
}
