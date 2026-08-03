import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("organics");

export default function OrganicsLayout({ children }: { children: ReactNode }) {
  return children;
}
