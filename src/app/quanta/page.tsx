"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import ScaleTravel from "@/components/ScaleTravel";
import QuantaField from "@/components/QuantaField";

export default function QuantaPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("beyond"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <QuantaField />
      </main>
      <ScaleTravel route="/quanta" />
    </>
  );
}
