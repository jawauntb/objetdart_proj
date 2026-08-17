"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import SiteHeader from "@/components/SiteHeader";
import { getFieldAudio } from "@/lib/audio";

const GroupField = dynamic(() => import("@/components/GroupField"), { ssr: false });

// /group is a law, not a place: it takes no scale address and mounts no
// AxisChrome — invariance of a seen fragment holds at every band.
export default function GroupPage() {
  useEffect(() => {
    getFieldAudio().setAmbientProfile("cosmic");
  }, []);

  return (
    <>
      <SiteHeader />
      <main>
        <GroupField />
      </main>
    </>
  );
}
