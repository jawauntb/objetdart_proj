/**
 * Atomics — the atomic latent for /atoms (plan W6), now told truthfully.
 *
 * An atom IS its seed, and the seed now lands on a REAL element: the table
 * runs hydrogen through iron (Z = 1..26) with real ground-state shell
 * occupancies (K/L/M/N, aufbau-faithful, chromium's d5s1 exception included),
 * real-ish covalent radii, Pauling electronegativities, covalent valences,
 * and a cosmically-flavored abundance weighting — hydrogen and helium
 * dominate, then oxygen, carbon, neon, iron, the way the universe actually
 * stocks its shelves. Excitation is a pure map: intensity decides how many
 * levels an electron jumps, always above the ground shells, never past the
 * sixth ring. Covalence is PINNED ORDER-INDEPENDENT: bondSeed(a, b) ===
 * bondSeed(b, a) — a shared bond is a fact about the pair of atoms, not
 * about which one the ceremony began on — and the real layer (covalentPair)
 * gives it teeth: bond order = the lesser appetite (H–H single, O=O double,
 * N≡N triple), rest length scaled by the two covalent radii, noble gases
 * bonding with nothing at all.
 *
 * Fusion is here too, with the true shape of the stellar ledger: a
 * simplified binding-energy-per-nucleon curve that rises steeply through
 * helium and peaks at iron. Light fusion releases energy (the blast), the
 * gains shrink monotonically as Z climbs, and any product past iron costs
 * more than it pays — the real reason stars die. blastMagnitude() folds the
 * released energy into a 0..1 scalar for the radiating wave.
 *
 * Pure and import-free by law: same seed = same atom, forever. No DOM, no
 * audio, no side effects — node-testable standalone (scripts/test-atomics.mjs).
 * The room that renders these (AtomsField) owns canvas, sound, and haptics.
 */

/** Hard population cap for the field; condensations beyond it retire the oldest. */
export const MAX_ATOMS = 8;

/** Electrons each shell may hold — the real K/L/M/N capacities. */
export const SHELL_CAPACITY = [2, 8, 18, 32] as const;

/** The heaviest element the table carries: iron, where fusion stops paying. */
export const MAX_Z = 26;

/** Excited electrons never climb past this ring, ground shells included. */
export const MAX_RING = 6;

/**
 * The only colors an atom may wear — ramps around the site tokens
 * (--candle #C8732A, --closed #7A1F1F, --sea #2C4A5C, --paper #F2EEE6),
 * each family ordered dark → light. Index = the element's chemical family:
 * 0 gold = reactive nonmetals (H C N O F P S Cl — the fire-makers),
 * 1 merlot = metals (Li through Fe — the heavy blood),
 * 2 sea = noble gases (He Ne Ar — sealed, self-sufficient),
 * 3 parchment = metalloids (B Si — the in-betweens).
 */
export const ATOM_FAMILIES = [
  ["#9C5820", "#B36524", "#C8732A", "#DA8F3B", "#E7AC52", "#F2C56B"], // gold
  ["#4F1414", "#5E1717", "#7A1F1F", "#8E2B2B", "#9C3D33", "#B25048"], // merlot
  ["#1E3440", "#243D4A", "#2C4A5C", "#3A6172", "#4E7D8C", "#6997A4"], // sea
  ["#B8A87F", "#CFC2A6", "#DDD3BE", "#E8E2D5", "#F2EEE6", "#F7F3EA"], // parchment
] as const;

function mix32(n: number): number {
  let h = n >>> 0;
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

// ————————————————————————————————————————————————————————————— the elements

/** Tint family index into ATOM_FAMILIES. */
export type FamilyTint = 0 | 1 | 2 | 3;

export type ElementDef = {
  /** Atomic number — protons, the identity. */
  z: number;
  symbol: string;
  name: string;
  /** Standard atomic weight, nearest integer (≈ nucleon count A). */
  weight: number;
  /** Real ground-state shell occupancy, K/L/M/N (sums to z). */
  shells: readonly number[];
  /** Covalent valence — how many bonds the element wants (nobles want 0). */
  valence: number;
  /** Pauling electronegativity (0 for the nobles, which pull on nothing). */
  electronegativity: number;
  /** Covalent radius, picometers. */
  radius: number;
  /** Chemical-family tint (index into ATOM_FAMILIES). */
  family: FamilyTint;
  /** Cosmic abundance weight (curated, log-softened; H the mode). */
  abundance: number;
};

const el = (
  z: number,
  symbol: string,
  name: string,
  weight: number,
  shells: readonly number[],
  valence: number,
  electronegativity: number,
  radius: number,
  family: FamilyTint,
  abundance: number,
): ElementDef => ({ z, symbol, name, weight, shells, valence, electronegativity, radius, family, abundance });

/**
 * Hydrogen through iron, real. Shell occupancies are the true ground states
 * (aufbau through 4s/3d, including chromium's [Ar]3d⁵4s¹ exception).
 * Abundances are cosmic-flavored and log-softened so the field shows the
 * universe's actual pantry without becoming pure hydrogen.
 */
export const ELEMENTS: readonly ElementDef[] = [
  el(1, "H", "hydrogen", 1, [1], 1, 2.2, 31, 0, 860),
  el(2, "He", "helium", 4, [2], 0, 0, 28, 2, 490),
  el(3, "Li", "lithium", 7, [2, 1], 1, 0.98, 128, 1, 0.5),
  el(4, "Be", "beryllium", 9, [2, 2], 2, 1.57, 96, 1, 0.2),
  el(5, "B", "boron", 11, [2, 3], 3, 2.04, 84, 3, 0.3),
  el(6, "C", "carbon", 12, [2, 4], 4, 2.55, 76, 0, 68),
  el(7, "N", "nitrogen", 14, [2, 5], 3, 3.04, 71, 0, 31),
  el(8, "O", "oxygen", 16, [2, 6], 2, 3.44, 66, 0, 102),
  el(9, "F", "fluorine", 19, [2, 7], 1, 3.98, 57, 0, 1),
  el(10, "Ne", "neon", 20, [2, 8], 0, 0, 58, 2, 37),
  el(11, "Na", "sodium", 23, [2, 8, 1], 1, 0.93, 166, 1, 6),
  el(12, "Mg", "magnesium", 24, [2, 8, 2], 2, 1.31, 141, 1, 24),
  el(13, "Al", "aluminium", 27, [2, 8, 3], 3, 1.61, 121, 1, 7),
  el(14, "Si", "silicon", 28, [2, 8, 4], 4, 1.9, 111, 3, 26),
  el(15, "P", "phosphorus", 31, [2, 8, 5], 3, 2.19, 107, 0, 3),
  el(16, "S", "sulfur", 32, [2, 8, 6], 2, 2.58, 105, 0, 21),
  el(17, "Cl", "chlorine", 35, [2, 8, 7], 1, 3.16, 102, 0, 2.5),
  el(18, "Ar", "argon", 40, [2, 8, 8], 0, 0, 106, 2, 14),
  el(19, "K", "potassium", 39, [2, 8, 8, 1], 1, 0.82, 203, 1, 2),
  el(20, "Ca", "calcium", 40, [2, 8, 8, 2], 2, 1.0, 176, 1, 8),
  el(21, "Sc", "scandium", 45, [2, 8, 9, 2], 3, 1.36, 170, 1, 0.6),
  el(22, "Ti", "titanium", 48, [2, 8, 10, 2], 4, 1.54, 160, 1, 1.8),
  el(23, "V", "vanadium", 51, [2, 8, 11, 2], 5, 1.63, 153, 1, 1),
  el(24, "Cr", "chromium", 52, [2, 8, 13, 1], 3, 1.66, 139, 1, 4),
  el(25, "Mn", "manganese", 55, [2, 8, 13, 2], 2, 1.55, 139, 1, 3),
  el(26, "Fe", "iron", 56, [2, 8, 14, 2], 3, 1.83, 132, 1, 33),
] as const;

const ABUNDANCE_TOTAL = ELEMENTS.reduce((s, e) => s + e.abundance, 0);

/** Look an element up by atomic number (1..MAX_Z); out of range → null. */
export function elementOf(z: number): ElementDef | null {
  const i = Math.floor(z) - 1;
  return i >= 0 && i < ELEMENTS.length ? ELEMENTS[i] : null;
}

/**
 * Deterministic element identity for a seed, weighted by cosmic abundance:
 * hydrogen is always the mode, helium next, then the O/C/Ne/Fe tail — the
 * field stocks itself the way the universe does. Pure: same seed, same element.
 */
export function elementFromSeed(seed: number): ElementDef {
  const rng = mulberry32(mix32((seed >>> 0) ^ 0x517cc1b7 || 1));
  let r = rng() * ABUNDANCE_TOTAL;
  for (const e of ELEMENTS) {
    r -= e.abundance;
    if (r <= 0) return e;
  }
  return ELEMENTS[0];
}

// ———————————————————————————————————————————————————————————————— the atom

export type AtomMorph = {
  /** Atomic number, 1..MAX_Z — a real element's identity. */
  z: number;
  /** The element's symbol (H, He, … Fe). */
  symbol: string;
  /** Standard atomic weight (≈ nucleon count). */
  weight: number;
  /** Number of occupied shells, 1..4 — the element's real occupied shells. */
  shells: number;
  /** Electrons per shell — the real ground-state occupancy (sums to z). */
  electrons: number[];
  /** Orbital lobe symmetry, 2..6 — a function of the covalent valence. */
  lobes: number;
  /** Resting orientation of the lobes, radians. */
  lobeTilt: number;
  /** Cloud radius as a fraction of the field's smaller dimension (∝ covalent radius). */
  radius: number;
  /** Tint family (index into ATOM_FAMILIES) — the element's chemical family. */
  family: FamilyTint;
  /** Lobe precession, radians/second (signed). */
  precess: number;
  /** Cloud shimmer: amplitude (fraction of radius) and rate. */
  hum: { amp: number; rateHz: number };
  /** Nucleus radius as a fraction of the cloud radius (∝ atomic weight). */
  nucleus: number;
  drift: { ax: number; ay: number; rate: number };
  breathOffset: number;
  /** Chromatic voice offset, 0..11 semitones. */
  voice: number;
};

const RADIUS_MIN = 28; // helium, pm
const RADIUS_MAX = 203; // potassium, pm

/**
 * Decode a seed into a full atom. Pure: same seed, same atom. The identity
 * now comes from the real table via elementFromSeed — shells, tint, cloud
 * radius, and nuclear heft are the element's own; only the mannerisms
 * (tilt, precession, hum, drift, voice) are the individual's.
 */
export function atomFromSeed(seed: number): AtomMorph {
  const s = seed >>> 0;
  const element = elementFromSeed(s);
  const rng = mulberry32(mix32(s || 1));

  const electrons = [...element.shells];
  const shells = electrons.length;
  const lobes = 2 + (element.valence % 5); // 2..6, a function of the valence
  const rNorm = (element.radius - RADIUS_MIN) / (RADIUS_MAX - RADIUS_MIN);

  return {
    z: element.z,
    symbol: element.symbol,
    weight: element.weight,
    shells,
    electrons,
    lobes,
    lobeTilt: rng() * Math.PI * 2,
    radius: 0.11 + 0.08 * rNorm,
    family: element.family,
    precess: (0.04 + rng() * 0.18) * (rng() < 0.5 ? -1 : 1),
    hum: { amp: 0.02 + rng() * 0.03, rateHz: 0.5 + rng() * 1.1 },
    nucleus: 0.05 + 0.04 * (element.weight / 56) + rng() * 0.01,
    drift: { ax: rng() * Math.PI * 2, ay: rng() * Math.PI * 2, rate: 0.05 + rng() * 0.14 },
    breathOffset: rng() * 7,
    voice: Math.floor(rng() * 12),
  };
}

/**
 * Excitation: how far an electron jumps when the atom is struck with the
 * given intensity (0..1). The target ring is always strictly above the
 * ground shells (something must visibly move) and never past MAX_RING.
 * Harder touch, bigger jump — monotone in intensity.
 */
export function excitedRing(morph: AtomMorph, intensity: number): number {
  const u = Math.max(0, Math.min(1, intensity));
  const jump = 1 + Math.min(2, Math.floor(u * 3)); // 1..3
  return Math.min(morph.shells + jump, MAX_RING);
}

// ———————————————————————————————————————————————————————————— covalence, real

/** How many bonds the element still wants — its full covalent appetite. */
export function wantsBond(element: ElementDef): number {
  return element.valence;
}

export type CovalentPairing = {
  /** Bond multiplicity: the lesser appetite, capped at triple. */
  order: 1 | 2 | 3;
  /** Rest length in multiples of a C–C single bond, scaled by the two radii
   *  and shortened as the order climbs (double and triple bonds pull closer). */
  rest: number;
};

const CC_BOND = 152; // two carbon covalent radii, pm — the unit rest length

/**
 * The real covalence law: null if either party wants nothing (noble gases
 * bond with nothing — helium, neon, argon sit sealed), else the bond order
 * is the smaller valence capped at 3 (H–H single, O=O double, N≡N triple)
 * and the rest length is the sum of the two covalent radii, tightened ~10%
 * per extra order. Symmetric by construction.
 */
export function covalentPair(a: ElementDef, b: ElementDef): CovalentPairing | null {
  if (a.valence <= 0 || b.valence <= 0) return null;
  const order = Math.min(a.valence, b.valence, 3) as 1 | 2 | 3;
  const rest = ((a.radius + b.radius) / CC_BOND) * (1 - 0.1 * (order - 1));
  return { order, rest };
}

/**
 * Covalence law, PINNED: order-independent. The two atom seeds are sorted
 * before hashing, so a shared bond is the same bond whichever atom the
 * ceremony began on.
 */
export function bondSeed(a: number, b: number): number {
  const lo = Math.min(a >>> 0, b >>> 0);
  const hi = Math.max(a >>> 0, b >>> 0);
  return hashSeed(lo, hi, 0x0b0d);
}

// —————————————————————————————————————————————————————————— bond polarity

/**
 * Pauling's rule of thumb: an electronegativity gap this wide is no longer
 * sharing, it is taking — the pair sits on one atom and the bond is ionic.
 */
export const IONIC_GAP = 1.7;
/** Below this the pull is even enough to call the sharing honest. */
export const POLAR_GAP = 0.4;
/** The widest gap this table can show (F 3.98 − K 0.82) — the polarity unit. */
const MAX_GAP = 3.16;

export type BondCharacter = "covalent" | "polar" | "ionic";

/**
 * Signed bond polarity, −1..1: how much harder `b` pulls on the shared pair
 * than `a` does, normalized by the widest gap the table holds. Antisymmetric
 * by construction — bondPolarity(a, b) === −bondPolarity(b, a) — so the sign
 * always says which end the charge pools at. Zero for a homonuclear pair
 * (nothing to pull against) and zero wherever no bond exists at all (a noble
 * gas pulls on nothing, so it cannot pull unevenly).
 */
export function bondPolarity(a: ElementDef, b: ElementDef): number {
  if (a.valence <= 0 || b.valence <= 0) return 0;
  const d = (b.electronegativity - a.electronegativity) / MAX_GAP;
  return Math.max(-1, Math.min(1, d));
}

/**
 * What kind of bond the gap makes: even sharing, a lopsided share, or an
 * outright transfer. Monotone in |Δχ| — a wider gap never returns a more
 * covalent verdict.
 */
export function bondCharacter(a: ElementDef, b: ElementDef): BondCharacter {
  if (a.valence <= 0 || b.valence <= 0) return "covalent";
  const d = Math.abs(a.electronegativity - b.electronegativity);
  if (d >= IONIC_GAP) return "ionic";
  return d >= POLAR_GAP ? "polar" : "covalent";
}

export type CovalentBond = {
  seed: number;
  /** Rest separation as a multiple of the two cloud radii summed. */
  rest: number;
  /** Chromatic tone of the bond's hum, 0..11 semitones. */
  tone: number;
  /** 0..1 — how brightly the merged lobes gleam (climbs with bond order). */
  gleam: number;
  /** 0..1 unsigned polarity — how lopsided the sharing is (symmetric). */
  polarity: number;
  /** Even sharing, lopsided sharing, or an outright transfer. */
  character: BondCharacter;
};

/**
 * Decode the pair's bond. Pure and symmetric: covalentBond(a,b) ===
 * covalentBond(b,a). Now drawn from the real layer: the rest separation
 * reflects the two elements' covalent radii and the gleam climbs with the
 * real bond order (a noble pair still hums faintly — the ceremony's glow,
 * not a chemical claim; covalentPair is the arbiter of truth).
 */
export function covalentBond(a: number, b: number): CovalentBond {
  const seed = bondSeed(a, b);
  const rng = mulberry32(mix32(seed || 1));
  const ea = elementFromSeed(a >>> 0);
  const eb = elementFromSeed(b >>> 0);
  const pair = covalentPair(ea, eb);
  const radii = (ea.radius + eb.radius - 2 * RADIUS_MIN) / (2 * (RADIUS_MAX - RADIUS_MIN));
  return {
    seed,
    rest: 0.66 + 0.3 * Math.max(0, Math.min(1, radii)),
    tone: Math.floor(rng() * 12),
    gleam: 0.35 + 0.18 * (pair ? pair.order : 0) + rng() * 0.1,
    // |Δχ| is symmetric, so the bond's polarity is a fact about the pair,
    // exactly like its seed — only the room decides which end it pools at.
    polarity: Math.abs(bondPolarity(ea, eb)),
    character: bondCharacter(ea, eb),
  };
}

// ————————————————————————————————————————————————— the light a fall gives off

/** Rydberg energy, eV — the depth of hydrogen's ground state. */
export const RYDBERG_EV = 13.605693;
/** hc in eV·nm — the one constant that turns an energy into a colour. */
export const HC_EV_NM = 1239.8419;

/**
 * The QUANTUM DEFECT of a ring in this element, in units of n. The one
 * correction that turns hydrogen's formula into every other atom's: an outer
 * electron in a many-electron atom sees a screened core of charge ≈ +1, but
 * the part of its orbit that dives THROUGH the core sees more, and the whole
 * effect is bookkept as a shrunken effective quantum number n* = n − δ.
 *
 * The defect grows with the number of inner shells there are to penetrate —
 * lithium's 2s is 0.41, sodium's 3s is 1.35, potassium's 4s is 2.23, one
 * step of ≈0.92 per shell — and it is smaller for the outer ring an excited
 * electron lands on, which is higher-ℓ and barely penetrates at all. That
 * single line is why the sodium D line comes out at ≈600 nm here against a
 * measured 589, and why hydrogen (nothing to penetrate) stays exact.
 */
export function quantumDefect(element: ElementDef, ring: number): number {
  const inner = element.shells.length - 1;
  if (inner <= 0) return 0;
  const core = 0.92 * inner - 0.5;
  if (ring > element.shells.length) {
    // the ring an electron is excited INTO sits outside its own valence
    // shell: high angular momentum, almost no penetration, almost no defect
    return Math.max(0, core * 0.35);
  }
  // inside the valence shell the sub-shell decides: an s electron dives
  // straight through the core and takes the whole defect, a p electron far
  // less, a d electron essentially none. The occupancy says which it is,
  // because that is the order the shell fills in.
  const occ = element.shells[element.shells.length - 1];
  const penetration = occ <= 2 ? 1 : occ <= 8 ? 0.62 : 0.08;
  return Math.max(0, core * penetration);
}

/**
 * The wavelength of the photon an electron gives up falling from ring
 * `nHigh` to ring `nLow`, nm — Rydberg's formula in effective quantum
 * numbers:
 *
 *   1/λ = R·(1/(n_low − δ_low)² − 1/(n_high − δ_high)²)
 *
 * For hydrogen every defect is zero and this IS the Balmer series: 3→2 lands
 * on 656.1 nm, the red line every spectroscope opens with; 4→2 on 486.0 cyan;
 * 5→2 on 434 violet. Returns Infinity for a fall that isn't one
 * (n_high ≤ n_low): nothing is emitted. Strictly decreasing in the size of
 * the jump — a longer fall is bluer, which is the whole reason a room can
 * colour a transition truthfully instead of picking a pretty hue.
 */
export function emissionWavelengthNm(element: ElementDef, nHigh: number, nLow: number): number {
  const hi = Math.floor(nHigh);
  const lo = Math.floor(nLow);
  if (!(hi > lo) || lo < 1) return Infinity;
  const nLoEff = Math.max(0.4, lo - quantumDefect(element, lo));
  const nHiEff = Math.max(nLoEff + 1e-6, hi - quantumDefect(element, hi));
  const dE = RYDBERG_EV * (1 / (nLoEff * nLoEff) - 1 / (nHiEff * nHiEff));
  if (!(dE > 0)) return Infinity;
  return HC_EV_NM / dE;
}

/**
 * A wavelength rendered as the colour an eye would call it, 0..255 per
 * channel. The classic piecewise CIE approximation over 380–780 nm, with
 * the ends rolled off; anything outside the visible band returns the nearest
 * visible edge dimmed toward the room's parchment, because an ultraviolet
 * line still has to be SEEN — it simply reads as a cold white flash rather
 * than lying about being violet.
 */
export function wavelengthRgb(nm: number): [number, number, number] {
  const w = nm;
  let r = 0;
  let g = 0;
  let b = 0;
  if (w < 380) {
    // ultraviolet: the eye's honest answer is a colourless flash
    return [214, 224, 236];
  }
  if (w > 780) {
    // infrared: felt as heat, drawn as the deepest ember the palette holds
    return [96, 26, 18];
  }
  if (w < 440) {
    r = -(w - 440) / 60;
    b = 1;
  } else if (w < 490) {
    g = (w - 440) / 50;
    b = 1;
  } else if (w < 510) {
    g = 1;
    b = -(w - 510) / 20;
  } else if (w < 580) {
    r = (w - 510) / 70;
    g = 1;
  } else if (w < 645) {
    r = 1;
    g = -(w - 645) / 65;
  } else {
    r = 1;
  }
  // the eye dims at both ends of its own band
  let f = 1;
  if (w < 420) f = 0.3 + (0.7 * (w - 380)) / 40;
  else if (w > 700) f = 0.3 + (0.7 * (780 - w)) / 80;
  const g8 = (v: number) => Math.round(255 * Math.pow(Math.max(0, Math.min(1, v * f)), 0.8));
  return [g8(r), g8(g), g8(b)];
}

/** The same colour as a canvas hex string — the room's only use of it. */
export function emissionHex(element: ElementDef, nHigh: number, nLow: number): string {
  const [r, g, b] = wavelengthRgb(emissionWavelengthNm(element, nHigh, nLow));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/**
 * How hard this element holds the electron a cascade is trying to take,
 * 0..1. Not a new constant: it is the table's own Pauling
 * ELECTRONEGATIVITY, which is precisely the measured willingness to hold
 * charge, normalized by fluorine's. The nobles return 1 — their χ is zero
 * because they pull on nothing in a bond, but nothing loosens an electron
 * from a closed shell either, and the valence column is what says so.
 */
export function ionisationResistance(element: ElementDef): number {
  if (element.valence <= 0) return 1;
  return Math.max(0, Math.min(1, element.electronegativity / 3.98));
}

// ——————————————————————————————————————————————————————————————————— fusion

/**
 * Simplified binding energy per nucleon, MeV-flavored: zero for a lone
 * proton, rising steeply through helium (≈7.0), flattening toward the peak
 * at iron (≈8.7), declining beyond. The concave saturation is the whole
 * story of stellar nucleosynthesis in one curve.
 */
export function bindingPerNucleon(z: number): number {
  const zi = Math.floor(z);
  if (zi <= 1) return 0;
  if (zi <= MAX_Z) return (8.8 * (zi - 1)) / (zi - 0.75);
  const atFe = (8.8 * (MAX_Z - 1)) / (MAX_Z - 0.75);
  return Math.max(0, atFe - 0.2 * (zi - MAX_Z));
}

/** Fusion binds only up to iron: both real nuclei, combined Z ≤ 26. */
export function canFuse(za: number, zb: number): boolean {
  const a = Math.floor(za);
  const b = Math.floor(zb);
  return a >= 1 && b >= 1 && a <= MAX_Z && b <= MAX_Z && a + b <= MAX_Z;
}

/** The real element with Z = Za + Zb, or null past iron (nothing bound there). */
export function fuseProduct(za: number, zb: number): ElementDef | null {
  if (!canFuse(za, zb)) return null;
  return elementOf(Math.floor(za) + Math.floor(zb));
}

/**
 * Energy of fusing two elements (MeV-flavored): total product binding minus
 * what the reactants already held, with nucleon count conserved (A = wa+wb;
 * hydrogen isotopes simplified to Z-only). POSITIVE = released — the blast.
 * Light fusion pays richly (H+H ≈ 14), the per-nucleon gain shrinks
 * monotonically as Z climbs, and any product past iron costs more than it
 * returns (≤ 0) — the stellar dead end.
 */
export function fusionEnergy(za: number, zb: number): number {
  const a = elementOf(za);
  const b = elementOf(zb);
  if (!a || !b) return 0;
  const nucleons = a.weight + b.weight;
  const productZ = a.z + b.z;
  return (
    nucleons * bindingPerNucleon(productZ) -
    a.weight * bindingPerNucleon(a.z) -
    b.weight * bindingPerNucleon(b.z)
  );
}

/**
 * Fold a released fusion energy into a 0..1 scalar for the radiating
 * blast — the room's wave amplitude, the audio swell. Zero for nothing
 * released (endothermic attempts do not bloom), saturating toward 1 for the
 * hottest light-element fusions. Monotone in energy.
 */
export function blastMagnitude(energy: number): number {
  if (!(energy > 0)) return 0;
  return 1 - Math.exp(-energy / 8);
}

// ——————————————————————————————————————————————————————————————— population

/**
 * Enforce the population cap: the oldest residents (front of the list, which
 * the room keeps in arrival order) retire first, gracefully, never the new.
 */
export function settlePopulation<T>(
  items: T[],
  cap: number = MAX_ATOMS,
): { kept: T[]; retired: T[] } {
  const over = Math.max(0, items.length - Math.max(1, cap));
  return { kept: items.slice(over), retired: items.slice(0, over) };
}
