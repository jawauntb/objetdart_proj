/**
 * humus — the laws of /soil.
 *
 * The invariant is a **nutrient ledger**. One currency of carbon-and-mineral
 * sits in five pools and every process in the room only *moves* it between
 * them:
 *
 *     litter ──k1──▶ humus ──k2──▶ mineral ──uptake──▶ root
 *        ▲                            │                  │
 *        └──────── death ─────────────┴──── mycelium ◀───┘
 *
 * Two of those pools are not stuff but *lives*: `root` and `mycelium` are the
 * summed biomass of the organisms standing in the section. Plant something and
 * the pool it belongs to is that much larger, because it is that organism.
 *
 * Both halves integrate in closed form, and neither replays history:
 *
 * - **Chemistry** is the linear cascade above, whose matrix is triangular, so
 *   it has an exact solution — `l(t) = l₀e^{−k₁t}`, `h(t)` the two-exponential
 *   convolution, mineral closing the sum. Rates carry real soil science: a
 *   Q₁₀ of 2 (decomposition doubles per 10 °C) and a moisture response that
 *   peaks near 60 % pore saturation and falls off when waterlogged.
 * - **Biology** is logistic growth toward a carrying capacity set by what is
 *   locally available, divided by the neighbours competing for it and
 *   multiplied by the mycorrhizal links a root has found. Logistic growth has
 *   a closed form too, so a fortnight away costs one `exp()` per organism.
 *
 * A visit after a month is therefore O(organisms), never O(elapsed) — there is
 * no catch-up loop in this file to drift with frame count.
 *
 * The load-bearing sensory map is **the ledger → timbre**, and it is
 * INVERTIBLE. Litter is crisp, so it sets the spectral centroid; humus is soft
 * and dead, so it sets the damping; mineral grains ring, so they set the decay;
 * mycelium beats, so it sets the beat rate; the mass sets the pitch. Read those
 * five numbers back through `mixFromTimbre` / `totalFromTimbre` and you have
 * the ledger — what a handful of this soil *is*, heard.
 *
 * Pure math, no imports, no DOM — node-testable (scripts/test-humus.mjs).
 * See INSPIRATION.md §2 (maps between representations) and §4 (aliveness down
 * the stack), and docs/new-room.md §4.
 */

// ——— the five pools ——————————————————————————————————————————————

export const POOLS = ["litter", "humus", "mineral", "mycelium", "root"] as const;
export type Pool = (typeof POOLS)[number];

/** Absolute nutrient units, pool by pool. */
export type Pools = Record<Pool, number>;
/** The same ledger as fractions — what the ear reads. Sums to one. */
export type Mix = Record<Pool, number>;

/** The whole section: what is in it, and how long it has been. */
export type SoilState = {
  pools: Pools;
  /** seconds of maturity this soil has lived through */
  tau: number;
};

/** The world-law layer: what the three-finger hand turns. */
export type Climate = {
  /** 0 frost · 1 high summer */
  warmth: number;
  /** 0 dust-dry · 1 waterlogged */
  wet: number;
};

export const MAX_TOTAL = 1;
export const MIN_TOTAL = 0.04;
/** Never let a month away become a century: world.ts's law, in seconds. */
export const MAX_ELAPSED_S = 14 * 24 * 3600;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v: number) => clamp(v, 0, 1);

export function makePools(
  litter: number,
  humus: number,
  mineral: number,
  mycelium: number,
  root: number,
): Pools {
  return { litter, humus, mineral, mycelium, root };
}

export function totalOf(s: SoilState): number {
  let t = 0;
  for (const p of POOLS) t += s.pools[p];
  return t;
}

/** The ledger as fractions. An empty section reads as pure mineral parent rock. */
export function mixOf(s: SoilState): Mix {
  const t = totalOf(s);
  if (!(t > 0)) return makePools(0, 0, 1, 0, 0);
  const out = {} as Mix;
  let acc = 0;
  for (let i = 0; i < POOLS.length - 1; i++) {
    out[POOLS[i]] = s.pools[POOLS[i]] / t;
    acc += out[POOLS[i]];
  }
  // Close on the last pool so the sum is exactly one, not one-plus-epsilon.
  out[POOLS[POOLS.length - 1]] = Math.max(0, 1 - acc);
  return out;
}

/** Any five numbers, made a legal ledger. Used when reading storage back. */
export function normalizePools(raw: Partial<Record<Pool, number>>): Pools {
  const out = {} as Pools;
  let sum = 0;
  for (const p of POOLS) {
    const v = raw[p];
    out[p] = typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
    sum += out[p];
  }
  if (sum <= 0) return starterState(0x501).pools;
  if (sum > MAX_TOTAL) {
    // storage said more than the section can hold; scale it back rather than
    // truncate one pool and silently change what the soil is
    for (const p of POOLS) out[p] = (out[p] * MAX_TOTAL) / sum;
  }
  return out;
}

// ——— climate: the real responses ——————————————————————————————————

/** Warmth as a temperature, so the Q₁₀ law below is the actual law. */
export const TEMP_MIN_C = -2;
export const TEMP_MAX_C = 30;
export const TEMP_REF_C = 15;
export const Q10 = 2;

export function tempC(warmth: number): number {
  return TEMP_MIN_C + (TEMP_MAX_C - TEMP_MIN_C) * clamp01(warmth);
}

/** Decomposition doubles per ten degrees. The oldest number in soil science. */
export function q10Factor(warmth: number): number {
  return Math.pow(Q10, (tempC(warmth) - TEMP_REF_C) / 10);
}

/** Where microbes work best: moist, not drowned. */
export const WET_OPT = 0.6;
export const MOISTURE_FLOOR = 0.04;

/**
 * The moisture response — an inverted parabola about the optimum, so bone-dry
 * soil is nearly inert and waterlogged soil goes slow and sour rather than
 * fast. A monotone "wetter is faster" curve would be the lie this replaces.
 */
export function moistureFactor(wet: number): number {
  const d = (clamp01(wet) - WET_OPT) / WET_OPT;
  return Math.max(MOISTURE_FLOOR, 1 - d * d);
}

/** Litter half-life at the reference climate, in seconds (about a week). */
export const LITTER_HALFLIFE_S = 8 * 24 * 3600;
/** Humus turns over far slower than fresh litter — the whole point of humus. */
export const HUMUS_RATE_RATIO = 0.16;

export type Rates = { k1: number; k2: number };

/** Cascade rates under a climate. Strictly increasing in both factors. */
export function decayRates(c: Climate): Rates {
  const drive = q10Factor(c.warmth) * moistureFactor(c.wet);
  const k1 = (Math.LN2 / LITTER_HALFLIFE_S) * drive;
  return { k1, k2: k1 * HUMUS_RATE_RATIO };
}

// ——— chemistry, in closed form ————————————————————————————————————

/**
 * Advance the three abiotic pools by `dtSec`. The cascade
 * litter → humus → mineral is linear and triangular, so this is its exact
 * solution rather than a step of an integrator:
 *
 *     l(t) = l₀·e^{−k₁t}
 *     h(t) = h₀·e^{−k₂t} + l₀·k₁/(k₂−k₁)·(e^{−k₁t} − e^{−k₂t})
 *     m(t) = A − l(t) − h(t)
 *
 * `k₂ = 0.16·k₁` by construction, so the k₁ = k₂ pole is unreachable, and
 * mineral closes the abiotic subtotal A so the sum is exact in float.
 */
export function decayStep(pools: Pools, dtSec: number, c: Climate): Pools {
  if (!(dtSec > 0)) return pools;
  const { k1, k2 } = decayRates(c);
  const l0 = Math.max(0, pools.litter);
  const h0 = Math.max(0, pools.humus);
  const A = l0 + h0 + Math.max(0, pools.mineral);
  const e1 = Math.exp(-k1 * dtSec);
  const e2 = Math.exp(-k2 * dtSec);
  const l = l0 * e1;
  const h = h0 * e2 + (l0 * k1 * (e1 - e2)) / (k2 - k1);
  return {
    litter: Math.max(0, l),
    humus: Math.max(0, h),
    mineral: Math.max(0, A - Math.max(0, l) - Math.max(0, h)),
    mycelium: pools.mycelium,
    root: pools.root,
  };
}

// ——— the lives standing in the section ————————————————————————————

export type OrganismKind = "root" | "fungus";

export type Organism = {
  id: number;
  kind: OrganismKind;
  /** where it stands, in the section's unit frame */
  nx: number;
  ny: number;
  /** biomass, in ledger units — this IS its share of the root/mycelium pool */
  m: number;
  /** the maturity at which it was planted */
  bornTau: number;
  /** the small vector its whole body is decoded from */
  seed: number;
};

export const MAX_ORGANISMS = 28;
/** What a hand puts in the ground, taken out of the litter that was there. */
export const SEED_MASS = 0.012;
/** Below this a life is over, and its matter falls back to litter. */
export const DEATH_MASS = 0.0022;
/** How far two lives have to be apart to stop taking each other's supper. */
export const COMPETE_R = 0.3;
/** How far a hypha will reach to find a root to trade with. */
export const LINK_R = 0.26;
/** What a mycorrhizal link is worth to both partners, at full strength. */
export const MYCO_BONUS = 0.75;
/** Doubling time of an unhindered life at the reference climate. */
export const GROWTH_DOUBLING_S = 24 * 3600;
/** The share of a supply pool one uncontested life can claim. */
export const SUPPLY_SHARE = 0.55;
/** The neighbour mass that counts as one full competitor. */
export const CROWD_REF_MASS = SEED_MASS * 8;

/** Growth rate under a climate — the same drive the chemistry feels. */
export function growthRate(c: Climate): number {
  return (Math.LN2 / GROWTH_DOUBLING_S) * q10Factor(c.warmth) * moistureFactor(c.wet);
}

/** Overlap of two lives' feeding zones: one where they stand together, zero apart. */
export function overlap(a: Organism, b: Organism): number {
  const dx = a.nx - b.nx;
  const dy = a.ny - b.ny;
  // same falloff as below: outside the radius the answer is exactly zero, so
  // the sqrt only has to run when the pair is actually close enough to matter.
  if (dx * dx + dy * dy >= COMPETE_R * COMPETE_R) return 0;
  const d = Math.hypot(dx, dy);
  return Math.max(0, 1 - d / COMPETE_R);
}

/** Strength of a mycorrhizal link, by distance. */
export function linkStrength(a: Organism, b: Organism): number {
  const dx = a.nx - b.nx;
  const dy = a.ny - b.ny;
  if (dx * dx + dy * dy >= LINK_R * LINK_R) return 0;
  const d = Math.hypot(dx, dy);
  return Math.max(0, 1 - d / LINK_R);
}

/**
 * A root reaches into the mineral horizon, so its supply improves with depth;
 * a fungus eats the litter and humus lying above, so its supply is best near
 * the surface. This is the section's own stratigraphy read as availability,
 * and it is what makes *where* you plant a real decision.
 */
export function depthAffinity(kind: OrganismKind, ny: number): number {
  const d = clamp01(ny);
  return kind === "root" ? 0.25 + 0.75 * d : 0.25 + 0.75 * (1 - d);
}

/**
 * What this life can grow to here: its supply pool, scaled by how well it
 * reaches that pool at this depth and by the water it needs, divided by
 * everyone of its own kind crowding the same food, times whatever it has
 * negotiated with the other kingdom.
 *
 * Same kind competes; different kinds trade. That asymmetry is the whole
 * ecology, and it is why a fungus planted beside a root helps them both.
 */
export function capacityOf(org: Organism, all: Organism[], s: SoilState, c: Climate): number {
  const supply =
    org.kind === "root"
      ? s.pools.mineral * clamp01(0.25 + 0.75 * clamp01(c.wet))
      : (s.pools.litter + s.pools.humus) * moistureFactor(c.wet);
  let crowd = 0;
  let trade = 0;
  for (const other of all) {
    if (other.id === org.id) continue;
    if (other.kind === org.kind) crowd += overlap(org, other) * (other.m / CROWD_REF_MASS);
    else trade += linkStrength(org, other) * clamp01(other.m / (SEED_MASS * 4));
  }
  const gained = 1 + MYCO_BONUS * clamp01(trade);
  return (SUPPLY_SHARE * supply * depthAffinity(org.kind, org.ny) * gained) / (1 + crowd);
}

/**
 * Logistic growth, exactly:  m(t) = K·m₀·e^{rt} / (K + m₀·(e^{rt} − 1)).
 * Below capacity it accelerates then levels; above it, it falls back to it;
 * with no capacity at all it starves away exponentially. Splitting a span
 * anywhere lands in the same place, which is what makes "it grew while you
 * were away" a computation and not a story.
 */
export function logisticStep(m0: number, K: number, r: number, dtSec: number): number {
  if (!(dtSec > 0) || !(m0 > 0)) return Math.max(0, m0);
  if (!(K > 1e-12)) return m0 * Math.exp(-r * dtSec); // nothing to eat: starvation
  // Written as K / (1 + (K/m₀ − 1)·e^{−rt}) rather than the e^{+rt} form, so a
  // long absence converges on the capacity instead of overflowing to NaN.
  return K / (1 + (K / m0 - 1) * Math.exp(-r * dtSec));
}

export type SettleResult = {
  state: SoilState;
  organisms: Organism[];
  /** ids that did not survive the span */
  died: number[];
};

/**
 * One step of the whole room: chemistry, then the lives feeding on what it
 * left. Every movement is named and paired, so the total is invariant to the
 * last bit — the assertion the test suite leans hardest on.
 *
 * Growth is drawn from the pool the kind eats (roots take mineral, fungi take
 * humus), and rationed proportionally when the demand exceeds the supply:
 * that rationing is competition actually biting, not a decoration on top of it.
 * Shrinking and dying return biomass to litter, where the cascade starts again.
 */
export function settle(s: SoilState, orgs: Organism[], dtSec: number, c: Climate): SettleResult {
  if (!(dtSec > 0)) return { state: s, organisms: orgs, died: [] };

  const pools = decayStep(s.pools, dtSec, c);
  const after: SoilState = { pools, tau: s.tau + dtSec };
  const r = growthRate(c);

  // What each life would do, if nobody else were asking.
  const wanted = new Array<number>(orgs.length);
  let demandRoot = 0;
  let demandFungus = 0;
  for (let i = 0; i < orgs.length; i++) {
    const K = capacityOf(orgs[i], orgs, after, c);
    const grown = logisticStep(orgs[i].m, K, r, dtSec);
    wanted[i] = grown - orgs[i].m;
    if (wanted[i] > 0) {
      if (orgs[i].kind === "root") demandRoot += wanted[i];
      else demandFungus += wanted[i];
    }
  }

  // ...and what the ground can actually serve. Roots eat mineral, fungi eat
  // humus; neither may eat more than is standing there.
  const rationRoot = demandRoot > pools.mineral ? pools.mineral / demandRoot : 1;
  const rationFungus = demandFungus > pools.humus ? pools.humus / demandFungus : 1;

  const next: Organism[] = [];
  const died: number[] = [];
  let takenMineral = 0;
  let takenHumus = 0;
  let toLitter = 0;
  for (let i = 0; i < orgs.length; i++) {
    const o = orgs[i];
    let dm = wanted[i];
    if (dm > 0) {
      dm *= o.kind === "root" ? rationRoot : rationFungus;
      if (o.kind === "root") takenMineral += dm;
      else takenHumus += dm;
    } else {
      toLitter += -dm; // necromass: what it shed goes back to the surface
    }
    const m = Math.max(0, o.m + dm);
    if (m < DEATH_MASS) {
      toLitter += m;
      died.push(o.id);
      continue;
    }
    next.push({ ...o, m });
  }

  let root = 0;
  let mycelium = 0;
  for (const o of next) {
    if (o.kind === "root") root += o.m;
    else mycelium += o.m;
  }
  // The biotic pools ARE the lives: they are read back off the survivors, so
  // a pool can never hold biomass for an organism that no longer stands. What
  // the dead were made of left through `toLitter` on the way here.
  const state: SoilState = {
    pools: {
      litter: pools.litter + toLitter,
      humus: Math.max(0, pools.humus - takenHumus),
      mineral: Math.max(0, pools.mineral - takenMineral),
      mycelium,
      root,
    },
    tau: after.tau,
  };
  return { state, organisms: next, died };
}

/**
 * What happened while nobody was watching. Capped like world.ts caps drift —
 * a soil left for a year is a mature soil, not an extrapolated one — and
 * evaluated in ONE call whatever the span, because both halves are closed
 * form. This is the room's aliveness and its performance law at once.
 */
export function settleElapsed(
  s: SoilState,
  orgs: Organism[],
  elapsedSec: number,
  c: Climate,
): SettleResult {
  return settle(s, orgs, clamp(elapsedSec, 0, MAX_ELAPSED_S), c);
}

/**
 * Make the biotic pools agree with the lives actually standing. Storage can
 * disagree with itself — a write interrupted between the ledger and the
 * organisms — and this is the repair: the organisms are the truth, and any
 * biomass the pools claimed for nobody falls back to litter rather than
 * vanishing.
 */
export function reconcile(s: SoilState, orgs: Organism[]): SoilState {
  let root = 0;
  let mycelium = 0;
  for (const o of orgs) {
    if (o.kind === "root") root += o.m;
    else mycelium += o.m;
  }
  const stranded = Math.max(0, s.pools.root - root) + Math.max(0, s.pools.mycelium - mycelium);
  return {
    pools: { ...s.pools, root, mycelium, litter: s.pools.litter + stranded },
    tau: s.tau,
  };
}

// ——— what a hand does ————————————————————————————————————————————

/** Move nutrient from one pool to another. Never moves more than is there. */
export function transfer(
  s: SoilState,
  from: Pool,
  to: Pool,
  amount: number,
): { state: SoilState; moved: number } {
  if (from === to || !(amount > 0)) return { state: s, moved: 0 };
  const moved = Math.min(amount, Math.max(0, s.pools[from]));
  if (!(moved > 0)) return { state: s, moved: 0 };
  const pools = { ...s.pools };
  pools[from] -= moved;
  pools[to] += moved;
  return { state: { pools, tau: s.tau }, moved };
}

/**
 * Something falls on the soil. This is the ONE way the ledger grows, and it
 * grows by exactly what was accepted — the rest is refused at the brim, not
 * quietly swallowed. The shared coast (lib/world.ts) is what feeds it.
 */
export function addLitter(s: SoilState, amount: number): { state: SoilState; accepted: number } {
  const headroom = Math.max(0, MAX_TOTAL - totalOf(s));
  const accepted = Math.min(Math.max(0, amount), headroom);
  if (!(accepted > 0)) return { state: s, accepted: 0 };
  return {
    state: { pools: { ...s.pools, litter: s.pools.litter + accepted }, tau: s.tau },
    accepted,
  };
}

/**
 * A handful lifted out. A handful is a sample of the whole, so it takes every
 * pool in proportion and leaves the soil the same *kind* of soil, only less of
 * it. What it removes is what it weighed.
 */
export function takeAway(s: SoilState, amount: number): { state: SoilState; taken: number } {
  const total = totalOf(s);
  const taken = Math.min(Math.max(0, amount), Math.max(0, total - MIN_TOTAL));
  if (!(taken > 0)) return { state: s, taken: 0 };
  const f = (total - taken) / total;
  const pools = {} as Pools;
  for (const p of POOLS) pools[p] = s.pools[p] * f;
  return { state: { pools, tau: s.tau }, taken };
}

/**
 * Plant a life. Its first body is matter, so it comes OUT of the litter lying
 * on the surface — the ground refuses when there is nothing left to make it
 * from, which is a real constraint and the one refusal in the room.
 */
export function plant(
  s: SoilState,
  orgs: Organism[],
  kind: OrganismKind,
  nx: number,
  ny: number,
  seed: number,
): { state: SoilState; organisms: Organism[]; planted: Organism | null } {
  if (orgs.length >= MAX_ORGANISMS || s.pools.litter < SEED_MASS) {
    return { state: s, organisms: orgs, planted: null };
  }
  const pools = { ...s.pools };
  pools.litter -= SEED_MASS;
  if (kind === "root") pools.root += SEED_MASS;
  else pools.mycelium += SEED_MASS;
  let id = 1;
  for (const o of orgs) if (o.id >= id) id = o.id + 1;
  const planted: Organism = {
    id,
    kind,
    nx: clamp01(nx),
    ny: clamp01(ny),
    m: SEED_MASS,
    bornTau: s.tau,
    seed: seed >>> 0,
  };
  return { state: { pools, tau: s.tau }, organisms: [...orgs, planted], planted };
}

/**
 * Pull a life out of the ground. Its body does not vanish — it lands back on
 * the surface as litter and the cascade takes it from there.
 */
export function uproot(
  s: SoilState,
  orgs: Organism[],
  id: number,
): { state: SoilState; organisms: Organism[]; pulled: Organism | null } {
  const found = orgs.find((o) => o.id === id) ?? null;
  if (!found) return { state: s, organisms: orgs, pulled: null };
  const pools = { ...s.pools };
  if (found.kind === "root") pools.root = Math.max(0, pools.root - found.m);
  else pools.mycelium = Math.max(0, pools.mycelium - found.m);
  pools.litter += found.m;
  return {
    state: { pools, tau: s.tau },
    organisms: orgs.filter((o) => o.id !== id),
    pulled: found,
  };
}

/** The life nearest a point, within a radius. What a flick or a keypress finds. */
export function nearestOrganism(orgs: Organism[], nx: number, ny: number, within = 0.18): Organism | null {
  let best: Organism | null = null;
  // only the ranking matters here, never the distance itself, so the whole
  // search stays in squared-distance space and never pays for a sqrt.
  let bestD2 = within * within;
  for (const o of orgs) {
    const dx = o.nx - nx;
    const dy = o.ny - ny;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      bestD2 = d2;
      best = o;
    }
  }
  return best;
}

// ——— what a handful is at a given depth ————————————————————————————

/** How far the surface tilts the mix toward litter. */
export const DEPTH_TILT = 0.6;

/**
 * The section is not uniform: litter lies at the top and rots downward, so a
 * handful taken near the surface carries more of it and a handful from the
 * floor carries more humus and mineral. The tilt is antisymmetric about
 * mid-depth, so the surface and the floor average back to the bulk mix — the
 * layering redistributes the ledger, it does not invent any.
 */
export function mixAtDepth(mix: Mix, depth: number): Mix {
  const d = clamp01(depth);
  const w = DEPTH_TILT * (1 - 2 * d);
  const denom = mix.humus + mix.mineral;
  if (denom <= 0) return mix;
  let give = w * mix.litter;
  // never take more from the lower pools than they hold
  if (give > denom * 0.9) give = denom * 0.9;
  const share = mix.humus / denom;
  return makePools(
    mix.litter + give,
    mix.humus - give * share,
    mix.mineral - give * (1 - share),
    mix.mycelium,
    mix.root,
  );
}

/**
 * How far this has rotted: everything that is no longer recognizable litter.
 * The one scalar the ear reads straight off the centroid.
 */
export function decompositionOf(mix: Mix): number {
  return clamp01(1 - mix.litter);
}

// ——— the map: the ledger, heard ————————————————————————————————————

export type Timbre = {
  /** the fundamental — a heavier handful sits lower */
  midi: number;
  /** spectral centroid — litter is dry and crisp, humus is dark */
  centroidHz: number;
  /** how long it rings — mineral grains are the hard thing in soil */
  ringSec: number;
  /** where humus damps it — soft dead matter eats the top */
  dampHz: number;
  /** the slow beat of threads breathing against each other */
  beatHz: number;
};

export const MIDI_LO = 26;
export const MIDI_HI = 46;
export const CENTROID_LO = 110;
export const CENTROID_HI = 1760;
export const RING_LO = 0.18;
export const RING_HI = 1.6;
export const DAMP_HI = 5200;
export const DAMP_LO = 260;
export const BEAT_MAX = 6.5;

/** The ledger as sound. Five numbers in, five numbers out, nothing lost. */
export function timbreOf(mix: Mix, total: number): Timbre {
  return {
    midi: MIDI_HI - (MIDI_HI - MIDI_LO) * clamp01(total / MAX_TOTAL),
    centroidHz: CENTROID_LO * Math.pow(CENTROID_HI / CENTROID_LO, clamp01(mix.litter)),
    ringSec: RING_LO + (RING_HI - RING_LO) * clamp01(mix.mineral),
    dampHz: DAMP_HI * Math.pow(DAMP_LO / DAMP_HI, clamp01(mix.humus)),
    beatHz: BEAT_MAX * clamp01(mix.mycelium),
  };
}

/** The timbre of the section as it stands. */
export function timbreOfState(s: SoilState): Timbre {
  return timbreOf(mixOf(s), totalOf(s));
}

/** ...and back. The map only earns its place because this exists. */
export function mixFromTimbre(t: Timbre): Mix {
  const litter = Math.log(t.centroidHz / CENTROID_LO) / Math.log(CENTROID_HI / CENTROID_LO);
  const mineral = (t.ringSec - RING_LO) / (RING_HI - RING_LO);
  const humus = Math.log(t.dampHz / DAMP_HI) / Math.log(DAMP_LO / DAMP_HI);
  const mycelium = t.beatHz / BEAT_MAX;
  const root = 1 - (litter + humus + mineral + mycelium);
  return makePools(litter, humus, mineral, mycelium, root);
}

export function totalFromTimbre(t: Timbre): number {
  return (MAX_TOTAL * (MIDI_HI - t.midi)) / (MIDI_HI - MIDI_LO);
}

/** The decomposition scalar, read straight back out of the sound. */
export function decompositionFromTimbre(t: Timbre): number {
  return clamp01(1 - Math.log(t.centroidHz / CENTROID_LO) / Math.log(CENTROID_HI / CENTROID_LO));
}

export function hzForMidi(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export type SoundPartial = { hz: number; sec: number; gain: number };

/** How many partials the room will ever stack on one handful. */
export const MAX_PARTIALS = 7;
/** Below this a partial is not worth a voice. */
export const AUDIBLE_GAIN = 0.02;

/**
 * The timbre as a small stack of partials the room can hand to the shared
 * audio graph one at a time. Brightness is not a decoration here: partials
 * above the centroid roll off, and humus's damping cuts them again, so a
 * rotted soil is audibly fewer voices than a fresh one.
 */
export function voiceOf(t: Timbre): SoundPartial[] {
  const f0 = hzForMidi(t.midi);
  const out: SoundPartial[] = [];
  for (let k = 1; k <= MAX_PARTIALS; k++) {
    const hz = f0 * k;
    // the centroid is where the spectrum still has its weight
    const bright = 1 / (1 + Math.pow(hz / t.centroidHz, 2));
    // ...and humus damps whatever survived that
    const damp = 1 / (1 + Math.pow(hz / t.dampHz, 2));
    const gain = bright * damp * (1 / k);
    if (gain < AUDIBLE_GAIN) continue;
    out.push({ hz, sec: t.ringSec * (0.55 + 0.45 / k), gain });
  }
  // the threads: one detuned twin of the fundamental, beating at beatHz
  if (t.beatHz > 0.05 && out.length > 0 && out[0].gain * 0.7 >= AUDIBLE_GAIN) {
    out.push({ hz: f0 + t.beatHz, sec: t.ringSec, gain: out[0].gain * 0.7 });
  }
  return out;
}

// ——— roots: how far down a life has reached ————————————————————————

export const ROOT_DEPTH_MAX = 0.86;
const ROOT_DEPTH_SCALE = 0.05;

/** How far this root has reached below where it was planted. Saturating. */
export function rootReach(o: Organism): number {
  return ROOT_DEPTH_MAX * (1 - Math.exp(-Math.max(0, o.m) / ROOT_DEPTH_SCALE));
}

// ——— mycelium: a real graph ————————————————————————————————————————

export type Edge = { a: number; b: number };

export const REACH_MAX = 0.34;
export const REACH_TAU_S = 30 * 3600;
export const REACH_FULL_FRAC = 0.12;

/**
 * How far a thread has crept. It grows with maturity and with how much of the
 * ledger is actually fungal — a soil with no mycelium has no threads however
 * long you leave it — and it saturates: threads never cross the whole frame.
 */
export function reachAt(tau: number, myceliumFraction: number): number {
  const grown = 1 - Math.exp(-Math.max(0, tau) / REACH_TAU_S);
  return REACH_MAX * grown * clamp01(myceliumFraction / REACH_FULL_FRAC);
}

/**
 * The threads a fungal network actually holds: every pair inside reach, with
 * at least one fungus in it — a hypha runs from a fungus to a fungus or from a
 * fungus into a root, never from one root to another. O(n²) with n capped at
 * MAX_ORGANISMS, and recomputed on a slow cadence, never per frame.
 */
export function threadsBetween(orgs: Organism[], reach: number): Edge[] {
  const out: Edge[] = [];
  if (!(reach > 0)) return out;
  const r2 = reach * reach;
  for (let i = 0; i < orgs.length; i++) {
    for (let j = i + 1; j < orgs.length; j++) {
      if (orgs[i].kind !== "fungus" && orgs[j].kind !== "fungus") continue;
      const dx = orgs[i].nx - orgs[j].nx;
      const dy = orgs[i].ny - orgs[j].ny;
      if (dx * dx + dy * dy <= r2) out.push({ a: i, b: j });
    }
  }
  return out;
}

/** Component id per node — union-find, so connectivity is transitive by construction. */
export function componentsOf(count: number, edges: Edge[]): number[] {
  const parent = new Array<number>(count);
  for (let i = 0; i < count; i++) parent[i] = i;
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    let cur = x;
    while (parent[cur] !== cur) {
      const next = parent[cur];
      parent[cur] = r;
      cur = next;
    }
    return r;
  };
  for (const e of edges) {
    const ra = find(e.a);
    const rb = find(e.b);
    if (ra !== rb) parent[ra] = rb;
  }
  const label = new Map<number, number>();
  const out = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    const r = find(i);
    let l = label.get(r);
    if (l === undefined) {
      l = label.size;
      label.set(r, l);
    }
    out[i] = l;
  }
  return out;
}

export function componentCount(count: number, edges: Edge[]): number {
  if (count <= 0) return 0;
  const comps = componentsOf(count, edges);
  let max = -1;
  for (const c of comps) if (c > max) max = c;
  return max + 1;
}

/** The largest island of connected soil, as a share of all the lives. */
export function largestComponentShare(count: number, edges: Edge[]): number {
  if (count <= 0) return 0;
  const comps = componentsOf(count, edges);
  const tally = new Map<number, number>();
  for (const c of comps) tally.set(c, (tally.get(c) ?? 0) + 1);
  let best = 0;
  for (const n of tally.values()) if (n > best) best = n;
  return best / count;
}

// ——— determinism ————————————————————————————————————————————————

export function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h ^= Math.round(p) | 0;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The soil that is already there the first time anyone arrives. */
export function starterState(seed: number): SoilState {
  const rng = mulberry32(seed >>> 0);
  // Soil is mostly mineral — the parent material it was ground out of — with
  // a thin organic surface on top. The proportions are the real ones.
  const litter = 0.12 + rng() * 0.04;
  const humus = 0.18 + rng() * 0.05;
  const mineral = 0.32 + rng() * 0.05;
  // Three days old at the first glance: nothing here begins empty.
  return { pools: makePools(litter, humus, mineral, 0, 0), tau: 72 * 3600 };
}

/**
 * The lives already standing when you arrive — a fungus in the litter and two
 * roots down in the mineral, so the section shows what it is for before a hand
 * touches it. Their mass is taken out of the starter ledger, not added to it.
 */
export function starterOrganisms(s: SoilState, seed: number): { state: SoilState; organisms: Organism[] } {
  const rng = mulberry32(seed >>> 0);
  let state = s;
  let orgs: Organism[] = [];
  const spec: { kind: OrganismKind; nx: number; ny: number }[] = [
    // one pair close enough to have found each other, and one root off on
    // its own — the trade and its absence, visible in the first frame
    { kind: "root", nx: 0.26 + rng() * 0.06, ny: 0.56 + rng() * 0.06 },
    { kind: "fungus", nx: 0.34 + rng() * 0.05, ny: 0.44 + rng() * 0.05 },
    { kind: "root", nx: 0.62 + rng() * 0.07, ny: 0.5 + rng() * 0.08 },
  ];
  for (const p of spec) {
    const res = plant(state, orgs, p.kind, p.nx, p.ny, hashSeed(seed, p.nx * 1e4, p.ny * 1e4));
    state = res.state;
    orgs = res.organisms;
  }
  // ...and they have been standing there three days already, grown by the
  // room's own law rather than by a number typed in. Nothing was added: the
  // ledger only moved.
  const grown = settle(state, orgs, 3 * 24 * 3600, { warmth: 0.45, wet: 0.55 });
  return { state: grown.state, organisms: grown.organisms };
}
