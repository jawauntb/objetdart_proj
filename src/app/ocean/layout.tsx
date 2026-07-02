import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("ocean");

export default function OceanLayout({ children }: { children: ReactNode }) {
  return children;
}
