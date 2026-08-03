import dynamic from "next/dynamic";
import SiteHeader from "@/components/SiteHeader";
import AxisChrome from "@/components/AxisChrome";

const Coin = dynamic(() => import("@/components/Coin"), { ssr: false });

export default function CoinPage() {
  return (
    <>
      <SiteHeader />
      <Coin />
      <AxisChrome route="/coin" />
    </>
  );
}
