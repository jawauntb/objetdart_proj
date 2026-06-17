"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import Earth from "@/components/Earth";

export default function EarthPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("earth"); }, []);

  // /earth is a dark route — the Earth scene owns the viewport behind
  // the floating SiteHeader.
  return (
    <>
      <SiteHeader />
      <main>
        <Earth />
      </main>
    </>
  );
}
