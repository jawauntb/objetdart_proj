"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import LightInstrument from "@/components/LightInstrument";

export default function LightPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("light"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <LightInstrument />
      </main>
    </>
  );
}
