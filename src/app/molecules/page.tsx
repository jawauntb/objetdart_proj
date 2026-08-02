"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import ScaleTravel from "@/components/ScaleTravel";
import MoleculesField from "@/components/MoleculesField";

export default function MoleculesPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("sine"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <MoleculesField />
      </main>
      <ScaleTravel route="/molecules" />
    </>
  );
}
