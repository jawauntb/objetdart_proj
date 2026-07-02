import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("earth");

export default function EarthLayout({ children }: { children: ReactNode }) {
  return children;
}
