/**
 * Stoichiometry — the consumption resolver for /molecules.
 *
 * Given the pair a ceremony joined, the multiset of species standing in the
 * neighborhood, and a curated reaction set (src/lib/chemistry.ts REACTIONS),
 * decide which equation fires and exactly what is consumed and produced —
 * one stoichiometric unit, to the atom. The law it pins: an equation fires
 * only when the neighborhood truly holds every reactant it names (2 H₂ near
 * 1 O₂ genuinely yields two waters; 1 H₂ near 1 O₂ does not — the room
 * falls back to the kernel's deterministic product, as before). Matching is
 * order-independent: resolve(a, b) === resolve(b, a), the same fate
 * whichever molecule the ceremony began on.
 *
 * Pure and import-free by law: no DOM, no audio, no side effects — the
 * reaction table arrives as an argument, so this file is node-testable
 * standalone (scripts/test-stoichiometry.mjs). The room that acts on these
 * resolutions (MoleculesField) owns canvas, sound, and haptics.
 */

export type StoichTerm = { key: string; n: number };

export type StoichReaction = {
  /** Reactant multiset: species keys with stoichiometric counts. */
  reactants: ReadonlyArray<StoichTerm>;
  /** Product multiset — balanced against the reactants by the curator. */
  products: ReadonlyArray<StoichTerm>;
  /** Signed energy per equation as written; positive = released. */
  energy: number;
};

export type StoichResolution = {
  /** The equation that fires. */
  reaction: StoichReaction;
  /** Exactly what the neighborhood gives up — one unit of the equation. */
  consumed: ReadonlyArray<StoichTerm>;
  /** Exactly what condenses in return. */
  produced: ReadonlyArray<StoichTerm>;
  /** The equation's signed energy (positive = released). */
  energy: number;
};

/**
 * The reaction the ceremony pair (aKey, bKey) names, if the set holds one —
 * matched on the unordered pair of species: a two-species equation must name
 * exactly {aKey, bKey}; a one-species equation matches only when the pair is
 * two of the same. Null when no equation names the pair.
 */
export function reactionForPair(
  reactions: ReadonlyArray<StoichReaction>,
  aKey: string,
  bKey: string,
): StoichReaction | null {
  for (const r of reactions) {
    const species = new Set(r.reactants.map((t) => t.key));
    const matches =
      aKey === bKey
        ? species.size === 1 && species.has(aKey)
        : species.size === 2 && species.has(aKey) && species.has(bKey);
    if (matches) return r;
  }
  return null;
}

/**
 * Resolve one stoichiometric unit. `available` is the neighborhood census —
 * species key → how many stand near enough to take part (the ceremony pair
 * included). Returns null when no equation names the pair OR when the
 * counts fall short of the equation's demand: a half-met equation never
 * half-fires, and excess beyond one unit is left standing. The consumed and
 * produced multisets are fresh copies, safe to mutate.
 */
export function resolveReaction(
  reactions: ReadonlyArray<StoichReaction>,
  aKey: string,
  bKey: string,
  available: Readonly<Record<string, number>>,
): StoichResolution | null {
  const reaction = reactionForPair(reactions, aKey, bKey);
  if (!reaction) return null;
  for (const term of reaction.reactants) {
    if ((available[term.key] ?? 0) < term.n) return null;
  }
  return {
    reaction,
    consumed: reaction.reactants.map((t) => ({ key: t.key, n: t.n })),
    produced: reaction.products.map((t) => ({ key: t.key, n: t.n })),
    energy: reaction.energy,
  };
}

/**
 * Whether a census can afford one whole unit of an equation. The half-met
 * equation never half-fires: this is the same demand `resolveReaction`
 * makes, factored out so the cascade can ask it of every equation in turn.
 */
export function affordable(
  reaction: StoichReaction,
  available: Readonly<Record<string, number>>,
): boolean {
  for (const term of reaction.reactants) {
    if ((available[term.key] ?? 0) < term.n) return false;
  }
  return true;
}

export type CascadeStep = {
  reaction: StoichReaction;
  consumed: ReadonlyArray<StoichTerm>;
  produced: ReadonlyArray<StoichTerm>;
  energy: number;
};

/**
 * THE CASCADE. Fire everything a population can actually pay for, one
 * equation at a time, feeding each round's products back into the census so
 * a product can go on to be a reactant — which is what a chain reaction IS.
 * Exothermic equations go first: a reaction that releases energy is what
 * lights the next one, and an endothermic step only runs on what is left
 * over. Within equal energy, the order is the reaction set's own, so the
 * whole cascade is deterministic in (reactions, census).
 *
 * The census is never left owing: every step subtracts exactly what it
 * consumes and adds exactly what it produces, so the atom count going in
 * equals the atom count coming out (the equations are balanced by the
 * curator; this file only refuses to run one it cannot pay for). Stops at
 * `maxSteps`, or as soon as nothing standing can afford anything.
 */
export function cascade(
  reactions: ReadonlyArray<StoichReaction>,
  census: Readonly<Record<string, number>>,
  maxSteps = 12,
): { steps: CascadeStep[]; remaining: Record<string, number>; energy: number } {
  const remaining: Record<string, number> = { ...census };
  const order = [...reactions].sort((a, b) => b.energy - a.energy);
  const steps: CascadeStep[] = [];
  let energy = 0;
  for (let i = 0; i < maxSteps; i++) {
    const next = order.find((r) => affordable(r, remaining));
    if (!next) break;
    for (const t of next.reactants) remaining[t.key] = (remaining[t.key] ?? 0) - t.n;
    for (const t of next.products) remaining[t.key] = (remaining[t.key] ?? 0) + t.n;
    steps.push({
      reaction: next,
      consumed: next.reactants.map((t) => ({ key: t.key, n: t.n })),
      produced: next.products.map((t) => ({ key: t.key, n: t.n })),
      energy: next.energy,
    });
    energy += next.energy;
  }
  return { steps, remaining, energy };
}
