"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import GalaxyArms from "@/components/GalaxyArms";

// The room mounts its own <RoomShell>, which carries AxisChrome (ScaleTravel
// + MetaNavigator) with the manifest's chrome, the whole gesture grammar, the
// vessel, the glimmer and the quiet clear. The page stays thin.
export default function GalaxyPage() {
  useEffect(() => {
    getFieldAudio().setAmbientProfile("cosmic");
  }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <GalaxyArms />
      </main>
    </>
  );
}
