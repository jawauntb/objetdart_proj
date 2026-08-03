/**
 * webgl/sizing — the backing-store arithmetic every shader room got slightly
 * wrong on its own.
 *
 * Twelve rooms inlined `Math.min(devicePixelRatio, 2)`, two used
 * `resolveDpr()`, one capped at 1.5, and the ones with a downscaled sky pass
 * multiplied a render scale into the GL canvas but not the 2D overlay. Pure
 * functions, so `scripts/test-rooms.mjs` can pin them without a GPU.
 */

export type StageSize = {
  /** CSS pixels — what layout and pointer coordinates use. */
  width: number;
  height: number;
  /** Device pixels — the drawing buffer. */
  pixelWidth: number;
  pixelHeight: number;
  /** The ratio actually applied (device DPR × renderScale, after clamps). */
  ratio: number;
};

export type SizingInput = {
  width: number;
  height: number;
  /** window.devicePixelRatio */
  devicePixelRatio: number;
  /** ceiling from room-runtime's quality tier */
  maxRatio: number;
  /** fractional render scale for expensive passes (sky, volumetrics) */
  renderScale?: number;
  /** hard ceiling on total drawing-buffer pixels; 0 disables */
  maxPixels?: number;
};

/**
 * Resolve a drawing-buffer size. Guarantees:
 *  - at least 1×1, so a hidden or zero-height wrap never produces an invalid
 *    framebuffer (the crash mode when a room mounts inside a collapsed flex
 *    parent),
 *  - integral pixel dimensions (fractional ones silently round in drivers and
 *    make the fullscreen quad shimmer),
 *  - `maxPixels` respected by scaling the ratio, not by cropping — a 4K
 *    external display must cost the same as a laptop, not sixteen times more.
 */
export function resolveStageSize(input: SizingInput): StageSize {
  const renderScale = input.renderScale && input.renderScale > 0 ? input.renderScale : 1;
  const width = Math.max(1, input.width);
  const height = Math.max(1, input.height);

  const device = input.devicePixelRatio > 0 ? input.devicePixelRatio : 1;
  let ratio = Math.min(device, Math.max(0.25, input.maxRatio)) * renderScale;

  const maxPixels = input.maxPixels ?? 0;
  if (maxPixels > 0) {
    const wanted = width * height * ratio * ratio;
    if (wanted > maxPixels) ratio = Math.sqrt(maxPixels / (width * height));
  }
  ratio = Math.max(0.25, ratio);

  return {
    width,
    height,
    pixelWidth: Math.max(1, Math.round(width * ratio)),
    pixelHeight: Math.max(1, Math.round(height * ratio)),
    ratio,
  };
}

/** True when the backing store already matches — skip the reallocation. */
export function sizeUnchanged(a: StageSize | null, b: StageSize): boolean {
  return !!a && a.pixelWidth === b.pixelWidth && a.pixelHeight === b.pixelHeight;
}

/**
 * The shared clocks every room breathes on, as plain numbers.
 *
 * `breath` is the site's one 7-second respiration (0.14 Hz) mapped to 0..1 —
 * the same phase in every room, so two rooms open side by side inhale
 * together. Reduced motion holds it at its midpoint rather than removing it:
 * stillness quiets a dimension, it never deletes one.
 */
export const BREATH_HZ = 0.14;

export type RoomClocks = {
  /** seconds from the shared audio clock (falls back to wall time) */
  time: number;
  /** 0..1, the 7s breath */
  breath: number;
  /** 0..1, the shared turbulence bus */
  turbulence: number;
  /** the band's spectral register — shaders tint by it so scale is visible */
  baseHz: number;
  lfoHz: number;
  brightness: number;
  /** 1 when prefers-reduced-motion is set */
  reduced: number;
};

export function clocksFrom(input: {
  time: number;
  turbulence?: number;
  register?: { baseHz: number; lfoHz: number; brightness: number };
  reducedMotion?: boolean;
}): RoomClocks {
  const reduced = input.reducedMotion ? 1 : 0;
  const breath = reduced ? 0.5 : Math.sin(input.time * Math.PI * 2 * BREATH_HZ) * 0.5 + 0.5;
  const register = input.register ?? { baseHz: 110, lfoHz: BREATH_HZ, brightness: 0.5 };
  return {
    time: input.time,
    breath,
    turbulence: Math.max(0, Math.min(1, input.turbulence ?? 0)),
    baseHz: register.baseHz,
    lfoHz: register.lfoHz,
    brightness: register.brightness,
    reduced,
  };
}

/**
 * The uniform names a clock maps to. Both naming camps in the codebase are
 * written when present (`u_time` and `uTime`), so a room keeps whichever
 * dialect its shader already speaks and the harness never forces a rename.
 */
export const CLOCK_UNIFORMS: Record<keyof RoomClocks, readonly string[]> = {
  time: ["u_time", "uTime"],
  breath: ["u_breath", "uBreath"],
  turbulence: ["u_turbulence", "uTurbulence"],
  baseHz: ["u_baseHz", "uBaseHz"],
  lfoHz: ["u_lfoHz", "uLfoHz"],
  brightness: ["u_brightness", "uBrightness"],
  reduced: ["u_reduced", "uReduced"],
};

export const RESOLUTION_UNIFORMS = ["u_res", "uRes", "u_resolution", "uResolution"] as const;
export const POINTER_UNIFORMS = ["u_cursor", "uCursor", "u_pointer", "uPointer"] as const;

/**
 * Format a shader failure so the console says which room, which stage, and
 * which line — the survey found most rooms discarded the info log entirely
 * and simply stopped painting.
 */
export function formatShaderError(
  label: string,
  stage: "vertex" | "fragment" | "link",
  log: string | null,
  source?: string,
): string {
  const head = `[webgl:${label}] ${stage} failed`;
  const detail = (log ?? "").trim() || "(driver returned no info log)";
  if (!source) return `${head}\n${detail}`;
  const line = /ERROR:\s*\d+:(\d+)/.exec(detail);
  if (!line) return `${head}\n${detail}`;
  const n = Number(line[1]);
  const lines = source.split("\n");
  const from = Math.max(0, n - 3);
  const context = lines
    .slice(from, n + 2)
    .map((text, i) => `${from + i + 1 === n ? ">" : " "} ${from + i + 1}| ${text}`)
    .join("\n");
  return `${head}\n${detail}\n${context}`;
}
