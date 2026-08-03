"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import ScaleTravel from "@/components/ScaleTravel";
import MetaNavigator from "@/components/MetaNavigator";
import FlowersGarden from "@/components/FlowersGarden";

export default function FlowersPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("flowers"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <FlowersGarden />
      </main>
      <ScaleTravel route="/flowers" />
      <MetaNavigator route="/flowers" />
    </>
  );
}
