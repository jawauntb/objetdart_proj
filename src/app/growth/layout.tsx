import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("growth");

export default function GrowthLayout({ children }: { children: ReactNode }) {
  return children;
}
