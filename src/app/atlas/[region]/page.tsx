"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useField } from "@/store/field";
import { getFieldAudio } from "@/lib/audio";
import { REGIONS } from "@/data/content";
import SiteHeader from "@/components/SiteHeader";
import AxisChrome from "@/components/AxisChrome";
import Atlas from "@/components/Atlas";

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
      </main>
      {/* Same pattern as /stars: the room owns pinch (Atlas drives the
          manifold through useBandEdgeTravel), so travel is off here and
          AxisChrome mounts only the peer ring — the hearth, where the map
          sits beside the ground it charts. The route is the room's canonical
          address, exactly as Atlas.tsx already reports it, so every region
          gets the same ring. */}
      <AxisChrome route="/atlas/origin" travel={false} />
    </>
  );
}
