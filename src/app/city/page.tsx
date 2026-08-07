import dynamic from "next/dynamic";
import SiteHeader from "@/components/SiteHeader";
import AxisChrome from "@/components/AxisChrome";

const City = dynamic(() => import("@/components/City"), { ssr: false });

export default function CityPage() {
  return (
    <>
      <SiteHeader />
      <City />
      <AxisChrome route="/city" travel={false} />
    </>
  );
}
