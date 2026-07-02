import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("flowers");

export default function FlowersLayout({ children }: { children: ReactNode }) {
  return children;
}
