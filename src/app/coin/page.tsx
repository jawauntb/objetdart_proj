import dynamic from "next/dynamic";
import SiteHeader from "@/components/SiteHeader";

const Coin = dynamic(() => import("@/components/Coin"), { ssr: false });

export const metadata = {
  title: "Coin — a gold medal you tilt, flip, and rub",
};

export default function CoinPage() {
  return (
    <>
      <SiteHeader />
      <Coin />
    </>
  );
}
