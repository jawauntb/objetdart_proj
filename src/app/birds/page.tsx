"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import SiteHeader from "@/components/SiteHeader";
import ScaleTravel from "@/components/ScaleTravel";
import MetaNavigator from "@/components/MetaNavigator";
import { getFieldAudio } from "@/lib/audio";

const Murmuration = dynamic(() => import("@/components/Murmuration"), { ssr: false });

export default function BirdsPage() {
  useEffect(() => {
    getFieldAudio().setAmbientProfile("wind");
  }, []);

  return (
    <>
      <SiteHeader />
      <Murmuration />
      <ScaleTravel route="/birds" />
      <MetaNavigator route="/birds" />
    </>
  );
}
