"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import ScaleTravel from "@/components/ScaleTravel";
import MetaNavigator from "@/components/MetaNavigator";
import Ocean from "@/components/Ocean";

export default function OceanPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("ocean"); }, []);

  // One immersive scene. The header floats over the water; no footer.
  // MetaNavigator opens the shore family (coast / tide / waves) laterally.
  return (
    <>
      <SiteHeader />
      <main>
        <Ocean />
      </main>
      <ScaleTravel route="/ocean" />
      <MetaNavigator route="/ocean" />
    </>
  );
}
