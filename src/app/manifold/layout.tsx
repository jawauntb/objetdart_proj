import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("manifold");

export default function ManifoldLayout({ children }: { children: ReactNode }) {
  return children;
}
