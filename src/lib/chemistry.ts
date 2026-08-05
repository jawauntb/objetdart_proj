/**
 * Chemistry — the molecular latent for /molecules (plan W6), now told
 * truthfully.
 *
 * A molecule IS its seed, and the seed now lands on a REAL compound: a
 * curated library of the actual small molecules — water bent at 104.5°,
 * carbon dioxide dead linear, methane's tetrahedral star flattened to 2D,
 * ammonia, the diatomic air (N≡N triple, O=O double), benzene's closed ring
 * of six equal aromatic bonds, hexane's zigzag chain, methanol, salt — each
 * with its true formula (element Z's and counts), a 2D geometry honoring
 * the real angles and bond lengths, real bond orders, and one felt property
 * (polar, flammable, greenhouse, the water anomaly). Seeds draw from the
 * library abundance-weighted: water, nitrogen, oxygen, CO₂ common; benzene
 * rare.
 *
 * Reactions are real where reality has one: a small curated set of balanced
 * equations (2H₂+O₂→2H₂O, CH₄+2O₂→CO₂+2H₂O, N₂+3H₂→2NH₃, …) encoded as
 * multiset → multiset with a signed energy (combustion releases; N₂+O₂→2NO
 * absorbs — lightning's work). Where the library holds no equation for a
 * pair, the old deterministic-product fallback still answers, PINNED
 * ORDER-INDEPENDENT: reactionProductSeed(a, b) === reactionProductSeed(b, a)
 * — the ceremony never dead-ends and never returns a reactant.
 *
 * Pure and import-free by law: same seed = same molecule, forever. No DOM,
 * no audio, no side effects — node-testable standalone
 * (scripts/test-chemistry.mjs). The room that renders these
 * (MoleculesField) owns canvas, sound, and haptics.
 */

/** Hard population cap for the field; condensations beyond it retire the oldest. */
export const MAX_MOLECULES = 18;

/**
 * The only colors a molecule may wear — ramps around the site tokens
 * (--candle #C8732A, --closed #7A1F1F, --sea #2C4A5C, --paper #F2EEE6),
 * each family ordered dark → light. Index = the compound's felt family:
 * 0 gold = the burners (H₂, CH₄, ethane, ethylene, methanol, benzene,
 * hexane) and the oxygen that feeds them; 1 merlot = the sharp ones (CO,
 * NO, H₂S, salt); 2 sea = the polar waters (H₂O, NH₃, HCl); 3 parchment =
 * the still airs (N₂, CO₂).
 */
export const MOLECULE_FAMILIES = [
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

// ————————————————————————————————————————————————————— the elements it needs
// (kept local by the import-free law — the same truths as src/lib/atomics.ts)

/** The vertex letters the structural-formula lens may write. */
export type AtomLetter = "H" | "C" | "N" | "O" | "Na" | "S" | "Cl";

const CHEM_ELEMENTS: Record<
  number,
  { letter: AtomLetter; radius: number; weight: number }
> = {
  1: { letter: "H", radius: 31, weight: 1 },
  6: { letter: "C", radius: 76, weight: 12 },
  7: { letter: "N", radius: 71, weight: 14 },
  8: { letter: "O", radius: 66, weight: 16 },
  11: { letter: "Na", radius: 166, weight: 23 },
  16: { letter: "S", radius: 105, weight: 32 },
  17: { letter: "Cl", radius: 102, weight: 35 },
};

// —————————————————————————————————————————————————————————————— the library

export type CompoundShape =
  | "bent"
  | "linear"
  | "trigonal"
  | "tetrahedral"
  | "planar"
  | "ring"
  | "chain"
  | "diatomic";

/** One felt property per compound — a flag the room can play, no prose. */
export type Felt =
  | "polar"
  | "nonpolar"
  | "flammable"
  | "oxidizer"
  | "greenhouse"
  | "inert"
  | "toxic"
  | "ionic"
  | "anomalous";

export type CompoundAtom = { z: number; x: number; y: number };
export type CompoundBond = { a: number; b: number; order: 1 | 2 | 3 };

export type Compound = {
  /** Canonical key, e.g. "H2O" — the identity reactions are written in. */
  key: string;
  name: string;
  /** True formula as element Z → count (every atom, even ones not depicted). */
  formula: ReadonlyArray<{ z: number; count: number }>;
  /**
   * 2D depiction: positions in C–C bond-length units, honoring the real
   * shape's angles (water 104.5°, CO₂ collinear, benzene a closed hexagon).
   * Skeletal compounds (benzene, hexane) depict heavy atoms only, hydrogens
   * implicit — the chemist's own convention.
   */
  atoms: CompoundAtom[];
  bonds: CompoundBond[];
  shape: CompoundShape;
  felt: Felt;
  /** True when hydrogens are implicit in the depiction. */
  skeletal: boolean;
  /** Tint family (index into MOLECULE_FAMILIES). */
  family: 0 | 1 | 2 | 3;
  /** Terrestrial-flavored abundance weight for seeding the field. */
  abundance: number;
};

const RAD = Math.PI / 180;
const at = (z: number, angleDeg: number, len: number, ox = 0, oy = 0): CompoundAtom => ({
  z,
  x: ox + Math.cos(angleDeg * RAD) * len,
  y: oy + Math.sin(angleDeg * RAD) * len,
});

/** Real bond lengths in C–C(154 pm) units. */
const L = {
  HH: 0.48,
  OH: 0.62,
  NH: 0.66,
  CH: 0.71,
  NN: 0.71, // N≡N
  CO3: 0.73, // C≡O
  CO2: 0.75, // C=O
  NO: 0.75,
  OO: 0.78,
  HCl: 0.83,
  CC2: 0.86, // C=C
  SH: 0.87,
  CCa: 0.9, // aromatic
  CO1: 0.93, // C–O
  CC: 1.0,
  NaCl: 1.53,
} as const;

function hexaneAtoms(): CompoundAtom[] {
  const pts: CompoundAtom[] = [{ z: 6, x: 0, y: 0 }];
  for (let i = 1; i < 6; i++) {
    const ang = (i % 2 === 1 ? 30 : -30) * RAD;
    pts.push({ z: 6, x: pts[i - 1].x + Math.cos(ang), y: pts[i - 1].y + Math.sin(ang) });
  }
  return pts;
}

const f = (pairs: Array<[number, number]>) => pairs.map(([z, count]) => ({ z, count }));
const b3 = (a: number, b: number, order: 1 | 2 | 3): CompoundBond =>
  a < b ? { a, b, order } : { a: b, b: a, order };

/**
 * The real library. Geometry facts to trust: water's H–O–H is 104.5°,
 * H₂S's is 92.1°, CO₂ is collinear, benzene's six bonds are equal
 * (aromatic), methane's star and ammonia's tripod are the 2D shadows of
 * their 3D shapes.
 */
export const COMPOUNDS: readonly Compound[] = [
  {
    key: "H2O",
    name: "water",
    formula: f([[1, 2], [8, 1]]),
    atoms: [{ z: 8, x: 0, y: 0 }, at(1, 270 - 52.25, L.OH), at(1, 270 + 52.25, L.OH)],
    bonds: [b3(0, 1, 1), b3(0, 2, 1)],
    shape: "bent",
    felt: "anomalous",
    skeletal: false,
    family: 2,
    abundance: 30,
  },
  {
    key: "N2",
    name: "nitrogen",
    formula: f([[7, 2]]),
    atoms: [{ z: 7, x: -L.NN / 2, y: 0 }, { z: 7, x: L.NN / 2, y: 0 }],
    bonds: [b3(0, 1, 3)],
    shape: "diatomic",
    felt: "inert",
    skeletal: false,
    family: 3,
    abundance: 25,
  },
  {
    key: "O2",
    name: "oxygen",
    formula: f([[8, 2]]),
    atoms: [{ z: 8, x: -L.OO / 2, y: 0 }, { z: 8, x: L.OO / 2, y: 0 }],
    bonds: [b3(0, 1, 2)],
    shape: "diatomic",
    felt: "oxidizer",
    skeletal: false,
    family: 0,
    abundance: 14,
  },
  {
    key: "CO2",
    name: "carbon dioxide",
    formula: f([[6, 1], [8, 2]]),
    atoms: [{ z: 6, x: 0, y: 0 }, { z: 8, x: -L.CO2, y: 0 }, { z: 8, x: L.CO2, y: 0 }],
    bonds: [b3(0, 1, 2), b3(0, 2, 2)],
    shape: "linear",
    felt: "greenhouse",
    skeletal: false,
    family: 3,
    abundance: 10,
  },
  {
    key: "CH4",
    name: "methane",
    formula: f([[6, 1], [1, 4]]),
    atoms: [
      { z: 6, x: 0, y: 0 },
      at(1, 45, L.CH),
      at(1, 135, L.CH),
      at(1, 225, L.CH),
      at(1, 315, L.CH),
    ],
    bonds: [b3(0, 1, 1), b3(0, 2, 1), b3(0, 3, 1), b3(0, 4, 1)],
    shape: "tetrahedral",
    felt: "flammable",
    skeletal: false,
    family: 0,
    abundance: 8,
  },
  {
    key: "H2",
    name: "hydrogen",
    formula: f([[1, 2]]),
    atoms: [{ z: 1, x: -L.HH / 2, y: 0 }, { z: 1, x: L.HH / 2, y: 0 }],
    bonds: [b3(0, 1, 1)],
    shape: "diatomic",
    felt: "flammable",
    skeletal: false,
    family: 0,
    abundance: 8,
  },
  {
    key: "NH3",
    name: "ammonia",
    formula: f([[7, 1], [1, 3]]),
    atoms: [{ z: 7, x: 0, y: 0 }, at(1, 90, L.NH), at(1, 210, L.NH), at(1, 330, L.NH)],
    bonds: [b3(0, 1, 1), b3(0, 2, 1), b3(0, 3, 1)],
    shape: "trigonal",
    felt: "polar",
    skeletal: false,
    family: 2,
    abundance: 4,
  },
  {
    key: "CO",
    name: "carbon monoxide",
    formula: f([[6, 1], [8, 1]]),
    atoms: [{ z: 6, x: -L.CO3 / 2, y: 0 }, { z: 8, x: L.CO3 / 2, y: 0 }],
    bonds: [b3(0, 1, 3)],
    shape: "diatomic",
    felt: "toxic",
    skeletal: false,
    family: 1,
    abundance: 4,
  },
  {
    key: "C2H6",
    name: "ethane",
    formula: f([[6, 2], [1, 6]]),
    atoms: [
      { z: 6, x: -L.CC / 2, y: 0 },
      { z: 6, x: L.CC / 2, y: 0 },
      at(1, 120, L.CH, -L.CC / 2, 0),
      at(1, 180, L.CH, -L.CC / 2, 0),
      at(1, 240, L.CH, -L.CC / 2, 0),
      at(1, 60, L.CH, L.CC / 2, 0),
      at(1, 0, L.CH, L.CC / 2, 0),
      at(1, 300, L.CH, L.CC / 2, 0),
    ],
    bonds: [
      b3(0, 1, 1),
      b3(0, 2, 1),
      b3(0, 3, 1),
      b3(0, 4, 1),
      b3(1, 5, 1),
      b3(1, 6, 1),
      b3(1, 7, 1),
    ],
    shape: "tetrahedral",
    felt: "flammable",
    skeletal: false,
    family: 0,
    abundance: 3,
  },
  {
    key: "C2H4",
    name: "ethylene",
    formula: f([[6, 2], [1, 4]]),
    atoms: [
      { z: 6, x: -L.CC2 / 2, y: 0 },
      { z: 6, x: L.CC2 / 2, y: 0 },
      at(1, 120, L.CH, -L.CC2 / 2, 0),
      at(1, 240, L.CH, -L.CC2 / 2, 0),
      at(1, 60, L.CH, L.CC2 / 2, 0),
      at(1, 300, L.CH, L.CC2 / 2, 0),
    ],
    bonds: [b3(0, 1, 2), b3(0, 2, 1), b3(0, 3, 1), b3(1, 4, 1), b3(1, 5, 1)],
    shape: "planar",
    felt: "flammable",
    skeletal: false,
    family: 0,
    abundance: 2,
  },
  {
    key: "CH3OH",
    name: "methanol",
    formula: f([[6, 1], [1, 4], [8, 1]]),
    atoms: [
      { z: 6, x: 0, y: 0 },
      { z: 8, x: L.CO1, y: 0 },
      at(1, 120, L.CH),
      at(1, 180, L.CH),
      at(1, 240, L.CH),
      at(1, 60, L.OH, L.CO1, 0),
    ],
    bonds: [b3(0, 1, 1), b3(0, 2, 1), b3(0, 3, 1), b3(0, 4, 1), b3(1, 5, 1)],
    shape: "tetrahedral",
    felt: "flammable",
    skeletal: false,
    family: 0,
    abundance: 2,
  },
  {
    key: "NaCl",
    name: "salt",
    formula: f([[11, 1], [17, 1]]),
    atoms: [{ z: 11, x: -L.NaCl / 2, y: 0 }, { z: 17, x: L.NaCl / 2, y: 0 }],
    bonds: [b3(0, 1, 1)],
    shape: "diatomic",
    felt: "ionic",
    skeletal: false,
    family: 1,
    abundance: 2,
  },
  {
    key: "HCl",
    name: "hydrogen chloride",
    formula: f([[1, 1], [17, 1]]),
    atoms: [{ z: 1, x: -L.HCl / 2, y: 0 }, { z: 17, x: L.HCl / 2, y: 0 }],
    bonds: [b3(0, 1, 1)],
    shape: "diatomic",
    felt: "polar",
    skeletal: false,
    family: 2,
    abundance: 1.5,
  },
  {
    key: "H2S",
    name: "hydrogen sulfide",
    formula: f([[1, 2], [16, 1]]),
    atoms: [{ z: 16, x: 0, y: 0 }, at(1, 270 - 46.05, L.SH), at(1, 270 + 46.05, L.SH)],
    bonds: [b3(0, 1, 1), b3(0, 2, 1)],
    shape: "bent",
    felt: "toxic",
    skeletal: false,
    family: 1,
    abundance: 1.5,
  },
  {
    key: "C6H14",
    name: "hexane",
    formula: f([[6, 6], [1, 14]]),
    atoms: hexaneAtoms(),
    bonds: [b3(0, 1, 1), b3(1, 2, 1), b3(2, 3, 1), b3(3, 4, 1), b3(4, 5, 1)],
    shape: "chain",
    felt: "nonpolar",
    skeletal: true,
    family: 0,
    abundance: 1,
  },
  {
    key: "NO",
    name: "nitric oxide",
    formula: f([[7, 1], [8, 1]]),
    atoms: [{ z: 7, x: -L.NO / 2, y: 0 }, { z: 8, x: L.NO / 2, y: 0 }],
    bonds: [b3(0, 1, 2)],
    shape: "diatomic",
    felt: "toxic",
    skeletal: false,
    family: 1,
    abundance: 0.8,
  },
  {
    key: "C6H6",
    name: "benzene",
    formula: f([[6, 6], [1, 6]]),
    atoms: [0, 1, 2, 3, 4, 5].map((i) => at(6, 90 + i * 60, L.CCa)),
    bonds: [0, 1, 2, 3, 4, 5].map((i) => b3(i, (i + 1) % 6, i % 2 === 0 ? 2 : 1)),
    shape: "ring",
    felt: "nonpolar",
    skeletal: true,
    family: 0,
    abundance: 0.7,
  },
];

const COMPOUND_ABUNDANCE_TOTAL = COMPOUNDS.reduce((s, c) => s + c.abundance, 0);
const COMPOUND_BY_KEY = new Map(COMPOUNDS.map((c) => [c.key, c] as const));

/** Look a compound up by its canonical key; unknown → null. */
export function compoundByKey(key: string): Compound | null {
  return COMPOUND_BY_KEY.get(key) ?? null;
}

/** True molecular weight, summed from the formula's element weights. */
export function molecularWeight(c: Compound): number {
  let w = 0;
  for (const part of c.formula) w += (CHEM_ELEMENTS[part.z]?.weight ?? 0) * part.count;
  return w;
}

/**
 * Deterministic compound identity for a seed, abundance-weighted: water,
 * nitrogen, oxygen, CO₂ common; benzene rare. Pure: same seed, same compound.
 */
export function compoundFromSeed(seed: number): Compound {
  const rng = mulberry32(mix32(((seed >>> 0) ^ 0x2c9277b5) || 1));
  let r = rng() * COMPOUND_ABUNDANCE_TOTAL;
  for (const c of COMPOUNDS) {
    r -= c.abundance;
    if (r <= 0) return c;
  }
  return COMPOUNDS[0];
}

// ———————————————————————————————————————————————————————————————— the morph

export type MoleculeTopology = "ring" | "chain" | "branched";

export type MolAtom = {
  /** Skeleton position, normalized so the whole frame fits a unit disc. */
  x: number;
  y: number;
  /** Orb size as a fraction of the molecule radius (∝ covalent radius). */
  size: number;
  /** Real element identity; the lens letters heteroatoms only, as notation. */
  letter: AtomLetter;
  /** Ramp index inside the family. */
  tone: number;
};

export type MolBond = {
  /** Atom indices, a < b always (canonical, so duplicates are impossible). */
  a: number;
  b: number;
  order: 1 | 2 | 3;
};

export type MoleculeMorph = {
  topology: MoleculeTopology;
  /** The real compound this molecule is (key into COMPOUNDS). */
  compound: string;
  /** The compound's one felt property, for the room to play. */
  felt: Felt;
  atoms: MolAtom[];
  /**
   * The assembly order: condensation builds these front to back, one bond
   * at a time, and the last one closing is the bloom.
   */
  bonds: MolBond[];
  /** Body radius as a fraction of the field's smaller dimension. */
  radius: number;
  /** Tint family (index into MOLECULE_FAMILIES) — the compound's family. */
  family: 0 | 1 | 2 | 3;
  /** Slow whole-body rotation, radians/second (signed). */
  tumble: number;
  /** Thermal vibration: amplitude (fraction of radius) and rate. */
  jitter: { amp: number; rateHz: number };
  /** Conformational flexing: a slow breathing of the skeleton itself. */
  flex: { amp: number; rateHz: number; phase: number };
  /** Per-atom vibration phase offsets (one per atom). */
  modes: number[];
  drift: { ax: number; ay: number; rate: number };
  breathOffset: number;
  /** Chromatic voice offset, 0..11 semitones. */
  voice: number;
};

function normalize(pts: Array<{ x: number; y: number }>): void {
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= pts.length;
  cy /= pts.length;
  let maxD = 0;
  for (const p of pts) {
    p.x -= cx;
    p.y -= cy;
    maxD = Math.max(maxD, Math.hypot(p.x, p.y));
  }
  const k = maxD > 1e-9 ? 1 / maxD : 1;
  for (const p of pts) {
    p.x *= k;
    p.y *= k;
  }
}

/** Classify a compound's frame for the room: ring, unbranched chain, or fork. */
function topologyOf(c: Compound): MoleculeTopology {
  if (c.shape === "ring") return "ring";
  const deg = c.atoms.map(() => 0);
  for (const bd of c.bonds) {
    deg[bd.a] += 1;
    deg[bd.b] += 1;
  }
  return Math.max(...deg) >= 3 ? "branched" : "chain";
}

/**
 * Decode a seed into a full molecule. Pure: same seed, same structure. The
 * identity now comes from the real library via compoundFromSeed — formula,
 * geometry, bond orders, tint, and felt property are the compound's own;
 * only the mannerisms (orientation, tumble, jitter, flex, voice) are the
 * individual's.
 */
export function moleculeFromSeed(seed: number): MoleculeMorph {
  const s = seed >>> 0;
  const compound = compoundFromSeed(s);
  const rng = mulberry32(mix32(s || 1));

  // the individual's resting orientation — the shape itself is the compound's
  const theta = rng() * Math.PI * 2;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const pts = compound.atoms.map((a) => ({ x: a.x * cos - a.y * sin, y: a.x * sin + a.y * cos }));
  normalize(pts);

  const atoms: MolAtom[] = pts.map((p, i) => {
    const elem = CHEM_ELEMENTS[compound.atoms[i].z];
    return {
      x: p.x,
      y: p.y,
      size: 0.09 + 0.12 * ((elem?.radius ?? 76) / 166),
      letter: elem?.letter ?? "C",
      tone: 2 + Math.floor(rng() * 3),
    };
  });

  const bonds: MolBond[] = compound.bonds.map((bd) => b3(bd.a, bd.b, bd.order));
  const modes = atoms.map(() => rng() * Math.PI * 2);

  return {
    topology: topologyOf(compound),
    compound: compound.key,
    felt: compound.felt,
    atoms,
    bonds,
    radius: 0.05 + atoms.length * 0.004 + rng() * 0.02,
    family: compound.family,
    tumble: (0.05 + rng() * 0.22) * (rng() < 0.5 ? -1 : 1),
    jitter: { amp: 0.012 + rng() * 0.02, rateHz: 1.2 + rng() * 2.2 },
    flex: { amp: 0.03 + rng() * 0.05, rateHz: 0.12 + rng() * 0.28, phase: rng() * Math.PI * 2 },
    modes,
    drift: { ax: rng() * Math.PI * 2, ay: rng() * Math.PI * 2, rate: 0.1 + rng() * 0.26 },
    breathOffset: rng() * 7,
    voice: Math.floor(rng() * 12),
  };
}

// ——————————————————————————————————————————————— how a molecule actually moves

/** Whether the compound's frame is collinear — the count of modes turns on it. */
export function isLinear(c: Compound): boolean {
  return c.shape === "linear" || c.shape === "diatomic";
}

/**
 * How many independent ways this molecule can VIBRATE. The count is not a
 * choice: a molecule of N atoms has 3N degrees of freedom, three of which
 * are the whole body translating and three (two, if it is a straight line —
 * spinning a line about its own axis moves nothing) are it rotating. What is
 * left over is vibration.
 *
 *   nonlinear: 3N − 6      linear: 3N − 5
 *
 * Water gets 3, carbon dioxide 4 (one more, though it has the same atom
 * count — because it is straight), a diatomic exactly 1: the single stretch.
 * Skeletal depictions still count their implicit hydrogens, because the real
 * molecule has them whatever the drawing shows.
 */
export function vibrationalModeCount(c: Compound): number {
  let n = 0;
  for (const part of c.formula) n += part.count;
  if (n < 2) return 0;
  return isLinear(c) ? 3 * n - 5 : 3 * n - 6;
}

export type VibrationKind = "stretch" | "bend" | "rock" | "breathe";

export type VibrationMode = {
  kind: VibrationKind;
  /** Wavenumber, cm⁻¹ — where the mode absorbs infrared. */
  wavenumber: number;
  /** Whether the mode changes the dipole (only those absorb IR at all). */
  irActive: boolean;
};

/**
 * The named modes a room can actually show, in the order a spectroscopist
 * would list them: lowest wavenumber first. Real numbers where reality has
 * them — water's bend at 1595 cm⁻¹ under its symmetric stretch at 3657 and
 * its asymmetric at 3756; CO₂'s bend at 667, its IR-DARK symmetric stretch
 * at 1333 (the two oxygens move out together, the dipole never changes, and
 * that is exactly why it is invisible in the infrared while the asymmetric
 * stretch at 2349 is the band that makes CO₂ a greenhouse gas at all).
 *
 * The mode count matches `vibrationalModeCount`; where a compound has more
 * modes than reality has famous names, the remainder are filled in as
 * degenerate bends scaled from the compound's own bonds — deterministic, and
 * always ordered by wavenumber.
 */
export function vibrationalModes(c: Compound): VibrationMode[] {
  const named: Record<string, VibrationMode[]> = {
    H2O: [
      { kind: "bend", wavenumber: 1595, irActive: true },
      { kind: "stretch", wavenumber: 3657, irActive: true },
      { kind: "stretch", wavenumber: 3756, irActive: true },
    ],
    CO2: [
      { kind: "bend", wavenumber: 667, irActive: true },
      { kind: "bend", wavenumber: 667, irActive: true },
      { kind: "stretch", wavenumber: 1333, irActive: false },
      { kind: "stretch", wavenumber: 2349, irActive: true },
    ],
    N2: [{ kind: "stretch", wavenumber: 2359, irActive: false }],
    O2: [{ kind: "stretch", wavenumber: 1580, irActive: false }],
    H2: [{ kind: "stretch", wavenumber: 4161, irActive: false }],
    CO: [{ kind: "stretch", wavenumber: 2143, irActive: true }],
    NO: [{ kind: "stretch", wavenumber: 1876, irActive: true }],
    HCl: [{ kind: "stretch", wavenumber: 2886, irActive: true }],
    NaCl: [{ kind: "stretch", wavenumber: 364, irActive: true }],
  };
  const want = vibrationalModeCount(c);
  const have = named[c.key] ?? [];
  const out: VibrationMode[] = have.slice(0, want).map((m) => ({ ...m }));
  // the unnamed remainder: bends and stretches scaled off the compound's own
  // bond orders, so a heavier, floppier frame hums lower than a tight one
  let order = 0;
  for (const b of c.bonds) order += b.order;
  const base = 380 + (order / Math.max(1, c.bonds.length)) * 520;
  for (let i = out.length; i < want; i++) {
    const stretch = i % 3 === 2;
    out.push({
      kind: c.shape === "ring" && !stretch ? "breathe" : stretch ? "stretch" : i % 3 === 1 ? "rock" : "bend",
      wavenumber: Math.round(base * (stretch ? 2.6 : 1) + i * 37),
      irActive: c.felt !== "nonpolar" && c.felt !== "inert",
    });
  }
  out.sort((a, b) => a.wavenumber - b.wavenumber);
  return out;
}

/**
 * The mode this molecule answers a strike with, given a 0..1 blow. A soft
 * touch sets the lowest (floppiest) mode going; a harder one reaches up the
 * ladder toward the stiff stretches. Monotone in strength — nothing here
 * fires the same at 0.1 and at 0.9 — and deterministic.
 */
export function modeForStrength(c: Compound, strength: number): VibrationMode | null {
  const modes = vibrationalModes(c);
  if (modes.length === 0) return null;
  const u = Math.max(0, Math.min(1, strength));
  return modes[Math.min(modes.length - 1, Math.floor(u * modes.length * 0.999))];
}

/**
 * A wavenumber (cm⁻¹) carried down into the audible register, Hz. The true
 * frequency is c·ν̃ ≈ 3·10¹⁰ Hz per cm⁻¹; this is the same law under a
 * log-preserving change of octave, so a stiffer bond is literally a higher
 * note and the whole infrared spectrum sits inside four octaves a room can
 * actually sound. Strictly monotone in the wavenumber.
 */
export function vibrationPitchHz(wavenumber: number): number {
  const w = Math.max(200, Math.min(4400, wavenumber));
  const u = Math.log(w / 200) / Math.log(4400 / 200);
  return 110 * Math.pow(16, u);
}

// —————————————————————————————————————————————————————————————— the reactions

export type Reaction = {
  /** Reactant multiset: compound keys with stoichiometric counts. */
  reactants: ReadonlyArray<{ key: string; n: number }>;
  /** Product multiset — atom counts balance the reactants exactly. */
  products: ReadonlyArray<{ key: string; n: number }>;
  /** kJ per equation as written; positive = released (exothermic). */
  energy: number;
};

const rx = (
  reactants: Array<[string, number]>,
  products: Array<[string, number]>,
  energy: number,
): Reaction => ({
  reactants: reactants.map(([key, n]) => ({ key, n })),
  products: products.map(([key, n]) => ({ key, n })),
  energy,
});

/**
 * The curated set — every equation balanced to the atom, every energy sign
 * real. Combustions release; the nitrogen fixation of lightning absorbs.
 */
export const REACTIONS: readonly Reaction[] = [
  rx([["H2", 2], ["O2", 1]], [["H2O", 2]], 572),
  rx([["CH4", 1], ["O2", 2]], [["CO2", 1], ["H2O", 2]], 890),
  rx([["N2", 1], ["H2", 3]], [["NH3", 2]], 92),
  rx([["CO", 2], ["O2", 1]], [["CO2", 2]], 566),
  rx([["C2H4", 1], ["H2", 1]], [["C2H6", 1]], 137),
  rx([["C2H6", 2], ["O2", 7]], [["CO2", 4], ["H2O", 6]], 3120),
  rx([["CH3OH", 2], ["O2", 3]], [["CO2", 2], ["H2O", 4]], 1452),
  rx([["C6H6", 2], ["O2", 15]], [["CO2", 12], ["H2O", 6]], 6534),
  rx([["C6H14", 2], ["O2", 19]], [["CO2", 12], ["H2O", 14]], 8326),
  rx([["N2", 1], ["O2", 1]], [["NO", 2]], -181),
];

/**
 * The real reaction for a pair of compounds, if the curated set holds one —
 * matched on the unordered pair of species, so reactionOf(a, b) ===
 * reactionOf(b, a). Null when reality (as curated) has no equation for the
 * pair; the room then falls back to reactionProductSeed so the ceremony
 * never dead-ends.
 */
export function reactionOf(aKey: string, bKey: string): Reaction | null {
  for (const r of REACTIONS) {
    const keys = new Set(r.reactants.map((x) => x.key));
    if (keys.size === 2 && keys.has(aKey) && keys.has(bKey) && aKey !== bKey) return r;
    if (keys.size === 1 && aKey === bKey && keys.has(aKey)) return r;
  }
  return null;
}

/**
 * Fallback reaction law, PINNED: order-independent. Two reactant seeds are
 * sorted before hashing, so the product is a property of the pair —
 * whichever molecule the ceremony began on, the same product condenses. The
 * product must be a new individual: collisions with either reactant re-roll
 * deterministically.
 */
export function reactionProductSeed(a: number, b: number): number {
  const lo = Math.min(a >>> 0, b >>> 0);
  const hi = Math.max(a >>> 0, b >>> 0);
  let round = 0;
  let p = hashSeed(lo, hi, round);
  while (p === lo || p === hi) {
    round += 1;
    p = hashSeed(lo, hi, round);
  }
  return p;
}

/**
 * Enforce the population cap: the oldest residents (front of the list, which
 * the room keeps in arrival order) retire first, gracefully, never the new.
 */
export function settlePopulation<T>(
  items: T[],
  cap: number = MAX_MOLECULES,
): { kept: T[]; retired: T[] } {
  const over = Math.max(0, items.length - Math.max(1, cap));
  return { kept: items.slice(over), retired: items.slice(0, over) };
}
