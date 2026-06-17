"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import Colophon from "@/components/Colophon";

export default function ColophonPage() {
  // page-specific ambient bed: silent — printed matter
  useEffect(() => { getFieldAudio().setAmbientProfile("silent"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <Colophon />
      </main>
      <SiteFooter />
    </>
  );
}
