"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import SiteHeader from "@/components/SiteHeader";
import ScaleTravel from "@/components/ScaleTravel";
import MetaNavigator from "@/components/MetaNavigator";
import { getFieldAudio } from "@/lib/audio";

const LocalGroup = dynamic(() => import("@/components/LocalGroup"), { ssr: false });

export default function LocalGroupPage() {
  useEffect(() => {
    // the vacuum hush of the deep — sparse drones, the register the space band sounds in
    getFieldAudio().setAmbientProfile("cosmic");
  }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <LocalGroup />
      </main>
      <ScaleTravel route="/localgroup" />
      <MetaNavigator route="/localgroup" />
    </>
  );
}
