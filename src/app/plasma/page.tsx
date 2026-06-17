"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import Plasma from "@/components/Plasma";

/**
 * /plasma — the light element.
 * The page hosts the three-band light scene; the site header floats above
 * the dark gradient. No footer chrome — the scene owns the canvas below
 * the header.
 */
export default function PlasmaPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("electric"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <Plasma />
      </main>
    </>
  );
}
