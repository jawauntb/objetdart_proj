"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import ScaleTravel from "@/components/ScaleTravel";
import AtomsField from "@/components/AtomsField";

export default function AtomsPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("signal"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <AtomsField />
      </main>
      <ScaleTravel route="/atoms" />
    </>
  );
}
