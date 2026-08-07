/**
 * zeussky — the laws of the charged sky above the peak.
 *
 * /zeus is the peak ring's fourth seat: the storm as the mountain's king
 * holds it, not as the meteorology (/storm owns pressure, charge, discharge
 * as weather) but as governance — thunderheads that gather, court each other
 * by induction, merge into greater houses, and spend themselves in one bolt
 * to the ridge. Everything the room claims about that material is a pure
 * function in this file, pinned by scripts/test-zeussky.mjs.
 *
 * Pure: no DOM, no React, no wall clock, no entropy. Positions are
 * normalized room coordinates (0..1, y down), charge and water are the two
 * conserved stores a cell carries.
 */

export type CellBody = {
  nx: number;
  ny: number;
  /** the store a bolt spends — grows under a dwell, transfers on a calve. */
  charge: number;
  /** the column that conducts — merged water columns sum exactly. */
  water: number;
};

/** How many thunderheads the sky holds; past this the oldest gives way. */
export const CELL_CAP = 12;

/** Softening length so two courts at zero distance pull finitely, never NaN. */
export const SOFTEN = 0.055;

/** Induction constant — the whole attraction law is scaled by this alone. */
export const INDUCTION = 0.01;

/** Contact radius: the anvil a cell spreads, wider the more water it holds. */
export const CONTACT_BASE = 0.028;
export const CONTACT_PER_WATER = 0.05;
export const CONTACT_WATER_MAX = 1.5;

/** The peal's tempo: one house answers the last after this many ms. */
export const PEAL_STAGGER_MS = 140;

/** A calve (tier-3 tap) hands the satellite this share of the parent's stores. */
export const CALVE_CHARGE_SHARE = 1 / 3;
export const CALVE_WATER_SHARE = 1 / 4;
/** ...and stands it this far off the parent's shoulder. */
export const CALVE_OFFSET = 0.07;

/**
 * Electrostatic induction between two charged cells: attraction along the
 * separation, proportional to the product of the charges, softened so the
 * force stays finite as the cores close. Returns the acceleration on A
 * toward B; the force on B toward A is its exact mirror (test-pinned).
 */
export function attraction(
  a: { nx: number; ny: number; charge: number },
  b: { nx: number; ny: number; charge: number },
): { ax: number; ay: number } {
  const dx = b.nx - a.nx;
  const dy = b.ny - a.ny;
  const d2 = dx * dx + dy * dy + SOFTEN * SOFTEN;
  const d = Math.sqrt(d2);
  const mag = (INDUCTION * a.charge * b.charge) / d2;
  return { ax: (dx / d) * mag, ay: (dy / d) * mag };
}

/** The reach of a cell's anvil — monotone in the water it carries. */
export function contactRadius(water: number): number {
  return CONTACT_BASE + CONTACT_PER_WATER * Math.min(CONTACT_WATER_MAX, Math.max(0, water));
}

/** Two cells touch when their anvils overlap. */
export function inContact(a: CellBody, b: CellBody): boolean {
  const dx = b.nx - a.nx;
  const dy = b.ny - a.ny;
  const r = contactRadius(a.water) + contactRadius(b.water);
  return dx * dx + dy * dy <= r * r;
}

/**
 * Two houses become one greater house that is neither parent: charge and
 * water sum exactly (nothing minted, nothing lost), and the new court
 * stands at the charge-weighted centroid — closer to the throne that
 * brought more to the union. Commutative, and test-pinned to stay so.
 */
export function mergeCells(a: CellBody, b: CellBody): CellBody {
  const q = a.charge + b.charge;
  const w = q > 0 ? a.charge / q : 0.5;
  return {
    nx: a.nx * w + b.nx * (1 - w),
    ny: a.ny * w + b.ny * (1 - w),
    charge: q,
    water: a.water + b.water,
  };
}

/**
 * A calve — the tier-3 transformation. The parent keeps its seat and pays a
 * real share of both stores to stand a satellite off its shoulder; the sum
 * of each store across parent and child equals the parent before. `u` is a
 * seeded 0..1 that picks the shoulder — never wall entropy.
 */
export function calve(parent: CellBody, u: number): { parent: CellBody; child: CellBody } {
  const angle = u * Math.PI * 2;
  const qChild = parent.charge * CALVE_CHARGE_SHARE;
  const wChild = parent.water * CALVE_WATER_SHARE;
  return {
    parent: {
      nx: parent.nx,
      ny: parent.ny,
      charge: parent.charge - qChild,
      water: parent.water - wChild,
    },
    child: {
      nx: parent.nx + Math.cos(angle) * CALVE_OFFSET,
      ny: parent.ny + Math.sin(angle) * CALVE_OFFSET * 0.6,
      charge: qChild,
      water: wChild,
    },
  };
}

/**
 * What a bolt spends: the charge, carried down the water column. Monotone
 * in both stores — a wetter cell conducts a hotter strike.
 */
export function boltEnergy(charge: number, water: number): number {
  return Math.max(0, charge) * (0.5 + Math.max(0, water));
}

/**
 * The thunder IS the energy: bigger bolts ring lower, and the map is
 * invertible so a listener can read the strike's size off its pitch alone.
 * Range (THUNDER_HZ_FLOOR, THUNDER_HZ_FLOOR + THUNDER_HZ_SPAN].
 */
export const THUNDER_HZ_FLOOR = 34;
export const THUNDER_HZ_SPAN = 186;
export const THUNDER_DECAY = 1.1;

export function thunderHz(energy: number): number {
  return THUNDER_HZ_FLOOR + THUNDER_HZ_SPAN * Math.exp(-Math.max(0, energy) * THUNDER_DECAY);
}

export function energyForHz(hz: number): number {
  const t = (hz - THUNDER_HZ_FLOOR) / THUNDER_HZ_SPAN;
  if (t <= 0) return Infinity;
  if (t >= 1) return 0;
  return -Math.log(t) / THUNDER_DECAY;
}

/**
 * The peal — the tap train's top rung. From the house nearest the hand, the
 * verdict walks the whole court: each next voice is the nearest cell not yet
 * spoken, ties broken by lower index so the order is a pure function of the
 * positions. Returns every index exactly once, starting at `start`.
 */
export function pealOrder(cells: ReadonlyArray<{ nx: number; ny: number }>, start: number): number[] {
  const n = cells.length;
  if (n === 0) return [];
  const order: number[] = [];
  const used = new Array<boolean>(n).fill(false);
  let here = Math.max(0, Math.min(n - 1, start));
  order.push(here);
  used[here] = true;
  while (order.length < n) {
    let best = -1;
    let bestD2 = Infinity;
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const dx = cells[i].nx - cells[here].nx;
      const dy = cells[i].ny - cells[here].ny;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    order.push(best);
    used[best] = true;
    here = best;
  }
  return order;
}
