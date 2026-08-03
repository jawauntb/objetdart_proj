"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import SiteHeader from "@/components/SiteHeader";
import ScaleTravel from "@/components/ScaleTravel";
import MetaNavigator from "@/components/MetaNavigator";
import { getFieldAudio } from "@/lib/audio";

const BirdsFlock = dynamic(() => import("@/components/BirdsFlock"), { ssr: false });

export default function BirdsPage() {
  useEffect(() => {
    getFieldAudio().setAmbientProfile("wind");
  }, []);

  return (
    <>
      <SiteHeader />
      <BirdsFlock />
      <ScaleTravel route="/birds" />
      <MetaNavigator route="/birds" />
    </>
  );
}
