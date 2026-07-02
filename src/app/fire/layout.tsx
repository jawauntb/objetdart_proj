import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("fire");

export default function FireLayout({ children }: { children: ReactNode }) {
  return children;
}
