"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import ScaleTravel from "@/components/ScaleTravel";
import OrganellesPlasm from "@/components/OrganellesPlasm";

export default function OrganellesPage() {
  useEffect(() => {
    getFieldAudio().setAmbientProfile("tide");
  }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <OrganellesPlasm />
      </main>
      <ScaleTravel route="/organelles" />
    </>
  );
}
