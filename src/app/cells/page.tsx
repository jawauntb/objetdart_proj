"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import ScaleTravel from "@/components/ScaleTravel";
import CellsPlasm from "@/components/CellsPlasm";

export default function CellsPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("tide"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <CellsPlasm />
      </main>
      <ScaleTravel route="/cells" />
    </>
  );
}
