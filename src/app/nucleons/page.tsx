"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import ScaleTravel from "@/components/ScaleTravel";
import NucleonsField from "@/components/NucleonsField";

export default function NucleonsPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("cosmic"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <NucleonsField />
      </main>
      <ScaleTravel route="/nucleons" />
    </>
  );
}
