import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("charts");

export default function ChartsLayout({ children }: { children: ReactNode }) {
  return children;
}
