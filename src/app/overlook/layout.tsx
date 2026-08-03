import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("overlook");

export default function OverlookLayout({ children }: { children: ReactNode }) {
  return children;
}
