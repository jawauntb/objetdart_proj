/**
 * Travel-passage specs — pure data + resolution.
 *
 * The film renderer and the host bus live in `TravelPassage.tsx`; this module
 * owns which edge gets which film, and the law that every edge resolves to
 * one (registered trunk or the shared default). Node-testable.
 */

import { SCALE_BANDS, type ScaleBand, type ScaleBandId } from "@/lib/scale";

export type PassageEdgeKey =
  | "atlas->stars"
  | "stars->atlas"
  | "stars->galaxy"
  | "galaxy->stars"
  | "galaxy->space"
  | "space->galaxy"
  | "earth->planets"
  | "planets->earth"
  | "planets->solar"
  | "solar->planets"
  | "planets->stars"
  | "stars->planets"
  | "solar->stars"
  | "stars->solar"
  | "olympus->atmosphere"
  | "atmosphere->olympus"
  | "atmosphere->atlas"
  | "atlas->atmosphere"
  | "coast->olympus"
  | "olympus->coast"
  | "earth->flowers"
  | "flowers->earth"
  | "atlas->earth"
  | "earth->atlas"
  | "earth->coast"
  | "coast->earth"
  | "space->manifold"
  | "manifold->space";

export type PassageFilm =
  | "planet"
  | "arm"
  | "node"
  | "beads"
  | "orbitfall"
  | "sunfall"
  | "peakair"
  | "airmap"
  | "fogclimb"
  | "garden"
  | "chartland"
  | "strand"
  | "fold";

export type PassageSpec = {
  durationMs: number;
  reducedMs: number;
  navigateAt: number;
  bellAt: number;
  detentAt: number;
  out: boolean;
  film?: PassageFilm;
};

/**
 * Soft film for every unregistered edge — breath + navigate mid-passage.
 * Richer trunk films stay in PASSAGES; this is the law that no travel hard-cuts.
 */
export const DEFAULT_PASSAGE: Omit<PassageSpec, "out"> = {
  durationMs: 2400,
  reducedMs: 900,
  navigateAt: 0.5,
  bellAt: 0.38,
  detentAt: 0.58,
};

export const PASSAGES: Partial<Record<PassageEdgeKey, PassageSpec>> = {
  "olympus->atmosphere": {
    durationMs: 3200,
    reducedMs: 1100,
    navigateAt: 0.55,
    bellAt: 0.46,
    detentAt: 0.62,
    out: true,
    film: "peakair",
  },
  "atmosphere->olympus": {
    durationMs: 3200,
    reducedMs: 1100,
    navigateAt: 0.45,
    bellAt: 0.56,
    detentAt: 0.3,
    out: false,
    film: "peakair",
  },
  "atmosphere->atlas": {
    durationMs: 3200,
    reducedMs: 1100,
    navigateAt: 0.55,
    bellAt: 0.72,
    detentAt: 0.62,
    out: true,
    film: "airmap",
  },
  "atlas->atmosphere": {
    durationMs: 3200,
    reducedMs: 1100,
    navigateAt: 0.45,
    bellAt: 0.32,
    detentAt: 0.3,
    out: false,
    film: "airmap",
  },
  "earth->planets": {
    durationMs: 3200,
    reducedMs: 1200,
    navigateAt: 0.52,
    bellAt: 0.44,
    detentAt: 0.6,
    out: true,
    film: "beads",
  },
  "planets->earth": {
    durationMs: 3200,
    reducedMs: 1200,
    navigateAt: 0.45,
    bellAt: 0.52,
    detentAt: 0.3,
    out: false,
    film: "beads",
  },
  "planets->solar": {
    durationMs: 3200,
    reducedMs: 1200,
    navigateAt: 0.52,
    bellAt: 0.58,
    detentAt: 0.66,
    out: true,
    film: "orbitfall",
  },
  "solar->planets": {
    durationMs: 3200,
    reducedMs: 1200,
    navigateAt: 0.45,
    bellAt: 0.4,
    detentAt: 0.3,
    out: false,
    film: "orbitfall",
  },
  "planets->stars": {
    durationMs: 3200,
    reducedMs: 1200,
    navigateAt: 0.52,
    bellAt: 0.58,
    detentAt: 0.66,
    out: true,
    film: "orbitfall",
  },
  "stars->planets": {
    durationMs: 3200,
    reducedMs: 1200,
    navigateAt: 0.45,
    bellAt: 0.4,
    detentAt: 0.3,
    out: false,
    film: "orbitfall",
  },
  "atlas->stars": {
    durationMs: 3500,
    reducedMs: 1200,
    navigateAt: 0.55,
    bellAt: 0.4,
    detentAt: 0.62,
    out: true,
  },
  "stars->atlas": {
    durationMs: 3500,
    reducedMs: 1200,
    navigateAt: 0.45,
    bellAt: 0.5,
    detentAt: 0.28,
    out: false,
  },
  "stars->galaxy": {
    durationMs: 3600,
    reducedMs: 1200,
    navigateAt: 0.55,
    bellAt: 0.5,
    detentAt: 0.62,
    out: true,
    film: "arm",
  },
  "galaxy->stars": {
    durationMs: 3600,
    reducedMs: 1200,
    navigateAt: 0.45,
    bellAt: 0.52,
    detentAt: 0.3,
    out: false,
    film: "arm",
  },
  "galaxy->space": {
    durationMs: 3600,
    reducedMs: 1200,
    navigateAt: 0.55,
    bellAt: 0.62,
    detentAt: 0.7,
    out: true,
    film: "node",
  },
  "space->galaxy": {
    durationMs: 3600,
    reducedMs: 1200,
    navigateAt: 0.45,
    bellAt: 0.42,
    detentAt: 0.3,
    out: false,
    film: "node",
  },
  "solar->stars": {
    durationMs: 3200,
    reducedMs: 1200,
    navigateAt: 0.55,
    bellAt: 0.42,
    detentAt: 0.64,
    out: true,
    film: "sunfall",
  },
  "stars->solar": {
    durationMs: 3200,
    reducedMs: 1200,
    navigateAt: 0.45,
    bellAt: 0.52,
    detentAt: 0.3,
    out: false,
    film: "sunfall",
  },
  // ——— High-traffic ground / vista / ceiling edges ———
  "coast->olympus": {
    durationMs: 3000,
    reducedMs: 1100,
    navigateAt: 0.52,
    bellAt: 0.44,
    detentAt: 0.6,
    out: true,
    film: "fogclimb",
  },
  "olympus->coast": {
    durationMs: 3000,
    reducedMs: 1100,
    navigateAt: 0.45,
    bellAt: 0.52,
    detentAt: 0.3,
    out: false,
    film: "fogclimb",
  },
  "earth->flowers": {
    durationMs: 3000,
    reducedMs: 1100,
    navigateAt: 0.48,
    bellAt: 0.4,
    detentAt: 0.58,
    out: false,
    film: "garden",
  },
  "flowers->earth": {
    durationMs: 3000,
    reducedMs: 1100,
    navigateAt: 0.52,
    bellAt: 0.56,
    detentAt: 0.32,
    out: true,
    film: "garden",
  },
  "atlas->earth": {
    durationMs: 3200,
    reducedMs: 1100,
    navigateAt: 0.52,
    bellAt: 0.42,
    detentAt: 0.6,
    out: true,
    film: "chartland",
  },
  "earth->atlas": {
    durationMs: 3200,
    reducedMs: 1100,
    navigateAt: 0.45,
    bellAt: 0.54,
    detentAt: 0.3,
    out: false,
    film: "chartland",
  },
  "earth->coast": {
    durationMs: 3000,
    reducedMs: 1100,
    navigateAt: 0.48,
    bellAt: 0.4,
    detentAt: 0.58,
    out: false,
    film: "strand",
  },
  "coast->earth": {
    durationMs: 3000,
    reducedMs: 1100,
    navigateAt: 0.52,
    bellAt: 0.56,
    detentAt: 0.32,
    out: true,
    film: "strand",
  },
  "space->manifold": {
    durationMs: 3400,
    reducedMs: 1200,
    navigateAt: 0.55,
    bellAt: 0.48,
    detentAt: 0.64,
    out: true,
    film: "fold",
  },
  "manifold->space": {
    durationMs: 3400,
    reducedMs: 1200,
    navigateAt: 0.45,
    bellAt: 0.52,
    detentAt: 0.3,
    out: false,
    film: "fold",
  },
};

/** Resolve the film for an edge: registered PASSAGES win; else the default. */
export function resolvePassageSpec(from: ScaleBandId, dest: ScaleBand): PassageSpec {
  const registered = PASSAGES[`${from}->${dest.id}` as PassageEdgeKey];
  if (registered) return registered;
  const fromBand = SCALE_BANDS.find((b) => b.id === from);
  const fromMid = fromBand ? (fromBand.sMin + fromBand.sMax) / 2 : dest.sMin;
  const destMid = (dest.sMin + dest.sMax) / 2;
  return { ...DEFAULT_PASSAGE, out: destMid >= fromMid };
}
