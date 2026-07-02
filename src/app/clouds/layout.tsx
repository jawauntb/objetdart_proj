import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("clouds");

export default function CloudsLayout({ children }: { children: ReactNode }) {
  return children;
}
