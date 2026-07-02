import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("circularity");

export default function CircularityLayout({ children }: { children: ReactNode }) {
  return children;
}
