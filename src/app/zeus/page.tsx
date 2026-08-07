"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import SiteHeader from "@/components/SiteHeader";
import { getFieldAudio } from "@/lib/audio";

const Zeus = dynamic(() => import("@/components/Zeus"), { ssr: false });

export default function ZeusPage() {
  useEffect(() => {
    getFieldAudio().setAmbientProfile("storm");
  }, []);

  // RoomShell mounts axis chrome, the grammar, the vessel and the quiet
  // clear; the page names the room's atmosphere and nothing else.
  return (
    <>
      <SiteHeader />
      <Zeus />
    </>
  );
}
