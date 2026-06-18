"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import FlowersPlayground from "@/components/FlowersPlayground";

export default function FlowersPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("flowers"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <FlowersPlayground />
      </main>
    </>
  );
}
