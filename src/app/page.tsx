"use client";

import { useEffect } from "react";
import { useField } from "@/store/field";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import HomeCabinet from "@/components/HomeCabinet";
import ConcernField from "@/components/ConcernField";
import Atlas from "@/components/Atlas";
import Reading from "@/components/Reading";
import Archive from "@/components/Archive";
import Colophon from "@/components/Colophon";
import Sea from "@/components/Sea";
import SeaChart from "@/components/SeaChart";

export default function Page() {
  const loadFromStorage = useField((s) => s.loadFromStorage);
  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);
  // home — facing the sea, so the ocean ambient stays.
  useEffect(() => { getFieldAudio().setAmbientProfile("ocean"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <HomeCabinet />
        <div id="live-chart" style={{ scrollMarginTop: 72 }}>
          <SeaChart
            title="departure chart"
            caption="drag a candle · the sea answers · thirty minutes of imagined swell"
          />
        </div>
        <ConcernField />
        <Atlas />
        <Reading />
        {/* the sea returns — between the reading and the archive */}
        <div id="departure-ocean" style={{ borderTop: "1px solid var(--rule)", scrollMarginTop: 72 }}>
          <Sea height="clamp(200px, 32vh, 320px)" />
        </div>
        <Archive />
        <Colophon />
      </main>
      <SiteFooter />
    </>
  );
}
