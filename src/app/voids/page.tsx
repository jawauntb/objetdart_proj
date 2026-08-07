"use client";

import dynamic from "next/dynamic";
import SiteHeader from "@/components/SiteHeader";
import ScaleTravel from "@/components/ScaleTravel";
import MetaNavigator from "@/components/MetaNavigator";

const Voids = dynamic(() => import("@/components/Voids"), { ssr: false });

export default function VoidsPage() {
  return (
    <>
      <SiteHeader />
      <Voids />
      <ScaleTravel route="/voids" />
      <MetaNavigator route="/voids" />
    </>
  );
}
