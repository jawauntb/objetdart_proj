import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("coast");

export default function CoastLayout({ children }: { children: ReactNode }) {
  return children;
}
