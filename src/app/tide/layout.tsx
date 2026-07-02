import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("tide");

export default function TideLayout({ children }: { children: ReactNode }) {
  return children;
}
