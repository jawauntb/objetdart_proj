"use client";

import { useEffect } from "react";
import { useField } from "@/store/field";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import Archive from "@/components/Archive";

export default function ArchivePage() {
  const loadFromStorage = useField((s) => s.loadFromStorage);
  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);
  // page-specific ambient bed: dry paper room
  useEffect(() => { getFieldAudio().setAmbientProfile("archive"); }, []);
  return (
    <>
      <SiteHeader />
      <main>
        <Archive />
      </main>
      <SiteFooter />
    </>
  );
}
