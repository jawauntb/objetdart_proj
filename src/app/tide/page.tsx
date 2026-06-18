"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import Tide from "@/components/Tide";

export default function TidePage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("tide"); }, []);

  // No site footer — the page is one scene. The header floats over the
  // night canvas so the brand still connects, but the room owns the rest.
  return (
    <>
      <SiteHeader />
      <main>
        <Tide />
      </main>
    </>
  );
}
