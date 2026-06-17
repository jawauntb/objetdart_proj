"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import Pulse from "@/components/Pulse";

export default function PulsePage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("monitor"); }, []);

  // Hospital monitor owns the viewport — no site footer. The header floats
  // over the dark monitor field so the brand still anchors at the top.
  return (
    <>
      <SiteHeader />
      <main>
        <Pulse />
      </main>
    </>
  );
}
