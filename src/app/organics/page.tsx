"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import ScaleTravel from "@/components/ScaleTravel";
import OrganicsField from "@/components/OrganicsField";

export default function OrganicsPage() {
  useEffect(() => {
    getFieldAudio().setAmbientProfile("tide");
  }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <OrganicsField />
      </main>
      <ScaleTravel route="/organics" />
    </>
  );
}
