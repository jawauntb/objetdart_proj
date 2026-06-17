"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import Charts from "@/components/Charts";

export default function ChartsPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("clockwork"); }, []);

  // No footer — Charts owns the viewport. SiteHeader floats over the dark
  // panels (this route is registered as a dark route).
  return (
    <>
      <SiteHeader />
      <main>
        <Charts />
      </main>
    </>
  );
}
