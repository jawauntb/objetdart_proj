"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import StructureLoom from "@/components/StructureLoom";

// /loom is a law/lens, not a place: it deliberately takes no scale address
// and mounts no ScaleTravel — one structure holds at every band. It compiles
// that structure into all five substrates at once (INSPIRATION.md §2a).
export default function LoomPage() {
  useEffect(() => {
    getFieldAudio().setAmbientProfile("signal");
  }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <StructureLoom />
      </main>
    </>
  );
}
