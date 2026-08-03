"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import SiteHeader from "@/components/SiteHeader";
import { getFieldAudio } from "@/lib/audio";

const SoilGround = dynamic(() => import("@/components/SoilGround"), { ssr: false });

export default function SoilPage() {
  useEffect(() => {
    getFieldAudio().setAmbientProfile("earth");
  }, []);

  // RoomShell mounts the axis chrome, the grammar, the vessel and the quiet
  // clear; the page only names the room's atmosphere.
  return (
    <>
      <SiteHeader />
      <SoilGround />
    </>
  );
}
