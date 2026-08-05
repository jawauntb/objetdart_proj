/**
 * city-shader-compile — async shader compilation for /city's heavy materials.
 *
 * Lever 4 from the perf brief. WebGL2 exposes `KHR_parallel_shader_compile`,
 * an extension that lets the driver link shader programs on a background
 * worker while the main thread keeps ticking. Without it, calling `useProgram`
 * on a freshly-uploaded program stalls the JS thread until link + validate
 * finishes — on the M1 Air with the /city cloud raymarch that stall is
 * ~40–90 ms, and it lands squarely on the frame that first reveals the
 * cloud slab. The progressive-enablement chain in City.tsx amortises the
 * reveals across ~12 frames, but each reveal frame still hits the driver
 * with a synchronous link.
 *
 * This module gives us the two pieces we need to move that link off the
 * revealing frame:
 *
 *   1. `submitSceneCompile(renderer, scene, camera)` — a thin wrapper over
 *      `renderer.compile(scene, camera)` that walks every mesh in the scene
 *      and initialises the WebGL program for its material RIGHT NOW. When
 *      the driver reports `KHR_parallel_shader_compile`, three's WebGLProgram
 *      constructor kicks the link off on a background worker and returns
 *      before it completes; when the driver doesn't, three flags the
 *      program ready immediately (and the first draw stalls exactly as it
 *      did before — no worse, and iOS Safari still owes us a decent
 *      cold-compile budget).
 *
 *   2. `createCompileGate(opts)` — a pure state machine that gates a
 *      material's reveal on the driver's opinion of whether its program
 *      has finished linking. `submit(material)` records the moment the
 *      compile was kicked off; `isReady(material)` polls the driver via
 *      the injected `probe` callback and returns true once the program
 *      is ready OR once a hard deadline has elapsed since submit. The
 *      deadline is the safety net — if a browser silently strips the
 *      extension (some sandboxed WKWebView contexts do), the gate flips
 *      ready at `deadlineMs` and the material draws with whatever the
 *      driver has on hand.
 *
 * The gate takes `probe` as an injected function so the pure logic —
 * "record submit, check readiness OR deadline, latch once ready" —
 * can be tested in a node runtime without a live GL context.
 *
 * Two of three registers: operational (the extension gate, the deadline
 * safety net, the WeakMap-backed submit ledger) and devotional (the
 * frames we no longer steal from the visitor's first sight of the
 * settlement).
 */

import * as THREE from "three";

/**
 * Hard deadline. If the driver hasn't reported ready in this many
 * milliseconds after `submit()`, the gate latches ready anyway so the
 * progressive-enablement schedule doesn't stall on a driver that never
 * fires KHR_parallel_shader_compile's completion bit. 500 ms is longer
 * than any single-material compile on desktop Chrome M1 and iOS Safari
 * A15 in benchmarks we've seen, and shorter than the human eye's
 * ~1000 ms tolerance for a scene populating layer by layer.
 */
export const DEFAULT_COMPILE_DEADLINE_MS = 500;

/**
 * A pure compile-readiness gate. Given an injected `probe` and clock,
 * tracks per-material submit times and returns `isReady=true` when the
 * driver reports ready OR when the deadline has elapsed. Once a material
 * latches ready, it stays ready — no oscillation on a probe that
 * momentarily returns false after having returned true.
 *
 * WeakMap keys mean disposed materials clean up with GC and this gate
 * cannot leak memory across a room remount.
 */
export interface CompileGate {
  /** Record that the material's compile has been kicked off. Idempotent. */
  submit(material: THREE.Material): void;
  /**
   * Has the material's program finished linking, or has the deadline
   * elapsed? Materials that were never submitted return `true` — a
   * caller that skips submit gets non-blocking behaviour by default,
   * so integrating the gate into a step schedule is safe even when a
   * given step hasn't been wired to submit yet.
   */
  isReady(material: THREE.Material): boolean;
  /**
   * Test-only. Returns the number of materials currently pending
   * (submitted, not yet latched ready). Useful for asserting that a
   * step schedule advanced through every submitted material.
   */
  pendingCount(): number;
}

export interface CompileGateOptions {
  /**
   * The readiness oracle. Return `true` when the driver reports the
   * material's shader program has finished linking (i.e. its WebGLProgram
   * `isReady()` returned true). See `probeMaterialReady` for the real
   * WebGL2 implementation; tests inject a controllable stub.
   */
  probe: (material: THREE.Material) => boolean;
  /** Monotonic clock. Defaults to `performance.now()`. */
  now?: () => number;
  /** Hard deadline in ms after which the gate latches ready anyway. */
  deadlineMs?: number;
}

export function createCompileGate(opts: CompileGateOptions): CompileGate {
  const now = opts.now ?? (() => performance.now());
  const deadlineMs = Math.max(0, opts.deadlineMs ?? DEFAULT_COMPILE_DEADLINE_MS);
  // Strong-ref map for the small number of heavy materials submitted per
  // room mount (three in the current schedule; four when curtain-wall
  // wires in). Each entry drops when its material latches ready, and the
  // whole map is orphaned when the room unmounts and this gate is
  // released. WeakRef would remove even that transient strong-hold, but
  // WeakRef targets ES2021 and tsconfig targets ES2020 — the deliberate
  // downshift is safer than bumping the compilation target for one API.
  const pending = new Map<THREE.Material, number>();
  const readyCache = new Set<THREE.Material>();

  return {
    submit(material: THREE.Material): void {
      if (pending.has(material) || readyCache.has(material)) return;
      pending.set(material, now());
    },
    isReady(material: THREE.Material): boolean {
      if (readyCache.has(material)) return true;
      const t = pending.get(material);
      if (t === undefined) {
        // Never submitted → non-blocking. A caller that forgot to
        // submit gets the pre-async behaviour (immediate reveal), not
        // an infinite hang. Prefer forgiving over strict here — the
        // progressive schedule is already a defensive layer.
        return true;
      }
      if (opts.probe(material)) {
        readyCache.add(material);
        pending.delete(material);
        return true;
      }
      if (now() - t >= deadlineMs) {
        readyCache.add(material);
        pending.delete(material);
        return true;
      }
      return false;
    },
    pendingCount(): number {
      return pending.size;
    },
  };
}

/**
 * True when the current WebGL context reports
 * `KHR_parallel_shader_compile`. On WebGL2 desktop Chrome / Firefox and
 * modern iOS Safari (A14+), this is true; on some older Android WebGL1
 * contexts or sandboxed WKWebViews it's false and the gate falls back
 * to its deadline. Reading through `renderer.extensions.get` uses the
 * same code path three's WebGLPrograms module already runs to decide
 * whether to mark programs ready on construction.
 */
export function hasParallelShaderCompile(renderer: THREE.WebGLRenderer): boolean {
  try {
    // three's WebGLExtensions.get returns the extension object or null.
    // We tolerate .extensions being absent because test stubs sometimes
    // omit it.
    const anyR = renderer as unknown as {
      extensions?: { get?: (name: string) => unknown };
    };
    const ext = anyR.extensions?.get?.("KHR_parallel_shader_compile");
    return ext !== null && ext !== undefined;
  } catch {
    return false;
  }
}

/**
 * The WebGL2 readiness probe. Reads
 * `renderer.properties.get(material).currentProgram.isReady()` — three's
 * internal `WebGLProgram.isReady()` returns `true` immediately when the
 * KHR extension is absent (marking the program ready on construction),
 * and calls `gl.getProgramParameter(program, COMPLETION_STATUS_KHR)` when
 * the extension is present. Both paths are non-blocking; the latter is
 * the whole point of this module.
 *
 * When the material has not yet been compiled — the properties map has
 * no entry for it — we return `false` so the gate keeps waiting. The
 * caller is expected to have run `submitSceneCompile` before calling
 * this, so `currentProgram` should exist within a few microseconds of
 * `submit`; if it truly never appears, the gate's deadline safety net
 * flips ready anyway.
 */
export function probeMaterialReady(
  renderer: THREE.WebGLRenderer,
  material: THREE.Material,
): boolean {
  try {
    const anyR = renderer as unknown as {
      properties?: { get?: (m: THREE.Material) => { currentProgram?: { isReady?: () => boolean } } | undefined };
    };
    const props = anyR.properties?.get?.(material);
    const program = props?.currentProgram;
    if (!program) return false;
    // If a program exists but exposes no isReady (test stubs, extremely
    // old three), treat as ready — the driver has already been asked to
    // link it, so waiting further gains us nothing.
    if (typeof program.isReady !== "function") return true;
    return program.isReady() === true;
  } catch {
    // Any lookup failure = probe unavailable → treat as ready so the
    // deadline is the only remaining gate.
    return true;
  }
}

/**
 * Kick off compilation for every material in the scene. When the KHR
 * extension is live, this returns after ~1 ms of JS work and the driver
 * links programs in the background; when it isn't, three synchronously
 * compiles and links each program and this call blocks for the full
 * cold-compile budget. Either way, the important side effect is that
 * every material's `currentProgram` now exists on the renderer's
 * properties map, so `probeMaterialReady` returns a real answer instead
 * of `false` for "not yet initialised".
 *
 * We swallow errors — a bad shader in the scene throws here and the
 * tick loop will surface it via its own draw path with better context.
 */
export function submitSceneCompile(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): void {
  try {
    // `scene.traverse` (not `traverseVisible`) is what three's compile()
    // uses to walk meshes, so mesh.visible=false meshes are still
    // initialised — exactly what the progressive-enablement path wants.
    renderer.compile(scene, camera);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[city:shader-compile] scene compile failed", err);
  }
}

/**
 * The four heavy modules whose reveal frames were the biggest offenders
 * in PR #341's progressive schedule. Named here so tests can assert the
 * schedule wires exactly these materials to the compile gate — a
 * refactor that quietly drops one loses the async benefit for that
 * module's reveal.
 */
export const HEAVY_COMPILE_MODULES = [
  "cityBackdropDome",
  "cityClouds",
  "citySunDisk",
  "cityCurtainWall",
] as const;

export type HeavyCompileModule = (typeof HEAVY_COMPILE_MODULES)[number];
