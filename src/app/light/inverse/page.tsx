"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import MusicColorInstrument from "@/components/MusicColorInstrument";

export default function LightInversePage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("light"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <MusicColorInstrument />
      </main>
    </>
  );
}
