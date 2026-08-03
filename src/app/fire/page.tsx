"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import AxisChrome from "@/components/AxisChrome";
import Fire from "@/components/Fire";

export default function FirePage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("fire"); }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <Fire />
      </main>
      <AxisChrome route="/fire" />
    </>
  );
}
