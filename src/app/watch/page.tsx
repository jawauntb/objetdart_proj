"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import Watch from "@/components/Watch";

export default function WatchPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("ocean"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <Watch />
      </main>
    </>
  );
}
