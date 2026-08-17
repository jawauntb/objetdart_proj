"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import SiteHeader from "@/components/SiteHeader";
import { getFieldAudio } from "@/lib/audio";

const EigenField = dynamic(() => import("@/components/EigenField"), { ssr: false });

// /eigen is a law, not a place: it takes no scale address and mounts no
// AxisChrome. Surviving freedom after a constraint holds at every band.
export default function EigenPage() {
  useEffect(() => {
    getFieldAudio().setAmbientProfile("cosmic");
  }, []);

  return (
    <>
      <SiteHeader />
      <EigenField />
    </>
  );
}
