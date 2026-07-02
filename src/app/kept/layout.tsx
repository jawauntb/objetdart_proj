import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("kept");

export default function KeptLayout({ children }: { children: ReactNode }) {
  return children;
}
