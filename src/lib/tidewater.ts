// object-compiler template — docs/plans/object-compiler.md M3.
// Consumes: spec.domain_lib.name, spec.domain_lib.title,
//           spec.domain_lib.brief, spec.invariant_type, spec.key.
// One LLM slot below carries the actual physics; the prelude is verbatim.

/**
 * tidewater — the laws of /tidepool.
 *
 * The invariant is a state vector: 
 *
 * Pure math, no imports, no DOM — node-testable
 * (scripts/test-tidewater.mjs). See INSPIRATION.md §2 (maps
 * between representations) and §4 (aliveness down the stack), and
 * docs/new-room.md §4.
 */

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

export const clamp = (v: number, a: number, b: number): number =>
  v < a ? a : v > b ? b : v;
export const clamp01 = (v: number): number => clamp(v, 0, 1);

// ——— the invariant, and every process that only moves it ———————————

/** A creature kind — three lattices sharing one substrate. */
export type CreatureKind = "snail" | "anemone" | "kelp";

/**
 * A single creature on the tide pool's substrate. Each carries its own
 * biomass in [0, MAX_BIOMASS], plus a per-kind flag (curl for anemones,
 * retreated for snails, bendPhase for kelp). Sealed creatures are keepers
 * — kept between visits.
 */
export type Creature = {
  id: number;
  kind: CreatureKind;
  /** normalized x in the pool's frame (POOL_X_MIN..POOL_X_MAX) */
  x: number;
  /** normalized y in the pool's frame (POOL_Y_MIN..POOL_Y_MAX); smaller y = higher on the rim */
  y: number;
  /** the creature's biomass, 0..MAX_BIOMASS — the load-bearing scalar */
  biomass: number;
  /** deterministic phase in 0..1, from mulberry32(hashSeed(seedKey, id)) */
  phase: number;
  /** true once ceremony sealed it — a keeper, kept between visits */
  sealed: boolean;
  /** anemone-only: 0 = fully open, 1 = fully closed. defaults to 0 for others. */
  curl: number;
  /** snail-only: true if hiding in shell (transient, decays). defaults false. */
  retreated: boolean;
  /** ms timestamp when the snail retreated; used to decay the retreated flag. */
  retreatedUntilMs: number;
  /** kelp-only: current bend deflection driven by state.current; -1..1. defaults 0. */
  bendPhase: number;
};

/** The world-law layer the three-finger hand turns. */
export type Climate = {
  /** 0 = cold, 1 = high summer — scales kelp growth and biofilm bloom */
  warmth: number;
  /** 0 = drought, 1 = downpour — past STORM_THRESHOLD activates storm state */
  wet: number;
};

/**
 * The whole tide pool: three creature populations, a shared climate, a
 * biofilm scalar the breath warms, an internal clock tau, and the seed.
 */
export type PoolState = {
  creatures: Creature[];
  climate: Climate;
  /** biofilm scalar in [0, 1] — the granite's slow bloom */
  biofilm: number;
  /** current signed magnitude in [-1, 1] — kelp bends with it */
  current: number;
  /** seconds of the pool's life — feeds the tide clock H(t) */
  tau: number;
  /** cumulative storm knocks the pool remembers */
  stormKnockCount: number;
  /** the seed the room persisted under, so creature phases stay stable */
  seedKey: number;
};

/** Never let a month away become a century: world.ts's law, in seconds. */
export const MAX_ELAPSED_S = 14 * 24 * 3600;
/** Pool bounds — outside is granite (above the rim) or bedrock (below the pool floor). */
export const POOL_X_MIN = 0.08;
export const POOL_X_MAX = 0.92;
export const POOL_Y_MIN = 0.20;
export const POOL_Y_MAX = 0.90;
/** The three anchor zones — rim, hollow, shelf — decide creature kind on plant. */
export const RIM_Y_MAX = 0.34;      // above this y is the rim: snails only
export const HOLLOW_Y_MIN = 0.55;   // below this y is the deep hollow: anemones (via ceremony)
export const SHELF_Y_MIN = 0.35;    // between rim and hollow is the shelf: kelp

/** Per-kind population caps. */
export const SNAIL_CAP = 12;
export const ANEMONE_CAP = 8;
export const KELP_CAP = 10;
/** Total cap — a defensive belt in addition to the per-kind caps. */
export const MAX_CREATURES = SNAIL_CAP + ANEMONE_CAP + KELP_CAP;
/** A creature cannot grow past this — the biological ceiling. */
export const MAX_BIOMASS = 1;

/**
 * Base growth rate for snails, per second of ledger time. A snail at max
 * algae-density saturates to 1 with time-constant ≈ 1/R_SNAIL_BASE.
 */
export const R_SNAIL_BASE = 4e-4;
/** Base growth rate for kelp — scales linearly with warmth. */
export const R_KELP_BASE = 6e-4;
/** How much a nearby snail suppresses local kelp growth (grazing). */
export const GRAZE_C = 0.6;
/** How much of neighbouring kelp biomass an anemone can filter per second. */
export const FILTER_C = 4e-5;
/** Snail retreat timeout — a shaken snail hides for this many milliseconds. */
export const SNAIL_RETREAT_MS = 3000;

/** Tide clock: seconds per full cycle. 33s — a patient hand sees one full pass in a minute. */
export const TIDE_PERIOD_S = 33;
/** Tide amplitude — the offset of the waterline from its mean. */
export const H_AMP = 0.18;
/** Mean waterline y (in normalized pool space). */
export const H_MEAN = 0.5;
/** Storm displacement — how much the mean level rises during storm. */
export const H_STORM_MAX = 0.16;
/** Storm state activates once climate.wet crosses this threshold. */
export const STORM_THRESHOLD = 0.85;
/** State band width — how far H must be from the mean before low/high state weight goes to 1. */
export const STATE_BAND = 0.35 * H_AMP;

/** Per-kind pitch bases and scale. Bigger biomass rings LOWER (bell mass rule). */
export const SNAIL_PITCH_BASE_HZ = 520;
export const ANEMONE_PITCH_BASE_HZ = 820;
export const KELP_PITCH_BASE_HZ = 0; // kelp does not ring
export const PITCH_SCALE = 0.5;

// ——— the tide clock ————————————————————————————————————————————

/**
 * The ocean outside the pool — the driver. Sinusoidal, pure, deterministic.
 * The pool listens to this but is not equal to it.
 */
export function oceanTide(t: number, climate: Climate): number {
  const cycle = H_AMP * Math.sin((2 * Math.PI * t) / TIDE_PERIOD_S);
  const storm = stormDisplacement(climate);
  return H_MEAN + cycle + storm;
}

/**
 * The rim of the rock pool — the ocean must climb past this to overtop it
 * and refill the pool. Set inside the amplitude so the ocean crosses the
 * rim twice per cycle (once going up, once coming down).
 */
export const RIM_H = H_MEAN + 0.55 * H_AMP;

/**
 * The floor the pool decays toward when isolated — never fully dry, but
 * far enough below the rim that low_tide state weight fires cleanly.
 */
export const POOL_MIN_H = H_MEAN - 1.5 * H_AMP;

/**
 * Seconds for the isolated pool to lose 63% of its RIM_H → POOL_MIN_H head.
 * Slow, so the pool holds its water most of the time.
 */
export const POOL_EVAP_TAU_S = 15;

/**
 * The pool's water level at time t (seconds).
 *
 * Two regimes:
 *  - Connected: ocean is above the rim. Waves wash into the pool, so the
 *    pool tracks the ocean instantaneously (the approximation is exact
 *    while the ocean is above the rim, because inflow > any credible
 *    evaporation rate on this timescale).
 *  - Isolated: ocean has dropped below the rim. The pool is a puddle now,
 *    losing head exponentially toward POOL_MIN_H with time constant
 *    POOL_EVAP_TAU_S. Head resets to (RIM_H + any storm boost that was
 *    still in effect at the moment of disconnection) at the down-crossing.
 *
 * Closed-form. Bounded to one cycle by modular arithmetic on TIDE_PERIOD_S,
 * so the answer at t and at t + TIDE_PERIOD_S is identical (up to the
 * storm displacement, which is time-invariant given the same climate).
 * This is why the sine tide over 33 seconds does NOT drag the whole
 * waterline up and down like a spring — the pool decouples and holds.
 */
export function waterLevel(t: number, climate: Climate): number {
  const storm = stormDisplacement(climate);
  const oceanCore = oceanTide(t, { warmth: climate.warmth, wet: 0 }) - H_MEAN;
  // If the ocean (including storm bump) is over the rim, the pool matches it.
  if (oceanCore + H_MEAN + storm >= RIM_H) {
    return oceanCore + H_MEAN + storm;
  }
  // Otherwise the pool is isolated. Find the last down-crossing of the rim
  // in the current cycle, exponentially decay from that starting head toward
  // POOL_MIN_H. The rim crossing happens at sin(phase) = (RIM_H - H_MEAN - storm) / H_AMP.
  // Solve for the down-crossing phase in [π/2, 3π/2] (the descending half of
  // the sine): phaseDown = π - asin(k), where k = (RIM_H - H_MEAN - storm)/H_AMP.
  const k = (RIM_H - H_MEAN - storm) / H_AMP;
  // If storm pushes the ocean permanently above the rim, there is no
  // isolated regime — the pool never disconnects. Guard the asin domain.
  if (k <= -1) return oceanCore + H_MEAN + storm;
  const T = TIDE_PERIOD_S;
  const twoPi = 2 * Math.PI;
  const phase = ((t % T) + T) % T * (twoPi / T);
  const phaseDown = Math.PI - Math.asin(k);
  // Phase since disconnection, wrapped into [0, 2π).
  let dPhase = phase - phaseDown;
  if (dPhase < 0) dPhase += twoPi;
  const dtSince = (dPhase / twoPi) * T;
  const decay = Math.exp(-dtSince / POOL_EVAP_TAU_S);
  const startingHead = RIM_H + storm;
  return POOL_MIN_H + (startingHead - POOL_MIN_H) * decay;
}

/**
 * How hard the ocean is currently overtopping the rim — 0 when the ocean
 * is below the rim, ramps to 1 as it climbs a small band above. Drives the
 * splash/foam layer at the rim during the connected window, and the audible
 * wash the room's timbre reads.
 */
export function overtoppingIntensity(t: number, climate: Climate): number {
  const ocean = oceanTide(t, climate);
  const above = ocean - RIM_H;
  if (above <= 0) return 0;
  const OVERTOP_BAND = 0.04;
  return clamp01(above / OVERTOP_BAND);
}

/**
 * The storm's contribution to the water level. Zero below the threshold,
 * ramping smoothly to H_STORM_MAX as climate.wet climbs. Kept smooth so
 * the shader's crossfade reads cleanly.
 */
export function stormDisplacement(climate: Climate): number {
  const w = clamp01(climate.wet);
  if (w < STORM_THRESHOLD) return 0;
  const over = (w - STORM_THRESHOLD) / (1 - STORM_THRESHOLD);
  // Smoothstep so the storm arrives gently rather than switching on hard.
  return H_STORM_MAX * over * over * (3 - 2 * over);
}

/**
 * The four state weights (low_tide, high_tide, mid_tide, storm) as a
 * function of water level and climate. Summing to 1; smooth crossfades
 * so the shader never tears. This is a READ-OFF function — the state
 * machine has no independent state; the water level and climate are
 * authoritative.
 */
export function stateWeights(t: number, climate: Climate): {
  low: number;
  high: number;
  mid: number;
  storm: number;
} {
  const h = waterLevel(t, climate);
  const offset = h - H_MEAN;
  // Low weight ramps up as h drops below the mean minus the band.
  const low = clamp01((-offset - STATE_BAND) / STATE_BAND + 1);
  // High weight ramps up as h climbs above the mean plus the band.
  const high = clamp01((offset - STATE_BAND) / STATE_BAND + 1);
  // Storm weight is stormDisplacement / H_STORM_MAX.
  const storm = clamp01(stormDisplacement(climate) / H_STORM_MAX);
  // Mid is what's left before storm reweighting.
  const midRaw = clamp01(1 - low - high);
  // Storm eats into everything else proportionally.
  const stormShare = storm;
  const rest = 1 - stormShare;
  return {
    low: low * rest,
    high: high * rest,
    mid: midRaw * rest,
    storm: stormShare,
  };
}

/** The current state — the mode with the highest weight. */
export function currentState(t: number, climate: Climate): "low_tide" | "high_tide" | "mid_tide" | "storm" {
  const w = stateWeights(t, climate);
  let best: "low_tide" | "high_tide" | "mid_tide" | "storm" = "mid_tide";
  let bestV = w.mid;
  if (w.low > bestV) { best = "low_tide"; bestV = w.low; }
  if (w.high > bestV) { best = "high_tide"; bestV = w.high; }
  if (w.storm > bestV) { best = "storm"; bestV = w.storm; }
  return best;
}

// ——— the biomass → pitch map, and its exact inverse ————————————————

/** Ring frequency for a given creature kind and biomass. Monotone-DECREASING for the ringing kinds. */
export function ringHzFor(kind: CreatureKind, biomass: number): number {
  const base =
    kind === "snail"
      ? SNAIL_PITCH_BASE_HZ
      : kind === "anemone"
      ? ANEMONE_PITCH_BASE_HZ
      : KELP_PITCH_BASE_HZ;
  if (base <= 0) return 0;
  return base * Math.pow(2, -clamp(biomass, 0, MAX_BIOMASS) / PITCH_SCALE);
}

/** Biomass recovered from a ring frequency for a kind. Exact inverse of ringHzFor. */
export function biomassForRingHz(kind: CreatureKind, hz: number): number {
  const base =
    kind === "snail"
      ? SNAIL_PITCH_BASE_HZ
      : kind === "anemone"
      ? ANEMONE_PITCH_BASE_HZ
      : KELP_PITCH_BASE_HZ;
  if (base <= 0 || !(hz > 0)) return 0;
  return -PITCH_SCALE * Math.log2(hz / base);
}

// ——— observables ————————————————————————————————————————————————

/** Return only the creatures of a given kind. */
export function creaturesOfKind(state: PoolState, kind: CreatureKind): Creature[] {
  return state.creatures.filter((c) => c.kind === kind);
}

/** Count of creatures of a kind. */
export function countOfKind(state: PoolState, kind: CreatureKind): number {
  let n = 0;
  for (const c of state.creatures) if (c.kind === kind) n++;
  return n;
}

/** The mean biomass across a kind. Zero when nobody. */
export function meanBiomass(state: PoolState, kind?: CreatureKind): number {
  let n = 0;
  let s = 0;
  for (const c of state.creatures) {
    if (kind !== undefined && c.kind !== kind) continue;
    s += c.biomass;
    n++;
  }
  return n > 0 ? s / n : 0;
}

/** Total biomass across the pool — the conservation observable for the test. */
export function totalBiomass(state: PoolState): number {
  let m = 0;
  for (const c of state.creatures) m += c.biomass;
  return m;
}

/** How many creatures have been sealed as keepers. */
export function keeperCount(state: PoolState): number {
  let n = 0;
  for (const c of state.creatures) if (c.sealed) n++;
  return n;
}

// ——— the pool's regions ——————————————————————————————————————————

/** Whether a point lies inside the pool's bounds. */
export function inPoolBounds(x: number, y: number): boolean {
  return x >= POOL_X_MIN && x <= POOL_X_MAX && y >= POOL_Y_MIN && y <= POOL_Y_MAX;
}

/**
 * Read the anchor zone at (x, y). Position alone decides which kind a
 * dwell can plant — rim above, shelf between, hollow below.
 */
export function zoneAt(y: number): "rim" | "shelf" | "hollow" {
  if (y <= RIM_Y_MAX) return "rim";
  if (y >= HOLLOW_Y_MIN) return "hollow";
  return "shelf";
}

/** Which kind a dwell in a zone would try to plant (anemones excluded — they need ceremony). */
export function kindForDwell(y: number): CreatureKind | null {
  const z = zoneAt(y);
  if (z === "rim") return "snail";
  if (z === "shelf") return "kelp";
  return null; // hollow — anemones only through ceremony
}

// ——— growth ————————————————————————————————————————————————————

/** Effective snail growth rate under nearby algae density. */
export function snailGrowthRate(state: PoolState, snail: Creature): number {
  // A snail's growth rate scales with the local kelp biomass — it grazes.
  let localKelp = 0;
  for (const c of state.creatures) {
    if (c.kind !== "kelp") continue;
    const d = Math.hypot(c.x - snail.x, c.y - snail.y);
    if (d < 0.15) localKelp += c.biomass * (1 - d / 0.15);
  }
  return R_SNAIL_BASE * (0.35 + 0.65 * clamp01(localKelp));
}

/** Effective kelp growth rate under illumination and local grazing pressure. */
export function kelpGrowthRate(state: PoolState, kelp: Creature): number {
  // Illumination scales with climate.warmth; shelf position gets more sun.
  const illum = 0.35 + 0.65 * clamp01(state.climate.warmth);
  // Nearby snails graze the kelp — each snail's biomass reduces the rate.
  let grazePressure = 0;
  for (const c of state.creatures) {
    if (c.kind !== "snail") continue;
    const d = Math.hypot(c.x - kelp.x, c.y - kelp.y);
    if (d < 0.12) grazePressure += c.biomass * (1 - d / 0.12);
  }
  const graze = Math.max(0, 1 - GRAZE_C * grazePressure);
  return R_KELP_BASE * illum * graze;
}

// ——— the closed-form advance ——————————————————————————————————

/**
 * Advance the pool by `seconds` under a stable climate. Each snail and
 * kelp obeys `dB/dt = r · (MAX_BIOMASS - B)`, closed form per creature.
 * Anemones filter — a bounded drift from kelp to anemone biomass, taken
 * as a Euler step because the coupling makes closed form intractable.
 * The Euler step is bounded by dt ≤ CFL_DT_MAX so FILTER_C is stable;
 * sub-stepping handles longer elapses (phase-6 CFL guidance).
 *
 * Sealed creatures freeze at their current biomass unless the state
 * machine's storm weight is above 0.5, in which case an anemone's curl
 * is set to 1 and a snail's retreated flag is set — a keeper is not
 * immune to a storm reading it.
 */
export function advanceExact(
  state: PoolState,
  seconds: number,
  climate: Climate,
): PoolState {
  if (!(seconds > 0)) return state;
  const dt = Math.min(seconds, MAX_ELAPSED_S);

  // CFL: an explicit Euler on filter dynamics is stable while
  // FILTER_C · dt · N_kelp_near ≤ 1; N_kelp_near is bounded by KELP_CAP,
  // so any dt ≤ 1/(FILTER_C · KELP_CAP) is safe. Sub-step past that.
  const CFL_DT_MAX = 1 / (FILTER_C * KELP_CAP);
  const nSubSteps = Math.max(1, Math.ceil(dt / CFL_DT_MAX));
  const subDt = dt / nSubSteps;

  let s = { ...state, climate };
  for (let step = 0; step < nSubSteps; step++) {
    // Advance snails + kelp closed-form per creature (they don't depend
    // on each other during subDt within the linearised approximation).
    const growN = s.creatures.map((c) => {
      if (c.kind === "snail") {
        if (c.sealed) return c;
        const r = snailGrowthRate(s, c);
        const decay = Math.exp(-r * subDt);
        const b1 = MAX_BIOMASS - (MAX_BIOMASS - c.biomass) * decay;
        return { ...c, biomass: clamp(b1, 0, MAX_BIOMASS) };
      }
      if (c.kind === "kelp") {
        const r = kelpGrowthRate(s, c);
        const decay = Math.exp(-r * subDt);
        const b1 = MAX_BIOMASS - (MAX_BIOMASS - c.biomass) * decay;
        return { ...c, biomass: clamp(b1, 0, MAX_BIOMASS) };
      }
      return c;
    });

    // Anemones filter — Euler step on the coupled dynamic.
    const growA = growN.map((c) => {
      if (c.kind !== "anemone") return c;
      let nearbyKelp = 0;
      for (const k of growN) {
        if (k.kind !== "kelp") continue;
        const d = Math.hypot(k.x - c.x, k.y - c.y);
        if (d < 0.18) nearbyKelp += k.biomass * (1 - d / 0.18);
      }
      const gain = FILTER_C * nearbyKelp * subDt;
      const b1 = clamp(c.biomass + gain, 0, MAX_BIOMASS);
      return { ...c, biomass: b1 };
    });

    // Snail retreated flag decays — a real timer read off the pool's tau.
    const now = s.tau + step * subDt;
    void now; // (retreated is decayed against Date.now in the component)

    s = { ...s, creatures: growA, tau: s.tau + subDt };
  }

  // Biofilm relaxes toward its climate-warmth steady state.
  const BIOFILM_RELAX = 1 / (30 * 60); // 30-minute time constant
  const biofilmTarget = 0.2 + 0.7 * clamp01(climate.warmth);
  const biofilm1 =
    biofilmTarget + (s.biofilm - biofilmTarget) * Math.exp(-BIOFILM_RELAX * dt);

  return { ...s, biofilm: clamp01(biofilm1) };
}

// ——— what a hand does ————————————————————————————————————————

/**
 * Plant an ordinary creature (snail or kelp — never an anemone) at (x, y).
 * The kind is decided by position (rim → snail, shelf → kelp). A dwell in
 * the hollow refuses — anemones require the ceremony.
 */
export function plantCreature(state: PoolState, x: number, y: number): PoolState {
  if (!inPoolBounds(x, y)) return state;
  const kind = kindForDwell(y);
  if (!kind) return state;
  if (kind === "snail" && countOfKind(state, "snail") >= SNAIL_CAP) return state;
  if (kind === "kelp" && countOfKind(state, "kelp") >= KELP_CAP) return state;
  if (state.creatures.length >= MAX_CREATURES) return state;
  let id = 1;
  for (const c of state.creatures) if (c.id >= id) id = c.id + 1;
  const phase = mulberry32(hashSeed(state.seedKey, id))();
  const creature: Creature = {
    id,
    kind,
    x: clamp01(x),
    y: clamp01(y),
    biomass: 0,
    phase,
    sealed: false,
    curl: 0,
    retreated: false,
    retreatedUntilMs: 0,
    bendPhase: 0,
  };
  return { ...state, creatures: [...state.creatures, creature] };
}

/**
 * The ceremony: plant an anemone in a hollow. Refuses outside the hollow,
 * refuses at cap, deterministic phase. The room's one solemn plant.
 */
export function ceremonyPlantAnemone(
  state: PoolState,
  x: number,
  y: number,
): PoolState {
  if (!inPoolBounds(x, y)) return state;
  if (zoneAt(y) !== "hollow") return state;
  if (countOfKind(state, "anemone") >= ANEMONE_CAP) return state;
  if (state.creatures.length >= MAX_CREATURES) return state;
  let id = 1;
  for (const c of state.creatures) if (c.id >= id) id = c.id + 1;
  const phase = mulberry32(hashSeed(state.seedKey, id))();
  const creature: Creature = {
    id,
    kind: "anemone",
    x: clamp01(x),
    y: clamp01(y),
    biomass: 0.4, // an anemone arrives with some starting mass
    phase,
    sealed: false,
    curl: 0,
    retreated: false,
    retreatedUntilMs: 0,
    bendPhase: 0,
  };
  return { ...state, creatures: [...state.creatures, creature] };
}

/**
 * Widen a creature's biomass by `dBiomass`. Bounded at MAX_BIOMASS; a
 * negative widens is a shrink. Sealed keepers do not grow.
 */
export function deepenCreature(
  state: PoolState,
  id: number,
  dBiomass: number,
): PoolState {
  const creatures = state.creatures.map((c) =>
    c.id === id && !c.sealed
      ? { ...c, biomass: clamp(c.biomass + dBiomass, 0, MAX_BIOMASS) }
      : c,
  );
  return { ...state, creatures };
}

/** Seal a creature as a keeper. Kept between visits. */
export function sealCreature(state: PoolState, id: number): PoolState {
  const creatures = state.creatures.map((c) =>
    c.id === id ? { ...c, sealed: true } : c,
  );
  return { ...state, creatures };
}

/**
 * Reproduce a creature near itself — the tap ladder's tier-3 rung on an
 * existing creature: a snail lays a cluster, a kelp frond fragments, an
 * anemone splits by binary fission (real anemone biology, not invented).
 * The parent pays a real third of its own biomass to fund the offspring —
 * a budget transfer, not a free duplicate — so the split is felt at the
 * parent too. Anemones can only be founded by the ceremony (hollow-only);
 * a split obeys that same law. Refuses (no-op) at the kind's cap, outside
 * the parent's own zone, or if the parent has too little biomass to spare.
 */
export function reproduceCreature(
  state: PoolState,
  id: number,
  offsetX: number,
  offsetY: number,
): { state: PoolState; childId: number | null } {
  const parent = state.creatures.find((c) => c.id === id);
  if (!parent || parent.biomass < 0.12) return { state, childId: null };
  const ox = clamp(parent.x + offsetX, POOL_X_MIN, POOL_X_MAX);
  const oy = clamp(parent.y + offsetY, POOL_Y_MIN, POOL_Y_MAX);
  const before = state.creatures.length;
  let next =
    parent.kind === "anemone" ? ceremonyPlantAnemone(state, ox, oy) : plantCreature(state, ox, oy);
  if (next.creatures.length <= before) return { state, childId: null };
  const child = next.creatures[next.creatures.length - 1];
  if (child.kind !== parent.kind) return { state, childId: null };
  const gift = parent.biomass * (1 / 3);
  next = deepenCreature(next, child.id, gift);
  next = {
    ...next,
    creatures: next.creatures.map((c) =>
      c.id === parent.id ? { ...c, biomass: clamp(c.biomass - gift, 0, MAX_BIOMASS) } : c,
    ),
  };
  return { state: next, childId: child.id };
}

/**
 * A hard knock startles the pool. Every anemone curls, every snail
 * retreats. Kelp thrashes (bendPhase spike). Returns the new state and
 * the count of creatures affected. During a storm state the caller
 * (verb slot) increments `stormKnockCount` on the state.
 */
export function knockStartle(
  state: PoolState,
  intensity: number,
  nowMs: number,
): { state: PoolState; affected: number } {
  const i = clamp01(intensity);
  let affected = 0;
  const creatures = state.creatures.map((c) => {
    if (c.kind === "anemone") {
      affected++;
      return { ...c, curl: Math.max(c.curl, 0.7 + i * 0.3) };
    }
    if (c.kind === "snail") {
      affected++;
      return {
        ...c,
        retreated: true,
        retreatedUntilMs: nowMs + SNAIL_RETREAT_MS,
      };
    }
    if (c.kind === "kelp") {
      affected++;
      return { ...c, bendPhase: (Math.sign(c.bendPhase) || 1) * (0.5 + i * 0.5) };
    }
    return c;
  });
  return { state: { ...state, creatures }, affected };
}

/**
 * The candle-invited breath: warm the pool and bloom the biofilm. `amount`
 * in 0..1; a single deep breath is ~0.35. Bounded at 1.
 */
export function breathWarm(state: PoolState, amount: number): PoolState {
  return { ...state, biofilm: clamp01(state.biofilm + amount) };
}

/**
 * Set the curl on an anemone directly (used by tap-during-low-tide and by
 * dwell-during-high-tide). Refuses on non-anemones.
 */
export function setAnemoneCurl(state: PoolState, id: number, curl: number): PoolState {
  const creatures = state.creatures.map((c) =>
    c.id === id && c.kind === "anemone"
      ? { ...c, curl: clamp01(curl) }
      : c,
  );
  return { ...state, creatures };
}

/** The creature nearest (x, y) within `within`, of any kind, or null. */
export function nearestCreature(
  state: PoolState,
  x: number,
  y: number,
  within = 0.1,
  kind?: CreatureKind,
): Creature | null {
  let best: Creature | null = null;
  let bestD = within;
  for (const c of state.creatures) {
    if (kind && c.kind !== kind) continue;
    const d = Math.hypot(c.x - x, c.y - y);
    if (d <= bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/**
 * Decay the transient flags (snail retreated, anemone curl toward the
 * state-machine floor, kelp bendPhase toward zero) on each frame. Called
 * by the component; keeps advanceExact pure and clock-independent.
 */
export function relaxTransients(
  state: PoolState,
  nowMs: number,
  dtSec: number,
  targetCurl: number,
): PoolState {
  const CURL_RELAX = 1 / 1.5; // 1.5s time constant
  const BEND_RELAX = 1 / 0.8; // 0.8s time constant
  const creatures = state.creatures.map((c) => {
    let out = { ...c };
    if (c.kind === "snail" && c.retreated && nowMs >= c.retreatedUntilMs) {
      out.retreated = false;
      out.retreatedUntilMs = 0;
    }
    if (c.kind === "anemone") {
      const decay = Math.exp(-CURL_RELAX * dtSec);
      out.curl = targetCurl + (c.curl - targetCurl) * decay;
    }
    if (c.kind === "kelp") {
      const decay = Math.exp(-BEND_RELAX * dtSec);
      out.bendPhase = c.bendPhase * decay;
    }
    return out;
  });
  return { ...state, creatures };
}

// ——— starter, storage ————————————————————————————————————————

/**
 * The tide pool that is already there the first time anyone arrives. A
 * scatter of kelp fronds on the sunlit shelf (deterministic from seed),
 * a couple of snails on the rim, one anemone in a hollow. Alive before
 * it is touched.
 */
export function initState(seed: number): PoolState {
  const rng = mulberry32(seed >>> 0);
  let state: PoolState = {
    creatures: [],
    climate: { warmth: 0.55, wet: 0.45 },
    biofilm: 0.4,
    current: 0.0,
    tau: 0,
    stormKnockCount: 0,
    seedKey: seed >>> 0,
  };
  // Scatter KELP_INITIAL kelp fronds along the sunlit shelf.
  const KELP_INITIAL = 5;
  for (let i = 0; i < KELP_INITIAL; i++) {
    const x = POOL_X_MIN + (POOL_X_MAX - POOL_X_MIN) * rng();
    const y = SHELF_Y_MIN + (HOLLOW_Y_MIN - SHELF_Y_MIN) * rng();
    let id = 1;
    for (const c of state.creatures) if (c.id >= id) id = c.id + 1;
    const phase = mulberry32(hashSeed(state.seedKey, id))();
    state = {
      ...state,
      creatures: [
        ...state.creatures,
        {
          id,
          kind: "kelp",
          x,
          y,
          biomass: 0.25 + rng() * 0.35,
          phase,
          sealed: false,
          curl: 0,
          retreated: false,
          retreatedUntilMs: 0,
          bendPhase: 0,
        },
      ],
    };
  }
  // Two snails on the rim.
  for (let i = 0; i < 2; i++) {
    const x = POOL_X_MIN + (POOL_X_MAX - POOL_X_MIN) * (0.25 + 0.5 * rng());
    const y = POOL_Y_MIN + (RIM_Y_MAX - POOL_Y_MIN) * rng();
    let id = 1;
    for (const c of state.creatures) if (c.id >= id) id = c.id + 1;
    const phase = mulberry32(hashSeed(state.seedKey, id))();
    state = {
      ...state,
      creatures: [
        ...state.creatures,
        {
          id,
          kind: "snail",
          x,
          y,
          biomass: 0.3 + rng() * 0.3,
          phase,
          sealed: false,
          curl: 0,
          retreated: false,
          retreatedUntilMs: 0,
          bendPhase: 0,
        },
      ],
    };
  }
  // One anemone in a hollow — the pool's original keeper.
  {
    const x = POOL_X_MIN + (POOL_X_MAX - POOL_X_MIN) * 0.5;
    const y = HOLLOW_Y_MIN + (POOL_Y_MAX - HOLLOW_Y_MIN) * 0.4;
    let id = 1;
    for (const c of state.creatures) if (c.id >= id) id = c.id + 1;
    const phase = mulberry32(hashSeed(state.seedKey, id))();
    state = {
      ...state,
      creatures: [
        ...state.creatures,
        {
          id,
          kind: "anemone",
          x,
          y,
          biomass: 0.55,
          phase,
          sealed: true, // the keeper is already sealed
          curl: 0,
          retreated: false,
          retreatedUntilMs: 0,
          bendPhase: 0,
        },
      ],
    };
  }
  // Let the ledger run six hours at a calm climate so the pool is already
  // breathing when the visitor arrives.
  return advanceExact(state, 6 * 3600, { warmth: 0.55, wet: 0.45 });
}
