"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";

// /compass measures attention, not metres: it takes no scale address and so
// mounts no ScaleTravel and no MetaNavigator — the /time and /instrument
// precedent, a lens the visitor holds over themselves from any band.
const ConcernField = dynamic(() => import("@/components/ConcernField"), { ssr: false });

export default function CompassPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("atlas"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <ConcernField />
      </main>
    </>
  );
}
