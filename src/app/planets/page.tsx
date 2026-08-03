"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import SiteHeader from "@/components/SiteHeader";
import { getFieldAudio } from "@/lib/audio";

// The forge owns a WebGL context and a live orbital field, so it never renders
// on the server. RoomShell (inside it) mounts the axis chrome and the grammar.
const PlanetForge = dynamic(() => import("@/components/PlanetForge"), { ssr: false });

export default function PlanetsPage() {
  useEffect(() => {
    getFieldAudio().setAmbientProfile("cosmic");
  }, []);

  return (
    <>
      <SiteHeader />
      <PlanetForge />
    </>
  );
}
