"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import ScaleTravel from "@/components/ScaleTravel";
import QuarksVacuum from "@/components/QuarksVacuum";

export default function QuarksPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("vacuum"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <QuarksVacuum />
      </main>
      <ScaleTravel route="/quarks" />
    </>
  );
}
