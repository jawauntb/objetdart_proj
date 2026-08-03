import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("guide");

export default function GuideLayout({ children }: { children: ReactNode }) {
  return children;
}
