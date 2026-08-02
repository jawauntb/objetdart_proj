"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import ScaleTravel from "@/components/ScaleTravel";
import ManifoldFold from "@/components/ManifoldFold";

export default function ManifoldPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("beyond"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <ManifoldFold />
      </main>
      <ScaleTravel route="/manifold" />
    </>
  );
}
