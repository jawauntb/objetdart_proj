"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import AxisChrome from "@/components/AxisChrome";
import Watch from "@/components/Watch";

export default function WatchPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("watch"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <Watch />
      </main>
      <AxisChrome route="/watch" />
    </>
  );
}
