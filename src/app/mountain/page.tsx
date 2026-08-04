"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import SiteHeader from "@/components/SiteHeader";
import AxisChrome from "@/components/AxisChrome";
import { getFieldAudio } from "@/lib/audio";

const MountainPeak = dynamic(() => import("@/components/MountainPeak"), { ssr: false });

export default function MountainPage() {
  useEffect(() => {
    getFieldAudio().setAmbientProfile("wind");
  }, []);

  return (
    <>
      <SiteHeader />
      <MountainPeak />
      <AxisChrome route="/mountain" />
    </>
  );
}
