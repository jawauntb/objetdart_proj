import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("colophon");

export default function ColophonLayout({ children }: { children: ReactNode }) {
  return children;
}
