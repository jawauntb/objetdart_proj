"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import AxisChrome from "@/components/AxisChrome";
import ArrivalInvitation from "@/components/ArrivalInvitation";
import ManifoldFold from "@/components/ManifoldFold";

export default function ManifoldPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("beyond"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <ManifoldFold />
      </main>
      <AxisChrome route="/manifold" />
      {/* volunteered once at the door, then gone — never on the canvas */}
      <ArrivalInvitation />
    </>
  );
}
