"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import AxisChrome from "@/components/AxisChrome";

const Comb = dynamic(() => import("@/components/Comb"), { ssr: false });

export default function CombPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("light"); }, []);

  // a pale page like aphros — the header keeps its light chrome and the
  // field owns the whole viewport underneath it.
  return (
    <>
      <SiteHeader />
      <main>
        <Comb />
      </main>
      <AxisChrome route="/comb" />
    </>
  );
}
