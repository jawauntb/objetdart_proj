import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("compass");

export default function CompassLayout({ children }: { children: ReactNode }) {
  return children;
}
