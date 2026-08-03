"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import ScaleTravel from "@/components/ScaleTravel";
import HelixLadder from "@/components/HelixLadder";

export default function DnaPage() {
  useEffect(() => {
    getFieldAudio().setAmbientProfile("tide");
  }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <HelixLadder />
      </main>
      <ScaleTravel route="/dna" />
    </>
  );
}
