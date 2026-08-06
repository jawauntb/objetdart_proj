/**
 * Botany — the flora latent (W4, INSPIRATION.md §6).
 *
 * A compact 32-dim latent in [0,1], decoded deterministically from a numeric
 * seed, IS a species: phyllotaxis counts (fibonacci-adjacent), a petal
 * silhouette (bézier profile), a small L-system stem habit, a palette drawn
 * only from the site's token families (candle golds, merlot, sea teals,
 * parchment — no rainbow), and a phenology envelope (bud → bloom → close).
 *
 * Pure and import-free by law: same seed = same flower, forever. No DOM, no
 * audio, no side effects — this file only maps numbers to structure, so it is
 * node-testable standalone (scripts/test-botany.mjs). The room that renders
 * these (FlowersGarden) owns canvas, sound, and haptics.
 */

export const LATENT_DIM = 32;

/** Phenophase at which openness peaks; past it the flower begins to close. */
export const BLOOM_PEAK = 0.72;

/** Hard bound on turtle segments any decoded species may produce. */
export const LSYSTEM_SEGMENT_CAP = 240;

export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const FIB_PETALS = [5, 8, 13, 21] as const;
const FIB_FLORETS = [8, 13, 21, 34] as const;

/**
 * The only colors a species may wear — ramps around the site tokens
 * (--candle #C8732A, --closed #7A1F1F, --sea #2C4A5C, --paper #F2EEE6,
 * --kept #6E5A2E), each family ordered dark → light. Test law: every palette
 * entry of every species must fall inside these families' hue windows.
 */
export const PALETTE_FAMILIES = {
  gold: ["#9C5820", "#B36524", "#C8732A", "#DA8F3B", "#E7AC52", "#F2C56B"],
  merlot: ["#4F1414", "#5E1717", "#7A1F1F", "#8E2B2B", "#9C3D33", "#B25048"],
  sea: ["#1E3440", "#243D4A", "#2C4A5C", "#3A6172", "#4E7D8C", "#6997A4"],
  parchment: ["#B8A87F", "#CFC2A6", "#DDD3BE", "#E8E2D5", "#F2EEE6", "#F7F3EA"],
} as const;

// ————————————————————————— types —————————————————————————

export type PetalProfile = {
  /** Petal length relative to head radius, 0.7..1.5. */
  length: number;
  /** Half-width relative to length, 0.2..0.48. */
  width: number;
  /** 0 = pointed tip, 1 = rounded. */
  tip: number;
  /** Outward curl of the silhouette's shoulders. */
  curl: number;
  /** Pinch near the base, 0.1..0.6. */
  waist: number;
};

export type LSystem = {
  axiom: string;
  rules: Record<string, string>;
  /** Expansion depth, 2..4. */
  depth: number;
  /** Branch turn, degrees. */
  angleDeg: number;
  /** Unit length per F, relative to plant height. */
  segment: number;
};

export type SpeciesPalette = {
  petal: string;
  petalDeep: string;
  heart: string;
  stem: string;
  leaf: string;
  glow: string;
};

export type Phenology = {
  /** >1 slows the bud's first opening (power curve exponent). */
  budBias: number;
  /** Shape of the closing curve past BLOOM_PEAK. */
  closeEase: number;
  /** How far the flower folds back at phenophase 1 (0.5..0.85). */
  closeDepth: number;
};

export type Species = {
  seed: number;
  latent: number[];
  /** Petals per whorl — fibonacci-adjacent. */
  petals: number;
  /** Center florets, laid on the golden angle. */
  florets: number;
  /** Petal whorls, 1..3. */
  layers: number;
  petal: PetalProfile;
  lsystem: LSystem;
  palette: SpeciesPalette;
  phenology: Phenology;
  /** 0 solitary · 1 branching · 2 spray. */
  habit: 0 | 1 | 2;
  /** Plant height, 0.55..1 (unit space). */
  height: number;
  /** Heart radius relative to head radius, 0.26..0.48. */
  heartR: number;
  swayStiffness: number;
  breathDepth: number;
};

export type Pt = { x: number; y: number };
export type StemPath = { pts: Pt[]; width: number };
export type Leaf = { x: number; y: number; angle: number; size: number };
export type Head = { x: number; y: number; angle: number; scale: number };
export type PetalGeom = {
  angle: number;
  layer: number;
  /** 0 folded bud .. 1 fully spread. */
  splay: number;
  /** Absolute petal length, unit space. */
  length: number;
  /** Absolute petal half-width, unit space. */
  width: number;
};
export type Floret = { x: number; y: number; r: number };

/**
 * Renderable plant data at one phenophase. Plain data, unit space: stem base
 * at (0,0), up is -y, a full-grown plant stands ~`height` units tall.
 */
export type FlowerGeometry = {
  openness: number;
  growth: number;
  stems: StemPath[];
  leaves: Leaf[];
  /** heads[0] is the primary crown; the rest are side crowns (habit 1|2). */
  heads: Head[];
  /** Petal fan of the primary head; side crowns reuse it scaled. */
  petals: PetalGeom[];
  /** Head-local floret lattice (golden-angle phyllotaxis). */
  florets: Floret[];
  headRadius: number;
  heartRadius: number;
  segmentCount: number;
};

// —————————————————— hashing / prng (inline, no deps) ——————————————————

function mix32(h: number): number {
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

/** The species' point in latent space: LATENT_DIM values in [0,1). */
export function latentFromSeed(seed: number): number[] {
  const rng = mulberry32(mix32((seed >>> 0) || 1));
  const l: number[] = new Array(LATENT_DIM);
  for (let i = 0; i < LATENT_DIM; i++) l[i] = rng();
  return l;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smoothstep = (u: number) => u * u * (3 - 2 * u);
const pick = <T,>(arr: readonly T[], u: number): T =>
  arr[Math.min(arr.length - 1, Math.floor(clamp01(u) * arr.length))];

// —————————————————————— the decoder ——————————————————————

// Stem habits. Turtle alphabet: F forward · +/- turn · [ ] branch push/pop ·
// L leaf · A crown. S is the growth bud (nonterminal, silent to the turtle).
const HABITS: ReadonlyArray<{ axiom: string; rules: Record<string, string> }> = [
  { axiom: "FSA", rules: { S: "FF[+L]S" } }, // solitary — one tall crown
  { axiom: "FSA", rules: { S: "F[+FLA][-L]FS" } }, // branching — side crowns
  { axiom: "FFS", rules: { S: "F[+FSA][-FSA]" } }, // spray — a candelabra
];

/** Decode a seed into a complete species. Pure; same seed = same flower. */
export function speciesFromSeed(seed: number): Species {
  return speciesFromLatent(latentFromSeed(seed), seed);
}

/**
 * Decode an ARBITRARY point in latent space into a species. `speciesFromSeed`
 * is this with the latent drawn from a seed; a crossed latent (see
 * `crossLatent`) comes through the same decoder, which is what makes a
 * child of two plants a real flower rather than a blend of two pictures.
 */
export function speciesFromLatent(latent: number[], seed: number): Species {
  const l = latent;

  const petals = pick(FIB_PETALS, l[0]);
  const florets = pick(FIB_FLORETS, l[1]);
  const layers = 1 + Math.floor(l[2] * 2.9999);

  const petal: PetalProfile = {
    length: 0.7 + l[3] * 0.8,
    width: 0.2 + l[4] * 0.28,
    tip: l[5],
    curl: l[6],
    waist: 0.1 + l[7] * 0.5,
  };

  const habit = Math.floor(l[8] * 2.9999) as 0 | 1 | 2;
  let depth = 2 + Math.floor(l[9] * 2.9999);
  if (habit === 2) depth = Math.min(depth, 3); // sprays double per level
  const lsystem: LSystem = {
    axiom: HABITS[habit].axiom,
    rules: HABITS[habit].rules,
    depth,
    angleDeg: 14 + l[10] * 24,
    segment: 0.1 + l[11] * 0.06,
  };

  const { gold, merlot, sea, parchment } = PALETTE_FAMILIES;
  const petalFam = l[12] < 0.34 ? gold : l[12] < 0.62 ? merlot : l[12] < 0.86 ? parchment : sea;
  const palette: SpeciesPalette = {
    petal: petalFam[3 + Math.floor(l[13] * 2.9999)],
    petalDeep: petalFam[Math.floor(l[14] * 2.9999)],
    heart: gold[2 + Math.floor(l[15] * 3.9999)],
    stem: sea[1 + Math.floor(l[16] * 2.9999)],
    leaf: sea[2 + Math.floor(l[26] * 2.9999)],
    glow: parchment[2 + Math.floor(l[17] * 3.9999)],
  };

  const phenology: Phenology = {
    budBias: 1.2 + l[18] * 1.4,
    closeEase: 1.2 + l[19] * 1.6,
    closeDepth: 0.5 + l[20] * 0.35,
  };

  return {
    seed: (seed >>> 0) || 1,
    latent: l,
    petals,
    florets,
    layers,
    petal,
    lsystem,
    palette,
    phenology,
    habit,
    height: 0.55 + l[21] * 0.45,
    heartR: 0.26 + l[24] * 0.22,
    swayStiffness: 0.3 + l[22] * 0.6,
    breathDepth: 0.4 + l[23] * 0.6,
  };
}

// —————————————————— crossing, light, and root space ——————————————————

/** How often a locus mutates when pollen actually lands. Small, and real. */
export const DRIFT_RATE = 0.06;

/**
 * Meiosis, then fertilisation: the child takes each locus from ONE parent or
 * the other — independent assortment, not an average. Averaging is the bug
 * this shape exists to avoid: every cross would land in the middle of latent
 * space and a garden would go beige in three generations. With `drift` at 0
 * a plant crossed with itself reproduces itself exactly; above 0, a few loci
 * mutate, which is where new form comes from.
 */
export function crossLatent(a: number[], b: number[], seed: number, drift = DRIFT_RATE): number[] {
  const n = Math.min(a.length, b.length);
  const rng = mulberry32(mix32((seed >>> 0) || 1));
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const fromA = rng() < 0.5;
    let v = fromA ? a[i] : b[i];
    if (rng() < drift) v = clamp01(v + (rng() - 0.5) * 0.5);
    out[i] = clamp01(v);
  }
  return out;
}

/** How wide a plant's canopy reaches, as a fraction of the garden's width. */
export function canopySpread(sp: Species): number {
  return 0.06 + sp.height * 0.1 + sp.heartR * 0.14;
}

/**
 * The light a neighbour takes. Shade is one-directional: only a TALLER plant
 * shades a shorter one, and only inside its canopy. A symmetric falloff here
 * would have a seedling shading the tree above it, which is exactly the
 * mistake that makes a "competing" garden look like mutual repulsion.
 * Returns 0..1 of the light lost.
 */
export function shadeFrom(myHeight: number, otherHeight: number, dx: number, spread: number): number {
  if (!(otherHeight > myHeight)) return 0;
  const d = Math.abs(dx);
  if (!(spread > 0) || d >= spread) return 0;
  const over = clamp01((otherHeight - myHeight) / Math.max(1e-6, otherHeight));
  return clamp01((1 - d / spread) * over);
}

/**
 * How much of two root discs overlap, 0..1 of the smaller one's area — the
 * exact lens area of two circles, so touching rims read as 0 and a coincident
 * pair as 1, with everything between continuous.
 */
export function rootOverlap(dx: number, ra: number, rb: number): number {
  const d = Math.abs(dx);
  if (!(ra > 0) || !(rb > 0)) return 0;
  if (d >= ra + rb) return 0;
  const rMin = Math.min(ra, rb);
  if (d <= Math.abs(ra - rb)) return 1; // one disc entirely inside the other
  const r1 = ra;
  const r2 = rb;
  const a1 = Math.acos(clampTo((d * d + r1 * r1 - r2 * r2) / (2 * d * r1), -1, 1));
  const a2 = Math.acos(clampTo((d * d + r2 * r2 - r1 * r1) / (2 * d * r2), -1, 1));
  const area =
    r1 * r1 * (a1 - Math.sin(2 * a1) / 2) + r2 * r2 * (a2 - Math.sin(2 * a2) / 2);
  return clamp01(area / (Math.PI * rMin * rMin));
}

function clampTo(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

/** Commit the in-progress turtle path to `stems` if it has any length. */
function flushStemPath(stems: StemPath[], path: Pt[], pathW: number): void {
  if (path.length > 1) stems.push({ pts: path, width: pathW });
}

/**
 * A plant's vigour, 0..1: what is left of it after the light its neighbours
 * take and the root space they share. This is the number a garden competes
 * over — it drives growth, bloom, and whether a crowded seedling makes it.
 */
export function vigour(light: number, rootShare: number): number {
  return clamp01(clamp01(light) * (1 - clamp01(rootShare) * 0.6));
}

/**
 * Openness through the life of a hold: monotone rise from bud (0) to full
 * bloom at BLOOM_PEAK, then a fold back toward (1 - closeDepth) at 1.
 */
export function phenologyOpenness(sp: Species, phenophase: number): number {
  const p = clamp01(phenophase);
  if (p <= BLOOM_PEAK) {
    const u = p / BLOOM_PEAK;
    return smoothstep(Math.pow(u, sp.phenology.budBias));
  }
  const v = (p - BLOOM_PEAK) / (1 - BLOOM_PEAK);
  return 1 - Math.pow(v, sp.phenology.closeEase) * sp.phenology.closeDepth;
}

// Expansion depends only on the LSystem's own fields, which never mutate
// once a species is decoded (`lsystem` is never reassigned in this module).
// Callers on a render loop (flowerGeometry) pass the same `sp.lsystem`
// object every frame as phenophase alone advances, so this cache turns a
// repeated string-rewrite into a one-time cost per species.
const lsystemExpansionCache = new WeakMap<LSystem, string>();

/** Expand the species' L-system to its final token string. */
export function expandLSystem(ls: LSystem): string {
  const cached = lsystemExpansionCache.get(ls);
  if (cached !== undefined) return cached;
  let s = ls.axiom;
  for (let i = 0; i < ls.depth; i++) {
    let next = "";
    for (const ch of s) next += ls.rules[ch] ?? ch;
    s = next;
    if (s.length > 8192) break; // never let a hostile rule set run away
  }
  lsystemExpansionCache.set(ls, s);
  return s;
}

/**
 * Half-outline of a petal in normalized local coords (base at 0,0, tip at
 * (·,-1), x in half-widths). Renderer mirrors across x=0, scaling x by
 * `width` and y by `length` from PetalGeom.
 */
export function petalOutline(pp: PetalProfile): { c1: Pt; c2: Pt; tip: Pt } {
  return {
    c1: { x: 0.55 - pp.waist * 0.4 + pp.curl * 0.25, y: -0.2 },
    c2: { x: 0.18 + pp.tip * 0.5 + pp.curl * 0.12, y: -0.78 - pp.tip * 0.12 },
    tip: { x: 0, y: -1 },
  };
}

/**
 * Decode a species at one phenophase into renderable data. Pure: the turtle's
 * jitter comes from a PRNG reseeded from the species seed each call, and is
 * consumed in an order independent of phenophase — so the plant's skeleton is
 * stable while its lengths and petals unfold.
 */
export function flowerGeometry(sp: Species, phenophase: number): FlowerGeometry {
  const p = clamp01(phenophase);
  const openness = phenologyOpenness(sp, p);
  const growth = 0.14 + 0.86 * smoothstep(clamp01(p / 0.38));
  const rng = mulberry32(mix32(sp.seed ^ 0x5f356495));

  const tokens = expandLSystem(sp.lsystem);
  const angleRad = (sp.lsystem.angleDeg * Math.PI) / 180;
  const seg = sp.lsystem.segment * sp.height * growth;

  type TState = { x: number; y: number; ang: number; w: number; scale: number };
  let st: TState = { x: 0, y: 0, ang: -Math.PI / 2, w: 1, scale: 1 };
  const stack: TState[] = [];
  const stems: StemPath[] = [];
  const leaves: Leaf[] = [];
  const heads: Head[] = [];
  let path: Pt[] = [{ x: 0, y: 0 }];
  let pathW = 1;
  let segments = 0;
  let leafCount = 0;
  let branchFlip = 1;

  for (const ch of tokens) {
    if (ch === "F") {
      st.ang += (rng() - 0.5) * 0.14; // grain
      st.ang += (-Math.PI / 2 - st.ang) * 0.05; // phototropism
      st.x += Math.cos(st.ang) * seg * st.scale;
      st.y += Math.sin(st.ang) * seg * st.scale;
      path.push({ x: st.x, y: st.y });
      segments++;
      if (segments >= LSYSTEM_SEGMENT_CAP) break;
    } else if (ch === "+" || ch === "-") {
      const dir = (ch === "+" ? 1 : -1) * branchFlip;
      st.ang += dir * angleRad * (0.8 + rng() * 0.4);
    } else if (ch === "[") {
      stack.push({ ...st });
      flushStemPath(stems, path, pathW);
      branchFlip = -branchFlip;
      st.w *= 0.66;
      st.scale *= 0.72;
      path = [{ x: st.x, y: st.y }];
      pathW = st.w;
    } else if (ch === "]") {
      flushStemPath(stems, path, pathW);
      st = stack.pop() ?? st;
      path = [{ x: st.x, y: st.y }];
      pathW = st.w;
    } else if (ch === "L") {
      leafCount++;
      leaves.push({
        x: st.x,
        y: st.y,
        angle: st.ang + (leafCount % 2 ? 1 : -1) * 1.1,
        size: seg * (1.1 + rng() * 0.6) * st.scale,
      });
    } else if (ch === "A") {
      heads.push({ x: st.x, y: st.y, angle: st.ang, scale: st.scale });
    }
    // S and anything else are silent.
  }
  flushStemPath(stems, path, pathW);
  if (heads.length === 0) heads.push({ x: st.x, y: st.y, angle: st.ang, scale: 1 });
  // Primary crown first: the one still carrying the main axis' scale.
  heads.sort((a, b) => b.scale - a.scale);

  const headRadius = 0.13 * sp.height * (0.55 + 0.45 * growth);
  const heartRadius = headRadius * sp.heartR;

  const petals: PetalGeom[] = [];
  for (let k = 0; k < sp.layers; k++) {
    const layerScale = 1 - k * 0.16;
    const splay = clamp01(openness * 1.15 - k * 0.12);
    for (let i = 0; i < sp.petals; i++) {
      petals.push({
        angle: (i / sp.petals) * Math.PI * 2 + k * (Math.PI / sp.petals),
        layer: k,
        splay,
        length: headRadius * sp.petal.length * layerScale * (0.3 + 0.7 * splay),
        width: headRadius * sp.petal.length * sp.petal.width * layerScale * (0.45 + 0.55 * splay),
      });
    }
  }

  const florets: Floret[] = [];
  for (let i = 0; i < sp.florets; i++) {
    const r = heartRadius * Math.sqrt((i + 0.5) / sp.florets);
    const a = i * GOLDEN_ANGLE;
    florets.push({
      x: Math.cos(a) * r,
      y: Math.sin(a) * r,
      r: heartRadius * (0.14 + 0.08 * (1 - i / sp.florets)),
    });
  }

  return {
    openness,
    growth,
    stems,
    leaves,
    heads,
    petals,
    florets,
    headRadius,
    heartRadius,
    segmentCount: segments,
  };
}
