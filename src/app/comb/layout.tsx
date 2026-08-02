import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("comb");

export default function CombLayout({ children }: { children: ReactNode }) {
  return children;
}
