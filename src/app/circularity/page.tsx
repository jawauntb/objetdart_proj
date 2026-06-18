"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import CircularityFourier from "@/components/CircularityFourier";

export default function CircularityPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("circularity"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <CircularityFourier />
      </main>
    </>
  );
}
