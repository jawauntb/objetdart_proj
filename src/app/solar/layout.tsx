import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("solar");

export default function SolarLayout({ children }: { children: ReactNode }) {
  return children;
}
