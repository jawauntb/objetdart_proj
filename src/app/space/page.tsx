"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import AxisChrome from "@/components/AxisChrome";
import DeepSpaceWeb from "@/components/DeepSpaceWeb";

export default function SpacePage() {
  useEffect(() => {
    getFieldAudio().setAmbientProfile("cosmic");
  }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <DeepSpaceWeb />
      </main>
      <AxisChrome route="/space" />
    </>
  );
}
