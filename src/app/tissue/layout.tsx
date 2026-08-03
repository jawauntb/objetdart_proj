import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("tissue");

export default function TissueLayout({ children }: { children: ReactNode }) {
  return children;
}
