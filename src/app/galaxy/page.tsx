"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import AxisChrome from "@/components/AxisChrome";
import GalaxyArms from "@/components/GalaxyArms";

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
      <AxisChrome route="/galaxy" />
    </>
  );
}
