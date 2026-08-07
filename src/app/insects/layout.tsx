import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("insects");

export default function InsectsLayout({ children }: { children: ReactNode }) {
  return children;
}
