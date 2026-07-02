import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("pulse");

export default function PulseLayout({ children }: { children: ReactNode }) {
  return children;
}
