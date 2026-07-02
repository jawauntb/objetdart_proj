import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = siteMetadata("pretext");

export default function PretextLayout({ children }: { children: ReactNode }) {
  return children;
}
