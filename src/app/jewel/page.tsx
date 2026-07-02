import dynamic from "next/dynamic";
import SiteHeader from "@/components/SiteHeader";

const Jewel = dynamic(() => import("@/components/Jewel"), { ssr: false });

export default function JewelPage() {
  return (
    <>
      <SiteHeader />
      <Jewel />
    </>
  );
}
