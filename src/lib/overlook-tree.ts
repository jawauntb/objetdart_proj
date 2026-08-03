/**
 * overlook-tree — the album's whole tree, derived structurally from the
 * travel graph (plan W8). Pure and import-free: the graph arrives as
 * arguments — the band registry and the canonical-neighbor function — so
 * the derivation is a pure function of the cosmology. Change a door in
 * lib/scale.ts and /overlook redraws itself; nothing here is hardcoded.
 *
 * The law: the trunk is the canonical chain walked upward from the
 * smallest band (each step is neighbor(id, +1)); every band not on that
 * chain is a branch, attached where its own outward door opens — exactly
 * the reverse-pointer rule that makes it a fork door in travel (flowers
 * hang off the earth, the earth off the atlas, beyond off the fold).
 * Pinned in scripts/test-overlook.mjs against the live graph and stubs.
 */

export type OverlookBand = {
  id: string;
  label: string;
  route: string | null;
  /** log10 meters, inclusive. */
  sMin: number;
  /** log10 meters, exclusive (except the last band). */
  sMax: number;
};

/** travelNeighbor's shape, widened to plain strings so stubs stay easy. */
export type NeighborFn = (id: string, dir: -1 | 1) => string | null;

export type OverlookNode = {
  id: string;
  label: string;
  route: string | null;
  /** Band center, log10 meters — the node's true height on the axis. */
  s: number;
  sMin: number;
  sMax: number;
  onTrunk: boolean;
  /** Branch attachment (null on the trunk): where the outward door opens. */
  parent: string | null;
  /** 0 on the trunk; 1 + the parent's depth off it. */
  depth: number;
  /** Axis order across the whole tree, small → large (the tutti's order). */
  order: number;
};

export type OverlookEdge = { a: string; b: string; trunk: boolean };

export type OverlookTree = {
  /** Canonical chain, small → large. */
  trunk: string[];
  /** Every band exactly once, axis-ordered. */
  nodes: OverlookNode[];
  /** Every door once, undirected. */
  edges: OverlookEdge[];
};

export function deriveTree(bands: OverlookBand[], neighbor: NeighborFn): OverlookTree {
  if (bands.length === 0) return { trunk: [], nodes: [], edges: [] };
  const byId = new Map<string, OverlookBand>();
  for (const b of bands) byId.set(b.id, b);

  // The trunk: follow the canonical upward door from the smallest band.
  // A revisit or an unknown id ends the walk — the chain never loops.
  const trunk: string[] = [];
  const onTrunk = new Set<string>();
  let cursor: string | null = bands[0].id;
  while (cursor && byId.has(cursor) && !onTrunk.has(cursor)) {
    trunk.push(cursor);
    onTrunk.add(cursor);
    cursor = neighbor(cursor, 1);
  }

  // Branches: attached where the outward door opens (the fork-door rule:
  // travel's structuralDoors offers a band wherever a neighbor's opposite
  // door points back at it). The inward door is the fallback at the top.
  const parentOf = new Map<string, string | null>();
  for (const b of bands) {
    if (onTrunk.has(b.id)) {
      parentOf.set(b.id, null);
      continue;
    }
    const up = neighbor(b.id, 1);
    const down = neighbor(b.id, -1);
    const upOk = up !== null && up !== b.id && byId.has(up) ? up : null;
    const downOk = down !== null && down !== b.id && byId.has(down) ? down : null;
    parentOf.set(b.id, upOk ?? downOk);
  }

  const depthOf = (id: string): number => {
    let d = 0;
    let at: string | null = id;
    const seen = new Set<string>();
    while (at !== null && !onTrunk.has(at) && !seen.has(at) && d <= bands.length) {
      seen.add(at);
      at = parentOf.get(at) ?? null;
      d += 1;
    }
    return d;
  };

  // Axis order: small → large by band floor (ties break lexically so the
  // ordering is total and deterministic for any stub graph).
  const ordered = [...bands].sort((p, q) => p.sMin - q.sMin || (p.id < q.id ? -1 : 1));
  const nodes: OverlookNode[] = ordered.map((b, i) => ({
    id: b.id,
    label: b.label,
    route: b.route,
    s: (b.sMin + b.sMax) / 2,
    sMin: b.sMin,
    sMax: b.sMax,
    onTrunk: onTrunk.has(b.id),
    parent: parentOf.get(b.id) ?? null,
    depth: onTrunk.has(b.id) ? 0 : depthOf(b.id),
    order: i,
  }));

  // Every door once, undirected; a trunk edge is a consecutive chain step.
  const trunkStep = new Set<string>();
  for (let i = 1; i < trunk.length; i++) trunkStep.add(`${trunk[i - 1]}|${trunk[i]}`);
  const edges: OverlookEdge[] = [];
  const seenEdge = new Set<string>();
  const addEdge = (a: string | null, b: string) => {
    if (a === null || a === b || !byId.has(a) || !byId.has(b)) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seenEdge.has(key)) return;
    seenEdge.add(key);
    edges.push({ a, b, trunk: trunkStep.has(`${a}|${b}`) || trunkStep.has(`${b}|${a}`) });
  };
  for (const b of bands) {
    addEdge(neighbor(b.id, 1), b.id);
    addEdge(neighbor(b.id, -1), b.id);
  }

  return { trunk, nodes, edges };
}

export type OverlookPlacement = { x: number; y: number };

/**
 * Deterministic normalized placement: the trunk stands on x = 0 with y set
 * by each band's true log10 center (0 at the smallest band, 1 at the
 * largest — the overlook never lies about the axis); branch subtrees lean
 * out by depth, sides alternating in axis order of their trunk attachment,
 * descendants keeping their root's side.
 */
export function layoutTree(tree: OverlookTree): Record<string, OverlookPlacement> {
  const byId = new Map(tree.nodes.map((n) => [n.id, n] as const));
  let sLo = Infinity;
  let sHi = -Infinity;
  for (const n of tree.nodes) {
    sLo = Math.min(sLo, n.s);
    sHi = Math.max(sHi, n.s);
  }
  const span = sHi - sLo || 1;

  // Subtree roots: branch nodes attached directly to the trunk, met in
  // axis order, leaning left first — the same sides every visit, forever.
  const sideOfRoot = new Map<string, number>();
  let lean = -1;
  for (const n of tree.nodes) {
    if (!n.onTrunk && n.parent !== null && byId.get(n.parent)?.onTrunk) {
      sideOfRoot.set(n.id, lean);
      lean = -lean;
    }
  }
  const sideOf = (id: string): number => {
    let at = byId.get(id);
    const seen = new Set<string>();
    while (at && !at.onTrunk && !seen.has(at.id)) {
      const rooted = sideOfRoot.get(at.id);
      if (rooted !== undefined) return rooted;
      seen.add(at.id);
      at = at.parent !== null ? byId.get(at.parent) : undefined;
    }
    return 1; // an orphaned branch still leans somewhere, deterministically
  };

  const out: Record<string, OverlookPlacement> = {};
  for (const n of tree.nodes) {
    out[n.id] = {
      x: n.onTrunk ? 0 : sideOf(n.id) * n.depth,
      y: (n.s - sLo) / span,
    };
  }
  return out;
}
