import dynamic from "next/dynamic";
import SiteHeader from "@/components/SiteHeader";

const Movement = dynamic(() => import("@/components/Movement"), { ssr: false });

export default function MovementPage() {
  return (
    <>
      <SiteHeader />
      <Movement />
    </>
  );
}
