import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("eigen");

export default function EigenLayout({ children }: { children: ReactNode }) {
  return children;
}
