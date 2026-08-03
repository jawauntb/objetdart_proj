import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("loom");

export default function LoomLayout({ children }: { children: ReactNode }) {
  return children;
}
