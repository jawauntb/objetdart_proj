"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import SiteHeader from "@/components/SiteHeader";
import ScaleTravel from "@/components/ScaleTravel";
import MetaNavigator from "@/components/MetaNavigator";
import { getFieldAudio } from "@/lib/audio";

const Viruses = dynamic(() => import("@/components/Viruses"), { ssr: false });

export default function VirusesPage() {
  useEffect(() => {
    getFieldAudio().setAmbientProfile("garden");
  }, []);

  return (
    <>
      <SiteHeader />
      <Viruses />
      <ScaleTravel route="/viruses" />
      <MetaNavigator route="/viruses" />
    </>
  );
}
