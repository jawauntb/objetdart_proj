import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("voids");

export default function VoidsLayout({ children }: { children: ReactNode }) {
  return children;
}
