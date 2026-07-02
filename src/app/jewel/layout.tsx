import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("jewel");

export default function JewelLayout({ children }: { children: ReactNode }) {
  return children;
}
