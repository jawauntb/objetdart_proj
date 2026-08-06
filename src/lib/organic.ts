/**
 * organic — what carbon does when it has time.
 *
 * The invariant is a molecular graph: a backbone, its substituent groups,
 * and the free energy of the arrangement. Everything the /organics room
 * shows or sounds is a representation of that one object.
 *
 * The load-bearing map is strain → beat. Two carbons held at the wrong
 * angle beat against each other; the tetrahedral angle is where the
 * beating stops, so the room is IN TUNE exactly when the molecule is at
 * its minimum. The map is invertible (`beatHz` ∘ `strainFromBeat` = id on
 * the audible range), which is what makes it a representation of the
 * geometry rather than a decoration of it.
 *
 * Pure math, no imports, no DOM — node-testable (scripts/test-organic.mjs).
 * See docs/plans/life-and-vista-bands.md §2 and INSPIRATION.md §2.
 */

/** 109.47°, in radians — where sp³ carbon stops complaining. */
export const TETRAHEDRAL = Math.acos(-1 / 3);
/** Staggered torsions sit at odd multiples of 60°. */
export const STAGGER = Math.PI / 3;

export const MAX_CHAINS = 6;
export const MAX_BACKBONE = 12;
export const MIN_BACKBONE = 2;

export type OrganicElement = "C" | "N" | "O";

/** Real covalences. A carbon takes four bonds and not a fifth. */
export const COVALENCE: Record<OrganicElement, number> = { C: 4, N: 3, O: 2 };

/** Substituent groups a backbone atom can carry, and what they cost. */
export type GroupKey = "H" | "OH" | "NH2" | "CH3" | "O";

export type Formula = { C: number; H: number; N: number; O: number };

export const GROUPS: Record<GroupKey, { formula: Formula; bonds: 1 | 2 }> = {
  H: { formula: { C: 0, H: 1, N: 0, O: 0 }, bonds: 1 },
  OH: { formula: { C: 0, H: 1, N: 0, O: 1 }, bonds: 1 },
  NH2: { formula: { C: 0, H: 2, N: 1, O: 0 }, bonds: 1 },
  CH3: { formula: { C: 1, H: 3, N: 0, O: 0 }, bonds: 1 },
  /** a carbonyl oxygen: one atom, two bonds */
  O: { formula: { C: 0, H: 0, N: 0, O: 1 }, bonds: 2 },
};

export const EMPTY_FORMULA: Formula = { C: 0, H: 0, N: 0, O: 0 };

export function addFormula(a: Formula, b: Formula): Formula {
  return { C: a.C + b.C, H: a.H + b.H, N: a.N + b.N, O: a.O + b.O };
}

export function subFormula(a: Formula, b: Formula): Formula {
  return { C: a.C - b.C, H: a.H - b.H, N: a.N - b.N, O: a.O - b.O };
}

export function formulaEquals(a: Formula, b: Formula): boolean {
  return a.C === b.C && a.H === b.H && a.N === b.N && a.O === b.O;
}

export function formulaCount(f: Formula): number {
  return f.C + f.H + f.N + f.O;
}

// ——— the graph ———————————————————————————————————————————————————————

export type BackboneAtom = { el: OrganicElement; subs: GroupKey[] };

export type Chain = {
  seed: number;
  atoms: BackboneAtom[];
  /** interior bond angles, radians — length = atoms.length - 2 */
  angles: number[];
  /** torsions about interior bonds, radians — length = max(0, atoms.length - 3) */
  torsions: number[];
  /** 0..1, how far the chain has folded on itself */
  fold: number;
};

/** How many bonds this atom's backbone neighbours and groups already use. */
export function usedValence(atom: BackboneAtom, neighbors: number): number {
  let used = neighbors;
  for (const g of atom.subs) used += GROUPS[g].bonds;
  return used;
}

/** What is still free to bond. Negative means the graph is impossible. */
export function freeValence(atom: BackboneAtom, neighbors: number): number {
  return COVALENCE[atom.el] - usedValence(atom, neighbors);
}

/** Backbone neighbours of position i in a chain of n. */
export function neighborsAt(n: number, i: number): number {
  if (n <= 1) return 0;
  return i === 0 || i === n - 1 ? 1 : 2;
}

/** True when every atom's valence is exactly satisfied — nothing dangling. */
export function isSaturated(chain: Chain): boolean {
  const n = chain.atoms.length;
  for (let i = 0; i < n; i++) {
    if (freeValence(chain.atoms[i], neighborsAt(n, i)) !== 0) return false;
  }
  return true;
}

/** Can a new group land on this atom, or is the carbon already full? */
export function canAccept(chain: Chain, i: number, group: GroupKey): boolean {
  const n = chain.atoms.length;
  if (i < 0 || i >= n) return false;
  return freeValence(chain.atoms[i], neighborsAt(n, i)) >= GROUPS[group].bonds;
}

export function chainFormula(chain: Chain): Formula {
  let f = { ...EMPTY_FORMULA };
  for (const a of chain.atoms) {
    f = addFormula(f, { C: a.el === "C" ? 1 : 0, H: 0, N: a.el === "N" ? 1 : 0, O: a.el === "O" ? 1 : 0 });
    for (const g of a.subs) f = addFormula(f, GROUPS[g].formula);
  }
  return f;
}

// ——— the free energy, and the relaxation that finds its floor ————————

/** How much a torsion costs relative to a bent angle. */
export const TORSION_K = 0.42;

/**
 * The arrangement's strain: bent angles cost quadratically, eclipsed
 * torsions cost on a three-fold barrier. Zero exactly at the tetrahedral
 * angle with every torsion staggered — the conformation the chain wants.
 */
export function strainEnergy(chain: Chain): number {
  let e = 0;
  for (const a of chain.angles) {
    const d = a - TETRAHEDRAL;
    e += d * d;
  }
  for (const t of chain.torsions) {
    e += TORSION_K * (1 + Math.cos(3 * t)) / 2;
  }
  return e;
}

/** The staggered minimum nearest a torsion — the conformer it falls into. */
export function nearestStaggered(t: number): number {
  const k = Math.round((t - STAGGER) / (2 * STAGGER));
  return STAGGER + k * 2 * STAGGER;
}

/** Relaxation time constants, ms. Angles snap; torsions take their time. */
export const ANGLE_TAU_MS = 620;
export const TORSION_TAU_MS = 1450;

/**
 * One step downhill. Both coordinates relax exponentially toward their own
 * minimum, which is exact rather than integrated — so the energy is
 * monotone non-increasing for ANY timestep, and a slow frame can never
 * make the molecule tenser than it was. `warmth` (0..1) is the world-law
 * knob: heat holds the chain off its floor.
 */
export function relaxChain(chain: Chain, dtMs: number, warmth = 0): Chain {
  const dt = Math.max(0, dtMs);
  const ka = Math.exp(-dt / ANGLE_TAU_MS);
  const kt = Math.exp(-dt / TORSION_TAU_MS);
  const w = Math.min(1, Math.max(0, warmth));
  // Heat does not add strain; it slows the descent to a crawl.
  const ea = ka + (1 - ka) * w;
  const et = kt + (1 - kt) * w;
  return {
    ...chain,
    angles: chain.angles.map((a) => TETRAHEDRAL + (a - TETRAHEDRAL) * ea),
    torsions: chain.torsions.map((t) => {
      const m = nearestStaggered(t);
      return m + (t - m) * et;
    }),
  };
}

// ——— strain ↔ beat: the invertible map the room is tuned by ——————————

/** The widest beat the room will sound, Hz. */
export const BEAT_MAX_HZ = 11;
/** Strain at which the beat has closed most of its range. */
export const STRAIN_REF = 0.9;

/**
 * Strain → the beat frequency between the two voices a bond holds. Zero
 * strain is zero beat: the molecule at its minimum is a room in tune.
 */
export function beatHz(strain: number): number {
  const s = Math.max(0, strain);
  return BEAT_MAX_HZ * (1 - Math.exp(-s / STRAIN_REF));
}

/**
 * ...and back. Hearing the beat rate IS reading the geometry — the map
 * loses nothing, which is what earns it a place (INSPIRATION.md §2).
 */
export function strainFromBeat(hz: number): number {
  const h = Math.min(BEAT_MAX_HZ - 1e-9, Math.max(0, hz));
  return -STRAIN_REF * Math.log(1 - h / BEAT_MAX_HZ);
}

/** Longer backbones ring lower: the chain's own fundamental, Hz. */
export function chainHz(chain: Chain): number {
  const n = Math.max(MIN_BACKBONE, chain.atoms.length);
  return 660 / Math.pow(n / 4, 0.72);
}

// ——— folding: the long-press IS the folding time ——————————————————————

/** Time constant of the fold, ms — a hold is a duration, never a switch. */
export const FOLD_MS = 2600;

export function foldPhase(heldMs: number): number {
  if (!(heldMs > 0)) return 0;
  return 1 - Math.exp(-heldMs / FOLD_MS);
}

export type FoldStage = "extended" | "nucleated" | "folded";

export function foldStage(fold: number): FoldStage {
  if (fold < 0.25) return "extended";
  if (fold < 0.72) return "nucleated";
  return "folded";
}

/**
 * A folded chain coils: its torsions crowd toward one staggered family,
 * which is exactly what a helix is. `fold` 0 leaves the conformation
 * alone; 1 pulls every torsion onto the same turn — the backbone the
 * ladder above is made of.
 */
export function coiledTorsions(chain: Chain): number[] {
  const f = Math.min(1, Math.max(0, chain.fold));
  return chain.torsions.map((t) => t + (Math.PI - t) * f);
}

// ——— condensation: a real bond, with the water it lets go ————————————

export const WATER: Formula = { C: 0, H: 2, N: 0, O: 1 };

/**
 * The peptide bond: an amine end and an acid end join, and one water
 * leaves. Nothing is created — `product + water` is exactly `a + b`,
 * which the suite checks rather than trusts.
 */
export function peptideCondense(
  a: Formula,
  b: Formula,
): { product: Formula; water: Formula } | null {
  if (a.N < 1 || b.N < 1) return null; // no amine, no peptide
  if (a.O < 2 || b.O < 2) return null; // no acid either
  return { product: subFormula(addFormula(a, b), WATER), water: WATER };
}

// ——— polarity: why two chains care about each other ——————————————————

/**
 * Group dipole weights, in debye-ish units — hydroxyl and amine are the
 * polar ones, a carbonyl the strongest, and a hydrocarbon is nothing at
 * all. This is what makes hexane indifferent and glycine sticky.
 */
export const GROUP_DIPOLE: Record<GroupKey, number> = {
  H: 0,
  OH: 1.5,
  NH2: 1.3,
  CH3: 0,
  O: 2.3,
};

/**
 * A chain's net polarity, 0..1 — polar groups per backbone atom, saturating.
 * Pure hydrocarbon is exactly zero: hexane feels no pull toward anything,
 * which is the whole reason oil and water are two things.
 */
export function polarity(chain: Chain): number {
  const n = Math.max(1, chain.atoms.length);
  let d = 0;
  for (const a of chain.atoms) {
    if (a.el === "N") d += 0.6;
    if (a.el === "O") d += 0.9;
    for (const g of a.subs) d += GROUP_DIPOLE[g];
  }
  return 1 - Math.exp(-d / (n * 1.15));
}

/** Hydrogen-bond donors (N–H, O–H) a chain offers. */
export function hbondDonors(chain: Chain): number {
  let n = 0;
  for (const a of chain.atoms) {
    if (a.el === "N") n += a.subs.filter((g) => g === "H").length;
    for (const g of a.subs) if (g === "OH") n += 1;
    for (const g of a.subs) if (g === "NH2") n += 2;
  }
  return n;
}

/** Hydrogen-bond acceptors (lone pairs on N and O) a chain offers. */
export function hbondAcceptors(chain: Chain): number {
  let n = 0;
  for (const a of chain.atoms) {
    if (a.el === "O") n += 2;
    if (a.el === "N") n += 1;
    for (const g of a.subs) {
      if (g === "OH") n += 2;
      if (g === "O") n += 2;
      if (g === "NH2") n += 1;
    }
  }
  return n;
}

/** Range of the dipole attraction, in bond lengths. Beyond it, nothing. */
export const DIPOLE_RANGE = 9;

/**
 * The attraction between two chains at distance `d` (bond lengths):
 * dipole–dipole, so it goes as 1/d³ and vanishes entirely if either chain
 * is nonpolar. Softened at short range so the integrator cannot explode,
 * and cut to exactly zero past DIPOLE_RANGE so the room stays O(near).
 */
export function dipoleAttraction(a: Chain, b: Chain, d: number): number {
  if (!(d > 0) || d > DIPOLE_RANGE) return 0;
  const p = polarity(a) * polarity(b);
  if (p <= 0) return 0;
  const soft = Math.max(1, d);
  return p / (soft * soft * soft);
}

/**
 * How strongly two chains hydrogen-bond when they meet: donors of one to
 * acceptors of the other, both ways, saturating. Zero for two hydrocarbons.
 */
export function hbondStrength(a: Chain, b: Chain): number {
  const pairs = Math.min(hbondDonors(a), hbondAcceptors(b)) + Math.min(hbondDonors(b), hbondAcceptors(a));
  return 1 - Math.exp(-pairs / 4);
}

// ——— ligation and hydrolysis: the third thing, and its undoing —————————

/** Does this chain end in a carboxyl the next amine can attack? */
export function hasAcidEnd(chain: Chain): boolean {
  const last = chain.atoms[chain.atoms.length - 1];
  return !!last && last.subs.includes("OH") && last.subs.includes("O");
}

/** Does this chain open with an amine willing to be attacked? */
export function hasAmineEnd(chain: Chain): boolean {
  const first = chain.atoms[0];
  return !!first && first.el === "N" && first.subs.includes("H");
}

/**
 * Ligation: a's acid end and b's amine end condense into ONE chain that is
 * neither parent, and exactly one water walks away. Atom for atom —
 * `chainFormula(product) + WATER === chainFormula(a) + chainFormula(b)` —
 * which the suite recomputes rather than trusts. Two glycines make
 * glycylglycine, and `recognize` says so.
 *
 * Returns null when the chemistry refuses: no acid, no amine, or a product
 * longer than a backbone this room can hold.
 */
export function ligateChains(a: Chain, b: Chain): { chain: Chain; water: Formula } | null {
  if (!hasAcidEnd(a) || !hasAmineEnd(b)) return null;
  const n = a.atoms.length + b.atoms.length;
  if (n > MAX_BACKBONE) return null;
  const atoms: BackboneAtom[] = [];
  for (let i = 0; i < a.atoms.length; i++) {
    const at = a.atoms[i];
    if (i !== a.atoms.length - 1) {
      atoms.push({ el: at.el, subs: [...at.subs] });
      continue;
    }
    // the acid loses its hydroxyl
    const subs = [...at.subs];
    subs.splice(subs.indexOf("OH"), 1);
    atoms.push({ el: at.el, subs });
  }
  for (let i = 0; i < b.atoms.length; i++) {
    const at = b.atoms[i];
    if (i !== 0) {
      atoms.push({ el: at.el, subs: [...at.subs] });
      continue;
    }
    // the amine loses one hydrogen — together, exactly one water
    const subs = [...at.subs];
    subs.splice(subs.indexOf("H"), 1);
    atoms.push({ el: at.el, subs });
  }
  const seed = hashSeed(a.seed, b.seed, n);
  const rng = mulberry32(seed);
  const angles: number[] = [];
  for (let i = 0; i < Math.max(0, n - 2); i++) {
    angles.push(i < a.angles.length ? a.angles[i] : TETRAHEDRAL + (rng() - 0.5) * 0.8);
  }
  const torsions: number[] = [];
  for (let i = 0; i < Math.max(0, n - 3); i++) {
    torsions.push(i < a.torsions.length ? a.torsions[i] : rng() * Math.PI * 2);
  }
  return {
    chain: { seed, atoms, angles, torsions, fold: Math.min(a.fold, b.fold) * 0.5 },
    water: WATER,
  };
}

/**
 * Hydrolysis: water goes back in at the peptide bond after backbone atom
 * `i`, and the chain becomes two. The exact inverse of `ligateChains` on
 * the formula ledger, so a chain that was joined can always be taken apart
 * again with nothing lost or invented.
 */
export function hydrolyseChain(chain: Chain, i: number): [Chain, Chain] | null {
  const n = chain.atoms.length;
  if (i < 1 || i >= n - 1) return null;
  const left = chain.atoms.slice(0, i).map((a) => ({ el: a.el, subs: [...a.subs] }));
  const right = chain.atoms.slice(i).map((a) => ({ el: a.el, subs: [...a.subs] }));
  const tail = left[left.length - 1];
  const head = right[0];
  // water splits across the break: OH to the acid side, H to the amine side
  if (!tail.subs.includes("O")) return null;
  if (head.el !== "N") return null;
  if (freeValence({ el: tail.el, subs: [...tail.subs, "OH"] }, left.length > 1 ? 1 : 0) < 0) return null;
  tail.subs = [...tail.subs, "OH"];
  head.subs = [...head.subs, "H"];
  const sa = hashSeed(chain.seed, i, 1);
  const sb = hashSeed(chain.seed, i, 2);
  const mk = (atoms: BackboneAtom[], seed: number, fromAngles: number[], fromTors: number[]): Chain => {
    const rng = mulberry32(seed);
    const m = atoms.length;
    const angles: number[] = [];
    for (let k = 0; k < Math.max(0, m - 2); k++) {
      angles.push(k < fromAngles.length ? fromAngles[k] : TETRAHEDRAL + (rng() - 0.5) * 0.7);
    }
    const torsions: number[] = [];
    for (let k = 0; k < Math.max(0, m - 3); k++) {
      torsions.push(k < fromTors.length ? fromTors[k] : rng() * Math.PI * 2);
    }
    return { seed, atoms, angles, torsions, fold: 0 };
  };
  return [
    mk(left, sa, chain.angles.slice(0, Math.max(0, i - 1)), chain.torsions.slice(0, Math.max(0, i - 2))),
    mk(right, sb, chain.angles.slice(i), chain.torsions.slice(i)),
  ];
}

/** Where a chain can actually be cut — the peptide bonds it contains. */
export function peptideSites(chain: Chain): number[] {
  const out: number[] = [];
  for (let i = 1; i < chain.atoms.length - 1; i++) {
    if (chain.atoms[i].el === "N" && chain.atoms[i - 1].subs.includes("O")) out.push(i);
  }
  return out;
}

// ——— what the hand can build ——————————————————————————————————————

export type TargetKey = "hexane" | "glucose" | "glycine" | "glycylglycine";

export type Target = {
  key: TargetKey;
  label: string;
  formula: Formula;
  /** The structure, atom by atom — the formula above is checked against it. */
  atoms: BackboneAtom[];
};

/**
 * The three the plan names, and what two glycines make. Each structure is
 * written out honestly; the suite recomputes the formula from the atoms and
 * checks every valence closes, so a mistyped substituent cannot ship.
 */
export const TARGETS: readonly Target[] = [
  {
    key: "hexane",
    label: "hexane",
    formula: { C: 6, H: 14, N: 0, O: 0 },
    atoms: [
      { el: "C", subs: ["H", "H", "H"] },
      { el: "C", subs: ["H", "H"] },
      { el: "C", subs: ["H", "H"] },
      { el: "C", subs: ["H", "H"] },
      { el: "C", subs: ["H", "H"] },
      { el: "C", subs: ["H", "H", "H"] },
    ],
  },
  {
    key: "glucose",
    label: "glucose",
    formula: { C: 6, H: 12, N: 0, O: 6 },
    atoms: [
      { el: "C", subs: ["H", "O"] }, // the aldehyde that opens the chain
      { el: "C", subs: ["H", "OH"] },
      { el: "C", subs: ["H", "OH"] },
      { el: "C", subs: ["H", "OH"] },
      { el: "C", subs: ["H", "OH"] },
      { el: "C", subs: ["H", "H", "OH"] },
    ],
  },
  {
    key: "glycine",
    label: "glycine",
    formula: { C: 2, H: 5, N: 1, O: 2 },
    atoms: [
      { el: "N", subs: ["H", "H"] },
      { el: "C", subs: ["H", "H"] },
      { el: "C", subs: ["O", "OH"] },
    ],
  },
  {
    key: "glycylglycine",
    label: "glycylglycine",
    formula: { C: 4, H: 8, N: 2, O: 3 },
    atoms: [
      { el: "N", subs: ["H", "H"] },
      { el: "C", subs: ["H", "H"] },
      { el: "C", subs: ["O"] },
      { el: "N", subs: ["H"] },
      { el: "C", subs: ["H", "H"] },
      { el: "C", subs: ["O", "OH"] },
    ],
  },
];

export function targetByKey(key: string): Target | null {
  for (const t of TARGETS) if (t.key === key) return t;
  return null;
}

/** What the hand has actually built, if the counts name something real. */
export function recognize(f: Formula): Target | null {
  for (const t of TARGETS) if (formulaEquals(t.formula, f)) return t;
  return null;
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

/** A chain from a target, arriving strained — it has not settled yet. */
export function chainFromTarget(key: TargetKey, seed: number): Chain {
  const target = targetByKey(key);
  const atoms = (target ? target.atoms : TARGETS[0].atoms).map((a) => ({
    el: a.el,
    subs: [...a.subs],
  }));
  const rng = mulberry32(seed >>> 0);
  const n = atoms.length;
  const angles: number[] = [];
  for (let i = 0; i < Math.max(0, n - 2); i++) angles.push(TETRAHEDRAL + (rng() - 0.5) * 0.9);
  const torsions: number[] = [];
  for (let i = 0; i < Math.max(0, n - 3); i++) torsions.push(rng() * Math.PI * 2);
  return { seed: seed >>> 0, atoms, angles, torsions, fold: 0 };
}

/** A chain condensed out of the solvent — deterministic from its seed. */
export function chainFromSeed(seed: number): Chain {
  const rng = mulberry32(seed >>> 0);
  const key = TARGETS[Math.floor(rng() * 3)].key; // the three buildable ones
  return chainFromTarget(key, seed);
}

/**
 * Backbone positions in the plane, walked from the angles and torsions —
 * the geometry the eye reads and the beat reports on. Bond length is one
 * unit; the caller scales. Folding tightens the walk into a coil.
 */
export function backbonePoints(chain: Chain): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [{ x: 0, y: 0 }];
  const n = chain.atoms.length;
  if (n < 2) return pts;
  const tors = coiledTorsions(chain);
  let heading = 0;
  let x = 0;
  let y = 0;
  for (let i = 1; i < n; i++) {
    if (i >= 2) {
      const bend = Math.PI - chain.angles[i - 2];
      // Torsion decides which way the chain turns at each joint; a coiled
      // chain always turns the same way, which is how a helix happens.
      const sign = i - 3 >= 0 ? (Math.cos(tors[i - 3]) >= 0 ? 1 : -1) : 1;
      heading += bend * sign;
    }
    x += Math.cos(heading);
    y += Math.sin(heading);
    pts.push({ x, y });
  }
  return pts;
}

/** Oldest retired first; the population never grows past the cap. */
export function settlePopulation<T>(list: T[], max = MAX_CHAINS): T[] {
  return list.length <= max ? list : list.slice(list.length - max);
}
