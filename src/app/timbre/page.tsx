"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import TimbreInstrument from "@/components/TimbreInstrument";

export default function TimbrePage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("light"); }, []);

  return (
    <main>
      <TimbreInstrument />
    </main>
  );
}
