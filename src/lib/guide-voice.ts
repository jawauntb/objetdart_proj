/**
 * The guide's two voices — one preference, shared by the chrome `?`
 * (src/components/RoomHelp.tsx) and /guide.
 *
 * "plain" is the default for a visitor who has never chosen: the plain-words
 * translation is the door, the field notes are the room's own register kept
 * behind it. Both voices live in the guide data (`src/data/guide.ts`, or a
 * room's own manifest) — this module only remembers which one the visitor
 * asked to read.
 *
 * The choice persists in localStorage and mirrors onto
 * `<html data-guide-voice>`, so /guide's server-rendered voice pairs can swap
 * by CSS alone — no client re-render of ~85 entries, no second copy of any
 * prose. A custom event keeps every mounted toggle in agreement.
 */

export type GuideVoice = "plain" | "field";

export const GUIDE_VOICE_KEY = "objetdart:guide-voice:v1";
export const GUIDE_VOICE_ATTR = "data-guide-voice";
const GUIDE_VOICE_EVENT = "objetdart:guide-voice";

export function readGuideVoice(): GuideVoice {
  if (typeof window === "undefined") return "plain";
  try {
    return window.localStorage.getItem(GUIDE_VOICE_KEY) === "field" ? "field" : "plain";
  } catch {
    return "plain";
  }
}

export function writeGuideVoice(voice: GuideVoice): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GUIDE_VOICE_KEY, voice);
  } catch {
    // private mode still gets the in-session switch below
  }
  document.documentElement.setAttribute(GUIDE_VOICE_ATTR, voice);
  window.dispatchEvent(new CustomEvent<GuideVoice>(GUIDE_VOICE_EVENT, { detail: voice }));
}

export function subscribeGuideVoice(onChange: (voice: GuideVoice) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    onChange((e as CustomEvent<GuideVoice>).detail === "field" ? "field" : "plain");
  };
  window.addEventListener(GUIDE_VOICE_EVENT, handler);
  return () => window.removeEventListener(GUIDE_VOICE_EVENT, handler);
}
