"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import SiteHeader from "@/components/SiteHeader";
import { getFieldAudio } from "@/lib/audio";

const DropSphere = dynamic(() => import("@/components/DropSphere"), { ssr: false });

export default function DropPage() {
  useEffect(() => {
    getFieldAudio().setAmbientProfile("aphros");
  }, []);

  return (
    <>
      <SiteHeader />
      <DropSphere />
    </>
  );
}
