"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import ScaleTravel from "@/components/ScaleTravel";
import MetaNavigator from "@/components/MetaNavigator";

const Land = dynamic(() => import("@/components/Land"), { ssr: false });

export default function LandPage() {
  useEffect(() => {
    getFieldAudio().setAmbientProfile("garden");
  }, []);

  // the lived terrain surface — the header keeps its dark chrome and the
  // heightfield owns the viewport underneath it.
  return (
    <>
      <SiteHeader />
      <Land />
      <ScaleTravel route="/land" />
      <MetaNavigator route="/land" />
    </>
  );
}
