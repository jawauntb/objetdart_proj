import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("beyond");

export default function BeyondLayout({ children }: { children: ReactNode }) {
  return children;
}
