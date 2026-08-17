"use client";

import { useEffect, useState } from "react";
import {
  GUIDE_VOICE_ATTR,
  readGuideVoice,
  subscribeGuideVoice,
  writeGuideVoice,
  type GuideVoice,
} from "@/lib/guide-voice";

/**
 * The guide's one voice control. Every entry on the page carries both voices
 * in the server-rendered HTML; this switch only flips `<html data-guide-voice>`
 * (via the shared lib), and the stylesheet shows one pair member at a time.
 * The chrome `?` reads and writes the same preference.
 */
export default function GuideVoiceToggle() {
  const [voice, setVoice] = useState<GuideVoice>("plain");

  useEffect(() => {
    const stored = readGuideVoice();
    setVoice(stored);
    // normalize the attribute even when the boot script didn't run
    // (client-side navigation renders no fresh inline script)
    document.documentElement.setAttribute(GUIDE_VOICE_ATTR, stored);
    return subscribeGuideVoice(setVoice);
  }, []);

  return (
    <div className="guide-voice-toggle" role="group" aria-label="voice">
      <button
        type="button"
        className="t-mono"
        aria-pressed={voice === "plain"}
        onClick={() => writeGuideVoice("plain")}
      >
        plain words
      </button>
      <button
        type="button"
        className="t-mono"
        aria-pressed={voice === "field"}
        onClick={() => writeGuideVoice("field")}
      >
        field notes
      </button>
    </div>
  );
}
