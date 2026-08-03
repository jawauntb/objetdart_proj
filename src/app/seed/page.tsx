"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import SiteHeader from "@/components/SiteHeader";
import ScaleTravel from "@/components/ScaleTravel";
import MetaNavigator from "@/components/MetaNavigator";
import { getFieldAudio } from "@/lib/audio";

const SeedEmbryo = dynamic(() => import("@/components/SeedEmbryo"), { ssr: false });

export default function SeedPage() {
  useEffect(() => {
    getFieldAudio().setAmbientProfile("garden");
  }, []);

  return (
    <>
      <SiteHeader />
      <SeedEmbryo />
      <ScaleTravel route="/seed" />
      <MetaNavigator route="/seed" />
    </>
  );
}
