import dynamic from "next/dynamic";
import SiteHeader from "@/components/SiteHeader";

const Gate = dynamic(() => import("@/components/Gate"), { ssr: false });

// RoomShell mounts the axis chrome, the whole gesture grammar, the vessel,
// the glimmer clock and the quiet clear — all inside the component. The page
// names the room's atmosphere and nothing else.
export default function GatePage() {
  return (
    <>
      <SiteHeader />
      <Gate />
    </>
  );
}
