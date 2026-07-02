import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("coin");

export default function CoinLayout({ children }: { children: ReactNode }) {
  return children;
}
