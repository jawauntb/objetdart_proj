"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";

// /orb sits at the drop, beside /plasma in the cabinet ring. <RoomShell>
// mounts AxisChrome from the manifest, so the page adds no chrome of its own.
const PlasmaOrb = dynamic(() => import("@/components/PlasmaOrb"), { ssr: false });

export default function OrbPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("electric"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <PlasmaOrb />
      </main>
    </>
  );
}
