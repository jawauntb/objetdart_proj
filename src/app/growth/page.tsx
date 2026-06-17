"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import Growth from "@/components/Growth";

export default function GrowthPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("garden"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <Growth />
      </main>
    </>
  );
}
