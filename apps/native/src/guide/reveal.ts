/**
 * What the visitor has caused, and therefore what the guide may show.
 *
 * The `?` is a mirror of the guide, and the guide's own contract is that
 * language never precedes material: an entry whose phenomenon has not landed
 * stays hidden until it does. Until the surface was wired, nothing could
 * land, so the world route carried a frozen placeholder and the sheet was
 * always empty. This is the pure law that replaces it — the route feeds it
 * every committed gesture and keeps what it returns.
 *
 * Two rules the reveal state depends on:
 *
 *  - **Only what the medium answered counts.** A verb that landed in the hand
 *    and the ear but not in the water is an acknowledgement, not a
 *    phenomenon; unlocking its guide entry would describe something the
 *    visitor has not seen.
 *  - **The steps are earned in order by *doing*, never by reading.**
 *    `primaryReproductions` counts strikes on the material — the phenomenon
 *    the scene is about — and `expressed` turns true only on an act of
 *    authorship: the tutti, or the room's one solemn act.
 */

import type { GuideVerb } from "./guideData.ts";
import { NATIVE_GUIDE_VERBS } from "./guideData.ts";

/**
 * What the scene lanes push up to the chrome: which phenomena the visitor has
 * caused so far. The guide sheet reads it to gate the
 * Play/Reveal/Name/Transfer/Express choreography.
 */
export type SceneReveal = Readonly<{
  /** verbs whose phenomenon the visitor has caused at least once. */
  causedVerbs: readonly GuideVerb[];
  /** how many times the visitor has produced the primary phenomenon. */
  primaryReproductions: number;
  /** whether the visitor has committed an expressive act. */
  expressed: boolean;
}>;

export type CommittedGesture = Readonly<{
  verb: string;
  semanticVerb: string;
  /** whether the active medium expressed it in its own material. */
  answered: boolean;
}>;

export const EMPTY_REVEAL: SceneReveal = Object.freeze({
  causedVerbs: Object.freeze([]) as readonly GuideVerb[],
  primaryReproductions: 0,
  expressed: false,
});

/** The site-wide verbs, as a set, so an unknown string cannot enter the state. */
const KNOWN_VERBS: ReadonlySet<string> = new Set<string>(NATIVE_GUIDE_VERBS);

/** Acts of authorship: everything alive answering at once, and the solemn act. */
const EXPRESSIVE_ACTS: ReadonlySet<string> = new Set(["tutti", "ceremony"]);

export function revealAfter(reveal: SceneReveal, gesture: CommittedGesture): SceneReveal {
  if (!gesture.answered || !KNOWN_VERBS.has(gesture.verb)) return reveal;
  const verb = gesture.verb as GuideVerb;

  const caused = reveal.causedVerbs.includes(verb)
    ? reveal.causedVerbs
    : Object.freeze([...reveal.causedVerbs, verb]);
  const primaryReproductions =
    gesture.semanticVerb === "material"
      ? reveal.primaryReproductions + 1
      : reveal.primaryReproductions;
  const expressed = reveal.expressed || EXPRESSIVE_ACTS.has(gesture.semanticVerb);

  if (
    caused === reveal.causedVerbs &&
    primaryReproductions === reveal.primaryReproductions &&
    expressed === reveal.expressed
  ) {
    return reveal;
  }
  return Object.freeze({ causedVerbs: caused, primaryReproductions, expressed });
}
