import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("relativity");

export default function RelativityLayout({ children }: { children: ReactNode }) {
  return children;
}
