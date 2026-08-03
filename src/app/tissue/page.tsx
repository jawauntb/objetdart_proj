"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import ScaleTravel from "@/components/ScaleTravel";
import TissueSheet from "@/components/TissueSheet";

export default function TissuePage() {
  useEffect(() => {
    getFieldAudio().setAmbientProfile("tide");
  }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <TissueSheet />
      </main>
      <ScaleTravel route="/tissue" />
    </>
  );
}
