/**
 * Quanta — the field floor for /quanta (the band at 10⁻²²…10⁻¹⁹ m, below
 * the quarks: the deepest room on the axis, where there are no things at
 * all, only fields — and every particle is a ripple a field was made to
 * carry).
 *
 * The whole room runs on ONE GREAT LAW: **lifetime and reach are inverse
 * to mass.** A photon is massless and crosses the field forever, its pitch
 * literally E = hf carried down into the audible register. The electron is
 * the lightest charged thing there is, so it has nothing to decay into and
 * simply stays. The muon is its heavier copy and lives a while; the tau, a
 * heavier copy again, less; the W, the Z, and the Higgs are so heavy they
 * die within a fingertip's breadth of where they were born. Neutrinos are
 * the ghosts — nearly massless, uncharged, streaming through everything
 * and almost never answering. The one exception that proves the other law:
 * the gluon is massless yet never travels far, because it carries the
 * charge it mediates — confinement dresses it back into the vacuum within
 * a short reach (the law /quarks lives by, seen from below).
 *
 * Everything the vacuum yields is BORN NEUTRAL: charged particles arrive
 * only as particle–antiparticle pairs, so total charge and each lepton
 * flavor number always sum to zero — and every decay conserves both, so
 * the whole field's books balance forever. Deposited energy climbs a
 * deterministic mass ladder (hold duration = energy): a short hold buys
 * only a photon; the ceremony at full charge affords the Higgs. The W pair
 * costs MORE than a Higgs, so the hand alone can never make one — only the
 * three-finger collision wind reaches that rung, which is why the real
 * ones needed a collider.
 *
 * Pure and import-free by law: same seed = same decay, forever. No DOM,
 * no audio, no side effects — node-testable (scripts/test-quanta.mjs).
 * The room that renders these (QuantaField) owns canvas, sound, haptics.
 */

// ————————————————————————————————————————————————————— the particle table

export type LeptonFlavor = "e" | "mu" | "tau";

export type ParticleId =
  | "photon"
  | "gluon"
  | "nu-e"
  | "nu-mu"
  | "nu-tau"
  | "electron"
  | "muon"
  | "tau"
  | "w"
  | "z"
  | "higgs";

export type ParticleSpec = {
  id: ParticleId;
  /** The symbol of the matter state — the lens's only lettering. */
  symbol: string;
  /** The conjugate state's symbol (equal for self-conjugate particles). */
  antiSymbol: string;
  /** Rest mass, MeV. */
  massMeV: number;
  /** Electric charge of the matter state (the anti state negates it). */
  charge: number;
  /** Lepton flavor number carried by the matter state (anti negates). */
  flavor: LeptonFlavor | null;
  /** Stable: crosses the field until something else happens to it. */
  stable: boolean;
  /** Self-conjugate: its own antiparticle (γ, Z, H — and g here). */
  selfConjugate: boolean;
};

export const PARTICLES: Record<ParticleId, ParticleSpec> = {
  photon: { id: "photon", symbol: "γ", antiSymbol: "γ", massMeV: 0, charge: 0, flavor: null, stable: true, selfConjugate: true },
  gluon: { id: "gluon", symbol: "g", antiSymbol: "g", massMeV: 0, charge: 0, flavor: null, stable: false, selfConjugate: true },
  "nu-e": { id: "nu-e", symbol: "νe", antiSymbol: "ν̄e", massMeV: 1e-7, charge: 0, flavor: "e", stable: true, selfConjugate: false },
  "nu-mu": { id: "nu-mu", symbol: "νμ", antiSymbol: "ν̄μ", massMeV: 1e-7, charge: 0, flavor: "mu", stable: true, selfConjugate: false },
  "nu-tau": { id: "nu-tau", symbol: "ντ", antiSymbol: "ν̄τ", massMeV: 1e-7, charge: 0, flavor: "tau", stable: true, selfConjugate: false },
  electron: { id: "electron", symbol: "e⁻", antiSymbol: "e⁺", massMeV: 0.511, charge: -1, flavor: "e", stable: true, selfConjugate: false },
  muon: { id: "muon", symbol: "μ⁻", antiSymbol: "μ⁺", massMeV: 105.66, charge: -1, flavor: "mu", stable: false, selfConjugate: false },
  tau: { id: "tau", symbol: "τ⁻", antiSymbol: "τ⁺", massMeV: 1776.86, charge: -1, flavor: "tau", stable: false, selfConjugate: false },
  w: { id: "w", symbol: "W⁻", antiSymbol: "W⁺", massMeV: 80377, charge: -1, flavor: null, stable: false, selfConjugate: false },
  z: { id: "z", symbol: "Z", antiSymbol: "Z", massMeV: 91187.6, charge: 0, flavor: null, stable: false, selfConjugate: true },
  higgs: { id: "higgs", symbol: "H", antiSymbol: "H", massMeV: 125250, charge: 0, flavor: null, stable: false, selfConjugate: true },
};

export const PARTICLE_IDS = Object.keys(PARTICLES) as ParticleId[];

/** An excitation of one field: which field, and which orientation of it. */
export type Excitation = { id: ParticleId; anti: boolean };

export function conjugate(x: Excitation): Excitation {
  const spec = PARTICLES[x.id];
  return spec.selfConjugate ? { id: x.id, anti: false } : { id: x.id, anti: !x.anti };
}

export function chargeOf(x: Excitation): number {
  return PARTICLES[x.id].charge * (x.anti ? -1 : 1);
}

export type FlavorLedger = { e: number; mu: number; tau: number };

export function flavorOf(x: Excitation): FlavorLedger {
  const out: FlavorLedger = { e: 0, mu: 0, tau: 0 };
  const f = PARTICLES[x.id].flavor;
  if (f) out[f] = x.anti ? -1 : 1;
  return out;
}

/** Sum the books over any set of excitations. */
export function ledgerOf(xs: Excitation[]): { charge: number } & FlavorLedger {
  const out = { charge: 0, e: 0, mu: 0, tau: 0 };
  for (const x of xs) {
    out.charge += chargeOf(x);
    const f = flavorOf(x);
    out.e += f.e;
    out.mu += f.mu;
    out.tau += f.tau;
  }
  return out;
}

export function symbolOf(x: Excitation): string {
  const spec = PARTICLES[x.id];
  return x.anti ? spec.antiSymbol : spec.symbol;
}

// ———————————————————————————————————————— the one great law: mass ↔ time

/**
 * How long an excitation lives, ms on the room's clock. Strictly monotone
 * DECREASING in mass across the unstable massive species — the law the
 * whole room is about, compressed into a span a hand can watch. Stable
 * species return Infinity. The gluon is the deliberate exception: massless
 * yet brief, because confinement (not mass) sets its span.
 */
export function lifetimeMs(id: ParticleId): number {
  const spec = PARTICLES[id];
  if (spec.stable) return Infinity;
  if (id === "gluon") return 700;
  // The heavier the field, the briefer its ripple: a smooth inverse-power
  // law fit so the muon lingers and the Higgs is gone within a breath.
  return 90000 / Math.pow(spec.massMeV, 0.52);
}

/** Speed of light in the room, px/s — the one speed nothing beats. */
export const C_PX_S = 340;

/**
 * Relativistic speed fraction β for a total energy E (MeV) carried by a
 * species of rest mass m: β = √(1 − (m/E)²), zero when E ≤ m. Massless
 * excitations move at exactly c no matter how little energy they carry.
 */
export function betaFor(massMeV: number, totalMeV: number): number {
  if (massMeV <= 0) return 1;
  if (totalMeV <= massMeV) return 0;
  const r = massMeV / totalMeV;
  return Math.sqrt(Math.max(0, 1 - r * r));
}

/** How far the gluon's color leash lets it wander, px. */
export const CONFINEMENT_REACH_PX = 90;

/**
 * How far an excitation carries before it is gone, px. Infinite for the
 * stable; the confinement leash for the gluon; β·c·τ for everything else —
 * which makes reach inverse to mass twice over (heavier is both slower at
 * fixed energy and briefer).
 */
export function reachPx(id: ParticleId, totalMeV: number): number {
  const spec = PARTICLES[id];
  if (spec.stable) return Infinity;
  if (id === "gluon") return CONFINEMENT_REACH_PX;
  return (betaFor(spec.massMeV, totalMeV) * C_PX_S * lifetimeMs(id)) / 1000;
}

// ——————————————————————————————————————————————————— deterministic seeds

function mix32(v: number): number {
  let h = v >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Fold any integer parts into one 32-bit seed (order-sensitive). */
export function hashSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h = mix32(h ^ Math.imul(Math.floor(p) | 0, 0x9e3779b1));
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ————————————————————————————————————————————————————— the decay ladder

const FLAVOR_LEPTON: Record<LeptonFlavor, ParticleId> = {
  e: "electron",
  mu: "muon",
  tau: "tau",
};
const FLAVOR_NU: Record<LeptonFlavor, ParticleId> = {
  e: "nu-e",
  mu: "nu-mu",
  tau: "nu-tau",
};

/**
 * What one excitation becomes when its time is up. Deterministic in
 * (species, seed); the anti state decays to the conjugate products, so
 * conservation holds by construction and the tests can prove it holds by
 * arithmetic. Stable species — and the gluon, which is reabsorbed by the
 * vacuum rather than decayed — return [].
 *
 *  μ⁻ → e⁻ ν̄e νμ   (the textbook muon decay, flavor books exact)
 *  τ⁻ → μ⁻ ν̄μ ντ   (the tau steps DOWN the ladder, one copy at a time)
 *  W⁻ → ℓ⁻ ν̄ℓ      (the seed picks the flavor; every choice conserves)
 *  Z  → ℓ⁻ ℓ⁺       (a matched pair, flavor by seed)
 *  H  → τ⁻ τ⁺       (the heaviest pair it can afford — always)
 */
export function decayProducts(x: Excitation, seed: number): Excitation[] {
  const matter = (id: ParticleId): Excitation => ({ id, anti: false });
  const anti = (id: ParticleId): Excitation => ({
    id,
    anti: !PARTICLES[id].selfConjugate,
  });
  let out: Excitation[];
  switch (x.id) {
    case "muon":
      out = [matter("electron"), anti("nu-e"), matter("nu-mu")];
      break;
    case "tau":
      out = [matter("muon"), anti("nu-mu"), matter("nu-tau")];
      break;
    case "w": {
      const f = (["e", "mu", "tau"] as const)[Math.floor(mulberry32(mix32(seed) || 1)() * 3) % 3];
      out = [matter(FLAVOR_LEPTON[f]), anti(FLAVOR_NU[f])];
      break;
    }
    case "z": {
      const f = (["e", "mu", "tau"] as const)[Math.floor(mulberry32(mix32(seed + 1) || 1)() * 3) % 3];
      out = [matter(FLAVOR_LEPTON[f]), anti(FLAVOR_LEPTON[f])];
      break;
    }
    case "higgs":
      out = [matter("tau"), anti("tau")];
      break;
    default:
      return [];
  }
  return x.anti ? out.map(conjugate) : out;
}

/**
 * Run an excitation all the way down to stable residue. Every intermediate
 * step conserves the books (the tests walk each one); the result is what
 * the field keeps: electrons, neutrinos, and their conjugates.
 */
export function decayChain(x: Excitation, seed: number): Excitation[] {
  const out: Excitation[] = [];
  const queue: Excitation[] = [x];
  let step = 0;
  while (queue.length > 0 && step < 64) {
    const cur = queue.shift() as Excitation;
    const products = decayProducts(cur, hashSeed(seed, step));
    if (products.length === 0) {
      out.push(cur);
    } else {
      queue.push(...products);
    }
    step++;
  }
  return out;
}

// ——————————————————————————————————————————— the mass ladder (birth law)

/** The least the vacuum will bother ringing for, MeV. */
export const PHOTON_E_MIN = 0.05;
/** The most a single photon carries here before the pair rung opens. */
export const PHOTON_E_MAX = 2 * PARTICLES.electron.massMeV;

export type LadderRung = {
  name: string;
  /** Least energy that affords this birth, MeV. */
  thresholdMeV: number;
  /** What the vacuum yields — always neutral in charge and flavor. */
  birth: (seed: number) => Excitation[];
};

const pairOf = (id: ParticleId) => (): Excitation[] => [
  { id, anti: false },
  { id, anti: true },
];

/**
 * The rungs, strictly ascending in cost. Note the top: a W pair costs MORE
 * than a Higgs — 2·80377 > 125250 — so the ladder's last rung is beyond
 * the ceremony's reach, exactly as it was beyond every bench-top's.
 */
export const LADDER: LadderRung[] = [
  { name: "photon", thresholdMeV: PHOTON_E_MIN, birth: () => [{ id: "photon", anti: false }] },
  { name: "electron pair", thresholdMeV: 2 * PARTICLES.electron.massMeV, birth: pairOf("electron") },
  { name: "muon pair", thresholdMeV: 2 * PARTICLES.muon.massMeV, birth: pairOf("muon") },
  { name: "tau pair", thresholdMeV: 2 * PARTICLES.tau.massMeV, birth: pairOf("tau") },
  { name: "z", thresholdMeV: PARTICLES.z.massMeV, birth: () => [{ id: "z", anti: false }] },
  { name: "higgs", thresholdMeV: PARTICLES.higgs.massMeV, birth: () => [{ id: "higgs", anti: false }] },
  { name: "w pair", thresholdMeV: 2 * PARTICLES.w.massMeV, birth: pairOf("w") },
];

/** Index of the highest rung this much energy affords; −1 below the first. */
export function rungFor(energyMeV: number): number {
  let best = -1;
  for (let i = 0; i < LADDER.length; i++) {
    if (energyMeV >= LADDER[i].thresholdMeV) best = i;
  }
  return best;
}

/** What this much energy makes when it lands — the highest affordable rung. */
export function birthFor(energyMeV: number, seed: number): Excitation[] {
  const i = rungFor(energyMeV);
  return i < 0 ? [] : LADDER[i].birth(seed);
}

/**
 * Hold duration → deposited energy, MeV. Exponential so the hold axis IS
 * the mass ladder: the touch tier buys only a photon, the dwell tier a
 * lepton pair, and the ceremony (2500 ms) crests the Higgs threshold. The
 * cap sits above the Higgs and BELOW the W pair: the hand alone can hold
 * forever and never make a W. Monotone, continuous, deterministic.
 */
export const HOLD_TAU_MS = 168;
export const HOLD_E_CAP = 130000;

export function holdEnergy(ms: number): number {
  if (ms <= 0) return 0;
  return Math.min(HOLD_E_CAP, PHOTON_E_MIN * Math.exp(ms / HOLD_TAU_MS));
}

/**
 * The collision wind's energy, MeV, from accumulated three-finger sweep
 * (unitless work, roughly seconds of hard wind). The only road past the
 * hand's cap: enough sustained wind crests the W pair rung. Monotone.
 */
export function windEnergy(work: number): number {
  if (work <= 0) return 0;
  return 220 * Math.exp(Math.min(9, work * 1.55));
}

// ————————————————————————————————————————————————— E = hf, made audible

export const PITCH_MIN_HZ = 110;
export const PITCH_MAX_HZ = 3520;

/**
 * A photon's pitch: E = hf carried down into the audible register. The
 * true frequency is E/h ≈ 2.4·10²⁰ Hz per MeV; this map is the same law
 * under a log-preserving change of octave — strictly monotone in E, five
 * octaves across the photon's energy range, so a hotter photon is
 * literally a higher note and a Doppler shift is a bent one.
 */
export function photonPitchHz(energyMeV: number): number {
  const e = Math.max(PHOTON_E_MIN, Math.min(PHOTON_E_MAX * 2, energyMeV));
  const u = Math.log(e / PHOTON_E_MIN) / Math.log((PHOTON_E_MAX * 2) / PHOTON_E_MIN);
  return PITCH_MIN_HZ * Math.pow(PITCH_MAX_HZ / PITCH_MIN_HZ, u);
}

/**
 * Relativistic Doppler: the pitch an observer hears when the source moves
 * at β along the line of sight (positive = toward). Monotone in β, exact
 * form √((1+β)/(1−β)) — a flick toward you brightens the note.
 */
export function dopplerHz(hz: number, betaAlong: number): number {
  const b = Math.max(-0.9, Math.min(0.9, betaAlong));
  return hz * Math.sqrt((1 + b) / (1 - b));
}

// ————————————————————————————————————————————————————— the field's cloth

/**
 * The tints each family wears — site tokens only.
 * photon = candle gold (light is the candle's own material),
 * charged leptons = sea (the electron the betas throw, seen at home),
 * neutrinos = fog (barely there),
 * gluon = the three color charges from the quarks room above,
 * heavy bosons = merlot strain (mass as burden),
 * higgs = parchment white (the field that gives the weight).
 */
export const QUANTA_TINTS = {
  photon: ["#9C5820", "#C8732A", "#E7AC52", "#F2C56B"],
  lepton: ["#2C4A5C", "#4E7D8C", "#6997A4", "#9DC0C9"],
  neutrino: ["#3A424A", "#565F66", "#7C8B93", "#9AA6AC"],
  gluon: ["#E7AC52", "#4E7D8C", "#B25048"],
  boson: ["#4F1414", "#7A1F1F", "#9C3D33", "#B25048"],
  higgs: ["#B8A87F", "#CFC2A6", "#DDD3BE", "#F2EEE6"],
} as const;

export function tintFamily(id: ParticleId): keyof typeof QUANTA_TINTS {
  if (id === "photon") return "photon";
  if (id === "gluon") return "gluon";
  if (id === "higgs") return "higgs";
  if (id === "w" || id === "z") return "boson";
  if (id === "nu-e" || id === "nu-mu" || id === "nu-tau") return "neutrino";
  return "lepton";
}

/** Hard cap on excitations in flight; the oldest stable residue retires. */
export const MAX_EXCITATIONS = 26;

/**
 * Enforce the cap: oldest first (the room keeps arrival order), never the
 * new — the same settling law every field on the site obeys.
 */
export function settlePopulation<T>(
  items: T[],
  cap: number = MAX_EXCITATIONS,
): { kept: T[]; retired: T[] } {
  const over = Math.max(0, items.length - Math.max(1, cap));
  return { kept: items.slice(over), retired: items.slice(0, over) };
}

/**
 * The starters: what an empty field opens with — one photon already
 * crossing, one electron at rest, one neutrino streaming through.
 * Deterministic in the seed.
 */
export function starterKinds(seed: number): Excitation[] {
  const rng = mulberry32(mix32(seed) || 1);
  const nus: ParticleId[] = ["nu-e", "nu-mu", "nu-tau"];
  return [
    { id: "photon", anti: false },
    { id: "electron", anti: rng() < 0.5 },
    { id: nus[Math.floor(rng() * 3) % 3], anti: rng() < 0.5 },
  ];
}
