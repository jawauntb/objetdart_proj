import dynamic from "next/dynamic";
import SiteHeader from "@/components/SiteHeader";
import AxisChrome from "@/components/AxisChrome";

const Tourbillon = dynamic(() => import("@/components/Tourbillon"), { ssr: false });

export default function TourbillonPage() {
  return (
    <>
      <SiteHeader />
      <Tourbillon />
      <AxisChrome route="/tourbillon" travel={false} />
    </>
  );
}
