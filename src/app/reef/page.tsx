// object-compiler template — docs/plans/object-compiler.md M3.
// Consumes: spec.key, spec.ambient_profile, ComponentName (PascalCase of key).
// Deterministic — no LLM slot. RoomShell mounts inside the component, not here.
"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import SiteHeader from "@/components/SiteHeader";
import { getFieldAudio } from "@/lib/audio";

const Reef = dynamic(() => import("@/components/Reef"), { ssr: false });

export default function ReefPage() {
  useEffect(() => {
    getFieldAudio().setAmbientProfile("aphros");
  }, []);

  // RoomShell mounts axis chrome, the grammar, the vessel and the quiet
  // clear; the page names the room's atmosphere and nothing else.
  return (
    <>
      <SiteHeader />
      <Reef />
    </>
  );
}
