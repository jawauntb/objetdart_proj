"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import SiteHeader from "@/components/SiteHeader";
import AxisChrome from "@/components/AxisChrome";
import { getFieldAudio } from "@/lib/audio";

const CoastBeach = dynamic(() => import("@/components/CoastBeach"), { ssr: false });

export default function CoastPage() {
  useEffect(() => {
    getFieldAudio().setAmbientProfile("ocean");
  }, []);

  return (
    <>
      <SiteHeader />
      <CoastBeach />
      <AxisChrome route="/coast" />
    </>
  );
}
