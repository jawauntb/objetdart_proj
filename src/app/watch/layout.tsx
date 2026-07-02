import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("watch");

export default function WatchLayout({ children }: { children: ReactNode }) {
  return children;
}
