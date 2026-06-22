"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import Ocean from "@/components/Ocean";

export default function OceanPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("ocean"); }, []);

  // One immersive scene. The header floats over the water; no footer.
  return (
    <>
      <SiteHeader />
      <main>
        <Ocean />
      </main>
    </>
  );
}
