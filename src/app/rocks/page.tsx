"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import SiteHeader from "@/components/SiteHeader";
import ScaleTravel from "@/components/ScaleTravel";
import MetaNavigator from "@/components/MetaNavigator";
import { getFieldAudio } from "@/lib/audio";

const RockShelf = dynamic(() => import("@/components/RockShelf"), { ssr: false });

export default function RocksPage() {
  useEffect(() => {
    getFieldAudio().setAmbientProfile("kept");
  }, []);

  return (
    <>
      <SiteHeader />
      <RockShelf />
      <ScaleTravel route="/rocks" />
      <MetaNavigator route="/rocks" />
    </>
  );
}
