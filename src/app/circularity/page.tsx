"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import AxisChrome from "@/components/AxisChrome";
import CircularityFourier from "@/components/CircularityFourier";

export default function CircularityPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("circularity"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <CircularityFourier />
      </main>
      <AxisChrome route="/circularity" />
    </>
  );
}
