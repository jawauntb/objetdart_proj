"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import OverlookTree from "@/components/OverlookTree";

// /overlook is a view of the axis, not a place on it: it deliberately
// takes no scale address and mounts no ScaleTravel (the /relativity
// exemption). Pinch is bound in-room as zoom of the view — the one
// honest off-axis zoom, because there is no band here to leave.
export default function OverlookPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("beyond"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <OverlookTree />
      </main>
    </>
  );
}
