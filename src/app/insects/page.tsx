"use client";

import dynamic from "next/dynamic";
import SiteHeader from "@/components/SiteHeader";
import ScaleTravel from "@/components/ScaleTravel";
import MetaNavigator from "@/components/MetaNavigator";

const Insects = dynamic(() => import("@/components/Insects"), { ssr: false });

export default function InsectsPage() {
  return (
    <>
      <SiteHeader />
      <Insects />
      <ScaleTravel route="/insects" />
      <MetaNavigator route="/insects" />
    </>
  );
}
