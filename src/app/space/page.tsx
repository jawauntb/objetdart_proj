"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import ScaleTravel from "@/components/ScaleTravel";
import DeepSpaceWeb from "@/components/DeepSpaceWeb";

export default function SpacePage() {
  useEffect(() => {
    getFieldAudio().setAmbientProfile("cosmic");
  }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <DeepSpaceWeb />
      </main>
      <ScaleTravel route="/space" />
    </>
  );
}
