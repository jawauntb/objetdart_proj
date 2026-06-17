"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import Aphros from "@/components/Aphros";

export default function AphrosPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("ocean"); }, []);

  // a pale page — the SiteHeader keeps its light style here (not in the
  // dark-routes list). The Aphros scene owns the rest of the viewport.
  return (
    <>
      <SiteHeader />
      <main>
        <Aphros />
      </main>
    </>
  );
}
