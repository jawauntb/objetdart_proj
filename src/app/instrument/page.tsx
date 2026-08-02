"use client";

import { useEffect } from "react";
import { getFieldAudio } from "@/lib/audio";
import Instrument from "@/components/Instrument";

export default function InstrumentPage() {
  useEffect(() => { getFieldAudio().setAmbientProfile("light"); }, []);

  return (
    <main>
      <Instrument />
    </main>
  );
}
