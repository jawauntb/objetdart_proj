"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";

const Beam = dynamic(() => import("@/components/Beam"), { ssr: false });

export default function BeamPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("wind"); }, []);

  // a pale page — the header keeps its light chrome and the eye owns the
  // whole viewport underneath it.
  return (
    <>
      <SiteHeader />
      <main>
        <Beam />
      </main>
    </>
  );
}
