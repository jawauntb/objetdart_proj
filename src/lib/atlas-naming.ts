/**
 * How the atlas names its own ground. Safe for client + server, because
 * both name it — and the bug this module exists to prevent was the two
 * sides each keeping a private vocabulary.
 *
 * These strings are not decoration. A hotspot label is the subject Atlas
 * generates when you enter that landmark; an edge seed is the subject it
 * generates for the territory beyond that edge. They used to be drawn
 * from an 8x8 grid of fantasy words (`copper` + `delta`, `velvet` +
 * `chapel`) that only ~13 prompt tokens could steer, so a map of Tokyo
 * grew a "copper delta" — and because a seed becomes the next sheet's
 * whole concept, crossing east from Tokyo generated an actual copper
 * delta, whose own edges then reseeded from *that*. Exploring dissolved
 * the world you asked for into stock cartography, one cell at a time.
 *
 * Naming by position instead keeps every derived sheet inside its
 * subject, the way a real atlas names its own sheets — and it keeps the
 * vocabulary question out of the image prompt entirely: the generator is
 * told where the four landmarks sit and nothing about what they are.
 */

import type { AtlasDirection } from "@/lib/atlas-batch";

const QUARTER_BY_DIRECTION: Record<AtlasDirection, string> = {
  north: "north quarter",
  east: "east quarter",
  south: "south quarter",
  west: "west quarter",
};

const REACHES_BY_DIRECTION: Record<AtlasDirection, string> = {
  north: "northern reaches",
  east: "eastern reaches",
  south: "southern reaches",
  west: "western reaches",
};

/**
 * The base subject of a concept, with any part-of qualifier stripped back
 * off. Every derived name hangs off the base, so hopping cell to cell can
 * never accrete `tokyo · north quarter · eastern reaches · …` and drift
 * off the 240-character prompt ceiling — and the base's own words stay
 * present so the visual-style match still fires one hop later.
 */
export function atlasBaseConcept(prompt: string): string {
  const collapsed = prompt.replace(/\s+/g, " ").trim();
  const base = collapsed.split("·")[0].trim();
  return base || collapsed;
}

/**
 * The part of a derived name worth printing on the map itself. The
 * masthead already carries the standing concept, so a 9px landmark label
 * repeating it ("my grandmother kitchen · north quarter") would only wrap
 * and crowd the ground it is trying to name. The full string still goes
 * to the generator; only the eye gets the short form.
 */
export function atlasNamePart(name: string): string {
  const parts = name.split("·");
  const tail = parts.at(-1)?.replace(/\s+/g, " ").trim() ?? "";
  return tail || name.replace(/\s+/g, " ").trim();
}

/** A district inside this sheet — the subject of entering that landmark. */
export function atlasQuarterLabel(prompt: string, direction: AtlasDirection): string {
  return `${atlasBaseConcept(prompt)} · ${QUARTER_BY_DIRECTION[direction]}`;
}

/** Territory beyond an edge — the subject of crossing it. */
export function atlasReachesLabel(prompt: string, direction: AtlasDirection): string {
  return `${atlasBaseConcept(prompt)} · ${REACHES_BY_DIRECTION[direction]}`;
}
