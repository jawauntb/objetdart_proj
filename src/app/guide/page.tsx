"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import Guide from "@/components/Guide";

export default function GuidePage() {
  // same quiet print-shop bed as the colophon: this is a reading surface
  useEffect(() => { getFieldAudio().setAmbientProfile("colophon"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <Guide />
      </main>
      <SiteFooter />
    </>
  );
}
