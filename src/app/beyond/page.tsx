"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import ScaleTravel from "@/components/ScaleTravel";
import BeyondWaveField from "@/components/BeyondWaveField";

export default function BeyondPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("beyond"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <BeyondWaveField />
      </main>
      <ScaleTravel route="/beyond" />
    </>
  );
}
