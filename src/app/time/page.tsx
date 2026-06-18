"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import TimeManifold from "@/components/TimeManifold";

export default function TimePage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("time"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <TimeManifold />
      </main>
    </>
  );
}
