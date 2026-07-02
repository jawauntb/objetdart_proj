import dynamic from "next/dynamic";
import SiteHeader from "@/components/SiteHeader";

const Coin = dynamic(() => import("@/components/Coin"), { ssr: false });

export default function CoinPage() {
  return (
    <>
      <SiteHeader />
      <Coin />
    </>
  );
}
