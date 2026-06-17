"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import Clouds from "@/components/Clouds";

export default function CloudsPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("wind"); }, []);

  // /clouds is the air element of the four-element cosmology — the cloud
  // floor. Like /tide it's a single scene; the header floats over the sky.
  return (
    <>
      <SiteHeader />
      <main>
        <Clouds />
      </main>
    </>
  );
}
