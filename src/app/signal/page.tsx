"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import Signal from "@/components/Signal";

export default function SignalPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("signal"); }, []);

  // No site footer — the visualiser owns the viewport. The header floats
  // over the dark indigo so the brand still connects.
  return (
    <>
      <SiteHeader />
      <main>
        <Signal />
      </main>
    </>
  );
}
