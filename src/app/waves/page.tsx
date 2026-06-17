"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import Waves from "@/components/Waves";

export default function WavesPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("ocean"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <Waves />
      </main>
    </>
  );
}
