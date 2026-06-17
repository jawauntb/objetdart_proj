"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import Stars from "@/components/Stars";

export default function StarsPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("cosmic"); }, []);

  // No site footer — the page is one scene. The header floats over the
  // night so the brand still connects, but the sky owns the rest.
  return (
    <>
      <SiteHeader />
      <main>
        <Stars />
      </main>
    </>
  );
}
