"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import PretextWave from "@/components/PretextWave";

export default function PretextPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("ocean"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <PretextWave />
      </main>
    </>
  );
}
