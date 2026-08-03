import dynamic from "next/dynamic";
import SiteHeader from "@/components/SiteHeader";
import AxisChrome from "@/components/AxisChrome";

const Jewel = dynamic(() => import("@/components/Jewel"), { ssr: false });

export default function JewelPage() {
  return (
    <>
      <SiteHeader />
      <Jewel />
      <AxisChrome route="/jewel" />
    </>
  );
}
