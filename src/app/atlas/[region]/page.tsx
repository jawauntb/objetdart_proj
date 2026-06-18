"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useField } from "@/store/field";
import { getFieldAudio } from "@/lib/audio";
import { REGIONS } from "@/data/content";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import Atlas from "@/components/Atlas";
import Reading from "@/components/Reading";
import Archive from "@/components/Archive";

export default function AtlasRegionPage() {
  const params = useParams<{ region: string }>();
  const setRegion = useField((s) => s.setRegion);
  const loadFromStorage = useField((s) => s.loadFromStorage);
  // page-specific ambient bed: compass drone and map-paper air
  useEffect(() => { getFieldAudio().setAmbientProfile("atlas"); }, []);

  useEffect(() => {
    loadFromStorage();
    const id = params?.region;
    if (!id) return;
    const valid = REGIONS.find((r) => r.id === id);
    if (valid) setRegion(valid.id);
  }, [params?.region, loadFromStorage, setRegion]);

  return (
    <>
      <SiteHeader />
      <main>
        <Atlas />
        <Reading />
        <Archive />
      </main>
      <SiteFooter />
    </>
  );
}
