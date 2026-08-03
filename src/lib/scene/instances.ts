/**
 * scene/instances — one buffer for a whole population.
 *
 * The bug this ends: every object in this codebase drew *itself*. A
 * `createRadialGradient` inside `for (const a of atoms)`, a `shadowBlur` per
 * petal, a fresh gradient per nucleon halo, forty-odd gradient allocations a
 * frame on /stars. Each of those is a full paint-server rebuild on the main
 * thread, and mobile pays for it twice — once in allocation, once in fill.
 *
 * Here an object writes eight numbers and the room draws the population in a
 * single instanced pass (`scene/gl.ts`). The buffer is allocated once at its
 * capacity and never grows during a frame: `reset()` then `push()`, and
 * anything past capacity is *counted*, not appended, so a room that outgrows
 * its budget learns it from `overflow` instead of from a stutter.
 *
 * Pure typed-array bookkeeping. No DOM. node-testable.
 */

/**
 * Per-instance attributes, in buffer order:
 *
 *  0 `x`, 1 `y`      — css pixels, the room's own frame
 *  2 `r`             — radius in css pixels
 *  3 `rot`           — radians
 *  4 `hue`           — 0..1 around the room's palette, not degrees
 *  5 `glow`          — 0..1 additive bloom weight
 *  6 `phase`         — 0..1 into the thing's own cycle (breath, spin, bloom)
 *  7 `alpha`         — 0..1 presence
 */
export const INSTANCE_FIELDS = ["x", "y", "r", "rot", "hue", "glow", "phase", "alpha"] as const;
export const INSTANCE_STRIDE = INSTANCE_FIELDS.length;

export type InstanceBuffer = {
  readonly data: Float32Array;
  readonly capacity: number;
  /** instances written since the last reset. */
  count: number;
  /** instances refused since the last reset because the buffer was full. */
  overflow: number;
  reset(): void;
  push(
    x: number,
    y: number,
    r: number,
    rot: number,
    hue: number,
    glow: number,
    phase: number,
    alpha: number,
  ): void;
  /** the written region only — what the GPU uploads. */
  view(): Float32Array;
};

export function createInstanceBuffer(capacity: number): InstanceBuffer {
  const cap = Math.max(1, Math.floor(capacity));
  const data = new Float32Array(cap * INSTANCE_STRIDE);
  const buf: InstanceBuffer = {
    data,
    capacity: cap,
    count: 0,
    overflow: 0,
    reset() {
      buf.count = 0;
      buf.overflow = 0;
    },
    push(x, y, r, rot, hue, glow, phase, alpha) {
      // Nothing invisible reaches the GPU. A zero-alpha or zero-radius
      // instance still costs a vertex fetch and a fragment's worth of blend.
      if (!(alpha > 0.002) || !(r > 0.01)) return;
      if (buf.count >= cap) {
        buf.overflow++;
        return;
      }
      const o = buf.count * INSTANCE_STRIDE;
      data[o] = x;
      data[o + 1] = y;
      data[o + 2] = r;
      data[o + 3] = rot;
      data[o + 4] = hue;
      data[o + 5] = glow;
      data[o + 6] = phase;
      data[o + 7] = alpha;
      buf.count++;
    },
    view() {
      return data.subarray(0, buf.count * INSTANCE_STRIDE);
    },
  };
  return buf;
}

/** Read one instance back — for tests and for a room that wants to hit-test. */
export function readInstance(
  buf: InstanceBuffer,
  index: number,
): Record<(typeof INSTANCE_FIELDS)[number], number> | null {
  if (index < 0 || index >= buf.count) return null;
  const o = index * INSTANCE_STRIDE;
  const out = {} as Record<(typeof INSTANCE_FIELDS)[number], number>;
  for (let f = 0; f < INSTANCE_STRIDE; f++) out[INSTANCE_FIELDS[f]] = buf.data[o + f];
  return out;
}

/**
 * How many instances a room may afford at a quality tier. Rooms multiply
 * their own population budget by `detailForTier(tier).particles`; this is the
 * hard ceiling on top of that, so a low tier cannot be talked out of its
 * saving by an enthusiastic room.
 */
export function instanceBudget(base: number, detailParticles: number): number {
  return Math.max(1, Math.floor(base * Math.max(0.1, Math.min(1, detailParticles))));
}
