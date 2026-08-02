import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("beam");

export default function BeamLayout({ children }: { children: ReactNode }) {
  return children;
}
