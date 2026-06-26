import dynamic from "next/dynamic";

const Movement = dynamic(() => import("@/components/Movement"), { ssr: false });

export const metadata = {
  title: "Movement — a mechanical watch in three dimensions",
};

export default function MovementPage() {
  return <Movement />;
}
