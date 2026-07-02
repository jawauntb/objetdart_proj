import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("aphros");

export default function AphrosLayout({ children }: { children: ReactNode }) {
  return children;
}
