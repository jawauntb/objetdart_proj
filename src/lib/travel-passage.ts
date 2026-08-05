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
  | "manifold->space"
  // ——— The small-scale spine, quanta → drop (both directions) ———
  | "quanta->quarks"
  | "quarks->quanta"
  | "quarks->nucleons"
  | "nucleons->quarks"
  | "nucleons->atoms"
  | "atoms->nucleons"
  | "atoms->molecules"
  | "molecules->atoms"
  | "molecules->organics"
  | "organics->molecules"
  | "organics->dna"
  | "dna->organics"
  | "dna->organelles"
  | "organelles->dna"
  | "organelles->cells"
  | "cells->organelles"
  | "cells->tissue"
  | "tissue->cells"
  | "tissue->drop"
  | "drop->tissue"
  // ——— The living middle and the top of the axis (both directions) ———
  | "tissue->flowers"
  | "flowers->tissue"
  | "drop->coast"
  | "coast->drop"
  | "drop->flowers"
  | "flowers->drop"
  | "flowers->birds"
  | "birds->flowers"
  | "birds->coast"
  | "coast->birds"
  | "olympus->earth"
  | "earth->olympus"
  | "space->beyond"
  | "beyond->space"
  | "beyond->manifold"
  | "manifold->beyond";

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
  | "fold"
  // ——— The small-scale spine ———
  | "quantum"
  | "confine"
  | "shell"
  | "bond"
  | "chain"
  | "helix"
  | "chromatin"
  | "membrane"
  | "sheet"
  | "dissolve"
  // ——— The living middle and the top of the axis ———
  | "starchart"
  | "lamina"
  | "tension"
  | "dew"
  | "lift"
  | "shorewing"
  | "massif"
  | "interfere"
  | "curvature";

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
  // The album's busiest hop, and the one that used to play the default
  // planet: a chart of one world re-projected into a sky of many suns.
  "atlas->stars": {
    durationMs: 3500,
    reducedMs: 1200,
    navigateAt: 0.55,
    bellAt: 0.4,
    detentAt: 0.62,
    out: true,
    film: "starchart",
  },
  "stars->atlas": {
    durationMs: 3500,
    reducedMs: 1200,
    navigateAt: 0.45,
    bellAt: 0.5,
    detentAt: 0.28,
    out: false,
    film: "starchart",
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
  // ——— The small-scale spine, quanta → drop ———
  // Quicker than the astronomical trunk: nothing here needs 3.5s to read.
  "quanta->quarks": {
    durationMs: 2200,
    reducedMs: 850,
    navigateAt: 0.5,
    bellAt: 0.42,
    detentAt: 0.6,
    out: true,
    film: "quantum",
  },
  "quarks->quanta": {
    durationMs: 2200,
    reducedMs: 850,
    navigateAt: 0.45,
    bellAt: 0.55,
    detentAt: 0.3,
    out: false,
    film: "quantum",
  },
  "quarks->nucleons": {
    durationMs: 2000,
    reducedMs: 800,
    navigateAt: 0.5,
    bellAt: 0.44,
    detentAt: 0.6,
    out: true,
    film: "confine",
  },
  "nucleons->quarks": {
    durationMs: 2000,
    reducedMs: 800,
    navigateAt: 0.45,
    bellAt: 0.52,
    detentAt: 0.3,
    out: false,
    film: "confine",
  },
  "nucleons->atoms": {
    durationMs: 2450,
    reducedMs: 900,
    navigateAt: 0.5,
    bellAt: 0.4,
    detentAt: 0.62,
    out: true,
    film: "shell",
  },
  "atoms->nucleons": {
    durationMs: 2450,
    reducedMs: 900,
    navigateAt: 0.45,
    bellAt: 0.55,
    detentAt: 0.3,
    out: false,
    film: "shell",
  },
  "atoms->molecules": {
    durationMs: 2150,
    reducedMs: 850,
    navigateAt: 0.5,
    bellAt: 0.46,
    detentAt: 0.62,
    out: true,
    film: "bond",
  },
  "molecules->atoms": {
    durationMs: 2150,
    reducedMs: 850,
    navigateAt: 0.45,
    bellAt: 0.5,
    detentAt: 0.3,
    out: false,
    film: "bond",
  },
  "molecules->organics": {
    durationMs: 2300,
    reducedMs: 880,
    navigateAt: 0.5,
    bellAt: 0.42,
    detentAt: 0.6,
    out: true,
    film: "chain",
  },
  "organics->molecules": {
    durationMs: 2300,
    reducedMs: 880,
    navigateAt: 0.45,
    bellAt: 0.55,
    detentAt: 0.3,
    out: false,
    film: "chain",
  },
  "organics->dna": {
    durationMs: 2500,
    reducedMs: 900,
    navigateAt: 0.5,
    bellAt: 0.42,
    detentAt: 0.62,
    out: true,
    film: "helix",
  },
  "dna->organics": {
    durationMs: 2500,
    reducedMs: 900,
    navigateAt: 0.45,
    bellAt: 0.55,
    detentAt: 0.3,
    out: false,
    film: "helix",
  },
  "dna->organelles": {
    durationMs: 2450,
    reducedMs: 900,
    navigateAt: 0.5,
    bellAt: 0.44,
    detentAt: 0.62,
    out: true,
    film: "chromatin",
  },
  "organelles->dna": {
    durationMs: 2450,
    reducedMs: 900,
    navigateAt: 0.45,
    bellAt: 0.55,
    detentAt: 0.3,
    out: false,
    film: "chromatin",
  },
  "organelles->cells": {
    durationMs: 2300,
    reducedMs: 880,
    navigateAt: 0.5,
    bellAt: 0.42,
    detentAt: 0.62,
    out: true,
    film: "membrane",
  },
  "cells->organelles": {
    durationMs: 2300,
    reducedMs: 880,
    navigateAt: 0.45,
    bellAt: 0.55,
    detentAt: 0.3,
    out: false,
    film: "membrane",
  },
  "cells->tissue": {
    durationMs: 2300,
    reducedMs: 880,
    navigateAt: 0.5,
    bellAt: 0.44,
    detentAt: 0.62,
    out: true,
    film: "sheet",
  },
  "tissue->cells": {
    durationMs: 2300,
    reducedMs: 880,
    navigateAt: 0.45,
    bellAt: 0.55,
    detentAt: 0.3,
    out: false,
    film: "sheet",
  },
  "tissue->drop": {
    durationMs: 2500,
    reducedMs: 900,
    navigateAt: 0.5,
    bellAt: 0.44,
    detentAt: 0.62,
    out: true,
    film: "dissolve",
  },
  "drop->tissue": {
    durationMs: 2500,
    reducedMs: 900,
    navigateAt: 0.45,
    bellAt: 0.55,
    detentAt: 0.3,
    out: false,
    film: "dissolve",
  },
  // ——— The living middle: the doors a hand actually walks ———
  // Slower than the small-scale spine (there is a place to arrive at, not
  // just a structure to read) and quicker than the astronomical trunk.
  "tissue->flowers": {
    durationMs: 2700,
    reducedMs: 950,
    navigateAt: 0.5,
    bellAt: 0.44,
    detentAt: 0.62,
    out: true,
    film: "lamina",
  },
  "flowers->tissue": {
    durationMs: 2700,
    reducedMs: 950,
    navigateAt: 0.45,
    bellAt: 0.55,
    detentAt: 0.3,
    out: false,
    film: "lamina",
  },
  "drop->coast": {
    durationMs: 2900,
    reducedMs: 1050,
    navigateAt: 0.5,
    bellAt: 0.46,
    detentAt: 0.64,
    out: true,
    film: "tension",
  },
  "coast->drop": {
    durationMs: 2900,
    reducedMs: 1050,
    navigateAt: 0.45,
    bellAt: 0.52,
    detentAt: 0.3,
    out: false,
    film: "tension",
  },
  "drop->flowers": {
    durationMs: 2700,
    reducedMs: 950,
    navigateAt: 0.5,
    bellAt: 0.42,
    detentAt: 0.62,
    out: true,
    film: "dew",
  },
  "flowers->drop": {
    durationMs: 2700,
    reducedMs: 950,
    navigateAt: 0.45,
    bellAt: 0.56,
    detentAt: 0.3,
    out: false,
    film: "dew",
  },
  "flowers->birds": {
    durationMs: 2800,
    reducedMs: 1000,
    navigateAt: 0.5,
    bellAt: 0.44,
    detentAt: 0.62,
    out: true,
    film: "lift",
  },
  "birds->flowers": {
    durationMs: 2800,
    reducedMs: 1000,
    navigateAt: 0.45,
    bellAt: 0.54,
    detentAt: 0.3,
    out: false,
    film: "lift",
  },
  "birds->coast": {
    durationMs: 2800,
    reducedMs: 1000,
    navigateAt: 0.5,
    bellAt: 0.46,
    detentAt: 0.62,
    out: true,
    film: "shorewing",
  },
  "coast->birds": {
    durationMs: 2800,
    reducedMs: 1000,
    navigateAt: 0.45,
    bellAt: 0.52,
    detentAt: 0.3,
    out: false,
    film: "shorewing",
  },
  "olympus->earth": {
    durationMs: 3100,
    reducedMs: 1100,
    navigateAt: 0.52,
    bellAt: 0.44,
    detentAt: 0.62,
    out: true,
    film: "massif",
  },
  "earth->olympus": {
    durationMs: 3100,
    reducedMs: 1100,
    navigateAt: 0.45,
    bellAt: 0.54,
    detentAt: 0.3,
    out: false,
    film: "massif",
  },
  // ——— The top of the axis ———
  "space->beyond": {
    durationMs: 3200,
    reducedMs: 1150,
    navigateAt: 0.55,
    bellAt: 0.5,
    detentAt: 0.66,
    out: true,
    film: "interfere",
  },
  "beyond->space": {
    durationMs: 3200,
    reducedMs: 1150,
    navigateAt: 0.45,
    bellAt: 0.48,
    detentAt: 0.3,
    out: false,
    film: "interfere",
  },
  "beyond->manifold": {
    durationMs: 3200,
    reducedMs: 1150,
    navigateAt: 0.55,
    bellAt: 0.48,
    detentAt: 0.64,
    out: true,
    film: "curvature",
  },
  "manifold->beyond": {
    durationMs: 3200,
    reducedMs: 1150,
    navigateAt: 0.45,
    bellAt: 0.52,
    detentAt: 0.3,
    out: false,
    film: "curvature",
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
