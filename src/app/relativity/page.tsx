"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import RelativityRoom from "@/components/RelativityRoom";

// /relativity is a law, not a place: it deliberately takes no scale
// address and mounts no ScaleTravel — the covenant holds at every band.
export default function RelativityPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("cosmic"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <RelativityRoom />
      </main>
    </>
  );
}
