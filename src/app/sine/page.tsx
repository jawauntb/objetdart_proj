"use client";

import SiteHeader from "@/components/SiteHeader";
import SineWaveExplorer from "@/components/SineWaveExplorer";

export default function SinePage() {
  return (
    <>
      <SiteHeader />
      <main>
        <SineWaveExplorer />
      </main>
    </>
  );
}
