"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";

const Plank = dynamic(() => import("@/components/Plank"), { ssr: false });

export default function PlankPage() {
  useEffect(() => {
    getFieldAudio().setAmbientProfile("beyond");
  }, []);

  // the bottom of the axis — the header keeps its dark chrome and the foam
  // owns the whole viewport underneath it. RoomShell mounts the axis chrome.
  return (
    <>
      <SiteHeader />
      <main>
        <Plank />
      </main>
    </>
  );
}
