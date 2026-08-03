import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("space");

export default function SpaceLayout({ children }: { children: ReactNode }) {
  return children;
}
