"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import ScaleTravel from "@/components/ScaleTravel";
import Murmuration from "@/components/Murmuration";

export default function BirdsPage() {
  useEffect(() => {
    getFieldAudio().setAmbientProfile("wind");
  }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <Murmuration />
      </main>
      <ScaleTravel route="/birds" />
    </>
  );
}
