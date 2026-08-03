"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import ScaleTravel from "@/components/ScaleTravel";
import MetaNavigator from "@/components/MetaNavigator";
import Clouds from "@/components/Clouds";

export default function CloudsPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("wind"); }, []);

  // /clouds shares the olympus band with /mountain — pinch travels the axis;
  // the MetaNavigator opens the lateral door between peak and cloud floor.
  return (
    <>
      <SiteHeader />
      <main>
        <Clouds />
      </main>
      <ScaleTravel route="/clouds" />
      <MetaNavigator route="/clouds" />
    </>
  );
}
