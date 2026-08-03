"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import AxisChrome from "@/components/AxisChrome";
import Storm from "@/components/Storm";

export default function StormPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("storm"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <Storm />
      </main>
      <AxisChrome route="/storm" />
    </>
  );
}
