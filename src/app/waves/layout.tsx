import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("waves");

export default function WavesLayout({ children }: { children: ReactNode }) {
  return children;
}
