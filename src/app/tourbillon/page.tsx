import dynamic from "next/dynamic";
import SiteHeader from "@/components/SiteHeader";

const Tourbillon = dynamic(() => import("@/components/Tourbillon"), { ssr: false });

export default function TourbillonPage() {
  return (
    <>
      <SiteHeader />
      <Tourbillon />
    </>
  );
}
