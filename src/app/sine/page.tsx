"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import SineWaveExplorer from "@/components/SineWaveExplorer";

export default function SinePage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("sine"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <SineWaveExplorer />
      </main>
    </>
  );
}
