import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("dna");

export default function DnaLayout({ children }: { children: ReactNode }) {
  return children;
}
