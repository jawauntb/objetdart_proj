"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";

/**
 * The only client-side island on /guide. Sets the ambient audio profile to
 * the quiet print-shop bed shared with the colophon. Returns null — the
 * component exists so the rest of the guide can render as pure server
 * components (no 1400 lines of guide data in the client bundle, no per-card
 * JS for the 55-room roster).
 */
export default function GuideAudioBed(): null {
  useEffect(() => {
    getFieldAudio().setAmbientProfile("colophon");
  }, []);
  return null;
}
