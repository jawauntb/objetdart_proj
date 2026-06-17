import { REGIONS, OBJECTS, ARCHIVE, CONCERNS } from "@/data/content";
import type { ConcernKey, ArchiveEntry, MapRegion, SymbolObject } from "@/lib/types";

export type ReadingInput = {
  concerns: Record<ConcernKey, number>;
  region: string | null;
  carriedObject: string | null;
};

export type Reading = {
  top: ConcernKey[];
  region: MapRegion;
  carried: SymbolObject | null;
  headline: string;
  weights: string;     // "what the weights say"
  regionPara: string;  // "what the region offers"
  objectPara: string;  // "what the object asks"
  suggestions: ArchiveEntry[];
  hash: string;
};

function concernLabel(k: ConcernKey) {
  return (CONCERNS.find((c) => c.id === k)?.label ?? k).toLowerCase();
}

const READING_ORDER: ConcernKey[] = [
  "memory","work","love","prayer","risk","future","body","friendship",
];

export function encodeReadingHash(input: ReadingInput): string {
  const bytes = new Uint8Array(11);
  READING_ORDER.forEach((k, i) => { bytes[i] = input.concerns[k] ?? 50; });
  const rIdx = input.region ? REGIONS.findIndex((r) => r.id === input.region) : -1;
  const oIdx = input.carriedObject ? OBJECTS.findIndex((o) => o.id === input.carriedObject) : -1;
  bytes[8] = rIdx + 1;
  bytes[9] = oIdx + 1;
  bytes[10] = 1;
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  if (typeof btoa !== "undefined") {
    return btoa(s).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  }
  // node fallback
  return Buffer.from(s, "binary").toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function decodeReadingHash(hash: string): ReadingInput | null {
  try {
    const b64 = hash.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const bin = typeof atob !== "undefined"
      ? atob(padded)
      : Buffer.from(padded, "base64").toString("binary");
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (bytes.length < 10) return null;
    const concerns = Object.fromEntries(
      READING_ORDER.map((k, i) => [k, Math.min(100, Math.max(0, bytes[i]))]),
    ) as Record<ConcernKey, number>;
    const rIdx = bytes[8] - 1;
    const oIdx = bytes[9] - 1;
    const region = rIdx >= 0 && rIdx < REGIONS.length ? REGIONS[rIdx].id : null;
    const carriedObject = oIdx >= 0 && oIdx < OBJECTS.length ? OBJECTS[oIdx].id : null;
    return { concerns, region, carriedObject };
  } catch {
    return null;
  }
}

export function buildReading(input: ReadingInput): Reading {
  const { concerns, region: regionId, carriedObject: carriedId } = input;
  const sorted = (Object.entries(concerns) as [ConcernKey, number][])
    .sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 3).map(([k]) => k);
  const [k1, v1] = sorted[0];
  const [k2, v2] = sorted[1];

  const region = regionId
    ? REGIONS.find((r) => r.id === regionId) ?? REGIONS[0]
    : [...REGIONS].sort((a, b) => {
        const sa = a.concerns.reduce((s, c) => s + (concerns[c] ?? 0), 0);
        const sb = b.concerns.reduce((s, c) => s + (concerns[c] ?? 0), 0);
        return sb - sa;
      })[0];

  const carried = carriedId ? OBJECTS.find((o) => o.id === carriedId) ?? null : null;

  const intensity = v1 >= 80 ? "heavy" : v1 >= 60 ? "weighted" : v1 - v2 < 8 ? "split" : "quiet";
  const headlineCarry = carried ? `, with the ${carried.label.toLowerCase()} carried` : "";
  const headline = `the ${region.label.toLowerCase()} under ${intensity} ${concernLabel(k1)}${headlineCarry}.`;

  const second = v1 - v2 < 8
    ? `${concernLabel(k1)} and ${concernLabel(k2)} share the room, almost the same weight.`
    : `${concernLabel(k2)} answers it from a little further off.`;
  const weights = `${concernLabel(k1)} is closest to the surface tonight. ${second} ${concernLabel(top[2])} is kept somewhere behind both.`;

  const regionPara = `${region.label.toLowerCase()} is ${region.inscription.toLowerCase()} — it answers the kind of ${concernLabel(k1)} you are carrying.`;

  const objectPara = carried
    ? `you are carrying the ${carried.label.toLowerCase()}. ${carried.inscription.toLowerCase()}. ${carried.fn.toLowerCase()}`
    : `you are carrying nothing yet. tap an object in the atlas to bring one with you.`;

  const suggestions = ARCHIVE.filter(
    (a) =>
      a.concerns.some((c) => top.includes(c)) ||
      a.region === region.id ||
      (carried && (a.objects ?? []).includes(carried.id)),
  ).slice(0, 3);

  return {
    top,
    region,
    carried,
    headline,
    weights,
    regionPara,
    objectPara,
    suggestions,
    hash: encodeReadingHash(input),
  };
}

/**
 * Region-focused reading: 2-3 paragraphs of prose specifically about a
 * region in the user's current state. Used in the atlas drawer.
 */
export function buildRegionReading(
  regionId: string,
  concerns: Record<ConcernKey, number>,
  carriedId: string | null,
): { headline: string; paragraphs: string[] } {
  const region = REGIONS.find((r) => r.id === regionId) ?? REGIONS[0];
  const carried = carriedId ? OBJECTS.find((o) => o.id === carriedId) : null;
  const sorted = (Object.entries(concerns) as [ConcernKey, number][])
    .sort((a, b) => b[1] - a[1]);
  const [k1, v1] = sorted[0];
  const k1Label = concernLabel(k1);

  // Build a soft mood word from the region's tagged concerns + user's
  // dominant concern.
  const regionConcernLabels = region.concerns.map(concernLabel);
  const overlap = region.concerns.includes(k1);
  const mood = overlap
    ? `${k1Label} runs through it`
    : `${k1Label} reaches in from elsewhere`;
  const headline = `${region.label.toLowerCase()} — ${mood}.`;

  // paragraph 1 — region as a place
  const p1 = `${region.label.toLowerCase()} is ${region.inscription.toLowerCase()}. it answers to ${regionConcernLabels.join(" and ")}, which sit close to the surface here. ${v1 >= 70 ? `tonight you have brought ${k1Label} to it` : `tonight your room is quieter than this place usually asks for`}.`;

  // paragraph 2 — what to do here / how it relates to the field
  const p2 = carried
    ? `you are carrying the ${carried.label.toLowerCase()}. ${carried.inscription.toLowerCase()}. left here, it ${overlap ? "deepens what's already weighted" : "shifts the air of the place by a small amount"}.`
    : `nothing is carried into it yet. the territory is open the way an empty room is open — waiting on whatever you bring.`;

  // paragraph 3 — the kept image
  const p3 = `keep it under ${regionConcernLabels[0]}. the ${region.label.toLowerCase().split(" ").slice(-1)[0]} is a name for what stays.`;

  return { headline, paragraphs: [p1, p2, p3] };
}
