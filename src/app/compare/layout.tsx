import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("compare");

export default function CompareLayout({ children }: { children: ReactNode }) {
  return children;
}
