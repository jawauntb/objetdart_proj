"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import SiteHeader from "@/components/SiteHeader";
import { getFieldAudio } from "@/lib/audio";

// The air column mounts its own RoomShell (the grammar, the vessel, the
// keyboard, the glimmer, the quiet clear and the axis chrome) because the
// gestures attach to its canvas, not to a wrapper the page owns.
const AirColumn = dynamic(() => import("@/components/AirColumn"), { ssr: false });

export default function AtmospherePage() {
  useEffect(() => {
    getFieldAudio().setAmbientProfile("wind");
  }, []);

  return (
    <>
      <SiteHeader />
      <AirColumn />
    </>
  );
}
