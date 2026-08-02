"use client";

/**
 * Gesture engine — the DOM half of the grammar (docs/gesture-grammar.md).
 *
 * Rooms mount `attachGestures(el, bindings)` and receive semantic events
 * (tap / hold / drag / pinch / twist / scrub / rhythm / …) instead of raw
 * pointers. Finger count addresses the stack: one finger the material, two
 * the frame, three the law; the device itself is the vessel (enableMotion),
 * breath meets the candle (enableBreath). All thresholds live in ./core.
 *
 * Feature-detected and SSR-safe throughout: attaching is always free, and a
 * missing sensor silently costs a dimension, never a feature.
 */

import {
  THRESHOLDS,
  holdTier,
  intensityFrom,
  decomposeTwoPointer,
  pathWinding,
  classifyRelease,
  tapTrain,
  rhythmFrom,
  shakeIntensity,
  type HoldTier,
  type Pt,
  type MotionSample,
  type Rhythm,
} from "./core";

export type Phase = "start" | "move" | "end";

export type GestureHandlers = {
  tap?: (e: { fingers: number; count: number; intensity: number; x: number; y: number }) => void;
  hold?: (e: {
    fingers: number;
    phase: "enter" | "tick" | "release";
    elapsed: number;
    tier: HoldTier;
    intensity: number;
    x: number;
    y: number;
  }) => void;
  drag?: (e: {
    fingers: number;
    phase: Phase;
    x: number;
    y: number;
    dx: number;
    dy: number;
    vx: number;
    vy: number;
  }) => void;
  flick?: (e: { fingers: number; angle: number; speed: number; x: number; y: number }) => void;
  pinch?: (e: { phase: Phase; scale: number; velocity: number; cx: number; cy: number }) => void;
  twist?: (e: { phase: Phase; angle: number; velocity: number; cx: number; cy: number }) => void;
  pan2?: (e: { phase: Phase; dx: number; dy: number; cx: number; cy: number }) => void;
  scrub?: (e: { winding: number; angularVelocity: number; cx: number; cy: number }) => void;
  rhythm?: (e: Rhythm) => void;
  shake?: (e: { intensity: number }) => void;
  tilt?: (e: { beta: number; gamma: number }) => void;
  knock?: (e: { intensity: number }) => void;
  flip?: (e: { faceDown: boolean }) => void;
  breath?: (e: { strength: number }) => void;
};

export type GestureOptions = {
  /** Screen-edge inset (px) inside which gestures may begin. */
  edgeInset?: number;
  /** Map plain wheel to pinch (default true — playable surfaces zoom). */
  wheelZoom?: boolean;
  /**
   * Skip setPointerCapture (default false). Set when listening on a shared
   * ancestor (e.g. document.body) so a room's own canvas listeners keep
   * receiving the stream — capture would silently retarget it.
   */
  noCapture?: boolean;
  /**
   * Manage touch-action/user-select/callout on the element (default true).
   * Set false on shared ancestors where the room already owns suppression.
   */
  manageStyle?: boolean;
};

type Contact = {
  id: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  t0: number;
  path: Pt[];
  moved: number;
  lastX: number;
  lastY: number;
  lastT: number;
  vx: number;
  vy: number;
  pressure?: number;
  width?: number;
  height?: number;
};

const isBrowser = typeof window !== "undefined";

function isTextTarget(t: EventTarget | null): boolean {
  if (!(t instanceof Element)) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || (t as HTMLElement).isContentEditable;
}

/** Attach the grammar to an element. Returns a detach function. */
export function attachGestures(
  el: HTMLElement,
  on: GestureHandlers,
  opts: GestureOptions = {},
): () => void {
  if (!isBrowser) return () => {};
  const edgeInset = opts.edgeInset ?? THRESHOLDS.edgeInsetPx;

  const contacts = new Map<number, Contact>();
  let sessionFingers = 0;
  let settled = false;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let holdTimer: ReturnType<typeof setInterval> | null = null;
  let holdActive = false;
  let dragging = false;
  let scrubFired = 0; // last winding at which scrub was emitted
  let two: { a: number; b: number; pa: Pt; pb: Pt; started: Set<"pinch" | "twist" | "pan2">; scaleAcc: number; rotAcc: number; panAcc: number; lastT: number } | null = null;
  let tapCount = 0;
  let tapTime = -1e9;
  let tapFingersPending = 0;
  const tapTimes: number[] = [];

  const sessionStart = (): Contact | null => contacts.values().next().value ?? null;

  const centroid = (): Pt => {
    let x = 0;
    let y = 0;
    for (const c of contacts.values()) {
      x += c.x;
      y += c.y;
    }
    const n = Math.max(1, contacts.size);
    return { x: x / n, y: y / n };
  };

  const clearHold = () => {
    if (holdTimer) clearInterval(holdTimer);
    holdTimer = null;
    if (holdActive) {
      const c = sessionStart();
      if (c && on.hold) {
        const elapsed = performance.now() - c.t0;
        on.hold({
          fingers: sessionFingers,
          phase: "release",
          elapsed,
          tier: holdTier(elapsed),
          intensity: intensityFrom(c),
          x: c.x,
          y: c.y,
        });
      }
    }
    holdActive = false;
  };

  const armHold = () => {
    if (holdTimer) clearInterval(holdTimer);
    holdTimer = setInterval(() => {
      const c = sessionStart();
      if (!c || dragging || two) return;
      const elapsed = performance.now() - c.t0;
      const tier = holdTier(elapsed);
      if (tier >= 1 && on.hold) {
        on.hold({
          fingers: sessionFingers,
          phase: holdActive ? "tick" : "enter",
          elapsed,
          tier,
          intensity: intensityFrom(c),
          x: c.x,
          y: c.y,
        });
        holdActive = true;
      }
    }, 80);
  };

  const beginTwo = () => {
    const ids = [...contacts.keys()];
    if (ids.length < 2) return;
    const a = contacts.get(ids[0])!;
    const b = contacts.get(ids[1])!;
    two = {
      a: a.id,
      b: b.id,
      pa: { x: a.x, y: a.y },
      pb: { x: b.x, y: b.y },
      started: new Set(),
      scaleAcc: 1,
      rotAcc: 0,
      panAcc: 0,
      lastT: performance.now(),
    };
  };

  const endTwo = () => {
    if (!two) return;
    const c = centroid();
    if (two.started.has("pinch")) on.pinch?.({ phase: "end", scale: 1, velocity: 0, cx: c.x, cy: c.y });
    if (two.started.has("twist")) on.twist?.({ phase: "end", angle: 0, velocity: 0, cx: c.x, cy: c.y });
    if (two.started.has("pan2")) on.pan2?.({ phase: "end", dx: 0, dy: 0, cx: c.x, cy: c.y });
    two = null;
  };

  const settle = () => {
    settled = true;
    sessionFingers = contacts.size;
    if (sessionFingers === 2) beginTwo();
    if (sessionFingers >= 1) armHold();
  };

  const onDown = (ev: PointerEvent) => {
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    // The surf line: surrender screen edges to the OS.
    if (
      ev.clientX < edgeInset ||
      ev.clientY < edgeInset ||
      ev.clientX > window.innerWidth - edgeInset ||
      ev.clientY > window.innerHeight - edgeInset
    ) {
      return;
    }
    // Three-finger gestures never fight text editing.
    if (contacts.size >= 2 && isTextTarget(ev.target)) return;

    if (!opts.noCapture) {
      try {
        el.setPointerCapture(ev.pointerId);
      } catch {
        /* noop */
      }
    }
    const now = performance.now();
    contacts.set(ev.pointerId, {
      id: ev.pointerId,
      x0: ev.clientX,
      y0: ev.clientY,
      x: ev.clientX,
      y: ev.clientY,
      t0: now,
      path: [{ x: ev.clientX, y: ev.clientY }],
      moved: 0,
      lastX: ev.clientX,
      lastY: ev.clientY,
      lastT: now,
      vx: 0,
      vy: 0,
      pressure: ev.pressure,
      width: ev.width,
      height: ev.height,
    });
    if (contacts.size === 1) {
      settled = false;
      dragging = false;
      scrubFired = 0;
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(settle, THRESHOLDS.chordSettleMs);
    } else if (!settled) {
      // More fingers landing inside the settle window grow the chord.
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(settle, THRESHOLDS.chordSettleMs);
    } else if (contacts.size === 2 && sessionFingers === 1) {
      // A second finger joined late: promote to a two-finger frame gesture.
      clearHold();
      sessionFingers = 2;
      beginTwo();
    } else {
      sessionFingers = contacts.size;
    }
  };

  const onMove = (ev: PointerEvent) => {
    const c = contacts.get(ev.pointerId);
    if (!c) return;
    const now = performance.now();
    const dt = Math.max(1, now - c.lastT);
    c.vx = (ev.clientX - c.lastX) / dt;
    c.vy = (ev.clientY - c.lastY) / dt;
    c.lastX = c.x;
    c.lastY = c.y;
    c.lastT = now;
    c.x = ev.clientX;
    c.y = ev.clientY;
    c.pressure = ev.pressure;
    c.width = ev.width;
    c.height = ev.height;
    c.moved = Math.max(c.moved, Math.hypot(c.x - c.x0, c.y - c.y0));
    if (c.path.length === 0 || Math.hypot(c.x - c.path[c.path.length - 1].x, c.y - c.path[c.path.length - 1].y) > 4) {
      c.path.push({ x: c.x, y: c.y });
      if (c.path.length > 240) c.path.shift();
    }
    if (!settled) return;

    if (two && (ev.pointerId === two.a || ev.pointerId === two.b)) {
      const a = contacts.get(two.a);
      const b = contacts.get(two.b);
      if (!a || !b) return;
      const d = decomposeTwoPointer(two.pa, two.pb, { x: a.x, y: a.y }, { x: b.x, y: b.y });
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const dtT = Math.max(1, now - two.lastT);
      two.scaleAcc *= d.scale;
      two.rotAcc += d.rotate;
      two.panAcc += Math.hypot(d.dx, d.dy);
      // Channels activate independently once past their deadzones.
      if (!two.started.has("pinch") && Math.abs(two.scaleAcc - 1) > THRESHOLDS.pinchDeadzone) {
        two.started.add("pinch");
        on.pinch?.({ phase: "start", scale: 1, velocity: 0, cx, cy });
      }
      if (!two.started.has("twist") && Math.abs(two.rotAcc) > THRESHOLDS.twistDeadzoneRad) {
        two.started.add("twist");
        on.twist?.({ phase: "start", angle: 0, velocity: 0, cx, cy });
      }
      if (!two.started.has("pan2") && two.panAcc > THRESHOLDS.pan2DeadzonePx) {
        two.started.add("pan2");
        on.pan2?.({ phase: "start", dx: 0, dy: 0, cx, cy });
      }
      if (two.started.has("pinch")) {
        on.pinch?.({ phase: "move", scale: d.scale, velocity: Math.log(d.scale) / (dtT / 1000), cx, cy });
      }
      if (two.started.has("twist")) {
        on.twist?.({ phase: "move", angle: d.rotate, velocity: d.rotate / (dtT / 1000), cx, cy });
      }
      if (two.started.has("pan2")) on.pan2?.({ phase: "move", dx: d.dx, dy: d.dy, cx, cy });
      two.pa = { x: a.x, y: a.y };
      two.pb = { x: b.x, y: b.y };
      two.lastT = now;
      if (two.started.size > 0) clearHold();
      return;
    }

    // One- or three-finger drag.
    if ((sessionFingers === 1 || sessionFingers === 3) && c === sessionStart()) {
      if (!dragging && c.moved > THRESHOLDS.moveTolPx) {
        dragging = true;
        clearHold();
        on.drag?.({ fingers: sessionFingers, phase: "start", x: c.x, y: c.y, dx: 0, dy: 0, vx: c.vx, vy: c.vy });
      } else if (dragging) {
        on.drag?.({
          fingers: sessionFingers,
          phase: "move",
          x: c.x,
          y: c.y,
          dx: c.x - c.lastX,
          dy: c.y - c.lastY,
          vx: c.vx,
          vy: c.vy,
        });
        const w = pathWinding(c.path);
        if (Math.abs(w) >= THRESHOLDS.scrubWinding && Math.abs(w - scrubFired) >= 0.5) {
          scrubFired = w;
          const cen = centroid();
          on.scrub?.({ winding: w, angularVelocity: Math.hypot(c.vx, c.vy), cx: cen.x, cy: cen.y });
        }
      }
    }
  };

  const onUp = (ev: PointerEvent) => {
    const c = contacts.get(ev.pointerId);
    if (!c) return;
    const now = performance.now();
    const wasSessionLead = c === sessionStart();
    contacts.delete(ev.pointerId);

    if (two && (ev.pointerId === two.a || ev.pointerId === two.b)) endTwo();

    if (contacts.size > 0) return; // wait for the last finger

    if (settleTimer) clearTimeout(settleTimer);
    if (!settled) settle(); // ultra-fast taps release before the settle window

    const duration = now - c.t0;
    const speed = Math.hypot(c.vx, c.vy);
    const kind = classifyRelease(duration, c.moved, speed);

    if (kind === "tap" && wasSessionLead) {
      tapCount = tapFingersPending === sessionFingers ? tapTrain(tapCount, tapTime, now) : 1;
      tapFingersPending = sessionFingers;
      tapTime = now;
      tapTimes.push(now);
      while (tapTimes.length > 8) tapTimes.shift();
      on.tap?.({
        fingers: sessionFingers,
        count: tapCount,
        intensity: intensityFrom({ pressure: c.pressure, width: c.width, height: c.height, velocity: speed }),
        x: c.x,
        y: c.y,
      });
      const r = rhythmFrom(tapTimes);
      if (r && r.stability > 0.55) on.rhythm?.(r);
    } else if (kind === "flick") {
      on.flick?.({ fingers: sessionFingers, angle: Math.atan2(c.vy, c.vx), speed, x: c.x, y: c.y });
      if (dragging) on.drag?.({ fingers: sessionFingers, phase: "end", x: c.x, y: c.y, dx: 0, dy: 0, vx: c.vx, vy: c.vy });
    } else if (kind === "drag-end") {
      on.drag?.({ fingers: sessionFingers, phase: "end", x: c.x, y: c.y, dx: 0, dy: 0, vx: c.vx, vy: c.vy });
    }
    clearHold();
    dragging = false;
    sessionFingers = 0;
    settled = false;
  };

  const onCancel = (ev: PointerEvent) => {
    contacts.delete(ev.pointerId);
    if (two) endTwo();
    if (contacts.size === 0) {
      clearHold();
      dragging = false;
      sessionFingers = 0;
      settled = false;
    }
  };

  // Desktop dialect: wheel = local zoom; ctrl+wheel is the trackpad pinch.
  const onWheel = (ev: WheelEvent) => {
    if (!(opts.wheelZoom ?? true) && !ev.ctrlKey) return;
    ev.preventDefault();
    const scale = Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.002));
    on.pinch?.({ phase: "move", scale, velocity: Math.log(scale) * 60, cx: ev.clientX, cy: ev.clientY });
  };

  // Suppress Safari's page-level pinch/rotate on the playable surface.
  const swallow = (ev: Event) => ev.preventDefault();

  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onCancel);
  el.addEventListener("wheel", onWheel, { passive: false });
  el.addEventListener("gesturestart", swallow as EventListener);
  el.addEventListener("gesturechange", swallow as EventListener);
  if (opts.manageStyle ?? true) {
    el.style.touchAction = "none";
    (el.style as CSSStyleDeclaration & { webkitTouchCallout?: string }).webkitTouchCallout = "none";
    el.style.userSelect = "none";
  }

  return () => {
    el.removeEventListener("pointerdown", onDown);
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointercancel", onCancel);
    el.removeEventListener("wheel", onWheel);
    el.removeEventListener("gesturestart", swallow as EventListener);
    el.removeEventListener("gesturechange", swallow as EventListener);
    if (settleTimer) clearTimeout(settleTimer);
    if (holdTimer) clearInterval(holdTimer);
  };
}

/**
 * The vessel: tilt, shake, knock, flip. iOS requires permission from inside a
 * user gesture — call this from a tap handler. Resolves true if motion flows.
 */
export async function enableMotion(on: GestureHandlers): Promise<boolean> {
  if (!isBrowser || typeof DeviceMotionEvent === "undefined") return false;
  type Requestable = { requestPermission?: () => Promise<"granted" | "denied"> };
  const req = (DeviceMotionEvent as unknown as Requestable).requestPermission;
  if (typeof req === "function") {
    try {
      if ((await req()) !== "granted") return false;
    } catch {
      return false;
    }
  }

  const samples: MotionSample[] = [];
  let lastShakeAt = 0;
  let faceDown = false;
  let lastTiltAt = 0;

  const onMotion = (ev: DeviceMotionEvent) => {
    const now = performance.now();
    const a = ev.acceleration;
    if (a && a.x !== null && a.y !== null && a.z !== null) {
      samples.push({ x: a.x, y: a.y, z: a.z, t: now });
      while (samples.length > 60) samples.shift();
      const intensity = shakeIntensity(samples, now);
      if (intensity > 0 && now - lastShakeAt > 900) {
        lastShakeAt = now;
        on.shake?.({ intensity });
      }
      const mag = Math.hypot(a.x, a.y, a.z);
      if (mag > THRESHOLDS.knockThresh && intensity === 0 && now - lastShakeAt > 400) {
        on.knock?.({ intensity: Math.min(1, mag / (THRESHOLDS.knockThresh * 2)) });
        lastShakeAt = now;
      }
    }
    const g = ev.accelerationIncludingGravity;
    if (g && g.z !== null) {
      // Device frame: face-up gravity reads z ≈ +9.8; face-down ≈ -9.8.
      const down = g.z < -7;
      if (down !== faceDown) {
        faceDown = down;
        on.flip?.({ faceDown });
      }
    }
  };

  const onOrient = (ev: DeviceOrientationEvent) => {
    const now = performance.now();
    if (now - lastTiltAt < 50) return; // ~20Hz is plenty for gravity
    lastTiltAt = now;
    if (ev.beta !== null && ev.gamma !== null) on.tilt?.({ beta: ev.beta, gamma: ev.gamma });
  };

  window.addEventListener("devicemotion", onMotion);
  window.addEventListener("deviceorientation", onOrient);
  return true;
}

/**
 * Breath — opt-in, candle contexts only (grammar §1). Streams mic RMS as
 * `breath` events while a low-pitched burst is sustained. Caller owns the
 * moment of asking; returns a stop function, or null if the mic was refused.
 */
export async function enableBreath(on: GestureHandlers): Promise<(() => void) | null> {
  if (!isBrowser || !navigator.mediaDevices?.getUserMedia) return null;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return null;
  }
  const Ctx = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) {
    stream.getTracks().forEach((t) => t.stop());
    return null;
  }
  const ctx = new Ctx();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  src.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  let raf = 0;
  const loop = () => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    if (rms > 0.08) on.breath?.({ strength: Math.min(1, rms * 4) });
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  return () => {
    cancelAnimationFrame(raf);
    src.disconnect();
    void ctx.close();
    stream.getTracks().forEach((t) => t.stop());
  };
}

export { THRESHOLDS } from "./core";
export type { HoldTier, Rhythm } from "./core";
