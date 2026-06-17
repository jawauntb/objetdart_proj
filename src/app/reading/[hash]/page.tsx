"use client";

import { useEffect } from "react";
import { useParams, notFound } from "next/navigation";
import { getFieldAudio } from "@/lib/audio";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import SharedReading from "@/components/SharedReading";
import { decodeReadingHash } from "@/lib/reading";

export default function ReadingPermalinkPage() {
  const params = useParams<{ hash: string }>();
  const decoded = params?.hash ? decodeReadingHash(params.hash) : null;

  useEffect(() => { getFieldAudio().setAmbientProfile("silent"); }, []);

  if (!decoded) notFound();

  return (
    <>
      <SiteHeader />
      <main>
        <SharedReading input={decoded} />
      </main>
      <SiteFooter />
    </>
  );
}
