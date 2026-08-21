import type { GuideEntry, GuideVerb } from "./guideData.ts";

export type ConceptRevealReason = "discovery" | "direct-seeking" | "accessibility";

export type ConceptRevealAccess = Readonly<{
  reason: ConceptRevealReason;
  causedVerbs: readonly GuideVerb[];
}>;

export type RevealedConcept = Readonly<{
  reason: ConceptRevealReason;
  entry: GuideEntry;
  plain: string;
  notation: string;
}>;

/**
 * Language may follow a caused phenomenon, an explicit request, or an
 * assistive action. Any other runtime value stays closed.
 */
export function conceptRevealFor(
  entry: GuideEntry,
  access: ConceptRevealAccess,
): RevealedConcept | null {
  const allowed =
    access.reason === "direct-seeking" ||
    access.reason === "accessibility" ||
    (access.reason === "discovery" && access.causedVerbs.includes(entry.verb));
  if (!allowed) return null;
  return Object.freeze({
    reason: access.reason,
    entry,
    plain: entry.plain,
    notation: entry.notation,
  });
}
