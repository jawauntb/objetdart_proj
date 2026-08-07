import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("zeus");

export default function ZeusLayout({ children }: { children: ReactNode }) {
  return children;
}
