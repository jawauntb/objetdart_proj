"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";

// /cabinet is a case holding every route at once — a view of the tree, not a
// rung on it. Like /overlook and /loom it takes no scale address, so it mounts
// no ScaleTravel and no MetaNavigator: there is no band to pinch out of and no
// ring of same-size siblings to twist through.
const HomeCabinet = dynamic(() => import("@/components/HomeCabinet"), { ssr: false });

export default function CabinetPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("clockwork"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <HomeCabinet />
      </main>
    </>
  );
}
