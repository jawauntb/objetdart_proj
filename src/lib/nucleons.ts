/**
 * Nucleons — the nuclear latent for /nucleons (the band at 10⁻¹⁵ m, between
 * the quarks below and the atoms above).
 *
 * One level up from confinement, matter has parts again: protons and
 * neutrons, packed like a charged liquid drop. The whole room runs on the
 * semi-empirical mass formula (Bethe–Weizsäcker) — volume, surface, Coulomb,
 * asymmetry, pairing — which is not a decoration here but the actual arbiter
 * of every verb:
 *
 *  - **binding** decides what a nucleus is worth and how tightly it holds;
 *    the curve peaks near iron, the same wall /atoms hits from above.
 *  - **the valley of stability** (`mostStableZ`) is the floor of that
 *    landscape; sitting off it is what makes a nucleus decay, and it is the
 *    reason heavy nuclei are neutron-rich. At A = 238 the valley bottoms out
 *    at Z = 92 — uranium is not placed here by hand, it falls out of the
 *    energy.
 *  - **the Coulomb barrier** is why a neutron walks in and a proton has to be
 *    thrown. It is the difference between the two hands in the room.
 *  - **decay** is a comparison of neighbors on that landscape: β⁻ when a
 *    neutron would rather be a proton, β⁺ the other way, α when shedding a
 *    helium nucleus pays, spontaneous fission when the drop can no longer
 *    hold itself against its own charge.
 *
 * That chain — capture a neutron, wait for the beta, capture again — is how
 * the universe actually makes uranium, and it is the only way to make it
 * here. Fusion (the /atoms verb) stops at iron; this room starts there.
 *
 * Pure and import-free by law: same seed = same nuclide, forever. No DOM, no
 * audio, no side effects — node-testable standalone (scripts/test-nucleons.mjs).
 * The room that renders these (NucleonsField) owns canvas, sound, and haptics.
 */

/** Hard population cap for the field; captures beyond it retire the oldest. */
export const MAX_NUCLEI = 6;

/** The heaviest drop the field will hold together at all. */
export const MAX_A = 260;

/**
 * The heaviest drop a bare hand can gather out of the vacuum: iron — the
 * same wall /atoms hits from above, for the same reason. Everything past it
 * has to be built by neutron capture in a flux, which is the r-process and
 * the only road to the actinides that has ever existed.
 */
export const HAND_MAX_A = 56;

// ————————————————————————————————————————— the semi-empirical mass formula

/**
 * Coefficients, MeV. Volume and surface are the textbook values; the Coulomb,
 * asymmetry, and pairing terms are fit (scripts/test-nucleons.mjs pins the
 * result) so that the valley floor this file computes lands on the isobar
 * that is actually beta-stable — Ca-40, Fe-56, Zr-90, Sn-120, Ce-140,
 * Pb-208, U-238 — instead of merely near it. The one target it misses is
 * A = 40, where calcium's doubly-magic shell closure holds a nuclide the
 * liquid drop has no way to know about; the SEMF has no shells, and the
 * room is honest about being a drop and not an orbital model.
 */
const A_VOL = 15.75;
/** Surface term — the nucleons on the skin bind to fewer neighbors. */
const A_SURF = 17.8;
/** Coulomb term — every proton pushes every other proton. */
const A_COUL = 0.675;
/** Asymmetry term — protons and neutrons want to be matched. */
const A_ASYM = 21.7;
/** Pairing term — like nucleons pair off; odd ones are left over. */
const A_PAIR = 12.0;

/** Neutron − proton − electron mass difference, MeV: the β⁻ allowance. */
export const BETA_MINUS_Q0 = 0.782;
/** The β⁺ toll: 2mₑc² + (mₚ − mₙ), MeV. */
export const BETA_PLUS_Q0 = 1.804;
/** Binding energy of the alpha particle, MeV — what an α takes with it. */
export const ALPHA_BINDING = 28.296;

export type Nuclide = {
  /** Protons — the charge, and the element. */
  z: number;
  /** Neutrons — the ballast that lets the charge hold together. */
  n: number;
};

export const massNumber = (z: number, n: number): number => Math.floor(z) + Math.floor(n);

/** Pairing sign: +1 even-even, −1 odd-odd, 0 for odd A. */
function pairingSign(z: number, n: number): number {
  const evenZ = z % 2 === 0;
  const evenN = n % 2 === 0;
  if (evenZ && evenN) return 1;
  if (!evenZ && !evenN) return -1;
  return 0;
}

/**
 * Total binding energy of a nuclide, MeV. Zero for anything that isn't at
 * least one nucleon; a lone proton or neutron binds to nothing (B = 0), which
 * is what makes the first capture pay so richly.
 */
export function bindingEnergy(z: number, n: number): number {
  const zi = Math.floor(z);
  const ni = Math.floor(n);
  if (zi < 0 || ni < 0) return 0;
  const a = zi + ni;
  if (a <= 1) return 0;
  const delta = (pairingSign(zi, ni) * A_PAIR) / Math.sqrt(a);
  const b =
    A_VOL * a -
    A_SURF * Math.pow(a, 2 / 3) -
    (A_COUL * zi * (zi - 1)) / Math.pow(a, 1 / 3) -
    (A_ASYM * (a - 2 * zi) * (a - 2 * zi)) / a +
    delta;
  return Math.max(0, b);
}

/** Binding energy per nucleon, MeV — the curve whose peak is iron. */
export function bindingPerNucleon(z: number, n: number): number {
  const a = massNumber(z, n);
  return a > 0 ? bindingEnergy(z, n) / a : 0;
}

/**
 * The floor of the valley of stability at a given mass number: the proton
 * count of LOWEST MASS for that A — which is not the same as the count of
 * highest binding, because a neutron is heavier than a proton plus an
 * electron by BETA_MINUS_Q0. Trading a neutron for a proton is therefore
 * worth 0.782 MeV before binding is even consulted, and a nuclide that
 * merely maximizes binding will still β⁻ its way one step further. Adding
 * the tilt here is what makes the valley floor genuinely quiet under
 * `decayMode` instead of quietly drifting off it.
 *
 * Brute-forced against this file's own SEMF rather than the closed-form
 * approximation, so the valley and the decay rules can never disagree.
 */
export function mostStableZ(a: number): number {
  const ai = Math.floor(a);
  if (ai <= 1) return Math.max(0, ai);
  let bestZ = 1;
  let bestM = -Infinity;
  for (let z = 1; z < ai; z++) {
    const m = bindingEnergy(z, ai - z) + BETA_MINUS_Q0 * z;
    if (m > bestM) {
      bestM = m;
      bestZ = z;
    }
  }
  return bestZ;
}

// ———————————————————————————————————————————————————————————— the verbs

export type DecayMode = "stable" | "beta-minus" | "beta-plus" | "alpha" | "fission";

/** Energy released by β⁻ (a neutron becoming a proton), MeV. */
export function betaMinusQ(z: number, n: number): number {
  if (n < 1) return -Infinity;
  return bindingEnergy(z + 1, n - 1) - bindingEnergy(z, n) + BETA_MINUS_Q0;
}

/** Energy released by β⁺ (a proton becoming a neutron), MeV. */
export function betaPlusQ(z: number, n: number): number {
  if (z < 1) return -Infinity;
  return bindingEnergy(z - 1, n + 1) - bindingEnergy(z, n) - BETA_PLUS_Q0;
}

/** Energy released by shedding an alpha particle, MeV. */
export function alphaQ(z: number, n: number): number {
  if (z < 3 || n < 3) return -Infinity;
  return bindingEnergy(z - 2, n - 2) + ALPHA_BINDING - bindingEnergy(z, n);
}

/**
 * The fissility parameter x = (Z²/A) / 50.88 — the ratio of the Coulomb
 * push to the surface tension that opposes it. Above 1 the drop cannot
 * hold itself at all; the room lets spontaneous fission start biting well
 * before that, the way real actinides do.
 */
export function fissility(z: number, n: number): number {
  const a = massNumber(z, n);
  if (a <= 0) return 0;
  return (z * z) / a / 50.88;
}

/**
 * What this nuclide does when left alone. The order is the physical one:
 * a drop too strained to hold itself splits before it bothers with a beta,
 * an alpha emitter sheds before it climbs the beta ladder, and only a
 * nuclide that gains from nothing is stable.
 */
export function decayMode(z: number, n: number): DecayMode {
  const zi = Math.floor(z);
  const ni = Math.floor(n);
  if (zi < 1 && ni < 1) return "stable";
  if (fissility(zi, ni) > 0.86) return "fission";
  const bm = betaMinusQ(zi, ni);
  const bp = betaPlusQ(zi, ni);
  const al = alphaQ(zi, ni);
  // Alpha wins where it pays and the drop is heavy — the actinide habit.
  if (al > 0 && massNumber(zi, ni) >= 150 && al >= Math.max(bm, bp)) return "alpha";
  if (bm > 0 && bm >= bp) return "beta-minus";
  if (bp > 0) return "beta-plus";
  if (al > 0 && massNumber(zi, ni) >= 150) return "alpha";
  return "stable";
}

/**
 * How hard a projectile has to arrive to touch this nucleus, MeV. A neutron
 * feels nothing (0) and walks in; a proton must climb Z·z·e²/r over the
 * nuclear radius, which grows with every proton the target already holds.
 * This single number is the whole difference between the room's two hands.
 */
export function coulombBarrier(z: number, n: number, projectileZ: number): number {
  if (projectileZ <= 0) return 0;
  const a = Math.max(1, massNumber(z, n));
  const r = 1.25 * (Math.pow(a, 1 / 3) + Math.pow(Math.max(1, projectileZ), 1 / 3)) + 1.2;
  return (1.44 * Math.max(0, z) * projectileZ) / r;
}

/** Nuclear radius in femtometres — R = r₀A^⅓, the drop's real size. */
export function nuclearRadiusFm(z: number, n: number): number {
  return 1.25 * Math.pow(Math.max(1, massNumber(z, n)), 1 / 3);
}

/** Energy released by absorbing one more nucleon, MeV (the separation energy). */
export function captureQ(z: number, n: number, projectileZ: 0 | 1): number {
  const nz = z + projectileZ;
  const nn = n + (projectileZ === 0 ? 1 : 0);
  if (massNumber(nz, nn) > MAX_A) return -Infinity;
  return bindingEnergy(nz, nn) - bindingEnergy(z, n);
}

// —————————————————————————————————————————————————————————————— fission

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

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type FissionSplit = {
  a: Nuclide;
  b: Nuclide;
  /** Prompt neutrons thrown free — the ones that go find the next nucleus. */
  neutrons: number;
  /** Energy released, MeV. Negative means the split costs more than it pays. */
  q: number;
};

/**
 * Split a drop. Real fission is stubbornly ASYMMETRIC — a heavy fragment
 * near A ≈ 140 and a light one near A ≈ 95, never two equal halves — and the
 * split throws two or three prompt neutrons. Both fragments inherit the
 * parent's neutron richness, so they land deep on the neutron-rich side of
 * the valley and immediately want to beta-decay: the fission products that
 * keep glowing after the flash.
 *
 * Conserves nucleons exactly: Za + Zb = Z, Na + Nb + neutrons = N. Pure —
 * the same nucleus and seed always split the same way.
 */
export function fissionSplit(z: number, n: number, seed: number): FissionSplit {
  const zi = Math.max(0, Math.floor(z));
  const ni = Math.max(0, Math.floor(n));
  const a = zi + ni;
  const rng = mulberry32(mix32(hashSeed(zi, ni, seed) || 1));
  // Asymmetry: the light fragment takes ~40% of the mass, jittered.
  const frac = 0.38 + rng() * 0.07;
  const free = Math.min(ni, a >= 200 ? 2 + (rng() < 0.5 ? 0 : 1) : 1);
  const rest = a - free;
  let aLight = Math.max(2, Math.round(rest * frac));
  let aHeavy = rest - aLight;
  if (aHeavy < 2) {
    aHeavy = 2;
    aLight = Math.max(2, rest - 2);
  }
  // Charge divides in proportion to mass (unchanged charge density), which
  // is exactly why both fragments come out neutron-rich.
  let zLight = Math.max(1, Math.min(zi - 1, Math.round((zi * aLight) / Math.max(1, rest))));
  let zHeavy = zi - zLight;
  if (zHeavy < 1) {
    zHeavy = 1;
    zLight = zi - 1;
  }
  const lo: Nuclide = { z: zLight, n: Math.max(0, aLight - zLight) };
  const hi: Nuclide = { z: zHeavy, n: Math.max(0, aHeavy - zHeavy) };
  const neutrons = ni - lo.n - hi.n;
  const q = bindingEnergy(lo.z, lo.n) + bindingEnergy(hi.z, hi.n) - bindingEnergy(zi, ni);
  return { a: lo, b: hi, neutrons: Math.max(0, neutrons), q };
}

/** Whether a drop this size can be broken apart at a profit at all. */
export function canFission(z: number, n: number): boolean {
  if (massNumber(z, n) < 90) return false;
  return fissionSplit(z, n, 1).q > 0;
}

/**
 * The liquid drop's fission barrier, MeV — the saddle a compound nucleus has
 * to climb before the Coulomb push wins and the neck lets go. It is the
 * surface energy scaled by how close the fissility already sits to 1: at
 * x = 1 the barrier vanishes (the drop cannot hold itself at all) and it
 * grows steeply as x falls, which is why nothing below the actinides splits
 * however hard it is hit. Zero for anything already past x = 1.
 */
export function fissionBarrier(z: number, n: number): number {
  const a = massNumber(z, n);
  if (a <= 0) return 0;
  const x = fissility(z, n);
  if (x >= 1) return 0;
  return 0.33 * A_SURF * Math.pow(a, 2 / 3) * Math.pow(1 - x, 3);
}

/**
 * Whether absorbing ONE MORE NEUTRON makes this nuclide split on the spot —
 * the whole difference between a fissile nuclide and a merely fertile one,
 * and it is not put here by hand: the neutron's separation energy in the
 * compound nucleus (captureQ, which carries the SEMF's pairing term) is
 * compared against that compound nucleus's own barrier.
 *
 * The pairing term is the entire story. U-235 is even-Z/odd-N, so the
 * captured neutron PAIRS UP and pays 7.4 MeV into a drop whose barrier is
 * 5.8 — it splits at once, and that is why a reactor runs on it. U-238 is
 * even-even, so the same neutron arrives unpaired, pays only 5.6 into a
 * 6.4 MeV barrier, and merely warms the drop. Nothing about this file knows
 * the word "uranium"; the distinction falls out of the energy, which is the
 * only way the room is allowed to know it.
 */
export function promptFissionOnCapture(z: number, n: number): boolean {
  const zi = Math.floor(z);
  const ni = Math.floor(n);
  if (!canFission(zi, ni + 1)) return false;
  return captureQ(zi, ni, 0) > fissionBarrier(zi, ni + 1);
}

/**
 * A neutron walks in and the drop comes apart: the compound nucleus (Z, N+1)
 * split, or null when it only warms instead. The neutrons this returns are
 * the ones that go looking for the next drop — the chain, in one call.
 */
export function inducedFission(z: number, n: number, seed: number): FissionSplit | null {
  const zi = Math.floor(z);
  const ni = Math.floor(n);
  if (!promptFissionOnCapture(zi, ni)) return null;
  return fissionSplit(zi, ni + 1, seed);
}

/**
 * How violent the split looks and sounds, 0..1. Zero when the split pays
 * nothing (a light nucleus simply refuses to come apart), saturating for
 * the ~200 MeV an actinide releases. Monotone in q.
 */
export function fissionMagnitude(q: number): number {
  if (!(q > 0)) return 0;
  return 1 - Math.exp(-q / 90);
}

// —————————————————————————————————————————————————————————— the elements

/**
 * Symbols by Z, 1..118 — the only lettering in the room, and only under the
 * chart lens. Index 0 is the free neutron, which has a symbol too.
 */
export const SYMBOLS: readonly string[] = [
  "n", "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne",
  "Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar", "K", "Ca",
  "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn",
  "Ga", "Ge", "As", "Se", "Br", "Kr", "Rb", "Sr", "Y", "Zr",
  "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn",
  "Sb", "Te", "I", "Xe", "Cs", "Ba", "La", "Ce", "Pr", "Nd",
  "Pm", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb",
  "Lu", "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt", "Au", "Hg",
  "Tl", "Pb", "Bi", "Po", "At", "Rn", "Fr", "Ra", "Ac", "Th",
  "Pa", "U", "Np", "Pu", "Am", "Cm", "Bk", "Cf", "Es", "Fm",
  "Md", "No", "Lr", "Rf", "Db", "Sg", "Bh", "Hs", "Mt", "Ds",
  "Rg", "Cn", "Nh", "Fl", "Mc", "Lv", "Ts", "Og",
] as const;

export function symbolFor(z: number): string {
  const zi = Math.floor(z);
  return zi >= 0 && zi < SYMBOLS.length ? SYMBOLS[zi] : `Z${zi}`;
}

/**
 * The tints a nucleon may wear — the site tokens, nothing else.
 * proton = candle gold (charge, the thing that pushes),
 * neutron = parchment (mass without opinion),
 * electron = sea (what the beta throws away),
 * strain = merlot (a drop past its holding).
 */
export const NUCLEON_TINTS = {
  proton: ["#9C5820", "#C8732A", "#E7AC52", "#F2C56B"],
  neutron: ["#B8A87F", "#CFC2A6", "#DDD3BE", "#F2EEE6"],
  electron: ["#2C4A5C", "#4E7D8C", "#6997A4", "#9DC0C9"],
  strain: ["#4F1414", "#7A1F1F", "#9C3D33", "#B25048"],
} as const;

// ————————————————————————————————————————————————————————— seeded drops

/** The starters the field opens with — light, stable, and near the valley. */
export function nuclideFromSeed(seed: number): Nuclide {
  const rng = mulberry32(mix32((seed >>> 0) || 1));
  // Light nuclei dominate, the way the universe stocks its shelves; the
  // occasional heavier drop gives the hand something to work on.
  const a = 2 + Math.floor(Math.pow(rng(), 2.1) * 54);
  const z = mostStableZ(a);
  return { z, n: a - z };
}

/**
 * How many nucleons a hand has gathered by holding, counted from the moment
 * the binding tier is crossed: one at the tier, then an accelerating
 * accretion — the vacuum pays faster the longer it is asked — saturating at
 * iron and never going past it. Monotone non-decreasing in heldMs, zero
 * before the tier, so a hold is a continuous axis and not a switch: how long
 * the hand presses IS which nuclide it makes.
 */
export function accretedA(heldMs: number, tierMs = 2500): number {
  if (!(heldMs >= tierMs)) return 0;
  const s = (heldMs - tierMs) / 1000;
  return Math.min(HAND_MAX_A, 1 + Math.floor(s * s * 3.5));
}

/**
 * The nuclide a gathered mass settles into: the floor of the valley at that
 * mass number, so anything a hand builds is born stable-ish and has to be
 * driven off the valley (by flux, by strike) to become interesting. A = 1 is
 * the vacuum's cheapest gift — a lone neutron, which is itself unstable.
 */
export function valleyNuclide(a: number): Nuclide {
  const ai = Math.max(1, Math.floor(a));
  if (ai <= 1) return { z: 0, n: 1 };
  const z = mostStableZ(ai);
  return { z, n: ai - z };
}

/**
 * Enforce the population cap: the oldest residents (front of the list, which
 * the room keeps in arrival order) retire first, gracefully, never the new.
 */
export function settlePopulation<T>(
  items: T[],
  cap: number = MAX_NUCLEI,
): { kept: T[]; retired: T[] } {
  const over = Math.max(0, items.length - Math.max(1, cap));
  return { kept: items.slice(over), retired: items.slice(0, over) };
}

/**
 * Where a nucleon sits inside the drop: a deterministic close-packing shell
 * arrangement, so a nucleus of a given A always looks like itself. Returns
 * unit-radius offsets (multiply by the drop radius).
 */
export function packOffsets(a: number, seed: number): Array<{ x: number; y: number }> {
  const count = Math.max(1, Math.floor(a));
  const rng = mulberry32(mix32(hashSeed(count, seed) || 1));
  const out: Array<{ x: number; y: number }> = [];
  // A sunflower spiral fills a disc evenly with no clumping and no lattice
  // seams — the closest a drawn drop gets to a real packing.
  const golden = Math.PI * (3 - Math.sqrt(5));
  const jitter = 0.055;
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt((i + 0.5) / count);
    const th = i * golden + rng() * 0.35;
    out.push({
      x: Math.cos(th) * r + (rng() - 0.5) * jitter,
      y: Math.sin(th) * r + (rng() - 0.5) * jitter,
    });
  }
  return out;
}
