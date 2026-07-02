import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("archive");

export default function ArchiveLayout({ children }: { children: ReactNode }) {
  return children;
}
