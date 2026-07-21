"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import LightInstrument from "@/components/LightInstrument";

export default function LightPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("light"); }, []);

  return (
    <main>
      <LightInstrument />
    </main>
  );
}
