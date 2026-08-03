"use client";

import SiteHeader from "@/components/SiteHeader";
import AxisChrome from "@/components/AxisChrome";
import DitherLab from "./DitherLab";

export default function DitherPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <DitherLab />
      </main>
      <AxisChrome route="/dither" />
    </>
  );
}
